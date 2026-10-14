// De eigen mapping PER APPARAAT (werkruimte S5, docs/werkruimte/S5.md) tegen een ECHTE
// server (VARVE_TESTSERVER=1, tijdelijke data): Clay's APC-verschil blijft waar het is en
// byte voor byte hetzelfde, een oude volledige kopie gaat nog door verschilVanKopie + eerder,
// de Maschine en de Xboard bewaren onder hun eigen sleutel (en dat overleeft een
// serverherstart), "standaard herstellen" raakt alleen dat apparaat, en koppelen op de
// Maschine of de Xboard schrijft nooit in de APC-mapping. Geen DOM, geen browser.
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const { Mapping, maakVerschil, normaliseer, sleutelVan, eerdereStandaarden, isVerschil } = await import('../src/control/mapping.js');
const { laadEigen, opzetMappingOpslag, plekVan, opslagVan, EIGEN_MAPPING, APPARATEN } = await import('../src/ui/mapping-opslag.js');
const { MidiLearn, vangLeren, maschineMagLeren, keyboardMagLeren, KEYBOARD_APPARAAT } = await import('../src/control/midi-learn.js');
const { Maschine } = await import('../src/control/maschine.js');
const { Noten } = await import('../src/control/noten.js');
const { isSpeelapparaat } = await import('../src/control/midi.js');
const MS = await import('../src/control/devices/maschine-mk2.js');
const ROUTE = await import('../server/routes/mapping-apparaat.js');

const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));
const APC = lees('../mappings/apc40mk2.json');
const VIDEO = { 'cc:0:20': 'video.fx.pixel', 'cc:0:21': 'video.fx.rgb', 'cc:0:22': 'video.fx.trails', 'cc:0:23': 'video.fx.grain' };
/** Clay's kopie: de standaard met rack-knoppen 5–8 op video-effecten (zoals mapping.test). */
const metClay = (basis) => {
  const d = JSON.parse(JSON.stringify(basis));
  for (const r of d.rules) if (r.laag === 'device.rack' && VIDEO[r.in]) { r.action = VIDEO[r.in]; r.mode = 'absolute'; }
  return d;
};
const CLAY = maakVerschil(APC, metClay(APC));

// ---- de server ---------------------------------------------------------------------
const map = mkdtempSync(join(tmpdir(), 'varve-mapping-opslag-'));
mkdirSync(join(map, 'media'), { recursive: true });
const poort = 20000 + Math.floor(Math.random() * 20000);
const env = { ...process.env, PORT: String(poort), VARVE_TESTSERVER: '1', VARVE_DB: join(map, 'media/library.db'), VARVE_MEDIA: join(map, 'media'),
  VARVE_OPNAMES: join(map, 'opnames'), VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'),
  VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: join(map, 'werkruimtes'), VARVE_BACKUPS: join(map, 'backups'),
  VARVE_KAART: join(map, 'geen-kaart.json'), VARVE_HERANALYSE: 'uit' };
