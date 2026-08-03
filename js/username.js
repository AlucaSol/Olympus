/* ==========================================================================
   TRIARCHS OF OLYMPUS — username rules, browser side
   --------------------------------------------------------------------------
   A MIRROR, NOT A GATE. Every rule here also exists in migration 015, and the
   database is the authority on all of them — it holds the real blocklist, the
   real cooldown clock and the unique index that actually decides whether a
   name is free. Nothing in this file is a security control; a visitor can
   delete it from devtools and the server will still refuse them.

   What it IS for: not spending a Supabase request to be told something this
   page already knows. A name that is too long, has a comma in it, or contains
   an obvious slur can be rejected here in under a millisecond, and the round
   trip is never made. That is the whole point — the brief asked for the
   Supabase traffic to be kept down, and refusing to send doomed requests is
   the largest part of doing that.

   KEEP IN STEP WITH 015. If you change the character set, the length cap or
   the folding here, change public.username_rejection() and
   public.fold_username() to match. Where the two ever disagree the server
   wins, and the visible symptom is a name this page accepts and the server
   then refuses — annoying, but never unsafe. The reverse (this page refusing
   something the server would allow) is the one to avoid, so when in doubt
   this side should be the more permissive of the two.
   ========================================================================== */
(function () {
  "use strict";

  // 20 is what the game client already truncates a peer-supplied name to, so
  // nothing choosable here can be shortened in a lobby. Mirrors the defaults
  // in public.username_config.
  var MIN_LENGTH = 5;
  var MAX_LENGTH = 20;

  var ALLOWED = /^[A-Za-z0-9_-]+$/;
  var HAS_ALNUM = /[A-Za-z0-9]/;

  /* ---------------- folding ----------------
     Mirrors public.fold_username(). Lowercase, resolve the homoglyphs people
     reach for, then drop everything that is not a letter, so `N1GG3R`,
     `n_i_g_g_e_r` and `n.i.g.g.e.r` all arrive at the same skeleton.

     Runs of repeated letters are deliberately NOT collapsed here; that is done
     at match time on both sides, for the reason given in 015: collapsing turns
     "coon" into "con" and would cost every player named Conall their name. */

  var LEET_FROM = "@$!01345789|+";
  var LEET_TO   = "asioieastbglt";

  function fold(value) {
    var lower = String(value == null ? "" : value).toLowerCase();
    var out = "";
    for (var i = 0; i < lower.length; i++) {
      var ch = lower.charAt(i);
      var swap = LEET_FROM.indexOf(ch);
      if (swap !== -1) ch = LEET_TO.charAt(swap);
      if (ch >= "a" && ch <= "z") out += ch;
    }
    return out;
  }

  function collapse(value) {
    return value.replace(/(.)\1+/g, "$1");
  }

  /* ---------------- blocklist ----------------
     A copy of the common cases from migration 015's seed, in the same folded,
     plainly-spelled form. It is deliberately NOT the whole table: the table can
     be extended from the SQL editor at any hour without redeploying this site,
     so treating this array as complete would be wrong. Anything it misses is
     caught server side and reported back as `not_allowed`. */

  var BLOCK_SUBSTRING = [
    "nigger", "nigga", "faggot", "trannie", "tranny", "retard", "spastic",
    "chink", "kike", "wetback",
    "fuck", "shit", "cunt", "bitch", "whore", "slut", "rapist", "pedophile",
    "paedophile", "incest", "bestiality", "penis", "vagina", "boner", "wanker",
    "bastard",
    "hitler", "nazi", "holocaust", "heilhitler", "gaschamber"
  ];

  /* Innocent words that contain a blocked substring. Checked FIRST and
     matched against the whole folded name, so "Scunthorpe" is fine and
     "Scunthorpefuck" is not. This is the standard answer to the Scunthorpe
     problem, and it is not optional: "Cockburn" is a Perth suburb, "Penistone"
     and "Lightwater" are English towns, and "Cumbria" is a county. A filter
     that tells someone their own home town is obscene is worse than one that
     lets a rude name through, because the server catches the rude name and
     nothing catches the insult. */
  var ALLOW_EXACT = [
    "scunthorpe", "penistone", "lightwater", "clitheroe",
    "cockburn", "cockfosters", "cockermouth", "babcock", "hancock", "peacock",
    "cumbria", "cumberland", "cummings", "cumming", "cumaean", "succumb",
    "assange", "shiitake", "matsushita", "dickinson", "dickson",
    "arsenal", "titan", "titania", "titanic", "constitution"
  ];

  var BLOCK_EXACT = [
    "gook", "coon", "paki",
    "rape", "pedo", "dick", "cock", "cum", "anal", "anus", "tits",
    "kkk", "lynch",
    "admin", "administrator", "moderator", "mod", "staff", "support",
    "helpdesk", "system", "official", "triarchs", "triarch", "olympus",
    "alucasol", "developer", "server", "root", "owner",
    "null", "undefined", "anonymous", "guest", "player", "you"
  ];

  /** null when acceptable, else a reason code matching 015's vocabulary. */
  function reject(value) {
    var name = String(value == null ? "" : value).trim();

    if (!name) return "empty";
    if (name.length < MIN_LENGTH) return "too_short";
    if (name.length > MAX_LENGTH) return "too_long";
    if (!ALLOWED.test(name)) return "invalid_characters";
    if (!HAS_ALNUM.test(name)) return "invalid_characters";

    // Several exact terms are shorter than MIN_LENGTH and so unreachable at
    // the current settings. They stay for the same reason the database keeps
    // them: the minimum is configuration, and lowering it must not quietly
    // reopen them.
    var folded = fold(name);
    if (folded) {
      for (var a = 0; a < ALLOW_EXACT.length; a++) {
        if (folded === ALLOW_EXACT[a]) return null;
      }

      var squashed = collapse(folded);
      for (var i = 0; i < BLOCK_EXACT.length; i++) {
        if (folded === BLOCK_EXACT[i]) return "not_allowed";
      }
      for (var j = 0; j < BLOCK_SUBSTRING.length; j++) {
        var term = BLOCK_SUBSTRING[j];
        if (folded.indexOf(term) !== -1) return "not_allowed";
        if (squashed.indexOf(collapse(term)) !== -1) return "not_allowed";
      }
    }
    return null;
  }

  /* ---------------- wording ----------------
     One place, so the signup form and the account page cannot drift into
     describing the same rule two different ways. `not_allowed` is worded
     without repeating what was detected — telling someone precisely which
     substring tripped the filter is a recipe for finding the gaps in it. */

  var MESSAGES = {
    empty: "Choose a username.",
    too_short: "Usernames need at least " + MIN_LENGTH + " characters.",
    too_long: "Usernames can be at most " + MAX_LENGTH + " characters.",
    invalid_characters:
      "Usernames can use letters, numbers, dashes and underscores only.",
    not_allowed: "That username is not available. Please choose another.",
    taken: "That username is already taken.",
    unchanged: "That is already your username.",
    changes_disabled: "Username changes are switched off at the moment.",
    cooldown: "You have already changed your username recently.",
    no_account: "We could not find your account. Sign in again and retry.",
    captcha_failed: "The verification check did not pass. Try it again.",
    captcha_required: "Complete the verification check first.",
    rate_limited: "Too many attempts just now. Please wait and try again.",
    invalid_request: "We could not process that. Refresh the page and retry.",
    temporary_failure:
      "We could not reach the account service. Check your connection and try again."
  };

  function describe(reason) {
    return MESSAGES[reason] || MESSAGES.temporary_failure;
  }

  window.TriarchsUsername = {
    MIN_LENGTH: MIN_LENGTH,
    MAX_LENGTH: MAX_LENGTH,
    fold: fold,
    reject: reject,
    describe: describe
  };
})();
