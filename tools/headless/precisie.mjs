// Precisie (werkruimte S1, docs/werkruimte/S1.md) in een headless Chromium.
//
// 1. De app met ?uitlijn=1: de aanhaker start, het stuk uitlijn staat in de
//    APC-mapping (⇧ Lock = mapje uitlijn, device knob k = fase van track k), en
//    zonder de vlag staat er niets van in de mapping.
// 2. De ECHTE Web Audio van Chrome (OfflineAudioContext, 48 kHz), de demotrack op
//    twee decks, track 2 7 ms vóór. Per deck een eigen kanaal (een tap na de
//    fader, vóór de crossfader): links track 1, rechts track 2. Gemeten in de
//    UITVOER met kruiscorrelatie:
//    a. na 15 tikken fase fijn (phase.offset.fine, 1/1016 tel = 0,48 ms) staat
//       track 2 minder dan 1 ms naast;
//    b. 50 tikken per seconde (phase.offset, 3,81 ms per tik) gedurende 2 s:
//       geen sprong bovenop de muziek (de grootste tweede afgeleide van de
//       uitvoer is niet meer dan 0,05 groter dan zonder duwen). Ter vergelijking
//       wat een harde knip van 3,81 ms zonder overvloei op dezelfde muziek doet.
// 3. De duoklik in de echte Web Audio: de lage tikken vallen op ctxTimeOf van de
//    maatgever, de hoge (de controleklik) op die van de track, ± 1 sample
//    (na de vooruitblik van de limiter); de toonhoogtes uit de nuldoorgangen.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad, eigen
// server op een eigen poort met een tijdelijke database en mappen. De offline
// context speelt niets af.
//
// Gebruik:  node tools/headless/precisie.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8912), VARVE_KIJK_DEBUG (8913).
// Mappen:   VARVE_PRECISIE_TMP (standaard een nieuwe map in tmpdir()).
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache (macOS),
//           anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8912, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 8913;
const basis = process.env.VARVE_PRECISIE_TMP || tmpdir();
mkdirSync(basis, { recursive: true });
const tmp = mkdtempSync(join(basis, 'varve-precisie-'));

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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'),
    VARVE_BACKUPS: join(tmp, 'backups'), VARVE_HERANALYSE: 'uit' },
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
 * Een scenario in de pagina: een eigen Engine op een OfflineAudioContext
 * (2 kanalen, 48 kHz), bus-actions van de precisie op die engine, en per deck
 * een tap na de fader naar een eigen kanaal (de master naar de uitgang los).
 *   s.duur, s.voor (track 2 zoveel s vóór), s.ticks: [[t, action, delta], ...]
 *   s.stil (zonder muziek: alleen klikken, master wel aan), s.duo (duoklik op track 2)
 */
