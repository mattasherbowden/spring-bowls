export const ORGANISER_VOTE_MESSAGE =
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

/** Owners and helpers may vote, but cannot be individual-award nominees. */
export function isOrganiserNominee(
  profile: NomineeProfile | null | undefined,
): boolean {
  return !!profile?.is_owner || !!profile?.is_admin;
}
