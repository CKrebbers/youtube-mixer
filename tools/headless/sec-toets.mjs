// Secties op het toetsenbord, headless in echte Chrome (TASKS-SECTIES, Verweven 5):
// shift+W/E = vorige/volgende sectie van de track met focus (linkerhand),
// shift+I/O = vorige/volgende sectie van de rechterhand (de vorige focus).
// Echte toetsaanslagen via CDP (Input.dispatchKeyEvent, met shift ingedrukt),
// geen invoke.
//
// Opzet zoals secties.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database en mediamap, de nep-yt-dlp met het synthetische nummer
// (test/synth-nummer.mjs: zeven secties op 124 bpm) en de nep-splitter. Hetzelfde
// nummer op track 1 (focus) en track 3 (de rechterhand: focus eerst op 3, dan
// terug naar 1). Geen netwerk, geen MIDI (Chromium zonder requestMIDIAccess).
//
// Gebruik:  node tools/headless/sec-toets.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8907) en VARVE_KIJK_DEBUG (9507). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { maakNepStems } from '../../test/nep-stems.mjs';
import { synthNummer } from '../../test/synth-nummer.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8907, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9507;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-toets-'));
mkdirSync(UIT, { recursive: true });

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Het synthetische nummer als stereo WAV op 48 kHz: dat wordt de "download".
const s = synthNummer({ sr: 48000 });
{
  const n = s.mix.length, y = new Int16Array(n * 2);
  let piek = 1e-9;
  for (const x of s.mix) piek = Math.max(piek, Math.abs(x));
  for (let i = 0; i < n; i++) y[2 * i] = y[2 * i + 1] = Math.round(32767 * 0.8 * s.mix[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22);
  kop.writeUInt32LE(48000, 24); kop.writeUInt32LE(48000 * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  writeFileSync(join(tmp, 'bron.wav'), Buffer.concat([kop, Buffer.from(y.buffer)]));
}
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'),
    NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080',
  '--autoplay-policy=no-user-gesture-required', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
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
async function maat(b, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: b, height: h, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
}
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(100); }
  return false;
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
const druk = (id) => act(`(a.invoke(${JSON.stringify(id)}, true), a.invoke(${JSON.stringify(id)}, false))`);
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;

// Een echte toetsaanslag zoals een toetsenbord hem geeft: shift omlaag, de
// letter omlaag en weer op, shift op. Modifiers 8 = shift.
const TOETS = { KeyW: ['w', 87], KeyE: ['e', 69], KeyI: ['i', 73], KeyO: ['o', 79], Slash: ['/', 191], Escape: ['Escape', 27] };
async function toets(code, shift = false) {
  const [klein, vk] = TOETS[code];
  const key = shift && klein.length === 1 ? klein.toUpperCase() : klein;
  const mods = shift ? 8 : 0;
  const tekst = key.length === 1 ? { text: key, unmodifiedText: klein } : {};
  if (shift) await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 8, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mods, key, code, windowsVirtualKeyCode: vk, ...tekst });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mods, key, code, windowsVirtualKeyCode: vk });
  if (shift) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 0, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
}

const deck = (id) => `window.engine.deck(${JSON.stringify(id)})`;
const opDeMaat = (id) => evalueer(`${deck(id)}.sectieOpDeMaat`);
const meldtekst = () => evalueer("document.getElementById('meldingen').textContent");

/**
 * Was de laatste sprong van dit deck op de maat? Dezelfde plek in de maat als
 * waar hij vandaan kwam (fasebehoudend), en hij landde precies zo ver vóór de
 * "1" van de sectie als hij van zijn volgende "1" af zat (de aanloop: de sectie
 * valt in op de maatstreep). Op de "1" zelf: meteen erin (SECTIES.md §3).
 */
