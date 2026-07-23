// RLS smoke test for tournament/team/player. Builds a throwaway ARCHIVED
// tournament (so it never clashes with the one-active-tournament rule) with a
// member and an outsider, checks the read rules, then cleans everything up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 7);
const created = [];
let tournamentId;
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

async function makeUser(tag) {
  const email = `smoke_${tag}_${suffix}@springbowls.local`;
  const password = "smoke-password-123";
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  created.push(body.id);
  await admin
    .from("profile")
    .insert({ id: body.id, username: `smoke_${tag}_${suffix}`, display_name: tag });
  return { id: body.id, email, password };
}

async function signedInClient(email, password) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  return c;
}

try {
  const owner = await makeUser("owner"); // stand-in creator (not the real owner)
  const member = await makeUser("member");
  const outsider = await makeUser("outsider");

  const { data: t } = await admin
    .from("tournament")
    .insert({ name: "Smoke", status: "archived", created_by: owner.id })
    .select("id")
    .single();
  tournamentId = t.id;

  const { data: team } = await admin
    .from("team")
    .insert({ tournament_id: tournamentId, name: "Smoke Team" })
    .select("id")
    .single();

  await admin.from("player").insert({
    tournament_id: tournamentId,
    team_id: team.id,
    profile_id: member.id,
    display_name: "Member",
    role: "player",
  });

  const memberClient = await signedInClient(member.email, member.password);
  const { data: mT } = await memberClient
    .from("tournament")
    .select("id")
    .eq("id", tournamentId);
  check("a member can read their tournament", (mT?.length ?? 0) === 1);
  const { data: mTeams } = await memberClient
    .from("team")
    .select("id")
    .eq("tournament_id", tournamentId);
  check("a member can read their teams", (mTeams?.length ?? 0) === 1);

  const outClient = await signedInClient(outsider.email, outsider.password);
  const { data: oT } = await outClient
    .from("tournament")
    .select("id")
    .eq("id", tournamentId);
  check("an outsider cannot read the tournament (RLS)", (oT?.length ?? 0) === 0);
  const { data: oPlayers } = await outClient
    .from("player")
    .select("id")
    .eq("tournament_id", tournamentId);
  check("an outsider cannot read its players (RLS)", (oPlayers?.length ?? 0) === 0);

  // An outsider must not be able to create a tournament (owner-only insert).
  const { error: insErr } = await outClient
    .from("tournament")
    .insert({ name: "Hax", created_by: outsider.id });
  check("a non-owner cannot create a tournament (RLS)", !!insErr);

  // Score entry: ends are readable by members but never writable by clients
  // (only the submitScore server action writes, via the service role).
  const { data: fx } = await admin
    .from("fixture")
    .insert({ tournament_id: tournamentId, team_a_id: team.id })
    .select("id")
    .single();
  await admin
    .from("fixture_end")
    .insert({ fixture_id: fx.id, end_number: 1, shots_a: 3, shots_b: 1 });

  const { data: mEnds } = await memberClient
    .from("fixture_end")
    .select("id")
    .eq("fixture_id", fx.id);
  check("a member can read fixture ends", (mEnds?.length ?? 0) === 1);

  const { error: endWriteErr } = await memberClient
    .from("fixture_end")
    .insert({ fixture_id: fx.id, end_number: 2, shots_a: 9, shots_b: 0 });
  check("a client cannot write a fixture end directly (RLS)", !!endWriteErr);
} finally {
  if (tournamentId) await admin.from("tournament").delete().eq("id", tournamentId);
  for (const id of created)
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  console.log("cleaned up");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
