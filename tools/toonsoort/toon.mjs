/**
 * Toonsoort-detectie: het rekenwerk. Puur, geen I/O, geen dependencies; de
 * FFT komt uit server/detect.js. Dit bestand is de kandidaat om later naar
 * server/ te verhuizen (zie docs/TOONSOORT.md); meet.mjs en synth.mjs doen
 * het lezen en schrijven.
 *
 * De keten:
 *   mono pcm op ~4,4 kHz (ffmpeg, zoals ROADMAP "Toonsoort" voorstelt)
 *   -> FFT van 16384 (3,7 s, 0,27 Hz per bin: genoeg voor de lage octaven)
 *   -> fijn log-spectrum in stapjes van 10 cent t.o.v. A = 440, en spectrale
 *      pieken voor de STEMMING (een plaat op A = 432 staat 32 cent laag)
 *   -> halvetoonspectrum rond de gevonden stemming (cos²-kern, som 1)
 *   -> harmonisch/percussief (mediaan over tijd tegen mediaan over frequentie),
 *      log-compressie (vloer eraf en boventonen aftrekken: alleen als variant)
 *   -> chroma (12 toonklassen) per frame
 *   -> correlatie met een toonsoortprofiel (Krumhansl-Schmuckler), 24 sleutels
 *   -> zekerheid tegen een geschudde nul (toonklassen gehusseld)
 *   -> een kaart in stukken (Viterbi), en per stuk een eigen stemming (kaartPerStuk).
 * Wat de meting koos staat in docs/TOONSOORT.md: hpss+log, Temperley 2005,
 * kaartPerStuk met venster 24 s, stap 6 s, wissel 1,2.
 */
import { fft } from '../../server/detect.js';

// ---- namen en Camelot ------------------------------------------------------

/** Sleutel k: 0..11 = majeur op toonklasse k (C = 0), 12..23 = mineur op k - 12. */
export const NL_MAJ = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'Bes', 'B'];
export const NL_MIN = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Bes', 'B'];
export const KORT_MAJ = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const KORT_MIN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

export const isMineur = (k) => k >= 12;
export const tonica = (k) => k % 12;
export const naam = (k) => (k == null ? 'geen' : isMineur(k) ? `${NL_MIN[k - 12]} mineur` : `${NL_MAJ[k]} majeur`);
export const kort = (k) => (k == null ? '-' : isMineur(k) ? `${KORT_MIN[k - 12]}m` : KORT_MAJ[k]);

/** Camelot-getal 1..12: majeur C = 8B, elke kwint omhoog +1; mineur = die van zijn relatieve majeur. */
export function camelotGetal(k) {
  const t = isMineur(k) ? (tonica(k) + 3) % 12 : k;
  return ((7 * t) % 12 + 7) % 12 + 1;
}
export const camelot = (k) => (k == null ? '-' : `${camelotGetal(k)}${isMineur(k) ? 'A' : 'B'}`);

/** Een halve toon omhoog = zeven stappen verder op de Camelot-wijzer. */
export const transponeer = (k, halveTonen) => (k == null ? null
  : (isMineur(k) ? 12 : 0) + (((tonica(k) + Math.round(halveTonen)) % 12) + 12) % 12);

/** "F", "F#m", "Bb minor", "E♭" -> sleutel 0..23, of null. */
export function leesSleutel(s) {
  const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(m|min|minor|mineur)?\s*(maj|major|majeur)?\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const basis = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const vt = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const t = (basis + vt + 12) % 12;
  return m[3] ? 12 + t : t;
}

/**
 * Hoe dicht zit een uitkomst bij het goede antwoord? De MIREX-weging voor
 * toonsoortdetectie: goed 1, kwint ernaast 0,5, relatief 0,3, parallel 0,2.
 */
export function oordeel(gevonden, bekend) {
  if (gevonden == null || bekend == null) return { soort: 'geen', punten: 0 };
  if (gevonden === bekend) return { soort: 'goed', punten: 1 };
  if (isMineur(gevonden) === isMineur(bekend)) {
    const d = ((tonica(gevonden) - tonica(bekend)) % 12 + 12) % 12;
    if (d === 7 || d === 5) return { soort: 'kwint', punten: 0.5 };
  }
  if (gevonden === relatief(bekend)) return { soort: 'relatief', punten: 0.3 };
  if (tonica(gevonden) === tonica(bekend)) return { soort: 'parallel', punten: 0.2 };
  return { soort: 'fout', punten: 0 };
}

