// De LED-laag sneller (14 okt 2026, docs/verslagen/2026-10-14/controller-uitvoer.md):
// het PLAN (wat per tik niet verandert) en de wektik. Op de echte engine met acht
// tracks, de echte standaardmapping en de echte mapjes, tegen dezelfde nep-Web
// Audio als test/patronen-engine.test.mjs.
//   1. het plan verandert NIETS aan wat er brandt: desired() is in elke stand
//      (rust, spelen en knipperen op de tel, elk grid-mapje, elk device-mapje,
//      shift, elke focus, de grid-modus) byte voor byte gelijk aan de oude
//      berekening (hieronder letterlijk overgenomen als referentie);
//   2. het plan wordt hergebruikt zolang mapping, shift, mapjes en focus gelijk
//      blijven, en opnieuw gemaakt als een van die verandert;
//   3. wek(): één tik na de lopende taak, samengevoegd, hooguit één per WEK_MS,
//      niets dubbel; tick() stuurt een hele verversing in één keer (de wachtrij spreidt).
// Draai met: node test/feedback-plan.test.mjs
import { readFileSync } from 'node:fs';

let NOW = 0;
const param = (v = 0) => ({ value: v,
  setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; },
  setTargetAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelAndHoldAtTime() {}, cancelScheduledValues() {} });
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), offset: param(0), delayTime: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0), pan: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, curve: null, oversample: 'none',
  connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); }, getFloatFrequencyData(b) { b.fill(-100); }, getFloatTimeDomainData(b) { b.fill(0); },
});
const bron = (type) => { const n = node(type); n.start = () => {}; n.stop = () => { queueMicrotask(() => n.onended?.()); }; return n; };
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.outputLatency = 0.02; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { const n = node('biquad'); n.type = 'lowpass'; return n; }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { return node('delay'); }
  createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); }
  createChannelSplitter() { return node('splitter'); }
  createStereoPanner() { return node('panner'); }
  createOscillator() { const o = bron('osc'); o.type = 'sine'; o.setPeriodicWave = () => {}; return o; }
  createConstantSource() { return bron('constant'); }
  createPeriodicWave(re, im) { return { re, im }; }
  createBufferSource() { const s = bron('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra && !cond ? ` — ${extra}` : '')); };

const { Engine } = await import('../src/engine/engine.js');
const A = await import('../src/control/actions.js');
const { Mapping, resolveTarget } = await import('../src/control/mapping.js');
const { Feedback, kleurVoor, TEL_VENSTER, TEL_VENSTER_EEN, MAX_PER_TIK, WEK_MS } = await import('../src/control/feedback.js');
const { Lagen, GROEPEN } = await import('../src/control/lagen.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { parseMessage } = await import('../src/control/midi.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;
const standaard = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));

const warn = console.warn; console.warn = () => {};
const eng = new Engine();
A.bindEngine(eng);
const lagen = new Lagen({ beschikbaar: (g, l) => g === 'device' && l === 'inst' && !!eng.instrumentOp(eng.focus) });
A.bindLagen(lagen);
const IDS = A.TRACKS.map(([, id]) => id);
const buf = eng.ctx.createBuffer(2, 48000 * 120, 48000);
for (const [i, id] of IDS.entries()) {
  if (i === 7) continue;                       // track 8 blijft leeg (reads null: lampjes uit)
  const d = eng.deck(id);
  d.load(buf, `track ${id}`);
  if (i !== 6) d.setGrid(new Beatgrid({ bpm: 120 + i, firstBeat: 0.03 * i }));   // track 7 zonder grid
  d.hotcue(0);
}
eng.zetInstrument('H', 'poly');

const mapping = new Mapping({ read: A.read, invoke: A.invoke, vars: () => ({ focus: A.trackVanDeck(eng.focus) }), lagen: () => lagen.actief() });
mapping.load(standaard);
let bus = [];
const fb = new Feedback({ device: apc, mapping, read: A.read, meta: A.metaOf, send: (b) => { bus.push([...b]); return true; } });
fb.klaar = true;

// ---- de OUDE berekening (studio/afmaken, vóór 14 okt), letterlijk: de referentie ----------
const standVan = (v) => (v >= 0.99 ? 'aan' : v > 0.01 ? 'half' : 'uit');
const uitSig = (sig) => sig.replace(':*:', ':0:');
const ontleed = (sig) => { const m = /^(\w+):(\d+):(\d+)$/.exec(sig); return m ? { type: m[1], channel: +m[2], number: +m[3] } : null; };
function telOud(read, soort, doel, stand) {
  const nr = /^track\.(\d+)\./.exec(doel)?.[1];
  if (!nr || !read) return null;
  if (soort === 'aan' && stand !== 'aan') return null;
  if (soort === 'maat' && read(`track.${nr}.leads`) !== 1) return null;
  const fase = read(`track.${nr}.phase`);
  if (fase === null || fase === undefined) return null;
  return fase < (read(`track.${nr}.barbeat`) === 1 ? TEL_VENSTER_EEN : TEL_VENSTER);
}
function desiredOud({ device, mapping: m, read, meta }) {
  const uit = new Map();
  const vars = m.vars();
  const palet = device.palette || {};
  const gedrag = device.behaviour || {};
  const ring = device.ring;
  for (const regel of m.actieveRegels().values()) {
    const sig = uitSig(regel.in);
    const control = device.controls.get(sig);
    if (!control) continue;
    const doel = resolveTarget(regel.action, vars);
    const bronA = regel.led?.lees ? resolveTarget(regel.led.lees, vars) : doel;
    const waarde = read ? read(bronA) : null;
    if (waarde === null) continue;
    const p = ontleed(sig);
    if (!p) continue;
    if (control.kind === 'knob') {
      uit.set(sig, [0xb0 | p.channel, p.number, Math.round(waarde * 127)]);
      const ringSig = ring && device.ringFor?.(sig);
      const rp = ringSig && ontleed(ringSig);
      if (rp) { const mm = meta ? meta(doel) : null; uit.set(`type:${ringSig}`, [0xb0 | rp.channel, rp.number, mm?.bipolar ? ring.pan : ring.volume]); }
      continue;
    }
    if (!control.led) continue;
    const kleur = { ...kleurVoor(regel.led?.lees ?? regel.action), ...(regel.led || {}) };
    let stand = standVan(kleur.invert ? 1 - waarde : waarde);
    if (stand === 'half' && kleur.half === undefined) stand = 'aan';
    const tel = kleur.tel ? telOud(read, kleur.tel, bronA, stand) : null;
    const naamVan = (s) => kleur[s] ?? (s === 'half' ? kleur.aan : undefined);
    if (control.led === 'rgb') {
      if (tel !== null && kleur.tel === 'aan') stand = tel ? 'aan' : 'half';
      else if (tel) stand = stand === 'aan' ? 'half' : 'aan';
      const naam = naamVan(stand);
      const vel = typeof naam === 'number' ? naam : (palet[naam] ?? 0);
      const kanaal = gedrag[kleur.mode] ?? gedrag.vast ?? 0;
      uit.set(sig, [0x90 | kanaal, p.number, vel]);
    } else if (control.led === 'bicolor') {
      const naam = naamVan(stand);
      const bi = device.bicolor || {};
      const vel = typeof naam === 'number' ? naam : (bi[naam] ?? { aan: 127, half: 1, uit: 0 }[stand]);
      uit.set(sig, [0x90 | p.channel, p.number, vel]);
    } else {
      let aan = stand !== 'uit';
      if (tel) aan = !aan;
      uit.set(sig, [0x90 | p.channel, p.number, aan ? 127 : 0]);
    }
  }
  return uit;
}
const zelfde = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k).join() === v.join());
const verschil = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k)?.join() !== b.get(k)?.join()).slice(0, 4)
  .map((k) => `${k}: nieuw ${a.get(k)} oud ${b.get(k)}`).join('; ');

