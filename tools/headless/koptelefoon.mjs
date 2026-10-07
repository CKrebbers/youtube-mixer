// De koptelefoon (docs/STUDIO.md §3) in een headless Chromium.
//
// 1. De app zoals hij opstart: de rij opent, en zonder uitgang met vier
//    kanalen zegt hij dat er geen koptelefoon is (de cue-knoppen staan uit).
// 2. De ECHTE Web Audio van Chrome met vier kanalen: de engine op een
//    OfflineAudioContext van 4 kanalen (zijn destination heeft
//    maxChannelCount 4, zoals een samengesteld apparaat). Track 1 speelt
//    440 Hz met de fader DICHT, track 2 speelt 1000 Hz open. Gemeten per
//    kanaal: de zaal (1/2) hoort alleen 1000 Hz, de koptelefoon (3/4) met de
//    cue op track 1 alleen 440 Hz; zonder cue de zaal; mix in het midden
//    beide; omgewisseld andersom. Dat is wat de mock in engine.test niet kan:
//    splitter, merger en een discrete uitgang zoals Chrome ze echt doet.
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
// Raakt de geluidsinstellingen van de Mac niet: de offline context speelt niets af.
//
// Gebruik:  node tools/headless/koptelefoon.mjs [uitmap]
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
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8799, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9343;
const tmp = mkdtempSync(join(tmpdir(), 'varve-koptelefoon-'));

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

/**
 * De engine op een OfflineAudioContext van vier kanalen, een scenario
 * uitvoeren, renderen, en per kanaal de amplitude van 440 en 1000 Hz meten
 * (Goertzel over de tweede seconde: de cue-overgang en de knoppen liggen
 * dan ver achter ons).
 */
const meet = (scenario, opties = {}) => evalueer(`(async () => {
  const Echt = window.AudioContext;
  const SR = 48000, N = SR * 2;
  window.AudioContext = class extends OfflineAudioContext {
    constructor() { super({ numberOfChannels: 4, length: N, sampleRate: SR }); }
  };
  let e;
  try {
    const { Engine } = await import('/src/engine/engine.js');
    e = new Engine(${JSON.stringify(opties)});
  } finally { window.AudioContext = Echt; }
  // De limiter-worklet laadt async (docs/MASTER.md): eerst erin, anders wisselt
  // hij ergens midden in het renderen van de compressor naar de worklet.
  await e.master.klaar;
  const ctx = e.ctx;
  const toon = (hz, deck) => { const o = ctx.createOscillator(); o.frequency.value = hz; o.connect(e.deck(deck).chain.input); o.start(0); };
  toon(440, 'A');
  toon(1000, 'B');
  e.deck('A').set('fader', 0);              // track 1: fader dicht, de zaal hoort hem niet
  e.deck('B').set('fader', 1);
  const kt = e.koptelefoon;
  const s = ${JSON.stringify(scenario)};
  if (s.cue) kt.zetPfl('A', true);
  if (s.cueB) kt.zetPfl('B', true);
  if (s.mix != null) kt.zetMix(s.mix);
  if (s.niveau != null) kt.zetNiveau(s.niveau);
  const buf = await ctx.startRendering();
  const goertzel = (x, hz) => {
    const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
  };
  const kanalen = [];
  for (let k = 0; k < buf.numberOfChannels; k++) {
    const x = buf.getChannelData(k).subarray(SR, SR * 2);
    kanalen.push({ a440: goertzel(x, 440), a1000: goertzel(x, 1000) });
  }
  return { beschikbaar: kt.beschikbaar, kanalen: buf.numberOfChannels, max: ctx.destination.maxChannelCount,
    count: ctx.destination.channelCount, interp: ctx.destination.channelInterpretation, k: kanalen };
})()`);

