-- 0009_event.sql — public event/landing info (date, venue, day details) that
-- the owner edits and everyone (even logged out) can read on the landing page.
create table if not exists public.event_settings (
  id int primary key default 1 check (id = 1),
  event_at timestamptz,
  venue_name text,
  venue_address text,
  venue_phone text,
  details text,
  updated_at timestamptz not null default now()
);

alter table public.event_settings enable row level security;
drop policy if exists event_settings_select on public.event_settings;
create policy event_settings_select on public.event_settings
  for select to anon, authenticated using (true);
grant select on public.event_settings to anon, authenticated;

insert into public.event_settings
  (id, event_at, venue_name, venue_address, venue_phone, details)
values
  (1, '2026-08-01T12:30:00+01:00', 'Temple Bowling Club',
   '1A Sunset Road, London SE5 8EA', '020 7274 2449',
$details$⏱️ Schedule
12:30 · Arrival — meet your partner, scope the greens, grab a bev.
1:00 · Tutorial from Jon (our supervisor).
1:30–3:30 · Bowls! We have the greens for this window.
4:00 · Award ceremony.

👕 Dress code
All white (get creative if you like) · flat-soled shoes (ask Jon).

🍹 Drinks
No BYO — we'll use the bar (reasonably priced).

🏆 Awards (prizes TBA)
Grand Final Winner · Cutest Couple · Bowl of the Day · Best Dressed · Coolest Kiwi · Coolest Brit.

🌇 After
An early finish — a solid launch pad for the evening, or stick around for golden hour at the club.

☀️ Wet weather
Surely not.$details$)
on conflict (id) do nothing;
