# Backend setup — accounts, Favour and Stripe

Project ref: `xwtsqssaahubalgztoby`

> **Nothing here enables live payments.** Stripe stays in test mode throughout.
> Going live is step 15, and it is deliberately last and separate.

---

## Status — what is already done

Applied on **1 August 2026** against the live project. Steps below are kept as
reference; you do not need to redo them.

| Step | State | Notes |
| --- | --- | --- |
| 0. Supabase CLI | ✅ | installed as a devDependency — use `npx supabase …` |
| 1. Migrations 010–013 | ✅ | all four applied; `signup_status()` reports `public` / 1000 / `require_signup_claim: true` |
| 2. Email confirmation | ✅ | `mailer_autoconfirm: false`, password min length 8 |
| 3. Redirect URLs | ✅ | site URL and all five redirect URLs registered |
| 4. Resend SMTP | ⛔ **not done** | no domain available — see the warning below |
| 5. Turnstile | ✅ | CAPTCHA enabled, provider `turnstile`, secret set. Verified live: a signup with no token is refused server-side |
| 6. `signup` function | ✅ | deployed; `GET` returns `{"mode":"public","accepting":true}` |
| 7. Stripe products | ✅ | three AUD prices, verified against `favour_bundles` |
| 8. `stripe-checkout` | ✅ | deployed; rejects unauthenticated and garbage tokens with 401 |
| 9. `stripe-webhook` | ✅ | deployed, endpoint registered with all 8 events, signing secret set and **proven** — see below |
| 10. Payment path test | ⏳ **yours** | needs a browser and a test card: `tests/stripe/README.md` |
| 11. Cleanup + cron | ✅ | function deployed, scheduled daily 03:00 UTC via `pg_cron`; token held in Supabase Vault, not inline in the job |
| — Verification suite | ✅ | `tests/sql/verify.sql` ran clean against the live database and left nothing behind |

### The webhook signature check was verified for real

Not "the code looks right" — a genuinely signed request was sent to the live
endpoint, and four bad ones:

| Sent | Result |
| --- | --- |
| correctly signed | `200` — recorded and ignored (unhandled type) |
| forged signature | `400 Invalid signature` |
| no signature header | `400 Missing signature` |
| valid signature, body altered afterwards | `400 Invalid signature` |
| valid signature, timestamp one hour old | `400 Invalid signature` |

Only the first wrote a row, and no balance moved.

### ⛔ Before anyone can actually register: email

Without custom SMTP, Supabase sends confirmation emails through its own
shared service, **hard-capped at 2 per hour**. This is not a setting you can
raise — the API refuses:

> `Custom SMTP required to configure … RATE_LIMIT_EMAIL_SENT`

So registration works, but the third person to try in any given hour gets no
email. Fix it with step 4 when you can. Two routes:

- **A domain you control.** Any domain — it does not have to be the game's.
  If you have DNS access to `jj-games.org`, that is the quickest path.
- **No domain at all.** Resend lets you send from `onboarding@resend.dev`
  without verifying anything, but *only to the address your Resend account is
  registered with*. That is enough to test the whole signup flow end to end
  yourself; it will not serve real players.

### ⚠ One decision still open

`require_signup_claim` is **on**, which means the website's signup service is
now the only way an account can be created. If the game client or launcher
calls `auth.signUp()` itself, those signups will start failing.

Nothing in the database suggests it does — the 4 accounts with profiles were
all created before this work — but I cannot see the game's source. If players
report they cannot register in-game:

```sql
update public.signup_config set require_signup_claim = false;
```

### Housekeeping

- 7 unconfirmed accounts from 16 July (all predating migration 001, none with
  a profile row) match the cleanup rule and **will be deleted at 03:00 UTC**.
  If you want to keep any, see step 11.
- Revoke the Supabase personal access token when you are finished:
  <https://supabase.com/dashboard/account/tokens>
- Delete `secrets.local` when you no longer need it. It is gitignored, but it
  holds live credentials.

---

## 0. First: where do the `supabase …` commands actually run?

Several steps below use a command-line tool called the **Supabase CLI**. It is
not installed by default and it is not the same thing as the website — it is a
separate program that talks to your Supabase project from your own machine.

