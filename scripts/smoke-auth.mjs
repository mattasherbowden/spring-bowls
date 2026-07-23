// End-to-end smoke test of the accounts slice against the live project.
// Creates a throwaway NON-owner user, asserts the RLS guards, then deletes it.
// Does NOT consume the single owner slot.
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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const suffix = Math.random().toString(36).slice(2, 8);
const username = `smoke_${suffix}`;
const email = `${username}@springbowls.local`;
const password = "smoke-password-123";

let uid;
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

try {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  check("admin can create an auth user", !cErr && !!created.user);
  uid = created.user.id;

  const { error: pErr } = await admin
    .from("profile")
    .insert({ id: uid, username, display_name: "Smoke Test", is_owner: false });
  check("admin can insert a profile (service role)", !pErr);

  // Anonymous (no session) must NOT read the profile.
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: anonRows } = await anon
    .from("profile")
    .select("id")
    .eq("id", uid);
  check("anon cannot read a profile (RLS)", (anonRows?.length ?? 0) === 0);

  // The user themselves logs in and reads only their own row.
  const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: sErr } = await asUser.auth.signInWithPassword({
    email,
    password,
  });
  check("user can log in with username-derived email", !sErr);

  const { data: ownRow } = await asUser
    .from("profile")
    .select("id, username")
    .eq("id", uid)
    .maybeSingle();
  check("user can read their own profile", ownRow?.id === uid);

  // The user must NOT be able to self-insert a profile (no INSERT policy).
  const { error: selfInsErr } = await asUser
    .from("profile")
    .insert({ id: uid, username: `x_${suffix}`, display_name: "Nope" });
  check("user cannot self-insert a profile (no self-registration)", !!selfInsErr);
} finally {
  if (uid) {
    await admin.auth.admin.deleteUser(uid);
    console.log("cleaned up test user");
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
