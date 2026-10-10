#!/usr/bin/env node
/**
 * Patronen naar een MIDI-bestand voor Logic (docs/PATRONEN.md §8), uit een KOPIE van
 * patronen/<naam>.json. Bestand in, bestand uit: geen server, geen database, geen bus.
 *
 *   node tools/patronen/midi.mjs --set <kopie van patronen/<naam>.json> --uit <pad.mid>
 *     [--track N [--plek K]]   één track (1..8), of één patroon (plek 1..5); zonder: de hele set
 *     [--omlopen M]            zoveel keer het patroon (1..16, standaard 1)
 *     [--bpm B]                tempo in het bestand (40..240); standaard het tempo van de set
 *     [--zonder-meta]          alleen noten, zonder de `varve:patroon`-tekst
 *
 * Schrijft nooit over een bestaand bestand heen. Exit: 0 geschreven, 1 verkeerd aangeroepen,
 * set onleesbaar of geen gevulde patronen, 2 --uit bestaat al.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { setNaarSmf } from '../../src/export/patronen-smf.js';
import { normaliseerSet, TRACKS, PLEKKEN } from '../../src/engine/patronen/model.js';

const GEBRUIK = 'gebruik: midi.mjs --set <set.json> --uit <pad.mid> [--track N [--plek K]] [--omlopen M] [--bpm B] [--zonder-meta]';
const fout = (tekst, code = 1) => { process.stderr.write(`midi: ${tekst}\n`); process.exit(code); };
const geheel = (k, v, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fout(`${k} ${v}: een geheel getal ${min}..${max}`);
  return n;
};

const a = { set: null, uit: null, track: null, plek: null, omlopen: 1, bpm: null, meta: true };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i], waarde = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) fout(`${k} zonder waarde\n${GEBRUIK}`); return v; };
  if (k === '--set') a.set = waarde();
  else if (k === '--uit') a.uit = waarde();
  else if (k === '--track') a.track = geheel(k, waarde(), 1, TRACKS);
  else if (k === '--plek') a.plek = geheel(k, waarde(), 1, PLEKKEN);
  else if (k === '--omlopen') a.omlopen = geheel(k, waarde(), 1, 16);
  else if (k === '--bpm') { a.bpm = Number(waarde()); if (!Number.isFinite(a.bpm)) fout(`--bpm is een getal\n${GEBRUIK}`); }
  else if (k === '--zonder-meta') a.meta = false;
  else if (k === '-h' || k === '--help') { process.stdout.write(GEBRUIK + '\n'); process.exit(0); }
  else fout(`onbekend: ${k}\n${GEBRUIK}`);
}
if (!a.set || !a.uit) fout(GEBRUIK);
if (a.plek !== null && a.track === null) fout('--plek alleen samen met --track');

let ruw;
try { ruw = JSON.parse(readFileSync(a.set, 'utf8')); } catch (e) { fout(`${a.set} is niet te lezen (${e.code ?? e.message})`); }
for (const f of normaliseerSet(ruw).fouten) process.stderr.write(`midi: let op: ${f}\n`);

let bytes;
try { bytes = setNaarSmf(ruw, { track: a.track, plek: a.plek, omlopen: a.omlopen, bpm: a.bpm, meta: a.meta }); } catch (e) { fout(e.message); }
if (!bytes) fout(a.track === null ? 'geen gevulde patronen' : `geen gevuld patroon op track ${a.track}${a.plek ? ` plek ${a.plek}` : ''}`);
try { writeFileSync(a.uit, bytes, { flag: 'wx' }); }
catch (e) { if (e.code === 'EEXIST') fout(`${a.uit} bestaat al; niets overschreven`, 2); fout(`${a.uit}: ${e.code ?? e.message}`); }
process.stderr.write(`midi: geschreven: ${a.uit} (${bytes.length} bytes)\n`);
