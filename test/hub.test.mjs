// De hub van de koppelbus (docs/BUS.md): frames, routing, de APC, toegang en
// echte sockets met een nep-TD. Geen dependencies.
// Draai met: node test/hub.test.mjs
import { request, createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { acceptSleutel, maakFrame, maakLezer, maakVerbinding, koppelWebSocket, VOL, DOOD } from '../hub/ws.js';
import { maakHub, ZENDER_STIL_MS } from '../hub/hub.js';
import { startHub, magBinnen, leesHosts, leesOrigins } from '../hub/index.js';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
async function tot(cond, ms = 2000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (cond()) return true; await wacht(5); }
  return cond();
}
const masker = [0x37, 0xfa, 0x21, 0x3d];

console.log('frames');
{
  ok('accept-sleutel uit RFC 6455', acceptSleutel('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const f = maakLezer()(maakFrame(0x1, Buffer.from('Hello'), { masker }));
  ok('gemaskeerd tekstframe terug te lezen', f.length === 1 && f[0].fin && f[0].opcode === 1 && f[0].data.toString() === 'Hello');
  const groot = Buffer.from('x'.repeat(300)), heelGroot = Buffer.from('y'.repeat(70000));
  const lees2 = maakLezer();
  const bytes = Buffer.concat([maakFrame(0x1, groot, { masker }), maakFrame(0x1, heelGroot, { masker })]);
  let uit = [];
  for (let i = 0; i < bytes.length; i += 977) uit = uit.concat(lees2(bytes.subarray(i, i + 977)));
  ok('16- en 64-bits lengte, in stukjes aangeleverd', uit.length === 2 && uit[0].data.length === 300 && uit[1].data.equals(heelGroot));
  ok('ongemaskeerd van een client: dicht (1002)', maakLezer()(maakFrame(0x1, Buffer.from('a')))[0]?.fout === 1002);
  ok('te groot: dicht (1009)', maakLezer({ max: 10 })(maakFrame(0x1, Buffer.alloc(11), { masker }))[0]?.fout === 1009);
  ok('ping groter dan 125 bytes: dicht (1002)', maakLezer()(maakFrame(0x9, Buffer.alloc(126), { masker }))[0]?.fout === 1002);
  ok('ping in stukken: dicht (1002)', maakLezer()(maakFrame(0x9, Buffer.alloc(3), { masker, fin: false }))[0]?.fout === 1002);
  const b = maakFrame(0x1, Buffer.alloc(200));
  ok('server-frame is niet gemaskeerd en heeft 16-bits lengte', b[0] === 0x81 && b[1] === 126 && b.readUInt16BE(2) === 200);
}

console.log('\nverbinding (met een nep-socket)');
{
  /** Een socket zonder netwerk: wat geschreven wordt komt in `uit`. */
  const nepSocket = () => {
    const s = new EventEmitter();
    Object.assign(s, { writable: true, writableLength: 0, uit: [], eind: null, kapot: false,
      write(b) { s.uit.push(b); return true; }, end(b) { s.eind = b ?? true; s.writable = false; },
      destroy() { s.kapot = true; s.writable = false; s.emit('close'); } });
    return s;
  };
  const code = (s) => (Buffer.isBuffer(s.eind) ? s.eind.readUInt16BE(2) : null);

  let s = nepSocket(), dicht = null;
  const binnen = [];
  let v = maakVerbinding(s).on('dicht', (c) => (dicht = c)).on('bericht', (t) => binnen.push(t));
  const tekst = Buffer.from('één bericht', 'utf8');
  s.emit('data', maakFrame(0x1, tekst.subarray(0, 2), { masker, fin: false }));
  s.emit('data', maakFrame(0x0, tekst.subarray(2), { masker }));
  ok('tekst in twee stukken, UTF-8 over de grens heen', binnen[0] === 'één bericht');
  s.emit('data', maakFrame(0x9, Buffer.from('hoi'), { masker }));
  ok('ping krijgt pong met dezelfde inhoud', s.uit.at(-1)[0] === 0x8a && s.uit.at(-1).subarray(2).toString() === 'hoi');
  s.emit('data', maakFrame(0x1, Buffer.from([0xc3, 0x28]), { masker }));
  ok('geen geldige UTF-8: dicht (1007)', dicht === 1007 && code(s) === 1007);

  s = nepSocket(); dicht = null;
  v = maakVerbinding(s).on('dicht', (c) => (dicht = c));
  s.writableLength = VOL + 1;
  v.stuur('stand', true);
  ok('loopt de andere kant achter: een stand valt weg', s.uit.length === 0);
  v.stuur('toon', false);
  ok('maar een gewoon bericht gaat mee', s.uit.length === 1);
  s.writableLength = DOOD + 1;
  v.stuur('toon', false);
  ok('leest de andere kant helemaal niet meer: dicht (1013)', dicht === 1013 && s.kapot);

  s = nepSocket(); dicht = null;
  let klok = 0;
  maakVerbinding(s, { pingMs: 10, stilMs: 50, nu: () => klok }).on('dicht', (c) => (dicht = c));
  await wacht(25);
  ok('hartslag: de hub pingt zelf', s.uit.some((x) => x[0] === 0x89));
  klok = 100;
  await wacht(25);
  ok('wie te lang niets laat horen, is weg', dicht === 1006 && s.kapot);

  s = nepSocket(); dicht = null;
  maakVerbinding(s).on('dicht', (c) => (dicht = c));
  s.emit('end');
  ok('andere kant weg zonder sluitframe: wij sluiten ook', dicht === 1006 && s.eind === true);
}

console.log('\nrouting (zonder netwerk)');
{
  const log = [];
  let klok = 1000;
  const hub = maakHub({ log: (s) => log.push(s), nu: () => klok });
  const app = (herkomst = 'lokaal') => {
    const bus = []; const k = hub.verbind({ stuur: (t) => bus.push(JSON.parse(t)) }, { herkomst });
    return { bus, k, zeg: (m) => k.ontvang(JSON.stringify(m)) };
  };
  const hallo = (naam, luistert, stuurt) => ({ baan: 'hub', type: 'hallo', app: naam, versie: 1, luistert, stuurt });

  const varve = app('varve'), td = app();
  varve.zeg({ baan: 'muziek', type: 'stand', bpm: 120 });
  ok('vóór hallo telt niets', log.includes('bericht vóór hallo'));
  varve.zeg(hallo('varve', ['acties', 'apc'], ['muziek', 'beeld', 'acties', 'apc']));
  td.zeg(hallo('td', ['muziek', 'beeld'], ['acties']));
  ok('hallo krijgt welkom met de apps', td.bus[0]?.type === 'welkom' && td.bus[0].apps.join() === 'varve,td');
  td.zeg(hallo('varve', ['acties'], ['muziek']));
  ok('een tweede hallo telt niet (td wordt geen varve)', log.includes('tweede hallo van td genegeerd') && hub.status().apps.map((a) => a.app).join() === 'varve,td');

  const nep = app('extra');
  nep.zeg(hallo('varve', ['acties'], ['acties']));
  ok('een andere pagina mag niet zeggen dat hij varve is', hub.status().apps.length === 2);
  nep.k.sluit();

  td.bus.length = 0; varve.bus.length = 0;
  varve.zeg({ baan: 'muziek', type: 'stand', bpm: 124, tel: 1, fase: 0.2 });
  ok('stand gaat naar wie luistert', td.bus.length === 1 && td.bus[0].bpm === 124 && td.bus[0].van === 'varve' && td.bus[0].t === 1000);
  ok('en niet terug naar de afzender', varve.bus.length === 0);

  td.zeg({ baan: 'muziek', type: 'stand', bpm: 90 });
  ok('td mag niet op muziek', log.some((l) => l.startsWith('td stuurt op muziek')));
  td.zeg({ baan: 'acties', id: 'track.1.fader', waarde: 0.5, van: 'varve' });
  ok('acties van td komen bij varve, met td als afzender', varve.bus.at(-1)?.id === 'track.1.fader' && varve.bus.at(-1).van === 'td');
  td.zeg({ baan: 'onzin' });
  ok('onbekende baan: weg, één keer gelogd', log.filter((l) => l.startsWith('onbekende baan')).length === 1);
  td.k.ontvang('{kapot');
  ok('geen JSON: genegeerd', log.includes('geen JSON ontvangen'));

  const laat = app();
  laat.zeg(hallo('av-kern', ['muziek'], []));
  ok('wie later aansluit krijgt meteen de laatste stand', laat.bus.some((m) => m.type === 'stand' && m.bpm === 124));

  const tweede = app('varve');
  tweede.zeg(hallo('varve', [], ['muziek']));
  td.bus.length = 0;
  tweede.zeg({ baan: 'muziek', type: 'stand', bpm: 99 });
  ok('een tweede varve stuurt niet mee (localhost én ts.net)', td.bus.length === 0);
  klok += ZENDER_STIL_MS + 1;
  tweede.zeg({ baan: 'muziek', type: 'stand', bpm: 98 });
  ok('zwijgt de eerste 3 s, dan neemt de tweede het over', td.bus.at(-1)?.bpm === 98 && hub.status().zenders.muziek === 'varve');
  varve.zeg({ baan: 'muziek', type: 'stand', bpm: 97 });
  ok('en de eerste is dan zelf de tweede', td.bus.at(-1)?.bpm === 98);
  tweede.k.sluit();
  const nieuw = app();
  nieuw.zeg(hallo('td2', ['muziek'], []));
  ok('de stand van een vertrokken zender wordt niet doorgegeven', !nieuw.bus.some((m) => m.type === 'stand'));
}

console.log('\nde APC');
{
  const hub = maakHub();
  const app = (naam, luistert = ['apc']) => {
    const bus = []; const k = hub.verbind({ stuur: (t) => bus.push(JSON.parse(t)) });
    k.ontvang(JSON.stringify({ baan: 'hub', type: 'hallo', app: naam, luistert, stuurt: ['apc'] }));
    return { bus, k, zeg: (m) => k.ontvang(JSON.stringify({ baan: 'apc', ...m })), eigenaar: () => bus.filter((m) => m.type === 'eigenaar').at(-1)?.app };
  };
  const varve = app('varve'), kern = app('av-kern', []), knop = app('controle');
  ok('bij aansluiten hoor je dat niemand hem heeft', varve.eigenaar() === null);
  varve.zeg({ type: 'vraag' });
  ok('vraag: varve krijgt hem en wie luistert hoort het', varve.eigenaar() === 'varve' && knop.eigenaar() === 'varve');
  kern.zeg({ type: 'vraag' });
  ok('bezet: av-kern hoort dat varve hem heeft (ook zonder te luisteren)', kern.eigenaar() === 'varve' && hub.status().apc === 'varve');
  kern.zeg({ type: 'geef', app: 'av-kern' });
  ok('alleen de Controlekamer geeft hem weg', hub.status().apc === 'varve');
  knop.zeg({ type: 'geef', app: 'av-kern' });
  ok('geef: av-kern krijgt hem en hoort het, ook zonder te luisteren', hub.status().apc === 'av-kern' && kern.eigenaar() === 'av-kern' && varve.eigenaar() === 'av-kern');
  kern.zeg({ type: 'los' });
  ok('los: weer vrij', hub.status().apc === null && varve.eigenaar() === null);

  const varve2 = app('varve');
  varve.zeg({ type: 'vraag' });
  varve2.zeg({ type: 'los' });
  ok('twee verbindingen van één app zijn samen eigenaar: los telt', hub.status().apc === null);
  varve.zeg({ type: 'vraag' });
  varve.k.sluit();
  ok('één van de twee weg: varve houdt hem', hub.status().apc === 'varve');
  varve2.k.sluit();
  ok('allebei weg: de APC is vrij', hub.status().apc === null && knop.eigenaar() === null);
}

console.log('\ntoegang');
{
  const req = (host, origin) => ({ headers: origin === undefined ? { host } : { host, origin } });
  const o = { poort: 8778, hosts: leesHosts('varve.tail1234.ts.net'), extra: leesOrigins('http://localhost:5173, onzin') };
  ok('localhost zonder Origin (TD, OBS, Node): lokaal', magBinnen(req('127.0.0.1:8778'), o) === 'lokaal');
  ok('pagina van localhost:8777: varve', magBinnen(req('127.0.0.1:8778', 'http://localhost:8777'), o) === 'varve');
  ok('pagina van [::1]:8777: varve', magBinnen(req('[::1]:8778', 'http://[::1]:8777'), o) === 'varve');
  ok('pagina via Tailscale uit VARVE_HOSTS: varve', magBinnen(req('localhost:8778', 'https://varve.tail1234.ts.net'), o) === 'varve');
  ok('toegelaten andere pagina (AV-kern): extra', magBinnen(req('localhost:8778', 'http://localhost:5173'), o) === 'extra');
  ok('een andere poort op localhost: nee', magBinnen(req('127.0.0.1:8778', 'http://localhost:3000'), o) === false);
  ok('vreemde pagina: nee', magBinnen(req('127.0.0.1:8778', 'https://voorbeeld.nl'), o) === false);
  ok('vreemde Host (DNS-rebinding): nee', magBinnen(req('aanval.nl:8778'), o) === false);
  ok('Tailscale-naam met poort: nee', magBinnen(req('127.0.0.1:8778', 'https://varve.tail1234.ts.net:8443'), o) === false);
}

console.log('\nechte sockets, met een nep-TD');
{
  // nep-TD: een WebSocket-server zoals de Web Server DAT uit td/bouw_varve.py
  const binnenTd = [];
  let tdVerbinding = null, tdPad = null;
  const tdServer = createServer();
  const tdSockets = new Set();
  tdServer.on('connection', (s) => { tdSockets.add(s); s.on('close', () => tdSockets.delete(s)); });
  koppelWebSocket(tdServer, { magBinnen: () => true, bijVerbinding(v, req) { tdVerbinding = v; tdPad = req.url; v.on('bericht', (t) => binnenTd.push(JSON.parse(t))); } });
  await new Promise((r) => tdServer.listen(0, '127.0.0.1', r));
  const tdUrl = `ws://127.0.0.1:${tdServer.address().port}`;

  const log = [];
  const h = await startHub({ poort: 0, td: tdUrl, tdSleutel: '0123456789abcdef0123', log: (s) => log.push(s), tdOpnieuw: 50 });
  ok('de hub verbindt zelf met TD', await tot(() => h.td.verbonden && tdVerbinding));
  ok('met de sleutel in het pad', tdPad === '/0123456789abcdef0123');
  ok('TD hoort welkom', await tot(() => binnenTd.some((m) => m.type === 'welkom')));

  const ws = new WebSocket(`ws://127.0.0.1:${h.poort}`);
  const bijVarve = [];
  ws.onmessage = (e) => bijVarve.push(JSON.parse(e.data));
  await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
  ws.send(JSON.stringify({ baan: 'hub', type: 'hallo', app: 'varve', luistert: ['acties'], stuurt: ['muziek', 'beeld'] }));
  ok('varve krijgt welkom over een echte socket', await tot(() => bijVarve.some((m) => m.type === 'welkom')));
  ws.send(JSON.stringify({ baan: 'muziek', type: 'stand', bpm: 126, tel: 3, fase: 0.5 }));
  ok('stand komt aan bij TD', await tot(() => binnenTd.some((m) => m.type === 'stand' && m.bpm === 126)));
  tdVerbinding.stuur(JSON.stringify({ baan: 'acties', id: 'track.2.play', waarde: true }));
  ok('actie van TD komt aan bij varve', await tot(() => bijVarve.some((m) => m.id === 'track.2.play' && m.van === 'td')));

  const groot = 'z'.repeat(200000);
  ws.send(JSON.stringify({ baan: 'muziek', type: 'stand', bpm: 127, opvulling: groot }));
  ok('een groot bericht (64-bits lengte) komt heel aan', await tot(() => binnenTd.some((m) => m.bpm === 127 && m.opvulling?.length === 200000)));

  const status = await new Promise((r) => request({ host: '127.0.0.1', port: h.poort, path: '/status', headers: { Origin: 'http://localhost:8777' } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => r({ code: res.statusCode, cors: res.headers['access-control-allow-origin'], json: JSON.parse(d) }));
  }).end());
  ok('/status: apps, zenders en TD', status.code === 200 && status.json.td === true
    && status.json.apps.map((a) => a.app).sort().join() === 'td,varve' && status.json.zenders.muziek === 'varve');
  ok('/status mag de Controlekamer lezen (CORS)', status.cors === 'http://localhost:8777');

  const upgrade = (origin) => new Promise((r) => {
    const req = request({ host: '127.0.0.1', port: h.poort, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: origin } });
    req.on('response', (res) => { r(res.statusCode); res.resume(); });
    req.on('upgrade', (res, socket) => { r(res.statusCode); socket.destroy(); });
    req.on('error', () => r('fout'));
    req.end();
  });
  ok('upgrade van een vreemde pagina: 403', await upgrade('https://voorbeeld.nl') === 403);
  ok('upgrade van een andere poort op localhost: 403', await upgrade('http://localhost:3000') === 403);
  ok('upgrade van localhost:8777: 101', await upgrade('http://localhost:8777') === 101);

  ws.close();
  ok('varve weg: de hub merkt het', await tot(() => log.includes('varve weg')));
  tdVerbinding.sluit();
  ok('TD weg: de hub merkt het en probeert opnieuw', await tot(() => !h.td.verbonden && log.some((l) => l.startsWith('TD weg'))));
  ok('en vindt TD terug', await tot(() => h.td.verbonden, 5000));

  await h.stop();
  ok('stop: de hub sluit al zijn verbindingen', await new Promise((r) => h.server.getConnections((_, n) => r(n === 0))));
  const tdDicht = new Promise((r) => tdServer.close(r));
  for (const s of tdSockets) s.destroy();
  await tdDicht;
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nhub: alles groen');
