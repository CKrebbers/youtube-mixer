// Een Web Audio-nabootsing voor de tests (geen test zelf). STRENGER dan
// makkelijk, want een mock die makkelijker is dan de echte API verbergt bugs
// (v1 CLAUDE.md, "Mocks"; naar v1 test/nep-tijdlijn.mjs en engine.test.mjs):
//
//   - Elke AudioParam heeft een TIJDLIJN (setValueAtTime, linearRampToValueAtTime,
//     setTargetAtTime, cancelAndHoldAtTime, cancelScheduledValues) en rekent uit
//     wat hij op elk moment doet: `waarde(t)`. Zo is een sprong te meten.
//   - setValueCurveAtTime die een andere curve overlapt, of een gebeurtenis
//     binnen een lopende curve: NotSupportedError, zoals Chrome.
//     cancelAndHoldAtTime midden in een curve gooit niet maar telt als
//     CURVE_BREUK (Chrome speelt dan het afgekapte stuk opnieuw: een sprong).
//   - Een helling direct na een setTargetAtTime telt als RAMP_NA_DOEL: waar die
//     begint is in Chrome niet wat je denkt. Een gebeurtenis in het verleden
//     telt als VERLEDEN.
//   - Niet-eindige waarden: TypeError; negatieve tijd of tijdconstante: RangeError.
//   - connect() controleert context en uitgang/ingang (IndexSizeError), disconnect(doel)
//     van iets dat niet verbonden is gooit InvalidAccessError, zoals Chrome.
//   - BiquadFilter.type en AnalyserNode.fftSize worden gecontroleerd.
//   - audioWorklet.addModule leest het bestand en kent alleen de namen die het met
//     registerProcessor aanmeldt; een AudioWorkletNode met een andere naam: InvalidStateError.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fout = (naam, tekst) => Object.assign(new Error(`${naam}: ${tekst}`), { name: naam });
const BIQUAD_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];

export class NepAudioParam {
  constructor(omg, v0 = 0, min = -3.4028234663852886e38, max = 3.4028234663852886e38) {
    this.omg = omg;
    this.defaultValue = v0;
    this.minValue = min;
    this.maxValue = max;
    this._v0 = v0;
    this._ev = [];          // { type: 'set' | 'lin' | 'target', v, t, tau? }, op tijd
    this._curves = [];      // { a, b }
    this.n = { set: 0, lin: 0, target: 0, hold: 0, cancel: 0, curve: 0 };
    this.oproepen = [];     // [methode, ...argumenten], voor wie precies wil kijken
  }

  get value() { return this.waarde(this.omg.nu); }
  set value(x) {
    if (!Number.isFinite(x)) throw new TypeError('AudioParam.value: geen eindig getal');
    this.oproepen.push(['value', x]);
    this._voeg({ type: 'set', v: x, t: this.omg.nu });
  }

  /** De waarde op audiokloktijd t. */
  waarde(t) {
    let v = this._v0, tv = -Infinity, doel = null;
    const verval = (tt) => {
      if (!doel) return v;
      if (doel.tau === 0) return tt > tv ? doel.v : v;
      return doel.v + (v - doel.v) * Math.exp(-(tt - tv) / doel.tau);
    };
    for (const e of this._ev) {
      if (e.t > t) {
        if (e.type === 'lin') { const a = verval(tv); return a + (e.v - a) * (t - tv) / (e.t - tv); }
        break;
      }
      if (e.type === 'target') { v = verval(e.t); tv = e.t; doel = e; } else { v = e.v; tv = e.t; doel = null; }
    }
    return verval(t);
  }

