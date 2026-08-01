/* ==========================================================================
   TRIARCHS OF OLYMPUS — profile page
   --------------------------------------------------------------------------
   Shows who is signed in, changes the password, and signs out.

   THE PASSWORD RULES THIS FILE KEEPS:
     - both fields are type="password", so nothing is legible over a shoulder
       by default and no browser autofill treats them as text;
     - the value is read, passed to Supabase, and dropped. It is never written
       to localStorage, never logged, never put in a URL, never sent anywhere
       but Supabase over TLS;
     - the two fields must match before anything is sent;
     - the submit button is disabled for the duration, so an impatient second
       click cannot fire a second request;
     - on success both fields are emptied immediately.

   REAUTHENTICATION. If Supabase's "secure password change" protection is on
   and the session is old, updateUser() refuses with `reauthentication_needed`.
   The supported answer is to call reauthenticate(), which emails a short code,
   and resend the update with that code as `nonce`. That is what happens below.
   The alternative — reaching for an admin/service-role update to sidestep the
   check — would be defeating a protection on purpose, so it is not done, and
   could not be done from here in any case: this page holds no privileged key.
   ========================================================================== */
(function () {
  "use strict";

  var card = document.getElementById("account-card");
  var loading = document.getElementById("account-loading");
  var loadingText = document.getElementById("account-loading-text");
  if (!card) return;

  var emailOut = document.getElementById("account-email");
  var usernameOut = document.getElementById("account-username");
  var favourOut = document.getElementById("account-favour-value");

  var form = document.getElementById("password-form");
  var newPassword = document.getElementById("new-password");
  var newPasswordConfirm = document.getElementById("new-password-confirm");
  var reauthField = document.getElementById("reauth-field");
  var reauthCode = document.getElementById("reauth-code");
  var submit = document.getElementById("password-submit");
  var status = document.getElementById("password-status");
  var logout = document.getElementById("logout-button");

  var MIN_PASSWORD = 8;
  var auth = window.TriarchsAuth;
  var money = new Intl.NumberFormat("en-US");
  var currentIdentity = null;

  function show(kind, message) {
    status.className = "auth-message is-" + kind;
    status.textContent = message;
    status.hidden = false;
  }
  function clearStatus() { status.hidden = true; status.textContent = ""; }

  function busy(isBusy) {
    submit.disabled = isBusy;
    newPassword.disabled = isBusy;
    newPasswordConfirm.disabled = isBusy;
    reauthCode.disabled = isBusy;
    submit.textContent = isBusy ? "Changing…" : "Change password";
  }

  /* ---------------- session gate ---------------- */

  auth.onChange(function (state) {
    if (!state.ready) return;

    if (!state.signedIn) {
      // Never leave a previous account's details on screen.
      currentIdentity = null;
      emailOut.textContent = "—";
      usernameOut.textContent = "—";
      favourOut.textContent = "—";
      card.hidden = true;
      loading.hidden = false;
      loadingText.textContent = "Taking you to the sign-in page…";
      window.location.replace("login.html");
      return;
    }

    card.hidden = false;
    loading.hidden = true;
    emailOut.textContent = state.user.email || "(no email on this account)";

    if (state.identity !== currentIdentity) {
      currentIdentity = state.identity;
      // Blank first, then fill from the database. A balance belonging to
      // whoever was signed in a moment ago must never be shown to the next
      // person, not even for a frame.
      usernameOut.textContent = "—";
      favourOut.textContent = "—";
      loadProfile(state.identity);
    }
  });

  function loadProfile(identity) {
    auth.client
      .from("player_accounts")
      .select("username, favour")
      .single()
      .then(function (res) {
        // The session may have changed while the request was in flight.
        if (auth.state.identity !== identity) return;

        if (res.error || !res.data) {
          usernameOut.textContent = "unavailable";
          favourOut.textContent = "—";
          return;
        }
        usernameOut.textContent = res.data.username;
        favourOut.textContent = money.format(res.data.favour);
      });
  }

  /* ---------------- change password ---------------- */

  function describe(error) {
    var code = (error && (error.code || error.error_code)) || "";
    var message = ((error && error.message) || "").toLowerCase();
    var httpStatus = (error && error.status) || 0;

    if (code === "same_password" || message.indexOf("should be different") !== -1) {
      return "That is already your password. Choose a different one.";
    }
    if (code === "weak_password" || message.indexOf("password") !== -1 &&
        message.indexOf("least") !== -1) {
      return "That password does not meet the minimum requirements. Try a longer one.";
    }
    if (httpStatus === 429 || message.indexOf("rate limit") !== -1) {
      return "Too many attempts just now. Please wait a minute and try again.";
    }
    if (code === "session_expired" || httpStatus === 401 ||
        message.indexOf("session") !== -1 && message.indexOf("expired") !== -1) {
      return "Your session has expired. Sign in again and retry.";
    }
    if (error && (error.name === "AuthRetryableFetchError" ||
                  error.name === "TypeError" || httpStatus >= 500)) {
      return "We could not reach the account service. Check your connection and try again.";
    }
    return "We could not change your password. Please try again.";
  }

  function needsReauthentication(error) {
    var code = (error && (error.code || error.error_code)) || "";
    var message = ((error && error.message) || "").toLowerCase();
    return code === "reauthentication_needed" ||
           message.indexOf("reauthentication") !== -1;
  }

  function invalidNonce(error) {
    var code = (error && (error.code || error.error_code)) || "";
    var message = ((error && error.message) || "").toLowerCase();
    return code === "reauthentication_not_valid" ||
           message.indexOf("nonce") !== -1 ||
           (message.indexOf("token") !== -1 && message.indexOf("invalid") !== -1);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearStatus();

    var next = newPassword.value;
    var again = newPasswordConfirm.value;
    var nonce = reauthField.hidden ? "" : reauthCode.value.trim();

    if (next.length < MIN_PASSWORD) {
      show("error", "Choose a password of at least " + MIN_PASSWORD + " characters.");
      newPassword.focus();
      return;
    }
    if (next !== again) {
      show("error", "The two passwords do not match.");
      newPasswordConfirm.setAttribute("aria-invalid", "true");
      newPasswordConfirm.focus();
      newPasswordConfirm.select();
      return;
    }
    newPasswordConfirm.removeAttribute("aria-invalid");

    if (!reauthField.hidden && !nonce) {
      show("error", "Enter the verification code we emailed you.");
      reauthCode.focus();
      return;
    }

    busy(true);
    show("info", "Changing your password…");

    var payload = { password: next };
    if (nonce) payload.nonce = nonce;

    auth.client.auth.updateUser(payload).then(function (result) {
      if (result.error) throw result.error;

      newPassword.value = "";
      newPasswordConfirm.value = "";
      reauthCode.value = "";
      reauthField.hidden = true;
      busy(false);
      show("success", "Your password has been changed.");
    }).catch(function (error) {
      if (needsReauthentication(error) && reauthField.hidden) {
        // Start the supported reauthentication flow rather than failing.
        auth.client.auth.reauthenticate().then(function (res) {
          busy(false);
          reauthField.hidden = false;
          reauthCode.focus();
          if (res.error) {
            show("error",
              "For your security this change needs to be verified by email, but we " +
              "could not send the code. Please try again in a moment.");
            return;
          }
          show("info",
            "For your security, a change on a session this old has to be verified. " +
            "We have emailed you a short code — enter it above and press Change " +
            "password again. Your new password has not been saved yet.");
        }).catch(function () {
          busy(false);
          show("error", "We could not start email verification. Please sign out, sign in again, and retry.");
        });
        return;
      }

      busy(false);
      if (invalidNonce(error)) {
        show("error", "That verification code was not accepted. Check the latest email and try again.");
        reauthCode.focus();
        reauthCode.select();
        return;
      }
      show("error", describe(error));
    });
  });

  /* ---------------- logout ---------------- */

  logout.addEventListener("click", function () {
    logout.disabled = true;
    logout.textContent = "Logging out…";

    auth.signOut().then(function () {
      // Nothing signed-in stays on screen, and the visitor lands somewhere
      // public rather than on a page that will only bounce them.
      window.location.replace("home.html");
    }).catch(function () {
      logout.disabled = false;
      logout.textContent = "Log out";
      show("error", "We could not sign you out. Check your connection and try again.");
    });
  });
})();
