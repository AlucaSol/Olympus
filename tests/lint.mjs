/* ==========================================================================
   Cheap static checks over the website's own JavaScript and HTML.

   There is no bundler, no TypeScript and no ESLint in this project by design —
   the site is plain files served as-is. So instead of pulling a toolchain in,
   this walks the source and enforces the handful of rules that actually matter
   here, most of them security rules that no syntax checker would catch:

     - every js/*.js file parses;
     - no privileged secret has been pasted into client code;
     - no page loads a script the repository does not contain;
     - the Edge Functions never log a password or a secret;
     - CORS is never "*" on an authenticated endpoint.

       node tests/lint.mjs
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failed += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* These files are heavily commented, and the comments discuss exactly the
   things the patterns below hunt for — "the service_role key belongs in Edge
   Function secrets", "real-money bundles", "constructEventAsync is given the
   raw body". Scanning the prose would report the documentation as the defect,
   so every content check runs against code with the commentary removed.

   The stripping is deliberately conservative: line comments only when the
   marker starts the line, which is how every comment in this repository is
   written, and never inside a string that happens to contain "//" or "--". */
function stripComments(source, kind) {
  let out = source;
  if (kind === "html") {
    out = out.replace(/<!--[\s\S]*?-->/g, " ");
  } else if (kind === "sql") {
    out = out.replace(/^[ \t]*--.*$/gm, " ")   // whole-line
             .replace(/[ \t]{2,}--.*$/gm, " "); // trailing, after real spacing
  } else {
    out = out.replace(/\/\*[\s\S]*?\*\//g, " ")
             .replace(/^[ \t]*\/\/.*$/gm, " ");
  }
  return out;
}

const code = (p) => {
  const ext = path.extname(p).toLowerCase();
  const kind = ext === ".html" ? "html" : ext === ".sql" ? "sql" : "js";
  return stripComments(read(p), kind);
};

const listing = (dir, ext) =>
  fs.existsSync(path.join(ROOT, dir))
    ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext))
    : [];

/* ---------------- 1. every site script parses ---------------- */
console.log("\nSyntax");
for (const file of listing("js", ".js")) {
  const rel = `js/${file}`;
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], { stdio: "pipe" });
    check(`${rel} parses`, true);
  } catch (err) {
    check(`${rel} parses`, false, String(err.stderr ?? err).split("\n")[0]);
  }
}

/* ---------------- 2. no privileged secrets in client code ----------------
   The publishable Supabase key, the Turnstile *site* key and the Stripe
   *publishable* key are all meant to be here. Anything else is not.        */
console.log("\nClient-side secrets");
{
  const forbidden = [
    [/\bsb_secret_/, "Supabase secret key"],
    [/\bservice_role\b/, "service_role"],
    [/\bsk_live_|\bsk_test_/, "Stripe secret key"],
    [/\bwhsec_/, "Stripe webhook signing secret"],
    [/\brk_live_|\brk_test_/, "Stripe restricted key"],
    [/\bre_[A-Za-z0-9]{20,}/, "Resend API key"],
    [/SIGNUP_IP_HMAC_SECRET\s*[:=]\s*["'][^"']+["']/, "IP HMAC secret value"],
    [/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/, "service-role key value"]
  ];

  const clientFiles = [
    ...listing("js", ".js").map((f) => `js/${f}`),
    ...fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"))
  ].filter((f) => !f.startsWith("js/vendor/"));

  for (const [pattern, label] of forbidden) {
    const hits = clientFiles.filter((f) => pattern.test(code(f)));
    check(`no ${label} in client code`, hits.length === 0, hits.join(", "));
  }

  check(
    "the publishable Supabase key is where it is supposed to be",
    /sb_publishable_/.test(read("js/config.js"))
  );
}

