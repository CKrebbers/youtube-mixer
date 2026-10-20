// De kanaalstrip van één track (ARCHITECTUUR.md, contract "Strip en mixer").
//
//   in -> trim -> eq laag -> eq mid -> eq hoog -+-> droog ----------------+-> naFilter ----------+-> fader -+-> kant -> mixer.in
//                                               `-> hpf -> lpf -> nat ----'      |                   |          |
//                                                                                |  (insert-slot) ---'          +-> send A -> mixer.sendIn('A')
//                                                                                `-> meter (vóór de fader)     `-> send B -> mixer.sendIn('B')
//
// De insert-slot (fx/fx.js, BOUWPLAN "Effecten") zit ná het filter en vóór de fader: dicht is ook
// stil. naFilter is zijn DROGE weg (zijn gain = het droge deel van de mix) en de fader de plek waar
// droog en nat samenkomen; de natte weg (droog + nat van het filter -> keten -> gain -> fader) en
// de sends bestaan pas als ze iets doen. Zonder effect en met de sends dicht staat er dus geen enkele
// node extra in het pad: bit voor bit plak 1 (meting/golden.mjs).
//
// Formules uit v1 (src/engine/audio-graph.js en deck.js @ 6a640ac) waar ze
// bewezen zijn; afwijkingen staan erbij met de reden. Alles wat binnenkomt is
// 0..1; de strip schaalt naar dB en Hz. Geen DOM, geen kennis van tracks of de bus.
//
// Klikvrij, altijd (overgang.js): een doelwaarde gaat met setTargetAtTime vanaf
// waar de parameter NU is (zetDoel), een schakelaar (kill, filter in/uit) met
// lineaire hellingen langs een zachte S na startDrempel. Nooit setValueCurveAtTime.
import { clamp, dbToGain, expMap } from '../kern/emitter.js';
import { houdVast, startDrempel, zetHellingen } from './overgang.js';
import { InsertSlot } from './fx/fx.js';
import { rackVanEffect } from './fx/rack.js';
import { effectVan } from './fx/fx.js';
import { sendGain, BUSSEN } from './fx/sends.js';

/** Trim: 0..1 -> −12..+12 dB, 0,5 = 0 dB. (v1 deed u·2, lineair tot +6 dB; het contract vraagt ±12 dB.) */
export const TRIM_DB = 12;
/** EQ (v1 eqDb): onderaan kill, dan −30 dB tot 0 dB in het midden, boven tot +8 dB. */
export const EQ_KILL_DB = -70;
export const EQ_MIN_DB = -30;
export const EQ_MAX_DB = 8;
/** Onder deze knopstand is een EQ-band weg (v1: de onderste 3%). */
export const EQ_KILL_KNOP = 0.03;
/** Frequenties van de drie banden (v1 createDeckChain). */
export const EQ_FREQ = Object.freeze({ laag: 200, mid: 1000, hoog: 4000 });
/** Q van de mid-band (peaking: een gewone factor, geen dB). */
export const EQ_MID_Q = 0.9;
/** Zo lang doet een kill erover, heen en terug (v1 KILL_FADE). */
export const KILL_FADE = 0.005;
/** Punten op de zachte S van een kill (v1 KILL_N): 32 hellingen in 5 ms. */
const KILL_N = 33;
/**
 * Dode zone van het filter rond het midden: een knop met MIDI-stappen (1/127)
 * landt nooit precies op 0,5. ±0,004 = 63 en 64 van 127 (v1 STEM_MIDDEN).
 */
export const FILTER_MIDDEN = 0.004;
/**
 * Terug naar het midden: zo lang na startDrempel wacht de overgang naar droog,
 * zodat de filters eerst zelf open glijden (5 × hun tijdconstante). Anders
 * komt de bas van een dichte highpass er in 5 ms in: een plof.
 */
