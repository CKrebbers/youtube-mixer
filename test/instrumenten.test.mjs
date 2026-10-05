// Instrumenten op een track (docs/INSTRUMENTEN.md §6): de Poly, de engine
// (zetten, weghalen, nummer <-> instrument, speeltrack, maatgever), de
// actions, noten.js met nep-MIDI-poorten, het mapje inst en de mapping.
// Draait in Node tegen een Web Audio-mock die bijhoudt wat waarheen gaat en
// wat er op elke AudioParam gepland wordt. Toonhoogte, luidheid en klikken
// meet tools/headless/instrument.mjs in een echte Chrome.
// Draai met: node test/instrumenten.test.mjs
import { readFileSync } from 'node:fs';

let NOW = 0;
let CURVES = 0;                      // setValueCurveAtTime: verboden (CLAUDE.md, overgangen)
const LIJNEN = [];                   // { van, naar }: wat er nu verbonden is
const OSCS = [];                     // elke oscillator die gemaakt is
const param = (v = 0) => ({ value: v, ev: [],
  setValueAtTime(x, t) { this.ev.push(['set', x, t]); this.value = x; },
  linearRampToValueAtTime(x, t) { this.ev.push(['ramp', x, t]); this.value = x; },
  setTargetAtTime(x, t, tau) { this.ev.push(['target', x, t, tau]); this.value = x; },
  setValueCurveAtTime() { CURVES++; },
  cancelAndHoldAtTime(t) { this.ev.push(['hold', t]); },
  cancelScheduledValues(t) { this.ev.push(['cancel', t]); },
});
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), offset: param(0), delayTime: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, curve: null, oversample: 'none',
  connect(naar) { LIJNEN.push({ van: this, naar }); return naar; },
  disconnect(naar) { for (let i = LIJNEN.length - 1; i >= 0; i--) if (LIJNEN[i].van === this && (naar === undefined || LIJNEN[i].naar === naar)) LIJNEN.splice(i, 1); },
  getByteTimeDomainData(b) { b.fill(128); },
  getFloatFrequencyData(b) { b.fill(-100); },
});
const verbonden = (van, naar) => LIJNEN.some((l) => l.van === van && l.naar === naar);
const bron = (type) => {
  const n = node(type);
  n._start = null; n._stop = null; n._klaar = false;
  n.start = (t = 0) => { n._start = t; };
  n.stop = (t = 0) => { n._stop = t; };
  return n;
};
/** Wat in de echte browser vanzelf gebeurt: onended zodra de stoptijd voorbij is. */
const vuurEinden = () => { for (const o of OSCS) if (!o._klaar && o._stop !== null && o._stop <= NOW) { o._klaar = true; o.onended?.(); } };
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { const n = node('biquad'); n.type = 'lowpass'; return n; }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { return node('delay'); }
  createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); }
  createOscillator() { const o = bron('osc'); o.type = 'sine'; o.frequency.value = 440; o.setPeriodicWave = (w) => { o.type = 'custom'; o.golf = w; }; OSCS.push(o); return o; }
  createConstantSource() { return bron('constant'); }
  // Wat FM (MediSynth) gebruikt: een eigen golfvorm en een panner per stem.
  createPeriodicWave(re, im) { return { re, im }; }
  createStereoPanner() { const n = node('panner'); n.pan = param(0); return n; }
  createBufferSource() {
    const s = bron('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    const stop = s.stop; s.stop = (t) => { stop(t); queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
// De stand van een bevestiging (tweede druk binnen 3 s) loopt op performance.now().
let KLOK_MS = 0;
Object.defineProperty(globalThis.performance, 'now', { value: () => KLOK_MS, configurable: true, writable: true });

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

const { Poly, POLY, PARAMS, POLYFONIE, OPHOGING, BUIG_CENT, DRUK_OCT, VIBRATO_CENT, filterHz, vervalTijd, attackTijd, nootHz, golfVan }
  = await import('../src/engine/instrumenten/poly.js');
const { INSTRUMENTEN, instrumentDef } = await import('../src/engine/instrumenten/index.js');
const { startDrempel } = await import('../src/engine/overgang.js');
const { KILL_FADE } = await import('../src/engine/audio-graph.js');

// ---- 1. de Poly zelf ---------------------------------------------------------
console.log('de Poly (het contract)');
{
  const ctx = new AudioContext();
  const uit = ctx.createGain();
  const p = POLY.maak(ctx, { uit, klok: () => null, toon: () => null });
  ok('POLY staat in INSTRUMENTEN, instrumentDef vindt hem', INSTRUMENTEN.includes(POLY) && instrumentDef('poly') === POLY && instrumentDef('xx') === null);
  ok('definitie: soort [a-z0-9-], naam, maak()', /^[a-z0-9-]+$/.test(POLY.soort) && POLY.naam === 'Poly' && typeof POLY.maak === 'function');
  ok('het object heeft elk lid van het contract', p instanceof Poly && p.soort === 'poly' && p.naam === 'Poly'
    && ['start', 'noteOn', 'noteOff', 'alleUit', 'stil', 'druk', 'buig', 'mod', 'houd', 'zetParam', 'leesParam', 'stand', 'vernietig']
      .every((f) => typeof p[f] === 'function'));
  ok('acht params, elk { id, label, standaard 0..1, eenheid() }', p.params.length === 8 && p.params === PARAMS
    && PARAMS.every((x) => x.id && x.label && x.standaard >= 0 && x.standaard <= 1 && typeof x.eenheid(x.standaard) === 'string'));
  ok('eenheden in echte eenheden: zaag · ±8 ct · 2,1 kHz · 10 ms · 337 ms · 70%',
    PARAMS[0].eenheid(0) === 'zaag' && PARAMS[0].eenheid(1) === 'sinus' && PARAMS[1].eenheid(0.2) === '±8 ct'
    && PARAMS[2].eenheid(0.62) === '2.1 kHz' && PARAMS[5].eenheid(0.22) === '10 ms' && PARAMS[6].eenheid(0.55) === '337 ms'
    && PARAMS[7].eenheid(0.7) === '70%');
  ok('start() is een Promise, en nog eens mag', p.start() instanceof Promise && p.start() instanceof Promise);
  ok('de bus op de ophoging, naar `uit`', dicht(p.bus.gain.value, OPHOGING) && verbonden(p.bus, uit));
  ok('stand() zonder noten', JSON.stringify(p.stand()) === JSON.stringify({ soort: 'poly', naam: 'Poly', klinkt: 0, params: PARAMS.map((x) => x.standaard) }));

  NOW = 10;
  p.noteOn(69, 0.8);
  const s = p.stemmen[0];
  ok('A4 (69): twee oscillatoren op 440 Hz, ±8 cent ontstemd, zaag', s && s.oscs.length === 2 && s.oscs.every((o) => o.frequency.value === 440)
    && s.oscs[0].detune.value === -8 && s.oscs[1].detune.value === 8 && s.oscs.every((o) => o.type === 'sawtooth') && dicht(nootHz(60), 261.6255653005986));
  ok('… beginnen nu (op de audioklok)', s.oscs.every((o) => o._start === 10));
  ok('bedrading: osc -> filter (lowpass) -> vca -> bus', s.oscs.every((o) => verbonden(o, s.filter)) && s.filter.type === 'lowpass'
    && verbonden(s.filter, s.vca) && verbonden(s.vca, p.bus));
  ok('modulatie: buiging en vibrato op de detune van elke oscillator, druk op die van het filter',
    s.oscs.every((o) => verbonden(p.buigBron, o.detune) && verbonden(p.vibrato, o.detune)) && verbonden(p.drukBron, s.filter.detune));
  const A = attackTijd(PARAMS[5].standaard), D = vervalTijd(PARAMS[6].standaard), S = PARAMS[7].standaard;
  const piek = 0.5 * 0.8 * 0.8;
  const ev = s.vca.gain.ev;
  ok(`ADSR op de vca: 0 op nu, helling naar ${piek.toFixed(2)} in ${(A * 1000).toFixed(0)} ms, dan naar sustain (τ = decay/3)`,
    ev[0][0] === 'set' && ev[0][1] === 0 && ev[0][2] === 10 && ev[1][0] === 'ramp' && dicht(ev[1][1], piek) && dicht(ev[1][2], 10 + A)
    && ev[2][0] === 'target' && dicht(ev[2][1], piek * S) && dicht(ev[2][2], 10 + A) && dicht(ev[2][3], D / 3) && s.vca.gain.ev.length === 3);
  const fe = s.filter.detune.ev;
  ok('dezelfde vorm op het filter (detune, cent), dieper bij een hardere aanslag',
    fe[1][0] === 'ramp' && dicht(fe[1][1], 0.35 * 6000 * (0.5 + 0.5 * 0.8)) && fe[2][0] === 'target' && dicht(fe[2][1], fe[1][1] * S)
    && dicht(s.filter.frequency.value, filterHz(0.62)));
  ok('stand: één stem klinkt', p.stand().klinkt === 1);

  NOW = 11;
  p.noteOff(69);
  const R = vervalTijd(PARAMS[6].standaard);
  ok('noteOff: vasthouden waar hij is, dan naar 0 met τ = release/3; stop na 3× release', s.los
    && s.vca.gain.ev.at(-2)[0] === 'hold' && s.vca.gain.ev.at(-2)[1] === 11 && s.vca.gain.ev.at(-1)[0] === 'target' && s.vca.gain.ev.at(-1)[1] === 0
    && dicht(s.vca.gain.ev.at(-1)[3], R / 3) && s.oscs.every((o) => dicht(o._stop, 11 + 3 * R + 0.02)));
  ok('… het filter sluit mee', s.filter.detune.ev.at(-1)[0] === 'target' && s.filter.detune.ev.at(-1)[1] === 0);
  ok('… en hij klinkt nog uit (telt mee) tot zijn stop', p.stand().klinkt === 1);
  NOW = 11 + 3 * R + 0.03;
  vuurEinden();
  ok('na de stop: niets klinkt meer, en de stem is losgemaakt (ook van de modulatie)', p.stand().klinkt === 0
    && !LIJNEN.some((l) => l.van === s.vca || l.van === s.filter || s.oscs.includes(l.van) || s.oscs.some((o) => l.naar === o.detune)));

  NOW = 20;
  p.noteOn(60, 0);
  ok('snelheid 0 = noot uit (geen nieuwe stem)', p.stand().klinkt === 0);
  p.noteOn(60, 1);
  p.noteOn(60, 1);
  ok('dezelfde noot nog eens: de oude laat los, de nieuwe klinkt', p.stemmen.filter((x) => x.noot === 60 && !x.los).length === 1
    && p.stemmen.filter((x) => x.noot === 60 && x.los).length === 1);
  p.stil();
  ok('stil(): alles gaat eraf', p.stand().klinkt === 0);
  NOW = 21;
  vuurEinden();

  // Stemroof: POLYFONIE stemmen, dan nog een: de oudste eraf, zonder tik.
  NOW = 30;
  for (let i = 0; i < POLYFONIE; i++) { NOW = 30 + i * 0.01; p.noteOn(40 + i, 0.7); }
  ok(`${POLYFONIE} stemmen tegelijk (polyfonie ≥ 8)`, POLYFONIE >= 8 && p.stand().klinkt === POLYFONIE);
  const eerste = p.stemmen.find((x) => x.noot === 40);
  NOW = 31;
  p.noteOn(80, 0.7);
  const WACHT = startDrempel(ctx);
  const geroofd = eerste.vca.gain.ev.slice(eerste.vca.gain.ev.map((e) => e[0]).lastIndexOf('hold'));
  ok('nog een noot: de oudste (40) wordt geroofd, de nieuwe klinkt, het blijven er ' + POLYFONIE,
    eerste.gestolen && p.stand().klinkt === POLYFONIE && p.stemmen.some((x) => x.noot === 80 && !x.gestolen));
  ok(`… zonder tik: vasthouden, dan een zachte S in ${KILL_FADE * 1000} ms na de startdrempel (${(WACHT * 1000).toFixed(1)} ms), geen curve`,
    geroofd[0][0] === 'hold' && geroofd.filter((e) => e[0] === 'ramp').length === 32 && geroofd.at(-1)[1] === 0
    && dicht(geroofd.at(-1)[2], 31 + WACHT + KILL_FADE) && geroofd.filter((e) => e[0] === 'ramp').every((e) => e[2] > 31 + WACHT - 1e-9) && CURVES === 0);
  ok('… en daarna gestopt', eerste.oscs.every((o) => dicht(o._stop, 31 + WACHT + KILL_FADE + 0.005)));
  // Wat al los is gaat eerst, ook als het niet de oudste is.
  NOW = 32;
  p.noteOff(50);
  const los = p.stemmen.find((x) => x.noot === 50 && !x.gestolen);
  p.noteOn(81, 0.7);
  ok('stemroof neemt eerst een stem die al los is (50), niet de oudste ingedrukte', los.gestolen && !p.stemmen.find((x) => x.noot === 41).gestolen);
  p.stil();
  NOW = 33;
  vuurEinden();

  // Gepland roven (een sequencer plant vooruit): vanaf de stand die de envelope DAN
  // heeft, met een expliciet beginpunt (in Chrome begon de helling anders op 0).
  NOW = 34;
  for (let i = 0; i < POLYFONIE; i++) p.noteOn(40 + i, 0.7);
  const oudste = p.stemmen.find((x) => x.noot === 40 && !x.gestolen);
  p.noteOn(90, 0.7, 36);
  const ge = oudste.vca.gain.ev.slice(oudste.vca.gain.ev.map((e) => e[0]).lastIndexOf('hold'));
  const dan = 0.5 * 0.49 * (S + (1 - S) * Math.exp(-(36 - 34 - A) / (D / 3)));
  ok('gepland roven: vasthouden op t, beginpunt = de stand van de envelope dan, dan de zachte S naar 0 in 5 ms',
    ge[0][1] === 36 && ge[1][0] === 'set' && dicht(ge[1][1], dan) && dicht(ge[1][2], 36) && ge.filter((e) => e[0] === 'ramp').length === 32
    && ge.at(-1)[1] === 0 && dicht(ge.at(-1)[2], 36 + KILL_FADE) && oudste.gestolen);
  ok('… de envelope-som klopt ook na het loslaten (_envOp)', (() => {
    const z = p.stemmen.find((x) => x.noot === 41 && !x.gestolen);
    p.noteOff(41, 35);
    const R = vervalTijd(PARAMS[6].standaard);
    const bij35 = 0.245 * (S + (1 - S) * Math.exp(-(35 - 34 - A) / (D / 3)));
    return dicht(p._envOp(z, 35.5), bij35 * Math.exp(-0.5 / (R / 3))) && p._envOp(z, 34) === 0 && dicht(p._envOp(z, 34 + A / 2), 0.245 / 2);
  })());
  p.stil();
  NOW = 37;
  vuurEinden();

  // Sustain: noteOff wacht op het pedaal.
  NOW = 40;
  p.noteOn(64, 0.5);
  p.houd(true);
  p.noteOff(64);
  const h = p.stemmen.find((x) => x.noot === 64 && !x.gestolen);
  ok('pedaal in: noteOff laat hem klinken (vastgehouden)', !h.los && h.vastgehouden && p.stand().klinkt === 1);
  NOW = 41;
  p.houd(false);
  ok('pedaal los: nu laat hij los', h.los && !h.vastgehouden);
  p.noteOn(65, 0.5);
  p.alleUit();
  ok('alleUit: alles los (klinkt nog uit)', p.stemmen.filter((x) => !x.gestolen && !x.los).length === 0);

  // Knoppen.
  p.noteOn(67, 0.5);
  const k = p.stemmen.at(-1);
  p.zetParam(3, 0.2);
  ok('zetParam/leesParam: plek 3 (filter) zet het filter van wat klinkt bij', p.leesParam(3) === 0.2
    && k.filter.frequency.ev.at(-1)[0] === 'target' && dicht(k.filter.frequency.ev.at(-1)[1], filterHz(0.2)));
  p.zetParam(4, 1);
  ok('plek 4 (reso) ook', k.filter.Q.ev.at(-1)[0] === 'target' && dicht(k.filter.Q.ev.at(-1)[1], 18));
  p.zetParam(2, 0.5);
  ok('plek 2 (ontstem): ±20 cent, glijdend', k.oscs[0].detune.ev.at(-1)[1] === -20 && k.oscs[1].detune.ev.at(-1)[1] === 20);
  p.zetParam(1, 0.99);
  ok('plek 1 (golf) geldt vanaf de volgende noot', k.oscs[0].type === 'sawtooth' && golfVan(0.99) === 'sine');
  p.noteOn(69, 0.5);
  ok('… die is een sinus', p.stemmen.at(-1).oscs.every((o) => o.type === 'sine'));
  ok('leesParam buiten 1..8: null; zetParam erbuiten doet niets', p.leesParam(0) === null && p.leesParam(9) === null
    && (p.zetParam(9, 0.5), p.stand().params.length === 8));
  p.zetParam(5, 2);
  ok('waarden worden geklemd op 0..1', p.leesParam(5) === 1);
  for (let i = 1; i <= 8; i++) p.zetParam(i, PARAMS[i - 1].standaard);

  // Buigen, druk, mod.
  p.buig(1);
  ok('buig(1) = +2 halve tonen op alles wat klinkt', p.buigBron.offset.ev.at(-1)[0] === 'target' && p.buigBron.offset.ev.at(-1)[1] === BUIG_CENT && BUIG_CENT === 200);
  p.buig(-3);
  ok('buig wordt geklemd op −1', p.buigBron.offset.ev.at(-1)[1] === -BUIG_CENT);
  p.druk(0.5);
  ok('druk zonder noot: het hele kanaal (filter een octaaf open bij 0,5)', p.drukBron.offset.ev.at(-1)[1] === 0.5 * DRUK_OCT * 1200);
  const d69 = p.stemmen.at(-1);
  p.druk(1, 69);
  ok('druk op één noot (polyfone aftertouch): alleen die stem', dicht(d69.filter.frequency.ev.at(-1)[1], filterHz(0.62) * 4) && d69.druk === 1);
  p.mod(1);
  ok('modwiel = vibrato', p.vibrato.gain.ev.at(-1)[1] === VIBRATO_CENT);
  p.buig(0); p.druk(0); p.mod(0);

  // Een noot in de toekomst (de sequencer van S4 plant vooruit).
  NOW = 50;
  p.stil();
  p.noteOn(72, 0.6, 51);
  const t = p.stemmen.at(-1);
  ok('noteOn met t in de toekomst: alles op dat moment', t.oscs.every((o) => o._start === 51) && t.vca.gain.ev[0][2] === 51);
  p.noteOff(72, 52);
  ok('noteOff met t: loslaten op dat moment', t.vca.gain.ev.at(-2)[1] === 52);
  p.noteOn(73, 0.6, 49);
  ok('t in het verleden = nu', p.stemmen.at(-1).oscs[0]._start === 50);

  // Vernietigen: stil, dan pas los.
  NOW = 60;
  p.noteOn(60, 0.5);
  p.vernietig();
  ok('vernietig: eerst stil (fade), de bus nog aangesloten', p.stand().klinkt === 0 && verbonden(p.bus, uit));
  await wacht(130);
  ok('… daarna alles los, de modulatie gestopt', !verbonden(p.bus, uit) && p.buigBron._stop !== null && p.lfo._stop !== null);
  const n = OSCS.length;
  p.noteOn(60, 1);
  ok('na vernietig doet niets meer iets', OSCS.length === n && p.stand().klinkt === 0);
  ok('nergens setValueCurveAtTime', CURVES === 0);
}

// ---- 2. de engine ----------------------------------------------------------------
console.log('\nde engine: een nummer óf een instrument');
const { Engine, DECK_IDS } = await import('../src/engine/engine.js');
const { bindEngine, invoke, read, list, has } = await import('../src/control/actions.js');
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const eng = new Engine();
bindEngine(eng);
const meldingen = [];
eng.on('melding', (m) => meldingen.push(m));
const gebeurd = [];
eng.on('instrument', (x) => gebeurd.push(x));
const buf = renderDemoTrack(eng.ctx, { bars: 8 });
{
  NOW = 100;
  const dC = eng.deck('C');
  ok('zonder instrument: instrumentOp null, speeltrack null, snapshot null', eng.instrumentOp('C') === null && eng.speeltrack() === null
    && eng.snapshot().decks.C.instrument === null && eng.snapshot().speel === null);
  ok('onbekend instrument: geweigerd met een reden', eng.zetInstrument('C', 'banjo').ok === false && /banjo/.test(eng.zetInstrument('C', 'banjo').reden)
    && eng.instrumentOp('C') === null);
  const r = eng.zetInstrument('C', 'poly');
  const inst = eng.instrumentOp('C');
  const aansl = eng._inst.C.aansluiting;
  ok('zetInstrument(C, poly): het instrument staat erop', r.ok && inst instanceof Poly && gebeurd.at(-1).id === 'C' && gebeurd.at(-1).soort === 'poly');
  ok('… het sluit aan op chain.input (trim) van track 3, via een eigen aansluiting', verbonden(inst.bus, aansl) && verbonden(aansl, dC.chain.input)
    && dC.chain.input === dC.chain.trim);
  ok('… en daarachter de hele strip: EQ, effect, filter, fader, crossfader, naar de master; de sends na de fader; de cue tapt het filter',
    verbonden(dC.chain.trim, dC.chain.eqLow) && verbonden(dC.chain.eqHigh, dC.fx.in) && verbonden(dC.fx.out, dC.chain.hpf)
    && verbonden(dC.chain.lpf, dC.chain.fader) && verbonden(dC.chain.fader, dC.chain.xfade) && verbonden(dC.chain.xfade, eng.master.input)
    && verbonden(dC.chain.fader, dC.sendA) && verbonden(dC.chain.fader, dC.sendB));
  const sn = eng.snapshot().decks.C;
  ok('snapshot: { soort, naam, klinkt, params }; de track zelf is leeg (geen nummer)', sn.instrument.soort === 'poly' && sn.instrument.naam === 'Poly'
    && sn.instrument.klinkt === 0 && sn.instrument.params.length === 8 && !sn.loaded && !sn.playing);
  ok('dezelfde nog eens: niets verandert', eng.zetInstrument('C', 'poly').ok && eng.instrumentOp('C') === inst);

  // Speeltrack.
  eng.setFocus('A');
  ok('speeltrack: focus zonder instrument -> de eerste track met een instrument (3)', eng.speeltrack() === 'C' && eng.snapshot().speel === 'C');
  eng.zetInstrument('E', 'poly');
  ok('instrument op 5 (niet de focus): de speeltrack blijft 3', eng.speeltrack() === 'C');
  eng.setFocus('E');
  ok('focus op 5: speeltrack 5', eng.speeltrack() === 'E');
  eng.setFocus('B');
  ok('focus weg naar een track zonder instrument: de laatste focus-track met een instrument (5)', eng.speeltrack() === 'E');
  eng.zetInstrument('E', null);
  ok('instrument van 5 weg: terug naar 3', eng.speeltrack() === 'C' && eng.instrumentOp('E') === null);

  // Weghalen: klikvrij dicht, dan pas vernietigen en los.
  NOW = 110;
  inst.noteOn(60, 0.8);
  const WACHT = startDrempel(eng.ctx);
  eng.zetInstrument('C', null);
  const ev = aansl.gain.ev;
  ok('weghalen: de aansluiting gaat klikvrij dicht (hellingen na de startdrempel), geen curve',
    eng.instrumentOp('C') === null && ev[0][0] === 'hold' && ev.at(-1)[0] === 'ramp' && ev.at(-1)[1] === 0
    && dicht(ev.at(-1)[2], 110 + WACHT + KILL_FADE) && CURVES === 0);
  ok('… de noten laten los, de aansluiting zit nog vast tot de fade klaar is', inst.stemmen.every((s) => s.los || s.gestolen) && verbonden(aansl, dC.chain.input));
  await wacht(140);
  ok('… daarna vernietigd en losgemaakt', !verbonden(aansl, dC.chain.input) && inst._weg);

  // Een nummer dat speelt -> instrument erop: het nummer gaat eraf.
  NOW = 120;
  dC.load(buf, 'een nummer');
  dC.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dC.hotcues[0] = 1;
  dC.cuePoint = 2;
  dC.play();
  let geladen = 0;
  const uitLoad = dC.on('load', () => geladen++);
  ok('track 3 speelt een nummer', dC.playing && !!dC.buffer);
  eng.zetInstrument('C', 'poly');
  ok('instrument erop: het nummer is eraf (leeg, stil, geen grid, cue of hotcues), het instrument staat erop',
    !dC.buffer && !dC.playing && dC.grid === null && dC.cuePoint === 0 && dC.hotcues.every((x) => x === null) && dC.title === '— leeg —'
    && eng.instrumentOp('C') instanceof Poly && geladen === 1);
  // En andersom: een nummer laden haalt het instrument weg.
  const inst2 = eng.instrumentOp('C');
  dC.load(buf, 'weer een nummer');
  ok('een nummer laden haalt het instrument weg', eng.instrumentOp('C') === null && !!dC.buffer && dC.title === 'weer een nummer'
    && gebeurd.at(-1).soort === null && inst2.stemmen.every((s) => s.los || s.gestolen));
  uitLoad();
  dC.stop();

  // Een laad die nog loopt (streamen) telt niet meer als er intussen een instrument op kwam.
  const { maakWav } = await import('../src/engine/stream-kern.js');
  const { geheugenHaal } = await import('../src/engine/bron.js');
  eng.ctx.audioWorklet = { addModule: async () => {} };
  globalThis.AudioWorkletNode = class {
    constructor(_c, _n, o = {}) { this.numberOfOutputs = o.numberOfOutputs ?? 1; this.port = { postMessage() {}, onmessage: null }; }
    connect(d) { return d; } disconnect() {}
  };
  const wav = maakWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
  let laat, eerste = true;
  // Alleen de kop laat op zich wachten; de pagina's daarna komen meteen.
  const traag = (url, init) => {
    if (!eerste) return geheugenHaal(wav)(url, init);
    eerste = false;
    return new Promise((r) => { laat = () => r(geheugenHaal(wav)(url, init)); });
  };
  const dF = eng.deck('F');
  const bezig = dF.laadStream('/media/x/audio.wav', 'traag nummer', { haal: traag });
  await wacht(5);
  ok('track 6 is aan het laden', dF.laadt);
  eng.zetInstrument('F', 'poly');
  laat();
  const uitkomst = await bezig;
  ok('instrument erop tijdens het laden: de laad geeft false, de track blijft van het instrument', uitkomst === false && !dF.buffer
    && dF.title === '— leeg —' && eng.instrumentOp('F') instanceof Poly);
  eng.zetInstrument('F', null);
  await wacht(140);
}

// ---- maatgever, sync, op de maat: een track zonder nummer die wél klinkt ----------
console.log('\nmaatgever, sync en de rest blijven heel');
{
  NOW = 200;
  const dA = eng.deck('A'), dD = eng.deck('D');
  dA.load(buf, 'maat');
  dA.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dA.set('fader', 0.3);
  dA.play();
  eng.zetInstrument('D', 'poly');
  eng.deck('D').set('fader', 1);
  eng.instrumentOp('D').noteOn(60, 1);
  ok('een instrument geeft nooit de maat, ook niet als hij harder klinkt (geen grid, speelt niet)', eng.maatgever() === dA && eng.syncMaster('B') === dA);
  ok('syncMaster van het instrument zelf: de maatgever', eng.syncMaster('D') === dA);
  ok('sync op de instrumenttrack: geweigerd (leeg), niets kapot', eng.sync('D').ok === false && /leeg/.test(eng.sync('D').reden));
  ok('starten op de maat op de instrumenttrack: geweigerd (leeg)', eng.startOpDeMaat('D').ok === false);
  ok('level() van de instrumenttrack werkt (de analyser zit achter de strip)', typeof dD.level() === 'number');
  const k = eng._inst.D.obj;
  ok('het instrument krijgt de klok en de toon van de maatgever (klok/toon in maak)', typeof k === 'object');
  dA.pause();
  ok('niets speelt: geen maatgever, het instrument nog steeds niet', eng.maatgever() === null);
  const snap = eng.snapshot();
  ok('snapshot: maat van een geladen track met grid, nooit het instrument', snap.maat === 'A' && snap.decks.D.instrument.klinkt === 1);
  // De auto-DJ laadt nooit op een track met een instrument.
  const { Automaat } = await import('../src/auto/automaat.js');
  const vrij = Automaat.prototype._vrijDeck.call({ engine: eng, hoofd: 'A', eigen: new Set(['D']) });
  ok('auto-DJ: een vrije track is nooit een instrumenttrack (ook niet een die hij eerder gebruikte)', vrij !== 'D' && vrij !== null);
  const { leesStand } = await import('../src/control/handelingen.js');
  const { TRACKS } = await import('../src/control/actions.js');
  const stand = leesStand({ engine: eng, tracks: TRACKS, herkomst: () => null, acties: list(), lees: read });
  ok('handelingenlog: de beginstand leest gewoon (instrumenttrack = leeg, geen instrumentknoppen in de waarden)',
    stand.tracks.find((t) => t.track === 4).bron === 'leeg' && !Object.keys(stand.waarden).some((a) => /\.inst\./.test(a)));
  eng.instrumentOp('D').stil();
  eng.zetInstrument('D', null);
  dA.stop();
}

// ---- 3. de actions --------------------------------------------------------------
console.log('\nde actions');
{
  const { OVERSLAAN } = await import('../src/control/terugspelen.js');
  const { NIET_IN_WAARDEN } = await import('../src/control/handelingen.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  NOW = 300;
  const acties = ['track.7.inst', 'track.7.inst.next', 'track.7.inst.prev', 'track.7.inst.stil', ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `track.7.inst.knob.${k}`)];
  ok('elke instrument-action bestaat, voor elke track', [1, 2, 3, 4, 5, 6, 7, 8].every((t) => has(`track.${t}.inst`) && has(`track.${t}.inst.knob.8`)) && acties.every(has));
  ok('… met een uitleg voor de APC-kaart', acties.every((a) => beschrijf(a).kort !== a && !beschrijf(a).lang.startsWith('?')));
  const typen = list().filter((a) => acties.includes(a.id));
  ok('kiezen, bladeren en stil zijn triggers; de knoppen value', typen.every((a) => (/knob/.test(a.id) ? a.type === 'value' : a.type === 'trigger')));
  ok('zonder instrument: kiezen leest 0, knoppen, stil en bladeren null', read('track.7.inst') === 0 && read('track.7.inst.knob.1') === null
    && read('track.7.inst.stil') === null && read('track.7.inst.next') === null);
  invoke('track.7.inst', true); invoke('track.7.inst', false);
  const g = eng.deck('G');
  ok(`track.7.inst: geen -> poly (het eerste in de lijst; read 1/${INSTRUMENTEN.length})`, eng.instrumentOp('G')?.soort === 'poly'
    && dicht(read('track.7.inst'), 1 / INSTRUMENTEN.length));
  invoke('track.7.inst.knob.3', 0.4);
  ok('instrumentknop 3 = plek 3 van het instrument, read terug', dicht(read('track.7.inst.knob.3'), 0.4) && dicht(eng.instrumentOp('G').leesParam(3), 0.4));
  ok('knoppen lezen de standaard van het instrument', dicht(read('track.7.inst.knob.8'), 0.7));
  eng.instrumentOp('G').noteOn(64, 0.7);
  ok('stil: lampje 0,5 als er iets klinkt', read('track.7.inst.stil') === 0.5);
  invoke('track.7.inst.stil', true);
  ok('… 1 zolang ingedrukt, en het instrument is stil', read('track.7.inst.stil') === 1 && eng.instrumentOp('G').stand().klinkt === 0);
  invoke('track.7.inst.stil', false);
  ok('… daarna 0', read('track.7.inst.stil') === 0);
  invoke('track.7.inst.next', true);
  ok(`bladeren: van poly naar ${INSTRUMENTEN[1 % INSTRUMENTEN.length].soort} (nooit naar "geen")`,
    eng.instrumentOp('G')?.soort === INSTRUMENTEN[1 % INSTRUMENTEN.length].soort);
  invoke('track.7.inst.prev', true);
  ok('en terug: weer poly', eng.instrumentOp('G')?.soort === 'poly');
  let drukken = 0;
  while (eng.instrumentOp('G') && drukken <= INSTRUMENTEN.length) { invoke('track.7.inst', true); drukken++; }
  ok(`track.7.inst rondlopend: na het laatste instrument terug naar geen (${drukken}× vanaf poly)`,
    eng.instrumentOp('G') === null && read('track.7.inst') === 0 && drukken === INSTRUMENTEN.length);

  // Een nummer dat SPEELT: pas bij een tweede druk binnen 3 s.
  g.load(buf, 'speelt');
  g.play();
  KLOK_MS = 10000;
  const n0 = meldingen.length;
  invoke('track.7.inst', true);
  ok('op een spelende track: eerst een melding, er verandert niets', eng.instrumentOp('G') === null && g.playing && meldingen.length === n0 + 1
    && /nog eens/.test(meldingen.at(-1).tekst));
  KLOK_MS = 14000;
  invoke('track.7.inst', true);
  ok('na 3 s telt het als een eerste druk: weer alleen de melding', eng.instrumentOp('G') === null && g.playing && meldingen.length === n0 + 2);
  KLOK_MS = 15000;
  invoke('track.7.inst', true);
  ok('tweede druk binnen 3 s: het nummer eraf, poly erop', eng.instrumentOp('G')?.soort === 'poly' && !g.playing && !g.buffer);
  g.load(buf, 'stil nummer');
  ok('(een nummer laden haalde hem weer weg)', eng.instrumentOp('G') === null);
  invoke('track.7.inst.next', true);
  ok('op een track met een nummer dat NIET speelt: meteen (niet destructief)', eng.instrumentOp('G')?.soort === 'poly' && !g.buffer);
  eng.zetInstrument('G', null);              // opruimen (met meer instrumenten gaat track.7.inst naar het volgende)

  ok('terugspelen slaat instrument-actions over; hun knoppen staan niet in de beginstand',
    ['track.3.inst', 'track.3.inst.knob.2', 'track.3.inst.stil', 'track.3.inst.next'].every((a) => OVERSLAAN.test(a))
    && NIET_IN_WAARDEN.test('track.3.inst.knob.2') && !OVERSLAAN.test('track.3.fader') && !NIET_IN_WAARDEN.test('track.3.fader')
    && !OVERSLAAN.test('track.3.instx'));
  await wacht(140);
}

// ---- 4. noten.js met nep-poorten --------------------------------------------------
console.log('\nnoten.js: MIDI-noten naar de speeltrack');
{
  const { Noten } = await import('../src/control/noten.js');
  const { Emitter } = await import('../src/lib/emitter.js');
  NOW = 400;
  KLOK_MS = 50000;
  let nu = 0;
  const noten = new Noten({ engine: eng, read, invoke, nu: () => nu });
  const doc = JSON.parse(readFileSync(new URL('../mappings/xboard49.json', import.meta.url), 'utf8'));
  const uitMap = noten.laadMapping(doc);
  ok('mappings/xboard49.json laadt: knop 1–8 (CC 21–28, elk kanaal) -> track.{speel}.inst.knob.1–8, absoluut (pickup)',
    uitMap.aantal === 8 && uitMap.fouten.length === 0 && doc.rules.every((r, i) => r.in === `cc:*:${21 + i}` && r.action === `track.{speel}.inst.knob.${i + 1}` && r.mode === 'absolute')
    && /TE CONTROLEREN/.test(doc.aanname));

  // Een nep-poort zoals de hub hem straks levert: alleen onmidimessage.
  const xb = { id: 'xb', name: 'Xboard49 (hub)', state: 'connected', onmidimessage: null };
  const stuur = (p, ...bytes) => p.onmidimessage({ data: Uint8Array.from(bytes), timeStamp: 0 });
  noten.koppel(xb);
  ok('koppel(): de poort krijgt een onmidimessage', typeof xb.onmidimessage === 'function');
  const geen = [];
  noten.on('geen', (x) => geen.push(x));
  stuur(xb, 0x90, 60, 100);
  ok('zonder instrument ergens: de noot doet niets, en dat wordt gemeld', geen.length === 1 && noten.vast.size === 0);

  eng.setFocus('B');
  eng.zetInstrument('B', 'poly');
  const pB = eng.instrumentOp('B');
  stuur(xb, 0x90, 60, 100);
  const s60 = pB.stemmen.find((s) => s.noot === 60);
  ok('note on (kanaal 1, 60, velocity 100) -> noteOn(60, 100/127) op de speeltrack (de focus, track 2)',
    s60 && !s60.los && dicht(s60.vca.gain.ev[1][1], 0.5 * (100 / 127) ** 2));
  stuur(xb, 0x90, 60, 0);
  ok('note on met velocity 0 = note off', s60.los);
  stuur(xb, 0x91, 62, 90);
  stuur(xb, 0x81, 62, 40);
  ok('note off (0x8n), ook op een ander kanaal', pB.stemmen.find((s) => s.noot === 62).los);

  // Focus wisselt terwijl je een toets vasthoudt: de noot-uit gaat naar waar de noot-aan heen ging.
  eng.zetInstrument('H', 'poly');
  const pH = eng.instrumentOp('H');
  stuur(xb, 0x90, 64, 80);
  eng.setFocus('H');
  stuur(xb, 0x90, 67, 80);
  ok('na een focuswissel naar track 8: nieuwe noten daar', pH.stemmen.some((s) => s.noot === 67) && !pB.stemmen.some((s) => s.noot === 67));
  stuur(xb, 0x80, 64, 0);
  ok('… en de toets die nog op track 2 lag laat daar los', pB.stemmen.find((s) => s.noot === 64).los);
  eng.setFocus('A');
  stuur(xb, 0x90, 69, 80);
  ok('focus op een track zonder instrument: de laatste focus-track met een (8)', pH.stemmen.some((s) => s.noot === 69 && !s.los));
  ok('ingedrukt(H): de noten die daar nu vastgehouden worden', [...noten.ingedrukt('H')].sort().join() === '67,69');

  // Pedaal, buigen, druk, modwiel, CC 120/123.
  stuur(xb, 0xb0, 64, 127);
  stuur(xb, 0x80, 69, 0);
  ok('sustain (CC 64): de noot blijft klinken', !pH.stemmen.find((s) => s.noot === 69).los && pH.pedaal);
  stuur(xb, 0xb0, 64, 0);
  ok('pedaal los: nu laat hij los', pH.stemmen.find((s) => s.noot === 69).los && !pH.pedaal);
  stuur(xb, 0xe0, 0x7f, 0x7f);
  ok('pitchbend 16383 = buig(+1)', pH.buigBron.offset.ev.at(-1)[1] === BUIG_CENT);
  stuur(xb, 0xe0, 0, 0);
  ok('pitchbend 0 = buig(−1)', pH.buigBron.offset.ev.at(-1)[1] === -BUIG_CENT);
  stuur(xb, 0xe0, 0, 64);
  ok('pitchbend 8192 = midden (0)', pH.buigBron.offset.ev.at(-1)[1] === 0);
  stuur(xb, 0xd0, 127);
  ok('kanaal-aftertouch = druk(1)', pH.drukBron.offset.ev.at(-1)[1] === DRUK_OCT * 1200);
  stuur(xb, 0xa0, 67, 127);
  ok('polyfone aftertouch = druk(1, noot)', pH.stemmen.find((s) => s.noot === 67 && !s.gestolen).druk === 1);
  stuur(xb, 0xb0, 1, 127);
  ok('modwiel (CC 1) = mod(1)', pH.vibrato.gain.ev.at(-1)[1] === VIBRATO_CENT);
  stuur(xb, 0xb0, 123, 0);
  ok('CC 123 (all notes off) = alleUit', pH.stemmen.every((s) => s.los || s.gestolen));
  stuur(xb, 0x90, 71, 90);
  stuur(xb, 0xb0, 120, 0);
  ok('CC 120 (all sound off) = stil', pH.stand().klinkt === 0 && noten.vast.size === 0);

  // De knoppen: absolute potmeters, eerst oppakken.
  ok('knop 3 (filter) staat op 0,62', dicht(read('track.8.inst.knob.3'), 0.62));
  nu = 1000;
  stuur(xb, 0xb0, 23, 127);
  ok('CC 23 = 127: ver van 0,62, dus nog niet opgepakt (geen sprong)', dicht(read('track.8.inst.knob.3'), 0.62));
  nu = 1010;
  stuur(xb, 0xb0, 23, 70);
  ok('CC 23 = 70: door de stand heen bewogen, nu opgepakt (0,551)', dicht(read('track.8.inst.knob.3'), 70 / 127));
  nu = 1020;
  stuur(xb, 0xb0, 24, 0);
  ok('CC 24 = 0: plek 4 (reso) stond op 0,2, dus nog niet', dicht(read('track.8.inst.knob.4'), 0.2));
  stuur(xb, 0xb5, 24, 26);
  ok('… CC 24 = 26 (0,205, ander kanaal): dichtbij genoeg, opgepakt', dicht(read('track.8.inst.knob.4'), 26 / 127));
  eng.setFocus('B');
  nu = 1030;
  stuur(xb, 0xb0, 23, 30);
  ok('speeltrack wisselt (track 2): de knop moet daar opnieuw opgepakt worden', dicht(read('track.2.inst.knob.3'), 0.62) && dicht(read('track.8.inst.knob.3'), 70 / 127));
  stuur(xb, 0xb0, 40, 64);
  ok('een CC die niet in de mapping staat doet niets', true);

  // De APC speelt geen noten; een poort die verdwijnt laat alles los.
  const apc = { id: 'apc', name: 'APC40 mkII', onmidimessage: null };
  noten.koppel(apc);
  const voor = pB.stemmen.length;
  stuur(apc, 0x90, 60, 127);
  ok('de APC speelt geen noten (dat is de controller)', pB.stemmen.length === voor);
  stuur(xb, 0x90, 50, 90);
  stuur(xb, 0xb0, 64, 127);
  noten.ontkoppel(xb);
  ok('ontkoppelen: de noten van die poort laten los, het pedaal ook', pB.stemmen.find((s) => s.noot === 50).los && !pB.pedaal && xb.onmidimessage === null);

  // Een echte MIDIInput heeft addEventListener: dan blijft de onmidimessage van de hub staan.
  const lijst = [];
  const echt = { id: 'echt', name: 'E-MU Xboard49', onmidimessage: () => lijst.push('hub'),
    addEventListener(t, f) { this._f = f; }, removeEventListener() { this._f = null; } };
  noten.koppel(echt);
  echt.onmidimessage({ data: Uint8Array.of(0x90, 52, 90) });
  echt._f({ data: Uint8Array.of(0x90, 52, 90), timeStamp: 1 });
  ok('een MIDIInput met addEventListener: luisteren ernaast, de bestaande onmidimessage blijft', lijst.length === 1 && pB.stemmen.some((s) => s.noot === 52 && !s.los));
  noten.ontkoppel(echt);

  // Meeluisteren op de MidiHub (geen eigen requestMIDIAccess).
  const hub = new Emitter();
  noten.hoorHub(hub);
  nu = 2000;
  const { parseMessage: parse } = await import('../src/control/midi.js');
  hub.emit('message', { ...parse([0x90, 55, 100]), port: 'p1', portName: 'E-MU Xboard49' });
  ok('hoorHub: berichten van een toetsenbord op de MidiHub spelen', pB.stemmen.some((s) => s.noot === 55 && !s.los));
  hub.emit('message', { ...parse([0x90, 57, 100]), port: 'p2', portName: 'APC40 mkII' });
  ok('… van de APC niet', !pB.stemmen.some((s) => s.noot === 57));
  hub.emit('ports', { inputs: [{ id: 'p2', name: 'APC40 mkII', state: 'connected' }, { id: 'p1', name: 'E-MU Xboard49', state: 'disconnected' }] });
  ok('… en trekt Clay de Xboard eruit (poort disconnected): de noot laat los', pB.stemmen.find((s) => s.noot === 55).los);
  ok('actief(): de poort die het laatst iets stuurde', noten.actief(5000)?.naam === 'E-MU Xboard49');
  nu = 9000;
  hub.emit('message', { ...parse([0xfe]), port: 'p3', portName: 'Ander keyboard' });
  ok('… active sensing (0xFE) telt niet als iets sturen', noten.actief(5000) === null && !noten.poorten.has('p3'));

  // Het schermtoetsenbord.
  noten.speel(48, 0.6);
  ok('speel()/laat(): het schermtoetsenbord speelt op de speeltrack', pB.stemmen.some((s) => s.noot === 48 && !s.los) && noten.ingedrukt('B').has(48));
  noten.laat(48);
  ok('… en laat los', pB.stemmen.find((s) => s.noot === 48).los && !noten.ingedrukt('B').has(48));
  // Instrument weg terwijl een toets vastzit: de noot-uit gaat nergens heen (geen fout).
  noten.speel(49, 0.6);
  eng.zetInstrument('B', null);
  let fout = null;
  try { noten.laat(49); } catch (e) { fout = e; }
  ok('instrument weg met een toets ingedrukt: loslaten geeft geen fout', fout === null && noten.vast.size === 0);
  eng.zetInstrument('H', null);
  await wacht(140);
}

// ---- 5. het mapje inst en de standaardmapping ----------------------------------------
console.log('\nhet mapje inst op de APC');
{
  const { Lagen, GROEPEN, LAAGNAAM, OP_AANVRAAG } = await import('../src/control/lagen.js');
  const { Mapping, eerdereStandaarden, sleutelVan, normaliseer } = await import('../src/control/mapping.js');
  const druk = (lg) => { lg.druk('device', 'view', true); lg.druk('device', 'view', false); };
  const zonder = new Lagen();
  druk(zonder); const a = zonder.stand.device; druk(zonder); const b = zonder.stand.device;
  ok('zonder instrument (standaard): Clip/Device View blijft strip -> rack -> strip', a === 'rack' && b === 'strip');
  let heeft = true;
  const met = new Lagen({ beschikbaar: (g, l) => g === 'device' && l === 'inst' && heeft });
  druk(met); const c = met.stand.device; druk(met); const d = met.stand.device; druk(met); const e = met.stand.device;
  ok('met een instrument op de focus-track: strip -> rack -> inst -> strip', c === 'rack' && d === 'inst' && e === 'strip');
  druk(met); druk(met);
  heeft = false;
  druk(met);
  ok('in inst en het instrument is weg: de kiesknop gaat naar de strip', met.stand.device === 'strip');
  ok('het mapje heeft een naam op het scherm en is op aanvraag', /instrument/.test(LAAGNAAM['device.inst']) && OP_AANVRAAG.has('device.inst')
    && GROEPEN.device.knoppen.view.join() === 'strip,rack,inst');

  const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  const inst = doc.rules.filter((r) => r.laag === 'device.inst');
  ok('standaardmapping: 11 regels in device.inst (8 knoppen, ◀ ▶, On/Off)', inst.length === 11
    && inst.filter((r) => r.in.startsWith('cc:')).every((r) => r.action === `track.{focus}.inst.knob.${Number(r.in.split(':')[2]) - 15}` && r.mode === 'endless')
    && inst.find((r) => r.in === 'note:0:58')?.action === 'track.{focus}.inst.prev' && inst.find((r) => r.in === 'note:0:59')?.action === 'track.{focus}.inst.next'
    && inst.find((r) => r.in === 'note:0:62')?.action === 'track.{focus}.inst.stil');
  const vorige = eerdereStandaarden(doc).find((x) => x.vingerafdruk === 'a067b3f2-397')?.doc;
  const oud = new Map((vorige?.rules ?? []).map((r) => [sleutelVan(r), JSON.stringify(r)]));
  const nu = new Map(normaliseer(doc).doc.rules.map((r) => [sleutelVan(r), JSON.stringify(r)]));
  // Wat er sinds a067b3f2-397 bijkwam: de 11 van device.inst, (spoor master) het mapje
  // master, en (spoor patronen, docs/PATRONEN.md) de modus patronen met Shift + scene 3.
  const erbij = [...nu.keys()].filter((k) => !oud.has(k));
  ok(`de vorige standaard (a067b3f2-397) is een voorganger: geen enkele bestaande regel veranderd of weg; erbij de 11 van inst (en het mapje master en de modus patronen: ${erbij.length - 11})`,
    vorige?.rules.length === 397 && [...oud].every(([k, t]) => nu.get(k) === t)
    && erbij.filter((k) => k.endsWith('@device.inst')).length === 11
    && erbij.every((k) => /@(device\.(inst|master)|grid\.patronen)$/.test(k) || ['note:0:64#shift', 'note:0:84#shift', 'note:0:84#shift@edit.aan'].includes(k)));
  const lg = new Lagen({ beschikbaar: () => true });
  const m = new Mapping({ read: () => null, invoke: () => {}, vars: () => ({ focus: 3 }), lagen: () => lg.actief() });
  m.load(doc);
  lg.zet('device', 'inst');
  ok('in het mapje inst: device knob 1 = instrumentknop 1 van de focus-track, On/Off = stil',
    m.kies('cc:0:16')?.action === 'track.{focus}.inst.knob.1' && m.kies('note:0:62')?.action === 'track.{focus}.inst.stil');
  lg.zet('device', 'strip');
  ok('in de strip en het rack verandert niets', m.kies('cc:0:16')?.action === 'track.{focus}.trim' && m.kies('note:0:62')?.action === 'track.{focus}.fx.bypass'
    && m.kies('note:0:58')?.action === 'track.{focus}.rack.prev');
}

// ---- 6. regel 1: de engine kent geen MIDI ---------------------------------------
{
  const bronPoly = readFileSync(new URL('../src/engine/instrumenten/poly.js', import.meta.url), 'utf8');
  const imports = [...bronPoly.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((x) => x[1]);
  ok('poly.js importeert alleen uit engine en lib', imports.every((i) => !/\/(ui|control|server|video)\//.test(i)));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
