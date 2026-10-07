// @ts-check
/**
 * Secties: een nummer in stukken die je kunt spelen (docs/SECTIES.md).
 *
 * Een SECTIEKAART zoals de toonsoortkaart: in tracktijd, van de plaat, per
 * link bewaard. Elke sectie begint op een maatbegin van het grid:
 *
 *   { versie, opGrid, grid, stukken: [{ van, label, groep, energie, zeker?, stems? }], bron, slot }
 *
 * - `van`     tracktijd (s) waar de sectie begint; de eerste altijd 0.
 * - `label`   intro · opbouw · drop · break · outro · deel (wat hij lijkt te doen)
 * - `groep`   A, B, C … : secties die op elkaar lijken krijgen dezelfde letter
 *             (een refrein dat terugkomt, twee drops).
 * - `energie` 0..1 binnen het nummer (luidheid en drukte), voor het scherm.
 * - `zeker`   hoe duidelijk de grens aan het begin is, 0..1 (de eerste heeft er geen).
 * - `stems`   welke stems er spelen (alleen als het nummer stems heeft):
 *             { vocals: 0..1, drums: 0..1, … } t.o.v. het luidste stuk van die stem.
 * - `opGrid`  false = er was geen grid: dan zijn de "maten" stukken van 2 s en
 *             landt een sprong niet op de maat (de deck-kant weet dat).
 * - `grid`    een vingerafdruk van het grid waarop gerekend is: verandert het
 *             grid (↻, tikken, een nieuw stuk), dan is de kaart verouderd.
 *
 * HOE (puur rekenwerk, geen dependencies, zoals detect.js en toon.js):
 * 1. Per maat kenmerken: chroma (12, gecentreerd), vijf frequentiebanden in dB,
 *    rms, flux (drukte; ook apart onder 150 Hz en boven 3 kHz: kick en hihat)
 *    en per stem het niveau in dB.
 * 2. Een zelf-gelijkenismatrix over de maten en de nieuwheid volgens Foote
 *    (een dambordkern van 2 × 8 maten), plus de sprong in energie en in de
 *    stems over 4 maten. Een drop of break is vooral een sprong in energie en
 *    drums; een couplet → refrein vooral in harmonie en klank.
 * 3. Grenzen = pieken in die nieuwheid, minstens 4 maten uit elkaar, bij
 *    voorkeur op een frase van 4 maten (de fase van die frases komt uit de
 *    nieuwheid zelf: een nummer met een opmaat begint niet op maat 0).
 *    Langer dan 32 maten zonder grens: splitsen op de beste frasegrens.
 * 4. Groepen: secties met gemiddelde kenmerken die dicht bij elkaar liggen
 *    (gemiddelde koppeling), letters in volgorde van eerste keer.
 * 5. Labels uit energie en drums: begin zacht = intro, eind zacht = outro,
 *    zacht ertussen = break, het luidste = drop, vlak vóór een drop en
 *    oplopend = opbouw, de rest = deel.
 *
 * Gemeten op synthetische nummers met een bekend antwoord (test/secties.test.mjs);
 * op Clay's library nog niet: de drempels zijn een eerste keuze.
 */

import { fft } from './detect.js';
import { Beatgrid } from '../src/engine/beatgrid.js';

/** Verhoog bij een beter algoritme: automatische kaarten met een lagere versie worden opnieuw gedaan. */
export const SECTIE_VERSIE = 1;

/** Samplerate waarop gerekend wordt (mono). Hoog genoeg voor hihats tot ~5 kHz. */
export const SECTIE_SR = 11025;

/** Samplerate voor het niveau per stem (alleen energie, geen klank). */
export const STEMS_SR = 4000;

export const LABELS = ['intro', 'opbouw', 'drop', 'break', 'outro', 'deel'];

const N = 2048, HOP = 1024;
const BANDEN = [30, 120, 300, 800, 2000, 5000];   // Hz: vijf banden
const MIN_MATEN = 4;        // kortste sectie
const MAX_MATEN = 32;       // langer wordt gesplitst
const KERN = 8;             // halve breedte van de dambordkern, in maten
const NEP_MAAT = 2;         // s per "maat" zonder grid
const GROEP_AFSTAND = 0.3;  // groepen samenvoegen onder deze afstand (1 − gelijkenis)
const MAX_SECTIES = 40;     // zoveel pads heeft het grid van de APC

