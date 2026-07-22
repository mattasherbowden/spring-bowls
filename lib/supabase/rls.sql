-- =====================================================================
-- Spring Bowls — Row Level Security
-- Postgres 15+ on Supabase. Run AFTER the schema DDL.
--
-- Model:
--   * Actors: anon (public big-screen), player, admin, owner.
--     Roles live in player.role and are read on EVERY request (D-0010),
--     never trusted from the JWT.
--   * auth.uid() (Supabase) -> player row -> role + team membership.
--   * The service_role admin client BYPASSES RLS entirely, so no policy
--     is needed for account creation / synthetic-email setup (D-0009).
--     Everything below governs the anon key + a logged-in user's session.
--
-- Conventions:
--   * Helper functions are SECURITY DEFINER + STABLE, owned by a
--     privileged role, so they can read player/team_member regardless of
--     the caller's own RLS. They are written to avoid RLS recursion
--     (policies on player must NOT call a helper that itself selects
--     player under RLS — the definer bypass breaks that cycle).
--   * "Scoped to a tournament": most helpers take a tournament_id so a
--     user who is an admin in edition X is NOT an admin in edition Y.
--   * Every privileged branch is expressed as WITH CHECK on writes, so a
--     row can never be mutated INTO a state the actor may not create.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0.  Search path & schema for helpers
-- ---------------------------------------------------------------------
-- Helpers live in a dedicated schema so they are easy to find and so we
-- can lock EXECUTE grants down deliberately.
create schema if not exists app;

-- =====================================================================
-- 1.  SECURITY DEFINER HELPER FUNCTIONS
--     All are STABLE (same result within a statement) and set an empty
--     search_path to prevent search-path hijacking (Supabase lint).
-- =====================================================================

-- Current auth user's player id WITHIN a given tournament.
-- Returns NULL for anon or a user with no profile in that edition.
create or replace function app.current_player_id(p_tournament uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.player p
  where p.user_id = auth.uid()
    and p.tournament_id = p_tournament
$$;

-- Current auth user's role within a tournament ('owner'|'admin'|'player'),
-- or NULL if they have no profile there (treat as no access).
create or replace function app.current_role_in(p_tournament uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.player p
  where p.user_id = auth.uid()
    and p.tournament_id = p_tournament
$$;

-- Is the current user an admin OR owner in this tournament?
-- ("privileged" = may unlock scores, override schedule, close voting, etc.)
create or replace function app.is_admin(p_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role in ('owner', 'admin')
     from public.player p
     where p.user_id = auth.uid()
       and p.tournament_id = p_tournament),
    false)
$$;

-- Is the current user the owner of this tournament?
create or replace function app.is_owner(p_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'owner'
     from public.player p
     where p.user_id = auth.uid()
       and p.tournament_id = p_tournament),
    false)
$$;

-- Is the current user a member (any role) of this tournament?
create or replace function app.is_member(p_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player p
    where p.user_id = auth.uid()
      and p.tournament_id = p_tournament
  )
$$;

-- Is the current user on the given team?
create or replace function app.is_on_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_member tm
    join public.player p on p.id = tm.player_id
    where tm.team_id = p_team
      and p.user_id = auth.uid()
  )
$$;

-- Is the current user on EITHER team of a fixture? (score-entry gate)
create or replace function app.is_fixture_participant(p_fixture uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fixture f
    join public.team_member tm
      on tm.team_id in (f.team_home_id, f.team_away_id)
    join public.player p on p.id = tm.player_id
    where f.id = p_fixture
      and p.user_id = auth.uid()
  )
$$;

-- The tournament a fixture belongs to (for role checks in fixture_end policies).
create or replace function app.fixture_tournament(p_fixture uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.tournament_id from public.fixture f where f.id = p_fixture
$$;

-- Is a fixture currently locked? (locked_at stamped at first score insert)
-- Not referenced by a policy (locking is enforced by the §10a trigger + the
-- admin-only fixture UPDATE), but handy for the app/server actions to decide
-- whether to surface an "ask an admin to unlock" hint. Kept intentionally.
create or replace function app.fixture_is_locked(p_fixture uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select f.locked_at is not null from public.fixture f where f.id = p_fixture),
    false)
$$;

-- Is voting OPEN for an award? (voter gate for INSERT/DELETE of votes)
create or replace function app.award_voting_open(p_award uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.voting_open from public.award a where a.id = p_award),
    false)
$$;

