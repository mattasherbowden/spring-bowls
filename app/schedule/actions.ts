"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeStandings,
  qualificationTieAtCutoff,
} from "@/lib/domain/standings";
import type { Fixture } from "@/lib/domain/types";
import { resolveKnockout } from "@/lib/server/knockout";

export type QualificationTieState = {
  error?: string;
  done?: boolean;
};

export async function confirmQualificationTie(
  _prev: QualificationTieState,
  fd: FormData,
): Promise<QualificationTieState> {
  const tournamentId = String(fd.get("tournamentId") ?? "");
  const groupLabel = String(fd.get("groupLabel") ?? "");
  let orderedTeamIds: string[];
  try {
    const parsed: unknown = JSON.parse(String(fd.get("orderedTeamIds") ?? "[]"));
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
      return { error: "Choose a different team for every tied position." };
    }
    orderedTeamIds = parsed;
  } catch {
    return { error: "Could not read the tie order. Refresh and try again." };
  }
  if (
    !tournamentId ||
    !/^[A-Z]+$/.test(groupLabel) ||
    orderedTeamIds.length < 2 ||
    new Set(orderedTeamIds).size !== orderedTeamIds.length
  ) {
    return { error: "Choose a different team for every tied position." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const [{ data: profile }, { data: tournament }] = await Promise.all([
    admin
      .from("profile")
      .select("is_owner, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    admin
      .from("tournament")
      .select("advance, status")
      .eq("id", tournamentId)
      .maybeSingle(),
  ]);
  if (!profile?.is_owner && !profile?.is_admin) {
    return { error: "Only an organiser can resolve a qualification tie." };
  }
  if (!tournament || tournament.status !== "live") {
    return { error: "The live tournament could not be found." };
  }

  const [{ data: teams, error: teamsError }, { data: fixtures, error: fixturesError }] =
    await Promise.all([
      admin
        .from("team")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("group_label", groupLabel),
      admin
        .from("fixture")
        .select("id, team_a_id, team_b_id, status, shots_a, shots_b")
        .eq("tournament_id", tournamentId)
        .eq("stage", "group")
        .eq("group_label", groupLabel),
    ]);
  if (teamsError || fixturesError || !teams) {
    return { error: "Could not reload the tied group. Refresh and try again." };
  }
  const expected = (teams.length * (teams.length - 1)) / 2;
  const completedRows = (fixtures ?? []).filter(
    (fixture) =>
      (fixture.status === "completed" || fixture.status === "walkover") &&
      fixture.team_a_id &&
      fixture.team_b_id &&
      fixture.shots_a != null &&
      fixture.shots_b != null,
  );
  if (completedRows.length !== expected) {
    return { error: "The group is no longer complete. Refresh the schedule." };
  }
  const domainFixtures: Fixture[] = completedRows.map((fixture) => ({
    id: fixture.id,
    teamA: fixture.team_a_id as string,
    teamB: fixture.team_b_id as string,
    outcome: {
      kind: "played",
      ends: [
        {
          shotsA: fixture.shots_a as number,
          shotsB: fixture.shots_b as number,
        },
      ],
    },
  }));
  const standings = computeStandings(
    teams.map((team) => team.id),
    domainFixtures,
  );
  const tied = qualificationTieAtCutoff(standings, tournament.advance);
  const orderedSet = new Set(orderedTeamIds);
  if (
    tied.length !== orderedTeamIds.length ||
    !tied.every((standing) => orderedSet.has(standing.teamId))
  ) {
    return {
      error:
        "Those results no longer produce the same exact tie. Refresh before deciding it.",
    };
  }

  const { error } = await admin.from("qualification_tiebreak").upsert(
    {
      tournament_id: tournamentId,
      group_label: groupLabel,
      ordered_team_ids: orderedTeamIds,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "tournament_id,group_label" },
  );
  if (error) {
    return { error: "Could not save the tie decision. Refresh and try again." };
  }

  const knockout = await resolveKnockout(admin, tournamentId);
  revalidatePath("/schedule");
  revalidatePath("/");
  if (knockout.error) {
    return { done: true, error: `Tie order saved. ${knockout.error}` };
  }
  return { done: true };
}