const dB = (x) => 10 * Math.log10(x + 1e-10);
const gem = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const rond = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

/** FNV-1a over het grid (stukken + maatsoort): wordt het grid anders, dan is de kaart verouderd. */
export function gridSleutel(grid) {
  if (!grid) return null;
  const g = grid instanceof Beatgrid ? grid : Beatgrid.van(grid);
  const tekst = JSON.stringify({ s: g.stukken.map(({ van, bpm, anker, maat }) => ({ van, bpm, anker, maat })), b: g.beatsPerBar });
  let h = 0x811c9dc5;
  for (let i = 0; i < tekst.length; i++) { h ^= tekst.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/**
 * De maten van het nummer als [begin, einde) in tracktijd. Met een grid de
 * echte maatbegins (de "1" per stuk, beatgrid.js); vóór de eerste "1" een
 * opmaat vanaf 0 als die er is. Zonder grid stukken van 2 s.
 * @returns {{ maten: number[], opGrid: boolean }}  begintijden; de laatste maat loopt tot `duur`
 */
export function maatGrenzen(grid, duur) {
  if (!grid) {
    const maten = [];
    for (let t = 0; t < duur - 0.5; t += NEP_MAAT) maten.push(t);
    return { maten: maten.length ? maten : [0], opGrid: false };
  }
  const g = grid instanceof Beatgrid ? grid : Beatgrid.van(grid);
  const max = Math.ceil(duur / (60 / 300)) + 16;
  const maten = g.beatsBetween(0, duur, max, 1).filter((b) => b.maatbegin && b.tijd < duur - 0.25).map((b) => Math.max(0, b.tijd));
  if (!maten.length || maten[0] > 0.05) maten.unshift(0);   // de opmaat telt als eigen (korte) maat
  return { maten, opGrid: true };
}

/**
 * Kenmerken per frame uit mono pcm op SECTIE_SR: chroma, banden, rms, flux.
 * @returns {{ frames: number, tijd: Float32Array, chroma: Float32Array, banden: Float32Array, rms: Float32Array, flux: Float32Array, fluxLaag: Float32Array, fluxHoog: Float32Array }}
 */
export function frameKenmerken(pcm, sr = SECTIE_SR) {
  const frames = pcm.length >= N ? Math.floor((pcm.length - N) / HOP) + 1 : 0;
  const tijd = new Float32Array(frames);
  const chroma = new Float32Array(frames * 12);
  const banden = new Float32Array(frames * (BANDEN.length - 1));
  const rms = new Float32Array(frames), flux = new Float32Array(frames);
  // Flux onder 150 Hz en boven 3 kHz apart: komt de kick of de hihat erbij of
  // valt hij weg, dan is dat in EDM vaak DE grens (de bas eronder verandert niet).
  const fluxLaag = new Float32Array(frames), fluxHoog = new Float32Array(frames);
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const half = N / 2;
  const pc = new Int8Array(half), band = new Int8Array(half);
  for (let k = 1; k < half; k++) {
    const f = (k * sr) / N;
    pc[k] = f >= 60 && f <= 2100 ? ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12 : -1;
    band[k] = -1;
    for (let b = 0; b < BANDEN.length - 1; b++) if (f >= BANDEN[b] && f < BANDEN[b + 1]) band[k] = b;
  }
  const re = new Float64Array(N), im = new Float64Array(N);
  let vorig = new Float32Array(half), nu = new Float32Array(half);
  for (let f = 0; f < frames; f++) {
    const s = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) { const x = pcm[s + i]; e += x * x; re[i] = x * w[i]; im[i] = 0; }
    fft(re, im);
    tijd[f] = (s + N / 2) / sr;
    rms[f] = Math.sqrt(e / N);
    let fl = 0, fLaag = 0, fHoog = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.hypot(re[k], im[k]);
      nu[k] = m;
      const p = m * m;
      if (pc[k] >= 0) chroma[f * 12 + pc[k]] += p;
      if (band[k] >= 0) banden[f * (BANDEN.length - 1) + band[k]] += p;
      const d = Math.log1p(m) - Math.log1p(vorig[k]);
      if (d > 0) { fl += d; if (k * sr / N < 150) fLaag += d; else if (k * sr / N > 3000) fHoog += d; }
    }
    flux[f] = f ? fl : 0;
    fluxLaag[f] = f ? fLaag : 0;
    fluxHoog[f] = f ? fHoog : 0;
    const t = vorig; vorig = nu; nu = t;
  }
  return { frames, tijd, chroma, banden, rms, flux, fluxLaag, fluxHoog };
}

