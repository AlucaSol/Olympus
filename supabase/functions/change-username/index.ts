/* ==========================================================================
   CHANGE-USERNAME — the only door to renaming an account.

   POST -> { ok: true, username, cooldownUntil }
        |  { ok: false, error, message, cooldownUntil? }

   WHY THIS EXISTS AT ALL. player_accounts has no UPDATE policy for
   `authenticated` and migration 015 does not add one, so a rename cannot be
   done from the browser against PostgREST. It has to pass through here, and
   here is the only place that holds the Turnstile secret. Those two facts are
   the same decision: the gate is only a gate because there is no way around it.

   WHAT A POST DOES

     1. Identify the caller from their access token, via Supabase. A user id in
        the body is never read — the rename applies to whoever the token says
        is calling, and to nobody else.
     2. Verify the Turnstile token with Cloudflare, using the secret held in
        this function's environment. A failure here costs no database work.
     3. Shape-check the name locally, so an obviously bad one is refused
        without a database round trip.
     4. Hand the rest to change_username() with the service key. THAT is the
        authority: the kill switch, the 24-hour cooldown, the blocklist and the
        case-insensitive unique index all live there, and this function does
        not second-guess any of them.

   ON THE ORDER OF 2 AND 3. Turnstile first, deliberately. Validating first
   would turn this endpoint into a free username-rule oracle that anyone could
   hammer without solving a challenge, which is exactly the traffic the
   Turnstile is here to stop.

   NO ENUMERATION CONCERNS HERE, unlike signup. Whether a username is taken is
   public information — you can see it on a scoreboard — so "taken" is
   reported plainly rather than blurred into a neutral answer.
   ========================================================================== */

import { preflight, json, logEvent } from "../_shared/http.ts";
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";

const TURNSTILE_VERIFY =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Mirrors migration 015. Kept loose on purpose: the length and character rules
// are checked properly by the database, and anything this refuses is something
// the database would refuse too. The point is only to skip the round trip.
const USERNAME_RE = /^[A-Za-z0-9_-]{5,20}$/;

const FRIENDLY: Record<string, string> = {
  invalid_request:
    "We could not process that request. Please refresh the page and try again.",
  captcha_required:
    "Complete the verification check before changing your username.",
  captcha_failed:
    "The verification check did not pass. Please try it again.",
  not_signed_in:
    "Your session has expired. Sign in again and retry.",
  no_account:
    "We could not find your account. Sign in again and retry.",
  changes_disabled:
    "Username changes are switched off at the moment.",
  cooldown:
    "You have already changed your username recently.",
  unchanged:
    "That is already your username.",
  taken:
    "That username is already taken.",
  too_short:
    "Usernames need at least 5 characters.",
  too_long:
    "Usernames can be at most 20 characters.",
  invalid_characters:
    "Usernames can use letters, numbers, dashes and underscores only.",
  not_allowed:
    "That username is not available. Please choose another.",
  empty:
    "Choose a username."
};

Deno.serve(async (request) => {
  const pre = preflight(request);
  if (pre) return pre;

  try {
    if (request.method !== "POST") {
      return json(request, { ok: false, error: "method_not_allowed" }, 405);
    }
    return await rename(request);
  } catch (error) {
    logEvent("change_username.unhandled", { message: String(error).slice(0, 200) });
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

async function rename(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail(request, "invalid_request", 400);
  }

  /* ---- 1. who is actually calling ---- */

  const user = await userFromRequest(request);
  if (!user) return fail(request, "not_signed_in", 401);

  /* ---- 2. Turnstile, before any database work ---- */

  const captchaToken = String(body.captchaToken ?? "");
  if (!captchaToken) return fail(request, "captcha_required", 400);

  const captchaOk = await verifyTurnstile(captchaToken, request);
  if (!captchaOk) {
    logEvent("change_username.captcha_failed", { user: user.id });
    return fail(request, "captcha_failed", 403);
  }

  /* ---- 3. cheap shape check ---- */

  const username = String(body.username ?? "").trim();
  if (!USERNAME_RE.test(username)) {
    // Say which rule, so the page can point at the right thing.
    const reason = username.length === 0
      ? "empty"
      : username.length < 5
        ? "too_short"
        : username.length > 20
          ? "too_long"
          : "invalid_characters";
    return fail(request, reason, 400);
  }

  /* ---- 4. the database decides ---- */

  const { data, error } = await serviceClient().rpc("change_username", {
    p_user_id: user.id,
    p_username: username
  });

  if (error) {
    logEvent("change_username.rpc_failed", { user: user.id, code: error.code });
    return json(
      request,
      {
        ok: false,
        error: "temporary_failure",
        message: "We could not change your username just now. Please try again shortly."
      },
      500
    );
  }

  const result = (data ?? {}) as Record<string, unknown>;

  if (result.ok === true) {
    logEvent("change_username.ok", { user: user.id });
    return json(request, {
      ok: true,
      username: result.username,
      cooldownUntil: result.cooldown_until ?? null
    });
  }

  const code = String(result.error ?? "invalid_request");
  logEvent("change_username.refused", { user: user.id, reason: code });

  return json(
    request,
    {
      ok: false,
      error: code,
      message: String(result.message ?? FRIENDLY[code] ?? FRIENDLY.invalid_request),
      cooldownUntil: result.cooldown_until ?? null
    },
    // A refusal on the merits is a 200-level outcome the page renders; only a
    // cooldown is a genuine "too many", and 429 is what that means.
    code === "cooldown" ? 429 : 400
  );
}

function fail(request: Request, code: string, status: number): Response {
  return json(
    request,
    { ok: false, error: code, message: FRIENDLY[code] ?? FRIENDLY.invalid_request },
    status
  );
}

/*  Turnstile
    ---------
    The secret key lives only in this function's environment — never in
    config.js, never in the page. Cloudflare, not this code, decides whether
    the token is genuine, unexpired and unspent; tokens are single use, which
    is why the page resets its widget after every submit.

    A missing secret is treated as a hard failure rather than a pass. Failing
    open would silently turn the protection off the moment somebody forgot to
    set the environment variable, and the symptom would be invisible. */
async function verifyTurnstile(token: string, request: Request): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    logEvent("change_username.turnstile_unconfigured", {});
    return false;
  }

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);

  // Binding the token to the caller's address is what stops a solved
  // challenge being farmed out and replayed from somewhere else. Optional in
  // Cloudflare's API, so a request we cannot attribute is still verified —
  // just without that extra tie.
  const ip = request.headers.get("x-real-ip");
  if (ip) form.append("remoteip", ip.trim());

  try {
    const response = await fetch(TURNSTILE_VERIFY, { method: "POST", body: form });
    const outcome = await response.json() as { success?: boolean };
    return outcome.success === true;
  } catch (error) {
    logEvent("change_username.turnstile_unreachable", {
      message: String(error).slice(0, 120)
    });
    return false;
  }
}