You need it once. Everything else in this document is either SQL you paste into
a web page, or a setting you click.

### Install it

The CLI is on npm, and this project already has a `package.json`, so the
simplest option is to install it *into the project*:

```bash
cd "c:/Users/jonbe/Documents/AI projects/Triarchs of Olympus Site"
npm install --save-dev supabase
```

That puts it in `node_modules/` (which is gitignored) rather than on your
system. From then on, **every `supabase …` command in this document must be
written `npx supabase …`**:

```bash
npx supabase --version
```

If you would rather have it available everywhere as a plain `supabase`
command, use the standalone installer instead — on Windows:

```powershell
winget install --id Supabase.CLI
```

Both work. Pick one and be consistent, because `supabase` and `npx supabase`
are not interchangeable if you only installed one of them.

### Log in

Once, before any other command:

```bash
npx supabase login
```

That opens a browser, you approve it, and the CLI stores a token. Alternatively
— and this is what you want if you are pasting commands into a script — create
a token at <https://supabase.com/dashboard/account/tokens> and set it as an
environment variable instead of logging in:

```bash
# Git Bash / macOS / Linux
export SUPABASE_ACCESS_TOKEN="sbp_..."

# PowerShell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
```

### Which terminal?

This repository is on Windows, and you have both available:

- **Git Bash** — use it if you are copying the `export …` and `openssl …`
  commands below verbatim. They are written for a POSIX shell.
- **PowerShell** — fine too, but `export` becomes `$env:NAME = "value"`, and
  `openssl` may not exist. Where a command below generates a random secret with
  `openssl`, the PowerShell equivalent is given beside it.

### The `--project-ref` flag

Every command carries `--project-ref xwtsqssaahubalgztoby`. That is the id of
this Supabase project, visible in the dashboard URL. It saves you having to run
`supabase link` first, and it means a copied command can never accidentally hit
a different project.

### If a command fails

- `command not found: supabase` — you installed it with npm; write
  `npx supabase` instead.
- `Access token not provided` — run `npx supabase login`, or set
  `SUPABASE_ACCESS_TOKEN`.
- `Project not found` — the ref is wrong, or the token belongs to a different
  Supabase account.
- `openssl: command not found` — you are in PowerShell; use the PowerShell
  alternative given beside the command.

---

## 1. Apply the migrations

Supabase Dashboard → **SQL Editor** → paste and run, one at a time, in order:

```
migrations/010_website_signup_controls.sql
migrations/011_favour_bundles_stripe.sql
migrations/012_website_item_purchase.sql
migrations/013_signup_claim_enforcement.sql
migrations/015_username_changes.sql
```

> **014 is not missing.** The numbering is shared with the game repository, and
> 014 is a map migration that lives only there. The website's copy skips it.

Or with the CLI:

```bash
npx supabase db push --project-ref xwtsqssaahubalgztoby
```

Each has a matching rollback in `migrations/rollback/` if you need to undo one.

> ### ⚠ Read this before running 013
>
> 013 makes the website's signup service the **only** way an account can be
> created. If the game client, the launcher, or anything else calls
> `auth.signUp()` directly, those signups will start failing with
> `signup_not_authorised`.
>
> Creating a user from the Supabase dashboard or the Admin API always works,
> claim or no claim — 013 recognises those by the fact that they arrive already
> confirmed.
>
> If something else does register players, run this once and the rest of the
> gate still applies to everything coming through the website:
>
> ```sql
> update public.signup_config set require_signup_claim = false;
> ```

Check it took:

```sql
select public.signup_status();
```

Expect `signup_mode: public`, `maximum_accounts: 1000`,
`require_signup_claim: true`.

---

## 2. Make email confirmation mandatory

Dashboard → **Authentication → Sign In / Providers → Email**

- **Confirm email** — turn **ON**. This is what stops an account being usable
  before the address is proven.
- **Secure email change** — leave ON.
- **Minimum password length** — set to **8**. The website checks for 8 before
  it sends anything; if you raise it here, raise `MIN_PASSWORD_LENGTH` in
  `supabase/functions/signup/index.ts` and `MIN_PASSWORD` in `js/signup.js`
  and `js/account.js` to match, or people will be told 8 is enough and then
  refused.

