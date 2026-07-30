export interface BracketMatch {
  id: string;
  a: string | null;
  b: string | null;
}
export interface BracketRound {
  name: string;
  matches: BracketMatch[];
}

function nextPow2(n: number): number {
  return 2 ** Math.ceil(Math.log2(n));
}

// Standard single-elimination seed order for a power-of-two field (seed 1 top,
// seed 2 bottom, top seeds kept apart).
function seedOrder(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const upper = seeds.length * 2 + 1;
    const round: number[] = [];
    for (const s of seeds) round.push(s, upper - s);
    seeds = round;
  }
  return seeds;
}

function roundTag(count: number): string {
  if (count === 2) return "F";
  if (count === 4) return "SF";
  if (count === 8) return "QF";
  return `R${count}`;
}
function roundName(count: number): string {
  if (count === 2) return "Final";
  if (count === 4) return "Semi-finals";
  if (count === 8) return "Quarter-finals";
  return `Round of ${count}`;
}

/**
 * Name a persisted knockout round from its position in the dependency graph.
 * Saved brackets omit one-sided bye fixtures, so the number of stored matches
 * cannot be used to infer the round (a three-team semi-final stores one match,
 * not two).
 */
export function knockoutRoundName(
  roundNumber: number,
  finalRoundNumber: number,
): string {
  const round = Math.max(1, Math.floor(roundNumber));
  const finalRound = Math.max(round, Math.floor(finalRoundNumber));
  return roundName(2 ** (finalRound - round + 1));
}

// The group a qualifier label belongs to — "A1" -> "A", "B2" -> "B".
function groupOf(label: string): string {
  return label.replace(/\d+$/, "");
}

// The round (1 = first round, 2 = next, …) at which bracket positions i and j
// would meet, from the binary structure of the bracket.
function meetRound(i: number, j: number): number {
  let r = 1;
  while (i >> r !== j >> r) r++;
  return r;
}

/**
 * Build a single-elimination bracket from seeded qualifier labels (best seed
 * first, e.g. group winners then runners-up). Top seeds are spread apart and
 * get byes when the field isn't a power of two — AND teams from the same group
 * are placed as far apart as possible, so they can't meet again until as late
 * as the bracket allows (ideally the final). Later-round slots read
 * "W:<matchId>" (the winner of that match); a null slot is a bye.
 */
export function buildBracket(qualifierLabels: string[]): BracketRound[] {
  const n = qualifierLabels.length;
  if (n < 2) return [];

  const size = nextPow2(n);
  const order = seedOrder(size);
  // The canonical bracket position for each seed (1-indexed seed -> position).
  const posOfSeed = new Array<number>(size);
  order.forEach((seed, pos) => {
    posOfSeed[seed] = pos;
  });

  // The top (size - n) seeds get byes — reserve each of their first-round
  // partner slots so they stay empty and the byes fall to the best seeds.
  const byeCount = size - n;
  const reserved = new Set<number>();
  for (let seed = 1; seed <= byeCount; seed++) reserved.add(posOfSeed[seed] ^ 1);

  const slots: (string | null)[] = new Array(size).fill(null);
  const placedByGroup = new Map<string, number[]>();

  // Place best seed first. Each team goes to the empty position that keeps it
  // furthest (latest meeting round) from its already-placed group-mates; ties
  // break toward the team's canonical seed position, then the lowest index for
  // determinism.
  for (let seed = 1; seed <= n; seed++) {
    const label = qualifierLabels[seed - 1];
    const group = groupOf(label);
    const mates = placedByGroup.get(group) ?? [];
    const canonical = posOfSeed[seed];

    let best = -1;
    let bestSep = -1;
    let bestCanonical = false;
    for (let p = 0; p < size; p++) {
      if (slots[p] !== null || reserved.has(p)) continue;
      const sep =
        mates.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(...mates.map((m) => meetRound(p, m)));
      const isCanonical = p === canonical;
      const better =
        sep > bestSep ||
        (sep === bestSep && isCanonical && !bestCanonical) ||
        (sep === bestSep && isCanonical === bestCanonical && best === -1);
      if (better) {
        best = p;
        bestSep = sep;
        bestCanonical = isCanonical;
      }
    }

    slots[best] = label;
    placedByGroup.set(group, [...mates, best]);
  }

  const rounds: BracketRound[] = [];
  let cur: (string | null)[] = slots;
  while (cur.length > 1) {
    const tag = roundTag(cur.length);
    const matches: BracketMatch[] = [];
    const next: (string | null)[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const a = cur[i];
      const b = cur[i + 1];
      const id = `${tag}${matches.length + 1}`;
      matches.push({ id, a, b });
      if (a !== null && b === null) next.push(a);
      else if (b !== null && a === null) next.push(b);
      else next.push(`W:${id}`);
    }
    rounds.push({ name: roundName(cur.length), matches });
    cur = next;
  }
  return rounds;
}
