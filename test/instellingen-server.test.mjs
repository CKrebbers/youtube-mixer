// De zeven browser-instellingen op de server (extra-3 B4): /api/instellingen
// en /api/instellingen/<sleutel>. Een EIGEN server op een eigen poort met een
// tijdelijke database: de witte lijst (400 op een onbekende sleutel), tekst of
// null, de tabel instellingen in library.db (dus in elke backup), de mapping
// ernaast blijft van zichzelf, en na een herstart staat alles er nog.
// Draai met: node test/instellingen-server.test.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const { Library } = await import('../server/library.js');
const { INSTELLING_SLEUTELS, INSTELLING_MAX } = await import('../src/ui/instellingen-opslag.js');

const fails = [];
const ok = (naam, cond, info = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (!cond && info ? `  (${info})` : '')); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

// Geen rmSync: de map staat in de tijdelijke map van het systeem (niets verwijderen).
const map = mkdtempSync(join(tmpdir(), 'varve-instellingen-'));
const db = join(map, 'library.db');
const poort = 20000 + Math.floor(Math.random() * 20000);
const B = `http://localhost:${poort}`;
let server = null, uit = '';

async function start() {
  uit = '';
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_TESTSERVER: '1', VARVE_MEDIA: join(map, 'media'), VARVE_OPNAMES: join(map, 'opnames'),
      VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'),
      VARVE_BACKUPS: join(map, 'backups'), VARVE_HERANALYSE: 'uit' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { uit += d; });
  server.stderr.on('data', (d) => { uit += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    if (await fetch(`${B}/api/instellingen`).then((r) => r.ok).catch(() => false)) return true;
    await wacht(80);
  }
  return false;
}
async function stop() {
  if (!server) return;
  server.kill('SIGTERM');
  await new Promise((z) => { server.on('exit', z); setTimeout(z, 3000); });
  server = null;
}

