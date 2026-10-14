// Precisie (14 okt, werkruimte S1, docs/werkruimte/S1.md): fase duwen, jog, op de 1,
// ±1 ms, vaste beatjumps, bend-sterkte, de duoklik, het sync-lampje, het stuk uitlijn.
// In engine.test-stijl: een nagebouwde Web Audio (de worklet bewaart zijn berichten),
// een nep-klok voor de samenvoegtimer die de audioklok meeneemt. Twee tracks op 124 bpm.
// Draai met: node test/precisie.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const WORTEL = fileURLToPath(new URL('..', import.meta.url));

// ---- nep-Web Audio (zoals aanhaakpunten.test: StreamBron met een worklet die zijn berichten bewaart) ----
let NOW = 0;
const BRONNEN = [];        // elke createBufferSource: { buffer, _wanneer } (de klikken)
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), threshold: param(0), knee: param(0),
  ratio: param(1), attack: param(0), release: param(0), fftSize: 1024, smoothingTimeConstant: 0, delayTime: param(0),
  pan: param(0), curve: null, oversample: 'none', connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); }, getFloatTimeDomainData(b) { b.fill(0); },
});
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); this.audioWorklet = { addModule: async () => {} }; }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); } createBiquadFilter() { return node('biquad'); } createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); } createDelay() { return node('delay'); } createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); } createChannelSplitter() { return node('splitter'); } createConvolver() { return node('conv'); }
  createStereoPanner() { return node('pan'); }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() {
    const s = node('src'); s.playbackRate = param(1); s.loop = false; s.buffer = null;
    s.start = (wanneer = 0) => { s._wanneer = wanneer; BRONNEN.push(s); };
    s.stop = () => { s._gestopt = true; queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
globalThis.AudioWorkletNode = class {
  constructor(_ctx, naam, opties = {}) {
    this.naam = naam;
    this.numberOfOutputs = opties.numberOfOutputs ?? 1;
    this.port = { berichten: [], postMessage(m) { this.berichten.push(m); }, onmessage: null };
  }
  connect(n) { return n; }
  disconnect() {}
};

// ---- nep-klok voor de samenvoegtimer: de audioklok loopt mee ----
let KLOK = 0;
const wachtrij = [];
const na = (fn, ms) => { const h = { t: KLOK + ms, fn }; wachtrij.push(h); return h; };
function tik(ms) {
  const eind = KLOK + ms;
  for (;;) {
    wachtrij.sort((a, b) => a.t - b.t);
    const h = wachtrij[0];
    if (!h || h.t > eind) break;
    wachtrij.shift();
    NOW += (h.t - KLOK) / 1000; KLOK = h.t;
    h.fn();
  }
  NOW += (eind - KLOK) / 1000; KLOK = eind;
}

const { Engine } = await import('../src/engine/engine.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { BEND } = await import('../src/engine/deck.js');
const { GridKlik, KLIK_TONEN, DUO_TONEN } = await import('../src/engine/grid-klik.js');
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const bus = await import('../src/control/actions.js');
const { bindEngine, invoke, read, metaOf, list, bijInvoke } = bus;
const P = await import('../src/control/acties-precisie.js');
const { Mapping, sleutelVan, resolveTarget } = await import('../src/control/mapping.js');
const T = await import('../src/control/terugspelen.js');
const H = await import('../src/control/handelingen.js');
const A = await import('../src/auto/automaat.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
const { zetStukOp, uitlijnAan, STUK_BRON } = await import('../src/ui/aanhakers/precisie.js');
const L = await import('../src/control/lagen.js');

const TEL = 60 / 124;                      // een tel op 124 bpm (s)
const MS = (s) => s * 1000;

const eng = new Engine();
bindEngine(eng);
const meldingen = [];
const duwer = P.bindPrecisie(eng, { duwer: new P.Duwer(eng, { na }), zeg: (t, s = 'info') => meldingen.push([t, s]) });
const dA = eng.deck('A'), dB = eng.deck('B'), dC = eng.deck('C');
const buf = renderDemoTrack(eng.ctx, { bars: 32 });          // 62 s
await dA.laadGeheugen(buf, 'a');
await dB.laadGeheugen(buf, 'b');
dA.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
invoke('track.2.fader', 0.6);              // track 1 klinkt harder: die geeft de maat
dA.play();
NOW += 0.1;
dB.seek(4.3);
dB.play();
NOW += 0.05;
eng.sync('B');
NOW += 0.2;

/** Hoeveel seeks een deck krijgt (nudge loopt ook via seek). */
let seeks = 0;
const echteSeek = dB.seek.bind(dB);
dB.seek = (...a) => { seeks++; return echteSeek(...a); };

// ---- 1. fase duwen ---------------------------------------------------------------
console.log('fase duwen (track.N.phase.offset)');
ok('maatgever = track 1, gesynct', eng.syncMaster()?.id === 'A' && Math.abs(eng.faseVerschil('B')) < 1e-6);
ok(`phase.offset leest 0,500 ± 0,001 (${read('track.2.phase.offset')?.toFixed(4)})`, Math.abs(read('track.2.phase.offset') - 0.5) <= 0.001);
ok('meta: bipolar, niet in de beginstand, de auto-DJ neemt over', metaOf('track.2.phase.offset').bipolar === true
  && metaOf('track.2.phase.offset').beginstand === false && metaOf('track.2.phase.offset').overneem === true
  && metaOf('track.2.phase.offset.fine').bipolar === true && metaOf('track.2.phase.offset.fine').beginstand === false);
ok('read null op de maatgever zelf (track 1)', read('track.1.phase.offset') === null && read('track.1.phase.offset.fine') === null);
ok('read null op een lege track', read('track.3.phase.offset') === null);
{
  let f0 = eng.faseVerschil('B');
  invoke('track.2.phase.offset', read('track.2.phase.offset') + 1 / 127);
  ok('de read toont de duw meteen (ook vóór de samenvoegtimer)', Math.abs(read('track.2.phase.offset') - (0.5 + 1 / 127)) < 0.001);
  ok('… en er is nog niet gesprongen (hooguit één sprong per 15 ms)', seeks === 0);
  tik(20);
  const d1 = MS(eng.faseVerschil('B') - f0);
  ok(`invoke(read + 1/127) verschuift faseVerschil met 3,81 ± 0,1 ms (${d1.toFixed(3)} ms, één seek)`, Math.abs(d1 - MS(TEL / 127)) <= 0.1 && Math.abs(d1 - 3.81) <= 0.1 && seeks === 1);
  f0 = eng.faseVerschil('B');
  invoke('track.2.phase.offset.fine', read('track.2.phase.offset.fine') + 1 / 127);
  tik(20);
  const d2 = MS(eng.faseVerschil('B') - f0);
  ok(`.fine: tel/1016 ± 0,05 ms (${d2.toFixed(3)} ms; tel/1016 = ${MS(TEL / 1016).toFixed(3)})`, Math.abs(d2 - MS(TEL / 1016)) <= 0.05);
  // Terug naar gelijk: een draai over de rand gaat rond (afstand op de cirkel).
  invoke('track.2.phase.offset', 0.5); tik(20);
  ok('invoke(0,5) = terug naar gelijk (± 0,01 ms)', Math.abs(MS(eng.faseVerschil('B'))) < 0.01);
  invoke('track.2.phase.offset', 0.999); tik(20);
  const afstand = () => dB.position - dA.position;
  const a0 = afstand();
  invoke('track.2.phase.offset', 0.001); tik(20);
  ok(`0,999 → 0,001 is 0,002 tel vooruit over de rand, niet 0,998 terug (${((afstand() - a0) / TEL).toFixed(4)} tel)`,
    Math.abs((afstand() - a0) / TEL - 0.002) < 1e-6 && Math.abs(read('track.2.phase.offset') - 0.001) < 1e-6);
  invoke('track.2.phase.offset', 0.5); tik(20);
}
{
  // Zonder maatgever: de andere geladen track heeft geen grid.
  const e2 = new Engine();
  bus.bindEngine(e2);
  P.bindPrecisie(e2, { duwer: new P.Duwer(e2, { na }), zeg: () => {} });
  await e2.deck('A').laadGeheugen(buf, 'x');
  await e2.deck('B').laadGeheugen(buf, 'y');
  e2.deck('B').setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  ok('read null zonder maatgever (geen andere track met een grid)', e2.syncMaster() === e2.deck('B') && read('track.2.phase.offset') === null);
  // terug naar de echte engine op de bus
  bindEngine(eng);
  P.bindPrecisie(eng, { duwer, zeg: (t, s = 'info') => meldingen.push([t, s]) });
}

// ---- 2. samenvoegen ----------------------------------------------------------------
console.log('\nsamenvoegen (hooguit één sprong per 15 ms)');
{
  eng.sync('B'); tik(20);
  seeks = 0;
  const f0 = eng.faseVerschil('B');
  for (let i = 0; i < 50; i++) { invoke('track.2.phase.offset', read('track.2.phase.offset') + 0.002); tik(2); }
  tik(40);
  const veel = eng.faseVerschil('B') - f0, n = seeks;
  eng.sync('B'); tik(20);
  const g0 = eng.faseVerschil('B');
  invoke('track.2.phase.offset', read('track.2.phase.offset') + 0.1); tik(40);
  const een = eng.faseVerschil('B') - g0;
  ok(`50 invokes in 100 ms: ≤ 7 seeks (${n})`, n <= 7 && n >= 1);
  ok(`… dezelfde eindfase als één invoke met de som (${MS(veel).toFixed(3)} vs ${MS(een).toFixed(3)} ms, ± 0,1)`, Math.abs(MS(veel - een)) <= 0.1 && Math.abs(MS(een) - MS(0.1 * TEL)) < 0.1);
}
{
  // Met keylock is een sprong GEPLAND (~98 ms later): nooit een tweede erbovenop.
  eng.sync('B'); tik(20);
  dB.setKeylock(true);
  let dubbel = 0, starts = 0;
  const bron = dB.bron, echteStart = bron.start.bind(bron);
  bron.start = (...a) => { starts++; if (bron._vorig && NOW < bron.seg.T) dubbel++; return echteStart(...a); };
  const f0 = eng.faseVerschil('B');
  let som = 0;
  for (let i = 0; i < 100; i++) { invoke('track.2.phase.offset', read('track.2.phase.offset') + 0.002); som += 0.002; tik(5); }
  tik(400);
  const d = eng.faseVerschil('B') - f0;
  ok(`keylock: nooit twee geplande segmenten tegelijk (${starts} sprongen, ${dubbel} erbovenop)`, dubbel === 0 && starts >= 2);
  ok(`… en alles komt aan: ${MS(d).toFixed(3)} ms (verwacht ${MS(som * TEL).toFixed(3)} ± 0,1)`, Math.abs(MS(d) - MS(som * TEL)) <= 0.1);
  bron.start = echteStart;
  dB.setKeylock(false);
}

// ---- 3. jog en ±1 ms ---------------------------------------------------------------
console.log('\njog en ±1 ms');
{
  eng.sync('B'); tik(20);
  dB.pause();
  dB.cuePoint = 3.21;
  const p0 = dB.position;
  invoke('track.2.jog.fwd', true); invoke('track.2.jog.fwd', false);
  tik(20);
  ok(`jog in pauze: 1/16 tel = 30,24 ± 0,01 ms (${MS(dB.position - p0).toFixed(3)} ms)`, Math.abs(MS(dB.position - p0) - 30.24) <= 0.01);
  ok('… de track blijft stil en het cuepunt verandert niet', !dB.playing && dB.cuePoint === 3.21);
  const p1 = dB.position;
  invoke('track.2.jog.fine.back', true); tik(20);
  ok(`jog fijn terug: 1/64 tel (${MS(p1 - dB.position).toFixed(3)} ms)`, Math.abs(MS(p1 - dB.position) - MS(TEL / 64)) < 0.01);
  dB.play(); tik(10);
  eng.sync('B'); tik(20);
  // Tijdens spelen in een loop: fasebehoudend en binnen de loop.
  dB.setBeatLoop(4);
  const l = { ...dB.loop };
  tik(1800);   // vlak voor het einde van de loop (4 tellen = 1,935 s)
  const f0 = eng.faseVerschil('B');
  for (let i = 0; i < 4; i++) { invoke('track.2.jog.fwd', true); tik(20); }
  const d = eng.faseVerschil('B') - f0;
  ok(`jog spelend: fasebehoudend (4 × 1/16 tel = ${MS(TEL / 4).toFixed(2)} ms, gemeten ${MS(d).toFixed(2)})`, Math.abs(MS(d) - MS(TEL / 4)) < 0.05);
  ok('… en binnen de loop', dB.loop && dB.loop.start === l.start && dB.position >= l.start && dB.position < l.end);
  dB.clearLoop();
  // ±1 ms
  const g0 = eng.faseVerschil('B');
  invoke('track.2.nudge.fine.fwd', true); tik(20);
  ok(`nudge.fine.fwd: precies 1 ms (${MS(eng.faseVerschil('B') - g0).toFixed(4)})`, Math.abs(MS(eng.faseVerschil('B') - g0) - 1) < 1e-6);
  invoke('track.2.nudge.fine.back', true); tik(20);
  ok('nudge.fine.back: weer terug', Math.abs(MS(eng.faseVerschil('B') - g0)) < 1e-6);
  // Zonder grid: 5 ms (fijn 1 ms).
  await dC.laadGeheugen(buf, 'c');
  const c0 = dC.position;
  invoke('track.3.jog.fwd', true); tik(20);
  ok(`jog zonder grid: 5 ms (${MS(dC.position - c0).toFixed(3)})`, Math.abs(MS(dC.position - c0) - 5) < 1e-6);
  invoke('track.3.jog.fine.back', true); tik(20);
  ok('jog fijn zonder grid: 1 ms', Math.abs(MS(dC.position - c0) - 4) < 1e-6);
  meldingen.length = 0;
  invoke('track.4.jog.fwd', true); tik(20);
  ok('jog op een lege track: een melding, geen stille knop', meldingen.length === 1 && /leeg/.test(meldingen[0][0]));
  ok('jog en nudge.fine: de auto-DJ neemt over', metaOf('track.2.jog.fwd').overneem && metaOf('track.2.nudge.fine.back').overneem
    && A.neemtOver('track.2.jog.back')?.nr === 2 && A.neemtOver('track.2.phase.offset')?.nr === 2);
}

// ---- 4. vaste beatjumps ------------------------------------------------------------
console.log('\nbeatjump ¼ · ½ · 1 tel');
{
  dB.pause();
  dB.seek(10);
  const p0 = dB.position;
  invoke('track.2.beatjump.quarter.fwd', true); invoke('track.2.beatjump.quarter.fwd', false);
  ok(`beatjump.quarter: ¼ tel (${MS(dB.position - p0).toFixed(3)} ms)`, Math.abs(dB.position - p0 - TEL / 4) < 1e-9);
  invoke('track.2.beatjump.half.back', true);
  invoke('track.2.beatjump.beat.fwd', true);
  ok('½ terug en 1 vooruit: + ¾ tel', Math.abs(dB.position - p0 - 0.75 * TEL) < 1e-9);
  ok('de beatjump-lengte van Bank blijft staan', dB.sprongTellen === 4);
  dB.seek(dB.duration - 0.1);
  meldingen.length = 0;
  invoke('track.2.beatjump.beat.fwd', true);
  ok('voorbij het einde: geweigerd met dezelfde melding als beatjump', meldingen.length === 1 && /voorbij het einde/.test(meldingen[0][0]) && dB.position > dB.duration - 0.2);
  dB.seek(0.05);
  meldingen.length = 0;
  invoke('track.2.beatjump.quarter.back', true);
  ok('vóór het begin: geweigerd', meldingen.length === 1 && /vóór het begin/.test(meldingen[0][0]) && Math.abs(dB.position - 0.05) < 1e-9);
  meldingen.length = 0;
  invoke('track.3.beatjump.quarter.fwd', true);
  ok('zonder grid: geweigerd met de melding van beatjump', meldingen.length === 1 && /zonder beatgrid/.test(meldingen[0][0]));
  ok('deck.beatjump(r, { tellen }) en zonder lengte = sprongTellen', (() => {
    dB.seek(10); dB.beatjump(1, { tellen: 0.5 }); const a = dB.position; dB.beatjump(-1); return Math.abs(a - 10 - TEL / 2) < 1e-9 && Math.abs(dB.position - (a - 4 * TEL)) < 1e-9;
  })());
  dB.play(); tik(10);
}

// ---- 5. op de 1 ----------------------------------------------------------------------
console.log('\nop de 1 (track.N.bar.align)');
{
  eng.sync('B'); tik(20);
  dB.beatjump(1, { tellen: 1 }); tik(20);
  const telA = () => dA.grid.telInMaat(dA.position), telB = () => dB.grid.telInMaat(dB.position);
  ok(`een tel naast de maat: lampje 0 (tel ${telB()} tegen ${telA()})`, telA() !== telB() && read('track.2.bar.align') === 0);
  invoke('track.2.bar.align', true); tik(20);
  ok(`op de 1: telInMaat gelijk aan die van de maatgever (${telB()} = ${telA()}), lampje 1`, telA() === telB() && read('track.2.bar.align') === 1);
  ok('op de 1 op de maatgever zelf: read null', read('track.1.bar.align') === null);
  // Over een stukgrens met een eigen maat-anker: stuk 2 begint op 20 s, met zijn "1" een tel later.
  const anker = 42 * TEL, g = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0 }, { van: 20, bpm: 124, anker, maat: anker + TEL }] });
  dB.setGrid(g);
  // De maatgever op 3½ tel in de maat, track 2 op tel 41½ (net na de grens, nog in de
  // overgang: 1½ in de maat): +1 tel landt op 42½, in stuk 2 met zijn eigen "1" op tel 43
  // ook 3½ in de maat; −2 tellen (39½) evengoed, maar dat is verder. Zonder het anker van
  // stuk 2 (doortellen vanaf tel 0) zou 42½ op 2½ uitkomen: een tel naast.
  dA.seek(63.5 * TEL);
  dB.seek(41.5 * TEL);
  eng.sync('B'); tik(10);
  // Wat "tellen in de maat van HIER" (vóór de grens) zou zeggen: dat is na de sprong een tel naast.
  const vlak = new Beatgrid({ bpm: 124, firstBeat: 0 });
  invoke('track.2.bar.align', true); tik(20);
  ok(`… ook over een stukgrens met maat-anker: tel ${telB()} = ${telA()} (positie ${dB.position.toFixed(2)} s, in stuk 2)`,
    telA() === telB() && dB.position > 20.4 && read('track.2.bar.align') === 1);
  ok('… waar doortellen zonder het anker van stuk 2 een tel naast was gekomen',
    vlak.telInMaat(dB.position) !== dB.grid.telInMaat(dB.position));
  // Onzeker grid: weigeren met een melding.
  dB.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0, zekerheid: 0.3 }] }));
  tik(10);
  const p = dB.position;
  meldingen.length = 0;
  seeks = 0;
  invoke('track.2.bar.align', true); tik(20);
  ok('onzeker grid: geweigerd met een melding, niet gesprongen', meldingen.length === 1 && /zekere grids/.test(meldingen[0][0]) && seeks === 0);
  meldingen.length = 0;
  invoke('track.3.bar.align', true);
  ok('zonder grid: geweigerd met een melding', meldingen.length === 1 && /beatgrid/.test(meldingen[0][0]));
  ok('de auto-DJ neemt over bij op de 1', A.neemtOver('track.2.bar.align')?.nr === 2);
  ok('… en stond niet stil op een andere plek', Math.abs(dB.position - p) < 0.05);
  dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
}

