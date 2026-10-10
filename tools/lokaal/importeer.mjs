// Clay's lokale muziek in de Varve-library zetten via de BESTAANDE upload-route
// (POST /api/upload: id = lokaal-<12 hex SHA-256>, dezelfde pijplijn als een link),
// met een droogloop die alleen leest. Zie tools/lokaal/LEESMIJ.md.
//
// Gebruik:
//   node tools/lokaal/importeer.mjs --map <dir> [--map <dir>…] [--server http://localhost:8777]
//                                   [--droog] [--video] [--library <pad naar library.db>]
//
// --droog     alleen een tabel: bestand, MB, duur, id, stand (nieuw / al binnen / overslaan + reden).
// --video     ook het beeld van een mp4 meenemen (standaard video: false, zoals de kaart).
// --library   geen server maar de database ALLEEN-LEZEN openen om te zien wat al binnen is
//             (de droogloop zonder draaiende server). Nooit samen met uploaden.
//
// Regels: nooit verwijderen of verplaatsen; één bestand tegelijk en wachten op de
// wachtrij (GET /api/ingest) voordat het volgende gaat; stems uit (?stems=0).
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { request } from 'node:http';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verzamel, kiesBestanden, hashBestand, titelArtiest, beoordeel, idsUitPaginas, mb, duurTekst, VIDEO_EXT } from './kies.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const { onderzoek } = await import(join(WORTEL, 'server/ingest.js'));

// ---- argumenten --------------------------------------------------------------
const argv = process.argv.slice(2);
const opties = { mappen: [], server: 'http://localhost:8777', droog: false, video: false, library: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], v = () => { if (i + 1 >= argv.length) stop(`${a} vraagt een waarde`); return argv[++i]; };
  if (a === '--map') opties.mappen.push(v());
  else if (a === '--server') opties.server = v().replace(/\/$/, '');
  else if (a === '--droog') opties.droog = true;
  else if (a === '--video') opties.video = true;
  else if (a === '--library') opties.library = v();
  else if (a === '-h' || a === '--help') { console.log(hulp()); process.exit(0); }
  else stop(`onbekende optie ${a}`);
}
if (!opties.mappen.length) stop('geef minstens één --map <dir>');
if (opties.library && !opties.droog) stop('--library is alleen voor de droogloop (alleen lezen); uploaden gaat via --server');

function hulp() {
  return 'node tools/lokaal/importeer.mjs --map <dir> [--map <dir>…] [--server http://localhost:8777] [--droog] [--video] [--library <library.db>]';
}
function stop(tekst) { console.error(`fout: ${tekst}\n${hulp()}`); process.exit(2); }

// ---- wat is al binnen? -------------------------------------------------------
/** Alle id's uit de library via de server, in pagina's van 500 (GET-verzoeken, niets anders). */
async function idsVanServer(server) {
  const paginas = [];
  for (let van = 0; ;) {
    const r = await fetch(`${server}/api/library?aantal=500&van=${van}`);
    if (!r.ok) throw new Error(`GET /api/library gaf ${r.status}`);
    const j = await r.json();
    paginas.push(j);
    van += j.tracks.length;
    if (!j.tracks.length || van >= j.totaal) break;
  }
  return idsUitPaginas(paginas);
}

/** Dezelfde id's uit library.db, ALLEEN-LEZEN geopend. */
async function idsVanDb(pad) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(pad, { readOnly: true });
  try {
    return new Set(db.prepare('SELECT id FROM tracks').all().map((r) => r.id));
  } finally { db.close(); }
}

let binnen;
let bron;
if (opties.library) {
  binnen = await idsVanDb(opties.library);
  bron = `library.db (alleen lezen): ${opties.library}`;
} else {
  try {
    binnen = await idsVanServer(opties.server);
    bron = `server ${opties.server}`;
  } catch (e) {
    stop(`de server op ${opties.server} antwoordt niet (${e.message}). Droogloop zonder server: --droog --library <pad naar media/library.db>`);
  }
}

// ---- bestanden verzamelen en beoordelen ----------------------------------------
const rijen = [];
for (const map of opties.mappen) {
  const kort = basename(map.replace(/\/$/, ''));
  const paden = await verzamel(map);
  for (const keuze of kiesBestanden(paden)) {
    const vol = join(map, keuze.pad);
    const rij = { map, kort, pad: keuze.pad, vol, naam: basename(keuze.pad), bytes: 0, duur: null, id: '', titel: '', artiest: '', video: false };
    try { rij.bytes = (await stat(vol)).size; } catch {}
    let info = null, zusId = null;
    if (!keuze.overslaan) {
      rij.id = await hashBestand(vol);
      info = await onderzoek(vol);
      if (info.ok) {
        rij.duur = info.duur;
        rij.video = !!info.video;
        Object.assign(rij, titelArtiest(rij.naam, info.tags));
      }
      // De mp4 naast deze wav: zit die al in de library, dan is dit geluid al binnen.
      if (keuze.zus) zusId = await hashBestand(join(map, keuze.zus)).catch(() => null);
    }
    Object.assign(rij, beoordeel({ overslaan: keuze.overslaan, id: rij.id, zusId, onderzoek: info, binnen }));
    rijen.push(rij);
  }
}

