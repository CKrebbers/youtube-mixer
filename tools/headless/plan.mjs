// Het planvenster in een headless Chromium: de mixer opent plan.html (knop
// "plan"), het venster toont het plan met de voorspelling, bewerkt en slaat op,
// zet de auto-DJ aan en volgt hem live; een wijziging van buitenaf (Claude
// schrijft het bestand) komt vanzelf binnen, en een botsing wordt gemeld.
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
//
// Gebruik:  node tools/headless/plan.mjs [uitmap]
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache
// (macOS), anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8795, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9341;
const tmp = mkdtempSync(join(tmpdir(), 'varve-plan-'));
mkdirSync(join(tmp, 'plannen'), { recursive: true });
const PLAN = { naam: 'auto-plan', stappen: [
  { id: 's1', track: 'een', speelduur: 40, waarom: 'begin', door: 'claude' },
  { id: 's2', track: 'twee', speelduur: 45, overgang: 'blend', waarom: 'zelfde energie', door: 'claude' },
  { id: 's3', track: 'mist', waarom: 'naar de stilte', door: 'claude' }] };
writeFileSync(join(tmp, 'plannen', 'auto-plan.json'), JSON.stringify(PLAN));

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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit', VARVE_PLANNEN: join(tmp, 'plannen') },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', '--disable-popup-blocking', 'about:blank',
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

