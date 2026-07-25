-- 0020_exclude_admin_nominees.sql — organisers stay visible in individual
-- award lists, but cannot receive an individual-award vote. Enforce this at the
-- database as well as in the UI/server action so a crafted request cannot
-- bypass the rule. Team-award votes remain unaffected.

create or replace function app.reject_admin_nominee_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_type = 'player' and exists (
    select 1
      from public.player player
      join public.profile profile on profile.id = player.profile_id
     where player.id = new.target_id
       and player.tournament_id = new.tournament_id
       and (profile.is_owner or profile.is_admin)
  ) then
    raise exception 'admin_nominee_not_eligible' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_admin_nominee_vote on public.award_vote;
create trigger reject_admin_nominee_vote
  before insert on public.award_vote
  for each row execute function app.reject_admin_nominee_vote();
