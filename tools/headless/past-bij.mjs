// "Past bij" in de library headless (src/ui/past-bij.js, docs/LIBRARY.md "Past bij"): een kleine
// library met grids en toonsoorten, een nummer op de focus-track, de knop aan, en kijken wat de lijst
// zegt; dan de focus naar een andere track en zien dat hij opnieuw rekent; laden vanuit de lijst.
//
// Zoals library.mjs: MIDI eruit vóór de pagina laadt (geen tweede MIDI-client naast Clay's tabblad),
// een EIGEN server op een eigen poort met een tijdelijke database en mediamap.
//
// Gebruik:  node tools/headless/past-bij.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8815) en VARVE_KIJK_DEBUG (standaard 9415).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8815, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9415;
const tmp = mkdtempSync(join(tmpdir(), 'varve-pastbij-'));
mkdirSync(UIT, { recursive: true });

const { Library } = await import(join(WORTEL, 'server/library.js'));
const { maakWav } = await import(join(WORTEL, 'src/engine/stream-kern.js'));

// [id, bpm, toonsoort, gridzekerheid, toonzekerheid]
const NUMMERS = [
  ['a-nu', 128, 'Am', 0.9, 0.9], ['b-gelijk', 128, 'Am', 0.9, 0.9], ['c-buur', 126, 'C', 0.9, 0.9],
  ['d-gok', 129, 'Em', 0.9, 0.2], ['e-ver', 118, 'Am', 0.9, 0.9], ['f-half', 64, 'Am', 0.9, 0.9],
  ['g-botst', 128, 'D#m', 0.9, 0.9], ['h-onzeker', 128, 'Am', 0.3, 0.9], ['i-traag', 90, 'F', 0.9, 0.9],
  ['j-traagbuur', 91, 'Dm', 0.9, 0.9],
];
const media = join(tmp, 'media');
{
  const lib = new Library(join(tmp, 'lib.db'));
  for (const [id, bpm, toon, gz, tz] of NUMMERS) {
    const n = 48000 * 4;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 48000);
    mkdirSync(join(media, id), { recursive: true });
    writeFileSync(join(media, id, 'audio.wav'), Buffer.from(maakWav([L, L], 48000)));
    lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `nummer ${id}`, uploader: 'test', duur: 240,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: '', loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, { stukken: [{ van: 0, bpm, anker: 0, zekerheid: gz }], bron: 'auto' });
    lib.bewaarToon(id, { stukken: [{ van: 0, toonsoort: toon, stemming: 0, zekerheid: tz }], bron: 'auto', versie: 99 });
  }
  lib.sluit();
}

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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media,
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
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
async function tot(expr, maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(50); }
  return false;
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const RIJEN = "[...document.querySelectorAll('#lib-panel .lib-pastbij-lijst .pb-rij:not(.pb-kop)')].map((r) => r.querySelector('.pb-soort').textContent + ' ' + r.querySelector('.pb-titel').textContent.replace('nummer ', ''))";
const STATUS = "document.querySelector('#lib-panel .lib-status').textContent";

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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await tot('window.engine && window.library && window.library.cache.totaal > 0'));

  await evalueer("document.querySelector('#lib-panel').classList.remove('hidden')");
  // Zonder nummer op de focus-track: dat zegt de kop.
  await evalueer("document.querySelector('#lib-panel .lib-pastbij').click()");
  ok('knop aan: de gewone lijst weg, de past-bij-lijst zichtbaar',
    await tot("document.querySelector('#lib-panel').classList.contains('pastbij-aan') && !document.querySelector('.lib-pastbij-lijst').classList.contains('hidden') && getComputedStyle(document.querySelector('#lib-panel .lib-rijen')).display === 'none'"));
  ok('lege focus-track: "laad er eerst een"', await tot(`/laad er eerst een/.test(${STATUS})`), await evalueer(STATUS));

  // a-nu op de focus-track (A): de lijst rekent vanzelf (hij kijkt elke seconde naar de focus).
  await evalueer("engine.setFocus('A'); window.library.laad('a-nu', 'A')");
  ok('nummer op de focus-track: de lijst verschijnt', await tot(`${RIJEN}.length > 0`));
  const rijen = await evalueer(RIJEN);
  console.log('     ', rijen.join(' | '));
  ok('goed: gelijk, buur, gok; bijna: half (0%), ver (7,8%)', rijen.join() === 'goed b-gelijk,goed c-buur,goed d-gok,bijna f-half,bijna e-ver');
  ok('botsende toon, onzeker grid en het nummer zelf staan er niet in', !rijen.some((r) => /g-botst|h-onzeker|a-nu|i-traag/.test(r)));
  ok('de kop: titel, track, tempo, toon, telling', /past bij "nummer a-nu" \(track 1\), 128\.0 bpm · Am 8A: 3 goed, 2 bijna/.test(await evalueer(STATUS)), await evalueer(STATUS));
  await foto('past-bij-1.png');

  // Focus naar B met een ander nummer: opnieuw rekenen.
  await evalueer("window.library.laad('i-traag', 'B'); engine.setFocus('B')");
  ok('focus naar track 2 (90 bpm, F): de lijst rekent opnieuw', await tot(`${RIJEN}.join().includes('j-traagbuur')`), (await evalueer(RIJEN)).join(' | '));
  ok('... en de kop zegt track 2', /track 2/.test(await evalueer(STATUS)));

  // Laden vanuit de lijst: j-traagbuur op track 3 (C).
  await evalueer("document.querySelector('.lib-pastbij-lijst button[data-pb-deck=\"C\"][data-id=\"j-traagbuur\"]').click()");
  ok('laden vanuit de lijst zet het nummer op die track', await tot("/j-traagbuur staat op track 3/.test(window.library.melding?.tekst ?? '')"), await evalueer("window.library.melding?.tekst ?? ''"));
  await foto('past-bij-2.png');

  // Uit: de gewone lijst terug.
  await evalueer("document.querySelector('#lib-panel .lib-pastbij').click()");
  ok('knop uit: de gewone lijst terug, de kop weer "nummers in de library"',
    await tot(`getComputedStyle(document.querySelector('#lib-panel .lib-rijen')).display !== 'none' && /in de library/.test(${STATUS})`));
  ok('geen uitzonderingen of console-fouten', meldingen.length === 0, meldingen.join(' / '));
} catch (err) {
  ok(`proef liep vast: ${err.message}`, false);
} finally {
  ws?.close();
  chrome.kill();
  server.kill();
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
}
const fout = uitkomst.filter(([, g]) => !g).length;
console.log(fout ? `\n${fout} FOUT(EN)` : '\nAlles groen.');
process.exit(fout ? 1 : 0);
