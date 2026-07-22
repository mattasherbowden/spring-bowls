import { describe, it, expect } from "vitest";
import { roundRobin } from "./round-robin";

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

describe("roundRobin", () => {
  it("FR-D1: every pair of teams meets exactly once", () => {
    const pairings = roundRobin(["A", "B", "C", "D"]);
    expect(pairings).toHaveLength(6); // 4*3/2
    const keys = pairings.map((p) => pairKey(p.teamA, p.teamB));
    expect(new Set(keys).size).toBe(6);
  });

  it("no team plays twice in the same round", () => {
    const pairings = roundRobin(["A", "B", "C", "D", "E", "F"]);
    const byRound = new Map<number, string[]>();
    for (const p of pairings) {
      const teams = byRound.get(p.round) ?? [];
      teams.push(p.teamA, p.teamB);
      byRound.set(p.round, teams);
    }
    for (const teams of byRound.values()) {
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("odd number of teams: everyone still plays everyone once", () => {
    const teams = ["A", "B", "C", "D", "E"];
    const pairings = roundRobin(teams);
    expect(pairings).toHaveLength(10); // 5*4/2
    for (const t of teams) {
      const games = pairings.filter(
        (p) => p.teamA === t || p.teamB === t,
      ).length;
      expect(games).toBe(4);
    }
  });
});
