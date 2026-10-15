// De Maschine-ijkproef (tools/proef/maschine-ijk.html) en koppelen per apparaat in de mixer,
// van begin tot eind in een echte Chromium, zonder hardware (werkruimte S5, docs/werkruimte/S5.md):
//
//   de ECHTE hub (startHub uit de hub-repo) met een nep-APC en een nep-Maschine MK2 op
//   HID-niveau (NepHidSysteem + nepMaschine uit de hub-tests, zoals tools/headless/speelapparaten.mjs),
//   een eigen VARVE-server met tijdelijke data (VARVE_TESTSERVER=1).
//
//   Deel 1, de ijkproef: elke pad, knop, draaiknop (beide kanten op) en het wiel (beide kanten
//   op) aanraken; de pagina moet voor ELKE control van het profiel "klopt" zeggen, niets
//   onverwachts zien, nooit requestMIDIAccess aanroepen, en pas na de klik op "testpatroon"
//   iets op de schermen zetten (bit voor bit testbeeld(0) en testbeeld(1)).
//
//   Deel 2, de mixer: Clay's APC-verschil staat op de server; in het koppelpaneel "Maschine"
//   kiezen, een action leren met CONTROL + F1 op de nep-Maschine: de regel komt in
//   /api/mapping/maschine-mk2 als verschil, overleeft herladen en een serverherstart, en
//   "standaard herstellen" op de Maschine raakt de APC niet. Daarna hetzelfde met een toets.
//   De APC-mapping (/api/mapping) is aan het eind byte voor byte wat hij was.
//
// VEILIG MET DE APC (en een echte hub op 7700) AANGESLOTEN: requestMIDIAccess is een spion
// die telt en weigert; de hub luistert op een vrije poort (0), niet op 7700; geen node-hid.
//
// Gebruik:  VARVE_HUB_REPO=<AV-app-hub> [VARVE_CHROME=<pad>] [VARVE_KIJK_POORT=8833] node tools/proef/maschine-ijk.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8833;
const CHROME = process.env.VARVE_CHROME || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
for (const f of ['src/hub.js', 'src/ports/nep.js', 'test/nep-speelapparaten.js']) {
  if (!existsSync(join(HUB, f))) { console.error(`geen AV-app-hub met speelapparaten in ${HUB} (${f} ontbreekt; zet VARVE_HUB_REPO)`); process.exit(2); }
}
const { chromium } = await import(join(HUB, 'node_modules/playwright-core/index.mjs'));
const { startHub } = await import(join(HUB, 'src/hub.js'));
const { NepSysteem, NepHidSysteem } = await import(join(HUB, 'src/ports/nep.js'));
const { laadConfig } = await import(join(HUB, 'src/config.js'));
const { nepMaschine, rustFrame } = await import(join(HUB, 'test/nep-speelapparaten.js'));
const P = await import(join(WORTEL, 'src/control/devices/maschine-mk2.js'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-ijk-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tot = async (fn, ms = 8000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(40); } return fn(); };

const SPIONNEN = () => {
  window.__midi = 0;
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true,
    value: () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de test', 'SecurityError')); } });
};

// ---- de VARVE-server (opnieuw te starten op dezelfde data) ----
mkdirSync(join(tmp, 'media'), { recursive: true });
const ENV = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'media/library.db'), VARVE_MEDIA: join(tmp, 'media'),
  VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PROEF: join(tmp, 'proef'),
  VARVE_STANDEN: join(tmp, 'standen'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'), VARVE_BACKUPS: join(tmp, 'backups'),
  VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_HERANALYSE: 'uit' };
