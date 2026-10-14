/**
 * De UITVOER naar de controllers: hoe zwaar is de LED-laag, hoe snel licht een
 * knop op, wordt er iets ingeslikt, en wat kost de Maschine (lampjes, schermen)?
 * Zonder hardware: de ECHTE mapping (mappings/apc40mk2.json), de echte Engine
 * met acht tracks op een nep-Web Audio (zoals de tests), de echte Feedback,
 * MidiHub, HubMidi en Maschine, en nep-poorten die de tijd van elk bericht
 * noteren. Verslag: docs/verslagen/2026-10-14/controller-uitvoer.md.
 *
 * Draai met:  node tools/bench/feedback.mjs [--bron <map>] [--json <bestand>] [--kort] [--knoppen [--rondes N]]
 *   --bron   een andere checkout (bv. een worktree van vóór een wijziging):
 *            de bron (src/, mappings/) komt dan daarvandaan, het harnas blijft dit bestand.
 *   --kort   minder herhalingen (een rookproef, ~15 s)
 *   --knoppen alleen meting 6 (knoppen draaien), met --rondes N rondes per stand (standaard 30)
 *
 * Gemeten:
 *   1. tick     Feedback.tick() in µs (p50/p99/max) en berichten per seconde, in vier
 *               standen: rust (acht tracks geladen, stil), spelen (acht tracks, knipperen
 *               op de tel), mapje loops open (beatloops knipperen), shift vast.
 *               Op een nep-klok: 33 ms audiotijd per tik, de µs zijn echte CPU.
 *   2. direct   ECHTE timers (zoals in Chrome op de voorgrond): een nep-APC op een
 *               MidiHub, de LED-laag zoals midi-opzet.js hem opzet (setInterval 33 ms,
 *               en Feedback.wek op de bus als die bestaat). Drukken op activator (play),
 *               track select (focus, de maatgever knippert) en clip stop (loop, knippert):
 *               vertraging druk -> lampje-byte de deur uit (p50/p99/max), en hoeveel
 *               drukken of loslaten het echofilter inslikte.
 *               Twee nep-APC's: een die niets terugkaatst en een die elke ring-CC na
 *               2 ms terugstuurt (de lus waar het echofilter voor is): komt er een echo door?
 *   3. hub      hetzelfde via HubMidi en een nep-WebSocket: druk -> {t:'led'} met die byte.
 *   4. mapje    een mapje wisselen: hoe lang tot alle lampjes kloppen (direct).
 *   5. maschine Maschine.tik() in µs, schermen per seconde (gerenderd en verstuurd),
 *               lampjes per seconde, en de wachtrij van hub.js, terwijl er gespeeld wordt.
 *   6. knoppen  een endless-knop (track knob 1, cc:0:48 = track.1.filter) draaien, heen
 *               2–6 tikken en terug 0–6, op 4/8/20 ms per tik, via de echte MidiHub, Mapping
 *               en Feedback (met de wektik op de bus als die bestaat). Drie nep-APC's: een
 *               onafhankelijke knop (de ring raakt zijn waarde niet) die gelijk loopt met de
 *               software, dezelfde met de ring één tik ernaast (zo staat hij na het eerste
 *               bericht na het richten, en vaak na een focuswissel), en een knop die de ring-CC als zijn waarde OVERNEEMT (hub-proef V1,
 *               config ringen_nemen_waarde_over). Verloren tikken = |software − bedoeld| per
 *               ronde opgeteld, en wat het echofilter als echo inslikte (review 14 okt).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
const KORT = process.argv.includes('--kort');
const ALLEEN_KNOPPEN = process.argv.includes('--knoppen');
const RONDES = Number(arg('--rondes')) || (KORT ? 8 : 30);
const BRON = resolve(arg('--bron') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const imp = (p) => import(pathToFileURL(join(BRON, p)).href);
const json = (p) => JSON.parse(readFileSync(join(BRON, p), 'utf8'));

// ---- nep-Web Audio (zoals test/patronen-engine.test.mjs) --------------------------------
let NOW = 0;
let klokEcht = null;      // null = NOW, anders t0: currentTime = echte tijd sinds t0
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
  get currentTime() { return klokEcht === null ? NOW : (performance.now() - klokEcht) / 1000; }
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
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// Web MIDI bestaat hier niet: de MidiHub krijgt zijn poorten met de hand.
const warn = console.warn; console.warn = () => {};

const { Engine } = await imp('src/engine/engine.js');
const A = await imp('src/control/actions.js');
const { Mapping } = await imp('src/control/mapping.js');
const { Feedback } = await imp('src/control/feedback.js');
const { MidiHub, parseMessage } = await imp('src/control/midi.js');
const { Lagen } = await imp('src/control/lagen.js');
const { Beatgrid } = await imp('src/engine/beatgrid.js');
const apc = (await imp('src/control/devices/apc40mk2.js')).default;
const STANDAARD = json('mappings/apc40mk2.json');

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- de opstelling: engine met acht tracks, de bus, mapjes, de mapping ---------------------
const eng = new Engine();
A.bindEngine(eng);
const lagen = new Lagen({ beschikbaar: (g, l) => g === 'device' && l === 'inst' && !!eng.instrumentOp(eng.focus) });
A.bindLagen(lagen);
const IDS = A.TRACKS.map(([, id]) => id);
const buf = eng.ctx.createBuffer(2, 48000 * 240, 48000);
for (const id of IDS) {
  const d = eng.deck(id);
  d.load(buf, `track ${id}`);
  d.setGrid(new Beatgrid({ bpm: 120 + IDS.indexOf(id), firstBeat: 0.05 * IDS.indexOf(id) }));
  d.hotcue(0); d.hotcue(1);
}
const maakMapping = () => new Mapping({ read: A.read, invoke: A.invoke, vars: () => ({ focus: A.trackVanDeck(eng.focus) }), lagen: () => lagen.actief() });

// ---- 1. de kosten van één tik ---------------------------------------------------------------
function tikMeting() {
  const mapping = maakMapping();
  mapping.load(STANDAARD);
  let berichten = 0;
  const fb = new Feedback({ device: apc, mapping, read: A.read, meta: A.metaOf, send: () => { berichten++; return true; } });
  fb.init();
  const N = KORT ? 600 : 3000;
  const stand = (naam, voorbereid, na = () => {}) => {
    for (const id of IDS) eng.deck(id).seek(2);   // elke stand vooraan: 99 s per stand, het nummer is 240 s
    voorbereid();
    for (let i = 0; i < 60; i++) { NOW += 0.033; fb.tick(); }       // opwarmen en de beginstand weg
    berichten = 0;
    const us = [];
    for (let i = 0; i < N; i++) {
      NOW += 0.033;
      const t = performance.now();
      fb.tick();
      us.push((performance.now() - t) * 1000);
    }
    na();
    return { stand: naam, p50_us: r1(pct(us, 0.5)), p99_us: r1(pct(us, 0.99)), max_us: r1(Math.max(...us)), berichten_per_s: r1(berichten / (N * 0.033)) };
  };
  const uit = [];
  uit.push(stand('rust (8 tracks geladen, stil)', () => { for (const id of IDS) eng.deck(id).pause?.(); }));
  uit.push(stand('spelen (8 tracks, knipperen op de tel)', () => { for (const id of IDS) { eng.deck(id).seek(2); if (!eng.deck(id).playing) eng.deck(id).play(); } }));
  uit.push(stand('spelen + mapje loops open', () => { lagen.zet('grid', 'loops'); for (const id of IDS) eng.deck(id).setLoop?.(4); },
    () => { lagen.zet('grid', 'hotcues'); for (const id of IDS) eng.deck(id).clearLoop?.(); }));
  const shiftNr = +STANDAARD.shift.split(':')[2];
  uit.push(stand('spelen + shift vast', () => { mapping.handle(parseMessage([0x90, shiftNr, 127])); },
    () => { mapping.handle(parseMessage([0x80, shiftNr, 0])); }));
  return uit;
}

// ---- 2/3/4. echte timers: van druk tot lampje ------------------------------------------------
/** Een nep-APC: ingang en uitgang. `kaats`: elke CC die binnenkomt na 2 ms terug (een ring die terugmeldt). */
function nepApc({ kaats = false } = {}) {
  const uit = [];   // { t, bytes }
  const ingang = { id: 'apc-in', name: 'APC40 mkII', state: 'connected', onmidimessage: null };
  const uitgang = { id: 'apc-uit', name: 'APC40 mkII', state: 'connected',
    send(b) {
      uit.push({ t: performance.now(), b0: b[0], b1: b[1], b2: b[2] });
      if (kaats && (b[0] & 0xf0) === 0xb0) setTimeout(() => ingang.onmidimessage?.({ data: Uint8Array.from(b), timeStamp: performance.now() }), 2);
    } };
  return { ingang, uitgang, uit, stuur: (b) => ingang.onmidimessage?.({ data: Uint8Array.from(b), timeStamp: performance.now() }) };
}

