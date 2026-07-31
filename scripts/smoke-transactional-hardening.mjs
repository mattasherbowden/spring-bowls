// Transactional smoke checks for functions that require a setup-phase event or
// the real owner row. Every mutation is rolled back before this script exits.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = encodeURIComponent(env.SUPABASE_DB_PASSWORD ?? "");
const region = env.SUPABASE_DB_REGION;
const connectionString = region
  ? `postgresql://postgres.${ref}:${password}@aws-0-${region}.pooler.supabase.com:5432/postgres`
  : `postgresql://postgres:${password}@db.${ref}.supabase.co:5432/postgres`;
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

await client.connect();
try {
  await client.query("begin");
  const active = await client.query(`
    select id, created_by
      from public.tournament
     where status <> 'archived'
     limit 1
  `);
  if (active.rowCount !== 1) throw new Error("Expected one active tournament");
  const activeId = active.rows[0].id;
  const ownerId = active.rows[0].created_by;
  const guestProfiles = await client.query(
    `
      select distinct player.profile_id
        from public.player as player
        join public.profile as profile on profile.id = player.profile_id
       where player.tournament_id = $1
         and not profile.is_owner
         and not profile.is_admin
       limit 2
    `,
    [activeId],
  );
  if (guestProfiles.rowCount !== 2) {
    throw new Error("Expected two guest profiles in the rehearsal roster");
  }
  await client.query(
    "update public.profile set login_password = $1 where id = $2",
    ["transactional-smoke-unique-password", guestProfiles.rows[0].profile_id],
  );
  let duplicatePasswordRejected = false;
  await client.query("savepoint duplicate_login_password");
  try {
    await client.query(
      "update public.profile set login_password = $1 where id = $2",
      [
        "transactional-smoke-unique-password",
        guestProfiles.rows[1].profile_id,
      ],
    );
  } catch (error) {
    duplicatePasswordRejected =
      error?.code === "23505" &&
      /profile_login_password_unique/.test(error?.constraint ?? "");
    await client.query("rollback to savepoint duplicate_login_password");
  }
  await client.query("release savepoint duplicate_login_password");
  check(
    "generated event passwords cannot silently collide",
    duplicatePasswordRejected,
  );

  // Make room for a setup tournament inside this uncommitted transaction. Other
  // sessions continue to see the real event as live until the final rollback.
  await client.query(
    "update public.tournament set status = 'archived' where id = $1",
    [activeId],
  );
  const tournament = await client.query(
    `
      insert into public.tournament
        (name, status, team_size, created_by, play_status, fixtures_open_time)
      values ('Transactional smoke', 'setup', 2, $1, 'preview', '13:00')
      returning id, play_status, fixtures_open_time
    `,
    [ownerId],
  );
  const tournamentId = tournament.rows[0].id;
  check(
    "new draws can be published in a locked preview state",
    tournament.rows[0].play_status === "preview" &&
      tournament.rows[0].fixtures_open_time === "13:00",
  );
  const submitKey = "8be2538f-8cc4-4f0c-a8f0-0b2b1dca59b8";
  await client.query(
    "select public.create_setup_team($1, $2, $3)",
    [tournamentId, "Idempotency first", submitKey],
  );
  let duplicateRejected = false;
  await client.query("savepoint duplicate_team_submission");
  try {
    await client.query(
      `
        select public.create_setup_team($1, 'Idempotency duplicate', $2)
      `,
      [tournamentId, submitKey],
    );
  } catch (error) {
    duplicateRejected =
      error?.code === "23505" &&
      /team_submit_key_unique/.test(error?.constraint ?? "");
    await client.query("rollback to savepoint duplicate_team_submission");
  }
  await client.query("release savepoint duplicate_team_submission");
  check(
    "setup team submission key rejects a double insert",
    duplicateRejected,
  );

  const team = await client.query(
    `
      insert into public.team (tournament_id, name)
      values ($1, 'Before')
      returning id
    `,
    [tournamentId],
  );
  const teamId = team.rows[0].id;
  const players = [];
  for (const [index, profile] of guestProfiles.rows.entries()) {
    const inserted = await client.query(
      `
        insert into public.player
          (tournament_id, team_id, profile_id, display_name, nationality)
        values ($1, $2, $3, $4, $5)
        returning id
      `,
      [
        tournamentId,
        teamId,
        profile.profile_id,
        `Before ${index + 1}`,
        index === 0 ? "brit" : "kiwi",
      ],
    );
    players.push(inserted.rows[0].id);
  }

  await client.query(
    "select public.update_setup_team($1, $2, $3, $4::jsonb)",
    [
      tournamentId,
      teamId,
      "After",
      JSON.stringify([
        { id: players[0], display_name: "Edited One", nationality: "kiwi" },
        { id: players[1], display_name: "Edited Two", nationality: "brit" },
      ]),
    ],
  );
  const edited = await client.query(
    `
      select team.name,
             array_agg(player.display_name order by player.display_name) as names
        from public.team as team
        join public.player as player on player.team_id = team.id
       where team.id = $1
       group by team.name
    `,
    [teamId],
  );
  check(
    "setup roster edit updates the whole team transactionally",
    edited.rows[0]?.name === "After" &&
      edited.rows[0]?.names?.join(",") === "Edited One,Edited Two",
  );

  const removed = await client.query(
    "select * from public.delete_setup_team($1, $2)",
    [tournamentId, teamId],
  );
  const remaining = await client.query(
    "select count(*)::int as count from public.player where team_id = $1",
    [teamId],
  );
  check(
    "setup roster removal returns guest logins and removes every roster row",
    removed.rowCount === 2 && remaining.rows[0].count === 0,
  );

  const drawTeamOne = await client.query(
    "select id from public.team where tournament_id = $1 and submit_key = $2",
    [tournamentId, submitKey],
  );
  const drawTeamTwo = await client.query(
    `
      insert into public.team (tournament_id, name)
      values ($1, 'Draw second')
      returning id
    `,
    [tournamentId],
  );
  const drawTeamIds = [
    drawTeamOne.rows[0].id,
    drawTeamTwo.rows[0].id,
  ];
  const assignments = drawTeamIds.map((id) => ({
    id,
    group_label: "A",
  }));
  const fixtureRows = [
    {
      group_label: "A",
      round: 1,
      rink: 1,
      order_index: 0,
      team_a_id: drawTeamIds[0],
      team_b_id: drawTeamIds[1],
    },
  ];
  const previewPlayers = [];
  for (const [index, profile] of guestProfiles.rows.entries()) {
    const inserted = await client.query(
      `
        insert into public.player
          (tournament_id, team_id, profile_id, display_name, nationality)
        values ($1, $2, $3, $4, $5)
        returning id
      `,
      [
        tournamentId,
        drawTeamIds[index],
        profile.profile_id,
        `Preview ${index + 1}`,
        index === 0 ? "brit" : "kiwi",
      ],
    );
    previewPlayers.push(inserted.rows[0].id);
  }

  let incompleteRosterRejected = false;
  await client.query("savepoint incomplete_roster_draw");
  try {
    await client.query(
      "select public.apply_tournament_draw_v2($1, $2, $3, $4::jsonb, $5::jsonb)",
      [
        tournamentId,
        3,
        4,
        JSON.stringify(assignments),
        JSON.stringify(fixtureRows),
      ],
    );
  } catch (error) {
    incompleteRosterRejected =
      /draw_roster_incomplete/.test(error?.message ?? "");
    await client.query("rollback to savepoint incomplete_roster_draw");
  }
  await client.query("release savepoint incomplete_roster_draw");
  check(
    "the draw waits for both accounts in a concurrently-added pair",
    incompleteRosterRejected,
  );

  const extraProfile = await client.query(
    `
      select id
        from public.profile
       where id <> $1
         and not (id = any($2::uuid[]))
       limit 1
    `,
    [
      ownerId,
      guestProfiles.rows.map((profile) => profile.profile_id),
    ],
  );
  if (extraProfile.rowCount !== 1) {
    throw new Error("Expected one extra profile for the draw race check");
  }
  for (const [index, profileId] of [
    ownerId,
    extraProfile.rows[0].id,
  ].entries()) {
    const inserted = await client.query(
      `
        insert into public.player
          (tournament_id, team_id, profile_id, display_name, nationality)
        values ($1, $2, $3, $4, $5)
        returning id
      `,
      [
        tournamentId,
        drawTeamIds[index],
        profileId,
        `Preview extra ${index + 1}`,
        index === 0 ? "kiwi" : "brit",
      ],
    );
    previewPlayers.push(inserted.rows[0].id);
  }
  await client.query(
    `
      update public.player
         set photo_partner_id = case
               when id = $1 then $2::uuid
               else $1::uuid
             end,
             photo_done = true,
             photo_email = 'preview@example.com'
       where id = any($3::uuid[])
    `,
    [previewPlayers[0], previewPlayers[1], previewPlayers],
  );
  const credentialsBefore = await client.query(
    `
      select id, username, login_password
        from public.profile
       where id = any($1::uuid[])
       order by id
    `,
    [guestProfiles.rows.map((profile) => profile.profile_id)],
  );
  await client.query(
    "select public.apply_tournament_draw_v2($1, $2, $3, $4::jsonb, $5::jsonb)",
    [
      tournamentId,
      3,
      4,
      JSON.stringify(assignments),
      JSON.stringify(fixtureRows),
    ],
  );
  await client.query(
    `
      insert into public.qualification_tiebreak
        (tournament_id, group_label, ordered_team_ids, decided_by)
      values ($1, 'A', $2::uuid[], $3)
    `,
    [tournamentId, drawTeamIds, ownerId],
  );
  const publishedPreview = await client.query(
    `
      select tournament.status,
             count(fixture.id)::int as fixture_count
        from public.tournament as tournament
        left join public.fixture as fixture
          on fixture.tournament_id = tournament.id
       where tournament.id = $1
       group by tournament.status
    `,
    [tournamentId],
  );
  check(
    "the settings-aware draw publishes one complete preview",
    publishedPreview.rows[0]?.status === "live" &&
      publishedPreview.rows[0]?.fixture_count === 1,
  );
  const previewFixtureBefore = await client.query(
    `
      select md5(
        coalesce(
          jsonb_agg(
            jsonb_build_array(
              id, stage, group_label, round, rink, order_index,
              team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id
            ) order by id
          )::text,
          '[]'
        )
      ) as fingerprint
        from public.fixture
       where tournament_id = $1
    `,
    [tournamentId],
  );
  await client.query(
    "select public.update_published_preview_team($1, $2, $3, $4::jsonb)",
    [
      tournamentId,
      drawTeamIds[0],
      "Preview replacement",
      JSON.stringify([
        {
          id: previewPlayers[0],
          display_name: "TBA",
          nationality: "brit",
        },
        {
          id: previewPlayers[2],
          display_name: "Replacement Partner",
          nationality: "kiwi",
        },
      ]),
    ],
  );
  const previewCorrection = await client.query(
    `
      select team.name, team.group_label, team.seed,
             array_agg(player.display_name order by player.display_name) as names,
             md5(
               coalesce(
                 (
                   select jsonb_agg(
                     jsonb_build_array(
                       fixture.id, fixture.stage, fixture.group_label,
                       fixture.round, fixture.rink, fixture.order_index,
                       fixture.team_a_id, fixture.team_b_id, fixture.status,
                       fixture.shots_a, fixture.shots_b, fixture.winner_team_id
                     ) order by fixture.id
                   )::text
                     from public.fixture as fixture
                    where fixture.tournament_id = $1
                 ),
                 '[]'
               )
             ) as fixture_fingerprint
        from public.team as team
        join public.player as player on player.team_id = team.id
       where team.id = $2
       group by team.id
    `,
    [tournamentId, drawTeamIds[0]],
  );
  check(
    "a preview replacement changes labels without touching the draw",
    previewCorrection.rows[0]?.name === "Preview replacement" &&
      previewCorrection.rows[0]?.group_label === "A" &&
      previewCorrection.rows[0]?.names?.join(",") ===
        "Replacement Partner,TBA" &&
      previewCorrection.rows[0]?.fixture_fingerprint ===
        previewFixtureBefore.rows[0]?.fingerprint,
  );

  let wrongTeamPlayerRejected = false;
  await client.query("savepoint wrong_preview_player");
  try {
    await client.query(
      "select public.update_published_preview_team($1, $2, $3, $4::jsonb)",
      [
        tournamentId,
        drawTeamIds[0],
        "Should not save",
        JSON.stringify([
          {
            id: previewPlayers[0],
            display_name: "Wrong One",
            nationality: "brit",
          },
          {
            id: previewPlayers[1],
            display_name: "Wrong Team",
            nationality: "kiwi",
          },
        ]),
      ],
    );
  } catch (error) {
    wrongTeamPlayerRejected = /player_not_in_team/.test(error?.message ?? "");
    await client.query("rollback to savepoint wrong_preview_player");
  }
  await client.query("release savepoint wrong_preview_player");
  check(
    "a replacement cannot move or overwrite another team's player",
    wrongTeamPlayerRejected,
  );

  let startedCorrectionRejected = false;
  await client.query("savepoint correction_after_start");
  try {
    await client.query(
      "select public.start_tournament_play($1)",
      [tournamentId],
    );
    await client.query(
      "select public.update_published_preview_team($1, $2, $3, $4::jsonb)",
      [
        tournamentId,
        drawTeamIds[0],
        "Too late",
        JSON.stringify([
          {
            id: previewPlayers[0],
            display_name: "Too Late",
            nationality: "brit",
          },
          {
            id: previewPlayers[2],
            display_name: "Still Too Late",
            nationality: "kiwi",
          },
        ]),
      ],
    );
  } catch (error) {
    startedCorrectionRejected = /preview_roster_locked/.test(
      error?.message ?? "",
    );
    await client.query("rollback to savepoint correction_after_start");
  }
  await client.query("release savepoint correction_after_start");
  check(
    "a Start/replace race cannot edit the roster after play opens",
    startedCorrectionRejected,
  );

  await client.query(
    "select public.set_live_photo_done($1, $2, true)",
    [tournamentId, guestProfiles.rows[0].profile_id],
  );
  await client.query(
    "select public.set_live_photo_email($1, $2, $3)",
    [
      tournamentId,
      guestProfiles.rows[0].profile_id,
      "live-preview@example.com",
    ],
  );
  check("photo challenge writes work while a preview is published", true);

  await client.query(
    "select public.reopen_tournament_preview($1)",
    [tournamentId],
  );
  const reopened = await client.query(
    `
      select tournament.status,
             tournament.play_status,
             (select count(*)::int
                from public.fixture
               where tournament_id = tournament.id) as fixture_count,
             (select count(*)::int
                from public.team
               where tournament_id = tournament.id
                 and (group_label is not null or seed is not null)) as assigned_teams,
             (select count(*)::int
                from public.player
               where tournament_id = tournament.id) as player_count,
             (select count(*)::int
                from public.player
               where tournament_id = tournament.id
                 and (
                   photo_partner_id is not null
                   or photo_done
                 )) as stale_photo_players,
             (select count(*)::int
                from public.player
               where tournament_id = tournament.id
                 and photo_email is not null) as preserved_photo_emails,
             (select count(*)::int
                from public.qualification_tiebreak
               where tournament_id = tournament.id) as tiebreak_count
        from public.tournament as tournament
       where tournament.id = $1
    `,
    [tournamentId],
  );
  const credentialsAfter = await client.query(
    `
      select id, username, login_password
        from public.profile
       where id = any($1::uuid[])
       order by id
    `,
    [guestProfiles.rows.map((profile) => profile.profile_id)],
  );
  check(
    "reopening removes only draw-derived state",
    reopened.rows[0]?.status === "setup" &&
      reopened.rows[0]?.play_status === "preview" &&
      reopened.rows[0]?.fixture_count === 0 &&
      reopened.rows[0]?.assigned_teams === 0 &&
      reopened.rows[0]?.player_count === 4 &&
      reopened.rows[0]?.stale_photo_players === 0 &&
      reopened.rows[0]?.preserved_photo_emails === 4 &&
      reopened.rows[0]?.tiebreak_count === 0,
  );
  check(
    "reopening preserves usernames and passwords exactly",
    JSON.stringify(credentialsAfter.rows) ===
      JSON.stringify(credentialsBefore.rows),
  );
  let editingPhotoRejected = false;
  await client.query("savepoint photo_during_edit");
  try {
    await client.query(
      "select public.set_live_photo_done($1, $2, true)",
      [tournamentId, guestProfiles.rows[0].profile_id],
    );
  } catch (error) {
    editingPhotoRejected = /photo_unavailable/.test(error?.message ?? "");
    await client.query("rollback to savepoint photo_during_edit");
  }
  await client.query("release savepoint photo_during_edit");
  check(
    "a stale Photo Bomb tap cannot write into an open edit window",
    editingPhotoRejected,
  );

  await client.query(
    "select public.reopen_tournament_preview($1)",
    [tournamentId],
  );
  check("a double Edit preview submission is idempotent", true);

  let setupStartRejected = false;
  await client.query("savepoint start_during_edit");
  try {
    await client.query(
      "select public.start_tournament_play($1)",
      [tournamentId],
    );
  } catch (error) {
    setupStartRejected = /play_not_live/.test(error?.message ?? "");
    await client.query("rollback to savepoint start_during_edit");
  }
  await client.query("release savepoint start_during_edit");
  check(
    "Start cannot win after Edit has reopened setup",
    setupStartRejected,
  );

  await client.query(
    "select public.update_tournament_setup_settings($1, $2)",
    [tournamentId, 4],
  );
  let invalidRinksRejected = false;
  await client.query("savepoint invalid_rinks");
  try {
    await client.query(
      "select public.update_tournament_setup_settings($1, $2)",
      [tournamentId, 0],
    );
  } catch (error) {
    invalidRinksRejected = /invalid_rink_count/.test(error?.message ?? "");
    await client.query("rollback to savepoint invalid_rinks");
  }
  await client.query("release savepoint invalid_rinks");
  check("invalid rink counts are rejected atomically", invalidRinksRejected);

  await client.query(
    "select public.update_tournament_setup_settings($1, $2)",
    [tournamentId, 5],
  );
  let staleDrawRejected = false;
  await client.query("savepoint stale_draw_settings");
  try {
    await client.query(
      "select public.apply_tournament_draw_v2($1, $2, $3, $4::jsonb, $5::jsonb)",
      [
        tournamentId,
        4,
        4,
        JSON.stringify(assignments),
        JSON.stringify(fixtureRows),
      ],
    );
  } catch (error) {
    staleDrawRejected = /draw_settings_changed/.test(error?.message ?? "");
    await client.query("rollback to savepoint stale_draw_settings");
  }
  await client.query("release savepoint stale_draw_settings");
  const afterStaleDraw = await client.query(
    `
      select status, rink_count,
             (select count(*)::int from public.fixture where tournament_id = $1)
               as fixture_count
        from public.tournament
       where id = $1
    `,
    [tournamentId],
  );
  check(
    "a rink-edit/draw race cannot publish a stale schedule",
    staleDrawRejected &&
      afterStaleDraw.rows[0]?.status === "setup" &&
      afterStaleDraw.rows[0]?.rink_count === 5 &&
      afterStaleDraw.rows[0]?.fixture_count === 0,
  );

  await client.query(
    "select public.update_tournament_setup_settings($1, $2)",
    [tournamentId, 4],
  );
  await client.query(
    "select public.apply_tournament_draw_v2($1, $2, $3, $4::jsonb, $5::jsonb)",
    [
      tournamentId,
      4,
      4,
      JSON.stringify(assignments),
      JSON.stringify(fixtureRows),
    ],
  );

  let resultCorrectionRejected = false;
  await client.query("savepoint correction_with_result");
  try {
    await client.query(
      `
        update public.fixture
           set status = 'completed',
               shots_a = 2,
               shots_b = 1,
               winner_team_id = $2
         where tournament_id = $1
      `,
      [tournamentId, drawTeamIds[0]],
    );
    await client.query(
      "select public.update_published_preview_team($1, $2, $3, $4::jsonb)",
      [
        tournamentId,
        drawTeamIds[0],
        "Must not save",
        JSON.stringify([
          {
            id: previewPlayers[0],
            display_name: "Must Not Save",
            nationality: "brit",
          },
          {
            id: previewPlayers[2],
            display_name: "Also Must Not Save",
            nationality: "kiwi",
          },
        ]),
      ],
    );
  } catch (error) {
    resultCorrectionRejected = /preview_roster_activity_exists/.test(
      error?.message ?? "",
    );
    await client.query("rollback to savepoint correction_with_result");
  }
  await client.query("release savepoint correction_with_result");
  check(
    "a preview replacement refuses to change a roster after a result exists",
    resultCorrectionRejected,
  );

  let resultReopenRejected = false;
  await client.query("savepoint preview_with_result");
  try {
    await client.query(
      `
        update public.fixture
           set status = 'completed',
               shots_a = 2,
               shots_b = 1,
               winner_team_id = $2
         where tournament_id = $1
      `,
      [tournamentId, drawTeamIds[0]],
    );
    await client.query(
      "select public.reopen_tournament_preview($1)",
      [tournamentId],
    );
  } catch (error) {
    resultReopenRejected =
      /preview_edit_results_exist/.test(error?.message ?? "");
    await client.query("rollback to savepoint preview_with_result");
  }
  await client.query("release savepoint preview_with_result");
  check(
    "Edit preview refuses to erase even one entered result",
    resultReopenRejected,
  );

  let startedReopenRejected = false;
  await client.query("savepoint start_then_edit");
  try {
    await client.query(
      "select public.start_tournament_play($1)",
      [tournamentId],
    );
    await client.query(
      "select public.reopen_tournament_preview($1)",
      [tournamentId],
    );
  } catch (error) {
    startedReopenRejected =
      /preview_edit_play_open/.test(error?.message ?? "");
    await client.query("rollback to savepoint start_then_edit");
  }
  await client.query("release savepoint start_then_edit");
  check(
    "Start winning the row lock makes a simultaneous Edit refuse safely",
    startedReopenRejected,
  );

  let votedReopenRejected = false;
  await client.query("savepoint vote_then_edit");
  try {
    await client.query(
      "select public.start_tournament_play($1)",
      [tournamentId],
    );
    await client.query(
      `
        insert into public.award_vote
          (tournament_id, award_key, voter_id, target_type, target_id)
        values ($1, 'bowl_of_the_day', $2, 'player', $3)
      `,
      [
        tournamentId,
        guestProfiles.rows[0].profile_id,
        previewPlayers[1],
      ],
    );
    await client.query(
      "update public.tournament set play_status = 'preview' where id = $1",
      [tournamentId],
    );
    await client.query(
      "select public.reopen_tournament_preview($1)",
      [tournamentId],
    );
  } catch (error) {
    votedReopenRejected =
      /preview_edit_votes_exist/.test(error?.message ?? "");
    await client.query("rollback to savepoint vote_then_edit");
  }
  await client.query("release savepoint vote_then_edit");
  check(
    "Edit preview refuses to erase an existing vote even in an invalid state",
    votedReopenRejected,
  );

  await client.query(
    "select public.reopen_tournament_preview($1)",
    [tournamentId],
  );
  await client.query(
    "delete from public.player where id = any($1::uuid[])",
    [previewPlayers],
  );

  const votingTeam = await client.query(
    `
      insert into public.team (tournament_id, name)
      values ($1, 'Voting smoke')
      returning id
    `,
    [tournamentId],
  );
  const ownerPlayer = await client.query(
    `
      insert into public.player
        (tournament_id, team_id, profile_id, display_name, nationality)
      values ($1, $2, $3, 'Owner target', 'kiwi')
      returning id
    `,
    [tournamentId, votingTeam.rows[0].id, ownerId],
  );
  await client.query(
    `
      insert into public.player
        (tournament_id, team_id, profile_id, display_name, nationality)
      values ($1, $2, $3, 'Voting guest', 'brit')
    `,
    [
      tournamentId,
      votingTeam.rows[0].id,
      guestProfiles.rows[0].profile_id,
    ],
  );
  await client.query(
    "update public.tournament set status = 'live' where id = $1",
    [tournamentId],
  );
  let previewVoteRejected = false;
  await client.query("savepoint preview_vote");
  try {
    await client.query(
      `
        insert into public.award_vote
          (tournament_id, award_key, voter_id, target_type, target_id)
        values ($1, 'bowl_of_the_day', $2, 'player', $3)
      `,
      [
        tournamentId,
        guestProfiles.rows[0].profile_id,
        ownerPlayer.rows[0].id,
      ],
    );
  } catch (error) {
    previewVoteRejected =
      error?.code === "P0001" && /voting_closed/.test(error?.message ?? "");
    await client.query("rollback to savepoint preview_vote");
  }
  await client.query("release savepoint preview_vote");
  check(
    "the database rejects Bowl of the Day votes during fixture preview",
    previewVoteRejected,
  );
  await client.query(
    "update public.tournament set play_status = 'open' where id = $1",
    [tournamentId],
  );
  const pendingBowlVote = await client.query(
    `
      insert into public.award_vote
        (tournament_id, award_key, voter_id, target_type, target_id)
      values ($1, 'bowl_of_the_day', $2, 'player', $3)
      returning id
    `,
    [
      tournamentId,
      guestProfiles.rows[0].profile_id,
      ownerPlayer.rows[0].id,
    ],
  );
  check(
    "the owner can receive Bowl of the Day votes during live play",
    pendingBowlVote.rowCount === 1,
  );
  let pendingCeremonyRejected = false;
  await client.query("savepoint pending_ceremony_vote");
  try {
    await client.query(
      `
        insert into public.award_vote
          (tournament_id, award_key, voter_id, target_type, target_id)
        values ($1, 'best_dressed', $2, 'team', gen_random_uuid())
      `,
      [tournamentId, guestProfiles.rows[0].profile_id],
    );
  } catch (error) {
    pendingCeremonyRejected =
      error?.code === "P0001" && /voting_closed/.test(error?.message ?? "");
    await client.query("rollback to savepoint pending_ceremony_vote");
  }
  await client.query("release savepoint pending_ceremony_vote");
  check(
    "ceremony awards stay closed during live play",
    pendingCeremonyRejected,
  );
  const deletedPendingBowl = await client.query(
    "delete from public.award_vote where id = $1 returning id",
    [pendingBowlVote.rows[0].id],
  );
  check(
    "Bowl of the Day votes can be changed during live play",
    deletedPendingBowl.rowCount === 1,
  );
  await client.query(
    "update public.tournament set voting_status = 'open' where id = $1",
    [tournamentId],
  );
  let ownerKiwiRejected = false;
  await client.query("savepoint owner_coolest_kiwi_vote");
  try {
    await client.query(
      `
        insert into public.award_vote
          (tournament_id, award_key, voter_id, target_type, target_id)
        values ($1, 'coolest_kiwi', $2, 'player', $3)
      `,
      [
        tournamentId,
        guestProfiles.rows[0].profile_id,
        ownerPlayer.rows[0].id,
      ],
    );
  } catch (error) {
    ownerKiwiRejected =
      error?.code === "P0001" &&
      /owner_coolest_kiwi_not_eligible/.test(error?.message ?? "");
    await client.query("rollback to savepoint owner_coolest_kiwi_vote");
  }
  await client.query("release savepoint owner_coolest_kiwi_vote");
  check(
    "the owner is excluded from Coolest Kiwi only",
    ownerKiwiRejected,
  );
  await client.query(
    "update public.tournament set voting_status = 'closed' where id = $1",
    [tournamentId],
  );
  let closedBowlRejected = false;
  await client.query("savepoint closed_bowl_vote");
  try {
    await client.query(
      `
        insert into public.award_vote
          (tournament_id, award_key, voter_id, target_type, target_id)
        values ($1, 'bowl_of_the_day', $2, 'player', gen_random_uuid())
      `,
      [tournamentId, guestProfiles.rows[0].profile_id],
    );
  } catch (error) {
    closedBowlRejected =
      error?.code === "P0001" && /voting_closed/.test(error?.message ?? "");
    await client.query("rollback to savepoint closed_bowl_vote");
  }
  await client.query("release savepoint closed_bowl_vote");
  check("closing voting freezes Bowl of the Day", closedBowlRejected);

  const recoveryHash = "transactional-smoke-recovery-hash";
  await client.query(
    "update public.profile set recovery_hash = $1 where id = $2",
    [recoveryHash, ownerId],
  );
  const consumed = await client.query(
    "select * from public.consume_owner_recovery($1, $2)",
    [
      (
        await client.query(
          "select username from public.profile where id = $1",
          [ownerId],
        )
      ).rows[0].username,
      recoveryHash,
    ],
  );
  check(
    "owner recovery consumes a valid code exactly once",
    consumed.rows[0]?.status === "ok" &&
      consumed.rows[0]?.profile_id === ownerId,
  );

  const throttleUser = `smoke_missing_${Date.now()}`;
  let finalStatus = "";
  for (let attempt = 0; attempt < 9; attempt++) {
    const result = await client.query(
      "select * from public.consume_owner_recovery($1, $2)",
      [throttleUser, "wrong"],
    );
    finalStatus = result.rows[0]?.status ?? "";
  }
  check(
    "owner recovery rate-limits repeated online guesses",
    finalStatus === "rate_limited",
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

console.log(failures === 0 ? "\nALL PASS (rolled back)" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
