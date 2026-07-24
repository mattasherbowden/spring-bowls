-- 0010_admin.sql — standalone helper (admin) accounts, independent of any
-- tournament. profile.is_admin grants score-fixing across whatever tournament
-- is running; the owner mints these logins. Unlike player.role (per-tournament),
-- this is a global capability that works even with no tournament set up.
alter table public.profile
  add column if not exists is_admin boolean not null default false;

-- Let the owner and global helpers read all player rows (for names in the
-- score-fixing UI). Players themselves are still limited to their own tournament.
drop policy if exists player_select_global_admin on public.player;
create policy player_select_global_admin on public.player
  for select to authenticated
  using (
    exists (
      select 1 from public.profile pr
      where pr.id = auth.uid() and (pr.is_owner or pr.is_admin)
    )
  );