export const FILTER_TERUG = 0.05;
/** De open stand van de twee filters: [hpf Hz, hpf Q, lpf Hz, lpf Q] (v1). */
export const FILTER_OPEN = Object.freeze([20, 0.7, 22050, 0.7]);
/** Fader (v1 faderGain): (1 − v) × −45 dB. */
export const FADER_DB = -45;
/** Tijdconstanten van setTargetAtTime (v1: trim/EQ/filter 10 ms, fader en crossfader 8 ms, master 20 ms). */
export const TAU = Object.freeze({ trim: 0.01, eq: 0.01, filter: 0.01, fader: 0.008, kant: 0.008, master: 0.02, send: 0.01 });

export const BANDEN = Object.freeze(['laag', 'mid', 'hoog']);
export const KANTEN = Object.freeze(['A', 'B', 'thru']);
const KNOPPEN = ['trim', 'laag', 'mid', 'hoog', 'filter', 'fader'];
/** Een meter leest zoveel samples: 42,7 ms op 48 kHz, langer dan een beeld, dus geen piek gemist bij 60 fps. */
export const METER_N = 2048;

// ---- formules (puur) -----------------------------------------------------------

export const trimGain = (v) => dbToGain((clamp(v) - 0.5) * 2 * TRIM_DB);

/** EQ-knop 0..1 naar dB (v1 eqDb): midden 0 dB, onderste 3% kill. */
export function eqDb(v) {
  const t = clamp(v);
  if (t < EQ_KILL_KNOP) return EQ_KILL_DB;
  if (t <= 0.5) return EQ_MIN_DB * (1 - t / 0.5);
  return EQ_MAX_DB * ((t - 0.5) / 0.5);
}

/** Staat de filterknop in het midden (de dode zone)? + 1e-12: 0,5 + 0,004 − 0,5 is in floating point net iets meer dan 0,004. */
export const filterOpen = (v) => Math.abs(clamp(v) - 0.5) <= FILTER_MIDDEN + 1e-12;

/**
 * Wat de bipolaire filterknop op de twee filters zet (v1 filterDoelen), plus
 * de dode zone: [hpf Hz, hpf Q, lpf Hz, lpf Q]. Links lowpass van 22050 naar
 * 250 Hz, rechts highpass van 20 naar 9000 Hz, exponentieel. De Q van een
 * Web Audio-lowpass/highpass is in dB: 0,7 open, tot 6,7 dB resonantie aan het
 * eind van de draai (zoals v1; geen terugkoppellus, dus geen negatieve Q nodig).
 */
export function filterDoelen(v) {
  if (filterOpen(v)) return [...FILTER_OPEN];
  const d = (clamp(v) - 0.5) * 2;   // −1..1
  if (d < 0) return [20, 0.7, expMap(1 + d, 250, 22050), 0.7 - d * 6];
  return [expMap(d, 20, 9000), 0.7 + d * 6, 22050, 0.7];
}

/**
 * Fader 0..1 naar versterking (v1 faderGain), behalve onderaan: 0 is hier echt
 * stil (v1: −70 dB). Een dichte fader hoort niets door te laten.
 */
export const faderGain = (v) => {
  const t = clamp(v);
  return t <= 0.001 ? 0 : dbToGain((1 - t) * FADER_DB);
};

// ---- overgangen ------------------------------------------------------------------

/**
 * Een doelwaarde (knop): vasthouden waar de parameter NU is, ook midden in een
 * overgang, en vandaar met setTargetAtTime. Zo begint een nieuwe draai nooit
 * bij een oud punt (v1 zetDoel in fx.js).
 */
export function zetDoel(param, doel, nu, tau) {
  houdVast(param, nu);
  param.setTargetAtTime(doel, nu, tau);
}

/** De zachte S (halve cosinus) van 0 naar 1 op punt i van KILL_N. */
const sPunt = (i) => (1 - Math.cos(Math.PI * i / (KILL_N - 1))) / 2;

/**
 * Een EQ-band (in dB) in KILL_FADE naar `naarDb`, zo dat de AMPLITUDE een zachte
 * S volgt: een rechte lijn in dB doet bijna alles in het eerste of laatste
 * stukje, en dat is een tik (v1 killEqBand). Lineaire hellingen tussen de
 * punten, na `wacht` (startDrempel).
 */
