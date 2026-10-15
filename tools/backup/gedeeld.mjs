// Gedeeld door kopie.mjs, controleer.mjs en herstel.mjs (docs/BACKUP.md).
// Geen test zelf en geen CLI: paden, tellingen, hashes en kleine hulpjes.
//
// De paden zijn die van de server (server/index.js, server/routes/, server/media-plek.js):
// dezelfde VARVE_*-variabelen, en zonder variabelen de mappen in de checkout. `bron` is de checkout; standaard
// die waar dit bestand in staat, met --bron een andere (bv. de echte Bureaublad-map
// vanuit een worktree, alleen lezen).
import { existsSync, statSync, lstatSync, readFileSync, readdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { kiesMedia as kiesMediaServer, echtPad, isTestserver } from '../../server/media-plek.js';
import { INSTELLING_SLEUTELS } from '../../src/ui/instellingen-lijst.js';

export { echtPad };

/** De checkout waar deze tools in staan. */
export const WORTEL = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * De mappen van set A die als geheel meegaan (inclusief .versies/ e.d.). sets/ en
 * werkruimtes/ sinds de werkruimte (14 okt, S3 en S9; VARVE_SETS, VARVE_WERKRUIMTES).
 */
export const MAPPEN = ['patronen', 'plannen', 'proef', 'standen', 'sets', 'werkruimtes', 'racks', 'mappings', 'Input'];

/** Nooit meenemen: rommel van de Finder. Al het andere wel, ook conflictkopieën ("… 2"). */
const ROMMEL = new Set(['.DS_Store']);

/**
 * Argumenten: `--naam waarde`, `--naam=waarde` en losse vlaggen. Onbekend = fout.
 * Geeft { opties, fout }.
 */
export function leesArgs(argv, { vlaggen = [], waarden = [] }) {
  const opties = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) return { opties, fout: `onbekend argument: ${a}` };
    const [, naam, waarde] = m;
    if (vlaggen.includes(naam)) {
      if (waarde !== undefined) return { opties, fout: `--${naam} neemt geen waarde` };
      opties[naam] = true;
    } else if (waarden.includes(naam)) {
      const w = waarde ?? argv[++i];
      if (w === undefined || w === '' || w.startsWith('--')) return { opties, fout: `--${naam} mist een waarde` };
      opties[naam] = w;
    } else return { opties, fout: `onbekende optie: --${naam}` };
  }
  return { opties, fout: null };
}

/** `~/…` uitschrijven (de shell doet dat niet bij --doel=~/x). */
export const thuisPad = (p) => resolve(p.replace(/^~(?=$|\/)/, homedir()));

/** Het pad van de kaart zoals de server het kiest: VARVE_KAART, de instelling `kaart_pad`, het standaardpad. */
function kaartPad(db, env) {
  if (env.VARVE_KAART) return schoon(env.VARVE_KAART);
  if (existsSync(db)) {
    try {
      const d = new DatabaseSync(db, { readOnly: true, timeout: 5000 });
      try {
        const r = d.prepare("SELECT waarde FROM instellingen WHERE sleutel = 'kaart_pad'").get();
        const w = r ? JSON.parse(r.waarde) : null;
        if (typeof w === 'string' && w) return w;
      } finally { d.close(); }
    } catch (_) { /* geen tabel of geen geldige waarde: het standaardpad */ }
  }
  return join(env.HOME || homedir(), 'Desktop', '3. Resources', 'Data', 'Muziekkaart', 'varve-kaart.json');
}

/** Ligt `pad` in `map` (of is het `map` zelf)? Op de echte paden: een symlink of alias telt mee. */
export function ligtIn(pad, map) {
  const a = echtPad(pad), m = echtPad(map);
  return a === m || a.startsWith(m.endsWith(sep) ? m : m + sep);
}

/** Een pad zonder slash aan het eind, met ~ uitgeschreven (`/x/media/` en `/x/media` zijn één map). */
const schoon = (p) => (p ? thuisPad(String(p).trim()) : p);

