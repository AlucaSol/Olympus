/* ==========================================================================
   TRIARCHS OF OLYMPUS — website UI verification
   --------------------------------------------------------------------------
   Drives the real pages in a real browser against a mocked Supabase, so the
   authentication-dependent behaviour can be checked without a live project or
   a real account.

   WHAT THIS CAN AND CANNOT PROVE. It proves the *client* behaves: what is
   shown to a signed-out visitor, what a signed-in one sees, that the purchase
   call carries an idempotency key and no price, that the balance is never
   carried across an identity change. It cannot prove the server is safe —
   nothing running in a browser can. The server-side guarantees (atomic debits,
   the account ceiling, webhook idempotency, forged signatures) are exercised
   by tests/sql/*.sql and tests/stripe/README.md against a real project.

       node tests/ui/run.mjs

   Requires playwright-core and a Chromium install; skips with a clear message
   if either is missing.
   ========================================================================== */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 8123;
const SUPABASE_HOST = "https://xwtsqssaahubalgztoby.supabase.co";
const PROJECT_REF = "xwtsqssaahubalgztoby";

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf",
  ".jpg": "image/jpeg", ".webp": "image/webp"
};

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("playwright-core is not installed. Run: npm install");
  process.exit(2);
}

/* ---------------- results ---------------- */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(name) { console.log(`\n${name}`); }

/* ---------------- static server ---------------- */

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

/* ---------------- fake session ----------------
   supabase-js reads its session from localStorage under this key and, if the
   expiry is still in the future, uses it without a network round trip. That
   is enough to exercise every signed-in path in the UI.                     */

function fakeSession(userId, email) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  // A structurally valid JWT. Never verified locally — supabase-js only reads
  // the expiry — and the mocked REST layer stands in for the real check.
  const payload = Buffer.from(JSON.stringify({
    sub: userId, email, role: "authenticated", exp: expires
  })).toString("base64url");
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.signature`;
  return {
    access_token: token,
    refresh_token: "fake-refresh",
    expires_at: expires,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: userId, email, aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString()
    }
  };
}

/* ---------------- Supabase mock ---------------- */

function makeMock(state) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const respond = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*", ...headers },
        body: JSON.stringify(body)
      });

    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*"
        }
      });
    }

    if (p.endsWith("/rest/v1/player_accounts")) {
      state.calls.push({ kind: "account" });
      if (state.accountError) return respond({ message: "boom" }, 500);
      return respond({ username: state.username, favour: state.favour });
    }

    if (p.endsWith("/rest/v1/player_purchases")) {
      return respond(state.owned.map((id) => ({ item_id: id })));
    }

    if (p.endsWith("/rest/v1/rpc/purchase_shop_item")) {
      const body = route.request().postDataJSON() ?? {};
      state.calls.push({ kind: "purchase", body });
      const reply = state.purchaseReply(body);
      if (reply.ok && typeof reply.favour === "number") state.favour = reply.favour;
      if (reply.ok) state.owned.push(body.p_item_id);
      return respond(reply);
    }

    if (p.includes("/functions/v1/stripe-checkout")) {
      const body = route.request().postDataJSON() ?? {};
      state.calls.push({
        kind: "checkout",
        body,
        authorization: route.request().headers()["authorization"] ?? null
      });
      return respond(state.checkoutReply ?? { ok: true, url: `http://localhost:${PORT}/tests/ui/fake-stripe.html` });
    }

    if (p.includes("/functions/v1/signup")) {
      return respond(state.signupReply ?? { mode: "public", accepting: true });
    }

    if (p.includes("/auth/v1/")) {
      return respond({}, 200);
    }

    return respond({}, 200);
  };
}

