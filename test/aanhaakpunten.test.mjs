// De aanhaakpunten van de werkruimte (14 okt, spoor S0, docs/werkruimte/S0.md):
// mapjes erbij en weg, fragmenten vervangen, de meta-vlaggen voor log en auto-DJ,
// alleenScherm, Deck.tijdlijn(), de aanhakers, het rijenregister, de uitleg per
// spoor en de routes van de server. Alles zonder dat er iets aan het gedrag van
// vandaag verandert: dat toetsen de andere tests (die blijven ongewijzigd groen).
// Draai met: node test/aanhaakpunten.test.mjs
import { deepStrictEqual } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const gelijk = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const WORTEL = fileURLToPath(new URL('..', import.meta.url));

// ---- nep-Web Audio (zoals engine.test: een worklet die zijn berichten bewaart) ----
let NOW = 0;
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
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.start = () => {}; s.stop = () => { queueMicrotask(() => s.onended?.()); }; return s; }
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

const L = await import('../src/control/lagen.js');
const bus = await import('../src/control/actions.js');
const { Mapping, normaliseer, vingerafdruk } = await import('../src/control/mapping.js');
const T = await import('../src/control/terugspelen.js');
const H = await import('../src/control/handelingen.js');
const A = await import('../src/auto/automaat.js');
const { positieIn } = await import('../src/engine/stream-kern.js');

