/**
 * De node-kant van de afspeler: één AudioWorkletNode per track, en de berichten
 * ernaartoe. Weet niets van grid, klok of muziek, alleen segmenten
 * { T, P, R, speelt } (zie speler-kern.js). Geen DOM.
 *
 * positie(t) rekent met DEZELFDE formule als de worklet (P + (t − T)·R) uit de
 * laatst geplande segmenten: hoofdthread en worklet delen geen teller.
 */
import { PAGINA, MAX_SEGMENTEN } from './speler-kern.js';
import { Stroom, paginasNodig } from './stroom.js';

export { PAGINA };

/** Per AudioContext hooguit één addModule: de Promise wordt gedeeld. */
const geladen = new WeakMap();

function laadWorklet(ctx) {
  let p = geladen.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(new URL('./speler-worklet.js', import.meta.url).href);
    geladen.set(ctx, p);
    p.catch(() => { if (geladen.get(ctx) === p) geladen.delete(ctx); });   // mislukt: later opnieuw proberen
  }
  return p;
}

const naar16 = (x) => {
  const c = x > 1 ? 1 : x < -1 ? -1 : (x === x ? x : 0);      // NaN wordt 0
  return Math.round(c < 0 ? c * 32768 : c * 32767);
};

/**
 * Float32-kanalen naar Int16-pagina's (interleaved stereo, PAGINA frames per
 * pagina; de laatste is korter). Mono gaat op beide kanalen; meer dan twee:
 * de eerste twee. Geen dither: het formaat van de v1-ingest.
 * @param bron AudioBuffer, of { sr, kanalen: [Float32Array, …] }
 * @returns { sr, kanalen: 2, frames, paginas }
 */
export function paginasUit(bron) {
  let sr, L, R;
  if (bron && typeof bron.getChannelData === 'function') {
    sr = bron.sampleRate;
    L = bron.getChannelData(0);
    R = bron.numberOfChannels > 1 ? bron.getChannelData(1) : L;
  } else if (bron && Array.isArray(bron.kanalen) && bron.kanalen.length > 0) {
    sr = bron.sr;
    L = bron.kanalen[0];
    R = bron.kanalen.length > 1 ? bron.kanalen[1] : L;
  } else throw new TypeError('paginasUit: verwacht een AudioBuffer of { sr, kanalen: [Float32Array, …] }');
  if (!(sr > 0)) throw new TypeError(`paginasUit: samplerate ${sr} klopt niet`);
  const frames = Math.min(L.length, R.length);
  const paginas = [];
  for (let van = 0; van < frames; van += PAGINA) {
    const n = Math.min(PAGINA, frames - van);
    const p = new Int16Array(n * 2);                           // elk een eigen buffer: los over te dragen
    for (let i = 0; i < n; i++) { p[2 * i] = naar16(L[van + i]); p[2 * i + 1] = naar16(R[van + i]); }
    paginas.push(p);
  }
  return { sr, kanalen: 2, frames, paginas };
}

/** Toetst en kopieert segmenten naar gewone objecten (structured clone). */
function schoon(segmenten) {
  if (!Array.isArray(segmenten)) throw new TypeError('plan: verwacht een array van segmenten');
  if (segmenten.length > MAX_SEGMENTEN) throw new RangeError(`plan: hooguit ${MAX_SEGMENTEN} segmenten tegelijk (${segmenten.length})`);
  const uit = [];
  let vorige = -Infinity;
  for (let i = 0; i < segmenten.length; i++) {
    const s = segmenten[i];
    const speelt = !!s?.speelt;
    const T = Number(s?.T), P = Number(s?.P), R = speelt ? Number(s?.R) : (Number.isFinite(Number(s?.R)) ? Number(s.R) : 1);
    if (!Number.isFinite(T) || !Number.isFinite(P)) throw new TypeError(`plan: segment ${i} heeft geen eindige T en P`);
    if (speelt && !(R > 0 && Number.isFinite(R))) throw new RangeError(`plan: segment ${i} speelt met R = ${s?.R}; R moet positief zijn`);
    if (T < vorige) throw new RangeError(`plan: segment ${i} ligt vóór het vorige (T ${T} < ${vorige})`);
    vorige = T;
    const seg = { T, P, R, speelt };
    if (s.lb !== undefined && s.lb !== null) {
      const la = Number(s.la), lb = Number(s.lb);
      if (!(la >= 0) || !(lb > la) || !Number.isFinite(lb)) throw new RangeError(`plan: segment ${i} heeft een lus [${s.la}, ${s.lb}) die niet klopt`);
      seg.la = la; seg.lb = lb;
    }
    uit.push(seg);
  }
  return uit;
}

