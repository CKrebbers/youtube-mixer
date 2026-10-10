// Het zaalbeeld headless (docs/BEAMER.md "Zaalbeeld", spoor beeld-een-machine
// stap 2): het losse venster mengt een deck-video; `video.clips` uit = het
// mengt ZWART (geen clips van anderen) en de video's staan stil, terwijl het
// geluid doorspeelt; `video.layer.on` = de vormen geven wél beeld (> 20 beelden/s,
// pixels niet zwart); `video.black` werkt ook dan; clips weer aan = de video
// terug. Plus wat VARVE laat zien: de knop video in de bovenbalk (amber, de tekst
// blijft "video", de balk schuift niet opzij), het knopje clips in de rij van de
// deck-video's en de statusregel in het paneel ("clips uit"; past in drie
// toestanden op 1440 breed), de venstertitel van het losse venster. Niets van dat
// alles op het doek zelf. Het knopje clips is in beide standen leesbaar (tekst niet
// in de kleur van zijn vlak, contrast ≥ 4,5; review 2: aan was een egaal turquoise
// blok) en gaat uit met een echte muisklik (CDP Input, zoals Clay klikt).
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
//           node tools/headless/zaalbeeld.mjs --opruimen   (na een harde stop: alleen
//           processen met varve-zaalbeeld- in een pad in hun argumenten)
// Poorten:  VARVE_KIJK_POORT (8806), VARVE_KIJK_DEBUG (9406). VARVE_CHROME.
// Ctrl-C stopt de Chrome en de server (eigen procesgroep) en ruimt de tijdelijke map op.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chrome, GEEN_MIDI, poortBezet, zoekChrome, start, stopAlles, wachtTotWeg, zetSignalen, proefEnv, ruimOp, isAfgebroken } from './beeld-lokaal.mjs';

const VOORVOEGSEL = 'varve-zaalbeeld-';
if (process.argv.includes('--opruimen')) process.exit(await ruimOp(null, VOORVOEGSEL));
const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8806, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9406;
const tmp = mkdtempSync(join(tmpdir(), VOORVOEGSEL));
zetSignalen(() => rmSync(tmp, { recursive: true, force: true }));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitkomst = [];
// Na Ctrl-C (isAfgebroken) zwijgt ok(): wat de lus dan nog ziet, is geen uitkomst (review 2, punt 4).
const ok = (naam, cond, extra = '') => { if (isAfgebroken()) return; uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra !== '' ? ` (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`); };

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
/**
 * Is een knop leesbaar? De tekstkleur tegen het vlak eronder: zijn eigen achtergrond,
 * of (doorzichtig) die van de eerste voorouder met een vlak. Contrast volgens WCAG
 * (≥ 4,5 voor kleine tekst). Een half doorzichtig vlak telt als dicht (benadering).
 */
const LEESBAAR = (sel) => `(() => {
  const k = document.querySelector(${JSON.stringify(sel)}); if (!k) return null;
  const rgb = (s) => { const m = s.match(/[\\d.]+/g) || []; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
  const cs = getComputedStyle(k);
  let el = k, bg = rgb(cs.backgroundColor);
  while (bg.a === 0 && el.parentElement) { el = el.parentElement; bg = rgb(getComputedStyle(el).backgroundColor); }
  const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const L1 = lum(rgb(cs.color)), L2 = lum(bg);
  return { tekst: k.textContent, aan: k.classList.contains('on'), kleur: cs.color, vlak: cs.backgroundColor, onder: \`rgb(\${bg.r}, \${bg.g}, \${bg.b})\`,
    contrast: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 10) / 10 };
})()`;
const leesbaar = (l) => !!l && l.kleur !== l.vlak && l.contrast >= 4.5;
const lsTekst = (l) => (l ? `"${l.tekst}": tekst ${l.kleur} op ${l.onder} (eigen vlak ${l.vlak}), contrast ${String(l.contrast).replace('.', ',')}` : 'geen knopje');

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

