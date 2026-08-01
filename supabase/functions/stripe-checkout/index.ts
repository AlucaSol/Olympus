/* ==========================================================================
   STRIPE CHECKOUT — creates a hosted Checkout Session for a Favour bundle.

   POST { bundleId, requestId } -> { ok, url } | { ok:false, error, message }

   WHAT THE CLIENT IS ALLOWED TO SAY. Two things: which bundle, and a request
   id of its own invention used purely for idempotency. It cannot name a price,
   a currency, a Favour quantity, a user id or a Stripe Price. Every one of
   those is read server-side from public.favour_bundles by
   begin_favour_checkout(). "One million Favour for one cent" has nowhere to be
   written down.

   WHO THE BUYER IS. Taken from the verified access token, never from the body.
   A request that names someone else's user id does not fail a check — there is
   simply no field in which to name them.

   IDEMPOTENCY. The same requestId always maps to the same purchase row, and a
   still-live Checkout Session is handed back rather than a second one being
   created. A double-click therefore produces one session, not two, and a
   visitor who returns to a stale tab is not billed twice.
   ========================================================================== */

import Stripe from "npm:stripe@17.7.0";
import { preflight, json, logEvent } from "../_shared/http.ts";
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUNDLE_RE = /^[a-z0-9_]{3,48}$/;

function stripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, {
    apiVersion: "2025-01-27.acacia",
    httpClient: Stripe.createFetchHttpClient()
  });
}

Deno.serve(async (request) => {
  const pre = preflight(request);
  if (pre) return pre;

  if (request.method !== "POST") {
    return json(request, { ok: false, error: "method_not_allowed" }, 405);
  }

  try {
    const user = await userFromRequest(request);
    if (!user) {
      return json(request, {
        ok: false,
        error: "not_authenticated",
        message: "Please sign in before buying Favour."
      }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json(request, { ok: false, error: "invalid_request" }, 400);
    }

    const bundleId = String(body.bundleId ?? "");
    const requestId = String(body.requestId ?? "");

    if (!BUNDLE_RE.test(bundleId) || !UUID_RE.test(requestId)) {
      return json(request, {
        ok: false,
        error: "invalid_request",
        message: "That purchase could not be started. Please refresh and try again."
      }, 400);
    }

    const admin = serviceClient();

    /* ---- reserve, or recover an existing attempt ---- */

    const { data: intent, error: intentError } = await admin.rpc(
      "begin_favour_checkout",
      { p_user_id: user.id, p_bundle_id: bundleId, p_request_id: requestId }
    );

    if (intentError) {
      logEvent("checkout.begin_failed", { code: intentError.code });
      return json(request, {
        ok: false,
        error: "temporary_failure",
        message: "We could not start that purchase. Please try again shortly."
      }, 503);
    }

    if (!intent?.ok) {
      const code = String(intent?.error ?? "invalid_request");
      const messages: Record<string, string> = {
        bundle_unavailable: "That Favour bundle is not available at the moment.",
        not_configured: "Favour purchasing is not switched on yet. Please try again later.",
        rate_limited: "That is a lot of checkouts in a short time. Please wait a few minutes and try again."
      };
      logEvent("checkout.refused", { reason: code });
      return json(request, {
        ok: false,
        error: code,
        message: messages[code] ?? "That purchase could not be started."
      }, code === "rate_limited" ? 429 : 400);
    }

    // An in-flight session for this exact request id: send them back to it.
    if (intent.reuse && intent.checkout_url) {
      logEvent("checkout.reused", { purchase_id: intent.purchase_id });
      return json(request, { ok: true, url: intent.checkout_url, reused: true }, 200);
    }

    // Reused request id whose session is gone (expired, or already paid).
    if (intent.reuse && !intent.checkout_url) {
      return json(request, {
        ok: false,
        error: "already_used",
        message: "That purchase has already been started. Refresh the page to begin a new one."
      }, 409);
    }

    /* ---- create the session ---- */

    const bundle = intent.bundle;
    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://alucasol.github.io/Olympus").replace(/\/$/, "");

    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // The Price lives in Stripe and is looked up by an id the client never
        // sees. Nothing about the amount travels from the browser.
        line_items: [{ price: bundle.stripe_price_id, quantity: 1 }],
        success_url: `${siteUrl}/emporion.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/emporion.html?payment=cancelled`,
        client_reference_id: String(intent.purchase_id),
        customer_email: user.email ?? undefined,
        // Echoed back on the webhook so fulfilment can find its row without
        // trusting anything the browser said.
        metadata: {
          supabase_user_id: user.id,
          bundle_id: bundle.bundle_id,
          purchase_id: String(intent.purchase_id)
        },
        payment_intent_data: {
          metadata: {
            supabase_user_id: user.id,
            bundle_id: bundle.bundle_id,
            purchase_id: String(intent.purchase_id)
          }
        },
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60 // 1 hour
      },
      // Stripe's own idempotency, keyed on our request id: a retried call
      // returns the original session instead of creating another.
      { idempotencyKey: `checkout:${user.id}:${requestId}` }
    );

    const { error: attachError } = await admin.rpc("attach_checkout_session", {
      p_purchase_id: intent.purchase_id,
      p_session_id: session.id,
      p_session_url: session.url
    });

    if (attachError) {
      // The session exists at Stripe but we failed to record it, so the
      // webhook would not find a row to fulfil. Expiring it is the safe move.
      logEvent("checkout.attach_failed", { code: attachError.code });
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      return json(request, {
        ok: false,
        error: "temporary_failure",
        message: "We could not start that purchase. Nothing has been charged. Please try again."
      }, 503);
    }

    logEvent("checkout.created", {
      purchase_id: intent.purchase_id,
      bundle_id: bundle.bundle_id
    });

    return json(request, { ok: true, url: session.url, reused: false }, 200);
  } catch (error) {
    logEvent("checkout.unhandled", { message: String(error).slice(0, 200) });
    return json(request, {
      ok: false,
      error: "temporary_failure",
      message: "Something went wrong starting that purchase. Nothing has been charged."
    }, 500);
  }
});
