// De secties in de mixer, headless (docs/SECTIES.md): binnenhalen, laden, de
// kaart van de server op het deck, de strook boven het overzicht, de
// grid-modus SECTIES op het scherm-als-APC, en een sprong op de maat.
//
// Zelfde opzet als stems.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database en mediamap, de nep-yt-dlp (test/nep-ytdlp.mjs) met een
// synthetisch nummer met een bekend antwoord (test/synth-nummer.mjs: intro,
// couplet, opbouw, drop, break, drop, outro op 124 bpm), en de nep-splitter.
// Geen netwerk, geen Python. Chromium zonder navigator.requestMIDIAccess.
//
// Gebruik:  node tools/headless/secties.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8794) en VARVE_KIJK_DEBUG (9340). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { maakNepStems } from '../../test/nep-stems.mjs';
import { synthNummer } from '../../test/synth-nummer.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8794, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9340;
const tmp = mkdtempSync(join(tmpdir(), 'varve-secties-'));
mkdirSync(UIT, { recursive: true });

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Het synthetische nummer als stereo WAV op 48 kHz: dat wordt de "download".
const s = synthNummer({ sr: 48000 });
{
  const n = s.mix.length, y = new Int16Array(n * 2);
  let piek = 1e-9;
  for (const x of s.mix) piek = Math.max(piek, Math.abs(x));
  for (let i = 0; i < n; i++) y[2 * i] = y[2 * i + 1] = Math.round(32767 * 0.8 * s.mix[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22);
  kop.writeUInt32LE(48000, 24); kop.writeUInt32LE(48000 * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  writeFileSync(join(tmp, 'bron.wav'), Buffer.concat([kop, Buffer.from(y.buffer)]));
}
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'),
    NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080',
  '--autoplay-policy=no-user-gesture-required', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
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
async function maat(b, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: b, height: h, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
}
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(150); }
  return false;
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
const druk = (id) => act(`(a.invoke(${JSON.stringify(id)}, true), a.invoke(${JSON.stringify(id)}, false))`);
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;

async function doorloop() {
  console.log('binnenhalen en laden');
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=sectieA';
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok('het nummer staat in de lijst', await totdat(rij('sectieA'), 90000));
  await evalueer(`${rij('sectieA')}.querySelector('button[data-deck="A"]').click()`);
  ok('op track 1', await totdat("window.engine.deck('A').duration > 150", 30000));
  ok('de secties komen van de server (?maak=1) op het deck', await totdat("window.engine.deck('A').sectieKaart?.aantal >= 4", 60000));
  const k = await evalueer("window.engine.deck('A').sectieKaart.stukken.map((x) => ({ van: +x.van.toFixed(2), label: x.label, groep: x.groep }))");
  console.log('      ' + k.map((x) => `${x.van}s ${x.label} ${x.groep}`).join(' · '));
  console.log('      verwacht: ' + s.grenzen.map((g, i) => `${g.toFixed(2)}s ${s.plan[i][0]} ${s.plan[i][1]}`).join(' · '));
  const naast = s.grenzen.map((g) => Math.min(...k.map((x) => Math.abs(x.van - g))));
  ok(`elke grens van het plan is gevonden, binnen een halve maat (${naast.map((x) => x.toFixed(2)).join(' ')})`, naast.every((x) => x < 1));
  ok('de server logt het', /\[secties\] .*sectieA.*secties:/i.test(serverLog) || /\[secties\]/.test(serverLog), serverLog.match(/\[secties\][^\n]*/)?.[0] ?? '');
  ok('de snapshot draagt de stukken', await evalueer("window.engine.snapshot().decks.A.secties?.length === window.engine.deck('A').sectieKaart.aantal"));

  console.log('\nde strook boven het overzicht');
  await evalueer("document.getElementById('lib-btn').click()");
  await wacht(800);
  const strook = await evalueer(`(() => { const c = document.querySelector('.kol[data-deck="A"] .wave-overview') || document.querySelector('.wave-overview');
    if (!c) return null; const g = c.getContext('2d'); const w = c.width; const d = g.getImageData(0, 2, w, 1).data;
    const kleuren = new Set(); for (let x = 0; x < w; x += 4) kleuren.add(d[x * 4] + ',' + d[x * 4 + 1] + ',' + d[x * 4 + 2]);
    return { w, kleuren: kleuren.size }; })()`);
  ok(`de bovenste rij pixels van het overzicht heeft meerdere kleuren (${JSON.stringify(strook)})`, strook && strook.kleuren >= 3);

  console.log('\nde grid-modus SECTIES');
  await evalueer("window.engine.setFocus('A')");
  await druk('layer.grid.secties');
  await wacht(500);
  const pads = await evalueer(`[...document.querySelectorAll('.spg[data-modus="secties"]')].length`);
  ok(`het scherm-als-APC toont de modus secties (${pads} knoppen hemelsblauw)`, pads >= 40);
  await totdat(`document.querySelector('.spg[data-action="track.1.section.2"] .spg-t')?.textContent !== 'sectie 2'`, 5000);
  const padTekst = await evalueer(`[1, 2, 4, 8].map((n) => { const e = document.querySelector('.spg[data-action="track.1.section.' + n + '"]');
    return e ? [e.querySelector('.spg-t').textContent, e.classList.contains('leeg')] : null; })`);
  const namen = await evalueer("[0, 1, 3].map((i) => window.engine.deck('A').sectieKaart.naam(i))");
  ok(`op de pads de namen van de secties (${padTekst.map((p) => p && p[0]).join(' · ')}), pad 8 leeg en gedimd`,
    padTekst[0][0] === namen[0] && padTekst[1][0] === namen[1] && padTekst[2][0] === namen[2] && padTekst[3][0] === '' && padTekst[3][1] && !padTekst[0][1]);
  ok('pad 1 leest 1 (die hoor je), pad 2 0,5, pad 40 null',
    (await act("[a.read('track.1.section.1'), a.read('track.1.section.2'), a.read('track.1.section.40')]")).join() === '1,0.5,');
  await maat(1440, 790);
  await foto('secties-1440.png');

  console.log('\nspelen en springen');
  await druk('track.1.play');
  ok('speelt', await totdat("window.engine.deck('A').playing && window.engine.deck('A').position > 0.5", 15000));
  await druk('track.1.section.4');
  ok('pad 4: op de volgende maat is hij in sectie 4', await totdat("window.engine.deck('A').sectieOpDeMaat === 3", 5000));
  ok('… en een paar seconden later hoor je hem', await totdat("window.engine.deck('A').sectieHier === 3", 8000));
  await act("(a.invoke('track.1.section.5.loop', true), a.invoke('track.1.section.5.loop', false))");
  ok('shift + pad 5: de loop is sectie 5', await act("a.read('track.1.section.5.loop')") === 1);
  await wacht(1500);
  await foto('secties-spelend-1440.png');
  await maat(1920, 1080);
  await foto('secties-1920.png');
  await druk('track.1.play');
}

try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
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
  await maat(1440, 790);
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer', 20000));
  await doorloop();
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
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
