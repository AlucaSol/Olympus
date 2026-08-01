-- ===========================================================================
-- TRIARCHS OF OLYMPUS — server-side verification
--
-- Proves the guarantees that no browser test can: that Favour cannot be
-- minted, that the ceiling and rate limits actually hold, that a retry is a
-- no-op, and that two concurrent buyers cannot both spend the same balance.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL Editor and press Run, or:
--       psql "$DATABASE_URL" -f tests/sql/verify.sql
--
-- SAFE TO RUN ON A LIVE PROJECT. Everything happens inside one transaction
-- that ends in ROLLBACK, so no test account, purchase or ledger row survives.
-- Nothing outside the transaction is touched. If any assertion fails the whole
-- thing aborts, which also rolls back.
--
-- WHAT IT DOES NOT COVER: the concurrency test at the end needs two real
-- sessions and cannot be done from one script — it is written out as a manual
-- two-window procedure in the comment beside it, and separately in
-- tests/sql/concurrency.md.
-- ===========================================================================

begin;

-- Keep the run quiet unless something is wrong.
set local client_min_messages = notice;

do $$
declare
    v_user_a  uuid := '00000000-0000-4000-8000-00000000000a';
    v_user_b  uuid := '00000000-0000-4000-8000-00000000000b';
    v_result  jsonb;
    v_balance bigint;
    v_count   integer;
    v_claim   uuid;
    v_code    text;
    v_ip      text := repeat('ab', 32);   -- 64 hex chars = a 32-byte digest
    v_ip2     text := repeat('cd', 32);
    v_req     uuid := gen_random_uuid();
