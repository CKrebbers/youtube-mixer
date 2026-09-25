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
 * 16:9 (ROADMAP 7, docs/VORMEN-16x9.md): het doek is g.W × g.H; g.S komt
 * hier niet meer voor. Per systeem:
 *   gs, ln  rooster nx × ny met vierkante cellen over het hele doek, evenveel
 *           cellen als het oude 128² / 88² (`cellen(g, n, 2)`: de halve maat
 *           past precies). Diffusie en kernel rekenen in cellen en de cellen
 *           zijn vierkant, dus ze kloppen op beide maten zoals vroeger; de
 *           kernel van ln is op de halve maat precies R / 2 (ook bij een
 *           oneven R, vroeger afgerond). Rondlopen per as.
 *   ph      deeltjes: schaal en snelheid t.o.v. de hoogte zoals op het oude
 *           vierkant (cel = g.H / 160, spoorveld 284 × 160), en evenveel
 *           agents per cel (8875). Rekentijd × 16/9, de verhouding van de
 *           oppervlaktes. De agents beginnen in een schijf rond het midden,
 *           straal op de korte zijde, en lopen per as rond.
 *   cl      de attractor is begrensd (|x|, |y| ≤ R): hij blijft een vierkant
 *           histogram van 320², in het middenvak (`midden(g).vak`), geschaald
 *           op de korte zijde. Heel in beeld; de breedte ernaast is ruimte.
 *   sp      rooster van oneven maten (exact midden, dus een symmetrische
 *           mandala), cellen van ~4 × 4 pixels op 640 × 360. Boven en onder
 *           vallen korrels van de rand, zoals aan elke rand; "vol" is pas als
 *           de hoop de ZIJKANT raakt, zodat hij de hele breedte vult.
 *
 * Sneller zonder iets aan het beeld te veranderen: cl rekent sin/cos uit een
 * tabel en doet vervagen, maximum en kleuren in één ronde (10,6 -> ~3,5 ms);
 * ph snuift zonder closure per stap.
 *
 * Uitgangen (`s.o.*`, 0..1) en gebeurtenissen (`s.e.*`) zoals in de OUTS van
 * het origineel, berekend aan het eind van elke stap.
 *
 * `pointer(s, p, x, y, g)` (x, y in 0..1) zaait nog steeds, zonder DOM; x
 * en y per as.
 * Deze module kent geen Varve: AV-kern kan hem ongewijzigd kopiëren.
 */

import { PI, TAU, rooster, blit, cellen, midden, K, SEL } from './hulp.js';

/** Kwaliteit uit g, geklemd op 0,25..1; ontbreekt hij, dan 1. */
export function kwaliteit(g) {
  const q = g.kwaliteit;
  return typeof q === 'number' && q > 0 ? Math.max(0.25, Math.min(1, q)) : 1;
}
/** Vanaf welke kwaliteit gs en ln op het halve rooster rekenen. */
export const HALF_ONDER = 0.75;
/** Zandhoop: hoeveel cellen er hooguit omvallen per stap, op kwaliteit 1. */
export const SP_MAX_OMVAL = 150000;
/**
 * Hoe fijn elk rooster is. gs, ln en sp: de n van cellen(g, n) in hulp.js
 * (evenveel cellen als n × n, dus dezelfde rekentijd; sp grover dan zijn oude
 * 129, zie daar). ph: cellen over de hoogte. cl: de zijde van het vierkant.
 */
export const ROOSTER = { gs: 128, ln: 88, ph: 160, cl: 320, sp: 121 };

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : (v || 0));
/** Uit het origineel: normaliseren op het (langzaam zakkende) maximum. */
function auto(s, k, v) { const m = s._m || (s._m = {}); const mx = Math.max(v, (m[k] || 1e-9) * 0.997); m[k] = mx; return mx > 0 ? cl01(v / mx) : 0; }
/** Het oneven getal op of net onder v (voor een rooster met een exact midden). */
const oneven = (v) => (v % 2 ? v : v - 1);

// ---- halve maat en terug (gs en ln) ----------------------------------------

