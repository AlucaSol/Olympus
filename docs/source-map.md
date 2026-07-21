# Source Map — Traceability of Site Content to Game Files

This document records, for every fact, name, number and asset used on the
promotional website, which file(s) in the main project it was taken from.
It exists for internal verification only and is not linked from the public
site navigation.

All paths are relative to the repository root (the folder containing `SITE/`).
No file outside `SITE/` was modified, moved, renamed, or deleted while
building this site — everything below was read-only research.

---

## 1. General game facts

| Fact used on site | Source |
|---|---|
| "Three-player free-for-all MOBA", "symmetric triangular battlefield", "last standing acropolis wins", multiplayer model (1 human + 2 AI / 2 humans + 1 AI / 3 humans, PeerJS, no accounts/backend), "8 unique heroes with 5-ability kits that unlock at levels 0/5/10/15/20", labyrinth/towers/capture points/rare bosses, "everything resets every match" | `README.md` |
| Empire names **Azure**, **Crimson**, **Verdant** and their hex colours | `src/data/heroes.ts` → `PLAYER_COLORS` |
| "\<Winner\> rules Olympus!" victory line (basis for "The War for Olympus" framing) | `src/game/game.ts` line ~625 |
| "The war for Olympus begins!" match-start announcement | `src/main.ts` line ~458 |
| Tower counts, tiers (outer/inner) and shop/upgrade names ("Agora of the Empire", "Temple of Ascension") | `index.html` (root dev shell), `src/ui/menus.ts` |
| Central balance philosophy (single tuning file, hand-authored labyrinth) | `src/data/balance.ts` header comment, `src/game/map.ts` header comment |

No overarching pantheon myth beyond "three empires fighting for Olympus, last
acropolis standing wins" was found anywhere in the project. No file states
*why* the three empires originally went to war. The homepage backstory
section is deliberately limited to what is confirmed; it does not invent a
founding myth, a precipitating event, or named gods (the playable roster are
original champions, not deities such as Zeus or Hera, and the source never
calls them gods).

## 2. Characters

All eight playable characters, and all fields below (name, title, role,
lore, strengths, weaknesses, ability names/descriptions/unlock levels), come
verbatim or near-verbatim from:

```
src/data/heroes.ts → export const HEROES
```

This is the complete roster (`HERO_IDS = Object.keys(HEROES)`); no character
was omitted and none were added. Numeric ability values quoted on the site
(damage, durations, percentages, HP costs) are copied from the `desc` string
and `p` parameters of each `AbilityDef` in that same file.

| Character | Name/title/lore/abilities | Visual reference used for original portrait art |
|---|---|---|
| Alkaios | `src/data/heroes.ts` (`alkaios`) | Silhouette gear (twin blades, tall-crested helm) reproduced from `src/render/art.ts` → `UNIT_ART.alkaios` |
| Kyra | `src/data/heroes.ts` (`kyra`) | Bow, moon-braid described in `UNIT_ART.kyra` |
| Skiron | `src/data/heroes.ts` (`skiron`) | Hood, wind scarf, twin daggers in `UNIT_ART.skiron` |
| Thalassa | `src/data/heroes.ts` (`thalassa`) | Trident, kelp hair, sea-robe in `UNIT_ART.thalassa` |
| Lysander | `src/data/heroes.ts` (`lysander`) | Banner, round shield, spear, officer helm in `UNIT_ART.lysander` |
| Doria | `src/data/heroes.ts` (`doria`) | Tower shield, heavy frame in `UNIT_ART.doria` |
| Iole | `src/data/heroes.ts` (`iole`) | Leaf robe, blooming staff in `UNIT_ART.iole` |
| Pyrrhos | `src/data/heroes.ts` (`pyrrhos`) | Horned ritual helm, crescent staff, ember palette in `UNIT_ART.pyrrhos` (fixed colours, not team-tinted, reused directly) |

**Important note on character art:** the game renders every hero, mob and
boss procedurally on an HTML canvas (`src/render/art.ts`); there are no
pre-made promotional character portraits, concept sketches or sprite-sheet
image files anywhere in the project (`ConceptArt.png` is a single wide
battlefield scene, not a character portrait — see §5). The large "promotional
illustration" and small "battlefield appearance" images on the Characters
page are therefore **original artwork created for this website**
(`SITE/assets/characters/*-portrait.svg`, `*-icon.svg`), built to match each
hero's actual described silhouette, weapon and headwear from `art.ts` as
closely as an SVG illustration reasonably allows. Per-hero accent colours
were chosen thematically (matching lore/role) since the game itself tints
hero art by the player's empire colour at runtime rather than giving each
hero a fixed personal colour. These are clearly illustrative reinterpretations,
not screenshots or extracted game assets, and are captioned accordingly.

