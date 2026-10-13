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
  // Plus de Maschine-kaart: een EIGEN pagina (maschine.html), niet de mixer (zie hieronder).
  const MAG = { 'ui/speelapparaten.js': ['maschine'], 'control/maschine.js': ['maschine-scherm', 'devices/maschine-mk2'],
    'ui/maschine-kaart.js': ['maschine', 'maschine-scherm'], 'ui/maschine-kaart-plan.js': ['devices/maschine-mk2', 'maschine'] };
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
  // De kaart mag de Maschine laden omdat de mixer de kaart nooit laadt: alleen maschine.html.
  // Elk .js-bestand onder src/ (ook import() met backticks) en elke andere pagina.
  const kaartFout = [];
  const alleJs = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? alleJs(`${d}/${e.name}`) : e.name.endsWith('.js') ? [`${d}/${e.name}`] : []));
  for (const pad of alleJs(map.replace(/\/$/, ''))) {
    if (pad.endsWith('/ui/maschine-kaart.js')) continue;
    if (/maschine-kaart(-plan)?\.js/.test(readFileSync(pad, 'utf8'))) kaartFout.push(pad.slice(map.length));
  }
  for (const html of ['index.html', 'video.html', 'apc.html', 'plan.html', 'controle.html']) {
    if (/maschine-kaart(-plan)?\.js/.test(readFileSync(new URL(`../${html}`, import.meta.url), 'utf8'))) kaartFout.push(html);
  }
  ok(`de Maschine-kaart wordt alleen door maschine.html geladen, nooit door de mixer${kaartFout.length ? ` (${kaartFout.join(', ')})` : ''}`, kaartFout.length === 0);
  // De sectie (PROTOCOL §18): app.js maakt de bron (engineSecties, uit het dynamisch geladen hub.js)
  // en midi-opzet.js geeft hem aan HubMidi. Of het echt werkt: tools/headless/sec-hub.mjs.
  const appJs = readFileSync(`${map}ui/app.js`, 'utf8'), opzet = readFileSync(`${map}ui/midi-opzet.js`, 'utf8');
  ok('met de vlag: app.js geeft de sectiebron van de engine mee (engineSecties), midi-opzet.js geeft hem aan HubMidi',
    /engineSecties\(engine, DECK_IDS\)/.test(appJs) && /new hub\.HubMidi\(\{[^}]*secties: hub\.secties/.test(opzet));
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
ok('levert: de sectie van het nummer (PROTOCOL §18)', JSON.stringify(MANIFEST.levert) === '["sectie"]');
{
  const gezet = process.env.VARVE_HUB_REPO;
  const hubRepo = gezet || fileURLToPath(new URL('../../av-app-hub', import.meta.url));
  const pad = `${hubRepo}/src/protocol/manifest.js`;
  if (existsSync(pad)) {
    const { valideerManifest } = await import(pad);
    const v = valideerManifest(MANIFEST);
    ok(`geldig volgens de hub (valideerManifest)${v.ok ? '' : `: ${JSON.stringify(v.fouten ?? v)}`}`, v.ok);
    // Een hub van vóór PROTOCOL §18 kent `levert` niet en laat hem weg (grondregel 5): geldig, de sectie wordt daar genegeerd.
    if (v.ok && 'levert' in v.manifest) ok('de hub neemt levert: ["sectie"] aan', JSON.stringify(v.manifest.levert) === '["sectie"]');
    else if (v.ok) console.log('  --  levert niet getoetst: deze hub kent PROTOCOL §18 nog niet (hij negeert levert en globaal van een app)');
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
{
  // Voorflank (14 okt): na een stille periode gaat een lampje meteen (na de lopende taak), niet 16 ms later;
  // wat daarna binnen BEELD_MS komt, wacht tot BEELD_MS na de vorige bundel (hooguit één bundel per beeld).
  const { BEELD_MS } = await import('../src/control/hub.js');
  vooruit(200);
  const ws = laatste(), n0 = ws.soort('led').length, t0 = nu;
  midi.send([0x90, 0x20, 5]);
  vooruit(0);
  const eerste = ws.soort('led').slice(n0);
  ok('na stilte: een lampje gaat meteen naar de hub (0 ms, niet BEELD_MS)', eerste.length === 1 && ws.uitT.at(-1) === t0
    && JSON.stringify(eerste[0].bytes) === '[[144,32,5]]');
  vooruit(3); midi.send([0x90, 0x21, 5]); midi.send([0x90, 0x22, 5]);
  vooruit(BEELD_MS - 4);
  ok('… het volgende binnen een beeld wacht', ws.soort('led').length === n0 + 1);
  vooruit(1);
  const tweede = ws.soort('led').slice(n0 + 1);
  ok(`… en gaat ${BEELD_MS} ms na de vorige, samen in één bundel`, tweede.length === 1 && ws.uitT.at(-1) - t0 === BEELD_MS && tweede[0].bytes.length === 2);
}

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
  // Sinds 14 okt een schuivend venster: de rij was leeg, dus de eerste 16 meteen in de bundel (niet synchroon naar de hub).
  ok('lampjes: de eerste 16 meteen in de bundel, de rest in de wachtrij; niets synchroon naar de hub', midi.uitRij.length === 24 && ws.soort('led').length === ledVoor);
  vooruit(0);
  ok('… hooguit 16 per 4 ms eruit (CLAUDE.md: alles naar buiten door een wachtrij)', midi.uitRij.length === 24);
  vooruit(3);
  ok('… ook niet na 3 ms (het venster schuift: 16 in elke 4 ms)', midi.uitRij.length === 24);
  vooruit(1);
  ok('… na 4 ms de volgende 16', midi.uitRij.length === 8);
  vooruit(0);
  vooruit(4);
  ok('… en 4 ms later de laatste 8', midi.uitRij.length === 0);
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

console.log('\nde sectie naar de hub (PROTOCOL §18)');
{
  const H = await import('../src/control/hub.js');
  ok('zonder sectiebron (zoals hierboven) nooit een globaal', NepWS.alle.every((ws) => ws.soort('globaal').length === 0));
  const V = 0.04;
  const ST = [
    { van: 0, label: 'intro', groep: 'A', energie: 0.3 }, { van: 4, label: 'opbouw', groep: 'B', energie: 0.55 },
    { van: 8, label: 'drop', groep: 'C', energie: 0.9 }, { van: 12, label: 'break', groep: 'D', energie: 0.35 },
    { van: 16, label: 'outro', groep: 'E', energie: 0.15 }];
  // Een deck zoals de SectieLezer (analysis/maat.js) het leest: duck-typed, de positie op de (nep-)klok.
  const nepDeck = (stukken) => ({ playing: false, rate: 1, wacht: false, remt: false, loop: null, P0: 0, c0: 0,
    sectieKaart: stukken ? { stukken } : null,
    get position() {
      if (!this.playing) return this.P0;
      const p = this.P0 + (nu / 1000 - this.c0) * this.rate, l = this.loop;   // een loop: de positie blijft in [start, end)
      return l && p >= l.end ? l.start + ((p - l.start) % (l.end - l.start)) : p;
    } });
  const deck = nepDeck(ST);
  const speel = (d, vanaf) => { d.P0 = vanaf ?? d.position; d.c0 = nu / 1000; d.playing = true; };
  const pauze = (d) => { d.P0 = d.position; d.playing = false; };
  /** Op de nep-klok (ms): wanneer je tracktijd `van` HOORT (positie min vertraging), zolang het deck doorspeelt. */
  const gehoord = (van) => (deck.c0 + (van - deck.P0) / deck.rate + V) * 1000;
  const naar = (ms) => vooruit(Math.max(0, ms - nu));
  const sec = (ws) => ws.uit.map((b, i) => ({ b, t: ws.uitT[i] })).filter((x) => x.b.t === 'globaal');
  const nieuwe = (ws) => sec(ws).filter((x) => 'sectie.nieuw' in x.b.waarden);
  const w = (x, k) => x?.b.waarden[`sectie.${k}`];
  const perS = (lijst) => { let max = 0; for (let i = 0, j = 0; i < lijst.length; i++) { while (lijst[i].t - lijst[j].t >= 1000) j++; max = Math.max(max, i - j + 1); } return max; };
  const laat = (x, van) => (x ? x.t - gehoord(van) : NaN);
  const volgendeSocket = () => { const n = NepWS.alle.length, t = nu; while (NepWS.alle.length === n && nu - t < 60000) vooruit(10); return laatste(); };
  // De maatgever is alleen een deck als je hem hoort (maatgever() in puls.js): gepauzeerd = null.
  const hm = new HubMidi({ url: 'ws://hub.test/app', invoke, read, WS: NepWS, klok: () => nu,
    secties: { deck: () => (deck.playing ? deck : null), vertraging: () => V, tijd: () => nu / 1000 } });
  await hm.init();
  const ws1 = laatste();
  ws1.open();
  vooruit(1000);
  ok('verbonden terwijl er niets speelt: geen globaal (de hub weet zo dat er geen sectie bekend is)', sec(ws1).length === 0);

  speel(deck, 0);
  vooruit(2500);
  const g1 = sec(ws1);
  ok('spelen vanaf het begin: de sectie naar de hub (intro), zonder nieuw: het begin van het nummer is geen nieuwe sectie (zoals in beeld)',
    w(g1[0], 'label') === 'intro' && nieuwe(ws1).length === 0);
  ok('alleen sleutels van de groep sectie (levert), en pas na het manifest', g1.every((x) => Object.keys(x.b.waarden).every((k) => k.startsWith('sectie.')))
    && ws1.uit.findIndex((b) => b.t === 'globaal') > ws1.uit.findIndex((b) => b.t === 'manifest'));
  const e1 = g1.map((x) => w(x, 'energie'));
  ok(`de energie glijdt op naar precies 0,3, zoals de vormbron (${e1.join(' ')})`, e1.at(-1) === 0.3 && e1.every((e, i) => i === 0 || e > e1[i - 1]));
  ok('… in stappen van minstens 0,01 (alleen de laatste mag kleiner: daar staat hij stil)', e1.slice(1, -1).every((e, i) => e - e1[i] >= 0.01 - 1e-9));
  ok(`… hooguit 10×/s (${perS(g1)} binnen 1 s)`, perS(g1) <= 10);
  ok('het label alleen als het anders is', g1.filter((x) => w(x, 'label') !== undefined).length === 1);

  naar(gehoord(4.5));
  const n1 = nieuwe(ws1);
  ok('de grens naar opbouw: precies één sectie.nieuw', n1.length === 1);
  ok('… nieuw is true (niet 1), met de energie en het label van de nieuwe sectie in hetzelfde bericht',
    w(n1[0], 'nieuw') === true && w(n1[0], 'energie') === 0.55 && w(n1[0], 'label') === 'opbouw');
  ok(`… op het moment dat je hem HOORT (positie min vertraging): ${laat(n1[0], 4).toFixed(1)} ms erna, niet een tik van ${H.SECTIE_MS} ms`,
    laat(n1[0], 4) >= 0 && laat(n1[0], 4) <= 5);
  const voorDrop = sec(ws1).length;
  naar(gehoord(7.9));
  ok('binnen een sectie (de energie blijft gelijk): niets naar de hub', sec(ws1).length === voorDrop);
  naar(gehoord(13));
  const n2 = nieuwe(ws1);
  ok(`elke grens precies één keer (${n2.map((x) => w(x, 'label')).join(', ')})`, n2.map((x) => w(x, 'label')).join() === 'opbouw,drop,break');
  ok('… elk met de energie van zijn sectie', n2.map((x) => w(x, 'energie')).join() === '0.55,0.9,0.35');
  ok(`… elk binnen 5 ms nadat je hem hoort (${n2.map((x, i) => laat(x, [4, 8, 12][i]).toFixed(1)).join(', ')} ms)`,
    n2.length === 3 && n2.every((x, i) => laat(x, [4, 8, 12][i]) >= 0 && laat(x, [4, 8, 12][i]) <= 5));
  ok(`hooguit 10×/s, de hele tijd (${perS(sec(ws1))})`, perS(sec(ws1)) <= 10);

  // Herverbinden (de hub of het netwerk hapert): de sectie die speelt, zonder nieuw.
  ws1.close(1006);
  const ws2 = volgendeSocket();
  ws2.open();
  const [a, b, c, d] = ws2.uit;
  ok('herverbinden: hallo, manifest, staat en dan meteen de sectie die speelt (break, 0,35)',
    a?.t === 'hallo' && b?.t === 'manifest' && c?.t === 'staat' && d?.t === 'globaal' && d.waarden['sectie.label'] === 'break' && d.waarden['sectie.energie'] === 0.35);
  ok('… ZONDER sectie.nieuw (anders klapt elk beeld bij elke hapering)', !!d && !('sectie.nieuw' in d.waarden));
  // Een grens in het gat (de outro begint terwijl de verbinding weg is).
  naar(gehoord(15.8));
  ws2.close(1006);
  const ws3 = volgendeSocket();
  ok('(de verbinding kwam pas na de grens naar de outro terug)', nu > gehoord(16));
  ws3.open();
  const g3 = sec(ws3);
  ok('een grens in het gat: na herverbinden de sectie die nu speelt (outro, 0,15), zonder nieuw',
    w(g3[0], 'label') === 'outro' && w(g3[0], 'energie') === 0.15 && w(g3[0], 'nieuw') === undefined);
  vooruit(1000);
  ok('… en ook daarna geen nieuw voor een grens van toen', nieuwe(ws3).length === 0);

  // Pauze: de maatgever valt weg. De energie naar 0 (glijdend, zoals in beeld), het label blijft staan.
  pauze(deck);
  const p0 = sec(ws3).length;
  vooruit(3000);
  const p = sec(ws3).slice(p0);
  ok(`pauze: de energie naar precies 0 (${p.map((x) => w(x, 'energie')).join(' ')})`, p.length >= 1 && w(p.at(-1), 'energie') === 0);
  ok('… zonder nieuw en zonder (leeg) label', p.every((x) => w(x, 'nieuw') === undefined && w(x, 'label') === undefined));
  ok(`… hooguit 10×/s (${perS(p)})`, perS(p) <= 10);
  const stil = sec(ws3).length;
  vooruit(2000);
  ok('… daarna stil: niets meer naar de hub', sec(ws3).length === stil);
  ws3.close(1006);
  const ws4 = volgendeSocket();
  ws4.open();
  const g4 = sec(ws4);
  ok('herverbinden in de pauze: energie 0 en het laatste label (een hub die ons nog kende, toonde anders de oude energie), zonder nieuw',
    g4.length === 1 && w(g4[0], 'energie') === 0 && w(g4[0], 'label') === 'outro' && w(g4[0], 'nieuw') === undefined);

  // Een cue op de "1" van de drop, en spelen: die nieuwe sectie hoor je (zoals in beeld).
  vooruit(STABIEL_MS);
  deck.P0 = 8;
  vooruit(500);
  speel(deck, 8);
  vooruit(1000);
  const n4 = nieuwe(ws4);
  ok('spelen vanaf het begin van de drop: één nieuw (label drop)', n4.length === 1 && w(n4[0], 'label') === 'drop' && w(n4[0], 'nieuw') === true);
  // De eerste `vertraging` na play ligt positie min vertraging vóór de cue (in de opbouw): een plek die je nooit hoort.
  ok('… en niet eerst even het label van vóór de cue (opbouw): wat net begint, hoor je pas na de vertraging',
    sec(ws4).slice(1).every((x) => w(x, 'label') !== 'opbouw') && w(sec(ws4)[1], 'nieuw') === true);
  ok(`… binnen een tik nadat je hem hoort (${laat(n4[0], 8).toFixed(1)} ms)`, laat(n4[0], 8) >= 0 && laat(n4[0], 8) <= H.SECTIE_MS);
  vooruit(1000);   // glijden van 0 naar 0,9 duurt ~1,7 s (ENERGIE_TAU 0,25 s tot op 0,001)
  ok(`… de energie glijdt daarna op naar 0,9 (${sec(ws4).slice(-1).map((x) => w(x, 'energie'))})`, w(sec(ws4).at(-1), 'energie') === 0.9);

  // Verborgen tabblad: timers 1×/s (na 5 min 1×/min). De hub stuurt globaal (adem) ~10×/s, en
  // WebSocket-events worden niet geknepen: daarop lezen we de sectie ook.
  const adem = (ms) => { const eind = nu + ms; let i = 0; while (nu < eind) { vooruit(100); ws4.krijg({ t: 'globaal', waarden: { adem: (i++ % 100) / 100 } }); } };
  uitlijn = 1000;
  adem(gehoord(12.5) - nu);
  const n5 = nieuwe(ws4).slice(1);
  ok(`verborgen tabblad (timers 1×/s): de grens naar break precies één keer, hooguit 0,1 s te laat (${laat(n5[0], 12).toFixed(0)} ms: op de adem van de hub)`,
    n5.length === 1 && w(n5[0], 'label') === 'break' && laat(n5[0], 12) >= 0 && laat(n5[0], 12) <= 101);
  uitlijn = 60000;
  adem(gehoord(16.5) - nu);
  const n6 = nieuwe(ws4).slice(2);
  ok(`na 5 min verborgen (timers 1×/min): de grens naar outro ook (${laat(n6[0], 16).toFixed(0)} ms)`,
    n6.length === 1 && w(n6[0], 'label') === 'outro' && laat(n6[0], 16) >= 0 && laat(n6[0], 16) <= 101);
  uitlijn = 0;
  vooruit(1000);
  const st = hm.status().hub.sectie;
  ok(`status: wat er speelt en hoeveel nieuwe secties de hub van ons kreeg (${JSON.stringify(st)})`,
    st?.label === 'outro' && st.energie === 0.15 && st.nieuw === NepWS.alle.slice(-4).reduce((n, s) => n + nieuwe(s).length, 0));

  // Een hub die de globaal weigert (fout): niets aan de hand, geen "vervangen".
  ws4.krijg({ t: 'fout', reden: 'globaal: sectie.label moet tekst van 1..32 tekens zijn' });
  ok('een fout van de hub over globaal: geen melding vervangen, verbinding blijft', hm.status().hub.vervangen === false && hm.status().hub.verbonden);
  hm.stop();
  const na = NepWS.alle.reduce((n, s) => n + s.uit.length, 0);
  vooruit(5000);
  ok('stop: geen sectie-tik meer', NepWS.alle.reduce((n, s) => n + s.uit.length, 0) === na);

  // Een track zonder secties, en een kaart die later binnenkomt (laden.js) met een label dat de hub niet aanneemt.
  const kaal = nepDeck(null);
  const hk = new HubMidi({ url: 'ws://hub.test/app', invoke, read, WS: NepWS, klok: () => nu,
    secties: { deck: () => (kaal.playing ? kaal : null), vertraging: () => V, tijd: () => nu / 1000 } });
  await hk.init();
  const wk = laatste();
  wk.open();
  speel(kaal, 30);
  vooruit(2000);
  ok('een track zonder sectiekaart: geen globaal', sec(wk).length === 0);
  kaal.sectieKaart = { stukken: [{ van: 0, label: 'x'.repeat(40), groep: 'A', energie: 0.5 }, { van: kaal.position + 1, label: 'drop', groep: 'B', energie: 1 }] };
  vooruit(3000);
  const gk = sec(wk);
  ok('de kaart komt later: de energie (glijdend), maar geen label van 40 tekens (de hub neemt 1..32)',
    gk.length >= 2 && w(gk[0], 'label') === undefined && gk.filter((x) => w(x, 'label') !== undefined).every((x) => w(x, 'label') === 'drop'));
  ok('… de grens naar de drop: één nieuw met label drop', nieuwe(wk).length === 1 && w(nieuwe(wk)[0], 'label') === 'drop');
  hk.stop();

  // De bron in de browser: de maatgever van de engine (puls.js), de uitgangsvertraging, de audioklok.
  const fader = { A: 1 };
  const dA = { id: 'A', buffer: {}, playing: true, wacht: false, remt: false, grid: {}, ui: { get fader() { return fader.A; } } };
  const engine = { syncMaster: () => dA, deck: (id) => (id === 'A' ? dA : null), xfadeGain: () => 1,
    ctx: { currentTime: 12.5, outputLatency: 0.02, baseLatency: 0.005 } };
  const bron = H.engineSecties?.(engine, ['A', 'B', 'C', 'D']);
  ok('engineSecties: de maatgever die je hoort, de uitgangsvertraging en de audioklok',
    bron?.deck() === dA && Math.abs(bron.vertraging() - 0.025) < 1e-12 && bron.tijd() === 12.5);
  fader.A = 0;
  ok('… met de fader dicht hoor je hem niet: geen deck (dus geen sectie)', bron?.deck() === null);

  // ---- review sec-hub (7 okt) --------------------------------------------------------
  console.log('\nde sectie naar de hub: review (vertraging, loops, tempo, wissel, cut, sprong)');
  const sprong = (d, T) => { d.P0 = T; d.c0 = nu / 1000; };
  const maakHub = async (bron) => {
    const h = new HubMidi({ url: 'ws://hub.test/app', invoke, read, WS: NepWS, klok: () => nu, secties: bron });
    await h.init();
    const s = laatste();
    s.open();
    return { h, s };
  };
  const sinds = (ws, n) => sec(ws).slice(n);

  // 1. De vertraging wordt groter (ander uitgangsapparaat, de limiter): t = klok − V loopt terug. Geen valse
  //    nieuwe sectie (energie 0) en geen dip.
  {
    const d = nepDeck(ST);
    let v = 0.04;
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => v, tijd: () => nu / 1000 });
    speel(d, 0);
    vooruit(6000);                                                  // in de opbouw (4–8), ver van een grens
    const n0 = sec(s).length;
    v = 0.1;
    vooruit(1500);
    ok(`vertraging 60 ms groter midden in een sectie: niets naar de hub (geen valse nieuw, geen dip) (${JSON.stringify(sinds(s, n0).map((x) => x.b.waarden))})`,
      sinds(s, n0).length === 0);
    h.stop();
    // currentTime in blokken van 512 frames (zoals Chrome), 8 ms meer vertraging tussen een berichtlezing en de tik.
    const blok = 512 / 48000;
    const d2 = nepDeck(ST);
    let v2 = 0.04;
    const { h: h2, s: s2 } = await maakHub({ deck: () => (d2.playing ? d2 : null), vertraging: () => v2, tijd: () => Math.floor(nu / 1000 / blok) * blok });
    speel(d2, 0);
    vooruit(5000);
    const tik = Math.min(...rij.map((x) => x.op));
    vooruit(Math.max(0, tik - nu - 1));
    const m0 = sec(s2).length;
    s2.krijg({ t: 'globaal', waarden: { adem: 0.5 } });
    v2 = 0.048;
    vooruit(1500);
    ok(`8 ms meer vertraging tussen een berichtlezing en de tik: niets naar de hub (${JSON.stringify(sinds(s2, m0).map((x) => x.b.waarden))})`, sinds(s2, m0).length === 0);
    h2.stop();
  }

  // 2. Een korte loop of stutter op de "1" van een sectie: één nieuwe sectie, niet één per rondgang (stroboscoop).
  for (const tellen of [1, 0.125]) {
    const d = nepDeck(ST);
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => 0.02, tijd: () => nu / 1000 });
    speel(d, 7);
    vooruit(1100);                                                  // je hoort de drop (8): één nieuw
    d.loop = { start: 8, end: 8 + tellen * 60 / 124 };
    const n0 = nieuwe(s).length;
    for (let i = 0; i < 40; i++) { vooruit(100); s.krijg({ t: 'globaal', waarden: { adem: i / 40 } }); }
    ok(`loop van ${tellen} tel op de "1" van de drop, 4 s: geen nieuwe sectie per rondgang (${nieuwe(s).length - n0} erbij), hooguit ${perS(sec(s))} globaal per seconde`,
      nieuwe(s).length === 1 && n0 === 1 && perS(sec(s)) <= 10);
    h.stop();
  }
  {
    const d = nepDeck(ST);
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => 0.02, tijd: () => nu / 1000 });
    speel(d, 6);
    vooruit(500);
    for (let i = 0; i < 7; i++) { sprong(d, 8); vooruit(150); }   // snel tikken op een hotcue op de drop
    vooruit(500);
    ok(`hotcue-stutter op het begin van de drop (7 tikken in 1 s): één nieuwe sectie (${nieuwe(s).length})`, nieuwe(s).length === 1);
    // Het vangnet: hooguit één nieuw per seconde, ook bij twee echte grenzen vlak na elkaar.
    vooruit(2000);
    const n0 = nieuwe(s).length, g0 = sec(s).length;
    sprong(d, 8); vooruit(300); sprong(d, 12); vooruit(1000);
    const na = sinds(s, g0);
    ok(`twee sprongen naar een sectiebegin binnen 0,3 s: één nieuw (${nieuwe(s).length - n0}), daarna label en energie van de break zonder nieuw`,
      nieuwe(s).length - n0 === 1 && w(na.at(-1), 'label') === 'break' && w(na.at(-1), 'energie') === 0.35 && w(na.at(-1), 'nieuw') === undefined);
    h.stop();
  }

  // 3. Een nieuwe sectie tijdens het glijden (spelen vanuit een pauze, 0,5 s vóór de drop): de nieuw gaat
  //    ALTIJD meteen, en telt mee in de 10 per seconde (schuivend venster).
  {
    let max = 0, laatMax = 0, mis = 0;
    for (let off = 0; off < 100; off += 7) {
      const d = nepDeck(ST);
      const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => 0.02, tijd: () => nu / 1000 });
      vooruit(off);
      speel(d, 7.5);
      const grensOp = (d.c0 + 0.5 + 0.02) * 1000;
      vooruit(3000);
      const n = nieuwe(s);
      if (n.length !== 1) mis++;
      else laatMax = Math.max(laatMax, n[0].t - grensOp);
      max = Math.max(max, perS(sec(s)));
      h.stop();
    }
    ok(`een grens tijdens het glijden, 15 keer met een andere fase: altijd precies één nieuw (${mis} keer niet), meteen (hooguit ${laatMax.toFixed(1)} ms na het horen), hooguit ${max} globaal per seconde (de nieuw telt mee)`,
      mis === 0 && laatMax <= 5 && max <= 10);
  }

  // 4. A stopt en B start op zijn cue (de drop), in dezelfde lezing: één nieuw, en geen "opbouw" ertussen.
  for (const lezing of [null, 25]) {
    const A = nepDeck(ST), B = nepDeck(ST);
    let mg = A;
    const { h, s } = await maakHub({ deck: () => (mg?.playing ? mg : null), vertraging: () => 0.04, tijd: () => nu / 1000 });
    speel(A, 13);
    vooruit(3000);
    const g0 = sec(s).length;
    pauze(A); speel(B, 8); mg = B;
    if (lezing) { vooruit(lezing); s.krijg({ t: 'globaal', waarden: { adem: 0.3 } }); }
    vooruit(2000);
    const na = sinds(s, g0);
    ok(`A stopt, B start op de drop${lezing ? `, een lezing na ${lezing} ms` : ''}: één nieuw met label drop, geen opbouw (${na.map((x) => w(x, 'label') ?? '·').join(' ')})`,
      na.filter((x) => w(x, 'nieuw') === true).length === 1 && w(na[0], 'nieuw') === true && w(na[0], 'label') === 'drop' && !na.some((x) => w(x, 'label') === 'opbouw'));
    h.stop();
  }

  // 5. De nieuw draagt de energie van de sectie zelf (niet die van het glijden), en de hub-energie glijdt
  //    daarna niet meer omhoog vanaf de oude waarde.
  {
    const d = nepDeck(ST);
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => 0.04, tijd: () => nu / 1000 });
    speel(d, 13); vooruit(3000); pauze(d); vooruit(3000);           // break, dan pauze: energie 0
    const g0 = sec(s).length;
    d.P0 = 8; speel(d, 8); vooruit(2000);
    const na = sinds(s, g0);
    ok(`uit pauze, cue op de drop: de nieuw draagt 0,9 (de drop), daarna geen energie die van onderen opglijdt (${na.map((x) => w(x, 'energie')).join(' ')})`,
      na.length === 1 && w(na[0], 'nieuw') === true && w(na[0], 'energie') === 0.9);
    h.stop();
  }

  // 6. Een cut in de mix: ~250 ms geen maatgever (de hysterese) terwijl de muziek doorspeelt. De energie blijft;
  //    pas na een halve seconde zonder maatgever (pauze) glijdt hij naar 0.
  {
    const d = nepDeck(ST);
    let weg = false;
    const { h, s } = await maakHub({ deck: () => (d.playing && !weg ? d : null), vertraging: () => 0.04, tijd: () => nu / 1000 });
    speel(d, 8.05); vooruit(2500);                                  // de drop (8–12), na het opglijden
    const g0 = sec(s).length;
    weg = true; vooruit(250); weg = false; vooruit(1000);
    ok(`250 ms geen maatgever (een cut): niets naar de hub, de energie blijft 0,9 (${JSON.stringify(sinds(s, g0).map((x) => x.b.waarden))})`, sinds(s, g0).length === 0);
    const g1 = sec(s).length, t0 = nu;
    pauze(d); vooruit(3000);
    const p = sinds(s, g1);
    ok(`pauze: de energie blijft eerst een halve seconde staan (eerste bericht na ${p[0] ? p[0].t - t0 : '?'} ms), dan naar 0 (${p.map((x) => w(x, 'energie')).join(' ')})`,
      p.length >= 2 && p[0].t - t0 >= 450 && w(p.at(-1), 'energie') === 0);
    h.stop();
  }

  // 7. Een sprong (hotcue, section.K): met een seintje van de deck (bij) lezen we meteen, dus de nieuw komt
  //    op het moment dat je de sprong hoort (V later), niet tot 50 ms daarna.
  {
    const d = nepDeck(ST);
    const luisteraars = new Set();
    const V2 = 0.04;
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => V2, tijd: () => nu / 1000,
      bij: (fn) => { luisteraars.add(fn); return () => luisteraars.delete(fn); } });
    speel(d, 8.5); vooruit(3000);                                   // midden in de drop
    let laatst = 0;
    for (let k = 0; k < 6; k++) {
      vooruit(13 + 7 * k);                                          // een andere fase t.o.v. de tik
      const n0 = nieuwe(s).length, druk = nu;
      sprong(d, k % 2 ? 8 : 12);
      for (const fn of luisteraars) fn(d);                          // deck.emit('change')
      vooruit(1500);
      const n = nieuwe(s).slice(n0);
      laatst = Math.max(laatst, n.length === 1 ? n[0].t - (druk + V2 * 1000) : Infinity);
    }
    ok(`een sprong op een sectiebegin met een seintje van de deck: de nieuw hooguit ${laatst.toFixed(1)} ms nadat je de sprong hoort (zonder: tot ${H.SECTIE_MS} ms)`,
      laatst >= 0 && laatst <= 3);
    h.stop();
    ok('stop: het seintje van de deck is weer los', luisteraars.size === 0);
  }

  // 8. Mutaties die bleven leven (review).
  //   M1: een grens die precies in de lezing bij het openen valt, gaat zonder nieuw mee.
  {
    const d = nepDeck(ST);
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => 0.04, tijd: () => nu / 1000 });
    speel(d, 2);
    const grensOp = (d.c0 + 2 + 0.04) * 1000;                       // je hoort 4 (opbouw)
    vooruit(grensOp - 1000 - nu);
    s.close(1006);
    const s2 = volgendeSocket();                                    // nog niet open
    vooruit(grensOp + 0.5 - nu);
    const g0 = h.lezer.grenzen;
    s2.open();
    const eerste = sec(s2)[0];
    ok(`een grens precies in de lezing bij het openen (teller ${g0} -> ${h.lezer.grenzen}): zonder nieuw, met het nieuwe label (${JSON.stringify(eerste?.b.waarden)})`,
      h.lezer.grenzen === g0 + 1 && w(eerste, 'nieuw') === undefined && w(eerste, 'label') === 'opbouw');
    vooruit(1000);
    ok('… en ook daarna geen nieuw voor die grens', nieuwe(s2).length === 0);
    h.stop();
  }
  //   M16: een lange reeks wijzigingen (de maatgever wisselt steeds, de energie glijdt steeds): nooit meer dan
  //   10 per seconde, en gewone berichten minstens GLOBAAL_MS uit elkaar.
  {
    const A = nepDeck(ST), B = nepDeck([{ van: 0, label: 'intro', groep: 'A', energie: 0.1 }]);
    let mg = A;
    const { h, s } = await maakHub({ deck: () => mg, vertraging: () => 0.02, tijd: () => nu / 1000 });
    speel(A, 2); speel(B, 0);
    for (let i = 0; i < 30; i++) { mg = i % 2 ? B : A; vooruit(300); }
    const g = sec(s), gewoon = g.filter((x) => w(x, 'nieuw') === undefined);
    let kleinst = Infinity;
    for (let i = 1; i < gewoon.length; i++) kleinst = Math.min(kleinst, gewoon[i].t - gewoon[i - 1].t);
    ok(`9 s lang steeds een andere maatgever (${g.length} globaal, ${nieuwe(s).length} nieuw): hooguit ${perS(g)} per seconde, gewone berichten minstens ${kleinst} ms uit elkaar`,
      g.length > 40 && perS(g) <= 10 && kleinst >= H.GLOBAAL_MS);
    h.stop();
  }
  //   M21: lezen is begrensd, ook als de hub (of een fader) een stortvloed aan berichten stuurt.
  {
    const d = nepDeck(ST);
    let lezingen = 0;
    const { h, s } = await maakHub({ deck: () => (d.playing ? d : null), vertraging: () => 0.02, tijd: () => { lezingen++; return nu / 1000; } });
    speel(d, 4.5); vooruit(1000);
    const l0 = lezingen;
    for (let i = 0; i < 500; i++) { vooruit(2); s.krijg({ t: 'midi', dev: 'apc40', bytes: [0xb0, 7, i % 128] }); }
    ok(`500 berichten in 1 s: hooguit ~50 lezingen (${lezingen - l0})`, lezingen - l0 <= 52);
    h.stop();
  }
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
