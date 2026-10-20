/**
 * Opnemen: de master ná de limiter, wat de zaal hoort (v1). De worklet schrijft in een ring
 * (opnemer-worklet.js); hier lezen we hem elke LEES_MS leeg en geven stukken door als
 * `stuk` { frame, data: Int16Array } — frame = de plek in de opname, zodat de server elk stuk op
 * zijn plek zet. Een frame die niet in de ring paste (de hoofdthread hing langer dan RING_S) is
 * een gat op zijn plek, geen verschuiving van alles erna. Geen DOM.
 */
import { Emitter } from '../kern/emitter.js';

export const RING_S = 20;          // seconden in de ring: zo lang mag de hoofdthread haperen
export const LEES_MS = 250;
const RING_FRAMES = (sr) => Math.round(RING_S * sr);

const geladen = new WeakMap();
function laadWorklet(ctx) {
  let p = geladen.get(ctx);
  if (!p) { p = ctx.audioWorklet.addModule(new URL('./opnemer-worklet.js', import.meta.url).href); geladen.set(ctx, p); p.catch(() => geladen.delete(ctx)); }
  return p;
}

export class Opnemer extends Emitter {
  /** @param bron de AudioNode die de master uitstuurt (mixer.analyser) */
  constructor(ctx, bron) {
    super();
    this.ctx = ctx;
    this.bron = bron;
    this.node = null;
    this.frames = 0;           // zoveel frames zijn doorgegeven (de lengte van de opname)
    this.weggevallen = 0;
  }

  get loopt() { return this.node !== null; }

  /** De audiokloktijd van frame 0 (null tot de eerste frame binnen is). */
  get startTijd() { return this._start && this._start[0] > 0 ? this._start[0] / this.ctx.sampleRate : null; }

  async start() {
    if (this.loopt) return;
    if (typeof SharedArrayBuffer !== 'function' || !globalThis.crossOriginIsolated) throw new Error('opnemen vraagt een geïsoleerde pagina (COOP/COEP)');
    await laadWorklet(this.ctx);
    const n = RING_FRAMES(this.ctx.sampleRate);
    const ring = new SharedArrayBuffer(n * 4), stand = new SharedArrayBuffer(16), start = new SharedArrayBuffer(8);
    this._ring = new Int16Array(ring); this._stand = new Int32Array(stand); this._start = new Float64Array(start);
    this._n = n;
    this.frames = 0; this.weggevallen = 0;
    const node = new AudioWorkletNode(this.ctx, 'varve-opnemer', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit',
      processorOptions: { ring, stand, start },
    });
    node.onprocessorerror = () => this.emit('fout', 'de opnemer stopte (processorerror)');
    // Een worklet die nergens heen gaat draait niet: via een gain van 0 naar de uitgang.
    this._stil = new GainNode(this.ctx, { gain: 0 });
    this.bron.connect(node);
    node.connect(this._stil).connect(this.ctx.destination);
    this.node = node;
    this._timer = setInterval(() => this._lees(), LEES_MS);
  }

  /** Lees de ring leeg tot wat de worklet geschreven heeft. */
  _lees() {
    const st = this._stand;
    if (!st) return;
    const w = Atomics.load(st, 0);
    let r = Atomics.load(st, 1);
    if (w <= r) return;
    // Meer dan een ring achter: wat overschreven is, is weg. Overslaan (met een blok marge: de
    // worklet schrijft intussen door); op de server blijft dat stuk stilte, op zijn plek.
    if (w - r > this._n - 1024) {
      const nieuw = w - this._n + 1024;
      this.weggevallen += nieuw - r;
      this.emit('fout', `de opname liep ${((nieuw - r) / this.ctx.sampleRate).toFixed(2)} s achter: dat stuk is stilte`);
      r = nieuw;
    }
    const aantal = w - r;
    const data = new Int16Array(aantal * 2);
    for (let i = 0; i < aantal; i++) {
      const j = ((r + i) % this._n) * 2;
      data[2 * i] = this._ring[j]; data[2 * i + 1] = this._ring[j + 1];
    }
    Atomics.store(st, 1, r + aantal);
    this.frames = r + aantal;
    this.emit('stuk', { frame: r, data });
  }

  /** Stop: de rest doorgeven, 'stop' naar de worklet, dan los. Geeft het totaal aantal frames. */
  async stop() {
    if (!this.loopt) return this.frames;
    clearInterval(this._timer);
    this.node.port.postMessage({ type: 'stop' });
    await new Promise((r) => setTimeout(r, 30));
    this._lees();
    try { this.bron.disconnect(this.node); } catch { /* al los */ }
    this.node.disconnect(); this._stil.disconnect();
    this.node.port.close?.();
    this.node = null;
    this.emit('klaar', { frames: this.frames });
    return this.frames;
  }
}
