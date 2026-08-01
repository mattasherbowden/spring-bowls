-- 0030_rink_number_start.sql — keep the scheduler's internal rink slots
-- stable while displaying the venue's real, consecutively-numbered rinks.

alter table public.tournament
  add column if not exists rink_number_start integer not null default 1;

alter table public.tournament
  drop constraint if exists tournament_rink_number_start_range;
alter table public.tournament
  add constraint tournament_rink_number_start_range
  check (rink_number_start between 1 and 100);
