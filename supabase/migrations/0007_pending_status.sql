-- 0007_pending_status.sql — knockout fixtures start as 'pending' (waiting for
-- their feeder groups/rounds to finish), so add it to the fixture status enum.
alter type fixture_status add value if not exists 'pending';
