-- Makes the 010 signup gate unbypassable, at the database level.
--
-- THE HOLE THIS CLOSES. 010 put every rule — kill switch, ceiling, IP quota,
-- invitations — behind begin_signup(), which only the signup Edge Function can
-- call. But the Supabase Auth endpoint `POST /auth/v1/signup` is reachable by
-- anyone holding the publishable key, which is in the website by design. So a
-- gate that lives only in the Edge Function is a gate with a road around it,
-- and the brief is explicit that hiding the button is not enough.
--
-- Rather than depend on a dashboard-configured Auth hook, the check goes where
-- nothing can get past it: the AFTER INSERT trigger on auth.users that 001
-- already installed to create the player profile. Every account creation runs
-- through it, whatever route it arrived by, and an exception raised there
-- aborts the whole insert. The Edge Function reserves a claim, passes its id
-- in the signup metadata, and this trigger refuses any account that does not
-- carry a valid, pending, recent claim.
--
-- The trigger also *settles* the claim, rather than leaving that to the Edge
-- Function. If the function crashes between Auth accepting the signup and its
-- own bookkeeping, the claim is already correctly marked completed and the
-- ceiling accounting stays honest.
--
-- ############################################################################
-- ##  READ THIS BEFORE APPLYING, IF ANYTHING OTHER THAN THIS WEBSITE       ##
-- ##  CREATES ACCOUNTS.                                                    ##
-- ##                                                                        ##
-- ##  With require_signup_claim = true, ONLY the website's signup Edge      ##
-- ##  Function can create an account. If the game client, the launcher or   ##
-- ##  any other tool calls auth.signUp() itself, those signups will start   ##
-- ##  failing with 'signup_not_authorised'.                                 ##
-- ##                                                                        ##
-- ##  If that is the case, either route them through the same Edge Function ##
-- ##  or turn the requirement off:                                          ##
-- ##                                                                        ##
-- ##      update public.signup_config set require_signup_claim = false;     ##
-- ##                                                                        ##
-- ##  With it off, 010's rules still apply to every signup that goes        ##
-- ##  through the website, and direct Auth signups are recorded in          ##
-- ##  signup_attempt_log as 'unclaimed_signup' so you can see whether any   ##
-- ##  are actually happening.                                               ##
-- ##                                                                        ##
-- ##  Creating a user from the Supabase dashboard or the Admin API is       ##
-- ##  ALWAYS allowed, claim or no claim — see p_bypass below.               ##
-- ############################################################################

alter table public.signup_config
    add column if not exists require_signup_claim boolean not null default true;

comment on column public.signup_config.require_signup_claim is
'When true, an account can only be created by a caller that first obtained a claim from begin_signup(). Set false if something other than the website also registers players.';


-- Admin-created accounts carry this flag in their metadata and skip the claim
-- requirement. It can only be set by a service-role caller (the Admin API or
-- the SQL Editor), because raw_user_meta_data on a self-service signup is
-- populated from the request body and is therefore attacker-controlled — so
-- the value alone is not trusted; see the confirmation check below.
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

    -- Fail open on the *requirement* only if the config row is missing
    -- entirely, so a half-applied migration cannot lock the project out of
    -- creating accounts at all.
    v_required := coalesce(v_required, false);

    -- ---- claim validation ------------------------------------------------
    begin
        v_claim_id := nullif(trim(new.raw_user_meta_data ->> 'signup_claim'), '')::uuid;
    exception when others then
        v_claim_id := null;   -- not a uuid; treated as absent
    end;

    if v_claim_id is not null then
        -- Settle it here, atomically with the account being created. The
        -- WHERE clause is the check: a claim that is missing, already used,
        -- aborted or stale simply matches nothing.
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

    -- ---- enforcement ------------------------------------------------------
    if not v_claim_ok then
        -- An account whose email is already confirmed at creation time cannot
        -- have come from the public signup endpoint — that path always starts
        -- unconfirmed. This is what lets the dashboard and the Admin API keep
        -- working, and it is a property of the row rather than a claim in
        -- metadata, so it cannot be forged by a signup request body.
        if new.email_confirmed_at is not null then
            v_claim_ok := true;
        end if;
    end if;

    if not v_claim_ok then
        if v_required then
            -- Aborts the INSERT into auth.users. No account, no profile.
            raise exception 'signup_not_authorised'
                using hint = 'Registration must go through the website signup service.';
        else
            -- Requirement is off: allow it, but leave a trace so an operator
            -- can see that something is registering outside the website.
            perform public.log_signup_attempt(
                extensions.digest('unclaimed', 'sha256'),
                'unclaimed_signup'
            );
        end if;
    end if;

    -- ---- profile creation (unchanged from 001) ---------------------------
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
        0            -- registering earns nothing. Favour is bought or granted.
    );

    return new;
end;
$$;

revoke execute
on function public.handle_new_auth_user()
from public, anon, authenticated;

-- The trigger from 001 is unchanged and still points at this function; there
-- is nothing to re-create.

comment on function public.handle_new_auth_user() is
'Creates the player profile for a new auth user, and enforces that the account was authorised by begin_signup() when signup_config.require_signup_claim is true. Opening balance is always 0.';


-- signup_status() gains the new flag so an operator can see the whole gate at
-- a glance.
create or replace function public.signup_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_mode     text;
    v_ceiling  integer;
    v_required boolean;
    v_accounts integer;
    v_pending  integer;
    v_unconf   integer;
    v_invites  integer;
begin
    select c.signup_mode, c.maximum_accounts, c.require_signup_claim
      into v_mode, v_ceiling, v_required
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
        'require_signup_claim', v_required,
        'existing_accounts', v_accounts,
        'unconfirmed_accounts', v_unconf,
        'pending_claims', v_pending,
        'usable_invites', v_invites,
        'slots_remaining', greatest(v_ceiling - v_accounts - v_pending, 0)
    );
end;
$$;

revoke execute on function public.signup_status() from public, anon, authenticated;


-- A public, non-sensitive view of whether registration is open. Returns the
-- mode and nothing else — no ceiling, no counts, no invite information — so
-- the signup page can show "registration is closed" instead of a form that
-- would only fail. Reading this cannot change anything.
create or replace function public.signup_availability()
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
begin
    select c.signup_mode, c.maximum_accounts
      into v_mode, v_ceiling
      from public.signup_config c
     where c.id;

    if not found then
        return jsonb_build_object('mode', 'disabled', 'accepting', false);
    end if;

    select count(*) into v_accounts from auth.users;
    select count(*) into v_pending from public.signup_claims sc where sc.status = 'pending';

    return jsonb_build_object(
        'mode', v_mode,
        -- Deliberately a boolean, not a number. "How many slots are left" is
        -- operational detail nobody outside needs.
        'accepting', v_mode <> 'disabled' and (v_accounts + v_pending) < v_ceiling
    );
end;
$$;

revoke execute on function public.signup_availability() from public, anon, authenticated;

comment on function public.signup_availability() is
'Minimal public-safe signup status for the website: mode and a yes/no. Exposes no counts, no ceiling and no invite data. Called through the signup Edge Function.';