// ---- 1. mapjes: erbij, weg, volgorde -----------------------------------------
console.log('mapjes (lagen.js) en herbindLagen (actions.js)');
const GROEPEN_VOOR = kopie(L.GROEPEN);
const LAAGNAAM_VOOR = kopie(L.LAAGNAAM);
{
  // Wat voegVormMapjeToe vóór 14 okt deed: GROEPEN.device.knoppen.detail = ['vorm'].
  const oud = kopie(GROEPEN_VOOR);
  oud.device.knoppen.detail = ['vorm'];
  L.voegVormMapjeToe();
  ok('voegVormMapjeToe() via voegMapjeToe: GROEPEN deepEqual zoals vroeger', gelijk(kopie(L.GROEPEN), oud));
  ok('… en LAAGNAAM ook (device.vorm stond er al)', gelijk(kopie(L.LAAGNAAM), LAAGNAAM_VOOR));
  L.voegVormMapjeToe();
  ok('nog eens voegVormMapjeToe(): niets erbij (idempotent)', gelijk(kopie(L.GROEPEN), oud));
  ok('haalMapjeWeg(device, vorm): GROEPEN en LAAGNAAM weer precies zoals vóór', L.haalMapjeWeg('device', 'vorm')
    && gelijk(kopie(L.GROEPEN), GROEPEN_VOOR) && gelijk(kopie(L.LAAGNAAM), LAAGNAAM_VOOR));
}
{
  const lagen = new L.Lagen();
  bus.bindLagen(lagen);
  const voor = bus.list().filter((a) => a.id.startsWith('layer.')).map((a) => a.id).sort();
  bus.herbindLagen();
  const na = bus.list().filter((a) => a.id.startsWith('layer.')).map((a) => a.id).sort();
  ok(`herbindLagen() zonder wijziging: dezelfde ${voor.length} layer-actions (idempotent)`, voor.length > 10 && gelijk(voor, na));

  L.voegMapjeToe('device', 'x', { naam: 'proefmapje x', kleur: 'groen' });
  ok('voegMapjeToe zonder herbindLagen: nog geen layer.device.x', !bus.has('layer.device.x'));
  bus.herbindLagen();
  ok('voegMapjeToe + herbindLagen: layer.device.x bestaat, met de naam in het label',
    bus.has('layer.device.x') && /proefmapje x/.test(bus.metaOf('layer.device.x').label) && L.MAPJE_KLEUR['device.x'] === 'groen');
  bus.invoke('layer.device.x', true); bus.invoke('layer.device.x', false);
  ok('layer.device.x indrukken opent het mapje (lagen.actief)', lagen.actief().includes('device.x') && bus.read('layer.device.x') === 1);
  let fout = null;
  try { L.voegMapjeToe('device', 'rack'); } catch (e) { fout = e; }
  ok('een standaardmapje nog eens toevoegen: een fout', !!fout);
  fout = null;
  try { L.voegMapjeToe('bestaatniet', 'x'); } catch (e) { fout = e; }
  ok('een groep die niet bestaat: een fout', !!fout);
  ok('haalMapjeWeg: true, en het open mapje gaat naar de standaard', L.haalMapjeWeg('device', 'x') && lagen.stand.device === 'strip');
  bus.herbindLagen();
  ok('… na herbindLagen is layer.device.x weg van de bus', !bus.has('layer.device.x'));
  ok('… en GROEPEN is weer precies zoals vóór', gelijk(kopie(L.GROEPEN), GROEPEN_VOOR) && gelijk(kopie(L.LAAGNAAM), LAAGNAAM_VOOR));
  ok('haalMapjeWeg van een standaardmapje: false, niets weg', L.haalMapjeWeg('device', 'rack') === false && gelijk(kopie(L.GROEPEN), GROEPEN_VOOR));

  // Onder een bestaande kiesknop en zonder kiesknop.
  L.voegMapjeToe('device', 'y', { kiesknop: 'view', naam: 'y' });
  ok('onder een bestaande kiesknop: achteraan in zijn lijst', gelijk(L.GROEPEN.device.knoppen.view, [...GROEPEN_VOOR.device.knoppen.view, 'y']));
  L.voegMapjeToe('grid', 'leeg', { kiesknop: null, opAanvraag: true });
  bus.herbindLagen();
  ok('zonder kiesknop: geen layer-action, wel OP_AANVRAAG', !bus.has('layer.grid.leeg') && L.OP_AANVRAAG.has('grid.leeg'));
  L.haalMapjeWeg('device', 'y'); L.haalMapjeWeg('grid', 'leeg'); bus.herbindLagen();
  ok('beide weer weg: GROEPEN en OP_AANVRAAG zoals vóór', gelijk(kopie(L.GROEPEN), GROEPEN_VOOR) && !L.OP_AANVRAAG.has('grid.leeg'));

  // Volgorde.
  L.zetVolgorde('grid', ['hotcues', 'stems', 'loops']);
  lagen.zet('grid', 'hotcues');
  bus.invoke('layer.grid.next', true);
  ok('zetVolgorde: ▼ gaat de nieuwe volgorde langs', lagen.stand.grid === 'stems');
  L.zetVolgorde('grid', null);
  ok('zetVolgorde(grid, null) = de oude volgorde', gelijk(L.GROEPEN.grid.volgorde, GROEPEN_VOOR.grid.volgorde));
  fout = null;
  try { L.zetVolgorde('grid', ['hotcues', 'bestaatniet']); } catch (e) { fout = e; }
  ok('een onbekend mapje in de volgorde: een fout, de volgorde blijft', !!fout && gelijk(L.GROEPEN.grid.volgorde, GROEPEN_VOOR.grid.volgorde));
  L.voegMapjeToe('grid', 'zonder', { kiesknop: null });
  L.zetVolgorde('grid', [...GROEPEN_VOOR.grid.volgorde, 'zonder']);
  fout = null;
  try { L.zetVolgorde('grid', GROEPEN_VOOR.grid.volgorde); } catch (e) { fout = e; }
  ok('een mapje zonder kiesknop uit een EIGEN volgorde halen mag (de standaard telt)', !fout);
  L.haalMapjeWeg('grid', 'zonder');
  L.zetVolgorde('device', ['strip', 'rack']);
  bus.herbindLagen();
  ok('een volgorde voor device: layer.device.next/prev erbij', bus.has('layer.device.next') && bus.has('layer.device.prev'));
  L.zetVolgorde('device', null);
  bus.herbindLagen();
  ok('device weer zonder volgorde: next/prev weg, GROEPEN zoals vóór', !bus.has('layer.device.next') && gelijk(kopie(L.GROEPEN), GROEPEN_VOOR));
  const nu = bus.list().filter((a) => a.id.startsWith('layer.')).map((a) => a.id).sort();
  ok('na alles: precies dezelfde layer-actions als in het begin', gelijk(nu, voor));
}