const json = async (pad, init) => { const r = await fetch(B + pad, init); return { status: r.status, j: await r.json().catch(() => null) }; };
const put = (sleutel, body, headers = { 'Content-Type': 'application/json' }) =>
  json(`/api/instellingen/${encodeURIComponent(sleutel)}`, { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

try {
  console.log('de witte lijst');
  ok('zeven instrument-sleutels (beeld telt drie): negen namen', INSTELLING_SLEUTELS.length === 9
    && ['varve.master.rack', 'varve.klankschaal', 'varve.midi.ports', 'varve.beeld.adres', 'varve.beeld.latentie', 'varve.beeld.aan',
      'varve.stems.standaard', 'varve.koptelefoon.omgewisseld', 'varve.vormen'].every((k) => INSTELLING_SLEUTELS.includes(k)));
  ok('niet op de lijst: mapping (eigen route), gemak-sleutels', !INSTELLING_SLEUTELS.includes('varve.mapping')
    && !INSTELLING_SLEUTELS.includes('varve.klankschaal.open') && !INSTELLING_SLEUTELS.includes('varve.log.altijd'));

  ok('de server start', await start(), uit.slice(-600));

  console.log('\nlege server');
  {
    const r = await json('/api/instellingen');
    ok('GET /api/instellingen: 200, niets bewaard', r.status === 200 && r.j && Object.keys(r.j.instellingen).length === 0);
    const e = await json('/api/instellingen/varve.master.rack');
    ok('GET van één sleutel: null, bewaard false', e.status === 200 && e.j.waarde === null && e.j.bewaard === false && e.j.sleutel === 'varve.master.rack');
  }

  console.log('\nonbekende sleutels: 400');
  for (const k of ['varve.mapping', 'varve.klankschaal.open', 'mapping', 'iets', '..%2fmapping', 'varve.master.rack.x']) {
    const g = await json(`/api/instellingen/${k}`);
    const p = await json(`/api/instellingen/${k}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"waarde":"x"}' });
    ok(`${k}: GET en PUT 400`, g.status === 400 && p.status === 400 && /onbekende instelling/.test(g.j?.fout), `${g.status}/${p.status}`);
  }
  ok('kapotte %-codering: 400, geen 500', (await json('/api/instellingen/%E0%A4%A')).status === 400);
  ok('de mapping is door die PUT niet geraakt', (await json('/api/mapping')).j?.mapping === null);

  console.log('\nschrijven en lezen');
  const rack = JSON.stringify({ versie: 1, naam: 'Warm', herkomst: 's:2', rack: { effecten: [{ type: 'filter', freq: 0.4 }] } });
  {
    const r = await put('varve.master.rack', { waarde: rack });
    ok('PUT master-rack: 200', r.status === 200 && r.j?.ok === true);
    const g = await json('/api/instellingen/varve.master.rack');
    ok('GET geeft precies dezelfde tekst terug, bewaard true', g.j?.waarde === rack && g.j?.bewaard === true);
    await put('varve.koptelefoon.omgewisseld', { waarde: '1' });
    await put('varve.beeld.adres', { waarde: 'ws://clayk:7702/app' });
    await put('varve.vormen', { waarde: null });
    const alles = (await json('/api/instellingen')).j?.instellingen;
    ok('GET alles: de vier bewaarde, null blijft null (gewist), de rest ontbreekt',
      alles && alles['varve.master.rack'] === rack && alles['varve.koptelefoon.omgewisseld'] === '1'
      && alles['varve.beeld.adres'] === 'ws://clayk:7702/app' && 'varve.vormen' in alles && alles['varve.vormen'] === null
      && !('varve.klankschaal' in alles) && Object.keys(alles).length === 4, JSON.stringify(alles));
    const v = await json('/api/instellingen/varve.vormen');
    ok('gewist = bewaard true met waarde null (een andere browser schrijft hem niet opnieuw omhoog)', v.j?.bewaard === true && v.j?.waarde === null);
    ok('een sleutel met een % erin (encodeURIComponent van de punten): gewoon gevonden',
      (await json(`/api/instellingen/${encodeURIComponent('varve.beeld.adres').replace(/\./g, '%2E')}`)).j?.waarde === 'ws://clayk:7702/app');
    await put('varve.koptelefoon.omgewisseld', { waarde: '0' });
    ok('overschrijven', (await json('/api/instellingen/varve.koptelefoon.omgewisseld')).j?.waarde === '0');
  }

  console.log('\nwat de server weigert');
  ok('geen waarde: 400', (await put('varve.klankschaal', {})).status === 400);
  ok('een getal: 400 (localStorage kent alleen tekst)', (await put('varve.stems.standaard', { waarde: 4 })).status === 400);
  ok('een object: 400', (await put('varve.klankschaal', { waarde: { a: 1 } })).status === 400);
  ok('geen JSON: 400', (await put('varve.klankschaal', 'nee{')).status === 400);
  ok('text/plain: 415', (await put('varve.klankschaal', { waarde: 'x' }, { 'Content-Type': 'text/plain' })).status === 415);
  ok('te groot: 413', (await put('varve.klankschaal', { waarde: 'x'.repeat(INSTELLING_MAX + 1) })).status === 413);
  ok('precies op de grens: 200', (await put('varve.klankschaal', { waarde: 'y'.repeat(INSTELLING_MAX) })).status === 200);
  ok('DELETE: 405 (wissen = PUT met null)', (await json('/api/instellingen/varve.klankschaal', { method: 'DELETE' })).status === 405);
  ok('PUT vanaf een andere oorsprong: 403', (await put('varve.klankschaal', { waarde: 'x' },
    { 'Content-Type': 'application/json', Origin: 'https://evil.example' })).status === 403);
  ok('niets van het geweigerde is bewaard', (await json('/api/instellingen/varve.klankschaal')).j?.waarde === 'y'.repeat(INSTELLING_MAX));
  await put('varve.klankschaal', { waarde: '{"volgen":"maat","volume":0.7}' });

  console.log('\nin library.db, ook na een herstart');
  await stop();
  {
    const lib = new Library(db);
    ok('tabel instellingen: de sleutel zoals in de browser, de waarde als JSON-tekst', lib.haal('varve.master.rack') === rack
      && lib.haal('varve.klankschaal') === '{"volgen":"maat","volume":0.7}');
    ok('de mapping staat ernaast, niet erin', lib.haal('mapping', 'geen') === 'geen');
    lib.sluit();
  }
  ok('de server start opnieuw', await start(), uit.slice(-600));
  const na = (await json('/api/instellingen')).j?.instellingen;
  ok('na de herstart: alles terug', na?.['varve.master.rack'] === rack && na?.['varve.beeld.adres'] === 'ws://clayk:7702/app'
    && na?.['varve.vormen'] === null && na?.['varve.koptelefoon.omgewisseld'] === '0');
} finally {
  await stop();
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles ok');