/* ---------------- 3. every referenced script exists ---------------- */
console.log("\nScript references");
{
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const missing = [];
  for (const page of pages) {
    const html = read(page);
    for (const m of html.matchAll(/<script src="\.\/([^"]+)"/g)) {
      if (!fs.existsSync(path.join(ROOT, m[1]))) missing.push(`${page} -> ${m[1]}`);
    }
    for (const m of html.matchAll(/<link[^>]+href="\.\/([^"]+\.css)"/g)) {
      if (!fs.existsSync(path.join(ROOT, m[1]))) missing.push(`${page} -> ${m[1]}`);
    }
  }
  check("every page's scripts and stylesheets exist", missing.length === 0, missing.join(", "));

  // Load order matters: auth.js needs config.js and the vendor bundle first.
  const bad = [];
  for (const page of pages) {
    const html = read(page);
    if (!html.includes("js/auth.js")) continue;
    const iConfig = html.indexOf("js/config.js");
    const iVendor = html.indexOf("js/vendor/supabase-js");
    const iAuth = html.indexOf("js/auth.js");
    if (!(iConfig > -1 && iVendor > iConfig && iAuth > iVendor)) bad.push(page);
  }
  check("auth.js is always loaded after config.js and the Supabase bundle", bad.length === 0, bad.join(", "));
}

/* ---------------- 4. nav consistency ---------------- */
console.log("\nNavigation");
{
  const pages = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith(".html") && f !== "index.html");
  const noAccount = pages.filter((p) => !read(p).includes("data-nav-account"));
  check("every page with a nav has an Account button", noAccount.length === 0, noAccount.join(", "));

  // The nav's old markup specifically — login.html's own submit button is
  // allowed to say "Login", because that is the action it performs.
  const stillLogin = pages.filter((p) => /nav-login-btn|class="nav-login"/.test(code(p)));
  check("no page still shows the old Login nav button", stillLogin.length === 0, stillLogin.join(", "));

  const comingSoon = pages.filter((p) => /coming soon/i.test(code(p)));
  check("no page still says 'coming soon'", comingSoon.length === 0, comingSoon.join(", "));

  const noEmporion = pages.filter((p) => !read(p).includes('href="emporion.html"'));
  check("every page links to the Emporion", noEmporion.length === 0, noEmporion.join(", "));
}

/* ---------------- 5. Emporion copy ---------------- */
console.log("\nEmporion");
{
  const js = read("js/emporion.js");
  const jsCode = code("js/emporion.js");
  check('the sign-in prompt is exactly "Sign in to Purchase"',
    js.includes('"Sign in to Purchase"') && !/Sign in to purchase\s*—\s*coming soon/i.test(js));
  check("the purchase confirmation says Favour, not Tribute",
    /wish to purchase/.test(js) && /" Favour\?"/.test(js));
  check("Favour is the first category", /\{ id: "favour"/.test(js.split("var CATALOGUE")[0]));
  check("all three bundles are present",
    ["favour_50", "favour_200", "favour_400"].every((id) => js.includes(id)));
  check("the client never names a Favour price to the server",
    !/favourAmount:\s*\w+\s*,?\s*\}\s*\)/.test(js) && !js.includes("priceMinor: item.priceMinor"));

  for (const id of ["favour-bundle-50", "favour-bundle-200", "favour-bundle-400"]) {
    check(`${id}.png exists`, fs.existsSync(path.join(ROOT, "assets/emporion/ui", `${id}.png`)));
  }
}