async function openPage(browser, page, { session, state, viewport } = {}) {
  const ctx = await browser.newContext({ viewport: viewport ?? { width: 1440, height: 1000 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e.message)));

  if (state) await pg.route(`${SUPABASE_HOST}/**`, makeMock(state));

  if (session) {
    await pg.addInitScript(
      ([ref, s]) => {
        window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
      },
      [PROJECT_REF, session]
    );
  }

  await pg.goto(`http://localhost:${PORT}/${page}`, { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(900);
  return { ctx, pg, errors };
}

function baseState(overrides = {}) {
  return {
    username: "lykaon",
    favour: 500,
    owned: [],
    calls: [],
    accountError: false,
    purchaseReply: () => ({ ok: true, favour: 300, item_id: "brontes", duplicate: false }),
    ...overrides
  };
}

/* ================= the checks ================= */

const browser = await chromium.launch();

try {
  /* ---------------------------------------------------------------- */
  group("Signed out");
  {
    const { ctx, pg, errors } = await openPage(browser, "emporion.html", { state: baseState() });

    check("no page errors", errors.length === 0, errors.join("; "));
    check(
      "balance shows exactly 0",
      (await pg.textContent("#emporion-balance-value")).trim() === "0"
    );
    check("refresh button is hidden", await pg.isHidden("#emporion-balance-refresh"));

    const cats = await pg.$$eval(".filter-card", (n) => n.map((e) => e.dataset.cat));
    check("Favour is the first category", cats[0] === "favour", cats.join(","));

    const pressed = await pg.$$eval('.filter-card[aria-pressed="true"]', (n) => n.length);
    check("Favour is NOT preselected when signed out", pressed === 0);

    const groups = await pg.$$eval(".shelf-group-title", (n) => n.map((e) => e.textContent.trim()));
    check("Favour group renders before every other", groups[0] === "Favour", groups.join(">"));

    await pg.click('.shop-tile[data-id="brontes"]');
    await pg.waitForTimeout(150);
    const itemText = (await pg.textContent(".detail-signin-text")).trim();
    check('ordinary item says exactly "Sign in to Purchase"', itemText === "Sign in to Purchase", itemText);
    check("no purchase button is offered", (await pg.$$(".detail-purchase")).length === 0);
    check(
      "sign-in prompt links to the login page",
      (await pg.getAttribute(".detail-signin a", "href")).startsWith("login.html")
    );
    check(
      "item description is still shown",
      (await pg.textContent(".detail-desc")).includes("Cyclopes")
    );

    await pg.click('.shop-tile[data-id="favour_200"]');
    await pg.waitForTimeout(150);
    const bundleText = (await pg.textContent(".detail-signin-text")).trim();
    check(
      "Favour bundle explains an account is required",
      /account/i.test(bundleText) && /sign in/i.test(bundleText),
      bundleText
    );
    check("no checkout is started for a signed-out visitor",
      baseState().calls.filter((c) => c.kind === "checkout").length === 0);

    const price = (await pg.textContent(".detail-price")).trim();
    check("bundle price is unambiguous about currency", price.startsWith("A$"), price);

    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Signed in");
  {
    const state = baseState({ favour: 500, owned: ["kyra_ultimate"] });
    const { ctx, pg, errors } = await openPage(browser, "emporion.html", {
      session: fakeSession("11111111-1111-4111-8111-111111111111", "player@example.com"),
      state
    });

    check("no page errors", errors.length === 0, errors.join("; "));
    check(
      "balance is the authoritative figure from the database",
      (await pg.textContent("#emporion-balance-value")).trim() === "500"
    );
    check("refresh button is offered", await pg.isVisible("#emporion-balance-refresh"));

    const pressed = await pg.$$eval('.filter-card[aria-pressed="true"]', (n) => n.map((e) => e.dataset.cat));
    check("Favour IS preselected when signed in", pressed.length === 1 && pressed[0] === "favour", pressed.join(","));

    // Manual change must survive: switch filters, then force a same-identity
    // auth event, and confirm the choice is not stomped.
    await pg.click('.filter-card[data-cat="boons"]');
    await pg.waitForTimeout(100);
    const afterManual = await pg.$$eval('.filter-card[aria-pressed="true"]', (n) => n.map((e) => e.dataset.cat));
    await pg.evaluate(() => window.dispatchEvent(new Event("focus")));
    await pg.waitForTimeout(200);
    const afterEvent = await pg.$$eval('.filter-card[aria-pressed="true"]', (n) => n.map((e) => e.dataset.cat));
    check(
      "a manual filter choice is not reset during the session",
      JSON.stringify(afterManual) === JSON.stringify(afterEvent),
      `${afterManual} vs ${afterEvent}`
    );

    await pg.click("#filter-clear");
    await pg.waitForTimeout(150);

    check(
      "owned stock is greyed and marked OWNED",
      (await pg.$$('.shop-tile[data-id="kyra_ultimate"].is-owned')).length === 1
    );

    await pg.click('.shop-tile[data-id="kyra_ultimate"]');
    await pg.waitForTimeout(150);
    check(
      "owned item offers no purchase button",
      (await pg.$$(".detail-purchase")).length === 0 &&
      (await pg.textContent(".detail-owned")).includes("Already yours")
    );

    /* ---- purchase confirmation wording ---- */
    let confirmText = null;
    pg.on("dialog", async (d) => { confirmText = d.message(); await d.accept(); });

    await pg.click('.shop-tile[data-id="brontes"]');
    await pg.waitForTimeout(150);
    check("signed-in visitor gets a Purchase button", (await pg.$$(".detail-purchase")).length === 1);

    await pg.click(".detail-purchase");
    await pg.waitForTimeout(700);

    check(
      "confirmation names the item and its Favour cost",
      confirmText === "Are you sure you wish to purchase Brontes for 200 Favour?",
      String(confirmText)
    );
    check("confirmation says Favour, never Tribute", !/tribute/i.test(confirmText ?? ""));

    const purchase = state.calls.find((c) => c.kind === "purchase");
    check("purchase sends the item id", purchase?.body?.p_item_id === "brontes");
    check("purchase sends an idempotency key", /^[0-9a-f-]{36}$/i.test(purchase?.body?.p_request_id ?? ""));
    check(
      "purchase sends NO price, quantity or user id",
      purchase && Object.keys(purchase.body).length === 2,
      JSON.stringify(purchase?.body)
    );
    check(
      "balance repaints from the server response",
      (await pg.textContent("#emporion-balance-value")).trim() === "300"
    );
    check(
      "the store reloads the authoritative balance afterwards",
      state.calls.filter((c) => c.kind === "account").length >= 2
    );

    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Signed in — refused purchases");
  {
    for (const [label, reply, expected] of [
      ["insufficient Favour", { ok: false, error: "insufficient_favour", favour: 10 }, /not have enough favour/i],
      ["already owned", { ok: false, error: "already_owned", favour: 500 }, /already own/i],
      ["item unavailable", { ok: false, error: "item_unavailable" }, /no longer available/i],
      ["expired session", { ok: false, error: "not_authenticated" }, /session has expired/i],
      ["retried request", { ok: true, favour: 300, duplicate: true }, /already gone through/i]
    ]) {
      const state = baseState({ purchaseReply: () => reply });
      const { ctx, pg } = await openPage(browser, "emporion.html", {
        session: fakeSession("11111111-1111-4111-8111-111111111111", "p@example.com"),
        state
      });
      pg.on("dialog", (d) => d.accept());
      await pg.click("#filter-clear").catch(() => {});
      await pg.waitForTimeout(100);
      await pg.click('.shop-tile[data-id="brontes"]');
      await pg.waitForTimeout(120);
      await pg.click(".detail-purchase");
      await pg.waitForTimeout(600);
      const notice = (await pg.textContent("#emporion-notice")) ?? "";
      check(`${label} produces a clear message`, expected.test(notice), notice.trim());
      await ctx.close();
    }
  }

  /* ---------------------------------------------------------------- */
  group("Signed in — Stripe checkout");
  {
    const state = baseState({ checkoutReply: { ok: true, url: "http://localhost:9/checkout" } });
    const { ctx, pg } = await openPage(browser, "emporion.html", {
      session: fakeSession("22222222-2222-4222-8222-222222222222", "buyer@example.com"),
      state
    });

    await pg.click('.shop-tile[data-id="favour_400"]');
    await pg.waitForTimeout(150);
    check("bundle offers a card-payment button", (await pg.$$(".detail-purchase")).length === 1);

    await pg.click(".detail-purchase").catch(() => {});
    await pg.waitForTimeout(800);

    const checkout = state.calls.find((c) => c.kind === "checkout");
    check("checkout sends the bundle id", checkout?.body?.bundleId === "favour_400");
    check("checkout sends an idempotency key", /^[0-9a-f-]{36}$/i.test(checkout?.body?.requestId ?? ""));
    check(
      "checkout sends NO price, currency, Favour amount or user id",
      checkout && Object.keys(checkout.body).length === 2,
      JSON.stringify(checkout?.body)
    );
    check("checkout carries the access token", (checkout?.authorization ?? "").startsWith("Bearer "));

    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Success page awards nothing");
  {
    const state = baseState({ favour: 120 });
    const { ctx, pg } = await openPage(browser, "emporion.html?payment=success", {
      session: fakeSession("33333333-3333-4333-8333-333333333333", "s@example.com"),
      state
    });
    await pg.waitForTimeout(1600);
    check(
      "visiting ?payment=success does not change the balance",
      (await pg.textContent("#emporion-balance-value")).trim() === "120"
    );
    check(
      "no purchase or grant call is made by the success page",
      state.calls.every((c) => c.kind === "account" || c.kind === "checkout")
    );
    check(
      "the visitor is told the balance may take a moment",
      /moment|being added/i.test((await pg.textContent("#emporion-notice")) ?? "")
    );
    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Identity changes and failures");
  {
    // A failed balance read must not fall back to a remembered figure.
    const state = baseState({ accountError: true });
    const { ctx, pg } = await openPage(browser, "emporion.html", {
      session: fakeSession("44444444-4444-4444-8444-444444444444", "x@example.com"),
      state
    });
    const shown = (await pg.textContent("#emporion-balance-value")).trim();
    check("a failed balance read shows no number at all", shown === "…" || shown === "0", shown);

    // Signing out must clear it to a plain zero, not the previous balance.
    await pg.evaluate(() => window.TriarchsAuth.client.auth.signOut().catch(() => {}));
    await pg.waitForTimeout(600);
    check(
      "signing out returns the balance to 0",
      (await pg.textContent("#emporion-balance-value")).trim() === "0"
    );
    check("refresh button hides again on sign out", await pg.isHidden("#emporion-balance-refresh"));
    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Account nav reflects the real session");
  {
    for (const [label, session, expected] of [
      ["signed out -> login page", null, "login.html"],
      ["signed in -> account page", fakeSession("55555555-5555-4555-8555-555555555555", "n@example.com"), "account.html"]
    ]) {
      const { ctx, pg } = await openPage(browser, "home.html", { session, state: baseState() });
      const href = await pg.getAttribute("[data-nav-account]", "href");
      check(`Account button ${label}`, href === expected, href);
      const label2 = (await pg.textContent("[data-nav-account]")).trim();
      check("Account button is labelled Account", label2 === "Account", label2);
      await ctx.close();
    }

    // A username in localStorage must not be mistaken for being signed in.
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    await pg.addInitScript(() => {
      window.localStorage.setItem("username", "lykaon");
      window.localStorage.setItem("loggedIn", "true");
      window.localStorage.setItem("email", "someone@example.com");
    });
    await pg.route(`${SUPABASE_HOST}/**`, makeMock(baseState()));
    await pg.goto(`http://localhost:${PORT}/home.html`, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(700);
    check(
      "a forged localStorage 'login' does not sign anyone in",
      (await pg.getAttribute("[data-nav-account]", "href")) === "login.html"
    );
    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Password form validation");
  {
    const { ctx, pg } = await openPage(browser, "account.html", {
      session: fakeSession("66666666-6666-4666-8666-666666666666", "pw@example.com"),
      state: baseState()
    });

    check("email is shown", (await pg.textContent("#account-email")).includes("pw@example.com"));
    check("email field is not editable", (await pg.$$("input#account-email")).length === 0);
    check("new password is a password input",
      (await pg.getAttribute("#new-password", "type")) === "password");
    check("confirm password is a password input",
      (await pg.getAttribute("#new-password-confirm", "type")) === "password");

    await pg.fill("#new-password", "correct-horse");
    await pg.fill("#new-password-confirm", "different-horse");
    await pg.click("#password-submit");
    await pg.waitForTimeout(250);
    check(
      "mismatched passwords are refused before any request",
      /do not match/i.test(await pg.textContent("#password-status"))
    );

    await pg.fill("#new-password", "short");
    await pg.fill("#new-password-confirm", "short");
    await pg.click("#password-submit");
    await pg.waitForTimeout(250);
    check(
      "a too-short password is refused",
      /at least 8/i.test(await pg.textContent("#password-status"))
    );

    const stored = await pg.evaluate(() => JSON.stringify(window.localStorage));
    check("no password is written to localStorage", !stored.includes("correct-horse") && !stored.includes("short"));

    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Signup form");
  {
    const { ctx, pg } = await openPage(browser, "signup.html", {
      state: baseState({ signupReply: { mode: "public", accepting: true } })
    });
    check("username field is present", (await pg.$$("#signup-username")).length === 1);
    check("confirm password field is present", (await pg.$$("#signup-password-confirm")).length === 1);
    check("invite field is hidden in public mode", await pg.isHidden("#signup-invite-field"));

    await pg.fill("#signup-username", "ok_name");
    await pg.fill("#signup-email", "a@b.com");
    await pg.fill("#signup-password", "longenough1");
    await pg.fill("#signup-password-confirm", "different1");
    await pg.click("#signup-submit");
    await pg.waitForTimeout(250);
    check("mismatched passwords are refused",
      /do not match/i.test(await pg.textContent("#signup-status")));

    await pg.fill("#signup-username", "no");
    await pg.fill("#signup-password-confirm", "longenough1");
    await pg.click("#signup-submit");
    await pg.waitForTimeout(250);
    check("a bad username is refused",
      /3-24 characters/i.test(await pg.textContent("#signup-status")));
    await ctx.close();
  }

  {
    const { ctx, pg } = await openPage(browser, "signup.html", {
      state: baseState({ signupReply: { mode: "invite_only", accepting: true } })
    });
    check("invite field appears in invite_only mode", await pg.isVisible("#signup-invite-field"));
    await ctx.close();
  }

  {
    const { ctx, pg } = await openPage(browser, "signup.html", {
      state: baseState({ signupReply: { mode: "disabled", accepting: false } })
    });
    check("the form is withdrawn when signup is disabled", await pg.isHidden("#signup-form"));
    const msg = await pg.textContent("#signup-status");
    check("guest play is still offered when signup is disabled", /guest/i.test(msg), msg.trim());
    await ctx.close();
  }

  /* ---------------------------------------------------------------- */
  group("Responsive layout");
  {
    for (const [label, width] of [["desktop", 1440], ["laptop", 1100], ["tablet", 820], ["mobile", 390]]) {
      const { ctx, pg } = await openPage(browser, "emporion.html", {
        session: fakeSession("77777777-7777-4777-8777-777777777777", "r@example.com"),
        state: baseState(),
        viewport: { width, height: 1000 }
      });
      const overflows = await pg.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(`${label} (${width}px) does not scroll horizontally`, !overflows);

      const navHeight = await pg.$eval(".nav-bar", (n) => Math.round(n.getBoundingClientRect().height));
      check(`${label} (${width}px) keeps the nav on one row`, navHeight < 100, `${navHeight}px`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
