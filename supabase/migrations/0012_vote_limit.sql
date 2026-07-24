-- 0012_vote_limit.sql — enforce the 2-votes-per-award cap at the DB layer.
-- The app check in castVote is a non-atomic read-then-insert (TOCTOU race), so
-- concurrent requests could exceed 2 votes. This trigger makes the cap
-- race-immune: an advisory lock per (voter, award) serialises concurrent
-- inserts so the count is reliable under READ COMMITTED.
-- NOTE: the literal 2 must match VOTES_PER_AWARD in lib/domain/awards.ts.
create or replace function app.enforce_vote_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext(new.voter_id::text), hashtext(new.award_key));
  if (select count(*) from public.award_vote
        where tournament_id = new.tournament_id
          and award_key = new.award_key
          and voter_id = new.voter_id) >= 2 then
    raise exception 'vote_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_vote_limit on public.award_vote;
create trigger enforce_vote_limit
  before insert on public.award_vote
  for each row execute function app.enforce_vote_limit();
