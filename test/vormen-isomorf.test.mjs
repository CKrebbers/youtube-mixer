// De vier isomorfe Vormmachines (sn, tv, ep, dw): beeld zonder geluid, en
// geluid alleen achter een sink. Nep-canvas en een nep-AudioContext die
// net zo streng is als Chrome over wat hij aanneemt. Op het 16:9-doek van
// de app (640 × 360, ROADMAP 7): het hele doek, niets uitgerekt, en het
// geluid precies als op het oude vierkant.
// Draai met: node test/vormen-isomorf.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN_ISOMORF, beeldKnoppen, klinkt, modalBuffer, drumCache, luchtCache, LUCHT_C, LUCHT_MODI, LUCHT_GESCHIEDENIS, fourier, epShape, midiFrom, mtof, nname } =
  await import('../src/vormen/systemen-isomorf.js');
const { draaiKnoppen, SYSTEMEN, LUTS, maakRng } = await import('../src/vormen/systemen.js');
const { maten, midden } = await import('../src/vormen/hulp.js');
const { LAAG_BREEDTE, LAAG_HOOGTE } = await import('../src/vormen/laag.js');
const W = LAAG_BREEDTE, H = LAAG_HOOGTE;

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Rekentijd in THREADTIJD: alleen de ms dat onze eigen JS-draad rekende, zonder
// de tijd dat de planner ons wegzet (onder load tot 330 ms voor een stap van 5)
// en zonder GC- en compilerdraden. Wat de stap zelf doet telt wel. Onder load
// rekenen we soms op een trage kern (2 à 3× zo duur): boven het budget nog eens
// meten, hooguit drie keer, de beste telt. Waarom zo: zie vormen.test.mjs.
const draadMs = () => { const t = process.threadCpuUsage(); return (t.user + t.system) / 1000; };

// ---- nep-canvas: elke tekenaanroep telt, niets tekent (zoals vormen.test) ---
function maakCanvas(w, h) {
  const tel = { n: 0 };
  const ctx = new Proxy({
    createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }),
    tel,
  }, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel };
}
// Een doek dat elke tekenaanroep met zijn argumenten bewaart (log.length = 0 om te wissen).
function maakOpneemCanvas(w, h) {
  const log = [], tel = { n: 0 };
  const ctx = new Proxy({
    createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }),
    tel,
  }, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { tel.n++; log.push([k, a]); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel, log };
}
/**
 * Van links tot rechts: het x-bereik van alles wat in `log` getekend is,
 * ZONDER de achtergrond (clear: één fillRect over het hele doek), want die
 * reikt altijd tot de randen en zegt niets over de vorm.
 */
function bereik(log, w = W, h = H) {
  let lo = Infinity, hi = -Infinity;
  const zet = (a, b = a) => { lo = Math.min(lo, a); hi = Math.max(hi, b); };
  for (const [k, a] of log) {
    if (k === 'moveTo' || k === 'lineTo') zet(a[0]);
    else if (k === 'arc') zet(a[0] - a[2], a[0] + a[2]);
    else if (k === 'fillRect' && !(a[0] === 0 && a[1] === 0 && a[2] === w && a[3] === h)) zet(a[0], a[0] + a[2]);
    else if (k === 'drawImage') zet(a[1], a[1] + a[3]);
  }
  return { lo, hi };
}
function getallen(s, uit = [], diep = 0) {
  if (diep > 3 || s == null) return uit;
  if (typeof s === 'number') uit.push(s);
  else if (ArrayBuffer.isView(s)) { for (let i = 0; i < s.length; i += Math.max(1, s.length >> 6)) uit.push(s[i]); }
  else if (Array.isArray(s)) s.slice(0, 64).forEach((x) => getallen(x, uit, diep + 1));
  else if (typeof s === 'object' && !s.getContext && !s.px && !s.ctx && typeof s !== 'function') Object.values(s).forEach((x) => getallen(x, uit, diep + 1));
  return uit;
}

// ---- nep-AudioContext ------------------------------------------------------
// Telt wat er gemaakt wordt en weigert wat Chrome ook weigert: buffer van
// lengte 0, twee keer starten, negatieve offset/duur, connect naar iets dat
// geen node is of naar een ingang die niet bestaat, PeriodicWave met
// ongelijke of te korte arrays.
function maakNepCtx({ state = 'running', sampleRate = 48000 } = {}) {
  const tel = { buffer: 0, bron: 0, gain: 0, osc: 0, golf: 0, merger: 0, panner: 0, start: 0, connect: 0 };
  const ctx = { state, sampleRate, currentTime: 0, tel };
  const param = (v) => {
    const p = { value: v, _log: [] };
    for (const f of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues']) {
      p[f] = (x, t) => { if (!Number.isFinite(x) || !Number.isFinite(t ?? 0)) throw new TypeError(`${f}: geen eindig getal`); p._log.push([f, x, t]); return p; };
    }
    return p;
  };
  const node = (ingangen, uitgangen, extra = {}) => {
    const n = {
      numberOfInputs: ingangen, numberOfOutputs: uitgangen, _uit: [],
      connect(dest, o = 0, i = 0) {
        if (!dest || typeof dest.numberOfInputs !== 'number') throw new TypeError('connect: geen AudioNode');
        if (o >= uitgangen || i >= dest.numberOfInputs) throw new RangeError('connect: index buiten bereik');
        tel.connect++; n._uit.push(dest); return dest;
      },
      disconnect() { n._uit.length = 0; },
      ...extra,
    };
    return n;
  };
  // Start en stop op de node zelf (geen spread: een getter zou dan bevriezen).
  const bron = (n, soort) => {
    let gestart = false;
    n._gestopt = false;
    n.start = (when = 0, offset = 0, dur) => {
      if (gestart) throw new Error('InvalidStateError: al gestart');
      if (when < 0 || offset < 0 || (dur !== undefined && dur < 0)) throw new RangeError(`${soort}.start: negatief`);
      gestart = true; tel.start++;
    };
    n.stop = () => { if (!gestart) throw new Error('InvalidStateError: niet gestart'); n._gestopt = true; };
    return n;
  };
  ctx.destination = node(1, 0);
  ctx.createBuffer = (ch, len, sr) => {
    if (!(len >= 1) || !(ch >= 1) || !(sr >= 3000)) throw new Error('NotSupportedError: createBuffer');
    tel.buffer++;
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => data[c] };
  };
  ctx.createBufferSource = () => { tel.bron++; return bron(node(0, 1, { buffer: null, playbackRate: param(1) }), 'bron'); };
  ctx.createGain = () => { tel.gain++; return node(1, 1, { gain: param(1) }); };
  ctx.createStereoPanner = () => { tel.panner++; return node(1, 1, { pan: param(0) }); };
  ctx.createChannelMerger = (n = 6) => { tel.merger++; return node(n, 1); };
  ctx.createOscillator = () => {
    tel.osc++;
    return bron(node(0, 1, { frequency: param(440), type: 'sine', setPeriodicWave(w) { if (!w?._golf) throw new TypeError('geen PeriodicWave'); this.type = 'custom'; } }), 'osc');
  };
  ctx.createPeriodicWave = (re, im) => {
    if (re.length !== im.length || re.length < 2) throw new Error('IndexSizeError: PeriodicWave');
    tel.golf++;
    return { _golf: true };
  };
  return ctx;
}
const nepSink = (opties = {}) => {
  const ctx = maakNepCtx(opties);
  return { ctx, uit: ctx.createGain(), grondtoon: 57 };
};
const telOp = (ctx) => Object.values(ctx.tel).reduce((a, b) => a + b, 0);

