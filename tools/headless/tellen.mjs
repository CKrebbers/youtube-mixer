// Het grid uit de tellen en het controleren, headless (docs/BEATGRID.md §11).
//
// Een EIGEN server (eigen poort, tijdelijke database en media) met de
// nep-tellenzoeker (test/nep-tellen.mjs: een vast tempo van 120, de "1" om de
// vier): een eigen bestand binnenhalen, en dan in Chromium (zonder MIDI):
// laden, de gevonden tellen op het deck en in de zoom, het oordeel naast de
// bpm, op het oordeel klikken (controle: tik op de tellen), "✓ klopt" (alles
// goed = op slot), en een verschoven grid dat tijdens het spelen ⚠ geeft.
//
// Gebruik:  node tools/headless/tellen.mjs [uitmap]     (foto's: tellen-*.png)
// Poorten:  VARVE_KIJK_POORT (8843), VARVE_KIJK_DEBUG (9443).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../server/ingest.js';
import { maakNepTellen } from '../../test/nep-tellen.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8843, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9443;
const tmp = mkdtempSync(join(tmpdir(), 'varve-tellen-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: false };
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (shell) {
      const map = join(cache, shell);
      const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
      if (sub) return { pad: join(map, sub, 'chrome-headless-shell'), shell: true };
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return { pad: execFileSync('which', [naam], { encoding: 'utf8' }).trim(), shell: false }; } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
let serverUit = '';
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit', VARVE_TELLEN_CMD: maakNepTellen(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
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
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra ? ` (${extra})` : ''}`); };
/** Headless tekent Chromium pas een beeld als iemand erom vraagt: een schermafdruk dwingt er een af (de renderloop zet het oordeel). */
const beeld = () => cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } }).catch(() => null);
const tot = async (expr, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await beeld(); if (await evalueer(expr).catch(() => false)) return true; await wacht(100); } return false; };
/** Een echte muisklik (CDP) midden op het element. */
async function klik(sel) {
  const p = await evalueer(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await wacht(60);
  }
  return true;
}

try {
  // Een bestand van 40 s met een klik op 120 bpm (de nep-zoeker hoort hetzelfde).
  const wav = join(tmp, 'klik.wav');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t-0.25+10,0.5))':s=48000:d=40", '-ac', '2', '-c:a', 'pcm_s16le', wav]);

  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const pagina = doelen.find((d) => d.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // Binnenhalen: de server maakt golfvorm en grid, dan de tellen, dan het grid uit de tellen.
  const B = `http://localhost:${POORT}`;
  const buf = readFileSync(wav);
  const up = await fetch(`${B}/api/upload?naam=klik.wav&stems=0`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf })
    .then((r) => r.json());
  const id = up.sleutel;
  let grid = null;
  for (let i = 0; i < 150 && grid?.methode !== 'tellen'; i++) { await wacht(200); grid = (await fetch(`${B}/api/library/${id}/grid`).then((r) => r.json()).catch(() => null))?.grid; }
  ok('binnengehaald: het grid komt uit de tellen', grid?.methode === 'tellen' && Math.abs(grid.stukken[0].bpm - 120) < 0.01, JSON.stringify(grid) + serverUit.slice(-400));

  await cdp('Page.navigate', { url: `${B}/` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.library)').catch(() => false)) break; await wacht(200); }
  await wacht(800);
  await evalueer('window.engine.resume()');
  ok('geladen op track 1', await tot(`(async () => { const b = document.querySelector('#lib-panel button[data-deck="A"][data-id="${id}"]');
    if (b && !window.__geklikt) { window.__geklikt = true; b.click(); } return window.engine.deck('A').title !== '— leeg —' && !!window.engine.deck('A').grid; })()`, 15000));
  await evalueer("window.engine.setFocus('A')");
  ok('de gevonden tellen staan op het deck (80, de "1" om de vier)', await tot("window.engine.deck('A').tellen?.beats.length === 80 && window.engine.deck('A').tellen.downbeats.length === 20", 8000),
    await evalueer("JSON.stringify({ n: window.engine.deck('A').tellen?.beats.length })"));
  ok('gemeten: alles raak', await evalueer("window.engine.deck('A').gridMeting?.totaal.raak === 1"));
  ok('het oordeel naast de bpm: ✓ zeker', await tot("document.querySelector('#focus-deck .grid-oordeel').classList.contains('zeker') && document.querySelector('#focus-deck .grid-oordeel').textContent === '✓'", 5000),
    await evalueer("document.querySelector('#focus-deck .grid-oordeel')?.outerHTML"));
  ok('met de uitleg in de tooltip', /van de gevonden tellen valt op het grid/.test(await evalueer("document.querySelector('#focus-deck .grid-oordeel').title")));
  await evalueer("window.engine.deck('A').seek(10)");
  await wacht(300);
  await foto('tellen-zeker.png');

  // Controleren: klik op het oordeel.
  await klik('#focus-deck .grid-oordeel');
  ok('klik op het oordeel: controle aan, de tik loopt, het deck speelt', await tot("window.engine.gridControleDeck === 'A' && window.engine.gridKlik.aan && window.engine.deck('A').playing", 3000));
  ok('de controleknoppen staan er', await evalueer("!document.querySelector('#focus-deck .grid-controle').classList.contains('hidden')"));
  const tik0 = await evalueer('window.engine.gridKlik.aantal');
  ok('er worden tikken ingepland, op de audioklok', await tot(`window.engine.gridKlik.aantal >= ${tik0} + 3`, 4000),
    await evalueer("JSON.stringify({ n: window.engine.gridKlik.aantal, ctx: window.engine.ctx.state, t: window.engine.ctx.currentTime, pos: window.engine.deck('A').position, speelt: window.engine.deck('A').playing })"));
  await foto('tellen-controle.png');
  await klik('#focus-deck .grid-controle .grid-ok');
  ok('✓ klopt op het enige stuk: op slot, controle uit', await tot("window.engine.deck('A').grid.slot === true && window.engine.gridControleDeck === null", 3000));
  ok('het oordeel: 🔒', await tot("document.querySelector('#focus-deck .grid-oordeel').classList.contains('vast')", 3000));
  ok('en het slot staat op de server (de bewaarlus)', await (async () => {
    for (let i = 0; i < 40; i++) { const g = (await fetch(`${B}/api/library/${id}/grid`).then((r) => r.json())).grid; if (g?.slot) return true; await wacht(150); }
    return false;
  })());

  // Live bewaking: een grid dat 40 ms te vroeg ligt, tijdens het spelen.
  await evalueer(`(async () => { const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const d = window.engine.deck('A'); d.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0.21 }], bron: 'hand' })); d.seek(5); d.play(); })()`);
  ok('een grid 40 ms naast de tellen: ⚠ tijdens het spelen', await tot("document.querySelector('#focus-deck .grid-oordeel').classList.contains('wijkt')", 6000),
    await evalueer("document.querySelector('#focus-deck .grid-oordeel').textContent"));
  ok('… met hoeveel', /⚠ 4\d ms/.test(await evalueer("document.querySelector('#focus-deck .grid-oordeel').textContent")));
  await foto('tellen-wijkt.png');
  await evalueer("window.engine.deck('A').pause()");
  ok('geen fouten in de pagina', fouten.length === 0, fouten.join(' | '));
} catch (err) {
  ok(`zonder uitzondering (${err.message})`, false);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGTERM');
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(`\n${uitkomst.length - rood}/${uitkomst.length} ok${rood ? ` — ${rood} FAIL` : ''}  (foto's in ${UIT})`);
process.exit(rood ? 1 : 0);
