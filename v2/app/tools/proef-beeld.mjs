/**
 * Proef van beeld (plak 4) in echte Chromium (headless), met een nep-engine op een echte AudioContext.
 *
 *   node tools/proef-beeld.mjs [--scherm uit.png]
 *
 * Wat hij meet:
 *   1. volgt de video wat je HOORT? Een testvideo (ffmpeg, VP9 in mp4, 30 fps, 60 s) draagt zijn eigen
 *      beeldnummer in elf zwart-witte blokken; na elk beeld van de mixer lezen we de pixels (in dezelfde
 *      taak) en vergelijken met plek(nu − vertraging) van de track op het moment van tekenen. Twee getallen:
 *      STUREN (video.currentTime, onze code: p95 binnen één beeld) en het BEELD dat geüpload wordt (met de
 *      decoder erbij: headless decodeert in software en loopt daar ~1 beeld achter, dus hier alleen de
 *      mediaan; de p95 op Metal meet de Mac, meting/MAC.md). Ook: hoe snel na een sprong (een hotcue 5 s
 *      verder) hij weer in de pas is.
 *   2. staat het beeld niet op zijn kop? Vier verschillend gekleurde kwarten (v1 kijk.mjs), zonder laag,
 *      met een vormlaag als canvas, met dezelfde laag als ImageBitmap (de weg van de Worker), en met een
 *      echte vorm in een Worker aan.
 *   3. zwart (vasthouden en schakelaar, precies 0), bevriezen (het beeldnummer staat stil, de video loopt
 *      door), clips uit (geen video meer in het beeld).
 *   4. het losse venster (beeld.html): openen met een klik, inloop, daarna mengt het ZELF (het hoofdvenster
 *      niet meer), daar ook in de pas, en zwart komt er ook aan.
 *   5. met de ECHTE engine (src/engine/engine.js + de audiolaag): laden geeft de video, hij volgt, en een
 *      dichte fader = geen beeld.
 * Omgeving: PROEF_MAAT=1280x720 (standaard 320x180: software-WebGL haalt op 1280 × 720 ~6 beelden/s),
 * PROEF_DUUR (s testvideo, standaard 60; bewaard in de tmp-map), PROEF_DIAG=1 (de eerste 40 beelden).
 * De server is een eigen kleine (statisch uit v2/app + de videoroute van src/beeld/server-video.mjs): de
 * echte server.mjs kent beeld.html en de route pas na de integratie.
 *
 * Playwright staat globaal op de machine; de app zelf heeft geen afhankelijkheden. Zonder ffmpeg: alleen
 * de proeven zonder video (oriëntatie met een canvas als video valt dan weg; hij zegt het).
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { videoRoute } from '../src/beeld/server-video.mjs';

const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;

const uitslag = [];
const ok = (naam, goed, detail = '') => { uitslag.push({ naam, goed: !!goed }); console.log(`${goed ? '  ok  ' : 'FOUT  '}${naam}${detail ? ` — ${detail}` : ''}`); };
const ms = (s) => `${(s * 1000).toFixed(1)} ms`;

// ---- de testvideo ---------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'varve-proef-beeld-'));
const media = join(tmp, 'media');
mkdirSync(join(media, 'proef'), { recursive: true });
writeFileSync(join(media, 'proef', 'audio.wav'), Buffer.alloc(44));
let heeftFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { heeftFfmpeg = false; }
const DUUR = Number(process.env.PROEF_DUUR || 60), FPS = 30;
if (heeftFfmpeg) {
  // Kwarten: linksboven rood, rechtsboven groen, linksonder blauw, rechtsonder geel. In het midden elf
  // blokken van 44 px: bit k van het beeldnummer N (wit = 1; tot 2047 = 68 s). geq rekent per pixel met N.
  const band = 'between(Y\\,156\\,203)*between(X\\,78\\,561)';
  const bit = '255*mod(floor(N/pow(2\\,floor((X-78)/44)))\\,2)';
  const r = `if(${band}\\,${bit}\\,if(lt(X\\,320)\\,if(lt(Y\\,180)\\,255\\,0)\\,if(lt(Y\\,180)\\,0\\,255)))`;
  const g = `if(${band}\\,${bit}\\,if(lt(X\\,320)\\,0\\,255))`;
  const b = `if(${band}\\,${bit}\\,if(lt(X\\,320)\\,if(lt(Y\\,180)\\,0\\,255)\\,0))`;
  const t0 = Date.now();
  // Onthouden tussen twee runs (geq rekent per pixel: ~30 s voor 40 s video).
  const bewaard = join(tmpdir(), `varve-proef-beeld-${DUUR}s-v2.mp4`);
  if (existsSync(bewaard)) writeFileSync(join(media, 'proef', 'video.mp4'), readFileSync(bewaard));
  else execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=black:s=640x360:r=${FPS}:d=${DUUR},format=rgb24,geq=r='${r}':g='${g}':b='${b}'`,
    // VP9 (Chromium speelt geen H.264), sleutelbeeld per seconde zodat de proef niet op de decoder wacht.
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-g', String(FPS), '-pix_fmt', 'yuv420p',
    '-f', 'mp4', join(media, 'proef', 'video.mp4')]);
  if (!existsSync(bewaard)) writeFileSync(bewaard, readFileSync(join(media, 'proef', 'video.mp4')));
  console.log(`testvideo: ${DUUR} s, ${FPS} fps, ${(statSync(join(media, 'proef', 'video.mp4')).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} else console.log('geen ffmpeg: de proeven met video vallen weg');

// ---- de proefpagina: een nep-engine op een echte AudioContext -------------------------------
// Het doek: software-WebGL (SwiftShader, 4 kernen) haalt op 1280 × 720 ~6 beelden/s, en dan zegt een
// syncmeting niets (v1 oogst beeld-039). Daarom standaard 320 × 180: dezelfde shaders en dezelfde weg,
// 16× minder pixels. PROEF_MAAT=1280x720 meet de echte maat (op de Mac, Metal: meting/MAC.md).
const [MB, MH] = (process.env.PROEF_MAAT || '320x180').split('x').map(Number);
const PROEF = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>proef beeld</title>
<link rel="stylesheet" href="/src/beeld/beeld.css">
<style>body{margin:0;background:#0d0e10;color:#e8eaed;font:12px system-ui;--vlak:#15171a;--vlak2:#1c1f23;--lijn:#2a2e34;--tekst:#e8eaed;--dim:#8a9099;--zwak:#5a6069;--cue:#f2a51a;--kill:#ef4b4f;--bg:#0d0e10;--r:4px}
#beeld{width:520px}</style></head><body><aside id="beeld"></aside>
<script type="module">
import { opzetBeeld } from '/src/beeld/opzet.js';
import { Bus } from '/src/kern/bus.js';
import { Klok } from '/src/kern/klok.js';
import { Emitter } from '/src/kern/emitter.js';
const MAAT = { breedte: ${MB}, hoogte: ${MH} };
const ctx = new AudioContext({ sampleRate: 48000 });
await ctx.resume();
// Een stille bron naar de uitgang, zodat de klok van de context echt loopt.
const o = ctx.createConstantSource(); const stil = ctx.createGain(); stil.gain.value = 0; o.connect(stil).connect(ctx.destination); o.start();
const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
class Track {
  constructor() { this.geladen = false; this.nummer = null; this.P0 = 0; this.T0 = 0; this.R = 1; this.loopt = false; }
  speeltOp(t) { return this.loopt && t >= this.T0; }
  get speelt() { return this.speeltOp(ctx.currentTime); }
  plek(t) { return this.speeltOp(t) ? this.P0 + (t - this.T0) * this.R : this.P0; }
  snelheid(t) { return this.speeltOp(t) ? this.R : 0; }
}
class NepEngine extends Emitter {
  constructor() { super(); this.ctx = ctx; this.klok = new Klok(); this.bus = new Bus(); this.tracks = Array.from({ length: 8 }, () => new Track()); this.mixer = { analyser: an }; this.versterking = new Array(8).fill(1); }
  track(n) { return this.tracks[n - 1]; }
  nu() { return ctx.currentTime; }
  vertraging() { return (ctx.outputLatency || 0) + (ctx.baseLatency || 0); }
  zaalVersterking(n) { return this.track(n).speelt ? this.versterking[n - 1] : 0; }
  meld(tekst, soort) { meldingen.push({ tekst, soort }); }
}
const meldingen = [];
const engine = new NepEngine();
const opzet = opzetBeeld({ engine, bus: engine.bus, paneel: document.getElementById('beeld'), doek: MAAT });
window.proef = { engine, opzet, meldingen, ctx };
</script></body></html>`;

// De tweede pagina: de ECHTE engine (src/engine/engine.js met de audiolaag van Chrome), om te zien dat
// beeld haar duck-typed goed leest: plek, snelheid, speeltOp, zaalVersterking, vertraging, 'laad'.
const ECHT = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>proef beeld (echte engine)</title></head>
<body><aside id="beeld" style="width:520px"></aside>
<script type="module">
import { opzetBeeld } from '/src/beeld/opzet.js';
import { Engine } from '/src/engine/engine.js';
import { maakAudio } from '/src/audio/index.js';
const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
await ctx.resume();
const engine = new Engine({ ctx, audio: maakAudio() });
const meldingen = [];
engine.on('melding', (m) => meldingen.push(m));
const opzet = opzetBeeld({ engine, paneel: document.getElementById('beeld'), doek: { breedte: ${MB}, hoogte: ${MH} } });
const sr = 48000, duur = 30, frames = duur * sr, PAGINA = 65536;
const nummer = { id: 'proef', titel: 'proef met video', duur, grid: null,
  haal: async () => ({ sr, kanalen: 2, frames, paginas: Array.from({ length: Math.ceil(frames / PAGINA) }, () => new Int16Array(PAGINA * 2)) }) };
window.proef = { engine, opzet, meldingen, nummer };
</script></body></html>`;

// ---- de server -----------------------------------------------------------------------------
const SOORT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const kop = (res, status, soort, extra = {}) => res.writeHead(status, {
  'content-type': soort, 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp', 'x-content-type-options': 'nosniff', ...extra,
});
const server = createServer(async (req, res) => {
  try {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (await videoRoute(req, res, { pad, audioPad: async (id) => (id === 'proef' ? join(media, 'proef', 'audio.wav') : null), kop })) return;
    if (pad === '/proef.html') { kop(res, 200, SOORT['.html']); return res.end(PROEF); }
    if (pad === '/echt.html') { kop(res, 200, SOORT['.html']); return res.end(ECHT); }
    if (pad === '/racks/sjablonen.json' && existsSync(join(APP, 'racks', 'sjablonen.json'))) { kop(res, 200, 'application/json'); return res.end(readFileSync(join(APP, 'racks', 'sjablonen.json'))); }
    if (/^\/(beeld\.html|src\/[\w/.-]+\.(js|css))$/.test(pad) && !pad.includes('..')) {
      const bestand = normalize(join(APP, pad));
      if (bestand.startsWith(APP + sep) && existsSync(bestand)) { kop(res, 200, SOORT[extname(bestand)]); return res.end(readFileSync(bestand)); }
    }
    kop(res, 404, 'text/plain'); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASIS = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const fouten = [];
const luister = (p, naam) => {
  p.on('pageerror', (e) => fouten.push(`${naam}: ${e}`));
  p.on('console', (m) => { if (m.type() === 'error') fouten.push(`${naam}: ${m.text()}`); });
};
luister(page, 'hoofd');

try {
  await page.goto(`${BASIS}/proef.html`);
  await page.waitForFunction(() => window.proef);
  const wg = await page.evaluate(() => window.proef.opzet.mixer.fout);
  ok('WebGL2 in de mixer', !wg, wg || '');

  const fps0 = await page.evaluate(() => new Promise((r) => { const a = window.proef.opzet.mixer.beelden; setTimeout(() => r(window.proef.opzet.mixer.beelden - a), 2000); }));
  console.log(`      leeg mengen: ${(fps0 / 2).toFixed(1)} beelden/s`);
  // In de pagina: per beeld het beeldnummer uit de blokken en de plek die je hoort.
  await page.evaluate(() => {
    const { opzet, engine } = window.proef;
    // Eén readPixels per beeld (elke readPixels wacht op de GPU): het hele doek, dan zelf indexeren.
    const BITS = 11;   // tot beeld 2047: 68 s op 30 fps
    window.proef.pixels = (m) => {
      const B = m.B, H = m.H, buf = m.leesPixels(0, 0, B, H);
      const px = (x, y) => { const i = ((H - 1 - Math.round(y * H / 360)) * B + Math.round(x * B / 640)) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
      let n = 0;
      for (let k = 0; k < BITS; k++) { const p = px(78 + k * 44 + 22, 180); if (p[0] + p[1] + p[2] > 384) n |= 1 << k; }
      const kwart = [[160, 60], [480, 60], [160, 300], [480, 300]].map(([x, y]) => px(x, y));
      return { n, kwart, midden: px(320, 150) };
    };
    window.proef.lees = (m, eng = engine) => {
      const { n, kwart, midden } = window.proef.pixels(m);
      const t = eng.track(1);
      // De plek die je hoorde op het moment dat dit beeld gemaakt werd (mixer.tekenNu): ctx.currentTime
      // loopt door terwijl een trage teken() rekent, video.currentTime staat binnen een taak stil.
      const doel = t.plek(m.tekenNu - m.tekenV);
      return { n, kwart, midden, doel, nu: m.tekenNu, ct: m.lagen[0]?.video.currentTime ?? null, pr: m.lagen[0]?.video.playbackRate ?? null, wand: performance.now() };
    };
    window.proef.reeks = [];
    opzet.api.naBeeld = (m) => { if (window.proef.reeks.length < 4000) window.proef.reeks.push(window.proef.lees(m)); };
  });
  const verzamel = async (n) => {
    await page.evaluate(() => { window.proef.reeks.length = 0; });
    await page.waitForFunction((n) => window.proef.reeks.length >= n, n, { timeout: 30000 });
    return page.evaluate(() => window.proef.reeks.slice());
  };
  const afstand = (r) => Math.max(0, r.n / 30 - r.doel, r.doel - (r.n + 1) / 30);   // tot het interval van dat beeld
  const p = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

  // ---- 1. volgen ----------------------------------------------------------------------
  if (heeftFfmpeg) {
    await page.evaluate(() => {
      const { engine } = window.proef;
      const t = engine.track(1);
      Object.assign(t, { geladen: true, nummer: { id: 'proef', titel: 'proef' }, P0: 2, T0: engine.nu() + 0.05, R: 1, loopt: true });
      engine.klok.start(t.T0, 0, 120);
      engine.emit('laad', { n: 1, stand: 'klaar', nummer: t.nummer });
    });
    await page.waitForFunction(() => window.proef.opzet.mixer.lagen[0]?.klaar, null, { timeout: 15000 });
    await page.waitForTimeout(3000);
    const r = await verzamel(150);
    const af = r.map(afstand), cen = r.map((x) => (x.n + 0.5) / 30 - x.doel);
    const v = await page.evaluate(() => ({ vertraging: window.proef.engine.vertraging(), seekDuur: window.proef.opzet.mixer.lagen[0].seekDuur, beelden: window.proef.opzet.mixer.beelden }));
    const fps = r.length / ((r.at(-1).wand - r[0].wand) / 1000);
    const vt = r.map((x) => x.ct - x.doel);
    if (process.env.PROEF_DIAG) console.log('      diag', r.slice(0, 40).map((x) => `${((x.ct - x.doel) * 1000).toFixed(0)}/${x.pr.toFixed(3)}/${((x.n + 0.5) / 30 - x.ct).toFixed(3)}`).join(' '));
    console.log(`      doek ${MB} × ${MH}, ${fps.toFixed(1)} beelden/s; currentTime − wat je hoort: mediaan ${ms(p(vt, 0.5))}`);
    console.log(`      vertraging ${ms(v.vertraging)}, seekduur ${ms(v.seekDuur)}; midden van het beeld − wat je hoort: mediaan ${ms(p(cen, 0.5))}, p5 ${ms(p(cen, 0.05))}, p95 ${ms(p(cen, 0.95))}`);
    // Twee dingen: STUREN (video.currentTime tegen wat je hoort: dat doet onze code) en het BEELD dat
    // geüpload wordt (de decoder erbij). Headless decodeert in software: het beeld loopt daar ~1 beeld
    // achter op currentTime, en meer als de machine druk is. De p95 van de pixels meet de Mac (MAC.md).
    ok('sturen: video.currentTime volgt wat je HOORT binnen één beeld (p95)', p(vt.map(Math.abs), 0.95) <= 1 / 30,
      `mediaan ${ms(p(vt, 0.5))}, p95 |·| ${ms(p(vt.map(Math.abs), 0.95))}`);
    ok('beeld: het geüploade beeld ligt in de mediaan binnen één beeld van wat je hoort', p(af, 0.5) <= 1 / 30,
      `${r.length} beelden: afstand tot het beeld mediaan ${ms(p(af, 0.5))}, p95 ${ms(p(af, 0.95))}, max ${ms(Math.max(...af))}`);

    // Sprong (een hotcue 5 s verder): hoe lang tot hij weer in de pas is?
    const t0 = await page.evaluate(() => { const { engine } = window.proef; const t = engine.track(1); const nu = engine.nu(); t.P0 = t.plek(nu) + 5; t.T0 = nu; return nu; });
    let terug = null;
    const tot = Date.now() + 10000;
    while (terug === null && Date.now() < tot) {
      const rr = await verzamel(6);
      if (rr.every((x) => Math.abs(x.ct - x.doel) <= 1 / 30)) terug = rr[0].nu - t0;
    }
    ok('na een sprong van 5 s stuurt hij weer binnen één beeld (6 beelden op rij)', terug !== null, terug !== null ? `na ${ms(terug)} (seekduur nu ${ms(await page.evaluate(() => window.proef.opzet.mixer.lagen[0].seekDuur))})` : 'niet binnen de proef');

    // ---- 2. oriëntatie ------------------------------------------------------------------
    const kleur = (c) => (c[0] > 150 && c[1] < 100 && c[2] < 100 ? 'rood' : c[0] < 100 && c[1] > 150 && c[2] < 100 ? 'groen'
      : c[0] < 100 && c[1] < 100 && c[2] > 150 ? 'blauw' : c[0] > 150 && c[1] > 150 && c[2] < 100 ? 'geel' : c[0] > 200 && c[1] > 200 && c[2] > 200 ? 'wit' : `(${c.join(',')})`);
    const kwarten = async () => (await verzamel(3)).at(-1).kwart.map(kleur);
    let k = await kwarten();
    ok('rechtop zonder laag: rood | groen boven, blauw | geel onder', k.join(' ') === 'rood groen blauw geel', k.join(' '));
    // Een vormlaag als CANVAS: achtergrond van een vorm (#07090c, wordt doorzichtig) met wit linksboven.
    await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d'); g.fillStyle = '#07090c'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.fillRect(40, 20, 240, 140);
      window.proef.marker = c;
      const l = window.proef.opzet.vormen.lagen[0];
      window.proef.echtFrame = l.frame;
      l.frame = () => c; l.aan = true; l.dekking = 1; l.mengvorm = 'screen';
    });
    k = await kwarten();
    ok('met een vormlaag (canvas): de laag linksboven, de video eronder nog rechtop', k.join(' ') === 'wit groen blauw geel', k.join(' '));
    await page.evaluate(async () => {
      const bm = await createImageBitmap(window.proef.marker);
      window.proef.opzet.vormen.lagen[0].frame = () => bm;
    });
    k = await kwarten();
    ok('met dezelfde laag als ImageBitmap (de weg van de Worker): ook rechtop', k.join(' ') === 'wit groen blauw geel', k.join(' '));
    await page.evaluate(() => { const l = window.proef.opzet.vormen.lagen[0]; l.frame = window.proef.echtFrame; l.aan = false; });
    // Een echte vorm in zijn Worker.
    await page.evaluate(() => { window.proef.engine.bus.doe('video.layer.select.2', true); window.proef.engine.bus.doe('video.layer.on', true); });
    await page.waitForTimeout(1500);
    const w = await page.evaluate(() => { const l = window.proef.opzet.vormen.lagen[1]; return { modus: l.modus, bitmap: !!l.beeld && typeof l.beeld.close === 'function', versie: l.versie, ms: l.ms, sys: l.sys.id }; });
    ok('een echte vorm draait in een Worker en levert ImageBitmaps', w.modus === 'werker' && w.bitmap && w.versie > 10, `${w.sys}: ${w.versie} beelden, ${w.ms?.toFixed?.(1)} ms per beeld, modus ${w.modus}`);
    k = await kwarten();
    ok('met de vorm aan blijft de video rechtop (de onderste kwarten)', k[2] === 'blauw' || k[3] === 'geel', k.join(' '));
    await page.evaluate(() => window.proef.engine.bus.doe('video.layer.on', true));

    // ---- 3. zwart, bevriezen, clips -------------------------------------------------------
    const bus = (id, v) => page.evaluate(([id, v]) => window.proef.engine.bus.doe(id, v), [id, v]);
    const som = (r) => r.kwart.flat().reduce((a, b) => a + b, 0) + r.midden.reduce((a, b) => a + b, 0);
    await bus('video.black.hold', true);
    let rr = await verzamel(3);
    ok('zwart vasthouden: meteen precies 0', rr.every((x) => som(x) === 0), `som ${rr.map(som).join(', ')}`);
    await bus('video.black.hold', false);
    rr = await verzamel(2);
    ok('loslaten: meteen weer beeld', som(rr.at(-1)) > 0);
    await bus('video.black', true);
    await page.waitForTimeout(320);
    rr = await verzamel(3);
    ok('zwart (schakelaar) na 250 ms: precies 0', rr.every((x) => som(x) === 0));
    await bus('video.black', true);
    await page.waitForTimeout(320);
    rr = await verzamel(2);
    ok('zwart uit: weer beeld', som(rr.at(-1)) > 0);
    const voor = await page.evaluate(() => window.proef.opzet.mixer.lagen[0].video.currentTime);
    await bus('video.freeze', true);
    rr = await verzamel(30);
    const na = await page.evaluate(() => window.proef.opzet.mixer.lagen[0].video.currentTime);
    const nummers = [...new Set(rr.slice(1).map((x) => x.n))];
    ok('bevriezen: het beeldnummer staat stil, de video loopt door', nummers.length === 1 && na - voor > 0.3, `nummers ${nummers.join(',')}, video +${(na - voor).toFixed(2)} s`);
    await bus('video.freeze', true);
    rr = await verzamel(20);
    ok('los: hij stuurt meteen weer (binnen één beeld)', Math.abs(rr.at(-1).ct - rr.at(-1).doel) <= 1 / 30, `currentTime − doel ${ms(rr.at(-1).ct - rr.at(-1).doel)}, beeld ${ms(afstand(rr.at(-1)))}`);
    await bus('video.clips', true);
    rr = await verzamel(5);
    const zonder = rr.at(-1).kwart.map(kleur);
    const gepauzeerd = await page.evaluate(() => window.proef.opzet.mixer.lagen[0].video.paused);
    ok('clips uit: geen deck-video meer in het beeld, en hij is gepauzeerd', !zonder.some((x) => ['rood', 'groen', 'blauw', 'geel'].includes(x)) && gepauzeerd, zonder.join(' '));
    await bus('video.clips', true);
    await verzamel(5);

    // ---- 4. het losse venster ----------------------------------------------------------------
    // Terug naar het begin van de testvideo (een trage machine is anders voorbij het einde).
    await page.evaluate(() => { const { engine } = window.proef; const t = engine.track(1); t.P0 = 3; t.T0 = engine.nu(); });
    await page.waitForTimeout(1500);
    const [los] = await Promise.all([context.waitForEvent('page'), page.click('[data-beeld-knop="los"]')]);
    luister(los, 'los');
    const geopend = Date.now();
    await los.waitForFunction(() => window.beeldMixer, null, { timeout: 15000 });
    await los.evaluate(() => {
      const m = window.beeldMixer;
      const teken = m.teken.bind(m);
      window.reeks = [];
      m.teken = (e, b) => {
        teken(e, b);
        const B = m.B, H = m.H, buf = m.leesPixels(0, 0, B, H);
        let n = 0;
        for (let k = 0; k < 11; k++) {
          const i = ((H - 1 - Math.round(180 * H / 360)) * B + Math.round((78 + k * 44 + 22) * B / 640)) * 4;
          if (buf[i] + buf[i + 1] + buf[i + 2] > 384) n |= 1 << k;
        }
        const t = e.track(1);
        let som = 0;
        for (let i = 0; i < buf.length; i += 4 * 97) som += buf[i] + buf[i + 1] + buf[i + 2];
        if (window.reeks.length < 4000) window.reeks.push({ n, som, doel: t.plek(m.tekenNu - m.tekenV), ct: m.lagen[0]?.video.currentTime ?? 0, wand: performance.now() });
      };
    });
    await page.waitForFunction(() => { const b = window.proef.opzet.beamer; const l = b.levend(); return l && window.proef.opzet.api.rolLos(l.venster) === 'mengt'; }, null, { timeout: 30000 });
    const inloop = (Date.now() - geopend) / 1000;
    const tel = () => Promise.all([page.evaluate(() => window.proef.opzet.mixer.beelden), los.evaluate(() => window.beeldMixer.beelden)]);
    const [h0, l0] = await tel();
    await page.waitForTimeout(1500);
    const [h1, l1] = await tel();
    ok('het losse venster mengt ZELF na de inloop; het hoofdvenster mengt niet meer', l1 - l0 > 10 && h1 === h0, `inloop ${inloop.toFixed(1)} s; in 1,5 s: los +${l1 - l0} beelden, hoofd +${h1 - h0}`);
    await los.evaluate(() => { window.reeks.length = 0; });
    await los.waitForFunction(() => window.reeks.length >= 90, null, { timeout: 20000 });
    const lr = await los.evaluate(() => window.reeks.slice());
    const laf = lr.map(afstand);
    console.log(`      los venster: ${(lr.length / ((lr.at(-1).wand - lr[0].wand) / 1000)).toFixed(1)} beelden/s; currentTime − wat je hoort: mediaan ${ms(p(lr.map((x) => x.ct - x.doel), 0.5))}; beeld − currentTime: mediaan ${ms(p(lr.map((x) => (x.n + 0.5) / 30 - x.ct), 0.5))}`);
    const lvt = lr.map((x) => Math.abs(x.ct - x.doel));
    ok('los venster, sturen: currentTime binnen één beeld van wat je hoort (p95)', p(lvt, 0.95) <= 1 / 30, `p95 ${ms(p(lvt, 0.95))}`);
    ok('los venster, beeld: in de mediaan binnen één beeld', p(laf, 0.5) <= 1 / 30, `${lr.length} beelden: mediaan ${ms(p(laf, 0.5))}, p95 ${ms(p(laf, 0.95))}, max ${ms(Math.max(...laf))}`);
    const voorbeeld = await page.evaluate(() => !!document.querySelector('.beeld-voorbeeld').srcObject);
    ok('het paneel toont het beeld van het losse venster (voorbeeld)', voorbeeld);
    await bus('video.black.hold', true);
    await los.evaluate(() => { window.reeks.length = 0; });
    await los.waitForFunction(() => window.reeks.length >= 3, null, { timeout: 10000 });
    const losZwart = await los.evaluate(() => window.reeks.map((x) => x.som));
    ok('zwart bereikt het losse venster: daar ook precies 0 (het leest dezelfde stand)', losZwart.every((x) => x === 0), `som ${losZwart.join(', ')}`);
    await bus('video.black.hold', false);
    if (schermPad) await page.screenshot({ path: schermPad });
    await los.close();
    await page.waitForTimeout(300);
    const terugHoofd = await page.evaluate(() => { const a = window.proef.opzet.mixer.beelden; return new Promise((r) => setTimeout(() => r(window.proef.opzet.mixer.beelden - a), 500)); });
    ok('los venster dicht: het hoofdvenster mengt weer', terugHoofd > 5, `+${terugHoofd} beelden in 0,5 s`);

    // ---- 5. met de echte engine ---------------------------------------------------------------
    const echt = await context.newPage();
    luister(echt, 'echt');
    await echt.goto(`${BASIS}/echt.html`);
    await echt.waitForFunction(() => window.proef?.engine);
    const geladen = await echt.evaluate(async () => {
      const { engine, nummer, opzet } = window.proef;
      const ok = await engine.laad(1, nummer);
      engine.bus.doe('track.1.play', true); engine.bus.doe('track.1.play', false);
      window.proef.reeks = [];
      opzet.api.naBeeld = (m) => {
        const t = engine.track(1);
        if (window.proef.reeks.length < 4000) window.proef.reeks.push({ doel: t.plek(m.tekenNu - m.tekenV), ct: m.lagen[0]?.video.currentTime ?? null, paused: m.lagen[0]?.video.paused ?? null, w: m._w[0] });
      };
      return ok;
    });
    await echt.waitForFunction(() => window.proef.opzet.mixer.lagen[0]?.klaar, null, { timeout: 15000 }).catch(() => {});
    await echt.waitForTimeout(2500);
    await echt.evaluate(() => { window.proef.reeks.length = 0; });
    await echt.waitForFunction(() => window.proef.reeks.length >= 60, null, { timeout: 20000 });
    const er = await echt.evaluate(() => window.proef.reeks.slice());
    const ev = er.map((x) => Math.abs(x.ct - x.doel));
    ok('echte engine: laden geeft de track zijn video (HEAD op de route), en hij volgt de plek die je hoort',
      geladen && er.every((x) => x.ct !== null) && p(ev, 0.95) <= 1 / 30, `currentTime − doel: mediaan ${ms(p(ev, 0.5))}, p95 ${ms(p(ev, 0.95))}; gewicht ${er.at(-1).w.toFixed(3)} (fader 1 × crossfader in het midden, kant A)`);
    await echt.evaluate(() => { window.proef.engine.bus.doe('track.1.fader', 0); });
    await echt.waitForTimeout(400);
    const dicht = await echt.evaluate(() => window.proef.reeks.at(-1));
    ok('echte engine: fader dicht = gewicht 0 en de video gepauzeerd (wat je hoort, zie je)', dicht.w === 0 && dicht.paused === true);
    const echtMeld = await echt.evaluate(() => window.proef.meldingen.filter((m) => m.soort === 'fout').map((m) => m.tekst));
    ok('echte engine: geen foutmeldingen', echtMeld.length === 0, echtMeld.join(' | '));
    await echt.close();
  } else if (schermPad) await page.screenshot({ path: schermPad });

  const echteFouten = fouten.filter((f) => !/favicon/.test(f));
  ok('geen fouten in de console of de pagina', echteFouten.length === 0, echteFouten.slice(0, 5).join(' | '));
  const meldingen = await page.evaluate(() => window.proef.meldingen);
  if (meldingen.length) console.log('      meldingen:', meldingen.map((m) => `${m.soort}: ${m.tekst}`).join(' | '));
} catch (e) {
  ok('de proef liep door', false, e.message.split('\n')[0]);
  if (fouten.length) console.log('      fouten:', fouten.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
const fout = uitslag.filter((u) => !u.goed).length;
console.log(`\n${uitslag.length - fout} van ${uitslag.length} goed`);
process.exit(fout ? 1 : 0);
