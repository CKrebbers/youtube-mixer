import { clamp } from '../../lib/emitter.js';
import { houdVast, startDrempel } from '../overgang.js';
import { killVersterking, KILL_FADE } from '../audio-graph.js';

/**
 * Poly: de polysynth uit de filter app (`~/Projects/filter app/app.js`,
 * `Synth`), in het contract van docs/INSTRUMENTEN.md.
 *
 * Per stem twee oscillatoren, tegen elkaar in ontstemd (zoals daar), en
 * daarachter wat de filter app via zijn effectketen deed: een lowpass per
 * stem met een envelope, en een VCA met ADSR. Alles native Web Audio, geen
 * worklet: dan is er ook geen audiothread om afval op te maken.
 *
 *   osc 1 ┐
 *         ├─ filter (lowpass, envelope op detune) ─ vca (ADSR × snelheid) ─ bus ─ uit
 *   osc 2 ┘
 *   buiging + vibrato ─> detune van elke oscillator · druk ─> detune van elk filter
 *
 * Acht knoppen (params): golf · ontstem · filter · reso · env · attack ·
 * decay/release · sustain. Een volle ADSR plus golf, ontstemming, filter,
 * resonantie en envelope-diepte is negen; decay en release delen daarom één
 * knop, zoals op de Korg Volca Keys (EG DECAY/RELEASE). Dezelfde ADSR stuurt
 * het filter (`env` = hoe diep).
 *
 * Elke noot krijgt nieuwe nodes (zoals in de filter app). Aansluiten gebeurt
 * op een VCA die op 0 staat, losmaken pas na de stop: er loopt dan geen
 * signaal door de bedrading die verandert. De oscillatoren beginnen op fase 0,
 * dus een noot begint zonder sprong, ook als de audiothread al verder is dan
 * `currentTime` (dan is alleen de attack een paar ms korter).
 *
 * Stemroof: bij POLYFONIE klinkende stemmen gaat de oudste eraf, eerst wat al
 * los is, dan wat het pedaal vasthoudt, dan een ingedrukte toets: in KILL_FADE
 * (5 ms) met de zachte S van de EQ-kill, na startDrempel (overgang.js). Nooit
 * setValueCurveAtTime; envelopes met houdVast + lineaire hellingen en
 * setTargetAtTime. Tijd komt alleen van de audioklok (regel 3).
 */

export const POLYFONIE = 12;
export const GOLVEN = ['sawtooth', 'square', 'triangle', 'sine'];
const GOLF_NAAM = { sawtooth: 'zaag', square: 'blok', triangle: 'driehoek', sine: 'sinus' };
/** Ontstemming tussen de twee oscillatoren (de filter app: 0–40, standaard 8 cent naar elke kant). */
export const ONTSTEM_MAX = 40;
export const FILTER_MIN = 60;
export const FILTER_MAX = 18000;
/**
 * Resonantie in dB: de Q van een Web Audio-lowpass is een piek in DECIBEL
 * (CLAUDE.md, Bekende grenzen). −3 dB is Butterworth (vlak); 18 dB fluit.
 */
export const RESO_MIN = -3;
export const RESO_MAX = 18;
/** Hoe ver de filter-envelope het filter opent, in cent (5 octaven). */
export const ENV_MAX = 6000;
export const ATTACK_MIN = 0.002;
export const ATTACK_MAX = 3;
export const VERVAL_MIN = 0.01;
export const VERVAL_MAX = 6;
/** Pitchbend ±1 = ±2 halve tonen (het contract). */
export const BUIG_CENT = 200;
/** Aftertouch (druk) opent het filter tot zoveel octaven. */
export const DRUK_OCT = 2;
/** Modwiel vol = vibrato van zoveel cent, op LFO_HZ. */
export const VIBRATO_CENT = 25;
const LFO_HZ = 5.5;
/** Per stem op snelheid 1: twee oscillatoren samen ongeveer 1, dus elk de helft. */
const STEM = 0.5;
/**
 * Hoe hard de bus staat. Gemeten met tools/headless/instrument.mjs (echte
 * Chrome, OfflineAudioContext): een akkoord van drie noten (C4 E4 G4) op
 * snelheid 0,8 met de standaardknoppen, het aangehouden deel, op −14 LUFS,
 * even luid als een genormaliseerd nummer (docs/INSTRUMENTEN.md §4.5).
 * Verander je de klank (STEM, filter, envelope), meet dan opnieuw.
 */
