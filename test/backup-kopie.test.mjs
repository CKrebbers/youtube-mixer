// tools/backup (docs/BACKUP.md): kopie, controleer en herstel op een verzonnen
// checkout in een tijdelijke map. Een library met rijen die nog alleen in de WAL
// staan (de fout van een gewone bestandskopie, extra-3 §1.5) komt volledig mee;
// de tellingen in MANIFEST.json kloppen; een tweede run gooit niets weg en voegt
// alleen bij een wijziging een versie toe; --droog schrijft niets; --media roept
// rsync zonder --delete aan (nep-rsync via PATH); herstel zet terug en weigert een
// bestaande library.db. HOME wijst naar de tijdelijke map: nooit de echte
// ~/.varve of ~/.varve-hub. Draai met: node test/backup-kopie.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, rmSync, chmodSync, statSync, appendFileSync, symlinkSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const { Library } = await import('../server/library.js');
const { paden, ligtIn } = await import('../tools/backup/gedeeld.mjs');
const { versieSleutel } = await import('../tools/backup/kopie.mjs');

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const tmp = mkdtempSync(join(tmpdir(), 'varve-backup-kopie-'));
const bron = join(tmp, 'bron');
const thuis = join(tmp, 'thuis');
const doelMap = join(tmp, 'doel');
const varve = join(doelMap, 'varve');
const staat = join(varve, 'staat');
const bin = join(tmp, 'bin');
const rsyncLog = join(tmp, 'rsync.log');

/** Alleen wat de tools nodig hebben: geen VARVE_* van buiten, HOME = de tijdelijke map. */
const env = (extra = {}) => ({ PATH: process.env.PATH, HOME: thuis, TMPDIR: process.env.TMPDIR || tmpdir(), ...extra });
const draai = (script, args, extra) => {
  const r = spawnSync(process.execPath, [join(WORTEL, 'tools/backup', script), ...args], { encoding: 'utf8', env: env(extra), cwd: WORTEL });
  return { code: r.status, uit: (r.stdout || '') + (r.stderr || '') };
};
/** Alle bestanden onder een map, relatief (om "niets weggegooid" te toetsen). */
const alles = (m) => {
  const uit = [];
  const loop = (a, r) => { for (const n of readdirSync(a, { withFileTypes: true })) { const p = join(a, n.name), q = r ? `${r}/${n.name}` : n.name; if (n.isDirectory()) loop(p, q); else uit.push(q); } };
  if (existsSync(m)) loop(m, '');
  return uit.sort();
};
const tel = (pad, sql) => { const d = new DatabaseSync(pad, { readOnly: true }); try { return Object.values(d.prepare(sql).get())[0]; } finally { d.close(); } };
const manifest = () => JSON.parse(readFileSync(join(staat, 'MANIFEST.json'), 'utf8'));
const versiesVan = (soort) => readdirSync(join(staat, 'versies')).filter((n) => n.startsWith(`${soort}-`)).sort();

