"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { suggestUsername, generatePassword } from "@/lib/domain/credentials";

const EMAIL_DOMAIN = "springbowls.local";

async function currentOwnerId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .single();
  return data?.is_owner ? user.id : null;
}

function intField(fd: FormData, key: string, fallback: number): number {
  const n = Number(fd.get(key));
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

// ---------- create tournament ----------

export type CreateState = { error?: string };

export async function createTournament(
  _prev: CreateState,
  fd: FormData,
): Promise<CreateState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can create a tournament." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (existing) redirect("/setup/teams");

  const supabase = await createClient();
  const { error } = await supabase.from("tournament").insert({
    name: String(fd.get("name") || "Spring Bowls"),
    team_size: intField(fd, "teamSize", 2),
    rink_count: intField(fd, "rinks", 3),
    ends_per_game: intField(fd, "endsPerGame", 2),
    minutes_per_end: intField(fd, "minutesPerEnd", 12),
    advance: intField(fd, "advance", 2),
    preferred_group_size: intField(fd, "preferredGroupSize", 4),
    start_time: String(fd.get("startTime") || "") || null,
    created_by: ownerId,
  });
  if (error) return { error: `Could not create the tournament: ${error.message}` };
  redirect("/setup/teams");
}

// ---------- add a team (creates player logins) ----------

export type CreatedPlayer = {
  displayName: string;
  username: string;
  password: string;
};

export type AddTeamState = {
  error?: string;
  created?: { teamName: string; players: CreatedPlayer[] };
};

async function uniqueUsername(
  admin: SupabaseClient,
  displayName: string,
): Promise<string> {
  const base = suggestUsername(displayName);
  let candidate = base;
  for (let n = 2; n < 60; n++) {
    const { count } = await admin
      .from("profile")
      .select("*", { count: "exact", head: true })
      .eq("username_canonical", candidate.toLowerCase());
    if ((count ?? 0) === 0) return candidate;
    candidate = `${base}${n}`.slice(0, 32);
  }
  return `${base}${Math.floor(Math.random() * 100000)}`.slice(0, 32);
}

export async function addTeam(
  _prev: AddTeamState,
  fd: FormData,
): Promise<AddTeamState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can add teams." };

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id, team_size")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return { error: "No active tournament — create one first." };

  const teamSize = tournament.team_size as number;
  const players: { displayName: string; nationality: "brit" | "kiwi" | null }[] =
    [];
  for (let i = 0; i < teamSize; i++) {
    const name = String(fd.get(`name_${i}`) ?? "").trim();
    const nat = String(fd.get(`nat_${i}`) ?? "");
    if (name) {
      players.push({
        displayName: name,
        nationality: nat === "brit" || nat === "kiwi" ? nat : null,
      });
    }
  }
  if (players.length !== teamSize) {
    return { error: `Enter all ${teamSize} player names.` };
  }
  const teamName = String(fd.get("teamName") ?? "").trim() || null;

  const { data: team, error: teamErr } = await admin
    .from("team")
    .insert({ tournament_id: tournament.id, name: teamName })
    .select("id")
    .single();
  if (teamErr || !team) return { error: "Could not create the team." };

  const createdUserIds: string[] = [];
  const output: CreatedPlayer[] = [];
  try {
    for (const p of players) {
      const username = await uniqueUsername(admin, p.displayName);
      const password = generatePassword();
      const email = `${username.toLowerCase()}@${EMAIL_DOMAIN}`;

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (cErr || !created.user) throw new Error("createUser failed");
      createdUserIds.push(created.user.id);

      const { error: profErr } = await admin.from("profile").insert({
        id: created.user.id,
        username,
        display_name: p.displayName,
        is_owner: false,
      });
      if (profErr) throw new Error("profile insert failed");

      const { error: playerErr } = await admin.from("player").insert({
        tournament_id: tournament.id,
        team_id: team.id,
        profile_id: created.user.id,
        display_name: p.displayName,
        nationality: p.nationality,
        role: "player",
      });
      if (playerErr) throw new Error("player insert failed");

      output.push({ displayName: p.displayName, username, password });
    }
  } catch {
    for (const uid of createdUserIds) await admin.auth.admin.deleteUser(uid);
    await admin.from("team").delete().eq("id", team.id);
    return {
      error: "Could not create the logins — nothing was saved. Try again.",
    };
  }

  revalidatePath("/setup/teams");
  return {
    created: {
      teamName: teamName ?? output.map((o) => o.displayName).join(" & "),
      players: output,
    },
  };
}
