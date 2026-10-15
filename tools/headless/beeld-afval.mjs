// Wat kost de renderloop per beeld aan tijd en afval? (spoor A, punt A5, 15 okt)
//
// Per beeld maakt engine.snapshot() een stand voor acht decks (met grid.toJSON()), en de
// sleutel van elke golfvorm (zoom, overzicht, acht banen) doet JSON.stringify(d.grid)
// (waveform.js: _gridTekst, en _grid bij tekenen). Eerst meten, dan pas bouwen.
//
// In echte (headless) Chrome met de echte mixer: acht tracks met de demotrack, spelend, faders
// open, focus op track 1. Twee grids: één stuk (de demo) en een tempokaart van 12 stukken (zoals
// een lang nummer met tempowissels). Per variant:
//   - TIJD: de functies omwikkeld met performance.now() (snapshot, _gridTekst, _grid), 10 s;
//   - AFVAL: CDP HeapProfiler-sampling (elke 256 bytes, ook wat de jonge GC al opruimde), 10 s,
//     opgeteld per functie; en wat de hele pagina in die tijd aanmaakt.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess, eigen server, tijdelijke map.
// Gebruik:  [VARVE_CHROME=<chrome>] node tools/headless/beeld-afval.mjs   (poorten VARVE_BA_POORT 8937, VARVE_BA_DEBUG 8938)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = process.env.VARVE_CODE || fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_BA_POORT) || 8937, DEBUG = Number(process.env.VARVE_BA_DEBUG) || 8938;
const SEC = Number(process.env.VARVE_BA_S) || 10;
const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-ba-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: /headless.shell/.test(process.env.VARVE_CHROME) };
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

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opn'), VARVE_HERANALYSE: 'uit', VARVE_PATRONEN: join(tmp, 'pat'), VARVE_PLANNEN: join(tmp, 'plan'),
    VARVE_STANDEN: join(tmp, 'standen'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'),
    VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_SETS: join(tmp, 'sets'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes') }, stdio: 'ignore' });
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required', '--no-sandbox',
  // Headless knijpt requestAnimationFrame als de pagina nauwelijks verandert (tekenen.mjs).
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });

let ws, volg = 0; const wachtend = new Map();
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, fout) => wachtend.set(id, { ok, fout })); };
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

/** Bytes per functienaam uit een sampling-profiel (selfSize), en het totaal. */
function perFunctie(profiel) {
  const per = new Map();
  let totaal = 0;
  const loop = (n) => {
    const naam = n.callFrame.functionName || '(anoniem)';
    const sleutel = `${naam} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber + 1}`;
    per.set(sleutel, (per.get(sleutel) || 0) + n.selfSize);
    totaal += n.selfSize;
    for (const k of n.children) loop(k);
  };
  loop(profiel.head);
  return { per, totaal };
}

/** Bytes van alles ONDER een functie (inclusief), op naam. */
function onder(profiel, test) {
  let som = 0;
  const loop = (n, binnen) => {
    const nu = binnen || test(n.callFrame);
    if (nu) som += n.selfSize;
    for (const k of n.children) loop(k, nu);
  };
  loop(profiel.head, false);
  return som;
}

