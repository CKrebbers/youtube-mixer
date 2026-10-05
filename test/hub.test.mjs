// De koppeling met de AV-app-hub (src/control/hub.js, ?hub=ws://…): een nep-WebSocket
// en een nep-klok, de echte MidiHub en Feedback erachter. De conformiteitstoets van de
// hub zelf (in een echte Chromium) staat in tools/headless/hub.mjs.
// Draai met: node test/hub.test.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// ---- nep-klok: setTimeout/setInterval op een eigen tijdlijn ---------------
// `uitlijn` > 0 doet na wat Chrome in een verborgen, stil tabblad doet: timers
// lopen dan alleen op hele veelvouden daarvan (1000 ms, na 5 min 60 000 ms).
const echteTimeout = setTimeout;
const echteWacht = (ms) => new Promise((r) => echteTimeout(r, ms));   // de echte klok, vóór de nep-klok
let nu = 0, volg = 0, uitlijn = 0;
const lijn = (op) => (uitlijn ? Math.ceil(op / uitlijn) * uitlijn : op);
const rij = [];
globalThis.setTimeout = (fn, ms = 0) => { rij.push({ id: ++volg, fn, op: lijn(nu + ms) }); return volg; };
globalThis.setInterval = (fn, ms) => { rij.push({ id: ++volg, fn, op: lijn(nu + ms), elke: ms }); return volg; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => { const i = rij.findIndex((t) => t.id === id); if (i >= 0) rij.splice(i, 1); };
const vooruit = (ms) => {
  const eind = nu + ms;
  for (;;) {
    rij.sort((a, b) => a.op - b.op || a.id - b.id);
    const t = rij[0];
    if (!t || t.op > eind) break;
    nu = t.op;
    if (t.elke) t.op = lijn(t.op + t.elke); else rij.shift();
    t.fn();
  }
  nu = eind;
};

// Web MIDI mag NOOIT gevraagd worden met de vlag.
let midiGevraagd = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: async () => { midiGevraagd++; throw new Error('niet vragen'); } } });

class NepWS {
  static alle = [];
  constructor(url) { this.url = url; this.readyState = 0; this.uit = []; this.uitT = []; this.gemaakt = nu; NepWS.alle.push(this); }
  send(s) { this.uit.push(JSON.parse(s)); this.uitT.push(nu); }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
  open() { this.readyState = 1; this.onopen?.(); }
  krijg(b) { this.onmessage?.({ data: typeof b === 'string' ? b : JSON.stringify(b) }); }
  soort(t) { return this.uit.filter((b) => b.t === t); }
}
const laatste = () => NepWS.alle.at(-1);

const { HubMidi, MANIFEST, PARAMS, WACHT_MS, VERVANGEN_MS, STABIEL_MS, OPEN_MS } = await import('../src/control/hub.js');
const { hubAdres, hubGeweigerd } = await import('../src/ui/vlag.js');
const { Feedback } = await import('../src/control/feedback.js');
const apc40mk2 = (await import('../src/control/devices/apc40mk2.js')).default;

console.log('de vlag');
ok('?hub=ws://… geeft het adres', hubAdres('http://localhost:8777/?hub=ws://localhost:7700/app') === 'ws://localhost:7700/app');
ok('zonder ?hub= niets', hubAdres('http://localhost:8777/') === null);
ok('?hub= met iets anders dan ws:// of wss:// telt niet', hubAdres('http://localhost:8777/?hub=http://x') === null && hubAdres('http://localhost:8777/?hub=1') === null);
{
  const met = (hub, extra = '') => hubAdres(`http://localhost:8777/?hub=${encodeURIComponent(hub)}${extra}`);
  const lokaal = ['ws://127.0.0.1:7700/app', 'ws://[::1]:7700/app', 'ws://192.168.1.20:7700/app', 'ws://10.0.0.5:7700/app',
    'ws://172.20.1.1:7700/app', 'ws://100.101.102.103:7700/app', 'wss://varve.tail1234.ts.net/app', 'ws://clay-mac.local:7700/app'];
  ok('deze machine, het LAN en de tailnet: toegestaan', lokaal.every((u) => met(u) === u));
  const vreemd = ['ws://ergens-anders.example/app', 'ws://8.8.8.8:7700/app', 'ws://192.169.1.1/app', 'ws://172.32.0.1/app', 'ws://localhost.example.com/app'];
  ok('een vreemde host: geweigerd', vreemd.every((u) => met(u) === null));
  ok('… tenzij bewust met &hub_extern=1', met(vreemd[0], '&hub_extern=1') === vreemd[0]);
  ok('hubGeweigerd noemt het geweigerde adres (voor de melding)', hubGeweigerd(`http://x/?hub=${encodeURIComponent(vreemd[0])}`) === vreemd[0]
    && hubGeweigerd('http://x/?hub=ws://localhost:7700/app') === null && hubGeweigerd('http://x/') === null);
}

