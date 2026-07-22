import type { Fixture, FixtureResult } from "./types";

/**
 * Resolve a completed fixture into a winner and total shots.
 *
 * Enforces decision D-0004: there are NO draws. A played game whose ends are
 * level throws — the caller must add a decider end (FR-F2) before a result
 * exists. A walkover awards the present team `shots`-to-0 (D-0005).
 */
export function fixtureResult(fixture: Fixture): FixtureResult {
  const outcome = fixture.outcome;
  if (!outcome) {
    throw new Error(`Fixture ${fixture.id} has no outcome yet`);
  }

  if (outcome.kind === "walkover") {
    const winner = outcome.winner === "A" ? fixture.teamA : fixture.teamB;
    const loser = outcome.winner === "A" ? fixture.teamB : fixture.teamA;
    return {
      winner,
      loser,
      shotsA: outcome.winner === "A" ? outcome.shots : 0,
      shotsB: outcome.winner === "B" ? outcome.shots : 0,
    };
  }

  let shotsA = 0;
  let shotsB = 0;
  for (const end of outcome.ends) {
    shotsA += end.shotsA;
    shotsB += end.shotsB;
  }

  if (shotsA === shotsB) {
    throw new Error(
      `Fixture ${fixture.id} is level at ${shotsA}-${shotsB}; a decider end is required (draws are not allowed)`,
    );
  }

  const teamAWon = shotsA > shotsB;
  return {
    winner: teamAWon ? fixture.teamA : fixture.teamB,
    loser: teamAWon ? fixture.teamB : fixture.teamA,
    shotsA,
    shotsB,
  };
}
