// De master (docs/MASTER.md, ROADMAP 27 S2a): de limiter als rekenwerk (de
// kern, zonder browser), de worklet in een nagebouwde AudioWorkletGlobalScope
// (afval, zoals renderblok.test), de masterketen en het insert-rack op een
// nep-Web Audio (bedrading, de wissel van compressor naar worklet, actions,
// reads), wat je hoort (hoorbaar.js), het scherm (puur) en de APC.
// Draai met: node test/master.test.mjs
// @alleen: afvalmeting (GCProfiler, 0 GC in de limiter) (test/alles.mjs draait hem na de pool, zonder iets ernaast)
import v8 from 'node:v8';
/** De jonge ruimtes van V8: daar landt afval per blok (zie de afvalmetingen hieronder). */
const JONG = ['new_space', 'new_large_object_space'];
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const db = (x) => 20 * Math.log10(x);
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
/** Het kleinste getal in een (grote) array: Math.min(...x) loopt over de stack. */
const minVan = (x) => { let m = Infinity; for (const v of x) if (v < m) m = v; return m; };

const K = await import('../src/engine/limiter-kern.js');
const { LimiterKern, PLAFOND_DB, MARGE_DB, vertragingFrames, FIR_HALF } = K;
const SR = 48000, Q = 128;
const PLAFOND = Math.pow(10, PLAFOND_DB / 20);

/**
 * True peak zoals een goede meter hem meet: 16× oversampling met een lange
 * windowed sinc (48 tikken per kant). Alleen rond de luide stukken (een
 * tussenwaarde is hooguit een paar keer de buren, dus onder een kwart van
 * het plafond hoeft niet).
 */
function truePeak(x, os = 16, half = 48) {
  let max = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > max) max = Math.abs(x[i]);
  const tik = [];
  for (let p = 1; p < os; p++) {
    const mu = p / os, rij = new Float64Array(2 * half);
    let som = 0;
    for (let k = -half + 1; k <= half; k++) {
      const d = mu - k;
      const w = 0.42 + 0.5 * Math.cos(Math.PI * d / half) + 0.08 * Math.cos(2 * Math.PI * d / half);
      rij[k + half - 1] = Math.sin(Math.PI * d) / (Math.PI * d) * w;
      som += rij[k + half - 1];
    }
    for (let k = 0; k < rij.length; k++) rij[k] /= som;
    tik.push(rij);
  }
  for (let i = half; i < x.length - half; i++) {
    if (Math.abs(x[i]) < PLAFOND / 4 && Math.abs(x[i + 1]) < PLAFOND / 4) continue;
    for (const rij of tik) {
      let s = 0;
      for (let k = 0; k < rij.length; k++) s += x[i - half + 1 + k] * rij[k];
      if (Math.abs(s) > max) max = Math.abs(s);
    }
  }
  return max;
}

/** Een signaal (i -> [l, r]) door een verse kern, blok voor blok. */
function draai(sig, sec, opties) {
  const kern = new LimiterKern(SR, opties);
  const n = Math.round((sec * SR) / Q) * Q;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  for (let i = 0; i < n; i++) { const [l, r] = sig(i); inL[i] = l; inR[i] = r; }
  const uL = new Float32Array(n), uR = new Float32Array(n), G = new Float32Array(n);
  for (let b = 0; b < n; b += Q) {
    kern.render(inL.subarray(b, b + Q), inR.subarray(b, b + Q), uL.subarray(b, b + Q), uR.subarray(b, b + Q), G.subarray(b, b + Q), Q);
  }
  return { kern, inL, inR, uL, uR, G, n };
}

