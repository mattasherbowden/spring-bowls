export type AuditTeam = {
  id: string;
  name: string;
  groupLabel: string | null;
};

export type AuditFixture = {
  id: string;
  groupLabel: string | null;
  round: number | null;
  rink: number | null;
  order: number;
  teamA: string | null;
  teamB: string | null;
};

export type ScheduleAudit = {
  issues: string[];
  waveCount: number;
};

export type AuditKnockoutFixture = {
  id: string;
  matchCode: string | null;
  round: number | null;
  teamASource: string | null;
  teamBSource: string | null;
  teamA: string | null;
  teamB: string | null;
  status: string;
  shotsA: number | null;
  shotsB: number | null;
  winnerTeam: string | null;
};

/** Validate pairings and their physical placement, not just fixture counts. */
export function auditGroupSchedule(
  teams: AuditTeam[],
  fixtures: AuditFixture[],
  rinkCount: number,
): ScheduleAudit {
  const lanes = Math.max(1, Math.floor(rinkCount));
  const issues = new Set<string>();
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const pairKeys = new Set<string>();
  const orderKeys = new Set<number>();
  const waveTeams = new Map<number, Map<string, number>>();
  const waveRinks = new Map<number, Set<number>>();
  const teamRunningOrder = new Map<
    string,
    Array<{ order: number; round: number }>
  >();
  let waveCount = 0;

  for (const team of teams) {
    if (!team.groupLabel) issues.add(`${team.name} has no group.`);
  }

  for (const fixture of fixtures) {
    const a = fixture.teamA ? teamById.get(fixture.teamA) : null;
    const b = fixture.teamB ? teamById.get(fixture.teamB) : null;
    if (!a || !b) {
      issues.add("A group game is missing one of its teams.");
      continue;
    }
    if (fixture.round == null || fixture.round < 1) {
      issues.add("A group game is missing a valid round number.");
    } else {
      for (const team of [a, b]) {
        teamRunningOrder.set(team.id, [
          ...(teamRunningOrder.get(team.id) ?? []),
          { order: fixture.order, round: fixture.round },
        ]);
      }
    }
    if (a.id === b.id) issues.add(`${a.name} is scheduled against itself.`);
    if (
      !a.groupLabel ||
      a.groupLabel !== b.groupLabel ||
      fixture.groupLabel !== a.groupLabel
    ) {
      issues.add(`${a.name} and ${b.name} are in the wrong group matchup.`);
    }

    const pairKey = `${fixture.groupLabel}:${[a.id, b.id].sort().join("|")}`;
    if (pairKeys.has(pairKey)) {
      issues.add(`${a.name} and ${b.name} are scheduled more than once.`);
    }
    pairKeys.add(pairKey);

    if (orderKeys.has(fixture.order)) {
      issues.add(`Two games share running-order position ${fixture.order}.`);
    }
    orderKeys.add(fixture.order);

    if (
      fixture.rink == null ||
      fixture.rink < 1 ||
      fixture.rink > lanes
    ) {
      issues.add(`A game is assigned outside the ${lanes} available rinks.`);
      continue;
    }
    const wave = Math.floor(fixture.order / lanes);
    waveCount = Math.max(waveCount, wave + 1);
    if (fixture.rink !== (fixture.order % lanes) + 1) {
      issues.add("The running order and rink assignments are out of sync.");
    }

    const rinks = waveRinks.get(wave) ?? new Set<number>();
    if (rinks.has(fixture.rink)) {
      issues.add(`Rink ${fixture.rink} has two games in the same time wave.`);
    }
    rinks.add(fixture.rink);
    waveRinks.set(wave, rinks);

    const counts = waveTeams.get(wave) ?? new Map<string, number>();
    for (const team of [a, b]) {
      counts.set(team.id, (counts.get(team.id) ?? 0) + 1);
      if ((counts.get(team.id) ?? 0) > 1) {
        issues.add(`${team.name} is double-booked in time wave ${wave + 1}.`);
      }
    }
    waveTeams.set(wave, counts);
  }

  for (const [teamId, games] of teamRunningOrder) {
    const orderedRounds = [...games]
      .sort((a, b) => a.order - b.order)
      .map((game) => game.round);
    if (
      orderedRounds.some(
        (round, index) => index > 0 && round < orderedRounds[index - 1],
      )
    ) {
      issues.add(
        `${teamById.get(teamId)?.name ?? "A team"} has group rounds in the wrong running order.`,
      );
    }
  }

  const groups = new Map<string, AuditTeam[]>();
  for (const team of teams) {
    if (!team.groupLabel) continue;
    groups.set(team.groupLabel, [
      ...(groups.get(team.groupLabel) ?? []),
      team,
    ]);
  }
  for (const [label, groupTeams] of groups) {
    const expected = (groupTeams.length * (groupTeams.length - 1)) / 2;
    const actual = fixtures.filter(
      (fixture) => fixture.groupLabel === label,
    ).length;
    if (actual !== expected) {
      issues.add(
        `Group ${label} has ${actual} games but needs ${expected} for a full round robin.`,
      );
    }
    for (let a = 0; a < groupTeams.length; a++) {
      for (let b = a + 1; b < groupTeams.length; b++) {
        const key = `${label}:${[
          groupTeams[a].id,
          groupTeams[b].id,
        ].sort().join("|")}`;
        if (!pairKeys.has(key)) {
          issues.add(
            `${groupTeams[a].name} never plays ${groupTeams[b].name}.`,
          );
        }
      }
    }
  }

  return { issues: [...issues], waveCount };
}

