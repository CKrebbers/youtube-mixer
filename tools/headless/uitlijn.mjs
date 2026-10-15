// De uitlijnweergave in echte Chrome (werkruimte S2, docs/werkruimte/S2.md), headless.
// Wat test/uitlijn.test.mjs niet kan: de echte mixer met acht spelende tracks, het losse
// venster (uitlijn.html) naast het hoofdvenster, en wat dat kost.
//
//  1. de knop "uitlijn" staat in de bovenbalk, en die past in rust nog op 1440 px;
//  2. acht demotracks (verschillende tempo's, gesynct, een paar ms naast elkaar geduwd),
//     uitlijn.html open in pagina-vorm: de getallen in het DOM tegen engine.faseVerschil;
//  3. in rust (alles speelt, niemand raakt iets aan): hoeveel megapixel per seconde er
//     getekend wordt (een teller op drawImage/fillRect/…, ook op de tegels buiten het DOM),
//     en het rekenwerk per beeld;
//  4. beelden per seconde van het hoofdvenster met en zonder uitlijn.html open;
//  5. uitlijn.html maakt geen AudioContext, vraagt geen MIDI en geen Web Lock (geteld met
//     een haak in elk document, vóór de scripts van de pagina);
//  6. de strook in het werkvak (toonInWerkvak), in rust;
//  7. een baan slepen in het venster doet niets zolang track.N.phase.offset niet bestaat
//     (spoor S1), en anders duwt hij.
//
// Een EIGEN server op een eigen poort met tijdelijke mappen (VARVE_TESTSERVER=1). Geen
// netwerk, geen MIDI (dit tabblad vraagt geen requestMIDIAccess: hij is weggehaald).
// LET OP: software-rendering (swiftshader) in een container maakt elk beeld traag; de
// beeldsnelheid hier zegt iets over het VERSCHIL met en zonder venster, niet over de M1.
//
// Gebruik:  node tools/headless/uitlijn.mjs [uitmap]      (uitmap: schermafdrukken en uitlijn.json)
// Poorten:  VARVE_KIJK_POORT (8920) en VARVE_KIJK_DEBUG (8921). Chrome: VARVE_CHROME.
//           VARVE_TMP: waar de tijdelijke mappen komen.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || null;
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8920, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 8921;
const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-uitlijn-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
if (UIT) mkdirSync(UIT, { recursive: true });

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

// In ELK document vóór zijn eigen scripts: tel wat er getekend wordt (per canvas, ook buiten het
// DOM: de tegels) en wie AudioContext, MIDI of een Web Lock aanvraagt. De mixer houdt zijn
// AudioContext (doorgeven), maar MIDI is weg (geen APC in deze proef).
// Het tellen van beelden en verf, los te herhalen: een popup begint als about:blank en houdt bij
// het laden van uitlijn.html hetzelfde window (de globals blijven), maar zijn rAF-lussen niet.
const TEL = `(() => {
  const w = window;
  if (document.__geteld) return; document.__geteld = true;
  w.__teller = w.__teller || { px: 0, n: 0, ac: 0, midi: 0, lock: 0 };
  const vuil = new Set();
  const merk = (proto, namen) => { for (const n of namen) { const o = proto[n]; if (!o) continue;
    proto[n] = function (...a) { vuil.add(this.canvas); return o.apply(this, a); }; } };
  merk(CanvasRenderingContext2D.prototype, ['fillRect','clearRect','strokeRect','drawImage','putImageData','fill','stroke','fillText','strokeText']);
  for (const P of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) if (P) merk(P.prototype, ['drawArrays','drawElements','clear']);
  const tel = () => { for (const c of vuil) { w.__teller.px += c.width * c.height; w.__teller.n++; } vuil.clear(); requestAnimationFrame(tel); };
  requestAnimationFrame(tel);
  w.__fr = 0; (function f() { w.__fr++; requestAnimationFrame(f); })();
})();`;
const HAAK = TEL + `(() => {
  const w = window;
  for (const k of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
    const O = w[k]; if (!O) continue;
    w[k] = new Proxy(O, { construct(T, a) { w.__teller.ac++; return Reflect.construct(T, a); } });
  }
  delete Navigator.prototype.requestMIDIAccess;
  try { Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, get() { w.__teller.midi++; return undefined; } }); } catch (_) {}
  if (navigator.locks) { const r = navigator.locks.request.bind(navigator.locks); navigator.locks.request = (...a) => { w.__teller.lock++; return r(...a); }; }
  // Om na te gaan dat de haak er nog stond toen de scripts van de pagina liepen.
  w.__haakAC = w.AudioContext; w.__haakLocks = navigator.locks?.request;
})();`;

