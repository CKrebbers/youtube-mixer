/**
 * Kenmerken van wat je hoort, uit één frequentiespectrum per beeld. Puur
 * rekenwerk: geen Web Audio, geen DOM, draait zo in Node (test/analyse.test.mjs)
 * en later in een Worker of in AV-kern.
 *
 * Invoer is wat een AnalyserNode geeft:
 *   - Float32Array in dB (getFloatFrequencyData), -Infinity bij stilte;
 *   - Uint8Array 0..255 (getByteFrequencyData), 0 = minDb, 255 = maxDb.
 * Het aantal bins is fftSize / 2; de frequentie van bin i is i × sampleRate / fftSize.
 *
 * Uitvoer (regel 2): alles 0..1.
 *   laag    40–200 Hz      midden 200–2000 Hz      hoog 2000–12000 Hz
 *   rms     luidheid uit het tijdsignaal (RMS_DB)
 *   centroid zwaartepunt van het spectrum, logaritmisch tussen 40 Hz en 12 kHz
 *   onset   een klap: springt naar 1 en dooft uit met ONSET_TAU
 *
 * Tijd (regel 3): de TIJD komt van buiten, in seconden (de audioklok). Gladmaken
 * en uitdoven gaan met exp(-dt/τ), nooit "× 0,86 per frame": op 30 en op 120
 * beelden per seconde staat een waarde op hetzelfde moment even hoog.
 */

import { clamp } from '../lib/emitter.js';

export const BANDEN = { laag: [40, 200], midden: [200, 2000], hoog: [2000, 12000] };
export const CENTROID_BEREIK = [40, 12000];

/** Bereik van een AnalyserNode (minDecibels / maxDecibels): alleen om Uint8-invoer terug naar dB te rekenen. */
export const MIN_DB = -100;
export const MAX_DB = -30;

/**
 * Welk niveau 0 en welk 1 is, per band (dB, gemiddeld vermogen per bin).
 * Gemeten op Clay's library (8 nummers, 2400 vensters van 2048, Blackman,
 * |X|/N zoals een AnalyserNode) op de master met de masterfader op 0,8
 * (-9 dB) en één track vol open. Mediaan / 95%: laag -51 / -42, midden
 * -60 / -51, hoog -104 / -75 (zijn repertoire is donker boven 2 kHz), rms
 * -29 / -22 dBFS. De bereiken leggen de mediaan rond 0,6 en laten ruimte
 * naar boven; een bass-kill valt ver onder de 0.
 */
export const BAND_DB = { laag: [-75, -35], midden: [-85, -45], hoog: [-120, -60] };
export const RMS_DB = [-50, -15];
/** Per bin voor de flux: breed genoeg dat hats boven 2 kHz ook meetellen. */
export const FLUX_DB = [-110, -40];

/** Gladmaken van banden en rms: snel omhoog, rustiger omlaag (seconden). */
export const OPKOMST_TAU = 0.02;
export const UITSTERF_TAU = 0.12;
/**
 * Onset: drempel = mediaan van de flux van de laatste VENSTER seconden ×
 * DREMPEL, plus VLOER. De vloer telt OP, niet als ondergrens: na een klap
 * sterft het geluid uit en is de flux een tijdje ~0, waardoor de mediaan
 * zakt en gewone ruis er anders ×1,4 overheen kwam (gemeten in de test:
 * twee keer zoveel "klappen" als er waren).
 */
export const ONSET_DREMPEL = 1.4;
export const ONSET_REFRACTAIR = 0.08;
export const ONSET_VENSTER = 1;
export const ONSET_VLOER = 0.01;       // gemiddeld 1% van het bereik per bin erbij: daaronder is het ruis
export const ONSET_TAU = 0.1;

/**
 * Eén stap gladmaken over dt seconden. Met een vaste invoer geeft 1 stap van
 * 0,1 s precies hetzelfde als 10 stappen van 0,01 s.
 */
export function glad(vorige, nieuw, dt, tau) {
  if (vorige == null || !(tau > 0)) return nieuw;
  if (!(dt > 0)) return vorige;              // geen tijd verstreken: niets veranderd
  return nieuw + (vorige - nieuw) * Math.exp(-dt / tau);
}

/** Gladmaken met een eigen τ omhoog en omlaag. */
export const gladOpNeer = (vorige, nieuw, dt, op = OPKOMST_TAU, neer = UITSTERF_TAU) =>
  glad(vorige, nieuw, dt, nieuw > vorige ? op : neer);

const isByte = (s) => s instanceof Uint8Array || s instanceof Uint8ClampedArray;

/** dB van bin i, voor beide soorten invoer. */
function dbVan(spectrum, i, minDb, maxDb, byte) {
  return byte ? minDb + (spectrum[i] / 255) * (maxDb - minDb) : spectrum[i];
}