/* ---------------- 6. Edge Functions ---------------- */
console.log("\nEdge Functions");
{
  const dir = path.join(ROOT, "supabase/functions");
  if (!fs.existsSync(dir)) {
    check("supabase/functions exists", false);
  } else {
    const files = [];
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    })(dir);

    check("every expected function is present",
      ["signup", "stripe-checkout", "stripe-webhook", "cleanup-unconfirmed"]
        .every((n) => fs.existsSync(path.join(dir, n, "index.ts"))));

    const loggingSecrets = files.filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return /console\.(log|error|warn)\([^)]*\b(password|secret|token|apiKey)\b/i.test(src);
    });
    check("no function logs a password, secret or token",
      loggingSecrets.length === 0, loggingSecrets.map((f) => path.basename(path.dirname(f))).join(", "));

    const cors = stripComments(fs.readFileSync(path.join(dir, "_shared/http.ts"), "utf8"), "js");
    check('CORS never uses "*"', !/Access-Control-Allow-Origin"\s*:\s*"\*"/.test(cors));
    check("CORS uses an allow-list", /allowedOrigins\(\)\.includes\(origin\)/.test(cors));

    const webhook = stripComments(fs.readFileSync(path.join(dir, "stripe-webhook/index.ts"), "utf8"), "js");
    check("the webhook verifies signatures against the raw body",
      /constructEventAsync\(\s*\n?\s*rawBody/.test(webhook) && /await request\.text\(\)/.test(webhook));
    check("the webhook never parses the body before verifying",
      webhook.indexOf("await request.text()") < webhook.indexOf("constructEventAsync"));

    const checkout = stripComments(fs.readFileSync(path.join(dir, "stripe-checkout/index.ts"), "utf8"), "js");
    check("checkout derives the buyer from the verified token",
      /userFromRequest\(request\)/.test(checkout) && !/body\.userId|body\.user_id/.test(checkout));
    check("checkout never reads a price from the request body",
      !/body\.(price|amount|favour|currency|quantity)/i.test(checkout));
  }
}

