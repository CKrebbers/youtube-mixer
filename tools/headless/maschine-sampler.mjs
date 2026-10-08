// De padmodus sampler op de Maschine (docs/MASCHINE.md §5f), in headless Chromium met de
// ECHTE sampler: een demotrack met grid op track 1, een nagebootste Maschine-verbinding
// (dezelfde Maschine-klasse als met ?hub=, alleen de poort is nep). SAMPLING, een lege pad
// knipt, nog eens = speelt op de tel, SHIFT + pad = leeg, ◄ ► = tellen, draaiknop 5 =
// volume, de lampjes en het scherm gaan mee, SAMPLING nog eens = weer spelen.
// Eigen server, tijdelijke database, MIDI eruit (veilig met de APC aangesloten).
//
// Gebruik:  node tools/headless/maschine-sampler.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8843) en VARVE_KIJK_DEBUG (9443).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8843, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9443;
const tmp = mkdtempSync(join(tmpdir(), 'varve-maschine-sampler-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';
const B = `http://localhost:${POORT}`;

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

/** Een tabblad via het DevTools-protocol: cdp(), ev(), en de fouten in de console. */
async function verbind(doel) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr, gebaar = false) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gebaar });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { ws, cdp, ev, fouten };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(150); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

let mixer;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  for (let i = 0; i < 50; i++) { if (await fetch(`${B}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  mixer = await verbind(doelen.find((d) => d.type === 'page'));
  await mixer.cdp('Page.navigate', { url: `${B}/` });
  ok('de mixer laadt, met een sampler', await tot(() => mixer.ev('!!window.engine && !!window.engine.sampler'), 20000));
  // Een demotrack met grid op track 1, spelend vanaf 10 s (een lege pad knipt de laatste tellen vóór de positie).
  await mixer.ev(`(async () => {
    const e = window.engine;
    await e.resume?.();
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const d = e.deck('A');
    await d.laadGeheugen(renderDemoTrack(e.ctx, { bars: 32 }), 'demo A');
    d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
    d.seek(10); d.play();
    e.setFocus('A');
  })()`);
  ok('track 1 speelt, met grid', await tot(() => mixer.ev("window.engine.deck('A').playing && !!window.engine.deck('A').grid")));
  await mixer.ev(`(async () => {
    const { Maschine } = await import('/src/control/maschine.js');
    const { read, invoke } = await import('/src/control/actions.js');
    const { beschrijf } = await import('/src/ui/apc-beschrijf.js');
    const { parseMessage } = await import('/src/control/midi.js');
    const m = new Maschine({ engine: window.engine, noten: window.noten, read, invoke, beschrijf, library: window.library });
    m.laadMapping(await (await fetch('mappings/maschine-mk2.json')).json());
    window.verstuurd = { schermen: [] };
    m.koppel({ in: { state: 'connected', onmidimessage: null, onstatechange: null }, uit: { state: 'connected', send() {} },
      scherm(nr, data) { window.verstuurd.schermen[nr] = data; } });
    setInterval(() => m.tik(), 33);
    window.maschine = m;
    window.druk = (st, nr, w) => m.ontvang(parseMessage([st, nr, w]));
  })()`);
  const knop = (n) => `druk(0x91, ${n}, 127); druk(0x81, ${n}, 0)`;      // SAMPLING 11, ◄ 33, ► 34
  const pad = (p) => `druk(0x90, ${35 + p}, 100); druk(0x80, ${35 + p}, 0)`;
  const sm = (expr) => mixer.ev(`(() => { const s = window.engine.sampler; return ${expr}; })()`);
  const led = (kanaal, noot) => mixer.ev(`window.maschine.leds.get('${kanaal}:${noot}')`);

  await mixer.ev(knop(11));
  ok('SAMPLING: de padmodus sampler, lampje fel', await tot(async () => (await mixer.ev('window.maschine.modus')) === 'sampler' && (await led(1, 11)) === 127));
  await mixer.ev(pad(13));
  ok('pad 13 (sampler-pad 1, leeg): knipt de laatste 4 tellen van track 1', await tot(() => sm('!!s.pads[0] && s.pads[0].tellen === 4'), 15000), JSON.stringify(await sm('s.stand()[0]')));
  ok('…het lampje: gevuld (violet donker, zoals op de APC)', await tot(async () => (await led(0, 48)) === 50), String(await led(0, 48)));
  await mixer.ev(pad(13));
  ok('nog eens: speelt (op de tel), lampje fel violet', await tot(async () => (await sm('s.pads[0]?.speelt')) && (await led(0, 48)) === 49, 4000));
  await mixer.ev(pad(13));
  ok('nog eens: stopt', await tot(() => sm('!s.pads[0]?.speelt'), 4000));
  const voor = await sm('s.tellen');
  await mixer.ev(knop(33));
  ok(`◄ (transport): minder tellen (${voor} → 2)`, await tot(async () => (await sm('s.tellen')) === 2));
  await mixer.ev(knop(34)); await mixer.ev(knop(34));
  ok('► twee keer: 8 tellen', await tot(async () => (await sm('s.tellen')) === 8));
  const v0 = await sm('s.volume');
  await mixer.ev('druk(0xb0, 20, 50)');
  ok('draaiknop 5: het sampler-volume gaat omhoog', await tot(async () => (await sm('s.volume')) > v0 + 0.03), `${v0} → ${await sm('s.volume')}`);
  await mixer.ev('druk(0x91, 39, 127)'); await mixer.ev(pad(13)); await mixer.ev('druk(0x81, 39, 0)');
  ok('SHIFT + pad 13: leeg (en bewaard? alleen bij een library-nummer)', await tot(() => sm('s.pads[0] === null')));
  ok('de schermen gingen naar de Maschine', await mixer.ev('!!window.verstuurd.schermen[0] && !!window.verstuurd.schermen[1]'));
  await mixer.ev(knop(11));
  ok('SAMPLING nog eens: weer spelen, lampje zacht', await tot(async () => (await mixer.ev('window.maschine.modus')) === 'spelen' && (await led(1, 11)) === 16));
  ok('geen fouten in de console', mixer.fouten.length === 0, mixer.fouten.join(' | '));
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  try { mixer?.ws.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : '\nAlles groen.');
process.exit(rood ? 1 : 0);