export const OPHOGING = 0.52;

const exp = (lo, hi, v) => lo * Math.pow(hi / lo, clamp(v));
export const golfVan = (v) => GOLVEN[Math.min(GOLVEN.length - 1, Math.floor(clamp(v) * GOLVEN.length))];
export const ontstemCent = (v) => clamp(v) * ONTSTEM_MAX;
export const filterHz = (v) => exp(FILTER_MIN, FILTER_MAX, v);
export const resoDb = (v) => RESO_MIN + clamp(v) * (RESO_MAX - RESO_MIN);
export const attackTijd = (v) => exp(ATTACK_MIN, ATTACK_MAX, v);
export const vervalTijd = (v) => exp(VERVAL_MIN, VERVAL_MAX, v);
/** MIDI-noot naar Hz (A4 = 69 = 440 Hz). */
export const nootHz = (noot) => 440 * Math.pow(2, (noot - 69) / 12);

const hzTekst = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);
const tijdTekst = (s) => (s >= 1 ? `${s.toFixed(1)} s` : `${Math.round(s * 1000)} ms`);

/** De acht knoppen, plek k = PARAMS[k-1]. `standaard` 0..1, `eenheid` in echte eenheden. */
export const PARAMS = Object.freeze([
  { id: 'golf', label: 'golf', standaard: 0, eenheid: (v) => GOLF_NAAM[golfVan(v)] },
  { id: 'ontstem', label: 'ontstem', standaard: 0.2, eenheid: (v) => `±${Math.round(ontstemCent(v))} ct` },
  { id: 'filter', label: 'filter', standaard: 0.62, eenheid: (v) => hzTekst(filterHz(v)) },
  { id: 'reso', label: 'reso', standaard: 0.2, eenheid: (v) => `${resoDb(v).toFixed(1)} dB` },
  { id: 'env', label: 'env', standaard: 0.35, eenheid: (v) => `+${(clamp(v) * ENV_MAX / 1200).toFixed(1)} oct` },
  { id: 'attack', label: 'attack', standaard: 0.22, eenheid: (v) => tijdTekst(attackTijd(v)) },
  { id: 'verval', label: 'decay/rel', standaard: 0.55, eenheid: (v) => tijdTekst(vervalTijd(v)) },
  { id: 'sustain', label: 'sustain', standaard: 0.7, eenheid: (v) => `${Math.round(clamp(v) * 100)}%` },
].map((p) => Object.freeze(p)));

const P = Object.fromEntries(PARAMS.map((p, i) => [p.id, i]));

export class Poly {
  /** @param uit  waar hij op aansluit (de engine geeft de aansluiting van de track) */
  constructor(ctx, uit) {
    this.ctx = ctx;
    this.soort = POLY.soort;
    this.naam = POLY.naam;
    this.params = PARAMS;
    this._p = PARAMS.map((p) => p.standaard);
    this.stemmen = [];
    this.pedaal = false;
    this._weg = false;

    this.bus = ctx.createGain();
    this.bus.gain.value = OPHOGING;
    this.bus.connect(uit);

    // Gedeelde modulatie, één keer per instrument: elke stem sluit erop aan.
    const constant = () => {
      if (typeof ctx.createConstantSource !== 'function') return null;
      const c = ctx.createConstantSource();
      c.offset.value = 0;
      c.start();
      return c;
    };
    this.buigBron = constant();          // cent op de detune van elke oscillator
    this.drukBron = constant();          // cent op de detune van elk filter
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = LFO_HZ;
    this.vibrato = ctx.createGain();     // modwiel: diepte in cent
    this.vibrato.gain.value = 0;
    this.lfo.connect(this.vibrato);
    this.lfo.start();
  }

  start() { return Promise.resolve(); }

  // ---- spelen --------------------------------------------------------------

