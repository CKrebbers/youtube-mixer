// De koppeling met de AV-app-hub (src/control/hub.js, ?hub=ws://…): een nep-WebSocket
// en een nep-klok, de echte MidiHub en Feedback erachter. De conformiteitstoets van de
// hub zelf (in een echte Chromium) staat in tools/headless/hub.mjs.
// Draai met: node test/hub.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// ---- nep-klok: setTimeout/setInterval op een eigen tijdlijn ---------------
const echteTimeout = setTimeout;
const echteWacht = (ms) => new Promise((r) => echteTimeout(r, ms));   // de echte klok, vóór de nep-klok
let nu = 0, volg = 0;
const rij = [];
globalThis.setTimeout = (fn, ms = 0) => { rij.push({ id: ++volg, fn, op: nu + ms }); return volg; };
globalThis.setInterval = (fn, ms) => { rij.push({ id: ++volg, fn, op: nu + ms, elke: ms }); return volg; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => { const i = rij.findIndex((t) => t.id === id); if (i >= 0) rij.splice(i, 1); };
const vooruit = (ms) => {
  const eind = nu + ms;
  for (;;) {
    rij.sort((a, b) => a.op - b.op || a.id - b.id);
    const t = rij[0];
    if (!t || t.op > eind) break;
    nu = t.op;
    if (t.elke) t.op += t.elke; else rij.shift();
    t.fn();
  }
  nu = eind;
};

// Web MIDI mag NOOIT gevraagd worden met de vlag.
let midiGevraagd = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: async () => { midiGevraagd++; throw new Error('niet vragen'); } } });

class NepWS {
  static alle = [];
  constructor(url) { this.url = url; this.readyState = 0; this.uit = []; this.gemaakt = nu; NepWS.alle.push(this); }
  send(s) { this.uit.push(JSON.parse(s)); }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
  open() { this.readyState = 1; this.onopen?.(); }
  krijg(b) { this.onmessage?.({ data: typeof b === 'string' ? b : JSON.stringify(b) }); }
  soort(t) { return this.uit.filter((b) => b.t === t); }
}
const laatste = () => NepWS.alle.at(-1);

const { HubMidi, MANIFEST, PARAMS, WACHT_MS, VERVANGEN_MS } = await import('../src/control/hub.js');
const { hubAdres } = await import('../src/ui/vlag.js');
const { Feedback } = await import('../src/control/feedback.js');
const apc40mk2 = (await import('../src/control/devices/apc40mk2.js')).default;

console.log('de vlag');
ok('?hub=ws://… geeft het adres', hubAdres('http://localhost:8777/?hub=ws://localhost:7700/app') === 'ws://localhost:7700/app');
ok('zonder ?hub= niets', hubAdres('http://localhost:8777/') === null);
ok('?hub= met iets anders dan ws:// of wss:// telt niet', hubAdres('http://localhost:8777/?hub=http://x') === null && hubAdres('http://localhost:8777/?hub=1') === null);

