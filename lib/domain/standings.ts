import type { Fixture, TeamId } from "./types";
import { fixtureResult } from "./fixture";

export interface TeamStanding {
  teamId: TeamId;
  played: number;
  wins: number;
  losses: number;
  shotsFor: number;
  shotsAgainst: number;
  shotDiff: number;
  points: number;
  /** 1-based finishing position within the group. */
  rank: number;
}

function h2hKey(a: TeamId, b: TeamId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Compute a group table from its fixtures.
 *
 * Points: win = 1, loss = 0 (D-0004). Ranking order (FR-D3):
 *   1. points
 *   2. shot difference
 *   3. shots for
 *   4. head-to-head (only decides a clean two-way tie)
 * then, for circular / 3+ way ties (OD-10): fewest shots against, then team id
 * as a deterministic stand-in for drawn lots.
 *
 * Only fixtures whose BOTH teams are in `teamIds` count, so a partially played
 * group produces a valid (provisional) table.
 */
export function computeStandings(
  teamIds: TeamId[],
  fixtures: Fixture[],
): TeamStanding[] {
  const table = new Map<TeamId, TeamStanding>();
  for (const id of teamIds) {
    table.set(id, {
      teamId: id,
      played: 0,
      wins: 0,
      losses: 0,
      shotsFor: 0,
      shotsAgainst: 0,
      shotDiff: 0,
      points: 0,
      rank: 0,
    });
  }

  const headToHead = new Map<string, TeamId>();

  for (const fixture of fixtures) {
    if (!fixture.outcome) continue;
    const a = table.get(fixture.teamA);
    const b = table.get(fixture.teamB);
    if (!a || !b) continue; // fixture involves a team outside this group

    const result = fixtureResult(fixture);
    a.played++;
    b.played++;
    a.shotsFor += result.shotsA;
    a.shotsAgainst += result.shotsB;
    b.shotsFor += result.shotsB;
    b.shotsAgainst += result.shotsA;

    if (result.winner === fixture.teamA) {
      a.wins++;
      a.points++;
      b.losses++;
    } else {
      b.wins++;
      b.points++;
      a.losses++;
    }
    headToHead.set(h2hKey(fixture.teamA, fixture.teamB), result.winner);
  }

  for (const row of table.values()) {
    row.shotDiff = row.shotsFor - row.shotsAgainst;
  }

  const rows = [...table.values()];

  // A total, deterministic order across all numeric criteria plus a drawn-lots
  // fallback (team id). Head-to-head is applied afterwards, because as a
  // pairwise rule it can't safely sit inside a comparator for 3+ way ties.
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.shotDiff - a.shotDiff ||
      b.shotsFor - a.shotsFor ||
      a.shotsAgainst - b.shotsAgainst ||
      (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0),
  );

  // Head-to-head only decides a tie between exactly two teams level on points,
  // shot difference and shots for (FR-D3). Circular / 3+ way ties keep the
  // fewest-shots-against then drawn-lots order applied above (OD-10).
  for (let i = 0; i < rows.length - 1; ) {
    let j = i + 1;
    while (
      j < rows.length &&
      rows[j].points === rows[i].points &&
      rows[j].shotDiff === rows[i].shotDiff &&
      rows[j].shotsFor === rows[i].shotsFor
    ) {
      j++;
    }
    if (j - i === 2) {
      const winner = headToHead.get(h2hKey(rows[i].teamId, rows[i + 1].teamId));
      if (winner === rows[i + 1].teamId) {
        [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
      }
    }
    i = j;
  }

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}