/**
 * Niveau per stem per frame (dB) uit stems.wav, gelezen als `kanalen`
 * interleaved floats op STEMS_SR (stem k = kanaalpaar k). Frames van ~0,25 s.
 * @returns {{ tijd: Float32Array, niveau: Float32Array[] }}  niveau[k][frame]
 */
export function stemNiveaus(pcm, kanalen, sr = STEMS_SR) {
  const per = Math.round(sr / 4);                   // 0,25 s
  const n = Math.floor(pcm.length / kanalen / per);
  const aantal = Math.floor(kanalen / 2);
  const niveau = Array.from({ length: aantal }, () => new Float32Array(n));
  const tijd = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    tijd[f] = (f + 0.5) * per / sr;
    for (let k = 0; k < aantal; k++) {
      let e = 0;
      for (let i = 0; i < per; i++) {
        const j = ((f * per + i) * kanalen) + 2 * k;
        e += pcm[j] * pcm[j] + pcm[j + 1] * pcm[j + 1];
      }
      niveau[k][f] = dB(e / (2 * per));
    }
  }
  return { tijd, niveau };
}

/** Gemiddelde van de frames waarvan het midden in [t0, t1) valt, per maat. */
function perMaat(tijd, waarden, dim, maten, duur) {
  const M = maten.length, uit = new Float64Array(M * dim), n = new Int32Array(M);
  let m = 0;
  for (let f = 0; f < tijd.length; f++) {
    const t = tijd[f];
    while (m + 1 < M && t >= maten[m + 1]) m++;
    if (t < maten[m] || t >= (m + 1 < M ? maten[m + 1] : duur)) continue;
    for (let d = 0; d < dim; d++) uit[m * dim + d] += waarden(f, d);
    n[m]++;
  }
  // Een maat zonder frame (heel kort, of stems.wav korter dan audio.wav):
  // de vorige gevulde maat; vóór de eerste gevulde de eerste gevulde.
  for (let i = 0; i < M; i++) if (n[i]) for (let d = 0; d < dim; d++) uit[i * dim + d] /= n[i];
  const eerste = n.findIndex((x) => x > 0);
  if (eerste < 0) return uit;
  for (let i = 0; i < M; i++) {
    if (n[i]) continue;
    const j = i < eerste ? eerste : i - 1;   // i − 1 is al gevuld (of overgenomen)
    for (let d = 0; d < dim; d++) uit[i * dim + d] = uit[j * dim + d];
  }
  return uit;
}