export function killEqBand(param, naarDb, nu, wacht = 0) {
  zetHellingen(param, (van) => {
    const ga = dbToGain(van), gb = dbToGain(naarDb), vloer = dbToGain(EQ_KILL_DB);
    const p = new Array(KILL_N);
    for (let i = 0; i < KILL_N; i++) {
      p[i] = i === 0 ? van : i === KILL_N - 1 ? naarDb : 20 * Math.log10(Math.max(vloer, ga + (gb - ga) * sPunt(i)));
    }
    return p;
  }, nu, KILL_FADE, wacht);
}

/** Een versterking (amplitude) in KILL_FADE naar `naar`, langs dezelfde S (v1 killVersterking). */
export function killVersterking(param, naar, nu, wacht = 0) {
  zetHellingen(param, (van) => {
    const p = new Array(KILL_N);
    for (let i = 0; i < KILL_N; i++) p[i] = i === 0 ? van : i === KILL_N - 1 ? naar : van + (naar - van) * sPunt(i);
    return p;
  }, nu, KILL_FADE, wacht);
}

/**
 * `fn` uitvoeren als de audioklok `tot` voorbij is. De timer zegt alleen WANNEER
 * er gekeken wordt; de audioklok zegt of het zover is. Loopt de context niet,
 * dan meteen: er klinkt dan niets dat kan tikken.
 */
export function naAudioklok(ctx, tot, fn) {
  return new Promise((klaar) => {
    const kijk = () => {
      if (ctx.state !== 'running' || ctx.currentTime >= tot) { fn(); klaar(); return; }
      const t = setTimeout(kijk, Math.min(50, Math.max(5, (tot - ctx.currentTime) * 1000 + 5)));
      t?.unref?.();
    };
    kijk();
  });
}

// ---- meter -------------------------------------------------------------------------

/**
 * Piek en RMS van een tap, per kanaal (een AnalyserNode mengt naar mono, en dan
 * leest een breed of tegenfasig stereobeeld te zacht). Buffers en het antwoord
 * zijn vooraf gemaakt: lees() maakt geen afval, maar geeft dus ELKE keer
 * hetzelfde object terug (kopieer wat je wilt bewaren). Lineaire waarden; piek
 * en rms zijn die van het luidste kanaal over de laatste METER_N samples.
 */
export function maakMeter(ctx, bron, n = METER_N) {
  const split = ctx.createChannelSplitter(2);
  const aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
  aL.fftSize = n; aR.fftSize = n;
  aL.smoothingTimeConstant = 0; aR.smoothingTimeConstant = 0;
  bron.connect(split);
  split.connect(aL, 0);
  split.connect(aR, 1);
  const bL = new Float32Array(n), bR = new Float32Array(n);
  const uit = { piek: 0, rms: 0 };
  const extra = [];
  let los = false;
  return {
    uit,
    /** Nog een bron op dezelfde tap (de natte weg van de insert-slot): de meter leest de som. */
    voeg(b) { if (los) return; b.connect(split); extra.push(b); },
    lees() {
      if (los) { uit.piek = 0; uit.rms = 0; return uit; }
      aL.getFloatTimeDomainData(bL);
      aR.getFloatTimeDomainData(bR);
      let pL = 0, pR = 0, sL = 0, sR = 0;
      for (let i = 0; i < n; i++) {
        const l = bL[i], r = bR[i];
        const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
        if (al > pL) pL = al;
        if (ar > pR) pR = ar;
        sL += l * l;
        sR += r * r;
      }
      uit.piek = pL > pR ? pL : pR;
      uit.rms = Math.sqrt((sL > sR ? sL : sR) / n);
      return uit;
    },
    los() {
      if (los) return;
      los = true;
      try { bron.disconnect(split); } catch (_) {}
      for (const b of extra) { try { b.disconnect(split); } catch (_) {} }
      split.disconnect(); aL.disconnect(); aR.disconnect();
    },
  };
}

