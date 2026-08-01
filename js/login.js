/* ==========================================================================
   TRIARCHS OF OLYMPUS — sign in
   --------------------------------------------------------------------------
   Thin wrapper over supabase.auth.signInWithPassword. The password is read
   from the field, handed straight to Supabase over TLS, and never stored,
   logged, or copied anywhere else — not to localStorage, not to analytics, not
   into an error message.

   ON NOT LEAKING WHO HAS AN ACCOUNT. Supabase distinguishes "wrong password"
   from "right password, unconfirmed email", and the second of those would
   otherwise tell a stranger that a given address is registered here. So the
   unconfirmed case is phrased conditionally — it explains what to do without
   asserting that the account exists. Everything else collapses to one generic
   "those details were not accepted".
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("login-form");
  if (!form) return;

  var emailInput = document.getElementById("login-email");
  var passwordInput = document.getElementById("login-password");
  var submit = document.getElementById("login-submit");
  var status = document.getElementById("login-status");
  var turnstile = window.TriarchsTurnstile.mount(
    document.getElementById("login-turnstile"),
    { action: "login" }
  );

  // Only these are acceptable post-login destinations. Anything else — an
  // absolute URL, a protocol-relative "//evil.example", a path traversal — is
  // ignored in favour of the profile page. An open redirect on a login form is
  // a phishing primitive, not a convenience.
  var ALLOWED_NEXT = ["emporion.html", "account.html", "home.html"];

  function nextDestination() {
    var raw = new URLSearchParams(window.location.search).get("next");
    return ALLOWED_NEXT.indexOf(raw) !== -1 ? raw : "account.html";
  }

  function show(kind, message) {
    status.className = "auth-message is-" + kind;
    status.textContent = message;
    status.hidden = false;
  }

  function clearStatus() { status.hidden = true; status.textContent = ""; }

  function busy(isBusy) {
    submit.disabled = isBusy;
    emailInput.disabled = isBusy;
    passwordInput.disabled = isBusy;
    submit.textContent = isBusy ? "Signing in…" : "Login";
  }

  // Already signed in? There is nothing to do on this page.
  window.TriarchsAuth.ready.then(function (state) {
    if (state.signedIn) window.location.replace(nextDestination());
  });

  function describe(error) {
    var code = (error && (error.code || error.error_code)) || "";
    var message = ((error && error.message) || "").toLowerCase();
    var httpStatus = (error && error.status) || 0;

    if (code === "email_not_confirmed" || message.indexOf("not confirmed") !== -1) {
      return {
        kind: "info",
        text: "If an account exists for that address, it still needs to be confirmed. " +
              "Open the confirmation link in the email we sent, then sign in again."
      };
    }

    if (httpStatus === 429 || code === "over_request_rate_limit" ||
        message.indexOf("rate limit") !== -1 || message.indexOf("too many") !== -1) {
      return {
        kind: "error",
        text: "Too many attempts from here just now. Please wait a minute and try again."
      };
    }

    if (code === "captcha_failed" || message.indexOf("captcha") !== -1) {
      return {
        kind: "error",
        text: "The human-verification check did not pass. Please complete it and try again."
      };
    }

    // Fetch failures surface as AuthRetryableFetchError, or as a plain
    // TypeError when the browser could not reach the network at all.
    if (error && (error.name === "AuthRetryableFetchError" ||
                  error.name === "TypeError" ||
                  httpStatus === 0 || httpStatus >= 500)) {
      return {
        kind: "error",
        text: "We could not reach the sign-in service. Check your connection and try again."
      };
    }

    // Everything else — wrong password, unknown address, malformed email — is
    // deliberately one message.
    return {
      kind: "error",
      text: "Those details were not accepted. Check the email and password and try again."
    };
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearStatus();

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (!email || !password) {
      show("error", "Enter both an email address and a password.");
      return;
    }

    busy(true);
    show("info", "Signing in…");

    turnstile.getToken().then(function (token) {
      var options = {};
      // Only sent when a widget actually produced one. Supabase rejects an
      // empty captchaToken outright when CAPTCHA protection is enabled, and
      // ignores the field entirely when it is not.
      if (token) options.captchaToken = token;

      return window.TriarchsAuth.client.auth.signInWithPassword({
        email: email,
        password: password,
        options: options
      });
    }).then(function (result) {
      if (result.error) throw result.error;

      // Clear the password out of the DOM the moment it is no longer needed.
      passwordInput.value = "";
      show("success", "Signed in. Taking you through…");
      window.location.replace(nextDestination());
    }).catch(function (error) {
      var described = describe(error);
      show(described.kind, described.text);
      busy(false);
      // A spent or stale token must not be replayed on the retry.
      turnstile.reset();
      passwordInput.focus();
      passwordInput.select();
    });
  });
})();
