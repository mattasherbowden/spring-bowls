// Transactional smoke checks for functions that require a setup-phase event or
// the real owner row. Every mutation is rolled back before this script exits.
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
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
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

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

await client.connect();
try {
  await client.query("begin");
  const active = await client.query(`
    select id, created_by
      from public.tournament
     where status <> 'archived'
     limit 1
  `);
  if (active.rowCount !== 1) throw new Error("Expected one active tournament");
  const activeId = active.rows[0].id;
  const ownerId = active.rows[0].created_by;
  const guestProfiles = await client.query(
    `
      select distinct player.profile_id
        from public.player as player
        join public.profile as profile on profile.id = player.profile_id
       where player.tournament_id = $1
         and not profile.is_owner
         and not profile.is_admin
       limit 2
    `,
    [activeId],
  );
  if (guestProfiles.rowCount !== 2) {
    throw new Error("Expected two guest profiles in the rehearsal roster");
  }

  // Make room for a setup tournament inside this uncommitted transaction. Other
  // sessions continue to see the real event as live until the final rollback.
  await client.query(
    "update public.tournament set status = 'archived' where id = $1",
    [activeId],
  );
  const tournament = await client.query(
    `
      insert into public.tournament
        (name, status, team_size, created_by)
      values ('Transactional smoke', 'setup', 2, $1)
      returning id
    `,
    [ownerId],
  );
  const tournamentId = tournament.rows[0].id;
  const submitKey = "8be2538f-8cc4-4f0c-a8f0-0b2b1dca59b8";
  await client.query(
    `
      insert into public.team (tournament_id, name, submit_key)
      values ($1, 'Idempotency first', $2)
    `,
    [tournamentId, submitKey],
  );
  let duplicateRejected = false;
  await client.query("savepoint duplicate_team_submission");
  try {
    await client.query(
      `
        insert into public.team (tournament_id, name, submit_key)
        values ($1, 'Idempotency duplicate', $2)
      `,
      [tournamentId, submitKey],
    );
  } catch (error) {
    duplicateRejected =
      error?.code === "23505" &&
      /team_submit_key_unique/.test(error?.constraint ?? "");
    await client.query("rollback to savepoint duplicate_team_submission");
  }
  await client.query("release savepoint duplicate_team_submission");
  check(
    "setup team submission key rejects a double insert",
    duplicateRejected,
  );

  const team = await client.query(
    `
      insert into public.team (tournament_id, name)
      values ($1, 'Before')
      returning id
    `,
    [tournamentId],
  );
  const teamId = team.rows[0].id;
  const players = [];
  for (const [index, profile] of guestProfiles.rows.entries()) {
    const inserted = await client.query(
      `
        insert into public.player
          (tournament_id, team_id, profile_id, display_name, nationality)
        values ($1, $2, $3, $4, $5)
        returning id
      `,
      [
        tournamentId,
        teamId,
        profile.profile_id,
        `Before ${index + 1}`,
        index === 0 ? "brit" : "kiwi",
      ],
    );
    players.push(inserted.rows[0].id);
  }

  await client.query(
    "select public.update_setup_team($1, $2, $3, $4::jsonb)",
    [
      tournamentId,
      teamId,
      "After",
      JSON.stringify([
        { id: players[0], display_name: "Edited One", nationality: "kiwi" },
        { id: players[1], display_name: "Edited Two", nationality: "brit" },
      ]),
    ],
  );
  const edited = await client.query(
    `
      select team.name,
             array_agg(player.display_name order by player.display_name) as names
        from public.team as team
        join public.player as player on player.team_id = team.id
       where team.id = $1
       group by team.name
    `,
    [teamId],
  );
  check(
    "setup roster edit updates the whole team transactionally",
    edited.rows[0]?.name === "After" &&
      edited.rows[0]?.names?.join(",") === "Edited One,Edited Two",
  );

  const removed = await client.query(
    "select * from public.delete_setup_team($1, $2)",
    [tournamentId, teamId],
  );
  const remaining = await client.query(
    "select count(*)::int as count from public.player where team_id = $1",
    [teamId],
  );
  check(
    "setup roster removal returns guest logins and removes every roster row",
    removed.rowCount === 2 && remaining.rows[0].count === 0,
  );

  const recoveryHash = "transactional-smoke-recovery-hash";
  await client.query(
    "update public.profile set recovery_hash = $1 where id = $2",
    [recoveryHash, ownerId],
  );
  const consumed = await client.query(
    "select * from public.consume_owner_recovery($1, $2)",
    [
      (
        await client.query(
          "select username from public.profile where id = $1",
          [ownerId],
        )
      ).rows[0].username,
      recoveryHash,
    ],
  );
  check(
    "owner recovery consumes a valid code exactly once",
    consumed.rows[0]?.status === "ok" &&
      consumed.rows[0]?.profile_id === ownerId,
  );

  const throttleUser = `smoke_missing_${Date.now()}`;
  let finalStatus = "";
  for (let attempt = 0; attempt < 9; attempt++) {
    const result = await client.query(
      "select * from public.consume_owner_recovery($1, $2)",
      [throttleUser, "wrong"],
    );
    finalStatus = result.rows[0]?.status ?? "";
  }
  check(
    "owner recovery rate-limits repeated online guesses",
    finalStatus === "rate_limited",
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

console.log(failures === 0 ? "\nALL PASS (rolled back)" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
