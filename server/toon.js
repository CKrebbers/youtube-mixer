/**
 * Toonsoort per nummer: het rekenwerk. Puur, geen I/O; de FFT komt uit
 * detect.js. Lezen (ffmpeg, mono 4410 Hz) en de worker zitten in analyze.js.
 *
 * Overgenomen uit het meetinstrument `tools/toonsoort/toon.mjs`, met alleen de
 * keten die de meting koos (docs/TOONSOORT.md §2, beslissing T1): hpss+log,
 * profiel Temperley 2005, de gehusselde nul, een kaart met een stemming per
 * stuk. Zonder de varianten, de andere profielen en de oude tijd-nul. Het
 * rekenwerk is regel voor regel hetzelfde gebleven: toon.test legt de kaart
 * van deze module naast die van het instrument, getal voor getal. Wijk je
 * ervan af, verhoog dan TOON_VERSIE (en meet opnieuw). Eén veld is erbij
 * gekomen dat het instrument niet heeft: `tweede` per stuk (de tweede
 * kandidaat, uit dezelfde kies()); de vergelijking laat alleen dat veld weg.
 *
 * De keten:
 *   mono pcm op 4410 Hz
 *   -> FFT van 16384 (3,7 s, 0,27 Hz per bin: genoeg voor de lage octaven), hop 8192
 *   -> fijn log-spectrum in stapjes van 10 cent t.o.v. A = 440, en spectrale
 *      pieken voor de STEMMING (een plaat op A = 432 staat 32 cent laag)
 *   -> halvetoonspectrum 55–2000 Hz rond de stemming (cos²-kern, som 1)
 *   -> harmonisch/percussief (mediaan over tijd tegen mediaan over frequentie), log-compressie
 *   -> chroma (12 toonklassen) per frame
 *   -> correlatie met Temperley 2005, 24 sleutels; zekerheid tegen een geschudde nul
 *   -> een kaart in stukken (Viterbi over vensters van 24 s), per stuk een eigen stemming.
 */
import { fft } from './detect.js';

/**
 * Versie van de analyse. Staat in elke automatische kaart (`versie`). Wordt
 * het algoritme beter, verhoog dit getal: de server analyseert dan op de
 * achtergrond alle AUTOMATISCHE kaarten met een oudere versie opnieuw; wat
 * met de hand gezet is of op slot staat blijft (library.js, moetToonAnalyse).
 *
 * `tweede` (25 sep) kwam erbij zonder ophogen: de keuze van de toonsoort bleef
 * bit voor bit gelijk, en er bestond nog geen library met kaarten (Clay's
 * database stond op schema v5, zonder toon_json). Een kaart van vóór `tweede`
 * mist alleen de tweede kandidaat in de tooltip; ↻ in de library geeft hem.
 */
export const TOON_VERSIE = 1;

/** Samplerate waarop de toonsoort gelezen wordt (ROADMAP "Toonsoort"). */
export const TOON_SR = 4410;

// ---- namen -------------------------------------------------------------------

/**
 * Sleutel k: 0..11 = majeur op toonklasse k (C = 0), 12..23 = mineur op k - 12.
 * Opslag in een VASTE spelling (docs/TOONSOORT.md §3), `m` erachter voor
 * mineur: leesbaar, en Camelot en de Nederlandse naam volgen eruit.
 */
export const SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Sleutel 0..23 -> 'C', 'F#m', 'Bbm'; null -> null. */
export const toonsoortNaam = (k) => (k == null ? null : k >= 12 ? `${SPELLING[k - 12]}m` : SPELLING[k]);

/**
 * 'C', 'F#m', 'Bbm' -> sleutel 0..23, anders null. Een andere schrijfwijze van
 * dezelfde toon mag ('C#' = 'Db', 'G#m' = 'Abm'); wat terugkomt is altijd de
 * vaste spelling (toonsoortNaam). Geen 'mineur', geen ♯/♭: dit is de opslag.
 */
