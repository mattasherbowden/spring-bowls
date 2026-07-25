-- 0017_login_password.sql — store the generated login password so the owner can
-- re-tell a guest their password if they lose their card. Owner-only readable
-- (via the service-role admin client); never exposed to clients. Low-stakes
-- throwaway tournament credentials that are already printed on cards.
alter table public.profile add column if not exists login_password text;