  _tijd(t, wat) {
    if (!Number.isFinite(t)) throw new TypeError(`${wat}: tijd is geen eindig getal`);
    if (t < 0) throw new RangeError(`${wat}: negatieve tijd`);
    if (t < this.omg.nu - 1e-12) this.omg.stats.VERLEDEN++;
  }
  _getal(x, wat) { if (!Number.isFinite(x)) throw new TypeError(`${wat}: waarde is geen eindig getal`); }
  _inCurve(t) {
    for (const c of this._curves) if (t >= c.a && t < c.b) { this.omg.stats.OVERLAP_FOUTEN++; throw fout('NotSupportedError', 'gebeurtenis binnen een lopende setValueCurveAtTime'); }
  }
  _voeg(e) {
    let i = this._ev.length;
    while (i > 0 && this._ev[i - 1].t > e.t) i--;
    this._ev.splice(i, 0, e);
    if (this._ev.length > 200) this._snoei(this.omg.nu - 0.25);
  }
  /** Alles vóór `grens` samenvatten in één punt (exact: wat erna komt begint daar). */
  _snoei(grens) {
    const blijft = this._ev.filter((e) => e.t > grens);
    const v = this.waarde(grens);
    let doel = null;
    for (const e of this._ev) { if (e.t > grens) break; doel = e.type === 'target' ? e : null; }
    this._v0 = v;
    this._ev = [{ type: 'set', v, t: grens }, ...(doel ? [{ ...doel, t: grens }] : []), ...blijft];
    this._curves = this._curves.filter((c) => c.b > grens);
  }

  setValueAtTime(x, t) {
    this._getal(x, 'setValueAtTime'); this._tijd(t, 'setValueAtTime'); this._inCurve(t);
    this.n.set++; this.oproepen.push(['setValueAtTime', x, t]);
    this._voeg({ type: 'set', v: x, t });
    return this;
  }
  linearRampToValueAtTime(x, t) {
    this._getal(x, 'linearRampToValueAtTime'); this._tijd(t, 'linearRampToValueAtTime'); this._inCurve(t);
    let vorige = null;
    for (const e of this._ev) { if (e.t > t) break; vorige = e; }
    if (vorige?.type === 'target') this.omg.stats.RAMP_NA_DOEL++;
    this.n.lin++; this.oproepen.push(['linearRampToValueAtTime', x, t]);
    this._voeg({ type: 'lin', v: x, t });
    return this;
  }
  exponentialRampToValueAtTime(x, t) {
    // Niet nagebouwd: niemand hoort hem te gebruiken (een exp-helling naar 0 kan niet).
    throw fout('NotSupportedError', 'exponentialRampToValueAtTime: niet in de mock, gebruik zetHellingen');
  }
  setTargetAtTime(x, t, tau) {
    this._getal(x, 'setTargetAtTime'); this._tijd(t, 'setTargetAtTime'); this._inCurve(t);
    if (!Number.isFinite(tau)) throw new TypeError('setTargetAtTime: tijdconstante is geen eindig getal');
    if (tau < 0) throw new RangeError('setTargetAtTime: negatieve tijdconstante');
    this.n.target++; this.oproepen.push(['setTargetAtTime', x, t, tau]);
    this._voeg({ type: 'target', v: x, t, tau });
    return this;
  }
  setValueCurveAtTime(curve, t, d) {
    this._tijd(t, 'setValueCurveAtTime');
    if (!(curve?.length >= 2)) throw fout('InvalidStateError', 'setValueCurveAtTime: curve korter dan 2');
    if (!(d > 0)) throw new RangeError('setValueCurveAtTime: duur ≤ 0');
    for (const k of this._curves) if (t < k.b && t + d > k.a) { this.omg.stats.OVERLAP_FOUTEN++; throw fout('NotSupportedError', 'setValueCurveAtTime overlapt een lopende curve'); }
    for (const e of this._ev) if (e.t >= t && e.t < t + d) { this.omg.stats.OVERLAP_FOUTEN++; throw fout('NotSupportedError', 'setValueCurveAtTime over een geplande gebeurtenis'); }
    this.n.curve++; this.omg.stats.CURVES++; this.oproepen.push(['setValueCurveAtTime', curve, t, d]);
    this._curves.push({ a: t, b: t + d });
    for (let i = 0; i < curve.length; i++) this._ev.push({ type: i ? 'lin' : 'set', v: curve[i], t: t + d * i / (curve.length - 1) });
    this._ev.sort((p, q) => p.t - q.t);
    return this;
  }
  // Volgens de spec: alles wat op of na t begint verdwijnt (een lopende helling dus ook: zijn tijd is zijn eind).
  cancelScheduledValues(t) {
    this._tijd(t, 'cancelScheduledValues');
    this.n.cancel++; this.oproepen.push(['cancelScheduledValues', t]);
    this._ev = this._ev.filter((e) => e.t < t);
    this._curves = this._curves.filter((c) => c.a < t);
    return this;
  }
  // Vasthouden op t: een lopende helling eindigt op t met zijn waarde daar, een lopend doel blijft daar staan.
  cancelAndHoldAtTime(t) {
    this._tijd(t, 'cancelAndHoldAtTime');
    if (this._curves.some((c) => c.a < t && t < c.b)) this.omg.stats.CURVE_BREUK++;
    this._curves = this._curves.filter((c) => c.a < t).map((c) => ({ a: c.a, b: Math.min(c.b, t) }));
    this.n.hold++; this.oproepen.push(['cancelAndHoldAtTime', t]);
    const v = this.waarde(t);
    const lopend = this._ev.find((e) => e.t > t);
    this._ev = this._ev.filter((e) => e.t < t);
    this._ev.push({ type: lopend?.type === 'lin' ? 'lin' : 'set', v, t });
    return this;
  }

