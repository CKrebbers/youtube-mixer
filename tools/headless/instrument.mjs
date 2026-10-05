// Instrumenten op een track (docs/INSTRUMENTEN.md §6) in een headless Chromium.
//
// 1. De app zoals hij opstart: de INSTRUMENT-rij openen, Poly kiezen op de
//    focus-track (de knop, via de bus), de kolom en de knoppen tonen hem, het
//    toetsenbord op het scherm speelt (via noten.js).
// 2. De ECHTE Web Audio van Chrome (OfflineAudioContext, 48 kHz):
//    - A4 = 440 Hz ± 2 cent (sinus, niet ontstemd; en de standaardklank: de
//      twee ontstemde oscillatoren liggen symmetrisch om 440);
//    - noteOff klinkt uit tot stilte (en daalt alleen maar);
//    - een akkoord van drie noten (C4 E4 G4) op snelheid 0,8 met de
//      standaardknoppen: luidheid (BS.1770, K-weging, gegate) rond −14 LUFS,
//      even luid als een genormaliseerd nummer. Wijkt het af, dan zegt het
//      script welke OPHOGING (poly.js) het wel geeft;
//    - stemroof zonder tik: twaalf sinussen, dan een dertiende; de tweede
//      afgeleide rond het roven tegen die van de rust ervoor, en ter controle
//      een stem die hard wordt afgekapt (dat MOET een tik zijn);
//    - via de echte engine: het instrument klinkt door de strip (fader dicht =
//      stil, filterknop dicht = minder hoog).
//
// VEILIG MET DE APC AANGESLOTEN: zoals kijk.mjs (geen requestMIDIAccess in dit
// tabblad, eigen server op een eigen poort, tijdelijke database en media).
// Raakt de geluidsinstellingen van de Mac niet: de offline context speelt niets af.
//
// Gebruik:  node tools/headless/instrument.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8814) en VARVE_KIJK_DEBUG (9414).
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache
// (macOS), anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8814, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9414;
const tmp = mkdtempSync(join(tmpdir(), 'varve-instrument-'));

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

/**
 * Meetfuncties in de pagina: renderen op een OfflineAudioContext van 48 kHz,
 * stereo (zoals de uitgang), met de Poly rechtstreeks op de uitgang (zijn
 * eigen niveau: wat een nummer aan de ingang van zijn strip heeft), of met de
 * echte engine.
 */
