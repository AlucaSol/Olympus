-- Rollback for 016_username_claim_merge.sql.
--
-- READ THIS BEFORE RUNNING IT. 016 creates no tables, no columns and no new
-- functions. It only restores the signup-claim enforcement that the first cut
-- of 015 deleted from handle_new_auth_user(). It has no state of its own to
-- undo, so "rolling back 016" in isolation means putting the broken function
-- back — reopening the hole where anyone holding the publishable key can
-- create an account without going through begin_signup(), bypassing the kill
-- switch, the account ceiling and the per-IP limits.
--
-- There is no legitimate reason to want that. This file therefore does the
-- only sensible thing: it restores 013's definition, which is the correct
-- state for a database that is ALSO rolling back 015.
--
-- SO THE ORDER MATTERS:
--
--   undoing the username feature entirely   ->  run this, THEN
--                                               rollback/015_username_changes_down.sql
--
--   undoing 016 but keeping 015             ->  don't. 015 as shipped now
--                                               contains the same merged
--                                               function, so re-applying 015
--                                               is the way back, not this.
--
-- Running this while 015 stays applied leaves the username feature's tables
-- and change_username() in place but stops NEW accounts getting a sanitised
-- email-prefix name — the 3-24 underscore-only rule from 001 comes back, and
-- an address like `jon.bennett@example.com` will fail signup again.

begin;

-- 013's definition, verbatim.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_username text;
    v_claim_id        uuid;
    v_required        boolean;
    v_claim_ok        boolean := false;
begin
    select c.require_signup_claim
      into v_required
      from public.signup_config c
     where c.id;

    v_required := coalesce(v_required, false);

    begin
        v_claim_id := nullif(trim(new.raw_user_meta_data ->> 'signup_claim'), '')::uuid;
    exception when others then
        v_claim_id := null;
    end;

    if v_claim_id is not null then
        update public.signup_claims sc
           set status     = 'completed',
               user_id    = new.id,
               settled_at = timezone('utc', now())
         where sc.claim_id = v_claim_id
           and sc.status = 'pending'
           and sc.created_at > timezone('utc', now()) - interval '15 minutes';

        if found then
            v_claim_ok := true;
        end if;
    end if;

    if not v_claim_ok then
        if new.email_confirmed_at is not null then
            v_claim_ok := true;
        end if;
    end if;

    if not v_claim_ok then
        if v_required then
            raise exception 'signup_not_authorised'
                using hint = 'Registration must go through the website signup service.';
        else
            perform public.log_signup_attempt(
                extensions.digest('unclaimed', 'sha256'),
                'unclaimed_signup'
            );
        end if;
    end if;

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

comment on function public.handle_new_auth_user() is
'Creates the player profile for a new auth user, and enforces that the account was authorised by begin_signup() when signup_config.require_signup_claim is true. Opening balance is always 0.';

commit;
