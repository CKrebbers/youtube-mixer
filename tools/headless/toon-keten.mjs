// De toonsoort door de HELE keten, headless, met de echte server (ROADMAP 14):
// upload -> ingest (stap "toon", in de worker) -> library -> /api/library ->
// deck -> kolomkop en focus -> met de hand corrigeren -> POST /toon -> slot in
// de kiezer -> pagina herladen -> weer laden -> ↻ (grid én toonsoort) -> een
// nummer waar de analyse twijfelt: de tweede kandidaat van de server in de tooltips.
//
// Anders dan toon.mjs wordt hier NIETS onderschept of nagemaakt: het nummer gaat
// door de gewone upload-route en de ingest, en elke controle leest wat de server
// bewaarde. Eén ding wordt alleen VERTRAAGD (DevTools Fetch-domein, doorgelaten):
// peaks.bin van het tweede nummer, 2,5 s. Zo is te zien dat een laad over een
// track met een ander library-nummer het OUDE nummer niet wist (de bewaarlus
// loopt om de 1,5 s en zag daar eerst een deck zonder grid en toonsoort).
//
// Zelfde opzet als kijk.mjs: MIDI eruit vóór de pagina laadt, een EIGEN server
// op een eigen poort met een tijdelijke database, media- en opnamemap.
//
// Gebruik:  node tools/headless/toon-keten.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (server) en VARVE_KIJK_DEBUG (DevTools), zoals kijk.mjs.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8791, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9337;
const B = `http://localhost:${POORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'varve-toonketen-'));
mkdirSync(UIT, { recursive: true });

// ---- klank: cadensen met bas, melodie en een kick (zoals test/toon.test.mjs) --------
const BR = 48000;
function rndMet(z) { let s = z >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
const TAB = 4096, zaag = new Float32Array(TAB + 1), sinus = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) {
  let v = 0;
  for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * h * i / TAB) / h;
  zaag[i] = v * 0.55; sinus[i] = Math.sin(2 * Math.PI * i / TAB);
}
function noot(x, van, duur, f, amp, rnd, tab = zaag) {
  const a = Math.round(van * BR), n = Math.round(duur * BR), stap = f * TAB / BR;
  let fase = rnd() * TAB;
  for (let i = 0; i < n && a + i < x.length; i++) {
    const t = i / BR, env = Math.min(1, t / 0.02) * Math.min(1, (duur - t) / 0.15);
    const j = fase | 0, fr = fase - j;
    x[a + i] += amp * env * (tab[j] + fr * (tab[j + 1] - tab[j]));
    fase += stap; if (fase >= TAB) fase -= TAB;
  }
}
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
/** I-IV-V-I (of i-iv-V-i) in `tonica` (C = 0), 124 bpm-kick eronder. */
function stuk(tonica, mineur, duur, zaad) {
  const rnd = rndMet(zaad), x = new Float32Array(Math.round(duur * BR));
  const R = mineur ? [[0, [0, 3, 7]], [5, [0, 3, 7]], [7, [0, 4, 7]], [0, [0, 3, 7]]] : [[0, [0, 4, 7]], [5, [0, 4, 7]], [7, [0, 4, 7]], [0, [0, 4, 7]]];
  const ladder = mineur ? [0, 2, 3, 5, 7, 8, 11] : [0, 2, 4, 5, 7, 9, 11];
  for (let t = 0, i = 0; t < duur; t += 2, i++) {
    const [trap, soort] = R[i % 4], grond = 48 + ((tonica + trap) % 12);
    for (const iv of soort) noot(x, t, 2, freq(grond + iv), 0.12, rnd);
    noot(x, t, 2, freq(grond - 12), 0.2, rnd);
    for (let m = 0; m < 4; m++) { const n = 72 + tonica + ladder[Math.floor(rnd() * 7)]; noot(x, t + m * 0.5, 0.5, freq(n > 84 ? n - 12 : n), 0.07, rnd, sinus); }
  }
  kick(x, duur);
  return x;
}
function kick(x, duur) {
  for (let t = 0; t < duur - 0.3; t += 60 / 124) {
    const a = Math.round(t * BR);
    for (let i = 0; i < 0.2 * BR && a + i < x.length; i++) x[a + i] += 0.5 * Math.sin(2 * Math.PI * 55 * i / BR) * Math.exp(-i / BR / 0.12);
  }
}
/**
 * Alleen kwinten, om en om op C en G, zonder terts en zonder melodie: C of G?
 * De analyse twijfelt (gemeten met zaad 5: G, zekerheid 0,10, tweede C).
 */
function kwinten(duur, zaad) {
  const rnd = rndMet(zaad), x = new Float32Array(Math.round(duur * BR));
  for (let t = 0, i = 0; t < duur; t += 2, i++) {
    const grond = 48 + (i % 2 ? 7 : 0);
    for (const iv of [0, 7]) noot(x, t, 2, freq(grond + iv), 0.12, rnd);
    noot(x, t, 2, freq(grond - 12), 0.2, rnd);
  }
  kick(x, duur);
  return x;
}
function wav(...delen) {
  const n = delen.reduce((a, d) => a + d.length, 0), x = new Float32Array(n);
  let o = 0, piek = 1e-9;
  for (const d of delen) { x.set(d, o); o += d.length; }
  for (const v of x) piek = Math.max(piek, Math.abs(v));
  const y = new Int16Array(n);
  for (let i = 0; i < n; i++) y[i] = Math.round(32767 * 0.8 * x[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8); kop.write('fmt ', 12);
  kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(1, 22); kop.writeUInt32LE(BR, 24);
  kop.writeUInt32LE(BR * 2, 28); kop.writeUInt16LE(2, 32); kop.writeUInt16LE(16, 34); kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  return Buffer.concat([kop, Buffer.from(y.buffer)]);
}
// Nummer 1: 70 s C majeur, dan 70 s Es majeur (een "album" van twee stukken).
const ALBUM = wav(stuk(0, false, 70, 1), stuk(3, false, 70, 2));
// Nummer 2: 40 s A mineur.
const TWEEDE = wav(stuk(9, true, 40, 3));
// Nummer 3: 40 s kwinten op C en G, waar de analyse twijfelt.
const TWIJFEL = wav(kwinten(40, 5));

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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverFout = '';
server.stderr.on('data', (d) => { serverFout += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
const toonPosts = [];         // POST .../toon (en /toon/analyseer) zoals de browser ze stuurde
let peaksVertraging = null;   // track-id waarvan peaks.bin 2,5 s wacht
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
async function klik(selector) {
  const r = await evalueer(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
    const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error(`niet gevonden: ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await wacht(80);
}
const rect = (selector, marge = 4) => evalueer(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.max(0, b.left - ${marge}), y: Math.max(0, b.top - ${marge}), width: b.width + ${2 * marge}, height: b.height + ${2 * marge} }; })()`);
const frames = (n = 10) => evalueer(`new Promise((ok) => { let i = 0; const f = () => (++i < ${n} ? requestAnimationFrame(f) : ok()); requestAnimationFrame(f); })`);
const serverToon = async (id) => (await (await fetch(`${B}/api/library/${id}/toon`)).json()).toon;
const serverGrid = async (id) => (await (await fetch(`${B}/api/library/${id}/grid`)).json()).grid;
const serverHotcues = async (id) => (await (await fetch(`${B}/api/library/${id}/hotcues`)).json()).hotcues;
async function tot(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wacht(150); }
  return null;
}
async function upload(naam, body) {
  const r = await fetch(`${B}/api/upload?naam=${encodeURIComponent(naam)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
  const j = await r.json();
  const o = await tot(async () => (await (await fetch(`${B}/api/ingest`)).json()).opdrachten.find((x) => x.id === j.id && x.status !== 'bezig' && x.status !== 'wacht'), 180000);
  return o;
}
async function wachtApp() {
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.library)').catch(() => false)) break; await wacht(200); }
  await wacht(800);
}
const kolom = (deck) => evalueer(`(() => { const k = document.querySelector('.kol[data-deck=${deck}] .kol-toon'); return { t: k.textContent, c: k.className, title: k.title }; })()`);
const badge = (id) => evalueer(`(() => { const b = document.querySelector('.lib-toon[data-toon="${id}"]'); return b ? { t: b.textContent, c: b.className, title: b.title } : null; })()`);

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

