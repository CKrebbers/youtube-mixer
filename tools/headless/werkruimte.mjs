// De werkruimte headless nalopen (werkruimte S3, docs/werkruimte/S3.md): de echte mixer met een
// NEP-APC (bytes -> parseMessage -> mapping.handle, zoals apc-klank.mjs). Met `standaard` is de
// werk-balk verborgen en verandert er niets (⇧ scene 3 opent dan alleen de stems-modus); met
// `apc-alleen` staat hij er, volgt het deel de grid-modus (⇧ scene 3 = deel STEMS en de STEMS-rij
// open), werken de tabs, THUIS via ⇧ master-knop, en ziet de mixer een bestand dat "Claude"
// direct schrijft binnen 3 s.
//
// Veiligheid zoals kijk.mjs: navigator.requestMIDIAccess gaat eruit vóór de pagina laadt (dit
// tabblad ziet geen echte APC), een EIGEN server met VARVE_TESTSERVER=1 en alle data in een
// tijdelijke map (VARVE_WERKRUIMTES, de kaart, de hub-sets en uitzenden ook).
//
// Gebruik:  node tools/headless/werkruimte.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (server, standaard 8930) en VARVE_KIJK_DEBUG (DevTools, 8931).
// Chrome:   VARVE_CHROME, anders de headless shell van Playwright.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STANDAARD = JSON.parse(readFileSync(new URL('../../mappings/apc40mk2.json', import.meta.url), 'utf8')).rules.length;
const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8930, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 8931;
const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-werkruimte-'));
const werkMap = join(tmp, 'werkruimtes');

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_STANDEN: join(tmp, 'standen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_WERKRUIMTES: werkMap,
    VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_HUB_SETS: join(tmp, 'hub-sets'),
    VARVE_UITZEND_UIT: join(tmp, 'uitzend'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
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
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
async function totDat(expr, maxMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return Date.now() - t0; await wacht(50); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond !== false && cond !== null && cond !== undefined && cond !== 0 || cond === 0 && false ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const open = (url) => cdp('Page.navigate', { url: `http://localhost:${POORT}${url}` });
const opgestart = async () => {
  await totDat('window.engine && window.mapping && window.lagen && window.werk && window.werkStart', 20000);
  await evalueer('window.werkStart');
  await evalueer(`(async () => { const { parseMessage } = await import('/src/control/midi.js');
    window.__apc = (...b) => window.mapping.handle(parseMessage(new Uint8Array(b))); })()`);
};
const shiftScene = (n) => evalueer(`__apc(0x90, 98, 127); __apc(0x90, ${81 + n}, 127); __apc(0x80, ${81 + n}, 0); __apc(0x80, 98, 0)`);
const stemsOpen = "!document.getElementById('stems').classList.contains('hidden')";
const balkZichtbaar = "!document.getElementById('werk-balk').hidden && document.getElementById('werk-balk').getBoundingClientRect().height > 0";

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

  // ---- standaard ------------------------------------------------------------------------
  console.log('standaard (geen werkruimte)');
  await open('/?werk=standaard');
  await opgestart();
  ok('de mixer start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !navigator.requestMIDIAccess && window.werk.naam === "standaard"'));
  ok('werk-balk verborgen (hidden, 0 px), geen body.werk-balk-aan', await evalueer("document.getElementById('werk-balk').hidden && document.getElementById('werk-balk').getBoundingClientRect().height === 0 && !document.body.classList.contains('werk-balk-aan')"));
  ok(`de mapping is precies de standaard (${STANDAARD} regels, geen fragment)`, await evalueer(`window.mapping.rules.size === ${STANDAARD} && window.mapping.extra.size === 0`),
    String(await evalueer('window.mapping.rules.size')));
  ok('⇧ master-knop = beeld zwart (zoals vandaag; THUIS komt pas met het stuk basis)', await evalueer("window.mapping.kies('note:0:80', { shift: true })?.action === 'video.black'"));
  await shiftScene(3);
  ok('⇧ scene 3: de stems-modus, en verder niets (de rij blijft dicht)', await evalueer(`window.lagen.stand.grid === 'stems' && !(${stemsOpen})`));
  await evalueer("__apc(0x90, 82, 127); __apc(0x80, 82, 0)");
  await foto('werkruimte-standaard.png');

  // ---- apc-alleen ------------------------------------------------------------------------
  console.log('\napc-alleen');
  await open('/?werk=apc-alleen');
  await opgestart();
  ok('werkruimte apc-alleen, deel MIX', await evalueer("window.werk.naam === 'apc-alleen' && window.werk.deel === 'mix'"));
  ok('werk-balk zichtbaar, acht tabs in hun kleur, MIX aan', await totDat(`${balkZichtbaar} && document.querySelectorAll('#werk-balk .werk-tab').length === 8
    && document.querySelector('#werk-balk .werk-tab.aan')?.textContent === 'MIX'`, 5000));
  const hoogte = await evalueer("document.getElementById('werk-balk').getBoundingClientRect().height");
  ok(`werk-balk is één regel (${hoogte} px ≤ 31)`, hoogte <= 31);
  ok('… en body.werk-balk-aan staat (werk.css maakt de mixer er tot 1000 px hoog 30 px lager mee)', await evalueer("document.body.classList.contains('werk-balk-aan')"));
  ok('de tabs hebben de kleur van hun deel (STEMS zeegroen #00FF99)', await evalueer("[...document.querySelectorAll('#werk-balk .werk-tab')].find((b) => b.textContent === 'STEMS').style.getPropertyValue('--k') === '#00FF99'"));
  ok('⇧ master-knop = werk.thuis (stuk basis)', await evalueer("window.mapping.kies('note:0:80', { shift: true })?.action === 'werk.thuis' && window.mapping.kies('note:0:80')?.action === 'video.black'"));
  ok('de werkruimte kiezen staat op de balk (met de drie voorbeelden)', await totDat("document.querySelectorAll('#werk-balk .werk-kies option').length >= 3", 3000));
  ok('… een voorbeeld staat er als voorbeeld (apc-alleen … (voorbeeld))', await evalueer("/\\(voorbeeld\\)$/.test([...document.querySelectorAll('#werk-balk .werk-kies option')].find((o) => o.value === 'apc-alleen')?.textContent)"));

  let t = Date.now();
  await shiftScene(3);
  const ms = await totDat(`window.werk.deel === 'stems' && ${stemsOpen} && document.querySelector('#werk-balk .werk-tab.aan')?.textContent === 'STEMS'`, 3000);
  ok('⇧ scene 3 (nep-APC): deel STEMS, de STEMS-rij open, de tab STEMS aan', ms !== false, `${Date.now() - t} ms`);
  ok('… en de werk-balk zegt wie het koos ("APC (volgt)")', await totDat("/APC \\(volgt\\)/.test(document.querySelector('#werk-balk .werk-door')?.textContent)", 2000));
  await foto('werkruimte-stems.png');

  // Gluren (≥ 400 ms vasthouden) wisselt het deel niet.
  await evalueer('__apc(0x90, 82, 127)'); await wacht(550); await evalueer('__apc(0x80, 82, 0)');
  await wacht(200);
  ok('scene 1 vasthouden (gluren naar hotcues): het deel blijft STEMS', await evalueer("window.werk.deel === 'stems' && window.lagen.stand.grid === 'stems'"));

  // Een tab klikken.
  await evalueer("[...document.querySelectorAll('#werk-balk .werk-tab')].find((b) => b.textContent === 'BEELD').click()");
  ok('tab BEELD: grid video, device beeld, de BEELD-rij open, de STEMS-rij dicht', await totDat(`window.werk.deel === 'beeld' && window.lagen.stand.grid === 'video' && window.lagen.stand.device === 'beeld'
    && !document.getElementById('beeld-rij')?.classList.contains('hidden') && !(${stemsOpen})`, 3000)
    || await totDat(`window.werk.deel === 'beeld' && window.lagen.stand.grid === 'video' && !(${stemsOpen})`, 500));
  await foto('werkruimte-beeld.png');

  // THUIS met ⇧ master-knop (de nep-APC).
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 80, 127); __apc(0x80, 80, 0); __apc(0x80, 98, 0)');
  ok('⇧ master-knop: THUIS (deel MIX, hotcues, strip)', await totDat("window.werk.deel === 'mix' && window.lagen.stand.grid === 'hotcues' && window.lagen.stand.device === 'strip'", 2000));
  ok('… en beeld niet zwart (de master-knop zonder shift is van de kern)', await evalueer("!window.videoMixer || !window.videoMixer.eind?.zwart"));

  // De tab LIBRARY opent de library, MIX sluit hem weer.
  await evalueer("[...document.querySelectorAll('#werk-balk .werk-tab')].find((b) => b.textContent === 'LIBRARY').click()");
  ok('tab LIBRARY: de library open', await totDat("!document.getElementById('lib-panel').classList.contains('hidden')", 2000));
  await evalueer("[...document.querySelectorAll('#werk-balk .werk-tab')].find((b) => b.textContent === 'MIX').click()");
  ok('tab MIX: de library weer dicht', await totDat("document.getElementById('lib-panel').classList.contains('hidden')", 2000));

  // "Claude" schrijft het bestand direct (een eigen werkruimte met dezelfde naam).
  const ruw = JSON.parse(readFileSync(join(WORTEL, 'tools/werkruimtes/voorbeelden/apc-alleen.json'), 'utf8'));
  ruw.delen.stems.label = 'STAM';
  mkdirSync(werkMap, { recursive: true });
  t = Date.now();
  writeFileSync(join(werkMap, 'apc-alleen.json'), JSON.stringify(ruw, null, 2));
  const binnen = await totDat("[...document.querySelectorAll('#werk-balk .werk-tab')].some((b) => b.textContent === 'STAM')", 6000);
  ok('een bestand dat Claude schrijft staat binnen 3 s in de mixer (peilen elke 2,5 s)', binnen !== false && Date.now() - t <= 3000, `${Date.now() - t} ms`);
  ok('… het deel bleef MIX', await evalueer("window.werk.deel === 'mix'"));

  // Leg vast: twee keer drukken; het bestand krijgt het deel zoals het nu staat.
  await shiftScene(3); await totDat("window.werk.deel === 'stems'", 2000);
  await evalueer("__apc(0x90, 64, 127); __apc(0x80, 64, 0)");   // Clip/Device View: rack
  await evalueer("document.querySelector('#werk-balk .werk-vast').click()");
  await wacht(100);
  await evalueer("document.querySelector('#werk-balk .werk-vast').click()");
  const vast = await totDat(`(() => { try { return true; } catch { return false; } })() && window.werk.bron === 'eigen' && window.werk.ruw.delen.stems.apc40mk2.device === 'rack'`, 3000);
  ok('leg vast in STEMS (twee keer): device rack staat in het bestand', vast !== false
    && JSON.parse(readFileSync(join(werkMap, 'apc-alleen.json'), 'utf8')).delen.stems.apc40mk2.device === 'rack');
  ok('… en de vorige versie staat in .versies', existsSync(join(werkMap, '.versies', 'apc-alleen')) && readdirSync(join(werkMap, '.versies', 'apc-alleen')).length === 1);

  // De hoogte: met de balk erbij past de mixer nog op 1440×900 (zonder rijen open).
  await evalueer("(async () => { window.__act = await import('/src/control/actions.js'); __act.invoke('werk.thuis', true); __act.invoke('werk.thuis', false); })()");
  await wacht(300);
  const pas = await evalueer('({ h: document.documentElement.scrollHeight, v: innerHeight })');
  ok(`de mixer past met de werk-balk op 1440×900 (${pas.h} ≤ ${pas.v})`, pas.h <= pas.v);
  await foto('werkruimte-mix.png');

  // Clay's MacBook (1440×790 in Chrome, zie rijen.mjs): de delen zetten rijen open (FX master, STEMS
  // stems, SPELEN instrument + patronen). Dan mag de pagina NIET scrollen en blijven de faders ≥ 56 px:
  // de 30 px van de balk gaan van de mixer af (werk.css), niet van de pagina (review ronde 1: 804 > 790).
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  for (const deel of ['mix', 'stems', 'fx', 'spelen', 'beeld']) {
    await evalueer(`(() => { __act.invoke('werk.deel.${deel}', true); __act.invoke('werk.deel.${deel}', false); })()`);
    await totDat(`window.werk.deel === '${deel}'`, 2000);
    const m = await evalueer(`new Promise((klaar) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = [...document.querySelectorAll('.vfader')].map((e) => e.getBoundingClientRect().height).filter((h) => h > 0);
      const rijen = document.getElementById('rijen');
      const open = [...rijen.children].filter((c) => c.tagName === 'SECTION' && !c.classList.contains('hidden')).map((c) => c.id);
      klaar({ h: document.documentElement.scrollHeight, v: innerHeight, fader: Math.round(Math.min(...f)), rijen: Math.round(rijen.getBoundingClientRect().height), open });
    })))`);
    ok(`1440×790, deel ${deel.toUpperCase()} (${m.open.join(' + ') || 'geen rij'}): de pagina scrolt niet (${m.h} ≤ ${m.v}), faders ${m.fader} ≥ 56`
      + (m.open.length ? `, #rijen ${m.rijen} ≥ 40` : ''), m.h <= m.v && m.fader >= 56 && (!m.open.length || m.rijen >= 40));
  }
  await foto('werkruimte-790.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Terug naar standaard via de kiezer: de balk weg, de mapping weer de standaard.
  await evalueer(`(() => { const k = document.querySelector('#werk-balk .werk-kies'); k.value = 'standaard'; k.dispatchEvent(new Event('change')); })()`);
  ok('de kiezer: standaard = de werk-balk weg (en body.werk-balk-aan), de mapping weer precies de standaard', await totDat(`window.werk.naam === 'standaard' && document.getElementById('werk-balk').hidden && !document.body.classList.contains('werk-balk-aan')
    && window.mapping.rules.size === ${STANDAARD} && window.mapping.extra.size === 0`, 3000));
  ok('geen fouten in de app', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