/** Vectoren per maat: chroma (L2 = 1) en klank (z-scores: banden, rms, flux, stems). */
export function maatVectoren(fk, maten, duur, stems = null) {
  const M = maten.length, NB = BANDEN.length - 1;
  const ch = perMaat(fk.tijd, (f, d) => fk.chroma[f * 12 + d], 12, maten, duur);
  const ba = perMaat(fk.tijd, (f, d) => fk.banden[f * NB + d], NB, maten, duur);
  const rm = perMaat(fk.tijd, (f) => fk.rms[f] * fk.rms[f], 1, maten, duur);
  const fl = perMaat(fk.tijd, (f, d) => (d === 0 ? fk.flux[f] : d === 1 ? fk.fluxLaag[f] : fk.fluxHoog[f]), 3, maten, duur);
  const S = stems ? stems.niveau.length : 0;
  const st = S ? perMaat(stems.tijd, (f, d) => 10 ** (stems.niveau[d][f] / 10), S, maten, duur) : null;
  const chroma = [], klank = [], energie = new Float64Array(M), stemDb = [];
  for (let i = 0; i < M; i++) {
    const c = Array.from(ch.subarray(i * 12, i * 12 + 12));
    const l = Math.hypot(...c) || 1;
    chroma.push(c.map((x) => x / l));
    energie[i] = dB(rm[i]);
    const v = [];
    for (let b = 0; b < NB; b++) v.push(dB(ba[i * NB + b]));
    v.push(energie[i], Math.log1p(fl[i * 3]), Math.log1p(fl[i * 3 + 1]), Math.log1p(fl[i * 3 + 2]));
    const sd = [];
    for (let k = 0; k < S; k++) sd.push(dB(st[i * S + k]));
    stemDb.push(sd);
    klank.push([...v, ...sd]);
  }
  // Chroma gecentreerd op het gemiddelde van het nummer: anders lijkt elke
  // maat in dezelfde toonsoort op elke andere (cos ~0,8) en vallen een
  // couplet en een refrein samen.
  for (let d = 0; d < 12; d++) {
    const mu = gem(chroma.map((c) => c[d]));
    for (const c of chroma) c[d] -= mu;
  }
  // z-scores per dimensie over het nummer (een stille dimensie telt niet mee).
  const D = klank[0]?.length ?? 0;
  for (let d = 0; d < D; d++) {
    const kol = klank.map((v) => v[d]);
    const mu = gem(kol), sd = Math.sqrt(gem(kol.map((x) => (x - mu) ** 2))) || 1;
    for (const v of klank) v[d] = (v[d] - mu) / sd;
  }
  return { chroma, klank, energie, stemDb };
}

const cos = (a, b) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
};

/** Gelijkenis tussen twee maten (of secties): harmonie en klank samen, −1..1. */
const gelijk = (c1, k1, c2, k2) => 0.35 * cos(c1, c2) + 0.65 * cos(k1, k2);

/**
 * Nieuwheid op elke maatgrens i (tussen maat i−1 en i), 0..1: Foote op de
 * zelf-gelijkenis, plus de sprong in energie en stems over 4 maten.
 */
export function nieuwheid(v) {
  const M = v.chroma.length;
  const S = Array.from({ length: M }, () => new Float64Array(M));
  for (let i = 0; i < M; i++) for (let j = i; j < M; j++) {
    S[i][j] = S[j][i] = gelijk(v.chroma[i], v.klank[i], v.chroma[j], v.klank[j]);
  }
  const g = (a, L) => Math.exp(-0.5 * ((a + 0.5) / (0.5 * L)) ** 2);
  // Twee schalen: 8 maten (lange delen) en 4 maten (een opbouw van 8 maten
  // tussen twee langere delen valt anders weg onder de brede kern).
  const dambord = (i, Lmax) => {
    const L = Math.min(Lmax, i, M - i);
    let som = 0, w = 0;
    for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) {
      const k = g(a, L) * g(b, L);
      som += k * (S[i - 1 - a][i - 1 - b] + S[i + a][i + b] - S[i - 1 - a][i + b] - S[i + a][i - 1 - b]);
      w += 4 * k;
    }
    return Math.max(0, som / (w || 1));
  };
  const lang = new Float64Array(M), kort = new Float64Array(M);
  const foote = new Float64Array(M), sprong = new Float64Array(M), stem = new Float64Array(M);
  for (let i = 1; i < M; i++) { lang[i] = dambord(i, KERN); kort[i] = dambord(i, KERN / 2); }
  const mL = Math.max(...lang, 1e-9), mK = Math.max(...kort, 1e-9);
  for (let i = 1; i < M; i++) {
    foote[i] = Math.max(lang[i] / mL, 0.8 * kort[i] / mK);
    const K = Math.min(4, i, M - i);
    const voor = [], na = [];
    for (let a = 1; a <= K; a++) { voor.push(v.energie[i - a]); na.push(v.energie[i + a - 1]); }
    sprong[i] = Math.abs(gem(na) - gem(voor));
    // Eén stem die erbij komt of wegvalt (de drums in een break) telt al:
    // half de grootste sprong, half het gemiddelde over de stems.
    const SS = v.stemDb[0]?.length ?? 0;
    let max = 0, som = 0;
    for (let k = 0; k < SS; k++) {
      const vs = [], ns = [];
      for (let a = 1; a <= K; a++) { vs.push(v.stemDb[i - a][k]); ns.push(v.stemDb[i + a - 1][k]); }
      const x = Math.min(24, Math.abs(gem(ns) - gem(vs))) / 24;
      max = Math.max(max, x); som += x;
    }
    if (SS) stem[i] = 0.5 * max + 0.5 * som / SS;
  }
  const norm = (x) => { const m = Math.max(...x, 1e-9); return x.map((y) => y / m); };
  const f = norm(foote), e = norm(sprong.map((x) => Math.min(x, 18))), s = norm(stem);
  const heeftStems = (v.stemDb[0]?.length ?? 0) > 0;
  const n = new Float64Array(M);
  for (let i = 1; i < M; i++) n[i] = heeftStems ? 0.5 * f[i] + 0.25 * e[i] + 0.25 * s[i] : 0.6 * f[i] + 0.4 * e[i];
  return norm(n);
}