// Muziek-achtig: een kick van 55 Hz op 120 bpm (met een pitch-val van 165
// naar 55 Hz) die tot +6 dB gaat, een akkoord, en hihat-ruis op de achtsten
// (energie tot de Nyquist).
const muziek = (hard = 1.5) => {
  let zaad = 20261005;
  const rnd = () => ((zaad = (Math.imul(zaad, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5);
  return (i) => {
    const t = i / SR, tel = (t * 2) % 1, sinds = tel / 2;   // seconden sinds de tel
    const kick = Math.exp(-tel * 30) * Math.sin(2 * Math.PI * 55 * (sinds + (2 / 20) * (1 - Math.exp(-20 * sinds))));
    const akkoord = 0.25 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t));
    const hat = rnd() * 0.3 * Math.exp(-((t * 4) % 1) * 50);
    const x = hard * kick + akkoord + hat;
    return [x, 0.9 * x];
  };
};

// ---- 1. de kern -------------------------------------------------------------------
console.log('de kern (zonder browser)');
{
  const N = vertragingFrames(SR);
  ok(`vooruitblik 1,5 ms = ${N} samples op 48 kHz (vertraging), waarvan ${FIR_HALF} voor de interpolator`, N === 72 && new LimiterKern(SR).L === 72 - FIR_HALF);

  // a. Een tik onder het plafond: precies N samples later, precies even groot.
  const tik = draai((i) => (i === 1000 ? [0.1, -0.2] : [0, 0]), 0.1);
  const waar = tik.uL.findIndex((v) => v !== 0);
  ok(`een tik komt precies ${N} samples later naar buiten, onveranderd (L 0,1, R −0,2)`,
    waar === 1000 + N && tik.uL[waar] === Math.fround(0.1) && tik.uR[waar] === Math.fround(-0.2)
    && tik.uL.filter((v) => v !== 0).length === 1 && tik.G.every((g) => g === 1));

  // b. Stationair onder het plafond: GEEN gain reduction, bit voor bit de invoer.
  const zacht = draai((i) => {
    const t = i / SR;
    const x = 0.45 * Math.sin(2 * Math.PI * 61 * t) + 0.3 * Math.sin(2 * Math.PI * 997 * t) + 0.08 * Math.sin(2 * Math.PI * 9100 * t);
    return [x, -x];
  }, 10);
  let piekIn = 0, verschil = 0, nietEen = 0;
  for (let i = 0; i < zacht.n; i++) {
    piekIn = Math.max(piekIn, Math.abs(zacht.inL[i]));
    if (i >= N && (zacht.uL[i] !== zacht.inL[i - N] || zacht.uR[i] !== zacht.inR[i - N])) verschil++;
    if (zacht.G[i] !== 1) nietEen++;
  }
  ok(`stationair onder het plafond (piek ${db(piekIn).toFixed(1)} dBFS, 10 s): gain precies 1 in elke sample, 0 dB gain reduction — geen pompen`,
    nietEen === 0 && zacht.kern.minGain === 1 && piekIn > 0.7);
  ok('… en de uitvoer is bit voor bit de invoer, N samples later', verschil === 0);

  // c. Pieken tot +6 dB: geen sample en geen tussenwaarde boven −1 dBFS.
  const luid = draai(muziek(), 3);
  let piekLuid = 0;
  for (let i = 0; i < luid.n; i++) piekLuid = Math.max(piekLuid, Math.abs(luid.inL[i]));
  let sp = 0;
  for (let i = 0; i < luid.n; i++) sp = Math.max(sp, Math.abs(luid.uL[i]), Math.abs(luid.uR[i]));
  const tp = Math.max(truePeak(luid.uL), truePeak(luid.uR));
  const grMax = db(minVan(luid.G));
  ok(`muziek met pieken tot +${db(piekLuid).toFixed(1)} dB: sample-piek ${db(sp).toFixed(2)} dBFS, true peak (16×) ${db(tp).toFixed(3)} dBTP ≤ −1`,
    piekLuid >= 2 && sp <= PLAFOND && tp <= PLAFOND);
  ok(`… hij werkt echt (gain reduction tot ${grMax.toFixed(1)} dB) en het vangnet klemde niets (${luid.kern.geklemd})`, grMax < -6 && luid.kern.geklemd === 0);

  // Zuivere tonen tot 15 kHz op +6 dB (daar mist een 4×-raster het meest).
  let slechtste = -Infinity;
  for (const hz of [1000, 5000, 12000, 15000]) {
    const r = draai((i) => { const x = 2 * Math.sin(2 * Math.PI * hz * i / SR + 0.3); return [x, x]; }, 0.6);
    slechtste = Math.max(slechtste, db(truePeak(r.uL.subarray(SR * 0.2))));
  }
  ok(`tonen van 1, 5, 12 en 15 kHz op +6 dB: true peak hooguit ${slechtste.toFixed(3)} dBTP (≤ −1; de marge is ${MARGE_DB} dB)`, slechtste <= PLAFOND_DB);

  // d. Eén piek: de gain zakt glad (in L samples) en staat er op tijd.
  const piekBij = 24000;
  const een = draai((i) => {
    const x = 0.3 * Math.sin(2 * Math.PI * 200 * i / SR) + (i >= piekBij && i < piekBij + 480 ? 1.7 * Math.sin(2 * Math.PI * 1000 * (i - piekBij) / SR) : 0);
    return [x, x];
  }, 2);
  let stap = 0;
  for (let i = 1; i < een.n; i++) stap = Math.max(stap, Math.abs(een.G[i] - een.G[i - 1]));
  const gMin = minVan(een.G);
  const eersteDaling = een.G.findIndex((g) => g < 1);
  ok(`aanval: de gain begint ${piekBij + N - eersteDaling} samples vóór de piek naar buiten komt te zakken (de vooruitblik), grootste stap per sample ${stap.toFixed(4)} (geen tik)`,
    eersteDaling > piekBij && eersteDaling <= piekBij + N && stap < (1 - gMin) / (een.kern.L - 4));
  // e. Release: 80 ms, glad terug, geen pompen. De envelop komt lineair terug
  // (1 − gain valt met e^(−t/80 ms)), dus in dB eerst snel en dan zacht.
  const naPiek = piekBij + 480 + N;
  const gNa = (ms) => een.G[naPiek + Math.round(ms * SR / 1000)];
  let stijgt = true;
  for (let i = naPiek + een.kern.W; i < een.n; i++) if (een.G[i] < een.G[i - 1]) stijgt = false;
  const verwacht80 = 1 - (1 - gMin) * Math.exp(-1);
  ok(`release: na de piek (${db(gMin).toFixed(1)} dB) alleen nog omhoog, niets dat terugzakt`, stijgt);
  ok(`… na 80 ms ${db(gNa(80)).toFixed(2)} dB (verwacht ${db(verwacht80).toFixed(2)}: één tijdconstante), na 400 ms ${db(gNa(400)).toFixed(3)} dB, na 1 s 0`,
    Math.abs(gNa(80) - verwacht80) < 0.02 && db(gNa(400)) > -0.05 && gNa(1000) > 0.99999);

  // f. Stereo gekoppeld: rechts krijgt dezelfde gain als links, ook als rechts zacht is.
  const st = draai((i) => [1.8 * Math.sin(2 * Math.PI * 100 * i / SR), 0.1 * Math.sin(2 * Math.PI * 330 * i / SR)], 0.5);
  let afwijking = 0;
  for (let i = N; i < st.n; i++) if (Math.abs(st.inR[i - N]) > 0.01) afwijking = Math.max(afwijking, Math.abs(st.uR[i] / st.inR[i - N] - st.G[i]));
  ok(`stereo gekoppeld: rechts (−20 dB) krijgt de gain van links (+5 dB), afwijking ${afwijking.toExponential(1)}`, afwijking < 1e-6 && minVan(st.G) < 0.5);

  // g. Kapotte getallen van verderop: nul, en de rest gaat door.
  const kapot = draai((i) => (i === 500 ? [NaN, Infinity] : i === 501 ? [-Infinity, 1e300] : [0.2, 0.2]), 0.1);
  ok('NaN en ±Infinity in de invoer worden stilte: alles eindig, de rest onveranderd',
    [...kapot.uL, ...kapot.uR].every(Number.isFinite) && kapot.uL[500 + N] === 0 && kapot.uR[501 + N] === 0 && kapot.uL[600 + N] === Math.fround(0.2));

  // Een ander plafond en een andere sampleRate (de context kan op 44,1 kHz staan).
  const k44 = new LimiterKern(44100, { plafondDb: -3 });
  ok('44,1 kHz: vooruitblik 66 samples (1,5 ms), plafond −3 dB', k44.N === 66 && Math.abs(db(k44.plafond) + 3) < 1e-9);

  // h. Rekentijd: een blok van 128 frames, luid (de interpolator rekent dan elke sample).
  const blokken = 3000;
  const bron = muziek(1.6);
  const pakket = Array.from({ length: 64 }, (_, b) => { const a = new Float32Array(Q); for (let i = 0; i < Q; i++) a[i] = bron(b * Q + i)[0]; return a; });
  const kt = new LimiterKern(SR), oL = new Float32Array(Q), oR = new Float32Array(Q), oG = new Float32Array(Q);
  for (let b = 0; b < 2000; b++) kt.render(pakket[b & 63], pakket[b & 63], oL, oR, oG, Q);
  let besteMs = Infinity;
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    for (let b = 0; b < blokken; b++) kt.render(pakket[b & 63], pakket[b & 63], oL, oR, oG, Q);
    besteMs = Math.min(besteMs, (performance.now() - t0) / blokken);
  }
  ok(`rekentijd per blok, luid: ${(besteMs * 1000).toFixed(1)} µs (< 500 µs van de 2,67 ms; beste van 3)`, besteMs < 0.5);

  // i. Afval: zoals renderblok.test, na opwarmen, het schoonste venster.
  // Gemeten in de JONGE ruimte (new_space, plus new_large_object_space voor een grote array),
  // min een leeg venster (wat het meten zelf kost): daar landt afval per blok. heapUsed telde ook
  // gecompileerde code (V8 die de meetlus opnieuw compileert: rood zonder één byte afval) en het
  // opruimen van de oude ruimte na gc() (tot -194 kB: een min die echt afval kon verbergen).
  // 7 okt, zie instrumenten-fm-schaal.test. JONG staat bovenaan (ook voor de worklet hieronder).
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  const venster = (n = 12000) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    for (let b = 0; b < n; b++) kt.render(pakket[b & 63], pakket[(b + 7) & 63], oL, oR, oG, Q);
    const j1 = jong();
    return { bytes: j1 - j0 - (n ? leeg : 0), gcs: prof.stop().statistics.length };
  };
  const leeg = venster(0).bytes;
  let beste = null;
  for (let i = 0; i < 30; i++) {
    const w = venster();
    if (!beste || w.gcs < beste.gcs || (w.gcs === beste.gcs && w.bytes < beste.bytes)) beste = w;
    if (w.gcs === 0 && w.bytes < 1024) break;
  }
  ok(`geen afval: 12 000 blokken, ${beste.gcs} GC, ${beste.bytes} bytes in de jonge ruimte`, beste.gcs === 0 && beste.bytes < 1024);
}

