// RLS smoke test for tournament/team/player. Builds a throwaway ARCHIVED
// tournament (so it never clashes with the one-active-tournament rule) with a
// member and an outsider, checks the read rules, then cleans everything up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 7);
const created = [];
let tournamentId;
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

async function makeUser(tag) {
  const email = `smoke_${tag}_${suffix}@springbowls.local`;
  const password = "smoke-password-123";
  let body;
  let status = 0;
  for (const delay of [0, 400, 900, 1600]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    body = await res.json();
    status = res.status;
    if (res.ok && body.id) break;
    const message = String(body.message ?? body.msg ?? "");
    if (!/jwt|signature|unverifiable|unrecognized|kid|temporar/i.test(message)) {
      break;
    }
  }
  if (!body?.id) {
    throw new Error(
      `Could not create smoke ${tag} user (${status}): ${body?.message ?? body?.msg ?? JSON.stringify(body)}`,
    );
  }
  created.push(body.id);
  const { error: profileError } = await admin
    .from("profile")
    .insert({ id: body.id, username: `smoke_${tag}_${suffix}`, display_name: tag });
  if (profileError) {
    throw new Error(`Could not create smoke ${tag} profile: ${profileError.message}`);
  }
  return { id: body.id, email, password };
}

async function signedInClient(email, password) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Smoke sign-in failed: ${error.message}`);
  return c;
}

try {
  const owner = await makeUser("owner"); // stand-in creator (not the real owner)
  const member = await makeUser("member");
  const outsider = await makeUser("outsider");
  const helper = await makeUser("helper");
  await admin.from("profile").update({ is_admin: true }).eq("id", helper.id);

  const { data: t, error: tournamentError } = await admin
    .from("tournament")
    .insert({ name: "Smoke", status: "archived", created_by: owner.id })
    .select("id")
    .single();
  if (tournamentError || !t) {
    throw new Error(`Could not create smoke tournament: ${tournamentError?.message}`);
  }
  tournamentId = t.id;
  const { error: archivedDrawError } = await admin.rpc(
    "apply_tournament_draw",
    {
      p_tournament_id: tournamentId,
      p_assignments: [],
      p_fixtures: [],
    },
  );
  check(
    "the atomic draw function is installed and rejects a non-setup tournament",
    !!archivedDrawError?.message.includes("draw_already_live"),
  );
  const { error: archivedRosterEditError } = await admin.rpc(
    "update_setup_team",
    {
      p_tournament_id: tournamentId,
      p_team_id: crypto.randomUUID(),
      p_team_name: "No change",
      p_players: [],
    },
  );
  check(
    "roster edits are installed and reject a non-setup tournament",
    !!archivedRosterEditError?.message.includes("roster_locked"),
  );
  const { error: archivedRosterDeleteError } = await admin.rpc(
    "delete_setup_team",
    {
      p_tournament_id: tournamentId,
      p_team_id: crypto.randomUUID(),
    },
  );
  check(
    "roster removals are installed and reject a non-setup tournament",
    !!archivedRosterDeleteError?.message.includes("roster_locked"),
  );

  const { data: team, error: teamError } = await admin
    .from("team")
    .insert({ tournament_id: tournamentId, name: "Smoke Team" })
    .select("id")
    .single();
  if (teamError || !team) {
    throw new Error(`Could not create smoke team: ${teamError?.message}`);
  }

  const { data: memberPlayer, error: playerError } = await admin
    .from("player")
    .insert({
      tournament_id: tournamentId,
      team_id: team.id,
      profile_id: member.id,
      display_name: "Member",
      role: "player",
    })
    .select("id")
    .single();
  if (playerError || !memberPlayer) {
    throw new Error(`Could not create smoke player: ${playerError?.message}`);
  }
  const { data: helperPlayer, error: helperPlayerError } = await admin
    .from("player")
    .insert({
      tournament_id: tournamentId,
      team_id: team.id,
      profile_id: helper.id,
      display_name: "Helper",
      role: "player",
    })
    .select("id")
    .single();
  if (helperPlayerError || !helperPlayer) {
    throw new Error(
      `Could not create smoke helper player: ${helperPlayerError?.message}`,
    );
  }

  const memberClient = await signedInClient(member.email, member.password);
  const { data: mT } = await memberClient
    .from("tournament")
    .select("id")
    .eq("id", tournamentId);
  check("a member can read their tournament", (mT?.length ?? 0) === 1);
  const { data: mTeams } = await memberClient
    .from("team")
    .select("id")
    .eq("tournament_id", tournamentId);
  check("a member can read their teams", (mTeams?.length ?? 0) === 1);
  await admin.from("qualification_tiebreak").insert({
    tournament_id: tournamentId,
    group_label: "A",
    ordered_team_ids: [team.id, crypto.randomUUID()],
    decided_by: helper.id,
  });
  const { data: memberTiebreaks } = await memberClient
    .from("qualification_tiebreak")
    .select("group_label")
    .eq("tournament_id", tournamentId);
  check(
    "a member can read an organiser-confirmed qualification tiebreak",
    (memberTiebreaks?.length ?? 0) === 1,
  );

  const outClient = await signedInClient(outsider.email, outsider.password);
  const { error: outsiderDrawError } = await outClient.rpc(
    "apply_tournament_draw",
    {
      p_tournament_id: tournamentId,
      p_assignments: [],
      p_fixtures: [],
    },
  );
  check(
    "a regular client cannot call the atomic draw function",
    !!outsiderDrawError,
  );
  const { error: outsiderRosterEditError } = await outClient.rpc(
    "update_setup_team",
    {
      p_tournament_id: tournamentId,
      p_team_id: team.id,
      p_team_name: "Hax",
      p_players: [],
    },
  );
  const { error: outsiderRosterDeleteError } = await outClient.rpc(
    "delete_setup_team",
    {
      p_tournament_id: tournamentId,
      p_team_id: team.id,
    },
  );
  check(
    "a regular client cannot call roster maintenance functions",
    !!outsiderRosterEditError && !!outsiderRosterDeleteError,
  );
  const { data: oT } = await outClient
    .from("tournament")
    .select("id")
    .eq("id", tournamentId);
  check("an outsider cannot read the tournament (RLS)", (oT?.length ?? 0) === 0);
  const { data: oPlayers } = await outClient
    .from("player")
    .select("id")
    .eq("tournament_id", tournamentId);
  check("an outsider cannot read its players (RLS)", (oPlayers?.length ?? 0) === 0);
  const { data: outsiderTiebreaks } = await outClient
    .from("qualification_tiebreak")
    .select("group_label")
    .eq("tournament_id", tournamentId);
  check(
    "an outsider cannot read qualification tiebreaks (RLS)",
    (outsiderTiebreaks?.length ?? 0) === 0,
  );

  const helperClient = await signedInClient(helper.email, helper.password);
  const { data: hT } = await helperClient
    .from("tournament")
    .select("id")
    .eq("id", tournamentId);
  check("a standalone helper can read the tournament", (hT?.length ?? 0) === 1);
  const { data: hTeams } = await helperClient
    .from("team")
    .select("id")
    .eq("tournament_id", tournamentId);
  check("a standalone helper can read its teams", (hTeams?.length ?? 0) === 1);

  // An outsider must not be able to create a tournament (owner-only insert).
  const { error: insErr } = await outClient
    .from("tournament")
    .insert({ name: "Hax", created_by: outsider.id });
  check("a non-owner cannot create a tournament (RLS)", !!insErr);

  // Score entry: ends are readable by members but never writable by clients
  // (only the submitScore server action writes, via the service role).
  const { data: fx, error: fixtureError } = await admin
    .from("fixture")
    .insert({ tournament_id: tournamentId, team_a_id: team.id })
    .select("id")
    .single();
  if (fixtureError || !fx) {
    throw new Error(`Could not create smoke fixture: ${fixtureError?.message}`);
  }
  const { data: hFixtures } = await helperClient
    .from("fixture")
    .select("id")
    .eq("id", fx.id);
  check(
    "a standalone helper can read tournament fixtures",
    (hFixtures?.length ?? 0) === 1,
  );
  await admin
    .from("fixture_end")
    .insert({ fixture_id: fx.id, end_number: 1, shots_a: 3, shots_b: 1 });

  const { data: mEnds } = await memberClient
    .from("fixture_end")
    .select("id")
    .eq("fixture_id", fx.id);
  check("a member can read fixture ends", (mEnds?.length ?? 0) === 1);

  const { error: endWriteErr } = await memberClient
    .from("fixture_end")
    .insert({ fixture_id: fx.id, end_number: 2, shots_a: 9, shots_b: 0 });
  check("a client cannot write a fixture end directly (RLS)", !!endWriteErr);

  const scoreAttempts = await Promise.all([
    admin
      .from("fixture")
      .update({ status: "completed", shots_a: 4, shots_b: 2 })
      .eq("id", fx.id)
      .in("status", ["scheduled", "live"])
      .select("id"),
    admin
      .from("fixture")
      .update({ status: "walkover", shots_a: 10, shots_b: 0 })
      .eq("id", fx.id)
      .in("status", ["scheduled", "live"])
      .select("id"),
  ]);
  check(
    "only one racing result can lock a fixture",
    scoreAttempts.filter((attempt) => (attempt.data?.length ?? 0) === 1).length === 1,
  );
  const { data: staleWalkover } = await admin
    .from("fixture")
    .update({ status: "walkover", shots_a: 10, shots_b: 0 })
    .eq("id", fx.id)
    .in("status", ["scheduled", "live"])
    .select("id");
  check(
    "a stale walkover cannot replace an entered score",
    (staleWalkover?.length ?? 0) === 0,
  );

  // Final closure is enforced in the same DB transaction as the ballot write.
  await admin
    .from("tournament")
    .update({ voting_status: "open" })
    .eq("id", tournamentId);
  const { error: adminNomineeError } = await admin.from("award_vote").insert({
    tournament_id: tournamentId,
    award_key: "bowl_of_the_day",
    voter_id: member.id,
    target_type: "player",
    target_id: helperPlayer.id,
  });
  check(
    "the database rejects an individual-award vote for an organiser",
    !!adminNomineeError?.message.includes("admin_nominee_not_eligible"),
  );
  const { data: vote } = await admin
    .from("award_vote")
    .insert({
      tournament_id: tournamentId,
      award_key: "best_dressed",
      voter_id: member.id,
      target_type: "player",
      target_id: memberPlayer.id,
    })
    .select("id")
    .single();
  check("a vote can be recorded while voting is open", !!vote?.id);

  await admin
    .from("tournament")
    .update({ voting_status: "closed" })
    .eq("id", tournamentId);
  const { error: closedInsertError } = await admin.from("award_vote").insert({
    tournament_id: tournamentId,
    award_key: "coolest_brit",
    voter_id: member.id,
    target_type: "player",
    target_id: memberPlayer.id,
  });
  check(
    "the database rejects a vote after voting closes",
    !!closedInsertError?.message.includes("voting_closed"),
  );
  const { error: closedBowlError } = await admin.from("award_vote").insert({
    tournament_id: tournamentId,
    award_key: "bowl_of_the_day",
    voter_id: helper.id,
    target_type: "player",
    target_id: memberPlayer.id,
  });
  check(
    "closing voting also freezes Bowl of the Day",
    !!closedBowlError?.message.includes("voting_closed"),
  );
  const { error: closedDeleteError } = await admin
    .from("award_vote")
    .delete()
    .eq("id", vote?.id ?? crypto.randomUUID());
  check(
    "the database rejects a vote removal after voting closes",
    !!closedDeleteError?.message.includes("voting_closed"),
  );

  // Resetting a rehearsal event must cascade through closed voting data. The
  // delete trigger deliberately permits the parent tournament's cascade.
  const { error: closedCascadeError } = await admin
    .from("tournament")
    .delete()
    .eq("id", tournamentId);
  check(
    "a test tournament can be deleted while voting is closed",
    !closedCascadeError,
  );
  if (closedCascadeError) {
    // Leave the finally block a cleanable state if this assertion ever fails.
    await admin
      .from("tournament")
      .update({ voting_status: "open" })
      .eq("id", tournamentId);
  } else {
    tournamentId = undefined;
  }
} finally {
  if (tournamentId) await admin.from("tournament").delete().eq("id", tournamentId);
  for (const id of created)
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  console.log("cleaned up");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