export function leesToonsoort(s) {
  const m = /^([A-G])(#|b)?(m)?$/.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const basis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const t = (basis + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return m[3] ? 12 + t : t;
}

const isMineur = (k) => k >= 12;
const tonica = (k) => k % 12;

/** Camelot-getal 1..12: majeur C = 8B, elke kwint omhoog +1; mineur = die van zijn relatieve majeur. */
export function camelotGetal(k) {
  const t = isMineur(k) ? (tonica(k) + 3) % 12 : k;
  return ((7 * t) % 12 + 7) % 12 + 1;
}
export const camelot = (k) => (k == null ? '-' : `${camelotGetal(k)}${isMineur(k) ? 'A' : 'B'}`);

// ---- het profiel -------------------------------------------------------------

/*
 * Temperley 2005 (MIREX), kansen uit het Kostka-Payne-corpus; waarden uit
 * Essentia, src/algorithms/tonal/key.cpp. Tonica eerst. Gekozen boven edma en
 * Krumhansl (docs/TOONSOORT.md §1): die kiezen op piano de kwint erboven, want
 * elke noot telt in een chroma via zijn derde harmonische ook een kwint hoger mee.
 */
const TEMPERLEY05 = {
  maj: [0.748, 0.060, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4],
  min: [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33],
};

function zNorm(v) {
  let m = 0;
  for (const x of v) m += x;
  m /= v.length;
  let s = 0;
  const u = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) { u[i] = v[i] - m; s += u[i] * u[i]; }
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) u[i] /= s;
  return u;
}

/** De 24 gedraaide profielen, genormaliseerd (gemiddelde 0, norm 1): correleren = een inproduct. */
const PROFIEL = (() => {
  const uit = [];
  for (const basis of [TEMPERLEY05.maj, TEMPERLEY05.min]) {
    for (let t = 0; t < 12; t++) {
      const v = new Float64Array(12);
      for (let i = 0; i < 12; i++) v[(i + t) % 12] = basis[i];
      uit.push(zNorm(v));
    }
  }
  return uit;
})();

/** Pearson-correlatie van een chroma (12 waarden) met alle 24 sleutels. */
export function correlaties(chroma) {
  const c = zNorm(chroma);
  const r = new Float64Array(24);
  for (let k = 0; k < 24; k++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += c[i] * PROFIEL[k][i];
    r[k] = s;
  }
  return r;
}

/**
 * Beste sleutel, de tweede, en de beste met een ANDER Camelot-getal.
 * Relatief majeur/mineur (8A/8B) delen hun tonen: voor mixen maakt die
 * verwarring niets uit, dus de marge die telt is die tot een ander getal.
 */
function kies(r) {
  let best = 0;
  for (let k = 1; k < 24; k++) if (r[k] > r[best]) best = k;
  let tweede = -1, ander = -1;
  const g = camelotGetal(best);
  for (let k = 0; k < 24; k++) {
    if (k === best) continue;
    if (tweede < 0 || r[k] > r[tweede]) tweede = k;
    if (camelotGetal(k) !== g && (ander < 0 || r[k] > r[ander])) ander = k;
  }
  return { k: best, r: r[best], k2: tweede, r2: r[tweede], kAnder: ander, rAnder: r[ander],
    marge: r[best] - r[tweede], margeAnder: r[best] - r[ander] };
}

// ---- spectrum -> halvetoonspectrum -------------------------------------------

/** De gekozen keten (docs/TOONSOORT.md §2). */
export const STANDAARD = {
  N: 16384,         // FFT-lengte (op 4410 Hz: 3,7 s, 0,27 Hz per bin; bij A1 is een halve toon 3,3 Hz)
  hop: 8192,        // 1,86 s; gemeten tegen 4096: dezelfde uitkomsten, de helft van de rekentijd
  fftMin: 27.5,     // fijn spectrum en energie vanaf A0
  fmin: 55,         // halve tonen vanaf A1: eronder vooral gerommel en kick
  fmax: 2000,       // net onder de rolloff van ffmpeg's hersampler op 4410 Hz
  cent: 10,         // fijn raster voor de stemming
  venster: 24,      // kaart: vensters van 24 s ...
  stap: 6,          // ... om de 6 s
  wissel: 1.2,      // straf per wissel in de Viterbi (0,35 gaf 66 grenzen voor 30 echte)
  minSec: 24,       // korter stuk gaat op in de langste buur
};

const hannCache = new Map();
function hann(n) {
  if (!hannCache.has(n)) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    hannCache.set(n, w);
  }
  return hannCache.get(n);
}

