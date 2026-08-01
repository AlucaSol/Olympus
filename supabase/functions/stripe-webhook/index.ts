/* ==========================================================================
   STRIPE WEBHOOK — the only place a payment becomes Favour.

   Nothing the browser does can award Favour. Landing on `?payment=success` is
   not proof of anything: it is a URL, and anyone can type one. The award
   happens here, and only after Stripe has told us, over a signed channel, that
   money actually moved.

   VERIFICATION. constructEventAsync is given the RAW request body — the exact
   bytes Stripe signed. Parsing to JSON first and re-serialising would change
   the bytes and break the signature, which is why the body is read as text and
   handed over untouched. An event that fails verification is rejected with 400
   and never reaches the database.

   IDEMPOTENCY. Stripe retries. Stripe can also deliver the same event twice
   in parallel. Every handler below funnels into a database function whose
   first act is to claim the Stripe event id on a primary key, so a duplicate
   loses the race and returns a no-op. Behind that sit two more unique
   constraints — one per Checkout Session, one per ledger reference — so even a
   hand-run repair cannot pay out twice.

   NO CORS HEADERS HERE ON PURPOSE. Stripe is a server, not a browser; this
   endpoint is not meant to be reachable from a web page at all.
   ========================================================================== */

import Stripe from "npm:stripe@17.7.0";
import { serviceClient } from "../_shared/supabase.ts";
import { logEvent } from "../_shared/http.ts";

function stripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, {
    apiVersion: "2025-01-27.acacia",
    httpClient: Stripe.createFetchHttpClient()
  });
}

// Always 200 once the signature has been verified, even when we decline to
// act. A non-2xx makes Stripe retry, and retrying will not fix a mismatched
// price or an unknown session — it would just replay the same refusal forever.
const ACK = new Response(JSON.stringify({ received: true }), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const signature = request.headers.get("stripe-signature");

  if (!secret) {
    logEvent("webhook.misconfigured", { reason: "no signing secret" });
    return new Response("Not configured", { status: 500 });
  }
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  // Raw bytes, exactly as sent.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      rawBody,
      signature,
      secret
    );
  } catch (error) {
    // A forged or corrupted signature ends here, before any database call.
    logEvent("webhook.bad_signature", { message: String(error).slice(0, 120) });
    return new Response("Invalid signature", { status: 400 });
  }

  const admin = serviceClient();

  try {
    switch (event.type) {
      /* Card payments settle immediately: completed means paid. */
      case "checkout.session.completed":
      /* Delayed methods (BECS, bank transfers) settle later; this is their
         "the money arrived" event and must fulfil exactly as the above does. */
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;

        // A completed session that is not actually paid (a delayed method
        // still processing) must wait for its async_payment_succeeded.
        if (session.payment_status !== "paid") {
          await admin.rpc("record_stripe_event", {
            p_event_id: event.id,
            p_event_type: event.type,
            p_status: "ignored",
            p_summary: { session_id: session.id, payment_status: session.payment_status },
            p_detail: "session not yet paid"
          });
          logEvent("webhook.awaiting_payment", { session: session.id });
          return ACK;
        }

        const userId = session.metadata?.supabase_user_id ?? null;
        const bundleId = session.metadata?.bundle_id ?? null;

        const { data, error } = await admin.rpc("fulfil_favour_purchase", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_session_id: session.id,
          p_payment_intent: typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
          p_customer_id: typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null,
          p_amount_minor: session.amount_total ?? 0,
          p_currency: (session.currency ?? "").toLowerCase(),
          p_user_id: userId,
          p_bundle_id: bundleId
        });

        if (error) {
          // A database fault *is* worth retrying, so this one returns 500.
          logEvent("webhook.fulfil_error", { event: event.id, code: error.code });
          return new Response("Fulfilment failed", { status: 500 });
        }

        logEvent("webhook.fulfilled", {
          event: event.id,
          ok: data?.ok,
          duplicate: data?.duplicate,
          granted: data?.granted,
          error: data?.error
        });
        return ACK;
      }

      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await admin.rpc("close_favour_purchase", {
          p_session_id: session.id,
          p_status: event.type === "checkout.session.expired" ? "expired" : "failed"
        });
        await admin.rpc("record_stripe_event", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_status: "processed",
          p_summary: { session_id: session.id },
          p_detail: null
        });
        logEvent("webhook.closed", { event: event.id, type: event.type });
        return ACK;
      }

      /* Refunds and disputes are recorded and flagged, never auto-reversed:
         the player may already have spent the Favour on a permanent unlock,
         and the balance cannot go negative. A human decides. */
      case "charge.refunded":
      case "charge.refund.updated": {
        const charge = event.data.object as Stripe.Charge;
        await admin.rpc("record_favour_refund", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_payment_intent: typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null,
          p_amount_minor: charge.amount_refunded ?? 0,
          p_currency: (charge.currency ?? "").toLowerCase(),
          p_kind: "refunded"
        });
        logEvent("webhook.refund_flagged", { event: event.id });
        return ACK;
      }

      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        await admin.rpc("record_favour_refund", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_payment_intent: typeof dispute.payment_intent === "string"
            ? dispute.payment_intent
            : dispute.payment_intent?.id ?? null,
          p_amount_minor: dispute.amount ?? 0,
          p_currency: (dispute.currency ?? "").toLowerCase(),
          p_kind: "disputed"
        });
        logEvent("webhook.dispute_flagged", { event: event.id });
        return ACK;
      }

      default: {
        // Recorded so the log is a complete account of what Stripe sent.
        await admin.rpc("record_stripe_event", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_status: "ignored",
          p_summary: null,
          p_detail: "no handler"
        });
        return ACK;
      }
    }
  } catch (error) {
    logEvent("webhook.unhandled", {
      event: event.id,
      message: String(error).slice(0, 200)
    });
    // Let Stripe retry — this is our fault, not theirs.
    return new Response("Handler error", { status: 500 });
  }
});