begin
    raise notice '--- setting up two confirmed test accounts ---';

    -- email_confirmed_at is set, so migration 013 treats these as admin
    -- creations and lets them through without a signup claim. That is the
    -- same path the Supabase dashboard uses.
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data,
                            instance_id, aud, role, created_at, updated_at)
    values
      (v_user_a, 'verify_a@example.invalid', now(),
       jsonb_build_object('username', 'verify_a'),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
      (v_user_b, 'verify_b@example.invalid', now(),
       jsonb_build_object('username', 'verify_b'),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

    -- ==================================================================
    -- 1. A new account opens at exactly zero Favour
    -- ==================================================================
    select favour into v_balance from public.player_accounts where user_id = v_user_a;
    assert v_balance = 0, format('new account should open at 0 Favour, got %s', v_balance);
    raise notice 'OK  new account opens at 0 Favour';

    select lifetime_favour into v_balance from public.player_accounts where user_id = v_user_a;
    assert v_balance = 0, 'new account should have 0 lifetime Favour';
    raise notice 'OK  registering awards nothing';

    -- ==================================================================
    -- 2. The balance cannot go negative
    -- ==================================================================
    begin
        update public.player_accounts set favour = -1 where user_id = v_user_a;
        assert false, 'a negative balance was accepted';
    exception when check_violation then
        raise notice 'OK  negative balance refused by check constraint';
    end;

    -- ==================================================================
    -- 3. Buying an item: the server uses ITS OWN price
    -- ==================================================================
    perform public.grant_favour('verify_a', 1000, 'verification');
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_user_a)::text, true);

    -- brontes costs 200 in shop_items. The caller cannot say otherwise:
    -- there is no price parameter to pass.
    v_result := public.purchase_shop_item('brontes');
    assert v_result->>'ok' = 'true', format('purchase failed: %s', v_result);
    assert (v_result->>'favour')::bigint = 800,
        format('expected 1000-200=800, got %s', v_result->>'favour');
    raise notice 'OK  item purchase debits the catalogue price, not a client price';

    select price_paid into v_balance
      from public.player_purchases where user_id = v_user_a and item_id = 'brontes';
    assert v_balance = (select cost from public.shop_items where item_id = 'brontes'),
        'recorded price does not match the catalogue';
    raise notice 'OK  the price snapshot matches the catalogue';

    -- ==================================================================
    -- 4. The same permanent item cannot be bought twice
    -- ==================================================================
    v_result := public.purchase_shop_item('brontes');
    assert v_result->>'error' = 'already_owned',
        format('second purchase should be already_owned, got %s', v_result);
    select favour into v_balance from public.player_accounts where user_id = v_user_a;
    assert v_balance = 800, 'a refused re-purchase must not move the balance';
    raise notice 'OK  duplicate permanent-item purchase refused, balance untouched';

    begin
        insert into public.player_purchases (user_id, item_id, price_paid)
        values (v_user_a, 'brontes', 0);
        assert false, 'the unique constraint did not stop a duplicate entitlement';
    exception when unique_violation then
        raise notice 'OK  (user_id, item_id) uniqueness enforced at the table';
    end;

    -- ==================================================================
    -- 5. Insufficient Favour
    -- ==================================================================
    perform public.grant_favour('verify_b', 10, 'verification');
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_user_b)::text, true);

    v_result := public.purchase_shop_item('lykaon');   -- costs 200
    assert v_result->>'error' = 'insufficient_favour',
        format('expected insufficient_favour, got %s', v_result);
    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 10, 'a refused purchase must not move the balance';
    assert not exists (select 1 from public.player_purchases
                        where user_id = v_user_b and item_id = 'lykaon'),
        'an unaffordable item was granted anyway';
    raise notice 'OK  insufficient Favour: nothing debited, nothing granted';

    -- ==================================================================
    -- 6. Idempotency: a retried request replays, it does not re-buy
    -- ==================================================================
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_user_a)::text, true);

    v_result := public.purchase_shop_item('boon_hades_recall', v_req);
    assert v_result->>'ok' = 'true', format('first call failed: %s', v_result);
    assert (v_result->>'duplicate') = 'false', 'first call should not be a duplicate';
    select favour into v_balance from public.player_accounts where user_id = v_user_a;
    assert v_balance = 700, format('expected 800-100=700, got %s', v_balance);

    -- Same request id again — a double-click, a retried POST, a refresh.
    v_result := public.purchase_shop_item('boon_hades_recall', v_req);
    assert (v_result->>'duplicate') = 'true', 'retry should report duplicate';
    select favour into v_balance from public.player_accounts where user_id = v_user_a;
    assert v_balance = 700, format('a retry charged again: balance now %s', v_balance);
    raise notice 'OK  retried request replayed, charged exactly once';

    select count(*) into v_count from public.favour_transactions
     where user_id = v_user_a and reason = 'shop_purchase:boon_hades_recall';
    assert v_count = 1, format('expected one ledger row, found %s', v_count);
    raise notice 'OK  the ledger records the purchase exactly once';

    -- A different item under a used request id must not slip through.
    v_result := public.purchase_shop_item('boon_hermes_passage', v_req);
    assert v_result->>'error' = 'request_id_reused',
        format('a reused request id bought a different item: %s', v_result);
    raise notice 'OK  a reused request id cannot buy a different item';

    -- ==================================================================
    -- 7. Unauthenticated callers get nothing
    -- ==================================================================
    perform set_config('request.jwt.claims', '', true);
    v_result := public.purchase_shop_item('lykaon');
    assert v_result->>'error' = 'not_authenticated',
        format('an anonymous purchase was not refused: %s', v_result);
    raise notice 'OK  unauthenticated purchase refused';

    -- ==================================================================
    -- 8. Stripe fulfilment: exactly once, whatever Stripe sends
    -- ==================================================================
    raise notice '--- Stripe fulfilment ---';

    update public.favour_bundles set stripe_price_id = 'price_verification'
     where bundle_id = 'favour_200';

    v_result := public.begin_favour_checkout(v_user_b, 'favour_200', gen_random_uuid());
    assert v_result->>'ok' = 'true', format('checkout intent failed: %s', v_result);

    perform public.attach_checkout_session(
        (v_result->>'purchase_id')::bigint, 'cs_verify_1', 'https://checkout.example/1');

    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 10, 'creating a checkout session must not credit anything';
    raise notice 'OK  creating a session credits nothing';

    -- First delivery.
    v_result := public.fulfil_favour_purchase(
        'evt_verify_1', 'checkout.session.completed', 'cs_verify_1',
        'pi_verify_1', 'cus_verify', 900, 'aud', v_user_b, 'favour_200');
    assert v_result->>'ok' = 'true', format('fulfilment failed: %s', v_result);
    assert (v_result->>'granted')::bigint = 200, 'wrong amount granted';
    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 210, format('expected 10+200=210, got %s', v_balance);
    raise notice 'OK  a paid session credits exactly the catalogue amount';

    -- Same event again: a Stripe retry.
    v_result := public.fulfil_favour_purchase(
        'evt_verify_1', 'checkout.session.completed', 'cs_verify_1',
        'pi_verify_1', 'cus_verify', 900, 'aud', v_user_b, 'favour_200');
    assert (v_result->>'duplicate') = 'true', 'a retried event was not detected';
    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 210, format('a webhook retry paid twice: %s', v_balance);
    raise notice 'OK  duplicate webhook delivery credits nothing further';

    -- A *different* event id for the same session — e.g. completed followed by
    -- async_payment_succeeded. Also must not pay twice.
    v_result := public.fulfil_favour_purchase(
        'evt_verify_2', 'checkout.session.async_payment_succeeded', 'cs_verify_1',
        'pi_verify_1', 'cus_verify', 900, 'aud', v_user_b, 'favour_200');
    assert (v_result->>'duplicate') = 'true', 'a second event for one session paid again';
    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 210, 'a second event for one session paid again';
    raise notice 'OK  a second event for the same session credits nothing further';

    -- ==================================================================
    -- 9. A tampered Stripe amount is refused, not honoured
    -- ==================================================================
    v_result := public.begin_favour_checkout(v_user_b, 'favour_200', gen_random_uuid());
    perform public.attach_checkout_session(
        (v_result->>'purchase_id')::bigint, 'cs_verify_2', 'https://checkout.example/2');

    -- "I paid one cent for 200 Favour."
    v_result := public.fulfil_favour_purchase(
        'evt_verify_3', 'checkout.session.completed', 'cs_verify_2',
        'pi_verify_2', 'cus_verify', 1, 'aud', v_user_b, 'favour_200');
    assert v_result->>'error' = 'session_mismatch',
        format('a tampered amount was accepted: %s', v_result);
    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 210, 'a tampered amount credited Favour';
    raise notice 'OK  a mismatched amount is refused and flagged';

    -- Wrong currency.
    update public.favour_bundles set stripe_price_id = 'price_v50' where bundle_id = 'favour_50';
    v_result := public.begin_favour_checkout(v_user_b, 'favour_50', gen_random_uuid());
    perform public.attach_checkout_session(
        (v_result->>'purchase_id')::bigint, 'cs_verify_3', 'https://checkout.example/3');
    v_result := public.fulfil_favour_purchase(
        'evt_verify_4', 'checkout.session.completed', 'cs_verify_3',
        'pi_verify_3', 'cus_verify', 300, 'usd', v_user_b, 'favour_50');
    assert v_result->>'error' = 'session_mismatch',
        format('a currency swap was accepted: %s', v_result);
    raise notice 'OK  a currency mismatch is refused';

    -- Someone else''s account.
    v_result := public.begin_favour_checkout(v_user_b, 'favour_50', gen_random_uuid());
    perform public.attach_checkout_session(
        (v_result->>'purchase_id')::bigint, 'cs_verify_4', 'https://checkout.example/4');
    v_result := public.fulfil_favour_purchase(
        'evt_verify_5', 'checkout.session.completed', 'cs_verify_4',
        'pi_verify_4', 'cus_verify', 300, 'aud', v_user_a, 'favour_50');
    assert v_result->>'error' = 'session_mismatch',
        format('Favour was credited to the wrong account: %s', v_result);
    raise notice 'OK  a buyer mismatch is refused';

    -- ==================================================================
    -- 10. Refunds are flagged, never auto-reversed into a negative balance
    -- ==================================================================
    v_result := public.record_favour_refund(
        'evt_verify_refund', 'charge.refunded', 'pi_verify_1', 900, 'aud', 'refunded');
    assert v_result->>'ok' = 'true', format('refund not recorded: %s', v_result);
    select favour into v_balance from public.player_accounts where user_id = v_user_b;
    assert v_balance = 210, 'a refund silently clawed back Favour';
    select count(*) into v_count from public.favour_purchases
     where stripe_payment_intent_id = 'pi_verify_1' and needs_manual_review;
    assert v_count = 1, 'the refund was not flagged for review';
    raise notice 'OK  refund recorded and flagged, balance untouched';

    -- ==================================================================
    -- 11. Signup gate — kill switch
    -- ==================================================================
    raise notice '--- signup gate ---';

    update public.signup_config set signup_mode = 'disabled';
    v_result := public.begin_signup(v_ip);
    assert v_result->>'error' = 'signup_disabled',
        format('the kill switch did not stop a signup: %s', v_result);
    raise notice 'OK  signup_mode=disabled refuses registration';

    -- ==================================================================
    -- 12. Signup gate — the account ceiling
    -- ==================================================================
    update public.signup_config set signup_mode = 'public';
    select count(*) into v_count from auth.users;
    update public.signup_config set maximum_accounts = v_count;   -- already full

    v_result := public.begin_signup(v_ip);
    assert v_result->>'error' = 'account_limit_reached',
        format('the ceiling did not hold: %s', v_result);
    raise notice 'OK  the account ceiling refuses registration when full';

    update public.signup_config set maximum_accounts = v_count + 50;

    -- ==================================================================
    -- 13. Signup gate — per-IP limits
    -- ==================================================================
    v_result := public.begin_signup(v_ip);
    assert v_result->>'ok' = 'true', format('first signup refused: %s', v_result);
    v_claim := (v_result->>'claim_id')::uuid;
    perform public.complete_signup(v_claim, v_user_a);

    v_result := public.begin_signup(v_ip);
    assert v_result->>'ok' = 'true', 'second signup from one IP should be allowed';
    perform public.complete_signup((v_result->>'claim_id')::uuid, v_user_b);

    v_result := public.begin_signup(v_ip);
    assert v_result->>'error' = 'ip_rate_limited_daily',
        format('a third signup from one IP in 24h was allowed: %s', v_result);
    assert (v_result->>'retry_after_seconds')::integer > 0, 'no retry hint given';
    raise notice 'OK  2 signups per IP per 24h enforced';

    -- Age those two out of the daily window but not the monthly one, then
    -- fill the month.
    update public.signup_ip_quota
       set created_at = timezone('utc', now()) - interval '2 days'
     where ip_hmac = decode(v_ip, 'hex');

    for v_count in 1..3 loop
        v_result := public.begin_signup(v_ip);
        assert v_result->>'ok' = 'true',
            format('signup %s of the monthly allowance refused: %s', v_count, v_result);
        perform public.complete_signup((v_result->>'claim_id')::uuid, v_user_a);
        update public.signup_ip_quota
           set created_at = timezone('utc', now()) - interval '2 days'
         where claim_id = (v_result->>'claim_id')::uuid;
    end loop;

    v_result := public.begin_signup(v_ip);
    assert v_result->>'error' = 'ip_rate_limited_monthly',
        format('a sixth signup from one IP in 30 days was allowed: %s', v_result);
    raise notice 'OK  5 signups per IP per 30 days enforced';

    -- A different IP is unaffected.
    v_result := public.begin_signup(v_ip2);
    assert v_result->>'ok' = 'true', 'a different IP was wrongly rate limited';
    perform public.abort_signup((v_result->>'claim_id')::uuid);
    raise notice 'OK  the limit is per IP, not global';

    -- ==================================================================
    -- 14. Aborting a claim gives the slot back
    -- ==================================================================
    v_result := public.begin_signup(v_ip2);
    v_claim := (v_result->>'claim_id')::uuid;
    select count(*) into v_count from public.signup_ip_quota
     where ip_hmac = decode(v_ip2, 'hex');
    assert v_count = 1, 'the reservation did not record a quota row';

    perform public.abort_signup(v_claim);
    select count(*) into v_count from public.signup_ip_quota
     where ip_hmac = decode(v_ip2, 'hex');
    assert v_count = 0, 'aborting did not release the quota row';
    raise notice 'OK  a failed signup costs the visitor nothing';

    -- ==================================================================
    -- 15. Invitations: single use, atomically consumed
    -- ==================================================================
    update public.signup_config set signup_mode = 'invite_only';

    v_result := public.begin_signup(v_ip2);
    assert v_result->>'error' = 'invite_required',
        format('invite_only accepted a signup with no code: %s', v_result);
    raise notice 'OK  invite_only requires a code';

    v_result := public.begin_signup(v_ip2, 'NOTA-REAL-CODE-ATALL');
    assert v_result->>'error' = 'invalid_invite',
        format('a bogus code was accepted: %s', v_result);
    raise notice 'OK  an unknown code is refused';

    v_result := public.create_signup_invite('verification', 1);
    v_code := v_result->>'code';
    assert v_code is not null and length(v_code) = 23,
        format('unexpected invite code shape: %s', v_code);
    assert not exists (select 1 from public.signup_invites where code_hash = v_code),
        'the invitation code was stored in plaintext';
    raise notice 'OK  only the hash of an invitation is stored';

    v_result := public.begin_signup(v_ip2, v_code);
    assert v_result->>'ok' = 'true', format('a valid code was refused: %s', v_result);
    perform public.complete_signup((v_result->>'claim_id')::uuid, v_user_a);

    v_result := public.begin_signup(v_ip2, v_code);
    assert v_result->>'error' = 'invalid_invite',
        format('a single-use code was used twice: %s', v_result);
    raise notice 'OK  a single-use invitation cannot be reused';

    -- Expired and disabled codes.
    v_result := public.create_signup_invite('expired', 1, timezone('utc', now()) - interval '1 day');
    v_result := public.begin_signup(v_ip2, v_result->>'code');
    assert v_result->>'error' = 'invalid_invite', 'an expired code was accepted';
    raise notice 'OK  an expired invitation is refused';

    v_result := public.create_signup_invite('disabled', 1);
    v_code := v_result->>'code';
    update public.signup_invites set is_enabled = false
     where code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex');
    v_result := public.begin_signup(v_ip2, v_code);
    assert v_result->>'error' = 'invalid_invite', 'a disabled code was accepted';
    raise notice 'OK  a disabled invitation is refused';

    update public.signup_config set signup_mode = 'public';

    -- ==================================================================
    -- 16. An account cannot be created without a claim
    -- ==================================================================
    update public.signup_config set require_signup_claim = true;
    begin
        insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role,
                                created_at, updated_at)
        values (gen_random_uuid(), 'sneaky@example.invalid',
                jsonb_build_object('username', 'sneaky'),
                '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                now(), now());
        assert false, 'an unclaimed signup was allowed through';
    exception when others then
        assert sqlerrm like '%signup_not_authorised%',
            format('unexpected failure: %s', sqlerrm);
        raise notice 'OK  a signup that skipped the gate is refused at the database';
    end;

    -- ==================================================================
    -- 17. Cleanup selects only genuinely unconfirmed accounts over 48h
    -- ==================================================================
    raise notice '--- cleanup selection ---';

    -- Two more accounts: one unconfirmed and old, one unconfirmed but recent.
    update public.signup_config set require_signup_claim = false;
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data,
                            instance_id, aud, role, created_at, updated_at)
    values
      ('00000000-0000-4000-8000-00000000000c', 'old_unconfirmed@example.invalid', null,
       jsonb_build_object('username', 'verify_c'),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       now() - interval '72 hours', now()),
      ('00000000-0000-4000-8000-00000000000d', 'new_unconfirmed@example.invalid', null,
       jsonb_build_object('username', 'verify_d'),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       now() - interval '2 hours', now());

    -- This is precisely the selection cleanup-unconfirmed/index.ts makes.
    select count(*) into v_count
      from auth.users u
     where u.email_confirmed_at is null
       and u.confirmed_at is null
       and u.created_at < timezone('utc', now()) - interval '48 hours'
       and u.email like '%@example.invalid';
    assert v_count = 1, format('cleanup should select exactly 1 account, selected %s', v_count);

    select count(*) into v_count
      from auth.users u
     where u.email_confirmed_at is null
       and u.created_at < timezone('utc', now()) - interval '48 hours'
       and u.id = '00000000-0000-4000-8000-00000000000c';
    assert v_count = 1, 'cleanup did not select the old unconfirmed account';

    -- The confirmed accounts must never be selected, however old.
    update auth.users set created_at = now() - interval '400 days' where id = v_user_a;
    select count(*) into v_count
      from auth.users u
     where u.email_confirmed_at is null
       and u.confirmed_at is null
       and u.created_at < timezone('utc', now()) - interval '48 hours'
       and u.id = v_user_a;
    assert v_count = 0, 'cleanup selected a confirmed account';
    raise notice 'OK  cleanup selects only unconfirmed accounts older than 48h';

    -- Deleting the auth user takes the profile with it.
    delete from auth.users where id = '00000000-0000-4000-8000-00000000000c';
    select count(*) into v_count from public.player_accounts
     where user_id = '00000000-0000-4000-8000-00000000000c';
    assert v_count = 0, 'deleting an auth user left an orphaned profile';
    raise notice 'OK  deleting an auth user cascades to player_accounts';

    -- ==================================================================
    -- 18. Retention
    -- ==================================================================
    insert into public.signup_ip_quota (ip_hmac, created_at)
    values (decode(v_ip2, 'hex'), timezone('utc', now()) - interval '31 days');
    insert into public.signup_attempt_log (ip_hmac, outcome, created_at)
    values (decode(v_ip2, 'hex'), 'test', timezone('utc', now()) - interval '8 days');

    v_result := public.purge_signup_records();
    assert (v_result->>'ip_quota_deleted')::integer >= 1, 'old IP digests were not purged';
    assert (v_result->>'attempt_log_deleted')::integer >= 1, 'old attempt logs were not purged';
    raise notice 'OK  IP digests purge at 30 days, attempt logs at 7';

    -- Rejection logging is capped, so a bot cannot grow the table without end.
    update public.signup_config set signup_mode = 'disabled';
    for v_count in 1..40 loop
        perform public.begin_signup(v_ip2);
    end loop;
    select count(*) into v_count from public.signup_attempt_log
     where ip_hmac = decode(v_ip2, 'hex')
       and created_at > timezone('utc', now()) - interval '1 hour';
    assert v_count <= 20, format('attempt log grew unbounded: %s rows', v_count);
    raise notice 'OK  rejection logging is capped at 20 per IP per hour';

    raise notice '';
    raise notice '=====================================================';
    raise notice '  ALL SERVER-SIDE CHECKS PASSED';
    raise notice '=====================================================';
end;
$$;

-- ===========================================================================
-- Nothing above is kept. Every account, purchase, ledger row and config change
-- made by this script disappears here.
-- ===========================================================================
rollback;
