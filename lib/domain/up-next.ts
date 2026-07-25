// Decides what a player's "Up next" tile should say: are you up now (your rink
// is clear), still waiting on the game ahead of you, waiting on an opponent to
// be decided, or up next with no rink assigned yet. Pure so it can be unit
// tested away from the page that renders it.

export type UpNextStatus = "tbd" | "waiting" | "live" | "unknown";

// The minimal shape of a fixture on the board that this logic needs.
export type RinkFixture = {
  id: string;
  rink: number | null;
  order_index: number;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
};

export type UpNextInfo = {
  status: UpNextStatus;
  // The game directly ahead of you on your rink that's still to be played, if
  // any — used to tell you who to watch.
  aheadGame: RinkFixture | null;
  // How many still-to-play games are ahead of you on your rink.
  aheadCount: number;
};

// A fixture counts as "still to be played" unless it's completed or a walkover.
export function isOpenStatus(status: string): boolean {
  return status !== "completed" && status !== "walkover";
}

export function upNextInfo(
  upNext: { id: string; rink: number | null; order_index: number },
  allFixtures: RinkFixture[],
  opponentKnown: boolean,
): UpNextInfo {
  let aheadGame: RinkFixture | null = null;
  let aheadCount = 0;

  if (upNext.rink != null) {
    const ahead = allFixtures
      .filter(
        (f) =>
          f.rink === upNext.rink &&
          f.id !== upNext.id &&
          f.order_index < upNext.order_index &&
          isOpenStatus(f.status),
      )
      // Nearest game ahead first (highest order_index below yours).
      .sort((a, b) => b.order_index - a.order_index);
    aheadCount = ahead.length;
    aheadGame = ahead[0] ?? null;
  }

  const status: UpNextStatus = !opponentKnown
    ? "tbd"
    : aheadGame
      ? "waiting"
      : upNext.rink != null
        ? "live"
        : "unknown";

  return { status, aheadGame, aheadCount };
}
