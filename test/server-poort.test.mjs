// AR20 (16 okt, docs/verslagen/2026-10-15/ar-proef.md): een tweede server die naast een lopende start, kijkt
// EERST of de poort vrij is (server/poort.js) en stopt dan met exit 3, vóór hij iets op schijf doet. Vroeger
// ruimde hij eerst de .bezig-*-werkmappen op (een ingest of split van de eerste server mislukte) en zette hij
// de stems-rij terug, en zag hij pas bij listen() dat de poort bezet was.
// De poort is een vrije poort die het systeem kiest (geen vaste): de test kan naast de rest draaien.
// Draai met: node test/server-poort.test.mjs
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poortBezet } from '../server/poort.js';

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'varve-poort-'));

/** Een server die een vrije poort van het systeem bezet houdt. */
const bezetHouden = () => new Promise((klaar) => { const s = createServer(); s.listen(0, '127.0.0.1', () => klaar(s)); });

try {
  console.log('poortBezet');
  {
    const s = await bezetHouden();
    const p = s.address().port;
    ok(`een poort waar iemand op luistert: bezet (${p})`, await poortBezet(p));
    await new Promise((r) => s.close(r));
    ok('dezelfde poort na sluiten: vrij', !(await poortBezet(p)));
    ok('… en de proef laat hem vrij achter (twee keer na elkaar vrij)', !(await poortBezet(p)) && !(await poortBezet(p)));
  }

  console.log('\neen tweede server raakt niets aan');
  {
    const s = await bezetHouden();
    const poort = s.address().port;
    const media = join(tmp, 'media');
    // De werkmap van een ingest die op "de eerste server" loopt, en een stems-rij met een opdracht.
    mkdirSync(join(media, '.bezig-ingest-proef'), { recursive: true });
    writeFileSync(join(media, '.bezig-ingest-proef', 'deel.wav'), 'half binnengehaald');
    const rij = JSON.stringify({ versie: 1, opdrachten: [{ track: 'nr1', aantal: 4 }] });
    writeFileSync(join(media, 'stems-rij.json'), rij);
    const env = { ...process.env, PORT: String(poort), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_DB: join(media, 'library.db'),
      VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
      VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'),
      VARVE_SETS: join(tmp, 'sets'), VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'),
      VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'),
      VARVE_HERANALYSE: 'uit' };
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(WORTEL, 'server/index.js')], { env, encoding: 'utf8', timeout: 20000 });
    const ms = Date.now() - t0;
    ok(`exitcode 3 (de herstartlus start dan niet opnieuw) (${r.status}, ${ms} ms)`, r.status === 3);
    ok('de melding zegt dat de poort bezet is en dat er niets is aangeraakt', /poort \d+ is bezet/.test(r.stderr) && /niets aangeraakt/.test(r.stderr), r.stderr.trim().split('\n').pop());
    ok('de werkmap van de lopende ingest staat er nog, met inhoud', existsSync(join(media, '.bezig-ingest-proef', 'deel.wav')));
    ok('de stems-rij is niet aangeraakt', readFileSync(join(media, 'stems-rij.json'), 'utf8') === rij);
    ok('er is geen library.db gemaakt of geopend', !existsSync(join(media, 'library.db')) && !existsSync(join(media, 'library.db-wal')));
    ok('geen backups-, plannen- of patronenmap gemaakt', !existsSync(join(tmp, 'backups')) && !existsSync(join(tmp, 'plannen')) && !existsSync(join(tmp, 'patronen')));
    await new Promise((res) => s.close(res));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
