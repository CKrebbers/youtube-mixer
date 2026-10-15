// De instrumenten FM en Schaal (docs/INSTRUMENTEN.md §7) tegen het contract,
// zonder browser:
//   1. FM op een nep-Web Audio waarvan elke AudioParam een TIJDLIJN is
//      (test/nep-tijdlijn.mjs): envelopes, stemroof, stil, pedaal, druk,
//      buiging, en nergens setValueCurveAtTime.
//   2. Schaal (de hoofdthread) met een nep-worklet: welke berichten op welke
//      tijd, welk veld, loslaten, pedaal, wrijven, stil.
//   3. De kern van Schaal (puur): gebeurtenissen op hun sample, toonhoogte
//      gemeten, elke MIDI-noot klinkt, loslaten tot stilte, buigen, meeklinken.
//   4. De ECHTE worklet in een nagebouwde AudioWorkletGlobalScope: 0 GC per
//      blok (zoals renderblok.test en klankschaal.test), ook met noten.
// De metingen in Chrome (440 Hz, LUFS, uitklinken) staan in
// tools/headless/instrumenten.mjs.
// Draai met: node test/instrumenten-fm-schaal.test.mjs
// @alleen: afvalmeting (0 GC per blok) (test/alles.mjs draait hem na de pool, zonder iets ernaast)
import v8 from 'node:v8';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { maakTijdlijn } from './nep-tijdlijn.mjs';

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const cent = (a, b) => 1200 * Math.log2(a / b);

// ---- nep-Web Audio ---------------------------------------------------------------

