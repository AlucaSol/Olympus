// ============================================================
// PROCEDURAL VECTOR ARTWORK
// All units are layered canvas paintings drawn once per
// (unitKey, ownerColour) pair, cached to offscreen sprites, and
// blitted with rotation/squash by the renderer. Units are drawn
// centred, facing +x, at a nominal radius of 20 world units,
// supersampled 3x for crisp scaling.
// ============================================================

import { PLAYER_COLORS } from '../data/heroes';

export const NEUTRAL_COL = { main: '#9a8a64', bright: '#cbb98a', dark: '#5a5040', name: 'Wild' };

export function ownerCol(owner: number) {
  return owner >= 0 && owner < 3 ? PLAYER_COLORS[owner] : NEUTRAL_COL;
}

const SS = 3;                  // supersample factor
const NOMINAL = 20;            // nominal unit radius in world units
export const SPRITE_WORLD = 64; // sprite covers 64x64 world units around centre

type Ctx = CanvasRenderingContext2D;
const spriteCache = new Map<string, HTMLCanvasElement>();

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// ---------- PNG override seam ----------
// Every art key (unit sprites here, town decor in townArt.ts) can be replaced
// by a hand-painted transparent PNG without code changes: list it in
// `public/assets/art-overrides.json` as { "<artKey>": "assets/town/file.png" }.
// Owner-tinted variants may use "<artKey>@<owner>" keys (checked first).
// No manifest / missing files -> procedural painting, exactly as before.
const artOverrides = new Map<string, HTMLImageElement>();

export function getArtOverride(artKey: string, owner?: number): HTMLImageElement | null {
  if (owner !== undefined) {
    const tinted = artOverrides.get(`${artKey}@${owner}`);
    if (tinted) return tinted;
  }
  return artOverrides.get(artKey) || null;
}

/** Best-effort, silent: call once at boot before sprites are first baked. */
export async function loadArtOverrides(): Promise<void> {
  try {
    const res = await fetch('assets/art-overrides.json');
    if (!res.ok) return;
    const manifest: Record<string, string> = await res.json();
    await Promise.all(Object.entries(manifest).map(([key, url]) => new Promise<void>(resolve => {
      const img = new Image();
      img.onload = () => { artOverrides.set(key, img); resolve(); };
      img.onerror = () => resolve();
      img.src = url;
    })));
  } catch { /* no manifest — fully procedural */ }
}

