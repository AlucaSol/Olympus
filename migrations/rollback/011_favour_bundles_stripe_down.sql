-- Rollback for 011_favour_bundles_stripe.sql
--
-- Removes the real-money Favour bundles, the Stripe purchase ledger and the
-- fulfilment path. The game is untouched by this: nothing in 001-009 reads any
-- of these objects.
--
-- IMPORTANT — WHAT THIS DOES *NOT* UNDO. Favour already credited by a Stripe
-- purchase stays in player_accounts.favour, and its row in favour_transactions
-- (reason 'stripe_bundle:...', reference 'stripe_session:...') stays too. That
-- is deliberate: players keep what they paid for, and the audit trail of real
-- money survives a schema rollback. Only the bundle catalogue and the Stripe
-- bookkeeping are removed.
--
-- DESTRUCTIVE: drops the payment ledger. Keep a copy of anything you may need
-- for accounting or dispute handling before running it:
--
--   create table public.favour_purchases_archive as table public.favour_purchases;
--   create table public.stripe_events_archive    as table public.stripe_events;

drop function if exists public.favour_purchases_needing_review();
drop function if exists public.record_favour_refund(text, text, text, integer, text, text);
drop function if exists public.close_favour_purchase(text, text);
drop function if exists public.record_stripe_event(text, text, text, jsonb, text);
drop function if exists public.fulfil_favour_purchase(text, text, text, text, text, integer, text, uuid, text);
drop function if exists public.attach_checkout_session(bigint, text, text);
drop function if exists public.begin_favour_checkout(uuid, text, uuid);

drop table if exists public.stripe_events;
drop table if exists public.favour_purchases;
drop table if exists public.favour_bundles;
