// @alleen: tijdsgrenzen op de wandklok (vasthouden 600 ms, bewaren < 400 ms, p95 < 5 ms per bericht)
// Het beatgrid gelijkzetten op de APC (docs/BEATGRID.md §12): de gewone fouten
// als scenario's, afgespeeld als MIDI-berichten op de standaardmapping, op de
// echte engine (Web Audio-mock zoals engine.test), met de echte lagen en de
// echte LED-laag. Per scenario en per route: hoeveel drukken (een knop, ook
// met shift, telt één; een encodertik telt apart), of het grid daarna klopt
// over het HELE nummer (elke tel ≤ 2 ms, tempo ≤ 0,01%, de "1" goed, zeker),
// en hoe lang een bericht duurt van MIDI tot het grid (CPU, alle luisteraars).
//
// Een "gebruiker" drukt als hij de klap HOORT, 12 ms te laat (een mens). De
// klappen (deck.onsets) vallen op de echte tellen, dus waar een knop snapt
// (tel 1 hier, vast, tellen hier) wordt dat exact; waar hij niet snapt (zonder
// klappen, nudge) zie je de menselijke fout.
//
// De nulmeting: dezelfde scenario's op een andere boom (een checkout van vóór):
//   VARVE_WORTEL=<checkout> node test/grid-bediening.test.mjs
// Een route die een knop nodig heeft die daar niet op de APC zit, staat dan
// als "niet op de APC". Met VARVE_GRID_UIT=<bestand.json> komen de getallen
// in een bestand (voor het verslag).
// Draai met: node test/grid-bediening.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EIGEN = fileURLToPath(new URL('..', import.meta.url));
const W = process.env.VARVE_WORTEL || EIGEN;
const imp = (p) => import(pathToFileURL(join(W, p)).href);

