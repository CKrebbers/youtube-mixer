// De voorgangers van een standaardmapping bijwerken (`eerder` in
// mappings/<apparaat>.json), na een wijziging aan die standaard.
//
// Waarom: een oude VOLLEDIGE kopie van iemands eigen mapping (van vóór het
// bewaren als verschil) weet niet op welke standaard hij rustte. De app zet
// hem om tegen de standaard waar hij het dichtst bij ligt, de huidige of een
// voorganger uit `eerder` (verschilVanKopie in src/control/mapping.js). Zonder
// die voorganger zou alles wat de standaard erbij kreeg als "door jou
// weggehaald" gelden, en kwam het nooit bij je binnen.
//
// Elke voorganger staat er als verschil met de HUIDIGE regels. Verandert de
// standaard, dan klopt geen enkele voorganger meer (test/mapping.test.mjs
// faalt dan). Dit script rekent ze opnieuw uit: de versie uit git (standaard
// HEAD) wordt een voorganger, en de voorgangers die die al had komen mee.
//
// Gebruik:  node tools/mapping/eerder.mjs [git-revisie] [apparaat]
//           (standaard HEAD en apc40mk2; schrijft het bestand in de werkmap)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { maakEerder, eerdereStandaarden, vingerafdruk } from '../../src/control/mapping.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const rev = process.argv[2] || 'HEAD';
const apparaat = process.argv[3] || 'apc40mk2';
const pad = join(WORTEL, 'mappings', `${apparaat}.json`);

const nu = JSON.parse(readFileSync(pad, 'utf8'));
const vorige = JSON.parse(execFileSync('git', ['show', `${rev}:mappings/${apparaat}.json`], { cwd: WORTEL, encoding: 'utf8' }));
const vNu = vingerafdruk(nu);

// De vorige standaard zelf, wat die als voorgangers had (tegen zijn eigen
// regels), en wat de werkversie al aan kloppende voorgangers heeft: zo gaat er
// niets verloren als je dit twee keer draait (HEAD is dan al de werkversie).
const tot = (doc, v) => doc.eerder?.find((x) => x.vingerafdruk === v)?.tot;
const kandidaten = [{ vingerafdruk: vingerafdruk(vorige), doc: vorige, tot: new Date().toISOString().slice(0, 10) },
  ...eerdereStandaarden(vorige).map((e) => ({ ...e, tot: tot(vorige, e.vingerafdruk) })),
  ...eerdereStandaarden(nu).map((e) => ({ ...e, tot: tot(nu, e.vingerafdruk) }))];
const gezien = new Set([vNu]);
const eerder = [];
for (const k of kandidaten) {
  if (gezien.has(k.vingerafdruk)) continue;
  gezien.add(k.vingerafdruk);
  const e = maakEerder(nu, k.doc);
  eerder.push({ vingerafdruk: e.vingerafdruk, ...(k.tot ? { tot: k.tot } : {}), ...(e.top ? { top: e.top } : {}), rules: e.rules, removed: e.removed });
}
const verloren = (Array.isArray(vorige.eerder) ? vorige.eerder.length : 0) - eerdereStandaarden(vorige).length;
if (verloren > 0) console.warn(`let op: ${verloren} voorganger(s) in ${rev} klopten al niet meer en vallen weg`);

nu.eerder = eerder;
writeFileSync(pad, JSON.stringify(nu, null, 2) + '\n');
// Controle: elke voorganger moet terug te rekenen zijn.
const terug = eerdereStandaarden(JSON.parse(readFileSync(pad, 'utf8')));
console.log(`${apparaat}: standaard ${vNu}, ${eerder.length} voorganger(s): `
  + eerder.map((e) => `${e.vingerafdruk} (+${e.rules.length} / −${e.removed.length})`).join(', ')
  + (terug.length === eerder.length ? ' — alle terug te rekenen' : ` — FOUT: maar ${terug.length} terug te rekenen`));
process.exit(terug.length === eerder.length ? 0 : 1);