-- The tournament an award belongs to.
create or replace function app.award_tournament(p_award uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.tournament_id from public.award a where a.id = p_award
$$;

-- The award's kind ('individual'|'team').
create or replace function app.award_kind(p_award uuid)
returns public.award_kind
language sql
stable
security definer
set search_path = ''
as $$
  select a.kind from public.award a where a.id = p_award
$$;

-- Cross-table voting validity for a single ballot row. Enforces the rules a
-- table CHECK cannot (they reference other tables), leaving the per-voter
-- caps / distinct-nominee rules to the schema's unique indexes:
--   * exactly one nominee kind, matching the award's kind
--   * no self-vote on individual awards (also a table check; belt & braces)
--   * no vote for your OWN TEAM on a team award (D-0008: partner allowed on
--     individual awards, so we only block own-team here)
--   * nominee belongs to the SAME tournament as the award
-- Returns true only if the (award, voter, nominee_*) triple is admissible.
create or replace function app.vote_is_valid(
  p_award            uuid,
  p_voter            uuid,
  p_nominee_player   uuid,
  p_nominee_team     uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind       public.award_kind;
  v_tournament uuid;
begin
  select a.kind, a.tournament_id
    into v_kind, v_tournament
  from public.award a
  where a.id = p_award;

  if v_kind is null then
    return false;                       -- award does not exist
  end if;

  -- exactly one nominee column set
  if (p_nominee_player is not null) = (p_nominee_team is not null) then
    return false;
  end if;

  if v_kind = 'individual' then
    -- must nominate a player, not a team
    if p_nominee_player is null then
      return false;
    end if;
    -- no self-vote (partner IS allowed — D-0008)
    if p_nominee_player = p_voter then
      return false;
    end if;
    -- nominee must be a player in the same tournament
    return exists (
      select 1 from public.player p
      where p.id = p_nominee_player
        and p.tournament_id = v_tournament
    );
  else  -- team award
    if p_nominee_team is null then
      return false;
    end if;
    -- may not vote for a team the voter belongs to (whole team excluded)
    if exists (
      select 1
      from public.team_member tm
      where tm.team_id = p_nominee_team
        and tm.player_id = p_voter
    ) then
      return false;
    end if;
    -- nominee team must be in the same tournament
    return exists (
      select 1 from public.team t
      where t.id = p_nominee_team
        and t.tournament_id = v_tournament
    );
  end if;
end;
$$;

-- Lock down who may execute helpers: anon + authenticated only need EXECUTE
-- (they run as SECURITY DEFINER regardless). Revoke from PUBLIC first.
revoke all on all functions in schema app from public;
grant usage on schema app to anon, authenticated;
grant execute on all functions in schema app to anon, authenticated;


-- =====================================================================
-- 2.  ENABLE (and FORCE) RLS ON EVERY TABLE
--     FORCE so the table owner is also subject to policies; the intended
--     bypass path is exclusively the service_role key.
-- =====================================================================
alter table tournament        enable row level security;
alter table player            enable row level security;
alter table tournament_group  enable row level security;
alter table team              enable row level security;
alter table team_member       enable row level security;
alter table rink              enable row level security;
alter table fixture           enable row level security;
alter table fixture_end       enable row level security;
alter table award             enable row level security;
alter table vote              enable row level security;

alter table tournament        force row level security;
alter table player            force row level security;
alter table tournament_group  force row level security;
alter table team              force row level security;
alter table team_member       force row level security;
alter table rink              force row level security;
alter table fixture           force row level security;
alter table fixture_end       force row level security;
alter table award             force row level security;
alter table vote              force row level security;

-- Baseline table grants. RLS narrows WITHIN these; without the grant the
-- policy is never even consulted. anon/authenticated get broad DML grants
-- and RLS does the real gatekeeping. (service_role is unaffected by grants
-- here as it bypasses RLS via its own superuser-like role.)
grant select on tournament, player, tournament_group, team, team_member,
                rink, fixture, fixture_end, award, vote
  to anon, authenticated;

grant insert, update, delete on
                player, tournament_group, team, team_member, rink,
                fixture, fixture_end, award, vote, tournament
  to authenticated;
-- anon gets NO write grant anywhere: read-only big screen.


-- =====================================================================
-- 3.  TOURNAMENT
--     anon + members read; only the OWNER creates/ends (lifecycle).
--     There is a bootstrap wrinkle: the very first owner account is
--     created server-side with service_role (bypasses RLS), so we never
--     need an "anyone can insert the first tournament" policy.
-- =====================================================================

-- READ: public may see editions (name/status only is non-PII); members too.
create policy tournament_select_public
  on tournament for select
  to anon, authenticated
  using (true);

-- INSERT: only the service_role path creates tournaments in practice, but
-- if we ever allow an authenticated owner to spin up a NEW edition, they
-- must already be owner of it — which is impossible before it exists.
-- So creation is service_role-only: no INSERT policy for authenticated =>
-- authenticated cannot insert. (Explicitly documented, intentionally absent.)

-- UPDATE: only the owner of THAT tournament may mutate it (status flips to
-- 'live'/'archived', walkover/scoring config). WITH CHECK re-asserts owner
-- so an owner can't, say, hand the row to another tournament id.
create policy tournament_update_owner
  on tournament for update
  to authenticated
  using (app.is_owner(id))
  with check (app.is_owner(id));

-- DELETE: not offered through RLS. Editions are archived, not deleted
-- (see D: old data read-only). Hard delete stays a service_role-only op.


-- =====================================================================
-- 4.  PLAYER  (profiles + roles)
--     IMPORTANT: policies here must NOT call helpers that select player
--     under RLS or we recurse. The helpers are SECURITY DEFINER so they
--     bypass this table's RLS — safe. We still keep the predicates simple.
--
--     PII rule: usernames/credentials must NOT be exposed to anon. There
--     is no password here (Supabase auth holds it), but username IS PII
--     for our purposes, so anon gets NO row access to player at all.
--     The public big screen reads display names via the non-PII views in
--     section 12 instead.
-- =====================================================================

-- READ: authenticated members of a tournament may see that tournament's
-- players (needed to pick teammates, nominees, see who's who). anon: none.
create policy player_select_members
  on player for select
  to authenticated
  using (app.is_member(tournament_id));

-- INSERT: accounts are created ONLY via the service_role admin path
-- (D-0009 no self-registration). No authenticated INSERT policy => blocked.

-- UPDATE is split across a policy layer (WHO may update a row) and a
-- BEFORE-UPDATE guard trigger (WHICH columns each actor may change):
--   * Policy 4a lets an admin/owner update any profile in their tournament.
--   * Policy 4d lets a player update their own profile row.
--   * Multiple UPDATE policies are OR-ed, so on their own they'd let an
--     admin set role='owner' (escalation) or a player rewrite their own
--     role/identity. The §4c trigger closes that: role changes require the
--     OWNER, the 'owner' role can never be assigned via UPDATE, and
--     user_id/tournament_id are immutable. Column-level authorization that
--     RLS alone can't express (it can't compare OLD vs NEW) lives there.

-- 4a. Admin/owner may update profiles in their tournament (display names;
--     role changes only if they are the owner, per the §4c trigger).
create policy player_update_admin
  on player for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

-- 4c. Guard trigger: only the owner may change a player's role, and the
--     'owner' role may never be assigned via UPDATE (ownership transfer is
--     a deliberate service_role/RPC operation). This closes the admin->owner
--     escalation that OR-ed UPDATE policies would otherwise permit.
create or replace function app.guard_player_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    -- role is changing: caller must be the tournament OWNER
    if not app.is_owner(old.tournament_id) then
      raise exception 'only the owner may change a player''s role'
        using errcode = '42501';
    end if;
    -- never mint a second owner via UPDATE (one_owner_per_tournament would
    -- also reject it, but fail loudly and early with a clear message)
    if new.role = 'owner' then
      raise exception 'ownership transfer is not permitted via update'
        using errcode = '42501';
    end if;
  end if;
  -- identity columns are admin-managed and must not drift on self-service
  if new.user_id is distinct from old.user_id
     or new.tournament_id is distinct from old.tournament_id then
    raise exception 'user_id / tournament_id are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists player_role_guard on player;
create trigger player_role_guard
  before update on player
  for each row execute function app.guard_player_role_change();

-- 4d. A player may edit their OWN display_name (self-service profile).
--     The trigger above still blocks any role/identity change, so this is
--     safe to allow broadly.
create policy player_update_self
  on player for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DELETE: removing a profile cascades from deleting the auth user, which is
-- a service_role admin op. No authenticated DELETE policy => blocked.


-- =====================================================================
-- 5.  TOURNAMENT_GROUP
--     Read: members + anon (group names appear on the big screen).
--     Write: admin/owner only (setup / schedule override, D-0003).
-- =====================================================================
create policy group_select_public
  on tournament_group for select
  to anon, authenticated
  using (true);

create policy group_insert_admin
  on tournament_group for insert
  to authenticated
  with check (app.is_admin(tournament_id));

create policy group_update_admin
  on tournament_group for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy group_delete_admin
  on tournament_group for delete
  to authenticated
  using (app.is_admin(tournament_id));


-- =====================================================================
-- 6.  TEAM
--     Read: anon + members (team names/seeds are non-PII, shown publicly).
--     Write: admin/owner only (admin assigns membership — D-0009).
-- =====================================================================
create policy team_select_public
  on team for select
  to anon, authenticated
  using (true);

create policy team_insert_admin
  on team for insert
  to authenticated
  with check (app.is_admin(tournament_id));

create policy team_update_admin
  on team for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy team_delete_admin
  on team for delete
  to authenticated
  using (app.is_admin(tournament_id));


-- =====================================================================
-- 7.  TEAM_MEMBER
--     Read: members of the tournament may see the roster; anon may NOT,
--     because it maps players (PII-linked) to teams. The public big screen
--     shows team names, not who is in them, so anon is excluded.
--     Write: admin/owner only (they assign membership — D-0009).
-- =====================================================================
create policy team_member_select_members
  on team_member for select
  to authenticated
  using (app.is_member(tournament_id));

create policy team_member_insert_admin
  on team_member for insert
  to authenticated
  with check (app.is_admin(tournament_id));

create policy team_member_update_admin
  on team_member for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy team_member_delete_admin
  on team_member for delete
  to authenticated
  using (app.is_admin(tournament_id));


-- =====================================================================
-- 8.  RINK
--     Read: anon + members (rink labels on the big screen "up next").
--     Write: admin/owner only (setup / override).
-- =====================================================================
create policy rink_select_public
  on rink for select
  to anon, authenticated
  using (true);

create policy rink_insert_admin
  on rink for insert
  to authenticated
  with check (app.is_admin(tournament_id));

create policy rink_update_admin
  on rink for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy rink_delete_admin
  on rink for delete
  to authenticated
  using (app.is_admin(tournament_id));


-- =====================================================================
-- 9.  FIXTURE
--     Read: anon + members (fixtures + standings feed the public screen).
--     Create/schedule/override: admin/owner (predetermined schedule, D-0003).
--
--     Score-lock rule (this table + fixture_end, §10):
--       * Participants NEVER UPDATE fixture directly. All match-state on
--         the fixture — locked_at, status (live/decider/completed),
--         winner_team_id, denormalised home/away_shots — is maintained by
--         SECURITY DEFINER triggers on fixture_end (§10a/§10b) as ends are
--         inserted. This makes the lock atomic and unraceable and means a
--         participant needs no UPDATE grant on fixture at all.
--       * The ONLY human who UPDATEs a fixture is an admin/owner: unlocking
--         to allow a correction, forcing a walkover, or overriding the
--         schedule/rink (D-0003). Hence a single admin UPDATE policy.
-- =====================================================================
create policy fixture_select_public
  on fixture for select
  to anon, authenticated
  using (true);

-- INSERT (create a fixture / schedule): admin/owner only.
create policy fixture_insert_admin
  on fixture for insert
  to authenticated
  with check (app.is_admin(tournament_id));

-- UPDATE — admin branch: admin/owner may update ANY fixture in their
-- tournament at any time (unlock a locked score, force a walkover, override
-- schedule/rink). WITH CHECK re-asserts tournament-scoped admin so they
-- can't move the fixture to another edition.
create policy fixture_update_admin
  on fixture for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

-- DELETE: admin/owner only (e.g. remove a mis-generated fixture in setup).
create policy fixture_delete_admin
  on fixture for delete
  to authenticated
  using (app.is_admin(tournament_id));


-- =====================================================================
-- 10.  FIXTURE_END  (the score-lock heart of the system)
--     Read: anon + members (per-end detail can show on the big screen).
--     INSERT: only a PARTICIPANT of that fixture — this is "the two teams'
--             members enter the score". The FIRST insert is what LOCKS the
--             fixture; the lock itself is stamped by the trigger below so
--             it happens atomically with the first row and cannot be raced.
--     UPDATE/DELETE of an existing end (a correction): admin/owner ONLY,
--             because by definition the fixture is already locked once any
--             end exists. Participants get exactly one shot at entry; fixes
--             go through an admin.
-- =====================================================================
create policy fixture_end_select_public
  on fixture_end for select
  to anon, authenticated
  using (true);

-- INSERT: participant of the fixture may add ends. Admin/owner may also add
-- ends (e.g. correcting/completing on someone's behalf). Both branches OR.
create policy fixture_end_insert_participant
  on fixture_end for insert
  to authenticated
  with check (
    app.is_fixture_participant(fixture_id)
    or app.is_admin(app.fixture_tournament(fixture_id))
  );

-- UPDATE: an existing end is a locked score => admin/owner only.
create policy fixture_end_update_admin
  on fixture_end for update
  to authenticated
  using (app.is_admin(app.fixture_tournament(fixture_id)))
  with check (app.is_admin(app.fixture_tournament(fixture_id)));

-- DELETE: correcting a mis-entered end => admin/owner only.
create policy fixture_end_delete_admin
  on fixture_end for delete
  to authenticated
  using (app.is_admin(app.fixture_tournament(fixture_id)));

-- 10a. FIXTURE-STATE TRIGGER: the single writer of denormalised fixture
--      state. Runs with definer rights so a participant (who has NO admin
--      UPDATE grant on fixture) can nonetheless drive the match forward
--      purely by inserting ends. On every end insert it:
--        * stamps locked_at on the FIRST end (the authoritative, unraceable
--          lock — coalesce keeps it idempotent),
--        * re-sums home/away_shots across all ends into the denormalised
--          columns (keeps standings fast without re-summing at read time),
--        * advances status: 'scheduled' -> 'live' on first end; sets
--          'completed' + winner_team_id once a decider end breaks a level
--          game (no draws — D-0004); leaves admin resolutions ('walkover')
--          untouched.
--      It deliberately does NOT decide when regulation is "over" or force a
--      decider — that lives in framework-free domain logic in the app, which
--      simply inserts the next end (flagged is_decider) when appropriate.
--      This trigger only reflects the ends that exist.
create or replace function app.sync_fixture_from_ends()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home int;
  v_away int;
  v_decider_winner uuid;
  v_status public.fixture_status;
begin
  select coalesce(sum(e.home_shots), 0),
         coalesce(sum(e.away_shots), 0)
    into v_home, v_away
  from public.fixture_end e
  where e.fixture_id = new.fixture_id;

  -- If the just-inserted row is a decider, it (by its table CHECK) is not
  -- level, so it names a winner and the game is complete.
  if new.is_decider then
    select case when new.home_shots > new.away_shots
                then f.team_home_id else f.team_away_id end
      into v_decider_winner
    from public.fixture f
    where f.id = new.fixture_id;
  end if;

  update public.fixture f
     set locked_at  = coalesce(f.locked_at, now()),
         home_shots = v_home,
         away_shots = v_away,
         status = case
                    when f.status = 'walkover' then f.status  -- admin-set, leave
                    when new.is_decider         then 'completed'::public.fixture_status
                    when f.status = 'scheduled' then 'live'::public.fixture_status
                    else f.status
                  end,
         winner_team_id = case
                    when new.is_decider then v_decider_winner
                    else f.winner_team_id
                  end,
         completed_at = case
                    when new.is_decider then now()
                    else f.completed_at
                  end
   where f.id = new.fixture_id;
  return new;
end;
$$;

drop trigger if exists fixture_end_sync on fixture_end;
create trigger fixture_end_sync
  after insert on fixture_end
  for each row execute function app.sync_fixture_from_ends();

-- Keep denormalised shots honest when an admin CORRECTS or DELETES an end.
-- (Participants can't reach here — §10 UPDATE/DELETE are admin-only.)
create or replace function app.resync_fixture_shots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture uuid := coalesce(new.fixture_id, old.fixture_id);
  v_home int;
  v_away int;
begin
  select coalesce(sum(e.home_shots), 0),
         coalesce(sum(e.away_shots), 0)
    into v_home, v_away
  from public.fixture_end e
  where e.fixture_id = v_fixture;

  update public.fixture f
     set home_shots = v_home,
         away_shots = v_away
   where f.id = v_fixture;
  return coalesce(new, old);
end;
$$;

drop trigger if exists fixture_end_resync on fixture_end;
create trigger fixture_end_resync
  after update or delete on fixture_end
  for each row execute function app.resync_fixture_shots();


-- =====================================================================
-- 11.  AWARD
--     Read: anon + members (award names + announced winners on the screen).
--     Create/edit/toggle voting_open/set winner: admin/owner ONLY.
--     The voting_open toggle is the gate the vote policies read.
-- =====================================================================
create policy award_select_public
  on award for select
  to anon, authenticated
  using (true);

create policy award_insert_admin
  on award for insert
  to authenticated
  with check (app.is_admin(tournament_id));

create policy award_update_admin
  on award for update
  to authenticated
  using (app.is_admin(tournament_id))
  with check (app.is_admin(tournament_id));

create policy award_delete_admin
  on award for delete
  to authenticated
  using (app.is_admin(tournament_id));


-- =====================================================================
-- 12.  VOTE
--     A ballot is (award, voter, nominee, ballot_slot). The schema's unique
--     indexes already cap <=2 votes/award and force 2 DISTINCT nominees.
--     RLS adds the cross-table + lifecycle rules:
--       * voter must be the current user (no ballot-stuffing as someone else)
--       * voting must be OPEN for that award
--       * ballot must be admissible (kind match, no self on individual,
--         no OWN-TEAM on team, nominee in same tournament) — vote_is_valid
--     Read: a voter sees ONLY their own ballots; admin/owner see all (to
--       tally / audit). anon sees NONE (ballots are private; only announced
--       winners are public via the award row).
--     UPDATE: not allowed for anyone via RLS — a ballot is delete+re-insert
--       while voting is open, keeping the "distinct nominee" indexes honest.
--     DELETE: a voter may retract their OWN ballot while voting is OPEN;
--       admin/owner may delete any ballot (spoiled/mistaken) anytime.
-- =====================================================================

-- READ own ballots; admin/owner read all in their tournament.
create policy vote_select_self
  on vote for select
  to authenticated
  using (
    voter_player_id = app.current_player_id(app.award_tournament(award_id))
    or app.is_admin(app.award_tournament(award_id))
  );

-- INSERT a ballot: must be yourself, voting open, and admissible.
create policy vote_insert_voter
  on vote for insert
  to authenticated
  with check (
    voter_player_id = app.current_player_id(app.award_tournament(award_id))
    and app.award_voting_open(award_id)
    and app.vote_is_valid(award_id, voter_player_id,
                          nominee_player_id, nominee_team_id)
  );

-- No UPDATE policy: ballots are immutable; change = retract + re-cast.

-- DELETE: retract your own ballot while voting is open, OR admin/owner
-- deletes any ballot (housekeeping) regardless of open/closed.
create policy vote_delete_self_open
  on vote for delete
  to authenticated
  using (
    (voter_player_id = app.current_player_id(app.award_tournament(award_id))
       and app.award_voting_open(award_id))
    or app.is_admin(app.award_tournament(award_id))
  );


-- =====================================================================
-- 13.  PUBLIC (anon) NON-PII READ SURFACE
--     Belt-and-braces: even though anon has SELECT on team/fixture/etc.,
--     it must NEVER reach usernames/credentials. player + team_member are
--     already anon-invisible (no anon SELECT policy). For the big screen we
--     expose display-only VIEWS that are safe to read anonymously and that
--     deliberately omit username/username_canonical/user_id.
--
--     Views run with the view OWNER's rights by default (they do NOT use
--     security_invoker), so they bypass the base tables' RLS for the caller.
--     That is exactly what lets anon read them despite player/team_member
--     having no anon SELECT policy. The safety therefore rests entirely on
--     the column list: expose ONLY non-PII. Do NOT add security_invoker to
--     these (it would re-apply base-table RLS and hide rows from anon), and
--     do NOT add username/username_canonical/user_id columns.
--     security_barrier stops a caller's cheap-but-leaky function/operator
--     from being pushed below the view and observing filtered-out data.
-- =====================================================================

-- Standings-friendly team view: no player linkage, no PII.
create or replace view public.v_public_team
  with (security_barrier = true) as
  select t.id, t.tournament_id, t.group_id, t.name, t.seed
  from public.team t;

-- Fixture view for the screen: teams, rink, status, shots — no PII.
create or replace view public.v_public_fixture
  with (security_barrier = true) as
  select f.id, f.tournament_id, f.stage, f.group_id, f.knockout_round,
         f.bracket_slot, f.rink_id, f.team_home_id, f.team_away_id,
         f.is_bye, f.status, f.winner_team_id, f.home_shots, f.away_shots,
         f.scheduled_at, f.completed_at
  from public.fixture f;

-- Display-name-only player view (NO username, NO user_id, NO canonical).
-- Useful if the screen wants to show award winners by display name.
create or replace view public.v_public_player
  with (security_barrier = true) as
  select p.id, p.tournament_id, p.display_name
  from public.player p;

grant select on public.v_public_team,
                public.v_public_fixture,
                public.v_public_player
  to anon, authenticated;

-- =====================================================================
-- END
-- =====================================================================
