// De stemkanalen (docs/STEMS.md §5) in een headless Chromium: filter, sends en
// cue per stem, GEMETEN op de echte Web Audio van Chrome.
//
// 1. Geluid: de echte engine op een OfflineAudioContext, een stems.wav met een
//    bekende toon per stem (drums 2000 Hz, bas 2700, overig 3600, zang 5100),
//    via laadStream en de echte worklet. Per kanaal de amplitude van elke toon
//    (Goertzel over de tweede seconde, na alle overgangen):
//    - alles open: elke toon even hard in de zaal;
//    - het filter van één stem dempt alleen die toon;
//    - send A van één stem: aan de INGANG van de echobus alleen die toon;
//      de groep (inst) stuurt drums, bas en overig;
//    - de trackfader dicht: ook de stem-sends dicht;
//    - cue op één stem (vier kanalen): alleen die toon op 3/4, de zaal gelijk.
// 2. De STEMS-rij met vier stems op 1440×900, 1440×790 en 1920×1080 (en twee
//    stems op 1440×790): alles past, de knoppen volgen de bus en de focus.
// 3. Met --vergelijk <git-revisie>: dezelfde scène (een track zonder stems,
//    een track met vier stems alles open, sends, cue) op de oude code en op
//    deze, bit voor bit (eerst de oude server, dan deze, op dezelfde poort).
// 4. Met --cpu: CPU-tijd van acht tracks × vier stems (offline, één thread),
//    stil / alles open / filters aan / sends aan, en met een insert-slot per
//    stem erbij (de vraag of dat goedkoop is); met --vergelijk om en om met de
//    oude code op dezelfde pagina (mediaan van vijf).
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad, eigen
// server op een eigen poort, tijdelijke database en media. Raakt de
// geluidsinstellingen van de Mac niet: een offline context speelt niets af.
//
// Gebruik:  node tools/headless/stemkanalen.mjs [--vergelijk 481f17a] [--cpu] [uitmap]
// Poorten:  VARVE_KIJK_POORT (8812) en VARVE_KIJK_DEBUG (9412).
import { spawn, execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const VERGELIJK = args.includes('--vergelijk') ? args[args.indexOf('--vergelijk') + 1] : null;
const CPU = args.includes('--cpu');
const UIT = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--vergelijk') || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8812, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9412;
const tmp = mkdtempSync(join(tmpdir(), 'varve-stemkanalen-'));

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

/** Een server uit `wortel` (deze werkmap, of een uitgepakte oude revisie) op POORT. */
async function startServer(wortel) {
  const s = spawn(process.execPath, [join(wortel, 'server/index.js')], {
    cwd: wortel,
    env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, `lib-${Date.now()}.db`), VARVE_MEDIA: join(tmp, 'media'),
      VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) return s; await wacht(200); }
  throw new Error('server start niet');
}
async function stopServer(s) {
  s.kill('SIGINT');
  for (let i = 0; i < 30; i++) { if (!(await fetch(`http://localhost:${POORT}/`).then(() => true).catch(() => false))) return; await wacht(100); }
}

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
async function maat(b, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: b, height: h, deviceScaleFactor: 1, mobile: false });
  await wacht(500);
}
/** Een pagina van dezelfde oorsprong ZONDER app (de CPU-metingen: de app zelf rekent anders mee). */
async function naarLeeg() {
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/styles.css` });
  await wacht(800);
}
async function naarApp() {
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer)').catch(() => false)) break; await wacht(200); }
  await wacht(800);
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// ---- in de pagina ----------------------------------------------------------------

/** Gedeeld door elke meting: een engine op een OfflineAudioContext, een stems.wav, Goertzel. */
const VOORAF = `
  const SR = 48000;
  const TONEN = { drums: 2000, bass: 2700, other: 3600, vocals: 5100 };
  const NAMEN4 = ['drums', 'bass', 'other', 'vocals'];
  const maakEngine = async (kanalen, lengte, opties = {}) => {
    const Echt = window.AudioContext;
    window.AudioContext = class extends OfflineAudioContext {
      constructor() { super({ numberOfChannels: kanalen, length: lengte, sampleRate: SR }); }
    };
    try { const { Engine } = await import('/src/engine/engine.js'); return new Engine(opties); } finally { window.AudioContext = Echt; }
  };
  /** Stereoparen naast elkaar, 16 bit interleaved: zoals stems.wav (docs/STEMS.md §1). */
  const wavParen = (paren) => {
    const n = paren[0][0].length, ch = paren.length * 2;
    const b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b);
    const zet = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    zet(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); zet(8, 'WAVE'); zet(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, SR, true); v.setUint32(28, SR * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); zet(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const pcm = new Int16Array(b, 44);
    for (let i = 0; i < n; i++) for (let k = 0; k < paren.length; k++) {
      pcm[i * ch + 2 * k] = Math.round(paren[k][0][i] * 32767); pcm[i * ch + 2 * k + 1] = Math.round(paren[k][1][i] * 32767);
    }
    return b;
  };
  /** Vier stems van 3 s, elk een eigen toon van 0,2. */
  const stemsWav = () => wavParen(NAMEN4.map((nm) => {
    const x = new Float32Array(SR * 3);
    for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin(2 * Math.PI * TONEN[nm] * i / SR);
    return [x, x];
  }));
  const goertzel = (x, hz) => {
    const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
  };
  /** Per kanaal de amplitude van elke toon, over de tweede seconde. */
  const tonenPerKanaal = (buf) => Array.from({ length: buf.numberOfChannels }, (_, k) => {
    const x = buf.getChannelData(k).subarray(SR, SR * 2);
    return Object.fromEntries(NAMEN4.map((nm) => [nm, goertzel(x, TONEN[nm])]));
  });
`;

/**
 * Een scène met vier stems uit een stems.wav, door de echte StreamBron en
 * worklet. `stappen` (in de pagina, krijgt d en e) zet filters, sends, cue,
 * fader; `bus` meet de INGANG van een send-bus in plaats van de zaal.
 */
const meetStems = (stappen, { kanalen = 2, bus = null, lucht = false, extra = [] } = {}) => evalueer(`(async () => {
  ${VOORAF}
  const e = await maakEngine(${kanalen}, SR * 2);
  const ctx = e.ctx, d = e.deck('A');
  const { geheugenHaal } = await import('/src/engine/bron.js');
  await d.laadStream('geheugen:stems', 'vier stems', { haal: geheugenHaal(stemsWav()), stems: { namen: NAMEN4, schaal: 1 } });
  d.play();
  ${bus ? `e.master.analyser.disconnect(); e.sends.${bus}.in.connect(ctx.destination);` : ''}
  (${stappen})(d, e);
  // De pagina's en het segment moeten in de worklet staan voordat de klok loopt.
  await new Promise((r) => setTimeout(r, 400));
  // Lucht: om de 25 ms even stil, zodat de worklet tussendoor zijn stretchers
  // kan laden (WASM, async), zoals tools/headless/keylock.mjs.
  ${lucht ? `for (let i = 1; i * 0.025 < 1.95; i++) ctx.suspend(i * 0.025).then(() => new Promise((r) => setTimeout(r, 5)).then(() => ctx.resume()));` : ''}
  const buf = await ctx.startRendering();
  const extra = Array.from({ length: buf.numberOfChannels }, (_, k) => {
    const x = buf.getChannelData(k).subarray(SR, SR * 2);
    // Het sterkste in een band van ±0,6% (een verschoven toon ligt een paar cent naast het doel; de bin is 1 Hz).
    return ${JSON.stringify(extra)}.map((hz) => { let m = 0; for (let f = hz * 0.994; f <= hz * 1.006; f += 1) m = Math.max(m, goertzel(x, f)); return m; });
  });
  return { k: tonenPerKanaal(buf), extra, beschikbaar: e.koptelefoon.beschikbaar, stand: d.stemStand(), rek: d.bron.rek };
})()`);

const db = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
const fmt = (k) => Object.entries(k).map(([n, a]) => `${n} ${db(a).toFixed(1)}`).join(' · ');
const hoor = (a) => db(a) > -40, weg = (a) => db(a) < -60;

/**
 * Een scène die op de oude code ook bestaat (zonder stemkanalen-API): een hash
 * over alle kanalen, op de oude en de nieuwe code.
 *   'zonder': vier kanalen, track 1 ZONDER stems (een toon op uitgang 0, zoals
 *             de StreamBron hem levert), in de zaal en met cue in de koptelefoon.
 *   'stems':  vier kanalen, track 2 MET vier stems, alles open, cue aan.
 *   'bus':    twee kanalen, de INGANG van de echobus (send A van track 1) en de
 *             galmbus (send B van track 2): daar hangen nu ook de stem-sends aan.
 * Twee dingen die Chrome offline NIET deterministisch doet, en die de scène
 * dus vermijdt (gemeten: anders verschilt de oude code al van zichzelf):
 *   - een ingang met twee of meer klinkende verbindingen telt ze in een
 *     willekeurige volgorde op (een hashset): 1 ULP verschil. Daarom per
 *     optelpunt één klinkende bron (één track per scène, één stem, mix 0).
 *   - timers tijdens het renderen vallen op een willekeurig moment. Het
 *     insert-effect staat op mix 0, maar zijn natte kant is cos(π/2) = 6e-17,
 *     niet 0, en de delay daarachter herankert op timers. Die natte kant gaat
 *     los vóór het renderen (meetopstelling, geen live bedrading).
 */
const SCENE_OUD = (soort) => `(async () => {
  ${VOORAF}
  const soort = ${JSON.stringify(soort)};
  const e = await maakEngine(soort === 'bus' ? 2 : 4, SR);
  const ctx = e.ctx;
  const toon = (hz, doel) => { const o = ctx.createOscillator(); o.frequency.value = hz; o.connect(doel); o.start(0); };
  const a = e.deck('A'), b = e.deck('B');
  if (soort !== 'stems') {
    toon(440, a.chain.stemIn[0]);
    a.set('fader', 0.7); a.set('filter', 0.3); a.set('trim', 0.6);
  }
  if (soort !== 'zonder') {
    toon(TONEN.vocals, b.chain.stemIn[3]);              // vier stems, alleen de zang klinkt
    b._zetStems({ namen: NAMEN4, schaal: 1 });
    b.set('fader', 0.8);
  }
  for (const d of [a, b]) d.fx.keten?.gain.disconnect();
  if (soort === 'bus') {
    a.set('sendA', 0.6); b.set('sendB', 0.4);
    e.master.analyser.disconnect();
    const m = ctx.createChannelMerger(2);
    e.sends.A.in.connect(m, 0, 0); e.sends.B.in.connect(m, 0, 1); m.connect(ctx.destination);
  } else {
    e.koptelefoon.zetPfl(soort === 'zonder' ? 'A' : 'B', true); e.koptelefoon.zetMix(0);
  }
  const buf = await ctx.startRendering();
  let h = 0x811c9dc5 >>> 0, piek = 0;
  const piekPer = [];
  for (let k = 0; k < buf.numberOfChannels; k++) {
    const x = buf.getChannelData(k);
    const u = new Uint32Array(x.slice().buffer);
    let p = 0;
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; p = Math.max(p, Math.abs(x[i])); }
    piekPer.push(p); piek = Math.max(piek, p);
  }
  return { hash: h.toString(16).padStart(8, '0'), piek, piekPer, kanalen: buf.numberOfChannels, beschikbaar: e.koptelefoon.beschikbaar };
})()`;
const SCENES = ['zonder', 'stems', 'bus'];

/**
 * CPU van acht tracks × vier stems, offline (één thread: wat de audiothread
 * zou doen). `soort`: leeg (niets speelt: wat de graaf kost als hij stil is)
 * | open (alle stems spelen, stemkanalen open) | filters (alle 32 stemfilters
 * aan) | sends (alle stem-sends open) | insert (open, plus een insert-slot per
 * stem: de vraag of dat goedkoop is). `basis` = waar de engine staat: /src, of
 * /src/_nu (de werkmap naast de oude code, zie meetCpuReeks).
 */
const CPU_SCENE = (soort, sec, basis) => `(async () => {
  const SR = 48000, TONEN = [500, 675, 900, 1275];
  const Echt = window.AudioContext;
  window.AudioContext = class extends OfflineAudioContext {
    constructor() { super({ numberOfChannels: 2, length: SR * ${sec}, sampleRate: SR }); }
  };
  let e;
  try { const { Engine } = await import('${basis}/engine/engine.js'); e = new Engine(); } finally { window.AudioContext = Echt; }
  const ctx = e.ctx;
  const { InsertSlot } = await import('${basis}/engine/fx.js');
  const soort = ${JSON.stringify(soort)};
  const NAMEN4 = ['drums', 'bass', 'other', 'vocals'];
  for (const id of soort === 'leeg' ? [] : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const d = e.deck(id);
    TONEN.forEach((hz, k) => { const o = ctx.createOscillator(); o.frequency.value = hz + k; o.connect(d.chain.stemIn[k]); o.start(0); });
    d._zetStems({ namen: NAMEN4, schaal: 1 });
    if (soort === 'filters') for (const nm of NAMEN4) d.setStemFilter(nm, 0.3);
    if (soort === 'sends') for (const nm of NAMEN4) { d.setStemSend('A', nm, 0.5); d.setStemSend('B', nm, 0.5); }
    if (soort === 'insert') d.chain.stemIn.forEach((g) => {
      const s = new InsertSlot(ctx); s._ruimOp = () => {};
      s.zetEffect('delay');                 // zoals het insert-effect van een track: mix 0, niet hoorbaar
      g.connect(s.in); s.out.connect(d.chain.trim);
    });
  }
  window.__cpu = ctx;
  return true;
})()`;

/**
 * Een CPU-scène renderen en meten in CPU-TIJD van het renderproces (CDP
 * Performance.getMetrics, ProcessTime), niet in wandkloktijd: op een drukke
 * machine (andere agenten) telt die het wachten op een kern mee. Geeft ms
 * CPU per seconde audio. Op een pagina zonder app (naarLeeg).
 */
async function meetCpu(soort, basis = '/src', sec = 10) {
  await evalueer(CPU_SCENE(soort, sec, basis));
  await wacht(150);
  const tijd = async () => (await cdp('Performance.getMetrics')).metrics.find((m) => m.name === 'ProcessTime')?.value;
  const t0 = await tijd();
  await evalueer('window.__cpu.startRendering().then(() => { window.__cpu = null; return true; })');
  const t1 = await tijd();
  return ((t1 - t0) * 1000) / sec;
}
const mediaan = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * De CPU-reeks. Met --vergelijk staan de oude code (/src) en de werkmap
 * (/src/_nu) op DEZELFDE server en pagina, en worden ze om en om gemeten:
 * op een drukke machine (andere agenten, efficiëntie- en prestatiekernen)
 * verschuift de basislijn anders tussen twee reeksen. Mediaan van vijf.
 */
async function meetCpuReeks(vergelijk) {
  const uit = {};
  const regel = (naam, xs) => console.log(`  ${naam.padEnd(14)} ${mediaan(xs).toFixed(1)} ms/s  (${xs.map((x) => x.toFixed(0)).join(' / ')})`);
  for (const soort of ['leeg', 'open']) {
    const nu = [], oud = [];
    for (let i = 0; i < 5; i++) {
      if (vergelijk) oud.push(await meetCpu(soort, '/src'));
      nu.push(await meetCpu(soort, vergelijk ? '/src/_nu' : '/src'));
    }
    if (vergelijk) { regel(`${soort} oud`, oud); uit[`${soort}Oud`] = mediaan(oud); }
    regel(`${soort} nu`, nu); uit[soort] = mediaan(nu);
  }
  for (const soort of ['filters', 'sends', 'insert']) {
    const nu = [];
    for (let i = 0; i < 5; i++) nu.push(await meetCpu(soort, vergelijk ? '/src/_nu' : '/src'));
    regel(soort, nu); uit[soort] = mediaan(nu);
  }
  return uit;
}

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
  await cdp('Performance.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await maat(1440, 900);

  // ---- 3a. de oude code (alleen met --vergelijk) ---------------------------------
  let oud = null, cpuOud = null;
  if (VERGELIJK) {
    const map = join(tmp, 'oud');
    mkdirSync(map);
    execSync(`git -C "${WORTEL}" archive ${VERGELIJK} | tar -x -C "${map}"`);
    // De werkmap ernaast, voor de CPU-meting om en om (zie meetCpuReeks).
    if (CPU) execSync(`cp -R "${join(WORTEL, 'src')}" "${join(map, 'src', '_nu')}"`);
    const s = await startServer(map);
    await naarApp();
    console.log(`de oude code (${VERGELIJK})`);
    oud = {};
    for (const soort of SCENES) {
      oud[soort] = await evalueer(SCENE_OUD(soort));
      const nogEens = await evalueer(SCENE_OUD(soort));
      oud[soort].zelfde = nogEens.hash === oud[soort].hash;
      console.log(`  scène ${soort}: hash ${oud[soort].hash} (nog eens: ${nogEens.hash}), piek ${oud[soort].piek.toFixed(3)}, ${oud[soort].kanalen} kanalen`);
    }
    if (CPU) {
      await naarLeeg();
      console.log(`\ncpu: acht tracks × vier stems, offline, ms CPU-tijd van het renderproces per s audio (mediaan van 5, oud ${VERGELIJK} en nu om en om)`);
      cpuOud = await meetCpuReeks(true);
    }
    await stopServer(s);
  }

  const server = await startServer(WORTEL);
  try {
    await naarApp();
    ok('de app start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));

    // ---- 1. geluid ------------------------------------------------------------------
    console.log('\nChrome: vier stems uit een stems.wav (OfflineAudioContext, de echte worklet)');
    const r0 = await meetStems('() => {}');
    const zaal0 = r0.k[0];
    ok('alles open: elke stem even hard in de zaal', Object.values(zaal0).every(hoor)
      && Math.max(...Object.values(zaal0).map(db)) - Math.min(...Object.values(zaal0).map(db)) < 0.1, fmt(zaal0));

    // Een eigen toon per stem (6 okt): de zang een octaaf hoger, de rest blijft.
    const rT = await meetStems("(d) => d.setStemToon('vocals', 12)", { lucht: true, extra: [10200] });
    const zaalT = rT.k[0];
    ok('toon per stem: de zang +12 — op 5100 Hz weg, op 10200 Hz bijna even hard (±5 dB: de stretcher verliest 0–4 dB op een zuivere sinus); drums, bas en overig blijven (±1,5 dB)',
      weg(zaalT.vocals) && Math.abs(db(rT.extra[0][0]) - db(zaal0.vocals)) < 5 && ['drums', 'bass', 'other'].every((n) => Math.abs(db(zaalT[n]) - db(zaal0[n])) < 1.5),
      `${fmt(zaalT)} · 10200 Hz ${db(rT.extra[0][0]).toFixed(1)} · rek ${JSON.stringify(rT.rek)}`);
    ok('… en de stand zegt het (toon zang +12)', rT.stand?.toon?.vocals === 12 && rT.stand.toon.drums === 0);
    const rG = await meetStems("(d) => d.setStemToon('inst', -12)", { lucht: true, extra: [1000, 1350, 1800] });
    ok('toon van de groep (inst, bij vier stems) −12: drums, bas en overig een octaaf lager (±5 dB), de zang blijft',
      ['drums', 'bass', 'other'].every((n) => weg(rG.k[0][n])) && rG.extra[0].every((a) => Math.abs(db(a) - db(zaal0.drums)) < 5) && Math.abs(db(rG.k[0].vocals) - db(zaal0.vocals)) < 1.5,
      `${fmt(rG.k[0])} · octaaf lager ${rG.extra[0].map((a) => db(a).toFixed(1)).join('/')}`);

    const r1 = await meetStems("(d) => d.setStemFilter('drums', 0)");
    const zaal1 = r1.k[0];
    ok('filter van de drums dicht (lowpass 250 Hz): alleen de drums gedempt, de rest precies gelijk',
      db(zaal0.drums) - db(zaal1.drums) > 30 && ['bass', 'other', 'vocals'].every((n) => Math.abs(db(zaal1[n]) - db(zaal0[n])) < 0.01),
      `drums ${(db(zaal1.drums) - db(zaal0.drums)).toFixed(1)} dB · ${fmt(zaal1)}`);

    const r1b = await meetStems("(d) => d.setStemFilter('vocals', 1)");
    ok('filter van de zang helemaal open naar rechts (highpass 9 kHz): alleen de zang gedempt',
      db(zaal0.vocals) - db(r1b.k[0].vocals) > 6 && ['drums', 'bass', 'other'].every((n) => Math.abs(db(r1b.k[0][n]) - db(zaal0[n])) < 0.01),
      `zang ${(db(r1b.k[0].vocals) - db(zaal0.vocals)).toFixed(1)} dB · ${fmt(r1b.k[0])}`);

    const r1c = await meetStems("(d) => { d.setStemFilter('inst', 0); }");
    ok('filter van de groep (inst, bij vier stems): drums, bas en overig gedempt, de zang niet',
      ['drums', 'bass', 'other'].every((n) => db(zaal0[n]) - db(r1c.k[0][n]) > 20) && Math.abs(db(r1c.k[0].vocals) - db(zaal0.vocals)) < 0.01,
      fmt(r1c.k[0]));

    const r2 = await meetStems("(d) => d.setStemSend('A', 'vocals', 1)", { bus: 'A' });
    ok('send A van de zang: aan de ingang van de echobus alleen de zang (0,2 = −14 dB)',
      Math.abs(db(r2.k[0].vocals) - db(0.2)) < 0.05 && ['drums', 'bass', 'other'].every((n) => weg(r2.k[0][n])), fmt(r2.k[0]));

    const r2b = await meetStems("(d) => d.setStemSend('B', 'vocals', 1)", { bus: 'A' });
    ok('… send B van de zang komt niet op de echobus', Object.values(r2b.k[0]).every(weg), fmt(r2b.k[0]));

    const r3 = await meetStems("(d) => { d.setStemSend('A', 'vocals', 1); d.set('fader', 0); }", { bus: 'A' });
    ok('trackfader dicht: ook de stem-send dicht (de spiegel van de fader, −70 dB)',
      Object.values(r3.k[0]).every(weg) && db(r3.k[0].vocals) < db(r2.k[0].vocals) - 60, fmt(r3.k[0]));

    const r3b = await meetStems("(d) => { d.setStemSend('A', 'vocals', 1); d.glide('fader', 0); }", { bus: 'A' });
    ok('trackfader dicht GLIJDEN (de auto-DJ, 0,5 s): na de glijbeurt ook de stem-send dicht',
      Object.values(r3b.k[0]).every(weg), fmt(r3b.k[0]));

    const r4 = await meetStems("(d) => d.setStemSend('A', 'inst', 1)", { bus: 'A' });
    ok('send A van de groep (inst): drums, bas en overig op de echobus, de zang niet',
      ['drums', 'bass', 'other'].every((n) => hoor(r4.k[0][n])) && weg(r4.k[0].vocals), fmt(r4.k[0]));

    const r5 = await meetStems("(d) => d.setStemPfl('vocals', true)", { kanalen: 4 });
    ok('vier kanalen: de koptelefoon bestaat', r5.beschikbaar && r5.k.length === 4);
    const zaal5 = await meetStems('() => {}', { kanalen: 4 });
    ok('cue op de zang: op 3/4 alleen de zang', hoor(r5.k[2].vocals) && hoor(r5.k[3].vocals)
      && ['drums', 'bass', 'other'].every((n) => weg(r5.k[2][n]) && weg(r5.k[3][n])), fmt(r5.k[2]));
    ok('… en de zaal (1/2) precies als zonder cue', ['drums', 'bass', 'other', 'vocals'].every((n) => Math.abs(db(r5.k[0][n]) - db(zaal5.k[0][n])) < 0.001),
      fmt(r5.k[0]));
    ok('zonder cue hoort de koptelefoon de zaal (alle vier)', ['drums', 'bass', 'other', 'vocals'].every((n) => hoor(zaal5.k[2][n])), fmt(zaal5.k[2]));

    const r6 = await meetStems("(d) => { d.setStemPfl('inst', true); d.setStemFilter('drums', 0); }", { kanalen: 4 });
    ok('cue op de groep (inst) met de drums gefilterd: op 3/4 bas en overig, de drums gedempt (na hun filter), de zang niet',
      hoor(r6.k[2].bass) && hoor(r6.k[2].other) && weg(r6.k[2].vocals) && db(r6.k[2].drums) < db(r6.k[2].bass) - 30, fmt(r6.k[2]));

    // ---- 3b. bit voor bit tegen de oude code --------------------------------------
    if (VERGELIJK) {
      console.log(`\nbit voor bit tegen ${VERGELIJK}`);
      const NAAM = {
        zonder: 'een track ZONDER stems: zaal en koptelefoon (cue) bit voor bit als vóór de stemkanalen',
        stems: 'een track MET vier stems, alles open: zaal en koptelefoon (cue) bit voor bit als vóór de stemkanalen',
        bus: 'de ingang van echo- en galmbus: de track-sends bit voor bit als vóór de stemkanalen (de stem-sends erbij, stil)',
      };
      for (const soort of SCENES) {
        const nieuw = await evalueer(SCENE_OUD(soort));
        ok(`${soort}: de scène is deterministisch (de oude code twee keer dezelfde hash)`, oud[soort].zelfde);
        ok(`${NAAM[soort]} (${oud[soort].hash})`, nieuw.hash === oud[soort].hash && nieuw.kanalen === oud[soort].kanalen
          && nieuw.piekPer.every((p) => p > 0.01), `nu ${nieuw.hash}, piek per kanaal ${nieuw.piekPer.map((p) => p.toFixed(3)).join(' / ')}`);
      }
    }

    // ---- 2. de rij ------------------------------------------------------------------
    console.log('\nde STEMS-rij');
    await evalueer(`(async () => {
      ${VOORAF}
      const { geheugenHaal } = await import('/src/engine/bron.js');
      await window.engine.deck('A').laadStream('geheugen:rij', 'vier stems', { haal: geheugenHaal(stemsWav()), stems: { namen: NAMEN4, schaal: 1 } });
      if (document.getElementById('stems').classList.contains('hidden')) document.getElementById('stems-btn').click();
      return true;
    })()`);
    await wacht(600);
    const LAYOUT = `(() => {
      const r = document.getElementById('stems'), W = innerWidth, H = innerHeight;
      const zicht = (e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length;
      const els = [...r.querySelectorAll('*')].filter(zicht);
      const buiten = els.filter((e) => { const b = e.getBoundingClientRect(); return b.right > W + 0.5 || b.bottom > H + 0.5 || b.left < -0.5; }).map((e) => e.className);
      const strips = [...r.querySelectorAll('.st-stem')].filter(zicht);
      // Niets in een strip steekt buiten de strip (een knop die over de rand valt, telt niet als "past").
      const uitStrip = strips.flatMap((s) => { const sb = s.getBoundingClientRect();
        return [...s.children].filter(zicht).filter((c) => { const b = c.getBoundingClientRect(); return b.right > sb.right + 0.5 || b.left < sb.left - 0.5 || b.bottom > sb.bottom + 0.5; })
          .map((c) => s.dataset.stem + ':' + c.className); });
      const klein = els.filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.className + ':' + getComputedStyle(e).fontSize);
      const kol = document.getElementById('kolommen').getBoundingClientRect();
      const fader = document.querySelector('.kol .vfader').getBoundingClientRect();
      const rb = r.getBoundingClientRect();
      const schuif = strips.map((s) => Math.round(s.querySelector('.st-niveau').getBoundingClientRect().width));
      return { buiten, uitStrip, klein, strips: strips.map((s) => s.dataset.stem).join(','), schuif,
        knoppen: r.querySelectorAll('.st-stem:not(.hidden) .st-knop').length, cues: r.querySelectorAll('.st-stem:not(.hidden) .st-cue').length,
        over: r.scrollWidth > r.clientWidth + 1, rijH: Math.round(rb.height), rijOnder: Math.round(rb.bottom),
        kolOnder: Math.round(kol.bottom), faderH: Math.round(fader.height), boven: Math.round(rb.top), H, W };
    })()`;
    for (const [b, h] of [[1440, 900], [1440, 790], [1920, 1080]]) {
      await maat(b, h);
      const l = await evalueer(LAYOUT);
      ok(`${b}×${h}: vijf strips (drums · bas · overig · zang · rest), elk met filter, echo, galm, toon en cue`,
        l.strips === 'drums,bass,other,vocals,inst' && l.knoppen === 20 && l.cues === 5, `${l.strips}, ${l.knoppen} knoppen, ${l.cues} cue`);
      ok(`${b}×${h}: de rij past (niets erbuiten, niets buiten zijn strip, geen overloop, ${l.rijH} px hoog, schuiven ${l.schuif.join('/')} px)`,
        !l.buiten.length && !l.uitStrip.length && !l.over && l.rijOnder <= l.H && Math.min(...l.schuif) >= 30,
        [...l.buiten, ...l.uitStrip].slice(0, 6).join(', '));
      ok(`${b}×${h}: geen tekst onder 11 px in de rij`, !l.klein.length, l.klein.slice(0, 5).join(', '));
      const leg = await evalueer(`getComputedStyle(document.querySelector('#stems .st-legenda')).display !== 'none'`);
      ok(`${b}×${h}: de legenda (filter · echo · galm) ${b >= 1700 ? 'staat erbij' : 'alleen in de tooltips (geen ruimte bij vier stems)'}`, leg === (b >= 1700));
      ok(`${b}×${h}: de kolommen staan boven de rij, faders ${l.faderH} px`, l.kolOnder <= l.boven + 1 && l.faderH >= 40,
        `kolommen tot ${l.kolOnder}, rij vanaf ${l.boven}`);
      await foto(`stemkanalen-rij-${b}x${h}.png`);
    }
    // Twee stems: ruimte genoeg, dus ook de legenda (filter · echo · galm).
    await evalueer(`(async () => {
      ${VOORAF}
      const { geheugenHaal } = await import('/src/engine/bron.js');
      const twee = wavParen(['vocals', 'drums'].map((nm) => { const x = new Float32Array(SR * 3);
        for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin(2 * Math.PI * TONEN[nm] * i / SR); return [x, x]; }));
      await window.engine.deck('A').laadStream('geheugen:twee', 'twee stems', { haal: geheugenHaal(twee), stems: { namen: ['vocals', 'inst'], schaal: 1 } });
      return true;
    })()`);
    await maat(1440, 790);
    await wacht(400);
    const l2 = await evalueer(LAYOUT);
    const legenda = await evalueer(`getComputedStyle(document.querySelector('#stems .st-legenda')).display !== 'none'`);
    ok('1440×790, twee stems: zang · rest, elk met filter, echo, galm, toon en cue, de legenda erbij, en alles past',
      l2.strips === 'vocals,inst' && l2.knoppen === 8 && l2.cues === 2 && legenda && !l2.buiten.length && !l2.uitStrip.length && !l2.over && !l2.klein.length,
      `${l2.strips}, schuiven ${l2.schuif.join('/')} px${l2.buiten.length ? ', buiten: ' + l2.buiten.join() : ''}`);
    await foto('stemkanalen-rij-twee-1440x790.png');
    await maat(1440, 900);
    // De knoppen volgen de bus (de renderloop leest read() per beeld), ook na een focuswissel.
    const volgt = await evalueer(`(async () => {
      const A = await import('/src/control/actions.js');
      A.invoke('track.1.stem.vocals.filter', 0.2); A.invoke('track.1.stem.inst.send.b', 0.7);
      const { knobVan } = await import('/src/ui/controls.js');
      const k = (sel) => knobVan.get(document.querySelector(sel));
      const f = k('#stems .st-stem[data-stem="vocals"] .st-filter'), g = k('#stems .st-stem[data-stem="inst"] .st-galm');
      const cue = document.querySelector('#stems .st-stem[data-stem="vocals"] .st-cue');
      // De renderloop tekent op zijn eigen tempo (headless op een drukke machine soms 3 beelden per s): wachten, niet gokken.
      const totdat = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); };
      await totdat(() => Math.abs(f.value - 0.2) < 1e-6 && Math.abs(g.value - 0.7) < 1e-6 && cue.classList.contains('dood'));
      const uit = { filter: f.value, galm: g.value, actie: f.action, cueDood: cue.classList.contains('dood') };
      window.engine.setFocus('B');
      await totdat(() => f.action === 'track.2.stem.vocals.filter');
      uit.naFocus = f.action;
      window.engine.setFocus('A');
      A.invoke('track.1.stem.vocals.filter', 0.5); A.invoke('track.1.stem.inst.send.b', 0);
      return uit;
    })()`);
    ok('de draaiknoppen in de rij volgen de bus (filter zang 0,2, galm rest 0,7) en wisselen mee met de focus',
      Math.abs(volgt.filter - 0.2) < 1e-6 && Math.abs(volgt.galm - 0.7) < 1e-6 && volgt.actie === 'track.1.stem.vocals.filter'
      && volgt.naFocus === 'track.2.stem.vocals.filter', JSON.stringify(volgt));
    ok('zonder koptelefoonuitgang (headless: twee kanalen) staat de cue dof', volgt.cueDood);

    // ---- 4. cpu (zonder --vergelijk; met: al gemeten naast de oude code) ----------
    if (CPU && !cpuOud) {
      await naarLeeg();
      console.log('\ncpu: acht tracks × vier stems, offline, ms CPU-tijd van het renderproces per s audio (mediaan van 5)');
      writeFileSync(join(UIT, 'stemkanalen-cpu.json'), JSON.stringify(await meetCpuReeks(false), null, 2));
    } else if (cpuOud) writeFileSync(join(UIT, 'stemkanalen-cpu.json'), JSON.stringify({ ...cpuOud, vergelijk: VERGELIJK }, null, 2));

    for (const m of meldingen) console.log(`  ! ${m}`);
    ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0, meldingen.length ? `${meldingen.length}` : '');
  } finally {
    await stopServer(server);
  }
} catch (err) {
  console.error(err);
  uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
