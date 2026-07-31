-- 0029_preview_roster_corrections.sql — correct a name or substitute a player
-- in a published preview without deleting or regenerating any fixture.

create or replace function public.update_published_preview_team(
  p_tournament_id uuid,
  p_team_id uuid,
  p_team_name text,
  p_players jsonb
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
  v_team_size integer;
  v_player_count integer;
  v_updated integer;
begin
  select status, play_status, voting_status, team_size
    into v_status, v_play_status, v_voting_status, v_team_size
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'live'
     or v_play_status <> 'preview'
     or v_voting_status <> 'pending' then
    raise exception 'preview_roster_locked';
  end if;
  if exists (
    select 1
      from public.award_vote
     where tournament_id = p_tournament_id
  ) or exists (
    select 1
      from public.fixture_end as fixture_end
      join public.fixture as fixture on fixture.id = fixture_end.fixture_id
     where fixture.tournament_id = p_tournament_id
  ) or exists (
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
    raise exception 'preview_roster_activity_exists';
  end if;
  if not exists (
    select 1
      from public.team
     where id = p_team_id
       and tournament_id = p_tournament_id
  ) then
    raise exception 'team_not_found';
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    raise exception 'team_size_mismatch';
  end if;
  if jsonb_array_length(p_players) <> v_team_size then
    raise exception 'team_size_mismatch';
  end if;
  if char_length(btrim(coalesce(p_team_name, ''))) > 80 then
    raise exception 'invalid_team_name';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_players)
        as input(id uuid, display_name text, nationality text)
     where char_length(btrim(coalesce(input.display_name, ''))) not between 1 and 60
        or input.nationality is null
        or input.nationality not in ('brit', 'kiwi')
  ) then
    raise exception 'invalid_player_details';
  end if;
  if (
    select count(distinct input.id)
      from jsonb_to_recordset(p_players)
        as input(id uuid, display_name text, nationality text)
  ) <> v_team_size then
    raise exception 'duplicate_player';
  end if;

  select count(*)
    into v_player_count
    from public.player as player
    join jsonb_to_recordset(p_players)
      as input(id uuid, display_name text, nationality text)
      on input.id = player.id
   where player.tournament_id = p_tournament_id
     and player.team_id = p_team_id;
  if v_player_count <> v_team_size then
    raise exception 'player_not_in_team';
  end if;

  update public.team
     set name = nullif(btrim(p_team_name), '')
   where id = p_team_id
     and tournament_id = p_tournament_id;

  update public.player as player
     set display_name = btrim(input.display_name),
         nationality = input.nationality::public.nationality
    from jsonb_to_recordset(p_players)
      as input(id uuid, display_name text, nationality text)
   where player.id = input.id
     and player.tournament_id = p_tournament_id
     and player.team_id = p_team_id;
  get diagnostics v_updated = row_count;
  if v_updated <> v_team_size then
    raise exception 'player_update_mismatch';
  end if;

  -- The Auth email, username, password, player/team IDs, group assignment,
  -- photo partner and every fixture remain untouched.
  update public.profile as profile
     set display_name = btrim(input.display_name)
    from public.player as player
    join jsonb_to_recordset(p_players)
      as input(id uuid, display_name text, nationality text)
      on input.id = player.id
   where profile.id = player.profile_id
     and player.tournament_id = p_tournament_id
     and player.team_id = p_team_id;
end;
$$;

revoke all on function public.update_published_preview_team(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.update_published_preview_team(
  uuid, uuid, text, jsonb
) to service_role;
