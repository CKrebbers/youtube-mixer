/**
 * Proef in echte Chrome (headless): VarveDJ v2 met de AV-app-hub (?hub=ws://…).
 *
 *   node tools/proef-hub.mjs
 *   VARVE_HUB_REPO=<map>   de AV-app-hub (standaard ../../../AV-app-hub naast youtube-mixer, of av-app-hub)
 *   VARVE_WS=<map>         een map met het pakket ws, als de hub-repo geen node_modules heeft
 *   PLAYWRIGHT_MODULE      waar playwright staat (standaard /opt/node22/lib/node_modules/)
 *
 * VEILIG MET DE APC AANGESLOTEN: requestMIDIAccess is in elke pagina een spion die telt en
 * weigert (er komt nooit een MIDI-client). De hub draait IN dit proces met een NepSysteem
 * (een nep-APC en een nep-LPD8): de echte poorten van de Mac raakt hij niet aan. Eigen
 * v2-server op een eigen poort; de app zelf zoals altijd (index.html, app.js ongewijzigd:
 * ui/controllers.js leest ?hub= uit location.search).
 *
 *   1. ZONDER ?hub=: Web MIDI wordt gevraagd zoals altijd, geen WebSocket, hub.js niet geladen.
 *   2. MET ?hub=<nep-hub>: de conformiteitstoets van de hub zelf (tools/nep-hub.mjs: toetsApp):
 *      hallo, geldig manifest, staat, hartslag, onbekende berichten, geen mode-SysEx,
 *      herverbinden. Dit tabblad is het TWEEDE (het gewone tabblad van stap 1 heeft de Web
 *      Lock): toch gaan de lampjes naar de hub, want de lock beslist met de vlag niets.
 *   3. De ECHTE hub (startHub) met een nep-APC en een nep-LPD8, en eerst een andere app die
 *      macro.intensiteit als beeld gebruikt: varve-dj meldt zich aan, krijgt de focus, zijn
 *      lampjes staan op de APC; APC-masterfader -> mixer.master; activator 1 -> track 1 play;
 *      LPD8 K1 laat de master staan, K2 -> video.master, K4 -> video.pulse, P1 (paniek) ->
 *      beeld zwart en los; een tweede hub-tabblad: het oude meldt dat het vervangen is.
 *
 * `ws`: de hub importeert het pakket ws. Heeft de hub-repo geen node_modules (zoals in de
 * cloud), dan wijst een resolve-haak `ws` naar VARVE_WS of naar de ws die playwright-core
 * zelf meebrengt (lib/utilsBundle.js: dezelfde ws, gebundeld). Op de Mac (npm install in de
 * hub-repo) doet de haak niets.
 */
import { createRequire, register } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const POORT = Number(process.env.VARVE_V2_POORT_HUB) || 8794;

const kandidaten = process.env.VARVE_HUB_REPO ? [process.env.VARVE_HUB_REPO]
  : [join(HIER, '../../../../AV-app-hub'), join(HIER, '../../../../av-app-hub'), join(HIER, '../../../av-app-hub')];
const HUB = kandidaten.find((p) => existsSync(join(p, 'tools/nep-hub.mjs')));
if (!HUB) { console.error(`geen AV-app-hub gevonden (${kandidaten.join(', ')}); zet VARVE_HUB_REPO`); process.exit(2); }

// ---- ws voor de hub ----------------------------------------------------------------------------
function wsBron() {
  if (existsSync(join(HUB, 'node_modules/ws/package.json'))) return { soort: 'hub-repo', url: null };
  if (process.env.VARVE_WS) {
    const w = join(process.env.VARVE_WS, existsSync(join(process.env.VARVE_WS, 'wrapper.mjs')) ? 'wrapper.mjs' : 'ws/wrapper.mjs');
    if (existsSync(w)) return { soort: `VARVE_WS (${w})`, url: pathToFileURL(w).href };
  }
  const pw = require.resolve('playwright');
  const core = dirname(createRequire(pw).resolve('playwright-core'));
  const bundel = join(core, 'lib/utilsBundle.js');
  if (!existsSync(bundel)) return null;
  const shim = `import { createRequire } from 'node:module';
const u = createRequire(${JSON.stringify(bundel)})(${JSON.stringify(bundel)});
export const WebSocket = u.ws; export const WebSocketServer = u.wsServer; export default u.ws;`;
  return { soort: `playwright-core (${bundel})`, url: `data:text/javascript,${encodeURIComponent(shim)}` };
}
const ws = wsBron();
if (!ws) { console.error('geen ws voor de hub: npm install in de hub-repo, of zet VARVE_WS'); process.exit(2); }
if (ws.url) {
  const haak = `export async function resolve(s, c, volgende) {
  try { return await volgende(s, c); } catch (e) { if (s === 'ws') return { url: ${JSON.stringify(ws.url)}, shortCircuit: true }; throw e; }
}`;
  register(`data:text/javascript,${encodeURIComponent(haak)}`);
}
const hubImport = (pad) => import(pathToFileURL(join(HUB, pad)).href);

