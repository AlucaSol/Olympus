/* ==========================================================================
   TRIARCHS OF OLYMPUS — profile page
   --------------------------------------------------------------------------
   Shows who is signed in, changes the username and password, and signs out.

   THE USERNAME RULES THIS FILE KEEPS:
     - every rule is checked locally FIRST, against js/username.js, and a name
       that fails one is refused without contacting Supabase at all. That is
       the point of the local copy: the cheapest request is the one never sent;
     - two localStorage clocks stop requests that are certain to be refused —
       a 24-hour cooldown after a successful change, and three failed attempts
       per hour. Neither is a security control (clearing site data resets
       both, as the brief acknowledges) and neither is trusted: the same
       cooldown is enforced in the database, and this page re-syncs to the
       server's clock on every load, from a column it was already fetching;
     - only an attempt that actually reaches Supabase counts against the
       hourly budget. Being told locally that a name is too long is free, and
       stays free however many times it happens.

   ONE TURNSTILE, TWO BUTTONS. The widget sits in its own panel below both
   forms and is consulted by each. What it buys differs between them, and it
   is worth being straight about which is which:

     - CHANGE USERNAME goes through the change-username Edge Function, which
       verifies the token against Cloudflare with the secret key before it
       touches the database. That is a real control: a forged or replayed
       token fails server side.
     - CHANGE PASSWORD goes straight to Supabase Auth's updateUser(), which
       accepts no captcha argument — Auth applies CAPTCHA to sign-in, sign-up
       and recovery, not to updating an already-authenticated user. The check
       here is a deterrent in front of an endpoint that is already protected
       by the session itself, by Supabase's own rate limiting, and by the
       reauthentication flow described below. It is not load-bearing, and
       routing the password change through a service-role function to make it
       so would mean defeating the secure-password-change protection on
       purpose — which is precisely what the last paragraph here refuses to do.

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
  var favourOut = document.getElementById("account-favour-value");

  var usernameForm = document.getElementById("username-form");
  var usernameInput = document.getElementById("account-username");
  var usernameSubmit = document.getElementById("username-submit");
  var usernameStatus = document.getElementById("username-status");
  var usernameLimit = document.getElementById("username-limit");

  var verifyHint = document.getElementById("verify-hint");
  var turnstileHolder = document.getElementById("account-turnstile");

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
  var names = window.TriarchsUsername;
  var money = new Intl.NumberFormat("en-US");
  var currentIdentity = null;
  var currentUsername = "";

  /* ---------------- local rate limiting ----------------
     Keyed by user id, because two accounts sharing a browser must not share a
     cooldown — signing out and in as somebody else would otherwise inherit
     the previous person's clock. Every read is defensive: private browsing,
     a full quota and a hand-edited value all have to degrade to "no limit
     recorded" rather than throwing, since the server enforces the real one
     regardless of what is found here. */

  var COOLDOWN_HOURS = 24;
  var ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
  var MAX_ATTEMPTS = 3;

  function storeKey(kind, identity) {
    return "triarchs.username." + kind + "." + (identity || "anon");
  }

  function readNumber(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      var value = parseInt(raw, 10);
      return isFinite(value) ? value : 0;
    } catch (err) { return 0; }
  }

  function writeValue(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (err) { /* full or private */ }
  }

  function readAttempts(identity) {
    var raw;
    try { raw = window.localStorage.getItem(storeKey("attempts", identity)); }
    catch (err) { return []; }
    if (!raw) return [];

    var parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return []; }
    if (Object.prototype.toString.call(parsed) !== "[object Array]") return [];

    var cutoff = Date.now() - ATTEMPT_WINDOW_MS;
    var live = [];
    for (var i = 0; i < parsed.length; i++) {
      var at = parseInt(parsed[i], 10);
      // A timestamp in the future is a tampered or clock-skewed entry; drop it
      // rather than letting it lock the button out for hours.
      if (isFinite(at) && at > cutoff && at <= Date.now()) live.push(at);
    }
    return live;
  }

  function recordAttempt(identity) {
    var live = readAttempts(identity);
    live.push(Date.now());
    try {
      window.localStorage.setItem(storeKey("attempts", identity), JSON.stringify(live));
    } catch (err) { /* full or private */ }
  }

  function clearAttempts(identity) {
    try { window.localStorage.removeItem(storeKey("attempts", identity)); }
    catch (err) { /* private mode */ }
  }

  /** ms until the account may change its username again, 0 when it may now. */
  function cooldownRemaining(identity) {
    var until = readNumber(storeKey("cooldownUntil", identity));
    if (!until) return 0;
    var left = until - Date.now();
    // A stored time more than the full cooldown away is not believable —
    // treat it as corrupt rather than honouring a decade-long lockout.
    if (left > COOLDOWN_HOURS * 3600 * 1000) return 0;
    return left > 0 ? left : 0;
  }

  /** ms until the hourly attempt budget frees up, 0 when attempts remain. */
  function attemptLockRemaining(identity) {
    var live = readAttempts(identity);
    if (live.length < MAX_ATTEMPTS) return 0;
    live.sort(function (a, b) { return a - b; });
    // The budget frees up when the OLDEST of the attempts leaves the window.
    var left = (live[live.length - MAX_ATTEMPTS] + ATTEMPT_WINDOW_MS) - Date.now();
    return left > 0 ? left : 0;
  }

  function formatDuration(ms) {
    var total = Math.ceil(ms / 1000);
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    if (hours > 0) {
      return hours + (hours === 1 ? " hour " : " hours ") +
             minutes + (minutes === 1 ? " minute" : " minutes");
    }
    if (minutes > 0) {
      return minutes + (minutes === 1 ? " minute " : " minutes ") +
             seconds + (seconds === 1 ? " second" : " seconds");
    }
    return seconds + (seconds === 1 ? " second" : " seconds");
  }

  function show(kind, message) {
    status.className = "auth-message is-" + kind;
    status.textContent = message;
    status.hidden = false;
  }
  function clearStatus() { status.hidden = true; status.textContent = ""; }

  function showName(kind, message) {
    usernameStatus.className = "auth-message is-" + kind;
    usernameStatus.textContent = message;
    usernameStatus.hidden = false;
  }
  function clearNameStatus() { usernameStatus.hidden = true; usernameStatus.textContent = ""; }

  /* ---------------- the shared Turnstile ----------------
     Mounted once, used by both forms. Tokens are single use, so whichever
     form spends one resets the widget for the next — that is why `reset` is
     called on every outcome and not only on failure.

     If Cloudflare never loads, `available` is false and getToken() resolves
     null. The username path treats that as a hard stop, because its Edge
     Function will refuse a tokenless request anyway and sending one would be
     a wasted round trip. The password path lets it through: Auth never saw
     the token to begin with, and blocking a password change because a
     third-party script was unreachable would lock people out of their own
     account for no security gain. */

  var turnstile = window.TriarchsTurnstile
    ? window.TriarchsTurnstile.mount(turnstileHolder, { action: "account" })
    : null;

  if (turnstile) {
    turnstile.ready.then(function (handle) {
      if (!handle.available) {
        verifyHint.textContent =
          "The verification check could not load. Username changes need it — " +
          "check your connection or any content blocker, then reload.";
      }
    });
  }

  function withToken() {
    if (!turnstile) return Promise.resolve(null);
    return turnstile.getToken();
  }

  function resetToken() {
    if (turnstile) turnstile.reset();
  }

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
      currentUsername = "";
      emailOut.textContent = "—";
      usernameInput.value = "";
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
      currentUsername = "";
      // Blank first, then fill from the database. A balance — or a name —
      // belonging to whoever was signed in a moment ago must never be shown
      // to the next person, not even for a frame.
      usernameInput.value = "";
      favourOut.textContent = "—";
      clearNameStatus();
      loadProfile(state.identity);
    }
  });

  function loadProfile(identity) {
    auth.client
      .from("player_accounts")
      // username_changed_at rides along on a query this page was making
      // anyway, which is what lets the cooldown be seeded from the server's
      // clock instead of only from localStorage — at the cost of no extra
      // request. A visitor who clears their site data gets the real remaining
      // time back the moment this page loads.
      .select("username, favour, username_changed_at")
      .single()
      .then(function (res) {
        // The session may have changed while the request was in flight.
        if (auth.state.identity !== identity) return;

        if (res.error || !res.data) {
          usernameInput.placeholder = "unavailable";
          favourOut.textContent = "—";
          refreshUsernameLock();
          return;
        }
        currentUsername = res.data.username || "";
        usernameInput.value = currentUsername;
        favourOut.textContent = money.format(res.data.favour);

        syncCooldownFromServer(identity, res.data.username_changed_at);
        refreshUsernameLock();
      });
  }

  /* Reconcile the local clock with the authoritative one. The server column
     wins in BOTH directions: it extends a cooldown that localStorage lost,
     and it clears one that localStorage is holding after the server has
     already moved on (a stale tab, a restored backup, a clock change). */
  function syncCooldownFromServer(identity, changedAt) {
    if (!changedAt) {
      // Never renamed, so there is nothing to serve out.
      writeValue(storeKey("cooldownUntil", identity), 0);
      return;
    }
    var at = Date.parse(changedAt);
    if (!isFinite(at)) return;
    writeValue(storeKey("cooldownUntil", identity), at + COOLDOWN_HOURS * 3600 * 1000);
  }

  /* ---------------- change username ---------------- */

  var nameBusy = false;

  function nameBusyState(isBusy) {
    nameBusy = isBusy;
    usernameInput.disabled = isBusy;
    usernameSubmit.textContent = isBusy ? "Changing…" : "Change username";
    refreshUsernameLock();
  }

  /* The single place that decides whether the button is usable and what the
     line beneath it says. Called on a timer while a lock is running, so the
     countdown ticks down in front of the visitor rather than going stale
     until they reload. */
  function refreshUsernameLock() {
    if (nameBusy) {
      usernameSubmit.disabled = true;
      usernameSubmit.classList.remove("is-locked");
      return;
    }

    var cooling = cooldownRemaining(currentIdentity);
    var blocked = attemptLockRemaining(currentIdentity);
    var locked = Math.max(cooling, blocked);

    usernameSubmit.disabled = locked > 0;
    usernameSubmit.classList.toggle("is-locked", locked > 0);

    if (cooling > 0 && cooling >= blocked) {
      usernameLimit.textContent =
        "You have changed your username in the last " + COOLDOWN_HOURS +
        " hours. You can change it again in " + formatDuration(cooling) + ".";
    } else if (blocked > 0) {
      usernameLimit.textContent =
        "Too many failed attempts. You can try again in " +
        formatDuration(blocked) + ".";
    } else {
      var used = readAttempts(currentIdentity).length;
      var left = MAX_ATTEMPTS - used;
      usernameLimit.textContent = used > 0
        ? "You can change your username once every " + COOLDOWN_HOURS +
          " hours. " + left + (left === 1 ? " attempt" : " attempts") +
          " left this hour."
        : "You can change your username once every " + COOLDOWN_HOURS + " hours.";
    }
  }

  // One shared ticker rather than one per lock. It only does work while
  // something is actually counting down, so an idle page costs nothing.
  window.setInterval(function () {
    if (nameBusy) return;
    if (cooldownRemaining(currentIdentity) > 0 ||
        attemptLockRemaining(currentIdentity) > 0) {
      refreshUsernameLock();
    }
  }, 1000);

  // Live shape feedback, entirely local — no request is made while typing,
  // and none ever will be. Availability is a question only the database can
  // answer, and asking it on every keystroke is exactly the traffic the brief
  // asked to avoid, so it is answered once, on submit.
  usernameInput.addEventListener("input", function () {
    usernameInput.removeAttribute("aria-invalid");
    clearNameStatus();
  });

  usernameForm.addEventListener("submit", function (event) {
    event.preventDefault();
    clearNameStatus();

    var wanted = usernameInput.value.trim();

    /* ---- local gates, cheapest first. None of these touch the network. ---- */

    var cooling = cooldownRemaining(currentIdentity);
    if (cooling > 0) {
      showName("error",
        "You can change your username again in " + formatDuration(cooling) + ".");
      refreshUsernameLock();
      return;
    }

    var blocked = attemptLockRemaining(currentIdentity);
    if (blocked > 0) {
      showName("error",
        "Too many failed attempts. Try again in " + formatDuration(blocked) + ".");
      refreshUsernameLock();
      return;
    }

    if (wanted === currentUsername) {
      showName("error", names.describe("unchanged"));
      usernameInput.focus();
      return;
    }

    var reason = names.reject(wanted);
    if (reason) {
      showName("error", names.describe(reason));
      usernameInput.setAttribute("aria-invalid", "true");
      usernameInput.focus();
      return;
    }

    /* ---- the check, then the one request ---- */

    nameBusyState(true);
    showName("info", "Changing your username…");

    withToken().then(function (token) {
      if (!token) {
        nameBusyState(false);
        showName("error", names.describe("captcha_required"));
        verifyHint.textContent =
          "Complete the verification check above, then press Change username.";
        turnstileHolder.scrollIntoView({ block: "center", behavior: "smooth" });
        return null;
      }

      return auth.callFunction("change-username", {
        authenticated: true,
        body: { username: wanted, captchaToken: token }
      }).then(function (res) {
        // Spent either way: a token is single use, so the widget is reset
        // before anything else can go wrong.
        resetToken();
        verifyHint.textContent = "";

        var payload = res.body || {};
        nameBusyState(false);

        if (res.ok && payload.ok) {
          currentUsername = payload.username || wanted;
          usernameInput.value = currentUsername;
          clearAttempts(currentIdentity);
          writeValue(
            storeKey("cooldownUntil", currentIdentity),
            payload.cooldownUntil
              ? Date.parse(payload.cooldownUntil)
              : Date.now() + COOLDOWN_HOURS * 3600 * 1000
          );
          refreshUsernameLock();
          showName("success",
            "Your username is now " + currentUsername +
            ". Other players will see it the next time you play.");
          return;
        }

        /* A refusal that reached Supabase costs one attempt — that is the
           budget the brief describes. A cooldown is the exception: it is not
           a failed guess at a name, it is the rule already working, and
           charging for it would punish somebody twice for one change. */
        if (payload.error !== "cooldown") recordAttempt(currentIdentity);

        if (payload.error === "cooldown" && payload.cooldownUntil) {
          writeValue(
            storeKey("cooldownUntil", currentIdentity),
            Date.parse(payload.cooldownUntil)
          );
        }

        refreshUsernameLock();
        usernameInput.setAttribute("aria-invalid", "true");
        showName("error", payload.message || names.describe(payload.error));
      });
    }).catch(function () {
      resetToken();
      nameBusyState(false);
      // A transport failure is not a rejected name, so it is not charged
      // against the hourly budget — the request may never have arrived.
      showName("error", names.describe("temporary_failure"));
    });
  });

  refreshUsernameLock();

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

    /* The shared check. See the header for why this is a deterrent here and a
       real control on the username path: updateUser() takes no captcha
       argument, so there is nothing to hand Supabase even if we wanted to.
       A widget that failed to load is therefore allowed through — refusing
       would lock somebody out of their own password because a third-party
       script was blocked, and would buy nothing, since the token was never
       going to be verified anywhere. */
    if (turnstile && turnstile.available && !turnstile.token) {
      show("error", "Complete the verification check below, then press Change password.");
      verifyHint.textContent =
        "Complete the verification check above, then press Change password.";
      turnstileHolder.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    verifyHint.textContent = "";

    busy(true);
    show("info", "Changing your password…");

    var payload = { password: next };
    if (nonce) payload.nonce = nonce;

    auth.client.auth.updateUser(payload).then(function (result) {
      // Spent, whatever the outcome — tokens are single use, and the
      // reauthentication round trip below counts as a second submission.
      resetToken();
      if (result.error) throw result.error;

      newPassword.value = "";
      newPasswordConfirm.value = "";
      reauthCode.value = "";
      reauthField.hidden = true;
      busy(false);
      show("success", "Your password has been changed.");
    }).catch(function (error) {
      resetToken();
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
