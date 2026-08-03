-- HOTFIX: restore the signup-claim enforcement that 015 overwrote.
--
-- WHAT WENT WRONG
--
-- 013 did not add a new trigger. It put the signup-claim enforcement INSIDE
-- public.handle_new_auth_user(), the profile-creation function 001 installed,
-- precisely because every account creation runs through it whatever route it
-- arrives by. 015 then needed to change how a username is derived in that same
-- function, and did the obvious thing — `create or replace function
-- public.handle_new_auth_user()` — carrying 001's body forward with a better
-- fallback, but not 013's.
--
-- `create or replace` does not merge. It replaces. So applying 015 deleted:
--
--   * claim validation and settlement (signup_claims -> 'completed');
--   * the `signup_not_authorised` exception that aborts an unclaimed insert;
--   * the log_signup_attempt trace for unclaimed signups when the requirement
--     is switched off.
--
-- BLAST RADIUS, for any project that applied 015 before this file. Every gate
-- in 010 hangs off begin_signup(), and begin_signup() is only reachable through
-- the signup Edge Function. With the enforcement gone, nothing forced anyone
-- through that function: a caller holding the publishable key — which is public
-- by design, it is in js/config.js — could call auth.signUp() directly and get
-- an account. That bypasses the signup kill switch, the maximum_accounts
-- ceiling, and the 2-per-24h / 5-per-30d IP limits. It does NOT touch Favour,
-- purchases or anything else: those never depended on this function.
--
-- Check whether it was exploited while the window was open:
--
--     select u.id, u.email, u.created_at
--       from auth.users u
--       left join public.signup_claims c on c.user_id = u.id
--      where u.created_at > '2026-08-03'          -- when 015 was applied
--        and c.claim_id is null
--        and u.email_confirmed_at is null         -- dashboard creations are fine
--      order by u.created_at;
--
-- Any row is an account that skipped the gate.
--
-- THE FIX. One function holding both responsibilities, in the order they have
-- to run: authorise the account first, name it second. Never edit one half
-- without carrying the other, and see the note at the foot of this file for the
-- lint check that now fails if anyone tries.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- 013's half
    v_claim_id  uuid;
    v_required  boolean;
    v_claim_ok  boolean := false;
    -- 015's half
    cfg         public.username_config%rowtype;
    requested   text;
    candidate   text;
    base        text;
    suffix      integer := 0;
begin
    -- =======================================================================
    -- PART 1 — signup claim enforcement.  Verbatim from 013; see that file
    -- for the reasoning. This runs FIRST: an account that is not allowed to
    -- exist should be refused before any effort goes into naming it.
    -- =======================================================================

    select c.require_signup_claim
      into v_required
      from public.signup_config c
     where c.id;

    -- Fail open on the *requirement* only if the config row is missing
    -- entirely, so a half-applied migration cannot lock the project out of
    -- creating accounts at all.
    v_required := coalesce(v_required, false);

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

    -- =======================================================================
    -- PART 2 — the username.  From 015; see that file for why the fallback
    -- sanitises instead of raising.
    -- =======================================================================

    select * into cfg from public.username_config where id;
    if not found then
        cfg.min_length := 5;
        cfg.max_length := 20;
    end if;

    requested := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

    -- An explicit choice is honoured as-is or not at all: silently renaming
    -- what somebody typed would hand them an account they did not ask for.
    if requested is not null then
        if public.username_rejection(requested) is not null then
            raise exception 'New account has an invalid username';
        end if;
        candidate := requested;
    else
        -- Derive from the email. Strip what the format forbids, trim to the
        -- cap, and fall back if what survives is too short to be legal.
        base := regexp_replace(
            split_part(coalesce(new.email, ''), '@', 1),
            '[^A-Za-z0-9_-]', '', 'g'
        );
        base := left(base, cfg.max_length);
        base := regexp_replace(base, '^[_-]+', '');

        if length(base) < cfg.min_length then
            base := 'Warrior';
        end if;

        -- A blocked or reserved word in an email prefix must not block the
        -- signup either — fall back rather than refuse.
        if public.username_rejection(base) is not null then
            base := 'Warrior';
        end if;

        candidate := base;

        -- Email prefixes collide constantly (every "info@", every "admin@").
        -- Walk to the first free variant, keeping inside the cap.
        while exists (
            select 1 from public.player_accounts pa
             where pa.username::text = candidate
        ) and suffix < 500 loop
            suffix := suffix + 1;
            candidate := left(base, cfg.max_length - length(suffix::text)) || suffix::text;
        end loop;
    end if;

    insert into public.player_accounts (user_id, username, favour)
    values (new.id, candidate, 0);   -- registering earns nothing

    return new;
end;
$$;

revoke execute
on function public.handle_new_auth_user()
from public, anon, authenticated;

comment on function public.handle_new_auth_user() is
'Creates the player profile for a new auth user. Enforces the begin_signup() claim when signup_config.require_signup_claim is true (from 013) AND derives the username, falling back to a sanitised email prefix (from 015). BOTH responsibilities live here: this function is create-or-replaced by 001, 013, 015 and 016, and each replacement must carry every earlier one forward. tests/lint.mjs fails if a definition loses the claim check.';

-- The trigger from 001 is unchanged and still points at this function; there
-- is nothing to re-create.
