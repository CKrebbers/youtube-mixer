// Controlekamer × secties (TASKS-SECTIES "Verweven", punt 10): in de tegel
// Server een regel met hoeveel nummers (nog) geen actuele secties hebben.
//  1. De tegel (puur, src/controle/server-tegel.js): de regel bij elke stand,
//     ook een oudere server zonder de route (404) en een lege library.
//  2. Library.sectieTelling: zonder kaart, verouderd (oudere SECTIE_VERSIE, een
//     ander grid, stems erbij), met de hand of op slot = actueel; dezelfde regel
//     als teSectieAnalyseren; gecachet op de stand van de database (ook een
//     andere verbinding), dus niet elke 2 s alles parsen.
//  3. GET /api/secties op een echte server: de telling, en ze volgt een nieuw
//     grid en een weggehaald nummer; alleen GET, en niet voor een vreemde Host.
// Draai met: node test/sec-controle.test.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
/** Een blok dat gooit is rood, niet een crash die de rest verbergt. */
async function blok(naam, fn) {
  try { await fn(); } catch (err) { ok(`${naam}: liep door zonder fout (${err?.message ?? err})`, false); }
}
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));
const map = mkdtempSync(join(tmpdir(), 'varve-sec-controle-'));

// ---- 1. de tegel (puur) ---------------------------------------------------------------

console.log('de tegel Server met de regel secties (puur)');
await blok('de tegel', async () => {
  const { serverTegel, sectiesRegel } = await import('../src/controle/server-tegel.js');
  // De regel zoals je hem leest (de harde spaties binnen een deel als gewone).
  const regel = (x) => sectiesRegel(x).replace(/\u00a0/g, ' ');
  ok('nog niets gehoord: geen regel', sectiesRegel(null) === '' && sectiesRegel(undefined) === '');
  ok('een oudere server zonder /api/secties (404): "onbekend", geen fout',
    sectiesRegel({ ontbreekt: true }) === 'secties: onbekend (oudere server)');
  ok('lege library: geen regel', sectiesRegel({ totaal: 0, zonder: 0, verouderd: 0 }) === '');
  ok('alles actueel', regel({ totaal: 40, zonder: 0, verouderd: 0 }) === 'secties: alles actueel');
  ok('alleen nog zonder', regel({ totaal: 40, zonder: 12, verouderd: 0 }) === 'secties: 12 nog zonder');
  ok('alleen verouderd', regel({ totaal: 40, zonder: 0, verouderd: 3 }) === 'secties: 3 verouderd');
  ok('allebei', regel({ totaal: 40, zonder: 12, verouderd: 3 }) === 'secties: 12 nog zonder · 3 verouderd');
  ok('in een smalle tegel breekt hij alleen bij de " · " (harde spaties binnen een deel)',
    sectiesRegel({ totaal: 40, zonder: 12, verouderd: 3 }) === 'secties: 12\u00a0nog\u00a0zonder · 3\u00a0verouderd');
  ok('een fout van de server (500, bv. een library.db met de v9 van een andere tak): "onbekend (fout)"',
    sectiesRegel({ fout: 500 }) === 'secties: onbekend (fout)');
  ok('een antwoord dat niet klopt: geen regel (geen "NaN"): zonder of met NaN als totaal, zonder zonder',
    sectiesRegel({ zonder: 1, verouderd: 0 }) === '' && sectiesRegel({ totaal: NaN, zonder: 1, verouderd: 0 }) === ''
    && sectiesRegel({ totaal: '3', zonder: 1, verouderd: 0 }) === '' && sectiesRegel({ totaal: 3 }) === '');

  const draait = serverTegel({ server: true, nummers: 40, secties: { totaal: 40, zonder: 12, verouderd: 3 } });
  ok(`server draait: dezelfde tegel als eerst, plus de regel ("${draait.sub}" / "${draait.regel}")`, draait.naam === 'Server'
    && draait.licht === 'ok' && draait.waarde === 'draait' && draait.sub === 'library: 40 nummers'
    && draait.regel === sectiesRegel({ totaal: 40, zonder: 12, verouderd: 3 }));
  ok('nummers nog onbekend: lege sub', serverTegel({ server: true, nummers: null, secties: null }).sub === '');
  const weg = serverTegel({ server: false, nummers: 40, secties: { totaal: 40, zonder: 1, verouderd: 0 } });
  ok('server weg: rood, en geen regel over secties (die is dan niet te weten)', weg.licht === 'fout'
    && weg.waarde === 'niet bereikbaar' && weg.regel === '');
  const nogNiet = serverTegel({ server: null, nummers: null, secties: null });
  ok('nog geen antwoord: grijs, "…", geen regel', nogNiet.licht === 'uit' && nogNiet.waarde === '…' && nogNiet.regel === '');
  ok('de tegel is gewone data (te klonen)', JSON.stringify(structuredClone(draait)) === JSON.stringify(draait));
});

