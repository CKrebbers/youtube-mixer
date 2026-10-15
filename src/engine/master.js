import { InsertSlot } from './fx.js';
import { startDrempel, zetHellingen } from './overgang.js';
import { zetGraafVertraging } from './hoorbaar.js';
import { PLAFOND_DB, VOORUIT, RELEASE, MARGE_DB, vertragingFrames } from './limiter-kern.js';
import { meldWorkletFout } from './worklet-fout.js';

/**
 * De master (docs/MASTER.md, ROADMAP 27 S2a):
 *
 *   input = gain (masterfader) -> fx (insert-rack) -> limiter -> analyser -> uit (de zaal)
 *                                                                        |-> koptelefoon (zaal), opname, vormen
 *
 * FX: een gewone InsertSlot, hetzelfde racksysteem als een track (racks, acht
 * plekken, mix, aan/uit), op de maat van de maatgever (de engine zet de klok).
 * Hij hangt aan geen nummer: welk rack er in zit bewaart de schermlaag
 * (master-paneel.js, localStorage).
 *
 * LIMITER: een AudioWorklet met vooruitblik (limiter-kern.js): plafond −1 dBFS
 * true peak, 1,5 ms vooruit, stereo-gekoppeld, release 80 ms. De worklet laadt
 * async; tot hij er is doet de DynamicsCompressor van vroeger het werk. Nooit
 * herbedraden terwijl er geluid door kan lopen:
 *   - laadt hij terwijl de AudioContext nog stilstaat (de gewone gang: de
 *     engine wordt gemaakt vóór "audio starten"), dan gaat de compressor er
 *     gewoon uit en de worklet erin: er loopt niets;
 *   - loopt de audio al, dan een equal-power kruisfade van 40 ms van het ene
 *     complete pad naar het andere (zoals een rackwissel), en het oude pad
 *     pas weg als de fade klaar is. Let op: de compressor van Chrome is 6 ms
 *     vertraging, de worklet 1,5 ms; in die 40 ms hoor je ze dus allebei,
 *     4,5 ms uit elkaar. Alleen als het laden lang duurt.
 * Lukt laden niet (geen AudioWorklet, een fout), dan blijft de compressor.
 *
 * Wat er na de limiter gebeurt blijft zoals het was: `analyser` is het eind,
 * en daar tappen de opname, de zaal in de koptelefoon en de vormen ("wat de
 * zaal hoort"). De vooruitblik is vertraging en staat dus in hoorbaar.js.
 *
 * `limiter` is de UITGANG van de limiterstap: daar komen het compressorpad en
 * het workletpad samen. De compressor zelf is `compressor`, de worklet
 * `limiterNode` (null tot hij geladen is).
 */

/** De vertraging van Chrome's DynamicsCompressor (zijn vooruitblik): 288 samples, gemeten 5 okt. */
export const COMPRESSOR_VERTRAGING = 0.006;
/** De kruisfade van compressor naar worklet, als de audio al loopt. */
export const LIMITER_FADE = 0.04;
/** Zoveel samples gain leest de hoofdthread per keer (21 ms: meer dan één beeld). */
const GR_N = 1024;
/** Onder deze gain reduction (dB) toont het scherm niets meer. */
export const GR_VLOER = -40;

const ePunten = (van, naar) => Array.from({ length: 33 }, (_, i) => {
  if (i === 0) return van;
  if (i === 32) return naar;
  const t = i / 32;
  return van * Math.cos(t * Math.PI / 2) + naar * Math.sin(t * Math.PI / 2);
});

