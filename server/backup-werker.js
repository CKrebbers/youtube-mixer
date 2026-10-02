import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, openSync, fsyncSync, closeSync, renameSync, rmSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Eén backup van de library, buiten de hoofdthread (zie backup.js).
 *
 * 1. Een EIGEN verbinding, alleen-lezen, en `VACUUM INTO` een tijdelijk
 *    bestand in de backupmap. Dat is één leestransactie: een momentopname
 *    inclusief wat nog in de WAL staat, terwijl de server doorschrijft.
 * 2. fsync: VACUUM INTO doet dat zelf niet. Zonder kan een stroomstoring
 *    vlak na de backup een lege of halve kopie achterlaten.
 * 3. `PRAGMA quick_check` op de kopie. Is die niet 'ok', dan is de library
 *    zelf waarschijnlijk beschadigd: de kopie gaat weg (hij mag geen goede
 *    oude kopie uit de rij duwen) en het wordt een fout.
 * 4. Dezelfde inhoud als de nieuwste kopie (SHA-256)? Dan weg, niets nieuws.
 * 5. Anders hernoemen naar de echte naam. Pas dan is hij er.
 *
 * Meldt { ok, nieuw, bytes } of { ok: false, fout }. Gooit nooit.
 */
const { db: dbPad, map, naam, tijdelijk, vorige } = workerData;
const tmp = join(map, tijdelijk);

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

let r;
let bron = null;
try {
  // Alleen-lezen: een ontbrekende library maakt zo geen nieuwe, lege aan.
  if (!existsSync(dbPad)) throw new Error(`database niet gevonden: ${dbPad}`);
  mkdirSync(map, { recursive: true });
  bron = new DatabaseSync(dbPad, { readOnly: true, timeout: 5000 });
  bron.prepare('VACUUM INTO ?').run(tmp);
  bron.close();
  bron = null;

  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }

  const kopie = new DatabaseSync(tmp, { readOnly: true });
  let controle;
  try { controle = kopie.prepare('PRAGMA quick_check').get()?.quick_check; } finally { kopie.close(); }
  if (controle !== 'ok') throw new Error(`kopie niet in orde (quick_check: ${controle}) — is library.db beschadigd?`);

  const bytes = statSync(tmp).size;
  const zelfde = vorige && existsSync(join(map, vorige)) && hash(join(map, vorige)) === hash(tmp);
  if (zelfde) {
    rmSync(tmp, { force: true });
    r = { ok: true, nieuw: false, bytes };
  } else {
    if (existsSync(join(map, naam))) throw new Error(`${naam} bestaat al`);
    renameSync(tmp, join(map, naam));
    // De map zelf ook naar schijf, zodat de nieuwe naam een stroomstoring overleeft.
    try { const d = openSync(map, 'r'); try { fsyncSync(d); } finally { closeSync(d); } } catch (_) {}
    r = { ok: true, nieuw: true, bytes };
  }
} catch (err) {
  try { bron?.close(); } catch (_) {}
  try { rmSync(tmp, { force: true }); } catch (_) {}
  r = { ok: false, fout: String(err?.message || err) };
}
parentPort.postMessage(r);
