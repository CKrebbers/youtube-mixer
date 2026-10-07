// De klankschaal in een headless Chromium: laadt de worklet, volgt hij de
// toonsoort van de track die de maat geeft, en klinkt een veld op de goede
// toonhoogte (gemeten met een AnalyserNode achter de schaal, dus los van wat
// de track zelf laat horen).
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
//
// Gebruik:  node tools/headless/klankschaal.mjs [uitmap]
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
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8793, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9339;
const tmp = mkdtempSync(join(tmpdir(), 'varve-klankschaal-'));

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

/** De sterkste toon achter de schaal tussen lo en hi Hz (spectrum van de analyser, parabolisch geïnterpoleerd). */
const meetToon = (lo, hi) => evalueer(`(() => {
  const an = window.__ksAn, sr = window.engine.ctx.sampleRate;
  const d = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(d);
  const bin = sr / an.fftSize;
  let best = -1, max = -Infinity;
  for (let i = Math.floor(${lo} / bin); i <= Math.ceil(${hi} / bin); i++) if (d[i] > max) { max = d[i]; best = i; }
  const a = d[best - 1], b = d[best], c = d[best + 1];
  const p = 0.5 * (a - c) / (a - 2 * b + c);
  return { hz: (best + p) * bin, db: max };
})()`);
const rms = () => evalueer(`(() => { const an = window.__ksAn; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x);
  let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); })()`);

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

  console.log('dicht');
  ok('de app start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));
  ok('de rij staat standaard dicht', await evalueer("document.getElementById('klankschaal').classList.contains('hidden')"));
  ok('zonder gebruik geen worklet', await evalueer('window.engine.klankschaal.node === null'));

  console.log('open, met een track in A mineur +43 ct');
  await evalueer("window.engine.resume()");
  await evalueer("document.getElementById('klankschaal-btn').click(), true");
  for (let i = 0; i < 50; i++) { if (await evalueer('!!window.engine.klankschaal.node')) break; await wacht(100); }
  ok('openen laadt de worklet (AudioWorklet in Chrome)', await evalueer('!!window.engine.klankschaal.node'));
  ok('de rij is zichtbaar', await evalueer("!document.getElementById('klankschaal').classList.contains('hidden') && document.getElementById('klankschaal').offsetHeight > 20"));
  await evalueer(`(async () => {
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { ToonKaart } = await import('/src/engine/toonsoort.js');
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const e = window.engine, d = e.deck('A');
    d.load(renderDemoTrack(e.ctx, { bars: 8 }), 'demo in A mineur');
    d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
    d.setToonKaart(ToonKaart.metHand(21, 43));
    d.play();
    const an = e.ctx.createAnalyser(); an.fftSize = 32768; an.smoothingTimeConstant = 0;
    e.klankschaal.vol.connect(an); window.__ksAn = an;
    return true;
  })()`);
  await wacht(300);
  const tekst = await evalueer("[...document.querySelectorAll('.ks-toon > *')].map((e) => e.textContent).join(' / ')");
  ok('scherm: A mineur Kurd, van track 1, +43 ct', /^Am Kurd \/ track 1 · \+43 ct$/.test(tekst), tekst);
  const namen = await evalueer("[...document.querySelectorAll('.ks-pad span')].map((s) => s.textContent).join(' ')");
  ok('velden: kern A2, ring E3 F3 G3 A3 B3 C4 D4 E4', namen === 'A2 E3 F3 G3 A3 B3 C4 D4 E4', namen);

  await druk('[data-action="klankschaal.veld.4"]');
  await wacht(50);
  ok('veld 4 licht op na de klik', await evalueer("document.querySelector('[data-action=\"klankschaal.veld.4\"]').classList.contains('raak')"));
  await wacht(600);
  const t4 = await meetToon(180, 280);
  ok(`veld 4 klinkt op A3 +43 ct (gemeten ${t4.hz.toFixed(2)} Hz, ${cent(t4.hz, 220).toFixed(1)} ct)`, Math.abs(cent(t4.hz, 220) - 43) < 8);
  await foto('klankschaal-a-mineur.png');

  console.log('met de hand veranderen');
  await druk('[data-action="klankschaal.volg"]');
  await druk('[data-action="klankschaal.volg"]');
  ok('twee keer volg: met de hand, zelfde toon', await evalueer("window.engine.klankschaal.volg === 'hand' && window.engine.klankschaal.hand === 21"));
  await druk('[data-action="klankschaal.transpose.up"]');
  await druk('[data-action="klankschaal.transpose.up"]');
  await druk('[data-action="klankschaal.demp"]', 400);
  await wacht(300);
  const tekst2 = await evalueer("[...document.querySelectorAll('.ks-toon > *')].map((e) => e.textContent).join(' / ')");
  ok('+2: B mineur, vast, en de +43 ct van de plaat is weg (hand = zuiver)', /^Bm Kurd \+2 \/ vast$/.test(tekst2), tekst2);
  await druk('[data-action="klankschaal.veld.4"]');
  await wacht(700);
  const tb = await meetToon(200, 300);
  ok(`veld 4 klinkt nu op B3 (gemeten ${tb.hz.toFixed(2)} Hz, ${cent(tb.hz, 246.94).toFixed(1)} ct)`, Math.abs(cent(tb.hz, 246.94)) < 8);

  console.log('wrijven');
  await druk('[data-action="klankschaal.demp"]', 400);
  await wacht(800);                               // het meetvenster (0,68 s) leeg laten lopen
  const stil = await rms();
  await evalueer(`(() => { const el = document.querySelector('[data-action="klankschaal.wrijf"]'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
  await wacht(3000);
  const zingt = await rms();
  ok(`wrijven: de schaal zingt (rms ${stil.toFixed(4)} → ${zingt.toFixed(4)})`, zingt > 0.01 && zingt > stil * 5);
  await foto('klankschaal-wrijven.png');
  await evalueer(`(() => { const el = document.querySelector('[data-action="klankschaal.wrijf"]'); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  ok('loslaten: niet meer wrijven', await evalueer('!window.engine.klankschaal.wrijft'));

  console.log('laptopmaat');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
  const maat = await evalueer(`(() => {
    const r = document.getElementById('klankschaal').getBoundingClientRect();
    const k = document.getElementById('kolommen').getBoundingClientRect();
    return { onder: r.bottom, hoog: r.height, scherm: innerHeight, kolommen: k.height };
  })()`);
  ok('de rij is één regel (niet omgeslagen): alle delen op dezelfde hoogte', await evalueer(`(() => {
    const m = [...document.getElementById('klankschaal').children].map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
    return Math.max(...m) - Math.min(...m) < 12;
  })()`));
  ok(`op 1440 × 790 past de rij (onderkant ${Math.round(maat.onder)} ≤ ${maat.scherm}, ${Math.round(maat.hoog)} px hoog; kolommen ${Math.round(maat.kolommen)} px)`,
    maat.onder <= maat.scherm + 1 && maat.kolommen > 150);
  await foto('klankschaal-laptop.png');
  await evalueer("document.getElementById('klankschaal-btn').click(), true");
  await wacht(300);
  const zonder = await evalueer("document.getElementById('kolommen').getBoundingClientRect().height");
  console.log(`   ter vergelijking: kolommen zonder de rij ${Math.round(zonder)} px`);
  await foto('klankschaal-laptop-dicht.png');

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
