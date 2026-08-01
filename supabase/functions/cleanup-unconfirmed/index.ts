/* ==========================================================================
   CLEANUP — deletes Auth accounts that were never confirmed.

   Scheduled (see docs/backend-setup.md). Also runnable by hand with the
   CLEANUP_SECRET, which is the only way to invoke it: it is deliberately not
   reachable by a browser and has no CORS headers.

   WHAT IT DELETES, precisely: users whose `email_confirmed_at` is null and
   whose `created_at` is more than 48 hours ago. Nothing else. A confirmed
   account is never touched however old it is, and an unconfirmed one younger
   than 48 hours is left alone so someone who signs up on a Friday evening
   still has their link on Sunday.

   Deleting the Auth user cascades to public.player_accounts (the foreign key
   in migration 001 is ON DELETE CASCADE), so no orphan profile is left behind.
   Signup claims and IP-quota rows are tidied by the same pass.

   IDEMPOTENT. Running it twice in a row deletes nothing the second time.
   Running it during a signup is safe: a brand-new account is hours away from
   being eligible.

   The log records counts only — never an email address, never a user id.
   ========================================================================== */

import { serviceClient } from "../_shared/supabase.ts";
import { logEvent } from "../_shared/http.ts";

const UNCONFIRMED_MAX_AGE_HOURS = 48;

// A page at a time, so a large backlog cannot exhaust the function's memory
// or its wall-clock budget. Whatever is missed is caught on the next run.
const PAGE_SIZE = 200;
const MAX_DELETIONS_PER_RUN = 500;

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Supabase's scheduler sends the service-role key as the bearer token; a
  // manual run can use CLEANUP_SECRET instead. Either way, an unauthenticated
  // caller gets nothing.
  const expected = Deno.env.get("CLEANUP_SECRET");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (!token || (token !== expected && token !== serviceKey)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = serviceClient();
  const cutoff = Date.now() - UNCONFIRMED_MAX_AGE_HOURS * 60 * 60 * 1000;

  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let page = 1;

  try {
    while (deleted < MAX_DELETIONS_PER_RUN) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: PAGE_SIZE
      });

      if (error) {
        logEvent("cleanup.list_failed", { page, code: error.status });
        break;
      }

      const users = data?.users ?? [];
      if (users.length === 0) break;
      scanned += users.length;

      for (const user of users) {
        // Two independent conditions, both required. `email_confirmed_at` is
        // the authority on confirmation; `confirmed_at` is a generated column
        // that also reflects phone confirmation, so it is checked too rather
        // than assumed equivalent.
        const unconfirmed = !user.email_confirmed_at && !user.confirmed_at;
        if (!unconfirmed) continue;

        const createdAt = user.created_at ? Date.parse(user.created_at) : NaN;
        if (!Number.isFinite(createdAt) || createdAt > cutoff) continue;

        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
        if (deleteError) {
          failed += 1;
          logEvent("cleanup.delete_failed", { code: deleteError.status });
          continue;
        }
        deleted += 1;
        if (deleted >= MAX_DELETIONS_PER_RUN) break;
      }

      if (users.length < PAGE_SIZE) break;
      page += 1;
    }

    // Release reservations whose signup never completed, and drop expired
    // rate-limit and attempt records. Both are idempotent.
    const { data: expired } = await admin.rpc("expire_signup_claims", {
      p_older_than: "15 minutes"
    });
    const { data: purged } = await admin.rpc("purge_signup_records");
    await admin.rpc("purge_shop_purchase_requests");

    const summary = {
      scanned,
      deleted,
      failed,
      claims_expired: expired ?? 0,
      ip_quota_purged: purged?.ip_quota_deleted ?? 0,
      attempt_log_purged: purged?.attempt_log_deleted ?? 0
    };

    logEvent("cleanup.done", summary);
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    logEvent("cleanup.unhandled", { message: String(error).slice(0, 200) });
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