// ---- 6. bend-sterkte -----------------------------------------------------------------
console.log('\nbend-sterkte');
{
  ok('standaard 4% (BEND), read (0,04 − 0,01)/0,15 = 0,2', dB.bendSterkte === BEND && BEND === 0.04 && Math.abs(read('track.2.bend.amount') - 0.2) < 1e-12);
  const rate = () => dB.bron.rate;
  invoke('track.2.bend.fwd', true);
  ok('bend met 4%', Math.abs(rate() / dB.rate - 1.04) < 1e-12);
  invoke('track.2.bend.amount', 1);
  ok('bend.amount 1 = 16%, ook terwijl je drukt', Math.abs(dB.bendSterkte - 0.16) < 1e-12 && Math.abs(rate() / dB.rate - 1.16) < 1e-12);
  invoke('track.2.bend.fwd', false);
  ok('loslaten: precies terug', rate() === dB.rate);
  invoke('track.2.bend.amount', 0);
  invoke('track.2.bend.back', true);
  ok('bend.amount 0 = 1%', Math.abs(rate() / dB.rate - 0.99) < 1e-12 && read('track.2.bend.amount') === 0);
  invoke('track.2.bend.back', false);
  invoke('track.2.bend.amount', 0.2);
}

// ---- 7. sync-lampje --------------------------------------------------------------------
console.log('\nsync-lampje (0,005 bpm)');
{
  eng.sync('B');
  dB.setRate(dA.bpm / dB.grid.bpmAt(dB.position) + 0.01 / 124);
  ok(`0,01 bpm verschil = 0 (${(dB.bpm - dA.bpm).toFixed(4)})`, read('track.2.sync') === 0);
  dB.setRate(dA.bpm / dB.grid.bpmAt(dB.position) + 0.004 / 124);
  ok(`0,004 bpm verschil = 1 (${(dB.bpm - dA.bpm).toFixed(4)})`, read('track.2.sync') === 1);
  eng.sync('B'); tik(20);
}