/** De LED-laag zoals midi-opzet.js hem opzet (zonder DOM), op een MidiHub of HubMidi. */
function opzet(midi) {
  const mapping = maakMapping();
  mapping.load(STANDAARD);
  const fb = new Feedback({ device: apc, mapping, read: A.read, meta: A.metaOf, send: (b, o) => midi.send(b, o), sendSysex: (b, o) => midi.sendSysex(b, o) });
  midi.on('output', (p) => { fb.klaar = false; if (p) fb.init(); });
  mapping.on('change', () => { if (fb.klaar) { fb.ringTypes(); fb.invalidate(); } });
  let kaatsDoor = 0;
  const ontvangen = [];
  midi.onInput((msg) => {
    if (msg.type === 'note') ontvangen.push({ ch: msg.channel, noot: msg.number, aan: msg.on });
    if (msg.type === 'cc' && msg.number >= 48 && msg.number <= 55) kaatsDoor++;
    mapping.handle(msg);
  });
  const iv = setInterval(() => fb.tick(), 33);
  const losBus = typeof fb.wek === 'function' ? A.bijInvoke(() => fb.wek()) : null;
  lagen.on?.('change', () => fb.wek?.());
  return { mapping, fb, ontvangen, telling: () => ({ kaatsDoor }), stop: () => { clearInterval(iv); losBus?.(); fb.stop?.(); } };
}

