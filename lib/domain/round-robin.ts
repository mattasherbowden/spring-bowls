import type { TeamId } from "./types";

export interface Pairing {
  teamA: TeamId;
  teamB: TeamId;
  /** 1-based round number. */
  round: number;
}

const BYE = "__BYE__";

/**
 * Generate a single round-robin (everyone plays everyone once) using the
 * circle method. With an odd number of teams a bye is rotated through, so a
 * team sits out exactly one round. Rounds are balanced: no team appears twice
 * in the same round (FR-D1, and the basis for the rest-gap goal FR-G3).
 */
export function roundRobin(teamIds: TeamId[]): Pairing[] {
  const teams = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.length % 2 === 1) teams.push(BYE);

  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;
  const rotation = [...teams];
  const pairings: Pairing[] = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const t1 = rotation[i];
      const t2 = rotation[n - 1 - i];
      if (t1 !== BYE && t2 !== BYE) {
        pairings.push({ teamA: t1, teamB: t2, round: r + 1 });
      }
    }
    // Rotate everyone except the fixed first element.
    rotation.splice(1, 0, rotation.pop() as TeamId);
  }

  return pairings;
}