/** Relatief (zelfde Camelot-getal, andere letter): C majeur <-> A mineur. */
export const relatief = (k) => (isMineur(k) ? (tonica(k) + 3) % 12 : 12 + (k + 9) % 12);

// ---- profielen -------------------------------------------------------------
// Waarden overgenomen uit Essentia, src/algorithms/tonal/key.cpp (MTG, 2024),
// die de oorspronkelijke publicaties citeert. Tonica eerst.
export const PROFIELEN = {
  // Krumhansl & Kessler 1982: luisterproeven (probe tones).
  krumhansl: {
    maj: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    min: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  },
  // Temperley 1999 ("What's key for key?"), herzien K-S.
  temperley: {
    maj: [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
    min: [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0],
  },
  // Temperley 2005 (MIREX), kansen uit het Kostka-Payne-corpus.
  temperley05: {
    maj: [0.748, 0.060, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4],
    min: [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33],
  },
  // Sha'ath 2011 (KeyFinder), K-K bijgesteld op popmuziek.
  shaath: {
    maj: [6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4],
    min: [6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2],
  },
  // Faraldo 2016 "edma": uit chroma van AUDIO (EDM-corpus), dus boventonen tellen al mee.
  edma: {
    maj: [1.00, 0.29, 0.50, 0.40, 0.60, 0.56, 0.32, 0.80, 0.31, 0.45, 0.42, 0.39],
    min: [1.00, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32],
  },
  // Faraldo 2016 "bgate": uit Beatport-audio, gemiddeld en gepoetst.
  bgate: {
    maj: [1.00, 0.00, 0.42, 0.00, 0.53, 0.37, 0.00, 0.77, 0.00, 0.38, 0.21, 0.30],
    min: [1.00, 0.00, 0.36, 0.39, 0.00, 0.38, 0.00, 0.74, 0.27, 0.00, 0.42, 0.23],
  },
};

/** 24 genormaliseerde profielen (gemiddelde 0, norm 1): correleren = een inproduct. */
const profielCache = new Map();
export function profiel24(naam) {
  if (profielCache.has(naam)) return profielCache.get(naam);
  const p = PROFIELEN[naam];
  if (!p) throw new Error(`onbekend profiel: ${naam}`);
  const uit = [];
  for (const basis of [p.maj, p.min]) {
    for (let t = 0; t < 12; t++) {
      const v = new Float64Array(12);
      for (let i = 0; i < 12; i++) v[(i + t) % 12] = basis[i];
      uit.push(zNorm(v));
    }
  }
  profielCache.set(naam, uit);
  return uit;
}

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

/**
 * Pearson-correlatie van een chroma met alle 24 sleutels. Een naam met '+'
 * ("temperley05+edma") is een combinatie: het gemiddelde van de correlaties.
 */
export function correlaties(chroma, profielNaam) {
  if (profielNaam.includes('+')) {
    const delen = profielNaam.split('+');
    const r = new Float64Array(24);
    for (const d of delen) { const x = correlaties(chroma, d); for (let k = 0; k < 24; k++) r[k] += x[k] / delen.length; }
    return r;
  }
  const c = zNorm(chroma);
  const P = profiel24(profielNaam);
  const r = new Float64Array(24);
  for (let k = 0; k < 24; k++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += c[i] * P[k][i];
    r[k] = s;
  }
  return r;
}

/**
 * Beste sleutel, de tweede, en de beste met een ANDER Camelot-getal.
 * Relatief majeur/mineur (8A/8B) delen hun tonen: voor mixen maakt die
 * verwarring niets uit, dus de marge die telt is die tot een ander getal.
 */
export function kies(r) {
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

// ---- spectrum -> halvetoonspectrum ---------------------------------------------

export const STANDAARD = {
  N: 16384,           // FFT-lengte (op ~4,4 kHz: 3,7 s, 0,27 Hz per bin)
  // 1,86 s (halve overlap). Gemeten tegen 4096: dezelfde uitkomsten op de
  // Sakamoto-stukken en in de kaart, de FFT kost de helft (meting.txt).
  hop: 8192,
  fmin: 55,           // A1; eronder vooral gerommel en kick
  fmax: 2000,         // net onder de rolloff van ffmpeg's hersampler op 4410 Hz
  cent: 10,           // fijn raster voor de stemming
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
 * over de hele track een fasor voor de stemming uit de spectrale pieken.
 *
 * De stemming: elke piek (lokaal maximum, parabolisch geïnterpoleerd, boven
 * 4x het gemiddelde van zijn omgeving) geeft zijn afwijking in cent t.o.v. het
 * 440-raster, modulo 100, als hoek op een cirkel. Het gewogen gemiddelde van
 * die hoeken is de stemming. Op een cirkel, want -49 en +49 cent liggen naast
 * elkaar (bijna een halve toon), niet ver uit elkaar.
 *
 * Geeft { fijn: Float32Array(frames * bins), bins, frames, frameRate, stemming, stemmingR, energie }.
 */
export function spectrum(pcm, sr, opties = {}) {
  const { N, hop, fmin, fmax, cent } = { ...STANDAARD, ...opties };
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
  // Per frame bewaard: een album of mix heeft per nummer een eigen stemming.
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
    stemmingR: tSom > 0 ? Math.hypot(tRe, tIm) / tSom : 0, stemRe, stemIm, stemW, energie, N, hop, sr, fmin, fmax };
}

/** Stemming (cent, -50..50) en helderheid R over frames [van, tot). */
export function stemmingVan(sp, van = 0, tot = sp.frames) {
  let re = 0, im = 0, w = 0;
  for (let f = Math.max(0, van); f < Math.min(sp.frames, tot); f++) { re += sp.stemRe[f]; im += sp.stemIm[f]; w += sp.stemW[f]; }
  return { cent: Math.atan2(im, re) / (2 * Math.PI) * 100, R: w > 0 ? Math.hypot(re, im) / w : 0 };
}

/**
 * Stemming per frame: het gemiddelde op de cirkel over ±`halfSec` s. Voor
 * albums en mixen, waar elk nummer zijn eigen A heeft (zoned out: +42 cent
 * over het geheel met helderheid 0,42). Geeft Float32Array(frames) in cent.
 */
export function stemmingLopend(sp, halfSec = 30) {
  const h = Math.max(1, Math.round(halfSec * sp.frameRate));
  const n = sp.frames;
  const pr = new Float64Array(n + 1), pi = new Float64Array(n + 1);
  for (let f = 0; f < n; f++) { pr[f + 1] = pr[f] + sp.stemRe[f]; pi[f + 1] = pi[f] + sp.stemIm[f]; }
  const uit = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = Math.max(0, f - h), b = Math.min(n, f + h + 1);
    uit[f] = Math.atan2(pi[b] - pi[a], pr[b] - pr[a]) / (2 * Math.PI) * 100;
  }
  return uit;
}

/**
 * Halvetoonspectrum rond de stemming: halve toon m (t.o.v. A4, dus MIDI - 69)
 * krijgt de fijne bins binnen één halve toon, gewogen met cos²(π/2 · d). Twee
 * buren tellen samen op tot 1, dus niets wordt dubbel geteld.
 * `stemming`: één getal (cent) voor de hele track, of een Float32Array met
 * een stemming per frame (stemmingLopend); die wordt op 5 cent afgerond.
 * `van`/`tot`: alleen die frames (voor de stemming per stuk).
 * Geeft { S: Float32Array(frames * halve), halve, mLo } (mLo = eerste halve toon).
 */
export function halveTonen(sp, stemming = sp.stemming, { fmin = sp.fmin, fmax = sp.fmax, van = 0, tot = sp.frames } = {}) {
  const { fijn, bins, c0, cent } = sp;
  const frames = Math.max(0, Math.min(sp.frames, tot) - van);
  // Het rooster zelf ligt vast (t.o.v. 440); de stemming schuift alleen welke fijne bin waar valt.
  const mLo = Math.ceil(12 * Math.log2(fmin / 440));
  const mHi = Math.floor(12 * Math.log2(fmax / 440));
  const halve = mHi - mLo + 1;
  // Per fijne bin: tot welke halve toon, met welk gewicht (twee buren).
  const lijsten = new Map();
  const lijstVoor = (st) => {
    if (lijsten.has(st)) return lijsten.get(st);
    const lijst = [];
    for (let j = 0; j < bins; j++) {
      const c = c0 + j * cent;                  // cent t.o.v. 440
      const m = (c - st) / 100;                  // halve tonen t.o.v. A4 in deze stemming
      const m0 = Math.floor(m), d = m - m0;
      const w0 = Math.cos(0.5 * Math.PI * d) ** 2, w1 = 1 - w0;
      if (m0 >= mLo && m0 <= mHi) lijst.push(j, m0 - mLo, w0);
      if (m0 + 1 >= mLo && m0 + 1 <= mHi) lijst.push(j, m0 + 1 - mLo, w1);
    }
    lijsten.set(st, lijst);
    return lijst;
  };
  const perFrame = typeof stemming !== 'number';
  const S = new Float32Array(frames * halve);
  for (let f = 0; f < frames; f++) {
    const lijst = lijstVoor(perFrame ? 5 * Math.round(stemming[van + f] / 5) : stemming);
    const a = (van + f) * bins, b = f * halve;
    for (let i = 0; i < lijst.length; i += 3) S[b + lijst[i + 1]] += fijn[a + lijst[i]] * lijst[i + 2];
  }
  return { S, halve, mLo, frames, frameRate: sp.frameRate };
}

// ---- harmonisch, vloer, compressie -> chroma ---------------------------------------

function mediaan(buf, n) {
  // Kleine n (≤ 13): insertion sort op een kopie.
  for (let i = 1; i < n; i++) { const x = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > x) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = x; }
  return n & 1 ? buf[n >> 1] : 0.5 * (buf[(n >> 1) - 1] + buf[n >> 1]);
}