// ---- 2. fragmenten: vervangen en weghalen ------------------------------------
console.log('\nfragmenten (mapping.js)');
{
  const m = new Mapping({ read: () => null, invoke: () => {} });
  m.load({ name: 'proef', device: 'apc40mk2', version: 3, rules: [
    { in: 'note:0:1', action: 'track.1.play', mode: 'trigger' },
    { in: 'note:0:2', action: 'eigen.regel', mode: 'trigger' },
  ] });
  const frag = { version: 3, rules: [
    { in: 'note:0:2', action: 'frag.twee', mode: 'trigger' },       // botst met de eigen regel
    { in: 'note:0:3', action: 'frag.drie', mode: 'trigger' },
    { in: 'note:0:4', action: 'frag.vier', mode: 'trigger', laag: 'device.uitlijn' },
  ] };
  const vanBron = (b) => [...m.rules.values()].filter((r) => r.bron === b).length;
  m.vervangFragment('stuk:proef', frag);
  m.vervangFragment('stuk:proef', frag);
  ok('vervangFragment twee keer: één keer de regels (2, de botsende niet)', vanBron('stuk:proef') === 2 && m.rules.size === 4);
  ok('een eigen regel op dezelfde sleutel wint', m.rules.get('note:0:2').action === 'eigen.regel' && !m.rules.get('note:0:2').bron);
  m.vervangFragment('stuk:proef', { version: 3, rules: [{ in: 'note:0:5', action: 'frag.vijf', mode: 'trigger' }] });
  ok('vervangFragment met andere regels: de oude zijn weg', vanBron('stuk:proef') === 1 && !m.rules.has('note:0:3') && m.rules.has('note:0:5'));
  m.vervangFragment('stuk:ander', { version: 3, rules: [{ in: 'note:0:5', action: 'ander.vijf', mode: 'trigger' }] });
  ok('een tweede fragment op een bezette sleutel vult niet aan', vanBron('stuk:ander') === 0);
  let changes = 0;
  m.on('change', () => changes++);
  ok('haalWeg: het aantal weggehaalde regels', m.haalWeg('stuk:proef') === 1);
  ok('haalWeg laat 0 regels van die bron over, en een afgedekt fragment komt meteen terug',
    vanBron('stuk:proef') === 0 && m.rules.get('note:0:5')?.action === 'ander.vijf' && changes === 1);
  ok('de eigen regels blijven, en fragmenten gaan niet mee in toJSON',
    m.rules.get('note:0:1').action === 'track.1.play' && m.toJSON().rules.length === 2);
  m.haalWeg('stuk:ander');
  ok('haalWeg van een onbekende bron: 0, niets veranderd', m.haalWeg('bestaat-niet') === 0 && m.rules.size === 2);
  const doc = { name: 'p', device: 'apc40mk2', version: 3, rules: [{ in: 'note:0:9', action: 'track.1.cue', mode: 'trigger' }] };
  const metMapjes = { ...doc, mapjes: { nieuw: { 'device.mijndub': { naam: 'dub' } } } };
  ok('een veld "mapjes" in een document telt niet mee (regels, vingerafdruk)',
    gelijk(normaliseer(metMapjes).doc, normaliseer(doc).doc) && vingerafdruk(metMapjes) === vingerafdruk(doc));
}