Item/shop data (`src/data/items.ts`) and the upgrade catalogue
(`src/data/balance.ts` → `BAL.upgrades`) were reviewed but only used
indirectly, to accurately name the "Agora of the Empire" / "Temple of
Ascension" feature panel on the homepage — no item stats are presented as
character abilities.

## 3. World — map geometry

Every marker position on `SITE/assets/world/map.svg` (and the identical
inline copy in `SITE/world.html`) was **computed, not estimated**, by
re-running the actual map-generation formulas from:

```
src/game/map.ts → buildMap()
```

with the real constants from `src/data/balance.ts` (`BAL.world.size = 9600`)
and `src/game/map.ts` (`BASE_R`, `OUTER_LIMIT`, `CAPTURE_R`, camp polar
coordinates, hunter patrol points, lane Bézier control points). A short Node
script reproduced `buildMap()`'s coordinate math (base positions, lane
waypoints, tower `laneLerp` positions, capture points, camp positions, boss
position, hunter patrol loop) and the raw output was saved to
`SITE/docs/map-coordinates.json` for verification. All SVG marker
coordinates are that raw data scaled down by ÷10 (world units 0–9600 →
viewBox 0–960).

| Map feature | Source |
|---|---|
| 3 base positions | `buildMap()` — `basePos` (`baseAngles = [-90°, 30°, 150°]`, `BASE_R = 4100`) |
| Lane curves | `buildMap()` — `laneWaypoints` (quadratic Bézier, `LANE_BULGE = 600`) |
| 12 towers (2 tiers × 2 approaches × 3 players) | `buildMap()` — `towers` (`laneLerp(p, 0.26/0.13)` and mirrored `0.74/0.87`) |
| 3 capture points | `buildMap()` — `capturePoints` (`CAPTURE_R = 1750`, 60° offset from each base axis) |
| 12 neutral camps (4 tiers × 3 sectors) | `buildMap()` — `camps` array, tier + `label` fields used directly (`Creek Nest`, `Boar Den`, `Cyclops Hollow`, `Sphinx Perch`) |
| Boss spawn ("the Labyrinth") | `buildMap()` — `bossPos` (map centre) |
| Hunter's territory loop | `buildMap()` — `hunterPatrol` (12-point loop) |
| Walkable boundary radius | `buildMap()` — `OUTER_LIMIT = 4620` |

## 4. World — mobs, camps, bosses, buffs

All names, tiers, buffs and timings on `SITE/world.html` are taken from:

```
src/data/balance.ts → BAL.waves, BAL.mobs, BAL.neutrals, BAL.hunterBeast, BAL.boss, BAL.capture
src/ui/hud.ts → entLabel() (display names: "Hoplite", "Slinger", "Champion", "Raider",
                "Cave Grub", "Bristleback Boar", "Cyclops", "Sphinx",
                "Altar Guardian", "The Stalking Horror")
src/game/game.ts → entLabel()/onBossKilled()/spawnBoss() (boss names
                "Talandros, the Bronze Colossus", "Chthonia, Maw of the Deep";
                "A great presence stirs in the labyrinth…" warning text)
```

