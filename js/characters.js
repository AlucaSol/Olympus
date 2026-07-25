// Triarchs of Olympus — character roster data & renderer for characters.html
// Source of truth: src/data/heroes.ts (see docs/source-map.md for full traceability).
// Ability descriptions and unlock levels are copied verbatim from that file;
// only minor punctuation cleanup was applied for web reading.
(function () {
  "use strict";

  var HEROES = [
    {
      id: "alkaios", name: "Alkaios", title: "the Bronze Duellist", role: "Duellist",
      portrait: "Alkaios-portrait.png", icon: "alkaios-battle.png",
      lore: "Champion of a hundred funeral games, Alkaios swore his blade to no king — only to the next worthy opponent.",
      strengths: "Devastating single-target damage; executes wounded heroes.",
      weaknesses: "Slow; struggles against kiting and mobs.",
      abilities: [
        { name: "Sundering Blow", unlock: 0, icon: "sword", desc: "Strike a target for heavy damage and stun them for 0.5s." },
        { name: "War Cry", unlock: 5, icon: "horn", desc: "Bellow a challenge: +35% attack damage and +20% speed for 5s; nearby enemies take minor damage." },
        { name: "Hurled Blade", unlock: 10, icon: "blade", desc: "Throw a bronze blade in a line, damaging and slowing the first enemy hit by 40% for 2s." },
        { name: "Unbreakable", unlock: 15, icon: "shield", desc: "Gain a 300 HP shield and immunity to stuns and slows for 3s." },
        { name: "Rite of the Fallen", unlock: 20, icon: "skull", desc: "Executioner strike: heavy damage, doubled below 35% HP. Cooldown resets on kill." }
      ]
    },
    {
      id: "kyra", name: "Kyra", title: "Huntress of the Silver Vale", role: "Marksman",
      portrait: "Kyra-portrait.png", icon: "kyra-battle.png",
      lore: "Raised by the moon-priestesses, Kyra can thread an arrow through a keyhole at three hundred paces — and has, twice.",
      strengths: "Longest range in the game; punishes immobile foes.",
      weaknesses: "Fragile; helpless when cornered.",
      abilities: [
        { name: "Piercing Arrow", unlock: 0, icon: "arrow", desc: "Loose an arrow that pierces all enemies in a long line." },
        { name: "Hunter's Step", unlock: 5, icon: "boots", desc: "Gain +35% movement speed and +40% attack speed for 4s." },
        { name: "Silver Volley", unlock: 10, icon: "volley", desc: "Rain arrows on an area, damaging and slowing enemies by 35% for 2s." },
        { name: "Moonsilver Snare", unlock: 15, icon: "trap", desc: "Lay a hidden trap that roots the first enemy hero to step on it for 1.6s. Lasts 45s." },
        { name: "Heartseeker", unlock: 20, icon: "star", desc: "After a breath, fire an arrow across the battlefield. Damage grows with distance travelled, up to +100%." }
      ]
    },
    {
      id: "skiron", name: "Skiron", title: "the Wind Thief", role: "Trickster",
      portrait: "Skiron-portrait.png", icon: "skiron-battle.png",
      lore: "They say Skiron stole the north wind's sandals as a boy and has been outrunning its fury ever since.",
      strengths: "Extreme mobility; picks fights and leaves them at will.",
      weaknesses: "Low health; weak when dashes are on cooldown.",
      abilities: [
        { name: "Gale Dash", unlock: 0, icon: "wind", desc: "Dash in a direction, slicing every enemy you pass through." },
        { name: "Mistform", unlock: 5, icon: "mist", desc: "Fade into wind for 2.5s: invisible to enemies and +30% speed." },
        { name: "Squall Slash", unlock: 10, icon: "slash", desc: "Unleash a cutting gust in a short cone for heavy damage." },
        { name: "Cyclone Hop", unlock: 15, icon: "spiral", desc: "Blink to a location; enemies at your arrival are slowed 45% for 2s." },
        { name: "Tempest Heart", unlock: 20, icon: "tempest", desc: "Become the storm: a whirlwind around you deals damage 4 times over 2.5s and hurls enemies back." }
      ]
    },
    {
      id: "thalassa", name: "Thalassa", title: "Tidecaller of the Drowned Court", role: "Controller",
      portrait: "Thalassa-portrait.png", icon: "thalassa-battle.png",
      lore: "Exiled priestess of a sunken temple, Thalassa carries the sea in an amphora and grief in her wake.",
      strengths: "Superb zone control and displacement.",
      weaknesses: "Low sustained damage; needs terrain to shine.",
      abilities: [
        { name: "Tide Bolt", unlock: 0, icon: "drop", desc: "Hurl a lance of seawater that damages and slows the first enemy hit by 35% for 2s." },
        { name: "Riptide Pool", unlock: 5, icon: "pool", desc: "Flood an area for 4s: enemies inside are slowed 40% and take damage each second." },
        { name: "Breaking Wave", unlock: 10, icon: "wave", desc: "A wave surges from you, damaging enemies in a cone and hurling them back." },
        { name: "Undertow", unlock: 15, icon: "pull", desc: "The deep pulls: after 0.8s, enemies in the area are dragged toward its centre and damaged." },
        { name: "Deluge of the Drowned", unlock: 20, icon: "tsunami", desc: "Summon a towering wave that sweeps a long line, dealing massive damage, knocking enemies aside and stunning them for 1.2s." }
      ]
    },
    {
      id: "lysander", name: "Lysander", title: "Voice of the Phalanx", role: "Commander",
      portrait: "Lysander-portrait.png", icon: "lysander-battle.png",
      lore: "The youngest strategos ever to carry the speaking-staff, Lysander wins battles before his enemies know one has begun.",
      strengths: "Turns ordinary lane mobs into a personal army.",
      weaknesses: "Modest personal damage; weak without troops.",
      abilities: [
        { name: "Rallying Standard", unlock: 0, icon: "banner", desc: "Order up to 6 nearby friendly lane mobs to follow you for 14s, then return to their lane." },
        { name: "Spear Wall", unlock: 5, icon: "spears", desc: "Nearby friendly mobs gain +10 armor and +30% damage for 8s." },
        { name: "Phalanx Charge", unlock: 10, icon: "charge", desc: "You and nearby friendly mobs gain +35% speed for 4s; your next attack deals splash damage." },
        { name: "Conscription", unlock: 15, icon: "helm", desc: "Summon 3 veteran hoplites who fight beside you. They may assault enemy bases." },
        { name: "Grand Muster", unlock: 20, icon: "muster", desc: "A vast rally: up to 10 friendly mobs in a wide radius follow you for 18s with +25% damage." }
      ]
    },
    {
      id: "doria", name: "Doria", title: "Shield of Ages", role: "Guardian",
      portrait: "Doria-portrait.png", icon: "doria-battle.png",
      lore: "Her tower-shield was cut from the hull of a Titan-era warship. Doria has never once taken a backward step.",
      strengths: "Immense durability; protects towers and mobs.",
      weaknesses: "Low damage; easily outpaced.",
      abilities: [
        { name: "Shield Bash", unlock: 0, icon: "bash", desc: "Slam a target for damage and a 0.9s stun." },
        { name: "Bulwark", unlock: 5, icon: "shield", desc: "Raise your shield: gain 350 shield HP and +15 armor for 4s." },
        { name: "Intervene", unlock: 10, icon: "taunt", desc: "Charge to a point; enemy mobs and monsters nearby are forced to attack you for 3s." },
        { name: "Seismic Slam", unlock: 15, icon: "quake", desc: "Crack the earth: enemies around you take damage and are slowed 40% for 2.5s." },
        { name: "Aegis of Ages", unlock: 20, icon: "aegis", desc: "Grant nearby friendly mobs 200 shield HP and become invulnerable yourself for 2.5s." }
      ]
    },
    {
      id: "iole", name: "Iole", title: "the Grove Mender", role: "Support",
      portrait: "Iole-portrait.png", icon: "iole-battle.png",
      lore: "Where armies salt the earth, Iole follows, and the olives grow back twisted, thorned, and loyal.",
      strengths: "Sustains herself and her mob waves far beyond their span.",
      weaknesses: "Poor burst; vulnerable while healing.",
      abilities: [
        { name: "Mending Light", unlock: 0, icon: "heart", desc: "A burst of light heals you and friendly mobs nearby for 120 HP." },
        { name: "Thorn Lash", unlock: 5, icon: "thorn", desc: "A whipping vine damages the first enemy hit and roots them for 1.1s." },
        { name: "Verdant Ring", unlock: 10, icon: "leaf", desc: "Bless an area for 5s: allies heal each second, enemies are slowed 30%." },
        { name: "Wild Growth", unlock: 15, icon: "sprout", desc: "Nearby friendly mobs gain +25% max HP and regeneration for 10s." },
        { name: "Gaia's Embrace", unlock: 20, icon: "bloom", desc: "A great bloom: massively heal yourself and friendly mobs, granting all +25% speed and damage for 6s." }
      ]
    },
    {
      id: "pyrrhos", name: "Pyrrhos", title: "Ember of the Titans", role: "Titan Caster",
      portrait: "Pyrrhos-portrait.png", icon: "pyrrhos-battle.png",
      lore: "Pyrrhos drank from a cracked crucible of Titan fire. It is burning him alive, and he considers it a fair price.",
      strengths: "Terrifying area damage that scales with the risks he takes.",
      weaknesses: "His own magic costs him health.",
      abilities: [
        { name: "Titan Spark", unlock: 0, icon: "flame", desc: "Hurl condensed Titan fire in a line for heavy damage. Costs 4% of his max HP." },
        { name: "Cinder Step", unlock: 5, icon: "cinder", desc: "Blink a short distance, leaving a burning trail. Costs 5% of his max HP." },
        { name: "Ring of Cinders", unlock: 10, icon: "ring", desc: "Ignite the ground around him for 4s, burning enemies inside." },
        { name: "Sacrificial Pyre", unlock: 15, icon: "pyre", desc: "Burn 20% of his current HP to detonate a great blast around him and gain a shield equal to double the health paid." },
        { name: "Wrath of Kronos", unlock: 20, icon: "meteor", desc: "Call down a Titan meteor. After 1.4s it lands for devastating damage and a 1s stun." }
      ]
    },
    {
      id: "eurydice", name: "Eurydice", title: "Oracle of Delphi", role: "Oracle",
      portrait: "eurydice-portrait.png", icon: "eurydice-icon.png", battle: "eurydice-battle.png",
      lore: "Apollo's temple taught her to withstand visions no mortal mind should hold. Eurydice learned something better: how to edit them.",
      strengths: "Unmatched vision control; punishes enemies for where they stand.",
      weaknesses: "Frail and low-damage; her power is knowing, not killing.",
      abilities: [
        { name: "Echo of Prophecy", unlock: 0, icon: "echo", desc: "Inscribe a hidden sigil. The first enemy hero to disturb it triggers a delayed blast that damages and slows all enemies caught by 30% for 2s. Lasts 40s." },
        { name: "Veil of Omens", unlock: 5, icon: "veil", desc: "Prophetic fog follows you for 6s: your empire sees everything within it, while enemies inside are half-blinded." },
        { name: "Threads of Fate", unlock: 10, icon: "threads", desc: "Bind an enemy hero to the nearest other enemy hero for 6s: 35% of the damage either suffers is echoed to the other, and slows are partially shared." },
        { name: "Rewrite Destiny", unlock: 15, icon: "destiny", desc: "Weave a ward over your ally for 6s. If they would die, destiny is rewritten: they return to where the ward was cast with the health they had then." },
        { name: "The Final Prophecy", unlock: 20, icon: "prophecy", desc: "Reveal a vast region for 8s: all fog, thickets and hidden enemies within are laid bare to your whole empire, and stealth is stripped away." }
      ]
    },
    {
      id: "harmonia", name: "Harmonia", title: "Daughter of Concord", role: "Peacemaker",
      portrait: "harmonia-portrait.png", icon: "harmonia-icon.png", battle: "harmonia-battle.png",
      lore: "Born of Ares and Aphrodite, Harmonia is the impossible truce between war and love — and she holds battlefields to it.",
      strengths: "Bends the flow of battle itself; armies march to her decree.",
      weaknesses: "Almost no damage of her own; helpless once her word runs out.",
      abilities: [
        { name: "Truce", unlock: 0, icon: "dove", desc: "Impose peace between yourself and an enemy hero for 5s: neither of you can harm the other, though both may fight everyone else." },
        { name: "Rally Banner", unlock: 5, icon: "rallybanner", desc: "Plant a divine banner: friendly mobs around it surge forward with +30% speed and +25% damage for 8s, massing into one assault wave." },
        { name: "Shared Courage", unlock: 10, icon: "linkhearts", desc: "Bind your fate to your ally for 8s: 30% of the damage they take is borne by you instead." },
        { name: "Divine Accord", unlock: 15, icon: "accord", desc: "Consecrate ground for 5s: enemy mobs within refuse to raise arms, while your own mobs fight on. Towers pay the accord no heed." },
        { name: "Harmony's Decree", unlock: 20, icon: "decree", desc: "For 10s every enemy empire's mob forgets its quarrels and marches only on towers and bases, flooding every lane with pressure." }
      ]
    },
    {
      id: "lykaon", name: "Lykaon", title: "the Moon-Cursed", role: "Predator",
      portrait: "lykaon-portrait.png", icon: "lykaon-icon.png", battle: "lykaon-battle.png",
      lore: "King Lykaon mocked Zeus and was made the first werewolf for it. Under Artemis' patient moonlight, the punishment became a weapon.",
      strengths: "Runs down isolated heroes; patience makes his first strike terrible.",
      weaknesses: "Melee only; brawls poorly once the ambush is spent.",
      abilities: [
        { name: "Predator's Mark", unlock: 0, icon: "paw", desc: "Mark an enemy hero: they are tracked anywhere for 20s. Your first strike on them hits harder the longer you stalk before it lands (up to +160)." },
        { name: "Silent Pounce", unlock: 5, icon: "pounce", desc: "Leap over any terrain. Striking from a thicket or unseen dazes enemies at your landing for 0.6s and slows them 35% for 2s." },
        { name: "Blood Scent", unlock: 10, icon: "scent", desc: "Taste the air for 8s: every recently wounded enemy hero leaves a trail your empire can follow anywhere." },
        { name: "Full Moon", unlock: 15, icon: "moon", desc: "The curse takes over for 7s: +25% speed and +15% damage, your claws cleave nearby foes, and slows cannot touch you." },
        { name: "Apex Predator", unlock: 20, icon: "apex", desc: "For 12s every enemy hero is hunted: all are revealed, you gain +25% speed, and your first strike on each hero deals +180 damage and terrifies nearby enemy mobs." }
      ]
    },
    {
      id: "brontes", name: "Brontes", title: "Smith of Thunder", role: "Siege Engineer",
      portrait: "brontes-portrait.png", icon: "brontes-icon.png", battle: "brontes-battle.png",
      lore: "One of the immortal Cyclopes who hammered out Zeus' first thunderbolt. Now he walks the battlefield, reforging it to his liking.",
      strengths: "Reshapes ground with forges and walls; sieges like an army.",
      weaknesses: "Ponderous; easily kited once his works are down.",
      abilities: [
        { name: "Thunder Forge", unlock: 0, icon: "anvil", desc: "Raise an enchanted forge for 6s: allies within its glow heal each second and friendly mobs strike 20% harder." },
        { name: "Living Wall", unlock: 5, icon: "wallstone", desc: "Raise a rampart of enchanted stone across the ground for 8s. Its three blocks shoulder aside movement and swallow enemy projectiles until broken." },
        { name: "Lightning Chain", unlock: 10, icon: "chainbolt", desc: "Hurl an electrified hammer that leaps between up to 5 enemies, striking 25% harder with every bounce." },
        { name: "Siege Bellows", unlock: 15, icon: "bellows", desc: "Work the bellows: nearby friendly mobs gain +25% speed, +30% attack rate and 30% resistance to tower fire for 8s." },
        { name: "Forge of Olympus", unlock: 20, icon: "celestforge", desc: "Summon a celestial forge for 10s: allies gain a 180 HP shield, friendly mobs are reforged into elites (+35% damage, regeneration, +40% tower damage), and enemy projectiles entering its light are melted." }
      ]
    }
  ];

  window.TRIARCHS_HEROES = HEROES;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  var RASTER_ICON_RE = /\.(png|jpe?g|webp|gif)$/i;

  // Renders an ability icon from either a bare sprite-symbol name (looked up as
  // "#ic-<name>" in the shared assets/icons/icons.svg sprite) or, once art is
  // available, a raster filename (e.g. "sword.png") placed alongside it in
  // assets/icons/abilities/ — swap an ability's `icon` value to a filename with
  // an image extension and this switches to <img> with no other code changes.
  function renderAbilityIcon(icon) {
    if (RASTER_ICON_RE.test(icon)) {
      return '<img src="assets/icons/abilities/' + icon + '" alt="" loading="lazy" width="20" height="20">';
    }
    return '<svg class="icon" aria-hidden="true"><use href="assets/icons/icons.svg#ic-' + icon + '"></use></svg>';
  }

  function addImageFallback(image, fallbackSrc) {
    if (!image || !fallbackSrc || image.getAttribute("src") === fallbackSrc) return;

    image.addEventListener("error", function () {
      if (image.dataset.fallbackApplied === "true") {
        // Keep the reserved frame, but remove the broken-image indicator if
        // neither the preferred art nor its fallback is available.
        image.removeAttribute("src");
        image.style.display = "none";
        return;
      }

      image.dataset.fallbackApplied = "true";
      image.src = fallbackSrc;
    });
  }

  function buildCard(hero, index) {
    var flip = index % 2 === 1;
    var card = el("article", "char-card panel ornate-frame reveal" + (flip ? " flip" : ""));
    card.id = "hero-" + hero.id;

    var art = el("div", "char-art");
    art.innerHTML =
      '<img src="assets/characters/' + hero.portrait + '" alt="Promotional illustration of ' + hero.name + ', ' + hero.title + '" loading="lazy" width="1023" height="1537">' +
      '<div class="char-icon-block">' +
        '<div class="char-icon-frame"><img class="char-battle-image" src="assets/characters/' + (hero.battle || hero.icon) + '" alt="" loading="lazy" width="64" height="64"></div>' +
      '</div>';

    addImageFallback(art.querySelector(".char-battle-image"), hero.battle ? "assets/characters/" + hero.icon : "");

    var body = el("div", "char-body");
    var abilitiesHtml = hero.abilities.map(function (a) {
      return '<div class="ability-entry">' +
        '<span class="ability-icon" aria-hidden="true">' + renderAbilityIcon(a.icon) + '</span>' +
        '<div class="ability-info"><h5>' + a.name + '</h5><span class="unlock-lvl">Unlocks at level ' + a.unlock + '</span><p>' + a.desc + '</p></div>' +
        '</div>';
    }).join("");

    body.innerHTML =
      '<h3>' + hero.name + '</h3>' +
      '<span class="char-title">' + hero.title + '</span>' +
      '<div class="char-role-row"><span class="tag">' + hero.role + '</span></div>' +
      '<p>' + hero.lore + '</p>' +
      '<div class="char-stylepair">' +
        '<div><h5>Strengths</h5><p>' + hero.strengths + '</p></div>' +
        '<div><h5>Weaknesses</h5><p>' + hero.weaknesses + '</p></div>' +
      '</div>' +
      '<div class="ability-row" aria-label="' + hero.name + ' abilities">' + abilitiesHtml + '</div>';

    card.appendChild(art);
    card.appendChild(body);
    return card;
  }

  function render() {
    var mount = document.getElementById("char-list");
    if (!mount) return;
    mount.innerHTML = "";
    HEROES.forEach(function (hero, i) { mount.appendChild(buildCard(hero, i)); });

    // re-run reveal-on-scroll for freshly inserted cards
    var revealEls = mount.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add("in-view"); io.unobserve(entry.target); }
        });
      }, { threshold: 0.1 });
      revealEls.forEach(function (e) { io.observe(e); });
    } else {
      revealEls.forEach(function (e) { e.classList.add("in-view"); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
