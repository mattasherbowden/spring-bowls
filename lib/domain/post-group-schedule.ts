export type PostGroupFixture = {
  id: string;
  matchCode: string | null;
  round: number | null;
};

export type PostGroupPlacement = {
  rink: number;
  order: number;
  wave: number;
};

/**
 * Give every post-group fixture a stable physical slot.
 *
 * Fixtures in the same logical round may share a wave, up to the rink count.
 * A later round always starts in a fresh wave even when the previous round
 * left a rink unused, because its participants depend on earlier winners.
 */
export function buildPostGroupPlacements(
  fixtures: PostGroupFixture[],
  rinkCount: number,
  minimumOrder = 1000,
): Map<string, PostGroupPlacement> {
  const rinks = Math.max(1, Math.floor(rinkCount));
  const baseOrder = Math.ceil(Math.max(0, minimumOrder) / rinks) * rinks;
  const byRound = new Map<number, PostGroupFixture[]>();

  for (const fixture of fixtures) {
    const round = Math.max(1, Math.floor(fixture.round ?? 1));
    byRound.set(round, [...(byRound.get(round) ?? []), fixture]);
  }

  const placements = new Map<string, PostGroupPlacement>();
  let waveOffset = 0;
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const matches = (byRound.get(round) ?? []).sort(
      (a, b) =>
        (a.matchCode ?? "").localeCompare(b.matchCode ?? "") ||
        a.id.localeCompare(b.id),
    );
    for (let index = 0; index < matches.length; index++) {
      const wave = waveOffset + Math.floor(index / rinks);
      const rink = (index % rinks) + 1;
      placements.set(matches[index].id, {
        rink,
        order: baseOrder + wave * rinks + (rink - 1),
        wave,
      });
    }
    waveOffset += Math.ceil(matches.length / rinks);
  }

  return placements;
}
