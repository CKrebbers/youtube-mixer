/**
 * De Vormmachines: kleine wetenschappelijke systemen die bewegende vormen
 * maken. Overgenomen uit Clay's `vormmachines.html` (artifact "Vormmachines",
 * 23 september 2026); de rekenregels zijn dezelfde, drie dingen zijn anders:
 *
 *   1. Geen DOM. Een systeem tekent op `g.ctx` (een 2D-context) en maakt
 *      pixelroosters via `g.maakCanvas`. Zo kan het straks in een Worker op
 *      een OffscreenCanvas draaien, en in de tests op een nep-context.
 *   2. Geen Math.random. Toeval komt uit `g.r()`, een generator met een
 *      zaadje. Zelfde zaadje = zelfde beeld: nodig voor replay en tests.
 *   3. Geen eigen klok. `g.t` (seconden) komt van buiten, van de audioklok
 *      (regel 3). Eén `step()` is één stap van 1/60 s; laag.js roept hem
 *      zo vaak aan als de tijd vraagt.
 *
 * Kleine opruimingen: allocaties per frame zijn naar `init` verhuisd (ec, sf,
 * km), fl tekent zonder Path2D, km zonder tekstje.
 *
 * Stap 1 (docs/plugins/01-plan.md): alleen de LICHTE systemen, gemeten onder
 * 0,5 ms per stap in Node (bench: tools/bench/vm-bench.cjs), plus drie
 * middelzware (fl, hg, dp). De zware (cl, ln, gs, sp, wv, if) komen met de
 * Worker in stap 3.
 *
 * Deze module kent geen Varve: AV-kern kan hem ongewijzigd kopiëren.
 */

const PI = Math.PI, TAU = PI * 2;
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
const pcol = (pal, t) => CSS[pal][Math.max(0, Math.min(63, Math.round(t * 63)))];

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
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());

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
function rooster(g, n) {
  const c = g.maakCanvas(n, n), x = c.getContext('2d'), img = x.createImageData(n, n);
  return { n, c, x, img, px: new Uint32Array(img.data.buffer) };
}
function blit(gr, g, pix) {
  gr.x.putImageData(gr.img, 0, 0);
  g.ctx.imageSmoothingEnabled = !pix;
  g.ctx.drawImage(gr.c, 0, 0, g.S, g.S);
}
function clear(g) { g.ctx.fillStyle = ACHTERGROND; g.ctx.fillRect(0, 0, g.S, g.S); }
function fade(g, a) { g.ctx.fillStyle = `rgba(7,9,12,${a})`; g.ctx.fillRect(0, 0, g.S, g.S); }

// Knoppen zoals in het origineel. re = verandering vraagt een nieuwe init
// (niet op een draaiknop), fix = niet willekeurig maken, sel = keuzelijst.
const K = (k, l, min, max, step, v, o = {}) => ({ k, l, min, max, step, v, ...o });
const SEL = (k, l, opts, v, o = {}) => ({ k, l, opts, v, sel: 1, ...o });

// ---- de systemen -----------------------------------------------------------

