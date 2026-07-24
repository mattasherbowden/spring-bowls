// One-off: (re)assign photo-bomb partners for the active tournament using the
// live rule — mutual pairs, never yourself, never your own team-mate.
//   node scripts/assign-photo.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const pw = encodeURIComponent(env.SUPABASE_DB_PASSWORD ?? "");
const region = env.SUPABASE_DB_REGION;
const connectionString = region
  ? `postgresql://postgres.${ref}:${pw}@aws-0-${region}.pooler.supabase.com:5432/postgres`
  : `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`;

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});
await client.connect();

const { rows: t } = await client.query(
  "select id from public.tournament where status <> 'archived' limit 1",
);
if (!t.length) {
  console.log("no active tournament");
  await client.end();
  process.exit(0);
}
const { rows: players } = await client.query(
  "select id, team_id from public.player where tournament_id = $1",
  [t[0].id],
);

const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function assign(pl) {
  if (pl.length < 2) return new Map();
  for (let att = 0; att < 300; att++) {
    const pool = shuffle(pl);
    const used = new Set();
    const map = new Map();
    for (let i = 0; i < pool.length; i++) {
      if (used.has(pool[i].id)) continue;
      let partner;
      for (let j = i + 1; j < pool.length; j++) {
        const c = pool[j];
        if (!used.has(c.id) && c.team_id !== pool[i].team_id) {
          partner = c;
          break;
        }
      }
      if (partner) {
        map.set(pool[i].id, partner.id);
        map.set(partner.id, pool[i].id);
        used.add(pool[i].id);
        used.add(partner.id);
      }
    }
    const left = pool.filter((p) => !used.has(p.id));
    if (left.length === 0) return map;
    if (left.length === 1) {
      const solo = left[0];
      const tgt = pool.find(
        (p) => used.has(p.id) && p.team_id !== solo.team_id,
      );
      if (tgt) {
        map.set(solo.id, tgt.id);
        return map;
      }
    }
  }
  const pool = shuffle(pl);
  const map = new Map();
  for (let i = 0; i < pool.length; i++)
    map.set(pool[i].id, pool[(i + 1) % pool.length].id);
  return map;
}

const map = assign(players);
for (const [id, partnerId] of map) {
  await client.query(
    "update public.player set photo_partner_id = $1 where id = $2",
    [partnerId, id],
  );
}
console.log("assigned", map.size, "photo partners");
await client.end();