// ---- de Web Audio-mock (zoals engine.test.mjs: net zo streng als Chrome) ----
let NOW = 0;
const overlapFout = () => Object.assign(new Error('NotSupportedError: overlapt met een lopende setValueCurveAtTime'), { name: 'NotSupportedError' });
const param = (v = 0) => ({ value: v, _curves: [],
  _check(t) { const tt = t ?? NOW; for (const c of this._curves) if (tt >= c.a && tt < c.b) throw overlapFout(); },
  setTargetAtTime(x, t) { this._check(t); this.value = x; },
  setValueAtTime(x, t) { this._check(t); this.value = x; },
  linearRampToValueAtTime(x, t) { this._check(t); this.value = x; },
  setValueCurveAtTime(c, t = NOW, d = 0) { this._curves.push({ a: t, b: t + d }); this.value = c[c.length - 1]; },
  cancelScheduledValues(t = NOW) { this._curves = this._curves.filter((c) => c.a < t); },
  cancelAndHoldAtTime(t = NOW) { this._curves = this._curves.filter((c) => c.a < t).map((c) => ({ a: c.a, b: Math.min(c.b, t) })); },
});
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), offset: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0,
  connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); }, getFloatFrequencyData(b) { b.fill(-100); },
});
let BRONNEN_GESTART = 0;
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('biquad'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { const n = node('delay'); n.delayTime = param(0); return n; }
  createWaveShaper() { const n = node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createChannelMerger() { return node('merger'); }
  createChannelSplitter() { return node('splitter'); }
  createStereoPanner() { const n = node('pan'); n.pan = param(0); return n; }
  createConstantSource() { const n = node('const'); n.start = () => {}; n.stop = () => {}; return n; }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() {
    const s = node('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    s.start = (wanneer = 0) => { s._wanneer = wanneer; BRONNEN_GESTART++; };
    s.stop = () => { queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) {
    const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] };
  }
  resume() { return Promise.resolve(); }
};

const { Engine } = await imp('src/engine/engine.js');
const { bindEngine, bindLagen, invoke, read, metaOf, trackVanDeck } = await imp('src/control/actions.js');
const { Beatgrid } = await imp('src/engine/beatgrid.js');
const { Mapping } = await imp('src/control/mapping.js');
const { Lagen } = await imp('src/control/lagen.js');
const { Feedback } = await imp('src/control/feedback.js');
const { hoorbaar, uitgangsVertraging } = await imp('src/engine/hoorbaar.js');
const apc = (await imp('src/control/devices/apc40mk2.js')).default;
const standaard = JSON.parse(readFileSync(join(W, 'mappings/apc40mk2.json'), 'utf8'));

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? `  (${extra})` : ''}`); };

const engine = new Engine();
bindEngine(engine);
const lagen = new Lagen();
bindLagen(lagen);
const mapping = new Mapping({ read, invoke, vars: () => ({ focus: trackVanDeck(engine.focus) }), lagen: () => lagen.actief() });
mapping.load(standaard);
const fb = new Feedback({ device: apc, mapping, read, meta: metaOf, send: () => true });
fb.klaar = true;
const meldingen = [];
engine.on('melding', (m) => meldingen.push(m));

const D = engine.deck('A');
const DUUR = 360;
const buf = engine.ctx.createBuffer(1, 8000 * DUUR, 8000);   // een zes minuten lange plaat (de inhoud doet er niet toe)
D.load(buf, 'plaat');
engine.setFocus('A');
const V = () => uitgangsVertraging(engine.ctx);
const hoor = () => hoorbaar(D, V());

// ---- de APC: welke knop doet wat (uit de MAPPING, zoals de echte) -----------
const SHIFT = standaard.shift;
const ontleed = (sig) => { const [type, ch, nr] = sig.split(':'); return { type, channel: +ch, number: +nr }; };
const bericht = (sig, waarde) => {
  const p = ontleed(sig);
  return p.type === 'note'
    ? { sig, type: 'note', channel: p.channel, number: p.number, value: waarde ? 127 : 0, norm: waarde ? 1 : 0, on: !!waarde }
    : { sig, type: 'cc', channel: p.channel, number: p.number, value: waarde, norm: waarde / 127 };
};
/** De regel voor een action in de grid-modus (eerst laag edit.aan, dan zonder laag), of null: niet op de APC. */
function knopVoor(rest, { shift = false } = {}) {
  const action = `track.{focus}.${rest}`;
  const r = standaard.rules.find((x) => x.action === action && !!x.shift === shift && x.laag === 'edit.aan')
    ?? standaard.rules.find((x) => x.action === action && !!x.shift === shift && !x.laag)
    // een shift-variant die alleen bestaat als gewone regel met shift, of omgekeerd
    ?? standaard.rules.find((x) => x.action === action && x.laag === 'edit.aan')
    ?? standaard.rules.find((x) => x.action === action && !x.laag);
  return r ? { sig: r.in, shift: !!r.shift, mode: r.mode } : null;
}
const OP_APC = (rest) => !!knopVoor(rest);

let tel = null;          // { drukken, tikken, ms: [] } van de route die loopt
function stuur(msg) {
  const t0 = process.hrtime.bigint();
  mapping.handle(msg);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  tel?.ms.push(ms);
  return ms;
}
/** Eén knop indrukken en loslaten (met shift als de regel dat vraagt). */
function druk(rest) {
  const k = knopVoor(rest);
  if (!k) throw new Error(`niet op de APC: ${rest}`);
  if (k.shift) stuur(bericht(SHIFT, true));
  stuur(bericht(k.sig, true));
  stuur(bericht(k.sig, false));
  if (k.shift) stuur(bericht(SHIFT, false));
  if (tel) tel.drukken++;
}
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
/** Een knop VASTHOUDEN tot `klaar()` (echte tijd: het herhalen loopt op een timer), hooguit `max` ms. */
async function houdVast(rest, klaar, max = 4000) {
  const k = knopVoor(rest);
  if (!k) throw new Error(`niet op de APC: ${rest}`);
  const t0 = performance.now();
  stuur(bericht(k.sig, true));
  while (!klaar() && performance.now() - t0 < max) await slaap(2);
  stuur(bericht(k.sig, false));
  if (tel) { tel.drukken++; tel.vast = (tel.vast ?? 0) + (performance.now() - t0); }
}
/** Een encoder (relative-2c) n tikken draaien (negatief = terug). */
function draai(rest, n, { shift = false } = {}) {
  const r = standaard.rules.find((x) => x.action === `track.{focus}.${rest}` && !!x.shift === shift && x.laag === 'edit.aan');
  if (!r) throw new Error(`niet op de APC: ${rest}`);
  if (shift) stuur(bericht(SHIFT, true));
  for (let i = 0; i < Math.abs(n); i++) { stuur(bericht(r.in, n > 0 ? 1 : 127)); if (tel) tel.tikken++; }
  if (shift) stuur(bericht(SHIFT, false));
}
function gridModus(aan) {
  if ((lagen.stand.edit === 'aan') === aan) return;
  const r = standaard.rules.find((x) => x.action === 'layer.edit.toggle');
  stuur(bericht(SHIFT, true)); stuur(bericht(r.in, true)); stuur(bericht(r.in, false)); stuur(bericht(SHIFT, false));
  if (tel) tel.drukken++;
}

// ---- de klok: spelen, naar een plek, en de tijd laten lopen ------------------
const timers = [];   // echte timers van de app (herhalen bij vasthouden) lopen op de echte klok; die wachten we af
/** De audioklok `s` seconden laten lopen (en wat de app op een timer doet, ook). */
function loop(s) {
  NOW += s;
}
/** Spelen en NU horen we tracktijd t (seek als het al voorbij is: spoelen, niet geteld). */
function hoorOp(t) {
  if (!D.playing) D.play();
  if (hoor() > t + 1e-9 || t - hoor() > 30) D.seek(t + V() * D.rate);
  for (let i = 0; i < 4; i++) NOW += (t - hoor()) / (D.rate || 1);
}
const MENS = 0.012;   // zo laat drukt hij na de klap die hij hoort

// ---- de plaat en de fout -----------------------------------------------------
/** Is het grid goed over het hele nummer? { fase (ms, max), tempo (relatief, max), een (alle "1"-en goed), zeker }. */
function oordeel(waar) {
  const g = D.grid;
  if (!g) return { goed: false, fase: Infinity, tempo: Infinity, een: false, zeker: false, waarom: 'geen grid' };
  const tellen = waar.beatsBetween(0, DUUR - 0.5, 100000);
  const b0 = Math.round(g.beatAt(tellen[0].tijd));
  let fase = 0, tempo = 0, een = true, zeker = true;
  for (let i = 0; i < tellen.length; i++) {
    const t = tellen[i].tijd, L = waar.beatLengthAt(t);
    fase = Math.max(fase, Math.abs((g.beatAt(t) - (b0 + i)) * L) * 1000);
    const Lg = g.beatLengthAt(t);
    // Tempo alleen midden in een stuk (niet de overgangstel aan een grens).
    const binnen = g.stukIndex(t - Lg) === g.stukIndex(t + Lg) && waar.stukIndex(t - L) === waar.stukIndex(t + L);
    if (binnen) tempo = Math.max(tempo, Math.abs(g.bpmAt(t) / waar.bpmAt(t) - 1));
    if (tellen[i].maatbegin) { const p = g.barPhase(t); if (Math.min(p, 1 - p) > 0.01) een = false; }
    if (!g.zekerBij(t)) zeker = false;
  }
  const goed = fase <= 2 && tempo <= 1e-4 && een && zeker;
  const waarom = goed ? '' : [fase > 2 && `fase ${fase.toFixed(1)} ms`, tempo > 1e-4 && `tempo ${(tempo * 100).toFixed(3)}%`, !een && '"1" fout', !zeker && 'onzeker'].filter(Boolean).join(', ');
  return { goed, fase, tempo, een, zeker, waarom };
}
const WAAR_BPM = 124.317;           // geen veelvoud van 0,01: een encoder alleen komt er niet precies op
const T0 = 0.35;
const plaat = (bpm = WAAR_BPM) => new Beatgrid({ stukken: [{ van: 0, bpm, anker: T0, maat: T0 }] });
const klappen = (waar) => Float64Array.from(waar.beatsBetween(0, DUUR, 100000).map((b) => b.tijd));
const tijdVanTel = (waar, n) => waar.timeOf(Math.round(waar.beatAt(T0)) + n);

/**
 * De scenario's. `fout` = het grid waarmee het nummer binnenkomt; elke route
 * is wat Clay op de APC doet (`nodig`: de knoppen die er voor moeten zijn).
 */
const L = 60 / WAAR_BPM;
const SCENARIOS = [
  { id: 'octaaf-half', naam: 'octaaf: grid op de helft (62,16)', fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM / 2, anker: T0, maat: T0, zekerheid: 0.9 }] }),
    routes: [{ naam: '×2 (scene 2)', nodig: ['grid.double'], doe: () => { hoorOp(40); druk('grid.double'); } }] },
  { id: 'octaaf-dubbel', naam: 'octaaf: grid op het dubbele (248,6)', fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM * 2, anker: T0, maat: T0, zekerheid: 0.9 }] }),
    routes: [{ naam: '½ (scene 3), op tel 3 ingedrukt', nodig: ['grid.halve'], doe: () => { hoorOp(tijdVanTel(plaat(), 82) + MENS); druk('grid.halve'); } }] },
  { id: 'een-verschoven', naam: '"1" een tel verschoven (tel 2 is de 1)', fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 + L, zekerheid: 0.9 }] }),
    routes: [
      { naam: 'tel 1 hier op een echte "1" (scene 1, met klappen)', nodig: ['grid.here'], doe: () => { hoorOp(tijdVanTel(plaat(), 80) + MENS); druk('grid.here'); } },
      { naam: 'tel 1 hier op een echte "1", ZONDER klappen (ambient)', nodig: ['grid.here'], zonderKlappen: true, toont: true, doe: () => { hoorOp(tijdVanTel(plaat(), 80) + MENS); druk('grid.here'); } },
      { naam: '"1" een tel terug (← 1), waar dan ook', nodig: ['grid.bar.back'], zonderKlappen: true, doe: () => { hoorOp(37.3); druk('grid.bar.back'); } },
    ] },
  { id: 'fase-12', naam: 'fase 12 ms te laat', fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0 + 0.012, maat: T0 + 0.012, zekerheid: 0.9 }] }),
    routes: [
      { naam: 'nudge −5 −5 −1 −1 (wie weet dat het 12 ms is)', nodig: ['grid.back', 'grid.back.fine'], doe: () => { hoorOp(30); druk('grid.back'); druk('grid.back'); druk('grid.back.fine'); druk('grid.back.fine'); } },
      { naam: 'tel 1 hier op een "1" (snapt)', nodig: ['grid.here'], doe: () => { hoorOp(tijdVanTel(plaat(), 64) + MENS); druk('grid.here'); } },
      { naam: 'tellen hier op een willekeurige tel (snapt, de "1" blijft)', nodig: ['grid.align'], doe: () => { hoorOp(tijdVanTel(plaat(), 66) + MENS); druk('grid.align'); } },
    ] },
  { id: 'fase-47', naam: 'fase 47 ms te laat', fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0 + 0.047, maat: T0 + 0.047, zekerheid: 0.9 }] }),
    routes: [
      { naam: 'nudge: 9× −5 ms, 2× −1 ms', nodig: ['grid.back', 'grid.back.fine'], doe: () => { hoorOp(30); for (let i = 0; i < 9; i++) druk('grid.back'); druk('grid.back.fine'); druk('grid.back.fine'); } },
      { naam: 'nudge −5 ms VASTHOUDEN tot −45 ms, dan 2× −1 ms', nodig: ['grid.back', 'grid.back.fine'], herhaal: true, doe: async () => {
        hoorOp(30);
        const a0 = D.grid.stukken[0].anker;
        await houdVast('grid.back', () => a0 - D.grid.stukken[0].anker >= 0.045 - 1e-9);
        druk('grid.back.fine'); druk('grid.back.fine');
      } },
      { naam: 'tellen hier op een willekeurige tel (snapt)', nodig: ['grid.align'], doe: () => { hoorOp(tijdVanTel(plaat(), 66) + MENS); druk('grid.align'); } },
    ] },
  { id: 'drift', naam: 'tempo 0,1% naast (124,19 i.p.v. 124,317): na 6 min 0,7 tel', fout: () => ({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0, zekerheid: 0.9 }] }),
    routes: [
      { naam: 'encoder: shift +0,1, dan +0,01 ×3 (beste wat 0,01 kan)', nodig: ['grid.bpm'], toont: true, doe: () => { hoorOp(5); draai('grid.bpm', 1, { shift: true }); draai('grid.bpm', 3); } },
      { naam: 'vast (shift + scene 1) op een kick na 2:30', nodig: ['grid.pin'], doe: () => { hoorOp(tijdVanTel(plaat(), 310) + MENS); druk('grid.pin'); } },
      { naam: 'vast pas op 5:00 (het grid 0,63 tel uit de pas)', nodig: ['grid.pin'], doe: () => { hoorOp(tijdVanTel(plaat(), 620) + MENS); druk('grid.pin'); } },
      { naam: 'vast pas op 5:00, ZONDER klappen', nodig: ['grid.pin'], zonderKlappen: true, toont: true, doe: () => { hoorOp(tijdVanTel(plaat(), 620)); druk('grid.pin'); } },
    ] },
  { id: 'wissel', naam: 'tempowissel midden in het nummer (124,317 → 128 op 3:00)', waar: () => {
      const g = plaat(), t = tijdVanTel(g, 372);
      return new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }, { van: t, bpm: 128, anker: t, maat: t }] });
    }, fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0, zekerheid: 0.9 }] }),
    routes: [{ naam: 'nieuw stuk bij de wissel (scene 5), tel 1 hier op de eerste "1", vast 8 tellen later', nodig: ['grid.split', 'grid.here', 'grid.pin'],
      doe: (waar) => {
        const t = waar.stukken[1].van;
        hoorOp(t + MENS); druk('grid.split');
        hoorOp(t + 4 * 60 / 128 + MENS); druk('grid.here');
        hoorOp(t + 12 * 60 / 128 + MENS); druk('grid.pin');
      } }] },
  { id: 'tap', naam: 'geen grid: tap tempo (8 tikken, ±15 ms)', fout: () => null,
    routes: [{ naam: '8× tap, tel 1 hier op een "1", vast na 2:30', nodig: ['tap', 'grid.here', 'grid.pin'], doe: () => {
      const g = plaat(), fouten = [0.012, -0.008, 0.015, 0.003, -0.010, 0.009, 0.014, -0.005];
      const echtNu = performance.now;
      for (let i = 0; i < 8; i++) {
        const t = tijdVanTel(g, 40 + i) + fouten[i];
        hoorOp(t);
        performance.now = () => NOW * 1000;
        druk('tap');
      }
      performance.now = echtNu;
      hoorOp(tijdVanTel(g, 64) + MENS); druk('grid.here');
      hoorOp(tijdVanTel(g, 310) + MENS); druk('grid.pin');
    } }] },
  { id: 'slot-fout', naam: 'op slot maar fout (+20 ms en de "1" op tel 2)', fout: () => ({ slot: true, bron: 'hand', stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0 + 0.020, maat: T0 + 0.020 + L }] }),
    routes: [
      { naam: 'tel 1 hier op een echte "1"', nodig: ['grid.here'], doe: () => { hoorOp(tijdVanTel(plaat(), 80) + MENS); druk('grid.here'); } },
      { naam: 'tellen hier + ← 1', nodig: ['grid.align', 'grid.bar.back'], doe: () => { hoorOp(tijdVanTel(plaat(), 81) + MENS); druk('grid.align'); druk('grid.bar.back'); } },
    ] },
  { id: 'onzeker-goed', naam: 'grid klopt, maar de analyse twijfelt (sync en loops weigeren)', fout: () => ({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0, zekerheid: 0.4 }] }),
    routes: [
      { naam: 'Lock (het hele grid op slot)', nodig: ['grid.lock'], doe: () => { hoorOp(30); druk('grid.lock'); } },
      { naam: '✓ klopt (shift + On/Off) na het luisteren', nodig: ['grid.ok'], doe: () => { hoorOp(30); druk('grid.ok'); } },
    ] },
];

// ---- afspelen ----------------------------------------------------------------
// Eerst één keer warmdraaien (de eerste aanroepen meten anders de JIT).
{
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }] }));
  gridModus(true);
  for (let i = 0; i < 20; i++) { hoorOp(10 + i); for (const a of ['grid.double', 'grid.halve', 'grid.here', 'grid.split']) if (OP_APC(a)) druk(a); }
  D.stop?.();
}
const uitkomsten = [];
const ALLE_MS = [];
for (const sc of SCENARIOS) {
  const waar = sc.waar ? sc.waar() : plaat();
  console.log(`\n# ${sc.naam}`);
  for (const r of sc.routes) {
    D.pause?.(); D.stop?.();
    NOW += 10;
    const fout = sc.fout();
    D.setGrid(fout ? new Beatgrid(fout) : null);
    D._gridTerug = [];
    D.onsets = r.zonderKlappen ? null : klappen(waar);
    D.tellen = null;
    lagen.zet('edit', 'uit');
    meldingen.length = 0;
    const vooraf = oordeel(waar);
    const kan = r.nodig.every(OP_APC);
    const rij = { scenario: sc.id, naam: sc.naam, route: r.naam, opApc: kan, toont: !!r.toont, drukken: null, tikken: null, juist: null, fase: null, tempo: null, een: null, zeker: null, msMax: null, msGem: null, meldingen: [] };
    if (!kan) {
      console.log(`  --  ${r.naam}: niet op de APC (${r.nodig.filter((x) => !OP_APC(x)).join(', ')})`);
      uitkomsten.push(rij);
      continue;
    }
    tel = { drukken: 0, tikken: 0, ms: [] };
    gridModus(true);
    await r.doe(waar);
    const na = oordeel(waar);
    rij.drukken = tel.drukken; rij.tikken = tel.tikken; rij.vastMs = tel.vast ? Math.round(tel.vast) : null;
    rij.juist = na.goed; rij.fase = +na.fase.toFixed(2); rij.tempo = +(na.tempo * 100).toFixed(4); rij.een = na.een; rij.zeker = na.zeker;
    rij.msMax = +Math.max(...tel.ms).toFixed(3); rij.msGem = +(tel.ms.reduce((a, b) => a + b, 0) / tel.ms.length).toFixed(3);
    ALLE_MS.push(...tel.ms);
    rij.meldingen = meldingen.filter((m) => m.soort === 'fout').map((m) => m.tekst.slice(0, 90));
    rij.vooraf = vooraf.waarom || 'goed';
    tel = null;
    console.log(`  ${na.goed ? 'goed' : 'FOUT'}  ${r.naam}: ${rij.drukken} drukken${rij.tikken ? ` + ${rij.tikken} tikken` : ''}${rij.vastMs ? ` (${rij.vastMs} ms vastgehouden)` : ''}; `
      + `fase ${rij.fase} ms, tempo ${rij.tempo}%, "1" ${na.een ? 'goed' : 'fout'}, ${na.zeker ? 'zeker' : 'onzeker'}${na.waarom ? ` [${na.waarom}]` : ''}; `
      + `MIDI→grid max ${rij.msMax} ms${rij.meldingen.length ? `; melding: ${rij.meldingen.join(' | ')}` : ''}  (vooraf: ${rij.vooraf})`);
    uitkomsten.push(rij);
  }
}
D.stop?.();