async function sprongOpDeMaat(id, i) {
  return evalueer(`(() => {
    const d = ${deck(id)}, g = d.grid, sp = window.__sprongen.filter((x) => x.id === ${JSON.stringify(id)}).at(-1);
    if (!g || !sp) return { ok: false, waarom: g ? 'geen sprong' : 'geen grid' };
    const van = d.sectieKaart.begin(${i}), bpb = g.beatsPerBar;
    const fase = (t) => g.barPhase(t);
    const dFase = Math.abs(fase(sp.naar) - fase(sp.voor)), fasefout = Math.min(dFase, 1 - dFase);
    const tellenTotDeEen = g.beatAt(van) - g.beatAt(sp.naar);
    const vanOpDeEen = Math.min(fase(van), 1 - fase(van));
    // Zo ver vóór haar "1" als je van de volgende "1" af zat; op de "1" zelf: erin, met de fase in de tel.
    const tellenVoor = fase(sp.voor) * bpb, verwacht = tellenVoor < 0.02 ? -tellenVoor : bpb - tellenVoor;
    return { ok: fasefout < 0.01 && vanOpDeEen < 0.01 && Math.abs(tellenTotDeEen - verwacht) < 0.01,
      voor: +sp.voor.toFixed(3), naar: +sp.naar.toFixed(3), van: +van.toFixed(3), aanloop: +tellenTotDeEen.toFixed(3),
      verwacht: +verwacht.toFixed(3), fasefout: +fasefout.toFixed(4) };
  })()`);
}

