// Kan code die niet lokaal staat (iCloud) de decks stilleggen? (docs/WINST.md punt 4)
//
// De server leest statische bestanden én de Range-verzoeken van de decks via
// dezelfde libuv-draadpool (standaard 4 draden). Een bestand dat macOS uit
// iCloud moet halen terwijl er geen netwerk is, laat open() hangen en houdt
// een draad vast. Hier nagebootst met FIFO's zonder schrijver (open() hangt
// net zo). Per stand: drie "pagina's" van een deck (1,4 s stereo, 268 kB)
// vóór en na N hangende modules; 'HANGT' = niet binnen 3 s.
//
// Draait een server uit een KOPIE van server/ en src/ in een tijdelijke map
// (daar komen de FIFO's), met VARVE_TESTSERVER=1 en een eigen media-map: de
// checkout en je library worden niet aangeraakt.
//
// Gebruik:  node tools/bench/draadpool.mjs [--poort 8884] [--hangend 4]
//   Meet de standaardpool (4) en UV_THREADPOOL_SIZE=16, en drukt een tabel af.
//   Exit 1 als de pagina's met 16 draden toch hangen.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const arg = (naam, std) => { const i = process.argv.indexOf(naam); return i > 0 ? Number(process.argv[i + 1]) : std; };
const POORT = arg('--poort', 8884), HANG = arg('--hangend', 4);
const PAGINA = 268800;
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

async function meet(pool) {
  const tmp = mkdtempSync(join(tmpdir(), 'varve-draadpool-'));
  const kopie = join(tmp, 'code');
  for (const d of ['server', 'src']) cpSync(join(WORTEL, d), join(kopie, d), { recursive: true });
  for (const f of ['index.html', 'styles.css']) cpSync(join(WORTEL, f), join(kopie, f));
  const media = join(tmp, 'media');
  mkdirSync(join(media, 'proefnr'), { recursive: true });
  writeFileSync(join(media, 'proefnr', 'audio.wav'), Buffer.alloc(8 * PAGINA, 1));
  const fifos = join(kopie, 'src', 'icloud-proef');
  mkdirSync(fifos, { recursive: true });
  for (let i = 0; i < HANG; i++) execFileSync('mkfifo', [join(fifos, `m${i}.js`)]);
  const env = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_DB: join(media, 'library.db'),
    VARVE_HERANALYSE: 'uit', VARVE_OPNAMES: join(tmp, 'opn'), VARVE_PLANNEN: join(tmp, 'pl'), VARVE_PATRONEN: join(tmp, 'pat'),
    VARVE_PROEF: join(tmp, 'pr'), VARVE_STANDEN: join(tmp, 'st'), VARVE_BACKUPS: join(tmp, 'bk') };
  if (pool) env.UV_THREADPOOL_SIZE = String(pool); else delete env.UV_THREADPOOL_SIZE;
  const srv = spawn(process.execPath, ['server/index.js'], { cwd: kopie, env, stdio: 'ignore' });
  const basis = `http://127.0.0.1:${POORT}`;
  for (let i = 0; i < 100; i++) { try { await fetch(basis + '/api/proef'); break; } catch { await wacht(100); } }
  const pagina = async (n) => {
    const t0 = performance.now();
    try {
      const r = await fetch(basis + '/media/proefnr/audio.wav', { headers: { range: `bytes=${n * PAGINA}-${(n + 1) * PAGINA - 1}` }, signal: AbortSignal.timeout(3000) });
      await r.arrayBuffer();
      return Math.round(performance.now() - t0);
    } catch { return 'HANGT'; }
  };
  const voor = []; for (let i = 0; i < 3; i++) voor.push(await pagina(i));
  for (let i = 0; i < HANG; i++) fetch(basis + `/src/icloud-proef/m${i}.js`).catch(() => {});
  await wacht(300);
  const na = []; for (let i = 3; i < 6; i++) na.push(await pagina(i));
  // Opruimen: de FIFO's openen voor schrijven, dan komt de hangende open() terug.
  for (let i = 0; i < HANG; i++) spawn('sh', ['-c', `exec 3>"${join(fifos, `m${i}.js`)}"; sleep 0.2`], { stdio: 'ignore' });
  await wacht(500);
  srv.kill('SIGINT'); await wacht(500); srv.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
  return { pool: pool || 'standaard (4)', voor, na };
}

console.log(`draadpool: ${HANG} hangende modules (FIFO's), pagina's van ${PAGINA} bytes, ms (HANGT = niet binnen 3 s)`);
console.log('| draadpool | pagina vóór | pagina na |');
console.log('|---|---|---|');
const uit = [];
for (const pool of [0, 16]) {
  const r = await meet(pool);
  uit.push(r);
  console.log(`| ${r.pool} | ${r.voor.join(' / ')} | ${r.na.join(' / ')} |`);
}
process.exit(uit[1].na.some((x) => x === 'HANGT') ? 1 : 0);