const HULP = `
  const SR = 48000;
  const { POLY, PARAMS, OPHOGING } = await import('/src/engine/instrumenten/poly.js');
  const alleen = async (sec, doe) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(SR * sec), sampleRate: SR });
    const p = POLY.maak(ctx, { uit: ctx.destination, klok: () => null, toon: () => null });
    doe(p, ctx);
    return ctx.startRendering();
  };
  // Fijne frequentie: positieve nuldoorgangen, lineair geïnterpoleerd.
  const nuldoorgang = (x) => {
    const t = [];
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) t.push(i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]));
    return (t.length - 1) / ((t.at(-1) - t[0]) / SR);
  };
  const goertzel = (x, hz) => {
    const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
  };
  // De sterkste toon tussen lo en hi (Goertzel in stapjes van 0,01 Hz rond de grove piek).
  const piekHz = (x, lo, hi) => {
    let best = lo, max = -1;
    for (let f = lo; f <= hi; f += 0.25) { const a = goertzel(x, f); if (a > max) { max = a; best = f; } }
    for (let f = best - 0.25; f <= best + 0.25; f += 0.01) { const a = goertzel(x, f); if (a > max) { max = a; best = f; } }
    return best;
  };
  const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  // BS.1770-4: K-weging (twee biquads, 48 kHz), blokken van 400 ms met 75% overlap,
  // absolute poort −70 LUFS, relatieve −10 LU. Kanalen opgeteld met gewicht 1.
  const lufs = (buf, van, tot) => {
    const kw = (x) => {
      const y = new Float64Array(x.length);
      const trap = (inp, uit, b, a) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < inp.length; i++) { const v = b[0] * inp[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = inp[i]; y2 = y1; y1 = v; uit[i] = v; } };
      const tmp = new Float64Array(x.length);
      trap(x, tmp, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
      trap(tmp, y, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
      return y;
    };
    const k = [0, 1].map((c) => kw(buf.getChannelData(c)).subarray(Math.round(van * SR), Math.round(tot * SR)));
    const blok = Math.round(0.4 * SR), stap = Math.round(0.1 * SR);
    const z = [];
    for (let s = 0; s + blok <= k[0].length; s += stap) {
      let som = 0;
      for (const c of k) { let m = 0; for (let i = s; i < s + blok; i++) m += c[i] * c[i]; som += m / blok; }
      z.push(som);
    }
    const L = (m) => -0.691 + 10 * Math.log10(m);
    const abs = z.filter((m) => L(m) > -70);
    const gem = (l) => l.reduce((a, b) => a + b, 0) / l.length;
    const drempel = L(gem(abs)) - 10;
    return L(gem(abs.filter((m) => L(m) > drempel)));
  };
  // Tikken: de grootste tweede afgeleide (een sprong in het signaal of zijn helling).
  const d2max = (x, a, b) => { let m = 0; for (let i = Math.max(2, a); i < b; i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2])); return m; };
`;

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

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer && window.noten)').catch(() => false)) break; await wacht(200); }
  await wacht(800);

  // ---- 1. de app ------------------------------------------------------------------
  console.log('de app');
  ok('de app start, zonder MIDI in dit tabblad', await evalueer('!!window.engine && !!window.noten && !navigator.requestMIDIAccess'));
  ok('de rij staat standaard dicht', await evalueer("document.getElementById('instrument').classList.contains('hidden')"));
  await evalueer("document.getElementById('instrument-btn').click(), true");
  await wacht(300);
  ok('de knop in de balk opent de rij', await evalueer("!document.getElementById('instrument').classList.contains('hidden') && document.getElementById('instrument').offsetHeight > 20"));
  await evalueer('window.engine.resume()');
  await evalueer('window.engine.setFocus("C"), true');
  await wacht(200);
  // Twee beelden van de renderloop afwachten: die tekent de rij (headless kan rAF even ophouden).
  const beelden = () => evalueer(`Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    new Promise((r) => setTimeout(() => r(false), 3000))])`);
  ok('de renderloop tekent (requestAnimationFrame loopt)', await beelden());
  ok('de rij volgt de focus (track 3)', await evalueer("document.querySelector('#instrument .in-track').textContent === 'track 3' && document.querySelector('#instrument .in-kies').dataset.action === 'track.3.inst'"));
  const drukKnop = (sel) => evalueer(`(async () => { const el = document.querySelector(${JSON.stringify(sel)});
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await new Promise((r) => setTimeout(r, 40));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  await drukKnop('#instrument .in-kies');
  await wacht(100);
  await beelden();
  const na = await evalueer(`(() => ({ soort: window.engine.instrumentOp('C')?.soort ?? null,
    kies: document.querySelector('#instrument .in-kies').textContent,
    labels: [...document.querySelectorAll('#instrument .in-knop .knob-label')].map((e) => e.textContent).join(','),
    kolom: document.querySelector('.kol[data-deck="C"] .kol-titel').textContent,
    focus: document.querySelector('#focus-deck .deck-title').textContent }))()`);
  ok('"+ instrument" klikken: Poly staat op track 3', na.soort === 'poly' && na.kies === 'Poly', na.kies);
  ok('de acht knoppen heten naar de plekken van de Poly', na.labels === 'golf,ontstem,filter,reso,env,attack,decay/rel,sustain', na.labels);
  ok('kolom en focuskop tonen het instrument', na.kolom === '♪ Poly' && na.focus === '♪ Poly', `${na.kolom} / ${na.focus}`);
  // Spelen met de muis: een toets indrukken (bovenaan = zacht) en loslaten.
  const toets = await evalueer(`(async () => {
    const el = document.querySelector('#instrument .in-toets[data-noot="60"]');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.9 }));
    await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
    const klinkt = window.engine.instrumentOp('C').stand().klinkt;
    const aan = el.classList.contains('aan');
    const piek = window.engine.instrumentOp('C').stemmen.at(-1).vca.gain.value;
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    return { klinkt, aan, los: window.engine.instrumentOp('C').stemmen.at(-1).los, ingedrukt: [...window.noten.ingedrukt('C')].length };
  })()`);
  ok('een toets op het scherm speelt een noot op de speeltrack, en licht op', toets.klinkt === 1 && toets.aan, JSON.stringify(toets));
  ok('loslaten laat de noot los', toets.los && toets.ingedrukt === 0);
  await foto('instrument-rij.png');

  // ---- 2. Chrome: toonhoogte, uitklinken, luidheid, stemroof ------------------------
  console.log('\nChrome, OfflineAudioContext 48 kHz');
  const toon = await evalueer(`(async () => { ${HULP}
    const sinus = await alleen(3, (p) => { p.zetParam(1, 0.99); p.zetParam(2, 0); p.noteOn(69, 0.8); });
    const x = sinus.getChannelData(0).subarray(SR * 0.5, SR * 2.5);
    const zaag = await alleen(3, (p) => p.noteOn(69, 0.8));
    const z = zaag.getChannelData(0).subarray(SR * 0.5, SR * 2.5);
    return { sinus: nuldoorgang(x), laag: piekHz(z, 434, 440), hoog: piekHz(z, 440, 446), c4: nuldoorgang((await alleen(2, (p) => { p.zetParam(1, 0.99); p.zetParam(2, 0); p.noteOn(60, 0.8); })).getChannelData(0).subarray(SR * 0.5, SR * 1.5)) };
  })()`);
  const cent = (a, b) => 1200 * Math.log2(a / b);
  ok('A4 (69) = 440 Hz ± 2 cent (sinus, niet ontstemd)', Math.abs(cent(toon.sinus, 440)) < 2, `${toon.sinus.toFixed(3)} Hz, ${cent(toon.sinus, 440).toFixed(3)} ct`);
  ok('C4 (60) = 261,63 Hz ± 2 cent', Math.abs(cent(toon.c4, 261.6255653)) < 2, `${toon.c4.toFixed(3)} Hz`);
  const midden = Math.sqrt(toon.laag * toon.hoog);
  ok('standaardklank: de twee oscillatoren ±8 cent, symmetrisch om 440 (± 2 cent)', Math.abs(cent(midden, 440)) < 2
    && Math.abs(cent(toon.hoog, toon.laag) - 16) < 2, `${toon.laag.toFixed(2)} en ${toon.hoog.toFixed(2)} Hz, midden ${cent(midden, 440).toFixed(2)} ct`);

  const uitklinken = await evalueer(`(async () => { ${HULP}
    const R = PARAMS[6].eenheid(PARAMS[6].standaard);
    const b = await alleen(4, (p) => { p.noteOn(57, 0.8); p.noteOff(57, 1); });
    const x = b.getChannelData(0);
    // −999 in plaats van −∞: dat overleeft JSON (returnByValue maakt van −∞ null).
    const vlak = (t) => Math.max(-999, db(rms(x, Math.round(SR * t), Math.round(SR * (t + 0.05)))));
    const stappen = [];
    for (let t = 1.0; t < 3.9; t += 0.05) stappen.push(vlak(t));
    let stijgt = 0;
    for (let i = 1; i < stappen.length; i++) if (stappen[i] > stappen[i - 1] + 0.5 && stappen[i] > -100) stijgt++;
    let staart = 0; for (const v of x.subarray(SR * 2.2)) staart = Math.max(staart, Math.abs(v));
    return { R, voor: vlak(0.8), na: [vlak(1.4), vlak(2.0), vlak(2.5), vlak(3.5)], stijgt, staart };
  })()`);
  ok(`noteOff op 1 s (release ${uitklinken.R}): hij klinkt uit en is daarna stil`, uitklinken.na[2] < -90 && uitklinken.staart < 1e-4,
    `${uitklinken.voor.toFixed(1)} dB vóór, ${uitklinken.na.map((v) => (v > -999 ? v.toFixed(0) : '−∞')).join(' / ')} dB na 0,4 · 1 · 1,5 · 2,5 s`);
  ok('… en het uitklinken daalt alleen (geen bult, geen tweede aanzet)', uitklinken.stijgt === 0, `${uitklinken.stijgt} keer omhoog`);

  const luid = await evalueer(`(async () => { ${HULP}
    const b = await alleen(5, (p) => { for (const n of [60, 64, 67]) p.noteOn(n, 0.8); });
    let piek = 0; for (const c of [0, 1]) for (const v of b.getChannelData(c)) piek = Math.max(piek, Math.abs(v));
    return { lufs: lufs(b, 1, 5), piek: db(piek), OPHOGING };
  })()`);
  const nodig = luid.OPHOGING * Math.pow(10, (-14 - luid.lufs) / 20);
  ok('akkoord C4 E4 G4 op snelheid 0,8, standaardknoppen: rond −14 LUFS (± 1)', Math.abs(luid.lufs + 14) < 1,
    `${luid.lufs.toFixed(2)} LUFS, piek ${luid.piek.toFixed(1)} dBFS, OPHOGING ${luid.OPHOGING} (precies −14 = ${nodig.toFixed(4)})`);
  ok('… zonder te clippen (piek onder 0 dBFS)', luid.piek < 0, `${luid.piek.toFixed(1)} dBFS`);

  const roof = await evalueer(`(async () => { ${HULP}
    const opzet = (p) => { p.zetParam(1, 0.99); p.zetParam(2, 0); p.zetParam(3, 1); p.zetParam(6, 0.3); };
    const noten = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67];
    const meet = (b) => { const x = b.getChannelData(0); return { rust: d2max(x, SR * 0.5, SR * 0.95), rond: d2max(x, SR * 0.995, SR * 1.04) }; };
    // Gepland: twaalf noten aangehouden, de dertiende op 1,0 s (zoals een sequencer vooruit plant); de oudste (48) gaat eraf.
    const gepland = meet(await alleen(2, (p) => { opzet(p); noten.forEach((n) => p.noteOn(n, 0.7)); p.noteOn(69, 0.7, 1.0); }));
    // Live: de dertiende "nu", op 1,0 s (suspend), zoals een toets van het keyboard.
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR * 2, sampleRate: SR });
    const p = POLY.maak(ctx, { uit: ctx.destination });
    opzet(p);
    noten.forEach((n) => p.noteOn(n, 0.7));
    ctx.suspend(1.0).then(() => { p.noteOn(69, 0.7); ctx.resume(); });
    const live = meet(await ctx.startRendering());
    // Controle: dezelfde twaalf, de oudste stem hard afgekapt op 1,0 s (zonder fade).
    const afgekapt = meet(await alleen(2, (q) => { opzet(q); noten.forEach((n) => q.noteOn(n, 0.7)); q.stemmen[0].vca.gain.setValueAtTime(0, 1.0); }));
    return { gepland, live, afgekapt };
  })()`);
  const keer = (m) => (m.rond / m.rust).toFixed(2);
  ok('stemroof zonder tik, gepland: rond het roven hooguit 3× de tweede afgeleide van de rust ervoor', roof.gepland.rond < roof.gepland.rust * 3,
    `${keer(roof.gepland)}× (${roof.gepland.rond.toExponential(2)} tegen ${roof.gepland.rust.toExponential(2)})`);
  ok('stemroof zonder tik, live (een toets nu): idem', roof.live.rond < roof.live.rust * 3, `${keer(roof.live)}×`);
  ok('… en de meting ziet een echte tik wel: hard afkappen geeft een sprong', roof.afgekapt.rond > roof.afgekapt.rust * 50, `${keer(roof.afgekapt)}×`);

  const strip = await evalueer(`(async () => { ${HULP}
    const Echt = window.AudioContext;
    const meet = async (zet) => {
      window.AudioContext = class extends OfflineAudioContext { constructor() { super({ numberOfChannels: 2, length: SR * 2, sampleRate: SR }); } };
      let e;
      try { const { Engine } = await import('/src/engine/engine.js'); e = new Engine(); } finally { window.AudioContext = Echt; }
      e.zetInstrument('A', 'poly');
      const p = e.instrumentOp('A');
      p.zetParam(1, 0.99);                    // sinus, niet ontstemd: zuivere tonen om te meten
      p.zetParam(2, 0);
      p.zetParam(3, 1);                       // filter open: het filter van de STRIP doet het werk
      zet(e);
      p.noteOn(69, 0.8);
      p.noteOn(93, 0.8);                      // A6 (1760 Hz): om te zien wat het stripfilter doet
      const b = await e.ctx.startRendering();
      const x = b.getChannelData(0).subarray(SR * 0.5, SR * 1.5);
      return { a440: db(goertzel(x, 440)), a1760: db(goertzel(x, 1760)), rms: db(rms(x, 0, x.length)) };
    };
    return { open: await meet(() => {}), dicht: await meet((e) => e.deck('A').set('fader', 0)),
      lpf: await meet((e) => e.deck('A').set('filter', 0.05)) };
  })()`);
  ok('door de echte engine: het instrument klinkt via de strip naar de uitgang', strip.open.a440 > -40, `440 Hz ${strip.open.a440.toFixed(1)} dB`);
  ok('… fader dicht = weg (−70 dB)', strip.dicht.a440 < strip.open.a440 - 60, `${strip.dicht.a440.toFixed(1)} dB`);
  ok('… de filterknop van de strip neemt het hoog weg (1760 Hz zakt veel meer dan 440)', (strip.open.a1760 - strip.lpf.a1760) > (strip.open.a440 - strip.lpf.a440) + 15,
    `1760: ${(strip.open.a1760 - strip.lpf.a1760).toFixed(1)} dB, 440: ${(strip.open.a440 - strip.lpf.a440).toFixed(1)} dB zachter`);

  for (const m of meldingen) console.log(`  ! ${m}`);
  ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0, meldingen.length ? `${meldingen.length}` : '');
} catch (err) {
  console.error(err);
  uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGINT');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