// ---- de strip ------------------------------------------------------------------------

class Strip {
  constructor(ctx, mixer) {
    this.ctx = ctx;
    this._mixer = mixer;
    this._weg = null;

    // De ingang is altijd stereo: een mono-instrument komt dan in het midden,
    // en de meter en de crossfader zien links en rechts.
    const inn = ctx.createGain();
    inn.channelCount = 2;
    inn.channelCountMode = 'explicit';
    inn.channelInterpretation = 'speakers';
    const trim = ctx.createGain();
    const laag = ctx.createBiquadFilter();
    laag.type = 'lowshelf'; laag.frequency.value = EQ_FREQ.laag;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = EQ_FREQ.mid; mid.Q.value = EQ_MID_Q;
    const hoog = ctx.createBiquadFilter();
    hoog.type = 'highshelf'; hoog.frequency.value = EQ_FREQ.hoog;
    // Het bipolaire filter: één highpass en één lowpass in serie (v1), maar
    // NAAST een droge weg. In het midden is nat 0 en droog precies 1: het
    // signaal gaat bit voor bit langs, want de filters op hun open stand zijn
    // geen identiteit (de lowpass van 22050 Hz kleurt boven 15 kHz).
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = FILTER_OPEN[0]; hpf.Q.value = FILTER_OPEN[1];
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = FILTER_OPEN[2]; lpf.Q.value = FILTER_OPEN[3];
    const droog = ctx.createGain();
    const nat = ctx.createGain();
    nat.gain.value = 0;
    const naFilter = ctx.createGain();
    const fader = ctx.createGain();
    const kant = ctx.createGain();

    inn.connect(trim);
    trim.connect(laag);
    laag.connect(mid);
    mid.connect(hoog);
    hoog.connect(droog);
    hoog.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(nat);
    droog.connect(naFilter);
    nat.connect(naFilter);
    naFilter.connect(fader);
    fader.connect(kant);
    kant.connect(mixer.in);

    this.in = inn;
    /** Na EQ en filter, vóór de fader: hier tapt de meter (en straks de cue). */
    this.naFilter = naFilter;
    this.nodes = Object.freeze({ in: inn, trim, laag, mid, hoog, hpf, lpf, droog, nat, naFilter, fader, kant });
    // De meter vóór de fader, zoals op een DJ-mixer: je stelt de trim in op wat
    // het kanaal geeft, ook met de fader dicht.
    this._meter = maakMeter(ctx, naFilter);
    /** De uitgangen van de natte weg van de insert-slot (de cue tapt ze ook), en de cue zelf (lui). */
    this._natten = [];
    this._pflIn = null;
    this._pfl = false;

    // De insert-slot: lui (de keten pas bij mix > 0 en aan), met het delay-rack van v1 als begin.
    // naFilter is de droge weg, de fader de uitgang; de natte weg tapt droog + nat van het filter.
    this.fx = new InsertSlot(ctx, {
      droog: naFilter, uit: fader, lui: 'mix',
      bijIngang: (fxIn) => { droog.connect(fxIn); nat.connect(fxIn); },
      bijKeten: (g) => { this._meter.voeg(g); this._natten.push(g); this._pflIn?.voeg(g); },
    });
    this.fx.zetRack(rackVanEffect(effectVan('delay')));
    /** Sends A (echo) en B (galm): na de fader, vóór de kant. Pas een node als hij voor het eerst open gaat. */
    this._send = { A: 0, B: 0 };
    this._sendNode = { A: null, B: null };

    this._stand = { trim: 0.5, laag: 0.5, mid: 0.5, hoog: 0.5, filter: 0.5, fader: 1 };
    this._kill = { laag: false, mid: false, hoog: false };
    this._kant = 'thru';
    this._filterOpen = true;
    trim.gain.value = trimGain(0.5);
    for (const b of BANDEN) this._band(b).gain.value = eqDb(0.5);
    fader.gain.value = faderGain(1);
    kant.gain.value = mixer.kantGain('thru');
    mixer._meld(this);
  }

