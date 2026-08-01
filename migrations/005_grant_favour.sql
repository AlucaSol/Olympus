-- Administrative Favour grants for Triarchs of Olympus.
--
--   >>> TO ACTUALLY GRANT SOMEONE FAVOUR, SKIP TO THE BOTTOM OF THIS FILE. <<<
--   >>> Everything above it is machinery you never need to edit.           <<<
--
-- 001 established that `player_accounts.favour` is written only by trusted
-- server-side processes, and 002 added the one path by which it may *decrease*
-- (purchase_shop_item). This migration adds the matching path by which it may
-- *increase*: a single operator-facing function that credits an account and
-- writes the audit ledger row in the same transaction, so a grant can never
-- land in the balance without also landing in `favour_transactions`.
--
-- The account may be named by either its public username or the email address
-- it signed up with. A negative amount is accepted as a correction/clawback and
-- is refused rather than allowed to overdraw the wallet.
--
-- `p_external_reference` is optional and unique across the whole ledger, so
-- passing a payment provider's id makes the grant idempotent: running the same
-- call twice returns `duplicate_reference` instead of paying out twice. This is
-- what a future Stripe/PayPal webhook should call.
--
-- `lifetime_favour` is deliberately not touched here — the trigger from 004
-- sees the balance rise and adds the same delta itself.
--
-- SECURITY: execute is revoked from public/anon/authenticated, exactly as with
-- every other privileged object in this schema. Only `service_role`-class
-- callers (the SQL Editor, a server-side webhook holding the service-role key)
-- can reach it. The browser client must never be able to mint its own Favour.

create or replace function public.grant_favour(
    p_account            text,
    p_amount             bigint,
    p_reason             text default 'admin_grant',
    p_external_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_account text := lower(trim(coalesce(p_account, '')));
    v_user_id uuid;
    v_favour  bigint;
begin
    if v_account = '' then
        return jsonb_build_object('ok', false, 'error', 'account_required');
    end if;

    if p_amount is null or p_amount = 0 then
        -- Mirrors the `amount <> 0` check on favour_transactions: a grant that
        -- moves nothing would have no ledger row and so no record at all.
        return jsonb_build_object('ok', false, 'error', 'amount_required');
    end if;

    -- Resolve by public username first, then by the signup email. Compared
    -- case-insensitively via an explicit lower() rather than relying on the
    -- citext operator, because search_path is empty inside this function.
    select a.user_id
      into v_user_id
      from public.player_accounts a
     where lower(a.username::text) = v_account;

    if not found then
        select a.user_id
          into v_user_id
          from public.player_accounts a
          join auth.users u on u.id = a.user_id
         where lower(u.email::text) = v_account;
    end if;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'no_account');
    end if;

    -- Lock the balance before checking it, so two concurrent grants (or a grant
    -- racing a purchase) cannot both decide against the same stale figure.
    select a.favour
      into v_favour
      from public.player_accounts a
     where a.user_id = v_user_id
       for update;

    if p_external_reference is not null and exists (
        select 1
          from public.favour_transactions t
         where t.external_reference = p_external_reference
    ) then
        -- Already paid out under this reference. Reported rather than raised so
        -- a webhook retry reads as the no-op it is.
        return jsonb_build_object(
            'ok', false,
            'error', 'duplicate_reference',
            'favour', v_favour
        );
    end if;

    if v_favour + p_amount < 0 then
        -- A clawback larger than the remaining wallet. The `favour >= 0` check
        -- constraint would reject it anyway; this turns that into a readable
        -- result instead of a constraint violation.
        return jsonb_build_object(
            'ok', false,
            'error', 'insufficient_favour',
            'favour', v_favour
        );
    end if;

    update public.player_accounts
       set favour = favour + p_amount
     where user_id = v_user_id
    returning favour into v_favour;

    insert into public.favour_transactions (user_id, amount, reason, external_reference)
    values (
        v_user_id,
        p_amount,
        coalesce(nullif(trim(p_reason), ''), 'admin_grant'),
        p_external_reference
    );

    return jsonb_build_object(
        'ok', true,
        'user_id', v_user_id,
        'granted', p_amount,
        'favour', v_favour
    );
end;
$$;

revoke execute
on function public.grant_favour(text, bigint, text, text)
from public, anon, authenticated;

comment on function public.grant_favour(text, bigint, text, text) is
'Credits an account''s Favour and writes the matching favour_transactions row atomically. The only path by which a player''s Favour may increase. Service-role callers only — never exposed to the game client.';


-- ###########################################################################
-- ###                                                                     ###
-- ###                     HOW TO GRANT SOMEONE FAVOUR                     ###
-- ###                                                                     ###
-- ###########################################################################
--
-- 1. Copy the block between the ===== markers below.
-- 2. Paste it into the Supabase SQL Editor.
-- 3. Delete the leading "--" from every pasted line. Everything in this file
--    is commented out, and the SQL Editor will do nothing at all until you
--    strip those. (If Run seems to succeed but no balance changed, this is
--    almost certainly why.)
-- 4. Change ONLY the two values marked  <<< EDIT  — nothing else.
-- 5. Press Run. The result tells you the account's new balance.
--
-- If that feels fiddly, just type the short form by hand instead — it is the
-- same call, and the two values are in the same order:
--
--     select public.grant_favour('lykaon', 500);
--
-- They stay commented out here on purpose: this file is a migration, and
-- migrations get re-run. A live grant sitting in it would pay out again every
-- single time the file is applied. The SQL Editor is where grants happen.
--
--   ===================== COPY FROM HERE =====================
--
--   select public.grant_favour(
--       'lykaon',          -- <<< EDIT 1 of 2:  WHO gets it.
--                          --     Their username OR their email address.
--                          --     Keep the single quotes around it.
--       500                -- <<< EDIT 2 of 2:  HOW MUCH Favour to give.
--                          --     A plain number. NO quotes around it.
--   );
--
--   ====================== TO HERE ===========================
--
-- Two filled-in examples, so you can see the shape:
--
--     select public.grant_favour('lykaon', 500);
--     select public.grant_favour('player@example.com', 1000);
--
-- WHAT YOU GET BACK
--
--   Success looks like this — `favour` is their new total:
--
--     {"ok": true, "granted": 500, "favour": 1500, "user_id": "..."}
--
--   Anything else means nothing was changed, and `error` says why:
--
--     "no_account"           No player has that username or email.
--                            Check the spelling. Capitals don't matter.
--     "amount_required"      The amount was 0 or left blank.
--     "insufficient_favour"  Only for negative amounts (see below) — they
--                            don't have that much left to take back.
--
-- TAKING FAVOUR BACK
--
--   Put a minus sign in front of the amount. This refunds/corrects a grant:
--
--     select public.grant_favour('lykaon', -500);
--
--   It will refuse to push anyone below zero.
--
-- OPTIONAL THIRD VALUE: A NOTE FOR YOUR RECORDS
--
--   Every grant is logged in `favour_transactions`. By default the log just
--   says 'admin_grant'. Add a third value to label it instead:
--
--     select public.grant_favour('lykaon', 500, 'beta_tester_reward');
--
--   This is purely for your own bookkeeping and changes nothing about the
--   grant itself. The player never sees it.
--
-- CHECKING A BALANCE WITHOUT CHANGING IT
--
--     select username, favour, lifetime_favour
--       from public.player_accounts
--      where lower(username::text) = lower('lykaon');
