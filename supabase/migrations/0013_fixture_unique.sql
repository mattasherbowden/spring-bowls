-- 0013_fixture_unique.sql — prevent duplicate knockout brackets from concurrent
-- resolveKnockout runs (two last-group scores landing at once). Group fixtures
-- have a null match_code (excluded by the partial index); knockout match_codes
-- (QF1, SF1, F1, ...) must be unique per tournament. De-dupe any pre-existing
-- duplicates first so the index can build.
delete from public.fixture a
using public.fixture b
where a.match_code is not null
  and a.tournament_id = b.tournament_id
  and a.match_code = b.match_code
  and a.ctid > b.ctid;

create unique index if not exists fixture_match_code_uq
  on public.fixture (tournament_id, match_code)
  where match_code is not null;
