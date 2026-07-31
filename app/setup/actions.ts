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
import {
  generatePassword,
  suggestUsername,
  themedPasswordCandidates,
  type LoginNationality,
} from "@/lib/domain/credentials";
import { splitIntoGroups } from "@/lib/domain/planner";
import { drawGroups, buildGroupSchedule } from "@/lib/domain/schedule";
import { assignPhotoPartners } from "@/lib/domain/photo";
import { resolveKnockout } from "@/lib/server/knockout";
import { isPlayOpen } from "@/lib/domain/play-state";

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
    fixtures_open_time: String(fd.get("fixturesOpenTime") || "13:00"),
    play_status: "preview",
    created_by: ownerId,
  });
  if (error) return { error: `Could not create the tournament: ${error.message}` };
  redirect("/setup/teams");
}

// ---------- start play (unlock score entry and Bowl of the Day voting) ----------

export type StartPlayState = { error?: string; done?: boolean };

export async function startTournamentPlay(
  _prev: StartPlayState,
  _fd: FormData,
): Promise<StartPlayState> {
  void _prev;
  void _fd;
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can start the tournament." };

  const admin = createAdminClient();
  const { data: tournament, error: tournamentError } = await admin
    .from("tournament")
    .select("id, status, play_status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (tournamentError || !tournament) {
    return { error: "Could not load the tournament. Refresh and try again." };
  }
  if (tournament.status !== "live") {
    return { error: "Generate the draw before starting play." };
  }
  if (isPlayOpen(tournament.play_status)) return { done: true };

  const { error } = await admin.rpc("start_tournament_play", {
    p_tournament_id: tournament.id,
  });
  if (error) {
    if (/play_not_live/.test(error.message)) {
      return {
        error:
          "The preview is being edited, so play was not opened. Publish the new draw first.",
      };
    }
    return {
      error: "Could not start play — check your signal and try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/awards");
  revalidatePath("/setup/teams");
  return { done: true };
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

export type EditTeamState = {
  error?: string;
  done?: boolean;
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

async function uniqueThemedPassword(
  admin: SupabaseClient,
  nationality: LoginNationality,
): Promise<string> {
  const candidates = themedPasswordCandidates(nationality);
  const { data, error } = await admin
    .from("profile")
    .select("login_password")
    .not("login_password", "is", null);
  if (error) {
    throw new Error("the password list could not be checked");
  }
  const used = new Set(
    (data ?? [])
      .map((profile) => profile.login_password)
      .filter((password): password is string => !!password),
  );
  const available = candidates.find((candidate) => !used.has(candidate));
  if (available) return available;

  // This should only happen after dozens of players of one nationality. Keep
  // the memorable base and add enough entropy to remain unique.
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = String(Math.floor(Math.random() * 9000) + 1000);
    const candidate = `${candidates[0]}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("a unique themed password could not be generated");
}

const SUBMISSION_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function completedTeamSubmission(
  admin: SupabaseClient,
  tournamentId: string,
  submitKey: string,
  teamSize: number,
): Promise<AddTeamState["created"] | null> {
  // A simultaneous retry can see the reserved team before the first request
  // has finished creating its Auth users. Wait briefly for that request, then
  // reconstruct the same one-time credentials from the deliberately retained
  // event-login fields.
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data: team } = await admin
      .from("team")
      .select("id, name")
      .eq("tournament_id", tournamentId)
      .eq("submit_key", submitKey)
      .maybeSingle();
    if (!team) return null;

    const { data: existingPlayers } = await admin
      .from("player")
      .select("display_name, profile_id")
      .eq("tournament_id", tournamentId)
      .eq("team_id", team.id);
    if (existingPlayers?.length === teamSize) {
      const profileIds = existingPlayers.map((player) => player.profile_id);
      const { data: profiles } = await admin
        .from("profile")
        .select("id, username, login_password, is_owner")
        .in("id", profileIds);
      if (profiles?.length === teamSize) {
        const byId = new Map(profiles.map((profile) => [profile.id, profile]));
        const players: CreatedPlayer[] = [];
        let complete = true;
        for (const player of existingPlayers) {
          const profile = byId.get(player.profile_id);
          if (!profile?.username) {
            complete = false;
            break;
          }
          if (profile.is_owner) {
            players.push({
              displayName: player.display_name,
              username: "— your organiser login —",
              password: "",
            });
          } else if (profile.login_password) {
            players.push({
              displayName: player.display_name,
              username: profile.username,
              password: profile.login_password,
            });
          } else {
            complete = false;
            break;
          }
        }
        if (complete) {
          return {
            teamName:
              team.name ?? players.map((player) => player.displayName).join(" & "),
            players,
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
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

  const submitKey = String(fd.get("submitKey") ?? "").trim();
  if (!SUBMISSION_KEY.test(submitKey)) {
    return {
      error: "This roster form is stale. Refresh it before adding the team.",
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
  if (players.some((player) => player.nationality === null)) {
    return { error: "Choose Brit or Kiwi for every player." };
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

  const { data: teamId, error: teamErr } = await admin.rpc(
    "create_setup_team",
    {
      p_tournament_id: tournament.id,
      p_team_name: teamName ?? "",
      p_submit_key: submitKey,
    },
  );
  if (
    teamErr?.code === "23505" &&
    /team_submit_key_unique|submit_key/i.test(teamErr.message)
  ) {
    const existing = await completedTeamSubmission(
      admin,
      tournament.id,
      submitKey,
      teamSize,
    );
    if (existing) {
      revalidatePath("/setup/teams");
      revalidatePath("/setup/logins");
      return { created: existing };
    }
    return {
      error:
        "That team is already being added. Wait a moment, then submit again if it does not appear.",
    };
  }
  if (/roster_locked/.test(teamErr?.message ?? "")) {
    return {
      error:
        "The draw was published while this team was being added. Nothing was saved.",
    };
  }
  if (teamErr || !teamId) return { error: "Could not create the team." };
  const team = { id: String(teamId) };

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
      const password = await uniqueThemedPassword(
        admin,
        p.nationality as LoginNationality,
      );
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
  revalidatePath("/setup/logins");
  return {
    created: {
      teamName: teamName ?? output.map((o) => o.displayName).join(" & "),
      players: output,
    },
  };
}

// ---------- edit/remove a team before the draw; rename during preview ----------

type TeamEditPlayer = {
  id: string;
  displayName: string;
  nationality: "brit" | "kiwi";
};

function parseTeamEditPlayers(value: FormDataEntryValue | null):
  | { players: TeamEditPlayer[] }
  | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(value ?? "[]"));
  } catch {
    return { error: "Could not read the player details." };
  }
  if (!Array.isArray(raw)) {
    return { error: "Could not read the player details." };
  }
  const players: TeamEditPlayer[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { error: "Check every player name and nationality." };
    }
    const id = String((entry as { id?: unknown }).id ?? "");
    const displayName = String(
      (entry as { displayName?: unknown }).displayName ?? "",
    ).trim();
    const nationality = String(
      (entry as { nationality?: unknown }).nationality ?? "",
    );
    if (!id || displayName.length < 1 || displayName.length > 60) {
      return { error: "Every player needs a name of 1–60 characters." };
    }
    if (nationality !== "brit" && nationality !== "kiwi") {
      return { error: "Choose Brit or Kiwi for every player." };
    }
    players.push({ id, displayName, nationality });
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    return { error: "The same player appeared twice. Refresh and try again." };
  }
  return { players };
}

export async function updateTeam(
  _prev: EditTeamState,
  fd: FormData,
): Promise<EditTeamState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can edit teams." };

  const tournamentId = String(fd.get("tournamentId") ?? "");
  const teamId = String(fd.get("teamId") ?? "");
  const teamName = String(fd.get("teamName") ?? "").trim();
  if (!tournamentId || !teamId) {
    return { error: "This roster page is stale. Refresh and try again." };
  }
  if (teamName.length > 80) {
    return { error: "Keep the team name to 80 characters or fewer." };
  }
  const parsed = parseTeamEditPlayers(fd.get("players"));
  if ("error" in parsed) return parsed;

  const admin = createAdminClient();
  const { data: tournament, error: tournamentError } = await admin
    .from("tournament")
    .select("team_size, status, play_status, voting_status")
    .eq("id", tournamentId)
    .maybeSingle();
  if (tournamentError || !tournament) {
    return { error: "Could not load the tournament. Refresh and try again." };
  }
  if (parsed.players.length !== tournament.team_size) {
    return { error: `This team must contain ${tournament.team_size} players.` };
  }

  const setupEdit = tournament.status === "setup";
  const previewEdit =
    tournament.status === "live" &&
    tournament.play_status === "preview" &&
    tournament.voting_status === "pending";
  if (!setupEdit && !previewEdit) {
    return {
      error:
        "Play or voting has started, so player details can no longer be changed here.",
    };
  }

  const { error } = await admin.rpc(
    setupEdit ? "update_setup_team" : "update_published_preview_team",
    {
      p_tournament_id: tournamentId,
      p_team_id: teamId,
      p_team_name: teamName,
      p_players: parsed.players.map((player) => ({
        id: player.id,
        display_name: player.displayName,
        nationality: player.nationality,
      })),
    },
  );
  if (error) {
    if (/roster_locked|preview_roster_locked/.test(error.message)) {
      return {
        error:
          "The tournament state changed while you were editing, so nothing was saved. Refresh and try again.",
      };
    }
    if (/preview_roster_activity_exists/.test(error.message)) {
      return {
        error:
          "A score or vote now exists, so this replacement was not saved.",
      };
    }
    return {
      error: `Nothing was changed. Refresh and try again (${error.message}).`,
    };
  }
  revalidatePath("/setup/teams");
  revalidatePath("/setup/logins");
  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/awards");
  revalidatePath("/photo");
  return { done: true };
}

export async function removeTeam(
  _prev: EditTeamState,
  fd: FormData,
): Promise<EditTeamState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return { error: "Only the owner can remove teams." };

  const tournamentId = String(fd.get("tournamentId") ?? "");
  const teamId = String(fd.get("teamId") ?? "");
  if (!tournamentId || !teamId) {
    return { error: "This roster page is stale. Refresh and try again." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("delete_setup_team", {
    p_tournament_id: tournamentId,
    p_team_id: teamId,
  });
  if (error) {
    if (/roster_locked/.test(error.message)) {
      return { error: "The draw just went live, so the team was not removed." };
    }
    return {
      error: `The team was not removed. Refresh and try again (${error.message}).`,
    };
  }

  let failedLogins = 0;
  for (const row of (data ?? []) as { profile_id: string }[]) {
    if (!(await deleteAuthUser(row.profile_id))) failedLogins++;
  }
  revalidatePath("/setup/teams");
  revalidatePath("/setup/logins");
  revalidatePath("/");
  if (failedLogins > 0) {
    return {
      done: true,
      error: `The team was removed, but ${failedLogins} old login${failedLogins === 1 ? "" : "s"} could not be deleted. Do not reuse those usernames yet.`,
    };
  }
  return { done: true };
}

// ---------- generate the schedule (auto-draw the groups and lock) ----------

export type GenerateState = { error?: string; done?: boolean };

export type PreviewEditState = { error?: string; done?: boolean };

function revalidateTournamentViews() {
  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/awards");
  revalidatePath("/photo");
  revalidatePath("/setup/teams");
  revalidatePath("/setup/logins");
}

export async function reopenPreviewForEditing(
  _prev: PreviewEditState,
  fd: FormData,
): Promise<PreviewEditState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) {
    return { error: "Only the owner can edit the tournament preview." };
  }

  const tournamentId = String(fd.get("tournamentId") ?? "");
  if (!tournamentId) {
    return { error: "This preview page is stale. Refresh and try again." };
  }

  const admin = createAdminClient();
  const { data: tournament, error: loadError } = await admin
    .from("tournament")
    .select("id, status, play_status")
    .eq("id", tournamentId)
    .neq("status", "archived")
    .maybeSingle();
  if (loadError || !tournament) {
    return { error: "Could not load the active tournament. Refresh and try again." };
  }
  if (
    tournament.status === "setup" &&
    tournament.play_status === "preview"
  ) {
    revalidateTournamentViews();
    return { done: true };
  }

  const { error } = await admin.rpc("reopen_tournament_preview", {
    p_tournament_id: tournamentId,
  });
  if (error) {
    if (/preview_edit_play_open/.test(error.message)) {
      return {
        error:
          "Play has already started, so the draw can no longer be reopened.",
      };
    }
    if (/preview_edit_voting_started|preview_edit_votes_exist/.test(error.message)) {
      return {
        error:
          "Voting has already started, so the draw can no longer be reopened.",
      };
    }
    if (/preview_edit_results_exist/.test(error.message)) {
      return {
        error:
          "A result or live game already exists, so the draw can no longer be reopened.",
      };
    }
    if (/preview_edit_not_live/.test(error.message)) {
      return {
        error:
          "The preview changed while you were editing. Refresh before trying again.",
      };
    }
    return {
      error: `The preview was not changed. Refresh and try again (${error.message}).`,
    };
  }

  revalidateTournamentViews();
  return { done: true };
}

export async function updateSetupRinks(
  _prev: PreviewEditState,
  fd: FormData,
): Promise<PreviewEditState> {
  const ownerId = await currentOwnerId();
  if (!ownerId) {
    return { error: "Only the owner can change the number of rinks." };
  }

  const tournamentId = String(fd.get("tournamentId") ?? "");
  const rinkCount = Number(fd.get("rinkCount"));
  if (!tournamentId) {
    return { error: "This setup page is stale. Refresh and try again." };
  }
  if (!Number.isInteger(rinkCount) || rinkCount < 1 || rinkCount > 20) {
    return { error: "Enter a whole number of rinks from 1 to 20." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("update_tournament_setup_settings", {
    p_tournament_id: tournamentId,
    p_rink_count: rinkCount,
  });
  if (error) {
    if (/roster_locked/.test(error.message)) {
      return {
        error:
          "The draw was published while you were editing. Reopen the preview before changing rinks.",
      };
    }
    return {
      error: `The rink count was not changed. Refresh and try again (${error.message}).`,
    };
  }

  revalidateTournamentViews();
  return { done: true };
}

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
  const { error: drawError } = await admin.rpc("apply_tournament_draw_v2", {
    p_tournament_id: t.id,
    p_expected_rink_count: t.rink_count,
    p_expected_preferred_group_size: t.preferred_group_size,
    p_assignments: assignments,
    p_fixtures: rows,
  });
  if (drawError) {
    if (/draw_already_live|fixtures_already_exist/.test(drawError.message)) {
      redirect("/schedule");
    }
    if (/draw_settings_changed/.test(drawError.message)) {
      return {
        error:
          "The number of rinks changed while the draw was being prepared. Nothing was published — press the button again.",
      };
    }
    if (/draw_roster_incomplete/.test(drawError.message)) {
      return {
        error:
          "A team login is still being created. Nothing was published — wait a moment and press the button again.",
      };
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