/** ~/.varve/media-pad: waar VARVE.app VARVE_MEDIA vandaan haalt (tools/varve-app/VARVE.applescript). */
export const mediaPadBestand = (env = process.env) => join(env.HOME || homedir(), '.varve', 'media-pad');

/** De eerste regel van ~/.varve/media-pad (een absoluut pad), of null. */
export function leesMediaPad(env = process.env) {
  let tekst;
  try { tekst = readFileSync(mediaPadBestand(env), 'utf8'); } catch (_) { return null; }
  const regel = tekst.split('\n')[0].trim();
  return regel.startsWith('/') || regel.startsWith('~') ? schoon(regel) : null;
}

/**
 * De mediamap zoals de server hem krijgt. Zoals de server (kiesMedia in
 * server/media-plek.js): VARVE_MEDIA, anders <bron>/media, en als die er niet meer
 * is het pad uit media-VERHUISD.txt (een testserver volgt dat nooit). Daartussen,
 * zoals VARVE.app de server start: ~/.varve/media-pad als VARVE_MEDIA niet gezet is.
 * Zo vindt een kopie uit launchd (geen ~/.zprofile, dus geen VARVE_MEDIA) dezelfde
 * map als de server uit het Dock. Een testomgeving (VARVE_TESTSERVER=1) leest het
 * bestand nooit. Geeft { map, bron } met map zonder slash aan het eind.
 */
function kiesMedia(bron, env) {
  if (env.VARVE_MEDIA) return { map: schoon(env.VARVE_MEDIA), bron: 'VARVE_MEDIA' };
  if (!isTestserver(env)) {
    const pad = leesMediaPad(env);
    if (pad) return { map: pad, bron: '~/.varve/media-pad' };
  }
  const k = kiesMediaServer({ env, wortel: bron });
  return { map: schoon(k.map), bron: k.bron };
}

/**
 * Waar alles staat, zoals de server het ziet. De library is die van de server:
 * VARVE_DB, anders <media>/library.db (server/index.js). `waarschuwing` is gezet
 * als er nog een andere library ligt die een server zonder VARVE_MEDIA zou pakken
 * (<bron>/media/library.db naast een media-pad of VARVE_MEDIA elders): de kopie
 * gaat door met de gekozen library en zegt het.
 */
export function paden(bron = WORTEL, env = process.env) {
  bron = resolve(bron);
  const { map: media, bron: mediaBron } = kiesMedia(bron, env);
  const db = schoon(env.VARVE_DB) || join(media, 'library.db');
  const naast = dirname(db);
  let waarschuwing = null;
  const oud = join(bron, 'media', 'library.db');
  if (!env.VARVE_DB && existsSync(oud) && existsSync(db) && echtPad(oud) !== echtPad(db)) {
    waarschuwing = `er staan twee libraries: ${db} (via ${mediaBron}, deze gaat mee) en ${oud} `
      + '(die pakt een server die zonder VARVE_MEDIA start); zet VARVE_DB als je de andere bedoelt';
  }
  const mappen = {
    patronen: schoon(env.VARVE_PATRONEN) || join(bron, 'patronen'),
    plannen: schoon(env.VARVE_PLANNEN) || join(bron, 'plannen'),
    proef: schoon(env.VARVE_PROEF) || join(bron, 'proef'),
    standen: schoon(env.VARVE_STANDEN) || join(bron, 'standen'),
    sets: schoon(env.VARVE_SETS) || join(bron, 'sets'),
    werkruimtes: schoon(env.VARVE_WERKRUIMTES) || join(bron, 'werkruimtes'),
    racks: join(bron, 'racks'),
    mappings: join(bron, 'mappings'),
    Input: join(bron, 'Input'),
  };
  return {
    bron, db, waarschuwing, mappen,
    media, mediaBron,
    opnames: schoon(env.VARVE_OPNAMES) || join(bron, 'opnames'),
    kaartDb: schoon(env.VARVE_KAART_DB) || join(naast, 'kaart.db'),
    nacht: schoon(env.VARVE_NACHT) || join(naast, 'nacht.json'),
    stemsRij: join(naast, 'stems-rij.json'),
    // Sinds 14 okt (server/routes/): de apparaten van het paneel naast media/, de eigen
    // sjablonen (staan normaal in racks/, met VARVE_SJABLONEN ergens anders) en de
    // uitzenddoelen (uitzend/doelen.json, niet in git).
    paneelApparaten: schoon(env.VARVE_PANEEL_APPARATEN) || join(media, 'paneel-apparaten.json'),
    sjablonen: schoon(env.VARVE_SJABLONEN) || join(bron, 'racks', 'eigen.json'),
    sjablonenApart: !!env.VARVE_SJABLONEN,
    uitzendDoelen: join(bron, 'uitzend', 'doelen.json'),
    hub: schoon(env.VARVE_HUB_STAAT) || join(env.HOME || homedir(), '.varve-hub', 'staat.json'),
    kaartJson: kaartPad(db, env),
    stempel: schoon(env.VARVE_BACKUP_STEMPEL) || join(env.HOME || homedir(), '.varve', 'backup-laatste.json'),
  };
}

