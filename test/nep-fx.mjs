// Een Web Audio-mock die ALLES vastlegt (elke node, verbinding, automatisering),
// voor de effecttests van spoor S10 (test/effecten-s10.test.mjs, test/modulatie.test.mjs).
// Overgenomen uit test/effecten.test.mjs, met een AnalyserNode en de worklets van S10
// erbij. Geen test zelf.

export const staat = { NOW: 0, NIET_EINDIG: [], CURVES: 0, NODES: [], WORKLET_NODES: [] };

export const param = (eigenaar, naam, v = 0) => ({
  value: v, naam, eigenaar, events: [],
  _log(f, a) {
    this.events.push([f, ...a]);
    if (a.some((x) => typeof x === 'number' && !Number.isFinite(x))) staat.NIET_EINDIG.push([`${eigenaar.soort}.${naam}`, f, a]);
  },
  setTargetAtTime(x, t, tau) { this._log('setTargetAtTime', [x, t, tau]); this.value = x; },
  setValueAtTime(x, t) { this._log('setValueAtTime', [x, t]); this.value = x; },
  linearRampToValueAtTime(x, t) { this._log('linearRampToValueAtTime', [x, t]); this.value = x; },
  exponentialRampToValueAtTime(x, t) { this._log('exponentialRampToValueAtTime', [x, t]); this.value = x; },
  setValueCurveAtTime(c, t, d) { staat.CURVES++; this._log('setValueCurveAtTime', [t, d]); },
  cancelScheduledValues(t) { this._log('cancelScheduledValues', [t]); },
  cancelAndHoldAtTime(t) { this._log('cancelAndHoldAtTime', [t]); },
});

export const node = (ctx, soort, params = [], extra = {}) => {
  const n = { soort, ctx, naar: [], ...extra };
  for (const [p, v] of params) n[p] = param(n, p, v);
  n.connect = (doel, uit = 0, inp = 0) => { n.naar.push({ doel, uit, inp }); return doel; };
  n.disconnect = (doel) => { n.naar = doel ? n.naar.filter((v) => v.doel !== doel) : []; };
  staat.NODES.push(n);
  return n;
};

// Een EventTarget, zoals de echte (worklet-fouten komen als event op de context, worklet-fout.js).
export class MockContext extends EventTarget {
  constructor({ worklet = null } = {}) {
    super();
    this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005;
    this.destination = node(this, 'dest');
    this.bronnen = [];
    this.niveau = 0;            // wat de AnalyserNode ziet (rms van een sinus met deze piek × 1/√2)
    if (worklet) this.audioWorklet = worklet;
  }
  get currentTime() { return staat.NOW; }
  createGain() { return node(this, 'gain', [['gain', 1]], { channelCount: 2, channelCountMode: 'max' }); }
  createDelay(max = 1) { return node(this, 'delay', [['delayTime', 0]], { max }); }
  createBiquadFilter() { return node(this, 'biquad', [['frequency', 350], ['Q', 1], ['gain', 0], ['detune', 0]], { type: 'lowpass' }); }
  createWaveShaper() {
    const n = node(this, 'shaper', [], { oversample: 'none', curves: [] });
    let c = null;
    Object.defineProperty(n, 'curve', { get: () => c, set: (x) => { c = x; n.curves.push(x); } });
    return n;
  }
  createDynamicsCompressor() { return node(this, 'comp', [['threshold', -24], ['knee', 30], ['ratio', 12], ['attack', 0.003], ['release', 0.25]]); }
  createStereoPanner() { return node(this, 'pan', [['pan', 0]]); }
  createChannelSplitter(n = 6) { return node(this, 'splitter', [], { uitgangen: n }); }
  createChannelMerger(n = 6) { return node(this, 'merger', [], { ingangen: n }); }
  createAnalyser() {
    const ctx = this;
    const a = node(this, 'analyser', [], { fftSize: 2048, lezingen: 0 });
    a.getFloatTimeDomainData = (buf) => {
      a.lezingen++;
      for (let i = 0; i < buf.length; i++) buf[i] = ctx.niveau * Math.sin(2 * Math.PI * i / 32);
    };
    return a;
  }
  createOscillator() {
    const o = node(this, 'osc', [['frequency', 440], ['detune', 0]], { type: 'sine', gestart: null, gestopt: null });
    o.start = (t = 0) => { o.gestart = t; this.bronnen.push(o); };
    o.stop = (t = 'nu') => { o.gestopt = t; };
    return o;
  }
  createBufferSource() {
    const s = node(this, 'src', [['playbackRate', 1], ['detune', 0]], { buffer: null, loop: false, gestart: null, offset: null, gestopt: null, onended: null });
    s.start = (t = 0, offset = 0) => { s.gestart = t; s.offset = offset; this.bronnen.push(s); };
    s.stop = (t = 'nu') => { s.gestopt = t; queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) {
    const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] };
  }
}

