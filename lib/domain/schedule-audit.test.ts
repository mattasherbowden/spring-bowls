import { describe, expect, it } from "vitest";
import {
  auditGroupSchedule,
  auditKnockoutSchedule,
  type AuditKnockoutFixture,
} from "./schedule-audit";
import { buildGroupSchedule } from "./schedule";

const teams = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].map(
  (id) => ({
    id,
    name: id.toUpperCase(),
    groupLabel: id[0].toUpperCase(),
  }),
);
const groups = [
  { label: "A", teamIds: ["a1", "a2", "a3", "a4"] },
  { label: "B", teamIds: ["b1", "b2", "b3", "b4"] },
];

function validFixtures() {
  return buildGroupSchedule(groups, 3).map((fixture, index) => ({
    id: `f${index}`,
    groupLabel: fixture.groupLabel,
    round: fixture.round,
    rink: fixture.rink,
    order: fixture.order,
    teamA: fixture.teamA,
    teamB: fixture.teamB,
  }));
}

describe("auditGroupSchedule", () => {
  it("accepts a complete, conflict-free draw", () => {
    const audit = auditGroupSchedule(teams, validFixtures(), 3);
    expect(audit.issues).toEqual([]);
    expect(audit.waveCount).toBe(4);
  });

  it("detects physical double-booking even when all pairs are valid", () => {
    const fixtures = validFixtures();
    const anchor = fixtures[0];
    const targetIndex = fixtures.findIndex(
      (fixture, index) =>
        index > 0 &&
        [
          fixture.teamA === anchor.teamA,
          fixture.teamA === anchor.teamB,
          fixture.teamB === anchor.teamA,
          fixture.teamB === anchor.teamB,
        ].some(Boolean),
    );
    const destinationIndex = fixtures.findIndex((fixture) => fixture.order === 1);
    const target = fixtures[targetIndex];
    const destination = fixtures[destinationIndex];
    fixtures[targetIndex] = {
      ...target,
      order: destination.order,
      rink: destination.rink,
    };
    fixtures[destinationIndex] = {
      ...destination,
      order: target.order,
      rink: target.rink,
    };
    const audit = auditGroupSchedule(teams, fixtures, 3);
    expect(audit.issues.some((issue) => /double-booked/.test(issue))).toBe(true);
  });

  it("detects missing and duplicate matchups", () => {
    const fixtures = validFixtures();
    fixtures[1] = {
      ...fixtures[1],
      teamA: fixtures[0].teamA,
      teamB: fixtures[0].teamB,
    };
    const audit = auditGroupSchedule(teams, fixtures, 3);
    expect(audit.issues.some((issue) => /more than once/.test(issue))).toBe(true);
    expect(audit.issues.some((issue) => /never plays/.test(issue))).toBe(true);
  });

  it("detects when a team's logical rounds run backwards", () => {
    const fixtures = validFixtures();
    const team = fixtures[0].teamA;
    const games = fixtures
      .filter(
        (fixture) => fixture.teamA === team || fixture.teamB === team,
      )
      .sort((a, b) => a.round! - b.round!);
    const first = fixtures.findIndex((fixture) => fixture.id === games[0].id);
    const last = fixtures.findIndex(
      (fixture) => fixture.id === games.at(-1)!.id,
    );
    [fixtures[first].order, fixtures[last].order] = [
      fixtures[last].order,
      fixtures[first].order,
    ];
    [fixtures[first].rink, fixtures[last].rink] = [
      fixtures[last].rink,
      fixtures[first].rink,
    ];

    expect(
      auditGroupSchedule(teams, fixtures, 3).issues.some((issue) =>
        /rounds in the wrong running order/.test(issue),
      ),
    ).toBe(true);
  });
});

const validKnockout: AuditKnockoutFixture[] = [
  {
    id: "sf1",
    matchCode: "SF1",
    round: 1,
    teamASource: "A1",
    teamBSource: "B2",
    teamA: "a1",
    teamB: "b2",
    status: "completed",
    shotsA: 5,
    shotsB: 3,
    winnerTeam: "a1",
  },
  {
    id: "sf2",
    matchCode: "SF2",
    round: 1,
    teamASource: "B1",
    teamBSource: "A2",
    teamA: "b1",
    teamB: "a2",
    status: "scheduled",
    shotsA: null,
    shotsB: null,
    winnerTeam: null,
  },
  {
    id: "f",
    matchCode: "F1",
    round: 2,
    teamASource: "W:SF1",
    teamBSource: "W:SF2",
    teamA: "a1",
    teamB: null,
    status: "pending",
    shotsA: null,
    shotsB: null,
    winnerTeam: null,
  },
];

describe("auditKnockoutSchedule", () => {
  it("accepts a coherent dependency graph with an unresolved final", () => {
    expect(auditKnockoutSchedule(validKnockout)).toEqual([]);
  });

  it("detects phantom byes, missing references and invalid finished results", () => {
    const broken = validKnockout.map((fixture) => ({ ...fixture }));
    broken[0].teamBSource = null;
    broken[0].winnerTeam = "not-a-team";
    broken[2].teamASource = "W:MISSING";
    const issues = auditKnockoutSchedule(broken);
    expect(issues.some((issue) => /missing source/.test(issue))).toBe(true);
    expect(issues.some((issue) => /incomplete result/.test(issue))).toBe(true);
    expect(issues.some((issue) => /missing match MISSING/.test(issue))).toBe(
      true,
    );
  });
});
