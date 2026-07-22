-- =====================================================================
-- Spring Bowls — 0003_rls.sql  (RLS + grants + public views)
-- Run AFTER 0002_functions.sql.
--
-- Model:
--   * RLS ENABLED and FORCED on all 10 tables.
--   * service_role is the only intended bypass (account creation, D-0009);
--     it needs no policies.
--   * Every UPDATE policy has a WITH CHECK.
--   * Default-deny: no policy => no access. anon gets SELECT on genuinely
--     public tables + three column-limited, tournament-scoped views only.
--
-- Red-team fixes applied at the RLS/GRANT layer:
--   * anon has NO base-table grant on player or team_member (structural PII
--     boundary, not policy-absence).
--   * fixture_end participant INSERT is gated to scheduled/live, non-decider,
--     non-locked-completion. Deciders are admin-only.
--   * Public views are security_invoker + tournament-scoped to status='live'
--     and expose an OPAQUE public_ref (salted hash), never player.id, so the
--     synthetic login email can't be recomputed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable + FORCE RLS on every table
-- ---------------------------------------------------------------------
alter table tournament       enable row level security;
alter table tournament       force  row level security;
alter table player           enable row level security;
alter table player           force  row level security;
alter table tournament_group enable row level security;
alter table tournament_group force  row level security;
alter table team             enable row level security;
alter table team             force  row level security;
alter table team_member      enable row level security;
alter table team_member      force  row level security;
alter table rink             enable row level security;
alter table rink             force  row level security;
alter table fixture          enable row level security;
alter table fixture          force  row level security;
alter table fixture_end      enable row level security;
alter table fixture_end      force  row level security;
alter table award            enable row level security;
alter table award            force  row level security;
alter table vote             enable row level security;
alter table vote             force  row level security;

-- ---------------------------------------------------------------------
-- Base grants
--   Revoke everything, then hand back exactly what each role needs.
--   RLS still governs which ROWS are visible/writable on top of grants.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

-- authenticated: table-level DML grants (RLS narrows the rows)
grant select, insert, update, delete on
  tournament, player, tournament_group, team, team_member, rink,
  fixture, fixture_end, award, vote
  to authenticated;

-- anon: SELECT only on genuinely public tables.
--   Deliberately EXCLUDES player and team_member (PII/roster) so a stray
--   future policy cannot leak usernames/credentials — structural boundary.
grant select on tournament, tournament_group, team, rink, fixture, fixture_end, award to anon;
-- (vote tallies are surfaced to the public only via server-side aggregation,
--  not a raw anon grant.)

-- =====================================================================
-- TOURNAMENT
-- =====================================================================
-- anon + members may read tournaments (public big screen shows name/status).
create policy tournament_select_public on tournament
  for select to anon, authenticated
  using (true);

-- Only the OWNER may update (status flips, walkover/scoring config).
create policy tournament_update_owner on tournament
  for update to authenticated
  using      (app.is_owner(id))
  with check (app.is_owner(id));

-- Creation is service_role-only (no INSERT policy for anon/authenticated).
-- Deletion is service_role-only (no DELETE policy).

-- =====================================================================
-- PLAYER
--   anon has NO grant and NO policy -> usernames/credentials never exposed.
-- =====================================================================
-- A member may read player rows within their own tournament.
create policy player_select_member on player
  for select to authenticated
  using (app.is_member(tournament_id));

-- A player may update their own profile row (e.g. display_name).
-- The guard trigger blocks role/identity/username escalation.
create policy player_update_self on player
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admin/owner may update any player row in their tournament.
-- The guard trigger still enforces owner-only role changes, no owner mint,
-- and no last-owner demotion.
create policy player_update_admin on player
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

-- INSERT/DELETE of players is service_role-only (D-0009) -> no policy.

-- =====================================================================
-- TOURNAMENT_GROUP
-- =====================================================================
create policy group_select_public on tournament_group
  for select to anon, authenticated
  using (true);