export const rust = () => new Promise((r) => setTimeout(r, 0));

/** Een audioWorklet waarvan de test bepaalt wanneer (en of) hij klaar is. */
export function nepWorklet() {
  const w = { geladen: 0, urls: [], los: [] };
  w.addModule = (url) => {
    w.geladen++; w.urls.push(String(url));
    return new Promise((ok, fout) => w.los.push({ ok, fout }));
  };
  w.klaar = async () => { await rust(); for (const l of w.los.splice(0)) l.ok(); await rust(); };
  w.mislukt = async () => { await rust(); for (const l of w.los.splice(0)) l.fout(new Error('nep')); await rust(); };
  return w;
}

export const PARAMS_VAN = {
  'varve-fx-omhullende': [['aanzet', 0.01], ['verval', 0.15]],
  'varve-fx-toonhoogte': [['halvetonen', 0]],
  'varve-fx-kam': [['toon', 220], ['fb', 0.5], ['demping', 8000]],
  'varve-fx-freqschuif': [['hz', 0]],
  'varve-fx-aanslag': [['aanval', 0], ['sustain', 0]],
};
globalThis.AudioWorkletNode = class {
  constructor(ctx, naam, opties = {}) {
    if (!PARAMS_VAN[naam]) throw new Error(`InvalidStateError: ${naam} niet geregistreerd`);
    const n = node(ctx, 'worklet', [], { naam, opties, berichten: [] });
    n.parameters = new Map(PARAMS_VAN[naam].map(([p, v]) => [p, param(n, p, v)]));
    n.port = { postMessage: (m) => n.berichten.push(m), onmessage: null, close() {} };
    staat.WORKLET_NODES.push(n);
    return n;
  }
};

/** Alle nodes die vanaf `start` bereikbaar zijn (een verbinding naar een param telt als naar zijn eigenaar). */
export function bereikbaar(start) {
  const gezien = new Set(), stapel = [start];
  while (stapel.length) {
    const n = stapel.pop();
    if (!n || gezien.has(n)) continue;
    gezien.add(n);
    for (const { doel } of n.naar || []) stapel.push(doel.eigenaar || doel);
  }
  return gezien;
}

/** Sterk samenhangende componenten (Tarjan): de lussen. */
export function lussen(start) {
  const nodes = [...bereikbaar(start)];
  const index = new Map(), laag = new Map(), op = new Set(), stapel = [], uit = [];
  let i = 0;
  const buren = (n) => (n.naar || []).map(({ doel }) => doel.eigenaar || doel);
  const sc = (v) => {
    index.set(v, i); laag.set(v, i); i++; stapel.push(v); op.add(v);
    for (const w of buren(v)) {
      if (!index.has(w)) { sc(w); laag.set(v, Math.min(laag.get(v), laag.get(w))); }
      else if (op.has(w)) laag.set(v, Math.min(laag.get(v), index.get(w)));
    }
    if (laag.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stapel.pop(); op.delete(w); comp.push(w); } while (w !== v);
      const zelf = comp.length === 1 && buren(comp[0]).includes(comp[0]);
      if (comp.length > 1 || zelf) uit.push(comp);
    }
  };
  for (const n of nodes) if (!index.has(n)) sc(n);
  return uit;
}

/** Alle params van alle nodes van een context eindig? */
export function allesEindig(ctx) {
  for (const n of staat.NODES) {
    if (n.ctx !== ctx) continue;
    for (const v of Object.values(n)) if (v && typeof v === 'object' && 'events' in v && !Number.isFinite(v.value)) return false;
    if (n.parameters) for (const p of n.parameters.values()) if (!Number.isFinite(p.value)) return false;
  }
  return staat.NIET_EINDIG.length === 0;
}
