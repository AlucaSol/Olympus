/* ==========================================================================
   SIGNUP — the only door into account creation.

   GET   -> { mode, accepting }        public-safe availability, for the form
   POST  -> { ok } | { ok:false, error, message }

   WHAT HAPPENS ON A POST

     1. Work out the real client IP from the platform headers and reduce it to
        a keyed HMAC. The address itself is never stored or logged.
     2. Ask the database for a signup slot (begin_signup). That single call
        applies the kill switch, the account ceiling, the 24h/30d IP limits and
        the invitation rules, all under an advisory lock.
     3. If a slot is granted, call the ordinary auth.signUp() with the
        publishable key — the same call the browser would have made — so that
        Supabase's own CAPTCHA verification, password policy, duplicate-email
        handling and confirmation email all behave exactly as configured.
     4. The AFTER INSERT trigger on auth.users (migration 013) validates the
        claim id carried in the signup metadata and settles it in the same
        transaction that creates the account. A signup that skipped this
        function has no claim and is refused there.
     5. If Auth refused, release the reservation so the attempt costs the
        visitor nothing.

   WHY THE PASSWORD PASSES THROUGH HERE. It is forwarded to Supabase Auth over
   TLS and never stored, logged or inspected. The alternative — letting the
   browser call Auth directly and gating afterwards — cannot work, because by
   then the account already exists.

   NO ENUMERATION. Every outcome that could distinguish "this email is already
   registered" from "this email is new" returns the same neutral response.
   ========================================================================== */

import { preflight, json, clientIp, hashIp, logEvent } from "../_shared/http.ts";
import { serviceClient, anonClient } from "../_shared/supabase.ts";

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

// Supabase's own minimum is configured in the dashboard; this mirrors the
// default so the visitor is told before a round trip rather than after.
const MIN_PASSWORD_LENGTH = 8;

const FRIENDLY: Record<string, string> = {
  signup_disabled:
    "New accounts are closed at the moment. You can still play the game as a guest — no account needed.",
  account_limit_reached:
    "We have reached our account limit for now. You can still play as a guest while we make more room.",
  ip_rate_limited_daily:
    "That is as many accounts as can be created from this connection today. Please try again tomorrow.",
  ip_rate_limited_monthly:
    "That is as many accounts as can be created from this connection this month. Please try again later.",
  invite_required:
    "Registration is invitation-only right now. Enter your invitation code to continue.",
  invalid_invite:
    "That invitation code is not valid, has expired, or has already been used.",
  invalid_request:
    "We could not process that request. Please refresh the page and try again."
};

Deno.serve(async (request) => {
  const pre = preflight(request);
  if (pre) return pre;

  try {
    if (request.method === "GET") return await availability(request);
    if (request.method === "POST") return await register(request);
    return json(request, { ok: false, error: "method_not_allowed" }, 405);
  } catch (error) {
    // Never echo an internal message to the browser.
    logEvent("signup.unhandled", { message: String(error).slice(0, 200) });
    return json(
      request,
      {
        ok: false,
        error: "temporary_failure",
        message: "Something went wrong on our side. Please try again shortly."
      },
      500
    );
  }
});

async function availability(request: Request): Promise<Response> {
  const { data, error } = await serviceClient().rpc("signup_availability");
  if (error) {
    logEvent("signup.availability_failed", { code: error.code });
    // Fail closed in what we *show*, but say so honestly.
    return json(request, { mode: "unknown", accepting: false }, 200);
  }
  return json(request, data, 200);
}