// ---- 1. hetzelfde als de oude berekening, in elke stand ---------------------------------------
console.log('het plan verandert niets aan wat er brandt');
const shift = (aan) => mapping.handle(parseMessage(aan ? [0x90, 98, 127] : [0x80, 98, 0]));
let standen = 0, mis = [];
const vergelijk = (naam) => {
  standen++;
  const nieuw = fb.desired(), oud = desiredOud(fb);
  if (!zelfde(nieuw, oud)) mis.push(`${naam} (${verschil(nieuw, oud)})`);
  return nieuw.size;
};
const grootte = vergelijk('rust');
for (const id of IDS.slice(0, 7)) eng.deck(id).play();
eng.deck('A').setLoop?.(4);
eng.deck('C').setLoop?.(2);
for (let t = 0; t < 4; t += 0.033) { NOW += 0.033; vergelijk(`spelen t=${NOW.toFixed(3)}`); }
for (const grid of GROEPEN.grid.volgorde) {
  lagen.zet('grid', grid);
  for (const id of ['A', 'B', 'G', 'H']) {
    eng.setFocus(id);
    for (const sh of [false, true]) {
      shift(sh);
      for (let k = 0; k < 6; k++) { NOW += 0.083; vergelijk(`grid ${grid}, focus ${id}, shift ${sh}`); }
    }
    shift(false);
  }
}
lagen.zet('grid', 'hotcues');
for (const dv of ['rack', 'inst', 'master', 'beeld', 'strip']) { lagen.zet('device', dv); eng.setFocus('H'); vergelijk(`device ${dv}`); eng.setFocus('A'); vergelijk(`device ${dv} A`); }
lagen.zet('edit', 'aan'); vergelijk('grid-modus'); shift(true); vergelijk('grid-modus + shift'); shift(false); lagen.zet('edit', 'uit');
ok(`${standen} standen (rust, spelen met knipperen, ${GROEPEN.grid.volgorde.length} grid-mapjes × 4 focus × shift, device-mapjes, grid-modus): byte voor byte gelijk`,
  mis.length === 0 && standen > 400 && grootte > 100, mis.slice(0, 3).join(' | '));