// ---- 8. duoklik ---------------------------------------------------------------------------
console.log('\nduoklik');
{
  BRONNEN.length = 0;
  invoke('track.2.duoklik', true); invoke('track.2.duoklik', false);
  ok('aan: de controleklik op track 2, de lage op de maatgever', eng.duoklikDeck === 'B' && eng.gridControleDeck === 'B'
    && eng.gridKlik.deck === dB && eng.duoKlik.deck === dA && read('track.2.duoklik') === 1);
  // De klik plant 0,15 s vooruit, elke 30 ms (zijn eigen timer); hier met de hand, op de nep-klok.
  const t0 = NOW;
  for (let i = 0; i < 40; i++) { NOW += 0.03; eng.duoKlik._plan(); eng.gridKlik._plan(); }
  const laag = BRONNEN.filter((s) => s.buffer === eng.duoKlik._een || s.buffer === eng.duoKlik._tel);
  const tellen = dA.grid.beatsBetween(dA.position - (NOW - t0) - 0.5, dA.position + 0.2);
  const naast = laag.map((s) => Math.min(...tellen.map((b) => Math.abs(s._wanneer - dA.ctxTimeOf(b.tijd)))));
  ok(`de lage tikken staan op ctxTimeOf van de maatgever (${laag.length} tikken, hooguit ${(Math.max(0, ...naast) * 48000).toFixed(3)} sample naast)`,
    laag.length >= 1 && naast.every((x) => x * 48000 <= 1));
  const vers = new GridKlik(eng.ctx, node('x'));
  const zelfde = (a, b) => a.length === b.length && a.getChannelData(0).every((x, i) => x === b.getChannelData(0)[i]);
  ok('de controleklik is ongewijzigd (dezelfde tonen, dezelfde samples)', KLIK_TONEN.een === 1760 && KLIK_TONEN.tel === 1175
    && zelfde(eng.gridKlik._een, vers._een) && zelfde(eng.gridKlik._tel, vers._tel));
  ok('de duoklik klinkt lager (880/587 Hz)', DUO_TONEN.een < KLIK_TONEN.een && DUO_TONEN.tel < KLIK_TONEN.tel && !zelfde(eng.duoKlik._een, vers._een));
  ok('meta: terugspelen slaat hem over, niet in de beginstand', T.slaOver('track.2.duoklik') && metaOf('track.2.duoklik').beginstand === false);
  invoke('track.2.duoklik', true);
  ok('nog eens: uit, en de controleklik ook', eng.duoklikDeck === null && eng.gridControleDeck === null && !eng.duoKlik.aan && !eng.gridKlik.aan && read('track.2.duoklik') === 0);
  eng.gridControle('B');
  invoke('track.2.duoklik', true); invoke('track.2.duoklik', true);
  ok('stond de controleklik al aan, dan laat de duoklik hem bij uit staan', eng.duoklikDeck === null && eng.gridControleDeck === 'B' && eng.gridKlik.aan);
  eng.gridControle(null);
  invoke('track.2.duoklik', true);
  eng.gridControle('A');
  ok('een ander deck controleren beëindigt de duoklik', eng.duoklikDeck === null && !eng.duoKlik.aan && eng.gridControleDeck === 'A');
  eng.gridControle(null);
}