/**
 * Van halvetoonspectrum naar chroma per frame.
 * - `hpss`: harmonisch masker H²/(H²+P²), H = mediaan over ±`hT` frames
 *   (een toon die blijft staan), P = mediaan over ±`hF` halve tonen (een
 *   klap is breed). Fitzgerald 2010, op het halvetoonrooster: goedkoop.
 * - `vloer`: per frame de mediaan over een octaaf eraf (ruis, galm, pads die
 *   alles vullen). Wat erboven uitsteekt telt.
 * - `compressie`: 'lin' | 'log' (log1p(γ·x/ref), ref = mediaan van de track) | 'wortel'.
 * Geeft { C: Float32Array(frames * 12), gewicht: Float32Array(frames) }.
 */
export function chroma(hs, { hpss = true, hT = 2, hF = 4, vloer = false, compressie = 'log', gamma = 10, boventonen = 0 } = {}) {
  const { S, halve, mLo, frames } = hs;
  let X = S;
  if (hpss && frames > 1) {
    X = new Float32Array(S.length);
    const buf = new Float32Array(Math.max(2 * hT + 1, 2 * hF + 1));
    for (let f = 0; f < frames; f++) {
      for (let m = 0; m < halve; m++) {
        let n = 0;
        for (let g = Math.max(0, f - hT); g <= Math.min(frames - 1, f + hT); g++) buf[n++] = S[g * halve + m];
        const H = mediaan(buf, n);
        n = 0;
        for (let q = Math.max(0, m - hF); q <= Math.min(halve - 1, m + hF); q++) buf[n++] = S[f * halve + q];
        const P = mediaan(buf, n);
        const h2 = H * H, p2 = P * P;
        X[f * halve + m] = h2 + p2 > 0 ? S[f * halve + m] * h2 / (h2 + p2) : 0;
      }
    }
  }
  if (boventonen > 0) {
    /*
     * Boventonen aftrekken. Elke toon heeft een 3e harmonische een kwint +
     * octaaf hoger (+19 halve tonen) en een 5e een grote terts + twee octaven
     * hoger (+28). In een chroma tellen die mee als echte noten, en de kwint
     * wint het dan: de toonsoort schuift een kwint omhoog (gemeten op de
     * Sakamoto-stukken: Es voor As, Cm voor Fm). Grof: een vast deel eraf.
     */
    const Y = new Float32Array(X.length);
    const a3 = boventonen, a5 = boventonen / 2;
    for (let f = 0; f < frames; f++) {
      const o = f * halve;
      for (let m = 0; m < halve; m++) {
        let v = X[o + m];
        if (m >= 19) v -= a3 * X[o + m - 19];
        if (m >= 28) v -= a5 * X[o + m - 28];
        Y[o + m] = v > 0 ? v : 0;
      }
    }
    X = Y;
  }
  if (vloer) {
    const Y = new Float32Array(X.length), buf = new Float32Array(13);
    for (let f = 0; f < frames; f++) {
      for (let m = 0; m < halve; m++) {
        let n = 0;
        for (let q = Math.max(0, m - 6); q <= Math.min(halve - 1, m + 6); q++) buf[n++] = X[f * halve + q];
        Y[f * halve + m] = Math.max(0, X[f * halve + m] - mediaan(buf, n));
      }
    }
    X = Y;
  }
  // Referentie voor de compressie: mediaan van de frame-maxima (luidheid van DEZE track).
  let ref = 1;
  if (compressie === 'log') {
    const maxima = new Float32Array(frames);
    for (let f = 0; f < frames; f++) { let mx = 0; for (let m = 0; m < halve; m++) mx = Math.max(mx, X[f * halve + m]); maxima[f] = mx; }
    const s = Array.from(maxima).sort((a, b) => a - b);
    ref = s[Math.floor(0.5 * (s.length - 1))] || 1e-9;
  }
  const C = new Float32Array(frames * 12), gewicht = new Float32Array(frames);
  const klasse = new Int32Array(halve);
  for (let m = 0; m < halve; m++) klasse[m] = (((69 + mLo + m) % 12) + 12) % 12;
  for (let f = 0; f < frames; f++) {
    let som = 0;
    for (let m = 0; m < halve; m++) {
      let v = X[f * halve + m];
      if (compressie === 'log') v = Math.log1p(gamma * v / ref);
      else if (compressie === 'wortel') v = Math.sqrt(v);
      C[f * 12 + klasse[m]] += v;
      som += v;
    }
    gewicht[f] = som;
  }
  return { C, gewicht, frames };
}