// Een tweede CDP-verbinding: het planvenster is een eigen target.
async function verbind(pred) {
  for (let i = 0; i < 60; i++) {
    const lijst = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => []);
    const t = lijst.find(pred);
    if (t) {
      const w = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r) => w.addEventListener('open', r));
      let n = 0; const wt = new Map();
      w.addEventListener('message', (e) => { const m = JSON.parse(e.data);
        if (m.id && wt.has(m.id)) { const x = wt.get(m.id); wt.delete(m.id); m.error ? x.b(new Error(m.error.message)) : x.a(m.result); }
        if (m.method === 'Runtime.exceptionThrown') meldingen.push(`plan: uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`plan: console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`); });
      const c = (method, params = {}) => { const id = ++n; w.send(JSON.stringify({ id, method, params })); return new Promise((a, b) => wt.set(id, { a, b })); };
      await c('Runtime.enable'); await c('Page.enable');
      const ev = async (expr) => { const r = await c('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
      const foto2 = async (naam) => { const { data } = await c('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(UIT, naam), Buffer.from(data, 'base64')); };
      return { ws: w, cdp: c, ev, foto: foto2 };
    }
    await wacht(250);
  }
  throw new Error('planvenster niet gevonden');
}
const tot = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wacht(200); } return false; };

let pv = null;
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
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.auto && window.varvePlan)').catch(() => false)) break; await wacht(200); }
  await wacht(800);

  console.log('de mixer');
  ok('de mixer biedt varvePlan aan (engine, auto, bus)', await evalueer("!!window.varvePlan.auto && typeof window.varvePlan.invoke === 'function' && window.varvePlan.naam() === 'auto-plan'"));
  // Een library van demotracks in het geheugen (de server van deze proef heeft er geen).
  await evalueer(`(async () => {
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { ToonKaart } = await import('/src/engine/toonsoort.js');
    const e = window.engine, a = window.auto;
    const maak = (id, bpm, toon, zeker, seed) => ({ id, titel: id, audio: 'x', duur: 40 * 4 * 60 / bpm, loudness_i: -14,
      grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: zeker }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] }, _bpm: bpm, _seed: seed });
    const lib = [maak('een', 124, 'Am', 0.9, 1), maak('twee', 125, 'Em', 0.9, 2), maak('mist', 96, 'G', 0.1, 3), maak('extra', 124, 'C', 0.9, 4)];
    window.__opDeck = {};
    a.tracks = lib;
    a.haalLibrary = async () => lib;
    a.welkNummer = (id) => window.__opDeck[id] ?? null;
    a.laad = async (deckId, t) => {
      const d = e.deck(deckId);
      d.load(renderDemoTrack(e.ctx, { bpm: t._bpm, bars: 40, seed: t._seed }), t.titel);
      d.setGrid(t.grid); d.setToonKaart(ToonKaart.van(t.toon));
      window.__opDeck[deckId] = t.id;
    };
    await e.resume();
    return true;
  })()`);
  await evalueer("document.getElementById('plan-btn').click(), true");
  pv = await verbind((t) => t.type === 'page' && /plan\.html/.test(t.url));
  ok('de knop "plan" opent plan.html als eigen venster', !!pv);
  await tot(() => pv.ev("!!window.varvePlanVenster && document.querySelectorAll('.pl-rij').length === 3").catch(() => false));

  console.log('\nhet venster');
  const lijst = () => pv.ev(`[...document.querySelectorAll('.pl-rij')].map((r) => ({ titel: r.querySelector('.pl-titel').firstChild.textContent,
    wordt: r.querySelector('.pl-wordt').textContent, door: r.querySelector('.pl-door').textContent, klas: r.className, badge: r.querySelector('.pl-badge').hidden ? '' : r.querySelector('.pl-badge').textContent,
    waarom: r.querySelector('.pl-waarom').value }))`);
  let l = await lijst();
  ok(`drie stappen uit het plan: ${l.map((r) => r.titel).join(', ')}`, l.map((r) => r.titel).join() === 'een,twee,mist');
  ok(`voorspelling: ${l.map((r) => r.wordt).join(' | ')}`, /begin/.test(l[0].wordt) && /lange blend/.test(l[1].wordt) && /filter-uit/.test(l[2].wordt));
  ok('wie schreef het: Claude', l.every((r) => r.door === 'Claude'));
  // Headless tekent soms maar eens per paar seconden: wachten tot de tekst er staat.
  ok('verbonden met de mixer', await tot(async () => /verbonden/.test(await pv.ev("document.querySelector('.pl-live-tekst').textContent"))));
  ok('status: opgeslagen', (await pv.ev("document.querySelector('.pl-status').textContent")) === 'opgeslagen');

  // Bewerken: stap 2 naar overvloeien, speelduur van stap 1 naar 0:30.
  await pv.ev(`(() => { const r = document.querySelectorAll('.pl-rij')[1]; const s = r.querySelector('.pl-soort'); s.value = 'ambient'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await pv.ev(`(() => { const r = document.querySelectorAll('.pl-rij')[0]; const i = r.querySelector('.pl-duur'); i.value = '0:30'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  l = await lijst();
  ok(`bewerkt: stap 2 wordt ${l[1].wordt}, door jij`, /overvloeien/.test(l[1].wordt) && l[1].door === 'jij');
  ok('status: niet opgeslagen', (await pv.ev("document.querySelector('.pl-status').textContent")) === 'niet opgeslagen');
  await pv.ev("document.querySelector('.pl-ongedaan').click(), true");
  ok('ongedaan maken: de speelduur is weer leeg', (await pv.ev("document.querySelectorAll('.pl-rij')[0].querySelector('.pl-duur').value")) === '0:40');
  await pv.ev("document.querySelector('.pl-opnieuw').click(), true");
  await pv.ev("document.querySelector('.pl-opslaan').click(), true");
  await tot(async () => (await pv.ev("document.querySelector('.pl-status').textContent")) === 'opgeslagen');
  const opSchijf = JSON.parse(readFileSync(join(tmp, 'plannen', 'auto-plan.json'), 'utf8'));
  ok('opgeslagen op schijf: overvloeien, 30 s, door clay', opSchijf.stappen[1].overgang === 'ambient' && opSchijf.stappen[0].speelduur === 30 && opSchijf.stappen[1].door === 'clay');
  ok('de vorige versie is bewaard', readdirSync(join(tmp, 'plannen', '.versies', 'auto-plan')).length === 1);

  // Een nummer erbij uit de library rechts.
  await pv.ev("(() => { document.querySelectorAll('.pl-rij')[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const b = [...document.querySelectorAll('.pl-bieb button')].find((x) => x.textContent.startsWith('extra')); b.click(); return true; })()");
  l = await lijst();
  ok(`nummer erbij na de gekozen stap: ${l.map((r) => r.titel).join(', ')}`, l.length === 4 && l[3].titel === 'extra');
  await pv.ev("document.querySelector('.pl-opslaan').click(), true");
  await tot(async () => (await pv.ev("document.querySelector('.pl-status').textContent")) === 'opgeslagen');

  console.log('\nlive');
  await pv.ev("document.querySelector('.pl-auto').click(), true");
  await tot(() => evalueer("window.auto.aan && window.auto.fase === 'klaar'"));
  ok('auto aan vanuit het venster (over de bus van de mixer)', await evalueer('window.auto.aan'));
  ok('de automaat speelt het opgeslagen plan: stap 2 wordt overvloeien', await evalueer("window.auto.volgende?.stapId === 's2' && window.auto.volgende.overgang.type === 'ambient'"));
  await tot(async () => { const x = await lijst(); return /nu/.test(x[0].klas) && /klaar/.test(x[1].badge); });
  l = await lijst();
  ok(`live in het venster: 1 = ${l[0].badge}, 2 = ${l[1].badge}`, /speelt nu/.test(l[0].badge) && /klaar/.test(l[1].badge) && /volgende/.test(l[1].klas));
  for (const [w, h] of [[1280, 860], [900, 700]]) {
    await pv.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await wacht(300);
    const past = await pv.ev("(() => { const l = document.querySelector('.pl-lijst'); return l.scrollWidth <= l.clientWidth + 1; })()");
    ok(`venster ${w} × ${h}: de lijst past in de breedte (geen horizontale scrollbalk)`, past);
    await pv.foto(`plan-live-${w}.png`);
  }

  // Claude schrijft het bestand (buiten de server om): venster en automaat volgen.
  const nu = JSON.parse(readFileSync(join(tmp, 'plannen', 'auto-plan.json'), 'utf8'));
  nu.stappen[2].waarom = 'Claude: hier wordt het stil'; nu.stappen[2].door = 'claude';
  writeFileSync(join(tmp, 'plannen', 'auto-plan.json'), JSON.stringify(nu));
  const bijgewerkt = await tot(async () => (await lijst())[2].waarom === 'Claude: hier wordt het stil', 8000);
  ok('een wijziging van Claude komt vanzelf in het venster', bijgewerkt);
  ok('... met een melding', /bijgewerkt/.test(await pv.ev("document.querySelector('.pl-melding-tekst').textContent")));
  ok('... en in de automaat van de mixer', await tot(() => evalueer("window.auto.plan.stappen[2].waarom === 'Claude: hier wordt het stil'"), 8000));

  // Botsing: hier iets veranderen (niet opslaan), en Claude schrijft weer.
  await pv.ev(`(() => { const i = document.querySelectorAll('.pl-rij')[3].querySelector('.pl-waarom'); i.value = 'van mij'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  nu.stappen[3] && (nu.stappen[3].waarom = 'van Claude');
  writeFileSync(join(tmp, 'plannen', 'auto-plan.json'), JSON.stringify(nu));
  ok('tegelijk gewijzigd: een melding met keuze, niets overschreven', await tot(async () => (await pv.ev("document.querySelector('.pl-status').textContent")) === 'botsing', 8000)
    && (await pv.ev("document.querySelectorAll('.pl-melding button').length")) === 2);
  await pv.foto('plan-botsing.png');
  await pv.ev("[...document.querySelectorAll('.pl-melding button')].find((b) => /bewaren/.test(b.textContent)).click(), true");
  ok('"mijn versie bewaren": opgeslagen, bewust over die van Claude heen', await tot(async () => (await pv.ev("document.querySelector('.pl-status').textContent")) === 'opgeslagen')
    && JSON.parse(readFileSync(join(tmp, 'plannen', 'auto-plan.json'), 'utf8')).stappen[3].waarom === 'van mij');

  await evalueer('window.auto.zetAan(false), true');
  ok('geen fouten in de console (mixer en venster)', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  console.error(err);
  uitkomst.push(['uitvoering', false]);
} finally {
  try { ws?.close(); pv?.ws.close(); } catch (_) {}
  browser.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} ROOD` : `\nalles groen · foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
