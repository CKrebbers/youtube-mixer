// Het zaalbeeld headless (docs/BEAMER.md "Zaalbeeld", spoor beeld-een-machine
// stap 2): het losse venster mengt een deck-video; `video.clips` uit = het
// mengt ZWART (geen clips van anderen) en de video's staan stil, terwijl het
// geluid doorspeelt; `video.layer.on` = de vormen geven wél beeld (> 20 beelden/s,
// pixels niet zwart); `video.black` werkt ook dan; clips weer aan = de video
// terug. Plus wat VARVE laat zien: de knop video in de bovenbalk ("video · alleen
// eigen beeld"), het knopje clips en de statusregel in het paneel, de
// venstertitel van het losse venster. Niets van dat alles op het doek zelf.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in geen enkel venster
// (ook het losse niet: nieuwe vensters wachten tot dat weg is). Eigen server op
// een eigen poort met een tijdelijke database, media-, opname-, patronen-,
// plannen- en proefmap, een niet-bestaande kaart en de nep-yt-dlp: Clay's
// library wordt niet aangeraakt. Chrome for Testing headless op Metal (zoals
// beamer.mjs), met --mute-audio, ZONDER --disable-popup-blocking: het losse
// venster gaat open met een klik mét gebaar, zoals bij Clay.
//
// Gebruik:  node tools/headless/zaalbeeld.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8806), VARVE_KIJK_DEBUG (9406). VARVE_CHROME.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chrome, GEEN_MIDI, poortBezet, zoekChrome } from './beeld-lokaal.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8806, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9406;
const tmp = mkdtempSync(join(tmpdir(), 'varve-zaalbeeld-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra !== '' ? ` (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`); };

/** In het losse venster: één beeld mengen en meteen het hele canvas lezen (zonder preserveDrawingBuffer is het daarna leeg). */
const LEES = `(() => {
  const mx = window.beamerMixer, gl = mx.gl;
  mx.teken();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, d = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, d);
  const px = (fx, fy) => { const i = (Math.floor((1 - fy) * (H - 1)) * W + Math.floor(fx * (W - 1))) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const naam = ([r, g, b]) => r < 24 && g < 24 && b < 24 ? 'zwart' : r > 150 && g > 150 && b < 100 ? 'geel' : r > 150 && g < 100 ? 'rood'
    : g > 150 && r < 100 ? 'groen' : b > 150 && r < 100 ? 'blauw' : 'anders';
  let licht = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { n++; if (d[i] + d[i + 1] + d[i + 2] > 60) licht++; }
  return { kwarten: [px(0.05, 0.1), px(0.95, 0.1), px(0.05, 0.9), px(0.95, 0.9)].map(naam).join(' '), licht: licht / n };
})()`;
const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;

// ---- testvideo: vier gekleurde kwarten (asymmetrisch, zoals beamer.mjs) -------
const VIDEO = join(tmp, 'kwarten.mp4');
{
  const duur = 20;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=red:s=640x360:d=${duur}:r=30`, '-f', 'lavfi', '-i', `color=c=lime:s=640x360:d=${duur}:r=30`,
    '-f', 'lavfi', '-i', `color=c=blue:s=640x360:d=${duur}:r=30`, '-f', 'lavfi', '-i', `color=c=yellow:s=640x360:d=${duur}:r=30`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${duur}:sample_rate=48000`,
    '-filter_complex', '[0][1]hstack[top];[2][3]hstack[bot];[top][bot]vstack[v]',
    '-map', '[v]', '-map', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-shortest', VIDEO]);
  if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
}

const processen = [];
const start = (cmd, args, opties = {}) => { const p = spawn(cmd, args, { stdio: 'ignore', detached: true, ...opties }); p.on('error', () => {}); processen.push(p); return p; };
let chrome = null;
let code = 0;
try {
  if (await poortBezet(POORT) || await poortBezet(DEBUG)) throw new Error(`poort ${POORT} of ${DEBUG} is bezet (zet VARVE_KIJK_POORT/VARVE_KIJK_DEBUG)`);
  const { maakNepYtdlp } = await import(pathToFileURL(join(WORTEL, 'test/nep-ytdlp.mjs')).href);
  mkdirSync(join(tmp, 'nep'), { recursive: true });
  start(process.execPath, [join(WORTEL, 'server/index.js')], {
    env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
      VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
      VARVE_PROEF: join(tmp, 'proef'), VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'),
      VARVE_YTDLP: maakNepYtdlp(join(tmp, 'nep')), VARVE_HERANALYSE: 'uit' },
  });
  start(zoekChrome(process.env.VARVE_CHROME || null), ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
    '--use-angle=metal', '--enable-gpu', '--mute-audio', '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', 'about:blank']);
  chrome = new Chrome('zaalbeeld', DEBUG);
  await chrome.verbind();
  console.log(`${chrome.versie} · app uit ${WORTEL}`);
  const hoofd = await chrome.pagina();
  await chrome.cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI }, hoofd);
  await chrome.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, hoofd);
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- het testnummer door de echte upload en ingest ----------------------------
  const B = `http://localhost:${POORT}`;
  const opdracht = await (await fetch(`${B}/api/upload?naam=kwarten.mp4`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: readFileSync(VIDEO) })).json();
  let track = null;
  for (let i = 0; i < 600 && !track; i++) {
    const o = (await (await fetch(`${B}/api/ingest`)).json()).opdrachten.find((x) => x.id === opdracht.id);
    if (o?.status === 'klaar') track = o.track;
    else if (o?.status === 'mislukt') throw new Error(`ingest: ${o.fout}`);
    else await wacht(300);
  }
  ok('testnummer binnen, met video', !!track?.video, track?.id ?? 'niets');

  // ---- VARVE: laden, spelen, stand van de knoppen --------------------------------
  await chrome.cdp('Page.navigate', { url: `${B}/?vormen=1` }, hoofd);
  ok('VARVE start met vormen, zonder MIDI', !!(await chrome.tot(hoofd, '!!(window.engine && window.videoMixer && window.library && window.vormen) && !navigator.requestMIDIAccess', 30000)));
  await wacht(800);
  const speelt = await chrome.ev(hoofd, `(async () => {
    window.__act = await import('/src/control/actions.js');
    await window.engine.resume();
    await window.library.ververs();
    await window.library.laad(${JSON.stringify(track.id)}, 'A');
    __act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0);
    __act.invoke('track.1.play', true); __act.invoke('track.1.play', false);
    return window.engine.deck('A').playing;
  })()`);
  ok('track 1 speelt', speelt === true);
  const balk = "(() => { const b = document.querySelector('.topbar-right'); return { over: b.scrollWidth - b.clientWidth, knop: document.getElementById('video-btn').getBoundingClientRect().width }; })()";
  const balkAan = await chrome.ev(hoofd, balk);
  ok('video.clips op de bus, standaard aan; de knop video zegt gewoon "video"',
    (await chrome.ev(hoofd, "__act.has('video.clips') && __act.read('video.clips') === 1 && document.getElementById('video-btn').textContent === 'video'")) === true);

  // ---- het losse venster ------------------------------------------------------------
  await chrome.cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await chrome.ev(hoofd, "document.querySelector('#video-panel .vid-los').click(); true", true);
  let los = null;
  // Op opener, niet op de url: bij het koppelen staat een nieuw venster nog op about:blank.
  for (let i = 0; i < 100 && !los; i++) { los = chrome.nieuw.find((t) => t.type === 'page' && t.openerId); if (!los) await wacht(100); }
  ok('los venster open met een klik mét gebaar (zonder --disable-popup-blocking)', !!los, los ? '' : JSON.stringify(chrome.nieuw.map((t) => [t.type, t.url, t.openerId])));
  if (!los) throw new Error('geen los venster');
  const pop = los.sessionId;
  await chrome.cdp('Page.enable', {}, pop).catch(() => {});
  ok('het losse venster is video.html', !!(await chrome.tot(pop, "location.pathname.endsWith('video.html') && document.readyState === 'complete'", 10000)));
  await chrome.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, pop).catch(() => {});
  ok('het losse venster mengt zelf, met de video van track 1', !!(await chrome.tot(pop,
    "!!window.beamerMixer && opener.varveBeamer.mengtLos(window) && window.beamerMixer.lagen.get('A')?.klaar", 20000)));
  await wacht(2500);
  const beeldenPerS = async () => { const a = await chrome.ev(pop, 'window.beamerMixer.beelden'); await wacht(1000); return (await chrome.ev(pop, 'window.beamerMixer.beelden')) - a; };
  const videoSpeelt = "(() => { const l = window.beamerMixer.lagen.get('A'); return !!l && !l.video.paused; })()";
  let b = await beeldenPerS();
  let p = await chrome.ev(pop, LEES);
  ok('clips aan: de video in het losse venster (vier kwarten, rechtop), hij speelt', p.kwarten === 'rood groen blauw geel' && await chrome.ev(pop, videoSpeelt), `${p.kwarten} · ${b} beelden/s`);
  await chrome.foto(pop, join(UIT, 'zaalbeeld-1-clips-aan.png'));

  // ---- clips uit: het zaalbeeld ------------------------------------------------------
  await chrome.ev(hoofd, "__act.invoke('video.clips', true); __act.invoke('video.clips', false); true");
  await wacht(600);
  p = await chrome.ev(pop, LEES);
  b = await beeldenPerS();
  ok('clips uit: het losse venster neemt het over (beamerMixer.clips === false)', (await chrome.ev(pop, 'window.beamerMixer.clips')) === false);
  ok('clips uit: het losse venster mengt ZWART (geen deck-video op het doek)', p.kwarten === 'zwart zwart zwart zwart' && p.licht < 0.001, `${p.kwarten} · licht ${pct(p.licht)}`);
  ok('clips uit: de video in het losse venster staat stil, het tekenen loopt door', !(await chrome.ev(pop, videoSpeelt)) && b > 20, `${b} beelden/s`);
  ok('clips uit: het geluid speelt door (deck A)', (await chrome.ev(hoofd, "window.engine.deck('A').playing")) === true);
  const knop = await chrome.ev(hoofd, "(() => { const k = document.getElementById('video-btn'); return { tekst: k.textContent, klasse: k.classList.contains('clips-uit') }; })()");
  ok('de knop video zegt "video · alleen eigen beeld" (klasse clips-uit)', knop.tekst === 'video · alleen eigen beeld' && knop.klasse, knop.tekst);
  ok('de venstertitel van het losse venster zegt het ook (niet op het doek)', /alleen eigen beeld/.test(await chrome.ev(pop, 'document.title')), await chrome.ev(pop, 'document.title'));
  const balkUit = await chrome.ev(hoofd, balk);
  console.log(`  ..  bovenbalk op 1440×900: de knop video ${Math.round(balkAan.knop)} → ${Math.round(balkUit.knop)} px; de rechterkant steekt ${balkAan.over} → ${balkUit.over} px uit (> 0 = hij scrollt opzij, bovenbalk.js)`);
  await chrome.foto(pop, join(UIT, 'zaalbeeld-2-clips-uit.png'));
  // Het paneel: het knopje clips en de statusregel.
  await chrome.ev(hoofd, "document.getElementById('video-btn').click(); true");
  await wacht(800);
  const paneel = await chrome.ev(hoofd, "({ status: document.querySelector('.vid-status').textContent, clipsAan: document.querySelector('.vid-clips').classList.contains('on') })");
  ok('het paneel: de statusregel zegt "alleen eigen beeld (clips uit)", het knopje clips brandt niet', /alleen eigen beeld \(clips uit\)/.test(paneel.status) && !paneel.clipsAan, paneel.status);
  await chrome.foto(hoofd, join(UIT, 'zaalbeeld-3-paneel.png'));

  // ---- vormen erbij: het eigen beeld --------------------------------------------------
  await chrome.ev(hoofd, "__act.invoke('video.layer.on', true); __act.invoke('video.layer.on', false); __act.has('video.layer.react') && __act.invoke('video.layer.react', 0.6); true");
  await wacht(1500);
  b = await beeldenPerS();
  p = await chrome.ev(pop, LEES);
  ok('vormen aan (clips nog uit): het losse venster toont beeld, > 20 beelden/s', p.licht > 0.002 && b > 20, `licht ${pct(p.licht)} · ${b} beelden/s · ${p.kwarten}`);
  ok('en de deck-video blijft weg', !(await chrome.ev(pop, videoSpeelt)) && (await chrome.ev(pop, 'window.beamerMixer.clips')) === false);
  await chrome.foto(pop, join(UIT, 'zaalbeeld-4-vormen.png'));
  // De noodknop werkt op het zaalbeeld.
  await chrome.ev(hoofd, "__act.invoke('video.black', true); __act.invoke('video.black', false); true");
  await wacht(500);
  const zwart = await chrome.ev(pop, LEES);
  ok('video.black op het zaalbeeld: zwart (ook de vormen)', zwart.licht < 0.001, `licht ${pct(zwart.licht)}`);
  await chrome.ev(hoofd, "__act.invoke('video.black', true); __act.invoke('video.black', false); true");
  await wacht(500);
  ok('en weer terug', (await chrome.ev(pop, LEES)).licht > 0.002);

  // ---- clips weer aan -----------------------------------------------------------------
  await chrome.ev(hoofd, "__act.invoke('video.layer.on', true); __act.invoke('video.layer.on', false); __act.invoke('video.clips', true); __act.invoke('video.clips', false); true");
  const terug = await chrome.tot(pop, `(() => { if (!window.beamerMixer.clips) return false; const l = window.beamerMixer.lagen.get('A'); return !!l && !l.video.paused && !l.video.seeking && l.video.readyState >= 2; })()`, 10000);
  await wacht(500);
  p = await chrome.ev(pop, LEES);
  ok('clips weer aan: de video terug in het losse venster', !!terug && p.kwarten === 'rood groen blauw geel', p.kwarten);
  ok('de knop video zegt weer "video"', (await chrome.ev(hoofd, "document.getElementById('video-btn').textContent")) === 'video'
    && !/alleen eigen beeld/.test(await chrome.ev(pop, 'document.title')));
  await chrome.foto(pop, join(UIT, 'zaalbeeld-5-clips-terug.png'));

  const fouten = [...chrome.fouten.values()].flat();
  ok('0 uitzonderingen in het hoofdvenster en het losse venster', !fouten.length, fouten.slice(0, 3).join(' · '));
} catch (e) {
  ok('liep zonder uitzondering', false, e.message);
} finally {
  chrome?.sluit();
  for (const pr of processen) { try { process.kill(-pr.pid, 'SIGTERM'); } catch (_) {} }
  await wacht(800);
  rmSync(tmp, { recursive: true, force: true });
  const fout = uitkomst.filter(([, g]) => !g).length;
  console.log(`\n${uitkomst.length} checks, ${fout ? `${fout} FAIL` : 'alles ok'} — schermafdrukken in ${UIT}`);
  code = fout ? 1 : 0;
}
process.exit(code);
