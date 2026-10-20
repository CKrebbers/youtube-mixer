// Herkomst: v1 youtube-mixer/src/engine/instrumenten/drums.js @ 6a640ac. Wat anders is in v2:
// zetParam(k, v, t) met een tijd (ParamLijn): KICK/SNARE/HATS rekenen de pad opnieuw als de
// knop op het moment van de aanslag anders staat dan waarmee hij gerekend is (dus ook per stap,
// een p-lock), en het instrument meldt zijn knoppen zelf ('param'). NIVEAU gebruikt faderGain
// van de v2-strip (gelijk aan v1 behalve helemaal dicht: daar is v2 echt stil).
import { clamp, expMap, Emitter } from '../../kern/emitter.js';
import { startDrempel } from '../overgang.js';
import { faderGain } from '../strip.js';
import { ParamLijn, tijdOp, komma, hz } from './hulp.js';

/*
 * Drums: een drumcomputer als instrument.
 *
 * Zestien pads op MIDI-noot 36–51: pad 1 = noot 36, linksonder op de Maschine, en dan per rij
 * van vier naar boven. Elke andere noot valt erop terug met (noot − 36) mod 16, dus elke noot
 * doet iets (oogst produceren-026: dit is een contract met patronen en de MIDI-export).
 *
 *   pads 1–8   een kit, ter plekke gerekend met een zaad (de geluiden van Elektronlearn,
 *              aangevuld met een clap en een tom)
 *   pads 9–16  leeg; laadPad() zet er een AudioBuffer op
 *
 * Per aanslag één stem met native nodes: bron ─► [drive] ─► filter ─► versterking ─► pan ─► uit.
 * Geen worklet. Elke pad is mono: een nieuwe aanslag kapt de vorige van dezelfde pad af; de twee
 * hats zijn één groep. Afkappen is altijd een korte lineaire helling naar precies 0.
 */

export const EERSTE_NOOT = 36;
export const AANTAL_PADS = 16;
export const KIT_PADS = 8;
export const MAX_STEMMEN = 12;
/** Choke, dezelfde pad opnieuw, stemroof: in zoveel seconden naar 0. */
export const KAP = 0.006;
/** Paniek (stil()). */
export const STIL = 0.012;
const EIND_FADE = 0.005;
const EIGEN_IN = 0.002;
const EIGEN_UIT = 0.005;
/** Resonantie van het filter, in dB (Web Audio-lowpass: een piek, geen factor). */
const FILTER_Q = 1;
/**
 * Luidheid naast een nummer (−14 LUFS). v1 gemeten (Chrome, BS.1770): een maat vier-op-de-vloer
 * op 124 bpm (kick op elke tel, snare op 2 en 4, gesloten hat op elke achtste ertussen),
 * snelheid 0,8: zonder ophoging −25,1 LUFS, met ×3,6 −14,0 LUFS. v2: tools/proef-instr.mjs.
 */
export const UIT_OPHOGING = 3.6;

// ---- de kit (Elektronlearn src/audio/sounds.js, met hetzelfde zaad) ---------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const env = (t, tau) => Math.exp(-t / tau);

function normaliseer(data, piek = 0.92) {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (max === 0) return data;
  const g = piek / max;
  for (let i = 0; i < data.length; i++) data[i] *= g;
  return data;
}

/** Een geluid rekenen: `fn(t, c, i)` per sample, dan normaliseren en uitfaden. */
function reken(sr, seconden, fn) {
  const n = Math.floor(sr * seconden);
  const data = new Float32Array(n);
  const rnd = mulberry32(0x5eed);
  let lp = 0, hp = 0, vorige = 0;
  const c = {
    sr,
    ruis: () => rnd() * 2 - 1,
    laagdoorlaat: (x, k) => (lp += k * (x - lp)),
    hoogdoorlaat: (x, k) => { hp = k * (hp + x - vorige); vorige = x; return hp; },
  };
  for (let i = 0; i < n; i++) data[i] = fn(i / sr, c, i);
  normaliseer(data);
  const m = Math.min(n, Math.round(EIND_FADE * sr));
  for (let j = 0; j < m; j++) data[n - 1 - j] *= Math.sin((Math.PI / 2) * j / m) ** 2;   // laatste precies 0
  return data;
}