/** Gemiddelde van elk 2×2-blok: nx×ny -> nx/2×ny/2. */
function omlaag(van, nx, ny, naar) {
  const hx = nx >> 1, hy = ny >> 1;
  for (let y = 0; y < hy; y++) {
    const a = 2 * y * nx, b = a + nx;
    for (let x = 0; x < hx; x++) naar[y * hx + x] = 0.25 * (van[a + 2 * x] + van[a + 2 * x + 1] + van[b + 2 * x] + van[b + 2 * x + 1]);
  }
}
/** Bilineair, rondlopend per as: hx×hy -> 2hx×2hy. */
function omhoog(van, hx, hy, naar) {
  const nx = hx * 2, ny = hy * 2;
  for (let y = 0; y < ny; y++) {
    const fy = (y - 0.5) / 2, y0 = Math.floor(fy), v = fy - y0, ya = ((y0 % hy) + hy) % hy, yb = (ya + 1) % hy;
    for (let x = 0; x < nx; x++) {
      const fx = (x - 0.5) / 2, x0 = Math.floor(fx), u = fx - x0, xa = ((x0 % hx) + hx) % hx, xb = (xa + 1) % hx;
      naar[y * nx + x] = (van[ya * hx + xa] * (1 - u) + van[ya * hx + xb] * u) * (1 - v) + (van[yb * hx + xa] * (1 - u) + van[yb * hx + xb] * u) * v;
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

function snuif(T, NX, NY, x, y) {
  return T[(((Math.floor(y) % NY) + NY) % NY) * NX + (((Math.floor(x) % NX) + NX) % NX)];
}

// ---- de systemen -----------------------------------------------------------

export const SYSTEMEN_ZWAAR = [

  { id: 'gs', naam: 'Reactie-diffusie', sub: 'Gray-Scott · Turing-patronen', cat: 'Patronen', pal: 'fosfor',
    knobs: [K('F', 'feed', 0.01, 0.09, 0.0005, 0.0545, { rnd: [0.02, 0.07] }), K('K', 'kill', 0.045, 0.07, 0.0005, 0.062, { rnd: [0.052, 0.066] }),
      K('sp', 'stappen per frame', 1, 24, 1, 12, { fix: 1 })],
    init(s, p, g) {
      const maak = ({ nx, ny }) => ({ nx, ny, u: new Float32Array(nx * ny).fill(1), v: new Float32Array(nx * ny), u2: new Float32Array(nx * ny), v2: new Float32Array(nx * ny), g: rooster(g, { nx, ny }) });
      // 170 × 96 op 640 × 360 (evenveel cellen als 128²), even, dus de halve maat 85 × 48 past precies.
      const vol = cellen(g, ROOSTER.gs, 2);
      s.vol = maak(vol); s.half = maak({ nx: vol.nx / 2, ny: vol.ny / 2 }); s.cur = s.vol;
      for (let i = 0; i < 12; i++) this.seed(s, g.r(), g.r(), 4 + g.r() * 4, g);
    },
    /** Zaaien op het rooster dat nu rekent; r in cellen van het volle rooster. */
    seed(s, fx, fy, r, g) {
      const c = s.cur, nx = c.nx, ny = c.ny, rr = r * (ny / s.vol.ny), cx = fx * nx | 0, cy = fy * ny | 0;
      for (let y = -rr; y <= rr; y++) {
        for (let x = -rr; x <= rr; x++) {
          if (x * x + y * y > rr * rr) continue;
          const i = ((((cy + y) | 0) % ny + ny) % ny) * nx + ((((cx + x) | 0) % nx + nx) % nx);
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
      f(van.u, van.nx, van.ny, naar.u); f(van.v, van.nx, van.ny, naar.v);
      s.cur = naar;
    },
    step(s, p, g) {
      this.kies(s, kwaliteit(g) < HALF_ONDER);
      const c = s.cur, nx = c.nx, ny = c.ny, F = p.F, Kk = p.K, FK = F + Kk;
      // Op het halve rooster is een cel twee keer zo breed: de Laplace-term
      // wordt een kwart, dan hebben de vlekken dezelfde maat op het scherm.
      // De cellen zijn vierkant, dus dat geldt voor beide assen.
      const ds = c === s.vol ? 1 : 0.25;
      for (let it = 0; it < p.sp; it++) {
        const u = c.u, v = c.v, u2 = c.u2, v2 = c.v2;
        for (let y = 0; y < ny; y++) {
          const yc = y * nx, ym = ((y - 1 + ny) % ny) * nx, yp = ((y + 1) % ny) * nx;
          for (let x = 0; x < nx; x++) {
            const xm = (x - 1 + nx) % nx, xp = (x + 1) % nx, i = yc + x, U = u[i], V = v[i];
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
      const svn = sv * (s.vol.nx * s.vol.ny / v.length);      // op de schaal van het volle rooster
      s.o.activiteit = auto(s, 'a', Math.abs(svn - (s.psv ?? svn))); s.psv = svn;
    } },

  { id: 'cl', naam: 'Vreemde attractor', sub: 'Clifford · De Jong', cat: 'Chaos', pal: 'iris',
    knobs: [SEL('mode', 'formule', ['Clifford', 'De Jong'], 0), K('a', 'a', -3, 3, 0.01, -1.4, { rnd: [-2.6, 2.6] }), K('b', 'b', -3, 3, 0.01, 1.6, { rnd: [-2.6, 2.6] }),
      K('c', 'c', -3, 3, 0.01, 1, { rnd: [-1.6, 1.6] }), K('d', 'd', -3, 3, 0.01, 0.7, { rnd: [-1.6, 1.6] }), K('drift', 'drift', 0, 1, 0.01, 0.35, { fix: 1 })],
    ITER: 70000,
    // Bewust een vierkant histogram: de baan blijft binnen |x|, |y| ≤ R, en
    // R · sc = 0,47 N, dus alles buiten het middenvak zou altijd leeg zijn.
    init(s, p, g) { const N = ROOSTER.cl; s.N = N; s.g = rooster(g, { nx: N, ny: N }); s.h = new Float32Array(N * N); s.x = 0.1; s.y = 0.1; s.drempel = new Float64Array(256); s.m = 1; },
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
      // Het vierkant van de korte zijde in het midden: de vorm heel in beeld,
      // zo groot als op het oude vierkant t.o.v. de hoogte. Buiten het vak
      // tekent hij niets; daar staat de achtergrond (L[0] is die kleur).
      blit(s.g, g, false, midden(g).vak);
      // uitgangen
      const Ro = cliff ? 1 + Math.max(Math.abs(p.c), Math.abs(p.d)) : 2.05;
      s.o.x = cl01(0.5 + s.x / (2 * Ro)); s.o.y = cl01(0.5 + s.y / (2 * Ro));
      s.o.vulling = auto(s, 'v', cnt);
    } },

  { id: 'ln', naam: 'Lenia', sub: 'continu kunstmatig leven', cat: 'Automaten', pal: 'mos',
    knobs: [K('mu', 'μ (groeicentrum)', 0.08, 0.3, 0.001, 0.15, { rnd: [0.11, 0.2] }), K('sg', 'σ (groeibreedte)', 0.005, 0.04, 0.0005, 0.017, { rnd: [0.013, 0.03] }),
      K('R', 'kernelstraal', 6, 14, 1, 10, { re: 1, fix: 1 }), K('dt', 'tijdstap', 0.03, 0.25, 0.01, 0.1, { fix: 1 })],
    init(s, p, g) {
      // R in cellen, mag een breuk zijn (de halve maat van een oneven R).
      // r0 = hoeveel cellen de kernel reikt = de rand om het rooster heen.
      const maak = ({ nx, ny }, R) => {
        const r0 = Math.ceil(R), Px = nx + 2 * r0, Py = ny + 2 * r0, off = [], w = [];
        let sum = 0;
        for (let dy = -r0; dy <= r0; dy++) {
          for (let dx = -r0; dx <= r0; dx++) {
            const r = Math.hypot(dx, dy) / R;
            if (r > 0 && r < 1) { const k = Math.exp(4 - 1 / (r * (1 - r))); if (k > 1e-4) { off.push(dy * Px + dx); w.push(k); sum += k; } }
          }
        }
        return { nx, ny, R, r0, Px, Py, A: new Float32Array(nx * ny), pad: new Float32Array(Px * Py), off: Int32Array.from(off), w: Float32Array.from(w.map((v) => v / sum)), g: rooster(g, { nx, ny }) };
      };
      // 118 × 66 op 640 × 360 (evenveel cellen als 88²); halve maat 59 × 33
      // met de kernel precies half zo groot.
      const R = p.R | 0, vol = cellen(g, ROOSTER.ln, 2);
      s.vol = maak(vol, R); s.half = maak({ nx: vol.nx / 2, ny: vol.ny / 2 }, R / 2); s.cur = s.vol;
      s.dead = 0;
      for (let b = 0; b < 5; b++) this.seed(s, g.r(), g.r(), g);
    },
    seed(s, fx, fy, g) {
      const c = s.cur, nx = c.nx, ny = c.ny, A = c.A, rr = c.R * (1 + g.r()), cx = fx * nx | 0, cy = fy * ny | 0;
      for (let dy = -rr | 0; dy <= rr; dy++) {
        for (let dx = -rr | 0; dx <= rr; dx++) {
          if (dx * dx + dy * dy > rr * rr) continue;
          A[(((cy + dy) % ny + ny) % ny) * nx + (((cx + dx) % nx + nx) % nx)] = g.r();
        }
      }
    },
    // Het origineel remde met performance.now; hier met de audioklok.
    pointer(s, p, x, y, g) { if (s.pl == null || Math.abs(g.t - s.pl) > 0.12) { this.seed(s, x, y, g); s.pl = g.t; } },
    kies(s, half) {
      const naar = half ? s.half : s.vol, van = s.cur;
      if (naar === van) return;
      if (half) omlaag(van.A, van.nx, van.ny, naar.A); else omhoog(van.A, van.nx, van.ny, naar.A);
      s.cur = naar;
    },
    step(s, p, g) {
      this.kies(s, kwaliteit(g) < HALF_ONDER);
      const c = s.cur, { nx, ny, r0, Px, Py, A, pad, off, w } = c, nk = off.length, mu = p.mu, is2 = 1 / (2 * p.sg * p.sg), dt = p.dt;
      for (let y = 0; y < Py; y++) {
        const sy = ((y - r0) % ny + ny) % ny;
        for (let x = 0; x < Px; x++) pad[y * Px + x] = A[sy * nx + ((x - r0) % nx + nx) % nx];
      }
      let mass = 0;
      const px = c.g.px, L = g.L;
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const base = (y + r0) * Px + x + r0;
          let u = 0;
          for (let k = 0; k < nk; k++) u += pad[base + off[k]] * w[k];
          const G = 2 * Math.exp(-(u - mu) * (u - mu) * is2) - 1, i = y * nx + x;
          let a = A[i] + dt * G;
          a = a < 0 ? 0 : a > 1 ? 1 : a;
          A[i] = a; mass += a; px[i] = L[(a * 255) | 0];
        }
      }
      // Grenzen op de schaal van het volle rooster.
      const V = s.vol.nx * s.vol.ny, schaal = V / (nx * ny), vm = mass * schaal;
      if (vm < 2 || vm > V * 0.6) {
        if (++s.dead > 50) { A.fill(0); for (let b = 0; b < 5; b++) this.seed(s, g.r(), g.r(), g); s.dead = 0; }
      } else s.dead = 0;
      blit(c.g, g);
      // uitgangen
      let m = 0, sx = 0, sy = 0;
      for (let y = 0; y < ny; y += 2) for (let x = 0; x < nx; x += 2) { const a = A[y * nx + x]; m += a; sx += a * x; sy += a * y; }
      s.o.massa = cl01(m * 4 / (nx * ny * 0.25));
      const mn = m * schaal;
      s.o.beweging = auto(s, 'b', Math.abs(mn - (s.pm ?? mn)));
      s.o.x = m ? sx / m / nx : 0.5; s.o.y = m ? sy / m / ny : 0.5;
      if (mn < 0.5 && (s.pm ?? 0) >= 0.5) s.e.leeg = 1;
      s.pm = mn;
    } },

  { id: 'ph', naam: 'Physarum', sub: 'slijmzwam-simulatie', cat: 'Zwermen', pal: 'gloed',
    knobs: [K('sa', 'sensorhoek °', 5, 90, 1, 30), K('so', 'sensorafstand', 2, 26, 0.5, 9), K('ra', 'draaihoek °', 3, 90, 1, 20),
      K('dec', 'spoorbehoud', 0.8, 0.99, 0.005, 0.92, { rnd: [0.85, 0.97] })],
    AGENTS: 5000,                                // per 160 × 160 cellen
    init(s, p, g) {
      // Schaal en snelheid zoals op het oude vierkant, gemeten aan de hoogte:
      // een cel is g.H / 160 (284 × 160 op 640 × 360), een agent loopt één
      // cel per stap en de sensorafstand staat in cellen. De breedte erbij
      // krijgt evenveel agents per cel (8875), dan zijn de sporen even fel
      // en even dik. Rekentijd × 16/9: de verhouding van de oppervlaktes.
      const NY = ROOSTER.ph, NX = Math.round(NY * g.W / g.H), A = Math.round(this.AGENTS * NX / NY), R = Math.min(NX, NY) * 0.32;
      s.nx = NX; s.ny = NY; s.n = A; s.ax = new Float32Array(A); s.ay = new Float32Array(A); s.aa = new Float32Array(A);
      for (let i = 0; i < A; i++) { const r = Math.sqrt(g.r()) * R, an = g.r() * TAU; s.ax[i] = NX / 2 + Math.cos(an) * r; s.ay[i] = NY / 2 + Math.sin(an) * r; s.aa[i] = an + PI; }
      s.T = new Float32Array(NX * NY); s.T2 = new Float32Array(NX * NY); s.g = rooster(g, { nx: NX, ny: NY });
    },
    step(s, p, g) {
      const NX = s.nx, NY = s.ny, T = s.T, sa = p.sa * PI / 180, so = p.so, ra = p.ra * PI / 180;
      // Minder agents bij lagere kwaliteit; elk legt navenant meer spoor, dan
      // blijft het netwerk even fel. Ze lopen even snel.
      const n = Math.max(1, Math.round(s.n * kwaliteit(g))), dep = 4 * s.n / n;
      for (let i = 0; i < n; i++) {
        const x = s.ax[i], y = s.ay[i];
        let a = s.aa[i];
        const f = snuif(T, NX, NY, x + Math.cos(a) * so, y + Math.sin(a) * so), l = snuif(T, NX, NY, x + Math.cos(a - sa) * so, y + Math.sin(a - sa) * so), r = snuif(T, NX, NY, x + Math.cos(a + sa) * so, y + Math.sin(a + sa) * so);
        if (f > l && f > r) { /* rechtdoor */ } else if (f < l && f < r) a += (g.r() < 0.5 ? -1 : 1) * ra; else if (l > r) a -= ra; else if (r > l) a += ra;
        let qx = x + Math.cos(a), qy = y + Math.sin(a);
        qx = (qx + NX) % NX; qy = (qy + NY) % NY;
        s.ax[i] = qx; s.ay[i] = qy; s.aa[i] = a; T[(qy | 0) * NX + (qx | 0)] += dep;
      }
      const T2 = s.T2, dec = p.dec / 9;
      for (let y = 0; y < NY; y++) {
        const ym = ((y - 1 + NY) % NY) * NX, yc = y * NX, yp = ((y + 1) % NY) * NX;
        for (let x = 0; x < NX; x++) {
          const xm = (x - 1 + NX) % NX, xp = (x + 1) % NX;
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
      const mx0 = NX >> 1, my0 = NY >> 1;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) c += T2[(my0 + y) * NX + mx0 + x];
      s.o.midden = auto(s, 'm', c);
    } },

  { id: 'sp', naam: 'Zandhoop', sub: 'Abelian sandpile · zelfgeorganiseerde kritikaliteit', cat: 'Automaten', pal: 'iris',
    knobs: [K('gpf', 'korrels per frame', 20, 3000, 10, 600, { fix: 1 }), SEL('pl', 'plek', ['Midden', 'Vier punten', 'Diagonaal'], 0, { re: 1 })],
    init(s, p, g) {
      // 161 × 91 op 640 × 360: oneven, dus een exact midden en een
      // symmetrische mandala, en cellen van bijna precies 4 × 4 pixels, zodat
      // de scherpe blokken even breed zijn. Grover dan cellen(g, 129): de
      // lawine is begrensd (SP_MAX_OMVAL), en tot de zijkant vol duurt zo
      // ~2,8 s, tegen 2,1 s voor het oude vierkant (171 × 97: 3,4 s).
      const m = cellen(g, ROOSTER.sp), nx = oneven(m.nx), ny = oneven(m.ny);
      const cx = nx >> 1, cy = ny >> 1, qx = nx >> 2, qy = ny >> 2;
      s.nx = nx; s.ny = ny; s.a = new Uint32Array(nx * ny); s.g = rooster(g, { nx, ny });
      // Een vaste stapel met een vlag per cel: elke cel staat er hooguit één
      // keer op, dus hij past altijd en er wordt niets gealloceerd.
      s.st = new Int32Array(nx * ny); s.op = new Uint8Array(nx * ny); s.sn = 0;
      s.done = 0; s.nt = 0; s.omval = 0;
      s.pts = p.pl == 0 ? [[cx, cy]] : p.pl == 1 ? [[qx, qy], [nx - 1 - qx, qy], [qx, ny - 1 - qy], [nx - 1 - qx, ny - 1 - qy]] : [[qx, qy], [cx, cy], [nx - 1 - qx, ny - 1 - qy]];
    },
    /** Opnieuw beginnen zonder nieuwe arrays (het origineel riep init aan). */
    leeg(s) { s.a.fill(0); s.op.fill(0); s.sn = 0; s.done = 0; },
    step(s, p, g) {
      const nx = s.nx, ny = s.ny, a = s.a;
      if (s.done) {
        // Terug in de tijd (nieuwe AudioContext) telt ook als "lang genoeg".
        if (g.t - s.done > 2.5 || g.t < s.done) this.leeg(s);
      } else {
        const st = s.st, op = s.op, add = Math.max(1, (p.gpf / s.pts.length) | 0);
        let sn = s.sn;
        for (const [x, y] of s.pts) { const i = y * nx + x; a[i] += add; if (!op[i]) { op[i] = 1; st[sn++] = i; } }
        const max = Math.round(SP_MAX_OMVAL * kwaliteit(g));
        let n = 0;
        while (sn && n < max) {
          const i = st[--sn]; op[i] = 0;
          const v = a[i];
          if (v < 4) continue;
          const q = v >> 2; a[i] = v & 3; n++;
          const x = i % nx, y = (i / nx) | 0;
          if (x > 0) { const j = i - 1; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
          if (x < nx - 1) { const j = i + 1; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
          if (y > 0) { const j = i - nx; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
          if (y < ny - 1) { const j = i + nx; if ((a[j] += q) >= 4 && !op[j]) { op[j] = 1; st[sn++] = j; } }
        }
        s.sn = sn; s.nt += n; s.omval = n;
        // Vol = de hoop raakt de ZIJKANT (kolom 1 of nx - 2). Het origineel
        // keek ook naar rij 1, maar op 16:9 is dat bij de helft van de
        // breedte: dan bleef het een cirkel in het midden. Boven en onder
        // vallen de korrels van de rand, zoals aan elke rand.
        for (let y = 0; y < ny; y++) if (a[y * nx + 1] || a[y * nx + nx - 2]) { s.done = g.t; break; }
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
