/**
 * Gedeelde hulp voor de Vormmachines: paletten, toeval met een zaadje, ruis,
 * tekenen. Uit Clay's `vormmachines.html`, zonder DOM en zonder Math.random.
 * Elk systeembestand (systemen.js en de uitbreidingen) importeert hieruit.
 *
 * ---- HET DOEK IS 16:9 (ROADMAP 7) -------------------------------------------
 *
 * Een systeem tekent op g.W × g.H pixels (640 × 360 in de app, laag.js), niet
 * meer op een vierkant. Wat een systeem op `g` vindt, naast ctx, t, r, pal, L,
 * kwaliteit en maakCanvas:
 *
 *   g.W, g.H   breedte en hoogte van het doek in pixels.
 *   g.D        maat voor lijndikte en kleine afstanden: KORTE zijde / 320
 *              (1,125 op 640 × 360). Een lijn van 1,2 * g.D is ten opzichte
 *              van de vorm even dik als op het oude vierkant (daar S / 320).
 *              In "320-eenheden" is het doek g.W / g.D breed en g.H / g.D
 *              hoog (568,9 × 320).
 *   g.S        VEROUDERD, = g.H. Bestaat alleen zolang niet alle systemen om
 *              zijn: een systeem dat nog S × S tekent komt links op het doek
 *              als vierkant. Nieuwe code gebruikt g.S nooit.
 *
 *   maten(W, H) -> { W, H, D, S }
 *       Die vier voor een doek van W × H. laag.js bouwt g hiermee; een test
 *       die zelf een g maakt doet hetzelfde:
 *         const g = { ...maten(640, 360), ctx, t: 0, pal, L, r: maakRng(7), maakCanvas };
 *
 *   clear(g), fade(g, a)
 *       Het HELE doek (W × H) naar de achtergrond, of er met alpha a naartoe.
 *
 *   cellen(g, n, veelvoud = 1) -> { nx, ny, cel }
 *       Een rooster met VIERKANTE cellen over het hele doek, met evenveel
 *       cellen als het oude n × n: dezelfde rekentijd, dus het tijdsbudget
 *       (budget.js) en de metingen per systeem blijven kloppen.
 *       cellen(g, 128) -> { nx: 171, ny: 96, cel: 3,75 } op 640 × 360.
 *       nx en ny zijn veelvouden van `veelvoud` (2 voor een halve maat die
 *       precies past: 2×2-blokken omlaag en omhoog). `cel` = pixels per cel
 *       (g.H / ny). Index: y * nx + x; ruimtelijk rondlopen per as apart
 *       ((x + nx) % nx, (y + ny) % ny). Een andere n = fijner of grover;
 *       n is de maat van het oude vierkant, niet een zijde van het nieuwe.
 *
 *   rooster(g, { nx, ny }) -> { nx, ny, c, x, img, px }
 *       Een pixelrooster van nx × ny om met ImageData te vullen (px is een
 *       Uint32Array van nx * ny, ABGR zoals g.L). Meestal rechtstreeks:
 *         s.g = rooster(g, cellen(g, 128));    // s.g.nx, s.g.ny, s.g.cel
 *       VEROUDERD: rooster(g, n) met één GETAL geeft het oude n × n-vierkant,
 *       en blit legt dat links neer (S × S). Alleen voor niet-omgezette
 *       systemen; een bewust vierkant rooster is rooster(g, { nx: n, ny: n }).
 *
 *   blit(gr, g, pix, vak)
 *       Het rooster op het doek zetten, over het HELE doek (pix = scherpe
 *       blokken, anders zacht). Met `vak` ({ x, y, b, h }) ergens anders,
 *       bijv. een vierkant rooster in het midden: blit(gr, g, pix, midden(g).vak).
 *
 *   midden(g) -> { cx, cy, kort, vak }
 *       Voor een systeem dat om een middelpunt draait (cirkels, attractors,
 *       rozetten): het midden van het doek en de korte zijde. Wat vroeger
 *       S / 2 + x * S * 0.42 was, wordt cx + x * kort * 0.42 (en y met cy).
 *       Straal en schaal altijd op `kort`, zodat de vorm heel in beeld blijft;
 *       de breedte eromheen is ruimte, niet iets om uit te rekken.
 *       `vak` = het vierkant van kort × kort in het midden ({ x, y, b, h }).
 */

export const PI = Math.PI, TAU = PI * 2;
export const ACHTERGROND = '#07090c';

// ---- kleuren ---------------------------------------------------------------

