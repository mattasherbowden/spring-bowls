import type { EndScore } from "./types";

export type ScoreEntryValidation =
  | { ends: EndScore[]; error?: never }
  | { ends?: never; error: string };

const MAX_RECORDED_SHOTS = 999;
const MAX_DECIDERS = 10;

/**
 * Validate the untrusted end payload before it can affect a fixture.
 *
 * The app intentionally allows totals up to three digits because some events
 * use each row for an aggregate rather than a literal bowls end. What matters
 * here is that the shape is finite and sane, and that a decider can only be
 * added while the cumulative game is actually level.
 */
export function validateScoreEntry(
  value: unknown,
  endsPerGame: number,
): ScoreEntryValidation {
  const regularEnds = Math.max(1, Math.floor(endsPerGame));
  if (!Array.isArray(value) || value.length < regularEnds) {
    return { error: `Enter all ${regularEnds} regular end scores.` };
  }
  if (value.length > regularEnds + MAX_DECIDERS) {
    return { error: "There are too many decider ends. Please check the score." };
  }

  const ends: EndScore[] = [];
  let totalA = 0;
  let totalB = 0;
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") {
      return { error: "Please check every end score." };
    }
    const shotsA = (raw as { shotsA?: unknown }).shotsA;
    const shotsB = (raw as { shotsB?: unknown }).shotsB;
    if (
      !Number.isInteger(shotsA) ||
      !Number.isInteger(shotsB) ||
      (shotsA as number) < 0 ||
      (shotsB as number) < 0 ||
      (shotsA as number) > MAX_RECORDED_SHOTS ||
      (shotsB as number) > MAX_RECORDED_SHOTS
    ) {
      return {
        error: `Each score must be a whole number from 0 to ${MAX_RECORDED_SHOTS}.`,
      };
    }
    if (index >= regularEnds && totalA !== totalB) {
      return {
        error: "A decider can only be added while the game is level.",
      };
    }

    const end = {
      shotsA: shotsA as number,
      shotsB: shotsB as number,
      isDecider: index >= regularEnds,
    };
    ends.push(end);
    totalA += end.shotsA;
    totalB += end.shotsB;
  }

  return { ends };
}