// ---- een g zoals VormLaag.zetSysteem hem maakt ------------------------------
// Op het doek van de app (640 × 360), met maten() uit hulp.js. Die kent geen
// g.S meer: gebruikt een systeem hem nog, dan wordt het NaN.
function maakG(sys, { zaad = 7, breedte = W, hoogte = H, geluid = null, kwaliteit, opname = false } = {}) {
  const canvas = opname ? maakOpneemCanvas(breedte, hoogte) : maakCanvas(breedte, hoogte);
  const g = { ctx: canvas.getContext('2d'), ...maten(breedte, hoogte), t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas, geluid };
  if (kwaliteit !== undefined) g.kwaliteit = kwaliteit;
  return { g, canvas };
}
function start(sys, opties = {}) {
  const { g, canvas } = maakG(sys, opties);
  const p = Object.fromEntries(sys.knobs.map((k) => [k.k, k.v]));
  Object.assign(p, opties.p ?? {});
  const s = { o: {}, e: {} };
  sys.init.call(sys, s, p, g);
  return { s, p, g, canvas };
}
function draai(run, stappen, t0 = 0) {
  const { s, p, g } = run;
  const sys = run.sys;
  for (let i = 0; i < stappen; i++) { g.t = t0 + i / 60; sys.step.call(sys, s, p, g); }
}
const loop = (sys, opties = {}, stappen = 180) => { const run = { sys, ...start(sys, opties) }; draai(run, stappen); return run; };