delete ENV.VARVE_HOSTS;
let server = null;
const BASIS = `http://localhost:${POORT}/`;
async function startServer() {
  server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { env: ENV, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${BASIS}api/backups`)).ok) return true; } catch (_) {} await wacht(100); }
  return false;
}
async function stopServer() {
  if (!server) return;
  const s = server; server = null;
  await new Promise((z) => { s.once('exit', z); s.kill(); });
}
const api = async (pad, opts = {}) => {
  const r = await fetch(`${BASIS}${pad.replace(/^\//, '')}`, { ...opts, headers: { 'Content-Type': 'application/json', Origin: BASIS.slice(0, -1), ...(opts.headers || {}) } });
  return { status: r.status, tekst: await r.text() };
};

// ---- de hub met de nep-Maschine ----
const basis = laadConfig();
const config = { ...basis, hotplug_ms: 20, apparaten: { ...basis.apparaten, 'maschine-mk2': { ...basis.apparaten['maschine-mk2'], stil_ms: 200 } } };
const systeem = new NepSysteem();
systeem.voegToe('APC40 mkII');
const hid = new NepHidSysteem();
const m = nepMaschine(hid);
hid.bijOpen = (p) => setTimeout(() => p.injecteer(rustFrame()), 1);
// opname: false: de config van de Mac heeft een avondmap; anders nam deze proef daar een "avond" op.
const echt = await startHub({ config, systeem, hid, poort: 0, drivers: false, opname: false });
const appUrl = echt.adres.replace('http', 'ws') + '/app';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await context.addInitScript(SPIONNEN);

async function open(url, klaar) {
  const page = await context.newPage();
  const fouten = [];
  page.on('pageerror', (e) => { fouten.push(e.message); console.log(`    [pagina] ${e.message}`); });
  page.on('console', (c) => { if (c.type() === 'error' && !/WebSocket|Failed to load resource/.test(c.text())) fouten.push(c.text()); });
  await page.goto(url);
  await page.waitForFunction(klaar, null, { timeout: 20000 });
  return { page, fouten };
}

try {
  ok('VARVE-server gestart (VARVE_TESTSERVER=1, tijdelijke data)', await startServer());

  // =========================== deel 1: de ijkproef ===========================
  console.log('\ndeel 1: de ijkproef tegen de nep-Maschine (echte hub)');
  const { page: ijk, fouten: ijkFouten } = await open(`${BASIS}tools/proef/maschine-ijk.html?hub=${encodeURIComponent(appUrl)}`, () => window.ijk?.open);
  ok('de ijkproef speelt de Maschine (beeld.spelers)', await tot(() => echt.kern.beeld().spelers?.['maschine-mk2'] === 'varve-ijk'), JSON.stringify(echt.kern.beeld().spelers));
  const voorPatroon = m.poort.verstuurd.length;
  // Het EERSTE knoppenrapport na aansluiten zet in de hub alleen de beginstand: eerst één neutraal rapport.
  m.los('shift');
  await wacht(100);
  for (let p = 1; p <= 16; p++) { m.pad(p); await wacht(5); }
  for (const k of P.KNOPPEN) { m.tik(k); await wacht(5); }
  for (let k = 0; k < 8; k++) { m.draai(k, 40); m.draai(k, -40); await wacht(5); }
  m.wiel(1); await wacht(5); m.wiel(-1); await wacht(5); m.wiel(1);
  const n = P.maschineMk2.controls.size;
  const u = await tot(async () => { const x = await ijk.evaluate(() => window.ijk.uitslag()); return x.samen.klopt === x.samen.totaal ? x : null; })
    || await ijk.evaluate(() => window.ijk.uitslag());
  const nietKlopt = u.controls.filter((c) => c.uitslag !== 'klopt').map((c) => `${c.label} ${c.uitslag}`);
  ok(`elke control van het profiel (${n}): "klopt"`, u.samen.totaal === n && u.samen.klopt === n, nietKlopt.join(', ') || `${u.samen.klopt}/${u.samen.totaal}`);
  ok('niets onverwachts (elke signature hoort bij een control van het profiel)', u.samen.onverwacht === 0, JSON.stringify(u.onverwacht));
  const wiel = u.controls.find((c) => c.sig === P.WIEL_SIG);
  ok('het wiel is relatief ±1 per klik, beide kanten op', wiel.ontvangen.plus >= 1 && wiel.ontvangen.min >= 1 && wiel.ontvangen.maxStap === 1 && wiel.ontvangen.minStap === 1);
  const sm = ['solo', 'mute', 'volume'].map((k) => u.controls.find((c) => c.sig === P.knopSig(k)));
  ok('SOLO, MUTE en VOLUME sturen noot aan (127) en noot uit', sm.every((c) => c.ontvangen.aan >= 1 && c.ontvangen.uit >= 1 && c.ontvangen.snelheid.every((v) => v === 127)));
  const schermVoor = m.poort.verstuurd.slice(voorPatroon).filter((r) => (r[0] & 0xfe) === 0xe0 && r.slice(9).some((x) => x));
  ok('vóór de klik zet de proef niets op de schermen (hooguit de lege repaint van de hub)', schermVoor.length === 0, `${schermVoor.length} rapporten met pixels`);
  await ijk.click('#patroon');
  const lees = (nr) => {
    const l = m.laatste();
    const uit = new Uint8Array(2048);
    for (let i = 0; i < 8; i++) { const stuk = l[`e${nr}:${i}`]; if (!stuk) return null; uit.set(stuk.slice(9), i * 256); }
    return uit;
  };
  const verwacht = await ijk.evaluate(() => [0, 1].map((nr) => [...window.ijk.testbeeld(nr)]));
  const gelijk = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  ok('na "testpatroon": beide schermen bit voor bit testbeeld(0) en testbeeld(1) (F1–F8 bovenin)',
    !!(await tot(() => gelijk(lees(0), verwacht[0]) && gelijk(lees(1), verwacht[1]))));
  ok('… en de pad-lampjes (rapport 0x80) staan aan', await tot(() => (m.laatste()['80'] ?? []).slice(1).some((x) => x > 0)));
  await ijk.click('[data-labels="ja"]');
  const json = await ijk.evaluate(() => JSON.parse(document.getElementById('json').value));
  ok('de uitkomst als JSON: samen, controls, onverwacht, labelsOnderF', json.proef === 'maschine-ijk' && json.controls.length === n && json.samen.labelsOnderF === true);
  ok('de ijkproef riep nooit requestMIDIAccess aan, geen paginafouten', (await ijk.evaluate(() => window.__midi)) === 0 && ijkFouten.length === 0, ijkFouten.join(' | '));
  await ijk.click('#uit');
  await ijk.close();
  await tot(() => echt.kern.beeld().spelers?.['maschine-mk2'] !== 'varve-ijk');

  // =========================== deel 2: koppelen in de mixer ===========================
  console.log('\ndeel 2: koppelen per apparaat in de mixer (?hub=)');
  // Clay's verschil (4 regels op cc:0:20–23 @device.rack) op de APC-plek, via de oude route.
  const { readFileSync } = await import('node:fs');
  const { maakVerschil } = await import(join(WORTEL, 'src/control/mapping.js'));
  const standaard = JSON.parse(readFileSync(join(WORTEL, 'mappings/apc40mk2.json'), 'utf8'));
  const kopie = JSON.parse(JSON.stringify(standaard));
  const VIDEO = { 'cc:0:20': 'video.fx.pixel', 'cc:0:21': 'video.fx.rgb', 'cc:0:22': 'video.fx.trails', 'cc:0:23': 'video.fx.grain' };
  for (const r of kopie.rules) if (r.laag === 'device.rack' && VIDEO[r.in]) { r.action = VIDEO[r.in]; r.mode = 'absolute'; }
  const clay = maakVerschil(standaard, kopie);
  await api('/api/mapping', { method: 'POST', body: JSON.stringify({ mapping: clay }) });
  const apcVoor = (await api('/api/mapping')).tekst;
  ok('Clay\'s verschil staat op de APC-plek: 4 regels op cc:0:20–23 @device.rack', JSON.parse(apcVoor).mapping.rules.length === 4);

  const mixer = `${BASIS}?hub=${encodeURIComponent(appUrl)}`;
  let { page, fouten } = await open(mixer, () => window.maschine && window.mapPanel?.apparaten?.size >= 3);
  ok('VARVE speelt de Maschine weer', await tot(() => echt.kern.beeld().spelers?.['maschine-mk2'] === 'varve-dj'));
  echt.kern.focus('varve-dj');
  ok('de apparaatkiezer: APC · Maschine · Xboard · toetsen', (await page.evaluate(() => [...window.mapPanel.apparaten.keys()].join())) === 'apc40mk2,maschine-mk2,xboard49,toetsen');
  ok('Clay\'s APC-verschil is geladen (cc:0:20 @device.rack = video.fx.pixel)', await tot(() => page.evaluate(() => window.mapping.rules.get('cc:0:20@device.rack')?.action === 'video.fx.pixel')));

  // Het koppelpaneel openen en de Maschine kiezen, met de muis.
  await page.click('#midi-btn');
  await page.click('.mon-map-knop');
  await page.click('.map-apparaten button[data-apparaat="maschine-mk2"]');
  ok('Maschine gekozen in het paneel én in de koppelmodus', await page.evaluate(() => window.mapPanel.apparaat === 'maschine-mk2' && window.leerModus.apparaat === 'maschine-mk2'));
  await page.fill('.map-filter', 'track.2.focus');
  await wacht(100);
  await page.evaluate(() => window.mapPanel.tick());
  await page.click('button[data-doe="leer"][data-action="track.2.focus"]');
  ok('leren staat aan op de Maschine (niet op de APC)', await page.evaluate(() => window.mapPanel.learn.busy && !window.learn.busy));
  m.los('shift'); await wacht(50);
  m.tik('f1');   // zonder CONTROL: de Maschine doet gewoon wat hij doet, er wordt niets geleerd
  await wacht(200);
  ok('F1 zonder CONTROL: niets geleerd (koppelen op de Maschine = CONTROL vasthouden)', await page.evaluate(() => window.mapPanel.learn.busy && !window.maschine.mapping.rules.has('note:1:0')));
  m.druk('control'); await wacht(30);
  m.druk('f1'); await wacht(30);
  m.los('f1'); await wacht(30);
  m.los('control');
  ok('CONTROL + F1: geleerd, in de Maschine-mapping', await tot(() => page.evaluate(() => window.maschine.mapping.kies('note:1:0')?.action === 'track.2.focus' && !window.mapPanel.learn.busy)));
  const opServer = async () => JSON.parse((await api('/api/mapping/maschine-mk2')).tekst).mapping;
  const ms1 = await tot(async () => { const x = await opServer(); return x?.rules?.some((r) => r.in === 'note:1:0') ? x : null; });
  ok('… op de server onder mapping:maschine-mk2, als verschil (1 regel, niets weg)', ms1?.kind === 'diff' && ms1.device === 'maschine-mk2' && ms1.rules.length === 1 && ms1.removed.length === 0, JSON.stringify(ms1?.rules));
  ok('… en de APC-mapping op de server is byte voor byte dezelfde', (await api('/api/mapping')).tekst === apcVoor);
  ok('… en de APC-mapping in de pagina kreeg niets', await page.evaluate(() => !window.mapping.rules.has('note:1:0') && window.mapping.verschil().rules.length === 4));
  m.tik('f1');
  ok('F1 doet nu wat je koppelde: focus op track 2', await tot(() => page.evaluate(() => window.engine.focus === 'B')));

  // Herladen en een serverherstart.
  await page.close();
  ({ page, fouten } = await open(mixer, () => window.maschine && window.mapPanel?.apparaten?.size >= 3));
  ok('na herladen: de Maschine-regel staat er nog', await tot(() => page.evaluate(() => window.maschine.mapping.kies('note:1:0')?.action === 'track.2.focus')));
  await page.close();
  await stopServer();
  ok('server opnieuw gestart (zelfde data)', await startServer());
  ({ page, fouten } = await open(mixer, () => window.maschine && window.mapPanel?.apparaten?.size >= 3));
  ok('na een serverherstart: de Maschine-regel staat er nog', await tot(() => page.evaluate(() => window.maschine.mapping.kies('note:1:0')?.action === 'track.2.focus')));
  ok('… en Clay\'s APC-verschil ook', await tot(() => page.evaluate(() => window.mapping.rules.get('cc:0:20@device.rack')?.action === 'video.fx.pixel')));

  // Standaard herstellen op de Maschine: twee klikken (destructief).
  await page.click('#midi-btn');
  await page.click('.mon-map-knop');
  await page.click('.map-apparaten button[data-apparaat="maschine-mk2"]');
  await page.click('.map-reset'); await page.click('.map-reset');
  const leeg = await tot(async () => { const x = await opServer(); return x && x.rules.length === 0 ? x : null; });
  ok('"standaard herstellen" op de Maschine: een leeg verschil onder mapping:maschine-mk2', leeg?.kind === 'diff' && leeg.removed.length === 0);
  ok('… de Maschine-regel is weg in de pagina', await page.evaluate(() => !window.maschine.mapping.rules.has('note:1:0')));
  ok('… en de APC is niet geraakt (server byte voor byte, pagina nog 4 eigen regels)', (await api('/api/mapping')).tekst === apcVoor
    && await page.evaluate(() => window.mapping.verschil().rules.length === 4));

  // Een toets koppelen: F2 (doet in de standaard niets) -> track.3.focus.
  await page.click('.map-apparaten button[data-apparaat="toetsen"]');
  await page.fill('.map-filter', 'track.3.focus');
  await wacht(100);
  await page.evaluate(() => window.mapPanel.tick());
  await page.click('button[data-doe="leer"][data-action="track.3.focus"]');
  ok('leren staat aan op de toetsen (de focus staat op de knop "leer", niet in een tekstveld)', await page.evaluate(() => window.mapPanel.learn.busy
    && window.mapPanel.apparaat === 'toetsen' && !window.learn.busy && document.activeElement?.tagName !== 'INPUT'));
  await page.keyboard.press('F2');
  const toetsen = await tot(async () => { const x = JSON.parse((await api('/api/mapping/toetsen')).tekst).mapping; return x?.rules?.length ? x : null; });
  ok('toets F2 geleerd: in mapping:toetsen als verschil (key:0:59 -> track.3.focus)', toetsen?.device === 'toetsen' && toetsen.rules.length === 1
    && toetsen.rules[0].in === 'key:0:59' && toetsen.rules[0].action === 'track.3.focus', JSON.stringify(toetsen?.rules));
  await page.keyboard.press('F2');
  ok('F2 doet nu wat je koppelde: focus op track 3', await tot(() => page.evaluate(() => window.engine.focus === 'C')));
  // Paneel dicht terwijl het leren op de toetsen aan staat: dat leren stopt ook (niet alleen dat van de APC).
  await page.click('button[data-doe="leer"][data-action="track.3.focus"]');
  await page.click('.mon-map-knop');
  ok('paneel dicht tijdens leren op de toetsen: het leren stopt', await page.evaluate(() => !window.mapPanel.learn.busy));
  // Ook als het paneel dichtgaat door een ander onderpaneel: toets B (library).
  await page.click('.mon-map-knop');
  await page.click('button[data-doe="leer"][data-action="track.3.focus"]');
  const busy = await page.evaluate(() => window.mapPanel.learn.busy);
  await page.keyboard.press('KeyB');
  ok('toets B (library) tijdens leren op de toetsen: het MIDI-paneel gaat dicht en het leren stopt', busy && await tot(() => page.evaluate(() => !window.mapPanel.learn.busy)));
  await page.keyboard.press('KeyB');
  ok('de APC aan het eind byte voor byte wat hij was', (await api('/api/mapping')).tekst === apcVoor);
  ok('de mixer riep nooit requestMIDIAccess aan, geen paginafouten', (await page.evaluate(() => window.__midi)) === 0 && fouten.length === 0, fouten.join(' | '));
  await page.close();
} finally {
  await browser.close().catch(() => {});
  await echt.stop().catch(() => {});
  await stopServer();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
