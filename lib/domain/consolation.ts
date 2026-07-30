export const BONUS_BOWL_OFF_CODE = "BOWL1";

export type GroupShape = {
  label: string;
  size: number;
};

export type BonusBowlOff = {
  matchCode: typeof BONUS_BOWL_OFF_CODE;
  round: 1;
  teamASource: string;
  teamBSource: string;
  groupLabel: string;
};

/**
 * The 15-team four-group format leaves one group with only three teams.
 * Its winner is guaranteed a third game in the semi-final; this extra game
 * gives second and third place their third game too.
 *
 * Keep this deliberately narrow. Other uneven structures need their own
 * reviewed format rather than silently gaining an unexpected fixture.
 */
export function bonusBowlOff(
  groups: GroupShape[],
  advance: number,
): BonusBowlOff | null {
  if (advance !== 1 || groups.length !== 4) return null;

  const small = groups.filter((group) => group.size === 3);
  const full = groups.filter((group) => group.size === 4);
  if (small.length !== 1 || full.length !== 3) return null;

  return {
    matchCode: BONUS_BOWL_OFF_CODE,
    round: 1,
    teamASource: `${small[0].label}2`,
    teamBSource: `${small[0].label}3`,
    groupLabel: small[0].label,
  };
}

export function isBonusBowlOff(matchCode: string | null): boolean {
  return matchCode === BONUS_BOWL_OFF_CODE;
}