/** Frames die meetellen: niet stil (energie boven -45 dB t.o.v. p95 van de track). */
export function nietStil(energie, db = 45) {
  const s = Array.from(energie).sort((a, b) => a - b);
  const p95 = s[Math.floor(0.95 * (s.length - 1))] || 0;
  const grens = p95 * 10 ** (-db / 10);
  const ok = new Uint8Array(energie.length);
  for (let f = 0; f < energie.length; f++) ok[f] = energie[f] > grens && energie[f] > 0 ? 1 : 0;
  return ok;
}

export function somChroma(C, van, tot, ok = null) {
  const v = new Float64Array(12);
  for (let f = van; f < tot; f++) {
    if (ok && !ok[f]) continue;
    for (let i = 0; i < 12; i++) v[i] += C[f * 12 + i];
  }
  return v;
}

// ---- de nul ------------------------------------------------------------------

function rndMet(zaad) {
  let s = zaad >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
}

/**
 * De geschudde nul, het equivalent van schudBlokken bij het grid.
 *
 * Tijd schudden helpt hier niet: een toonsoort is een SOM over de tijd, en
 * die verandert niet als je de volgorde husselt. Wat een toonsoort wel is:
 * een VORM over de twaalf toonklassen (zeven hoog, vijf laag, in de
 * volgorde van een toonladder). De nul houdt dezelfde twaalf waarden en zet
 * ze in een willekeurige volgorde: zelfde luidheid, zelfde piekerigheid,
 * geen toonladder. Correleert de echte chroma niet duidelijk beter met een
 * profiel dan zo'n husseling, dan is er geen toonsoort aan te wijzen (ruis,
 * atonaal, een drone zonder terts). Onafhankelijk van de lengte: werkt voor
 * een venster van 24 s net zo goed als voor een uur.
 *
 * Geeft per nulproef { r, margeAnder } (dezelfde statistieken als de echte).
 */
