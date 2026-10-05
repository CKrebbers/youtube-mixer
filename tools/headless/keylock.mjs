// Keylock en toon verschuiven (docs/KEYLOCK.md) in een headless Chromium.
//
// 1. De ECHTE Web Audio van Chrome: de engine op een OfflineAudioContext, een
//    sinus van 440 Hz via de StreamBron (laadGeheugen, zoals de demo), en de
//    Signalsmith-WASM in Chrome's eigen AudioWorkletGlobalScope (in Node is die
//    nagebouwd). Gemeten in wat de master uitgeeft: de toon met en zonder
//    keylock op +8%, transponeren, en een hotcue met keylock (een klik 20 ms
//    na het doel klinkt op T + 20 ms + de vooruitblik van de limiter).
// 2. Rekenwerk: acht tracks met keylock tegen acht zonder, offline gerenderd
//    (geen realtime-thread, wel Chrome's eigen WASM en worklet): hoe veel
//    sneller dan realtime.
// 3. De app: de knop keylock en de toonknoppen in de focuskop.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad, eigen
// server op een eigen poort met een tijdelijke database. De offline context
// speelt niets af.
//
// Gebruik:  node tools/headless/keylock.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8831), VARVE_KIJK_DEBUG (9431).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8831, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9431;
const tmp = mkdtempSync(join(tmpdir(), 'varve-keylock-'));

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
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
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
/** Twee beelden van de renderloop afwachten (die tekent de rij); headless kan een beeld lang duren. */
const beeld = () => evalueer(`Promise.race([
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
  new Promise((r) => setTimeout(() => r(false), 5000))])`);
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const meld = (tekst) => console.log(`   ·  ${tekst}`);


/**
 * Een scenario in de pagina: de engine op een OfflineAudioContext (stereo,
 * 48 kHz), `s.decks` tracks met elk een sinus (440 Hz, of klikken), keylock,
 * toon en tempo, en gebeurtenissen op de audioklok (ctx.suspend).
 *   s.duur, s.decks (1–8), s.klikken (klik om de 0,5 s in plaats van de sinus)
 *   s.keylock, s.toon, s.rate, s.start (audioklok)
 *   s.hotcue = [t, doel]: op t naar tracktijd `doel` (seek, zoals een hotcue)
 */