---

## 3. Add the redirect URLs

Dashboard → **Authentication → URL Configuration**

- **Site URL**: `https://alucasol.github.io/Olympus`
- **Redirect URLs** — add all of these:
  ```
  https://alucasol.github.io/Olympus/confirm.html
  https://alucasol.github.io/Olympus/emporion.html
  https://alucasol.github.io/Olympus/account.html
  http://localhost:8080/confirm.html
  http://localhost:8080/emporion.html
  ```

A confirmation link whose `redirect_to` is not on this list is rejected by
Supabase, and the visitor lands on an error instead of a confirmed account.

---

## 4. Connect Resend as the SMTP provider

Supabase's built-in mailer is rate-limited to a handful of messages an hour and
is not meant for real signups.

**In Resend** (<https://resend.com>):

1. **Domains → Add Domain**, add the domain you will send from, and add the
   DKIM/SPF records it gives you to your DNS. Wait for it to verify.
2. **API Keys → Create API Key**, permission **Sending access**. Copy it — it
   is shown once.

**In Supabase** → **Project Settings → Authentication → SMTP Settings**:

| Field | Value |
| --- | --- |
| Enable Custom SMTP | ON |
| Sender email | `no-reply@yourdomain` (must be on the verified domain) |
| Sender name | `Triarchs of Olympus` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key from above |

Then **Authentication → Rate Limits → Emails per hour** — raise it from the
default 4 to something realistic (30–100).

Send yourself a test signup before moving on. If the email never arrives, it is
almost always the domain not being verified in Resend.

---

## 5. Turn on Cloudflare Turnstile

**In Cloudflare** → **Turnstile → Add Site**:

- **Domains**: add `alucasol.github.io` **and** `localhost`.
  Both are needed — the widget refuses to render on a domain it was not issued
  for, so leaving `localhost` out breaks local testing.
- **Widget mode**: Managed.
- Copy the **Site Key** and the **Secret Key**.

The site key is already in `js/config.js`
(`0x4AAAAAAD6lW2pG3Hnhur9_`). If Cloudflare gives you a different one, update
that file.

**In Supabase** → **Authentication → Attack Protection → CAPTCHA protection**:

- Enable, provider **Cloudflare Turnstile**, and paste the **Secret Key**.

Supabase now verifies the token itself on every signup and sign-in. That is why
`login.html` also renders a widget — with CAPTCHA protection on, sign-in needs
a token too, and login would break without it.

---

## 6. Deploy the signup function

```bash
npx supabase secrets set \
  SIGNUP_IP_HMAC_SECRET="$(openssl rand -base64 48)" \
  SIGNUP_CONFIRM_REDIRECT_URL="https://alucasol.github.io/Olympus/confirm.html" \
  ALLOWED_ORIGINS="https://alucasol.github.io,http://localhost:8080" \
  --project-ref xwtsqssaahubalgztoby

npx supabase functions deploy signup --project-ref xwtsqssaahubalgztoby
```

In PowerShell, where `openssl` and `$( … )` do not exist, generate the secret
first and then use it:

```powershell
$hmac = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
npx supabase secrets set `
  SIGNUP_IP_HMAC_SECRET="$hmac" `
  SIGNUP_CONFIRM_REDIRECT_URL="https://alucasol.github.io/Olympus/confirm.html" `
  ALLOWED_ORIGINS="https://alucasol.github.io,http://localhost:8080" `
  --project-ref xwtsqssaahubalgztoby
```

### About the IP-HMAC secret

Store it somewhere you will not lose it, but understand what it is:

- **Losing it** is survivable — the existing rate-limit digests stop matching
  and the per-IP counts effectively reset. Nobody is locked out.
- **Leaking it** is not. There are only ~4 billion IPv4 addresses; with the key
  in hand, every stored digest can be brute-forced back to an address in
  seconds. That is exactly why a plain hash was not good enough.

Never put it in `js/config.js`, in a migration, or in a commit.

Smoke test:

```bash
curl https://xwtsqssaahubalgztoby.supabase.co/functions/v1/signup
# {"mode":"public","accepting":true}
```

---

## 7. Create the Stripe products (TEST MODE)

Stripe Dashboard — check the **Test mode** toggle is ON before you touch
anything.

**Products → Add product**, three times:

| Name | Price | Currency | Type |
| --- | --- | --- | --- |
| 50 Favour | 3.00 | **AUD** | One-off |
| 200 Favour | 9.00 | **AUD** | One-off |
| 400 Favour | 15.00 | **AUD** | One-off |

Currency is **AUD**, as agreed. It must match `public.favour_bundles.currency`
(`aud`) exactly — the webhook compares them and refuses to credit Favour if
they disagree.

Copy each **Price ID** (`price_...`, *not* the product `prod_...`) and record
them:

```sql
update public.favour_bundles set stripe_price_id = 'price_XXXXXXXX' where bundle_id = 'favour_50';
update public.favour_bundles set stripe_price_id = 'price_YYYYYYYY' where bundle_id = 'favour_200';
update public.favour_bundles set stripe_price_id = 'price_ZZZZZZZZ' where bundle_id = 'favour_400';

-- Confirm all three, and that the amounts still agree with Stripe:
select bundle_id, name, favour_amount, price_minor, currency, stripe_price_id
  from public.favour_bundles order by sort_order;
```

Until a bundle has its Price ID, buying it returns a clean "not switched on
yet" message rather than a broken checkout.

---

## 8. Deploy the checkout function

```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY="sk_test_..." \
  SITE_URL="https://alucasol.github.io/Olympus" \
  --project-ref xwtsqssaahubalgztoby

npx supabase functions deploy stripe-checkout --project-ref xwtsqssaahubalgztoby
```

`sk_test_`, not `sk_live_`. If you paste a live key here, real cards get
charged.

---

## 9. Deploy the webhook and register the endpoint

### What a webhook is, in this system

Everything else on the site works because a *browser* asks Supabase for
something. A webhook is the opposite direction: **Stripe's servers call us**,
unprompted, to say "this payment went through".

That call is the only thing in the entire system that can award Favour. Not the
success page, not the browser, not anything the player can reach — because a
player can type a URL, and a player cannot forge a message from Stripe.

### Deploy the function

```bash
npx supabase functions deploy stripe-webhook \
  --no-verify-jwt --project-ref xwtsqssaahubalgztoby
```

### What `--no-verify-jwt` means, and why it is safe here

By default, Supabase puts a guard in front of every Edge Function: *"reject
anything that does not arrive with a valid Supabase login token."*

Stripe has no idea what a Supabase token is. It is not a user, it has never
logged in, and it never will. So with the default guard in place, **every
payment notification would be rejected at the door**, before a single line of
our code ran, and no player would ever receive the Favour they paid for.

> **All four functions are deployed with this flag**, not just the webhook,
> for two reasons:
>
> 1. **Two of them must be reachable without a login by design.** `signup` is
>    called by someone who does not have an account yet — that is the entire
>    point of it — and `cleanup-unconfirmed` is called by a scheduler. Neither
>    can present a user token.
> 2. **The gateway's check is weaker than the one in the code.** It only
>    inspects the token's signature. `stripe-checkout` calls
>    `supabase.auth.getUser(token)`, which asks the auth server to confirm the
>    token is real, unexpired and not revoked, and returns *which user it
>    belongs to* — which is what the buyer id is then taken from. Leaving the
>    gateway check on as well would add nothing and would break the browser's
>    CORS preflight, which arrives with no `Authorization` header at all.
>
> Every one of the four does its own authentication, and each was checked
> against the live deployment: `stripe-checkout` answers `401` to a missing or
> forged token, `cleanup-unconfirmed` answers `401` without its secret, and
> `signup` refuses a request with no Turnstile token.

`--no-verify-jwt` turns that particular door off. What it does **not** do is
leave the function unauthenticated, because the function does its own, stronger
check instead:

1. Stripe signs every webhook using a secret only Stripe and you know — the
   `whsec_…` signing secret from the next step.
2. `stripe-webhook/index.ts` reads the **raw, unparsed bytes** of the request
   and asks the Stripe library to verify that signature against them.
3. Anything that fails is answered `400 Invalid signature` and **never touches
   the database**.

So the trade is: swap a guard that cannot understand Stripe for one that is
purpose-built to. A forged "I paid, give me 400 Favour" request fails at step 3
— you can prove this yourself, it is check 4 in `tests/stripe/README.md`, and
it should leave zero rows behind.

Two details that make the check hold, both already handled in the code:

- The signature covers the **exact bytes** Stripe sent. Parsing the JSON first
  and re-serialising it would change those bytes and break every signature,
  which is why the function reads `await request.text()` before anything else.
- Without `STRIPE_WEBHOOK_SECRET` set, verification cannot succeed, so the
  function rejects *everything* — including genuine payments. That is the right
  way round to fail, but it does mean the next step is not optional.

### Register the endpoint with Stripe

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **URL**:
  `https://xwtsqssaahubalgztoby.supabase.co/functions/v1/stripe-webhook`
- **Events** — select exactly these eight:

  | Event | Why we listen |
  | --- | --- |
  | `checkout.session.completed` | a card payment cleared — award the Favour |
  | `checkout.session.async_payment_succeeded` | a slow payment method cleared later — award it now |
  | `checkout.session.async_payment_failed` | a slow payment method failed — close the row |
  | `checkout.session.expired` | they never paid — close the row |
  | `charge.refunded` | flag for review; never auto-reverse |
  | `charge.refund.updated` | same |
  | `charge.dispute.created` | chargeback opened — flag for review |
  | `charge.dispute.closed` | chargeback resolved — flag for review |

Selecting more than these is harmless — anything without a handler is recorded
and ignored. Selecting *fewer* is not: miss `checkout.session.completed` and
nobody ever gets their Favour.

### Set the signing secret

After creating the endpoint, Stripe shows a **Signing secret** starting
`whsec_`. Reveal it, copy it, and:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_..." \
  --project-ref xwtsqssaahubalgztoby
```

This secret belongs to *this one endpoint*. Delete and recreate the endpoint
and you get a new one, which must be set again. Live mode has its own, separate
one (step 15).

---

## 9b. Deploy the username-change function

Migration 015 lets a player rename themselves from the account page. The rename
itself is done by `change_username()`, which is service-role only, so the
browser reaches it exclusively through this function — and this function
verifies a Turnstile token first.

**The Turnstile secret needs a second home.** Supabase Auth already holds it
under *Authentication → Attack Protection*, and that copy verifies the CAPTCHA
on sign-up, sign-in and recovery. An Edge Function cannot read it, and Auth
will not verify a token on anything else's behalf, so `change-username` must
carry its own copy and ask Cloudflare directly. Set it in both places, and
rotate it in both places.

```bash
npx supabase secrets set \
  TURNSTILE_SECRET_KEY="0x4AAA..." \
  --project-ref xwtsqssaahubalgztoby

npx supabase functions deploy change-username \
  --no-verify-jwt --use-api --project-ref xwtsqssaahubalgztoby
```

PowerShell equivalent:

```powershell
npx supabase secrets set `
  TURNSTILE_SECRET_KEY="0x4AAA..." `
  --project-ref xwtsqssaahubalgztoby

npx supabase functions deploy change-username `
  --no-verify-jwt --use-api --project-ref xwtsqssaahubalgztoby
```

Run it from the **website** repository root — the one holding
`supabase/functions/` — and keep the `npx`. The CLI is a dev dependency here,
not a global install, so a bare `supabase ...` gives you *"the term 'supabase'
is not recognized"*.

**`--no-verify-jwt` is required, not optional.** With gateway JWT verification
on, the browser's CORS **preflight** — an `OPTIONS` request, which by
specification carries no `Authorization` header — is rejected at the edge
before the function runs, and the real request is never sent. Every existing
function on this project is deployed the same way for the same reason. It does
not weaken anything: `change-username` verifies the caller's token itself with
`userFromRequest()`, which is strictly stronger than the gateway check because
it also resolves *which* user is calling, and that is the id the rename is
applied to.

**`--use-api`** bundles server-side. Without it the CLI wants Docker locally.

If `TURNSTILE_SECRET_KEY` is unset the function refuses **every** request rather
than failing open, so a forgotten secret shows up immediately as "the
verification check did not pass" instead of as a silently disabled protection.

**Switching renaming off**, if it is ever abused. One statement, no deploy:

```sql
update public.username_config set changes_enabled = false where id;
```

Existing names are untouched and new accounts still get the email-prefix
default; only the rename stops. Reverse it by setting the flag back to `true`.
The other knobs on that table are `cooldown_hours` (24), `min_length` (5) and
`max_length` (20).

**Adding a blocked word** — also no deploy. Always insert through
`fold_username`, which puts the term in the form the matcher expects:

```sql
insert into public.username_blocklist (term, kind, note)
values (public.fold_username('whatever'), 'substring', 'why');
```

Use `'exact'` for anything short enough to appear inside an innocent name, and
`'allow'` to exempt a whole name that a substring rule catches unfairly — the
seed already carries Scunthorpe, Cockburn and Cumbria for that reason.

---

## 10. Test the payment path

See `tests/stripe/README.md`. Do that before step 15.

---

## 11. Schedule the unconfirmed-account cleanup

```bash
npx supabase secrets set CLEANUP_SECRET="$(openssl rand -hex 32)" \
  --project-ref xwtsqssaahubalgztoby
npx supabase functions deploy cleanup-unconfirmed --project-ref xwtsqssaahubalgztoby
```

PowerShell equivalent for the secret:

```powershell
$cleanup = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
npx supabase secrets set CLEANUP_SECRET="$cleanup" --project-ref xwtsqssaahubalgztoby
```

Then schedule it. Dashboard → **Integrations → Cron** → **Create job**:

- **Name**: `cleanup-unconfirmed`
- **Schedule**: `0 3 * * *` (daily, 03:00 UTC)
- **Type**: Supabase Edge Function
- **Function**: `cleanup-unconfirmed`
- **Method**: POST

If you would rather do it in SQL (`pg_cron` + `pg_net`, both available on
Supabase):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
    'cleanup-unconfirmed',
    '0 3 * * *',
    $$
    select net.http_post(
        url := 'https://xwtsqssaahubalgztoby.supabase.co/functions/v1/cleanup-unconfirmed',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.cleanup_secret', true)
        )
    );
    $$
);
```

Run it once by hand and read what it says. `CLEANUP_SECRET` is in
`secrets.local`:

```bash
curl -X POST \
  -H "Authorization: Bearer $(grep '^CLEANUP_SECRET=' secrets.local | cut -d= -f2-)" \
  https://xwtsqssaahubalgztoby.supabase.co/functions/v1/cleanup-unconfirmed
