import { describe, it, expect } from "vitest";
import { splitIntoGroups, planTournament, type PlanInput } from "./planner";

describe("splitIntoGroups", () => {
  it("splits into balanced groups, sizes differing by at most 1", () => {
    expect(splitIntoGroups(12, 4)).toEqual([4, 4, 4]);

    const g10 = splitIntoGroups(10, 4);
    expect(g10.reduce((a, b) => a + b, 0)).toBe(10);
    expect(g10.length).toBe(3);
    expect(Math.max(...g10) - Math.min(...g10)).toBeLessThanOrEqual(1);

    const g14 = splitIntoGroups(14, 4);
    expect(g14.reduce((a, b) => a + b, 0)).toBe(14);
    expect(g14.length).toBe(4);
    expect(Math.max(...g14) - Math.min(...g14)).toBeLessThanOrEqual(1);
  });

  it("never makes a group of one", () => {
    for (let n = 2; n <= 40; n++) {
      const groups = splitIntoGroups(n, 4);
      expect(Math.min(...groups)).toBeGreaterThanOrEqual(2);
      expect(groups.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});

describe("planTournament", () => {
  const base: PlanInput = {
    teams: 12,
    teamSize: 2,
    rinks: 3,
    endsPerGame: 2,
    minutesPerEnd: 10,
    advance: 2,
    preferredGroupSize: 4,
  };

  it("counts group and knockout games for 12 teams, top 2", () => {
    const p = planTournament(base);
    expect(p.groups).toEqual([4, 4, 4]);
    expect(p.groupGames).toBe(18); // 3 groups x 6
    expect(p.qualifiers).toBe(6); // 3 groups x top 2
    expect(p.knockoutGames).toBe(5); // 6 entrants -> 5 games
    expect(p.knockoutRounds).toBe(3);
    expect(p.byes).toBe(2); // bracket of 8 minus 6
    expect(p.totalGames).toBe(23);
    expect(p.fixturesPerTeam).toEqual({ min: 3, max: 3 });
    expect(p.headcount).toBe(24);
  });

  it("estimates duration from rinks and game length", () => {
    const p = planTournament(base);
    // gameMinutes = 2*10 = 20; group waves ceil(18/3)=6 -> 120; knockout 3 -> 60
    expect(p.gameMinutes).toBe(20);
    expect(p.estMinutes).toBe(180);
  });

  it("top-1 advancement yields fewer qualifiers and rounds", () => {
    const p = planTournament({ ...base, advance: 1 });
    expect(p.qualifiers).toBe(3);
    expect(p.knockoutGames).toBe(2); // 3 -> 2 -> 1
    expect(p.knockoutRounds).toBe(2);
  });

  it("more rinks shortens the estimate", () => {
    const few = planTournament({ ...base, rinks: 2 });
    const many = planTournament({ ...base, rinks: 6 });
    expect(many.estMinutes).toBeLessThan(few.estMinutes);
  });

  it("warns about a degenerate single-group draw", () => {
    const p = planTournament({ ...base, teams: 5, preferredGroupSize: 4 });
    expect(p.groups).toEqual([5]);
    expect(p.warnings.some((w) => /one group/i.test(w))).toBe(true);
  });

  it("a healthy 12-team plan has no warnings", () => {
    expect(planTournament(base).warnings).toEqual([]);
  });
});
