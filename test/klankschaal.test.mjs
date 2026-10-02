// De klankschaal: stemming (puur), het geluid (de kern, zonder browser), de
// klasse met een nep-worklet, en de actions op een engine met een nep-Web Audio.
// Draai met: node test/klankschaal.test.mjs
import v8 from 'node:v8';
import vm from 'node:vm';

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const { stemming, TOONLADDERS, LADDERS, Klankschaal, STANDAARD_TOON } = await import('../src/engine/klankschaal.js');
const { SchaalKern, bouwModi, MAX_MODI } = await import('../src/engine/klankschaal-kern.js');
const { SPELLING, WIJZER } = await import('../src/engine/toonsoort.js');

const FS = 48000;
const cent = (a, b) => 1200 * Math.log2(a / b);

// ---- 1. stemming ---------------------------------------------------------------
console.log('stemming');
{
  // D Kurd van de Waterschaal (SCALES.kurd), kern D3.
  const st = stemming({ k: 14 });
  const ws = [220, 233.08, 261.63, 293.66, 329.63, 349.23, 392, 440];
  ok('D mineur, auto = Kurd', st.ladder === 'kurd' && st.k === 14 && !st.relatief);
  ok('kern D3 = 146,83 Hz (KERN_F van de Waterschaal)', st.kernNaam === 'D3' && Math.abs(st.kernHz - 146.83) < 0.01);
  ok('velden = A3 Bb3 C4 D4 E4 F4 G4 A4', st.velden.map((v) => v.naam).join(' ') === 'A3 Bb3 C4 D4 E4 F4 G4 A4');
  ok('velden gelijk aan de Waterschaal (< 0,1 cent)', st.velden.every((v, i) => Math.abs(cent(v.hz, ws[i])) < 0.1));
  ok('zonder toonsoort: STANDAARD_TOON (D mineur)', stemming({ k: null }).k === STANDAARD_TOON);

  // Een plaat die 43 cent hoog staat (zoned out): de schaal ook.
  const am = stemming({ k: 21, cent: 43 });
  ok('A mineur +43 ct: kern A2 43 cent hoog', am.kernNaam === 'A2' && Math.abs(cent(am.kernHz, 110) - 43) < 1e-6);
  ok('A mineur: veld 4 = de tonica A3', am.velden[3].naam === 'A3');

  const c = stemming({ k: 0 });
  ok('C majeur, auto = majeur, kern C3', c.ladder === 'majeur' && c.kernNaam === 'C3' && c.velden.map((v) => v.naam).join(' ') === 'G3 A3 B3 C4 D4 E4 F4 G4');
  const ck = stemming({ k: 0, ladder: 'kurd' });
  ok('Kurd op C majeur: relatief, A Kurd (dezelfde tonen als de plaat)', ck.relatief && ck.k === 21 && ck.kernNaam === 'A2');
  const am2 = stemming({ k: 21, ladder: 'majeur' });
  ok('majeur op A mineur: relatief, C majeur', am2.relatief && am2.k === 0);

  ok('transpositie +2: D mineur → E mineur', stemming({ k: 14, transpositie: 2 }).k === 16);
  ok('transpositie −12: zelfde toon, zelfde register', stemming({ k: 14, transpositie: -12 }).kernNaam === 'D3');
  ok('fijn telt op bij de cent van de plaat', Math.abs(stemming({ k: 14, cent: -20, fijn: 10 }).cent + 10) < 1e-9);
  ok('fijn geklemd op ±50', stemming({ k: 14, fijn: 400 }).cent === 50);

  // Elke toonsoort, elke ladder: in het register, oplopend, eindig.
  let register = true, oplopend = true, eindig = true;
  for (let k = 0; k < 24; k++) for (const l of LADDERS) {
    const s = stemming({ k, ladder: l });
    if (!(s.kernHz > 100 && s.kernHz < 200)) register = false;
    if (!s.velden.every((v, i) => i === 0 || v.hz > s.velden[i - 1].hz)) oplopend = false;
    if (!s.velden.every((v) => Number.isFinite(v.hz))) eindig = false;
  }
  ok('24 toonsoorten × 7 ladders: kern tussen 100 en 200 Hz (G♯2..G3)', register);
  ok('... velden oplopend', oplopend);
  ok('... alles eindig', eindig);

  // De kern van de zaak: de velden passen in de toonladder van de PLAAT.
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
  let passen = true;
  for (let k = 0; k < 24; k++) for (const l of ['auto', 'kurd', 'celtic', 'penta', 'majeur', 'pentaMajeur']) {
    const s = stemming({ k, ladder: l });
    const tonica = k % 12, ladder = k >= 12 ? MIN : MAJ;
    const pcs = [s.velden.map((v) => v.midi), 50 + ((((s.tonica - 2 + 6) % 12) + 12) % 12) - 6].flat();
    if (!pcs.every((m) => ladder.includes((((m - tonica) % 12) + 12) % 12))) { passen = false; console.log('   buiten de toonladder:', k, l); }
  }
  ok('elke toonsoort, elke diatonische ladder: alle tonen horen bij de toonsoort van de plaat', passen);
  ok('Hijaz staat erin (bewust met verhoogde septiem, niet diatonisch)', !!TOONLADDERS.hijaz);
}