/**
 * Eén doorloop met de FFT. Per frame een FIJN log-spectrum (stapjes van
 * `cent` t.o.v. A = 440, amplitude lineair verdeeld over de twee buren), en
 * per frame een fasor voor de stemming uit de spectrale pieken.
 *
 * De stemming: elke piek (lokaal maximum, parabolisch geïnterpoleerd, boven
 * 4x het gemiddelde van zijn omgeving, boven 100 Hz) geeft zijn afwijking in
 * cent t.o.v. het 440-raster, modulo 100, als hoek op een cirkel. Het gewogen
 * gemiddelde van die hoeken is de stemming. Op een cirkel, want -49 en +49
 * cent liggen naast elkaar (bijna een halve toon), niet ver uit elkaar. Per
 * frame bewaard: een album of mix heeft per nummer een eigen A.
 */
export function spectrum(pcm, sr) {
  const { N, hop, fftMin: fmin, fmax, cent } = STANDAARD;
  const frames = pcm.length >= N ? Math.floor((pcm.length - N) / hop) + 1 : (pcm.length > N / 4 ? 1 : 0);
  const kLo = Math.max(1, Math.floor(fmin * 0.94 * N / sr));
  const kHi = Math.min(N / 2 - 2, Math.ceil(fmax * 1.06 * N / sr));
  // Fijn raster: index j = (cent t.o.v. 440 - c0) / cent.
  const c0 = Math.floor(1200 * Math.log2((fmin * 0.94) / 440) / cent) * cent;
  const c1 = Math.ceil(1200 * Math.log2((fmax * 1.06) / 440) / cent) * cent;
  const bins = (c1 - c0) / cent + 1;
  const binJ = new Int32Array(kHi + 1), binF = new Float32Array(kHi + 1);
  for (let k = kLo; k <= kHi; k++) {
    const j = (1200 * Math.log2((k * sr / N) / 440) - c0) / cent;
    binJ[k] = Math.floor(j); binF[k] = j - Math.floor(j);
  }
  const fijn = new Float32Array(frames * bins);
  const energie = new Float32Array(frames);
  const w = hann(N);
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(kHi + 2);
  let tRe = 0, tIm = 0, tSom = 0;
  const stemRe = new Float32Array(frames), stemIm = new Float32Array(frames), stemW = new Float32Array(frames);
  // Stemming alleen uit het bereik waar een bin ruim kleiner is dan een paar cent.
  const kStem = Math.max(kLo + 2, Math.ceil(100 * N / sr));
  for (let f = 0; f < frames; f++) {
    const r0 = tRe, i0 = tIm, w0 = tSom;
    const s = f * hop;
    for (let i = 0; i < N; i++) { const x = pcm[s + i]; re[i] = x === undefined ? 0 : x * w[i]; im[i] = 0; }
    fft(re, im);
    let e = 0;
    for (let k = kLo - 1; k <= kHi + 1; k++) { const m = Math.hypot(re[k], im[k]); mag[k] = m; }
    const rij = f * bins;
    for (let k = kLo; k <= kHi; k++) {
      const m = mag[k], j = binJ[k], a = binF[k];
      e += m * m;
      if (j >= 0 && j < bins) fijn[rij + j] += m * (1 - a);
      if (j + 1 >= 0 && j + 1 < bins) fijn[rij + j + 1] += m * a;
    }
    energie[f] = e;
    // Pieken voor de stemming; omgeving = 64 bins (17 Hz) aan elke kant.
    let lopend = 0; const R = 64;
    for (let k = kStem - R; k <= kStem + R; k++) lopend += mag[Math.min(kHi, Math.max(kLo, k))];
    for (let k = kStem; k < kHi - 1; k++) {
      const m = mag[k];
      if (m > mag[k - 1] && m >= mag[k + 1] && m > 4 * lopend / (2 * R + 1)) {
        const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mag[k + 1] + 1e-12);
        const d = a - 2 * b + c;
        const p = d < 0 ? 0.5 * (a - c) / d : 0;
        const fr = (k + p) * sr / N;
        const afw = 1200 * Math.log2(fr / 440);
        const hoek = 2 * Math.PI * (afw / 100);
        tRe += m * Math.cos(hoek); tIm += m * Math.sin(hoek); tSom += m;
      }
      lopend += mag[Math.min(kHi, k + R + 1)] - mag[Math.max(kLo, k - R)];
    }
    stemRe[f] = tRe - r0; stemIm[f] = tIm - i0; stemW[f] = tSom - w0;
  }
  const stemming = Math.atan2(tIm, tRe) / (2 * Math.PI) * 100;
  return { fijn, bins, frames, frameRate: sr / hop, c0, cent, stemming,
    stemmingR: tSom > 0 ? Math.hypot(tRe, tIm) / tSom : 0, stemRe, stemIm, stemW, energie };
}

