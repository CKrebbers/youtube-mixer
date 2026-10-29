// De koppeling met de AV-app-hub (src/control/hub.js, ?hub=ws://…): een nep-WebSocket en een
// nep-klok (ook die van een verborgen tabblad: timers alleen op hele seconden of minuten), met de
// echte MidiHub, Indeling en Lampjes erachter. Met de echte hub en echte Chrome: tools/proef-hub.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SCHERM_BYTES, SCHERM_MS,
  HubMidi, MANIFEST, PARAMS, WACHT_MS, VERVANGEN_MS, STABIEL_MS, OPEN_MS, BEELD_MS, HB_MS, POORT_NAAM,
} from '../src/control/hub.js';
import { hubAdres, hubGeweigerd, isLokaleHost } from '../src/control/hub-vlag.js';
import { Indeling } from '../src/control/indeling.js';
import { Lampjes } from '../src/control/lampjes.js';
import apc, { INIT } from '../src/control/apparaten/apc40mk2.js';
import { maakBus, nepApc } from './control-hulp.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const SRC = join(HIER, '..', 'src');

// ---- nep-klok: timers op een eigen tijdlijn ------------------------------------------------
// `uitlijn` > 0 doet na wat Chrome in een verborgen, stil tabblad doet: timers lopen alleen op
// hele veelvouden daarvan (1000 ms, na 5 min 60 000 ms).
class Klok {
  constructor() { this.t = 0; this.uitlijn = 0; this.rij = []; this.id = 0; this.nu = () => this.t; }
  _lijn(op) { return this.uitlijn ? Math.ceil(op / this.uitlijn) * this.uitlijn : op; }
  get timers() {
    const zet = (fn, ms, elke) => { this.rij.push({ id: ++this.id, fn, op: this._lijn(this.t + Math.max(0, ms || 0)), elke }); return this.id; };
    const wis = (id) => { const i = this.rij.findIndex((x) => x.id === id); if (i >= 0) this.rij.splice(i, 1); };
    return { setTimeout: (f, ms) => zet(f, ms, 0), setInterval: (f, ms) => zet(f, ms, ms), clearTimeout: wis, clearInterval: wis };
  }
  loop(ms) {
    const eind = this.t + ms;
    for (;;) {
      this.rij.sort((a, b) => a.op - b.op || a.id - b.id);
      const x = this.rij[0];
      if (!x || x.op > eind) break;
      this.t = Math.max(this.t, x.op);
      if (x.elke) x.op = this._lijn(x.op + x.elke); else this.rij.shift();
      x.fn();
    }
    this.t = eind;
  }
}

/** Een nep-WebSocket die alles bijhoudt. `klok` geeft de tijd van elk bericht. */
function maakWS(klok) {
  return class NepWS {
    static alle = [];
    static get laatste() { return NepWS.alle.at(-1); }
    constructor(url) { this.url = url; this.readyState = 0; this.uit = []; this.uitT = []; this.gemaakt = klok.nu(); NepWS.alle.push(this); }
    send(s) { this.uit.push(JSON.parse(s)); this.uitT.push(klok.nu()); }
    close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
    open() { this.readyState = 1; this.onopen?.(); }
    krijg(b) { this.onmessage?.({ data: typeof b === 'string' ? b : JSON.stringify(b) }); }
    soort(t) { return this.uit.filter((b) => b.t === t); }
  };
}

/** Een bus met de bekende acties plus die van het beeld (src/beeld/acties.js) en een log. */
function busMetBeeld() {
  const { bus, log, waarden } = maakBus({ stand: { 'mixer.master': 0.8, 'mixer.xfader': 0.5 } });
  const beeld = { 'video.master': 1, 'video.pulse': 0, 'video.black.hold': 0 };
  const def = (id, soort) => bus.defineer({ id, soort, doe: (v, _n, { bron }) => { log.push([id, v, bron]); beeld[id] = soort === 'trigger' ? (v ? 1 : 0) : v; }, lees: () => beeld[id] });
  def('video.master', 'waarde'); def('video.pulse', 'waarde'); def('video.black.hold', 'trigger');
  return { bus, log, waarden, beeld };
}

const standaard = JSON.parse(readFileSync(join(HIER, '..', 'indelingen', 'apc40mk2.json'), 'utf8'));