let NOW = 0;
const { param: tijdlijn, stats } = maakTijdlijn(() => NOW);
const PARAMS = [];
const P = (v) => { const p = tijdlijn(v); PARAMS.push(p); return p; };
class NepNode {
  constructor(type) { this.type = type; this.naar = []; this.los = 0; }
  connect(n) { this.naar.push(n); return n; }
  disconnect(n) { this.los++; this.naar = n === undefined ? [] : this.naar.filter((x) => x !== n); }
}
const OSC = [];
let MODULES = 0;
const BERICHTEN = [];
const NODES = [];
globalThis.AudioWorkletNode = class extends NepNode {
  constructor(ctx, naam, opties) {
    super('worklet');
    this.naam = naam; this.opties = opties; this.dicht = false;
    this.port = { postMessage: (m) => BERICHTEN.push({ ...m, _nu: NOW }), close: () => { this.dicht = true; } };
    NODES.push(this);
  }
};
// Een EventTarget, zoals de echte (worklet-fouten komen als event op de context, worklet-fout.js).
class NepContext extends EventTarget {
  constructor() {
    super();
    this.sampleRate = 48000; this.baseLatency = 0.005; this.state = 'running';
    this.audioWorklet = { addModule: async (url) => { MODULES++; this.module = String(url); } };
  }
  get currentTime() { return NOW; }
  createGain() { const n = new NepNode('gain'); n.gain = P(1); return n; }
  createBiquadFilter() { const n = new NepNode('biquad'); n.frequency = P(350); n.Q = P(1); return n; }
  createStereoPanner() { const n = new NepNode('pan'); n.pan = P(0); return n; }
  createWaveShaper() { const n = new NepNode('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createPeriodicWave(real, imag) { return { real, imag }; }
  createConstantSource() {
    const n = new NepNode('const'); n.offset = P(1);
    n.start = (t = NOW) => { n.startT = t; }; n.stop = (t = NOW) => { n.stopT = t; }; return n;
  }
  createOscillator() {
    const n = new NepNode('osc'); n.frequency = P(440); n.detune = P(0); n.type = 'sine';
    n.setPeriodicWave = (w) => { n.golf = w; n.type = 'custom'; };
    n.start = (t = NOW) => { if (n.startT !== undefined) throw new Error('InvalidStateError: twee keer start'); n.startT = t; };
    n.stop = (t = NOW) => { if (n.startT === undefined) throw new Error('InvalidStateError: stop vóór start'); n.stopT = t; };
    OSC.push(n);
    return n;
  }
}
const geenCurves = () => PARAMS.every((p) => p.n.curve === 0) && stats.CURVE_BREUK === 0 && stats.OVERLAP_FOUTEN === 0;
/** De grootste sprong van een param tussen twee samples op [van, tot]. */
function sprong(param, van, tot, sr = 48000) {
  let max = 0, vorig = param.waarde(van);
  for (let t = van + 1 / sr; t <= tot; t += 1 / sr) { const v = param.waarde(t); max = Math.max(max, Math.abs(v - vorig)); vorig = v; }
  return max;
}
const LEDEN = ['start', 'noteOn', 'noteOff', 'alleUit', 'stil', 'druk', 'buig', 'mod', 'houd', 'zetParam', 'leesParam', 'stand', 'vernietig'];
function contract(naam, def, inst) {
  ok(`${naam}: definitie { soort, naam, maak } met een vaste id`, /^[a-z0-9-]+$/.test(def.soort) && typeof def.naam === 'string' && typeof def.maak === 'function');
  ok(`${naam}: soort en naam zoals de definitie`, inst.soort === def.soort && inst.naam === def.naam);
  ok(`${naam}: elk lid van het contract is een functie`, LEDEN.every((l) => typeof inst[l] === 'function'));
  const p = inst.params;
  ok(`${naam}: 1..8 parameters met id, label, standaard 0..1`, Array.isArray(p) && p.length >= 1 && p.length <= 8
    && p.every((x) => typeof x.id === 'string' && typeof x.label === 'string' && x.standaard >= 0 && x.standaard <= 1));
  ok(`${naam}: id's uniek`, new Set(p.map((x) => x.id)).size === p.length);
  ok(`${naam}: eenheid(v) geeft tekst voor 0, ¼, ½, 1 en de standaard`,
    p.every((x) => typeof x.eenheid === 'function' && [0, 0.25, 0.5, 1, x.standaard].every((v) => typeof x.eenheid(v) === 'string' && x.eenheid(v).length > 0)));
  ok(`${naam}: leesParam(k) = standaard, plek k = params[k-1]`, p.every((x, i) => inst.leesParam(i + 1) === x.standaard));
  ok(`${naam}: leesParam van een plek die er niet is = null`, [0, p.length + 1, 9, -1, 1.5, '1', null, undefined].every((k) => inst.leesParam(k) === null));
  inst.zetParam(1, 7); const hoog = inst.leesParam(1);
  inst.zetParam(1, -3); const laag = inst.leesParam(1);
  inst.zetParam(1, NaN); const nan = inst.leesParam(1);
  inst.zetParam(1, p[0].standaard);
  ok(`${naam}: zetParam klemt op 0..1 en negeert NaN`, hoog === 1 && laag === 0 && nan === 0);
  ok(`${naam}: start() is een Promise`, inst.start() instanceof Promise);
  const st = inst.stand();
  ok(`${naam}: stand() = { soort, naam, klinkt, params }`, st.soort === def.soort && st.naam === def.naam && Number.isInteger(st.klinkt)
    && st.params.length === p.length && st.params.every((v, i) => v === inst.leesParam(i + 1)));
}

// ---- 1. FM -----------------------------------------------------------------------
console.log('FM (nep-Web Audio met tijdlijnen)');
const { FM, Fm, STEMMEN, ROOF, OPHOGING: FM_OP, RATIOS } = await import('../src/engine/instrumenten/fm.js');
const { startDrempel } = await import('../src/engine/overgang.js');
{
  const ctx = new NepContext();
  const uit = new NepNode('chain.input');
  const fm = FM.maak(ctx, { uit, klok: null, toon: null });
  contract('fm', FM, fm);
  ok('fm: 12 stemmen, twee draaggolven per stem, ratio 2 standaard (MediSynth Glass)', STEMMEN === 12 && RATIOS[Math.round(fm.leesParam(2) * (RATIOS.length - 1))] === 2);
  ok('fm: hangt aan uit, niet aan ctx.destination', fm.uitGain.naar.includes(uit) && !('destination' in ctx));
  ok('fm: eenheden in echte eenheden', fm.params[0].eenheid(0.42) === '1,4' && fm.params[1].eenheid(3 / 9) === '1 : 2'
    && fm.params[2].eenheid(0.25) === '8 ms' && fm.params[3].eenheid(1) === '∞' && fm.params[4].eenheid(0.72) === '1,2 s'
    && fm.params[5].eenheid(0.41) === '1,0 Hz' && fm.params[6].eenheid(0.57) === '2,6 kHz bij A4' && fm.params[7].eenheid(0) === 'uit');

  NOW = 1;
  OSC.length = 0;
  fm.noteOn(69, 0.8);
  const s = fm.stemmen.at(-1);
  ok('noteOn: drie oscillatoren (modulator + 2 draaggolven), gestart op nu', OSC.length === 3 && OSC.every((o) => o.startT === 1));
  ok('noteOn: A4 = 440 Hz op de draaggolven, modulator 880 Hz (ratio 2)', s.draag.every((o) => o.frequency.value === 440) && s.mod.frequency.value === 880);
  ok('noteOn: draaggolven als PeriodicWave, ± de helft van 1 Hz zweving', s.draag.every((o) => o.type === 'custom')
    && bijna(s.draag[1].detune.value, -s.draag[0].detune.value) && bijna(s.draag[1].detune.value - s.draag[0].detune.value, cent(441.01, 440), 0.05));
  const piek = FM_OP * 0.5 * Math.pow(0.8, 1.5);
  ok('envelope: 0 op de aanslag, piek na 8 ms (lineair)', s.env.gain.waarde(1) === 0 && bijna(s.env.gain.waarde(1 + 0.00795), piek, piek * 0.01));
  ok('envelope: verval met τ = 3 × 1,6 s (na 1 s ~81%)', bijna(s.env.gain.waarde(2.008) / piek, Math.exp(-1 / 4.86), 0.01));
  ok('index: zakt naar 5% met τ = verval / 2 (MediSynth)', s.vorm.gain.waarde(1) === 1 && s.vorm.gain.waarde(10) < 0.06);
  ok('index × snelheid: diepte = 1,41 × 880 Hz × (0,4 + 0,6 × 0,8)', bijna(s.diepte.gain.value, 8 * 0.42 * 0.42 * 880 * 0.88, 1e-6));
  ok('filter volgt de noot: 2,6 kHz bij A4 × (0,75 + 0,5 × 0,8)', bijna(s.filter.frequency.value, 200 * Math.pow(90, 0.57) * 1.15, 1e-6));

  // Gepland in de toekomst, en in het verleden.
  OSC.length = 0;
  fm.noteOn(72, 0.5, 1.25);
  const sToek = fm.stemmen.at(-1);
  ok('noteOn met t vooruit: start op t, stil tot t', OSC.every((o) => o.startT === 1.25) && sToek.env.gain.waarde(1.249) === 0 && sToek.env.gain.waarde(1.27) > 0);
  OSC.length = 0;
  fm.noteOn(74, 0.5, 0.2);
  ok('noteOn met t in het verleden: nu', OSC.every((o) => o.startT === 1));
  const aantal = fm.stemmen.length;
  fm.noteOn(76, 0);
  ok('snelheid 0 = noteOff (geen nieuwe stem)', fm.stemmen.length === aantal);
  fm.noteOn(NaN, 1); fm.noteOn(300, 1); fm.noteOn(-1, 1);
  ok('rare noten doen niets en gooien niet', fm.stemmen.length === aantal);

  // Loslaten.
  NOW = 2;
  fm.noteOff(69);
  const rel = 0.005 * Math.pow(2000, 0.72);
  ok('noteOff: vastgehouden op nu, dan τ = release / 5 naar nul', s.los === 2 && bijna(s.env.gain.waarde(2 + rel / 5) / s.env.gain.waarde(2), Math.exp(-1), 0.01));
  ok('noteOff: oscillatoren stoppen na 2 × release, de staart is dan −87 dB', s.draag.every((o) => bijna(o.stopT, 2 + 2 * rel + 0.02))
    && s.env.gain.waarde(2 + 2 * rel) < piek * 1e-4);
  ok('noteOff vóór de aanslag klaar is: vanaf waar hij is, geen sprong', (() => {
    NOW = 3; fm.noteOn(50, 1, 3.1); const a = fm.stemmen.at(-1);
    fm.params[2]; fm.noteOff(50, 3.102);
    return sprong(a.env.gain, 3.1, 3.2) < FM_OP * 0.5 * 0.05;
  })());

  // Pedaal.
  NOW = 10;
  fm.alleUit(); NOW = 30; fm.stand();
  ok('na uitklinken opgeruimd (audioklok, niet onended)', fm.stemmen.length === 0 && fm.stand().klinkt === 0);
  fm.houd(true);
  fm.noteOn(64, 0.7);
  const ped = fm.stemmen.at(-1);
  fm.noteOff(64);
  ok('pedaal: noteOff wacht', ped.los === null && ped.gehouden);
  NOW = 30.5;
  fm.houd(false);
  ok('pedaal los: nu los', ped.los === 30.5 && !ped.gehouden);

  // Stemroof.
  NOW = 40; fm.stand();
  const stemmen = [];
  for (let i = 0; i < STEMMEN; i++) { NOW = 40 + i * 0.01; fm.noteOn(48 + i, 0.8); stemmen.push(fm.stemmen.at(-1)); }
  ok('12 stemmen tegelijk, klinkt = 12', fm.stand().klinkt === 12);
  NOW = 40.5;
  fm.noteOn(80, 0.8);
  const oudste = stemmen[0];
  const tF = 40.5 + startDrempel(ctx);
  ok('13e noot: de oudste wordt gestolen', oudste.weg && stemmen.slice(1).every((x) => !x.weg));
  ok('stemroof: pas na startDrempel, in 8 ms lineair naar nul (geen tik)', bijna(oudste.env.gain.waarde(tF), oudste.env.gain.waarde(40.5), 1e-3)
    && oudste.env.gain.waarde(tF + ROOF) === 0 && sprong(oudste.env.gain, 40.5, tF + ROOF + 0.002) < oudste.env.gain.waarde(40.5) / 300);
  ok('stemroof: oscillatoren stoppen pas als hij stil is', oudste.draag.every((o) => o.stopT >= tF + ROOF));
  NOW = 40.6;
  stemmen[5].noteOff = true; fm.noteOff(48 + 5);
  fm.noteOn(81, 0.8);
  ok('stemroof neemt eerst een stem die al los is (niet de oudste)', stemmen[5].weg && !stemmen[1].weg);
  NOW = 41; fm.stand();
  ok('nooit meer dan 12 levende stemmen', fm.stemmen.filter((x) => !x.weg && x.einde > NOW).length <= 12);

  // Stemroof met een noot vooruit gepland: de oude klinkt tot vlak ervoor.
  NOW = 42;
  const vrij = fm.stemmen.filter((x) => !x.weg && x.los === null).sort((a, b) => a.t0 - b.t0);
  fm.noteOn(90, 0.8, 42.3);
  ok('stemroof voor een noot op t: de oude dooft in de laatste 8 ms vóór t', vrij[0].weg && vrij[0].env.gain.waarde(42.29) > 0 && vrij[0].env.gain.waarde(42.3) === 0);

  // Druk, buiging, modwiel, knoppen op wat klinkt.
  NOW = 43;
  const doel = fm.stemmen.find((x) => !x.weg && x.noot === 90);
  const d0 = doel.diepte.gain.waarde(43);
  fm.druk(1);
  NOW = 43.5;
  ok('aftertouch (kanaal): index × 2,5 en filter verder open', bijna(doel.diepte.gain.waarde(43.5) / d0, 2.5, 1e-3));
  fm.druk(0);
  fm.druk(1, 91);
  NOW = 44;
  ok('aftertouch per noot: alleen die noot', bijna(doel.diepte.gain.waarde(44), d0, d0 * 1e-3));
  fm.buig(1);
  NOW = 44.1;
  ok('buig(1) = +200 cent op .detune van alle stemmen (gedeelde bron)', bijna(fm.buigBron.offset.waarde(44.1), 200, 0.01)
    && doel.draag.every((o) => fm.buigBron.naar.includes(o.detune)) && fm.buigBron.naar.includes(doel.mod.detune));
  fm.buig(-7); NOW = 44.2;
  ok('buig geklemd op −1..1', bijna(fm.buigBron.offset.waarde(44.2), -200, 0.01));
  fm.mod(1); NOW = 44.5;
  ok('modwiel = vibrato tot 30 cent', bijna(fm.vibrato.gain.waarde(44.5), 30, 0.01) && doel.draag.every((o) => fm.vibrato.naar.includes(o.detune)));
  const f0 = doel.filter.frequency.waarde(44.5);
  fm.zetParam(7, 0.9); NOW = 44.7;
  ok('filter draaien: hoorbaar op wat klinkt (glijdend)', doel.filter.frequency.waarde(44.7) > f0 * 3);
  fm.zetParam(2, 0); NOW = 44.9;
  ok('ratio draaien: de modulator volgt (1 : 0,5)', bijna(doel.mod.frequency.waarde(44.9), doel.hz * 0.5, 0.5));
  fm.zetParam(8, 1); NOW = 45.3;
  ok('warmte: droog 0, tanh × 1 / 8 (klein signaal exact 1×)', bijna(fm.droog.gain.waarde(45.3), 0, 1e-3) && bijna(fm.na.gain.waarde(45.3) * fm.voor.gain.waarde(45.3) * 4, 1, 1e-3));
  ok('warmte: de kromme is tanh, 4× oversampling', fm.shaper.oversample === '4x' && bijna(fm.shaper.curve[2048], Math.tanh(4), 1e-6));

  // Stil.
  NOW = 46.5;
  fm.houd(true);
  for (let i = 0; i < 4; i++) fm.noteOn(60 + i, 1);
  NOW = 46.6;
  fm.noteOn(70, 1, 47);
  const levend = fm.stemmen.filter((x) => !x.weg);
  fm.stil();
  const tS = 46.6 + startDrempel(ctx);
  ok('stil: elke stem dooft na startDrempel in 8 ms, zonder sprong', levend.every((x) => x.weg && x.env.gain.waarde(tS + ROOF) === 0
    && sprong(x.env.gain, 46.6, tS + ROOF + 0.002) <= Math.max(1e-9, x.env.gain.waarde(tS) / 300)));
  ok('stil: een noot die nog moest komen klinkt niet', levend.at(-1).env.gain.waarde(47.05) === 0 && levend.at(-1).draag[0].stopT < 47);
  ok('stil: pedaal los, buiging en vibrato terug', !fm.pedaal && fm.buigBron.offset.waarde(47.4) < 0.01 && fm.vibrato.gain.waarde(47.4) < 0.01);
  NOW = 47.5;
  ok('stil: niets klinkt meer', fm.stand().klinkt === 0);

  ok('nergens setValueCurveAtTime, geen afgebroken curve, geen overlap', geenCurves());

  // Vernietig.
  NOW = 48;
  fm.noteOn(60, 1);
  fm.vernietig();
  await new Promise((r) => setTimeout(r, 150));
  ok('vernietig: na de helling alles los (uitGain, lfo, buiging), lfo en bron gestopt',
    fm.uitGain.los > 0 && fm.lfo.los > 0 && fm.buigBron.los > 0 && fm.lfo.stopT !== undefined && fm.buigBron.stopT !== undefined);
  let gooit = false;
  try { fm.noteOn(60, 1); fm.noteOff(60); fm.stil(); fm.zetParam(1, 0.5); fm.stand(); } catch (_) { gooit = true; }
  ok('na vernietig: aanroepen gooien niet en doen niets', !gooit && fm.stemmen.length === 0);
}

// ---- 2. Schaal, de hoofdthread ----------------------------------------------------
console.log('\nSchaal (nep-worklet)');
const { SCHAAL, OPHOGING: SCHAAL_OP } = await import('../src/engine/instrumenten/schaal.js');
const { NOOTVELDEN, VELD_STEM, SchaalInstrumentKern, LIJF, VELD0, RIJ } = await import('../src/engine/instrumenten/schaal-kern.js');
{
  const ctx = new NepContext();
  const uit = new NepNode('chain.input');
  let toon = null;
  NOW = 100;
  const sc = SCHAAL.maak(ctx, { uit, klok: null, toon: () => toon });
  ok('schaal: zonder start geen worklet', MODULES === 0 && sc.node === null);
  BERICHTEN.length = 0;
  let gooit = false;
  try { sc.noteOn(69, 0.8); sc.noteOff(69); sc.druk(0.5); sc.buig(0.5); sc.mod(0.3); sc.houd(true); sc.houd(false); sc.alleUit(); sc.stil(); } catch (_) { gooit = true; }
  ok('noteOn (en de rest) vóór start: gooit niet, blijft stil', !gooit && BERICHTEN.length === 0);
  await Promise.resolve();
  ok('... maar begint wel met laden', MODULES === 1);
  sc.zetParam(8, 0);
  contract('schaal', SCHAAL, sc);
  ok('schaal: eenheden', sc.params[0].eenheid(0.1) === '10% schaal' && sc.params[1].eenheid(0.375) === '4,3 s' && sc.params[3].eenheid(1) === 'gong'
    && sc.params[4].eenheid(0.6) === '+10,0 ct' && sc.params[6].eenheid(0) === 'vrij' && sc.params[6].eenheid(0.5) === '1,9 s');
  await sc.start();
  await sc.start();
  ok('start(): één worklet (varve-schaal-instrument), één keer geladen, aan uitGain', NODES.length === 1 && MODULES === 1
    && sc.node.naam === 'varve-schaal-instrument' && sc.node.naar.includes(sc.uitGain) && /schaal-worklet\.js$/.test(ctx.module));
  ok('start(): opt, param, kern (zonder toonsoort D3, zoals de klankschaal)', ['opt', 'param', 'kern'].every((t) => BERICHTEN.some((m) => m.t === t))
    && Math.abs(BERICHTEN.find((m) => m.t === 'kern').hz - 146.83) < 0.01);
  ok('hangt aan uit met de ophoging', sc.uitGain.naar.includes(uit) && sc.uitGain.gain.value === SCHAAL_OP);

  BERICHTEN.length = 0;
  toon = { k: 21, cent: 43 };                        // A mineur: de kern naar A2
  sc.noteOn(69, 0.8, 100.5);
  const slag = BERICHTEN.find((m) => m.t === 'slag');
  ok('noteOn: kern eerst op de toon van de maatgever (A2), in A440', Math.abs(BERICHTEN.find((m) => m.t === 'kern').hz - 110) < 1e-9);
  ok('… en alles op de stemming van de plaat (+43 ct, S7): via fijn, vóór de slag', BERICHTEN.find((m) => m.t === 'param')?.fijn === 43
    && BERICHTEN.findIndex((m) => m.t === 'param') < BERICHTEN.findIndex((m) => m.t === 'slag'));
  ok('noteOn: een slag op tijd t, A4 = 440 Hz, een notenveld', slag && slag.tijd === 100.5 && slag.hz === 440 && slag.j >= 0 && slag.j < NOOTVELDEN && slag.v === VELD_STEM[slag.j]);
  ok('... met vier amplitudes, een klop in ms en het lichaam', slag.a.length === 4 && slag.a.every((x) => x > 0) && slag.ms > 0 && slag.lijf > 0);
  BERICHTEN.length = 0;
  toon = null;
  sc.noteOn(69, 0.4, 101);
  const nog = BERICHTEN.find((m) => m.t === 'slag');
  ok('dezelfde noot nog eens: hetzelfde veld (geen zweving tegen een kopie)', nog.j === slag.j);
  ok('track zonder toonsoort: de kern blijft op A2 (geen sprong naar D)', !BERICHTEN.some((m) => m.t === 'kern'));
  ok('… en op zijn laatste stemming (+43 ct: geen sprong naar A440)', !BERICHTEN.some((m) => m.t === 'param'));
  BERICHTEN.length = 0;
  sc.zetParam(5, 0.6);
  ok('FIJN komt erbij: +10 ct op een plaat van +43 = +53', BERICHTEN.find((m) => m.t === 'param')?.fijn === 53);
  toon = { k: 21, cent: 43.3 };
  BERICHTEN.length = 0;
  sc.noteOn(69, 0.4, 101.1);
  ok('een verschil van minder dan een halve cent: niets opnieuw (de pitch-fader schuift niet bij elke noot de stemming)', !BERICHTEN.some((m) => m.t === 'param'));
  toon = { k: 21, cent: -80 };
  BERICHTEN.length = 0;
  sc.noteOn(69, 0.4, 101.2);
  ok('buiten ±50 ct: begrensd (zoals de globale schaal)', BERICHTEN.find((m) => m.t === 'param')?.fijn === -40);
  sc.zetParam(5, 0.5);
  toon = { k: 21, cent: 0 };
  sc.noteOn(69, 0.4, 101.3);
  toon = null;
  ok('zachter = minder: snelheid 0,4 slaat zachter dan 0,8', nog.a[0] < slag.a[0] * 0.6);

  // Tien velden, dan stemroof.
  NOW = 110;
  sc.stil(); BERICHTEN.length = 0;
  const js = [];
  for (let i = 0; i < NOOTVELDEN; i++) { NOW = 110 + i * 0.01; sc.noteOn(50 + i, 0.8); js.push(BERICHTEN.at(-1).j); }
  ok('tien noten: tien verschillende velden', new Set(js).size === NOOTVELDEN);
  ok('stand: klinkt = 10', sc.stand().klinkt === 10);
  NOW = 110.2;
  sc.noteOn(70, 0.8);
  ok('11e noot: het oudste veld', BERICHTEN.at(-1).j === js[0]);
  NOW = 110.3;
  sc.noteOff(53);
  sc.noteOn(71, 0.8);
  ok('stemroof neemt eerst een veld dat los is', BERICHTEN.at(-1).j === js[3]);
  BERICHTEN.length = 0;
  NOW = 110.4;
  sc.noteOn(72, 0.8, 110.6);
  const voor = BERICHTEN.filter((m) => m.t === 'los'), gepland = BERICHTEN.find((m) => m.t === 'slag');
  ok('stemroof voor een geplande noot: het veld eerst 20 ms dempen (t60 0,04 s), dan de slag',
    voor.length === 1 && voor[0].j === gepland.j && bijna(voor[0].tijd, 110.58) && voor[0].t60 === 0.04 && gepland.tijd === 110.6);

  // Loslaten, pedaal, kern los.
  NOW = 120;
  sc.stil(); BERICHTEN.length = 0;
  sc.noteOn(60, 0.8); sc.noteOn(64, 0.8);
  BERICHTEN.length = 0;
  NOW = 120.5;
  sc.noteOff(60);
  const los = BERICHTEN.filter((m) => m.t === 'los');
  ok('noteOff: het veld uitklinken in 1,9 s (loslaten 0,5)', los.length === 1 && bijna(los[0].t60, 0.12 * Math.pow(250, 0.5), 1e-9) && los[0].tijd === 120.5);
  ok('... de kern nog niet: er is nog een toets', !BERICHTEN.some((m) => m.t === 'kernlos'));
  sc.houd(true);
  sc.noteOff(64);
  ok('pedaal: noteOff wacht', !BERICHTEN.some((m) => m.t === 'los' && m.j !== los[0].j));
  NOW = 121;
  sc.houd(false);
  ok('pedaal los: het veld los, en nu ook kern en lichaam', BERICHTEN.filter((m) => m.t === 'los').length === 2 && BERICHTEN.some((m) => m.t === 'kernlos' && m.t60 > 0));
  BERICHTEN.length = 0;
  sc.noteOn(67, 0.8);
  ok('een nieuwe noot: de kern mag weer vrij klinken', BERICHTEN.some((m) => m.t === 'kernlos' && m.t60 === 0));
  sc.zetParam(7, 0);
  BERICHTEN.length = 0;
  sc.noteOff(67);
  ok('loslaten op "vrij": noteOff dempt niets (handpan)', !BERICHTEN.some((m) => m.t === 'los' || m.t === 'kernlos'));
  sc.zetParam(7, 0.5);
  sc.noteOn(40, 1); sc.noteOn(41, 1);
  BERICHTEN.length = 0;
  sc.alleUit(122);
  ok('alleUit: elk vastgehouden veld los op t', BERICHTEN.filter((m) => m.t === 'los' && m.tijd === 122).length === 2);

  // Wrijven, buigen, knoppen.
  BERICHTEN.length = 0;
  sc.druk(0.6);
  ok('aftertouch: de kern gaat zingen (stokdruk 0,15 + 0,55 × 0,6)', bijna(BERICHTEN.at(-1).p, 0.48) && BERICHTEN.at(-1).t === 'wrijf');
  sc.mod(0.9);
  ok('modwiel: de sterkste telt', bijna(BERICHTEN.at(-1).p, 0.15 + 0.55 * 0.9));
  sc.mod(0); sc.druk(0);
  ok('alles los: niet meer wrijven, kern los', BERICHTEN.at(-1).t === 'kernlos' || (BERICHTEN.at(-2).t === 'wrijf' && BERICHTEN.at(-2).p === 0));
  sc.druk(0.5, 61);
  ok('aftertouch per toets: ook wrijven', BERICHTEN.at(-1).t === 'wrijf' && BERICHTEN.at(-1).p > 0);
  sc.noteOff(61);
  ok('toets los: zijn druk weg', BERICHTEN.some((m) => m.t === 'wrijf' && m.p === 0));
  BERICHTEN.length = 0;
  sc.zetParam(8, 0.3);
  ok('knop WRIJF: wrijven zonder toets', BERICHTEN.at(-1).t === 'wrijf' && bijna(BERICHTEN.at(-1).p, 0.15 + 0.55 * 0.3));
  sc.zetParam(8, 0);
  BERICHTEN.length = 0;
  sc.buig(1); sc.buig(1.0005); sc.buig(-0.5); sc.buig(0);
  ok('buig: ± 200 cent, kleine stapjes niet, terug naar 0 wel', BERICHTEN.map((m) => m.c).join(',') === '200,-100,0');
  BERICHTEN.length = 0;
  sc.zetParam(1, 0.8); sc.zetParam(3, 0.2);
  ok('karakter draaien: param naar de worklet; kracht niet (hoofdthread)', BERICHTEN.length === 1 && bijna(BERICHTEN[0].karakter, 0.8));
  sc.zetParam(1, 0.1);

  // Stil.
  NOW = 130;
  sc.noteOn(60, 1); sc.houd(true);
  BERICHTEN.length = 0;
  sc.stil();
  const g = sc.uitGain.gain, d = startDrempel(ctx), st = BERICHTEN.find((m) => m.t === 'stil');
  ok('stil: uitgang na startDrempel in 10 ms dicht, zonder sprong', bijna(g.waarde(130 + d), SCHAAL_OP, 1e-6) && g.waarde(130 + d + 0.01) === 0
    && sprong(g, 130, 130 + d + 0.011) < SCHAAL_OP / 300);
  ok('stil: de kern pas op nul als de uitgang dicht is, 0,1 s later weer open', st && st.tijd >= 130 + d + 0.01 && g.waarde(st.tijd + 0.05) === 0
    && bijna(g.waarde(st.tijd + 0.1), SCHAAL_OP, 1e-9));
  ok('stil: pedaal los, niets klinkt meer', !sc.pedaal && sc.stand().klinkt === 0);
  ok('nergens setValueCurveAtTime', geenCurves());

  NOW = 140;
  sc.vernietig();
  await new Promise((r) => setTimeout(r, 250));
  ok('vernietig: worklet en uitgang los, poort dicht', sc.node === null && NODES[0].los > 0 && NODES[0].dicht && sc.uitGain.los > 0);
  // Alleen de poort sluiten liet de worklet voor altijd draaien (process() bleef true geven): eerst 'stop'.
  ok('vernietig: eerst { t: stop } naar de worklet, dan pas de poort dicht', BERICHTEN.some((m) => m.t === 'stop'));
  gooit = false;
  BERICHTEN.length = 0;
  try { sc.noteOn(60, 1); sc.stil(); sc.stand(); } catch (_) { gooit = true; }
  ok('na vernietig: niets, en niet gooien', !gooit && BERICHTEN.length === 0);

  // Een fout in de worklet (processorerror, spoor A): los, melden op de context, de volgende noot bouwt hem opnieuw.
  const sc2 = SCHAAL.maak(ctx, { uit, klok: null, toon: () => toon });
  await sc2.start();
  const n1 = sc2.node, h1 = n1.onprocessorerror, fouten = [];
  ctx.addEventListener('varve-workletfout', (e) => fouten.push(e.detail));
  h1({ message: 'nep' });
  ok('worklet-fout: de node los en dicht, één melding op de context', sc2.node === null && n1.dicht && n1.los > 0
    && fouten.length === 1 && /Klankschaal/.test(fouten[0].wat) && fouten[0].reden === 'nep');
  h1({});
  ok('… een tweede event van dezelfde node doet niets', fouten.length === 1);
  sc2.noteOn(60, 1);
  await sc2.start();
  ok('… de volgende noot bouwt een nieuwe worklet', sc2.node && sc2.node !== n1);
  sc2.vernietig();
}

// ---- 3. de kern van Schaal (puur) --------------------------------------------------
console.log('\nde kern van Schaal (zonder browser)');
const FS = 48000, BLOK = 128;
function speel(kern, sec, { t = 0, opvang = null } = {}) {
  const L = new Float32Array(BLOK), R = new Float32Array(BLOK);
  const blokken = Math.round((sec * FS) / BLOK);
  let piek = 0, som = 0, eindig = true;
  for (let b = 0; b < blokken; b++) {
    kern.t0 = t + (b * BLOK) / FS;
    kern.blok(L, R, BLOK);
    for (let i = 0; i < BLOK; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) eindig = false;
      piek = Math.max(piek, Math.abs(L[i]), Math.abs(R[i]));
      som += L[i] * L[i];
      if (opvang) opvang.push(L[i]);
    }
  }
  return { piek, rms: Math.sqrt(som / (blokken * BLOK)), eindig, eind: t + (blokken * BLOK) / FS };
}
function goertzel(x, f) {
  const w = (2 * Math.PI * f) / FS, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    const s0 = x[i] * hann + c * s1 - s2; s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}
/** De sterkste toon binnen ± 1 halve toon rond `rond`, per 0,2 cent. */
function toonhoogte(x, rond) {
  let beste = rond, max = -1;
  for (let c = -100; c <= 100; c += 0.2) { const f = rond * Math.pow(2, c / 1200); const p = goertzel(x, f); if (p > max) { max = p; beste = f; } }
  return beste;
}
const slagVan = (j, hz, extra = {}) => ({ t: 'slag', v: VELD_STEM[j], j, hz, pan: 0, a: [0.6, 0.6, 0.3, 0.15], ms: 3, pe: 0, lijf: 0.05, ...extra });
{
  const k = new SchaalInstrumentKern(FS);
  ok('kern: 53 modi (kern 12, tien velden van 4, lichaam), stil en slapend', k.n === 53 && LIJF === 52 && VELD0 === 12 && speel(k, 0.05).piek === 0 && k.slaapt);

  // Op de sample.
  const a = new SchaalInstrumentKern(FS);
  a.bericht({ t: 'opt', fric: 1, org: 0 }, 0);
  a.bericht(slagVan(0, 440, { tijd: 0.01 }), 0);
  const x = [];
  speel(a, 1.5, { opvang: x });
  ok('een slag op t = 0,01 s begint op sample 480 (niet op het blok)', x.findIndex((v) => v !== 0) === 480);
  const f = toonhoogte(Float64Array.from(x.slice(9600, 9600 + 48000)), 440);
  ok(`A4: het veld klinkt op 440 Hz (gemeten ${cent(f, 440).toFixed(2)} ct)`, Math.abs(cent(f, 440)) <= 0.5);

  // Volgorde: een later verstuurd bericht met een vroegere tijd gaat eerst.
  const b = new SchaalInstrumentKern(FS);
  b.bericht(slagVan(1, 660, { tijd: 0.02 }), 0);
  b.bericht(slagVan(0, 440, { tijd: 0.005 }), 0);
  const xb = [];
  speel(b, 0.05, { opvang: xb });
  ok('berichten op volgorde van tijd, niet van aankomst', xb.findIndex((v) => v !== 0) === 240 && b.veldHz[0] === 440 && b.veldHz[1] === 660);

  // Organisch (drift ±0,9 ct en de glijder) aan: nog steeds op toon.
  let ergste = 0;
  for (const midi of [36, 60, 69, 84, 96]) {
    const kk = new SchaalInstrumentKern(FS);
    kk.bericht({ t: 'opt', fric: 1, org: 1 }, 0);
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    kk.bericht(slagVan(2, hz, { pe: 3 }), 0);
    const xx = [];
    speel(kk, 1.5, { opvang: xx });
    ergste = Math.max(ergste, Math.abs(cent(toonhoogte(Float64Array.from(xx.slice(14400, 14400 + 48000)), hz), hz)));
  }
  ok(`C2, C4, A4, C6, C7 met drift en glijder: binnen 2 cent (ergste ${ergste.toFixed(2)} ct)`, ergste <= 2);

  // Elke MIDI-noot doet iets.
  let stom = [], raar = false;
  const ka = new SchaalInstrumentKern(FS);
  for (let midi = 0; midi < 128; midi++) {
    ka.bericht({ t: 'stil' }, 0);
    ka.bericht(slagVan(midi % NOOTVELDEN, 440 * Math.pow(2, (midi - 69) / 12), { lijf: 0 }), 0);
    const r = speel(ka, 0.1);
    if (!(r.piek > 1e-3)) stom.push(midi);
    if (!r.eindig || r.piek > 1) raar = true;
  }
  ok(`elke MIDI-noot 0..127 klinkt (geen enkele stil${stom.length ? `: ${stom.join(' ')}` : ''})`, stom.length === 0);
  ok('... eindig en binnen ±1', !raar);

  // Buigen en fijn: de velden schuiven, de kern niet.
  const kb = new SchaalInstrumentKern(FS);
  kb.bericht({ t: 'opt', fric: 1, org: 0 }, 0);
  kb.bericht(slagVan(0, 440), 0);
  speel(kb, 0.2);
  const kernW = kb.w0[0];
  kb.bericht({ t: 'buig', c: 200 }, 0.2);
  const xbg = [];
  speel(kb, 1, { t: 0.2, opvang: xbg });
  const fb = toonhoogte(Float64Array.from(xbg.slice(2400)), 493.88);
  ok(`buig +200 ct: een klinkend veld schuift mee naar B4 (gemeten ${cent(fb, 440).toFixed(1)} ct), de kern niet`,
    Math.abs(cent(fb, 440) - 200) <= 1 && kb.w0[0] === kernW);
  kb.bericht({ t: 'buig', c: 0 }, 1.2);
  kb.bericht({ t: 'param', fijn: 20 }, 1.2);
  speel(kb, 0.01, { t: 1.2 });
  ok('fijn +20 ct: velden én kern', bijna(cent(kb.w0[VELD0] / ((2 * Math.PI) / FS), 440), 20, 1e-6) && bijna(kb.w0[0] / kernW, Math.pow(2, 20 / 1200), 1e-9));

  // Omstemmen van een veld dat nog klinkt (stemroof, live): amplitude en fase blijven.
  const amp = (k, i) => { const w = k.w0[i], s = k.y1[i], c = (s * Math.cos(w) - k.y2[i]) / Math.sin(w); return Math.hypot(s, c); };
  let blijft = true;
  for (const [van, naar] of [[2093, 55], [55, 2093], [440, 466.16], [8.18, 12543]]) {
    const ko = new SchaalInstrumentKern(FS);
    ko.bericht({ t: 'opt', fric: 1, org: 0 }, 0);
    ko.bericht(slagVan(0, van, { a: [0.5, 0, 0, 0], lijf: 0 }), 0);
    const r0 = speel(ko, 0.3);
    const a0 = amp(ko, VELD0), y0 = ko.y1[VELD0];
    ko.bericht(slagVan(0, naar, { a: [0, 0, 0, 0], lijf: 0 }), r0.eind);
    speel(ko, BLOK / FS, { t: r0.eind });
    const a1 = amp(ko, VELD0);
    if (!(a1 / a0 > 0.95 && a1 / a0 <= 1.0001)) { blijft = false; console.log(`   ${van} → ${naar} Hz: × ${(a1 / a0).toFixed(3)}`); }
    if (!(Math.abs(y0) > 0)) blijft = false;
  }
  ok('een klinkend veld omstemmen (2 kHz ↔ 55 Hz, 8 Hz → 12,5 kHz): de amplitude blijft (zonder: × 7,8 harder)', blijft);

  // Loslaten tot stilte, en vrij.
  const kl = new SchaalInstrumentKern(FS);
  kl.bericht(slagVan(0, 440), 0);
  speel(kl, 0.5);
  kl.bericht({ t: 'los', j: 0, t60: 0.3 }, 0.5);
  kl.bericht({ t: 'kernlos', t60: 0.3 }, 0.5);
  const na = speel(kl, 3, { t: 0.5 });
  const daarna = speel(kl, 0.2, { t: na.eind });
  ok('los (t60 0,3 s) en kern los: binnen 3 s slaapt hij en is het exact stil', kl.slaapt && daarna.piek === 0);
  const kv = new SchaalInstrumentKern(FS);
  kv.bericht(slagVan(0, 440), 0);
  speel(kv, 3);
  ok('zonder loslaten klinkt een veld na 3 s nog (handpan: t60 4,3 s)', !kv.slaapt && speel(kv, 0.2, { t: 3 }).piek > 1e-4);

  // Stil: meteen nul, en de rij leeg.
  kv.bericht(slagVan(1, 330, { tijd: 3.5 }), 3.2);
  kv.bericht({ t: 'stil', tijd: 3.3 }, 3.2);
  const xs = [];
  speel(kv, 0.5, { t: 3.2, opvang: xs });
  ok('stil: vanaf zijn sample exact nul, en wat nog in de rij stond is weg', xs.slice(Math.round(0.1 * FS) + 1).every((v) => v === 0) && kv.slaapt && kv.rijN === 0);

  // Meeklinken: een noot op de grondtoon van de kern laat de kern meeklinken.
  const km = new SchaalInstrumentKern(FS);
  km.bericht(slagVan(0, km.kernHz), 0);
  speel(km, 0.01);
  ok('meeklinken: een noot op de grondtoon van de kern (D3) laat de kern meeklinken', Math.abs(km.y1[0]) + Math.abs(km.y2[0]) > 1e-4);
  const kn = new SchaalInstrumentKern(FS);
  kn.bericht(slagVan(0, km.kernHz * Math.pow(2, 6 / 12)), 0);
  speel(kn, 0.01);
  ok('... een tritonus erboven niet (alleen de ±1e-18 tegen denormalen)', Math.abs(kn.y1[0]) + Math.abs(kn.y2[0]) < 1e-12);

  // Wrijven.
  const kw = new SchaalInstrumentKern(FS);
  kw.bericht({ t: 'wrijf', p: 0.48, r: 1.1 }, 0);
  speel(kw, 3);
  const zingt = speel(kw, 1, { t: 3 });
  ok(`wrijven: na 3 s zingt de kern (rms ${zingt.rms.toFixed(3)})`, zingt.rms > 0.01 && zingt.eindig);

  // De rij loopt niet over.
  const kr = new SchaalInstrumentKern(FS);
  let over = false;
  try { for (let i = 0; i < RIJ + 100; i++) kr.bericht(slagVan(i % NOOTVELDEN, 200 + i, { tijd: 5 + i * 0.001 }), 0); } catch (_) { over = true; }
  ok(`rij vol (${RIJ}): het vroegste gaat meteen in, niets gooit`, !over && kr.rijN === RIJ);
}

// ---- 4. de echte worklet, afval ---------------------------------------------------
console.log('\nde worklet (nagebouwde AudioWorkletGlobalScope)');
{
  let Klasse = null;
  globalThis.sampleRate = FS;
  globalThis.currentFrame = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
  globalThis.registerProcessor = (naam, k) => { if (naam === 'varve-schaal-instrument') Klasse = k; };
  await import('../src/engine/instrumenten/schaal-worklet.js');
  ok('de worklet registreert varve-schaal-instrument', typeof Klasse === 'function');
  const proc = new Klasse();
  const uit = [[new Float32Array(BLOK), new Float32Array(BLOK)]], IN = [];
  // De klok als HEEL getal (currentFrame, zoals in Chrome): een double in een
  // globale variabele zetten maakt in het harnas zelf elk blok een getal-object.
  let frame = 0;
  const draai = (n) => { for (let b = 0; b < n; b++) { globalThis.currentFrame = frame; proc.process(IN, uit); frame += BLOK; } };
  const stuur = (d) => proc.port.onmessage({ data: d });
  stuur({ t: 'opt', fric: 1, org: 1 });
  stuur({ t: 'param', karakter: 0.1, uitklank: 1, klank: 0, fijn: 0 });
  stuur({ t: 'kern', hz: 146.83 });
  stuur(slagVan(0, 440, { tijd: 0.0105 }));
  draai(4);
  ok('bericht met tijd: de worklet zet hem op zijn sample (blok 3, sample 504 − 384 = 120)', uit[0][0][119] === 0 && uit[0][0][120] !== 0);

  // Afval: alles klinkt (tien velden, kern wrijft), daarna met noten erin.
  stuur({ t: 'wrijf', p: 0.5, r: 1.1 });
  for (let j = 0; j < NOOTVELDEN; j++) stuur(slagVan(j, 200 + 37 * j));
  draai(3000);                                            // opwarmen
  const SLAGEN = Array.from({ length: NOOTVELDEN }, (_, j) => slagVan(j, 300 + 29 * j, { tijd: 0 }));
  // Gemeten in de JONGE ruimte (new_space, plus new_large_object_space voor een
  // grote array), min een leeg venster (wat het meten zelf kost): daar landt afval
  // per blok. heapUsed telde ook gecompileerde code mee (V8 die de meetlus tijdens
  // een venster opnieuw compileert, 15–25 kB in code_space/trusted_space: 4 van de
  // 9 keer rood zonder één byte afval) en het opruimen van de oude ruimte na gc()
  // (een min die afval kon verbergen). 7 okt.
  const JONG = ['new_space', 'new_large_object_space'];
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  const venster = (metNoten, n = 3000) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    let noten = 0;
    for (let b = 0; b < n; b++) {
      globalThis.currentFrame = frame;
      if (metNoten && b % 25 === 0) { const s = SLAGEN[noten++ % NOOTVELDEN]; s.tijd = (frame + 48) / FS; stuur(s); }
      proc.process(IN, uit); frame += BLOK;
    }
    const j1 = jong();
    return { bytes: j1 - j0 - (n ? leeg : 0), gcs: prof.stop().statistics.length, noten };
  };
  const leeg = venster(false, 0).bytes;
  const beste = (metNoten) => {
    let b = null;
    for (let i = 0; i < 4; i++) { const w = venster(metNoten); if (!b || w.gcs < b.gcs || (w.gcs === b.gcs && w.bytes < b.bytes)) b = w; }
    return b;
  };
  const zonder = beste(false);
  ok(`geen afval per blok: 3000 blokken (tien velden en wrijven), ${zonder.gcs} GC, ${zonder.bytes} bytes (één getal-object per blok zou 48 kB zijn)`, zonder.gcs === 0 && zonder.bytes < 16 * 1024);
  const met = beste(true);
  // Een bericht mag iets kosten (docs/AUDIOPAD.md "Wat blijft": de browser maakt het
  // bericht al aan); per blok niets. Dus: geen GC, en de kosten schalen met de noten.
  const perNoot = Math.max(0, met.bytes - zonder.bytes) / met.noten;
  ok(`met ${met.noten} noten erin (elke 25 blokken, op hun sample): ${met.gcs} GC, ${met.bytes} bytes (~${Math.round(perNoot)} per noot, per bericht)`,
    met.gcs === 0 && perNoot < 4096);

