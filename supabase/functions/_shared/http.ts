/* ==========================================================================
   Shared HTTP helpers for the Triarchs of Olympus Edge Functions.
   ========================================================================== */

/*  CORS
    ----
    An allow-list, never "*". These endpoints act on an authenticated user's
    behalf — creating payment sessions, registering accounts — so a wildcard
    would let any page on the internet drive them with a visitor's credentials
    attached. The list is configuration rather than a constant so the local dev
    origin can be dropped in production without a code change.

    An origin we do not recognise gets no CORS headers at all, which is what
    makes the browser refuse to hand the response back to the calling page. */

const DEFAULT_ORIGINS = [
  "https://alucasol.github.io",
  "http://localhost:8080"
];

export function allowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEFAULT_ORIGINS;
  return configured.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
      ...extraHeaders
    }
  });
}

/*  Client IP
    ---------
    The brief says not to rely on a client-supplied address, and the leftmost
    entry of X-Forwarded-For is exactly that: anyone can send
    `X-Forwarded-For: 1.2.3.4` and have it land there. Each proxy in the chain
    appends the peer it actually heard from, so the LAST entry is the one
    written by the hop closest to us and is the only one a caller cannot
    choose. Supabase's gateway also sets x-real-ip itself, which it strips from
    inbound requests, so that is preferred where present.

    If neither is available the caller gets rejected rather than quietly
    sharing one bucket, because a single shared bucket would either lock
    everyone out or let everyone through. */

export function clientIp(request: Request): string | null {
  const real = request.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return null;
}

/*  Keyed IP digest
    ---------------
    HMAC-SHA256, not a bare hash. The whole IPv4 space is 2^32 addresses — a
    plain SHA-256 of one is reversible by brute force in seconds on a laptop,
    which would make an "anonymised" table a de-anonymised one. The key lives
    only in this function's environment, so the digests in the database are
    meaningless without it. */

export async function hashIp(ip: string): Promise<string> {
  const secret = Deno.env.get("SIGNUP_IP_HMAC_SECRET");
  if (!secret) throw new Error("SIGNUP_IP_HMAC_SECRET is not configured");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip.toLowerCase())
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/*  Logging
    -------
    Edge Function logs are readable in the dashboard, so nothing sensitive goes
    into them: no passwords, no email addresses, no IPs, no tokens, no Stripe
    secrets. Ids and outcomes only. */

export function logEvent(scope: string, fields: Record<string, unknown>): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    safe[k] = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
  }
  console.log(JSON.stringify({ scope, ...safe }));
}