// ---- 9. log --------------------------------------------------------------------------------
console.log('\nhandelingenlog en auto-DJ');
{
  // Een duw opnemen zoals het log hem ziet (de bus), dan terugspelen vanaf dezelfde stand.
  eng.sync('B'); tik(20);
  const log = [];
  const uit = bijInvoke((id, v) => { if (id.startsWith('track.2.phase')) log.push([KLOK, id, v]); });
  const f0 = eng.faseVerschil('B');
  for (let i = 0; i < 10; i++) { invoke('track.2.phase.offset', read('track.2.phase.offset') + 0.01); tik(7); }
  invoke('track.2.phase.offset.fine', read('track.2.phase.offset.fine') + 0.05); tik(30);
  uit();
  const toen = eng.faseVerschil('B') - f0;
  eng.sync('B'); tik(20);
  const g0 = eng.faseVerschil('B');
  let vorige = log[0][0];
  for (const [t, id, v] of log) { tik(t - vorige); vorige = t; invoke(id, v); }
  tik(40);
  const nu = eng.faseVerschil('B') - g0;
  ok(`duwen speelt terug als dezelfde duw (${MS(toen).toFixed(3)} en ${MS(nu).toFixed(3)} ms)`, Math.abs(MS(toen - nu)) < 0.01 && !T.slaOver('track.2.phase.offset'));
  const st = H.leesStand({ engine: eng, tracks: bus.TRACKS, herkomst: () => null, acties: list(), lees: read });
  ok('phase.offset (en .fine) staat niet in de beginstand; bend.amount wel', !('track.2.phase.offset' in st.waarden)
    && !('track.2.phase.offset.fine' in st.waarden) && 'track.2.bend.amount' in st.waarden);
}

