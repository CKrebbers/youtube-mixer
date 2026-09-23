/**
 * De ZWARE Vormmachines: gs (Reactie-diffusie), ln (Lenia), ph (Physarum),
 * cl (Vreemde attractor), sp (Zandhoop). Overgenomen uit Clay's
 * `vormmachines.html` met dezelfde drie aanpassingen als `systemen.js`
 * (geen DOM, toeval uit `g.r()`, tijd uit `g.t`), plus twee voor het budget:
 *
 *   - `g.kwaliteit` (0,25..1, ontbreekt = 1). Een scheduler zet hem lager als
 *     een laag over zijn tijd gaat. Het beeld mag GROVER worden, de beweging
 *     niet trager. Per systeem:
 *       gs, ln  onder 0,75 rekenen ze op een rooster van de halve maat, met de
 *               diffusie (gs) of de kernelstraal (ln) meegeschaald: zelfde
 *               vormen op het scherm, zelfde tempo, een kwart (gs) of een
 *               zestiende (ln) van het werk. Wisselen neemt de toestand mee.
 *               Gemeten (gs, zelfde zaad): koraal, labyrint en stippen groeien
 *               even hard; "wormen" (F 0,078) groeit op de halve maat ~2/3 zo
 *               snel en "mitose" kan anders uitvallen — dat zijn randgevallen
 *               waar de vlekjes kleiner zijn dan twee cellen van het grove rooster.
 *       ph      minder agents; elk laat navenant meer spoor achter.
 *       cl      minder iteraties per stap: korreliger, even snel. De kleurronde
 *               over 320×320 schaalt niet mee (op 0,25 nog ~2/3 van de tijd).
 *       sp      minder omvalstappen per stap (zie hieronder).
 *   - Zandhoop had een onbegrensde lus (`while (st.length)`): een lawine liep
 *     in één stap uit, tot 82 ms. Nu hooguit `SP_MAX_OMVAL × kwaliteit`
 *     omvallers per stap; wat overblijft gaat de volgende stap verder (de
 *     stapel is abels: de volgorde verandert de eindvorm niet). Korrels komen
 *     er elke stap bij zoals altijd; loopt het omvallen achter, dan groeit de
 *     mandala tijdelijk trager.
 *
 * Sneller zonder iets aan het beeld te veranderen: cl rekent sin/cos uit een
 * tabel en doet vervagen, maximum en kleuren in één ronde (10,6 -> ~3,5 ms);
 * ph snuift zonder closure per stap.
 *
 * Uitgangen (`s.o.*`, 0..1) en gebeurtenissen (`s.e.*`) zoals in de OUTS van
 * het origineel, berekend aan het eind van elke stap.
 *
 * `pointer(s, p, x, y, g)` (x, y in 0..1) zaait nog steeds, zonder DOM.
 * Deze module kent geen Varve: AV-kern kan hem ongewijzigd kopiëren.
 */

import { PI, TAU, rooster, blit, K, SEL } from './hulp.js';

/** Kwaliteit uit g, geklemd op 0,25..1; ontbreekt hij, dan 1. */
export function kwaliteit(g) {
  const q = g.kwaliteit;
  return typeof q === 'number' && q > 0 ? Math.max(0.25, Math.min(1, q)) : 1;
}
/** Vanaf welke kwaliteit gs en ln op het halve rooster rekenen. */
export const HALF_ONDER = 0.75;
/** Zandhoop: hoeveel cellen er hooguit omvallen per stap, op kwaliteit 1. */
export const SP_MAX_OMVAL = 150000;

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : (v || 0));
/** Uit het origineel: normaliseren op het (langzaam zakkende) maximum. */
function auto(s, k, v) { const m = s._m || (s._m = {}); const mx = Math.max(v, (m[k] || 1e-9) * 0.997); m[k] = mx; return mx > 0 ? cl01(v / mx) : 0; }

// ---- halve maat en terug (gs en ln) ----------------------------------------