const meet = (s) => evalueer(`(async () => {
  const s = ${JSON.stringify(s)};
  const SR = 48000, N = Math.round(s.duur * SR);
  const Echt = window.AudioContext;
  window.AudioContext = class extends OfflineAudioContext {
    constructor() { super({ numberOfChannels: 2, length: N, sampleRate: SR }); }
  };
  let e;
  try {
    const { Engine } = await import('/src/engine/engine.js');
    e = new Engine();
  } finally { window.AudioContext = Echt; }
  await e.master.klaar;
  const ctx = e.ctx;
  const DUUR = 30, n = DUUR * SR;
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].slice(0, s.decks || 1);
  for (const [k, id] of ids.entries()) {
    const buf = ctx.createBuffer(2, n, SR);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const f = 440 * Math.pow(2, k / 12);
    for (let i = 0; i < n; i++) {
      const v = s.klikken ? (i % (SR / 2) < 24 ? 0.9 : 0) : 0.4 * Math.sin(2 * Math.PI * f * i / SR);
      L[i] = v; R[i] = v;
    }
    const d = e.deck(id);
    if (!(await d.laadGeheugen(buf, 'test ' + id))) throw new Error('niet geladen');
    d.set('fader', 1);
    d.setKeylock(!!s.keylock);
    d.setTranspositie(s.toon || 0);
    d.setRate(s.rate || 1);
    // Een hotcue is vastgepind (zijn pagina's zijn er al), zoals in de app.
    if (s.hotcue && id === 'A') { d.restoreHotcues([s.hotcue[1]]); await d.bron.bijvullen(); }
    await new Promise((r) => setTimeout(r, 50));
  }
  let hotT = null;
  const STAP = 0.025;
  for (let i = 1; i * STAP < s.duur - 0.05; i++) {
    const t = i * STAP;
    ctx.suspend(t).then(() => {
      if (Math.abs(t - (s.start ?? 0.1)) < STAP / 2) for (const id of ids) e.deck(id).play();
      if (s.hotcue && Math.abs(t - s.hotcue[0]) < STAP / 2) {
        const d = e.deck('A');
        d.hotcue(0);
        hotT = d.bron.seg.T;
      }
      return new Promise((r) => setTimeout(r, 1)).then(() => ctx.resume());
    });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  const L = Array.from(buf.getChannelData(0));
  const rek = e.deck('A').bron.rek;
  return { L, ms, hotT, vertraging: ctx.graafVertraging ?? 0, rek, keylock: e.deck('A').keylock };
})()`);


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

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer && window.patronen)').catch(() => false)) break; await wacht(200); }
  await wacht(800);


  const SR = 48000;
  /** Frequentie uit nuldoorgangen over x[van..tot). */
  const freq = (x, van, tot) => {
    let eerste = null, laatste = null, k = 0;
    for (let i = van + 1; i < tot; i++) if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]);
      if (eerste === null) eerste = t; else { laatste = t; k++; }
    }
    return k ? (k * SR) / (laatste - eerste) : 0;
  };
  const cent = (f, r) => 1200 * Math.log2(f / r);

  // ---- 1. de toon ---------------------------------------------------------------
  console.log('Chrome, OfflineAudioContext 48 kHz: de Signalsmith-WASM in de echte worklet');
  const zonder = await meet({ duur: 2, rate: 1.08 });
  const fz = freq(zonder.L, SR, 2 * SR - 100);
  ok(`zonder keylock op +8%: de toon schuift mee (${fz.toFixed(2)} Hz, verwacht 475,20)`, Math.abs(cent(fz, 475.2)) < 1);
  const met = await meet({ duur: 2, rate: 1.08, keylock: true });
  const fm = freq(met.L, SR, 2 * SR - 100);
  ok(`keylock op +8%: de toon blijft 440 Hz (${fm.toFixed(2)} Hz, ${cent(fm, 440).toFixed(2)} ct)`, Math.abs(cent(fm, 440)) < 1 && met.keylock);
  const lager = await meet({ duur: 2, rate: 0.92, keylock: true });
  const fl = freq(lager.L, SR, 2 * SR - 100);
  ok(`keylock op −8%: 440 Hz (${fl.toFixed(2)} Hz)`, Math.abs(cent(fl, 440)) < 1);
  const toon = await meet({ duur: 2, rate: 1, keylock: true, toon: 2 });
  const ft = freq(toon.L, SR, 2 * SR - 100);
  ok(`toon +2 met keylock: ${ft.toFixed(2)} Hz (verwacht 493,88, binnen 5 cent)`, Math.abs(cent(ft, 493.88)) < 5);
  const k8 = await meet({ duur: 2, rate: 1.08, toon: -1 });
  const f8 = freq(k8.L, SR, 2 * SR - 100);
  const v8 = 440 * 1.08 * Math.pow(2, -1 / 12);
  ok(`toon −1 zonder keylock op +8% (K8): ${f8.toFixed(2)} Hz (verwacht ${v8.toFixed(2)})`, Math.abs(cent(f8, v8)) < 5);

  // ---- een hotcue met keylock ----------------------------------------------------------
  const h = await meet({ duur: 2, klikken: true, keylock: true, rate: 1, hotcue: [1.0, 20.48] });
  // De klikken komen zachter uit de master (fader, kanaal, limiter): de drempel
  // is de helft van een klik van vóór de sprong (die van 0,5 s in de track).
  const piekVoor = Math.max(...h.L.slice(Math.round(0.6 * SR), Math.round(0.8 * SR)).map(Math.abs));
  let eerste = null;
  for (let i = Math.round((h.hotT - 0.01) * SR); i < h.L.length; i++) if (Math.abs(h.L[i]) >= piekVoor / 2) { eerste = i / SR; break; }
  const verwacht = h.hotT + 0.02 + h.vertraging;
  ok(`hotcue met keylock: gepland ${((h.hotT - 1.0) * 1000).toFixed(1)} ms na het drukken; de klik 20 ms na het doel op T + 20 ms (+ limiter ${(h.vertraging * 1000).toFixed(1)} ms): ${eerste ? ((eerste - verwacht) * 1000).toFixed(3) : '?'} ms`,
    eerste !== null && Math.abs(eerste - verwacht) < 0.0003 && h.hotT - 1.0 > 0.09 && h.hotT - 1.0 < 0.105);
  const piek = eerste ? Math.max(...h.L.slice(Math.round(eerste * SR), Math.round(eerste * SR) + 30).map(Math.abs)) : 0;
  ok(`… op volle sterkte (piek ${piek.toFixed(3)}, een klik van vóór de sprong ${piekVoor.toFixed(3)})`, piekVoor > 0.05 && Math.abs(piek / piekVoor - 1) < 0.1);

  // ---- 2. rekenwerk: acht tracks ------------------------------------------------------
  console.log('\nrekenwerk (offline, Chrome-WASM)');
  const R = [];
  for (const kl of [false, true]) {
    const r = await meet({ duur: 20, decks: 8, rate: 1.03, keylock: kl });
    R.push(r.ms);
    meld(`acht tracks ${kl ? 'MET' : 'zonder'} keylock, 20 s: ${(r.ms / 1000).toFixed(2)} s rekenen = ${(20000 / r.ms).toFixed(1)}× realtime`);
  }
  // Offline rendert Chrome zo snel als het kan, met elke 25 ms een suspend (de
  // hoofdthread): de absolute tijd zegt weinig, het VERSCHIL is wat keylock kost.
  const perTrack = (R[1] - R[0]) / 20000 / 8;
  ok(`keylock kost ${(perTrack * 100).toFixed(1)}% van een kern per track (gemeten in Node: ~2%; acht tracks ${(perTrack * 800).toFixed(0)}%)`, perTrack < 0.05);

  // ---- 3. de app ----------------------------------------------------------------------
  console.log('\nde app');
  await evalueer("window.engine.deck('A').setKeylock(false), true");
  const knop = await evalueer("(() => { const b = document.querySelector('.rek .keylock'); return b ? { actie: b.dataset.action } : null; })()");
  ok('de focuskop heeft een knop keylock (op de focus-track)', !!knop && /^track\.\d\.keylock$/.test(knop.actie), JSON.stringify(knop));
  const druk = (sel) => evalueer(`(() => { const b = document.querySelector('${sel}');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  await druk('.rek .keylock');
  await wacht(300);
  await beeld();
  const st = await evalueer("(() => { const id = window.engine.focus; const d = window.engine.deck(id); return { keylock: d.keylock, on: document.querySelector('.rek .keylock').classList.contains('on') }; })()");
  ok('klik: keylock aan op de focus-track, en de knop brandt', st.keylock && st.on, JSON.stringify(st));
  await druk('.rek button[data-action$="transpose.up"]');
  await wacht(300);
  await beeld();
  const tt = await evalueer("document.querySelector('.rek-toon').textContent");
  ok(`toon +1: de kop zegt "${tt}"`, tt === '+1');

  for (const m of meldingen) console.log(`  ! ${m}`);
  ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0, meldingen.length ? `${meldingen.length}` : '');
} catch (err) {
  console.error(err);
  uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGINT');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
