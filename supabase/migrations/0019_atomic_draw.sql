-- 0019_atomic_draw.sql — persist the entire generated draw in one transaction.
-- A function call either writes every group, every fixture and the live status,
-- or rolls all of it back. Only the service-role server client may call it.

create or replace function public.apply_tournament_draw(
  p_tournament_id uuid,
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
  v_team_count integer;
  v_assignment_count integer;
  v_updated integer;
  v_inserted integer;
begin
  select status
    into v_status
    from public.tournament
   where id = p_tournament_id
   for update;

  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'setup' then
    raise exception 'draw_already_live';
  end if;
  if exists (
    select 1 from public.fixture where tournament_id = p_tournament_id
  ) then
    raise exception 'fixtures_already_exist';
  end if;

  select count(*)
    into v_team_count
    from public.team
   where tournament_id = p_tournament_id
     and withdrawn = false;
  select count(distinct assignment.id)
    into v_assignment_count
    from jsonb_to_recordset(p_assignments)
      as assignment(id uuid, group_label text);

  if v_team_count < 2 or v_assignment_count <> v_team_count then
    raise exception 'draw_team_count_mismatch';
  end if;

  update public.team as team
     set group_label = assignment.group_label
    from jsonb_to_recordset(p_assignments)
      as assignment(id uuid, group_label text)
   where team.id = assignment.id
     and team.tournament_id = p_tournament_id
     and team.withdrawn = false;
  get diagnostics v_updated = row_count;
  if v_updated <> v_team_count then
    raise exception 'draw_team_update_mismatch';
  end if;

  insert into public.fixture (
    tournament_id,
    stage,
    group_label,
    round,
    rink,
    order_index,
    team_a_id,
    team_b_id
  )
  select
    p_tournament_id,
    'group',
    fixture.group_label,
    fixture.round,
    fixture.rink,
    fixture.order_index,
    fixture.team_a_id,
    fixture.team_b_id
  from jsonb_to_recordset(p_fixtures) as fixture(
    group_label text,
    round integer,
    rink integer,
    order_index integer,
    team_a_id uuid,
    team_b_id uuid
  );
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 or v_inserted <> jsonb_array_length(p_fixtures) then
    raise exception 'draw_fixture_count_mismatch';
  end if;

  update public.tournament
     set status = 'live'
   where id = p_tournament_id
     and status = 'setup';
  if not found then
    raise exception 'draw_status_race';
  end if;
end;
$$;

revoke all on function public.apply_tournament_draw(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_tournament_draw(uuid, jsonb, jsonb)
  to service_role;