export class Speler {
  /** Een speler op deze context. De worklet laadt hooguit één keer per context. */
  static async maak(ctx) {
    await laadWorklet(ctx);
    return new Speler(ctx);
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'varve-speler', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    });
    this.onfout = null;                      // (bericht: string, kapot: boolean) => void; kapot = hij speelt stil
    this._lijn = [];                         // de geplande segmenten, voor positie()
    this._weg = false;
    this._laadNr = 0;                        // elke laad een eigen nummer (een late pagina hoort bij één laad)
    this._stroom = null;                     // streamt dit nummer? (stroom.js)
    this._pins = [];
    this.node.port.onmessage = (e) => {
      const m = e.data;
      if (m && m.type === 'fout') this._meld(`afspeler: ${m.bericht}`, m.kapot !== false);
    };
    this.node.onprocessorerror = (e) => this._meld(`afspeler gestopt (processorerror)${e?.message ? `: ${e.message}` : ''}`);
  }

  _meld(bericht, kapot = true) {
    if (typeof this.onfout === 'function') this.onfout(bericht, kapot);
    else console.error(bericht);             // een fout blijft nooit stil
  }

  _levend() { if (this._weg) throw new Error('speler is vernietigd'); }

  /**
   * Een nummer laden. De pagina's worden OVERGEDRAGEN: daarna zijn ze hier
   * leeg (detached). Wat speelde vloeit uit; daarna plan().
   */
  laad({ sr, kanalen = 2, frames, paginas, stroom = null }) {
    this._levend();
    if (stroom) return this._laadStroom({ sr, kanalen, frames, stroom });
    if (kanalen !== 2) throw new RangeError(`laad: alleen stereo (kanalen 2), niet ${kanalen}`);
    if (!(sr > 0) || !Number.isFinite(sr)) throw new RangeError(`laad: samplerate ${sr} klopt niet`);
    if (!Number.isInteger(frames) || frames < 0 || frames > 2 ** 30) throw new RangeError(`laad: frames ${frames} klopt niet`);
    if (!Array.isArray(paginas)) throw new TypeError('laad: paginas moet een array zijn');
    const nodig = Math.ceil(frames / PAGINA);
    if (paginas.length > nodig) throw new RangeError(`laad: ${paginas.length} pagina's voor ${frames} frames (hooguit ${nodig})`);
    const lijst = new Array(nodig);
    const buffers = new Set();
    for (let i = 0; i < nodig; i++) {
      const p = paginas[i];
      if (p === undefined || p === null) { lijst[i] = undefined; continue; }
      if (!(p instanceof Int16Array)) throw new TypeError(`laad: pagina ${i} is geen Int16Array`);
      if (p.length > PAGINA * 2 || p.length % 2 !== 0) throw new RangeError(`laad: pagina ${i} heeft ${p.length} samples (hooguit ${PAGINA * 2}, even)`);
      lijst[i] = p;
      buffers.add(p.buffer);                 // gedeelde buffer: één keer in de transferlijst
    }
    this._lijn = [];
    this._sluitStroom();
    this.node.port.postMessage({ type: 'laad', id: ++this._laadNr, sr, frames, paginas: lijst }, [...buffers]);
  }

  /**
   * Een nummer dat STREAMT (budget M7): de worklet krijgt een lege bron, en `stroom.lees(i, signaal)`
   * haalt pagina i op zodra het plan hem nodig heeft (stroom.js). Wat er niet is, is stilte.
   */
  _laadStroom({ sr, kanalen, frames, stroom }) {
    if (kanalen !== 2) throw new RangeError(`laad: alleen stereo (kanalen 2), niet ${kanalen}`);
    if (!(sr > 0) || !Number.isFinite(sr)) throw new RangeError(`laad: samplerate ${sr} klopt niet`);
    if (!Number.isInteger(frames) || frames < 0 || frames > 2 ** 30) throw new RangeError(`laad: frames ${frames} klopt niet`);
    if (typeof stroom.lees !== 'function') throw new TypeError('laad: stroom.lees moet een functie zijn');
    this._lijn = [];
    this._sluitStroom();
    const id = ++this._laadNr;
    this.node.port.postMessage({ type: 'laad', id, sr, frames, paginas: [] });
    this._stroom = new Stroom({
      id, sr, frames, lees: stroom.lees,
      stuur: (m, transfer) => { if (!this._weg) this.node.port.postMessage(m, transfer ?? []); },
      onfout: (bericht) => this._meld(`streamen: ${bericht}`, false),
    });
  }

  _sluitStroom() { if (this._stroom) { this._stroom.sluit(); this._stroom = null; } }

  /**
   * Streamen bijhouden: welke pagina's het plan vanaf nu nodig heeft, plus `pins` (plekken in het
   * nummer die direct moeten klinken: het cuepunt). Roep dit geregeld aan (de engine doet het
   * bij elke tik en na elk plan); zonder stroom doet het niets.
   */
  bijvullen(pins = this._pins) {
    this._pins = pins;
    const st = this._stroom;
    if (!st || this._weg) return;
    st.bij(paginasNodig(this._lijn, this.ctx.currentTime, { sr: st.sr, frames: st.frames, pins }));
  }

  /** Wat er van dit nummer in de audiothread staat (bytes); null als het niet streamt. */
  get gestreamd() { return this._stroom ? this._stroom.bytes : null; }

  /** Segmenten plannen: vervangt alles vanaf segmenten[0].T. */
  plan(segmenten) {
    this._levend();
    const s = schoon(segmenten);
    if (s.length === 0) return;
    const T0 = s[0].T;
    // Bewaren wat positie() nodig heeft: het segment dat op T0 geldt, en het nieuwe.
    let n = this._lijn.length;
    while (n > 0 && this._lijn[n - 1].T >= T0) n--;
    const rest = n > 0 ? [this._lijn[n - 1]] : [];
    this._lijn = rest.concat(s);
    this.node.port.postMessage({ type: 'plan', segmenten: s });
    this.bijvullen();
  }

  /**
   * De plek in het nummer (seconden) op audiokloktijd t, met dezelfde formule
   * als de worklet (het laatste segment met T ≤ t geldt). Vóór het eerste
   * segment: zijn P (daar staat hij straks). null zonder plan.
   */
  positie(t = this.ctx.currentTime) {
    const lijn = this._lijn;
    if (lijn.length === 0) return null;
    for (let i = lijn.length - 1; i >= 0; i--) {
      const s = lijn[i];
      if (s.T <= t) {
        if (!s.speelt) return s.P;
        const p = s.P + (t - s.T) * s.R;
        return s.lb !== undefined && p >= s.lb ? s.la + ((p - s.la) % (s.lb - s.la)) : p;
      }
    }
    return lijn[0].P;
  }

  /** Stil, bron weg. */
  leeg() {
    this._levend();
    this._lijn = [];
    this._sluitStroom();
    this.node.port.postMessage({ type: 'leeg' });
  }

  /** 'stop' naar de worklet (process() geeft daarna false), dan los. Mag vaker. */
  vernietig() {
    if (this._weg) return;
    this._weg = true;
    this._lijn = [];
    this._sluitStroom();
    try { this.node.port.postMessage({ type: 'stop' }); } catch { /* al dicht */ }
    try { this.node.disconnect(); } catch { /* niet verbonden */ }
    this.node.port.onmessage = null;
    this.node.onprocessorerror = null;
    this.node.port.close?.();
  }
}
