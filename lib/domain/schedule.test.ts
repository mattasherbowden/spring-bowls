import { describe, it, expect } from "vitest";
import { drawGroups, buildGroupSchedule } from "./schedule";

describe("drawGroups", () => {
  it("assigns every team once into labelled groups of the given sizes", () => {
    const teams = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const groups = drawGroups(teams, [4, 4, 4], () => 0.5);
    expect(groups.map((g) => g.label)).toEqual(["A", "B", "C"]);
    expect(groups.map((g) => g.teamIds.length)).toEqual([4, 4, 4]);
    const all = groups.flatMap((g) => g.teamIds);
    expect(new Set(all).size).toBe(12);
    expect([...all].sort()).toEqual([...teams].sort());
  });

  it("handles uneven group sizes", () => {
    const teams = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const groups = drawGroups(teams, [4, 3, 3]);
    expect(groups.map((g) => g.teamIds.length)).toEqual([4, 3, 3]);
    expect(new Set(groups.flatMap((g) => g.teamIds)).size).toBe(10);
  });
});

describe("buildGroupSchedule", () => {
  const groups = [
    { label: "A", teamIds: ["a1", "a2", "a3", "a4"] },
    { label: "B", teamIds: ["b1", "b2", "b3", "b4"] },
  ];

  it("creates each group's round-robin, scheduled across rinks", () => {
    const sched = buildGroupSchedule(groups, 2);
    expect(sched).toHaveLength(12); // 2 groups x 6
    expect(new Set(sched.map((f) => f.order)).size).toBe(12);
    expect(Math.max(...sched.map((f) => f.order))).toBe(11);
    expect(sched.every((f) => f.rink >= 1 && f.rink <= 2)).toBe(true);

    for (const label of ["A", "B"]) {
      const g = sched.filter((f) => f.groupLabel === label);
      expect(g).toHaveLength(6);
      const pairs = new Set(g.map((f) => [f.teamA, f.teamB].sort().join("-")));
      expect(pairs.size).toBe(6);
    }
  });

  it("no team plays twice within the same round", () => {
    const sched = buildGroupSchedule(groups, 4);
    const byRound = new Map<number, string[]>();
    for (const f of sched) {
      const arr = byRound.get(f.round) ?? [];
      arr.push(f.teamA, f.teamB);
      byRound.set(f.round, arr);
    }
    for (const teams of byRound.values()) {
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("never puts a team on two rinks in the same time wave", () => {
    const rinks = 3;
    const sched = buildGroupSchedule(groups, rinks);
    const byWave = new Map<number, string[]>();
    for (const fixture of sched) {
      const wave = Math.floor(fixture.order / rinks);
      const teams = byWave.get(wave) ?? [];
      teams.push(fixture.teamA, fixture.teamB);
      byWave.set(wave, teams);
      expect(fixture.rink).toBe((fixture.order % rinks) + 1);
    }
    for (const teams of byWave.values()) {
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("packs the live 8-team shape into four valid waves", () => {
    const sched = buildGroupSchedule(groups, 3);
    expect(new Set(sched.map((f) => Math.floor(f.order / 3))).size).toBe(4);
  });

  it("keeps each team's rounds in order even for odd-sized groups", () => {
    const sched = buildGroupSchedule(
      [
        { label: "A", teamIds: ["a1", "a2", "a3", "a4", "a5"] },
        { label: "B", teamIds: ["b1", "b2", "b3"] },
      ],
      3,
    );
    for (const team of ["a1", "a2", "a3", "a4", "a5", "b1", "b2", "b3"]) {
      const rounds = sched
        .filter((f) => f.teamA === team || f.teamB === team)
        .sort((a, b) => a.order - b.order)
        .map((f) => f.round);
      expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
    }
  });
});
