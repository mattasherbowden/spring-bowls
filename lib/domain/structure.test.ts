import { describe, it, expect } from "vitest";
import { splitIntoGroups, planTournament } from "./planner";
import { drawGroups, buildGroupSchedule } from "./schedule";

// Proves that for every realistic team count and setting, the generated
// structure is VALID: groups partition the teams (each 2+), the group draw
// places every team exactly once, each group is a correct round-robin, and the
// knockout is coherent. If any size could produce a broken structure, a case
// here fails.
describe("structure validity across every size", () => {
  for (let teams = 2; teams <= 40; teams++) {
    for (const pref of [3, 4, 5]) {
      for (const advance of [1, 2] as const) {
        it(`${teams} teams · groups ~${pref} · top ${advance}`, () => {
          const sizes = splitIntoGroups(teams, pref);

          // Groups partition the teams, none smaller than 2.
          expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
          expect(sizes.reduce((a, b) => a + b, 0)).toBe(teams);

          const teamIds = Array.from({ length: teams }, (_, i) => `t${i}`);
          const drawn = drawGroups(teamIds, sizes, () => 0.42);

          // Every team is placed exactly once.
          const placed = drawn.flatMap((g) => g.teamIds);
          expect(placed).toHaveLength(teams);
          expect(new Set(placed).size).toBe(teams);

          // Each group is a full round-robin within its own teams.
          const sched = buildGroupSchedule(drawn, 3);
          for (const g of drawn) {
            const gf = sched.filter((f) => f.groupLabel === g.label);
            const size = g.teamIds.length;
            expect(gf).toHaveLength((size * (size - 1)) / 2);
            expect(gf.every((f) => f.teamA !== f.teamB)).toBe(true);
            const inGroup = new Set(g.teamIds);
            expect(
              gf.every((f) => inGroup.has(f.teamA) && inGroup.has(f.teamB)),
            ).toBe(true);
          }

          // The knockout is coherent: at least one qualifier, never more than
          // the field, and Q entrants play Q-1 games (0 if there's no bracket).
          const plan = planTournament({
            teams,
            teamSize: 2,
            rinks: 3,
            endsPerGame: 2,
            minutesPerEnd: 12,
            advance,
            preferredGroupSize: pref,
          });
          expect(plan.qualifiers).toBeGreaterThanOrEqual(1);
          expect(plan.qualifiers).toBeLessThanOrEqual(teams);
          expect(plan.knockoutGames).toBe(
            plan.qualifiers >= 2 ? plan.qualifiers - 1 : 0,
          );
        });
      }
    }
  }
});
