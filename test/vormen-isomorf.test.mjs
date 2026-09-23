// De vier isomorfe Vormmachines (sn, tv, ep, dw): beeld zonder geluid, en
// geluid alleen achter een sink. Nep-canvas en een nep-AudioContext die
// net zo streng is als Chrome over wat hij aanneemt.
// Draai met: node test/vormen-isomorf.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN_ISOMORF, beeldKnoppen, klinkt, modalBuffer, drumCache, fourier, epShape, midiFrom, mtof, nname } =
  await import('../src/vormen/systemen-isomorf.js');
const { draaiKnoppen, SYSTEMEN, LUTS, maakRng } = await import('../src/vormen/systemen.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

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
function maakG(sys, { zaad = 7, maat = 512, geluid = null, kwaliteit } = {}) {
  const canvas = maakCanvas(maat, maat);
  const g = { ctx: canvas.getContext('2d'), S: maat, D: maat / 320, t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas, geluid };
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
  ok('geen id botst met de systemen in systemen.js', SYSTEMEN_ISOMORF.every((s) => !SYSTEMEN.some((t) => t.id === s.id)));
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
  ok('zonder sink geen vol-knop op een draaiknop; met sink gelijk aan draaiKnoppen',
    SYSTEMEN_ISOMORF.every((s) => !beeldKnoppen(s).some((k) => k.geluid) && beeldKnoppen(s, true).map((k) => k.k).join() === draaiKnoppen(s).map((k) => k.k).join()));
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
    for (let i = 0; i < n; i++) { run.g.t = i / 60; const t0 = performance.now(); sys.step.call(sys, run.s, run.p, run.g); ts.push(performance.now() - t0); }
    return { run, gem: ts.reduce((a, b) => a + b, 0) / n, max: Math.max(...ts.slice(1)), eerste: ts[0], calls: run.canvas.tel.n };
  };
  // Opwarmen (JIT), zodat de meting niet de compiler meet.
  for (const sys of SYSTEMEN_ISOMORF) { tijd(sys, 1, 60); tijd(sys, 0.25, 60); }
  for (const sys of SYSTEMEN_ISOMORF) {
    const hoog = tijd(sys, 1), laag = tijd(sys, 0.25);
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
