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
 * Build a single-elimination bracket from seeded qualifier labels (best seed
 * first). Top seeds are spread apart and get byes when the field isn't a power
 * of two. Later-round slots read "W:<matchId>" (the winner of that match).
 */
export function buildBracket(qualifierLabels: string[]): BracketRound[] {
  const n = qualifierLabels.length;
  if (n < 2) return [];

  const size = nextPow2(n);
  const order = seedOrder(size);
  let slots: (string | null)[] = order.map((s) =>
    s <= n ? qualifierLabels[s - 1] : null,
  );

  const rounds: BracketRound[] = [];
  while (slots.length > 1) {
    const tag = roundTag(slots.length);
    const matches: BracketMatch[] = [];
    const next: (string | null)[] = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      const id = `${tag}${matches.length + 1}`;
      matches.push({ id, a, b });
      if (a !== null && b === null) next.push(a);
      else if (b !== null && a === null) next.push(b);
      else next.push(`W:${id}`);
    }
    rounds.push({ name: roundName(slots.length), matches });
    slots = next;
  }
  return rounds;
}
