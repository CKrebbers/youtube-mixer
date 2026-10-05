// De noodknoppen van de beamer (zwart, bevriezen, master, flits; A4) in een
// echte Chromium: wat staat er PIXEL voor pixel op het canvas, in het
// hoofdvenster én in het losse venster (video.html, dat zelf mengt).
//
// VEILIG MET DE APC AANGESLOTEN, net als kijk.mjs en beamer.mjs:
// navigator.requestMIDIAccess gaat weg vóór elke pagina (ook het losse
// venster: Target.setAutoAttach laat nieuwe pagina's wachten tot dat gedaan
// is). Een EIGEN server op een eigen poort met een tijdelijke database,
// media- en opnamemap.
//
// Testbeeld: geen ingest, maar een CANVAS als nep-video (CLAUDE.md, "Testen
// zonder zichtbaar venster"), ASYMMETRISCH: rood linksboven, groen
// rechtsboven, blauw linksonder, geel rechtsonder. Op track 1 staat de
// demotrack (stil): de mixer toont alleen een track met audio.
//
// Gebruik:  node tools/headless/noodknoppen.mjs
//   VARVE_CHROME=<pad>  een eigen Chromium (anders de Playwright-cache:
//                       PLAYWRIGHT_BROWSERS_PATH, ~/.cache of ~/Library/Caches)
//   VARVE_KIJK_POORT / VARVE_KIJK_DEBUG  andere poorten (standaard 8797 / 9397)
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8797, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9397;
const tmp = mkdtempSync(join(tmpdir(), 'varve-nood-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache/ms-playwright'), join(homedir(), 'Library/Caches/ms-playwright')];
  for (const cache of caches.filter((c) => c && existsSync(c))) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (!shell) continue;
    const map = join(cache, shell);
    for (const sub of readdirSync(map)) {
      for (const naam of ['chrome-headless-shell', 'headless_shell']) if (existsSync(join(map, sub, naam))) return join(map, sub, naam);
    }
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [`--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required', '--disable-popup-blocking', 'about:blank'], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
const nieuweDoelen = [];
function cdp(method, params = {}, sessionId) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((goed, fout) => wachtend.set(id, { ok: goed, fout }));
}
async function ev(sid, expr, gebaar = false) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gebaar }, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function wachtTot(sid, expr, maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await ev(sid, `!!(${expr})`).catch(() => false)) return true; await wacht(150); }
  return false;
}

// In elke pagina: een nep-video (canvas, vier kwarten) en de pixels lezen in
// het midden van elk kwart, METEEN na teken() (zelfde taak: zonder
// preserveDrawingBuffer is het canvas daarna leeg).
const HULP = `(() => {
  window.__kwart = (c, kleuren = ['#f00', '#0f0', '#00f', '#ff0']) => {
    const x = c.getContext('2d'), b = c.width, h = c.height;
    [[0, 0], [b / 2, 0], [0, h / 2], [b / 2, h / 2]].forEach(([a, d], i) => { x.fillStyle = kleuren[i]; x.fillRect(a, d, b / 2, h / 2); });
    return c;
  };
  window.__nep = () => {
    const c = __kwart(Object.assign(document.createElement('canvas'), { width: 1280, height: 720 }));
    return Object.assign(c, { readyState: 4, currentTime: 0, paused: true, seeking: false, duration: 1000, playbackRate: 1,
      play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  };
  window.__hang = (mx, nep) => mx.lagen.set(mx.decks[0], { video: nep, url: null, tex: mx._texture(), seekStart: 0, seekDuur: 0, klaar: true, gemeld: false });
  window.__lees = (mx) => {
    const gl = mx.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4);
    return [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([fx, fy]) => {
      gl.readPixels(Math.floor(fx * W), Math.floor((1 - fy) * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    });
  };
  window.__meet = (mx) => { mx.teken(); return __lees(mx); };
  // Wat de EIGEN lus van het venster tekende: een rAF die na die van de app komt.
  window.__lus = (mx) => new Promise((r) => requestAnimationFrame(() => r(__lees(mx))));
  // Een verloop meten op EXACTE tijden: met swiftshader duurt één beeld
  // lezen hier tot seconden, dus de wandklok zegt niets. De mixer rekent met
  // performance.timeOrigin + performance.now() (eindbeeld.js); die zetten we
  // even zelf, synchroon (niets anders draait ertussen), en dan weer terug.
  window.__verloop = (mx, doe, tijden) => {
    const echt = performance.now, t0 = echt.call(performance);
    let t = 0;
    performance.now = () => t0 + t;
    try {
      doe();
      return tijden.map((x) => { t = x; return { t: x, p: __meet(mx) }; });
    } finally { performance.now = echt; }
  };
})()`;

const kwarten = (p) => p.map((c) => c.join(',')).join(' ');
const RECHTOP = '255,0,0 0,255,0 0,0,255 255,255,0';
const zwart = (p) => p.every((c) => c[0] === 0 && c[1] === 0 && c[2] === 0);
const wit = (p) => p.every((c) => c[0] === 255 && c[1] === 255 && c[2] === 255);
const rond = (p, verwacht, marge = 2) => p.every((c, i) => c.every((v, k) => Math.abs(v - verwacht[i][k]) <= marge));
const ORIGINEEL = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
const HALF = ORIGINEEL.map((c) => c.map((v) => v / 2));

try {
  let versie = null;
  for (let i = 0; i < 60 && !versie; i++) { await wacht(200); versie = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json()).catch(() => null); }
  console.log(versie.Browser);
  ws = new WebSocket(versie.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo, waitingForDebugger } = m.params;
      (async () => {
        if (targetInfo.type === 'page') {
          await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI }, sessionId).catch(() => {});
          await cdp('Runtime.enable', {}, sessionId).catch(() => {});
        }
        if (waitingForDebugger) await cdp('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
        nieuweDoelen.push({ sessionId, ...targetInfo });
      })();
    }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  const { targetInfos } = await cdp('Target.getTargets');
  const hoofdId = targetInfos.find((t) => t.type === 'page').targetId;
  const { sessionId: hoofd } = await cdp('Target.attachToTarget', { targetId: hoofdId, flatten: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI }, hoofd);
  await cdp('Page.enable', {}, hoofd);
  await cdp('Runtime.enable', {}, hoofd);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, hoofd);
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (let i = 0; i < 60; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` }, hoofd);
  ok('de app start', await wachtTot(hoofd, 'window.engine && window.videoMixer && window.varveBeamer'));
  ok('geen MIDI in dit tabblad', await ev(hoofd, '!navigator.requestMIDIAccess'));
  await ev(hoofd, HULP);
  await ev(hoofd, `(async () => {
    window.__act = await import('/src/control/actions.js');
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    await window.engine.deck('A').laadGeheugen(renderDemoTrack(window.engine.ctx, { seed: 0, bars: 4 }), 'demo');
    __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
    document.getElementById('video-btn').click();
    window.__nepHoofd = __nep();
    __hang(window.videoMixer, window.__nepHoofd);
  })()`);
  const mx = 'window.videoMixer';
  ok('zonder noodknop: vier kwarten, rechtop', kwarten(await ev(hoofd, `__meet(${mx})`)) === RECHTOP, kwarten(await ev(hoofd, `__meet(${mx})`)));

  // ---- zwart: de knop in het paneel (pointerdown/up, zoals een klik) --------
  const klik = (sel, shift = false) => ev(hoofd, `(() => { const b = document.querySelector('${sel}');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: ${shift} })); return b; })()`)
    .then(() => ev(hoofd, `document.querySelector('${sel}').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) || true`));
  // Het verloop van de fade, in de pagina gemeten: rood van het eerste kwart.
  const zv = await ev(hoofd, `__verloop(${mx}, () => { const b = document.querySelector('.vid-zwart');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); },
    [0, 25, 62.5, 125, 187.5, 225, 249, 250, 300])`);
  console.log(`      fade: ${zv.map((x) => `${x.t} ms ${x.p[0][0]}`).join(' · ')}`);
  const verwacht = (t) => 255 * Math.max(0, 1 - t / 250);
  ok('knop zwart: de stand op de bus is aan', (await ev(hoofd, "__act.read('video.black')")) === 1);
  ok('de fade volgt 255 × (1 − t/250 ms): geen klap, en elk beeld donkerder', zv.every((x, i) => (i === 0 || x.p[0][0] <= zv[i - 1].p[0][0])
    && Math.abs(x.p[0][0] - verwacht(x.t)) <= 2) && zv[0].p[0][0] === 255);
  const z2 = zv.at(-1).p;
  ok('na de fade (250 ms): ECHT zwart, 0,0,0 in alle vier de kwarten', zwart(z2), kwarten(z2));
  const lus = await ev(hoofd, `__lus(${mx})`);
  ok('ook wat de eigen lus van de app tekent is zwart', zwart(lus), kwarten(lus));
  ok('en de knop brandt (stand teruggelezen)', await wachtTot(hoofd, "document.querySelector('.vid-zwart').classList.contains('on')", 3000));
  await klik('.vid-zwart');
  await wacht(300);
  ok('weer uit: na de fade het beeld terug', kwarten(await ev(hoofd, `__meet(${mx})`)) === RECHTOP);

  // ---- zwart vasthouden: shift + de knop (de drukvariant), direct ----------
  await ev(hoofd, `document.querySelector('.vid-zwart').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true })) || true`);
  const v0 = await ev(hoofd, `__meet(${mx})`);
  ok('shift + zwart vasthouden: direct 0 (geen fade)', zwart(v0) && (await ev(hoofd, "__act.read('video.black.hold')")) === 1, kwarten(v0));
  await ev(hoofd, `document.querySelector('.vid-zwart').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) || true`);
  ok('loslaten: direct terug', kwarten(await ev(hoofd, `__meet(${mx})`)) === RECHTOP && (await ev(hoofd, "__act.read('video.black')")) === 0);

  // ---- master ---------------------------------------------------------------
  await ev(hoofd, "__act.invoke('video.master', 0.5)");
  const m5 = await ev(hoofd, `__meet(${mx})`);
  ok('master 0,5: elk kanaal half (255 -> ~128)', rond(m5, HALF, 2), kwarten(m5));
  ok('de MASTER-knop in het paneel volgt (read)', await wachtTot(hoofd,
    "Math.abs(parseFloat(getComputedStyle(document.querySelector('.vid-nood .knob-ind')).transform.split(',')[1] ?? 9)) < 0.05", 3000));
  await ev(hoofd, "__act.invoke('video.master', 0)");
  ok('master 0: zwart', zwart(await ev(hoofd, `__meet(${mx})`)));
  await ev(hoofd, "__act.invoke('video.master', 1)");

  // ---- flits ----------------------------------------------------------------
  // Het groen in het RODE kwart: 255 bij vol wit, 0 als de flits weg is.
  const fv = await ev(hoofd, `__verloop(${mx}, () => { const b = document.querySelector('.vid-flits');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); },
    [0, 30, 75, 150, 225, 270, 299, 300, 350])`);
  console.log(`      flits: ${fv.map((x) => `${x.t} ms ${x.p[0][1]}`).join(' · ')}`);
  const flitsVerwacht = (t) => 255 * Math.max(0, 1 - t / 300) ** 2;
  ok('flits: meteen wit, kwadratisch uitdovend (255 × (1 − t/300 ms)²), elk beeld minder',
    wit(fv[0].p) && fv.every((x, i) => (i === 0 || x.p[0][1] <= fv[i - 1].p[0][1])
      && Math.abs(x.p[0][1] - flitsVerwacht(x.t)) <= 2), kwarten(fv[0].p));
  ok('na de flits (300 ms): precies het beeld weer', kwarten(fv.at(-1).p) === RECHTOP, kwarten(fv.at(-1).p));

  // ---- bevriezen ------------------------------------------------------------
  await klik('.vid-bevries');
  await ev(hoofd, `__meet(${mx})`);                       // het eerste beeld na het indrukken blijft staan
  await ev(hoofd, "__kwart(window.__nepHoofd, ['#f0f', '#f0f', '#f0f', '#f0f'])");
  const b1 = await ev(hoofd, `__meet(${mx})`);
  const b2 = await ev(hoofd, `__lus(${mx})`);
  ok('bevroren: de bron wordt magenta, het canvas houdt de kwarten (ook in de lus van de app)', kwarten(b1) === RECHTOP && kwarten(b2) === RECHTOP, kwarten(b1));
  await ev(hoofd, "__act.invoke('video.black.hold', true)");
  ok('zwart werkt ook op een bevroren beeld', zwart(await ev(hoofd, `__meet(${mx})`)));
  await ev(hoofd, "__act.invoke('video.black.hold', false)");
  await klik('.vid-bevries');
  const b3 = await ev(hoofd, `__meet(${mx})`);
  ok('los: meteen de bron van nu (magenta)', b3.every((c) => c[0] === 255 && c[1] === 0 && c[2] === 255), kwarten(b3));
  await ev(hoofd, '__kwart(window.__nepHoofd)');

  // ---- laptopmaat (1440 × 790, Clay's MacBook in Chrome): past de rij? -------
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false }, hoofd);
  await wacht(500);
  const maat = await ev(hoofd, `(() => {
    const rij = document.querySelector('.vid-nood').getBoundingClientRect(), m = document.querySelector('main');
    const fader = document.querySelector('.kolommen input[type=range]')?.getBoundingClientRect().height ?? null;
    return { onder: rij.bottom, hoog: rij.height, scherm: innerHeight, scrolt: m.scrollHeight > m.clientHeight + 1,
      breed: document.documentElement.scrollWidth > innerWidth, fader };
  })()`);
  ok(`op 1440 × 790 past de rij BEELD (onderkant ${Math.round(maat.onder)} ≤ ${maat.scherm}, ${Math.round(maat.hoog)} px hoog), main scrolt niet`,
    maat.onder <= maat.scherm && !maat.scrolt && !maat.breed, `fader ${maat.fader === null ? '?' : Math.round(maat.fader)} px`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, hoofd);

  // ---- het losse venster mengt zelf: neemt het daar ook over? ---------------
  await ev(hoofd, "document.querySelector('.vid-los').click()", true);
  let pop = null;
  for (let i = 0; i < 100 && !pop; i++) { pop = nieuweDoelen.find((d) => d.type === 'page' && d.openerId === hoofdId)?.sessionId; if (!pop) await wacht(100); }
  ok('los venster open', !!pop);
  await wachtTot(pop, "location.pathname.endsWith('video.html') && document.readyState === 'complete' && window.beamerMixer");
  ok('geen MIDI in het losse venster', await ev(pop, '!navigator.requestMIDIAccess'));
  await ev(pop, HULP);
  await ev(pop, 'window.__nepLos = __nep(); __hang(window.beamerMixer, window.__nepLos)');
  ok('het losse venster mengt zelf (na de inloop)', await wachtTot(pop, 'opener.varveBeamer.mengtLos(window)', 25000));
  const lm = 'window.beamerMixer';
  ok('los venster: vier kwarten', kwarten(await ev(pop, `__lus(${lm})`)) === RECHTOP, kwarten(await ev(pop, `__lus(${lm})`)));

  await ev(hoofd, "__act.invoke('video.black', true); __act.invoke('video.black', false)");
  await wacht(350);
  const l1 = await ev(pop, `__lus(${lm})`);
  ok('zwart (in het hoofdvenster gedrukt): het losse venster is ECHT zwart, in zijn eigen lus', zwart(l1), kwarten(l1));
  await ev(hoofd, "__act.invoke('video.black', true); __act.invoke('video.black', false); __act.invoke('video.master', 0.5)");
  await wacht(350);
  const l2 = await ev(pop, `__lus(${lm})`);
  ok('master 0,5: ook daar half', rond(l2, HALF, 2), kwarten(l2));
  await ev(hoofd, "__act.invoke('video.master', 1)");
  await ev(hoofd, "__act.invoke('video.flash', true); __act.invoke('video.flash', false)");
  const l3 = await ev(pop, `__lus(${lm})`);
  // Hoe wit precies hangt af van hoe lang dit rondje duurde; het verloop is hierboven gemeten.
  ok('flits: ook daar (de donkere kanalen lichten op in zijn eigen lus)', l3.every((c) => Math.min(...c) > 30), kwarten(l3));
  await wacht(400);
  await ev(hoofd, "__act.invoke('video.freeze', true); __act.invoke('video.freeze', false)");
  await ev(pop, `__lus(${lm})`);
  await ev(pop, "__kwart(window.__nepLos, ['#f0f', '#f0f', '#f0f', '#f0f'])");
  await ev(pop, `__lus(${lm})`);
  const l4 = await ev(pop, `__lus(${lm})`);
  ok('bevriezen: het losse venster houdt zijn beeld terwijl zijn eigen video magenta wordt', kwarten(l4) === RECHTOP, kwarten(l4));
  await ev(hoofd, "__act.invoke('video.freeze', true); __act.invoke('video.freeze', false)");
  const l5 = await ev(pop, `__lus(${lm})`);
  ok('... en los: magenta', l5.every((c) => c[0] === 255 && c[1] === 0 && c[2] === 255), kwarten(l5));
  await ev(pop, '__kwart(window.__nepLos)');

  // De inloop: het hoofdvenster zet ZIJN canvas op het losse (toonBeeld).
  // Master en zwart zitten daar al in: niet nog eens toepassen.
  await ev(hoofd, "__act.invoke('video.master', 0.5)");
  const i1 = await ev(pop, `(() => { opener.videoMixer.teken(); window.beamerMixer.toonBeeld(opener.document.querySelector('.vid-canvas')); return __lees(window.beamerMixer); })()`);
  ok('inloop (toonBeeld): master 0,5 één keer, niet twee keer (geen 64)', rond(i1, HALF, 3), kwarten(i1));
  await ev(hoofd, "__act.invoke('video.master', 1)");

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
