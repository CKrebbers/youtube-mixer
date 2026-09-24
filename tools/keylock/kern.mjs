/**
 * Signalsmith Stretch 1.3.2 in Node: zonder browser, zonder AudioWorklet.
 *
 * Drie manieren om hem te draaien, zodat de proef de opties uit
 * docs/KEYLOCK.md naast elkaar kan zetten:
 *
 *   laadFabriek()        de Emscripten-fabriek (WASM + glue), los van de
 *                        schil van Signalsmith. Dit is wat er in onze EIGEN
 *                        worklet (stream-lezer.js) zou komen: optie A.
 *   Kern                 één stretcher op de ruwe exports (_seek, _process,
 *                        _setTransposeSemitones ...). Buffers één keer
 *                        aangemaakt, geen allocaties per blok.
 *   StretchSpeler        een deck zoals optie A hem zou draaien: segment
 *                        {T, P, R} op de audioklok, invoer STREAMEND gevoed,
 *                        springen = seek, latentie gecompenseerd.
 *   laadProcessor()      de AudioWorkletProcessor van Signalsmith zelf (hun
 *                        schil, onveranderd), met nagebootste worklet-
 *                        globalen. Optie C, en de basis van optie B.
 *
 * Node is geen AudioWorklet: geen realtime-thread, geen render-quantum van
 * de browser. Wel dezelfde V8 en dezelfde WASM. Rekentijd is daarom een
 * redelijke schatting, geen meting in Chrome.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HIER = path.dirname(fileURLToPath(import.meta.url));
export const VERSIE = '1.3.2';
/** Uit `npm view signalsmith-stretch@1.3.2 dist.integrity`, 24 september 2026. */
export const INTEGRITEIT = 'sha512-tJqRbwPCoWLSHXwO29UQ75u72IwPsHns3RG+TKzuOAp7OduJiJMzEtz32JEFbPFQcTR7aiKCIVc+/Kzw8bMZUw==';
export const PAKKET_MAP = path.join(HIER, 'pakket');
export const PAKKET = path.join(PAKKET_MAP, 'package', 'SignalsmithStretch.mjs');

/** Controleert de tarball tegen de integriteit uit het npm-register. */
export function controleerTarball(tgz) {
  const h = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  if (h !== INTEGRITEIT) throw new Error(`tarball klopt niet met het register:\n  ${h}\n  ${INTEGRITEIT}`);
  return h;
}

function leesPakket(bestand) {
  if (!fs.existsSync(bestand)) {
    throw new Error(`${bestand} ontbreekt. Eerst: node tools/keylock/proef.mjs haal`);
  }
  return fs.readFileSync(bestand, 'utf8');
}

// Hier houdt de Emscripten-fabriek op en begint de schil van Signalsmith.
const GRENS = "if (typeof exports === 'object' && typeof module === 'object')";

/**
 * De Emscripten-fabriek: `await fabriek()` geeft een module met één
 * stretcher. `process`, `require`, `window` en `document` zijn verborgen,
 * zodat Emscripten zich gedraagt zoals in een AudioWorkletGlobalScope
 * ("shell": WASM uit de data-URI, synchroon gedecodeerd, async geïnstantieerd).
 *
 * Waarom knippen: importeer je het .mjs-bestand ín een worklet, dan ziet het
 * `registerProcessor`, registreert het ZIJN processor en exporteert `{}`.
 * De fabriek is dan onbereikbaar. Voor optie A moet hij dus apart.
 */
export function laadFabriek(bestand = PAKKET) {
  const src = leesPakket(bestand);
  const eind = src.indexOf(GRENS);
  if (eind < 0) throw new Error('onverwachte opbouw van SignalsmithStretch.mjs (grens niet gevonden)');
  const maak = new Function('process', 'require', 'window', 'document', `${src.slice(0, eind)}\nreturn SignalsmithStretch;`);
  return maak(undefined, undefined, undefined, undefined);
}