// ---- 2. Library.sectieTelling -----------------------------------------------------------

const { Library } = await import('../server/library.js');
const { SECTIE_VERSIE, gridSleutel } = await import('../server/secties.js');

const GRID = { stukken: [{ van: 0, bpm: 124, anker: 0.25 }], beatsPerBar: 4 };
const ANDER_GRID = { stukken: [{ van: 0, bpm: 126, anker: 0.1 }], beatsPerBar: 4 };
const STUKKEN = [{ van: 0, label: 'intro', groep: 'A', energie: 0.2 }, { van: 30.97, label: 'drop', groep: 'B', energie: 1 }];
const nummer = (lib, id) => lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 200,
  audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
const kaart = (lib, id, extra = {}) => lib.bewaarSecties(id, { versie: SECTIE_VERSIE, opGrid: true,
  grid: gridSleutel(lib.track(id).grid), stukken: STUKKEN, bron: 'auto', ...extra });

/**
 * Een library met van alles: twee zonder kaart, één actueel, één van een
 * oudere versie, één op een ander grid, één zonder grid gerekend (er is er nu
 * wel een), één zonder stems (die zijn er nu wel), en twee die nooit opnieuw
 * hoeven (met de hand, op slot), ook al zijn ze oud en op een ander grid.
 * Geeft wat de telling moet zijn.
 */
function vul(lib) {
  for (const id of ['geen1', 'geen2', 'actueel', 'oud', 'anders', 'zondergrid', 'stems', 'hand', 'slot']) {
    nummer(lib, id);
    lib.bewaarGrid(id, GRID);
  }
  kaart(lib, 'actueel');
  kaart(lib, 'oud', { versie: null });                              // van vóór SECTIE_VERSIE
  kaart(lib, 'anders', { grid: gridSleutel(ANDER_GRID) });
  kaart(lib, 'zondergrid', { opGrid: false, grid: null });
  lib.bewaarStems('stems', { aantal: 2, namen: ['vocals', 'inst'], schaal: 1, bestand: 'media/stems/stems.wav' });
  kaart(lib, 'stems');                                              // zonder stems gerekend, niet geprobeerd
  kaart(lib, 'hand', { versie: null, grid: gridSleutel(ANDER_GRID), bron: 'hand' });
  kaart(lib, 'slot', { versie: null, grid: gridSleutel(ANDER_GRID), slot: true });
  return { totaal: 9, zonder: 2, verouderd: 4 };
}

