// Lag van knop tot geluid en scherm, gemeten in echte (headless) Chrome met de
// echte mixer en een NEP-APC (docs/verslagen/2026-10-14/controller-invoer.md).
//
// Wat het doet:
//   - een eigen server (tijdelijke database, media, opnames, patronen, plannen,
//     standen) en een eigen Chrome; dit tabblad kan geen echte APC zien;
//   - navigator.requestMIDIAccess is NEP vóór de pagina laadt: één invoerpoort
//     "APC40 mkII" en één uitvoerpoort. De mixer kiest hem zelf, dus elk bericht
//     gaat door het ECHTE pad: onmidimessage -> MidiHub._onMessage -> 'message'
//     (monitor) -> onInput -> mapping.handle -> invoke -> engine, plus
//     spiegel.markeer en wat er verder per bericht gebeurt;
//   - de berichten komen uit een Worker op hun eigen tijd (Atomics.wait), elk als
//     eigen taak op de hoofdthread, zoals Chrome MIDI aflevert. Hun timeStamp is
//     het moment van versturen, dus "wacht" = hoe lang het bericht in de rij
//     stond omdat de hoofdthread bezig was;
//   - acht tracks met de demotrack (eigen grid), spelend, alle rijen open, het
//     videopaneel open.
//
// Per scenario: wacht (ts -> handler begint), werk (de handler zelf), tot de
// eerste AudioParam- of worklet-aanroep (ts -> geluid gepland), tot het scherm
// (ts -> de fader op het scherm staat goed, gezien aan het eind van een rAF),
// lange taken, de duur van elke rAF-callback (renderloop, monitor, ...) en, voor
// de fader-sweep, een CPU-profiel (wat kost het meest).
//
// Gebruik:  VARVE_CHROME=<headless_shell> node tools/headless/latentie.mjs [--label voor] [--uit pad.json]
//           [--duur 3000] [--scenario fader,sweep,...] [--profiel rust,sweep] [--rijen 0] [--video 1]
//           [--zaad 1] [--jitter 0]   (het berichtenplan: latentie-plan.mjs; zelfde zaad = zelfde plan)
//           node tools/headless/latentie.mjs --vergelijk voor.json na.json      (of voor1.json,voor2.json na1.json,na2.json: mediaan)
// Andere app (vóór/na): VARVE_WORTEL=<map met een uitgepakte versie> (de server en de pagina komen dan daarvandaan).
// Poorten: VARVE_LAT_POORT (server, 8841), VARVE_LAT_DEBUG (DevTools, 8842), VARVE_LAT_HUB (hub, 7741).
//
// Via de AV-app-hub (--hub, met VARVE_HUB_REPO = een kopie van de hub MET node_modules): de echte hub draait in
// dit proces met een nep-APC (NepSysteem); de pagina opent met ?hub=. Elk bericht gaat dan apc.injecteer ->
// kern -> WebSocket -> hub.js -> MidiHub. "wacht" is dan van het injecteren in de hub tot de handler in de
// pagina begint (hub + WebSocket + de rij op de hoofdthread); de klokken worden via CDP gelijkgezet (±0,5 ms).
// Met de hub: GPU staat standaard uit (software), zoals zonder.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakPlan, UITLEG } from './latentie-plan.mjs';

const args = process.argv.slice(2);
const optie = (naam, standaard = null) => { const i = args.indexOf(`--${naam}`); return i >= 0 ? args[i + 1] : standaard; };
const vlag = (naam) => args.includes(`--${naam}`);

// ---- vergelijken: twee uitkomsten naast elkaar ------------------------------
if (vlag('vergelijk')) {
  const i = args.indexOf('--vergelijk');
  // Per kant één bestand of een komma-lijst (meerdere rondes): dan de MEDIAAN van elk getal over de rondes.
  const [ra, rb] = [args[i + 1], args[i + 2]].map((lijst) => lijst.split(',').map((p) => JSON.parse(readFileSync(p, 'utf8'))));
  console.log(vergelijk(samen(ra), samen(rb)));
  // Met meerdere rondes ook het BEREIK per ronde (min–max), zodat te zien is of de twee kanten overlappen.
  if (ra.length > 1 || rb.length > 1) console.log('\n' + bereik(ra, rb));
  process.exit(0);
}