/* ---------------- 7. migrations ---------------- */
console.log("\nMigrations");
{
  const migrations = listing("migrations", ".sql");
  const added = ["010_website_signup_controls.sql", "011_favour_bundles_stripe.sql",
                 "012_website_item_purchase.sql", "013_signup_claim_enforcement.sql",
                 "015_username_changes.sql", "016_username_claim_merge.sql"];
  check("every new migration is present", added.every((m) => migrations.includes(m)));
  check("every new migration has a rollback",
    added.every((m) => fs.existsSync(path.join(
      ROOT, "migrations/rollback", m.replace(/\.sql$/, "_down.sql")))));

  // The invariant is "no SECURITY DEFINER function is left without a pinned
  // search_path", so pins must not be OUTNUMBERED by definers. It is not an
  // equality: pinning an ordinary function too is free hygiene, and 015 does
  // exactly that for the two helpers its definers call.
  for (const m of added) {
    const sql = code(`migrations/${m}`);
    const definers = sql.match(/security definer/gi)?.length ?? 0;
    const paths = sql.match(/set search_path = ''/g)?.length ?? 0;
    check(`${m}: every security-definer function pins search_path`,
      paths >= definers, `${definers} definer vs ${paths} search_path`);
  }

  /* ---- functions that more than one migration replaces ----
     `create or replace function` REPLACES; it does not merge. When two
     migrations own different halves of one function, the later one has to
     carry the earlier one's body forward or it deletes it — silently, with no
     error at apply time and no symptom until somebody exercises the half that
     vanished.

     This is not hypothetical. 013 put the signup-claim enforcement inside
     handle_new_auth_user() rather than in a trigger of its own; the first cut
     of 015 replaced that function to change how usernames are derived and
     dropped the gate with it, leaving the kill switch, the account ceiling and
     the per-IP limits unenforced on a live project. 016 is the hotfix.

     So: for every function defined by more than one migration, the LAST
     definition must still contain the sentinel behaviours of the earlier ones. */
  const SENTINELS = {
    // "name/arity" -> strings its final definition must still contain
    "handle_new_auth_user/0": [
      "signup_not_authorised",   // 013's enforcement
      "signup_claims",           // 013's claim settlement
      "username_rejection"       // 015's naming rules
    ],
    // 013 widened 010's version; the diff is additions only, but the fields
    // 010 promised still have to be in the payload.
    "signup_status/0": ["signup_mode", "maximum_accounts"]
  };

  /* Overloads are NOT replacements — public.f(text) and public.f(text, uuid)
     are two different functions to Postgres, and 002/012's purchase_shop_item
     is exactly that pair. Keying by name alone would flag them and train
     everyone to ignore this check, so the arity is part of the key. */
  function arityAt(sql, openParen) {
    let depth = 0, commas = 0, seen = false;
    for (let i = openParen; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) return seen ? commas + 1 : 0; }
      else if (depth === 1) {
        if (ch === ",") commas++;
        if (!/\s/.test(ch)) seen = true;
      }
    }
    return seen ? commas + 1 : 0;
  }

  const allMigrations = listing("migrations", ".sql").sort();
  const definedIn = new Map();
  for (const m of allMigrations) {
    const sql = code(`migrations/${m}`);
    for (const match of sql.matchAll(
      /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)) {
      const key = `${match[1]}/${arityAt(sql, sql.indexOf("(", match.index + match[0].length - 1))}`;
      if (!definedIn.has(key)) definedIn.set(key, []);
      definedIn.get(key).push(m);
    }
  }

  for (const [key, files] of definedIn) {
    if (files.length < 2) continue;
    const name = key.split("/")[0];
    const last = files[files.length - 1];
    const body = code(`migrations/${last}`);
    const sentinels = SENTINELS[key];

    // A function replaced by several migrations and NOT listed above is not
    // necessarily wrong, but nobody has said what it must keep — which is
    // exactly the state 015 shipped in. Make that visible rather than silent.
    check(`${name}: redefined by ${files.length} migrations, and the last one is accounted for`,
      Array.isArray(sentinels),
      `defined in ${files.join(", ")} — add its must-keep behaviours to SENTINELS in tests/lint.mjs`);

    for (const token of sentinels ?? []) {
      check(`${name}: ${last} still carries "${token}" from an earlier migration`,
        body.includes(token),
        `${last} replaces public.${name}() but drops "${token}" — see 016`);
    }
  }

  const stripeSql = code("migrations/011_favour_bundles_stripe.sql");
  check("stripe_price_id is withheld from the public grant",
    /grant select \(\s*[^)]*\)\s*on public\.favour_bundles/s.test(stripeSql) &&
    !/grant select \([^)]*stripe_price_id/s.test(stripeSql));
  // Money must never be a float. Matched as a column *declaration* rather than
  // a bare word, so prose like "Real-money bundles" in a COMMENT ON does not
  // read as a floating-point column.
  const floatColumn = /^\s+\w+\s+(numeric|decimal|float4|float8|real|double\s+precision)\b/mi;
  check("Favour bundles are priced in integer minor units",
    /price_minor integer not null/.test(stripeSql) &&
    /favour_amount bigint not null/.test(stripeSql) &&
    !floatColumn.test(stripeSql),
    floatColumn.exec(stripeSql)?.[0]?.trim());
  check("bundle prices are the agreed AUD figures",
    /300, 'aud'/.test(stripeSql) && /900, 'aud'/.test(stripeSql) && /1500, 'aud'/.test(stripeSql));
  check("Favour bundles are NOT added to the game's shop_items",
    !/insert into public\.shop_items/i.test(stripeSql));
  check("the game's shop_category enum is left alone",
    !/alter type public\.shop_category/i.test(stripeSql));

  const itemSql = code("migrations/012_website_item_purchase.sql");
  check("the game's one-argument purchase_shop_item is not redefined",
    !/create or replace function public\.purchase_shop_item\(\s*p_item_id text\s*\)/.test(itemSql));
}

/* ---------------- 8. no secrets in the repo's example env ---------------- */
console.log("\nConfiguration");
{
  if (fs.existsSync(path.join(ROOT, ".env.example"))) {
    const example = read(".env.example");
    const withValues = example
      .split("\n")
      .filter((l) => /^[A-Z0-9_]+=.+$/.test(l.trim()) && !/^#/.test(l.trim()));
    check(".env.example lists names only, never values", withValues.length === 0,
      withValues.join(", "));
  } else {
    check(".env.example exists", false);
  }

  const gitignore = fs.existsSync(path.join(ROOT, ".gitignore")) ? read(".gitignore") : "";
  check(".gitignore covers local env files", /\.env/.test(gitignore));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
