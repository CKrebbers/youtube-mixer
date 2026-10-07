// De toonsoort op het scherm bekijken, headless (TOONSOORT.md §5, ROADMAP 14b):
// kolomkop, focus, het correctiemenu, de library-kolom en de kiezer.
//
// Zelfde opzet als kijk.mjs: MIDI eruit vóór de pagina laadt (dit tabblad kan
// de APC niet zien), een EIGEN server op een eigen poort met een tijdelijke
// database, media- en opnamemap. Clay's library wordt niet aangeraakt.
//
// De library komt uit een NEP-lijst: GET /api/library wordt in de browser
// onderschept (DevTools Fetch-domein) en krijgt vijf nummers met een `toon`
// in het formaat van §3. Zo werkt dit ook zolang de serverkant (schema v6)
// er nog niet is. POST /api/library/<id>/toon wordt ook onderschept en
// opgeschreven: zo is te zien wat de app zou bewaren. Het geluid is echt: één
// WAV in de tijdelijke mediamap, via de gewone server gestreamd.
//
// Gebruik:  node tools/headless/toon.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (server) en VARVE_KIJK_DEBUG (DevTools), zoals kijk.mjs.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakWav } from '../../src/engine/stream-kern.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8791, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9337;
const tmp = mkdtempSync(join(tmpdir(), 'varve-toon-'));
mkdirSync(UIT, { recursive: true });

// ---- geluid: 120 s zachte toon, 16-bit stereo 48 kHz (het formaat van de ingest) ----
const DUUR = 120, SR = 48000;
{
  const n = DUUR * SR, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2 * Math.sin((2 * Math.PI * 110 * i) / SR);
  mkdirSync(join(tmp, 'media', 'toon-proef'), { recursive: true });
  writeFileSync(join(tmp, 'media', 'toon-proef', 'audio.wav'), Buffer.from(maakWav([L, L], SR)));
}

