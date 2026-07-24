-- 0015_photo.sql — photo-bomb challenge. Each player gets a fixed random
-- partner (a single random cycle), and can mark the photo done. Photos are
-- uploaded to an Apple Shared Album (link stored on event_settings), not here.
alter table public.player
  add column if not exists photo_partner_id uuid references public.player(id) on delete set null;
alter table public.player
  add column if not exists photo_done boolean not null default false;
alter table public.event_settings
  add column if not exists photo_album_url text;

update public.event_settings
set photo_album_url = 'https://www.icloud.com/sharedalbum/#B1mGdIshafM6Mm'
where id = 1 and photo_album_url is null;

-- One-off: assign partners for the current live tournament as a random cycle,
-- so it can be tested straight away. Future tournaments assign at generate time.
with shuffled as (
  select id,
         row_number() over (order by random()) as rn,
         count(*) over () as total
  from public.player
  where tournament_id =
        (select id from public.tournament where status <> 'archived' limit 1)
)
update public.player p
set photo_partner_id = nxt.id
from shuffled s
join shuffled nxt on nxt.rn = (s.rn % s.total) + 1
where p.id = s.id
  and s.total >= 2;
