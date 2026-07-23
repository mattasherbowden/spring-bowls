-- 0004_fixture.sql — the schedule: one row per game, assigned to a rink and a
-- running order. Reads are open to anyone in the tournament; writes go through
-- server actions (schedule generation now; score entry, with its own participant
-- policies, in a later migration).

do $$ begin
  create type fixture_stage as enum ('group', 'knockout');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fixture_status as enum ('scheduled', 'live', 'completed', 'walkover', 'abandoned');
exception when duplicate_object then null; end $$;

create table if not exists public.fixture (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  stage fixture_stage not null default 'group',
  group_label text,
  round int,
  rink int,
  order_index int not null default 0,
  team_a_id uuid references public.team (id) on delete cascade,
  team_b_id uuid references public.team (id) on delete cascade,
  status fixture_status not null default 'scheduled',
  winner_team_id uuid references public.team (id),
  locked_by uuid references public.profile (id),
  created_at timestamptz not null default now()
);
create index if not exists fixture_tournament_idx on public.fixture (tournament_id);
create index if not exists fixture_rink_order_idx
  on public.fixture (tournament_id, rink, order_index);

alter table public.fixture enable row level security;
drop policy if exists fixture_select on public.fixture;
create policy fixture_select on public.fixture
  for select to authenticated using (app.in_tournament(tournament_id));

grant select on public.fixture to authenticated;
