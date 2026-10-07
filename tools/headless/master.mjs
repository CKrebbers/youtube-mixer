// De master (docs/MASTER.md) in een headless Chromium: de echte limiter-worklet
// en het insert-rack op de echte Web Audio van Chrome.
//
// 1. Chrome, OfflineAudioContext (de ECHTE engine, signaal recht op master.input):
//    - pieken tot +6 dB: geen sample en geen tussenwaarde (true peak, 16×
//      oversampling met een lange sinc) boven −1 dBFS; de gain reduction is
//      tijdens het renderen uit te lezen (suspend) en staat in de snapshot;
//    - een stationair signaal onder het plafond: 0 dB gain reduction, de
//      uitvoer is de invoer, 72 samples later (geen pompen);
//    - de vertraging is 72 samples (1,5 ms), precies wat hoorbaar.js meetelt;
//    - het insert-rack met een effect (delay, galm) klinkt: na het signaal
//      een staart, eindig, en onder het plafond; zonder mix: stilte;
//    - de wissel compressor → worklet MIDDEN in een toon (de audio loopt):
//      geen sprong in de golf;
//    - de compressor van vroeger ter vergelijking: 6 ms en +0,7 dB.
// 2. De app zoals hij opstart: de limiter-worklet laadt, de MASTER-rij opent,
//    de kiezer kent de racks, een rack kiezen wordt onthouden (ook na
//    herladen), het mapje master op het scherm (de spiegel van de APC).
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
// Raakt de geluidsinstellingen van de Mac niet: de offline context speelt niets
// af, en de headless browser heeft geen geluidsuitgang nodig.
//
// Gebruik:  node tools/headless/master.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8811), VARVE_KIJK_DEBUG (standaard 9411)
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache
// (macOS), anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8811, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9411;
const tmp = mkdtempSync(join(tmpdir(), 'varve-master-'));

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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
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
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const db = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
const f = (x, n = 2) => x.toFixed(n).replace('.', ',');

/**
 * Wat elke meting in de pagina deelt: de engine op een OfflineAudioContext
 * (stereo, 48 kHz), een signaal uit een functie recht op master.input, true
 * peak met 16× oversampling (48 tikken per kant), rms.
 */
