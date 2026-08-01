# Concurrency checks

Two of the guarantees in this system are about what happens when two things
arrive at once, and neither can be proved from a single SQL session — one
session cannot block on itself. Both need two windows open on the same
database.

Open the Supabase SQL Editor in **two browser tabs**, or two `psql` sessions.
Below, "A" and "B" are those two sessions.

Each procedure ends in `rollback`, so nothing survives.

---

## 1. Two simultaneous purchases against one balance

The claim: a player with exactly enough Favour for one item cannot buy two by
firing both requests at the same moment.

**Setup** (either session, and *commit* this one so both sessions can see it):

```sql
-- Pick a real confirmed account you do not mind spending on, then top it up
-- to exactly 200 — the price of one champion.
select public.grant_favour('YOUR_USERNAME_HERE', 0);   -- shows the balance
-- adjust so that favour = 200 exactly, e.g.
-- select public.grant_favour('YOUR_USERNAME_HERE', <delta>);
```

**Session A**

```sql
begin;
set local request.jwt.claims = '{"sub":"<the account uuid>"}';
select public.purchase_shop_item('brontes');
-- Do NOT commit yet. Leave this window sitting here.
```

**Session B** (while A is still open)

```sql
begin;
set local request.jwt.claims = '{"sub":"<the same account uuid>"}';
select public.purchase_shop_item('lykaon');
-- This BLOCKS. That is the whole point: it is waiting on the row lock that
-- A took with SELECT ... FOR UPDATE.
```

**Back in Session A**

```sql
commit;
```

**Session B unblocks.** Read its result.

Expected: `{"ok": false, "error": "insufficient_favour", "favour": 0}`.

B re-read the balance *after* A committed, saw 0, and refused. If B had
instead returned `ok: true`, the account would have bought 400 Favour worth of
champions with 200 Favour, and the `favour >= 0` check constraint would have
had to abort the transaction.

Clean up:

```sql
-- Session B
rollback;
-- Then undo A's purchase if you want the account back as it was:
delete from public.player_purchases
 where user_id = '<uuid>' and item_id = 'brontes';
select public.grant_favour('YOUR_USERNAME_HERE', 200);
```

---

## 2. Two simultaneous signups racing one invitation

The claim: a single-use invitation cannot be consumed twice, even if two people
paste it at the same instant.

**Setup** (commit this):

```sql
update public.signup_config set signup_mode = 'invite_only';
select public.create_signup_invite('concurrency test', 1);
-- Copy the `code` out of the result. It cannot be shown again.
```

**Session A**

```sql
begin;
select public.begin_signup(repeat('11', 32), 'THE-CODE-YOU-COPIED');
-- ok: true, with a claim_id. Do not commit.
```

**Session B**

```sql
begin;
select public.begin_signup(repeat('22', 32), 'THE-CODE-YOU-COPIED');
-- BLOCKS, on both the advisory lock and the invite row.
```

**Session A**

```sql
commit;
```

**Session B unblocks.**

Expected: `{"ok": false, "error": "invalid_invite"}`.

B's conditional `UPDATE ... WHERE used_count < max_uses` re-evaluated against
the row A had just committed, found the single use spent, and matched nothing.

Clean up:

```sql
rollback;                                   -- session B
update public.signup_config set signup_mode = 'public';
delete from public.signup_invites where label = 'concurrency test';
```

---

## 3. Two simultaneous deliveries of one Stripe event

The claim: a duplicated webhook cannot credit twice.

This one *can* be done in a single session for the retry case (see
`verify.sql` section 8), but the genuinely-parallel case is worth seeing.

**Session A**

```sql
begin;
select public.fulfil_favour_purchase(
    'evt_concurrency', 'checkout.session.completed', '<a real pending session id>',
    'pi_x', 'cus_x', 900, 'aud', '<buyer uuid>', 'favour_200');
-- Do not commit.
```

**Session B**

```sql
begin;
select public.fulfil_favour_purchase(
    'evt_concurrency', 'checkout.session.completed', '<the same session id>',
    'pi_x', 'cus_x', 900, 'aud', '<buyer uuid>', 'favour_200');
```

B returns **immediately** with `{"ok": true, "duplicate": true, "granted": 0}` —
it did not block, because `INSERT ... ON CONFLICT DO NOTHING` on the Stripe
event id simply found nothing to do. Only one of the two can ever hold that
primary key, and only the holder proceeds to the credit.

Commit A, roll back B, and confirm the balance rose by exactly 200 once.

---

## What these two-window tests are really checking

Not that the code has the right `if` statements — `verify.sql` covers that.
They check that the **locks** are in the right places:

* `purchase_shop_item` takes `SELECT ... FOR UPDATE` on `player_accounts`
  *before* it compares the balance to the price, so no decision is ever made
  against a figure another transaction is in the middle of changing.
* `begin_signup` takes a transaction-scoped advisory lock, so the ceiling and
  the IP counts are read and acted on by one caller at a time.
* `fulfil_favour_purchase` claims the Stripe event id on a primary key before
  doing anything else, so the loser of that race does no work at all.
