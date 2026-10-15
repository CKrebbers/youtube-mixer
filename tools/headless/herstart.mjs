// AR9 (16 okt): een herstart van de server in de Controlekamer, headless in echte Chrome. Een EIGEN server onder
// de echte herstartlus (tools/varve-app/server-lus.sh), op een eigen poort, met ALLE mappen in tmp. Dan:
//   1. de tegel Server zonder herstart: groen, geen herstartregel;
//   2. kill -9 op de server (zoals ar-val): de lus start hem opnieuw, de tegel zegt "herstart om … (viel om,
//      exitcode 137) · 1 keer sinds …" en is oranje;
//   3. de pagina herladen: dezelfde regel (hij komt van de server, niet uit het geheugen van de pagina);
//   4. SIGSTOP (zoals ar-hang): de wachter zet hem neer (hier snel ingesteld: elke 0,5 s, 1 s wachten), de tegel
//      zegt "hing, de wachter zette hem neer · 2 keer";
//   5. op 1440 en op 390 px breed: de regel loopt niet uit de tegel; geen fouten in de console (behalve de
//      netwerkfouten van Chrome tijdens de herstart, die apart geteld worden).
// Een schermafdruk per stap in de uitmap. Geen MIDI (requestMIDIAccess weg), geen mixer.
//
// Gebruik:  node tools/headless/herstart.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8916) en VARVE_KIJK_DEBUG (9516). Chrome: VARVE_CHROME, anders de headless shell
//           uit de Playwright-cache.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8916, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9516;
const B = `http://localhost:${POORT}`;
const LUS = join(WORTEL, 'tools/varve-app/server-lus.sh');
const tmp = mkdtempSync(join(tmpdir(), 'varve-herstart-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), '/opt/pw-browsers', join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(cache)) continue;
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (!shell) continue;
    const map = join(cache, shell);
    for (const sub of readdirSync(map)) {
      for (const naam of ['chrome-headless-shell', 'headless_shell']) if (existsSync(join(map, sub, naam))) return join(map, sub, naam);
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return execFileSync('which', [naam], { encoding: 'utf8' }).trim(); } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

// Alle mappen in tmp: een testserver schrijft nooit in de echte media/, opnames/, patronen/ …
const ENV = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
  VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
  VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'),
  VARVE_SETS: join(tmp, 'sets'), VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'),
  VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'),
  VARVE_HERANALYSE: 'uit', VARVE_LUS_PID: join(tmp, 'lus.pid'),
  // De wachter snel (de echte: elke 5 s, 2 s wachten, drie keer): anders duurt stap 4 ~20 s.
  VARVE_LUS_PEIL: '0.5', VARVE_LUS_PEIL_MAX: '1', VARVE_LUS_MIS: '3' };
mkdirSync(join(tmp, 'media'), { recursive: true });
const lus = spawn('sh', [LUS], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let lusLog = '';
lus.stdout.on('data', (d) => { lusLog += d; });
lus.stderr.on('data', (d) => { lusLog += d; });
const leeft = () => fetch(`${B}/api/leeft`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json(), () => null);

const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--headless=new',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

/** Een tabblad via het DevTools-protocol: cdp(), ev(), en de fouten in de console. */
async function verbind(doel) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [], logFouten = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logFouten.push(m.params.entry.text);
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  return { ws, cdp, ev, fouten, logFouten };
}
async function tot(fn, maxMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(200); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

let ctl;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ctl = await verbind(doelen.find((d) => d.type === 'page'));
  const breed = (w, h = 790) => ctl.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await breed(1440);
  await tot(async () => !!(await leeft()), 20000);
  const eerste = await leeft();

  // De tegel Server: { licht, waarde, regels: [...] } (de regel breekt op '\n', white-space: pre-line).
  const tegel = () => ctl.ev(`(() => { const t = [...document.querySelectorAll('.tegel')].find((x) => x.querySelector('.tegel-naam').textContent.trim() === 'Server');
    if (!t) return null; const r = t.querySelector('.tegel-regel');
    return { licht: t.dataset.licht, waarde: t.querySelector('.tegel-waarde').textContent.trim(),
      regels: r ? r.textContent.split('\\n').map((x) => x.replace(/\\u00a0/g, ' ').trim()).filter(Boolean) : [],
      past: r ? r.scrollWidth <= t.clientWidth + 1 && r.getBoundingClientRect().right <= t.getBoundingClientRect().right + 1 : true }; })()`);
  const foto = async (naam) => {
    const { data } = await ctl.cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(UIT, `herstart-${naam}.png`), Buffer.from(data, 'base64'));
  };

  console.log('1. zonder herstart');
  await ctl.cdp('Page.navigate', { url: `${B}/controle` });
  await tot(async () => (await tegel())?.waarde === 'draait');
  const t1 = await tegel();
  ok(`de tegel Server: groen, draait, geen herstartregel (${JSON.stringify(t1?.regels)})`, t1?.licht === 'ok' && !t1.regels.some((r) => /herstart/.test(r)));
  ok('/api/leeft: onder de lus, 0 herstarts', eerste?.lus?.onder === true && eerste.lus.aantal === 0);
  await foto('1-zonder');

  console.log('\n2. kill -9 (zoals ar-val)');
  process.kill(eerste.pid, 'SIGKILL');
  const terug = await tot(async () => { const l = await leeft(); return l && l.pid !== eerste.pid; }, 15000);
  ok('de lus startte een nieuwe server', terug);
  const nieuw = await leeft();
  ok(`/api/leeft van de nieuwe: 1 herstart, exitcode 137, geen hang (${JSON.stringify(nieuw?.lus?.herstarts)})`,
    nieuw?.lus?.aantal === 1 && nieuw.lus.herstarts.length === 1 && nieuw.lus.herstarts[0].code === 137 && !nieuw.lus.herstarts[0].hang);
  const gezien = await tot(async () => (await tegel())?.regels.some((r) => /^herstart om \d{2}:\d{2} \(viel om, exitcode 137\) · 1 keer sinds \d{2}:\d{2}$/.test(r)), 10000);
  const t2 = await tegel();
  ok(`de tegel zegt het binnen een paar seconden: "${t2?.regels[0]}"`, gezien);
  ok(`… en is oranje (net gebeurd), de waarde blijft "draait" (${t2?.licht}, ${t2?.waarde})`, t2?.licht === 'half' && t2.waarde === 'draait');
  await foto('2-viel-om');

  console.log('\n3. herladen');
  await ctl.cdp('Page.reload', { ignoreCache: true });
  await tot(async () => (await tegel())?.regels.some((r) => /^herstart om/.test(r)));
  const t3 = await tegel();
  ok(`na herladen dezelfde regel (van de server, niet uit de pagina): "${t3?.regels[0]}"`, t3?.regels[0] === t2?.regels[0] && t3.licht === 'half');

  console.log('\n4. SIGSTOP (zoals ar-hang)');
  process.kill(nieuw.pid, 'SIGSTOP');
  const neer = await tot(async () => { const l = await leeft(); return l && l.pid !== nieuw.pid; }, 20000);
  ok('de wachter zette hem neer en de lus startte een nieuwe', neer);
  const gezien4 = await tot(async () => (await tegel())?.regels.some((r) => /^herstart om \d{2}:\d{2} \(hing, de wachter zette hem neer\) · 2 keer sinds/.test(r)), 10000);
  const t4 = await tegel();
  ok(`de tegel zegt: "${t4?.regels[0]}"`, gezien4);
  await foto('4-hing');

  console.log('\n5. breedte');
  ok('op 1440 px loopt de regel niet uit de tegel', t4?.past);
  await breed(390, 844);
  await wacht(2500);
  const smal = await tegel();
  ok(`op 390 px ook niet (${smal?.regels.length} regels)`, smal?.past && smal.regels.some((r) => /hing/.test(r)));
  await foto('5-smal');
  await breed(1440);

  ok(`geen fouten van de pagina in de console (${ctl.fouten.length})`, ctl.fouten.length === 0, ctl.fouten.slice(0, 3).join(' | '));
  console.log(`  (netwerkfouten van Chrome tijdens de herstarts, apart: ${ctl.logFouten.length})`);
  ok('het log van de lus: de kill -9, de hang en twee herstarts', /exitcode 137/.test(lusLog) && /de server antwoordt niet/.test(lusLog) && /herstart 2/.test(lusLog));
} catch (err) {
  ok(`afgebroken: ${err.stack}`, false);
  console.log(lusLog.slice(-2000));
} finally {
  try { ctl?.ws.close(); } catch {}
  chrome.kill('SIGKILL');
  try { const l = await leeft(); if (l?.pid) process.kill(l.pid, 'SIGCONT'); } catch {}
  spawnSync('sh', [LUS, 'stop'], { env: ENV, timeout: 15000 });
  lus.kill('SIGKILL');
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
}
const fout = uitkomst.filter(([, g]) => !g).length;
console.log(fout ? `\n${fout} FAIL` : `\nAlle ${uitkomst.length} checks groen. Schermafdrukken in ${UIT}/herstart-*.png`);
process.exit(fout ? 1 : 0);
