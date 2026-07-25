// Audit/repack the active tournament's EXISTING group fixtures into conflict-
// free time waves. Matchups, rounds, IDs and scores are never changed.
//
// Dry run:
//   node scripts/repack-live-schedule.mjs
// Apply atomically:
//   node scripts/repack-live-schedule.mjs --apply
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = encodeURIComponent(env.SUPABASE_DB_PASSWORD ?? "");
const region = env.SUPABASE_DB_REGION;
const connectionString = region
  ? `postgresql://postgres.${ref}:${password}@aws-0-${region}.pooler.supabase.com:5432/postgres`
  : `postgresql://postgres:${password}@db.${ref}.supabase.co:5432/postgres`;
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

function pack(games, rinkCount) {
  const remaining = [...games];
  const packed = [];
  let wave = 0;
  while (remaining.length) {
    const used = new Set();
    let position = 0;
    for (let index = 0; index < remaining.length && position < rinkCount; ) {
      const game = remaining[index];
      const conflicts = used.has(game.team_a_id) || used.has(game.team_b_id);
      const skipsEarlier = remaining.some(
        (other) =>
          other.round < game.round &&
          [other.team_a_id, other.team_b_id].some(
            (team) => team === game.team_a_id || team === game.team_b_id,
          ),
      );
      if (conflicts || skipsEarlier) {
        index++;
        continue;
      }
      remaining.splice(index, 1);
      used.add(game.team_a_id);
      used.add(game.team_b_id);
      packed.push({
        ...game,
        rink: position + 1,
        order_index: wave * rinkCount + position,
      });
      position++;
    }
    if (!position) throw new Error("Could not make a conflict-free wave");
    wave++;
  }
  return packed;
}

await client.connect();
try {
  const tournamentResult = await client.query(`
    select id, rink_count
    from public.tournament
    where status <> 'archived'
    limit 1
  `);
  const tournament = tournamentResult.rows[0];
  if (!tournament) throw new Error("No active tournament");

  const fixtureResult = await client.query(
    `select id, group_label, round, team_a_id, team_b_id, rink, order_index, status
       from public.fixture
      where tournament_id = $1 and stage = 'group'
      order by round, group_label, order_index`,
    [tournament.id],
  );
  const fixtures = fixtureResult.rows;
  if (!fixtures.length) throw new Error("The active tournament has no group fixtures");
  if (
    fixtures.some(
      (fixture) => !fixture.team_a_id || !fixture.team_b_id || fixture.round == null,
    )
  ) {
    throw new Error("A group fixture is missing teams or its round");
  }

  const plan = pack(fixtures, tournament.rink_count);
  const changed = plan.filter(
    (fixture) =>
      fixture.rink !== fixtures.find((old) => old.id === fixture.id).rink ||
      fixture.order_index !==
        fixtures.find((old) => old.id === fixture.id).order_index,
  );

  for (const wave of new Set(plan.map((fixture) =>
    Math.floor(fixture.order_index / tournament.rink_count)))) {
    const waveFixtures = plan.filter(
      (fixture) =>
        Math.floor(fixture.order_index / tournament.rink_count) === wave,
    );
    const teams = waveFixtures.flatMap((fixture) => [
      fixture.team_a_id,
      fixture.team_b_id,
    ]);
    if (new Set(teams).size !== teams.length) {
      throw new Error(`Generated wave ${wave + 1} double-books a team`);
    }
  }

  console.log(
    `${fixtures.length} fixtures · ${Math.max(...plan.map((fixture) =>
      Math.floor(fixture.order_index / tournament.rink_count))) + 1} waves · ${changed.length} rink/order changes`,
  );

  if (!process.argv.includes("--apply")) {
    console.log("Dry run only. Pass --apply to save this plan.");
  } else {
    await client.query("begin");
    try {
      for (const fixture of plan) {
        await client.query(
          `update public.fixture
              set rink = $1, order_index = $2
            where id = $3 and tournament_id = $4 and stage = 'group'`,
          [
            fixture.rink,
            fixture.order_index,
            fixture.id,
            tournament.id,
          ],
        );
      }
      await client.query("commit");
      console.log("Live schedule repacked atomically; matchups and scores unchanged.");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