/** De backupmap onder een doel: <doel>/varve. Accepteert ook <doel>/varve en <doel>/varve/staat zelf. */
export function varveMap(doel) {
  const d = thuisPad(doel);
  if (existsSync(join(d, 'MANIFEST.json')) && existsSync(join(d, 'library.db'))) return dirname(d);   // …/varve/staat
  if (existsSync(join(d, 'staat', 'MANIFEST.json'))) return d;                                         // …/varve
  return join(d, 'varve');
}

export function sha256(pad) {
  return createHash('sha256').update(readFileSync(pad)).digest('hex');
}

/** Een bestand (of map) naar schijf: een kopie die een stroomstoring niet overleeft is er geen. */
export function fsyncPad(pad) {
  try { const fd = openSync(pad, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch (_) { /* best effort (map op sommige schijven) */ }
}

/** Het apparaat van een pad, of van de dichtstbijzijnde map erboven die bestaat. */
export function schijfVan(p) {
  let q = resolve(p);
  while (!existsSync(q)) { const o = dirname(q); if (o === q) break; q = o; }
  return statSync(q).dev;
}

/**
 * Alle bestanden onder `map`, relatief, gesorteerd. Volgt gelinkte mappen (een
 * worktree linkt soms naar de echte), slaat .DS_Store over en `overslaan` (namen
 * op het bovenste niveau). Geeft [] als de map er niet is.
 */
export function bestandenIn(map, { overslaan = [] } = {}) {
  const uit = [];
  const loop = (abs, rel, diepte) => {
    if (diepte > 32) return;
    let namen;
    try { namen = readdirSync(abs); } catch { return; }
    for (const n of namen.sort()) {
      if (ROMMEL.has(n)) continue;
      if (!rel && overslaan.includes(n)) continue;
      const a = join(abs, n), r = rel ? `${rel}/${n}` : n;
      let s;
      try { s = statSync(a); } catch { try { s = lstatSync(a); } catch { continue; } }
      if (s.isDirectory()) loop(a, r, diepte + 1);
      else if (s.isFile()) uit.push(r);
    }
  };
  loop(map, '', 0);
  return uit;
}

/** Grootte van een map (bytes, aantal bestanden). */
export function omvang(map) {
  let bytes = 0, aantal = 0;
  for (const r of bestandenIn(map)) { try { bytes += statSync(join(map, r)).size; aantal++; } catch (_) {} }
  return { bytes, aantal };
}

function openAlleenLezen(pad) {
  return new DatabaseSync(pad, { readOnly: true, timeout: 5000 });
}

/**
 * De tellingen van een library, alleen-lezen. Werkt op elke schemaversie: wat
 * er (nog) niet is, telt 0. Dit is wat MANIFEST.json en controleer.mjs vergelijken.
 */
export function telLibrary(pad) {
  const db = openAlleenLezen(pad);
  try {
    const tabellen = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const kolommen = tabellen.has('tracks') ? new Set(db.prepare('PRAGMA table_info(tracks)').all().map((r) => r.name)) : new Set();
    const tel = (sql, waarden = []) => Number(Object.values(db.prepare(sql).get(...waarden))[0]);
    const telTabel = (t) => (tabellen.has(t) ? tel(`SELECT COUNT(*) FROM ${t}`) : 0);
    const telKolom = (k, waar) => (kolommen.has(k) ? tel(`SELECT COUNT(*) FROM tracks WHERE ${waar}`) : 0);
    return {
      schema: db.prepare('PRAGMA user_version').get().user_version,
      tracks: telTabel('tracks'),
      hotcues: telTabel('hotcues'),
      racks: telTabel('racks'),
      samples: telTabel('samples'),
      gridsOpSlot: telKolom('grid_json', "json_valid(grid_json) AND json_extract(grid_json, '$.slot') = 1"),
      stems: telKolom('stems_json', 'stems_json IS NOT NULL'),
      secties: telKolom('secties_json', 'secties_json IS NOT NULL'),
      instellingen: telTabel('instellingen'),
      // De browser-sleutels van het instrument (/api/instellingen, PR #31) en de indeling (S11).
      instrument: tabellen.has('instellingen')
        ? tel(`SELECT COUNT(*) FROM instellingen WHERE sleutel IN (${INSTELLING_SLEUTELS.map(() => '?').join(', ')})`, INSTELLING_SLEUTELS) : 0,
      tags: telTabel('tags'),
      categorieen: telTabel('categorieen'),
    };
  } finally { db.close(); }
}

/** De nummers in een library: id → audiopad (relatief, "media/<id>/audio.wav"). */
export function nummersVan(pad) {
  const db = openAlleenLezen(pad);
  try {
    const heeft = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks'").get();
    return new Map(heeft ? db.prepare('SELECT id, audio FROM tracks').all().map((r) => [r.id, r.audio]) : []);
  } finally { db.close(); }
}

/** De tellingen van kaart.db (wensen, nachtruns). */
export function telKaart(pad) {
  const db = openAlleenLezen(pad);
  try {
    const tabellen = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const tel = (t) => (tabellen.has(t) ? Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n) : 0);
    return { schema: db.prepare('PRAGMA user_version').get().user_version, wensen: tel('wensen'), nachtRuns: tel('nacht_runs') };
  } finally { db.close(); }
}

/** `PRAGMA quick_check` op een bestand, alleen-lezen. 'ok' of de melding. */
export function snelleControle(pad) {
  const db = openAlleenLezen(pad);
  try { return db.prepare('PRAGMA quick_check').get()?.quick_check; } finally { db.close(); }
}

/** De commit van de checkout (alleen lezen), of null. */
export function commitVan(bron) {
  try {
    return execFileSync('git', ['-C', bron, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

const twee = (n) => String(n).padStart(2, '0');
/** 2026-10-11_14-05-33, in lokale tijd (zoals server/backup.js zijn namen geeft). */
export function stempelVoor(d) {
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}_${twee(d.getHours())}-${twee(d.getMinutes())}-${twee(d.getSeconds())}`;
}

/** 1234567 → "1,2 MB" (Nederlandse komma). */
export function maat(bytes) {
  const e = [['GB', 1e9], ['MB', 1e6], ['KB', 1e3]].find(([, f]) => bytes >= f);
  return e ? `${(bytes / e[1]).toFixed(1).replace('.', ',')} ${e[0]}` : `${bytes} B`;
}

/** "3 dagen geleden" e.d. */
export function geleden(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 2) return 'net';
  if (m < 120) return `${m} minuten geleden`;
  const u = Math.round(m / 60);
  if (u < 48) return `${u} uur geleden`;
  return `${Math.round(u / 24)} dagen geleden`;
}

/** Een JSON-bestand lezen; null als het er niet is of niet te lezen is. */
export function leesJson(pad) {
  try { return JSON.parse(readFileSync(pad, 'utf8')); } catch { return null; }
}
