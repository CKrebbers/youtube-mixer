// Patronen op de echte engine (docs/PATRONEN.md): de speler in de engine, de
// actions en hun reads, een maatgever met een echt deck, instrument weg en
// wisselen, het handelingenlog (beginstand) en terugspelen, de mapping van de
// modus patronen, de LED-kleuren en de uitleg op de APC-kaart. In Node, tegen
// dezelfde Web Audio-mock als instrumenten.test.mjs. Het pure rekenwerk en de
// opslag: test/patronen.test.mjs; de echte Chrome: tools/headless/patronen.mjs.
// Draai met: node test/patronen-engine.test.mjs
import { readFileSync } from 'node:fs';

let NOW = 0;
let CURVES = 0;
const LIJNEN = [];
const param = (v = 0) => ({ value: v, ev: [],
  setValueAtTime(x, t) { this.ev.push(['set', x, t]); this.value = x; },
  linearRampToValueAtTime(x, t) { this.ev.push(['ramp', x, t]); this.value = x; },
  setTargetAtTime(x, t, tau) { this.ev.push(['target', x, t, tau]); this.value = x; },
  setValueCurveAtTime() { CURVES++; },
  cancelAndHoldAtTime(t) { this.ev.push(['hold', t]); },
  cancelScheduledValues(t) { this.ev.push(['cancel', t]); },
});
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), offset: param(0), delayTime: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, curve: null, oversample: 'none',
  connect(naar) { LIJNEN.push({ van: this, naar }); return naar; },
  disconnect(naar) { for (let i = LIJNEN.length - 1; i >= 0; i--) if (LIJNEN[i].van === this && (naar === undefined || LIJNEN[i].naar === naar)) LIJNEN.splice(i, 1); },
  getByteTimeDomainData(b) { b.fill(128); },
  getFloatFrequencyData(b) { b.fill(-100); },
});
const bron = (type) => {
  const n = node(type);
  n.start = (t = 0) => { n._start = t; };
  n.stop = (t = 0) => { n._stop = t; };
  return n;
};
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { const n = node('biquad'); n.type = 'lowpass'; return n; }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { return node('delay'); }
  createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); }
  createOscillator() { const o = bron('osc'); o.type = 'sine'; o.frequency.value = 440; o.setPeriodicWave = () => {}; return o; }
  createConstantSource() { return bron('constant'); }
  createPeriodicWave(re, im) { return { re, im }; }
  createStereoPanner() { const n = node('panner'); n.pan = param(0); return n; }
  createBufferSource() {
    const s = bron('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    const stop = s.stop; s.stop = (t) => { stop(t); queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
let KLOK_MS = 0;
Object.defineProperty(globalThis.performance, 'now', { value: () => KLOK_MS, configurable: true, writable: true });

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra && !cond ? ` — ${extra}` : '')); };
const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const { Engine } = await import('../src/engine/engine.js');
const A = await import('../src/control/actions.js');
const { invoke, read, list, has, bindEngine, TRACKS, bijInvoke } = A;
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { PPQN } = await import('../src/engine/patronen/venster.js');
const { maatVan } = await import('../src/engine/patronen/speler.js');

const eng = new Engine();
bindEngine(eng);
const pt = eng.patronen;
pt.elke = () => null;                // de timer doen we zelf: tik() op de nep-klok
const meldingen = [];
eng.on('melding', (m) => meldingen.push(m));
let bewerkt = 0;
pt.on('bewerkt', () => bewerkt++);
const tik = (tot, stap = 0.025) => { while (NOW < tot - 1e-12) { NOW = Math.min(tot, NOW + stap); pt.tik(); } };
/** Wat er op een instrument gepland wordt (en het instrument doet het ook echt). */
function spioneer(inst) {
  const log = [];
  for (const w of ['noteOn', 'noteOff', 'alleUit']) {
    const echt = inst[w].bind(inst);
    inst[w] = (...a) => { log.push({ w, a, roep: NOW }); return echt(...a); };
  }
  log.aan = () => log.filter((x) => x.w === 'noteOn');
  return log;
}