console.log('\nzonder vlag verandert er niets (bron)');
{
  const lees = (p) => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
  const app = lees('ui/app.js'), opzet = lees('ui/midi-opzet.js');
  ok('niemand importeert hub.js statisch (geen byte zonder vlag)', ![app, opzet, lees('ui/vlag.js')].some((s) => /^\s*import\s[^;]*control\/hub\.js/m.test(s)));
  ok('app.js laadt hub.js alleen als hubAdres() iets gaf', /hubUrl \? \{[^}]*await import\('\.\.\/control\/hub\.js'\)/.test(app));
  ok('midi-opzet: zonder hub de gewone MidiHub', /hub \? new hub\.HubMidi\([^)]*\) : new MidiHub\(\)/.test(opzet));
  ok('midi-opzet: zonder hub blijft de Web Lock MIDI bewaken', /if \(!hub\) \{\s*const echteInit = midi\.init\.bind\(midi\);\s*midi\.init = \(\.\.\.a\) => \(isEersteTabblad\(\)/.test(opzet));
}

console.log('\nhet manifest');
ok('lease, rings host, app varve-dj, hb_s 1', MANIFEST.lease === true && MANIFEST.rings === 'host' && MANIFEST.app === 'varve-dj' && MANIFEST.hb_s === 1);
ok('geen action-namen op de draad', MANIFEST.params.every((p) => !('action' in p)));
ok('master -> macro.intensiteit via mixer.master', PARAMS.some((p) => p.id === 'master' && p.rol === 'macro.intensiteit' && p.action === 'mixer.master'));
{
  const hubRepo = process.env.VARVE_HUB_REPO || fileURLToPath(new URL('../../av-app-hub', import.meta.url));
  const pad = `${hubRepo}/src/protocol/manifest.js`;
  if (existsSync(pad)) {
    const { valideerManifest } = await import(pad);
    const v = valideerManifest(MANIFEST);
    ok('geldig volgens de hub (valideerManifest)', v.ok);
  } else console.log('  --  valideerManifest overgeslagen (geen av-app-hub naast deze map; zet VARVE_HUB_REPO)');
}

// ---- de koppeling -----------------------------------------------------------
const stand = { 'mixer.master': 0.8, 'mixer.xfader': 0.5, 'video.master': 1, 'video.pulse': 0 };
const aangeroepen = [];
const invoke = (id, v) => { aangeroepen.push([id, v]); if (id in stand) stand[id] = Math.max(0, Math.min(1, v)); return true; };
const read = (id) => stand[id] ?? null;

const midi = new HubMidi({ url: 'ws://hub.test/app', invoke, read, WS: NepWS });
const feedback = new Feedback({ device: apc40mk2, mapping: { rules: new Map(), vars: () => ({}) }, read, meta: () => null,
  send: (b, o) => midi.send(b, o), sendSysex: (b, o) => midi.sendSysex(b, o) });
let uitvoer = 0, invoer = [];
midi.on('output', (p) => { if (p) { uitvoer++; feedback.init(); } });
midi.onInput((m) => invoer.push(m));

console.log('\nverbinden');
await midi.init();
ok('requestMIDIAccess niet aangeroepen', midiGevraagd === 0);
ok('één verbinding naar het adres uit de vlag', NepWS.alle.length === 1 && laatste().url === 'ws://hub.test/app');
ok('nog geen poort zolang de hub niet antwoordt', midi.output() === null && uitvoer === 0);
laatste().open();
const [h, m, s] = laatste().uit;
ok('eerst hallo (app + inst), dan manifest, dan staat', h?.t === 'hallo' && h.app === 'varve-dj' && !!h.inst && m?.t === 'manifest' && s?.t === 'staat');
ok('staat noemt elke waarde', PARAMS.filter((p) => p.soort !== 'trigger').every((p) => typeof s.waarden[p.id] === 'number'));
ok('staat = wat VARVE nu heeft (master 0,8)', s.waarden.master === 0.8);
ok('de poort heet APC40: het gewone profiel en de LED-laag', midi.output()?.name.includes('APC40') && uitvoer === 1);

console.log('\nLED\'s naar de hub');
vooruit(100);
const led = laatste().soort('led');
ok('LED\'s gebundeld per beeld (meerdere berichten per led)', led.length >= 1 && led.length < 30 && led.every((b) => b.bytes.length >= 1));
ok('init-SysEx niet verstuurd (de hub zet de modus)', midi.ingeslikt === 1 && !led.some((b) => b.bytes.some((x) => x[0] === 0xf0)));
ok('alleen geldige 3-byte LED-berichten', led.every((b) => b.bytes.every((x) => x.length === 3 && [0x80, 0x90, 0xb0].includes(x[0] & 0xf0))));
ok('de veegbeurt komt helemaal aan', led.reduce((n, b) => n + b.bytes.length, 0) === apc40mk2.allLeds().length);

console.log('\nAPC-invoer');
await echteWacht(80);   // het echofilter van MidiHub (60 ms na wat wij stuurden) laten verlopen
const druk = { t: 'midi', dev: 'apc40', bytes: [0x90, 0x5b, 0x7f] };
laatste().krijg(druk);
ok('zonder focus geen invoer', invoer.length === 0);
laatste().krijg({ t: 'focus', aan: true });
laatste().krijg(druk);
ok('met focus: bytes -> MidiHub -> onInput', invoer.length === 1 && invoer[0].sig === 'note:0:91' && invoer[0].on === true);
laatste().krijg({ t: 'focus', aan: false });
laatste().krijg(druk);
laatste().krijg({ t: 'midi', dev: 'apc40', bytes: [0x90, 0x5b, 0x00] });
ok('focus weg: geen nieuwe invoer, loslaten komt nog door', invoer.length === 2 && invoer[1].on === false);
ok('focus weg: niets uitgezet (geen action)', aangeroepen.length === 0);
laatste().krijg({ t: 'focus', aan: true });
laatste().krijg({ t: 'midi', dev: 'lpd8', bytes: [0x90, 1, 1] });
laatste().krijg({ t: 'midi', dev: 'apc40', bytes: [0x90, 999, 1] });
ok('andere apparaten en kapotte bytes: genegeerd', invoer.length === 2);

console.log('\nwaarden van de hub');
laatste().krijg({ t: 'zet', id: 'master', v: 0.25, bron: 'lpd8' });
ok('zet master -> mixer.master over de bus', aangeroepen.at(-1)?.[0] === 'mixer.master' && aangeroepen.at(-1)[1] === 0.25);
laatste().krijg({ t: 'zet', id: 'beeld', v: 7 });
ok('buiten 0..1 wordt geklemd', stand['video.master'] === 1 && aangeroepen.at(-1)[1] === 1);
const voor = aangeroepen.length;
laatste().krijg({ t: 'zet', id: 'bestaat-niet', v: 0.5 });
laatste().krijg({ t: 'zet', id: 'master', v: 'veel' });
laatste().krijg({ t: 'zet', id: 'master', v: NaN });
laatste().krijg({ t: 'trig', id: 'master', aan: true });
laatste().krijg('{kapot');
laatste().krijg('null');
laatste().krijg({ t: 'globaal', waarden: { 'macro.ruimte': 0.5, adem: 0.1 } });
laatste().krijg({ t: 'scene', i: 2 });
laatste().krijg({ t: 'iets-uit-de-toekomst', x: 1 });
laatste().krijg({ t: 'welkom', hub: 'varve-hub', v: 1 });
ok('onbekend, kapot en ongeldig: genegeerd, geen action', aangeroepen.length === voor);
const zetVoor = laatste().soort('zet').length;
vooruit(1000);
ok('wat de hub zette kaatst niet terug', laatste().soort('zet').length === zetVoor);
stand['mixer.xfader'] = 0.9;   // Clay schuift de crossfader (APC of muis)
vooruit(250);
ok('eigen wijziging gaat terug als zet', laatste().soort('zet').some((b) => b.id === 'xfader' && b.v === 0.9));

console.log('\nhartslag');
{
  const ws = laatste();
  const t0 = nu, hb0 = ws.soort('hb').length;
  vooruit(5000);
  ok('elke 0,8 s een hb (hb_s = 1)', ws.soort('hb').length - hb0 >= 6 && nu - t0 === 5000);
}

console.log('\nherverbinden');
{
  const wachttijden = [];
  for (let i = 0; i < 5; i++) {
    const ws = laatste(), t = nu;
    ws.close(1006);
    if (i === 0) ok('verbinding weg: poort weg (mapping laat shift en knoppen los)', midi.output() === null && midi.input() === null);
    vooruit(10000);
    wachttijden.push(laatste().gemaakt - t);
    if (i < 4) laatste().readyState = 0;   // weer niet gelukt
  }
  ok(`0,5 → 1 → 2 → 5 → 5 s (${wachttijden.join(', ')} ms)`, JSON.stringify(wachttijden) === JSON.stringify([...WACHT_MS, 5000]));
  laatste().open();
  ok('terug: opnieuw hallo/manifest/staat en de LED-laag opnieuw', laatste().uit[0].t === 'hallo' && laatste().uit[1].t === 'manifest' && uitvoer === 2);
  ok('focus begint weer uit tot de hub hem geeft', midi.focus === false);
  vooruit(100);
  ok('alle LED\'s opnieuw naar de hub', laatste().soort('led').reduce((n, b) => n + b.bytes.length, 0) >= apc40mk2.allLeds().length);
  let t = nu;
  laatste().close(1006);
  vooruit(600);
  ok('na een gelukte verbinding weer vanaf 0,5 s', laatste().gemaakt - t === 500);
  laatste().open();
  t = nu;
  laatste().close(4001);
  const aantal = NepWS.alle.length;
  vooruit(29000);
  ok('4001 (vervangen door een nieuwer tabblad): niet binnen 29 s', NepWS.alle.length === aantal);
  vooruit(1000);
  ok('4001: na 30 s opnieuw', NepWS.alle.length === aantal + 1 && laatste().gemaakt - t === VERVANGEN_MS);
  laatste().open();
  midi.stop();
  const n = NepWS.alle.length;
  vooruit(60000);
  ok('stop: dicht en geen nieuwe pogingen', NepWS.alle.length === n && laatste().readyState === 3);
}
ok('requestMIDIAccess ook daarna nooit aangeroepen', midiGevraagd === 0);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