process.env.VARVE_V2_POORT = String(POORT);
const { maakServer } = await import('../server.mjs');
const server = maakServer({ media: '/geen-media' });
await new Promise((r) => server.listen(POORT, '127.0.0.1', r));
const BASIS = `http://localhost:${POORT}/`;

const uitslag = { hub: HUB, ws: ws.soort, stappen: [], fouten: [] };
const stap = (naam, ok, info = {}) => { uitslag.stappen.push({ naam, ok: !!ok, ...info }); console.log(`${ok ? '  ok  ' : 'FAIL  '}${naam}${Object.keys(info).length ? ` ${JSON.stringify(info)}` : ''}`); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const tot = async (fn, ms = 10000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(50); } return fn(); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// In elke pagina vóór alles: MIDI-spion (telt, weigert) en WebSocket-spion (telt adressen).
await context.addInitScript(() => {
  window.__midi = 0;
  window.__ws = [];
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true,
    value: () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de proef', 'SecurityError')); } });
  const Echt = window.WebSocket;
  window.WebSocket = class extends Echt { constructor(url, p) { super(url, p); window.__ws.push(String(url)); } };
});

async function open(url) {
  const page = await context.newPage();
  const verzoeken = [];
  page.on('request', (r) => verzoeken.push(r.url()));
  page.on('pageerror', (e) => uitslag.fouten.push(`${url}: ${e.message}`));
  page.on('console', (m) => {
    // Een WebSocket die niet lukt logt Chrome zelf rood (de herverbindproef sluit hem bewust): geen fout van ons.
    if (m.type() === 'error' && !/WebSocket connection to/.test(m.text())) uitslag.fouten.push(`${url}: ${m.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.varve && window.varveCtl, null, { timeout: 20000 });
  await page.evaluate(async () => {
    window.__meld = [];
    window.varve.on('melding', ({ tekst, soort }) => window.__meld.push(`${soort}: ${tekst}`));
    await window.varveCtl.geladen;
  });
  return { page, verzoeken };
}

let echt = null;
const andere = [];
try {
  // ---- 1. zonder ?hub= ------------------------------------------------------------------------
  console.log('zonder ?hub=: alles zoals altijd');
  const gewoon = await open(BASIS);
  await gewoon.page.waitForFunction(() => window.__midi > 0, null, { timeout: 5000 }).catch(() => {});
  const g = await gewoon.page.evaluate(() => ({ midi: window.__midi, ws: window.__ws, tabblad: window.varveCtl.status().tabblad, hub: window.varveCtl.status().hub }));
  stap('Web MIDI wordt gevraagd zoals altijd (eerste tabblad, met de lock)', g.midi > 0 && g.tabblad === 'eerste', g);
  stap('geen WebSocket, geen hub-status', g.ws.length === 0 && g.hub === null);
  stap('hub.js niet geladen', !gewoon.verzoeken.some((u) => u.includes('/control/hub.js')) && gewoon.verzoeken.some((u) => u.includes('/control/hub-vlag.js')));

  // ---- 2. de conformiteitstoets van de hub ------------------------------------------------------
  console.log('\nmet ?hub=<nep-hub>: de conformiteitstoets van de hub (dit tabblad is het tweede)');
  const { toetsApp } = await hubImport('tools/nep-hub.mjs');
  let nep = null;
  const r = await toetsApp({
    poort: 0,
    start: async (url) => {
      nep = await open(`${BASIS}?hub=${encodeURIComponent(url)}`);
      await nep.page.waitForFunction(() => window.varveCtl.hub?.uitvoer?.(), null, { timeout: 10000 }).catch(() => {});
    },
  });
  for (const u of r.uitslagen) stap(`toetsApp: ${u.naam}`, u.ok, u.detail ? { detail: u.detail } : {});
  stap(`toetsApp: ${r.app} conform PROTOCOL.md`, r.ok);
  const h = await nep.page.evaluate(() => { const s = window.varveCtl.status(); const st = window.varveCtl.hub.status(); return { midi: window.__midi, klasse: window.varveCtl.hub.constructor.name, tabblad: s.tabblad, leds: st.hub.leds, ingeslikt: st.hub.ingeslikt }; });
  stap('requestMIDIAccess NOOIT aangeroepen', h.midi === 0, { midi: h.midi });
  stap('HubMidi, en als TWEEDE tabblad (zonder lock) toch lampjes naar de hub', h.klasse === 'HubMidi' && h.tabblad === 'tweede' && h.leds > 0, h);
  stap('init-SysEx ingeslikt', h.ingeslikt >= 1);
  stap('hub.js pas met de vlag geladen', nep.verzoeken.some((u) => u.includes('/control/hub.js')));
  await nep.page.close();
  await gewoon.page.close();

  // ---- 3. de echte hub ------------------------------------------------------------------------
  console.log('\nde echte hub (startHub) met een nep-APC en een nep-LPD8');
  const { startHub } = await hubImport('src/hub.js');
  const { NepSysteem } = await hubImport('src/ports/nep.js');
  const { laadConfig } = await hubImport('src/config.js');
  const wsMod = await import(ws.url ?? pathToFileURL(join(HUB, 'node_modules/ws/wrapper.mjs')).href);
  const WebSocket = wsMod.WebSocket ?? wsMod.default;
  const systeem = new NepSysteem();
  const apc = systeem.voegToe('APC40 mkII');
  const lpd8 = systeem.voegToe('LPD8 mk2');
  lpd8.antwoord = (b) => { if (b[1] === 0x7e) setTimeout(() => lpd8.injecteer([0xf0, 0x7e, 0, 6, 2, 0x47, 0x4c, 0, 0xf7]), 1); };
  // opname: false: een config met een avondmap zou anders een "avond" opnemen.
  echt = await startHub({ config: { ...laadConfig(), hotplug_ms: 20 }, systeem, poort: 0, drivers: false, opname: false });
  const appUrl = `${echt.adres.replace('http', 'ws')}/app`;
  {
    // Eerst een andere app die macro.intensiteit als BEELDintensiteit gebruikt (zoals av-scene-kit).
    const s = new WebSocket(appUrl);
    andere.push(s);
    s.on('open', () => {
      s.send(JSON.stringify({ t: 'hallo', app: 'scene', inst: 'x', v: 1 }));
      s.send(JSON.stringify({ t: 'manifest', manifest: { v: 1, app: 'scene', naam: 'Scene', params: [{ id: 'emission', naam: 'E', soort: 'waarde', standaard: 0.35, rol: 'macro.intensiteit' }] } }));
      s.send(JSON.stringify({ t: 'staat', waarden: { emission: 0.35 } }));
    });
    const hb = setInterval(() => { if (s.readyState === 1) s.send('{"t":"hb"}'); }, 500);
    s.on('close', () => clearInterval(hb));
    await tot(() => echt.kern.beeld().apps.some((a) => a.app === 'scene'));
  }
  const { page } = await open(`${BASIS}?hub=${encodeURIComponent(appUrl)}`);
  await page.evaluate(() => window.varve.ctx.resume());
  const aangemeld = await tot(() => echt.kern.beeld().apps.some((a) => a.app === 'varve-dj' && a.status === 'actief'));
  echt.kern.focus('varve-dj');   // de eerste app (scene) kreeg de focus; Clay kiest VarveDJ (Bank + Track Select)
  stap('varve-dj aangemeld en heeft de focus', !!aangemeld && await tot(() => echt.kern.beeld().focus === 'varve-dj' && echt.apparaten.apc.verbonden));
  const ctlFocus = await tot(() => page.evaluate(() => window.varveCtl.status().hub?.focus === true));
  stap('de app weet dat hij de focus heeft (status en statusregel)', ctlFocus, { status: await page.evaluate(() => document.getElementById('ctl-status')?.textContent) });
  const leds = await tot(() => apc.verstuurd.filter((b) => b[0] >= 0x80 && b[0] < 0xc0).length > 100);
  stap('de lampjes van VarveDJ staan op de APC', leds, { naarApc: apc.verstuurd.length });
  const lees = (id) => page.evaluate((i) => window.varve.bus.lees(i), id);

  // APC-masterfader: soft-takeover. Omhoog door de stand, dan naar 64.
  await wacht(100);   // het echofilter (60 ms na wat VarveDJ stuurde) laten verlopen
  for (const w of [0, 32, 64, 96, 110, 127, 100, 80, 64]) { apc.injecteer([0xb0, 14, w]); await wacht(30); }
  stap('APC-masterfader -> indeling (soft-takeover) -> mixer.master', await tot(async () => Math.abs((await lees('mixer.master')) - 64 / 127) < 0.01), { master: await lees('mixer.master') });
  // Activator 1: track 1 play (zonder nummer: de actie gaat over de bus, het log ziet hem).
  await page.evaluate(() => { window.__acties = []; window.varve.bus.on('actie', ({ id, v, bron }) => window.__acties.push([id, v, bron])); });
  apc.injecteer([0x90, 50, 127]); await wacht(30); apc.injecteer([0x80, 50, 0]);
  const play = await tot(() => page.evaluate(() => window.__acties.filter(([id]) => id === 'track.1.play')).then((a) => (a.length >= 2 ? a : null)));
  stap('APC activator 1 -> track.1.play (bron apc), loslaten ook', JSON.stringify(play) === JSON.stringify([['track.1.play', true, 'apc'], ['track.1.play', false, 'apc']]), { play });

  await tot(() => echt.apparaten.lpd8.model === 'mk2');
  // K1 (macro.intensiteit) door de stand van de andere app (0,35) en verder: de master van VarveDJ mag niet bewegen.
  const m0 = await lees('mixer.master');
  let laagste = m0;
  for (let w = 20; w <= 110; w += 5) { lpd8.injecteer([0xb0, 70, w]); await wacht(20); laagste = Math.min(laagste, await lees('mixer.master')); }
  await wacht(600);
  laagste = Math.min(laagste, await lees('mixer.master'));
  stap('LPD8 K1 (macro.intensiteit, het beeld van een andere app) laat de master staan', Math.abs(laagste - m0) < 1e-3, { m0, laagste });
  // K2 = macro.helderheid -> video.master. Pickup tegen 1: eerst omhoog tot de aanslag, dan terug naar 64.
  for (let w = 60; w <= 127; w += 5) { lpd8.injecteer([0xb0, 71, Math.min(w, 127)]); await wacht(20); }
  lpd8.injecteer([0xb0, 71, 127]); await wacht(30);
  for (let w = 120; w >= 64; w -= 4) { lpd8.injecteer([0xb0, 71, w]); await wacht(20); }
  lpd8.injecteer([0xb0, 71, 64]);
  stap('LPD8 K2 (macro.helderheid) -> video.master, met pickup en slew', await tot(async () => Math.abs((await lees('video.master')) - 64 / 127) < 0.02), { beeld: await lees('video.master') });
  // K4 = macro.beweging -> video.pulse (begint op 0: van onder omhoog pakken).
  for (let w = 0; w <= 96; w += 4) { lpd8.injecteer([0xb0, 73, w]); await wacht(20); }
  stap('LPD8 K4 (macro.beweging) -> video.pulse', await tot(async () => Math.abs((await lees('video.pulse')) - 96 / 127) < 0.02), { puls: await lees('video.pulse') });
  // P1 = paniek (1 s vasthouden) -> video.black.hold zolang hij vastzit.
  lpd8.injecteer([0x99, 36, 100]);
  stap('LPD8 P1 1 s vast (paniek) -> beeld zwart', await tot(async () => (await lees('video.black.hold')) === 1, 4000));
  lpd8.injecteer([0x89, 36, 0]);
  stap('P1 los -> zwart los, de master onaangeroerd', await tot(async () => (await lees('video.black.hold')) === 0, 4000) && Math.abs((await lees('mixer.master')) - m0) < 1e-3);
  // Wat VarveDJ zelf verandert gaat terug naar de hub (de cockpit ziet het).
  await page.evaluate(() => window.varve.bus.doe('mixer.xfader', 0.9));
  const xf = await tot(() => { const a = echt.kern.beeld().apps.find((x) => x.app === 'varve-dj'); const w = a?.waarden; return w && Math.abs((w.xfader ?? -1) - 0.9) < 1e-3 ? w.xfader : null; }, 3000);
  stap('een eigen wijziging (crossfader) komt bij de hub aan als zet', !!xf, { xf: xf ?? echt.kern.beeld().apps.find((x) => x.app === 'varve-dj')?.waarden });
  stap('ook hier geen requestMIDIAccess', (await page.evaluate(() => window.__midi)) === 0);

  // Een tweede hub-tabblad: de hub laat het nieuwste winnen (4001); het oude MELDT dat.
  const tweede = await open(`${BASIS}?hub=${encodeURIComponent(appUrl)}`);
  const oud = await tot(() => page.evaluate(() => window.varveCtl.status().hub?.vervangen && window.__meld.some((m) => /^fout: een nieuwer VarveDJ-tabblad/.test(m))));
  stap('twee tabbladen: het oude meldt dat het vervangen is', !!oud, { meld: await page.evaluate(() => window.__meld) });
  stap('… en het nieuwe heeft de hub', await tot(() => tweede.page.evaluate(() => window.varveCtl.status().hub?.verbonden)));
  await tweede.page.close();
} catch (fout) {
  stap('proef liep', false, { fout: String(fout?.stack ?? fout) });
} finally {
  for (const s of andere) s.close();
  await echt?.stop?.().catch?.(() => {});
  await browser.close().catch(() => {});
  server.close();
}

const goed = uitslag.stappen.every((s) => s.ok) && !uitslag.fouten.length;
if (uitslag.fouten.length) console.log('\nfouten in de pagina:', uitslag.fouten);
console.log(goed ? '\nPROEF GOED' : '\nPROEF FOUT');
process.exit(goed ? 0 : 1);
