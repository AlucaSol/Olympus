// Exercises js/username.js — the browser-side mirror of migration 015's
// username rules. Pure logic, no browser and no network, so it runs in
// milliseconds and can sit in front of every other layer.
//
// Two things it is really checking:
//   1. the filter catches what it is supposed to, THROUGH the evasions people
//      actually use (leetspeak, separators, padding);
//   2. it does not catch what it must not. A Greek-myth game is full of names
//      like Cassandra and Cockatrice, and a filter that eats them is a worse
//      bug than one that misses a slur — the server still has the final say on
//      the miss, but nothing recovers a player who was told their real name is
//      obscene.
//
// Run: node tests/username.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "js", "username.js"), "utf8");

// The site's scripts are plain browser IIFEs that hang themselves off window.
const sandbox = { window: {} };
new Function("window", source)(sandbox.window);
const U = sandbox.window.TriarchsUsername;

let failures = 0;
function check(ok, label) {
  if (ok) return;
  failures++;
  console.log("  FAIL  " + label);
}

function rejects(name, expected, label) {
  const got = U.reject(name);
  check(got === expected,
    (label || `"${name}"`) + ` → expected ${expected}, got ${got}`);
}

function accepts(name) {
  const got = U.reject(name);
  check(got === null, `"${name}" should be accepted, got ${got}`);
}

/* ---------------- shape ---------------- */

console.log("shape");
rejects("", "empty");
rejects("  ", "empty");
rejects("ab", "too_short");
rejects("abcd", "too_short");
accepts("abcde");
accepts("a".repeat(20));
rejects("a".repeat(21), "too_long");
rejects("has space", "invalid_characters");
rejects("dots.here", "invalid_characters");
rejects("plus+one", "invalid_characters");
rejects("hash#tag", "invalid_characters");
rejects("emoji🔥here", "invalid_characters");
rejects("_____", "invalid_characters", "punctuation-only name");
rejects("-----", "invalid_characters", "dash-only name");
rejects("__-__", "invalid_characters", "mixed punctuation, no letters or digits");

// The brief's character set, in full.
accepts("Jonny_Bravo-99");
accepts("UPPER");
accepts("lower");
accepts("123456");
accepts("a-b_c");

/* ---------------- case handling ----------------
   Uniqueness is the database's job (citext), but the client must not treat
   capitalisation as a reason to refuse anything. */

console.log("case");
accepts("Jonny");
accepts("jONny");
check(U.fold("JoNNy") === U.fold("jonny"), "folding is case-insensitive");

/* ---------------- profanity, and the evasions ---------------- */

console.log("profanity");
rejects("fuckface", "not_allowed");
rejects("FUCKFACE", "not_allowed", "uppercase");
rejects("f_u_c_k_e_r", "not_allowed", "underscore separators");
rejects("f-u-c-k-e-r", "not_allowed", "dash separators");
rejects("fuuuuck", "not_allowed", "padded vowels");
rejects("Sh1thead", "not_allowed", "digit homoglyph");
rejects("n1gg3r", "not_allowed", "multiple homoglyphs");
rejects("N_1_G_G_3_R", "not_allowed", "homoglyphs plus separators");
rejects("xxHitlerxx", "not_allowed", "padded on both sides");
rejects("b1tch", "not_allowed");
rejects("cunt99", "not_allowed");

// Exact-only terms: blocked alone, allowed inside a longer word.
rejects("admin", "not_allowed");
rejects("Admin", "not_allowed", "exact match is case-insensitive");
rejects("ADMIN", "not_allowed");
rejects("guest", "not_allowed");
rejects("staff", "not_allowed");
rejects("player", "not_allowed");
rejects("system", "not_allowed");
rejects("olympus", "not_allowed");

// Exact terms below the 5-character minimum are unreachable now — the length
// rule fires first. They stay in the list against min_length ever being
// lowered, so what is asserted here is the ORDER, not that they are allowed.
rejects("cum", "too_short");
rejects("coon", "too_short");
rejects("gook", "too_short");

