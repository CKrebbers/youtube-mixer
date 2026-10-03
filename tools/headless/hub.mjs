// De koppeling met de AV-app-hub (src/control/hub.js) in een echte Chromium,
// met de conformiteitstoets van de hub zelf (tools/nep-hub.mjs: toetsApp).
//
//   1. ZONDER ?hub=: alles zoals altijd. Web MIDI wordt gevraagd (zoals nu),
//      er gaat geen WebSocket open en hub.js wordt niet eens geladen.
//   2. MET ?hub=<nep-hub>: toetsApp moet slagen (hallo, geldig manifest, staat,
//      hartslag, onbekende berichten, geen mode-SysEx, herverbinden). Het
//      hub-tabblad is hier het TWEEDE tabblad (een gewoon VARVE-tabblad heeft
//      de Web Lock): toch gaan de LED's naar de hub, want de lock beslist met
//      de vlag niets over MIDI. requestMIDIAccess wordt NOOIT aangeroepen.
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

  console.log('\nde echte hub (startHub) met een nep-APC en een nep-LPD8');
  const { startHub } = await import(join(HUB, 'src/hub.js'));
  const { NepSysteem } = await import(join(HUB, 'src/ports/nep.js'));
  const { laadConfig } = await import(join(HUB, 'src/config.js'));
  const systeem = new NepSysteem();
  const apc = systeem.voegToe('APC40 mkII');
  const lpd8 = systeem.voegToe('LPD8 mk2');
  lpd8.antwoord = (b) => { if (b[1] === 0x7e) setTimeout(() => lpd8.injecteer([0xf0, 0x7e, 0, 6, 2, 0x47, 0x4c, 0, 0xf7]), 1); };
  const echt = await startHub({ config: { ...laadConfig(), hotplug_ms: 20 }, systeem, poort: 0, drivers: false });
  try {
    const tot = async (fn, ms = 10000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(50); } return fn(); };
    const { page } = await open(`${BASIS}?hub=${encodeURIComponent(echt.adres.replace('http', 'ws') + '/app')}`);
    ok('varve-dj aangemeld en heeft de focus', await tot(() => echt.kern.beeld().focus === 'varve-dj' && echt.apparaten.apc.verbonden));
    const leds = await tot(() => apc.verstuurd.filter((b) => b[0] >= 0x80 && b[0] < 0xc0).length > 100);
    ok('LED\'s van VARVE staan op de APC', leds, `${apc.verstuurd.length} berichten naar de APC`);
    const master = () => page.evaluate(() => window.engine.masterLevel);
    // Masterfader van de APC: omhoog door 0,8 (soft-takeover van VARVE pakt hem), dan naar 64.
    for (const r of [0, 32, 64, 96, 110, 127, 100, 80, 64]) { apc.injecteer([0xb0, 14, r]); await wacht(30); }
    ok('APC-masterfader -> mapping (soft-takeover) -> mixer.master', await tot(async () => Math.abs((await master()) - 64 / 127) < 0.01), (await master()).toFixed(3));
    await tot(() => echt.apparaten.lpd8.model === 'mk2');
    for (let r = 20; r <= 110; r += 5) { lpd8.injecteer([0xb0, 70, r]); await wacht(20); }   // K1 = macro.intensiteit, kruist 0,5
    ok('LPD8 K1 (macro.intensiteit) -> master, met pickup en slew', await tot(async () => Math.abs((await master()) - 110 / 127) < 0.02), (await master()).toFixed(3));
    const nu = await page.evaluate(() => ({ midi: window.__midi, hub: window.midi.status().hub }));
    ok('ook hier geen requestMIDIAccess', nu.midi === 0);
  } finally { await echt.stop(); }
} finally {
  await browser.close().catch(() => {});
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen: varve-dj conform PROTOCOL.md.');
process.exit(fails.length ? 1 : 0);
