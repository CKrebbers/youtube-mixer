// De koppeling met de AV-app-hub (src/control/hub.js) in een echte Chromium,
// met de conformiteitstoets van de hub zelf (tools/nep-hub.mjs: toetsApp).
//
//   1. ZONDER ?hub=: alles zoals altijd. Web MIDI wordt gevraagd (zoals nu),
//      er gaat geen WebSocket open en hub.js wordt niet eens geladen.
//   2. MET ?hub=<nep-hub>: toetsApp moet slagen (hallo, geldig manifest, staat,
//      hartslag, onbekende berichten, geen mode-SysEx, herverbinden). Het
//      hub-tabblad is hier het TWEEDE tabblad (een gewoon VARVE-tabblad heeft
//      de Web Lock): toch gaan de LED's naar de hub, want de lock beslist met
//      de vlag niets over MIDI. requestMIDIAccess wordt NOOIT aangeroepen, ook
//      niet door de APC-kaart (de knop geeft de vlag door).
//   3. De echte hub (startHub) met nep-APC en nep-LPD8, en eerst een andere app
//      die macro.intensiteit als beeld gebruikt: APC-masterfader -> master, K1
//      laat master staan, K2 -> video.master, P1 (paniek) -> beeld zwart, en
//      een tweede hub-tabblad: het oude meldt dat het vervangen is.
//
// VEILIG MET DE APC AANGESLOTEN: requestMIDIAccess is in elke pagina een spion
// die telt en weigert (er komt nooit een MIDI-client). Eigen server op een
// eigen poort met een tijdelijke database, zoals kijk.mjs.
//
// Nodig: de repo AV-app-hub (voor toetsApp en playwright-core uit zijn node_modules).
// Gebruik:  node tools/headless/hub.mjs
//   VARVE_HUB_REPO=<map>  de AV-app-hub (standaard ../av-app-hub naast deze repo)
//   VARVE_CHROME=<pad>    een eigen Chromium (standaard /opt/pw-browsers/chromium,
//                         anders kiest playwright-core zelf)
//   VARVE_KIJK_POORT      andere poort (standaard 8798)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8798;
const CHROME = process.env.VARVE_CHROME || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
if (!existsSync(join(HUB, 'tools/nep-hub.mjs'))) { console.error(`geen AV-app-hub in ${HUB} (zet VARVE_HUB_REPO)`); process.exit(2); }
const { toetsApp } = await import(join(HUB, 'tools/nep-hub.mjs'));
const { chromium } = await import(join(HUB, 'node_modules/playwright-core/index.mjs'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-hub-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// In elke pagina vóór alles: MIDI-spion (telt, weigert) en WebSocket-spion (telt adressen).
const SPIONNEN = () => {
  window.__midi = 0;
  window.__ws = [];
  const weiger = () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de test', 'SecurityError')); };
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, value: weiger });
  const Echt = window.WebSocket;
  window.WebSocket = class extends Echt { constructor(url, p) { super(url, p); window.__ws.push(String(url)); } };
};

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await context.addInitScript(SPIONNEN);
const BASIS = `http://localhost:${POORT}/`;

