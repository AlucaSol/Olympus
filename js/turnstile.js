/* ==========================================================================
   TRIARCHS OF OLYMPUS — Cloudflare Turnstile helper
   --------------------------------------------------------------------------
   Renders the widget and hands its token to whoever is submitting a form.

   The token proves nothing on its own — it is verified by Supabase Auth
   against Cloudflare using the *secret* key, which lives in the Supabase
   dashboard and never touches this site. A visitor who deletes this script,
   forges a token, or posts directly to the Auth endpoint gets rejected server
   side, so nothing here is a security control. It is the polite half of one.

   Tokens are single use and short lived, so every successful submit resets the
   widget and the next attempt gets a fresh one. A submit that fails also
   resets it, otherwise a second try would replay a spent token and be refused
   for the wrong reason.
   ========================================================================== */
(function () {
  "use strict";

  var API = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var loadPromise = null;

  function loadApi() {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(function (resolve, reject) {
      if (window.turnstile) { resolve(window.turnstile); return; }

      var script = document.createElement("script");
      script.src = API;
      script.async = true;
      script.defer = true;
      script.onload = function () {
        // The API object appears a tick after onload in some browsers.
        if (window.turnstile) { resolve(window.turnstile); return; }
        var tries = 0;
        var poll = setInterval(function () {
          if (window.turnstile) { clearInterval(poll); resolve(window.turnstile); }
          else if (++tries > 40) { clearInterval(poll); reject(new Error("turnstile_unavailable")); }
        }, 50);
      };
      script.onerror = function () { reject(new Error("turnstile_unavailable")); };
      document.head.appendChild(script);
    });

    return loadPromise;
  }

  // Mounts a widget into `container` and returns a handle. The handle works
  // even if Cloudflare never loads: `available` goes false, `getToken()`
  // resolves to null, and the caller decides what to do about it.
  function mount(container, options) {
    options = options || {};
    var cfg = window.TRIARCHS_CONFIG || {};
    var handle = {
      available: false,
      widgetId: null,
      error: null,
      token: null
    };

    if (!container) {
      handle.error = new Error("no_container");
      handle.ready = Promise.resolve(handle);
      return handle;
    }

    handle.ready = loadApi().then(function (turnstile) {
      handle.widgetId = turnstile.render(container, {
        sitekey: cfg.turnstileSiteKey,
        theme: "dark",
        action: options.action || "submit",
        callback: function (token) { handle.token = token; },
        "expired-callback": function () { handle.token = null; },
        "error-callback": function () { handle.token = null; }
      });
      handle.available = true;
      return handle;
    }).catch(function (err) {
      handle.error = err;
      handle.available = false;
      return handle;
    });

    handle.getToken = function () {
      return handle.ready.then(function () {
        if (!handle.available) return null;
        // Prefer whatever the widget currently holds; fall back to asking it.
        if (handle.token) return handle.token;
        try {
          var t = window.turnstile.getResponse(handle.widgetId);
          return t || null;
        } catch (err) {
          return null;
        }
      });
    };

    handle.reset = function () {
      handle.token = null;
      if (!handle.available || !window.turnstile) return;
      try { window.turnstile.reset(handle.widgetId); } catch (err) { /* widget gone */ }
    };

    return handle;
  }

  window.TriarchsTurnstile = { mount: mount };
})();