export class Master {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} uit  waar de zaal heen gaat (de uitgang, of kanaal 1/2 van de koptelefoon)
   * @param {{ limiter?: boolean, plafondDb?: number, vooruit?: number, release?: number }} [opties]
   *   limiter: false = de worklet niet laden (alleen de compressor)
   */
  constructor(ctx, uit = ctx.destination, { limiter = true, plafondDb = PLAFOND_DB, vooruit = VOORUIT, release = RELEASE } = {}) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.input = this.gain;

    // Het insert-rack. Mix 0: niet hoorbaar tot je hem opendraait, net als bij een track.
    this.fx = new InsertSlot(ctx);
    this.fx.zetEffect('filter');

    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -1.5;
    c.knee.value = 0;
    c.ratio.value = 20;
    c.attack.value = 0.002;
    c.release.value = 0.1;
    this.compressor = c;
    this._compUit = ctx.createGain();
    this.limiter = ctx.createGain();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;             // zie createDeckChain; de vormlagen lezen deze uit
    analyser.smoothingTimeConstant = 0;
    this.analyser = analyser;

    this.gain.connect(this.fx.in);
    this.fx.out.connect(c);
    c.connect(this._compUit);
    this._compUit.connect(this.limiter);
    this.limiter.connect(analyser);
    analyser.connect(uit);

    this.soort = 'compressor';
    this.limiterNode = null;
    this.fout = null;
    this.opties = { plafondDb, vooruit, release, margeDb: MARGE_DB };
    this._wl = null;
    this._gr = null;
    this._grBuf = null;
    zetGraafVertraging(ctx, COMPRESSOR_VERTRAGING);
    /** Wordt waar als de worklet erin zit, onwaar als het de compressor blijft. */
    this.klaar = limiter ? this._laad() : Promise.resolve(false);
  }

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
      const node = new AudioWorkletNode(ctx, 'varve-limiter', {
        numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 1],
        processorOptions: { ...this.opties },
      });
      node.onprocessorerror = (e) => this._limiterFout(node, e);
      this._neemOver(node);
      return true;
    } catch (err) {
      this.fout = err?.message || String(err);
      console.warn('[master] de limiter-worklet laadt niet, de compressor blijft:', this.fout);
      return false;
    }
  }

  /** De worklet erin: direct als er niets loopt, anders met een kruisfade. */
  _neemOver(node) {
    const ctx = this.ctx;
    const loopt = ctx.state === 'running';
    const wl = ctx.createGain();
    wl.gain.value = loopt ? 0 : 1;
    const gr = ctx.createAnalyser();
    gr.fftSize = GR_N;
    gr.smoothingTimeConstant = 0;
    // Geen ketting (a.connect(b).connect(c)) op de worklet: niet elke
    // AudioWorkletNode geeft zijn doel terug (de nep-worklets van de tests).
    this.fx.out.connect(node);
    node.connect(wl, 0);
    wl.connect(this.limiter);
    node.connect(gr, 1);                // de gain per sample: een tap, loopt nergens heen
    this.limiterNode = node;
    this._wl = wl;
    this._gr = gr;
    this._grBuf = new Float32Array(GR_N);
    this.soort = 'worklet';
    zetGraafVertraging(ctx, this.vertraging);
    if (!loopt) { this._compressorWeg(); return; }

    const nu = ctx.currentTime, wacht = startDrempel(ctx);
    zetHellingen(this._compUit.gain, (van) => ePunten(van, 0), nu, LIMITER_FADE, wacht);
    zetHellingen(wl.gain, (van) => ePunten(van, 1), nu, LIMITER_FADE, wacht);
    const klaarOp = nu + wacht + LIMITER_FADE;
    const ruimOp = () => {
      if (ctx.state === 'closed') return;
      if (ctx.currentTime < klaarOp + 0.01) { const t = setTimeout(ruimOp, 50); t?.unref?.(); return; }
      this._compressorWeg();
    };
    const t = setTimeout(ruimOp, (klaarOp - nu) * 1000 + 20);
    t?.unref?.();
  }

  /**
   * De limiter-worklet gooide een fout: vanaf nu geeft hij stilte, en dan is
   * de hele master stil. Terug naar de compressor van vroeger (het pad dat er
   * was voor de worklet laadde) en melden. Er is niets om uit te vloeien (de
   * worklet zwijgt al): het compressorpad komt erin met de kruisfade van
   * LIMITER_FADE vanaf nul.
   */
  _limiterFout(node, e) {
    if (node !== this.limiterNode) return;
    const ctx = this.ctx;
    try { this.fx.out.disconnect(node); } catch (_) {}
    try { node.disconnect(); } catch (_) {}
    node.onprocessorerror = null;
    try { node.port.close(); } catch (_) {}
    try { this._wl?.disconnect(); } catch (_) {}
    this.limiterNode = null;
    this._wl = null; this._gr = null; this._grBuf = null;
    const loopt = ctx.state === 'running', nu = ctx.currentTime;
    if (this._compUit) {
      // Nog midden in de kruisfade naar de worklet: de compressor blijft, en gaat terug naar vol.
      this._compUit.gain.cancelScheduledValues(0);
      if (loopt) zetHellingen(this._compUit.gain, (van) => ePunten(van, 1), nu, LIMITER_FADE, startDrempel(ctx));
      else this._compUit.gain.value = 1;
    } else {
      const g = ctx.createGain();
      g.gain.value = loopt ? 0 : 1;
      this.fx.out.connect(this.compressor);
      this.compressor.connect(g);
      g.connect(this.limiter);
      this._compUit = g;
      if (loopt) zetHellingen(g.gain, (van) => ePunten(van, 1), nu, LIMITER_FADE, startDrempel(ctx));
    }
    const reden = e?.message || e?.error?.message || '';
    this.soort = 'compressor';
    this.fout = `de limiter-worklet liep vast${reden ? ` (${reden})` : ''}`;
    zetGraafVertraging(ctx, this.vertraging);
    meldWorkletFout(ctx, 'de master-limiter', { reden, hint: 'de compressor van vroeger doet het werk weer' });
  }

  /** Het compressorpad los (alleen als er niets meer doorheen klinkt). */
  _compressorWeg() {
    if (!this._compUit) return;
    try { this.fx.out.disconnect(this.compressor); } catch (_) {}
    try { this.compressor.disconnect(); } catch (_) {}
    try { this._compUit.disconnect(); } catch (_) {}
    this._compUit = null;
  }

  /**
   * Gain reduction NU, in dB (≤ 0): de laagste gain van de laatste 21 ms.
   * Van de worklet (zijn tweede uitgang), anders wat de compressor zegt.
   */
  gr() {
    if (this._gr) {
      const b = this._grBuf;
      this._gr.getFloatTimeDomainData?.(b);
      let m = 1;
      for (let i = 0; i < b.length; i++) if (b[i] < m) m = b[i];
      // 0 = nog niets gerenderd (de analyser begint met nullen); de gain zelf is nooit 0.
      if (!(m > 0) || m >= 1) return 0;
      return Math.max(GR_VLOER, 20 * Math.log10(m));
    }
    const r = this.compressor?.reduction;
    return Number.isFinite(r) ? Math.max(GR_VLOER, Math.min(0, r)) : 0;
  }

  /** De limiter voor de snapshot en het scherm. */
  limiterStand() {
    return { soort: this.soort, gr: this.gr(), vertraging: this.vertraging, plafond: this.opties.plafondDb, fout: this.fout };
  }

  /** Het insert-rack voor de snapshot, net als `fx` van een track (plus herkomst). */
  fxStand() {
    const fx = this.fx;
    return {
      effect: fx.effectId, naam: fx.rackNaam ?? null, mix: fx.mix, bypass: fx.bypass, herkomst: fx.herkomst ?? null,
      plekken: [1, 2, 3, 4, 5, 6, 7, 8]
        .map((k) => ({ plek: k, naam: fx.plekNaam(k), waarde: fx.leesPlek(k), bipolair: fx.plekBipolair(k) }))
        .filter((p) => p.naam !== null),
      ketens: fx.nodeAantal,
    };
  }
}

/** Zoals vroeger in audio-graph.js: de master maken. */
export const createMasterChain = (ctx, uit = ctx.destination, opties = {}) => new Master(ctx, uit, opties);