// ---- rond de scenario's: terug, herankeren, de tik, het lampje, weigeren ------
const extra = {};
/** Een knop op de APC als hij er is, anders dezelfde action over de bus (scherm/toetsenbord). */
const drukOfBus = (rest) => {
  if (OP_APC(rest)) { druk(rest); return 'apc'; }
  const a = `track.1.${rest}`; invoke(a, true); invoke(a, false); return 'bus';
};
{
  // ↶ zet PRECIES terug: een voorstel van de analyse (bron auto, uit de tellen, met twijfel).
  const voorstel = { bron: 'auto', methode: 'tellen', versie: 1, stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0, zekerheid: 0.7, twijfel: 'drift' }] };
  D.setGrid(new Beatgrid(voorstel)); D._gridTerug = [];
  const voor = JSON.stringify(D.grid.toJSON());
  gridModus(true); hoorOp(20);
  drukOfBus('grid.fwd');
  extra.undoWaar = drukOfBus('grid.undo');
  extra.undoExact = JSON.stringify(D.grid.toJSON()) === voor;
  extra.undoBron = D.grid.bron;
  D.stop?.();
}
{
  // Herankeren meteen na een bewerking: de bussen (echo op de maat), de sampler en de tik.
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }] }));
  D.onsets = klappen(plaat());
  hoorOp(40);
  let sampler = 0, bus = 0;
  const os = engine.sampler.heranker.bind(engine.sampler), ob = engine.sends.A.heranker.bind(engine.sends.A);
  engine.sampler.heranker = () => { sampler++; return os(); };
  engine.sends.A.heranker = () => { bus++; return ob(); };
  const tel0 = D.fxKlok().beatLengte;
  engine.gridControle('A');
  const versie0 = engine.gridKlik._versie;
  druk('grid.double');
  extra.herankerSampler = sampler; extra.herankerBus = bus;
  extra.fxKlokVolgt = Math.abs(D.fxKlok().beatLengte - tel0 / 2) < 1e-9;
  // De tik: al opnieuw gepland op het nieuwe grid (in dezelfde taak), of pas bij de volgende tik van zijn timer (30 ms)?
  extra.tikMeteen = engine.gridKlik._versie === D.gridVersie && engine.gridKlik._versie !== versie0;
  engine.gridControle(null);
  engine.sampler.heranker = os; engine.sends.A.heranker = ob;
  D.stop?.();
}
{
  // Het lampje van "tel 1 hier" in de grid-modus: zegt het of het stuk dat je hoort klopt?
  const P = apc.palette;
  lagen.zet('edit', 'aan');
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0, zekerheid: 0.4 }] }));
  hoorOp(30);
  const led = () => fb.desired().get('note:0:82')?.[2] ?? null;
  extra.lampTwijfel = led() === P.oranje ? 'oranje' : led() === P.wit ? 'wit' : String(led());
  drukOfBus('grid.ok');
  extra.lampZeker = led() === P.oranje ? 'oranje' : led() === P.wit ? 'wit' : String(led());
  D.stop?.();
}
{
  // Onzeker: sync, beat-loops en beatjump weigeren met een melding; na ✓ (of Lock) mogen ze.
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0, zekerheid: 0.4 }] }));
  const B = engine.deck('B');
  B.load(buf, 'tweede'); B.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 126, anker: 0.2, maat: 0.2 }] }));
  B.seek(20); B.play();
  hoorOp(30);
  meldingen.length = 0;
  const p0 = D.position, r0 = D.rate;
  invoke('track.1.sync', true); invoke('track.1.sync', false);
  invoke('track.1.beatloop.4', true); invoke('track.1.beatloop.4', false);
  invoke('track.1.beatjump.fwd', true); invoke('track.1.beatjump.fwd', false);
  extra.weigerOnzeker = { meldingen: meldingen.filter((m) => m.soort === 'fout').length, rateGelijk: D.rate === r0, geenLoop: !D.loop,
    nietGesprongen: Math.abs(D.position - p0) < 0.5 };
  drukOfBus('grid.ok');
  meldingen.length = 0;
  invoke('track.1.sync', true); invoke('track.1.sync', false);
  invoke('track.1.beatloop.4', true); invoke('track.1.beatloop.4', false);
  extra.naOk = { meldingen: meldingen.filter((m) => m.soort === 'fout').length, gesynct: Math.abs(D.bpm - B.bpm) < 0.01, loop: D.loopBeats === 4 };
  D.clearLoop?.(); B.stop?.(); D.stop?.();
}
{
  // Vast zonder klappen op een plek waar het grid ver uit de pas ligt: zegt de melding het?
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] }));
  D.onsets = null;
  lagen.zet('edit', 'aan');
  hoorOp(tijdVanTel(plaat(), 620));
  meldingen.length = 0;
  druk('grid.pin');
  extra.vastGokMeldt = meldingen.some((m) => /LET OP/.test(m.tekst));
  D.stop?.();
}
{
  // SNAPPEN OP DE TELLEN (15 okt, BEATGRID.md §14): de klappen liggen zoals op Clay's muziek
  // systematisch 10 ms vroeg (vaste ijking), de tellen van Beat This! ±3 ms om de tel.
  // Tel 1 hier, tellen hier en vast snappen naar de tel; waar geen tel is naar de klap.
  const waar = plaat();
  const echt = klappen(waar);
  const scheef = echt.map((t) => t - 0.010);
  const telRuis = (i) => (((i * 7919) % 7) - 3) * 0.001;              // −3 … +3 ms, vast
  const alle = { beats: echt.map((t, i) => t + telRuis(i)), downbeats: new Float64Array(0) };
  // Beat This! op het halve tempo: alleen elke tweede tel (de grid-tellen ertussen hebben er geen).
  const half = { beats: Float64Array.from([...alle.beats].filter((_, i) => i % 2 === 0)), downbeats: new Float64Array(0) };
  const ankerFout = () => (D.grid.timeOf(Math.round(D.grid.beatAt(tijdVanTel(waar, 80)))) - tijdVanTel(waar, 80)) * 1000;
  const zet = (tellen, onsets) => {
    D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0 + 0.012, maat: T0 + 0.012, zekerheid: 0.9 }] }));
    D._gridTerug = []; D.tellen = tellen; D.onsets = onsets;
    lagen.zet('edit', 'aan');
  };
  const s = {};
  zet(alle, scheef); hoorOp(tijdVanTel(waar, 80) + MENS); druk('grid.here'); s.metTellen = ankerFout();
  zet(null, scheef); hoorOp(tijdVanTel(waar, 80) + MENS); druk('grid.here'); s.zonderTellen = ankerFout();
  zet(half, scheef); hoorOp(tijdVanTel(waar, 80) + MENS); druk('grid.here'); s.halfOpTel = ankerFout();      // tel 80: even, er is een tel
  zet(half, scheef); hoorOp(tijdVanTel(waar, 81) + MENS); druk('grid.align'); s.halfZonderTel = ankerFout(); // tel 81: geen tel, dus de klap
  zet(alle, null); hoorOp(tijdVanTel(waar, 66) + MENS); druk('grid.align'); s.alleenTellen = ankerFout();
  zet(null, null); hoorOp(tijdVanTel(waar, 80) + MENS); druk('grid.here'); s.niets = ankerFout();
  // Vast op 5:00 met het grid 0,63 tel uit de pas: telt het goed met de tellen (half tempo) en scheve klappen?
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] }));
  D._gridTerug = []; D.tellen = half; D.onsets = scheef;
  hoorOp(tijdVanTel(waar, 620) + MENS); meldingen.length = 0; druk('grid.pin');
  s.pinHalf = { ...oordeel(waar), melding: meldingen.at(-1)?.tekst?.slice(0, 80) };
  D.tellen = null;
  extra.snapTellen = { metTellen: +s.metTellen.toFixed(2), zonderTellen: +s.zonderTellen.toFixed(2), halfOpTel: +s.halfOpTel.toFixed(2),
    halfZonderTel: +s.halfZonderTel.toFixed(2), alleenTellen: +s.alleenTellen.toFixed(2), niets: +s.niets.toFixed(2),
    pinHalf: { tempo: +(s.pinHalf.tempo * 100).toFixed(4), fase: +s.pinHalf.fase.toFixed(2), melding: s.pinHalf.melding } };
  D.stop?.();
}
{
  const m = [...ALLE_MS].sort((a, b) => a - b), q = (f) => m[Math.min(m.length - 1, Math.floor(f * m.length))];
  extra.msBerichten = { aantal: m.length, mediaan: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3), max: +m.at(-1).toFixed(3) };
}
{
  // MIDI → grid per knop, in rust gemeten: 200 keer de noot-aan van elke gridknop op een
  // spelend deck (CPU in de hoofdthread, met alle luisteraars van 'change': bussen,
  // sampler, master, koptelefoon). Mediaan en p95; een losse GC-pauze valt in de max.
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }] }));
  D.onsets = klappen(plaat());
  lagen.zet('edit', 'aan');
  hoorOp(60);
  extra.msPerKnop = {};
  for (const rest of ['grid.here', 'grid.align', 'grid.double', 'grid.halve', 'grid.back', 'grid.bar', 'grid.pin', 'grid.undo', 'grid.bpm']) {
    if (!OP_APC(rest) && rest !== 'grid.bpm') continue;
    const k = knopVoor(rest), uit = [];
    for (let i = 0; i < 200; i++) {
      if (i % 20 === 0) D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }] }));
      NOW += 0.25;
      if (rest === 'grid.bpm') { const r = standaard.rules.find((x) => x.action === 'track.{focus}.grid.bpm' && x.laag === 'edit.aan' && !x.shift); uit.push(stuur(bericht(r.in, i % 2 ? 127 : 1))); continue; }
      if (k.shift) stuur(bericht(SHIFT, true));
      uit.push(stuur(bericht(k.sig, true)));
      stuur(bericht(k.sig, false));
      if (k.shift) stuur(bericht(SHIFT, false));
    }
    uit.sort((a, b) => a - b);
    extra.msPerKnop[rest] = { mediaan: +uit[100].toFixed(3), p95: +uit[190].toFixed(3), max: +uit[199].toFixed(3) };
  }
  D.stop?.();
}
{
  // Bewaren bij het nummer: hoe lang van de druk tot de POST (echte timers, nep-fetch).
  let mod = null;
  try { mod = await imp('src/ui/grid-bewaren.js'); } catch { mod = null; }
  if (mod) {
    const posts = [];
    const deckTrack = { A: 'nummer-1', B: null, C: null, D: null, E: null, F: null, G: null, H: null };
    const na = [];
    let gelezen = 0;   // elk antwoord moet gelezen worden (leesWeg): Chrome houdt een ongelezen antwoord vast
    const g = mod.maakGridBewaarder({ engine, decks: ['A'], deckTrack, haal: async (url, init) => {
      posts.push({ t: performance.now(), url, body: init.body });
      return { ok: true, status: 200, json: async () => { gelezen++; return {}; } };
    }, naBewaard: (id, json) => na.push(id) });
    D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }] }));
    g.alsBewaard('A');
    lagen.zet('edit', 'aan');
    hoorOp(30);
    await slaap(50);
    const t0 = performance.now();
    druk('grid.double');
    while (!posts.length && performance.now() - t0 < 3000) await slaap(5);
    extra.bewaarMs = posts.length ? Math.round(posts[0].t - t0) : null;
    extra.bewaarJuist = posts.length === 1 && JSON.parse(posts[0].body).grid.stukken[0].bpm === WAAR_BPM * 2 && na[0] === 'nummer-1';
    // Een encoder die 2 s blijft draaien (elke 100 ms een tik): toch elke ~seconde bewaard, en aan het eind het eindgrid.
    posts.length = 0;
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) { draai('grid.bpm', 1); await slaap(100); }
    await slaap(400);
    extra.bewaarReeks = { posts: posts.length, duur: Math.round(performance.now() - t1),
      laatsteKlopt: posts.length > 0 && JSON.parse(posts.at(-1).body).grid.stukken.at(-1).bpm === D.grid.toJSON().stukken.at(-1).bpm };
    await slaap(50);
    extra.bewaarGelezen = { posts: posts.length + 1, gelezen };   // + 1: de POST van de enkele druk hierboven
    D.stop?.();
  } else {
    extra.bewaarMs = 'interval 1500 ms (laden.js setInterval): 0–1500, gemiddeld 750';
  }
}
{
  // Draaien aan de bpm met de tellen van een UUR muziek: wat kost de weergave (oordeel elke frame,
  // lampje elke LED-tik) op de hoofdthread? 3 s, 30 tikken/s, 60 beelden/s, 30 LED-tikken/s.
  const Lt = 60 / WAAR_BPM, n = Math.floor(3600 / Lt), beats = new Float64Array(n), down = [];
  for (let i = 0; i < n; i++) { beats[i] = T0 + i * Lt + (((i * 7919) % 13) - 6) * 0.0005; if (i % 4 === 0) down.push(beats[i]); }
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }] }));
  D.tellen = { beats, downbeats: Float64Array.from(down) };
  lagen.zet('edit', 'aan');
  hoorOp(60);
  const weergave = (nu) => (typeof D.gridMetingBij === 'function' ? D.gridMetingBij(nu) : D.gridMeting);
  const r = standaard.rules.find((x) => x.action === 'track.{focus}.grid.bpm' && x.laag === 'edit.aan' && !x.shift);
  let cpu = 0, metingen = 0, vorige = null;
  const echtNu = performance.now;
  let klok = 0;
  performance.now = () => klok;          // één klok voor het scherm en het lampje, zoals in de app
  for (let ms = 0; ms < 3000; ms += 1) {
    klok = ms;
    if (ms % 33 === 0) stuur(bericht(r.in, (ms / 33) % 2 ? 127 : 1));
    if (ms % 16 === 0 || ms % 33 === 0) {
      const t0 = process.hrtime.bigint();
      const m = ms % 16 === 0 ? weergave(ms) : vorige;          // het oordeel naast de bpm, elk beeld
      if (ms % 33 === 0) read('track.1.grid.here');               // het lampje van "tel 1 hier", elke LED-tik
      cpu += Number(process.hrtime.bigint() - t0) / 1e6;
      if (m !== vorige) { metingen++; vorige = m; }
    }
  }
  performance.now = echtNu;
  extra.draaienUur = { metingen, cpuMs: Math.round(cpu), perSeconde: Math.round(cpu / 3) };
  D.tellen = null;
  D.stop?.();
}
if (OP_APC('grid.align')) {
  // Vasthouden herhaalt, loslaten stopt, en het hele vasthouden is één stap terug.
  D.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: WAAR_BPM, anker: T0, maat: T0 }] })); D._gridTerug = [];
  lagen.zet('edit', 'aan'); hoorOp(30);
  const k = knopVoor('grid.fwd');
  stuur(bericht(k.sig, true)); await slaap(600); stuur(bericht(k.sig, false));
  const a1 = D.grid.stukken[0].anker;
  await slaap(300);
  const a2 = D.grid.stukken[0].anker;
  const stappen = Math.round((a1 - T0) / 0.005);
  druk('grid.undo');
  extra.vasthouden = { stappen600ms: stappen, stoptBijLoslaten: D._gridTerug.length === 0 && Math.abs(D.grid.stukken[0].anker - T0) < 1e-9,
    nietDoorgelopen: a2 === a1 };
  D.stop?.();
}
console.log('\n# rond de scenario\'s');
for (const [k, v] of Object.entries(extra)) console.log(`  ${k}: ${JSON.stringify(v)}`);