// ---- 3. meta-vlaggen ----------------------------------------------------------
console.log('\nmeta-vlaggen: log, beginstand, overneem, alleenScherm');
{
  bus.define('proef.overslaan', 'value', () => {}, { log: 'overslaan' });
  bus.define('proef.gewoon', 'value', () => {}, {});
  const { plan } = T.maakPlan([[0.1, 'proef.overslaan', 0.5], [0.2, 'proef.gewoon', 0.5], [0.3, 'layer.grid.next', true]]);
  ok("meta.log = 'overslaan': niet teruggespeeld (de rest wel, OVERSLAAN blijft)", plan.length === 1 && plan[0].a === 'proef.gewoon');
  ok('slaOver met een eigen metaOf', T.slaOver('x.y', () => ({ log: 'overslaan' })) && !T.slaOver('x.y', () => null) && T.slaOver('record.start', () => null));

  bus.define('proef.niet', 'value', () => {}, { read: () => 0.3, beginstand: false });
  bus.define('proef.wel', 'value', () => {}, { read: () => 0.7 });
  const st = H.leesStand({ engine: { focus: null }, tracks: [], herkomst: () => null,
    acties: bus.list().filter((a) => a.id.startsWith('proef.')), lees: bus.read });
  ok('beginstand: false = niet in de beginstand, de rest wel', !('proef.niet' in st.waarden) && st.waarden['proef.wel'] === 0.7);
  const rond = H.leesStand({ engine: { focus: null }, tracks: [], herkomst: () => null,
    acties: [{ id: H.RONDLOPERS[0], type: 'trigger', meta: { beginstand: false } }], lees: () => 1 });
  ok('… ook voor een rondloper', !(H.RONDLOPERS[0] in rond.rond));

  ok('neemtOver: OVERNEEM zoals altijd, een vreemde action niet', A.neemtOver('track.2.fader', () => null)?.nr === 2
    && A.neemtOver('proef.x', () => null) === null);
  ok('neemtOver: meta.overneem op een track = die track, zonder track = alle', A.neemtOver('track.3.iets', () => ({ overneem: true }))?.nr === 3
    && A.neemtOver('super.1', () => ({ overneem: true }))?.nr === null);
  bus.define('track.2.proef.duw', 'value', () => {}, { overneem: true });
  bus.define('track.2.proef.niet', 'value', () => {}, {});
  bus.define('proef.super', 'value', () => {}, { overneem: true });
  const proef = (id) => {
    const au = new A.Automaat({ engine: {}, invoke: bus.invoke, bijInvoke: bus.bijInvoke, laad: async () => true, haalLibrary: async () => [], tik: 1e7 });
    Object.assign(au, { aan: true, fase: 'bezig', hoofd: 'A', volgende: { deckId: 'B' } });
    bus.invoke(id, 0.5);
    const fase = au.fase;
    au.vernietig();
    return fase;
  };
  ok('overneem: true op een track in de overgang: de auto-DJ laat los', proef('track.2.proef.duw') === 'overgenomen');
  ok('zonder overneem: hij gaat door', proef('track.2.proef.niet') === 'bezig');
  ok('overneem: true zonder track: raakt de overgang (zoals de crossfader)', proef('proef.super') === 'overgenomen');

  bus.define('proef.scherm', 'trigger', () => {}, { alleenScherm: true });
  const m = new Mapping({ read: () => null, invoke: () => {}, metaOf: bus.metaOf });
  const geweigerd = [];
  m.on('geweigerd', (l) => geweigerd.push(...l));
  const uit = m.load({ name: 'p', device: 'generic', version: 3, rules: [
    { in: 'note:0:1', action: 'proef.scherm', mode: 'trigger' }, { in: 'note:0:2', action: 'proef.gewoon', mode: 'trigger' }] });
  ok('een regel met een alleenScherm-action wordt bij het laden geweigerd, met een melding',
    !m.rules.has('note:0:1') && m.rules.has('note:0:2') && geweigerd.length === 1 && uit.fouten.length === 1);
  ok('… ook in een fragment en bij koppelen (set geeft null)',
    m.voegToe('f', { version: 3, rules: [{ in: 'note:0:3', action: 'proef.scherm', mode: 'trigger' }] }).aantal === 0
    && m.set('note:0:4', 'proef.scherm') === null && !m.rules.has('note:0:4') && geweigerd.length === 3);
  const zonder = new Mapping({ read: () => null, invoke: () => {} });
  zonder.load({ name: 'p', device: 'generic', version: 3, rules: [{ in: 'note:0:1', action: 'proef.scherm', mode: 'trigger' }] });
  ok('zonder metaOf (de server, de kaarten): niets geweigerd, zoals vroeger', zonder.rules.has('note:0:1'));
  zonder.metaOf = bus.metaOf;
  ok('weigerAlleenScherm daarna: de regel gaat er alsnog uit', zonder.weigerAlleenScherm() === 1 && !zonder.rules.has('note:0:1'));
}