  /** Noot aan. `t` op de audioklok; leeg of voorbij = nu. Snelheid 0 = noot uit (MIDI). */
  noteOn(noot, snelheid, t) {
    if (this._weg) return;
    const n = Math.round(noot);
    if (!(n >= 0 && n <= 127)) return;
    const v = clamp(snelheid);
    if (!(v > 0)) { this.noteOff(n, t); return; }
    const nu = this.ctx.currentTime;
    const t0 = Number.isFinite(t) && t > nu ? t : nu;
    this._ruim(nu);
    // Dezelfde toets nog eens (of nog vastgehouden door het pedaal): de oude laat los.
    for (const s of this.stemmen) if (s.noot === n && !s.los && !s.gestolen) this._laatLos(s, t0);
    // Vol: de oudste eraf (wat al los is eerst, dan het pedaal, dan een toets).
    for (let i = 0; i < POLYFONIE && this._klinkend() >= POLYFONIE; i++) this._steel(this._oudste(), t0);
    this.stemmen.push(this._maakStem(n, v, t0));
  }

  /** Noot los: hij klinkt uit volgens zijn release. Met het pedaal ingetrapt wacht hij. */
  noteOff(noot, t) {
    if (this._weg) return;
    const n = Math.round(noot);
    const nu = this.ctx.currentTime;
    const t1 = Number.isFinite(t) && t > nu ? t : nu;
    for (const s of this.stemmen) {
      if (s.noot !== n || s.los || s.gestolen) continue;
      if (this.pedaal) s.vastgehouden = true;
      else this._laatLos(s, t1);
    }
  }

  /** Alle noten los (ook wat het pedaal vasthoudt); ze klinken uit. */
  alleUit(t) {
    if (this._weg) return;
    const nu = this.ctx.currentTime;
    const t1 = Number.isFinite(t) && t > nu ? t : nu;
    for (const s of this.stemmen) if (!s.los && !s.gestolen) this._laatLos(s, t1);
  }

  /** Paniek: meteen stil, met een korte fade (nooit een tik). Daarna gewoon weer te bespelen. */
  stil() {
    const nu = this.ctx.currentTime;
    for (const s of this.stemmen) if (!s.gestolen && s.eind > nu) this._steel(s, nu);
    this._ruim(nu);
  }

  /** Aftertouch 0..1: opent het filter (tot DRUK_OCT octaven). Zonder noot het hele kanaal. */
  druk(w, noot) {
    if (this._weg) return;
    const nu = this.ctx.currentTime;
    const x = clamp(w);
    if (noot === undefined || noot === null) {
      this.drukBron?.offset.setTargetAtTime(x * DRUK_OCT * 1200, nu, 0.02);
      return;
    }
    const n = Math.round(noot);
    for (const s of this.stemmen) {
      if (s.noot !== n || s.gestolen) continue;
      s.druk = x;
      s.filter.frequency.setTargetAtTime(this._filterVan(s), nu, 0.02);
    }
  }

  /** Pitchbend −1..1 = ±2 halve tonen, op alles wat klinkt. */
  buig(w) {
    if (this._weg) return;
    this.buigBron?.offset.setTargetAtTime(clamp(w, -1, 1) * BUIG_CENT, this.ctx.currentTime, 0.004);
  }

  /** Modwiel 0..1: vibrato. */
  mod(w) {
    if (this._weg) return;
    this.vibrato.gain.setTargetAtTime(clamp(w) * VIBRATO_CENT, this.ctx.currentTime, 0.02);
  }

  /** Sustainpedaal: noteOff wacht tot het pedaal los is. */
  houd(aan) {
    if (this._weg) return;
    this.pedaal = !!aan;
    if (this.pedaal) return;
    const nu = this.ctx.currentTime;
    for (const s of this.stemmen) if (s.vastgehouden && !s.los && !s.gestolen) this._laatLos(s, nu);
  }

  // ---- knoppen -------------------------------------------------------------

  /** Plek k (1..8) op 0..1. Golf, envelope en sustain gelden vanaf de volgende noot. */
  zetParam(k, v) {
    if (this._weg) return;
    const i = Math.round(k) - 1;
    if (!(i >= 0 && i < PARAMS.length)) return;
    this._p[i] = clamp(v);
    const nu = this.ctx.currentTime;
    const levend = this.stemmen.filter((s) => !s.gestolen && s.eind > nu);
    if (i === P.ontstem) {
      const c = ontstemCent(this._p[i]);
      for (const s of levend) s.oscs.forEach((o, j) => o.detune.setTargetAtTime((j ? 1 : -1) * c, nu, 0.02));
    } else if (i === P.filter) {
      for (const s of levend) s.filter.frequency.setTargetAtTime(this._filterVan(s), nu, 0.02);
    } else if (i === P.reso) {
      for (const s of levend) s.filter.Q.setTargetAtTime(resoDb(this._p[i]), nu, 0.02);
    }
  }