# {"ok":true,"scanned":11,"deleted":7,"failed":0,...}
```

It only ever deletes accounts that are both unconfirmed **and** older than 48
hours, and deleting one takes its `player_accounts` row with it.

> **This has NOT been run yet.** There are currently 7 accounts it would
> delete — all created 16 July, all unconfirmed, none with a profile row (they
> predate the trigger in migration 001). They look like abandoned early tests,
> but they are your data, so the decision is yours. Doing nothing means the
> scheduled job removes them at 03:00 UTC.
>
> To see exactly what would go, without deleting anything:
>
> ```sql
> select id, created_at
>   from auth.users
>  where email_confirmed_at is null
>    and confirmed_at is null
>    and created_at < timezone('utc', now()) - interval '48 hours'
>  order by created_at;
> ```
>
> To keep one, confirm it by hand — cleanup then ignores it forever:
>
> ```sql
> update auth.users set email_confirmed_at = now() where id = '…';
> ```
>
> Or pause the job entirely:
>
> ```sql
> select cron.unschedule('cleanup-unconfirmed');
> ```

### How the scheduled job authenticates

The job does not carry the secret in its own definition — anything with
database access can read `cron.job`. It is held encrypted in Supabase Vault
and read at call time:

```sql
-- what is scheduled
select jobid, jobname, schedule, active from cron.job;