console.log('\nzonder vlag geen byte van hub.js');
{
  // Het gedrag zonder vlag (gewone MidiHub, geen WebSocket, hub.js niet geladen)
  // toetst tools/headless/hub.mjs in een echte Chromium. Hier alleen de regel:
  // niemand importeert hub.js statisch.
  const map = fileURLToPath(new URL('../src/', import.meta.url));
  const statisch = [];
  for (const d of ['ui', 'control', 'engine', 'video', 'auto', 'plan', 'controle', 'analysis', 'vormen', 'lib', 'opname']) {
    if (!existsSync(map + d)) continue;
    for (const f of readdirSync(map + d).filter((x) => x.endsWith('.js'))) {
      if (/^\s*import\s[^;]*['"][./]*(control\/)?hub\.js['"]/m.test(readFileSync(`${map}${d}/${f}`, 'utf8'))) statisch.push(`${d}/${f}`);
    }
  }
  ok(`niemand importeert hub.js statisch${statisch.length ? ` (${statisch.join(', ')})` : ''}`, statisch.length === 0);
  // De speelapparaten (Xboard49, Maschine) laden ook alleen met de vlag: app.js haalt
  // ui/speelapparaten.js dynamisch binnen; alleen die keten importeert de rest statisch.
  const MAG = { 'ui/speelapparaten.js': ['maschine'], 'control/maschine.js': ['maschine-scherm', 'devices/maschine-mk2'] };
  const fout = [];
  for (const d of ['ui', 'control', 'control/devices', 'engine', 'video', 'auto', 'plan', 'controle', 'analysis', 'vormen', 'lib', 'opname']) {
    if (!existsSync(map + d)) continue;
    for (const f of readdirSync(map + d).filter((x) => x.endsWith('.js'))) {
      const tekst = readFileSync(`${map}${d}/${f}`, 'utf8');
      for (const m of tekst.matchAll(/^\s*import\s[^;]*?['"]([^'"]*(speelapparaten|maschine-scherm|devices\/maschine-mk2|\/maschine)\.js)['"]/gm)) {
        const doel = m[1].replace(/^.*?((devices\/)?[\w-]+)\.js$/, '$1');
        if (!(MAG[`${d}/${f}`] ?? []).includes(doel)) fout.push(`${d}/${f} -> ${m[1]}`);
      }
    }
  }
  ok(`speelapparaten.js, maschine.js en maschine-scherm.js: nergens statisch geladen buiten hun eigen keten${fout.length ? ` (${fout.join(', ')})` : ''}`, fout.length === 0);
}

console.log('\nhet manifest');
ok('lease, rings host, app varve-dj, hb_s 1', MANIFEST.lease === true && MANIFEST.rings === 'host' && MANIFEST.app === 'varve-dj' && MANIFEST.hb_s === 1);
ok('geen action-namen op de draad', MANIFEST.params.every((p) => !('action' in p)));
// Een LPD8-knop volgt met zijn pickup de EERSTE app met die rol (PROTOCOL §10), en
// andere apps gebruiken macro.intensiteit als beeldintensiteit: het audio-eindvolume
// mag aan geen enkele rol hangen (K1 gaf een dip van 0,80 naar 0,43 midden in een set).
ok('geen audio-action aan een LPD8-rol (alleen beeld)', PARAMS.filter((p) => p.rol).every((p) => p.action.startsWith('video.')));
ok('master en crossfader: wel in de cockpit, zonder rol', ['master', 'xfader'].every((id) => PARAMS.some((p) => p.id === id && !p.rol)));
ok('geen slew_s zonder rol (de hub laat alleen rol-zets glijden)', PARAMS.every((p) => !('slew_s' in p) || !!p.rol));
ok('paniek = trigger op video.black.hold', PARAMS.some((p) => p.id === 'paniek' && p.soort === 'trigger' && p.action === 'video.black.hold'));
ok('speelt: de Xboard49 en de Maschine MK2 (PROTOCOL §17), alleen met lease', JSON.stringify(MANIFEST.speelt) === '["xboard49","maschine-mk2"]' && MANIFEST.lease === true);
{
  const gezet = process.env.VARVE_HUB_REPO;
  const hubRepo = gezet || fileURLToPath(new URL('../../av-app-hub', import.meta.url));
  const pad = `${hubRepo}/src/protocol/manifest.js`;
  if (existsSync(pad)) {
    const { valideerManifest } = await import(pad);
    const v = valideerManifest(MANIFEST);
    ok(`geldig volgens de hub (valideerManifest)${v.ok ? '' : `: ${JSON.stringify(v.fouten ?? v)}`}`, v.ok);
  } else if (gezet) ok(`VARVE_HUB_REPO=${gezet} bevat geen src/protocol/manifest.js`, false);
  else console.log('  --  valideerManifest overgeslagen (geen av-app-hub naast deze map; zet VARVE_HUB_REPO)');
}

// ---- de koppeling -----------------------------------------------------------
const stand = { 'mixer.master': 0.8, 'mixer.xfader': 0.5, 'video.master': 1, 'video.pulse': 0, 'video.black.hold': 0 };
const aangeroepen = [];
const invoke = (id, v) => { aangeroepen.push([id, v]); if (id in stand) stand[id] = Math.max(0, Math.min(1, Number(v))); return true; };
const read = (id) => stand[id] ?? null;

const midi = new HubMidi({ url: 'ws://hub.test/app', invoke, read, WS: NepWS, klok: () => nu });
const hubMeldingen = [];
midi.on('hub', (h) => hubMeldingen.push({ ...h }));
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

console.log('\npaniek (LPD8 P1)');
{
  const voor = aangeroepen.length;
  laatste().krijg({ t: 'trig', id: 'paniek', aan: true });
  const na1 = aangeroepen.slice(voor);
  ok('trig paniek aan:true -> precies invoke(video.black.hold, true)', JSON.stringify(na1) === JSON.stringify([['video.black.hold', true]]));
  laatste().krijg({ t: 'trig', id: 'paniek', aan: false });
  const na2 = aangeroepen.slice(voor);
  ok('aan:false -> invoke(video.black.hold, false): de schakelaar beslist weer', JSON.stringify(na2) === JSON.stringify([['video.black.hold', true], ['video.black.hold', false]]));
  ok('de audio blijft onaangeroerd (geen mixer.*/track.*)', !na2.some(([id]) => !id.startsWith('video.')));
  laatste().krijg({ t: 'zet', id: 'paniek', v: 1 });
  ok('een zet op de trigger doet niets', aangeroepen.length === voor + 2);
}

console.log('\nspeelapparaten (PROTOCOL §17)');
{
  const ws = laatste();
  const xb = midi.speelPoort('xboard49'), mm = midi.speelPoort('maschine-mk2');
  ok('eigen nep-poorten: "Xboard49 (hub)" (alleen een ingang), "Maschine MK2 (hub)" (ingang, uitgang, scherm)',
    xb?.in.name === 'Xboard49 (hub)' && xb.uit === null && xb.scherm === null && mm?.in.name === 'Maschine MK2 (hub)' && typeof mm.uit.send === 'function' && typeof mm.scherm === 'function'
    && midi.speelPoort('apc40') === null);
  ok('niet in de lijst van de MidiHub: de APC-mapping en het echofilter zien ze nooit', midi.ports().inputs.length === 1 && midi.ports().outputs.length === 1);
  ok('verbonden zolang de hub verbonden is', xb.in.state === 'connected' && mm.in.state === 'connected' && mm.uit.state === 'connected');
  const xIn = [], mIn = [];
  let standen = 0;
  xb.in.onmidimessage = (e) => xIn.push([...e.data]);
  mm.in.onmidimessage = (e) => mIn.push([...e.data]);
  xb.in.onstatechange = () => standen++;
  const apcVoor = invoer.length;
  ws.krijg({ t: 'focus', aan: false });
  ws.krijg({ t: 'midi', dev: 'xboard49', bytes: [0x90, 60, 100] });
  ws.krijg({ t: 'midi', dev: 'maschine-mk2', bytes: [0x90, 36, 100] });
  ws.krijg({ t: 'midi', dev: 'xboard49', bytes: [0xf0, 0x7f, 0x7f, 0x04, 0x01, 0, 0x40, 0xf7] });
  ws.krijg({ t: 'midi', dev: 'maschine-mk2', bytes: [0x91, 39, 127] });
  ok('routering per dev: elk naar zijn eigen poort, ook ZONDER APC-focus (de hub beslist wie speelt), SysEx van de schuif ook',
    JSON.stringify(xIn) === '[[144,60,100],[240,127,127,4,1,0,64,247]]' && JSON.stringify(mIn) === '[[144,36,100],[145,39,127]]');
  ok('… niets daarvan bij de APC-mapping', invoer.length === apcVoor);
  ws.krijg({ t: 'midi', dev: 'apparaat-uit-de-toekomst', bytes: [0x90, 1, 1] });
  ws.krijg({ t: 'midi', dev: 'maschine-mk2', bytes: [0x90, 999, 1] });
  ws.krijg({ t: 'midi', dev: 'xboard49' });
  ok('onbekend apparaat en kapotte bytes: genegeerd', xIn.length === 2 && mIn.length === 2 && invoer.length === apcVoor);
  ok('status: per speelapparaat verbonden en hoeveel er binnenkwam', midi.status().hub.speelt.xboard49.verbonden && midi.status().hub.speelt.xboard49.rx === 2 && midi.status().hub.speelt['maschine-mk2'].rx === 2);
  ws.krijg({ t: 'focus', aan: true });

  // Lampjes van de Maschine: door de wachtrij (16 per 4 ms), dan per beeld gebundeld met dev.
  vooruit(100);
  const ledVoor = ws.soort('led').length;
  for (let i = 0; i < 40; i++) mm.uit.send([0x90, 36 + (i % 16), i]);
  ok('lampjes eerst in de wachtrij (niets synchroon naar buiten)', midi.uitRij.length === 40 && ws.soort('led').length === ledVoor);
  vooruit(0);
  ok('… hooguit 16 per 4 ms eruit (CLAUDE.md: alles naar buiten door een wachtrij)', midi.uitRij.length === 24);
  vooruit(4);
  ok('… en 4 ms later weer 16', midi.uitRij.length === 8);
  ok('SysEx, ongeldige bytes en een lampje van 4 bytes: geweigerd en geteld', !mm.uit.send([0xf0, 0x47, 0x7f, 0x29, 0x60, 0, 4, 0x42, 0, 0, 0, 0xf7]) && !mm.uit.send([0x90, 200, 1]) && !mm.uit.send([0x90, 1, 2, 3])
    && midi.status().hub.speelt['maschine-mk2'].geweigerd === 3);
  vooruit(100);
  const mLed = ws.soort('led').slice(ledVoor).filter((b) => b.dev === 'maschine-mk2');
  ok('{t:\'led\', dev:\'maschine-mk2\', bytes}: per beeld gebundeld, alle 40 aangekomen, in volgorde', mLed.length >= 1 && mLed.length <= 3
    && JSON.stringify(mLed.flatMap((b) => b.bytes)) === JSON.stringify(Array.from({ length: 40 }, (_, i) => [0x90, 36 + (i % 16), i])));
  ok('… de lampjes van de APC blijven zoals ze waren: zonder dev', ws.soort('led').every((b) => b.dev === undefined || b.dev === 'maschine-mk2'));
  ok('… de Xboard ontvangt niets: geen led met dev xboard49', !ws.soort('led').some((b) => b.dev === 'xboard49'));

  // Schermen: base64 van precies 2048 bytes, door dezelfde wachtrij.
  const beeld = new Uint8Array(2048); beeld[0] = 0x80; beeld[2047] = 1;
  const ander = new Uint8Array(2048); ander[5] = 0xff;
  const schVoor = ws.soort('scherm').length;
  ok('scherm(nr, bytes): 2048 bytes en nr 0/1, anders geweigerd', mm.scherm(0, ander) && mm.scherm(1, new Uint8Array(2048)) && mm.scherm(0, beeld)
    && !mm.scherm(2, beeld) && !mm.scherm(0, new Uint8Array(100)) && !mm.scherm(1, null));
  vooruit(50);
  const sch = ws.soort('scherm').slice(schVoor);
  const terug = sch.map((b) => Uint8Array.from(Buffer.from(b.data, 'base64')));
  ok('{t:\'scherm\', dev:\'maschine-mk2\', nr, data}: base64 van 2048 bytes', sch.length === 2 && sch.every((b) => b.dev === 'maschine-mk2') && terug.every((d) => d.length === 2048));
  ok('… een nieuwer beeld voor hetzelfde scherm vervangt het oudere in de rij (alleen het laatste gaat weg)', sch[0].nr === 0 && terug[0][0] === 0x80 && terug[0][2047] === 1 && terug[0][5] === 0 && sch[1].nr === 1);
  ok('status: lampjes en schermen geteld', midi.status().hub.speelt['maschine-mk2'].leds === 40 && midi.status().hub.speelt['maschine-mk2'].schermen === 2);
  ok('nog geen statechange zolang de verbinding blijft', standen === 0);
  globalThis.__speelStanden = () => standen;
}

console.log('\nhartslag');
{
  const ws = laatste();
  const t0 = nu, hb0 = ws.soort('hb').length;
  vooruit(5000);
  ok('elke 0,8 s een hb (hb_s = 1)', ws.soort('hb').length - hb0 >= 6 && nu - t0 === 5000);
  // Een bericht buiten de tik om (een LED, een antwoord) mag het gat niet over 0,8 s duwen.
  vooruit(50); midi._led([0x90, 0x30, 1]); vooruit(20);
  const t2 = nu;
  vooruit(3000);
  const tt = ws.uitT.filter((x) => x >= t2 - 20);
  let g2 = 0; for (let i = 1; i < tt.length; i++) g2 = Math.max(g2, tt[i] - tt[i - 1]);
  ok(`op de voorgrond nooit meer dan 0,8 s stil, ook na een bericht tussen twee tikken (grootste gat ${g2} ms)`, g2 > 0 && g2 <= 800);
  // Grootste gat tussen twee berichten naar de hub (elk bericht telt als hartslag).
  const gat = (vanaf) => { const t = ws.uitT.filter((x) => x >= vanaf); let g = 0; for (let i = 1; i < t.length; i++) g = Math.max(g, t[i] - t[i - 1]); return g; };
  // Verborgen, stil tabblad: Chrome laat timers alleen op hele seconden lopen.
  uitlijn = 1000;
  vooruit(1000 - (nu % 1000));
  let t1 = nu;
  vooruit(20000);
  ok(`verborgen tabblad (timers 1×/s): toch elke ≤ 1 s een bericht (grootste gat ${gat(t1)} ms, stil_s = 3 s)`, gat(t1) <= 1000 && gat(t1) > 0);
  // Na 5 min verborgen: timers 1× per minuut. De hub stuurt `globaal` (adem) ~10×/s,
  // en WebSocket-events worden niet geknepen: daaraan hangt dan de hartslag.
  uitlijn = 60000;
  vooruit(60000 - (nu % 60000));
  t1 = nu;
  for (let i = 0; i < 1200; i++) { vooruit(100); ws.krijg({ t: 'globaal', waarden: { adem: (i % 100) / 100 } }); }
  ok(`na 5 min verborgen (timers 1×/min): de adem van de hub houdt de hartslag gaande (grootste gat ${gat(t1)} ms)`, gat(t1) <= 900 && gat(t1) > 0);
  uitlijn = 0;
  vooruit(1000);
}

console.log('\nherverbinden');
{
  // Tot er een nieuwe socket is (of max ms): de wachttijd tot de volgende poging.
  const volgende = (max = 60000) => { const n = NepWS.alle.length, t = nu; while (NepWS.alle.length === n && nu - t < max) vooruit(50); return laatste().gemaakt - t; };
  const wachttijden = [];
  laatste().close(1006);
  ok('verbinding weg: poort weg (mapping laat shift en knoppen los)', midi.output() === null && midi.input() === null);
  ok('… de speelpoorten ook: disconnected, met een statechange (noten.js en maschine.js laten dan los)',
    midi.speelPoort('xboard49').in.state === 'disconnected' && midi.speelPoort('maschine-mk2').uit.state === 'disconnected' && globalThis.__speelStanden() === 1);
  ok('… en een lampje of scherm voor de Maschine wordt niet aangenomen', !midi.speelPoort('maschine-mk2').uit.send([0x90, 36, 5]) && !midi.speelPoort('maschine-mk2').scherm(0, new Uint8Array(2048)));
  for (let i = 0; i < 5; i++) {
    wachttijden.push(volgende());
    if (i < 4) laatste().close(1006);   // weer niet gelukt
  }
  ok(`0,5 → 1 → 2 → 5 → 5 s (${wachttijden.join(', ')} ms)`, JSON.stringify(wachttijden) === JSON.stringify([...WACHT_MS, 5000]));
  laatste().open();
  ok('terug: opnieuw hallo/manifest/staat en de LED-laag opnieuw', laatste().uit[0].t === 'hallo' && laatste().uit[1].t === 'manifest' && uitvoer === 2);
  ok('focus begint weer uit tot de hub hem geeft', midi.focus === false);
  ok('terug: de speelpoorten weer connected (statechange: maschine.js tekent alles opnieuw)', midi.speelPoort('maschine-mk2').in.state === 'connected' && globalThis.__speelStanden() === 2);
  vooruit(100);
  ok('alle LED\'s opnieuw naar de hub', laatste().soort('led').reduce((n, b) => n + b.bytes.length, 0) >= apc40mk2.allLeds().length);
  vooruit(STABIEL_MS);
  laatste().close(1006);
  ok('na een stabiele verbinding weer vanaf 0,5 s', volgende() === 500);

  // Een hub die aanneemt en meteen weer sluit (bv. 1008): niet elke 0,5 s opnieuw.
  const kort = [];
  for (let i = 0; i < 5; i++) {
    laatste().open();
    laatste().krijg({ t: 'welkom', hub: 'varve-hub', v: 1 });
    vooruit(200);
    laatste().close(1008);
    kort.push(volgende());
  }
  ok(`open en meteen weer dicht (1008): wachttijd loopt op (${kort.join(', ')} ms)`, JSON.stringify(kort) === JSON.stringify([1000, 2000, 5000, 5000, 5000]));

  // Een socket die in CONNECTING blijft hangen (onbereikbare host): na OPEN_MS zelf dicht.
  const hangt = laatste();
  const t0 = nu;
  const w = volgende();
  ok(`hangt in CONNECTING: na ${OPEN_MS / 1000} s zelf dicht en opnieuw (${w} ms)`, hangt.readyState === 3 && w === OPEN_MS + 5000 && laatste().gemaakt - t0 === w);
  laatste().open();
  vooruit(STABIEL_MS);

  // Paniek ingedrukt en dan valt de verbinding weg: wij laten zelf los.
  laatste().krijg({ t: 'trig', id: 'paniek', aan: true });
  const voor = aangeroepen.length;
  laatste().close(1006);
  ok('verbinding weg met paniek ingedrukt: zwart laten we zelf los', JSON.stringify(aangeroepen.slice(voor)) === JSON.stringify([['video.black.hold', false]]));
  volgende();
  laatste().open();
  vooruit(STABIEL_MS);

  // Twee tabbladen: de hub laat het nieuwste winnen, wij krijgen 'fout vervangen' en 4001.
  const m0 = hubMeldingen.length;
  laatste().krijg({ t: 'fout', reden: 'vervangen: een nieuwere varve-dj is verbonden' });
  laatste().close(4001);
  const t = nu;
  ok('vervangen: gemeld aan de schermlaag (één keer)', hubMeldingen.length === m0 + 1 && hubMeldingen.at(-1).vervangen === true && midi.status().hub.vervangen === true);
  const aantal = NepWS.alle.length;
  vooruit(29000);
  ok('4001 (vervangen door een nieuwer tabblad): niet binnen 29 s', NepWS.alle.length === aantal);
  vooruit(1000);
  ok('4001: na 30 s opnieuw', NepWS.alle.length === aantal + 1 && laatste().gemaakt - t === VERVANGEN_MS);
  laatste().open();
  laatste().krijg({ t: 'fout', reden: 'vervangen: nog steeds' });
  laatste().close(4001);
  ok('nog steeds vervangen: geen nieuwe melding', hubMeldingen.length === m0 + 1);
  vooruit(VERVANGEN_MS);
  laatste().open();
  vooruit(STABIEL_MS);
  ok('weer stabiel verbonden: melding weg', hubMeldingen.length === m0 + 2 && hubMeldingen.at(-1).vervangen === false && midi.status().hub.verbonden);
  midi.stop();
  const n = NepWS.alle.length;
  vooruit(60000);
  ok('stop: dicht en geen nieuwe pogingen', NepWS.alle.length === n && laatste().readyState === 3);
}
ok('requestMIDIAccess ook daarna nooit aangeroepen', midiGevraagd === 0);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