/** Bestanden, grootte en de WASM erin, voor het rapport. */
export function pakketInfo(bestand = PAKKET) {
  const src = leesPakket(bestand);
  const b64 = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/.exec(src)?.[1] ?? '';
  const map = path.dirname(bestand);
  const bestanden = fs.readdirSync(map).map((n) => ({ naam: n, bytes: fs.statSync(path.join(map, n)).size }));
  const pkg = JSON.parse(fs.readFileSync(path.join(map, 'package.json'), 'utf8'));
  return {
    bestanden, licentie: pkg.license, versie: pkg.version,
    licentieBestand: bestanden.some((b) => /^licen[cs]e/i.test(b.naam)),
    wasmBase64: b64.length, wasmBytes: Buffer.from(b64, 'base64').length,
  };
}

// ---- één stretcher op de ruwe exports ---------------------------------------

export const PRESETS = {
  standaard: { blockMs: 120, intervalMs: 30, split: false },
  'standaard-gespreid': { blockMs: 120, intervalMs: 30, split: true },
  goedkoper: { blockMs: 100, intervalMs: 40, split: false },
  'goedkoper-gespreid': { blockMs: 100, intervalMs: 40, split: true },
  kort: { blockMs: 60, intervalMs: 15, split: false },
};

/**
 * Eén stretcher (= één WASM-instantie: de glue van Signalsmith heeft één
 * globaal stretch-object per module). Buffers worden één keer aangemaakt;
 * `in`/`uit` zijn Float32-views in het WASM-geheugen.
 */
export class Kern {
  static async maak(fabriek, opties = {}) { return new Kern(await fabriek(), opties); }

  constructor(M, { kanalen = 2, sr = 48000, preset = 'standaard', max = 16384 } = {}) {
    this.M = M;
    this.kanalen = kanalen;
    this.sr = sr;
    const p = typeof preset === 'string' ? PRESETS[preset] : preset;
    if (!p) throw new Error(`onbekende preset ${preset}`);
    this.preset = p;
    M._configure(kanalen, Math.round(p.blockMs / 1000 * sr), Math.round(p.intervalMs / 1000 * sr), !!p.split);
    M._reset();
    this.inLat = M._inputLatency();
    this.uitLat = M._outputLatency();
    this.blok = M._blockSamples();
    this.interval = M._intervalSamples();
    this.lengte = Math.max(max, this.inLat + this.uitLat);
    this.ptr = M._setBuffers(kanalen, this.lengte);
    this._views();
    this.toon(0);
  }

  _views() {
    const buf = this.M.HEAP8.buffer;
    this._buf = buf;
    this.in = []; this.uit = [];
    for (let c = 0; c < this.kanalen; c++) {
      this.in.push(new Float32Array(buf, this.ptr + this.lengte * 4 * c, this.lengte));
      this.uit.push(new Float32Array(buf, this.ptr + this.lengte * 4 * (c + this.kanalen), this.lengte));
    }
  }

  /** Na geheugengroei zijn de oude views leeg; opnieuw maken. */
  _check() { if (this.M.HEAP8.buffer !== this._buf) this._views(); }

  toon(semitonen, tonalityHz = 8000) {
    this.M._setTransposeSemitones(semitonen, tonalityHz / this.sr);
  }

  formant(semitonen = 0, compensatie = false, baseHz = 0) {
    this.M._setFormantSemitones(semitonen, compensatie);
    this.M._setFormantBase(baseHz / this.sr);
  }

  seek(n, rate) { this.M._seek(n, rate); this._check(); }
  process(nIn, nUit) { this.M._process(nIn, nUit); this._check(); }
  reset() { this.M._reset(); }
  get geheugen() { return this.M.HEAP8.buffer.byteLength; }
}

// ---- een deck zoals optie A ---------------------------------------------------

/** Positie in tracktijd op audiokloktijd t (zoals positieOp, zonder loop). */
export const positie = (seg, t) => (seg.speelt === false ? seg.P : seg.P + (t - seg.T) * seg.R);

/**
 * Een deck met keylock zoals optie A hem zou draaien, maar in Node.
 *
 * `bron(start, n, L, R)` levert n hele frames tracktijd vanaf frame `start`
 * (vóór het begin: stilte). In de app zou dat uit de pagina's komen.
 *
 * Per blok van 128 frames op audiokloktijd t0:
 *   doel = frame(positie(seg, t0 + uitLat + 128/sr)) + inLat
 * De invoer loopt dus inLat vóór en de uitvoer uitLat plus één blok: wat je
 * op t0 hoort is positie(seg, t0). Hetzelfde segment, dezelfde formule als
 * de hoofdthread: regel 3 over de draadgrens, ook met een stretcher ertussen.
 *
 * Past het doel op wat er al gevoerd is, dan streamen. Ligt het doel een
 * klein stukje TERUG (tempo omlaag: de vooruitblik van uitLat krimpt met
 * uitLat × ΔR), dan even niets voeren tot het doel weer voorligt. Verder
 * weg (seek, hotcue, loop terug, meer dan een interval) = een seek met een
 * venster vóór het doel.
 */
