// Audio-gezondheid in echte (headless) Chrome (spoor A, 15 okt; docs/verslagen/2026-10-15/arch-audio.md).
//
// 1. De AudioContext bewaken (src/ui/gezondheid.js): ZONDER autoplay-vlag, dus de audio start pas
//    na een echte klik (CDP Input, een vertrouwd gebaar) op "audio starten". Daarna ctx.suspend():
//    de melding "audio staat stil" (sleutel audio) moet verschijnen, en een druk op een NEP-APC
//    (navigator.requestMIDIAccess nagemaakt, zoals latentie.mjs) moet hem weer aanzetten (sticky
//    activation: Chrome staat resume() dan toe zonder nieuw gebaar). Daarna hetzelfde met een toets.
// 2. Een worklet die 'stop' krijgt en meteen daarna zijn poort dicht: komt het bericht nog aan
//    (process() geeft daarna false)? Gemeten met een eigen processor die per blok een teller in een
//    SharedArrayBuffer ophoogt (de pagina is crossOriginIsolated: de server stuurt COOP/COEP). Ter
//    vergelijking een node die alleen los en dicht gaat (zoals vroeger): die blijft rekenen.
// 3. processorerror op de echte stream-lezer: een segment dat process() laat gooien (een BigInt in P,
//    alleen hier, als proef). De StreamBron bouwt één keer een nieuwe node op dezelfde plek (melding,
//    geluid terug); de tweede keer blijft het stil met een melding die blijft staan.
//
// VEILIG MET DE APC AANGESLOTEN: de MIDI is nagemaakt (geen requestMIDIAccess), eigen server op een
// eigen poort, alles in een tijdelijke map.
// Gebruik:  [VARVE_CHROME=<chrome>] node tools/headless/gezondheid.mjs
//           (poorten VARVE_GZ_POORT 8935, VARVE_GZ_DEBUG 8936)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_GZ_POORT) || 8935, DEBUG = Number(process.env.VARVE_GZ_DEBUG) || 8936;
const tmp = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-gz-'));
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Vóór de pagina: een nep-APC (één in- en één uitvoerpoort), zoals tools/headless/latentie.mjs.
const VOORAF = String.raw`(() => {
  let h = null;
  const pin = { id: 'nep-apc-in', name: 'APC40 mkII', manufacturer: 'Akai', type: 'input', state: 'connected', connection: 'open', onstatechange: null,
    addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(pin, 'onmidimessage', { get: () => h, set: (f) => { h = f; }, enumerable: true });
  const pout = { id: 'nep-apc-uit', name: 'APC40 mkII', manufacturer: 'Akai', type: 'output', state: 'connected', connection: 'open', onstatechange: null,
    send() {}, addEventListener() {}, removeEventListener() {} };
  const access = { inputs: new Map([[pin.id, pin]]), outputs: new Map([[pout.id, pout]]), sysexEnabled: true, onstatechange: null,
    addEventListener() {}, removeEventListener() {} };
  navigator.requestMIDIAccess = async () => access;
  window.__nep = { poort: pin, stuur: (bytes) => h && h({ data: new Uint8Array(bytes), timeStamp: performance.now() }) };
})();`;

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opn'), VARVE_HERANALYSE: 'uit', VARVE_PATRONEN: join(tmp, 'pat'), VARVE_PLANNEN: join(tmp, 'plan'),
    VARVE_STANDEN: join(tmp, 'standen'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'),
    VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_SETS: join(tmp, 'sets'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes') }, stdio: 'ignore' });
const chrome = zoekChrome();
// GEEN --autoplay-policy: de audio mag pas na een echt gebaar, zoals bij Clay.
const browser = spawn(chrome.pad, [...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });

let ws, volg = 0; const wachtend = new Map();
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, fout) => wachtend.set(id, { ok, fout })); };
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const totDat = async (expr, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await wacht(50); } return false; };
const audioMelding = `(() => { const m = [...document.querySelectorAll('#meldingen .melding')].find((x) => x.dataset.sleutel === 'audio' && !x.classList.contains('weg')); return m ? { tekst: m.firstChild.textContent, fout: m.classList.contains('fout') } : null; })()`;
const deckMeldingen = `[...document.querySelectorAll('#meldingen .melding')].map((x) => x.firstChild.textContent)`;