/** De fase (0..3) van de frases van 4 maten: waar de nieuwheid het meest op valt. */
export function fraseFase(n) {
  let beste = 0, max = -1;
  for (let o = 0; o < 4; o++) {
    let s = 0;
    for (let i = o; i < n.length; i += 4) s += n[i];
    if (s > max + 1e-9) { max = s; beste = o; }
  }
  return beste;
}

/** Maatgrenzen kiezen uit de nieuwheid. Geeft gesorteerde maatindexen (zonder 0). */
export function kiesGrenzen(n, { minMaten = MIN_MATEN, maxMaten = MAX_MATEN } = {}) {
  const M = n.length;
  if (M < 2 * minMaten) return [];
  const o = fraseFase(n);
  const opFrase = (i) => ((i - o) % 4 + 4) % 4 === 0;
  const waarden = Array.from(n).slice(1);
  const mu = gem(waarden), sd = Math.sqrt(gem(waarden.map((x) => (x - mu) ** 2)));
  // Relatief (gemiddelde + 0,3 sd), maar een grens op 30% van de sterkste telt altijd.
  const drempel = Math.min(mu + 0.3 * sd, 0.3);
  // Een piek telt als hij boven de drempel van het hele nummer komt, OF als
  // hij in zijn eigen buurt duidelijk uitsteekt: een couplet → refrein is
  // zwakker dan een break, maar binnen zijn 8 maten net zo goed een grens.
  const uitsteek = (i) => {
    let l = Infinity, r = Infinity;
    for (let d = 1; d <= 4; d++) { if (i - d >= 1) l = Math.min(l, n[i - d]); if (i + d < M) r = Math.min(r, n[i + d]); }
    return n[i] - Math.max(l === Infinity ? 0 : l, r === Infinity ? 0 : r);
  };
  const kand = [];
  for (let i = minMaten - 1; i <= M - minMaten + 1; i++) {
    let piek = true;
    for (let d = -2; d <= 2; d++) if (d && n[i + d] !== undefined && n[i + d] > n[i]) piek = false;
    if (piek && (n[i] >= drempel || (n[i] >= 0.08 && uitsteek(i) >= 0.5 * n[i]))) kand.push(i);
  }
  // Naar de frase trekken als die bijna even sterk is.
  const getrokken = kand.map((i) => {
    if (opFrase(i)) return i;
    for (const d of [-1, 1, -2, 2]) {
      const j = i + d;
      if (j >= minMaten && j <= M - minMaten && opFrase(j) && n[j] >= (Math.abs(d) === 1 ? 0.6 : 0.8) * n[i]) return j;
    }
    return i;
  });
  const score = (i) => n[i] * (opFrase(i) ? 1.25 : ((i - o) % 2 === 0 ? 1.1 : 1));
  const volgorde = [...new Set(getrokken)].filter((i) => i >= minMaten && i <= M - minMaten).sort((a, b) => score(b) - score(a));
  const gekozen = [];
  for (const i of volgorde) if (gekozen.every((j) => Math.abs(i - j) >= minMaten)) gekozen.push(i);
  gekozen.sort((a, b) => a - b);
  // Te lange stukken splitsen op de beste frasegrens, minstens 8 maten van elke kant.
  const grenzen = [0, ...gekozen, M];
  for (let r = 0; r < 64; r++) {
    let gesplitst = false;
    for (let k = 0; k + 1 < grenzen.length; k++) {
      const a = grenzen[k], b = grenzen[k + 1];
      if (b - a <= maxMaten) continue;
      let best = -1;
      for (let i = a + 8; i <= b - 8; i++) if (opFrase(i) && (best < 0 || n[i] > n[best])) best = i;
      if (best < 0) best = a + Math.round((b - a) / 2);
      grenzen.splice(k + 1, 0, best);
      gesplitst = true;
      break;
    }
    if (!gesplitst) break;
  }
  return grenzen.slice(1, -1);
}

