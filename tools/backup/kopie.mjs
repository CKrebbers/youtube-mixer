#!/usr/bin/env node
// Een kopie van de staat van het instrument naar een andere plek (docs/BACKUP.md).
//
//   node tools/backup/kopie.mjs --doel /Volumes/SSD [--media] [--controleer] [--droog]
//                               [--zelfde-schijf] [--bron <checkout>] [--overslaan-zonder-doel]
//
// Set A "staat" (klein, ~16 MB) gaat altijd naar <doel>/varve/staat/:
//   library.db en kaart.db als VACUUM INTO-kopie via de Backups-klasse van de server
//   (server/backup.js: eigen alleen-lezen verbinding, quick_check, fsync) — NOOIT het
//   bestand kopiëren, want recent werk staat alleen in library.db-wal (docs/BACKUP.md §2);
//   patronen/ plannen/ proef/ standen/ racks/ mappings/ Input/ (met .versies/),
//   de handelingenlogs (opnames/*.acties.jsonl), nacht.json, stems-rij.json,
//   ~/.varve-hub/staat.json en varve-kaart.json; plus MANIFEST.json met tellingen.
// Set B "media" (groot) alleen met --media: rsync -a van media/ en opnames/ naar
//   <doel>/varve/media/ en <doel>/varve/opnames/, ZONDER --delete.
//
// Er wordt nooit iets weggegooid: wat in de bron verdween blijft in de kopie staan, een
// bestand dat in de kopie anders is dan in de bron gaat eerst naar .vorige/<stempel>/,
// en elke andere library komt er als versie bij (versies/library-<stempel>.db). De bron
// wordt alleen gelezen. Weigert een doel op dezelfde schijf als de bron, tenzij
// --zelfde-schijf (dat is een versie, geen backup buiten de laptop).
//
// Exit: 0 klaar · 1 mislukt · 2 verkeerd aangeroepen of geweigerd.
import { existsSync, mkdirSync, statSync, readdirSync, renameSync, copyFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Backups } from '../../server/backup.js';
import {
  WORTEL, MAPPEN, leesArgs, thuisPad, paden, sha256, fsyncPad, schijfVan, bestandenIn, omvang,
  telLibrary, telKaart, commitVan, stempelVoor, maat,
} from './gedeeld.mjs';
import { controleer, drukAf } from './controleer.mjs';

const HULP = `gebruik: node tools/backup/kopie.mjs --doel <map> [opties]

  --doel <map>              waar de kopie komt: <map>/varve/staat (en met --media ook media/, opnames/)
  --media                   ook set B: media/ en opnames/ met rsync -a, zonder --delete (groot)
  --controleer              daarna controleer.mjs op de kopie
  --droog                   alleen laten zien wat er zou gebeuren; schrijft niets
  --zelfde-schijf           ook als het doel op dezelfde schijf staat als de bron
  --bron <checkout>         een andere checkout dan deze (alleen lezen); standaard ${WORTEL}
  --overslaan-zonder-doel   bestaat het doel niet (schijf niet aangesloten): één regel en exit 0

Dezelfde VARVE_*-variabelen als de server (VARVE_DB, VARVE_MEDIA, VARVE_OPNAMES, …).
Zie docs/BACKUP.md.`;

const VLAGGEN = ['media', 'controleer', 'droog', 'zelfde-schijf', 'overslaan-zonder-doel', 'help'];