export function nulGehusseld(v, profielNaam, { proeven = 64, zaad = 4242 } = {}) {
  const rnd = rndMet(zaad);
  const uit = [];
  const w = Float64Array.from(v);
  for (let p = 0; p < proeven; p++) {
    for (let i = 11; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = w[i]; w[i] = w[j]; w[j] = t; }
    const kz = kies(correlaties(w, profielNaam));
    uit.push({ r: kz.r, margeAnder: kz.margeAnder });
  }
  return uit;
}

/**
 * De eerste poging, bewaard ter vergelijking (synth.txt, sectie 4): elk blok
 * van `blok` frames (~4 s) over een willekeurig aantal halve tonen
 * verschuiven en dan optellen. Klinkt als de nul van het grid, maar een blok
 * van 4 s draagt zelf al een toonsoort (twee akkoorden en een melodie), en
 * in een venster van 24 s zitten maar zes blokken: de p97 van die nul lag
 * dan net zo hoog als de echte muziek. Gemeten: zekerheid 0 op elke schone
 * synthetische cadens.
 */
export function nulGedraaid(C, van, tot, ok, profielNaam, { blok = 4, proeven = 48, zaad = 4242 } = {}) {
  const rnd = rndMet(zaad);
  const uit = [];
  for (let p = 0; p < proeven; p++) {
    const v = new Float64Array(12);
    for (let a = van; a < tot; a += blok) {
      const sh = Math.floor(rnd() * 12);
      for (let f = a; f < Math.min(tot, a + blok); f++) {
        if (ok && !ok[f]) continue;
        for (let i = 0; i < 12; i++) v[(i + sh) % 12] += C[f * 12 + i];
      }
    }
    const kz = kies(correlaties(v, profielNaam));
    uit.push({ r: kz.r, margeAnder: kz.margeAnder });
  }
  return uit;
}

