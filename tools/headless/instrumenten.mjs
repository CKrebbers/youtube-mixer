// De instrumenten FM en Schaal (docs/INSTRUMENTEN.md §7) in een headless
// Chromium, op een OfflineAudioContext: de echte Web Audio en de echte
// worklet, niets wordt afgespeeld.
//
//   - toonhoogte: FM A4 = 440 Hz ± 2 cent (grondtoon); Schaal: de partial die
//     het dichtst bij de gevraagde noot ligt, ± 2 cent;
//   - luidheid: een akkoord van drie noten (C4 E4 G4) op snelheid 0,8, drie
//     seconden, BS.1770 (K-weging, blokken van 400 ms, poorten −70 en −10):
//     rond −14 LUFS, zoals een nummer na de ingest;
//   - noteOff klinkt uit tot stilte; geen NaN; de noot begint op zijn t.
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
// Raakt de geluidsinstellingen van de Mac niet: de offline context speelt niets af.
//
// Gebruik:  VARVE_KIJK_POORT=8815 VARVE_KIJK_DEBUG=9415 node tools/headless/instrumenten.mjs
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache
// (macOS), anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8815, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9415;
const tmp = mkdtempSync(join(tmpdir(), 'varve-instrumenten-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: false };
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

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
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
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// ---- wat in de pagina draait (als tekst erheen) -----------------------------------

/** BS.1770-4 op 48 kHz: K-weging (de twee biquads uit de norm), blokken van 400 ms per 100 ms, poorten −70 LUFS en −10 LU. */
function lufs(L, R, van, tot, sr) {
  const k = (x) => {
    const y = new Float64Array(x.length);
    let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0;
    for (let i = 0; i < x.length; i++) {
      const s = 1.53512485958697 * x[i] - 2.69169618940638 * a1 + 1.19839281085285 * a2 + 1.69065929318241 * b1 - 0.73248077421585 * b2;
      a2 = a1; a1 = x[i]; b2 = b1; b1 = s;
      const h = s - 2 * c1 + c2 + 1.99004745483398 * d1 - 0.99007225036621 * d2;
      c2 = c1; c1 = s; d2 = d1; d1 = h;
      y[i] = h;
    }
    return y;
  };
  const kl = k(L.subarray(van, tot)), kr = k(R.subarray(van, tot));
  const blok = Math.round(0.4 * sr), stap = Math.round(0.1 * sr), z = [];
  for (let i = 0; i + blok <= kl.length; i += stap) {
    let s = 0;
    for (let j = i; j < i + blok; j++) s += kl[j] * kl[j] + kr[j] * kr[j];
    z.push(s / blok);
  }
  const L_ = (m) => -0.691 + 10 * Math.log10(m);
  const abs = z.filter((m) => L_(m) > -70);
  if (!abs.length) return { geintegreerd: -Infinity, momentaan: -Infinity };
  const rel = L_(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((m) => L_(m) > rel);
  return { geintegreerd: L_(g.reduce((a, b) => a + b, 0) / g.length), momentaan: L_(Math.max(...z)) };
}

/** Amplitude op frequentie f (Goertzel met Hann). */
function goertzel(x, f, sr) {
  const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    const s0 = x[i] * h + c * s1 - s2; s2 = s1; s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
}

/**
 * De partial die het dichtst bij `hz` ligt: eerst de toppen in het spectrum
 * binnen ± 1 halve toon (stappen van 1 cent), dan de dichtstbijzijnde top
 * per 0,05 cent verfijnd.
 */
function dichtstePartial(x, hz, sr) {
  const ruw = [];
  for (let c = -100; c <= 100; c++) ruw.push(goertzel(x, hz * Math.pow(2, c / 1200), sr));
  const max = Math.max(...ruw), toppen = [];
  for (let i = 1; i < ruw.length - 1; i++) if (ruw[i] >= ruw[i - 1] && ruw[i] >= ruw[i + 1] && ruw[i] > max * 0.1) toppen.push(i - 100);
  const c0 = toppen.sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;
  let beste = c0, bv = -1;
  for (let c = c0 - 1; c <= c0 + 1; c += 0.05) { const v = goertzel(x, hz * Math.pow(2, c / 1200), sr); if (v > bv) { bv = v; beste = c; } }
  return beste;
}

/**
 * Eén instrument op een OfflineAudioContext van `duur` s: start(), dan bij het
 * tweede blok de context stilzetten, het scenario uitvoeren (noten met een t
 * vooruit), de worklet de berichten laten lezen, en verder renderen. Zo komen
 * de berichten van een worklet nooit te laat, hoe snel de offline context ook is.
 */
async function render(module, def, duur, scenario, params) {
  const SR = 48000;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(duur * SR), sampleRate: SR });
  const uit = ctx.createGain();
  uit.connect(ctx.destination);
  const m = await import(module);
  const inst = m[def].maak(ctx, { uit, klok: null, toon: () => null });
  await inst.start();
  for (const [k, v] of params) inst.zetParam(k, v);
  ctx.suspend(256 / SR).then(async () => {
    const speel = new Function('inst', scenario);
    speel(inst);
    await new Promise((r) => setTimeout(r, 300));
    ctx.resume();
  });
  const buf = await ctx.startRendering();
  return { L: buf.getChannelData(0), R: buf.getChannelData(1), SR };
}

const HULP = [lufs, goertzel, dichtstePartial, render].map((f) => f.toString()).join('\n');
const meet = (module, def, duur, scenario, meting, params = []) => evalueer(`(async () => {
  ${HULP}
  const { L, R, SR } = await render(${JSON.stringify(module)}, ${JSON.stringify(def)}, ${duur}, ${JSON.stringify(scenario)}, ${JSON.stringify(params)});
  let nan = 0, piek = 0;
  for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan++; else piek = Math.max(piek, Math.abs(L[i]), Math.abs(R[i])); }
  const eerste = L.findIndex((v, i) => Math.abs(v) > 1e-7 || Math.abs(R[i]) > 1e-7);
  const meting = (${meting});
  return { nan, piek, eerste, ...meting(L, R, SR) };
})()`);

const db = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);

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
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  // Een pagina van de server zonder de app: alleen de oorsprong is nodig (modules, worklet).
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/src/engine/instrumenten/index.js` });
  await wacht(500);
  ok('pagina zonder MIDI, OfflineAudioContext en AudioWorklet aanwezig',
    await evalueer('!navigator.requestMIDIAccess && typeof OfflineAudioContext === "function" && "audioWorklet" in OfflineAudioContext.prototype'));

  const FM = ['/src/engine/instrumenten/fm.js', 'FM'];
  const SC = ['/src/engine/instrumenten/schaal.js', 'SCHAAL'];
  const toonMeting = (hz) => `(L, R, SR) => ({ cent: dichtstePartial(L.subarray(SR * 0.6, SR * 1.6), ${hz}, SR) })`;
  const luidMeting = `(L, R, SR) => ({ ...lufs(L, R, Math.round(SR * 0.1), Math.round(SR * 3.1), SR) })`;
  const stilMeting = (van) => `(L, R, SR) => { let m = 0; for (let i = Math.round(SR * ${van}); i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
    const rms = (a, b) => { let s = 0; for (let i = Math.round(SR * a); i < Math.round(SR * b); i++) s += L[i] * L[i]; return Math.sqrt(s / ((b - a) * SR)); };
    return { rest: m, r1: rms(0.3, 0.6), r2: rms(0.8, 1.1), r3: rms(1.5, 1.8) }; }`;

  for (const [naam, [mod, def], stil] of [['FM', FM, 3.2], ['Schaal', SC, 5.5]]) {
    console.log(`\n${naam}`);
    // Toonhoogte. FM zonder zweving: twee draaggolven 1 Hz uit elkaar zijn binnen 1 s niet te scheiden.
    const zonderZweving = naam === 'FM' ? [[6, 0]] : [];
    const a4 = await meet(mod, def, 2, 'inst.noteOn(69, 0.8, 0.1);', toonMeting(440), zonderZweving);
    ok(`${naam} A4: de partial bij 440 Hz staat op ${a4.cent >= 0 ? '+' : ''}${a4.cent.toFixed(2)} cent`, Math.abs(a4.cent) <= 2);
    ok(`${naam}: de noot begint op t = 0,1 s (sample ${a4.eerste}, verwacht 4800)`, Math.abs(a4.eerste - 4800) <= 2);
    for (const midi of [36, 60, 84]) {
      const hz = 440 * Math.pow(2, (midi - 69) / 12);
      const r = await meet(mod, def, 2, `inst.noteOn(${midi}, 0.8, 0.1);`, toonMeting(hz), zonderZweving);
      ok(`${naam} MIDI ${midi} (${hz.toFixed(2)} Hz): ${r.cent >= 0 ? '+' : ''}${r.cent.toFixed(2)} cent`, Math.abs(r.cent) <= 2 && r.nan === 0);
    }
    if (naam === 'FM') {
      const z = await meet(mod, def, 2, 'inst.noteOn(69, 0.8, 0.1);', toonMeting(440));
      console.log(`   (met de standaardzweving van 1 Hz: midden op ${z.cent.toFixed(2)} cent)`);
    }

    // Luidheid: drie keer (de schaal slaat elke keer iets anders, zoals een hand).
    const keer = [];
    for (let i = 0; i < 3; i++) {
      keer.push(await meet(mod, def, 3.3, 'inst.noteOn(60, 0.8, 0.1); inst.noteOn(64, 0.8, 0.1); inst.noteOn(67, 0.8, 0.1);', luidMeting));
    }
    const gem = keer.reduce((a, b) => a + b.geintegreerd, 0) / keer.length;
    const spreid = Math.max(...keer.map((k) => k.geintegreerd)) - Math.min(...keer.map((k) => k.geintegreerd));
    ok(`${naam} akkoord C4 E4 G4 op 0,8, 3 s: ${gem.toFixed(2)} LUFS geïntegreerd (spreiding ${spreid.toFixed(2)} LU; momentaan max ${Math.max(...keer.map((k) => k.momentaan)).toFixed(1)}; piek ${db(Math.max(...keer.map((k) => k.piek))).toFixed(1)} dBFS)`,
      Math.abs(gem + 14) <= 1 && keer.every((k) => k.nan === 0));

    // Uitklinken tot stilte.
    const u = await meet(mod, def, stil + 0.5, 'inst.noteOn(69, 0.8, 0.1); inst.noteOff(69, 0.6);', stilMeting(stil));
    ok(`${naam} noteOff op 0,6 s: hij zakt (rms ${db(u.r1).toFixed(0)} → ${db(u.r2).toFixed(0)} → ${db(u.r3).toFixed(0)} dB) en na ${stil} s is het stil (max ${u.rest === 0 ? '0' : db(u.rest).toFixed(0) + ' dB'})`,
      u.r2 < u.r1 && u.r3 < u.r2 && u.rest < 1e-5 && u.nan === 0);

    // Stemroof en stil in de echte Web Audio: geen NaN, binnen ±1.
    const veel = Array.from({ length: 16 }, (_, i) => `inst.noteOn(${48 + i * 2}, 1, ${0.1 + i * 0.05});`).join(' ');
    const r = await meet(mod, def, 2, `${veel} inst.noteOn(90, 1, 1.0); setTimeout(() => {}, 0);`, `(L, R, SR) => ({})`);
    ok(`${naam} zestien noten vol (stemroof): eindig, piek ${db(r.piek).toFixed(1)} dBFS`, r.nan === 0 && r.piek < 4);
  }

  // Twee tracks met een klankschaal in één AudioContext, naast de globale klankschaal:
  // één keer laden, twee eigen worklets, de ene hoort niets van de andere.
  console.log('\ntwee tracks, één AudioContext');
  const twee = await evalueer(`(async () => {
    const SR = 48000;
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR * 1.5, sampleRate: SR });
    await ctx.audioWorklet.addModule('/src/engine/klankschaal-worklet.js');
    const globaal = new AudioWorkletNode(ctx, 'varve-klankschaal', { numberOfInputs: 0, outputChannelCount: [2] });
    const samen = ctx.createChannelMerger(2);
    samen.connect(ctx.destination);
    const uitA = ctx.createGain(), uitB = ctx.createGain();
    for (const [u, k] of [[uitA, 0], [uitB, 1]]) { u.channelCount = 1; u.channelCountMode = 'explicit'; u.connect(samen, 0, k); }
    const { SCHAAL } = await import('/src/engine/instrumenten/schaal.js');
    const a = SCHAAL.maak(ctx, { uit: uitA, toon: () => null }), b = SCHAAL.maak(ctx, { uit: uitB, toon: () => null });
    await Promise.all([a.start(), b.start()]);
    ctx.suspend(256 / SR).then(async () => { a.noteOn(69, 0.8, 0.1); await new Promise((r) => setTimeout(r, 300)); ctx.resume(); });
    const buf = await ctx.startRendering();
    const piek = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return { a: piek(buf.getChannelData(0)), b: piek(buf.getChannelData(1)), verschillend: a.node !== b.node, globaal: !!globaal };
  })()`);
  ok(`twee schaal-tracks: eigen worklets; track A klinkt (piek ${db(twee.a).toFixed(1)} dBFS), track B hoort niets (${twee.b === 0 ? 'exact 0' : db(twee.b).toFixed(0) + ' dB'})`,
    twee.verschillend && twee.globaal && twee.a > 0.01 && twee.b === 0);

  ok('geen fouten in de console', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  console.error(err);
  uitkomst.push(['uitvoering', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} ROOD` : '\nalles groen');
process.exit(rood ? 1 : 0);
