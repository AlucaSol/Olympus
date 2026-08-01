-- Real-money Favour bundles (Stripe) for the Triarchs of Olympus website.
--
-- 002 gave the game a catalogue of things bought WITH Favour. This migration
-- adds the other half — a catalogue of Favour itself, bought with real money —
-- and the ledger and fulfilment path behind it.
--
-- WHY THIS IS NOT A ROW IN shop_items. The game reads `shop_items` directly and
-- renders `cost` as a Favour price. A "50 Favour for A$3" row in that table
-- would appear in the in-game store as an item costing 50 Favour, which is both
-- wrong and unsellable there. Bundles are a website concern with a different
-- unit of account, so they get their own table and the game is left untouched.
--
-- MONEY IS INTEGER MINOR UNITS. `price_minor` is Australian cents; `currency`
-- is a lowercase ISO-4217 code, matching what the Stripe API expects. Favour is
-- bigint. Nothing here is ever a float.
--
-- THE CLIENT CANNOT NAME A PRICE. The browser sends a `bundle_id` and nothing
-- else that matters. Amount, currency, Favour quantity and Stripe Price ID are
-- all read from this table by server-side code, both when the Checkout Session
-- is created and again when the webhook fulfils it. "One million Favour for one
-- cent" is not expressible: there is no field in which to say it.
--
-- STRIPE PRICE IDS ARE NOT PUBLIC. `stripe_price_id` is excluded from the
-- column-level grant, so anon/authenticated can read the shelf (name, price,
-- artwork) and cannot read the payment configuration. This is enforced by
-- PostgreSQL column privileges, which PostgREST honours — not by a view that
-- could be re-granted by accident.
--
-- FULFILMENT IS IDEMPOTENT AT THREE LEVELS, so a Stripe retry, a duplicate
-- delivery, or two workers racing the same event all settle to one grant:
--   1. stripe_events.event_id      primary key   — one row per Stripe event
--   2. favour_purchases.stripe_checkout_session_id unique — one grant per sale
--   3. favour_transactions.external_reference unique (from 001) — one credit

