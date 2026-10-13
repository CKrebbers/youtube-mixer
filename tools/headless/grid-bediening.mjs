// Het grid gelijkzetten in de echte app, headless (docs/BEATGRID.md §12, 14 okt).
// Wat test/grid-bediening.test.mjs niet kan: de echte server, de echte
// bewaarlus van de app, de library-rij, en de renderloop van Chrome.
//
//  1. bewaren: van de druk (een gridbewerking over de bus, zoals de APC) tot de
//     POST naar de server vertrekt, en tot de server hem heeft (GET terug).
//  2. opnieuw laden: hetzelfde nummer daarna op track 2. Krijgt die het
//     BEWERKTE grid, of dat van vóór de bewerking (een oude library-rij)?
//  3. wat één encodertik aan de bpm kost op de hoofdthread, op een deck met de
//     tellen van een uur muziek (meetGrid rekent dan ~7.400 tellen per versie).
//     Beeldduren meten we hier niet: in een container met software-rendering
//     duurt elk beeld al 300 ms, ook in rust.
//
// Een EIGEN server op een eigen poort met een tijdelijke database en mediamap,
// de nep-yt-dlp met een synthetisch nummer (6 min klikspoor, 124,317 bpm). Geen
// netwerk, geen MIDI (dit tabblad vraagt geen requestMIDIAccess).
//
// Gebruik:  node tools/headless/grid-bediening.mjs [uit.json]
//           VARVE_WORTEL=<checkout>  = server en app uit een andere boom (de nulmeting)
// Poorten:  VARVE_KIJK_POORT (8871) en VARVE_KIJK_DEBUG (8872). Chrome: VARVE_CHROME.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';

const EIGEN = fileURLToPath(new URL('../..', import.meta.url));
const WORTEL = process.env.VARVE_WORTEL || EIGEN;
const UIT = process.argv[2] || null;
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8871, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 8872;
const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-grid-bediening-'));
const BPM = 124.317, T0 = 0.35, DUUR = 360;

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    const map = join(cache, shell);
    const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
    return join(map, sub, 'chrome-headless-shell');
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return execFileSync('which', [naam], { encoding: 'utf8' }).trim(); } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Een klikspoor: een kick (60 Hz, 80 ms) op elke tel, harder op de "1". 48 kHz stereo 16-bit.
{
  const sr = 48000, n = sr * DUUR, y = new Int16Array(n * 2), L = 60 / BPM;
  for (let k = 0; ; k++) {
    const t = T0 + k * L;
    if (t > DUUR - 0.2) break;
    const i0 = Math.round(t * sr), a = k % 4 === 0 ? 0.9 : 0.6;
    for (let i = 0; i < 0.08 * sr; i++) {
      const s = a * Math.sin(2 * Math.PI * (60 + 140 * Math.exp(-i / 400)) * i / sr) * Math.exp(-i / (0.025 * sr));
      const v = Math.round(32767 * s);
      y[2 * (i0 + i)] = v; y[2 * (i0 + i) + 1] = v;
    }
  }
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22);
  kop.writeUInt32LE(sr, 24); kop.writeUInt32LE(sr * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  writeFileSync(join(tmp, 'bron.wav'), Buffer.concat([kop, Buffer.from(y.buffer)]));
}
const env = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
  VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_STANDEN: join(tmp, 'standen'),
  VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'), NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS: 'uit' };
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const fouten = [];
function cdp(method, params = {}) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
}
async function evalueer(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(100); }
  return false;
}
const uitkomst = {};
const checks = [];
const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const basis = `http://127.0.0.1:${POORT}`;