// ---- de tabel -----------------------------------------------------------------
const kol = (s, n, rechts = false) => { s = String(s ?? ''); if (s.length > n) s = s.slice(0, n - 1) + '…'; return rechts ? s.padStart(n) : s.padEnd(n); };
const breed = Math.min(64, Math.max(20, ...rijen.map((r) => `${r.kort}/${r.pad}`.length)));
console.log(`bron voor "al binnen": ${bron} (${binnen.size} nummers in de library)\n`);
console.log(`${kol('bestand', breed)}  ${kol('MB', 7, true)}  ${kol('duur', 8, true)}  ${kol('id', 19)}  stand`);
console.log('-'.repeat(breed + 2 + 7 + 2 + 8 + 2 + 19 + 2 + 40));
for (const r of rijen) {
  const stand = r.reden ? `${r.stand} — ${r.reden}` : r.stand;
  const naamInfo = r.stand === 'nieuw' ? `  →  ${r.artiest ? `${r.artiest} – ` : ''}${r.titel}${r.video ? (opties.video ? ' [met video]' : ' [video uit]') : ''}` : '';
  console.log(`${kol(`${r.kort}/${r.pad}`, breed)}  ${kol(mb(r.bytes), 7, true)}  ${kol(duurTekst(r.duur), 8, true)}  ${kol(r.id, 19)}  ${stand}${naamInfo}`);
}
const nieuw = rijen.filter((r) => r.stand === 'nieuw');
const al = rijen.filter((r) => r.stand === 'al binnen');
const over = rijen.filter((r) => r.stand === 'overslaan');
const som = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
console.log(`\ntotaal: ${rijen.length} bestanden — ${nieuw.length} nieuw (${mb(som(nieuw, (r) => r.bytes))} MB, ${duurTekst(som(nieuw, (r) => r.duur))}), ${al.length} al binnen, ${over.length} overslaan`);
if (over.length) {
  const redenen = new Map();
  for (const r of over) { const k = r.reden.split(':')[0]; redenen.set(k, (redenen.get(k) || 0) + 1); }
  console.log(`  overslaan: ${[...redenen].map(([k, n]) => `${n}× ${k}`).join(', ')}`);
}
if (opties.droog) { console.log('\ndroogloop: er is niets geüpload en niets veranderd.'); process.exit(0); }

// ---- uploaden, één voor één ---------------------------------------------------
const TYPE = { mp3: 'audio/mpeg', wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus', mp4: 'video/mp4' };
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST /api/upload met het bestand als stroom. Geeft { status, j }. */
function upload(rij) {
  const u = new URL(`${opties.server}/api/upload`);
  u.searchParams.set('naam', rij.naam);
  u.searchParams.set('stems', '0');
  u.searchParams.set('video', opties.video ? '1' : '0');
  if (rij.titel) u.searchParams.set('titel', rij.titel);
  if (rij.artiest) u.searchParams.set('artiest', rij.artiest);
  const e = rij.naam.split('.').pop().toLowerCase();
  return new Promise((klaar) => {
    const rq = request(u, { method: 'POST', headers: { 'Content-Type': TYPE[e] || 'application/octet-stream', 'Content-Length': rij.bytes } }, (res) => {
      const delen = [];
      res.on('data', (d) => delen.push(d));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(delen)); } catch {} klaar({ status: res.statusCode, j }); });
    });
    rq.on('error', (err) => klaar({ status: 0, j: { fout: String(err.message || err) } }));
    createReadStream(rij.vol).on('error', (err) => { rq.destroy(err); }).pipe(rq);
  });
}

/** Wacht tot de opdracht niet meer wacht of bezig is; toont de voortgang op één regel. */
async function wachtOp(opdrachtId, label) {
  let laatste = '';
  for (;;) {
    let j = null;
    try { j = await (await fetch(`${opties.server}/api/ingest`)).json(); } catch {}
    const o = j?.opdrachten?.find((x) => x.id === opdrachtId);
    if (!o) return { status: 'verdwenen' };
    const regel = `   ${o.status} · ${o.stap ?? ''}${o.pct != null ? ` ${Math.round(o.pct)}%` : ''} ${o.tekst ?? ''}`.trimEnd();
    if (regel !== laatste && process.stdout.isTTY) { process.stdout.write(`\r${label}${kol(regel, 70)}`); laatste = regel; }
    if (o.status !== 'bezig' && o.status !== 'wacht') { if (process.stdout.isTTY) process.stdout.write('\n'); return o; }
    await slaap(500);
  }
}

console.log(`\nuploaden naar ${opties.server}: ${nieuw.length} bestanden, één voor één, video ${opties.video ? 'aan' : 'uit'}, stems uit\n`);
let gelukt = 0, mislukt = 0;
for (let i = 0; i < nieuw.length; i++) {
  const r = nieuw[i];
  const label = `[${i + 1}/${nieuw.length}] ${kol(r.naam, 48)}`;
  process.stdout.write(`${label} ${mb(r.bytes)} MB …\n`);
  const a = await upload(r);
  if (a.status === 200 && a.j?.bestond) { console.log(`   al in de library (${a.j.track?.id})`); gelukt++; continue; }
  if (a.status !== 202 || !a.j?.id) { console.log(`   MISLUKT: ${a.status} ${a.j?.fout || ''}`); mislukt++; continue; }
  const o = await wachtOp(a.j.id, label);
  if (o.status === 'klaar') { console.log(`   klaar: ${o.track?.id ?? r.id} — ${o.track?.uploader ? `${o.track.uploader} – ` : ''}${o.track?.titel ?? r.titel}`); gelukt++; }
  else { console.log(`   ${o.status}${o.fout ? `: ${o.fout}` : ''}`); mislukt++; }
}
console.log(`\nklaar: ${gelukt} gelukt, ${mislukt} mislukt, ${al.length} waren al binnen, ${over.length} overgeslagen.`);
process.exit(mislukt ? 1 : 0);