// ---- 4. Deck.tijdlijn() --------------------------------------------------------
console.log('\nDeck.tijdlijn()');
{
  const { Engine } = await import('../src/engine/engine.js');
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
  const eng = new Engine();
  const d = eng.deck('A');
  const buf = renderDemoTrack(eng.ctx, { bars: 4 });
  await d.laadGeheugen(buf, 'tijdlijn');
  d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  const klopt = (wat) => {
    const tl = d.tijdlijn();
    const p = Math.min(positieIn(tl, tl.vorig, NOW), d.duration);
    return { tl, ok: Math.abs(p - d.position) < 1e-9, p };
  };
  const velden = ['segId', 'gridVersie', 'T', 'P', 'R', 'loop', 'rem', 'vorig', 'speelt', 'wacht', 'remt', 'rate'];
  let vorige = d.tijdlijn().segId;
  ok('tijdlijn() heeft de velden van het ontwerp (+ vorig)', gelijk(Object.keys(d.tijdlijn()), velden));
  const stap = (naam, doe, extra = () => true) => {
    doe();
    NOW += 0.37;
    const k = klopt();
    ok(`${naam}: zelfde positie als positieIn (± 1e-9) en een hogere segId`, k.ok && k.tl.segId > vorige && extra(k.tl));
    vorige = k.tl.segId;
  };
  stap('play', () => d.play(), (tl) => tl.speelt && tl.R === 1);
  stap('seek', () => d.seek(2.1));
  stap('loop', () => d.setLoopRange(1, 2), (tl) => tl.loop && tl.loop.start === 1 && tl.loop.end === 2);
  NOW += 1.3;   // de loop gaat rond
  ok('in de loop, na rondgaan: nog steeds gelijk', klopt().ok);
  stap('loop eraf', () => d.clearLoop(), (tl) => tl.loop === null);
  stap('tempo', () => d.setRate(1.05), (tl) => Math.abs(tl.R - 1.05) < 1e-12 && Math.abs(tl.rate - 1.05) < 1e-12);
  stap('pauze', () => d.pause(), (tl) => !tl.speelt);
  stap('weer spelen', () => d.play(), (tl) => tl.speelt);
  stap('rem', () => d.rem(), (tl) => tl.rem && tl.remt);
  NOW += 3;     // de rem is uitgelopen
  ok('na de rem (stilstand): nog steeds gelijk', klopt().ok);
  stap('keylock aan en spelen', () => { d.setKeylock(true); d.play(); });
  const voorSprong = d.tijdlijn().segId;
  d.seek(0.5);
  const tl = d.tijdlijn();
  ok('een sprong met keylock: gepland (T later), vorig speelt tot dan, positieIn = position',
    tl.segId > voorSprong && tl.T > NOW && tl.vorig && Math.abs(positieIn(tl, tl.vorig, NOW) - d.position) < 1e-9);
  NOW += 0.2;
  ok('… en na T: gelijk', klopt().ok);
  const gv = d.tijdlijn().gridVersie;
  d.gridGewijzigd?.();
  ok('gridVersie volgt het deck', d.tijdlijn().gridVersie === d.gridVersie && d.gridVersie >= gv);
  const { BufferBron } = await import('../src/engine/bron.js');
  const b = eng.deck('B');
  b.load(buf, 'reserve');
  ok('BufferBron (de reserve, deck.load): tijdlijn() = null', b.bron instanceof BufferBron && b.tijdlijn() === null);
}