export class StretchSpeler {
  constructor(kern, bron) {
    this.k = kern;
    this.bron = bron;
    this.seg = { T: 0, P: 0, R: 1, speelt: true };
    this.eind = null;          // eerste frame dat de stretcher nog NIET gehad heeft
    this.semitonen = 0;
    this.seeks = 0;
  }

  /**
   * Nieuw segment. Mag een T in de toekomst hebben (geplande sprong): tot T
   * geldt het vorige. Dezelfde regel zou de hoofdthread volgen.
   */
  zet(seg) { this.vorig = this.seg; this.seg = { speelt: true, ...seg }; }

  _pos(t) { return this.vorig && t < this.seg.T ? positie(this.vorig, t) : positie(this.seg, t); }

  toon(s) { if (s !== this.semitonen) { this.semitonen = s; this.k.toon(s); } }

  /** Eén blok renderen naar uitL/uitR (vanaf index `o`). */
  blok(t0, uitL, uitR, frames = 128, o = 0) {
    const k = this.k;
    const sr = k.sr;
    // Vooruit = uitvoerlatentie PLUS dit blok: wat process() nu teruggeeft
    // hoort bij invoer die een blok later "klaar" is. Zonder die 128 frames
    // klonk alles 2,6 ms te laat (gemeten met klikken, controle 2).
    const doel = Math.round(this._pos(t0 + (k.uitLat + frames) / sr) * sr) + k.inLat;
    const n = this.eind === null ? null : doel - this.eind;
    if (n === null || n < -k.interval || n > frames * Math.abs(this.seg.R) + k.interval) {
      const len = k.inLat + k.uitLat;
      this.bron(doel - len, len, k.in[0], k.in[1]);
      k.seek(len, this.seg.R);
      this.seeks++;
      k.process(0, frames);
      this.eind = doel;
    } else if (n > 0) {
      this.bron(this.eind, n, k.in[0], k.in[1]);
      k.process(n, frames);
      this.eind = doel;
    } else {
      k.process(0, frames);            // wachten: de invoer ligt al voor
    }
    if (uitL) {
      uitL.set(k.uit[0].subarray(0, frames), o);
      uitR.set(k.uit[1].subarray(0, frames), o);
    }
  }

  /**
   * Opwarmen zonder latentie: stretcher leeg, en `voor` seconden vóór t0
   * alvast draaien alsof hij al speelde. Daarna klinkt blok(t0) meteen
   * de nieuwe plek. Voor hotcue, play en seek met keylock.
   */
  voorrol(t0, voor) {
    this.k.reset();
    this.k.toon(this.semitonen);
    this.eind = null;
    this.vorig = null;
    const stap = 128 / this.k.sr;
    const n = Math.ceil(voor / stap);
    for (let i = n; i > 0; i--) this.blok(t0 - i * stap, null, null);
  }
}

/** Frames uit Float32-kanalen met een basis: stilte buiten het bereik. */
export function arrayBron(L, R, basis = 0) {
  return (start, n, uitL, uitR) => {
    for (let i = 0; i < n; i++) {
      const j = start + i - basis;
      const ok = j >= 0 && j < L.length;
      uitL[i] = ok ? L[j] : 0;
      uitR[i] = ok ? R[j] : 0;
    }
  };
}

/**
 * Een loop voor de stretcher: de INVOER loopt uitgerold door de loop
 * (virtueel frame v ≥ einde → terug naar het begin), met dezelfde naad als
 * leesSegment in de streamkern: de laatste `naad` s vóór het einde vloeien
 * equal-power over naar wat er vlak vóór het BEGIN staat. De stretcher ziet
 * zo één doorlopend signaal en hoeft bij de naad niet te seeken.
 */