| Site claim | Exact source value |
|---|---|
| Lane mob wave cadence "every 25 seconds", first spawn 0:05, strong mob every 3rd wave, Raider joins after minute 14 | `BAL.waves.interval=25`, `firstSpawnAt=5`, `strongEvery=3`, `hunterAfterMin=14` |
| Creek Nest / small camp respawn "3 minutes" | `BAL.neutrals.respawn.small = 180` |
| Boar Den / medium camp respawn "4 minutes" | `BAL.neutrals.respawn.medium = 240` |
| Cyclops Hollow / strong camp respawn "5 minutes" | `BAL.neutrals.respawn.strong = 300` |
| Sphinx Perch / specialist camp respawn "5 minutes" | `BAL.neutrals.respawn.specialist = 300` |
| Altar Guardian respawn "just over 2 minutes" | `BAL.neutrals.respawn.guardian = 130` |
| Cyclops buff "+15% attack, +8 armor for 90s" | `BAL.neutrals.strongBuff = { dur:90, atkPct:0.15, armorAdd:8 }` |
| Sphinx buff "+12% speed, +10% ability power for 75s" | `BAL.neutrals.specialistBuff = { dur:75, speedPct:0.12, powerPct:0.10 }` |
| The Stalking Horror: ambushes isolated heroes, flees when badly hurt, respawn "3 minutes 20 seconds" | `BAL.hunterBeast` (`ambushBonusMult`, `fleeHpPct:0.3`, `respawn:200`, `isolationRadius`) |
| Boss first spawn "ten-minute mark", every "ten minutes", 30s warning | `BAL.boss.firstSpawn=600`, `interval=600`, `announceLead=30` |
| Boss buff "+25% mob damage, 50% less tower damage, 90s" | `BAL.boss.buff = { dur:90, mobDmgPct:0.25, towerResist:0.5 }` |
| Boss names & descriptions (Colossus slam / Maw breath attack) | `BAL.boss.types.colossus` / `.maw` |
| Capture: 8s uncontested to capture, 3 Altar Guardians per point, decay on abandon | `BAL.capture.captureTime=8`, `guardians=3`, `decayRate=0.5` |
| Altar of War / Altar of Stone / Altar of Wind buffs (+12% mob atk / +18% mob HP / +15% mob speed) | `BAL.capture.buffs` array (index matches capture point index in `capturePoints`) |

No mob names, spawn locations, buff values or timings were invented; where a
number is not listed in the tables above but appears on the site, it traces
to the same `balance.ts` block by direct field name.

## 5. Images used as-is

| Asset | Origin | Used for |
|---|---|---|
| `SITE/assets/images/concept-art-battlefield.png` | Copied unmodified from `ConceptArt.png` (project root) | Splash-page background art, homepage "Game Overview" panel, Open Graph share image |

This is the only pre-existing promotional-style artwork found in the
project. The `test/shot-*.png` files are automated test screenshots of the
live UI at gameplay scale (small procedurally-drawn units); they were
reviewed but not used as website assets because at their actual on-screen
size the units are a few pixels across and would look like blurry
placeholders if enlarged — see the note in §2 about why original SVG
character art was produced instead.

## 6. About page

No author biography, credits file, or "About the developer" text exists
anywhere in the project (checked: `package.json`, `README.md`, all source
comments, and a repository-wide text search for "Aluca", "author", and
"credit"). The git commit author name on this repository is `AlucaSol`,
consistent with the name "Aluca Sol" given in the task brief, but no further
biographical facts (background, location, employer, qualifications) are
documented anywhere in the project. Per the placeholder policy, the About
page therefore does not invent any personal history — its "Why Triarchs of
Olympus Exists" and "Design Philosophy" sections instead draw only on
verifiable project facts (the README's stated multiplayer model, and the
structural evidence of a single central balance file and hand-authored
labyrinth in `balance.ts` / `map.ts`).

The About page portrait (`SITE/assets/decorative/about-portrait.svg`) is
wholly original illustration created for this site per the brief's request
for "a 1990s teenage programmer reimagined through an Ancient Greek
aesthetic" — it is explicitly captioned as a stylised, non-photographic
avatar.

## 7. Known gaps / placeholders

- **No overarching "why the war started" myth** exists in the source beyond
  "three empires contesting Olympus, last acropolis standing wins" — see §1.
  Nothing was invented to fill this gap.
- **No per-empire lore** (distinct personality/culture for Azure vs. Crimson
  vs. Verdant) exists beyond their names and colours — the homepage empire
  chips say so only in general terms rather than inventing distinct cultures.
- **No developer biography** exists — see §6.
- **No promotional character art or map art** exists in the project — all
  character portraits, in-game-icon-style images, and the map illustration
  are original SVG artwork created for this site (see §2, §3), built from
  the game's own data and described silhouettes rather than invented from
  nothing.
- `ConceptArt.png` (2.5 MB) could not be further compressed for the web
  because no image-optimisation tool (ImageMagick, `cwebp`, `sharp`, etc.)
  was available in this environment; it is used as-is. See
  `SITE/docs/deployment.md` for a note on optimising it later.
