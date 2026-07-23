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

  const out: ScheduledFixture[] = [];
  let order = 0;
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    byRound.get(round)!.forEach((game, idx) => {
      out.push({
        stage: "group",
        groupLabel: game.groupLabel,
        round,
        rink: (idx % lanes) + 1,
        order: order++,
        teamA: game.teamA,
        teamB: game.teamB,
      });
    });
  }
  return out;
}