const zaag = (t, f) => 2 * ((t * f) % 1) - 1;

/** KICK: ±7 halve tonen rond 48 Hz; 0,5 = Elektronlearn. */
export const kickVerhouding = (v) => Math.pow(2, (clamp(v) - 0.5) * 14 / 12);
/** HATS: de staart van beide hats ×0,35 … ×2,86; 0,5 = Elektronlearn. */
export const hatFactor = (v) => Math.pow(1 / 0.35, clamp(v) * 2 - 1);

/** De kit, pads 1–8. `hangtAf` = welke knop het geluid opnieuw laat rekenen; `groep` = wie elkaar afkappen. */
export const KIT = [
  {
    naam: 'KICK', niveau: 1, pan: 0, hangtAf: 'kick',
    maak: (sr, p) => {
      const r = kickVerhouding(p.kick);
      return reken(sr, 0.60, (t) => {
        const f = r * (48 + 82 * env(t, 0.035));
        const tik = env(t, 0.0025) * 0.5;
        return Math.sin(2 * Math.PI * f * t) * env(t, 0.16) + tik;
      });
    },
  },
  {
    naam: 'SNARE', niveau: 0.8, pan: 0, hangtAf: 'snare',
    maak: (sr, p) => {
      const vel = 1.4 * (1 - clamp(p.snare)), snaar = 2 * clamp(p.snare);
      return reken(sr, 0.35, (t, c) => {
        const toon = Math.sin(2 * Math.PI * 186 * t) * env(t, 0.055) * vel;
        const lijf = c.hoogdoorlaat(c.ruis(), 0.72) * env(t, 0.09) * snaar;
        return toon + lijf;
      });
    },
  },
  {
    naam: 'CLAP', niveau: 0.95, pan: 0,
    maak: (sr) => {
      let a = 0;
      return reken(sr, 0.40, (t, c) => {
        const stoot = (u) => (u >= 0 ? env(u, 0.004) : 0);
        const stoten = stoot(t) + stoot(t - 0.011) + stoot(t - 0.022);
        const staart = t >= 0.03 ? env(t - 0.03, 0.075) * 0.7 : 0;
        a += 0.3 * (c.laagdoorlaat(c.hoogdoorlaat(c.ruis(), 0.88), 0.3) - a);
        return a * (stoten + staart);
      });
    },
  },
  {
    naam: 'HAT', niveau: 0.5, pan: 0.15, hangtAf: 'hats', groep: 'hats',
    maak: (sr, p) => {
      const f = hatFactor(p.hats);
      return reken(sr, 0.12 * f, (t, c) => c.hoogdoorlaat(c.ruis(), 0.92) * env(t, 0.016 * f));
    },
  },
  {
    naam: 'TOM', niveau: 0.45, pan: -0.15,
    maak: (sr) => {
      let fase = 0;
      return reken(sr, 0.55, (t, c) => {
        fase += 2 * Math.PI * (120 + 60 * env(t, 0.05)) / sr;
        const tik = c.hoogdoorlaat(c.ruis(), 0.8) * env(t, 0.006) * 0.3;
        return Math.sin(fase) * env(t, 0.2) + tik;
      });
    },
  },
  {
    naam: 'RIM', niveau: 0.9, pan: -0.2,
    maak: (sr) => reken(sr, 0.12, (t, c) => {
      const toon = Math.sin(2 * Math.PI * 420 * t) * env(t, 0.012);
      return (toon + c.hoogdoorlaat(c.ruis(), 0.85) * 0.6) * env(t, 0.02);
    }),
  },
  {
    naam: 'BAS', niveau: 0.7, pan: 0,
    maak: (sr) => reken(sr, 0.80, (t, c) => {
      const kantel = 0.06 + 0.5 * env(t, 0.10);
      return c.laagdoorlaat(zaag(t, 55) * 0.9 + zaag(t, 55.4) * 0.5, kantel) * env(t, 0.22);
    }),
  },
  {
    naam: 'HAT OPEN', niveau: 0.3, pan: 0.15, hangtAf: 'hats', groep: 'hats',
    maak: (sr, p) => {
      const f = hatFactor(p.hats);
      return reken(sr, 0.55 * f, (t, c) => c.hoogdoorlaat(c.ruis(), 0.90) * env(t, 0.13 * f));
    },
  },
];