/** Welke bins bij [lo, hi) Hz horen. */
export function binBereik(lo, hi, sampleRate, bins) {
  const hzPerBin = sampleRate / (bins * 2);
  const van = Math.max(0, Math.ceil(lo / hzPerBin));
  const tot = Math.min(bins, Math.ceil(hi / hzPerBin));
  return [van, tot];
}

/**
 * De banden en het zwaartepunt van één spectrum, zonder gladmaken.
 * Een band = het GEMIDDELDE VERMOGEN van zijn bins, terug naar dB en dan op
 * minDb..maxDb gelegd. Vermogen en niet het gemiddelde in dB: één toon in een
 * brede band (hoog telt ~850 bins) zou anders wegvallen tegen de lege rest.
 */
export function banden(spectrum, sampleRate, { minDb = MIN_DB, maxDb = MAX_DB } = {}) {
  const bins = spectrum.length;
  const byte = isByte(spectrum);
  const uit = {};
  for (const [naam, [lo, hi]] of Object.entries(BANDEN)) {
    const [van, tot] = binBereik(lo, hi, sampleRate, bins);
    let som = 0;
    for (let i = van; i < tot; i++) som += Math.pow(10, dbVan(spectrum, i, minDb, maxDb, byte) / 10);
    const db = tot > van ? 10 * Math.log10(som / (tot - van)) : -Infinity;
    const [b0, b1] = BAND_DB[naam];
    uit[naam] = clamp((db - b0) / (b1 - b0));
  }
  // Zwaartepunt: vermogen-gewogen gemiddelde frequentie, op een log-schaal.
  const [clo, chi] = CENTROID_BEREIK;
  const [van, tot] = binBereik(clo, chi, sampleRate, bins);
  const hzPerBin = sampleRate / (bins * 2);
  let som = 0, gewogen = 0;
  const vloer = Math.pow(10, BAND_DB.hoog[0] / 10);   // wat daaronder zit is ruis, telt niet mee
  for (let i = van; i < tot; i++) {
    const p = Math.pow(10, dbVan(spectrum, i, minDb, maxDb, byte) / 10);
    if (!(p > vloer)) continue;
    som += p; gewogen += p * i * hzPerBin;
  }
  uit.centroid = som > 0 ? clamp(Math.log(gewogen / som / clo) / Math.log(chi / clo)) : 0;
  return uit;
}

/**
 * Luidheid uit het tijdsignaal: Float32 (-1..1, getFloatTimeDomainData) of
 * Uint8 (128 = nul, getByteTimeDomainData). RMS_DB[0] dBFS = 0, RMS_DB[1] = 1.
 */
export function rms(td) {
  if (!td || !td.length) return 0;
  const byte = isByte(td);
  let som = 0;
  for (let i = 0; i < td.length; i++) {
    const v = byte ? (td[i] - 128) / 128 : td[i];
    som += v * v;
  }
  const r = Math.sqrt(som / td.length);
  if (!(r > 0)) return 0;
  return clamp((20 * Math.log10(r) - RMS_DB[0]) / (RMS_DB[1] - RMS_DB[0]));
}

/**
 * Spectrum als 0..1 per bin (op de dB-schaal), tot en met 12 kHz: de invoer
 * voor de flux. Schrijft in `uit` als die lang genoeg is (geen nieuwe array per beeld).
 */
export function spectrum01(spectrum, sampleRate, { minDb = MIN_DB, maxDb = MAX_DB } = {}, uit) {
  const bins = spectrum.length;
  const [van, tot] = binBereik(BANDEN.laag[0], BANDEN.hoog[1], sampleRate, bins);
  const n = tot - van;
  const r = uit && uit.length === n ? uit : new Float32Array(n);
  const byte = isByte(spectrum);
  const [f0, f1] = FLUX_DB;
  for (let i = 0; i < n; i++) r[i] = clamp((dbVan(spectrum, van + i, minDb, maxDb, byte) - f0) / (f1 - f0));
  return r;
}

/**
 * Spectrale flux: gemiddelde toename per bin (alleen wat erbij komt telt).
 * Met `grenzen` ([[van, tot], …], indexen in `nu`) telt elk stuk even zwaar:
 * het gemiddelde van de gemiddelden. Anders tellen de ~430 bins boven 2 kHz
 * vijf keer zo zwaar als bas en midden samen, en vond de detector op
 * nummers zonder hoog (twee van Clay's acht) geen enkele klap.
 */
export function flux(vorig, nu, grenzen = [[0, nu.length]]) {
  if (!vorig || vorig.length !== nu.length || !nu.length) return 0;
  let totaal = 0, stukken = 0;
  for (const [van, tot] of grenzen) {
    if (tot <= van) continue;
    let som = 0;
    for (let i = van; i < tot; i++) { const d = nu[i] - vorig[i]; if (d > 0) som += d; }
    totaal += som / (tot - van); stukken++;
  }
  return stukken ? totaal / stukken : 0;
}

