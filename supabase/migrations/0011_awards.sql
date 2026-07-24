-- 0011_awards.sql — awards voting.
-- Ballots are secret: only aggregate tallies are shown (computed server-side),
-- and votes are written ONLY by the service-role action (no client writes), so
-- they can't be forged. Voting opens/closes per tournament.
alter table public.tournament
  add column if not exists voting_status text not null default 'pending'
  check (voting_status in ('pending', 'open', 'closed'));

create table if not exists public.award_vote (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournament(id) on delete cascade,
  award_key      text not null,
  voter_id       uuid not null references public.profile(id) on delete cascade,
  target_type    text not null check (target_type in ('team', 'player')),
  target_id      uuid not null,
  created_at     timestamptz not null default now(),
  -- one voter can't vote the same nominee twice for the same award
  unique (tournament_id, award_key, voter_id, target_id)
);

create index if not exists award_vote_tally_idx
  on public.award_vote (tournament_id, award_key, target_id);

alter table public.award_vote enable row level security;
-- A voter may read only their own ballot; tallies are computed with the
-- service-role key. No client insert/update/delete — the action does it all.
drop policy if exists award_vote_select_own on public.award_vote;
create policy award_vote_select_own on public.award_vote
  for select to authenticated using (voter_id = auth.uid());
grant select on public.award_vote to authenticated;