/** Gemiddelde van elk 2×2-blok: n×n -> n/2×n/2. */
function omlaag(van, n, naar) {
  const h = n >> 1;
  for (let y = 0; y < h; y++) {
    const a = 2 * y * n, b = a + n;
    for (let x = 0; x < h; x++) naar[y * h + x] = 0.25 * (van[a + 2 * x] + van[a + 2 * x + 1] + van[b + 2 * x] + van[b + 2 * x + 1]);
  }
}
/** Bilineair, rondlopend: h×h -> 2h×2h. */
function omhoog(van, h, naar) {
  const n = h * 2;
  for (let y = 0; y < n; y++) {
    const fy = (y - 0.5) / 2, y0 = Math.floor(fy), v = fy - y0, ya = ((y0 % h) + h) % h, yb = (ya + 1) % h;
    for (let x = 0; x < n; x++) {
      const fx = (x - 0.5) / 2, x0 = Math.floor(fx), u = fx - x0, xa = ((x0 % h) + h) % h, xb = (xa + 1) % h;
      naar[y * n + x] = (van[ya * h + xa] * (1 - u) + van[ya * h + xb] * u) * (1 - v) + (van[yb * h + xa] * (1 - u) + van[yb * h + xb] * u) * v;
    }
  }
}

// ---- sinus uit een tabel (cl) ---------------------------------------------

// De attractor doet 70 000 iteraties met vier keer sin/cos per stap; dat was
// het grootste deel van zijn tijd. Een tabel van 8192 punten met lineaire
// interpolatie wijkt hooguit 8e-8 af: op 320 pixels onzichtbaar, en de baan
// is chaotisch, dus wat je ziet (de dichtheid) is dezelfde.
const SIN_N = 8192, SIN_K = SIN_N / TAU, SIN = new Float64Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin(i / SIN_K);
export function sinT(v) {
  const f = v * SIN_K, i = Math.floor(f), j = i & (SIN_N - 1), a = SIN[j];
  return a + (SIN[j + 1] - a) * (f - i);
}
const cosT = (v) => sinT(v + PI / 2);

// ---- Physarum: één geur opsnuiven zonder closure per stap -------------------

function snuif(T, N, x, y) {
  return T[(((Math.floor(y) % N) + N) % N) * N + (((Math.floor(x) % N) + N) % N)];
}

// ---- de systemen -----------------------------------------------------------