/** Welke pad (1..16) een MIDI-noot raakt: (noot − 36) mod 16. */
export const padVanNoot = (noot) => ((((Math.round(noot) - EERSTE_NOOT) % AANTAL_PADS) + AANTAL_PADS) % AANTAL_PADS) + 1;

/** Kappen pad a en pad b (0-geteld) elkaar af? Dezelfde pad altijd. */
const kapt = (a, b) => a === b || (a < KIT_PADS && b < KIT_PADS && !!KIT[a].groep && KIT[a].groep === KIT[b].groep);

/** Snelheid 0..1 → versterking: v^1,5 (halve snelheid −9 dB, 0,8 −2,9 dB). */
export const snelheidGain = (s) => Math.pow(clamp(s), 1.5);

// ---- de acht parameters ---------------------------------------------------
export const toonHalveTonen = (v) => Math.round((clamp(v) - 0.5) * 24);
export const decayLengte = (v) => (clamp(v) >= 0.98 ? null : expMap(clamp(v) / 0.98, 0.03, 3));
export const filterHz = (v) => (clamp(v) >= 0.999 ? Infinity : expMap(v, 50, 24000));
export const driveTrap = (v) => Math.round(clamp(v) * 16);

export const PARAMS = Object.freeze([
  { id: 'toon', label: 'TOON', standaard: 0.5,
    eenheid: (v) => { const s = toonHalveTonen(v); return s === 0 ? '0' : `${s > 0 ? '+' : '−'}${Math.abs(s)} ${Math.abs(s) === 1 ? 'halve toon' : 'halve tonen'}`; } },
  { id: 'decay', label: 'DECAY', standaard: 1,
    eenheid: (v) => { const l = decayLengte(v); return l === null ? 'vol' : l < 1 ? `${Math.round(l * 1000)} ms` : `${komma(l)} s`; } },
  { id: 'filter', label: 'FILTER', standaard: 1,
    eenheid: (v) => { const f = filterHz(v); return f === Infinity ? 'open' : hz(f); } },
  { id: 'drive', label: 'DRIVE', standaard: 0,
    eenheid: (v) => (driveTrap(v) === 0 ? 'uit' : `${Math.round(driveTrap(v) / 16 * 100)}%`) },
  { id: 'kick', label: 'KICK', standaard: 0.5, eenheid: (v) => hz(48 * kickVerhouding(v)) },
  { id: 'snare', label: 'SNARE', standaard: 0.5, eenheid: (v) => `snaar ${Math.round(clamp(v) * 100)}%` },
  { id: 'hats', label: 'HATS', standaard: 0.5, eenheid: (v) => `open ${Math.round(550 * hatFactor(v))} ms` },
  { id: 'niveau', label: 'NIVEAU', standaard: 0.8,
    eenheid: (v) => {
      if (clamp(v) <= 0.001) return 'stil';
      const db = 20 * Math.log10(faderGain(v) / faderGain(0.8));
      return `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${komma(Math.abs(db))} dB`;
    } },
].map((p) => Object.freeze(p)));

const plekVan = (id) => PARAMS.findIndex((p) => p.id === id);
const P_TOON = plekVan('toon'), P_DECAY = plekVan('decay'), P_FILTER = plekVan('filter'), P_DRIVE = plekVan('drive');
const P_NIVEAU = plekVan('niveau');

