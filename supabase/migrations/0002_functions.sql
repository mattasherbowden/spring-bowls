-- =====================================================================
-- Spring Bowls — 0002_functions.sql  (functions + triggers)
-- Run AFTER 0001_schema.sql, BEFORE 0003_rls.sql.
--
-- All SECURITY DEFINER helpers live in schema `app`, are STABLE where
-- read-only, and set search_path='' so they only ever touch fully-
-- qualified objects (no search_path hijack).
--
-- Red-team fixes applied at the FUNCTION/TRIGGER layer:
--   * app schema is NOT exposed to PostgREST and EXECUTE is granted only
--     to `authenticated` (never anon) -> no anon PII/roster oracle.
--   * sync_fixture_from_ends: participant deciders/completion are refused;
--     deciders are admin-only, and no writes to already-completed/walkover
--     fixtures.
--   * guard_player_role_change: cannot mint owner via UPDATE, cannot demote
--     the last owner, username admin-managed, identity columns immutable.
--   * vote BEFORE INSERT trigger hard-asserts voter == auth.uid().
--   * award voting one-way latch: cannot re-open once closed_at is set.
-- =====================================================================

create schema if not exists app;

-- No implicit privileges on the helper schema; PostgREST must NOT expose it.
revoke all on schema app from public;
grant usage on schema app to authenticated;
-- NB: anon is deliberately NOT granted usage; app.* is not callable by anon.

-- =====================================================================
-- SYNTHETIC EMAIL (pure function of the stable player id)
-- =====================================================================
create or replace function app.synthetic_email(stable_id uuid)
returns text
language sql
immutable
returns null on null input
as $$
  select 'u_' || replace(stable_id::text, '-', '')
         || '@'
         || coalesce(
              current_setting('app.synthetic_email_domain', true),
              'accounts.springbowls.invalid'
            )
$$;

-- =====================================================================
-- IDENTITY / ROLE HELPERS  (SECURITY DEFINER, break RLS recursion)
-- =====================================================================

-- The caller's player id for a tournament, resolved from auth.uid().
create or replace function app.current_player_id(p_tournament_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.player p
  where p.user_id = auth.uid()
    and p.tournament_id = p_tournament_id
  limit 1
$$;

create or replace function app.current_role_in(p_tournament_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.player p
  where p.user_id = auth.uid()
    and p.tournament_id = p_tournament_id
  limit 1
$$;

create or replace function app.is_member(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player p
    where p.user_id = auth.uid()
      and p.tournament_id = p_tournament_id
  )
$$;

create or replace function app.is_admin(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player p
    where p.user_id = auth.uid()
      and p.tournament_id = p_tournament_id
      and p.role in ('owner', 'admin')
  )
$$;

create or replace function app.is_owner(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player p
    where p.user_id = auth.uid()
      and p.tournament_id = p_tournament_id
      and p.role = 'owner'
  )
$$;

-- Is the caller a member of the given team?
create or replace function app.is_on_team(p_team_id uuid)
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
    where tm.team_id = p_team_id
      and p.user_id = auth.uid()
  )
$$;

-- Is the caller a member of either team in the fixture?
create or replace function app.is_fixture_participant(p_fixture_id uuid)
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
    where f.id = p_fixture_id
      and p.user_id = auth.uid()
  )
$$;

