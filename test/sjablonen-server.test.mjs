// Spoor S10 (docs/EFFECTEN-MEER.md keuze 8): eigen sjablonen op een EIGEN server (eigen poort,
// tijdelijke database, VARVE_SJABLONEN en de andere VARVE_* in een tijdelijke map). Bewaren met
// versie (409 met wat er nu staat), dupliceren (zelfde rack, andere naam), overschrijven op naam,
// geen naam van een kant-en-klaar sjabloon, wissen, alleen vanaf deze Mac, en een onbekend effect
// of veld blijft bewaard.
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-sjablonen-'));
const media = join(map, 'media');
mkdirSync(media, { recursive: true });
const pad = join(map, 'eigen', 'sjablonen.json');
const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(media, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_NACHT: join(map, 'nacht.json'), VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: join(map, 'werkruimtes'), VARVE_SETS: join(map, 'sets'),
    VARVE_KAART: join(map, 'geen-kaart.json'), VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_HUB_SETS: join(map, 'hub-sets'), VARVE_HOSTS: 'varve-proef.ts.net',
    VARVE_STEMS_PY: join(map, 'geen-python'), VARVE_SJABLONEN: pad },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;
const get = async (p, headers = {}) => { const r = await fetch(`${B}${p}`, { headers }); return { status: r.status, j: await r.json().catch(() => null) }; };
const post = async (p, body, headers = {}) => {
  const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const IPAD = { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net' };
const rack = (naam, extra = {}) => ({ schema: 1, name: naam, uitleg: 'proef', xy: [1, 2],
  chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5 } }, { slot: 'b', type: 'toekomst-effect', params: { x: 1 }, bypass: false }],
  macros: [{ place: 1, label: 'een', default: 0, links: [{ target: 'a.reso', from: 0, to: 1 }] }, { place: 2, label: 'twee', default: 0, links: [{ target: 'a.freq', from: 0.5, to: 0.8 }] }],
  mods: [{ soort: 'lfo', sync: false, hz: 1, diepte: 0, doelen: [{ target: 'a.reso', diepte: 0.3 }] }],
  toekomstVeld: { iets: true }, ...extra });

try {
  let klaar = false;
  for (let i = 0; i < 200 && !klaar; i++) { klaar = await fetch(`${B}/api/sjablonen`).then((r) => r.ok).catch(() => false); if (!klaar) await wacht(100); }
  ok('de server start', klaar);
  const leeg = await get('/api/sjablonen');
  ok('zonder bestand: leeg, versie null', leeg.status === 200 && leeg.j.racks.length === 0 && leeg.j.versie === null);
  const eerst = await post('/api/sjablonen', { rack: rack('Mijn dub'), versie: null });
  ok(`bewaren: 200 en een versie (${eerst.status})`, eerst.status === 200 && typeof eerst.j.versie === 'string' && eerst.j.racks.length === 1);
  const opSchijf = JSON.parse(readFileSync(pad, 'utf8'));
  ok('op schijf: onbekend effect, onbekend veld, modulator en xy bewaard', opSchijf.racks[0].chain[1].type === 'toekomst-effect'
    && opSchijf.racks[0].toekomstVeld?.iets === true && opSchijf.racks[0].mods.length === 1 && opSchijf.racks[0].xy.join() === '1,2');
  const oud = await post('/api/sjablonen', { rack: rack('Nog een'), versie: null });
  ok(`met een oude versie: 409 met wat er nu staat (${oud.status})`, oud.status === 409 && oud.j.racks?.length === 1 && oud.j.versie === eerst.j.versie);
  const dup = await post('/api/sjablonen', { rack: rack('Mijn dub (kopie)'), versie: eerst.j.versie });
  ok('dupliceren = bewaren onder een andere naam', dup.status === 200 && dup.j.racks.map((r) => r.name).join() === 'Mijn dub,Mijn dub (kopie)');
  const over = await post('/api/sjablonen', { rack: rack('Mijn dub', { uitleg: 'nieuw' }), versie: dup.j.versie });
  ok('zelfde naam = overschrijven op zijn plek', over.status === 200 && over.j.racks.length === 2 && over.j.racks[0].uitleg === 'nieuw');
  const ingebouwd = await post('/api/sjablonen', { rack: rack('Dub-echo'), versie: over.j.versie });
  ok(`een naam van een kant-en-klaar sjabloon: 409 (${ingebouwd.status})`, ingebouwd.status === 409 && /kant-en-klaar/.test(ingebouwd.j.fout));
  const klein = await post('/api/sjablonen', { rack: rack('dub-echo'), versie: over.j.versie });
  ok(`alleen in hoofdletters anders dan een kant-en-klaar sjabloon: ook 409 (${klein.status})`, klein.status === 409);
  const zonderNaam = await post('/api/sjablonen', { rack: rack('  '), versie: over.j.versie });
  ok('zonder naam: 400', zonderNaam.status === 400);
  const kapot = await post('/api/sjablonen', { rack: rack('Kapot', { xy: [9, 9] }), versie: over.j.versie });
  ok(`een rack dat niet klopt: 400 met reden (${kapot.j?.fout})`, kapot.status === 400 && /xy/.test(kapot.j.fout));
  const ipad = await post('/api/sjablonen', { rack: rack('Van de iPad'), versie: over.j.versie }, IPAD);
  ok(`bewaren via Tailscale (de iPad): 403 (${ipad.status})`, ipad.status === 403);
  ok('lezen via Tailscale mag', (await get('/api/sjablonen', { Host: IPAD.Host })).status === 200);
  const wisIpad = await post('/api/sjablonen/wis', { naam: 'Mijn dub', versie: over.j.versie }, IPAD);
  ok(`wissen via Tailscale: 403 (${wisIpad.status})`, wisIpad.status === 403);
  const wis = await post('/api/sjablonen/wis', { naam: 'Mijn dub (kopie)', versie: over.j.versie });
  ok('wissen', wis.status === 200 && wis.j.racks.map((r) => r.name).join() === 'Mijn dub');
  const weg = await post('/api/sjablonen/wis', { naam: 'bestaat niet', versie: wis.j.versie });
  ok('wissen wat er niet is: 404', weg.status === 404);
  ok('geen tmp-bestand achtergebleven', !existsSync(`${pad}.tmp-${server.pid}`));
  const statisch = await fetch(`${B}/racks/sjablonen.json`);
  ok('de kant-en-klare blijven gewoon statisch te lezen', statisch.ok && (await statisch.json()).racks.length >= 20);
} catch (err) {
  ok(`geen uitzondering (${err.message})`, false);
  console.log(serverUit.slice(-2000));
} finally {
  server.kill();
  await wacht(100);
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
