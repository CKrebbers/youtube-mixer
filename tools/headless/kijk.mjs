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
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });            // anders faalt de eerste foto pas na alle checks
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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
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

  // ---- de Q van quantize bij Lock (spiegel.js) -----------------------------
  // Quantize heeft op het scherm een Q in de hoek van Lock, tot Lock in de
  // mapping zelf quantize is: dan toont die knop het en is de Q dubbel. Los van
  // wat de standaardmapping nu met Lock doet (dat verandert met de
  // APC-indeling): de Q staat er precies als Lock, in het mapje dat open staat,
  // GEEN quantize is. Daarna de regel terug zoals hij was.
  console.log('quantize bij Lock');
  const qStand = () => evalueer(`(() => {
    const q = document.querySelector('#fd-devknoppen .fd-quantize');
    const lock = document.querySelector('#fd-devknoppen [data-sig="note:0:63"]');
    return { q: !!q, zichtbaar: !!q && getComputedStyle(q).display !== 'none', action: lock?.dataset.action ?? null };
  })()`);
  const qKlopt = (s) => s.q && s.zichtbaar === (s.action !== 'transport.quantize');
  ok('het scherm leest de APC-mapping van de app', await evalueer("window.mapping.device === 'apc40mk2' && window.mapping.rules.size > 0"));
  const q0 = await qStand();
  ok(`Q bij Lock: ${q0.zichtbaar ? 'zichtbaar' : 'weg'} (Lock: ${q0.action ?? 'niets'})`, qKlopt(q0));
  // Sinds de APC-indeling (ronde 4b) is Lock in de STANDAARDmapping quantize:
  // dan staat quantize één keer op het scherm (Lock, met zijn stand), geen Q.
  const lockStand = () => evalueer(`(() => {
    const zichtbaar = [...document.querySelectorAll('#focusdeel [data-action="transport.quantize"]')]
      .filter((el) => getComputedStyle(el).display !== 'none' && el.offsetParent);
    const lock = document.querySelector('#fd-devknoppen [data-sig="note:0:63"]');
    return { n: zichtbaar.length, licht: lock?.dataset.licht ?? null, tekst: lock?.textContent.trim() ?? '' };
  })()`);
  ok('standaardmapping: Lock = quantize en de Q is weg', q0.action === 'transport.quantize' && !q0.zichtbaar);
  const l0 = await lockStand();
  const qa = await evalueer("(async () => { const a = await import('/src/control/actions.js'); a.invoke('transport.quantize', true); a.invoke('transport.quantize', false); return window.engine.quantize; })()");
  let l1 = await lockStand();
  for (let i = 0; i < 30 && l1.licht === l0.licht; i++) { await wacht(100); l1 = await lockStand(); }
  ok('quantize staat één keer in het focusdeel (niets dubbel), Lock volgt zijn stand',
    l0.n === 1 && l1.n === 1 && l0.licht !== l1.licht && [l0.licht, l1.licht].includes('aan'),
    `${l0.n}/${l1.n} zichtbaar, licht ${l0.licht} -> ${l1.licht}, quantize ${qa}, "${l1.tekst}"`);
  await foto('focusdeel-lock-quantize.png');
  await evalueer("(async () => { const a = await import('/src/control/actions.js'); a.invoke('transport.quantize', true); a.invoke('transport.quantize', false); })()");
  await evalueer(`(() => {
    const m = window.mapping;
    window.__lockWas = m.rules.has('note:0:63') ? structuredClone(m.rules.get('note:0:63')) : null;
    m.set('note:0:63', 'transport.quantize', { laag: null, mode: 'trigger' });
  })()`);
  const q1 = await qStand();
  ok('Lock zelf quantize: de Q is weg', q1.action === 'transport.quantize' && !q1.zichtbaar && qKlopt(q1));
  await evalueer("window.lagen.zet('edit', 'aan')");
  const q2 = await qStand();
  ok(`… in de grid-modus is Lock iets anders (${q2.action ?? 'niets'}): de Q ${q2.zichtbaar ? 'is er weer' : 'blijft weg'}`, qKlopt(q2));
  await evalueer("window.lagen.zet('edit', 'uit')");
  await evalueer(`(() => {
    const m = window.mapping, was = window.__lockWas;
    if (was) { const { in: sig, action, ...rest } = was; m.set(sig, action, { laag: null, ...rest }); } else m.remove('note:0:63');
    delete window.__lockWas;
  })()`);
  const q3 = await qStand();
  ok('regel terug: zelfde stand als eerst', q3.action === q0.action && q3.zichtbaar === q0.zichtbaar && qKlopt(q3));
  ok('geen fouten rond de Q', meldingen.length === 0, meldingen.join(' | '));
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

  // ---- kill en rem in de echte worklet (ROADMAP 16, spoor C) ---------------
  // De demo speelt nog (via de StreamBron). Het remsegment gaat per bericht
  // naar de echte AudioWorklet; hier meten we wat er uit de master komt.
  console.log('kill en rem (echte AudioContext en worklet)');
  // Eerst de automatisering zelf, in Chrome: killEqBand en setEqBand op een
  // parameter in een OfflineAudioContext, met suspend precies op een blok.
  // Kill aan en een blok (2,7 ms, binnen de 5 ms) later weer uit, of aan de
  // knop gedraaid: met setValueCurveAtTime + cancelAndHoldAtTime speelde
  // Chrome de afgekapte curve opnieuw af, een sprong van 0,55 in amplitude.
  const killStap = await evalueer(`(async () => {
    const { killEqBand, setEqBand } = await import('/src/engine/audio-graph.js');
    const SR = 48000, Q = 128 / SR, uit = [];
    for (const stappen of [
      [[1, (p, t) => setEqBand(p, 0.5, t)], [2, (p, t) => killEqBand(p, 0.5, true, t)], [3, (p, t) => killEqBand(p, 0.5, false, t)]],
      [[1, (p, t) => setEqBand(p, 0.5, t)], [2, (p, t) => killEqBand(p, 0.5, true, t)], [3, (p, t) => setEqBand(p, 0.8, t, true)], [8, (p, t) => killEqBand(p, 0.8, false, t)]],
      [[1, (p, t) => setEqBand(p, 0.5, t, true)], [8, (p, t) => killEqBand(p, 0.5, false, t)], [9, (p, t) => setEqBand(p, 0.3, t)]],
    ]) {
      const ctx = new OfflineAudioContext(1, SR * 0.06, SR);
      const c = new ConstantSourceNode(ctx, { offset: 0 });
      c.connect(ctx.destination); c.start();
      for (const [q, doe] of stappen) ctx.suspend(q * Q).then(() => { doe(c.offset, q * Q); ctx.resume(); });
      const d = (await ctx.startRendering()).getChannelData(0);
      let m = 0;
      for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(Math.pow(10, d[i] / 20) - Math.pow(10, d[i - 1] / 20)));
      uit.push(m);
    }
    return uit;
  })()`);
  ok('kill: snel aan/uit en knop tijdens de overgang, in Chrome\'s automatisering geen sprong', killStap.every((m) => m < 0.05),
    `grootste stap in amplitude ${killStap.map((m) => m.toFixed(3)).join(' / ')}`);
  // Dezelfde vraag voor de kruisfade van een effectwissel (fx.js): een echte
  // InsertSlot in een OfflineAudioContext. Elke gain (droog, elke keten) krijgt
  // een ConstantSource van 1 als invoer en een eigen kanaal: dat kanaal IS de
  // gain, sample voor sample. Wissel, en 5 ms later aan de mix, of 8 ms later
  // nog een wissel: met setValueCurveAtTime speelde Chrome de afgekapte curve
  // opnieuw af, 0,15–0,33 in één sample (realtime tot 0,60).
  const fxStap = await evalueer(`(async () => {
    const { InsertSlot } = await import('/src/engine/fx.js');
    const SR = 48000, Q = 128 / SR, K = 6, uit = [];
    for (const stappen of [
      [[40, (s) => s.zetEffect('filter')], [42, (s) => s.setMix(0.9)]],
      [[40, (s) => s.zetEffect('filter')], [43, (s) => s.zetEffect('phaser')]],
      [[40, (s) => s.zetEffect('filter')], [44, (s) => s.zetEffect('phaser')],
        [48, (s) => { s.setMix(0.7); s.setBypass(true); s.setBypass(false); }], [50, (s) => s.zetEffect('crush')]],
    ]) {
      const ctx = new OfflineAudioContext(K, SR * 0.25, SR);
      const slot = new InsertSlot(ctx);
      // Opruimen loopt op een gewone timer; offline loopt de audioklok daar
      // los van, en losmaken zou hier de meting afknippen, niet het geluid.
      slot._ruimOp = () => {};
      const merger = new ChannelMergerNode(ctx, { numberOfInputs: K });
      merger.connect(ctx.destination);
      const een = new ConstantSourceNode(ctx, { offset: 1 }); een.start();
      const gepeild = new Set();
      const peil = (g) => { if (g && !gepeild.has(g) && gepeild.size < K) { een.connect(g); g.connect(merger, 0, gepeild.size); gepeild.add(g); } };
      peil(slot.dry);
      slot.standaard(); slot.setMix(0.6); peil(slot.keten.gain);
      for (const [q, doe] of stappen) ctx.suspend(q * Q).then(() => { doe(slot); peil(slot.keten?.gain); ctx.resume(); });
      const b = await ctx.startRendering();
      let m = 0;
      for (let k = 0; k < gepeild.size; k++) { const d = b.getChannelData(k); for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1])); }
      uit.push(m);
    }
    return uit;
  })()`);
  ok('effectwissel: binnen de kruisfade aan de mix draaien of nog eens wisselen, in Chrome geen sprong', fxStap.every((m) => m < 0.01),
    `grootste stap in de gains ${fxStap.map((m) => m.toFixed(4)).join(' / ')}`);
  // Hellingen hebben een eigen valkuil: de renderthread kan een paar ms voor
  // ctx.currentTime uit lopen (realtime gemeten tot 7,5 ms), en Chrome zet
  // een nieuw punt dat voor hem al voorbij is op zijn eigen nu. Van hellingen
  // vallen de punten die al voorbij zijn dan samen tot één sprong (een curve
  // schuift als geheel op). Daarom beginnen ze pas na startDrempel. Hier
  // deterministisch nagebootst: op blok 40 plannen alsof het nog blok 38 is.
  const voorloop = await evalueer(`(async () => {
    const { zetHellingen, startDrempel } = await import('/src/engine/overgang.js');
    const { killEqBand, eqDb } = await import('/src/engine/audio-graph.js');
    const SR = 48000, Q = 128 / SR, uit = {};
    const ep = (a, b) => Array.from({ length: 33 }, (_, i) => { const t = i / 32; return a * Math.cos(t * Math.PI / 2) + b * Math.cos((1 - t) * Math.PI / 2); });
    const proef = async (naam, begin, doe, db = false) => {
      const ctx = new OfflineAudioContext(1, SR * 0.2, SR);
      const c = new ConstantSourceNode(ctx, { offset: begin }); c.connect(ctx.destination); c.start();
      ctx.suspend(40 * Q).then(() => { doe(c.offset, 38 * Q, startDrempel(ctx)); ctx.resume(); });
      const d = (await ctx.startRendering()).getChannelData(0);
      const a = db ? (x) => Math.pow(10, x / 20) : (x) => x;
      let m = 0; for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(a(d[i]) - a(d[i - 1])));
      uit[naam] = m;
    };
    await proef('fadeOpNu', 0, (p, nu) => zetHellingen(p, (v) => ep(v, 1), nu, 0.04, 0));
    await proef('fade', 0, (p, nu, w) => zetHellingen(p, (v) => ep(v, 1), nu, 0.04, w));
    await proef('killOpNu', eqDb(0.5), (p, nu) => killEqBand(p, 0.5, true, nu, 0), true);
    await proef('kill', eqDb(0.5), (p, nu, w) => killEqBand(p, 0.5, true, nu, w), true);
    return uit;
  })()`);
  ok('renderthread 5,3 ms voor: kruisfade en kill na startDrempel zonder sprong (op nu: wel, de valkuil bestaat nog)',
    voorloop.fade < 0.01 && voorloop.kill < 0.05 && voorloop.fadeOpNu > 0.1 && voorloop.killOpNu > 0.5,
    `fade ${voorloop.fade.toFixed(4)} (op nu ${voorloop.fadeOpNu.toFixed(3)}), kill ${voorloop.kill.toFixed(4)} (op nu ${voorloop.killOpNu.toFixed(3)})`);
  const bas = (s) => evalueer(`(async () => {
    const { Luisteraar } = await import('/src/analysis/luisteraar.js');
    const e = window.engine, l = new Luisteraar({ analyser: () => e.master.analyser, sampleRate: () => e.ctx.sampleRate });
    let laag = 0, m = 0; const eind = e.ctx.currentTime + ${s};
    await new Promise((ok) => { const f = () => { const w = l.lees(e.ctx.currentTime); if (w) { laag += w.laag; m++; } e.ctx.currentTime < eind ? setTimeout(f, 16) : ok(); }; f(); });
    return laag / Math.max(1, m);
  })()`);
  const basVoor = await bas(1);
  await evalueer("__act.invoke('track.1.kill.low', true); __act.invoke('track.1.kill.low', false)");
  await wacht(100);
  const basKill = await bas(1);
  await evalueer("__act.invoke('track.1.kill.low', true); __act.invoke('track.1.kill.low', false)");
  await wacht(100);
  const basNa = await bas(1);
  ok('kill laag: de bas verdwijnt, en komt terug als de kill eraf gaat', basKill < basVoor * 0.5 && basNa > basVoor * 0.7,
    `${basVoor.toFixed(2)} -> ${basKill.toFixed(2)} -> ${basNa.toFixed(2)}`);
  const rem = await evalueer(`(async () => {
    const d = window.engine.deck('A'), c = window.engine.ctx, a = window.engine.master.analyser, b = new Float32Array(a.fftSize);
    __act.invoke('track.1.brake.time', Math.log(4) / Math.log(50));          // 0,4 s
    const t0 = c.currentTime, p0 = d.position, R = d.rate;
    __act.invoke('track.1.brake', true); __act.invoke('track.1.brake', false);
    const remt = d.remt, uit = [];
    await new Promise((ok) => { const f = () => {
      a.getFloatTimeDomainData(b); let m = 0; for (const x of b) m = Math.max(m, Math.abs(x));
      uit.push({ t: c.currentTime - t0, p: d.position, piek: m });
      c.currentTime - t0 < 0.9 ? setTimeout(f, 10) : ok(); }; f(); });
    return { remt, p0, R, D: d.remTijd, uit, speelt: d.playing, remtNog: d.remt, eind: d.position };
  })()`);
  const vroeg = rem.uit.filter((m) => m.t < 0.15), laat = rem.uit.filter((m) => m.t > 0.6);
  let oplopend = true;
  for (let i = 1; i < rem.uit.length; i++) if (rem.uit[i].p < rem.uit[i - 1].p - 1e-9) oplopend = false;
  ok('rem: remt, klinkt eerst nog', rem.remt && vroeg.length > 0 && Math.max(...vroeg.map((m) => m.piek)) > 0.05,
    `piek vroeg ${Math.max(...vroeg.map((m) => m.piek)).toFixed(3)}`);
  ok('… stil na stilstand, en gepauzeerd op P + R·D/2', !rem.speelt && !rem.remtNog && laat.length > 0
    && Math.max(...laat.map((m) => m.piek)) < 1e-3 && Math.abs(rem.eind - (rem.p0 + rem.R * rem.D / 2)) < 0.01,
  `piek laat ${Math.max(...laat.map((m) => m.piek)).toExponential(1)}, ${(rem.eind - rem.p0).toFixed(4)} s afgelegd (verwacht ${(rem.R * rem.D / 2).toFixed(4)})`);
  ok('… de positie loopt nooit terug', oplopend);
  ok('geen fouten bij kill en rem', meldingen.length === 0, meldingen.join(' | '));
  await evalueer("__act.invoke('track.1.play', true); __act.invoke('track.1.play', false)");     // weer spelen, zoals hiervoor

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

  // ---- handelingenlog: vastleggen, bewaren, terugspelen (docs/HANDELINGENLOG.md) ----
  console.log('handelingenlog');
  meldingen.length = 0;
  await evalueer("window.engine.setFocus('A'); document.querySelector('#focus-deck .demo-btn').click()");
  for (let i = 0; i < 50 && !(await evalueer("window.engine.deck('A').title?.startsWith('demo 1')")); i++) await wacht(200);
  await evalueer("document.getElementById('log-btn').click()");
  ok('○ log: het log loopt', await evalueer('window.logboek.log.bezig'));
  await wacht(300);
  await evalueer(`(() => {
    __act.invoke('track.1.play', true); __act.invoke('track.1.play', false);
    __act.invoke('track.1.fader', 0.6); __act.invoke('mixer.xfader', 0.3);
    window.engine.setFocus('B');
  })()`);
  await wacht(700);
  await evalueer("window.engine.setFocus('A'); __act.invoke('track.1.low', 0.2)");
  await wacht(1200);
  await foto('handelingenlog-loopt.png');
  ok('de knop toont tijd en grootte (renderloop)', await evalueer("/^◉ log \\d+:\\d\\d · \\d+ kB$/.test(document.getElementById('log-btn').textContent)"),
    await evalueer("document.getElementById('log-btn').textContent"));
  const eindStand = await evalueer("({ fader: window.engine.deck('A').ui.fader, x: window.engine.xfader, low: window.engine.deck('A').ui.low, speelt: window.engine.deck('A').playing })");
  await evalueer("document.getElementById('log-btn').click()");
  for (let i = 0; i < 25 && (await evalueer('window.logboek.log.bezig')); i++) await wacht(200);
  const logs = await evalueer("fetch('/api/handelingen').then((r) => r.json()).then((j) => j.logs)");
  ok('bewaard: één log, netjes af', logs.length === 1 && logs[0].af && !logs[0].opname, JSON.stringify(logs[0]));
  const inhoud = await evalueer(`fetch('/api/handelingen/${logs[0].id}').then((r) => r.text())`);
  const regels = inhoud.trim().split('\n').map((r) => JSON.parse(r));
  const stand = regels.find((r) => r.e === 'stand');
  ok('beginstand: track 1 is de demo (terug te maken), focus op 1', stand?.tracks[0].bron === 'demo' && stand.tracks[0].demo?.seed === 0 && stand.focus === 1);
  ok('de actions staan erin, in volgorde', regels.filter(Array.isArray).map((a) => a[1]).join() === 'track.1.play,track.1.play,track.1.fader,mixer.xfader,track.1.low');
  ok('focus heen en terug als gebeurtenis (de banen gaan buiten de bus om)', regels.filter((r) => r.e === 'focus').map((r) => r.track).join() === '2,1');
  // Alles anders zetten, en terugspelen via de lijst.
  await evalueer("__act.invoke('track.1.fader', 0.1); __act.invoke('mixer.xfader', 0.9); __act.invoke('track.1.low', 0.9); window.engine.deck('A').pause()");
  await evalueer("document.getElementById('terug-btn').click()");
  for (let i = 0; i < 25 && !(await evalueer("!!document.querySelector('#log-lijst [data-speel]')")); i++) await wacht(200);
  ok('↺ toont de lijst', await evalueer(`!!document.querySelector('#log-lijst [data-speel="${logs[0].id}"]')`));
  await foto('handelingenlog-lijst.png');
  await evalueer(`document.querySelector('#log-lijst [data-speel="${logs[0].id}"]').click()`);
  ok('er staat iets op de tracks: eerst "nog eens"', await evalueer("document.querySelector('#log-lijst [data-speel]').textContent.startsWith('nog eens')"));
  await evalueer(`document.querySelector('#log-lijst [data-speel="${logs[0].id}"]').click()`);
  for (let i = 0; i < 25 && !(await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
  ok('terugspelen loopt', await evalueer('window.logboek.terugspeler.bezig'));
  for (let i = 0; i < 40 && (await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
  const naTerug = await evalueer("({ fader: window.engine.deck('A').ui.fader, x: window.engine.xfader, low: window.engine.deck('A').ui.low, speelt: window.engine.deck('A').playing, focus: window.engine.focus })");
  ok('klaar, en dezelfde eindstand als toen', JSON.stringify({ ...naTerug, focus: undefined }) === JSON.stringify({ ...eindStand, focus: undefined }) && naTerug.focus === 'A',
    `${JSON.stringify(naTerug)} / ${JSON.stringify(eindStand)}`);
  // Met een opname mee: zelfde id.
  await evalueer("document.getElementById('opname-btn').click()");
  for (let i = 0; i < 25 && !(await evalueer('window.opnemer.bezig && window.logboek.log.id')); i++) await wacht(200);
  ok('opname gestart: het log begint mee, met hetzelfde id', await evalueer('window.logboek.log.bezig && window.logboek.log.opname === window.opnemer.id && window.logboek.log.id === window.opnemer.id'),
    await evalueer('`${window.opnemer.id} / ${window.logboek.log.id}`'));
  await wacht(1200);
  await evalueer("document.getElementById('opname-btn').click(); document.getElementById('opname-btn').click()");
  for (let i = 0; i < 25 && (await evalueer('window.opnemer.bezig || window.logboek.log.bezig')); i++) await wacht(200);
  const logs2 = await evalueer("fetch('/api/handelingen').then((r) => r.json()).then((j) => j.logs)");
  ok('opname gestopt: het log ook, en de lijst weet dat er een opname bij is', logs2.length === 2 && logs2.some((l) => l.opname && l.af));
  // Opnieuw renderen: ● opnemen en dan terugspelen. Het log van die opname
  // krijgt de beginstand van het terugspelen erin (een stand midden in het log),
  // en speelt daardoor zelf ook terug, met dezelfde eindstand.
  {
    const eindNu = "({ fader: window.engine.deck('A').ui.fader, x: window.engine.xfader, low: window.engine.deck('A').ui.low, speelt: window.engine.deck('A').playing })";
    const husselen = "__act.invoke('track.1.fader', 0.1); __act.invoke('mixer.xfader', 0.9); __act.invoke('track.1.low', 0.9); window.engine.deck('A').pause()";
    const speelLog = async (id) => {
      await evalueer("document.getElementById('terug-btn').click()");
      for (let i = 0; i < 25 && !(await evalueer(`!!document.querySelector('#log-lijst [data-speel="${id}"]:not([disabled])')`)); i++) await wacht(200);
      await evalueer(`document.querySelector('#log-lijst [data-speel="${id}"]').click(); document.querySelector('#log-lijst [data-speel="${id}"]').click()`);
      for (let i = 0; i < 25 && !(await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
      // Terugspelen duurt op de audioklok zo lang als het log (hier ruim 10 s
      // audioklok); 8 s wachten was op een drukke machine te kort.
      for (let i = 0; i < 150 && (await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
    };
    await evalueer(husselen);
    await evalueer("document.getElementById('opname-btn').click()");
    for (let i = 0; i < 25 && !(await evalueer('window.opnemer.bezig && window.logboek.log.id')); i++) await wacht(200);
    const opnId = await evalueer('window.logboek.log.id');
    await speelLog(logs[0].id);
    const na2 = await evalueer(eindNu);
    await evalueer("document.getElementById('opname-btn').click(); document.getElementById('opname-btn').click()");
    for (let i = 0; i < 25 && (await evalueer('window.opnemer.bezig || window.logboek.log.bezig')); i++) await wacht(200);
    const r2 = (await evalueer(`fetch('/api/handelingen/${opnId}').then((r) => r.text())`)).split('\n').filter(Boolean).map((r) => JSON.parse(r));
    const standen = r2.filter((r) => r.e === 'stand');
    ok('opname van een replay: de stand van het terugspelen staat midden in zijn log', standen.length === 2 && standen[1].t > 0
      && standen[1].tracks[0].bron === 'demo' && standen[1].tracks[0].speelt === false, `${standen.length} standen`);
    await evalueer(husselen);
    await speelLog(opnId);
    const na3 = await evalueer(eindNu);
    ok('en die opname speelt zelf ook terug: dezelfde eindstand', JSON.stringify(na3) === JSON.stringify(na2) && na2.speelt,
      `${JSON.stringify(na3)} / ${JSON.stringify(na2)}`);
  }
  // Een ECHT library-nummer (een klikspoor door de ingest): terugspelen laadt
  // het streamend terug op dezelfde track, met het grid uit het log.
  {
    const SR = 48000, N = SR * 12, wav = Buffer.alloc(44 + N * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28);
    wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
    for (let t = 0; t < 12; t += 0.5) for (let i = 0; i < 400; i++) {
      const v = Math.round(16000 * Math.exp(-i / 60) * Math.sin(2 * Math.PI * 800 * i / SR)), o = 44 + (Math.round(t * SR) + i) * 4;
      wav.writeInt16LE(v, o); wav.writeInt16LE(v, o + 2);
    }
    const up = await fetch(`http://localhost:${POORT}/api/upload?naam=klikspoor.wav`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav }).then((r) => r.json());
    let nummer = null;
    for (let i = 0; i < 150 && !nummer; i++) {
      await wacht(200);
      const o = (await fetch(`http://localhost:${POORT}/api/ingest`).then((r) => r.json())).opdrachten.find((x) => x.id === up.id);
      if (o?.status === 'klaar') nummer = o.track.id;
      if (o?.status === 'mislukt') break;
    }
    ok('een klikspoor door de ingest: een library-nummer', !!nummer, nummer || up.fout);
    await evalueer(`(async () => { const { track } = await (await fetch('/api/library/${nummer}')).json(); await window.library.onLaad('B', track); })()`);
    await evalueer("document.getElementById('log-btn').click()");
    await wacht(300);
    await evalueer("__act.invoke('track.2.fader', 0.5); __act.invoke('track.2.play', true); __act.invoke('track.2.play', false)");
    await wacht(1200);
    const posToen = await evalueer("window.engine.deck('B').position");
    await evalueer("document.getElementById('log-btn').click()");
    for (let i = 0; i < 25 && (await evalueer('window.logboek.log.bezig')); i++) await wacht(200);
    const l3 = (await evalueer("fetch('/api/handelingen').then((r) => r.json()).then((j) => j.logs)"))[0];
    const st3 = (await evalueer(`fetch('/api/handelingen/${l3.id}').then((r) => r.text())`)).split('\n').filter(Boolean).map((r) => JSON.parse(r)).find((r) => r.e === 'stand');
    ok('beginstand: track 2 is dat library-nummer', st3?.tracks[1].bron === 'library' && st3.tracks[1].nummer === nummer);
    // Iets anders op track 2, en terugspelen.
    await evalueer("document.querySelector('#focus-deck .demo-btn') && window.engine.setFocus('B')");
    await evalueer("document.querySelector('#focus-deck .demo-btn').click()");
    for (let i = 0; i < 50 && !(await evalueer("window.engine.deck('B').title?.startsWith('demo')")); i++) await wacht(200);
    await evalueer("window.engine.deck('B').pause(); __act.invoke('track.2.fader', 0.1)");
    await evalueer("document.getElementById('terug-btn').click()");
    for (let i = 0; i < 25 && !(await evalueer(`!!document.querySelector('#log-lijst [data-speel="${l3.id}"]')`)); i++) await wacht(200);
    await evalueer(`document.querySelector('#log-lijst [data-speel="${l3.id}"]').click(); document.querySelector('#log-lijst [data-speel="${l3.id}"]').click()`);
    for (let i = 0; i < 25 && !(await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
    for (let i = 0; i < 40 && (await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
    const b = await evalueer("({ titel: window.engine.deck('B').title, fader: window.engine.deck('B').ui.fader, speelt: window.engine.deck('B').playing, pos: window.engine.deck('B').position, grid: !!window.engine.deck('B').grid })");
    ok('teruggespeeld: het library-nummer weer op track 2, fader 0,5, speelt', b.titel !== 'demo 2 — 124 bpm' && !b.titel.startsWith('demo') && b.fader === 0.5 && b.speelt,
      JSON.stringify(b));
    ok(`en de positie loopt zoals toen (${b.pos.toFixed(2)} s, toen ${posToen.toFixed(2)} s bij het stoppen)`, b.pos >= posToen - 0.3);
    // Wat terugspelen laadde, bewaart niets in de library (het grid van toen mag niet over dat van nu).
    const gridVoor = await evalueer(`fetch('/api/library/${nummer}/grid').then((r) => r.json()).then((j) => JSON.stringify(j.grid))`);
    await evalueer("window.engine.deck('B').setGrid({ bpm: 133, firstBeat: 0.1 }); window.engine.deck('B').gridGewijzigd()");
    await wacht(2200);                              // de bewaarlus loopt elke 1,5 s
    const gridNa = await evalueer(`fetch('/api/library/${nummer}/grid').then((r) => r.json()).then((j) => JSON.stringify(j.grid))`);
    ok('een grid op een teruggespeelde track gaat niet naar de library', gridNa === gridVoor, `${gridVoor} -> ${gridNa}`);
    // Tegenproef: gewoon geladen wordt het wél bewaard (anders zegt de check hierboven niets).
    await evalueer(`(async () => { const { track } = await (await fetch('/api/library/${nummer}')).json(); await window.library.onLaad('B', track);
      window.engine.deck('B').setGrid({ bpm: 133, firstBeat: 0.1 }); window.engine.deck('B').gridGewijzigd(); })()`);
    await wacht(2200);
    const gridGewoon = await evalueer(`fetch('/api/library/${nummer}/grid').then((r) => r.json()).then((j) => j.grid?.stukken?.[0]?.bpm ?? null)`);
    ok('tegenproef: na een gewone laad wordt hetzelfde grid wél bewaard', gridGewoon === 133, String(gridGewoon));
    await evalueer("window.engine.deck('B').pause()");

    // Naden met ronde 1 (integratie-r2): hotcues en toonsoort horen bij het
    // NUMMER. Een bewaarde hotcue komt na het laden van de server terug, buiten
    // de bus om: het log legt hem vast ('hotcues'), en terugspelen springt er
    // dan naartoe in plaats van een nieuwe te zetten. Wat je daarna op de
    // teruggespeelde track aan hotcues en toonsoort doet, gaat niet naar de library.
    {
      const B = `http://localhost:${POORT}`;
      const hotcuesServer = async () => JSON.stringify((await (await fetch(`${B}/api/library/${nummer}/hotcues`)).json()).hotcues);
      const toonServer = async () => JSON.stringify((await (await fetch(`${B}/api/library/${nummer}`)).json()).track?.toon ?? null);
      await fetch(`${B}/api/library/${nummer}/hotcues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nr: 1, tijd: 4 }) });
      const hotVoor = await hotcuesServer();
      await evalueer("document.getElementById('log-btn').click()");
      await wacht(300);
      await evalueer(`(async () => { const { track } = await (await fetch('/api/library/${nummer}')).json(); await window.library.onLaad('B', track); })()`);
      for (let i = 0; i < 25 && (await evalueer("window.engine.deck('B').hotcues[0]")) !== 4; i++) await wacht(200);
      await wacht(400);
      await evalueer("window.engine.deck('B').pause(); window.engine.deck('B').seek(1); __act.invoke('track.2.hotcue.1', true); __act.invoke('track.2.hotcue.1', false)");
      const toen = await evalueer("({ pos: window.engine.deck('B').position, hot: [...window.engine.deck('B').hotcues] })");
      await wacht(400);
      await evalueer("document.getElementById('log-btn').click()");
      for (let i = 0; i < 25 && (await evalueer('window.logboek.log.bezig')); i++) await wacht(200);
      const l4 = (await evalueer("fetch('/api/handelingen').then((r) => r.json()).then((j) => j.logs)"))[0];
      const r4 = (await evalueer(`fetch('/api/handelingen/${l4.id}').then((r) => r.text())`)).split('\n').filter(Boolean).map((r) => JSON.parse(r));
      ok(`de hotcue die bij het nummer terugkwam staat in het log (${JSON.stringify(r4.filter((r) => r.e === 'hotcues').map((r) => r.hotcues))})`,
        r4.some((r) => r.e === 'hotcues' && r.track === 2 && r.hotcues[0] === 4) && Math.abs(toen.pos - 4) < 0.01);
      // Iets anders op track 2, en terugspelen.
      await evalueer("window.engine.setFocus('B'); document.querySelector('#focus-deck .demo-btn').click()");
      for (let i = 0; i < 50 && !(await evalueer("window.engine.deck('B').title?.startsWith('demo')")); i++) await wacht(200);
      await evalueer("window.engine.deck('B').pause()");
      await evalueer("document.getElementById('terug-btn').click()");
      for (let i = 0; i < 25 && !(await evalueer(`!!document.querySelector('#log-lijst [data-speel="${l4.id}"]')`)); i++) await wacht(200);
      await evalueer(`document.querySelector('#log-lijst [data-speel="${l4.id}"]').click(); document.querySelector('#log-lijst [data-speel="${l4.id}"]').click()`);
      for (let i = 0; i < 25 && !(await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
      for (let i = 0; i < 60 && (await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
      const nu = await evalueer("({ titel: window.engine.deck('B').title, pos: window.engine.deck('B').position, hot: [...window.engine.deck('B').hotcues] })");
      ok(`teruggespeeld: de hotcue-knop sprong naar de bewaarde hotcue, zoals toen (${nu.pos.toFixed(2)} s, hotcues ${JSON.stringify(nu.hot)})`,
        !nu.titel.startsWith('demo') && nu.hot[0] === 4 && Math.abs(nu.pos - 4) < 0.05, JSON.stringify(nu));
      // Op de teruggespeelde track: hotcue 2 zetten en de toonsoort zetten.
      const toonVoor = await toonServer();
      await evalueer("__act.invoke('track.2.hotcue.2', true); __act.invoke('track.2.hotcue.2', false); __act.invoke('track.2.key', 0.5)");
      await wacht(2200);                            // bewaarlus 1,5 s, hotcues meteen
      const na = { hot: await hotcuesServer(), toon: await toonServer(), deckHot: await evalueer("window.engine.deck('B').hotcues[1]"),
        deckToon: await evalueer("window.engine.deck('B').toonKaart?.bron ?? null") };
      ok('op een teruggespeelde track gaan hotcues en toonsoort niet naar de library', na.hot === hotVoor && na.toon === toonVoor
        && na.deckHot !== null && na.deckToon === 'hand', `${hotVoor} -> ${na.hot} · ${toonVoor} -> ${na.toon} · deck ${na.deckHot}/${na.deckToon}`);
    }
  }
  ok('geen fouten rond het log', meldingen.length === 0, meldingen.join(' | '));
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
