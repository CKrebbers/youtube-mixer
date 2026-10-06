// De maat als bron voor de vormlagen (src/analysis/maat.js), in een echte
// headless Chromium met ?vormen=1: klappen en tel van de maatgever, de
// wissel van maatgever met echte decks, en de haak in laag.frame.
//
// Zelfde opzet als kijk.mjs (zie daar): eigen server op een eigen poort met
// een tijdelijke database, requestMIDIAccess weggehaald vóór de pagina laadt,
// dus veilig met de APC aangesloten. Geen schermafdrukken.
//
// Gebruik:  node tools/headless/vorm-maat.mjs
// Poorten:  VARVE_KIJK_POORT (standaard 8792) en VARVE_KIJK_DEBUG (9338).
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8792, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9338;
const tmp = mkdtempSync(join(tmpdir(), 'varve-maat-'));

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

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// Meten op de audioklok met een EIGEN maatlezer op dezelfde decks, op ~60 Hz
// (de animatielus haalt headless maar een paar beelden per seconde). Per
// meting: t, de waarden, wie de maat gaf, en of die maatgever sinds de vorige
// meting een klap of tel had (dan mag het omhoog, anders niet).
const meetMaat = (s, stap = '') => evalueer(`(async () => {
  const e = window.engine, M = window.__maat, mx = window.videoMixer;
  const vertraging = () => (e.ctx.outputLatency || 0) + (e.ctx.baseLatency || 0);
  const l = window.__lezer ??= M.engineMaatLezer(e, mx.decks, vertraging);
  const uit = []; const eind = e.ctx.currentTime + ${s};
  let vorig = null;
  await new Promise((ok) => {
    const f = () => {
      ${stap}
      const t = e.ctx.currentTime - vertraging();
      const w = l.lees(t);
      const d = l.maatgever ? e.deck(l.maatgever) : null;
      const hoor = d ? d.position - vertraging() * d.rate : null;
      const r = { t, klap: w.maatklap, tel: w.tel, wie: l.maatgever, hoor,
        // wat het zonder de wisselregel was geweest: de klap en tel van de maatgever zelf
        ruwKlap: d ? M.klapOmhullende(d.onsets, hoor, d.rate) : 0, ruwTel: d ? M.telPuls(d.grid, hoor).v : 0 };
      if (vorig && d && vorig.wie === l.maatgever && vorig.hoor !== null) {
        const tel = Math.floor(d.grid.beatAt(hoor)) > Math.floor(d.grid.beatAt(vorig.hoor));
        const klap = [...(d.onsets ?? [])].some((k) => k > vorig.hoor - 1e-9 && k < hoor + M.KLAP_OP * d.rate);
        r.nieuwTel = tel; r.nieuwKlap = klap;
      }
      uit.push(r); vorig = r;
      e.ctx.currentTime < eind ? setTimeout(f, 16) : ok();
    };
    f();
  });
  return uit;
})()`);

