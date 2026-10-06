// Secties op de Maschine (spoor sec-maschine): wat de engine en de bus daarvoor
// moeten kloppen, los van de Maschine zelf (die: test/maschine.test.mjs).
//   1. deck.sectieHier vlak na het rondgaan van een loop: geen flits van de
//      vorige sectie (scherm van de Maschine, lampjes van Maschine en APC).
//   2. de melding bij een pad zonder sectie noemt de SECTIE, niet de pad
//      (op de Maschine is blad 2 pad 5 = sectie 21).
// Nep-Web Audio zoals test/secties.test.mjs, met een uitgangsvertraging.
// Draai met: node test/sec-maschine.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {}, getByteTimeDomainData(b) { b.fill(128); } });
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.outputLatency = 0.03; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('biquad'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { const n = node('delay'); n.delayTime = param(0); return n; }
  createWaveShaper() { const n = node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createChannelMerger() { return node('merger'); }
  createChannelSplitter() { return node('splitter'); }
  createStereoPanner() { const n = node('pan'); n.pan = param(0); return n; }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    s.start = () => {}; s.stop = () => {}; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
const { Engine } = await import('../src/engine/engine.js');
const { uitgangsVertraging, hoorbaar } = await import('../src/engine/hoorbaar.js');
const { bindEngine, invoke, read } = await import('../src/control/actions.js');

// Vijf secties op 120 bpm (maat = 2 s): 0, 16, 32, 48, 56.
const KAART = { versie: 1, opGrid: true, grid: null, bron: 'auto', slot: false, stukken: [
  { van: 0, label: 'intro', groep: 'A', energie: 0.2 }, { van: 16, label: 'drop', groep: 'B', energie: 1 },
  { van: 32, label: 'break', groep: 'C', energie: 0.3 }, { van: 48, label: 'drop', groep: 'B', energie: 1 }, { van: 56, label: 'deel', groep: 'D', energie: 0.6 }] };
const eng = new Engine();
bindEngine(eng);
const meldingen = [];
eng.on('melding', (m) => meldingen.push(m.tekst));
const d = eng.deck('A');
d.load(eng.ctx.createBuffer(2, 48000 * 60, 48000), 'zestig');
d.setGrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true });
d.setSectieKaart(KAART);
const V = uitgangsVertraging(eng.ctx);

// ---- 1. sectieHier na het rondgaan van een loop ----------------------------------------
console.log(`sectieHier na het rondgaan van een loop (uitgangsvertraging ${(V * 1000).toFixed(0)} ms)`);
{
  d.seek(20); d.play();
  invoke('track.1.section.2.loop', true);              // speelt er al in: de loop komt om sectie 2 (16–32)
  invoke('track.1.section.2.loop', false);
  ok('sectie 2 is de loop (16–32), de speelkop blijft staan', d.loop?.start === 16 && d.loop?.end === 32 && Math.abs(d.position - 20) < 1e-6);
  const t0 = NOW;
  const meet = [];
  for (const na of [0.001, 0.005, 0.01, 0.02, 0.03, V - 0.001]) {
    NOW = t0 + 12 + na;                                  // 32 + na tracktijd: na seconden NA het rondgaan
    meet.push({ na, pos: d.position, hoor: hoorbaar(d, V), hier: d.sectieHier, pad1: read('track.1.section.1'), pad2: read('track.1.section.2') });
  }
  ok(`de speelkop ging rond (positie ${meet.map((m) => m.pos.toFixed(3)).join(', ')}), en wat je hoort valt dan vóór het loopbegin (${meet.map((m) => m.hoor.toFixed(3)).join(', ')})`,
    meet.every((m) => m.pos >= 16 && m.pos < 16 + V && m.hoor < 16));
  ok(`… toch hoor je nog sectie 2 (het einde van de loop): sectieHier ${meet.map((m) => m.hier).join(', ')}`, meet.every((m) => m.hier === 1));
  ok('… en de lampjes (de read) flitsen niet naar sectie 1: pad 2 blijft wit, pad 1 donker', meet.every((m) => m.pad2 === 1 && m.pad1 === 0.5));
  NOW = t0 + 12 + V + 0.002;
  ok('na de vertraging hoor je het begin van de loop: nog steeds sectie 2', d.sectieHier === 1);
  NOW = t0 + 11.99;
  ok('vlak vóór het rondgaan: het einde van de loop, sectie 2', d.sectieHier === 1 && d.position > 31.9);
  invoke('track.1.section.2.loop', true);              // loop eraf
  invoke('track.1.section.2.loop', false);
  ok('loop eraf', !d.loop);
  // Zonder loop: over een grens heen hoor je de vorige sectie nog een vertraging lang (dat klopt).
  d.seek(31.99);
  const t1 = NOW;
  NOW = t1 + 0.02;                                     // positie 32,01, je hoort 31,975
  ok('zonder loop, net over de grens naar sectie 3: je hoort nog sectie 2 (niets teruggevouwen)', d.position > 32 && d.sectieHier === 1);
  NOW = t1 + 0.02 + V;
  ok('… een vertraging later sectie 3', d.sectieHier === 2);
  d.togglePlay();
}

// ---- 2. de melding van een pad zonder sectie --------------------------------------------
console.log('\nde melding bij een sectie die er niet is');
{
  meldingen.length = 0;
  invoke('track.1.section.21', true);
  invoke('track.1.section.21', false);
  const m = meldingen.at(-1) ?? '';
  ok(`track.1.section.21 bij 5 secties: "${m}" noemt de sectie (op de Maschine is dat blad 2 pad 5)`,
    m === 'track 1 heeft 5 secties; sectie 21 is er niet.');
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
