// Licht een HERHAALDE melding elke keer opnieuw op? (controller-invoer, review ronde 1, 14 okt)
// meld() met een tekst die al staat stapelt niet, maar laat de melding opnieuw oplichten: het
// enige teken dat je druk (een pad die steeds "geen secties" zegt) aankwam. Zonder `offsetWidth`
// (gedwongen opmaak midden in het MIDI-bericht) moet de CSS-animatie toch elke keer opnieuw starten.
// Telt de animationstart-events in de ECHTE mixer, en ter vergelijking twee oude vormen op een
// los element: klasse eraf + rAF erop (werkte maar één keer) en offsetWidth (werkt, dwingt opmaak).
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess, eigen server, tijdelijke database.
// Gebruik:  [VARVE_CHROME=<headless_shell>] node tools/headless/meldingen.mjs
//           (poorten VARVE_MELD_POORT 8843, VARVE_MELD_DEBUG 8844)
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_MELD_POORT) || 8843, DEBUG = Number(process.env.VARVE_MELD_DEBUG) || 8844;
const HERHAAL = 6, TUSSEN = 500;
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-meld-'));
function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const sub = readdirSync(join(cache, shell)).find((d) => existsSync(join(cache, shell, d, 'chrome-headless-shell')));
  return join(cache, shell, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opn'), VARVE_HERANALYSE: 'uit', VARVE_PATRONEN: join(tmp, 'pat'), VARVE_PLANNEN: join(tmp, 'plan'), VARVE_STANDEN: join(tmp, 'standen') }, stdio: 'ignore' });
const browser = spawn(zoekChrome(), [`--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
let ws, volg = 0; const wachtend = new Map();
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, fout) => wachtend.set(id, { ok, fout })); };
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
// Een herhaling per keer, met TUSSEN ms ertussen (zoals een hand op een pad), elk in een eigen taak.
async function herhaal(expr) { for (let i = 0; i < HERHAAL; i++) { await ev(expr); await wacht(TUSSEN); } }
try {
  let doelen = null; for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); } });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await cdp('Page.bringToFront').catch(() => {});
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  for (let i = 0; i < 100; i++) { if (await ev('!!(window.engine && document.getElementById("meldingen"))').catch(() => false)) break; await wacht(200); }
  await wacht(1000);
  // 1. De echte meld() uit de mixer (zelfde module als de app gebruikt).
  await ev(`(async () => { window.__meld = (await import('/src/ui/meldingen.js')).meld; window.__starts = 0;
    document.getElementById('meldingen').addEventListener('animationstart', () => window.__starts++); window.__meld('proef: geen secties', 'info', 60000); return true; })()`);
  await wacht(TUSSEN);
  await herhaal(`(window.__meld('proef: geen secties', 'info', 60000), true)`);
  const echt = await ev('window.__starts');
  const stapel = await ev(`[...document.getElementById('meldingen').children].filter((m) => m.firstChild?.textContent === 'proef: geen secties').length`);
  ok(`meld(): elke herhaling licht opnieuw op`, echt === HERHAAL, `${echt} van ${HERHAAL} animationstart`);
  ok('meld(): een herhaling stapelt niet', stapel === 1, `${stapel} melding(en)`);
  // Leest meld() bij een herhaling opmaak uit (dat dwingt Chrome alles METEEN uit te rekenen)?
  const gelezen = await ev(`(() => { let n = 0; const terug = [];
    const tel = (proto, naam) => { const d = Object.getOwnPropertyDescriptor(proto, naam); if (!d) return;
      Object.defineProperty(proto, naam, { ...d, ...(d.get ? { get() { n++; return d.get.call(this); } } : { value(...a) { n++; return d.value.apply(this, a); } }) });
      terug.push(() => Object.defineProperty(proto, naam, d)); };
    for (const k of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'getBoundingClientRect']) tel(HTMLElement.prototype, k) || tel(Element.prototype, k);
    for (const k of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'getBoundingClientRect', 'getClientRects']) tel(Element.prototype, k);
    const gcs = window.getComputedStyle; window.getComputedStyle = (...a) => { n++; return gcs(...a); };
    try { window.__meld('proef: geen secties', 'info', 60000); } finally { terug.forEach((f) => f()); window.getComputedStyle = gcs; }
    return n; })()`);
  ok('meld(): een herhaling leest geen opmaak uit (geen gedwongen opmaak in het MIDI-bericht)', gelezen === 0, `${gelezen} keer gelezen`);
  await wacht(TUSSEN);
  // Een fout ook (die blijft staan tot je klikt; juist daar moet je zien dat hij terugkwam).
  await ev(`(window.__starts = 0, window.__meld('proef: stream hapert', 'fout'), true)`);
  await wacht(TUSSEN);
  await herhaal(`(window.__meld('proef: stream hapert', 'fout'), true)`);
  const fout = await ev('window.__starts');
  ok('meld() met een fout: elke herhaling licht opnieuw op', fout === HERHAAL, `${fout} van ${HERHAAL}`);
  // 2. Ter vergelijking (geen eis aan de app): de twee oude vormen op een los element met dezelfde CSS.
  const los = (code) => `(() => { const el = window.__los; ${code}; return true; })()`;
  const maakLos = `(() => { const el = document.createElement('div'); el.className = 'melding info'; el.textContent = 'los';
    document.getElementById('meldingen').append(el); window.__los = el; window.__starts = 0; return true; })()`;
  await ev(maakLos);
  await herhaal(los(`el.classList.remove('flits'); requestAnimationFrame(() => el.classList.add('flits'))`));
  const raf = await ev('window.__starts');
  await ev('(window.__los.remove(), true)'); await ev(maakLos);
  await herhaal(los(`el.classList.remove('flits'); void el.offsetWidth; el.classList.add('flits')`));
  const offset = await ev('window.__starts');
  await ev('(window.__los.remove(), true)');
  console.log(`      ter vergelijking: klasse eraf + rAF erop ${raf} van ${HERHAAL}; offsetWidth (gedwongen opmaak) ${offset} van ${HERHAAL}`);
  ok('de meting zelf onderscheidt: offsetWidth start elke keer, klasse eraf + rAF niet', offset === HERHAAL && raf < HERHAAL, `rAF ${raf}, offsetWidth ${offset}`);
} catch (e) { console.error(e); uitkomst.push(['script', false]); } finally { try { ws?.close(); } catch {} browser.kill('SIGKILL'); server.kill('SIGINT'); await wacht(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
