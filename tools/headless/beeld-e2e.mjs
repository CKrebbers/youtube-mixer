// Eind-tot-eind, spoor beeld (docs/BEELD.md): VARVE → Varve-relay → de ECHTE
// Stroommachine, op deze Mac, zonder pc en zonder dependencies (het
// DevTools-protocol over een WebSocket, zoals kijk.mjs).
//
// Wat er draait:
//   - de relay uit de Stroommachine-repo: node tools/varve-relay.js 7702 --stil
//     (alleen 127.0.0.1)
//   - een eigen VARVE-server op een eigen poort met een tijdelijke database,
//     media-, opname-, patronen- en plannenmap (Clay's library blijft heel)
//   - twee headless Chromes, elk met één tabblad dat dus "vooraan" staat:
//     de Stroommachine (file://…/index.html?hub=ws://127.0.0.1:7702/app&dj,
//     WebGL via swiftshader) en VARVE (zonder requestMIDIAccess: veilig met de
//     APC aangesloten, CLAUDE.md "ÉÉN VARVE-tabblad")
//
// Wat er gecontroleerd wordt (window.__stroom.dj() in de Stroommachine):
//   fris en klok, bpm binnen 0,2 van VARVE, rondetijd < 50 ms, "varvedj · volgt
//   de klok · <bpm>" in de Live-tab, de geladen tracks in `decks`, crossfader
//   0 → 0,8 = dom A → B, een poort uit de APC-pagina "Beeld" (macro.tint),
//   beeld-status terug in VARVE, relay weg = geen fouten en geen meldingen in
//   VARVE, relay terug = vanzelf weer verbonden.
//
// Gebruik:  node tools/headless/beeld-e2e.mjs [uitmap]
// Omgeving: VARVE_STROOM_REPO (standaard ~/Projects/stroommachine),
//           VARVE_RELAY_POORT (7702), VARVE_E2E_POORT (8797),
//           VARVE_E2E_DEBUG (9347; de tweede Chrome krijgt +1), VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const REPO = process.env.VARVE_STROOM_REPO || join(homedir(), 'Projects/stroommachine');
const RELAY = Number(process.env.VARVE_RELAY_POORT) || 7702;
const POORT = Number(process.env.VARVE_E2E_POORT) || 8797;
const DEBUG = Number(process.env.VARVE_E2E_DEBUG) || 9347;
const ADRES = `ws://127.0.0.1:${RELAY}/app`;
const tmp = mkdtempSync(join(tmpdir(), 'varve-beeld-e2e-'));

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitkomst = [];
const ok = (naam, cond, extra = '') => {
  uitkomst.push([naam, !!cond]);
  console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra !== '' ? ` (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`);
};

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

/** Staat er al iets op deze poort? (Een relay van Clay, of een vorige run.) */
const poortBezet = (poort) => new Promise((r) => {
  const s = createConnection({ host: '127.0.0.1', port: poort });
  s.once('connect', () => { s.destroy(); r(true); });
  s.once('error', () => r(false));
});

/** Eén tabblad via het DevTools-protocol: evalueren, foto's, en wat er misging. */
class Tab {
  constructor(debug) { this.debug = debug; this.volg = 0; this.wachtend = new Map(); this.js = []; this.netwerk = []; }
  async verbind() {
    let doelen = null;
    for (let i = 0; i < 75 && !doelen; i++) {
      await wacht(200);
      doelen = await fetch(`http://127.0.0.1:${this.debug}/json/list`).then((r) => r.json()).catch(() => null);
    }
    const pagina = doelen.find((d) => d.type === 'page');
    this.ws = new WebSocket(pagina.webSocketDebuggerUrl);
    await new Promise((r) => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.wachtend.has(m.id)) { const w = this.wachtend.get(m.id); this.wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
      // Fouten van de pagina zelf (uitzonderingen, console.error) apart van wat
      // Chrome zelf logt (Log-domein: een mislukte WebSocket-verbinding is een
      // netwerkmelding van de browser, die geen JavaScript kan onderdrukken).
      if (m.method === 'Runtime.exceptionThrown') this.js.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.js.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') this.netwerk.push({ t: Date.now(), tekst: m.params.entry.text, bron: m.params.entry.source });
    });
    await this.cdp('Page.enable');
    await this.cdp('Runtime.enable');
    await this.cdp('Log.enable');
  }
  cdp(method, params = {}) {
    const id = ++this.volg;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fout) => this.wachtend.set(id, { ok, fout }));
  }
  async evalueer(expr) {
    const r = await this.cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async foto(naam) {
    const { data } = await this.cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
  }
  /** Wachten tot `expr` iets waars geeft (max ms); geeft de laatste waarde terug. */
  async tot(expr, ms = 20000, stap = 250) {
    const eind = Date.now() + ms;
    let v;
    do { v = await this.evalueer(expr).catch(() => null); if (v) return v; await wacht(stap); } while (Date.now() < eind);
    return v;
  }
}

