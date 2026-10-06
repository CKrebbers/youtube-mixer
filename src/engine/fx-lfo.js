import { clamp } from '../lib/emitter.js';
import { startDrempel, zetHellingen } from './overgang.js';

/**
 * Een LFO voor effecten (tremolo, autopan), vrij in Hz of OP DE MAAT.
 *
 * Waarom geen OscillatorNode: op de maat moet de golf niet alleen het goede
 * tempo hebben maar ook op de TEL liggen, en een oscillator kun je niet op
 * een fase starten. Net als de gate (fx.js) is het daarom één cyclus als
 * AudioBuffer, lopend, met een playbackRate die de periode EXACT maakt (een
 * buffer heeft hele samples; de snelheid niet). Anders dan de gate start een
 * nieuwe bron niet op de volgende tel maar METEEN, op de fase waar hij dan
 * hoort te zijn (`start(wanneer, offset)`), en vloeien oude en nieuwe bron in
 * LFO_FADE over. Zo is een tempowissel of een sprong geen gat van een tel en
 * geen sprong in de gain.
 *
 * De fase is een segment op de audioklok (regel 3): fase(t) = fase0 +
 * (t − t0) / periode. Bij herankeren (tempo, seek, grid) houdt de LFO de tel
 * van de cyclus waar hij zat: een golf van vier tellen die op tel 3 zat,
 * staat na een sprong weer op tel 3 van de nieuwe tel. Op de "1" van de maat
 * ligt hij niet: fxKlok() kent sinds 6 okt ook de maat (`tellenTotEen`, voor
 * de sampler), maar de LFO gebruikt die niet.
 *
 * Zonder klok (de maat-track staat stil) loopt hij door op de laatst bekende
 * tel, zoals de delay: terugvallen op een vast tempo zou midden in een set
 * verspringen. Nooit een tel gezien: 120 bpm.
 *
 * De uitgang (`uit`) is de golf zelf, −1..1. Wat hij doet (gain, pan) en hoe
 * diep, zit in het effect.
 */

/** Delingen voor een LFO, van langzaam naar snel: knop rechts = sneller, zoals in Hz. */
export const LFO_DELINGEN = [
  { id: '4/1', tellen: 16 }, { id: '2/1', tellen: 8 }, { id: '1/1', tellen: 4 }, { id: '1/2', tellen: 2 },
  { id: '1/4', tellen: 1 }, { id: '1/8', tellen: 0.5 }, { id: '1/8T', tellen: 1 / 3 }, { id: '1/16', tellen: 0.25 },
  { id: '1/16T', tellen: 1 / 6 }, { id: '1/32', tellen: 0.125 },
];
export const lfoDelingVan = (t) => LFO_DELINGEN[Math.min(LFO_DELINGEN.length - 1,
  Math.max(0, Math.round(clamp(t) * (LFO_DELINGEN.length - 1))))];

/** Golfvormen. Allemaal +1 op de tel (fase 0): tremolo vol, autopan links. */
export const LFO_VORMEN = ['sinus', 'driehoek', 'blok', 'zaag'];
export const vormVan = (t) => LFO_VORMEN[Math.min(LFO_VORMEN.length - 1,
  Math.max(0, Math.round(clamp(t) * (LFO_VORMEN.length - 1))))];

/** Samples per cyclus in de buffer. */
export const LFO_N = 4096;
/** Randen van blok en zaag: dit deel van de periode, een halve cosinus. Hard is een tik. */
export const LFO_RAND = 0.03;
/** Oude en nieuwe bron vloeien zo lang in elkaar over (na startDrempel). */
export const LFO_FADE = 0.02;

/** Zacht van a naar b over u ∈ [0, 1). */
const rand = (a, b, u) => a + (b - a) * (1 - Math.cos(Math.PI * u)) / 2;

/**
 * Eén cyclus van een golfvorm, puur. Gemiddeld 0, tussen −1 en 1, +1 op fase 0.
 * Blok: open op [0, ½), dicht op [½, 1), met zachte randen vlak vóór ½ en vóór 1.
 * Zaag: van +1 op de tel lineair naar −1, en in de laatste LFO_RAND weer omhoog.
 */
export function vormSamples(vorm, n = LFO_N) {
  const d = new Float32Array(n);
  const w = LFO_RAND;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    let v;
    if (vorm === 'driehoek') v = 1 - 4 * Math.min(f, 1 - f);
    else if (vorm === 'blok') {
      if (f < 0.5 - w) v = 1;
      else if (f < 0.5) v = rand(1, -1, (f - (0.5 - w)) / w);
      else if (f < 1 - w) v = -1;
      else v = rand(-1, 1, (f - (1 - w)) / w);
    } else if (vorm === 'zaag') {
      v = f < 1 - w ? 1 - 2 * f / (1 - w) : rand(-1, 1, (f - (1 - w)) / w);
    } else v = Math.cos(2 * Math.PI * f);
    d[i] = v;
  }
  return d;
}

/** Eén buffer per vorm per AudioContext. */
const buffers = new WeakMap();
function bufferVan(ctx, vorm) {
  let m = buffers.get(ctx);
  if (!m) { m = new Map(); buffers.set(ctx, m); }
  if (!m.has(vorm)) {
    const b = ctx.createBuffer(1, LFO_N, ctx.sampleRate);
    b.getChannelData(0).set(vormSamples(vorm));
    m.set(vorm, b);
  }
  return m.get(vorm);
}

/** Fase terug in [0, 1). */
const frac = (x) => x - Math.floor(x);

