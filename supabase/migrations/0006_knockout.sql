-- 0006_knockout.sql — knockout fixtures carry their source slots so they can
-- resolve to real teams as groups (and earlier rounds) finish.
--   team_a_source / team_b_source: "A1" (group A winner), "B2" (group B
--   runner-up) or "W:QF1" (winner of match QF1). match_code identifies the
--   match (QF1, SF1, F1, ...).
alter table public.fixture add column if not exists match_code text;
alter table public.fixture add column if not exists team_a_source text;
alter table public.fixture add column if not exists team_b_source text;
