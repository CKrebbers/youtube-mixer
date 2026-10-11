// Het avondpakket vanaf de opdrachtregel (docs/AVONDPAKKET.md): kan ik met deze
// tas vertrekken, kan ik hier beginnen. Alleen lezen; repareert niets.
//
// Draait de server (standaard op 8777), dan leest dit GET /api/avondpakket: CLI
// en tegel zeggen dan hetzelfde (en speelt er een deck, dan krijg je de
// bevroren stand). Geen server: dan meet het zelf (server/avondpakket-meet.js),
// zonder backupstand van de server, achtergrond en library compleet (grijs).
// library.db wordt nooit geopend.
//
// Gebruik:  node tools/avondpakket.mjs [--profiel <naam>] [--vertrek|--aankomst] [--streng] [--json] [--poort 8777]
// Exit:     0 = geen rood · 1 = oranje, alleen met --streng · 2 = rood · 3 = fout in de aanroep
//           (onbekend profiel, ongeldige vlag, server noch mediamap bereikbaar).
// Tests:    VARVE_AVONDPAKKET_NEP=<map> leest fixtures (<map>/nep.json) in plaats van
//           commando's, en vraagt dan GEEN server tenzij --poort gegeven is.
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leesProfielen, beoordeel } from '../server/avondpakket.js';
import { meet, maakNep, backupUitNamen, extraPaden, voerUit, poortOpen } from '../server/avondpakket-meet.js';
import { kiesMedia } from '../server/media-plek.js';
import { wanneer } from '../src/controle/backup-tegel.js';

const HULP = `node tools/avondpakket.mjs [--profiel <naam>] [--vertrek|--aankomst] [--streng] [--json] [--poort <n>]
  --profiel   laptop | apc | maschine | alles | beeld (avondpakket/profielen.json); standaard uit de data
  --vertrek / --aankomst   de fase; zonder: auto (niets van het profiel aangesloten = vertrek)
  --streng    exit 1 bij oranje
  --json      het rapport als JSON (zoals GET /api/avondpakket)
  --poort     de poort van de server (standaard 8777)
exit: 0 geen rood · 1 oranje (--streng) · 2 rood · 3 fout in de aanroep`;

export function leesArgs(argv) {
  const a = { profiel: null, fase: null, streng: false, json: false, poort: 8777, poortGegeven: false, hulp: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--profiel') { a.profiel = argv[++i]; if (!a.profiel || a.profiel.startsWith('--')) return { fout: '--profiel zonder naam' }; }
    else if (x.startsWith('--profiel=')) a.profiel = x.slice(10);
    else if (x === '--vertrek' || x === '--aankomst') {
      const f = x.slice(2);
      if (a.fase && a.fase !== f) return { fout: '--vertrek en --aankomst samen' };
      a.fase = f;
    } else if (x === '--streng') a.streng = true;
    else if (x === '--json') a.json = true;
    else if (x === '--poort' || x.startsWith('--poort=')) {
      const v = x === '--poort' ? argv[++i] : x.slice(8);
      if (!/^\d{1,5}$/.test(v || '') || +v < 1 || +v > 65535) return { fout: `ongeldige poort: ${v ?? ''}` };
      a.poort = +v; a.poortGegeven = true;
    } else if (x === '--help' || x === '-h') a.hulp = true;
    else return { fout: `onbekende vlag: ${x}` };
  }
  return a;
}

const TEKEN = { ok: '●', half: '◐', fout: '✕', uit: '○' };
/** De tijd zoals de tegels (review 2 fix 15, F14): "18:30", "gisteren 18:30", "8 okt 18:30". */
const tijd = (ms, nu = new Date()) => (Number.isFinite(ms) ? wanneer(ms, nu) : '?');
const BRON = { gekozen: 'gekozen', data: 'uit profielen.json', auto: 'auto' };

/** Het rapport als tekst voor de terminal. */
export function alsTekst(r, { bron = '', nu = new Date() } = {}) {
  const kop = [`Avondpakket · ${r.titel} (${r.profiel})`, `${r.fase} (${BRON[r.faseBron] || (r.faseGekozen ? 'gekozen' : 'auto')})`, tijd(r.t, nu),
    Number.isFinite(r.duurMs) ? `${(r.duurMs / 1000).toFixed(1).replace('.', ',')} s` : '', r.bevroren ? `bevroren: ${r.bevroren}` : ''].filter(Boolean).join(' · ');
  const t = r.telling || {};
  const oordeel = r.oordeel === 'klaar' ? (t.half ? `KLAAR · let op ${t.half}` : 'KLAAR') : `${String(r.oordeel).toUpperCase()} · ${t.fout} rood`;
  const breed = Math.max(...r.punten.map((p) => p.naam.length), 8);
  const wbreed = Math.min(28, Math.max(...r.punten.map((p) => String(p.waarde).length), 4));
  const uit = [kop, oordeel, ''];
  for (const p of r.punten) uit.push(`  ${TEKEN[p.licht] ?? '○'} ${p.naam.padEnd(breed)}  ${String(p.waarde).padEnd(wbreed)}  ${p.sub || ''}`.trimEnd());
  if (r.paklijst?.length) uit.push('', `Paklijst (${r.profiel}):`, ...r.paklijst.map((x) => `  ${x.startsWith('☐') ? x : `☐ ${x}`}`));
  if (r.kan?.length) uit.push('', 'Kan:', ...r.kan.map((x) => `  ${x}`));
  if (r.kanNiet?.length) uit.push('Kan niet:', ...r.kanNiet.map((x) => `  ${x}`));
  if (r.let?.length) uit.push('Let op:', ...r.let.map((x) => `  ${x}`));
  const sl = r.info?.speellijst;
  if (Number.isFinite(sl?.totaal)) uit.push('', `Speellijst: ${sl.gedaan} van ${sl.totaal} punten gedaan${sl.fout ? `, ${sl.fout} fout` : ''} (telt niet mee)`);
  if (bron) uit.push('', bron);
  return uit.join('\n');
}

