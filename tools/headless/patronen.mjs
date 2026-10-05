// Patronen (docs/PATRONEN.md, STUDIO S4) in een headless Chromium.
//
// 1. De app zoals hij opstart: de PATROON-rij opent, een instrument erop, een
//    stap aanklikken, een plek starten en stoppen, de modus patronen op het
//    scherm (de APC-spiegel), en de set komt op de server (met versie).
// 2. De ECHTE Web Audio van Chrome: de engine op een OfflineAudioContext, de
//    demotrack (124 bpm, een kick op elke tel, via de StreamBron zoals in de app)
//    op track 2 als maatgever, de drums op track 1 met een kick op elke tel.
//    De speler wordt elke 25 ms (audiokloktijd) bijgestuurd met ctx.suspend,
//    zoals de timer in de app. Gemeten op de AUDIOKLOK (noteOn-tijd tegen de
//    tellen van track 2) en in de OPNAME (het begin van elke kick in wat de
//    master uitgeeft), vóór en na een pitchwissel van track 2 (+3%) en een
//    sprong van 0,37 tel. Ook: zonder track op het eigen tempo (120 bpm).
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad (weggehaald
// vóór de pagina laadt), eigen server op een eigen poort met een tijdelijke
// database, media en patronen. Raakt de geluidsinstellingen van de Mac niet: de
// offline context speelt niets af.
//
// Gebruik:  node tools/headless/patronen.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8817), VARVE_KIJK_DEBUG (9417).
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache
// (macOS), anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8817, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9417;
const tmp = mkdtempSync(join(tmpdir(), 'varve-patronen-'));

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
 * De meting in de pagina: de engine op een OfflineAudioContext (stereo, 48 kHz),
 * een scenario, en wat er gepland is en wat er uitkomt.
 *
 *   s.maat    true = de demotrack op track 2 als maatgever (via laadGeheugen, de StreamBron)
 *   s.hoor    de demotrack hoorbaar (fader 1) of stil (fader 0: geeft de maat, maar de opname is alleen de kicks)
 *   s.drums   de drums op track 1 hoorbaar (fader) — 0 = alleen de demotrack meten
 *   s.op      [[t, 'pitch' | 'sprong' | 'stop'], …] gebeurtenissen op de audioklok
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
  const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
  const { Beatgrid } = await import('/src/engine/beatgrid.js');
  const { uitgangsVertraging } = await import('/src/engine/hoorbaar.js');
  const pt = e.patronen;
  pt.elke = () => null;                     // de timer is hier ctx.suspend, elke 25 ms audioklok
  const dB = e.deck('B');
  if (s.maat) {
    // De demotrack, of (alleenKick) alleen zijn kick: dezelfde formule, zonder bas,
    // hats en pad, zodat het begin van elke kick in de opname te meten is.
    const buf = s.alleenKick ? (() => {
      const spb = 60 / 124, b = ctx.createBuffer(2, Math.ceil(64 * spb * SR), SR);
      const L0 = b.getChannelData(0), R0 = b.getChannelData(1);
      for (let i = 0; i < L0.length; i++) {
        const inBeat = (i / SR / spb) % 1;
        const v = Math.tanh(Math.sin(2 * Math.PI * (45 + 110 * Math.exp(-inBeat * 45)) * inBeat * spb) * Math.exp(-inBeat * 14) * 0.9 * 0.9);
        L0[i] = v; R0[i] = v;
      }
      return b;
    })() : renderDemoTrack(ctx, { bars: 16 });
    const gelukt = await dB.laadGeheugen(buf, 'demo 124');
    if (!gelukt) throw new Error('demo niet geladen');
    dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
    dB.set('fader', s.hoor ? 1 : 0);
  }
  e.zetInstrument('A', 'drums');
  const inst = e.instrumentOp('A');
  await inst.start();
  inst.zetParam(2, 0);                      // DECAY kort (30 ms): stilte tussen de kicks, dan is het begin te meten
  e.deck('A').set('fader', s.drums ?? 1);
  const nominaal = [];
  pt.onNoot = (id, n) => nominaal.push(n.nominaal);
  // Wat er gepland wordt, met de klok erbij.
  const gepland = [];
  const echtAan = inst.noteOn.bind(inst);
  inst.noteOn = (noot, v, t) => { gepland.push(t); return echtAan(noot, v, t); };
  pt.laadSet({ tempo: 120, tracks: { 1: [{ noten: [0, 4, 8, 12].map((stap) => ({ stap, noot: 36, snelheid: 0.8 })) }] } });
  // De tellen van track 2 op de audioklok: per tel de LAATSTE voorspelling voordat
  // hij voorbij is (een segment verandert alleen vooruit, dus dat is waar hij viel).
  const tellen = new Map();
  const noteer = () => {
    if (!dB.playing || !dB.grid) return;
    const nu = ctx.currentTime;
    const b0 = Math.ceil(dB.grid.beatAt(dB.position) - 1e-9);
    for (let b = b0; b < b0 + 4; b++) { const t = dB.ctxTimeOf(dB.grid.timeOf(b)); if (t >= nu) tellen.set(b, t); }
  };
  const STAP = 0.025;
  const gebeurd = [];
  let gestart = false;
  for (let i = 1; i * STAP < s.duur - 0.05; i++) {
    const t = i * STAP;
    ctx.suspend(t).then(() => {
      for (const [op, wat] of s.op || []) {
        if (op > t - STAP + 1e-9 && op <= t + 1e-9) {
          if (wat === 'pitch') dB.setRate(dB.rate * 1.03);
          if (wat === 'sprong') dB.seek(dB.position + 0.37 * 60 / 124);
          gebeurd.push([wat, ctx.currentTime]);
        }
      }
      if (t >= 0.2 && !gestart) {
        if (s.maat && !dB.playing) dB.play();
        gestart = true;
        pt.start('A', 1);
      } else pt.tik();
      noteer();
      // Even de hoofdthread laten ademen: de StreamBron haalt zijn pagina's op.
      return new Promise((r) => setTimeout(r, 1)).then(() => ctx.resume());
    });
  }
  const buf = await ctx.startRendering();
  // Het begin van elke kick in de opname: de eerste sample boven de drempel na een stilte.
  const L = buf.getChannelData(0);
  const kicks = [];
  let stil = SR;
  for (let i = 0; i < L.length; i++) {
    if (Math.abs(L[i]) > 0.003) { if (stil > 0.15 * SR) kicks.push(i / SR); stil = 0; } else stil++;
  }
  // Elke geplande kick hoort bij een tel van track 2 (de dichtstbijzijnde).
  const telLijst = [...tellen.entries()].sort((a, b) => a[0] - b[0]);
  const bijTel = (t) => { let beste = null; for (const [b, tt] of telLijst) if (!beste || Math.abs(tt - t) < Math.abs(beste[1] - t)) beste = [b, tt]; return beste; };
  const klok = gepland.map((t) => { const [b, tt] = s.maat ? bijTel(t) : [null, null]; return { t, b, d: s.maat ? t - tt : null }; });
  return {
    gepland, klok, kicks, gebeurd, nominaal, stats: pt.stats, vertraging: ctx.graafVertraging ?? 0,
    tellen: telLijst.slice(0, 400), bron: pt.klokStand().bron,
  };
})()`);

const ms = (x) => `${(x * 1000).toFixed(3)} ms`;

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

  // ---- 1. de app ------------------------------------------------------------------------
  console.log('de app');
  ok('de app start, zonder MIDI in dit tabblad, met een speler', await evalueer('!!window.engine && !navigator.requestMIDIAccess && !!window.patronen'));
  ok('de PATROON-rij staat standaard dicht', await evalueer("document.getElementById('patronen').classList.contains('hidden')"));
  await evalueer("document.getElementById('patronen-btn').click(), true");
  await wacht(300);
  await beeld();
  ok('de knop in de balk opent de rij', await evalueer("!document.getElementById('patronen').classList.contains('hidden') && document.getElementById('patronen').offsetHeight > 20"));
  const zonder = await evalueer(`(() => { const r = document.getElementById('patronen');
    return { noot: r.querySelector('.pt-noot').textContent, dood: [...r.querySelectorAll('.pt-plek')].every((b) => b.dataset.licht === 'dood'),
      stappen: [...r.querySelectorAll('.pt-stap:not(.weg)')].length }; })()`);
  ok('zonder instrument: de rij zegt het, de plekken zijn uit, 16 stappen te zien', /geen instrument/.test(zonder.noot) && zonder.dood && zonder.stappen === 16,
    JSON.stringify(zonder));
  await evalueer("window.engine.resume().then(() => window.engine.zetInstrument('A', 'drums'))");
  await wacht(300);
  // Een pad spelen (kiest de noot), dan een stap aanklikken.
  await evalueer("window.noten.speel(37, 0.9); window.noten.laat(37); true");
  await evalueer(`(() => { const el = document.querySelector('#patronen .pt-stap[data-stap="5"]');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
  await wacht(200);
  await beeld();
  const met = await evalueer(`(() => { const r = document.getElementById('patronen');
    return { noot: r.querySelector('.pt-noot').textContent, stap5: r.querySelector('.pt-stap[data-stap="5"]').className,
      plek1: r.querySelector('.pt-plek').dataset.licht, patroon: JSON.stringify(window.patronen.patroon('A', 1)?.noten) }; })()`);
  ok('drums erop, de snare gespeeld, stap 5 aangeklikt: de snare staat op stap 5, plek 1 is gevuld', /SNARE/.test(met.noot) && /\baan\b/.test(met.stap5)
    && met.plek1 === 'half' && /"stap":4,"noot":37/.test(met.patroon), JSON.stringify(met));
  await wacht(1500);
  const opServer = await fetch(`http://localhost:${POORT}/api/patronen/set`).then((r) => r.json()).catch(() => null);
  ok('de set staat op de server (met versie), de snare erin', !!opServer?.versie && opServer.set.tracks['1'][0].noten.some((n) => n.stap === 4 && n.noot === 37)
    && opServer.set.instrumenten['1'] === 'drums');
  ok('… en de rij zegt "bewaard"', /bewaard/.test(await evalueer("document.querySelector('#patronen .pt-opslag').textContent")));
  // Starten met de plek-knop (zonder maatgever: meteen), dan stoppen.
  await evalueer(`(() => { const b = document.querySelector('#patronen .pt-plek');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  await wacht(700);
  await beeld();
  const speelt = await evalueer("({ st: window.patronen.stand('A'), n: window.patronen.stats.noten, licht: document.querySelector('#patronen .pt-plek').dataset.licht, kop: !!document.querySelector('#patronen .pt-stap.kop') })");
  ok('plek 1 aangeklikt: hij speelt (zonder maatgever meteen), het lampje brandt, de afspeelkop loopt', speelt.st.speelt === 1 && speelt.licht === 'aan' && speelt.kop,
    JSON.stringify(speelt));
  // De modus patronen op het scherm (de spiegel van de APC).
  await evalueer("window.lagen.zet('grid', 'patronen'), true");
  await wacht(300);
  await beeld();
  const spiegel = await evalueer(`(() => { const pads = [...document.querySelectorAll('button.spg[data-modus="patronen"]')];
    const p11 = pads.find((b) => b.dataset.action === 'track.1.pattern.1');
    return { n: pads.length, p11: p11?.dataset.licht ?? null, rij: pads.filter((b) => /^patterns\\.row\\./.test(b.dataset.action)).length }; })()`);
  ok('modus patronen op het scherm: 40 plekken en 5 rijen in oranje, plek 1 van track 1 brandt', spiegel.n >= 45 && spiegel.rij === 5 && spiegel.p11 === 'aan',
    JSON.stringify(spiegel));
  await foto('patronen-rij.png');
  await evalueer("window.invoke ? true : true");
  await evalueer("window.patronen.stopAlles({ meteen: true }), true");
  await wacht(300);
  ok('alles stoppen', await evalueer("window.patronen.spelend().length === 0"));
  await evalueer("window.lagen.zet('grid', 'hotcues'), true");

  // ---- 2. de meting -----------------------------------------------------------------------
  console.log('\nChrome, OfflineAudioContext 48 kHz: drums op de tellen van de demotrack');
  const r = await meet({ duur: 16, maat: true, hoor: false, drums: 1, op: [[6.0, 'pitch'], [11.0, 'sprong']] });
  meld(`gepland ${r.gepland.length} kicks; herankerd ${r.stats.herankerd}×, te laat ${r.stats.laat}, gemist ${r.stats.gemist}; vertraging in de graaf ${ms(r.vertraging)}`);
  const voor = r.klok.filter((x) => x.t < 6), na = r.klok.filter((x) => x.t > 6 + 0.12 + 2 * 0.5 && x.t < 11), na2 = r.klok.filter((x) => x.t > 11 + 0.12 + 2 * 0.5);
  const max = (l) => Math.max(...l.map((x) => Math.abs(x.d)));
  ok(`audioklok, vóór de pitchwissel: elke kick op een tel van track 2 (${voor.length} kicks, grootste afwijking ${ms(max(voor))})`, voor.length >= 7 && max(voor) < 1e-6);
  ok(`audioklok, na +3% (vanaf de tweede tel): weer op de tel (${na.length}, ${ms(max(na))})`, na.length >= 6 && max(na) < 1e-6);
  ok(`audioklok, na een sprong van 0,37 tel: weer op de tel (${na2.length}, ${ms(max(na2))})`, na2.length >= 6 && max(na2) < 1e-6);
  // Tijdens de overgang: wat al binnen de vooruitblik gepland stond, ligt nog op het oude tempo (pitch),
  // en na een sprong glijdt de klok in een tel naar de nieuwe tellen. Alleen gemeld.
  const overgang = (t0) => r.klok.filter((x) => x.t > t0 && x.t <= t0 + 0.12 + 2 * 0.5);
  meld(`tijdens de overgang na +3%: ${overgang(6).map((x) => ms(x.d)).join(', ')} naast de tel van track 2`);
  meld(`tijdens de overgang na de sprong (0,37 tel = ${ms(0.37 * 60 / 124 / 1.03)}): ${overgang(11).map((x) => ms(x.d)).join(', ')}`);
  ok('elke kick van het patroon precies één keer, ook rond de wissel en de sprong (geen dubbele, geen gemiste)',
    r.nominaal.length === r.gepland.length && r.nominaal.every((x, i) => i === 0 || x - r.nominaal[i - 1] === 384));
  // De opname: het begin van elke kick (drempel) tegen de geplande tijd.
  const paren = r.gepland.map((t) => [t, r.kicks.find((k) => k >= t - 0.002 && k < t + 0.02)]).filter(([, k]) => k !== undefined);
  const dt = paren.map(([t, k]) => k - t);
  const med = [...dt].sort((a, b) => a - b)[dt.length >> 1];
  const spreid = Math.max(...dt.map((x) => Math.abs(x - med)));
  ok(`opname: elke geplande kick klinkt (${paren.length} van ${r.gepland.length})`, paren.length === r.gepland.length);
  ok(`opname: het begin van elke kick ligt even ver na zijn tel (${ms(med)} = de vooruitblik van de limiter + de drempel; spreiding ${ms(spreid)})`,
    spreid < 0.0005 && med >= 0 && med < 0.005);
  ok('na de pitchwissel liggen de kicks 3% dichter op elkaar (de tellen van track 2)', (() => {
    const l = r.gepland.filter((t) => t > 7.5 && t < 10.9); const d = l.slice(1).map((t, i) => t - l[i]);
    return d.length > 3 && d.every((x) => Math.abs(x - 60 / 124 / 1.03) < 1e-6);
  })());

  // De track zelf in de opname: dezelfde track (de kick van de demotrack, alleen),
  // de drums stil. Waar beginnen ZIJN kicks, gemeten op dezelfde manier? Zo is
  // het verschil tussen de twee wat je hoort: drums tegen de tellen van de track.
  const d = await meet({ duur: 16, maat: true, hoor: true, alleenKick: true, drums: 0, op: [[6.0, 'pitch'], [11.0, 'sprong']] });
  const telT = d.tellen.map(([, t]) => t).filter((t) => t > 0.3 && t < 15.8);
  const paarD = telT.map((t) => [t, d.kicks.find((k) => k >= t - 0.002 && k < t + 0.02)]).filter(([, k]) => k !== undefined);
  const dtD = paarD.map(([t, k]) => k - t);
  const medD = [...dtD].sort((a, b) => a - b)[dtD.length >> 1];
  const spreidD = Math.max(...dtD.map((x) => Math.abs(x - medD)));
  ok(`ter controle: de kicks van de track zelf beginnen even ver na zijn tellen, ook na de pitch en de sprong (${paarD.length} van ${telT.length}, ${ms(medD)}, spreiding ${ms(spreidD)})`,
    paarD.length >= telT.length - 2 && spreidD < 0.0005);
  meld(`in de opname: de drums beginnen ${ms(med)} na hun tel, de track ${ms(medD)}: de kicks vallen ${ms(med - medD)} naast die van de track`);
  ok(`in de opname: de kicks binnen 1 ms op de kicks van de track (${ms(med - medD)}, spreiding drums ${ms(spreid)}, track ${ms(spreidD)})`,
    Math.abs(med - medD) + spreid + spreidD < 0.001);

  console.log('\nzonder track: het eigen tempo');
  const z = await meet({ duur: 5, maat: false, drums: 1, op: [] });
  const dz = z.gepland.slice(1).map((t, i) => t - z.gepland[i]);
  ok(`zonder maatgever: 120 bpm, elke 0,5 s precies (${z.gepland.length} kicks, grootste afwijking ${ms(Math.max(...dz.map((x) => Math.abs(x - 0.5))))})`,
    z.gepland.length >= 8 && dz.every((x) => Math.abs(x - 0.5) < 1e-9) && z.bron === 'eigen');
  const pz = z.gepland.map((t) => [t, z.kicks.find((k) => k >= t - 0.002 && k < t + 0.02)]).filter(([, k]) => k !== undefined);
  const dzk = pz.map(([t, k]) => k - t);
  ok(`… en in de opname even ver na elke geplande tijd (spreiding ${ms(Math.max(...dzk) - Math.min(...dzk))})`, pz.length === z.gepland.length && Math.max(...dzk) - Math.min(...dzk) < 0.0005);

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