export const PALETTEN = {
  fosfor: ['#07090c', '#132259', '#2d56d4', '#6cc4ea', '#eef4f0'],
  gloed: ['#07090c', '#3b0f2e', '#a8352a', '#eea13c', '#fff3cf'],
  mos: ['#07090c', '#0c2a26', '#1f7a5c', '#9fd67a', '#f4f7dc'],
  iris: ['#07090c', '#2a1250', '#7a3fc4', '#e27bd0', '#fbe8f3'],
  duo: ['#6cc4ea', '#2d56d4', '#07090c', '#a8352a', '#eea13c'],
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function meng(pal, t) {
  t = Math.max(0, Math.min(1, t));
  const st = pal.map(hex), f = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(f)), u = f - i;
  return st[i].map((v, j) => Math.round(v + (st[i + 1][j] - v) * u));
}
/** Per palet: 256 pixels als Uint32 (ABGR, zoals ImageData ze leest) en 64 css-kleuren. */
export const LUTS = {};
const CSS = {};
for (const k in PALETTEN) {
  const a = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { const [r, g, b] = meng(PALETTEN[k], i / 255); a[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }
  LUTS[k] = a;
  CSS[k] = Array.from({ length: 64 }, (_, i) => { const [r, g, b] = meng(PALETTEN[k], i / 63); return `rgb(${r},${g},${b})`; });
}
export const pcol = (pal, t) => CSS[pal][Math.max(0, Math.min(63, Math.round(t * 63)))];

// ---- toeval met een zaadje -------------------------------------------------

/** mulberry32: klein, snel, en genoeg voor beeld. Geeft 0 ≤ x < 1. */
export function maakRng(zaad = 1) {
  let a = zaad >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());

// ---- ruis (Perlin), met een vaste schudding --------------------------------

const PERM = (() => {
  const r = maakRng(1337), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  return new Uint8Array([...p, ...p]);
})();
const fd = (t) => t * t * t * (t * (t * 6 - 15) + 10), lp = (t, a, b) => a + t * (b - a);
function grad(h, x, y) { const g = h & 7, u = g < 4 ? x : y, v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); }
export function noise(x, y) {
  const fx = Math.floor(x), fy = Math.floor(y), X = fx & 255, Y = fy & 255;
  x -= fx; y -= fy;
  const u = fd(x), v = fd(y), A = PERM[X] + Y, B = PERM[X + 1] + Y;
  return lp(v, lp(u, grad(PERM[A], x, y), grad(PERM[B], x - 1, y)), lp(u, grad(PERM[A + 1], x, y - 1), grad(PERM[B + 1], x - 1, y - 1))) * 0.5;
}

// ---- het doek: maten en tekenhulp (zie de API bovenaan) --------------------

/** g.W, g.H, g.D (korte zijde / 320) en de verouderde g.S (= g.H) voor een doek van W × H. */
export function maten(W, H) {
  return { W, H, D: Math.min(W, H) / 320, S: H };
}

/**
 * Een rooster met vierkante cellen over het hele doek, met evenveel cellen
 * als n × n. Eerst ny (op de wortel van de verhouding), dan nx zo dat de
 * cellen vierkant zijn; op 640 × 360 wijken ze hooguit een half procent af
 * (blit rekt het rooster precies over het doek, dat zie je niet).
 */
export function cellen(g, n, veelvoud = 1) {
  const v = Math.max(1, Math.round(veelvoud));
  const rond = (x) => Math.max(v, Math.round(x / v) * v);
  const ny = rond(n * Math.sqrt(g.H / g.W));
  const nx = rond(ny * g.W / g.H);
  return { nx, ny, cel: g.H / ny };
}

/**
 * Een pixelrooster om met ImageData te vullen en dan opgeschaald te tekenen.
 * maat = { nx, ny } (uit cellen()), of VEROUDERD een getal n voor n × n.
 */
export function rooster(g, maat) {
  const oud = typeof maat === 'number';
  const nx = oud ? maat : maat.nx, ny = oud ? maat : maat.ny;
  const c = g.maakCanvas(nx, ny), x = c.getContext('2d'), img = x.createImageData(nx, ny);
  const gr = { nx, ny, c, x, img, px: new Uint32Array(img.data.buffer) };
  if (oud) Object.assign(gr, { n: maat, oud: true });
  else if (maat.cel !== undefined) gr.cel = maat.cel;
  return gr;
}
export function blit(gr, g, pix, vak) {
  gr.x.putImageData(gr.img, 0, 0);
  g.ctx.imageSmoothingEnabled = !pix;
  if (vak) g.ctx.drawImage(gr.c, vak.x, vak.y, vak.b, vak.h);
  else if (gr.oud) g.ctx.drawImage(gr.c, 0, 0, g.S, g.S);     // verouderd: het oude vierkant, links
  else g.ctx.drawImage(gr.c, 0, 0, g.W, g.H);
}
export function clear(g) { g.ctx.fillStyle = ACHTERGROND; g.ctx.fillRect(0, 0, g.W, g.H); }
export function fade(g, a) { g.ctx.fillStyle = `rgba(7,9,12,${a})`; g.ctx.fillRect(0, 0, g.W, g.H); }

/** Midden en korte zijde, voor systemen die om een middelpunt draaien. */
export function midden(g) {
  const kort = Math.min(g.W, g.H), cx = g.W / 2, cy = g.H / 2;
  return { cx, cy, kort, vak: { x: cx - kort / 2, y: cy - kort / 2, b: kort, h: kort } };
}

// Knoppen zoals in het origineel. re = verandering vraagt een nieuwe init
// (niet op een draaiknop), fix = niet willekeurig maken, sel = keuzelijst.
export const K = (k, l, min, max, step, v, o = {}) => ({ k, l, min, max, step, v, ...o });
export const SEL = (k, l, opts, v, o = {}) => ({ k, l, opts, v, sel: 1, ...o });