const db = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
const fmt = (k) => k.map((c, i) => `${i + 1}: 440 ${db(c.a440).toFixed(0)} dB · 1000 ${db(c.a1000).toFixed(0)} dB`).join(' | ');
/** Hoorbaar = boven −40 dB; weg = onder −60 dB (de fader dicht is −70 dB). */
const hoor = (a) => db(a) > -40, weg = (a) => db(a) < -60;

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

  console.log('de app');
  ok('de app start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));
  ok('de rij staat standaard dicht', await evalueer("document.getElementById('koptelefoon').classList.contains('hidden')"));
  await evalueer("document.getElementById('koptelefoon-btn').click(), true");
  await wacht(300);
  ok('de knop in de balk opent de rij', await evalueer("!document.getElementById('koptelefoon').classList.contains('hidden') && document.getElementById('koptelefoon').offsetHeight > 20"));
  // Twee beelden van de renderloop afwachten: die tekent de rij.
  const beelden = await evalueer(`Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    new Promise((r) => setTimeout(() => r(false), 3000))])`);
  ok('de renderloop tekent (requestAnimationFrame loopt)', beelden);
  const stand = await evalueer(`(() => { const k = window.engine.koptelefoon; return { b: k.beschikbaar, n: k.kanalen,
    tekst: document.querySelector('#koptelefoon .kp-stand').textContent,
    dood: [...document.querySelectorAll('#koptelefoon .kp-pfl')].filter((b) => b.classList.contains('dood')).length }; })()`);
  if (!stand.b) {
    ok('zonder vier kanalen: de rij zegt het, alle acht cue-knoppen uit', /geen koptelefoonuitgang/.test(stand.tekst) && stand.dood === 8,
      `"${stand.tekst}", ${stand.dood} uit`);
  } else {
    ok('met vier kanalen: de rij zegt waar zaal en koptelefoon zitten', /zaal 1\/2 · koptelefoon 3\/4/.test(stand.tekst), `"${stand.tekst}"`);
  }
  await foto('koptelefoon-rij.png');

  console.log('\nChrome, vier kanalen (OfflineAudioContext)');
  const r0 = await meet({});
  ok('de engine ziet vier kanalen: koptelefoon beschikbaar, uitgang 4 kanalen discrete',
    r0.beschikbaar && r0.kanalen === 4 && r0.count === 4 && r0.interp === 'discrete', `max ${r0.max}, count ${r0.count}, ${r0.interp}`);
  ok('zonder cue: de zaal (1/2) hoort track 2 en niet track 1 (fader dicht)',
    hoor(r0.k[0].a1000) && hoor(r0.k[1].a1000) && weg(r0.k[0].a440) && weg(r0.k[1].a440), fmt(r0.k.slice(0, 2)));
  ok('zonder cue: de koptelefoon (3/4) hoort de zaal', hoor(r0.k[2].a1000) && hoor(r0.k[3].a1000) && weg(r0.k[2].a440), fmt(r0.k.slice(2)));

  const r1 = await meet({ cue: true, mix: 0 });
  ok('cue op track 1, mix 0: de koptelefoon hoort alleen track 1, ook met zijn fader dicht',
    hoor(r1.k[2].a440) && hoor(r1.k[3].a440) && weg(r1.k[2].a1000) && weg(r1.k[3].a1000), fmt(r1.k.slice(2)));
  ok('… en de zaal merkt er niets van (precies als zonder cue)',
    weg(r1.k[0].a440) && weg(r1.k[1].a440) && Math.abs(db(r1.k[0].a1000) - db(r0.k[0].a1000)) < 0.01, fmt(r1.k.slice(0, 2)));

  const r2 = await meet({ cue: true, mix: 0.5 });
  ok('mix in het midden: de koptelefoon hoort allebei', hoor(r2.k[2].a440) && hoor(r2.k[2].a1000), fmt(r2.k.slice(2)));

  const r3 = await meet({ cue: true, mix: 0, niveau: 0.5 });
  const verschil = db(r1.k[2].a440) - db(r3.k[2].a440);
  ok('volume 0,8 → 0,5: zachter met de curve van een fader (13,5 dB)', Math.abs(verschil - 13.5) < 0.3, `${verschil.toFixed(2)} dB`);

  // Uitgelijnd: track 2 klinkt in de zaal (NA de limiter, 1,5 ms vooruitblik) én als cue (vóór
  // de master, met de cue-vertraging erbij). Met MIX in het midden tellen ze dan precies op; liep
  // de cue 1,5 ms voor, dan stond 1000 Hz 1,5 periode verschoven en doofden ze elkaar bijna uit.
  const c0 = await meet({ cueB: true, mix: 0 }), c1 = await meet({ cueB: true, mix: 1 }), c5 = await meet({ cueB: true, mix: 0.5 });
  const samen = Math.SQRT1_2 * (c0.k[2].a1000 + c1.k[2].a1000), verhouding = c5.k[2].a1000 / samen;
  ok('cue en zaal van dezelfde track tellen in de koptelefoon precies op (uitgelijnd op de vooruitblik van de limiter)',
    Math.abs(verhouding - 1) < 0.01, `mix ½ ${db(c5.k[2].a1000).toFixed(2)} dB, coherent verwacht ${db(samen).toFixed(2)} dB, verhouding ${verhouding.toFixed(4)}`);

  const r4 = await meet({ cue: true, mix: 0 }, { koptelefoon: { omgewisseld: true } });
  ok('omgewisseld: de koptelefoon op 1/2 (track 1), de zaal op 3/4 (track 2)',
    hoor(r4.k[0].a440) && weg(r4.k[0].a1000) && hoor(r4.k[2].a1000) && weg(r4.k[2].a440), fmt(r4.k));

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
