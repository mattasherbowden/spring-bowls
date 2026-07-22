import { describe, it, expect } from "vitest";
import { computeStandings, type TeamStanding } from "./standings";
import type { Fixture, TeamId } from "./types";

function game(
  id: string,
  a: TeamId,
  b: TeamId,
  ends: [number, number][],
): Fixture {
  return {
    id,
    teamA: a,
    teamB: b,
    outcome: {
      kind: "played",
      ends: ends.map(([shotsA, shotsB]) => ({ shotsA, shotsB })),
    },
  };
}

function walkover(
  id: string,
  a: TeamId,
  b: TeamId,
  winner: "A" | "B",
  shots = 10,
): Fixture {
  return { id, teamA: a, teamB: b, outcome: { kind: "walkover", winner, shots } };
}

function row(rows: TeamStanding[], id: TeamId): TeamStanding {
  const r = rows.find((x) => x.teamId === id);
  if (!r) throw new Error(`no row for ${id}`);
  return r;
}

describe("computeStandings", () => {
  it("FR-D2: a win scores 1 point, a loss 0", () => {
    const rows = computeStandings(["A", "B"], [game("g", "A", "B", [[6, 2]])]);
    expect(row(rows, "A")).toMatchObject({ points: 1, wins: 1, rank: 1 });
    expect(row(rows, "B")).toMatchObject({ points: 0, losses: 1, rank: 2 });
  });

  it("FR-D3: shot difference outranks shots-for", () => {
    // A finishes +4 on 8 shots-for; B finishes +2 on 14 shots-for. The correct
    // order is A above B. This test FAILS if shots-for is compared before shot
    // difference (a mutation guard on the tiebreak order).
    const rows = computeStandings(
      ["A", "B", "C", "D"],
      [
        game("1", "A", "C", [[5, 0]]),
        game("2", "D", "A", [[4, 3]]),
        game("3", "B", "C", [[12, 9]]),
        game("4", "D", "B", [[3, 2]]),
      ],
    );
    expect(row(rows, "D").rank).toBe(1);
    expect(row(rows, "A").rank).toBeLessThan(row(rows, "B").rank);
    expect(row(rows, "A").shotDiff).toBe(4);
    expect(row(rows, "B").shotDiff).toBe(2);
    expect(row(rows, "A").shotsFor).toBeLessThan(row(rows, "B").shotsFor);
  });

  it("FR-D3: shots-for then head-to-head break the deepest ties", () => {
    // All three are level on points (1) and shot difference (0). C leads on
    // shots-for (12). A and B are level on shots-for too (11); A beat B head to
    // head, so A must rank above B.
    const rows = computeStandings(
      ["A", "B", "C"],
      [
        game("1", "A", "B", [[7, 3]]),
        game("2", "C", "A", [[8, 4]]),
        game("3", "B", "C", [[8, 4]]),
      ],
    );
    expect(rows.map((r) => r.teamId)).toEqual(["C", "A", "B"]);
  });

  it("D-0005: walkover shots feed the shot difference", () => {
    const rows = computeStandings(["A", "B"], [walkover("g", "A", "B", "A", 10)]);
    expect(row(rows, "A")).toMatchObject({ points: 1, shotDiff: 10, rank: 1 });
    expect(row(rows, "B")).toMatchObject({ points: 0, shotDiff: -10, rank: 2 });
  });
});