// ---- 2. de worklet, in een nagebouwde AudioWorkletGlobalScope ---------------------------
console.log('\nde worklet');
{
  let Klasse = null, naam = null;
  globalThis.sampleRate = SR;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
  globalThis.registerProcessor = (n, k) => { naam = n; Klasse = k; };
  await import('../src/engine/limiter-worklet.js');
  ok('registreert "varve-limiter"', naam === 'varve-limiter' && typeof Klasse === 'function');
  const p = new Klasse({ processorOptions: { plafondDb: -1, vooruit: 0.0015, release: 0.08, margeDb: MARGE_DB } });
  const kern = new LimiterKern(SR);
  const bron = muziek();
  const L = new Float32Array(Q), R = new Float32Array(Q);
  const uit = [[new Float32Array(Q), new Float32Array(Q)], [new Float32Array(Q)]];
  const kL = new Float32Array(Q), kR = new Float32Array(Q), kG = new Float32Array(Q);
  let gelijk = true, door = true;
  for (let b = 0; b < 400; b++) {
    for (let i = 0; i < Q; i++) { const [l, r] = bron(b * Q + i); L[i] = l; R[i] = r; }
    door = p.process([[L, R]], uit) === true && door;
    kern.render(L, R, kL, kR, kG, Q);
    for (let i = 0; i < Q; i++) if (uit[0][0][i] !== kL[i] || uit[0][1][i] !== kR[i] || uit[1][0][i] !== kG[i]) gelijk = false;
  }
  ok('uitgang 0 = het geluid, uitgang 1 = de gain: sample voor sample wat de kern geeft; process() blijft true', gelijk && door);

  const mono = new Klasse({ processorOptions: {} });
  const mUit = [[new Float32Array(Q), new Float32Array(Q)], [new Float32Array(Q)]];
  for (let b = 0; b < 4; b++) mono.process([[new Float32Array(Q).fill(0.25)]], mUit);
  ok('mono invoer: links en rechts hetzelfde', mUit[0][0][Q - 1] === Math.fround(0.25) && mUit[0][1][Q - 1] === Math.fround(0.25));
  const los = new Klasse({ processorOptions: {} });
  let gooide = false;
  try { for (let b = 0; b < 4; b++) los.process([[]], mUit); } catch (_) { gooide = true; }
  ok('zonder verbinding (lege invoer): stilte, en hij gooit niet', !gooide && mUit[0][0].every((v) => v === 0) && mUit[1][0].every((v) => v === 1));

  // Afval in process() zelf (de kern plus wat de worklet eromheen doet).
  const pakket = Array.from({ length: 32 }, (_, b) => { const a = new Float32Array(Q); for (let i = 0; i < Q; i++) a[i] = bron(b * Q + i)[0]; return a; });
  const invoer = pakket.map((a, b) => [[a, pakket[(b + 3) & 31]]]);
  for (let b = 0; b < 3000; b++) p.process(invoer[b & 31], uit);
  // Zoals hierboven: de jonge ruimte, min een leeg venster.
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  const venster = (n = 12000) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    for (let b = 0; b < n; b++) p.process(invoer[b & 31], uit);
    const j1 = jong();
    return { bytes: j1 - j0 - (n ? leeg : 0), gcs: prof.stop().statistics.length };
  };
  const leeg = venster(0).bytes;
  let beste = null;
  for (let i = 0; i < 30; i++) {
    const w = venster();
    if (!beste || w.gcs < beste.gcs || (w.gcs === beste.gcs && w.bytes < beste.bytes)) beste = w;
    if (w.gcs === 0 && w.bytes < 1024) break;
  }
  ok(`de worklet: 12 000 blokken, ${beste.gcs} GC, ${beste.bytes} bytes in de jonge ruimte`, beste.gcs === 0 && beste.bytes < 1024);
  delete globalThis.AudioWorkletProcessor;
  delete globalThis.registerProcessor;
}

