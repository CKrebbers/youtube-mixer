// tools/backup (docs/BACKUP.md): kopie, controleer en herstel op een verzonnen
// checkout in een tijdelijke map. Een library met rijen die nog alleen in de WAL
// staan (de fout van een gewone bestandskopie, extra-3 §1.5) komt volledig mee;
// de tellingen in MANIFEST.json kloppen; een tweede run gooit niets weg en voegt
// alleen bij een wijziging een versie toe; --droog schrijft niets; --media roept
// rsync zonder --delete aan (nep-rsync via PATH); herstel zet terug en weigert een
// bestaande library.db. HOME wijst naar de tijdelijke map: nooit de echte
// ~/.varve of ~/.varve-hub. Draai met: node test/backup-kopie.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, rmSync, chmodSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const { Library } = await import('../server/library.js');

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
    'media/abc123def45', '.varve-hub']) mkdirSync(join(m === '.varve-hub' ? thuis : bron, m), { recursive: true });
  writeFileSync(join(bron, 'patronen/set.json'), '{"versie":3,"patronen":[]}\n');
  writeFileSync(join(bron, 'patronen/.versies/set/1.json'), '{"versie":1}\n');
  writeFileSync(join(bron, 'plannen/auto-plan.json'), '{"v":2,"stappen":[]}\n');
  writeFileSync(join(bron, 'proef/sessie.json'), '{"punten":{}}\n');
  writeFileSync(join(bron, 'racks/sjablonen.json'), '[]\n');
  writeFileSync(join(bron, 'mappings/apc40mk2.json'), '{"device":"apc40mk2"}\n');
  writeFileSync(join(bron, 'Input/blueprint.json'), '{}\n');
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
    ok('herstel van een map zonder backup: exit 2', draai('herstel.mjs', ['--van', join(tmp, 'leeg'), '--naar', naar], H).code === 2);
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