delete env.VARVE_HOSTS;
const B = `http://localhost:${poort}`;
let proc = null;
async function start() {
  proc = spawn(process.execPath, ['server/index.js'], { env, stdio: 'ignore' });
  for (let i = 0; i < 200; i++) { if (await fetch(`${B}/api/backups`).then((r) => r.ok).catch(() => false)) return true; await wacht(100); }
  return false;
}
async function stop() { if (!proc) return; const p = proc; proc = null; await new Promise((z) => { p.once('exit', z); p.kill(); }); }
/** fetch zoals de browser hem doet (relatieve paden, zelfde oorsprong). */
const haal = (url, o = {}) => fetch(`${B}/${url.replace(/^\//, '')}`, { ...o, headers: { ...(o.headers || {}), Origin: B } });
const tekst = async (pad) => (await fetch(`${B}${pad}`)).text();
const post = (pad, body) => fetch(`${B}${pad}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(body) });
const rauw = (pad, { method = 'GET', headers = {}, body = null } = {}) => new Promise((z) => {
  const rq = request({ host: '127.0.0.1', port: poort, path: pad, method, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => { res.resume(); res.on('end', () => z(res.statusCode)); });
  rq.on('error', () => z(0));
  if (body) rq.write(body);
  rq.end();
});
const nepOpslag = () => { const d = new Map(); return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), d }; };
const kaal = () => new Mapping({ read: () => null, invoke: () => {} });

// Een nep-engine voor de Maschine (zoals maschine.test, alleen wat de mapping vraagt).
const DECKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const eng = { focus: 'A', speeltrack: () => null, instrumentOp: () => null, deck: () => ({}) };
const gedaan = [];
const maakMaschine = () => new Maschine({ engine: eng, noten: null, read: () => null, invoke: (id, v) => { gedaan.push(`${id}=${v}`); if (/^track\.\d\.focus$/.test(id) && v) eng.focus = DECKS[Number(id.split('.')[1]) - 1]; return true; } });
const nepPoort = () => ({ in: { state: 'connected', onmidimessage: null, onstatechange: null }, uit: { send() {} }, scherm() {} });
const stuur = (poortje, bytes) => poortje.in.onmidimessage({ data: Uint8Array.from(bytes), timeStamp: 0 });
const knop = (naam, aan) => [aan ? 0x91 : 0x81, MS.knopNoot(naam), aan ? 127 : 0];

try {
  ok('server gestart (VARVE_TESTSERVER=1, tijdelijke data)', await start());

  console.log('\nde route /api/mapping/<apparaat>');
  {
    ok('de vier apparaten, en hun sleutel: apc40mk2 = de oude "mapping", de rest "mapping:<apparaat>"',
      ROUTE.APPARATEN.join() === APPARATEN.join() && ROUTE.sleutelVan('apc40mk2') === 'mapping' && ROUTE.sleutelVan('maschine-mk2') === 'mapping:maschine-mk2');
    ok('GET van een onbekend apparaat: 404', (await fetch(`${B}/api/mapping/lpd8`)).status === 404);
    ok('POST zonder rules: 400 (zoals /api/mapping)', (await post('/api/mapping/maschine-mk2', { mapping: { device: 'maschine-mk2' } })).status === 400);
    ok('POST van een mapping voor een ander apparaat: 400 (een APC-document komt nooit onder de Maschine)',
      (await post('/api/mapping/maschine-mk2', { mapping: CLAY })).status === 400 && (await post('/api/mapping/apc40mk2', { mapping: { device: 'maschine-mk2', rules: [] } })).status === 400);
    ok('POST vanaf een andere oorsprong: 403', await rauw('/api/mapping/toetsen', { method: 'POST', headers: { Origin: 'http://kwaad.example', 'Content-Type': 'application/json' }, body: '{"mapping":{"rules":[]}}' }) === 403);
    ok('DELETE vanaf een andere oorsprong: 403', await rauw('/api/mapping/toetsen', { method: 'DELETE', headers: { Origin: 'http://kwaad.example' } }) === 403);
    ok('POST als tekst: 415 (alleen JSON)', await rauw('/api/mapping/toetsen', { method: 'POST', headers: { Origin: B, 'Content-Type': 'text/plain' }, body: '{}' }) === 415);
  }

  console.log('\nClay\'s APC-verschil: waar het staat, en byte voor byte');
  let apcTekst;
  {
    ok('Clay\'s verschil: 4 regels op cc:0:20–23 @device.rack', CLAY.rules.length === 4 && CLAY.rules.every((r) => VIDEO[r.in] && r.laag === 'device.rack') && CLAY.removed.length === 0);
    await post('/api/mapping', { mapping: CLAY });
    apcTekst = await tekst('/api/mapping');
    ok('via de oude route bewaard; de nieuwe route /api/mapping/apc40mk2 leest PRECIES hetzelfde', (await tekst('/api/mapping/apc40mk2')) === apcTekst);
    const m = kaal();
    const v = await laadEigen(m, { haal });
    ok('laadEigen zonder apparaat (de APC, zoals altijd): van de server, 4 eigen, niets weg, niets omgezet',
      v.bron === 'server' && v.eigen === 4 && v.weg === 0 && !v.omgezet && !v.standaardNieuw && m.rules.get('cc:0:20@device.rack')?.action === 'video.fx.pixel');
    ok('… en wat er staat is precies standaard + verschil', JSON.stringify(m.verschil()) === JSON.stringify(CLAY));
    const opgehaald = JSON.parse(await tekst('/api/mapping/apc40mk2')).mapping;
    await post('/api/mapping/apc40mk2', { mapping: opgehaald });
    ok('opnieuw bewaard via /api/mapping/apc40mk2: /api/mapping is byte voor byte hetzelfde document', (await tekst('/api/mapping')) === apcTekst);
    // Opstarten zoals midi-opzet.js (zonder apparaat): niets te bewaren, dus niets verandert.
    const winkel = nepOpslag();
    const o = opzetMappingOpslag({ mapping: kaal(), haal, opslag: winkel, wacht: 0 });
    const s = await o.start();
    ok('opstarten zoals de app: laadt het, bewaart niets nieuws, de browser-reserve onder "varve.mapping"',
      s.bron === 'server' && !s.bewaard && (await tekst('/api/mapping')) === apcTekst && winkel.getItem(EIGEN_MAPPING) === JSON.stringify(CLAY) && winkel.d.size === 1);
    ok('de APC-opslag meldt zich als "apc40mk2" (opslagVan)', opslagVan('apc40mk2') === o && opslagVan() === o && plekVan().url === '/api/mapping');
  }

  console.log('\neen oude VOLLEDIGE kopie: verschilVanKopie + eerder');
  {
    const voorganger = eerdereStandaarden(APC)[0];
    ok('de standaard draagt voorgangers (eerder)', !!voorganger);
    const kopie = metClay(voorganger.doc);
    // Een volledige kopie is groter dan wat de server per POST aanneemt (64 kB, leesJson):
    // zo'n kopie staat nog in een browser (localStorage), niet meer op de server.
    ok('(een volledige kopie past niet meer in één POST: > 64 kB)', JSON.stringify({ mapping: kopie }).length > 64 * 1024);
    await fetch(`${B}/api/mapping`, { method: 'DELETE', headers: { Origin: B } });
    const winkel = nepOpslag();
    winkel.setItem(EIGEN_MAPPING, JSON.stringify(kopie));
    const m = kaal();
    const v = await laadEigen(m, { haal, opslag: winkel });
    const vs = m.verschil();
    ok('omgezet tegen de voorganger: Clay\'s 4 regels, niets "weggehaald", de nieuwe standaardregels staan erop',
      v.bron === 'browser' && v.omgezet && v.standaardNieuw && v.eigen === 4 && v.weg === 0 && vs.rules.length === 4 && vs.removed.length === 0 && m.rules.size === normaliseer(APC).doc.rules.length);
    await post('/api/mapping', { mapping: CLAY });   // terug naar Clay's verschil voor de rest
    ok('(Clay\'s verschil weer terug)', (await tekst('/api/mapping')) === apcTekst);
  }

  console.log('\nde Maschine: koppelen met CONTROL, eigen sleutel, herladen, serverherstart, herstellen');
  {
    const apc = kaal();
    const apcLeer = new MidiLearn({ mapping: apc, device: null });
    await laadEigen(apc, { haal });
    const apcVoor = JSON.stringify(apc.toJSON());

    const winkel = nepOpslag();
    const ms = maakMaschine();
    const learn = new MidiLearn({ mapping: ms.mapping, device: MS.default });
    vangLeren(ms, 'ontvang', learn, { magLeren: (msg) => maschineMagLeren(ms, learn, msg, MS) });
    const o = opzetMappingOpslag({ mapping: ms.mapping, apparaat: 'maschine-mk2', learn, haal, opslag: winkel, wacht: 0 });
    const s = await o.start();
    ok('opstarten: mappings/maschine-mk2.json, nog geen eigen verschil', s.bron === null && ms.mapping.device === 'maschine-mk2' && ms.mapping.rules.size === lees('../mappings/maschine-mk2.json').rules.length);
    ok('opslagVan("maschine-mk2"): de mapping en het leren van de Maschine', opslagVan('maschine-mk2') === o && o.learn === learn && o.mapping === ms.mapping);
    const p = nepPoort();
    ms.koppel(p);

    learn.start('track.2.focus');
    stuur(p, knop('f1', true)); stuur(p, knop('f1', false));
    ok('F1 zonder CONTROL tijdens koppelen: niets geleerd (de Maschine doet gewoon zijn ding)', learn.busy && !ms.mapping.rules.has(MS.knopSig('f1')));
    const niet = [];
    learn.on('niet', (x) => niet.push(x));
    stuur(p, knop('control', true));
    stuur(p, [0x90, MS.padNoot(1), 100]); stuur(p, [0x80, MS.padNoot(1), 0]);
    stuur(p, knop('step', true)); stuur(p, knop('step', false));
    ok('CONTROL + pad of STEP: niet te koppelen (gemeld), leren loopt door', learn.busy && niet.length === 2 && !ms.mapping.rules.has(MS.padSig(1)) && !ms.mapping.rules.has(MS.knopSig('step')));
    gedaan.length = 0;
    stuur(p, knop('f1', true));
    stuur(p, knop('f1', false));
    stuur(p, knop('control', false));
    ok('CONTROL + F1: gekoppeld in de Maschine-mapping, en F1 deed niets (ook zijn loslaten niet)', !learn.busy && ms.mapping.kies(MS.knopSig('f1'))?.action === 'track.2.focus' && gedaan.length === 0);
    await o.klaar();
    const opServer = JSON.parse(await tekst('/api/mapping/maschine-mk2')).mapping;
    ok('op de server onder mapping:maschine-mk2: een verschil van 1 regel', isVerschil(opServer) && opServer.device === 'maschine-mk2' && opServer.rules.length === 1
      && opServer.rules[0].in === MS.knopSig('f1') && opServer.removed.length === 0);
    ok('in de browser onder varve.mapping:maschine-mk2, nooit onder varve.mapping', winkel.getItem(`${EIGEN_MAPPING}:maschine-mk2`) === JSON.stringify(opServer) && winkel.getItem(EIGEN_MAPPING) === null);
    ok('de APC-mapping op de server: byte voor byte hetzelfde', (await tekst('/api/mapping')) === apcTekst);
    ok('de APC-mapping in het geheugen: niets erbij (ook niet als het APC-leren aanstond)', JSON.stringify(apc.toJSON()) === apcVoor && !apcLeer.busy);
    stuur(p, knop('f1', true)); stuur(p, knop('f1', false));
    ok('F1 doet nu wat je koppelde', gedaan.join() === 'track.2.focus=true,track.2.focus=false');

    // Het APC-leren staat aan (de APC gekozen) en iemand raakt de Maschine aan: de Maschine
    // leert niets (niet zijn beurt) en de APC al helemaal niet (zijn berichten komen hier nooit).
    apcLeer.start('track.5.focus');
    stuur(p, knop('control', true)); stuur(p, knop('f2', true)); stuur(p, knop('f2', false)); stuur(p, knop('control', false));
    ok('APC-leren aan + CONTROL + F2 op de Maschine: niets in de APC-mapping, niets in de Maschine-mapping', apcLeer.busy && JSON.stringify(apc.toJSON()) === apcVoor
      && !ms.mapping.rules.has(MS.knopSig('f2')));
    apcLeer.stop();

    // Een draaiknop: CONTROL + draaien, daarna doordraaien zonder CONTROL scherpt het type aan.
    learn.start('track.{focus}.fx.knob.3');
    stuur(p, knop('control', true));
    stuur(p, [0xb0, MS.ENCODER_CC + 6, 1]);
    stuur(p, knop('control', false));
    for (let i = 0; i < 4; i++) stuur(p, [0xb0, MS.ENCODER_CC + 6, i % 2 ? 127 : 1]);
    learn.stop();
    ok('CONTROL + draaiknop 7, doordraaien: relatief (tweecomplement)', ms.mapping.kies(MS.encoderSig(7))?.action === 'track.{focus}.fx.knob.3' && ms.mapping.kies(MS.encoderSig(7))?.mode === 'relative-2c');
    await o.klaar();
    ms.mapping.remove([...ms.mapping.rules.keys()].find((k) => k.startsWith(MS.encoderSig(7)) && ms.mapping.rules.get(k).action === 'track.{focus}.fx.knob.3'));
    await o.klaar();

    // Herladen: een nieuwe Maschine, dezelfde server.
    const herlaad = async () => {
      const m2 = maakMaschine();
      const o2 = opzetMappingOpslag({ mapping: m2.mapping, apparaat: 'maschine-mk2', haal, opslag: nepOpslag(), wacht: 0 });
      return { m2, v: await o2.start(), o2 };
    };
    let { m2, v } = await herlaad();
    ok('herladen: de standaard + jouw regel (van de server)', v.bron === 'server' && v.eigen === 1 && m2.mapping.kies(MS.knopSig('f1'))?.action === 'track.2.focus');
    await stop();
    ok('server gestopt en opnieuw gestart (zelfde data)', await start());
    ({ m2, v } = await herlaad());
    ok('na een serverherstart: jouw Maschine-regel staat er nog', v.bron === 'server' && m2.mapping.kies(MS.knopSig('f1'))?.action === 'track.2.focus');
    ok('… en Clay\'s APC-verschil ook, byte voor byte', (await tekst('/api/mapping')) === apcTekst);

    // Standaard herstellen op de Maschine.
    ok('"standaard herstellen" op de Maschine', await o.herstel());
    const leeg = JSON.parse(await tekst('/api/mapping/maschine-mk2')).mapping;
    ok('… een LEEG verschil onder mapping:maschine-mk2 (geen wissen: een oude kopie elders komt niet terug)', isVerschil(leeg) && leeg.rules.length === 0 && leeg.removed.length === 0);
    ok('… de regel is weg', !ms.mapping.rules.has(MS.knopSig('f1')) && ms.mapping.rules.size === lees('../mappings/maschine-mk2.json').rules.length);
    ok('… en de APC is niet geraakt (server byte voor byte, browser-reserve niet aangeraakt)', (await tekst('/api/mapping')) === apcTekst && winkel.getItem(EIGEN_MAPPING) === null);
  }

  console.log('\neen document voor een ander apparaat wordt niet geladen');
  {
    const winkel = nepOpslag();
    winkel.setItem(`${EIGEN_MAPPING}:xboard49`, JSON.stringify(CLAY));   // een APC-verschil op de verkeerde plek
    const m = kaal();
    const v = await laadEigen(m, { haal, opslag: winkel, apparaat: 'xboard49' });
    ok('een APC-verschil onder xboard49 in de browser: genegeerd, de standaard van de Xboard, met een reden', v.bron === null && m.device === 'xboard49'
      && v.fouten.some((f) => /apc40mk2/.test(f)));
  }

  console.log('\nde Xboard (een MIDI-keyboard): knoppen en de schuif koppelen');
  {
    const noten = new Noten({ engine: { speeltrack: () => 'A', instrumentOp: () => ({ noteOn() {}, noteOff() {}, houd() {} }) }, read: () => 0.5, invoke: () => true });
    const learn = new MidiLearn({ mapping: noten.mapping, device: KEYBOARD_APPARAAT });
    vangLeren(noten, 'ontvang', learn, { magLeren: (msg) => keyboardMagLeren(noten, msg) });
    const o = opzetMappingOpslag({ mapping: noten.mapping, apparaat: 'xboard49', learn, haal, wacht: 0 });
    await o.start();
    ok('opstarten: mappings/xboard49.json', noten.mapping.device === 'xboard49' && noten.mapping.rules.size > 0);
    const xb = { id: 'xb', name: 'Xboard49 (hub)', state: 'connected', onmidimessage: null };
    noten.koppel(xb);
    const niet = [];
    learn.on('niet', (x) => niet.push(x));
    learn.start('track.{speel}.fx.knob.2');
    xb.onmidimessage({ data: Uint8Array.from([0xb0, 64, 127]), timeStamp: 0 });
    ok('het pedaal (CC 64): niet te koppelen, gemeld', learn.busy && niet.length === 1 && !noten.mapping.rules.has('cc:0:64'));
    xb.onmidimessage({ data: Uint8Array.from([0xb0, 40, 70]), timeStamp: 0 });
    learn.stop();
    ok('CC 40 bewegen: gekoppeld in de Xboard-mapping', noten.mapping.kies('cc:0:40')?.action === 'track.{speel}.fx.knob.2');
    learn.start('track.{speel}.fader');
    xb.onmidimessage({ data: Uint8Array.from([0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x40, 0xf7]), timeStamp: 0 });
    learn.stop();
    ok('de schuif (SysEx Master Volume): gekoppeld als "master-volume", absoluut', noten.mapping.kies('master-volume')?.action === 'track.{speel}.fader' && noten.mapping.kies('master-volume')?.mode === 'absolute');
    await o.klaar();
    const opServer = JSON.parse(await tekst('/api/mapping/xboard49')).mapping;
    ok('op de server onder mapping:xboard49, als verschil', isVerschil(opServer) && opServer.device === 'xboard49' && opServer.rules.some((r) => r.in === 'cc:0:40'));
    ok('de APC: byte voor byte hetzelfde', (await tekst('/api/mapping')) === apcTekst);
    await o.herstel();
  }

  console.log('\neen speelapparaat wordt nooit "de controller"');
  ok('isSpeelapparaat: Maschine en Xboard ja (ook zonder hub), de APC nee',
    ['Maschine MK2 (hub)', 'Xboard49 (hub)', 'E-MU Xboard49', 'Maschine Controller MK2'].every((n) => isSpeelapparaat(n)) && !isSpeelapparaat('APC40 mkII'));
} finally {
  await stop();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