// ---- 3. de masterketen op een nep-Web Audio -----------------------------------------
console.log('\nde masterketen');
let NOW = 0;
const { maakTijdlijn } = await import('./nep-tijdlijn.mjs');
const { param, stats: TL } = maakTijdlijn(() => NOW);
const LIJNEN = [];                                 // [van, naar, uitgang, ingang]
const verbind = (van) => Object.assign(van, {
  connect(n, uit = 0, inn = 0) { LIJNEN.push([this, n, uit, inn]); return n; },
  disconnect(n) { for (let i = LIJNEN.length - 1; i >= 0; i--) if (LIJNEN[i][0] === this && (n === undefined || LIJNEN[i][1] === n)) LIJNEN.splice(i, 1); },
});
const node = (type) => verbind({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), threshold: param(0), knee: param(0),
  ratio: param(1), attack: param(0), release: param(0), delayTime: param(0), fftSize: 1024, smoothingTimeConstant: 0,
  curve: null, oversample: 'none', reduction: 0, vul: 0,
  getByteTimeDomainData(b) { b.fill(128); }, getFloatTimeDomainData(b) { b.fill(this.vul); },
});
const heeft = (van, naar, uit) => LIJNEN.some((l) => l[0] === van && l[1] === naar && (uit === undefined || l[2] === uit));
const uitVan = (van) => LIJNEN.filter((l) => l[0] === van);
let STAAT = 'suspended', MODULES = [], LAAD = async () => {};
globalThis.AudioContext = class {
  constructor() { this.sampleRate = SR; this.baseLatency = 0.005; this.destination = node('dest');
    this.audioWorklet = { addModule: async (u) => { MODULES.push(String(u)); await LAAD(); } }; }
  get state() { return STAAT; }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); } createBiquadFilter() { return node('biquad'); } createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); } createDelay() { return node('delay'); } createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); } createChannelSplitter() { return node('splitter'); }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.start = () => {}; s.stop = () => { queueMicrotask(() => s.onended?.()); }; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { STAAT = 'running'; return Promise.resolve(); }
};
const WORKLETS = [];
globalThis.AudioWorkletNode = class {
  constructor(ctx, naam, opties = {}) {
    this.naam = naam; this.opties = opties;
    this.numberOfOutputs = opties.numberOfOutputs ?? 1;
    if (opties.outputChannelCount && opties.outputChannelCount.length !== this.numberOfOutputs) throw new Error('IndexSizeError');
    this.port = { postMessage() {}, onmessage: null };
    verbind(this);
    const connect = this.connect;
    // Zoals de echte: een uitgang die er niet is gooit IndexSizeError.
    this.connect = (n, uit = 0, inn = 0) => { if (!(uit >= 0 && uit < this.numberOfOutputs)) throw new Error('IndexSizeError'); return connect.call(this, n, uit, inn); };
    WORKLETS.push(this);
  }
};