console.log('de vier isomorfe systemen');
{
  const bron = readFileSync(new URL('../src/vormen/systemen-isomorf.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('kent geen DOM, geen eigen klok, geen Math.random, geen Path2D', !/\bdocument\b|\bwindow\b|performance\.now|Math\.random|Path2D/.test(bron));
  const imports = [...bron.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  ok('importeert alleen uit ./hulp.js', imports.length > 0 && imports.every((i) => i === './hulp.js'));
  ok('sn, tv, ep, dw, in die volgorde', SYSTEMEN_ISOMORF.map((s) => s.id).join() === 'sn,tv,ep,dw');
  ok('ze staan in SYSTEMEN, en geen id komt twee keer voor', SYSTEMEN_ISOMORF.every((s) => SYSTEMEN.includes(s)) && new Set(SYSTEMEN.map((s) => s.id)).size === SYSTEMEN.length);
  ok('elk systeem heeft naam, sub, cat Isomorf, een palet dat bestaat', SYSTEMEN_ISOMORF.every((s) => s.naam && s.sub && s.cat === 'Isomorf' && LUTS[s.pal]));

  const echt = Math.random;
  Math.random = () => { throw new Error('Math.random gebruikt'); };
  for (const sys of SYSTEMEN_ISOMORF) {
    let fout = null, run = null;
    try { run = loop(sys); } catch (e) { fout = e; }
    const nums = run ? getallen(run.s) : [];
    ok(`${sys.id} (${sys.naam}): 180 stappen zonder fout, zonder NaN, en hij tekent`,
      !fout && nums.length > 10 && nums.every(Number.isFinite) && run.canvas.tel.n > 0);
    if (fout) console.log('      ', fout.stack);
    const outs = run ? Object.entries(run.s.o) : [];
    ok(`${sys.id}: uitgangen ${sys.outs.join(', ')} bestaan en liggen in 0..1`,
      sys.outs.every((k) => k in (run?.s.o ?? {})) && outs.every(([, v]) => Number.isFinite(v) && v >= 0 && v <= 1));
  }
  // Zelf spelen: sn en tv slaan zelf aan op g.t (niet op een eigen klok).
  const sn = loop(SYSTEMEN_ISOMORF[0]);
  ok('sn slaat uit zichzelf aan (auto 0,8/s) en heeft dan een noot en energie', sn.s.e.aanslag === 1 && /^[A-G]/.test(sn.s.note) && sn.s.E > 0);
  const tv = loop(SYSTEMEN_ISOMORF[1]);
  ok('tv slaat uit zichzelf aan', tv.s.e.slag === 1 && tv.s.hit && tv.s.E > 0);
  const stil = loop(SYSTEMEN_ISOMORF[0], { p: { auto: 0 } });
  ok('sn met auto 0: geen aanslag', !stil.s.e.aanslag && stil.s.E === 0);
  // De acts werken met g (g.t, g.r), zonder performance.now of Math.random.
  let actFout = null;
  try {
    for (const sys of SYSTEMEN_ISOMORF) {
      const run = { sys, ...start(sys, { p: { auto: 0 } }) };
      run.g.t = 12.5;
      for (const naam in sys.act) sys.act[naam](run.s, run.p, run.g);
      draai(run, 5, 12.5);
      if (!getallen(run.s).every(Number.isFinite)) throw new Error(`${sys.id}: NaN na act`);
    }
  } catch (e) { actFout = e; }
  ok('elke act (aanslaan, slaan, volgende, uitbarsting, verstrooi) werkt op g.t en g.r', !actFout);
  if (actFout) console.log('      ', actFout.message);
  {
    const run = { sys: SYSTEMEN_ISOMORF[0], ...start(SYSTEMEN_ISOMORF[0], { p: { auto: 0 } }) };
    run.g.t = 40; SYSTEMEN_ISOMORF[0].act.aanslaan(run.s, run.p, run.g);
    ok('aanslaan zet de aanslag op g.t', run.s.t0 === 40);
  }
  Math.random = echt;

  const na = (sys, zaad) => getallen(loop(sys, { zaad }, 90).s);
  for (const sys of SYSTEMEN_ISOMORF) {
    const a = na(sys, 3), b = na(sys, 3);
    ok(`${sys.id}: zelfde zaad = precies dezelfde toestand`, a.length > 10 && a.length === b.length && a.every((x, i) => Object.is(x, b[i])));
  }
  const d3 = na(SYSTEMEN_ISOMORF[3], 3), d4 = na(SYSTEMEN_ISOMORF[3], 4);
  ok('dw: ander zaad = andere wolk', d3.some((x, i) => x !== d4[i]));
}

console.log('knoppen');
{
  for (const sys of SYSTEMEN_ISOMORF) {
    const dk = draaiKnoppen(sys), bk = beeldKnoppen(sys);
    ok(`${sys.id}: draaiKnoppen ${dk.length} (1..6), zonder sink ${bk.length}: ${bk.map((k) => k.k).join(' ')}`,
      dk.length >= 1 && dk.length <= 6 && bk.length >= 1 && bk.length <= 6);
  }
  const vol = SYSTEMEN_ISOMORF.map((s) => s.knobs.find((k) => k.k === 'vol'));
  ok('elke vol-knop is fix en gemarkeerd als geluid, en staat achteraan', vol.every((k, i) => k && k.fix && k.geluid && SYSTEMEN_ISOMORF[i].knobs.at(-1) === k));
  ok('zonder sink geen vol-knop op een draaiknop (draaiKnoppen slaat geluid-knoppen over)',
    SYSTEMEN_ISOMORF.every((s) => !draaiKnoppen(s).some((k) => k.geluid) && beeldKnoppen(s).map((k) => k.k).join() === draaiKnoppen(s).map((k) => k.k).join()));
  ok('ep: de vormkeuze is een keuzelijst die opnieuw begint, geen draaiknop', !draaiKnoppen(SYSTEMEN_ISOMORF[2]).some((k) => k.k === 'f'));
}

console.log('de klok (regel 3): g.t, ook als hij terugloopt');
{
  const sys = SYSTEMEN_ISOMORF[0];
  const run = { sys, ...start(sys) };
  draai(run, 200, 100);                    // tot 103,3 s; er is aangeslagen
  const sinds = run.g.t - run.s.t0, E = run.s.E;
  draai(run, 1, 2);                        // nieuwe AudioContext: t = 2
  ok('sn: klok terug -> de aanslag schuift mee, geen explosie', bij(run.g.t - run.s.t0, sinds, 1e-6) && run.s.E <= E * 1.01 + 1e-9);
  ok('sn: en hij blijft zelf spelen (volgende aanslag niet 100 s weg)', run.s.next - run.g.t < 3);
  const tvs = SYSTEMEN_ISOMORF[1], tv = { sys: tvs, ...start(tvs) };
  draai(tv, 200, 100); draai(tv, 60, 2);
  ok('tv: klok terug -> gewoon door, niets oneindig', getallen(tv.s).every(Number.isFinite) && tv.s.next - tv.g.t < 3 && tv.s.E < 50);
  const eps = SYSTEMEN_ISOMORF[2], ep = { sys: eps, ...start(eps) };
  draai(ep, 60, 50); const ph = ep.s.ph; draai(ep, 1, 1);
  ok('ep: klok terug -> fase staat stil, niet achteruit', ep.s.ph === ph);
  // Snelheid in seconden: 60 stappen = 1 s = sp omwentelingen, los van kwaliteit.
  const snel = (kw) => { const r = { sys: eps, ...start(eps, { kwaliteit: kw }) }; draai(r, 61); return r.s.ph; };
  ok('ep: 1 s draaien = draaisnelheid × 1 s', bij(snel(1), 0.1, 1e-9));
}

console.log('g.kwaliteit: grover beeld, zelfde beweging, goedkoper');
{
  const tijd = (sys, kw, n = 180) => {
    const run = { sys, ...start(sys, { kwaliteit: kw }) };
    const ts = [];
    for (let i = 0; i < n; i++) { run.g.t = i / 60; const t0 = draadMs(); sys.step.call(sys, run.s, run.p, run.g); ts.push(draadMs() - t0); }
    return { run, gem: ts.reduce((a, b) => a + b, 0) / n, max: Math.max(...ts.slice(1)), eerste: ts[0], calls: run.canvas.tel.n };
  };
  // Opwarmen (JIT), zodat de meting niet de compiler meet.
  for (const sys of SYSTEMEN_ISOMORF) { tijd(sys, 1, 60); tijd(sys, 0.25, 60); }
  for (const sys of SYSTEMEN_ISOMORF) {
    let hoog = tijd(sys, 1);
    for (let poging = 1; poging < 3 && hoog.max >= 16; poging++) { const m = tijd(sys, 1); if (m.max < hoog.max) hoog = m; }
    const laag = tijd(sys, 0.25);
    console.log(`      ${sys.id}: kwaliteit 1: gem ${hoog.gem.toFixed(3)} ms, max ${hoog.max.toFixed(2)} ms, ${hoog.calls} tekenaanroepen · 0,25: gem ${laag.gem.toFixed(3)} ms, max ${laag.max.toFixed(2)} ms, ${laag.calls}`);
    ok(`${sys.id}: kwaliteit 0,25 werkt (geen NaN, tekent)`, getallen(laag.run.s).every(Number.isFinite) && laag.calls > 0);
    ok(`${sys.id}: en is goedkoper (minder tekenaanroepen of ≥ 25% minder tijd)`, laag.calls < hoog.calls || laag.gem < hoog.gem * 0.75);
    ok(`${sys.id}: max < 16 ms per stap bij kwaliteit 1`, hoog.max < 16);
    // De beweging hangt niet af van de kwaliteit: de fysica is dezelfde.
    const velden = { sn: ['A', 't0', 'deg', 'next'], tv: ['a', 'b', 't0', 'next'], ep: ['ph'], dw: ['x', 'y', 'vx', 'vy'] }[sys.id];
    const zelfde = velden.every((v) => getallen(hoog.run.s[v]).every((x, i) => Object.is(x, getallen(laag.run.s[v])[i])));
    ok(`${sys.id}: zelfde beweging bij kwaliteit 0,25 (${velden.join(', ')})`, zelfde);
  }
  const zonder = start(SYSTEMEN_ISOMORF[1]);
  ok('kwaliteit ontbreekt = 1 (tv rekent op het volle vel van 110)', Object.keys(zonder.s.vellen).join() === '110');
  const onzin = { sys: SYSTEMEN_ISOMORF[1], ...start(SYSTEMEN_ISOMORF[1], { kwaliteit: NaN }) };
  draai(onzin, 3);
  ok('kwaliteit NaN = 1, geen fout', Object.keys(onzin.s.vellen).join() === '110');
  const wissel = { sys: SYSTEMEN_ISOMORF[1], ...start(SYSTEMEN_ISOMORF[1]) };
  draai(wissel, 10); wissel.g.kwaliteit = 0.3; draai(wissel, 10, 1); wissel.g.kwaliteit = 1; draai(wissel, 10, 2);
  ok('tv: kwaliteit wisselen tijdens het spelen; elk vel één keer gemaakt', Object.keys(wissel.s.vellen).sort().join() === '110,55');
}

console.log('geluid: alleen achter een sink');
{
  const [SN, TV, EP, DW] = SYSTEMEN_ISOMORF;
  ok('klinkt(): alleen met een sink waarvan de context speelt',
    !klinkt({ geluid: null }) && !klinkt({}) && klinkt({ geluid: nepSink() }) && !klinkt({ geluid: nepSink({ state: 'suspended' }) }));

  // Zonder sink: geen enkele Web Audio-aanroep. We geven een context die
  // gooit bij elke aanroep; hij zit nergens aan vast, dus als er toch iets
  // gebeurt, is het via een globaal (dat mag ook niet).
  const echteAC = globalThis.AudioContext;
  globalThis.AudioContext = function () { throw new Error('AudioContext gemaakt'); };
  let fout = null;
  try { for (const sys of SYSTEMEN_ISOMORF) { const r = loop(sys, { p: { auto: 4, dens: 50 } }, 240); for (const n in sys.act) sys.act[n](r.s, r.p, r.g); } } catch (e) { fout = e; }
  globalThis.AudioContext = echteAC;
  ok('zonder sink: 240 stappen en alle acts zonder één Web Audio-aanroep', !fout);

  // Een sink waarvan de context niet speelt (gebruiker heeft nog niet geklikt): niets.
  for (const sys of SYSTEMEN_ISOMORF) {
    const sink = nepSink({ state: 'suspended' });
    sink.korrelBuffer = sink.ctx.createBuffer(2, 48000 * 3, 48000);
    const voor = telOp(sink.ctx);
    loop(sys, { geluid: sink, p: { auto: 4, dens: 50 } }, 240);
    ok(`${sys.id}: sink in 'suspended' -> geen enkele aanroep`, telOp(sink.ctx) === voor);
  }

  // Met een sink die speelt.
  {
    const sink = nepSink();
    const r = loop(SN, { geluid: sink, p: { auto: 2 } }, 240);
    const t = sink.ctx.tel;
    ok(`sn: elke aanslag een modale buffer die speelt (${t.buffer} buffers, ${t.start} starts)`, t.buffer >= 3 && t.bron === t.buffer && t.start === t.bron && t.panner === t.bron);
    ok('sn: alles eindigt op sink.uit', sink.uit !== null && r.s.E > 0);
  }
  {
    const sink = nepSink();
    loop(TV, { geluid: sink, p: { auto: 2 } }, 240);
    ok(`tv: slagen klinken (${sink.ctx.tel.buffer})`, sink.ctx.tel.buffer >= 3 && sink.ctx.tel.start === sink.ctx.tel.buffer);
  }
  {
    const sink = nepSink();
    const r = { sys: EP, ...start(EP, { geluid: sink }) };
    draai(r, 30);
    const t = sink.ctx.tel;
    ok(`ep: twee oscillatoren (L = x, R = y) in een merger, één keer gemaakt`, t.osc === 2 && t.merger === 1 && t.golf === 2 && t.start === 2);
    const gain = r.s.au.g.gain._log;
    ok('ep: gain gaat naar vol × 0,3, één keer (niet elke stap)', gain.length === 1 && bij(gain[0][1], 0.5 * 0.3));
    r.p.K = 30; draai(r, 10, 1);
    ok('ep: meer cirkels -> nieuwe golfvorm', t.golf === 4);
    EP.gate(r.s, r.p, false, r.g);
    ok('ep: gate uit -> gain naar 0', r.s.au.g.gain._log.at(-1)[1] === 0);
    const au = r.s.au;
    EP.stop(r.s);
    ok('ep: stop ruimt de oscillatoren op', r.s.au === null && au.oL._gestopt && au.oR._gestopt);
    draai(r, 3, 2);
    ok('ep: speelt hij weer, dan nieuwe oscillatoren', sink.ctx.tel.osc === 4);
    r.g.geluid = null;
    const oud = r.s.au;
    draai(r, 3, 3);
    ok('ep: sink weg -> oscillatoren gestopt en los', r.s.au === null && oud.oL._gestopt && oud.g._uit.length === 0);
  }
  {
    const sink = nepSink();
    loop(DW, { geluid: sink, p: { dens: 20 } }, 180);
    ok('dw: zonder korrelBuffer in de sink geen geluid (maar wel korrels in beeld)', telOp(sink.ctx) === 1 /* de gain van sink.uit */);
    const met = nepSink();
    met.korrelBuffer = met.ctx.createBuffer(2, 48000 * 3, 48000);
    const r = loop(DW, { geluid: met, p: { dens: 20 } }, 180);
    ok(`dw: met korrelBuffer: ~20 korrels/s klinken (${met.ctx.tel.start} in 3 s)`, met.ctx.tel.start >= 40 && met.ctx.tel.start <= 80 && r.s.e.korrel === 1);
    const kort = nepSink();
    kort.korrelBuffer = kort.ctx.createBuffer(1, 4800, 48000);   // 0,1 s: korter dan een korrel
    let f = null;
    try { loop(DW, { geluid: kort, p: { dens: 30, size: 0.4 } }, 120); } catch (e) { f = e; }
    ok('dw: korrelBuffer korter dan een korrel: geen negatieve offset', !f);
  }

  // Het beeld hangt niet af van de sink: zelfde zaad, zelfde toestand.
  for (const sys of SYSTEMEN_ISOMORF) {
    const sink = nepSink();
    sink.korrelBuffer = sink.ctx.createBuffer(2, 48000 * 3, 48000);
    const velden = { sn: ['A', 'deg', 'next', 'E'], tv: ['a', 'b', 'next', 'E'], ep: ['ph', 'tip'], dw: ['x', 'y', 'f'] }[sys.id];
    const met = loop(sys, { geluid: sink, zaad: 5 }, 150), zonder = loop(sys, { zaad: 5 }, 150);
    ok(`${sys.id}: met of zonder sink precies hetzelfde beeld`, velden.every((v) => getallen(met.s[v]).every((x, i) => Object.is(x, getallen(zonder.s[v])[i]))));
  }

  // Wat een aanslag kost met geluid (modale synthese op de hoofdthread).
  for (const [sys, p, wat] of [[SN, {}, 'sn standaard'], [SN, { damp: 4, hel: 1 }, 'sn langste uitklinktijd'], [TV, {}, 'tv standaard'], [TV, { damp: 3, hard: 1 }, 'tv langste']]) {
    const sink = nepSink();
    const r = { sys, ...start(sys, { geluid: sink, p: { auto: 0, ...p } }) };
    r.g.t = 1;
    const t0 = performance.now();
    for (const n in sys.act) sys.act[n](r.s, r.p, r.g);
    console.log(`      ${wat}: één aanslag met sink kost ${(performance.now() - t0).toFixed(1)} ms (buffer op de hoofdthread)`);
  }
}

console.log('de hulpjes');
{
  ok('midiFrom: trap 0 = de grondtoon, trap 5 = een octaaf hoger (pentatonisch)', midiFrom(57, 0) === 57 && midiFrom(57, 5) === 69 && midiFrom(57, -1) === 55);
  ok('midiFrom: andere toonladder', midiFrom(60, 2, 'Dorisch') === 63);
  ok('mtof en nname', bij(mtof(69), 440) && nname(69) === 'A4' && nname(57) === 'A3');
  const C = maakNepCtx();
  const b = modalBuffer(C, [440, 880], [1, 0.5], [0.3, 0.2], 0.5, 0.2, maakRng(1));
  const d = b.getChannelData(0);
  let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x));
  ok('modalBuffer: genormaliseerd op 0,6, zachte inzet', bij(pk, 0.6, 1e-6) && d[0] === 0 && b.length === 24000);
  const dc = drumCache(110), dc2 = drumCache(55);
  ok('drumCache: per maat één keer, pixels binnen het vel', drumCache(110) === dc && dc.idx.length > 0.7 * 110 * 110 && dc.idx.length < 0.8 * 110 * 110 && dc2.idx.length < dc.idx.length);
  const f = fourier(epShape(0));
  ok('fourier: 255 cirkels, grootste eerst', f.length === 255 && Math.hypot(f[0].re, f[0].im) >= Math.hypot(f[1].re, f[1].im));
}

console.log('16:9 (ROADMAP 7): het hele doek, niets uitgerekt, het geluid hetzelfde');
{
  const [SN, TV, EP, DW] = SYSTEMEN_ISOMORF;
  const bron = readFileSync(new URL('../src/vormen/systemen-isomorf.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('noemt g.S niet meer, en geen verouderd rooster(g, getal)', !/\bg\.S\b/.test(bron) && !/rooster\(\s*g\s*,(?!\s*\{)/.test(bron));

  // Na 3 s: wat de laatste stap tekent reikt van rand tot rand, en niet ver buiten het doek.
  for (const sys of SYSTEMEN_ISOMORF) {
    const run = { sys, ...start(sys, { opname: true }) };
    draai(run, 179); run.canvas.log.length = 0; draai(run, 1, 179 / 60);
    const { lo, hi } = bereik(run.canvas.log);
    ok(`${sys.id}: het beeld reikt van ${lo.toFixed(0)} tot ${hi.toFixed(0)} px op ${W}: de hele breedte`, lo <= 0.1 * W && hi >= 0.9 * W && lo >= -0.05 * W && hi <= 1.05 * W);
  }

  // sn: de snaar van rand tot rand (rand = 8% van de hoogte), hoogtes op H.
  {
    const run = { sys: SN, ...start(SN, { opname: true, p: { auto: 0 } }) };
    run.g.t = 1; SN.act.aanslaan(run.s, run.p, run.g); run.canvas.log.length = 0; draai(run, 1, 1.5);
    const r = H * 0.08, pad = run.canvas.log.filter(([k]) => k === 'moveTo' || k === 'lineTo').map(([, a]) => a);
    ok('sn: de snaar loopt van 0,08 H tot W − 0,08 H, op 0,4 H', pad.some(([x, y]) => bij(x, r, 1e-9) && bij(y, 0.4 * H, 1e-6)) && pad.some(([x, y]) => bij(x, W - r, 1e-9) && bij(y, 0.4 * H, 0.5)));
    const plek = (pos) => (r + (W - 2 * r) * pos) / W;
    const a = { sys: SN, ...start(SN, { p: { auto: 0 } }) }, b = { sys: SN, ...start(SN, { p: { auto: 0 } }) };
    a.g.t = b.g.t = 2;
    SN.pointer(a.s, a.p, plek(0.3), 0.4, true, a.g); SN.strike(b.s, b.p, 0.3, b.g);
    ok('sn: klikken op 30% van de snaar = aanslaan op plukplek 0,3', a.s.A.every((x, i) => bij(x, b.s.A[i], 1e-6)));
  }

  // tv: het vel rond en vierkant in het midden, de lucht over het hele doek.
  {
    const run = { sys: TV, ...start(TV, { opname: true }) };
    draai(run, 120); run.canvas.log.length = 0; draai(run, 1, 2);
    const plaatjes = run.canvas.log.filter(([k]) => k === 'drawImage').map(([, a]) => a), v = run.s.vellen[110];
    const { vak } = midden(run.g);
    ok('tv: de lucht over het hele doek, daarna het vel (110 × 110) in het vierkant in het midden',
      plaatjes.length === 2 && plaatjes[0][0] === v.lg.c && plaatjes[0].slice(1).join() === `0,0,${W},${H}` &&
      plaatjes[1][0] === v.g.c && v.g.nx === 110 && v.g.ny === 110 && plaatjes[1].slice(1).join() === [vak.x, vak.y, vak.b, vak.h].join() && vak.b === H && vak.x === (W - H) / 2);
    const lc = v.LC;
    ok(`tv: lucht ${lc.nx} × ${lc.ny} cellen (twee velpixels), ${lc.idx.length} buiten het vel, op afstand gesorteerd`,
      lc.nx === 98 && lc.ny === 55 && lc.rho.every((x, i) => i === 0 || x >= lc.rho[i - 1]) && lc.idx.length > 0.5 * lc.nx * lc.ny && lc.idx.length < 0.75 * lc.nx * lc.ny);
    ok('tv: alleen m ≤ 2 straalt uit (9 van de 16 modi), en de lucht begint op nul aan de rand',
      LUCHT_MODI.length === 9 && [...lc.P.subarray(0, lc.NL * 4)].every((x) => Math.abs(x) < 1e-3));
    ok('tv: luchtCache per doek één keer', luchtCache(98, 55, W, H) === lc);

    // Het front: één slag, dan loopt de lucht met LUCHT_C naar buiten; verder weg nog niets.
    // (Lange uitklinktijd, zodat de lucht na een paar seconden nog duidelijk beweegt.)
    const eenSlag = () => { const r = { sys: TV, ...start(TV, { zaad: 4, p: { auto: 0, damp: 3 } }) }; r.g.t = 1; TV.act.slaan(r.s, r.p, r.g); return r; };
    const een = eenSlag(), lv = een.s.vellen[110], leeg = een.g.L[128], n = lv.LC.idx.length;
    const cellen = (run, f) => { let x = 0; for (let q = 0; q < n; q++) if (f(lv.LC.rho[q], run.s.vellen[110].lg.px[lv.LC.idx[q]], q)) x++; return x; };
    draai(een, 1, 1.5);
    const front = LUCHT_C * 0.5;
    const voor = cellen(een, (r, pix) => r > 0.02 && r < front - 0.05 && pix !== leeg), achter = cellen(een, (r, pix) => r > front + 0.05 && pix !== leeg);
    ok(`tv: 0,5 s na de eerste slag: lucht tot ρ = ${front} (${voor} cellen), daarachter nog stil (${achter})`, voor > 50 && achter === 0);
    draai(een, 1, 3.2);
    const ver = cellen(een, (r) => r > 0.8), verBeweegt = cellen(een, (r, pix) => r > 0.8 && pix !== leeg);
    ok(`tv: 2,2 s na de slag is het front voorbij de verste hoek (${verBeweegt} van ${ver} verre cellen bewegen)`, ver > 50 && verBeweegt > 0.6 * ver);
    // Een tweede slag: voorbij zijn front klinkt de eerste nog (geen flits over de hele lucht).
    const twee = eenSlag();
    draai(twee, 1, 3.2);
    twee.g.t = 3.2; TV.act.slaan(twee.s, twee.p, twee.g);
    ok(`tv: een slag schuift de vorige in de geschiedenis (${LUCHT_GESCHIEDENIS} terug)`, twee.s.hist.length === LUCHT_GESCHIEDENIS && twee.s.hist[0].t0 === 1 && twee.s.hist[1].t0 === 0);
    draai(een, 1, 3.4); draai(twee, 1, 3.4);
    const f2 = LUCHT_C * 0.2;
    const verGelijk = cellen(twee, (r, pix, q) => r > f2 + 0.05 && pix === een.s.vellen[110].lg.px[lv.LC.idx[q]]), verAlle = cellen(twee, (r) => r > f2 + 0.05);
    const dichtAnders = cellen(twee, (r, pix, q) => r < f2 - 0.05 && pix !== een.s.vellen[110].lg.px[lv.LC.idx[q]]);
    ok(`tv: 0,2 s na een tweede slag: voorbij zijn front precies de lucht van de eerste (${verGelijk} van ${verAlle}), ervoor de nieuwe (${dichtAnders} anders)`,
      verAlle > 100 && verGelijk === verAlle && dichtAnders > 20);
    // Klok terug: de leeftijd van de vorige slag blijft gelijk.
    const leeftijd = twee.g.t - twee.s.hist[0].t0;
    draai(twee, 1, 0.5);
    ok('tv: klok terug -> de eerdere slagen schuiven mee', bij(twee.g.t - twee.s.hist[0].t0, leeftijd, 1e-9));
    // Klikken: een kwart van de korte zijde rechts van het midden = slagstraal 0,5.
    const k = { sys: TV, ...start(TV, { p: { auto: 0 } }) };
    k.g.t = 1; TV.pointer(k.s, k.p, (W / 2 + H / 4) / W, 0.5, true, k.g);
    ok('tv: klikken rekent in de korte zijde rond het midden (rechts van het midden = straal 0,5, hoek 0)', bij(k.s.hit.x, 0.5, 1e-9) && bij(k.s.hit.y, 0, 1e-9));
  }

  // ep: de figuur rond het midden op de korte zijde; L en R als golfvorm ernaast.
  {
    const run = { sys: EP, ...start(EP, { opname: true }) };
    draai(run, 90); run.canvas.log.length = 0; draai(run, 1, 1.5);
    const { cx, cy, kort } = midden(run.g), sc = kort * 0.36, b = kort * 0.47;
    const pad = run.canvas.log.filter(([k]) => k === 'moveTo' || k === 'lineTo').map(([, a]) => a);
    const begint = (X, v) => pad.some(([x, y]) => bij(x, X, 1e-9) && Math.abs(y - (cy + v * sc)) < 2);
    ok(`ep: de punt staat niet op de as (x ${run.s.tip[0].toFixed(2)}, y ${run.s.tip[1].toFixed(2)}), dus de volgende twee zeggen iets`, Math.abs(run.s.tip[0]) > 0.1 && Math.abs(run.s.tip[1]) > 0.1);
    ok('ep: rechts begint kanaal R bij de figuur op de hoogte van de punt (y)', begint(cx + b, run.s.tip[1]));
    ok('ep: links begint kanaal L bij de figuur met de x van de punt', begint(cx - b, run.s.tip[0]));
    ok('ep: de golfvormen blijven binnen de hoogte van de figuur', pad.filter(([x]) => x > cx + b || x < cx - b).every(([, y]) => Math.abs(y - cy) <= sc * 1.3));
    // Tekenen: een cirkel op het scherm blijft een cirkel (x * 2 - 1 maakte er een ovaal van).
    const t = { sys: EP, ...start(EP) };
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * 2 * Math.PI;
      EP.pointer(t.s, t.p, (cx + 100 * Math.cos(a)) / W, (cy + 100 * Math.sin(a)) / H, i === 0, t.g);
    }
    EP.pointerUp(t.s);
    const [c0, c1] = t.s.list, m0 = Math.hypot(c0.re, c0.im), m1 = Math.hypot(c1.re, c1.im);
    ok(`ep: een getekende cirkel wordt één cirkel (grootste ${m0.toFixed(3)}, tweede ${m1.toFixed(3)})`, m0 > 0.95 && m1 < 0.03);
    const smal = { sys: EP, ...start(EP, { breedte: 360, hoogte: 360, opname: true }) };
    draai(smal, 30);
    const smalPad = smal.canvas.log.filter(([k]) => k === 'moveTo' || k === 'lineTo');
    ok('ep: op een vierkant doek geen golfvormen (geen ruimte), de figuur blijft', smalPad.length > 300 && smalPad.every(([, [x]]) => Math.abs(x - 180) < 0.47 * 360));
  }

  // dw: bewegen in echte eenheden, dus in beeld even veel naar links/rechts als op/neer.
  {
    const run = { sys: DW, ...start(DW, { p: { mov: 1, swirl: 0, dens: 0 } }) };
    let sx = 0, sy = 0;
    for (let i = 0; i < 240; i++) {
      const x0 = Float64Array.from(run.s.x), y0 = Float64Array.from(run.s.y);
      draai(run, 1, i / 60);
      for (let j = 0; j < run.s.n; j++) { sx += ((run.s.x[j] - x0[j]) * W) ** 2; sy += ((run.s.y[j] - y0[j]) * H) ** 2; }
    }
    ok(`dw: stapjes in beeld even groot in x en y (verhouding ${(sx / sy).toFixed(2)}): niets uitgerekt`, sx / sy > 0.8 && sx / sy < 1.25);
    const breed = { sys: DW, ...start(DW) };
    ok('dw: begint over het hele doek (x als fractie van de breedte)', Math.min(...breed.s.x) < 0.25 && Math.max(...breed.s.x) > 0.75);
    // Het geluid leest x als fractie van de breedte, op elk doek hetzelfde.
    const korrels = [];                                   // per doek: { pan, rate, start: [wanneer, plek, duur] }
    for (const [b, h] of [[W, H], [512, 512]]) {
      const sink = nepSink();
      sink.korrelBuffer = sink.ctx.createBuffer(2, 48000 * 3, 48000);
      const panner = sink.ctx.createStereoPanner, bron = sink.ctx.createBufferSource, k = {};
      sink.ctx.createStereoPanner = () => (k.pn = panner());
      sink.ctx.createBufferSource = () => { const n = bron(), s0 = n.start; n.start = (...a) => { k.start = a; s0(...a); }; return (k.src = n); };
      const r = { sys: DW, ...start(DW, { geluid: sink, breedte: b, hoogte: h, p: { dens: 0 } }) };
      r.s.x[5] = 0.25; r.s.y[5] = 0.3; r.g.t = 1;
      DW.emit(r.s, r.p, 5, r.g);
      korrels.push({ pan: k.pn.pan.value, rate: k.src.playbackRate.value, start: k.start });
    }
    const [k1, k2] = korrels;
    ok('dw: een korrel op 25% van de breedte: panorama −0,4, en toon en plek in de buffer als op het oude vierkant',
      bij(k1.pan, -0.4, 1e-6) && k1.pan === k2.pan && k1.rate === k2.rate && k1.start.join() === k2.start.join());
    // Op een vierkant doek precies de oude beweging (dezelfde regels als vóór 16:9, hier nagebouwd).
    const oud = (s, p, g) => {
      const t = g.t, dt = Math.max(0, Math.min(0.05, t - (s.last ?? t)));
      s.last = t;
      const n = s.n;
      for (let i = 0; i < n; i++) {
        const dx = s.x[i] - 0.5, dy = s.y[i] - 0.5;
        const ax = (g.r() - 0.5) * p.mov * 3 - dy * p.swirl * 0.8 - dx * 0.15, ay = (g.r() - 0.5) * p.mov * 3 + dx * p.swirl * 0.8 - dy * 0.15;
        s.vx[i] = (s.vx[i] + ax * dt) * 0.97; s.vy[i] = (s.vy[i] + ay * dt) * 0.97; s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt;
        if (s.x[i] < 0.02) { s.x[i] = 0.02; s.vx[i] *= -1; }
        if (s.x[i] > 0.98) { s.x[i] = 0.98; s.vx[i] *= -1; }
        if (s.y[i] < 0.02) { s.y[i] = 0.02; s.vy[i] *= -1; }
        if (s.y[i] > 0.98) { s.y[i] = 0.98; s.vy[i] *= -1; }
      }
      s.acc += p.dens * dt;
      while (s.acc >= 1) { s.acc -= 1; g.r(); g.r(); }       // emit: index en jitter
    };
    const nieuw = { sys: DW, ...start(DW, { breedte: 360, hoogte: 360, p: { swirl: 0.9, mov: 0.7 } }) };
    const ref = { sys: { ...DW, step: oud }, ...start(DW, { breedte: 360, hoogte: 360, p: { swirl: 0.9, mov: 0.7 } }) };
    draai(nieuw, 600); draai(ref, 600);
    ok('dw: op een vierkant doek bit voor bit de oude beweging (10 s, draaikolk 0,9 tegen de randen)',
      ['x', 'y', 'vx', 'vy'].every((v) => nieuw.s[v].every((x, i) => Object.is(x, ref.s[v][i]))));
  }

  // sn, tv, ep: het geluid hangt niet af van het doek: op 16:9 en op het oude 512² dezelfde samples.
  for (const [sys, p] of [[SN, { auto: 2 }], [TV, { auto: 2 }]]) {
    const buffers = [];
    for (const [b, h] of [[W, H], [512, 512]]) {
      const sink = nepSink(), echt = sink.ctx.createBuffer, lijst = [];
      sink.ctx.createBuffer = (...a) => { const buf = echt(...a); lijst.push(buf); return buf; };
      loop(sys, { geluid: sink, breedte: b, hoogte: h, p }, 240);
      buffers.push(lijst);
    }
    const [a, b] = buffers;
    ok(`${sys.id}: ${a.length} aanslagen klinken op 16:9 sample voor sample als op het oude vierkant`,
      a.length >= 3 && a.length === b.length && a.every((buf, i) => buf.getChannelData(0).every((x, j) => Object.is(x, b[i].getChannelData(0)[j]))));
  }
  {
    const golven = [];
    for (const [b, h] of [[W, H], [512, 512]]) {
      const sink = nepSink(), echt = sink.ctx.createPeriodicWave, lijst = [];
      sink.ctx.createPeriodicWave = (re, im) => { lijst.push([...re, ...im]); return echt(re, im); };
      loop(EP, { geluid: sink, breedte: b, hoogte: h }, 60);
      golven.push(lijst);
    }
    ok('ep: dezelfde golfvormen (L = x, R = y) op 16:9 als op het oude vierkant', golven[0].length === 2 && JSON.stringify(golven[0]) === JSON.stringify(golven[1]));
  }
}

console.log('rekentijd: 640 × 360 hooguit W / H keer een vierkant van 360 × 360');
{
  // Mediaan van 180 stappen, beste van drie rondes (de machine is druk).
  const meet = (sys, breedte, hoogte) => {
    let best = Infinity;
    for (let ronde = 0; ronde < 3; ronde++) {
      const run = { sys, ...start(sys, { breedte, hoogte }) }, ts = [];
      for (let i = 0; i < 180; i++) { run.g.t = i / 60; const t0 = draadMs(); sys.step.call(sys, run.s, run.p, run.g); ts.push(draadMs() - t0); }
      ts.sort((a, b) => a - b);
      best = Math.min(best, ts[90]);
    }
    return best;
  };
  for (const sys of SYSTEMEN_ISOMORF) { meet(sys, W, H); meet(sys, H, H); }   // opwarmen
  for (const sys of SYSTEMEN_ISOMORF) {
    const vk = meet(sys, H, H), br = meet(sys, W, H);
    ok(`${sys.id}: ${vk.toFixed(3)} ms op 360² -> ${br.toFixed(3)} ms op 640 × 360 (× ${(br / vk).toFixed(2)}, mag × ${(W / H).toFixed(2)})`, br <= vk * (W / H) * 1.15 + 0.01);
  }
}

console.log('in een echte VormLaag (zoals de hoofdsessie ze straks toevoegt)');
{
  const { SYSTEEM } = await import('../src/vormen/systemen.js');
  const { VormLaag, STAP } = await import('../src/vormen/laag.js');
  const echt = Math.random;
  Math.random = () => { throw new Error('Math.random gebruikt'); };
  let fout = null;
  try {
    for (const sys of SYSTEMEN_ISOMORF) {
      SYSTEEM[sys.id] = sys;              // tijdelijk: laag.js zoekt op id
      const laag = new VormLaag({ maakCanvas, systeem: sys.id, zaad: 2 });
      if (laag.sys !== sys) throw new Error(`${sys.id}: niet gekozen`);
      for (let i = 0; i < 120; i++) laag.frame(5 + i * STAP);
      laag.zetKnop(0, 1); laag.frame(5 + 121 * STAP);
      if (!getallen(laag.s).every(Number.isFinite) || !laag.canvas.tel.n) throw new Error(`${sys.id}: NaN of tekent niet`);
      delete SYSTEEM[sys.id];
    }
  } catch (e) { fout = e; }
  Math.random = echt;
  ok('alle vier draaien in VormLaag (g zonder geluid en kwaliteit), knop 1 werkt', !fout);
  if (fout) console.log('      ', fout.message);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
