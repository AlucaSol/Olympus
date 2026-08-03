/* ==========================================================================
   TRIARCHS OF OLYMPUS — account creation
   --------------------------------------------------------------------------
   This page does NOT call supabase.auth.signUp(). It posts to the signup Edge
   Function, which applies the kill switch, the account ceiling, the per-IP
   limits and the invitation rules before Auth is asked for anything.

   None of that is enforced here. Everything this file does — hiding the form
   when registration is closed, checking the two passwords match, requiring a
   username of the right shape — is there to save the visitor a pointless round
   trip. All of it is re-checked server side, and the client's opinion is not
   consulted. Deleting this script buys an attacker nothing.
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("signup-form");
  if (!form) return;

  var username = document.getElementById("signup-username");
  var email = document.getElementById("signup-email");
  var password = document.getElementById("signup-password");
  var passwordConfirm = document.getElementById("signup-password-confirm");
  var inviteField = document.getElementById("signup-invite-field");
  var invite = document.getElementById("signup-invite");
  var submit = document.getElementById("signup-submit");
  var status = document.getElementById("signup-status");

  var turnstile = window.TriarchsTurnstile.mount(
    document.getElementById("signup-turnstile"),
    { action: "signup" }
  );

  // Username rules come from js/username.js so this form and the account
  // page's rename cannot drift apart — a name accepted at signup that the
  // rename screen would refuse (or the reverse) is the confusing kind of bug.
  var names = window.TriarchsUsername;
  var MIN_PASSWORD = 8;

  function show(kind, message) {
    status.className = "auth-message is-" + kind;
    status.textContent = message;
    status.hidden = false;
  }

  function clearStatus() { status.hidden = true; status.textContent = ""; }

  function busy(isBusy) {
    submit.disabled = isBusy;
    [username, email, password, passwordConfirm, invite].forEach(function (el) {
      if (el) el.disabled = isBusy;
    });
    submit.textContent = isBusy ? "Creating account…" : "Sign up";
  }

  function closeForm(message) {
    form.hidden = true;
    show("info", message);
  }

  // Already signed in? Nothing to create.
  window.TriarchsAuth.ready.then(function (state) {
    if (state.signedIn) window.location.replace("account.html");
  });

  /* ---- what mode is registration in? ----
     Purely cosmetic: it decides whether to show the invite field and whether
     to bother rendering the form at all. The server decides the rest.        */

  window.TriarchsAuth.callFunction("signup", { method: "GET" })
    .then(function (res) {
      var mode = res.body && res.body.mode;
      var accepting = res.body && res.body.accepting;

      if (mode === "invite_only") {
        inviteField.hidden = false;
        invite.required = true;
      }

      if (mode === "disabled" || accepting === false) {
        closeForm(
          "New accounts are closed at the moment. You can still play the game " +
          "as a guest — no account needed."
        );
      }
    })
    .catch(function () {
      // If we cannot ask, show the form anyway. A visitor who can actually
      // register should not be blocked by a status check that failed.
    });

  /* ---- submit ---- */

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearStatus();

    var name = username.value.trim();
    var address = email.value.trim();
    var secret = password.value;
    var secretAgain = passwordConfirm.value;
    var code = invite && !inviteField.hidden ? invite.value.trim() : null;

    var nameProblem = names.reject(name);
    if (nameProblem) {
      show("error", names.describe(nameProblem));
      username.focus();
      return;
    }
    if (!address || address.indexOf("@") === -1) {
      show("error", "Enter a valid email address.");
      email.focus();
      return;
    }
    if (secret.length < MIN_PASSWORD) {
      show("error", "Choose a password of at least " + MIN_PASSWORD + " characters.");
      password.focus();
      return;
    }
    if (secret !== secretAgain) {
      show("error", "The two passwords do not match.");
      passwordConfirm.focus();
      passwordConfirm.select();
      return;
    }

    busy(true);
    show("info", "Creating your account…");

    turnstile.getToken().then(function (token) {
      return window.TriarchsAuth.callFunction("signup", {
        method: "POST",
        // The confirmation field is deliberately absent: matching the two is a
        // client-side courtesy, and the server has no use for a second copy of
        // the password.
        body: {
          username: name,
          email: address,
          password: secret,
          inviteCode: code || undefined,
          captchaToken: token || undefined
        }
      });
    }).then(function (res) {
      var body = res.body || {};

      if (res.ok && body.ok) {
        // Clear the credentials out of the DOM immediately.
        password.value = "";
        passwordConfirm.value = "";
        form.hidden = true;
        show(
          "success",
          "Account created. We have sent a confirmation link to " + address + ". " +
          "Open it to activate the account — you will not be able to sign in until you do. " +
          "The link is good for 48 hours; after that the account is removed and you can start again."
        );
        return;
      }

      show("error", body.message || "We could not complete that registration. Please try again.");
      busy(false);
      turnstile.reset();
    }).catch(function () {
      show("error", "We could not reach the registration service. Check your connection and try again.");
      busy(false);
      turnstile.reset();
    });
  });
})();
