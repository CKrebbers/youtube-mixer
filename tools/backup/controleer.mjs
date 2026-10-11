#!/usr/bin/env node
// Klopt de kopie? (docs/BACKUP.md; de "sonde reiskopie" van het avondpakket)
//
//   node tools/backup/controleer.mjs --doel <map> [--bron <checkout>]
//
// Leest alleen. Drie vragen:
//   1. Is de kopie heel? Elk bestand uit MANIFEST.json staat er met dezelfde grootte en
//      SHA-256; library.db (en kaart.db) geven quick_check 'ok' en dezelfde tellingen als
//      het manifest. Nee = NIET OK, exit 1.
//   2. Is hij bij? De tellingen naast die van de library van nu (alleen-lezen):
//      "15/15 nummers, 15/15 hotcues …"; nummers die er sindsdien bij kwamen = LET OP.
//   3. Is set B er? Per nummer in de kopie: staat zijn audio in <doel>/varve/media/?
// Exit: 0 in orde (ook met LET OP) · 1 NIET OK · 2 verkeerd aangeroepen.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WORTEL, leesArgs, thuisPad, paden, varveMap, sha256, snelleControle, telLibrary, telKaart,
  nummersVan, leesJson, geleden,
} from './gedeeld.mjs';

const HULP = `gebruik: node tools/backup/controleer.mjs --doel <map> [--bron <checkout>]

  --doel <map>       hetzelfde doel als bij kopie.mjs (of <map>/varve, of <map>/varve/staat)
  --bron <checkout>  de library van nu om mee te vergelijken; standaard ${WORTEL}
Leest alleen. Zie docs/BACKUP.md.`;

/** Elke telling die in de kopie en nu kan verschillen, met hoe hij heet. */
const NAMEN = [['tracks', 'nummers'], ['hotcues', 'hotcues'], ['racks', 'racks'], ['samples', 'pads'],
  ['gridsOpSlot', 'grids op slot'], ['stems', 'stems-sets'], ['secties', 'sectiekaarten']];

