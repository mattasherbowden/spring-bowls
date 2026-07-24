"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthUser, deleteAuthUser } from "@/lib/supabase/auth-admin";
import { suggestUsername, generatePassword } from "@/lib/domain/credentials";
import { splitIntoGroups } from "@/lib/domain/planner";
import { drawGroups, buildGroupSchedule } from "@/lib/domain/schedule";
import { resolveKnockout } from "@/lib/server/knockout";

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
    planned_teams: intField(fd, "plannedTeams", 12),
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

      const created = await createAuthUser(email, password);
      if ("error" in created) {
        throw new Error(`a login for ${p.displayName} (${created.error})`);
      }
      createdUserIds.push(created.id);

      const { error: profErr } = await admin.from("profile").insert({
        id: created.id,
        username,
        display_name: p.displayName,
        is_owner: false,
      });
      if (profErr) {
        throw new Error(`a profile for ${p.displayName} (${profErr.message})`);
      }

      const { error: playerErr } = await admin.from("player").insert({
        tournament_id: tournament.id,
        team_id: team.id,
        profile_id: created.id,
        display_name: p.displayName,
        nationality: p.nationality,
        role: "player",
      });
      if (playerErr) {
        throw new Error(`the roster for ${p.displayName} (${playerErr.message})`);
      }

      output.push({ displayName: p.displayName, username, password });
    }
  } catch (e) {
    for (const uid of createdUserIds) await deleteAuthUser(uid);
    await admin.from("team").delete().eq("id", team.id);
    const reason = e instanceof Error ? e.message : "an unknown error";
    return {
      error: `Could not create ${reason}. Nothing was saved — please try again.`,
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

// ---------- generate the schedule (auto-draw the groups and lock) ----------

export type GenerateState = { error?: string };

export async function generateSchedule(
  _prev: GenerateState,
  _fd: FormData,
): Promise<GenerateState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can generate the schedule." };

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("tournament")
    .select("id, status, rink_count, preferred_group_size")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!t) return { error: "No active tournament." };
  if (t.status !== "setup") redirect("/schedule");

  const { data: teams } = await admin
    .from("team")
    .select("id")
    .eq("tournament_id", t.id)
    .eq("withdrawn", false);
  if (!teams || teams.length < 2) {
    return { error: "Add at least 2 teams before generating the schedule." };
  }

  const sizes = splitIntoGroups(teams.length, t.preferred_group_size);
  const drawn = drawGroups(
    teams.map((x) => x.id),
    sizes,
  );

  for (const group of drawn) {
    await admin
      .from("team")
      .update({ group_label: group.label })
      .in("id", group.teamIds);
  }

  const schedule = buildGroupSchedule(drawn, t.rink_count);
  const rows = schedule.map((f) => ({
    tournament_id: t.id,
    stage: "group",
    group_label: f.groupLabel,
    round: f.round,
    rink: f.rink,
    order_index: f.order,
    team_a_id: f.teamA,
    team_b_id: f.teamB,
  }));
  const { error: fErr } = await admin.from("fixture").insert(rows);
  if (fErr) return { error: `Could not save the schedule: ${fErr.message}` };

  await admin.from("tournament").update({ status: "live" }).eq("id", t.id);
  await resolveKnockout(admin, t.id);
  redirect("/schedule");
}

export type EventState = { error?: string; done?: boolean };

export async function saveEvent(
  _prev: EventState,
  fd: FormData,
): Promise<EventState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can edit the event." };

  const admin = createAdminClient();
  const eventAt = String(fd.get("eventAt") ?? "").trim();
  const { error } = await admin.from("event_settings").upsert({
    id: 1,
    event_at: eventAt || null,
    venue_name: String(fd.get("venueName") ?? "").trim() || null,
    venue_address: String(fd.get("venueAddress") ?? "").trim() || null,
    venue_phone: String(fd.get("venuePhone") ?? "").trim() || null,
    details: String(fd.get("details") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: `Could not save: ${error.message}` };
  revalidatePath("/");
  return { done: true };
}

export async function refreshKnockout(): Promise<void> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return;
  const admin = createAdminClient();
  const { data: t } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!t) return;
  await resolveKnockout(admin, t.id);
  revalidatePath("/schedule");
  redirect("/schedule");
}

// ---------- reset: delete the tournament, its teams, logins and schedule ----------

export async function resetTournament(
  _prev: GenerateState,
  _fd: FormData,
): Promise<GenerateState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can reset the tournament." };

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!t) redirect("/setup");

  // Grab the player accounts before the tournament (and its player rows) go.
  const { data: players } = await admin
    .from("player")
    .select("profile_id")
    .eq("tournament_id", t.id);

  // Deleting the tournament cascades its teams, players and fixtures.
  await admin.from("tournament").delete().eq("id", t.id);

  // Delete each player's auth account (frees the username); keep the owner.
  for (const p of players ?? []) {
    if (p.profile_id !== ownerId) await deleteAuthUser(p.profile_id);
  }

  redirect("/setup");
}