/** De vervormer: tanh met trap d = trap/2, ongeveer even luid. Gedeeld: zeventien krommen. */
const krommen = new Map();
function driveKromme(trap) {
  if (krommen.has(trap)) return krommen.get(trap);
  const n = 2049, d = trap / 2, schaal = 1 / Math.sqrt(d * Math.tanh(d));
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) k[i] = Math.tanh(d * ((i / (n - 1)) * 2 - 1)) * schaal;
  krommen.set(trap, k);
  return k;
}

/**
 * De versterking van een stem op tijd t, uit zijn punten ({ t, v, lin }: lin = er loopt een
 * lineaire helling naar dit punt, anders springt hij erop), zoals Chrome de AudioParam afspeelt.
 */
export function waardeOp(punten, t) {
  let vorig = null;
  for (const p of punten) {
    if (p.t > t) return p.lin && vorig ? vorig.v + (p.v - vorig.v) * (t - vorig.t) / (p.t - vorig.t) : (vorig ? vorig.v : 0);
    vorig = p;
  }
  return vorig ? vorig.v : 0;
}

/** Een daling van 1 naar precies 0 die op een exponentiële lijkt (x = 0..1). */
const verval = (x) => (Math.exp(-5 * x) - Math.exp(-5)) / (1 - Math.exp(-5));

export class Drums extends Emitter {
  constructor(ctx, uit, { klok = null } = {}) {
    super();
    this.ctx = ctx;
    this.soort = 'drums';
    this.naam = 'Drums';
    this.params = PARAMS;
    this.klok = klok;
    this._lijn = PARAMS.map((p) => new ParamLijn(p.standaard));
    this.uit = ctx.createGain();
    this.uit.gain.value = this._uitGain(ctx.currentTime);
    this.uit.connect(uit);
    /** Per pad: de buffer (null = leeg of nog niet gerekend), naam, niveau, pan, en waarmee gerekend. */
    this.pads = Array.from({ length: AANTAL_PADS }, (_, i) => (i < KIT_PADS
      ? { naam: KIT[i].naam, buffer: null, niveau: KIT[i].niveau, pan: KIT[i].pan, met: null }
      : { naam: null, buffer: null, niveau: 1, pan: 0, met: null }));
    this.stemmen = [];
    this.buiging = 0;
    this.modulatie = 0;
    this.drukte = 0;
    this.houdt = false;
    /** Hoe vaak het vangnet van noteOn iets opving (laatsteFout = de laatste); de test eist 0. */
    this.fouten = 0;
    this.dood = false;
    this._start = null;
  }

  _v(i, t = this.ctx.currentTime) { return this._lijn[i].op(t); }

  /** De kit rekenen op de sampleRate van de context. Idempotent. */
  start() {
    if (!this._start) {
      try {
        if (!this.dood) for (let i = 0; i < KIT_PADS; i++) this._rekenKit(i, this._kitParams(this.ctx.currentTime));
        this._start = Promise.resolve();
      } catch (e) {
        this._start = Promise.reject(e);
      }
    }
    return this._start;
  }

  _kitParams(t) {
    return { kick: this._v(plekVan('kick'), t), snare: this._v(plekVan('snare'), t), hats: this._v(plekVan('hats'), t) };
  }

  _rekenKit(i, p) {
    const data = KIT[i].maak(this.ctx.sampleRate, p);
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.getChannelData(0).set(data);
    this.pads[i].buffer = buf;
    this.pads[i].met = KIT[i].hangtAf ? p[KIT[i].hangtAf] : null;
  }

  // ---- spelen ----

  noteOn(noot, snelheid, t) {
    if (this.dood) return;
    try {
      this._slaan(noot, snelheid, t);
    } catch (e) {
      // Laatste vangnet: een aanslag laat de aanroeper nooit struikelen.
      this.fouten++;
      this.laatsteFout = e;
    }
  }