-- the last few runs and whether they succeeded
select jobid, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 10;
```

If you ever rotate `CLEANUP_SECRET`, update both places or the job starts
getting 401s:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'cleanup_secret'), 'the-new-value');
```
```bash
npx supabase secrets set CLEANUP_SECRET="the-new-value" --project-ref xwtsqssaahubalgztoby
```

---

## 12. Changing the signup mode

The kill switch. One statement, effective immediately, no deploy:

```sql
-- Close registration. Guest play and the whole public site are unaffected.
select public.set_signup_mode('disabled');

-- Reopen it.
select public.set_signup_mode('public');

-- Require an invitation code.
select public.set_signup_mode('invite_only');

-- See where things stand.
select public.signup_status();
```

The website cannot call any of these — `EXECUTE` is revoked from `anon` and
`authenticated`. It only ever finds out the mode through the signup function,
which returns a bare `{mode, accepting}` and no counts.

---

## 13. Changing the account ceiling

```sql
-- Raise it.
select public.set_maximum_accounts(5000);

-- Lower it. Existing accounts are never deleted; registration simply stops
-- until the count falls below the new figure.
select public.set_maximum_accounts(500);

-- Current figure and how many slots are left.
select public.signup_status();
```

The ceiling counts **all** `auth.users` rows — confirmed, unconfirmed, and
slots reserved by a signup in flight — so it cannot be overshot by two people
registering at the same instant.

