-- 0024_team_submission_idempotency.sql — make setup roster submissions safe
-- to retry. A phone may send the same form twice after a double tap or a slow
-- response; both requests now resolve to one team.

alter table public.team
  add column if not exists submit_key uuid;

create unique index if not exists team_submit_key_unique
  on public.team (tournament_id, submit_key)
  where submit_key is not null;

comment on column public.team.submit_key is
  'Client-generated key used to deduplicate setup-time Add team submissions.';