// ---- 2. het plan hergebruiken en vernieuwen ---------------------------------------------------
console.log('\nhet plan');
fb.tick();
const plan = fb._plan;
NOW += 0.5; fb.tick(); fb.tick();
ok('niets veranderd aan mapping, shift, mapjes of focus: hetzelfde plan (geen actieveRegels per tik)', fb._plan === plan);
eng.setFocus('B'); fb.tick();
ok('andere focus: een nieuw plan, en de focus-lampjes volgen', fb._plan !== plan && fb.desired().get('cc:0:16')?.join() === desiredOud(fb).get('cc:0:16')?.join());
const p2 = fb._plan;
lagen.zet('grid', 'loops'); fb.tick();
ok('ander mapje: een nieuw plan', fb._plan !== p2);
const p3 = fb._plan;
shift(true); fb.tick(); shift(false);
ok('shift: een nieuw plan', fb._plan !== p3);
const p4 = fb._plan; fb.tick();
const voorRegels = fb.desired().get('note:0:32')?.join();
mapping.set?.('note:0:32', 'track.1.play', { mode: 'trigger', laag: 'grid.loops' });
fb.tick();
ok('de mapping verandert (een regel erbij, event change): een nieuw plan dat de regel kent',
  fb._plan !== p4 && fb.desired().get('note:0:32')?.join() !== voorRegels && zelfde(fb.desired(), desiredOud(fb)));
