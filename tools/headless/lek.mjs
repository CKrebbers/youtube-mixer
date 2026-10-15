// Lekt de opname geheugen? (docs/WINST.md punt 1, verslag 2026-10-14/winst-snel.md)
//
// Een echte mixer in een headless Chromium, met één nummer geladen dat NIET
// speelt, en een opname die loopt (WAV-stukken elke seconde, het
// handelingenlog erbij, de status naar de server elke 900 ms). Elke 15 s het
// geheugen (RSS) van de renderer; aan het eind een GC (hoofdthread én
// AudioWorklet) en nog eens. Voor de fix groeide de renderer ~23 MB per
// minuut en kwam dat na GC niet terug; erna hoort hij na GC terug te zijn op
// waar hij begon.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad, eigen
// server op een eigen poort, alles in een tijdelijke map.
//
// Gebruik:  node tools/headless/lek.mjs
//   PROEF            welke lange set (standaard opname):
//                    opname  de opname loopt VARVE_LEK_S seconden (deck stil)
//                    laad    VARVE_LEK_N keer (standaard 60) een library-nummer
//                            laden en spelen, om en om op track 1 en 2, keylock
//                            om de beurt aan (spoor A, 15 okt)
//                    wissel  VARVE_LEK_N keer (standaard 50) op track 1 een
//                            instrument (poly en schaal om en om) en daarna weer
//                            een nummer met keylock dat speelt: elke wissel
//                            ruimt een StreamBron op (deck.leeg -> vernietig)
//                    Bij laad en wissel geldt een EIS: de renderer na GC hooguit
//                    VARVE_LEK_MB (standaard 20) MB boven het begin, anders exit 1.
//                    Op Linux het PRIVÉ geheugen (Anonymous, /proc/<pid>/smaps_rollup),
//                    elders RSS; RSS telt gedeelde code van Chrome mee die pas laat
//                    voor het eerst draait.
//                    Het begin wordt gemeten na VARVE_LEK_OPWARM (standaard 4)
//                    stappen: eenmalige kosten (WASM, modules, caches) zijn geen lek.
//   VARVE_LEK_S      hoe lang de opname loopt in seconden (standaard 300)
//   VARVE_CODE       een andere checkout om te meten (de server en de pagina
//                    komen daarvandaan; zo meet je vóór en na met hetzelfde script)
//   VARVE_KIJK_POORT / VARVE_KIJK_DEBUG  poorten (standaard 8881 / 9381)
//   VARVE_CHROME     Chromium; anders de headless shell uit de Playwright-cache
//                    (macOS), anders chromium / google-chrome op het pad.
// Uitvoer: één regel per meting en een samenvatting met de groei per minuut.
// Het geheugen komt uit `ps` (Linux en macOS): de som van alle renderers.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = process.env.VARVE_CODE || fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8881, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9381;
const B = `http://localhost:${POORT}`;
const DUUR_S = Number(process.env.VARVE_LEK_S) || 300;
const PROEF = process.env.PROEF || 'opname';
if (!['opname', 'laad', 'wissel'].includes(PROEF)) { console.error(`onbekende PROEF ${PROEF} (opname, laad of wissel)`); process.exit(2); }
const N = Number(process.env.VARVE_LEK_N) || (PROEF === 'laad' ? 60 : 50);
const EIS_MB = Number(process.env.VARVE_LEK_MB) || 20;
const OPWARM = process.env.VARVE_LEK_OPWARM != null ? Number(process.env.VARVE_LEK_OPWARM) : 4;
const tmp = mkdtempSync(join(tmpdir(), 'varve-lek-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] ${a.join(' ')}`);

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: /headless.shell/.test(process.env.VARVE_CHROME) };
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (shell) {
      const map = join(cache, shell);
      const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
      if (sub) return { pad: join(map, sub, 'chrome-headless-shell'), shell: true };
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return { pad: execFileSync('which', [naam], { encoding: 'utf8' }).trim(), shell: false }; } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'), VARVE_HERANALYSE: 'uit',
    VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_SETS: join(tmp, 'sets'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes') },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', 'about:blank',
], { stdio: 'ignore' });

/** RSS per procestype (MB) van alles onder de gestarte browser, via ps. */
function geheugen() {
  let uit;
  try { uit = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,args='], { encoding: 'utf8', maxBuffer: 1 << 24 }); } catch (_) { return null; }
  const rijen = uit.split('\n').map((r) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(r)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], rss: +m[3] / 1024, args: m[4] }));
  const boom = new Set([browser.pid]);
  for (let groei = true; groei;) { groei = false; for (const r of rijen) if (boom.has(r.ppid) && !boom.has(r.pid)) { boom.add(r.pid); groei = true; } }
  const per = {};
  for (const r of rijen) if (boom.has(r.pid)) { const t = /--type=([\w-]+)/.exec(r.args)?.[1] ?? 'browser'; per[t] = Math.round((per[t] ?? 0) + r.rss); }
  // Linux: ook het PRIVÉ geheugen van de renderers (Anonymous uit smaps_rollup). RSS telt de
  // gedeelde, onveranderde bladzijden van Chrome zelf mee (code die pas laat voor het eerst
  // draait: gemeten +45 MB "Shared_Clean" rond stap 20, daarna vlak), en dat is geen lek.
  let prive = 0, gelezen = false;
  for (const r of rijen) {
    if (!boom.has(r.pid) || !/--type=renderer/.test(r.args)) continue;
    try {
      const m = /^Anonymous:\s+(\d+)/m.exec(readFileSync(`/proc/${r.pid}/smaps_rollup`, 'utf8'));
      if (m) { prive += +m[1] / 1024; gelezen = true; }
    } catch (_) {}
  }
  if (gelezen) per['renderer-privé'] = Math.round(prive);
  return per;
}