// ---- de actions ---------------------------------------------------------------------
console.log('de actions');
{
  NOW = 10;
  ok('de engine heeft een speler (engine.patronen)', !!pt && typeof pt.start === 'function');
  const ids = list().map((a) => a.id);
  const per = ids.filter((a) => /^track\.1\.pattern\./.test(a));
  ok(`per track: 5 plekken (+ meteen), stop (+ meteen), 64 stappen, lengte (+ ◀ ▶), swing, wissen (${per.length})`, per.length === 5 * 2 + 2 + 64 + 3 + 1 + 1);
  ok('en voor alles: rij 1–5, stop (+ meteen), tempo, tap, opnemen', ['patterns.row.1', 'patterns.row.5', 'patterns.stop', 'patterns.stop.now',
    'patterns.tempo', 'patterns.tap', 'patterns.record'].every((a) => has(a)));
  ok('value 0..1 voor lengte, swing en tempo; de rest triggers', A.metaOf('track.1.pattern.length').type === 'value'
    && A.metaOf('track.1.pattern.swing').type === 'value' && A.metaOf('patterns.tempo').type === 'value' && A.metaOf('track.1.pattern.1').type === 'trigger');
  ok('zonder instrument: plek, stap, stop, lengte en rij lezen null (lampje uit)', read('track.1.pattern.1') === null && read('track.1.pattern.step.1') === null
    && read('track.1.pattern.stop') === null && read('track.1.pattern.length') === null && read('patterns.row.1') === null);
  ok('tempo leest 120 bpm (0,4 op 40–240), opnemen uit (0)', dicht(read('patterns.tempo'), 0.4) && read('patterns.record') === 0);
  invoke('track.1.pattern.1', true);
  ok('een plek zonder instrument: een melding, er gebeurt niets', /geen instrument/.test(meldingen.at(-1)?.tekst ?? '') && !pt.sporen.A.wacht);

  eng.zetInstrument('A', 'poly');
  ok('met een instrument: een lege plek leest 0 (donkergrijs), de stappen 0, de lengte 16', read('track.1.pattern.1') === 0
    && read('track.1.pattern.step.1') === 0 && read('track.1.pattern.step.17') === null && dicht(read('track.1.pattern.length'), 15 / 63));
  invoke('track.1.pattern.step.1', true); invoke('track.1.pattern.step.1', false);
  ok('stap 1 via de bus: de laatst gespeelde noot erop (zonder: C4), de plek is gevuld (0,5), er is bewerkt',
    read('track.1.pattern.step.1') === 1 && pt.patroon('A', 1).noten[0].noot === 60 && read('track.1.pattern.1') === 0.5 && bewerkt > 0);
  pt.noot('A', 64, 0.7);
  ok('een andere noot gespeeld: stap 1 leest 0,5 (er staat een andere noot)', read('track.1.pattern.step.1') === 0.5);
  invoke('track.1.pattern.step.1', true);
  ok('… en een klik zet die noot erbij (twee noten op de stap)', pt.patroon('A', 1).noten.map((n) => n.noot).join() === '60,64');
  invoke('track.1.pattern.length', 7 / 63);
  ok('lengte als value: 8 stappen', pt.patroon('A', 1).lengte === 8 && read('track.1.pattern.step.9') === null);
  invoke('track.1.pattern.length.up', true);
  ok('lengte ▶: 9', pt.patroon('A', 1).lengte === 9);
  invoke('track.1.pattern.length', 15 / 63);
  invoke('track.1.pattern.swing', 1);
  ok('swing 1 = 75', pt.patroon('A', 1).swing === 75 && dicht(read('track.1.pattern.swing'), 1));
  invoke('track.1.pattern.swing', 0);
  // Wissen: tweede druk binnen 3 s.
  KLOK_MS = 1000;
  invoke('track.1.pattern.clear', true);
  ok('wissen: eerst een melding, het patroon blijft', /nog eens/.test(meldingen.at(-1).tekst) && pt.patroon('A', 1).noten.length === 2);
  KLOK_MS = 5000;
  invoke('track.1.pattern.clear', true);
  ok('… na 4 s telt de eerste niet meer (weer een melding)', pt.patroon('A', 1).noten.length === 2);
  KLOK_MS = 6000;
  invoke('track.1.pattern.clear', true);
  ok('… binnen 3 s nog eens: leeg (lengte en swing blijven)', pt.patroon('A', 1).noten.length === 0 && pt.patroon('A', 1).lengte === 16 && read('track.1.pattern.1') === 0);
  // Tempo en tap.
  invoke('patterns.tempo', (100 - 40) / 200);
  ok('tempo via de bus: 100 bpm', dicht(pt.tempo, 100));
  const gezien = [];
  const uit = bijInvoke((a, v) => gezien.push([a, v]));
  for (let i = 0; i < 4; i++) { KLOK_MS = 10000 + i * 500; invoke('patterns.tap', true); invoke('patterns.tap', false); }
  uit();
  ok('tap: vier tikken van 0,5 s = 120 bpm, gezet via patterns.tempo (dus in het log)', dicht(pt.tempo, 120, 1e-6)
    && gezien.some(([a]) => a === 'patterns.tempo'));
  invoke('patterns.record', true);
  ok('opnemen aan/uit', pt.opnemen && read('patterns.record') === 1);
  invoke('patterns.record', true);
}

