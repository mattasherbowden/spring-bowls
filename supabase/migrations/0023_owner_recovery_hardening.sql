-- 0023_owner_recovery_hardening.sql — make the owner's no-email recovery code
-- genuinely one-time and rate-limit online guessing.

create table if not exists app.owner_recovery_attempt (
  id bigint generated always as identity primary key,
  username_canonical text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists owner_recovery_attempt_lookup
  on app.owner_recovery_attempt (username_canonical, attempted_at);
revoke all on app.owner_recovery_attempt from public, anon, authenticated;

create or replace function public.consume_owner_recovery(
  p_username text,
  p_code_hash text
)
returns table(status text, profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(p_username));
  v_profile_id uuid;
  v_recovery_hash text;
  v_attempts integer;
begin
  -- Serialize attempts for the same canonical username.
  perform pg_advisory_xact_lock(
    hashtext('spring-bowls-owner-recovery'),
    hashtext(v_username)
  );

  delete from app.owner_recovery_attempt
   where attempted_at < now() - interval '1 day';
  select count(*)
    into v_attempts
    from app.owner_recovery_attempt
   where username_canonical = v_username
     and attempted_at >= now() - interval '15 minutes';
  if v_attempts >= 8 then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  select id, recovery_hash
    into v_profile_id, v_recovery_hash
    from public.profile
   where username_canonical = v_username
     and is_owner;

  if v_profile_id is null
     or v_recovery_hash is null
     or v_recovery_hash <> p_code_hash then
    insert into app.owner_recovery_attempt (username_canonical)
    values (v_username);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- Consume before the external Auth password update. The server restores this
  -- hash only if that update fails, without overwriting a newly generated code.
  update public.profile
     set recovery_hash = null
   where id = v_profile_id
     and recovery_hash = p_code_hash;
  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  delete from app.owner_recovery_attempt
   where username_canonical = v_username;
  return query select 'ok'::text, v_profile_id;
end;
$$;

revoke all on function public.consume_owner_recovery(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_owner_recovery(text, text)
  to service_role;