export function kwantiel(a, q) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(q * (s.length - 1))] : 0;
}

/**
 * Zekerheid 0..1 van één stuk, uit twee delen:
 * - `toon`: hoe ver de echte correlatie boven de p97 van de nul uitkomt,
 *   geschaald tot 1 (zoals het grid). Is er een toonladder?
 * - `beslist`: de marge tot de beste sleutel met een ANDER Camelot-getal,
 *   gedeeld door `margeVol`. Relatief majeur/mineur telt niet als twijfel
 *   (zelfde tonen, zelfde plek op de wijzer); C tegenover G wel.
 * zekerheid = toon × beslist: een duidelijke toonladder die niet van zijn
 * buurman te onderscheiden is, is voor mixen net zo weinig waard als geen.
 */
export function zekerheid(kz, nul, { margeVol = 0.15 } = {}) {
  const gR = kwantiel(nul.map((x) => x.r), 0.97);
  const toon = Math.max(0, Math.min(1, (kz.r - gR) / Math.max(1e-6, 1 - gR)));
  const beslist = Math.max(0, Math.min(1, kz.margeAnder / margeVol));
  return { zekerheid: toon * beslist, toon, beslist, nulR97: gR };
}

/** Eén toonsoort voor een stuk frames [van, tot). `nul`: 'gehusseld' (standaard) of 'gedraaid'. */
export function toonsoortVan(C, van, tot, ok, profielNaam, opties = {}) {
  const v = somChroma(C, van, tot, ok);
  let som = 0;
  for (const x of v) som += x;
  if (!(som > 0)) return { k: null, zekerheid: 0, toon: 0, beslist: 0, reden: 'stil' };
  const r = correlaties(v, profielNaam);
  const kz = kies(r);
  const nul = opties.nul === 'gedraaid'
    ? nulGedraaid(C, van, tot, ok, profielNaam, opties)
    : nulGehusseld(v, profielNaam, opties);
  return { ...kz, ...zekerheid(kz, nul, opties), chroma: v, r24: r };
}

// ---- de kaart ------------------------------------------------------------------

/**
 * Een toonsoortkaart: stukken { van, tot, k, zekerheid } in tracktijd.
 *
 * Vensters van `venster` s om de `stap` s; per venster de correlatie met de
 * 24 sleutels; toestand 24 = stilte. Viterbi zoekt het pad met de hoogste
 * som min `wissel` per verandering: één venster dat even afwijkt maakt geen
 * stuk. Daarna per stuk opnieuw: de sleutel uit de som van al zijn frames en
 * een zekerheid tegen de nul. Buren met dezelfde uitkomst gaan samen; een
 * stuk korter dan `minSec` gaat op in de langste buur.
 */