export async function kopie(opties, env = process.env, uit = console.log) {
  const t0 = performance.now();
  const P = paden(opties.bron ? thuisPad(opties.bron) : WORTEL, env);
  const doelOpgegeven = thuisPad(opties.doel);
  if (opties['overslaan-zonder-doel'] && !existsSync(doelOpgegeven)) {
    uit(`kopie: ${doelOpgegeven} bestaat niet (schijf niet aangesloten?); overgeslagen`);
    return 0;
  }
  const varve = join(doelOpgegeven, 'varve');
  const staat = join(varve, 'staat');
  const droog = !!opties.droog;

  if (!existsSync(P.db)) {
    uit(`kopie: geen library op ${P.db} — verkeerde --bron of VARVE_DB?`);
    return 2;
  }
  // De kopie mag niet in de bron zelf landen (een backup in media/ gaat mee de prullenbak in).
  for (const m of [P.bron, P.media, P.opnames]) {
    if ((varve + '/').startsWith(m + '/')) { uit(`kopie: het doel ligt in de bron (${m}); kies een plek erbuiten`); return 2; }
  }
  const zelfdeSchijf = schijfVan(varve) === schijfVan(P.db);
  if (zelfdeSchijf && !opties['zelfde-schijf'] && !droog) {
    uit(`kopie: ${doelOpgegeven} staat op dezelfde schijf als de bron. Dat is geen backup buiten de laptop.\n`
      + '       Wil je toch (een versie op deze schijf): --zelfde-schijf. Anders: een externe schijf of stick.');
    return 2;
  }

  // ---- wat er is ------------------------------------------------------------
  const live = telLibrary(P.db);
  const kaartLive = existsSync(P.kaartDb) ? telKaart(P.kaartDb) : null;
  const logs = existsSync(P.opnames) ? readdirSync(P.opnames).filter((n) => n.endsWith('.acties.jsonl')).sort() : [];
  const losse = [
    { naam: 'nacht.json', bron: P.nacht, doel: 'nacht.json' },
    { naam: 'stems-rij.json', bron: P.stemsRij, doel: 'stems-rij.json' },
    { naam: 'hub/staat.json', bron: P.hub, doel: 'hub/staat.json' },
    { naam: 'kaart/varve-kaart.json', bron: P.kaartJson, doel: 'kaart/varve-kaart.json' },
  ];
  const commit = commitVan(P.bron);

  uit(`kopie${droog ? ' (droog: er wordt niets geschreven)' : ''}`);
  uit(`  bron   ${P.bron}${commit ? `  (commit ${commit})` : ''}`);
  uit(`  doel   ${staat}${existsSync(staat) ? '' : '  (nieuw)'}`);
  if (zelfdeSchijf) uit(`  LET OP zelfde schijf als de bron: een versie, geen backup buiten de laptop${opties['zelfde-schijf'] ? '' : ' (een echte run weigert zonder --zelfde-schijf)'}`);

  const walBytes = existsSync(P.db + '-wal') ? statSync(P.db + '-wal').size : 0;
  uit(`  library.db      VACUUM INTO  ${maat(statSync(P.db).size)}${walBytes ? ` + wal ${maat(walBytes)}` : ''} · ${telTekst(live)}`);
  uit(`  kaart.db        ${kaartLive ? `VACUUM INTO  ${maat(statSync(P.kaartDb).size)} · ${kaartLive.wensen} wensen, ${kaartLive.nachtRuns} nachtruns` : 'ontbreekt (overgeslagen)'}`);
  let totaal = 0;
  for (const m of MAPPEN) {
    const o = omvang(P.mappen[m]);
    totaal += o.bytes;
    uit(`  ${(m + '/').padEnd(15)} ${existsSync(P.mappen[m]) ? `${o.aantal} bestanden, ${maat(o.bytes)}` : 'ontbreekt (overgeslagen)'}`);
  }
  const logBytes = logs.reduce((s, n) => s + statSync(join(P.opnames, n)).size, 0);
  totaal += logBytes;
  uit(`  handelingen/    ${logs.length} logs, ${maat(logBytes)}`);
  for (const l of losse) {
    const er = existsSync(l.bron);
    if (er) totaal += statSync(l.bron).size;
    uit(`  ${l.naam.padEnd(15)} ${er ? maat(statSync(l.bron).size) : 'ontbreekt (overgeslagen)'}`);
  }
  uit(`  set A samen     ~${maat(totaal + statSync(P.db).size + walBytes + (kaartLive ? statSync(P.kaartDb).size : 0))}`);
  if (opties.media) {
    const om = omvang(P.media), oo = omvang(P.opnames);
    uit(`  set B (--media) media/ ${om.aantal} bestanden ${maat(om.bytes)} · opnames/ ${oo.aantal} bestanden ${maat(oo.bytes)} → rsync -a, zonder --delete`);
  } else uit('  set B           niet gevraagd (--media)');
  if (droog) return 0;

  // ---- schrijven ------------------------------------------------------------
  const nu = new Date();
  // Een stempel per run, ook als twee runs in dezelfde seconde vallen: wat opzij gaat of
  // als manifest bewaard wordt, mag nooit over iets van een eerdere run heen.
  let stempel = stempelVoor(nu);
  for (let i = 2; [join(staat, '.vorige', stempel), join(varve, '.vorige', stempel), join(staat, 'versies', `MANIFEST-${stempel}.json`)]
    .some((p) => existsSync(p)); i++) stempel = `${stempelVoor(nu)}-${i}`;
  const vorige = join(staat, '.vorige', stempel);
  let opzij = 0;
  mkdirSync(join(staat, 'versies'), { recursive: true });

  /** Een bestand in staat/ dat weg moet voor een nieuwe versie: eerst opzij, nooit weg. */
  const zetOpzij = (rel) => {
    let naar = join(vorige, rel);
    for (let i = 2; existsSync(naar); i++) naar = `${join(vorige, rel)}.${i}`;
    mkdirSync(dirname(naar), { recursive: true });
    renameSync(join(staat, rel), naar);
    opzij++;
  };

  /** Bron → staat/<rel>. Gelijk = niets; anders eerst het oude opzij. Geeft 'nieuw' | 'gelijk' | 'bijgewerkt'. */
  const zet = (bron, rel) => {
    const doel = join(staat, rel);
    const b = statSync(bron);
    let soort = 'nieuw';
    if (existsSync(doel)) {
      const d = statSync(doel);
      if (d.size === b.size && Math.abs(d.mtimeMs - b.mtimeMs) < 1000) return 'gelijk';
      if (d.size === b.size && sha256(doel) === sha256(bron)) return 'gelijk';
      zetOpzij(rel);
      soort = 'bijgewerkt';
    }
    mkdirSync(dirname(doel), { recursive: true });
    copyFileSync(bron, doel);
    utimesSync(doel, b.atime, b.mtime);
    fsyncPad(doel);
    return soort;
  };

  const verslag = { nieuw: 0, bijgewerkt: 0, gelijk: 0 };
  const tel = (soort) => { verslag[soort]++; return soort; };

  /** Een database via VACUUM INTO (de Backups-klasse) naar versies/ en staat/<soort>.db. */
  const kopieerDb = async (bronDb, soort) => {
    const werk = join(staat, '.werk', soort);
    // Een restant van een afgebroken run gaat opzij: de werkmap moet leeg zijn, dan
    // gooit de Backups-klasse er nooit iets uit (hij ruimt alleen op boven 12 kopieën).
    for (const n of existsSync(werk) ? readdirSync(werk) : []) {
      mkdirSync(join(vorige, '.werk', soort), { recursive: true });
      renameSync(join(werk, n), join(vorige, '.werk', soort, n));
      opzij++;
    }
    const r = await new Backups({ db: bronDb, map: werk, log: () => {} }).nu('kopie');
    if (!r.ok) throw new Error(`${soort}.db: ${r.fout}`);
    const gemaakt = join(werk, r.naam);
    const nieuwSha = sha256(gemaakt);
    const versies = join(staat, 'versies');
    const eerder = readdirSync(versies).filter((n) => n.startsWith(`${soort}-`) && n.endsWith('.db')).sort();
    const laatste = eerder.at(-1) ?? null;
    const laatsteSha = laatste ? sha256(join(versies, laatste)) : null;
    const huidig = join(staat, `${soort}.db`);
    // Het huidige bestand mag alleen vervangen worden als zijn inhoud al als versie bewaard is.
    if (existsSync(huidig)) {
      const h = sha256(huidig);
      if (h !== nieuwSha && h !== laatsteSha) zetOpzij(`${soort}.db`);
    }
    let versie, nieuw;
    if (laatsteSha === nieuwSha) {
      versie = laatste; nieuw = false;
      renameSync(gemaakt, huidig);   // dezelfde inhoud als de laatste versie: geen versie erbij
    } else {
      versie = `${soort}-${stempel}.db`;
      for (let i = 2; existsSync(join(versies, versie)); i++) versie = `${soort}-${stempel}-${i}.db`;
      renameSync(gemaakt, join(versies, versie));
      copyFileSync(join(versies, versie), huidig);
      fsyncPad(huidig);
      nieuw = true;
    }
    fsyncPad(versies);
    fsyncPad(staat);
    return { versie: `versies/${versie}`, nieuw, bytes: statSync(huidig).size, sha256: nieuwSha };
  };

  uit('');
  const lib = await kopieerDb(P.db, 'library');
  const libTel = telLibrary(join(staat, 'library.db'));
  uit(`  library.db      ${lib.nieuw ? 'nieuwe versie' : 'ongewijzigd sinds'} ${lib.versie} (${maat(lib.bytes)}) · ${telTekst(libTel)}`);
  let kaart = null;
  if (kaartLive) {
    kaart = await kopieerDb(P.kaartDb, 'kaart');
    kaart.tellingen = telKaart(join(staat, 'kaart.db'));
    uit(`  kaart.db        ${kaart.nieuw ? 'nieuwe versie' : 'ongewijzigd sinds'} ${kaart.versie} · ${kaart.tellingen.wensen} wensen, ${kaart.tellingen.nachtRuns} nachtruns`);
  }

  const ontbreekt = [];
  for (const m of MAPPEN) {
    if (!existsSync(P.mappen[m])) { ontbreekt.push(`${m}/`); continue; }
    const per = { nieuw: 0, bijgewerkt: 0, gelijk: 0 };
    for (const rel of bestandenIn(P.mappen[m])) per[tel(zet(join(P.mappen[m], rel), `${m}/${rel}`))]++;
    uit(`  ${(m + '/').padEnd(15)} ${perTekst(per)}`);
  }
  {
    const per = { nieuw: 0, bijgewerkt: 0, gelijk: 0 };
    for (const n of logs) per[tel(zet(join(P.opnames, n), `handelingen/${n}`))]++;
    uit(`  handelingen/    ${perTekst(per)}`);
  }
  for (const l of losse) {
    if (!existsSync(l.bron)) { ontbreekt.push(l.naam); continue; }
    uit(`  ${l.naam.padEnd(15)} ${tel(zet(l.bron, l.doel))}`);
  }

  // ---- set B ----------------------------------------------------------------
  let setB = null;
  if (opties.media) {
    setB = { tijd: null, media: false, opnames: false };
    const rsync = (van, naar, extra, naam) => {
      if (!existsSync(van)) { uit(`  ${naam.padEnd(15)} ontbreekt (overgeslagen)`); return false; }
      mkdirSync(naar, { recursive: true });
      // -a zonder --delete: wat in de bron verdween blijft staan. Een bestand dat in de
      // kopie anders is, gaat eerst naar .vorige/<stempel>/<naam>/ (--backup-dir).
      const args = ['-a', '--backup', `--backup-dir=${join(varve, '.vorige', stempel, naam)}`, '--exclude=.DS_Store', ...extra, `${van}/`, `${naar}/`];
      uit(`  ${naam.padEnd(15)} rsync ${args.join(' ')}`);
      const r = spawnSync('rsync', args, { stdio: ['ignore', 'inherit', 'inherit'] });
      if (r.error || r.status !== 0) throw new Error(`rsync ${naam} mislukt (${r.error?.message || `code ${r.status}`})`);
      return true;
    };
    // De databases in media/ NIET als bestand (de WAL, §2): die staan al goed in set A.
    // Lopend werk (.bezig-*) ook niet. media/backups/ (VACUUM-kopieën van de server) wel.
    const dbNaam = (p) => `--exclude=/${basename(p)}*`;
    const inMedia = (p) => dirname(p) === P.media;
    const extraMedia = ['--exclude=/.bezig*', ...[P.db, P.kaartDb].filter(inMedia).map(dbNaam)];
    setB.media = rsync(P.media, join(varve, 'media'), extraMedia, 'media');
    setB.opnames = rsync(P.opnames, join(varve, 'opnames'), [], 'opnames');
    setB.tijd = new Date().toISOString();
  }

  // ---- manifest -------------------------------------------------------------
  const bestanden = bestandenIn(staat, { overslaan: ['versies', '.vorige', '.werk', 'MANIFEST.json'] })
    .map((rel) => ({ pad: rel, bytes: statSync(join(staat, rel)).size, sha256: sha256(join(staat, rel)) }));
  const bytes = bestanden.reduce((s, b) => s + b.bytes, 0);
  const manifest = {
    versie: 1,
    gemaakt: nu.toISOString(),
    stempel,
    host: hostname(),
    bron: P.bron,
    commit,
    doel: varve,
    zelfdeSchijf,
    library: { versie: lib.versie, sha256: lib.sha256, tellingen: libTel },
    kaart: kaart ? { versie: kaart.versie, sha256: kaart.sha256, tellingen: kaart.tellingen } : null,
    handelingen: logs.length,
    ontbreekt,
    setB: setB ?? (existsSync(join(varve, 'media')) ? 'eerder' : null),
    bestanden,
  };
  const tekst = JSON.stringify(manifest, null, 1) + '\n';
  writeFileSync(join(staat, 'versies', `MANIFEST-${stempel}.json`), tekst);
  writeFileSync(join(staat, '.MANIFEST.json.tmp'), tekst);
  fsyncPad(join(staat, '.MANIFEST.json.tmp'));
  renameSync(join(staat, '.MANIFEST.json.tmp'), join(staat, 'MANIFEST.json'));
  fsyncPad(staat);
  uit(`  MANIFEST.json   ${bestanden.length} bestanden, ${maat(bytes)}`);

  // ---- stempel voor het avondpakket ----------------------------------------
  try {
    mkdirSync(dirname(P.stempel), { recursive: true });
    writeFileSync(P.stempel, JSON.stringify({
      doel: varve, tijd: nu.toISOString(), setA: true, setB: !!setB, bytes, zelfdeSchijf,
      tracks: libTel.tracks, host: hostname(),
    }, null, 1) + '\n');
  } catch (err) { uit(`  (stempel ${P.stempel} niet geschreven: ${err.message})`); }

  const ms = performance.now() - t0;
  uit(`klaar in ${(ms / 1000).toFixed(1).replace('.', ',')} s: ${verslag.nieuw} nieuw, ${verslag.bijgewerkt} bijgewerkt, ${verslag.gelijk} gelijk; `
    + `niets weggegooid${opzij ? ` (${opzij} oude versie${opzij === 1 ? '' : 's'} opzij in .vorige/${stempel}/)` : ''}`);

  if (opties.controleer) {
    uit('');
    const c = controleer({ doel: doelOpgegeven, bron: P.bron, env });
    drukAf(c, uit);
    return c.ok ? 0 : 1;
  }
  return 0;
}

function telTekst(t) {
  return `${t.tracks} nummers, ${t.hotcues} hotcues, ${t.racks} rack${t.racks === 1 ? '' : 's'}, ${t.samples} pads, `
    + `${t.gridsOpSlot} grid${t.gridsOpSlot === 1 ? '' : 's'} op slot, schema v${t.schema}`;
}
const perTekst = (p) => `${p.nieuw} nieuw, ${p.bijgewerkt} bijgewerkt, ${p.gelijk} gelijk`;

// ---- als commando ------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { opties, fout } = leesArgs(process.argv.slice(2), { vlaggen: VLAGGEN, waarden: ['doel', 'bron'] });
  if (opties.help) { console.log(HULP); process.exit(0); }
  if (fout || !opties.doel) {
    console.error(`kopie: ${fout || 'geef --doel <map>'}\n\n${HULP}`);
    process.exit(2);
  }
  try {
    process.exitCode = await kopie(opties);
  } catch (err) {
    console.error(`kopie MISLUKT: ${err?.message || err}`);
    process.exitCode = 1;
  }
}