let ws, volg = 0;
const wachtend = new Map();
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

let code = 1;
try {
  let lijst = null;
  for (let i = 0; i < 100 && !lijst?.find?.((x) => x.type === 'page'); i++) { await wacht(200); lijst = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(lijst.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const x = wachtend.get(m.id); wachtend.delete(m.id); m.error ? x.f(new Error(m.error.message)) : x.ok(m.result); }
    if (m.method === 'Inspector.targetCrashed') log('RENDERER GECRASHT');
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Inspector.enable').catch(() => {});
  // Geen MIDI in dit tabblad: veilig met de APC aangesloten.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  for (let i = 0; i < 100; i++) { if (await fetch(`${B}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // Nummers van 60 s, via de upload-route (dezelfde pijplijn als altijd): één
  // voor de opname, drie voor laad en wissel (een ander nummer = echt laden).
  const nummers = [];
  const toonHz = PROEF === 'opname' ? [55] : [55, 62, 73];
  for (const [k, hz] of toonHz.entries()) {
    const pad = join(tmp, `n${k}.wav`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=0.6*sin(2*PI*${hz}*t)*exp(-12*mod(t\\,0.483871))+0.2*sin(2*PI*330*t):s=48000:d=60`, '-ac', '2', '-c:a', 'pcm_s16le', pad]);
    const up = await fetch(`${B}/api/upload?naam=lek${k}.wav&video=0&titel=lek${k}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: readFileSync(pad) }).then((r) => r.json());
    let nr = null;
    for (let i = 0; i < 2400 && !nr; i++) {
      await wacht(250);
      const o = (await fetch(`${B}/api/ingest`).then((r) => r.json())).opdrachten.find((x) => x.id === up.id);
      if (o?.status === 'klaar') nr = o.track.id;
      if (o?.status === 'mislukt') throw new Error('ingest mislukt');
    }
    nummers.push(nr);
  }
  const nr = nummers[0];

  await cdp('Page.navigate', { url: `${B}/?vormen=0` });
  for (let i = 0; i < 200; i++) { if (await ev('!!(window.engine && window.library)').catch(() => false)) break; await wacht(100); }
  await wacht(1500);
  await ev('window.engine.resume()');
  await ev(`(async () => { window.__a = await import('/src/control/actions.js'); const { track } = await (await fetch('/api/library/${nr}')).json(); await window.library.onLaad('A', track); __a.invoke('track.1.fader', 0.8); })()`);
  // Een GC-knop IN de AudioWorkletGlobalScope (alle modules van een context delen die scope).
  await ev(`(async () => {
    const src = "registerProcessor('gc-knop', class extends AudioWorkletProcessor { constructor() { super(); this.port.onmessage = () => { if (typeof gc === 'function') gc(); this.port.postMessage(1); }; } process() { return true; } });";
    await window.engine.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    window.__gcNode = new AudioWorkletNode(window.engine.ctx, 'gc-knop');
    window.__gcWorklet = () => new Promise((ok) => { window.__gcNode.port.onmessage = (e) => ok(e.data); window.__gcNode.port.postMessage(1); });
  })()`);
  const hoofdHeap = async () => { const h = await cdp('Runtime.getHeapUsage').catch(() => null); return h ? Math.round(h.usedSize / 1048576) : NaN; };
  const gc = async () => { await ev('window.__gcWorklet()'); await cdp('HeapProfiler.collectGarbage'); await wacht(5000); };

  /** Eén stap van laad of wissel (i telt door, ook over het opwarmen). */
  const stap = async (i) => {
    const id = nummers[i % nummers.length];
    if (PROEF === 'laad') {
      const deck = i % 2 ? 'B' : 'A', n = i % 2 ? 2 : 1;
      await ev(`(async () => {
        await __speel('${deck}', ${n}, ${JSON.stringify(id)});
        // Keylock om de beurt: dan rekent ook de stretcher in de worklet mee.
        if (!!__a.read('track.${n}.keylock') !== ${i % 4 >= 2}) { __a.invoke('track.${n}.keylock', true); __a.invoke('track.${n}.keylock', false); }
      })()`);
      await wacht(1500);
    } else {
      const soort = i % 2 ? 'schaal' : 'poly';
      await ev(`(() => { const r = window.engine.zetInstrument('A', '${soort}'); if (!r.ok) throw new Error(r.reden); })()`);
      await wacht(400);
      await ev(`(async () => {
        await __speel('A', 1, ${JSON.stringify(id)});
        if (!__a.read('track.1.keylock')) { __a.invoke('track.1.keylock', true); __a.invoke('track.1.keylock', false); }
      })()`);
      await wacht(1200);
    }
  };
  await wacht(10000);
  if (PROEF !== 'opname') {
    // Alles in de pagina: een stap = laden (en bij wissel eerst een instrument), spelen, even wachten.
    await ev(`(async () => {
      window.__lek = { nummers: ${JSON.stringify(nummers)}, tracks: {} };
      for (const id of __lek.nummers) __lek.tracks[id] = (await (await fetch('/api/library/' + id)).json()).track;
      window.__speel = async (deck, n, id) => {
        const r = await window.library.onLaad(deck, __lek.tracks[id]);
        if (!r) throw new Error('laden gaf null (track ' + n + ')');
        __a.invoke('track.' + n + '.fader', 0.8);
        if (!window.engine.decks[deck].playing) { __a.invoke('track.' + n + '.play', true); __a.invoke('track.' + n + '.play', false); }
      };
    })()`);
    // Opwarmen: wat één keer gebeurt (de WASM van keylock compileren, de
    // modules van de instrumenten, de caches van de golfvorm) is geen lek.
    for (let i = 0; i < OPWARM; i++) await stap(i);
  }
  await gc();
  const begin = geheugen();
  const heap0 = await hoofdHeap();
  if (PROEF === 'opname') {
    log('voor de opname (na GC)', JSON.stringify(begin));
    await ev("__a.invoke('record.start', true); __a.invoke('record.start', false)");
    const t1 = Date.now() + DUUR_S * 1000;
    while (Date.now() < t1) {
      await wacht(15000);
      log('opname loopt (deck stil)', JSON.stringify(geheugen()), await ev("document.getElementById('opname-btn').textContent").catch(() => '?'));
    }
    const eind = geheugen();
    await gc();
    const naGc = geheugen();
    log('na GC', JSON.stringify(naGc));
    await ev("__a.invoke('record.start', true); __a.invoke('record.start', false)").catch(() => {});
    const r0 = begin?.renderer ?? NaN, r1 = eind?.renderer ?? NaN, r2 = naGc?.renderer ?? NaN;
    const min = DUUR_S / 60;
    console.log(`\nrenderer: begin ${r0} MB · na ${DUUR_S} s opname ${r1} MB · na GC ${r2} MB`);
    console.log(`groei ${((r1 - r0) / min).toFixed(1)} MB/min, na GC ${((r2 - r0) / min).toFixed(1)} MB/min blijvend`);
    code = 0;
  } else {
    log(`voor ${PROEF} (na GC)`, JSON.stringify(begin));
    for (let i = 0; i < N; i++) {
      await stap(OPWARM + i);
      if ((i + 1) % 10 === 0) log(`${PROEF} ${i + 1}/${N}`, JSON.stringify(geheugen()));
    }
    const eind = geheugen();
    await ev("for (const d of Object.values(window.engine.decks)) if (d.playing) d.togglePlay()").catch(() => {});
    await wacht(500);
    await gc();
    const naGc = geheugen();
    log('na GC', JSON.stringify(naGc));
    const r0 = begin?.renderer ?? NaN, r1 = eind?.renderer ?? NaN, r2 = naGc?.renderer ?? NaN;
    console.log(`\nrenderer (RSS): begin ${r0} MB · na ${N}× ${PROEF} ${r1} MB · na GC ${r2} MB (groei ${(r2 - r0).toFixed(0)} MB)`);
    // De eis op het privé geheugen als dat er is (Linux), anders op RSS (macOS).
    const sleutel = begin?.['renderer-privé'] != null && naGc?.['renderer-privé'] != null ? 'renderer-privé' : 'renderer';
    const p0 = begin?.[sleutel] ?? NaN, p1 = eind?.[sleutel] ?? NaN, p2 = naGc?.[sleutel] ?? NaN;
    if (sleutel !== 'renderer') console.log(`renderer (privé): begin ${p0} MB · na ${N}× ${PROEF} ${p1} MB · na GC ${p2} MB`);
    const groei = p2 - p0;
    console.log(`groei na GC (${sleutel === 'renderer' ? 'RSS' : 'privé'}) ${groei.toFixed(0)} MB (eis ≤ ${EIS_MB} MB): ${groei <= EIS_MB ? 'GOED' : 'TE VEEL'}`);
    const heap1 = await hoofdHeap();
    console.log(`JS-heap hoofdthread na GC: ${heap0} -> ${heap1} MB`);
    code = groei <= EIS_MB ? 0 : 1;
  }
} catch (e) {
  console.error('fout', e.stack);
} finally {
  try { browser.kill('SIGKILL'); } catch (_) {}
  try { server.kill('SIGKILL'); } catch (_) {}
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
}
