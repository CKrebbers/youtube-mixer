// media/ verhuizen naar een map buiten iCloud (VI2, 11 okt). Zie docs/LIBRARY.md
// "Waar media/ staat".
//
// Gebruik:
//   node tools/media-verhuis.mjs [--droog]            alleen kijken (standaard): het plan
//   node tools/media-verhuis.mjs --doe                verhuizen, ALLEEN als niets in de weg staat
//   opties: --bron <map>   (standaard: media/ van de hoofdmap, ook vanuit een worktree)
//           --doel <map>   (standaard: ~/Varve-media)
//           --poort <n>    welke poort "de server draait" betekent (standaard 8777; mag vaker)
//
// Regels: niets wordt gewist of gekopieerd. --doe HERNOEMT de map (rename(2), zoals `mv`
// op dezelfde schijf); een andere schijf weigert hij (dan zou mv kopiëren en daarna wissen).
// Hij weigert ook als de server draait, als het doel al bestaat, als het doel zelf in
// iCloud ligt, en als er uitgeplaatste iCloud-bestanden in media/ zitten (eerst binnenhalen).
// Daarna schrijft hij media-VERHUISD.txt waar media/ stond, en toont de regels voor
// ~/.zprofile en ~/.varve/media-pad (die leest VARVE.app).
import { lstatSync, statSync, readdirSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iCloudReden, echtPad, verhuisdTekst, VERHUISD_BESTAND } from '../server/media-plek.js';

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
export const STANDAARD_DOEL = join(homedir(), 'Varve-media');
export const STANDAARD_POORT = 8777;
export const SSD_MELDING = 'Een kopie BUITEN de laptop vraagt een externe SSD, en die is er nog niet. '
  + 'Tot dan staan de backups van library.db naast de library (<media>/backups/) en is er van de '
  + 'media zelf geen tweede kopie. Met een SSD: VARVE_BACKUPS=/Volumes/<naam>/varve-backups, en vóór '
  + 'elke reis `rsync -a <media>/ /Volumes/<naam>/Varve-media/` (docs/HANDOFF.md).';

/** media/ van de hoofdmap (ook vanuit een worktree: via git), anders die naast dit tool. */
export function standaardBron({ wortel = WORTEL } = {}) {
  try {
    const git = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: wortel, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return join(dirname(git), 'media');
  } catch (_) { return join(wortel, 'media'); }
}

/** Antwoordt er iets op 127.0.0.1:<poort>? (Een verbinding lukt = er luistert iets.) */
export function poortOpen(poort, { host = '127.0.0.1', ms = 600 } = {}) {
  return new Promise((klaar) => {
    const s = createConnection({ host, port: poort });
    const af = (ja) => { s.destroy(); klaar(ja); };
    s.setTimeout(ms, () => af(false));
    s.once('connect', () => af(true));
    s.once('error', () => af(false));
  });
}

/**
 * Alles in de map tellen, zonder iets te openen: aantal bestanden, logische grootte,
 * wat er echt op schijf staat, en wat uitgeplaatst is (iCloud-placeholders: een
 * `.naam.icloud`, of een bestand zonder blokken op schijf met een grootte > 0).
 * Koppelingen (symlinks) worden geteld maar niet gevolgd.
 */
export function telMap(map) {
  const t = { bestanden: 0, mappen: 0, koppelingen: 0, bytes: 0, opSchijf: 0, uitgeplaatst: [] };
  const stapel = [map];
  while (stapel.length) {
    const m = stapel.pop();
    let namen;
    try { namen = readdirSync(m, { withFileTypes: true }); } catch (_) { continue; }
    for (const d of namen) {
      const p = join(m, d.name);
      if (d.isDirectory()) { t.mappen++; stapel.push(p); continue; }
      let s;
      try { s = lstatSync(p); } catch (_) { continue; }
      if (s.isSymbolicLink()) { t.koppelingen++; continue; }
      t.bestanden++;
      t.bytes += s.size;
      t.opSchijf += (s.blocks || 0) * 512;
      if (/^\..+\.icloud$/.test(d.name) || (s.size > 0 && s.blocks === 0)) t.uitgeplaatst.push(relative(map, p));
    }
  }
  return t;
}

