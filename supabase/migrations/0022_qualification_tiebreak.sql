-- 0022_qualification_tiebreak.sql — record an explicit organiser decision when
-- an exact multi-team tie crosses the qualification line.

create table if not exists public.qualification_tiebreak (
  tournament_id uuid not null
    references public.tournament(id) on delete cascade,
  group_label text not null,
  ordered_team_ids uuid[] not null
    check (cardinality(ordered_team_ids) between 2 and 8),
  decided_by uuid references public.profile(id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (tournament_id, group_label)
);

alter table public.qualification_tiebreak enable row level security;
drop policy if exists qualification_tiebreak_select
  on public.qualification_tiebreak;
create policy qualification_tiebreak_select
  on public.qualification_tiebreak
  for select to authenticated
  using (app.in_tournament(tournament_id));
grant select on public.qualification_tiebreak to authenticated;
