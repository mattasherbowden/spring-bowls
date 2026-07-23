"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthUser, deleteAuthUser } from "@/lib/supabase/auth-admin";

const USERNAME_RE = /^[A-Za-z0-9._-]{2,32}$/;
const EMAIL_DOMAIN = "springbowls.local";
const MIN_PASSWORD = 8;

/** Canonical (case/space-folded) username — matches the DB generated column. */
function canonical(username: string): string {
  return username.trim().toLowerCase();
}

/** Deterministic synthetic email from a validated, canonical username (D-0002). */
function synthEmail(username: string): string {
  return `${canonical(username)}@${EMAIL_DOMAIN}`;
}

export type AuthState = {
  error?: string;
  values?: { username?: string; displayName?: string };
};

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!username.trim() || !password) {
    return { error: "Enter your username and password.", values: { username } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: synthEmail(username),
    password,
  });
  if (error) {
    return {
      error: "That username and password do not match.",
      values: { username },
    };
  }
  redirect("/");
}

export async function createOwner(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const values = { username, displayName };

  if (!USERNAME_RE.test(username)) {
    return {
      error:
        "Username must be 2–32 characters: letters, numbers, dot, dash or underscore.",
      values,
    };
  }
  if (displayName.length < 1) return { error: "Enter your name.", values };
  if (password.length < MIN_PASSWORD) {
    return {
      error: `Password must be at least ${MIN_PASSWORD} characters.`,
      values,
    };
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("profile")
    .select("*", { count: "exact", head: true })
    .eq("is_owner", true);
  if ((count ?? 0) > 0) {
    return { error: "An owner already exists — please log in instead.", values };
  }

  const created = await createAuthUser(synthEmail(username), password);
  if ("error" in created) {
    return { error: `Could not create the account: ${created.error}`, values };
  }

  const { error: profileErr } = await admin.from("profile").insert({
    id: created.id,
    username,
    display_name: displayName,
    is_owner: true,
  });
  if (profileErr) {
    await deleteAuthUser(created.id);
    return { error: "That username is already taken.", values };
  }

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({
    email: synthEmail(username),
    password,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