/** HubMidi met de echte Indeling en Lampjes erachter, zoals ui/controllers.js het opzet. */
function opzet() {
  const klok = new Klok();
  const NepWS = maakWS(klok);
  const { bus, log, waarden, beeld } = busMetBeeld();
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => 1 }, nu: klok.nu, bron: 'apc' });
  ind.voegToe(standaard);
  const hm = new HubMidi({ url: 'ws://hub.test/app', bus, WS: NepWS, klok: klok.nu, timers: klok.timers, inst: 'proef1' });
  const naar = [];   // alles wat de lampjes naar de "APC" stuurden (vóór de wachtrij)
  const l = new Lampjes({ indeling: ind, stuur: (b, o) => { naar.push([...b]); return hm.stuur(b, o); }, stuurSysex: (b) => { naar.push([...b]); return hm.stuurSysex(b); },
    nu: klok.nu, timers: klok.timers });
  const ev = { verbonden: 0, weg: 0, hub: [], bericht: [] };
  hm.on('verbonden', () => { ev.verbonden++; l.init(); });
  hm.on('weg', () => { ev.weg++; ind.losgekoppeld(); l.klaar = false; });
  hm.on('hub', (h) => ev.hub.push({ ...h }));
  hm.on('bericht', (m) => { ev.bericht.push(m); const g = apc.ontleed(m); if (g) ind.verwerk(g); });
  return { klok, NepWS, bus, log, waarden, beeld, ind, hm, l, naar, ev };
}

/** Tot er een nieuwe socket is (of max ms): de wachttijd tot de volgende poging. */
const volgende = (o, max = 60000) => {
  const n = o.NepWS.alle.length, t = o.klok.t;
  while (o.NepWS.alle.length === n && o.klok.t - t < max) o.klok.loop(10);
  return o.NepWS.laatste.gemaakt - t;
};
/** Grootste gat tussen twee berichten naar de hub vanaf `vanaf`. */
const gat = (ws, vanaf) => { const t = ws.uitT.filter((x) => x >= vanaf); let g = 0; for (let i = 1; i < t.length; i++) g = Math.max(g, t[i] - t[i - 1]); return g; };

// ---- de vlag --------------------------------------------------------------------------------

test('vlag: ?hub=ws://… geeft het adres; zonder, of met iets anders dan ws/wss, niets', () => {
  assert.equal(hubAdres('?hub=ws://localhost:7700/app'), 'ws://localhost:7700/app');
  assert.equal(hubAdres(''), null);
  assert.equal(hubAdres('?vormen=1'), null);
  assert.equal(hubAdres('?hub=http://localhost:7700/app'), null);
  assert.equal(hubAdres('?hub=1'), null);
  assert.equal(hubAdres(new URLSearchParams({ hub: 'wss://varve.tail1234.ts.net/app' })), 'wss://varve.tail1234.ts.net/app');
});

test('vlag: deze machine, het LAN en de tailnet mogen; een vreemde host alleen met &hub_extern=1', () => {
  const met = (hub, extra = '') => hubAdres(`?hub=${encodeURIComponent(hub)}${extra}`);
  const lokaal = ['ws://localhost:7700/app', 'ws://127.0.0.1:7700/app', 'ws://[::1]:7700/app', 'ws://192.168.1.20:7700/app', 'ws://10.0.0.5:7700/app',
    'ws://172.20.1.1:7700/app', 'ws://100.101.102.103:7700/app', 'wss://varve.tail1234.ts.net/app', 'ws://clay-mac.local:7700/app'];
  for (const u of lokaal) assert.equal(met(u), u, u);
  const vreemd = ['ws://ergens-anders.example/app', 'ws://8.8.8.8:7700/app', 'ws://192.169.1.1/app', 'ws://172.32.0.1/app', 'ws://100.128.0.1/app', 'ws://localhost.example.com/app'];
  for (const u of vreemd) assert.equal(met(u), null, u);
  assert.equal(met(vreemd[0], '&hub_extern=1'), vreemd[0]);
  assert.equal(hubGeweigerd(`?hub=${encodeURIComponent(vreemd[0])}`), vreemd[0], 'geweigerd: voor de melding');
  assert.equal(hubGeweigerd('?hub=ws://localhost:7700/app'), null);
  assert.equal(hubGeweigerd(''), null);
  assert.ok(isLokaleHost('LOCALHOST') && !isLokaleHost(''));
});

// ---- zonder vlag geen byte van hub.js ----------------------------------------------------------

