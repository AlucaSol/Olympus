/* ==========================================================================
   TRIARCHS OF OLYMPUS — email confirmation landing page
   --------------------------------------------------------------------------
   Where the link in the confirmation email comes back to. Supabase can deliver
   the result in three different shapes depending on which email template and
   auth flow the project is using, so all three are handled:

     1. ?token_hash=...&type=signup   — the current default. Exchanged here
                                        with verifyOtp().
     2. #access_token=...&type=signup — the older implicit style. supabase-js
                                        consumes it during initialisation
                                        because detectSessionInUrl is on.
     3. ?error=...&error_description= — an expired or already-used link.

   The visitor is told what happened either way, and the URL is scrubbed
   afterwards so a token cannot be re-shared by copying the address bar.
   ========================================================================== */
(function () {
  "use strict";

  var status = document.getElementById("confirm-status");
  var actions = document.getElementById("confirm-actions");
  var primary = document.getElementById("confirm-primary");
  var secondary = document.getElementById("confirm-secondary");
  if (!status) return;

  var auth = window.TriarchsAuth;

  function show(kind, message) {
    status.className = "auth-message is-" + kind;
    status.textContent = message;
  }

  function finish(kind, message, showActions) {
    show(kind, message);
    actions.hidden = !showActions;
    // Drop the token out of the address bar. It has been spent; leaving it
    // there only invites it into a screenshot or a shared link.
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  var params = new URLSearchParams(window.location.search);
  var hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

  var errorCode = params.get("error_code") || hashParams.get("error_code");
  var errorDescription = params.get("error_description") || hashParams.get("error_description");

  if (errorCode || errorDescription) {
    var expired = /expired|invalid/i.test(errorCode + " " + errorDescription);
    finish(
      "error",
      expired
        ? "That confirmation link has expired or has already been used. Links are good for 48 hours; " +
          "after that the unconfirmed account is removed and you can sign up again."
        : "We could not confirm your account from that link. Please try signing up again.",
      true
    );
    primary.textContent = "Sign up again";
    primary.setAttribute("href", "signup.html");
    secondary.hidden = true;
    return;
  }

  var tokenHash = params.get("token_hash");
  var type = params.get("type") || "signup";

  if (tokenHash) {
    auth.client.auth
      .verifyOtp({ token_hash: tokenHash, type: type })
      .then(function (result) {
        if (result.error) throw result.error;
        succeed();
      })
      .catch(function () {
        finish(
          "error",
          "That confirmation link could not be used. It may have expired or already been " +
          "opened. Links are good for 48 hours.",
          true
        );
        primary.textContent = "Sign up again";
        primary.setAttribute("href", "signup.html");
        secondary.setAttribute("href", "login.html");
      });
    return;
  }

  // No token in the query: either the implicit fragment (which auth.js is
  // already consuming) or somebody arrived here directly.
  auth.ready.then(function (state) {
    if (state.signedIn) { succeed(); return; }
    finish(
      "info",
      "There is nothing to confirm here. If you have just signed up, open the link in " +
      "your confirmation email. If you have already confirmed, you can sign in.",
      true
    );
    primary.textContent = "Sign in";
    primary.setAttribute("href", "login.html");
    secondary.hidden = true;
  });

  function succeed() {
    finish(
      "success",
      "Your account is confirmed and you are signed in. Welcome to Olympus.",
      true
    );
    primary.textContent = "Go to the Emporion";
    primary.setAttribute("href", "emporion.html");
    secondary.textContent = "View your account";
    secondary.setAttribute("href", "account.html");
    secondary.hidden = false;
  }
})();