// ---- 5. aanhakers, renderloop, rijen, uitleg -----------------------------------
console.log('\naanhakers, rijen en uitleg');
{
  const { startAanhakers, maakRenderloop, AANHAKERS } = await import('../src/ui/aanhakers.js');
  ok('acht aanhakers in de vaste volgorde', gelijk(AANHAKERS, ['precisie', 'uitlijn', 'werk', 'combi', 'apparaten', 'maschine', 'schermen', 'inrichten']));
  const meldingen = [];
  const ctx = { meld: (t, s) => meldingen.push([t, s]) };
  const warn = console.warn;
  console.warn = () => {};    // de aanhakers schrijven hun fout ook naar de console; hier telt de melding
  const echt = await startAanhakers(ctx);
  ok('de acht lege aanhakers laden en starten, zonder melding', gelijk(echt.gestart, AANHAKERS) && !echt.mislukt.length && !meldingen.length);
  const volgorde = [];
  const nep = await startAanhakers(ctx, { laad: async (naam) => ({
    default: async () => { volgorde.push(naam); if (naam === 'combi') throw new Error('kapot'); if (naam === 'schermen') await new Promise((r) => setTimeout(r, 5)); },
  }) });
  ok('een aanhaker die gooit: één melding, de rest start (in volgorde)', meldingen.length === 1 && /combi/.test(meldingen[0][0])
    && meldingen[0][1] === 'fout' && gelijk(volgorde, AANHAKERS) && nep.gestart.length === 7 && nep.mislukt[0].naam === 'combi');
  meldingen.length = 0;
  const kapot = await startAanhakers(ctx, { laad: async (naam) => { if (naam === 'uitlijn') throw new Error('syntaxfout'); return { default: async () => {} }; } });
  ok('een module die niet laadt: ook één melding', meldingen.length === 1 && kapot.gestart.length === 7);
  meldingen.length = 0;
  const zonder = await startAanhakers(ctx, { laad: async () => ({}) });
  ok('een module zonder opzetfunctie: een melding per aanhaker', meldingen.length === 8 && !zonder.gestart.length);

  const wacht = [];
  const rl = maakRenderloop({ raf: (f) => wacht.push(f), meld: (t) => meldingen.push([t]) });
  ok('renderloop zonder stappen: geen beeld aangevraagd', wacht.length === 0);
  const gezien = [];
  rl.stap('a', (t) => gezien.push(['a', t]));
  rl.stap('b', () => { throw new Error('stuk'); });
  meldingen.length = 0;
  wacht.shift()(16); wacht.shift()(33);
  ok('renderloop: elke stap elk beeld, een stap die gooit één keer gemeld en weg',
    gelijk(gezien, [['a', 16], ['a', 33]]) && meldingen.length === 1 && gelijk(rl.stappen, ['a']));
  console.warn = warn;
  const weg = rl.stap('c', () => {});
  weg();
  ok('stap weghalen', gelijk(rl.stappen, ['a']));

  const R = await import('../src/ui/rijen.js');
  let open = false;
  R.registreerRij('proef', { zet: (o) => { open = o; }, isOpen: () => open });
  R.rij('proef').zet(true);
  ok('rijenregister: zet en isOpen van het paneel zelf', open && R.rij('proef').isOpen() && R.rijNamen().includes('proef') && R.rij('weg') === null);
  // De acht panelen melden zich aan met hun eigen zet (één regel elk).
  const panelen = ['auto', 'beeld', 'instrument', 'klankschaal', 'koptelefoon', 'master', 'stems', 'patronen'];
  const mis = panelen.filter((p) => !new RegExp(`registreerRij\\('${p}', \\{ zet(: zetOpen)?, isOpen: `).test(readFileSync(join(WORTEL, `src/ui/${p}-paneel.js`), 'utf8')));
  ok(`de acht panelen melden zich aan in rijen.js${mis.length ? ` (niet: ${mis.join(', ')})` : ''}`, mis.length === 0);

  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const { beschrijfSpoor } = await import('../src/ui/beschrijf/index.js');
  ok('uitleg: de vijf lege sporen kennen niets, beschrijf() is zoals altijd',
    beschrijfSpoor('track.1.play') === null && beschrijf('track.1.play')?.kort === 'play');
}