---

## 14. Creating an invitation code

```sql
select public.create_signup_invite('for Marcus', 1);
```

Returns something like:

```json
{
  "ok": true,
  "invite_id": "…",
  "code": "K7MPQ-3XRTV-9WNBH-2FDJL",
  "max_uses": 1,
  "note": "Copy this code now. Only its hash is stored; it cannot be shown again."
}
```

**Copy the code immediately.** Only its SHA-256 is stored, so there is no way
to recover it — that is the point. Lost one? Make another and disable the old:

```sql
-- Optional third argument is an expiry.
select public.create_signup_invite('beta wave 2', 25,
                                   timezone('utc', now()) + interval '14 days');

-- What is outstanding (never shows codes, because they are not stored).
select invite_id, label, max_uses, used_count, is_enabled, expires_at, created_at
  from public.signup_invites order by created_at desc;

-- Withdraw one.
update public.signup_invites set is_enabled = false where invite_id = '…';
```

Codes only matter while `signup_mode = 'invite_only'`; in `public` mode they
are ignored, and in `disabled` mode nothing gets through at all.

---

## 15. Going live (NOT YET — needs your explicit decision)

Do not do this until you have run the test-mode checks in
`tests/stripe/README.md` and are satisfied.

1. Stripe → complete account activation (business details, bank account).
2. Turn **Test mode** OFF and create the same three products again — live mode
   has its own separate products and Price IDs.