  leesParam(k) {
    const i = Math.round(k) - 1;
    return i >= 0 && i < PARAMS.length && Number.isInteger(k) ? this._p[i] : null;
  }

  stand() {
    return { soort: this.soort, naam: this.naam, klinkt: this._klinkend(), params: this._p.slice() };
  }

  /** Alles los en weg: eerst stil (fade), dan pas losmaken. Daarna doet niets meer iets. */
  vernietig() {
    if (this._weg) return;
    this.stil();
    this._weg = true;
    const t = setTimeout(() => {
      for (const n of [this.buigBron, this.drukBron, this.lfo]) { try { n?.stop(); } catch (_) {} try { n?.disconnect(); } catch (_) {} }
      for (const s of this.stemmen) this._ontkoppel(s);
      this.stemmen = [];
      try { this.vibrato.disconnect(); } catch (_) {}
      try { this.bus.disconnect(); } catch (_) {}
    }, 100);
    t?.unref?.();
  }

  // ---- binnenwerk ----------------------------------------------------------

  /** Stemmen die nu klinken of nog uitklinken (gestolen telt niet: die gaat er al af). */
  _klinkend() {
    const nu = this.ctx.currentTime;
    let n = 0;
    for (const s of this.stemmen) if (!s.gestolen && s.eind > nu) n++;
    return n;
  }

  /** De stem die eraf mag: de oudste, eerst wat los is, dan het pedaal, dan een ingedrukte toets. */
  _oudste() {
    const nu = this.ctx.currentTime;
    const rang = (s) => (s.los ? 0 : s.vastgehouden ? 1 : 2);
    let beste = null;
    for (const s of this.stemmen) {
      if (s.gestolen || !(s.eind > nu)) continue;
      if (!beste || rang(s) < rang(beste) || (rang(s) === rang(beste) && s.start < beste.start)) beste = s;
    }
    return beste;
  }

  /** De filterfrequentie van een stem: de knop, en zijn eigen (polyfone) druk. */
  _filterVan(s) { return Math.min(this.ctx.sampleRate / 2, filterHz(this._p[P.filter]) * Math.pow(2, DRUK_OCT * (s.druk || 0))); }

  _maakStem(noot, v, t0) {
    const ctx = this.ctx, p = this._p;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const s = { noot, start: t0, los: false, vastgehouden: false, gestolen: false, eind: Infinity, druk: 0, weg: false, filter };
    filter.frequency.value = this._filterVan(s);
    filter.Q.value = resoDb(p[P.reso]);
    const vca = ctx.createGain();
    vca.gain.value = 0;
    s.vca = vca;
    const golf = golfVan(p[P.golf]), c = ontstemCent(p[P.ontstem]), hz = nootHz(noot);
    s.oscs = [-1, 1].map((kant) => {
      const o = ctx.createOscillator();
      o.type = golf;
      o.frequency.value = hz;
      o.detune.value = kant * c;
      this.buigBron?.connect(o.detune);
      this.vibrato.connect(o.detune);
      o.connect(filter);
      return o;
    });
    this.drukBron?.connect(filter.detune);
    filter.connect(vca);
    vca.connect(this.bus);

    // ADSR op de VCA, en dezelfde vorm (× env) op het filter.
    const A = attackTijd(p[P.attack]), D = vervalTijd(p[P.verval]), S = clamp(p[P.sustain]);
    const piek = STEM * v * v;
    const diep = clamp(p[P.env]) * ENV_MAX * (0.5 + 0.5 * v);
    // De envelope als data: zo is de stand op elk moment uit te rekenen (_envOp).
    s.env = { t0, A, D, S, piek, los: null };
    for (const [param, top] of [[vca.gain, piek], [filter.detune, diep]]) {
      param.setValueAtTime(0, t0);
      param.linearRampToValueAtTime(top, t0 + A);
      param.setTargetAtTime(top * S, t0 + A, D / 3);
    }
    s.oscs[0].onended = () => this._ontkoppel(s);
    for (const o of s.oscs) o.start(t0);
    return s;
  }

