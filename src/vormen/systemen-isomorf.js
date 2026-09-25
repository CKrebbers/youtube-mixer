/**
 * De vier ISOMORFE Vormmachines: beeld en geluid zijn dezelfde data.
 * Trillende snaar (sn), Trommelvlies (tv), Epicykels (ep), Korrelwolk (dw).
 * Uit Clay's `vormmachines.html`; rekenregels en knoppen zoals daar, met de
 * aanpassingen van systemen.js (geen DOM, toeval uit `g.r()`, tijd uit `g.t`)
 * en deze:
 *
 *   - HET BEELD TELT. Het geluid zit achter een optionele sink:
 *       g.geluid = null (standaard)
 *               | { ctx: AudioContext, uit: AudioNode, grondtoon?: midi,
 *                   toonladder?: naam uit TOONLADDERS, korrelBuffer?: AudioBuffer }
 *     Zonder sink, of met een AudioContext die niet 'running' is: geen enkele
 *     Web Audio-aanroep. Het beeld is met en zonder sink hetzelfde (het toeval
 *     voor het geluid komt uit een eigen generator, niet uit g.r()).
 *   - 'vol'-knoppen doen alleen iets aan het geluid: ze hebben `geluid: 1` en
 *     staan achteraan. `draaiKnoppen()` in systemen.js kent die vlag nog niet
 *     (zie de hoofdsessie); `beeldKnoppen()` hieronder laat ze weg.
 *   - De zelfspeel-klok ('auto', s.next) loopt op g.t, ook in act/strike.
 *     Loopt de klok TERUG (nieuwe AudioContext), dan schuift alles wat op
 *     een tijd staat mee, anders groeit een uitsterving tot oneindig.
 *   - g.kwaliteit (0,25..1, ontbreekt = 1) maakt het beeld grover, nooit de
 *     beweging trager: tv rekent op een kleiner rooster (vel én lucht), sn op
 *     minder punten van de snaar, ep tekent spoor en kanalen in minder
 *     stukken, dw bundelt de deeltjes per kleurband.
 *   - Tekst in het beeld (nootnaam, bijschriften) is weg: over de video is
 *     dat ruis, net als het tekstje van km in systemen.js.
 *   - Geen allocaties per frame: werkarrays, spoor (ringbuffer) en geest van
 *     ep staan in init.
 *   - HET DOEK IS 16:9 (g.W × g.H, ROADMAP 7; hulp.js). Het geluid is
 *     daarbij niet veranderd, ook niet waar de vorm het bepaalt:
 *       sn  de snaar ligt over de hele breedte (hoogtes op g.H); een snaar
 *           is een lijn, en zijn toon hangt niet af van de lengte in beeld.
 *       tv  het vel blijft ROND, in het midden (dezelfde Bessel-modi, dus
 *           hetzelfde geluid; een rechthoekig vel zou andere modi en een
 *           andere klank geven). Naast het vel: de lucht, wat de slag
 *           uitstraalt (zie luchtCache).
 *       ep  de figuur rond het midden, op de korte zijde; links en rechts de
 *           twee kanalen L (= x) en R (= y) als golfvorm (zie kanalen()).
 *       dw  de korrels bewegen in echte eenheden (niets rekt uit); x blijft
 *           voor het geluid de fractie van de breedte (buffer en panorama).
 *
 * Een systeem met een levende geluidsbron (ep: twee oscillatoren) heeft
 * `gate(s, p, aan, g)` (stil/aan zonder op te ruimen) en `stop(s)` (opruimen).
 * Wie een laag uitzet of een ander systeem kiest, roept die aan.
 */

import { PI, TAU, LUTS, pcol, rooster, blit, clear, midden, maakRng, K, SEL } from './hulp.js';

// ---- klein gereedschap -----------------------------------------------------

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : (v || 0));
/** g.kwaliteit, geklemd op 0,25..1; ontbreekt of onzin = 1. */
const kwaliteit = (g) => { const k = g.kwaliteit; return Number.isFinite(k) ? Math.max(0.25, Math.min(1, k)) : 1; };
/** Speelt de sink? Het origineel heette dit AON(). */
export const klinkt = (g) => !!g.geluid && g.geluid.ctx.state === 'running';

/**
 * De klok liep terug (t kleiner dan de vorige stap): schuif alle tijden in
 * de toestand met hetzelfde verschil mee, zodat "sinds de aanslag" gelijk
 * blijft. `velden` = namen van tijdvelden in s.
 */
function volgKlok(s, t, velden) {
  if (s.tl != null && t < s.tl) {
    const d = t - s.tl;
    for (const v of velden) if (s[v]) s[v] += d;
  }
  s.tl = t;
}

// ---- toonhulp --------------------------------------------------------------

export const NOOTNAMEN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const TOONLADDERS = {
  'Mineur pentatonisch': [0, 3, 5, 7, 10], 'Majeur pentatonisch': [0, 2, 4, 7, 9], Dorisch: [0, 2, 3, 5, 7, 9, 10],
  Lydisch: [0, 2, 4, 6, 7, 9, 11], Hirajoshi: [0, 2, 3, 7, 8], Heletoon: [0, 2, 4, 6, 8, 10],
};
/** In het origineel 48 + AU.root met root 9 (A): A3. */
export const GRONDTOON = 57;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const nname = (m) => NOOTNAMEN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
/** Trap `deg` van de toonladder boven `base` (midi). */
export function midiFrom(base, deg, ladder = 'Mineur pentatonisch') {
  const sc = TOONLADDERS[ladder] ?? TOONLADDERS['Mineur pentatonisch'], L = sc.length, o = Math.floor(deg / L), i = ((deg % L) + L) % L;
  return base + 12 * o + sc[i];
}
const grondtoon = (g) => (Number.isFinite(g.geluid?.grondtoon) ? g.geluid.grondtoon : GRONDTOON);
const ladder = (g) => g.geluid?.toonladder;

// ---- modale synthese -------------------------------------------------------

/**
 * Een buffer met gedempte sinussen (modi), per modus een complexe
 * oscillator die elke sample een klein stukje draait en krimpt.
 * `ruis` = korte ruisstoot aan het begin (stok), uit generator `r`.
 */
export function modalBuffer(C, freqs, amps, taus, dur, ruis, r) {
  const sr = C.sampleRate, len = Math.max(1, Math.floor(sr * dur)), b = C.createBuffer(1, len, sr), d = b.getChannelData(0);
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f <= 20 || f > sr * 0.45 || !amps[k]) continue;
    const w = TAU * f / sr, cr = Math.cos(w), ci = Math.sin(w), rr = Math.exp(-1 / (taus[k] * sr)), n = Math.min(len, Math.floor(taus[k] * sr * 7));
    let zr = amps[k], zi = 0;
    for (let i = 0; i < n; i++) { d[i] += zi; const nr = (zr * cr - zi * ci) * rr; zi = (zr * ci + zi * cr) * rr; zr = nr; }
  }
  if (ruis) { const n = Math.floor(sr * 0.012); for (let i = 0; i < n; i++) d[i] += (r() * 2 - 1) * ruis * (1 - i / n); }
  const a = Math.floor(sr * 0.002);
  for (let i = 0; i < a; i++) d[i] *= i / a;
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk > 0) for (let i = 0; i < len; i++) d[i] *= 0.6 / pk;
  return b;
}
/** Eén keer afspelen op de sink: bron -> gain -> panner -> sink.uit. */
export function playBuf(sink, b, vol, pan) {
  const C = sink.ctx, s = C.createBufferSource(), g = C.createGain(), p = C.createStereoPanner();
  s.buffer = b; g.gain.value = vol; p.pan.value = Math.max(-1, Math.min(1, pan));
  s.connect(g); g.connect(p); p.connect(sink.uit); s.start();
}

