// De APC-indeling "Voorstel A" (Clay 25 sep) headless nalopen: de modus klank
// en de nieuwe knoppen rechts, met een NEP-APC (bytes -> parseMessage ->
// mapping.handle, zoals kijk.mjs), en apc.html met de nieuwe knoppen.
//
// Zelfde veiligheid als kijk.mjs: navigator.requestMIDIAccess gaat eruit vóór
// de pagina laadt (dit tabblad kan de APC niet zien), een EIGEN server op een
// eigen poort met een tijdelijke database, media- en opnamemap.
//
// Gebruik:  node tools/headless/apc-klank.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (server, standaard 8793) en VARVE_KIJK_DEBUG (DevTools, 9339).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8793, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9339;
const tmp = mkdtempSync(join(tmpdir(), 'varve-klank-'));

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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
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
/** Wachten tot een uitdrukking waar is (de animatielus loopt headless traag). */
async function totDat(expr, maxMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(100); }
  return false;
}

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
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- de app, met een nep-APC ------------------------------------------------
  console.log('de app: modus klank en de knoppen rechts');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  await totDat('window.engine && window.mapping && window.lagen && window.feedback', 20000);
  await wacht(800);
  ok('de app start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !navigator.requestMIDIAccess'));
  ok('de mapping is de nieuwe standaard (374 regels, klank erin)',
    await evalueer("window.mapping.rules.size === 374 && window.mapping.kies('note:0:86', { shift: true })?.action === 'layer.grid.klank'"),
    String(await evalueer('window.mapping.rules.size')));

  // Een demotrack op track 1 met een grid, spelend, focus op 1.
  await evalueer(`(async () => {
    window.__act = await import('/src/control/actions.js');
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { parseMessage } = await import('/src/control/midi.js');
    window.__apc = (...b) => window.mapping.handle(parseMessage(new Uint8Array(b)));
    // De LED-laag op het APC-profiel, zoals midi-opzet doet als de uitvoerpoort
    // verschijnt; zonder init en zonder klaar: er gaat niets naar buiten, we
    // lezen alleen desired() (wat er zou branden).
    window.feedback.device = (await import('/src/control/devices/apc40mk2.js')).default;
    const e = window.engine;
    await e.resume();
    await e.deck('A').laadGeheugen(renderDemoTrack(e.ctx, { seed: 0, bars: 16 }), 'demo 1');
    e.deck('A').setGrid(new Beatgrid({ bpm: 124, firstBeat: 0, slot: true }));
    e.setFocus('A');
    __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
  })()`);
  ok('demo op track 1 met grid (124 bpm), focus op 1', await evalueer("!!window.engine.deck('A').buffer && !!window.engine.deck('A').grid && window.engine.focus === 'A'"));

  // Shift + scene 5: de modus klank.
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 86, 127); __apc(0x80, 86, 0); __apc(0x80, 98, 0)');
  ok('APC Shift + scene 5: modus klank open', await evalueer("window.lagen.stand.grid === 'klank'"));
  ok('de mapje-balk zegt wat de rijen doen', await totDat("/klank/.test(document.querySelector('.mapje-balk')?.textContent) && /kill hoog/.test(document.querySelector('.mapje-balk').textContent)"),
    await evalueer("document.querySelector('.mapje-balk')?.textContent.slice(0, 160)"));
  ok('LED scene 5: fel magenta (klank open)', await evalueer("window.feedback.desired().get('note:0:86')?.[2] === 53"),
    JSON.stringify(await evalueer("window.feedback.desired().get('note:0:86')")));
  ok('LED pad 1/1 (kill hoog, open): donkerrood', await evalueer("window.feedback.desired().get('note:0:32')?.[2] === 6"));
  ok('spiegel: pad 1/1 van kolom 1 toont kill hoog in de modus klank',
    await totDat(`(() => { const el = document.querySelector('.kol[data-kolom="1"] [data-sig="note:0:32"]');
      return el?.dataset.modus === 'klank' && el.dataset.action === 'track.1.kill.high.hold'; })()`));
  await foto('klank-modus.png');

  // Kill hoog vasthouden: weg zolang je drukt.
  await evalueer('__act.invoke("track.1.play", true); __act.invoke("track.1.play", false)');
  await evalueer('__apc(0x90, 32, 127)');
  ok('kill-pad ingedrukt: hoog is weg', await evalueer("window.engine.deck('A').gekild('high') === true"));
  ok('LED pad 1/1: fel rood zolang de band weg is', await evalueer("window.feedback.desired().get('note:0:32')?.[2] === 5"));
  ok('spiegel: het pad licht op (aan)', await totDat(`document.querySelector('.kol[data-kolom="1"] [data-sig="note:0:32"]')?.dataset.licht === 'aan'`));
  await foto('klank-kill.png');
  await evalueer('__apc(0x80, 32, 0)');
  ok('kill-pad losgelaten: hoog is terug', await evalueer("window.engine.deck('A').gekild('high') === false"));
  // Shift + kill laag: vastzetten, en nog eens: los.
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 16, 127); __apc(0x80, 16, 0); __apc(0x80, 98, 0)');
  ok('Shift + kill laag: blijft weg na loslaten (schakelaar)', await evalueer("window.engine.deck('A').gekild('low') === true && !window.engine.deck('A').gekild('high')"));
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 16, 127); __apc(0x80, 16, 0); __apc(0x80, 98, 0)');
  ok('nog eens Shift + kill laag: weer open', await evalueer("window.engine.deck('A').gekild('low') === false"));

  // Bank ▶: beatjump 4 tellen vooruit (gepauzeerd gemeten: geen tijd die wegloopt).
  await evalueer("window.engine.deck('A').pause(); window.engine.deck('A').seek(10)");
  const voor = await evalueer("window.engine.deck('A').position");
  await evalueer('__apc(0x90, 61, 127); __apc(0x80, 61, 0)');
  const na = await evalueer("window.engine.deck('A').position");
  ok('Bank ▶: beatjump vooruit, 4 tellen (1,935 s op 124 bpm)', Math.abs(na - voor - 4 * 60 / 124) < 0.01, `${voor.toFixed(3)} -> ${na.toFixed(3)}`);
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 61, 127); __apc(0x80, 61, 0); __apc(0x80, 98, 0)');
  ok('Shift + Bank ▶: beatjump-lengte ×2 (8 tellen)', await evalueer("window.engine.deck('A').sprongTellen === 8"));
  await evalueer('__apc(0x90, 60, 127); __apc(0x80, 60, 0)');
  ok('Bank ◀: 8 tellen terug', Math.abs(await evalueer("window.engine.deck('A').position") - (na - 8 * 60 / 124)) < 0.01);

  // Pan / Sends: loop in en loop out (spelend, zodat de loop lengte krijgt).
  await evalueer("window.engine.deck('A').seek(4); window.engine.deck('A').play()");
  await wacht(300);
  await evalueer('__apc(0x90, 87, 127); __apc(0x80, 87, 0)');
  ok('Pan: loop in gezet', await evalueer("window.engine.deck('A').loopInPunt !== null"));
  await wacht(1300);
  await evalueer('__apc(0x90, 88, 127); __apc(0x80, 88, 0)');
  const loop = await evalueer("(() => { const l = window.engine.deck('A').loop; return l && { start: l.start, end: l.end }; })()");
  ok('Sends: loop out, de loop loopt (~1,3 s)', !!loop && loop.end - loop.start > 0.8 && loop.end - loop.start < 2.5, JSON.stringify(loop));
  // Het lampje van Sends knippert op de tel (single LED, `tel: 'aan'`), dus de read, niet de byte.
  ok('Sends-lampje: read = 1 (er loopt een loop), Pan: loop in niet meer klaar',
    await evalueer("__act.read('track.1.loop.out') === 1 && __act.read('track.1.loop.in') === 0"));
  await evalueer('__apc(0x90, 89, 127); __apc(0x80, 89, 0)');
  ok('User: reloop = loop eraf', await evalueer("window.engine.deck('A').loop === null && !!window.engine.deck('A').vorigeLoop"));

  // Lock: quantize aan/uit, met lampje.
  const q0 = await evalueer('window.engine.quantize');
  await evalueer('__apc(0x90, 63, 127); __apc(0x80, 63, 0)');
  ok('Lock: quantize om', await evalueer(`window.engine.quantize === ${!q0}`));
  ok('Lock-lampje volgt quantize', await evalueer(`window.feedback.desired().get('note:0:63')?.[2] === ${!q0 ? 127 : 0}`));
  await evalueer('__apc(0x90, 63, 127); __apc(0x80, 63, 0)');
  ok('nog eens Lock: terug', await evalueer(`window.engine.quantize === ${q0}`));
  // In de grid-modus blijft Lock het slot.
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 90, 127); __apc(0x80, 90, 0); __apc(0x80, 98, 0)');
  const slot0 = await evalueer("window.engine.deck('A').grid.slot");
  await evalueer('__apc(0x90, 63, 127); __apc(0x80, 63, 0)');
  ok('grid-modus: Lock = grid-slot, quantize blijft staan',
    await evalueer(`window.lagen.stand.edit === 'aan' && window.engine.deck('A').grid.slot === ${!slot0} && window.engine.quantize === ${q0}`));
  await evalueer('__apc(0x90, 63, 127); __apc(0x80, 63, 0)');
  await evalueer('__apc(0x90, 98, 127); __apc(0x90, 90, 127); __apc(0x80, 90, 0); __apc(0x80, 98, 0)');
  ok('grid-modus weer uit', await evalueer("window.lagen.stand.edit === 'uit'"));

  // Stop All Clips: rem.
  ok('track 1 speelt', await evalueer("window.engine.deck('A').playing"));
  await evalueer('__apc(0x90, 81, 127); __apc(0x80, 81, 0)');
  ok('Stop All Clips: de track remt', await evalueer("window.engine.deck('A').remt === true"));
  ok('LED rem-pad (rij 4, kolom 1): fel oranje', await evalueer("window.feedback.desired().get('note:0:8')?.[2] === 9"));
  const remTijd = await evalueer("window.engine.deck('A').remTijd");
  ok(`na de remtijd (${remTijd.toFixed(2)} s) staat hij stil`, await totDat("!window.engine.deck('A').playing && !window.engine.deck('A').remt", remTijd * 1000 + 3000));
  ok('LED op de maat (rij 5): stil = donkergroen', await evalueer("window.feedback.desired().get('note:0:0')?.[2] === 22"));

  // ▼ loopt rond: klank -> hotcues.
  await evalueer('__apc(0x90, 95, 127); __apc(0x80, 95, 0)');
  ok('▼ vanuit klank: hotcues', await evalueer("window.lagen.stand.grid === 'hotcues'"));
  ok('geen fouten in de app', meldingen.length === 0, meldingen.join(' | '));
  meldingen.length = 0;

  // ---- apc.html ---------------------------------------------------------------
  console.log('apc.html');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/apc.html` });
  await totDat("document.querySelectorAll('#plaat [data-sig]').length > 100", 15000);
  ok('de kaart leest de nieuwe standaard (374 regels)', await totDat("/374 regels/.test(document.getElementById('bron')?.textContent)"),
    await evalueer("document.getElementById('bron')?.textContent"));
  const titel = (sig) => evalueer(`document.querySelector('#plaat [data-sig="${sig}"]')?.title ?? ''`);
  const klasse = (sig) => evalueer(`document.querySelector('#plaat [data-sig="${sig}"]')?.className ?? ''`);
  ok('Bank ◀ ▶: beatjump, soort transport', /beatjump terug/.test(await titel('note:0:60')) && /s-transport/.test(await klasse('note:0:60')));
  ok('Pan: loop in, soort loop', /loop in/.test(await titel('note:0:87')) && /s-loop/.test(await klasse('note:0:87')));
  ok('Lock: quantize', /quantize/.test(await titel('note:0:63')));
  ok('Stop All: rem, soort kill & rem', /rem \(vinylstop\)/.test(await titel('note:0:81')) && /s-klank/.test(await klasse('note:0:81')));
  ok('Bank (0x67): vrij', /vrij/.test(await titel('note:0:103')) && /s-vrij/.test(await klasse('note:0:103')));
  await evalueer(`document.querySelector('[data-modus="grid.klank"]').click()`);
  ok('knop klank: pad 1/1 = kill hoog zolang je drukt, soort kill & rem',
    /kill hoog zolang je drukt/.test(await titel('note:0:32')) && /s-klank/.test(await klasse('note:0:32')));
  ok('rij 5 = op de maat starten', /starten op de volgende maat/.test(await titel('note:0:0')));
  await evalueer(`document.querySelector('#plaat [data-sig="note:0:32"]').click()`);
  ok('detail pad 1/1: met shift = kill hoog aan/uit, en per modus ook klank',
    await totDat("/kill hoog aan\\/uit/.test(document.getElementById('detail').textContent) && /klank/.test(document.getElementById('detail').textContent)"));
  ok('legenda heeft de soort kill & rem', await evalueer("/kill & rem/.test(document.getElementById('legenda').textContent)"));
  await foto('apc-kaart-klank.png');
  await evalueer("document.getElementById('shift').click()");
  ok('met shift: scene 5 = modus klank, Bank ▶ = beatjump-lengte ×2',
    /klank/.test(await titel('note:0:86')) && /verdubbelen/.test(await titel('note:0:61')));
  await foto('apc-kaart-klank-shift.png');
  ok('geen fouten op apc.html', meldingen.length === 0, meldingen.join(' | '));
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
