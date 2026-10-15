// /api/standen op een EIGEN server (eigen poort, lege tijdelijke database,
// VARVE_STANDEN, VARVE_NACHT, de verzonnen kaart, een eigen map met hub-sets
// en de nep-yt-dlp): geen byte van internet, niets van Clay. De routes, de
// foutcodes, activeren tot in /api/nacht en /api/mapping, vastleggen, terug
// en wat een herstart overleeft. De routes voor mapping en nacht zelf
// blijven werken zoals ze werkten.
// Draai met: node test/standen-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const { maakNepYtdlp } = await import('./nep-ytdlp.mjs');
const { schrijfKaart } = await import('./nep-kaart.mjs');
const { nachtDatum } = await import('../server/nacht.js');
const { vraag: hubVraag } = await import('../tools/varve-app/hub-nodig.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-standen-server-'));
const media = join(map, 'media');
const standenMap = join(map, 'standen');
const hubSets = join(map, 'hub-sets');
const kaartPad = join(map, 'varve-kaart.json');
mkdirSync(media, { recursive: true });
mkdirSync(hubSets, { recursive: true });
for (const s of ['dj', 'studio', 'paden']) writeFileSync(join(hubSets, `${s}.json`), '{}');
schrijfKaart(kaartPad);

const poort = 20000 + Math.floor(Math.random() * 20000);
const startServer = () => spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(media, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(map), VARVE_KAART: kaartPad, VARVE_KAART_DB: join(map, 'kaart.db'),
    VARVE_NACHT: join(map, 'nacht.json'), VARVE_STANDEN: standenMap, VARVE_HUB_SETS: hubSets },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let server = startServer();
let serverUit = '';
const vang = (s) => { s.stdout.on('data', (d) => { serverUit += d; }); s.stderr.on('data', (d) => { serverUit += d; }); };
vang(server);
const B = `http://localhost:${poort}`;

