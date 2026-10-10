#!/usr/bin/env node
/**
 * Het setboek van een avond, uit KOPIEËN van de handelingenlogs (tools/setboek/LEESMIJ.md).
 * Leest alleen. Schrijft standaard naar stdout; naar een bestand alleen met --uit of
 * --naast-log, en nooit over een bestaand bestand heen.
 *
 *   node tools/setboek/setboek.mjs --dag 20261010 --map <kopie van opnames/> [--vanaf 17:00]
 *   node tools/setboek/setboek.mjs --log <pad> [--log <pad> …]
 *     [--db <kopie van media/library.db>]   lengte per nummer: het einde van een nummer schatten
 *     [--proef <kopie van proef/sessie.json>] proefpunten met "fout" of een notitie op de tijdlijn
 *     [--json]                              JSON in plaats van Markdown
 *     [--uit <pad>]                         naar dit bestand (bestaat het: exit 2)
 *     [--naast-log]                         naast het eerste log: set-<id>.setboek.md (bestaat het: exit 2)
 *
 * --dag neemt set-JJJJMMDD-*.acties.jsonl, plus de logs van de volgende ochtend vóór 06:00
 * (een avond die over middernacht loopt). --vanaf UU:MM laat alles vóór die tijd (Amsterdam) weg,
 * ook binnen één log (met het vinkje "altijd" loopt één log van de opbouw tot na de set): de
 * opbouw 's middags hoort niet in de tracklist. Een log dat vóór die tijd EINDIGDE staat onder
 * "overgeslagen". Exit: 0 goed, 1 verkeerd aangeroepen, 2 bestaat al.
 * Nooit tijdens een set, nooit op de echte opnames/ (kopieer eerst).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { setboek, naarMarkdown, naarJson, amsterdamMs } from './lees.mjs';

const GEBRUIK = 'gebruik: setboek.mjs (--dag JJJJMMDD --map <map> [--vanaf UU:MM] | --log <pad> …) [--db <library.db>] [--proef <sessie.json>] [--json] [--uit <pad> | --naast-log]';
const fout = (tekst, code = 1) => { process.stderr.write(`setboek: ${tekst}\n`); process.exit(code); };
const melding = (tekst) => process.stderr.write(`setboek: ${tekst}\n`);

function lees(argv) {
  const a = { log: [], dag: null, map: null, vanaf: null, db: null, proef: null, json: false, uit: null, naastLog: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], waarde = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) fout(`${k} zonder waarde\n${GEBRUIK}`); return v; };
    if (k === '--log') a.log.push(waarde());
    else if (k === '--dag') a.dag = waarde();
    else if (k === '--map') a.map = waarde();
    else if (k === '--vanaf') a.vanaf = waarde();
    else if (k === '--db') a.db = waarde();
    else if (k === '--proef') a.proef = waarde();
    else if (k === '--uit') a.uit = waarde();
    else if (k === '--json') a.json = true;
    else if (k === '--naast-log') a.naastLog = true;
    else if (k === '-h' || k === '--help') { process.stdout.write(GEBRUIK + '\n'); process.exit(0); }
    else fout(`onbekend: ${k}\n${GEBRUIK}`);
  }
  if (!a.log.length && !(a.dag && a.map)) fout(GEBRUIK);
  if (a.log.length && (a.dag || a.map)) fout('--log of --dag/--map, niet allebei');
  if (a.dag && !/^\d{8}$/.test(a.dag)) fout('--dag is JJJJMMDD');
  if (a.uit && a.naastLog) fout('--uit of --naast-log, niet allebei');
  if (a.vanaf !== null && (!a.dag || !/^\d{2}:\d{2}$/.test(a.vanaf) || amsterdamMs(a.dag, a.vanaf) === null)) fout('--vanaf is UU:MM, en alleen met --dag');
  return a;
}

/** De logs van --dag: die dag, plus de volgende dag vóór 06:00. */
function logsVanDag(map, dag) {
  const d = new Date(Date.UTC(+dag.slice(0, 4), +dag.slice(4, 6) - 1, +dag.slice(6, 8) + 1));
  const volgende = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  let namen;
  try { namen = readdirSync(map); } catch (e) { fout(`map ${map} is niet te lezen (${e.code ?? e.message})`); }
  return namen.filter((n) => new RegExp(`^set-(${dag}-\\d{6}|${volgende}-0[0-5]\\d{4})(-\\d+)?\\.acties\\.jsonl$`).test(n)).sort().map((n) => join(map, n));
}

/** Waarschuwen als een pad in de echte opnames/ van een checkout ligt (daar schrijft de server). */
function waarschuwEcht(paden) {
  for (const p of paden) {
    const map = dirname(resolve(p));
    if (basename(map) === 'opnames' && existsSync(join(map, '..', 'server', 'index.js'))) {
      melding(`${p} ligt in de opnames/ van een checkout; lees liever een kopie (cp naar een kladmap).`);
      return;
    }
  }
}

/** lengte(nummer) uit een kopie van library.db (alleen lezen), of null met een melding. */
async function lengteUitDb(pad) {
  if (!existsSync(pad)) { melding(`--db ${pad} bestaat niet: zonder lengtes (het einde van een nummer wordt niet geschat)`); return null; }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(pad, { readOnly: true });
    const vraag = db.prepare('SELECT duur FROM tracks WHERE id = ?');
    const cache = new Map();
    return (id) => {
      if (!cache.has(id)) { const r = vraag.get(String(id)); cache.set(id, r && Number.isFinite(r.duur) && r.duur > 0 ? r.duur : null); }
      return cache.get(id);
    };
  } catch (e) {
    melding(`--db ${pad} is niet te lezen (${e.message}): zonder lengtes`);
    return null;
  }
}

const a = lees(process.argv.slice(2));
const paden = a.log.length ? a.log : logsVanDag(a.map, a.dag);
waarschuwEcht(paden);
const bestanden = [];
for (const p of paden) {
  try { bestanden.push({ bestand: p, tekst: readFileSync(p, 'utf8') }); } catch (e) { fout(`${p} is niet te lezen (${e.code ?? e.message})`); }
}
const lengte = a.db ? await lengteUitDb(a.db) : null;
let proef = null;
if (a.proef) {
  try { proef = JSON.parse(readFileSync(a.proef, 'utf8')); } catch (e) { melding(`--proef ${a.proef} is niet te lezen (${e.code ?? e.message}): zonder proefpunten`); }
}
const res = setboek(bestanden, { lengte, proef, vanafMs: a.vanaf ? amsterdamMs(a.dag, a.vanaf) : null });
const tekst = a.json ? naarJson(res) + '\n' : naarMarkdown(res);

const doel = a.uit ?? (a.naastLog && paden[0] ? join(dirname(paden[0]), basename(paden[0]).replace(/\.acties\.jsonl$/, '.setboek' + (a.json ? '.json' : '.md'))) : null);
if (!doel) process.stdout.write(tekst);
else {
  try { writeFileSync(doel, tekst, { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') fout(`${doel} bestaat al; niets overschreven`, 2); throw e; }
  melding(`geschreven: ${doel}`);
}
if (res.melding) melding(res.melding);
