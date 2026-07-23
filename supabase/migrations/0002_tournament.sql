-- 0002_tournament.sql — tournaments, teams, players (per-tournament membership).
-- Reads are protected by RLS; writes go through server actions (service role
-- for account creation, D-0009). Authorization helpers live in a private `app`
-- schema that is NOT exposed via the API (threat T-03).

do $$ begin
  create type tournament_status as enum ('setup', 'live', 'archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type player_role as enum ('admin', 'player');
exception when duplicate_object then null; end $$;
do $$ begin
  create type nationality as enum ('brit', 'kiwi');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------

create table if not exists public.tournament (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Spring Bowls',
  status tournament_status not null default 'setup',
  team_size int not null default 2 check (team_size between 1 and 4),
  rink_count int not null default 3 check (rink_count between 1 and 20),
  ends_per_game int not null default 2 check (ends_per_game between 1 and 10),
  minutes_per_end int not null default 12 check (minutes_per_end between 1 and 60),
  advance int not null default 2 check (advance in (1, 2)),
  preferred_group_size int not null default 4 check (preferred_group_size between 2 and 8),
  start_time text,
  voting_open boolean not null default false,
  created_by uuid not null references public.profile (id),
  created_at timestamptz not null default now()
);

-- At most one tournament that is not archived (one live event at a time).
create unique index if not exists tournament_one_active
  on public.tournament ((true)) where status <> 'archived';

create table if not exists public.team (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  name text,
  group_label text,
  seed int,
  withdrawn boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists team_tournament_idx on public.team (tournament_id);

create table if not exists public.player (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  team_id uuid references public.team (id) on delete set null,
  profile_id uuid not null references public.profile (id) on delete cascade,
  display_name text not null,
  role player_role not null default 'player',
  nationality nationality,
  created_at timestamptz not null default now(),
  unique (tournament_id, profile_id)
);
create index if not exists player_tournament_idx on public.player (tournament_id);
create index if not exists player_team_idx on public.player (team_id);

-- ---------- authorization helpers (private schema) ----------

create schema if not exists app;

create or replace function app.is_owner()
  returns boolean language sql security definer set search_path = '' stable
as $$ select exists (select 1 from public.profile where id = auth.uid() and is_owner); $$;

create or replace function app.in_tournament(tid uuid)
  returns boolean language sql security definer set search_path = '' stable
as $$
  select app.is_owner() or exists (
    select 1 from public.player p
    where p.tournament_id = tid and p.profile_id = auth.uid()
  );
$$;

create or replace function app.is_tournament_admin(tid uuid)
  returns boolean language sql security definer set search_path = '' stable
as $$
  select app.is_owner() or exists (
    select 1 from public.player p
    where p.tournament_id = tid and p.profile_id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on schema app from public;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

-- ---------- RLS ----------

alter table public.tournament enable row level security;
drop policy if exists tournament_select on public.tournament;
create policy tournament_select on public.tournament
  for select to authenticated using (app.in_tournament(id));
drop policy if exists tournament_insert on public.tournament;
create policy tournament_insert on public.tournament
  for insert to authenticated
  with check (app.is_owner() and created_by = (select auth.uid()));
drop policy if exists tournament_update on public.tournament;
create policy tournament_update on public.tournament
  for update to authenticated
  using (app.is_tournament_admin(id)) with check (app.is_tournament_admin(id));
drop policy if exists tournament_delete on public.tournament;
create policy tournament_delete on public.tournament
  for delete to authenticated using (app.is_owner());

-- team/player reads only for people in the tournament; all writes go through
-- server actions using the service role (default-deny for regular clients).
alter table public.team enable row level security;
drop policy if exists team_select on public.team;
create policy team_select on public.team
  for select to authenticated using (app.in_tournament(tournament_id));

alter table public.player enable row level security;
drop policy if exists player_select on public.player;
create policy player_select on public.player
  for select to authenticated using (app.in_tournament(tournament_id));

-- Table privileges (RLS still gates every row). tournament is writable by
-- authenticated (RLS restricts to owner/admin); team/player are read-only to
-- clients and only written by the service role via server actions.
grant select, insert, update, delete on public.tournament to authenticated;
grant select on public.team to authenticated;
grant select on public.player to authenticated;
