// De app in een headless Chromium draaien en bekijken, zonder dependencies:
// het DevTools-protocol over een WebSocket (Node 22+ heeft die ingebouwd).
//
// VEILIG MET DE APC AANGESLOTEN: vóór de pagina laadt wordt
// navigator.requestMIDIAccess weggehaald, dus dit tabblad kan de APC niet
// eens zien (geen tweede MIDI-client, zie CLAUDE.md, "ÉÉN VARVE-tabblad").
// Het draait een EIGEN server op een eigen poort met een tijdelijke database,
// media- en opnamemap: Clay's library wordt niet aangeraakt.
//
// Gebruik:  node tools/headless/kijk.mjs [uitmap]
// Chromium: de headless shell uit de Playwright-cache (~/Library/Caches/ms-playwright),
// of zet VARVE_CHROME op een eigen pad.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8791, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9337;
const tmp = mkdtempSync(join(tmpdir(), 'varve-kijk-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
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
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

try {
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
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- zonder vlag: de app zoals hij was ----------------------------------
  console.log('zonder ?vormen');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  await wacht(2500);
  ok('de app start', await evalueer('!!window.engine && !!window.videoMixer'));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  ok('geen vormlagen: geen rij, geen actions, geen beeldlagen',
    await evalueer("!document.querySelector('.vid-vorm') && !window.vormen && window.videoMixer.beeldlagen.length === 0"));
  ok('geen mapje-vorm-regels in de mapping', await evalueer("!window.mapping.kies('note:0:65')"));
  ok('geen fouten', meldingen.length === 0, meldingen.join(' | '));
  meldingen.length = 0;

  // ---- met vlag ------------------------------------------------------------
  console.log('met ?vormen=1');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=1` });
  await wacht(2500);
  ok('de vormrij staat in het videopaneel', await evalueer("!!document.querySelector('#video-panel .vid-vorm')"));
  ok('twee lagen aan de mixer gehangen', await evalueer('window.videoMixer.beeldlagen.length === 2'));
  ok('Detail View opent het mapje vorm (fragment geladen)', await evalueer("window.mapping.kies('note:0:65')?.action === 'layer.device.detail'"));
  ok('en het fragment staat niet in je bewaarde mapping', await evalueer("window.mapping.toJSON().rules.every((r) => !r.action.startsWith('video.layer.'))"));

  // Audio aan (geen klik nodig met deze autoplay-vlag), video-paneel open.
  await evalueer('window.engine.resume()');
  await evalueer("document.getElementById('video-btn').click()");

  // Bediening zoals de APC hem stuurt: bytes -> parseMessage -> mapping.
  await evalueer(`(async () => {
    const { parseMessage } = await import('/src/control/midi.js');
    window.__apc = (...b) => window.mapping.handle(parseMessage(new Uint8Array(b)));
  })()`);
  await evalueer('__apc(0x90, 65, 127); __apc(0x80, 65, 0)');
  ok('APC Detail View: mapje vorm open', await evalueer("window.lagen.stand.device === 'vorm'"));
  await evalueer('__apc(0x90, 62, 127); __apc(0x80, 62, 0)');
  ok('APC On/Off in het mapje: laag 1 aan', await evalueer('window.vormen.lagen[0].aan === true'));
  const voor = await evalueer('window.vormen.lagen[0].leesKnop(0)');
  await evalueer('__apc(0xB0, 16, 64); __apc(0xB0, 16, 80)');
  const na = await evalueer('window.vormen.lagen[0].leesKnop(0)');
  ok('APC device knob 1 draait de vorm (endless)', na !== voor, `${voor?.toFixed(3)} -> ${na?.toFixed(3)}`);
  await evalueer('__apc(0x90, 59, 127); __apc(0x80, 59, 0)');
  ok('APC Device ▶: volgende vorm', await evalueer("window.vormen.lagen[0].sys.id !== 'lz'"), await evalueer('window.vormen.lagen[0].sys.naam'));
  await evalueer('__apc(0x90, 58, 127); __apc(0x80, 58, 0)');
  await evalueer('__apc(0x90, 61, 127); __apc(0x80, 61, 0); __apc(0x90, 62, 127); __apc(0x80, 62, 0)');
  ok('APC Bank ▶ + On/Off: laag 2 ook aan', await evalueer('window.vormen.gekozen === 1 && window.vormen.lagen[1].aan'));

  // 60 beelden laten tekenen en tellen hoeveel stappen de vormen deden.
  const t0 = await evalueer('window.engine.ctx.currentTime');
  await evalueer(`new Promise((ok) => { let n = 0; const f = () => (++n < 60 ? requestAnimationFrame(f) : ok()); requestAnimationFrame(f); })`);
  const t1 = await evalueer('window.engine.ctx.currentTime');
  ok('60 beelden getekend zonder fouten', meldingen.length === 0, meldingen.join(' | '));
  ok('de audioklok loopt, dus de vormen bewegen', t1 > t0, `${(t1 - t0).toFixed(2)} s`);
  ok('de mixer heeft de lagenstap gebouwd', await evalueer('!!window.videoMixer.gelaagd && !window.videoMixer.fout'), await evalueer('window.videoMixer.fout || ""'));
  await foto('met-vormen.png');
  await evalueer("window.vormen.lagen.forEach((l) => { l.aan = false; })");
  await wacht(300);
  await foto('lagen-uit.png');
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