const HIER = fileURLToPath(new URL('../..', import.meta.url));
const WORTEL = process.env.VARVE_WORTEL || HIER;
const LABEL = optie('label', 'meting');
const UIT = optie('uit');
const DUUR = Number(optie('duur', 3000));
const PROFIEL = (optie('profiel') || '').split(',').filter(Boolean);
// --spoor rust,sweep: een Chrome-trace (devtools.timeline + invalidationTracking) tijdens dat scenario, samengevat:
// hoeveel elementen elke stijlberekening raakte en WAT de stijl ongeldig maakte (element + reden).
const SPOOR = (optie('spoor') || '').split(',').filter(Boolean);
const RIJEN = optie('rijen', '1') !== '0';
// Het videopaneel (WebGL) staat standaard DICHT: in deze container rendert SwiftShader het op de CPU, de
// GPU-process at dan drie kernen op en de frames zakten naar ~6/s. Op de Mac doet de GPU dat.
const VIDEO = optie('video', '0') !== '0';
const HUBMODUS = vlag('hub');
const HUBPOORT = Number(process.env.VARVE_LAT_HUB) || 7741;
let hubStop = null;   // bovenaan: startEchteHub zet hem al tijdens het opstarten
const POORT = Number(process.env.VARVE_LAT_POORT) || 8841, DEBUG = Number(process.env.VARVE_LAT_DEBUG) || 8842;
const basis = process.env.VARVE_TMP || tmpdir();
mkdirSync(basis, { recursive: true });
const tmp = mkdtempSync(join(basis, 'varve-latentie-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

// De plannen (wat er wanneer verstuurd wordt) staan in latentie-plan.mjs, puur en getest
// (test/latentie-plan.test.mjs). JITTER (review ronde 1): elke ronde een eigen beginfase en elk bericht
// een eigen verschuiving, uit een vast zaad (--zaad, standaard 1); --jitter 0 = het oude vaste rooster.
// Draai vóór en na met hetzelfde zaad in dezelfde ronde: dan krijgen ze exact dezelfde berichten.
const ZAAD = Number(optie('zaad', '1')) >>> 0;
const JITTER = optie('jitter', '1') !== '0';
const SCENARIOS = Object.fromEntries(Object.entries(UITLEG).map(([naam, uitleg]) => [naam, { uitleg }]));

// ---- in de pagina, vóór alles: nep-MIDI en de meters ------------------------
const VOORAF = String.raw`(() => {
  const T = window.__lat = { meet: false, berichten: [], raf: {}, frames: [], longtasks: [], tx: 0, inBericht: false, paramT: 0, scherm: [], wachtScherm: new Map() };
  // Elke rAF-callback getimed, op naam (renderloop = frame, monitor = tick, ...).
  const echteRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => echteRaf((ts) => {
    const t0 = performance.now();
    try { fn(ts); } finally {
      if (T.meet) { const k = fn.name || 'anoniem'; (T.raf[k] ||= []).push(performance.now() - t0); }
    }
  });
  // Het eerste moment dat er geluid gepland wordt: een AudioParam of een bericht naar een worklet.
  const merk = () => { if (T.inBericht && !T.paramT) T.paramT = performance.now(); };
  for (const m of ['setTargetAtTime', 'setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues', 'setValueCurveAtTime']) {
    const o = AudioParam.prototype[m];
    AudioParam.prototype[m] = function (...a) { merk(); return o.apply(this, a); };
  }
  const pm = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (...a) { merk(); return pm.apply(this, a); };
  try {
    new PerformanceObserver((l) => { if (T.meet) for (const e of l.getEntries()) T.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false });
  } catch (_) {}

  // De nep-APC.
  let h = null;
  const pin = { id: 'nep-apc-in', name: 'APC40 mkII', manufacturer: 'Akai', type: 'input', state: 'connected', connection: 'open', onstatechange: null,
    addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(pin, 'onmidimessage', { get: () => h, set: (f) => { h = f; }, enumerable: true });
  const pout = { id: 'nep-apc-uit', name: 'APC40 mkII', manufacturer: 'Akai', type: 'output', state: 'connected', connection: 'open', onstatechange: null,
    send() { T.tx++; }, addEventListener() {}, removeEventListener() {} };
  const access = { inputs: new Map([[pin.id, pin]]), outputs: new Map([[pout.id, pout]]), sysexEnabled: true, onstatechange: null,
    addEventListener() {}, removeEventListener() {} };
  navigator.requestMIDIAccess = async () => access;
  T.poort = pin;

  // Via de hub: de berichten komen uit hub.js (WebSocket), niet uit de nep-poort. Dan meten we in MidiHub zelf.
  T.hubLuister = () => {
    const m = window.midi, echt = m._onMessage.bind(m);
    m._onMessage = (port, e) => {
      const t0 = performance.now();
      T.inBericht = true; T.paramT = 0;
      try { echt(port, e); } finally {
        T.inBericht = false;
        const t1 = performance.now(), d = e.data;
        if (T.meet) {
          T.berichten.push([null, t0, t1, T.paramT, d[0], d[1], d[2]]);
          if ((d[0] & 0xf0) === 0xb0 && d[1] === 7 && T.paramT) { const k = d[0] & 0x0f; if (!T.wachtScherm.has(k)) T.wachtScherm.set(k, []); T.wachtScherm.get(k).push({ ts: t0, v: d[2] / 127, i: T.berichten.length - 1 }); }
        }
      }
    };
  };

  T.lever = (a, b, c, ts) => {
    const t0 = performance.now();
    if (!a) { if (T.meet) T.berichten.push([ts, t0, t0, 0, 0, 0, 0]); return; }    // ping
    if (!h) return;
    T.inBericht = true; T.paramT = 0;
    try { h({ data: new Uint8Array([a, b, c]), timeStamp: ts }); }
    finally {
      T.inBericht = false;
      const t1 = performance.now();
      if (T.meet) {
        T.berichten.push([ts, t0, t1, T.paramT, a, b, c]);
        // Een kanaalfader die iets deed (geluid gepland; los door soft-takeover telt niet): wanneer staat hij op het scherm goed?
        if ((a & 0xf0) === 0xb0 && b === 7 && T.paramT) { const k = a & 0x0f; if (!T.wachtScherm.has(k)) T.wachtScherm.set(k, []); T.wachtScherm.get(k).push({ ts, v: c / 127 }); }
      }
    }
  };

  // Het plan afspelen vanuit een Worker: elk bericht een eigen taak, op zijn tijd.
  const BRON = 'onmessage = (e) => {' +
    ' const { plan, sab } = e.data; const i32 = sab ? new Int32Array(sab) : null; const t0 = performance.now() + 30;' +
    ' for (const [dt, a, b, c] of plan) { const due = t0 + dt; let w;' +
    '   while ((w = due - performance.now()) > 0.05) { if (i32) Atomics.wait(i32, 0, 0, Math.max(0, w - 0.03)); }' +
    '   postMessage([performance.timeOrigin + performance.now(), a, b, c]); }' +
    ' postMessage("klaar"); };';
  T.speel = (plan) => new Promise((klaar) => {
    const w = new Worker(URL.createObjectURL(new Blob([BRON], { type: 'text/javascript' })));
    w.onmessage = (e) => {
      if (e.data === 'klaar') { w.terminate(); klaar(); return; }
      const [abs, a, b, c] = e.data;
      T.lever(a, b, c, abs - performance.timeOrigin);
    };
    w.postMessage({ plan, sab: typeof SharedArrayBuffer === 'function' && self.crossOriginIsolated ? new SharedArrayBuffer(4) : null });
  });

  // Elke frame, na de renderloop: staat een gewachte fader al goed op het scherm?
  T.wachter = () => {
    const nu = performance.now();
    if (T.meet) {
      if (T.vorigeFrame) T.frames.push(nu - T.vorigeFrame);
      // Staat de fader op de waarde van het LAATSTE bericht, dan zijn alle wachtende berichten
      // van die fader nu te zien (of ingehaald): elk krijgt nu - zijn eigen ts.
      for (const [k, lijst] of T.wachtScherm) {
        if (!lijst.length) continue;
        const el = document.querySelector('.kol input.spg-fader[data-sig="cc:' + k + ':7"]');
        if (el && Math.abs(parseFloat(el.value) - lijst[lijst.length - 1].v) < 0.004) { for (const w of lijst) T.scherm.push(nu - w.ts); lijst.length = 0; }
      }
    }
    T.vorigeFrame = nu;
    echteRaf(T.wachter);
  };
})();`;

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
  VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_SETS: join(tmp, 'sets'),
  VARVE_STANDEN: join(tmp, 'standen'), VARVE_HERANALYSE: 'uit' };
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { env, stdio: 'ignore' });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  ...(process.env.VARVE_LAT_GPU === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu', '--disable-gpu-compositing']),
  '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', '--no-sandbox', 'about:blank',
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
async function totDat(expr, maxMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(100); }
  return false;
}