  /** De waarden van t0 tot t1 per sample (sr), door `omzet` (bv. dB -> amplitude). */
  bemonster(t0, t1, sr = this.omg.ctx.sampleRate, omzet = (x) => x) {
    const n = Math.max(1, Math.round((t1 - t0) * sr));
    const uit = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) uit[i] = omzet(this.waarde(t0 + i / sr));
    return uit;
  }
  /**
   * Sprongen in de tijdlijn vanaf `vanaf`: een setValueAtTime die niet op de
   * waarde van vlak ervoor ligt, of een helling van nul lang. Hellingen en
   * doelen zelf zijn continu, dus dit zijn precies de plekken waar het tikt.
   */
  sprongen(vanaf = -Infinity, tol = 1e-6) {
    const uit = [];
    let vorige = null;
    for (const e of this._ev) {
      if (e.t > vanaf) {
        const voor = this.waarde(e.t - 1e-12);
        const grens = tol * Math.max(1, Math.abs(voor));
        if (e.type === 'set' && Math.abs(e.v - voor) > grens) uit.push({ t: e.t, van: voor, naar: e.v });
        if (e.type === 'lin' && vorige && e.t === vorige.t && Math.abs(e.v - vorige.v) > grens) uit.push({ t: e.t, van: vorige.v, naar: e.v });
      }
      vorige = e;
    }
    return uit;
  }

  /** De grootste stap tussen twee samples van t0 tot t1. */
  grootsteStap(t0, t1, omzet, sr) {
    const w = this.bemonster(t0, t1, sr, omzet);
    let m = 0;
    for (let i = 1; i < w.length; i++) m = Math.max(m, Math.abs(w[i] - w[i - 1]));
    return m;
  }
}

class NepNode {
  constructor(ctx, soort, ingangen = 1, uitgangen = 1) {
    this.context = ctx;
    this.soort = soort;
    this.numberOfInputs = ingangen;
    this.numberOfOutputs = uitgangen;
    this.channelCount = 2;
    this.channelCountMode = 'max';
    this.channelInterpretation = 'speakers';
  }
  get _omg() { return this.context._omg; }
  _param(v0, min, max) { const p = new NepAudioParam(this._omg, v0, min, max); p.node = this; return p; }
  connect(doel, uit = 0, inn = 0) {
    if (this.context.state === 'closed') throw fout('InvalidStateError', 'context is dicht');
    if (!Number.isInteger(uit) || uit < 0 || uit >= this.numberOfOutputs) throw fout('IndexSizeError', `uitgang ${uit} van ${this.soort} bestaat niet`);
    if (doel instanceof NepAudioParam) {
      if (doel.omg !== this._omg) throw fout('InvalidAccessError', 'param van een andere context');
      if (!this._omg.lijnen.some((l) => l.van === this && l.naar === doel && l.uit === uit)) this._omg.lijnen.push({ van: this, naar: doel, uit, inn: 0 });
      return undefined;
    }
    if (!(doel instanceof NepNode)) throw new TypeError('connect: geen AudioNode');
    if (doel.context !== this.context) throw fout('InvalidAccessError', 'node van een andere context');
    if (!Number.isInteger(inn) || inn < 0 || inn >= doel.numberOfInputs) throw fout('IndexSizeError', `ingang ${inn} van ${doel.soort} bestaat niet`);
    // Twee keer dezelfde verbinding is in Web Audio één verbinding.
    if (!this._omg.lijnen.some((l) => l.van === this && l.naar === doel && l.uit === uit && l.inn === inn)) this._omg.lijnen.push({ van: this, naar: doel, uit, inn });
    return doel;
  }
  disconnect(doel, uit, inn) {
    const L = this._omg.lijnen;
    if (doel === undefined) { this._omg.lijnen = L.filter((l) => l.van !== this); return; }
    if (typeof doel === 'number') {
      if (!(doel >= 0 && doel < this.numberOfOutputs)) throw fout('IndexSizeError', `uitgang ${doel} bestaat niet`);
      this._omg.lijnen = L.filter((l) => !(l.van === this && l.uit === doel));
      return;
    }
    const past = (l) => l.van === this && l.naar === doel && (uit === undefined || l.uit === uit) && (inn === undefined || l.inn === inn);
    if (!L.some(past)) throw fout('InvalidAccessError', `${this.soort} is niet verbonden met ${doel?.soort ?? 'dat doel'}`);
    this._omg.lijnen = L.filter((l) => !past(l));
  }
}

