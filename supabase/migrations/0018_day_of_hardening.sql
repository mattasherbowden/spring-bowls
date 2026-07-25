-- 0018_day_of_hardening.sql — close two event-day authorization races.
--
-- 1. Standalone helper accounts were promised schedule/score access, but the
--    common tournament read predicate only recognised owners and rostered
--    players. Let global helpers read tournament data; writes still go through
--    server actions, which perform their own capability checks.
-- 2. Voting-open was checked in the action before several round-trips. Enforce
--    it in the same DB transaction as insert/delete so in-flight votes cannot
--    land after the ceremony host closes voting.

create or replace function app.in_tournament(tid uuid)
  returns boolean language sql security definer set search_path = '' stable
as $$
  select exists (
    select 1
    from public.profile pr
    where pr.id = auth.uid() and (pr.is_owner or pr.is_admin)
  ) or exists (
    select 1
    from public.player p
    where p.tournament_id = tid and p.profile_id = auth.uid()
  );
$$;

create or replace function app.enforce_vote_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  max_votes int := case when new.award_key = 'bowl_of_the_day' then 5 else 2 end;
begin
  if not exists (
    select 1
    from public.tournament t
    where t.id = new.tournament_id and t.voting_status = 'open'
  ) then
    raise exception 'voting_closed' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(new.voter_id::text), hashtext(new.award_key));
  if (
    select count(*)
    from public.award_vote
    where tournament_id = new.tournament_id
      and award_key = new.award_key
      and voter_id = new.voter_id
  ) >= max_votes then
    raise exception 'vote_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_voting_open_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
begin
  select voting_status into current_status
  from public.tournament
  where id = old.tournament_id;

  -- A null parent means this is an ON DELETE CASCADE during tournament reset.
  if current_status is not null and current_status <> 'open' then
    raise exception 'voting_closed' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists enforce_voting_open_delete on public.award_vote;
create trigger enforce_voting_open_delete
  before delete on public.award_vote
  for each row execute function app.enforce_voting_open_delete();
