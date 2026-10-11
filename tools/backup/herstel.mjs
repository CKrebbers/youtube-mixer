#!/usr/bin/env node
// Set A terugzetten in een checkout (docs/BACKUP.md §4, stap 3).
//
//   node tools/backup/herstel.mjs --van <doel>/varve --naar <checkout> [--droog]
//
// Overschrijft NOOIT iets:
//   - staat er al een library.db (of -wal) op de plek van de server, dan weigert hij helemaal
//     (exit 2): zet hem eerst zelf opzij (docs/LIBRARY.md "Terugzetten");
//   - elk ander bestand dat er al staat blijft staan; is het anders dan in de kopie, dan zegt
//     hij dat (je kiest zelf).
// Zet terug: library.db en kaart.db (de VACUUM-kopieën, zonder -wal/-shm: ze staan al in
// journal-modus), nacht.json, stems-rij.json, de mappen van set A, de handelingenlogs naar
// opnames/, en — alleen als ze er nog niet zijn — de hub-staat en varve-kaart.json.
// Daarna de handstappen: set B (media), Chrome, beeld, server starten, controleren.
// Exit: 0 klaar · 1 mislukt · 2 geweigerd of verkeerd aangeroepen.
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync, utimesSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MAPPEN, leesArgs, thuisPad, paden, varveMap, sha256, fsyncPad, bestandenIn, snelleControle,
  telLibrary, leesJson,
} from './gedeeld.mjs';

const HULP = `gebruik: node tools/backup/herstel.mjs --van <doel>/varve --naar <checkout> [--droog]

  --van <map>    de backup (het doel van kopie.mjs, of <doel>/varve)
  --naar <map>   de checkout waar het terug moet (eerst git clone; zie docs/BACKUP.md §4)
  --droog        alleen laten zien wat er zou gebeuren
Overschrijft nooit iets; weigert als er al een library.db staat.`;