export function loopArrayBron(L, R, basis, loop, sr, naad = 0.005) {
  const a = Math.round(loop.start * sr), b = Math.round(loop.end * sr), len = b - a;
  const nd = Math.max(0, Math.min(Math.round(naad * sr), Math.floor(len / 4), a));
  const x = (arr, f) => { const j = f - basis; return j >= 0 && j < arr.length ? arr[j] : 0; };
  return (start, n, uitL, uitR) => {
    for (let i = 0; i < n; i++) {
      let v = start + i;
      if (v >= b) v = a + ((v - a) % len);
      const rest = b - v;
      if (v >= a && rest <= nd && rest > 0) {
        const w = 1 - rest / nd, p = Math.cos((w * Math.PI) / 2), q = Math.sin((w * Math.PI) / 2);
        uitL[i] = p * x(L, v) + q * x(L, a - rest);
        uitR[i] = p * x(R, v) + q * x(R, a - rest);
      } else { uitL[i] = x(L, v); uitR[i] = x(R, v); }
    }
  };
}

// ---- de worklet van Signalsmith zelf, nagebootst ------------------------------

/**
 * De AudioWorkletProcessor-klasse uit het pakket, onveranderd. We bootsen
 * `AudioWorkletProcessor`, `registerProcessor`, `sampleRate` en
 * `currentTime` na, en draaien `process()` zelf. Zo meet je hun schil
 * (constant seeken, allocaties per blok) en niet onze eigen.
 */
export function laadProcessor(bestand = PAKKET) {
  let src = leesPakket(bestand);
  src = src.replace(/let _export=SignalsmithStretch;export default _export;\s*$/, '');
  let klasse = null;
  class NepProcessor {
    constructor() {
      this.berichten = [];
      this.port = { postMessage: (m) => this.berichten.push(m), onmessage: null };
    }
  }
  const f = new Function('AudioWorkletProcessor', 'registerProcessor', 'process', 'require', 'window', 'document', src);
  f(NepProcessor, (_naam, k) => { klasse = k; }, undefined, undefined, undefined, undefined);
  if (!klasse) throw new Error('processor niet geregistreerd');
  return klasse;
}

/** Een processor maken en wachten tot de WASM klaar is. */
export async function maakProcessor(Klasse, sr = 48000) {
  globalThis.sampleRate = sr;
  globalThis.currentTime ??= 0;
  const p = new Klasse({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  for (let i = 0; i < 200 && !p.wasmReady; i++) await new Promise((r) => setTimeout(r, 5));
  if (!p.wasmReady) throw new Error('WASM niet klaar');
  let id = 0;
  p.roep = (methode, ...args) => { p.port.onmessage({ data: [id++, methode, ...args] }); };
  return p;
}

// ---- WAV lezen (alleen lezen) ---------------------------------------------------

/**
 * Een stuk uit media/<id>/audio.wav als Float32 L/R, zonder het hele bestand
 * te openen. `kop` uit leesWavKop (src/engine/stream-kern.js).
 */
export function leesStuk(bestand, kop, vanFrame, n) {
  const fd = fs.openSync(bestand, 'r');
  try {
    const max = kop.dataLengte / 4;
    const a = Math.max(0, Math.min(max, vanFrame)), b = Math.max(a, Math.min(max, vanFrame + n));
    const buf = Buffer.alloc((b - a) * 4);
    fs.readSync(fd, buf, 0, buf.length, kop.dataStart + a * 4);
    const pcm = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < b - a; i++) { L[a - vanFrame + i] = pcm[i * 2] / 32768; R[a - vanFrame + i] = pcm[i * 2 + 1] / 32768; }
    return { L, R };
  } finally { fs.closeSync(fd); }
}

/** De ruwe bytes van een reeks pagina's, voor renderBlok (Map pagina -> Int16Array). */
export function leesPaginas(bestand, kop, p0, p1, PAGINA) {
  const fd = fs.openSync(bestand, 'r');
  const paginas = new Map();
  try {
    for (let p = p0; p <= p1; p++) {
      const start = kop.dataStart + p * PAGINA * 4;
      const len = Math.min(PAGINA * 4, kop.dataStart + kop.dataLengte - start);
      if (len <= 0) break;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      paginas.set(p, new Int16Array(buf.buffer, buf.byteOffset, len / 2));
    }
  } finally { fs.closeSync(fd); }
  return paginas;
}
