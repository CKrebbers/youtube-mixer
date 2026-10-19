// De mixer: crossfader, master en limiter (ARCHITECTUUR.md, contract "Strip en mixer").
//
//   strips (kant) -> in (master gain) -+-> compressor -> compUit -+-> limiter (uitgang van de limiterstap)
//                                      `-> worklet -> wlUit ------'        -> analyser -> uit (ctx.destination)
//                                                 `-> (uitgang 1: gain) -> grAnalyser       `-> meter
//
// De limiter is die van v1 (limiter-kern.js: vooruitblik 1,5 ms, −1 dBTP,
// gekoppeld, afvalvrij). De worklet laadt async; tot hij er is doet een
// DynamicsCompressorNode het werk (v1 master.js). Nooit herbedraden terwijl
// er geluid door kan lopen:
//   - laadt hij terwijl de context stilstaat (de gewone gang), dan gaat de
//     compressor eruit en de worklet erin: er loopt niets;
//   - loopt de audio al, dan een equal-power kruisfade van 40 ms tussen de
//     twee complete paden, en het oude pas los als de audioklok voorbij de fade is.
// Lukt laden niet, dan blijft de compressor (met de reden in limiterStand()).
// Gooit de worklet later een fout, dan komt de compressor terug.
import { clamp } from '../kern/emitter.js';
import { startDrempel, zetHellingen } from './overgang.js';
import { faderGain, zetDoel, killVersterking, naAudioklok, maakMeter, KILL_FADE, TAU } from './strip.js';
import { PLAFOND_DB, VOORUIT, RELEASE, MARGE_DB, vertragingFrames } from './limiter-kern.js';

/** De vertraging van Chrome's DynamicsCompressor (zijn vooruitblik): 288 samples, gemeten in v1 (5 okt). */
export const COMPRESSOR_VERTRAGING = 0.006;
/** De kruisfade van compressor naar worklet (en terug), als de audio loopt. */
export const LIMITER_FADE = 0.04;
/** Zoveel samples gain leest gr() per keer (21 ms op 48 kHz). */
const GR_N = 1024;
/** Onder deze gain reduction (dB) zegt gr() niets meer. */
export const GR_VLOER = -40;
/** Beginstand van de master (v1: 0,8 = −9 dB, ruimte voor de limiter). */
export const MASTER_BEGIN = 0.8;

/** Equal-power crossfader (v1 xfaderGains, 'smooth'): x = 0 alleen A, x = 1 alleen B, a² + b² = 1. */
export function xfaderGains(x) {
  const t = clamp(x);
  return { a: Math.cos(t * Math.PI / 2), b: Math.cos((1 - t) * Math.PI / 2) };
}

/** Equal-power van `van` naar `naar` in 33 punten (v1 ePunten): voor de wissel van limiter. */
const ePunten = (van, naar) => {
  const p = new Array(33);
  for (let i = 0; i < 33; i++) {
    const t = i / 32;
    p[i] = i === 0 ? van : i === 32 ? naar : van * Math.cos(t * Math.PI / 2) + naar * Math.sin(t * Math.PI / 2);
  }
  return p;
};

/** Een fout van een worklet als event op de context (zoals v1 worklet-fout.js): de engine maakt er een melding van. */
function meldWorkletFout(ctx, wat, reden, hint) {
  try {
    if (typeof CustomEvent === 'function' && typeof ctx.dispatchEvent === 'function') {
      ctx.dispatchEvent(new CustomEvent('varve-workletfout', { detail: { wat, reden, hint } }));
    }
  } catch (_) { /* melden mag nooit de master meenemen */ }
}

const los = (van, naar) => { try { van.disconnect(naar); } catch (_) { /* was al los */ } };

class Mixer {
  constructor(ctx, { limiter = true, uit = ctx.destination } = {}) {
    this.ctx = ctx;
    this._strips = new Set();
    this._stand = { xfader: 0.5, master: MASTER_BEGIN };
    this._weg = null;

    const inn = ctx.createGain();
    inn.channelCount = 2;
    inn.channelCountMode = 'explicit';
    inn.channelInterpretation = 'speakers';
    inn.gain.value = faderGain(MASTER_BEGIN);
    this.in = inn;

    // v1: drempel −1,5 dB, knie 0, ratio 20, 2 ms aan, 100 ms los.
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -1.5;
    c.knee.value = 0;
    c.ratio.value = 20;
    c.attack.value = 0.002;
    c.release.value = 0.1;
    this.compressor = c;
    this._compUit = ctx.createGain();
    this.limiter = ctx.createGain();

    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    this.analyser = an;

    inn.connect(c);
    c.connect(this._compUit);
    this._compUit.connect(this.limiter);
    this.limiter.connect(an);
    an.connect(uit);
    this._uit = uit;
    this._meter = maakMeter(ctx, an);

    this.soort = 'compressor';
    this.limiterNode = null;
    this.fout = null;
    this.opties = { plafondDb: PLAFOND_DB, vooruit: VOORUIT, release: RELEASE, margeDb: MARGE_DB };
    this._wl = null;
    this._gr = null;
    this._grBuf = null;
    /** Waar als de worklet erin zit, onwaar als het de compressor blijft. */
    this.klaar = limiter ? this._laad() : Promise.resolve(false);
  }