test('zonder vlag: niemand importeert hub.js statisch; controllers.js alleen dynamisch, en de vlag zelf importeert niets', () => {
  const alle = (map) => readdirSync(map).flatMap((f) => { const p = join(map, f); return statSync(p).isDirectory() ? alle(p) : f.endsWith('.js') ? [p] : []; });
  const statisch = [];
  for (const pad of alle(SRC)) {
    const tekst = readFileSync(pad, 'utf8');
    if (/^\s*import\s[^;()]*?['"][^'"]*\/hub\.js['"]/m.test(tekst) || /^\s*export\s[^;]*from\s*['"][^'"]*\/hub\.js['"]/m.test(tekst)) statisch.push(pad.slice(SRC.length + 1));
  }
  assert.deepEqual(statisch, [], `statisch geïmporteerd door ${statisch.join(', ')}`);
  const ctl = readFileSync(join(SRC, 'ui', 'controllers.js'), 'utf8');
  assert.match(ctl, /import\(['"]\.\.\/control\/hub\.js['"]\)/, 'controllers.js laadt hub.js dynamisch');
  assert.equal([...readFileSync(join(SRC, 'control', 'hub-vlag.js'), 'utf8').matchAll(/^\s*import\s/gm)].length, 0, 'hub-vlag.js importeert niets');
  for (const html of ['index.html']) {
    const p = join(HIER, '..', html);
    if (existsSync(p)) assert.ok(!/control\/hub\.js/.test(readFileSync(p, 'utf8')), `${html} laadt hub.js niet`);
  }
});

/** De controllers zoals app.js ze opzet, zonder venster: indelingen meegegeven, nep-navigator. */
async function controllers({ zoek, locks = undefined }) {
  const { opzetControllers } = await import('../src/ui/controllers.js');
  const { bus, log } = busMetBeeld();
  const klok = new Klok();
  const NepWS = maakWS(klok);
  const midi = { gevraagd: 0 };
  const { toegang, i } = nepApc();
  const nav = { locks, requestMIDIAccess: async () => { midi.gevraagd++; return toegang; } };
  let geladen = 0;
  const meldingen = [];
  const ctl = opzetControllers({
    bus, vars: { focus: () => 1 }, meld: (t, s, k) => meldingen.push({ t, s, k }), nav, venster: null, doc: null, zoek,
    indelingen: { apc40mk2: standaard, toetsen: JSON.parse(readFileSync(join(HIER, '..', 'indelingen', 'toetsen.json'), 'utf8')) },
    WS: NepWS, laadHub: () => { geladen++; return import('../src/control/hub.js'); },
  });
  for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 5));
  await ctl.geladen;
  return { ctl, bus, log, NepWS, midi, apcIn: i, meldingen, get geladen() { return geladen; } };
}

test('zonder ?hub=: Web MIDI zoals altijd, hub.js niet geladen, geen WebSocket', async () => {
  const c = await controllers({ zoek: '' });
  try {
    assert.equal(c.midi.gevraagd, 1);
    assert.equal(c.geladen, 0, 'laadHub nooit aangeroepen');
    assert.equal(c.NepWS.alle.length, 0);
    assert.equal(c.ctl.hub?.constructor.name, 'MidiHub');
    assert.equal(c.ctl.status().hub, null);
  } finally { c.ctl.stop(); }
});

test('met ?hub=: geen requestMIDIAccess, ook als dit het TWEEDE tabblad is (de lock beslist niets over MIDI)', async () => {
  // Een lock die altijd bezet is: dit tabblad wordt 'tweede'.
  const bezet = { request: (naam, a, b) => { if (typeof a === 'object' && a.ifAvailable) b(null); return new Promise(() => {}); } };
  const c = await controllers({ zoek: '?hub=ws%3A%2F%2Flocalhost%3A7700%2Fapp', locks: bezet });
  try {
    assert.equal(c.midi.gevraagd, 0, 'requestMIDIAccess nooit');
    assert.equal(c.geladen, 1);
    assert.equal(c.ctl.status().tabblad, 'tweede');
    assert.equal(c.NepWS.alle.length, 1);
    assert.equal(c.NepWS.laatste.url, 'ws://localhost:7700/app');
    assert.equal(c.ctl.hub.constructor.name, 'HubMidi');
    assert.ok(!c.meldingen.some((m) => /ander VarveDJ-tabblad praat/.test(m.t)), 'geen melding over de lock');
    c.NepWS.laatste.open();
    assert.equal(c.ctl.status().controller, POORT_NAAM);
    assert.equal(c.ctl.status().hub.verbonden, true);
    // Met focus: de activator van strip 1 -> track.1.play via de standaardindeling, bron 'apc'.
    c.NepWS.laatste.krijg({ t: 'focus', aan: true });
    c.NepWS.laatste.krijg({ t: 'midi', dev: 'apc40', bytes: [0x90, 50, 127] });
    c.NepWS.laatste.krijg({ t: 'midi', dev: 'apc40', bytes: [0x80, 50, 0] });
    assert.deepEqual(c.log.filter(([id]) => id === 'track.1.play'), [['track.1.play', true, 'apc'], ['track.1.play', false, 'apc']]);
    // Een APC via Web MIDI bestaat hier niet eens: de nep-APC wordt niet gelezen.
    c.apcIn.stuur([0x90, 51, 127]);
    assert.equal(c.log.filter(([id]) => id === 'track.2.play').length, 0);
  } finally { c.ctl.stop(); }
});

test('met een vreemde ?hub=: een melding en gewoon Web MIDI', async () => {
  const c = await controllers({ zoek: `?hub=${encodeURIComponent('ws://ergens.example/app')}` });
  try {
    assert.equal(c.geladen, 0);
    assert.equal(c.midi.gevraagd, 1);
    assert.ok(c.meldingen.some((m) => m.k === 'ctl:hub' && m.s === 'fout' && /ergens\.example/.test(m.t) && /hub_extern/.test(m.t)));
  } finally { c.ctl.stop(); }
});

// ---- het manifest ---------------------------------------------------------------------------

test('manifest: lease, ringen van ons, varve-dj, hb_s 1, geen action-namen op de draad', () => {
  assert.equal(MANIFEST.lease, true);
  assert.equal(MANIFEST.rings, 'host');
  assert.equal(MANIFEST.app, 'varve-dj');
  assert.equal(MANIFEST.hb_s, 1);
  assert.equal(MANIFEST.truth, 'app');
  assert.ok(MANIFEST.params.every((p) => !('action' in p)));
  assert.deepEqual(MANIFEST.speelt, ['maschine-mk2'], 'v2 speelt de Maschine (sinds 29 okt), de Xboard nog niet');
  assert.ok(!('levert' in MANIFEST), 'geen sectie: v2 heeft nog geen SectieLezer');
});

test('manifest: rollen alleen op het beeld (K2 = video.master met slew, K4 = video.pulse); master en crossfader zonder rol; paniek', () => {
  const rol = (r) => PARAMS.find((p) => p.rol === r);
  assert.equal(rol('macro.helderheid')?.action, 'video.master');
  assert.equal(rol('macro.helderheid')?.slew_s, 0.25);
  assert.equal(rol('macro.beweging')?.action, 'video.pulse');
  assert.equal(rol('macro.intensiteit'), undefined, 'K1 niet aan het audiovolume (v1: dip 0,80 -> 0,43)');
  assert.ok(PARAMS.filter((p) => p.rol).every((p) => p.action.startsWith('video.')));
  for (const id of ['master', 'xfader']) assert.ok(PARAMS.some((p) => p.id === id && !p.rol && !('slew_s' in p)), id);
  assert.ok(PARAMS.every((p) => !('slew_s' in p) || !!p.rol), 'de hub laat alleen rol-zets glijden');
  assert.ok(PARAMS.some((p) => p.id === 'paniek' && p.soort === 'trigger' && p.action === 'video.black.hold'));
});

test('manifest: geldig volgens de hub zelf (valideerManifest), als AV-app-hub op deze machine staat', async (t) => {
  const gezet = process.env.VARVE_HUB_REPO;
  const kandidaten = gezet ? [gezet] : [join(HIER, '../../../../AV-app-hub'), join(HIER, '../../../../av-app-hub'), join(HIER, '../../../av-app-hub')];
  const repo = kandidaten.find((p) => existsSync(join(p, 'src/protocol/manifest.js')));
  if (!repo) {
    if (gezet) assert.fail(`VARVE_HUB_REPO=${gezet} bevat geen src/protocol/manifest.js`);
    t.skip('geen AV-app-hub gevonden (zet VARVE_HUB_REPO)');
    return;
  }
  const { valideerManifest } = await import(pathToFileURL(join(repo, 'src/protocol/manifest.js')).href);
  const v = valideerManifest(structuredClone(MANIFEST));
  assert.ok(v.ok, JSON.stringify(v.fouten ?? v));
});

// ---- de koppeling ---------------------------------------------------------------------------

test('verbinden: pas bij start(), eerst hallo, dan manifest, dan staat; dan de poort "APC40 mkII (hub)"', () => {
  const o = opzet();
  assert.equal(o.NepWS.alle.length, 0, 'de constructor verbindt nog niet');
  o.hm.start();
  assert.equal(o.NepWS.alle.length, 1);
  assert.equal(o.NepWS.laatste.url, 'ws://hub.test/app');
  assert.equal(o.hm.uitvoer(), null, 'geen poort zolang de hub niet antwoordt');
  assert.equal(o.ev.verbonden, 0);
  o.NepWS.laatste.open();
  const [h, m, s] = o.NepWS.laatste.uit;
  assert.deepEqual(h, { t: 'hallo', app: 'varve-dj', inst: 'proef1', v: 1 });
  assert.equal(m.t, 'manifest');
  assert.deepEqual(m.manifest, JSON.parse(JSON.stringify(MANIFEST)));
  assert.equal(s.t, 'staat');
  assert.deepEqual(s.waarden, { master: 0.8, xfader: 0.5, beeld: 1, puls: 0 }, 'wat VarveDJ nu heeft, elke niet-trigger');
  assert.equal(o.hm.uitvoer()?.name, POORT_NAAM);
  assert.ok(apc.zoek.test(POORT_NAAM), 'past op het APC-profiel');
  assert.equal(o.ev.verbonden, 1);
  assert.equal(o.hm.status().hub.verbonden, true);
  o.hm.stop();
});

test('LED\'s: init-SysEx ingeslikt, de rest per beeld gebundeld als {t:\'led\'}, alles komt aan in volgorde', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(200);
  const led = ws.soort('led');
  assert.equal(o.naar[0].join(','), INIT.join(','), 'de lampjes stuurden de init');
  assert.equal(o.hm.ingeslikt, 1);
  assert.ok(!led.some((b) => b.bytes.some((x) => x[0] === 0xf0)), 'geen SysEx naar de hub');
  assert.ok(led.length >= 1 && led.length < 30, `${led.length} bundels`);
  assert.ok(led.every((b) => b.dev === undefined && b.bytes.every((x) => x.length === 3 && [0x80, 0x90, 0xb0].includes(x[0] & 0xf0))));
  assert.deepEqual(led.flatMap((b) => b.bytes), o.naar.slice(1), 'elk lampje van de lampjes, in volgorde');
  // Hooguit één bundel per BEELD_MS.
  const t = ws.uit.map((b, i) => (b.t === 'led' ? ws.uitT[i] : null)).filter((x) => x !== null);
  assert.ok(t.every((x, i) => i === 0 || x - t[i - 1] >= BEELD_MS), t.join(' '));
  o.hm.stop();
});

