/**
 * Convert a scheduler slot (1, 2, 3, …) into the rink number printed at the
 * venue. Scheduling, blocking and knockout logic must continue using the
 * original slot; this helper is for display only.
 */
export function displayRinkNumber(
  rink: number | null | undefined,
  rinkNumberStart: number | null | undefined,
): number | null {
  if (rink == null) return null;
  const start =
    Number.isInteger(rinkNumberStart) && (rinkNumberStart ?? 0) >= 1
      ? (rinkNumberStart as number)
      : 1;
  return rink + start - 1;
}