/**
 * Drukken in een vast patroon, elk 40–120 ms ingedrukt:
 *   play     activator van track 2–8 (play aan/uit, eenkleurig lampje)
 *   focus    track select van een andere track (focus, eenkleurig; de maatgever knippert)
 *   loop     clip stop van track 1 (loop aan/uit; een lopende loop knippert)
 *   maat     track select van de maatgever zelf (knippert op de tel; niets verandert,
 *            alleen: komen druk en loslaten aan?)
 * `log` = alle lampjes die de deur uit gingen ({ t, b0, b1, b2 }, op volgorde). De vertraging
 * van een druk: tot het lampje van die knop staat zoals de LED-laag hem na de druk WIL
 * (`wil(ch, noot)`, direct na de action gelezen); stond hij al zo, dan 0.
 * Ingeslikt = gestuurd, maar nooit bij de mapping aangekomen (per soort, druk en los apart).
 */
async function drukken({ stuur, log, wil, ontvangen, duur }) {
  const uitT = (ch, n, na, w) => {
    let voor = null;
    for (const m of log) {
      if ((m.b0 & 0xf0) !== 0x90 || (m.b0 & 0x0f) !== ch || m.b1 !== n) continue;
      if (m.t < na) { voor = m.b2; continue; }
      if (voor === w) return na;          // stond al goed (een knipperend lampje in de goede fase)
      if (m.b2 === w) return m.t;
      voor = m.b2;
    }
    return voor === w ? na : null;
  };
  const SOORTEN = ['play', 'focus', 'loop', 'maat'];
  const lat = Object.fromEntries(SOORTEN.map((s) => [s, []]));
  const slik = Object.fromEntries(SOORTEN.map((s) => [s, { druk: 0, los: 0 }]));
  let zonder = 0, n = 0;
  const zonderPer = {};
  const eind = performance.now() + duur;
  let i = 0, zaad = 12345;
  const r = () => { zaad = (zaad * 1103515245 + 12345) & 0x7fffffff; return zaad / 0x7fffffff; };
  const nrVan = (id) => A.trackVanDeck(id) ?? 1;
  const tel = (ch, noot, aan) => ontvangen.filter((m) => m.ch === ch && m.noot === noot && m.aan === aan).length;
  const knop = async (soort, nr, noot, meten) => {
    const ch = nr - 1;
    const voorDruk = tel(ch, noot, true), voorLos = tel(ch, noot, false);
    const t0 = performance.now();
    stuur([0x90 | ch, noot, 127]);
    const w = wil(ch, noot);
    await wacht(40 + r() * 80);
    stuur([0x80 | ch, noot, 0]);
    await wacht(30 + r() * 60);
    if (tel(ch, noot, true) === voorDruk) slik[soort].druk++;
    if (tel(ch, noot, false) === voorLos) slik[soort].los++;
    if (!meten) return;
    const t = w === undefined ? null : uitT(ch, noot, t0, w);
    if (t === null) { zonder++; zonderPer[soort] = (zonderPer[soort] ?? 0) + 1; } else lat[soort].push(t - t0);
  };
  while (performance.now() < eind) {
    const soort = SOORTEN[i++ % SOORTEN.length];
    n++;
    if (soort === 'play') {
      const nr = 2 + (i % 7);
      await knop('play', nr, 50, true);
      await knop('play', nr, 50, false);   // weer aan: er blijven acht spelende tracks
    } else if (soort === 'focus') {
      const maat = nrVan(eng.syncMaster?.() ?? 'A');
      let nr = (nrVan(eng.focus) % 8) + 1;
      if (nr === maat) nr = (nr % 8) + 1;
      await knop('focus', nr, 51, true);
    } else if (soort === 'loop') {
      await knop('loop', 1, 52, true);
    } else {
      await knop('maat', nrVan(eng.syncMaster?.() ?? 'A'), 51, false);
    }
  }
  await wacht(100);
  const alle = SOORTEN.flatMap((s) => lat[s]);
  const ingeslikt = SOORTEN.reduce((t, s) => t + slik[s].druk + slik[s].los, 0);
  return {
    drukken: n,
    p50_ms: r1(pct(alle, 0.5)), p99_ms: r1(pct(alle, 0.99)), max_ms: r1(Math.max(...alle)),
    play_p50_ms: r1(pct(lat.play, 0.5)), focus_p50_ms: r1(pct(lat.focus, 0.5)), loop_p50_ms: r1(pct(lat.loop, 0.5)),
    zonder_lampje: zonder, zonder_per_soort: zonderPer,
    ingeslikt,
    ingeslikt_per_soort: Object.fromEntries(SOORTEN.filter((s) => slik[s].druk + slik[s].los).map((s) => [s, slik[s]])),
  };
}