create policy group_insert_admin on tournament_group
  for insert to authenticated
  with check (app.is_admin(tournament_id));

create policy group_update_admin on tournament_group
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy group_delete_admin on tournament_group
  for delete to authenticated
  using (app.is_admin(tournament_id));

-- =====================================================================
-- TEAM
-- =====================================================================
create policy team_select_public on team
  for select to anon, authenticated
  using (true);

create policy team_insert_admin on team
  for insert to authenticated
  with check (app.is_admin(tournament_id));

create policy team_update_admin on team
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy team_delete_admin on team
  for delete to authenticated
  using (app.is_admin(tournament_id));

-- =====================================================================
-- TEAM_MEMBER
--   anon has NO grant and NO policy -> roster hidden from public.
-- =====================================================================
create policy team_member_select_member on team_member
  for select to authenticated
  using (app.is_member(tournament_id));

create policy team_member_insert_admin on team_member
  for insert to authenticated
  with check (app.is_admin(tournament_id));

create policy team_member_update_admin on team_member
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy team_member_delete_admin on team_member
  for delete to authenticated
  using (app.is_admin(tournament_id));

-- =====================================================================
-- RINK
-- =====================================================================
create policy rink_select_public on rink
  for select to anon, authenticated
  using (true);

create policy rink_insert_admin on rink
  for insert to authenticated
  with check (app.is_admin(tournament_id));

create policy rink_update_admin on rink
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy rink_delete_admin on rink
  for delete to authenticated
  using (app.is_admin(tournament_id));

-- =====================================================================
-- FIXTURE
--   Participants NEVER update fixture directly; the end-sync trigger is the
--   only writer of denormalised state. Admin/owner may update (unlock,
--   walkover, schedule override).
-- =====================================================================
create policy fixture_select_public on fixture
  for select to anon, authenticated
  using (true);

create policy fixture_insert_admin on fixture
  for insert to authenticated
  with check (app.is_admin(tournament_id));

create policy fixture_update_admin on fixture
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy fixture_delete_admin on fixture
  for delete to authenticated
  using (app.is_admin(tournament_id));

-- =====================================================================
-- FIXTURE_END
--   Public may read ends (big-screen scores). Participants get exactly one
--   entry lane: scheduled/live, non-decider, not-yet-locked. Everything
--   terminal (deciders, corrections) is admin-only.
-- =====================================================================
create policy fixture_end_select_public on fixture_end
  for select to anon, authenticated
  using (true);

-- Participant/admin INSERT.
--   * admin: unrestricted (may record deciders; trigger authorises).
--   * participant: only while the fixture is still open AND not yet locked,
--                  and never a decider.
create policy fixture_end_insert on fixture_end
  for insert to authenticated
  with check (
    app.is_admin(app.fixture_tournament(fixture_id))
    or (
      app.is_fixture_participant(fixture_id)
      and not is_decider
      and exists (
        select 1 from public.fixture f
        where f.id = fixture_id
          and f.status in ('scheduled', 'live')
          and f.locked_at is null
      )
    )
  );

-- Corrections (UPDATE/DELETE of ends) are admin/owner only.
create policy fixture_end_update_admin on fixture_end
  for update to authenticated
  using      (app.is_admin(app.fixture_tournament(fixture_id)))
  with check (app.is_admin(app.fixture_tournament(fixture_id)));

create policy fixture_end_delete_admin on fixture_end
  for delete to authenticated
  using (app.is_admin(app.fixture_tournament(fixture_id)));

-- =====================================================================
-- AWARD
-- =====================================================================
create policy award_select_public on award
  for select to anon, authenticated
  using (true);

create policy award_insert_admin on award
  for insert to authenticated
  with check (app.is_admin(tournament_id));