test('LED\'s: voorflank — na stilte meteen (0 ms), binnen een beeld wachten tot BEELD_MS na de vorige bundel', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(500);
  const n0 = ws.soort('led').length, t0 = o.klok.t;
  o.hm.stuur([0x90, 0x20, 5]);
  o.klok.loop(0);
  const eerste = ws.soort('led').slice(n0);
  assert.deepEqual(eerste.map((b) => b.bytes), [[[0x90, 0x20, 5]]]);
  assert.equal(ws.uitT.at(-1), t0);
  o.klok.loop(3); o.hm.stuur([0x90, 0x21, 5]); o.hm.stuur([0x90, 0x22, 5]);
  o.klok.loop(BEELD_MS - 4);
  assert.equal(ws.soort('led').length, n0 + 1, 'het volgende binnen een beeld wacht');
  o.klok.loop(1);
  const tweede = ws.soort('led').slice(n0 + 1);
  assert.equal(tweede.length, 1);
  assert.equal(tweede[0].bytes.length, 2, 'samen in één bundel');
  assert.equal(ws.uitT.at(-1) - t0, BEELD_MS);
  // Iets wat geen lampje is gaat niet naar de hub.
  o.hm.stuur([0x90, 0x20]);
  o.klok.loop(50);
  assert.equal(o.hm.geweigerd, 1);
  o.hm.stop();
});