function klaarZetten() {
  // Vooraan in het nummer (de tikmeting liet de klok honderden seconden lopen): anders staat
  // een track aan het eind en weigert hij een loop.
  for (const id of IDS) { const d = eng.deck(id); d.clearLoop?.(); d.seek(5 + IDS.indexOf(id)); if (!d.playing) d.play(); }
  eng.deck('A').setLoop?.(4);
  lagen.zet('grid', 'hotcues');
}

async function direct({ kaats }) {
  const apcNep = nepApc({ kaats });
  const midi = new MidiHub();
  midi.access = { inputs: new Map([[apcNep.ingang.id, apcNep.ingang]]), outputs: new Map([[apcNep.uitgang.id, apcNep.uitgang]]) };
  midi.enabled = true; midi.sysex = true;
  midi.inputId = apcNep.ingang.id; midi.outputId = apcNep.uitgang.id;
  const o = opzet(midi);
  let rijMax = 0, rijMaxMapje = 0, inMapje = false;
  const echtSend = midi.send.bind(midi);
  midi.send = (b, op) => { const r = echtSend(b, op); const n = midi._wachtrij.length; if (inMapje) rijMaxMapje = Math.max(rijMaxMapje, n); else rijMax = Math.max(rijMax, n); return r; };
  midi._sync();
  await wacht(300);
  klaarZetten();
  await wacht(300);
  rijMax = 0;   // de init (veegbeurt van 110 en de ringen) telt niet mee
  const tx0 = apcNep.uit.length, t0 = performance.now();
  const wil = (ch, n) => o.fb.desired().get(`note:${ch}:${n}`)?.[2];
  const res = await drukken({ stuur: apcNep.stuur, log: apcNep.uit, wil, ontvangen: o.ontvangen, duur: KORT ? 4000 : 20000 });
  res.berichten_per_s = r1((apcNep.uit.length - tx0) / ((performance.now() - t0) / 1000));
  res.echo_door = o.telling().kaatsDoor;
  res.wachtrij_max = rijMax;
  inMapje = true;
  res.echo_gevangen = midi.echoes;
  // 4. een mapje wisselen: hoe lang tot het laatste lampje van het nieuwe mapje er is
  const mapjes = [];
  let mapjesOntbreekt = 0;
  for (const [laag, terug] of [['loops', 'hotcues'], ['klank', 'hotcues'], ['secties', 'hotcues'], ['sampler', 'hotcues']]) {
    for (let k = 0; k < (KORT ? 2 : 6); k++) {
      await wacht(37 + k * 7);
      // Welke pads moeten door de wissel veranderen (gewild vóór tegen gewild meteen erna), en per
      // pad het EERSTE bericht erna. Vroeger telde elk pad-bericht in 250 ms mee, ook een
      // knipperende loop-pad op de tel: dan zei het maximum niets (review 14 okt).
      const gewild = () => new Map([...o.fb.desired()].filter(([sig]) => /^note:\d+:(\d+)$/.exec(sig)?.[1] < 40).map(([sig, b]) => [+sig.split(':')[2], b[2]]));
      const voorW = gewild();
      const n0 = apcNep.uit.length, t = performance.now();
      A.invoke(`layer.grid.${laag}`, true); A.invoke(`layer.grid.${laag}`, false);
      const naW = gewild();
      const moet = new Set([...naW].filter(([n, v]) => voorW.get(n) !== v).map(([n]) => n));
      for (const n of voorW.keys()) if (!naW.has(n)) moet.add(n);
      await wacht(250);
      const eerst = new Map();
      for (const m of apcNep.uit.slice(n0)) if ((m.b0 & 0xf0) === 0x90 && moet.has(m.b1) && !eerst.has(m.b1)) eerst.set(m.b1, m.t - t);
      mapjes.push(eerst.size ? Math.max(...eerst.values()) : 0);
      mapjesOntbreekt += moet.size - eerst.size;
      A.invoke(`layer.grid.${terug}`, true); A.invoke(`layer.grid.${terug}`, false);
      await wacht(250);
    }
  }
  res.mapje_p50_ms = r1(pct(mapjes, 0.5)); res.mapje_max_ms = r1(Math.max(...mapjes));
  res.mapje_lampjes_nooit = mapjesOntbreekt;   // pads die moesten veranderen maar binnen 250 ms niets kregen
  res.wachtrij_max_mapje = rijMaxMapje;
  o.stop();
  return res;
}

