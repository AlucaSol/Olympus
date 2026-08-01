/* ==========================================================================
   TRIARCHS OF OLYMPUS — shared authentication state
   --------------------------------------------------------------------------
   One Supabase client for the whole site, one source of truth for "is anyone
   signed in", and the nav wiring that depends on it.

   THE RULE THIS FILE EXISTS TO ENFORCE: authentication state comes from the
   real Supabase session and nothing else. Not a username in localStorage, not
   a "logged in" flag, not an email address the visitor could edit — those are
   all writable by whoever is sitting at the browser, and a page that trusts
   them is a page that can be talked into showing someone else's account. Every
   consumer here reads `session.user.id`, which is derived from a signed JWT
   that only Supabase can mint.

   That JWT is also the *only* thing the server trusts. Nothing on this side of
   the wire decides a price, a balance or an entitlement; the browser's job is
   to ask politely and render the answer.
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.TRIARCHS_CONFIG;
  if (!cfg) {
    console.error("[auth] js/config.js must be loaded before js/auth.js");
    return;
  }
  if (typeof window.supabase === "undefined") {
    console.error("[auth] the Supabase client bundle failed to load");
    return;
  }

  var client = window.supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Needed so a visitor arriving from a confirmation or recovery email
        // has their link consumed and turned into a session.
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    }
  );

  /* ---------------- state ---------------- */

  var state = {
    ready: false,
    session: null,
    user: null,
    // Changes whenever the *identity* changes, including to and from null.
    // Consumers key their cached data on this so a stale balance from a
    // previous account can never be shown to the next one.
    identity: null
  };

  var listeners = [];
  var resolveReady;
  var readyPromise = new Promise(function (resolve) { resolveReady = resolve; });

  function snapshot() {
    return {
      ready: state.ready,
      session: state.session,
      user: state.user,
      identity: state.identity,
      signedIn: !!state.user
    };
  }

  function emit(event) {
    var snap = snapshot();
    snap.event = event;
    listeners.forEach(function (fn) {
      try { fn(snap); } catch (err) { console.error("[auth] listener failed", err); }
    });
  }

  function applySession(session, event) {
    var nextIdentity = session && session.user ? session.user.id : null;
    var changed = nextIdentity !== state.identity;

    state.session = session || null;
    state.user = session && session.user ? session.user : null;
    state.identity = nextIdentity;

    updateNav();
    emit(event || (changed ? "IDENTITY_CHANGED" : "REFRESH"));
  }

  /* ---------------- nav ----------------

     One button, two destinations. Logged in it goes to the profile page;
     logged out it goes to the login page. The label stays "Account" either
     way — it names the destination, not the action, so it does not flicker
     between "Login" and "Logout" while the session is being restored.        */

  function updateNav() {
    var signedIn = !!state.user;
    document.querySelectorAll("[data-nav-account]").forEach(function (el) {
      el.setAttribute("href", signedIn ? "account.html" : "login.html");
      el.setAttribute(
        "aria-label",
        signedIn ? "Account — signed in" : "Account — sign in"
      );
      el.classList.toggle("is-signed-in", signedIn);
    });
  }

  /* ---------------- boot ----------------

     getSession() reads the persisted session and refreshes it if it has
     expired, so a hard refresh restores the signed-in state rather than
     silently dropping to logged-out. onAuthStateChange then keeps every page
     current for the rest of its life: sign-in, sign-out, token refresh,
     a confirmation link being consumed, and expiry are all delivered here.  */

  client.auth.getSession()
    .then(function (res) {
      state.ready = true;
      applySession(res && res.data ? res.data.session : null, "INITIAL_SESSION");
      resolveReady(snapshot());
    })
    .catch(function (err) {
      // A network failure must not leave the page pretending to be signed in.
      console.warn("[auth] could not restore session", err);
      state.ready = true;
      applySession(null, "INITIAL_SESSION");
      resolveReady(snapshot());
    });

  client.auth.onAuthStateChange(function (event, session) {
    state.ready = true;
    applySession(session, event);
  });

  /* ---------------- helpers ---------------- */

  function absoluteUrl(path) {
    return new URL(path, window.location.href).href;
  }

  // Calls one of our Edge Functions. `authenticated: true` attaches the
  // caller's access token so the function can derive the user id from it
  // rather than believing a body field.
  function callFunction(name, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };

    var chain = Promise.resolve(null);
    if (options.authenticated) {
      chain = client.auth.getSession().then(function (res) {
        var session = res && res.data ? res.data.session : null;
        if (!session) throw new Error("not_authenticated");
        headers.Authorization = "Bearer " + session.access_token;
        return session;
      });
    }

    return chain.then(function () {
      return fetch(cfg.functionsUrl + "/" + name, {
        method: options.method || "POST",
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    }).then(function (response) {
      return response.json()
        .catch(function () { return {}; })
        .then(function (payload) {
          return { status: response.status, ok: response.ok, body: payload };
        });
    });
  }

  function signOut() {
    return client.auth.signOut().then(function (res) {
      // Belt and braces: onAuthStateChange will fire SIGNED_OUT, but clearing
      // here too means no page can render a stale user between the two.
      applySession(null, "SIGNED_OUT");
      return res;
    });
  }

  window.TriarchsAuth = {
    client: client,
    ready: readyPromise,
    get state() { return snapshot(); },
    onChange: function (fn) {
      listeners.push(fn);
      if (state.ready) {
        var snap = snapshot();
        snap.event = "SUBSCRIBE";
        try { fn(snap); } catch (err) { console.error("[auth] listener failed", err); }
      }
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    signOut: signOut,
    callFunction: callFunction,
    absoluteUrl: absoluteUrl,
    // Random enough that two tabs cannot collide, used as an idempotency key.
    newRequestId: function () {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = Array.prototype.map.call(bytes, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
             "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    }
  };

  // Paint the nav immediately so it never renders without an href.
  updateNav();
})();