create or replace function app.fixture_tournament(p_fixture_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.tournament_id from public.fixture f where f.id = p_fixture_id
$$;

create or replace function app.award_tournament(p_award_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.tournament_id from public.award a where a.id = p_award_id
$$;

create or replace function app.award_kind(p_award_id uuid)
returns public.award_kind
language sql
stable
security definer
set search_path = ''
as $$
  select a.kind from public.award a where a.id = p_award_id
$$;

create or replace function app.award_voting_open(p_award_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a.voting_open and a.closed_at is null
  from public.award a where a.id = p_award_id
$$;

-- =====================================================================
-- VOTE VALIDITY  (all cross-table voting rules in one place)
-- =====================================================================
create or replace function app.vote_is_valid(
  p_award_id          uuid,
  p_voter_player_id   uuid,
  p_nominee_player_id uuid,
  p_nominee_team_id   uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tournament uuid;
  v_kind       public.award_kind;
begin
  select a.tournament_id, a.kind
    into v_tournament, v_kind
  from public.award a
  where a.id = p_award_id;

  if v_tournament is null then
    return false;
  end if;

  -- exactly one nominee kind, matching the award kind
  if v_kind = 'individual' then
    if p_nominee_player_id is null or p_nominee_team_id is not null then
      return false;
    end if;
    -- no self-vote (partner allowed per D-0008)
    if p_nominee_player_id = p_voter_player_id then
      return false;
    end if;
    -- nominee must be a player in the same tournament
    if not exists (
      select 1 from public.player p
      where p.id = p_nominee_player_id
        and p.tournament_id = v_tournament
    ) then
      return false;
    end if;
  else  -- team award
    if p_nominee_team_id is null or p_nominee_player_id is not null then
      return false;
    end if;
    -- nominee must be a team in the same tournament
    if not exists (
      select 1 from public.team t
      where t.id = p_nominee_team_id
        and t.tournament_id = v_tournament
    ) then
      return false;
    end if;
    -- cannot vote for your OWN team
    if exists (
      select 1 from public.team_member tm
      where tm.team_id = p_nominee_team_id
        and tm.player_id = p_voter_player_id
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- =====================================================================
-- TRIGGER: canonicalise username on player
-- =====================================================================
create or replace function app.player_canonicalise_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.username := btrim(new.username);
  new.username_canonical := lower(new.username)::public.citext;
  return new;
end;
$$;

create trigger player_canonicalise
  before insert or update of username on public.player
  for each row
  execute function app.player_canonicalise_username();

-- =====================================================================
-- TRIGGER: guard player role / identity changes  (BEFORE UPDATE)
--   Deny-by-default for sensitive columns.
-- =====================================================================
create or replace function app.guard_player_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- identity columns are immutable via UPDATE
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable' using errcode = '42501';
  end if;
  if new.tournament_id is distinct from old.tournament_id then
    raise exception 'tournament_id is immutable' using errcode = '42501';
  end if;

  -- username is admin-managed (deny-by-default: only admin/owner may change)
  if (new.username is distinct from old.username
      or new.username_canonical is distinct from old.username_canonical)
     and not app.is_admin(old.tournament_id) then
    raise exception 'username is admin-managed' using errcode = '42501';
  end if;

  -- role changes
  if new.role is distinct from old.role then
    -- only the owner may change any role
    if not app.is_owner(old.tournament_id) then
      raise exception 'only the owner may change roles' using errcode = '42501';
    end if;
    -- 'owner' can never be ASSIGNED via UPDATE (ownership transfer is a
    -- deliberate service_role op)
    if new.role = 'owner' then
      raise exception 'owner role cannot be assigned via update; use service_role'
        using errcode = '42501';
    end if;
    -- the last/only owner cannot demote themselves -> would leave zero owners
    if old.role = 'owner' then
      raise exception 'the tournament owner cannot be demoted; transfer ownership via service_role first'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger player_guard_update
  before update on public.player
  for each row
  execute function app.guard_player_role_change();

-- =====================================================================
-- TRIGGER: award voting one-way latch  (BEFORE UPDATE)
--   Once closed_at is stamped (or a winner frozen), voting can never
--   be re-opened. Stamps closed_at the moment voting is closed.
-- =====================================================================
create or replace function app.guard_award_voting_latch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- stamp closed_at the first time voting flips to closed
  if old.voting_open and not new.voting_open and new.closed_at is null then
    new.closed_at := now();
  end if;

  -- once closed_at is set, voting is permanently closed
  if old.closed_at is not null then
    if new.voting_open then
      raise exception 'voting for this award is permanently closed'
        using errcode = '42501';
    end if;
    -- closed_at itself is immutable once set
    if new.closed_at is distinct from old.closed_at then
      raise exception 'closed_at is immutable once set' using errcode = '42501';
    end if;
  end if;

  -- freezing a winner also permanently closes voting
  if (new.winner_player_id is not null or new.winner_team_id is not null)
     and new.voting_open then
    raise exception 'cannot keep voting open once a winner is set'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger award_voting_latch
  before update on public.award
  for each row
  execute function app.guard_award_voting_latch();

-- =====================================================================
-- TRIGGER: vote voter-identity hard assert  (BEFORE INSERT)
--   Independent second control: voter_player_id MUST map to auth.uid().
-- =====================================================================
create or replace function app.guard_vote_voter_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.player p
    where p.id = new.voter_player_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'voter_player_id does not belong to the authenticated user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger vote_voter_identity
  before insert on public.vote
  for each row
  execute function app.guard_vote_voter_identity();

-- =====================================================================
-- TRIGGER: sync fixture from ends  (AFTER INSERT on fixture_end)
--   Single authoritative writer of denormalised fixture state.
--   Hardened so a participant can never complete/decide a fixture.
-- =====================================================================
create or replace function app.sync_fixture_from_ends()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fix          public.fixture%rowtype;
  v_home_total   integer;
  v_away_total   integer;
  v_actor_admin  boolean;
begin
  select * into v_fix from public.fixture f where f.id = new.fixture_id for update;

  -- Never mutate a terminal fixture from an end insert.
  if v_fix.status in ('completed', 'walkover') then
    raise exception 'fixture is already resolved (%), cannot add ends', v_fix.status
      using errcode = '42501';
  end if;

  -- A decider end ENDS the match and names a winner -> admin/owner only.
  -- The RLS INSERT policy already blocks participant deciders, but we assert
  -- here too (defense in depth: the trigger is the authority on completion).
  if new.is_decider then
    v_actor_admin := app.is_admin(v_fix.tournament_id);
    if not v_actor_admin then
      raise exception 'only admin/owner may record a decider end'
        using errcode = '42501';
    end if;
  end if;

  -- Re-sum all ends into denormalised totals.
  select coalesce(sum(e.home_shots), 0), coalesce(sum(e.away_shots), 0)
    into v_home_total, v_away_total
  from public.fixture_end e
  where e.fixture_id = new.fixture_id;

  -- Lock at first end (atomic, unraceable) and advance scheduled -> live.
  update public.fixture f
  set
    locked_at  = coalesce(f.locked_at, now()),
    home_shots = v_home_total,
    away_shots = v_away_total,
    status = case
               when new.is_decider then 'completed'::public.fixture_status
               when f.status = 'scheduled' then 'live'::public.fixture_status
               else f.status
             end,
    winner_team_id = case
                       when new.is_decider then
                         case when new.home_shots > new.away_shots
                              then f.team_home_id else f.team_away_id end
                       else f.winner_team_id
                     end,
    completed_at = case when new.is_decider then now() else f.completed_at end
  where f.id = new.fixture_id;

  return null;
end;
$$;

create trigger fixture_end_sync
  after insert on public.fixture_end
  for each row
  execute function app.sync_fixture_from_ends();

-- Keep totals honest when admins correct/delete ends.
create or replace function app.resync_fixture_shots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture_id uuid;
  v_home_total integer;
  v_away_total integer;
begin
  v_fixture_id := coalesce(new.fixture_id, old.fixture_id);

  select coalesce(sum(e.home_shots), 0), coalesce(sum(e.away_shots), 0)
    into v_home_total, v_away_total
  from public.fixture_end e
  where e.fixture_id = v_fixture_id;

  update public.fixture f
  set home_shots = v_home_total,
      away_shots = v_away_total
  where f.id = v_fixture_id;

  return null;
end;
$$;

create trigger fixture_end_resync
  after update or delete on public.fixture_end
  for each row
  execute function app.resync_fixture_shots();

-- =====================================================================
-- BOOTSTRAP OWNER  (service_role only; idempotent)
-- =====================================================================
create or replace function app.bootstrap_owner(
  p_tournament_id uuid,
  p_user_id       uuid,
  p_username      text,
  p_display_name  text default null
)
returns public.player
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.player;
begin
  if exists (
    select 1 from public.player p
    where p.tournament_id = p_tournament_id and p.role = 'owner'
  ) then
    raise exception 'owner already exists for tournament %', p_tournament_id
      using errcode = 'unique_violation';
  end if;

  insert into public.player (tournament_id, user_id, role, username, display_name)
  values (p_tournament_id, p_user_id, 'owner', p_username, p_display_name)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function app.bootstrap_owner(uuid, uuid, text, text) from public;

-- =====================================================================
-- EXECUTE GRANTS
--   Only `authenticated` may call helpers. anon gets NOTHING in schema app.
--   bootstrap_owner is service_role only (service_role bypasses grants).
-- =====================================================================
revoke execute on all functions in schema app from public;
grant execute on function app.current_player_id(uuid)     to authenticated;
grant execute on function app.current_role_in(uuid)       to authenticated;
grant execute on function app.is_member(uuid)             to authenticated;
grant execute on function app.is_admin(uuid)              to authenticated;
grant execute on function app.is_owner(uuid)              to authenticated;
grant execute on function app.is_on_team(uuid)            to authenticated;
grant execute on function app.is_fixture_participant(uuid) to authenticated;
grant execute on function app.fixture_tournament(uuid)    to authenticated;
grant execute on function app.award_tournament(uuid)      to authenticated;
grant execute on function app.award_kind(uuid)            to authenticated;
grant execute on function app.award_voting_open(uuid)     to authenticated;
grant execute on function app.vote_is_valid(uuid, uuid, uuid, uuid) to authenticated;
-- synthetic_email is pure/no-secret but keep it off anon too.
grant execute on function app.synthetic_email(uuid)       to authenticated;