/** De banden als indexen in de uitvoer van spectrum01 (die begint bij 40 Hz). */
export function bandGrenzen(sampleRate, bins) {
  const [begin] = binBereik(BANDEN.laag[0], BANDEN.hoog[1], sampleRate, bins);
  return Object.values(BANDEN).map(([lo, hi]) => binBereik(lo, hi, sampleRate, bins).map((i) => i - begin));
}

const mediaan = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Onset-detector op spectrale flux. Een klap = flux boven de mediaan van de
 * laatste `venster` seconden × `drempel` + `vloer`, en niet binnen
 * `refractair` seconden na de vorige. Het venster en de refractaire tijd zijn
 * in SECONDEN: op 30 of 120 beelden per seconde dezelfde klappen.
 */
export class OnsetDetector {
  constructor({ drempel = ONSET_DREMPEL, refractair = ONSET_REFRACTAIR, venster = ONSET_VENSTER,
    vloer = ONSET_VLOER, tau = ONSET_TAU } = {}) {
    Object.assign(this, { drempel, refractair, venster, vloer, tau });
    this.reset();
  }

  reset() {
    this.geschiedenis = [];   // [{ t, f }], oudste eerst
    this.laatste = -Infinity; // tijd van de laatste klap
  }

  /** Een nieuwe fluxwaarde op tijd t. Geeft true als dit een klap is. */
  stap(t, f) {
    if (this.geschiedenis.length && t < this.geschiedenis[this.geschiedenis.length - 1].t) this.reset();
    while (this.geschiedenis.length && this.geschiedenis[0].t < t - this.venster) this.geschiedenis.shift();
    this.drempelNu = mediaan(this.geschiedenis.map((x) => x.f)) * this.drempel + this.vloer;
    this.geschiedenis.push({ t, f });
    if (f > this.drempelNu && t - this.laatste >= this.refractair) {
      this.laatste = t;
      return true;
    }
    return false;
  }

  /** De omhullende op tijd t: 1 op de klap, dan exp(-(t - klap)/τ). Rekent vanaf de klap, niet per beeld. */
  omhullende(t) {
    const d = t - this.laatste;
    return d >= 0 && Number.isFinite(d) ? Math.exp(-d / this.tau) : 0;
  }
}

/**
 * Alles samen, met toestand: gladde banden, de vorige spectrumstand voor de
 * flux en de onset-detector. Eén `stap` per beeld; dezelfde t twee keer
 * (twee lagen in één beeld) geeft hetzelfde terug zonder iets te veranderen.
 */
export class Kenmerken {
  constructor(opties = {}) {
    this.opties = opties;
    this.onsets = new OnsetDetector(opties.onset);
    this.reset();
  }

  reset() {
    this.t = null;
    this.vorigSpectrum = null;
    this.nuSpectrum = null;
    this.onsets.reset();
    this.waarden = { laag: 0, midden: 0, hoog: 0, rms: 0, centroid: 0, onset: 0, klap: false, flux: 0 };
  }

  /**
   * @param t          seconden (audioklok)
   * @param spectrum   Float32 dB of Uint8, fftSize/2 bins
   * @param sampleRate van de AudioContext
   * @param td         tijdsignaal voor rms (optioneel; zonder is rms 0)
   * @param bereik     { minDb, maxDb } van de analyser
   */
  stap(t, spectrum, sampleRate, td = null, bereik = {}) {
    if (this.t !== null && t === this.t) return this.waarden;
    if (this.t !== null && (t < this.t || t - this.t > 1)) this.reset();   // nieuwe klok of lang stil: opnieuw beginnen
    const dt = this.t === null ? 0 : t - this.t;
    const eerste = this.t === null;
    this.t = t;

    const b = banden(spectrum, sampleRate, bereik);
    const w = this.waarden;
    const nw = { ...w };
    for (const k of ['laag', 'midden', 'hoog', 'centroid']) nw[k] = eerste ? b[k] : gladOpNeer(w[k], b[k], dt);
    const r = rms(td);
    nw.rms = eerste ? r : gladOpNeer(w.rms, r, dt);

    // Twee buffers om de beurt: geen nieuwe array per beeld.
    const nu = spectrum01(spectrum, sampleRate, bereik, this.vorigSpectrum);
    this.vorigSpectrum = this.nuSpectrum;
    this.nuSpectrum = nu;
    if (!this.grenzen || this.grenzenVoor !== `${sampleRate}/${spectrum.length}`) {
      this.grenzen = bandGrenzen(sampleRate, spectrum.length);
      this.grenzenVoor = `${sampleRate}/${spectrum.length}`;
    }
    nw.flux = eerste ? 0 : flux(this.vorigSpectrum, nu, this.grenzen);
    nw.klap = eerste ? false : this.onsets.stap(t, nw.flux);
    nw.onset = this.onsets.omhullende(t);
    this.waarden = nw;
    return nw;
  }
}