// ---- 10. het stuk uitlijn ---------------------------------------------------------------------
console.log('\nhet stuk mappings/stukken/uitlijn.json');
{
  const stuk = JSON.parse(readFileSync(WORTEL + 'mappings/stukken/uitlijn.json', 'utf8'));
  const std = JSON.parse(readFileSync(WORTEL + 'mappings/apc40mk2.json', 'utf8'));
  const bezet = new Set(std.rules.map(sleutelVan));
  const regels = stuk.regels.apc40mk2;
  const botsing = regels.filter((r) => bezet.has(sleutelVan(r)));
  ok(`0 botsingen met apc40mk2.json (${regels.length} regels)`, botsing.length === 0 && regels.length === 20);
  ok('formaat B4: schema 1, stuk uitlijn, mapje device.uitlijn op ⇧ Lock, groen',
    stuk.schema === 1 && stuk.stuk === 'uitlijn' && stuk.mapjes.nieuw['apc40mk2.device.uitlijn'].kleur === 'groen'
    && stuk.mapjes.nieuw['apc40mk2.device.uitlijn'].kiesknop.in === 'note:0:63' && stuk.mapjes.nieuw['apc40mk2.device.uitlijn'].kiesknop.shift === true);
  // Afspraak met Clay (14 okt): hij maakt de knoppenverdeling zelf; wat wij leveren is een voorbeeld.
  ok('het stuk is gemarkeerd als voorbeeld (voorbeeld: true, titel en _uitleg zeggen het)',
    stuk.voorbeeld === true && /^Voorbeeld/.test(stuk.titel) && /^VOORBEELD/.test(stuk._uitleg));
  ok('16 knopregels endless met takeover 1, knop k = track k (⇧ = fijn)', [1, 2, 3, 4, 5, 6, 7, 8].every((k) =>
    regels.some((r) => r.in === `cc:0:${15 + k}` && r.laag === 'device.uitlijn' && !r.shift && r.action === `track.${k}.phase.offset` && r.mode === 'endless' && r.takeover === 1)
    && regels.some((r) => r.in === `cc:0:${15 + k}` && r.laag === 'device.uitlijn' && r.shift && r.action === `track.${k}.phase.offset.fine` && r.mode === 'endless' && r.takeover === 1)));
  // Het mapje en de regels in een echte Mapping, zoals de aanhaker het doet.
  const m = new Mapping({ read, invoke, vars: () => ({ focus: 2 }), lagen: () => ['device.uitlijn'], metaOf });
  m.load(std);
  const voor = m.rules.size;
  const lagen = new L.Lagen();
  bus.bindLagen(lagen);
  const r1 = zetStukOp(m, stuk);
  const na1 = m.rules.size;
  zetStukOp(m, stuk);
  ok(`zetStukOp: mapje erbij, 20 regels; twee keer = één keer (${voor} → ${na1} → ${m.rules.size})`, r1.mapjes === 1 && r1.regels === 20
    && na1 === voor + 20 && m.rules.size === na1 && L.LAAGNAAM['device.uitlijn']?.startsWith('uitlijn') && L.MAPJE_KLEUR['device.uitlijn'] === 'groen');
  invoke('layer.device.uitlijn', true); invoke('layer.device.uitlijn', false);
  ok('layer.device.uitlijn bestaat op de bus (herbindLagen) en opent het mapje', !!metaOf('layer.device.uitlijn') && lagen.stand.device === 'uitlijn'
    && m.kies('note:0:63', { shift: true })?.action === 'layer.device.uitlijn' && m.kies('note:0:63', { shift: false })?.action === 'transport.quantize');
  lagen.zet('device', 'strip');
  ok('elke action bestaat (metaOf, {focus} = 2) en heeft een uitleg', regels.every((r) => {
    const a = resolveTarget(r.action, { focus: 2 });
    const b = beschrijf(r.action);
    return metaOf(a) && b && b.kort && b.lang;
  }));
  ok('elke nieuwe action van de precisie heeft een uitleg (kort + lang)', list().filter((a) => /^track\.\d+\.(phase\.offset|jog\.|nudge\.fine\.|beatjump\.(quarter|half|beat)\.|bar\.align|bend\.amount|duoklik)/.test(a.id))
    .every((a) => { const b = beschrijf(a.id); return b?.kort && b?.lang; }));
  ok('… en de bestaande uitleg blijft van apc-beschrijf (beatjump.back, nudge.back)',
    /standaard 4 tellen/.test(beschrijf('track.1.beatjump.back').lang) && beschrijf('track.1.nudge.back').kort === 'nudge −');
  ok(`bron = ${STUK_BRON}; een eigen regel op dezelfde plek wint`, (() => {
    m.set('cc:0:17', 'track.2.fader', { laag: 'device.uitlijn', mode: 'absolute' });
    zetStukOp(m, stuk);
    return m.kies('cc:0:17')?.action === 'track.2.fader' && m.rules.get('cc:0:18@device.uitlijn')?.bron === STUK_BRON;
  })());
  m.remove('cc:0:17@device.uitlijn');
  zetStukOp(m, stuk);
  // Eén tik van de APC (endless) op knop 2 = 1/127 tel duwen.
  eng.sync('B'); tik(20);
  const f0 = eng.faseVerschil('B');
  m.handle({ type: 'cc', sig: 'cc:0:17', value: 64, norm: 64 / 127 });   // eerste bericht: alleen onthouden
  m.handle({ type: 'cc', sig: 'cc:0:17', value: 65, norm: 65 / 127 });
  tik(20);
  ok(`APC-knop 2, één tik: ${MS(eng.faseVerschil('B') - f0).toFixed(3)} ms (3,81)`, Math.abs(MS(eng.faseVerschil('B') - f0) - MS(TEL / 127)) < 0.05);
  m.shift = true;
  const g0 = eng.faseVerschil('B');
  m.handle({ type: 'cc', sig: 'cc:0:17', value: 66, norm: 66 / 127 });   // een andere action: eerst onthouden
  m.handle({ type: 'cc', sig: 'cc:0:17', value: 67, norm: 67 / 127 });
  tik(20);
  m.shift = false;
  ok(`⇧ + knop 2, één tik: ${MS(eng.faseVerschil('B') - g0).toFixed(3)} ms (0,48)`, Math.abs(MS(eng.faseVerschil('B') - g0) - MS(TEL / 1016)) < 0.05);
  ok('de vlag ?uitlijn=1 / 0 / onthouden', (() => {
    const o = new Map(); const opslag = { getItem: (k) => o.get(k) ?? null, setItem: (k, v) => o.set(k, v), removeItem: (k) => o.delete(k) };
    return !uitlijnAan('http://x/', opslag) && uitlijnAan('http://x/?uitlijn=1', opslag) && uitlijnAan('http://x/', opslag)
      && !uitlijnAan('http://x/?uitlijn=0', opslag) && !uitlijnAan('http://x/', opslag);
  })());
}

console.log(fails.length ? `\n${fails.length} FOUT:\n  ${fails.join('\n  ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
