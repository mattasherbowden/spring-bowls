-- 0001_accounts.sql — accounts slice
-- App-level identity for username+password auth (D-0002). One owner (D-0010).
-- No self-registration: only the service_role (server admin client) writes here
-- (D-0009). Guards threat-model items T-03 (anon SECURITY DEFINER exposure) and
-- T-04 (canonical username uniqueness). See docs/security-threat-model.md.

create table if not exists public.profile (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  username_canonical text generated always as (lower(btrim(username))) stored,
  display_name text not null,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profile_username_charset
    check (username ~ '^[A-Za-z0-9._-]{2,32}$'),
  constraint profile_display_name_len
    check (char_length(btrim(display_name)) between 1 and 60)
);

-- Canonical (case/space-folded) username is unique — so "Will", "will" and
-- " will " can never become two different logins (threat T-04).
create unique index if not exists profile_username_canonical_key
  on public.profile (username_canonical);

-- At most one owner across the whole app.
create unique index if not exists profile_single_owner
  on public.profile (is_owner) where is_owner;

alter table public.profile enable row level security;

-- A signed-in user may read only their own profile. There are deliberately NO
-- insert/update/delete policies, so only the service_role (server admin client)
-- can write — enforcing "owner/admin create all accounts" (D-0009).
drop policy if exists profile_select_self on public.profile;
create policy profile_select_self on public.profile
  for select to authenticated
  using (id = (select auth.uid()));

-- Public setup check: has the owner been created yet? Returns ONLY a boolean so
-- an anonymous visitor can choose between the "create owner" and "log in"
-- screens without exposing any table data (threat T-03 — we expose just this
-- one narrow function to anon, not the cross-table helpers).
create or replace function public.owner_exists()
  returns boolean
  language sql
  security definer
  set search_path = ''
  stable
as $$
  select exists (select 1 from public.profile where is_owner);
$$;

revoke all on function public.owner_exists() from public;
grant execute on function public.owner_exists() to anon, authenticated;