mapping.load(standaard);
lagen.zet('grid', 'hotcues');
{
  // Een mapping zonder events (de stub van hub.test): het aantal regels zit ook in de sleutel.
  const rules = new Map();
  const stub = { rules, vars: () => ({}) };
  const fbS = new Feedback({ device: apc, mapping: stub, read: () => 1, meta: () => null, send: () => true });
  fbS.klaar = true;
  const voor = fbS.desired().size;
  rules.set('note:0:50', { in: 'note:0:50', action: 'track.1.play', mode: 'trigger' });
  ok('een mapping zonder events: een regel erbij telt toch mee', voor === 0 && fbS.desired().size === 1);
}
ok('de kleur van een action wordt onthouden (zelfde object), en klopt met het schema',
  kleurVoor('track.3.hotcue.2') === kleurVoor('track.3.hotcue.2') && kleurVoor('track.3.hotcue.2').aan === 'geel' && kleurVoor('iets.onbekends').aan === 'wit');

// ---- 3. tick en wek -----------------------------------------------------------------------------
console.log('\ntick en wek');
fb.invalidate(); bus = [];
const n = fb.tick();
ok(`een hele verversing in één tik (${n} berichten, max ${MAX_PER_TIK}): de wachtrij van de MidiHub spreidt`, n === fb.desired().size && n <= MAX_PER_TIK && bus.length === n);
bus = [];
ok('daarna: niets meer te sturen', fb.tick() === 0 && bus.length === 0);

{
  let klok = 1000;
  const busW = [];
  const fbW = new Feedback({ device: apc, mapping, read: A.read, meta: A.metaOf, send: (b) => { busW.push([...b]); return true; }, nu: () => klok });
  fbW.klaar = true;
  fbW.tick();
  busW.length = 0;
  klok += 40;
  const speeltB = eng.deck('B').playing;
  A.invoke('track.2.play', true);                 // B gaat uit of aan: het lampje van activator 2 verandert
  fbW.wek(); fbW.wek(); fbW.wek();
  ok('wek: niets synchroon (de action draait nog: bijInvoke komt ervóór)', busW.length === 0 && fbW.wekTikken === 0);
  await Promise.resolve();
  const play2 = busW.filter((b) => b[0] === 0x91 && b[1] === 50);
  ok('… na de lopende taak precies één tik: het lampje van activator 2 klopt', fbW.wekTikken === 1 && play2.length === 1
    && play2[0][2] === (eng.deck('B').playing ? 127 : 0) && eng.deck('B').playing !== speeltB);
  const voor = busW.length;
  fbW.tick();
  ok('… niets dubbel: de gewone tik erna stuurt niets', busW.length === voor);
  // Binnen WEK_MS na een tik: een timer, geen tweede tik in dezelfde ms.
  klok += 1;
  fbW.wek();
  await Promise.resolve();
  ok(`binnen ${WEK_MS} ms na een tik: wachten (geen microtaak)`, fbW.wekTikken === 1 && fbW._wekker !== null);
  await new Promise((r) => setTimeout(r, WEK_MS + 5));
  ok('… en dan alsnog één tik', fbW.wekTikken === 2 && fbW._wekker === null);
  fbW.gepauzeerd = true; klok += 100; fbW.wek(); await Promise.resolve();
  ok('tijdens de paletproef: wek doet niets', fbW.wekTikken === 2);
  fbW.gepauzeerd = false; fbW.klaar = false; fbW.wek(); await Promise.resolve();
  ok('niet klaar (geen uitgang): wek doet niets', fbW.wekTikken === 2);
  fbW.klaar = true; klok += 100; fbW.wek(); fbW.stop();
  await Promise.resolve();
  ok('stop() haalt een geplande wektik weg (microtaak)', fbW.wekTikken === 2 && fbW._wekker === null);
  fbW.tick(); fbW.wek(); fbW.stop();
  await new Promise((r) => setTimeout(r, WEK_MS + 5));
  ok('… en een timer', fbW.wekTikken === 2 && fbW._wekker === null);
  A.invoke('track.2.play', true);
}

console.warn = warn;
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