export function controleer({ doel, bron = WORTEL, env = process.env, nu = Date.now() }) {
  const regels = [], waarschuwingen = [], fouten = [];
  const varve = varveMap(doel);
  const staat = join(varve, 'staat');
  const manifest = leesJson(join(staat, 'MANIFEST.json'));
  if (!manifest) {
    fouten.push(`geen leesbaar MANIFEST.json in ${staat}`);
    return { ok: false, regels, waarschuwingen, fouten, staat };
  }
  const leeftijd = nu - Date.parse(manifest.gemaakt);
  regels.push(`kopie van ${geleden(leeftijd)} (${manifest.stempel}, ${manifest.host}${manifest.commit ? `, commit ${manifest.commit}` : ''})`);
  if (manifest.zelfdeSchijf) regels.push('staat op dezelfde schijf als de bron: een versie, geen backup buiten de laptop');
  if (leeftijd > 7 * 864e5) waarschuwingen.push(`de kopie is ${geleden(leeftijd)} gemaakt`);

  // 1. heel?
  let goed = 0;
  for (const b of manifest.bestanden ?? []) {
    const p = join(staat, b.pad);
    if (!existsSync(p)) { fouten.push(`ontbreekt: ${b.pad}`); continue; }
    if (statSync(p).size !== b.bytes || sha256(p) !== b.sha256) { fouten.push(`anders dan bij het maken: ${b.pad}`); continue; }
    goed++;
  }
  regels.push(`${goed}/${manifest.bestanden?.length ?? 0} bestanden zoals in het manifest`);

  const db = join(staat, 'library.db');
  let kopieTel = null;
  if (!existsSync(db)) fouten.push('library.db ontbreekt in de kopie');
  else {
    const qc = snelleControle(db);
    if (qc !== 'ok') fouten.push(`library.db: quick_check zegt ${qc}`);
    kopieTel = telLibrary(db);
    const anders = NAMEN.filter(([k]) => kopieTel[k] !== manifest.library?.tellingen?.[k]);
    if (anders.length) fouten.push(`library.db telt anders dan het manifest: ${anders.map(([k, n]) => `${n} ${kopieTel[k]} ≠ ${manifest.library?.tellingen?.[k]}`).join(', ')}`);
    const versie = manifest.library?.versie && join(staat, manifest.library.versie);
    if (versie && (!existsSync(versie) || sha256(versie) !== manifest.library.sha256)) fouten.push(`versie ${manifest.library.versie} ontbreekt of is anders`);
  }
  if (manifest.kaart) {
    const k = join(staat, 'kaart.db');
    if (!existsSync(k)) fouten.push('kaart.db ontbreekt in de kopie');
    else {
      const qc = snelleControle(k);
      if (qc !== 'ok') fouten.push(`kaart.db: quick_check zegt ${qc}`);
      const t = telKaart(k);
      if (t.wensen !== manifest.kaart.tellingen?.wensen || t.nachtRuns !== manifest.kaart.tellingen?.nachtRuns) fouten.push('kaart.db telt anders dan het manifest');
    }
  }

  // 2. bij?
  const P = paden(bron, env);
  if (kopieTel && existsSync(P.db)) {
    const nuTel = telLibrary(P.db);
    regels.push(NAMEN.slice(0, 5).map(([k, n]) => `${kopieTel[k]}/${nuTel[k]} ${n}`).join(', ') + ' (kopie/nu)');
    const inKopie = nummersVan(db);
    const erbij = [...nummersVan(P.db).keys()].filter((id) => !inKopie.has(id));
    if (erbij.length) waarschuwingen.push(`${erbij.length} nummer${erbij.length === 1 ? '' : 's'} nieuwer dan de kopie (${erbij.slice(0, 5).join(', ')}${erbij.length > 5 ? ', …' : ''})`);
    for (const [k, n] of NAMEN.slice(1)) {
      if (nuTel[k] !== kopieTel[k]) waarschuwingen.push(`${n}: kopie ${kopieTel[k]}, nu ${nuTel[k]}`);
    }
    if (nuTel.schema !== kopieTel.schema) regels.push(`schema: kopie v${kopieTel.schema}, nu v${nuTel.schema}`);
  } else if (kopieTel) regels.push(`geen library van nu op ${P.db}: niet vergeleken`);

  // 3. set B?
  const media = join(varve, 'media');
  if (kopieTel && existsSync(media)) {
    const zonder = [];
    for (const [id, audio] of nummersVan(db)) {
      const rel = String(audio || `media/${id}/audio.wav`).replace(/^media\//, '');
      if (!existsSync(join(media, rel))) zonder.push(id);
    }
    regels.push(`set B: ${zonder.length} nummer${zonder.length === 1 ? '' : 's'} zonder media-kopie`);
    if (zonder.length) waarschuwingen.push(`${zonder.length} nummer${zonder.length === 1 ? '' : 's'} zonder media-kopie (${zonder.slice(0, 5).join(', ')}${zonder.length > 5 ? ', …' : ''})`);
  } else regels.push('set B: niet in dit doel (alleen de staat)');

  return { ok: fouten.length === 0, regels, waarschuwingen, fouten, staat };
}

export function drukAf(c, uit = console.log) {
  uit(`controle van ${c.staat}`);
  for (const r of c.regels) uit(`  ${r}`);
  for (const f of c.fouten) uit(`  FOUT ${f}`);
  for (const w of c.waarschuwingen) uit(`  LET OP ${w}`);
  if (!c.ok) uit(`NIET OK: ${c.fouten.length} fout${c.fouten.length === 1 ? '' : 'en'}`);
  else if (c.waarschuwingen.length) uit(`kopie in orde; LET OP: ${c.waarschuwingen.join('; ')}`);
  else uit('alles ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { opties, fout } = leesArgs(process.argv.slice(2), { vlaggen: ['help'], waarden: ['doel', 'bron'] });
  if (opties.help) { console.log(HULP); process.exit(0); }
  if (fout || !opties.doel) { console.error(`controleer: ${fout || 'geef --doel <map>'}\n\n${HULP}`); process.exit(2); }
  try {
    const c = controleer({ doel: opties.doel, bron: opties.bron ? thuisPad(opties.bron) : WORTEL });
    drukAf(c);
    process.exitCode = c.ok ? 0 : 1;
  } catch (err) {
    console.error(`controleer MISLUKT: ${err?.message || err}`);
    process.exitCode = 1;
  }
}
