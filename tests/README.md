# Verification

Five layers, because no single one of them can prove what the others do.

| What | How | Proves |
| --- | --- | --- |
| `node tests/lint.mjs` | static scan | no secret in client code, no dead script reference, no `*` CORS, no unpinned `search_path` |
| `node tests/username.mjs` | pure logic, no browser | the username rules catch the evasions and spare innocent names |
| `node tests/ui/run.mjs` | real browser, mocked Supabase | what a signed-out and a signed-in visitor actually see and send |
| `tests/sql/verify.sql` | real database, one rolled-back transaction | the money, the ceiling, the rate limits, idempotency |
| `tests/sql/username.sql` | real database, one rolled-back transaction | the rename rules, the cooldown, case-insensitive uniqueness |
| `tests/sql/concurrency.md` | two SQL sessions, by hand | the locks are in the right places |
| `tests/stripe/README.md` | Stripe test mode | signatures, duplicates, refunds, real fulfilment |

---

## Setup

```bash
npm install          # playwright-core only
npx playwright install chromium   # if you do not already have it
```

The website itself still needs no build step. `package.json` exists purely for
this harness.

---

## The quick pass

```bash
node tests/lint.mjs        # ~1s
node tests/username.mjs    # ~0.1s, no browser
node tests/ui/run.mjs      # ~30s, launches headless Chromium
```

Both exit non-zero on failure, so they drop straight into CI if you ever want
them there.

### What the UI run covers

89 checks, in nine groups:

- **Signed out** — balance is exactly `0`; Favour category exists and leads;
  Favour is *not* preselected; an ordinary item says exactly
  *"Sign in to Purchase"* with its description intact and no purchase button;
  a Favour bundle explains an account is needed and starts no Stripe session;
  prices read `A$`, not a bare `$`.
- **Signed in** — the balance is the figure from the database; Favour *is*
  preselected; a filter the visitor changes by hand is never reset under them;
  owned stock is greyed and marked OWNED with no purchase button; the
  confirmation reads *"Are you sure you wish to purchase Brontes for 200
  Favour?"* and never says Tribute; the purchase call carries an item id and an
  idempotency key **and nothing else** — no price, no quantity, no user id.
- **Refused purchases** — insufficient Favour, already owned, unavailable,
  expired session and a retried request each produce their own clear message.
- **Stripe checkout** — the call carries a bundle id, an idempotency key and
  the access token, and again names no price, currency, quantity or user.
- **Success page** — visiting `?payment=success` changes no balance and makes
  no grant call.
- **Identity changes** — a failed balance read shows no number rather than a
  stale one; signing out returns the display to `0`; a forged
  `localStorage.loggedIn` signs nobody in.
- **Username form** — the account page's name is an editable field with a
  Change button; one Turnstile panel names both actions it covers; a name that
  is too short, out of charset, blocked, or simply unchanged is refused with
  **zero** Supabase requests; a local cooldown the server does not confirm is
  cleared on load, and a server-reported recent rename locks the button with a
  countdown even after `localStorage.clear()`.
- **Forms** — password fields are `type="password"`, mismatches and short
  passwords are refused before any request, nothing is written to
  localStorage; the signup form shows the invite field only in `invite_only`
  and withdraws itself entirely in `disabled` while still offering guest play.
- **Responsive** — 1440 / 1100 / 820 / 390px: no horizontal scroll, nav on one
  row.

The Supabase REST layer is mocked, so this can run offline and without an
account. It says nothing about whether the server is safe — that is the next
two files' job.

---

## The database pass

Paste `tests/sql/verify.sql` into the Supabase SQL Editor and run it, or:

```bash
psql "$DATABASE_URL" -f tests/sql/verify.sql
```

**Safe on a live project.** It runs inside one transaction ending in
`ROLLBACK`; the test accounts, purchases and config changes all disappear. Any
failed assertion aborts, which also rolls back.

It covers: a new account opening at exactly zero; the `favour >= 0` constraint;
purchases charging the catalogue price rather than anything a caller could
name; double-purchase refused with the balance untouched; insufficient Favour
granting nothing; a retried request id replaying instead of re-charging;
unauthenticated calls refused; Stripe fulfilment crediting exactly once across
retries and across two different events for one session; tampered amount,
currency and buyer all refused as `session_mismatch`; refunds flagged and never
auto-reversed; the kill switch; the account ceiling; 2-per-24h and 5-per-30d
per IP; aborted claims returning the slot; single-use, expired and disabled
invitations; an unclaimed signup being refused at the database; cleanup
selecting only unconfirmed accounts older than 48 hours and cascading to the
profile; and the retention and log-growth caps.

Then run `tests/sql/username.sql` the same way, for migrations 015 and 016.
Unlike `verify.sql` it ends in a `SELECT`, so a pass is a **table of 19 rows**,
one per check — not "Success. No rows returned", which the SQL Editor also
prints for a script that verified nothing. The first row confirms
`plpgsql.check_asserts` is on; with it off, every `ASSERT` in either SQL file
is a silent no-op. It covers:
folding through separators, homoglyphs and case; the 5-20 length rule and the
character set; the screen catching padded, separated and leetspoken profanity
while leaving Cassandra, Cockatrice, Analyst, Scunthorpe and Cockburn alone;
the allow-list refusing to act as a prefix or substring shield; a valid rename
applying; the 24-hour cooldown enforced in the database rather than only in the
browser; uniqueness refusing `HERAKLION` and `hErAkLiOn` against `Heraklion`
while preserving the capitals actually typed; recasing your own name allowed
but an identical resubmission costing nothing; a refused rename leaving the
cooldown untouched; the kill switch stopping renames without disturbing
existing names; the email-prefix default surviving a dotted address, a
too-long prefix, a too-short prefix and a collision; `player_accounts` still
having no UPDATE policy for the browser; and — the regression that actually
happened — that `handle_new_auth_user()` still refuses an unclaimed signup,
since 013 keeps that enforcement inside the same function 015 replaced.

Then run `tests/sql/rls.sql` and read its output against the expectations
printed alongside each query. It is read-only.

---

## The two-window pass

`tests/sql/concurrency.md`. Three procedures, each needing two SQL sessions:
two purchases racing one balance, two signups racing one invitation, two
deliveries racing one Stripe event. A single session cannot block on itself, so
these cannot be automated here.

---

## The Stripe pass

`tests/stripe/README.md`, in **test mode**. Eleven checks with a tick-list at
the end, including the two that matter most: a forged signature is rejected
before any database call, and a resent event credits nothing further.

---

## What is deliberately not tested here

- **Deno type-checking of the Edge Functions.** They are syntax-checked in CI
  via Node's type stripping, but a full `deno check` needs Deno installed and
  network access to resolve the `npm:` and `jsr:` specifiers:
  ```bash
  deno check supabase/functions/**/*.ts
  ```
- **Live-mode Stripe.** Not enabled, by instruction.
- **Email delivery.** Needs Resend and a verified domain; step 4 of
  `docs/backend-setup.md` has a send-yourself-a-signup check instead.
