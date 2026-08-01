/* ==========================================================================
   TRIARCHS OF OLYMPUS — public website configuration
   --------------------------------------------------------------------------
   EVERY VALUE IN THIS FILE IS PUBLIC BY DESIGN and is safe to serve from a
   static host, read in devtools, or commit to a public repository:

     - the Supabase project URL and *publishable* key. Row Level Security, not
       secrecy, is what protects the data behind them. See migrations/001.
     - the Cloudflare Turnstile *site* key. The matching secret key lives only
       in Supabase Auth's configuration and is verified by Cloudflare, never
       here.
     - the Stripe *publishable* key. It can create nothing and charge nothing;
       Checkout Sessions are created server-side by an Edge Function holding
       the secret key.

   NOTHING PRIVILEGED MAY EVER BE ADDED HERE. The Supabase service_role key,
   the Stripe secret key, the Stripe webhook signing secret, the IP-HMAC
   secret and the Resend credentials all belong in Edge Function secrets. If
   you find yourself wanting one of them in this file, the logic that needs it
   belongs on the server instead.
   ========================================================================== */
window.TRIARCHS_CONFIG = {
  supabaseUrl: "https://xwtsqssaahubalgztoby.supabase.co",
  supabasePublishableKey: "sb_publishable_4Ye1Md7PflHNw8Lmh1nRkg_F2kCgS2w",

  // Base URL for the Edge Functions in supabase/functions/.
  functionsUrl: "https://xwtsqssaahubalgztoby.supabase.co/functions/v1",

  turnstileSiteKey: "0x4AAAAAAD6lW2pG3Hnhur9_",

  // Where Supabase should send a visitor after they click the link in their
  // confirmation email. Must also be listed under Authentication ->
  // URL Configuration -> Redirect URLs in the Supabase dashboard.
  confirmRedirectPath: "confirm.html",

  // Displayed with real-money prices. Australian dollars; the Stripe Prices
  // and migrations/011 both use `aud`, and the two must not drift apart.
  currency: "aud",
  currencyDisplay: "A$"
};
