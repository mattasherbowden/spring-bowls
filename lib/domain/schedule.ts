import { roundRobin } from "./round-robin";
import type { TeamId } from "./types";

export interface DrawnGroup {
  label: string;
  teamIds: TeamId[];
}

export interface ScheduledFixture {
  stage: "group";
  groupLabel: string;
  round: number;
  rink: number; // 1-based
  order: number; // 0-based position across the whole schedule
  teamA: TeamId;
  teamB: TeamId;
}

type Schedulable = {
  teamA: TeamId;
  teamB: TeamId;
  round: number;
};

/**
 * Pack games into real time waves. A wave has at most one game per rink and a
 * team can appear at most once. Earlier rounds for each team are never skipped.
 *
 * `order` encodes the wave and rink: floor(order / rinks) is the time wave and
 * order % rinks is the zero-based rink. Keeping this explicit is what stops a
 * superficially valid per-rink list from double-booking a team elsewhere.
 */
export function packScheduleGames<T extends Schedulable>(
  games: T[],
  rinks: number,
): Array<T & { rink: number; order: number }> {
  const lanes = Math.max(1, Math.floor(rinks));
  const remaining = [...games];
  const packed: Array<T & { rink: number; order: number }> = [];
  let wave = 0;

  while (remaining.length > 0) {
    const usedTeams = new Set<TeamId>();
    let position = 0;

    for (let index = 0; index < remaining.length && position < lanes; ) {
      const game = remaining[index];
      const conflicts =
        usedTeams.has(game.teamA) || usedTeams.has(game.teamB);
      const skipsEarlierRound = remaining.some(
        (other) =>
          other.round < game.round &&
          (other.teamA === game.teamA ||
            other.teamB === game.teamA ||
            other.teamA === game.teamB ||
            other.teamB === game.teamB),
      );
      if (conflicts || skipsEarlierRound) {
        index++;
        continue;
      }

      remaining.splice(index, 1);
      usedTeams.add(game.teamA);
      usedTeams.add(game.teamB);
      packed.push({
        ...game,
        rink: position + 1,
        order: wave * lanes + position,
      });
      position++;
    }

    // The globally earliest remaining round is always eligible, so this is a
    // defensive invariant rather than an expected path.
    if (position === 0) {
      throw new Error("Could not build a conflict-free schedule wave");
    }
    wave++;
  }

  return packed;
}

function groupLabel(index: number): string {
  return String.fromCharCode(65 + index); // A, B, C, ...
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Randomly assign teams into labelled groups of the given sizes (auto-draw).
 * RNG is injectable so the draw is testable and reproducible.
 */
export function drawGroups(
  teamIds: TeamId[],
  groupSizes: number[],
  rand: () => number = Math.random,
): DrawnGroup[] {
  const shuffled = shuffle(teamIds, rand);
  const groups: DrawnGroup[] = [];
  let i = 0;
  groupSizes.forEach((size, gi) => {
    groups.push({ label: groupLabel(gi), teamIds: shuffled.slice(i, i + size) });
    i += size;
  });
  return groups;
}

/**
 * Build the group-stage fixtures as a predetermined per-rink schedule (D-0003).
 * Games are laid out round by round (within a round no team plays twice), then
 * packed into waves of `rinks` — so each rink has a clear running order.
 */
export function buildGroupSchedule(
  groups: DrawnGroup[],
  rinks: number,
): ScheduledFixture[] {
  const lanes = Math.max(1, Math.floor(rinks));

  const byRound = new Map<
    number,
    { groupLabel: string; teamA: TeamId; teamB: TeamId }[]
  >();
  for (const group of groups) {
    for (const pairing of roundRobin(group.teamIds)) {
      const bucket = byRound.get(pairing.round) ?? [];
      bucket.push({
        groupLabel: group.label,
        teamA: pairing.teamA,
        teamB: pairing.teamB,
      });
      byRound.set(pairing.round, bucket);
    }
  }

  const ordered = [...byRound.keys()]
    .sort((a, b) => a - b)
    .flatMap((round) =>
      byRound.get(round)!.map((game) => ({ ...game, round })),
    );

  return packScheduleGames(ordered, lanes).map((game) => ({
    stage: "group",
    groupLabel: game.groupLabel,
    round: game.round,
    rink: game.rink,
    order: game.order,
    teamA: game.teamA,
    teamB: game.teamB,
  }));
}
