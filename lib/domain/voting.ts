export const ORGANISER_VOTE_MESSAGE =
  "That is kind but sorry, pick someone else — I made it so you can't vote for me.";

export type NomineeProfile = {
  is_owner?: boolean | null;
  is_admin?: boolean | null;
};

/** Owners and helpers may vote, but cannot be individual-award nominees. */
export function isOrganiserNominee(
  profile: NomineeProfile | null | undefined,
): boolean {
  return !!profile?.is_owner || !!profile?.is_admin;
}