/** Validate the persisted single-elimination dependency graph and results. */
export function auditKnockoutSchedule(
  fixtures: AuditKnockoutFixture[],
): string[] {
  const issues = new Set<string>();
  if (fixtures.length === 0) return [];

  const byCode = new Map<string, AuditKnockoutFixture>();
  const directSources = new Set<string>();
  for (const fixture of fixtures) {
    if (!fixture.matchCode) {
      issues.add("A knockout game has no match code.");
    } else if (byCode.has(fixture.matchCode)) {
      issues.add(`Knockout match code ${fixture.matchCode} appears twice.`);
    } else {
      byCode.set(fixture.matchCode, fixture);
    }
    if (fixture.round == null || fixture.round < 1) {
      issues.add("A knockout game has no valid round.");
    }
    if (!fixture.teamASource || !fixture.teamBSource) {
      issues.add(
        `${fixture.matchCode ?? "A knockout game"} has a missing source (a bye must not be saved as a game).`,
      );
    }
    if (fixture.teamA && fixture.teamA === fixture.teamB) {
      issues.add(`${fixture.matchCode ?? "A knockout game"} has one team twice.`);
    }
    if (
      ["scheduled", "live", "completed", "walkover"].includes(fixture.status) &&
      (!fixture.teamA || !fixture.teamB)
    ) {
      issues.add(
        `${fixture.matchCode ?? "A knockout game"} is playable but a team is missing.`,
      );
    }
    if (fixture.status === "completed" || fixture.status === "walkover") {
      if (
        !fixture.winnerTeam ||
        (fixture.winnerTeam !== fixture.teamA &&
          fixture.winnerTeam !== fixture.teamB) ||
        fixture.shotsA == null ||
        fixture.shotsB == null
      ) {
        issues.add(
          `${fixture.matchCode ?? "A knockout game"} has an incomplete result.`,
        );
      }
    }
    for (const source of [fixture.teamASource, fixture.teamBSource]) {
      if (!source || source.startsWith("W:")) continue;
      if (directSources.has(source)) {
        issues.add(`Knockout source ${source} enters the bracket more than once.`);
      }
      directSources.add(source);
    }
  }

  for (const fixture of fixtures) {
    for (const source of [fixture.teamASource, fixture.teamBSource]) {
      if (!source?.startsWith("W:")) continue;
      const sourceCode = source.slice(2);
      const earlier = byCode.get(sourceCode);
      if (!earlier) {
        issues.add(
          `${fixture.matchCode ?? "A knockout game"} refers to missing match ${sourceCode}.`,
        );
      } else if (
        fixture.round != null &&
        earlier.round != null &&
        earlier.round >= fixture.round
      ) {
        issues.add(
          `${fixture.matchCode ?? "A knockout game"} depends on a match that is not in an earlier round.`,
        );
      }
    }
  }

  const rounds = fixtures
    .map((fixture) => fixture.round)
    .filter((round): round is number => round != null);
  const lastRound = rounds.length > 0 ? Math.max(...rounds) : null;
  if (
    lastRound != null &&
    fixtures.filter((fixture) => fixture.round === lastRound).length !== 1
  ) {
    issues.add("The knockout does not have exactly one final.");
  }

  return [...issues];
}
