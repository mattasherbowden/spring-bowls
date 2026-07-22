-- =====================================================================
-- Spring Bowls — 0001_schema.sql  (DDL only)
-- Postgres 15+ on Supabase; pgcrypto provides gen_random_uuid().
-- Run order: 0001_schema -> 0002_functions -> 0003_rls -> 0004_seed
--
-- Red-team fixes applied at the SCHEMA layer:
--   * Composite unique keys + composite FKs so fixture team/winner refs
--     can never point at another tournament's team (finding: admin cross-
--     tournament fixture UPDATE).
--   * award.closed_at one-way voting latch column (finding: voting reopen).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type tournament_status as enum ('setup', 'live', 'archived');

create type fixture_status as enum (
  'scheduled',
  'live',
  'decider',
  'completed',
  'walkover'
);

create type stage_type as enum ('group', 'knockout');
create type app_role   as enum ('owner', 'admin', 'player');
create type award_kind as enum ('individual', 'team');

-- ---------------------------------------------------------------------
-- TOURNAMENT
-- ---------------------------------------------------------------------
create table tournament (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  status                 tournament_status not null default 'setup',
  walkover_shots_for     smallint not null default 10 check (walkover_shots_for >= 0),
  walkover_shots_against smallint not null default 0  check (walkover_shots_against >= 0),
  points_win             smallint not null default 1  check (points_win >= 0),
  points_loss            smallint not null default 0  check (points_loss >= 0),
  ends_per_fixture       smallint check (ends_per_fixture is null or ends_per_fixture > 0),
  created_at             timestamptz not null default now(),
  archived_at            timestamptz,
  constraint archived_has_timestamp
    check ((status = 'archived') = (archived_at is not null))
);

-- ---------------------------------------------------------------------
-- PLAYER  (profile; 1:1 to auth.users; carries role)
-- ---------------------------------------------------------------------
create table player (
  id                 uuid primary key default gen_random_uuid(),
  tournament_id      uuid not null references tournament(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  role               app_role not null default 'player',
  username           text  not null,
  username_canonical citext not null,
  display_name       text,
  created_at         timestamptz not null default now(),

  unique (user_id),
  unique (tournament_id, username_canonical),
  -- composite UK so team_member / vote / etc. can pin player to a tournament
  unique (id, tournament_id),
  constraint username_not_blank check (btrim(username) <> ''),
  constraint canonical_matches
    check (username_canonical = lower(btrim(username))::citext)
);

-- Exactly one owner per tournament.
create unique index one_owner_per_tournament
  on player (tournament_id)
  where role = 'owner';

create index player_tournament_idx on player (tournament_id);
create index player_user_idx       on player (user_id);

-- ---------------------------------------------------------------------
-- GROUP
-- ---------------------------------------------------------------------
create table tournament_group (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references tournament(id) on delete cascade,
  name           text not null,
  advance_count  smallint not null default 2 check (advance_count >= 0),
  sort_order     smallint not null default 0,
  unique (tournament_id, name),
  -- composite UK to support the composite FK from team.group_id
  unique (id, tournament_id)
);

create index group_tournament_idx on tournament_group (tournament_id);

-- ---------------------------------------------------------------------
-- TEAM
-- ---------------------------------------------------------------------
create table team (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament(id) on delete cascade,
  group_id      uuid,
  name          text not null,
  seed          smallint,
  created_at    timestamptz not null default now(),
  unique (tournament_id, name),
  -- composite UK so fixture team/winner columns can pin to same tournament
  unique (id, tournament_id),
  -- a team's group must belong to the same tournament as the team
  constraint group_in_same_tournament
    foreign key (group_id, tournament_id)
    references tournament_group (id, tournament_id) on delete set null
);

create index team_tournament_idx on team (tournament_id);
create index team_group_idx      on team (group_id);

-- TEAM_MEMBER
create table team_member (
  team_id       uuid not null references team(id) on delete cascade,
  player_id     uuid not null references player(id) on delete cascade,
  tournament_id uuid not null references tournament(id) on delete cascade,
  primary key (team_id, player_id),
  -- both the team and the player must belong to this tournament
  constraint team_in_same_tournament
    foreign key (team_id, tournament_id)   references team(id, tournament_id)   on delete cascade,
  constraint player_in_same_tournament
    foreign key (player_id, tournament_id) references player(id, tournament_id) on delete cascade
);

-- a player joins at most one team per tournament
create unique index one_team_per_player_per_tournament
  on team_member (tournament_id, player_id);

create index team_member_player_idx on team_member (player_id);

-- ---------------------------------------------------------------------
-- RINK
-- ---------------------------------------------------------------------
create table rink (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament(id) on delete cascade,
  label         text not null,
  unique (tournament_id, label),
  unique (id, tournament_id)
);

-- ---------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------
create table fixture (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references tournament(id) on delete cascade,
  stage          stage_type not null,
  group_id       uuid,
  knockout_round smallint,     -- convention: 1 = final, 2 = semis, ... (see check)
  bracket_slot   smallint,
  rink_id        uuid,

  team_home_id   uuid,
  team_away_id   uuid,
  is_bye         boolean not null default false,

  status         fixture_status not null default 'scheduled',
  winner_team_id uuid,

  home_shots     smallint check (home_shots >= 0),
  away_shots     smallint check (away_shots >= 0),

  locked_at      timestamptz,
  scheduled_at   timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),

  -- FKs pinned to the SAME tournament (closes cross-tournament ref finding)
  constraint fixture_group_same_tournament
    foreign key (group_id, tournament_id)
    references tournament_group (id, tournament_id) on delete cascade,
  constraint fixture_rink_same_tournament
    foreign key (rink_id, tournament_id)
    references rink (id, tournament_id) on delete set null,
  constraint fixture_home_same_tournament
    foreign key (team_home_id, tournament_id)
    references team (id, tournament_id) on delete restrict,
  constraint fixture_away_same_tournament
    foreign key (team_away_id, tournament_id)
    references team (id, tournament_id) on delete restrict,
  constraint fixture_winner_same_tournament
    foreign key (winner_team_id, tournament_id)
    references team (id, tournament_id) on delete restrict,

  -- knockout numbering convention pinned: rounds are positive
  constraint knockout_round_positive
    check (knockout_round is null or knockout_round > 0),

  constraint stage_shape check (
    (stage = 'group'    and group_id is not null and knockout_round is null)
 or (stage = 'knockout' and knockout_round is not null)
  ),
  constraint teams_distinct check (
    team_home_id is distinct from team_away_id
  ),
  constraint bye_has_one_team check (
    (not is_bye) or (team_home_id is null) <> (team_away_id is null)
  ),
  constraint not_both_teams_null check (
    team_home_id is not null or team_away_id is not null
  ),
  constraint winner_is_a_participant check (
    winner_team_id is null
    or winner_team_id = team_home_id
    or winner_team_id = team_away_id
  ),
  constraint completed_has_winner check (
    status <> 'completed' or winner_team_id is not null
  ),
  constraint locked_when_playing check (
    status = 'scheduled' or locked_at is not null
  )
);