  _band(b) { return b === 'laag' ? this.nodes.laag : b === 'mid' ? this.nodes.mid : this.nodes.hoog; }

  /**
   * Een knop zetten, 0..1. Onbekende naam = een programmeerfout (TypeError);
   * NaN of geen getal = genegeerd (een kapotte mapping mag de bas niet killen),
   * ±Infinity wordt geklemd. Geeft true als de stand is overgenomen.
   */
  zet(naam, v) {
    if (!KNOPPEN.includes(naam)) throw new TypeError(`strip.zet: onbekende knop '${naam}'`);
    if (this._weg || typeof v !== 'number' || Number.isNaN(v)) return false;
    const w = clamp(v);
    if (w === this._stand[naam]) return true;
    this._stand[naam] = w;
    const nu = this.ctx.currentTime, n = this.nodes;
    switch (naam) {
      case 'trim': zetDoel(n.trim.gain, trimGain(w), nu, TAU.trim); break;
      case 'fader': zetDoel(n.fader.gain, faderGain(w), nu, TAU.fader); break;
      case 'filter': this._zetFilter(w, nu); break;
      default:
        // Een gekilde band onthoudt de knop maar blijft weg; de lopende kill-S
        // wordt niet onderbroken.
        if (!this._kill[naam]) zetDoel(this._band(naam).gain, eqDb(w), nu, TAU.eq);
    }
    return true;
  }

  _zetFilter(w, nu) {
    const open = filterOpen(w);
    if (open && this._filterOpen) return;          // binnen de dode zone verandert er niets
    const [hf, hq, lf, lq] = filterDoelen(w);
    const n = this.nodes;
    zetDoel(n.hpf.frequency, hf, nu, TAU.filter);
    zetDoel(n.hpf.Q, hq, nu, TAU.filter);
    zetDoel(n.lpf.frequency, lf, nu, TAU.filter);
    zetDoel(n.lpf.Q, lq, nu, TAU.filter);
    if (open === this._filterOpen) return;
    this._filterOpen = open;
    // Droog en nat langs dezelfde S, complementair: samen altijd 1 (de filters
    // staan op dat moment vrijwel open, dus het niveau blijft gelijk).
    const wacht = startDrempel(this.ctx) + (open ? FILTER_TERUG : 0);
    killVersterking(n.droog.gain, open ? 1 : 0, nu, wacht);
    killVersterking(n.nat.gain, open ? 0 : 1, nu, wacht);
  }

  /** Kill aan of uit: −70 dB in 5 ms langs een zachte S; uit = precies terug naar de knopstand. */
  kill(band, aan) {
    if (!BANDEN.includes(band)) throw new TypeError(`strip.kill: onbekende band '${band}'`);
    if (this._weg) return false;
    const weg = !!aan;
    if (weg === this._kill[band]) return true;
    this._kill[band] = weg;
    killEqBand(this._band(band).gain, weg ? EQ_KILL_DB : eqDb(this._stand[band]), this.ctx.currentTime, startDrempel(this.ctx));
    return true;
  }

  /**
   * Een send zetten, 0..1 (kwadratisch, v1). 'A' = echo, 'B' = galm (ook 'a'/'b'). De eerste keer
   * open: een gain na de fader, en de bus van de mixer wordt wakker (mixer.sendIn). Op 0 gaat er
   * niets meer in; de staart van de bus sterft vanzelf uit.
   */
  send(bus, v) {
    const b = typeof bus === 'string' ? bus.toUpperCase() : bus;
    if (!BUSSEN.includes(b)) throw new TypeError(`strip.send: onbekende bus '${bus}'`);
    if (this._weg || typeof v !== 'number' || Number.isNaN(v)) return false;
    const w = clamp(v);
    if (w === this._send[b]) return true;
    this._send[b] = w;
    let g = this._sendNode[b];
    if (!g) {
      if (w === 0 || typeof this._mixer.sendIn !== 'function') return true;
      g = this.ctx.createGain();
      g.gain.value = 0;
      this.nodes.fader.connect(g);
      g.connect(this._mixer.sendIn(b));
      this._sendNode[b] = g;
    }
    zetDoel(g.gain, sendGain(w), this.ctx.currentTime, TAU.send);
    return true;
  }