test('APC-invoer: alleen met focus; loslaten komt altijd door; andere apparaten en kapotte bytes genegeerd', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(200);
  const druk = { t: 'midi', dev: 'apc40', bytes: [0x90, 50, 127] };
  ws.krijg(druk);
  assert.equal(o.ev.bericht.length, 0, 'zonder focus geen invoer');
  ws.krijg({ t: 'focus', aan: true });
  assert.equal(o.hm.focus, true);
  ws.krijg(druk);
  assert.equal(o.ev.bericht.length, 1);
  assert.equal(o.ev.bericht[0].sig, 'noot:0:50');
  assert.deepEqual(o.log.filter(([id]) => id === 'track.1.play'), [['track.1.play', true, 'apc']], 'via de indeling naar de bus');
  ws.krijg({ t: 'focus', aan: false });
  ws.krijg({ t: 'midi', dev: 'apc40', bytes: [0x90, 51, 127] });
  ws.krijg({ t: 'midi', dev: 'apc40', bytes: [0x90, 50, 0] });
  assert.equal(o.ev.bericht.length, 2, 'focus weg: geen nieuwe druk, het loslaten wel');
  assert.equal(o.ev.bericht[1].aan, false);
  ws.krijg({ t: 'midi', dev: 'apc40', bytes: [0x80, 50, 0] });
  assert.equal(o.ev.bericht.length, 3, 'note off ook');
  ws.krijg({ t: 'focus', aan: true });
  ws.krijg({ t: 'midi', dev: 'lpd8', bytes: [0x90, 1, 1] });
  ws.krijg({ t: 'midi', dev: 'xboard49', bytes: [0x90, 60, 100] });
  ws.krijg({ t: 'midi', dev: 'apc40', bytes: [0x90, 999, 1] });
  ws.krijg({ t: 'midi', dev: 'apc40' });
  assert.equal(o.ev.bericht.length, 3);
  assert.ok(o.ev.hub.some((h) => h.focus === true) && o.ev.hub.some((h) => h.focus === false), 'de focus staat in de status');
  o.hm.stop();
});