class NepGain extends NepNode {
  constructor(ctx) { super(ctx, 'gain'); this.gain = this._param(1); }
}

class NepBiquad extends NepNode {
  constructor(ctx) {
    super(ctx, 'biquad');
    this._type = 'lowpass';
    this.frequency = this._param(350, 0, ctx.sampleRate / 2);
    this.Q = this._param(1);
    this.gain = this._param(0);
    this.detune = this._param(0);
  }
  get type() { return this._type; }
  set type(t) { if (!BIQUAD_TYPES.includes(t)) throw new TypeError(`BiquadFilter.type: '${t}' bestaat niet`); this._type = t; }
}

class NepCompressor extends NepNode {
  constructor(ctx) {
    super(ctx, 'compressor');
    this.threshold = this._param(-24, -100, 0);
    this.knee = this._param(30, 0, 40);
    this.ratio = this._param(12, 1, 20);
    this.attack = this._param(0.003, 0, 1);
    this.release = this._param(0.25, 0, 1);
    this.reduction = 0;
  }
}

class NepAnalyser extends NepNode {
  constructor(ctx) {
    super(ctx, 'analyser');
    this._fft = 2048;
    this.smoothingTimeConstant = 0.8;
    /** Wat de analyser "hoort": een getal (constant) of een Float32Array (rondlopend). */
    this.signaal = 0;
  }
  get fftSize() { return this._fft; }
  set fftSize(n) {
    if (!(Number.isInteger(n) && n >= 32 && n <= 32768 && (n & (n - 1)) === 0)) throw fout('IndexSizeError', `fftSize ${n}`);
    this._fft = n;
  }
  get frequencyBinCount() { return this._fft / 2; }
  getFloatTimeDomainData(b) {
    if (!(b instanceof Float32Array)) throw new TypeError('getFloatTimeDomainData: geen Float32Array');
    const n = Math.min(b.length, this._fft), s = this.signaal;
    if (typeof s === 'number') for (let i = 0; i < n; i++) b[i] = s;
    else for (let i = 0; i < n; i++) b[i] = s[i % s.length];
  }
  getByteTimeDomainData(b) {
    const n = Math.min(b.length, this._fft), s = this.signaal;
    for (let i = 0; i < n; i++) {
      const x = typeof s === 'number' ? s : s[i % s.length];
      b[i] = Math.max(0, Math.min(255, Math.round(128 + 128 * x)));
    }
  }
}

class NepPort {
  constructor() { this.berichten = []; this.dicht = false; this.onmessage = null; }
  postMessage(m) { if (!this.dicht) this.berichten.push(m); }
  close() { this.dicht = true; }
}

