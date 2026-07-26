"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AWARD_BY_KEY } from "@/lib/domain/awards";
import {
  isAwardVotingOpen,
  isOrganiserNominee,
  ORGANISER_VOTE_MESSAGE,
  type TournamentStatus,
  type VotingStatus,
} from "@/lib/domain/voting";

export type VoteState = { error?: string };

export async function castVote(
  _prev: VoteState,
  fd: FormData,
): Promise<VoteState> {
  const awardKey = String(fd.get("awardKey") ?? "");
  const targetType = String(fd.get("targetType") ?? "");
  const targetId = String(fd.get("targetId") ?? "");

  const award = AWARD_BY_KEY.get(awardKey);
  if (!award) return { error: "Unknown award." };
  if (targetType !== award.kind) return { error: "Invalid vote." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id, status, voting_status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return { error: "No active tournament." };
  if (
    !isAwardVotingOpen(
      tournament.voting_status as VotingStatus,
      awardKey,
      tournament.status as TournamentStatus,
    )
  ) {
    return {
      error:
        awardKey === "bowl_of_the_day"
          ? "Bowl of the Day voting has closed."
          : "Ceremony voting isn't open right now.",
    };
  }

  // The voter's own roster row (if any) — for self / own-team exclusion.
  const { data: voterPlayer } = await admin
    .from("player")
    .select("id, team_id")
    .eq("tournament_id", tournament.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  // Validate the target is a real, eligible nominee in THIS tournament.
  if (award.kind === "team") {
    const { data: team } = await admin
      .from("team")
      .select("id")
      .eq("id", targetId)
      .eq("tournament_id", tournament.id)
      .maybeSingle();
    if (!team) return { error: "That team isn't in this tournament." };
    if (voterPlayer && voterPlayer.team_id === targetId) {
      return { error: "You can't vote for your own team." };
    }
  } else {
    const { data: player } = await admin
      .from("player")
      .select("id, nationality, profile_id")
      .eq("id", targetId)
      .eq("tournament_id", tournament.id)
      .maybeSingle();
    if (!player) return { error: "That player isn't in this tournament." };
    if (voterPlayer && voterPlayer.id === targetId) {
      return { error: "You can't vote for yourself." };
    }
    const { data: targetProfile } = await admin
      .from("profile")
      .select("is_owner, is_admin")
      .eq("id", player.profile_id)
      .maybeSingle();
    if (isOrganiserNominee(targetProfile)) {
      return { error: ORGANISER_VOTE_MESSAGE };
    }
    if (award.nationality && player.nationality !== award.nationality) {
      return { error: "That player isn't eligible for this award." };
    }
  }

  // Toggle: remove if already picked; otherwise add if under the limit.
  const { data: existing, error: existingError } = await admin
    .from("award_vote")
    .select("id, target_id")
    .eq("tournament_id", tournament.id)
    .eq("award_key", awardKey)
    .eq("voter_id", user.id);
  if (existingError) {
    return { error: "Could not load your ballot — check your signal and try again." };
  }
  const rows = existing ?? [];
  const mine = rows.find((r) => r.target_id === targetId);

  if (mine) {
    const { error } = await admin.from("award_vote").delete().eq("id", mine.id);
    if (error) {
      if (error.message?.includes("voting_closed")) {
        return { error: "Voting has closed." };
      }
      return { error: "Could not change your vote — please try again." };
    }
  } else if (rows.length >= award.votes) {
    return {
      error: `You've used all ${award.votes} votes for ${award.title} — tap one of your picks to change it.`,
    };
  } else {
    const { error } = await admin.from("award_vote").insert({
      tournament_id: tournament.id,
      award_key: awardKey,
      voter_id: user.id,
      target_type: award.kind,
      target_id: targetId,
    });
    // 23505 = duplicate target from a racing identical tap; the vote is already
    // recorded, so treat it as success. The DB trigger enforces the 2-vote cap.
    if (error && error.code !== "23505") {
      if (error.message?.includes("voting_closed")) {
        return { error: "Voting has closed." };
      }
      if (error.message?.includes("admin_nominee_not_eligible")) {
        return { error: ORGANISER_VOTE_MESSAGE };
      }
      if (error.message?.includes("vote_limit_reached")) {
        return {
          error: `You've used all ${award.votes} votes for ${award.title} — tap one of your picks to change it.`,
        };
      }
      return { error: "Could not save your vote — please try again." };
    }
  }

  revalidatePath("/awards");
  revalidatePath("/awards/results");
  return {};
}

// Owner/helper control: open, close, or reset voting.
export async function setVotingStatus(
  _prev: VoteState,
  fd: FormData,
): Promise<VoteState> {
  const status = String(fd.get("status") ?? "");
  if (!["pending", "open", "closed"].includes(status)) {
    return { error: "Unknown voting status." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: prof } = await admin
    .from("profile")
    .select("is_owner, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_owner && !prof?.is_admin) {
    return { error: "Only an organiser can change voting." };
  }

  const { data: tournament } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return { error: "No active tournament." };

  const { data: updated, error } = await admin
    .from("tournament")
    .update({ voting_status: status })
    .eq("id", tournament.id)
    .select("id");
  if (error || !updated || updated.length === 0) {
    return {
      error: "Could not change voting — check your signal and try again.",
    };
  }
  revalidatePath("/awards");
  revalidatePath("/awards/results");
  return {};
}