/** Groepen (0, 1, 2 …) per sectie: gemiddelde koppeling op 1 − gelijkenis. */
export function groepeer(secties, afstand = GROEP_AFSTAND) {
  let clusters = secties.map((_, i) => [i]);
  const d = (A, B) => {
    let s = 0;
    for (const a of A) for (const b of B) s += 1 - gelijk(secties[a].chroma, secties[a].klank, secties[b].chroma, secties[b].klank);
    return s / (A.length * B.length);
  };
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const x = d(clusters[i], clusters[j]);
      if (x < afstand && (!best || x < best.x)) best = { i, j, x };
    }
    if (!best) break;
    clusters[best.i] = [...clusters[best.i], ...clusters[best.j]];
    clusters.splice(best.j, 1);
  }
  const groep = new Array(secties.length);
  clusters.sort((A, B) => Math.min(...A) - Math.min(...B)).forEach((C, g) => { for (const i of C) groep[i] = g; });
  return groep;
}

/**
 * Labels uit energie (0..1 binnen het nummer), drums (null = onbekend) en de
 * groepen. Drop = de luidste groep (gemiddeld ≥ 0,7), niet elk luid deel: een
 * couplet dat bijna even hard is, heet anders ook drop.
 */
export function labels(secs, groep = secs.map((_, i) => i)) {
  const n = secs.length;
  const uit = secs.map(() => 'deel');
  if (!n) return uit;
  const drumsOoit = secs.some((s) => s.drums === true);
  const zacht = (s) => s.energie <= 0.5 || (drumsOoit && s.drums === false && s.energie <= 0.7);
  secs.forEach((s, i) => {
    if (i === 0 && n > 1 && zacht(s)) uit[i] = 'intro';
    else if (i === n - 1 && n > 1 && zacht(s)) uit[i] = 'outro';
    else if (zacht(s)) uit[i] = 'break';
  });
  const perGroep = new Map();
  secs.forEach((s, i) => {
    if (uit[i] !== 'deel' || s.drums === false) return;
    const g = perGroep.get(groep[i]) ?? [];
    g.push(s.energie);
    perGroep.set(groep[i], g);
  });
  const gemiddeld = [...perGroep].map(([g, e]) => [g, gem(e)]);
  const top = Math.max(...gemiddeld.map(([, e]) => e), -1);
  const drop = new Set(gemiddeld.filter(([, e]) => top >= 0.7 && e >= top - 0.03).map(([g]) => g));
  secs.forEach((_, i) => { if (uit[i] === 'deel' && drop.has(groep[i])) uit[i] = 'drop'; });
  for (let i = 0; i + 1 < n; i++) {
    if (uit[i + 1] === 'drop' && (uit[i] === 'deel' || uit[i] === 'break') && secs[i].stijging >= 2) uit[i] = 'opbouw';
  }
  return uit;
}

/**
 * De hele kaart uit kenmerken en maten. Puur: de worker leest de audio
 * (analyze.js) en geeft dit de frames en (als ze er zijn) de stemniveaus.
 */
