import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStandings } from "@/lib/domain/standings";
import { buildBracket } from "@/lib/domain/bracket";
import type { Fixture } from "@/lib/domain/types";

export type KnockoutResolution = { error?: string };

// Ensure the knockout fixtures exist and fill in real teams as groups (and
// earlier knockout rounds) finish. Idempotent — safe to call after every score.
export async function resolveKnockout(
  admin: SupabaseClient,
  tournamentId: string,
): Promise<KnockoutResolution> {
  const koSelect =
    "id, match_code, team_a_source, team_b_source, team_a_id, team_b_id, status, winner_team_id";

  // These four reads are independent — fetch them together to cut round-trips.
  const [tResult, teamsResult, groupFxResult, koResult] = await Promise.all([
    admin
      .from("tournament")
      .select("advance, rink_count")
      .eq("id", tournamentId)
      .maybeSingle(),
    admin
      .from("team")
      .select("id, group_label")
      .eq("tournament_id", tournamentId),
    admin
      .from("fixture")
      .select("group_label, team_a_id, team_b_id, status, shots_a, shots_b")
      .eq("tournament_id", tournamentId)
      .eq("stage", "group"),
    admin
      .from("fixture")
      .select(koSelect)
      .eq("tournament_id", tournamentId)
      .eq("stage", "knockout")
      .order("round", { ascending: true })
      .order("match_code", { ascending: true }),
  ]);
  const readError =
    tResult.error ?? teamsResult.error ?? groupFxResult.error ?? koResult.error;
  if (readError) {
    return { error: `Could not load the knockout data: ${readError.message}` };
  }
  const t = tResult.data;
  if (!t) return { error: "Tournament not found while refreshing the knockout." };
  const advance = t.advance as number;
  const rinkCount = Math.max(1, t.rink_count as number);

  const teams = teamsResult.data ?? [];
  const groupLabels = [
    ...new Set(teams.map((x) => x.group_label).filter((l): l is string => !!l)),
  ].sort();
  if (groupLabels.length === 0) return {};

  const groupSize = new Map<string, number>();
  for (const tm of teams) {
    if (tm.group_label)
      groupSize.set(tm.group_label, (groupSize.get(tm.group_label) ?? 0) + 1);
  }

  const groupFixtures = groupFxResult.data ?? [];
  let knockout = koResult.data ?? [];

  // Create the bracket the first time.
  if (knockout.length === 0) {
    const qualifierLabels: string[] = [];
    for (let pos = 1; pos <= advance; pos++) {
      for (const g of groupLabels) {
        if ((groupSize.get(g) ?? 0) >= pos) qualifierLabels.push(`${g}${pos}`);
      }
    }
    const rounds = buildBracket(qualifierLabels);
    if (rounds.length === 0) return {};
    const rows = rounds.flatMap((r, ri) =>
      r.matches
        // A one-sided first-round match is a bye, not a game. buildBracket has
        // already carried that source into the next round.
        .filter((m) => m.a !== null && m.b !== null)
        .map((m) => ({
          tournament_id: tournamentId,
          stage: "knockout",
          match_code: m.id,
          round: ri + 1,
          team_a_source: m.a,
          team_b_source: m.b,
          status: "pending",
          order_index: 1000 + ri * 100,
        })),
    );
    const { error: insertError } = await admin.from("fixture").insert(rows);
    // Two simultaneous final group scores may both create the bracket. The
    // unique index makes one lose harmlessly; any other insert error matters.
    if (insertError && insertError.code !== "23505") {
      return { error: `Could not create the knockout: ${insertError.message}` };
    }
    const reload = await admin
      .from("fixture")
      .select(koSelect)
      .eq("tournament_id", tournamentId)
      .eq("stage", "knockout")
      .order("round", { ascending: true })
      .order("match_code", { ascending: true });
    if (reload.error) {
      return { error: `Could not reload the knockout: ${reload.error.message}` };
    }
    knockout = reload.data ?? [];
  }

  // Rankings for groups that are fully played.
  const groupRank = new Map<string, string[]>();
  for (const g of groupLabels) {
    const gFixtures = groupFixtures.filter((f) => f.group_label === g);
    const size = groupSize.get(g) ?? 0;
    const expected = (size * (size - 1)) / 2;
    if (
      gFixtures.filter(
        (f) => f.status === "completed" || f.status === "walkover",
      ).length < expected
    ) {
      continue;
    }
    const domain: Fixture[] = gFixtures
      .filter(
        (f) =>
          (f.status === "completed" || f.status === "walkover") &&
          f.team_a_id &&
          f.team_b_id &&
          f.shots_a != null &&
          f.shots_b != null,
      )
      .map((f) => ({
        id: "x",
        teamA: f.team_a_id as string,
        teamB: f.team_b_id as string,
        outcome: {
          kind: "played",
          ends: [{ shotsA: f.shots_a as number, shotsB: f.shots_b as number }],
        },
      }));
    const groupTeamIds = teams
      .filter((tm) => tm.group_label === g)
      .map((tm) => tm.id);
    groupRank.set(
      g,
      computeStandings(groupTeamIds, domain).map((r) => r.teamId),
    );
  }

  const matchWinner = new Map<string, string>();
  for (const k of knockout) {
    if (
      (k.status === "completed" || k.status === "walkover") &&
      k.winner_team_id &&
      k.match_code
    ) {
      matchWinner.set(k.match_code, k.winner_team_id);
    }
  }

  const resolveSrc = (src: string | null): string | null => {
    if (!src) return null;
    if (src.startsWith("W:")) return matchWinner.get(src.slice(2)) ?? null;
    const m = src.match(/^([A-Z])(\d+)$/);
    if (m) return groupRank.get(m[1])?.[Number(m[2]) - 1] ?? null;
    return null;
  };

  // Never silently rewrite history. This can only happen if an upstream group
  // or knockout result changed after a dependent knockout game was completed
  // (or in a very tight correction race). Leave every row untouched and make
  // the inconsistency visible to the caller.
  const completedConflicts = knockout.filter((k) => {
    if (k.status !== "completed" && k.status !== "walkover") return false;
    const a = resolveSrc(k.team_a_source);
    const b = resolveSrc(k.team_b_source);
    return (
      (a !== null && k.team_a_id !== null && a !== k.team_a_id) ||
      (b !== null && k.team_b_id !== null && b !== k.team_b_id)
    );
  });
  if (completedConflicts.length > 0) {
    return {
      error:
        "A completed knockout game no longer matches its source result. No bracket teams were changed; an organiser must review the correction.",
    };
  }

  let scheduledCount = knockout.filter((k) => k.status !== "pending").length;

  const writes = [];
  for (const k of knockout) {
    if (k.status === "completed" || k.status === "walkover") continue;
    const a = resolveSrc(k.team_a_source);
    const b = resolveSrc(k.team_b_source);
    const update: Record<string, unknown> = {};
    // Only ever fill a slot with a resolved team; never wipe an already-set
    // team back to null because its source became transiently unresolvable
    // (e.g. a group game was unlocked to correct a score). It re-fills once the
    // source resolves again.
    if (a && a !== k.team_a_id) update.team_a_id = a;
    if (b && b !== k.team_b_id) update.team_b_id = b;
    if (a && b && k.status === "pending") {
      update.status = "scheduled";
      update.rink = (scheduledCount % rinkCount) + 1;
      update.order_index = 1000 + scheduledCount;
      scheduledCount++;
    }
    if (Object.keys(update).length > 0) {
      writes.push(
        admin
          .from("fixture")
          .update(update)
          .eq("id", k.id)
          // Never rewrite teams on a result that completed after our snapshot.
          .in("status", ["pending", "scheduled"]),
      );
    }
  }
  const results = await Promise.all(writes);
  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    return {
      error: `Could not fill ${failures.length} knockout slot${failures.length === 1 ? "" : "s"} — refresh the knockout and try again.`,
    };
  }
  return {};
}