async function hoofd() {
  // Het nummer binnenhalen (de nep-yt-dlp levert het klikspoor).
  let t = Date.now();
  while (Date.now() - t < 20000 && !(await fetch(`${basis}/api/library`).then((r) => r.ok).catch(() => false))) await wacht(200);
  await fetch(`${basis}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=gridBedien' }) });
  let track = null;
  t = Date.now();
  while (Date.now() - t < 180000 && !track) {
    const lijst = await fetch(`${basis}/api/library`).then((r) => r.json()).catch(() => null);
    track = (lijst?.tracks ?? lijst ?? []).find?.((x) => x.id?.includes('gridBedien') && x.audio) ?? null;
    if (!track) await wacht(500);
  }
  if (!track) throw new Error('het nummer kwam niet binnen');
  console.log(`binnen: ${track.id} (${Math.round(track.duur)} s), grid ${track.grid ? JSON.stringify(track.grid).slice(0, 80) : 'geen'}`);

  const doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json());
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: `${basis}/` });
  ok('de app staat', await totdat('window.engine && window.library', 30000));
  // Elke POST naar /grid met zijn moment (performance.now) en wanneer het antwoord er was.
  await evalueer(`(() => { window.__posts = []; const f = window.fetch.bind(window);
    window.fetch = async (url, init) => { const p = String(url).endsWith('/grid') && init?.method === 'POST' ? { t: performance.now(), body: init.body } : null;
      const r = await f(url, init); if (p) { p.klaar = performance.now(); window.__posts.push(p); } return r; }; })()`);
  await evalueer(`window.library.laadTrack(${JSON.stringify(track)}, 'A')`);
  ok('op track 1', await totdat("window.engine.deck('A').duration > 300 && window.engine.deck('A').grid", 30000));
  await evalueer("window.engine.resume?.()");
  await evalueer("window.engine.deck('A').seek(60); window.engine.deck('A').play()");
  await wacht(1500);

  // ---- 1. bewaren ----------------------------------------------------------
  console.log('\n1. van de druk tot de server');
  const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
  const metingen = [];
  for (let i = 0; i < 6; i++) {
    const id = i % 2 ? 'track.1.grid.halve' : 'track.1.grid.double';
    const voor = await evalueer('window.__posts.length');
    const t0 = await act(`(() => { const t = performance.now(); a.invoke(${JSON.stringify(id)}, true); a.invoke(${JSON.stringify(id)}, false); return t; })()`);
    const json = await evalueer("JSON.stringify(window.engine.deck('A').grid.toJSON())");
    await totdat(`window.__posts.length > ${voor}`, 4000);
    const p = await evalueer(`window.__posts[${voor}] ?? null`);
    // En de server heeft hem echt: GET geeft hetzelfde terug.
    const terug = await fetch(`${basis}/api/library/${track.id}/grid`).then((r) => r.json());
    metingen.push({ naarPost: p ? Math.round(p.t - t0) : null, totBewaard: p ? Math.round(p.klaar - t0) : null, opServer: JSON.stringify(terug.grid) === json });
    await wacht(700 + 333 * i);   // verspreid over de 1,5 s van een timer
  }
  const tot = metingen.map((m) => m.totBewaard).filter((x) => x !== null);
  uitkomst.bewaren = { metingen, gemiddeld: Math.round(tot.reduce((a, b) => a + b, 0) / tot.length), max: Math.max(...tot) };
  console.log('   ' + metingen.map((m) => `${m.totBewaard} ms${m.opServer ? '' : ' (niet op de server!)'}`).join(' · ') + ` → gemiddeld ${uitkomst.bewaren.gemiddeld}, max ${uitkomst.bewaren.max}`);
  ok('elke bewerking staat op de server', metingen.every((m) => m.opServer));

  // ---- 2. hetzelfde nummer opnieuw laden ------------------------------------
  console.log('\n2. hetzelfde nummer op track 2, na een bewerking op track 1');
  await act("(a.invoke('track.1.grid.double', true), a.invoke('track.1.grid.double', false))");
  await wacht(2000);
  const gridA = await evalueer("JSON.stringify(window.engine.deck('A').grid.toJSON())");
  await evalueer(`window.library.laadTrack(${JSON.stringify(track)}, 'B')`);
  await totdat("window.engine.deck('B').duration > 300", 30000);
  await wacht(300);
  const gridB = await evalueer("JSON.stringify(window.engine.deck('B').grid?.toJSON() ?? null)");
  uitkomst.opnieuwLaden = { zelfde: gridA === gridB, bpmA: JSON.parse(gridA).stukken[0].bpm, bpmB: JSON.parse(gridB)?.stukken[0].bpm };
  console.log(`   track 1 ${uitkomst.opnieuwLaden.bpmA} bpm, track 2 kreeg ${uitkomst.opnieuwLaden.bpmB} bpm`);
  // En een bewerking op track 1 komt ook op track 2 (hetzelfde nummer, track 2 bewerkte zelf niets).
  await act("(a.invoke('track.1.grid.halve', true), a.invoke('track.1.grid.halve', false))");
  await wacht(1800);
  const gridA2 = await evalueer("JSON.stringify(window.engine.deck('A').grid.toJSON())");
  const gridB2 = await evalueer("JSON.stringify(window.engine.deck('B').grid?.toJSON() ?? null)");
  uitkomst.opnieuwLaden.volgtDaarna = gridA2 === gridB2;
  console.log(`   daarna ½ op track 1: track 2 ${uitkomst.opnieuwLaden.volgtDaarna ? 'volgt' : 'volgt NIET'}`);
  await evalueer("window.engine.deck('B').stop?.()");

  // ---- 3. draaien aan de bpm met de tellen van een uur ------------------------
  console.log('\n3. wat één bpm-tik kost op de hoofdthread, met de tellen van een uur (meetGrid per gridversie)');
  await evalueer(`(() => { const d = window.engine.deck('A'); const L = 60 / ${BPM}, n = Math.floor(3600 / L);
    const beats = new Float64Array(n), down = [];
    for (let i = 0; i < n; i++) { beats[i] = ${T0} + i * L + (((i * 7919) % 13) - 6) * 0.0005; if (i % 4 === 0) down.push(beats[i]); }
    d.tellen = { beats, downbeats: Float64Array.from(down) }; })()`);
  await act("(a.invoke('layer.edit.toggle', true), a.invoke('layer.edit.toggle', false))");
  // De kosten van één gridversie in de renderloop: wat meetGrid/oordeel per bewerking vraagt.
  const perVersie = await evalueer(`(() => { const d = window.engine.deck('A'); const uit = [];
    for (let i = 0; i < 30; i++) { const t = performance.now(); d.grid.setBpm(d.grid.bpmAt(d.position) + (i % 2 ? -0.01 : 0.01), { bij: d.position }); d.gridGewijzigd(); d.gridMeting; uit.push(performance.now() - t); }
    uit.sort((a, b) => a - b); return { mediaan: +uit[15].toFixed(2), max: +uit[29].toFixed(2) }; })()`);
  uitkomst.perVersie = perVersie;
  console.log(`   één gridversie (bewerken + meetGrid op 7.400 tellen): ${JSON.stringify(perVersie)} ms`);
  ok('geen uitzonderingen in de pagina', fouten.length === 0, fouten.slice(0, 2).join(' | '));
}

try {
  for (let i = 0; i < 50; i++) { await wacht(200); if (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.ok).catch(() => false)) break; }
  await hoofd();
} catch (err) {
  console.error('FOUT:', err.message);
  checks.push(['loopt door', false]);
  if (serverLog) console.error(serverLog.slice(-2000));
} finally {
  if (UIT) writeFileSync(UIT, JSON.stringify({ wortel: WORTEL, ...uitkomst }, null, 1));
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL'); server.kill('SIGINT');
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
}
const fout = checks.filter(([, g]) => !g).length;
console.log(fout ? `\n${fout} FOUT` : '\nalles goed');
process.exit(fout ? 1 : 0);
