// AR9 (16 okt, docs/VRAGEN.md): een herstart van de server in de Controlekamer. De herstartlus geeft elke nieuwe
// server mee wat hij weet (VARVE_LUS_SINDS, _AANTAL, _HERSTARTS; tools/varve-app/server-lus.sh, getoetst in
// server-lus.test), de server leest het (server/lus.js) en geeft het in GET /api/leeft, de tegel Server
// (src/controle/server-tegel.js) maakt er een regel van. Hier: het lezen, de regel en de tegel (puur), en een echte
// server met die omgeving op een vrije poort.
// Draai met: node test/herstart.test.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leesLus } from '../server/lus.js';
import { serverTegel, herstartRegel, HERSTART_RECENT_MS } from '../src/controle/server-tegel.js';

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
// Lokale tijden (de tegel toont de klok van de pagina): zo hangt de test niet van de tijdzone af.
const om = (u, m) => new Date(2026, 9, 16, u, m, 0).getTime();

console.log('leesLus (de omgeving van de server)');
{
  ok('niet onder de lus: onder false, geen herstarts', JSON.stringify(leesLus({})) === JSON.stringify({ onder: false, sinds: null, aantal: 0, herstarts: [] }));
  ok('een rare VARVE_LUS_SINDS telt als niet onder de lus', !leesLus({ VARVE_LUS_SINDS: 'gisteren' }).onder && !leesLus({ VARVE_LUS_SINDS: '-3' }).onder);
  const l = leesLus({ VARVE_LUS_SINDS: '1792060000', VARVE_LUS_AANTAL: '0', VARVE_LUS_HERSTARTS: '' });
  ok('onder de lus zonder herstart', l.onder && l.sinds === 1792060000000 && l.aantal === 0 && l.herstarts.length === 0);
  const h = leesLus({ VARVE_LUS_SINDS: '1792060000', VARVE_LUS_AANTAL: '25', VARVE_LUS_HERSTARTS: '1792060100:137:om  1792060200:137:hang' });
  ok('twee herstarts: tijd in ms, exitcode, hang (en een dubbele spatie doet niets)',
    h.herstarts.length === 2 && h.herstarts[0].t === 1792060100000 && h.herstarts[0].code === 137 && !h.herstarts[0].hang && h.herstarts[1].hang);
  ok('het aantal mag groter zijn dan de lijst (de lus houdt er 20)', h.aantal === 25);
  const kapot = leesLus({ VARVE_LUS_SINDS: '1792060000', VARVE_LUS_AANTAL: 'x', VARVE_LUS_HERSTARTS: '1792060100:137:om rommel 12:ab:om 5:1:nogwat' });
  ok('wat niet te lezen is valt weg; een kapot aantal wordt de lengte van de lijst', kapot.herstarts.length === 1 && kapot.aantal === 1);
  ok('een aantal kleiner dan de lijst klopt niet: de lengte', leesLus({ VARVE_LUS_SINDS: '1', VARVE_LUS_AANTAL: '0', VARVE_LUS_HERSTARTS: '2:1:om 3:1:om' }).aantal === 2);
}

