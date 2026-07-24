-- 0014_vote_limit_per_award.sql — per-award vote caps. Bowl of the Day gets 5
-- votes; every other award stays at 2. Keeps the advisory-lock/race-immunity
-- from 0012. NOTE: the limits here must match `votes` in lib/domain/awards.ts.
create or replace function app.enforce_vote_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  max_votes int := case when new.award_key = 'bowl_of_the_day' then 5 else 2 end;
begin
  perform pg_advisory_xact_lock(
    hashtext(new.voter_id::text), hashtext(new.award_key));
  if (select count(*) from public.award_vote
        where tournament_id = new.tournament_id
          and award_key = new.award_key
          and voter_id = new.voter_id) >= max_votes then
    raise exception 'vote_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