// ---- trommelvel: Bessel-modi -----------------------------------------------

/** [m, j]: hoekgetal en nulpunt van J_m. De eerste zestien modi van een rond vel. */
export const DRUM = [[0, 2.4048], [1, 3.8317], [2, 5.1356], [0, 5.5201], [3, 6.3802], [1, 7.0156], [4, 7.5883], [2, 8.4172],
  [0, 8.6537], [5, 8.7715], [3, 9.761], [6, 9.9361], [1, 10.1735], [4, 11.0647], [7, 11.0864], [2, 11.6198]];
export function besselJ(m, x) { let s = 0; const N = 48; for (let i = 0; i < N; i++) { const u = (i + 0.5) / N * PI; s += Math.cos(m * u - x * Math.sin(u)); } return s / N; }
const RMAX = DRUM.map(([m, j]) => { let mx = 0; for (let i = 0; i <= 80; i++) mx = Math.max(mx, Math.abs(besselJ(m, j * i / 80))); return mx; });
const DCACHE = {};
/**
 * Per roostermaat N: de pixels binnen het vel en per modus de cos- en
 * sin-component op elke pixel. Pure data, gedeeld door alle lagen. Het
 * origineel had alleen N = 110; kleinere N zijn voor g.kwaliteit.
 */
export function drumCache(N = 110) {
  if (DCACHE[N]) return DCACHE[N];
  const idx = [], rr = [], th = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v);
    if (r <= 1) { idx.push(y * N + x); rr.push(r); th.push(Math.atan2(v, u)); }
  }
  const C = [], S = [];
  DRUM.forEach(([m, j], k) => {
    const T = new Float32Array(201);
    for (let i = 0; i <= 200; i++) T[i] = besselJ(m, j * i / 200) / RMAX[k];
    const c = new Float32Array(idx.length), s = new Float32Array(idx.length);
    for (let q = 0; q < idx.length; q++) { const R = T[Math.round(rr[q] * 200)]; c[q] = R * Math.cos(m * th[q]); s[q] = R * Math.sin(m * th[q]); }
    C.push(c); S.push(s);
  });
  return (DCACHE[N] = { N, idx: Int32Array.from(idx), C, S, rmax: RMAX });
}
/** Roostermaat van tv bij een kwaliteit: 110 (origineel), 78 of 55. */
const vel = (kw) => (kw >= 0.75 ? 110 : kw >= 0.4 ? 78 : 55);

// ---- de lucht rond het vel: wat een slag uitstraalt --------------------------
//
// Het vel blijft rond (dezelfde Bessel-modi, dus hetzelfde geluid). Wat op het
// 16:9-doek naast het vel ligt, is de LUCHT: per modus een golf die vanaf de
// rand naar buiten loopt, met het hoekpatroon van die modus (m = 0 ringen,
// m = 1 twee lobben in tegenfase, m = 2 vier). Zo is ook de rest van het beeld
// het geluid, zoals het de ruimte in gaat. Beeld, geen akoestiek: snelheid en
// sterkte zijn beeldkeuzes, en alleen m ≤ 2 straalt (hogere m stralen bij een
// vel nauwelijks uit, en zo blijft de rekentijd binnen de verhouding W / H).
// Een slag loopt als FRONT naar buiten: voorbij het front klinkt in de lucht
// nog de slag ervoor (LUCHT_GESCHIEDENIS slagen terug), over een smalle band
// in elkaar overvloeiend, zodat het front geen trapjes van het rooster toont.

/** De modi die uitstralen (index in DRUM) en hun gewicht per hoekgetal m. */
export const LUCHT_MODI = DRUM.map((_, k) => k).filter((k) => DRUM[k][0] <= 2);
const LUCHT_M = [1, 0.75, 0.5];
/** Golfsnelheid in de lucht, in stralen van het vel per seconde: in ~2 s bij de verste hoek. */
export const LUCHT_C = 0.5;
/** Hoe fel de lucht is ten opzichte van het vel (het vel blijft de hoofdzaak). */
const LUCHT_FEL = 0.45;
/** Hoeveel eerdere slagen de lucht onthoudt (fronten die nog onderweg zijn). */
export const LUCHT_GESCHIEDENIS = 4;
/** Halve breedte van de overvloeiband rond een front, en de aanloop vanaf de rand, in stralen. */
const LUCHT_BAND = 0.04, LUCHT_AANLOOP = 0.08;
const LCACHE = {};
/**
 * Per doek (nx × ny cellen over W × H, het vel in het midden met straal
 * kort / 2): de cellen buiten het vel, OPLOPEND op afstand tot de rand
 * (zodat een golffront één plek in de lijst is), en per cel en per
 * uitstralende modus vier getallen:
 *   w · cos mθ · cos κρ,  w · cos mθ · sin κρ,  w · sin mθ · cos κρ,  w · sin mθ · sin κρ
 * met ρ = r − 1 (afstand tot de rand in stralen), κ = ω / c en
 * w = gewicht(m) / √r (een cilindergolf verliest zo zijn energie) × een
 * aanloop vanaf de rand (de rand van het vel zit vast en is donker; zo loopt
 * de lucht er zacht uit weg in plaats van tegen de trapjes van het vel aan).
 * Pure data, gedeeld door alle lagen.
 */
export function luchtCache(nx, ny, W, H) {
  const sleutel = `${nx}x${ny}:${W}x${H}`;
  if (LCACHE[sleutel]) return LCACHE[sleutel];
  const kort = Math.min(W, H), R = kort / 2, cx = W / 2, cy = H / 2, cel = Math.min(W / nx, H / ny);
  const binnen = 1 - 1.5 * cel / R;                      // tot net onder de rand: geen naad onder de zachte rand van het vel
  const cellen = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const u = ((x + 0.5) * W / nx - cx) / R, v = ((y + 0.5) * H / ny - cy) / R, r = Math.hypot(u, v);
    if (r > binnen) cellen.push([y * nx + x, Math.max(0, r - 1), Math.max(r, 0.5), Math.atan2(v, u)]);
  }
  cellen.sort((a, b) => a[1] - b[1]);
  const n = cellen.length, NL = LUCHT_MODI.length, P = new Float32Array(n * NL * 4);
  cellen.forEach(([, rho, r, th], q) => {
    const aanloop = 1 - Math.exp(-rho / LUCHT_AANLOOP);
    LUCHT_MODI.forEach((k, j) => {
      const [m, jz] = DRUM[k], kappa = TAU * 0.8 * (jz / DRUM[0][1]) / LUCHT_C, w = LUCHT_M[m] / Math.sqrt(r) * aanloop;
      const cm = Math.cos(m * th) * w, sm = Math.sin(m * th) * w, ck = Math.cos(kappa * rho), sk = Math.sin(kappa * rho), o = (q * NL + j) * 4;
      P[o] = cm * ck; P[o + 1] = cm * sk; P[o + 2] = sm * ck; P[o + 3] = sm * sk;
    });
  });
  return (LCACHE[sleutel] = { nx, ny, idx: Int32Array.from(cellen, (c) => c[0]), rho: Float32Array.from(cellen, (c) => c[1]), P, NL });
}
const zacht = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** De lucht in één cel voor één slag: coëfficiënten c vanaf e maal de tabel P vanaf o. */
function luchtSom(c, e, P, o, n) { let z = 0; for (let j = 0; j < n; j++) z += c[e + j] * P[o + j]; return z; }