/** Stemming (cent, -50..50) en helderheid R over frames [van, tot). */
function stemmingVan(sp, van = 0, tot = sp.frames) {
  let re = 0, im = 0, w = 0;
  for (let f = Math.max(0, van); f < Math.min(sp.frames, tot); f++) { re += sp.stemRe[f]; im += sp.stemIm[f]; w += sp.stemW[f]; }
  return { cent: Math.atan2(im, re) / (2 * Math.PI) * 100, R: w > 0 ? Math.hypot(re, im) / w : 0 };
}

/**
 * Halvetoonspectrum rond de stemming (cent): halve toon m (t.o.v. A4, dus
 * MIDI - 69) krijgt de fijne bins binnen één halve toon, gewogen met
 * cos²(π/2 · d). Twee buren tellen samen op tot 1, dus niets wordt dubbel
 * geteld. `van`/`tot`: alleen die frames (voor de stemming per stuk).
 */
function halveTonen(sp, stemming, { van = 0, tot = sp.frames } = {}) {
  const { fmin, fmax } = STANDAARD;
  const { fijn, bins, c0, cent } = sp;
  const frames = Math.max(0, Math.min(sp.frames, tot) - van);
  // Het rooster zelf ligt vast (t.o.v. 440); de stemming schuift alleen welke fijne bin waar valt.
  const mLo = Math.ceil(12 * Math.log2(fmin / 440));
  const mHi = Math.floor(12 * Math.log2(fmax / 440));
  const halve = mHi - mLo + 1;
  // Per fijne bin: naar welke halve toon, met welk gewicht (twee buren).
  const lijst = [];
  for (let j = 0; j < bins; j++) {
    const c = c0 + j * cent;                   // cent t.o.v. 440
    const m = (c - stemming) / 100;            // halve tonen t.o.v. A4 in deze stemming
    const m0 = Math.floor(m), d = m - m0;
    const w0 = Math.cos(0.5 * Math.PI * d) ** 2, w1 = 1 - w0;
    if (m0 >= mLo && m0 <= mHi) lijst.push(j, m0 - mLo, w0);
    if (m0 + 1 >= mLo && m0 + 1 <= mHi) lijst.push(j, m0 + 1 - mLo, w1);
  }
  const S = new Float32Array(frames * halve);
  for (let f = 0; f < frames; f++) {
    const a = (van + f) * bins, b = f * halve;
    for (let i = 0; i < lijst.length; i += 3) S[b + lijst[i + 1]] += fijn[a + lijst[i]] * lijst[i + 2];
  }
  return { S, halve, mLo, frames };
}

// ---- harmonisch, compressie -> chroma ----------------------------------------

function mediaan(buf, n) {
  // Kleine n (≤ 9): insertion sort op een kopie.
  for (let i = 1; i < n; i++) { const x = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > x) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = x; }
  return n & 1 ? buf[n >> 1] : 0.5 * (buf[(n >> 1) - 1] + buf[n >> 1]);
}

const HPSS_T = 2, HPSS_F = 4, GAMMA = 10;

/**
 * Van halvetoonspectrum naar chroma per frame.
 * - Harmonisch masker H²/(H²+P²), H = mediaan over ±2 frames (een toon die
 *   blijft staan), P = mediaan over ±4 halve tonen (een klap is breed).
 *   Fitzgerald 2010, op het halvetoonrooster: goedkoop.
 * - Log-compressie log1p(10·x/ref), ref = mediaan van de frame-maxima (de
 *   luidheid van DIT stuk): een luide basnoot overheerst de chroma minder.
 * Geeft { C: Float32Array(frames * 12) }.
 */