  // Rekentijd (geen eis die wankelt: ruim boven wat hij nodig heeft).
  const t0 = performance.now();
  draai(2000);
  const ms = (performance.now() - t0) / 2000;
  ok(`rekentijd per blok ${ms.toFixed(3)} ms (< 1 ms van 2,67)`, ms < 1);

  // Na { t: 'stop' } geeft process() false (anders blijft hij voor altijd draaien, ook los van alles).
  ok('vóór stop: process() geeft true', proc.process(IN, uit) === true);
  stuur({ t: 'stop' });
  ok('na { t: stop }: process() geeft false, en neemt geen berichten meer aan', proc.process(IN, uit) === false && proc.port.onmessage === null);
}

// ---- 5. de regels -------------------------------------------------------------------
console.log('\nde regels');
{
  const map = new URL('../src/engine/instrumenten/', import.meta.url);
  for (const f of ['fm.js', 'schaal.js', 'schaal-kern.js', 'schaal-worklet.js', 'index.js']) {
    const bron = readFileSync(new URL(f, map), 'utf8');
    const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    ok(`${f}: importeert alleen uit de engine en lib (regel 1)`, imports.every((i) => /^\.\.?\//.test(i) && !/\/(ui|control|server|video|opname)\//.test(i)));
    const code = bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    ok(`${f}: geen DOM, geen setValueCurveAtTime, geen setTimeout voor geluid`, !/\b(document|window)\./.test(code) && !/setValueCurveAtTime/.test(code)
      && (code.match(/setTimeout/g) || []).length <= 1);
  }
  const worklet = readFileSync(new URL('schaal-worklet.js', map), 'utf8');
  const wi = [...worklet.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  ok('schaal-worklet.js importeert alleen zijn kern', wi.length === 1 && wi[0] === './schaal-kern.js');
  const kernBron = readFileSync(new URL('schaal-kern.js', map), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('schaal-kern.js: geen Math.random op de audiothread', !/Math\.random/.test(kernBron));
  const { INSTRUMENTEN, instrumentDef } = await import('../src/engine/instrumenten/index.js');
  ok('index.js: fm en schaal in INSTRUMENTEN', instrumentDef('fm') === FM && instrumentDef('schaal') === SCHAAL && INSTRUMENTEN.includes(FM));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