// ---- 2. het geluid: de kern ------------------------------------------------------
console.log('\nde kern (zonder browser)');
const BLOK = 128;
function draai(kern, sec, { L = new Float32Array(BLOK), R = new Float32Array(BLOK), opvang = null } = {}) {
  const blokken = Math.round((sec * FS) / BLOK);
  let piek = 0, som = 0, eindig = true;
  for (let b = 0; b < blokken; b++) {
    kern.render(L, R, BLOK);
    for (let i = 0; i < BLOK; i++) {
      const x = L[i];
      if (!Number.isFinite(x) || !Number.isFinite(R[i])) eindig = false;
      piek = Math.max(piek, Math.abs(x), Math.abs(R[i]));
      som += x * x;
      if (opvang) opvang.push(x);
    }
  }
  return { piek, rms: Math.sqrt(som / (blokken * BLOK)), eindig };
}
/** Vermogen op frequentie f (Goertzel), over een stuk signaal. */
function goertzel(x, f) {
  const w = (2 * Math.PI * f) / FS, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    const s0 = x[i] * hann + c * s1 - s2; s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}
/** De toonhoogte van een stuk signaal: de sterkste in een fijn raster rond `rond` (±1 halve toon, per cent). */
function toonhoogte(x, rond) {
  let beste = null, max = -1;
  for (let c = -100; c <= 100; c++) {
    const f = rond * Math.pow(2, c / 1200);
    const p = goertzel(x, f);
    if (p > max) { max = p; beste = f; }
  }
  return beste;
}
const slag = (v, amp) => ({ t: 'slag', v, a: Array(12).fill(amp) });
{
  const kern = new SchaalKern(FS);
  const stil = draai(kern, 0.1);
  ok('zonder iets: stilte, en hij slaapt', stil.piek === 0 && kern.slaapt);

  const st = stemming({ k: 21, cent: 43 });
  const m = bouwModi({ kernHz: st.kernHz, veldHz: st.velden.map((v) => v.hz) });
  ok('bouwModi: 12 kern + 32 velden + lichaam = 45 modi (≤ MAX_MODI)', m.length === 45 && m.length <= MAX_MODI && m.every((o) => o.f > 0 && o.t60 > 0));
  kern.bericht({ t: 'opt', fric: 1, org: 0 });     // org 0: geen drift, zo meet je de stemming zelf
  kern.bericht({ t: 'modi', m });

  // Veld 4 = de tonica A3, +43 cent. Een seconde signaal na de klop.
  kern.bericht({ t: 'slag', v: 4, a: [0.5, 0, 0, 0] });
  const x = [];
  const r = draai(kern, 1.0, { opvang: x });
  ok('aanslag klinkt, binnen ±1 en eindig', r.piek > 0.01 && r.piek <= 1 && r.eindig);
  const f = toonhoogte(Float64Array.from(x.slice(4800)), 220);
  ok(`veld 4 klinkt op A3 +43 ct (gemeten ${cent(f, 220).toFixed(1)} ct)`, Math.abs(cent(f, 220) - 43) <= 2);

  // De kern: grondtoon A2 +43 ct.
  const k2 = new SchaalKern(FS);
  k2.bericht({ t: 'opt', fric: 1, org: 0 });
  k2.bericht({ t: 'modi', m });
  k2.bericht({ t: 'slag', v: 0, a: [0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const xk = [];
  draai(k2, 2.0, { opvang: xk });
  const fk = toonhoogte(Float64Array.from(xk.slice(9600)), 110);
  ok(`kern klinkt op A2 +43 ct (gemeten ${cent(fk, 110).toFixed(1)} ct)`, Math.abs(cent(fk, 110) - 43) <= 2);

  // Nieuwe stemming terwijl hij klinkt: de toon schuift mee, geen klik (geen reset).
  const k3 = new SchaalKern(FS);
  k3.bericht({ t: 'opt', fric: 1, org: 0 });
  k3.bericht({ t: 'modi', m: bouwModi({ kernHz: 146.83, veldHz: stemming({ k: 14 }).velden.map((v) => v.hz) }) });
  k3.bericht({ t: 'slag', v: 4, a: [0.5, 0, 0, 0] });
  draai(k3, 0.2);
  k3.bericht({ t: 'modi', m: bouwModi({ kernHz: 164.81, veldHz: stemming({ k: 16 }).velden.map((v) => v.hz) }) });
  const x3 = [];
  draai(k3, 1.0, { opvang: x3 });
  const f3 = toonhoogte(Float64Array.from(x3.slice(2400)), 329.63);
  ok(`omstemmen tijdens de klank: D4 wordt E4 (gemeten ${cent(f3, 329.63).toFixed(1)} ct van E4)`, Math.abs(cent(f3, 329.63)) <= 2);

  // Uitklinken en slapen.
  const k4 = new SchaalKern(FS);
  k4.bericht({ t: 'modi', m });
  k4.bericht(slag(3, 0.5));
  draai(k4, 20);
  ok('na uitklinken slaapt hij weer (20 s na één tik)', k4.slaapt);
  const na = draai(k4, 0.1);
  ok('... en is het echt stil', na.piek === 0);

  // Dempen.
  const k5 = new SchaalKern(FS);
  k5.bericht({ t: 'modi', m });
  k5.bericht(slag(0, 0.3));
  draai(k5, 0.2);
  k5.bericht({ t: 'demp', v: -1, aan: true });
  draai(k5, 0.3);
  const gedempt = draai(k5, 0.1);
  ok('dempen: binnen 0,3 s onder −60 dB', gedempt.piek < 1e-3);
  k5.bericht({ t: 'demp', v: -1, aan: false });

  // Wrijven: de schaal gaat zingen, en houdt op als je loslaat.
  const k6 = new SchaalKern(FS);
  k6.bericht({ t: 'modi', m });
  k6.bericht({ t: 'wrijf', p: 0.55, r: 1.1 });
  draai(k6, 3);
  const zingt = draai(k6, 1);
  ok(`wrijven: na 3 s zingt hij (rms ${zingt.rms.toFixed(3)})`, zingt.rms > 0.01 && zingt.eindig && zingt.piek <= 1);
  k6.bericht({ t: 'wrijf', p: 0, r: 0 });
  draai(k6, 60);
  ok('loslaten: hij klinkt uit en slaapt weer', k6.slaapt);

  // Rekentijd: een blok van 128 frames (2,67 ms aan audio) met alles aan.
  const k7 = new SchaalKern(FS);
  k7.bericht({ t: 'modi', m });
  k7.bericht({ t: 'wrijf', p: 0.55, r: 1.1 });
  for (let v = 0; v <= 9; v++) k7.bericht(slag(v, 0.3));
  draai(k7, 1);
  const t0 = performance.now();
  draai(k7, 5);
  const msBlok = (performance.now() - t0) / ((5 * FS) / BLOK);
  ok(`rekentijd per blok ${msBlok.toFixed(3)} ms (< 0,5 ms van 2,67)`, msBlok < 0.5);

  // Afval: net als renderblok.test, na opwarmen, beste van drie.
  const L = new Float32Array(BLOK), R = new Float32Array(BLOK);
  const venster = () => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const h0 = process.memoryUsage().heapUsed;
    for (let b = 0; b < 3000; b++) k7.render(L, R, BLOK);
    const h1 = process.memoryUsage().heapUsed;
    return { bytes: h1 - h0, gcs: prof.stop().statistics.length };
  };
  let beste = null;
  for (let i = 0; i < 3; i++) { const w = venster(); if (!beste || w.gcs < beste.gcs || (w.gcs === beste.gcs && w.bytes < beste.bytes)) beste = w; }
  ok(`geen afval: 3000 blokken, ${beste.gcs} GC, ${beste.bytes} bytes heapgroei`, beste.gcs === 0 && beste.bytes < 64 * 1024);
}

// ---- 3. de klasse, met een nep-context en een nep-worklet ------------------------
console.log('\nKlankschaal (nep-worklet)');
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, exponentialRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, delayTime: param(0), curve: null, oversample: 'none',
  connect(n) { (this._naar ||= []).push(n); return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); }, getFloatTimeDomainData(b) { b.fill(0); },
});
let MODULES = 0;
const BERICHTEN = [];
globalThis.AudioWorkletNode = class {
  constructor(ctx, naam, opties) { this.naam = naam; this.opties = opties; this.port = { postMessage: (m) => BERICHTEN.push(m), onmessage: null }; }
  connect(n) { this._naar = n; } disconnect() {}
};
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); this.audioWorklet = { addModule: async () => { MODULES++; } }; }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('biquad'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { return node('delay'); }
  createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); }
  createChannelSplitter() { return node('splitter'); }
  createConvolver() { return node('conv'); }
  createStereoPanner() { const n = node('pan'); n.pan = param(0); return n; }
  createConstantSource() { const n = node('const'); n.offset = param(0); n.start = () => {}; n.stop = () => {}; return n; }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.start = () => {}; s.stop = () => {}; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
{
  const ctx = new AudioContext();
  const master = node('master'), busA = node('busA'), busB = node('busB');
  let volgt = { nr: 2, toonsoort: { k: 21, cent: 43, soort: 'zeker' } };
  const ks = new Klankschaal(ctx, master, { sends: { A: busA, B: busB }, toon: () => volgt });
  ok('zonder gebruik geen worklet geladen', MODULES === 0 && ks.node === null);
  ok('volume en sends aangesloten', ks.vol._naar.includes(master) && ks.sendGain.B._naar.includes(busB) && ks.sendGain.B.gain.value === 0.35);

  const b = ks.bron();
  ok('volgt de maat: A mineur +43 ct van track 2', b.k === 21 && b.cent === 43 && b.nr === 2 && !b.geen);
  volgt = { nr: 2, toonsoort: { k: null, cent: 0 } };
  const terug = ks.bron();
  ok('track zonder toonsoort: de laatste toon blijft staan (geen sprong naar D)', terug.k === 21 && terug.cent === 43 && terug.geen);
  volgt = { nr: 3, toonsoort: { k: 7, cent: -12, soort: 'onzeker' } };
  ok('stand: onzeker wordt doorgegeven', ks.stand().onzeker === true && ks.stand().toon === 'G');

  await ks.slaVeld(3);
  ok('eerste aanslag laadt de worklet (één keer)', MODULES === 1 && ks.node?.naam === 'varve-klankschaal');
  ok('... opt, dan modi, dan de slag', BERICHTEN[0].t === 'opt' && BERICHTEN[1].t === 'modi' && BERICHTEN.some((m) => m.t === 'slag' && m.v === 4));
  ok('... op de toon van de plaat (G majeur −12 ct: kern G3, veld 4 = G4)', Math.abs(cent(BERICHTEN[1].m.find((o) => o.v === 4).f, 440 * Math.pow(2, -2 / 12)) + 12) < 1e-6);
  ok('veld 4 licht op (audioklok)', ks.klinkt(4) && !ks.klinkt(5));
  NOW += 0.3;
  ok('... en na 0,3 s niet meer', !ks.klinkt(4));

  BERICHTEN.length = 0;
  volgt = { nr: 3, toonsoort: { k: 7, cent: -11.8 } };
  ks.bijwerken();
  ok('0,2 cent verschil: geen nieuwe modi (de pitchfader bestookt de worklet niet)', !BERICHTEN.some((m) => m.t === 'modi'));
  volgt = { nr: 3, toonsoort: { k: 7, cent: -8 } };
  ks.bijwerken();
  ok('4 cent verschil: wel', BERICHTEN.filter((m) => m.t === 'modi').length === 1);

  ks.zetVolg('hand');
  ok('naar hand: houdt de toon die hij volgde', ks.volg === 'hand' && ks.hand === 7);
  volgt = { nr: 3, toonsoort: { k: 0, cent: 0 } };
  ok('... en volgt de track dan niet meer', ks.bron().k === 7);
  ks.zetToon(16);
  ok('zetToon: E mineur met de hand', ks.bron().k === 16 && ks.huidig().kernNaam === 'E3');
  ks.transponeer(3); ks.transponeer(20);
  ok('transponeren tot ±12', ks.transpositie === 12);
  ks.setFijn(0.6);
  ok('fijn 0,6 → +10 cent', Math.abs(ks.fijn - 10) < 1e-9);
  ks.herstelToon();
  ok('herstel: 0 en 0', ks.transpositie === 0 && ks.fijn === 0);

  BERICHTEN.length = 0;
  await ks.wrijf(true);
  ok('wrijven: een wrijf-bericht met druk', BERICHTEN.some((m) => m.t === 'wrijf' && m.p > 0) && ks.wrijft);
  await ks.wrijf(false);
  ok('loslaten: druk 0', BERICHTEN.at(-1).t === 'wrijf' && BERICHTEN.at(-1).p === 0 && !ks.wrijft);
  ks.demp(true);
  ok('dempen: alles (v = −1)', BERICHTEN.at(-1).t === 'demp' && BERICHTEN.at(-1).v === -1 && BERICHTEN.at(-1).aan);
  ks.demp(false);

  ks.volgendeLadder();
  ok('toonladder: auto → Kurd', ks.ladder === 'kurd');
  ks.volgendeKlank();
  ok('klank: brons → kristal', ks.klank === 'kristal');
  const bewaard = JSON.parse(JSON.stringify(ks.instellingen()));
  const ks2 = new Klankschaal(ctx, master, { sends: { A: busA, B: busB } });
  ks2.herstel(bewaard);
  {
    MODULES = 0;
    const ks3 = new Klankschaal(new AudioContext(), master, { toon: () => null });
    ks3.ctx.audioWorklet.addModule = () => new Promise((r) => setTimeout(r, 20));   // laadt even
    BERICHTEN.length = 0;
    const p = ks3.wrijf(true);
    await ks3.wrijf(false);                                  // los vóór de worklet er is
    await p;
    ok('wrijven indrukken en loslaten terwijl de worklet laadt: hij zingt daarna niet', !ks3.wrijft && BERICHTEN.filter((m) => m.t === 'wrijf').every((m) => m.p === 0));
  }
  ok('instellingen bewaren en terugzetten', JSON.stringify(ks2.instellingen()) === JSON.stringify(bewaard));
  ks2.herstel({ volg: 'raar', ladder: 'x', klank: 7, transpositie: 99, fijn: -400, volume: 'hard' });
  ok('rommel in de opslag wordt genegeerd of geklemd', ks2.volg === 'hand' && ks2.ladder === 'kurd' && ks2.transpositie === 12 && ks2.fijn === -50);
}