function chroma(hs) {
  const { S, halve, mLo, frames } = hs;
  let X = S;
  if (frames > 1) {
    X = new Float32Array(S.length);
    const buf = new Float32Array(Math.max(2 * HPSS_T + 1, 2 * HPSS_F + 1));
    for (let f = 0; f < frames; f++) {
      for (let m = 0; m < halve; m++) {
        let n = 0;
        for (let g = Math.max(0, f - HPSS_T); g <= Math.min(frames - 1, f + HPSS_T); g++) buf[n++] = S[g * halve + m];
        const H = mediaan(buf, n);
        n = 0;
        for (let q = Math.max(0, m - HPSS_F); q <= Math.min(halve - 1, m + HPSS_F); q++) buf[n++] = S[f * halve + q];
        const P = mediaan(buf, n);
        const h2 = H * H, p2 = P * P;
        X[f * halve + m] = h2 + p2 > 0 ? S[f * halve + m] * h2 / (h2 + p2) : 0;
      }
    }
  }
  const maxima = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let mx = 0; for (let m = 0; m < halve; m++) mx = Math.max(mx, X[f * halve + m]); maxima[f] = mx; }
  const s = Array.from(maxima).sort((a, b) => a - b);
  const ref = s[Math.floor(0.5 * (s.length - 1))] || 1e-9;
  const C = new Float32Array(frames * 12);
  const klasse = new Int32Array(halve);
  for (let m = 0; m < halve; m++) klasse[m] = (((69 + mLo + m) % 12) + 12) % 12;
  for (let f = 0; f < frames; f++) {
    for (let m = 0; m < halve; m++) C[f * 12 + klasse[m]] += Math.log1p(GAMMA * X[f * halve + m] / ref);
  }
  return { C };
}

/** Frames die meetellen: niet stil (energie boven -45 dB t.o.v. p95 van de track). */
function nietStil(energie, db = 45) {
  const s = Array.from(energie).sort((a, b) => a - b);
  const p95 = s[Math.floor(0.95 * (s.length - 1))] || 0;
  const grens = p95 * 10 ** (-db / 10);
  const ok = new Uint8Array(energie.length);
  for (let f = 0; f < energie.length; f++) ok[f] = energie[f] > grens && energie[f] > 0 ? 1 : 0;
  return ok;
}

function somChroma(C, van, tot, ok = null) {
  const v = new Float64Array(12);
  for (let f = van; f < tot; f++) {
    if (ok && !ok[f]) continue;
    for (let i = 0; i < 12; i++) v[i] += C[f * 12 + i];
  }
  return v;
}

// ---- de nul en de zekerheid ----------------------------------------------------

function rndMet(zaad) {
  let s = zaad >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
}

/**
 * De geschudde nul, het equivalent van schudBlokken bij het grid.
 *
 * Tijd schudden helpt hier niet: een toonsoort is een SOM over de tijd, en
 * die verandert niet als je de volgorde husselt. Wat een toonsoort wel is:
 * een VORM over de twaalf toonklassen (zeven hoog, vijf laag, in de volgorde
 * van een toonladder). De nul houdt dezelfde twaalf waarden en zet ze in een
 * willekeurige volgorde: zelfde luidheid, zelfde piekerigheid, geen
 * toonladder. Correleert de echte chroma niet duidelijk beter met het profiel
 * dan zo'n husseling, dan is er geen toonsoort aan te wijzen (ruis, atonaal,
 * een drone zonder terts). Vast zaad: dezelfde audio geeft dezelfde kaart.
 */
function nulGehusseld(v, { proeven = 64, zaad = 4242 } = {}) {
  const rnd = rndMet(zaad);
  const uit = [];
  const w = Float64Array.from(v);
  for (let p = 0; p < proeven; p++) {
    for (let i = 11; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = w[i]; w[i] = w[j]; w[j] = t; }
    const kz = kies(correlaties(w));
    uit.push({ r: kz.r, margeAnder: kz.margeAnder });
  }
  return uit;
}

function kwantiel(a, q) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(q * (s.length - 1))] : 0;
}

/**
 * Zekerheid 0..1 van één stuk = toon × beslist:
 * - `toon`: hoe ver de echte correlatie boven de p97 van de nul uitkomt,
 *   geschaald tot 1 (zoals het grid). Is er een toonladder?
 * - `beslist`: de marge tot de beste sleutel met een ANDER Camelot-getal,
 *   gedeeld door 0,15. Relatief majeur/mineur telt niet als twijfel (zelfde
 *   tonen, zelfde plek op de wijzer); C tegenover G wel.
 * Een duidelijke toonladder die niet van zijn buurman te onderscheiden is, is
 * voor mixen net zo weinig waard als geen.
 */