const scenario = (s) => evalueer(`(async () => {
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
  const { Beatgrid } = await import('/src/engine/beatgrid.js');
  const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
  const bus = await import('/src/control/actions.js');
  const P = await import('/src/control/acties-precisie.js');
  P.bindPrecisie(e, { zeg: () => {} });
  const TEL = 60 / 124;
  const buf = s.stil ? ctx.createBuffer(2, Math.round(16 * SR), SR) : renderDemoTrack(ctx, { bars: 8 });
  const A = e.deck('A'), B = e.deck('B');
  for (const d of [A, B]) {
    if (!(await d.laadGeheugen(buf, 'demo ' + d.id))) throw new Error('niet geladen');
    d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  }
  A.set('fader', 1); B.set('fader', 0.9);        // track 1 geeft de maat
  A.seek(0); B.seek(s.voor || 0);
  if (!s.stil) {
    try { e.master.analyser.disconnect(); } catch (_) {}
    const merger = ctx.createChannelMerger(2);
    for (const [i, d] of [A, B].entries()) {
      const mono = ctx.createGain();
      mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
      d.chain.fader.connect(mono).connect(merger, 0, i);
    }
    merger.connect(ctx.destination);
  }
  const verwacht = { A: [], B: [] };
  const STAP = s.stap || 0.02;
  const ticks = s.ticks || [];
  let ti = 0, voerDuo = false, geenRead = 0;
  const peil = [];
  for (let i = 1; i * STAP < s.duur - 0.05; i++) {
    const t = i * STAP;
    ctx.suspend(t).then(async () => {
      if (Math.abs(t - 0.1) < STAP / 2) {
        A.play(); B.play();
        if (s.duo) { bus.invoke('track.2.duoklik', true); bus.invoke('track.2.duoklik', false); voerDuo = true; }
      }
      if (Math.abs(t - 0.1) < STAP / 2 && s.duo) {
        for (const [id, d] of [['A', A], ['B', B]]) {
          const b0 = Math.floor(d.grid.beatAt(d.position));
          for (let k = b0; k < b0 + 24; k++) verwacht[id].push(d.ctxTimeOf(k * TEL));
        }
      }
      if (voerDuo) { e.duoKlik._plan(); e.gridKlik._plan(); }
      let getikt = false;
      while (ti < ticks.length && ticks[ti][0] <= t + 1e-9) {
        const [, id, delta] = ticks[ti++];
        const r = bus.read(id);
        if (r === null) geenRead++;
        bus.invoke(id, r + delta);
        getikt = true;
      }
      if (s.peil && s.peil.some((p) => Math.abs(p - t) < STAP / 2)) peil.push([t, e.faseVerschil('B'), e.syncMaster()?.id]);
      // De samenvoegtimer (15 ms) loopt op de wandklok: geef hem de tijd, zoals de echte tijd zou doen.
      await new Promise((r) => setTimeout(r, getikt || s.wachtElke ? (s.wachtMs || 20) : 1));
      ctx.resume();
    });
  }
  const uit = await ctx.startRendering();
  return { L: Array.from(uit.getChannelData(0)), R: Array.from(uit.getChannelData(1)), verwacht,
    vertraging: ctx.graafVertraging ?? 0, eind: e.faseVerschil('B'), geenRead, peil };
})()`);

const SR = 48000;
/**
 * Vertraging (s) van y t.o.v. x in [van, tot) seconden: GENORMALISEERDE kruiscorrelatie
 * (anders wint een verschuiving die op een luider stuk valt), ±max, parabool op de piek.
 * Positief = y loopt vóór.
 */