const env = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
  VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_STANDEN: join(tmp, 'standen'),
  VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_HERANALYSE: 'uit', VARVE_STEMS: 'uit' };
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', '--disable-popup-blocking',
  // Headless knijpt requestAnimationFrame anders (tools/headless/tekenen.mjs).
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

// ---- CDP op browserniveau, met een sessie per pagina (ook het popup-venster) ----
let ws, volg = 0;
const wachtend = new Map();
const sessies = new Map();            // sessionId -> { url, fouten: [] }
const fouten = [];
function cdp(method, params = {}, sessionId) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
}
async function ev(sessionId, expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function totdat(s, expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await ev(s, `!!(${expr})`).catch(() => false)) return true; await wacht(100); }
  return false;
}
const checks = [];
const uitkomst = {};
const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const basis = `http://127.0.0.1:${POORT}`;

async function verbind() {
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) { await wacht(150); ver = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = m.params;
      if (targetInfo.type !== 'page') { cdp('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {}); return; }
      sessies.set(sessionId, { url: targetInfo.url, targetId: targetInfo.targetId, fouten: [] });
      await cdp('Page.enable', {}, sessionId).catch(() => {});
      await cdp('Runtime.enable', {}, sessionId).catch(() => {});
      await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HAAK }, sessionId).catch(() => {});
      await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
      await cdp('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
    if (m.method === 'Target.targetInfoChanged') {
      for (const s of sessies.values()) if (s.targetId === m.params.targetInfo.targetId) s.url = m.params.targetInfo.url;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const t = m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text;
      (sessies.get(m.sessionId)?.fouten ?? fouten).push(t);
    }
  });
  await cdp('Target.setDiscoverTargets', { discover: true });
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { targetInfos } = await cdp('Target.getTargets');
  const pagina = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: pagina.targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Performance.enable', {}, sessionId);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HAAK }, sessionId);
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
  sessies.set(sessionId, { url: pagina.url, targetId: pagina.targetId, fouten: [] });
  return sessionId;
}

async function foto(s, naam) {
  if (!UIT) return;
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}

/** Een meting van `sec` seconden in een pagina: Mpx/s getekend, beelden/s. */
async function meet(s, sec) {
  const taak = async () => (await cdp('Performance.getMetrics', {}, s)).metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  const a = await ev(s, '({ px: window.__teller.px, n: window.__teller.n, fr: window.__fr, t: performance.now() })');
  const ta = await taak();
  await wacht(sec * 1000);
  const b = await ev(s, '({ px: window.__teller.px, n: window.__teller.n, fr: window.__fr, t: performance.now() })');
  const tb = await taak();
  const dt = (b.t - a.t) / 1000;
  return { mpx: (b.px - a.px) / dt / 1e6, teken: (b.n - a.n) / dt, fps: (b.fr - a.fr) / dt, sec: dt, taakMsPerS: ((tb - ta) * 1000) / dt };
}

const TEMPO = [124, 128.3, 122, 126, 124, 130, 120, 125];
const DUW_MS = [0, 7, -4, 2.5, 0, -11, 1, 15];

