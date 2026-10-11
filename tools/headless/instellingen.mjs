// De zeven instrument-sleutels in echte Chrome (extra-3 B4, src/ui/instellingen-opslag.js):
//
//   1. Een NIEUW Chrome-profiel (lege localStorage) tegen een server die de
//      sleutels al heeft: de mixer start, het beeldpaneel toont het adres en de
//      latentie van de server, en een wijziging in het paneel staat binnen een
//      seconde weer op de server.
//   2. Een browser die de sleutels al had, tegen een LEGE server (een tweede
//      server, dus een andere oorsprong): ze gaan één keer omhoog.
//
// VEILIG MET DE APC AANGESLOTEN: requestMIDIAccess wordt vóór het laden weggehaald.
// Eigen servers op eigen poorten met tijdelijke databases; Clay's library wordt
// niet aangeraakt. De tijdelijke map blijft staan (niets verwijderen); hij staat
// in de tijdelijke map van het systeem (TMPDIR).
//
// Gebruik:  node tools/headless/instellingen.mjs
//           VARVE_INST_POORT (standaard 8872; de tweede server +1), VARVE_INST_DEBUG (9872), VARVE_CHROME
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_INST_POORT) || 8872, POORT2 = POORT + 1;
const DEBUG = Number(process.env.VARVE_INST_DEBUG) || 9872;
const tmp = mkdtempSync(join(tmpdir(), 'varve-instellingen-'));
const { Library } = await import('../../server/library.js');

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Server 1 heeft de sleutels al (zoals na een herstel uit een backup).
const ADRES = 'ws://localhost:7702/app';
{
  const lib = new Library(join(tmp, 'een.db'));
  lib.zet('varve.beeld.adres', ADRES);
  lib.zet('varve.beeld.latentie', '15');
  lib.zet('varve.koptelefoon.omgewisseld', '1');
  lib.zet('varve.stems.standaard', '4');
  lib.sluit();
}
const startServer = (poort, db) => spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(tmp, db), VARVE_MEDIA: join(tmp, `media-${poort}`),
    VARVE_OPNAMES: join(tmp, `opnames-${poort}`), VARVE_PATRONEN: join(tmp, `patronen-${poort}`), VARVE_PLANNEN: join(tmp, `plannen-${poort}`),
    VARVE_PROEF: join(tmp, `proef-${poort}`), VARVE_BACKUPS: join(tmp, `backups-${poort}`), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const servers = [startServer(POORT, 'een.db'), startServer(POORT2, 'twee.db')];
const chrome = spawn(zoekChrome(), [
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
async function wachtOpApp(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer('!!(window.engine && window.videoMixer)').catch(() => false)) return true; await wacht(200); }
  return false;
}
const serverInst = (poort) => fetch(`http://localhost:${poort}/api/instellingen`).then((r) => r.json()).then((j) => j.instellingen).catch(() => null);

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

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
  // Geen MIDI; en op de TWEEDE server (andere oorsprong) een browser die de sleutels al had, vóór de app laadt.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;
    if (location.port === '${POORT2}' && !localStorage.getItem('varve.al.gezet')) {
      localStorage.setItem('varve.al.gezet', '1');
      localStorage.setItem('varve.stems.standaard', '0');
      localStorage.setItem('varve.koptelefoon.omgewisseld', '1');
      localStorage.setItem('varve.beeld.latentie', '-20');
    }` });
  for (const p of [POORT, POORT2]) for (let i = 0; i < 75; i++) { if (await fetch(`http://localhost:${p}/api/instellingen`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- 1. nieuw profiel, server met sleutels ------------------------------
  console.log('nieuw Chrome-profiel, de server heeft de sleutels');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  ok('de mixer start', await wachtOpApp());
  const ls = await evalueer(`({ adres: localStorage.getItem('varve.beeld.adres'), lat: localStorage.getItem('varve.beeld.latentie'),
    kop: localStorage.getItem('varve.koptelefoon.omgewisseld'), stems: localStorage.getItem('varve.stems.standaard') })`);
  ok('de sleutels van de server staan nu in localStorage', ls.adres === ADRES && ls.lat === '15' && ls.kop === '1' && ls.stems === '4', JSON.stringify(ls));
  const velden = await evalueer(`({ adres: document.querySelector('#beeld .bd-adres').value, lat: document.querySelector('#beeld .bd-latentie').value })`);
  ok('het beeldpaneel toont adres en latentie van de server', velden.adres === ADRES && velden.lat === '15', JSON.stringify(velden));
  ok('de stems-keuze in de library-strook staat op die van de server (4)',
    await evalueer(`document.querySelector('[data-stems-keuze="4"]')?.getAttribute('aria-pressed') === 'true'`));
  // De stems-keuze in de strook veranderen (geen = 0): binnen een seconde op de server.
  await evalueer(`document.querySelector('[data-stems-keuze="0"]').click()`);
  // In het paneel de latentie veranderen: binnen een seconde op de server.
  await evalueer(`(() => { const v = document.querySelector('#beeld .bd-latentie'); v.value = '25'; v.dispatchEvent(new Event('change')); })()`);
  let na = null;
  for (let i = 0; i < 20; i++) { await wacht(100); na = await serverInst(POORT); if (na?.['varve.beeld.latentie'] === '25') break; }
  for (let i = 0; i < 20 && na?.['varve.stems.standaard'] !== '0'; i++) { await wacht(100); na = await serverInst(POORT); }
  ok('latentie 25 in het paneel: op de server', na?.['varve.beeld.latentie'] === '25', JSON.stringify(na));
  ok('stems "geen" in de strook: op de server (0)', na?.['varve.stems.standaard'] === '0');
  ok('…en de rest is niet veranderd', na?.['varve.beeld.adres'] === ADRES && na?.['varve.koptelefoon.omgewisseld'] === '1');
  ok('niets meer onverzonden', await evalueer(`localStorage.getItem('varve.instellingen.onverzonden') === null`));
  ok('geen fouten', meldingen.length === 0, meldingen.join(' | '));
  meldingen.length = 0;

  // ---- 2. gevulde browser, lege server -------------------------------------
  console.log('\nde browser had ze al, de server is leeg');
  ok('server 2 is leeg', Object.keys((await serverInst(POORT2)) || { x: 1 }).length === 0);
  await cdp('Page.navigate', { url: `http://localhost:${POORT2}/` });
  ok('de mixer start', await wachtOpApp());
  // Het master-paneel schrijft bij de eerste frame zijn (standaard)rack: dat mag erbij staan, verder niets.
  const drie = (j) => j && JSON.stringify(['varve.stems.standaard', 'varve.koptelefoon.omgewisseld', 'varve.beeld.latentie'].map((k) => j[k]));
  const twee = await serverInst(POORT2);
  ok('één keer omhoog: de drie die de browser had', drie(twee) === JSON.stringify(['0', '1', '-20'])
    && Object.keys(twee).every((k) => ['varve.stems.standaard', 'varve.koptelefoon.omgewisseld', 'varve.beeld.latentie', 'varve.master.rack'].includes(k)), JSON.stringify(twee));
  await cdp('Page.reload');
  await wacht(300);
  ok('herladen: de mixer start weer', await wachtOpApp());
  ok('…en die drie zijn op de server hetzelfde gebleven', drie(await serverInst(POORT2)) === drie(twee));
  ok('geen fouten', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); for (const s of servers) s.kill();
  await wacht(300);
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. (tijdelijke map: ${tmp})`);
process.exit(rood ? 1 : 0);
