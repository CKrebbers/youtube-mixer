// Het losse venster (de beamer) headless: mengt het zelf, en loopt het beeld
// door als het hoofdtabblad verborgen is? (ROADMAP 18, docs/BEAMER.md)
//
// VEILIG MET DE APC AANGESLOTEN, net als kijk.mjs: navigator.requestMIDIAccess
// gaat weg vóór ELKE pagina (hoofdvenster, los venster, het extra tabblad:
// Target.setAutoAttach laat nieuwe pagina's wachten tot dat gebeurd is). Een
// EIGEN server op een eigen poort met een tijdelijke database, media- en
// opnamemap: Clay's library en opnames worden niet aangeraakt.
//
// Chrome: de VOLLEDIGE Chrome for Testing met --headless=new uit de
// Playwright-cache, niet de headless shell: alleen daar wordt een tabblad echt
// verborgen (een nieuw tabblad in hetzelfde venster naar voren). Dan staat
// requestAnimationFrame stil en decodeert het geen video, zoals bij Clay.
// Of VARVE_CHROME. WebGL op de GPU (Metal): met swiftshader haalde de mixer
// op een drukke machine 1 beeld per seconde. VARVE_KIJK_GL=swiftshader zet
// het terug op de CPU.
//
// Testbeeld: ffmpeg maakt een video met vier gekleurde kwarten (ASYMMETRISCH:
// rood linksboven, groen rechtsboven, blauw linksonder, geel rechtsonder) en
// een wit blok dat met 200 px/s naar rechts schuift. Uit de plek van het blok
// volgt welk beeld er op het canvas staat, dus hoe ver het beeld van het
// geluid af zit.
//
// Inloop met acht tracks: acht testvideo's met het blok elk op een EIGEN rij
// (rij k = track k). In de mengvorm "licht" (screen) blijft elk blok wit op
// zijn rij, dus per track is af te lezen welk beeld het losse venster TOONT
// (zijn canvas, of tijdens de inloop het beeld van het hoofdvenster) en hoe
// ver dat van het geluid af zit, elk beeld vanaf het openen.
//
// Gebruik:  VARVE_KIJK_POORT=8865 VARVE_KIJK_DEBUG=9465 node tools/headless/beamer.mjs [uitmap]
//   VARVE_WORTEL=<map>   de app uit een andere map serveren (bijv. `git archive`
//                        van oude code): alleen de beeldcontrole met schermafdrukken
//                        draait dan, want die werkt op elke versie.
//   VARVE_BEAMER_DEEL=inloop   alleen de inloop met acht tracks (sneller).
//   VARVE_BEAMER_EIGEN=1       per halve seconde de eigen video's van het losse venster.
//   VARVE_BEAMER_SPOOR=1       elke sprong en elk media-event van die video's (in beamer-inloop.json).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = fileURLToPath(new URL('../..', import.meta.url));
const WORTEL = process.env.VARVE_WORTEL || HIER;
const UIT = process.argv[2] || join(HIER, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8792, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9338;
const tmp = mkdtempSync(join(tmpdir(), 'varve-beamer-'));
mkdirSync(UIT, { recursive: true });
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const map = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const pad = join(cache, map, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  if (!existsSync(pad)) throw new Error(`geen Chrome for Testing gevonden in ${cache} (zet VARVE_CHROME)`);
  return pad;
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// ---- testvideo ------------------------------------------------------------
const VIDEO = join(tmp, 'kwarten.mp4');
{
  const duur = 40;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=red:s=640x360:d=${duur}:r=30`, '-f', 'lavfi', '-i', `color=c=lime:s=640x360:d=${duur}:r=30`,
    '-f', 'lavfi', '-i', `color=c=blue:s=640x360:d=${duur}:r=30`, '-f', 'lavfi', '-i', `color=c=yellow:s=640x360:d=${duur}:r=30`,
    '-f', 'lavfi', '-i', `color=c=white:s=100x100:d=${duur}:r=30`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duur}:sample_rate=48000`,
    '-filter_complex', "[0][1]hstack[top];[2][3]hstack[bot];[top][bot]vstack[q];[q][4]overlay=x='mod(t*200,1180)':y=310[v]",
    '-map', '[v]', '-map', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-shortest', VIDEO]);
  if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
}
/** Tijd in de video uit de plek van het blok (linkerrand = mod(t·200, 1180)), dichtst bij `rond`. */
const tijdVanBlok = (midden, rond) => { const P = 1180 / 200; const t = (midden - 49.5) / 200; return t + Math.round((rond - t) / P) * P; };

// ---- acht testvideo's voor de inloop: per track het blok op een eigen rij --
// 1280×720 zoals YouTube; de ingest codeert opnieuw met een sleutelbeeld per
// 8,3 s (zoals YouTube), dus springen kost net zoveel als bij Clay.
const ALLEEN_INLOOP = process.env.VARVE_BEAMER_DEEL === 'inloop';
const RIJ_DUUR = 60;
/** Midden van het blok van track k (rij k) op het doek van 1280×720; het blok is 60 hoog. */
const RIJ_Y = Array.from({ length: 8 }, (_, k) => 60 + 90 * k);
const rijVideo = (k) => join(tmp, `rij-${k + 1}.mp4`);
function maakRijVideo(k) {
  return new Promise((klaar, fout) => {
    const kleur = (c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=640x360:d=${RIJ_DUUR}:r=30`];
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...kleur('red'), ...kleur('lime'), ...kleur('blue'), ...kleur('yellow'),
      '-f', 'lavfi', '-i', `color=c=white:s=100x60:d=${RIJ_DUUR}:r=30`,
      '-f', 'lavfi', '-i', `sine=frequency=${220 + 55 * k}:duration=${RIJ_DUUR}:sample_rate=48000`,
      '-filter_complex', `[0][1]hstack[top];[2][3]hstack[bot];[top][bot]vstack[q];[q][4]overlay=x='mod(t*200,1180)':y=${RIJ_Y[k] - 30}[v]`,
      '-map', '[v]', '-map', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', rijVideo(k)],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (b) => { err += b; });
    p.on('close', (code) => (code === 0 ? klaar() : fout(new Error(`ffmpeg rij ${k + 1}: ${err}`))));
  });
}
const rijenGemaakt = Promise.all(Array.from({ length: 8 }, (_, k) => maakRijVideo(k)));

// ---- server en Chrome -----------------------------------------------------
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const GL = process.env.VARVE_KIJK_GL === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu'];
const chrome = spawn(zoekChrome(), ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  ...GL, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--disable-popup-blocking', 'about:blank'], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
const nieuweDoelen = [];
function cdp(method, params = {}, sessionId) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
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
async function foto(sid, naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
  return data;
}
/**
 * Een schermafdruk van het losse venster uitlezen, IN dat venster (de browser
 * decodeert de png): de vier kwarten en waar het witte blok staat. Werkt op
 * elke versie van video.html, ook de oude.
 */
const LEES_FOTO = `async (b64) => {
  const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d');
  x.drawImage(bm, 0, 0);
  const W = bm.width, H = bm.height, d = x.getImageData(0, 0, W, H).data;
  const px = (fx, fy) => { const i = (Math.floor(fy * (H - 1)) * W + Math.floor(fx * (W - 1))) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const naam = ([r, g, b]) => r > 150 && g > 150 && b < 100 ? 'geel' : r > 150 && g < 100 ? 'rood' : g > 150 && r < 100 ? 'groen' : b > 150 && r < 100 ? 'blauw' : 'anders';
  const rij = Math.floor(H * 360 / 720);
  let a = -1, e = -1;
  for (let i = 0; i < W; i++) { const j = (rij * W + i) * 4; if (d[j] > 200 && d[j + 1] > 200 && d[j + 2] > 200) { if (a < 0) a = i; e = i; } }
  return { kwarten: [px(0.05, 0.1), px(0.95, 0.1), px(0.05, 0.9), px(0.95, 0.9)].map(naam).join(' '),
    blok: a >= 0 ? ((a + e) / 2) * 1280 / W : null };
}`;

/**
 * In het losse venster, elk beeld vanaf nu: wat TOONT het, per track (rij)?
 * Gemeten op het eigen canvas, METEEN na elk beeld dat erop komt: een
 * WebGL-canvas zonder preserveDrawingBuffer is leeg zodra hij getoond is, en
 * tijdens de inloop tekent het hoofdvenster het beeld erop (toonBeeld, vanuit
 * zijn eigen lus), niet dit venster. Daarom haken we in op teken() en
 * toonBeeld() van deze mixer in plaats van op een eigen rAF. Per rij: waar het
 * blok staat -> welke videotijd -> min wat je van DIE track hoort. null = geen
 * blok (zwart, nog niet geladen). Werkt ook op code zonder inloop (alleen teken).
 * Met `los` = false hetzelfde in het hoofdvenster (het paneel): de maatstaf.
 * bron: 'hoofd' = het beeld van het hoofdvenster, 'eigen' = zelf gemengd.
 */
const MEET_INLOOP = `async (sec, rijY, los = true) => {
  const e = los ? opener.engine : window.engine, W = 1280, H = 720, ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const mx = los ? window.beamerMixer : window.videoMixer;
  const tijdVanBlok = ${tijdVanBlok.toString()};
  const rij = new Uint8Array(W * 4);
  // Het breedste witte stuk (het blok is 100 px). Niet "eerste tot laatste wit":
  // in "licht" wordt de naad tussen blauw en geel (x = 640) ook één pixel wit.
  const blok = (d) => {
    let a = -1, beste = null;
    for (let x = 0; x <= W; x++) {
      const i = x * 4, wit = x < W && d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200;
      if (wit && a < 0) a = x;
      if (!wit && a >= 0) { if (x - a > 80 && (!beste || x - a > beste[1] - beste[0])) beste = [a, x]; a = -1; }
    }
    return beste ? (beste[0] + beste[1] - 1) / 2 : null;
  };
  const monsters = [];
  const t0 = performance.now();
  let overname = null;
  const meet = (bron) => {
    const t = performance.now() - t0;
    if (t > sec * 1000) return;
    if (bron === 'eigen' && overname === null) overname = t;
    const gl = mx.gl, lat = (e.ctx.outputLatency || 0) + (e.ctx.baseLatency || 0);
    const uit = rijY.map((y, k) => {
      const d = e.deck(ids[k]);
      const gehoord = d.position - lat * d.rate;
      gl.readPixels(0, H - 1 - y, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, rij);
      const m = blok(rij);
      return m === null ? null : Math.round((tijdVanBlok(m, gehoord) - gehoord) * 10000) / 10000;
    });
    monsters.push({ t: Math.round(t), bron, uit });
    // Elke halve seconde: hoe staan de eigen video's van dit venster ervoor (verschil in ms, s = springt, p = gepauzeerd, r = readyState).
    if (Math.floor(t / 500) !== Math.floor((monsters.at(-2)?.t ?? -1) / 500)) {
      monsters.at(-1).eigen = ids.map((id) => {
        const l = mx.lagen.get(id); if (!l) return '-';
        const d = e.deck(id), v = l.video;
        return Math.round((v.currentTime - (d.position - lat * d.rate)) * 1000) + (v.seeking ? 's' : '') + (v.paused ? 'p' : '') + 'r' + v.readyState + '/' + l.seekDuur.toFixed(2);
      }).join(' ');
    }
  };
  // VARVE_BEAMER_SPOOR: elke sprong (ZET = currentTime gezet) en de media-events
  // van de eigen video's, met tijd, readyState en seeking. Zo is gevonden dat
  // 'seeked' onder belasting pas na de volgende sprong kwam (video-mixer.js, _volg).
  const spoor = [];
  if (los && window.__SPOOR) for (const [id, l] of mx.lagen) {
    const v = l.video, zet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    for (const ev of ['seeking', 'seeked', 'waiting', 'playing', 'canplay', 'stalled']) v.addEventListener(ev, () => spoor.push([Math.round(performance.now() - t0), id, ev, +v.currentTime.toFixed(3), v.readyState, v.seeking]));
    Object.defineProperty(v, 'currentTime', { get() { return zet.get.call(this); }, set(x) { spoor.push([Math.round(performance.now() - t0), id, 'ZET', +x.toFixed(3), this.readyState, this.seeking]); zet.set.call(this, x); } });
  }
  const teken = mx.teken, toon = mx.toonBeeld;
  mx.teken = function (...a) { const r = teken.apply(this, a); meet(los ? 'eigen' : 'paneel'); return r; };
  if (toon) mx.toonBeeld = function (...a) { const r = toon.apply(this, a); meet('hoofd'); return r; };
  await new Promise((klaar) => setTimeout(klaar, sec * 1000 + 50));
  delete mx.teken; delete mx.toonBeeld;
  return { monsters, overname, spoor };
}`;

try {
  let versie = null;
  for (let i = 0; i < 60 && !versie; i++) { await wacht(200); versie = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json()).catch(() => null); }
  console.log(`${versie.Browser} · app uit ${WORTEL}`);
  ws = new WebSocket(versie.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      // Elke nieuwe pagina wacht tot MIDI eruit is; pas dan draait hij.
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
    const label = m.sessionId ? m.sessionId.slice(0, 4) : '';
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`[${label}] uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`[${label}] console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  const { targetInfos } = await cdp('Target.getTargets');
  const hoofdId = targetInfos.find((t) => t.type === 'page').targetId;
  const { sessionId: hoofd } = await cdp('Target.attachToTarget', { targetId: hoofdId, flatten: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI }, hoofd);
  await cdp('Page.enable', {}, hoofd);
  await cdp('Runtime.enable', {}, hoofd);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, hoofd);
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  // ---- het testnummer via de upload-route in de tijdelijke library --------
  for (let i = 0; i < 60; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  const B = `http://localhost:${POORT}`;
  /** Een bestand door de echte upload en ingest; geeft de track als hij klaar is. */
  const binnen = async (pad, naam) => {
    const opdracht = await (await fetch(`${B}/api/upload?naam=${naam}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: readFileSync(pad) })).json();
    for (let i = 0; i < 1200; i++) {
      const o = (await (await fetch(`${B}/api/ingest`)).json()).opdrachten.find((x) => x.id === opdracht.id);
      if (o?.status === 'klaar') return o.track;
      if (o?.status === 'mislukt') throw new Error(`ingest ${naam}: ${o.fout}`);
      await wacht(300);
    }
    return null;
  };
  const track = await binnen(VIDEO, 'kwarten.mp4');
  ok('testnummer binnen, met video', !!track?.video, track?.id);
  // De acht rij-video's gaan alvast door de ingest terwijl de rest draait.
  const rijTracks = rijenGemaakt.then(() => Promise.all(Array.from({ length: 8 }, (_, k) => binnen(rijVideo(k), `rij-${k + 1}.mp4`))));
  rijTracks.catch(() => {});

  if (!ALLEEN_INLOOP) {
    // ---- hoofdvenster: laden, spelen, videopaneel -----------------------------
    await cdp('Page.navigate', { url: `${B}/?vormen=1` }, hoofd);
    await wachtTot(hoofd, 'window.engine && window.videoMixer && window.library');
    await wacht(800);
    const nieuw = await ev(hoofd, '!!window.varveBeamer');
    console.log(nieuw ? 'nieuwe code: het losse venster mengt zelf' : 'OUDE code (geen varveBeamer): alleen de beeldcontrole');
    ok('geen MIDI in het hoofdvenster', await ev(hoofd, '!navigator.requestMIDIAccess'));
    const speelt = await ev(hoofd, `(async () => {
      window.__act = await import('/src/control/actions.js');
      await window.engine.resume();
      await window.library.ververs();
      await window.library.laad(${JSON.stringify(track.id)}, 'A');
      __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
      __act.invoke('track.1.play', true); __act.invoke('track.1.play', false);
      return window.engine.deck('A').playing;
    })()`);
    ok('track 1 speelt', speelt);
    await ev(hoofd, "document.getElementById('video-btn').click()");
    await wacht(2000);
    const b0 = await ev(hoofd, 'window.videoMixer.beelden ?? 0');
    await wacht(1000);
    if (nieuw) {
      const b1 = await ev(hoofd, 'window.videoMixer.beelden');
      ok('alleen het paneel open: het hoofdvenster mengt', b1 - b0 > 20,
        `${b1 - b0} beelden/s · ${await ev(hoofd, "document.visibilityState + ' paneel ' + (document.getElementById('video-panel').classList.contains('hidden') ? 'dicht' : 'open') + ' los ' + window.varveBeamer.losOpen()")}`);
    }

    // ---- los venster ---------------------------------------------------------
    await ev(hoofd, "document.querySelector('.vid-los').click()", true);
    let los = null;
    for (let i = 0; i < 100 && !los; i++) { los = nieuweDoelen.find((d) => d.type === 'page' && d.openerId === hoofdId); if (!los) await wacht(100); }
    ok('los venster open', !!los);
    const pop = los.sessionId;
    await cdp('Page.enable', {}, pop);
    await wachtTot(pop, "location.pathname.endsWith('video.html') && document.readyState === 'complete'");
    ok('geen MIDI in het losse venster', await ev(pop, '!navigator.requestMIDIAccess'));

    let meetSync, toonSync, sync;
    const ms = (x) => (x * 1000).toFixed(1);
    if (nieuw) {
      ok('het losse venster meldt zich aan en mengt zelf', await wachtTot(pop, 'window.beamerMixer && opener.varveBeamer.mengtLos(window) && opener.varveBeamer.losOpen()'));
      await wachtTot(pop, "window.beamerMixer.lagen.get('A')?.klaar", 10000);
      await wacht(2500);
      const [h0, l0] = [await ev(hoofd, 'window.videoMixer.beelden'), await ev(pop, 'window.beamerMixer.beelden')];
      await wacht(1000);
      const [h1, l1] = [await ev(hoofd, 'window.videoMixer.beelden'), await ev(pop, 'window.beamerMixer.beelden')];
      ok('het losse venster tekent', l1 - l0 > 20, `${l1 - l0} beelden/s`);
      ok('het hoofdvenster mengt dan NIET (één keer mengen)', h1 === h0, `${h1 - h0} beelden/s`);
      ok('eigen <video> in het losse venster, dezelfde bron als het hoofdvenster',
        await ev(pop, "(() => { const l = window.beamerMixer.lagen.get('A'); return !!l && l.video.ownerDocument === document && l.url === opener.videoMixer.bron('A') && l.klaar; })()"));
      ok('het paneel toont het beeld van het losse venster', await wachtTot(hoofd,
        "!document.querySelector('.vid-canvas').offsetParent && document.querySelector('.vid-voorbeeld').offsetParent && document.querySelector('.vid-voorbeeld').readyState >= 2", 5000));
      ok('de statusregel zegt dat de beamer mengt', await ev(hoofd, "document.querySelector('.vid-status').textContent.startsWith('beamer')"),
        await ev(hoofd, "document.querySelector('.vid-status').textContent"));
      const rechtop = await ev(pop, `(() => {
        const mx = window.beamerMixer, gl = mx.gl;
        mx.teken();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4);
        const naam = ([r, g, b]) => r > 150 && g > 150 && b < 100 ? 'geel' : r > 150 && g < 100 ? 'rood' : g > 150 && r < 100 ? 'groen' : b > 150 && r < 100 ? 'blauw' : 'anders';
        const lees = (fx, fy) => { gl.readPixels(Math.floor(fx * (W - 1)), Math.floor((1 - fy) * (H - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return naam(px); };
        return [lees(0.05, 0.1), lees(0.95, 0.1), lees(0.05, 0.9), lees(0.95, 0.9)].join(' ');
      })()`);
      ok('het beeld in het losse venster staat rechtop (vier kwarten)', rechtop === 'rood groen blauw geel', rechtop);

      // ---- synchronisatie: blok op het canvas tegen wat je hoort ------------
      // Direct na teken() de middelste rij van het canvas lezen (deze rAF staat
      // achter die van de beamer) en uit de plek van het blok de videotijd halen.
      // Daarnaast een eigen requestVideoFrameCallback-waarnemer: meldt rVFC het
      // beeld dat er op het canvas staat? (ronde 3: rVFC gebruiken als dat
      // meetbaar beter is; zie docs/BEAMER.md.)
      meetSync = async (sec) => ev(pop, `(async () => {
        const mx = window.beamerMixer, gl = mx.gl, W = 1280, rij = new Uint8Array(W * 4);
        const e = opener.varveBeamer.engine, d = e.deck('A');
        const tijdVanBlok = ${tijdVanBlok.toString()};
        const uit = [], rv = [], ct = [];
        const eind = performance.now() + ${sec} * 1000;
        const v = mx.lagen.get('A').video;
        let laatst = null;
        const opB = (nu, m) => { laatst = m.mediaTime; if (performance.now() < eind) v.requestVideoFrameCallback(opB); };
        v.requestVideoFrameCallback(opB);
        await new Promise((klaar) => {
          const f = () => {
            gl.readPixels(0, 360, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, rij);
            let a = -1, b = -1;
            for (let x = 0; x < W; x++) { const i = x * 4; if (rij[i] > 200 && rij[i + 1] > 200 && rij[i + 2] > 200) { if (a < 0) a = x; b = x; } }
            if (a >= 0 && b - a > 80 && d.playing) {
              const gehoord = d.position - ((e.ctx.outputLatency || 0) + (e.ctx.baseLatency || 0)) * d.rate;
              const tb = tijdVanBlok((a + b) / 2, gehoord);
              uit.push(tb - gehoord);
              if (laatst !== null) rv.push(laatst - tb);
              ct.push(v.currentTime - tb);
            }
            performance.now() < eind ? requestAnimationFrame(f) : klaar();
          };
          requestAnimationFrame(f);
        });
        const gm = (xs) => xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
        return { n: uit.length, gem: gm(uit), abs: gm(uit.map(Math.abs)), rvfcMinCanvas: gm(rv), currentTimeMinCanvas: gm(ct) };
      })()`);
      toonSync = (naam, m) => console.log(`  ${naam}: beeld op het canvas min wat je hoort ${ms(m.gem)} ms gem, |${ms(m.abs)}| ms (n=${m.n}); `
        + `rVFC-mediaTime min canvas ${ms(m.rvfcMinCanvas)} ms, currentTime min canvas ${ms(m.currentTimeMinCanvas)} ms`);
      await wacht(2000);
      sync = await meetSync(4);
      toonSync('sync', sync);
      ok('het beeld op het canvas valt op wat je hoort (gemiddeld binnen een half beeld, 17 ms)', sync.n > 30 && Math.abs(sync.gem) < 0.017, `${ms(sync.gem)} ms`);
      // Bij 30 fps is 8,3 ms het minimum (een beeld staat 33 ms); onder belasting gemeten tot 11,5.
      ok('en per beeld gemiddeld minder dan een half beeld ernaast (|fout| < 17 ms; het minimum is 8,3)', sync.abs < 0.017, `${ms(sync.abs)} ms`);

      // Een vormlaag aan, voor de controle dat de Worker doorlevert als het hoofdtabblad verborgen is.
      await ev(hoofd, 'window.vormen.lagen[0].aan = true; window.vormen.lagen[0].dekking = 0.35; true');
      await wacht(1500);
      ok('de vormlaag komt in het losse venster: dezelfde lagen, lagenstap gebouwd',
        await ev(pop, 'window.beamerMixer.beeldlagen === opener.videoMixer.beeldlagen && !!window.beamerMixer.gelaagd'));
      // De maat als bron (maatbronnen, vorm-paneel.js): de haak zit op de laag
      // zelf, dus ook het losse venster voedt hem. Grid op track 1, bron 'tel',
      // reageren open; gemeten als het hoofdtabblad verborgen is (hieronder).
      await ev(hoofd, `(() => {
        const d = window.engine.deck('A');
        if (!d.grid) d.setGrid({ bpm: 120, firstBeat: 0 });
        const bron = document.querySelector('.vorm-reageer-bron');
        bron.value = 'tel'; bron.dispatchEvent(new Event('change'));
        __act.invoke('video.layer.react', 1);
        return true;
      })()`);

      // Een video-opname starten terwijl het losse venster mengt: die neemt ZIJN canvas.
      await ev(hoofd, "(() => { const s = document.getElementById('opname-soort'); s.value = 'video'; s.dispatchEvent(new Event('change')); })()");
      await ev(hoofd, "document.getElementById('opname-btn').click()", true);
      ok('video-opname loopt, uit het losse venster', await wachtTot(hoofd, 'window.opnemer.metVideo && window.varveBeamer.opnameUitLos()', 5000));
    }

    await wacht(4500);                                          // de hint in het losse venster is dan weg
    // ---- hoofdtabblad verbergen ---------------------------------------------
    if (nieuw) await ev(hoofd, 'window.__raf = 0; (function f() { window.__raf++; requestAnimationFrame(f); })(); true');
    const { targetId: anderTab } = await cdp('Target.createTarget', { url: 'about:blank', newWindow: false });
    await cdp('Target.activateTarget', { targetId: anderTab });
    await wacht(1200);
    ok('het hoofdtabblad is verborgen', await ev(hoofd, "document.visibilityState === 'hidden'"));
    const r0 = nieuw ? await ev(hoofd, 'window.__raf') : 0;
    const t0 = await ev(hoofd, 'window.engine.ctx.currentTime');
    const v0 = nieuw ? await ev(hoofd, 'window.vormen.lagen[0].versie') : 0;
    const l0 = nieuw ? await ev(pop, 'window.beamerMixer.beelden') : 0;
    const f1 = await foto(pop, 'beamer-verborgen-1.png');
    const a1 = await ev(pop, `(${LEES_FOTO})(${JSON.stringify(f1)})`);
    await wacht(2000);
    const f2 = await foto(pop, 'beamer-verborgen-2.png');
    const a2 = await ev(pop, `(${LEES_FOTO})(${JSON.stringify(f2)})`);
    const t1 = await ev(hoofd, 'window.engine.ctx.currentTime');
    ok('de audio loopt door in het verborgen tabblad', t1 - t0 > 1.5, `${(t1 - t0).toFixed(2)} s`);
    if (nieuw) ok('de animatielus van het hoofdtabblad staat stil (zoals bij Clay)', (await ev(hoofd, 'window.__raf')) - r0 <= 1);
    ok('beamerbeeld rechtop (schermafdruk, vier kwarten)', a1.kwarten === 'rood groen blauw geel', `${a1.kwarten} · ${a2.kwarten}`);
    // 200 px/s: in ~2,3 s schuift het blok ~460 px (modulo 1180). Stilstaand = 0.
    const schuif = a1.blok !== null && a2.blok !== null ? ((a2.blok - a1.blok) % 1180 + 1180) % 1180 : 0;
    ok('BEAMERBEELD LOOPT DOOR terwijl het hoofdtabblad verborgen is', f1 !== f2 && schuif > 200,
      `blok ${a1.blok?.toFixed(0)} -> ${a2.blok?.toFixed(0)} px, ${schuif.toFixed(0)} px verschoven`);
    if (nieuw) {
      const l1 = await ev(pop, 'window.beamerMixer.beelden');
      ok('het losse venster blijft mengen', l1 - l0 > 60, `${l1 - l0} beelden in ~2,3 s`);
      ok('de vormlaag (Worker van het verborgen tabblad) levert door', (await ev(hoofd, 'window.vormen.lagen[0].versie')) - v0 > 10,
        `${(await ev(hoofd, 'window.vormen.lagen[0].versie')) - v0} beelden`);
      // Alleen het losse venster roept laag.frame nog aan (de rAF van het
      // hoofdtabblad staat stil): beweegt de tel-offset, dan nam het de maatbron mee.
      const tellen = [];
      for (let i = 0; i < 24; i++) { tellen.push(await ev(hoofd, 'window.vormen.lagen[0].mod[0]')); await wacht(60); }
      const verschillend = new Set(tellen.map((x) => x.toFixed(3))).size;
      ok('de maatbron (tel) beweegt de vormknop mee terwijl alleen het losse venster mengt',
        Math.max(...tellen) > 0.3 && verschillend > 4, `max ${Math.max(...tellen).toFixed(2)}, ${verschillend} verschillende standen`);
      const verborgen = await meetSync(2);
      toonSync('sync, hoofdtabblad verborgen', verborgen);
      ok('ook met het hoofdtabblad verborgen volgt het beeld de audio (binnen 17 ms)', verborgen.n > 30 && Math.abs(verborgen.gem) < 0.017, `${ms(verborgen.gem)} ms, |${ms(verborgen.abs)}|`);
      writeFileSync(join(UIT, 'beamer-sync.json'), JSON.stringify({ zichtbaar: sync, verborgen }, null, 2));
    }
    await wacht(2000);

    // ---- hoofdtabblad terug ------------------------------------------------
    await cdp('Target.activateTarget', { targetId: hoofdId });
    await wacht(1000);
    ok('het hoofdtabblad is weer zichtbaar', await ev(hoofd, "document.visibilityState === 'visible'"));
    if (nieuw) {
      // Opname stoppen en de video nalopen: bevroor het beeld toen het hoofdtabblad weg was?
      const r = await ev(hoofd, 'window.opnemer.stop()');
      ok('opname bewaard, met video', r.ok && !!r.video, r.fout || r.video);
      const mp4 = join(tmp, 'opnames', r.video || 'x');
      if (existsSync(mp4)) {
        const rij = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=4,crop=1280:2:0:358', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
        if (rij.status !== 0) console.log('  ffmpeg:', String(rij.stderr).slice(0, 400));
        writeFileSync(join(UIT, 'beamer-opname.mp4'), readFileSync(mp4));
        // Twee rijen per beeld (yuv420 kan geen oneven hoogte); de tweede is rij 359, door het blok.
        const buf = rij.stdout, W = 1280, n = Math.floor(buf.length / (W * 3 * 2));
        const plekken = [];
        for (let k = 0; k < n; k++) {
          let a = -1, b = -1;
          for (let x = 0; x < W; x++) { const i = ((k * 2 + 1) * W + x) * 3; if (buf[i] > 200 && buf[i + 1] > 200 && buf[i + 2] > 200) { if (a < 0) a = x; b = x; } }
          plekken.push(a >= 0 ? (a + b) / 2 : null);
        }
        // Per kwart seconde hoort het blok ~50 px op te schuiven; een bevroren beeld schuift 0.
        let stil = 0, langsteStil = 0;
        for (let k = 1; k < plekken.length; k++) {
          const d = plekken[k] !== null && plekken[k - 1] !== null ? ((plekken[k] - plekken[k - 1]) % 1180 + 1180) % 1180 : 0;
          stil = d < 10 ? stil + 1 : 0;
          langsteStil = Math.max(langsteStil, stil);
        }
        ok('in de opname loopt het beeld door (ook toen het hoofdtabblad verborgen was)', n > 20 && langsteStil <= 2,
          `${n} beelden op 4 fps, langst stil ${langsteStil / 4} s, ${(statSync(mp4).size / 1e6).toFixed(1)} MB`);
        spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '6', '-i', mp4, '-frames:v', '1', join(UIT, 'beamer-opname.png')]);
      }
      await wacht(500);
      const [h0, l0b] = [await ev(hoofd, 'window.videoMixer.beelden'), await ev(pop, 'window.beamerMixer.beelden')];
      await wacht(1000);
      ok('na de opname: weer alleen het losse venster mengt', (await ev(hoofd, 'window.videoMixer.beelden')) === h0 && (await ev(pop, 'window.beamerMixer.beelden')) - l0b > 20);
      await foto(hoofd, 'beamer-hoofd.png');
      await ev(hoofd, 'window.vormen.lagen[0].aan = false; true');

      // ---- het losse venster zelf verborgen (geminimaliseerd) ---------------
      // Dan staat ZIJN lus stil; het paneel in het hoofdvenster mengt weer zelf.
      const { windowId: losRaam } = await cdp('Browser.getWindowForTarget', { targetId: los.targetId });
      await cdp('Browser.setWindowBounds', { windowId: losRaam, bounds: { windowState: 'minimized' } });
      if (await wachtTot(pop, "document.visibilityState === 'hidden'", 3000)) {
        await wacht(800);
        const hm0 = await ev(hoofd, 'window.videoMixer.beelden');
        await wacht(1000);
        ok('los venster geminimaliseerd: het hoofdvenster mengt het paneel weer zelf', (await ev(hoofd, 'window.videoMixer.beelden')) - hm0 > 20
          && await ev(hoofd, "!!document.querySelector('.vid-canvas').offsetParent"));
        await cdp('Browser.setWindowBounds', { windowId: losRaam, bounds: { windowState: 'normal' } });
        await wachtTot(pop, "document.visibilityState === 'visible'", 3000);
        // Zijn video's stonden stil: eerst inlopen (het paneel mengt nog en zet
        // zijn beeld op de beamer), dan pas zelf.
        const t0 = Date.now();
        const zelf = await wachtTot(pop, 'opener.varveBeamer.mengtLos(window)', 25000);
        const inloop = ((Date.now() - t0) / 1000).toFixed(1);
        await wacht(300);
        const hm1 = await ev(hoofd, 'window.videoMixer.beelden');
        await wacht(1000);
        ok('weer zichtbaar: het losse venster loopt in en neemt het dan over', zelf && (await ev(hoofd, 'window.videoMixer.beelden')) === hm1, `na ${inloop} s`);
      } else {
        console.log('  (minimaliseren maakt het losse venster hier niet verborgen: overgeslagen)');
      }

      // ---- herladen --------------------------------------------------------
      console.log('herladen');
      await cdp('Page.reload', {}, pop);
      await wacht(500);
      ok('los venster herladen: het meldt zich weer aan', await wachtTot(pop, 'window.beamerMixer && opener.varveBeamer.mengtLos(window)'));
      ok('en krijgt de video terug', await wachtTot(pop, "window.beamerMixer.lagen.get('A')?.klaar", 8000));
      const oudeEngine = await ev(pop, 'window.__oud = opener.varveBeamer.engine; true');
      void oudeEngine;
      await cdp('Page.reload', {}, hoofd);
      await wachtTot(hoofd, 'window.engine && window.varveBeamer');
      ok('hoofdvenster herladen: het losse venster koppelt aan de nieuwe app',
        await wachtTot(pop, 'opener.varveBeamer.mengtLos(window) && window.beamerMixer.engine === opener.engine && window.beamerMixer.engine !== window.__oud'));
      ok('en de oude video is weg (de nieuwe app heeft nog niets geladen)', await wachtTot(pop, 'window.beamerMixer.lagen.size === 0', 3000));
      await ev(pop, 'window.close()');
      await wacht(800);
      ok('los venster dicht: het hoofdvenster weet het', await ev(hoofd, '!window.varveBeamer.losOpen()'));

      // ---- video ontbreekt: melding in de strook ----------------------------
      console.log('video ontbreekt');
      rmSync(join(tmp, 'media', track.id, 'video.mp4'), { force: true });
      await ev(hoofd, `(async () => {
        window.__act = await import('/src/control/actions.js');
        await window.engine.resume();
        document.getElementById('video-btn').click();
        await window.library.ververs();
        await window.library.laad(${JSON.stringify(track.id)}, 'A');
        __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
        return true;
      })()`);
      ok('video weg van schijf: een foutmelding in de strook', await wachtTot(hoofd,
        "[...document.querySelectorAll('#meldingen .melding.fout')].some((m) => /video van track 1/.test(m.textContent) && /ontbreekt/.test(m.textContent))", 8000),
      await ev(hoofd, "[...document.querySelectorAll('#meldingen .melding')].map((m) => m.textContent).join(' | ')"));
      await foto(hoofd, 'beamer-melding.png');
    }
  }

  // ---- inloop met acht tracks -----------------------------------------------
  // Acht tracks spelen, het paneel mengt ze (in de pas). Dan "los venster":
  // wat TOONT dat venster vanaf het openen, per track? Met eigen <video>'s die
  // alle acht tegelijk laden en springen liep het de eerste seconden 1–5,7 s
  // uit de pas (controleur spoor 2, bevinding 4).
  console.log('inloop met acht tracks');
  const rijen = await rijTracks;
  ok('acht rij-video\'s binnen', rijen.every((t) => t?.video));
  await cdp('Page.navigate', { url: `${B}/` }, hoofd);
  await wachtTot(hoofd, 'window.engine && window.videoMixer && window.library');
  await wacht(800);
  if (await ev(hoofd, '!!window.varveBeamer')) {
    const spelen = await ev(hoofd, `(async () => {
      window.__act = await import('/src/control/actions.js');
      await window.engine.resume();
      await window.library.ververs();
      const ids = ${JSON.stringify(rijen.map((t) => t.id))}, decks = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      for (let k = 0; k < 8; k++) {
        await window.library.laad(ids[k], decks[k]);
        __act.invoke('track.' + (k + 1) + '.fader', 1);
        __act.invoke('track.' + (k + 1) + '.xfade.thru', true);
        window.engine.deck(decks[k]).seek(4 + 2.5 * k);      // elk ergens anders, ook voorbij het eerste sleutelbeeld
      }
      // "licht" (screen): elk blok blijft wit op zijn eigen rij.
      for (let i = 0; i < 4 && window.videoMixer.modus !== 'licht'; i++) __act.invoke('video.mode', true);
      for (let k = 1; k <= 8; k++) { __act.invoke('track.' + k + '.play', true); __act.invoke('track.' + k + '.play', false); }
      document.getElementById('video-btn').click();
      return decks.filter((d) => window.engine.deck(d).playing).length + ' spelen, ' + window.videoMixer.modus;
    })()`);
    ok('acht tracks spelen, paneel open, mengvorm licht', /^8 spelen, licht$/.test(spelen), spelen);
    const PAS = (mixer, engine) => `(() => { const e = ${engine}, vt = (e.ctx.outputLatency || 0) + (e.ctx.baseLatency || 0);
      const st = ${mixer}.stand();
      return st.map((l) => { const d = e.deck(l.id); return l.video && l.klaar ? Math.round((l.tijd - (d.position - vt * d.rate)) * 1000) : null; }); })()`;
    const t8 = Date.now();
    const hoofdPas = await wachtTot(hoofd, `${PAS('window.videoMixer', 'window.engine')}.every((x) => x !== null && Math.abs(x) < 40)`, 60000);
    ok('zonder los venster: het paneel mengt de acht in de pas', hoofdPas,
      `na ${((Date.now() - t8) / 1000).toFixed(1)} s: ${(await ev(hoofd, PAS('window.videoMixer', 'window.engine'))).join(' ')} ms`);
    await wacht(1000);
    // De maatstaf: wat het paneel zelf toont, per track. Haalt deze machine acht
    // video's decoderen niet, dan staat het hier al naast het geluid.
    const ref = await ev(hoofd, `(${MEET_INLOOP})(3, ${JSON.stringify(RIJ_Y)}, false)`);
    writeFileSync(join(UIT, 'beamer-inloop-paneel.json'), JSON.stringify(ref, null, 1));
    const perTrack = (monsters) => Array.from({ length: 8 }, (_, k) => {
      const xs = monsters.map((m) => m.uit[k]).filter((x) => x !== null);
      return xs.length ? Math.round(Math.max(...xs.map(Math.abs)) * 1000) : null;
    });
    const kwaliteit = (mixer) => `[...${mixer}.lagen.values()].map((l) => { const q = l.video.getVideoPlaybackQuality(); return q.droppedVideoFrames + '/' + q.totalVideoFrames; }).join(' ')`;
    console.log(`  paneel (maatstaf), grootste |fout| per track: ${perTrack(ref.monsters).join(' ')} ms; weggevallen/totaal beelden: ${await ev(hoofd, kwaliteit('window.videoMixer'))}`);

    const bekend = new Set(nieuweDoelen.map((d) => d.targetId));
    const tKlik = Date.now();
    await ev(hoofd, "document.querySelector('.vid-los').click()", true);
    let los8 = null;
    for (let i = 0; i < 400 && !los8; i++) { los8 = nieuweDoelen.find((d) => d.type === 'page' && d.openerId === hoofdId && !bekend.has(d.targetId)); if (!los8) await wacht(10); }
    const pop8 = los8.sessionId;
    for (let i = 0; i < 400; i++) { if (await ev(pop8, '!!window.beamerMixer').catch(() => false)) break; await wacht(10); }
    const vanaf = (Date.now() - tKlik) / 1000;
    // Tot voorbij de time-out van de inloop: dan valt de overname hoe dan ook
    // binnen de meting, en telt ook het beeld erna mee. Oude code: 15 s.
    const INLOOP_MAX = (await import('../../src/video/beamer.js')).INLOOP_MAX;
    const SEC = INLOOP_MAX ? INLOOP_MAX + 5 : 15;
    if (process.env.VARVE_BEAMER_SPOOR) await ev(pop8, 'window.__SPOOR = true');
    const r8 = await ev(pop8, `(${MEET_INLOOP})(${SEC}, ${JSON.stringify(RIJ_Y)})`);
    writeFileSync(join(UIT, 'beamer-inloop.json'), JSON.stringify({ vanafKlik: vanaf, ...r8 }, null, 1));
    // Per halve seconde: wie het beeld mengde (hoofd = het losse venster toont
    // het canvas van het hoofdvenster, eigen = het mengt zelf), de grootste
    // |fout| en hoeveel beelden een blok misten.
    const vakken = [];
    for (const m of r8.monsters) {
      const v = (vakken[Math.floor(m.t / 500)] ??= { bron: new Set(), max: 0, leeg: 0, n: 0 });
      v.bron.add(m.bron); v.n++;
      if (m.uit.some((x) => x === null)) v.leeg++;
      for (const x of m.uit) if (x !== null) v.max = Math.max(v.max, Math.abs(x));
    }
    console.log(`  los venster: meten vanaf ${vanaf.toFixed(2)} s na de klik; ${r8.overname === null ? 'NIET overgenomen' : `het mengt zelf vanaf ${(r8.overname / 1000).toFixed(2)} s`}`);
    vakken.forEach((v, i) => { if (v) console.log(`    ${(i / 2).toFixed(1).padStart(4)} s  ${[...v.bron].join('+').padEnd(13)} max |fout| ${String(Math.round(v.max * 1000)).padStart(5)} ms  zonder blok ${v.leeg}/${v.n}`); });
    if (process.env.VARVE_BEAMER_EIGEN) for (const m of r8.monsters) if (m.eigen) console.log(`    ${(m.t / 1000).toFixed(1).padStart(5)} s eigen: ${m.eigen}`);
    if (r8.spoor?.length) console.log(`  sprongen per track (eigen video's): ${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => r8.spoor.filter((e) => e[1] === id && e[2] === 'ZET').length).join(' ')}`);
    console.log(`  per track grootste |fout| (ms): ${perTrack(r8.monsters).join(' ')}; laatste 3 s: ${perTrack(r8.monsters.filter((m) => m.t > (SEC - 3) * 1000)).join(' ')}`);
    console.log(`  weggevallen/totaal beelden, los venster: ${await ev(pop8, kwaliteit('window.beamerMixer'))}`);
    // Vanaf het eerste beeld dat de beamer toont (daarvoor is het venster nog
    // zwart): elke track in elk beeld, en nergens zo ver naast het geluid dat
    // volg.js zou springen (SPRING_VANAF, 150 ms). Het paneel hierboven is de
    // maatstaf: onder zware belasting haalt dat zelf ~60–110 ms.
    const GRENS = 0.15;
    const eerste = r8.monsters.findIndex((m) => m.uit.some((x) => x !== null));
    const na = eerste < 0 ? [] : r8.monsters.slice(eerste);
    const maxFout = Math.max(0, ...na.flatMap((m) => m.uit.filter((x) => x !== null).map(Math.abs)));
    const leeg = na.filter((m) => m.uit.some((x) => x === null)).length;
    const teVer = na.filter((m) => m.uit.some((x) => x !== null && Math.abs(x) >= GRENS)).length;
    ok(`acht tracks, los venster net open: vanaf het eerste beeld staan ze er alle acht (${eerste < 0 ? '-' : (vanaf + r8.monsters[eerste].t / 1000).toFixed(2)} s na de klik)`,
      eerste >= 0 && leeg === 0, `${leeg} van ${na.length} beelden missen een track`);
    ok(`en elk beeld, elke track binnen ${GRENS * 1000} ms van wat je hoort`, eerste >= 0 && teVer === 0,
      `grootste ${Math.round(maxFout * 1000)} ms; ${teVer} van ${na.length} beelden erbuiten`);
    ok(`het losse venster neemt het mengen zelf over (uiterlijk na de time-out van ${INLOOP_MAX} s)`,
      r8.overname !== null && r8.overname <= (INLOOP_MAX + 1) * 1000, r8.overname === null ? 'niet' : `na ${(r8.overname / 1000).toFixed(1)} s`);
    const [h0, l0] = [await ev(hoofd, 'window.videoMixer.beelden'), await ev(pop8, 'window.beamerMixer.beelden')];
    await wacht(1000);
    const [h1, l1] = [await ev(hoofd, 'window.videoMixer.beelden'), await ev(pop8, 'window.beamerMixer.beelden')];
    ok('daarna mengt alleen het losse venster (één keer mengen)', h1 === h0 && l1 - l0 > 20, `hoofd ${h1 - h0}, los ${l1 - l0} beelden/s`);
    ok('en zijn eigen video\'s lopen in de pas', (await ev(pop8, PAS('window.beamerMixer', 'opener.engine'))).every((x) => x !== null && Math.abs(x) < 60),
      `${(await ev(pop8, PAS('window.beamerMixer', 'opener.engine'))).join(' ')} ms`);
    await ev(pop8, 'window.close()');
    await wacht(500);
  } else {
    console.log('  (oude code: geen losse-venstermixer, inloop overgeslagen)');
  }

  // De 404 van de ontbrekende video zelf staat als console.error in de lijst: die hoort erbij.
  const echt = meldingen.filter((m) => !/404|Not Found/.test(m));
  ok('geen fouten in de console', echt.length === 0, echt.slice(0, 5).join(' | '));
} catch (err) {
  ok('script liep door', false, err.stack || err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(400);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Schermafdrukken in ${UIT}`);
process.exit(rood ? 1 : 0);