const { Master, COMPRESSOR_VERTRAGING, LIMITER_FADE } = await import('../src/engine/master.js');
const { uitgangsVertraging } = await import('../src/engine/hoorbaar.js');
const { startDrempel } = await import('../src/engine/overgang.js');
{
  // a. Zonder worklet: de compressor van vroeger, op dezelfde plek.
  const ctx0 = new AudioContext();
  const m0 = new Master(ctx0, ctx0.destination, { limiter: false });
  ok('gain → insert-rack → compressor → limiter-uitgang → analyser → de zaal; de analyser is het eind (opname, koptelefoon, vormen)',
    heeft(m0.gain, m0.fx.in) && heeft(m0.fx.out, m0.compressor) && heeft(m0.limiter, m0.analyser) && heeft(m0.analyser, ctx0.destination)
    && m0.input === m0.gain && uitVan(m0.analyser).length === 1);
  ok('zonder worklet: soort compressor, vertraging 6 ms in wat je hoort', m0.soort === 'compressor' && (await m0.klaar) === false
    && ctx0.graafVertraging === COMPRESSOR_VERTRAGING && Math.abs(uitgangsVertraging(ctx0) - (0.005 + 0.006)) < 1e-12);
  ok('het insert-rack staat droog (mix 0, het filter erin): niets hoorbaar tot je hem opendraait',
    m0.fx.mix === 0 && m0.fx.effectId === 'filter' && m0.fx.dry.gain.value === 1);
  m0.compressor.reduction = -3.5;
  ok('gain reduction van de compressor: −3,5 dB', m0.gr() === -3.5);

  // b. De worklet laadt terwijl de context stilstaat (de gewone gang): direct erin.
  STAAT = 'suspended';
  const ctx = new AudioContext();
  const m = new Master(ctx, ctx.destination);
  const geladen = await m.klaar;
  const wl = WORKLETS.at(-1);
  ok('de worklet laadt bij het maken (limiter-worklet.js), met plafond, vooruitblik, release en marge',
    geladen && MODULES.at(-1).endsWith('/src/engine/limiter-worklet.js') && wl.naam === 'varve-limiter'
    && wl.opties.numberOfOutputs === 2 && wl.opties.outputChannelCount.join() === '2,1'
    && wl.opties.processorOptions.plafondDb === -1 && wl.opties.processorOptions.vooruit === 0.0015
    && wl.opties.processorOptions.release === 0.08 && wl.opties.processorOptions.margeDb === MARGE_DB);
  ok('stilstaande context: de compressor eruit, de worklet erin, zonder fade (er loopt niets)',
    m.soort === 'worklet' && heeft(m.fx.out, wl) && heeft(wl, m._wl, 0) && heeft(m._wl, m.limiter) && m._wl.gain.value === 1
    && !heeft(m.fx.out, m.compressor) && uitVan(m.compressor).length === 0);
  ok('uitgang 1 (de gain) naar een eigen analyser, die nergens heen loopt', heeft(wl, m._gr, 1) && uitVan(m._gr).length === 0);
  ok(`vertraging = de vooruitblik: 72 samples = 1,5 ms, in wat je hoort (${(uitgangsVertraging(ctx) * 1000).toFixed(2)} ms met baseLatency)`,
    Math.abs(m.vertraging - 0.0015) < 1e-12 && ctx.graafVertraging === m.vertraging && Math.abs(uitgangsVertraging(ctx) - 0.0065) < 1e-12);
  m._gr.vul = 0.5;
  ok(`gain reduction van de worklet: gain 0,5 = ${m.gr().toFixed(2)} dB`, Math.abs(m.gr() - db(0.5)) < 1e-6);
  m._gr.vul = 1;
  ok('gain 1 = 0 dB; nog niets gerenderd (nullen) = 0 dB', m.gr() === 0 && ((m._gr.vul = 0), m.gr() === 0));
  m._gr.vul = 1e-6;
  ok('heel diep wordt de vloer (−40 dB), geen −Infinity', m.gr() === -40);
  const st = m.limiterStand();
  ok('limiterStand: soort, gr, vertraging, plafond', st.soort === 'worklet' && st.gr === -40 && st.plafond === -1 && st.vertraging === m.vertraging && st.fout === null);

  // c. De worklet komt binnen terwijl de audio LOOPT: equal-power kruisfade.
  STAAT = 'running';
  NOW = 10;
  let laat;
  LAAD = () => new Promise((r) => { laat = r; });
  const ctx2 = new AudioContext();
  const m2 = new Master(ctx2, ctx2.destination);
  ok('zolang hij laadt: de compressor', m2.soort === 'compressor' && heeft(m2.fx.out, m2.compressor));
  NOW = 10.5;
  laat();
  await m2.klaar;
  LAAD = async () => {};
  const comp = m2._compUit.gain, nieuw = m2._wl.gain, t0 = NOW + startDrempel(ctx2);
  const op = (f) => [comp.waarde(t0 + f * LIMITER_FADE), nieuw.waarde(t0 + f * LIMITER_FADE)];
  const [a0, b0] = op(0), [a5, b5] = op(0.5), [a1, b1] = op(1);
  ok(`lopende audio: beide paden even naast elkaar, de compressor 1 → 0 en de worklet 0 → 1 in ${LIMITER_FADE * 1000} ms, na de startdrempel`,
    heeft(m2.fx.out, m2.compressor) && heeft(m2.fx.out, WORKLETS.at(-1)) && a0 === 1 && b0 === 0 && a1 === 0 && b1 === 1
    && comp.waarde(NOW) === 1 && nieuw.waarde(NOW) === 0);
  ok(`… equal power: halverwege ${a5.toFixed(3)} en ${b5.toFixed(3)} (kwadraten samen ${(a5 * a5 + b5 * b5).toFixed(3)})`,
    Math.abs(a5 * a5 + b5 * b5 - 1) < 0.01 && Math.abs(a5 - b5) < 0.01);
  ok('… met hellingen, geen setValueCurveAtTime, geen afgebroken curve', comp.n.curve === 0 && nieuw.n.curve === 0 && comp.n.lin > 10 && TL.CURVE_BREUK === 0);
  await wacht(120);
  ok('vóór het einde van de fade (de audioklok) blijft het oude pad staan', heeft(m2.fx.out, m2.compressor));
  NOW = t0 + LIMITER_FADE + 0.05;
  await wacht(120);
  ok('daarna gaat het compressorpad los (er klinkt niets meer door)', !heeft(m2.fx.out, m2.compressor) && uitVan(m2.compressor).length === 0 && m2._compUit === null);

  // d. Laden mislukt: de compressor blijft, met de reden.
  LAAD = async () => { throw new Error('nep: geen netwerk'); };
  const warn = console.warn; console.warn = () => {};
  const ctx3 = new AudioContext();
  const m3 = new Master(ctx3, ctx3.destination);
  const r3 = await m3.klaar;
  console.warn = warn;
  LAAD = async () => {};
  ok('laden mislukt: de compressor blijft, met de reden (op het scherm)', r3 === false && m3.soort === 'compressor' && /geen netwerk/.test(m3.fout)
    && heeft(m3.fx.out, m3.compressor) && ctx3.graafVertraging === COMPRESSOR_VERTRAGING);
  const NodeWas = globalThis.AudioWorkletNode;
  delete globalThis.AudioWorkletNode;
  const ctx4 = new AudioContext();
  const m4 = new Master(ctx4, ctx4.destination);
  ok('zonder AudioWorkletNode (een oude browser, de mock van engine.test): de compressor, zonder fout', (await m4.klaar) === false && m4.fout === null);
  globalThis.AudioWorkletNode = NodeWas;
  NOW = 0;
}

