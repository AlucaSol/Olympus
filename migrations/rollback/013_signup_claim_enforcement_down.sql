-- Rollback for 013_signup_claim_enforcement.sql
--
-- Restores handle_new_auth_user() to exactly its 001 behaviour: create the
-- player profile, no claim requirement. Accounts already created are
-- unaffected.
--
-- If you only want to *disable* the requirement without unpicking the
-- migration, do this instead — it is a one-line change and keeps everything
-- else in place:
--
--     update public.signup_config set require_signup_claim = false;

drop function if exists public.signup_availability();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_username text;
begin
    selected_username := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
        split_part(coalesce(new.email, ''), '@', 1)
    );

    if selected_username !~ '^[A-Za-z0-9_]{3,24}$' then
        raise exception 'New account has an invalid username';
    end if;

    insert into public.player_accounts (
        user_id,
        username,
        favour
    )
    values (
        new.id,
        selected_username,
        0
    );

    return new;
end;
$$;

revoke execute
on function public.handle_new_auth_user()
from public, anon, authenticated;

-- signup_status() must stop selecting the column before the column goes, or
-- the next call to it would fail.
create or replace function public.signup_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_mode     text;
    v_ceiling  integer;
    v_accounts integer;
    v_pending  integer;
    v_unconf   integer;
    v_invites  integer;
begin
    select c.signup_mode, c.maximum_accounts
      into v_mode, v_ceiling
      from public.signup_config c
     where c.id;

    select count(*) into v_accounts from auth.users;
    select count(*) into v_unconf from auth.users u where u.email_confirmed_at is null;
    select count(*) into v_pending from public.signup_claims sc where sc.status = 'pending';
    select count(*) into v_invites
      from public.signup_invites i
     where i.is_enabled
       and i.used_count < i.max_uses
       and (i.expires_at is null or i.expires_at > timezone('utc', now()));

    return jsonb_build_object(
        'signup_mode', v_mode,
        'maximum_accounts', v_ceiling,
        'existing_accounts', v_accounts,
        'unconfirmed_accounts', v_unconf,
        'pending_claims', v_pending,
        'usable_invites', v_invites,
        'slots_remaining', greatest(v_ceiling - v_accounts - v_pending, 0)
    );
end;
$$;

revoke execute on function public.signup_status() from public, anon, authenticated;

alter table public.signup_config
    drop column if exists require_signup_claim;
