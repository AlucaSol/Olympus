-- Favour shop for Triarchs of Olympus.
--
-- Extends the trial account system from 001_player_accounts.sql with a
-- catalogue (shop_items) and a per-player ownership ledger (player_purchases).
--
-- The security model of 001 is preserved exactly: the client is READ-ONLY on
-- its own Favour and its own purchases, and can never write either. A purchase
-- is therefore not an INSERT from the client — it is a single security-definer
-- function (purchase_shop_item) that debits Favour, records the purchase and
-- writes the audit ledger row atomically, under a row lock. That function is
-- the only path by which a player's Favour may decrease.
--
-- Ownership is the database's business, not the UI's: the unique constraint on
-- (user_id, item_id) makes double-purchase impossible even if a client replays
-- the call, and the balance check happens inside the same locked transaction as
-- the debit, so two concurrent calls cannot both pass it.

create type public.shop_category as enum (
    'maps',
    'heroes',
    'items',
    'abilities',
    'cosmetics'
);

create table if not exists public.shop_items (
    item_id text primary key
        check (item_id ~ '^[a-z0-9_]{3,48}$'),

    category public.shop_category not null,

    name text not null
        check (length(trim(name)) between 1 and 64),

    description text not null default ''
        check (length(description) <= 500),

    -- Path under public/assets/, resolved by the client. Kept as data so new
    -- stock needs no client release.
    icon_path text not null default 'assets/ui/shop-item-placeholder.png',

    cost bigint not null
        check (cost >= 0),

    -- Withdrawn stock stays in the table so existing purchases keep resolving;
    -- it simply stops being offered.
    is_active boolean not null default true,

    sort_order integer not null default 0,

    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shop_items_browse_idx
on public.shop_items (category, sort_order)
where is_active;

alter table public.shop_items enable row level security;

revoke all
on table public.shop_items
from anon, authenticated;

-- The catalogue is public to any signed-in player; only logged-in players can
-- reach the store at all (it lives on the desktop launcher).
grant select
on table public.shop_items
to authenticated;

create policy "Signed-in players can read the active catalogue"
on public.shop_items
for select
to authenticated
using (is_active);

create table if not exists public.player_purchases (
    purchase_id bigint generated always as identity primary key,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    item_id text not null
        references public.shop_items(item_id)
        on delete restrict,

    -- Snapshot of the price actually charged, so a later repricing never
    -- rewrites history.
    price_paid bigint not null
        check (price_paid >= 0),

    created_at timestamptz not null default timezone('utc', now()),

    -- The real guarantee behind "items must not be able to be purchased twice".
    constraint player_purchases_unique_per_player
        unique (user_id, item_id)
);

create index if not exists player_purchases_user_idx
on public.player_purchases (user_id);

alter table public.player_purchases enable row level security;

revoke all
on table public.player_purchases
from anon, authenticated;

grant select
on table public.player_purchases
to authenticated;

create policy "Players can read their own purchases"
on public.player_purchases
for select
to authenticated
using (
    auth.uid() is not null
    and auth.uid() = user_id
);

-- Deliberately no INSERT/UPDATE/DELETE policy: purchases are created only by
-- public.purchase_shop_item below.

-- Buys one item for the calling player.
--
-- Returns jsonb rather than raising, so the client can tell an expected
-- outcome ("you can't afford that") from a genuine fault without parsing
-- error strings:
--   { "ok": true,  "favour": <new balance>, "item_id": ... }
--   { "ok": false, "error": "insufficient_favour" | "already_owned"
--                          | "item_unavailable" | "no_account"
--                          | "not_authenticated",
--     "favour": <unchanged balance, when known> }
create or replace function public.purchase_shop_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_cost bigint;
    v_favour bigint;
    v_purchase_id bigint;
begin
    if v_user_id is null then
        return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;

    select s.cost
      into v_cost
      from public.shop_items s
     where s.item_id = p_item_id
       and s.is_active;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'item_unavailable');
    end if;

    -- Lock the balance for the rest of the transaction. Every check below then
    -- reads state no concurrent purchase can move underneath it.
    select a.favour
      into v_favour
      from public.player_accounts a
     where a.user_id = v_user_id
       for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'no_account');
    end if;

    if exists (
        select 1
          from public.player_purchases p
         where p.user_id = v_user_id
           and p.item_id = p_item_id
    ) then
        return jsonb_build_object('ok', false, 'error', 'already_owned', 'favour', v_favour);
    end if;

    if v_favour < v_cost then
        return jsonb_build_object('ok', false, 'error', 'insufficient_favour', 'favour', v_favour);
    end if;

    update public.player_accounts
       set favour = favour - v_cost
     where user_id = v_user_id
    returning favour into v_favour;

    insert into public.player_purchases (user_id, item_id, price_paid)
    values (v_user_id, p_item_id, v_cost)
    returning purchase_id into v_purchase_id;

    -- Mirror every debit into the existing audit ledger. A zero-cost item would
    -- violate favour_transactions' `amount <> 0` check, so it is simply not
    -- ledgered — the purchase row is still the record of ownership.
    if v_cost > 0 then
        insert into public.favour_transactions (user_id, amount, reason, external_reference)
        values (
            v_user_id,
            -v_cost,
            'shop_purchase:' || p_item_id,
            'purchase:' || v_purchase_id::text
        );
    end if;

    return jsonb_build_object('ok', true, 'favour', v_favour, 'item_id', p_item_id);
end;
$$;

revoke execute
on function public.purchase_shop_item(text)
from public, anon;

grant execute
on function public.purchase_shop_item(text)
to authenticated;

comment on function public.purchase_shop_item(text) is
'Atomically debits Favour and records ownership. The only path by which a player''s Favour may decrease.';

comment on table public.shop_items is
'Favour store catalogue. Readable by signed-in players; written only by trusted server-side processes.';

comment on table public.player_purchases is
'Server-authoritative record of what each player owns. Client is read-only; inserts happen only via purchase_shop_item.';