// ---- 4. op de engine en de bus -----------------------------------------------------
console.log('\nengine en actions');
{
  const { Engine } = await import('../src/engine/engine.js');
  const { bindEngine, invoke, read, metaOf } = await import('../src/control/actions.js');
  const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
  const { ToonKaart } = await import('../src/engine/toonsoort.js');
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const eng = new Engine();
  bindEngine(eng);
  const ks = eng.klankschaal;
  ok('engine heeft een klankschaal, op de master en beide bussen', !!ks && ks.vol._naar.includes(eng.master.input)
    && ks.sendGain.A._naar.includes(eng.sends.A.in) && ks.sendGain.B._naar.includes(eng.sends.B.in));

  const buf = renderDemoTrack(eng.ctx, { bars: 2 });
  const a = eng.deck('A'), bD = eng.deck('B');
  a.load(buf, 'a'); bD.load(buf, 'b');
  a.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 })); bD.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  a.setToonKaart(ToonKaart.metHand(21, 43));            // A mineur, 43 cent hoog
  bD.setToonKaart(ToonKaart.metHand(7));                 // G majeur
  a.play();
  ok('volgt de maat: track 1, A mineur +43', ks.bron().nr === 1 && ks.bron().k === 21 && Math.abs(ks.bron().cent - 43) < 1e-9);
  a.setRate(Math.pow(2, 1 / 12));                        // een halve toon sneller, zonder keylock
  ok('pitch telt mee: +1 halve toon → B♭ mineur +43', ks.bron().k === 22 && Math.abs(ks.bron().cent - 43) < 1e-6);
  a.setRate(1);

  ok('acties bestaan, met een label', ['klankschaal.kern', 'klankschaal.veld.1', 'klankschaal.veld.8', 'klankschaal.wrijf', 'klankschaal.volg',
    'klankschaal.toon', 'klankschaal.fijn', 'klankschaal.toonladder', 'klankschaal.klank', 'klankschaal.volume', 'klankschaal.send.b']
    .every((id) => metaOf(id)?.label));
  invoke('klankschaal.volg', true);
  eng.setFocus('B');
  ok('volg → focus: track 2, G majeur', ks.volg === 'focus' && ks.bron().nr === 2 && ks.bron().k === 7);
  ok('read volg = 0,5 (maat 0, focus 0,5, hand 1)', read('klankschaal.volg') === 0.5);
  invoke('klankschaal.toon', WIJZER.indexOf(16) / 23);
  ok('toon als value: E mineur met de hand', ks.volg === 'hand' && ks.bron().k === 16 && Math.abs(read('klankschaal.toon') - WIJZER.indexOf(16) / 23) < 1e-9);
  invoke('klankschaal.transpose.up', true); invoke('klankschaal.transpose.up', true);
  ok('twee keer omhoog: F♯ mineur', ks.huidig().k === 18);
  invoke('klankschaal.transpose.reset', true);
  invoke('klankschaal.fijn', 0.25);
  ok('fijn als bipolaire value: −25 ct, read terug', Math.abs(ks.fijn + 25) < 1e-9 && Math.abs(read('klankschaal.fijn') - 0.25) < 1e-9);
  invoke('klankschaal.volume', 0.5);
  ok('volume als value', ks.volume === 0.5 && read('klankschaal.volume') === 0.5);
  BERICHTEN.length = 0;
  invoke('klankschaal.veld.8', true);
  await new Promise((r) => setTimeout(r, 0));
  ok('veld 8 via de bus: worklet geladen en aangeslagen', !!ks.node && BERICHTEN.some((m) => m.t === 'slag' && m.v === 8));
  ok('read veld 8 = 1 zolang hij oplicht', read('klankschaal.veld.8') === 1);
  invoke('klankschaal.volg', true);                       // hand → maat
  BERICHTEN.length = 0;
  a.setRate(Math.pow(2, 2 / 12));                         // de maatgever twee halve tonen hoger
  ok('een deck dat verandert stemt de schaal mee, zonder aanslag (wrijven met de rij dicht)',
    ks.volg === 'maat' && BERICHTEN.some((m) => m.t === 'modi') && ks.huidig().k === 23);
  a.setRate(1);
  // De bus gooit niet als de engine geen klankschaal heeft (feedback.test gebruikt zo'n dubbel).
  ok('elke tonen-naam van de velden is gespeld zoals de rest van Varve', ks.stand().velden.every((n) => SPELLING.includes(n.replace(/-?\d+$/, ''))));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