  /** Release: van waar hij nu is naar 0, met tijdconstante verval/3 (na 3× verval −78 dB, dan stop). */
  _laatLos(s, t1) {
    s.los = true;
    s.vastgehouden = false;
    const R = vervalTijd(this._p[P.verval]);
    s.env.los = { t1, R };
    for (const param of [s.vca.gain, s.filter.detune]) {
      houdVast(param, t1);
      param.setTargetAtTime(0, t1, R / 3);
    }
    s.eind = t1 + 3 * R + 0.02;
    for (const o of s.oscs) { try { o.stop(s.eind); } catch (_) {} }
  }

  /**
   * De stand van de vca van stem `s` op audiokloktijd `t`, uit zijn eigen
   * envelope (regel 3: van de klok, geen teller): de helling van de attack,
   * dan naar sustain met τ = decay/3, en na het loslaten naar 0 met τ = release/3.
   * Precies wat de AudioParam doet, dus ook voor een moment dat nog moet komen.
   */
  _envOp(s, t) {
    const e = s.env;
    const voorLos = (u) => {
      if (u <= e.t0) return 0;
      if (u < e.t0 + e.A) return e.piek * (u - e.t0) / e.A;
      return e.piek * e.S + (e.piek - e.piek * e.S) * Math.exp(-(u - e.t0 - e.A) / (e.D / 3));
    };
    if (!e.los || t <= e.los.t1) return voorLos(t);
    return voorLos(e.los.t1) * Math.exp(-(t - e.los.t1) / (e.los.R / 3));
  }

  /**
   * Stemroof en paniek: in KILL_FADE naar 0 met de zachte S van de EQ-kill,
   * na startDrempel (killVersterking). Een geplande noot (t in de toekomst)
   * rooft op dat moment, met dezelfde S vanaf de stand die de envelope DAN
   * heeft (_envOp). Gemeten in Chrome (tools/headless/instrument.mjs):
   * vasthouden midden in een setTargetAtTime gevolgd door een lineaire helling
   * begon de helling op 0, een sprong; met een expliciet beginpunt niet.
   */
  _steel(s, t) {
    if (!s || s.gestolen) return;
    s.gestolen = true;
    const nu = this.ctx.currentTime, drempel = startDrempel(this.ctx);
    if (t > nu + drempel) {
      const g = s.vca.gain, van = this._envOp(s, t), N = 33;
      houdVast(g, t);
      g.setValueAtTime(van, t);
      for (let i = 1; i < N; i++) g.linearRampToValueAtTime(van * (1 + Math.cos(Math.PI * i / (N - 1))) / 2, t + KILL_FADE * i / (N - 1));
      s.eind = t + KILL_FADE;
    } else {
      killVersterking(s.vca.gain, 0, nu, drempel);
      s.eind = nu + drempel + KILL_FADE;
    }
    for (const o of s.oscs) { try { o.stop(s.eind + 0.005); } catch (_) {} }
  }

  /** Stemmen die al lang stil zijn uit de lijst (losmaken doet onended, of hier). */
  _ruim(nu) {
    if (!this.stemmen.some((s) => s.eind < nu - 0.05)) return;
    this.stemmen = this.stemmen.filter((s) => {
      if (s.eind >= nu - 0.05) return true;
      this._ontkoppel(s);
      return false;
    });
  }

  _ontkoppel(s) {
    if (s.weg) return;
    s.weg = true;
    for (const o of s.oscs) {
      try { this.buigBron?.disconnect(o.detune); } catch (_) {}
      try { this.vibrato.disconnect(o.detune); } catch (_) {}
      try { o.disconnect(); } catch (_) {}
    }
    try { this.drukBron?.disconnect(s.filter.detune); } catch (_) {}
    try { s.filter.disconnect(); } catch (_) {}
    try { s.vca.disconnect(); } catch (_) {}
  }
}

export const POLY = {
  soort: 'poly',
  naam: 'Poly',
  maak(ctx, { uit }) { return new Poly(ctx, uit); },
};