const PRELUDE = `
  const SR = 48000;
  async function maakEngine(sec) {
    const Echt = window.AudioContext;
    window.AudioContext = class extends OfflineAudioContext {
      constructor() { super({ numberOfChannels: 2, length: Math.round(SR * sec), sampleRate: SR }); }
    };
    try { const { Engine } = await import('/src/engine/engine.js'); return new Engine(); }
    finally { window.AudioContext = Echt; }
  }
  function bron(ctx, naar, sec, fn) {
    const n = Math.round(SR * sec), b = ctx.createBuffer(2, n, SR), L = b.getChannelData(0), R = b.getChannelData(1);
    for (let i = 0; i < n; i++) { const [l, r] = fn(i); L[i] = l; R[i] = r; }
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(naar); s.start(0);
    return b;
  }
  function truePeak(x, van = 0) {
    const os = 16, half = 48, rijen = [];
    for (let p = 1; p < os; p++) {
      const mu = p / os, rij = new Float64Array(2 * half); let som = 0;
      for (let k = -half + 1; k <= half; k++) {
        const d = mu - k, w = 0.42 + 0.5 * Math.cos(Math.PI * d / half) + 0.08 * Math.cos(2 * Math.PI * d / half);
        rij[k + half - 1] = Math.sin(Math.PI * d) / (Math.PI * d) * w; som += rij[k + half - 1];
      }
      for (let k = 0; k < rij.length; k++) rij[k] /= som;
      rijen.push(rij);
    }
    let max = 0;
    for (let i = van; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
    for (let i = Math.max(van, half); i < x.length - half; i++) {
      if (Math.abs(x[i]) < 0.2 && Math.abs(x[i + 1]) < 0.2) continue;
      for (const rij of rijen) { let s = 0; for (let k = 0; k < rij.length; k++) s += x[i - half + 1 + k] * rij[k]; max = Math.max(max, Math.abs(s)); }
    }
    return max;
  }
  const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const eindig = (x) => { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false; return true; };
  // Muziek-achtig: kick (165 → 55 Hz) op 120 bpm tot +6 dB, akkoord, hihat-ruis.
  function muziek(hard = 1.5) {
    let zaad = 20261005;
    const rnd = () => ((zaad = (Math.imul(zaad, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5);
    return (i) => {
      const t = i / SR, tel = (t * 2) % 1, sinds = tel / 2;
      const kick = Math.exp(-tel * 30) * Math.sin(2 * Math.PI * 55 * (sinds + 0.1 * (1 - Math.exp(-20 * sinds))));
      const akk = 0.25 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t));
      const hat = rnd() * 0.3 * Math.exp(-((t * 4) % 1) * 50);
      const x = hard * kick + akk + hat;
      return [x, 0.9 * x];
    };
  }
`;

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
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer)').catch(() => false)) break; await wacht(200); }
  await wacht(800);

  // ---- 1. Chrome, offline -----------------------------------------------------
  console.log('Chrome, OfflineAudioContext (de echte engine)');

  const piek = await evalueer(`(async () => { ${PRELUDE}
    const e = await maakEngine(2.2), ctx = e.ctx;
    const geladen = await e.master.klaar;
    e.master.gain.gain.value = 1;                         // 0 dB, meteen: het signaal komt ongedempt bij de limiter
    const inn = bron(ctx, e.master.input, 2.2, muziek());
    // De gain reduction tijdens het renderen: op 1,0 s (net na een kick) en de snapshot.
    let grMid = null, grSnap = null;
    ctx.suspend(1.0 + 0.02).then(() => { grMid = e.master.gr(); grSnap = e.snapshot().limiter.gr; ctx.resume(); });
    const out = await ctx.startRendering();
    const L = out.getChannelData(0), R = out.getChannelData(1);
    let inPiek = 0; for (const v of inn.getChannelData(0)) inPiek = Math.max(inPiek, Math.abs(v));
    let sp = 0; for (let i = 0; i < L.length; i++) sp = Math.max(sp, Math.abs(L[i]), Math.abs(R[i]));
    return { geladen, soort: e.master.soort, inPiek, sp, tp: Math.max(truePeak(L), truePeak(R)), grMid, grSnap, eindig: eindig(L) && eindig(R) };
  })()`);
  ok('de limiter-worklet laadt op de OfflineAudioContext (soort worklet)', piek.geladen && piek.soort === 'worklet');
  ok(`pieken tot +${f(db(piek.inPiek), 1)} dB: true peak (16×) ${f(db(piek.tp), 3)} dBTP ≤ −1, sample-piek ${f(db(piek.sp))} dBFS`,
    db(piek.inPiek) >= 6 && piek.tp <= Math.pow(10, -1 / 20) && piek.eindig);
  ok(`gain reduction tijdens het renderen uit te lezen: ${f(piek.grMid, 1)} dB (snapshot ${f(piek.grSnap, 1)} dB)`,
    piek.grMid < -3 && piek.grSnap < -3);

  const stil = await evalueer(`(async () => { ${PRELUDE}
    const e = await maakEngine(2), ctx = e.ctx;
    await e.master.klaar;
    e.master.gain.gain.value = 1;
    const inn = bron(ctx, e.master.input, 2, (i) => {
      const t = i / SR, x = 0.45 * Math.sin(2 * Math.PI * 61 * t) + 0.3 * Math.sin(2 * Math.PI * 997 * t) + 0.04 * Math.sin(2 * Math.PI * 9100 * t);
      return [x, -0.8 * x];
    });
    const grs = [];
    for (const t of [0.5, 1.0, 1.5]) ctx.suspend(t).then(() => { grs.push(e.master.gr()); ctx.resume(); });
    const out = await ctx.startRendering();
    const N = Math.round(e.master.vertraging * SR), L = out.getChannelData(0), R = out.getChannelData(1);
    const iL = inn.getChannelData(0), iR = inn.getChannelData(1);
    let afw = 0, inPiek = 0;
    for (let i = N; i < L.length; i++) { afw = Math.max(afw, Math.abs(L[i] - iL[i - N]), Math.abs(R[i] - iR[i - N])); inPiek = Math.max(inPiek, Math.abs(iL[i])); }
    return { N, afw, inPiek, grs };
  })()`);
  ok(`stationair onder het plafond (piek ${f(db(stil.inPiek), 1)} dBFS): 0 dB gain reduction op 0,5 / 1,0 / 1,5 s (${stil.grs.map((g) => f(g, 3)).join(' / ')})`,
    stil.grs.length === 3 && stil.grs.every((g) => g === 0));
  ok(`… en de uitvoer is de invoer, ${stil.N} samples later (grootste afwijking ${stil.afw.toExponential(1)}): geen pompen, niets veranderd`,
    stil.N === 72 && stil.afw < 1e-6);

  const lat = await evalueer(`(async () => { ${PRELUDE}
    const e = await maakEngine(0.3), ctx = e.ctx;
    await e.master.klaar;
    e.master.gain.gain.value = 1;
    bron(ctx, e.master.input, 0.3, (i) => (i === 4800 ? [0.5, 0.5] : [0, 0]));
    const out = await ctx.startRendering(), L = out.getChannelData(0);
    return { waar: L.findIndex((v) => Math.abs(v) > 1e-6), waarde: L[L.findIndex((v) => Math.abs(v) > 1e-6)], graaf: ctx.graafVertraging,
      hoor: (await import('/src/engine/hoorbaar.js')).uitgangsVertraging(ctx) };
  })()`);
  ok(`vertraging: een tik komt ${lat.waar - 4800} samples later naar buiten, = de ${f(lat.graaf * 1000)} ms die hoorbaar.js meetelt`,
    lat.waar - 4800 === 72 && Math.abs(lat.waarde - 0.5) < 1e-6 && Math.abs(lat.graaf - 72 / 48000) < 1e-12 && Math.abs(lat.hoor - lat.graaf) < 1e-12);

  const effect = (soort, mix) => evalueer(`(async () => { ${PRELUDE}
    const e = await maakEngine(2), ctx = e.ctx;
    await e.master.klaar;
    e.master.gain.gain.value = 1;
    const fx = e.master.fx;
    fx.zetEffect('${soort}');
    fx.setMix(${mix});
    // Een kwart seconde een toon met boventonen op −6 dBFS, daarna stilte.
    bron(ctx, e.master.input, 2, (i) => { const t = i / SR; const x = t < 0.25 ? 0.25 * (Math.sin(2 * Math.PI * 300 * t) + Math.sin(2 * Math.PI * 600 * t)) : 0; return [x, x]; });
    const out = await ctx.startRendering(), L = out.getChannelData(0), R = out.getChannelData(1);
    return { effect: fx.effectId, staart: rms(L, Math.round(0.5 * SR), Math.round(1.5 * SR)), toon: rms(L, Math.round(0.05 * SR), Math.round(0.2 * SR)),
      tp: Math.max(truePeak(L), truePeak(R)), eindig: eindig(L) && eindig(R) };
  })()`);
  const droog = await effect('delay', 0);
  const echo = await effect('delay', 1);
  const galm = await effect('reverb', 1);
  ok(`insert-rack droog (mix 0): na de toon stilte (${f(db(droog.staart), 0)} dBFS)`, db(droog.staart) < -100 && db(droog.toon) > -15);
  ok(`insert-rack met delay (mix 1): de echo klinkt na (${f(db(echo.staart), 1)} dBFS rms tussen 0,5 en 1,5 s), eindig, onder het plafond (${f(db(echo.tp), 2)} dBTP)`,
    echo.effect === 'delay' && db(echo.staart) > -50 && echo.eindig && echo.tp <= Math.pow(10, -1 / 20));
  ok(`insert-rack met galm (mix 1): de staart klinkt (${f(db(galm.staart), 1)} dBFS rms), eindig, onder het plafond`,
    galm.effect === 'reverb' && db(galm.staart) > -60 && galm.eindig && galm.tp <= Math.pow(10, -1 / 20));

  // De wissel compressor → worklet terwijl de audio LOOPT (kruisfade), midden in een toon.
  const wissel = await evalueer(`(async () => { ${PRELUDE}
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
    const { Master } = await import('/src/engine/master.js');
    const m = new Master(ctx, ctx.destination, { limiter: false });
    bron(ctx, m.input, 1, (i) => { const x = 0.25 * Math.sin(2 * Math.PI * 440 * i / SR); return [x, x]; });
    ctx.suspend(0.5).then(async () => {
      await ctx.audioWorklet.addModule('/src/engine/limiter-worklet.js');
      const node = new AudioWorkletNode(ctx, 'varve-limiter', { numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 1], processorOptions: m.opties });
      Object.defineProperty(ctx, 'state', { get: () => 'running', configurable: true });   // alsof hij speelt: de kruisfade
      m._neemOver(node);
      delete ctx.state;
      ctx.resume();
    });
    const out = await ctx.startRendering(), L = out.getChannelData(0);
    // Een sprong in de golf = een grote tweede afgeleide. Rond de wissel tegen ervoor.
    const d2 = (a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(L[i] - 2 * L[i - 1] + L[i - 2])); return m; };
    return { voor: d2(Math.round(0.3 * SR), Math.round(0.45 * SR)), rond: d2(Math.round(0.495 * SR), Math.round(0.6 * SR)),
      na: d2(Math.round(0.7 * SR), Math.round(0.9 * SR)), soort: m.soort, eindig: eindig(L) };
  })()`);
  ok(`compressor → worklet midden in een toon van 440 Hz: geen sprong (tweede afgeleide ${f(wissel.rond, 4)} rond de wissel, ${f(wissel.voor, 4)} ervoor)`,
    wissel.soort === 'worklet' && wissel.eindig && wissel.rond < wissel.voor * 1.5 && wissel.na < wissel.voor * 1.5);

  const oud = await evalueer(`(async () => { ${PRELUDE}
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
    const { Master } = await import('/src/engine/master.js');
    const m = new Master(ctx, ctx.destination, { limiter: false });
    bron(ctx, m.input, 1, (i) => (i === 4800 ? [0.1, 0.1] : i > 24000 ? [0.1 * Math.sin(2 * Math.PI * 1000 * i / SR), 0] : [0, 0]));
    const L = (await ctx.startRendering()).getChannelData(0);
    let p = 0, waar = 0; for (let i = 0; i < 20000; i++) if (Math.abs(L[i]) > p) { p = Math.abs(L[i]); waar = i; }
    let s = 0; for (let i = 36000; i < SR; i++) s = Math.max(s, Math.abs(L[i]));
    return { vertraging: waar - 4800, versterking: s / 0.1 };
  })()`);
  ok(`ter vergelijking, de compressor van vroeger: ${oud.vertraging} samples (${f(oud.vertraging / 48, 1)} ms) vertraging en ${f(db(oud.versterking))} dB erbij onder de drempel`,
    oud.vertraging === 288 && db(oud.versterking) > 0.5);

  // ---- 2. de app -------------------------------------------------------------
  console.log('\nde app');
  ok('de app start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));
  const app = await evalueer(`(async () => { await window.engine.master.klaar; const m = window.engine.master;
    return { soort: m.soort, vertraging: m.vertraging, graaf: window.engine.ctx.graafVertraging, staat: window.engine.ctx.state }; })()`);
  ok(`de limiter-worklet zit erin (${app.soort}, ${f(app.vertraging * 1000)} ms, context ${app.staat})`, app.soort === 'worklet' && app.graaf === app.vertraging);
  ok('de rij staat standaard dicht; naast de mastermeter de gain reduction', await evalueer(`document.getElementById('master').classList.contains('hidden')
    && !!document.querySelector('#fd-scenes .master-meter + .gr-meter')`));
  await evalueer("document.getElementById('master-btn').click(), true");
  await wacht(500);
  // Twee beelden van de renderloop afwachten: die tekent de rij.
  const beelden = await evalueer(`Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    new Promise((r) => setTimeout(() => r(false), 3000))])`);
  ok('de renderloop tekent (requestAnimationFrame loopt)', beelden);
  const rij = await evalueer(`(() => { const r = document.getElementById('master'); const sel = r.querySelector('.ms-rack');
    return { open: !r.classList.contains('hidden') && r.offsetHeight > 20, opties: [...sel.options].map((o) => o.value), waarde: sel.value,
      soort: r.querySelector('.ms-soort').textContent, gr: r.querySelector('.ms-gr-tekst').textContent,
      labels: [...r.querySelectorAll('.ms-plek .knob-label')].map((l) => l.textContent),
      dof: r.querySelectorAll('.ms-plek.dof').length, aan: r.querySelector('.ms-aan').textContent }; })()`);
  ok('de knop in de balk opent de rij', rij.open);
  ok(`de kiezer: de kant-en-klare racks en de losse effecten; nu het filter (${rij.waarde})`,
    rij.opties.filter((o) => o.startsWith('s:')).length >= 3 && rij.opties.filter((o) => o.startsWith('e:')).length === 7 && rij.waarde === 'e:filter');
  ok(`de rij zegt wat er werkt: "${rij.soort}", gain reduction "${rij.gr}"`, /limiter −1 dBTP · 1,5 ms/.test(rij.soort) && rij.gr === '0 dB');
  ok(`de knoppen heten naar het rack (${rij.labels.slice(0, 3).join(', ')}…), de lege dof (${rij.dof})`, rij.labels[0] !== '1' && rij.dof === 6 && rij.aan === 'aan');
  await foto('master-rij.png');

  // Een sjabloon kiezen: klinkt, wordt onthouden, ook na herladen.
  const gekozen = await evalueer(`(async () => { const sel = document.querySelector('#master .ms-rack');
    const i = [...sel.options].find((o) => o.value.startsWith('s:') && o.textContent === 'Dub-worp')?.value;
    sel.value = i; sel.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
    return { i, herkomst: window.engine.master.fx.herkomst, naam: window.engine.master.fx.rackNaam,
      opslag: JSON.parse(localStorage.getItem('varve.master.rack') || 'null') }; })()`);
  ok(`een sjabloon kiezen (Dub-worp): klinkt en wordt onthouden (localStorage, op naam)`,
    gekozen.herkomst === gekozen.i && gekozen.naam === 'Dub-worp' && gekozen.opslag?.naam === 'Dub-worp' && gekozen.opslag?.rack?.name === 'Dub-worp');
  await cdp('Page.reload');
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer)').catch(() => false)) break; await wacht(200); }
  await wacht(1200);
  const na = await evalueer(`(() => { const fx = window.engine.master.fx; return { naam: fx.rackNaam, herkomst: fx.herkomst, mix: fx.mix,
    waarde: document.querySelector('#master .ms-rack').value, open: !document.getElementById('master').classList.contains('hidden') }; })()`);
  ok(`na herladen: hetzelfde rack (${na.naam}, ${na.herkomst}), de kiezer erop, MIX dicht, de rij weer open`,
    na.naam === 'Dub-worp' && na.herkomst === gekozen.i && na.waarde === gekozen.i && na.mix === 0 && na.open);

  // Het mapje master op de spiegel van de APC (Shift + Clip/Device View).
  const mapje = await evalueer(`(async () => { const { invoke } = await import('/src/control/actions.js');
    invoke('layer.device.master', true); invoke('layer.device.master', false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const kop = document.querySelector('.fd-laag').textContent, uitleg = document.querySelector('.fd-laag-uitleg').textContent;
    const knobs = [...document.querySelectorAll('#fd-knobs .knob')].map((k) => [k.dataset.action, k.querySelector('.knob-label')?.textContent]);
    invoke('layer.device.view', true); invoke('layer.device.view', false);
    return { kop, uitleg, knobs, terug: window.lagen.stand.device }; })()`);
  ok(`het mapje master op het scherm: "${mapje.kop}", knop 1 = ${mapje.knobs[0]?.[0]} ("${mapje.knobs[0]?.[1]}"), knop 8 = ${mapje.knobs[7]?.[0]}`,
    mapje.kop === 'MASTER' && mapje.knobs[0]?.[0] === 'master.fx.knob.1' && mapje.knobs[0]?.[1] === 'Worp' && mapje.knobs[7]?.[0] === 'master.fx.mix'
    && /mix/.test(mapje.uitleg) && mapje.terug === 'strip');
  await evalueer("document.getElementById('master-btn').click(), true");

  // De APC-kaart (apc.html): het mapje master bij "rechts".
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/apc.html` });
  for (let i = 0; i < 50; i++) { if (await evalueer("!!document.querySelector('[data-sig=\"cc:0:23\"] span')?.textContent").catch(() => false)) break; await wacht(200); }
  const kaart = await evalueer(`(async () => {
    document.querySelector('[data-modus="device.master"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const t = (sig) => document.querySelector('[data-sig="' + sig + '"] span')?.textContent;
    return { k1: t('cc:0:16'), k8: t('cc:0:23'), aanuit: t('note:0:62'), knop: document.querySelector('[data-modus="device.master"]').classList.contains('aan') }; })()`);
  ok(`de APC-kaart: "master" bij rechts; knop 1 = "${kaart.k1}", knop 8 = "${kaart.k8}", On/Off = "${kaart.aanuit}"`,
    kaart.knop && kaart.k1 === 'master 1' && kaart.k8 === 'master mix' && kaart.aanuit === 'master aan/uit');

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
