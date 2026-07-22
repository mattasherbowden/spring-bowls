// Pure domain types for the tournament engine. No framework or database
// imports — this layer is exhaustively unit-tested in isolation.

export type TeamId = string;

/** One end of play: the shots each team scored on that end. */
export interface EndScore {
  shotsA: number;
  shotsB: number;
  /** True if this end was a decider (played because the game was level). */
  isDecider?: boolean;
}

/**
 * How a fixture finished. Either it was played (a list of ends) or it was
 * awarded as a walkover (no-show / withdrawal — decision D-0005).
 */
export type FixtureOutcome =
  | { kind: "played"; ends: EndScore[] }
  | { kind: "walkover"; winner: "A" | "B"; shots: number };

export interface Fixture {
  id: string;
  teamA: TeamId;
  teamB: TeamId;
  /** Undefined until the fixture has a result. */
  outcome?: FixtureOutcome;
}

export interface FixtureResult {
  winner: TeamId;
  loser: TeamId;
  /** Total shots team A scored. */
  shotsA: number;
  /** Total shots team B scored. */
  shotsB: number;
}
