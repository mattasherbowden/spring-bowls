-- 0016_photo_email.sql — players enter their email so the owner can invite them
-- to the Apple Shared Album as contributors (the album needs invites, not just
-- a public link).
alter table public.player add column if not exists photo_email text;