console.log('\nLibrary.sectieTelling');
await blok('de telling', async () => {
  const lib = new Library(join(map, 'telling.db'));
  try {
    ok('lege library: alles 0', JSON.stringify(lib.sectieTelling()) === JSON.stringify({ totaal: 0, zonder: 0, verouderd: 0 }));
    const verwacht = vul(lib);
    const t = lib.sectieTelling();
    ok(`de telling (${JSON.stringify(t)})`, t.totaal === verwacht.totaal && t.zonder === verwacht.zonder && t.verouderd === verwacht.verouderd);
    const te = lib.teSectieAnalyseren();
    ok(`dezelfde regel als teSectieAnalyseren (${te.join(', ')})`, t.zonder + t.verouderd === te.length
      && t.zonder === te.filter((id) => !lib.secties(id)).length);
    ok('met de hand of op slot telt als actueel (wordt nooit opnieuw berekend)', !te.includes('hand') && !te.includes('slot'));
    const hoger = lib.sectieTelling({ versie: SECTIE_VERSIE + 1 });
    ok(`een nieuwe SECTIE_VERSIE: elke automatische kaart verouderd (${hoger.verouderd})`, hoger.zonder === 2 && hoger.verouderd === 5);
    ok('... en dan weer de gewone versie', lib.sectieTelling().verouderd === 4);

    // Gecachet: zonder wijziging hetzelfde antwoord, niet opnieuw gerekend.
    const a = lib.sectieTelling();
    ok('zonder wijziging: hetzelfde antwoord (niet opnieuw gerekend)', lib.sectieTelling() === a);
    kaart(lib, 'geen1');
    const b = lib.sectieTelling();
    ok(`een nummer krijgt een kaart: één minder zonder (${b.zonder})`, b !== a && b.zonder === 1 && b.verouderd === 4);
    lib.bewaarGrid('actueel', ANDER_GRID);
    ok(`een ander grid: die kaart is verouderd (${lib.sectieTelling().verouderd})`, lib.sectieTelling().verouderd === 5);
    lib.bewaarStems('stems', null);
    ok('stems weer weg: die kaart is weer actueel', lib.sectieTelling().verouderd === 4);
    lib.verwijderTrack('geen2');
    ok('een nummer weg: één minder in totaal en zonder', lib.sectieTelling().totaal === 8 && lib.sectieTelling().zonder === 0);

    // Een andere verbinding (een tool die rechtstreeks schrijft): PRAGMA data_version.
    const c = lib.sectieTelling();
    const ander = new DatabaseSync(join(map, 'telling.db'));
    ander.prepare('UPDATE tracks SET secties_json = NULL WHERE id = ?').run('actueel');
    ander.close();
    const d = lib.sectieTelling();
    // 'actueel' (verouderd door het andere grid) is nu zonder; over: oud, anders, zondergrid.
    ok(`een wijziging van een andere verbinding telt ook (${d.zonder} zonder, ${d.verouderd} verouderd)`, d !== c
      && d.zonder === 1 && d.verouderd === 3);
    lib.db.prepare("UPDATE tracks SET secties_json = '{ kapot' WHERE id = 'oud'").run();
    ok('een onleesbare kaart telt als zonder (zoals moetSecties)', lib.sectieTelling().zonder === 2 && lib.sectieTelling().verouderd === 2
      && lib.moetSecties('oud'));
    const zelfde = () => { const x = lib.sectieTelling(), te2 = lib.teSectieAnalyseren();
      return x.zonder + x.verouderd === te2.length && x.zonder === te2.filter((id) => !lib.secties(id)).length; };

    // Een nummer van vóór grid_json: alleen de oude kolommen (grid_bpm, grid_first_beat, grid_beats_per_bar).
    nummer(lib, 'oudgrid');
    lib.db.prepare("UPDATE tracks SET grid_json = NULL, grid_bpm = 124, grid_first_beat = 0.25, grid_beats_per_bar = 4 WHERE id = 'oudgrid'").run();
    kaart(lib, 'oudgrid');
    ok('alleen de oude gridkolommen: de kaart op dat grid is actueel (zoals moetSecties)', lib.track('oudgrid').grid
      && !lib.moetSecties('oudgrid') && lib.sectieTelling().verouderd === 2 && zelfde());
    // stems_json onleesbaar: dan heeft het nummer geen stems (zoals track()), dus een kaart zonder stems is actueel.
    nummer(lib, 'stemskapot');
    lib.bewaarGrid('stemskapot', GRID);
    kaart(lib, 'stemskapot');
    lib.db.prepare("UPDATE tracks SET stems_json = 'kapot' WHERE id = 'stemskapot'").run();
    ok('stems_json kapot: geen stems, de kaart is actueel (zoals moetSecties)', !lib.moetSecties('stemskapot')
      && lib.sectieTelling().verouderd === 2 && zelfde());

    // Een miss parst alleen wat veranderde (review 1): tel JSON.parse tijdens de vraag.
    const echteParse = JSON.parse;
    const parses = (fn) => { let n = 0; JSON.parse = (...x) => { n++; return echteParse(...x); }; try { fn(); } finally { JSON.parse = echteParse; } return n; };
    lib.sectieTelling();
    lib.geladen('actueel');                                          // een schrijfactie die de secties niet raakt
    const los = parses(() => lib.sectieTelling());
    ok(`een schrijfactie buiten grid, stems en kaart: niets opnieuw geparst (${los}× JSON.parse)`, los === 0);
    kaart(lib, 'geen1', { grid: gridSleutel(ANDER_GRID) });         // één nummer anders: nu verouderd
    let telling;
    const een = parses(() => { telling = lib.sectieTelling(); });
    ok(`één nummer van de ${telling.totaal} anders: alleen dat nummer geparst (${een}× JSON.parse), telling klopt`, een > 0 && een <= 3
      && telling.verouderd === 3 && zelfde());

    // Een transactie die terugdraait (review 2): total_changes daalt niet en data_version blijft voor de eigen verbinding.
    const voor = lib.sectieTelling();
    lib.db.exec('BEGIN');
    lib.db.prepare("UPDATE tracks SET secties_json = NULL WHERE id = 'hand'").run();
    const tijdens = lib.sectieTelling();
    lib.db.exec('ROLLBACK');
    const na = lib.sectieTelling();
    ok(`een transactie die terugdraait: daarna weer de telling van ervoor (zonder ${voor.zonder} → ${tijdens.zonder} → ${na.zonder})`,
      tijdens.zonder === voor.zonder + 1 && na.zonder === voor.zonder && na.verouderd === voor.verouderd && zelfde());
  } finally { lib.sluit(); }
});