class NepWS {
  constructor() { this.readyState = 0; this.uit = []; NepWS.laatste = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1); }
  send(s) { const b = JSON.parse(s); if (b.t === 'led') this.uit.push({ t: performance.now(), bytes: b.bytes }); }
  close() { this.readyState = 3; }
  krijg(b) { this.onmessage?.({ data: JSON.stringify(b) }); }
}

async function viaHub() {
  const { HubMidi } = await imp('src/control/hub.js');
  const midi = new HubMidi({ url: 'ws://nep/app', invoke: A.invoke, read: A.read, WS: NepWS });
  const o = opzet(midi);
  await midi.init();
  await wacht(300);
  const ws = NepWS.laatste;
  ws.krijg({ t: 'focus', aan: true });
  klaarZetten();
  await wacht(300);
  const stuur = (bytes) => ws.krijg({ t: 'midi', dev: 'apc40', bytes });
  // De bundels plat, met de tijd van hun bundel.
  const log = { *[Symbol.iterator]() { for (const m of ws.uit) for (const x of m.bytes) yield { t: m.t, b0: x[0], b1: x[1], b2: x[2] }; } };
  const wil = (ch, n) => o.fb.desired().get(`note:${ch}:${n}`)?.[2];
  const n0 = ws.uit.length, t0 = performance.now();
  const res = await drukken({ stuur, log, wil, ontvangen: o.ontvangen, duur: KORT ? 4000 : 20000 });
  res.led_berichten_per_s = r1((ws.uit.length - n0) / ((performance.now() - t0) / 1000));
  o.stop(); midi.stop();
  return res;
}