export function herstel(opties, env = process.env, uit = console.log) {
  const varve = varveMap(opties.van);
  const staat = join(varve, 'staat');
  const naar = thuisPad(opties.naar);
  const droog = !!opties.droog;
  const manifest = leesJson(join(staat, 'MANIFEST.json'));
  if (!manifest || !existsSync(join(staat, 'library.db'))) {
    uit(`herstel: geen backup in ${staat} (MANIFEST.json en library.db horen er te staan)`);
    return 2;
  }
  if (!existsSync(naar)) { uit(`herstel: ${naar} bestaat niet — eerst de code ophalen (git clone), zie docs/BACKUP.md §4`); return 2; }
  const P = paden(naar, env);
  for (const p of [P.db, `${P.db}-wal`]) {
    if (existsSync(p)) {
      uit(`herstel: weigert — er staat al een ${p.endsWith('-wal') ? 'library.db-wal' : 'library.db'} op ${p}.\n`
        + '         Nooit overschrijven. Stop de server en zet library.db, -wal en -shm eerst zelf opzij\n'
        + '         (docs/LIBRARY.md "Terugzetten"), of kies een verse checkout.');
      return 2;
    }
  }

  uit(`herstel${droog ? ' (droog: er wordt niets geschreven)' : ''}`);
  uit(`  van    ${staat}  (kopie ${manifest.stempel}, ${manifest.host})`);
  uit(`  naar   ${naar}`);
  const telling = { terug: 0, gelijk: 0, anders: [] };

  /** Eén bestand terug, alleen als er niets staat. */
  const terug = (van, doel) => {
    if (existsSync(doel)) {
      if (statSync(doel).size === statSync(van).size && sha256(doel) === sha256(van)) telling.gelijk++;
      else telling.anders.push(doel);
      return false;
    }
    if (!droog) {
      mkdirSync(dirname(doel), { recursive: true });
      copyFileSync(van, doel, constants.COPYFILE_EXCL);
      const s = statSync(van);
      utimesSync(doel, s.atime, s.mtime);
      fsyncPad(doel);
    }
    telling.terug++;
    return true;
  };

  // De library eerst: daarna bestaat hij, en weigert een tweede herstel.
  terug(join(staat, 'library.db'), P.db);
  uit(`  library.db      → ${P.db}`);
  if (existsSync(join(staat, 'kaart.db'))) uit(`  kaart.db        ${terug(join(staat, 'kaart.db'), P.kaartDb) ? '→' : 'staat er al:'} ${P.kaartDb}`);
  for (const [naam, doel] of [['nacht.json', P.nacht], ['stems-rij.json', P.stemsRij]]) {
    if (existsSync(join(staat, naam))) uit(`  ${naam.padEnd(15)} ${terug(join(staat, naam), doel) ? '→' : 'staat er al:'} ${doel}`);
  }
  for (const m of MAPPEN) {
    const van = join(staat, m);
    if (!existsSync(van)) continue;
    const voor = telling.terug;
    const lijst = bestandenIn(van);
    for (const rel of lijst) terug(join(van, rel), join(P.mappen[m], rel));
    uit(`  ${(m + '/').padEnd(15)} ${telling.terug - voor}/${lijst.length} teruggezet → ${P.mappen[m]}`);
  }
  if (existsSync(join(staat, 'handelingen'))) {
    const voor = telling.terug;
    const logs = readdirSync(join(staat, 'handelingen')).filter((n) => n.endsWith('.acties.jsonl'));
    for (const n of logs) terug(join(staat, 'handelingen', n), join(P.opnames, n));
    uit(`  handelingen     ${telling.terug - voor}/${logs.length} logs → ${P.opnames}`);
  }
  const hub = join(staat, 'hub', 'staat.json');
  const hubTerug = existsSync(hub) && terug(hub, P.hub);
  if (existsSync(hub)) uit(`  hub/staat.json  ${hubTerug ? '→' : 'staat er al (niet overschreven):'} ${P.hub}`);
  const kaartJson = join(staat, 'kaart', 'varve-kaart.json');
  // Het pad van de kaart volgt de library (instelling kaart_pad), dus pas nu uitrekenen.
  const kaartDoel = droog ? P.kaartJson : paden(naar, env).kaartJson;
  if (existsSync(kaartJson)) uit(`  varve-kaart     ${terug(kaartJson, kaartDoel) ? '→' : 'staat er al (niet overschreven):'} ${kaartDoel}`);

  // Klopt wat er nu staat?
  if (!droog) {
    const qc = snelleControle(P.db);
    const t = telLibrary(P.db);
    const verwacht = manifest.library?.tellingen ?? {};
    const zelfde = ['tracks', 'hotcues', 'racks', 'samples', 'gridsOpSlot'].every((k) => t[k] === verwacht[k]);
    uit(`  controle        quick_check ${qc}; ${t.tracks} nummers, ${t.hotcues} hotcues, ${t.racks} racks, ${t.samples} pads, ${t.gridsOpSlot} grids op slot${zelfde ? ' (= manifest)' : ' (ANDERS dan het manifest)'}`);
    if (qc !== 'ok' || !zelfde) { uit('herstel: de teruggezette library klopt niet met het manifest'); return 1; }
  }
  uit(`  ${telling.terug} bestanden ${droog ? 'zouden teruggaan' : 'teruggezet'}, ${telling.gelijk} stonden er al gelijk${telling.anders.length ? `, ${telling.anders.length} staan er al ANDERS (niet overschreven):` : ''}`);
  for (const a of telling.anders.slice(0, 20)) uit(`    ${a}`);
  if (telling.anders.length > 20) uit(`    … en ${telling.anders.length - 20} meer`);

  // De handstappen.
  const media = join(varve, 'media'), opnames = join(varve, 'opnames');
  uit('\nNog met de hand (docs/BACKUP.md §4):');
  if (existsSync(media)) {
    uit(`  4. set B: rsync -a "${media}/" "${P.media}/"`);
    if (existsSync(opnames)) uit(`           rsync -a "${opnames}/" "${P.opnames}/"`);
    uit('     (of VARVE_MEDIA naar de backup laten wijzen en later verhuizen)');
  } else uit('  4. set B staat niet in deze backup: de server start, de library kent de nummers, en elk nummer is opnieuw\n     binnen te halen vanuit tracks.url (plus Demucs). Uren; nooit op een speeldag.');
  uit('  5. server starten (VARVE.app of node server/index.js); de code eerst bijwerken: een nieuwere kopie op oudere code migreert niet terug');
  uit(existsSync(join(staat, 'browser'))
    ? `  6. Chrome: ${join(staat, 'browser')} importeren`
    : '  6. Chrome: master-rack, klankschaal, MIDI-poorten, beeld-adres, stems-standaard, cue-wissel en vormen opnieuw instellen\n     (die staan alleen in localStorage; nog geen kopie, zie docs/BACKUP.md §3)');
  if (!hubTerug && existsSync(hub)) uit(`  -  hub: ${hub} staat in de backup; de huidige ${P.hub} is niet overschreven`);
  uit(existsSync(join(staat, 'beeld'))
    ? `  7. beeld: op de pc de Stroommachine → Live → "Importeer track-scènes" met ${join(staat, 'beeld')}`
    : '  7. beeld: de track-scènes van de Stroommachine staan niet in deze backup (export op de pc, handwerk)');
  uit(`  8. node tools/backup/controleer.mjs --doel "${varve}" --bron "${naar}"`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { opties, fout } = leesArgs(process.argv.slice(2), { vlaggen: ['droog', 'help'], waarden: ['van', 'naar'] });
  if (opties.help) { console.log(HULP); process.exit(0); }
  if (fout || !opties.van || !opties.naar) { console.error(`herstel: ${fout || 'geef --van <backup> en --naar <checkout>'}\n\n${HULP}`); process.exit(2); }
  try {
    process.exitCode = herstel(opties);
  } catch (err) {
    console.error(`herstel MISLUKT: ${err?.message || err}`);
    process.exitCode = 1;
  }
}