// ---- 4. op de engine en de bus -------------------------------------------------------
console.log('\nengine en actions');
{
  STAAT = 'suspended';
  const { Engine, DECK_IDS } = await import('../src/engine/engine.js');
  const { bindEngine, bindApp, invoke, read, metaOf } = await import('../src/control/actions.js');
  const { GEEN_KLOK } = await import('../src/engine/fx.js');
  const eng = new Engine();
  await eng.master.klaar;
  const mfx = eng.master.fx;
  ok('de engine heeft de master met de worklet; alle tracks, bussen, sampler en klankschaal op master.input',
    eng.master.soort === 'worklet' && DECK_IDS.every((id) => heeft(eng.deck(id).chain.output, eng.master.input))
    && heeft(eng.sends.A.out, eng.master.input) && heeft(eng.sends.B.out, eng.master.input));
  ok('de zaal na de analyser (zonder vier kanalen: de uitgang zelf)', heeft(eng.master.analyser, eng.ctx.destination));
  ok('het insert-rack loopt op de maat van de maatgever (dezelfde klok als de bussen)', mfx.klok !== GEEN_KLOK && typeof mfx.klok === 'function');
  let herankerd = 0;
  const orig = mfx.heranker.bind(mfx);
  mfx.heranker = () => { herankerd++; orig(); };
  eng.deck('A').emit('change');
  ok('een deck dat verandert herankert ook het master-rack (tempo, maat)', herankerd === 1);
  mfx.heranker = orig;

  let stappen = [];
  bindEngine(eng);
  bindApp({ toon() {}, venster: () => ({ L: 'A', R: 'B' }), opnemer: {}, opnameStart() {}, opnameStop() {}, opnameSoort() {}, rackStap() {},
    masterRackStap: (s) => stappen.push(s) });
  const namen = ['master.fx.mix', 'master.fx.bypass', 'master.fx.next', 'master.rack.next', 'master.rack.prev',
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [`master.fx.knob.${k}`, `master.fx.knob.${k}.hold`])];
  ok('actions bestaan, met de namen van een track (track.N.fx.* → master.fx.*), elk met een label', namen.every((a) => metaOf(a)?.label));
  ok('value 0..1 en trigger zoals bij een track', metaOf('master.fx.mix').type === 'value' && metaOf('master.fx.knob.3').type === 'value'
    && metaOf('master.fx.bypass').type === 'trigger' && metaOf('master.fx.knob.3.hold').type === 'trigger');

  // De gains volgen hun doel op de audioklok (zetDoel: setTargetAtTime); een
  // seconde later staan ze er.
  const straks = (p) => p.waarde(NOW + 1);
  invoke('master.fx.mix', 0.5);
  ok('master.fx.mix: de mix (equal power: droog en nat elk 0,707), en read terug', mfx.mix === 0.5 && read('master.fx.mix') === 0.5
    && Math.abs(straks(mfx.dry.gain) - Math.SQRT1_2) < 1e-6 && Math.abs(straks(mfx.keten.gain.gain) - Math.SQRT1_2) < 1e-6);
  ok('master.fx.bypass: read 0 = aan', read('master.fx.bypass') === 0);
  invoke('master.fx.bypass', true); invoke('master.fx.bypass', false);
  ok('… één druk: uit (read 1), droog vol, nat dicht', mfx.bypass && read('master.fx.bypass') === 1 && Math.abs(straks(mfx.dry.gain) - 1) < 1e-9
    && Math.abs(straks(mfx.keten.gain.gain)) < 1e-9);
  invoke('master.fx.bypass', true);
  ok('… nog een druk: weer aan, de mix zoals hij stond', !mfx.bypass && read('master.fx.bypass') === 0 && Math.abs(straks(mfx.dry.gain) - Math.SQRT1_2) < 1e-6);

  // Het filter-rack (rackVanEffect): plek 1 = freq, 2 = reso.
  ok('knoppen lezen de plek; een plek die het rack niet heeft leest null', read('master.fx.knob.1') === 0.5 && read('master.fx.knob.8') === null);
  invoke('master.fx.knob.1', 0.2);
  ok('master.fx.knob.1 zet plek 1 (het filter dicht naar laag)', mfx.leesPlek(1) === 0.2 && read('master.fx.knob.1') === 0.2);
  invoke('master.fx.knob.1.hold', true);
  ok('… vasthouden: vol open zolang je drukt', mfx.leesPlek(1) === 1 && read('master.fx.knob.1.hold') === 1);
  invoke('master.fx.knob.1.hold', false);
  ok('… loslaten: terug waar hij stond', mfx.leesPlek(1) === 0.2 && read('master.fx.knob.1.hold') === 0);
  invoke('master.fx.next', true);
  ok('master.fx.next: het volgende losse effect (filter → bitcrush), de mix blijft', mfx.effectId === 'crush' && mfx.mix === 0.5);
  invoke('master.rack.next', true); invoke('master.rack.prev', true); invoke('master.rack.next', false);
  ok('master.rack.next/prev: de schermlaag bladert (+1, −1), alleen bij indrukken', stappen.join() === '1,-1');

  const s = eng.snapshot();
  ok('snapshot: masterFx zoals fx van een track (effect, naam, mix, bypass, plekken, herkomst)',
    s.masterFx.effect === 'crush' && s.masterFx.mix === 0.5 && s.masterFx.bypass === false && s.masterFx.herkomst === null
    && s.masterFx.plekken.length === 2 && s.masterFx.plekken[0].naam === 'bits');
  ok('snapshot: de limiter (soort, gr in dB, vertraging, plafond)', s.limiter.soort === 'worklet' && s.limiter.gr === 0
    && Math.abs(s.limiter.vertraging - 0.0015) < 1e-12 && s.limiter.plafond === -1);

  // Wat je hoort: de LED-fase, "tel 1 hier" en de video tellen de vooruitblik mee.
  ok('uitgangsVertraging van de engine = baseLatency + 1,5 ms', Math.abs(uitgangsVertraging(eng.ctx) - (eng.ctx.baseLatency + 0.0015)) < 1e-12);

  // Handelingenlog en terugspelen: de master is wat de zaal hoort.
  const { OVERSLAAN } = await import('../src/control/terugspelen.js');
  const { NIET_IN_WAARDEN } = await import('../src/control/handelingen.js');
  ok('terugspelen slaat de master niet over (de zaal hoorde hem); zijn knoppen staan in de beginstand van het log',
    namen.every((a) => !OVERSLAAN.test(a)) && ['master.fx.mix', 'master.fx.knob.1'].every((a) => !NIET_IN_WAARDEN.test(a)));
}