// ---- 5. de Maschine -------------------------------------------------------------------------
async function maschine() {
  const { Maschine } = await imp('src/control/maschine.js');
  const { Noten } = await imp('src/control/noten.js');
  const { HubMidi } = await imp('src/control/hub.js');
  const msScherm = await imp('src/control/maschine-scherm.js');
  const midi = new HubMidi({ url: 'ws://nep/app', invoke: A.invoke, read: A.read, WS: NepWS });
  await midi.init();
  await wacht(50);
  const ws = NepWS.laatste;
  const schermUit = [], ledUit = [];
  ws.send = (s) => {
    const b = JSON.parse(s);
    if (b.t === 'scherm') schermUit.push(performance.now());
    if (b.t === 'led' && b.dev === 'maschine-mk2') ledUit.push({ t: performance.now(), bytes: b.bytes });
  };
  eng.zetInstrument('H', 'poly');
  eng.setFocus('H');
  const noten = new Noten({ engine: eng, read: A.read, invoke: A.invoke });
  const ms = new Maschine({ engine: eng, noten, read: A.read, invoke: A.invoke });
  ms.laadMapping(json('mappings/maschine-mk2.json'));
  const poort = midi.speelPoort('maschine-mk2');
  ms.koppel(poort);
  let standen = 0;
  const echteStand = ms.stand.bind(ms);
  ms.stand = () => { standen++; return echteStand(); };
  const us = [];
  let rijMax = 0;
  // Zoals speelapparaten.js: een tik elke 33 ms.
  const iv = setInterval(() => {
    const t = performance.now();
    ms.tik();
    us.push((performance.now() - t) * 1000);
    rijMax = Math.max(rijMax, midi.uitRij.length);
  }, 33);
  await wacht(300);
  const duur = KORT ? 3000 : 12000;
  const eind = performance.now() + duur;
  const t0 = performance.now();
  const sch0 = schermUit.length, led0 = ledUit.length, st0 = standen;
  us.length = 0;
  const padLat = [], knopLat = [];
  const stuur = (b) => poort.in.onmidimessage?.({ data: Uint8Array.from(b), timeStamp: performance.now() });
  let k = 0;
  while (performance.now() < eind) {
    // Een pad aanslaan: hoe snel is zijn lampje fel (de flits)?
    const pad = 36 + (k % 16);
    const tp = performance.now();
    stuur([0x90, pad, 100]);
    await wacht(25);
    stuur([0x80, pad, 0]);
    await wacht(45 + (k % 5) * 7);
    const l = ledUit.find((m) => m.t >= tp && m.bytes.some((x) => x[0] === 0x90 && x[1] === pad));
    if (l) padLat.push(l.t - tp);
    // Een draaiknop: hoe snel staat de nieuwe waarde op het scherm?
    const tk = performance.now();
    stuur([0xb0, 16 + (k % 4), k % 2 ? 68 : 60]);   // ±60 tellen (relatief, tweecomplement): balk en tekst verschuiven
    await wacht(160);
    const sc = schermUit.find((t) => t >= tk);
    if (sc !== undefined) knopLat.push(sc - tk);
    k++;
  }
  clearInterval(iv);
  const s = (performance.now() - t0) / 1000;
  const res = {
    tik_p50_us: r1(pct(us, 0.5)), tik_p99_us: r1(pct(us, 0.99)), tik_max_us: r1(Math.max(...us)),
    stand_per_s: r1((standen - st0) / s),
    schermen_per_s: r1((schermUit.length - sch0) / s),
    led_bundels_per_s: r1((ledUit.length - led0) / s),
    pad_lampje_p50_ms: r1(pct(padLat, 0.5)), pad_lampje_p99_ms: r1(pct(padLat, 0.99)),
    knop_scherm_p50_ms: r1(pct(knopLat, 0.5)), knop_scherm_p99_ms: r1(pct(knopLat, 0.99)),
    rij_max: rijMax,
  };
  // Los gemeten: stand() + JSON.stringify (wat elke vergelijking kost) en beide schermen tekenen.
  const sj = [], tk = [];
  for (let i = 0; i < (KORT ? 200 : 1000); i++) {
    let t = performance.now(); const st = echteStand(); JSON.stringify(st); sj.push((performance.now() - t) * 1000);
    t = performance.now(); msScherm.tekenScherm(st, 0); msScherm.tekenScherm(st, 1); tk.push((performance.now() - t) * 1000);
  }
  res.stand_json_p50_us = r1(pct(sj, 0.5)); res.twee_schermen_p50_us = r1(pct(tk, 0.5));
  midi.stop();
  eng.zetInstrument('H', null);
  return res;
}

