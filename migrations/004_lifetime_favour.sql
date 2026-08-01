-- Lifetime Favour for Triarchs of Olympus.
--
-- `player_accounts.favour` is a wallet: it falls every time a player spends.
-- The in-match scoreboard wants the opposite figure — a standing that only ever
-- goes up — so this migration adds `lifetime_favour`: every unit of Favour the
-- account has ever been granted, whether it is still in the wallet or has
-- already been spent. Spending moves Favour between those two halves; it never
-- changes the total.
--
--     lifetime_favour  =  favour (remaining)  +  everything ever spent
--
-- It is deliberately NOT stored as a "spent" counter that the shop increments.
-- Doing it that way would mean every future spending path has to remember to
-- update it, and the day one forgets, the scoreboard quietly lies. Instead a
-- trigger derives it from the balance itself: any UPDATE that RAISES `favour`
-- adds the same delta to `lifetime_favour`, and any UPDATE that lowers it
-- leaves the total alone. So a new payment path, an admin grant, or a spend the
-- scoreboard has never heard of are all accounted for automatically.
--
-- The security model of 001/002 is untouched. `lifetime_favour` lives on a
-- table the client has only SELECT on, restricted by RLS to its own row, and it
-- is computed inside the database rather than reported to it — the browser
-- cannot inflate its own standing any more than it can mint Favour.

alter table public.player_accounts
    add column if not exists lifetime_favour bigint not null default 0
        check (lifetime_favour >= 0);

-- Backfill for accounts that predate this column. Everything an existing player
-- has spent so far went through purchase_shop_item, so their history is exactly
-- the sum of what they still hold and what their purchases cost. Restricted to
-- rows still at 0 so re-running this file cannot rewrite a live total.
update public.player_accounts a
   set lifetime_favour = a.favour + coalesce((
           select sum(p.price_paid)
             from public.player_purchases p
            where p.user_id = a.user_id
       ), 0)
 where a.lifetime_favour = 0;

create or replace function public.sync_lifetime_favour()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        -- A new row starts with its opening balance already "received". The
        -- greatest() lets a deliberate restore insert a larger history.
        new.lifetime_favour := greatest(new.lifetime_favour, greatest(new.favour, 0));
        return new;
    end if;

    -- An explicit write wins. Only trusted server-side roles can UPDATE this
    -- table at all (no RLS policy grants `authenticated` any write), so a
    -- deliberate correction — a refund that should not count as new spending,
    -- a chargeback — must stay possible. The client is not among the callers
    -- that could reach this branch.
    if new.lifetime_favour is distinct from old.lifetime_favour then
        return new;
    end if;

    -- Otherwise: credits accrue, debits don't subtract.
    new.lifetime_favour := old.lifetime_favour + greatest(new.favour - old.favour, 0);
    return new;
end;
$$;

drop trigger if exists sync_lifetime_favour
on public.player_accounts;

create trigger sync_lifetime_favour
before insert or update on public.player_accounts
for each row
execute function public.sync_lifetime_favour();

revoke execute
on function public.sync_lifetime_favour()
from public, anon, authenticated;

-- No new grant is needed: 001 already granted `authenticated` table-level
-- SELECT on player_accounts, which covers columns added later, and the existing
-- "Players can read their own account" policy still limits that to their own
-- row. A player can see their own standing and no one else's; the standing of
-- the other seats reaches a scoreboard over the game connection, from the peer
-- that owns it, exactly as their username already does.

comment on column public.player_accounts.lifetime_favour is
'Total Favour ever granted to this account (remaining + spent). Never decreases on a spend. Derived by the sync_lifetime_favour trigger, not written by callers.';

comment on function public.sync_lifetime_favour() is
'Keeps player_accounts.lifetime_favour equal to every credit the account has ever received, so spending Favour redistributes it rather than reducing the total.';