async function hoofd() {
  let t = Date.now();
  while (Date.now() - t < 20000 && !(await fetch(`${basis}/api/library`).then((r) => r.ok).catch(() => false))) await wacht(200);
  const M = await verbind();
  await cdp('Page.navigate', { url: `${basis}/` }, M);
  ok('de mixer staat, met de aanhaker', await totdat(M, 'window.engine && window.varveUitlijn && window.aanhakers', 40000));
  const aanh = await ev(M, 'window.aanhakers.then((u) => ({ gestart: u.gestart, mislukt: u.mislukt.map((m) => m.naam + ": " + (m.fout?.message || m.fout)) }))');
  ok('alle aanhakers gestart, uitlijn ook', aanh.gestart.includes('uitlijn') && !aanh.mislukt.length, JSON.stringify(aanh.mislukt));

  // 1. De knop, en de bovenbalk in rust (zoals tools/headless/maschine-kaart.mjs hem meet).
  const knop = await ev(M, `(() => { const k = document.getElementById('uitlijn-btn'), r = document.querySelector('#focus-deck .deck-transport');
    return { er: !!k, achteraan: !!k && r.lastElementChild === k, tekst: k?.textContent }; })()`);
  ok('een knop "uitlijn" achteraan de transportrij van de focus-track', knop.er && knop.achteraan && knop.tekst === 'uitlijn', JSON.stringify(knop));
  // De rij (flex-wrap) en het focusdeck worden er niet hoger van.
  const kopHoog = async () => ev(M, `(() => { const h = document.querySelector('#focus-deck .deck-transport'), f = document.getElementById('focus-deck'), k = document.getElementById('uitlijn-btn');
    const met = [h.getBoundingClientRect().height, f.getBoundingClientRect().height]; k.style.display = 'none';
    const zonder = [h.getBoundingClientRect().height, f.getBoundingClientRect().height]; k.style.display = '';
    return [Math.round(met[0]), Math.round(zonder[0]), Math.round(met[1]), Math.round(zonder[1])]; })()`);
  for (const [w, h] of [[1440, 900], [1440, 790]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }, M);
    await wacht(300);
    const k = await kopHoog();
    ok(`de transportrij en het focusdeck blijven even hoog op ${w}×${h} (leeg)`, k[0] === k[1] && k[2] === k[3], `rij ${k[0]}/${k[1]}, deck ${k[2]}/${k[3]} px met/zonder`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, M);
  const breed = await ev(M, `(() => { const t = document.querySelector('.topbar'), cs = getComputedStyle(t), k = document.getElementById('uitlijn-btn');
    const nodig = () => Math.ceil(parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (parseFloat(cs.columnGap) || 0)
      + t.querySelector('.brand').getBoundingClientRect().width + t.querySelector('.topbar-right').scrollWidth);
    const met = nodig(); k.style.display = 'none'; const zonder = nodig(); k.style.display = ''; return [met, zonder]; })()`);
  uitkomst.bovenbalk = { met: breed[0], zonder: breed[1] };
  ok('de bovenbalk past in rust nog op 1440 px (met de knop uitlijn)', breed[0] <= 1440, `nodig ${breed[0]} px, zonder de knop ${breed[1]} px`);

  // 2. Acht demotracks, elk met zijn grid, tellen en klappen en peaks; spelen, syncen, duwen.
  await ev(M, `(async () => {
    const e = window.engine; await e.resume();
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { computePeaks } = await import('/src/analysis/peaks.js');
    const tempo = ${JSON.stringify(TEMPO)};
    const ids = ['A','B','C','D','E','F','G','H'];
    for (let k = 0; k < 8; k++) {
      const b = renderDemoTrack(e.ctx, { bpm: tempo[k], bars: 48, seed: k });
      const d = e.deck(ids[k]);
      await d.laadGeheugen(b, k ? 'demo ' + (k + 1) : 'demo 1 · een lange titel, zoals er veel in de library staan (extended mix)');
      window.varveUitlijn.analysis[ids[k]] = computePeaks(b);
      d.setGrid({ stukken: [{ van: 0, bpm: tempo[k], anker: 0, zekerheid: 0.9 }], slot: true });
      const L = 60 / tempo[k], n = Math.floor(b.duration / L);
      const tel = Float64Array.from({ length: n }, (_, i) => i * L);
      d.tellen = { beats: tel, downbeats: tel.filter((_, i) => i % 4 === 0) };
      d.onsets = tel;
    }
    return true; })()`);
  await ev(M, `(() => { const inv = window.varveUitlijn.invoke; for (let n = 1; n <= 8; n++) inv('track.' + n + '.fader', n === 1 ? 1 : 0.75); return true; })()`);
  await ev(M, `(() => { const e = window.engine; for (const id of 'ABCDEFGH') e.deck(id).seek(8); for (const id of 'ABCDEFGH') e.deck(id).play(); return true; })()`);
  await wacht(800);
  const sync = await ev(M, `(() => { const e = window.engine; const r = {}; for (const id of 'BCDEFGH') r[id] = e.sync(id); return r; })()`);
  ok('de zeven anderen synct naar track 1', Object.values(sync).every((x) => x?.ok !== false), JSON.stringify(sync).slice(0, 200));
  await wacht(400);
  await ev(M, `(() => { const e = window.engine, duw = ${JSON.stringify(DUW_MS)}; [...'ABCDEFGH'].forEach((id, k) => { if (duw[k]) e.deck(id).nudge(duw[k] / 1000 * e.deck(id).rate); }); return true; })()`);
  await wacht(300);
  // Elke track in een loop van acht maten: zo speelt alles door, hoe lang de metingen ook duren.
  await ev(M, "(() => { for (const id of 'ABCDEFGH') window.engine.deck(id).setBeatLoop(32); return true; })()");
  await wacht(600);
  const mg = await ev(M, 'window.engine.syncMaster()?.id');
  ok('track 1 geeft de maat', mg === 'A', mg);
  for (const [w, h] of [[1440, 900], [1440, 790]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }, M);
    await wacht(300);
    const k = await kopHoog();
    ok(`… ook met acht tracks en een lange titel op ${w}×${h}`, k[0] === k[1] && k[2] === k[3], `rij ${k[0]}/${k[1]}, deck ${k[2]}/${k[3]} px met/zonder`);
  }
  // Een korte titel op de focus-track: dan moet de knop nog op de eerste regel passen.
  await ev(M, "window.varveUitlijn.invoke('window.L.show.2', true), true");
  await wacht(400);
  for (const [w, h] of [[1440, 900], [1440, 790]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }, M);
    await wacht(300);
    const k = await kopHoog();
    ok(`… en met een korte titel (focus op track 2) op ${w}×${h}`, k[0] === k[1] && k[2] === k[3], `rij ${k[0]}/${k[1]}, deck ${k[2]}/${k[3]} px met/zonder`);
  }
  await ev(M, "window.varveUitlijn.invoke('layer.edit.toggle', true), window.varveUitlijn.invoke('layer.edit.toggle', false), true");
  await wacht(400);
  { const k = await kopHoog(); ok('… en in de grid-modus (meer knoppen in de rij) op 1440×790', k[0] === k[1] && k[2] === k[3], `rij ${k[0]}/${k[1]}, deck ${k[2]}/${k[3]} px`); }
  await ev(M, "window.varveUitlijn.invoke('layer.edit.toggle', true), window.varveUitlijn.invoke('layer.edit.toggle', false), true");
  await ev(M, "window.varveUitlijn.invoke('window.L.show.1', true), true");
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, M);

  // De beeldsnelheid van het hoofdvenster: zonder tweede venster, met een LEEG tweede venster
  // even groot (wat elk venster kost in deze container: de software-GPU wordt gedeeld), en met
  // uitlijn.html. Het verschil tussen leeg en uitlijn is wat de uitlijnweergave kost.
  const nul = await meet(M, 10);
  uitkomst.zonderVenster = nul;
  console.log(`      hoofdvenster zonder tweede venster: ${nul.fps.toFixed(1)} beelden/s, ${nul.mpx.toFixed(2)} Mpx/s, hoofdthread ${nul.taakMsPerS.toFixed(0)} ms/s`);
  const leegMeting = async () => {
    await ev(M, "window.__leeg = window.open('about:blank', 'varve-leeg', 'popup,width=1440,height=640'), true");
    await wacht(1500);
    const m = await meet(M, 10);
    await ev(M, 'window.__leeg.close(), true');
    await wacht(800);
    return m;
  };
  const leeg1 = await leegMeting();
  uitkomst.leeg = leeg1;
  console.log(`      hoofdvenster met een leeg tweede venster: ${leeg1.fps.toFixed(1)} beelden/s, hoofdthread ${leeg1.taakMsPerS.toFixed(0)} ms/s`);

  // 3. uitlijn.html open (pagina-vorm, de standaard).
  await ev(M, 'window.__uitlijnVenster = window.varveUitlijn.open(), true');
  let U = null;
  for (let i = 0; i < 100 && !U; i++) { await wacht(150); for (const [id, s] of sessies) if (s.url.endsWith('/uitlijn.html')) U = id; }
  ok('uitlijn.html gaat open (een venster van de mixer)', !!U);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 640, deviceScaleFactor: 2, mobile: false }, U).catch(() => {});
  ok('het venster tekent acht banen', await totdat(U, "document.querySelectorAll('.ul-baan').length === 8 && window.uitlijn.stats.beelden > 10", 30000),
    String(await ev(U, "document.querySelectorAll('.ul-baan').length").catch(() => '?')));
  // De tellers opnieuw in dit document (de rAF-lussen van about:blank lopen niet door).
  await ev(U, TEL);
  ok('de haak stond er al toen de scripts van uitlijn.html liepen', await ev(U, 'window.AudioContext === window.__haakAC && navigator.locks?.request === window.__haakLocks'));
  await wacht(1500);
  await foto(U, 'uitlijn-pagina.png');

  // De getallen in het DOM tegen engine.faseVerschil (in één taak gelezen, op hetzelfde moment).
  const vgl = await ev(M, `(() => { const w = window.__uitlijnVenster, e = window.engine; const uit = [];
    for (const r of w.document.querySelectorAll('.ul-baan')) { const id = r.dataset.deck; const g = r.querySelector('.ul-g');
      uit.push({ id, dom: g?.dataset.ms === '' || g?.dataset.ms === undefined ? null : Number(g.dataset.ms), tekst: r.querySelector('.ul-info').textContent,
        engine: e.faseVerschil(id) == null ? null : e.faseVerschil(id) * 1000, mg: e.syncMaster()?.id }); }
    return uit; })()`);
  for (const r of vgl) console.log(`      ${r.id}: DOM ${r.dom ?? '–'} ms · engine ${r.engine == null ? '–' : r.engine.toFixed(2)} ms · "${r.tekst}"`);
  uitkomst.getallen = vgl;
  const anderen = vgl.filter((r) => r.id !== r.mg);
  ok('de getallen in het DOM kloppen met engine.faseVerschil binnen 0,5 ms (zeven tracks)',
    anderen.length === 7 && anderen.every((r) => r.dom != null && r.engine != null && Math.abs(r.dom - r.engine) <= 0.5),
    anderen.map((r) => `${r.id} ${(r.dom - r.engine).toFixed(3)}`).join(' '));
  ok('de geduwde tracks staan op hun duw (± 1 ms)', anderen.every((r) => Math.abs(r.dom - DUW_MS['ABCDEFGH'.indexOf(r.id)]) <= 1.0),
    anderen.map((r) => `${r.id} ${r.dom}`).join(' '));
  ok('muziek Δ volgt de duw (de tellen liggen op het grid)', await ev(U, `[...document.querySelectorAll('.ul-baan')].slice(1).every((r) => {
      const m = r.querySelectorAll('.ul-g')[1]; return m.dataset.ms !== '' && Math.abs(Number(m.dataset.ms) - Number(r.querySelector('.ul-g').dataset.ms)) < 1.5; })`));

  // In rust: alles speelt, niemand raakt iets aan.
  const st0 = await ev(U, '({ ...window.uitlijn.stats })');
  const venster = await meet(U, 8);
  const st1 = await ev(U, '({ ...window.uitlijn.stats })');
  const hoofdMet = await meet(M, 6);
  uitkomst.venster = venster; uitkomst.metVenster = hoofdMet;
  const reken = (st1.rekenSom - st0.rekenSom) / Math.max(1, st1.beelden - st0.beelden);
  uitkomst.reken = { gemiddeld: reken, max: st1.rekenMax, beelden: st1.beelden - st0.beelden, tekenbeurten: st1.tekenbeurten - st0.tekenbeurten };
  console.log(`      venster in rust: ${venster.mpx.toFixed(2)} Mpx/s (${venster.teken.toFixed(1)} tekenbeurten/s, ${venster.fps.toFixed(1)} beelden/s); `
    + `rekenwerk ${reken.toFixed(3)} ms per beeld (max ${st1.rekenMax.toFixed(2)}); ${st1.tekenbeurten - st0.tekenbeurten} keer een doek opnieuw`);
  ok('pagina-vorm in rust ≤ 3 Mpx/s getekend (teller op drawImage/fillRect/…, met de tegels)', venster.mpx <= 3, `${venster.mpx.toFixed(2)} Mpx/s`);
  ok('rekenwerk ≤ 0,5 ms per beeld', reken <= 0.5, `${reken.toFixed(3)} ms gemiddeld over ${st1.beelden - st0.beelden} beelden`);
  console.log(`      hoofdvenster met uitlijn.html: ${hoofdMet.fps.toFixed(1)} beelden/s, hoofdthread ${hoofdMet.taakMsPerS.toFixed(0)} ms/s`);

  // 5. Het venster: geen AudioContext, geen MIDI, geen Web Lock.
  const tel = await ev(U, '({ ...window.__teller })');
  ok('uitlijn.html maakt geen AudioContext', tel.ac === 0, JSON.stringify(tel));
  ok('uitlijn.html vraagt geen MIDI en geen Web Lock', tel.midi === 0 && tel.lock === 0);
  ok('de mixer maakte wel zijn eigen AudioContext (de haak telt echt)', (await ev(M, 'window.__teller.ac')) >= 1);

  // De vorm vouw en de strook in het venster: ze tekenen, zonder fouten.
  await ev(U, "document.querySelector('[data-vorm=vouw]').click(), true");
  await wacht(1500);
  await foto(U, 'uitlijn-vouw.png');
  const vouw = await meet(U, 4);
  console.log(`      vouw in rust: ${vouw.mpx.toFixed(2)} Mpx/s`);
  uitkomst.vouw = vouw;
  ok('vouw: tekent alleen bij een nieuwe tel (≤ 3 Mpx/s)', vouw.mpx <= 3, `${vouw.mpx.toFixed(2)} Mpx/s`);
  await ev(U, "document.querySelector('[data-vorm=pagina]').click(), true");

  // 7. Slepen: zonder track.N.phase.offset (spoor S1) gebeurt er niets.
  const heeftDuw = await ev(M, "!!window.varveUitlijn.metaOf('track.2.phase.offset')");
  const voorSleep = await ev(M, "window.engine.faseVerschil('B') * 1000");
  const r = await ev(U, `(() => { const v = document.querySelectorAll('.ul-vlak')[1].getBoundingClientRect(); return { x: v.left + v.width / 2, y: v.top + v.height / 2, w: v.width }; })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, U);
  for (let k = 1; k <= 5; k++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + k * r.w / 80, y: r.y, button: 'left', buttons: 1 }, U); await wacht(30); }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + r.w / 16, y: r.y, button: 'left', clickCount: 1 }, U);
  await wacht(300);
  const naSleep = await ev(M, "window.engine.faseVerschil('B') * 1000");
  if (heeftDuw) ok('slepen duwt de track (track.2.phase.offset, spoor S1)', Math.abs(naSleep - voorSleep) > 5, `${voorSleep.toFixed(2)} → ${naSleep.toFixed(2)} ms`);
  else ok('slepen zonder track.N.phase.offset (spoor S1 nog niet hier): er gebeurt niets', Math.abs(naSleep - voorSleep) < 0.5, `${voorSleep.toFixed(2)} → ${naSleep.toFixed(2)} ms`);

  // Wat het hoofdvenster verliest: HETZELFDE venster afwisselend stil (pauze: geen rekenen, geen
  // tekenen, geen speelkop) en lopend, 4 × 5 s elk; de mediaan van het verschil per paar. Zo valt de
  // last van andere processen op deze machine (de beeldsnelheid zwaait hier van 12 tot 60) weg.
  const paren = [];
  for (let k = 0; k < 4; k++) {
    await ev(U, 'window.uitlijn.pauze = true'); await wacht(400);
    const stil = await meet(M, 5);
    await ev(U, 'window.uitlijn.pauze = false'); await wacht(400);
    const loopt = await meet(M, 5);
    paren.push({ stil: stil.fps, loopt: loopt.fps, taakStil: stil.taakMsPerS, taakLoopt: loopt.taakMsPerS });
    console.log(`      paar ${k + 1}: hoofdvenster ${stil.fps.toFixed(1)} b/s met het venster stil, ${loopt.fps.toFixed(1)} lopend (hoofdthread ${stil.taakMsPerS.toFixed(0)} / ${loopt.taakMsPerS.toFixed(0)} ms/s)`);
  }
  const med = (xs) => { const a = xs.slice().sort((x, y) => x - y); return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2; };
  const verlies = med(paren.map((p) => p.stil - p.loopt));
  uitkomst.paren = paren; uitkomst.verlies = verlies;
  ok('met uitlijn.html open verliest het hoofdvenster < 1 beeld per seconde (mediaan van 4 paren stil/lopend)', verlies < 1, `${verlies.toFixed(2)} beelden/s minder`);

  // Het venster dicht.
  await ev(M, 'window.__uitlijnVenster.close(), true');
  await wacht(800);

  // 6. De strook in het werkvak (toonInWerkvak), in rust.
  // Het werkvak heeft nog geen opmaak (die komt van spoor S3, werk.css): in het raster van main
  // valt het dan onderaan en wordt de pagina hoger. Daarom hier een vaste strook onderaan het
  // venster, over de mixer heen, zodat alleen de weergave gemeten wordt. (UL_WERKVAK=1: het echte #werkvak.)
  await ev(M, `(() => { let w = document.getElementById('werkvak');
    if (!${JSON.stringify(!!process.env.UL_WERKVAK)}) { w = document.createElement('div'); w.id = 'ul-proefvak'; w.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:var(--bg);z-index:50'; document.body.appendChild(w); }
    w.hidden = false; window.__vak = w; window.__strook = window.varveUitlijn.toonInWerkvak(w, 'strook'); return true; })()`);
  ok('de strook (toonInWerkvak): acht banen', await totdat(M, "window.__vak.querySelectorAll('.ul-baan').length === 8", 15000));
  await wacht(1500);
  await foto(M, 'uitlijn-werkvak.png');
  // Afwisselend met en zonder strook (het werkvak blijft open, alleen de weergave gaat weg).
  const sp = [];
  for (let k = 0; k < 3; k++) {
    const met = await meet(M, 5);
    await ev(M, 'window.__strook.stop(), true'); await wacht(400);
    const zonder = await meet(M, 5);
    await ev(M, "window.__strook = window.varveUitlijn.toonInWerkvak(window.__vak, 'strook'), true"); await wacht(1200);
    sp.push({ met, zonder });
    console.log(`      strook paar ${k + 1}: ${met.mpx.toFixed(2)} Mpx/s en ${met.fps.toFixed(1)} b/s met, ${zonder.mpx.toFixed(2)} Mpx/s en ${zonder.fps.toFixed(1)} b/s zonder (hoofdthread ${met.taakMsPerS.toFixed(0)} / ${zonder.taakMsPerS.toFixed(0)} ms/s)`);
  }
  uitkomst.strook = sp;
  const medS = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[(a.length - 1) >> 1]; };
  const erbij = medS(sp.map((p) => p.met.mpx - p.zonder.mpx));
  ok('de strook in rust: ≤ 3 Mpx/s erbij (mediaan van 3 paren)', erbij <= 3, `${erbij.toFixed(2)} Mpx/s erbij`);
  console.log(`      (ter info: ${medS(sp.map((p) => p.zonder.fps - p.met.fps)).toFixed(2)} beelden/s minder met de strook, mediaan)`);
  if (process.env.UL_PROEF) {
    const mut = await ev(M, `new Promise((ok) => { const n = []; const mo = new MutationObserver((ms) => { for (const m of ms) n.push(m.type + ' ' + (m.attributeName || '') + ' ' + (m.target.className || m.target.parentElement?.className) + ' ' + (m.target.textContent || '').slice(0, 20) + ' ' + (m.attributeName ? m.target.getAttribute(m.attributeName) : '')); });
      mo.observe(window.__vak, { subtree: true, attributes: true, childList: true, characterData: true }); setTimeout(() => { mo.disconnect(); ok(n); }, 2000); })`);
    const telM = {}; for (const m of mut) telM[m.replace(/-?[0-9.]+(px)?/g, '#')] = (telM[m.replace(/-?[0-9.]+(px)?/g, '#')] || 0) + 1;
    console.log('      [proef] mutaties in 2 s:', JSON.stringify(telM, null, 1).slice(0, 1500));
    const W = 'window.__strook.weergave';
    console.log('      [proef] stats', JSON.stringify(await ev(M, `({ ...${W}.stats })`)));
    const r = {};
    const spoor = async (naam) => {
      const ev2 = [];
      const luister = (e) => { const m = JSON.parse(e.data); if (m.method === 'Tracing.dataCollected') ev2.push(...m.params.value); };
      ws.addEventListener('message', luister);
      await cdp('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,viz,cc,gpu,blink,v8', transferMode: 'ReportEvents' });
      await wacht(3000);
      const klaar = new Promise((ok) => { const f = (e) => { const m = JSON.parse(e.data); if (m.method === 'Tracing.tracingComplete') { ws.removeEventListener('message', f); ok(); } }; ws.addEventListener('message', f); });
      await cdp('Tracing.end'); await klaar; ws.removeEventListener('message', luister);
      const draden = {}; for (const e of ev2) if (e.ph === 'M' && e.name === 'thread_name') draden[e.pid + ':' + e.tid] = e.args.name;
      const som = {};
      for (const e of ev2) if (e.ph === 'X' && e.dur) { const k = (draden[e.pid + ':' + e.tid] || '?') + ' ' + e.name; som[k] = (som[k] || 0) + e.dur / 1000; }
      console.log(`      [proef] spoor ${naam}:`, Object.entries(som).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' | '));
    };
    await spoor('met strook');
    await ev(M, 'window.__strook.stop(), true'); await wacht(800);
    await spoor('zonder');
    await ev(M, "window.__strook = window.varveUitlijn.toonInWerkvak(window.__vak, 'strook'), true"); await wacht(1000);
    console.log('      [proef] b/s / Mpx/s:', JSON.stringify(r));
    await ev(M, `window.__stand = 'loopt'; ${W}._kop.style.display = ''`);
  }
  await ev(M, 'window.__strook.stop(), true');
  ok('stop() haalt de strook weg', await ev(M, "window.__vak.querySelectorAll('.ul-baan').length === 0"));
  await ev(M, "window.__vak.id === 'werkvak' ? (window.__vak.hidden = true) : window.__vak.remove(), true");

  const alleFouten = [...fouten, ...[...sessies.values()].flatMap((s) => s.fouten)];
  ok('geen fouten in de console (mixer en venster)', alleFouten.length === 0, alleFouten.slice(0, 3).join(' | '));
}

try { await hoofd(); } catch (err) { console.error(err); ok(`script liep door: ${err.message}`, false); }
finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill('SIGKILL'); server.kill('SIGINT');
  await wacht(300);
  if (UIT) writeFileSync(join(UIT, 'uitlijn.json'), JSON.stringify(uitkomst, null, 2));
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = checks.filter(([, g]) => !g).length;
if (rood && serverLog) console.log(`\n[server] ${serverLog.slice(-800)}`);
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlle ${checks.length} checks groen.${UIT ? ` Schermafdrukken in ${UIT}` : ''}`);
process.exit(rood ? 1 : 0);
