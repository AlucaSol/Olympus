-- Rollback for 012_website_item_purchase.sql
--
-- Removes the idempotency-keyed overload and its bookkeeping table.
--
-- The one-argument public.purchase_shop_item(text) from 002_shop.sql is NOT
-- touched — 012 never redefined it, and the game calls it. After this rollback
-- the website would need to fall back to that one-argument form, at the cost of
-- a retried request reading as `already_owned` instead of replaying its result.
--
-- Purchases themselves are unaffected: ownership lives in player_purchases and
-- the debits live in favour_transactions, neither of which this file touches.

drop function if exists public.purge_shop_purchase_requests();
drop function if exists public.purchase_shop_item(text, uuid);

drop table if exists public.shop_purchase_requests;