const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, j: await r.json().catch(() => null) }; };
const zend = async (methode, p, body, headers = {}) => {
  const r = await fetch(`${B}${p}`, { method: methode, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const post = (p, body = {}, headers) => zend('POST', p, body, headers);
const put = (p, body, headers) => zend('PUT', p, body, headers);
const wachtOpServer = async () => { for (let i = 0; i < 200; i++) { if (await fetch(`${B}/api/standen`).then((r) => r.ok).catch(() => false)) return true; await wacht(100); } return false; };

try {
  ok('server draait', await wachtOpServer());

  console.log('lezen');
  const l = await get('/api/standen');
  ok(`GET /api/standen: 200, vier voorbeelden, label Opstelling, actief null`, l.status === 200 && l.j.standen.length === 4 && l.j.label === 'Opstelling' && l.j.actief === null);
  ok('GET /api/standen/actief: { naam: null }', (await get('/api/standen/actief')).j?.naam === null);
  const k = await get('/api/standen/keuzes');
  // Het aantal sjablonen komt uit het bestand (spoor S10: 33 in plaats van 8).
  const SJABLONEN = JSON.parse(readFileSync(new URL('../racks/sjablonen.json', import.meta.url), 'utf8')).racks.map((r) => r.name);
  ok(`GET /api/standen/keuzes: alle ${SJABLONEN.length} sjablonen, 8 kratten, hub-sets dj en studio (paden niet), profielen uit avondpakket/profielen.json (samengevoegd met draagbaar)`, k.status === 200 && k.j.sjablonen.join() === SJABLONEN.join()
    && k.j.kratten.length === 8 && k.j.hubSets.join() === 'dj,studio' && Array.isArray(k.j.profielen)
    && ['apc', 'alles', 'maschine', 'laptop'].every((n) => k.j.profielen.includes(n)) && k.j.mappingNu === 'standaard');
  const apc = await get('/api/standen/apc');
  ok('GET /api/standen/apc: 200, voorbeeld, met versie', apc.status === 200 && apc.j.bron === 'voorbeeld' && apc.j.stand.titel === 'Avond 1 · APC direct' && /^[0-9a-f]{16}$/.test(apc.j.versie));
  ok('GET /api/standen/bestaatniet: 404', (await get('/api/standen/bestaatniet')).status === 404);
  const v = await get('/api/standen/apc/verschil');
  ok('GET /api/standen/apc/verschil: 200, nacht uit → uit · vannacht niet', v.status === 200 && v.j.delen.nacht.naar === 'uit · vannacht niet');

  console.log('\nopslaan');
  const nieuw = { schema: 1, titel: 'Mijn proef', delen: { mapping: 'standaard', nacht: { aan: false } } };
  const x415 = await fetch(`${B}/api/standen/mijn`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ stand: nieuw }) });
  ok('PUT zonder JSON: 415', x415.status === 415);
  ok('PUT op "a b" en "x.y": 400', (await put('/api/standen/a%20b', { stand: nieuw })).status === 400 && (await put('/api/standen/x.y', { stand: nieuw })).status === 400);
  ok('PUT op de vaste namen actief, keuzes, terug: geen opslag (405)', (await put('/api/standen/actief', { stand: nieuw })).status === 405
    && (await put('/api/standen/keuzes', { stand: nieuw })).status === 405 && (await put('/api/standen/terug', { stand: nieuw })).status === 405);
  ok('PUT zonder stand: 400', (await put('/api/standen/mijn', { versie: null })).status === 400);
  ok('PUT en GET op "APC": 400 "kleine letters" (review punt 7)', await (async () => { const r = await put('/api/standen/APC', { stand: nieuw, versie: null }); return r.status === 400 && /kleine letters/.test(r.j.fout) && (await get('/api/standen/APC')).status === 400; })());
  ok('PUT met hub.set "studio; rm -rf ~": 400 (review punt 6)', (await put('/api/standen/mijn', { stand: { schema: 1, delen: { hub: { set: 'studio; rm -rf ~' } } }, versie: null })).status === 400);
  ok('PUT met een body boven 65 KiB: 413 (de kop zegt het al), geen verbroken verbinding (review punt 11)', await (async () => {
    const groot = JSON.stringify({ stand: { schema: 1, uitleg: 'x'.repeat(70 * 1024), delen: {} }, versie: null });
    const r = await fetch(`${B}/api/standen/groot`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: groot }).catch((e) => ({ status: `fout: ${e.message}` }));
    return r.status === 413 && !existsSync(join(standenMap, 'groot.json'));
  })());
  ok('PUT met nacht { aan: true }: 400 "alleen remmen"', await (async () => { const r = await put('/api/standen/mijn', { stand: { schema: 1, delen: { nacht: { aan: true } } } }); return r.status === 400 && /remmen/.test(r.j.fout); })());
  const p1 = await put('/api/standen/mijn', { stand: nieuw, versie: null });
  ok('PUT een nieuwe stand: 200, bron eigen', p1.status === 200 && p1.j.bron === 'eigen' && existsSync(join(standenMap, 'mijn.json')));
  ok('PUT nog eens met null: 409 met de stand', await (async () => { const r = await put('/api/standen/mijn', { stand: nieuw, versie: null }); return r.status === 409 && r.j.stand.titel === 'Mijn proef'; })());
  ok('PUT op apc met null: 409 (de versie van het voorbeeld is nodig)', (await put('/api/standen/apc', { stand: apc.j.stand, versie: null })).status === 409);
  ok('een andere oorsprong: 403 (PUT en activeer)', (await put('/api/standen/mijn', { stand: nieuw, versie: p1.j.versie }, { Origin: 'http://evil.example' })).status === 403
    && (await post('/api/standen/laptop/activeer', {}, { Origin: 'http://evil.example' })).status === 403);
  ok('DELETE: 405 (weghalen = het bestand met de hand verplaatsen)', (await zend('DELETE', '/api/standen/mijn')).status === 405 && existsSync(join(standenMap, 'mijn.json')));

  console.log('\nactiveren');
  // Een eigen mapping van één regel via de gewone route (die blijft zoals hij was).
  const eigen = { kind: 'diff', version: 3, device: 'apc40mk2', base: 'x', top: {}, rules: [{ in: 'cc:0:41', action: 'track.1.filter', mode: 'absolute' }], removed: [] };
  ok('POST /api/mapping werkt zoals altijd', (await post('/api/mapping', { mapping: eigen })).j?.regels === 1);
  ok('POST /api/nacht werkt zoals altijd (aan)', (await post('/api/nacht', { aan: true })).j?.aan === true);
  ok('activeer zonder JSON: 415 (zoals elke POST)', (await fetch(`${B}/api/standen/laptop/activeer`, { method: 'POST' })).status === 415);
  const a1 = await post('/api/standen/laptop/activeer');
  ok('POST laptop/activeer: 200 { ok, naam, sinds, verslag }', a1.status === 200 && a1.j.ok === true && a1.j.naam === 'laptop' && typeof a1.j.sinds === 'string' && a1.j.verslag.toegepast.includes('nacht'));
  ok('… GET /api/nacht: aan false', (await get('/api/nacht')).j.aan === false);
  ok('… GET /api/standen/actief: laptop', (await get('/api/standen/actief')).j.naam === 'laptop');
  ok('… GET /api/standen: actief laptop', (await get('/api/standen')).j.actief?.naam === 'laptop');
  const a2 = await post('/api/standen/apc/activeer');
  ok(`POST apc/activeer: vannacht niet (${nachtDatum(new Date())}), krat proefkrat leeg (nep-kaart), master voor de mixer, pakket: profiel apc bestaat in het avondpakket (geen waarschuwing)`,
    a2.status === 200 && (await get('/api/nacht')).j.vandaagNiet === true && a2.j.verslag.mixer.includes('master')
    && a2.j.verslag.waarschuwingen.some((w) => /proefkrat" is leeg/.test(w)) && !a2.j.verslag.waarschuwingen.some((w) => /avondpakket nog niet samengevoegd|profiel "apc" staat niet|profielen\.json niet leesbaar/.test(w)));
  ok('… de mapping bleef staan (apc noemt geen mapping)', (await get('/api/mapping')).j.mapping.rules.length === 1);
  // AR21: VARVE.app vraagt hetzelfde adres (tools/varve-app/hub-nodig.mjs) en start dan geen hub.
  ok('… VARVE.app (hub-nodig) op apc: nee apc, geen hub', (await hubVraag({ poort })) === 'nee apc');
  ok('POST onbekend/activeer: 404', (await post('/api/standen/onbekend/activeer')).status === 404);
  ok('GET apc/activeer: 405', (await get('/api/standen/apc/activeer')).status === 405);
  const a3 = await post('/api/standen/mijn/activeer');
  ok('mijn (mapping "standaard"): GET /api/mapping geeft een leeg verschil', a3.status === 200 && a3.j.verslag.toegepast.includes('mapping') && (await get('/api/mapping')).j.mapping.rules.length === 0
    && (await get('/api/mapping')).j.mapping.kind === 'diff');
  ok('… en .vorige/ heeft drie bestanden (een per activering)', readdirSync(join(standenMap, '.vorige')).length === 3);

  console.log('\nterug en vastleggen');
  const t = await post('/api/standen/terug');
  ok('POST /api/standen/terug: 200, mapping en nacht terug', t.status === 200 && t.j.ok && t.j.delen.join() === 'mapping,nacht' && (await get('/api/mapping')).j.mapping.rules.length === 1);
  ok('… actief: { naam: null, teruggezet }', await (async () => { const a = (await get('/api/standen/actief')).j; return a.naam === null && typeof a.teruggezet === 'string'; })());
  ok('GET /api/standen/terug: 405', (await get('/api/standen/terug')).status === 405);
  const vl = await post('/api/standen/apc/vastleggen', { versie: apc.j.versie });
  ok('POST apc/vastleggen met de voorbeeldversie: 200, mapping van één regel erin', vl.status === 200 && vl.j.stand.delen.mapping.rules.length === 1 && vl.j.delen.includes('master'));
  ok('… GET apc: bron eigen', (await get('/api/standen/apc')).j.bron === 'eigen');
  ok('… nog eens met dezelfde (oude) versie: 409', (await post('/api/standen/apc/vastleggen', { versie: apc.j.versie })).status === 409);
  ok('POST vastleggen zonder JSON-object: 400', (await zend('POST', '/api/standen/apc/vastleggen', [1])).status === 400);
  ok('onbekend eindpunt onder /api/standen: 404', (await get('/api/standen/apc/iets')).status === 404 && (await get('/api/standen/a/b/c')).status === 404);
  ok('/standen/ zelf is niet via HTTP te lezen', (await fetch(`${B}/standen/mijn.json`)).status === 404 && (await fetch(`${B}/standen/.actief.json`)).status === 404);

  console.log('\nherstart');
  await post('/api/standen/alles/activeer');
  server.kill('SIGTERM');
  await new Promise((z) => server.on('exit', z));
  server = startServer();
  vang(server);
  ok('server weer op', await wachtOpServer());
  const na = (await get('/api/standen/actief')).j;
  ok('actief overleeft de herstart: alles, hub studio via de mixer', na.naam === 'alles' && na.hub?.set === 'studio' && na.hub?.mixerVia === true);
  ok('… VARVE.app (hub-nodig) na de herstart op alles: ja, de hub erbij', (await hubVraag({ poort })) === 'ja');
  ok('de eigen standen ook (5 namen: vier voorbeelden plus mijn; apc nu als eigen)', (await get('/api/standen')).j.standen.length === 5
    && (await get('/api/standen')).j.standen.find((s) => s.naam === 'apc').bron === 'eigen');
  // Review punt 1: maschine raakt mapping noch nacht; "terug" zet dan ook niets terug.
  await post('/api/nacht', { aan: true });
  await post('/api/standen/maschine/activeer');
  await post('/api/nacht', { aan: false });
  const tm = await post('/api/standen/terug');
  ok('na maschine (geen mapping, geen nacht) en de nacht met de hand uit: terug zet niets terug, de nacht blijft uit',
    tm.status === 200 && tm.j.delen.length === 0 && tm.j.raakte.length === 0 && (await get('/api/nacht')).j.aan === false);
} finally {
  server.kill('SIGTERM');
  await Promise.race([new Promise((z) => server.on('exit', z)), wacht(5000)]);
  if (fails.length) console.log('\n--- server ---\n' + serverUit.split('\n').slice(-40).join('\n'));
  rmSync(map, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
