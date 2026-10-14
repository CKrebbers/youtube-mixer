// werk.html?s=mac-2 als VENSTER van de mixer (werkruimte S7, docs/werkruimte/S7.md): de echte mixer
// in Chrome, een NEP-APC (bytes -> parseMessage -> mapping.handle, zoals werkruimte.mjs), en
// werk.html als popup van de mixer (window.opener). Loopt de acceptatie van S7 na voor de opener:
//   - een paneel met 4+ items volgt read(): een APC-draai is binnen 1 beeld zichtbaar;
//   - een klik verandert de read in de mixer binnen 1 beeld en staat in het handelingenlog;
//   - loslaten gaat naar dezelfde action, ook na een deelwissel (en focuswissel) tussendoor;
//   - ontbinden laat geen Knob in de renderlijst achter (het werkvak met een paneel weg);
//   - badge en 300 ms oplichten;
//   - werk.html maakt geen AudioContext, vraagt geen MIDI en geen Web Lock;
//   - met `standaard`: het werkvak verborgen en src/paneel/ niet geladen, geen POST naar /api/paneel.
//
// Veiligheid zoals kijk.mjs: requestMIDIAccess gaat eruit vóór de pagina laadt (geen echte APC),
// een EIGEN server met VARVE_TESTSERVER=1 en alle data in een tijdelijke map.
//
// Gebruik:  node tools/headless/werk-scherm.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (server, standaard 8960) en VARVE_KIJK_DEBUG (DevTools, 8961).
// Chrome:   VARVE_CHROME (als root: een wrapper met --no-sandbox), anders de headless shell van Playwright.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
export const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