export const SYSTEMEN_ZWAAR = [

  { id: 'gs', naam: 'Reactie-diffusie', sub: 'Gray-Scott · Turing-patronen', cat: 'Patronen', pal: 'fosfor',
    knobs: [K('F', 'feed', 0.01, 0.09, 0.0005, 0.0545, { rnd: [0.02, 0.07] }), K('K', 'kill', 0.045, 0.07, 0.0005, 0.062, { rnd: [0.052, 0.066] }),
      K('sp', 'stappen per frame', 1, 24, 1, 12, { fix: 1 })],
    init(s, p, g) {
      const maak = (n) => ({ n, u: new Float32Array(n * n).fill(1), v: new Float32Array(n * n), u2: new Float32Array(n * n), v2: new Float32Array(n * n), g: rooster(g, n) });
      s.vol = maak(128); s.half = maak(64); s.cur = s.vol;
      for (let i = 0; i < 12; i++) this.seed(s, g.r(), g.r(), 4 + g.r() * 4, g);
    },
    /** Zaaien op het rooster dat nu rekent; r in cellen van het volle rooster. */
    seed(s, fx, fy, r, g) {
      const c = s.cur, n = c.n, sc = n / 128, rr = r * sc, cx = fx * n | 0, cy = fy * n | 0;
      for (let y = -rr; y <= rr; y++) {
        for (let x = -rr; x <= rr; x++) {
          if (x * x + y * y > rr * rr) continue;
          const i = ((((cy + y) | 0) % n + n) % n) * n + ((((cx + x) | 0) % n + n) % n);
          c.u[i] = 0.5 + g.r() * 0.1; c.v[i] = 0.25 + g.r() * 0.1;
        }
      }
    },
    pointer(s, p, x, y, g) { this.seed(s, x, y, 3, g); },
    /** Naar het volle of het halve rooster, met de toestand mee. */
    kies(s, half) {
      const naar = half ? s.half : s.vol, van = s.cur;
      if (naar === van) return;
      const f = half ? omlaag : omhoog;          // allebei in de maat van waar je vandaan komt
      f(van.u, van.n, naar.u); f(van.v, van.n, naar.v);
      s.cur = naar;
    },
    step(s, p, g) {
      this.kies(s, kwaliteit(g) < HALF_ONDER);
      const c = s.cur, n = c.n, F = p.F, Kk = p.K, FK = F + Kk;
      // Op het halve rooster is een cel twee keer zo breed: de Laplace-term
      // wordt een kwart, dan hebben de vlekken dezelfde maat op het scherm.
      const ds = n === 128 ? 1 : 0.25;
      for (let it = 0; it < p.sp; it++) {
        const u = c.u, v = c.v, u2 = c.u2, v2 = c.v2;
        for (let y = 0; y < n; y++) {
          const yc = y * n, ym = ((y - 1 + n) % n) * n, yp = ((y + 1) % n) * n;
          for (let x = 0; x < n; x++) {
            const xm = (x - 1 + n) % n, xp = (x + 1) % n, i = yc + x, U = u[i], V = v[i];
            const lu = 0.2 * (u[yc + xm] + u[yc + xp] + u[ym + x] + u[yp + x]) + 0.05 * (u[ym + xm] + u[ym + xp] + u[yp + xm] + u[yp + xp]) - U;
            const lv = 0.2 * (v[yc + xm] + v[yc + xp] + v[ym + x] + v[yp + x]) + 0.05 * (v[ym + xm] + v[ym + xp] + v[yp + xm] + v[yp + xp]) - V;
            const uvv = U * V * V;
            u2[i] = U + (ds * lu - uvv + F * (1 - U)); v2[i] = V + (0.5 * ds * lv + uvv - FK * V);
          }
        }
        c.u = u2; c.u2 = u; c.v = v2; c.v2 = v;
      }
      const px = c.g.px, L = g.L, v = c.v;
      for (let i = 0; i < v.length; i++) { const k = (v[i] * 765) | 0; px[i] = L[k < 0 ? 0 : k > 255 ? 255 : k]; }
      blit(c.g, g);
      // uitgangen
      let sv = 0;
      for (let i = 0; i < v.length; i += 3) sv += v[i];
      sv *= 3;
      s.o.dekking = cl01(sv / v.length * 4);
      const svn = sv * (16384 / v.length);      // op de schaal van het volle rooster
      s.o.activiteit = auto(s, 'a', Math.abs(svn - (s.psv ?? svn))); s.psv = svn;
    } },

  { id: 'cl', naam: 'Vreemde attractor', sub: 'Clifford · De Jong', cat: 'Chaos', pal: 'iris',
    knobs: [SEL('mode', 'formule', ['Clifford', 'De Jong'], 0), K('a', 'a', -3, 3, 0.01, -1.4, { rnd: [-2.6, 2.6] }), K('b', 'b', -3, 3, 0.01, 1.6, { rnd: [-2.6, 2.6] }),
      K('c', 'c', -3, 3, 0.01, 1, { rnd: [-1.6, 1.6] }), K('d', 'd', -3, 3, 0.01, 0.7, { rnd: [-1.6, 1.6] }), K('drift', 'drift', 0, 1, 0.01, 0.35, { fix: 1 })],
    ITER: 70000,
    init(s, p, g) { s.N = 320; s.g = rooster(g, 320); s.h = new Float32Array(320 * 320); s.x = 0.1; s.y = 0.1; s.drempel = new Float64Array(256); s.m = 1; },
    step(s, p, g) {
      const N = s.N, h = s.h, t = g.t, dr = p.drift;
      const a = p.a + Math.sin(t * 0.37) * dr * 0.5, b = p.b + Math.sin(t * 0.29 + 1.3) * dr * 0.5, c = p.c + Math.sin(t * 0.23 + 2.1) * dr * 0.4, d = p.d + Math.sin(t * 0.31 + 0.7) * dr * 0.4;
      const cliff = p.mode == 0, R = cliff ? 1 + Math.max(Math.abs(c), Math.abs(d)) : 2.05, sc = N * 0.47 / R, o = N / 2;
      const n = Math.round(this.ITER * kwaliteit(g));
      // Het origineel vervaagt eerst (× 0,88 bij drift), telt dan, en zoekt
      // daarna het maximum: drie rondes over 102 400 cellen. Hier vervaagt de
      // kleurronde van de VORIGE stap al (h staat dus al vervaagd klaar), en
      // het maximum wordt bijgehouden tijdens het tellen. Zelfde getallen.
      const vervaag = dr > 0 ? 0.88 : 1;
      let m = Math.max(1, s.m);
      let x = s.x, y = s.y;
      // Twee lussen in plaats van de keuze per iteratie: zelfde reeks, minder werk.
      if (cliff) {
        for (let k = 0; k < n; k++) {
          const nx = sinT(a * y) + c * cosT(a * x), ny = sinT(b * x) + d * cosT(b * y);
          x = nx; y = ny;
          const X = (o + x * sc) | 0, Y = (o + y * sc) | 0;
          if (X >= 0 && X < N && Y >= 0 && Y < N) { const j = Y * N + X, v = h[j] + 1; h[j] = v; if (v > m) m = v; }
        }
      } else {
        for (let k = 0; k < n; k++) {
          const nx = sinT(a * y) - cosT(b * x), ny = sinT(c * x) - cosT(d * y);
          x = nx; y = ny;
          const X = (o + x * sc) | 0, Y = (o + y * sc) | 0;
          if (X >= 0 && X < N && Y >= 0 && Y < N) { const j = Y * N + X, v = h[j] + 1; h[j] = v; if (v > m) m = v; }
        }
      }
      if (!isFinite(x)) { x = 0.1; y = 0.1; }
      s.x = x; s.y = y; s.m = m * vervaag;
      // Kleur = L[⌊(log(1+h)/log(1+m))^0,7 · 255⌋], zoals het origineel. Die
      // functie stijgt, dus in plaats van log en pow per pixel: per stap de
      // 255 drempels uitrekenen en per pixel binair zoeken (8 vergelijkingen).
      const lm = Math.log(1 + m), dr8 = s.drempel, px = s.g.px, L = g.L, L0 = L[0];
      for (let k = 1; k < 256; k++) dr8[k] = Math.exp(Math.pow(k / 255, 1 / 0.7) * lm) - 1;
      let cnt = 0;                               // voor de uitgang "vulling": elke vierde cel boven 0,5
      for (let i = 0; i < h.length; i++) {
        const v = h[i];
        if (!v) { px[i] = L0; continue; }
        let lo = 0;
        if (v >= dr8[lo + 128]) lo += 128; if (v >= dr8[lo + 64]) lo += 64; if (v >= dr8[lo + 32]) lo += 32; if (v >= dr8[lo + 16]) lo += 16;
        if (v >= dr8[lo + 8]) lo += 8; if (v >= dr8[lo + 4]) lo += 4; if (v >= dr8[lo + 2]) lo += 2; if (v >= dr8[lo + 1]) lo += 1;
        px[i] = L[lo];
        if ((i & 3) === 0 && v > 0.5) cnt++;
        if (vervaag !== 1) h[i] = v * vervaag;
      }
      blit(s.g, g);
      // uitgangen
      const Ro = cliff ? 1 + Math.max(Math.abs(p.c), Math.abs(p.d)) : 2.05;
      s.o.x = cl01(0.5 + s.x / (2 * Ro)); s.o.y = cl01(0.5 + s.y / (2 * Ro));
      s.o.vulling = auto(s, 'v', cnt);
    } },

  { id: 'ln', naam: 'Lenia', sub: 'continu kunstmatig leven', cat: 'Automaten', pal: 'mos',
    knobs: [K('mu', 'μ (groeicentrum)', 0.08, 0.3, 0.001, 0.15, { rnd: [0.11, 0.2] }), K('sg', 'σ (groeibreedte)', 0.005, 0.04, 0.0005, 0.017, { rnd: [0.013, 0.03] }),
      K('R', 'kernelstraal', 6, 14, 1, 10, { re: 1, fix: 1 }), K('dt', 'tijdstap', 0.03, 0.25, 0.01, 0.1, { fix: 1 })],
    init(s, p, g) {
      const maak = (N, R) => {
        const P = N + 2 * R, off = [], w = [];
        let sum = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const r = Math.hypot(dx, dy) / R;
            if (r > 0 && r < 1) { const k = Math.exp(4 - 1 / (r * (1 - r))); if (k > 1e-4) { off.push(dy * P + dx); w.push(k); sum += k; } }
          }
        }
        return { N, R, P, A: new Float32Array(N * N), pad: new Float32Array(P * P), off: Int32Array.from(off), w: Float32Array.from(w.map((v) => v / sum)), g: rooster(g, N) };
      };
      const R = p.R | 0;
      s.vol = maak(88, R); s.half = maak(44, Math.max(3, Math.round(R / 2))); s.cur = s.vol;
      s.dead = 0;
      for (let b = 0; b < 5; b++) this.seed(s, g.r(), g.r(), g);
    },
    seed(s, fx, fy, g) {
      const c = s.cur, N = c.N, A = c.A, rr = c.R * (1 + g.r()), cx = fx * N | 0, cy = fy * N | 0;
      for (let dy = -rr | 0; dy <= rr; dy++) {
        for (let dx = -rr | 0; dx <= rr; dx++) {
          if (dx * dx + dy * dy > rr * rr) continue;
          A[((cy + dy + N) % N) * N + ((cx + dx + N) % N)] = g.r();
        }
      }
    },
    // Het origineel remde met performance.now; hier met de audioklok.
    pointer(s, p, x, y, g) { if (s.pl == null || Math.abs(g.t - s.pl) > 0.12) { this.seed(s, x, y, g); s.pl = g.t; } },
    kies(s, half) {
      const naar = half ? s.half : s.vol, van = s.cur;
      if (naar === van) return;
      if (half) omlaag(van.A, van.N, naar.A); else omhoog(van.A, van.N, naar.A);
      s.cur = naar;
    },
    step(s, p, g) {
      this.kies(s, kwaliteit(g) < HALF_ONDER);
      const c = s.cur, { N, R, P, A, pad, off, w } = c, nk = off.length, mu = p.mu, is2 = 1 / (2 * p.sg * p.sg), dt = p.dt;
      for (let y = 0; y < P; y++) {
        const sy = ((y - R) % N + N) % N;
        for (let x = 0; x < P; x++) pad[y * P + x] = A[sy * N + ((x - R) % N + N) % N];
      }
      let mass = 0;
      const px = c.g.px, L = g.L;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const base = (y + R) * P + x + R;
          let u = 0;
          for (let k = 0; k < nk; k++) u += pad[base + off[k]] * w[k];
          const G = 2 * Math.exp(-(u - mu) * (u - mu) * is2) - 1, i = y * N + x;
          let a = A[i] + dt * G;
          a = a < 0 ? 0 : a > 1 ? 1 : a;
          A[i] = a; mass += a; px[i] = L[(a * 255) | 0];
        }
      }
      // Grenzen op de schaal van het volle rooster (88×88).
      const vm = mass * (7744 / (N * N));
      if (vm < 2 || vm > 7744 * 0.6) {
        if (++s.dead > 50) { A.fill(0); for (let b = 0; b < 5; b++) this.seed(s, g.r(), g.r(), g); s.dead = 0; }
      } else s.dead = 0;
      blit(c.g, g);
      // uitgangen
      let m = 0, sx = 0, sy = 0;
      for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x += 2) { const a = A[y * N + x]; m += a; sx += a * x; sy += a * y; }
      s.o.massa = cl01(m * 4 / (N * N * 0.25));
      const mn = m * (7744 / (N * N));
      s.o.beweging = auto(s, 'b', Math.abs(mn - (s.pm ?? mn)));
      s.o.x = m ? sx / m / N : 0.5; s.o.y = m ? sy / m / N : 0.5;
      if (mn < 0.5 && (s.pm ?? 0) >= 0.5) s.e.leeg = 1;
      s.pm = mn;
    } },

  { id: 'ph', naam: 'Physarum', sub: 'slijmzwam-simulatie', cat: 'Zwermen', pal: 'gloed',
    knobs: [K('sa', 'sensorhoek °', 5, 90, 1, 30), K('so', 'sensorafstand', 2, 26, 0.5, 9), K('ra', 'draaihoek °', 3, 90, 1, 20),
      K('dec', 'spoorbehoud', 0.8, 0.99, 0.005, 0.92, { rnd: [0.85, 0.97] })],
    AGENTS: 5000,
    init(s, p, g) {
      const N = 160, A = this.AGENTS;
      s.N = N; s.n = A; s.ax = new Float32Array(A); s.ay = new Float32Array(A); s.aa = new Float32Array(A);
      for (let i = 0; i < A; i++) { const r = Math.sqrt(g.r()) * N * 0.32, an = g.r() * TAU; s.ax[i] = N / 2 + Math.cos(an) * r; s.ay[i] = N / 2 + Math.sin(an) * r; s.aa[i] = an + PI; }
      s.T = new Float32Array(N * N); s.T2 = new Float32Array(N * N); s.g = rooster(g, N);
    },
    step(s, p, g) {
      const N = s.N, T = s.T, sa = p.sa * PI / 180, so = p.so, ra = p.ra * PI / 180;
      // Minder agents bij lagere kwaliteit; elk legt navenant meer spoor, dan
      // blijft het netwerk even fel. Ze lopen even snel.
      const n = Math.max(1, Math.round(s.n * kwaliteit(g))), dep = 4 * s.n / n;
      for (let i = 0; i < n; i++) {
        const x = s.ax[i], y = s.ay[i];
        let a = s.aa[i];
        const f = snuif(T, N, x + Math.cos(a) * so, y + Math.sin(a) * so), l = snuif(T, N, x + Math.cos(a - sa) * so, y + Math.sin(a - sa) * so), r = snuif(T, N, x + Math.cos(a + sa) * so, y + Math.sin(a + sa) * so);
        if (f > l && f > r) { /* rechtdoor */ } else if (f < l && f < r) a += (g.r() < 0.5 ? -1 : 1) * ra; else if (l > r) a -= ra; else if (r > l) a += ra;
        let nx = x + Math.cos(a), ny = y + Math.sin(a);
        nx = (nx + N) % N; ny = (ny + N) % N;
        s.ax[i] = nx; s.ay[i] = ny; s.aa[i] = a; T[(ny | 0) * N + (nx | 0)] += dep;
      }
      const T2 = s.T2, dec = p.dec / 9;
      for (let y = 0; y < N; y++) {
        const ym = ((y - 1 + N) % N) * N, yc = y * N, yp = ((y + 1) % N) * N;
        for (let x = 0; x < N; x++) {
          const xm = (x - 1 + N) % N, xp = (x + 1) % N;
          T2[yc + x] = (T[ym + xm] + T[ym + x] + T[ym + xp] + T[yc + xm] + T[yc + x] + T[yc + xp] + T[yp + xm] + T[yp + x] + T[yp + xp]) * dec;
        }
      }
      s.T = T2; s.T2 = T;
      const px = s.g.px, L = g.L;
      for (let i = 0; i < T2.length; i++) px[i] = L[((1 - Math.exp(-T2[i] * 0.07)) * 255) | 0];
      blit(s.g, g);
      // uitgangen
      let sm = 0, mx = 0;
      for (let i = 0; i < T2.length; i += 3) { sm += T2[i]; if (T2[i] > mx) mx = T2[i]; }
      s.o.spoor = auto(s, 's', sm); s.o.piek = auto(s, 'p', mx);
      let c = 0;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) c += T2[(N / 2 + y) * N + N / 2 + x];
      s.o.midden = auto(s, 'm', c);
    } },

  { id: 'sp', naam: 'Zandhoop', sub: 'Abelian sandpile · zelfgeorganiseerde kritikaliteit', cat: 'Automaten', pal: 'iris',
    knobs: [K('gpf', 'korrels per frame', 20, 3000, 10, 600, { fix: 1 }), SEL('pl', 'plek', ['Midden', 'Vier punten', 'Diagonaal'], 0, { re: 1 })],
    init(s, p, g) {
      const N = 129, c = N >> 1, q = N >> 2;
      s.N = N; s.a = new Uint32Array(N * N); s.g = rooster(g, N);
      // Een vaste stapel met een vlag per cel: elke cel staat er hooguit één
      // keer op, dus hij past altijd en er wordt niets gealloceerd.
      s.st = new Int32Array(N * N); s.op = new Uint8Array(N * N); s.sn = 0;
      s.done = 0; s.nt = 0; s.omval = 0;
      s.pts = p.pl == 0 ? [[c, c]] : p.pl == 1 ? [[q, q], [N - 1 - q, q], [q, N - 1 - q], [N - 1 - q, N - 1 - q]] : [[q, q], [c, c], [N - 1 - q, N - 1 - q]];
    },
    /** Opnieuw beginnen zonder nieuwe arrays (het origineel riep init aan). */
    leeg(s) { s.a.fill(0); s.op.fill(0); s.sn = 0; s.done = 0; },
    step(s, p, g) {
      const N = s.N, a = s.a;
      if (s.done) {
        // Terug in de tijd (nieuwe AudioContext) telt ook als "lang genoeg".
        if (g.t - s.done > 2.5 || g.t < s.done) this.leeg(s);
      } else {
        const st = s.st, op = s.op, add = Math.max(1, (p.gpf / s.pts.length) | 0);
        let sn = s.sn;
        for (const [x, y] of s.pts) { const i = y * N + x; a[i] += add; if (!op[i]) { op[i] = 1; st[sn++] = i; } }
        const max = Math.round(SP_MAX_OMVAL * kwaliteit(g));
        let n = 0;
        while (sn && n < max) {
          const i = st[--sn]; op[i] = 0;
          const v = a[i];
          if (v < 4) continue;
          const q = v >> 2; a[i] = v & 3; n++;
          const x = i % N, y = (i / N) | 0;
          if (x > 0) { const j = i - 1; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
          if (x < N - 1) { const j = i + 1; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
          if (y > 0) { const j = i - N; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
          if (y < N - 1) { const j = i + N; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
        }
        s.sn = sn; s.nt += n; s.omval = n;
        for (let x = 0; x < N; x++) if (a[N + x] || a[x * N + 1]) { s.done = g.t; break; }
      }
      const px = s.g.px, L = g.L, C0 = L[0], C1 = L[80], C2 = L[165], C3 = L[245];
      for (let i = 0; i < a.length; i++) { const v = a[i]; px[i] = v === 0 ? C0 : v === 1 ? C1 : v === 2 ? C2 : C3; }
      blit(s.g, g, true);
      // uitgangen
      const n = s.nt; s.nt = 0;
      s.avg = (s.avg ?? n) * 0.95 + n * 0.05;
      s.o.lawine = auto(s, 'l', Math.log(1 + n));
      if (n > 50 && n > s.avg * 2.5) s.e.groot = 1;
      let c = 0, t = 0;
      for (let i = 0; i < a.length; i += 5) { t++; if (a[i]) c++; }
      s.o.massa = c / t;
    } },
];