// ---- Fourier: vormen als draaiende cirkels ---------------------------------

/** Een gesloten lijn opnieuw bemonsteren op M punten, gelijk verdeeld over de lengte. */
export function resample(pts, M) {
  const P = [...pts, pts[0]], L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const T = L[L.length - 1] || 1, out = [];
  let j = 0;
  for (let k = 0; k < M; k++) {
    const d = k / M * T;
    while (j < L.length - 2 && L[j + 1] < d) j++;
    const u = (d - L[j]) / ((L[j + 1] - L[j]) || 1);
    out.push([P[j][0] + (P[j + 1][0] - P[j][0]) * u, P[j][1] + (P[j + 1][1] - P[j][1]) * u]);
  }
  return out;
}
/** DFT van een gesloten lijn, genormaliseerd op de straal, grootste cirkel eerst. */
export function fourier(pts) {
  const N = pts.length;
  let mx = 0, my = 0;
  pts.forEach(([x, y]) => { mx += x; my += y; });
  mx /= N; my /= N;
  let r = 1e-9;
  const z = pts.map(([x, y]) => { const a = x - mx, b = y - my; r = Math.max(r, Math.hypot(a, b)); return [a, b]; });
  const out = [];
  for (let n = -N / 2; n < N / 2; n++) {
    if (!n) continue;
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) { const a = -TAU * n * k / N, c = Math.cos(a), s = Math.sin(a); re += z[k][0] * c - z[k][1] * s; im += z[k][0] * s + z[k][1] * c; }
    out.push({ n, re: re / N / r, im: im / N / r });
  }
  return out.sort((a, b) => Math.hypot(b.re, b.im) - Math.hypot(a.re, a.im));
}
/** De zes vormen van ep: ster, hart, vierkant, lemniscaat, roos, klaver. */
export function epShape(i) {
  const M = 256, f = [];
  if (i === 0) { const v = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.42 : 1, a = -PI / 2 + k * PI / 5; v.push([r * Math.cos(a), r * Math.sin(a)]); } return resample(v, M); }
  if (i === 2) return resample([[-1, -1], [1, -1], [1, 1], [-1, 1]], M);
  for (let k = 0; k < M; k++) {
    const t = k / M * TAU;
    let x, y;
    if (i === 1) { x = 16 * Math.sin(t) ** 3; y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); }
    else if (i === 3) { const d = 1 + Math.sin(t) ** 2; x = Math.cos(t) / d; y = Math.sin(t) * Math.cos(t) / d; }
    else if (i === 4) { const r = Math.cos(4 * t); x = r * Math.cos(t); y = r * Math.sin(t); }
    else { x = Math.sin(t) + 2 * Math.sin(2 * t); y = Math.cos(t) - 2 * Math.cos(2 * t); }
    f.push([x, y]);
  }
  return f;
}

// ---- de systemen -----------------------------------------------------------

const VOL = (v) => K('vol', 'volume', 0, 1, 0.01, v, { fix: 1, geluid: 1 });
/** Een eigen generator voor het geluid, zodat g.r() (het beeld) niet afhangt van de sink. */
const geluidsToeval = (g) => maakRng((g.r() * 4294967296) >>> 0);