// ---- een maatgever met een echt deck --------------------------------------------------
console.log('\nop de maat van een echt deck');
const buf = renderDemoTrack(eng.ctx, { bars: 16 });
const dB = eng.deck('B');
{
  NOW = 20;
  const inst = eng.instrumentOp('A');
  const log = spioneer(inst);
  pt.laadSet({ tracks: { 1: [{ noten: [0, 4, 8, 12].map((stap) => ({ stap, noot: 36 })) }, { noten: [{ stap: 0, noot: 48 }] }] } });
  dB.load(buf, 'demo');
  dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dB.play();
  NOW = 20.3;
  const m = maatVan(eng.syncMaster());
  ok('maatVan(maatgever): de volgende tel en de tellengte van wat je hoort, met zijn maat', m.id === 'B' && dicht(m.L, 60 / 124)
    && m.n === Math.ceil(dB.grid.beatAt(dB.position) - 1e-9) && dicht(m.a, dB.ctxTimeOf(dB.grid.timeOf(m.n))));
  invoke('track.1.pattern.1', true);
  const K = pt.sporen.A.wacht.start / PPQN;
  ok('plek 1 via de bus: wacht op het volgende maatbegin van track 2 (een veelvoud van 4 tellen)', K % 4 === 0 && [1, 0.5].includes(read('track.1.pattern.1')));
  ok('rijlampje 1: knippert (wacht)', [1, 0.5].includes(read('patterns.row.1')));
  tik(26);
  const aan = log.aan();
  const fout = Math.max(...aan.map((x) => { const b = dB.grid.beatAt(dB.position + (x.a[2] - NOW) * dB.rate); return Math.abs(b - Math.round(b)); }));
  ok(`elke kick op een tel van track 2 (${aan.length} kicks, ${fout.toExponential(1)} tel)`, aan.length >= 8 && fout < 1e-9
    && dicht(aan[0].a[2], dB.ctxTimeOf(dB.grid.timeOf(K))));
  ok('plek 1 speelt (1), stop leest 0,5, de klok volgt track 2', read('track.1.pattern.1') === 1 && read('track.1.pattern.stop') === 0.5
    && pt.klokStand().bron === 'maat' && pt.klokStand().maatgever === 'B');
  // Pitch van track 2 omhoog via de bus (zoals de APC): de kicks gaan mee.
  invoke('track.2.tempo', (1.04 - 0.5) / 1.5);
  const n0 = log.aan().length;
  tik(32);
  const na = log.aan().slice(n0).filter((x) => x.a[2] > 27.5);
  const fout2 = Math.max(...na.map((x) => { const b = dB.grid.beatAt(dB.position + (x.a[2] - NOW) * dB.rate); return Math.abs(b - Math.round(b)); }));
  ok(`track 2 op +4%: de kicks volgen, weer op de tel (${fout2.toExponential(1)} tel)`, na.length > 5 && fout2 < 1e-9);
  // Wisselen naar plek 2 met de rij (scene 2): op de maat, eerst alles los.
  invoke('patterns.row.2', true);
  const K2 = pt.sporen.A.wacht.start;
  tik(36);
  const t2 = pt.klok.tijd(K2 / PPQN);
  const iUit = log.findIndex((x) => x.w === 'alleUit');
  const iNieuw = log.findIndex((x) => x.w === 'noteOn' && x.a[0] === 48);
  ok('rij 2 (scene): track 1 wisselt op de maat; alleUit vóór de eerste noot van plek 2, op hetzelfde moment', iUit >= 0 && iNieuw > iUit
    && dicht(log[iUit].a[0], t2) && dicht(log[iNieuw].a[2], t2) && read('track.1.pattern.2') === 1);
  // Beginstand van het handelingenlog.
  const { leesStand, NIET_IN_WAARDEN } = await import('../src/control/handelingen.js');
  const stand = leesStand({ engine: eng, tracks: TRACKS, herkomst: () => null, acties: list(), lees: read });
  ok('handelingenlog: de beginstand weet welke plek er speelt (track 1, plek 2)', stand.patronen?.speelt?.length === 1
    && stand.patronen.speelt[0].track === 1 && stand.patronen.speelt[0].plek === 2);
  ok('… met het eigen tempo, zonder lengte en swing (die horen bij het patroon, al bewaard)', 'patterns.tempo' in stand.waarden
    && !Object.keys(stand.waarden).some((a) => /\.pattern\./.test(a)) && NIET_IN_WAARDEN.test('track.3.pattern.swing'));
  // Stoppen op de maat via de bus; meteen.
  invoke('patterns.stop', true);
  ok('alles stoppen: plek 2 knippert (stopt op de maat), stop leest 1', [1, 0.5].includes(read('track.1.pattern.2')) && read('track.1.pattern.stop') === 1);
  tik(40);
  ok('… daarna gestopt (gevuld, 0,5), alleUit nog een keer', read('track.1.pattern.2') === 0.5 && log.filter((x) => x.w === 'alleUit').length === 2);
}