/** De route van een draaiende server, of waarom niet: { rapport } | { bereikbaar, nummers?, status? }. */
async function vraagServer(poort, a) {
  const q = new URLSearchParams({ vers: '1' });
  if (a.profiel) q.set('profiel', a.profiel);
  if (a.fase) q.set('fase', a.fase);
  const B = `http://127.0.0.1:${poort}`;
  let r;
  try { r = await fetch(`${B}/api/avondpakket?${q}`, { signal: AbortSignal.timeout(8000) }); } catch { return { bereikbaar: false }; }
  if (r.ok) return { rapport: await r.json() };
  // Een oudere server zonder de route: hij draait wel.
  const lib = await fetch(`${B}/api/library?aantal=1`, { signal: AbortSignal.timeout(3000) }).then((x) => (x.ok ? x.json() : null), () => null);
  return { bereikbaar: true, status: r.status, nummers: Number.isFinite(lib?.totaal) ? lib.totaal : undefined };
}

async function main() {
  const a = leesArgs(process.argv.slice(2));
  if (a.fout) { console.error(`avondpakket: ${a.fout}\n\n${HULP}`); return 3; }
  if (a.hulp) { console.log(HULP); return 0; }
  const nep = process.env.VARVE_AVONDPAKKET_NEP || null;
  const WORTEL = fileURLToPath(new URL('..', import.meta.url));

  let rapport = null, bron = '', server = null;
  if (!nep || a.poortGegeven) {
    const s = await vraagServer(a.poort, a);
    if (s.rapport) { rapport = s.rapport; bron = `bron: de server op ${a.poort} (zoals de tegel)`; }
    else server = { bereikbaar: s.bereikbaar, ...(s.nummers !== undefined ? { nummers: s.nummers } : {}) };
  }
  if (!rapport) {
    const env = process.env;
    // Zoals server/index.js (VI2): VARVE_MEDIA, anders media/, anders media-VERHUISD.txt;
    // de library staat standaard in de mediamap.
    const MEDIA = kiesMedia({ env, wortel: WORTEL }).map;
    const DB = env.VARVE_DB || join(MEDIA, 'library.db');
    const BACKUPS = env.VARVE_BACKUPS || join(dirname(DB), 'backups');
    const n = nep ? maakNep(nep) : null;
    const paden = { media: MEDIA, wortel: WORTEL, db: DB, extra: extraPaden({ wortel: WORTEL, env }), ...(n?.paden || {}) };
    const t0 = Date.now();
    const metingen = await meet({ exec: n ? n.exec : voerUit, verbind: n ? n.verbind : poortOpen, paden });
    metingen.backup = n ? (n.backups ? backupUitNamen(n.backups) : { onbekend: 'geen fixture (backups)' })
      : await readdir(BACKUPS).then(backupUitNamen, (err) => (err.code === 'ENOENT' ? backupUitNamen([]) : { onbekend: 'backupmap niet leesbaar' }));
    metingen.achtergrond = { onbekend: 'alleen via de server' };
    metingen.compleet = { onbekend: 'alleen via de server' };
    metingen.server = server ?? n?.server ?? { bereikbaar: false };
    const tekst = await readFile(join(WORTEL, 'avondpakket', 'profielen.json'), 'utf8').catch(() => null);
    const data = tekst === null ? { ...leesProfielen(''), fout: 'niet gevonden' } : leesProfielen(tekst);
    rapport = beoordeel(metingen, { profiel: a.profiel, fase: a.fase, data, nu: new Date() });
    rapport.duurMs = Date.now() - t0;
    bron = nep ? 'bron: fixtures (VARVE_AVONDPAKKET_NEP)' : `bron: zelf gemeten (${metingen.server.bereikbaar ? `oudere server op ${a.poort} zonder de route` : `geen server op ${a.poort}`})`;
    if (!metingen.server.bereikbaar && rapport.punten.find((p) => p.id === 'media')?.waarde === 'geen map') {
      console.error(`avondpakket: geen server op ${a.poort} en geen mediamap: niets te controleren (VARVE_MEDIA?)`);
      return 3;
    }
  }
  if (a.json) console.log(JSON.stringify({ ...rapport, bron }, null, 1));
  else console.log(alsTekst(rapport, { bron }));
  if (rapport.profielOnbekend) { console.error(`avondpakket: profiel ${rapport.profielOnbekend} bestaat niet (keuze: ${rapport.profielen.map((p) => p.id).join(', ')})`); return 3; }
  if (rapport.telling?.fout) return 2;
  if (a.streng && rapport.telling?.half) return 1;
  return 0;
}

// Alleen als script (de test importeert leesArgs/alsTekst niet; hij draait het script).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (err) => { console.error(`avondpakket: ${err?.message || err}`); process.exit(3); });
}
