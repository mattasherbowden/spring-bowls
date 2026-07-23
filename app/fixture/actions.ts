"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fixtureResult } from "@/lib/domain/fixture";
import { resolveKnockout } from "@/lib/server/knockout";
import type { EndScore } from "@/lib/domain/types";

export type ScoreState = { error?: string };

const OPEN = ["scheduled", "live"];

function parseEnds(raw: string): EndScore[] {
  const parsed = JSON.parse(raw) as Array<{
    shotsA?: unknown;
    shotsB?: unknown;
    isDecider?: unknown;
  }>;
  return parsed.map((e) => ({
    shotsA: Math.max(0, Math.floor(Number(e.shotsA) || 0)),
    shotsB: Math.max(0, Math.floor(Number(e.shotsB) || 0)),
    isDecider: Boolean(e.isDecider),
  }));
}

export async function submitScore(
  _prev: ScoreState,
  fd: FormData,
): Promise<ScoreState> {
  const fixtureId = String(fd.get("fixtureId") ?? "");
  let ends: EndScore[];
  try {
    ends = parseEnds(String(fd.get("ends") ?? "[]"));
  } catch {
    return { error: "Could not read the scores." };
  }
  if (!fixtureId || ends.length === 0) {
    return { error: "Enter the scores for each end." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: fixture } = await admin
    .from("fixture")
    .select("id, tournament_id, team_a_id, team_b_id, status")
    .eq("id", fixtureId)
    .maybeSingle();
  if (!fixture) return { error: "Game not found." };
  if (!OPEN.includes(fixture.status)) {
    return { error: "This game's score is already in." };
  }

  // Authorize: a member of one of the two teams, or an admin/owner.
  const { data: me } = await admin
    .from("player")
    .select("team_id, role")
    .eq("tournament_id", fixture.tournament_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const { data: prof } = await admin
    .from("profile")
    .select("is_owner, display_name")
    .eq("id", user.id)
    .maybeSingle();
  const isMember =
    !!me && (me.team_id === fixture.team_a_id || me.team_id === fixture.team_b_id);
  const isAdmin = !!prof?.is_owner || me?.role === "admin";
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
  const { data: locked } = await admin
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
  if (!locked || locked.length === 0) {
    return { error: "Someone just entered this score first." };
  }

  await admin.from("fixture_end").delete().eq("fixture_id", fixtureId);
  await admin.from("fixture_end").insert(
    ends.map((e, i) => ({
      fixture_id: fixtureId,
      end_number: i + 1,
      is_decider: Boolean(e.isDecider),
      shots_a: e.shotsA,
      shots_b: e.shotsB,
    })),
  );

  // Fill in any knockout slots this result now decides.
  await resolveKnockout(admin, fixture.tournament_id);

  revalidatePath("/schedule");
  redirect("/schedule");
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
  const { data: fixture } = await admin
    .from("fixture")
    .select("tournament_id")
    .eq("id", fixtureId)
    .maybeSingle();
  if (!fixture) return { error: "Game not found." };

  const { data: me } = await admin
    .from("player")
    .select("role")
    .eq("tournament_id", fixture.tournament_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const { data: prof } = await admin
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_owner && me?.role !== "admin") {
    return { error: "Only an admin can unlock a score." };
  }

  await admin
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
    .eq("id", fixtureId);
  await admin.from("fixture_end").delete().eq("fixture_id", fixtureId);

  revalidatePath("/schedule");
  redirect(`/fixture/${fixtureId}`);
}