  _slaan(noot, snelheid, t) {
    const n = Number(noot), s = Number(snelheid);
    if (!Number.isFinite(n) || !(s > 0)) return;
    const pi = padVanNoot(n) - 1;
    const pad = this.pads[pi];
    if (!pad.buffer) return;                       // leeg, of de kit is er nog niet
    const ctx = this.ctx, nu = ctx.currentTime;
    const t0 = tijdOp(ctx, t);
    // KICK/SNARE/HATS staan op het moment van de aanslag anders dan waarmee de pad gerekend
    // is: nu pas opnieuw rekenen (een kick kost ~3 ms; bij elke knopstap zou dat te veel zijn).
    if (pi < KIT_PADS && KIT[pi].hangtAf) {
      const p = this._kitParams(t0);
      if (p[KIT[pi].hangtAf] !== pad.met) this._rekenKit(pi, p);
    }
    // Een afkapping die NU begint valt soms al in wat de audiothread rendert: na de drempel.
    const kapVan = Math.max(t0, nu + startDrempel(ctx));
    this._vergeet(nu);

    for (const st of this.stemmen) if (!st.weg && st.t0 <= t0 && kapt(st.pad, pi)) this._kap(st, kapVan, KAP);
    for (let levend = this._levend(nu); levend.length >= MAX_STEMMEN; levend = this._levend(nu)) {
      const oudste = levend.reduce((a, b) => (b.t0 < a.t0 ? b : a));
      this._kap(oudste, kapVan, KAP);
    }

    const rate = this._rate(t0);
    const src = ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.playbackRate.value = rate;
    let kop = src;
    const trap = driveTrap(this._v(P_DRIVE, t0));
    let vorm = null;
    if (trap > 0) {
      vorm = ctx.createWaveShaper();
      vorm.curve = driveKromme(trap);
      vorm.oversample = '2x';
      kop.connect(vorm);
      kop = vorm;
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = FILTER_Q;
    filter.frequency.value = this._filterFreq(t0);
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = pad.pan;
    kop.connect(filter);
    filter.connect(g);
    g.connect(pan);
    pan.connect(this.uit);

    // Een mono-bron door een StereoPanner: −3 dB per kant op het midden; √2 maakt dat goed.
    const niveau = pad.niveau * snelheidGain(s) * (pad.buffer.numberOfChannels === 1 ? Math.SQRT2 : 1);
    const punten = [{ t: t0, v: niveau, lin: false }];
    g.gain.value = 0;
    g.gain.setValueAtTime(niveau, t0);
    src.start(t0);                                 // vóór stop(): andersom gooit Chrome
    const duur = pad.buffer.duration;
    let decayEind = Infinity;
    const lengte = decayLengte(this._v(P_DECAY, t0));
    if (lengte !== null && lengte < duur / rate) {
      // Vasthouden, dan in lineaire stukken naar precies 0 (geen curve, geen tik).
      const h = t0 + 0.3 * lengte, rest = 0.7 * lengte;
      g.gain.setValueAtTime(niveau, h);
      punten.push({ t: h, v: niveau, lin: false });
      for (let k = 1; k <= 8; k++) {
        const p = { t: h + rest * k / 8, v: niveau * verval(k / 8), lin: true };
        g.gain.linearRampToValueAtTime(p.v, p.t);
        punten.push(p);
      }
      decayEind = t0 + lengte;
      src.stop(decayEind + 0.001);
    }
    // Waar de stem in zijn buffer is: vanaf T staat hij op P (s) met snelheid R (regel 2).
    const st = { pad: pi, src, vorm, filter, g, pan, t0, punten, duur, decayEind, seg: { T: t0, P: 0, R: rate },
      eind: Math.min(t0 + duur / rate, decayEind), weg: false };
    src.onended = () => this._klaar(st);
    this.stemmen.push(st);
  }

  _levend(nu) { return this.stemmen.filter((st) => !st.weg && st.eind > nu); }

  /**
   * Een stem afkappen: vasthouden waar hij op `ts` is, dan lineair naar precies 0 in `duur`.
   * Het beginpunt op `ts` zetten we ZELF (uit de punten van de stem): cancelAndHoldAtTime zet
   * er alleen een als hij een helling doorsnijdt; anders begint de helling bij het VORIGE punt.
   */
  _kap(st, ts, duur) {
    if (st.weg && st.eind <= ts + duur) return;
    st.weg = true;
    const g = st.g.gain, v = waardeOp(st.punten, ts);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(ts);
    else g.cancelScheduledValues(ts);
    g.setValueAtTime(v, ts);
    g.linearRampToValueAtTime(0, ts + duur);
    st.punten = [...st.punten.filter((p) => p.t < ts), { t: ts, v, lin: true }, { t: ts + duur, v: 0, lin: true }];
    try { st.src.stop(ts + duur + 0.001); } catch (_) {}
    st.eind = Math.min(st.eind, ts + duur);
  }

  _klaar(st) {
    const i = this.stemmen.indexOf(st);
    if (i >= 0) this.stemmen.splice(i, 1);
    for (const n of [st.src, st.vorm, st.filter, st.g, st.pan]) { try { n?.disconnect(); } catch (_) {} }
    if (this.dood && !this.stemmen.length) this._los();
  }

  /** Vangnet als onended niet komt: een stem ver voorbij zijn einde gaat uit de lijst. */
  _vergeet(nu) {
    for (const st of [...this.stemmen]) if (st.eind < nu - 2) this._klaar(st);
  }

  noteOff() {}          // een drumgeluid klinkt uit; loslaten doet niets
  alleUit() {}          // idem

  /** Meteen stil (paniek): alles, ook wat nog gepland staat, in 12 ms naar 0. */
  stil() {
    const ts = this.ctx.currentTime + startDrempel(this.ctx);
    for (const st of this.stemmen) this._kap(st, ts, STIL);
  }

  druk(w) { this.drukte = clamp(w); }              // aftertouch: (nog) niets
  mod(w) { this.modulatie = clamp(w); }            // modwiel: (nog) niets
  houd(aan) { this.houdt = !!aan; }                // pedaal: loslaten doet toch niets

  /** Pitchbend −1..1 = ±2 halve tonen, op alles wat klinkt. */
  buig(w) {
    if (this.dood) return;
    this.buiging = clamp(Number(w), -1, 1);
    this._zetRate(this.ctx.currentTime);
  }

  // ---- pads 9–16 ----

  /**
   * Een AudioBuffer op pad 9..16. De pad krijgt een KOPIE (hooguit twee kanalen) met 2 ms in-
   * en 5 ms uitfade. Geeft false bij een pad of buffer die niet kan.
   */
  laadPad(pad, buffer, naam = null) {
    const i = Math.round(Number(pad)) - 1;
    if (this.dood || !(i >= KIT_PADS && i < AANTAL_PADS)) return false;
    if (!buffer || !(buffer.length > 0) || !(buffer.numberOfChannels > 0) || typeof buffer.getChannelData !== 'function') return false;
    const k = Math.min(2, buffer.numberOfChannels), n = buffer.length, sr = buffer.sampleRate;
    const kopie = this.ctx.createBuffer(k, n, sr);
    const nIn = Math.min(Math.round(EIGEN_IN * sr), Math.floor(n / 2));
    const nUit = Math.min(Math.round(EIGEN_UIT * sr), Math.floor(n / 2));
    for (let c = 0; c < k; c++) {
      const d = kopie.getChannelData(c);
      d.set(buffer.getChannelData(c));
      for (let j = 0; j < nIn; j++) d[j] *= Math.sin((Math.PI / 2) * j / nIn) ** 2;
      for (let j = 0; j < nUit; j++) d[n - 1 - j] *= Math.sin((Math.PI / 2) * j / nUit) ** 2;
    }
    this.pads[i] = { ...this.pads[i], buffer: kopie, naam: naam ?? `PAD ${i + 1}` };
    return true;
  }

  /** Pad 9..16 leeg; wat er nog klinkt fadet weg. */
  wisPad(pad) {
    const i = Math.round(Number(pad)) - 1;
    if (this.dood || !(i >= KIT_PADS && i < AANTAL_PADS) || !this.pads[i].buffer) return false;
    const ts = this.ctx.currentTime + startDrempel(this.ctx);
    for (const st of this.stemmen) if (st.pad === i) this._kap(st, ts, KAP);
    this.pads[i] = { ...this.pads[i], buffer: null, naam: null };
    return true;
  }

  // ---- parameters ----

  /** Plek k (1..8) vanaf `t` (leeg = nu). TOON, FILTER en NIVEAU ook op wat klinkt; de rest per aanslag. */
  zetParam(k, v, t) {
    const i = Math.round(Number(k)) - 1;
    if (this.dood || !(i >= 0 && i < PARAMS.length) || !Number.isFinite(Number(v))) return;
    const nu = this.ctx.currentTime, t1 = tijdOp(this.ctx, t);
    const lijn = this._lijn[i];
    lijn.ruim(nu);
    const voor = lijn.op(t1);
    lijn.zet(Number(v), t1);
    const w = lijn.op(t1);
    if (w !== voor) {
      const id = PARAMS[i].id;
      if (id === 'toon') this._zetRate(t1);
      else if (id === 'filter') this._zetFilter(t1);
      else if (id === 'niveau') this.uit.gain.setTargetAtTime(this._uitGain(t1), t1, 0.02);
      // DECAY, DRIVE, KICK, SNARE en HATS gelden vanaf de volgende aanslag (op of na t).
    }
    this.emit('param', { k: i + 1, v: w, t: t1 });
  }

  leesParam(k, t) {
    const i = Number(k) - 1;
    return Number.isInteger(i) && i >= 0 && i < PARAMS.length ? this._v(i, Number.isFinite(t) ? t : this.ctx.currentTime) : null;
  }

  _rate(t) { return Math.pow(2, (toonHalveTonen(this._v(P_TOON, t)) + 2 * this.buiging) / 12); }
  _filterFreq(t) { const f = filterHz(this._v(P_FILTER, t)); return f === Infinity ? this.ctx.sampleRate / 2 : f; }
  _uitGain(t) { return faderGain(this._v(P_NIVEAU, t)) * UIT_OPHOGING; }

  /** TOON en buigen gelden ook voor wat al klinkt; het einde schuift mee (anders te vroeg los: een tik). */
  _zetRate(t1) {
    const nu = this.ctx.currentTime;
    for (const st of this.stemmen) {
      if (st.weg) continue;
      const r = this._rate(Math.max(t1, st.t0));
      const T1 = Math.max(t1, nu, st.seg.T);
      st.src.playbackRate.setTargetAtTime(r, T1, 0.01);
      const { T, P, R } = st.seg;
      const P1 = T1 > T ? P + (T1 - T) * R : P;
      st.seg = { T: T1, P: P1, R: r };
      st.eind = Math.min(T1 + Math.max(0, st.duur - P1) / r, st.decayEind);
    }
  }

  _zetFilter(t1) {
    for (const st of this.stemmen) if (!st.weg) st.filter.frequency.setTargetAtTime(this._filterFreq(t1), Math.max(t1, st.t0), 0.01);
  }

  // ---- stand en opruimen ----

  stand() {
    const nu = this.ctx.currentTime;
    return {
      soort: this.soort,
      naam: this.naam,
      klinkt: this.stemmen.filter((st) => st.t0 <= nu && nu < st.eind).length,
      params: PARAMS.map((_, i) => this._v(i, nu)),
      pads: this.pads.map((p, i) => ({ pad: i + 1, noot: EERSTE_NOOT + i, naam: p.naam, gevuld: !!p.buffer, kit: i < KIT_PADS })),
    };
  }

  vernietig() {
    if (this.dood) return;
    this.stil();
    this.dood = true;
    // Los van de uitgang zodra de laatste stem uitgefadet is (onended), niet eerder.
    if (!this.stemmen.length) this._los();
  }

  _los() { try { this.uit.disconnect(); } catch (_) {} }
}

export const DRUMS = {
  soort: 'drums',
  naam: 'Drums',
  maak(ctx, { uit, klok = null } = {}) { return new Drums(ctx, uit ?? ctx.destination, { klok }); },
};