const SN = {
  id: 'sn', naam: 'Trillende snaar', sub: 'modale synthese · beeld = geluid', cat: 'Isomorf', pal: 'gloed',
  knobs: [K('toon', 'toon (trap)', 0, 14, 1, 5), K('pos', 'plukplek', 0.03, 0.5, 0.005, 0.2), K('pick', 'opnemer', 0.05, 0.95, 0.01, 0.83),
    K('damp', 'uitklinktijd', 0.2, 4, 0.05, 1.2), K('B', 'stijfheid', 0, 0.004, 0.0001, 0.0004, { rnd: [0, 0.003] }), K('hel', 'helderheid', 0, 1, 0.01, 0.55),
    K('auto', 'zelf spelen /s', 0, 4, 0.05, 0.8, { fix: 1 }), VOL(0.7)],
  presets: [['Gitaar', { pos: 0.18, B: 0.0002, hel: 0.55, damp: 1.4 }], ['Harp', { pos: 0.5, B: 0, hel: 0.3, damp: 2 }], ['Piano', { pos: 0.12, B: 0.0025, hel: 0.7, damp: 1.8 }],
    ['Klavecimbel', { pos: 0.06, B: 0.0006, hel: 0.95, damp: 0.8 }], ['Bel', { pos: 0.3, B: 0.004, hel: 0.8, damp: 3 }]],
  outs: ['energie', 'toon'], events: ['aanslag'],
  init(s, p, g) {
    const M = 24, X = 160;
    s.M = M; s.X = X; s.A = new Float32Array(M); s.tau = new Float32Array(M).fill(1); s.t0 = 0; s.tab = []; s.deg = 0; s.next = 0; s.E = 0; s.tl = null;
    for (let n = 1; n <= M; n++) { const r = new Float32Array(X + 1); for (let i = 0; i <= X; i++) r[i] = Math.sin(n * PI * i / X); s.tab.push(r); }
    s.cur = new Float32Array(M); s.env = new Float32Array(M);
    s.fr = new Float32Array(M); s.am = new Float32Array(M); s.ta = new Float32Array(M);
    s.gr = geluidsToeval(g);
  },
  ratio(n, B) { return n * Math.sqrt(1 + B * n * n); },
  strike(s, p, pos, g) {
    const t = g.t, M = s.M, dt = t - s.t0, deg = Math.round(p.toon) + s.deg, base = grondtoon(g), f0 = mtof(midiFrom(base, deg, ladder(g)));
    for (let n = 1; n <= M; n++) {
      const k = n - 1, old = s.A[k] * Math.exp(-dt / s.tau[k]) * Math.cos(TAU * 0.6 * this.ratio(n, p.B) * dt),
        a = 2 * Math.sin(n * PI * pos) / (n * n * PI * PI * pos * (1 - pos)), tau = p.damp * 1.6 / (1 + (1 - p.hel) * (n - 1) * 0.45) / Math.sqrt(n * 0.6 + 0.4);
      s.A[k] = old * 0.5 + a; s.tau[k] = tau; s.fr[k] = f0 * this.ratio(n, p.B); s.am[k] = a * Math.sin(n * PI * p.pick); s.ta[k] = tau * 0.8;
    }
    s.t0 = t; s.e.aanslag = 1; s.note = nname(midiFrom(base, deg, ladder(g)));
    if (klinkt(g)) playBuf(g.geluid, modalBuffer(g.geluid.ctx, s.fr, s.am, s.ta, Math.min(4.5, s.ta[0] * 5), 0, s.gr), p.vol, (pos - 0.5) * 0.6);
  },
  act: { aanslaan(s, p, g) { SN.strike(s, p, p.pos, g); } },
  /**
   * Waar de snaar ligt: over de hele breedte, met aan beide kanten dezelfde
   * rand als boven (8% van de hoogte). De snaar is een lijn, geen vlak: langer
   * maken rekt niets uit, en de toon hangt niet af van de lengte in beeld.
   */
  kam(g) { const rand = g.H * 0.08; return { x0: rand, x1: g.W - rand }; },
  pointer(s, p, x, y, down, g) {
    if (!down) return;
    const { x0, x1 } = this.kam(g);
    this.strike(s, p, Math.min(0.97, Math.max(0.03, (x * g.W - x0) / (x1 - x0))), g);
  },
  step(s, p, g) {
    const t = g.t;
    volgKlok(s, t, ['t0', 'next']);
    if (p.auto > 0 && t >= s.next) {
      if (s.next) { s.deg = Math.max(-4, Math.min(5, s.deg + [-2, -1, 0, 0, 1, 2][g.r() * 6 | 0])); this.strike(s, p, Math.min(0.95, Math.max(0.05, p.pos + (g.r() - 0.5) * 0.1)), g); }
      s.next = t + (1 / p.auto) * (0.6 + g.r() * 0.8);
    }
    clear(g);
    // Hoogtes op g.H (zoals vroeger op S), de snaar en de balken over g.W.
    const ctx = g.ctx, H = g.H, D = g.D, M = s.M, X = s.X, dt = t - s.t0, cy = H * 0.4, amp = H * 0.2, cur = s.cur, env = s.env;
    const { x0, x1 } = this.kam(g);
    const st = Math.max(1, Math.round(1 / kwaliteit(g)));     // om de hoeveel punten van de snaar
    for (let k = 0; k < M; k++) { env[k] = s.A[k] * Math.exp(-dt / s.tau[k]); cur[k] = env[k] * Math.cos(TAU * 0.6 * this.ratio(k + 1, p.B) * dt); }
    ctx.lineWidth = D; ctx.globalAlpha = 0.3;
    for (let k = 0; k < 4; k++) {
      ctx.strokeStyle = pcol(g.pal, 0.5); ctx.beginPath();
      for (let i = 0; i <= X; i += 2 * st) { const xx = x0 + (x1 - x0) * i / X, yy = cy - cur[k] * s.tab[k][i] * amp; if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2 * D; ctx.strokeStyle = pcol(g.pal, 0.92); ctx.beginPath();
    for (let i = 0; ; i += st) {
      if (i > X) i = X;                                    // het eindpunt altijd, ook als X niet deelbaar is
      let y = 0;
      for (let k = 0; k < M; k++) y += cur[k] * s.tab[k][i];
      const xx = x0 + (x1 - x0) * i / X, yy = cy - y * amp;
      if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
      if (i === X) break;
    }
    ctx.stroke();
    ctx.fillStyle = pcol(g.pal, 0.55); ctx.fillRect(x0 - 4 * D, cy - 12 * D, 4 * D, 24 * D); ctx.fillRect(x1, cy - 12 * D, 4 * D, 24 * D);
    const px = x0 + (x1 - x0) * p.pick;
    ctx.strokeStyle = 'rgba(201,211,230,.45)'; ctx.lineWidth = D; ctx.setLineDash([3 * D, 3 * D]);
    ctx.beginPath(); ctx.moveTo(px, cy - amp * 1.2); ctx.lineTo(px, cy + amp * 1.2); ctx.stroke(); ctx.setLineDash([]);
    const qx = x0 + (x1 - x0) * p.pos, qy = cy + amp * 1.25;
    ctx.fillStyle = '#eea13c'; ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx - 5 * D, qy + 8 * D); ctx.lineTo(qx + 5 * D, qy + 8 * D); ctx.fill();
    const by = H * 0.86, bh = H * 0.14, bw = (x1 - x0) / M;
    let E = 0;
    for (let k = 0; k < M; k++) {
      const v = Math.abs(env[k] * Math.sin((k + 1) * PI * p.pick));
      E += v * v;
      const h = Math.min(1, v * 1.4) * bh;
      ctx.fillStyle = pcol(g.pal, 0.35 + 0.6 * (1 - k / M)); ctx.fillRect(x0 + k * bw + D, by - h, bw - 2 * D, h);
    }
    s.E = E;
    s.o.energie = cl01(Math.sqrt(s.E) * 1.2); s.o.toon = cl01((p.toon + s.deg + 4) / 19);
  },
};

const TV = {
  id: 'tv', naam: 'Trommelvlies', sub: 'Bessel-modi · modale synthese', cat: 'Isomorf', pal: 'duo',
  knobs: [K('toon', 'toon (trap)', 0, 10, 1, 3), K('rad', 'slagstraal', 0, 0.95, 0.01, 0.45), K('hard', 'hardheid stok', 0, 1, 0.01, 0.5),
    K('damp', 'uitklinktijd', 0.2, 3, 0.05, 1), K('auto', 'zelf spelen /s', 0, 4, 0.05, 0.7, { fix: 1 }), VOL(0.8)],
  presets: [['Pauk', { rad: 0.3, hard: 0.3, damp: 1.8 }], ['Tabla', { rad: 0.7, hard: 0.7, damp: 0.8 }], ['Gong-achtig', { rad: 0.55, hard: 0.9, damp: 2.8 }], ['Dof', { rad: 0.02, hard: 0.1, damp: 0.6 }]],
  outs: ['energie', 'helderheid'], events: ['slag'],
  init(s, p, g) {
    s.a = new Float32Array(16); s.b = new Float32Array(16); s.tau = new Float32Array(16).fill(1); s.t0 = 0; s.next = 0; s.E = 0; s.ER = 1; s.hit = null; s.tl = null;
    s.A = new Float32Array(16); s.B = new Float32Array(16);
    s.fr = new Float32Array(16); s.am = new Float32Array(16); s.ta = new Float32Array(16);
    // Eerdere slagen, nieuwste eerst: voorbij het front van een slag klinkt in
    // de lucht nog de slag ervoor. Vooraf gemaakt, bij een slag doorgeschoven.
    s.hist = Array.from({ length: LUCHT_GESCHIEDENIS }, () => ({ a: new Float32Array(16), b: new Float32Array(16), tau: new Float32Array(16).fill(1), t0: 0 }));
    s.lc = new Float32Array((1 + LUCHT_GESCHIEDENIS) * LUCHT_MODI.length * 4);   // coëfficiënten per slag, de laatste eerst
    s.front = new Float32Array(1 + LUCHT_GESCHIEDENIS);
    s.vellen = {};                                         // per roostermaat een drumCache + rooster + lucht, pas gemaakt als nodig
    this.vel(s, g);
    s.gr = geluidsToeval(g);
  },
  /**
   * Het vel is een VIERKANT rooster van N × N in het midden (midden(g).vak),
   * de lucht een rooster over het hele doek met cellen van twee velpixels.
   * Buiten de cirkel is het vel doorzichtig (0), daar zie je de lucht.
   */
  vel(s, g) {
    const N = vel(kwaliteit(g));
    if (s.vellen[N]) return s.vellen[N];
    const cel = 2 * Math.min(g.W, g.H) / N, lx = Math.max(1, Math.round(g.W / cel)), ly = Math.max(1, Math.round(g.H / cel));
    const lg = rooster(g, { nx: lx, ny: ly });
    lg.px.fill(LUTS.fosfor[0]);                            // onder het vel: dekkend, anders schemert het vorige beeld door de zachte rand
    return (s.vellen[N] = { DC: drumCache(N), g: rooster(g, { nx: N, ny: N }), LC: luchtCache(lx, ly, g.W, g.H), lg });
  },
  strike(s, p, rs, th, g) {
    const oud = s.hist.pop();                              // de oudste wordt de vorige: geen allocatie
    oud.a.set(s.a); oud.b.set(s.b); oud.tau.set(s.tau); oud.t0 = s.t0; s.hist.unshift(oud);
    const t = g.t, dt = t - s.t0, f0 = mtof(midiFrom(grondtoon(g) - 12, Math.round(p.toon), ladder(g)));
    for (let k = 0; k < 16; k++) {
      const [m, j] = DRUM[k], ratio = j / DRUM[0][1], dec = Math.exp(-dt / s.tau[k]) * Math.cos(TAU * 0.8 * ratio * dt);
      const c = besselJ(m, j * rs) / RMAX[k] * Math.exp(-(ratio - 1) * (1 - p.hard) * 1.3), tau = p.damp * 1.2 / Math.pow(ratio, 0.8);
      s.a[k] = s.a[k] * dec * 0.5 + c * Math.cos(m * th); s.b[k] = s.b[k] * dec * 0.5 + c * Math.sin(m * th); s.tau[k] = tau;
      s.fr[k] = f0 * ratio; s.am[k] = Math.abs(c); s.ta[k] = tau * 0.7;
    }
    s.t0 = t; s.e.slag = 1;
    if (s.hit) { s.hit.x = rs * Math.cos(th); s.hit.y = rs * Math.sin(th); s.hit.t = t; } else s.hit = { x: rs * Math.cos(th), y: rs * Math.sin(th), t };
    if (klinkt(g)) playBuf(g.geluid, modalBuffer(g.geluid.ctx, s.fr, s.am, s.ta, Math.min(4, s.ta[0] * 5), 0.25 * p.hard, s.gr), p.vol, rs * Math.cos(th) * 0.5);
  },
  act: { slaan(s, p, g) { TV.strike(s, p, p.rad, g.r() * TAU, g); } },
  pointer(s, p, x, y, down, g) {
    if (!down) return;
    const { cx, cy, kort } = midden(g), u = (x * g.W - cx) / (kort / 2), v = (y * g.H - cy) / (kort / 2);
    this.strike(s, p, Math.min(0.95, Math.hypot(u, v)), Math.atan2(v, u), g);
  },
  /**
   * De coëfficiënten van de lucht voor één slag (a, b, tau, t0) op tijd t,
   * per uitstralende modus vier: omhulling × (a, b) × (cos, sin) van de fase
   * die het vel NU heeft. De lucht op afstand ρ krijgt daarbij −κρ uit de
   * tabel, dus een golf die met LUCHT_C naar buiten loopt.
   */
  luchtCoef(uit, o, a, b, tau, t0, t) {
    const dt = t - t0;
    for (let j = 0; j < LUCHT_MODI.length; j++, o += 4) {
      const k = LUCHT_MODI[j], w = TAU * 0.8 * (DRUM[k][1] / DRUM[0][1]) * dt, e = Math.exp(-dt / tau[k]), c = Math.cos(w) * e, sn = Math.sin(w) * e;
      uit[o] = a[k] * c; uit[o + 1] = a[k] * sn; uit[o + 2] = b[k] * c; uit[o + 3] = b[k] * sn;
    }
  },
  step(s, p, g) {
    const t = g.t;
    if (s.tl != null && t < s.tl) {                         // de ring en de eerdere slagen schuiven mee terug
      if (s.hit) s.hit.t += t - s.tl;
      for (const h of s.hist) if (h.t0) h.t0 += t - s.tl;
    }
    volgKlok(s, t, ['t0', 'next']);
    if (p.auto > 0 && t >= s.next) {
      if (s.next) this.strike(s, p, Math.min(0.95, Math.max(0, p.rad + (g.r() - 0.5) * 0.2)), g.r() * TAU, g);
      s.next = t + (1 / p.auto) * (0.6 + g.r() * 0.8);
    }
    const { DC, g: gr, LC, lg } = this.vel(s, g), dt = t - s.t0, A = s.A, B = s.B;
    let E = 0, ER = 0;
    for (let k = 0; k < 16; k++) {
      const ratio = DRUM[k][1] / DRUM[0][1], e = Math.exp(-dt / s.tau[k]), c = e * Math.cos(TAU * 0.8 * ratio * dt);
      A[k] = s.a[k] * c; B[k] = s.b[k] * c;
      const en = (s.a[k] ** 2 + s.b[k] ** 2) * e * e;
      E += en; ER += en * ratio;
    }
    const L = g.L;
    // De lucht. Slag i (0 = de laatste) geldt tot zijn front, op afstand
    // LUCHT_C × zijn leeftijd; daarachter de slag ervoor. De cellen liggen
    // op afstand gesorteerd, dus één keer doorlopen. Rond elk front een band
    // van ±LUCHT_BAND waarin de twee slagen overvloeien.
    {
      const lpx = lg.px, idx = LC.idx, rho = LC.rho, P = LC.P, NL4 = LC.NL * 4, n = idx.length, fel = 120 * LUCHT_FEL;
      const NH = 1 + LUCHT_GESCHIEDENIS, c = s.lc, F = s.front;
      this.luchtCoef(c, 0, s.a, s.b, s.tau, s.t0, t); F[0] = LUCHT_C * (t - s.t0);
      for (let h = 1; h < NH; h++) {
        const o = s.hist[h - 1];
        this.luchtCoef(c, h * NL4, o.a, o.b, o.tau, o.t0, t); F[h] = Math.max(F[h - 1], LUCHT_C * (t - o.t0));
      }
      let h = 0;                                            // de oudste slag die we kennen (NH − 1) geldt tot het eind
      for (let q = 0; q < n; q++) {
        const r = rho[q], o = q * NL4;
        while (h < NH - 1 && r >= F[h]) h++;
        let z = luchtSom(c, h * NL4, P, o, NL4);
        if (h < NH - 1 && r > F[h] - LUCHT_BAND) { const w = zacht((r - F[h] + LUCHT_BAND) / (2 * LUCHT_BAND)); z = z * (1 - w) + luchtSom(c, (h + 1) * NL4, P, o, NL4) * w; }
        else if (h > 0 && r < F[h - 1] + LUCHT_BAND) { const w = zacht((r - F[h - 1] + LUCHT_BAND) / (2 * LUCHT_BAND)); z = luchtSom(c, (h - 1) * NL4, P, o, NL4) * (1 - w) + z * w; }
        lpx[idx[q]] = L[Math.max(0, Math.min(255, 128 + z * fel | 0))];
      }
    }
    blit(lg, g);                                             // over het hele doek, zacht
    // Het vel, vierkant in het midden; buiten de cirkel doorzichtig.
    const px = gr.px, np = DC.idx.length, C = DC.C, Sn = DC.S;
    for (let q = 0; q < np; q++) {
      let z = 0;
      for (let k = 0; k < 16; k++) z += A[k] * C[k][q] + B[k] * Sn[k][q];
      px[DC.idx[q]] = L[Math.max(0, Math.min(255, 128 + z * 120 | 0))];
    }
    const { cx, cy, kort, vak } = midden(g);
    blit(gr, g, false, vak);
    const ctx = g.ctx, D = g.D, R = kort / 2 * (DC.N - 1) / DC.N;
    ctx.strokeStyle = 'rgba(201,211,230,.35)'; ctx.lineWidth = 1.5 * D; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    if (s.hit) {
      const a = t - s.hit.t;
      if (a < 1) { ctx.strokeStyle = `rgba(238,161,60,${1 - a})`; ctx.beginPath(); ctx.arc(cx + s.hit.x * R, cy + s.hit.y * R, (4 + a * 30) * D, 0, TAU); ctx.stroke(); }
    }
    s.E = E; s.ER = E > 1e-6 ? ER / E : 1;
    s.o.energie = cl01(Math.sqrt(s.E) * 1.5); s.o.helderheid = cl01((s.ER - 1) / 3.8);
  },
};

const SPOOR = 240;
const EP = {
  id: 'ep', naam: 'Epicykels', sub: 'Fourier · XY-oscilloscoop', cat: 'Isomorf', pal: 'iris',
  knobs: [SEL('f', 'vorm', ['Ster', 'Hart', 'Vierkant', 'Lemniscaat', 'Roos', 'Klaver'], 0, { re: 1 }), K('K', 'cirkels', 1, 48, 1, 12),
    K('toon', 'toon (trap)', 0, 10, 1, 2), K('sp', 'draaisnelheid', 0.02, 0.5, 0.005, 0.1, { fix: 1 }), VOL(0.5)],
  presets: [['Zacht', { K: 3 }], ['Ster', { f: 0, K: 12 }], ['Hart', { f: 1, K: 20 }], ['Scherp', { f: 2, K: 48 }], ['Klaver', { f: 5, K: 8 }]],
  outs: ['x', 'y', 'fase', 'complexiteit'], events: ['rond'],
  init(s, p) {
    s.fi = p.f | 0; s.ph = 0; s.lt = null; s.tip = [0, 0];
    s.ghost = new Float32Array(2 * 301); s.tr = new Float32Array(2 * SPOOR); s.trN = 0; s.trI = 0;
    s.au = null;
    this.load(s, epShape(s.fi));
  },
  load(s, pts) { s.list = fourier(pts); s.waveK = -1; s.ghostK = -1; s.trN = 0; s.trI = 0; },
  act: { volgende(s) { s.fi = (s.fi + 1) % 6; EP.load(s, epShape(s.fi)); } },
  // Tekenen gaat in eenheden van de halve korte zijde rond het midden: een
  // cirkel op het scherm blijft een cirkel (x * 2 - 1 zou hem 16:9 platdrukken).
  pointer(s, p, x, y, down, g) {
    if (down) s.draw = [];
    if (!s.draw) return;
    const { cx, cy, kort } = midden(g);
    s.draw.push([(x * g.W - cx) / (kort / 2), (y * g.H - cy) / (kort / 2)]);
  },
  pointerUp(s) { if (s.draw && s.draw.length > 12) this.load(s, resample(s.draw, 256)); s.draw = null; },
  /** Twee oscillatoren (L = x, R = y) op de sink; pas als hij speelt. */
  ensure(s, g) {
    if (s.au && s.au.sink !== g.geluid) this.stop(s);    // andere sink (of weg): opnieuw
    if (s.au || !klinkt(g)) return;
    const sink = g.geluid, C = sink.ctx, oL = C.createOscillator(), oR = C.createOscillator(), m = C.createChannelMerger(2), gn = C.createGain();
    gn.gain.value = 0;
    oL.connect(m, 0, 0); oR.connect(m, 0, 1); m.connect(gn); gn.connect(sink.uit); oL.start(); oR.start();
    s.au = { sink, oL, oR, m, g: gn, vol: -1, toon: -1 }; s.waveK = -1;
  },
  wave(s, K) {
    const list = s.list.slice(0, K);
    let H = 1;
    list.forEach((c) => { H = Math.max(H, Math.abs(c.n)); });
    const rx = new Float32Array(H + 1), ix = new Float32Array(H + 1), ry = new Float32Array(H + 1), iy = new Float32Array(H + 1);
    list.forEach(({ n, re, im }) => { const h = Math.abs(n), sg = n > 0 ? 1 : -1; rx[h] += re; ix[h] += -im * sg; ry[h] += im; iy[h] += re * sg; });
    const C = s.au.sink.ctx;
    s.au.oL.setPeriodicWave(C.createPeriodicWave(rx, ix)); s.au.oR.setPeriodicWave(C.createPeriodicWave(ry, iy)); s.waveK = K;
  },
  /** Stil (of weer aan) zonder op te ruimen: voor een laag die uit gaat. */
  gate(s, p, on, g) {
    if (!s.au) return;
    const C = s.au.sink.ctx, v = on && g && klinkt(g) ? p.vol * 0.3 : 0;
    if (v === s.au.vol) return;
    s.au.g.gain.setTargetAtTime(v, C.currentTime, 0.08); s.au.vol = v;
  },
  /** Oscillatoren stoppen en losmaken: bij een ander systeem of een andere sink. */
  stop(s) {
    if (!s.au) return;
    const { oL, oR, m, g } = s.au;
    try { oL.stop(); oR.stop(); } catch { /* al gestopt */ }
    oL.disconnect(); oR.disconnect(); m.disconnect(); g.disconnect();
    s.au = null;
  },
  /**
   * Wat je HOORT, naast wat je ziet: links kanaal L (= x), rechts kanaal R
   * (= y), als oscilloscoop over één hele omwenteling, het nieuwste punt bij
   * de figuur en het oudste aan de rand. Gelezen uit de geest (dezelfde K
   * cirkels, 301 punten per omwenteling) met lineaire interpolatie: geen
   * tweede Fourier-som, en de golf schuift glad, ook als hij langzaam draait.
   * De hoogte is dezelfde schaal als de figuur. Minder kwaliteit = minder punten.
   * Geen ruimte naast de figuur (een doek dat niet breed is): niets.
   */
  kanalen(s, g, cx, cy, kort, sc) {
    const ctx = g.ctx, D = g.D, gh = s.ghost, rand = g.H * 0.06, binnen = kort * 0.47;
    const breed = cx - binnen - rand;
    if (breed < 8 * D) return;
    const n = Math.max(24, Math.round(96 * kwaliteit(g))), delen = 4, ALPHA = [0.75, 0.5, 0.3, 0.14];
    ctx.strokeStyle = 'rgba(201,211,230,.08)'; ctx.lineWidth = D; ctx.beginPath();
    ctx.moveTo(rand, cy); ctx.lineTo(cx - binnen, cy); ctx.moveTo(cx + binnen, cy); ctx.lineTo(g.W - rand, cy);
    ctx.stroke();
    ctx.lineWidth = 1.4 * D; ctx.strokeStyle = pcol(g.pal, 0.72);
    for (const kant of [-1, 1]) {                          // -1 = links (L, x), 1 = rechts (R, y)
      const c = kant < 0 ? 0 : 1, x0 = cx + kant * binnen;
      let deel = 0;
      ctx.globalAlpha = ALPHA[0]; ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n, f = (((s.ph - u) % 1) + 1) % 1 * 300, i0 = Math.min(299, f | 0), fr = f - i0;
        const v = gh[2 * i0 + c] * (1 - fr) + gh[2 * i0 + 2 + c] * fr, X = x0 + kant * u * breed, Y = cy + v * sc;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        if (i < n && (i + 1) * delen > (deel + 1) * n) {   // grens van een deel: afmaken en zachter verder
          ctx.stroke(); deel++; ctx.globalAlpha = ALPHA[deel]; ctx.beginPath(); ctx.moveTo(X, Y);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  step(s, p, g) {
    // s.lt == null i.p.v. het origineel `s.lt || t`: de audioklok begint op 0.
    const t = g.t, dt = Math.max(0, Math.min(0.1, t - (s.lt ?? t)));   // terug in de tijd: stilstaan, niet achteruit
    s.lt = t;
    const K = Math.max(1, Math.min(s.list.length, Math.round(p.K)));
    this.ensure(s, g);
    if (s.au) {
      if (!klinkt(g)) this.gate(s, p, false, g);
      else {
        if (K !== s.waveK && t - (s.wt || 0) > 0.08) { this.wave(s, K); s.wt = t; }
        const toon = Math.round(p.toon), C = s.au.sink.ctx;
        if (toon !== s.au.toon) {
          const f = mtof(midiFrom(grondtoon(g) - 12, toon, ladder(g)));
          s.au.oL.frequency.setTargetAtTime(f, C.currentTime, 0.05); s.au.oR.frequency.setTargetAtTime(f, C.currentTime, 0.05); s.au.toon = toon;
        }
        this.gate(s, p, true, g);
      }
    }
    const ph0 = s.ph;
    s.ph += dt * p.sp;
    if (Math.floor(s.ph) !== Math.floor(ph0)) s.e.rond = 1;
    const gh = s.ghost;
    if (K !== s.ghostK) {
      for (let i = 0; i <= 300; i++) {
        const a = i / 300 * TAU;
        let x = 0, y = 0;
        for (let k = 0; k < K; k++) { const c = s.list[k]; x += c.re * Math.cos(c.n * a) - c.im * Math.sin(c.n * a); y += c.re * Math.sin(c.n * a) + c.im * Math.cos(c.n * a); }
        gh[2 * i] = x; gh[2 * i + 1] = y;
      }
      s.ghostK = K; s.trN = 0; s.trI = 0;
    }
    clear(g);
    // De figuur rond het midden, op de korte zijde (heel in beeld); links en
    // rechts ervan de twee kanalen als golfvorm.
    const ctx = g.ctx, D = g.D, { cx, cy, kort } = midden(g), sc = kort * 0.36, a = s.ph * TAU;
    this.kanalen(s, g, cx, cy, kort, sc);
    ctx.strokeStyle = 'rgba(201,211,230,.14)'; ctx.lineWidth = D; ctx.beginPath();
    for (let i = 0; i <= 300; i++) { const X = cx + gh[2 * i] * sc, Y = cy + gh[2 * i + 1] * sc; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.stroke();
    let x = 0, y = 0;
    ctx.lineWidth = 0.8 * D;
    for (let k = 0; k < K; k++) {
      const c = s.list[k], r = Math.hypot(c.re, c.im), nx = x + c.re * Math.cos(c.n * a) - c.im * Math.sin(c.n * a), ny = y + c.re * Math.sin(c.n * a) + c.im * Math.cos(c.n * a);
      if (r * sc > 0.6) { ctx.strokeStyle = `rgba(226,123,208,${0.12 + 0.3 * (1 - k / K)})`; ctx.beginPath(); ctx.arc(cx + x * sc, cy + y * sc, r * sc, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(251,232,243,.55)'; ctx.beginPath(); ctx.moveTo(cx + x * sc, cy + y * sc); ctx.lineTo(cx + nx * sc, cy + ny * sc); ctx.stroke();
      x = nx; y = ny;
    }
    // Spoor: ringbuffer van SPOOR punten, oudste eerst. Bij lagere kwaliteit
    // gaan er meer stukjes in één lijn met één kleur (minder strokes).
    const tr = s.tr;
    tr[2 * s.trI] = x; tr[2 * s.trI + 1] = y;
    s.trI = (s.trI + 1) % SPOOR; if (s.trN < SPOOR) s.trN++;
    const n = s.trN, oud = (s.trI - n + SPOOR) % SPOOR, st = Math.max(1, Math.round(1 / kwaliteit(g)));
    ctx.lineWidth = 2 * D;
    for (let i = 1; i < n; i += st) {
      const e = Math.min(n - 1, i + st - 1);
      ctx.strokeStyle = pcol(g.pal, 0.3 + 0.7 * e / n); ctx.beginPath();
      let j = (oud + i - 1) % SPOOR;
      ctx.moveTo(cx + tr[2 * j] * sc, cy + tr[2 * j + 1] * sc);
      for (let q = i; q <= e; q++) { j = (oud + q) % SPOOR; ctx.lineTo(cx + tr[2 * j] * sc, cy + tr[2 * j + 1] * sc); }
      ctx.stroke();
    }
    ctx.fillStyle = '#fbe8f3'; ctx.beginPath(); ctx.arc(cx + x * sc, cy + y * sc, 3 * D, 0, TAU); ctx.fill();
    if (s.draw && s.draw.length > 1) {
      ctx.strokeStyle = '#eea13c'; ctx.lineWidth = 2 * D; ctx.beginPath();
      s.draw.forEach(([u, v], i) => { const X = cx + u * kort / 2, Y = cy + v * kort / 2; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    s.tip[0] = x; s.tip[1] = y;
    s.o.x = cl01(0.5 + x / 2); s.o.y = cl01(0.5 + y / 2); s.o.fase = s.ph % 1; s.o.complexiteit = cl01(p.K / 48);
  },
};

const DW = {
  id: 'dw', naam: 'Korrelwolk', sub: 'granulaire synthese · elk deeltje is een korrel', cat: 'Isomorf', pal: 'fosfor',
  knobs: [K('dens', 'korrels /s', 0, 50, 0.5, 14), K('mov', 'beweging', 0, 1, 0.01, 0.3), K('swirl', 'draaikolk', -1, 1, 0.01, 0.35),
    K('size', 'korrelgrootte', 0.03, 0.4, 0.005, 0.14), VOL(0.7)],
  presets: [['Mist', { dens: 30, mov: 0.15, swirl: 0.1, size: 0.3 }], ['Regen', { dens: 40, mov: 0.7, swirl: 0, size: 0.04 }],
    ['Draaikolk', { dens: 18, mov: 0.2, swirl: 0.9, size: 0.12 }], ['Stil', { dens: 4, mov: 0.1, swirl: 0.2, size: 0.35 }]],
  outs: ['hoogte', 'breedte', 'spreiding'], events: ['korrel'],
  /*
   * 16:9: s.x en s.y blijven FRACTIES van breedte en hoogte (0..1), want dat
   * is wat het geluid leest: x = plek in de korrelbuffer en panorama, y = toon.
   * De beweging rekent in echte eenheden (de hoogte = 1, de breedte = W / H):
   * duwtjes, draaikolk, veer naar het midden, demping en snelheid zijn in alle
   * richtingen gelijk, dus de wolk beweegt precies zoals vroeger op de korte
   * zijde en rekt niet uit. Beginnen en verstrooien gaan over het hele doek.
   * (Een zwakkere veer in x, zodat de wolk even breed blijft als het doek,
   * is geprobeerd: de draaikolk maakt er dan een draaiende staaf van, en
   * breder wordt hij er toch niet door.) Op een vierkant doek is alles zoals het was.
   */
  init(s, p, g) {
    const n = 80;
    s.n = n; s.x = new Float32Array(n).map(() => 0.2 + g.r() * 0.6); s.y = new Float32Array(n).map(() => 0.2 + g.r() * 0.6);
    s.vx = new Float32Array(n); s.vy = new Float32Array(n); s.f = new Float32Array(n); s.acc = 0; s.last = null;
    s.band = new Uint8Array(n);
  },
  pointer(s, p, x, y, down, g) { s.att = { x, y, t: g.t }; },
  /**
   * Korrel i laten klinken. Het beeld (flits) altijd; geluid alleen met een
   * sink die speelt én een korrelBuffer heeft. Het tijdsverloop (jitter)
   * wordt altijd getrokken, zodat het beeld niet afhangt van de sink.
   */
  emit(s, p, i, g) {
    s.f[i] = 1; s.e.korrel = 1;
    const jitter = g.r() * 0.03;
    const sink = g.geluid, buf = sink?.korrelBuffer;
    if (!klinkt(g) || !buf) return;
    const C = sink.ctx, bd = buf.duration, dur = p.size, t = C.currentTime + jitter;
    const rate = Math.pow(2, midiFrom(0, Math.round((1 - s.y[i]) * 14) - 7, ladder(g)) / 12), pos = Math.max(0, Math.min(bd - dur - 0.02, s.x[i] * (bd - dur - 0.02)));
    const src = C.createBufferSource(), gn = C.createGain(), pn = C.createStereoPanner();
    src.buffer = buf; src.playbackRate.value = rate;
    const amp = 0.45 / Math.sqrt(Math.max(1, p.dens * dur));
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(amp * p.vol, t + dur / 2); gn.gain.linearRampToValueAtTime(0, t + dur);
    pn.pan.value = s.x[i] * 1.6 - 0.8;
    src.connect(gn); gn.connect(pn); pn.connect(sink.uit); src.start(t, pos, dur + 0.02);
  },
  act: {
    uitbarsting(s, p, g) { for (let k = 0; k < 10; k++) DW.emit(s, p, g.r() * s.n | 0, g); },
    verstrooi(s, p, g) { for (let i = 0; i < s.n; i++) { s.x[i] = 0.05 + g.r() * 0.9; s.y[i] = 0.05 + g.r() * 0.9; } },
  },
  step(s, p, g) {
    const t = g.t, dt = Math.max(0, Math.min(0.05, t - (s.last ?? t)));
    s.last = t;
    if (s.att && s.att.t > t) s.att.t = t;
    const n = s.n, att = s.att && t - s.att.t < 0.4 ? s.att : null;
    const A = g.W / g.H, m = 0.02;                         // breedte in echte eenheden, rand (zoals vroeger 0,02)
    for (let i = 0; i < n; i++) {
      const X = s.x[i] * A, dx = X - A / 2, dy = s.y[i] - 0.5;
      let ax = (g.r() - 0.5) * p.mov * 3 - dy * p.swirl * 0.8 - dx * 0.15, ay = (g.r() - 0.5) * p.mov * 3 + dx * p.swirl * 0.8 - dy * 0.15;
      if (att) { ax += (att.x * A - X) * 4; ay += (att.y - s.y[i]) * 4; }
      s.vx[i] = (s.vx[i] + ax * dt) * 0.97; s.vy[i] = (s.vy[i] + ay * dt) * 0.97;
      // Eerst opslaan, dan de rand toetsen (op de Float32-waarde, zoals vroeger):
      // op een vierkant doek (A = 1) zo bit voor bit de oude beweging.
      s.x[i] = (X + s.vx[i] * dt) / A; s.y[i] += s.vy[i] * dt;
      if (s.x[i] * A < m) { s.x[i] = m / A; s.vx[i] *= -1; }
      if (s.x[i] * A > A - m) { s.x[i] = 1 - m / A; s.vx[i] *= -1; }
      if (s.y[i] < m) { s.y[i] = m; s.vy[i] *= -1; }
      if (s.y[i] > 1 - m) { s.y[i] = 1 - m; s.vy[i] *= -1; }
      s.f[i] *= 0.9;
    }
    s.acc += p.dens * dt;
    while (s.acc >= 1) { s.acc -= 1; this.emit(s, p, g.r() * n | 0, g); }
    clear(g);
    const ctx = g.ctx, W = g.W, H = g.H, D = g.D, kw = kwaliteit(g);
    // Acht stroken = acht stukken van de korrelbuffer (x), vijftien toonlijnen (y).
    ctx.fillStyle = 'rgba(45,86,212,.07)';
    for (let b = 1; b < 8; b += 2) ctx.fillRect(b * W / 8, 0, W / 8, H);
    // Toonlijnen: één pad (ze kruisen niet, dus hetzelfde beeld als vijftien strokes).
    ctx.strokeStyle = 'rgba(201,211,230,.07)'; ctx.lineWidth = D; ctx.beginPath();
    for (let l = 0; l <= 14; l++) { const y = H * (l / 14); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    if (kw >= 1) {
      for (let i = 0; i < n; i++) { ctx.fillStyle = pcol(g.pal, 0.45 + 0.5 * (1 - s.y[i])); ctx.beginPath(); ctx.arc(s.x[i] * W, s.y[i] * H, 2.3 * D, 0, TAU); ctx.fill(); }
    } else {
      // Grover: de kleur per band, één pad per band.
      const nb = Math.max(4, Math.round(16 * kw));
      for (let i = 0; i < n; i++) s.band[i] = Math.min(nb - 1, (1 - s.y[i]) * nb | 0);
      for (let b = 0; b < nb; b++) {
        ctx.fillStyle = pcol(g.pal, 0.45 + 0.5 * (b + 0.5) / nb); ctx.beginPath();
        for (let i = 0; i < n; i++) if (s.band[i] === b) { const X = s.x[i] * W, Y = s.y[i] * H; ctx.moveTo(X + 2.3 * D, Y); ctx.arc(X, Y, 2.3 * D, 0, TAU); }
        ctx.fill();
      }
    }
    for (let i = 0; i < n; i++) {
      if (s.f[i] > 0.05) { ctx.strokeStyle = `rgba(238,244,240,${s.f[i]})`; ctx.beginPath(); ctx.arc(s.x[i] * W, s.y[i] * H, (3 + (1 - s.f[i]) * 16) * D, 0, TAU); ctx.stroke(); }
    }
    if (att) { ctx.strokeStyle = 'rgba(238,161,60,.6)'; ctx.beginPath(); ctx.arc(att.x * W, att.y * H, 10 * D, 0, TAU); ctx.stroke(); }
    let mx = 0, my = 0, v = 0;
    for (let i = 0; i < n; i++) { mx += s.x[i]; my += s.y[i]; }
    mx /= n; my /= n;
    for (let i = 0; i < n; i++) v += (s.x[i] - mx) ** 2 + (s.y[i] - my) ** 2;
    s.o.hoogte = cl01(1 - my); s.o.breedte = cl01(mx); s.o.spreiding = cl01(Math.sqrt(v / n) * 3);
  },
};

export const SYSTEMEN_ISOMORF = [SN, TV, EP, DW];

/**
 * Draaiknoppen zonder sink: zoals `draaiKnoppen()` in systemen.js, maar ook
 * zonder knoppen die alleen het geluid raken (`geluid: 1`). Met sink gelijk
 * aan draaiKnoppen. Voorstel voor de hoofdsessie: die filter in draaiKnoppen
 * zelf, met `laag.g.geluid` als tweede argument.
 */
export function beeldKnoppen(sys, metGeluid = false, max = 6) {
  return sys.knobs.filter((k) => !k.sel && !k.re && (metGeluid || !k.geluid)).slice(0, max);
}