export class Lfo {
  /** @param klok  () => { beatLengte, ankerCtx } | null, zoals fxKlok() */
  constructor(ctx, { klok = () => null } = {}) {
    this.ctx = ctx;
    this.klok = klok;
    this.uit = ctx.createGain();
    this.bron = null;                // { src, g, start }: de bron die klinkt (of straks gaat klinken)
    this.seg = null;                 // { t0, fase0, periode }
    this.stand = { sync: false, hz: 1, tellen: 1, vorm: 'sinus' };
    this.tel = null;                 // laatst bekende tellengte
    this.weg = false;
    this.starts = 0;                 // voor de tests: hoe vaak er een nieuwe bron kwam
  }

  /** Fase op audiokloktijd t (niet teruggevouwen). */
  fase(t) {
    const s = this.seg;
    return s ? s.fase0 + (t - s.t0) / s.periode : 0;
  }

  /** De periode in seconden, zoals hij nu zou moeten zijn. */
  periode() {
    if (!this.stand.sync) return 1 / this.stand.hz;
    const k = this.klok();
    if (k?.beatLengte > 0) this.tel = k.beatLengte;
    return this.stand.tellen * (this.tel ?? 0.5);
  }

  /**
   * De stand zetten. Alleen wat echt anders is doet iets: een andere vorm of
   * modus is een nieuwe bron (met overvloeien), een andere deling op de maat
   * ook (opnieuw op de tel), een ander tempo in Hz glijdt op dezelfde bron.
   */
  zet({ sync = false, hz = 1, tellen = 1, vorm = 'sinus' } = {}) {
    if (this.weg) return;
    const oud = this.stand;
    this.stand = { sync: !!sync, hz: hz > 0 ? hz : 1, tellen: tellen > 0 ? tellen : 1, vorm };
    const s = this.stand;
    if (!this.bron || oud.vorm !== s.vorm || oud.sync !== s.sync || (s.sync && oud.tellen !== s.tellen)) {
      this._start(false);
    } else if (!s.sync && oud.hz !== s.hz) {
      this._glij();
    }
  }

  /** Opnieuw op de tel na een tempowissel, sprong of gridbewerking. Vrij: niets. */
  heranker() {
    if (!this.weg && this.stand.sync && this.bron) this._start(true);
  }

  /** In Hz: dezelfde bron, nieuwe snelheid. De fase loopt door (vanaf nu). */
  _glij() {
    const nu = this.ctx.currentTime, P = 1 / this.stand.hz;
    this.seg = { t0: nu, fase0: this.fase(nu), periode: P };
    const rate = this._rate(P);
    // Klinkt hij nog niet (net gebouwd), dan meteen; anders glijden.
    if (this.bron.start > nu) this.bron.src.playbackRate.value = rate;
    else this.bron.src.playbackRate.setTargetAtTime(rate, nu, 0.02);
  }

  _rate(P) { return (LFO_N / this.ctx.sampleRate) / P; }

  /**
   * Een nieuwe bron, op de fase waar hij hoort te zijn, en de oude erin laten
   * overvloeien. `alleenAlsNodig`: klopt tempo en fase al, dan niets (de
   * engine herankert bij elke 'change' van een deck).
   */
  _start(alleenAlsNodig) {
    const ctx = this.ctx, nu = ctx.currentTime, s = nu + startDrempel(ctx);
    const P = this.periode();
    let seg;
    const k = this.stand.sync ? this.klok() : null;
    if (k && Number.isFinite(k.ankerCtx) && k.beatLengte > 0) {
      // Op de tel: op het anker staat de cyclus op een hele tel. Welke tel
      // van de cyclus: waar de oude golf daar zou zijn, op de tel afgerond.
      const T = this.stand.tellen;
      let faseA = 0;
      if (T > 1 && this.seg) faseA = (Math.round(frac(this.fase(k.ankerCtx)) * T) % T) / T;
      seg = { t0: k.ankerCtx, fase0: faseA, periode: P };
    } else {
      seg = { t0: s, fase0: this.seg ? frac(this.fase(s)) : 0, periode: P };
    }
    if (alleenAlsNodig && this.seg) {
      const d = frac(seg.fase0 + (s - seg.t0) / seg.periode - this.fase(s) + 0.5) - 0.5;
      if (Math.abs(seg.periode - this.seg.periode) <= 1e-9 * P && Math.abs(d) < 1e-4) return;
    }
    this.seg = seg;

    const buf = bufferVan(ctx, this.stand.vorm);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = this._rate(P);
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.uit);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (_) {} };
    const offset = frac(this.fase(s)) * buf.duration;
    try { src.start(s, offset); } catch (_) { try { src.start(); } catch (__) {} }
    this.starts++;

    const oud = this.bron;
    this.bron = { src, g, start: s };
    if (oud && oud.start > nu) {
      // Nog niet begonnen (twee standen kort na elkaar, of bij het bouwen):
      // die hoeft nergens uit te vloeien.
      try { oud.src.stop(); } catch (_) {}
    } else if (oud) {
      vloei(oud.g.gain, 0, ctx);
      try { oud.src.stop(s + LFO_FADE + 0.005); } catch (_) {}
    }
    vloei(g.gain, 1, ctx);
  }

  vernietig() {
    this.weg = true;
    if (this.bron) { try { this.bron.src.stop(); } catch (_) {} }
    this.bron = null;
  }
}

/** Lineair in LFO_FADE, na startDrempel: bron en golf lopen dan al. */
function vloei(param, naar, ctx) {
  const nu = ctx.currentTime;
  try { zetHellingen(param, (van) => [van, naar], nu, LFO_FADE, startDrempel(ctx)); }
  catch (_) { try { param.setTargetAtTime(naar, nu, LFO_FADE / 3); } catch (__) { try { param.value = naar; } catch (___) {} } }
}
