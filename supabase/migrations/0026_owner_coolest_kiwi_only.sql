-- 0026_owner_coolest_kiwi_only.sql — the owner opted out of Coolest Kiwi,
-- not every individual award. Keep the owner eligible for Bowl of the Day and
-- keep helpers eligible anywhere their normal nationality/team allows.

create or replace function app.reject_admin_nominee_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.award_key = 'coolest_kiwi'
     and new.target_type = 'player'
     and exists (
       select 1
         from public.player player
         join public.profile profile on profile.id = player.profile_id
        where player.id = new.target_id
          and player.tournament_id = new.tournament_id
          and profile.is_owner
     ) then
    raise exception 'owner_coolest_kiwi_not_eligible'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