export const SYSTEMEN = [

  { id: 'lz', naam: 'Lorenz-attractor', sub: 'het vlindereffect', cat: 'Chaos', pal: 'gloed',
    knobs: [K('s', 'σ (sigma)', 1, 20, 0.1, 10), K('r', 'ρ (rho)', 1, 120, 0.5, 28), K('b', 'β (beta)', 0.5, 5, 0.01, 2.667),
      K('n', 'aantal banen', 1, 40, 1, 14, { re: 1, fix: 1 }), K('rot', 'draaisnelheid', 0, 1, 0.01, 0.3, { fix: 1 })],
    init(s, p, g) { s.P = []; for (let i = 0; i < p.n; i++) s.P.push({ x: 1 + i * 0.02, y: 1, z: 20, sx: null, sy: null }); clear(g); },
    step(s, p, g) {
      const ctx = g.ctx, S = g.S; fade(g, 0.045);
      const th = g.t * p.rot * 0.35, co = Math.cos(th), si = Math.sin(th), sc = S * 0.8 / (1.6 * Math.max(p.r, 4) + 12), zc = Math.max(p.r - 1, 0) * 0.95;
      ctx.lineWidth = 1.2 * g.D; ctx.lineCap = 'round';
      const n = s.P.length;
      s.P.forEach((q, i) => {
        ctx.beginPath(); let first = true;
        for (let k = 0; k < 5; k++) {
          const dt = 0.005, dx = p.s * (q.y - q.x), dy = q.x * (p.r - q.z) - q.y, dz = q.x * q.y - p.b * q.z;
          q.x += dx * dt; q.y += dy * dt; q.z += dz * dt;
          if (!isFinite(q.x) || Math.abs(q.x) > 1e4) { q.x = 1 + i * 0.02; q.y = 1; q.z = 20; q.sx = null; }
          const X = q.x * co - q.y * si, sx = S / 2 + X * sc, sy = S / 2 - (q.z - zc) * sc;
          if (first) { ctx.moveTo(q.sx ?? sx, q.sy ?? sy); first = false; }
          ctx.lineTo(sx, sy); q.sx = sx; q.sy = sy;
        }
        ctx.strokeStyle = pcol(g.pal, 0.35 + 0.65 * i / Math.max(1, n - 1)); ctx.stroke();
      });
    } },

  { id: 'hg', naam: 'Harmonograaf', sub: 'gekoppelde slingers · Lissajous', cat: 'Golven', pal: 'fosfor',
    knobs: [K('a', 'frequentie x', 1, 9, 1, 3), K('b', 'frequentie y', 1, 9, 1, 2), K('e', 'ontstemming', 0, 0.03, 0.0005, 0.004),
      K('d', 'demping', 0.001, 0.02, 0.0005, 0.004), K('ph', 'fasedrift', 0, 1, 0.01, 0.3, { fix: 1 })],
    init() {},
    step(s, p, g) {
      clear(g);
      const ctx = g.ctx, S = g.S, T = Math.min(260, 5 / p.d), n = 6000, dt = T / n, ph = g.t * p.ph * 0.6, R = S * 0.42, bands = 6;
      ctx.lineWidth = 0.9 * g.D; ctx.globalAlpha = 0.85;
      for (let bnd = 0; bnd < bands; bnd++) {
        ctx.beginPath();
        const i0 = bnd * n / bands | 0, i1 = (bnd + 1) * n / bands | 0;
        for (let i = i0; i <= i1; i++) {
          const t = i * dt, e = Math.exp(-p.d * t),
            x = e * (0.6 * Math.sin(p.a * t + ph) + 0.4 * Math.sin(p.b * t)),
            y = e * (0.6 * Math.sin((p.b + p.e) * t) + 0.4 * Math.sin(p.a * t + ph * 0.5 + 1));
          const X = S / 2 + x * R, Y = S / 2 + y * R;
          if (i === i0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = pcol(g.pal, 0.95 - bnd * 0.11); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } },

  { id: 'bd', naam: 'Boids', sub: 'zwermgedrag · Reynolds', cat: 'Zwermen', pal: 'fosfor',
    knobs: [K('sep', 'scheiding', 0, 3, 0.05, 1.4), K('ali', 'uitlijning', 0, 3, 0.05, 1), K('coh', 'cohesie', 0, 3, 0.05, 1), K('vis', 'zichtafstand', 10, 90, 1, 38)],
    init(s, p, g) {
      const n = 170; s.n = n; s.x = new Float32Array(n); s.y = new Float32Array(n); s.vx = new Float32Array(n); s.vy = new Float32Array(n);
      for (let i = 0; i < n; i++) { s.x[i] = g.r() * 320; s.y[i] = g.r() * 320; const a = g.r() * TAU; s.vx[i] = Math.cos(a) * 1.5; s.vy[i] = Math.sin(a) * 1.5; }
      clear(g);
    },
    step(s, p, g) {
      const n = s.n, v2 = p.vis * p.vis, sd = (p.vis * 0.45) ** 2, ctx = g.ctx, D = g.D; fade(g, 0.28);
      for (let i = 0; i < n; i++) {
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, c = 0;
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], d2 = dx * dx + dy * dy;
          if (d2 < v2) { cx += s.x[j]; cy += s.y[j]; ax += s.vx[j]; ay += s.vy[j]; c++; if (d2 < sd && d2 > 0) { sx -= dx / d2; sy -= dy / d2; } }
        }
        let vx = s.vx[i], vy = s.vy[i];
        if (c) { vx += ((ax / c) - vx) * 0.05 * p.ali + ((cx / c) - s.x[i]) * 0.0012 * p.coh; vy += ((ay / c) - vy) * 0.05 * p.ali + ((cy / c) - s.y[i]) * 0.0012 * p.coh; }
        vx += sx * p.sep * 0.9; vy += sy * p.sep * 0.9;
        const sp = Math.hypot(vx, vy) || 1, cl = Math.max(1, Math.min(2.6, sp));
        s.vx[i] = vx / sp * cl; s.vy[i] = vy / sp * cl;
      }
      ctx.lineWidth = 1.6 * D; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        s.x[i] = (s.x[i] + s.vx[i] + 320) % 320; s.y[i] = (s.y[i] + s.vy[i] + 320) % 320;
        ctx.strokeStyle = pcol(g.pal, 0.45 + 0.55 * (i / n)); ctx.beginPath();
        ctx.moveTo(s.x[i] * D, s.y[i] * D); ctx.lineTo((s.x[i] - s.vx[i] * 2.5) * D, (s.y[i] - s.vy[i] * 2.5) * D); ctx.stroke();
      }
    } },

  { id: 'fl', naam: 'Stromingsveld', sub: 'curl noise · deeltjesstroming', cat: 'Zwermen', pal: 'fosfor',
    knobs: [K('sc', 'schaal', 0.002, 0.03, 0.0005, 0.008), K('sp', 'snelheid', 0.3, 4, 0.05, 1.4), K('ev', 'evolutie', 0, 1, 0.01, 0.3), K('tr', 'spoor', 0.01, 0.3, 0.005, 0.05, { fix: 1 })],
    init(s, p, g) {
      const n = 2200; s.n = n;
      s.x = new Float32Array(n).map(() => g.r() * 320); s.y = new Float32Array(n).map(() => g.r() * 320);
      s.l = new Float32Array(n).map(() => g.r() * 200); s.ox = new Float32Array(n); s.oy = new Float32Array(n);
      clear(g);
    },
    step(s, p, g) {
      fade(g, p.tr);
      const ctx = g.ctx, D = g.D, sc = p.sc, tz = g.t * p.ev * 0.25, e = 1;
      const F = (x, y) => noise(x * sc + tz, y * sc) + 0.5 * noise(x * sc * 2.1 - tz * 0.7, y * sc * 2.1 + 11);
      for (let i = 0; i < s.n; i++) {
        const x = s.x[i], y = s.y[i], vx = F(x, y + e) - F(x, y - e), vy = -(F(x + e, y) - F(x - e, y)), m = Math.hypot(vx, vy) || 1;
        s.ox[i] = x; s.oy[i] = y; s.x[i] = x + vx / m * p.sp; s.y[i] = y + vy / m * p.sp;
      }
      // Vier kleuren, elk één pad: in het origineel vier Path2D's.
      ctx.lineWidth = D;
      for (let c = 0; c < 4; c++) {
        ctx.beginPath();
        for (let i = c; i < s.n; i += 4) { ctx.moveTo(s.ox[i] * D, s.oy[i] * D); ctx.lineTo(s.x[i] * D, s.y[i] * D); }
        ctx.strokeStyle = pcol(g.pal, 0.45 + c * 0.18); ctx.stroke();
      }
      for (let i = 0; i < s.n; i++) {
        const nx = s.x[i], ny = s.y[i];
        if (--s.l[i] < 0 || nx < 0 || nx > 320 || ny < 0 || ny > 320) { s.x[i] = g.r() * 320; s.y[i] = g.r() * 320; s.l[i] = 80 + g.r() * 200; }
      }
    } },

  { id: 'sf', naam: 'Superformule', sub: 'Gielis · één formule, alle vormen', cat: 'Wiskunde', pal: 'iris',
    knobs: [K('m', 'm (symmetrie)', 0, 20, 0.5, 6), K('n1', 'n1', 0.1, 12, 0.05, 1), K('n2', 'n2', 0.1, 12, 0.05, 1.7), K('n3', 'n3', 0.1, 12, 0.05, 1.7),
      K('L', 'lagen', 1, 28, 1, 14, { fix: 1 }), K('br', 'ademen', 0, 1, 0.01, 0.5, { fix: 1 })],
    init(s) { s.rr = new Float32Array(541); },
    r(m, n1, n2, n3, ph) { const a = Math.abs(Math.cos(m * ph / 4)) ** n2, b = Math.abs(Math.sin(m * ph / 4)) ** n3, r = (a + b) ** (-1 / n1); return isFinite(r) ? r : 0; },
    step(s, p, g) {
      clear(g);
      const ctx = g.ctx, S = g.S, t = g.t, L = p.L | 0, pts = 540, rr = s.rr; ctx.lineWidth = 1.1 * g.D;
      for (let l = 0; l < L; l++) {
        const f = L > 1 ? l / (L - 1) : 0, n1 = p.n1 * (1 + p.br * 0.55 * Math.sin(t * 0.8 + l * 0.38)), rot = t * 0.12 * p.br * (l % 2 ? 1 : -1);
        let mx = 0;
        for (let i = 0; i <= pts; i++) { rr[i] = this.r(p.m, n1, p.n2, p.n3, i / pts * TAU); if (rr[i] > mx) mx = rr[i]; }
        const sc = S * 0.44 * (1 - f * 0.85) / (mx || 1);
        ctx.beginPath();
        for (let i = 0; i <= pts; i++) {
          const ph = i / pts * TAU + rot, X = S / 2 + Math.cos(ph) * rr[i] * sc, Y = S / 2 + Math.sin(ph) * rr[i] * sc;
          if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        }
        ctx.strokeStyle = pcol(g.pal, 0.3 + 0.7 * f); ctx.stroke();
      }
    } },

  { id: 'ec', naam: 'Elementaire automaat', sub: 'Wolfram · 256 regels', cat: 'Automaten', pal: 'fosfor',
    knobs: [K('rule', 'regel', 0, 255, 1, 30, { re: 1 }), SEL('start', 'begin', ['Eén cel', 'Willekeurig'], 0, { re: 1 }), K('sp', 'rijen per frame', 1, 6, 1, 2, { fix: 1 })],
    init(s, p, g) {
      const W = 160; s.W = W; s.g = rooster(g, W); s.g.px.fill(g.L[0]);
      s.row = new Uint8Array(W); s.nieuw = new Uint8Array(W);
      if (p.start == 0) s.row[W >> 1] = 1; else for (let i = 0; i < W; i++) s.row[i] = g.r() < 0.5 ? 1 : 0;
    },
    step(s, p, g) {
      const W = s.W, px = s.g.px, on = g.L[215], off = g.L[0], rule = p.rule | 0;
      for (let k = 0; k < p.sp; k++) {
        const r = s.row, n = s.nieuw;
        for (let i = 0; i < W; i++) { const idx = (r[(i - 1 + W) % W] << 2) | (r[i] << 1) | r[(i + 1) % W]; n[i] = (rule >> idx) & 1; }
        s.row = n; s.nieuw = r;
        px.copyWithin(0, W, W * W);
        for (let i = 0; i < W; i++) px[(W - 1) * W + i] = n[i] ? on : off;
      }
      blit(s.g, g, true);
    } },

  { id: 'cc', naam: 'Cyclische automaat', sub: 'Griffeath · BZ-spiralen', cat: 'Patronen', pal: 'iris',
    knobs: [K('n', 'toestanden', 3, 20, 1, 14, { re: 1 }), K('T', 'drempel', 1, 5, 1, 1), SEL('nb', 'buurt', ['Moore (8)', 'Von Neumann (4)'], 1), K('sp', 'stappen per frame', 1, 4, 1, 2, { fix: 1 })],
    init(s, p, g) { const N = 128; s.N = N; s.a = new Uint8Array(N * N); s.b = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) s.a[i] = g.r() * p.n | 0; s.g = rooster(g, N); },
    step(s, p, g) {
      const N = s.N, n = p.n | 0, T = p.T | 0, moore = p.nb == 0;
      for (let k = 0; k < p.sp; k++) {
        const a = s.a, b = s.b;
        for (let y = 0; y < N; y++) {
          const ym = ((y - 1 + N) % N) * N, yc = y * N, yp = ((y + 1) % N) * N;
          for (let x = 0; x < N; x++) {
            const xm = (x - 1 + N) % N, xp = (x + 1) % N, c = a[yc + x], nx = (c + 1) % n;
            let cnt = (a[ym + x] === nx) + (a[yp + x] === nx) + (a[yc + xm] === nx) + (a[yc + xp] === nx);
            if (moore) cnt += (a[ym + xm] === nx) + (a[ym + xp] === nx) + (a[yp + xm] === nx) + (a[yp + xp] === nx);
            b[yc + x] = cnt >= T ? nx : c;
          }
        }
        s.a = b; s.b = a;
      }
      const px = s.g.px, L = g.L, a = s.a;
      for (let i = 0; i < a.length; i++) px[i] = L[20 + (a[i] / n * 235) | 0];
      blit(s.g, g, true);
    } },

  { id: 'km', naam: 'Kuramoto-oscillatoren', sub: 'spontane synchronisatie', cat: 'Zwermen', pal: 'gloed',
    knobs: [K('K', 'koppeling', 0, 4, 0.01, 1.1), K('sg', 'tempo-spreiding', 0, 2, 0.01, 0.6), K('n', 'oscillatoren', 8, 240, 1, 90, { re: 1, fix: 1 })],
    init(s, p, g) {
      const n = p.n | 0; s.n = n;
      s.z = Float32Array.from({ length: n }, () => gauss(g.r)).sort();
      s.th = new Float32Array(n).map(() => g.r() * TAU);
      clear(g);
    },
    step(s, p, g) {
      const n = s.n, ctx = g.ctx, S = g.S, D = g.D;
      let cs = 0, sn = 0;
      for (let i = 0; i < n; i++) { cs += Math.cos(s.th[i]); sn += Math.sin(s.th[i]); }
      cs /= n; sn /= n;
      const R = Math.hypot(cs, sn), psi = Math.atan2(sn, cs);
      for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) s.th[i] += 0.02 * (1 + p.sg * s.z[i] + p.K * R * Math.sin(psi - s.th[i]));
      s.o.sync = R;   // een uitgang: hoe gelijk ze lopen (0..1)
      fade(g, 0.16);
      const plek = (i) => { const r = S * (0.07 + 0.38 * i / (n - 1)); return [S / 2 + Math.cos(s.th[i]) * r, S / 2 + Math.sin(s.th[i]) * r]; };
      ctx.lineWidth = 0.8 * D; ctx.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = plek(i); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = 'rgba(238,161,60,.35)'; ctx.stroke();
      for (let i = 0; i < n; i++) { const [x, y] = plek(i); ctx.fillStyle = pcol(g.pal, 0.4 + 0.6 * i / n); ctx.beginPath(); ctx.arc(x, y, 2 * D, 0, TAU); ctx.fill(); }
    } },

  { id: 'dp', naam: 'Dubbele slinger', sub: 'deterministische chaos', cat: 'Chaos', pal: 'iris',
    knobs: [K('n', 'aantal slingers', 1, 60, 1, 30, { re: 1, fix: 1 }), K('e', 'verschil (10^x)', -9, -1, 1, -4, { re: 1 }),
      K('a0', 'beginhoek °', 20, 179, 1, 130, { re: 1 }), K('gv', 'zwaartekracht', 1, 25, 0.1, 9.8)],
    init(s, p, g) {
      const n = p.n | 0, eps = 10 ** p.e, a = p.a0 * PI / 180;
      s.P = Array.from({ length: n }, (_, i) => ({ a1: a + i * eps, a2: a + i * eps, w1: 0, w2: 0, tx: null, ty: null }));
      clear(g);
    },
    step(s, p, g) {
      const ctx = g.ctx, S = g.S, D = g.D, l = S * 0.22, gv = p.gv, n = s.P.length; fade(g, 0.2); ctx.lineCap = 'round';
      s.P.forEach((q, i) => {
        for (let k = 0; k < 10; k++) {
          const dt = 0.0025, d = q.a1 - q.a2, den = 3 - Math.cos(2 * d);
          const al1 = (-gv * 3 * Math.sin(q.a1) - gv * Math.sin(q.a1 - 2 * q.a2) - 2 * Math.sin(d) * (q.w2 * q.w2 + q.w1 * q.w1 * Math.cos(d))) / den;
          const al2 = (2 * Math.sin(d) * (q.w1 * q.w1 * 2 + gv * 2 * Math.cos(q.a1) + q.w2 * q.w2 * Math.cos(d))) / den;
          q.w1 += al1 * dt; q.w2 += al2 * dt; q.a1 += q.w1 * dt; q.a2 += q.w2 * dt;
        }
        const x1 = S / 2 + Math.sin(q.a1) * l, y1 = S * 0.42 + Math.cos(q.a1) * l, x2 = x1 + Math.sin(q.a2) * l, y2 = y1 + Math.cos(q.a2) * l;
        ctx.strokeStyle = pcol(g.pal, 0.35 + 0.65 * i / Math.max(1, n - 1));
        ctx.globalAlpha = 0.35; ctx.lineWidth = D; ctx.beginPath(); ctx.moveTo(S / 2, S * 0.42); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
        if (q.tx !== null) { ctx.lineWidth = 1.6 * D; ctx.beginPath(); ctx.moveTo(q.tx, q.ty); ctx.lineTo(x2, y2); ctx.stroke(); }
        q.tx = x2; q.ty = y2;
      });
    } },

  { id: 'fy', naam: 'Fyllotaxis', sub: 'de gulden hoek · zonnebloempit', cat: 'Groei', pal: 'gloed',
    knobs: [K('ang', 'hoek °', 90, 180, 0.001, 137.508), K('n', 'zaden', 100, 3000, 10, 1400, { fix: 1 }), K('dr', 'drift', 0, 1, 0.01, 0.25, { fix: 1 }), K('sz', 'zaadgrootte', 0.3, 2, 0.01, 1, { fix: 1 })],
    init() {},
    step(s, p, g) {
      clear(g);
      const ctx = g.ctx, S = g.S, n = p.n | 0, a = (p.ang + Math.sin(g.t * 0.25) * p.dr * 0.9) * PI / 180, c = S * 0.46 / Math.sqrt(n);
      for (let i = 1; i < n; i++) {
        const r = c * Math.sqrt(i), th = i * a;
        ctx.fillStyle = pcol(g.pal, 0.3 + 0.7 * (i / n)); ctx.beginPath();
        ctx.arc(S / 2 + Math.cos(th) * r, S / 2 + Math.sin(th) * r, Math.max(0.6, c * 0.42 * p.sz * (0.4 + 0.6 * Math.sqrt(i / n))), 0, TAU); ctx.fill();
      }
    } },
];

export const SYSTEEM = Object.fromEntries(SYSTEMEN.map((s) => [s.id, s]));

/**
 * De knoppen die op een draaiknop mogen: geen keuzelijst (sel) en geen knop
 * die een nieuwe init vraagt (re). Hooguit `max`, in de volgorde van het
 * systeem — daar staan de knoppen die het verschil maken vooraan.
 */
export function draaiKnoppen(sys, max = 6) {
  return sys.knobs.filter((k) => !k.sel && !k.re).slice(0, max);
}
