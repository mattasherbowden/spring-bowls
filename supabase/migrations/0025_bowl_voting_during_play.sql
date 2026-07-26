-- 0025_bowl_voting_during_play.sql — keep Bowl of the Day available while
-- ceremony voting is still pending. Closing voting still atomically closes
-- every award, including Bowl of the Day.

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
    where t.id = new.tournament_id
      and (
        t.voting_status = 'open'
        or (
          t.status = 'live'
          and
          t.voting_status = 'pending'
          and new.award_key = 'bowl_of_the_day'
        )
      )
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
  if current_status is not null
     and current_status <> 'open'
     and not (
       exists (
         select 1
         from public.tournament t
         where t.id = old.tournament_id
           and t.status = 'live'
       )
       and
       current_status = 'pending'
       and old.award_key = 'bowl_of_the_day'
     ) then
    raise exception 'voting_closed' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