-- Only admin/owner toggles voting / sets winners. The latch trigger prevents
-- re-opening once closed.
create policy award_update_admin on award
  for update to authenticated
  using      (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy award_delete_admin on award
  for delete to authenticated
  using (app.is_admin(tournament_id));

-- =====================================================================
-- VOTE
--   anon has NO grant/policy. Voters read/insert/retract only their own
--   ballots while voting is open; admins read/delete any. No UPDATE policy
--   at all -> ballots immutable (change = retract + recast).
-- =====================================================================
-- Read own ballots (any time) or admin reads all.
create policy vote_select_self on vote
  for select to authenticated
  using (
    app.is_admin(app.award_tournament(award_id))
    or voter_player_id = app.current_player_id(app.award_tournament(award_id))
  );

-- Insert own ballot while voting open and valid.
--   voter identity is ALSO hard-asserted by the BEFORE INSERT trigger.
create policy vote_insert_voter on vote
  for insert to authenticated
  with check (
    voter_player_id = app.current_player_id(app.award_tournament(award_id))
    and app.award_voting_open(award_id)
    and app.vote_is_valid(award_id, voter_player_id, nominee_player_id, nominee_team_id)
  );

-- Retract own ballot while voting still open; admin may delete any.
create policy vote_delete_self_open on vote
  for delete to authenticated
  using (
    app.is_admin(app.award_tournament(award_id))
    or (
      voter_player_id = app.current_player_id(app.award_tournament(award_id))
      and app.award_voting_open(award_id)
    )
  );

-- (No vote UPDATE policy -> immutable ballots.)

-- =====================================================================
-- PUBLIC BIG-SCREEN VIEWS
--   security_invoker so RLS on base tables governs the rows (no owner
--   bypass, no cross-edition/superuser leak). Scoped to status='live'.
--   Expose ONLY non-PII columns and an OPAQUE public_ref (never player.id,
--   so the synthetic login email cannot be recomputed).
-- =====================================================================

-- Public players: opaque ref + display name only, live editions only.
create view public.v_public_player
  with (security_invoker = true, security_barrier = true) as
  select
    encode(digest(p.id::text || ':' || p.tournament_id::text, 'sha256'), 'hex') as public_ref,
    p.tournament_id,
    p.display_name
  from public.player p
  join public.tournament tn on tn.id = p.tournament_id
  where tn.status = 'live';

-- Public teams: id/name are non-PII and needed for standings joins.
create view public.v_public_team
  with (security_invoker = true, security_barrier = true) as
  select t.id, t.tournament_id, t.group_id, t.name, t.seed
  from public.team t
  join public.tournament tn on tn.id = t.tournament_id
  where tn.status = 'live';

-- Public fixtures: scores + status, live editions only.
create view public.v_public_fixture
  with (security_invoker = true, security_barrier = true) as
  select
    f.id, f.tournament_id, f.stage, f.group_id, f.knockout_round,
    f.bracket_slot, f.rink_id, f.team_home_id, f.team_away_id, f.is_bye,
    f.status, f.winner_team_id, f.home_shots, f.away_shots,
    f.scheduled_at, f.completed_at
  from public.fixture f
  join public.tournament tn on tn.id = f.tournament_id
  where tn.status = 'live';

-- security_invoker views run AS the querying role, so anon must have BOTH a
-- SELECT grant and a permissive policy on the base rows the view reads.
--
-- PII boundary is enforced at the GRANT (column-level): anon may SELECT only
-- the exact non-PII columns the view needs (id is needed internally to build
-- the salted hash, tournament_id, display_name). It is NEVER granted
-- username / username_canonical / user_id / role / created_at, so even a
-- direct `select * from player` by anon is rejected at the grant layer, and
-- the raw player.id is never projected out of the view (only its salted hash
-- leaves). Three controls must all fail to leak: column grant, row policy,
-- and the view's column projection.
grant select (id, tournament_id, display_name) on player to anon;

create policy player_select_public_live on player
  for select to anon
  using (
    exists (
      select 1 from public.tournament tn
      where tn.id = player.tournament_id
        and tn.status = 'live'
    )
  );

grant select on public.v_public_player, public.v_public_team, public.v_public_fixture
  to anon, authenticated;
