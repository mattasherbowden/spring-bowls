-- =====================================================================
-- Spring Bowls — 0004_seed.sql  (optional demo/dev seed)
-- Run AFTER 0003_rls.sql. SAFE TO SKIP in production.
--
-- Seeding auth.users + player requires the admin API for real accounts.
-- This file only seeds the tournament-scoped structural data that does NOT
-- require an auth user (tournament, groups, rinks, teams, awards, fixtures).
-- Player rows and team membership are created by the server-side
-- service_role admin-creation path (D-0009) / app.bootstrap_owner, so they
-- are intentionally NOT seeded here.
--
-- Run as a role that bypasses RLS (service_role / postgres). Under RLS these
-- inserts would otherwise be admin-gated.
-- =====================================================================

-- Optional: pin the synthetic-email domain for this database.
-- alter database postgres set app.synthetic_email_domain = 'accounts.springbowls.invalid';

do $$
declare
  v_tid  uuid;
  v_grpA uuid;
  v_grpB uuid;
  v_r1   uuid;
  v_r2   uuid;
  v_t1   uuid;
  v_t2   uuid;
  v_t3   uuid;
  v_t4   uuid;
begin
  -- Tournament (setup; flip to 'live' once accounts + fixtures are ready).
  insert into public.tournament (name, status)
  values ('Spring Bowls 2026', 'setup')
  returning id into v_tid;

  -- Groups
  insert into public.tournament_group (tournament_id, name, sort_order)
  values (v_tid, 'A', 1) returning id into v_grpA;
  insert into public.tournament_group (tournament_id, name, sort_order)
  values (v_tid, 'B', 2) returning id into v_grpB;

  -- Rinks
  insert into public.rink (tournament_id, label) values (v_tid, 'Rink 1') returning id into v_r1;
  insert into public.rink (tournament_id, label) values (v_tid, 'Rink 2') returning id into v_r2;

  -- Teams (membership added later via service_role once players exist)
  insert into public.team (tournament_id, group_id, name, seed)
  values (v_tid, v_grpA, 'Rink Rats', 1)      returning id into v_t1;
  insert into public.team (tournament_id, group_id, name, seed)
  values (v_tid, v_grpA, 'Jack Attack', 2)    returning id into v_t2;
  insert into public.team (tournament_id, group_id, name, seed)
  values (v_tid, v_grpB, 'The Woods', 3)      returning id into v_t3;
  insert into public.team (tournament_id, group_id, name, seed)
  values (v_tid, v_grpB, 'Bowl Movement', 4)  returning id into v_t4;

  -- A couple of group fixtures (scheduled; scores entered later)
  insert into public.fixture (tournament_id, stage, group_id, rink_id, team_home_id, team_away_id)
  values
    (v_tid, 'group', v_grpA, v_r1, v_t1, v_t2),
    (v_tid, 'group', v_grpB, v_r2, v_t3, v_t4);

  -- Awards (voting starts closed)
  insert into public.award (tournament_id, name, kind, voting_open) values
    (v_tid, 'Player of the Day', 'individual', false),
    (v_tid, 'Team of the Day',   'team',       false);

  raise notice 'Seeded tournament % (Spring Bowls 2026)', v_tid;
end;
$$;
