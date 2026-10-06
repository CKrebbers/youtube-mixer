// Het planvenster met secties, headless in Chromium (docs/PLAN.md §2): een
// library met sectiekaarten, plan.html open op een plan; de banden in de
// strook, een in- en een uitsectie kiezen, opslaan en herladen (ze staan er
// nog), en een 409 bij een gelijktijdige wijziging (Claude schrijft het
// bestand terwijl jij iets veranderde).
//
// Zelfde opzet als plan.mjs en secties.mjs: een EIGEN server op een eigen
// poort met een tijdelijke database (de kaarten erin gezet met de hand, zoals
// Clay ze zou bevestigen: zo rekent niets opnieuw) en een tijdelijke plannenmap.
// Geen MIDI (requestMIDIAccess weg), geen audio, geen netwerk.
//
// Gebruik:  node tools/headless/sec-plan.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8903) en VARVE_KIJK_DEBUG (9503). Chrome: VARVE_CHROME.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from '../../server/library.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8903, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9503;
if ([8777, 7700].includes(POORT) || [8777, 7700].includes(DEBUG)) throw new Error('8777 en 7700 zijn van de echte mixer en de hub');
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-plan-'));
mkdirSync(join(tmp, 'plannen'), { recursive: true });

// ---- de library: drie nummers, twee met een sectiekaart -------------------------
const maat = (bpm) => 4 * 60 / bpm;
const kaart = (bpm, delen) => ({ versie: 1, opGrid: true, bron: 'hand', slot: false,
  stukken: delen.map(([maten, label, groep]) => ({ van: maten * maat(bpm), label, groep, energie: 0.5 })) });
