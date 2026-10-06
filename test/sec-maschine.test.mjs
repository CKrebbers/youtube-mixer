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

// ---- 3. sectieOpDeMaat in een loop ------------------------------------------------------
// De sectie op de volgende "1": ligt die "1" op of voorbij het loopeinde, dan is de speelkop
// daar al rondgegaan. Gevonden in de review (7 okt): in de laatste maat van een loop om sectie 2
// gaf hij sectie 3, dus sloeg volgende sectie 3 over (APC, toetsenbord, Maschine) en zei de
// Maschine "op de 1: 3 …" terwijl de loop teruggaat naar 2.
console.log('\nsectieOpDeMaat in een loop');
{
  const { Maschine } = await import('../src/control/maschine.js');
  const ms = new Maschine({ engine: eng, noten: null, read, invoke, nu: () => NOW * 1000 });
  ms.zetModus('secties');
  const druk = (id) => { invoke(id, true); invoke(id, false); };
  /** Speelt, zonder loop, vanaf `pos`; dan sectie 2 (16–32) als loop: de speelkop blijft staan. */
  const loopOm2 = (pos) => {
    if (d.loop) d.clearLoop();
    d.seek(pos);
    if (!d.playing) d.play();
    druk('track.1.section.2.loop');
    return d.loop?.start === 16 && d.loop?.end === 32 && Math.abs(d.position - pos) < 1e-6;
  };
  ok('loop om sectie 2, de speelkop op 30,5 (tel 2¼ van de laatste maat)', loopOm2(30.5));
  ok(`… de sectie op de volgende "1" is sectie 2 (de loop gaat terug), niet 3: ${d.sectieOpDeMaat + 1}`, d.sectieOpDeMaat === 1 && d.sectieHier === 1);
  const st = ms.stand().secties ?? {};
  ok(`… de Maschine: je hoort "2 drop B", en geen "op de 1: 3 …" (naar ${JSON.stringify(st.naar)})`, st.hoort === '2 drop B' && st.naar === null);
  druk('track.1.section.next');
  ok(`volgende daar: sectie 3 (niet 4): op de maat ${d.sectieOpDeMaat + 1}, loop eraf`, d.sectieOpDeMaat === 2 && !d.loop);
  NOW += 1.5 + V + 0.01;
  ok(`… na de "1" speel en hoor je sectie 3 (positie ${d.position.toFixed(2)})`, d.position >= 32 && d.position < 34 && d.sectieHier === 2);
  ok('weer de loop om sectie 2, op 30,5 (de sprong van daarnet, ook vanaf 30,5, telt in de nieuwe loop niet meer)', loopOm2(30.5));
  druk('track.1.section.prev');
  ok(`vorige daar: sectie 1 (niet 2): op de maat ${d.sectieOpDeMaat + 1}`, d.sectieOpDeMaat === 0);
  NOW += 1.5 + V + 0.01;
  ok(`… daarna hoor je sectie 1 (positie ${d.position.toFixed(2)})`, d.position < 16 && d.sectieHier === 0);

  // Een beatloop van 2 tellen, de laatste twee van sectie 2 (31–32): hij komt nooit bij 32.
  d.clearLoop(); d.seek(31); d.setBeatLoop(2);
  const bl = d.loop;
  NOW += 0.5;
  ok(`beatloop 2 tellen (${bl?.start}–${bl?.end}) aan het eind van sectie 2, speelkop ${d.position.toFixed(2)}: op de "1" nog steeds sectie 2 (de loop haalt 32 nooit)`,
    bl?.start === 31 && bl?.end === 32 && d.sectieOpDeMaat === 1 && (ms.stand().secties?.naar ?? null) === null);
  // Dezelfde beatloop midden in sectie 2: daar was het al goed, en dat blijft zo.
  d.clearLoop(); d.seek(21); d.setBeatLoop(2);
  NOW += 0.5;
  ok(`beatloop 2 tellen midden in sectie 2 (${d.loop?.start}–${d.loop?.end}): sectie 2 op de "1"`, d.loop?.start === 21 && d.sectieOpDeMaat === 1);
  // Een loop die niet op een sectiegrens begint: 4 maten 28–36, over de grens 2 -> 3 (32) heen.
  d.clearLoop(); d.seek(28); d.setBeatLoop(16);
  const lg = d.loop;
  NOW += 2.5;                                          // 30,5: de volgende "1" (32) ligt nog in de loop
  ok(`loop 28–36 over een sectiegrens, op 30,5: op de "1" (32) sectie 3, zoals altijd (${d.sectieOpDeMaat + 1})`, lg?.start === 28 && lg?.end === 36 && d.sectieOpDeMaat === 2);
  NOW += 4.5;                                          // 35: de volgende "1" is het loopeinde: terug naar 28, sectie 2
  ok(`… op 35 (je hoort sectie 3, de loop gaat terug naar 28): op de "1" sectie 2 (${d.sectieOpDeMaat + 1})`,
    Math.abs(d.position - 35) < 1e-6 && d.sectieHier === 2 && d.sectieOpDeMaat === 1);
  d.clearLoop();
  d.togglePlay();
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