/** Omhoog zonder klap of tel van de maatgever sinds de vorige meting (een wissel telt als "geen"). */
function vreemdOmhoog(reeks) {
  let n = 0;
  for (let i = 1; i < reeks.length; i++) {
    const [a, b] = [reeks[i - 1], reeks[i]];
    if (b.klap > a.klap + 1e-9 && !b.nieuwKlap) n++;
    if (b.tel > a.tel + 1e-9 && !b.nieuwTel) n++;
  }
  return n;
}

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

  console.log('de maat als bron, met ?vormen=1');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=1` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer && window.vormen)').catch(() => false)) break; await wacht(200); }
  await wacht(1000);
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  const opties = await evalueer(`[...document.querySelectorAll('.vorm-reageer-bron optgroup')].map((g) => g.label + ': ' + [...g.children].map((o) => o.value).join(','))`);
  ok('de bronkeuze toont de maatgever: klap (maat), tel, sectie en nieuwe sectie', opties.length === 2
    && opties[1] === 'de maatgever: maatklap,tel,sectie.energie,sectie.nieuw', opties.join(' | '));

  // Twee demotracks: A op de tel, B een halve tel later. Grid en klappen met de
  // hand (de demo komt niet uit de library, dus laden.js haalt er niets voor op).
  await evalueer(`(async () => {
    window.__act = await import('/src/control/actions.js');
    window.__maat = await import('/src/analysis/maat.js');
    window.__vertraging = (await import('/src/engine/hoorbaar.js')).uitgangsVertraging;
    window.__MAAT_WACHT = (await import('/src/engine/engine.js')).MAAT_WACHT;
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    await window.engine.resume();
    document.getElementById('video-btn').click();
    const e = window.engine, tel = 60 / 124;
    await e.deck('A').laadGeheugen(renderDemoTrack(e.ctx, { seed: 0, bars: 16 }), 'demo A');
    await e.deck('B').laadGeheugen(renderDemoTrack(e.ctx, { seed: 1, bars: 16 }), 'demo B');
    e.deck('A').setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
    e.deck('B').setGrid(new Beatgrid({ bpm: 124, firstBeat: tel / 2 }));
    e.deck('A').onsets = Float64Array.from({ length: 64 }, (_, k) => k * tel);
    e.deck('B').onsets = Float64Array.from({ length: 64 }, (_, k) => tel / 2 + k * tel);
    __act.invoke('track.1.fader', 1); __act.invoke('track.2.fader', 1); __act.invoke('mixer.xfader', 0);
    __act.invoke('track.1.play', true); __act.invoke('track.1.play', false);
    __act.invoke('track.2.play', true); __act.invoke('track.2.play', false);
    if (!window.vormen.lagen[0].aan) { __act.invoke('video.layer.on', true); __act.invoke('video.layer.on', false); }
    __act.invoke('video.layer.react', 1);
    for (let i = 0; i < 6; i++) { __act.invoke('video.layer.react.source', true); __act.invoke('video.layer.react.source', false); }
  })()`);
  ok('zes keer bron: laag → … → tel', await evalueer("document.querySelector('.vorm-reageer-bron').value === 'tel'"));
  ok('laag 1 aan, reageer open', await evalueer("window.vormen.lagen[0].aan && __act.read('video.layer.react') === 1"));
  await wacht(700);
  const status = () => evalueer("(() => { const el = document.querySelector('.vorm-reageer-maat'); return el.style.display === 'none' ? '(verborgen)' : el.textContent; })()");
  ok('het paneel zegt wie de maat geeft: track 1 (crossfader op A)', (await status()) === 'maat 1', await status());

  // De haak in laag.frame: de tel duwt knop 1 als OFFSET, de knop zelf blijft
  // staan. De animatielus haalt headless maar een beeld per paar seconden,
  // dus hier roepen we laag.frame (met de haak van het paneel) zelf aan, op
  // ~60 Hz, met de t die de mixer ook geeft. Een eigen maatlezer ernaast
  // zegt wat de offset moet zijn: tel × sterkte (1).
  const basis = await evalueer('window.vormen.lagen[0].leesKnop(0)');
  const haak = (s) => evalueer(`(async () => {
    const e = window.engine, M = window.__maat, mx = window.videoMixer, l = window.vormen.lagen[0];
    // Dezelfde vertraging als het vormpaneel (uitgangsVertraging: ook de vooruitblik
    // van de master-limiter, 1,5 ms). Zonder die liep de eigen lezer 1,5 ms voor
    // op die van het paneel: afwijking ~0,015 (en ~1 als er een tel tussen viel).
    const vertraging = () => window.__vertraging(e.ctx);
    const eigen = M.engineMaatLezer(e, mx.decks, vertraging);
    const uit = []; const eind = e.ctx.currentTime + ${s};
    await new Promise((ok) => {
      const f = () => {
        const t = e.ctx.currentTime - vertraging();
        l.frame(t);
        uit.push({ mod: l.mod[0], moet: eigen.lees(t).tel });
        e.ctx.currentTime < eind ? setTimeout(f, 16) : ok();
      };
      f();
    });
    return uit;
  })()`);
  const mods = await haak(3);
  const afw = Math.max(...mods.map((m) => Math.abs(m.mod - m.moet)));
  ok('de tel duwt knop 1 via de haak in laag.frame: offset = tel × sterkte',
    mods.some((m) => m.mod > 0.5) && mods.every((m) => m.mod >= 0 && m.mod <= 1) && afw < 1e-9,
    `${mods.length} beelden, max ${Math.max(...mods.map((m) => m.mod)).toFixed(2)}, afwijking ${afw.toExponential(1)}`);
  ok('de knop zelf (scherm, ring, soft-takeover) blijft op zijn basisstand', (await evalueer('window.vormen.lagen[0].leesKnop(0)')) === basis);

  const kruist = (reeks, k) => reeks.filter((r, j) => j > 0 && r[k] > 0.3 && reeks[j - 1][k] <= 0.3).length;
  const a = await meetMaat(3);
  const telKeer = kruist(a, 'tel'), klapKeer = kruist(a, 'klap');
  ok('op de audioklok: track 1 geeft de maat', a.every((r) => r.wie === 'A'), `${a.length} metingen`);
  ok('3 s op 124 bpm: 5 tot 7 tellen en klappen gezien (6,2 verwacht)', telKeer >= 5 && telKeer <= 7 && klapKeer >= 5 && klapKeer <= 7, `${telKeer} tellen, ${klapKeer} klappen`);
  ok('tussen de tellen dooft het uit', Math.min(...a.map((r) => r.tel)) < 0.15 && Math.min(...a.map((r) => r.klap)) < 0.15);
  ok('nergens omhoog zonder klap of tel', vreemdOmhoog(a) === 0, `${vreemdOmhoog(a)} keer`);

  // Crossfader naar B, halverwege de meting. De maatgever wisselt pas na
  // MAAT_WACHT (hysterese, integratie ronde 3): de crossfader gaat zo dat de
  // WISSEL vlak na een klap van B valt (25–75 ms), dus B staat dan midden in
  // een klap.
  const w = await meetMaat(3, `if (!window.__gezet && e.ctx.currentTime > eind - 1.5) {
    const b = e.deck('B'), f = b.grid.phase(b.position - vertraging() * b.rate + window.__MAAT_WACHT * b.rate);
    if (f > 0.05 && f < 0.15) { window.__gezet = true; window.__gezetT = e.ctx.currentTime; __act.invoke('mixer.xfader', 1); }
  }`);
  const i = w.findIndex((r) => r.wie === 'B');
  ok('crossfader naar B: track 2 geeft de maat', i > 0 && w.slice(i).every((r) => r.wie === 'B'), i > 0 ? `wissel op meting ${i}` : 'geen wissel');
  const gezetT = await evalueer('window.__gezetT - ((window.engine.ctx.outputLatency || 0) + (window.engine.ctx.baseLatency || 0))');
  const wachtte = i > 0 ? w[i].t - gezetT : NaN;
  const MAAT_WACHT = await evalueer('window.__MAAT_WACHT');
  ok(`de vormen wisselen pas na MAAT_WACHT, zoals de MAAT-badge (hysterese van de engine): ${(wachtte * 1000).toFixed(0)} ms`,
    wachtte >= MAAT_WACHT - 1e-3 && wachtte < MAAT_WACHT + 0.15);
  ok('geen sprong omhoog bij de wissel midden in een klap van B, ook niet met echte decks',
    vreemdOmhoog(w) === 0 && i > 0 && w[i].klap <= w[i - 1].klap + 1e-9 && w[i].tel <= w[i - 1].tel + 1e-9 && w[i].ruwKlap > 0.3,
    i > 0 ? `klap ${w[i - 1].klap.toFixed(2)} -> ${w[i].klap.toFixed(2)}, tel ${w[i - 1].tel.toFixed(2)} -> ${w[i].tel.toFixed(2)}; `
      + `zonder de regel ${w[i].ruwKlap.toFixed(2)} en ${w[i].ruwTel.toFixed(2)}` : '');
  const naB = kruist(w.slice(i), 'tel');
  ok('daarna slaat de tel van B door', naB >= 2, `${naB} tellen`);
  ok('de MAAT-badge van de engine is het eens (syncMaster)', await evalueer("window.engine.syncMaster()?.id === 'B'"));
  await wacht(700);
  ok('het paneel zegt: maat 2', (await status()) === 'maat 2', await status());

  // Bron klap (maat) op een track zonder klappen: het paneel zegt het.
  // Rondlopen tot klap (maat): na tel komen sinds 6 okt eerst de sectiebronnen, dan laag.
  for (let k = 0; k < 9 && await evalueer("document.querySelector('.vorm-reageer-bron').value") !== 'maatklap'; k++) {
    await evalueer("__act.invoke('video.layer.react.source', true); __act.invoke('video.layer.react.source', false)");
  }
  ok('bron klap (maat)', await evalueer("document.querySelector('.vorm-reageer-bron').value === 'maatklap'"));
  await evalueer("window.engine.deck('B').onsets = null");
  await wacht(700);
  ok('maatgever zonder klappen: het paneel zegt het', (await status()) === 'maat 2 · geen klappen', await status());

  // Fader van B dicht (crossfader nog op B, dus A hoor je ook niet): de
  // MAAT-badge blijft op B (syncMaster neemt een spelende track, ook als je
  // hem niet hoort), de vormen niet. Het paneel zegt waarom.
  await evalueer("__act.invoke('track.2.fader', 0)");
  await wacht(700);
  ok('fader van de maatgever dicht: MAAT-badge op 2, het paneel zegt dat je hem niet hoort',
    (await evalueer("window.engine.syncMaster()?.id === 'B'")) && (await status()) === 'geen maat · track 2 hoor je niet', await status());

  // Alles stil: geen maatgever, geen fout, de offset dooft uit tot 0. De
  // badge staat dan op "MAAT (stil)" van track 1 (de eerste met een grid).
  await evalueer("__act.invoke('track.1.play', true); __act.invoke('track.1.play', false); __act.invoke('track.2.play', true); __act.invoke('track.2.play', false)");
  await wacht(700);
  ok('alles stil: "geen maat" en waarom', (await status()) === 'geen maat · track 1 staat stil', await status());
  const stil = await haak(1.5);
  ok('zonder maatgever: offset 0', stil.length > 0 && stil[stil.length - 1].mod === 0, `${stil.length} beelden`);
  await evalueer("__act.invoke('video.layer.react', 0)");
  await wacht(700);
  ok('reageer dicht: alle offsets 0', await evalueer("window.vormen.lagen[0].mod.every((x) => x === 0)"));
  ok('geen fouten', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : '\nAlles groen.');
process.exit(rood ? 1 : 0);
