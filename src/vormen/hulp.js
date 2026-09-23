/**
 * Gedeelde hulp voor de Vormmachines: paletten, toeval met een zaadje, ruis,
 * tekenen. Uit Clay's `vormmachines.html`, zonder DOM en zonder Math.random.
 * Elk systeembestand (systemen.js en de uitbreidingen) importeert hieruit.
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

// ---- tekenhulp -------------------------------------------------------------

/** Een pixelrooster van n×n, om met ImageData te vullen en dan opgeschaald te tekenen. */
export function rooster(g, n) {
  const c = g.maakCanvas(n, n), x = c.getContext('2d'), img = x.createImageData(n, n);
  return { n, c, x, img, px: new Uint32Array(img.data.buffer) };
}
export function blit(gr, g, pix) {
  gr.x.putImageData(gr.img, 0, 0);
  g.ctx.imageSmoothingEnabled = !pix;
  g.ctx.drawImage(gr.c, 0, 0, g.S, g.S);
}
export function clear(g) { g.ctx.fillStyle = ACHTERGROND; g.ctx.fillRect(0, 0, g.S, g.S); }
export function fade(g, a) { g.ctx.fillStyle = `rgba(7,9,12,${a})`; g.ctx.fillRect(0, 0, g.S, g.S); }

// Knoppen zoals in het origineel. re = verandering vraagt een nieuwe init
// (niet op een draaiknop), fix = niet willekeurig maken, sel = keuzelijst.
export const K = (k, l, min, max, step, v, o = {}) => ({ k, l, min, max, step, v, ...o });
export const SEL = (k, l, opts, v, o = {}) => ({ k, l, opts, v, sel: 1, ...o });