  /**
   * Voorbeluisteren (koptelefoon.js): de tap vóór de fader naar de koptelefoon, aan of uit. De
   * ingang bestaat pas bij de eerste keer aan. Zonder koptelefoon (twee kanalen): false, niets erbij.
   */
  pfl(aan) {
    const kop = this._mixer.koptelefoon;
    if (this._weg || !kop?.beschikbaar) return false;
    const w = !!aan;
    if (w === this._pfl) return true;
    if (!this._pflIn) {
      if (!w) return true;
      const g = kop.ingang(), lijst = [this.naFilter, ...this._natten];
      for (const b of lijst) b.connect(g);
      this._pflIn = { g, voeg: (b) => b.connect(g), lijst };
    }
    this._pfl = w;
    kop.zet(this._pflIn.g, w);
    return true;
  }

  /** Zonder argument: de kant van nu. Met 'A', 'B' of 'thru': zetten (iets anders wordt genegeerd). */
  kant(k) {
    if (k === undefined) return this._kant;
    if (this._weg || !KANTEN.includes(k)) return false;
    if (k !== this._kant) { this._kant = k; this._volgXfader(this.ctx.currentTime); }
    return true;
  }

  /** De mixer meldt een nieuwe crossfaderstand. Thru volgt hem niet. */
  _volgXfader(nu) {
    if (this._weg) return;
    zetDoel(this.nodes.kant.gain, this._mixer.kantGain(this._kant), nu, TAU.kant);
  }

  /** De laatst gezette stand, 0..1 ('kill.laag' enz.: 1 = weg). Onbekend = undefined. */
  lees(naam) {
    if (naam in this._stand) return this._stand[naam];
    if (naam.startsWith?.('kill.') && BANDEN.includes(naam.slice(5))) return this._kill[naam.slice(5)] ? 1 : 0;
    if (naam === 'send.a' || naam === 'send.A') return this._send.A;
    if (naam === 'send.b' || naam === 'send.B') return this._send.B;
    if (naam === 'pfl') return this._mixer.koptelefoon?.beschikbaar ? (this._pfl ? 1 : 0) : null;
    return undefined;
  }

  /**
   * Weg: de uitgang klikvrij dicht, dan alles los als de audioklok voorbij de
   * overgang is. Meteen uit de mixer (de crossfader raakt hem niet meer). Geeft
   * een Promise die klaar is als alles los is (meteen als de context stilstaat).
   */
  vernietig() {
    if (this._weg) return this._weg;
    const ctx = this.ctx;
    this._mixer._vergeet(this);
    const nu = ctx.currentTime, wacht = startDrempel(ctx);
    const sends = Object.values(this._sendNode).filter(Boolean);
    if (ctx.state === 'running') {
      killVersterking(this.nodes.kant.gain, 0, nu, wacht);
      // De sends tappen vóór de kant: die gaan net zo dicht (de staart op de bus sterft vanzelf uit).
      for (const g of sends) killVersterking(g.gain, 0, nu, wacht);
    }
    if (this._pfl) this._mixer.koptelefoon.zet(this._pflIn.g, false);
    this._weg = naAudioklok(ctx, nu + wacht + KILL_FADE + 0.005, () => {
      this._meter.los();
      this.fx.vernietig();
      for (const g of sends) g.disconnect();
      this._pflIn?.g.disconnect();
      for (const node of Object.values(this.nodes)) node.disconnect();
    });
    return this._weg;
  }
}

/** Een kanaalstrip, aangesloten op de mixer. */
export function maakStrip(ctx, mixer) {
  return new Strip(ctx, mixer);
}