function zekerheid(kz, nul, { margeVol = 0.15 } = {}) {
  const gR = kwantiel(nul.map((x) => x.r), 0.97);
  const toon = Math.max(0, Math.min(1, (kz.r - gR) / Math.max(1e-6, 1 - gR)));
  const beslist = Math.max(0, Math.min(1, kz.margeAnder / margeVol));
  return { zekerheid: toon * beslist, toon, beslist, nulR97: gR };
}

/** Eén toonsoort voor frames [van, tot). */
export function toonsoortVan(C, van, tot, ok, opties = {}) {
  const v = somChroma(C, van, tot, ok);
  let som = 0;
  for (const x of v) som += x;
  if (!(som > 0)) return { k: null, zekerheid: 0, toon: 0, beslist: 0, reden: 'stil' };
  const r = correlaties(v);
  const kz = kies(r);
  return { ...kz, ...zekerheid(kz, nulGehusseld(v, opties), opties), chroma: v, r24: r };
}

// ---- de kaart ------------------------------------------------------------------

/**
 * Een toonsoortkaart: stukken { van, tot, k, zekerheid } in tracktijd.
 *
 * Vensters van 24 s om de 6 s; per venster de correlatie met de 24 sleutels;
 * toestand 24 = stilte. Viterbi zoekt het pad met de hoogste som min 1,2 per
 * verandering: één venster dat even afwijkt maakt geen stuk. Daarna per stuk
 * opnieuw: de sleutel uit de som van al zijn frames en een zekerheid tegen de
 * nul. Buren met dezelfde uitkomst gaan samen; een stuk korter dan 24 s gaat
 * op in de langste buur.
 */
function kaart(C, ok, frameRate) {
  const { venster, stap, wissel, minSec } = STANDAARD;
  const frames = C.length / 12;
  const W = Math.max(1, Math.round(venster * frameRate)), H = Math.max(1, Math.round(stap * frameRate));
  const starts = [];
  for (let a = 0; a + W <= frames || (!starts.length && a < frames); a += H) starts.push(a);
  if (!starts.length) return [];
  const G = 24;   // stilte
  /*
   * Score per venster = de correlatie zelf. "r min de p97 van de nul" met een
   * toestand "geen toonsoort" liet stille pianopassages aan weerszijden van
   * een nummergrens samensmelten tot één stuk over twee nummers (Sakamoto:
   * Rain + The Last Emperor). Nu kiest de kaart altijd een sleutel; "geen
   * duidelijke toonsoort" is een lage zekerheid van het stuk.
   */
  const score = starts.map((a) => {
    const b = Math.min(frames, a + W);
    let n = 0;
    for (let f = a; f < b; f++) if (ok[f]) n++;
    const e = new Float64Array(25);
    if (n < 0.5 * (b - a)) { e.fill(-1); e[G] = 1; return e; }
    const r = correlaties(somChroma(C, a, b, ok));
    for (let k = 0; k < 24; k++) e[k] = r[k];
    e[G] = -1;
    return e;
  });
  // Viterbi
  const T = starts.length;
  let vorige = Float64Array.from(score[0]);
  const terug = [];
  for (let t = 1; t < T; t++) {
    let bestV = 0;
    for (let k = 1; k < 25; k++) if (vorige[k] > vorige[bestV]) bestV = k;
    const nu = new Float64Array(25), tr = new Int8Array(25);
    for (let k = 0; k < 25; k++) {
      const blijf = vorige[k], wis = vorige[bestV] - wissel;
      if (blijf >= wis) { nu[k] = blijf + score[t][k]; tr[k] = k; } else { nu[k] = wis + score[t][k]; tr[k] = bestV; }
    }
    terug.push(tr); vorige = nu;
  }
  let k = 0;
  for (let q = 1; q < 25; q++) if (vorige[q] > vorige[k]) k = q;
  const pad = new Array(T);
  pad[T - 1] = k;
  for (let t = T - 1; t > 0; t--) { k = terug[t - 1][k]; pad[t - 1] = k; }

  // Pad -> stukken in frames. Grens = midden tussen de middens van twee vensters.
  const midden = (i) => starts[i] + W / 2;
  let stukken = [];
  let begin = 0;
  for (let t = 1; t <= T; t++) {
    if (t === T || pad[t] !== pad[begin]) {
      const van = begin === 0 ? 0 : Math.round((midden(begin - 1) + midden(begin)) / 2);
      const tot = t === T ? frames : Math.round((midden(t - 1) + midden(t)) / 2);
      stukken.push({ a: van, b: tot, k: pad[begin] === G ? null : pad[begin] });
      begin = t;
    }
  }
  const herreken = (sk) => {
    const n = sk.b - sk.a;
    let aan = 0;
    for (let f = sk.a; f < sk.b; f++) if (ok[f]) aan++;
    if (aan < 0.5 * n) return { ...sk, k: null, zekerheid: 0, stil: true };
    const t = toonsoortVan(C, sk.a, sk.b, ok, { proeven: 32 });
    return { ...sk, k: t.k, zekerheid: t.zekerheid, toon: t.toon, beslist: t.beslist, r: t.r, viterbiK: sk.k };
  };
  stukken = stukken.map(herreken);
  // Te korte stukken opgaan in een buur, dan buren met dezelfde sleutel samen.
  const minF = minSec * frameRate;
  for (let rond = 0; rond < 8; rond++) {
    let veranderd = false;
    for (let i = 0; i < stukken.length && stukken.length > 1; i++) {
      const sk = stukken[i];
      if (sk.b - sk.a >= minF || sk.stil) continue;
      const links = stukken[i - 1], rechts = stukken[i + 1];
      const buur = !links ? rechts : !rechts ? links : (links.b - links.a >= rechts.b - rechts.a ? links : rechts);
      const samen = buur === links ? { a: links.a, b: sk.b } : { a: sk.a, b: rechts.b };
      stukken.splice(buur === links ? i - 1 : i, 2, herreken({ ...samen, k: buur.k }));
      veranderd = true;
      break;
    }
    for (let i = 1; i < stukken.length; i++) {
      if (stukken[i].k === stukken[i - 1].k && !!stukken[i].stil === !!stukken[i - 1].stil) {
        stukken.splice(i - 1, 2, herreken({ a: stukken[i - 1].a, b: stukken[i].b, k: stukken[i].k }));
        veranderd = true;
        i--;
      }
    }
    if (!veranderd) break;
  }
  return stukken.map((sk) => ({ van: sk.a / frameRate, tot: sk.b / frameRate, k: sk.k,
    zekerheid: sk.zekerheid, toon: sk.toon, beslist: sk.beslist, r: sk.r, stil: !!sk.stil }));
}

