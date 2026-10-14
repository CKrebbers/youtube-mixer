// Van druk tot lampje, in een ECHTE Chrome met de ECHTE hub (startHub) en een nep-APC:
// het hele pad APC -> hub -> WebSocket -> mapping -> action -> LED-laag -> MidiHub ->
// HubMidi (bundel) -> WebSocket -> hub (kern, wachtrij) -> APC. Wat dit niet meet:
// de USB-kabel en de APC zelf (alleen op het apparaat).
//
// Gemeten (tijden in Node, waar de nep-APC zit: injecteren en ontvangen op dezelfde klok):
//   track select  (note:N:51, focus; eenkleurig lampje): druk -> [0x9N, 51, 127] op de APC
//   A|B           (note:N:66, crossfaderkant; tweekleurig): druk -> het volgende lampje op die knop
//   ingeslikt     hoeveel druk/los het echofilter van de pagina als echo weggooide (midi.echoes):
//                 A|B op thru is "lampje uit" [0x9N, 66, 0], en dat is precies het loslaten.
//
// Gebruik:  VARVE_HUB_REPO=<AV-app-hub met node_modules> VARVE_KIJK_POORT=8854 node tools/headless/led-vertraging.mjs
//   VARVE_BRON=<andere checkout>  de server (en dus de pagina) uit een andere checkout, bv. van vóór een wijziging
//   VARVE_DRUK=<n>                aantal drukken (standaard 120)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = resolve(process.env.VARVE_BRON || fileURLToPath(new URL('../..', import.meta.url)));
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8854;
const DRUK = Number(process.env.VARVE_DRUK) || 120;
const CHROME = process.env.VARVE_CHROME || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
if (!existsSync(join(HUB, 'node_modules/playwright-core'))) { console.error(`geen AV-app-hub met node_modules in ${HUB} (zet VARVE_HUB_REPO)`); process.exit(2); }
const { chromium } = await import(join(HUB, 'node_modules/playwright-core/index.mjs'));
const { startHub } = await import(join(HUB, 'src/hub.js'));
const { NepSysteem } = await import(join(HUB, 'src/ports/nep.js'));
const { laadConfig } = await import(join(HUB, 'src/config.js'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-ledvertraging-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const tot = async (fn, ms = 10000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(30); } return fn(); };

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_STANDEN: join(tmp, 'standen'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, value: () => Promise.reject(new DOMException('geen MIDI', 'SecurityError')) });
});
const BASIS = `http://localhost:${POORT}/`;
const systeem = new NepSysteem();
const apc = systeem.voegToe('APC40 mkII');
const lpd8 = systeem.voegToe('LPD8 mk2');
lpd8.antwoord = (b) => { if (b[1] === 0x7e) setTimeout(() => lpd8.injecteer([0xf0, 0x7e, 0, 6, 2, 0x47, 0x4c, 0, 0xf7]), 1); };
const uit = [];   // { t, b } wat de APC kreeg
const echtStuur = apc.stuur.bind(apc);
apc.stuur = (b) => { uit.push({ t: performance.now(), b: [...b] }); echtStuur(b); };
const echt = await startHub({ config: { ...laadConfig(), hotplug_ms: 20 }, systeem, poort: 0, drivers: false, opname: false });
let uitslag = null;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASIS)).ok) break; } catch (_) {} await wacht(100); }
  const appUrl = echt.adres.replace('http', 'ws') + '/app';
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`    [pagina] ${e.message}`));
  await page.goto(`${BASIS}?hub=${encodeURIComponent(appUrl)}`);
  await page.waitForFunction(() => window.midi && window.feedback, null, { timeout: 20000 });
  await tot(() => echt.kern.beeld().apps.some((a) => a.app === 'varve-dj' && a.status === 'actief'));
  echt.kern.focus('varve-dj');
  await tot(() => echt.kern.beeld().focus === 'varve-dj' && echt.apparaten.apc.verbonden);
  await tot(() => uit.filter((m) => m.b[0] >= 0x80 && m.b[0] < 0xc0).length > 100);
  await wacht(1500);
  const echo0 = await page.evaluate(() => window.midi.echoes);
  const lat = { focus: [], ab: [] };
  let zonder = 0;
  for (let i = 0; i < DRUK; i++) {
    const ab = i % 2 === 1;
    const ch = ab ? (i >> 1) % 8 : (i >> 1) % 8 === 0 ? 1 : (i >> 1) % 8;   // focus: nooit op de track die al focus heeft
    const noot = ab ? 66 : 51;
    const n0 = uit.length;
    const t0 = performance.now();
    apc.injecteer([0x90 | ch, noot, 127]);
    await wacht(30 + (i % 7) * 7);
    apc.injecteer([0x80 | ch, noot, 0]);
    await wacht(140);
    const m = uit.slice(n0).find((x) => (x.b[0] & 0xf0) === 0x90 && (x.b[0] & 0x0f) === ch && x.b[1] === noot && (ab || x.b[2] === 127));
    if (m) lat[ab ? 'ab' : 'focus'].push(m.t - t0); else zonder++;
    if (!ab) { apc.injecteer([0x90, 51, 127]); await wacht(40); apc.injecteer([0x80, 51, 0]); await wacht(120); }   // focus terug naar track 1
  }
  const echos = (await page.evaluate(() => window.midi.echoes)) - echo0;
  const alle = [...lat.focus, ...lat.ab];
  uitslag = {
    bron: WORTEL, hub: HUB, drukken: DRUK,
    p50_ms: r1(pct(alle, 0.5)), p90_ms: r1(pct(alle, 0.9)), p99_ms: r1(pct(alle, 0.99)), max_ms: r1(Math.max(...alle)),
    focus_p50_ms: r1(pct(lat.focus, 0.5)), ab_p50_ms: r1(pct(lat.ab, 0.5)),
    zonder_lampje: zonder, ingeslikt_als_echo: echos,
  };
  console.log(JSON.stringify(uitslag));
} finally {
  await echt.stop();
  await browser.close().catch(() => {});
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(uitslag ? 0 : 1);
