"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fixtureResult } from "@/lib/domain/fixture";
import { validateScoreEntry } from "@/lib/domain/score-entry";
import { resolveKnockout } from "@/lib/server/knockout";
import { isBonusBowlOff } from "@/lib/domain/consolation";
import { isPlayOpen } from "@/lib/domain/play-state";

export type ScoreState = { error?: string };

const OPEN = ["scheduled", "live"];
const DONE = ["completed", "walkover"];

export async function submitScore(
  _prev: ScoreState,
  fd: FormData,
): Promise<ScoreState> {
  const fixtureId = String(fd.get("fixtureId") ?? "");
  let rawEnds: unknown;
  try {
    rawEnds = JSON.parse(String(fd.get("ends") ?? "[]"));
  } catch {
    return { error: "Could not read the scores." };
  }
  if (!fixtureId) {
    return { error: "Enter the scores for each end." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // Auth check and fixture read don't depend on each other — run together.
  const [{ data: authData }, { data: fixture }] = await Promise.all([
    supabase.auth.getUser(),
    admin
      .from("fixture")
      .select("id, tournament_id, team_a_id, team_b_id, status")
      .eq("id", fixtureId)
      .maybeSingle(),
  ]);
  const user = authData.user;
  if (!user) return { error: "Please log in again." };
  if (!fixture) return { error: "Game not found." };
  if (!OPEN.includes(fixture.status)) {
    return { error: "This game's score is already in." };
  }

  const { data: tournament, error: tournamentError } = await admin
    .from("tournament")
    .select("ends_per_game, play_status")
    .eq("id", fixture.tournament_id)
    .maybeSingle();
  if (tournamentError || !tournament) {
    return { error: "Could not load the scoring rules. Refresh and try again." };
  }
  if (!isPlayOpen(tournament.play_status)) {
    return {
      error:
        "Score entry is locked until the organiser starts the tournament.",
    };
  }
  const validated = validateScoreEntry(rawEnds, tournament.ends_per_game);
  if ("error" in validated) return { error: validated.error };
  const ends = validated.ends;

  // Authorize: a member of one of the two teams, or an admin/owner.
  const [{ data: me }, { data: prof }] = await Promise.all([
    admin
      .from("player")
      .select("team_id, role")
      .eq("tournament_id", fixture.tournament_id)
      .eq("profile_id", user.id)
      .maybeSingle(),
    admin
      .from("profile")
      .select("is_owner, is_admin, display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const isMember =
    !!me && (me.team_id === fixture.team_a_id || me.team_id === fixture.team_b_id);
  const isAdmin =
    !!prof?.is_owner || !!prof?.is_admin || me?.role === "admin";
  if (!isMember && !isAdmin) return { error: "You are not in this game." };

  // Compute the result server-side (no client-supplied winner is trusted).
  // A level game throws — a decider is required (D-0004 / threat T-01).
  let result;
  try {
    result = fixtureResult({
      id: fixture.id,
      teamA: fixture.team_a_id,
      teamB: fixture.team_b_id,
      outcome: { kind: "played", ends },
    });
  } catch (e) {
    const level = e instanceof Error && /level/i.test(e.message);
    return {
      error: level
        ? "Scores are level — add a decider end to settle it."
        : "Please check the scores.",
    };
  }

  // Atomically lock: only if still open (first submit wins — threat T-02).
  const { data: locked, error: lockError } = await admin
    .from("fixture")
    .update({
      status: "completed",
      winner_team_id: result.winner,
      shots_a: result.shotsA,
      shots_b: result.shotsB,
      locked_at: new Date().toISOString(),
      locked_by: user.id,
      entered_by: prof?.display_name ?? "a player",
    })
    .eq("id", fixtureId)
    .in("status", OPEN)
    .select("id");
  if (lockError) {
    return { error: "Could not save the score — check your signal and try again." };
  }
  if (!locked || locked.length === 0) {
    return { error: "Someone just entered this score first." };
  }

  const { error: endDeleteError } = await admin
    .from("fixture_end")
    .delete()
    .eq("fixture_id", fixtureId);
  const { error: endInsertError } = await admin.from("fixture_end").insert(
    ends.map((e, i) => ({
      fixture_id: fixtureId,
      end_number: i + 1,
      is_decider: Boolean(e.isDecider),
      shots_a: e.shotsA,
      shots_b: e.shotsB,
    })),
  );
  if (endDeleteError || endInsertError) {
    console.error("Score saved but fixture ends failed", {
      fixtureId,
      deleteError: endDeleteError?.message,
      insertError: endInsertError?.message,
    });
  }

  // Fill in any knockout slots this result now decides.
  const knockout = await resolveKnockout(admin, fixture.tournament_id);
  if (knockout.error) {
    console.error("Score saved but knockout refresh failed", {
      fixtureId,
      error: knockout.error,
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/");
  redirect(`/scored/${fixtureId}`);
}

export async function unlockFixture(
  _prev: ScoreState,
  fd: FormData,
): Promise<ScoreState> {
  const fixtureId = String(fd.get("fixtureId") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: fixture, error: fixtureError } = await admin
    .from("fixture")
    .select("tournament_id, stage, match_code, round, status")
    .eq("id", fixtureId)
    .maybeSingle();
  if (fixtureError) {
    return { error: "Could not load the game. Refresh and try again." };
  }
  if (!fixture) return { error: "Game not found." };

  const { data: me } = await admin
    .from("player")
    .select("role")
    .eq("tournament_id", fixture.tournament_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const { data: prof } = await admin
    .from("profile")
    .select("is_owner, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_owner && !prof?.is_admin && me?.role !== "admin") {
    return { error: "Only an admin can unlock a score." };
  }

  // Once a downstream knockout result exists, changing an earlier result would
  // make the already-played bracket internally inconsistent. Before knockout
  // play starts, group corrections are safe and the scheduled slots re-seed.
  const downstream = admin
    .from("fixture")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", fixture.tournament_id)
    .eq("stage", "knockout")
    .in("status", DONE);
  const downstreamResult =
    fixture.stage === "group"
      ? await downstream
      : isBonusBowlOff(fixture.match_code)
        ? { count: 0, error: null }
        : await downstream.gt("round", fixture.round ?? 0);
  if (downstreamResult.error) {
    return {
      error: "Could not check the knockout before resetting. Refresh and try again.",
    };
  }
  if ((downstreamResult.count ?? 0) > 0) {
    return {
      error:
        fixture.stage === "group"
          ? "Group results are locked because the knockout has started."
          : "This result is locked because a later knockout round has been played.",
    };
  }

  const { data: reset, error: resetError } = await admin
    .from("fixture")
    .update({
      status: "scheduled",
      winner_team_id: null,
      shots_a: null,
      shots_b: null,
      locked_at: null,
      locked_by: null,
      entered_by: null,
    })
    .eq("id", fixtureId)
    .in("status", DONE)
    .select("id");
  if (resetError) {
    return { error: "Could not reset the score — check your signal and try again." };
  }
  if (!reset || reset.length === 0) {
    return { error: "This score was already reset or changed in another tab." };
  }
  const { error: deleteError } = await admin
    .from("fixture_end")
    .delete()
    .eq("fixture_id", fixtureId);
  if (deleteError) {
    return {
      error: "Score reset, but its end-by-end detail could not be cleared.",
    };
  }

  // Re-resolve the bracket so any downstream knockout slots reflect the reset.
  const knockout = await resolveKnockout(admin, fixture.tournament_id);
  if (knockout.error) return { error: `Score reset. ${knockout.error}` };

  revalidatePath("/schedule");
  revalidatePath("/");
  redirect(`/fixture/${fixtureId}`);
}

const WALKOVER_WIN = 10;
const WALKOVER_LOSS = 0;

// Admin/owner records a walkover (a no-show or withdrawal): the present team
// wins a default 10–0. Recomputes the bracket afterwards so a no-show can't
// block the knockout from resolving.
export async function walkoverFixture(
  _prev: ScoreState,
  fd: FormData,
): Promise<ScoreState> {
  const fixtureId = String(fd.get("fixtureId") ?? "");
  const winnerTeamId = String(fd.get("winnerTeamId") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: fixture } = await admin
    .from("fixture")
    .select("tournament_id, team_a_id, team_b_id, status")
    .eq("id", fixtureId)
    .maybeSingle();
  if (!fixture) return { error: "Game not found." };
  if (!OPEN.includes(fixture.status)) {
    return { error: "This game's score is already in." };
  }

  const { data: tournament, error: tournamentError } = await admin
    .from("tournament")
    .select("play_status")
    .eq("id", fixture.tournament_id)
    .maybeSingle();
  if (tournamentError || !tournament) {
    return { error: "Could not load the tournament. Refresh and try again." };
  }
  if (!isPlayOpen(tournament.play_status)) {
    return {
      error:
        "Walkovers are locked until the organiser starts the tournament.",
    };
  }

  const { data: prof } = await admin
    .from("profile")
    .select("is_owner, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const { data: me } = await admin
    .from("player")
    .select("role")
    .eq("tournament_id", fixture.tournament_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!prof?.is_owner && !prof?.is_admin && me?.role !== "admin") {
    return { error: "Only an admin can record a walkover." };
  }

  // Winner must be one of the two known teams.
  if (
    !fixture.team_a_id ||
    !fixture.team_b_id ||
    (winnerTeamId !== fixture.team_a_id && winnerTeamId !== fixture.team_b_id)
  ) {
    return { error: "Choose one of the teams in this game." };
  }
  const aWon = winnerTeamId === fixture.team_a_id;

  const { data: locked, error: lockError } = await admin
    .from("fixture")
    .update({
      status: "walkover",
      winner_team_id: winnerTeamId,
      shots_a: aWon ? WALKOVER_WIN : WALKOVER_LOSS,
      shots_b: aWon ? WALKOVER_LOSS : WALKOVER_WIN,
      locked_at: new Date().toISOString(),
      locked_by: user.id,
      entered_by: "walkover",
    })
    .eq("id", fixtureId)
    .in("status", OPEN)
    .select("id");
  if (lockError) {
    return {
      error: "Could not record the walkover — check your signal and try again.",
    };
  }
  if (!locked || locked.length === 0) {
    return { error: "Someone entered a score for this game first." };
  }
  const { error: deleteError } = await admin
    .from("fixture_end")
    .delete()
    .eq("fixture_id", fixtureId);
  if (deleteError) {
    return { error: "Walkover saved, but old end-by-end detail could not be cleared." };
  }
  const knockout = await resolveKnockout(admin, fixture.tournament_id);
  if (knockout.error) return { error: `Walkover saved. ${knockout.error}` };

  revalidatePath("/schedule");
  revalidatePath("/");
  redirect("/schedule");
}