// ---- 6. knoppen draaien ---------------------------------------------------------------------
/**
 * Een endless-knop op cc:0:48 (track.1.filter) draaien via de echte MidiHub, Mapping en
 * Feedback (opzet()). `soort`: 'gelijk' (onafhankelijke knop, de ring staat op zijn waarde),
 * 'naast' (onafhankelijk, de ring één tik ernaast: zo staat hij na het eerste bericht na het
 * richten, dat mapping._endless niet telt, en vaak na een focuswissel), 'overname' (de knop
 * neemt een ring-CC als zijn waarde over: hub-proef V1). Het filter begint in het midden (0,5).
 */
async function draaiKnop({ soort, stap_ms, rondes }) {
  let k = 64;
  const ingang = { id: 'apc-in', name: 'APC40 mkII', state: 'connected', onmidimessage: null };
  const uitgang = { id: 'apc-uit', name: 'APC40 mkII', state: 'connected',
    send(b) { if (soort === 'overname' && b[0] === 0xb0 && b[1] === 48) k = b[2]; } };
  const midi = new MidiHub();
  midi.access = { inputs: new Map([[ingang.id, ingang]]), outputs: new Map([[uitgang.id, uitgang]]) };
  midi.enabled = true; midi.sysex = true; midi.inputId = ingang.id; midi.outputId = uitgang.id;
  const o = opzet(midi);
  midi._sync();
  await wacht(200);
  const stuur = () => ingang.onmidimessage({ data: Uint8Array.from([0xb0, 48, k]), timeStamp: performance.now() });
  A.invoke('track.1.filter', 0.5);   // het filter in het midden (de standaard): ring round(63,5) = 64 = de knop
  await wacht(100);
  stuur();                      // de eerste draai na het richten telt niet (mapping._endless): vooraf, buiten de meting
  await wacht(100);
  if (soort === 'naast') { A.invoke('track.1.filter', 0.5 + 1 / 127); await wacht(100); stuur(); await wacht(100); }
  const e0 = midi.echoes;
  let zaad = 11; const r = () => { zaad = (zaad * 1103515245 + 12345) & 0x7fffffff; return zaad / 0x7fffffff; };
  let verloren = 0, fout = 0, bedoeld = 0, n = 0;
  for (let ronde = 0; ronde < rondes; ronde++) {
    const start = A.read('track.1.filter');
    const heen = 2 + Math.floor(r() * 5), terug = Math.floor(r() * 7);
    const richting = r() < 0.5 ? 1 : -1;
    let netto = 0;
    for (let i = 0; i < heen + terug; i++) {
      const s = (i < heen ? 1 : -1) * richting;
      if (k + s < 1 || k + s > 126) continue;   // niet tegen de aanslag (daar geldt een eigen regel)
      k += s; netto += s; n++;
      stuur();
      await wacht(stap_ms);
    }
    await wacht(150);
    const echt = Math.round((A.read('track.1.filter') - start) * 127);
    bedoeld += Math.abs(netto);
    if (echt !== netto) { fout++; verloren += Math.abs(echt - netto); }
  }
  o.stop();
  return { soort, stap_ms, berichten: n, bedoeld_netto: bedoeld, tikken_verloren: verloren, rondes_fout: fout, rondes, ingeslikt_als_echo: midi.echoes - e0 };
}