/* ---------------- the false positives that would hurt ----------------
   Every one of these is a name a real player might reasonably want on a game
   about Greek myth. If this block ever starts failing, the blocklist has been
   made too aggressive. */

console.log("innocent names");
accepts("Cassandra");        // contains "ass"
accepts("Cockatrice");       // contains "cock"
accepts("Cumaean");          // contains "cum" — the Cumaean Sibyl
accepts("Conall");           // collapses toward "conal"
accepts("Analyst");          // contains "anal"
accepts("Dickens");          // contains "dick"
accepts("Scunthorpe");       // the canonical case
accepts("Adminius");         // a real Celtic king, and not "admin"
accepts("Modestus");         // not "mod"
accepts("Staffordshire".slice(0, 18));
accepts("Titan");            // near "tits", must not trip
accepts("Assassin");
accepts("Sussex");
accepts("Hercules");
accepts("Penelope");         // near "penis", must not trip
accepts("Rapier");           // "rape" is exact-only for precisely this
accepts("Grapeshot");
accepts("Torpedo");          // "pedo" is exact-only for precisely this
accepts("Lynchpin");         // "lynch" is exact-only
accepts("Serverus");         // not "server"
accepts("Player1");          // "player" is exact-only
accepts("Youssef");          // "you" is exact-only

// The Scunthorpe problem, and the Australian and English place names that are
// the same problem wearing a different hat. These pass only because of the
// allow-list, so they are the canary for it being dropped.
console.log("allow-list");
accepts("Scunthorpe");
accepts("Cockburn");         // a Perth suburb
accepts("Penistone");
accepts("Cumbria");
accepts("Cummings");
accepts("Peacock");
accepts("Hancock");
accepts("Shiitake");
accepts("Clitheroe");
accepts("Titania");
// The allow-list matches whole names only, so it cannot be used as a shield.
rejects("Scunthorpefuck", "not_allowed", "allow-list is not a prefix pass");
// "scunthorpe" is allowed only as the whole name; padded, the "cunt" inside it
// is reached by the substring rule again.
rejects("xxScunthorpexx", "not_allowed", "allow-list is not a substring pass");

/* ---------------- folding itself ---------------- */

console.log("folding");
check(U.fold("f_u_c_k") === "fuck", "separators are dropped");
check(U.fold("n1gg3r") === "nigger", "digits resolve to letters");
check(U.fold("@$!") === "asi", "symbol homoglyphs resolve");
check(U.fold("gook") === "gook", "runs are NOT collapsed by fold()");
// 1 and 3 map to i and e; 2 has no letter it plausibly stands in for, so it is
// dropped like any other non-letter. Dropping is the safe direction — it makes
// "f2uck" fold to "fuck" and be caught, rather than sliding past.
check(U.fold("123") === "ie", "mapped digits become letters, unmapped are dropped");
check(U.fold("f2uck") === "fuck", "an unmapped digit does not shield a blocked word");

/* ---------------- messages ---------------- */

console.log("messages");
for (const code of ["empty", "too_short", "too_long", "invalid_characters",
  "not_allowed", "taken", "unchanged", "changes_disabled", "cooldown",
  "no_account", "captcha_failed", "captcha_required", "rate_limited",
  "invalid_request", "temporary_failure"]) {
  const m = U.describe(code);
  check(typeof m === "string" && m.length > 5, `describe(${code}) returns real text`);
}
check(U.describe("something_new") === U.describe("temporary_failure"),
  "an unknown code falls back rather than showing undefined");

// The agreed range: 5 to 20, the 20 chosen to match what the game client
// already truncates a peer-supplied username to.
check(U.MIN_LENGTH === 5, `MIN_LENGTH is 5, got ${U.MIN_LENGTH}`);
check(U.MAX_LENGTH === 20, `MAX_LENGTH is 20, got ${U.MAX_LENGTH}`);

console.log();
if (failures) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exitCode = 1;
} else {
  console.log("OK — username rules behave, and leave innocent names alone.");
}
