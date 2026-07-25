"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAuthUser,
  deleteAuthUser,
  setAuthUserPassword,
} from "@/lib/supabase/auth-admin";
import { suggestUsername, generatePassword } from "@/lib/domain/credentials";
import { splitIntoGroups } from "@/lib/domain/planner";
import { drawGroups, buildGroupSchedule } from "@/lib/domain/schedule";
import { assignPhotoPartners } from "@/lib/domain/photo";
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
    .select("id, team_size, status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return { error: "No active tournament — create one first." };
  if (tournament.status !== "setup") {
    return {
      error:
        "The draw is live, so the roster is locked. Do not add a team after fixtures exist.",
    };
  }

  const teamSize = tournament.team_size as number;
  const players: {
    displayName: string;
    nationality: "brit" | "kiwi" | null;
    isMe: boolean;
  }[] = [];
  for (let i = 0; i < teamSize; i++) {
    const name = String(fd.get(`name_${i}`) ?? "").trim();
    const nat = String(fd.get(`nat_${i}`) ?? "");
    if (name) {
      players.push({
        displayName: name,
        nationality: nat === "brit" || nat === "kiwi" ? nat : null,
        isMe: fd.get(`me_${i}`) === "on",
      });
    }
  }
  if (players.length !== teamSize) {
    return { error: `Enter all ${teamSize} player names.` };
  }
  if (players.filter((p) => p.isMe).length > 1) {
    return { error: "Only one player can be marked 'This is me'." };
  }
  if (players.some((p) => p.isMe)) {
    const { data: existingMe } = await admin
      .from("player")
      .select("id")
      .eq("tournament_id", tournament.id)
      .eq("profile_id", ownerId)
      .maybeSingle();
    if (existingMe) {
      return { error: "You're already added as a player in this tournament." };
    }
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
      if (p.isMe) {
        // Link this slot to the owner's existing login — no new account.
        const { error: meErr } = await admin.from("player").insert({
          tournament_id: tournament.id,
          team_id: team.id,
          profile_id: ownerId,
          display_name: p.displayName,
          nationality: p.nationality,
          role: "player",
        });
        if (meErr) {
          throw new Error(`your player slot (${meErr.message})`);
        }
        output.push({
          displayName: p.displayName,
          username: "— your organiser login —",
          password: "",
        });
        continue;
      }

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
        login_password: password,
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

export type GenerateState = { error?: string; done?: boolean };

export async function generateSchedule(
  _prev: GenerateState,
  _fd: FormData,
): Promise<GenerateState> {
  void _prev;
  void _fd;
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

  const schedule = buildGroupSchedule(drawn, t.rink_count);
  const assignments = drawn.flatMap((group) =>
    group.teamIds.map((id) => ({ id, group_label: group.label })),
  );
  const rows = schedule.map((f) => ({
    group_label: f.groupLabel,
    round: f.round,
    rink: f.rink,
    order_index: f.order,
    team_a_id: f.teamA,
    team_b_id: f.teamB,
  }));
  const { error: drawError } = await admin.rpc("apply_tournament_draw", {
    p_tournament_id: t.id,
    p_assignments: assignments,
    p_fixtures: rows,
  });
  if (drawError) {
    if (/draw_already_live|fixtures_already_exist/.test(drawError.message)) {
      redirect("/schedule");
    }
    return {
      error: `The draw was not saved, so nothing changed. Try again (${drawError.message}).`,
    };
  }

  const knockout = await resolveKnockout(admin, t.id);

  // Photo-bomb: fixed partner for each player — mutual, never yourself, never
  // your own team-mate.
  const { data: photoPlayers } = await admin
    .from("player")
    .select("id, team_id")
    .eq("tournament_id", t.id);
  if (photoPlayers && photoPlayers.length >= 2) {
    const pairs = assignPhotoPartners(
      photoPlayers.map((p) => ({ id: p.id, teamId: p.team_id })),
    );
    const photoResults = await Promise.all(
      [...pairs.entries()].map(([id, partnerId]) =>
        admin
          .from("player")
          .update({ photo_partner_id: partnerId })
          .eq("id", id),
      ),
    );
    const photoFailures = photoResults.filter((result) => result.error);
    if (photoFailures.length > 0) {
      console.error(
        `Could not assign ${photoFailures.length} photo partner(s)`,
        photoFailures.map((result) => result.error?.message),
      );
    }
  }

  if (knockout.error) {
    return {
      error: `The group schedule is live, but the knockout needs attention: ${knockout.error}`,
    };
  }
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
    details:
      String(fd.get("details") ?? "")
        .replace(/\r\n?/g, "\n")
        .trim() || null,
    photo_album_url: String(fd.get("photoAlbumUrl") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: `Could not save: ${error.message}` };
  revalidatePath("/");
  return { done: true };
}

// ---------- helper (admin) accounts: standalone, tournament-independent ----------

export type HelperState = {
  error?: string;
  created?: { displayName: string; username: string; password: string };
};

export async function createHelper(
  _prev: HelperState,
  fd: FormData,
): Promise<HelperState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can add helpers." };
  const displayName = String(fd.get("displayName") ?? "").trim();
  if (!displayName) return { error: "Enter the helper's name." };

  const admin = createAdminClient();
  const username = await uniqueUsername(admin, displayName);
  const password = generatePassword();
  const email = `${username.toLowerCase()}@${EMAIL_DOMAIN}`;

  const created = await createAuthUser(email, password);
  if ("error" in created) {
    return { error: `Could not create the login (${created.error}).` };
  }
  const { error: profErr } = await admin.from("profile").insert({
    id: created.id,
    username,
    display_name: displayName,
    is_owner: false,
    is_admin: true,
    login_password: password,
  });
  if (profErr) {
    await deleteAuthUser(created.id);
    return { error: `Could not save the helper (${profErr.message}).` };
  }
  revalidatePath("/setup/helpers");
  return { created: { displayName, username, password } };
}

export type HelperActionState = {
  error?: string;
  reset?: { username: string; password: string };
};

export async function resetHelperPassword(
  _prev: HelperActionState,
  fd: FormData,
): Promise<HelperActionState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can do this." };
  const id = String(fd.get("profileId") ?? "");

  const admin = createAdminClient();
  const { data: p } = await admin
    .from("profile")
    .select("username, is_admin, is_owner")
    .eq("id", id)
    .maybeSingle();
  if (!p || p.is_owner || !p.is_admin) {
    return { error: "That is not a helper account." };
  }
  const password = generatePassword();
  const ok = await setAuthUserPassword(id, password);
  if (!ok) return { error: "Could not reset the password." };
  await admin.from("profile").update({ login_password: password }).eq("id", id);
  return { reset: { username: p.username as string, password } };
}