// ---- 5. het scherm (puur) -----------------------------------------------------------
console.log('\nhet scherm');
{
  const W = await import('../src/ui/master-weergave.js');
  ok('gain reduction als tekst: "0 dB", "−3,2 dB"', W.grTekst(0) === '0 dB' && W.grTekst(-0.01) === '0 dB' && W.grTekst(-3.24) === '−3,2 dB');
  ok('balk: 0 dB leeg, 6 dB half, 12 dB en meer vol', W.grHoogte(0) === 0 && W.grHoogte(-6) === 50 && W.grHoogte(-20) === 100);
  ok('vasthouden: meteen dieper, terug met 20 dB/s', W.houdGr(-1, -5, 0.016) === -5 && Math.abs(W.houdGr(-5, 0, 0.1) + 3) < 1e-9 && W.houdGr(-0.5, 0, 0.1) === 0);
  const sjablonen = [{ name: 'Oplossen' }, { name: 'Dub-worp' }];
  const fx = { herkomst: 's:1', rackNaam: 'Dub-worp', effectId: 'delay', rack: { chain: [{}, {}] }, naarJSON: () => ({ schema: 1, name: 'Dub-worp', chain: [{ type: 'delay' }], macros: [] }) };
  ok('kiezer: een sjabloon, een los effect, of niet bewaard', W.kiesWaarde(fx) === 's:1'
    && W.kiesWaarde({ herkomst: null, effectId: 'filter', rack: { chain: [{}] } }) === 'e:filter'
    && W.kiesWaarde({ herkomst: null, effectId: 'delay', rack: { chain: [{}, {}] } }) === '');
  const tekst = JSON.stringify(W.bewaarVorm(fx, sjablonen));
  const terug = W.leesBewaard(tekst);
  ok('bewaren en terugzetten: de inhoud en de naam van het sjabloon', terug.naam === 'Dub-worp' && terug.rack.name === 'Dub-worp');
  ok('het sjabloon op NAAM terug, ook als de volgorde verschoof; weg = geen herkomst',
    W.sjabloonHerkomst('Dub-worp', [{ name: 'Nieuw' }, ...sjablonen]) === 's:2' && W.sjabloonHerkomst('Dub-worp', [{ name: 'Oplossen' }]) === null
    && W.sjabloonHerkomst(null, sjablonen) === null);
  ok('kapotte opslag: null (dan blijft het standaardeffect)', W.leesBewaard('{kapot') === null && W.leesBewaard('null') === null
    && W.leesBewaard('{"rack":{"chain":"x"}}') === null && W.leesBewaard(null) === null);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const knoppen = [...html.matchAll(/data-action="(master\.[^"]+)"/g)].map((x) => x[1]);
  ok('de MASTER-rij: kiezer, volgend effect, aan/uit, MIX en acht knoppen, met een knop in de balk (standaard dicht)',
    /id="master-btn"/.test(html) && /<section id="master" class="master-rij hidden">/.test(html) && /class="ms-rack"/.test(html)
    && ['master.fx.next', 'master.fx.bypass', 'master.fx.mix', ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `master.fx.knob.${k}`)].every((a) => knoppen.includes(a)));
}