// ---- instrument weg en wisselen -------------------------------------------------------------
console.log('\ninstrument weg of wisselen');
{
  NOW = 50;
  invoke('track.1.pattern.1', true);
  tik(54);
  ok('speelt weer', pt.stand('A').speelt === 1);
  eng.zetInstrument('A', 'fm');
  const fm = eng.instrumentOp('A');
  const log = spioneer(fm);
  tik(57);
  ok('een ander instrument op de track: het patroon speelt daarop verder', log.aan().length >= 3 && pt.stand('A').speelt === 1);
  eng.zetInstrument('A', null);
  ok('instrument weg: het patroon stopt meteen (de engine liet al los), lampjes uit', pt.stand('A').speelt === null && !pt.sporen.A.spel
    && read('track.1.pattern.1') === null);
  const n = log.length;
  tik(59);
  ok('… en er gaat niets meer naar het oude instrument', log.length === n);
  // Een nummer laden haalt het instrument weg, en dus ook het patroon.
  eng.zetInstrument('C', 'poly');
  pt.laadSet({ tracks: { 3: [{ noten: [{ stap: 0, noot: 36 }] }] } });
  pt.start('C', 1);
  tik(62);
  eng.deck('C').load(buf, 'een nummer');
  ok('een nummer laden op de track: instrument weg, patroon weg', !eng.instrumentOp('C') && !pt.sporen.C.spel && !pt.sporen.C.wacht);
}