let code = 1;
try {
  let doelen = null; for (let i = 0; i < 50 && !doelen?.find?.((d) => d.type === 'page'); i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); } });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: VOORAF });
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  if (!await totDat('!!(window.engine && window.gezondheid && document.getElementById("audio-btn"))', 30000)) throw new Error('de app start niet');
  await wacht(800);

  // ---- 1. de AudioContext bewaken ----------------------------------------------------
  console.log('1. de AudioContext bewaken');
  ok('vóór "audio starten": de context staat stil, en er is geen melding (de gewone beginstand)',
    await ev('engine.ctx.state') !== 'running' && (await ev(audioMelding)) === null, await ev('engine.ctx.state'));
  await ev('window.__nep.stuur([0x90, 0x00, 0x7f]); window.__nep.stuur([0x80, 0x00, 0x00]); true');
  ok('… een druk vóór er ooit geklikt is zet hem niet aan (dat doet audio starten)', await ev('engine.ctx.state') !== 'running');
  // Een ECHTE klik (vertrouwd gebaar) op audio starten.
  const r = await ev(`(() => { const b = document.getElementById('audio-btn').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  ok('klik op audio starten: de audio loopt', await totDat('engine.ctx.state === "running"'));
  ok('… en de nep-APC is gekozen', await totDat('!!(window.midi?.input?.() && window.__nep.poort.onmidimessage)', 10000));
  ok('… geen audio-melding', (await ev(audioMelding)) === null);
  await ev('engine.ctx.suspend().then(() => true)');
  ok('ctx.suspend(): de melding "audio staat stil" (fout, sleutel audio)', await totDat(`(${audioMelding})?.fout === true && /staat stil/.test((${audioMelding}).tekst)`),
    JSON.stringify(await ev(audioMelding)));
  // Een druk op een pad van de nep-APC (een lege hotcue: doet verder niets).
  await ev('window.__nep.stuur([0x90, 0x00, 0x7f]); window.__nep.stuur([0x80, 0x00, 0x00]); true');
  ok('een druk op de (nep-)APC: de audio loopt weer (resume zonder nieuw gebaar)', await totDat('engine.ctx.state === "running"'));
  ok('… de melding wordt "audio loopt weer" (info, zelfde sleutel)', await totDat(`(${audioMelding})?.tekst === 'audio loopt weer' && !(${audioMelding}).fout`),
    JSON.stringify(await ev(audioMelding)));
  await ev('engine.ctx.suspend().then(() => true)');
  await totDat(`(${audioMelding})?.fout === true`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  ok('stil, dan een toets (Shift): de audio loopt weer', await totDat('engine.ctx.state === "running"'));
  // De klokwachter: met een stilstaande klok in Chrome is niet te maken zonder de uitgang weg te halen;
  // die zit in test/gezondheid.test.mjs. Hier alleen: met een lopende klok geen vals alarm.
  await wacht(3500);
  ok('3,5 s met een lopende klok: geen vals alarm van de klokwachter', !((await ev(audioMelding))?.fout), JSON.stringify(await ev('gezondheid.stand()')));

  // ---- 2. 'stop' en daarna meteen de poort dicht -------------------------------------
  console.log('\n2. stop + close: komt het bericht nog aan?');
  const st = await ev(`(async () => {
    if (!crossOriginIsolated) return { fout: 'niet crossOriginIsolated' };
    const src = "registerProcessor('proef-stop', class extends AudioWorkletProcessor { constructor(o) { super(); this.t = new Int32Array(o.processorOptions.sab); this.levend = true; this.port.onmessage = (e) => { if (e.data && e.data.type === 'stop') this.levend = false; }; } process() { if (!this.levend) return false; Atomics.add(this.t, 0, 1); return true; } });";
    const ctx = engine.ctx;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const maak = () => { const sab = new SharedArrayBuffer(4); const n = new AudioWorkletNode(ctx, 'proef-stop', { processorOptions: { sab } });
      const g = ctx.createGain(); g.gain.value = 0; n.connect(g).connect(ctx.destination); return { n, t: new Int32Array(sab) }; };
    const a = maak(), b = maak();
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    await w(300);
    const voor = [Atomics.load(a.t, 0), Atomics.load(b.t, 0)];
    // a: zoals vernietig() nu: stop, los, dicht. b: zoals vroeger: alleen los en dicht.
    a.n.port.postMessage({ type: 'stop' }); a.n.disconnect(); a.n.port.close();
    b.n.disconnect(); b.n.port.close();
    await w(300);
    const na1 = [Atomics.load(a.t, 0), Atomics.load(b.t, 0)];
    await w(500);
    const na2 = [Atomics.load(a.t, 0), Atomics.load(b.t, 0)];
    return { voor, na1, na2 };
  })()`);
  if (st.fout) ok('de proef kan draaien', false, st.fout);
  else {
    ok('beide proef-nodes rekenden', st.voor[0] > 10 && st.voor[1] > 10, `blokken ${st.voor.join(' / ')}`);
    ok("stop en meteen close: het bericht komt aan, process() geeft false en de teller staat stil", st.na2[0] === st.na1[0], `${st.na1[0]} -> ${st.na2[0]}`);
    ok('alleen los en dicht (zoals vroeger): de node blijft rekenen (dat was het lek)', st.na2[1] > st.na1[1], `${st.na1[1]} -> ${st.na2[1]}`);
  }

  // ---- 3. processorerror op de echte stream-lezer ------------------------------------
  console.log('\n3. processorerror: de StreamBron bouwt één keer opnieuw op');
  await ev(`(async () => {
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    window.__a = await import('/src/control/actions.js');
    const d = engine.deck('A');
    await d.laadGeheugen(renderDemoTrack(engine.ctx, { seed: 3, bars: 32 }), 'demo');
    __a.invoke('track.1.fader', 0.9);
    __a.invoke('track.1.play', true); __a.invoke('track.1.play', false);
    window.__piek = () => { const b = new Float32Array(2048); engine.master.analyser.getFloatTimeDomainData(b); let m = 0; for (const v of b) m = Math.max(m, Math.abs(v)); return m; };
    return true;
  })()`);
  await wacht(1500);
  const piek0 = await ev('__piek()');
  ok('de demotrack speelt en klinkt', piek0 > 0.01 && await ev('engine.deck("A").playing'), `piek ${piek0.toFixed(3)}`);
  // Een segment dat process() laat gooien (BigInt + getal = TypeError), rechtstreeks naar de worklet.
  const vergiftig = `(() => { const b = engine.deck('A').bron; window.__oud = b.node;
    b.node.port.postMessage({ type: 'segment', id: 9999, seg: { T: 0, P: 1n, R: 1, loop: null, speelt: true, rem: null, rek: null } }); return true; })()`;
  const plek0 = await ev('({ p: engine.deck("A").bron.positie, t: engine.ctx.currentTime, r: engine.deck("A").bron.seg.R })');
  await ev(vergiftig);
  ok('processorerror: een nieuwe node (de oude los)', await totDat('!!engine.deck("A").bron.node && engine.deck("A").bron.node !== window.__oud', 5000));
  ok('… met een melding "opnieuw opgebouwd"', await totDat(`${deckMeldingen}.some((t) => /track 1: .*opnieuw opgebouwd/.test(t))`), JSON.stringify(await ev(deckMeldingen)));
  await wacht(1200);
  const piek1 = await ev('__piek()');
  ok('… en het geluid is terug (de track speelt door)', piek1 > 0.01 && await ev('engine.deck("A").playing'), `piek ${piek1.toFixed(3)}`);
  const plek1 = await ev('({ p: engine.deck("A").bron.positie, t: engine.ctx.currentTime })');
  const verwacht = plek0.p + (plek1.t - plek0.t) * plek0.r;
  ok('… op dezelfde plek: de positie liep door alsof er niets was (regel 3)', Math.abs(plek1.p - verwacht) < 0.005,
    `${plek1.p.toFixed(3)} s, verwacht ${verwacht.toFixed(3)} s`);
  await ev(vergiftig);
  ok('nog een fout: geen nieuwe node meer, een melding die blijft staan', await totDat(`engine.deck('A').bron.node === null && ${deckMeldingen}.some((t) => /blijft stil/.test(t))`, 5000),
    JSON.stringify(await ev(deckMeldingen)));
  await wacht(600);
  const piek2 = await ev('__piek()');
  ok('… en dan is het echt stil (geen geluid van een dode node)', piek2 < 1e-4, `piek ${piek2.toExponential(1)}`);
  await ev(`(async () => { const { renderDemoTrack } = await import('/src/analysis/demo-track.js'); await engine.deck('A').laadGeheugen(renderDemoTrack(engine.ctx, { seed: 4, bars: 16 }), 'demo 2');
    __a.invoke('track.1.play', true); __a.invoke('track.1.play', false); return true; })()`);
  await wacht(1500);
  const piek3 = await ev('__piek()');
  ok('een nieuw nummer laden: een nieuwe node, en het klinkt weer', piek3 > 0.01 && !!(await ev('!!engine.deck("A").bron.node')), `piek ${piek3.toFixed(3)}`);

  const rood = uitkomst.filter(([, g]) => !g);
  console.log(rood.length ? `\n${rood.length} ROOD: ${rood.map(([n]) => n).join(' | ')}` : '\nAlles groen.');
  code = rood.length ? 1 : 0;
} catch (e) {
  console.error('fout', e.stack);
} finally {
  try { browser.kill('SIGKILL'); } catch (_) {}
  try { server.kill('SIGKILL'); } catch (_) {}
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
}