test('waarden van de hub over de bus (bron hub), geklemd, niet terugkaatsen; eigen wijzigingen gaan terug als zet', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(300);
  ws.krijg({ t: 'zet', id: 'master', v: 0.25, bron: 'cockpit' });
  assert.deepEqual(o.log.at(-1), ['mixer.master', 0.25, 'hub']);
  ws.krijg({ t: 'zet', id: 'beeld', v: 7, bron: 'lpd8' });
  assert.deepEqual(o.log.at(-1), ['video.master', 1, 'hub']);
  ws.krijg({ t: 'zet', id: 'puls', v: 0.4 });
  assert.equal(o.beeld['video.pulse'], 0.4);
  const voor = o.log.length;
  for (const b of [{ t: 'zet', id: 'bestaat-niet', v: 0.5 }, { t: 'zet', id: 'master', v: 'veel' }, { t: 'zet', id: 'master', v: null },
    { t: 'trig', id: 'master', aan: true }, '{kapot', 'null', '42', { t: 'globaal', waarden: { adem: 0.1 } }, { t: 'scene', i: 2 },
    { t: 'welkom', hub: 'varve-hub', v: 1, kan: ['scherm-bin'] }, { t: 'iets-uit-de-toekomst' }]) ws.krijg(b);
  assert.equal(o.log.length, voor, 'onbekend, kapot en ongeldig: geen actie');
  const zetVoor = ws.soort('zet').length;
  o.klok.loop(1000);
  assert.equal(ws.soort('zet').length, zetVoor, 'wat de hub zette kaatst niet terug');
  o.bus.doe('mixer.xfader', 0.9);   // Clay schuift de crossfader (APC of muis)
  o.klok.loop(250);
  assert.ok(ws.soort('zet').some((b) => b.id === 'xfader' && b.v === 0.9));
  assert.equal(ws.soort('zet').filter((b) => b.id === 'xfader').length, 1, 'één keer');
  o.klok.loop(1000);
  assert.equal(ws.soort('zet').filter((b) => b.id === 'xfader').length, 1, 'niet elke tik opnieuw');
  o.hm.stop();
});

test('paniek (LPD8 P1): trig -> video.black.hold aan/uit, de audio blijft; een zet op de trigger doet niets', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  const voor = o.log.length;
  ws.krijg({ t: 'trig', id: 'paniek', aan: true });
  ws.krijg({ t: 'trig', id: 'paniek', aan: false });
  ws.krijg({ t: 'zet', id: 'paniek', v: 1 });
  assert.deepEqual(o.log.slice(voor), [['video.black.hold', true, 'hub'], ['video.black.hold', false, 'hub']]);
  o.hm.stop();
});

test('paniek ingedrukt en de verbinding valt weg: wij laten zelf los', () => {
  const o = opzet();
  o.hm.start();
  o.NepWS.laatste.open();
  o.NepWS.laatste.krijg({ t: 'trig', id: 'paniek', aan: true });
  assert.equal(o.beeld['video.black.hold'], 1);
  const voor = o.log.length;
  o.NepWS.laatste.close(1006);
  assert.deepEqual(o.log.slice(voor), [['video.black.hold', false, 'hub']]);
  assert.equal(o.beeld['video.black.hold'], 0);
  o.hm.stop();
});

test('een actie die de bus niet kent (geen beeld): de hub crasht niet, en meldt het als fout', () => {
  const klok = new Klok();
  const NepWS = maakWS(klok);
  const { bus } = maakBus();
  const hm = new HubMidi({ url: 'ws://x/app', bus, WS: NepWS, klok: klok.nu, timers: klok.timers });
  const fouten = [];
  hm.on('fout', (f) => fouten.push(f));
  hm.start();
  NepWS.laatste.open();
  assert.equal(NepWS.laatste.uit[2].waarden.beeld, 1, 'staat: de standaard als de bus het niet kent');
  NepWS.laatste.krijg({ t: 'trig', id: 'paniek', aan: true });
  assert.equal(fouten.length, 1);
  hm.stop();
});

test('hartslag op de voorgrond: nooit meer dan 0,8 s stil, ook na een bericht tussen twee tikken', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(1000);
  const t0 = o.klok.t, hb0 = ws.soort('hb').length;
  o.klok.loop(5000);
  assert.ok(ws.soort('hb').length - hb0 >= 6, `${ws.soort('hb').length - hb0} hb in 5 s`);
  o.klok.loop(50); o.hm.stuur([0x90, 0x30, 1]); o.klok.loop(20);
  const t2 = o.klok.t;
  o.klok.loop(3000);
  const g = gat(ws, t2 - 20);
  assert.ok(g > 0 && g <= HB_MS + 200, `grootste gat ${g} ms`);
  assert.ok(gat(ws, t0) <= HB_MS + 200);
  o.hm.stop();
});

test('hartslag in een verborgen tabblad: timers 1×/s -> toch elke ≤ 1 s; na 5 min (1×/min) houdt de adem van de hub hem gaande', () => {
  const o = opzet();
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(1000);
  o.klok.uitlijn = 1000;
  o.klok.loop(1000 - (o.klok.t % 1000));
  let t1 = o.klok.t;
  o.klok.loop(20000);
  assert.ok(gat(ws, t1) > 0 && gat(ws, t1) <= 1000, `timers 1×/s: grootste gat ${gat(ws, t1)} ms (stil na 3 s)`);
  // Na 5 min verborgen: timers 1×/min. De hub stuurt `globaal` (adem) ~10×/s; WebSocket-events worden niet geknepen.
  o.klok.uitlijn = 60000;
  o.klok.loop(60000 - (o.klok.t % 60000));
  t1 = o.klok.t;
  for (let i = 0; i < 1200; i++) { o.klok.loop(100); ws.krijg({ t: 'globaal', waarden: { adem: (i % 100) / 100 } }); }
  assert.ok(gat(ws, t1) > 0 && gat(ws, t1) <= HB_MS + 100, `timers 1×/min: grootste gat ${gat(ws, t1)} ms`);
  o.klok.uitlijn = 0;
  o.hm.stop();
});