// ---- terugspelen ---------------------------------------------------------------------------
console.log('\nterugspelen');
{
  const { maakPlan, maakUitvoerder, OVERSLAAN } = await import('../src/control/terugspelen.js');
  const regels = [[0.1, 'track.1.pattern.step.3', true], [0.2, 'track.1.pattern.1', true], [0.3, 'patterns.row.2', true],
    [0.4, 'patterns.tempo', 0.5], [0.5, 'patterns.record', true], [0.6, 'patterns.tap', true], [0.7, 'track.1.pattern.swing', 0.3],
    [0.8, 'track.1.pattern.length.up', true], [0.9, 'track.1.pattern.clear', true], [1.0, 'track.1.pattern.stop', true],
    [1.1, 'patterns.stop.now', true], [1.2, 'track.2.pattern.3.now', true]];
  const { plan } = maakPlan(regels);
  ok('terugspelen: bewerken (stappen, swing, lengte, wissen, opnemen, tap) slaat hij over; starten, stoppen, rijen en het tempo niet',
    plan.map((x) => x.a).join() === 'track.1.pattern.1,patterns.row.2,patterns.tempo,track.1.pattern.stop,patterns.stop.now,track.2.pattern.3.now'
    && OVERSLAAN.test('track.8.pattern.step.64') && !OVERSLAAN.test('track.8.pattern.5'));
  // De beginstand: wat nu speelt stopt, wat toen speelde start op de maat (op een track met een instrument).
  NOW = 70;
  eng.zetInstrument('D', 'poly');
  eng.zetInstrument('E', 'poly');
  pt.laadSet({ tracks: { 4: [{ noten: [{ stap: 0, noot: 36 }] }, { noten: [{ stap: 0, noot: 38 }] }], 5: [{ noten: [{ stap: 0, noot: 40 }] }] } });
  pt.start('E', 1);
  tik(72);
  const doe = maakUitvoerder({ engine: eng, tracks: TRACKS, laad: async () => true, invoke, read, has });
  await doe.stand({ tracks: [], waarden: {}, rond: {}, patronen: { speelt: [{ track: 4, plek: 2 }, { track: 6, plek: 1 }] } });
  ok('beginstand: wat nu speelde stopt (meteen), wat toen speelde wacht op de maat; een track zonder instrument niet',
    (!pt.sporen.E.spel || pt.sporen.E.spel.stop != null) && !pt.sporen.E.wacht && pt.sporen.D.wacht?.plek === 2 && !pt.sporen.F.wacht);
  pt.stopAlles({ meteen: true });
  tik(74);
}