export function sectieKaart({ fk, stems = null, stemNamen = [], grid = null, duur }) {
  const { maten, opGrid } = maatGrenzen(grid, duur);
  const v = maatVectoren(fk, maten, duur, stems);
  const n = nieuwheid(v);
  let grenzen = kiesGrenzen(n);
  // Hooguit 40 secties (het grid van de APC): in een lange mix de sterkste grenzen.
  if (grenzen.length > MAX_SECTIES - 1) grenzen = [...grenzen].sort((a, b) => n[b] - n[a]).slice(0, MAX_SECTIES - 1).sort((a, b) => a - b);
  const starts = [0, ...grenzen];
  const M = maten.length;
  const secs = starts.map((a, k) => {
    const b = k + 1 < starts.length ? starts[k + 1] : M;
    const idx = Array.from({ length: b - a }, (_, i) => a + i);
    const chroma = new Array(12).fill(0), klank = new Array(v.klank[0].length).fill(0);
    for (const i of idx) { v.chroma[i].forEach((x, d) => { chroma[d] += x / idx.length; }); v.klank[i].forEach((x, d) => { klank[d] += x / idx.length; }); }
    const e = idx.map((i) => v.energie[i]);
    const helft = Math.max(1, Math.floor(e.length / 2));
    const stemGem = (v.stemDb[0] ?? []).map((_, s) => gem(idx.map((i) => v.stemDb[i][s])));
    return { a, b, chroma, klank, eDb: gem(e), stijging: gem(e.slice(-helft)) - gem(e.slice(0, helft)), stemGem, zeker: a ? n[a] : null };
  });
  // Energie 0..1 tussen de zachtste en de luidste sectie.
  const lo = Math.min(...secs.map((s) => s.eDb)), hi = Math.max(...secs.map((s) => s.eDb));
  for (const s of secs) s.energie = hi - lo > 1 ? (s.eDb - lo) / (hi - lo) : 0.5;
  // Stems: niveau t.o.v. het luidste stuk van die stem; onder −18 dB = speelt niet.
  const stemMax = (secs[0]?.stemGem ?? []).map((_, k) => Math.max(...secs.map((s) => s.stemGem[k])));
  // Drums: uit de stems; zonder stems "geen drums" waar het grid geen zekere
  // puls heeft (ambient, een break zonder klik), anders onbekend.
  const di = stemNamen.indexOf('drums');
  const g = grid ? (grid instanceof Beatgrid ? grid : Beatgrid.van(grid)) : null;
  for (const s of secs) {
    s.stemsRel = stemNamen.length ? Object.fromEntries(stemNamen.map((nm, k) => [nm, rond(Math.max(0, Math.min(1, 1 + (s.stemGem[k] - stemMax[k]) / 24)))])) : null;
    const midden = (maten[s.a] + (s.b < M ? maten[s.b] : duur)) / 2;
    s.drums = di >= 0 ? s.stemGem[di] > stemMax[di] - 18 && s.stemGem[di] > -60 : (g && g.zekerBij(midden) ? null : false);
  }
  // Hooguit 26 groepen (A–Z): in een lange mix de drempel ruimer tot het past.
  let groep = groepeer(secs);
  for (let a = GROEP_AFSTAND + 0.05; Math.max(...groep) > 25 && a < 2; a += 0.05) groep = groepeer(secs, a);
  const lab = labels(secs, groep);
  const stukken = secs.slice(0, MAX_SECTIES).map((s, k) => {
    const stuk = { van: rond(maten[s.a], 4), label: lab[k], groep: String.fromCharCode(65 + Math.min(25, groep[k])), energie: rond(s.energie) };
    if (s.zeker !== null) stuk.zeker = rond(s.zeker);
    if (s.stemsRel) stuk.stems = s.stemsRel;
    return stuk;
  });
  stukken[0].van = 0;
  return { versie: SECTIE_VERSIE, opGrid, grid: opGrid ? gridSleutel(grid) : null, stukken, bron: 'auto', slot: false,
    stemsGeprobeerd: stemNamen.length > 0 };
}

/** Eén regel voor het serverlog: "intro A · drop B · break C …". */
export function sectieSamenvatting(k) {
  if (!k?.stukken?.length) return 'geen secties';
  return `${k.stukken.length} secties: ` + k.stukken.map((s) => (s.label === 'deel' ? s.groep : `${s.label} ${s.groep}`)).join(' · ');
}
