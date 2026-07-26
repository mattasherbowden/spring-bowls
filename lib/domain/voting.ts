export const OWNER_COOLEST_KIWI_MESSAGE =
  "That is kind but sorry, pick someone else — I made it so you can't vote for me.";

export type NomineeProfile = {
  is_owner?: boolean | null;
  is_admin?: boolean | null;
};

export type VotingStatus = "pending" | "open" | "closed";
export type TournamentStatus = "setup" | "live" | "archived";

export type PlayerVotingLabelInput = {
  id: string;
  displayName: string;
  teamLabel?: string | null;
};

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function abbreviatedName(value: string): string {
  const name = cleanName(value);
  const parts = name.split(" ").filter(Boolean);
  if (parts.length < 2) return name || "Player";
  const surname = parts.at(-1) ?? "";
  return `${parts[0]} ${surname.slice(0, 1).toLocaleUpperCase()}.`;
}

/**
 * Compact player labels for ballots:
 *   Ben Cochrane → Ben C.
 * Colliding initials fall back to full names; identical full names gain their
 * team label. IDs remain the actual vote targets, so labels never merge votes.
 */
export function buildPlayerVotingLabels(
  players: PlayerVotingLabelInput[],
): Map<string, string> {
  const prepared = players.map((player) => ({
    ...player,
    full: cleanName(player.displayName) || "Player",
    short: abbreviatedName(player.displayName),
  }));
  const shortCounts = new Map<string, number>();
  const fullCounts = new Map<string, number>();
  for (const player of prepared) {
    const shortKey = player.short.toLocaleLowerCase();
    const fullKey = player.full.toLocaleLowerCase();
    shortCounts.set(shortKey, (shortCounts.get(shortKey) ?? 0) + 1);
    fullCounts.set(fullKey, (fullCounts.get(fullKey) ?? 0) + 1);
  }

  return new Map(
    prepared.map((player) => {
      const shortCollision =
        (shortCounts.get(player.short.toLocaleLowerCase()) ?? 0) > 1;
      const fullCollision =
        (fullCounts.get(player.full.toLocaleLowerCase()) ?? 0) > 1;
      let label = shortCollision ? player.full : player.short;
      if (shortCollision && fullCollision && player.teamLabel) {
        label = `${player.short} — ${player.teamLabel}`;
      }
      return [player.id, label];
    }),
  );
}

/**
 * Bowl of the Day is collected while games are being played. The organiser's
 * normal Open voting control releases every other award; Close voting freezes
 * the entire ballot for the ceremony.
 */
export function isAwardVotingOpen(
  status: VotingStatus,
  awardKey: string,
  tournamentStatus: TournamentStatus,
): boolean {
  return status === "open" ||
    (
      tournamentStatus === "live" &&
      status === "pending" &&
      awardKey === "bowl_of_the_day"
    );
}

/** The owner opted out of Coolest Kiwi only; all other eligibility is normal. */
export function isOwnerExcludedFromAward(
  profile: NomineeProfile | null | undefined,
  awardKey: string,
): boolean {
  return awardKey === "coolest_kiwi" && !!profile?.is_owner;
}
