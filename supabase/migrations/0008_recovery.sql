-- 0008_recovery.sql — owner password recovery (no email on file, so a code).
-- Stores a hash of a one-time recovery code the owner generates and saves.
alter table public.profile add column if not exists recovery_hash text;