async function register(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(request, { ok: false, error: "invalid_request", message: FRIENDLY.invalid_request }, 400);
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const username = String(body.username ?? "").trim();
  const inviteCode = body.inviteCode ? String(body.inviteCode).trim() : null;
  const captchaToken = body.captchaToken ? String(body.captchaToken) : undefined;

  /* ---- shape checks, before anything is reserved ---- */

  if (!email || !email.includes("@") || email.length > 254) {
    return json(request, {
      ok: false,
      error: "invalid_email",
      message: "Enter a valid email address."
    }, 400);
  }

  if (!USERNAME_RE.test(username)) {
    return json(request, {
      ok: false,
      error: "invalid_username",
      message: "Choose a username of 3-24 characters, using letters, numbers and underscores only."
    }, 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return json(request, {
      ok: false,
      error: "weak_password",
      message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`
    }, 400);
  }

  /* ---- who is asking ---- */

  const ip = clientIp(request);
  if (!ip) {
    logEvent("signup.no_client_ip", {});
    return json(request, {
      ok: false,
      error: "temporary_failure",
      message: "We could not verify where this request came from. Please try again."
    }, 400);
  }
  const ipHex = await hashIp(ip);

  /* ---- reserve a slot ---- */

  const admin = serviceClient();
  const { data: claim, error: claimError } = await admin.rpc("begin_signup", {
    p_ip_hex: ipHex,
    p_invite_code: inviteCode
  });

  if (claimError) {
    logEvent("signup.begin_failed", { code: claimError.code });
    return json(request, {
      ok: false,
      error: "temporary_failure",
      message: "Registration is temporarily unavailable. Please try again shortly."
    }, 503);
  }

  if (!claim?.ok) {
    const code = String(claim?.error ?? "invalid_request");
    logEvent("signup.refused", { reason: code });
    return json(request, {
      ok: false,
      error: code,
      message: FRIENDLY[code] ?? FRIENDLY.invalid_request,
      retryAfterSeconds: claim?.retry_after_seconds ?? undefined
    }, code.startsWith("ip_rate_limited") ? 429 : 403);
  }

  const claimId = String(claim.claim_id);

  /* ---- ask Auth to create the account ---- */

  const auth = anonClient();
  const redirectTo = Deno.env.get("SIGNUP_CONFIRM_REDIRECT_URL") ?? undefined;

  const { data: signUpData, error: signUpError } = await auth.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectTo,
      captchaToken,
      data: {
        username,
        // Read and settled by the trigger in migration 013. Never reaches the
        // browser: this whole exchange happens server-side.
        signup_claim: claimId
      }
    }
  });

  if (signUpError) {
    await release(admin, claimId, "auth_error");

    const message = (signUpError.message ?? "").toLowerCase();
    const status = signUpError.status ?? 0;

    if (message.includes("captcha")) {
      return json(request, {
        ok: false,
        error: "captcha_failed",
        message: "The human-verification check did not pass. Please try again."
      }, 400);
    }

    if (status === 429 || message.includes("rate limit") || message.includes("too many")) {
      return json(request, {
        ok: false,
        error: "rate_limited",
        message: "Too many attempts just now. Please wait a minute and try again."
      }, 429);
    }

    if (message.includes("password")) {
      return json(request, {
        ok: false,
        error: "weak_password",
        message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`
      }, 400);
    }

    // A duplicate email, a duplicate username, and a refused claim all land
    // here and all say the same thing. Telling the visitor which one it was
    // would tell a stranger whether an address is registered.
    logEvent("signup.auth_refused", { status });
    return json(request, {
      ok: false,
      error: "not_completed",
      message:
        "We could not complete that registration. If you already have an account, " +
        "try signing in or resetting your password instead."
    }, 400);
  }

  // The trigger has already settled the claim inside the same transaction that
  // created the user. This call is a belt-and-braces no-op that also covers a
  // configuration where the requirement is switched off. It returns
  // `claim_not_pending` in the ordinary case, which is exactly right.
  //
  // try/catch rather than .catch(): a PostgrestBuilder is a thenable, not a
  // full Promise, and does not carry .catch().
  try {
    await admin.rpc("complete_signup", {
      p_claim_id: claimId,
      p_user_id: signUpData?.user?.id ?? null
    });
  } catch (error) {
    logEvent("signup.settle_failed", { message: String(error).slice(0, 120) });
  }

  logEvent("signup.created", { confirmed: !!signUpData?.user?.email_confirmed_at });

  return json(request, {
    ok: true,
    message:
      "Account created. Check your email and open the confirmation link before signing in."
  }, 200);
}

async function release(
  admin: ReturnType<typeof serviceClient>,
  claimId: string,
  reason: string
): Promise<void> {
  const { error } = await admin.rpc("abort_signup", { p_claim_id: claimId });
  if (error) logEvent("signup.release_failed", { reason, code: error.code });
}