// ---- de nep-library: vijf nummers, elk een ander geval uit §5 -----------------------
const track = (id, titel, toon, extra = {}) => ({
  id, titel, uploader: 'toonproef', duur: DUUR, bron: 'bestand', url: `bestand:${id}`,
  audio: 'media/toon-proef/audio.wav', grid: { stukken: [{ van: 0, bpm: 124, anker: 0 }], slot: true }, toon, ...extra,
});
const TRACKS = [
  // Een album: B♭m het meest, dan F, C (zeker), Es (~) en een stuk met −32 ct.
  track('toon-album', 'figure xiii (album, proef)', { versie: 1, stemming: -12, bron: 'auto', slot: false, stukken: [
    { van: 0, toonsoort: 'Bbm', stemming: -8, zekerheid: 0.62, tweede: 'Db' },
    { van: 30, toonsoort: 'Ab', stemming: -32, zekerheid: 0.31, tweede: 'Db' },
    { van: 50, toonsoort: 'Bbm', stemming: -10, zekerheid: 0.7 },
    { van: 80, toonsoort: 'C', stemming: 4, zekerheid: 0.9 },
    { van: 100, toonsoort: 'Eb', stemming: 0, zekerheid: 0.06, tweede: 'Bb' },
  ] }),
  track('toon-aqua', 'Aqua (één stuk, zeker)', { versie: 1, stemming: 8, bron: 'auto', slot: false,
    stukken: [{ van: 0, toonsoort: 'G', stemming: 8, zekerheid: 0.87, tweede: 'D' }] }),
  track('toon-zoned', 'zoned out (geen duidelijke toonsoort)', { versie: 1, stemming: 43, bron: 'auto', slot: false,
    stukken: [{ van: 0, toonsoort: 'E', stemming: 43, zekerheid: 0.04, tweede: 'A' }] }),
  track('toon-slot', 'Merry Christmas (op slot)', { versie: 1, stemming: 0, bron: 'hand', slot: true,
    stukken: [{ van: 0, toonsoort: 'Bbm', stemming: 0 }] }),
  track('toon-geen', 'Rain (nog geen kaart)', null),
];
const bewaard = [];   // wat de app naar POST /api/library/<id>/toon stuurde

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
async function foto(naam, clip = null) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
/** Een echte muisklik (pointerdown, pointerup, click) midden op het element. */
async function klik(selector) {
  const r = await evalueer(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
    const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error(`niet gevonden: ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }
  await wacht(80);
}
const rect = (selector, marge = 4) => evalueer(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.max(0, b.left - ${marge}), y: Math.max(0, b.top - ${marge}), width: b.width + ${2 * marge}, height: b.height + ${2 * marge} }; })()`);
const frames = (n = 10) => evalueer(`new Promise((ok) => { let i = 0; const f = () => (++i < ${n} ? requestAnimationFrame(f) : ok()); requestAnimationFrame(f); })`);

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
  ws.addEventListener('message', async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    // De nep-library: lijst en toon-POST beantwoorden, de rest naar de echte server.
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const pad = new URL(request.url).pathname;
      const antwoord = (obj, code = 200) => cdp('Fetch.fulfillRequest', { requestId, responseCode: code,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(obj)).toString('base64') });
      // Het paneel vraagt pagina's (?van=&aantal=, library-spoor); zonder aantal alles.
      if (request.method === 'GET' && pad === '/api/library') {
        const q = new URL(request.url).searchParams;
        const van = Number(q.get('van') || 0), aantal = q.has('aantal') ? Number(q.get('aantal')) : TRACKS.length;
        return antwoord({ tracks: TRACKS.slice(van, van + aantal), totaal: TRACKS.length, van });
      }
      const t = /^\/api\/library\/([\w-]+)\/toon$/.exec(pad);
      if (request.method === 'POST' && t) {
        const body = JSON.parse(request.postData || '{}');
        bewaard.push({ id: t[1], toon: body.toon });
        // Zoals de echte server: de lijst geeft daarna de bewaarde kaart.
        const tr = TRACKS.find((x) => x.id === t[1]);
        if (tr) tr.toon = body.toon;
        return antwoord({ ok: true });
      }
      return cdp('Fetch.continueRequest', { requestId });
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/library*', requestStage: 'Request' }] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.library)').catch(() => false)) break; await wacht(200); }
  await wacht(800);
  ok('de app start zonder MIDI', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));
  await evalueer('window.engine.resume()');

  // ---- library-kolom (de plaat) ----
  await klik('#lib-btn');
  for (let i = 0; i < 50; i++) { if (await evalueer("document.querySelectorAll('.lib-rij').length === 5")) break; await wacht(200); }
  const lib = await evalueer(`Object.fromEntries([...document.querySelectorAll('.lib-toon')].map((b) => [b.dataset.toon, { t: b.textContent, c: b.className, title: b.title }]))`);
  ok(`library album: hoofdtoonsoort + aantal andere ("${lib['toon-album']?.t}")`, lib['toon-album']?.t === '3A B♭m +3');
  ok(`library één stuk: "${lib['toon-aqua']?.t}"`, lib['toon-aqua']?.t === '9B G');
  ok(`library onder 0,15: "${lib['toon-zoned']?.t}", met de beste gok in de tooltip`, lib['toon-zoned']?.t === '~' && lib['toon-zoned'].title.includes('best passend: E'));
  ok('library op slot: in de kleur van het slot', lib['toon-slot']?.t === '3A B♭m' && /\bslot\b/.test(lib['toon-slot'].c));
  ok('library zonder kaart: —', lib['toon-geen']?.t === '—');
  await foto('toon-library.png', await rect('#lib-panel', 0));

  // ---- laden op vijf tracks, pitch erop, focus op track 1 ----
  await evalueer(`(async () => {
    const L = window.library;
    await L.laad('toon-album', 'A'); await L.laad('toon-aqua', 'B'); await L.laad('toon-zoned', 'C');
    await L.laad('toon-slot', 'D'); await L.laad('toon-geen', 'E');
  })()`);
  ok('de kaart komt mee met het nummer (laden.js)', await evalueer("window.engine.deck('A').toonKaart?.aantalStukken === 5 && window.engine.deck('E').toonKaart === null"));
  await klik('#lib-panel .lib-close');
  await evalueer(`(() => {
    const e = window.engine;
    e.deck('A').seek(35); e.deck('A').setRate(1.06);     // As −32 ct op +6%: A, −31 ct, onzeker
    e.deck('B').setRate(1.02);                          // G +8 ct op +2%: G +42 ct: "tussen G en A♭"
    e.deck('D').setRate(0.94);                          // B♭m op −6%: Am
    e.setFocus('A');
  })()`);
  await frames(12);
  const kop = await evalueer(`Object.fromEntries([...document.querySelectorAll('.kol')].map((k) => [k.dataset.deck, { t: k.querySelector('.kol-toon').textContent, c: k.querySelector('.kol-toon').className, title: k.querySelector('.kol-toon').title }]))`);
  ok(`kolomkop 1: wat je HOORT, onzeker met "?" ("${kop.A.t}")`, kop.A.t === '11B A?' && /onzeker/.test(kop.A.c));
  ok(`kolomkop 2: "${kop.B.t}", tooltip "tussen G en A♭"`, kop.B.t === '9B G' && kop.B.title.includes('tussen G en A♭'));
  ok(`kolomkop 3: "~" ("${kop.C.t}")`, kop.C.t === '~' && kop.C.title.includes('geen duidelijke toonsoort (best passend: E, of A)'));
  ok(`kolomkop 4 op −6%: B♭m wordt Am ("${kop.D.t}")`, kop.D.t === '8A Am');
  ok(`kolomkop 5 zonder kaart en 6 leeg: — ("${kop.E.t}", "${kop.F.t}")`, kop.E.t === '—' && kop.F.t === '—');
  const past = await evalueer(`[...document.querySelectorAll('.kol-toon, .kol-info')].every((el) => el.scrollWidth <= el.clientWidth + 1)`);
  ok('de kolomkop past op 1440×900 (niets afgeknipt)', past);
  const fk = await evalueer(`(() => { const r = document.getElementById('focus-deck');
    return { h: r.querySelector('.toon-hoofd').textContent, v: r.querySelector('.toon-versch').textContent, c: r.querySelector('.toon-cent').textContent,
      cl: r.querySelector('.toon-val').className, title: r.querySelector('.toon-knop').title }; })()`);
  ok(`focus groot: "${fk.h}" "${fk.v}" "${fk.c}"`, fk.h === '11B · A majeur?' && fk.v === '+1' && fk.c === '−31 ct');
  ok('focus-tooltip: de plaat erbij (T3)', fk.title.includes('op de plaat: 4B As majeur, −32 ct') && fk.title.includes('1 halve toon hoger'));
  await foto('toon-scherm.png');
  await foto('toon-kolomkoppen.png', await rect('#kolommen', 2).then((r) => ({ ...r, height: 80 })));
  await foto('toon-focus.png', await rect('#focus-deck .deck-head', 4));

  // ---- corrigeren per stuk: het menu op de focus-track ----
  await klik('#focus-deck .toon-knop');
  ok('klik op de toonsoort opent het menu', await evalueer("!document.querySelector('#focus-deck .toon-menu').classList.contains('hidden')"));
  await frames(3);
  await foto('toon-menu.png', await rect('#focus-deck .toon-val', 6).then((r) => ({ ...r, width: 280, height: 150 })));
  await klik('#focus-deck .toon-menu [data-action$=".key.fifth.up"]');
  ok('kwint + (scherm → action → deck): het stuk hier As → Es', await evalueer("window.engine.deck('A').toonKaart.stukAt(35).toonsoort === 'Eb' && window.engine.deck('A').toonKaart.bron === 'hand'"));
  await frames(3);
  ok(`... en de focus toont het meteen: Es op +6% = E, nu zeker ("${await evalueer("document.querySelector('#focus-deck .toon-hoofd').textContent")}")`,
    await evalueer("document.querySelector('#focus-deck .toon-hoofd').textContent === '12B · E majeur'"));
  for (let i = 0; i < 30 && !bewaard.some((b) => b.id === 'toon-album'); i++) await wacht(100);
  const b1 = bewaard.find((b) => b.id === 'toon-album');
  ok('binnen 1,5 s bewaard: POST /api/library/toon-album/toon met de hele kaart, bron hand',
    b1 && b1.toon.stukken.length === 5 && b1.toon.stukken[1].toonsoort === 'Eb' && b1.toon.bron === 'hand' && b1.toon.stukken[1].zekerheid === undefined);
  ok('... de andere stukken ongeschonden (zekerheid, tweede kandidaat)', b1 && b1.toon.stukken[0].zekerheid === 0.62 && b1.toon.stukken[0].tweede === 'Db');
  await klik('#focus-deck .deck-title');
  ok('klik ernaast sluit het menu', await evalueer("document.querySelector('#focus-deck .toon-menu').classList.contains('hidden')"));

  // ---- de kiezer in de library ----
  await klik('#lib-btn');
  await wacht(300);
  await klik('.lib-toon[data-toon="toon-aqua"]');
  ok('klik op de toon-badge in de library opent de kiezer (24 + geen + bevestigen)',
    await evalueer("document.querySelectorAll('.lib-toonkiezer .lib-tk').length === 24 && !!document.querySelector('.lib-toonkiezer [data-tk=slot]')"));
  await foto('toon-kiezer.png', await rect('.lib-toonkiezer', 70));
  const voor = bewaard.length;
  await klik('.lib-toonkiezer [data-tk="21"]');   // 21 = Am (8A)
  const b2 = bewaard.slice(voor).find((b) => b.id === 'toon-aqua');
  ok('kiezen: POST met één stuk Am, met de hand en op slot', b2 && b2.toon.stukken.length === 1 && b2.toon.stukken[0].toonsoort === 'Am'
    && b2.toon.bron === 'hand' && b2.toon.slot === true);
  ok('... de stemming van de plaat blijft (+8 ct)', b2 && b2.toon.stukken[0].stemming === 8);
  await frames(3);
  ok('... en track 2 toont het meteen', await evalueer("window.engine.deck('B').toonKaart.stukAt(0).toonsoort === 'Am' && document.querySelector('.kol[data-deck=B] .kol-toon').textContent === '8A Am'"));
  const nPost = bewaard.length;
  await wacht(1800);
  ok('de bewaarlus stuurt het niet nog een keer (kiezer en deck zijn gelijk)', bewaard.length === nPost);
  await klik('.lib-toon[data-toon="toon-album"]');
  const voor3 = bewaard.length;
  await klik('.lib-toonkiezer [data-tk="7"]');    // G
  ok('album: de eerste klik vraagt om een tweede (er zijn meer stukken)', bewaard.length === voor3
    && (await evalueer("document.querySelector('.lib-status').textContent")).includes('klik nog eens'));
  await klik('.lib-toonkiezer [data-tk="7"]');
  const b3 = bewaard.slice(voor3).find((b) => b.id === 'toon-album');
  ok('album: na de tweede klik één stuk G', b3 && b3.toon.stukken.length === 1 && b3.toon.stukken[0].toonsoort === 'G');
  ok('geen fouten in de console', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(`\n${uitkomst.length - rood}/${uitkomst.length} goed — schermafdrukken in ${UIT}`);
process.exit(rood ? 1 : 0);