const processen = [];
const start = (cmd, args, opties = {}) => { const p = spawn(cmd, args, { stdio: 'ignore', ...opties }); processen.push(p); return p; };
const chrome = (debug, extra = []) => start(zoekChrome(), [
  `--remote-debugging-port=${debug}`, `--user-data-dir=${join(tmp, `profiel-${debug}`)}`,
  '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', ...extra, 'about:blank',
]);
const startRelay = () => start(process.execPath, [join(REPO, 'tools/varve-relay.js'), String(RELAY), '--stil']);
const stopProces = (p) => new Promise((r) => { if (p.exitCode !== null) { r(); return; } p.once('exit', r); p.kill(); });

let fataal = null;
try {
  if (!existsSync(join(REPO, 'index.html')) || !existsSync(join(REPO, 'tools/varve-relay.js'))) throw new Error(`geen Stroommachine in ${REPO} (zet VARVE_STROOM_REPO)`);
  if (await poortBezet(RELAY)) throw new Error(`poort ${RELAY} is al bezet: draait er al een relay? (of zet VARVE_RELAY_POORT)`);
  if (await poortBezet(POORT)) throw new Error(`poort ${POORT} is al bezet (zet VARVE_E2E_POORT)`);

  let relay = startRelay();
  start(process.execPath, [join(WORTEL, 'server/index.js')], {
    env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
      VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
  });
  chrome(DEBUG, ['--window-size=480,270']);
  chrome(DEBUG + 1, ['--window-size=1440,900']);
  const stroom = new Tab(DEBUG);
  const varve = new Tab(DEBUG + 1);
  await stroom.verbind();
  await varve.verbind();
  for (let i = 0; i < 50; i++) { if (await poortBezet(RELAY)) break; await wacht(100); }
  for (let i = 0; i < 75; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- de Stroommachine ---------------------------------------------------------
  console.log('de Stroommachine');
  await stroom.cdp('Emulation.setDeviceMetricsOverride', { width: 480, height: 270, deviceScaleFactor: 1, mobile: false });
  await stroom.cdp('Page.navigate', { url: `file://${REPO}/index.html?hub=${encodeURIComponent(ADRES)}&dj#vast` });
  ok('de Stroommachine start met &dj', await stroom.tot('!!(window.__stroom && window.__stroom.dj && window.__stroom.dj().aan)', 30000));

  // ---- VARVE, met het relay-adres in de instellingen ---------------------------
  console.log('\nVARVE');
  await varve.cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await varve.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await varve.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  await varve.tot('!!(window.engine && window.beeld)', 30000);
  // Zoals Clay het instelt: in de BEELD-rij (localStorage), dan herladen.
  await varve.evalueer(`localStorage.setItem('varve.beeld.aan', '1'); localStorage.setItem('varve.beeld.adres', ${JSON.stringify(ADRES)}); localStorage.setItem('varve.beeld.latentie', '0'); true`);
  await varve.cdp('Page.reload');
  await wacht(500);
  ok('VARVE start, geen MIDI in dit tabblad', await varve.tot('!!(window.engine && window.beeld) && !navigator.requestMIDIAccess', 30000));
  const v0 = await varve.tot('window.beeld.status().verbonden', 15000);
  ok('VARVE verbindt met de relay (instelling uit localStorage)', v0 === true, await varve.evalueer('JSON.stringify(window.beeld.status())'));

  // Twee nummers: de demotrack op track 1 (kant A) en 2 (kant B), met een grid
  // (de demo is 124 bpm vanaf 0; een los bestand krijgt zelf geen grid) en een
  // loop van 8 maten, want de demo duurt maar 16 maten.
  const bus = "(await import('/src/control/actions.js'))";
  const laadDemo = async (deck, nr) => {
    await varve.evalueer(`window.engine.setFocus('${deck}'); document.querySelector('#focus-deck .demo-btn').click(); true`);
    await varve.tot(`window.engine.deck('${deck}').title?.startsWith('demo ${nr}')`, 20000);
    await varve.evalueer(`(() => { const d = window.engine.deck('${deck}'); d.setGrid({ bpm: 124, firstBeat: 0 }); d.loop = { start: 0, end: 32 * 60 / 124 }; return true; })()`);
  };
  await laadDemo('A', 1);
  await laadDemo('B', 2);
  await varve.evalueer(`(async () => { const a = ${bus}; a.invoke('mixer.xfader', 0); a.invoke('track.1.play', true); a.invoke('track.1.play', false); return true; })()`);
  const speelt = await varve.tot("window.engine.deck('A').playing", 5000);
  ok('track 1 speelt (demo, 124 bpm, crossfader op A)', speelt === true);

  // ---- 1. klok, tempo, rondetijd ---------------------------------------------
  console.log('\nklok en tempo');
  let d = await stroom.tot('(s => s.fris && s.klok && s)(window.__stroom.dj())', 20000);
  const bpmVarve = await varve.evalueer("window.engine.deck('A').bpm");
  ok('de Stroommachine ontvangt VARVE (fris) en volgt de klok', !!d && d.fris === true && d.klok === true, d ? { fris: d.fris, klok: d.klok } : 'niets');
  // Het tempo neemt ze over in haar beeldlus (djTick): eerst nog haar eigen 120.
  d = await stroom.tot(`(s => Math.abs(s.bpm - ${bpmVarve}) < 0.2 && s)(window.__stroom.dj())`, 15000);
  ok('bpm binnen 0,2 van VARVE', !!d, d ? { stroom: d.bpm, varve: bpmVarve } : { stroom: await stroom.evalueer('window.__stroom.dj().bpm'), varve: bpmVarve });
  // De rondetijd: de snelste van de laatste rondes (zo rekent de Stroommachine zelf).
  // De eerste rondes vallen in het opstarten en het compileren van shaders.
  d = await stroom.tot('(s => s.rtt > 0 && s.rtt < 50 && s)(window.__stroom.dj())', 30000);
  ok('rondetijd < 50 ms', !!d, d ? `${d.rtt.toFixed(1)} ms` : `${(await stroom.evalueer('window.__stroom.dj().rtt')).toFixed(1)} ms na 30 s`);
  // En daarna 10 s lang (twee headless Chromes met swiftshader op één machine: de beeldlus is zwaar).
  const rtts = [];
  for (let i = 0; i < 20; i++) { rtts.push(await stroom.evalueer('window.__stroom.dj().rtt')); await wacht(500); }
  rtts.sort((a, b) => a - b);
  ok('rondetijd over 10 s: mediaan < 50 ms', rtts[10] < 50, `min ${rtts[0].toFixed(1)} · mediaan ${rtts[10].toFixed(1)} · max ${rtts[19].toFixed(1)} ms`);
  const tekst = await stroom.tot("(t => /volgt de klok/.test(t) && t)(document.getElementById('djState')?.textContent || '')", 30000);
  ok('de Live-tab toont "varvedj · volgt de klok · <bpm>"', typeof tekst === 'string' && /varvedj · volgt de klok · 124\.0 BPM/.test(tekst), tekst || '');
  // De tel zelf: VARVE's tel op hetzelfde moment (via het geschatte klokverschil).
  const tel = await stroom.evalueer('(s => ({ beat: s.beat, djT: s.djT, off: s.off }))(window.__stroom.dj())');
  const varveTel = await varve.evalueer(`(async () => { const { engineTel } = await import('/src/analysis/maat.js'); const { uitgangsVertraging } = await import('/src/engine/hoorbaar.js');
    const t = engineTel(window.engine, ['A','B','C','D','E','F','G','H'], uitgangsVertraging(window.engine.ctx)); return { beat: t?.beat ?? null, nu: performance.now() }; })()`);
  const verwacht = varveTel.beat + (tel.djT - varveTel.nu) * 124 / 60000;
  // De Stroommachine laat de tel binnen een tel van wat VARVE zegt (headless haalt weinig beelden; mod 32: de loop).
  const afw = (((tel.beat - verwacht) % 32) + 48) % 32 - 16;
  ok('de tel van de Stroommachine loopt met VARVE mee (afwijking < 0,35 tel)', Math.abs(afw) < 0.35, { afwijking: +afw.toFixed(3), off: +tel.off.toFixed(1) });

  // ---- 2. tracks en crossfader ----------------------------------------------------
  console.log('\ntracks en crossfader');
  d = await stroom.tot("(s => s.decks.A && s.decks.B && s)(window.__stroom.dj())", 10000);
  ok('decks bevat beide geladen tracks (stabiele id per demo)', !!d && d.decks.A?.id === 'varve:demo-0' && d.decks.B?.id === 'varve:demo-1',
    d ? { A: d.decks.A?.id, B: d.decks.B?.id } : await varve.evalueer(`JSON.stringify({ nummers: window.beeld.nummers, verstuurd: window.beeld.verstuurd,
      kant: window.engine.kant, buffer: !!window.engine.deck('A').buffer, loopt: window.beeld.loopt, verbonden: window.beeld.verbonden })`));
  d = await stroom.tot("(s => s.dom === 'A' && s)(window.__stroom.dj())", 20000);
  ok('crossfader 0: deck A bepaalt de scène, de regisseur houdt vast', !!d && d.dom === 'A' && d.hold === true, d ? { dom: d.dom, x: d.x, label: d.label } : '');
  await varve.evalueer(`(async () => { ${bus}.invoke('mixer.xfader', 0.4); return true; })()`);
  await stroom.tot('Math.abs(window.__stroom.dj().x - 0.4) < 0.01', 10000);
  const pA = await stroom.evalueer('window.__stroom.genome().p.slice(0, 4)');
  await varve.evalueer(`(async () => { ${bus}.invoke('mixer.xfader', 0.8); return true; })()`);
  d = await stroom.tot("(s => s.dom === 'B' && s)(window.__stroom.dj())", 25000);
  ok('crossfader 0 → 0,8: dom wisselt van A naar B', !!d && d.dom === 'B', d ? { dom: d.dom, x: d.x, label: d.label } : '');
  const pB = await stroom.evalueer('window.__stroom.genome().p.slice(0, 4)');
  ok('de knoppen mengen mee met de crossfader', pA.some((v, i) => Math.abs(v - pB[i]) > 1e-3));
  ok('elk nummer een eigen scène (de titel in het label)', /demo 2/.test(d?.label ?? '') && !/demo 1/.test(d?.label ?? ''));
  // De Stroommachine herladen terwijl relay en VARVE blijven: VARVE merkt het
  // aan haar beeld-status (stil, dan terug) en stuurt de tracks opnieuw.
  const herlaadT = Date.now();
  await stroom.cdp('Page.reload');
  await wacht(1000);
  // Headless (swiftshader) duurt het opstarten van de Stroommachine zelf al tientallen seconden.
  const fris = await stroom.tot('window.__stroom && window.__stroom.dj().fris', 60000);
  const frisNa = ((Date.now() - herlaadT) / 1000).toFixed(1);
  d = await stroom.tot("(s => s.aan && s.decks.A && s.decks.B && s)(window.__stroom.dj())", 30000);
  ok('de Stroommachine herladen: de tracks komen vanzelf terug', !!d && d.decks.A?.id === 'varve:demo-0' && d.decks.B?.id === 'varve:demo-1',
    d ? { A: d.decks.A?.id, B: d.decks.B?.id, dom: d.dom, frisNa: `${frisNa} s`, tracksNa: `${((Date.now() - herlaadT) / 1000).toFixed(1)} s` }
      : { fris: !!fris, frisNa: `${frisNa} s`, nu: await stroom.evalueer('JSON.stringify(window.__stroom?.dj?.())').catch(() => null) });
  d = await stroom.tot("(s => s.dom === 'B' && s)(window.__stroom.dj())", 25000);
  ok('en de crossfader staat er ook weer (0,8 = B)', !!d && d.dom === 'B' && Math.abs(d.x - 0.8) < 0.01, d ? { dom: d.dom, x: d.x } : '');

  // ---- 3. de APC-pagina "Beeld" ------------------------------------------------
  console.log('\nde APC-pagina "Beeld"');
  const tint0 = await stroom.evalueer("window.__stroom.lees('macro.tint')");
  await varve.evalueer(`(async () => { ${bus}.invoke('beeld.macro.tint', 0.83); return true; })()`);
  const tint = await stroom.tot("(v => Math.abs(v - 0.83) < 0.02 && v)(window.__stroom.lees('macro.tint'))", 10000);
  ok('beeld.macro.tint komt aan als macro.tint', typeof tint === 'number' && Math.abs(tint - 0.83) < 0.02, { voor: tint0, na: tint });
  const verstuurdVoor = await varve.evalueer('window.beeld.status().verstuurd');
  await varve.evalueer(`(async () => { const a = ${bus}; a.invoke('beeld.regie.vasthouden', true); a.invoke('beeld.regie.vasthouden', false); return true; })()`);
  ok('een regieknop gaat er bij indrukken uit (één bericht, loslaten niet)', (await varve.evalueer('window.beeld.status().verstuurd')) >= verstuurdVoor + 1);
  const st = await varve.tot("(s => s.beeld && s.beeld.volgt && s)(window.beeld.status())", 10000);
  ok('beeld-status terug in VARVE: regime, scène, volgt de klok', !!st && st.beeld.volgt === true && typeof st.beeld.regime === 'string', st ? st.beeld : '');
  await stroom.foto('beeld-e2e-stroom.png');
  await varve.foto('beeld-e2e-varve.png');

  // ---- 4. relay weg en terug ---------------------------------------------------------
  console.log('\nrelay weg en terug');
  const jsVoor = varve.js.length;
  const meldVoor = await varve.evalueer("document.querySelectorAll('#meldingen .melding').length");
  await stopProces(relay);
  const weg = Date.now();
  const nietVerbonden = await varve.tot('!window.beeld.status().verbonden', 5000);
  ok('relay weg: VARVE weet het (niet verbonden)', nietVerbonden === true);
  await wacht(25000);
  ok('relay weg: geen JavaScript-fouten in VARVE', varve.js.length === jsVoor, varve.js.slice(jsVoor).join(' | '));
  const meldNa = await varve.evalueer("document.querySelectorAll('#meldingen .melding').length");
  ok('relay weg: geen nieuwe meldingen in 25 s', meldNa <= meldVoor, { voor: meldVoor, na: meldNa });
  const pogingen = varve.netwerk.filter((n) => n.t >= weg && /WebSocket/.test(n.tekst)).length;
  ok('herverbinden zonder regen: hooguit 6 pogingen in 25 s (1, 2, 4, 8, 10 s …)', pogingen <= 6, `${pogingen} pogingen (Chrome logt elke mislukte poging zelf)`);
  ok('de muziek speelt door', await varve.evalueer("window.engine.deck('A').playing") === true);
  relay = startRelay();
  const terug = await varve.tot('window.beeld.status().verbonden', 20000);
  ok('relay terug: VARVE verbindt vanzelf weer', terug === true);
  d = await stroom.tot('(s => s.fris && s.klok && s)(window.__stroom.dj())', 25000);
  ok('en de Stroommachine volgt weer de klok', !!d && d.klok === true);

  ok('VARVE: geen JavaScript-fouten in de hele run', varve.js.length === 0, varve.js.join(' | '));
} catch (err) {
  fataal = err;
  console.log(`FAIL  ${err.message}`);
} finally {
  for (const p of processen) { try { p.kill(); } catch (_) {} }
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

const fout = uitkomst.filter(([, g]) => !g).length + (fataal ? 1 : 0);
console.log(`\n${uitkomst.length} checks — ${fout ? `${fout} FAIL` : 'alles groen'}`);
process.exit(fout ? 1 : 0);