async function doorloop() {
  await evalueer('document.activeElement?.blur?.()');

  console.log('zonder nummer: geen stille weigering');
  ok('track 1 en track 2 zijn leeg', await evalueer(`!${deck('A')}.buffer && !${deck('B')}.buffer`));
  await toets('KeyE', true);
  ok('shift+E: een melding (track 1 is leeg)', await totdat("document.getElementById('meldingen').textContent.includes('track 1 is leeg')", 3000), await meldtekst());
  await toets('KeyO', true);
  ok('shift+O: een melding voor de rechterhand (track 2 is leeg)', await totdat("document.getElementById('meldingen').textContent.includes('track 2 is leeg')", 3000));

  console.log('\nde helpkaart');
  await toets('Slash');
  ok('/ opent de toetsenkaart', await totdat("!document.getElementById('help').classList.contains('hidden')", 3000));
  const help = await evalueer("document.querySelector('#help .help-card').innerText");
  const regel = (t) => help.split('\n').find((r) => r.includes(t)) ?? '';
  ok(`links: shift+W / E vorige · volgende sectie (${regel('shift+W / E').replace(/\s+/g, ' ')})`, /vorige · volgende sectie/.test(regel('shift+W / E')));
  ok(`rechts: shift+I / O vorige · volgende sectie (${regel('shift+I / O').replace(/\s+/g, ' ')})`, /vorige · volgende sectie/.test(regel('shift+I / O')));
  await maat(1440, 790);
  await foto('sec-toets-help-1440.png');
  await toets('Escape');
  ok('Esc sluit hem', await totdat("document.getElementById('help').classList.contains('hidden')", 3000));

  console.log('\nbinnenhalen en laden: track 1 en track 3');
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=secToets';
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok('het nummer staat in de lijst', await totdat(rij('secToets'), 90000));
  await evalueer(`${rij('secToets')}.querySelector('button[data-deck="A"]').click()`);
  ok('op track 1', await totdat(`${deck('A')}.duration > 150`, 30000));
  ok('track 1 heeft secties', await totdat(`${deck('A')}.sectieKaart?.aantal >= 6`, 60000));
  await totdat(`!${rij('secToets')}.querySelector('button[data-deck="C"]').disabled`, 10000);
  await evalueer(`${rij('secToets')}.querySelector('button[data-deck="C"]').click()`);
  ok('op track 3', await totdat(`${deck('C')}.duration > 150`, 30000));
  ok('track 3 heeft secties', await totdat(`${deck('C')}.sectieKaart?.aantal >= 6`, 60000));
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer('document.activeElement?.blur?.()');
  const k = await evalueer(`${deck('A')}.sectieKaart.stukken.map((x, i) => (+x.van.toFixed(2)) + 's ' + ${deck('A')}.sectieKaart.naam(i))`);
  console.log('      ' + k.join(' · '));
  console.log('      grid: ' + (await evalueer(`${deck('A')}.grid.strook(${deck('A')}.duration).map((x) => x.van.toFixed(2) + '–' + x.tot.toFixed(2) + ' ' + x.soort).join(' · ')`)));

  // Rechterhand = de vorige focus: eerst focus op track 3, dan terug naar 1.
  await evalueer("window.engine.setFocus('C')");
  await wacht(200);
  await evalueer("window.engine.setFocus('A')");
  await wacht(200);
  ok('focus op track 1 (linkerhand), track 3 was de vorige (rechterhand)', await evalueer("window.engine.focus === 'A'"));

  // Secties waarvan het begin in een ZEKER stuk van het grid ligt: anders springt de
  // action naar het begin zelf, niet op de maat (SECTIES.md §3; zie de grid-regel hierboven).
  console.log('\nspelen: track 1 in sectie 4, track 3 in sectie 5');
  await druk('track.1.section.4');
  await druk('track.3.section.5');
  await druk('track.1.play');
  await druk('track.3.play');
  ok('beide spelen', await totdat(`${deck('A')}.playing && ${deck('C')}.playing && ${deck('A')}.sectieHier === 3 && ${deck('C')}.sectieHier === 4`, 15000),
    JSON.stringify(await evalueer(`[${deck('A')}.sectieHier, ${deck('C')}.sectieHier]`)));
  await wacht(700);   // midden in een maat, niet op de "1"

  // Elke sprong vastleggen: waar hij vandaan kwam en waarheen (alleen kijken).
  await evalueer(`(() => { window.__sprongen = [];
    for (const id of ['A', 'C']) { const d = window.engine.deck(id), seek = d.seek.bind(d);
      d.seek = (t, o) => { window.__sprongen.push({ id, voor: d.position, naar: t, doorlopend: !!o?.doorlopend }); return seek(t, o); }; } })()`);

  console.log('\nlinkerhand: shift+E en shift+W');
  const c0 = await opDeMaat('C');
  await toets('KeyE', true);
  ok('shift+E: track 1 gaat naar sectie 5', await totdat(`${deck('A')}.sectieOpDeMaat === 4`, 2000), String(await opDeMaat('A')));
  const e = await sprongOpDeMaat('A', 4);
  ok('… op de maat: dezelfde plek in de maat, sectie 5 valt in op de volgende "1"', e.ok, JSON.stringify(e));
  ok('… en je hoort hem binnen een maat', await totdat(`${deck('A')}.sectieHier === 4`, 3000));
  ok('… track 3 blijft waar hij was', await opDeMaat('C') === c0 && await evalueer(`window.__sprongen.filter((x) => x.id === 'C').length === 0`));
  await wacht(500);
  await toets('KeyW', true);
  ok('shift+W: track 1 terug naar sectie 4', await totdat(`${deck('A')}.sectieOpDeMaat === 3`, 2000), String(await opDeMaat('A')));
  const w = await sprongOpDeMaat('A', 3);
  ok('… ook op de maat', w.ok, JSON.stringify(w));
  ok('… en je hoort hem binnen een maat; hij speelt door (geen cue)', await totdat(`${deck('A')}.sectieHier === 3 && ${deck('A')}.playing`, 3000));

  console.log('\nrechterhand: shift+O en shift+I');
  const a0 = await opDeMaat('A'), nA = await evalueer("window.__sprongen.filter((x) => x.id === 'A').length");
  await wacht(300);
  await toets('KeyO', true);
  ok('shift+O: track 3 gaat naar sectie 6', await totdat(`${deck('C')}.sectieOpDeMaat === 5`, 2000), String(await opDeMaat('C')));
  const o = await sprongOpDeMaat('C', 5);
  ok('… op de maat', o.ok, JSON.stringify(o));
  ok('… en je hoort hem binnen een maat', await totdat(`${deck('C')}.sectieHier === 5`, 3000));
  ok('… track 1 blijft waar hij was', await opDeMaat('A') === a0 && await evalueer(`window.__sprongen.filter((x) => x.id === 'A').length === ${nA}`));
  await wacht(500);
  await toets('KeyI', true);
  ok('shift+I: track 3 terug naar sectie 5', await totdat(`${deck('C')}.sectieOpDeMaat === 4`, 2000), String(await opDeMaat('C')));
  const i = await sprongOpDeMaat('C', 4);
  ok('… op de maat', i.ok, JSON.stringify(i));
  ok('… en hij wisselt de focus niet (I zonder shift doet dat wel)', await evalueer("window.engine.focus === 'A'"));
  ok('elke sprong was doorlopend (fasebehoudend, geen gat)', await evalueer('window.__sprongen.length === 4 && window.__sprongen.every((x) => x.doorlopend)'),
    String(await evalueer('window.__sprongen.length')));

  await druk('layer.grid.secties');
  await wacht(800);
  await foto('sec-toets-spelend-1440.png');
  await druk('track.1.play');
  await druk('track.3.play');
}

try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
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
  await maat(1440, 790);
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer', 20000));
  await doorloop();
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
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