3. Update `favour_bundles.stripe_price_id` with the **live** Price IDs.
4. Create a **live** webhook endpoint, same URL, same eight events, and take
   its own new signing secret.
5. Replace both secrets:
   ```bash
   supabase secrets set \
     STRIPE_SECRET_KEY="sk_live_..." \
     STRIPE_WEBHOOK_SECRET="whsec_live_..." \
     --project-ref xwtsqssaahubalgztoby
   ```
6. Replace `stripePublishableKey` in `js/config.js` with the live `pk_live_...`.
7. Remove `http://localhost:8080` from `ALLOWED_ORIGINS`.
8. Make one real purchase with a real card, refund it from the dashboard, and
   confirm the refund appears flagged:
   ```sql
   select * from public.favour_purchases_needing_review();
   ```

---

## Reference: every secret, and where it lives

| Name | Where | Never |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | injected into Edge Functions | in the website, in SQL you paste anywhere public |
| `SIGNUP_IP_HMAC_SECRET` | Edge Function secret | anywhere else, ever |
| `STRIPE_SECRET_KEY` | Edge Function secret | the browser |
| `STRIPE_WEBHOOK_SECRET` | Edge Function secret | the browser |
| `CLEANUP_SECRET` | Edge Function secret | the browser |
| Resend API key | Supabase SMTP settings | a repository |
| Turnstile **secret** key | Supabase CAPTCHA settings | the browser |
| Supabase URL + publishable key | `js/config.js` — public on purpose | — |
| Turnstile **site** key | `js/config.js` — public on purpose | — |
| Stripe **publishable** key | `js/config.js` — public on purpose | — |

`node tests/lint.mjs` checks the left column never appears in client code.