let spoorEvents = null;
async function startSpoor() {
  spoorEvents = [];
  ws.addEventListener('message', spoorLuister);
  await cdp('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline',
    'disabled-by-default-devtools.timeline.invalidationTracking', 'blink'], recordMode: 'recordAsMuchAsPossible' } });
}
function spoorLuister(e) {
  const m = JSON.parse(e.data);
  if (m.method === 'Tracing.dataCollected') spoorEvents.push(...m.params.value);
  if (m.method === 'Tracing.tracingComplete') spoorEvents.klaar?.();
}
async function stopSpoor() {
  const klaar = new Promise((r) => { spoorEvents.klaar = r; });
  await cdp('Tracing.end');
  await klaar;
  ws.removeEventListener('message', spoorLuister);
  const ev = spoorEvents;
  const hoofd = ev.find((x) => x.name === 'CrRendererMain' || (x.name === 'thread_name' && x.args?.name === 'CrRendererMain'));
  const tid = hoofd?.tid;
  const opHoofd = ev.filter((x) => x.tid === tid);
  const stijl = opHoofd.filter((x) => x.name === 'UpdateLayoutTree' && x.ph === 'X');
  const opmaak = opHoofd.filter((x) => x.name === 'Layout' && x.ph === 'X');
  const verf = opHoofd.filter((x) => (x.name === 'Paint' || x.name === 'PaintImage' || x.name === 'Layerize' || x.name === 'UpdateLayer' || x.name === 'PrePaint' || x.name === 'Commit') && x.ph === 'X');
  const somMs = (xs) => r2(xs.reduce((a, x) => a + (x.dur || 0), 0) / 1000);
  // Wie maakte de stijl ongeldig: element (naam, id, klasse) en reden, geteld.
  const reden = new Map();
  for (const x of opHoofd) {
    if (!/InvalidationTracking/.test(x.name)) continue;
    const d = x.args?.data || {};
    const k = `${x.name.replace('InvalidationTracking', '')} · ${d.reason || d.changedClass || d.changedAttribute || d.changedId || d.changedPseudo || d.invalidatedSelectorId || '?'} · ${(d.nodeName || '').slice(0, 60)}`;
    reden.set(k, (reden.get(k) || 0) + 1);
  }
  const elementen = stijl.map((x) => x.args?.elementCount ?? x.args?.data?.elementCount).filter((n) => typeof n === 'number');
  const naamTel = new Map();
  for (const x of opHoofd) if (x.ph === 'X' && x.dur) naamTel.set(x.name, (naamTel.get(x.name) || 0) + x.dur);
  return {
    stijl: { n: stijl.length, ms: somMs(stijl), elementen: stat(elementen) },
    opmaak: { n: opmaak.length, ms: somMs(opmaak) },
    verf: { n: verf.length, ms: somMs(verf) },
    duurste: [...naamTel].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, us]) => [k, r2(us / 1000)]),
    redenen: [...reden].sort((a, b) => b[1] - a[1]).slice(0, 25),
  };
}