/**
 * De kaart met een STEMMING PER STUK: tweede doorgang na kaart().
 *
 * Een album of mix heeft per nummer een eigen A (zoned out: stukken op -48,
 * +43, +25 en -5 cent). Met één stemming voor alles kan een stuk op +52 cent
 * t.o.v. het geheel staan, en heet het "B" waar "C op -48 cent" hetzelfde
 * klinkt. Hier krijgt elk stuk zijn eigen stemming (cirkelgemiddelde van de
 * pieken in dat stuk, altijd tussen -50 en +50 cent), en wordt zijn toonsoort
 * daarmee opnieuw uitgerekend. Zo betekent "C" in de kaart altijd: C, hooguit
 * een halve toon min één cent ernaast, en staat die afwijking erbij. Buren
 * met dezelfde toonsoort en een stemming binnen 20 cent gaan samen.
 */
export function kaartPerStuk(sp, ok) {
  const { C } = chroma(halveTonen(sp, sp.stemming));
  const ruw = kaart(C, ok, sp.frameRate);
  const opnieuw = (a, b) => {
    const st = stemmingVan(sp, a, b);
    const Cs = chroma(halveTonen(sp, st.cent, { van: a, tot: b })).C;
    const t = toonsoortVan(Cs, 0, b - a, ok.subarray(a, b), { proeven: 32 });
    // `tweede`: de beste sleutel met een ANDER Camelot-getal (kies().kAnder), uit
    // dezelfde correlaties. Alleen erbij gezet: de keuze van `k` verandert niet.
    return { a, b, k: t.k, zekerheid: t.zekerheid, toon: t.toon, beslist: t.beslist, r: t.r, stemming: st.cent, stemmingR: st.R,
      tweede: t.k == null ? null : t.kAnder };
  };
  const stukken = ruw.map((s) => {
    const a = Math.round(s.van * sp.frameRate), b = Math.round(s.tot * sp.frameRate);
    return s.stil ? { a, b, k: null, zekerheid: 0, stil: true } : opnieuw(a, b);
  });
  const wrap = (x) => x - 100 * Math.round(x / 100);
  for (let i = 1; i < stukken.length; i++) {
    const x = stukken[i - 1], y = stukken[i];
    if (!x.stil && !y.stil && x.k === y.k && Math.abs(wrap(x.stemming - y.stemming)) < 20) {
      stukken.splice(i - 1, 2, opnieuw(x.a, y.b));
      i--;
    }
  }
  // `tweede` staat ACHTERAAN en bestaat niet in het meetinstrument: toon.test legt
  // de rest naast tools/toonsoort/toon.mjs en laat alleen dit veld weg.
  return stukken.map((sk) => ({ van: sk.a / sp.frameRate, tot: sk.b / sp.frameRate, k: sk.k, zekerheid: sk.zekerheid,
    toon: sk.toon, beslist: sk.beslist, r: sk.r, stemming: sk.stemming, stemmingR: sk.stemmingR, stil: !!sk.stil,
    tweede: sk.stil ? null : sk.tweede ?? null }));
}