create unique index fixture_group_pair_uk
  on fixture (group_id, least(team_home_id, team_away_id),
                        greatest(team_home_id, team_away_id))
  where stage = 'group' and team_home_id is not null and team_away_id is not null;

create index fixture_tournament_idx on fixture (tournament_id, status);
create index fixture_group_idx      on fixture (group_id);
create index fixture_home_idx       on fixture (team_home_id);
create index fixture_away_idx       on fixture (team_away_id);
create index fixture_rink_idx       on fixture (rink_id);

-- ---------------------------------------------------------------------
-- END
-- ---------------------------------------------------------------------
create table fixture_end (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references fixture(id) on delete cascade,
  end_number  smallint not null check (end_number > 0),
  home_shots  smallint not null default 0 check (home_shots >= 0),
  away_shots  smallint not null default 0 check (away_shots >= 0),
  is_decider  boolean not null default false,
  recorded_by uuid references player(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (fixture_id, end_number),
  constraint decider_not_level
    check (not is_decider or home_shots <> away_shots)
);

create index fixture_end_fixture_idx on fixture_end (fixture_id);

-- ---------------------------------------------------------------------
-- AWARD  (voting_open toggle + closed_at one-way latch)
-- ---------------------------------------------------------------------
create table award (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references tournament(id) on delete cascade,
  name             text not null,
  kind             award_kind not null,
  voting_open      boolean not null default false,
  -- Set the first time voting is closed / a winner is frozen. Once set,
  -- voting can never be re-opened (enforced by trigger in 0002).
  closed_at        timestamptz,
  winner_player_id uuid,
  winner_team_id   uuid,
  unique (tournament_id, name),
  unique (id, tournament_id),
  -- winner refs pinned to same tournament
  constraint award_winner_player_same_tournament
    foreign key (winner_player_id, tournament_id)
    references player (id, tournament_id) on delete set null,
  constraint award_winner_team_same_tournament
    foreign key (winner_team_id, tournament_id)
    references team (id, tournament_id) on delete set null,
  constraint winner_matches_kind check (
    (kind = 'individual' and winner_team_id   is null)
 or (kind = 'team'       and winner_player_id is null)
  )
);

create index award_tournament_idx on award (tournament_id);

-- ---------------------------------------------------------------------
-- VOTE
-- ---------------------------------------------------------------------
create table vote (
  id                uuid primary key default gen_random_uuid(),
  award_id          uuid not null references award(id) on delete cascade,
  voter_player_id   uuid not null references player(id) on delete cascade,
  nominee_player_id uuid references player(id) on delete cascade,
  nominee_team_id   uuid references team(id)   on delete cascade,
  ballot_slot       smallint not null check (ballot_slot in (1, 2)),
  created_at        timestamptz not null default now(),

  constraint one_nominee_kind check (
    (nominee_player_id is not null) <> (nominee_team_id is not null)
  ),
  constraint no_self_vote check (nominee_player_id is distinct from voter_player_id)
);

create unique index vote_one_per_slot
  on vote (award_id, voter_player_id, ballot_slot);

create unique index vote_distinct_player_nominee
  on vote (award_id, voter_player_id, nominee_player_id)
  where nominee_player_id is not null;

create unique index vote_distinct_team_nominee
  on vote (award_id, voter_player_id, nominee_team_id)
  where nominee_team_id is not null;

create index vote_award_idx on vote (award_id);
create index vote_voter_idx on vote (voter_player_id);
