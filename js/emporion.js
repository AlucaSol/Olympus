/* ==========================================================================
   EMPORION OF OLYMPUS — storefront catalogue + panel behaviour

   TWO KINDS OF STOCK LIVE ON THIS SHELF.

     Game items  — maps, champions, ultimates, Boons. Bought WITH Favour.
                   The descriptions below are transcribed from
                   assets/emporion/EMPORION_STORE_DATA.txt so the page reads
                   correctly with no network, but they are display copy only:
                   the price that is actually charged is read from
                   public.shop_items by purchase_shop_item() in the database.
                   Editing a number here changes what a visitor is shown and
                   nothing whatsoever about what they are charged.

     Favour      — bundles of Favour bought with REAL MONEY through Stripe.
                   Same rule: the amount, the currency and the quantity of
                   Favour all come from public.favour_bundles server-side. The
                   browser sends a bundle id and an idempotency key, and can
                   name no price at all.

   Nothing in this file is a security control. Ownership, balance, prices and
   entitlements are all decided by the database; this is the part that draws
   the answer.
   ========================================================================== */
(function () {
  "use strict";

  var UI = "./assets/emporion/ui/";
  var FAVOUR_ICON = UI + "favour-placeholder.png";
  var PLACEHOLDER = UI + "shop-item-placeholder.png";

  /* Category display order and filter-card icons (from src/types/shop.ts).
     `favour` is first deliberately: whenever more than one category is on
     screen, the Favour bundles lead. */
  var CATEGORIES = [
    { id: "favour",    label: "Favour",    icon: UI + "favour-placeholder.png" },
    { id: "maps",      label: "Maps",      icon: UI + "shop-cat-maps.png" },
    { id: "heroes",    label: "Heroes",    icon: UI + "shop-cat-heroes.png" },
    { id: "items",     label: "Items",     icon: UI + "shop-cat-items.png" },
    { id: "abilities", label: "Abilities", icon: UI + "shop-cat-abilities.png" },
    { id: "boons",     label: "Boons",     icon: UI + "shop-cat-boons.svg" },
    { id: "cosmetics", label: "Cosmetics", icon: UI + "shop-cat-cosmetics.png" }
  ];

  var CATALOGUE = [
    /* ---------------- battlefields ---------------- */
    {
      id: "map_thalassia",
      category: "maps",
      name: "Thalassia, the Sunlit Harbour",
      cost: 350,
      sort: 10,
      icon: "./assets/emporion/maps/thalassia.png",
      accent: "#d8a24c",
      prefix: "Own it to host matches on this battlefield.",
      desc: "A bright Aegean island town, ringed by open sea. Three walled harbour districts look inward over a crowded suburb of plastered houses — long avenues, alley cut-throughs, and courtyards you can fight your way through. Colonnaded halls shelter the monster yards, and the great temple at the agora stands over the Titan's ground itself.",
      effects: [
        "Only the host needs to own it — every peer plays on whatever map the host picks.",
        "The Labyrinth remains free to everyone, guests included."
      ]
    },

    /* ---------------- champions ---------------- */
    {
      id: "brontes",
      category: "heroes",
      name: "Brontes",
      cost: 200,
      sort: 10,
      icon: "./assets/characters/brontes-icon.png",
      accent: "#f0c04a",
      prefix: "Smith of Thunder — Siege Engineer.",
      desc: "One of the immortal Cyclopes who hammered out Zeus' first thunderbolt — a Siege Engineer who reshapes the ground with forges and walls.",
      lore: "One of the immortal Cyclopes who hammered out Zeus' first thunderbolt. Now he walks the battlefield, reforging it to his liking.",
      effects: [
        "Strengths: reshapes ground with forges and walls; sieges like an army.",
        "Weaknesses: ponderous; easily kited once his works are down.",
        "Ships with his level 20 ability, Forge of Olympus, already unlocked."
      ]
    },
    {
      id: "lykaon",
      category: "heroes",
      name: "Lykaon",
      cost: 200,
      sort: 20,
      icon: "./assets/characters/lykaon-icon.png",
      accent: "#c9435c",
      prefix: "The Moon-Cursed — Predator.",
      desc: "King Lykaon mocked Zeus and was made the first werewolf for it — a Predator who runs down isolated heroes under Artemis' patient moonlight.",
      lore: "King Lykaon mocked Zeus and was made the first werewolf for it. Under Artemis' patient moonlight, the punishment became a weapon.",
      effects: [
        "Strengths: runs down isolated heroes; patience makes his first strike terrible.",
        "Weaknesses: melee only; brawls poorly once the ambush is spent.",
        "Ships with his level 20 ability, Apex Predator, already unlocked."
      ]
    },

    /* ---------------- level-20 ability unlocks ---------------- */
    {
      id: "alkaios_ultimate", category: "abilities", name: "Alkaios — Rite of the Fallen",
      cost: 50, sort: 10, hero: "Alkaios", accent: "#c9944c",
      icon: "./assets/emporion/abilities/alkaios-ultimate.png",
      desc: "Executioner strike: heavy damage, doubled below 35% HP. Cooldown resets on kill."
    },
    {
      id: "kyra_ultimate", category: "abilities", name: "Kyra — Heartseeker",
      cost: 50, sort: 20, hero: "Kyra", accent: "#a3c94c",
      icon: "./assets/emporion/abilities/kyra-ultimate.png",
      desc: "After a breath, fire an arrow across the battlefield. Damage grows with distance travelled (up to +100%)."
    },
    {
      id: "skiron_ultimate", category: "abilities", name: "Skiron — Tempest Heart",
      cost: 50, sort: 30, hero: "Skiron", accent: "#7fe0e8",
      icon: "./assets/emporion/abilities/skiron-ultimate.png",
      desc: "Become the storm: a whirlwind around you deals damage 4 times over 2.5 seconds and hurls enemies back."
    },
    {
      id: "thalassa_ultimate", category: "abilities", name: "Thalassa — Deluge of the Drowned",
      cost: 50, sort: 40, hero: "Thalassa", accent: "#4a90d9",
      icon: "./assets/emporion/abilities/thalassa-ultimate.png",
      desc: "Summon a towering wave that sweeps a long line, dealing massive damage, knocking enemies aside and stunning them for 1.2 seconds."
    },
    {
      id: "lysander_ultimate", category: "abilities", name: "Lysander — Grand Muster",
      cost: 50, sort: 50, hero: "Lysander", accent: "#8fa8c9",
      icon: "./assets/emporion/abilities/lysander-ultimate.png",
      desc: "A vast rally: up to 10 friendly mobs in a wide radius follow you for 18 seconds with +25% damage."
    },
    {
      id: "doria_ultimate", category: "abilities", name: "Doria — Aegis of Ages",
      cost: 50, sort: 60, hero: "Doria", accent: "#b09868",
      icon: "./assets/emporion/abilities/doria-ultimate.png",
      desc: "Grant nearby friendly mobs a 200 HP shield and become invulnerable yourself for 2.5 seconds."
    },
    {
      id: "iole_ultimate", category: "abilities", name: "Iole — Gaia's Embrace",
      cost: 50, sort: 70, hero: "Iole", accent: "#5cbf6e",
      icon: "./assets/emporion/abilities/iole-ultimate.png",
      desc: "A great bloom: massively heal yourself and friendly mobs, granting all +25% speed and damage for 6 seconds."
    },
    {
      id: "pyrrhos_ultimate", category: "abilities", name: "Pyrrhos — Wrath of Kronos",
      cost: 50, sort: 80, hero: "Pyrrhos", accent: "#e85c3c",
      icon: "./assets/emporion/abilities/pyrrhos-ultimate.png",
      desc: "Call down a Titan meteor. After 1.4 seconds it lands for devastating damage and a 1 second stun."
    },
    {
      id: "eurydice_ultimate", category: "abilities", name: "Eurydice — The Final Prophecy",
      cost: 50, sort: 90, hero: "Eurydice", accent: "#a86ce0",
      icon: "./assets/emporion/abilities/eurydice-ultimate.png",
      desc: "Reveal a vast region for 8 seconds: all fog, thickets and hidden enemies within are laid bare to your whole empire, and stealth is stripped away."
    },
    {
      id: "harmonia_ultimate", category: "abilities", name: "Harmonia — Harmony's Decree",
      cost: 50, sort: 100, hero: "Harmonia", accent: "#e0a0c8",
      icon: "./assets/emporion/abilities/harmonia-ultimate.png",
      desc: "For 10 seconds every enemy empire's mob forgets its quarrels and marches only on towers and bases, flooding every lane with pressure."
    },

    /* ---------------- boons ---------------- */
    {
      id: "boon_dionysus_revelry",
      category: "boons",
      name: "Dionysus' Revelry",
      cost: 100,
      sort: 10,
      accent: "#a855c8",
      icon: "./assets/emporion/boons/dionysus-revelry.svg",
      prefix: "A boon of Dionysus — costs 260 Tribute in-match.",
      desc: "Hurl a divine wine casket. The stain maddens every enemy it touches for 8 seconds: weaker blows, narrowed sight, staggering steps, and abilities loosed at nothing.",
      lore: "A cask of the god's own vintage, hurled from the heights of Olympus. What it soaks, it maddens.",
      effects: [
        "Lob a divine wine casket to any visible ground; it arcs slowly, like a catapult stone.",
        "The splash stains the earth for 8s. Enemies caught in it turn Drunk.",
        "Drunk: -15% damage, badly narrowed vision, staggering steps, and hands that lose their target.",
        "Drunk champions sometimes loose their Q at nothing at all."
      ]
    },
    {
      id: "boon_demeter_harvest",
      category: "boons",
      name: "Demeter's Harvest",
      cost: 100,
      sort: 20,
      accent: "#7fc25e",
      icon: "./assets/emporion/boons/demeter-harvest.svg",
      prefix: "A boon of Demeter — costs 290 Tribute in-match.",
      desc: "Raise a Sacred Grove around yourself for 10 seconds. Allies inside heal and cool their abilities faster, enemies are slowed, and labyrinth monsters strike softly.",
      lore: "Where the Lady of the Grain sets her hand, the battlefield remembers it was once a meadow.",
      effects: [
        "A Sacred Grove erupts around you for 10s — tendrils, grass and flowers in seconds.",
        "Allies inside regenerate health and cool their abilities faster.",
        "Enemies inside are slowed by 20%.",
        "Labyrinth monsters inside strike far more weakly."
      ]
    },
    {
      id: "boon_hephaestus_forge",
      category: "boons",
      name: "Hephaestus' Forge",
      cost: 100,
      sort: 30,
      accent: "#ff8a3c",
      icon: "./assets/emporion/boons/hephaestus-forge.svg",
      prefix: "A boon of Hephaestus — costs 320 Tribute in-match.",
      desc: "Reforge one of your standing towers for 20 seconds: repaired, briefly overbuilt past its maximum, faster firing, and every bolt detonating.",
      lore: "The Smith stokes a tower like a blade on the anvil — molten, rune-cut and rebuilt mid-battle.",
      effects: [
        "Target one of your standing towers. It is reforged for 20s.",
        "Repairs up to 35% of its health, and may hold 10% above its maximum.",
        "Fires markedly faster, and every bolt detonates for splash damage.",
        "A fallen tower cannot be reforged."
      ]
    },
    {
      id: "boon_hades_recall",
      category: "boons",
      name: "Hades' Recall",
      cost: 100,
      sort: 40,
      accent: "#8f6ce0",
      icon: "./assets/emporion/boons/hades-recall.svg",
      prefix: "A boon of Hades — spends 380 Tribute only when it saves you.",
      desc: "Passive. The blow that would kill you instead binds you in an underworld circle — invulnerable, rooted and still swinging — before drawing you back to your healing well at 1 health.",
      lore: "The Unseen One is owed every death. Once, he may choose to defer the debt.",
      effects: [
        "Passive. Triggers by itself the instant a blow would kill you.",
        "You survive inside an underworld circle: invulnerable and rooted for 1s, but still able to strike.",
        "Your Q answers almost instantly while the circle holds.",
        "You are then drawn back to your healing well at 1 health.",
        "Tribute is spent only when it actually saves you."
      ]
    },
    {
      id: "boon_hermes_passage",
      category: "boons",
      name: "Hermes' Passage",
      cost: 100,
      sort: 50,
      accent: "#6fd4e8",
      icon: "./assets/emporion/boons/hermes-passage.svg",
      prefix: "A boon of Hermes — costs 230 Tribute in-match.",
      desc: "Travel unhindered for 5 seconds: faster, farther-sighted, and straight through Labyrinth walls. You cannot attack while it lasts.",
      lore: "The Guide of Roads knows the shortest one, and it rarely troubles itself with walls.",
      effects: [
        "A traveller's aura wreathes you for 5s.",
        "+20% movement speed and +40% sight.",
        "You walk clean through Labyrinth walls.",
        "You cannot attack while it lasts, and are set safely on solid ground when it fades."
      ]
    },
    {
      id: "boon_persephone_bloom",
      category: "boons",
      name: "Persephone's Bloom",
      cost: 100,
      sort: 60,
      accent: "#e070b0",
      icon: "./assets/emporion/boons/persephone-bloom.svg",
      prefix: "A boon of Persephone.",
      desc: "Plant a seed that waits 30 seconds. The first enemy champion to stray near makes it blossom, rooting them for 1.5 seconds and slowing them by half for 3 more.",
      lore: "Half a year below, half above. What she plants remembers both, and holds fast to whatever walks near.",
      effects: [
        "Plant a dormant seed. It waits 30s, then withers away unclaimed.",
        "The first enemy champion to stray within makes it blossom instantly.",
        "That champion is rooted for 1.5s, then slowed by 50% for 3s.",
        "One champion only — the flower that remains is nothing but a memory."
      ]
    }
  ];

  /* ---------------- Favour bundles (real money, via Stripe) ----------------
     Display copy only. The authority is public.favour_bundles: the Edge
     Function reads the price, the currency, the Favour quantity and the Stripe
     Price ID from there, and the webhook checks Stripe's account of the sale
     against the same row before a single unit of Favour is credited.

     The three icons are separate copies of the placeholder so each can be
     replaced with its own artwork later without touching the other two.      */

  var BUNDLES = [
    {
      id: "favour_50",
      category: "favour",
      kind: "bundle",
      name: "50 Favour",
      sort: 10,
      priceMinor: 300,
      favourAmount: 50,
      icon: UI + "favour-bundle-50.png",
      accent: "#ffd769",
      desc: "A small offering of Favour, spendable anywhere in the Emporion.",
      effects: ["Credited to your account as soon as your payment clears."]
    },
    {
      id: "favour_200",
      category: "favour",
      kind: "bundle",
      name: "200 Favour",
      sort: 20,
      priceMinor: 900,
      favourAmount: 200,
      icon: UI + "favour-bundle-200.png",
      accent: "#ffd769",
      desc: "A generous purse of Favour — enough for a champion, with change.",
      effects: [
        "Credited to your account as soon as your payment clears.",
        "Enough for either sellable champion outright."
      ]
    },
    {
      id: "favour_400",
      category: "favour",
      kind: "bundle",
      name: "400 Favour",
      sort: 30,
      priceMinor: 1500,
      favourAmount: 400,
      icon: UI + "favour-bundle-400.png",
      accent: "#ffd769",
      desc: "A patron's tribute of Favour, the best value the Emporion offers.",
      effects: [
        "Credited to your account as soon as your payment clears.",
        "The most Favour per dollar of the three bundles."
      ]
    }
  ];

  /* ---------------------------------------------------------------- */

  var cfg = window.TRIARCHS_CONFIG || {};
  var auth = window.TriarchsAuth || null;

  var money = new Intl.NumberFormat("en-US");

  // Deliberately en-US, not en-AU. An Australian locale renders AUD as a bare
  // "$3.00", which is exactly the ambiguity to avoid when the buyer could be
  // anywhere; en-US renders the same amount as "A$3.00". The currency the
  // customer is actually charged is set by the Stripe Price, and both it and
  // public.favour_bundles.currency are `aud` — this only decides how it reads.
  var cash = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (cfg.currency || "aud").toUpperCase(),
    currencyDisplay: "symbol"
  });

  var catOrder = {};
  var catLabel = {};
  CATEGORIES.forEach(function (c, i) { catOrder[c.id] = i; catLabel[c.id] = c.label; });

  // Favour bundles are prepended, then everything sorts by category order —
  // and `favour` is category 0, so it leads whenever it is on screen.
  var items = BUNDLES.concat(CATALOGUE).sort(function (a, b) {
    return (catOrder[a.category] - catOrder[b.category]) || (a.sort - b.sort);
  });

  var filterGrid = document.getElementById("shop-filters");
  var shelf = document.getElementById("shop-shelf");
  var detail = document.getElementById("shop-detail");
  var clearBtn = document.getElementById("filter-clear");
  var balanceValue = document.getElementById("emporion-balance-value");
  var balanceRefresh = document.getElementById("emporion-balance-refresh");
  var noticeBar = document.getElementById("emporion-notice");
  if (!filterGrid || !shelf || !detail) return;

  /* ---------------- state ----------------

     `identity` is the signed-in user's id, or null. Everything derived from
     the account — the balance, what is owned — is stamped with the identity it
     was loaded for, and cleared the moment that changes. A balance belonging to
     whoever was signed in a second ago must never be shown to the next person,
     not even for one frame.                                                  */

  var selectedCats = [];
  var selectedId = null;

  var identity = null;
  var balance = 0;
  var balanceKnown = false;
  var owned = Object.create(null);
  var pendingAction = false;
  var paymentReturnHandled = false;

  // Set once the visitor touches a filter. Until then the Favour default is
  // reapplied on identity changes; afterwards their choice is left alone.
  var filterTouched = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function favour(amount, cls) {
    var wrap = el("span", cls);
    var img = el("img");
    img.src = FAVOUR_ICON;
    img.alt = "";
    img.loading = "lazy";
    wrap.appendChild(img);
    wrap.appendChild(document.createTextNode(money.format(amount) + " Favour"));
    return wrap;
  }

  function priceTag(item, cls) {
    if (item.kind === "bundle") {
      var wrap = el("span", cls);
      wrap.appendChild(document.createTextNode(cash.format(item.priceMinor / 100)));
      return wrap;
    }
    return favour(item.cost, cls);
  }

  function itemIcon(item, alt) {
    var img = el("img");
    img.src = item.icon || PLACEHOLDER;
    img.alt = alt ? item.name : "";
    img.loading = "lazy";
    img.addEventListener("error", function () {
      if (img.src.indexOf("shop-item-placeholder") === -1) img.src = PLACEHOLDER;
    });
    return img;
  }

  function notice(kind, message) {
    if (!noticeBar) return;
    if (!message) { noticeBar.hidden = true; noticeBar.textContent = ""; return; }
    noticeBar.className = "emporion-notice is-" + kind;
    noticeBar.textContent = message;
    noticeBar.hidden = false;
  }

  /* ---------------- balance ----------------

     Logged out shows a plain 0 — not a dash, not a spinner, and never a
     remembered figure. Logged in, the number comes from player_accounts under
     RLS, which restricts the row to auth.uid(). There is no user id in the
     query because there is nowhere to put one: the policy reads it from the
     JWT. A tampered URL or a doctored localStorage entry changes nothing.   */

  function renderBalance() {
    if (!balanceValue) return;
    if (!identity) { balanceValue.textContent = "0"; return; }
    balanceValue.textContent = balanceKnown ? money.format(balance) : "…";
  }

  function loadAccountData(forIdentity) {
    if (!forIdentity || !auth) { renderBalance(); return Promise.resolve(); }

    return Promise.all([
      auth.client.from("player_accounts").select("favour").single(),
      auth.client.from("player_purchases").select("item_id")
    ]).then(function (results) {
      // Session changed underneath us: throw the answer away rather than
      // painting one account's data over another's.
      if (identity !== forIdentity) return;

      var account = results[0];
      var purchases = results[1];

      if (account.error || !account.data) {
        balanceKnown = false;
        renderBalance();
      } else {
        balance = Number(account.data.favour) || 0;
        balanceKnown = true;
        renderBalance();
      }

      owned = Object.create(null);
      if (!purchases.error && purchases.data) {
        purchases.data.forEach(function (row) { owned[row.item_id] = true; });
      }
      renderShelf();
      if (selectedId) renderDetail(findItem(selectedId));
    }).catch(function () {
      if (identity !== forIdentity) return;
      balanceKnown = false;
      renderBalance();
    });
  }

  function refreshBalance() {
    return loadAccountData(identity);
  }

  if (balanceRefresh) {
    balanceRefresh.addEventListener("click", function () {
      if (!identity) return;
      balanceRefresh.disabled = true;
      balanceKnown = false;
      renderBalance();
      refreshBalance().then(function () { balanceRefresh.disabled = false; });
    });
  }

  function findItem(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  /* ---------------- filters ---------------- */

  function buildFilters() {
    CATEGORIES.forEach(function (cat) {
      var stocked = items.some(function (it) { return it.category === cat.id; });
      var btn = el("button", "filter-card" + (stocked ? "" : " is-empty"));
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.dataset.cat = cat.id;
      var img = el("img");
      img.src = cat.icon;
      img.alt = "";
      btn.appendChild(img);
      btn.appendChild(el("span", null, cat.label));
      if (!stocked) btn.title = "No offerings in this category yet.";
      btn.addEventListener("click", function () {
        filterTouched = true;
        toggleCat(cat.id, btn);
      });
      filterGrid.appendChild(btn);
    });
  }

  function syncFilterButtons() {
    filterGrid.querySelectorAll(".filter-card").forEach(function (b) {
      b.setAttribute(
        "aria-pressed",
        selectedCats.indexOf(b.dataset.cat) !== -1 ? "true" : "false"
      );
    });
    if (clearBtn) clearBtn.hidden = selectedCats.length === 0;
  }

  function toggleCat(id, btn) {
    var i = selectedCats.indexOf(id);
    if (i === -1) selectedCats.push(id); else selectedCats.splice(i, 1);
    btn.setAttribute("aria-pressed", i === -1 ? "true" : "false");
    if (clearBtn) clearBtn.hidden = selectedCats.length === 0;
    renderShelf();
  }

  function clearCats() {
    filterTouched = true;
    selectedCats = [];
    syncFilterButtons();
    renderShelf();
  }

  /* Signed in, Favour is preselected; signed out it is not. Applied when the
     page first opens and when the identity genuinely changes — never after the
     visitor has picked their own filters, because silently undoing someone's
     choice while they are reading is worse than any default. */
  function applyAuthDefaultFilter() {
    if (filterTouched) return;
    selectedCats = identity ? ["favour"] : [];
    syncFilterButtons();
  }

  /* ---------------- shelf ---------------- */

  function visibleItems() {
    if (!selectedCats.length) return items;
    return items.filter(function (it) { return selectedCats.indexOf(it.category) !== -1; });
  }

  function renderShelf() {
    var list = visibleItems();
    shelf.textContent = "";

    if (selectedId && !list.some(function (it) { return it.id === selectedId; })) {
      selectedId = null;
      renderDetail(null);
    }

    if (!list.length) {
      shelf.appendChild(el("p", "shelf-empty", "No offerings in the chosen categories."));
      return;
    }

    var currentCat = null;
    var grid = null;
    list.forEach(function (item) {
      if (item.category !== currentCat) {
        currentCat = item.category;
        var group = el("div", "shelf-group");
        group.appendChild(el("h3", "shelf-group-title", catLabel[item.category]));
        grid = el("div", "shelf-grid");
        group.appendChild(grid);
        shelf.appendChild(group);
      }
      grid.appendChild(buildTile(item));
    });
  }

  function buildTile(item) {
    var isOwned = !!owned[item.id];
    var classes = "shop-tile";
    if (item.category === "abilities") classes += " has-accent";
    if (item.kind === "bundle") classes += " is-bundle";
    if (isOwned) classes += " is-owned";

    var tile = el("button", classes);
    tile.type = "button";
    tile.dataset.id = item.id;
    tile.setAttribute("aria-pressed", item.id === selectedId ? "true" : "false");
    if (item.accent) tile.style.setProperty("--tile-accent", item.accent);

    tile.appendChild(itemIcon(item, false));
    tile.appendChild(el("span", "tile-name", item.name));

    // Owned stock stays on the shelf, greyed, price hidden, still readable —
    // exactly as the in-game panel behaves.
    if (isOwned) tile.appendChild(el("span", "tile-owned", "OWNED"));
    else tile.appendChild(priceTag(item, "tile-cost"));

    tile.addEventListener("click", function () { select(item.id); });
    return tile;
  }

  function select(id) {
    selectedId = selectedId === id ? null : id;
    shelf.querySelectorAll(".shop-tile").forEach(function (t) {
      t.setAttribute("aria-pressed", t.dataset.id === selectedId ? "true" : "false");
    });
    renderDetail(findItem(selectedId));
  }

  /* ---------------- detail pane ---------------- */

  function renderDetail(item) {
    detail.textContent = "";
    if (!item) {
      detail.appendChild(el("p", "detail-empty", "Select an offering to inspect it."));
      return;
    }

    var card = el("div", "detail-card");
    if (item.accent) card.style.setProperty("--detail-accent", item.accent);

    var icon = itemIcon(item, true);
    icon.className = "detail-icon";
    card.appendChild(icon);

    card.appendChild(el("p", "detail-cat", catLabel[item.category]));
    card.appendChild(el("h3", "detail-name", item.name));

    var prefix = item.prefix || (item.hero ? item.hero + "'s level 20 ability." : null);
    if (item.kind === "bundle") {
      prefix = money.format(item.favourAmount) + " Favour, added to your account.";
    }
    if (prefix) card.appendChild(el("p", "detail-prefix", prefix));

    card.appendChild(el("p", "detail-desc", item.desc));
    if (item.lore) card.appendChild(el("p", "detail-lore", item.lore));

    if (item.effects && item.effects.length) {
      card.appendChild(el("p", "detail-sub", "Detail"));
      var ul = el("ul", "detail-list");
      item.effects.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      card.appendChild(ul);
    }

    card.appendChild(priceTag(item, "detail-price"));

    card.appendChild(buildAction(item));
    detail.appendChild(card);
  }

  /* The action area is the only part of the pane that depends on who is
     looking. The item's own description is identical either way. */
  function buildAction(item) {
    if (owned[item.id]) {
      return el("div", "detail-owned", "Already yours");
    }

    if (!identity) {
      var wrap = el("div", "detail-signin");
      if (item.kind === "bundle") {
        wrap.appendChild(el("p", "detail-signin-text",
          "Buying Favour needs an account. Sign in — or create one — below"));
      } else {
        wrap.appendChild(el("p", "detail-signin-text", "Sign in to Purchase"));
      }
      var link = el("a", "btn btn-ghost btn-block", item.kind === "bundle" ? "Sign in or sign up" : "Sign in");
      link.setAttribute("href", "login.html?next=emporion.html");
      wrap.appendChild(link);
      return wrap;
    }

    var button = el("button", "btn btn-primary btn-block detail-purchase",
      item.kind === "bundle" ? "Buy with card" : "Purchase");
    button.type = "button";
    button.dataset.id = item.id;

    if (item.kind !== "bundle" && balanceKnown && balance < item.cost) {
      button.disabled = true;
      button.textContent = "Not enough Favour";
    }

    button.addEventListener("click", function () {
      if (item.kind === "bundle") startCheckout(item, button);
      else confirmItemPurchase(item, button);
    });

    var holder = el("div", "detail-action");
    holder.appendChild(button);
    return holder;
  }

  /* ---------------- buying a game item with Favour ----------------

     The website never decides the price, never touches player_accounts.favour
     and never inserts an entitlement. It calls one RPC. Inside a single
     transaction the database re-reads the cost from shop_items, locks the
     balance row, refuses a duplicate or an overdraw, debits, grants and
     ledgers — or rolls the whole lot back.

     The request id makes a retry safe: the same id always replays its original
     outcome instead of buying again. The disabled button below is a courtesy
     to the visitor, not the thing that prevents a double purchase.           */

  function confirmItemPurchase(item, button) {
    if (pendingAction) return;

    var message = "Are you sure you wish to purchase " + item.name +
                  " for " + money.format(item.cost) + " Favour?";
    if (!window.confirm(message)) return;

    pendingAction = true;
    button.disabled = true;
    button.textContent = "Purchasing…";
    notice("info", "Completing your purchase…");

    var requestId = auth.newRequestId();

    auth.client.rpc("purchase_shop_item", {
      p_item_id: item.id,
      p_request_id: requestId
    }).then(function (res) {
      pendingAction = false;

      if (res.error) {
        // A 401/PGRST301 here means the JWT expired between page load and now.
        var expired = res.error.code === "PGRST301" ||
                      (res.error.message || "").toLowerCase().indexOf("jwt") !== -1;
        notice("error", expired
          ? "Your session has expired. Sign in again and retry — nothing was charged."
          : "We could not complete that purchase. Nothing was charged. Please try again.");
        renderDetail(item);
        return;
      }

      var result = res.data || {};

      if (result.ok) {
        // Trust the server's figure for the immediate repaint, then reload the
        // authoritative record anyway.
        if (typeof result.favour === "number") { balance = result.favour; balanceKnown = true; }
        owned[item.id] = true;
        renderBalance();
        renderShelf();
        renderDetail(item);
        notice("success", result.duplicate
          ? item.name + " is yours — that request had already gone through."
          : item.name + " is yours.");
        refreshBalance();
        return;
      }

      var messages = {
        insufficient_favour: "You do not have enough Favour for that yet.",
        already_owned: "You already own that offering.",
        item_unavailable: "That offering is no longer available.",
        no_account: "We could not find your player account. Try signing out and back in.",
        not_authenticated: "Your session has expired. Sign in again and retry.",
        request_id_reused: "That looked like a repeated request. Refresh the page and try again."
      };
      if (typeof result.favour === "number") { balance = result.favour; balanceKnown = true; }
      if (result.error === "already_owned") owned[item.id] = true;

      renderBalance();
      renderShelf();
      renderDetail(item);
      notice("error", messages[result.error] || "That purchase could not be completed.");
      refreshBalance();
    }).catch(function () {
      pendingAction = false;
      notice("error", "We could not reach the Emporion. Nothing was charged. Check your connection and try again.");
      renderDetail(item);
    });
  }

  /* ---------------- buying Favour with money ----------------

     The browser sends a bundle id and a request id. It does not send a price,
     a quantity, a currency or a user id — the Edge Function reads all of those
     from the database and from the verified access token.                    */

  function startCheckout(item, button) {
    if (pendingAction) return;
    pendingAction = true;
    button.disabled = true;
    button.textContent = "Opening checkout…";
    notice("info", "Taking you to our payment provider…");

    auth.callFunction("stripe-checkout", {
      authenticated: true,
      body: { bundleId: item.id, requestId: auth.newRequestId() }
    }).then(function (res) {
      pendingAction = false;
      var body = res.body || {};

      if (!res.ok || !body.ok || !body.url) {
        notice("error", body.message || "We could not start that purchase. Nothing has been charged.");
        renderDetail(item);
        return;
      }

      // Same-tab navigation, so there is no popup to be blocked. If the
      // browser refuses even this, the link below is the way through.
      notice("info", "Redirecting to the payment page…");
      window.location.assign(body.url);

      // If we are still here a moment later, the navigation did not happen.
      window.setTimeout(function () {
        notice("info", "");
        var wrap = el("div", "detail-action");
        var link = el("a", "btn btn-primary btn-block", "Continue to payment");
        link.setAttribute("href", body.url);
        link.setAttribute("rel", "noopener");
        wrap.appendChild(link);
        wrap.appendChild(el("p", "detail-signin-text",
          "If nothing happened, use the button above to continue to the payment page."));
        detail.querySelectorAll(".detail-action").forEach(function (n) { n.remove(); });
        var card = detail.querySelector(".detail-card");
        if (card) card.appendChild(wrap);
      }, 1500);
    }).catch(function (error) {
      pendingAction = false;
      notice("error", String(error && error.message) === "not_authenticated"
        ? "Your session has expired. Sign in again to buy Favour."
        : "We could not reach the payment service. Nothing has been charged.");
      renderDetail(item);
    });
  }

  /* ---------------- returning from Stripe ----------------

     `?payment=success` is a URL, not a receipt. It awards nothing. All it does
     is tell this page to watch the balance for a moment, because the webhook —
     which is the only thing that can award Favour — usually lands within a
     second or two of the redirect.                                           */

  function handlePaymentReturn() {
    var params = new URLSearchParams(window.location.search);
    var payment = params.get("payment");
    if (!payment) return;

    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (payment === "cancelled") {
      notice("info", "Payment cancelled. Nothing has been charged.");
      return;
    }

    if (payment !== "success") return;

    notice("info",
      "Thank you. Your Favour is being added — this usually takes a moment. " +
      "The balance above will update on its own.");

    // Bounded: eight tries over about twenty seconds, then stop and let the
    // visitor press Refresh. An unbounded poll would hammer the database
    // forever on any tab someone left open.
    var attempts = 0;
    var startingBalance = balance;

    (function poll() {
      if (attempts >= 8 || !identity) {
        if (identity && balance === startingBalance) {
          notice("info",
            "Your payment went through. If the balance has not moved yet, give it " +
            "another moment and press Refresh — nothing is lost.");
        }
        return;
      }
      attempts += 1;
      window.setTimeout(function () {
        refreshBalance().then(function () {
          if (balance !== startingBalance) {
            notice("success", "Favour added. Your new balance is above.");
            return;
          }
          poll();
        });
      }, attempts === 1 ? 1200 : 2500);
    })();
  }

  /* ---------------- auth wiring ---------------- */

  function onAuthChange(state) {
    if (!state.ready) return;

    if (state.identity === identity) {
      renderBalance();
      return;
    }

    // Identity genuinely changed (including sign-out). Drop everything
    // account-shaped before anything can be drawn with it.
    identity = state.identity;
    balance = 0;
    balanceKnown = false;
    owned = Object.create(null);

    if (balanceRefresh) balanceRefresh.hidden = !identity;

    applyAuthDefaultFilter();
    renderBalance();
    renderShelf();
    renderDetail(findItem(selectedId));

    if (identity) {
      loadAccountData(identity).then(function () {
        // Once per page load, whichever auth event happens to arrive first.
        // Gating on a particular event name is fragile: whether the first
        // callback is INITIAL_SESSION or the immediate SUBSCRIBE replay
        // depends on whether the session had already been restored before
        // this module subscribed.
        if (!paymentReturnHandled) {
          paymentReturnHandled = true;
          handlePaymentReturn();
        }
      });
    } else {
      notice("");
    }
  }

  /* ---------------- go ---------------- */

  buildFilters();
  if (clearBtn) clearBtn.addEventListener("click", clearCats);
  renderBalance();
  renderShelf();
  renderDetail(null);

  if (auth) {
    auth.onChange(onAuthChange);
  } else {
    // No auth stack (script blocked, offline): the shelf still browses, the
    // balance stays at zero, and every action falls back to "sign in".
    renderShelf();
  }

  // Coming back to the tab after paying in another one, or after a long
  // absence, should not show a stale figure.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && identity) refreshBalance();
  });
})();
