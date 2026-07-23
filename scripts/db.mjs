// Tiny DB helper for local migrations. Reads .env.local, connects to Supabase
// Postgres (session pooler when SUPABASE_DB_REGION is set), and either runs a
// SQL file (arg) or a connectivity check (no arg).
//   node scripts/db.mjs
//   node scripts/db.mjs supabase/migrations/0001_accounts.sql
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

const file = process.argv[2];
if (file) {
  const res = await client.query(readFileSync(path.resolve(root, file), "utf8"));
  const results = Array.isArray(res) ? res : [res];
  const last = results[results.length - 1];
  if (last?.rows?.length) console.table(last.rows);
  console.log("applied", file);
} else {
  const r = await client.query("select current_user, current_database() as db");
  console.log("ok:", r.rows[0]);
}
await client.end();