export async function removeHelper(
  _prev: HelperActionState,
  fd: FormData,
): Promise<HelperActionState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can do this." };
  const id = String(fd.get("profileId") ?? "");

  const admin = createAdminClient();
  const { data: p } = await admin
    .from("profile")
    .select("is_admin, is_owner")
    .eq("id", id)
    .maybeSingle();
  if (!p || p.is_owner || !p.is_admin) {
    return { error: "That is not a helper account." };
  }
  await deleteAuthUser(id); // cascades the profile row
  revalidatePath("/setup/helpers");
  return {};
}

export async function refreshKnockout(
  _prev: GenerateState,
  _fd: FormData,
): Promise<GenerateState> {
  void _prev;
  void _fd;
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can refresh the knockout." };
  const admin = createAdminClient();
  const { data: t } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!t) return { error: "No active tournament." };
  const result = await resolveKnockout(admin, t.id);
  if (result.error) return result;
  revalidatePath("/schedule");
  revalidatePath("/");
  return { done: true };
}

// ---------- reset: delete the tournament, its teams, logins and schedule ----------

export async function resetTournament(
  _prev: GenerateState,
  fd: FormData,
): Promise<GenerateState> {
  void _prev;
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can reset the tournament." };
  if (String(fd.get("confirmation") ?? "") !== "DELETE TEST ROSTER") {
    return { error: "Type DELETE TEST ROSTER exactly to confirm." };
  }
  const tournamentId = String(fd.get("tournamentId") ?? "");
  if (!tournamentId) return { error: "This reset page is stale. Refresh it." };

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("tournament")
    .select("id, status")
    .eq("id", tournamentId)
    .neq("status", "archived")
    .maybeSingle();
  if (!t) {
    return {
      error:
        "That test tournament no longer exists. Nothing was deleted; refresh the page.",
    };
  }

  // Grab the player accounts before the tournament (and its player rows) go.
  const { data: players, error: playersError } = await admin
    .from("player")
    .select("profile_id")
    .eq("tournament_id", t.id);
  if (playersError) {
    return {
      error:
        "Could not safely load every test login, so nothing was deleted. Try again.",
    };
  }

  // Deleting the tournament cascades its teams, players and fixtures.
  const { data: removed, error: deleteError } = await admin
    .from("tournament")
    .delete()
    .eq("id", t.id)
    .eq("status", t.status)
    .select("id");
  if (deleteError || !removed || removed.length === 0) {
    return { error: "The tournament was not deleted. Refresh and try again." };
  }

  // Delete each player's auth account (frees the username); keep the owner.
  let failedLogins = 0;
  for (const p of players ?? []) {
    if (
      p.profile_id !== ownerId &&
      !(await deleteAuthUser(p.profile_id))
    ) {
      failedLogins++;
    }
  }
  if (failedLogins > 0) {
    return {
      error: `The test tournament was deleted, but ${failedLogins} old login${failedLogins === 1 ? "" : "s"} could not be removed. Refresh, then ask for help before reusing those usernames.`,
    };
  }

  redirect("/setup");
}
