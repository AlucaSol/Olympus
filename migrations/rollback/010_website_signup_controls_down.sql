-- Rollback for 010_website_signup_controls.sql
--
-- Removes the website signup gate entirely. Nothing in 001-009 depends on any
-- of it, so this is safe to run at any time; the only consequence is that
-- Supabase Auth signup returns to whatever the dashboard alone allows.
--
-- DESTRUCTIVE: drops the IP quota, the invitation codes and the attempt log.
-- Take a copy first if any of it matters:
--
--   create table public.signup_backup_invites as table public.signup_invites;
--   create table public.signup_backup_quota   as table public.signup_ip_quota;

drop function if exists public.signup_status();
drop function if exists public.create_signup_invite(text, integer, timestamptz);
drop function if exists public.set_maximum_accounts(integer);
drop function if exists public.set_signup_mode(text);
drop function if exists public.purge_signup_records();
drop function if exists public.expire_signup_claims(interval);
drop function if exists public.abort_signup(uuid);
drop function if exists public.complete_signup(uuid, uuid);
drop function if exists public.begin_signup(text, text);
drop function if exists public.log_signup_attempt(bytea, text);

drop table if exists public.signup_claims;
drop table if exists public.signup_attempt_log;
drop table if exists public.signup_ip_quota;
drop table if exists public.signup_invites;
drop table if exists public.signup_config;

-- pgcrypto is left installed: it is a shared extension and other things may
-- have started using it.
