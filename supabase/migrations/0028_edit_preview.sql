-- 0028_edit_preview.sql — let the owner safely revise an unpublished draw.
--
-- Reopening keeps the roster, Auth accounts and generated credentials, but
-- removes the disposable draw and photo-pairing state. All state transitions
-- lock the tournament row, so Start and Edit cannot both win a race.

-- A password is paired with a username, so duplicates would not compromise
-- authentication. Keeping event passwords unique is still much less confusing
-- when printed cards are handed out, and lets concurrent roster additions fail
-- safely instead of silently assigning the same themed phrase.
create unique index if not exists profile_login_password_unique
  on public.profile (login_password)
  where login_password is not null;

create or replace function public.start_tournament_play(
  p_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
  v_play_status text;
begin
  select status, play_status
    into v_status, v_play_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_play_status = 'open' and v_status = 'live' then
    return;
  end if;
  if v_status <> 'live' then
    raise exception 'play_not_live';
  end if;
  if v_play_status <> 'preview' then
    raise exception 'play_state_invalid';
  end if;

  update public.tournament
     set play_status = 'open',
         voting_status = 'pending'
   where id = p_tournament_id;
end;
$$;

revoke all on function public.start_tournament_play(uuid)
  from public, anon, authenticated;
grant execute on function public.start_tournament_play(uuid)
  to service_role;

create or replace function public.reopen_tournament_preview(
  p_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
  v_play_status text;
  v_voting_status text;
begin
  select status, play_status, voting_status
    into v_status, v_play_status, v_voting_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;

  -- A double-submit is harmless after the first request has completed.
  if v_status = 'setup'
     and v_play_status = 'preview'
     and not exists (
       select 1
         from public.fixture
        where tournament_id = p_tournament_id
     ) then
    return;
  end if;

  if v_status <> 'live' then
    raise exception 'preview_edit_not_live';
  end if;
  if v_play_status <> 'preview' then
    raise exception 'preview_edit_play_open';
  end if;
  if v_voting_status <> 'pending' then
    raise exception 'preview_edit_voting_started';
  end if;
  if exists (
    select 1
      from public.award_vote
     where tournament_id = p_tournament_id
  ) then
    raise exception 'preview_edit_votes_exist';
  end if;
  if exists (
    select 1
      from public.fixture_end as fixture_end
      join public.fixture as fixture on fixture.id = fixture_end.fixture_id
     where fixture.tournament_id = p_tournament_id
  ) then
    raise exception 'preview_edit_results_exist';
  end if;
  if exists (
    select 1
      from public.fixture
     where tournament_id = p_tournament_id
       and (
         status not in ('scheduled', 'pending')
         or shots_a is not null
         or shots_b is not null
         or winner_team_id is not null
         or locked_at is not null
         or locked_by is not null
       )
  ) then
    raise exception 'preview_edit_results_exist';
  end if;

  delete from public.qualification_tiebreak
   where tournament_id = p_tournament_id;
  delete from public.fixture
   where tournament_id = p_tournament_id;

  update public.team
     set group_label = null,
         seed = null
   where tournament_id = p_tournament_id;

  update public.player
     set photo_partner_id = null,
         photo_done = false
   where tournament_id = p_tournament_id;

  update public.tournament
     set status = 'setup'
   where id = p_tournament_id;
end;
$$;

revoke all on function public.reopen_tournament_preview(uuid)
  from public, anon, authenticated;
grant execute on function public.reopen_tournament_preview(uuid)
  to service_role;

create or replace function public.set_live_photo_done(
  p_tournament_id uuid,
  p_profile_id uuid,
  p_done boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
begin
  select status
    into v_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found or v_status <> 'live' then
    raise exception 'photo_unavailable';
  end if;

  update public.player
     set photo_done = p_done
   where tournament_id = p_tournament_id
     and profile_id = p_profile_id
     and photo_partner_id is not null;
  if not found then
    raise exception 'photo_unavailable';
  end if;
end;
$$;

revoke all on function public.set_live_photo_done(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_live_photo_done(uuid, uuid, boolean)
  to service_role;

create or replace function public.set_live_photo_email(
  p_tournament_id uuid,
  p_profile_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
begin
  select status
    into v_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found or v_status <> 'live' then
    raise exception 'photo_unavailable';
  end if;

  update public.player
     set photo_email = p_email
   where tournament_id = p_tournament_id
     and profile_id = p_profile_id
     and photo_partner_id is not null;
  if not found then
    raise exception 'photo_unavailable';
  end if;
end;
$$;

revoke all on function public.set_live_photo_email(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_live_photo_email(uuid, uuid, text)
  to service_role;

create or replace function public.update_tournament_setup_settings(
  p_tournament_id uuid,
  p_rink_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
  v_play_status text;
begin
  if p_rink_count is null or p_rink_count < 1 or p_rink_count > 20 then
    raise exception 'invalid_rink_count';
  end if;

  select status, play_status
    into v_status, v_play_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'setup'
     or v_play_status <> 'preview'
     or exists (
       select 1
         from public.fixture
        where tournament_id = p_tournament_id
     ) then
    raise exception 'roster_locked';
  end if;

  update public.tournament
     set rink_count = p_rink_count
   where id = p_tournament_id;
end;
$$;

revoke all on function public.update_tournament_setup_settings(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.update_tournament_setup_settings(uuid, integer)
  to service_role;

-- Reserve a team only while setup still owns the tournament row lock. Account
-- creation may take a few seconds afterward; draw publication separately
-- verifies that every reserved team has its full player complement.
create or replace function public.create_setup_team(
  p_tournament_id uuid,
  p_team_name text,
  p_submit_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
  v_team_id uuid;
begin
  select status
    into v_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'setup'
     or exists (
       select 1
         from public.fixture
        where tournament_id = p_tournament_id
     ) then
    raise exception 'roster_locked';
  end if;

  insert into public.team (tournament_id, name, submit_key)
  values (p_tournament_id, nullif(btrim(p_team_name), ''), p_submit_key)
  returning id into v_team_id;

  return v_team_id;
end;
$$;

revoke all on function public.create_setup_team(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_setup_team(uuid, text, uuid)
  to service_role;

-- The draw is calculated outside PostgreSQL. Verify the settings used by that
-- calculation under the same row lock as publication, so a simultaneous rink
-- edit can never publish a schedule built for stale settings.
create or replace function public.apply_tournament_draw_v2(
  p_tournament_id uuid,
  p_expected_rink_count integer,
  p_expected_preferred_group_size integer,
  p_assignments jsonb,
  p_fixtures jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.tournament_status;
  v_rink_count integer;
  v_preferred_group_size integer;
  v_team_size integer;
begin
  select status, rink_count, preferred_group_size, team_size
    into v_status, v_rink_count, v_preferred_group_size, v_team_size
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'setup' then
    raise exception 'draw_already_live';
  end if;
  if v_rink_count <> p_expected_rink_count
     or v_preferred_group_size <> p_expected_preferred_group_size then
    raise exception 'draw_settings_changed';
  end if;
  if exists (
    select 1
      from public.team as team
      left join public.player as player on player.team_id = team.id
     where team.tournament_id = p_tournament_id
       and team.withdrawn = false
     group by team.id
    having count(player.id) <> v_team_size
  ) then
    raise exception 'draw_roster_incomplete';
  end if;

  perform public.apply_tournament_draw(
    p_tournament_id,
    p_assignments,
    p_fixtures
  );
end;
$$;

revoke all on function public.apply_tournament_draw_v2(
  uuid, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_tournament_draw_v2(
  uuid, integer, integer, jsonb, jsonb
) to service_role;