// ---- 6. server: routes van de sporen en de witte lijst --------------------------
console.log('\nserver: routes/ en de witte lijst');
{
  const { spoorRoutes, zoekRoute } = await import('../server/routes/index.js');
  // Golf 1 had hier "de drie routebestanden zijn leeg". Een spoor vult zijn eigen bestand (S3:
  // werkruimtes, S5: mapping-apparaat, 14 okt); wat blijft gelden: ze laden in de vaste volgorde,
  // elke route hoort bij een spoor van SPOREN en zit onder /api/.
  const { SPOREN } = await import('../server/routes/index.js');
  const nu = spoorRoutes();
  ok('de routebestanden laden; elke route hoort bij een spoor en zit onder /api/',
    nu.routes.every((r) => SPOREN.some(([n]) => n === r.spoor) && r.pad.source.startsWith('^\\/api\\/')));
  // De witte lijst: S3 had "mag is leeg"; S5 zet er bewust één pagina op (de Maschine-ijkproef,
  // tools/proef/maschine-ijk.html). Wat altijd moet gelden: geen witte-lijstregel zet data open.
  const GEHEIM = ['/media/library.db', '/media/kaart.db', '/server/index.js', '/opnames/set-1.acties.jsonl', '/proef/sessie.json',
    '/standen/x.json', '/patronen/set.json', '/.git/config', '/test/alles.mjs', '/tools/proef/../../media/library.db',
    '/werkruimtes/x.json'];
  ok('… en geen witte-lijstregel die data openzet', !nu.mag.some((m) => GEHEIM.some((g) => m.test(g))));
  // S8 zet er bewust één bestand bij: de top-40 voor de zoeker van ✎ inrichten (data, geen geheim).
  ok('… en op de witte lijst alleen de ijkproef van S5 en de top-40 van S8', nu.mag.every((m) => m.test('/tools/proef/maschine-ijk.html') || m.test('/tools/werkruimtes/top40.json')));
  let fout = null;
  try { spoorRoutes([['kapot', { routes: [{ methode: 'GET', pad: '/api/x', handler: () => {} }], mag: [] }]]); } catch (e) { fout = e; }
  ok('een route zonder RegExp: de server start niet (fout met de naam)', /kapot/.test(fout?.message));
  const r = spoorRoutes([['a', { routes: [{ methode: 'get', pad: /^\/api\/a$/, handler: () => 'a' }], mag: [/^\/a\.html$/] }],
    ['b', { routes: [{ methode: 'GET', pad: /^\/api\/a$/, handler: () => 'b' }], mag: [] }]]);
  ok('vaste volgorde: de eerste wint; de methode in hoofdletters', zoekRoute(r.routes, 'GET', '/api/a')?.spoor === 'a'
    && zoekRoute(r.routes, 'POST', '/api/a') === null && r.mag.length === 1);

  // Een echte server uit een KOPIE van de repo, met een route en een witte-lijstregel in routes/paneel.js.
  const tmp = mkdtempSync(join(tmpdir(), 'varve-aanhaak-'));
  const kopieMap = join(tmp, 'repo');
  for (const p of ['server', 'src', 'mappings', 'racks', 'index.html', 'styles.css']) cpSync(join(WORTEL, p), join(kopieMap, p), { recursive: true });
  writeFileSync(join(kopieMap, 'server/routes/paneel.js'), `export default {
  routes: [
    { methode: 'GET', pad: /^\\/api\\/paneel\\/proef$/, handler: (req, res, ctx) => ctx.json(res, 200, { ok: true, test: ctx.testserver, poort: ctx.POORT }) },
    { methode: 'POST', pad: /^\\/api\\/paneel\\/proef$/, handler: async (req, res, ctx) => ctx.json(res, 200, { terug: await ctx.leesJson(req) }) },
    { methode: 'GET', pad: /^\\/api\\/library$/, handler: (req, res, ctx) => ctx.json(res, 200, { overgenomen: true }) },
  ],
  mag: [/^\\/proef-mag\\.txt$/],
};\n`);
  writeFileSync(join(kopieMap, 'proef-mag.txt'), 'mag');
  writeFileSync(join(kopieMap, 'werk.webmanifest'), '{"name":"VARVE"}');
  mkdirSync(join(tmp, 'media'), { recursive: true });
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(poort), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'media/library.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PROEF: join(tmp, 'proef'),
    VARVE_STANDEN: join(tmp, 'standen'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_HERANALYSE: 'uit' };
  delete env.VARVE_HOSTS;
  const proc = spawn(process.execPath, [join(kopieMap, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (x) => { log += x; }); proc.stderr.on('data', (x) => { log += x; });
  const B = `http://localhost:${poort}`;
  let op = false;
  for (let i = 0; i < 200 && !op; i++) { op = await fetch(`${B}/api/backups`).then((x) => x.ok).catch(() => false); if (!op) await new Promise((z) => setTimeout(z, 100)); }
  ok('de server uit de kopie start', op);
  if (op) {
    const get = (pad) => fetch(B + pad).then(async (x) => ({ code: x.status, type: x.headers.get('content-type'), tekst: await x.text() }));
    const g = await get('/api/paneel/proef');
    ok('een route uit routes/paneel.js antwoordt (vóór de 404), met ctx', g.code === 200 && gelijk(JSON.parse(g.tekst), { ok: true, test: true, poort }));
    const p = await fetch(`${B}/api/paneel/proef`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: '{"a":1}' });
    ok('POST met JSON: de handler leest de body', p.status === 200 && gelijk(await p.json(), { terug: { a: 1 } }));
    const t = await fetch(`${B}/api/paneel/proef`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: B }, body: 'x' });
    ok('POST zonder JSON: 415, de route komt er niet aan (de regel voor alle POST blijft)', t.status === 415);
    const lib = await get('/api/library');
    ok('een bestaande route gaat vóór een spoor (de routes van de sporen komen pas vlak vóór de 404)', lib.code === 200 && !/overgenomen/.test(lib.tekst));
    ok('onbekend eindpunt: nog steeds 404', (await get('/api/paneel/bestaat-niet')).code === 404);
    ok('mag uit routes/: op de witte lijst', (await get('/proef-mag.txt')).tekst === 'mag');
    const wm = await get('/werk.webmanifest');
    ok('werk.webmanifest op de witte lijst, als application/manifest+json', wm.code === 200 && /manifest\+json/.test(wm.type));
    ok('werk.html, uitlijn.html, spiekbrief.html op de witte lijst: zolang ze ontbreken gewoon 404',
      (await Promise.all(['/werk.html', '/uitlijn.html', '/spiekbrief.html'].map(get))).every((x) => x.code === 404 && /niet gevonden/.test(x.tekst)));
    ok('wat niet op de witte lijst staat blijft 404 (werk.json)', (await get('/werk.json')).code === 404);
    const css = await Promise.all(['werk', 'uitlijn', 'panelen'].map((n) => get(`/src/ui/css/${n}.css`)));
    ok('de drie lege stylesheets worden geserveerd', css.every((x) => x.code === 200 && /text\/css/.test(x.type)));
    const html = (await get('/index.html')).tekst;
    const balk = html.indexOf('<div id="werk-balk" hidden></div>'), kop = html.indexOf('</header>');
    const vak = html.indexOf('<section id="werkvak" hidden></section>'), rijen = html.indexOf('<div id="rijen"');
    ok('index.html: werk-balk direct ná de bovenbalk, werkvak direct vóór #rijen, de drie stylesheets',
      kop > 0 && balk > kop && /^<\/header>\s*(<!--[^]*?-->\s*)?<div id="werk-balk"/.test(html.slice(kop))
      && vak > 0 && rijen > vak && /^<section id="werkvak" hidden><\/section>\s*<div id="rijen"/.test(html.slice(vak))
      && ['werk', 'uitlijn', 'panelen'].every((n) => html.includes(`<link rel="stylesheet" href="src/ui/css/${n}.css">`)));
  } else console.log(log);
  proc.kill('SIGINT');
  await new Promise((z) => { proc.on('exit', z); setTimeout(z, 3000); });
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