/** Wat de hoofdthread deed (CDP Performance, seconden sinds het begin). */
async function metrieken() {
  const { metrics } = await cdp('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  // Met timeDomain threadTicks zijn de duren THREADtijd: een drukke machine (andere processen) telt niet mee.
  return { taak: m.TaskDuration, script: m.ScriptDuration, opmaak: m.LayoutDuration, stijl: m.RecalcStyleDuration,
    opmaakN: m.LayoutCount / 1000, stijlN: m.RecalcStyleCount / 1000 };
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const stat = (xs) => ({ n: xs.length, p50: r2(pct(xs, 50)), p90: r2(pct(xs, 90)), p99: r2(pct(xs, 99)), max: r2(xs.length ? Math.max(...xs) : null) });

/** Een CPU-profiel tot zelftijd per functie (ms), de duurste eerst. */
function zelftijd(profiel, top = 25) {
  const dt = (profiel.endTime - profiel.startTime) / 1000 / Math.max(1, profiel.samples.length);   // ms per sample
  const tel = new Map();
  for (const n of profiel.nodes) {
    if (!n.hitCount) continue;
    const cf = n.callFrame;
    const url = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '') : '';
    const k = `${cf.functionName || '(anoniem)'} ${url}${url ? `:${cf.lineNumber + 1}` : ''}`;
    tel.set(k, (tel.get(k) || 0) + n.hitCount * dt);
  }
  const totaal = [...tel.values()].reduce((a, b) => a + b, 0);
  const lijst = [...tel].sort((a, b) => b[1] - a[1]);
  const idle = tel.get('(idle) ') || 0;
  return { totaalMs: r2(totaal), bezigMs: r2(totaal - idle - (tel.get('(program) ') || 0)), top: lijst.slice(0, top).map(([k, ms]) => [k, r2(ms)]) };
}

const uitkomst = { label: LABEL, wortel: WORTEL, duurMs: DUUR, rijen: RIJEN, video: VIDEO, hub: HUBMODUS, zaad: ZAAD, jitter: JITTER, scenarios: {}, omgeving: {} };
try {
  let doelen = null;
  for (let i = 0; i < 60 && !doelen; i++) {
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
  uitkomst.tijd = await cdp('Performance.enable', { timeDomain: 'threadTicks' }).then(() => 'threadTicks', () => cdp('Performance.enable').then(() => 'timeTicks'));
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: VOORAF });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 60; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  let hub = null;
  if (HUBMODUS) hub = await startEchteHub();
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0${hub ? `&hub=${encodeURIComponent(hub.url)}` : ''}` });
  if (!await totDat('window.engine && window.mapping && window.midi && window.mapping.rules.size > 100', 30000)) throw new Error('de app start niet (of de mapping komt niet binnen)');
  if (hub) {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !hub.echt.kern.beeld().apps.some((a) => a.app === 'varve-dj' && a.status === 'actief')) await wacht(100);
    hub.echt.kern.focus('varve-dj');
    if (!await totDat('window.midi.input() && window.midi.focus', 10000)) throw new Error('VARVE krijgt geen focus van de hub');
    await evalueer('window.__lat.hubLuister()');
    hub.offset = await klokVerschil();
  } else if (!await totDat('window.midi.input() && window.__lat.poort.onmidimessage', 10000)) throw new Error('de nep-APC wordt niet gekozen');

  // Acht tracks met de demotrack (eigen zaad), grid, spelend; alle faders open, rijen en video open.
  const opzet = await evalueer(`(async () => {
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const act = await import('/src/control/actions.js');
    const e = window.engine;
    await e.resume();
    const ids = ['A','B','C','D','E','F','G','H'];
    for (let i = 0; i < ids.length; i++) {
      const d = e.deck(ids[i]);
      await d.laadGeheugen(renderDemoTrack(e.ctx, { seed: i, bars: 32 }), 'demo ' + (i + 1));
      d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0, slot: true }));
    }
    for (let i = 1; i <= 8; i++) { act.invoke('track.' + i + '.fader', 0.8); act.invoke('track.' + i + '.play', true); act.invoke('track.' + i + '.play', false); }
    e.setFocus('A');
    if (${RIJEN}) {
      for (const id of ['stems', 'koptelefoon', 'instrument', 'patronen', 'master', 'auto', 'klankschaal', 'beeld']) {
        const rij = document.getElementById(id), knop = document.getElementById(id + '-btn');
        if (rij && knop && rij.classList.contains('hidden')) knop.click();
      }
    }
    if (${VIDEO}) {
      const v = document.getElementById('video-panel');
      if (v && v.classList.contains('hidden')) document.getElementById('video-btn')?.click();
    }
    window.__lat.wachter();
    return { ctx: e.ctx.state, sr: e.ctx.sampleRate, base: e.ctx.baseLatency, out: e.ctx.outputLatency ?? null,
      spelend: ids.filter((id) => e.deck(id).playing).length, coi: self.crossOriginIsolated,
      invoer: window.midi.input()?.name, regels: window.mapping.rules.size };
  })()`);
  uitkomst.omgeving = opzet;
  console.log(`latentie (${LABEL}${WORTEL !== HIER ? `, app uit ${WORTEL}` : ''}): ${JSON.stringify(opzet)}`);
  await wacht(1500);

  const kies = optie('scenario');
  const namen = kies ? kies.split(',') : Object.keys(SCENARIOS);
  for (const naam of namen) {
    const sc = SCENARIOS[naam];
    if (!sc) throw new Error(`onbekend scenario ${naam}`);
    const plan = maakPlan(naam, { duur: DUUR, zaad: ZAAD, jitter: JITTER });
    await evalueer(`(() => { const T = window.__lat; T.berichten = []; T.raf = {}; T.frames = []; T.longtasks = []; T.scherm = []; T.wachtScherm.clear(); T.meet = true; })()`);
    const prof = PROFIEL.includes(naam);
    const spoor = SPOOR.includes(naam);
    if (spoor) await startSpoor();
    const m0 = await metrieken();
    if (prof) { await cdp('Profiler.enable'); await cdp('Profiler.setSamplingInterval', { interval: 200 }); await cdp('Profiler.start'); }
    if (hub) await hub.speel(plan); else await evalueer(`window.__lat.speel(${JSON.stringify(plan)})`);
    await wacht(150);   // de laatste frames en de scherm-wachter
    const m1 = await metrieken();
    const hoofd = Object.fromEntries(Object.keys(m1).map((k) => [k, r2((m1[k] - m0[k]) * 1000 / (DUUR / 1000))]));
    const spoorUit = spoor ? await stopSpoor() : null;
    let profiel = null;
    if (prof) { profiel = (await cdp('Profiler.stop')).profile; await cdp('Profiler.disable'); }
    const r = await evalueer(`(() => { const T = window.__lat; T.meet = false;
      return { berichten: T.berichten, raf: T.raf, frames: T.frames, longtasks: T.longtasks, scherm: T.scherm, oorsprong: performance.timeOrigin }; })()`);
    if (hub) {
      // De ts van elk bericht is het moment van injecteren in de hub, op de klok van de pagina (in volgorde).
      const inj = hub.verstuurd.filter((x) => x[1]).map((x) => x[0] + hub.offset);
      r.berichten.forEach((b, i) => { b[0] = inj[i] ?? b[1]; });
      r.scherm = [];
      uitkomstHub(r, inj);
    }
    const echt = r.berichten.filter((b) => b[4]);
    const wachtMs = r.berichten.map((b) => b[1] - b[0]);
    const werkMs = echt.map((b) => b[2] - b[1]);
    const geluidMs = echt.filter((b) => b[3]).map((b) => b[3] - b[0]);
    const rafs = Object.fromEntries(Object.entries(r.raf).map(([k, xs]) => [k, { ...stat(xs), somMs: r2(xs.reduce((a, b) => a + b, 0)) }]));
    const lt = r.longtasks.map(([, d]) => d);
    const uit = {
      uitleg: sc.uitleg, gepland: plan.length, ontvangen: r.berichten.length,
      wacht: stat(wachtMs), werk: stat(werkMs), totGeluid: stat(geluidMs), totScherm: stat(r.scherm),
      // Hoeveel tijd de hoofdthread per seconde kwijt was aan MIDI-handlers en aan rAF.
      werkPerS: r2(werkMs.reduce((a, b) => a + b, 0) / (DUUR / 1000)),
      rafPerS: r2(Object.values(r.raf).flat().reduce((a, b) => a + b, 0) / (DUUR / 1000)),
      frames: stat(r.frames), rafs, hoofdthreadMsPerS: hoofd,
      longtasks: { n: lt.length, somMs: r2(lt.reduce((a, b) => a + b, 0)), max: r2(lt.length ? Math.max(...lt) : 0) },
      ...(profiel ? { profiel: zelftijd(profiel) } : {}),
      ...(spoorUit ? { spoor: spoorUit } : {}),
    };
    uit.belasting = r2(loadavg()[0]);
    uitkomst.scenarios[naam] = uit;
    const f = (s) => (s.n ? `${s.p50}/${s.p99}` : '—');
    console.log(`${naam.padEnd(7)} wacht ${f(uit.wacht)} · werk ${f(uit.werk)} · geluid ${f(uit.totGeluid)} · scherm ${f(uit.totScherm)} ms (p50/p99)`
      + ` · werk/s ${uit.werkPerS} · rAF/s ${uit.rafPerS} · frame p50 ${uit.frames.p50} · lange taken ${uit.longtasks.n} (max ${uit.longtasks.max})`
      + `\n        hoofdthread ms/s (${uitkomst.tijd}; *N = aantal per s): ${Object.entries(hoofd).map(([k, v]) => `${k} ${v}`).join(' · ')} · belasting ${uit.belasting}`);
    if (profiel) for (const [k, ms] of uit.profiel.top.slice(0, 15)) console.log(`        ${String(ms).padStart(7)} ms  ${k}`);
    if (spoorUit) console.log(`        spoor: ${JSON.stringify(spoorUit, null, 0).slice(0, 3000)}`);
    await wacht(500);
  }
  uitkomst.meldingen = meldingen.slice(0, 20);
  if (meldingen.length) console.log(`meldingen in de pagina (${meldingen.length}):\n  ${meldingen.slice(0, 8).join('\n  ')}`);
  if (UIT) { writeFileSync(UIT, JSON.stringify(uitkomst, null, 1)); console.log(`-> ${UIT}`); }
} catch (err) {
  console.error('FOUT', err?.stack || err);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch (_) {}
  try { await hubStop?.(); } catch (_) {}
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  chrome.kill('SIGKILL'); server.kill('SIGKILL');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

/** De echte hub in dit proces, met een nep-APC (alleen met --hub). */
async function startEchteHub() {
  const HUB = process.env.VARVE_HUB_REPO;
  if (!HUB || !existsSync(join(HUB, 'node_modules/ws'))) throw new Error('--hub: zet VARVE_HUB_REPO op een AV-app-hub MET node_modules (npm install)');
  const { startHub } = await import(join(HUB, 'src/hub.js'));
  const { NepSysteem } = await import(join(HUB, 'src/ports/nep.js'));
  const { laadConfig } = await import(join(HUB, 'src/config.js'));
  const systeem = new NepSysteem();
  const apc = systeem.voegToe('APC40 mkII');
  // opname: false (de echte config heeft een avondmap), drivers: false (geen andere apps starten).
  const echt = await startHub({ config: { ...laadConfig(), hotplug_ms: 20 }, systeem, poort: HUBPOORT, host: '127.0.0.1', drivers: false, opname: false });
  hubStop = () => echt.stop?.();
  const h = { echt, apc, url: echt.adres.replace('http', 'ws') + '/app', verstuurd: [], offset: 0 };
  // Het plan vanuit Node: op tijd injecteren (een korte draailus voor de laatste ms), en per bericht het echte moment.
  h.speel = async (plan) => {
    h.verstuurd = [];
    const t0 = performance.now() + 30;
    for (const [dt, a, b, c] of plan) {
      const due = t0 + dt;
      let w;
      while ((w = due - performance.now()) > 2) await wacht(Math.max(0, w - 2));
      while (performance.now() < due) { /* draaien */ }
      const t = performance.timeOrigin + performance.now();
      if (a) apc.injecteer([a, b, c]);
      h.verstuurd.push([t - performance.timeOrigin + performance.timeOrigin, a]);
    }
    await wacht(200);
  };
  return h;
}
/** Klok van de pagina min die van Node (ms), via de snelste van tien CDP-rondjes. Pagina-tijd = Node-tijd + verschil. */
async function klokVerschil() {
  let beste = null;
  for (let i = 0; i < 10; i++) {
    const a = performance.timeOrigin + performance.now();
    const p = await evalueer('performance.timeOrigin + performance.now()');
    const b = performance.timeOrigin + performance.now();
    if (!beste || b - a < beste.rtt) beste = { rtt: b - a, verschil: p - (a + b) / 2 };
  }
  console.log(`klokken gelijkgezet: rondje ${beste.rtt.toFixed(2)} ms (onzekerheid ±${(beste.rtt / 2).toFixed(2)} ms)`);
  return beste.verschil;
}
/** In --hub: ts komt van de hub-kant; de pagina gaf zijn eigen klok (timeOrigin + now) — terug naar now. */
function uitkomstHub(r, inj) {
  // De pagina schreef t0/t1 in performance.now(); de injectie staat in timeOrigin + now. Gelijk trekken:
  // r.oorsprong komt mee uit de pagina.
  for (const b of r.berichten) b[0] -= r.oorsprong;
  if (r.berichten.length !== inj.length) console.log(`  let op: ${inj.length} geïnjecteerd, ${r.berichten.length} aangekomen`);
}

/** Meerdere rondes tot één uitkomst: per getal de mediaan (zelfde vorm als één ronde). */
function samen(rondes) {
  if (rondes.length === 1) return rondes[0];
  const med = (xs) => { const s = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };
  const voeg = (objs) => {
    const eerste = objs.find((o) => o != null);
    if (typeof eerste === 'number') return med(objs);
    if (!eerste || typeof eerste !== 'object' || Array.isArray(eerste)) return eerste;
    return Object.fromEntries(Object.keys(eerste).map((k) => [k, voeg(objs.map((o) => o?.[k]))]));
  };
  const uit = voeg(rondes);
  uit.label = `${rondes[0].label} (mediaan van ${rondes.length})`;
  return uit;
}

/** Twee uitkomsten als tabel (markdown): p50/p99 per maat, per scenario. */
function vergelijk(a, b) {
  const regels = [`| scenario | maat | ${a.label} p50 / p99 | ${b.label} p50 / p99 |`, '|---|---|---|---|'];
  const s = (x) => (x && x.n ? `${x.p50} / ${x.p99}` : '—');
  for (const naam of Object.keys(a.scenarios)) {
    const x = a.scenarios[naam], y = b.scenarios[naam];
    if (!y) continue;
    for (const [m, label] of [['wacht', 'wacht (ms)'], ['werk', 'werk per bericht (ms)'], ['totGeluid', 'tot geluid gepland (ms)'], ['totScherm', 'tot scherm (ms)'], ['frames', 'frame-interval (ms)']]) {
      if (!x[m]?.n && !y[m]?.n) continue;
      regels.push(`| ${naam} | ${label} | ${s(x[m])} | ${s(y[m])} |`);
    }
    regels.push(`| ${naam} | handlers ms/s · rAF ms/s | ${x.werkPerS} · ${x.rafPerS} | ${y.werkPerS} · ${y.rafPerS} |`);
    regels.push(`| ${naam} | lange taken (n, max ms) | ${x.longtasks.n}, ${x.longtasks.max} | ${y.longtasks.n}, ${y.longtasks.max} |`);
    const h = (z) => (z.hoofdthreadMsPerS ? `${z.hoofdthreadMsPerS.taak} · ${z.hoofdthreadMsPerS.script} · ${z.hoofdthreadMsPerS.stijl} · ${z.hoofdthreadMsPerS.opmaak}` : '—');
    regels.push(`| ${naam} | hoofdthread ms/s: taak · script · stijl · opmaak | ${h(x)} | ${h(y)} |`);
    const n = (z) => (z.hoofdthreadMsPerS?.stijlN != null ? `${z.hoofdthreadMsPerS.stijlN} · ${z.hoofdthreadMsPerS.opmaakN}` : '—');
    regels.push(`| ${naam} | stijl- · opmaakberekeningen per s | ${n(x)} | ${n(y)} |`);
  }
  return regels.join('\n');
}

/** Per scenario en maat: mediaan [min–max] over de rondes, voor p50 en p99, en of de bereiken overlappen. */
function bereik(ra, rb) {
  const [la, lb] = [ra[0].label, rb[0].label];
  const regels = [`| scenario | maat | ${la} p50 | ${lb} p50 | ${la} p99 | ${lb} p99 |`, '|---|---|---|---|---|---|'];
  const getal = (x) => (x == null ? '—' : String(x).replace('.', ','));
  const rij = (xs) => {
    const s = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q);
    return s.length ? { med: s[s.length >> 1], min: s[0], max: s[s.length - 1] } : null;
  };
  const toon = (r) => (r ? `${getal(r.med)} [${getal(r.min)}–${getal(r.max)}]` : '—');
  const overlap = (x, y) => (x && y && x.min <= y.max && y.min <= x.max ? ' (overlapt)' : '');
  const maten = [['wacht', 'wacht'], ['werk', 'werk per bericht'], ['totGeluid', 'tot geluid gepland'], ['totScherm', 'tot scherm']];
  for (const naam of Object.keys(ra[0].scenarios)) {
    if (!rb[0].scenarios[naam]) continue;
    for (const [m, label] of maten) {
      const pa50 = rij(ra.map((r) => r.scenarios[naam]?.[m]?.p50)), pb50 = rij(rb.map((r) => r.scenarios[naam]?.[m]?.p50));
      const pa99 = rij(ra.map((r) => r.scenarios[naam]?.[m]?.p99)), pb99 = rij(rb.map((r) => r.scenarios[naam]?.[m]?.p99));
      if (!pa50 && !pb50) continue;
      regels.push(`| ${naam} | ${label} | ${toon(pa50)} | ${toon(pb50)}${overlap(pa50, pb50)} | ${toon(pa99)} | ${toon(pb99)}${overlap(pa99, pb99)} |`);
    }
    for (const k of ['taak', 'stijl']) {
      const ha = rij(ra.map((r) => r.scenarios[naam]?.hoofdthreadMsPerS?.[k])), hb = rij(rb.map((r) => r.scenarios[naam]?.hoofdthreadMsPerS?.[k]));
      if (ha || hb) regels.push(`| ${naam} | hoofdthread ${k} ms/s | ${toon(ha)} | ${toon(hb)}${overlap(ha, hb)} | | |`);
    }
  }
  const bel = (rs) => rij(rs.flatMap((r) => Object.values(r.scenarios).map((x) => x.belasting)));
  regels.push('', `belasting (loadavg 1 min) tijdens de rondes: ${toon(bel(ra))} · ${toon(bel(rb))}; zaden ${ra.map((r) => r.zaad ?? '-').join(',')} · ${rb.map((r) => r.zaad ?? '-').join(',')}`);
  return regels.join('\n');
}