// ---- de modus patronen op de APC -------------------------------------------------------------
console.log('\nde modus patronen op de APC');
{
  const { Mapping } = await import('../src/control/mapping.js');
  const { Lagen, GROEPEN, LAAGNAAM } = await import('../src/control/lagen.js');
  const apc = (await import('../src/control/devices/apc40mk2.js')).default;
  const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  const lg = new Lagen();
  const m = new Mapping({ read: () => 0, invoke: () => {}, lagen: () => lg.actief() });
  m.load(doc);
  const actie = (sig, shift = false) => m.kies(sig, { shift })?.action ?? null;
  // Sinds 6 okt staan de secties erachter (docs/SECTIES.md): patronen is de voorlaatste.
  ok('patronen is een grid-modus met een naam, in ▲ ▼ na stems (secties erachter, 6 okt)', GROEPEN.grid.knoppen.patronen?.join() === 'patronen'
    && GROEPEN.grid.volgorde.at(-2) === 'patronen' && GROEPEN.grid.volgorde.at(-1) === 'secties' && /patronen/.test(LAAGNAAM['grid.patronen']));
  ok('Shift + scene 2 opent hem (Shift + scene 3 is stems); scene 2 zonder shift blijft loops', actie('note:0:83', true) === 'layer.grid.patronen' && actie('note:0:83') === 'layer.grid.loops');
  lg.zet('edit', 'aan');
  ok('in de grid-modus blijft Shift + scene 2 "bpm ×2" (zoals scene 2)', actie('note:0:83', true) === 'track.{focus}.grid.double' && actie('note:0:83') === 'track.{focus}.grid.double');
  lg.zet('edit', 'uit');
  lg.zet('grid', 'patronen');
  const pads = [];
  for (let k = 1; k <= 8; k++) for (let r = 1; r <= 5; r++) pads.push([actie(`note:0:${apc.gridNote(k, r)}`), `track.${k}.pattern.${r}`, actie(`note:0:${apc.gridNote(k, r)}`, true)]);
  ok('pad (kolom k, rij r) = plek r van track k; met shift = meteen', pads.every(([a, wil, s]) => a === wil && s === `${wil}.now`));
  ok('scene 1–5 = die rij op alle tracks', [1, 2, 3, 4, 5].every((k) => actie(`note:0:${81 + k}`) === `patterns.row.${k}`));
  ok('Stop All Clips = alles stoppen op de maat, met shift meteen', actie('note:0:81') === 'patterns.stop' && actie('note:0:81', true) === 'patterns.stop.now');
  ok('Shift + scene 4 / 5 blijven auto en klank (weg uit patronen)', actie('note:0:85', true) === 'layer.grid.auto' && actie('note:0:86', true) === 'layer.grid.klank');
  ok('de kern blijft: fader, play, filter, Clip Stop doen wat ze deden', actie('cc:0:7') === 'track.1.fader' && actie('note:0:50') === 'track.1.play'
    && actie('cc:0:48') === 'track.1.filter' && actie('note:0:52') === 'track.1.loop.toggle' && actie('note:0:80') === 'video.black');
  lg.zet('grid', 'hotcues');
  ok('buiten de modus verandert er niets (pad 1/1 = hotcue, Stop All Clips = rem)', actie('note:0:32') === 'track.1.hotcue.1' && actie('note:0:81') === 'track.{focus}.brake');

  // LED's: oranje, donker = gevuld, donkergrijs = leeg, uit = geen instrument; knipperen = de read.
  const { Feedback } = await import('../src/control/feedback.js');
  lg.zet('grid', 'patronen');
  const stand = { 'track.1.pattern.1': 1, 'track.1.pattern.2': 0.5, 'track.1.pattern.3': 0, 'track.2.pattern.1': null };
  const fb = new Feedback({ device: apc, mapping: m, read: (a) => (a in stand ? stand[a] : null), meta: () => null, send: () => true });
  const wil = fb.desired();
  const vel = (k, r) => wil.get(`note:0:${apc.gridNote(k, r)}`)?.[2];
  ok('LED: speelt = oranje (9), gevuld = donker (10), leeg = donkergrijs (1), geen instrument = uit', vel(1, 1) === 9 && vel(1, 2) === 10
    && vel(1, 3) === 1 && vel(2, 1) === undefined && apc.palette.oranjedonker === 10);
  lg.zet('grid', 'hotcues');
  m.shift = true;
  const metShift = new Feedback({ device: apc, mapping: m, read: (a) => (a === 'layer.grid.patronen' ? 0 : null), meta: () => null, send: () => true }).desired();
  ok('met shift brandt scene 2 donker oranje (de modus is dicht)', metShift.get('note:0:83')?.[2] === 10);
  m.shift = false;

  // Uitleg op de APC-kaart en in de mapje-balk.
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const nieuw = ['track.3.pattern.2', 'track.3.pattern.2.now', 'track.3.pattern.stop', 'track.3.pattern.stop.now', 'track.3.pattern.step.17',
    'track.3.pattern.length', 'track.3.pattern.length.up', 'track.3.pattern.length.down', 'track.3.pattern.swing', 'track.3.pattern.clear',
    'patterns.row.4', 'patterns.stop', 'patterns.stop.now', 'patterns.tempo', 'patterns.tap', 'patterns.record', 'layer.grid.patronen'];
  ok('elke nieuwe action heeft een uitleg in gewone taal', nieuw.every((a) => { const b = beschrijf(a); return b.kort && !b.lang.startsWith('?') && b.lang !== a; }));
  // apc-kaart.js raakt bij het laden de DOM aan: de soort lezen we uit de bron.
  const kaart = readFileSync(new URL('../src/ui/apc-kaart.js', import.meta.url), 'utf8');
  const re = new RegExp(/\['patroon', 'patronen', \/(.+)\/\]/.exec(kaart)?.[1] ?? '^$');
  const iVoor = kaart.indexOf("['patroon'"), iTransport = kaart.indexOf("['transport'");
  ok('apc-kaart: de plekken zijn een eigen soort (patronen), vóór transport', re.test('track.1.pattern.1') && re.test('patterns.row.1')
    && !re.test('track.1.play') && iVoor > 0 && iVoor < iTransport);
  const { MODUS_KLEUR, modusVan } = await import('../src/ui/spiegel-plan.js');
  ok('het scherm kleurt de modus (oranje)', MODUS_KLEUR.patronen === 'oranje' && modusVan({ laag: 'grid.patronen' }, 'track.1.pattern.1') === 'patronen');
}