async function open(url) {
  const page = await context.newPage();
  const verzoeken = [];
  page.on('request', (r) => verzoeken.push(r.url()));
  page.on('pageerror', (e) => console.log(`    [pagina] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.midi && window.feedback, null, { timeout: 20000 });
  return { page, verzoeken };
}

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASIS)).ok) break; } catch (_) {} await wacht(100); }

  console.log('zonder ?hub=: alles zoals altijd');
  const gewoon = await open(BASIS);
  await gewoon.page.waitForFunction(() => window.tabblad?.beslist && window.__midi > 0, null, { timeout: 10000 }).catch(() => {});
  const g = await gewoon.page.evaluate(() => ({ midi: window.__midi, ws: window.__ws, klasse: window.midi.constructor.name, eerste: window.tabblad.eerste }));
  ok('Web MIDI wordt gevraagd zoals altijd (eerste tabblad, met de lock)', g.midi > 0 && g.eerste, `${g.midi}×`);
  ok('de gewone MidiHub', g.klasse === 'MidiHub');
  ok('geen WebSocket', g.ws.length === 0, g.ws.join(', '));
  ok('hub.js niet geladen', !gewoon.verzoeken.some((u) => u.includes('/control/hub.js')));

  console.log('\nmet ?hub=: de conformiteitstoets van de hub (dit tabblad is het tweede)');
  let hub = null;
  const r = await toetsApp({
    poort: 0,
    start: async (url) => {
      hub = await open(`${BASIS}?hub=${encodeURIComponent(url)}`);
      await hub.page.waitForFunction(() => window.midi.output(), null, { timeout: 10000 }).catch(() => {});
      hub.poort = await hub.page.evaluate(() => window.midi.output()?.name);
    },
  });
  for (const u of r.uitslagen) ok(`toetsApp: ${u.naam}`, u.ok, u.detail);
  ok(`toetsApp: ${r.app} conform PROTOCOL.md`, r.ok);
  const h = await hub.page.evaluate(() => ({ midi: window.__midi, klasse: window.midi.constructor.name, eerste: window.tabblad.eerste,
    tx: window.midi.tx, ingeslikt: window.midi.status().hub.ingeslikt}));
  ok('requestMIDIAccess NOOIT aangeroepen', h.midi === 0, `${h.midi}×`);
  ok('HubMidi met de poort van de hub', h.klasse === 'HubMidi' && /APC40/.test(hub.poort || ''), hub.poort);
  ok('tweede tabblad (geen lock) en toch LED\'s naar de hub: de lock beslist niets over MIDI', !h.eerste && h.tx > 0, `${h.tx} LED-berichten`);
  ok('init-SysEx ingeslikt, niet verstuurd', h.ingeslikt >= 1);
  ok('hub.js geladen', hub.verzoeken.some((u) => u.includes('/control/hub.js')));
  const apcLink = await hub.page.evaluate(() => document.getElementById('apc-btn')?.getAttribute('href'));
  ok('de knop APC-kaart geeft de vlag door', /^apc\.html\?hub=/.test(apcLink || ''), apcLink);
  {
    const kaart = await context.newPage();
    await kaart.goto(new URL(apcLink, BASIS).href);
    await kaart.waitForFunction(() => document.getElementById('live')?.textContent.length > 3, null, { timeout: 10000 });
    await kaart.click('#live').catch(() => {});
    await wacht(300);
    const k = await kaart.evaluate(() => ({ midi: window.__midi, tekst: document.getElementById('live').textContent }));
    ok('APC-kaart met de vlag: geen requestMIDIAccess, ook niet na een klik op live', k.midi === 0 && /hub/.test(k.tekst), `${k.midi}×, "${k.tekst}"`);
    await kaart.close();
  }

  console.log('\nde echte hub (startHub) met een nep-APC en een nep-LPD8');
  const { startHub } = await import(join(HUB, 'src/hub.js'));
  const { NepSysteem } = await import(join(HUB, 'src/ports/nep.js'));
  const { laadConfig } = await import(join(HUB, 'src/config.js'));
  const systeem = new NepSysteem();
  const apc = systeem.voegToe('APC40 mkII');
  const lpd8 = systeem.voegToe('LPD8 mk2');
  lpd8.antwoord = (b) => { if (b[1] === 0x7e) setTimeout(() => lpd8.injecteer([0xf0, 0x7e, 0, 6, 2, 0x47, 0x4c, 0, 0xf7]), 1); };
  // opname: false: de config van de Mac heeft een avondmap; anders nam deze proef daar een "avond" op.
  const echt = await startHub({ config: { ...laadConfig(), hotplug_ms: 20 }, systeem, poort: 0, drivers: false, opname: false });
  const { default: WebSocket } = await import(join(HUB, 'node_modules/ws/index.js'));
  const andere = [];
  try {
    const tot = async (fn, ms = 10000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(50); } return fn(); };
    const appUrl = echt.adres.replace('http', 'ws') + '/app';
    // Eerst een andere app die macro.intensiteit als BEELDintensiteit gebruikt (zoals
    // av-scene-kit, emission 0,35). De pickup van K1 volgt de eerste app met die rol.
    {
      const ws = new WebSocket(appUrl);
      andere.push(ws);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'hallo', app: 'scene', inst: 'x', v: 1 }));
        ws.send(JSON.stringify({ t: 'manifest', manifest: { v: 1, app: 'scene', naam: 'Scene', params: [{ id: 'emission', naam: 'E', soort: 'waarde', standaard: 0.35, rol: 'macro.intensiteit' }] } }));
        ws.send(JSON.stringify({ t: 'staat', waarden: { emission: 0.35 } }));
      });
      const hb = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"hb"}'); }, 500);
      ws.on('close', () => clearInterval(hb));
      await tot(() => echt.kern.beeld().apps.some((a) => a.app === 'scene'));
    }
    const { page } = await open(`${BASIS}?hub=${encodeURIComponent(appUrl)}`);
    await tot(() => echt.kern.beeld().apps.some((a) => a.app === 'varve-dj' && a.status === 'actief'));
    echt.kern.focus('varve-dj');   // de eerste app (scene) kreeg de focus; Clay kiest VARVE (Bank + Track Select)
    ok('varve-dj aangemeld en heeft de focus', await tot(() => echt.kern.beeld().focus === 'varve-dj' && echt.apparaten.apc.verbonden));
    const leds = await tot(() => apc.verstuurd.filter((b) => b[0] >= 0x80 && b[0] < 0xc0).length > 100);
    ok('LED\'s van VARVE staan op de APC', leds, `${apc.verstuurd.length} berichten naar de APC`);
    const master = () => page.evaluate(() => window.engine.masterLevel);
    // Masterfader van de APC: omhoog door 0,8 (soft-takeover van VARVE pakt hem), dan naar 64.
    for (const r of [0, 32, 64, 96, 110, 127, 100, 80, 64]) { apc.injecteer([0xb0, 14, r]); await wacht(30); }
    ok('APC-masterfader -> mapping (soft-takeover) -> mixer.master', await tot(async () => Math.abs((await master()) - 64 / 127) < 0.01), (await master()).toFixed(3));
    await tot(() => echt.apparaten.lpd8.model === 'mk2');
    // K1 (macro.intensiteit) door de stand van de andere app (0,35) en verder: het
    // audio-eindvolume van VARVE mag daar niet van bewegen (vroeger 0,80 -> 0,43).
    const m0 = await master();
    let laagste = m0;
    for (let r = 20; r <= 110; r += 5) { lpd8.injecteer([0xb0, 70, r]); await wacht(20); laagste = Math.min(laagste, await master()); }
    await wacht(600);
    laagste = Math.min(laagste, await master());
    ok('LPD8 K1 (macro.intensiteit, beeld van een andere app) laat VARVE\'s master staan', Math.abs(laagste - m0) < 1e-3 && Math.abs((await master()) - m0) < 1e-3,
      `${m0.toFixed(3)} -> laagste ${laagste.toFixed(3)}`);
    // K2 = macro.helderheid -> video.master (beeld). Pickup tegen 1: eerst omhoog tot de aanslag, dan terug naar 64.
    const beeld = () => page.evaluate(() => window.videoMixer.eindbeeld.master);
    for (let r = 60; r <= 127; r += 5) { lpd8.injecteer([0xb0, 71, Math.min(r, 127)]); await wacht(20); }
    lpd8.injecteer([0xb0, 71, 127]); await wacht(30);
    for (let r = 120; r >= 64; r -= 4) { lpd8.injecteer([0xb0, 71, r]); await wacht(20); }
    lpd8.injecteer([0xb0, 71, 64]);
    ok('LPD8 K2 (macro.helderheid) -> video.master, met pickup en slew', await tot(async () => Math.abs((await beeld()) - 64 / 127) < 0.02), (await beeld()).toFixed(3));
    // P1 = paniek (1 s vasthouden) -> video.black.hold zolang hij vastzit.
    const zwart = () => page.evaluate(() => window.videoMixer.eindbeeld.zwartVast);
    lpd8.injecteer([0x99, 36, 100]);
    ok('LPD8 P1 1 s vast (paniek) -> beeld zwart', await tot(zwart, 4000));
    lpd8.injecteer([0x89, 36, 0]);
    ok('P1 los -> zwart los, master onaangeroerd', await tot(async () => !(await zwart()), 4000) && Math.abs((await master()) - m0) < 1e-3);
    const nu = await page.evaluate(() => ({ midi: window.__midi, hub: window.midi.status().hub }));
    ok('ook hier geen requestMIDIAccess', nu.midi === 0);
    // Een tweede VARVE-tabblad met de hub: de hub laat het nieuwste winnen (4001); het oude MELDT dat.
    const tweede = await open(`${BASIS}?hub=${encodeURIComponent(appUrl)}`);
    const oud = await tot(() => page.evaluate(() => window.midi.status().hub.vervangen && [...document.querySelectorAll('#meldingen .fout')].some((m) => /nieuwer VARVE-tabblad/.test(m.textContent))));
    ok('twee tabbladen: het oude meldt dat het vervangen is', !!oud);
    ok('… en het nieuwe heeft de hub', await tot(() => tweede.page.evaluate(() => window.midi.status().hub.verbonden)));
    await tweede.page.close();
  } finally { for (const ws of andere) ws.close(); await echt.stop(); }
} finally {
  await browser.close().catch(() => {});
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen: varve-dj conform PROTOCOL.md.');
process.exit(fails.length ? 1 : 0);
