-- 0005_scoring.sql — per-end scores + fixture result fields.
-- SECURITY (threat T-01/T-02): clients can READ ends but never write them. All
-- score writes go through the submitScore server action, which checks (a) the
-- caller is on one of the two teams (or an admin) and (b) the fixture isn't
-- already locked, then computes the winner server-side (no client-supplied
-- winner/decider is trusted) and locks the fixture atomically.

alter table public.fixture add column if not exists locked_at timestamptz;
alter table public.fixture add column if not exists shots_a int;
alter table public.fixture add column if not exists shots_b int;
alter table public.fixture add column if not exists entered_by text;

create table if not exists public.fixture_end (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixture (id) on delete cascade,
  end_number int not null,
  is_decider boolean not null default false,
  shots_a int not null check (shots_a >= 0),
  shots_b int not null check (shots_b >= 0),
  created_at timestamptz not null default now(),
  unique (fixture_id, end_number)
);
create index if not exists fixture_end_fixture_idx
  on public.fixture_end (fixture_id);

alter table public.fixture_end enable row level security;
drop policy if exists fixture_end_select on public.fixture_end;
create policy fixture_end_select on public.fixture_end
  for select to authenticated
  using (
    app.in_tournament(
      (select f.tournament_id from public.fixture f where f.id = fixture_id)
    )
  );

grant select on public.fixture_end to authenticated;
