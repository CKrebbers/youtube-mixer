// De app in een headless Chromium draaien en bekijken, zonder dependencies:
// het DevTools-protocol over een WebSocket (Node 22+ heeft die ingebouwd).
//
// VEILIG MET DE APC AANGESLOTEN: vóór de pagina laadt wordt
// navigator.requestMIDIAccess weggehaald, dus dit tabblad kan de APC niet
// eens zien (geen tweede MIDI-client, zie CLAUDE.md, "ÉÉN VARVE-tabblad").
// Het draait een EIGEN server op een eigen poort met een tijdelijke database,
// media- en opnamemap: Clay's library wordt niet aangeraakt.
//
// Gebruik:  node tools/headless/kijk.mjs [uitmap]
// Chromium: de headless shell uit de Playwright-cache (~/Library/Caches/ms-playwright),
// of zet VARVE_CHROME op een eigen pad.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8791, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9337;
const tmp = mkdtempSync(join(tmpdir(), 'varve-kijk-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Wachten tot de app klaar is (engine, mixer en, met de vlag, de vormen), niet
 * een vaste tijd: op een drukke machine duurde laden meer dan de 2,5 s die hier
 * eerst stond, en dan faalde alles erna. Daarna nog even voor de eerste beelden.
 */
async function wachtOpApp(metVormen, maxMs = 20000) {
  const klaar = metVormen ? 'window.engine && window.videoMixer && window.vormen' : 'window.engine && window.videoMixer';
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${klaar})`).catch(() => false)) break; await wacht(200); }
  await wacht(1000);
}
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

  // ---- zonder vlag: de app zoals hij was ----------------------------------
  console.log('zonder ?vormen');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  await wachtOpApp(false);
  ok('de app start', await evalueer('!!window.engine && !!window.videoMixer'));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  ok('geen vormlagen: geen rij, geen actions, geen beeldlagen',
    await evalueer("!document.querySelector('.vid-vorm') && !window.vormen && window.videoMixer.beeldlagen.length === 0"));
  ok('geen mapje-vorm-regels in de mapping', await evalueer("!window.mapping.kies('note:0:65')"));
  ok('geen fouten', meldingen.length === 0, meldingen.join(' | '));
  meldingen.length = 0;

  // ---- met vlag ------------------------------------------------------------
  console.log('met ?vormen=1');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=1` });
  await wachtOpApp(true);
  ok('de vormrij staat in het videopaneel', await evalueer("!!document.querySelector('#video-panel .vid-vorm')"));
  ok('twee lagen aan de mixer gehangen', await evalueer('window.videoMixer.beeldlagen.length === 2'));
  ok('de vormen draaien in een Worker (werker-modus, budget 12 ms)',
    await evalueer("window.vormen.lagen.every((l) => l.modus === 'werker' && !!l.werker && l.budgetMs === 12)"),
    await evalueer("window.vormen.lagen.map((l) => l.modus).join(',')"));
  ok('Detail View opent het mapje vorm (fragment geladen)', await evalueer("window.mapping.kies('note:0:65')?.action === 'layer.device.detail'"));
  ok('en het fragment staat niet in je bewaarde mapping', await evalueer("window.mapping.toJSON().rules.every((r) => !r.action.startsWith('video.layer.'))"));

  // Audio aan (geen klik nodig met deze autoplay-vlag), video-paneel open.
  await evalueer('window.engine.resume()');
  await evalueer("document.getElementById('video-btn').click()");

  // Bediening zoals de APC hem stuurt: bytes -> parseMessage -> mapping.
  await evalueer(`(async () => {
    const { parseMessage } = await import('/src/control/midi.js');
    window.__apc = (...b) => window.mapping.handle(parseMessage(new Uint8Array(b)));
  })()`);
  await evalueer('__apc(0x90, 65, 127); __apc(0x80, 65, 0)');
  ok('APC Detail View: mapje vorm open', await evalueer("window.lagen.stand.device === 'vorm'"));
  await evalueer('__apc(0x90, 62, 127); __apc(0x80, 62, 0)');
  ok('APC On/Off in het mapje: laag 1 aan', await evalueer('window.vormen.lagen[0].aan === true'));
  const voor = await evalueer('window.vormen.lagen[0].leesKnop(0)');
  await evalueer('__apc(0xB0, 16, 64); __apc(0xB0, 16, 80)');
  const na = await evalueer('window.vormen.lagen[0].leesKnop(0)');
  ok('APC device knob 1 draait de vorm (endless)', na !== voor, `${voor?.toFixed(3)} -> ${na?.toFixed(3)}`);
  await evalueer('__apc(0x90, 59, 127); __apc(0x80, 59, 0)');
  ok('APC Device ▶: volgende vorm', await evalueer("window.vormen.lagen[0].sys.id !== 'lz'"), await evalueer('window.vormen.lagen[0].sys.naam'));
  await evalueer('__apc(0x90, 58, 127); __apc(0x80, 58, 0)');
  await evalueer('__apc(0x90, 61, 127); __apc(0x80, 61, 0); __apc(0x90, 62, 127); __apc(0x80, 62, 0)');
  ok('APC Bank ▶ + On/Off: laag 2 ook aan', await evalueer('window.vormen.gekozen === 1 && window.vormen.lagen[1].aan'));

  // 60 beelden laten tekenen en tellen hoeveel stappen de vormen deden.
  const t0 = await evalueer('window.engine.ctx.currentTime');
  await evalueer(`new Promise((ok) => { let n = 0; const f = () => (++n < 60 ? requestAnimationFrame(f) : ok()); requestAnimationFrame(f); })`);
  const t1 = await evalueer('window.engine.ctx.currentTime');
  ok('60 beelden getekend zonder fouten', meldingen.length === 0, meldingen.join(' | '));
  ok('de audioklok loopt, dus de vormen bewegen', t1 > t0, `${(t1 - t0).toFixed(2)} s`);
  ok('de mixer heeft de lagenstap gebouwd', await evalueer('!!window.videoMixer.gelaagd && !window.videoMixer.fout'), await evalueer('window.videoMixer.fout || ""'));
  ok('nog steeds in de Worker na 60 beelden (geen terugval)', await evalueer("window.vormen.lagen.every((l) => l.modus === 'werker')"));
  ok('de Worker stuurde ImageBitmaps terug (16:9, 640 × 360), en frame() geeft het laatste',
    await evalueer("window.vormen.lagen.every((l) => l.beeld instanceof ImageBitmap && l.beeld.width === 640 && l.beeld.height === 360 && l.versie > 3)"),
    await evalueer("window.vormen.lagen.map((l) => `v${l.versie} ${l.ms?.toFixed(1)} ms ${Math.round(l.kwaliteit * 100)}%`).join(' | ')"));
  ok('het bitmap is niet leeg (createImageBitmap kopieert; transferToImageBitmap liet het canvas leeg)', await evalueer(`(() => {
    const c = new OffscreenCanvas(640, 360), x = c.getContext('2d');
    x.drawImage(window.vormen.lagen[0].beeld, 0, 0);
    const d = x.getImageData(0, 0, 640, 360).data;
    let licht = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) licht++;
    return licht > 5;
  })()`));
  ok('rekentijd en kwaliteit per laag op het scherm (≥ 11 px)', await evalueer(`(() => {
    const m = [...document.querySelectorAll('.vorm-meting')];
    return m.length === 2 && m.every((el) => /[0-9]+([.][0-9])? ms · [0-9]+%/.test(el.textContent)) && parseFloat(getComputedStyle(m[0]).fontSize) >= 11;
  })()`), await evalueer("[...document.querySelectorAll('.vorm-meting')].map((e) => e.textContent).join(' | ')"));
  // Oriëntatie: een ImageBitmap negeert UNPACK_FLIP_Y; de mixer zet het nergens,
  // dus canvas en bitmap moeten als texture precies gelijk staan. Gemeten met
  // een ASYMMETRISCH testbeeld (vier verschillende kwarten, zie CLAUDE.md).
  ok('ImageBitmap staat als texture precies zoals het canvas (vier kwarten)', await evalueer(`(async () => {
    const bron = new OffscreenCanvas(64, 64), x = bron.getContext('2d');
    [['#f00', 0, 0], ['#0f0', 32, 0], ['#00f', 0, 32], ['#ff0', 32, 32]].forEach(([k, a, b]) => { x.fillStyle = k; x.fillRect(a, b, 32, 32); });
    const bm = await createImageBitmap(bron);
    const gl = new OffscreenCanvas(64, 64).getContext('webgl2');
    const lees = (beeld) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, beeld);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const px = new Uint8Array(64 * 64 * 4);
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [0, 40, 64 * 40, 64 * 40 + 40].map((i) => px.slice(i * 4, i * 4 + 3).join(',')).join(' ');
    };
    const a = lees(bron), b = lees(bm);
    bm.close();
    return a === b && new Set(a.split(' ')).size === 4;
  })()`));
  await foto('met-vormen.png');

  // ---- reageren op de mix (stap 2) ----------------------------------------
  console.log('reageren op de mix');
  await evalueer(`(async () => {
    window.__act = await import('/src/control/actions.js');
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    await window.engine.deck('A').laadGeheugen(renderDemoTrack(window.engine.ctx, { seed: 0, bars: 16 }), 'demo');
    __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
    __act.invoke('track.1.play', true); __act.invoke('track.1.play', false);
  })()`);
  await evalueer('__apc(0x90, 60, 127); __apc(0x80, 60, 0)');          // Bank ◀: terug naar laag 1
  ok('reageren staat standaard dicht', await evalueer("__act.read('video.layer.react') === 0 && window.vormen.lagen[0].mod.every((x) => x === 0)"));
  await evalueer('__apc(0xB0, 23, 0); for (let v = 8; v <= 127; v += 8) __apc(0xB0, 23, v)');
  const sterkte = await evalueer("__act.read('video.layer.react')");
  ok('APC device knob 8 in het mapje vorm draait "reageer" open (endless)', sterkte > 0.5, sterkte?.toFixed(2));
  const meet = (s) => evalueer(`new Promise((ok) => {
    const l = window.vormen.lagen[0], uit = []; const eind = performance.now() + ${s * 1000};
    const f = () => { uit.push(l.mod[0]); performance.now() < eind ? requestAnimationFrame(f) : ok({ uit, basis: l.leesKnop(0) }); };
    requestAnimationFrame(f);
  })`);
  const gem = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const basis0 = await evalueer('window.vormen.lagen[0].leesKnop(0)');
  await wacht(400);
  const met = await meet(1.5);
  ok('de demo speelt en de bas duwt knop 1 (offset > 0)', gem(met.uit) > 0.05, `gem ${gem(met.uit).toFixed(3)} over ${met.uit.length} beelden`);
  ok('de knop zelf (scherm, ring, soft-takeover) blijft op zijn basisstand', met.basis === basis0);
  await evalueer("__act.invoke('track.1.low', 0)");
  await wacht(400);
  const kill = await meet(1.5);
  ok('bass-kill op de track: de offset zakt in', gem(kill.uit) < gem(met.uit) * 0.5, `${gem(met.uit).toFixed(3)} -> ${gem(kill.uit).toFixed(3)}`);
  await evalueer("__act.invoke('track.1.low', 0.5)");
  for (let i = 0; i < 3; i++) await evalueer("__act.invoke('video.layer.react.source', true); __act.invoke('video.layer.react.source', false)");
  ok('bron gewisseld naar klap (onset)', await evalueer("document.querySelector('.vorm-reageer-bron').value === 'onset'"));
  // De animatielus haalt headless (swiftshader) maar een paar beelden per
  // seconde: te traag om klappen van 0,1 s te zien. De detector zelf meten we
  // daarom met een eigen luisteraar op dezelfde master-analyser, op ~60 Hz.
  const kl = await evalueer(`(async () => {
    const { Luisteraar } = await import('/src/analysis/luisteraar.js');
    const e = window.engine, l = new Luisteraar({ analyser: () => e.master.analyser, sampleRate: () => e.ctx.sampleRate });
    let n = 0, laag = 0, m = 0; const eind = e.ctx.currentTime + 3;
    await new Promise((ok) => { const f = () => { const w = l.lees(e.ctx.currentTime); if (w) { n += w.klap ? 1 : 0; laag += w.laag; m++; } e.ctx.currentTime < eind ? setTimeout(f, 16) : ok(); }; f(); });
    return { n, laag: laag / m, m, fft: e.master.analyser.fftSize };
  })()`);
  ok('echte AnalyserNode op fftSize 2048', kl.fft === 2048);
  ok('klappen op de demo (124 bpm, 3 s): tussen 4 en 30', kl.n >= 4 && kl.n <= 30, `${kl.n} klappen in ${kl.m} metingen, laag gem ${kl.laag.toFixed(2)}`);
  await evalueer("__act.invoke('video.layer.react', 0)");
  const dicht = await meet(1);
  ok('reageer dicht: offset terug op 0', dicht.uit.length > 0 && dicht.uit[dicht.uit.length - 1] === 0);
  ok('geen fouten tijdens reageren', meldingen.length === 0, meldingen.join(' | '));
  await evalueer("__act.invoke('track.1.play', true); __act.invoke('track.1.play', false)");

  await evalueer("window.vormen.lagen.forEach((l) => { l.aan = false; })");
  await wacht(300);
  await foto('lagen-uit.png');

  // ---- oriëntatie: video en vorm rechtop, ook met een laag aan -----------
  // Clay (24 sep): met een vormlaag aan stond de YouTube-video op zijn kop. De
  // lagenstap las het gemengde beeld (een buffer) met uv, en dat was een derde
  // omkering. Gemeten met ASYMMETRISCHE beelden (vier kwarten), op het canvas
  // zelf, direct na teken().
  console.log('oriëntatie met en zonder laag');
  const orient = await evalueer(`(async () => {
    const mx = window.videoMixer, gl = mx.gl;
    const kwart = (b, h) => {
      const c = document.createElement('canvas'); c.width = b; c.height = h;
      const x = c.getContext('2d');
      [['#f00', 0, 0], ['#0f0', b / 2, 0], ['#00f', 0, h / 2], ['#ff0', b / 2, h / 2]].forEach(([k, a, d]) => { x.fillStyle = k; x.fillRect(a, d, b / 2, h / 2); });
      return c;
    };
    const nep = Object.assign(kwart(1280, 720), { readyState: 4, currentTime: 0, paused: false, seeking: false, duration: 100, playbackRate: 1, play: () => Promise.resolve(), pause: () => {} });
    __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
    const id = mx.decks[0], oud = mx.lagen.get(id);
    mx.lagen.set(id, { video: nep, url: '', tex: mx._texture(), seekStart: 0, seekDuur: 0, klaar: true });
    const naam = ([r, g, b]) => r > 150 && g > 150 && b < 100 ? 'geel' : r > 150 && g < 100 ? 'rood' : g > 150 && r < 100 ? 'groen' : b > 150 && r < 100 ? 'blauw' : 'anders';
    const meet = () => {
      mx.teken();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4);
      const lees = (fx, fy) => { gl.readPixels(Math.floor(fx * (W - 1)), Math.floor((1 - fy) * (H - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return naam(px); };
      return [lees(0.05, 0.1), lees(0.95, 0.1), lees(0.05, 0.9), lees(0.95, 0.9)].join(' ');
    };
    const zonder = meet();
    window.vormen.lagen[0].aan = true; window.vormen.lagen[0].dekking = 0.01;
    const met = meet();
    window.vormen.lagen[0].aan = false;
    if (oud) mx.lagen.set(id, oud); else mx.lagen.delete(id);
    // Een laag zoals een vormlaag nu is (16:9, 640 × 360), en een vierkante
    // (LAAG_FIT 'vullen': boven en onder valt weg, de hoeken blijven gevuld).
    let weg = mx.voegBeeldlaagToe({ aan: true, dekking: 1, mengvorm: 'add', frame: () => kwart(640, 360) });
    const laag = meet();
    weg();
    weg = mx.voegBeeldlaagToe({ aan: true, dekking: 1, mengvorm: 'add', frame: () => kwart(512, 512) });
    const vierkant = meet();
    weg();
    return { zonder, met, laag, vierkant };
  })()`);
  const rechtop = 'rood groen blauw geel';
  ok('video zonder laag staat rechtop (vier kwarten)', orient.zonder === rechtop, orient.zonder);
  ok('video ONDER een vormlaag staat ook rechtop', orient.met === rechtop, orient.met);
  ok('de vormlaag zelf (16:9) staat rechtop en vult tot in de hoeken', orient.laag === rechtop, orient.laag);
  ok('een vierkante laag ook (vullen)', orient.vierkant === rechtop, orient.vierkant);
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