/** Zoals de echte: numberOfOutputs en outputChannelCount moeten kloppen, de naam moet geregistreerd zijn. */
export class NepAudioWorkletNode extends NepNode {
  constructor(ctx, naam, opties = {}) {
    if (!(ctx instanceof NepAudioContext)) throw new TypeError('AudioWorkletNode: geen (nep-)AudioContext');
    if (ctx.state === 'closed') throw fout('InvalidStateError', 'context is dicht');
    if (!ctx._omg.processors.has(naam)) throw fout('InvalidStateError', `processor '${naam}' is niet geregistreerd`);
    const uit = opties.numberOfOutputs ?? 1;
    if (opties.outputChannelCount && opties.outputChannelCount.length !== uit) throw fout('IndexSizeError', 'outputChannelCount past niet bij numberOfOutputs');
    super(ctx, `worklet:${naam}`, opties.numberOfInputs ?? 1, uit);
    this.naam = naam;
    this.opties = opties;
    this.port = new NepPort();
    this.onprocessorerror = null;
    ctx._omg.worklets.push(this);
  }
}

export class NepAudioContext extends EventTarget {
  constructor(omg, sampleRate, baseLatency) {
    super();
    this._omg = omg;
    this.sampleRate = sampleRate;
    this.baseLatency = baseLatency;
    this.outputLatency = 0.01;
    this.destination = new NepNode(this, 'destination', 1, 1);
    this.destination.maxChannelCount = 2;
    this.audioWorklet = {
      addModule: async (url) => {
        if (this.state === 'closed') throw fout('InvalidStateError', 'context is dicht');
        const pad = String(url);
        omg.modules.push(pad);
        await omg.laad(pad);
        const tekst = readFileSync(pad.startsWith('file:') ? fileURLToPath(pad) : pad, 'utf8');
        for (const m of tekst.matchAll(/registerProcessor\(\s*['"]([^'"]+)['"]/g)) omg.processors.add(m[1]);
      },
    };
  }
  get currentTime() { return this._omg.nu; }
  get state() { return this._omg.staat; }
  createGain() { return new NepGain(this); }
  createBiquadFilter() { return new NepBiquad(this); }
  createDynamicsCompressor() { return new NepCompressor(this); }
  createAnalyser() { return new NepAnalyser(this); }
  createChannelSplitter(n = 6) {
    if (!(n >= 1 && n <= 32)) throw fout('IndexSizeError', `splitter met ${n} uitgangen`);
    const s = new NepNode(this, 'splitter', 1, n);
    s.channelCount = n; s.channelCountMode = 'explicit'; s.channelInterpretation = 'discrete';
    return s;
  }
  createChannelMerger(n = 6) { return new NepNode(this, 'merger', n, 1); }
  resume() { if (this._omg.staat !== 'closed') this._omg.staat = 'running'; return Promise.resolve(); }
  suspend() { if (this._omg.staat !== 'closed') this._omg.staat = 'suspended'; return Promise.resolve(); }
  close() { this._omg.staat = 'closed'; return Promise.resolve(); }
}

/**
 * Een omgeving: één context met zijn klok (`nu`, met de hand vooruit), zijn
 * verbindingen, worklets en tellers. `laad(url)` mag vertragen of gooien
 * (een worklet die laat of niet laadt).
 */
export class NepOmgeving {
  constructor({ sampleRate = 48000, baseLatency = 0.005, staat = 'running' } = {}) {
    this.nu = 0;
    this.staat = staat;
    this.stats = { CURVE_BREUK: 0, OVERLAP_FOUTEN: 0, RAMP_NA_DOEL: 0, VERLEDEN: 0, CURVES: 0 };
    this.lijnen = [];
    this.worklets = [];
    this.modules = [];
    this.processors = new Set();
    this.laad = async () => {};
    this.ctx = new NepAudioContext(this, sampleRate, baseLatency);
  }
  /** Is er een verbinding van `van` naar `naar` (op uitgang `uit`)? */
  heeft(van, naar, uit) { return this.lijnen.some((l) => l.van === van && l.naar === naar && (uit === undefined || l.uit === uit)); }
  uitVan(van) { return this.lijnen.filter((l) => l.van === van); }
  naar(naar) { return this.lijnen.filter((l) => l.naar === naar); }
}

/** De globale AudioWorkletNode die de app gebruikt (zoals in de browser). */
export function installeer() { globalThis.AudioWorkletNode = NepAudioWorkletNode; }