function lag(x, y, van, tot, max = 0.015) {
  const a = Math.round(van * SR), b = Math.round(tot * SR), M = Math.round(max * SR);
  let beste = -Infinity, bi = 0;
  const c = (k) => {
    let s = 0, e = 0;
    for (let i = a; i < b; i++) { const v = y[i - k] ?? 0; s += x[i] * v; e += v * v; }
    return e > 0 ? s / Math.sqrt(e) : 0;
  };
  const r = new Map();
  for (let k = -M; k <= M; k++) { const v = c(k); r.set(k, v); if (v > beste) { beste = v; bi = k; } }
  const l = r.get(bi - 1) ?? beste, m = beste, h = r.get(bi + 1) ?? beste;
  const d = (l - h) / (2 * (l - 2 * m + h) || 1);
  return (bi + (Number.isFinite(d) ? d : 0)) / SR;
}
/** De grootste |x[i] − 2x[i−1] + x[i−2]| in [van, tot) s: een sprong in de golfvorm. */
function knik(x, van, tot) {
  let m = 0;
  for (let i = Math.max(2, Math.round(van * SR)); i < Math.round(tot * SR); i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]));
  return m;
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- 1. de app -----------------------------------------------------------------
  console.log('De app (index.html)');
  const laad = async (zoek) => {
    await cdp('Page.navigate', { url: `http://localhost:${POORT}/${zoek}` });
    for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.mapping && window.aanhakers)').catch(() => false)) break; await wacht(200); }
    return evalueer('window.aanhakers.then((u) => ({ gestart: u.gestart, mislukt: u.mislukt.map((m) => m.naam + ": " + (m.fout?.message || m.fout)) }))');
  };
  const zonder = await laad('');
  const zonderRegel = await evalueer("!!window.mapping.rules.get('cc:0:16@device.uitlijn')");
  ok('zonder ?uitlijn: de aanhaker start, maar het stuk staat niet in de mapping', zonder.gestart.includes('precisie') && !zonder.mislukt.length && !zonderRegel,
    zonder.mislukt.join('; '));
  const met = await laad('?uitlijn=1');
  const st = await evalueer(`(async () => {
    const bus = await import('/src/control/actions.js');
    const m = window.mapping;
    const r = m.rules.get('cc:0:16@device.uitlijn');
    m.shift = true;
    m.handle({ type: 'note', sig: 'note:0:63', on: true, value: 127, norm: 1 });
    m.handle({ type: 'note', sig: 'note:0:63', on: false, value: 0, norm: 0 });
    m.shift = false;
    const open = window.lagen.stand.device;
    const knop = m.kies('cc:0:17');
    const regels = [...m.rules.values()].filter((x) => x.bron === 'stuk:uitlijn').length;
    return { actie: r?.action, bron: r?.bron, open, knop: knop?.action, regels, bestaat: !!bus.metaOf('track.8.phase.offset.fine'),
      lees: bus.read('track.1.phase.offset') };
  })()`);
  ok('met ?uitlijn=1: 21 regels van stuk:uitlijn, ⇧ Lock opent het mapje, knop 2 = fase van track 2', met.gestart.includes('precisie') && !met.mislukt.length
    && st.actie === 'track.1.phase.offset' && st.bron === 'stuk:uitlijn' && st.regels === 21 && st.open === 'uitlijn' && st.knop === 'track.2.phase.offset' && st.bestaat,
    JSON.stringify(st));
  await wacht(600);
  await foto('precisie-uitlijn.png');
  await evalueer("window.lagen.zet('device', 'strip'), true");
  await laad('?uitlijn=0');
  ok('?uitlijn=0 zet hem weer uit (onthouden)', !(await evalueer("!!window.mapping.rules.get('cc:0:16@device.uitlijn')")));

  // ---- 2. duwen in de echte Web Audio ----------------------------------------------------
  console.log('\nChrome, OfflineAudioContext 48 kHz: de demotrack op twee decks, track 2 7 ms vóór');
  const TEL = 60 / 124;
  const fijn = [];
  for (let i = 0; i < 15; i++) fijn.push([1.0 + i * 0.02, 'track.2.phase.offset.fine', -1 / 127]);
  const a = await scenario({ duur: 3, voor: 0.007, ticks: fijn, wachtElke: true });
  const voorLag = lag(a.L, a.R, 0.4, 0.95), naLag = lag(a.L, a.R, 1.4, 2.9);
  ok(`voor de tikken: track 2 loopt ${(voorLag * 1000).toFixed(3)} ms vóór (7)`, Math.abs(voorLag * 1000 - 7) < 0.05);
  ok(`na 15 tikken fijn (15 × ${(TEL / 1016 * 1000).toFixed(3)} ms): ${(naLag * 1000).toFixed(3)} ms naast (< 1 ms; verwacht ${((0.007 - 15 * TEL / 1016) * 1000).toFixed(3)})`,
    Math.abs(naLag) < 0.001 && Math.abs(naLag - (0.007 - 15 * TEL / 1016)) < 0.00005);
  ok(`… en het grid zegt hetzelfde (faseVerschil ${(a.eind * 1000).toFixed(3)} ms)`, Math.abs(a.eind - naLag) < 0.00005);

  // 50 tikken per seconde: een seconde de ene kant op, even niets, een seconde terug.
  const snel = [];
  for (let i = 0; i < 50; i++) snel.push([0.5 + i * 0.02, 'track.2.phase.offset', 1 / 127]);
  for (let i = 0; i < 50; i++) snel.push([2.0 + i * 0.02, 'track.2.phase.offset', -1 / 127]);
  const [geduwd, schoon] = [await scenario({ duur: 3.6, ticks: snel, wachtElke: true, peil: [1.86] }), await scenario({ duur: 3.6, wachtElke: true })];
  const kG = knik(geduwd.R, 0.45, 3.1), kS = knik(schoon.R, 0.45, 3.1);
  if (process.env.VARVE_PRECISIE_DUMP) writeFileSync(process.env.VARVE_PRECISIE_DUMP, JSON.stringify({ L: geduwd.L, R: geduwd.R }));
  // Venster 1,75–1,95 s: track 2 loopt 0,19 s vóór, dus wat hij daar laat horen kwam van 1,56–1,76 s,
  // ná de laatste tik (1,48 s). Een vroeger venster vergelijkt met stukken die nog geduwd werden.
  const midden = lag(geduwd.L, geduwd.R, 1.75, 1.95, 0.25), terug = lag(geduwd.L, geduwd.R, 3.1, 3.5);
  ok(`50 tikken per seconde: na een seconde ${(midden * 1000).toFixed(2)} ms verschoven (50 × 3,81 = ${(50 * TEL / 127 * 1000).toFixed(2)})`, Math.abs(midden - 50 * TEL / 127) < 0.0001);
  ok(`… en weer terug (${(terug * 1000).toFixed(3)} ms)`, Math.abs(terug) < 0.0001);
  ok(`… geen tik verloren (elke tik had een stand), en het grid zegt hetzelfde (${(geduwd.peil[0][1] * 1000).toFixed(2)} ms op 1,86 s)`,
    geduwd.geenRead === 0 && Math.abs(geduwd.peil[0][1] - midden) < 0.0001);
  // Een harde knip van één tik (3,81 ms) zonder overvloei, op de luidste plek van dezelfde muziek, ter vergelijking.
  const x = schoon.R, stap = Math.round(TEL / 127 * SR);
  let harde = 0;
  for (let i = Math.round(0.5 * SR); i < Math.round(3.1 * SR); i += 37) {
    const k = Math.abs((x[i + stap] - x[i - 1]) - (x[i - 1] - x[i - 2]));
    if (k > harde) harde = k;
  }
  ok(`geen sprong bovenop de muziek: grootste knik ${kG.toFixed(4)} met duwen, ${kS.toFixed(4)} zonder (+${(kG - kS).toFixed(4)} ≤ 0,05; een harde knip zou tot ${harde.toFixed(3)} geven)`,
    kG - kS <= 0.05);

  // ---- 3. de duoklik --------------------------------------------------------------
  console.log('\nde duoklik (stille tracks, alleen de tikken; track 2 50 ms vóór)');
  const c = await scenario({ duur: 5, voor: 0.05, stil: true, duo: true, stap: 0.025 });
  const y = c.L, V = c.vertraging * SR;
  const onsets = [];
  for (let i = 300; i < y.length - 600; i++) {
    if (Math.abs(y[i]) > 1e-4) {
      let stil = true;
      for (let k = 1; k <= 200; k++) if (Math.abs(y[i - k]) > 1e-5) { stil = false; break; }
      if (stil) {
        // Toonhoogte uit de nuldoorgangen over de volgende 5 ms.
        let n = 0, eerste = null, laatste = null;
        for (let k = i + 1; k < i + 240; k++) if (y[k - 1] < 0 && y[k] >= 0) { const t = k - 1 + -y[k - 1] / (y[k] - y[k - 1]); if (eerste === null) eerste = t; else { laatste = t; n++; } }
        onsets.push({ i, f: n ? (n * SR) / (laatste - eerste) : 0 });
        i += 600;
      }
    }
  }
  // De eerste sample van een tik is 0 (de inloop begint bij 0): de tik begint één sample vóór de eerste die niet stil is.
  const bij = (lijst, i) => Math.min(...lijst.map((t) => Math.abs(i - 1 - (t * SR + V))));
  const laag = onsets.filter((o) => o.f > 400 && o.f < 1000), hoog = onsets.filter((o) => o.f > 1000);
  const fLaag = laag.map((o) => bij(c.verwacht.A, o.i)), fHoog = hoog.map((o) => bij(c.verwacht.B, o.i));
  ok(`de lage tikken (${laag.length}, ${Math.round(Math.min(...laag.map((o) => o.f)))}–${Math.round(Math.max(...laag.map((o) => o.f)))} Hz) vallen op ctxTimeOf van de maatgever: hooguit ${Math.max(...fLaag).toFixed(2)} sample naast`,
    laag.length >= 6 && fLaag.every((x) => x <= 1));
  ok(`de hoge tikken (de controleklik, ${hoog.length}, ${Math.round(Math.min(...hoog.map((o) => o.f)))}–${Math.round(Math.max(...hoog.map((o) => o.f)))} Hz) op die van track 2: hooguit ${Math.max(...fHoog).toFixed(2)} sample naast`,
    hoog.length >= 6 && fHoog.every((x) => x <= 1));
  // (De eerste lage tik, tel 0 van de maatgever op 0,1 s, heeft geen hoge: tel 0 van track 2 lag vóór de start.)
  const naEerste = laag.filter((l) => l.i > hoog[0].i);
  ok(`de flam is te horen: elke lage tik 50 ms na een hoge (${naEerste.length} paren; track 2 loopt 50 ms vóór)`,
    naEerste.length >= 6 && naEerste.every((l) => hoog.some((h) => Math.abs((l.i - h.i) / SR - 0.05) < 0.001)));

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