/** macOS: `find <map> -flags +dataless` (de vlag van iCloud voor een uitgeplaatst bestand). */
export function zoekDataless(map) {
  if (process.platform !== 'darwin') return [];
  try {
    const uit = execFileSync('/usr/bin/find', [map, '-flags', '+dataless'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return uit.split('\n').filter(Boolean).map((p) => relative(map, p) || '.');
  } catch (_) { return []; }
}

/** De dichtstbijzijnde map die bestaat (voor het doel, dat nog niet bestaat). */
function bestaandeOuder(p) {
  let m = resolve(p);
  while (!existsSync(m)) { const o = dirname(m); if (o === m) break; m = o; }
  return m;
}

const binnen = (a, b) => { const r = relative(b, a); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/**
 * Bewaart library.db relatieve paden? Alleen-lezen. Telt de paden die niet met
 * "media/" beginnen (audio, video, onset, peaks); null als er geen database is.
 */
export async function controleerDb(dbPad) {
  if (!existsSync(dbPad)) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPad, { readOnly: true });
    try {
      const paden = [
        ...db.prepare('SELECT id, audio AS p FROM tracks UNION ALL SELECT id, video FROM tracks UNION ALL SELECT id, onset_bestand FROM tracks').all(),
        ...db.prepare('SELECT track_id AS id, bestand AS p FROM peaks').all(),
      ].filter((r) => r.p != null && r.p !== '');
      const buiten = paden.filter((r) => !String(r.p).startsWith('media/'));
      const tracks = db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n;
      return { tracks, paden: paden.length, buiten: buiten.length, voorbeelden: buiten.slice(0, 5).map((r) => `${r.id}: ${r.p}`) };
    } finally { db.close(); }
  } catch (err) { return { fout: err.message }; }
}

/**
 * Het plan, zonder iets te veranderen.
 * @param {{ bron: string, doel?: string, poorten?: number[], isOpen?: (poort: number) => Promise<boolean>,
 *   thuis?: string, env?: Record<string, string|undefined>, dataless?: (map: string) => string[] }} o
 */
export async function maakPlan({ bron, doel = STANDAARD_DOEL, poorten = [STANDAARD_POORT], isOpen = poortOpen,
  thuis = homedir(), env = process.env, dataless = zoekDataless }) {
  bron = resolve(bron); doel = resolve(doel);
  const plan = { bron, doel, blokkades: [], waarschuwingen: [], telling: null, server: [], db: null };
  const blok = (s) => plan.blokkades.push(s);

  let st = null;
  try { st = lstatSync(bron); } catch (_) { /* hieronder */ }
  if (!st) blok(`de bron bestaat niet: ${bron}`);
  else if (st.isSymbolicLink()) blok(`de bron is een koppeling (symlink), geen map: ${bron}`);
  else if (!st.isDirectory()) blok(`de bron is geen map: ${bron}`);

  if (existsSync(doel)) blok(`het doel bestaat al: ${doel} (niets wordt overschreven of samengevoegd)`);
  if (binnen(echtPad(doel), echtPad(bron)) || binnen(echtPad(bron), echtPad(doel))) blok('bron en doel liggen in elkaar');

  // De server in die projectmap moet VI2 kennen: een oudere leest VARVE_MEDIA als "testserver"
  // (stems en tellen uit) en zoekt library.db in <projectmap>/media/ (dan een lege library).
  const projectmap = dirname(bron);
  if (existsSync(join(projectmap, 'server', 'index.js')) && !existsSync(join(projectmap, 'server', 'media-plek.js'))) {
    blok(`de server in ${projectmap} is van vóór VI2 (geen server/media-plek.js): eerst die versie binnenhalen (git pull na de merge)`);
  }

  plan.iCloudBron = iCloudReden(bron, { thuis });
  plan.iCloudDoel = iCloudReden(doel, { thuis });
  if (plan.iCloudDoel) blok(`het doel ligt zelf in iCloud (${plan.iCloudDoel})`);
  if (!plan.iCloudBron && st?.isDirectory()) plan.waarschuwingen.push('de bron ligt niet in iCloud: verhuizen is niet nodig (mag wel)');

  if (st?.isDirectory()) {
    plan.zelfdeSchijf = statSync(bron).dev === statSync(bestaandeOuder(doel)).dev;
    if (!plan.zelfdeSchijf) blok('bron en doel staan op verschillende schijven: dan zou mv kopiëren en wissen; dit tool hernoemt alleen');
    plan.telling = telMap(bron);
    const extra = dataless(bron).filter((p) => !plan.telling.uitgeplaatst.includes(p));
    plan.telling.uitgeplaatst.push(...extra);
    const n = plan.telling.uitgeplaatst.length;
    if (n) {
      blok(`${n} bestand${n === 1 ? '' : 'en'} uitgeplaatst door iCloud (bijv. ${plan.telling.uitgeplaatst.slice(0, 3).join(', ')}): `
        + 'eerst alles binnenhalen (Finder: rechtsklik op media > "Download nu", of "Houd gedownload"), dan opnieuw --droog');
    }
    plan.db = await controleerDb(join(bron, 'library.db'));
    if (plan.db?.buiten) {
      blok(`${plan.db.buiten} pad${plan.db.buiten === 1 ? '' : 'en'} in library.db begint niet met media/ (bijv. ${plan.db.voorbeelden[0]}): eerst uitzoeken`);
    }
  }

  for (const p of poorten) if (await isOpen(p)) plan.server.push(p);
  if (plan.server.length) blok(`de server draait (poort ${plan.server.join(', ')}): eerst stoppen (Ctrl+C in zijn terminal)`);

  plan.backups = env.VARVE_BACKUPS
    ? { pad: env.VARVE_BACKUPS, melding: `VARVE_BACKUPS staat op ${env.VARVE_BACKUPS}` }
    : { pad: join(doel, 'backups'), melding: SSD_MELDING };
  if (env.VARVE_MEDIA && resolve(env.VARVE_MEDIA) !== doel) {
    plan.waarschuwingen.push(`VARVE_MEDIA staat nu al op ${env.VARVE_MEDIA}: pas die regel aan na de verhuizing`);
  }
  plan.kan = plan.blokkades.length === 0;
  return plan;
}

/** De regels die Clay daarna zet (de server leest media-VERHUISD.txt ook zelf, als vangnet). */
export function envRegels(doel) {
  const d = doel.startsWith(homedir() + sep) ? `$HOME/${relative(homedir(), doel)}` : doel;
  return [
    `echo 'export VARVE_MEDIA="${d}"' >> ~/.zprofile`,
    `mkdir -p ~/.varve && echo "${doel}" > ~/.varve/media-pad`,
  ];
}

/**
 * Verhuizen. Alleen met een plan zonder blokkades; kijkt vlak ervoor nog één keer
 * of de server draait. Hernoemt (geen kopie), schrijft daarna media-VERHUISD.txt.
 */
export async function voerUit(plan, { rename = renameSync, schrijf = writeFileSync, isOpen = poortOpen,
  poorten = [STANDAARD_POORT], nu = new Date() } = {}) {
  if (!plan.kan) throw new Error(`niet verhuisd: ${plan.blokkades.join('; ')}`);
  for (const p of poorten) if (await isOpen(p)) throw new Error(`niet verhuisd: de server draait intussen (poort ${p})`);
  mkdirSync(dirname(plan.doel), { recursive: true });
  try { rename(plan.bron, plan.doel); } catch (err) {
    if (err.code === 'EXDEV') throw new Error('niet verhuisd: andere schijf (rename kan niet; er is niets gekopieerd of gewist)');
    throw new Error(`niet verhuisd: ${err.message} (er is niets gewist)`);
  }
  const briefje = join(dirname(plan.bron), VERHUISD_BESTAND);
  schrijf(briefje, verhuisdTekst({ bron: plan.bron, doel: plan.doel, wanneer: nu }));
  return { briefje };
}

const gb = (b) => `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;

/** Het plan als tekst. */
export function planTekst(plan, { doe = false } = {}) {
  const r = [];
  r.push(`media verhuizen (${doe ? '--doe' : 'droogloop, er verandert niets'})`);
  r.push(`  bron:   ${plan.bron}${plan.iCloudBron ? `  [in iCloud: ${plan.iCloudBron}]` : ''}`);
  r.push(`  doel:   ${plan.doel}${plan.zelfdeSchijf === false ? '  [andere schijf]' : plan.zelfdeSchijf ? '  (zelfde schijf: hernoemen, geen kopie)' : ''}`);
  if (plan.telling) {
    const t = plan.telling;
    r.push(`  inhoud: ${t.bestanden} bestanden in ${t.mappen} mappen, ${gb(t.bytes)} (op deze Mac: ${gb(t.opSchijf)})`
      + (t.koppelingen ? `, ${t.koppelingen} koppelingen` : ''));
    r.push(`  iCloud: ${t.uitgeplaatst.length ? `${t.uitgeplaatst.length} uitgeplaatst` : 'niets uitgeplaatst'}`);
  }
  if (plan.db) {
    r.push(plan.db.fout ? `  library.db: niet te lezen (${plan.db.fout})`
      : `  library.db: ${plan.db.tracks} nummers, ${plan.db.paden} paden, ${plan.db.buiten ? `${plan.db.buiten} NIET relatief` : 'alle relatief (media/…): verhuizen breekt niets'}`);
  } else if (plan.telling) r.push('  library.db: niet in de bron');
  r.push(`  server: ${plan.server.length ? `draait (poort ${plan.server.join(', ')})` : 'draait niet'}`);
  r.push(`  backups: ${plan.backups.pad}`);
  r.push(`    ${plan.backups.melding}`);
  for (const w of plan.waarschuwingen) r.push(`  let op: ${w}`);
  if (plan.blokkades.length) {
    r.push('', `${doe ? 'NIET verhuisd' : 'Kan nu niet'}:`);
    for (const b of plan.blokkades) r.push(`  - ${b}`);
  } else {
    r.push('', doe ? 'Verhuisd.' : 'Kan: niets staat in de weg. Verhuizen met --doe (server uit laten).');
    r.push('', 'Daarna (één keer):');
    for (const regel of envRegels(plan.doel)) r.push(`  ${regel}`);
    r.push('  VARVE.app leest ~/.zprofile (login-shell) en ~/.varve/media-pad; de server leest ook');
    r.push(`  ${VERHUISD_BESTAND} waar media/ stond. Bij het starten logt hij "[media] <map> (…)".`);
    r.push('', 'Let op: iCloud haalt media/ daarna ook uit de cloud (hij staat niet meer in de Bureaublad-map).');
    r.push('De enige kopie staat dan op deze Mac; zie de regel over backups hierboven.');
  }
  return r.join('\n');
}

// ---- opdrachtregel -------------------------------------------------------------
async function hoofd(argv) {
  const o = { doe: false, bron: null, doel: STANDAARD_DOEL, poorten: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const waarde = () => { if (i + 1 >= argv.length) throw new Error(`${a} vraagt een waarde`); return argv[++i]; };
    if (a === '--droog') o.doe = false;
    else if (a === '--doe') o.doe = true;
    else if (a === '--bron') o.bron = waarde();
    else if (a === '--doel') o.doel = waarde();
    else if (a === '--poort') o.poorten.push(Number(waarde()));
    else if (a === '-h' || a === '--help') { console.log(hulp()); return 0; }
    else throw new Error(`onbekende optie ${a}`);
  }
  if (!o.poorten.length) o.poorten = [STANDAARD_POORT];
  const plan = await maakPlan({ bron: o.bron ?? standaardBron(), doel: o.doel, poorten: o.poorten });
  if (!o.doe || !plan.kan) {
    console.log(planTekst(plan, { doe: o.doe }));
    return o.doe ? 1 : 0;
  }
  const { briefje } = await voerUit(plan, { poorten: o.poorten });
  console.log(planTekst(plan, { doe: true }));
  console.log(`\n${VERHUISD_BESTAND} geschreven: ${briefje}`);
  return 0;
}

function hulp() {
  return [
    'node tools/media-verhuis.mjs [--droog | --doe] [--bron <map>] [--doel <map>] [--poort <n>]',
    '  --droog  (standaard) alleen het plan: bron, doel, grootte, iCloud, server, library.db',
    '  --doe    verhuizen (hernoemen) als niets in de weg staat; daarna media-VERHUISD.txt',
    `  --doel   standaard ${STANDAARD_DOEL}`,
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  hoofd(process.argv.slice(2)).then((c) => process.exit(c), (err) => { console.error(err.message); process.exit(1); });
}