// ---- de hele keten -> de kaart zoals hij bewaard wordt --------------------------

const rond = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
/** -50..+50: een stemming precies op de rand is -50 of +50, niet iets erbuiten door afronding. */
const cent = (x) => Math.max(-50, Math.min(50, rond(x, 1)));

/**
 * Van mono pcm (op `sr`, standaard 4410 Hz) naar de kaart zoals de library
 * hem bewaart (docs/TOONSOORT.md §3):
 *
 *   { versie, stemming, stukken: [{ van, toonsoort, stemming, zekerheid, tweede }], bron: 'auto', slot: false }
 *
 * `van` in tracktijd (s, op 0,1 s); een stuk loopt tot de `van` van het
 * volgende, het eerste begint op 0. `toonsoort` in de vaste spelling, of null
 * voor STILTE (de kaart vindt daar geen klank; een automatische kaart geeft
 * verder altijd een toonsoort, met een zekerheid). `stemming` in cent: per
 * stuk, en bovenaan voor het geheel. `tweede` (zelfde spelling): de tweede
 * kandidaat voor de tooltip ("best passend: E, of A", TOONSOORT.md §5), de beste
 * met een ANDER Camelot-getal; de relatieve telt niet, die deelt zijn tonen en
 * zijn plek op de wijzer. Stilte heeft geen tweede. Null als de audio te kort
 * is (< 3,7 s).
 */
export function toonKaart(pcm, sr = TOON_SR) {
  if (!pcm || pcm.length < STANDAARD.N) return null;
  const sp = spectrum(pcm, sr);
  const ok = nietStil(sp.energie);
  const ruw = kaartPerStuk(sp, ok);
  if (!ruw.length) return null;
  const heel = cent(sp.stemming);
  const stukken = ruw.map((s, i) => {
    const stuk = {
      van: i === 0 ? 0 : rond(s.van, 1),
      toonsoort: s.stil ? null : toonsoortNaam(s.k),
      stemming: s.stil || !Number.isFinite(s.stemming) ? heel : cent(s.stemming),
      zekerheid: s.stil ? 0 : rond(s.zekerheid, 2),
    };
    if (stuk.toonsoort !== null && s.tweede != null) stuk.tweede = toonsoortNaam(s.tweede);
    return stuk;
  });
  return { versie: TOON_VERSIE, stemming: heel, stukken, bron: 'auto', slot: false };
}

/**
 * Eén regel voor de serverlog: de stukken met toonsoort, Camelot, zekerheid
 * en stemming. Bij veel stukken alleen het begin.
 */
export function toonSamenvatting(t) {
  if (!t) return 'geen toonsoort';
  const stuk = (s) => {
    const k = leesToonsoort(s.toonsoort);
    const naam = k == null ? '—' : `${s.toonsoort} ${camelot(k)}`;
    const z = typeof s.zekerheid === 'number' ? ` z${s.zekerheid.toFixed(2)}` : '';
    const st = Math.abs(s.stemming) >= 20 ? ` ${s.stemming > 0 ? '+' : ''}${Math.round(s.stemming)} ct` : '';
    return `${naam}${z}${st}`;
  };
  const eerste = t.stukken.slice(0, 5).map(stuk).join(' | ');
  return `${t.stukken.length} stuk${t.stukken.length === 1 ? '' : 'ken'}: ${eerste}${t.stukken.length > 5 ? ' …' : ''}`
    + `${t.slot ? ' (slot)' : ''}${t.bron === 'hand' ? ' (hand)' : ''}`;
}