test('herverbinden: 0,5 → 1 → 2 → 5 → 5 s; terug: alles opnieuw; na 3 s stabiel weer vanaf 0,5 s', () => {
  const o = opzet();
  o.hm.start();
  o.NepWS.laatste.open();
  o.klok.loop(STABIEL_MS + 100);
  o.ind.verwerk({ control: apc.shift, soort: 'druk', waarde: 1 });   // shift vast, zoals Clay hem vasthoudt
  assert.equal(o.ind.shift, true);
  o.NepWS.laatste.close(1006);
  assert.equal(o.hm.uitvoer(), null);
  assert.equal(o.hm.invoer(), null);
  assert.equal(o.ev.weg, 1, "'weg' -> indeling.losgekoppeld(): shift en alles wat vastzat los");
  assert.equal(o.ind.shift, false);
  const wachttijden = [];
  for (let i = 0; i < 5; i++) {
    wachttijden.push(volgende(o));
    if (i < 4) o.NepWS.laatste.close(1006);
  }
  assert.deepEqual(wachttijden, [...WACHT_MS, 5000]);
  const leds0 = o.naar.length;
  o.NepWS.laatste.open();
  assert.deepEqual(o.NepWS.laatste.uit.slice(0, 3).map((b) => b.t), ['hallo', 'manifest', 'staat']);
  assert.equal(o.NepWS.laatste.uit[0].inst, 'proef1', 'dezelfde inst: een netwerkhapering, geen herstart');
  assert.equal(o.ev.verbonden, 2, 'de lampjes opnieuw (init)');
  assert.equal(o.hm.focus, false, 'focus begint weer uit tot de hub hem geeft');
  o.klok.loop(200);
  assert.deepEqual(o.NepWS.laatste.soort('led').flatMap((b) => b.bytes), o.naar.slice(leds0 + 1), 'alle lampjes opnieuw naar de hub');
  o.klok.loop(STABIEL_MS);
  o.NepWS.laatste.close(1006);
  assert.equal(volgende(o), 500);
  o.hm.stop();
});

test('open en meteen weer dicht (bv. 1008): de wachttijd loopt op, geen lus van 0,5 s', () => {
  const o = opzet();
  o.hm.start();
  o.NepWS.laatste.close(1006);
  volgende(o);   // 0,5 s
  const kort = [];
  for (let i = 0; i < 5; i++) {
    o.NepWS.laatste.open();
    o.NepWS.laatste.krijg({ t: 'welkom', hub: 'varve-hub', v: 1 });
    o.klok.loop(200);
    o.NepWS.laatste.close(1008);
    kort.push(volgende(o));
  }
  assert.deepEqual(kort, [1000, 2000, 5000, 5000, 5000]);
  o.hm.stop();
});

test(`een socket die in CONNECTING blijft hangen: na ${OPEN_MS / 1000} s zelf dicht, dan de gewone wachttijd`, () => {
  const o = opzet();
  o.hm.start();
  const hangt = o.NepWS.laatste;
  const t0 = o.klok.t;
  const w = volgende(o);
  assert.equal(hangt.readyState, 3);
  assert.equal(w, OPEN_MS + WACHT_MS[0]);
  assert.equal(o.NepWS.laatste.gemaakt - t0, w);
  // Een late open van de opgegeven socket doet niets meer.
  hangt.readyState = 1; hangt.onopen?.();
  assert.equal(hangt.uit.length, 0);
  o.hm.stop();
});

test('4001 (vervangen door een nieuwer tabblad): gemeld, 30 s wachten, weer stabiel = melding weg', () => {
  const o = opzet();
  o.hm.start();
  o.NepWS.laatste.open();
  o.klok.loop(STABIEL_MS + 100);
  const m0 = o.ev.hub.filter((h) => h.vervangen).length;
  o.NepWS.laatste.krijg({ t: 'fout', reden: 'vervangen: een nieuwere varve-dj is verbonden' });
  o.NepWS.laatste.close(4001);
  const t = o.klok.t;
  assert.equal(o.hm.status().hub.vervangen, true);
  assert.equal(o.ev.hub.filter((h) => h.vervangen).length > m0, true, 'gemeld aan de schermlaag');
  const aantal = o.NepWS.alle.length;
  o.klok.loop(VERVANGEN_MS - 1000);
  assert.equal(o.NepWS.alle.length, aantal, 'niet binnen 29 s');
  o.klok.loop(1000);
  assert.equal(o.NepWS.alle.length, aantal + 1);
  assert.equal(o.NepWS.laatste.gemaakt - t, VERVANGEN_MS);
  // Nog steeds vervangen: weer 30 s, en geen nieuwe 'vervangen'-wissel.
  const wissels = () => o.ev.hub.reduce((n, h, i, a) => n + (i > 0 && h.vervangen !== a[i - 1].vervangen ? 1 : 0), 0);
  const w0 = wissels();
  o.NepWS.laatste.open();
  o.NepWS.laatste.krijg({ t: 'fout', reden: 'vervangen: nog steeds' });
  o.NepWS.laatste.close(4001);
  assert.equal(wissels(), w0, 'geen nieuwe melding');
  o.klok.loop(VERVANGEN_MS);
  o.NepWS.laatste.open();
  assert.equal(o.hm.status().hub.vervangen, true, 'pas na een STABIELE verbinding weg');
  o.klok.loop(STABIEL_MS);
  assert.equal(o.hm.status().hub.vervangen, false);
  assert.equal(o.ev.hub.at(-1).vervangen, false);
  assert.equal(o.hm.status().hub.verbonden, true);
  o.hm.stop();
});

