/* ==========================================================================
   Supabase clients for the Triarchs of Olympus Edge Functions.

   Two clients, two very different powers, deliberately created by two
   differently named functions so a call site cannot pick the wrong one by
   accident:

     serviceClient()  holds the service_role key. Bypasses RLS. Can call every
                      privileged function in migrations 010-013. Must never be
                      constructed with anything a caller supplied, and its key
                      must never be returned in a response.

     anonClient()     holds the publishable key. Exactly the powers the browser
                      has. Used for auth.signUp() so the ordinary confirmation
                      email flow and CAPTCHA verification run untouched.

   userFromRequest() is the only sanctioned way to learn who is calling. It
   verifies the caller's access token with Supabase and returns the user that
   token belongs to. A user id in a request body is never trusted — that is the
   whole point.
   ========================================================================== */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service configuration missing");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function anonClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Supabase anon configuration missing");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export type AuthedUser = { id: string; email: string | null };

export async function userFromRequest(
  request: Request
): Promise<AuthedUser | null> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) return null;

  // getUser(token) asks Supabase to verify the signature and expiry rather
  // than decoding the JWT here and hoping.
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data?.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}