let lib;
try {
  // ---- een verzonnen checkout ------------------------------------------------
  for (const m of ['media', 'opnames', 'patronen/.versies/set', 'plannen/.versies', 'proef', 'racks', 'mappings', 'Input',
    'sets/.versies/vrijdag', 'werkruimtes', 'uitzend', 'media/abc123def45', '.varve-hub']) mkdirSync(join(m === '.varve-hub' ? thuis : bron, m), { recursive: true });
  writeFileSync(join(bron, 'patronen/set.json'), '{"versie":3,"patronen":[]}\n');
  writeFileSync(join(bron, 'patronen/.versies/set/1.json'), '{"versie":1}\n');
  writeFileSync(join(bron, 'plannen/auto-plan.json'), '{"v":2,"stappen":[]}\n');
  writeFileSync(join(bron, 'proef/sessie.json'), '{"punten":{}}\n');
  writeFileSync(join(bron, 'racks/sjablonen.json'), '[]\n');
  writeFileSync(join(bron, 'mappings/apc40mk2.json'), '{"device":"apc40mk2"}\n');
  writeFileSync(join(bron, 'Input/blueprint.json'), '{}\n');
  // Sinds de werkruimte (14 okt): sets/, werkruimtes/, de eigen sjablonen, de paneel-apparaten, de uitzenddoelen.
  writeFileSync(join(bron, 'sets/vrijdag.json'), '{"versie":1,"naam":"vrijdag"}\n');
  writeFileSync(join(bron, 'sets/.versies/vrijdag/1.json'), '{"versie":1}\n');
  writeFileSync(join(bron, 'werkruimtes/mijn.json'), '{"naam":"mijn"}\n');
  writeFileSync(join(bron, 'racks/eigen.json'), '{"versie":1,"racks":[]}\n');
  writeFileSync(join(bron, 'media/paneel-apparaten.json'), '{"versie":1,"apparaten":[]}\n');
  writeFileSync(join(bron, 'uitzend/doelen.json'), '{"versie":1,"doelen":[]}\n');
  writeFileSync(join(bron, 'patronen/.DS_Store'), 'finder');
  writeFileSync(join(bron, 'opnames/set-20261010-190959.acties.jsonl'), '[0,"stand",{}]\n');
  writeFileSync(join(bron, 'opnames/set-20261010-190959.wav'), 'RIFF-nep');
  writeFileSync(join(bron, 'media/stems-rij.json'), '{"versie":1,"opdrachten":[]}');
  writeFileSync(join(bron, 'media/abc123def45/audio.wav'), 'RIFF-nep-audio');
  writeFileSync(join(thuis, '.varve-hub/staat.json'), '{"v":1,"snapshots":{}}\n');
  const kaartJson = join(thuis, 'kaart/varve-kaart.json');
  mkdirSync(join(thuis, 'kaart'));
  writeFileSync(kaartJson, '{"nummers":[]}\n');
  const VK = { VARVE_KAART: kaartJson };

  // kaart.db met één wens
  { const k = new DatabaseSync(join(bron, 'media/kaart.db')); k.exec('CREATE TABLE wensen (id INTEGER PRIMARY KEY, sleutel TEXT); CREATE TABLE nacht_runs (id INTEGER PRIMARY KEY); INSERT INTO wensen (sleutel) VALUES (\'x\'); PRAGMA user_version = 1'); k.close(); }

  // De library: schema via de echte Library, daarna alles in de WAL laten staan.
  const dbPad = join(bron, 'media/library.db');
  lib = new Library(dbPad);
  lib.db.exec('PRAGMA wal_autocheckpoint = 0');
  lib.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const nu = Date.now();
  const nummer = (id, slot = false) => {
    lib.db.prepare('INSERT INTO tracks (id, url, titel, audio, toegevoegd, grid_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `https://www.youtube.com/watch?v=${id}`, `Nummer ${id}`, `media/${id}/audio.wav`, nu,
        JSON.stringify({ stukken: [{ van: 0, bpm: 124, anker: 0 }], slot }));
  };
  nummer('abc123def45', true);
  nummer('zzz999yyy88');
  lib.db.prepare('INSERT INTO hotcues (track_id, nr, tijd, gemaakt) VALUES (?, ?, ?, ?)').run('abc123def45', 1, 12.5, nu);
  lib.db.prepare('INSERT INTO hotcues (track_id, nr, tijd, gemaakt) VALUES (?, ?, ?, ?)').run('zzz999yyy88', 2, 30, nu);
  lib.db.prepare('INSERT INTO samples (track_id, pad, van, tot, gemaakt) VALUES (?, ?, ?, ?, ?)').run('abc123def45', 1, 1, 3, nu);
  lib.db.prepare('INSERT INTO racks (track_id, naam, data, gemaakt, gewijzigd) VALUES (?, ?, ?, ?, ?)').run('abc123def45', 'r', '{}', nu, nu);
  lib.zet('mapping', { kind: 'diff', version: 3 });
  // Twee browser-sleutels van het instrument (PR #31: /api/instellingen schrijft zo in de tabel).
  lib.zet('varve.master.rack', '{"rack":"nep"}');
  lib.zet('varve.send.a.rack', 'Dub-echo');

  // ---- de fout zelf: alleen het bestand kopiëren mist de WAL --------------------
  console.log('de WAL');
  {
    const rauw = join(tmp, 'rauw.db');
    copyFileSync(dbPad, rauw);
    ok(`library.db-wal bestaat en is niet leeg (${statSync(dbPad + '-wal').size} B)`, statSync(dbPad + '-wal').size > 0);
    ok(`een gewone bestandskopie mist de nummers uit de WAL (${tel(rauw, 'SELECT COUNT(*) FROM tracks')} van 2)`, tel(rauw, 'SELECT COUNT(*) FROM tracks') !== 2);
  }

  // ---- verkeerd aanroepen --------------------------------------------------
  console.log('aanroepen');
  {
    const r = draai('kopie.mjs', ['--bron', bron]);
    ok('zonder --doel: exit 2', r.code === 2);
    ok('… met een nette regel, geen stacktrace', /geef --doel/.test(r.uit) && !/\n\s+at /.test(r.uit));
    ok('onbekende optie: exit 2', draai('kopie.mjs', ['--doel', doelMap, '--weg']).code === 2);
    const z = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron], VK);
    ok('zelfde schijf zonder --zelfde-schijf: exit 2', z.code === 2 && /dezelfde schijf/.test(z.uit));
    ok('… en dan is er niets geschreven', !existsSync(doelMap));
    const g = draai('kopie.mjs', ['--doel', doelMap, '--bron', join(tmp, 'bestaat-niet'), '--zelfde-schijf']);
    ok('geen library in de bron: exit 2', g.code === 2 && /geen library/.test(g.uit));
    const s = draai('kopie.mjs', ['--doel', join(tmp, 'niet-aangesloten'), '--bron', bron, '--overslaan-zonder-doel'], VK);
    ok('--overslaan-zonder-doel zonder doel: exit 0, één regel, niets gemaakt', s.code === 0 && s.uit.trim().split('\n').length === 1 && !existsSync(join(tmp, 'niet-aangesloten')));
    const i = draai('kopie.mjs', ['--doel', join(bron, 'media', 'kopie'), '--bron', bron, '--zelfde-schijf'], VK);
    ok('een doel binnen de bron: exit 2', i.code === 2 && !existsSync(join(bron, 'media', 'kopie')));
    // Via een symlink (of een alias-pad zoals iCloud → ~/Desktop): resolve() ziet het niet, het echte pad wel.
    symlinkSync(join(bron, 'media'), join(tmp, 'link-naar-media'));
    symlinkSync(bron, join(tmp, 'link-naar-bron'));
    const l = draai('kopie.mjs', ['--doel', join(tmp, 'link-naar-media'), '--bron', bron, '--zelfde-schijf', '--media'], VK);
    ok('een doel via een symlink naar media/: exit 2, niets in media/varve', l.code === 2 && /ligt in de bron/.test(l.uit) && !existsSync(join(bron, 'media', 'varve')));
    const lb = draai('kopie.mjs', ['--doel', join(tmp, 'link-naar-bron', 'kopie'), '--bron', bron, '--zelfde-schijf'], VK);
    ok('een doel via een symlink naar de bron: exit 2', lb.code === 2 && !existsSync(join(bron, 'kopie')));
    ok('ligtIn: op het echte pad', ligtIn(join(tmp, 'link-naar-media', 'x'), join(bron, 'media')) && !ligtIn(join(tmp, 'doel'), join(bron, 'media')));
    const v = draai('kopie.mjs', ['--doel', '/Volumes/VARVE-BESTAAT-NIET-TEST', '--bron', bron], VK);
    ok('/Volumes/<x> die er niet is: exit 2 "niet aangesloten", niet "dezelfde schijf"', v.code === 2 && /niet aangesloten/.test(v.uit) && !/dezelfde schijf/.test(v.uit));
  }

  // ---- welke library: zoals de server (VARVE_DB, anders <media>/library.db) ----
  console.log('welke library');
  {
    const b2 = join(tmp, 'bron-verhuisd');
    const ver = join(tmp, 'verhuisde-media');
    mkdirSync(b2); mkdirSync(ver);
    writeFileSync(join(b2, 'media-VERHUISD.txt'), `media/ is verhuisd.\n\nVARVE_MEDIA=${ver}\n`);
    const p2 = paden(b2, { HOME: thuis });
    ok('media-VERHUISD.txt: media en library op de nieuwe plek', p2.media === ver && p2.db === join(ver, 'library.db') && !p2.waarschuwing);
    ok('… kaart.db, nacht.json en stems-rij.json ernaast', p2.kaartDb === join(ver, 'kaart.db') && p2.stemsRij === join(ver, 'stems-rij.json'));
    ok('… een testserver (VARVE_TESTSERVER=1) volgt het briefje niet', paden(b2, { VARVE_TESTSERVER: '1', HOME: thuis }).media === join(b2, 'media'));
    // Een echte library op de verhuisde plek (de VACUUM-kopie van hierboven komt later; nu de bron).
    { const d = new DatabaseSync(join(ver, 'library.db')); d.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, audio TEXT); INSERT INTO tracks VALUES (\'een00000001\', \'media/een00000001/audio.wav\')'); d.close(); }
    const r = draai('kopie.mjs', ['--doel', join(tmp, 'doel-verhuisd'), '--bron', b2, '--droog'], VK);
    ok('kopie --droog na de verhuizing: exit 0, vindt de library (1 nummer)', r.code === 0 && /1 nummers/.test(r.uit));

    // VARVE_MEDIA gezet en nog een oude library in <bron>/media: de server neemt <media>/library.db,
    // de kopie dus ook, maar hij zegt dat er een tweede ligt. (VARVE_TESTSERVER: zie media-verhuis.test.)
    const twee = { VARVE_MEDIA: ver, VARVE_TESTSERVER: '1', HOME: thuis };
    const pt = paden(bron, twee);
    ok('twee libraries (VARVE_MEDIA en <bron>/media): die van de server, met een waarschuwing', pt.db === join(ver, 'library.db') && /twee libraries/.test(pt.waarschuwing || ''));
    const t = draai('kopie.mjs', ['--doel', join(tmp, 'doel-twee'), '--bron', bron, '--droog'], { ...VK, ...twee });
    ok('… kopie --droog zegt het (LET OP … zet VARVE_DB) en telt de library van de server (1 nummer)', t.code === 0 && /LET OP er staan twee libraries/.test(t.uit) && /VARVE_DB/.test(t.uit) && /1 nummers/.test(t.uit));
    ok('… met VARVE_DB geen waarschuwing', paden(bron, { ...twee, VARVE_DB: dbPad }).db === dbPad && !paden(bron, { ...twee, VARVE_DB: dbPad }).waarschuwing);
    ok('… VARVE_MEDIA naar een lege map: <media>/library.db, zoals de server (geen terugval op de oude)', paden(bron, { VARVE_MEDIA: join(tmp, 'lege-media'), VARVE_TESTSERVER: '1', HOME: thuis }).db === join(tmp, 'lege-media', 'library.db'));
    ok('zonder variabelen: <bron>/media/library.db, zoals altijd', paden(bron, { HOME: thuis }).db === dbPad && !paden(bron, { HOME: thuis }).waarschuwing);
    ok('een slash aan het eind telt niet (VARVE_MEDIA=/x/media/)', paden(b2, { VARVE_MEDIA: `${ver}/`, VARVE_TESTSERVER: '1', HOME: thuis }).media === ver
      && paden(b2, { VARVE_MEDIA: `${ver}/`, VARVE_TESTSERVER: '1', HOME: thuis }).db === join(ver, 'library.db'));

    // ~/.varve/media-pad (VARVE.app zet daarmee VARVE_MEDIA): launchd heeft geen ~/.zprofile.
    const thuis3 = join(tmp, 'thuis-mediapad');
    mkdirSync(join(thuis3, '.varve'), { recursive: true });
    writeFileSync(join(thuis3, '.varve', 'media-pad'), `${ver}/\n`);
    const pm = paden(bron, { HOME: thuis3 });
    ok('~/.varve/media-pad (en geen VARVE_MEDIA): die map (zonder slash), zoals VARVE.app de server start', pm.media === ver && pm.mediaBron === '~/.varve/media-pad' && pm.db === join(ver, 'library.db'));
    ok('… met een waarschuwing, want <bron>/media/library.db ligt er ook', /twee libraries/.test(pm.waarschuwing || ''));
    ok('… VARVE_MEDIA gaat voor', paden(bron, { HOME: thuis3, VARVE_MEDIA: join(bron, 'media'), VARVE_TESTSERVER: '1' }).media === join(bron, 'media'));
    ok('… een testomgeving (VARVE_TESTSERVER=1) leest het bestand nooit', paden(bron, { HOME: thuis3, VARVE_TESTSERVER: '1' }).media === join(bron, 'media'));
    const pmd = draai('kopie.mjs', ['--doel', join(tmp, 'doel-mediapad'), '--bron', bron, '--droog'], { ...VK, HOME: thuis3 });
    ok('… kopie --droog via media-pad: vindt de verhuisde library (1 nummer) en zegt waarvandaan', pmd.code === 0 && /1 nummers/.test(pmd.uit) && /via ~\/\.varve\/media-pad/.test(pmd.uit));
  }

  // ---- versies sorteren op tijd, niet op naam ------------------------------------
  {
    const namen = ['library-2026-10-11_14-05-33.db', 'library-2026-10-11_14-05-33-2.db', 'library-2026-10-11_14-05-09.db'];
    const sorteer = (lijst) => [...lijst].sort((a, b) => (versieSleutel(a, 'library') < versieSleutel(b, 'library') ? -1 : 1));
    ok('versieSleutel: "…_33-2.db" komt ná "…_33.db"', sorteer(namen).at(-1) === 'library-2026-10-11_14-05-33-2.db');
    ok('versieSleutel: een ander soort of een vreemde naam telt niet', versieSleutel('kaart-2026-10-11_14-05-33.db', 'library') === null && versieSleutel('MANIFEST-x.json', 'library') === null);
  }

  // ---- --droog -------------------------------------------------------------
  console.log('droog');
  {
    const voor = alles(bron).filter((n) => !n.endsWith('-shm'));
    const r = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--droog'], VK);
    ok('droog: exit 0', r.code === 0);
    ok('droog: telt ook de nummers uit de WAL (2 nummers, 2 hotcues, 1 grid op slot)', /2 nummers, 2 hotcues, 1 rack, 1 pads, 1 grid op slot/.test(r.uit));
    ok('droog: zegt dat het dezelfde schijf is', /zelfde schijf/.test(r.uit));
    ok('droog: schrijft geen doel', !existsSync(doelMap));
    ok('droog: geen stempel in ~/.varve', !existsSync(join(thuis, '.varve')));
    ok('droog: de bron is niet veranderd', JSON.stringify(alles(bron).filter((n) => !n.endsWith('-shm'))) === JSON.stringify(voor));
  }

  // ---- de eerste echte run --------------------------------------------------
  console.log('eerste run');
  let eerst;
  {
    const r = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--zelfde-schijf'], VK);
    ok('exit 0', r.code === 0);
    if (r.code !== 0) console.log(r.uit);
    const db = join(staat, 'library.db');
    ok('staat/library.db bestaat', existsSync(db));
    ok('de kopie heeft de nummers uit de WAL (2)', tel(db, 'SELECT COUNT(*) FROM tracks') === 2);
    ok('… en de hotcues, pads, racks en de mapping', tel(db, 'SELECT COUNT(*) FROM hotcues') === 2 && tel(db, 'SELECT COUNT(*) FROM samples') === 1
      && tel(db, 'SELECT COUNT(*) FROM racks') === 1 && tel(db, "SELECT COUNT(*) FROM instellingen WHERE sleutel = 'mapping'") === 1);
    ok('één los bestand in journal-modus (geen -wal)', tel(db, 'PRAGMA journal_mode') === 'delete' && !existsSync(db + '-wal'));
    ok('quick_check ok', tel(db, 'PRAGMA quick_check') === 'ok');
    ok('kaart.db mee, met de wens', tel(join(staat, 'kaart.db'), 'SELECT COUNT(*) FROM wensen') === 1);
    const m = manifest();
    ok('manifest: tellingen = de kopie', m.library.tellingen.tracks === 2 && m.library.tellingen.hotcues === 2 && m.library.tellingen.samples === 1
      && m.library.tellingen.racks === 1 && m.library.tellingen.gridsOpSlot === 1 && m.library.tellingen.schema === tel(db, 'PRAGMA user_version'));
    ok('manifest: kaart 1 wens, 0 nachtruns', m.kaart?.tellingen?.wensen === 1 && m.kaart?.tellingen?.nachtRuns === 0);
    ok('manifest: zelfde schijf staat erin', m.zelfdeSchijf === true);
    const paden = m.bestanden.map((b) => b.pad);
    ok('manifest: .versies van patronen mee', paden.includes('patronen/.versies/set/1.json'));
    ok('manifest: alleen de logs uit opnames/, geen wav', paden.includes('handelingen/set-20261010-190959.acties.jsonl') && !paden.some((p) => p.endsWith('.wav')));
    ok('manifest: hub, kaart, stems-rij, Input', ['hub/staat.json', 'kaart/varve-kaart.json', 'stems-rij.json', 'Input/blueprint.json'].every((p) => paden.includes(p)));
    ok('manifest: sets/ (met .versies), werkruimtes/, racks/eigen.json', ['sets/vrijdag.json', 'sets/.versies/vrijdag/1.json', 'werkruimtes/mijn.json', 'racks/eigen.json'].every((p) => paden.includes(p)));
    ok('manifest: paneel-apparaten.json en uitzend/doelen.json', ['paneel-apparaten.json', 'uitzend/doelen.json'].every((p) => paden.includes(p)));
    ok('de browser-sleutels van het instrument zitten in library.db', tel(db, "SELECT COUNT(*) FROM instellingen WHERE sleutel IN ('varve.master.rack', 'varve.send.a.rack')") === 2
      && m.library.tellingen.instrument === 2);
    ok('manifest: welke library en welke media', m.library_pad === dbPad && m.media?.pad === join(bron, 'media') && m.media?.via === 'standaard');
    ok('geen .DS_Store meegenomen', !paden.some((p) => p.endsWith('.DS_Store')));
    ok('manifest: wat ontbrak staat erin (standen/, nacht.json)', m.ontbreekt.includes('standen/') && m.ontbreekt.includes('nacht.json'));
    ok('manifest: sha256 per bestand klopt', m.bestanden.every((b) => b.sha256.length === 64 && b.bytes === statSync(join(staat, b.pad)).size));
    ok('één versie van library en kaart', versiesVan('library').length === 1 && versiesVan('kaart').length === 1);
    const st = JSON.parse(readFileSync(join(thuis, '.varve/backup-laatste.json'), 'utf8'));
    ok('stempel ~/.varve/backup-laatste.json: setA, geen setB, doel, tracks', st.setA === true && st.setB === false && st.doel === varve && st.tracks === 2);
    ok('de echte bron is niet aangeraakt: wal staat er nog', existsSync(dbPad + '-wal'));
    eerst = alles(varve);
  }

  // ---- controleer -------------------------------------------------------------
  console.log('controleer');
  {
    const r = draai('controleer.mjs', ['--doel', doelMap, '--bron', bron], VK);
    ok('controleer: exit 0, alles ok', r.code === 0 && /\nalles ok\n?$/.test(r.uit));
    ok('controleer: 2/2 nummers (kopie/nu)', /2\/2 nummers, 2\/2 hotcues, 1\/1 racks, 1\/1 pads, 1\/1 grids op slot/.test(r.uit));
    ok('controleer: zegt dat set B er niet is', /set B: niet in dit doel/.test(r.uit));
    ok('controleer: ook met <doel>/varve/staat als doel', draai('controleer.mjs', ['--doel', staat, '--bron', bron], VK).code === 0);
    ok('controleer zonder --doel: exit 2', draai('controleer.mjs', []).code === 2);
  }

  // ---- tweede run: geen wijziging = geen versie, niets weg ---------------------
  console.log('tweede en derde run');
  {
    const r = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--zelfde-schijf'], VK);
    ok('tweede run zonder wijziging: exit 0', r.code === 0);
    ok('… geen nieuwe library-versie (zelfde inhoud)', versiesVan('library').length === 1 && /ongewijzigd sinds/.test(r.uit));
    const na = alles(varve);
    ok('… niets weggegooid', eerst.every((p) => na.includes(p)));
    ok('… niets opzij gezet', !/opzij in \.vorige/.test(r.uit));

    // Een wijziging (weer in de WAL), een bestand dat in de bron verdwijnt, een dat verandert.
    nummer('nieuw000001');
    rmSync(join(bron, 'Input/blueprint.json'));
    writeFileSync(join(bron, 'patronen/set.json'), '{"versie":4,"patronen":["anders"]}\n');
    const voor = alles(varve);
    const r3 = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--zelfde-schijf'], VK);
    ok('derde run na een wijziging: exit 0', r3.code === 0);
    ok('… een versie erbij (2)', versiesVan('library').length === 2);
    ok('… de nieuwe rij uit de WAL zit erin (3 nummers)', tel(join(staat, 'library.db'), 'SELECT COUNT(*) FROM tracks') === 3);
    const na3 = alles(varve);
    ok('… niets weggegooid (alles van vóór staat er nog)', voor.every((p) => na3.includes(p)));
    ok('… een bestand dat in de bron verdween blijft in de kopie', existsSync(join(staat, 'Input/blueprint.json')));
    const opzij = na3.filter((p) => p.startsWith('staat/.vorige/') && p.endsWith('patronen/set.json'));
    ok('… het oude patronen/set.json staat opzij in .vorige/<stempel>/', opzij.length === 1
      && readFileSync(join(varve, opzij[0]), 'utf8').includes('"versie":3'));
    ok('… en de nieuwe staat op zijn plek', readFileSync(join(staat, 'patronen/set.json'), 'utf8').includes('anders'));
    ok('… manifest telt 3 nummers', manifest().library.tellingen.tracks === 3);
    ok('… een manifest per run in versies/', readdirSync(join(staat, 'versies')).filter((n) => n.startsWith('MANIFEST-')).length === 3);
  }

  // ---- controleer: nieuwer dan de kopie ----------------------------------------
  {
    nummer('nog0nieuwer');
    const r = draai('controleer.mjs', ['--doel', doelMap, '--bron', bron], VK);
    ok('controleer: een nummer dat er na de kopie bij kwam = LET OP, exit 0', r.code === 0 && /1 nummer nieuwer dan de kopie \(nog0nieuwer\)/.test(r.uit)
      && /kopie in orde; LET OP/.test(r.uit));
  }

  // ---- set B met een nep-rsync -------------------------------------------------
  console.log('set B');
  {
    mkdirSync(bin);
    writeFileSync(join(bin, 'rsync'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${rsyncLog}"\nexit 0\n`);
    chmodSync(join(bin, 'rsync'), 0o755);
    const r = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--zelfde-schijf', '--media'], { ...VK, PATH: `${bin}:${process.env.PATH}` });
    ok('--media: exit 0', r.code === 0);
    const aanroepen = existsSync(rsyncLog) ? readFileSync(rsyncLog, 'utf8').trim().split('\n') : [];
    ok('--media: twee keer rsync (media en opnames)', aanroepen.length === 2 && aanroepen[0].includes(`${bron}/media/`) && aanroepen[1].includes(`${bron}/opnames/`));
    ok('--media: altijd -a, nooit --delete', aanroepen.every((a) => /(^| )-a( |$)/.test(a) && !/--delete|--del( |$)/.test(a)));
    ok('--media: library.db en kaart.db niet als bestand (exclude)', aanroepen[0].includes('--exclude=/library.db*') && aanroepen[0].includes('--exclude=/kaart.db*'));
    ok('--media: wat anders is gaat naar .vorige (--backup-dir)', aanroepen.every((a) => a.includes('--backup') && a.includes('--backup-dir=')));
    const st = JSON.parse(readFileSync(join(thuis, '.varve/backup-laatste.json'), 'utf8'));
    ok('--media: stempel zegt setB', st.setB === true);
    ok('--media: manifest heeft setB', manifest().setB?.media === true);
    // De nep-rsync kopieert niets: controleer ziet dus nummers zonder media-kopie.
    mkdirSync(join(varve, 'media/abc123def45'), { recursive: true });
    copyFileSync(join(bron, 'media/abc123def45/audio.wav'), join(varve, 'media/abc123def45/audio.wav'));
    const c = draai('controleer.mjs', ['--doel', doelMap, '--bron', bron], VK);
    ok('controleer: telt de nummers zonder media-kopie (3 van 4)', /set B: 3 nummers zonder media-kopie/.test(c.uit) && c.code === 0);
  }

  // ---- herstel -------------------------------------------------------------
  console.log('herstel');
  {
    const naar = join(tmp, 'verse-checkout');
    const thuis2 = join(tmp, 'thuis2');
    mkdirSync(join(naar, 'plannen'), { recursive: true });
    mkdirSync(thuis2);
    writeFileSync(join(naar, 'plannen/auto-plan.json'), '{"v":2,"stappen":["uit git"]}\n');   // anders dan in de kopie
    const H = { HOME: thuis2, VARVE_KAART: join(thuis2, 'kaart/varve-kaart.json') };

    const d = draai('herstel.mjs', ['--van', varve, '--naar', naar, '--droog'], H);
    ok('herstel --droog: exit 0 en niets geschreven', d.code === 0 && !existsSync(join(naar, 'media')) && !existsSync(join(thuis2, '.varve-hub')));

    const r = draai('herstel.mjs', ['--van', varve, '--naar', naar], H);
    ok('herstel: exit 0', r.code === 0);
    if (r.code !== 0) console.log(r.uit);
    const db = join(naar, 'media/library.db');
    ok('herstel: library.db terug, 4 nummers (= manifest), quick_check ok', existsSync(db) && tel(db, 'SELECT COUNT(*) FROM tracks') === 4
      && manifest().library.tellingen.tracks === 4 && tel(db, 'PRAGMA quick_check') === 'ok');
    ok('herstel: zonder -wal/-shm', !existsSync(db + '-wal'));
    ok('herstel: kaart.db en stems-rij.json naast de library', existsSync(join(naar, 'media/kaart.db')) && existsSync(join(naar, 'media/stems-rij.json')));
    ok('herstel: paneel-apparaten.json in media/, uitzend/doelen.json, sets/ en werkruimtes/', existsSync(join(naar, 'media/paneel-apparaten.json'))
      && existsSync(join(naar, 'uitzend/doelen.json')) && existsSync(join(naar, 'sets/.versies/vrijdag/1.json')) && existsSync(join(naar, 'werkruimtes/mijn.json')));
    ok('herstel: de instrument-sleutels staan weer in de library, en herstel zegt dat Chrome niets hoeft', tel(db, "SELECT COUNT(*) FROM instellingen WHERE sleutel = 'varve.send.a.rack'") === 1
      && /2 instrument-sleutels/.test(r.uit));
    ok('herstel: patronen met .versies', existsSync(join(naar, 'patronen/.versies/set/1.json')) && readFileSync(join(naar, 'patronen/set.json'), 'utf8').includes('anders'));
    ok('herstel: de logs in opnames/', existsSync(join(naar, 'opnames/set-20261010-190959.acties.jsonl')));
    ok('herstel: hub-staat terug in een lege thuismap', existsSync(join(thuis2, '.varve-hub/staat.json')));
    ok('herstel: varve-kaart.json terug', existsSync(join(thuis2, 'kaart/varve-kaart.json')));
    ok('herstel: een bestaand ander bestand NIET overschreven, wel gemeld', readFileSync(join(naar, 'plannen/auto-plan.json'), 'utf8').includes('uit git')
      && /ANDERS \(niet overschreven\)/.test(r.uit));
    ok('herstel: drukt de handstappen af (rsync van set B, Chrome, controleer)', /rsync -a ".*\/media\/"/.test(r.uit) && /Chrome/.test(r.uit) && /controleer\.mjs/.test(r.uit));

    const voor = readFileSync(db);
    const w = draai('herstel.mjs', ['--van', varve, '--naar', naar], H);
    ok('herstel weigert bij een bestaande library.db: exit 2', w.code === 2 && /weigert/.test(w.uit));
    ok('… en de library is niet aangeraakt', Buffer.compare(voor, readFileSync(db)) === 0);
    rmSync(db, { force: true });   // alleen in de tijdelijke map: nu met een losse -wal
    writeFileSync(db + '-wal', 'oud');
    ok('herstel weigert ook bij alleen een library.db-wal', draai('herstel.mjs', ['--van', varve, '--naar', naar], H).code === 2);
    ok('herstel zonder --naar: exit 2', draai('herstel.mjs', ['--van', varve]).code === 2);
    // Ook een losse -journal van library.db, of een losse kaart.db-wal zonder kaart.db.
    const naar2 = join(tmp, 'verse-checkout-2');
    mkdirSync(join(naar2, 'media'), { recursive: true });
    writeFileSync(join(naar2, 'media/library.db-journal'), 'oud');
    const j = draai('herstel.mjs', ['--van', varve, '--naar', naar2], H);
    ok('herstel weigert bij een losse library.db-journal', j.code === 2 && /library\.db-journal/.test(j.uit) && !existsSync(join(naar2, 'media/library.db')));
    const naar3 = join(tmp, 'verse-checkout-3');
    mkdirSync(join(naar3, 'media'), { recursive: true });
    writeFileSync(join(naar3, 'media/kaart.db-wal'), 'oud');
    const k = draai('herstel.mjs', ['--van', varve, '--naar', naar3], H);
    ok('herstel weigert bij een losse kaart.db-wal zonder kaart.db', k.code === 2 && /kaart\.db-wal/.test(k.uit) && !existsSync(join(naar3, 'media/library.db')));
    ok('herstel van een map zonder backup: exit 2', draai('herstel.mjs', ['--van', join(tmp, 'leeg'), '--naar', naar], H).code === 2);
  }

  // ---- één run tegelijk per doel ---------------------------------------------------
  console.log('slot');
  {
    const slot = join(staat, '.werk', 'slot');
    // Een levend proces (deze test) houdt het slot vast.
    writeFileSync(slot, JSON.stringify({ pid: process.pid, tijd: new Date().toISOString(), host: hostname() }) + '\n');
    const voor = alles(varve);
    const r = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--zelfde-schijf'], VK);
    ok('een tweede run tegelijk: exit 2 "er loopt al een kopie"', r.code === 2 && /er loopt al een kopie/.test(r.uit));
    ok('… en die schrijft niets', JSON.stringify(alles(varve)) === JSON.stringify(voor));
    rmSync(slot);   // alleen ons eigen nep-slot in de tijdelijke map
    // Een slot van een proces dat niet meer leeft (afgebroken run): opzij, en dan gewoon door.
    writeFileSync(slot, JSON.stringify({ pid: 2 ** 22 + 12345, tijd: '2026-10-11T06:00:00.000Z', host: hostname() }) + '\n');
    const d = draai('kopie.mjs', ['--doel', doelMap, '--bron', bron, '--zelfde-schijf'], VK);
    ok('een slot van een dood proces: de run gaat door (exit 0)', d.code === 0);
    ok('… het oude slot staat opzij (niet weg), het eigen slot is los', readdirSync(join(staat, '.werk')).some((n) => /^slot-/.test(n)) && !existsSync(slot));
  }

  // ---- controleer vangt een beschadigde kopie ------------------------------------
  console.log('beschadigd');
  {
    appendFileSync(join(staat, 'patronen/set.json'), 'kapot');
    const r = draai('controleer.mjs', ['--doel', doelMap, '--bron', bron], VK);
    ok('controleer: een veranderd bestand = NIET OK, exit 1', r.code === 1 && /anders dan bij het maken: patronen\/set\.json/.test(r.uit) && /NIET OK/.test(r.uit));
  }
} finally {
  try { lib?.db.close(); } catch (_) {}
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nalles groen');
process.exit(fails.length ? 1 : 0);