// ---- 6. de APC: het mapje master (alleen erbij, niets veranderd) ---------------------
console.log('\nde APC');
{
  const { Mapping } = await import('../src/control/mapping.js');
  const { Lagen, GROEPEN, LAAGNAAM } = await import('../src/control/lagen.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  const lg = new Lagen();
  const m = new Mapping({ read: () => 0, invoke: () => {}, lagen: () => lg.actief() });
  m.laadStandaard(doc);
  const kies = (sig, shift = false) => m.kies(sig, { shift })?.action ?? null;
  ok('mapje master in de device-groep, met een naam', GROEPEN.device.knoppen.master?.join() === 'master' && !!LAAGNAAM['device.master']);
  ok('Shift + Clip/Device View opent het; Clip/Device View zelf blijft strip/rack', kies('note:0:64', true) === 'layer.device.master' && kies('note:0:64') === 'layer.device.view');
  ok('buiten het mapje doen de device knobs en On/Off wat ze deden', kies('cc:0:16') === 'track.{focus}.trim' && kies('note:0:62') === 'track.{focus}.fx.bypass'
    && kies('note:0:58') === 'track.{focus}.rack.prev');
  lg.zet('device', 'master');
  ok('in het mapje: knop 1–7 = master-plek 1–7, knop 8 = mix, shift + knop 8 = plek 8',
    [1, 2, 3, 4, 5, 6, 7].every((k) => kies(`cc:0:${15 + k}`) === `master.fx.knob.${k}`) && kies('cc:0:23') === 'master.fx.mix' && kies('cc:0:23', true) === 'master.fx.knob.8');
  ok('… Device ◀ ▶ = master-rack, On/Off = master aan/uit; Bank (beatjump) en Lock (quantize) blijven',
    kies('note:0:58') === 'master.rack.prev' && kies('note:0:59') === 'master.rack.next' && kies('note:0:62') === 'master.fx.bypass'
    && kies('note:0:60') === 'track.{focus}.beatjump.back' && kies('note:0:63') === 'transport.quantize');
  lg.druk('device', 'view', true); lg.druk('device', 'view', false);
  ok('Clip/Device View vanuit master: terug naar de strip', lg.stand.device === 'strip');
  const meesterRegels = doc.rules.filter((r) => /^master\.|layer\.device\.master/.test(r.action));
  ok(`elke master-action op de APC heeft een uitleg in gewone taal (${meesterRegels.length} regels)`, meesterRegels.length === 13
    && meesterRegels.every((r) => { const b = beschrijf(r.action); return b.kort !== r.action && b.lang !== r.action && !b.lang.startsWith('?'); }));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