  // ---- bediening ----------------------------------------------------------------

  /** 'xfader' of 'master', 0..1. NaN wordt genegeerd, onbekend is een TypeError. */
  zet(naam, v) {
    if (naam !== 'xfader' && naam !== 'master') throw new TypeError(`mixer.zet: onbekende knop '${naam}'`);
    if (this._weg || typeof v !== 'number' || Number.isNaN(v)) return false;
    const w = clamp(v);
    if (w === this._stand[naam]) return true;
    this._stand[naam] = w;
    const nu = this.ctx.currentTime;
    if (naam === 'master') zetDoel(this.in.gain, faderGain(w), nu, TAU.master);
    else for (const st of this._strips) if (st.kant() !== 'thru') st._volgXfader(nu);
    return true;
  }

  lees(naam) { return this._stand[naam]; }

  /** Wat de crossfader nu met een kant doet: A en B volgen hem, thru niet. */
  kantGain(kant) {
    if (kant === 'thru') return 1;
    const { a, b } = xfaderGains(this._stand.xfader);
    return kant === 'A' ? a : kant === 'B' ? b : 0;
  }

  _meld(st) { if (!this._weg) this._strips.add(st); }
  _vergeet(st) { this._strips.delete(st); }

  // ---- meters ---------------------------------------------------------------------

  /** { piek, rms } van een strip, lineair, vóór zijn fader. Hetzelfde object bij elke oproep (geen afval). */
  meter(st) { return st._meter.lees(); }

  /** { piek, rms } van de master, na de limiter (wat de zaal hoort). Hetzelfde object bij elke oproep. */
  meterMaster() { return this._meter.lees(); }

  // ---- de limiter ------------------------------------------------------------------

  /** De vertraging van de limiterstap (s): de vooruitblik van wat er nu in zit. */
  get vertraging() {
    return this.soort === 'worklet'
      ? vertragingFrames(this.ctx.sampleRate, this.opties.vooruit) / this.ctx.sampleRate
      : COMPRESSOR_VERTRAGING;
  }

