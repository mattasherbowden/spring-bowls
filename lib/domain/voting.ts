export const OWNER_COOLEST_KIWI_MESSAGE =
  "That is kind but sorry, pick someone else — I made it so you can't vote for me.";

export type NomineeProfile = {
  is_owner?: boolean | null;
  is_admin?: boolean | null;
};

export type VotingStatus = "pending" | "open" | "closed";
export type TournamentStatus = "setup" | "live" | "archived";

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