let code = 1;
try {
  let doelen = null; for (let i = 0; i < 50 && !doelen?.find?.((d) => d.type === 'page'); i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); } });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('HeapProfiler.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  for (let i = 0; i < 150; i++) { if (await ev('!!(window.engine && document.getElementById("meldingen"))').catch(() => false)) break; await wacht(200); }
  await wacht(1500);
  await ev(`(async () => {
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    window.__a = await import('/src/control/actions.js');
    window.__Beatgrid = Beatgrid;
    const e = window.engine;
    await e.resume();
    const ids = ['A','B','C','D','E','F','G','H'];
    // Via de knop demo (laden.laadBuffer): dan is er ook een golfvorm (analyse), en tekenen de views echt.
    for (let i = 0; i < ids.length; i++) {
      e.setFocus(ids[i]);
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector('.demo-btn').click();
      for (let k = 0; k < 100 && !e.deck(ids[i]).buffer; k++) await new Promise((r) => setTimeout(r, 50));
      e.deck(ids[i]).setGrid(new Beatgrid({ bpm: 124, firstBeat: 0, slot: true }));
    }
    void renderDemoTrack;
    for (let i = 1; i <= 8; i++) { __a.invoke('track.' + i + '.fader', 0.8); __a.invoke('track.' + i + '.play', true); __a.invoke('track.' + i + '.play', false); }
    e.setFocus('A');
    // Tijd per functie: omwikkelen (dezelfde module-instantie als de app).
    const { WaveformView } = await import('/src/ui/waveform.js');
    window.__tijd = {};
    const wikkel = (obj, naam, label) => { const o = obj[naam]; obj[naam] = function (...a) { const t0 = performance.now(); try { return o.apply(this, a); } finally { const r = (__tijd[label] ||= { ms: 0, n: 0 }); r.ms += performance.now() - t0; r.n++; } }; };
    wikkel(WaveformView.prototype, '_gridTekst', 'waveform._gridTekst');
    wikkel(WaveformView.prototype, '_grid', 'waveform._grid');
    wikkel(e, 'snapshot', 'engine.snapshot');
    window.__beelden = 0; (function t() { window.__beelden++; requestAnimationFrame(t); })();
    return true;
  })()`);
  await wacht(3000);

  const varianten = [
    ['één stuk (de demo)', `for (const id of ['A','B','C','D','E','F','G','H']) engine.deck(id).setGrid(new __Beatgrid({ bpm: 124, firstBeat: 0, slot: true }))`],
    ['tempokaart van 12 stukken', `for (const id of ['A','B','C','D','E','F','G','H']) engine.deck(id).setGrid(new __Beatgrid({ slot: true, stukken: Array.from({ length: 12 }, (_, k) => ({ van: k * 10, bpm: 124 + k * 0.37, anker: k * 10 + 0.013 * k, zekerheid: 0.81, maat: k * 10 })) }))`],
  ];
  const uitkomst = [];
  for (const [naam, zet] of varianten) {
    await ev(`${zet}; true`);
    await wacht(1500);
    // Tijd.
    await ev('(window.__tijd = {}, window.__b0 = window.__beelden, window.__t0 = performance.now(), true)');
    await wacht(SEC * 1000);
    const tijd = await ev('({ tijd: window.__tijd, beelden: window.__beelden - window.__b0, s: (performance.now() - window.__t0) / 1000 })');
    // Afval (sampling, ook wat de GC al opruimde).
    await cdp('HeapProfiler.collectGarbage');
    await cdp('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const b0 = await ev('window.__beelden');
    await wacht(SEC * 1000);
    const { profile } = await cdp('HeapProfiler.stopSampling');
    const beelden = (await ev('window.__beelden')) - b0;
    const { per, totaal } = perFunctie(profile);
    const sleutelAfval = onder(profile, (f) => f.functionName === '_gridTekst' || f.functionName === '_grid');
    const snapAfval = onder(profile, (f) => f.functionName === 'snapshot' && /engine\.js$/.test(f.url));
    const toJsonAfval = onder(profile, (f) => (f.functionName === 'toJSON' || f.functionName === 'get stukken') && /beatgrid\.js$/.test(f.url));
    const r = (x) => Math.round(x);
    const ms = (l) => tijd.tijd[l] ? `${(tijd.tijd[l].ms / tijd.s).toFixed(2)} ms/s (${r(tijd.tijd[l].n / tijd.s)}×/s)` : '-';
    console.log(`\n== ${naam}: ${r(tijd.beelden / tijd.s)} beelden/s`);
    console.log(`tijd   engine.snapshot ${ms('engine.snapshot')} · _gridTekst ${ms('waveform._gridTekst')} · _grid ${ms('waveform._grid')}`);
    console.log(`afval  hele pagina ${r(totaal / SEC / 1024)} kB/s · snapshot (alles eronder) ${r(snapAfval / SEC / 1024)} kB/s`
      + ` · waarvan grid.toJSON ${r(toJsonAfval / SEC / 1024)} kB/s · golfvorm-sleutels (_gridTekst + _grid) ${r(sleutelAfval / SEC / 1024)} kB/s`
      + ` · per beeld: snapshot ${r(snapAfval / Math.max(1, beelden))} B, sleutels ${r(sleutelAfval / Math.max(1, beelden))} B`);
    const top = [...per].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${r(v / SEC / 1024)} kB/s ${k}`);
    console.log('top    ' + top.join('\n       '));
    uitkomst.push({ naam, tijd, totaal, snapAfval, toJsonAfval, sleutelAfval, beelden });
  }
  code = 0;
} catch (e) {
  console.error('fout', e.stack);
} finally {
  try { browser.kill('SIGKILL'); } catch (_) {}
  try { server.kill('SIGKILL'); } catch (_) {}
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
}