export function zoekChrome() {
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

/** Een proefwerkruimte: twee delen, een paneel met vijf items, mac-2 en de iPad. Data, zoals Clay hem schrijft. */
export const PROEF = {
  schema: 1, naam: 'proef', titel: 'proef S7',
  deel: { start: 'mix', kiezen: 'expliciet', onthoud: false },
  delen: {
    mix: { label: 'MIX', kleur: 'wit', schermen: {
      hoofd: { werkvak: 'paneel:vier' },
      'mac-2': { vakken: ['paneel:vier', 'kaart', 'stand'] },
      ipad: { vakken: ['stand', 'uitlijn', 'paneel:vier'] } } },
    uitlijn: { label: 'UITLIJN', kleur: 'groen', schermen: {
      hoofd: { werkvak: 'uitlijn-strook' },
      'mac-2': { vakken: ['uitlijn', 'paneel:vier'] },
      ipad: { vakken: ['uitlijn', 'secties', 'paneel:vier'] } } },
    kaal: { label: 'KAAL', kleur: 'grijs', schermen: { hoofd: { werkvak: null } } },
  },
  panelen: {
    vier: { titel: 'VIER', items: [
      { soort: 'draai', action: 'track.1.filter' },
      { soort: 'knop', action: 'track.1.kill.low' },
      { soort: 'knop', action: 'track.{focus}.kill.high.hold', label: 'HOOG WEG' },
      { soort: 'schuif', action: 'track.2.fader' },
      { soort: 'lamp', action: 'track.{focus}.sync' },
      { soort: 'draai', action: 'bestaat.niet' },
    ] },
  },
  schermen: { 'mac-2': { soort: 'venster', plek: 'onthouden' }, ipad: { soort: 'ipad' } },
};

// In ELK document vóór zijn eigen scripts: tel wie AudioContext, MIDI of een Web Lock aanvraagt en
// welke fetch met welke methode gaat. De mixer houdt zijn AudioContext (doorgeven), MIDI is weg.
export const HAAK = `(() => {
  const w = window;
  if (w.__haak) return; w.__haak = true;
  w.__teller = { ac: 0, midi: 0, lock: 0, posts: [], es: 0 };
  for (const k of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
    const O = w[k]; if (!O) continue;
    w[k] = new Proxy(O, { construct(T, a) { w.__teller.ac++; return Reflect.construct(T, a); } });
  }
  delete Navigator.prototype.requestMIDIAccess;
  try { Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, get() { w.__teller.midi++; return undefined; } }); } catch (_) {}
  if (navigator.locks) { const r = navigator.locks.request.bind(navigator.locks); navigator.locks.request = (...a) => { if (!location.pathname.endsWith('/') && !location.pathname.endsWith('index.html')) w.__teller.lock++; return r(...a); }; }
  const f = w.fetch.bind(w);
  w.fetch = (u, o = {}) => { const m = (o.method || 'GET').toUpperCase(); if (m !== 'GET' && m !== 'HEAD') w.__teller.posts.push(m + ' ' + String(u)); return f(u, o); };
  w.__fr = 0; (function fr() { w.__fr++; requestAnimationFrame(fr); })();
})();`;

/**
 * Een server en een Chrome met CDP op browserniveau (een sessie per pagina, ook popups en
 * pagina's in een eigen browsercontext). Geeft { cdp, ev, totdat, nieuwePagina, sessies, stop, … }.
 */
export async function harnas({ poort, debug, naam = 'werk', extraEnv = {}, werkruimtes = [PROEF] } = {}) {
  const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), `varve-${naam}-`));
  const werkMap = join(tmp, 'werkruimtes');
  mkdirSync(werkMap, { recursive: true });
  for (const w of werkruimtes) writeFileSync(join(werkMap, `${w.naam}.json`), JSON.stringify(w, null, 2));
  const env = { ...process.env, PORT: String(poort), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_STANDEN: join(tmp, 'standen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_WERKRUIMTES: werkMap,
    VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_HUB_SETS: join(tmp, 'hub-sets'),
    VARVE_UITZEND_UIT: join(tmp, 'uitzend'), VARVE_HERANALYSE: 'uit', VARVE_STEMS: 'uit', ...extraEnv };
  let server = null, serverLog = '';
  const startServer = () => {
    server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });
    return server;
  };
  const stopServer = () => new Promise((r) => { if (!server || server.exitCode !== null) return r(); server.once('exit', r); server.kill('SIGKILL'); });
  startServer();
  const chrome = spawn(zoekChrome(), [
    `--remote-debugging-port=${debug}`, `--user-data-dir=${join(tmp, 'profiel')}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
    '--autoplay-policy=no-user-gesture-required', '--disable-popup-blocking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(process.getuid?.() === 0 && !process.env.VARVE_CHROME ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: 'ignore' });
  // Ook als deze proef zelf gestopt wordt (timeout, Ctrl+C): geen server of Chrome laten staan.
  const opruimen = () => { try { chrome.kill('SIGKILL'); } catch (_) {} try { server?.kill('SIGKILL'); } catch (_) {} };
  process.once('exit', opruimen);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { opruimen(); process.exit(130); });

  let ws, volg = 0;
  const wachtend = new Map();
  const sessies = new Map();     // sessionId -> { url, targetId, fouten, verzoeken }
  const luisteraars = new Set();
  function cdp(method, params = {}, sessionId) {
    const id = ++volg;
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
  }
  async function ev(s, expr) {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function totdat(s, expr, maxMs = 30000, stap = 50) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) { if (await ev(s, `!!(${expr})`).catch(() => false)) return Date.now() - t0; await wacht(stap); }
    return false;
  }
  const bereidVoor = async (sessionId) => {
    await cdp('Page.enable', {}, sessionId).catch(() => {});
    await cdp('Runtime.enable', {}, sessionId).catch(() => {});
    await cdp('Network.enable', {}, sessionId).catch(() => {});
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HAAK }, sessionId).catch(() => {});
    await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
  };

  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) { await wacht(150); ver = await fetch(`http://127.0.0.1:${debug}/json/version`).then((r) => r.json()).catch(() => null); }
  if (!ver) throw new Error('Chrome start niet (VARVE_CHROME? als root met --no-sandbox)');
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); return; }
    for (const f of luisteraars) { try { f(m); } catch (_) {} }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = m.params;
      if (targetInfo.type !== 'page') { cdp('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {}); return; }
      sessies.set(sessionId, { url: targetInfo.url, targetId: targetInfo.targetId, fouten: [], verzoeken: [] });
      await bereidVoor(sessionId);
      await cdp('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
    if (m.method === 'Target.targetInfoChanged') for (const s of sessies.values()) if (s.targetId === m.params.targetInfo.targetId) s.url = m.params.targetInfo.url;
    const s = sessies.get(m.sessionId);
    if (!s) return;
    if (m.method === 'Runtime.exceptionThrown') s.fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') s.fouten.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Network.requestWillBeSent') s.verzoeken.push({ methode: m.params.request.method, url: m.params.request.url, t: Date.now() });
  });
  await cdp('Target.setDiscoverTargets', { discover: true });
  // Op browserniveau: ook popups (window.open van de mixer) krijgen een sessie.
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  /** Een nieuwe pagina; `context` = een eigen browsercontext (de nep-iPad: geen opener, eigen opslag). */
  async function nieuwePagina(url, { context = false, breed = 1440, hoog = 900, mobiel = false } = {}) {
    let browserContextId;
    if (context) ({ browserContextId } = await cdp('Target.createBrowserContext', { disposeOnDetach: true }));
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    sessies.set(sessionId, { url: 'about:blank', targetId, fouten: [], verzoeken: [] });
    await bereidVoor(sessionId);
    await cdp('Performance.enable', {}, sessionId).catch(() => {});
    await cdp('Emulation.setDeviceMetricsOverride', { width: breed, height: hoog, deviceScaleFactor: mobiel ? 2 : 1, mobile: mobiel }, sessionId);
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
    await cdp('Page.navigate', { url }, sessionId);
    return sessionId;
  }
  /** De sessie van een pagina waarvan de url `deel` bevat (een popup). */
  async function sessieVan(deel, maxMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      for (const [id, s] of sessies) if (s.url.includes(deel)) return id;
      await wacht(100);
    }
    return null;
  }

  const basis = `http://localhost:${poort}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && !(await fetch(`${basis}/api/paneel/kijkers`).then((r) => r.ok).catch(() => false))) await wacht(200);

  async function stop() {
    try { ws?.close(); } catch (_) {}
    await new Promise((r) => { if (chrome.exitCode !== null) return r(); chrome.once('exit', r); chrome.kill('SIGKILL'); });
    await stopServer();
    if (!process.env.VARVE_HOUD) { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (_) {} }
  }
  return { tmp, env, basis, poort, cdp, ev, totdat, nieuwePagina, sessieVan, sessies, luisteraars, stop, stopServer, startServer,
    get serverLog() { return serverLog; } };
}

/** De mixer opgestart, met een nep-APC (window.__apc), N demotracks geladen en spelend. */
export async function mixerKlaar(h, M, { tracks = 2, spelen = true } = {}) {
  const ok = await h.totdat(M, 'window.engine && window.mapping && window.werk && window.werkStart && window.aanhakers', 40000);
  if (!ok) throw new Error('de mixer start niet');
  await h.ev(M, 'window.werkStart.then(() => window.aanhakers)');
  await h.ev(M, `(async () => { const { parseMessage } = await import('/src/control/midi.js');
    window.__apc = (...b) => window.mapping.handle(parseMessage(new Uint8Array(b))); return true; })()`);
  await h.ev(M, `(async () => {
    const e = window.engine; await e.resume();
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const ids = ['A','B','C','D','E','F','G','H'];
    for (let k = 0; k < ${tracks}; k++) {
      const b = renderDemoTrack(e.ctx, { bpm: 124, bars: 64, seed: k });
      const d = e.deck(ids[k]);
      await d.laadGeheugen(b, 'demo ' + (k + 1));
      d.setGrid({ stukken: [{ van: 0, bpm: 124, anker: 0, zekerheid: 0.9 }], slot: true });
    }
    return true; })()`);
  if (spelen) await h.ev(M, `(() => { const e = window.engine; for (const id of 'AB'.slice(0, ${tracks})) e.deck(id).play(); return true; })()`);
}

// ---- de proef zelf (alleen als dit bestand gestart wordt) -------------------------------------
async function proef() {
  const UIT = process.argv[2] || null;
  if (UIT) mkdirSync(UIT, { recursive: true });
  const poort = Number(process.env.VARVE_KIJK_POORT) || 8960, debug = Number(process.env.VARVE_KIJK_DEBUG) || 8961;
  const h = await harnas({ poort, debug, naam: 'werk-scherm' });
  const checks = [];
  const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
  const foto = async (s, naam) => { if (!UIT) return; const { data } = await h.cdp('Page.captureScreenshot', { format: 'png' }, s); writeFileSync(join(UIT, naam), Buffer.from(data, 'base64')); };
  try {
    // ---- standaard: niets ------------------------------------------------------------------
    console.log('standaard (geen werkruimte)');
    const M0 = await h.nieuwePagina(`${h.basis}/?werk=standaard`);
    await mixerKlaar(h, M0, { tracks: 1, spelen: false });
    await wacht(2500);
    const st0 = await h.ev(M0, `({ verborgen: document.getElementById('werkvak').hidden, hoog: document.getElementById('werkvak').getBoundingClientRect().height,
      geladen: window.varveSchermen?.geladen?.(), zender: !!window.varveSchermen?.zender,
      paneel: performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/paneel/')).map((r) => r.name) })`);
    ok('het werkvak is verborgen (hidden, 0 px)', st0.verborgen && st0.hoog === 0);
    ok('src/paneel/ niet geladen, geen zender', !st0.geladen && !st0.zender && st0.paneel.length === 0, st0.paneel.join(', '));
    const pv0 = h.sessies.get(M0).verzoeken.filter((v) => v.url.includes('/api/paneel/'));
    ok('geen enkel verzoek naar /api/paneel/', pv0.length === 0, pv0.map((v) => v.methode + ' ' + v.url).join(', '));
    await h.cdp('Target.closeTarget', { targetId: h.sessies.get(M0).targetId });
    await wacht(500);

    // ---- de proefwerkruimte ---------------------------------------------------------------
    console.log('\nwerkruimte proef: het werkvak in de mixer');
    const M = await h.nieuwePagina(`${h.basis}/?werk=proef`);
    await mixerKlaar(h, M, { tracks: 2 });
    ok('werkruimte proef, deel mix', await h.totdat(M, "window.werk.naam === 'proef' && window.werk.deel === 'mix'", 8000) !== false);
    ok('het werkvak toont paneel:vier', await h.totdat(M, "window.varveSchermen.werkvak()?.startsWith('paneel:vier') && !document.getElementById('werkvak').hidden && document.querySelectorAll('#werkvak .vp-item').length === 6", 8000) !== false);
    const reg = await h.ev(M, 'window.varveSchermen.aangemeld()');
    ok('het paneel in het werkvak meldt zijn Knobs en faders aan bij de renderloop (bind)', reg.groepen === 1, JSON.stringify(reg));
    // Een fader in het werkvak volgt read(): de APC-fader van track 2 bewegen.
    await h.ev(M, "window.varvePaneel.invoke('track.2.fader', 0.3), true");
    await wacht(200);
    const fader = await h.ev(M, "(() => { const f = document.querySelector('#werkvak input[type=range]'); return { v: +f.value, read: window.varvePaneel.read('track.2.fader') }; })()");
    ok('de schuif in het werkvak volgt de fader (renderloop)', Math.abs(fader.v - fader.read) < 0.01, JSON.stringify(fader));
    await foto(M, 'werk-scherm-mixer.png');
    // Een deel zonder werkvak: ontbinden, en dan staat er niets meer van in de renderlijst.
    await h.ev(M, "window.varvePaneel.invoke('werk.deel.kaal', true), window.varvePaneel.invoke('werk.deel.kaal', false), true");
    ok('deel kaal: het werkvak verborgen', await h.totdat(M, "document.getElementById('werkvak').hidden && window.varveSchermen.werkvak() === null", 5000) !== false);
    const reg2 = await h.ev(M, 'window.varveSchermen.aangemeld()');
    ok('ontbinden: geen Knob of fader van het paneel meer in de renderlijst', reg2.groepen === 0 && reg2.knobs === reg.knobs - 2 && reg2.faders === reg.faders - 1,
      `${JSON.stringify(reg)} -> ${JSON.stringify(reg2)}`);
    await h.ev(M, "window.varvePaneel.invoke('werk.deel.mix', true), window.varvePaneel.invoke('werk.deel.mix', false), true");
    await h.totdat(M, "window.varveSchermen.werkvak()?.startsWith('paneel:vier')", 5000);

    // ---- mac-2 als popup ------------------------------------------------------------------
    console.log('\nwerk.html?s=mac-2 als venster van de mixer');
    await h.ev(M, "window.open('werk.html?s=mac-2', 'varve-werk-mac-2', 'popup,width=1280,height=760') && true");
    const W = await h.sessieVan('werk.html');
    ok('het venster is open', !!W);
    ok('het toont het paneel (6 items) en de kaart', await h.totdat(W, "document.querySelectorAll('.vp-item').length === 6 && document.querySelector('.wk-kaart')", 10000) !== false);
    const soort = await h.ev(W, "({ soort: window.paneel.verb.soort, kop: document.getElementById('wp-deel').textContent, kan: window.paneel.verb.kanBedienen })");
    ok('via de opener, mag bedienen, deel MIX in de kop', soort.soort === 'opener' && soort.kan && soort.kop === 'MIX', JSON.stringify(soort));
    const grijs = await h.ev(W, "[...document.querySelectorAll('.vp-item.vp-grijs')].map((e) => e.title)");
    ok('een onbekende action is grijs (en alleen die)', grijs.length === 1 && grijs[0].includes('bestaat.niet'), JSON.stringify(grijs));
    const meldingen = await h.ev(M, "[...document.querySelectorAll('.melding')].map((e) => e.textContent).filter((t) => t.includes('bestaat.niet')).length");
    ok('… met één melding in de mixer', meldingen === 1, String(meldingen));

    // Een APC-draai (track knob 1 = track.1.filter, endless) en de wijzer in werk.html: binnen 1 beeld.
    await h.ev(W, `(() => { const it = window.paneel.vakken[0].paneel.items[0]; window.__w = { it, sinds: null, gezien: null, start: it.waarde, licht: null, uit: null, t0: 0 };
      (function kijk() { const w = window.__w;
        if (w.sinds !== null && w.gezien === null && it.waarde !== w.start) { w.gezien = window.__fr; w.licht = it.el.classList.contains('vp-geraakt'); }
        if (w.gezien !== null && w.uit === null && !it.el.classList.contains('vp-geraakt')) w.uit = performance.now() - w.t0;
        requestAnimationFrame(kijk); })(); return true; })()`);
    const voor = await h.ev(M, "window.varvePaneel.read('track.1.filter')");
    const r1 = await h.ev(W, `(async () => {
      const o = window.opener; const w = window.__w; w.start = w.it.waarde;
      o.__apc(0xB0, 48, 64); o.__apc(0xB0, 48, 80); w.sinds = window.__fr; w.t0 = performance.now();
      for (let i = 0; i < 40 && w.gezien === null; i++) await new Promise((r) => requestAnimationFrame(r));
      const t = performance.now(); while (w.uit === null && performance.now() - t < 1500) await new Promise((r) => requestAnimationFrame(r));
      return { beelden: w.gezien === null ? null : w.gezien - w.sinds, read: o.varvePaneel.read('track.1.filter'), licht: w.licht, uit: w.uit }; })()`);
    // __fr telt aan het begin van elk beeld: 0 = zichtbaar in het eerstvolgende beeld, 1 = het beeld daarna.
    ok('een APC-draai is binnen 1 beeld zichtbaar in werk.html', r1.beelden !== null && r1.beelden <= 1, `${r1.beelden === 0 ? 'in het eerstvolgende beeld' : `${r1.beelden} beeld(en) later`}, filter ${voor?.toFixed?.(3)} -> ${r1.read?.toFixed?.(3)}`);
    ok('oplichten: in hetzelfde beeld aan, na ~300 ms weer uit', r1.licht === true && r1.uit >= 280 && r1.uit < 450, `aan ${r1.licht}, uit na ${r1.uit?.toFixed?.(0)} ms`);
    const badge = await h.ev(W, "window.paneel.vakken[0].paneel.items[0].badgeEl.textContent");
    ok('badge: welke APC-knob ernaar wijst', /^APC /.test(badge), badge);
    const pBadge = await h.ev(W, "document.querySelector('.vp-badge').textContent");
    ok('badge op het paneel (per apparaat)', pBadge.includes('APC'), pBadge);

    // Een klik op de knop track.1.kill.low: de read in de mixer, binnen 1 beeld, en in het log.
    await h.ev(M, "(async () => { await window.engine.resume(); if (!window.logboek.log.sessie) { window.varvePaneel.invoke('log.toggle', true); window.varvePaneel.invoke('log.toggle', false); } return true; })()");
    await h.totdat(M, 'window.logboek.log.sessie', 5000);
    const midden = async (sel) => h.ev(W, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const muis = (type, p) => h.cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' }, W);
    const k1 = await midden('.vp-item:nth-child(2) .vp-knop');
    const killVoor = await h.ev(M, "window.varvePaneel.read('track.1.kill.low')");
    await h.ev(W, 'window.__f0 = window.__fr, true');
    await muis('mousePressed', k1);
    const killNa = await h.ev(W, "({ v: window.opener.varvePaneel.read('track.1.kill.low'), beelden: window.__fr - window.__f0 })");
    await muis('mouseReleased', k1);
    ok('een klik verandert de read in de mixer binnen 1 beeld', killVoor !== killNa.v && killNa.beelden <= 1, `${killVoor} -> ${killNa.v}, ${killNa.beelden} beeld(en)`);
    const log1 = await h.ev(M, "window.logboek.log.buffer.join('\\n')");
    ok('… en staat in het handelingenlog', /"track\.1\.kill\.low",true/.test(log1) && /"track\.1\.kill\.low",false/.test(log1));

    // Loslaten naar dezelfde action, ook na een deelwissel en een focuswissel tussendoor.
    const k2 = await midden('.vp-item:nth-child(3) .vp-knop');
    await muis('mousePressed', k2);
    const tijdens = await h.ev(M, "window.varvePaneel.read('track.1.kill.high')");
    await h.ev(M, "(() => { const i = window.varvePaneel.invoke; i('window.L.show.2', true); i('window.L.show.2', false); i('werk.deel.uitlijn', true); i('werk.deel.uitlijn', false); return true; })()");
    await wacht(300);
    const focusNu = await h.ev(M, 'window.engine.focus');
    await muis('mouseReleased', k2);
    await wacht(100);
    const na = await h.ev(M, "({ k1: window.varvePaneel.read('track.1.kill.high'), k2: window.varvePaneel.read('track.2.kill.high'), log: window.logboek.log.buffer.join('\\n'), deel: window.werk.deel })");
    ok('loslaten na een deel- en focuswissel: naar dezelfde action (track 1), track 2 onaangeroerd',
      tijdens === 1 && focusNu === 'B' && na.deel === 'uitlijn' && na.k1 === 0 && na.k2 === 0
      && /"track\.1\.kill\.high\.hold",true/.test(na.log) && /"track\.1\.kill\.high\.hold",false/.test(na.log) && !/track\.2\.kill\.high\.hold/.test(na.log),
      `tijdens ${tijdens}, focus ${focusNu}, deel ${na.deel}, na ${na.k1}/${na.k2}`);
    ok('werk.html volgt het deel (uitlijn: de uitlijnweergave)', await h.totdat(W, "document.getElementById('wp-deel').textContent === 'UITLIJN' && document.querySelector('.wp-vak-uitlijn .ul')", 5000) !== false);
    await foto(W, 'werk-scherm-mac2.png');

    // Geen geluid, geen MIDI, geen Web Lock in werk.html; nul POST's van werk.html zelf.
    const t = await h.ev(W, 'window.__teller');
    ok('werk.html: geen AudioContext, geen requestMIDIAccess, geen Web Lock', t.ac === 0 && t.midi === 0 && t.lock === 0, JSON.stringify({ ac: t.ac, midi: t.midi, lock: t.lock }));
    const posts = h.sessies.get(W).verzoeken.filter((v) => v.methode !== 'GET' && v.methode !== 'HEAD');
    ok('werk.html doet zelf geen enkele POST (bedienen gaat over de bus van de mixer)', posts.length === 0, posts.map((p) => p.url).join(', '));
    const es = h.sessies.get(W).verzoeken.filter((v) => v.url.includes('/api/paneel/'));
    ok('… en praat als venster niet met de server (geen SSE)', es.length === 0, es.map((v) => v.url).join(', '));
    const fouten = [...h.sessies.values()].flatMap((s) => s.fouten).filter((f) => !/WebSocket|ERR_CONNECTION|favicon/.test(f));
    ok('geen fouten in de console', fouten.length === 0, fouten.slice(0, 3).join(' | '));
  } finally {
    await h.stop();
  }
  const fout = checks.filter(([, c]) => !c);
  console.log(fout.length ? `\n${fout.length} van ${checks.length} FOUT` : `\nAlles groen (${checks.length}).`);
  process.exit(fout.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) proef().catch((e) => { console.error(e); process.exit(1); });
