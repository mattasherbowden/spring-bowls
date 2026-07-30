-- 0027_fixture_preview.sql — publish a draw before event day while keeping
-- scoring and voting locked until the organiser explicitly starts play.

alter table public.tournament
  add column if not exists play_status text not null default 'open'
    check (play_status in ('preview', 'open')),
  add column if not exists fixtures_open_time text not null default '13:00'
    check (
      fixtures_open_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    );

-- Existing tournaments deliberately inherit the default "open" state for
-- backwards compatibility. New tournaments explicitly insert "preview".

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
      and t.play_status = 'open'
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
  current_play_status text;
begin
  select voting_status, play_status
    into current_status, current_play_status
  from public.tournament
  where id = old.tournament_id;

  -- Null parent values mean this is an ON DELETE CASCADE during reset.
  if current_status is not null
     and (
       current_play_status <> 'open'
       or (
         current_status <> 'open'
         and not (
           exists (
             select 1
             from public.tournament t
             where t.id = old.tournament_id
               and t.status = 'live'
           )
           and current_status = 'pending'
           and old.award_key = 'bowl_of_the_day'
         )
       )
     ) then
    raise exception 'voting_closed' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