// ---- noten.js: de snelheid gaat mee (opnemen) -------------------------------------------------
console.log('\nnoten.js en opnemen');
{
  const { Noten } = await import('../src/control/noten.js');
  NOW = 80;
  eng.zetInstrument('G', 'poly');
  eng.setFocus('G');
  const noten = new Noten({ engine: eng });
  noten.on('noot', ({ id, noot, aan, snelheid }) => pt.noot(id, noot, aan ? snelheid : 0));
  const gezien = [];
  noten.on('noot', (x) => gezien.push(x));
  noten.speel(43, 0.66);
  noten.laat(43);
  ok('een noot van het schermtoetsenbord: met snelheid gemeld, de speler onthoudt hem als laatste noot',
    gezien[0].snelheid === 0.66 && gezien[0].id === 'G' && pt.laatsteNoot('G') === 43);
  pt.laadSet({ tracks: { 7: [{ noten: [{ stap: 0, noot: 36 }] }] } });
  pt.start('G', 1);
  tik(83);
  invoke('patterns.record', true);
  noten.speel(45, 0.5);
  tik(83.3);
  noten.laat(45);
  ok('live opnemen via noten.js: de noot staat in het patroon dat speelt', pt.patroon('G', 1).noten.some((n) => n.noot === 45 && n.snelheid === 0.5));
  invoke('patterns.record', true);
  pt.stopAlles({ meteen: true });
  tik(85);
}

// ---- de instrumenten van de set terug (VRAGEN S15) ---------------------------------------------
console.log('\nde instrumenten van de set terug (S15)');
{
  NOW = 90;
  const KORT = { noten: [{ stap: 0, noot: 60 }] };
  // D: poly met twee knoppen; E: schaal (wrijven is een gebaar); F: heeft een nummer; H: een onbekend instrument; G: geen patronen.
  for (const id of ['D', 'E', 'G', 'H']) eng.zetInstrument(id, null);
  eng.deck('F').load(buf, 'een nummer');
  pt.laadSet({ tracks: { 4: [KORT], 5: [KORT], 6: [KORT], 8: [KORT] }, instrumenten: { 7: 'poly',
    4: { soort: 'poly', params: [0.25, 0.5] }, 5: { soort: 'schaal', params: [0.6, null, null, null, null, null, null, 0.9] }, 6: 'fm', 8: 'theremin' } });
  const m0 = meldingen.length;
  const terug = eng.herstelInstrumenten();
  ok('terug op de lege tracks met patronen (D, E); niet op een track met een nummer (F) of zonder patronen (G)',
    terug.join() === 'D,E' && eng.instrumentOp('D')?.soort === 'poly' && eng.instrumentOp('E')?.soort === 'schaal'
    && !eng.instrumentOp('F') && !!eng.deck('F').buffer && !eng.instrumentOp('G'));
  ok('met de knoppen uit de set; wat de set niet weet blijft op zijn standaard',
    dicht(eng.instrumentOp('D').leesParam(1), 0.25) && dicht(eng.instrumentOp('D').leesParam(2), 0.5)
    && dicht(eng.instrumentOp('D').leesParam(3), eng.instrumentOp('D').params[2].standaard) && dicht(eng.instrumentOp('E').leesParam(1), 0.6));
  ok('een gebaar (wrijven op de Schaal) niet: na het laden klinkt er niets vanzelf', eng.instrumentOp('E').leesParam(8) === 0);
  ok('een onbekend instrument: een melding, verder niets', meldingen.slice(m0).some((m) => m.soort === 'fout'
    && /track 8: instrument van de patronen niet terug \(onbekend instrument "theremin"\)/.test(m.tekst)) && !eng.instrumentOp('H'));
  ok('nog eens: niets (er staat al een instrument)', eng.herstelInstrumenten().length === 0);
  ok('de set vult de knoppen aan die hij niet wist (het gebaar blijft null)', pt.onthoudKlank()
    && pt.set.instrumenten['4'].params.length === 8 && pt.set.instrumenten['4'].params[0] === 0.25 && pt.set.instrumenten['5'].params[7] === null);
  ok('… en daarna geen wijziging meer zonder dat er iets gedraaid wordt (geen bewaren om niets)', !pt.onthoudKlank());
  for (const id of ['D', 'E']) eng.zetInstrument(id, null);
}

ok('nergens setValueCurveAtTime', CURVES === 0);
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
