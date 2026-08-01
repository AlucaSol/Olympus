# Stripe test-mode verification

Run all of this with Stripe in **test mode**. No real money moves; the card
numbers below only exist in Stripe's sandbox.

Prerequisite: steps 7–9 of `docs/backend-setup.md` are done.

```bash
# Stripe CLI, once
stripe login
```

---

## 1. A payment that should work

1. Sign in on the website and open the Emporion.
2. Select **200 Favour** and press **Buy with card**.
3. On Stripe's page use card `4242 4242 4242 4242`, any future expiry, any CVC,
   any postcode.
4. Pay.

**Expected**

- You are returned to `emporion.html?payment=success`.
- The notice says the Favour is being added and may take a moment.
- Within a few seconds the balance rises by exactly 200 without a refresh.

**Confirm it server-side:**

```sql
select purchase_id, bundle_id, amount_minor, currency, favour_amount,
       status, favour_granted, fulfilled_at
  from public.favour_purchases order by created_at desc limit 5;
-- status 'fulfilled', favour_granted true, amount_minor 900, currency 'aud'

select event_id, event_type, status from public.stripe_events
 order by received_at desc limit 5;
-- checkout.session.completed -> processed

select amount, reason, external_reference from public.favour_transactions
 order by created_at desc limit 3;
-- +200, 'stripe_bundle:favour_200', 'stripe_session:cs_test_...'
```

**One row each.** Two ledger rows for one payment is a bug; there should be
exactly one.

---

## 2. The success page does not award anything

With the tab still open, visit `emporion.html?payment=success` directly — no
payment, just the URL.

**Expected**: the balance does not move. The page says the Favour is being
added, polls a few times, gives up, and offers Refresh. Nothing is credited,
because nothing on the client is capable of crediting anything.

Confirm no new rows appeared in `favour_transactions`.

---

## 3. A duplicate webhook must not pay twice

```bash
# Take a real event id from your Stripe dashboard's webhook log and resend it.
stripe events resend evt_XXXXXXXXXXXX
```

**Expected**

- The endpoint answers `200`.
- `public.stripe_events` still has **one** row for that event id.
- The balance is unchanged.
- `favour_transactions` gained nothing.

The function's log line reads `"duplicate": true, "granted": 0`.

---

## 4. A forged signature must be rejected

```bash
curl -i -X POST \
  https://xwtsqssaahubalgztoby.supabase.co/functions/v1/stripe-webhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1,v1=deadbeef" \
  -d '{"id":"evt_forged","type":"checkout.session.completed","data":{"object":{"id":"cs_forged","payment_status":"paid","amount_total":1,"currency":"aud","metadata":{"supabase_user_id":"<your uuid>","bundle_id":"favour_400"}}}}'
```

**Expected**: `HTTP/1.1 400` and the body `Invalid signature`.

Then confirm it never reached the database:

```sql
select count(*) from public.stripe_events where event_id = 'evt_forged';  -- 0
```

Zero. The signature check happens before any database call, so a forged event
leaves no trace beyond a log line.

Try it without the header at all — `400 Missing signature`.

---

## 5. A tampered amount must not be honoured

This is the "one million Favour for one cent" case. It cannot be expressed from
the browser, so test it where it *could* in principle come from — a webhook
that disagrees with our own record.

```bash
stripe trigger checkout.session.completed \
  --override checkout_session:amount_total=1
```

Or directly, which is clearer:

```sql
-- Against a real pending session from a checkout you started but did not pay:
select public.fulfil_favour_purchase(
    'evt_tamper_test', 'checkout.session.completed',
    '<the cs_test_... id>', 'pi_x', 'cus_x',
    1,            -- one cent
    'aud', '<buyer uuid>', 'favour_400');
```

**Expected**: `{"ok": false, "error": "session_mismatch"}`, no Favour credited,
and the purchase row moved to `status = 'mismatch'` with
`needs_manual_review = true`.

The same happens if the currency, the bundle or the buyer disagrees with what
we recorded when the session was created. `tests/sql/verify.sql` section 9
covers all four.

---

## 6. Cancelling

Start a checkout and press Stripe's back arrow.

**Expected**: back on `emporion.html?payment=cancelled`, notice reads "Payment
cancelled. Nothing has been charged." The `favour_purchases` row stays
`pending` until Stripe expires the session, at which point
`checkout.session.expired` moves it to `expired`.

---

## 7. A delayed payment

If you ever enable a delayed method (BECS Direct Debit is the likely one for
AUD), the money arrives minutes to days after checkout completes.

```bash
stripe trigger checkout.session.async_payment_succeeded
```

**Expected**: Favour is credited on that event, exactly as for an immediate
card payment, and exactly once. A `checkout.session.completed` that arrives
first with `payment_status != 'paid'` is recorded and ignored — it must not
credit anything, because the money has not arrived yet.

---

## 8. A refund

Stripe Dashboard → **Payments** → the test payment → **Refund**.

**Expected**

```sql
select * from public.favour_purchases_needing_review();
```

One row, `status = 'refunded'`, `needs_manual_review = true`, `review_note`
recording the date and that Favour was **not** automatically reversed.

The balance is deliberately untouched. The player may already have spent it on
a permanent unlock, and `player_accounts.favour >= 0` would refuse to go
negative anyway. Decide what to do and, if a clawback is right:

```sql
select public.grant_favour('their_username', -200, 'refund of favour_200');
```

That refuses rather than overdrawing if they have already spent it, which is
the point at which a human should be deciding, not a webhook.

---

## 9. Rate limiting

Press **Buy with card** nine times in a few minutes (cancel each).

**Expected**: the ninth returns "That is a lot of checkouts in a short time",
HTTP 429. The limit is 8 sessions per user per 10 minutes.

---

## 10. Idempotent session creation

Hard to do by hand from the UI, because each click mints a fresh request id.
Directly:

```bash
TOKEN="<a real access_token from devtools: localStorage sb-xwtsqssaahubalgztoby-auth-token>"
REQ=$(uuidgen)

for i in 1 2; do
  curl -s -X POST \
    https://xwtsqssaahubalgztoby.supabase.co/functions/v1/stripe-checkout \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Origin: https://alucasol.github.io" \
    -d "{\"bundleId\":\"favour_50\",\"requestId\":\"$REQ\"}"
  echo
done
```

**Expected**: both calls return the **same** checkout URL, the second with
`"reused": true`. Exactly one row in `favour_purchases`.

---

## 11. CORS

```bash
curl -i -X POST \
  https://xwtsqssaahubalgztoby.supabase.co/functions/v1/stripe-checkout \
  -H "Origin: https://evil.example" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected**: no `Access-Control-Allow-Origin` header in the response. A
browser on that origin cannot read the reply. (`curl` still shows a body — CORS
is a browser rule, not a server firewall. The real protection is that the
endpoint needs a valid Supabase access token, which a cross-origin page cannot
obtain.)

---

## Checklist

- [ ] 1. Test card pays, 200 Favour credited exactly once
- [ ] 2. `?payment=success` alone credits nothing
- [ ] 3. Resent webhook credits nothing further
- [ ] 4. Forged signature → 400, nothing written
- [ ] 5. Tampered amount → `session_mismatch`, flagged
- [ ] 6. Cancel returns cleanly, nothing charged
- [ ] 7. Async success credits once
- [ ] 8. Refund flagged for review, balance untouched
- [ ] 9. Ninth checkout in 10 minutes → 429
- [ ] 10. Same request id → same session
- [ ] 11. Unknown origin gets no CORS headers
