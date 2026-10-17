// Hoeveel tekent VARVE op zijn canvassen als er niets gebeurt? (docs: CLAUDE.md, renderloop; 5 okt)
// Elke teken-actie op een canvas is een upload naar de GPU. In rust moet dat ~0 zijn: zonder de
// sleutel in waveform.js (zelfde()) was het ~29 Mpx/s en liep Demucs op de helft van zijn snelheid.
// Meet ook dat een sprong in stilstand WEL tekent en dat spelen de zoom elke frame tekent.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess, eigen server, tijdelijke database.
// Gebruik:  node tools/headless/tekenen.mjs     (poorten VARVE_KIJK_POORT 8823, VARVE_KIJK_DEBUG 9423)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const HAAK = "\n(() => {\n  const merk = (proto, namen, ctxNaar) => { for (const n of namen) { const o = proto[n]; if (!o) continue; proto[n] = function (...a) { const c = ctxNaar(this); if (c) c.__vuil = true; return o.apply(this, a); }; } };\n  merk(CanvasRenderingContext2D.prototype, ['fillRect','clearRect','strokeRect','drawImage','putImageData','fill','stroke','fillText','strokeText'], (x) => x.canvas);\n  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (P) merk(P.prototype, ['drawArrays','drawElements','clear'], (x) => x.canvas);\n  window.__canvas = new Map();\n  const tel = () => { for (const c of document.querySelectorAll('canvas')) { if (!c.__vuil) continue; c.__vuil = false;\n      const k = c.id || c.className || c.parentElement?.className || 'canvas'; const r = window.__canvas.get(k) || { px: 0, n: 0, w: c.width, h: c.height };\n      r.px += c.width * c.height; r.n++; r.w = c.width; r.h = c.height; window.__canvas.set(k, r); }\n    requestAnimationFrame(tel); };\n  requestAnimationFrame(tel);\n})();\n";
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8823, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9423;
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'varve-profiel-'));
// VARVE_CHROME zoals de andere headless-proeven (op de Mac niet nodig: dan de headless shell van Playwright).
function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const sub = readdirSync(join(cache, shell)).find((d) => existsSync(join(cache, shell, d, 'chrome-headless-shell')));
  return join(cache, shell, sub, 'chrome-headless-shell');
}
const chromePad = zoekChrome();
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'), VARVE_OPNAMES: join(tmp, 'opn'), VARVE_HERANALYSE: 'uit', VARVE_PATRONEN: join(tmp, 'pat') }, stdio: 'ignore' });
const browser = spawn(chromePad, [`--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required',
  // Headless knijpt requestAnimationFrame als de pagina nauwelijks verandert; een zichtbaar tabblad
  // loopt op de schermfrequentie. Zonder deze vlaggen meet je de headless-planner, niet VARVE.
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
let ws, volg = 0; const wachtend = new Map();
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, fout) => wachtend.set(id, { ok, fout })); };
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let verf = null;
let laatste = null;
async function meet(naam, sec = 5) {
  verf = new Map();
  await ev('(window.__canvas = new Map(), true)');
  const m0 = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await ev(`window.__fr = 0; if (!window.__frLoopt) { window.__frLoopt = true; (function t(){ window.__fr++; requestAnimationFrame(t); })(); } true`);
  await cdp('Profiler.start');
  await wacht(sec * 1000);
  const { profile } = await cdp('Profiler.stop');
  const m1 = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const fr = await ev('window.__fr');
  const lagen = [...verf.values()].sort((a, b) => b.px - a.px);
  const totaal = lagen.reduce((s, l) => s + l.px, 0);
  console.log(`\n[verf] ${(totaal / sec / 1e6).toFixed(1)} Mpx/s geverfd, ${lagen.reduce((s, l) => s + l.n, 0) / sec | 0} verfbeurten/s`);
  for (const l of lagen.slice(0, 6)) console.log(`   ${(l.px / sec / 1e6).toFixed(2).padStart(6)} Mpx/s  ${(l.n / sec).toFixed(0).padStart(4)}×/s  laag ${l.id} ${l.naam}`);
  verf = null;
  const cv = await ev('[...window.__canvas].map(([k, r]) => [k, r.px, r.n, r.w, r.h])');
  cv.sort((a, b) => b[1] - a[1]);
  console.log(`[canvas] ${(cv.reduce((s, x) => s + x[1], 0) / sec / 1e6).toFixed(1)} Mpx/s opnieuw getekend`);
  for (const [k, px, n, w, h] of cv.slice(0, 8)) console.log(`   ${(px / sec / 1e6).toFixed(2).padStart(6)} Mpx/s ${String((n / sec).toFixed(0)).padStart(4)}×/s ${w}×${h}  ${String(k).slice(0, 50)}`);
  laatste = { mpx: cv.reduce((s, x) => s + x[1], 0) / sec / 1e6, per: Object.fromEntries(cv.map(([k, px, n]) => [k, n / sec])) };
  const per = (k) => ((m1[k] - m0[k]) / sec * 1000).toFixed(0);
  // zelftijd per functie
  const zelf = new Map(); const dt = profile.timeDeltas; const ids = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => { const n = ids.get(id); const f = n.callFrame; const k = `${f.functionName || '(anoniem)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; zelf.set(k, (zelf.get(k) || 0) + (dt[i] || 0)); });
  const top = [...zelf].filter(([k]) => !/^\((idle|program|garbage collector|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`\n${naam}: ${(fr / sec).toFixed(0)} beelden/s · hoofdthread ${per('TaskDuration')} ms/s (script ${per('ScriptDuration')}, layout ${per('LayoutDuration')}, stijl ${per('RecalcStyleDuration')})`);
  for (const [k, us] of top) console.log(`   ${(us / 1000 / sec).toFixed(1).padStart(6)} ms/s  ${k}`);
}
try {
  let doelen = null; for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'LayerTree.layerPainted' && verf) { const { layerId, clip } = m.params; const l = verf.get(layerId) || { id: layerId, px: 0, n: 0, naam: '' }; l.px += clip.width * clip.height; l.n++; verf.set(layerId, l); } });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Performance.enable'); await cdp('Profiler.enable'); await cdp('DOM.enable'); await cdp('LayerTree.enable');
  await cdp('Profiler.setSamplingInterval', { interval: 500 });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' + HAAK });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await cdp('Page.bringToFront').catch(() => {});
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  for (let i = 0; i < 100; i++) { if (await ev('!!(window.engine && window.videoMixer)').catch(() => false)) break; await wacht(200); }
  await wacht(1500);
  await meet('leeg (niets geladen, audio niet gestart)');
  ok('in rust, niets geladen: de canvassen tekenen niet', laatste.mpx < 0.5, `${laatste.mpx.toFixed(2)} Mpx/s`);
  await ev(`(async () => { await window.engine.resume(); const { renderDemoTrack } = await import('/src/analysis/demo-track.js'); const e = window.engine; const b = renderDemoTrack(e.ctx, { bars: 32 }); await e.deck('A').laadGeheugen(b, 'demo A'); await e.deck('B').laadGeheugen(renderDemoTrack(e.ctx, { bars: 32 }), 'demo B'); return true; })()`);
  await wacht(1500);
  await meet('twee nummers geladen, stil');
  ok('in rust, twee nummers geladen: de canvassen tekenen niet', laatste.mpx < 0.5, `${laatste.mpx.toFixed(2)} Mpx/s`);
  await ev(`(window.engine.deck('A').seek(20), true)`);
  await meet('stil, na een sprong naar 20 s (moet één keer tekenen)', 2);
  ok('een sprong in stilstand tekent de zoom en het overzicht opnieuw', (laatste.per['wave-zoom'] || 0) > 0 && (laatste.per['wave-overview'] || 0) > 0);
  await ev(`(window.engine.deck('A').play(), true)`);
  await wacht(500);
  await meet('één nummer speelt');
  // Geen eis: in de headless shell van deze Mac knijpt Chrome requestAnimationFrame tijdens het
  // afspelen tot ~0,5 per seconde (gemeten 5 okt, ook op de code van vóór de sleutel). Dat spelen
  // tekent, volgt uit de sprong hierboven: een andere positie = een andere sleutel = tekenen.
  console.log(`      (ter info: de zoom tekende ${(laatste.per['wave-zoom'] || 0).toFixed(0)}×/s tijdens het spelen)`);
} catch (e) { console.error(e); uitkomst.push(['script', false]); } finally { try { ws?.close(); } catch {} browser.kill('SIGKILL'); server.kill('SIGINT'); await wacht(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
