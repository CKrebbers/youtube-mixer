// Controlekamer × secties, headless in echte Chrome (TASKS-SECTIES "Verweven",
// punt 10): de regel in de tegel Server met hoeveel nummers (nog) geen actuele
// secties hebben (GET /api/secties, src/controle/server-tegel.js).
//
// Opzet: een EIGEN server op een eigen poort met een tijdelijke database,
// mediamap, plannen-, patronen- en proefmap (nooit de echte op 8777). De
// library staat er vóór het starten al in: zeven nummers met, zonder en met
// een verouderde kaart, waarvan één met echte audio (het synthetische nummer
// van test/synth-nummer.mjs, zeven secties op 124 bpm). Dat nummer krijgt een
// kaart zoals bij het laden (GET …/secties?maak=1, de worker met ffmpeg), en
// dan moet de regel meetellen. Daarna: een ander grid, nummers weg, en met de
// Fetch-laag van Chrome nagebootst: een trage server (geen stapel open
// verzoeken), een fout (500) en een oudere server (404), die de pagina dan
// hooguit eens per minuut opnieuw vraagt (duurt daarom ~2,5 minuut). Dan een
// smal scherm en een server die weg is. Fouten in de console: Runtime én Log
// (netwerkfouten). Geen MIDI (Chromium zonder requestMIDIAccess).
//
// Gebruik:  node tools/headless/sec-controle.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8913) en VARVE_KIJK_DEBUG (9513). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthNummer } from '../../test/synth-nummer.mjs';
import { Library } from '../../server/library.js';
import { SECTIE_VERSIE, gridSleutel } from '../../server/secties.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8913, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9513;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-controle-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- de library, vóór de server start -------------------------------------------------
const s = synthNummer({ sr: 22050 });
{
  const n = s.mix.length, y = new Int16Array(n);
  let piek = 1e-9;
  for (const x of s.mix) piek = Math.max(piek, Math.abs(x));
  for (let i = 0; i < n; i++) y[i] = Math.round(32767 * 0.8 * s.mix[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(1, 22);
  kop.writeUInt32LE(22050, 24); kop.writeUInt32LE(22050 * 2, 28); kop.writeUInt16LE(2, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  mkdirSync(join(tmp, 'media', 'echt'), { recursive: true });
  writeFileSync(join(tmp, 'media', 'echt', 'audio.wav'), Buffer.concat([kop, Buffer.from(y.buffer)]));
}
const GRID = { stukken: [{ van: 0, bpm: 124, anker: 0.25 }], beatsPerBar: 4 };
const ANDER_GRID = { stukken: [{ van: 0, bpm: 126, anker: 0.1 }], beatsPerBar: 4 };
{
  const lib = new Library(join(tmp, 'lib.db'));
  const STUKKEN = [{ van: 0, label: 'intro', groep: 'A', energie: 0.2 }, { van: 30.97, label: 'drop', groep: 'B', energie: 1 }];
  for (const id of ['geen1', 'geen2', 'actueel', 'oud', 'anders', 'hand', 'echt']) {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: id === 'echt' ? s.duur : 200,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, id === 'echt' ? { ...s.grid, slot: true } : GRID);
  }
  const kaart = (id, extra = {}) => lib.bewaarSecties(id, { versie: SECTIE_VERSIE, opGrid: true,
    grid: gridSleutel(lib.track(id).grid), stukken: STUKKEN, bron: 'auto', ...extra });
  kaart('actueel');
  kaart('oud', { versie: null });                                   // van vóór SECTIE_VERSIE
  kaart('anders', { grid: gridSleutel(ANDER_GRID) });               // op een ander grid gerekend
  kaart('hand', { versie: null, grid: gridSleutel(ANDER_GRID), bron: 'hand' });   // met de hand: nooit opnieuw
  lib.sluit();
}

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PATRONEN: join(tmp, 'patronen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

/** Een tabblad via het DevTools-protocol: cdp(), ev(), op(gebeurtenis), en de fouten in de console. */
async function verbind(doel) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [], logFouten = [], luisteraars = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    // Wat Chrome zelf in de console zet: netwerkfouten (404, 500, afgebroken), ook bij een fetch die de pagina netjes afvangt.
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logFouten.push({ tekst: m.params.entry.text, url: m.params.entry.url ?? '' });
    if (m.method && luisteraars.has(m.method)) luisteraars.get(m.method)(m.params);
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const op = (methode, fn) => luisteraars.set(methode, fn);
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  return { ws, cdp, ev, op, fouten, logFouten };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(200); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

let ctl;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ctl = await verbind(doelen.find((d) => d.type === 'page'));
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/api/opnames`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // De tegel Server: { licht, waarde, sub, regel } (regel = null als hij er niet staat).
  const tegel = () => ctl.ev(`(() => { const t = [...document.querySelectorAll('.tegel')].find((x) => x.querySelector('.tegel-naam').textContent.trim() === 'Server');
    return t ? { licht: t.dataset.licht, waarde: t.querySelector('.tegel-waarde').textContent, sub: t.querySelector('.tegel-sub').textContent,
      regel: t.querySelector('.tegel-regel')?.textContent.replace(/\u00a0/g, ' ') ?? null } : null; })()`);
  const regel = async () => (await tegel())?.regel;
  const wordt = (tekst, maxMs = 8000) => tot(async () => (await regel()) === tekst, maxMs);
  const api = (pad, opties = {}) => ctl.ev(`fetch(${JSON.stringify(pad)}, ${JSON.stringify(opties)}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))`);

  console.log('de library bij het opstarten: 7 nummers');
  await ctl.cdp('Page.navigate', { url: `http://localhost:${POORT}/controle` });
  ok('de Controlekamer start', await tot(() => ctl.ev('!!window.controle && document.querySelectorAll(".tegel").length >= 4')));
  ok('server: draait, library: 7 nummers (zoals eerst)', await tot(async () => { const t = await tegel(); return t?.licht === 'ok' && t.sub === 'library: 7 nummers'; }));
  const a = await api('/api/secties');
  ok(`GET /api/secties: ${JSON.stringify(a.data)}`, a.status === 200 && a.data.totaal === 7 && a.data.zonder === 3 && a.data.verouderd === 2);
  ok('de regel: 3 nog zonder (geen1, geen2, echt), 2 verouderd (oud, anders); actueel en hand tellen niet',
    await wordt('secties: 3 nog zonder · 2 verouderd'), await regel());

  console.log('\neen nummer krijgt een kaart (zoals bij het laden: ?maak=1)');
  const t0 = Date.now();
  const m = await api('/api/library/echt/secties?maak=1');
  const n = m.data?.secties?.stukken?.length;
  ok(`echt: berekend in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${n} secties`, m.status === 200 && n >= 1, m.data?.fout);
  ok('de regel telt mee: 2 nog zonder', await wordt('secties: 2 nog zonder · 2 verouderd'), await regel());

  console.log('\neen ander grid, en nummers weg');
  const g = await api('/api/library/actueel/grid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grid: ANDER_GRID }) });
  ok('actueel krijgt een ander grid: 3 verouderd', g.status === 200 && await wordt('secties: 2 nog zonder · 3 verouderd'), await regel());
  for (const id of ['geen1', 'geen2']) await api(`/api/library/${id}`, { method: 'DELETE' });
  ok('geen1 en geen2 weg: alleen nog verouderd', await wordt('secties: 3 verouderd'), await regel());
  for (const id of ['oud', 'anders', 'actueel']) await api(`/api/library/${id}`, { method: 'DELETE' });
  ok('over: echt (net berekend) en hand (met de hand): alles actueel', await wordt('secties: alles actueel'), await regel());
  ok('... en de sub telt mee: library: 2 nummers', (await tegel())?.sub === 'library: 2 nummers');

  ok(`tot hier geen fouten in de console, ook geen netwerkfouten (${ctl.fouten.length} + ${ctl.logFouten.length})`,
    !ctl.fouten.length && !ctl.logFouten.length, [...ctl.fouten, ...ctl.logFouten.map((f) => f.tekst)].join(' | '));

  // Elke vraag naar /api/secties gaat vanaf hier langs de Fetch-laag: `antwoord` beslist wat hij krijgt.
  const vragen = [];
  let antwoord = 'door';
  const geef = (p, code, tekst) => ctl.cdp('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: code,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(tekst).toString('base64') }).catch(() => {});
  ctl.op('Fetch.requestPaused', (p) => {
    vragen.push(Date.now());
    if (antwoord === 'hangt') return;                                   // nooit antwoorden: een trage of hangende server
    if (antwoord === '500') return geef(p, 500, '{"fout":"no such column: secties_json"}');
    if (antwoord === '404') return geef(p, 404, '{"fout":"onbekend eindpunt"}');
    if (antwoord === 'nep') return geef(p, 200, JSON.stringify({ totaal: 214, zonder: 12, verouderd: 3, versie: SECTIE_VERSIE }));
    return ctl.cdp('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
  });
  await ctl.cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/secties*', requestStage: 'Request' }] });
  const vanaf = (t) => vragen.filter((x) => x >= t).length;

  console.log('\neen trage server (antwoordt niet op /api/secties)');
  antwoord = 'hangt';
  const tHangt = Date.now();
  await tot(async () => vanaf(tHangt) > 0, 4000);
  await wacht(9000);
  const nHangt = vanaf(tHangt);
  ok(`geen stapel open verzoeken: ${nHangt} in ~10 s (één tegelijk, na de time-out de volgende)`, nHangt >= 1 && nHangt <= 2);
  antwoord = 'door';
  ok('server weer vlot: alles actueel', await wordt('secties: alles actueel', 12000), await regel());

  console.log('\neen fout van de server (500, bv. een library.db met de v9 van een andere tak)');
  const log500 = ctl.logFouten.length;
  antwoord = '500';
  const t500 = Date.now();
  ok('"secties: onbekend (fout)", en de server draait gewoon', await wordt('secties: onbekend (fout)')
    && (await tegel())?.licht === 'ok' && (await tegel())?.waarde === 'draait', await regel());
  await wacht(8000);
  const n500 = vanaf(t500), l500 = ctl.logFouten.length - log500;
  ok(`daarna niet elke 2 s opnieuw: ${n500} vraag en ${l500} netwerkfout in ~10 s`, n500 === 1 && l500 <= 1,
    ctl.logFouten.slice(log500).map((f) => f.tekst).join(' | '));

  console.log('\neen oudere server zonder /api/secties (404), na een minuut opnieuw gevraagd');
  antwoord = '404';
  ok('"onbekend (oudere server)", en de server draait gewoon', await wordt('secties: onbekend (oudere server)', 70000)
    && (await tegel())?.licht === 'ok' && (await tegel())?.waarde === 'draait', await regel());
  const t404 = vragen.at(-1);
  ok(`de 500 en de 404 lagen ~een minuut uit elkaar (${((t404 - t500) / 1000).toFixed(0)} s), ertussen niets gevraagd`,
    t404 - t500 >= 55000 && vanaf(t500) === 2);
  antwoord = 'door';
  ok('route terug (na weer een minuut): alles actueel', await wordt('secties: alles actueel', 70000), await regel());
  ok(`netwerkfouten alleen van de nagebootste storingen, één per vraag (${ctl.logFouten.length - log500})`,
    ctl.logFouten.slice(log500).every((f) => /api\/secties/.test(f.url) || /api\/secties/.test(f.tekst)) && ctl.logFouten.length - log500 <= 2,
    ctl.logFouten.slice(log500).map((f) => `${f.tekst} ${f.url}`).join(' | '));

  console.log('\nop een smal scherm');
  await ctl.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wacht(500);
  ok('390 px: geen zijwaarts scrollen', await ctl.ev('document.documentElement.scrollWidth <= innerWidth'));
  ok('390 px: de regel staat er helemaal (niet afgekapt)', await ctl.ev(`(() => { const r = document.querySelector('.tegel-regel');
    return !!r && r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().width > 0; })()`));
  await ctl.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  await wacht(300);
  // Voor de schermafdruk: een stand met allebei (zoals op een echte avond), via de Fetch-laag.
  antwoord = 'nep';
  await wordt('secties: 12 nog zonder · 3 verouderd');
  const foto = await ctl.cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 330, scale: 1 } });
  writeFileSync(join(UIT, 'sec-controle.png'), Buffer.from(foto.data, 'base64'));
  await ctl.cdp('Fetch.disable');

  console.log('\nde server weg');
  server.kill();
  ok('server: niet bereikbaar, en geen regel over secties', await tot(async () => { const t = await tegel(); return t?.licht === 'fout' && t.regel === null; }));
  ok('geen fouten van de pagina zelf in de console (Runtime: uitzonderingen en console.error)', ctl.fouten.length === 0, ctl.fouten.join(' | '));
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  try { ctl?.ws.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
if (rood) console.log(`\nserverlog (laatste regels):\n${serverLog.split('\n').slice(-12).join('\n')}`);
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen (${uitkomst.length} ok). Schermafdruk in ${UIT}/sec-controle.png`);
process.exit(rood ? 1 : 0);
