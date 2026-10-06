// De auto-DJ in een headless Chromium: een set van drie demotracks (blend,
// dan filter-uit naar een track met een onzeker grid), met de AUTO-rij, de
// knoppen, en de master gemeten: nooit dode lucht.
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
//
// Gebruik:  node tools/headless/auto.mjs [uitmap]   (duurt ~2 minuten: de set speelt echt)
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
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8794, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9340;
const tmp = mkdtempSync(join(tmpdir(), 'varve-auto-'));

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
const cent = (a, b) => 1200 * Math.log2(a / b);

/** Een schermknop indrukken en loslaten zoals een muis (bindButtons luistert naar pointer-events). */
const druk = (sel, ms = 60) => evalueer(`(async () => {
  const el = document.querySelector(${JSON.stringify(sel)});
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await new Promise((r) => setTimeout(r, ${ms}));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return true;
})()`);

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
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.auto)').catch(() => false)) break; await wacht(200); }
  await wacht(800);

  console.log('opzet');
  ok('de app start met een auto-DJ, zonder MIDI', await evalueer('!!window.auto && !navigator.requestMIDIAccess'));
  ok('de AUTO-rij is standaard dicht', await evalueer("document.getElementById('auto').classList.contains('hidden')"));
  const planStatus = await evalueer("fetch('/plannen/auto-plan.json').then((r) => r.status)");
  ok(`het setplan: 200 (er is er een) of 404 (geen), nooit een fout (${planStatus})`, planStatus === 200 || planStatus === 404);

  // Een library van drie demotracks, in het geheugen geladen (de server van deze
  // proef heeft een lege library). Twee met een zeker grid, één onzeker.
  await evalueer(`(async () => {
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { ToonKaart } = await import('/src/engine/toonsoort.js');
    const e = window.engine, a = window.auto;
    const maak = (id, bpm, toon, zeker, seed) => ({ id, titel: id, audio: 'x', duur: 40 * 4 * 60 / bpm, loudness_i: -14,
      grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: zeker }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] }, _bpm: bpm, _seed: seed });
    const lib = [maak('een', 124, 'Am', 0.9, 1), maak('twee', 125, 'Em', 0.9, 2), maak('mist', 96, 'G', 0.1, 3)];
    window.__opDeck = {};
    a.haalLibrary = async () => lib;
    a.haalPlan = async () => ({ naam: 'proefset', stappen: [
      { track: 'een', speelduur: 40, waarom: 'begin' }, { track: 'twee', speelduur: 45, waarom: 'zelfde energie, toon naast elkaar' }, { track: 'mist', waarom: 'naar de stilte' }] });
    a.welkNummer = (id) => window.__opDeck[id] ?? null;
    a.laad = async (deckId, t) => {
      const d = e.deck(deckId);
      d.load(renderDemoTrack(e.ctx, { bpm: t._bpm, bars: 40, seed: t._seed }), t.titel);
      d.setGrid(t.grid); d.setToonKaart(ToonKaart.van(t.toon));
      window.__opDeck[deckId] = t.id;
    };
    // De master meten: hoe lang was het ononderbroken stil?
    window.__stil = { max: 0, sinds: null, overgangen: [] };
    a.on('overgang', (o) => { if (o.soort === 'start') return;
      o.stil = ['A', 'B'].map((id) => e.deck(id)).filter((d) => !d.playing).map((d) => ({ id: d.id, sendA: d.ui.sendA, filter: d.ui.filter, fader: d.ui.fader }));
      window.__stil.overgangen.push(o); });
    setInterval(() => {
      const p = e.masterPeak(), nu = e.ctx.currentTime, s = window.__stil;
      if (!window.auto.aan || !window.auto.hoofd) return;
      if (p < 0.003) { s.sinds ??= nu; s.max = Math.max(s.max, nu - s.sinds); } else s.sinds = null;
    }, 50);
    // Glijden (AUTO-DJ.md §2b): wat de fader van track 2 echt doet tijdens de
    // blend (AudioParam.value, elke ~10 ms) naast de knop (ui.fader, read), en
    // hoeveel glijregels de automaat op de bus zet.
    window.__glij = { proef: [], regels: 0 };
    const busOud = a._invoke;
    a._invoke = (id, v) => { if (/\.glide$/.test(id)) window.__glij.regels++; return busOud(id, v); };
    setInterval(() => {
      if (a.fase !== 'bezig' || a.volgende?.deckId !== 'B') return;
      const d = e.deck('B');
      if (!d.playing || d.wacht) return;
      window.__glij.proef.push([e.ctx.currentTime, d.chain.fader.gain.value, d.ui.fader]);
    }, 10);
    await e.resume();
    return true;
  })()`);

  console.log('de set');
  await evalueer("document.getElementById('auto-btn').click(), true");
  ok('de knop "auto" opent de rij', await evalueer("!document.getElementById('auto').classList.contains('hidden')"));
  await evalueer(`(() => { const el = document.querySelector('[data-action="auto.aan"]'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 50; i++) { if (await evalueer("window.auto.fase === 'klaar'")) break; await wacht(200); }
  const rij = () => evalueer(`(() => { const r = document.getElementById('auto'); return {
    aan: r.querySelector('.au-aan').textContent, nu: r.querySelector('.au-nu').textContent,
    volgende: r.querySelector('.au-volgende b').textContent, onder: r.querySelector('.au-volgende small').textContent,
    plan: r.querySelector('.au-plan').textContent }; })()`);
  // Headless tekent soms maar eens per paar seconden: wachten tot de rij bij is.
  let r1 = await rij();
  for (let i = 0; i < 50 && !(/▶ 1 · een/.test(r1.nu) && /→ 2/.test(r1.volgende)); i++) { await wacht(200); r1 = await rij(); }
  ok(`aan: speelt de eerste van het plan (${r1.nu})`, /aan/.test(r1.aan) && /▶ 1 · een/.test(r1.nu));
  ok(`de volgende staat klaar, met soort en aftellen (${r1.volgende} / ${r1.onder})`, /→ 2 · twee \(Em\)/.test(r1.volgende) && /lange blend · over \d+ maten · plan/.test(r1.onder));
  ok(`plan: ${r1.plan}`, r1.plan === 'proefset · 2/3');
  await foto('auto-klaar.png');

  const eerste = await (async () => { for (let i = 0; i < 600; i++) { const n = await evalueer('window.__stil.overgangen.length'); if (n >= 1) return true; await wacht(250); } return false; })();
  ok('overgang 1 (blend) is klaar: track 2 speelt alleen', eerste && await evalueer("window.auto.hoofd === 'B' && window.engine.deck('B').playing && !window.engine.deck('A').playing"));
  ok('... op het tempo van track 1 gesynct (124)', Math.abs(await evalueer("window.engine.deck('B').bpm") - 124) < 0.05);
  {
    // Glad: tijdens het opengaan stijgt de AudioParam gelijkmatig (een trapje
    // springt na elke tik van 40 ms en staat dan stil), en knop en geluid
    // lopen samen (read() = wat de AudioParam doet, op een renderblok na).
    const { proef, regels } = await evalueer('window.__glij');
    const open = proef.filter(([, , u]) => u > 0.2 && u < 0.95);
    const helling = [];
    let verschil = 0;
    for (let i = 1; i < open.length; i++) {
      const dt = open[i][0] - open[i - 1][0];
      if (dt > 0) helling.push((20 * Math.log10(open[i][1] / open[i - 1][1])) / dt);
      const knopDb = (1 - open[i][2]) * -45, echtDb = 20 * Math.log10(open[i][1]);
      verschil = Math.max(verschil, Math.abs(knopDb - echtDb));
    }
    let stil = 0, gemeten = 0;
    for (let i = 10; i < helling.length - 10; i++) {
      const gem = helling.slice(i - 10, i + 10).reduce((x, y) => x + y, 0) / 20;
      if (!(gem > 0)) continue;
      gemeten++;
      if (helling[i] < 0.25 * gem) stil++;
    }
    ok(`blend: de fader van track 2 glijdt (${gemeten} metingen, ${stil} keer (bijna) stil; ${regels} glijregels)`,
      gemeten > 100 && stil <= gemeten * 0.05 && regels > 10);
    ok(`... read() en de AudioParam lopen samen (hooguit ${verschil.toFixed(2)} dB verschil)`, verschil < 0.5);
  }
  for (let i = 0; i < 50; i++) { if (await evalueer("window.auto.fase === 'klaar'")) break; await wacht(200); }
  let r2 = await rij();
  for (let i = 0; i < 50 && !/mist/.test(r2.volgende); i++) { await wacht(200); r2 = await rij(); }
  ok(`naar het onzekere grid: filter-uit (${r2.onder})`, /filter-uit/.test(r2.onder) && /mist/.test(r2.volgende));
  await foto('auto-filter.png');
  const tweede = await (async () => { for (let i = 0; i < 600; i++) { const n = await evalueer('window.__stil.overgangen.length'); if (n >= 2) return true; await wacht(250); } return false; })();
  ok('overgang 2 (filter-uit, invallen op de 1) is klaar: mist speelt', tweede && await evalueer("window.__opDeck[window.auto.hoofd] === 'mist' && window.engine.deck(window.auto.hoofd).playing"));
  const stil = await evalueer('window.__stil.max');
  ok(`nooit dode lucht: langste stilte op de master ${(stil * 1000).toFixed(0)} ms`, stil < 0.3);
  const na = await evalueer('window.__stil.overgangen[1].stil');
  ok(`na de filter-uit staat de oude weer neutraal: echo terug, filter open, fader dicht (${JSON.stringify(na)})`,
    na.length === 1 && na[0].sendA === 0 && na[0].filter === 0.5 && na[0].fader === 0);
  await foto('auto-einde.png');

  await evalueer(`(() => { const el = document.querySelector('[data-action="auto.aan"]'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  ok('uit', await evalueer('!window.auto.aan'));
  ok('geen fouten in de console', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  console.error(err);
  uitkomst.push(['uitvoering', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} ROOD` : `\nalles groen · foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