console.log('\nde regel en de tegel');
{
  const lus = (herstarts, aantal = herstarts.length) => ({ onder: true, sinds: om(21, 30), aantal, herstarts });
  ok('een oudere server (geen lus in het antwoord): geen regel', herstartRegel(null).tekst === '' && herstartRegel(undefined).tekst === '');
  ok('onder de lus, nooit herstart: geen regel', herstartRegel(lus([])).tekst === '');
  ok('niet onder de lus: dat zeggen (valt hij om, dan start niemand hem)',
    /^zonder herstartlus/.test(herstartRegel({ onder: false, sinds: null, aantal: 0, herstarts: [] }).tekst));
  const een = herstartRegel(lus([{ t: om(22, 14), code: 137, hang: false }]), om(22, 15));
  ok(`één keer omgevallen: "${een.tekst}"`, een.tekst === 'herstart om 22:14 (viel om, exitcode 137) · 1 keer sinds 21:30' && een.recent);
  const hang = herstartRegel(lus([{ t: om(22, 14), code: 137, hang: false }, { t: om(23, 2), code: 137, hang: true }], 2), om(23, 3));
  ok(`de laatste was een hang: "${hang.tekst}"`, hang.tekst === 'herstart om 23:02 (hing, de wachter zette hem neer) · 2 keer sinds 21:30');
  ok('het aantal komt van de lus, niet van de lijst', /· 25 keer/.test(herstartRegel(lus([{ t: om(22, 14), code: 1, hang: false }], 25)).tekst));
  ok('recent tot 10 minuten, daarna niet meer (de regel blijft)',
    herstartRegel(lus([{ t: om(22, 14), code: 1 }]), om(22, 14) + HERSTART_RECENT_MS - 1).recent
    && !herstartRegel(lus([{ t: om(22, 14), code: 1 }]), om(22, 14) + HERSTART_RECENT_MS).recent);
  ok('een herstart zonder tijd of code telt niet (geen NaN)', herstartRegel(lus([{ t: NaN, code: 1 }, { code: 3 }])).tekst === '');

  const secties = { totaal: 40, zonder: 0, verouderd: 0 };
  const zonder = serverTegel({ server: true, nummers: 40, secties, lus: lus([]) });
  ok('de tegel zonder herstart: precies als vroeger (groen, alleen de secties)', zonder.licht === 'ok' && zonder.regel === 'secties: alles actueel');
  const net = serverTegel({ server: true, nummers: 40, secties, lus: lus([{ t: om(22, 14), code: 137 }]), nu: om(22, 16) });
  ok(`net herstart: oranje, de herstart boven de secties ("${net.regel.replace('\n', ' ⏎ ')}")`,
    net.licht === 'half' && net.waarde === 'draait' && net.regel.split('\n').length === 2 && /^herstart om 22:14/.test(net.regel) && /secties/.test(net.regel.split('\n')[1]));
  const later = serverTegel({ server: true, nummers: 40, secties, lus: lus([{ t: om(22, 14), code: 137 }]), nu: om(23, 0) });
  ok('na 10 minuten weer groen, de regel blijft', later.licht === 'ok' && /^herstart om 22:14/.test(later.regel));
  const weg = serverTegel({ server: false, lus: lus([{ t: om(22, 14), code: 137 }]) });
  ok('server weg: rood, geen herstartregel (die is dan niet te weten)', weg.licht === 'fout' && weg.regel === '');
  ok('de tegel is gewone data (te klonen)', JSON.stringify(structuredClone(net)) === JSON.stringify(net));
}

console.log('\neen echte server met de omgeving van de lus');
{
  const vrij = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const tmp = mkdtempSync(join(tmpdir(), 'varve-herstart-'));
  const env = { ...process.env, PORT: String(vrij), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'), VARVE_DB: join(tmp, 'lib.db'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'),
    VARVE_SETS: join(tmp, 'sets'), VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'),
    VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'),
    VARVE_HERANALYSE: 'uit', VARVE_LUS_SINDS: '1792060000', VARVE_LUS_AANTAL: '1', VARVE_LUS_HERSTARTS: '1792060100:137:hang' };
  const srv = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { env, stdio: 'ignore' });
  try {
    let l = null;
    for (let i = 0; i < 100 && !l; i++) {
      l = await fetch(`http://127.0.0.1:${vrij}/api/leeft`).then((r) => r.json(), () => null);
      if (!l) await slaap(100);
    }
    ok('/api/leeft geeft wat de lus meegaf', l?.lus?.onder === true && l.lus.sinds === 1792060000000 && l.lus.aantal === 1
      && l.lus.herstarts.length === 1 && l.lus.herstarts[0].hang === true, JSON.stringify(l?.lus));
    ok('… en wanneer deze server startte (ms, net)', Number.isFinite(l?.gestart) && Math.abs(Date.now() - l.gestart) < 30000);
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => srv.once('exit', r));
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