let chrome = null;
let code = 0;
try {
  if (await poortBezet(POORT) || await poortBezet(DEBUG)) throw new Error(`poort ${POORT} of ${DEBUG} is bezet (zet VARVE_KIJK_POORT/VARVE_KIJK_DEBUG)`);
  const { maakNepYtdlp } = await import(pathToFileURL(join(WORTEL, 'test/nep-ytdlp.mjs')).href);
  mkdirSync(join(tmp, 'nep'), { recursive: true });
  // --meting=<tmp>: het merkteken voor --opruimen (server/index.js leest geen argv).
  start(process.execPath, [join(WORTEL, 'server/index.js'), `--meting=${tmp}`], { env: proefEnv(tmp, POORT, maakNepYtdlp(join(tmp, 'nep'))) });
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
  // Zonder lopende audio-uitgang staat de audioklok stil: dan lopen video en vormen niet
  // mee en zijn de pixelchecks hieronder rood zonder dat VARVE iets mankeert (10 okt: de
  // klep van de MacBook dicht = 0 samples/s). Eén duidelijke regel in plaats van raadsels.
  const klok = await chrome.ev(hoofd, '(async () => { const c = window.engine.ctx, t0 = c.currentTime; await new Promise((r) => setTimeout(r, 500)); return { staat: c.state, dt: c.currentTime - t0 }; })()');
  ok('de audioklok van VARVE loopt (anders: geen audio-uitgang, bv. de klep dicht; de beeldchecks zeggen dan niets)',
    klok.staat === 'running' && klok.dt > 0.3, `${klok.staat}, ${klok.dt.toFixed(3).replace('.', ',')} s in 0,5 s`);
  const balk = "(() => { const b = document.querySelector('.topbar-right'); return { over: b.scrollWidth - b.clientWidth, knop: document.getElementById('video-btn').getBoundingClientRect().width }; })()";
  const balkAan = await chrome.ev(hoofd, balk);
  ok('video.clips op de bus, standaard aan; de knop video zegt gewoon "video"',
    (await chrome.ev(hoofd, "__act.has('video.clips') && __act.read('video.clips') === 1 && document.getElementById('video-btn').textContent === 'video'")) === true);

  // ---- het paneel, nog zonder los venster: de statusregel past (review 10 okt, punt 1) ----
  // Op 1440 breed is de statusregel ~136 px. Met het knopje clips in de kop was hij
  // 79 px en paste "geen zichtbare video" (110 px) al niet meer.
  const STATUS = `(() => { const s = document.querySelector('.vid-status'), r = document.createRange(); r.selectNodeContents(s);
    return { tekst: s.textContent, titel: s.title, past: s.scrollWidth <= s.clientWidth, nodig: Math.ceil(r.getBoundingClientRect().width), breed: s.clientWidth }; })()`;
  const px = (st) => `"${st.tekst}": ${st.nodig} px tekst in ${st.breed} px`;
  await chrome.ev(hoofd, "document.getElementById('video-btn').click(); true");
  await wacht(800);
  const st0 = await chrome.tot(hoofd, `(() => { const st = ${STATUS}; return st.tekst ? st : null; })()`, 5000);
  ok('statusregel past: paneel open, zonder los venster', !!st0?.past, st0 ? px(st0) : 'leeg');
  const fx = await chrome.ev(hoofd, `(() => { const r = document.querySelector('.vid-fx'), k = r.querySelector('.vid-clips');
    if (!k) return null; const met = r.getBoundingClientRect().height; k.style.display = 'none'; const zonder = r.getBoundingClientRect().height; k.style.display = '';
    return { met: Math.round(met), zonder: Math.round(zonder), aan: k.classList.contains('on'), inKop: !!document.querySelector('.vid-head .vid-clips') }; })()`);
  ok('het knopje clips staat in de rij van de deck-video\'s (mix, passend, clips), niet in de kop; brandt (aan); de rij wordt er niet hoger van',
    !!fx && fx.aan && !fx.inKop && fx.met === fx.zonder, fx ? `rij ${fx.zonder} → ${fx.met} px` : 'geen knopje');
  // Review 2, punt 1: aan (de standaardstand) waren tekst en vlak allebei turquoise.
  const lsAan = await chrome.ev(hoofd, LEESBAAR('.vid-clips'));
  ok('het knopje clips is leesbaar zolang het brandt (tekst niet in de kleur van het vlak, contrast ≥ 4,5)', leesbaar(lsAan) && lsAan.aan, lsTekst(lsAan));
  await chrome.foto(hoofd, join(UIT, 'zaalbeeld-0-paneel-clips-aan.png'));
  const rijVak = await chrome.ev(hoofd, "(() => { const r = document.querySelector('.vid-fx').getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12 }; })()");
  await chrome.foto(hoofd, join(UIT, 'zaalbeeld-0-rij-clips-aan.png'), { ...rijVak, scale: 2 });

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
  const st1 = await chrome.tot(hoofd, `(() => { const st = ${STATUS}; return /^beamer · 1: -?\\d+ ms$/.test(st.tekst) ? st : null; })()`, 5000);
  ok('statusregel past: clips aan, het losse venster mengt ("beamer · 1: N ms")', !!st1?.past, st1 ? px(st1) : await chrome.ev(hoofd, STATUS).then(px));
  await chrome.foto(pop, join(UIT, 'zaalbeeld-1-clips-aan.png'));

  // ---- clips uit: het zaalbeeld ------------------------------------------------------
  // Met een echte muisklik op CLIPS (review 2, punt 5): pointerdown/pointerup via
  // bindButtons, zoals Clay klikt. Clips weer aan gaat verderop via de bus.
  const kp = await chrome.ev(hoofd, "(() => { const k = document.querySelector('.vid-clips'); k.scrollIntoView({ block: 'center' }); const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  for (const type of ['mousePressed', 'mouseReleased']) await chrome.cdp('Input.dispatchMouseEvent', { type, x: kp.x, y: kp.y, button: 'left', clickCount: 1 }, hoofd);
  await wacht(600);
  ok('een echte muisklik op CLIPS (CDP Input.dispatchMouseEvent): clips uit (read 0)', (await chrome.ev(hoofd, "__act.read('video.clips')")) === 0,
    `klik op ${Math.round(kp.x)},${Math.round(kp.y)}`);
  p = await chrome.ev(pop, LEES);
  b = await beeldenPerS();
  ok('clips uit: het losse venster neemt het over (beamerMixer.clips === false)', (await chrome.ev(pop, 'window.beamerMixer.clips')) === false);
  ok('clips uit: het losse venster mengt ZWART (geen deck-video op het doek)', p.kwarten === 'zwart zwart zwart zwart' && p.licht < 0.001, `${p.kwarten} · licht ${pct(p.licht)}`);
  ok('clips uit: de video in het losse venster staat stil, het tekenen loopt door', !(await chrome.ev(pop, videoSpeelt)) && b > 20, `${b} beelden/s`);
  ok('clips uit: het geluid speelt door (deck A)', (await chrome.ev(hoofd, "window.engine.deck('A').playing")) === true);
  const knop = await chrome.ev(hoofd, "(() => { const k = document.getElementById('video-btn'); return { tekst: k.textContent, klasse: k.classList.contains('clips-uit'), titel: k.title }; })()");
  ok('de knop video blijft "video", in amber (klasse clips-uit), de title zegt "alleen eigen beeld"', knop.tekst === 'video' && knop.klasse && /alleen eigen beeld/.test(knop.titel), knop);
  ok('de venstertitel van het losse venster zegt het ook (niet op het doek)', /alleen eigen beeld/.test(await chrome.ev(pop, 'document.title')), await chrome.ev(pop, 'document.title'));
  const balkUit = await chrome.ev(hoofd, balk);
  ok(`de bovenbalk op 1440×900 schuift met clips uit niet verder opzij (steekt ${balkAan.over} → ${balkUit.over} px uit, knop video ${Math.round(balkAan.knop)} → ${Math.round(balkUit.knop)} px)`,
    balkUit.over <= balkAan.over && Math.round(balkUit.knop) === Math.round(balkAan.knop));
  await chrome.foto(pop, join(UIT, 'zaalbeeld-2-clips-uit.png'));
  // Het paneel: het knopje clips en de statusregel.
  const st2 = await chrome.tot(hoofd, `(() => { const st = ${STATUS}; return st.tekst === 'beamer · clips uit' ? st : null; })()`, 3000);
  ok('statusregel past: clips uit ("beamer · clips uit"), de uitleg in de title', !!st2?.past && /alleen eigen beeld/.test(st2.titel), st2 ? px(st2) : await chrome.ev(hoofd, STATUS).then(px));
  const lsUit = await chrome.ev(hoofd, LEESBAAR('.vid-clips'));
  ok('het knopje clips brandt niet, en is leesbaar (contrast ≥ 4,5)', !!lsUit && !lsUit.aan && leesbaar(lsUit), lsTekst(lsUit));
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
  const lsTerug = await chrome.ev(hoofd, LEESBAAR('.vid-clips'));
  ok('het knopje clips brandt weer, en is leesbaar', !!lsTerug && lsTerug.aan && leesbaar(lsTerug), lsTekst(lsTerug));
  ok('de knop video weer gewoon (geen amber, de gewone title), de venstertitel ook',
    (await chrome.ev(hoofd, "(() => { const k = document.getElementById('video-btn'); return k.textContent === 'video' && !k.classList.contains('clips-uit') && !/alleen eigen beeld/.test(k.title); })()")) === true
    && !/alleen eigen beeld/.test(await chrome.ev(pop, 'document.title')));
  await chrome.foto(pop, join(UIT, 'zaalbeeld-5-clips-terug.png'));

  const fouten = [...chrome.fouten.values()].flat();
  ok('0 uitzonderingen in het hoofdvenster en het losse venster', !fouten.length, fouten.slice(0, 3).join(' · '));
} catch (e) {
  ok('liep zonder uitzondering', false, e.message);
} finally {
  chrome?.sluit();
  stopAlles();
  await wachtTotWeg(3000);
  rmSync(tmp, { recursive: true, force: true });
  const fout = uitkomst.filter(([, g]) => !g).length;
  if (!isAfgebroken()) console.log(`\n${uitkomst.length} checks, ${fout ? `${fout} FAIL` : 'alles ok'} — schermafdrukken in ${UIT}`);
  code = fout ? 1 : 0;
}
if (!isAfgebroken()) process.exit(code);   // anders sluit de signaalhandler af (130/143)