/** Get (and cache) the sprite for a unit art key + owner. flash=true gives a white-hot variant. */
export function getSprite(artKey: string, owner: number, flash = false): HTMLCanvasElement {
  const key = `${artKey}|${owner}|${flash ? 'F' : 'N'}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(SPRITE_WORLD * SS);
  const ctx = c.getContext('2d')!;
  const override = getArtOverride(artKey, owner);
  if (override) {
    // painted art is used as-authored — no procedural lighting pass
    ctx.drawImage(override, 0, 0, c.width, c.height);
    if (flash) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    spriteCache.set(key, c);
    return c;
  }
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale(SS, SS);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const col = ownerCol(owner);
  const fn = UNIT_ART[artKey] || UNIT_ART.fallback;
  fn(ctx, col);
  ctx.restore();
  if (flash) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  } else {
    // unified lighting: warm key light from the upper-left, cool shade lower-right
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, 'rgba(255,238,200,0.20)');
    g.addColorStop(0.45, 'rgba(255,238,200,0)');
    g.addColorStop(0.65, 'rgba(10,8,30,0)');
    g.addColorStop(1, 'rgba(10,8,30,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  }
  spriteCache.set(key, c);
  return c;
}

// ---------- shared painting helpers ----------
function E(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill(); ctx.restore();
}
function P(ctx: Ctx, pts: number[][], fill: string, stroke?: string, lw = 1.5) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function ring(ctx: Ctx, x: number, y: number, r: number, col: string, lw: number) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
}
/** Hoplite-style body base: shadow, torso, shoulder pads. Facing +x. */
function humanoid(ctx: Ctx, skin: string, armor: string, trim: string, size = 1) {
  ctx.save(); ctx.scale(size, size);
  E(ctx, 0, 0, 13, 11, armor);                      // torso (top view)
  E(ctx, -2, -9, 6, 4.5, armor); E(ctx, -2, 9, 6, 4.5, armor);  // shoulders
  E(ctx, -2, -9, 4, 3, trim); E(ctx, -2, 9, 4, 3, trim);
  E(ctx, 3, 0, 7.5, 7.5, skin);                     // head
  ctx.restore();
}
function crest(ctx: Ctx, col: string, len = 14) {
  P(ctx, [[-len * 0.55, -2.5], [8, -1.6], [8, 1.6], [-len * 0.55, 2.5]], col);
}
function spear(ctx: Ctx, wood: string, metal: string, len = 30, off = 8) {
  ctx.strokeStyle = wood; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-6, off); ctx.lineTo(len - 8, off); ctx.stroke();
  P(ctx, [[len - 9, off - 2.6], [len, off], [len - 9, off + 2.6]], metal);
}
function roundShield(ctx: Ctx, x: number, y: number, r: number, main: string, trim: string) {
  E(ctx, x, y, r, r, main);
  ring(ctx, x, y, r - 1.5, trim, 1.6);
  E(ctx, x, y, r * 0.3, r * 0.3, trim);
}

// ---------- unit art registry ----------
type ArtFn = (ctx: Ctx, col: { main: string; bright: string; dark: string }) => void;

export const UNIT_ART: Record<string, ArtFn> = {
  fallback(ctx, col) {
    E(ctx, 0, 0, 16, 16, col.main);
    ring(ctx, 0, 0, 16, col.dark, 2);
  },

  // ================= HEROES =================
  alkaios(ctx, col) {
    E(ctx, -8, 0, 12, 10, col.dark);                    // cape
    humanoid(ctx, '#d9a066', '#b0722a', col.bright, 1.1);
    // twin blades
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, -12); ctx.lineTo(24, -16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 12); ctx.lineTo(24, 16); ctx.stroke();
    ctx.strokeStyle = '#8a6a20'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(6, -12); ctx.lineTo(11, -13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 12); ctx.lineTo(11, 13); ctx.stroke();
    // bronze helm with tall crest
    E(ctx, 3, 0, 8, 8, '#c98a2f');
    crest(ctx, col.main, 18);
    E(ctx, 8, 0, 2.5, 4.5, '#3a2a10');                  // visor slit
  },

  kyra(ctx, col) {
    E(ctx, -9, 0, 11, 9, col.main);                     // flowing cloak
    E(ctx, -13, 0, 7, 6, col.dark);
    humanoid(ctx, '#e8c8a0', '#7a7f8a', col.bright, 0.95);
    // silver bow (arc)
    ctx.strokeStyle = '#d8dce8'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(10, 0, 14, -1.15, 1.15); ctx.stroke();
    ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(10 + 14 * Math.cos(-1.15), 14 * Math.sin(-1.15)); ctx.lineTo(10 + 14 * Math.cos(1.15), 14 * Math.sin(1.15)); ctx.stroke();
    // nocked arrow
    ctx.strokeStyle = '#b0722a'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(24, 0); ctx.stroke();
    P(ctx, [[24, -2], [28, 0], [24, 2]], '#e8e8f0');
    // moon-braid
    E(ctx, -1, 0, 6.5, 6.5, '#e8c8a0');
    E(ctx, -5, -4, 4, 2.5, '#d8dce8', -0.5);
    ring(ctx, 3, 0, 7.5, col.bright, 1.2);
  },

  skiron(ctx, col) {
    // trailing wind scarf
    P(ctx, [[-24, -4], [-8, -2], [-8, 2], [-20, 6]], col.bright);
    humanoid(ctx, '#d9b58a', '#4a5a66', col.bright, 0.85);
    // twin daggers
    ctx.strokeStyle = '#e8e8f0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(8, -9); ctx.lineTo(19, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, 9); ctx.lineTo(19, 12); ctx.stroke();
    // winged sandal glints
    E(ctx, -6, -12, 3, 1.6, '#f0f0ff', -0.6);
    E(ctx, -6, 12, 3, 1.6, '#f0f0ff', 0.6);
    // hood
    E(ctx, 2, 0, 7, 7, '#37444d');
    E(ctx, 6, 0, 3, 4, '#141a1f');
    ring(ctx, 2, 0, 7, col.main, 1.4);
  },

  thalassa(ctx, col) {
    // flowing sea-robe
    P(ctx, [[-18, -10], [-2, -13], [6, 0], [-2, 13], [-18, 10], [-10, 0]], '#2d6a78');
    E(ctx, -3, 0, 11, 10, '#3d8a9a');
    E(ctx, -3, -8, 5, 3.5, col.bright); E(ctx, -3, 8, 5, 3.5, col.bright);
    E(ctx, 3, 0, 7, 7, '#e8c8a0');
    // kelp hair
    E(ctx, -3, -5, 6, 3, '#1d4a55', -0.7); E(ctx, -3, 5, 6, 3, '#1d4a55', 0.7);
    // trident
    ctx.strokeStyle = '#c9b037'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(24, 12); ctx.stroke();
    P(ctx, [[24, 8], [30, 12], [24, 16], [24, 13.5], [27, 12], [24, 10.5]], '#e8d060');
    ctx.strokeStyle = '#e8d060'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(22, 8); ctx.lineTo(26, 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(22, 16); ctx.lineTo(26, 16); ctx.stroke();
    ring(ctx, 3, 0, 7.5, col.bright, 1.2);
  },

  lysander(ctx, col) {
    // banner pole on back
    ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-2, -14); ctx.stroke();
    P(ctx, [[-14, -6], [-22, -14], [-13, -13]], col.main);
    humanoid(ctx, '#d9a066', '#8a7440', col.bright, 1.0);
    roundShield(ctx, -1, 12, 8, col.main, '#c9b037');
    spear(ctx, '#7a5a30', '#e8e0d0', 30, -9);
    // officer helm
    E(ctx, 3, 0, 8, 7.5, '#c9b037');
    crest(ctx, col.bright, 20);
    E(ctx, 8, 0, 2.2, 4, '#3a2a10');
  },

  doria(ctx, col) {
    E(ctx, -6, 0, 13, 12, '#5a6470');                  // heavy frame
    humanoid(ctx, '#d9a066', '#6a7480', col.bright, 1.15);
    // tower shield held forward
    ctx.save(); ctx.translate(14, 0);
    P(ctx, [[-3, -15], [5, -13], [7, 0], [5, 13], [-3, 15], [-1, 0]], '#8a94a0', col.main, 2);
    E(ctx, 2, 0, 3, 5, col.main);
    ctx.restore();
    // short spear over the top
    spear(ctx, '#7a5a30', '#e8e0d0', 27, 10);
    E(ctx, 1, 0, 7.5, 7.5, '#98a2ae');
    crest(ctx, col.main, 12);
  },

  iole(ctx, col) {
    // leaf-robe
    P(ctx, [[-16, -9], [0, -12], [7, 0], [0, 12], [-16, 9], [-8, 0]], '#4a7a3d');
    E(ctx, -2, 0, 10, 9, '#5f9a4d');
    E(ctx, 3, 0, 6.5, 6.5, '#e8c8a0');
    // hood
    ctx.beginPath(); ctx.arc(1, 0, 8, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fillStyle = '#3d6633'; ctx.fill();
    // staff with bloom
    ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-2, 10); ctx.lineTo(22, 10); ctx.stroke();
    E(ctx, 24, 10, 4, 4, col.bright);
    E(ctx, 24, 10, 2, 2, '#fff8d8');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      E(ctx, 24 + Math.cos(a) * 5, 10 + Math.sin(a) * 5, 1.8, 1.8, '#8fc07a');
    }
    ring(ctx, 3, 0, 7, col.main, 1.2);
  },

  pyrrhos(ctx, col) {
    // trailing ash-red war cloak
    P(ctx, [[-24, -7], [-6, -11], [4, 0], [-6, 11], [-22, 8], [-13, 0]], '#4a1814');
    P(ctx, [[-20, -5], [-8, -8], [-8, 8], [-18, 6]], '#661f18');
    // dark bronze cuirass
    E(ctx, -2, 0, 12, 10.5, '#3a2c1e');
    E(ctx, -2, 0, 9.5, 8, '#4d3a26');
    // ceremonial pauldrons with ember gems
    E(ctx, -3, -9.5, 6, 4.5, '#31251a'); E(ctx, -3, 9.5, 6, 4.5, '#31251a');
    E(ctx, -3, -9.5, 2.2, 2.2, '#ff8a30'); E(ctx, -3, 9.5, 2.2, 2.2, '#ff8a30');
    E(ctx, -3, -9.5, 1, 1, '#ffd898'); E(ctx, -3, 9.5, 1, 1, '#ffd898');
    // titan rune etched on the chest plating
    ctx.strokeStyle = '#ff7a30'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-2, 0); ctx.lineTo(-7, 3); ctx.moveTo(-4.5, -1.5); ctx.lineTo(-4.5, 1.5); ctx.stroke();
    // glowing seams in the armour
    ctx.strokeStyle = 'rgba(255,122,48,0.75)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-9, 5); ctx.lineTo(-1, 6.5); ctx.moveTo(-10, -6); ctx.lineTo(-3, -6.5); ctx.stroke();
    // horned ritual helm, faceless but for burning eyes
    E(ctx, 4, 0, 7.2, 6.8, '#2c2118');
    P(ctx, [[1, -5.5], [-4, -12], [4, -7.5]], '#4d3a26');
    P(ctx, [[1, 5.5], [-4, 12], [4, 7.5]], '#4d3a26');
    E(ctx, 7.5, -2.4, 1.6, 1.3, '#ffb020'); E(ctx, 7.5, 2.4, 1.6, 1.3, '#ffb020');
    E(ctx, 8, -2.4, 0.7, 0.6, '#fff2c8'); E(ctx, 8, 2.4, 0.7, 0.6, '#fff2c8');
    // obsidian crescent staff crackling with titan fire
    ctx.strokeStyle = '#241a12'; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(21, -12); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,138,48,0.9)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(2, -12.8); ctx.lineTo(8, -11.4); ctx.moveTo(12, -12.6); ctx.lineTo(17, -11.5); ctx.stroke();
    ctx.strokeStyle = '#c9762e'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(24, -12, 5.5, Math.PI * 0.55, Math.PI * 1.45, false); ctx.stroke();
    // caged ember orb
    E(ctx, 24, -12, 3.6, 3.6, 'rgba(255,122,48,0.45)');
    E(ctx, 24, -12, 2.6, 2.6, '#ff8a30');
    E(ctx, 24, -12, 1.4, 1.4, '#ffd898');
    E(ctx, 24.4, -12.4, 0.6, 0.6, '#fffbe8');
    // faction sash knot
    E(ctx, -8, 0, 2.4, 2.4, col.main);
  },

  eurydice(ctx, col) {
    // trailing midnight vestment, gold-hemmed
    P(ctx, [[-19, -9], [-3, -12], [6, 0], [-3, 12], [-19, 9], [-11, 0]], '#26305c');
    P(ctx, [[-15, -6], [-4, -8], [-4, 8], [-14, 6]], '#3a4a85');
    // robed shoulders with golden trim
    E(ctx, -3, 0, 11, 10, '#32406e');
    E(ctx, -3, -8.5, 5, 3.5, '#c9a84c'); E(ctx, -3, 8.5, 5, 3.5, '#c9a84c');
    E(ctx, -3, -8.5, 3.4, 2.2, '#3a4a85'); E(ctx, -3, 8.5, 3.4, 2.2, '#3a4a85');
    // deep hood framing her face; gold circlet with the Delphic gem
    ctx.beginPath(); ctx.arc(1, 0, 8.4, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fillStyle = '#1d2547'; ctx.fill();
    E(ctx, 3.5, 0, 6.2, 6.2, '#e2bc92');
    ring(ctx, 3.5, 0, 6.6, '#c9a84c', 1.2);
    E(ctx, 8.5, 0, 1.5, 1.3, '#5a8ad8');
    // ceremonial staff: gold shaft crowned by the laurel-ringed seeing eye
    ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, -11.5); ctx.lineTo(21, -11.5); ctx.stroke();
    ring(ctx, 24, -11.5, 4.6, '#e05a70', 1.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      E(ctx, 24 + Math.cos(a) * 5.6, -11.5 + Math.sin(a) * 5.6, 1.1, 1.1, '#c9a84c');
    }
    E(ctx, 24, -11.5, 2.6, 2.6, '#f6efe2');
    E(ctx, 24.5, -11.5, 1.2, 1.2, '#31255a');
    // the floating omen-sigil turning above her open hand
    ring(ctx, 14, 10, 3.8, '#b060e0', 1.3);
    ctx.strokeStyle = '#b060e0'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      ctx.beginPath(); ctx.moveTo(14 + Math.cos(a) * 4.6, 10 + Math.sin(a) * 4.6);
      ctx.lineTo(14 + Math.cos(a) * 6.4, 10 + Math.sin(a) * 6.4); ctx.stroke();
    }
    E(ctx, 14, 10, 1.5, 1.5, '#e6c8ff');
    // faction sash knot
    E(ctx, -8, 0, 2.4, 2.4, col.main);
  },

  brontes(ctx, col) {
    // immortal smith: haunch and barrel torso of hammered iron
    E(ctx, -9, 0, 13, 12, '#382e21');
    E(ctx, -2, 0, 15, 13, '#54462f');
    E(ctx, -2, -11.5, 8, 5.5, '#493c28'); E(ctx, -2, 11.5, 8, 5.5, '#493c28');
    // scorched leather apron across the front
    P(ctx, [[1, -8], [10, -5], [10, 5], [1, 8]], '#6a4a30');
    ctx.strokeStyle = '#4a3524'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(3, -6); ctx.lineTo(3, 6); ctx.stroke();
    // ember seams glowing between the plates
    ctx.strokeStyle = 'rgba(255,138,48,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-11, -7); ctx.lineTo(-4, -8); ctx.moveTo(-12, 6); ctx.lineTo(-5, 8); ctx.stroke();
    E(ctx, -2, -11.5, 1.6, 1.6, '#ff8a30'); E(ctx, -2, 11.5, 1.6, 1.6, '#ff8a30');
    // great beard sweeping back from the jaw
    P(ctx, [[5, 3], [-4, 9], [-8, 5], [1, 1]], '#2c2118');
    P(ctx, [[5, -3], [-4, -9], [-8, -5], [1, -1]], '#2c2118');
    // riveted helm with the smith's twin lenses burning
    E(ctx, 7, 0, 8, 7.5, '#5a4a38');
    ring(ctx, 7, 0, 8, '#3a2e20', 1.2);
    E(ctx, 10.5, -2.8, 2.3, 2.3, '#c9a84c'); E(ctx, 10.5, 2.8, 2.3, 2.3, '#c9a84c');
    E(ctx, 10.5, -2.8, 1.4, 1.4, '#ffb020'); E(ctx, 10.5, 2.8, 1.4, 1.4, '#ffb020');
    E(ctx, 10.9, -3.1, 0.6, 0.6, '#fff2c8'); E(ctx, 10.9, 3.1, 0.6, 0.6, '#fff2c8');
    // the thunder-hammer, held wide: oak haft, rune-struck stone head
    ctx.save(); ctx.rotate(0.35);
    ctx.strokeStyle = '#4a3524'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(2, 10); ctx.lineTo(21, 15); ctx.stroke();
    P(ctx, [[19, 8], [31, 10], [32, 20], [20, 22]], '#4c443c', '#2e2a24', 1.5);
    P(ctx, [[20, 9.5], [26, 10.5], [26, 14], [20, 13]], '#5e564c');
    ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(24, 12); ctx.lineTo(27, 15); ctx.lineTo(24.5, 15.5); ctx.lineTo(27.5, 18.5); ctx.stroke();
    ctx.restore();
    // faction band on the near pauldron
    ring(ctx, 7, 0, 9.2, col.main, 1.3);
  },

  lykaon(ctx, col) {
    // tattered moss-green hunting cloak streaming behind
    P(ctx, [[-22, -6], [-6, -9], [-4, 0], [-7, 9], [-19, 7], [-12, 0]], '#3d5a3a');
    P(ctx, [[-20, -4], [-25, -1], [-19, 1]], '#2c4229');
    P(ctx, [[-18, 6], [-23, 10], [-16, 8]], '#2c4229');
    // hunched grey-furred frame
    E(ctx, -3, 0, 12, 10, '#5c5c64');
    E(ctx, -3, 0, 9, 7.5, '#73737d');
    E(ctx, -2, -9, 5.5, 4, '#67676f'); E(ctx, -2, 9, 5.5, 4, '#67676f');
    // old stitches across the flank
    ctx.strokeStyle = '#43434b'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-8, 3); ctx.lineTo(-2, 5); ctx.stroke();
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-7 + i * 2.4, 2.2 + i * 0.7); ctx.lineTo(-7.6 + i * 2.4, 5.4 + i * 0.7); ctx.stroke(); }
    // bronze bracers over reaching clawed forelimbs
    E(ctx, 3, -10, 2.8, 2.2, '#b08a3a'); E(ctx, 3, 10, 2.8, 2.2, '#b08a3a');
    P(ctx, [[6, -10.5], [14, -13.5], [8, -8.5]], '#e8e0d0');
    P(ctx, [[6, 10.5], [14, 13.5], [8, 8.5]], '#e8e0d0');
    P(ctx, [[9, -9], [15, -10.5], [10, -7.5]], '#d8d0c0');
    P(ctx, [[9, 9], [15, 10.5], [10, 7.5]], '#d8d0c0');
    // wolf head, muzzle thrust forward
    E(ctx, 6, 0, 7, 6, '#82828c');
    P(ctx, [[10, -2.8], [19.5, 0], [10, 2.8]], '#8e8e98');
    E(ctx, 19, 0, 1.6, 1.3, '#1c1c22');
    P(ctx, [[12, -2.2], [14, -3.6], [13, -1.4]], '#e8e0d0');   // bared fangs
    P(ctx, [[12, 2.2], [14, 3.6], [13, 1.4]], '#e8e0d0');
    // burning yellow eyes
    E(ctx, 8, -3, 1.6, 1.4, '#ffd040'); E(ctx, 8, 3, 1.6, 1.4, '#ffd040');
    E(ctx, 8.4, -3.2, 0.6, 0.5, '#fff6d0'); E(ctx, 8.4, 3.2, 0.6, 0.5, '#fff6d0');
    // ragged ears laid back
    P(ctx, [[2, -5], [-3.5, -11.5], [6, -7]], '#6a6a74');
    P(ctx, [[2, 5], [-3.5, 11.5], [6, 7]], '#6a6a74');
    // faction sash knot on the belt
    E(ctx, -8, 0, 2.4, 2.4, col.main);
  },

  lykaonMoon(ctx, col) {
    // Full Moon form: the curse in full flower — silvered fur, moonlit eyes
    ring(ctx, 0, 0, 17, 'rgba(200,220,255,0.75)', 1.6);
    P(ctx, [[-23, -7], [-6, -9], [-4, 0], [-7, 9], [-20, 8], [-12, 0]], '#2f4630');
    P(ctx, [[-21, -4], [-26, -1], [-20, 1]], '#223424');
    E(ctx, -3, 0, 13, 11, '#8a8a96');
    E(ctx, -3, 0, 10, 8.2, '#a8a8b6');
    E(ctx, -2, -10, 6, 4.4, '#9696a4'); E(ctx, -2, 10, 6, 4.4, '#9696a4');
    E(ctx, 3, -11, 3, 2.4, '#b08a3a'); E(ctx, 3, 11, 3, 2.4, '#b08a3a');
    // longer killing claws
    P(ctx, [[6, -11], [16.5, -15], [8, -8.5]], '#f4f0e4');
    P(ctx, [[6, 11], [16.5, 15], [8, 8.5]], '#f4f0e4');
    P(ctx, [[9, -9.5], [17, -11.5], [10.5, -7.5]], '#e4dccc');
    P(ctx, [[9, 9.5], [17, 11.5], [10.5, 7.5]], '#e4dccc');
    // head thrown forward, jaws wide
    E(ctx, 6, 0, 7.6, 6.6, '#9a9aa8');
    P(ctx, [[10, -3.2], [21, 0], [10, 3.2]], '#a8a8b6');
    E(ctx, 20.4, 0, 1.7, 1.4, '#1c1c22');
    P(ctx, [[12, -2.6], [14.6, -4.4], [13.4, -1.6]], '#fff');
    P(ctx, [[12, 2.6], [14.6, 4.4], [13.4, 1.6]], '#fff');
    // moon-white burning gaze
    E(ctx, 8, -3.2, 1.8, 1.5, '#e8f6ff'); E(ctx, 8, 3.2, 1.8, 1.5, '#e8f6ff');
    E(ctx, 8.4, -3.4, 0.7, 0.6, '#ffffff'); E(ctx, 8.4, 3.4, 0.7, 0.6, '#ffffff');
    P(ctx, [[2, -5.5], [-4, -12.5], [6.5, -7.5]], '#8e8e9c');
    P(ctx, [[2, 5.5], [-4, 12.5], [6.5, 7.5]], '#8e8e9c');
    E(ctx, -8, 0, 2.4, 2.4, col.main);
  },

  harmonia(ctx, col) {
    // white court robe with the violet drape of concord
    P(ctx, [[-18, -9], [-2, -12], [6, 0], [-2, 12], [-18, 9], [-10, 0]], '#ece4d8');
    P(ctx, [[-15, -7], [-4, -9], [-6, 0], [-4, 9], [-14, 7]], '#9a5ab0');
    // trailing rose ribbon
    P(ctx, [[-14, 4], [-23, 10], [-16, 6]], '#e8a8c8');
    E(ctx, -3, 0, 10.5, 9.5, '#f2ead8');
    // violet sash and golden belt clasp
    ctx.strokeStyle = '#b478c8'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(3, 6); ctx.stroke();
    E(ctx, -1, 0, 2.2, 2.2, '#c9a84c');
    // dark curls beneath a golden laurel
    E(ctx, 3, 0, 6.6, 6.6, '#dcae86');
    E(ctx, -1, -4.5, 4, 2.8, '#3a2a20', -0.5); E(ctx, -1, 4.5, 4, 2.8, '#3a2a20', 0.5);
    E(ctx, -2.5, 0, 3, 4.5, '#3a2a20');
    ring(ctx, 3, 0, 7, '#c9a84c', 1.1);
    // gold staff crowned with dove wings
    ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, -11); ctx.lineTo(21, -11); ctx.stroke();
    P(ctx, [[21, -13.5], [27, -17.5], [23.5, -10.5]], '#f8f4ec');
    P(ctx, [[21, -8.5], [27, -4.5], [23.5, -11.5]], '#f8f4ec');
    E(ctx, 22.5, -11, 2, 2, '#ffe9a8');
    // a dove alighting on her open hand
    E(ctx, 13, 10, 3, 2.2, '#f8f4ec');
    P(ctx, [[13.5, 8.6], [18, 6.6], [15, 10.2]], '#f0ece0');
    E(ctx, 16.2, 9.4, 1, 0.9, '#f8f4ec');
    P(ctx, [[17.2, 9.4], [18.4, 9.7], [17.2, 10]], '#c9a84c');
    // faction knot at the shoulder
    E(ctx, -8, 0, 2.4, 2.4, col.main);
  },

  // ================= LANE MOBS =================
  melee(ctx, col) {
    humanoid(ctx, '#d9b58a', col.main, col.bright, 0.72);
    roundShield(ctx, 6, 8, 5.5, col.dark, col.bright);
    spear(ctx, '#7a5a30', '#e8e0d0', 22, -6);
    E(ctx, 2, 0, 5.5, 5.5, col.dark);
    crest(ctx, col.bright, 8);
  },
  ranged(ctx, col) {
    humanoid(ctx, '#d9b58a', col.dark, col.bright, 0.66);
    ctx.strokeStyle = '#c8b890'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(8, 0, 9, -1.1, 1.1); ctx.stroke();
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(8 + 9 * Math.cos(-1.1), 9 * Math.sin(-1.1)); ctx.lineTo(8 + 9 * Math.cos(1.1), 9 * Math.sin(1.1)); ctx.stroke();
    E(ctx, 2, 0, 5, 5, col.main);
    P(ctx, [[-2, -5], [-7, -8], [-4, -3]], col.bright);   // hood tail
  },
  strong(ctx, col) {
    E(ctx, -3, 0, 16, 14, col.dark);                   // bulk
    E(ctx, -3, -11, 8, 5, col.main); E(ctx, -3, 11, 8, 5, col.main);
    E(ctx, 5, 0, 9, 9, '#c9a06a');
    // heavy club
    ctx.save(); ctx.rotate(0.5);
    ctx.strokeStyle = '#6a4a20'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(24, 14); ctx.stroke();
    E(ctx, 26, 15, 6, 5, '#8a6a40');
    ctx.restore();
    // horned helm
    E(ctx, 5, 0, 7, 7, col.main);
    P(ctx, [[3, -6], [-2, -13], [7, -8]], '#e8e0d0');
    P(ctx, [[3, 6], [-2, 13], [7, 8]], '#e8e0d0');
    E(ctx, 9, 0, 2, 3.5, '#2a1a08');
  },
  hunterMob(ctx, col) {
    // lean fast raider with twin javelins
    P(ctx, [[-18, -3], [-6, -1], [-6, 1], [-15, 4]], col.bright);
    humanoid(ctx, '#c9a06a', col.dark, col.bright, 0.6);
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(4, -7); ctx.lineTo(20, -9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(20, 9); ctx.stroke();
    E(ctx, 2, 0, 4.5, 4.5, col.main);
  },
  summon(ctx, col) {
    humanoid(ctx, '#d9b58a', col.main, '#c9b037', 0.7);
    roundShield(ctx, 6, 8, 5.5, '#c9b037', col.bright);
    spear(ctx, '#7a5a30', '#e8e0d0', 22, -6);
    E(ctx, 2, 0, 5.5, 5.5, '#c9b037');
    crest(ctx, col.bright, 9);
    ring(ctx, 0, 0, 15, col.bright, 1);                // summoned shimmer
  },

  // ================= NEUTRALS =================
  smallGrub(ctx) {
    // creek imp: wet teal frog-sprite of the shallows
    E(ctx, -5, 0, 8.5, 7, '#1e5a58');                   // haunched body
    E(ctx, -5, 0, 6.5, 5, '#2d7a72');
    // splayed webbed hind legs
    P(ctx, [[-8, -5], [-15, -9], [-9, -1]], '#1a4a48');
    P(ctx, [[-8, 5], [-15, 9], [-9, 1]], '#1a4a48');
    P(ctx, [[-14, -9], [-17, -11], [-13, -7.5]], '#3d8a80');
    P(ctx, [[-14, 9], [-17, 11], [-13, 7.5]], '#3d8a80');
    // wide head with glowing lantern eyes
    E(ctx, 4, 0, 6.5, 5.8, '#2d7a72');
    E(ctx, 6, -3.4, 2.2, 2.2, '#0f2e2c');
    E(ctx, 6, 3.4, 2.2, 2.2, '#0f2e2c');
    E(ctx, 6.4, -3.4, 1.3, 1.3, '#a8f0d8');
    E(ctx, 6.4, 3.4, 1.3, 1.3, '#a8f0d8');
    E(ctx, 6.7, -3.7, 0.5, 0.5, '#f0fff8');
    E(ctx, 6.7, 3.7, 0.5, 0.5, '#f0fff8');
    // little forelimbs gripping a reed spear
    ctx.strokeStyle = '#5a8a4a'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(2, 6); ctx.lineTo(15, 8); ctx.stroke();
    P(ctx, [[15, 8], [18.5, 8.6], [15, 9.6]], '#8ab060');
    // wet-skin glints and speckles
    E(ctx, -3, -2.5, 2.6, 1.4, 'rgba(190,240,225,0.5)', -0.4);
    E(ctx, 3, -1.5, 1.2, 0.7, 'rgba(190,240,225,0.6)', -0.3);
    E(ctx, -7, 2, 0.8, 0.8, '#48a090'); E(ctx, -2, 4, 0.7, 0.7, '#48a090');
    // shell ornament on the back
    E(ctx, -6, 0, 2.4, 2, '#c8b890', 0.3);
    ctx.strokeStyle = '#8a7a55'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(-6, 0, 1.4, 0, Math.PI * 2); ctx.stroke();
  },
  mediumBoar(ctx) {
    E(ctx, -4, 0, 13, 9, '#6a4a35');
    E(ctx, -10, 0, 7, 6, '#5a3a28');                   // haunches
    E(ctx, 7, 0, 7.5, 6, '#7a5a40');                   // head
    P(ctx, [[10, -4], [18, -8], [12, -2]], '#e8d8c0');  // tusks
    P(ctx, [[10, 4], [18, 8], [12, 2]], '#e8d8c0');
    E(ctx, 11, -2, 1.4, 1.4, '#f0d020'); E(ctx, 11, 2, 1.4, 1.4, '#f0d020');
    // bristle ridge
    for (let i = 0; i < 4; i++) P(ctx, [[-10 + i * 5, -1.5], [-8 + i * 5, -4], [-6 + i * 5, -1.5]], '#3a2418');
  },
  strongCyclops(ctx) {
    // hulking frame: haunch, torso, massive shoulders
    E(ctx, -10, 0, 12, 12, '#75603f');
    E(ctx, -4, 0, 17, 14.5, '#8f7550');
    E(ctx, -4, -13.5, 10, 7, '#836a47'); E(ctx, -4, 13.5, 10, 7, '#836a47');
    // muscle shading
    E(ctx, -8, 4, 9, 6, 'rgba(70,52,32,0.4)');
    E(ctx, 0, -5, 8, 5, 'rgba(226,196,150,0.35)');
    // leather harness strap across the chest
    ctx.strokeStyle = '#4a3524'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(2, 12); ctx.stroke();
    E(ctx, -2, 0, 2.2, 2.2, '#b08a3a');                 // bronze buckle
    // heavy brow and head
    E(ctx, 9, 0, 10.5, 9.5, '#9a8058');
    P(ctx, [[4, -7.5], [1, -15], [10, -9]], '#c8b890');  // cracked horn
    P(ctx, [[6, -13], [4, -15], [8, -13.5]], '#8f7550');
    // THE eye: big, bloodshot, unmistakable
    E(ctx, 12.5, 0, 5, 4.6, '#f2ead6');
    ctx.strokeStyle = '#b04030'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(9.5, -2.5); ctx.lineTo(12, -0.5); ctx.moveTo(9.5, 2.5); ctx.lineTo(12, 0.8); ctx.stroke();
    E(ctx, 13.5, 0, 2.4, 2.4, '#7a3a18');
    E(ctx, 13.8, 0, 1.2, 1.2, '#1c0f08');
    E(ctx, 12.8, -1, 0.7, 0.7, '#fff6e0');
    // heavy brow ridge over the eye
    P(ctx, [[6, -5.5], [17, -3.5], [17, -1.8], [6, -3.6]], '#75603f');
    // snarling underjaw tusks
    P(ctx, [[14, 4.5], [18.5, 6.5], [15, 6.8]], '#e8dcc0');
    // spiked stone club, held wide
    ctx.save(); ctx.rotate(0.42);
    ctx.strokeStyle = '#54412a'; ctx.lineWidth = 4.6;
    ctx.beginPath(); ctx.moveTo(5, 10); ctx.lineTo(25, 15); ctx.stroke();
    E(ctx, 28, 15.8, 7.5, 6.2, '#6d5a40');
    E(ctx, 26.5, 14.5, 3, 2.4, '#7f6c50');
    for (let i = 0; i < 4; i++) {
      const a = -0.9 + i * 0.62;
      P(ctx, [[28 + Math.cos(a) * 6, 15.8 + Math.sin(a) * 5], [28 + Math.cos(a) * 10.5, 15.8 + Math.sin(a) * 9], [28 + Math.cos(a + 0.35) * 6, 15.8 + Math.sin(a + 0.35) * 5]], '#8f8070');
    }
    ctx.restore();
    // old battle scars
    ctx.strokeStyle = '#5c4930'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(-6, -4); ctx.moveTo(-11, 7); ctx.lineTo(-5, 9); ctx.stroke();
  },
  specialistSphinx(ctx) {
    // winged lion body, woman's face — the riddle-keeper
    E(ctx, -6, 0, 13, 9, '#c9a05a');
    P(ctx, [[-4, -6], [-16, -18], [2, -9]], '#e8cf90');  // wings
    P(ctx, [[-4, 6], [-16, 18], [2, 9]], '#e8cf90');
    E(ctx, 8, 0, 7, 6.5, '#e8c8a0');
    E(ctx, 8, 0, 8, 7.5, 'rgba(201,160,90,0)');
    ctx.beginPath(); ctx.arc(6, 0, 9, Math.PI * 0.6, Math.PI * 1.4);
    ctx.fillStyle = '#2a3a6a'; ctx.fill();             // headdress
    E(ctx, 10, -2, 1.2, 1.8, '#203050'); E(ctx, 10, 2, 1.2, 1.8, '#203050');
    ring(ctx, 8, 0, 8.5, '#c9b037', 1.4);
  },
  guardian(ctx, col) {
    // animated marble statue
    E(ctx, -2, 0, 12, 10, '#b8bcc8');
    E(ctx, -2, -8, 5, 4, '#a8acb8'); E(ctx, -2, 8, 5, 4, '#a8acb8');
    E(ctx, 4, 0, 7, 7, '#c8ccd8');
    E(ctx, 7, -2, 1.5, 2, col.main); E(ctx, 7, 2, 1.5, 2, col.main); // glowing eyes
    P(ctx, [[0, -6], [-4, -12], [5, -8]], '#d8dce8');
    // stone blade
    ctx.strokeStyle = '#989cA8'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(6, 9); ctx.lineTo(22, 13); ctx.stroke();
    // cracks
    ctx.strokeStyle = '#7a7e8a'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-3, 0); ctx.lineTo(-7, 4); ctx.stroke();
  },
  hunterBeast(ctx) {
    // the Stalking Horror: shadow chimera
    E(ctx, -8, 0, 14, 9, '#1d2430');
    E(ctx, -16, 0, 7, 6, '#141a24');
    E(ctx, 6, 0, 9, 8, '#242c3a');
    // mane of shadow spikes
    for (let i = 0; i < 5; i++) {
      const a = -1.2 + i * 0.6;
      P(ctx, [[0, 0], [-4 - Math.cos(a) * 12, -Math.sin(a) * 12], [2, 0]], '#0d1118');
    }
    E(ctx, 10, -3, 2, 2, '#ff4030'); E(ctx, 10, 3, 2, 2, '#ff4030');  // burning eyes
    P(ctx, [[13, -4], [20, -2], [13, 0]], '#e8e8f0');   // fangs
    P(ctx, [[13, 4], [20, 2], [13, 0]], '#e8e8f0');
    P(ctx, [[-20, -2], [-30, -6], [-22, 2]], '#141a24'); // tail
  },
  colossus(ctx) {
    // Talandros: bronze giant
    E(ctx, -3, 0, 22, 18, '#8a5a20');
    E(ctx, -3, -15, 11, 7, '#a06a28'); E(ctx, -3, 15, 11, 7, '#a06a28');
    E(ctx, 10, 0, 12, 11, '#b0722a');
    E(ctx, 15, -3.5, 2.5, 2.5, '#ffd040'); E(ctx, 15, 3.5, 2.5, 2.5, '#ffd040');
    // seams of light
    ctx.strokeStyle = '#ffd040'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-14, -8); ctx.lineTo(-4, 0); ctx.lineTo(-14, 8); ctx.stroke();
    P(ctx, [[6, -10], [2, -20], [12, -12]], '#c9b037');
    P(ctx, [[6, 10], [2, 20], [12, 12]], '#c9b037');
    // colossal fist
    E(ctx, 22, 12, 8, 7, '#a06a28');
    ring(ctx, 22, 12, 8, '#6a4210', 2);
  },
  maw(ctx) {
    // Chthonia: deep serpent
    E(ctx, -14, 0, 12, 8, '#2d4a44');
    E(ctx, -4, 0, 13, 10, '#375a52');
    E(ctx, 9, 0, 11, 9, '#41695f');
    // gaping maw
    P(ctx, [[14, -7], [30, -12], [18, -1], [30, 12], [14, 7], [17, 0]], '#1a2e2a');
    for (let i = 0; i < 3; i++) {
      P(ctx, [[16 + i * 4, -5 + i], [20 + i * 4, -8 + i], [18 + i * 4, -2 + i]], '#d8e8d0');
      P(ctx, [[16 + i * 4, 5 - i], [20 + i * 4, 8 - i], [18 + i * 4, 2 - i]], '#d8e8d0');
    }
    E(ctx, 8, -5, 2, 2, '#80ffb0'); E(ctx, 8, 5, 2, 2, '#80ffb0');
    // dorsal fins
    for (let i = 0; i < 3; i++) P(ctx, [[-18 + i * 9, -2], [-14 + i * 9, -12], [-10 + i * 9, -2]], '#233d38');
  },

  // ================= STRUCTURES =================
  tower(ctx, col) {
    E(ctx, 2, 4, 20, 11, 'rgba(0,0,0,0.4)');           // shadow
    E(ctx, 0, 0, 18, 18, '#7b7460');                   // weathered marble base
    ring(ctx, 0, 0, 18, '#4c4536', 2);
    E(ctx, -1.5, -1.5, 14, 14, '#8d8672');
    // cracks in the platform
    ctx.strokeStyle = 'rgba(40,32,20,0.5)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-5, 2); ctx.lineTo(-8, -4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(9, -9); ctx.lineTo(5, -3); ctx.stroke();
    // ring of squat columns
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      E(ctx, Math.cos(a) * 11 + 1, Math.sin(a) * 11 + 1.4, 2.6, 2.6, 'rgba(0,0,0,0.4)');
      E(ctx, Math.cos(a) * 11, Math.sin(a) * 11, 2.6, 2.6, '#9c9580');
      E(ctx, Math.cos(a) * 11 - 0.6, Math.sin(a) * 11 - 0.6, 1.4, 1.4, '#b5ae96');
    }
    // faction trim + bronze brazier bowl (the renderer dances a flame on top)
    ring(ctx, 0, 0, 15, col.main, 1.6);
    E(ctx, 0, 0, 7.5, 7.5, '#3a2c1a');
    E(ctx, 0, 0, 6, 6, '#7c5a26');
    E(ctx, 0, 0, 4.2, 4.2, '#2a1c0c');
    E(ctx, -1, -1, 1.6, 1.6, 'rgba(255,220,150,0.55)');
  },
  base(ctx, col) {
    // THE MAIN EMPIRE STATUE, lower layer: the tiered pedestal only. This is
    // the match objective at the heart of each fortified town; its footprint
    // is a solid collider (map.ts stamps r=112) and it draws beneath units.
    // The colossus figure lives in `baseTop`, which the renderer overlays in
    // front of ALL units — everything passes behind the statue, never over it.
    E(ctx, 0, 1.2, 29.5, 29, 'rgba(0,0,0,0.45)');                 // contact shadow
    // tiered circular pedestal
    E(ctx, 0, 0, 29, 29, '#6f6752');
    ring(ctx, 0, 0, 29, '#37301f', 2);
    E(ctx, -1, -1, 25, 25, '#8a8069');
    E(ctx, -1.5, -1.5, 21, 21, '#9c937b');
    // tier rim shading sells the stacked height: bright upper-left lips,
    // deep ambient occlusion under each south-east edge
    ctx.strokeStyle = 'rgba(20,16,10,0.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, 25.2, -Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 21.4, -Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,226,190,0.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(-1, -1, 24.6, Math.PI * 0.8, Math.PI * 1.7); ctx.stroke();
    ctx.beginPath(); ctx.arc(-1.5, -1.5, 20.6, Math.PI * 0.8, Math.PI * 1.7); ctx.stroke();
    ring(ctx, 0, 0, 21.5, col.main, 1.8);                          // empire inlay ring
    // carved victory-laurel band on the mid tier
    ctx.strokeStyle = 'rgba(216,180,104,0.55)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 23.2, Math.sin(a) * 23.2, 2, a + 0.7, a + Math.PI * 1.5);
      ctx.stroke();
    }
    // four eternal flame braziers at the pedestal corners — the candles the
    // town's shadows obey
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = Math.cos(a) * 25.5, by = Math.sin(a) * 25.5;
      E(ctx, bx, by, 2.8, 2.8, '#2c2114');
      E(ctx, bx, by, 2, 2, '#7c5a26');
      E(ctx, bx - 0.3, by - 0.5, 1.2, 1.2, col.bright);
      E(ctx, bx - 0.4, by - 0.7, 0.55, 0.55, '#fff4d8');
    }
    // dark plinth top the figure stands on (contrast ground for baseTop)
    E(ctx, 0, 0, 14.5, 14.5, '#403926');
    ring(ctx, 0, 0, 14.5, 'rgba(20,16,10,0.6)', 1);
    // whole-pedestal modelling: warm key light NW, cool falloff SE
    const sg = ctx.createLinearGradient(-22, -22, 24, 24);
    sg.addColorStop(0, 'rgba(255,238,200,0.20)');
    sg.addColorStop(0.5, 'rgba(0,0,0,0)');
    sg.addColorStop(1, 'rgba(10,8,20,0.36)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(0, 0, 29, 0, Math.PI * 2); ctx.fill();
  },

  baseTop(ctx, col) {
    // THE MAIN EMPIRE STATUE, upper layer: the colossus figure. Drawn by the
    // renderer AFTER all units so heroes and mobs pass behind the tall marble,
    // never across it. Same 64-unit frame and scale as `base`.
    ctx.save();
    ctx.rotate(-Math.PI / 2);            // face "up" so the raised spear reads
    E(ctx, 1.4, 1.8, 11, 9, 'rgba(0,0,0,0.5)');                   // figure's shadow on the plinth
    // flowing marble cloak sweeping behind
    P(ctx, [[-13, -7], [-4, -4], [-4, 4], [-14, 8], [-9, 0]], col.dark);
    P(ctx, [[-11, -5], [-5, -3], [-5, 3], [-11, 5.5]], col.main);
    // powerful torso and shoulders
    E(ctx, 0, 0, 9.5, 7.5, '#d8d0bc');
    E(ctx, -1, -6, 4.4, 3, '#cfc7b2'); E(ctx, -1, 6, 4.4, 3, '#cfc7b2');
    ctx.strokeStyle = 'rgba(60,52,36,0.55)'; ctx.lineWidth = 1;   // carved musculature
    ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(2, 0); ctx.lineTo(-4, 3); ctx.stroke();
    // marble modelling on the figure itself
    E(ctx, 2.5, 3, 6.5, 4.5, 'rgba(18,14,26,0.22)');
    E(ctx, -2.5, -3, 5, 3.5, 'rgba(255,244,216,0.30)');
    // empire sash
    ctx.strokeStyle = col.main; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(4.5, 5); ctx.stroke();
    // shield arm with the empire's blazon
    E(ctx, 1.5, 10, 5.6, 5.6, '#b8b09a');
    ring(ctx, 1.5, 10, 5.4, col.main, 1.6);
    E(ctx, 1.5, 10, 2.2, 2.2, col.bright);
    E(ctx, 0.2, 8.8, 1.8, 1.4, 'rgba(255,244,216,0.4)');          // shield glint
    // spear arm raised high — long gilded shaft, unmistakable
    ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(1, -7); ctx.lineTo(17, -12.5); ctx.stroke();
    ctx.strokeStyle = 'rgba(90,74,40,0.6)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(1, -6.4); ctx.lineTo(16, -11.8); ctx.stroke();
    P(ctx, [[16, -15], [21.5, -13.5], [16.8, -10.5]], '#e8c66a');
    P(ctx, [[16.6, -13.9], [19.6, -13.2], [17, -11.7]], '#fff2c0');
    // laureled head, proud and lifted
    E(ctx, 6.5, 0, 4.4, 4.4, '#e2dac6');
    E(ctx, 5.4, -1.2, 1.6, 1.6, '#f4eeda');                       // brow highlight
    ring(ctx, 6.5, 0, 4.5, '#c9b037', 1.3);
    ctx.restore();
    // divine glow halo over the marble
    const g = ctx.createRadialGradient(0, -2, 2, 0, 0, 20);
    g.addColorStop(0, 'rgba(255,240,200,0.18)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
  },
  wall(ctx, col) {
    // Living Wall segment: stacked enchanted masonry (facing axis = across the rampart)
    E(ctx, 0, 1.5, 15, 11, 'rgba(0,0,0,0.35)');
    P(ctx, [[-7, -14], [7, -14], [8, 14], [-8, 14]], '#8a8478', '#514c3d', 1.5);
    P(ctx, [[-6.4, -13.4], [6.4, -13.4], [6, -4.5], [-6, -4.5]], '#9c968a');
    P(ctx, [[-5.6, 6], [5.6, 6], [6.8, 13.4], [-6.8, 13.4]], '#7c7668');
    // mortar seams
    ctx.strokeStyle = '#5f594a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-6, -4.5); ctx.lineTo(6, -4.5); ctx.moveTo(-6, 6); ctx.lineTo(6, 6); ctx.moveTo(0, -13); ctx.lineTo(0, -4.5); ctx.moveTo(-3, -4.5); ctx.lineTo(-3, 6); ctx.moveTo(3, 6); ctx.lineTo(3, 13); ctx.stroke();
    // the smith's rune, still warm
    ring(ctx, 0, 0.6, 4, col.bright, 1.4);
    E(ctx, 0, 0.6, 1.6, 1.6, col.bright);
  },
  trap(ctx, col) {
    ring(ctx, 0, 0, 10, col.bright, 1.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P(ctx, [[Math.cos(a) * 6, Math.sin(a) * 6], [Math.cos(a) * 12, Math.sin(a) * 12], [Math.cos(a + 0.4) * 7, Math.sin(a + 0.4) * 7]], '#c8ccd8');
    }
    E(ctx, 0, 0, 3, 3, col.main);
  },
};

// ============================================================
// ICONS — ability / item / buff glyphs drawn into small canvases
// ============================================================
const iconCache = new Map<string, HTMLCanvasElement>();

export function getIcon(key: string, size = 48): HTMLCanvasElement {
  const ck = key + '|' + size;
  let c = iconCache.get(ck);
  if (c) return c;
  c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  ctx.save();
  // background plate
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#3a2f1a'); grad.addColorStop(1, '#1c160c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 48, size / 48);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const fn = ICON_ART[key.replace(/^buff/, '')] || ICON_ART._default;
  fn(ctx);
  ctx.restore();
  iconCache.set(ck, c);
  return c;
}

const gold = '#e8c66a', silver = '#d8dce8', red = '#d9705c', blue = '#6aa8d8', green = '#8fc07a', orange = '#ff9040', violet = '#b060e0';

const ICON_ART: Record<string, (ctx: Ctx) => void> = {
  _default(ctx) { E(ctx, 0, 0, 12, 12, gold); },
  sword(ctx) {
    ctx.strokeStyle = silver; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-10, 10); ctx.lineTo(10, -10); ctx.stroke();
    ctx.strokeStyle = gold; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-10, -2); ctx.moveTo(-7, -5); ctx.lineTo(-13, -11); ctx.stroke();
  },
  blade(ctx) {
    P(ctx, [[-12, 8], [10, -4], [14, -12], [2, -8], [-12, 4]], silver, gold, 1);
  },
  horn(ctx) {
    ctx.strokeStyle = gold; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(2, 2, 10, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
    P(ctx, [[10, -8], [17, -12], [14, -3]], gold);
  },
  skull(ctx) {
    E(ctx, 0, -2, 10, 9, '#e8e0d0');
    E(ctx, -4, -3, 2.5, 3, '#1a140a'); E(ctx, 4, -3, 2.5, 3, '#1a140a');
    P(ctx, [[-5, 7], [5, 7], [4, 12], [-4, 12]], '#e8e0d0');
    ctx.strokeStyle = '#1a140a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-2, 8); ctx.lineTo(-2, 11); ctx.moveTo(2, 8); ctx.lineTo(2, 11); ctx.stroke();
  },
  arrow(ctx) {
    ctx.strokeStyle = silver; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-12, 12); ctx.lineTo(8, -8); ctx.stroke();
    P(ctx, [[8, -8], [14, -14], [11, -5], [5, -11]], gold);
    P(ctx, [[-12, 12], [-8, 6], [-6, 10]], red);
  },
  boots(ctx) {
    P(ctx, [[-8, -10], [-2, -10], [-2, 2], [10, 2], [12, 10], [-8, 10]], gold, '#8a6a20', 1.5);
    P(ctx, [[-14, -2], [-8, -6], [-8, 2]], silver);
  },
  volley(ctx) {
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = silver; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10 + i * 8, -12); ctx.lineTo(-6 + i * 8, 10); ctx.stroke();
      P(ctx, [[-6 + i * 8, 10], [-8 + i * 8, 4], [-4 + i * 8, 5]], gold);
    }
  },
  trap(ctx) {
    ring(ctx, 0, 0, 10, silver, 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P(ctx, [[Math.cos(a) * 8, Math.sin(a) * 8], [Math.cos(a) * 14, Math.sin(a) * 14], [Math.cos(a + 0.5) * 9, Math.sin(a + 0.5) * 9]], silver);
    }
  },
  star(ctx) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      ctx.save(); ctx.rotate(a);
      P(ctx, [[0, -14], [3, 0], [0, 14], [-3, 0]], i % 2 ? gold : '#fff0c0');
      ctx.restore();
    }
  },
  wind(ctx) {
    ctx.strokeStyle = '#b8e8e0'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(-2, -8 + i * 8, 8, Math.PI * 0.2, Math.PI * 1.3); ctx.stroke();
    }
  },
  mist(ctx) {
    E(ctx, -4, -3, 8, 5, 'rgba(200,220,230,0.8)');
    E(ctx, 5, 2, 7, 4.5, 'rgba(170,200,215,0.8)');
    E(ctx, -3, 7, 6, 4, 'rgba(140,170,190,0.8)');
  },
  slash(ctx) {
    ctx.strokeStyle = '#b8e8e0'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(-4, 0, 13, -0.8, 0.8); ctx.stroke();
    ctx.strokeStyle = silver; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-8, 0, 15, -0.6, 0.6); ctx.stroke();
  },
  spiral(ctx) {
    ctx.strokeStyle = '#b8e8e0'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const r = 2 + a * 1.6;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  },
  tempest(ctx) {
    ring(ctx, 0, 0, 6, '#b8e8e0', 2.5);
    ring(ctx, 0, 0, 11, '#8ac8d8', 2);
    ring(ctx, 0, 0, 16, '#5aa8c8', 1.5);
  },
  drop(ctx) {
    P(ctx, [[0, -13], [8, 2], [5, 10], [-5, 10], [-8, 2]], blue, '#3a7ab0', 1.5);
    E(ctx, -2, 2, 2.5, 4, '#c8e8ff');
  },
  pool(ctx) {
    E(ctx, 0, 2, 14, 8, blue);
    E(ctx, 0, 0, 10, 5, '#8ac8f0');
    E(ctx, -3, -1, 4, 2, '#d8f0ff');
  },
  wave(ctx) {
    ctx.strokeStyle = blue; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(-6, 6, 10, Math.PI, Math.PI * 1.7); ctx.stroke();
    ctx.strokeStyle = '#8ac8f0'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(4, 8, 12, Math.PI, Math.PI * 1.6); ctx.stroke();
  },
  pull(ctx) {
    ring(ctx, 0, 0, 5, blue, 2.5);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      P(ctx, [[Math.cos(a) * 15, Math.sin(a) * 15], [Math.cos(a + 0.3) * 9, Math.sin(a + 0.3) * 9], [Math.cos(a - 0.2) * 10, Math.sin(a - 0.2) * 10]], '#8ac8f0');
    }
  },
  tsunami(ctx) {
    P(ctx, [[-14, 10], [-6, -10], [2, -2], [6, -12], [14, 10]], blue, '#3a7ab0', 1.5);
    E(ctx, -6, -10, 3, 3, '#d8f0ff');
    E(ctx, 6, -12, 3, 3, '#d8f0ff');
  },
  banner(ctx) {
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, 14); ctx.lineTo(-6, -14); ctx.stroke();
    P(ctx, [[-6, -14], [12, -10], [-6, -2]], red);
  },
  spears(ctx) {
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-10 + i * 8, 14); ctx.lineTo(-6 + i * 8, -8); ctx.stroke();
      P(ctx, [[-6 + i * 8, -8], [-9 + i * 8, -12], [-3 + i * 8, -14]], silver);
    }
  },
  charge(ctx) {
    P(ctx, [[-14, 0], [0, -6], [0, -2], [12, -2], [12, 2], [0, 2], [0, 6]], gold);
    ctx.strokeStyle = '#fff0c0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(14, -6); ctx.stroke();
  },
  helm(ctx) {
    E(ctx, 0, 2, 10, 9, gold);
    P(ctx, [[-2, -18], [4, -6], [-6, -6]], red);
    P(ctx, [[-3, 2], [3, 2], [2, 12], [-2, 12]], '#1a140a');
  },
  muster(ctx) {
    E(ctx, 0, -6, 5, 5, gold);
    E(ctx, -9, 5, 4, 4, silver); E(ctx, 9, 5, 4, 4, silver); E(ctx, 0, 8, 4, 4, silver);
    ctx.strokeStyle = gold; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(-9, 3); ctx.moveTo(0, -2); ctx.lineTo(9, 3); ctx.moveTo(0, -2); ctx.lineTo(0, 5); ctx.stroke();
  },
  bash(ctx) {
    E(ctx, -3, 0, 9, 11, silver);
    ring(ctx, -3, 0, 9, gold, 1.5);
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5;
      ctx.strokeStyle = gold; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8 + Math.cos(a) * 3, Math.sin(a) * 6); ctx.lineTo(8 + Math.cos(a) * 10, Math.sin(a) * 12); ctx.stroke();
    }
  },
  shield(ctx) {
    P(ctx, [[0, -13], [11, -8], [11, 2], [0, 13], [-11, 2], [-11, -8]], blue, silver, 2);
    E(ctx, 0, -2, 4, 4, silver);
  },
  taunt(ctx) {
    E(ctx, 0, -2, 9, 8, red);
    E(ctx, -3, -4, 2, 2.5, '#fff'); E(ctx, 3, -4, 2, 2.5, '#fff');
    P(ctx, [[-4, 3], [4, 3], [0, 7]], '#fff');
    ring(ctx, 0, 0, 14, red, 1.5);
  },
  quake(ctx) {
    P(ctx, [[-14, 8], [-4, 8], [-7, -2], [0, 6], [4, -8], [7, 8], [14, 8], [14, 12], [-14, 12]], '#a8927a');
    ctx.strokeStyle = orange; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(0, -10); ctx.moveTo(4, -2); ctx.lineTo(8, -8); ctx.stroke();
  },
  aegis(ctx) {
    P(ctx, [[0, -14], [12, -9], [12, 3], [0, 14], [-12, 3], [-12, -9]], gold, '#fff0c0', 2);
    ring(ctx, 0, -1, 5, '#fff0c0', 2);
  },
  heart(ctx) {
    P(ctx, [[0, 12], [-11, 0], [-11, -6], [-6, -10], [0, -5], [6, -10], [11, -6], [11, 0]], green, '#d8f0c8', 1.5);
  },
  thorn(ctx) {
    ctx.strokeStyle = green; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-12, 12); ctx.quadraticCurveTo(0, -4, 12, -12); ctx.stroke();
    for (let i = 0; i < 3; i++) P(ctx, [[-6 + i * 7, 4 - i * 6], [-2 + i * 7, 0 - i * 6], [-4 + i * 7, 6 - i * 6]], '#5a8a4a');
  },
  leaf(ctx) {
    P(ctx, [[0, -13], [9, -4], [7, 8], [0, 13], [-7, 8], [-9, -4]], green, '#5a8a4a', 1.5);
    ctx.strokeStyle = '#d8f0c8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke();
  },
  sprout(ctx) {
    ctx.strokeStyle = '#5a8a4a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 13); ctx.lineTo(0, -2); ctx.stroke();
    E(ctx, -6, -6, 6, 4, green, -0.6);
    E(ctx, 6, -6, 6, 4, green, 0.6);
  },
  bloom(ctx) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      E(ctx, Math.cos(a) * 8, Math.sin(a) * 8, 5.5, 3.5, green, a);
    }
    E(ctx, 0, 0, 4.5, 4.5, gold);
  },
  flame(ctx) {
    P(ctx, [[0, 13], [-9, 4], [-5, -4], [-1, 2], [1, -12], [6, -2], [9, 5]], orange, '#c85020', 1);
    P(ctx, [[0, 10], [-4, 4], [0, -4], [4, 5]], '#ffd040');
  },
  cinder(ctx) {
    E(ctx, -6, 6, 5, 5, orange);
    E(ctx, 6, -6, 5, 5, '#ffd040');
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = orange; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(4, -4); ctx.stroke();
    ctx.setLineDash([]);
  },
  ring(ctx) {
    ring(ctx, 0, 0, 11, orange, 4);
    ring(ctx, 0, 0, 6, '#ffd040', 2);
  },
  pyre(ctx) {
    P(ctx, [[0, 10], [-11, 2], [-6, -6], [-2, 0], [0, -13], [5, -3], [11, 3]], orange);
    P(ctx, [[-13, 12], [13, 12], [10, 8], [-10, 8]], '#6a4a30');
  },
  meteor(ctx) {
    E(ctx, 4, 4, 8, 8, orange);
    E(ctx, 4, 4, 5, 5, '#ffd040');
    ctx.strokeStyle = '#ffb060'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(-14, -14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(-6, -16); ctx.stroke();
  },
  slow(ctx) {
    E(ctx, 0, 0, 10, 10, '#5a7a9a');
    ctx.strokeStyle = '#c8e0f0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 0); ctx.lineTo(5, 3); ctx.stroke();
  },
  // ---- Eurydice ----
  echo(ctx) {
    ctx.setLineDash([4, 4]);
    ring(ctx, 0, 0, 12, violet, 2);
    ctx.setLineDash([]);
    P(ctx, [[-8, 0], [0, -5], [8, 0], [0, 5]], silver);
    E(ctx, 0, 0, 2.6, 2.6, violet);
  },
  veil(ctx) {
    E(ctx, -4, -4, 9, 5, 'rgba(140,156,200,0.85)');
    E(ctx, 5, 1, 8, 4.5, 'rgba(120,132,190,0.85)');
    E(ctx, -3, 6, 7, 4, 'rgba(100,110,170,0.85)');
    E(ctx, 3, -7, 2, 2, violet);
  },
  threads(ctx) {
    E(ctx, -9, -7, 4, 4, red); E(ctx, 9, 7, 4, 4, blue);
    ctx.strokeStyle = violet; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, -5);
    ctx.quadraticCurveTo(2, -6, 0, 0); ctx.quadraticCurveTo(-2, 6, 6, 5); ctx.stroke();
    E(ctx, 0, 0, 1.8, 1.8, '#e6c8ff');
  },
  destiny(ctx) {
    P(ctx, [[-8, -11], [8, -11], [2, 0], [8, 11], [-8, 11], [-2, 0]], 'rgba(200,220,240,0.5)', violet, 2);
    P(ctx, [[-4.5, -9], [4.5, -9], [0, -2]], '#e6c8ff');
    ctx.strokeStyle = gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 13, -0.6, 1.2); ctx.stroke();
    P(ctx, [[13.5, -9], [10, -3], [16, -4]], gold);
  },
  prophecy(ctx) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.strokeStyle = gold; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); ctx.stroke();
    }
    P(ctx, [[-9, 0], [0, -6], [9, 0], [0, 6]], '#f6efe2');
    E(ctx, 0, 0, 3, 3, violet);
    E(ctx, 0, 0, 1.3, 1.3, '#1a140a');
  },
  // ---- Brontes ----
  anvil(ctx) {
    P(ctx, [[-12, -4], [10, -4], [6, 1], [3, 1], [3, 7], [-6, 7], [-6, 1], [-9, 1]], '#7a7468', '#4c463c', 1.2);
    P(ctx, [[-12, 9], [8, 9], [8, 12], [-12, 12]], '#5a544a');
    ctx.strokeStyle = orange; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-2, -9); ctx.lineTo(2, -13); ctx.moveTo(0, -6); ctx.lineTo(3, -9); ctx.stroke();
  },
  wallstone(ctx) {
    P(ctx, [[-13, -3], [-1, -3], [-1, 4], [-13, 4]], '#8a8478', '#514c3d', 1.2);
    P(ctx, [[1, -3], [13, -3], [13, 4], [1, 4]], '#9c968a', '#514c3d', 1.2);
    P(ctx, [[-7, -11], [7, -11], [7, -5], [-7, -5]], '#948e80', '#514c3d', 1.2);
    P(ctx, [[-7, 6], [7, 6], [7, 12], [-7, 12]], '#7c7668', '#514c3d', 1.2);
    E(ctx, 0, 0.5, 1.8, 1.8, orange);
  },
  chainbolt(ctx) {
    ctx.strokeStyle = '#6a4a30'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-12, 12); ctx.lineTo(-2, 2); ctx.stroke();
    P(ctx, [[-5, -1], [3, -8], [7, -4], [-1, 3]], '#7a7468', '#4c463c', 1);
    P(ctx, [[4, -12], [0, -4], [4, -5], [-2, 3], [8, -4], [4, -3], [10, -9]], '#ffd040', orange, 1);
  },
  bellows(ctx) {
    P(ctx, [[-12, -8], [4, -3], [4, 3], [-12, 8]], '#8a5a30', '#5a3a1c', 1.5);
    P(ctx, [[-12, -5], [-2, -1.5], [-2, 1.5], [-12, 5]], '#a87848');
    P(ctx, [[4, -2], [12, -1], [12, 1], [4, 2]], '#7a7468');
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(200,220,240,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(14 + i * 0.5, -4 - i * 3, 2 + i, 0, Math.PI * 2); ctx.stroke();
    }
  },
  celestforge(ctx) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.strokeStyle = gold; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8 - 1, Math.sin(a) * 8 - 6); ctx.lineTo(Math.cos(a) * 13 - 1, Math.sin(a) * 13 - 6); ctx.stroke();
    }
    E(ctx, -1, -6, 3.5, 3.5, '#ffd060');
    P(ctx, [[-11, 2], [9, 2], [5, 6], [2, 6], [2, 10], [-5, 10], [-5, 6], [-8, 6]], '#7a7468', gold, 1.2);
  },
  // ---- Lykaon ----
  paw(ctx) {
    E(ctx, 0, 4, 6.5, 5.5, silver);
    E(ctx, -7.5, -3, 2.6, 3.2, silver); E(ctx, -2.5, -6, 2.6, 3.2, silver);
    E(ctx, 2.5, -6, 2.6, 3.2, silver); E(ctx, 7.5, -3, 2.6, 3.2, silver);
    E(ctx, 0, 4, 3.5, 2.8, '#8a4a3a');
  },
  pounce(ctx) {
    ctx.strokeStyle = silver; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-12, 8); ctx.quadraticCurveTo(0, -14, 10, 2); ctx.stroke();
    P(ctx, [[10, 2], [12, -5], [15, 6], [5, 6]], gold);
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = '#9a8a64'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-12, 11); ctx.lineTo(12, 11); ctx.stroke();
    ctx.setLineDash([]);
  },
  scent(ctx) {
    ctx.strokeStyle = red; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-12, -6 + i * 6);
      ctx.quadraticCurveTo(-4, -10 + i * 6, 2, -6 + i * 6);
      ctx.quadraticCurveTo(8, -2 + i * 6, 13, -6 + i * 6);
      ctx.stroke();
    }
    P(ctx, [[8, 6], [12, 13], [4, 13]], '#c84040');
  },
  moon(ctx) {
    E(ctx, 0, 0, 11, 11, '#e8f0ff');
    E(ctx, -3, -2, 2.2, 2.2, '#c8d4e8'); E(ctx, 4, 3, 1.6, 1.6, '#c8d4e8'); E(ctx, 2, -5, 1.2, 1.2, '#c8d4e8');
    ring(ctx, 0, 0, 13, 'rgba(200,220,255,0.7)', 1.5);
  },
  apex(ctx) {
    P(ctx, [[-12, -8], [-4, -2], [0, -10], [4, -2], [12, -8], [9, 4], [-9, 4]], '#8a8a96', '#5a5a64', 1.2);
    P(ctx, [[-6, 4], [-4, 12], [-2, 4]], '#fff');
    P(ctx, [[2, 4], [4, 12], [6, 4]], '#fff');
    E(ctx, -5, -1, 1.6, 1.4, '#ffd040'); E(ctx, 5, -1, 1.6, 1.4, '#ffd040');
  },
  // ---- Harmonia ----
  dove(ctx) {
    E(ctx, -1, 2, 7, 5, '#f8f4ec');
    P(ctx, [[-2, -1], [8, -10], [4, 2]], '#f0ece0');
    E(ctx, 7, 0, 2.6, 2.4, '#f8f4ec');
    P(ctx, [[9.5, 0], [12.5, 0.8], [9.5, 1.6]], gold);
    P(ctx, [[-7, 4], [-14, 8], [-7, 7]], '#e8e2d4');
    ctx.strokeStyle = green; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(9, 4); ctx.quadraticCurveTo(13, 6, 15, 10); ctx.stroke();
    E(ctx, 13, 7, 1.6, 0.9, green, 0.5);
  },
  rallybanner(ctx) {
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(-4, -14); ctx.stroke();
    P(ctx, [[-4, -14], [13, -10], [-4, -1]], violet);
    E(ctx, 2, -8.5, 2, 2, gold);
    ctx.strokeStyle = gold; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(-4, 8, 5, Math.PI * 0.7, Math.PI * 2.3); ctx.stroke();
  },
  linkhearts(ctx) {
    P(ctx, [[-6, 3], [-12, -3], [-12, -7], [-9, -9.5], [-6, -6.5], [-3, -9.5], [0, -7], [0, -3]], red, '#f0c8c0', 1);
    P(ctx, [[6, 12], [0, 6], [0, 2], [3, -0.5], [6, 2.5], [9, -0.5], [12, 2], [12, 6]], violet, '#e6c8ff', 1);
    ctx.strokeStyle = gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-1, 0, 3.4, -0.6, 2.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(1, 3, 3.4, 2.6, 5.6); ctx.stroke();
  },
  accord(ctx) {
    ctx.strokeStyle = gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(0, 9); ctx.moveTo(-10, -7); ctx.lineTo(10, -7); ctx.stroke();
    P(ctx, [[-4, 9], [4, 9], [6, 12], [-6, 12]], gold);
    ctx.strokeStyle = silver; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-10, -7); ctx.lineTo(-13, 0); ctx.lineTo(-7, 0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -7); ctx.lineTo(7, 0); ctx.lineTo(13, 0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-10, 1, 3, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(10, 1, 3, 0, Math.PI); ctx.stroke();
  },
  decree(ctx) {
    P(ctx, [[-9, -12], [9, -12], [9, 8], [-9, 8]], '#e8dcc0', '#a89468', 1.2);
    E(ctx, -9, -12, 2, 2.8, '#c8b890'); E(ctx, -9, 8, 2, 2.8, '#c8b890');
    E(ctx, 9, -12, 2, 2.8, '#d8cca8'); E(ctx, 9, 8, 2, 2.8, '#d8cca8');
    ctx.strokeStyle = '#8a7a55'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-6, -8 + i * 3.5); ctx.lineTo(6, -8 + i * 3.5); ctx.stroke(); }
    E(ctx, 4, 10, 3.2, 3.2, red);
    E(ctx, 4, 10, 1.4, 1.4, '#8a2a20');
  },
  // ---- item icons ----
  itArmor(ctx) {
    P(ctx, [[0, -12], [10, -8], [12, 4], [0, 12], [-12, 4], [-10, -8]], '#b0722a', gold, 2);
    ctx.strokeStyle = gold; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(6, -4); ctx.moveTo(-7, 1); ctx.lineTo(7, 1); ctx.stroke();
  },
  itBoots(ctx) {
    P(ctx, [[-6, -12], [0, -12], [0, 2], [10, 2], [12, 10], [-6, 10]], '#b0722a', gold, 1.5);
    P(ctx, [[-14, -4], [-6, -9], [-6, 0]], silver);
    P(ctx, [[2, -4], [10, -9], [10, 0]], silver);
  },
  itRam(ctx) {
    E(ctx, 0, 2, 9, 8, '#a8927a');
    ctx.strokeStyle = gold; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(-8, -4, 6, -0.5, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, -4, 6, 0, Math.PI + 0.5); ctx.stroke();
    E(ctx, -3, 0, 1.5, 2, '#1a140a'); E(ctx, 3, 0, 1.5, 2, '#1a140a');
  },
  itHorn(ctx) {
    ctx.strokeStyle = gold; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 2, 10, Math.PI * 0.85, Math.PI * 1.95); ctx.stroke();
    P(ctx, [[9, -7], [17, -11], [13, -2]], '#fff0c0');
    E(ctx, -10, 6, 2.5, 2.5, '#8a6a20');
  },
  itOwl(ctx) {
    E(ctx, 0, 0, 10, 12, '#8a7a5a');
    E(ctx, -4, -4, 3.5, 3.5, '#ffd040'); E(ctx, 4, -4, 3.5, 3.5, '#ffd040');
    E(ctx, -4, -4, 1.5, 1.5, '#1a140a'); E(ctx, 4, -4, 1.5, 1.5, '#1a140a');
    P(ctx, [[-2, 0], [2, 0], [0, 4]], gold);
    P(ctx, [[-9, -9], [-4, -12], [-5, -7]], '#8a7a5a');
    P(ctx, [[9, -9], [4, -12], [5, -7]], '#8a7a5a');
  },
  itBolt(ctx) {
    P(ctx, [[2, -14], [-6, 2], [-1, 2], [-4, 14], [8, -2], [2, -2]], '#ffd040', orange, 1);
  },
  itSpear(ctx) {
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-12, 12); ctx.lineTo(6, -6); ctx.stroke();
    P(ctx, [[6, -6], [10, -14], [14, -10], [6, -2]], silver, gold, 1);
  },
  itMarble(ctx) {
    P(ctx, [[0, 12], [-11, 0], [-11, -6], [-6, -10], [0, -5], [6, -10], [11, -6], [11, 0]], '#d8dce8', '#a8acb8', 1.5);
    ctx.strokeStyle = '#a8acb8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(2, 2); ctx.lineTo(-2, 6); ctx.stroke();
  },
  itFang(ctx) {
    P(ctx, [[-8, -10], [-2, 10], [2, -2], [8, 12], [10, -10], [2, -6]], '#e8e0d0', '#a89a80', 1);
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -10, 8, Math.PI, Math.PI * 2); ctx.stroke();
  },
  itCloak(ctx) {
    P(ctx, [[0, -12], [10, -6], [7, 12], [0, 8], [-7, 12], [-10, -6]], '#37444d', '#5a6a7a', 1.5);
    E(ctx, 0, -9, 2.5, 2.5, gold);
  },
  itFlask(ctx) {
    P(ctx, [[-3, -13], [3, -13], [3, -7], [9, 2], [9, 9], [-9, 9], [-9, 2], [-3, -7]], 'rgba(200,220,240,0.6)', silver, 1.5);
    P(ctx, [[-7, 3], [7, 3], [7, 8], [-7, 8]], red);
    E(ctx, 0, -13, 4, 2, gold);
  },
  itHourglass(ctx) {
    P(ctx, [[-9, -12], [9, -12], [2, 0], [9, 12], [-9, 12], [-2, 0]], 'rgba(200,220,240,0.5)', gold, 2);
    P(ctx, [[-5, -10], [5, -10], [0, -2]], '#e8c66a');
    P(ctx, [[-4, 10], [4, 10], [0, 6]], '#e8c66a');
  },
  itGreaves(ctx) {
    P(ctx, [[-8, -12], [-1, -12], [1, 6], [8, 8], [8, 12], [-6, 12], [-8, 0]], '#b0722a', gold, 1.5);
    ctx.strokeStyle = gold; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-2, -6); ctx.moveTo(-6, 0); ctx.lineTo(-1, 0); ctx.stroke();
  },
  itLaurel(ctx) {
    ctx.strokeStyle = green; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 2, 10, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * 0.85 + i * 0.35;
      E(ctx, Math.cos(a) * 10, 2 + Math.sin(a) * 10, 4, 2, green, a + Math.PI / 2);
      E(ctx, -Math.cos(a) * 10, 2 + Math.sin(a) * 10, 4, 2, green, -a - Math.PI / 2);
    }
  },
  itVial(ctx) {
    P(ctx, [[-4, -12], [4, -12], [4, -6], [7, 8], [0, 13], [-7, 8], [-4, -6]], 'rgba(255,150,60,0.75)', orange, 1.5);
    E(ctx, 0, 4, 4, 5, '#ffd040');
    E(ctx, 0, -12, 4.5, 2, '#8a6a40');
  },
  // ---- buff icons ----
  Eye(ctx) {
    P(ctx, [[-12, 0], [0, -8], [12, 0], [0, 8]], silver);
    E(ctx, 0, 0, 4, 4, blue);
    E(ctx, 0, 0, 2, 2, '#1a140a');
  },
  Fist(ctx) {
    E(ctx, 0, 0, 9, 10, '#d9a066');
    ctx.strokeStyle = '#8a6030'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-5 + i * 5, -8); ctx.lineTo(-5 + i * 5, -3); ctx.stroke(); }
  },
  Speed(ctx) {
    for (let i = 0; i < 3; i++) {
      P(ctx, [[-12 + i * 7, -8], [-4 + i * 7, 0], [-12 + i * 7, 8], [-8 + i * 7, 0]], gold);
    }
  },
  Banner(ctx) { ICON_ART.banner(ctx); },
  Shield(ctx) { ICON_ART.shield(ctx); },
  Heart(ctx) { ICON_ART.heart(ctx); },
  Leaf(ctx) { ICON_ART.leaf(ctx); },
  Mist(ctx) { ICON_ART.mist(ctx); },
  Flame(ctx) { ICON_ART.flame(ctx); },
  Ram(ctx) { ICON_ART.itRam(ctx); },
  Veil(ctx) { ICON_ART.veil(ctx); },
  Threads(ctx) { ICON_ART.threads(ctx); },
  Destiny(ctx) { ICON_ART.destiny(ctx); },
  Anvil(ctx) { ICON_ART.anvil(ctx); },
  Paw(ctx) { ICON_ART.paw(ctx); },
  Moon(ctx) { ICON_ART.moon(ctx); },
  Dove(ctx) { ICON_ART.dove(ctx); },
  Link(ctx) { ICON_ART.linkhearts(ctx); },
};

/** Map an entity type to its art key. */
export function artKeyFor(kind: string, type: string): string {
  if (kind === 'hero') return type;
  if (kind === 'mob') return type === 'hunter' ? 'hunterMob' : type;
  if (kind === 'summon') return type === 'wall' ? 'wall' : 'summon';
  if (kind === 'tower') return 'tower';
  if (kind === 'base') return 'base';
  if (kind === 'trap') return 'trap';
  if (kind === 'guardian') return 'guardian';
  if (kind === 'hunterBeast') return 'hunterBeast';
  if (kind === 'boss') return type;
  return type;   // neutral types match art keys
}