if (process.env.VARVE_GRID_UIT) writeFileSync(process.env.VARVE_GRID_UIT, JSON.stringify({ wortel: W, uitkomsten, extra }, null, 1));

// Op de eigen boom moet elke route die er ís ook kloppen, behalve de routes die
// juist laten zien waar het misgaat (zonder klappen, encoder, nudge op gehoor).
if (W === EIGEN) {
  const mag = (r) => r.toont;   // routes die laten zien waar het misgaat (zonder klappen, encoder alleen)
  const nodig = uitkomsten.filter((r) => !mag(r));
  ok('scenario\'s: elke route staat op de APC', nodig.every((r) => r.opApc), nodig.filter((r) => !r.opApc).map((r) => r.route).join('; '));
  ok('scenario\'s: elke route geeft een goed grid over het hele nummer', nodig.every((r) => r.juist),
    nodig.filter((r) => !r.juist).map((r) => r.route).join('; '));
  // p95, niet max: een losse GC-pauze van Node valt er soms in (gemeten tot 65 ms, ook zonder iets te doen).
  ok('MIDI → grid bijgewerkt: per gridknop mediaan < 1 ms en p95 < 5 ms', Object.values(extra.msPerKnop).every((x) => x.mediaan < 1 && x.p95 < 5),
    Object.entries(extra.msPerKnop).map(([k, x]) => `${k} ${x.mediaan}/${x.p95}`).join(', '));
  ok('de routes die laten zien waar het misgaat, gaan ook mis (anders meet de test niets)', uitkomsten.filter((r) => r.toont).every((r) => r.juist === false));
  ok('vasthouden herhaalt: −45 ms in één druk', uitkomsten.some((r) => /VASTHOUDEN/.test(r.route) && r.juist && r.drukken === 4));
  ok('↶ op de APC (Detail View in de grid-modus) zet PRECIES terug, ook bron en twijfel', extra.undoWaar === 'apc' && extra.undoExact, `bron ${extra.undoBron}`);
  ok('na een bewerking meteen herankerd: sampler, echo-bus, de tel van het deck', extra.herankerSampler > 0 && extra.herankerBus > 0 && extra.fxKlokVolgt);
  ok('de controletik volgt het nieuwe grid in dezelfde taak (niet pas na 30 ms)', extra.tikMeteen);
  ok('lampje "tel 1 hier": oranje bij twijfel, wit als het klopt', extra.lampTwijfel === 'oranje' && extra.lampZeker === 'wit');
  ok('onzeker: sync, beat-loop en beatjump weigeren, elk met een melding', extra.weigerOnzeker.meldingen === 3
    && extra.weigerOnzeker.rateGelijk && extra.weigerOnzeker.geenLoop && extra.weigerOnzeker.nietGesprongen);
  ok('na ✓ klopt: sync en beat-loop mogen, zonder melding', extra.naOk.meldingen === 0 && extra.naOk.gesynct && extra.naOk.loop);
  ok('vast zonder klappen waar het grid ver uit de pas ligt: de melding zegt "LET OP"', extra.vastGokMeldt);
  {
    const s = extra.snapTellen, bij = (x, doel, marge) => Math.abs(x - doel) <= marge;
    ok('snappen: met tellen landt tel 1 hier op de tel (≤ 3 ms), niet op de scheve klap', Math.abs(s.metTellen) <= 3.01, JSON.stringify(s));
    ok('snappen: zonder tellen op de klap (10 ms vroeg, zoals vroeger)', bij(s.zonderTellen, -10, 0.01));
    ok('snappen: Beat This! op het halve tempo: op een tel de tel, ertussen de klap', Math.abs(s.halfOpTel) <= 3.01 && bij(s.halfZonderTel, -10, 0.01));
    ok('snappen: tellen zonder klappen = de tel; niets = de positie zelf (12 ms, de mens)', Math.abs(s.alleenTellen) <= 3.01 && bij(s.niets, 12, 0.5));
    ok('vast op 5:00 met tellen op het halve tempo en scheve klappen: geteld, tempo ≤ 0,01%, fase ≤ 3 ms',
      s.pinHalf.tempo <= 0.01 && s.pinHalf.fase <= 3.01 && /geteld/.test(s.pinHalf.melding ?? ''), JSON.stringify(s.pinHalf));
  }
  ok('draaien met de tellen van een uur: hooguit ~7 metingen per seconde voor de weergave', extra.draaienUur.metingen <= 25 && extra.draaienUur.metingen >= 10, JSON.stringify(extra.draaienUur));
  ok('vasthouden: na 600 ms 5 stappen (1 + 4 herhaald), loslaten stopt, en ↶ zet alles in één keer terug',
    extra.vasthouden.stappen600ms >= 4 && extra.vasthouden.stappen600ms <= 6 && extra.vasthouden.stoptBijLoslaten && extra.vasthouden.nietDoorgelopen, JSON.stringify(extra.vasthouden));
  ok('bewaren: de POST gaat binnen 400 ms na de druk, met het nieuwe grid', extra.bewaarJuist && extra.bewaarMs < 400, `${extra.bewaarMs} ms`);
  ok('bewaren: elk antwoord van de grid-POST is gelezen (leesWeg)', extra.bewaarGelezen?.gelezen === extra.bewaarGelezen?.posts, JSON.stringify(extra.bewaarGelezen));
  ok('bewaren tijdens 2 s draaien: 2 of 3 keer, en het laatste is het eindgrid', extra.bewaarReeks.posts >= 2 && extra.bewaarReeks.posts <= 4 && extra.bewaarReeks.laatsteKlopt,
    JSON.stringify(extra.bewaarReeks));
}

console.log(fails.length ? `\n${fails.length} FOUT` : '\nalles goed');
process.exit(fails.length ? 1 : 0);
