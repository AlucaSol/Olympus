/* ==========================================================================
   EMPORION OF OLYMPUS — storefront catalogue + panel behaviour
   Catalogue transcribed from assets/emporion/EMPORION_STORE_DATA.txt
   (extracted 2026-08-01). When stock changes in the game, update CATALOGUE.
   Browse-only: no purchasing, no ownership state.
   ========================================================================== */
(function () {
  "use strict";

  var UI = "./assets/emporion/ui/";
  var FAVOUR_ICON = UI + "favour-placeholder.png";
  var PLACEHOLDER = UI + "shop-item-placeholder.png";

  /* Category display order and filter-card icons (from src/types/shop.ts). */
  var CATEGORIES = [
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

  /* ---------------------------------------------------------------- */

  var money = new Intl.NumberFormat("en-US");
  var catOrder = {};
  var catLabel = {};
  CATEGORIES.forEach(function (c, i) { catOrder[c.id] = i; catLabel[c.id] = c.label; });

  var items = CATALOGUE.slice().sort(function (a, b) {
    return (catOrder[a.category] - catOrder[b.category]) || (a.sort - b.sort);
  });

  var filterGrid = document.getElementById("shop-filters");
  var shelf = document.getElementById("shop-shelf");
  var detail = document.getElementById("shop-detail");
  var clearBtn = document.getElementById("filter-clear");
  if (!filterGrid || !shelf || !detail) return;

  var selectedCats = [];
  var selectedId = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function favour(cost, cls) {
    var wrap = el("span", cls);
    var img = el("img");
    img.src = FAVOUR_ICON;
    img.alt = "";
    img.loading = "lazy";
    wrap.appendChild(img);
    wrap.appendChild(document.createTextNode(money.format(cost) + " Favour"));
    return wrap;
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
      btn.addEventListener("click", function () { toggleCat(cat.id, btn); });
      filterGrid.appendChild(btn);
    });
  }

  function toggleCat(id, btn) {
    var i = selectedCats.indexOf(id);
    if (i === -1) selectedCats.push(id); else selectedCats.splice(i, 1);
    btn.setAttribute("aria-pressed", i === -1 ? "true" : "false");
    if (clearBtn) clearBtn.hidden = selectedCats.length === 0;
    renderShelf();
  }

  function clearCats() {
    selectedCats = [];
    filterGrid.querySelectorAll(".filter-card").forEach(function (b) {
      b.setAttribute("aria-pressed", "false");
    });
    if (clearBtn) clearBtn.hidden = true;
    renderShelf();
  }

  /* ---------------- shelf ---------------- */
  function visibleItems() {
    if (!selectedCats.length) return items;
    return items.filter(function (it) { return selectedCats.indexOf(it.category) !== -1; });
  }

  function renderShelf() {
    var list = visibleItems();
    shelf.textContent = "";

    // Selecting away from the shown item clears the detail pane, as in game.
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
    var tile = el("button", "shop-tile" + (item.category === "abilities" ? " has-accent" : ""));
    tile.type = "button";
    tile.dataset.id = item.id;
    tile.setAttribute("aria-pressed", item.id === selectedId ? "true" : "false");
    if (item.accent) tile.style.setProperty("--tile-accent", item.accent);
    tile.appendChild(itemIcon(item, false));
    tile.appendChild(el("span", "tile-name", item.name));
    tile.appendChild(favour(item.cost, "tile-cost"));
    tile.addEventListener("click", function () { select(item.id); });
    return tile;
  }

  function select(id) {
    selectedId = selectedId === id ? null : id;
    shelf.querySelectorAll(".shop-tile").forEach(function (t) {
      t.setAttribute("aria-pressed", t.dataset.id === selectedId ? "true" : "false");
    });
    renderDetail(items.filter(function (it) { return it.id === selectedId; })[0] || null);
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
    if (prefix) card.appendChild(el("p", "detail-prefix", prefix));

    card.appendChild(el("p", "detail-desc", item.desc));

    if (item.lore) card.appendChild(el("p", "detail-lore", item.lore));

    if (item.effects && item.effects.length) {
      card.appendChild(el("p", "detail-sub", "Detail"));
      var ul = el("ul", "detail-list");
      item.effects.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      card.appendChild(ul);
    }

    card.appendChild(favour(item.cost, "detail-price"));
    card.appendChild(el("div", "detail-buy", "Sign in to purchase — coming soon"));

    detail.appendChild(card);
  }

  /* ---------------- go ---------------- */
  buildFilters();
  if (clearBtn) clearBtn.addEventListener("click", clearCats);
  renderShelf();
  renderDetail(null);
})();