  async _laad() {
    const ctx = this.ctx;
    if (!ctx.audioWorklet?.addModule || typeof AudioWorkletNode !== 'function') return false;
    try {
      await ctx.audioWorklet.addModule(new URL('./limiter-worklet.js', import.meta.url));
      if (this._weg) return false;
      const node = new AudioWorkletNode(ctx, 'varve-limiter', {
        numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 1],
        processorOptions: { ...this.opties },
      });
      node.onprocessorerror = (e) => this._limiterFout(node, e);
      this._neemOver(node);
      return true;
    } catch (err) {
      this.fout = err?.message || String(err);
      return false;
    }
  }

  /** De worklet erin: direct als er niets loopt, anders met een equal-power kruisfade. */
  _neemOver(node) {
    const ctx = this.ctx;
    const loopt = ctx.state === 'running';
    const wl = ctx.createGain();
    wl.gain.value = loopt ? 0 : 1;
    const gr = ctx.createAnalyser();
    gr.fftSize = GR_N;
    gr.smoothingTimeConstant = 0;
    this.in.connect(node);
    node.connect(wl, 0);
    wl.connect(this.limiter);
    node.connect(gr, 1);                 // de gain per sample: een tap, loopt nergens heen
    this.limiterNode = node;
    this._wl = wl;
    this._gr = gr;
    this._grBuf = new Float32Array(GR_N);
    this.soort = 'worklet';
    if (!loopt) { this._compressorWeg(); return; }

    const nu = ctx.currentTime, wacht = startDrempel(ctx);
    zetHellingen(this._compUit.gain, (van) => ePunten(van, 0), nu, LIMITER_FADE, wacht);
    zetHellingen(wl.gain, (van) => ePunten(van, 1), nu, LIMITER_FADE, wacht);
    const uitje = this._compUit;
    naAudioklok(ctx, nu + wacht + LIMITER_FADE + 0.01, () => {
      // Kwam er intussen een fout (de compressor weer terug), dan blijft hij.
      if (this._compUit === uitje && this.soort === 'worklet' && !this._weg) this._compressorWeg();
    });
  }

  /**
   * De worklet gooide een fout: vanaf nu geeft hij stilte, dus de hele master
   * zou stil zijn. Terug naar de compressor (vanaf nul ingevloeid: de worklet
   * zwijgt al) en melden. Zoals v1 Master._limiterFout.
   */
  _limiterFout(node, e) {
    if (node !== this.limiterNode || this._weg) return;
    const ctx = this.ctx;
    los(this.in, node);
    try { node.disconnect(); } catch (_) {}
    node.onprocessorerror = null;
    try { node.port.close(); } catch (_) {}
    try { this._wl?.disconnect(); } catch (_) {}
    try { this._gr?.disconnect(); } catch (_) {}
    this.limiterNode = null;
    this._wl = null; this._gr = null; this._grBuf = null;
    const loopt = ctx.state === 'running', nu = ctx.currentTime;
    if (this._compUit) {
      // Nog midden in de kruisfade naar de worklet: de compressor blijft en gaat terug naar vol.
      if (loopt) zetHellingen(this._compUit.gain, (van) => ePunten(van, 1), nu, LIMITER_FADE, startDrempel(ctx));
      else { this._compUit.gain.cancelScheduledValues(0); this._compUit.gain.value = 1; }
    } else {
      const g = ctx.createGain();
      g.gain.value = loopt ? 0 : 1;
      this.in.connect(this.compressor);
      this.compressor.connect(g);
      g.connect(this.limiter);
      this._compUit = g;
      if (loopt) zetHellingen(g.gain, (van) => ePunten(van, 1), nu, LIMITER_FADE, startDrempel(ctx));
    }
    const reden = e?.message || e?.error?.message || '';
    this.soort = 'compressor';
    this.fout = `de limiter-worklet liep vast${reden ? ` (${reden})` : ''}`;
    meldWorkletFout(ctx, 'de master-limiter', reden, 'de compressor doet het werk weer');
  }

  /** Het compressorpad los (alleen als er niets meer doorheen klinkt). */
  _compressorWeg() {
    if (!this._compUit) return;
    los(this.in, this.compressor);
    this.compressor.disconnect();
    this._compUit.disconnect();
    this._compUit = null;
  }

  /** Gain reduction NU, in dB (≤ 0): de laagste gain van de laatste 21 ms (worklet), of wat de compressor zegt. */
  gr() {
    if (this._gr) {
      const b = this._grBuf;
      this._gr.getFloatTimeDomainData(b);
      let m = 1;
      for (let i = 0; i < b.length; i++) if (b[i] < m) m = b[i];
      // 0 = nog niets gerenderd (de analyser begint met nullen); de gain zelf is nooit 0.
      if (!(m > 0) || m >= 1) return 0;
      return Math.max(GR_VLOER, 20 * Math.log10(m));
    }
    const r = this.compressor.reduction;
    return Number.isFinite(r) ? Math.max(GR_VLOER, Math.min(0, r)) : 0;
  }

  /** De limiter voor het scherm: soort, gain reduction (dB), vertraging (s), plafond (dBTP), fout. */
  limiterStand() {
    return { soort: this.soort, gr: this.gr(), vertraging: this.vertraging, plafond: this.opties.plafondDb, fout: this.fout };
  }

  /**
   * Weg: de master klikvrij dicht, dan de worklet 'stop' en alles los als de
   * audioklok voorbij de overgang is. Geeft een Promise (meteen klaar als de
   * context stilstaat).
   */
  vernietig() {
    if (this._weg) return this._weg;
    const ctx = this.ctx;
    const nu = ctx.currentTime, wacht = startDrempel(ctx);
    if (ctx.state === 'running') killVersterking(this.in.gain, 0, nu, wacht);
    this._weg = naAudioklok(ctx, nu + wacht + KILL_FADE + 0.01, () => {
      const node = this.limiterNode;
      if (node) {
        // Eerst 'stop' (process() geeft dan false), pas daarna los en dicht.
        try { node.port.postMessage('stop'); } catch (_) {}
        node.onprocessorerror = null;
        try { node.disconnect(); } catch (_) {}
        try { node.port.close(); } catch (_) {}
        this.limiterNode = null;
      }
      this._meter.los();
      for (const n of [this.in, this.compressor, this._compUit, this._wl, this._gr, this.limiter, this.analyser]) {
        try { n?.disconnect(); } catch (_) {}
      }
      this._strips.clear();
    });
    return this._weg;
  }
}

/** De mixer: master gain -> limiter -> analyser -> ctx.destination. `limiter: false` = alleen de compressor. */
export function maakMixer(ctx, opties) {
  return new Mixer(ctx, opties);
}