async function knoppen() {
  const uit = [];
  for (const soort of ['gelijk', 'naast', 'overname']) {
    for (const stap_ms of [4, 8, 20]) uit.push(await draaiKnop({ soort, stap_ms, rondes: RONDES }));
  }
  return uit;
}

// ---- alles ----------------------------------------------------------------------------------
const uitslag = { bron: BRON, node: process.version, kort: KORT };
console.log(`bron: ${BRON}${KORT ? ' (kort)' : ''}`);
if (!ALLEEN_KNOPPEN) {
console.log('\n1. Feedback.tick (nep-klok, 33 ms per tik)');
uitslag.tick = tikMeting();
for (const t of uitslag.tick) console.log(`  ${t.stand.padEnd(40)} p50 ${t.p50_us} µs  p99 ${t.p99_us} µs  max ${t.max_us} µs  ${t.berichten_per_s} berichten/s`);

klokEcht = performance.now() - NOW * 1000;
console.log('\n2. direct (MidiHub, echte timers): druk -> lampje');
uitslag.direct = await direct({ kaats: false });
console.log('  ', JSON.stringify(uitslag.direct));
console.log('   nep-APC die elke ring-CC terugkaatst:');
uitslag.kaatst = await direct({ kaats: true });
console.log('  ', JSON.stringify(uitslag.kaatst));
console.log('\n3. via de hub (HubMidi, nep-WebSocket): druk -> {t:"led"}');
uitslag.hub = await viaHub();
console.log('  ', JSON.stringify(uitslag.hub));
console.log('\n5. Maschine (HubMidi, nep-WebSocket)');
uitslag.maschine = await maschine();
console.log('  ', JSON.stringify(uitslag.maschine));
} else {
  klokEcht = performance.now() - NOW * 1000;
  for (const id of IDS) { const d = eng.deck(id); d.seek(5); if (!d.playing) d.play(); }
}
console.log('\n6. knoppen draaien (endless, cc:0:48 = track.1.filter): verloren tikken');
uitslag.knoppen = await knoppen();
for (const k of uitslag.knoppen) console.log('  ', JSON.stringify(k));
console.warn = warn;
const uitBestand = arg('--json');
if (uitBestand) writeFileSync(uitBestand, JSON.stringify(uitslag, null, 2));
process.exit(0);
