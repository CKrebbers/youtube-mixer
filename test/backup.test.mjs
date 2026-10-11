// Backups van de library (server/backup.js): een geldige kopie met dezelfde
// inhoud (ook wat nog in de WAL staat), geen nieuwe kopie zonder wijziging,
// opruimen binnen de grens, een mislukte backup gooit niet, en via HTTP is
// geen kopie te lezen. Alles in een tijdelijke map: je echte library blijft
// buiten schot. Draai met: node test/backup.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const { Library, SCHEMA } = await import('../server/library.js');
const { Backups, wegTeGooien, naamVoor, leesNaam, kopieen, BEWAAR_LAATSTE, BEWAAR_DAGEN } = await import('../server/backup.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-backup-'));
const kopieIn = (m) => readdirSync(m).filter((n) => leesNaam(n));

try {
  // ---- namen en opruimen: puur ------------------------------------------------
  console.log('namen en opruimen');
  {
    const d = new Date(2026, 9, 2, 14, 5, 33);
    ok('naam in lokale tijd', naamVoor(d) === 'library-2026-10-02_14-05-33.db');
    ok('naam terug gelezen', leesNaam(naamVoor(d))?.dag === '2026-10-02');
    ok('vreemde namen zijn geen kopie', ['library.db', 'library-2026-10-02_14-05-33.db.bak', 'notities.txt',
      '.bezig-backup-1-x.db', 'library-2026-1-2_14-05-33.db'].every((n) => leesNaam(n) === null));
    ok('-2 is nieuwer dan dezelfde seconde zonder', kopieen(['library-2026-10-02_14-05-33.db', 'library-2026-10-02_14-05-33-2.db'])[0].naam
      === 'library-2026-10-02_14-05-33-2.db');

    // 45 dagen, drie per dag (vandaag alleen de twee van vóór nu).
    const nu = new Date(2026, 9, 2, 15, 0, 0);
    const namen = ['notities.txt', 'library.db', 'library-2026-08-01_09-00-00.db.bak'];
    for (let dag = 0; dag < 45; dag++) {
      for (const uur of [9, 13, 20]) {
        const t = new Date(2026, 9, 2 - dag, uur, 0, 0);
        if (t <= nu) namen.push(naamVoor(t));
      }
    }
    const weg = new Set(wegTeGooien(namen, nu));
    const blijft = kopieen(namen).filter((k) => !weg.has(k.naam));
    const nieuwste = kopieen(namen).slice(0, BEWAAR_LAATSTE).map((k) => k.naam);
    const perDag = new Map();
    for (const k of kopieen(namen)) if (!perDag.has(k.dag)) perDag.set(k.dag, k.naam);
    const binnen30 = [...perDag.entries()].filter(([dag]) => dag >= '2026-09-03').map(([, n]) => n);
    ok(`de ${BEWAAR_LAATSTE} nieuwste blijven`, nieuwste.every((n) => !weg.has(n)));
    ok(`de nieuwste van elke dag van de laatste ${BEWAAR_DAGEN} dagen blijft (${binnen30.length})`,
      binnen30.length === BEWAAR_DAGEN && binnen30.every((n) => !weg.has(n)));
    ok(`verder niets: ${blijft.length} van ${kopieen(namen).length} (12 + 25 dagen buiten de 12)`, blijft.length === 37);
    ok('ouder dan 30 dagen: alles weg', blijft.every((k) => k.dag >= '2026-09-03'));
    ok('vreemde bestanden worden nooit weggegooid', !weg.has('notities.txt') && !weg.has('library.db')
      && !weg.has('library-2026-08-01_09-00-00.db.bak'));
    ok('nooit meer dan laatste + dagen', blijft.length <= BEWAAR_LAATSTE + BEWAAR_DAGEN);
    ok('opnieuw opruimen gooit niets meer weg', wegTeGooien(blijft.map((k) => k.naam), nu).length === 0);
  }

  // ---- de tegel in de Controlekamer ------------------------------------------------
  console.log('\nde tegel in de Controlekamer');
  {
    const { backupTegel } = await import('../src/controle/backup-tegel.js');
    const nu = new Date(2026, 9, 2, 15, 0, 0);
    const t1 = backupTegel({ laatste: { naam: 'x', tijd: new Date(2026, 9, 2, 14, 5).getTime(), bytes: 1.5e6 }, aantal: 3, fout: null }, nu);
    ok(`vandaag: groen, tijd, aantal en grootte ("${t1.waarde}" · "${t1.sub}")`, t1.naam === 'Backup' && t1.licht === 'ok'
      && t1.waarde === '14:05' && t1.sub === '3 kopieën · 1,5 MB');
    const t2 = backupTegel({ laatste: { tijd: new Date(2026, 9, 1, 22, 10).getTime() }, aantal: 1, fout: null }, nu);
    ok(`gisteren ("${t2.waarde}", "${t2.sub}")`, t2.waarde === 'gisteren 22:10' && t2.sub === '1 kopie');
    const t3 = backupTegel({ laatste: { tijd: new Date(2026, 8, 20, 9, 0).getTime() }, aantal: 1, fout: null }, nu);
    ok(`langer geleden: datum, en toch groen ("${t3.waarde}")`, /20 sep 09:00/.test(t3.waarde) && t3.licht === 'ok');
    const t4 = backupTegel({ laatste: { tijd: 1 }, aantal: 1, fout: 'ENOSPC: no space left on device' }, nu);
    ok('fout: rood met de reden', t4.licht === 'fout' && t4.waarde === 'mislukt' && /ENOSPC/.test(t4.sub));
    ok('nog geen kopie: oranje', backupTegel({ laatste: null, aantal: 0, fout: null }, nu).licht === 'half');
    ok('server weg of oud: grijs', backupTegel(null, nu).licht === 'uit');
  }

  // ---- een echte library ----------------------------------------------------------
  console.log('\nkopie van een echte library');
  const dbPad = join(map, 'een', 'library.db');
  const lib = new Library(dbPad);
  // Alles in de WAL laten staan: zo blijkt dat de kopie niet het bestand is.
  lib.db.exec('PRAGMA wal_autocheckpoint = 0');
  lib.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const id of ['nummerA', 'nummerB', 'nummerC']) {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: `Élan ${id}`, uploader: 't', duur: 200,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  }
  lib.bewaarGrid('nummerA', { stukken: [{ van: 0, bpm: 124, anker: 0.12 }, { van: 90, bpm: 126, anker: 90.3, maat: 91.25 }], slot: true, bron: 'hand' });
  lib.bewaarToon('nummerA', { stukken: [{ van: 0, toonsoort: 'Am', stemming: 12, zekerheid: 0.6 }], bron: 'hand', slot: true });
  lib.bewaarHotcue('nummerA', { nr: 1, tijd: 12.5 });
  lib.bewaarHotcue('nummerB', { nr: 3, tijd: 99.25 });
  lib.bewaarRack({ trackId: 'nummerA', naam: 'mijn rack “é”', data: { keten: [{ type: 'filter' }] }, actief: true });
  lib.bewaarSample('nummerC', { pad: 2, van: 10, tot: 12, tellen: 4, bpm: 120 });
  lib.zet('mapping', { kind: 'diff', device: 'apc40mk2', rules: [{ sig: 'cc:0:48', action: 'track.1.filter' }] });

  // Ter vergelijking: het bestand gewoon kopiëren mist wat in de WAL staat.
  const rauw = join(map, 'rauw.db');
  copyFileSync(dbPad, rauw);
  let rauwHotcues;
  try { const r = new DatabaseSync(rauw, { readOnly: true }); rauwHotcues = r.prepare('SELECT COUNT(*) AS n FROM hotcues').get().n; r.close(); }
  catch { rauwHotcues = 'geen database'; }
  ok(`het bestand kopiëren mist de WAL (hotcues: ${rauwHotcues})`, rauwHotcues !== 2);

  const bmap = join(map, 'een', 'backups');
  let klok = new Date(2026, 9, 2, 10, 0, 0);
  const logs = [];
  const b = new Backups({ db: dbPad, map: bmap, wijzigingen: () => lib.wijzigingen(), elke: 0,
    log: (s) => logs.push(s), klok: () => klok });
  const r1 = await b.nu('opstarten');
  ok('eerste backup: nieuw', r1.ok && r1.nieuw && kopieIn(bmap).length === 1);
  const kopie = join(bmap, kopieIn(bmap)[0]);
  {
    const k = new DatabaseSync(kopie, { readOnly: true });
    const tabel = (db, t, orde) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY ${orde}`).all());
    const tabellen = [['tracks', 'id'], ['hotcues', 'track_id, nr'], ['racks', 'id'], ['samples', 'track_id, pad'],
      ['instellingen', 'sleutel'], ['peaks', 'track_id']];
    ok('alle tabellen gelijk aan het origineel', tabellen.every(([t, o]) => tabel(k, t, o) === tabel(lib.db, t, o)));
    ok('ook wat alleen in de WAL stond (twee hotcues)', k.prepare('SELECT COUNT(*) AS n FROM hotcues').get().n === 2);
    ok('quick_check ok', k.prepare('PRAGMA quick_check').get().quick_check === 'ok');
    ok(`schema-versie gelijk (v${SCHEMA.length})`, k.prepare('PRAGMA user_version').get().user_version === SCHEMA.length);
    ok('één los bestand (journal delete, geen WAL nodig)', k.prepare('PRAGMA journal_mode').get().journal_mode === 'delete'
      && !existsSync(kopie + '-wal'));
    k.close();
  }
  {
    // Terugzetten zoals docs/LIBRARY.md het zegt: de kopie wordt library.db.
    const terug = join(map, 'terug', 'library.db');
    mkdirSync(join(map, 'terug'), { recursive: true });
    copyFileSync(kopie, terug);
    const t = new Library(terug);
    const a = t.track('nummerA');
    ok('teruggezet: grid op slot, toonsoort, hotcues, rack, mapping', a?.grid?.slot === true && a.grid.stukken[1].maat === 91.25
      && a.toon?.slot === true && t.hotcues('nummerB')[0]?.tijd === 99.25 && t.racks('nummerA')[0]?.naam === 'mijn rack “é”'
      && t.haal('mapping')?.rules?.[0]?.action === 'track.1.filter');
    t.sluit();
  }

  console.log('\ngeen nieuwe kopie zonder wijziging');
  klok = new Date(2026, 9, 2, 11, 0, 0);
  const r2 = await b.nu('periodiek', { alleenGewijzigd: true });
  ok('niets veranderd: niet eens geprobeerd', r2.ok && !r2.nieuw && r2.reden === 'niets veranderd' && kopieIn(bmap).length === 1);
  const r3 = await b.nu('opstarten');
  ok('wel geprobeerd, zelfde inhoud: geen kopie (hash)', r3.ok && !r3.nieuw && kopieIn(bmap).length === 1);
  {
    const b2 = new Backups({ db: dbPad, map: bmap, wijzigingen: () => lib.wijzigingen(), elke: 0, log: () => {}, klok: () => klok });
    const r = await b2.nu('opstarten');
    ok('na een "herstart" zonder wijziging: geen kopie, de vorige is de laatste',
      r.ok && !r.nieuw && kopieIn(bmap).length === 1 && b2.stand().laatste?.naam === kopieIn(bmap)[0] && b2.stand().aantal === 1);
  }
  lib.bewaarHotcue('nummerC', { nr: 2, tijd: 1.5 });
  klok = new Date(2026, 9, 2, 12, 0, 0);
  const r4 = await b.nu('periodiek', { alleenGewijzigd: true });
  ok('na een wijziging: wel een kopie', r4.ok && r4.nieuw && kopieIn(bmap).length === 2
    && b.stand().laatste.naam === 'library-2026-10-02_12-00-00.db');
  lib.bewaarHotcue('nummerC', { nr: 7, tijd: 3 });
  lib.verwijderHotcue('nummerC', 7);
  klok = new Date(2026, 9, 2, 13, 0, 0);
  const r5 = await b.nu('periodiek', { alleenGewijzigd: true });
  ok('gezet en weer gewist: geteld, maar dezelfde inhoud, geen kopie', r5.ok && !r5.nieuw && kopieIn(bmap).length === 2);

  // gewijzigdSinds (het avondpakket): een wijziging die nog in geen kopie zit.
  console.log('\ngewijzigdSinds');
  ok('na een backup: false', b.stand().gewijzigdSinds === false);
  lib.bewaarHotcue('nummerC', { nr: 3, tijd: 2.5 });
  ok('teller omhoog (hotcue gezet): true', b.stand().gewijzigdSinds === true);
  klok = new Date(2026, 9, 2, 14, 0, 0);
  const r6 = await b.nu('periodiek', { alleenGewijzigd: true });
  ok('na de volgende run: weer false', r6.ok && b.stand().gewijzigdSinds === false);
  {
    const vers = new Backups({ db: dbPad, map: bmap, wijzigingen: () => lib.wijzigingen(), elke: 0, log: () => {} });
    ok('vóór de eerste backup: false', vers.stand().gewijzigdSinds === false);
    const stuk = new Backups({ db: dbPad, map: bmap, wijzigingen: () => { throw new Error('dicht'); }, elke: 0, log: () => {} });
    ok('teller gooit: null (en stand() zelf gooit niet)', stuk.stand().gewijzigdSinds === null);
    const nan = new Backups({ db: dbPad, map: bmap, elke: 0, log: () => {} });
    ok('zonder teller (NaN): false', nan.stand().gewijzigdSinds === false);
  }

  console.log('\nterwijl de server schrijft');
  {
    let geschreven = 0;
    const iv = setInterval(() => { lib.geladen('nummerB'); lib.bewaarHotcue('nummerA', { nr: 4, tijd: geschreven++ }); }, 1);
    klok = new Date(2026, 9, 2, 14, 0, 0);
    const r = await b.nu('opstarten');
    clearInterval(iv);
    const k = new DatabaseSync(join(bmap, b.stand().laatste.naam), { readOnly: true });
    ok(`backup naast ${geschreven} schrijfacties: geldig`, r.ok && r.nieuw && geschreven > 0
      && k.prepare('PRAGMA quick_check').get().quick_check === 'ok');
    k.close();
  }

  console.log('\nopruimen');
  {
    writeFileSync(join(bmap, 'lees-mij.txt'), 'van Clay');
    writeFileSync(join(bmap, '.bezig-backup-1-oud.db'), 'half');
    for (let dag = 1; dag <= 40; dag++) {
      lib.bewaarHotcue('nummerA', { nr: 8, tijd: dag });
      klok = new Date(2026, 9, 2 + dag, 18, 0, 0);
      await b.nu('periodiek', { alleenGewijzigd: true });
    }
    const n = kopieIn(bmap);
    const oudste = kopieen(n).at(-1).naam;
    ok(`40 dagen elke dag een kopie: ${n.length} over (de laatste ${BEWAAR_DAGEN} dagen)`, n.length === BEWAAR_DAGEN
      && b.stand().aantal === BEWAAR_DAGEN);
    ok(`de oudste is van ${BEWAAR_DAGEN - 1} dagen terug (${oudste})`, oudste === naamVoor(new Date(2026, 9, 2 + 40 - (BEWAAR_DAGEN - 1), 18, 0, 0)));
    ok('een vreemd bestand blijft staan', existsSync(join(bmap, 'lees-mij.txt')));
    ok('een halve kopie van een vorige keer is opgeruimd', !existsSync(join(bmap, '.bezig-backup-1-oud.db')));
  }

  console.log('\neen mislukte backup gooit niet');
  {
    const bestand = join(map, 'geen-map');
    writeFileSync(bestand, 'ik ben een bestand');
    const meldingen = [];
    const bf = new Backups({ db: dbPad, map: bestand, wijzigingen: () => lib.wijzigingen(), elke: 0, log: (s) => meldingen.push(s) });
    let gegooid = false, r;
    try { r = await bf.nu('opstarten'); } catch { gegooid = true; }
    ok(`map is een bestand: ok=false met reden (${r?.fout?.slice(0, 50)})`, !gegooid && r && r.ok === false && !!r.fout);
    ok('de fout staat in de stand en in het log', !!bf.stand().fout && meldingen.some((m) => /MISLUKT/.test(m)));

    const weg = join(map, 'bestaat-niet', 'library.db');
    const bw = new Backups({ db: weg, map: join(map, 'b-weg'), log: () => {} });
    const rw = await bw.nu();
    ok('database bestaat niet: ok=false, en er is er ook geen aangemaakt', rw.ok === false && !existsSync(weg));

    const kapot = join(map, 'kapot.db');
    writeFileSync(kapot, Buffer.alloc(8192, 0x5a));
    const bk = new Backups({ db: kapot, map: join(map, 'b-kapot'), log: () => {} });
    const rk = await bk.nu();
    ok(`kapotte database: ok=false (${rk.fout?.slice(0, 40)}), geen halve kopie achter`, rk.ok === false
      && (!existsSync(join(map, 'b-kapot')) || readdirSync(join(map, 'b-kapot')).length === 0));

    // Daarna weer goed: de fout verdwijnt.
    bf.map = join(map, 'b-goed');
    const rg = await bf.nu();
    ok('volgende keer goed: fout weg', rg.ok && rg.nieuw && bf.stand().fout === null);
  }
  lib.sluit();

  // ---- de server ---------------------------------------------------------------------
  console.log('\nde server');
  const smap = join(map, 'server');
  const media = join(smap, 'media');
  const sdb = join(media, 'library.db');
  mkdirSync(media, { recursive: true });
  { const l = new Library(sdb); l.bewaarTrack({ id: 'nummerS', url: 'https://example.com/s', titel: 'S', uploader: 't', duur: 10,
    audio: 'media/nummerS/audio.wav', video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' }); l.sluit(); }

  const start = (extra = {}) => {
    const poort = 20000 + Math.floor(Math.random() * 20000);
    const p = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, PORT: String(poort), VARVE_DB: sdb, VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(smap, 'opnames'),
        VARVE_HERANALYSE: 'uit', VARVE_PLANNEN: join(smap, 'plannen'), VARVE_PROEF: join(smap, 'proef'),
        VARVE_BACKUP_ELKE: '200', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let uit = '';
    p.stdout.on('data', (d) => { uit += d; });
    p.stderr.on('data', (d) => { uit += d; });
    return { p, poort, B: `http://localhost:${poort}`, log: () => uit };
  };
  const klaar = async (s) => {
    for (let i = 0; i < 100; i++) {
      const r = await fetch(`${s.B}/api/backups`).then((x) => x.json(), () => null);
      if (r && (r.laatste || r.fout)) return r;
      await wacht(100);
    }
    return null;
  };
  const rauwVerzoek = (poort, pad, headers = {}) => new Promise((z) => {
    const rq = request({ host: '127.0.0.1', port: poort, path: pad, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => {
      res.resume(); res.on('end', () => z(res.statusCode));
    });
    rq.on('error', () => z(0));
    rq.end();
  });

  const standaard = join(media, 'backups');   // zonder VARVE_BACKUPS: naast de database
  let s = start();
  try {
    const st = await klaar(s);
    ok('bij het opstarten een backup, naast de database (media/backups)', st?.laatste && kopieIn(standaard).length === 1
      && st.aantal === 1 && st.fout === null);
    ok('de stand noemt geen pad', !JSON.stringify(st).includes(smap));
    const naam = kopieIn(standaard)[0];
    await wacht(800);
    ok('een paar rondes zonder wijziging: nog steeds één kopie', kopieIn(standaard).length === 1);
    const post = await fetch(`${s.B}/api/mapping`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapping: { kind: 'diff', rules: [{ sig: 'note:0:1', action: 'track.1.play' }] } }) });
    ok('mapping bewaard', post.ok);
    let n = 1;
    for (let i = 0; i < 40 && n < 2; i++) { await wacht(100); n = kopieIn(standaard).length; }
    ok(`na een wijziging een tweede kopie (${n})`, n === 2);
    // Niet bereikbaar via HTTP, hoe je het ook vraagt.
    const paden = [`/media/backups/${naam}`, '/media/backups/', '/media/backups', `/api/backups/${naam}`,
      `/media/backups%2f${naam}`, `/media/x/..%2fbackups%2f${naam}`, `/src/../media/backups/${naam}`, `/media/backups/audio.wav`];
    const codes = [];
    for (const p of paden) codes.push(await rauwVerzoek(s.poort, p));
    ok(`backups niet via HTTP te lezen (${codes.join(' ')})`, codes.every((c) => c !== 200 && c !== 206 && c !== 0));
    ok('/api/backups met een vreemde Host: 403', (await rauwVerzoek(s.poort, '/api/backups', { Host: `varve.evil.example:${s.poort}` })) === 403);
    ok('/api/backups is alleen GET', (await fetch(`${s.B}/api/backups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 404);
  } finally { s.p.kill(); }
  await wacht(200);

  s = start();
  try {
    const st = await klaar(s);
    await wacht(500);
    ok('herstart zonder wijziging: geen nieuwe kopie, de vorige is de laatste',
      kopieIn(standaard).length === 2 && st?.laatste?.naam === kopieenNieuwste(standaard));
  } finally { s.p.kill(); }
  await wacht(200);

  const geenMap = join(smap, 'ik-ben-een-bestand');
  writeFileSync(geenMap, 'x');
  s = start({ VARVE_BACKUPS: geenMap });
  try {
    const st = await klaar(s);
    ok(`VARVE_BACKUPS onbruikbaar: fout in de stand (${st?.fout?.slice(0, 40)})`, !!st?.fout && st.laatste === null);
    await wacht(600);
    const lib2 = await fetch(`${s.B}/api/library?aantal=5`).then((x) => x.json(), () => null);
    ok('de server draait door en levert de library', s.p.exitCode === null && lib2?.totaal === 1);
    ok('de fout staat in het log', /\[backup\] MISLUKT/.test(s.log()));
    ok('en het bestand is niet aangeraakt', statSync(geenMap).size === 1);
  } finally { s.p.kill(); }

  const andere = join(smap, 'andere-schijf', 'varve');
  s = start({ VARVE_BACKUPS: andere });
  try {
    const st = await klaar(s);
    ok('VARVE_BACKUPS: de kopie komt daar (map wordt gemaakt)', !!st?.laatste && kopieIn(andere).length === 1);
  } finally { s.p.kill(); }
  await wacht(200);
} finally {
  rmSync(map, { recursive: true, force: true });
}

function kopieenNieuwste(m) { return kopieen(readdirSync(m))[0]?.naam; }

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