try {
  for (let i = 0; i < 100; i++) { if (await fetch(`${B}/api/opnames`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- 1. server: upload -> ingest -> kaart in de library -------------------------
  const t0 = Date.now();
  const o1 = await upload('album C dan Es.wav', ALBUM);
  const o2 = await upload('tweede in Am.wav', TWEEDE);
  const o3 = await upload('twijfel C of G.wav', TWIJFEL);
  const ID = o1?.track?.id, ID2 = o2?.track?.id, ID3 = o3?.track?.id;
  ok(`drie nummers via de gewone upload-route en de ingest (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    o1?.status === 'klaar' && o2?.status === 'klaar' && o3?.status === 'klaar', o1?.fout || o2?.fout || o3?.fout || '');
  const k1 = await serverToon(ID);
  ok(`de ingest bewaarde een automatische kaart: ${k1?.stukken.map((s) => `${s.van}s ${s.toonsoort} z${s.zekerheid}`).join(' | ')}`,
    k1?.bron === 'auto' && k1.slot === false && k1.versie >= 1 && k1.stukken.length === 2
    && k1.stukken[0].toonsoort === 'C' && k1.stukken[1].toonsoort === 'Eb' && Math.abs(k1.stukken[1].van - 70) <= 12);
  const k2 = await serverToon(ID2);
  ok(`tweede nummer: ${k2?.stukken.map((s) => s.toonsoort).join(' | ')}`, k2?.stukken.length === 1 && k2.stukken[0].toonsoort === 'Am');
  const k3 = await serverToon(ID3);
  ok(`twijfelnummer: ${k3?.stukken.map((s) => `${s.toonsoort} z${s.zekerheid} of ${s.tweede}`).join(' | ')}`,
    k3?.stukken.length === 1 && k3.stukken[0].toonsoort === 'G' && k3.stukken[0].tweede === 'C' && k3.stukken[0].zekerheid < 0.40);
  const alleStukken = [k1, k2, k3].flatMap((k) => k?.stukken ?? []);
  ok(`de ingest geeft elk stuk een tweede kandidaat (${alleStukken.map((s) => `${s.toonsoort}/${s.tweede}`).join(' ')})`,
    alleStukken.length === 4 && alleStukken.every((s) => typeof s.tweede === 'string' && s.tweede !== s.toonsoort));
  const lijst = (await (await fetch(`${B}/api/library`)).json()).tracks;
  ok('/api/library draagt dezelfde kaart', JSON.stringify(lijst.find((t) => t.id === ID)?.toon) === JSON.stringify(k1));

  // ---- 2. browser ------------------------------------------------------------------
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Network.requestWillBeSent') {
      const q = m.params.request;
      if (q.method === 'POST' && /\/api\/library\/[\w-]+\/toon/.test(q.url)) toonPosts.push({ pad: new URL(q.url).pathname, body: q.postData ?? null });
    }
    // Alleen vertragen, nooit beantwoorden: de echte server geeft het antwoord.
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      if (peaksVertraging && request.url.includes(`/media/${peaksVertraging}/peaks.bin`)) await wacht(2500);
      cdp('Fetch.continueRequest', { requestId }).catch(() => {});
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*peaks.bin*', requestStage: 'Request' }] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${B}/?vormen=0` });
  await wachtApp();
  ok('de app start zonder MIDI', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));
  await evalueer('window.engine.resume()');

  // library-kolom: de plaat, uit /api/library
  await klik('#lib-btn');
  await tot(() => evalueer(`document.querySelectorAll('.lib-rij').length === 3`));
  const b1 = await badge(ID);
  ok(`library-kolom toont de kaart van de server ("${b1?.t}")`, /^(8B C|5B E♭)\?? \+1$/.test(b1?.t ?? ''));
  await foto('keten-library.png', await rect('#lib-panel', 0));

  // laden, naar het tweede stuk, kolomkop en focus
  await evalueer(`window.library.laad(${JSON.stringify(ID)}, 'A')`);
  await klik('#lib-panel .lib-close');
  ok('de kaart komt van de server op het deck', await evalueer(`window.engine.deck('A').toonKaart?.aantalStukken === 2 && window.engine.deck('A').toonKaart.bron === 'auto'`));
  await evalueer(`(() => { const e = window.engine; e.deck('A').seek(110); e.setFocus('A'); })()`);
  await frames(12);
  const kA = await kolom('A');
  ok(`kolomkop op 110 s: wat je hoort, Es ("${kA.t}")`, /^5B E♭\??$/.test(kA.t));
  const fk = await evalueer(`document.querySelector('#focus-deck .toon-hoofd').textContent`);
  ok(`focus groot ("${fk}")`, /^5B · Es majeur\??$/.test(fk));
  await foto('keten-scherm.png');

  // corrigeren per stuk: kwint + (scherm -> action -> deck -> bewaarlus -> server)
  const nVoor = toonPosts.length;
  await klik('#focus-deck .toon-knop');
  await klik('#focus-deck .toon-menu [data-action$=".key.fifth.up"]');
  const na = await tot(async () => { const t = await serverToon(ID); return t?.bron === 'hand' ? t : null; });
  ok(`kwint + op 110 s komt op de server: ${na?.stukken.map((s) => `${s.toonsoort}${s.zekerheid === undefined ? '' : ` z${s.zekerheid}`}`).join(' | ')}`,
    na && na.stukken.length === 2 && na.stukken[1].toonsoort === 'Bb' && na.stukken[1].zekerheid === undefined
    && na.stukken[0].toonsoort === 'C' && na.stukken[0].zekerheid === k1.stukken[0].zekerheid && na.slot === false && na.versie === k1.versie);
  await wacht(3200);
  ok(`de bewaarlus stuurde het één keer (${toonPosts.length - nVoor} POST)`, toonPosts.length - nVoor === 1);
  await klik('#focus-deck .deck-title');

  // de kiezer: bevestigen = slot, zonder de kaart te veranderen
  await klik('#lib-btn');
  await wacht(300);
  ok(`library volgt de correctie ("${(await badge(ID))?.t}")`, /\+1$/.test((await badge(ID))?.t ?? '') && (await badge(ID)).title.includes('met de hand'));
  await klik(`.lib-toon[data-toon="${ID}"]`);
  await klik('.lib-toonkiezer [data-tk="slot"]');
  const slot = await tot(async () => { const t = await serverToon(ID); return t?.slot ? t : null; });
  ok('bevestigen: slot op de server, de twee stukken blijven', slot && slot.stukken.length === 2 && slot.stukken[1].toonsoort === 'Bb' && slot.bron === 'hand');
  await klik(`.lib-toon[data-toon="${ID}"]`);   // kiezer dicht
  const gridVoor = JSON.stringify(await serverGrid(ID));

  // hotcues horen bij het nummer (library-spoor): hotcue 1 op het eerste nummer
  await evalueer(`(() => { const d = window.engine.deck('A'); d.seek(30); d.hotcue(0); })()`);
  const hc1 = await tot(async () => { const h = await serverHotcues(ID); return h?.length ? h : null; });
  ok(`hotcue 1 van het eerste nummer staat op de server (${hc1?.map((h) => `${h.nr}@${h.tijd.toFixed(2)}`).join(' ')})`,
    hc1?.length === 1 && hc1[0].nr === 1 && Math.abs(hc1[0].tijd - 30) < 0.5);

  // een ander nummer over track A laden, met een trage golfvorm: het OUDE nummer blijft staan.
  // In het gat (het nieuwe nummer staat al op het deck, de golfvorm nog niet; deckTrack
  // is dan null) een hotcue zetten: die hoort bij het NIEUWE nummer, niet bij het vorige.
  peaksVertraging = ID2;
  await evalueer(`(window.__klaar = false, window.__laad = window.library.laad(${JSON.stringify(ID2)}, 'A').then(() => { window.__klaar = true; }), true)`);
  const inGat = await tot(() => evalueer(`window.engine.deck('A').duration < 60 && !window.__klaar`), 5000);
  const gatHotcue = await evalueer(`(() => { if (window.__klaar) return null; const d = window.engine.deck('A'); d.seek(12); d.hotcue(1); return d.hotcues[1]; })()`);
  await evalueer('window.__laad');
  peaksVertraging = null;
  ok(`in het gat een hotcue gezet op het nieuwe nummer (${gatHotcue?.toFixed?.(2)} s)`, inGat && Math.abs(gatHotcue - 12) < 0.5);
  await wacht(1800);
  const hcNa1 = await serverHotcues(ID), hcNa2 = await tot(async () => { const h = await serverHotcues(ID2); return h?.length ? h : null; });
  ok(`... die staat bij het nieuwe nummer (${hcNa2?.map((h) => `${h.nr}@${h.tijd.toFixed(2)}`).join(' ')}), het vorige houdt alleen de zijne`,
    hcNa2?.length === 1 && hcNa2[0].nr === 2 && Math.abs(hcNa2[0].tijd - 12) < 0.5
    && JSON.stringify(hcNa1) === JSON.stringify(hc1));
  ok('... en blijft op het deck staan na het laden', await evalueer(`Math.abs(window.engine.deck('A').hotcues[1] - 12) < 0.5 && window.engine.deck('A').hotcues[0] === null`));
  const naLaad = await serverToon(ID);
  ok(`laden over track A wist de toonsoort van het vorige nummer niet (${naLaad ? `${naLaad.stukken.length} stukken, slot ${naLaad.slot}` : 'GEWIST'})`,
    naLaad?.slot === true && naLaad.stukken.length === 2);
  ok('... en zijn grid ook niet', JSON.stringify(await serverGrid(ID)) === gridVoor && gridVoor !== 'null');
  ok('... en het nieuwe nummer houdt zijn eigen kaart', (await serverToon(ID2))?.stukken[0].toonsoort === 'Am'
    && await evalueer(`window.engine.deck('A').toonKaart?.stukAt(0).toonsoort === 'Am'`));

  // ---- 3. herladen: alles komt van de server terug ------------------------------------
  await cdp('Page.reload');
  await wachtApp();
  await evalueer('window.engine.resume()');
  await klik('#lib-btn');
  await tot(() => evalueer(`document.querySelectorAll('.lib-rij').length === 3`));
  const b2 = await badge(ID);
  ok(`na herladen: library op slot ("${b2?.t}")`, /\bslot\b/.test(b2?.c ?? '') && /\+1$/.test(b2?.t ?? ''));
  await evalueer(`window.library.laad(${JSON.stringify(ID)}, 'B')`);
  await klik('#lib-panel .lib-close');
  await evalueer(`(() => { const e = window.engine; e.deck('B').seek(110); e.setFocus('B'); })()`);
  await frames(12);
  const kB = await kolom('B');
  ok(`na herladen: track 2 op 110 s zegt B♭, zeker want op slot ("${kB.t}")`, kB.t === '6B B♭' && /\bzeker\b/.test(kB.c));
  const hcB = await tot(() => evalueer(`window.engine.deck('B').hotcues[0]`));
  ok(`na herladen: hotcue 1 van het eerste nummer komt terug op track 2 (${hcB?.toFixed?.(2)} s), de hotcue uit het gat niet`,
    Math.abs(hcB - 30) < 0.5 && await evalueer(`window.engine.deck('B').hotcues[1] === null`));
  await foto('keten-herladen.png');

  // ---- 4. ↻ in de library: grid én toonsoort opnieuw (tweede klik: er staat een slot op) ----
  await klik('#lib-btn');
  await wacht(300);
  const nAn = toonPosts.filter((p) => p.pad.endsWith('/analyseer')).length;
  await klik(`.lib-her[data-her="${ID}"]`);
  ok('↻ over een slot vraagt eerst om een tweede klik', toonPosts.filter((p) => p.pad.endsWith('/analyseer')).length === nAn
    && (await evalueer("document.querySelector('.lib-status').textContent")).includes('klik nog eens'));
  await klik(`.lib-her[data-her="${ID}"]`);
  const auto = await tot(async () => { const t = await serverToon(ID); return t?.bron === 'auto' ? t : null; }, 20000);
  ok(`↻ (tweede klik): de toonsoort is weer van de analyse (${auto?.stukken.map((s) => s.toonsoort).join(' | ')})`,
    auto && auto.slot === false && auto.stukken[1]?.toonsoort === 'Eb');
  await tot(() => evalueer(`window.engine.deck('B').toonKaart?.bron === 'auto'`), 5000);
  await frames(6);
  ok(`... en track 2 toont het meteen ("${(await kolom('B')).t}")`, /^5B E♭\??$/.test((await kolom('B')).t));
  await foto('keten-library-na.png', await rect('#lib-panel', 0));

  // ---- 5. de tweede kandidaat (TOONSOORT §5, T4): van de server tot in de tooltip ----
  const b3 = await badge(ID3);
  ok(`library: "${b3?.t}", de tooltip noemt de tweede kandidaat ("${b3?.title.split('\n')[0]}")`,
    b3?.t === '~' && b3.title.includes('geen duidelijke toonsoort (best passend: G, of C)'));
  await evalueer(`window.library.laad(${JSON.stringify(ID3)}, 'C')`);
  await klik('#lib-panel .lib-close');
  await evalueer(`(() => { const e = window.engine; e.deck('C').seek(20); e.setFocus('C'); })()`);
  await frames(12);
  const kC = await kolom('C');
  ok(`kolomkop track 3: "${kC.t}", tooltip "${kC.title.split('\n')[0]}"`,
    kC.t === '~' && kC.title.includes('geen duidelijke toonsoort (best passend: G, of C)'));
  const fC = await evalueer(`(() => { const k = document.querySelector('#focus-deck .toon-knop'); return { t: document.querySelector('#focus-deck .toon-hoofd').textContent, title: k.title }; })()`);
  ok(`focus: "${fC.t}", zelfde tooltip`, fC.t === '~' && fC.title.includes('geen duidelijke toonsoort (best passend: G, of C)'));
  // Met de pitch schuift de tweede mee: +6% is een halve toon (Ab, of Db).
  await evalueer(`window.engine.deck('C').setRate(1.06)`);
  await frames(6);
  const kC2 = await kolom('C');
  ok(`... en schuift mee met de pitch (+6%: "${kC2.title.split('\n')[0]}")`, kC2.title.includes('best passend: A♭, of D♭'));

  ok('geen fouten in de console', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  if (serverFout.trim()) console.log(`server stderr:\n${serverFout.trim().split('\n').slice(-8).join('\n')}`);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(`\n${uitkomst.length - rood}/${uitkomst.length} goed — schermafdrukken in ${UIT}`);
process.exit(rood ? 1 : 0);