export function kaart(C, ok, frameRate, profielNaam, opties = {}) {
  const { venster = 24, stap = 6, wissel = 1.2, minSec = 24 } = opties;
  const frames = C.length / 12;
  const W = Math.max(1, Math.round(venster * frameRate)), H = Math.max(1, Math.round(stap * frameRate));
  const starts = [];
  for (let a = 0; a + W <= frames || (!starts.length && a < frames); a += H) starts.push(a);
  if (!starts.length) return [];
  const G = 24;   // stilte
  /*
   * Score per venster = de correlatie zelf. Eerst stond hier "r min de p97
   * van de nul" met een toestand "geen toonsoort" op 0; maar stille
   * pianopassages kwamen vaak net onder de nul, werden "geen", en twee zulke
   * stukken aan weerszijden van een nummergrens smolten samen tot één stuk
   * met één toonsoort over twee nummers (Sakamoto: Rain + The Last Emperor).
   * Nu kiest de kaart altijd een sleutel; "geen duidelijke toonsoort" is een
   * lage zekerheid van het stuk, en dat laat het scherm zien.
   */
  const score = starts.map((a) => {
    const b = Math.min(frames, a + W);
    let n = 0;
    for (let f = a; f < b; f++) if (ok[f]) n++;
    const e = new Float64Array(25);
    if (n < 0.5 * (b - a)) { e.fill(-1); e[G] = 1; return e; }
    const r = correlaties(somChroma(C, a, b, ok), profielNaam);
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
    const t = toonsoortVan(C, sk.a, sk.b, ok, profielNaam, { proeven: 32 });
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
 * een halve toon min één cent ernaast, en staat die afwijking erbij.
 * Buren met dezelfde toonsoort en een stemming binnen 20 cent gaan samen.
 */
export function kaartPerStuk(sp, bereik, chromaOpties, ok, profielNaam, kaartOpties = {}) {
  const hs = halveTonen(sp, sp.stemming, bereik);
  const { C } = chroma(hs, chromaOpties);
  const ruw = kaart(C, ok, sp.frameRate, profielNaam, kaartOpties);
  const opnieuw = (a, b) => {
    const st = stemmingVan(sp, a, b);
    const Cs = chroma(halveTonen(sp, st.cent, { ...bereik, van: a, tot: b }), chromaOpties).C;
    const t = toonsoortVan(Cs, 0, b - a, ok.subarray(a, b), profielNaam, { proeven: 32 });
    return { a, b, k: t.k, zekerheid: t.zekerheid, toon: t.toon, beslist: t.beslist, r: t.r, stemming: st.cent, stemmingR: st.R };
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
  return stukken.map((sk) => ({ van: sk.a / sp.frameRate, tot: sk.b / sp.frameRate, k: sk.k, zekerheid: sk.zekerheid,
    toon: sk.toon, beslist: sk.beslist, r: sk.r, stemming: sk.stemming, stemmingR: sk.stemmingR, stil: !!sk.stil }));
}

/**
 * Eén toonsoort voor het hele nummer, uit de kaart: de toonsoort die de
 * meeste tijd klinkt (stukken onder `geen` tellen niet), met het aandeel van
 * de tijd. Bij een album is dat "het meest", niet "het": `aandeel` zegt hoe
 * representatief het is.
 */
export function hoofdToonsoort(kaartStukken, { geen = 0.1 } = {}) {
  const tijd = new Map();
  let totaal = 0;
  for (const s of kaartStukken) {
    if (s.stil) continue;
    const d = s.tot - s.van;
    totaal += d;
    if (s.k == null || !(s.zekerheid >= geen)) continue;
    const x = tijd.get(s.k) || { d: 0, z: 0 };
    x.d += d; x.z += d * s.zekerheid;
    tijd.set(s.k, x);
  }
  let beste = null;
  for (const [k, x] of tijd) if (!beste || x.d > beste.d) beste = { k, d: x.d, zekerheid: x.z / x.d };
  return beste ? { k: beste.k, aandeel: totaal > 0 ? beste.d / totaal : 0, zekerheid: beste.zekerheid } : { k: null, aandeel: 0, zekerheid: 0 };
}