create table if not exists public.favour_bundles (
    bundle_id text primary key
        check (bundle_id ~ '^[a-z0-9_]{3,48}$'),

    name text not null
        check (length(trim(name)) between 1 and 64),

    description text not null default ''
        check (length(description) <= 500),

    -- Website-relative, resolved by the browser. Placeholder art for now; the
    -- three files are separate copies so they can be replaced one at a time.
    icon_path text not null default 'assets/emporion/ui/shop-item-placeholder.png',

    favour_amount bigint not null
        check (favour_amount > 0),

    -- Integer minor units (Australian cents). Never a float.
    price_minor integer not null
        check (price_minor > 0),

    currency text not null default 'aud'
        check (currency = lower(currency) and length(currency) = 3),

    -- Set by hand after the Stripe dashboard step. NOT publicly readable.
    stripe_price_id text,

    is_active boolean not null default true,

    sort_order integer not null default 0,

    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.favour_bundles enable row level security;

revoke all on table public.favour_bundles from anon, authenticated;

-- The shelf is public — a logged-out visitor must be able to see what a bundle
-- costs before deciding to make an account. `stripe_price_id` is deliberately
-- absent from this list.
grant select (
    bundle_id, name, description, icon_path,
    favour_amount, price_minor, currency,
    is_active, sort_order
) on public.favour_bundles to anon, authenticated;

create policy "Anyone may read active Favour bundles"
on public.favour_bundles
for select
to anon, authenticated
using (is_active);

-- No INSERT/UPDATE/DELETE policy: pricing is changed only by a service-role
-- caller in the SQL Editor.

create index if not exists favour_bundles_browse_idx
on public.favour_bundles (sort_order)
where is_active;


-- ---------------------------------------------------------------------------
-- The three launch bundles. A$3 / A$9 / A$15.
-- ---------------------------------------------------------------------------

insert into public.favour_bundles
    (bundle_id, name, description, icon_path, favour_amount, price_minor, currency, sort_order)
values
    ('favour_50', '50 Favour',
     'A small offering of Favour, spendable anywhere in the Emporion.',
     'assets/emporion/ui/favour-bundle-50.png', 50, 300, 'aud', 10),

    ('favour_200', '200 Favour',
     'A generous purse of Favour — enough for a champion, with change.',
     'assets/emporion/ui/favour-bundle-200.png', 200, 900, 'aud', 20),

    ('favour_400', '400 Favour',
     'A patron''s tribute of Favour, the best value the Emporion offers.',
     'assets/emporion/ui/favour-bundle-400.png', 400, 1500, 'aud', 30)
on conflict (bundle_id) do nothing;


-- ---------------------------------------------------------------------------
-- Purchase ledger
-- ---------------------------------------------------------------------------

create table if not exists public.favour_purchases (
    purchase_id bigint generated always as identity primary key,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    bundle_id text not null
        references public.favour_bundles(bundle_id)
        on delete restrict,

    -- One fulfilment per Checkout Session, enforced by the database rather
    -- than by the webhook remembering to check.
    stripe_checkout_session_id text unique,
    stripe_payment_intent_id   text,
    stripe_customer_id         text,
    stripe_checkout_url        text,

    -- Snapshots taken from favour_bundles when the session was created, so a
    -- later repricing never rewrites history.
    amount_minor integer not null
        check (amount_minor >= 0),
    currency text not null,
    favour_amount bigint not null
        check (favour_amount >= 0),

    status text not null default 'pending'
        check (status in (
            'pending',        -- session created, nothing paid
            'paid',           -- Stripe says paid, grant in progress
            'fulfilled',      -- Favour credited
            'failed',         -- payment failed
            'expired',        -- session expired unpaid
            'mismatch',       -- Stripe disagreed with our catalogue; not granted
            'refunded',       -- refunded, flagged for manual review
            'disputed'        -- chargeback, flagged for manual review
        )),

    favour_granted boolean not null default false,

    -- Set when a refund or dispute lands. Favour is never automatically
    -- clawed back, because the player may already have spent it.
    needs_manual_review boolean not null default false,
    review_note text,

    -- Client-supplied idempotency key for Checkout Session creation.
    client_request_id uuid not null,

    created_at   timestamptz not null default timezone('utc', now()),
    updated_at   timestamptz not null default timezone('utc', now()),
    fulfilled_at timestamptz,

    constraint favour_purchases_request_unique
        unique (user_id, client_request_id)
);

create index if not exists favour_purchases_user_idx
on public.favour_purchases (user_id, created_at desc);

create index if not exists favour_purchases_review_idx
on public.favour_purchases (needs_manual_review)
where needs_manual_review;

alter table public.favour_purchases enable row level security;

revoke all on table public.favour_purchases from anon, authenticated;

-- A player may read their own payment history. The Stripe customer id and the
-- one-time checkout URL are withheld: the browser has no use for either after
-- the redirect, and neither belongs in a page a player might screenshot.
grant select (
    purchase_id, user_id, bundle_id,
    stripe_checkout_session_id,
    amount_minor, currency, favour_amount,
    status, favour_granted,
    created_at, fulfilled_at
) on public.favour_purchases to authenticated;

create policy "Players can read their own Favour purchases"
on public.favour_purchases
for select
to authenticated
using (
    auth.uid() is not null
    and auth.uid() = user_id
);

-- No write policy of any kind. Rows are created and moved between states only
-- by the security-definer functions below, which are service-role only.


-- ---------------------------------------------------------------------------
-- Stripe event log — the outer idempotency ring
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_events (
    event_id text primary key,

    event_type text not null,

    status text not null default 'received'
        check (status in ('received', 'processed', 'ignored', 'failed')),

    -- A deliberately small, non-sensitive summary: ids and amounts, never card
    -- data, never the signing secret, never the raw payload.
    summary jsonb,

    error_detail text,

    received_at  timestamptz not null default timezone('utc', now()),
    processed_at timestamptz
);

create index if not exists stripe_events_type_idx
on public.stripe_events (event_type, received_at desc);

alter table public.stripe_events enable row level security;

revoke all on table public.stripe_events from anon, authenticated;

comment on table public.stripe_events is
'Every Stripe event the webhook has seen, keyed by Stripe event id. The primary key is what makes a retried delivery a no-op.';


-- ---------------------------------------------------------------------------
-- begin_favour_checkout — reserve a purchase row before talking to Stripe
-- ---------------------------------------------------------------------------
--
-- Returns { "ok": true, "purchase_id": n, "bundle": {...}, "reuse": bool,
--           "checkout_url": text|null }
-- or      { "ok": false, "error": "bundle_unavailable" | "rate_limited"
--                                | "not_configured" | "invalid_request" }
--
-- `reuse` true means this exact request id already produced a live Checkout
-- Session; the caller should send the visitor back to that URL rather than
-- creating a second session for the same intent.

create or replace function public.begin_favour_checkout(
    p_user_id    uuid,
    p_bundle_id  text,
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_bundle     public.favour_bundles%rowtype;
    v_existing   public.favour_purchases%rowtype;
    v_recent     integer;
    v_purchase_id bigint;
begin
    if p_user_id is null or p_request_id is null
       or p_bundle_id is null or trim(p_bundle_id) = '' then
        return jsonb_build_object('ok', false, 'error', 'invalid_request');
    end if;

    -- Idempotent replay: the same user retrying the same request id gets the
    -- session that request already produced, not a second one.
    select * into v_existing
      from public.favour_purchases fp
     where fp.user_id = p_user_id
       and fp.client_request_id = p_request_id;

    if found then
        return jsonb_build_object(
            'ok', true,
            'reuse', true,
            'purchase_id', v_existing.purchase_id,
            'status', v_existing.status,
            'checkout_url', case
                when v_existing.status = 'pending'
                 and v_existing.created_at > timezone('utc', now()) - interval '23 hours'
                then v_existing.stripe_checkout_url
                else null
            end,
            'bundle', jsonb_build_object(
                'bundle_id', v_existing.bundle_id,
                'favour_amount', v_existing.favour_amount,
                'price_minor', v_existing.amount_minor,
                'currency', v_existing.currency
            )
        );
    end if;

    select * into v_bundle
      from public.favour_bundles b
     where b.bundle_id = p_bundle_id
       and b.is_active;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'bundle_unavailable');
    end if;

    if v_bundle.stripe_price_id is null or trim(v_bundle.stripe_price_id) = '' then
        -- The dashboard step has not been done yet. Better a clear refusal
        -- than a Checkout Session with an invented price.
        return jsonb_build_object('ok', false, 'error', 'not_configured');
    end if;

    -- Session spam guard. Generous enough that a real person changing their
    -- mind is never caught, tight enough that a loop is.
    select count(*) into v_recent
      from public.favour_purchases fp
     where fp.user_id = p_user_id
       and fp.created_at > timezone('utc', now()) - interval '10 minutes';

    if v_recent >= 8 then
        return jsonb_build_object(
            'ok', false,
            'error', 'rate_limited',
            'retry_after_seconds', 600
        );
    end if;

    insert into public.favour_purchases (
        user_id, bundle_id,
        amount_minor, currency, favour_amount,
        status, client_request_id
    )
    values (
        p_user_id, v_bundle.bundle_id,
        v_bundle.price_minor, v_bundle.currency, v_bundle.favour_amount,
        'pending', p_request_id
    )
    returning purchase_id into v_purchase_id;

    return jsonb_build_object(
        'ok', true,
        'reuse', false,
        'purchase_id', v_purchase_id,
        'bundle', jsonb_build_object(
            'bundle_id', v_bundle.bundle_id,
            'name', v_bundle.name,
            'favour_amount', v_bundle.favour_amount,
            'price_minor', v_bundle.price_minor,
            'currency', v_bundle.currency,
            'stripe_price_id', v_bundle.stripe_price_id
        )
    );
end;
$$;


-- Records the Checkout Session Stripe just handed back.
create or replace function public.attach_checkout_session(
    p_purchase_id bigint,
    p_session_id  text,
    p_session_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.favour_purchases fp
       set stripe_checkout_session_id = p_session_id,
           stripe_checkout_url        = p_session_url,
           updated_at                 = timezone('utc', now())
     where fp.purchase_id = p_purchase_id
       and fp.status = 'pending';

    if not found then
        return jsonb_build_object('ok', false, 'error', 'purchase_not_pending');
    end if;

    return jsonb_build_object('ok', true);
end;
$$;


-- ---------------------------------------------------------------------------
-- fulfil_favour_purchase — the only path by which a payment becomes Favour
-- ---------------------------------------------------------------------------
--
-- Every parameter comes from a Stripe event whose signature has already been
-- verified against the raw request body. Even so, nothing is taken on trust:
-- the amount, currency and Favour quantity Stripe reports are compared against
-- this database's own record of what that session was for, and a disagreement
-- is logged as a mismatch rather than granted.
--
-- Returns { "ok": true, "granted": n, "favour": <new balance>, "duplicate": bool }
--      or { "ok": false, "error": ... }

create or replace function public.fulfil_favour_purchase(
    p_event_id       text,
    p_event_type     text,
    p_session_id     text,
    p_payment_intent text,
    p_customer_id    text,
    p_amount_minor   integer,
    p_currency       text,
    p_user_id        uuid,
    p_bundle_id      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_purchase public.favour_purchases%rowtype;
    v_favour   bigint;
    v_reference text;
begin
    if p_event_id is null or p_session_id is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_request');
    end if;

    -- Ring 1: has this exact Stripe event already been handled? The insert is
    -- the claim; a concurrent duplicate loses the race on the primary key.
    insert into public.stripe_events (event_id, event_type, status, summary)
    values (
        p_event_id,
        coalesce(p_event_type, 'unknown'),
        'received',
        jsonb_build_object(
            'session_id', p_session_id,
            'bundle_id', p_bundle_id,
            'amount_minor', p_amount_minor,
            'currency', p_currency
        )
    )
    on conflict (event_id) do nothing;

    if not found then
        return jsonb_build_object('ok', true, 'duplicate', true, 'granted', 0);
    end if;

    -- Ring 2: lock the purchase row for this session.
    select * into v_purchase
      from public.favour_purchases fp
     where fp.stripe_checkout_session_id = p_session_id
       for update;

    if not found then
        update public.stripe_events
           set status = 'failed',
               error_detail = 'no purchase row for session',
               processed_at = timezone('utc', now())
         where event_id = p_event_id;
        return jsonb_build_object('ok', false, 'error', 'unknown_session');
    end if;

    if v_purchase.favour_granted then
        update public.stripe_events
           set status = 'ignored',
               error_detail = 'already fulfilled',
               processed_at = timezone('utc', now())
         where event_id = p_event_id;
        return jsonb_build_object(
            'ok', true, 'duplicate', true, 'granted', 0
        );
    end if;

    -- Does Stripe's account of the sale match ours? A mismatch means either a
    -- misconfigured Price in the dashboard or someone having a go; either way
    -- it must not turn into Favour.
    if v_purchase.user_id is distinct from p_user_id
       or v_purchase.bundle_id is distinct from p_bundle_id
       or v_purchase.amount_minor is distinct from p_amount_minor
       or lower(coalesce(p_currency, '')) is distinct from v_purchase.currency
    then
        update public.favour_purchases
           set status = 'mismatch',
               needs_manual_review = true,
               review_note = 'Stripe session did not match the catalogue snapshot',
               updated_at = timezone('utc', now())
         where purchase_id = v_purchase.purchase_id;

        update public.stripe_events
           set status = 'failed',
               error_detail = 'session/catalogue mismatch',
               processed_at = timezone('utc', now())
         where event_id = p_event_id;

        return jsonb_build_object('ok', false, 'error', 'session_mismatch');
    end if;

    -- Ring 3: the ledger reference is unique, so even a hand-run repair cannot
    -- credit the same session twice.
    v_reference := 'stripe_session:' || p_session_id;

    if exists (
        select 1 from public.favour_transactions t
         where t.external_reference = v_reference
    ) then
        update public.favour_purchases
           set favour_granted = true,
               status = 'fulfilled',
               updated_at = timezone('utc', now())
         where purchase_id = v_purchase.purchase_id;

        update public.stripe_events
           set status = 'ignored',
               error_detail = 'ledger reference already present',
               processed_at = timezone('utc', now())
         where event_id = p_event_id;

        return jsonb_build_object('ok', true, 'duplicate', true, 'granted', 0);
    end if;

    -- Lock the balance, then credit it. The 004 trigger raises lifetime_favour
    -- by the same delta on its own.
    select a.favour into v_favour
      from public.player_accounts a
     where a.user_id = v_purchase.user_id
       for update;

    if not found then
        update public.favour_purchases
           set status = 'mismatch',
               needs_manual_review = true,
               review_note = 'paid, but no player_accounts row for the buyer',
               updated_at = timezone('utc', now())
         where purchase_id = v_purchase.purchase_id;

        update public.stripe_events
           set status = 'failed',
               error_detail = 'no player account',
               processed_at = timezone('utc', now())
         where event_id = p_event_id;

        return jsonb_build_object('ok', false, 'error', 'no_account');
    end if;

    update public.player_accounts
       set favour = favour + v_purchase.favour_amount
     where user_id = v_purchase.user_id
    returning favour into v_favour;

    insert into public.favour_transactions (user_id, amount, reason, external_reference)
    values (
        v_purchase.user_id,
        v_purchase.favour_amount,
        'stripe_bundle:' || v_purchase.bundle_id,
        v_reference
    );

    update public.favour_purchases
       set status                     = 'fulfilled',
           favour_granted             = true,
           stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
           stripe_customer_id         = coalesce(p_customer_id, stripe_customer_id),
           fulfilled_at               = timezone('utc', now()),
           updated_at                 = timezone('utc', now())
     where purchase_id = v_purchase.purchase_id;

    update public.stripe_events
       set status = 'processed',
           processed_at = timezone('utc', now())
     where event_id = p_event_id;

    return jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'granted', v_purchase.favour_amount,
        'favour', v_favour
    );
end;
$$;


-- Events we understand but do not fulfil (expiry, failure), and events we do
-- not handle at all. Recorded so the log is a complete account of what Stripe
-- sent, and so a retry of one of them is also a no-op.
create or replace function public.record_stripe_event(
    p_event_id   text,
    p_event_type text,
    p_status     text,
    p_summary    jsonb default null,
    p_detail     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.stripe_events (event_id, event_type, status, summary, error_detail, processed_at)
    values (
        p_event_id,
        coalesce(p_event_type, 'unknown'),
        case when p_status in ('received','processed','ignored','failed')
             then p_status else 'ignored' end,
        p_summary,
        left(coalesce(p_detail, ''), 500),
        timezone('utc', now())
    )
    on conflict (event_id) do nothing;

    return jsonb_build_object('ok', true, 'duplicate', not found);
end;
$$;


-- Marks a session's purchase as failed or expired. Never touches Favour.
create or replace function public.close_favour_purchase(
    p_session_id text,
    p_status     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_status not in ('failed', 'expired') then
        return jsonb_build_object('ok', false, 'error', 'invalid_status');
    end if;

    update public.favour_purchases fp
       set status = p_status,
           updated_at = timezone('utc', now())
     where fp.stripe_checkout_session_id = p_session_id
       and fp.status = 'pending';

    return jsonb_build_object('ok', true);
end;
$$;


-- ---------------------------------------------------------------------------
-- Refunds and disputes — recorded and flagged, never auto-reversed
-- ---------------------------------------------------------------------------
--
-- The player may already have spent the Favour on a permanent unlock, and
-- 001's `favour >= 0` check would refuse a clawback that overdraws the wallet
-- anyway. Automatically deciding what to do here would be guessing with
-- someone's account, so the ledger records the event, flags the purchase for
-- review, and stops. Reversal, if warranted, is a deliberate grant_favour call
-- with a negative amount.

create or replace function public.record_favour_refund(
    p_event_id       text,
    p_event_type     text,
    p_payment_intent text,
    p_amount_minor   integer,
    p_currency       text,
    p_kind           text  -- 'refunded' | 'disputed'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_purchase public.favour_purchases%rowtype;
begin
    if p_kind not in ('refunded', 'disputed') then
        return jsonb_build_object('ok', false, 'error', 'invalid_kind');
    end if;

    insert into public.stripe_events (event_id, event_type, status, summary)
    values (
        p_event_id,
        coalesce(p_event_type, 'unknown'),
        'received',
        jsonb_build_object(
            'payment_intent', p_payment_intent,
            'amount_minor', p_amount_minor,
            'currency', p_currency,
            'kind', p_kind
        )
    )
    on conflict (event_id) do nothing;

    if not found then
        return jsonb_build_object('ok', true, 'duplicate', true);
    end if;

    select * into v_purchase
      from public.favour_purchases fp
     where fp.stripe_payment_intent_id = p_payment_intent
       for update;

    if not found then
        update public.stripe_events
           set status = 'failed',
               error_detail = 'no purchase row for payment intent',
               processed_at = timezone('utc', now())
         where event_id = p_event_id;
        return jsonb_build_object('ok', false, 'error', 'unknown_payment_intent');
    end if;

    update public.favour_purchases
       set status = p_kind,
           needs_manual_review = true,
           review_note = coalesce(review_note || ' | ', '')
                         || p_kind || ' on ' || to_char(timezone('utc', now()), 'YYYY-MM-DD')
                         || '; Favour NOT automatically reversed',
           updated_at = timezone('utc', now())
     where purchase_id = v_purchase.purchase_id;

    update public.stripe_events
       set status = 'processed',
           processed_at = timezone('utc', now())
     where event_id = p_event_id;

    return jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'purchase_id', v_purchase.purchase_id,
        'flagged_for_review', true
    );
end;
$$;


-- Operator view of anything needing a human.
create or replace function public.favour_purchases_needing_review()
returns table (
    purchase_id bigint,
    user_id uuid,
    bundle_id text,
    amount_minor integer,
    currency text,
    favour_amount bigint,
    status text,
    favour_granted boolean,
    review_note text,
    created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
    select fp.purchase_id, fp.user_id, fp.bundle_id, fp.amount_minor,
           fp.currency, fp.favour_amount, fp.status, fp.favour_granted,
           fp.review_note, fp.created_at
      from public.favour_purchases fp
     where fp.needs_manual_review
     order by fp.created_at desc;
$$;


-- ---------------------------------------------------------------------------
-- Privileges. Every function here is service-role only; the browser reaches
-- none of them, and reaches Stripe only through the Edge Functions.
-- ---------------------------------------------------------------------------

revoke execute on function public.begin_favour_checkout(uuid, text, uuid)
    from public, anon, authenticated;
revoke execute on function public.attach_checkout_session(bigint, text, text)
    from public, anon, authenticated;
revoke execute on function public.fulfil_favour_purchase(text, text, text, text, text, integer, text, uuid, text)
    from public, anon, authenticated;
revoke execute on function public.record_stripe_event(text, text, text, jsonb, text)
    from public, anon, authenticated;
revoke execute on function public.close_favour_purchase(text, text)
    from public, anon, authenticated;
revoke execute on function public.record_favour_refund(text, text, text, integer, text, text)
    from public, anon, authenticated;
revoke execute on function public.favour_purchases_needing_review()
    from public, anon, authenticated;

comment on table public.favour_bundles is
'Real-money Favour bundles sold on the website through Stripe. Deliberately separate from shop_items so the in-game store is unaffected. stripe_price_id is withheld from the public column grant.';

comment on table public.favour_purchases is
'Auditable ledger of every Stripe Favour purchase: buyer, bundle, session, amount, currency, Favour awarded, status and timestamps.';

comment on function public.fulfil_favour_purchase(text, text, text, text, text, integer, text, uuid, text) is
'Credits Favour for a verified, paid Checkout Session exactly once. Idempotent on the Stripe event id, the session id and the ledger reference.';
