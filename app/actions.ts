"use server";

import { createHash, randomInt } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAuthUser,
  deleteAuthUser,
  setAuthUserPassword,
} from "@/lib/supabase/auth-admin";

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

// ---------- owner recovery (no email, so a recovery code) ----------

const RECOVERY_WORDS = [
  "green",
  "jack",
  "rink",
  "bowl",
  "spring",
  "mat",
  "ditch",
  "draw",
  "skip",
  "lead",
];

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

function makeRecoveryCode(): string {
  const word = () => RECOVERY_WORDS[randomInt(RECOVERY_WORDS.length)];
  return `${word()}-${word()}-${randomInt(1000, 10000)}`;
}

export type RecoveryState = { error?: string; code?: string; done?: boolean };

export async function generateRecoveryCode(
  _prev: RecoveryState,
  _fd: FormData,
): Promise<RecoveryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in." };

  const admin = createAdminClient();
  const { data: prof } = await admin
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_owner) return { error: "Only the owner has a recovery code." };

  const code = makeRecoveryCode();
  await admin
    .from("profile")
    .update({ recovery_hash: hashCode(code) })
    .eq("id", user.id);
  return { code };
}

export async function recoverPassword(
  _prev: RecoveryState,
  fd: FormData,
): Promise<RecoveryState> {
  const username = String(fd.get("username") ?? "").trim();
  const code = String(fd.get("code") ?? "").trim();
  const newPassword = String(fd.get("password") ?? "");
  if (!username || !code || newPassword.length < 8) {
    return {
      error:
        "Enter your username, recovery code, and a new password (8+ characters).",
    };
  }

  const admin = createAdminClient();
  const { data: prof } = await admin
    .from("profile")
    .select("id, recovery_hash")
    .eq("username_canonical", username.toLowerCase())
    .maybeSingle();
  if (!prof?.recovery_hash || prof.recovery_hash !== hashCode(code)) {
    return { error: "That username and recovery code do not match." };
  }

  const ok = await setAuthUserPassword(prof.id, newPassword);
  if (!ok) return { error: "Could not reset the password — please try again." };
  redirect("/");
}

export async function changeOwnerPassword(
  _prev: RecoveryState,
  fd: FormData,
): Promise<RecoveryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in." };

  const admin = createAdminClient();
  const { data: prof } = await admin
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_owner) return { error: "Only the owner can change it here." };

  const newPassword = String(fd.get("password") ?? "");
  if (newPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  const ok = await setAuthUserPassword(user.id, newPassword);
  if (!ok) return { error: "Could not change the password — please try again." };
  return { done: true };
}
