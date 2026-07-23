// Tournament planner: turns setup parameters into a concrete plan (groups,
// game counts, fixtures per team, knockout shape) and a rough time budget.
// Pure and unit-tested; used live by the setup wizard.

export interface PlanInput {
  teams: number;
  teamSize: number;
  rinks: number;
  endsPerGame: number;
  minutesPerEnd: number;
  advance: 1 | 2;
  preferredGroupSize: number;
}

export interface TournamentPlan {
  groups: number[];
  groupCount: number;
  groupGames: number;
  fixturesPerTeam: { min: number; max: number };
  qualifiers: number;
  knockoutRounds: number;
  knockoutGames: number;
  byes: number;
  totalGames: number;
  headcount: number;
  gameMinutes: number;
  estMinutes: number;
  warnings: string[];
}

/**
 * Split `teams` into balanced groups near `preferredGroupSize`. Group sizes
 * differ by at most 1 (uneven groups are allowed — decision D-0006), and no
 * group is smaller than 2.
 */
export function splitIntoGroups(
  teams: number,
  preferredGroupSize: number,
): number[] {
  const n = Math.max(0, Math.floor(teams));
  if (n < 2) return n === 1 ? [1] : [];

  const size = Math.max(2, Math.round(preferredGroupSize) || 4);
  let groupCount = Math.max(1, Math.round(n / size));
  groupCount = Math.min(groupCount, Math.floor(n / 2)); // never a group of 1
  groupCount = Math.max(1, groupCount);

  const base = Math.floor(n / groupCount);
  const remainder = n % groupCount;
  const groups: number[] = [];
  for (let i = 0; i < groupCount; i++) {
    groups.push(base + (i < remainder ? 1 : 0));
  }
  return groups;
}

function roundRobinGames(size: number): number {
  return (size * (size - 1)) / 2;
}

export function planTournament(input: PlanInput): TournamentPlan {
  const teams = Math.max(0, Math.floor(input.teams));
  const rinks = Math.max(1, Math.floor(input.rinks));
  const teamSize = Math.max(1, Math.floor(input.teamSize));
  const gameMinutes =
    Math.max(0, input.endsPerGame) * Math.max(0, input.minutesPerEnd);

  const groups = splitIntoGroups(teams, input.preferredGroupSize);
  const groupCount = groups.length;
  const groupGames = groups.reduce((sum, s) => sum + roundRobinGames(s), 0);
  const sizes = groups.length ? groups : [0];
  const fixturesPerTeam = {
    min: Math.max(0, Math.min(...sizes) - 1),
    max: Math.max(0, Math.max(...sizes) - 1),
  };

  // Top `advance` from each group, but never more than a group holds.
  let qualifiers = groups.reduce(
    (sum, s) => sum + Math.min(input.advance, s),
    0,
  );
  if (qualifiers > teams) qualifiers = teams;

  // Single elimination: Q entrants play Q-1 games. Walk the rounds so we can
  // count byes and time each round against the available rinks.
  let entrants = qualifiers >= 2 ? qualifiers : 0;
  let knockoutGames = 0;
  let knockoutRounds = 0;
  let knockoutWaves = 0;
  while (entrants > 1) {
    const games = Math.floor(entrants / 2);
    knockoutGames += games;
    knockoutWaves += Math.ceil(games / rinks);
    entrants = Math.ceil(entrants / 2);
    knockoutRounds++;
  }
  const bracketSize = knockoutRounds > 0 ? 2 ** knockoutRounds : 0;
  const byes = bracketSize > 0 ? bracketSize - qualifiers : 0;

  const groupWaves = Math.ceil(groupGames / rinks) || 0;
  const estMinutes = (groupWaves + knockoutWaves) * gameMinutes;

  const warnings: string[] = [];
  if (teams >= 2 && groupCount === 1) {
    warnings.push(
      `Just one group — everyone plays everyone, then the top ${input.advance} go straight through.`,
    );
  }
  if (groupCount > 1 && Math.min(...groups) < 3) {
    warnings.push(
      `Some groups have only ${Math.min(...groups)} teams, so those teams play very few games.`,
    );
  }
  if (teams > 0 && qualifiers >= teams) {
    warnings.push("Everyone qualifies — the group stage won't knock anyone out.");
  }
  if (qualifiers > 0 && qualifiers < 2) {
    warnings.push("Too few teams to run a knockout round.");
  }

  return {
    groups,
    groupCount,
    groupGames,
    fixturesPerTeam,
    qualifiers,
    knockoutRounds,
    knockoutGames,
    byes,
    totalGames: groupGames + knockoutGames,
    headcount: teams * teamSize,
    gameMinutes,
    estMinutes,
    warnings,
  };
}
