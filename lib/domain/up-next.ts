// Decides what a player's "Up next" tile should say: are you up now (your rink
// is clear), still waiting on the game ahead of you, waiting on an opponent to
// be decided, or up next with no rink assigned yet. Pure so it can be unit
// tested away from the page that renders it.

export type UpNextStatus = "tbd" | "waiting" | "live" | "unknown";
export type UpNextBlocker = "rink" | "team" | null;

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
  // The most useful game to watch while waiting: normally the nearest game on
  // the assigned rink, or an earlier game involving one of this fixture's
  // teams on another rink.
  aheadGame: RinkFixture | null;
  // How many still-to-play games are ahead of you on your rink.
  aheadCount: number;
  blocker: UpNextBlocker;
};

// A fixture counts as "still to be played" unless it's completed or a walkover.
export function isOpenStatus(status: string): boolean {
  return status !== "completed" && status !== "walkover";
}

export function upNextInfo(
  upNext: {
    id: string;
    rink: number | null;
    order_index: number;
    team_a_id?: string | null;
    team_b_id?: string | null;
  },
  allFixtures: RinkFixture[],
  opponentKnown: boolean,
): UpNextInfo {
  let rinkBlocker: RinkFixture | null = null;
  let teamBlocker: RinkFixture | null = null;
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
    rinkBlocker = ahead[0] ?? null;

    const teams = new Set(
      [upNext.team_a_id, upNext.team_b_id].filter(
        (id): id is string => id != null,
      ),
    );
    teamBlocker =
      allFixtures
        .filter(
          (f) =>
            f.id !== upNext.id &&
            f.order_index < upNext.order_index &&
            isOpenStatus(f.status) &&
            (teams.has(f.team_a_id ?? "") || teams.has(f.team_b_id ?? "")),
        )
        // Prefer the most recent earlier commitment.
        .sort((a, b) => b.order_index - a.order_index)[0] ?? null;
  }

  // A busy assigned rink is the clearest explanation when both constraints
  // apply. Once it clears, a cross-rink team blocker (if any) takes over.
  const blocker: UpNextBlocker = rinkBlocker
    ? "rink"
    : teamBlocker
      ? "team"
      : null;
  const aheadGame = rinkBlocker ?? teamBlocker;
  const status: UpNextStatus = !opponentKnown
    ? "tbd"
    : blocker
      ? "waiting"
      : upNext.rink != null
        ? "live"
        : "unknown";

  return { status, aheadGame, aheadCount, blocker };
}