test('stop: dicht, geen nieuwe pogingen, geen timers meer', () => {
  const o = opzet();
  o.hm.start();
  o.NepWS.laatste.open();
  o.klok.loop(1000);
  o.hm.stop();
  o.l.stop();
  const n = o.NepWS.alle.length;
  o.klok.loop(60000);
  assert.equal(o.NepWS.alle.length, n);
  assert.equal(o.NepWS.laatste.readyState, 3);
  assert.equal(o.klok.rij.length, 0, `nog ${o.klok.rij.length} timers`);
});

// ---- de Maschine MK2 (PROTOCOL §17) ---------------------------------------------------------

test('Maschine: eigen poort, buiten de APC; invoer zonder focus door; weg = disconnected met statechange', () => {
  const o = opzet();
  const m = o.hm.speelPoort('maschine-mk2');
  assert.ok(m && m.in && m.uit && m.scherm);
  assert.equal(o.hm.speelPoort('xboard49'), null);
  const binnen = [];
  const staat = [];
  m.in.onmidimessage = (e) => binnen.push([...e.data]);
  m.in.onstatechange = (e) => staat.push(e.port.state);
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  assert.equal(m.in.state, 'connected');
  assert.ok(![...o.hm.toegang.inputs.values()].includes(m.in), 'de MidiHub van de APC ziet de Maschine nooit');
  ws.krijg({ t: 'midi', dev: 'maschine-mk2', bytes: [0x90, 36, 100] });   // zonder focus
  ws.krijg({ t: 'midi', dev: 'maschine-mk2', bytes: [0xb0, 16, 3] });
  ws.krijg({ t: 'midi', dev: 'maschine-mk2', bytes: [0x90, 300, 1] });   // kapot
  assert.deepEqual(binnen, [[0x90, 36, 100], [0xb0, 16, 3]]);
  assert.equal(o.ev.bericht.length, 0, 'niets ervan bij de APC-indeling');
  ws.close(1006);
  assert.deepEqual(staat, ['connected', 'disconnected']);
  o.hm.stop();
});

test('Maschine: lampjes per beeld gebundeld met dev; schermen: alleen het nieuwste, hooguit één per 40 ms', () => {
  const o = opzet();
  const m = o.hm.speelPoort('maschine-mk2');
  o.hm.start();
  const ws = o.NepWS.laatste;
  ws.open();
  o.klok.loop(100);
  ws.uit.length = 0;
  m.uit.send([0x90, 36, 5]);
  m.uit.send([0x91, 24, 21]);
  m.uit.send([0xf0, 1, 0xf7]);   // geen lampje
  o.klok.loop(20);
  const leds = ws.soort('led').filter((b) => b.dev === 'maschine-mk2');
  assert.deepEqual(leds, [{ t: 'led', dev: 'maschine-mk2', bytes: [[0x90, 36, 5], [0x91, 24, 21]] }]);
  assert.equal(o.hm.status().hub.speelt['maschine-mk2'].geweigerd, 1);
  const beeld = (v) => new Uint8Array(SCHERM_BYTES).fill(v);
  assert.equal(m.scherm(0, beeld(1)), true);
  assert.equal(m.scherm(0, beeld(2)), true);
  assert.equal(m.scherm(1, beeld(3)), true);
  assert.equal(m.scherm(2, beeld(0)), false, 'alleen scherm 0 en 1');
  assert.equal(m.scherm(0, new Uint8Array(10)), false, 'precies 2048 bytes');
  o.klok.loop(1);
  let s = ws.soort('scherm');
  assert.equal(s.length, 2, 'per scherm één beeld');
  assert.equal(atob(s.find((x) => x.nr === 0).data).charCodeAt(0), 2, 'het nieuwste beeld');
  m.scherm(0, beeld(4));
  o.klok.loop(SCHERM_MS - 10);
  assert.equal(ws.soort('scherm').length, 2, 'binnen 40 ms na het vorige: wachten');
  o.klok.loop(20);
  s = ws.soort('scherm');
  assert.equal(s.length, 3);
  assert.equal(s[2].dev, 'maschine-mk2');
  o.hm.stop();
});