const KAARTEN = {
  een: kaart(124, [[0, 'intro', 'A'], [16, 'opbouw', 'B'], [32, 'drop', 'C'], [64, 'break', 'D'], [80, 'drop', 'C'], [112, 'outro', 'E']]),
  twee: kaart(125, [[0, 'intro', 'A'], [8, 'deel', 'B'], [24, 'drop', 'C'], [56, 'break', 'D'], [72, 'outro', 'E']]),
};
{
  const lib = new Library(join(tmp, 'lib.db'));
  const nummer = (id, bpm, toon, zeker) => {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 128 * maat(bpm),
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, { stukken: [{ van: 0, bpm, anker: 0, zekerheid: zeker }], bron: 'hand' });
    lib.bewaarToon(id, { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }], bron: 'hand' });
  };
  nummer('een', 124, 'Am', 0.9);
  nummer('twee', 125, 'Em', 0.9);
  nummer('drie', 96, 'G', 0.1);
  lib.bewaarSecties('een', KAARTEN.een);
  lib.bewaarSecties('twee', KAARTEN.twee);
  lib.sluit();
}
const PLANPAD = join(tmp, 'plannen', 'sec-plan.json');
writeFileSync(PLANPAD, JSON.stringify({ naam: 'sec-plan', stappen: [
  { id: 's1', track: 'een', speelduur: 200, waarom: 'begin', door: 'claude' },
  { id: 's2', track: 'twee', overgang: 'blend', waarom: 'zelfde energie', door: 'claude' },
  { id: 's3', track: 'drie', waarom: 'naar de stilte', door: 'claude' }] }));

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
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit', VARVE_PLANNEN: join(tmp, 'plannen') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,860',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
function cdp(method, params = {}) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
async function grootte(b, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: b, height: h, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
}
const tot = async (expr, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(`!!(${expr})`).catch(() => false)) return true; await wacht(150); } return false; };
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const status = () => ev("document.querySelector('.pl-status').textContent");
const rij = (i) => `document.querySelectorAll('.pl-rij')[${i}]`;
/** Een keuzelijst in rij i op waarde v zetten zoals een gebruiker (change-event). */
const kiesIn = (i, sel, v) => ev(`(() => { const s = ${rij(i)}.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(String(v))};
  s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const opSchijf = () => JSON.parse(readFileSync(PLANPAD, 'utf8'));

// Elke fetch van het venster bijhouden: welke URL's (secties ZONDER maak=1) en de status van elke PUT (de 409).
const SPION = `(() => {
  const echt = window.fetch.bind(window);
  window.__urls = []; window.__puts = []; window.__bodies = [];
  window.fetch = async (url, init = {}) => {
    window.__urls.push(String(url));
    if ((init.method || 'GET') === 'PUT') { try { window.__bodies.push(JSON.parse(init.body)); } catch (_) {} }
    const r = await echt(url, init);
    if ((init.method || 'GET') === 'PUT') window.__puts.push(r.status);
    return r;
  };
  delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;
})();`;

async function doorloop() {
  const pagina = `http://localhost:${POORT}/plan.html?plan=sec-plan`;
  await cdp('Page.navigate', { url: pagina });
  ok('het planvenster opent (los, alleen editor) met drie stappen', await tot("window.varvePlanVenster && document.querySelectorAll('.pl-rij').length === 3", 15000));
  ok('de kaarten zijn er (een en twee; drie heeft er geen)', await tot("window.varvePlanVenster.secties.get('een') && window.varvePlanVenster.secties.get('twee') && window.varvePlanVenster.secties.has('drie')", 8000));
  const urls = await ev("window.__urls.filter((u) => u.includes('/secties'))");
  ok(`secties per nummer opgehaald ZONDER maak=1 (${urls.length}: ${urls.join(' ')})`, urls.length === 3 && urls.every((u) => !u.includes('maak')));
  ok('het server-log: niets berekend (geen [secties]-regel)', !/\[secties\]/.test(serverLog), serverLog.match(/\[secties\][^\n]*/)?.[0] ?? '');

  console.log('\nde strook');
  await tot('window.varvePlanVenster.banden.length > 0', 5000);
  const banden = await ev('window.varvePlanVenster.banden');
  const per = (id) => banden.filter((b) => b.id === id);
  ok(`banden per nummer: een ${per('s1').length}, twee ${per('s2').length}, drie ${per('s3').length}`, per('s1').length >= 4 && per('s2').length >= 3 && per('s3').length === 0);
  // De pixels: het volle streepje onderaan elke band heeft de groepskleur (groepKleur uit src/engine/secties.js).
  // Waar de overgang overheen gearceerd is mengt de kleur: daarom niet elke band, wel de meeste.
  const pixels = await ev(`(async () => {
    const { groepKleur } = await import('/src/engine/secties.js');
    const c = document.querySelector('.pl-strook canvas'), g = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const y = { s1: 12, s2: 40 };
    return window.varvePlanVenster.banden.filter((b) => b.x1 - b.x0 > 6).map((b) => {
      const x = Math.round(((b.x0 + b.x1) / 2) * dpr), yy = Math.round((y[b.id] + 22) * dpr);
      const d = g.getImageData(x, yy, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      return { id: b.id, sectie: b.sectie, groep: b.groep, hex, verwacht: groepKleur(b.groep) };
    });
  })()`);
  const raak = pixels.filter((p) => p.hex === p.verwacht);
  const groepen = new Set(raak.map((p) => p.groep));
  ok(`de banden hebben de groepskleur (${raak.length}/${pixels.length} midden van een band precies, ${groepen.size} groepen)`, raak.length >= 5 && groepen.size >= 4,
    pixels.filter((p) => p.hex !== p.verwacht).map((p) => `${p.id}:${p.sectie} ${p.hex}≠${p.verwacht}`).join(' '));
  await grootte(1280, 860);
  await foto('sec-plan-strook-1280.png');

  console.log('\nin en uit kiezen');
  const heeft = await ev(`[...document.querySelectorAll('.pl-rij')].map((r) => [!!r.querySelector('.pl-in'), !!r.querySelector('.pl-uit')])`);
  ok(`keuzelijsten in en uit bij een en twee, niet bij drie (geen kaart): ${JSON.stringify(heeft)}`, heeft[0].join() === 'true,true' && heeft[1].join() === 'true,true' && heeft[2].join() === 'false,false');
  const optiesIn = await ev(`[...${rij(1)}.querySelector('.pl-in').options].map((o) => o.textContent)`);
  ok(`in van twee: "—" en de vijf secties (${optiesIn.slice(1).join(' | ')})`, optiesIn.length === 6 && optiesIn[2] === '2 B' && optiesIn[3] === '3 drop C');
  const voor = await ev('window.varvePlanVenster.v.stappen.map((r) => r.start)');
  await kiesIn(1, '.pl-in', 3);
  const s2 = await ev("window.varvePlanVenster.plan.stappen[1]");
  const beginDrop = KAARTEN.twee.stukken[2].van;
  ok(`in = sectie 3 (drop C): in gezet, van = haar begin (${s2.van?.toFixed(2)} s)`, s2.in?.sectie === 3 && s2.in.label === 'drop' && s2.in.groep === 'C' && Math.abs(s2.van - beginDrop) < 1e-9);
  ok(`de rij toont het: begin ${await ev(`${rij(1)}.querySelector('.pl-van').value`)}, "${await ev(`${rij(1)}.querySelector('.pl-titel small').textContent`)}"`,
    await ev(`${rij(1)}.querySelector('.pl-in').value === '3' && /in 3 drop C/.test(${rij(1)}.querySelector('.pl-titel small').textContent) && ${rij(1)}.querySelector('.pl-van').value === '0:46'`));
  const optiesUit = await ev(`[...${rij(1)}.querySelector('.pl-uit').options].map((o) => o.value)`);
  ok(`uit van twee: alleen secties na in (${optiesUit.slice(1).join(',')})`, optiesUit.slice(1).join() === '4,5');
  await kiesIn(0, '.pl-uit', 4);
  const s1 = await ev("window.varvePlanVenster.plan.stappen[0]");
  ok('uit van een = sectie 4 (break D)', s1.uit?.sectie === 4 && s1.uit.label === 'break' && s1.uit.groep === 'D' && !s1.in);
  ok(`de rij toont het: "${await ev(`${rij(0)}.querySelector('.pl-titel small').textContent`)}"`,
    await ev(`${rij(0)}.querySelector('.pl-uit').value === '4' && /uit 4 break D/.test(${rij(0)}.querySelector('.pl-titel small').textContent)`));
  const na = await ev('window.varvePlanVenster.v.stappen.map((r) => r.start)');
  const moment = await ev('window.varvePlanVenster.v.stappen[1].moment');
  ok(`met uit volgt de strook het moment van de planner (twee begint op ${na[1].toFixed(1)} s in de set, was ${voor[1].toFixed(1)}; moment ${moment?.start?.toFixed(1)} s)`,
    !!moment && Math.abs(na[1] - moment.start) < 1e-6);
  ok('witte strepen op de gekozen in en uit', await ev(`(() => { const c = document.querySelector('.pl-strook canvas'), g = c.getContext('2d');
    const r = window.varvePlanVenster.v.stappen[0], tot = Math.max(1, window.varvePlanVenster.v.totaal), w = c.clientWidth;
    const t = window.varvePlanVenster.secties.get('een').stukken[3].van, x = Math.round(10 + ((r.start + t - r.van) / tot) * (w - 20));
    const d = g.getImageData(x, 10, 1, 1).data; return d[0] > 240 && d[1] > 240 && d[2] > 240; })()`));
  ok('status: niet opgeslagen', (await status()) === 'niet opgeslagen');
  await foto('sec-plan-gekozen-1280.png');

  console.log('\nopslaan en herladen');
  await ev("document.querySelector('.pl-opslaan').click(), true");
  ok('opgeslagen', await tot("document.querySelector('.pl-status').textContent === 'opgeslagen'"));
  const schijf = opSchijf();
  ok('op schijf: in en uit, en van = het begin van de drop', schijf.stappen[1].in?.sectie === 3 && Math.abs(schijf.stappen[1].van - beginDrop) < 1e-9
    && schijf.stappen[0].uit?.sectie === 4 && !schijf.stappen[2].in && !schijf.stappen[2].uit);
  ok('de PUT zegt dat het venster in/uit kent', await ev("window.__bodies.some((b) => JSON.stringify(b.kent) === JSON.stringify(['in', 'uit']))"));
  await cdp('Page.reload');
  ok('herladen', await tot("window.varvePlanVenster && document.querySelectorAll('.pl-rij').length === 3 && window.varvePlanVenster.secties.get('twee')", 15000));
  await tot(`${rij(1)}.querySelector('.pl-in')?.value === '3'`, 5000);
  const terug = await ev(`[${rij(0)}.querySelector('.pl-uit')?.value, ${rij(1)}.querySelector('.pl-in')?.value, ${rij(1)}.querySelector('.pl-van').value]`);
  ok(`na herladen staan ze er nog: uit van een = ${terug[0]}, in van twee = ${terug[1]}, begin ${terug[2]}`, terug.join() === '4,3,0:46');
  ok('... en de status is opgeslagen', (await status()) === 'opgeslagen');

  console.log('\nuit vóór het begin');
  // Een later begin typen dan de uit van een: de keuze blijft staan, maar oranje met de reden.
  await ev(`(() => { const i = ${rij(0)}.querySelector('.pl-van'); i.value = '2:10'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const oranje = await ev(`(() => { const s = ${rij(0)}.querySelector('.pl-uit'); return { klas: s.className, titel: s.title, waarde: s.value }; })()`);
  ok(`begin 2:10 na uit (break D, 2:04): uit blijft gekozen, oranje ("${oranje.titel}")`, oranje.waarde === '4' && /pl-onzeker/.test(oranje.klas) && /niet na het begin/.test(oranje.titel));
  await ev("document.querySelector('.pl-ongedaan').click(), true");
  ok('ongedaan maken: begin weer leeg, uit niet meer oranje', await ev(`${rij(0)}.querySelector('.pl-van').value === '' && !${rij(0)}.querySelector('.pl-uit').classList.contains('pl-onzeker')`)
    && (await status()) === 'opgeslagen');

  console.log('\ntegelijk gewijzigd: 409');
  // Hier iets veranderen (niet opslaan), en Claude schrijft intussen het bestand.
  await ev(`(() => { const i = ${rij(2)}.querySelector('.pl-waarom'); i.value = 'van mij'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const claude = opSchijf();
  claude.stappen[2].waarom = 'van Claude';
  writeFileSync(PLANPAD, JSON.stringify(claude));
  await ev("document.querySelector('.pl-opslaan').click(), true");
  ok('opslaan op de oude versie: de server zegt 409', await tot('window.__puts.includes(409)', 5000), JSON.stringify(await ev('window.__puts')));
  ok('het venster meldt de botsing, met keuze, niets overschreven', await tot("document.querySelector('.pl-status').textContent === 'botsing'", 5000)
    && (await ev("document.querySelectorAll('.pl-melding button').length")) === 2 && opSchijf().stappen[2].waarom === 'van Claude');
  await foto('sec-plan-botsing-1280.png');
  await ev("[...document.querySelectorAll('.pl-melding button')].find((b) => /eroverheen|bewaren/.test(b.textContent)).click(), true");
  ok('"mijn versie eroverheen": opgeslagen, in en uit staan er nog', await tot("document.querySelector('.pl-status').textContent === 'opgeslagen'")
    && opSchijf().stappen[2].waarom === 'van mij' && opSchijf().stappen[1].in?.sectie === 3 && opSchijf().stappen[0].uit?.sectie === 4);

  console.log('\nweghalen blijft weg');
  // Het bestand HEEFT nu een uit op stap 1: weghalen in het venster en opslaan, dan moet hij weg blijven
  // (het venster stuurt kent; zonder zou de server hem terugzetten).
  ok('vooraf: op schijf heeft stap 1 een uit', opSchijf().stappen[0].uit?.sectie === 4);
  await kiesIn(0, '.pl-uit', '');
  await ev("document.querySelector('.pl-opslaan').click(), true");
  ok('uit weg in het venster en opgeslagen', await tot("document.querySelector('.pl-status').textContent === 'opgeslagen'"));
  const weg = opSchijf();
  ok('op schijf: stap 1 zonder uit, stap 2 houdt zijn in', !('uit' in weg.stappen[0]) && weg.stappen[1].in?.sectie === 3);
  ok('geen "bewaard"-melding van de server', !/bewaard/.test(await ev("document.querySelector('.pl-melding-tekst').textContent")));
  ok('in het venster ook weg', (await ev(`${rij(0)}.querySelector('.pl-uit').value`)) === '');

  console.log('\nde kaart opnieuw berekend');
  // Buiten het venster om (zoals de mixer die opnieuw rekent): sectie 3 van twee heet nu "break C".
  {
    const lib = new Library(join(tmp, 'lib.db'));
    const k = JSON.parse(JSON.stringify(KAARTEN.twee));
    k.stukken[2].label = 'break';
    lib.bewaarSecties('twee', k);
    lib.sluit();
  }
  await ev(`(() => { const s = document.querySelector('.pl-kies'); s.value = 'sec-plan'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  ok('het plan opnieuw laden haalt ook bestaande kaarten opnieuw op', await tot(`${rij(1)}.querySelector('.pl-in')?.classList.contains('pl-onzeker')`, 8000));
  const kaartTitel = await ev(`${rij(1)}.querySelector('.pl-in').title`);
  ok(`in van twee: oranje, "kaart opnieuw berekend" ("${kaartTitel}")`, /opnieuw berekend/.test(kaartTitel) && /break C/.test(kaartTitel) && /drop C/.test(kaartTitel));
  await foto('sec-plan-kaart-anders-1280.png');

  console.log('\nbreedte');
  for (const [w, h] of [[1280, 860], [900, 700]]) {
    await grootte(w, h);
    const past = await ev("(() => { const l = document.querySelector('.pl-lijst'); return l.scrollWidth <= l.clientWidth + 1; })()");
    ok(`venster ${w} × ${h}: de lijst past in de breedte`, past);
    await foto(`sec-plan-${w}.png`);
  }
}

try {
  // Een koude start van Google Chrome (nieuw profiel) kan ruim 10 s duren: tot 30 s wachten op een pagina.
  let doelen = null;
  for (let i = 0; i < 150 && !doelen?.some((d) => d.type === 'page'); i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SPION });
  await grootte(1280, 860);
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await doorloop();
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  console.error(err);
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