await blok('wat het kost', async () => {
  const lib = new Library(join(map, 'groot.db'));
  try {
    const N = 2000;
    lib.db.exec('BEGIN');
    for (let i = 0; i < N; i++) {
      const id = `n${i}`;
      nummer(lib, id);
      lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 100 + (i % 60), anker: 0.1 }, { van: 150, bpm: 121, anker: 150.2 }], beatsPerBar: 4 });
      if (i % 3) lib.bewaarSecties(id, { versie: SECTIE_VERSIE, opGrid: true, grid: gridSleutel(lib.track(id).grid), bron: 'auto',
        stukken: Array.from({ length: 20 }, (_, j) => ({ van: j * 15, label: 'deel', groep: 'ABCD'[j % 4], energie: 0.5, zeker: 0.8 })) });
    }
    lib.db.exec('COMMIT');
    let t0 = performance.now();
    const t = lib.sectieTelling();
    const eerst = performance.now() - t0;
    t0 = performance.now();
    for (let i = 0; i < 100; i++) lib.sectieTelling();
    const daarna = (performance.now() - t0) / 100;
    ok(`${N} nummers: ${t.zonder} zonder (eerste keer ${eerst.toFixed(0)} ms, daarna ${(daarna * 1000).toFixed(0)} µs per vraag)`,
      t.totaal === N && t.zonder === Math.ceil(N / 3) && t.verouderd === 0 && daarna < eerst / 5);
    // Een miss na één schrijfactie (zoals de achtergrond die elke paar seconden iets bewaart): niet alles opnieuw.
    const missen = [];
    for (let i = 0; i < 10; i++) {
      lib.bewaarSecties(`n${3 * i}`, { versie: SECTIE_VERSIE, opGrid: true, grid: gridSleutel(lib.track(`n${3 * i}`).grid), bron: 'auto',
        stukken: [{ van: 0, label: 'intro', groep: 'A', energie: 0.2 }] });
      t0 = performance.now();
      lib.sectieTelling();
      missen.push(performance.now() - t0);
    }
    missen.sort((a, b) => a - b);
    const miss = missen[5];
    ok(`na één schrijfactie: ${miss.toFixed(1)} ms (mediaan van 10), minder dan de helft van de eerste keer (${eerst.toFixed(0)} ms)`,
      miss < eerst / 2 && lib.sectieTelling().zonder === Math.ceil(N / 3) - 10);
  } finally { lib.sluit(); }
});

// ---- 3. GET /api/secties op een echte server -------------------------------------------------

console.log('\nGET /api/secties');
await blok('de route', async () => {
  const db = join(map, 'server.db');
  { const lib = new Library(db); vul(lib); lib.sluit(); }
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_MEDIA: join(map, 'media'), VARVE_OPNAMES: join(map, 'opnames'),
      VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_HERANALYSE: 'uit' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (x) => { log += x; });
  server.stderr.on('data', (x) => { log += x; });
  const B = `http://localhost:${poort}`;
  const rauw = (pad, headers = {}) => new Promise((z) => {
    const rq = request({ host: '127.0.0.1', port: poort, path: pad, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => {
      res.resume(); res.on('end', () => z(res.statusCode));
    });
    rq.on('error', () => z(0));
    rq.end();
  });
  try {
    for (let i = 0; i < 100; i++) { if (await fetch(`${B}/api/opnames`).then((r) => r.ok, () => false)) break; await wacht(100); }
    const r = await fetch(`${B}/api/secties`);
    const t = await r.json().catch(() => null);
    ok(`GET /api/secties: ${r.status} ${JSON.stringify(t)}`, r.status === 200 && t?.totaal === 9 && t.zonder === 2 && t.verouderd === 4
      && t.versie === SECTIE_VERSIE);
    const g = await fetch(`${B}/api/library/actueel/grid`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grid: ANDER_GRID }) });
    const na = await (await fetch(`${B}/api/secties`)).json();
    ok(`een nieuw grid via de server: meteen een verouderde meer (${na.verouderd})`, g.ok && na.verouderd === 5 && na.zonder === 2);
    await fetch(`${B}/api/library/geen1`, { method: 'DELETE' });
    const weg = await (await fetch(`${B}/api/secties`)).json();
    ok(`een nummer weg: ${weg.totaal} in totaal, ${weg.zonder} zonder`, weg.totaal === 8 && weg.zonder === 1);
    ok('alleen GET', (await fetch(`${B}/api/secties`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 404);
    ok('een vreemde Host: 403', (await rauw('/api/secties', { Host: `varve.evil.example:${poort}` })) === 403);
  } finally {
    server.kill();
    if (fails.length) console.log(log.split('\n').slice(-15).join('\n'));
  }
});

await wacht(200);
rmSync(map, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
