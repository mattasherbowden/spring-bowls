-- 0003_planned_teams.sql — remember how many teams the owner planned for, so
-- the team builder can show "X of N added".
alter table public.tournament
  add column if not exists planned_teams int not null default 12;

do $$ begin
  alter table public.tournament
    add constraint tournament_planned_teams_ck check (planned_teams between 2 and 40);
exception when duplicate_object then null; end $$;
