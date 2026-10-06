// Minimale Web Audio-mock om de engine-logica te testen zonder browser.
let NOW = 0;
const LIVE = new Set();   // bronnen die nu geluid maken
// Net zo streng als Chrome: automatisering die overlapt met een lopende
// setValueCurveAtTime gooit een NotSupportedError. De oude mock slikte dat,
// en verborg zo precies de fout die live je hele aanroepketen meenam.
const overlapFout = () => Object.assign(new Error('NotSupportedError: overlapt met een lopende setValueCurveAtTime'), { name: 'NotSupportedError' });
let OVERLAP_FOUTEN = 0;
// En net zo slordig als Chrome (gemeten op 153, offline én realtime):
// cancelAndHoldAtTime MIDDEN in een lopende setValueCurveAtTime houdt niet
// vast, maar speelt het afgekapte stuk opnieuw af vanaf het begin van de
// curve — een sprong. Chrome gooit niet, dus de mock ook niet; hij telt het.
let CURVE_BREUK = 0;
const param = (v=0) => ({ value:v, _curves:[],
  _check(t){ const tt = t ?? NOW; for (const c of this._curves) if (tt >= c.a && tt < c.b) { OVERLAP_FOUTEN++; throw overlapFout(); } },
  setTargetAtTime(x,t){ this._check(t); this.value=x; },
  setValueAtTime(x,t){ this._check(t); this.value=x; },
  linearRampToValueAtTime(x,t){ this._check(t); this.value=x; },
  setValueCurveAtTime(c,t=NOW,d=0){
    for (const k of this._curves) if (t < k.b && t + d > k.a) { OVERLAP_FOUTEN++; throw overlapFout(); }
    this._curves.push({ a:t, b:t+d }); this.value = c[c.length-1];
  },
  // Volgens de spec: alleen wat op of na t BEGINT verdwijnt. Een curve die al
  // loopt blijft staan — daarom bestaat cancelAndHoldAtTime.
  cancelScheduledValues(t=NOW){ this._curves = this._curves.filter((c) => c.a < t); },
  cancelAndHoldAtTime(t=NOW){
    if (this._curves.some((c) => c.a < t && t < c.b)) CURVE_BREUK++;
    this._curves = this._curves.filter((c) => c.a < t).map((c) => ({ a:c.a, b:Math.min(c.b, t) }));
  },
});
const node = (type) => ({
  type, gain:param(1), frequency:param(1000), Q:param(1), detune:param(0),
  threshold:param(0), knee:param(0), ratio:param(1), attack:param(0), release:param(0),
  fftSize:1024, smoothingTimeConstant:0,
  connect(n){ return n; }, disconnect(){},
  getByteTimeDomainData(b){ b.fill(128); },
});
globalThis.AudioContext = class {
  constructor(){ this.sampleRate=48000; this.state='running'; this.baseLatency=0.005; this.destination=node('dest'); }
  get currentTime(){ return NOW; }
  createGain(){ return node('gain'); }
  createBiquadFilter(){ return node('biquad'); }
  createDynamicsCompressor(){ return node('comp'); }
  createAnalyser(){ return node('analyser'); }
  createDelay(){ const n = node('delay'); n.delayTime = param(0); return n; }
  createWaveShaper(){ const n = node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createChannelMerger(){ return node('merger'); }
  // De effecten uit de filter app (fx-meer.js) lopen ook langs in 'volgend effect'.
  createChannelSplitter(){ return node('splitter'); }
  createStereoPanner(){ const n = node('pan'); n.pan = param(0); return n; }
  createOscillator(){ const n = node('osc'); n.type='sine'; n.start=()=>{}; n.stop=()=>{}; return n; }
  createBufferSource(){ const s = node('src'); s.playbackRate=param(1); s.loop=false; s.loopStart=0; s.loopEnd=0;
    // De echte API vuurt onended ASYNCHROON na stop(), en houdt een bron in
    // leven tot dat gebeurt. De oude mock deed geen van beide en hield daarmee
    // een bug uit fase 1 uit het zicht: een afgedankte bron die 'einde track'
    // meldde terwijl zijn opvolger al speelde.
    // Onthoudt wanneer en waarvandaan: starten op de maat plant een bron in de toekomst.
    s.start=(wanneer=0, vanaf=0)=>{ s._wanneer=wanneer; s._vanaf=vanaf; LIVE.add(s); };
    s.stop=()=>{ if(!LIVE.has(s)) return; LIVE.delete(s); queueMicrotask(()=>s.onended?.()); };
    return s; }
  createBuffer(ch,len,sr){ const d=[...Array(ch)].map(()=>new Float32Array(len));
    return { numberOfChannels:ch, length:len, sampleRate:sr, duration:len/sr, getChannelData:(i)=>d[i] }; }
  resume(){ return Promise.resolve(); }
};

/**
 * AudioWorkletNode zoals de echte (de streamende bron): numberOfOutputs
 * (standaard 1), outputChannelCount even lang (anders IndexSizeError), en
 * connect(doel, uitgang) gooit IndexSizeError bij een uitgang die er niet
 * is. Wat hij verbindt staat in `verbindingen`, wat hij stuurt in `port.berichten`.
 */
const indexFout = (w) => Object.assign(new Error(`IndexSizeError: ${w}`), { name: 'IndexSizeError' });
const nepWorkletNode = (nodes = []) => class {
  constructor(_ctx, naam, opties = {}) {
    this.naam = naam;
    this.numberOfInputs = opties.numberOfInputs ?? 1;
    this.numberOfOutputs = opties.numberOfOutputs ?? 1;
    if (opties.outputChannelCount && opties.outputChannelCount.length !== this.numberOfOutputs) throw indexFout('outputChannelCount past niet bij numberOfOutputs');
    this.outputChannelCount = opties.outputChannelCount ?? Array(this.numberOfOutputs).fill(1);
    this.verbindingen = [];
    const berichten = [];
    this.port = { berichten, postMessage: (m) => berichten.push(m), onmessage: null };
    nodes.push(this);
  }
  connect(doel, uitgang = 0) {
    if (!(Number.isInteger(uitgang) && uitgang >= 0 && uitgang < this.numberOfOutputs)) throw indexFout(`uitgang ${uitgang} bestaat niet`);
    this.verbindingen.push({ doel, uitgang });
    return doel;
  }
  disconnect() { this.verbindingen = []; }
};

const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, invoke, list, read } = await import('../src/control/actions.js');
const { computePeaks } = await import('../src/analysis/peaks.js');
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const { xfaderGains } = await import('../src/engine/audio-graph.js');

const eng = new Engine();
bindEngine(eng);
const fails = [];
const ok = (name, cond) => { if(!cond) fails.push(name); console.log((cond?'  ok  ':'FAIL  ')+name); };

ok('actions geregistreerd (>60)', list().length > 60);

const buf = renderDemoTrack(eng.ctx, { bars: 2 });
ok('demotrack duurt ~3.87s', Math.abs(buf.duration - 8*60/124) < 0.01);
const an = computePeaks(buf);
ok('peaks berekend', an.count > 100 && an.peaks.length === an.count*2);
ok('demotrack heeft signaal', Math.max(...buf.getChannelData(0).slice(0,5000)) > 0.2);

eng.deck('A').load(buf, 'demo');
invoke('track.1.play', true);
ok('deck A speelt', eng.deck('A').playing);

NOW += 1.0;
ok('positie volgt de klok (1.0s)', Math.abs(eng.deck('A').position - 1.0) < 0.001);

eng.deck('A').setRate(2);
NOW += 1.0;
ok('positie schaalt met playbackRate (3.0s)', Math.abs(eng.deck('A').position - 3.0) < 0.001);

eng.deck('A').setRate(1);
invoke('track.1.hotcue.1', true);
ok('hotcue 1 gezet op 3.0s', Math.abs(eng.deck('A').hotcues[0] - 3.0) < 0.001);

eng.deck('A').seek(0.5);
invoke('track.1.hotcue.1', true);
ok('hotcue 1 springt terug naar 3.0s', Math.abs(eng.deck('A').position - 3.0) < 0.001);

invoke('track.1.loop.1', true);
NOW += 2.5;
const p = eng.deck('A').position;
ok('loop wrapt binnen [3.0,3.87)', p >= 3.0 && p < 3.87);
const lenBefore = eng.deck('A').loop.end - eng.deck('A').loop.start;
ok('loop geklemd op trackeinde', Math.abs(lenBefore - (buf.duration - 3.0)) < 1e-6);
invoke('track.1.loop.halve', true);
ok('loop gehalveerd', Math.abs((eng.deck('A').loop.end - eng.deck('A').loop.start) - lenBefore/2) < 1e-6);
invoke('track.1.loop.double', true);
ok('loop verdubbeld terug', Math.abs((eng.deck('A').loop.end - eng.deck('A').loop.start) - lenBefore) < 1e-6);
invoke('track.1.loop.exit', true);
ok('loop weg', eng.deck('A').loop === null);

invoke('track.1.play', true);
ok('play toggelt naar pauze', !eng.deck('A').playing);

const g = xfaderGains(0.5);
ok('xfader equal-power in midden (~0.707)', Math.abs(g.a-0.7071)<0.001 && Math.abs(g.b-0.7071)<0.001);
ok('xfader links = A vol open', xfaderGains(0).a === 1 && Math.abs(xfaderGains(0).b) < 1e-9);

invoke('track.1.low', 0);
ok('EQ kill onder 3%', eng.deck('A').chain.eqLow.gain.value === -70);
invoke('track.1.low', 0.5);
ok('EQ midden = 0 dB', Math.abs(eng.deck('A').chain.eqLow.gain.value) < 1e-9);

invoke('track.1.filter', 0);
ok('filter links = LPF laag', eng.deck('A').chain.lpf.frequency.value < 300);
invoke('track.1.filter', 1);
ok('filter rechts = HPF hoog', eng.deck('A').chain.hpf.frequency.value > 8000);
invoke('track.1.filter', 0.5);
ok('filter midden = bypass', eng.deck('A').chain.lpf.frequency.value > 20000 && eng.deck('A').chain.hpf.frequency.value < 25);

invoke('track.1.pitch', 1);
ok('pitch standaard ±16%: fader rechts = +16%', Math.abs(eng.deck('A').rate - 1.16) < 1e-9);
invoke('track.1.pitch.range', true);            // 16 -> 50
ok('bereik wisselen laat het tempo staan', Math.abs(eng.deck('A').rate - 1.16) < 1e-9 && eng.deck('A').pitchBereik === 0.5);
ok('... en verschuift alleen de faderstand', Math.abs(read('track.1.pitch') - 0.66) < 1e-9);
invoke('track.1.pitch.range', true);            // 50 -> 8
ok('op ±8% staat +16% tegen de aanslag (read geklemd)', eng.deck('A').pitchBereik === 0.08 && read('track.1.pitch') === 1);
invoke('track.1.pitch', 0);
ok('±8%: fader links = -8%', Math.abs(eng.deck('A').rate - 0.92) < 1e-9);
invoke('track.1.pitch.range', true);            // 8 -> 16, terug naar standaard
invoke('track.1.pitch', 0.5);
ok('fader midden = 0%', eng.deck('A').rate === 1);
invoke('track.1.pitch', 1);
{
  // Bend (nudge op de APC): zolang je drukt 4% sneller/trager, rate blijft.
  const dB = eng.deck('A');
  dB.setRate(1.02);
  invoke('track.1.bend.fwd', true);
  ok('bend +: de bron loopt 4% sneller, de rate (pitch, bpm) blijft', Math.abs(dB.bron.rate - 1.02 * 1.04) < 1e-9 && dB.rate === 1.02);
  dB.setRate(1.0);
  ok('pitch verzetten tijdens een bend: bend blijft erop', Math.abs(dB.bron.rate - 1.04) < 1e-9);
  invoke('track.1.bend.fwd', false);
  ok('loslaten: precies terug', dB.bron.rate === 1 && dB.buigt === 0);
  invoke('track.1.bend.back', true);
  ok('bend −: 4% trager', Math.abs(dB.bron.rate - 0.96) < 1e-9 && read('track.1.bend.back') === 1);
  invoke('track.1.bend.back', false);
}
{
  // Nieuw nummer: pitch terug op 0, bereik blijft.
  const dP = eng.deck('A');
  dP.pitchBereik = 0.5;
  dP.load(buf, 'volgend nummer');
  ok('nieuw nummer begint op 0% pitch', dP.rate === 1 && dP.bron.rate === 1 && read('track.1.pitch') === 0.5);
  ok('... het bereik blijft staan', dP.pitchBereik === 0.5);
  dP.pitchBereik = 0.16;
  invoke('track.1.pitch', 1);
}

const snap = eng.snapshot();
// ---- regressie: een afgedankte bron mag niets meer melden ----------------
// Symptoom was: loop uit -> deck 'stopt' in beeld maar speelt door, en de
// volgende play() legde er een tweede bron overheen.
const tik = () => Promise.resolve();

const b = eng.deck('B');
b.load(buf, 'demo');
b.seek(1); b.play();
NOW += 0.5;
b.setLoop(1);
NOW += 0.7;
const posVoorUit = b.position;
b.clearLoop();
await tik();
ok('loop uit: deck speelt door', b.playing);
ok('loop uit: positie blijft staan', Math.abs(b.position - posVoorUit) < 0.001);
ok('loop uit: geen klik (bron blijft dezelfde)', LIVE.size === 1);

b.pause();
await tik();
const posNaPauze = b.position;
ok('pauze houdt de positie vast', posNaPauze > 1 && posNaPauze < 3);
ok('pauze laat geen bron achter', LIVE.size === 0);

b.play();
await tik();
ok('play hervat waar je pauzeerde', Math.abs(b.position - posNaPauze) < 0.001);
ok('play start precies een bron', LIVE.size === 1);

b.seek(2.5);            // binnen de demotrack van 3,87 s
await tik();
ok('seek tijdens spelen speelt door', b.playing && Math.abs(b.position - 2.5) < 0.001);
ok('seek laat geen dubbele bron achter', LIVE.size === 1);

b.cuePoint = 2;
b.cue();
await tik();
ok('cue springt naar het cuepunt, niet naar het einde', Math.abs(b.position - 2) < 0.001);

NOW += 0.5;
b.play();
// De AudioBufferSourceNode zit nu achter de bron; het deck kent hem niet meer.
const bron = b.bron.source;
bron.onended?.();          // echt trackeinde, zoals de browser hem stuurt
ok('echt trackeinde stopt het deck wel', !b.playing && Math.abs(b.position - b.duration) < 0.001);
b.stop();

// ---- beatgrid en beat-loops ----------------------------------------------
// Een loop die een fractie naast de tel begint hoor je meteen; het inklikken
// op het grid is het hele punt van een beat-loop.

const { Beatgrid } = await import('../src/engine/beatgrid.js');
const dA = eng.deck('A');
dA.stop();
dA.load(buf, 'demo');
dA.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0.1 }));   // beat elke 0,5 s
ok('grid hangt aan het deck', dA.grid.bpm === 120);
ok('hoorbare bpm volgt de rate', (dA.setRate(1.1), Math.abs(dA.bpm - 132) < 1e-6));
dA.setRate(1);

dA.seek(1.12);                      // dichtstbijzijnde beat ligt op 1.10
ok('beat-loop klikt in op de tel', dA.setBeatLoop(4) && Math.abs(dA.loop.start - 1.1) < 1e-9);
ok('en is precies vier tellen lang', Math.abs((dA.loop.end - dA.loop.start) - 2) < 1e-9);
ok('het aantal tellen wordt onthouden', dA.loopBeats === 4);

dA.seek(1.34);                      // dichtstbij is 1.35, maar een kwarttel duurt 0,125 s
const kort = dA.setBeatLoop(0.25);
ok('een korte loop eindigt nooit vóór de speelkop', kort && dA.loop.end > dA.position - 1e-9);

dA.clearLoop();
ok('loop uit wist ook het aantal tellen', dA.loopBeats === null);

const zonder = eng.deck('B');
zonder.load(buf, 'demo');
ok('zonder grid gebeurt er niets', zonder.setBeatLoop(4) === false && zonder.loop === null);

invoke('track.1.grid.double', true);
ok('bpm verdubbelen via de bus', dA.grid.bpm === 240);
invoke('track.1.grid.halve', true);
ok('en weer halveren', dA.grid.bpm === 120);

const voorSchuif = dA.grid.firstBeat;
invoke('track.1.grid.fwd', true);
ok('grid opschuiven via de bus', Math.abs(dA.grid.firstBeat - (voorSchuif + 0.005)) < 1e-9);

dA.seek(3.3);
invoke('track.1.grid.here', true);
ok('beat 1 hier leggen', Math.abs(dA.grid.firstBeat - 3.3) < 1e-9);

invoke('track.1.grid.clear', true);
ok('grid wissen', dA.grid === null);
ok('en dan doet een beat-loop niets meer', dA.setBeatLoop(4) === false);

const snap2 = eng.snapshot();
ok('snapshot draagt het grid', snap2.decks.A.grid === null && 'bpm' in snap2.decks.A);
dA.setGrid(new Beatgrid({ bpm: 124 }));
ok('en vult het zodra er een grid is', eng.snapshot().decks.A.grid.stukken[0].bpm === 124);
dA.stop();

// ---- sync: tempo en fase --------------------------------------------------

const sA = eng.deck('A'), sB = eng.deck('B');
sA.stop(); sB.stop();
sA.load(buf, 'master'); sB.load(buf, 'slave');

ok('zonder grid weigert sync met een reden',
  (() => { const r = eng.sync('B'); return !r.ok && r.reden.includes('beatgrid'); })());

sA.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
sB.setGrid(new Beatgrid({ bpm: 128, firstBeat: 0 }));
sA.setRate(1);

let r = eng.sync('B');
ok('tempo gelijkgezet', r.ok && Math.abs(sB.rate - 120 / 128) < 1e-9);
ok('en de hoorbare bpm klopt', Math.abs(sB.bpm - 120) < 1e-6);
ok('het grid van de slave blijft ongemoeid', sB.grid.bpm === 128);
ok('zonder spelen wordt de fase nog niet gezet', r.fase === false);

// master met pitch: de slave moet dat volgen
sA.setRate(1.05);
r = eng.sync('B');
ok('sync volgt de pitch van de master', Math.abs(sB.bpm - 126) < 1e-6);
sA.setRate(1);
eng.sync('B');

// fase: beide spelend, slave bewust een stukje ernaast
sA.seek(1.0); sA.play();
sB.seek(1.0 + 0.12); sB.play();
const voorFase = Math.abs(eng.faseVerschil('B'));
r = eng.sync('B');
ok('met beide spelend wordt ook de fase gezet', r.fase === true);
ok('de fase staat daarna vrijwel gelijk', Math.abs(eng.faseVerschil('B')) < 1e-6);
ok('en dat was ervoor niet zo', voorFase > 0.01);
ok('de verschuiving blijft binnen een halve tel',
  Math.abs(r.verschoven) <= sB.grid.beatLength / 2 + 1e-9);

// een te groot tempoverschil weigert hij, met een bruikbare hint
sB.setGrid(new Beatgrid({ bpm: 40 }));
const te = eng.sync('B');
ok('te groot tempoverschil wordt geweigerd', !te.ok && te.reden.includes('x2'));
ok('en de rate blijft dan staan', sB.rate > 0.5);

// faseverschil is symmetrisch van teken
sB.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
sB.setRate(1);
sA.seek(2.0); sB.seek(2.06);
const fa = eng.faseVerschil('A'), fb = eng.faseVerschil('B');
ok('faseverschil kijkt van beide kanten', fa !== null && fb !== null && Math.abs(fa + fb) < 1e-9);

const leeg = eng.snapshot();
ok('snapshot draagt het faseverschil', 'fase' in leeg && typeof leeg.fase.A === 'number');

sA.stop(); sB.stop();
sB.setRate(1);

// ---- de bron is inwisselbaar ----------------------------------------------
// Het deck weet niet HOE er geluid uit een track komt. Dat staat in bron.js,
// zodat er straks een time-stretcher of een streamende leeslus voor in de
// plaats kan zonder dat transport, cues of loops iets merken.

const { BufferBron } = await import('../src/engine/bron.js');
const bd = eng.deck('A');
ok('het deck heeft een bron', bd.bron instanceof BufferBron);
ok('die zichzelf benoemt', bd.bron.naam === 'buffer');
ok('en weet dat hij geen keylock heeft', bd.bron.keylock === false);

ok('het deck heeft zelf geen AudioBufferSourceNode meer', bd.source === undefined);
ok('buffer loopt via de bron', bd.buffer === bd.bron.buffer);
ok('speelt loopt via de bron', bd.playing === bd.bron.speelt);
ok('duur loopt via de bron', bd.duration === bd.bron.duur);
ok('positie loopt via de bron', Math.abs(bd.position - bd.bron.positie) < 1e-9);

bd.stop();
bd.load(buf, 'bronproef');
bd.seek(1.0);
bd.play();
ok('ctxTimeOf komt van de bron', bd.ctxTimeOf(2.0) === bd.bron.ctxTimeOf(2.0));
ok('en ligt een seconde verder bij rate 1',
  Math.abs(bd.ctxTimeOf(2.0) - (eng.ctx.currentTime + 1.0)) < 1e-9);
bd.setRate(2);
ok('ctxTimeOf rekent de rate mee',
  Math.abs(bd.ctxTimeOf(bd.position + 2.0) - (eng.ctx.currentTime + 1.0)) < 1e-9);
bd.setRate(1);
bd.stop();
ok('stilstaand deck geeft geen ctx-tijd', bd.ctxTimeOf(5) === null);

// Een zelfgebouwde bron moet het deck net zo goed bedienen: dat is het bewijs
// dat de scheiding echt is en niet alleen op papier staat.
class TestBron extends BufferBron {
  get naam() { return 'test'; }
  get keylock() { return true; }
}
const eigen = new TestBron(eng.ctx, bd.chain.input);
bd.bron = eigen;
bd.bron.onEinde = () => bd.emit('change', bd);
bd.load(buf, 'eigen bron');
bd.seek(0.5); bd.play();
ok('deck speelt met een andere bron', bd.playing && bd.bron.naam === 'test');
ok('en meldt dat die keylock heeft', bd.bron.keylock === true);
NOW += 0.25;
ok('positie loopt door op de vervangen bron', Math.abs(bd.position - 0.75) < 1e-9);
bd.setBeatLoop ? null : null;
bd.stop();
bd.bron = new BufferBron(eng.ctx, bd.chain.input);
bd.bron.onEinde = () => bd.emit('change', bd);

// ---- insert-slot: klikvrij wisselen ---------------------------------------
// Het spannende aan effecten is niet het effect maar het WISSELEN. Nooit de
// bedrading veranderen waar signaal doorheen loopt; twee complete ketens
// kruisfaden en de oude pas opruimen na fade plus staarttijd.

const { InsertSlot, EFFECTEN, effectVan, FADE } = await import('../src/engine/fx.js');
const fx = eng.deck('A').fx;

ok('elk deck heeft een insert-slot', fx instanceof InsertSlot);
ok('er staat een effect in', fx.effectId === 'delay');
ok('en hij begint droog', fx.mix === 0);
ok('er zijn meerdere effecten', EFFECTEN.length >= 3);
ok('met unieke ids', new Set(EFFECTEN.map((e) => e.id)).size === EFFECTEN.length);
ok('elk met minstens één parameter', EFFECTEN.every((e) => e.params.length > 0));
ok('en een standaardwaarde per parameter',
  EFFECTEN.every((e) => e.params.every((p2) => typeof e.standaard?.[p2] === 'number')));
ok('een onbekend effect wordt geweigerd', fx.zetEffect('bestaat-niet') === false);
ok('en laat het huidige staan', fx.effectId === 'delay');

// plekken, niet parameters
ok('plek 1 heeft een naam', fx.plekNaam(1) === 'tijd');
ok('plek 4 is de maat-schakelaar, plek 5 bestaat niet', fx.plekNaam(4) === 'sync' && fx.plekNaam(5) === null);
fx.setPlek(2, 0.8);
ok('plek zetten werkt', Math.abs(fx.leesPlek(2) - 0.8) < 1e-9);
ok('buiten bereik zetten faalt netjes', fx.setPlek(9, 0.5) === false);

// wisselen
const voor = fx.keten;
ok('wisselen lukt', fx.zetEffect('filter') === true);
ok('er staat een nieuw effect', fx.effectId === 'filter');
ok('de oude keten is NIET meteen weg', fx.oud.includes(voor));
ok('er lopen dus twee ketens', fx.nodeAantal === 2);
ok('de nieuwe keten is een andere node', fx.keten !== voor);
ok('en plek 1 betekent nu iets anders', fx.plekNaam(1) === 'freq');

ok('hetzelfde effect nog eens zetten doet niets', (() => {
  const k = fx.keten; fx.zetEffect('filter'); return fx.keten === k;
})());

// staarttijden bepalen wanneer opruimen mag
const delay = effectVan('delay').bouw(eng.ctx);
delay.zet('tijd', 0.5, 0); delay.zet('feedback', 0.6, 0);
ok('een delay meldt een staarttijd', delay.staart() > 0.1);
ok('die begrensd is', delay.staart() <= 8);
ok('een filter heeft geen staart', effectVan('filter').bouw(eng.ctx).staart() === 0);

// dry/wet equal power
fx.setMix(0.5);
const n = fx._niveaus();
ok('equal power op halve mix', Math.abs(n.dry - Math.SQRT1_2) < 1e-9 && Math.abs(n.wet - Math.SQRT1_2) < 1e-9);
ok('en niet lineair opgeteld', Math.abs(n.dry + n.wet - 1) > 0.4);
fx.setMix(1);
ok('volledig nat', Math.abs(fx._niveaus().dry) < 1e-9);
fx.setBypass(true);
ok('bypass maakt hem droog', Math.abs(fx._niveaus().dry - 1) < 1e-9 && Math.abs(fx._niveaus().wet) < 1e-9);
fx.setBypass(false);
ok('bypass uit herstelt de mix', Math.abs(fx._niveaus().wet - 1) < 1e-9);
fx.setMix(0);

// via de bus
const beginEffect = fx.effectId;
const rondjeFouten = [];
const { bijFout } = await import('../src/control/actions.js');
const stopFouten = bijFout((id, err) => rondjeFouten.push(`${id}: ${err?.message}`));
invoke('track.1.fx.next', true);
ok('volgend effect via de bus', fx.effectId !== beginEffect);
const rondje = [fx.effectId];
for (let i = 1; i < EFFECTEN.length; i++) { invoke('track.1.fx.next', true); rondje.push(fx.effectId); }
stopFouten();
ok('en na een rondje sta je weer waar je begon', fx.effectId === beginEffect);
// De bus slikt een fout (hij meldt hem alleen): een effect dat bij het bouwen
// gooit, liet de slot achter met het nieuwe rack en de oude keten.
ok(`elk effect bouwt onderweg zonder fout (${EFFECTEN.length} effecten${rondjeFouten.length ? ': ' + rondjeFouten.join(' | ') : ''})`,
  rondjeFouten.length === 0 && new Set(rondje).size === EFFECTEN.length);
invoke('track.1.fx.mix', 0.3);
ok('mix via de bus', Math.abs(fx.mix - 0.3) < 1e-9);
invoke('track.1.fx.knob.1', 0.7);
ok('plek via de bus', Math.abs(fx.leesPlek(1) - 0.7) < 1e-9);
invoke('track.1.fx.bypass', true);
ok('bypass via de bus', fx.bypass === true);
invoke('track.1.fx.bypass', true);
ok('en is een schakelaar', fx.bypass === false);
fx.setMix(0);

fx.zetEffect('delay');
const snapFx = eng.snapshot().decks.A.fx;
ok('snapshot draagt de fx-staat', snapFx.effect === 'delay' && snapFx.plekken.length === 4);
ok('met de naam van elke plek', snapFx.plekken[0].naam === 'tijd');
ok('en alleen plekken die bestaan', snapFx.plekken.every((p2) => p2.naam));

// ---- tempo-gesynchroniseerde effecten -------------------------------------
// Een gate die op tempo loopt maar op de verkeerde tel begint is net zo
// waardeloos als helemaal niet synchroon. Daarom levert het deck niet alleen
// de tellengte maar ook het ANKER: wanneer de volgende tel valt op de audioklok.

const { DELINGEN, delingVan, GEEN_KLOK } = await import('../src/engine/fx.js');
const kd = eng.deck('A');
kd.stop();
kd.load(buf, 'klokproef');
kd.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));

ok('een stilstaand deck levert geen klok', kd.fxKlok() === null);
kd.seek(1.1); kd.play();
const klok = kd.fxKlok();
ok('een spelend deck levert er wel een', klok !== null);
ok('tellengte is de HOORBARE lengte', Math.abs(klok.beatLengte - 0.5) < 1e-9);
ok('het anker ligt op de eerstvolgende tel',
  Math.abs(klok.ankerCtx - kd.ctxTimeOf(1.5)) < 1e-9);
ok('en dus in de toekomst', klok.ankerCtx > eng.ctx.currentTime - 1e-9);

kd.setRate(2);
ok('bij dubbele snelheid is de tel half zo lang', Math.abs(kd.fxKlok().beatLengte - 0.25) < 1e-9);
ok('maar het grid verandert niet', kd.grid.bpm === 120);
kd.setRate(1);

kd.setGrid(null);
ok('zonder grid geen klok', kd.fxKlok() === null);
kd.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));

ok('delingen lopen van heel naar zestiende', DELINGEN[0].tellen === 4 && DELINGEN.at(-1).tellen === 0.25);
ok('een knopstand kiest een deling', delingVan(0).id === '1/1' && delingVan(1).id === '1/16');
ok('en blijft binnen de lijst', delingVan(-5).tellen === 4 && delingVan(9).tellen === 0.25);

// De gate mag zonder klok niet omvallen: dan staat hij gewoon open.
const losseGate = effectVan('gate').bouw(eng.ctx, { klok: GEEN_KLOK });
ok('een gate zonder klok bouwt gewoon', !!losseGate.in && !!losseGate.out);
losseGate.zet('deling', 0.3, 0);
ok('en laat zich instellen zonder te klagen', true);
ok('een gate heeft geen staart', losseGate.staart() === 0);

kd.fx.zetEffect('gate');
ok('gate in de slot', kd.fx.effectId === 'gate');
ok('met deling, vorm en diepte', kd.fx.plekNaam(1) === 'deling' && kd.fx.plekNaam(3) === 'diepte');
let herankerd = 0;
const echteHeranker = kd.fx.heranker.bind(kd.fx);
kd.fx.heranker = () => { herankerd++; echteHeranker(); };
kd.seek(5);
ok('seeken zet de gate opnieuw op de tel', herankerd === 1);
kd.setRate(1.05);
ok('een tempowijziging ook', herankerd === 2);
kd.setGrid(new Beatgrid({ bpm: 128 }));
ok('en het verzetten van het grid ook', herankerd === 3);
kd.fx.heranker = echteHeranker;
kd.setRate(1);
kd.stop();
kd.fx.zetEffect('delay');

// ---- editor-ondersteuning -------------------------------------------------
// Schuif je in de editor aan een bereik, dan mag er geen enkele node opnieuw
// gebouwd worden: dat zou elke tik je knoppen terugzetten en een kruisfade
// kosten. Alleen de keten zelf aanpassen bouwt opnieuw op.

const ef = eng.deck('B').fx;
ef.zetRack({
  schema: 1, name: 'editorproef',
  chain: [{ slot: 'a', type: 'filter' }, { slot: 'b', type: 'delay' }],
  macros: [
    { place: 1, label: 'Een', default: 0.2, links: [{ target: 'b.feedback', from: 0, to: 1 }] },
    { place: 2, label: 'Twee', default: 0.5, links: [{ target: 'a.freq', from: 0, to: 1 }] },
  ],
});
ef.setPlek(1, 0.8);
const ketenVoor = ef.keten;
const aantalVoor = ef.nodeAantal;     // de vorige keten kan nog uitsterven

const doelen = ef.doelen();
ok('de editor krijgt alle doelen', doelen.some((d2) => d2.target === 'b.feedback') && doelen.some((d2) => d2.target === 'a.freq'));
ok('met het effect erbij', doelen.find((d2) => d2.target === 'b.tijd').effect === 'Delay');

ef.bewerkMacros([
  { place: 1, label: 'Een (nieuw)', default: 0.2, links: [{ target: 'b.feedback', from: 0.3, to: 0.6 }] },
  { place: 3, label: 'Drie', default: 0.7, links: [{ target: 'b.toon', from: 0, to: 1 }] },
]);
ok('macro bewerken bouwt de keten NIET opnieuw', ef.keten === ketenVoor);
ok('en er komt geen keten bij', ef.nodeAantal === aantalVoor);
ok('het nieuwe label staat erin', ef.plekNaam(1) === 'Een (nieuw)');
ok('de knopstand van een blijvende plek blijft staan', Math.abs(ef.leesPlek(1) - 0.8) < 1e-9);
ok('een nieuwe plek begint op zijn default', Math.abs(ef.leesPlek(3) - 0.7) < 1e-9);
ok('een verdwenen plek is echt weg', ef.plekNaam(2) === null && ef.leesPlek(2) === null);

ef.setPlek(3, 0.4);
ef.zetRack({ ...ef.naarJSON(), chain: [...ef.naarJSON().chain, { slot: 'c', type: 'crush' }] },
  { behoudStanden: true });
ok('keten uitbreiden bouwt wel opnieuw', ef.keten !== ketenVoor);
ok('maar met behoudStanden blijven je knoppen staan',
  Math.abs(ef.leesPlek(1) - 0.8) < 1e-9 && Math.abs(ef.leesPlek(3) - 0.4) < 1e-9);
ok('en het nieuwe slot is een doel geworden', ef.doelen().some((d2) => d2.target === 'c.bits'));

ef.zetRack(ef.naarJSON());
ok('zonder behoudStanden gaan ze terug naar hun default',
  Math.abs(ef.leesPlek(1) - 0.2) < 1e-9 && Math.abs(ef.leesPlek(3) - 0.7) < 1e-9);

const kapotBewerkt = ef.bewerkMacros([{ place: 1, links: [{ target: 'z.niets', from: 0, to: 1 }] }]);
ok('een link naar een onbestaand slot wordt gemeld', kapotBewerkt.fouten.length > 0);
ok('en niet uitgevoerd', ef.rack.macros[0].links.length === 0);
ef.zetEffect('delay');

ok('snapshot compleet', snap.decks.A.loaded && snap.decks.B && typeof snap.xfader === 'number');

// ---- herkomst: bewaren mag niet over het verkeerde rack heen -------------
// "Volgend effect" verving het rack, maar bewaren schreef daarna over het
// bewaarde rack heen met dat ene losse effect. Nu weet de engine het.

console.log('\nherkomst van een rack');
{
  const hf = eng.deck('G').fx;
  hf.zetRack({ name: 'Dub', chain: [{ slot: 'a', type: 'delay', params: {} }], macros: [] }, { herkomst: 7 });
  ok('geladen uit de library: herkomst onthouden', hf.herkomst === 7);
  hf.zetRack({ name: 'Dub', chain: [{ slot: 'a', type: 'delay', params: {} }, { slot: 'b', type: 'filter', params: {} }], macros: [] },
    { behoudStanden: true });
  ok('bewerken in de editor: nog steeds hetzelfde rack', hf.herkomst === 7);
  hf.bewerkMacros([]);
  ok('macro\'s bewerken ook', hf.herkomst === 7);
  hf.hernoem('Dub lang');
  ok('hernoemen: naam anders, herkomst blijft, geen nieuwe keten', hf.rackNaam === 'Dub lang' && hf.herkomst === 7);
  hf.zetEffect('phaser');
  ok('volgend effect: herkomst weg, dus bewaren wordt een NIEUW rack', hf.herkomst === null);
  hf.zetRack({ name: 'x', chain: [], macros: [] }, { herkomst: 3 });
  hf.zetRack({ name: 'y', chain: [], macros: [] });
  ok('een ander rack zonder herkomst: weg', hf.herkomst === null);
  hf.hernoem('   ');
  ok('lege naam laat de oude staan', hf.rackNaam === 'y');
}

// ---- editor: echte eenheden en parameters zonder nieuwe keten ------------

console.log('\nparameters en eenheden');
{
  const { toonWaarde, effectVan } = await import('../src/engine/fx.js');
  ok('delay-tijd in ms', toonWaarde('delay', 'tijd', 0) === '20 ms' && toonWaarde('delay', 'tijd', 1) === '1200 ms');
  ok('filter in het midden is open', toonWaarde('filter', 'freq', 0.5) === 'open');
  ok('filter links is lowpass, rechts highpass',
    toonWaarde('filter', 'freq', 0) === 'LP 200 Hz' && toonWaarde('filter', 'freq', 1).startsWith('HP 9'));
  ok('gate-deling als maat', toonWaarde('gate', 'deling', 0) === '1/1');
  ok('onbekend effect: gewoon procent', toonWaarde('bestaatniet', 'x', 0.25) === '25%');

  // Het filter vergat zijn frequentie als je aan de resonantie draaide.
  const ctx = new AudioContext();
  const biquads = [];
  const maak = ctx.createBiquadFilter.bind(ctx);
  ctx.createBiquadFilter = () => { const b = maak(); biquads.push(b); return b; };
  const f = effectVan('filter').bouw(ctx);
  const lp = biquads.find((b) => b.type === 'lowpass');
  f.zet('freq', 0.2, 0);
  const lpFreq = lp.frequency.value;
  f.zet('reso', 0.8, 0);
  ok('resonantie verzetten laat de frequentie staan', lp.frequency.value === lpFreq && lpFreq < 5000);

  const pf = eng.deck('F').fx;
  pf.zetRack({ name: 'p', chain: [{ slot: 'a', type: 'delay', params: { tijd: 0.3 } }, { slot: 'b', type: 'filter', params: {} }],
    macros: [{ place: 2, label: 'dik', default: 0, links: [{ target: 'a.feedback', from: 0.2, to: 0.8 }] },
             { place: 5, label: 'ook', default: 1, links: [{ target: 'a.feedback', from: 0, to: 0.1 }] }] });
  const voor = pf.nodeAantal;
  pf.zetParam('a', 'tijd', 0.6);
  ok('parameter zetten bouwt geen nieuwe keten', pf.nodeAantal === voor);
  ok('en komt in het rack (dus ook in wat je bewaart)', pf.naarJSON().chain[0].params.tijd === 0.6);
  ok('paramWaarde van een vrije parameter is zijn eigen stand', pf.paramWaarde('a', 'tijd') === 0.6);
  ok('standaard als er niets staat', pf.paramWaarde('b', 'reso') === effectVan('filter').standaard.reso);
  const st = pf.stuurders('a', 'feedback');
  ok('twee knoppen op één parameter: de hoogste wint', st.plekken.join() === '2,5' && st.wint === 5);
  ok('paramWaarde van een gestuurde parameter volgt de winnende knop', Math.abs(pf.paramWaarde('a', 'feedback') - 0.1) < 1e-9);
  pf.setPlek(5, 0);
  ok('en beweegt mee als je aan die knop draait', pf.paramWaarde('a', 'feedback') === 0);
  ok('niemand stuurt een vrije parameter', pf.stuurders('a', 'tijd').wint === null);
  ok('onbekend slot: zetParam weigert', pf.zetParam('z', 'tijd', 1) === false);
}

// ---- delaytijd: kruisfaden in plaats van doppler-gejank --------------------
// Delaytijd verschuiven liet de toonhoogte van de echo glijden. Nu gaat een
// nieuwe tijd op de stille leeskop en wordt er naartoe gefaded.

console.log('\ndelaytijd zonder gejank');
{
  const { effectVan } = await import('../src/engine/fx.js');
  const ctx = new AudioContext();
  const d = effectVan('delay').bouw(ctx);
  NOW = 100;
  d.zet('tijd', 0.35, NOW);
  let k = d._kop();
  ok('bij het bouwen: beide koppen op dezelfde tijd, één hoorbaar',
    k.tijden[0] === k.tijden[1] && k.gains[0] === 1 && k.gains[1] === 0);
  d.zet('tijd', 0.8, NOW);
  k = d._kop();
  ok('nieuwe tijd gaat op de ANDERE kop, de oude blijft staan',
    k.actief === 1 && k.tijden[1] > k.tijden[0] && Math.abs(k.tijden[0] - k.tijden[1]) > 0.1);
  ok('en daar wordt naartoe gefaded', k.gains[0] < 1e-6 && k.gains[1] > 0.999);
  const oudeTijd = k.tijden[0];
  d.zet('tijd', 0.2, NOW + 0.01);          // snel doordraaien, midden in de fade
  d.zet('tijd', 0.5, NOW + 0.02);
  k = d._kop();
  ok('tijdens een fade: niets over elkaar heen', k.actief === 1 && k.tijden[0] === oudeTijd);
  NOW += 0.2;
  await new Promise((r) => setTimeout(r, 150));
  k = d._kop();
  const verwacht = 0.02 * Math.pow(1.2 / 0.02, 0.5);
  ok('daarna komt de LAATSTE stand, niet een tussenstand',
    k.actief === 0 && Math.abs(k.tijden[0] - verwacht) < 1e-9);
  NOW += 1;
  d.zet('tijd', 0.5, NOW);
  ok('dezelfde tijd nog eens: geen onnodige fade', d._kop().actief === 0);
  ctx.state = 'suspended';
  d.zet('tijd', 0.9, NOW);
  k = d._kop();
  ok('audio staat stil: meteen, geen fade die op een stilstaande klok wacht',
    k.tijden[0] === k.tijden[1] && Math.abs(k.tijden[0] - 0.02 * Math.pow(60, 0.9)) < 1e-9);
  NOW = 0;
}
// Een wachtende stand mag een nieuwere niet overschrijven. In een verborgen tabblad
// knijpt Chrome de timer: dan kan er een directe wissel tussen komen, en daarna
// zette de oude timer alsnog de oude tijd (gevonden door het spoor effecten, 5 okt).
{
  const { effectVan } = await import('../src/engine/fx.js');
  const ctx = new AudioContext();
  const d = effectVan('delay').bouw(ctx);
  NOW = 200;
  d.zet('tijd', 0.35, NOW);
  d.zet('tijd', 0.8, NOW);                    // een fade loopt
  d.zet('tijd', 0.2, NOW + 0.01);             // wacht op het einde van die fade
  NOW += 1;                                   // de (geknepen) timer is nog niet geweest
  d.zet('tijd', 0.6, NOW);                    // en nu meteen een nieuwere stand
  NOW += 1;
  await new Promise((r) => setTimeout(r, 400));
  const k = d._kop();
  ok('een geknepen timer zet geen oude delaytijd over een nieuwere heen',
    Math.abs(k.tijden[k.actief] - 0.02 * Math.pow(60, 0.6)) < 1e-9);
  d.vernietig?.();
  NOW = 0;
}

// ---- reverb met freeze --------------------------------------------------------

console.log('\nreverb en freeze');
{
  const { effectVan, toonWaarde } = await import('../src/engine/fx.js');
  const r = effectVan('reverb').bouw(new AudioContext());
  for (const [p, v] of Object.entries(effectVan('reverb').standaard)) r.zet(p, v, 0);
  let st = r._staat();
  ok('bouwt, acht lijnen, allemaal onder 1 (dus sterft uit)', st.gains.length === 8 && st.gains.every((g) => g > 0 && g < 1));
  ok('langere lijn verliest per rondgang meer (zelfde RT60 voor allemaal)', st.gains[7] < st.gains[0]);
  const rt = st.rt60, g0 = st.gains[0];
  ok('gain volgt RT60: 60 dB na rt60 seconden', Math.abs(Math.pow(g0, rt / 0.0297) - 0.001) < 1e-6);
  r.zet('grootte', 1, 0);
  ok('grotere ruimte: gains dichter bij 1', r._staat().gains[0] > g0);
  r.zet('freeze', 1, 0);
  st = r._staat();
  ok('freeze: invoer dicht, lus (bijna) verliesloos', st.invoer === 0 && st.gains.every((g) => g > 0.999 && g < 1));
  ok('freeze: opruimen wacht niet eeuwig', r.staart() <= 1);
  r.zet('freeze', 0, 0);
  ok('freeze los: weer uitsterven, invoer open', r._staat().invoer === 1 && r._staat().gains.every((g) => g < 0.999));
  ok('eenheden', toonWaarde('reverb', 'grootte', 0) === '0,4 s' && toonWaarde('reverb', 'freeze', 1) === 'vast');

  // Q van een lowpass is in Web Audio een piek in dB. Positief in een lus =
  // groeien in plaats van uitsterven. Voor ELK filter in een feedbacklus.
  for (const id of ['reverb', 'delay']) {
    const ctx = new AudioContext();
    const filters = [];
    const maak = ctx.createBiquadFilter.bind(ctx);
    ctx.createBiquadFilter = () => { const b = maak(); filters.push(b); return b; };
    effectVan(id).bouw(ctx);
    ok(`${id}: geen enkel lowpass-filter met een piek (Q < -3 dB)`,
      filters.filter((f) => f.type === 'lowpass').every((f) => f.Q.value < -3));
  }
}

// ---- glijden: de knop staat meteen, het geluid volgt in zijn eigen tijd ------

console.log('\nglijden');
{
  const { leesRack, schrijfRack } = await import('../src/engine/rack.js');
  const gf = eng.deck('E').fx;
  NOW = 1000;
  gf.zetRack({ name: 'g', chain: [{ slot: 'a', type: 'filter', params: {} }],
    macros: [{ place: 1, label: 'getij', default: 0, glide: 10, links: [{ target: 'a.freq', from: 0, to: 1 }] },
             { place: 2, label: 'direct', default: 0, links: [{ target: 'a.reso', from: 0, to: 1 }] }] });
  gf.setPlek(1, 1);
  ok('de KNOP staat meteen waar je hem zet (soft-takeover leest dit)', gf.leesPlek(1) === 1);
  ok('het GELUID begint waar het was', gf.plekEffectief(1) === 0 && gf.glijdt(1));
  NOW += 5;
  ok('halverwege de glijtijd: halverwege', Math.abs(gf.plekEffectief(1) - 0.5) < 1e-9 && Math.abs(gf.paramWaarde('a', 'freq') - 0.5) < 1e-9);
  gf.setPlek(1, 0);
  ok('omdraaien onderweg: vanaf waar het geluid nu is', Math.abs(gf.glijden[1].van - 0.5) < 1e-9);
  NOW += 10;
  ok('na de glijtijd: aangekomen', gf.plekEffectief(1) === 0);
  gf.setPlek(2, 0.7);
  ok('knop zonder glijtijd: direct', gf.plekEffectief(2) === 0.7 && !gf.glijdt(2));
  gf.setPlek(1, 0.9, { direct: true });
  ok('direct (editor, DICHT/OPEN) slaat het glijden over', gf.plekEffectief(1) === 0.9 && !gf.glijdt(1));

  // Alleen doorgeven wat veranderd is: tijdens glijden komt dit 30x per seconde langs.
  let aanroepen = 0;
  const echt = gf.keten.node.zet;
  gf.keten.node.zet = (...a) => { aanroepen++; return echt(...a); };
  gf.setPlek(2, 0.7);
  ok('dezelfde stand nog eens: niets naar de effecten', aanroepen === 0);
  gf.setPlek(2, 0.2);
  ok('andere stand: alleen die ene parameter', aanroepen === 1);
  gf.keten.node.zet = echt;

  gf.setPlek(1, 0.1);
  NOW += 20;
  await new Promise((r) => setTimeout(r, 80));
  ok('klaar met glijden: de timer stopt vanzelf', gf._glijTimer === null && !gf.glijdt(1));

  const rond = leesRack(schrijfRack(leesRack({ chain: [], macros: [{ place: 1, glide: 90, links: [] }, { place: 2, glide: -3, links: [] },
    { place: 3, glide: 9999, links: [] }] }).rack)).rack.macros.map((m) => m.glide);
  ok('glijtijd reist mee bij bewaren; negatief = 0; hooguit 10 minuten', rond.join() === '90,0,600');
  NOW = 0;
}

// ---- sends: de staart loopt door als de fader dicht gaat ---------------------

console.log('\nsends');
{
  ok('twee bussen: echo en galm', eng.sends.A.rackNaam === 'Echo' && eng.sends.B.rackNaam === 'Galm');
  ok('een bus is helemaal nat (geen dubbel droog signaal)', eng.sends.A.mix === 1 && eng.sends.A.dry.gain.value < 1e-9);
  ok('galm op de bus: meng op vol', eng.sends.B.paramWaarde('a', 'meng') === 1);
  const d = eng.deck('D');
  ok('sends staan standaard dicht', d.sendA.gain.value === 0 && d.sendB.gain.value === 0);
  invoke('track.4.send.a', 0.5);
  ok('send-knop op de bus, kwadratisch (0,5 -> 0,25)', d.ui.sendA === 0.5 && Math.abs(d.sendA.gain.value - 0.25) < 1e-9);
  invoke('track.4.send.a', 0);
  invoke('send.b.knob.3', 1);
  ok('busknop: galm vasthouden', eng.sends.B.paramWaarde('a', 'freeze') === 1);
  invoke('send.b.knob.3', 0);
  invoke('send.a.knob.1', 0.3);
  ok('busknop: echotijd', Math.abs(eng.sends.A.paramWaarde('a', 'tijd') - 0.3) < 1e-9);
  // Echo op de maat (C6): standaard 1/4 tel van de maat-track, knop 4 = vrij.
  // De klok ver vooruit: eerdere tests lieten fades achter op hun eigen tijd.
  NOW = 1000;
  const kop = () => eng.sends.A.keten.node.slots.get('a').inst;
  ok('echo-bus staat standaard op de maat', eng.sends.A.paramWaarde('a', 'sync') === 1);
  NOW += 1;
  invoke('send.a.knob.1', 3 / 7);
  const dM = eng.deck('D');
  const { Beatgrid: BG } = await import('../src/engine/beatgrid.js');
  dM.load(buf, 'maat'); dM.setGrid(new BG({ bpm: 120, firstBeat: 0 })); dM.play();
  const meester = eng.syncMaster();
  const tel = meester.fxKlok().beatLengte;
  NOW += 1;
  dM.emit('change', dM);
  ok(`op de maat: 1/4 tel = ${tel.toFixed(3)} s`, Math.abs(kop()._kop().tijden[kop()._kop().actief] - tel) < 1e-6);
  NOW += 1;
  invoke('send.a.knob.1', 1 / 7);
  ok('knop 1 kiest de deling: 1/8 tel', Math.abs(kop()._kop().tijden[kop()._kop().actief] - tel / 2) < 1e-6);
  NOW += 1;
  meester.setRate(meester.rate * 1.1);
  ok('tempo omhoog: de echo loopt mee', Math.abs(kop()._kop().tijden[kop()._kop().actief] - meester.fxKlok().beatLengte / 2) < 1e-6);
  NOW += 1;
  meester.setRate(meester.rate / 1.1);
  const { toonWaarde: tw } = await import('../src/engine/fx.js');
  ok('eenheid volgt de schakelaar', tw('delay', 'tijd', 1 / 7, (q) => eng.sends.A.paramWaarde('a', q)) === '1/8 tel'
    && tw('delay', 'tijd', 0) === '20 ms');
  NOW += 1;
  invoke('send.a.knob.4', 0);
  ok('knop 4 naar vrij: weer milliseconden', Math.abs(kop()._kop().tijden[kop()._kop().actief] - 0.02 * Math.pow(60, 1 / 7)) < 1e-6);
  NOW += 1;
  invoke('send.a.knob.4', 1);
  dM.stop();
  ok('maat-track stopt: de echo houdt de laatste tel', Math.abs(kop()._kop().tijden[kop()._kop().actief] - tel / 2) < 1e-6);
  dM.setGrid(null);
  NOW = 0;
  // Drukknop (D3): vol open zolang ingedrukt, daarna terug.
  invoke('send.b.knob.3', 0.2);
  invoke('send.b.knob.3.hold', true);
  ok('drukknop: galm vasthouden zolang ingedrukt', eng.sends.B.leesPlek(3) === 1 && eng.sends.B.paramWaarde('a', 'freeze') === 1);
  invoke('send.b.knob.3.hold', true);             // tweede bron tegelijk
  invoke('send.b.knob.3.hold', false);
  ok('loslaten: terug naar waar hij stond', Math.abs(eng.sends.B.leesPlek(3) - 0.2) < 1e-9);
  invoke('send.b.knob.3.hold', false);
  ok('nog eens loslaten doet niets', Math.abs(eng.sends.B.leesPlek(3) - 0.2) < 1e-9);
  invoke('send.b.knob.3', 0);
  const fxD = eng.deck('D').fx;
  fxD.zetEffect('delay');
  invoke('track.4.fx.knob.2', 0.3);
  invoke('track.4.fx.knob.2.hold', true);
  ok('drukknop op een trackplek: vol open', fxD.leesPlek(2) === 1);
  fxD.zetEffect('filter');
  invoke('track.4.fx.knob.2.hold', false);
  ok('rack gewisseld tijdens het drukken: niet terugzetten in het nieuwe rack', fxD.leesPlek(2) !== 0.3);
  invoke('track.4.fx.knob.8.hold', true);
  ok('plek die niet bestaat: niets', fxD.leesPlek(8) === null);
  invoke('track.4.fx.knob.8.hold', false);
  ok('elke track heeft beide sends op de bus', list().filter((a) => /^track\.\d\.send\.[ab]$/.test(a.id)).length === 16);
}

// ---- sampler ----------------------------------------------------------------

console.log('\nsampler');
{
  const { knipBereik, naadloos } = await import('../src/engine/sampler.js');
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const g = new Beatgrid({ bpm: 120, firstBeat: 0.1 });       // tel op 0,1 · 0,6 · 1,1 …
  let r = knipBereik(g, 5.35, 4);
  ok('knippen eindigt op de laatste tel vóór de positie', Math.abs(r.tot - 5.1) < 1e-9);
  ok('en is precies 4 tellen lang', Math.abs(r.tot - r.van - 2) < 1e-9 && r.bpm === 120);
  r = knipBereik(g, 5.1, 4);
  ok('precies op een tel: die tel telt mee', Math.abs(r.tot - 5.1) < 1e-9);
  r = knipBereik(null, 3, 4);
  ok('zonder grid: laatste 2 s, geen tempo', r.van === 1 && r.tot === 3 && r.bpm === null);
  const kort = knipBereik(g, 0.7, 8);
  ok('vlak na het begin: minder HELE tellen, op de tel, niet een afgekapt stuk',
    kort.tellen === 1 && Math.abs(kort.van - 0.1) < 1e-9 && Math.abs(kort.tot - 0.6) < 1e-9);

  // Naadloos: een zaagtand die niet netjes rondloopt krijgt een zachte naad.
  const voor = 10, n = 200;
  const x = new Float32Array(voor + n).map((_, i) => (i % 37) / 37);
  const [uit] = naadloos([x], voor);
  ok('naadloos haalt de voorloop eraf', uit.length === n && uit[0] === x[voor]);
  ok('het laatste sample sluit aan op wat vlak vóór het begin stond',
    Math.abs(uit[n - 1] - x[voor - 1]) < 1e-6);
  ok('buiten de naad blijft alles gelijk', uit[50] === x[voor + 50]);

  // De sampler zelf, met de mock
  const sm = eng.sampler;
  const dS = eng.deck('F');
  dS.load(buf, 'sample-bron');
  dS.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dS.seek(1.3);
  sm.tellen = 2;
  await sm.neem(0, dS, { bron: 6 });
  const pad = sm.pads[0];
  ok('pad gevuld, met tempo en bron', pad && pad.bpm === 124 && pad.bron === 6 && pad.tellen === 2);
  ok('lengte: 2 tellen van 124 bpm', Math.abs(pad.buffer.duration - 2 * 60 / 124) < 0.001);
  // klok: 120 bpm hoorbaar, volgende tel over 0,3 s
  const oudeKlok = sm.klok;
  sm.klok = () => ({ beatLengte: 0.5, ankerCtx: NOW + 0.3 });
  sm.wissel(0);
  ok('start op de volgende tel, niet nu', Math.abs(sm.pads[0].start - (NOW + 0.3)) < 1e-9);
  // Exact: één rondgang = 2 tellen van 0,5 s. Dat is ~120/124, maar uit de
  // echte bufferlengte (hele samples), anders loopt de pad uit de maat.
  ok('op het tempo dat je hoort (~120/124, exact uit de bufferlengte)',
    Math.abs(sm.pads[0].src.playbackRate.value - pad.buffer.duration / (2 * 0.5)) < 1e-12
    && Math.abs(sm.pads[0].src.playbackRate.value - 120 / 124) < 1e-4);
  ok('als loop', sm.pads[0].src.loop === true);
  sm.wissel(0);
  ok('nog eens: stop', !sm.pads[0].speelt);
  sm.klok = () => null;
  sm.wissel(0);
  ok('zonder maat: meteen, op eigen tempo', sm.pads[0].start === NOW && sm.pads[0].src.playbackRate.value === 1);
  sm.wis(0);
  ok('wis maakt de pad leeg', sm.pads[0] === null);
  sm.klok = oudeKlok;
  let fout = null;
  await sm.neem(1, eng.deck('H')).catch((e) => { fout = e.message; });
  ok('lege track: een duidelijke reden, geen halve pad', fout && sm.pads[1] === null);
  // Meelopen met de maat (D2): tempo én tel.
  {
    const bronnen = [];
    const maak = sm.ctx.createBufferSource.bind(sm.ctx);
    sm.ctx.createBufferSource = () => {
      const b = maak(); const st = b.start, sp = b.stop;
      b.start = (t, o) => { b.op = t; b.offset = o; st.call(b, t, o); };
      b.stop = (t) => { b.gestopt = t ?? 'nu'; sp.call(b, t); };
      bronnen.push(b); return b;
    };
    NOW = 2000;
    let klokNu = { beatLengte: 0.5, ankerCtx: 2000.2 };     // 120 bpm
    sm.klok = () => klokNu;
    await sm.neem(6, dS, { bron: 6 });
    sm.wissel(6);
    const pad = sm.pads[6];
    const eerste = bronnen.at(-1);
    sm.heranker();
    ok('herankeren zonder verandering: geen nieuwe bron', bronnen.at(-1) === eerste && !pad.oud);
    // 1,3 s later: het sample loopt sinds 2000,2 op 120/124. Het tempo gaat naar 126.
    NOW = 2001.5;
    klokNu = { beatLengte: 60 / 126, ankerCtx: 2001.7 };
    sm.heranker();
    const nieuw = bronnen.at(-1);
    const tel = pad.buffer.duration / pad.tellen;              // een tel in het sample (~60/124)
    ok('nieuw tempo: nieuwe bron op het tempo van de maat', nieuw !== eerste
      && Math.abs(nieuw.playbackRate.value - pad.buffer.duration / (pad.tellen * 60 / 126)) < 1e-12
      && Math.abs(nieuw.playbackRate.value - 126 / 124) < 1e-4);
    ok('... die start op de volgende tel van de maat', nieuw.op === 2001.7);
    ok('... op een hele tel in het sample', Math.abs(nieuw.offset / tel - Math.round(nieuw.offset / tel)) < 1e-9);
    ok('... dichtbij waar de oude op dat moment was', Math.abs(nieuw.offset - ((1.5 * 120 / 124) % pad.buffer.duration)) < tel / 2 + 1e-9);
    ok('de oude speelt door tot die tel en vloeit dan uit', Math.abs(eerste.gestopt - 2001.706) < 1e-9);
    // Seek van de maat-track: zelfde tempo, andere tel.
    NOW = 2003;
    klokNu = { beatLengte: 60 / 126, ankerCtx: 2001.7 + 3 * 60 / 126 };   // drie tellen later
    const voor = bronnen.length;
    sm.heranker();
    ok('zelfde tempo, anker op de tel: niets te doen', bronnen.length === voor);
    klokNu = { beatLengte: 60 / 126, ankerCtx: 2001.7 + 3 * 60 / 126 + 0.21 };  // de tel ligt ineens 0,21 s verder
    sm.heranker();
    ok('tel verschoven: opnieuw op de tel gezet', bronnen.length === voor + 1 && Math.abs(bronnen.at(-1).op - (2001.7 + 3 * 60 / 126 + 0.21)) < 1e-9);
    sm.stop(6);
    ok('stop ruimt ook een overgang op', !pad.speelt && !pad.oud && bronnen.at(-1).gestopt !== undefined);
    sm.wis(6);
    sm.ctx.createBufferSource = maak;
    sm.klok = oudeKlok;
    NOW = 0;
  }

  // Bewaren bij het nummer (D1): de sampler meldt wat hij vulde, en haalt
  // een herinnering terug zonder focus of positie.
  let gemeld = null, vergeten = null;
  sm.onGevuld = (n, info) => { gemeld = { n, ...info }; };
  sm.onVergeet = (n, h) => { vergeten = { n, h }; };
  dS.seek(2.1);
  await sm.neem(4, dS, { bron: 6 });
  ok('vullen meldt pad, deck en stuk (tracktijd)', gemeld?.n === 4 && gemeld.deckId === 'F' && gemeld.tot > gemeld.van && gemeld.bpm === 124);
  const stuk = { van: gemeld.van, tot: gemeld.tot };
  sm.wis(4);
  sm.herinneringen[4] = { deckId: 'F', van: stuk.van, tot: stuk.tot, bpm: 124, tellen: 2, bron: 6 };
  ok('leeg met herinnering: bewaard in de stand', sm.stand()[4].bewaard && !sm.stand()[4].gevuld && sm.stand()[4].bewaardBron === 6);
  dS.seek(0.3);                                    // positie en focus doen er niet toe
  gemeld = null;
  invoke('sampler.5', true);
  await new Promise((r) => setTimeout(r, 0));
  ok('klik op de bewaarde pad knipt hetzelfde stuk opnieuw', sm.pads[4]?.van === stuk.van && sm.pads[4].tot === stuk.tot);
  ok('... en meldt het niet opnieuw als nieuw', gemeld === null);
  invoke('sampler.5.clear', true);
  ok('shift op een gevulde pad: leeg, maar nog bewaard', sm.pads[4] === null && sm.stand()[4].bewaard && vergeten === null);
  invoke('sampler.5.clear', true);
  ok('shift op een lege, bewaarde pad: vergeten', !sm.stand()[4].bewaard && vergeten?.n === 4);
  sm.onGevuld = sm.onVergeet = null;
  invoke('sampler.length', true);
  ok('lengte-knop loopt rond', [1, 2, 4, 8].includes(sm.tellen));
}

// ---- ronde 1 van de verbeteringen (23 sep): engine-correctheid -------------

console.log('\nengine-correctheid');
{
  const { Beatgrid, TapTempo } = await import('../src/engine/beatgrid.js');
  // Tap op +5% pitch: je tikt wat je HOORT, het grid staat in tracktijd.
  const dT = eng.deck('G');
  dT.load(buf, 'tap');
  dT.setRate(1.05);
  let ms = 0;
  const echtNu = performance.now;
  performance.now = () => ms;
  for (let i = 0; i < 6; i++) { invoke('track.7.tap', true); invoke('track.7.tap', false); ms += 60000 / 126; }
  performance.now = echtNu;
  ok('tap op +5%: 126 gehoord wordt 120 op het grid', dT.grid && Math.abs(dT.grid.bpm - 120) < 0.01);
  dT.setRate(1);

  // Loop korter dan 20 ms wordt geweigerd (aan het einde gaf dat een eindeloze track).
  ok('loop van 0 lang wordt geweigerd', dT.setLoopRange(2, 2) === false && !dT.loop);

  // ctxTimeOf binnen een loop die al rondging: niet in het verleden.
  const { ctxTijdVan } = await import('../src/engine/stream-kern.js');
  const seg = { T: 0, P: 1, R: 1, loop: { start: 1, end: 3 }, speelt: true };
  const t = ctxTijdVan(seg, 1.5, 4.9);            // positie nu 1,9 (derde rondgang): 1,5 is net voorbij
  ok('volgende keer tracktijd 1,5 in een loop: in de toekomst, na het vouwen', Math.abs(t - 6.5) < 1e-9);
  ok('nog vóór ons in deze rondgang: gewoon het verschil', Math.abs(ctxTijdVan(seg, 2.5, 4.9) - 5.5) < 1e-9);

  const { clamp } = await import('../src/lib/emitter.js');
  ok('clamp(NaN) is de ondergrens, geen NaN', clamp(NaN) === 0 && clamp(Infinity) === 1);

  // Oude ketens worden echt opgeruimd: oscillatoren stoppen.
  const vf = eng.deck('H').fx;
  let gestopt = 0;
  vf.zetRack({ name: 'r', chain: [{ slot: 'a', type: 'phaser', params: {} }], macros: [] });
  for (const s of vf.keten.node.slots.values()) { const e = s.inst.vernietig; s.inst.vernietig = () => { gestopt++; e(); }; }
  const oudeKeten = vf.keten;
  vf.zetRack({ name: 's', chain: [], macros: [] });
  vf._ruimOp(oudeKeten);
  ok('rackwissel stopt de oscillator van de oude keten', gestopt === 1);

  // Gate: bij heranker loopt de oude puls door tot de nieuwe op de tel begint.
  const { effectVan } = await import('../src/engine/fx.js');
  const gctx = new AudioContext();
  const bronnen = [];
  const maakBron = gctx.createBufferSource.bind(gctx);
  gctx.createBufferSource = () => {
    const b = maakBron(); b.gestartOp = null; b.gestoptOp = null;
    const st = b.start, sp = b.stop;
    b.start = (t) => { b.gestartOp = t; st(t); };
    b.stop = (t) => { b.gestoptOp = t ?? 'nu'; sp(t); };
    bronnen.push(b); return b;
  };
  let anker = 10.4;
  NOW = 10;
  const gate = effectVan('gate').bouw(gctx, { klok: () => ({ beatLengte: 0.5, ankerCtx: anker }) });
  gate.zet('deling', 0.4, NOW);
  anker = 10.9;
  gate.heranker();
  ok('gate: nieuwe puls start op de volgende tel', bronnen[1]?.gestartOp === 10.9);
  ok('gate: de oude puls loopt door tot precies dat moment (geen gat)', bronnen[0]?.gestoptOp === 10.9);

  // Gate ZONDER maat (de klok valt weg: stilstand, geen grid). De poort gaat
  // open met een helling van 5 ms, en die begint, zoals de kill, pas na
  // startDrempel: op `nu` viel hij in Chrome samen tot één stap (de
  // renderthread loopt tot ~7,5 ms voor). De oude puls vloeit in dezelfde
  // helling uit en stopt pas als die klaar is: stoppen terwijl hij nog
  // meetelt is een sprong in de gain.
  {
    const { startDrempel } = await import('../src/engine/overgang.js');
    const g2 = new AudioContext();
    const gains = [], pulsen = [];
    const maakGain = g2.createGain.bind(g2);
    g2.createGain = () => { const n = maakGain(); gains.push(n); return n; };
    const maakPuls = g2.createBufferSource.bind(g2);
    g2.createBufferSource = () => {
      const b = maakPuls(); const sp = b.stop, cn = b.connect;
      b.stop = (t) => { b.gestoptOp = t ?? 'nu'; sp(t); };
      b.connect = (n) => { b.naar = n; return cn(n); };
      pulsen.push(b); return b;
    };
    const fouten0 = OVERLAP_FOUTEN, breuk0 = CURVE_BREUK;
    let k2 = { beatLengte: 0.5, ankerCtx: 20.4 };
    NOW = 20;
    const gate2 = effectVan('gate').bouw(g2, { klok: () => k2 });
    gate2.zet('deling', 0.4, NOW);                 // de puls loopt vanaf 20,4
    const poort = gains[1].gain;
    const log = (p) => {
      const l = [];
      for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime']) {
        const o = p[m]; p[m] = function (x, t, ...r) { l.push([m, x, t]); return o.call(this, x, t, ...r); };
      }
      return l;
    };
    const lp = log(poort);
    const pulsGain = pulsen[0]?.naar?.gain;
    const lg = pulsGain ? log(pulsGain) : [];
    NOW = 21;
    k2 = null;
    gate2.heranker();
    const W = startDrempel(g2), eind = NOW + W + 0.005;
    const hellingP = lp.filter(([m]) => m === 'linearRampToValueAtTime');
    ok(`gate zonder maat: de poort gaat open met een helling die pas na de startdrempel (${(W * 1000).toFixed(1)} ms) begint`,
      hellingP.length > 0 && hellingP.at(-1)[1] === 1 && Math.abs(hellingP.at(-1)[2] - eind) < 1e-9
      && lp.some(([m, , t]) => m === 'setValueAtTime' && Math.abs(t - (NOW + W)) < 1e-9)
      && lp.every(([, , t]) => t <= NOW + 1e-12 || t >= NOW + W - 1e-12));
    const hellingG = lg.filter(([m]) => m === 'linearRampToValueAtTime');
    ok('… de oude puls vloeit in dezelfde helling uit (eigen gain naar 0) en stopt pas daarna',
      !!pulsGain && hellingG.length > 0 && hellingG.at(-1)[1] === 0 && Math.abs(hellingG.at(-1)[2] - eind) < 1e-9
      && typeof pulsen[0].gestoptOp === 'number' && pulsen[0].gestoptOp >= eind);
    ok('… zonder overlappende automatisering of afgebroken curve', OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
    // Daarna weer op de maat: gewoon een nieuwe puls op de tel.
    k2 = { beatLengte: 0.5, ankerCtx: 21.4 };
    gate2.heranker();
    ok('… en met de maat terug start een nieuwe puls op de tel', pulsen.at(-1) !== pulsen[0] && pulsen.length === 2);
    gate2.vernietig();
  }
  NOW = 0;
}

// ---- ronde 1, deel 2 (23 sep): loops, tellen, laden ------------------------

console.log('\nloops, tellen en laden');
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const { effectVan } = await import('../src/engine/fx.js');
  const tik0 = () => new Promise((r) => setTimeout(r, 0));

  // 1. Springen naar een plek BUITEN de loop verlaat de loop; erbinnen blijft hij.
  NOW = 100;
  const dL = eng.deck('D');
  dL.load(buf, 'loop-sprong');
  dL.seek(0.5); dL.play();
  dL.setLoopRange(1, 2);
  dL.hotcues[0] = 3.0;
  dL.seek(1.5);
  ok('buffer: seek binnen de loop houdt de loop', dL.loop && dL.loop.start === 1 && Math.abs(dL.position - 1.5) < 1e-9);
  invoke('track.4.hotcue.1', true);
  NOW += 0.5;
  ok('buffer: hotcue buiten de loop verlaat de loop', dL.loop === null && Math.abs(dL.position - 3.5) < 1e-9);
  dL.setLoopRange(1, 2);
  dL.seek(0.2);
  NOW += 1.5;
  ok('buffer: seek vóór de loop speelt er gewoon doorheen', dL.loop === null && Math.abs(dL.position - 1.7) < 1e-9);
  dL.setLoopRange(1, 2);
  dL.seek(1.9);
  dL.nudge(0.2);
  ok('buffer: nudge over de loopgrens vouwt terug in de loop', dL.loop && Math.abs(dL.position - 1.1) < 1e-9);
  dL.pause();
  dL.clearLoop();

  // Sync binnen een loop: de fasecorrectie blijft in de loop (vouwt terug).
  const eS = new Engine();
  const mS = eS.deck('A'), sS = eS.deck('B');
  for (const d of [mS, sS]) { d.load(buf, d.id); d.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 })); }
  mS.seek(0.05); mS.play();                    // fase 0,1
  sS.play(); sS.setLoopRange(1, 2); sS.seek(1.95); // fase 0,9 -> +0,1 s = 2,05: voorbij het loopeinde
  const rS = eS.sync('B');
  ok('sync binnen een loop: blijft in de loop, teruggevouwen', rS.ok && rS.fase && sS.loop && Math.abs(sS.position - 1.05) < 1e-9);

  // Hetzelfde voor de streamende bron.
  const oudCtxWorklet = eng.ctx.audioWorklet;
  eng.ctx.audioWorklet = { addModule: async () => {} };
  globalThis.AudioWorkletNode = nepWorkletNode();
  const dSt = eng.deck('G');
  await dSt.laadGeheugen(buf, 'stream-loop');
  dSt.seek(0.5); dSt.play();
  dSt.setLoopRange(1, 2);
  dSt.hotcues[1] = 3.0;
  dSt.seek(1.5);
  ok('stream: seek binnen de loop houdt de loop', dSt.loop && dSt.bron.seg.loop && Math.abs(dSt.position - 1.5) < 1e-9);
  invoke('track.7.hotcue.2', true);
  NOW += 0.5;
  ok('stream: hotcue buiten de loop verlaat de loop', dSt.loop === null && dSt.bron.seg.loop === null && Math.abs(dSt.position - 3.5) < 1e-9);
  dSt.setLoopRange(1, 2);
  dSt.seek(0.2);
  NOW += 1.5;
  ok('stream: seek vóór de loop speelt er gewoon doorheen', dSt.loop === null && Math.abs(dSt.position - 1.7) < 1e-9);

  // 6. Een mislukte laad laat cue en hotcues van de oude track staan.
  dSt.pause();
  dSt.cuePoint = 1.25;
  dSt.hotcues = [0.5, 1.0, null, 2.0];
  let laadFout = null;
  await dSt.laadStream('/media/bestaat-niet/audio.wav', 'kapot',
    { haal: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) }).catch((e) => { laadFout = e.message; });
  ok('mislukte laad: een fout, geen stille mislukking', /404/.test(laadFout || ''));
  ok('mislukte laad: cue en hotcues van de oude track blijven', dSt.cuePoint === 1.25 && dSt.hotcues[0] === 0.5 && dSt.hotcues[3] === 2.0);
  let tijdensLaden = null;
  const laadPlekken = dSt.laadGeheugen(buf, 'volgende');
  tijdensLaden = dSt.bron.vastpunten();
  await laadPlekken;
  ok('tijdens het laden pint de nieuwe track geen hotcues van de oude', tijdensLaden.every((x) => x === null || x === 0) || tijdensLaden.length === 0);
  ok('geslaagde laad wist ze wel', dSt.cuePoint === 0 && dSt.hotcues.every((h) => h === null));
  // Bewaarde hotcues terug op een STREAMENDE track (hotcues per nummer): ze
  // horen meteen bij de vaste punten, en er wordt direct bijgevuld, niet pas
  // bij de volgende tik van de bron.
  let bijgevuld = 0;
  const echtBijvullen = dSt.bron.bijvullen.bind(dSt.bron);
  dSt.bron.bijvullen = () => { bijgevuld++; return echtBijvullen(); };
  dSt.restoreHotcues([null, 1.5]);
  ok('stream: teruggezette hotcues meteen vastgepind', dSt.bron.vastpunten().includes(1.5) && bijgevuld === 1);
  delete dSt.bron.bijvullen;
  dSt.bron.vernietig();
  dSt.load(buf, 'terug naar buffer');
  eng.ctx.audioWorklet = oudCtxWorklet;
  await tik0();

  // 5. Loop-LED: loopBeats blijft kloppen na halveren en verdubbelen.
  const dB = eng.deck('E');
  dB.load(buf, 'loopbeats');
  dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dB.seek(0.1);
  dB.setBeatLoop(2);
  ok('beatloop 2: loopBeats 2', dB.loopBeats === 2);
  dB.halveLoop();
  ok('halveren: loopBeats 1 (LED volgt)', dB.loopBeats === 1);
  dB.doubleLoop(); dB.doubleLoop();
  ok('twee keer verdubbelen: loopBeats 4', dB.loopBeats === 4);
  dB.doubleLoop();                           // 8 tellen = 3,87 s: past nét, 16 niet
  dB.doubleLoop();
  ok('verdubbelen tegen het trackeinde (geklemd): loopBeats null', dB.loopBeats === null);
  dB.setBeatLoop(1);
  dB.setLoopRange(0.2, 0.9);
  ok('een vrije loop: loopBeats null', dB.loopBeats === null);
  dB.clearLoop();

  // 2. Gate: de periode is exact, ook als hij niet op een hele sample valt.
  const gctx = new AudioContext();
  const gb = [];
  const maakG = gctx.createBufferSource.bind(gctx);
  gctx.createBufferSource = () => { const b = maakG(); const st = b.start; b.start = (t) => { b.op = t; st(t); }; gb.push(b); return b; };
  NOW = 500;
  let gk = { beatLengte: 60 / 124, ankerCtx: 500.3 };
  const gate = effectVan('gate').bouw(gctx, { klok: () => gk });
  gate.zet('deling', 1, NOW);                // 1/16
  const periodeVan = (b) => b.buffer.length / gctx.sampleRate / Math.fround(b.playbackRate.value);
  const drift = (b, bl) => { const p = bl * 0.25; return Math.abs(periodeVan(b) - p) * (600 / p); };
  const d16 = drift(gb.at(-1), 60 / 124);
  ok(`gate 1/16 op 124 bpm: over 10 minuten ${(d16 * 1000).toFixed(3)} ms uit de maat (≤ 1 ms)`, d16 <= 0.001);
  const eersteBuf = gb.at(-1).buffer;
  gk = { beatLengte: 60 / 124.6, ankerCtx: 500.8 };
  gate.heranker();
  ok('kleine tempowijziging: dezelfde buffer, alleen een andere snelheid', gb.at(-1).buffer === eersteBuf && gb.length === 2);
  ok(`... en nog steeds exact (${(drift(gb.at(-1), 60 / 124.6) * 1000).toFixed(3)} ms per 10 min)`, drift(gb.at(-1), 60 / 124.6) <= 0.001);
  gate.zet('vorm', 0.2, NOW);
  ok('vorm veranderen bouwt wel een nieuwe buffer', gb.at(-1).buffer !== eersteBuf);

  // 4. Een tel die al binnen de uitgangsbuffer valt: de tel erna.
  gk = { beatLengte: 0.5, ankerCtx: NOW + 0.002 };
  gate.heranker();
  ok('gate: tel binnen de uitgangsbuffer -> de tel erna', Math.abs(gb.at(-1).op - (NOW + 0.502)) < 1e-9);
  gk = { beatLengte: 0.5, ankerCtx: NOW + 0.05 };
  gate.heranker();
  ok('gate: tel ruim vooruit -> gewoon die tel', Math.abs(gb.at(-1).op - (NOW + 0.05)) < 1e-9);
  gate.vernietig();

  // 3 + 4. Sampler: exact rond, en niet te laat starten.
  const sm = eng.sampler;
  const dSm = eng.deck('F');
  dSm.load(buf, 'sampler-drift');
  dSm.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dSm.seek(1.31);
  const oudeTellen = sm.tellen;
  sm.tellen = 2;
  await sm.neem(7, dSm);
  const oudeKlokS = sm.klok;
  let sk = { beatLengte: 0.5, ankerCtx: NOW + 0.3 };      // 120 bpm hoorbaar
  sm.klok = () => sk;
  sm.wissel(7);
  const sp = sm.pads[7];
  const lusDuur = (src) => sp.buffer.length / sp.buffer.sampleRate / Math.fround(src.playbackRate.value);
  const sDrift = Math.abs(lusDuur(sp.src) - 2 * 0.5) * (600 / (2 * 0.5));
  ok(`sampler: 2 tellen op 120 bpm, over 10 minuten ${(sDrift * 1000).toFixed(3)} ms uit de maat (≤ 1 ms)`, sDrift <= 0.001);
  sk = { beatLengte: 60 / 126, ankerCtx: NOW + 0.4 };
  sm.heranker();
  const hDrift = Math.abs(lusDuur(sp.src) - 2 * 60 / 126) * (600 / (2 * 60 / 126));
  ok(`sampler na tempowissel: ${(hDrift * 1000).toFixed(3)} ms per 10 min (≤ 1 ms)`, hDrift <= 0.001);
  sm.stop(7);
  sk = { beatLengte: 0.5, ankerCtx: NOW + 0.002 };
  sm.wissel(7);
  ok('sampler: tel binnen de uitgangsbuffer -> de tel erna', Math.abs(sm.pads[7].start - (NOW + 0.502)) < 1e-9);
  sm.stop(7);
  sk = { beatLengte: 0.5, ankerCtx: NOW + 0.05 };
  sm.wissel(7);
  ok('sampler: tel ruim vooruit -> gewoon die tel', Math.abs(sm.pads[7].start - (NOW + 0.05)) < 1e-9);
  sm.wis(7);
  sm.klok = oudeKlokS;
  sm.tellen = oudeTellen;
  NOW = 0;
}

// ---- nieuwe actions voor de APC-indeling -----------------------------------

console.log('\nAPC-actions');
{
  const { read: leesA } = await import('../src/control/actions.js');
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const dL = eng.deck('E');
  dL.load(buf, 'loop'); dL.setGrid(null);
  invoke('track.5.loop.toggle', true);
  ok('loop.toggle zonder grid: 4 seconden', dL.loop && Math.abs(dL.loop.end - dL.loop.start - Math.min(4, dL.duration)) < 1e-6);
  invoke('track.5.loop.toggle', true);
  ok('nog eens: loop uit', !dL.loop && leesA('track.5.loop.toggle') === 0);
  dL.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  dL.seek(0.2);
  invoke('track.5.loop.toggle', true);
  ok('met grid: 8 tellen (of wat er past)', dL.loop && dL.loopBeats === 8 || (dL.loop && dL.loop.end <= dL.duration));
  dL.clearLoop();
  const oudeFocus = eng.focus;
  eng.setFocus('H'); invoke('focus.next', true);
  ok('focus.next loopt rond: 8 -> 1', eng.focus === 'A');
  invoke('focus.prev', true);
  ok('focus.prev: 1 -> 8', eng.focus === 'H');
  eng.setFocus(oudeFocus);
  const maatId = eng.syncMaster()?.id;
  ok('maat-read wijst precies één track aan', maatId && leesA(`track.${'ABCDEFGH'.indexOf(maatId) + 1}.leads`) === 1
    && ['A','B','C','D','E','F','G','H'].filter((x) => leesA(`track.${'ABCDEFGH'.indexOf(x) + 1}.leads`) === 1).length === 1);
  ok('tel-read is 0 als de track stilstaat', leesA('track.5.beat') === 0);
}

// ---- acht tracks ------------------------------------------------------------
// Eén per fader. Wat voor twee werkte moet precies zo blijven klinken.

console.log('\nacht tracks');
{
  const { DECK_IDS } = await import('../src/engine/engine.js');
  const e8 = new Engine();
  ok('acht decks', DECK_IDS.length === 8 && DECK_IDS.every((id) => e8.deck(id)));
  ok('standaard: 1 op A, 2 op B, de rest thru',
    e8.kant.A === 'A' && e8.kant.B === 'B' && ['C', 'D', 'E', 'F', 'G', 'H'].every((id) => e8.kant[id] === 'thru'));

  e8.setXfader(0);
  ok('crossfader links: kant B stil, thru onaangetast',
    e8.xfadeGain('B') < 1e-9 && e8.xfadeGain('C') === 1 && e8.xfadeGain('A') > 0.999);
  e8.setKant('C', 'B');
  ok('track 3 op B volgt de crossfader', e8.xfadeGain('C') < 1e-9);
  e8.setKant('C', 'onzin');
  ok('onbekende kant wordt genegeerd', e8.kant.C === 'B');
  e8.setXfader(0.5);

  // Syncmaster: wie je het hardst hoort, niet "het andere deck".
  for (const id of ['A', 'C', 'D']) {
    e8.deck(id).load(buf, id);
    e8.deck(id).setGrid(new Beatgrid({ bpm: { A: 120, C: 124, D: 130 }[id], firstBeat: 0 }));
  }
  ok('niets speelt: eerste geladen track met grid', e8.syncMaster('D').id === 'A');
  e8.deck('C').togglePlay();
  e8.deck('D').togglePlay();
  e8.deck('C').set('fader', 0.6);
  // Hysterese (G2): de maat wisselt pas als een ander 250 ms (audioklok)
  // minstens 3 dB harder klinkt. Hier 13,5 dB, dus na 250 ms.
  ok('meteen na de fader: de maat blijft nog even (hysterese)', e8.syncMaster('A').id === 'C');
  NOW += 0.3;
  ok('speelt er iets: de luidste die speelt', e8.syncMaster('A').id === 'D');
  e8.deck('D').set('fader', 0.3);
  NOW += 0.3;
  ok('fader omlaag: de ander wordt master', e8.syncMaster('A').id === 'C');
  e8.setXfader(1);              // C staat op kant B: nu vol open
  e8.deck('D').set('fader', 1);
  e8.setKant('D', 'A');         // en D gaat dicht door de crossfader
  ok('crossfader telt mee', e8.syncMaster('A').id === 'C');
  const rs = e8.sync('A');
  ok('sync meldt naar wie', rs.ok && rs.master === 'C' && Math.abs(e8.deck('A').bpm - 124) < 1e-6);
  ok('een track synct nooit naar zichzelf', e8.syncMaster('C').id !== 'C');
  ok('lege track kan niet syncen', !e8.sync('H').ok);

  const s8 = e8.snapshot();
  ok('snapshot heeft alle acht, met kant', Object.keys(s8.decks).length === 8 && s8.decks.C.kant === 'B');
  ok('fase per track in de snapshot', Object.keys(s8.fase).length === 8);

  // De action op de gedeelde bus (eng): A -> B -> thru -> A.
  const { read: leesAction } = await import('../src/control/actions.js');
  ok('track 8 bestaat op de bus', list().some((a) => a.id === 'track.8.play'));
  invoke('track.3.xfade.side', true);
  const naEen = eng.kant.C;
  invoke('track.3.xfade.side', true);
  invoke('track.3.xfade.side', true);
  ok('kant-knop loopt rond: thru -> A -> B -> thru', naEen === 'A' && eng.kant.C === 'thru');
  ok('read geeft drie standen', leesAction('track.1.xfade.side') === 0
    && leesAction('track.2.xfade.side') === 1 && leesAction('track.3.xfade.side') === 0.5);
  invoke('track.3.xfade.b', true);
  ok('losse kant-knop: meteen naar B, niet rondlopen', eng.kant.C === 'B' && leesAction('track.3.xfade.b') === 1 && leesAction('track.3.xfade.a') === 0);
  invoke('track.3.xfade.b', true);
  ok('nog eens B blijft B', eng.kant.C === 'B');
  invoke('track.3.xfade.thru', true);
  ok('thru-knop', eng.kant.C === 'thru' && leesAction('track.3.xfade.thru') === 1);
}

// ---- EQ-kill, rem en de maatgever (ROADMAP 16, spoor C) -------------------------

console.log('\nEQ-kill');
{
  const { EQ_KILL_DB, KILL_FADE, eqDb } = await import('../src/engine/audio-graph.js');
  const { startDrempel } = await import('../src/engine/overgang.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const dK = eng.deck('H');
  const WACHT = startDrempel(eng.ctx);
  NOW = 300;
  const fouten0 = OVERLAP_FOUTEN, breuk0 = CURVE_BREUK;
  const p = dK.chain.eqLow.gain;
  // De kill-overgangen op de lage band, om hun vorm na te lopen: een
  // beginpunt op nu (setValueAtTime), hetzelfde punt nog eens na de
  // startdrempel, en de hellingen erna.
  const curves = [];
  const origZet = p.setValueAtTime, origHelling = p.linearRampToValueAtTime;
  p.setValueAtTime = function (x, t) {
    const k = curves[curves.length - 1];
    if (k && k.c.length === 1 && k.c[0] === x) k.t = t;
    else curves.push({ nu: t, t, d: 0, c: [x] });
    return origZet.call(this, x, t);
  };
  p.linearRampToValueAtTime = function (x, t) {
    const k = curves[curves.length - 1];
    if (k) { k.c.push(x); k.d = t - k.t; }
    return origHelling.call(this, x, t);
  };

  ok('lege track: kill-lampje uit (niets te doen)', read('track.8.kill.low') === null);
  dK.load(buf, 'kill');
  invoke('track.8.low', 0.7);
  const stand = eqDb(0.7);
  ok('kill-lampje 0: open, bruikbaar', read('track.8.kill.low') === 0 && read('track.8.kill.low.hold') === 0);
  invoke('track.8.kill.low', true); invoke('track.8.kill.low', false);
  ok('kill aan: de lage band naar −70 dB (lampje 1)', p.value === EQ_KILL_DB && dK.gekild('low') && read('track.8.kill.low') === 1);
  ok('… met een overgang van 5 ms, niet hard', curves.length === 1 && Math.abs(curves[0].d - KILL_FADE) < 1e-9
    && curves[0].nu === NOW && curves[0].c.length === 33);
  // Een renderthread die voorloopt zet hellingpunten die voor hem al voorbij
  // zijn op zijn eigen nu: bij een kill van 5 ms kon de hele kill zo één stap
  // worden. Daarom blijft hij tot startDrempel staan en begint dan pas.
  ok(`… die pas na de startdrempel (${(WACHT * 1000).toFixed(1)} ms) begint`,
    Math.abs(curves[0].t - (NOW + WACHT)) < 1e-9);
  // Klikvrij: in AMPLITUDE een zachte S. Een rechte lijn in dB doet bijna
  // alle amplitude in de eerste stapjes, en dat is een tik.
  const amp = (db) => Math.pow(10, db / 20);
  const stapMax = (c) => { let m = 0; for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(amp(c[i]) - amp(c[i - 1]))); return m; };
  const recht = Float64Array.from({ length: 33 }, (_, i) => stand + (EQ_KILL_DB - stand) * i / 32);
  const weg = Math.abs(amp(stand) - amp(EQ_KILL_DB));
  const vorm = curves[0]?.c ?? [];
  ok(`… in amplitude zacht: grootste stap ${(100 * stapMax(vorm) / weg).toFixed(1)}% van de weg (recht in dB: ${(100 * stapMax(recht) / weg).toFixed(0)}%)`,
    vorm.length === 33 && stapMax(vorm) < 0.06 * weg && stapMax(recht) > 0.15 * weg && Math.abs(vorm[0] - stand) < 1e-6);
  ok('de EQ-knop blijft staan', dK.ui.low === 0.7 && read('track.8.low') === 0.7);

  // Meteen aan de knop draaien, terwijl de kill-overgang nog loopt. Met een
  // setValueCurveAtTime gooide setTargetAtTime daar NotSupportedError, en
  // cancelAndHoldAtTime ertegen gaf in Chrome een sprong (CURVE_BREUK).
  let gegooid = null;
  NOW += WACHT + 0.001;
  try { invoke('track.8.low', 0.3); } catch (e) { gegooid = e; }
  ok('1 ms na het begin aan de knop draaien, tijdens de kill-overgang: geen NotSupportedError, geen afgebroken curve',
    gegooid === null && OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
  ok('… de band blijft weg, de knop onthoudt 0,3', p.value === EQ_KILL_DB && dK.ui.low === 0.3);
  NOW += 0.001;
  invoke('track.8.kill.low', true);
  ok('kill uit: precies terug op de knopstand (0,3)', Math.abs(p.value - eqDb(0.3)) < 1e-5 && !dK.gekild('low') && read('track.8.kill.low') === 0);
  ok('… met weer een overgang, van −70 naar de knop', curves.length === 2 && curves[1].c[0] === EQ_KILL_DB && Math.abs(curves[1].c[32] - eqDb(0.3)) < 1e-5);

  // Twee keer drukken binnen de 5 ms: de tweede overgang begint waar de eerste nu is.
  NOW += 1;
  const m = dK.chain.eqMid.gain;
  invoke('track.8.kill.mid', true);
  NOW += WACHT + 0.002;
  gegooid = null;
  try { invoke('track.8.kill.mid', true); } catch (e) { gegooid = e; }
  ok('kill aan en 2 ms later weer uit (overgang loopt nog): geen NotSupportedError, geen afgebroken curve (sprong in Chrome)',
    gegooid === null && OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
  ok('… en terug op de knopstand', Math.abs(m.value - eqDb(dK.ui.mid)) < 1e-5 && !dK.gekild('mid'));

  // Drukvariant.
  const hoog = dK.chain.eqHigh.gain;
  NOW += 1;
  invoke('track.8.kill.high.hold', true);
  ok('drukknop: weg zolang je drukt (beide lampjes 1)', dK.gekild('high') && hoog.value === EQ_KILL_DB
    && read('track.8.kill.high.hold') === 1 && read('track.8.kill.high') === 1);
  NOW += 0.2;
  invoke('track.8.kill.high.hold', false);
  ok('loslaten: terug op de knopstand', !dK.gekild('high') && Math.abs(hoog.value - eqDb(dK.ui.high)) < 1e-5);
  invoke('track.8.kill.high', true);
  NOW += 0.2;
  invoke('track.8.kill.high.hold', true); NOW += 0.2; invoke('track.8.kill.high.hold', false);
  ok('schakelaar aan, dan drukken en loslaten: blijft weg (de schakelaar staat nog aan)', dK.gekild('high') && hoog.value === EQ_KILL_DB);
  NOW += 0.2;
  invoke('track.8.kill.high', true);
  ok('schakelaar uit: terug', !dK.gekild('high') && Math.abs(hoog.value - eqDb(dK.ui.high)) < 1e-5);
  invoke('track.8.kill.low', true);
  ok('per band: laag weg, midden en hoog niet', dK.gekild('low') && !dK.gekild('mid') && !dK.gekild('high')
    && m.value !== EQ_KILL_DB && hoog.value !== EQ_KILL_DB);
  NOW += 0.2;
  invoke('track.8.kill.low', true);
  p.setValueAtTime = origZet; p.linearRampToValueAtTime = origHelling;
  ok('elke kill- en rem-action heeft een uitleg op de APC-kaart',
    ['kill.low', 'kill.mid', 'kill.high', 'kill.low.hold', 'kill.high.hold', 'brake', 'brake.time']
      .every((a) => !beschrijf(`track.8.${a}`).lang.startsWith('?') && beschrijf(`track.8.${a}`).kort !== a));
  ok('geen overlappende automatisering en geen afgebroken curve bij al dat schakelen',
    OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
}

console.log('\nrem (vinylstop)');
{
  const { REM_STANDAARD } = await import('../src/engine/deck.js');
  const { REM_UIT } = await import('../src/engine/stream-kern.js');
  const dR = eng.deck('H');
  NOW = 400;
  dR.load(buf, 'rem');
  dR.seek(0.5);
  ok('stilstaand: rem doet niets (lampje uit: niets te remmen)', !dR.rem() && !dR.remt && read('track.8.brake') === null);
  ok(`remtijd standaard ${REM_STANDAARD} s`, dR.remTijd === REM_STANDAARD && Math.abs(read('track.8.brake.time') - Math.log(10) / Math.log(50)) < 1e-9);
  invoke('track.8.brake.time', 1);
  const vijf = dR.remTijd;
  invoke('track.8.brake.time', 0.5);
  const midden = dR.remTijd;
  invoke('track.8.brake.time', 0);
  ok(`remtijd-knop: 0 = ${dR.remTijd} s, midden = ${midden.toFixed(2)} s, 1 = ${vijf} s`,
    Math.abs(dR.remTijd - 0.1) < 1e-12 && Math.abs(vijf - 5) < 1e-9 && Math.abs(midden - Math.sqrt(0.5)) < 1e-9 && read('track.8.brake.time') === 0);

  dR.play();
  ok('speelt: rem-lampje 0 (er valt te remmen)', read('track.8.brake') === 0);
  NOW += 0.2;
  const P0 = dR.position, D = 0.1;
  const pr = dR.bron.source.playbackRate, g = dR.bron.bronGain.gain;
  invoke('track.8.brake', true); invoke('track.8.brake', false);
  ok('rem: het deck remt en speelt nog (lampje 1)', dR.remt && dR.playing && read('track.8.brake') === 1);
  NOW += 0.05;
  ok('halverwege: positie = P + R·t − R·t²/(2D), snelheid gehalveerd',
    Math.abs(dR.position - (P0 + 0.05 - 0.05 * 0.05 / (2 * D))) < 1e-9 && Math.abs(dR.snelheid - 0.5) < 1e-9);
  ok('de reserve (BufferBron): playbackRate glijdt naar 0, volume dooft in het laatste stuk',
    pr.value === 0 && g.value === 0 && REM_UIT > 0 && REM_UIT < 1);
  ok('een remmende track geeft geen maat (fxKlok leeg)', dR.fxKlok() === null);
  NOW += 0.1;
  ok('na de remtijd: stil op P + R·D/2', Math.abs(dR.position - (P0 + D / 2)) < 1e-9 && dR.snelheid === 0);
  // Vanaf de stilstand op de audioklok is het een pauze, ook als de timer die
  // hem afmaakt nog niet gevuurd heeft (hier: de nep-klok staat al voorbij,
  // de echte timer moet nog komen; live: een timer loopt niet op de
  // audioklok, en in een achtergrondtabblad komt hij tot een seconde te laat).
  ok('stil, de timer heeft nog niet gevuurd: remt niet meer en speelt niet (lampje uit, geen fxKlok)',
    !dR.remt && !dR.playing && read('track.8.brake') === null && dR.fxKlok() === null);
  let klaar = 0;
  dR.on('change', () => { if (!dR.playing) klaar++; });
  await new Promise((r) => setTimeout(r, 200));
  ok('daarna een gewone pauze op die plek (en gemeld)', !dR.playing && !dR.remt && klaar > 0
    && Math.abs(dR.position - (P0 + D / 2)) < 1e-9 && read('track.8.brake') === null);

  invoke('track.8.play', true);
  NOW += 0.1;
  ok('play: gewoon verder vanaf daar, op tempo', dR.playing && !dR.remt && Math.abs(dR.position - (P0 + D / 2 + 0.1)) < 1e-9);

  // Tweede druk tijdens het remmen = los.
  invoke('track.8.brake.time', 1);                  // 5 s
  const P1 = dR.position;
  invoke('track.8.brake', true);
  NOW += 1;
  const P2 = dR.position;
  ok('5 s remmen, na 1 s: 0,9 s afgelegd', Math.abs(P2 - (P1 + 1 - 1 / 10)) < 1e-9);
  invoke('track.8.brake', true);
  ok('nog eens drukken tijdens het remmen: los, weer op tempo', !dR.remt && dR.playing && dR.snelheid === dR.rate);
  NOW += 0.5;
  ok('… en verder vanaf waar hij was', Math.abs(dR.position - (P2 + 0.5)) < 1e-9);

  invoke('track.8.brake', true);
  NOW += 0.2;
  invoke('track.8.play', true);
  ok('play tijdens het remmen: los, niet pauzeren', dR.playing && !dR.remt);
  // shift+Q (play.quant) is op een spelende track "zoals play": tijdens een rem dus ook los.
  invoke('track.8.brake', true);
  NOW += 0.2;
  invoke('track.8.play.quant', true);
  ok('play.quant tijdens het remmen: ook los, zoals play', dR.playing && !dR.remt && !dR.wacht);

  // Tempo tijdens het remmen: onthouden, de rem loopt door.
  invoke('track.8.brake', true);
  const P3 = dR.position;
  NOW += 0.5;
  dR.setRate(1.1);
  ok('tempo tijdens het remmen: de rem loopt gewoon door, het tempo wordt onthouden',
    dR.remt && Math.abs(dR.position - (P3 + 0.5 - 0.25 / 10)) < 1e-9 && dR.rate === 1.1);
  dR.pause();
  ok('pauze tijdens het remmen: meteen stil, rem eraf', !dR.playing && !dR.remt);
  dR.setRate(1);
  NOW = 0;
}

console.log('\nmaatgever met hysterese');
{
  const { volgMaatgever, MAAT_WACHT, MAAT_MARGE_DB } = await import('../src/engine/engine.js');
  const { Beatgrid: BG } = await import('../src/engine/beatgrid.js');
  // Nep-niveaus op een nep-klok: de regel zelf.
  const dB = (x) => Math.pow(10, x / 20);
  const st = { id: null, sinds: null };
  let r = volgMaatgever(st, [['A', dB(-10)], ['B', dB(-10)]], 0);
  ok('begin: meteen de luidste (gelijk: de eerste)', r.id === 'A' && r.wacht === null);
  let wissels = 0;
  for (let i = 0; i < 200; i++) {
    const was = st.id;
    volgMaatgever(st, [['A', dB(-10)], ['B', dB(-10 + 2 * Math.sin(i / 3))]], i * 0.05);
    if (st.id !== was) wissels++;
  }
  ok(`twee even harde tracks (±2 dB om elkaar heen, 10 s): ${wissels} wissels`, wissels === 0 && st.id === 'A');
  r = volgMaatgever(st, [['A', dB(-10)], ['B', dB(-10 + MAAT_MARGE_DB + 0.5)]], 20);
  ok(`${MAAT_MARGE_DB + 0.5} dB harder: nog niet, wacht ${MAAT_WACHT * 1000} ms`, r.id === 'A' && Math.abs(r.wacht - MAAT_WACHT) < 1e-9);
  r = volgMaatgever(st, [['A', dB(-10)], ['B', dB(-6.5)]], 20.2);
  ok('na 200 ms nog A', r.id === 'A' && Math.abs(r.wacht - 0.05) < 1e-9);
  r = volgMaatgever(st, [['A', dB(-10)], ['B', dB(-6.5)]], 20.25);
  ok('na 250 ms: B', r.id === 'B' && r.wacht === null);
  volgMaatgever(st, [['A', dB(-2)], ['B', dB(-6.5)]], 21);
  volgMaatgever(st, [['A', dB(-6)], ['B', dB(-6.5)]], 21.2);            // even niet meer 3 dB
  r = volgMaatgever(st, [['A', dB(-2)], ['B', dB(-6.5)]], 21.3);
  ok('even onder de drempel: het wachten begint opnieuw', r.id === 'B' && Math.abs(r.wacht - MAAT_WACHT) < 1e-9);
  r = volgMaatgever(st, [['A', dB(-2)], ['B', dB(-6.5)]], 21.55);
  ok('… en na 250 ms aaneen: A', r.id === 'A');
  r = volgMaatgever(st, [['B', dB(-40)]], 21.56);
  ok('maatgever stopt: meteen de volgende, ook als die zacht is', r.id === 'B' && r.wacht === null);
  r = volgMaatgever(st, [], 22);
  ok('niets speelt: geen maatgever', r.id === null);

  // In de engine: faders zijn de niveaus, de audioklok is die van de mock,
  // en de timer is echt (niemand hoeft te vragen).
  NOW = 500;
  const em = new Engine();
  for (const [id, bpm] of [['A', 124], ['B', 130], ['C', 120]]) {
    const d = em.deck(id); d.load(buf, id); d.setGrid(new BG({ bpm, firstBeat: 0 }));
  }
  em.setKant('A', 'thru'); em.setKant('B', 'thru');
  em.deck('A').play(); em.deck('B').play();
  ok('twee tracks, even hard: de eerste geeft de maat', em.snapshot().maat === 'A');
  let meldingen = 0;
  em.on('change', () => meldingen++);
  em.deck('A').set('fader', 0.94);                  // −2,7 dB
  em.deck('B').set('fader', 0.97);                  // −1,35 dB: B iets harder
  NOW += 1;
  ok('B 1,35 dB harder, een seconde lang: de maat blijft bij A', em.snapshot().maat === 'A' && em.syncMaster().id === 'A');
  ok('… en de bussen lopen op A (124 bpm)', Math.abs(em.sends.A.klok().beatLengte - 60 / 124) < 1e-9);
  const rs = em.sync('C');
  ok('sync gaat naar de maatgever (de badge), niet naar wie nét harder staat', rs.ok && rs.master === 'A');
  em.deck('C').setRate(1);
  em.deck('A').set('fader', 0.6);                   // −18 dB: B nu 16,6 dB harder
  ok('B duidelijk harder: niet meteen', em.snapshot().maat === 'A');
  NOW += 0.3;
  await new Promise((res) => setTimeout(res, 300));
  ok('na 250 ms op de audioklok: B, door de timer, en gemeld (bussen haken aan)',
    em._maat.id === 'B' && meldingen > 0 && Math.abs(em.sends.A.klok().beatLengte - 60 / 130) < 1e-9);
  em.deck('B').pause();
  ok('maatgever pauzeert: meteen de ander', em.snapshot().maat === 'A');
  em.deck('B').play();
  NOW += 0.3;
  ok('B speelt weer en is harder: na 250 ms weer B', em.snapshot().maat === 'B');
  em.deck('B').rem();
  ok('maatgever remt: meteen de ander (een remmende track geeft geen maat)', em.snapshot().maat === 'A');
  // Sync op de track die remt: alleen het tempo. De fase zetten is een
  // sprong, en die haalde de rem eraf: de track stond dan meteen weer op
  // volle snelheid.
  const pB = em.deck('B').position;
  const rsRem = em.sync('B');
  ok('sync tijdens het remmen: alleen het tempo, de rem loopt door', rsRem.ok && !rsRem.fase && rsRem.master === 'A'
    && em.deck('B').remt && Math.abs(em.deck('B').rate - 124 / 130) < 1e-9 && em.deck('B').position === pB);
  em.deck('B').pause(); em.deck('A').pause();
  ok('niets speelt: MAAT (stil) op de eerste met grid, zoals altijd', em.snapshot().maat === 'A' && !em.deck('A').playing);
  // De terugval (VERBETERINGEN ronde 4): ook als laatste redmiddel geeft een
  // remmende track geen maat en geen tempo. Alleen B speelt, en die remt.
  em.deck('B').setRemTijd(1);                       // 5 s
  em.deck('B').play();
  em.deck('B').rem();
  ok('alleen een remmende track: hij is ook geen terugval (de eerste geladen die niet remt)',
    em.deck('B').remt && em.syncMaster('A')?.id === 'C');
  const rsTerug = em.sync('A');
  ok('… en sync van track 1 neemt het tempo van track 3, niet van de remmende',
    rsTerug.ok && rsTerug.master === 'C' && Math.abs(em.deck('A').rate - 120 / 124) < 1e-9);
  em.deck('B').pause(); em.deck('A').setRate(1);
  NOW = 0;
}

// ---- toetsenbord ------------------------------------------------------------
// Spatie wees na de hernoeming naar deck.* nog naar een naam die niet meer
// bestond, en niemand merkte het. Nu staat het vast.

console.log('\ntoetsenbord');
{
  const { attachKeyboard, KEYMAP } = await import('../src/control/keyboard.js');
  const handlers = {};
  const oudWindow = globalThis.window;
  globalThis.window = { addEventListener: (t, f) => { handlers[t] = f; } };
  const toets = (code, type = 'keydown') => handlers[type]({
    code, shiftKey: false, target: { matches: () => false }, preventDefault() {} });

  const vensters = { L: 'C', R: 'B' };
  attachKeyboard(eng, { venster: (v) => vensters[v] });
  globalThis.window = oudWindow;

  const ids = new Set(list().map((a) => a.id));
  const onbekend = Object.values(KEYMAP)
    .map((id) => id.replace('{L}', '3').replace('{R}', '2'))
    .filter((id) => !ids.has(id));
  ok('elke toets wijst naar een bestaande action', onbekend.length === 0);

  const dC = eng.deck('C');
  dC.load(buf, 'toets');
  const voor = dC.playing;
  toets('KeyQ'); toets('KeyQ', 'keyup');
  ok('Q speelt de track in het linkervenster', dC.playing !== voor);
  toets('KeyQ'); toets('KeyQ', 'keyup');

  eng.setFocus('C');
  const voorSpatie = dC.playing;
  toets('Space');
  ok('spatie speelt de track met focus', dC.playing !== voorSpatie);
  if (dC.playing) toets('Space');

  // Rem op de toets links van 1 (Backquote, op een Mac-ISO-toetsenbord soms
  // IntlBackslash): linkerhand = focus. Nog eens = los.
  toets('KeyQ'); toets('KeyQ', 'keyup');
  toets('Backquote'); toets('Backquote', 'keyup');
  ok('` remt de track in het linkervenster', dC.remt);
  toets('IntlBackslash'); toets('IntlBackslash', 'keyup');
  ok('nog eens (ook via IntlBackslash): los, speelt door', !dC.remt && dC.playing);
  ok('= remt de rechterhand', KEYMAP.Equal === 'track.{R}.brake');
  dC.pause();
}

{
  // Twee keer snel wisselen, 10 ms na elkaar, zoals live: de eerste kruisfade
  // (40 ms) loopt dan nog. In Chrome gooit dat als de code het niet opvangt.
  const sf = eng.deck('C').fx;
  let gegooid = null;
  try {
    NOW = 50; sf.zetEffect('filter');
    NOW = 50.01; sf.zetEffect('phaser');
    NOW = 50.02; sf.setMix(0.7); sf.setBypass(true); sf.setBypass(false);
    NOW = 50.025; sf.zetEffect('crush');
  } catch (e) { gegooid = e; }
  ok(`snel wisselen midden in een kruisfade gooit niet${gegooid ? ': ' + gegooid.message : ''}`, gegooid === null);
  NOW = 0;
}

{
  // De kruisfade zelf, zoals Chrome hem ziet. Met setValueCurveAtTime + een
  // cancelAndHoldAtTime erin (mixdraai of tweede wissel binnen 40 ms) speelde
  // Chrome 153 de afgekapte curve opnieuw af: een sprong van 0,15–0,52 in de
  // gain. Nu een beginpunt en lineaire hellingen, pas na de startdrempel.
  const { startDrempel } = await import('../src/engine/overgang.js');
  const { FADE } = await import('../src/engine/fx.js');
  const sf = eng.deck('C').fx, ctx = sf.ctx, W = startDrempel(ctx);
  const breuk0 = CURVE_BREUK, fouten0 = OVERLAP_FOUTEN;
  const log = new Map();          // gain-param -> aanroepen
  const maak = ctx.createGain;
  ctx.createGain = function () {
    const n = maak.call(this), p = n.gain, l = [];
    log.set(p, l);
    for (const f of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelAndHoldAtTime']) {
      const orig = p[f];
      p[f] = function (...a) { l.push([f, ...a]); return orig.apply(this, a); };
    }
    return n;
  };
  NOW = 60; sf.setMix(0.6); sf.standaard();
  const D = sf.keten.gain.gain;
  NOW = 61; sf.zetEffect('filter');
  const F = sf.keten.gain.gain;
  const wet = Math.sin(0.6 * Math.PI / 2);
  const zet = log.get(F).filter(([f]) => f === 'setValueAtTime'), hel = log.get(F).filter(([f]) => f === 'linearRampToValueAtTime');
  const ep = (i) => wet * Math.sin(i / 32 * Math.PI / 2);
  ok(`effectwissel: nieuwe keten van 0 naar nat met een beginpunt en 32 hellingen, pas na de startdrempel (${(W * 1000).toFixed(1)} ms)`,
    zet.length === 2 && zet[0][1] === 0 && zet[0][2] === 61 && zet[1][1] === 0 && Math.abs(zet[1][2] - (61 + W)) < 1e-9
    && hel.length === 32 && Math.abs(hel[31][2] - (61 + W + FADE)) < 1e-9 && Math.abs(hel[31][1] - wet) < 1e-12);
  ok('… equal-power: elk punt op sin, dezelfde vorm als de oude curve',
    hel.every(([, x, t], k) => Math.abs(x - ep(k + 1)) < 1e-9 && Math.abs(t - (61 + W + FADE * (k + 1) / 32)) < 1e-9));
  const uit = log.get(D).filter(([f, , t]) => f === 'linearRampToValueAtTime' && t > 61);
  ok('… de oude keten naar 0, ook als hellingen en ook pas na de drempel',
    uit.length === 32 && uit[31][1] === 0 && Math.abs(uit[0][2] - (61 + W + FADE / 32)) < 1e-9);
  NOW = 61 + W + 0.005;
  sf.setMix(0.9);
  ok('5 ms in de kruisfade aan de mix draaien: vasthouden midden in een HELLING, geen afgebroken curve',
    CURVE_BREUK === breuk0 && OVERLAP_FOUTEN === fouten0 && log.get(F).at(-1)[0] === 'setTargetAtTime'
    && log.get(F).at(-2)[0] === 'cancelAndHoldAtTime' && log.get(F).at(-2)[1] === NOW);
  NOW = 61 + W + 0.010;
  sf.zetEffect('phaser');
  ok('10 ms in de kruisfade nog een wissel: geen afgebroken curve, de vorige vloeit vanaf daar uit',
    CURVE_BREUK === breuk0 && OVERLAP_FOUTEN === fouten0
    && log.get(F).filter(([f]) => f === 'linearRampToValueAtTime').at(-1)[1] === 0);
  ok('nergens een setValueCurveAtTime op een kruisfade', [...log.values()].every((l) => l.every(([f]) => f !== 'setValueCurveAtTime')));
  delete ctx.createGain;
  NOW = 0;
}

// ---- tempokaart: grid in stukken (stap B) -----------------------------------
// Alles wat met het grid rekent, moet dat doen op de plek waar het deck NU is.

console.log('\ntempokaart');
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  NOW = 200;
  const et = new Engine();
  const A = et.deck('A'), B = et.deck('B');
  A.load(buf, 'kaart'); B.load(buf, 'vast');
  // 120 bpm, vanaf 2,0 s 150 bpm met een tel op 2,1. Tellen: … 1,0 · 1,5 · 2,1 · 2,5 · 2,9 …
  const kaart = () => new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 2.0, bpm: 150, anker: 2.1 }] });
  A.setGrid(kaart());
  B.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));

  A.seek(1.0);
  ok('deck.bpm in het eerste stuk', Math.abs(A.bpm - 120) < 1e-9);
  A.seek(2.6);
  ok('deck.bpm in het tweede stuk', Math.abs(A.bpm - 150) < 1e-9);

  // Sync naar een master die in het tweede stuk staat: 150, niet 120.
  let r = et.sync('B');
  ok('sync neemt het tempo van waar de master NU is', r.ok && Math.abs(B.rate - 150 / 120) < 1e-9);
  // Fase over de grens: beide spelend, daarna geen faseverschil.
  A.seek(2.2); B.setRate(1); B.seek(1.07);
  A.play(); B.play();
  r = et.sync('B');
  ok('fase gezet met de tellengte van hier', r.fase === true && Math.abs(et.faseVerschil('B')) < 1e-6);
  ok('verschoven binnen een halve tel van B', Math.abs(r.verschoven) <= 0.25 + 1e-9);
  B.stop();

  // fxKlok vlak voor de grens: de volgende tel is 2,1 en DIE duurt 0,4 s.
  A.seek(1.6);
  let k = A.fxKlok();
  ok('fxKlok: volgende tel ligt in het nieuwe stuk', Math.abs(k.ankerCtx - A.ctxTimeOf(2.1)) < 1e-9);
  ok('fxKlok: tellengte van het stuk waar je heen gaat', Math.abs(k.beatLengte - 0.4) < 1e-9);
  A.seek(1.2);
  k = A.fxKlok();
  ok('fxKlok: de overgangstel (1,5 → 2,1) is 0,6 lang', Math.abs(k.beatLengte - 0.6) < 1e-9);
  ok('herankeren bij de tempowissel staat klaar', A._wisselTimer != null);
  A.setGrid(new Beatgrid({ bpm: 120 }));
  ok('met één stuk geen wisseltimer', A._wisselTimer == null);
  A.setGrid(kaart());
  A.stop();

  // Beat-loop over de grens: 4 tellen vanaf 1,0 = 1,0 · 1,5 · 2,1 · 2,5 → einde 2,9.
  A.seek(1.0);
  ok('beat-loop over een stukgrens telt tellen, geen seconden',
    A.setBeatLoop(4) && Math.abs(A.loop.start - 1.0) < 1e-9 && Math.abs(A.loop.end - 2.9) < 1e-9 && A.loopBeats === 4);
  A.clearLoop();

  // Sampler: 2 tellen eindigend op 2,5 → van 1,5 (overgangstel erin), tempo gemiddeld.
  const { knipBereik } = await import('../src/engine/sampler.js');
  const kb = knipBereik(A.grid, 2.6, 2);
  ok('knippen over een grens: van en tot op tellen', Math.abs(kb.van - 1.5) < 1e-9 && Math.abs(kb.tot - 2.5) < 1e-9 && kb.tellen === 2);
  ok('en het tempo is wat de sample echt doet', Math.abs(kb.bpm - 120) < 1e-9);
  const kb2 = knipBereik(A.grid, 3.5, 2);
  ok('binnen één stuk: het tempo van dat stuk', kb2.bpm === 150);
  NOW = 0;
}

// Bewerken via de bus: alleen het stuk waar de speelkop staat.
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const dE = eng.deck('E');
  dE.load(buf, 'bewerk');
  dE.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  dE.seek(2.0);
  invoke('track.5.grid.split', true);
  ok('grid.split maakt een stuk vanaf hier', dE.grid.aantalStukken === 2 && dE.grid.stukken[1].van === 2.0);
  ok('en dat verandert niets hoorbaars', Math.abs(dE.grid.nearest(3.01) - 3.0) < 1e-9);
  dE.seek(3.0);
  invoke('track.5.grid.double', true);
  ok('×2 raakt alleen het stuk waar je bent', dE.grid.bpmAt(3) === 240 && dE.grid.bpmAt(1) === 120);
  invoke('track.5.grid.fwd', true);
  ok('schuiven ook', Math.abs(dE.grid.nearest(3.01) - 3.005) < 1e-9 && Math.abs(dE.grid.nearest(1.01) - 1.0) < 1e-9);
  dE.seek(0.5);
  invoke('track.5.grid.here', true);
  ok('tel hier in het eerste stuk laat het tweede staan', dE.grid.bpmAt(3) === 240 && Math.abs(dE.grid.nearest(3.01) - 3.005) < 1e-9);
  ok('slot staat nog uit na bewerken', dE.grid.slot === false && read('track.5.grid.lock') === 0);
  invoke('track.5.grid.lock', true);
  ok('grid.lock zet hem op slot', dE.grid.slot === true && read('track.5.grid.lock') === 1);
  invoke('track.5.grid.lock', true);
  ok('en weer eraf', dE.grid.slot === false);
  dE.seek(3.0);
  invoke('track.5.grid.merge', true);
  ok('grid.merge voegt samen met het vorige', dE.grid.aantalStukken === 1 && dE.grid.bpmAt(3) === 120);
  invoke('track.5.grid.merge', true);
  ok('het eerste stuk samenvoegen doet niets', dE.grid.aantalStukken === 1);

  // Tap op een lopende track met twee stukken: alleen het stuk waar je tikt.
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 1.5, bpm: 120, anker: 0 }] }));
  NOW = 300;
  dE.seek(1.6); dE.play();
  let tapInfo = null;
  const opTap = (x) => { tapInfo = x; };
  eng.on('tap', opTap);
  const echtNu = performance.now;
  for (let i = 0; i < 5; i++) {
    performance.now = () => (NOW - 300) * 1000;
    invoke('track.5.tap', true); invoke('track.5.tap', false);
    NOW += 0.4;                                  // 150 bpm, track op 1x
  }
  performance.now = echtNu;
  eng.off?.('tap', opTap);
  ok('tap zet het stuk waar je tikte', Math.abs(dE.grid.bpmAt(2.5) - 150) < 0.01);
  ok('en laat het stuk ervoor staan', dE.grid.bpmAt(1) === 120);
  ok('vier of meer tikken: op slot', dE.grid.slot === true);
  ok('tap-event draagt anker en tracktijden', tapInfo && tapInfo.tijden.length === 5 && Math.abs(tapInfo.anker - 3.2) < 1e-6);
  dE.stop();
  NOW = 0;
}

// 5 okt (docs/BEATGRID.md §10): een bewerking met de hand bevestigt het stuk en
// kan terug; vastzetten (pin) haalt drift weg, ook op een aangewezen plek.
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const dE = eng.deck('E');
  dE.load(buf, 'bevestig');
  dE.onsets = null;
  const meld = [];
  const opMeld = (m) => meld.push(m);
  eng.on('melding', opMeld);
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.4 }] }));
  dE.seek(1.0);
  ok('vooraf onzeker (sync en beat-loops weigeren)', dE.gridZekerHier === false);
  invoke('track.5.grid.fwd', true);
  ok('grid 5 ms vooruit BEVESTIGT het stuk: nu zeker', dE.gridZekerHier === true);
  ok('… en kan terug (lampje: er is iets terug te zetten)', dE.kanGridTerug && read('track.5.grid.undo') === 0.5);
  invoke('track.5.grid.undo', true); invoke('track.5.grid.undo', false);
  ok('terug: het grid van vóór (niet geschoven, weer onzeker)', Math.abs(dE.grid.nearest(1.01) - 1.0) < 1e-9 && dE.gridZekerHier === false
    && !dE.kanGridTerug);
  invoke('track.5.grid.undo', true); invoke('track.5.grid.undo', false);
  ok('niets meer terug: dat zegt een melding', /niets om terug te zetten/.test(meld.at(-1)?.tekst ?? ''));
  dE.seek(0);
  invoke('track.5.grid.bar', true); invoke('track.5.grid.bar', false);
  ok('1→: de "1" een tel later, de tellen liggen er nog', dE.grid.telInMaat(0.5) === 1 && dE.grid.telInMaat(0) === 4
    && Math.abs(dE.grid.nearest(0.51) - 0.5) < 1e-9);

  // Een plaat op 121 bpm, het grid op 120: vast op tel 7.
  const L = 60 / 121;
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.4 }] }));
  dE.seek(7 * L);
  invoke('track.5.grid.pin', true); invoke('track.5.grid.pin', false);
  ok(`vast: 121 bpm over 7 tellen, met een melding ("${meld.at(-1)?.tekst.slice(0, 60)}…")`, Math.abs(dE.grid.bpmAt(0.5) - 121) < 1e-6
    && /vastgezet — 121,00 bpm \(was 120,00\) over 7 tellen/.test(meld.at(-1)?.tekst ?? '') && dE.gridZekerHier === true);
  invoke('track.5.grid.undo', true);
  ok('… en terug: weer 120 en één stuk', dE.grid.bpmAt(0.5) === 120 && dE.grid.aantalStukken === 1);
  invoke('track.5.grid.pin.op', (7 * L) / dE.duration);
  ok('vast op een aangewezen plek (klik in de golfvorm): hetzelfde', Math.abs(dE.grid.bpmAt(0.5) - 121) < 1e-6);
  invoke('track.5.grid.here.op', 0.3 / dE.duration);
  ok('tel 1 op een aangewezen plek', Math.abs(dE.grid.stukken[0].anker - 0.3) < 1e-9 && dE.grid.telInMaat(0.3) === 1);
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }] }));
  invoke('track.5.grid.pin.op', (5.45 * 0.5) / dE.duration);
  ok('een pin die niet kan (0,45 tel naast): een foutmelding met waarom, grid onveranderd', meld.at(-1)?.soort === 'fout'
    && /naast/.test(meld.at(-1)?.tekst ?? '') && dE.grid.bpm === 120 && dE.grid.aantalStukken === 1);

  // Tikken kan terug: de reeks als één stap, terug naar het grid van vóór de eerste tik.
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 100, anker: 0 }] }));
  NOW = 330;                                   // ruim na de tikken hierboven: een nieuwe reeks
  dE.seek(0.5); dE.play();
  const echtNu = performance.now;
  for (let i = 0; i < 4; i++) {
    performance.now = () => (NOW - 300) * 1000;
    invoke('track.5.tap', true); invoke('track.5.tap', false);
    NOW += 0.5;
  }
  performance.now = echtNu;
  dE.stop();
  ok('vier tikken: 120 bpm', Math.abs(dE.grid.bpmAt(1) - 120) < 0.01);
  invoke('track.5.grid.undo', true);
  ok('terug: het grid van vóór de tikken (100 bpm), in één stap', dE.grid.bpmAt(1) === 100);
  NOW = 0;
  eng.off?.('melding', opMeld);
}

// 6 okt (docs/BEATGRID.md §11): het grid CONTROLEREN met een tik op de tellen,
// stuk voor stuk; ✓ keurt goed en gaat door, alles goed = op slot.
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const dE = eng.deck('E');
  dE.load(buf, 'controle');
  const meld = [];
  const opMeld = (m) => meld.push(m);
  eng.on('melding', opMeld);
  // Drie stukken; het tweede twijfelt (de demotrack duurt 3,9 s).
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 },
    { van: 1.25, bpm: 120, anker: 1.5, zekerheid: 0.6, twijfel: 'oneens' }, { van: 2.75, bpm: 120, anker: 3, zekerheid: 0.9 }] }));
  dE.seek(0);
  ok('controle uit: read 0', read('track.5.grid.controle') === 0 && eng.gridControleDeck === null);
  invoke('track.5.grid.controle', true); invoke('track.5.grid.controle', false);
  ok('controle aan: dit deck, en het speelt vanaf het stuk dat twijfelt', eng.gridControleDeck === 'E' && read('track.5.grid.controle') === 1
    && dE.playing && dE.grid.stukIndex(dE.position) === 1);
  ok('… met een melding hoeveel er te controleren is', /1 plek om te controleren/.test(meld.at(-1)?.tekst ?? ''));
  ok('de klik loopt op dit deck', eng.gridKlik.aan && eng.gridKlik.deck === dE);
  ok('in de snapshot', eng.snapshot().gridControle === 'E');
  // De klik plant tikken op de audioklok, op de gridlijnen: de eerste tel van het stuk (1,5) ligt 0,2 s verder.
  const NOW1 = NOW;
  NOW += 0.1;
  eng.gridKlik._plan();
  const tik = eng.gridKlik._gepland[0];
  ok('een tik ingepland op de audioklok, op een gridlijn (de eerste tel van het stuk)', !!tik && Math.abs(tik.op - dE.ctxTimeOf(1.5)) < 1e-6
    && eng.gridKlik._gepland.length === 1);
  eng.gridKlik._plan();
  ok('nog eens plannen: niet dubbel', eng.gridKlik._gepland.length === 1);
  NOW = NOW1;
  invoke('track.5.grid.ok', true); invoke('track.5.grid.ok', false);
  ok('✓: het laatste te controleren stuk goedgekeurd → alles gecontroleerd, op slot, controle uit', dE.grid.slot === true
    && eng.gridControleDeck === null && dE.grid.stukken[1].ok === true && !dE.grid.stukken[1].twijfel
    && /alles gecontroleerd/.test(meld.at(-1)?.tekst ?? ''));
  ok('… en kan terug', dE.kanGridTerug);
  ok('de klik is uit', !eng.gridKlik.aan && eng.gridKlik._gepland.length === 0);

  // Alles ziet er goed uit: dan loop je ALLE stukken langs.
  dE.stop();
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }, { van: 2, bpm: 120, anker: 2.25, zekerheid: 0.9 }] }));
  dE.seek(0);
  invoke('track.5.grid.controle', true);
  ok('niets om te controleren: je luistert alles na', /alles lijkt te kloppen/.test(meld.at(-1)?.tekst ?? ''));
  // De twee stukken liggen aan elkaar: één plek. ✓ in het eerste = "klopt tot hier", en je luistert door.
  const was = dE.position;
  invoke('track.5.grid.ok', true);
  ok('✓ halverwege een plek: tot hier goedgekeurd, geen sprong, doorluisteren', dE.grid.stukken[0].ok && !dE.grid.stukken[1].ok
    && !dE.grid.slot && Math.abs(dE.position - was) < 0.01 && /luister door/.test(meld.at(-1)?.tekst ?? ''));
  invoke('track.5.grid.check.next', true);
  ok('▶: naar de volgende plek (rondom: de rest van deze)', dE.grid.stukIndex(dE.position) === 1 && /plek 1 van 1/.test(meld.at(-1)?.tekst ?? ''));
  dE.seek(2.3, { doorlopend: true });
  invoke('track.5.grid.ok', true);
  ok('✓ aan het eind: alles gecontroleerd, op slot', dE.grid.slot === true && eng.gridControleDeck === null);
  // Een bewerking na het goedkeuren haalt het "ok" weg: dan is het een ander grid.
  dE.grid.slot = false;
  dE.seek(0.3);
  invoke('track.5.grid.fwd', true);
  ok('een bewerking na ✓: het stuk is niet meer "door jou gecontroleerd"', !dE.grid.stukken[0].ok);
  // Een nieuw nummer laden zet de controle uit.
  invoke('track.5.grid.controle', true);
  dE.load(buf, 'ander');
  ok('nieuw nummer: controle uit', eng.gridControleDeck === null && !eng.gridKlik.aan);
  dE.stop();
  eng.off?.('melding', opMeld);
}

// 6 okt: een eigen toon per stem (bovenop de toon van de track; het tempo blijft).
{
  const dT = eng.deck('E');
  dT.load(buf, 'stemtoon');
  const naar = [];
  const echtRek = dT.bron.zetRek;
  dT.bron.zetRek = (r) => naar.push(r);
  dT.setStemToon('vocals', 3);
  ok('zonder stems: geen toon per stem (read null, niets naar de bron)', dT.stemToon('vocals') === null && naar.length === 0
    && read('track.5.stem.vocals.transpose') === null);
  dT._zetStems({ namen: ['drums', 'bass', 'other', 'vocals'], schaal: 1 });
  invoke('track.5.stem.vocals.transpose.up', true); invoke('track.5.stem.vocals.transpose.up', true); invoke('track.5.stem.vocals.transpose.up', true);
  ok('zang 3× hoger: +3, per paar naar de bron (drums · bas · overig · zang)', dT.stemToon('vocals') === 3
    && JSON.stringify(naar.at(-1)?.stems) === '[0,0,0,3]' && naar.at(-1).toon === 0);
  ok('read: 0,5 + 3/24, en het lampje van hoger brandt', Math.abs(read('track.5.stem.vocals.transpose') - 15 / 24) < 1e-9
    && read('track.5.stem.vocals.transpose.up') === 1 && read('track.5.stem.vocals.transpose.reset') === 1);
  invoke('track.5.stem.inst.transpose', 10 / 24);
  ok('de groep (inst) −2: telt op bij drums, bas en overig, niet bij de zang', dT.stemToon('inst') === -2
    && JSON.stringify(naar.at(-1).stems) === '[-2,-2,-2,3]');
  dT.setStemToon('drums', 40);
  ok('hooguit +12 per stem', dT.stemToon('drums') === 12);
  dT.setTranspositie(2);
  ok('de toon van de track verandert: de stems gaan mee in hetzelfde bericht', naar.at(-1).toon === 2 && JSON.stringify(naar.at(-1).stems) === '[10,-2,-2,3]');
  ok('de stand van de stems zegt het', JSON.stringify(dT.stemStand().toon) === JSON.stringify({ vocals: 3, inst: -2, drums: 12, bass: 0, other: 0 }));
  for (const st of ['vocals', 'inst', 'drums']) invoke(`track.5.stem.${st}.transpose.reset`, true);
  ok('alles terug op 0: geen toon per stem meer (null naar de bron)', naar.at(-1).stems === null && dT.stemToon('vocals') === 0);
  dT.setStemToon('vocals', -5);
  dT._zetStems({ namen: ['vocals', 'inst'], schaal: 1 });
  ok('een nieuw nummer: de toon per stem terug naar 0 (hoort bij het nummer)', dT.stemToon('vocals') === 0 && naar.at(-1).stems === null);
  dT.setStemToon('inst', 5);
  ok('twee stems: de rest is één paar (geen dubbele optelling)', JSON.stringify(naar.at(-1).stems) === '[0,5]'
    && read('track.5.stem.drums.transpose') === null);
  dT._zetStems(null);
  dT.setTranspositie(0);
  dT.bron.zetRek = echtRek;
}

// Stap D: grid-modus op de APC. Tel 1 hier snapt naar een klap, halve tel,
// fijn schuiven en bpm per stuk — via de echte mapping, shift en mapjes.
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const { Mapping } = await import('../src/control/mapping.js');
  const { Lagen } = await import('../src/control/lagen.js');
  const { bindLagen } = await import('../src/control/actions.js');
  const { readFileSync } = await import('node:fs');
  const dE = eng.deck('E');
  dE.load(buf, 'gridmodus');
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 2, bpm: 120, anker: 0 }] }));
  dE.onsets = new Float64Array([0.49, 3.012, 3.6]);   // de demotrack duurt 3,9 s
  dE.seek(3.0);
  invoke('track.5.grid.here', true);
  ok('grid.here snapt naar de klap binnen 30 ms (3,012)', Math.abs(dE.grid.stukken[1].anker - 3.012) < 1e-9);
  ok('en laat het andere stuk staan', dE.grid.stukken[0].anker === 0);
  dE.seek(3.65);
  invoke('track.5.grid.here', true);
  ok('grid.here: klap 50 ms eerder telt niet, de positie wordt de tel', Math.abs(dE.grid.stukken[1].anker - 3.65) < 1e-9);
  dE.onsets = null;
  dE.seek(3.1);
  invoke('track.5.grid.here', true);
  ok('grid.here zonder onsets: de positie zelf', Math.abs(dE.grid.stukken[1].anker - 3.1) < 1e-9);

  // Speelt hij, dan is "hier" wat je HOORT: positie min uitgangsvertraging × rate.
  // Die vertraging is baseLatency plus de vooruitblik van de master-limiter
  // (hier, zonder worklet, die van de compressor: 6 ms; docs/MASTER.md).
  NOW = 500;
  dE.seek(3.2); dE.setRate(1.25); dE.play();
  const hoor = dE.position - (eng.ctx.baseLatency + eng.ctx.graafVertraging) * 1.25;
  invoke('track.5.grid.here', true);
  ok('grid.here tijdens spelen: de hoorbare positie, niet de deckpositie',
    Math.abs(dE.grid.stukken[1].anker - hoor) < 1e-9 && eng.ctx.baseLatency > 0);
  dE.stop(); dE.setRate(1); NOW = 0;

  dE.seek(3.1);
  const a0 = dE.grid.stukken[1].anker;
  invoke('track.5.grid.halfbeat', true);
  ok('halve tel: +0,25 s op 120 bpm, alleen dit stuk', Math.abs(dE.grid.stukken[1].anker - (a0 + 0.25)) < 1e-9 && dE.grid.stukken[0].anker === 0);
  invoke('track.5.grid.fwd.fine', true);
  ok('fijn vooruit: +1 ms', Math.abs(dE.grid.stukken[1].anker - (a0 + 0.251)) < 1e-9);
  invoke('track.5.grid.back.fine', true); invoke('track.5.grid.back.fine', true);
  ok('fijn terug: −1 ms', Math.abs(dE.grid.stukken[1].anker - (a0 + 0.249)) < 1e-9);

  // bpm per stuk, als value 0..1 over 40–300 bpm (regel 2).
  const r0 = read('track.5.grid.bpm');
  ok('grid.bpm-read: 120 bpm = (120 − 40) / 260', Math.abs(r0 - 80 / 260) < 1e-12);
  const telVoor = dE.grid.nearest(3.1);
  invoke('track.5.grid.bpm', r0 + 0.01 / 260);
  ok('grid.bpm: +0,01 bpm op het stuk rond de positie', Math.abs(dE.grid.bpmAt(3.1) - 120.01) < 1e-9);
  ok('... niet op het stuk ervoor', dE.grid.bpmAt(1) === 120);
  ok('... en de tel bij de positie blijft liggen', Math.abs(dE.grid.nearest(3.1) - telVoor) < 1e-9);
  dE.setGrid(null);
  invoke('track.5.grid.bpm', 0.9);
  ok('grid.bpm zonder grid doet niets (en read = null)', dE.grid === null && read('track.5.grid.bpm') === null);

  // De hele keten: APC-mapping, shift, mapje edit.aan, focus op track 5.
  dE.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 2, bpm: 128, anker: 2 }] }));
  const lg = new Lagen();
  bindLagen(lg);
  const m = new Mapping({ read, invoke, vars: () => ({ focus: 5 }), lagen: () => lg.actief() });
  m.load(JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8')));
  const nt = (n, on) => m.handle({ type: 'note', channel: 0, number: n, sig: `note:0:${n}`, on, value: on ? 127 : 0, norm: on ? 1 : 0 });
  const enc = (v) => m.handle({ type: 'cc', channel: 0, number: 47, sig: 'cc:0:47', value: v, norm: v / 127 });
  const curve0 = eng.xfaderCurve;
  nt(90, true); nt(90, false);
  ok('Metronome zonder shift: crossfadercurve, geen grid-modus', eng.xfaderCurve !== curve0 && lg.stand.edit === 'uit');
  nt(98, true); nt(90, true); nt(90, false); nt(98, false);
  ok('Shift + Metronome: grid-modus aan', lg.stand.edit === 'aan' && read('layer.edit.toggle') === 1);
  dE.seek(3.0);
  enc(1);
  ok('cue level in grid-modus: +0,01 bpm op het stuk', Math.abs(dE.grid.bpmAt(3) - 128.01) < 1e-9 && dE.grid.bpmAt(1) === 120);
  nt(98, true); enc(127); nt(98, false);
  ok('cue level + shift: −0,1 bpm', Math.abs(dE.grid.bpmAt(3) - 127.91) < 1e-9);
  const b0 = dE.grid.bpmAt(3);
  nt(83, true); nt(83, false);
  ok('scene 2 in grid-modus: ×2', Math.abs(dE.grid.bpmAt(3) - b0 * 2) < 1e-9);
  nt(84, true); nt(84, false);
  ok('scene 3: ½', Math.abs(dE.grid.bpmAt(3) - b0) < 1e-9);
  const a1 = dE.grid.stukken[1].anker;
  nt(101, true); nt(101, false);
  ok('nudge + in grid-modus: grid +5 ms (geen bend)', Math.abs(dE.grid.stukken[1].anker - (a1 + 0.005)) < 1e-9 && !dE.buigt);
  nt(98, true); nt(100, true); nt(100, false); nt(98, false);
  ok('shift + nudge −: grid −1 ms', Math.abs(dE.grid.stukken[1].anker - (a1 + 0.004)) < 1e-9);
  nt(86, true); nt(86, false);
  ok('scene 5: nieuw stuk hier', dE.grid.aantalStukken === 3);
  nt(63, true); nt(63, false);
  ok('Device Lock in grid-modus: grid op slot', dE.grid.slot === true);
  dE.onsets = new Float64Array([3.52]);
  dE.seek(3.5);
  nt(82, true); nt(82, false);
  ok('scene 1: tel 1 hier, gesnapt', Math.abs(dE.grid.stukken[2].anker - 3.52) < 1e-9);
  // En die tel is de "1" van de maat in dat stuk (maat-anker, 25 sep): het lampje knippert daar lang.
  ok('scene 1: de gesnapte tel is de "1" van de maat', dE.grid.isDownbeat(3.52) && dE.grid.telInMaat(3.53) === 1
    && dE.grid.telInMaat(3.52 + 60 / dE.grid.bpmAt(3.52)) === 2);
  dE.onsets = null;

  nt(98, true); nt(90, true); nt(90, false); nt(98, false);
  ok('Shift + Metronome nog eens: grid-modus uit', lg.stand.edit === 'uit');
  const g0 = JSON.stringify(dE.grid.toJSON());
  const kopVol = eng.koptelefoon.niveau, samplerVol = read('sampler.volume');
  enc(1);
  nt(101, true);
  ok('buiten grid-modus: nudge + is weer bend', dE.buigt > 0);
  nt(101, false);
  nt(82, true); nt(82, false); nt(63, true); nt(63, false);
  ok('buiten grid-modus: scene 1 kiest hotcues, lock doet niets aan het grid',
    lg.stand.grid === 'hotcues' && JSON.stringify(dE.grid.toJSON()) === g0);
  ok('buiten grid-modus: cue level is weer het koptelefoonvolume (sinds 5 okt), het sampler-volume blijft staan',
    eng.koptelefoon.niveau !== kopVol && read('sampler.volume') === samplerVol);
  dE.setGrid(null);
}

// ---- hotcues per nummer: het deck meldt, de app bewaart ----------------------
// Het deck kent geen library (regel 1). Het meldt 'hotcue' bij zetten en
// wissen; terugzetten na het laden gaat via restoreHotcues, dat NIETS meldt
// (anders zou terugzetten weer bewaren) en alleen lege plekken vult.
{
  const dH = eng.deck('H');
  dH.load(buf, 'hotcues');
  const meldingen = [];
  const uit = dH.on('hotcue', (m) => meldingen.push(m));
  dH.seek(1.25);
  invoke('track.8.hotcue.2', true);
  ok('zetten meldt { i, tijd }', meldingen.length === 1 && meldingen[0].i === 1 && Math.abs(meldingen[0].tijd - 1.25) < 1e-9);
  dH.seek(0.5);
  invoke('track.8.hotcue.2', true);
  ok('springen naar een hotcue meldt niets', meldingen.length === 1 && Math.abs(dH.position - 1.25) < 1e-9);
  invoke('track.8.hotcue.2.delete', true);
  ok('wissen meldt tijd null', meldingen.length === 2 && meldingen[1].i === 1 && meldingen[1].tijd === null && dH.hotcues[1] === null);
  invoke('track.8.hotcue.2.delete', true);
  ok('wissen wat er niet is meldt niets', meldingen.length === 2);

  dH.seek(2);
  invoke('track.8.hotcue.1', true);
  meldingen.length = 0;
  let veranderd = 0;
  const uitC = dH.on('change', () => veranderd++);
  const gezet = dH.restoreHotcues([0.1, 1.5, buf.duration + 1, 'x']);
  ok('terugzetten vult alleen lege plekken (wat je al zette wint)', dH.hotcues[0] === 2 && dH.hotcues[1] === 1.5);
  ok('tijden buiten de track of geen getal: overgeslagen', dH.hotcues[2] === null && dH.hotcues[3] === null
    && JSON.stringify(gezet) === '[1]');
  ok('terugzetten meldt geen hotcue (anders bewaart de app wat hij net ophaalde), wel een change',
    meldingen.length === 0 && veranderd === 1);
  ok('niets terug te zetten: geen change', dH.restoreHotcues([null, null]).length === 0 && veranderd === 1);
  uitC();
  dH.load(buf, 'volgende');
  ok('laden wist ze zonder te melden (het nummer is weg, niet de hotcue)', meldingen.length === 0 && dH.hotcues.every((h) => h === null));
  const leeg = new (eng.deck('H').constructor)(eng.ctx, 'X');
  ok('zonder track: terugzetten doet niets', leeg.restoreHotcues([1]).length === 0);
  uit();
}

// ---- de opslag van de app: bewaren bij het nummer, terugzetten bij laden ----
// Met een nagebouwde server die net zo streng is als de echte (404 voor een
// onbekend nummer, 400 voor onzin) en ASYNCHROON antwoordt, met een POST die
// trager is dan een DELETE: zonder rij kwam "zetten + meteen wissen" in
// omgekeerde volgorde aan en stond de hotcue er de volgende keer weer.
{
  const { opzetHotcueOpslag } = await import('../src/ui/hotcue-opslag.js');
  const db = new Map([['nummer1', new Map([[1, 0.5], [3, 2.0]])], ['nummer2', new Map()]]);
  const log = [];
  const vertraging = { GET: 5, POST: 15, DELETE: 1 };
  const haal = async (url, init = {}) => {
    const m = init.method || 'GET';
    await new Promise((r) => setTimeout(r, vertraging[m]));
    log.push(`${m} ${url}${init.body ? ' ' + init.body : ''}`);
    const [, id, nr] = /^\/api\/library\/([^/]+)\/hotcues(?:\/(\d+))?$/.exec(url) || [];
    const rij = db.get(decodeURIComponent(id));
    if (m === 'GET') return Response.json({ hotcues: rij ? [...rij].sort((a, b) => a[0] - b[0]).map(([n, tijd]) => ({ nr: n, tijd })) : [] });
    if (m === 'DELETE') return Response.json({ weg: !!rij?.delete(Number(nr)) });
    const b = JSON.parse(init.body);
    if (!(Number.isInteger(b.nr) && b.nr >= 1 && b.nr <= 8) || typeof b.tijd !== 'number' || !(b.tijd >= 0)) return Response.json({ fout: 'onzin' }, { status: 400 });
    if (!rij) return Response.json({ fout: 'onbekend nummer' }, { status: 404 });
    rij.set(b.nr, b.tijd);
    return Response.json({ hotcue: b });
  };
  const fouten = [];
  const opslag = opzetHotcueOpslag({ engine: eng, haal, meld: (tekst, soort) => { if (soort === 'fout') fouten.push(tekst); } });
  const dH = eng.deck('H');
  const hc = (nr, wis = false) => invoke(`track.8.hotcue.${nr}${wis ? '.delete' : ''}`, true);

  dH.load(buf, 'nummer 1');
  dH.seek(1.0);
  hc(2);                                          // gezet vóór de app weet welk nummer het is
  ok('vóór haalHotcues: nog niets verstuurd', log.length === 0);
  await opslag.haalHotcues('H', 'nummer1');
  await opslag.rust();
  ok('bewaarde hotcues terug op het deck', dH.hotcues[0] === 0.5 && dH.hotcues[2] === 2.0);
  ok('wat je vóór het ophalen zette blijft staan en gaat alsnog naar de server',
    dH.hotcues[1] === 1.0 && db.get('nummer1').get(2) === 1.0);

  const voor = log.length;
  dH.seek(3.0);
  hc(4); hc(4, true);                             // zetten en meteen wissen
  await opslag.rust();
  ok('zetten + meteen wissen: in volgorde bij de server, hotcue weg',
    !db.get('nummer1').has(4) && /^POST /.test(log[voor]) && /^DELETE .*\/hotcues\/4$/.test(log[voor + 1]));

  // Opnieuw laden; TIJDENS het ophalen druk je hotcue 1, die op het deck nog
  // leeg is maar bij het nummer bewaard staat (VERBETERINGEN ronde 4, A9).
  // Een DJ die hotcue 1 indrukt wil naar hotcue 1: het deck zette hem eerst
  // op de plek van het indrukken, en dat ging naar de server (0,5 was weg).
  dH.load(buf, 'nummer 1 weer');
  const bezig = opslag.haalHotcues('H', 'nummer1');
  hc(1, true);                                    // leeg na het laden: doet niets
  dH.seek(0.25);
  const n1 = log.length;
  hc(1);
  await bezig;
  await opslag.rust();
  ok('een lege hotcue indrukken vóór het terugzetten: de BEWAARDE blijft, op het deck én bij de server',
    dH.hotcues[0] === 0.5 && db.get('nummer1').get(1) === 0.5 && !log.slice(n1).some((l) => /^POST /.test(l)));
  ok('… en het deck springt ernaar (indrukken = naar die hotcue)', Math.abs(dH.position - 0.5) < 1e-9);
  ok('de rest komt wel terug', dH.hotcues[1] === 1.0 && dH.hotcues[2] === 2.0);

  // Hetzelfde nog vóór de app weet welk nummer het is (de golfvorm komt nog binnen).
  dH.load(buf, 'nummer 1 nog eens');
  dH.seek(1.7);
  hc(3);                                          // bij het nummer: 2,0
  const n2 = log.length;
  await opslag.haalHotcues('H', 'nummer1');
  await opslag.rust();
  ok('vóór haalHotcues ingedrukt: ook dan wint de bewaarde (2,0) en springt het deck erheen',
    dH.hotcues[2] === 2.0 && db.get('nummer1').get(3) === 2.0 && Math.abs(dH.position - 2.0) < 1e-9
    && !log.slice(n2).some((l) => /^(POST|DELETE) /.test(l)));

  // Per ongeluk gezet en meteen weer gewist (shift + pad) vóór het terugzetten:
  // dat wist alleen wat jij net zette, niet de bewaarde.
  dH.load(buf, 'nummer 1 en wissen');
  const bezig2 = opslag.haalHotcues('H', 'nummer1');
  dH.seek(0.9);
  hc(2); hc(2, true);
  const n3 = log.length;
  await bezig2;
  await opslag.rust();
  ok('gezet en gewist vóór het terugzetten: de bewaarde komt terug, de server houdt hem',
    dH.hotcues[1] === 1.0 && db.get('nummer1').get(2) === 1.0 && !log.slice(n3).some((l) => /^(POST|DELETE) /.test(l)));
  ok('… en er wordt niet gesprongen (je drukte niets meer in)', Math.abs(dH.position - 0.9) < 1e-9);

  // Komt het antwoord pas laat (hier 2 s op een nep-klok), dan wel terugzetten
  // maar niet meer springen: dat zou midden in de muziek verrassen.
  {
    const { HOTCUE_VERS } = await import('../src/ui/hotcue-opslag.js');
    const e2 = new Engine();
    let ms = 0;
    const haal2 = async () => Response.json({ hotcues: [{ nr: 1, tijd: 0.5 }] });
    const posts = [];
    const o2 = opzetHotcueOpslag({ engine: e2, klok: () => ms,
      haal: async (url, init = {}) => { if (init.method) posts.push(init.method); return haal2(); } });
    const d2 = e2.deck('A');
    d2.load(buf, 'laat');
    d2.seek(1.2);
    d2.hotcue(0);
    ms += HOTCUE_VERS + 1000;
    await o2.haalHotcues('A', 'laat');
    await o2.rust();
    ok('antwoord pas na HOTCUE_VERS: de bewaarde terug, maar het deck springt niet meer',
      d2.hotcues[0] === 0.5 && Math.abs(d2.position - 1.2) < 1e-9 && posts.length === 0);
  }

  // Na het terugzetten is alles gewoon: wissen en zetten gaan naar de server.
  dH.seek(0.25);
  hc(1, true); hc(1);
  await opslag.rust();
  ok('na het terugzetten: wissen en opnieuw zetten gaat gewoon naar de server', dH.hotcues[0] === 0.25 && db.get('nummer1').get(1) === 0.25);

  // Een los bestand: geen nummer, dus niets bewaren.
  const n0 = log.length;
  dH.load(buf, 'los bestand');
  dH.seek(0.7);
  hc(3);
  await opslag.rust();
  ok('los bestand of demo: niets naar de server', log.length === n0 && dH.hotcues[2] === 0.7);

  // Snel twee nummers achter elkaar: het eerste antwoord hoort niet meer bij deze track.
  dH.load(buf, 'nummer 1');
  const eerste = opslag.haalHotcues('H', 'nummer1');
  dH.load(buf, 'nummer 2');
  await Promise.all([eerste, opslag.haalHotcues('H', 'nummer2')]);
  ok('een laat antwoord van het vorige nummer zet niets op de track', dH.hotcues.every((h) => h === null));
  dH.seek(1.5);
  hc(1);
  await opslag.rust();
  ok('en nieuwe hotcues gaan naar het nieuwe nummer', db.get('nummer2').get(1) === 1.5 && db.get('nummer1').get(1) === 0.25);

  // Een nummer dat de server niet (meer) kent: een foutmelding, geen stilte.
  dH.load(buf, 'weg');
  await opslag.haalHotcues('H', 'weggehaald');
  hc(1);
  await opslag.rust();
  ok('bewaren mislukt: een foutmelding op het scherm', fouten.some((f) => /hotcue 1 niet bewaard.*404/.test(f)));
  ok('geen onzin naar de server gestuurd', !log.some((l) => /"tijd":null/.test(l)));

  // Naad dj-transport × library (integratie ronde 3): met quantize gaat de
  // GESNAPTE tijd naar de server, niet de plek waar je drukte.
  {
    const { Beatgrid } = await import('../src/engine/beatgrid.js');
    dH.load(buf, 'nummer 2 met grid');
    await opslag.haalHotcues('H', 'nummer2');
    dH.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
    eng.setQuantize(true);
    dH.seek(1.37);
    hc(4);
    await opslag.rust();
    eng.setQuantize(false);
    ok(`quantize: de bewaarde hotcue is de tel (${db.get('nummer2').get(4)} s), niet waar je drukte (1,37 s)`,
      db.get('nummer2').get(4) === 1.5 && dH.hotcues[3] === 1.5);
    dH.setGrid(null);
  }
}

// ---- transport: beatjump, loop in/out, quantize, starten op de maat --------
// ROADMAP 16, spoor C. Alles in TELLEN op het grid (tempokaart), elk moment
// van de audioklok (regel 3), en weigeren in een onzeker stuk zoals beat-loops.

console.log('\ntransport');
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const { ONZEKER, MAAT_WACHT } = await import('../src/engine/engine.js');
  const { SPRONG_TELLEN } = await import('../src/engine/deck.js');
  const lang = eng.ctx.createBuffer(2, 48000 * 40, 48000);      // 40 s stilte
  const meldingen = [];
  const opMelding = (m) => meldingen.push(m);
  eng.on('melding', opMelding);
  for (const d of Object.values(eng.decks)) d.stop();
  const dG = eng.deck('G');                                     // track 7
  dG.load(lang, 'transport');
  const druk = (a) => { invoke(a, true); invoke(a, false); };

  // -- beatjump --
  dG.seek(5);
  druk('track.7.beatjump.fwd');
  ok('beatjump zonder grid: blijft staan, met een melding', dG.position === 5 && /beatgrid/.test(meldingen.at(-1)?.tekst));
  ok('beatjump zonder grid: lampje uit (null)', read('track.7.beatjump.fwd') === null);

  dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  ok('beatjump-lengte standaard 4 tellen', dG.sprongTellen === 4 && SPRONG_TELLEN.join() === '1,2,4,8,16,32');
  dG.seek(5.1);
  invoke('track.7.beatjump.fwd', true);
  ok('beatjump vooruit: 4 tellen = 2 s op 120 bpm', Math.abs(dG.position - 7.1) < 1e-9);
  ok('... lampje vol zolang ingedrukt', read('track.7.beatjump.fwd') === 1);
  invoke('track.7.beatjump.fwd', false);
  ok('... bruikbaar (0) na loslaten', read('track.7.beatjump.fwd') === 0);
  druk('track.7.beatjump.back');
  ok('beatjump terug', Math.abs(dG.position - 5.1) < 1e-9);

  for (let i = 0; i < 4; i++) druk('track.7.beatjump.halve');
  ok('halveren stopt op 1 tel', dG.sprongTellen === 1 && read('track.7.beatjump.halve') === 0);
  for (let i = 0; i < 7; i++) druk('track.7.beatjump.double');
  ok('verdubbelen stopt op 32 tellen', dG.sprongTellen === 32 && read('track.7.beatjump.double') === 1);
  for (let i = 0; i < 3; i++) druk('track.7.beatjump.halve');
  ok('... en terug naar 4', dG.sprongTellen === 4);

  NOW = 700;
  dG.seek(5.1); dG.play();
  NOW += 0.3;                                                   // 5,4: 0,8 in de tel
  const fase0 = dG.grid.phase(dG.position);
  druk('track.7.beatjump.fwd');
  ok('beatjump tijdens spelen: dezelfde fase in de tel (7,4)', Math.abs(dG.position - 7.4) < 1e-9
    && Math.abs(dG.grid.phase(dG.position) - fase0) < 1e-9 && dG.playing);
  NOW += 0.1;
  ok('... en hij loopt door vanaf daar', Math.abs(dG.position - 7.5) < 1e-9);
  dG.stop();

  // Over een stukgrens: 120 bpm, vanaf 2,0 s 150 bpm (tellen … 1,0 · 1,5 · 2,1 · 2,5 · 2,9 · 3,3 …).
  dG.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 2.0, bpm: 150, anker: 2.1 }] }));
  dG.seek(1.25);
  ok('beatjump over een stukgrens telt tellen: 1,25 + 4 tellen = 3,1 (niet 3,25)', dG.beatjump(1).ok && Math.abs(dG.position - 3.1) < 1e-9);
  dG.beatjump(-1);
  ok('... en terug precies op 1,25', Math.abs(dG.position - 1.25) < 1e-9);

  // In een loop: de loop schuift mee, de speelkop houdt zijn plek erin.
  dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  NOW = 710;
  dG.seek(4.0); dG.play();
  dG.setBeatLoop(4);                                            // 4,0 – 6,0
  NOW += 0.7;                                                   // 4,7
  druk('track.7.beatjump.fwd');
  ok('beatjump in een loop: de loop schuift 4 tellen mee (6,0 – 8,0)', Math.abs(dG.loop.start - 6) < 1e-9 && Math.abs(dG.loop.end - 8) < 1e-9);
  ok('... de speelkop houdt zijn plek in de loop (6,7)', Math.abs(dG.position - 6.7) < 1e-9 && dG.playing);
  ok('... de loop blijft 4 tellen (lampje loop 4)', dG.loopBeats === 4 && read('track.7.beatloop.4') === 1);
  NOW += 1.5;
  ok('... en loopt daar rond (8,2 -> 6,2)', Math.abs(dG.position - 6.2) < 1e-9);
  druk('track.7.beatjump.back'); druk('track.7.beatjump.back');
  ok('twee keer terug: de loop staat op 2,0 – 4,0', Math.abs(dG.loop.start - 2) < 1e-9 && Math.abs(dG.position - 2.2) < 1e-9);
  // Een loop over een stukgrens: de TELLEN blijven gelijk, de seconden niet.
  dG.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 5.0, bpm: 150, anker: 5.0 }] }));
  dG.stop(); dG.clearLoop(); dG.seek(3.0); dG.setBeatLoop(4);   // 3,0 – 5,0: tel 6 t/m 10
  dG.beatjump(1);
  ok('loop over een stukgrens geschoven: 4 tellen van 150 bpm (5,0 – 6,6)', Math.abs(dG.loop.start - 5) < 1e-9
    && Math.abs(dG.loop.end - 6.6) < 1e-9 && Math.abs(dG.position - 5) < 1e-9 && dG.loopBeats === 4);
  dG.clearLoop();
  // Tegen het einde van het nummer: de loop past er niet meer, dan niet.
  dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  dG.seek(36); dG.setBeatLoop(4);                               // 36 – 38
  dG.sprongTellen = 8;
  const nRand = meldingen.length;
  druk('track.7.beatjump.fwd');
  ok('loop zou voorbij het einde komen: blijft staan, met een melding', Math.abs(dG.loop.start - 36) < 1e-9
    && dG.position === 36 && meldingen.length === nRand + 1);
  dG.sprongTellen = 4;
  druk('track.7.beatjump.fwd');
  ok('... 4 tellen past precies (38 – 40)', Math.abs(dG.loop.end - 40) < 1e-9);
  dG.clearLoop();
  // Zonder loop voorbij het einde: weigeren. Klemmen op het einde liet de track
  // eindigen en stoppen, midden in een set.
  NOW = 715;
  dG.seek(39); dG.play();                                       // 1 s voor het einde; 4 tellen = 2 s
  const nEinde = meldingen.length;
  druk('track.7.beatjump.fwd');
  ok('beatjump voorbij het einde (zonder loop): niet gesprongen, hij speelt door', Math.abs(dG.position - 39) < 1e-9 && dG.playing);
  ok('... met een melding', meldingen.length === nEinde + 1 && /einde/.test(meldingen.at(-1).tekst));
  dG.seek(38);
  const rEinde = dG.beatjump(1);
  ok('... precies OP het einde landen is ook eindigen: niet (38 + 2 = 40)', !rEinde.ok && rEinde.waarom === 'einde' && Math.abs(dG.position - 38) < 1e-9);
  dG.seek(37.9);
  ok('... wat nog past, springt gewoon (37,9 -> 39,9)', dG.beatjump(1).ok && Math.abs(dG.position - 39.9) < 1e-9);
  dG.seek(1);
  const nBegin = meldingen.length;
  druk('track.7.beatjump.back');
  ok('terug voorbij het begin (J4): niet gesprongen, hij speelt door', Math.abs(dG.position - 1) < 1e-9 && dG.playing);
  ok('... met een melding', meldingen.length === nBegin + 1 && /begin/.test(meldingen.at(-1).tekst));
  const rBegin = dG.beatjump(-1);
  ok('... waarom = begin (niet onzeker)', !rBegin.ok && rBegin.waarom === 'begin');
  dG.seek(2);
  ok('... precies op 0 landen mag (2 − 2 = 0)', dG.beatjump(-1).ok && Math.abs(dG.position) < 1e-9 && dG.playing);
  dG.stop();

  // Onzeker stuk (niet op slot): weigeren, zoals beat-loops.
  dG.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }, { van: 10, bpm: 120, anker: 0, zekerheid: 0.3 }] }));
  dG.seek(12);
  const nOnz = meldingen.length;
  druk('track.7.beatjump.back');
  ok('beatjump in een onzeker stuk: blijft staan', dG.position === 12);
  ok('... met dezelfde melding als beat-loops', meldingen.length === nOnz + 1 && meldingen.at(-1).tekst.includes(ONZEKER));
  ok('... lampje uit (null)', read('track.7.beatjump.back') === null);
  dG.seek(8.5);
  const r1 = dG.beatjump(1);
  ok('vanuit een zeker stuk IN een onzeker stuk springen: ook niet', !r1.ok && r1.waarom === 'onzeker' && dG.position === 8.5);
  ok('binnen het zekere stuk wel', dG.beatjump(-1).ok && Math.abs(dG.position - 6.5) < 1e-9);
  dG.grid.slot = true;
  dG.seek(12);
  ok('op slot mag het overal', dG.beatjump(-1).ok && Math.abs(dG.position - 10) < 1e-9);

  // -- loop in / loop out / reloop --
  ok('de loops van hierboven zijn onthouden voor reloop', dG.vorigeLoop !== null && read('track.7.loop.reloop') === 0.5);
  dG.load(lang, 'loops');                                       // vers nummer: niets onthouden
  dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  dG.seek(3);
  ok('loop out zonder loop in doet niets (lampje uit: null)', dG.loopOut() === false && dG.loop === null && read('track.7.loop.out') === null);
  ok('reloop zonder loop en zonder vorige loop: niets te doen (null)', read('track.7.loop.reloop') === null);
  NOW = 720;
  dG.seek(3.23); dG.play();
  druk('track.7.loop.in');
  ok('loop in: onthouden, nog geen loop; lampje wacht op out', dG.loopInPunt === 3.23 && dG.loop === null && read('track.7.loop.in') === 1);
  ok('... en loop out is nu bruikbaar (0)', read('track.7.loop.out') === 0);
  NOW += 1.54;                                                  // 4,77
  druk('track.7.loop.out');
  ok('loop out: de loop gaat meteen aan, van in tot hier', dG.loop && Math.abs(dG.loop.start - 3.23) < 1e-9 && Math.abs(dG.loop.end - 4.77) < 1e-9);
  ok('... zonder quantize geen aantal tellen; lampjes out aan, in uit', dG.loopBeats === null
    && read('track.7.loop.out') === 1 && read('track.7.loop.in') === 0);
  NOW += 0.5;
  ok('... en loopt rond (3,73)', Math.abs(dG.position - 3.73) < 1e-9);
  druk('track.7.loop.reloop');
  ok('reloop/exit met een loop: eraf, speelt door; lampje "terug te halen"', dG.loop === null && dG.playing && read('track.7.loop.reloop') === 0.5);
  NOW += 3;
  druk('track.7.loop.reloop');
  ok('reloop: dezelfde loop weer aan, terug naar zijn begin', dG.loop && Math.abs(dG.loop.start - 3.23) < 1e-9
    && Math.abs(dG.loop.end - 4.77) < 1e-9 && Math.abs(dG.position - 3.23) < 1e-9 && read('track.7.loop.reloop') === 1);
  druk('track.7.loop.exit');
  ok('loop.exit onthoudt de loop ook voor reloop', dG.loop === null && dG.vorigeLoop && Math.abs(dG.vorigeLoop.start - 3.23) < 1e-9);
  dG.stop();
  dG.seek(10); druk('track.7.loop.in'); dG.seek(9);
  ok('loop out vóór het in-punt: niets, het in-punt blijft wachten', dG.loopOut() === false && dG.loop === null && dG.loopInPunt === 10);
  dG.setBeatLoop(2);
  ok('de andere loops werken ernaast (beat-loop 2)', dG.loopBeats === 2);
  dG.seek(10.5); druk('track.7.loop.out');
  ok('loop out vervangt een lopende beat-loop', Math.abs(dG.loop.start - 10) < 1e-9 && Math.abs(dG.loop.end - 10.5) < 1e-9 && dG.loopBeats === null);
  dG.clearLoop();
  dG.load(lang, 'ander nummer');
  ok('een ander nummer: geen in-punt en geen loop om terug te halen', dG.loopInPunt === null && dG.vorigeLoop === null);

  // -- quantize: één schakelaar voor alle tracks --
  dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  ok('quantize staat standaard uit', eng.quantize === false && read('transport.quantize') === 0);
  druk('transport.quantize');
  ok('quantize aan via de bus, op elke track', eng.quantize && Object.values(eng.decks).every((d) => d.quantize) && read('transport.quantize') === 1);
  ok('en in de snapshot', eng.snapshot().quantize === true);

  NOW = 730;
  dG.seek(3.23); dG.play();
  druk('track.7.loop.in');
  ok('loop in met quantize: op de dichtstbijzijnde tel (3,0)', dG.loopInPunt === 3);
  NOW += 1.57;                                                  // 4,80: dichtstbij is 5,0
  druk('track.7.loop.out');
  ok('loop out met quantize: een heel aantal tellen (3,0 – 5,0)', Math.abs(dG.loop.start - 3) < 1e-9 && Math.abs(dG.loop.end - 5) < 1e-9 && dG.loopBeats === 4);
  ok('... dan brandt het lampje van loop 4', read('track.7.beatloop.4') === 1);
  druk('track.7.loop.halve');                                   // 3,0 – 4,0; 4,8 vouwt naar 3,8
  ok('halveren werkt erop (2 tellen)', dG.loopBeats === 2 && Math.abs(dG.loop.end - 4) < 1e-9);
  dG.clearLoop();
  druk('track.7.loop.in');                                      // 3,8 -> tel 4,0, speelkop er nog vóór
  druk('track.7.loop.out');
  ok('loop out vlak na loop in (speelkop nog vóór de tel): minstens één tel', dG.loop
    && Math.abs(dG.loop.start - 4) < 1e-9 && Math.abs(dG.loop.end - 4.5) < 1e-9 && dG.loopBeats === 1);
  dG.clearLoop();
  dG.seek(4.0); dG.setBeatLoop(4);                              // 4,0 – 6,0, speelt
  dG.clearLoop(); dG.seek(9.15);                                // 0,3 in de tel
  druk('track.7.loop.reloop');
  ok('reloop met quantize: terug naar het begin, fasebehoudend (4,15)', Math.abs(dG.position - 4.15) < 1e-9 && dG.loopBeats === 4);
  dG.clearLoop(); dG.seek(9.4);                                 // 0,8 in de tel: 0,1 s vóór het begin
  druk('track.7.loop.reloop');
  ok('... valt dat vóór het begin, dan teruggevouwen in de loop (5,9)', Math.abs(dG.position - 5.9) < 1e-9 && dG.loop);
  dG.clearLoop();

  // Hotcues met quantize: zetten op de tel, springen fasebehoudend.
  dG.seek(2.1);
  druk('track.7.hotcue.1');
  ok('hotcue zetten met quantize: op de dichtstbijzijnde tel (2,0)', dG.hotcues[0] === 2);
  dG.seek(6.3);
  NOW += 0.1;                                                   // 6,4: 0,8 in de tel
  druk('track.7.hotcue.1');
  ok('hotcue springen met quantize: fasebehoudend, 0,2 tel vóór de hotcue (1,9)', Math.abs(dG.position - 1.9) < 1e-9);
  ok('... de fase is dezelfde als vóór de sprong', Math.abs(dG.grid.phase(dG.position) - 0.8) < 1e-9);
  dG.seek(6.15);                                                // 0,3 in de tel
  druk('track.7.hotcue.1');
  ok('... op 0,3 in de tel: 0,15 s na de hotcue (2,15)', Math.abs(dG.position - 2.15) < 1e-9);
  // In een loop: of de loop blijft, hangt af van waar de HOTCUE ligt, niet van
  // waar de fasebehoudende sprong landt (tot een halve tel ernaast). Zonder
  // quantize bleef een hotcue op het loopbegin in de loop; met quantize viel
  // hij vóór het begin en haalde hij de loop eraf.
  dG.setBeatLoop(4);                                            // 2,15 -> loop 2,0 – 4,0
  NOW += 0.65;                                                  // 2,8: 0,6 in de tel
  druk('track.7.hotcue.1');                                     // hotcue 1 = 2,0 = het loopbegin
  ok('hotcue op het loopbegin met quantize: de loop blijft, sprong teruggevouwen (3,8)', !!dG.loop
    && Math.abs(dG.loop.start - 2) < 1e-9 && Math.abs(dG.position - 3.8) < 1e-9);
  dG.clearLoop(); dG.seek(3.8); dG.setLoopRange(2.0, 4.0);      // los van de check hierboven
  dG.hotcues[1] = 4.0;                                          // op het loopEINDE: net buiten de loop
  NOW += 0.1;                                                   // 3,9: 0,8 in de tel
  druk('track.7.hotcue.2');
  ok('hotcue net buiten de loop met quantize: de loop gaat eraf, ook al valt de sprong erin (3,9)', dG.loop === null
    && Math.abs(dG.position - 3.9) < 1e-9);
  NOW += 0.3;
  ok('... en hij speelt voorbij het oude loopeinde door (4,2)', Math.abs(dG.position - 4.2) < 1e-9);
  dG.hotcues[1] = null;
  dG.stop();
  dG.seek(7.3);
  druk('track.7.hotcue.1');
  ok('stilstaand springt een hotcue gewoon precies naar de hotcue', dG.position === 2);
  dG.seek(7.3);
  druk('track.7.cue');
  ok('cue zetten met quantize: op de tel, en de speelkop gaat mee', dG.cuePoint === 7.5 && dG.position === 7.5);
  druk('track.7.cue');
  ok('... zodat de volgende druk speelt vanaf de cue', dG.playing);
  dG.stop();
  // In een onzeker stuk snapt quantize niet: een cue op een verkeerde tel is erger.
  dG.setGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }, { van: 10, bpm: 120, anker: 0, zekerheid: 0.3 }] }));
  dG.seek(12.3);
  druk('track.7.hotcue.2');
  ok('hotcue in een onzeker stuk: precies waar je drukt (12,3)', dG.hotcues[1] === 12.3);
  dG.hotcues[1] = null;
  druk('transport.quantize');
  ok('quantize weer uit', !eng.quantize && !dG.quantize);
  dG.seek(2.1);
  druk('track.7.hotcue.3');
  ok('zonder quantize: hotcue precies waar je drukt', dG.hotcues[2] === 2.1);

  // -- starten op de maat --
  const dM = eng.deck('H');                                     // track 8: de maatgever
  // B4: op een lege track is er niets te doen, dus alle nieuwe lampjes uit.
  // Track 8 is sinds de hotcue-test (ronde 1) al geladen, en een deck kent geen
  // "leeg maken": de bron zonder buffer is hier genoeg, want de load hieronder
  // zet alles opnieuw (integratie ronde 3).
  dM.bron.vernietig();
  const leeg =['beatjump.back', 'beatjump.fwd', 'beatjump.halve', 'beatjump.double', 'loop.in', 'loop.out', 'loop.reloop', 'play.quant']
    .filter((a) => read(`track.8.${a}`) !== null);
  ok(`lege track: alle transportlampjes uit (null)${leeg.length ? ': ' + leeg.join(', ') : ''}`, !dM.buffer && leeg.length === 0);
  dM.load(lang, 'maat');
  dM.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  dG.stop(); dG.seek(8.0);
  NOW = 800;
  ok('play.quant stil en er is een track: bruikbaar (0)', read('track.7.play.quant') === 0);
  druk('track.7.play.quant');
  ok('play.quant zonder spelende maatgever: meteen', dG.playing && !dG.wacht && dG.bron.source._wanneer === 0);
  dG.stop(); dG.seek(8.0);

  dM.seek(0.3); dM.play();                                      // maatbegin (tel 4) op 2,0 s = ctx 801,7
  NOW = 800.1;
  druk('track.7.play.quant');
  const T = 801.7;
  ok(`play.quant: gepland op het volgende maatbegin van de maatgever (${dG.bron.wachtTot})`, dG.wacht && Math.abs(dG.bron.wachtTot - T) < 1e-9);
  ok('... de bron start daar sample-exact, op het startpunt', Math.abs(dG.bron.source._wanneer - T) < 1e-9 && dG.bron.source._vanaf === 8);
  ok('... lampje wacht (1); play brandt ook', read('track.7.play.quant') === 1 && read('track.7.play') === 1);
  ok('... tot dan staat de positie stil', dG.position === 8);
  ok('... en knippert er niets op de tel', read('track.7.phase') === null && read('track.7.beat') === 0);
  ok('... ctxTimeOf klopt al vóór de start', Math.abs(dG.ctxTimeOf(8.5) - (T + 0.5)) < 1e-9);
  NOW = T + 0.25;
  ok('na het maatbegin loopt hij, in fase met de maatgever', !dG.wacht && Math.abs(dG.position - 8.25) < 1e-9
    && Math.abs(dG.grid.phase(dG.position) - dM.grid.phase(dM.position)) < 1e-9);
  ok('... en ook op dezelfde plek in de maat (de "1" viel samen)', Math.abs(dG.grid.barPhase(dG.position) - dM.grid.barPhase(dM.position)) < 1e-9);
  ok('... play.quant terwijl hij speelt: lampje gedimd (0,5), want drukken = pauze', read('track.7.play.quant') === 0.5);
  // shift+Q was eerst gewoon play/pauze: op een spelende track pauzeert hij nog.
  druk('track.7.play.quant');
  ok('play.quant op een SPELENDE track: pauze, zoals play', !dG.playing && !dG.wacht && Math.abs(dG.position - 8.25) < 1e-9);
  dG.stop();

  // Startpunt een fractie na zijn tel (cue zonder quantize): de TEL valt op de 1.
  dG.seek(8.1);
  NOW = 802.0;                                                  // maatgever op 2,3; volgend maatbegin 4,0 = ctx 803,7
  const r2 = eng.startOpDeMaat('G');
  ok('startpunt 0,1 s na zijn tel: het geluid begint 0,1 s na het maatbegin', r2.ok && Math.abs(r2.op - 803.8) < 1e-9 && r2.master === 'H');
  NOW = 804.0;
  ok('... en dan is de fase gelijk aan die van de maatgever', Math.abs(dG.grid.phase(dG.position) - dM.grid.phase(dM.position)) < 1e-9);
  dG.stop(); dG.seek(8.0);

  // Maatbegin binnen de uitgangsbuffer: dan de maat erna.
  NOW = 803.695;                                                // maatbegin 803,7 over 5 ms, drempel 8 ms
  const r3 = eng.startOpDeMaat('G');
  ok('maatbegin te dichtbij (5 ms, binnen de uitgangsbuffer): de maat erna', Math.abs(r3.op - 805.7) < 1e-9);
  // Pauze tijdens het wachten annuleert.
  druk('track.7.play');
  ok('pauze tijdens het wachten: stil, op het startpunt, bron weg', !dG.playing && !dG.wacht && dG.position === 8 && !dG.bron.source);
  // Nog een keer play.quant tijdens het wachten: ook annuleren (net als play).
  druk('track.7.play.quant');
  ok('play.quant: wacht (weer) op het maatbegin 805,7', dG.wacht && Math.abs(dG.bron.wachtTot - 805.7) < 1e-9);
  druk('track.7.play.quant');
  ok('... nog een keer play.quant tijdens het wachten: geannuleerd, stil op het startpunt', !dG.playing && !dG.wacht
    && dG.position === 8 && !dG.bron.source && read('track.7.play.quant') === 0);
  // Tempo, sprong en sync tijdens het wachten: het startmoment blijft.
  NOW = 804.0;
  eng.startOpDeMaat('G');                                       // maatbegin 805,7
  dG.setRate(1.1);
  ok('tempo verzetten tijdens het wachten: startmoment blijft', dG.wacht && Math.abs(dG.bron.wachtTot - 805.7) < 1e-9 && dG.position === 8);
  dG.hotcues[3] = 12;
  druk('track.7.hotcue.4');
  ok('hotcue tijdens het wachten: zelfde startmoment, ander startpunt', dG.wacht && Math.abs(dG.bron.wachtTot - 805.7) < 1e-9 && dG.position === 12);
  const rs = eng.sync('G');
  ok('sync tijdens het wachten: alleen het tempo, de fase komt van de start', rs.ok && rs.fase === false && Math.abs(dG.rate - 1) < 1e-9
    && Math.abs(dG.bron.wachtTot - 805.7) < 1e-9);
  NOW = 805.8;
  ok('... en op het maatbegin loopt hij vanaf de hotcue', Math.abs(dG.position - 12.1) < 1e-9);
  dG.stop(); dG.seek(8.0);

  // Op de tel in plaats van de maat (tellen: 1), en met een maatgever op +5%.
  dM.setRate(1.05);
  NOW = 806.0;
  const pM = dM.position;
  const r4 = eng.startOpDeMaat('G', { tellen: 1 });
  const verwacht = 806.0 + (dM.grid.next(pM) - pM) / 1.05;
  ok('tellen: 1 = de volgende tel, met de rate van de maatgever', Math.abs(r4.op - verwacht) < 1e-9);
  dG.stop(); dM.setRate(1);

  // Een track die op de maat wacht, klinkt nog niet: hij geeft de maat niet
  // (sync, sampler, echo, lampje), ook niet met een hogere fader dan de track
  // die je hoort. Anders synct een derde track naar een tempo dat nog niemand
  // hoort, en liepen echo en sampler tot een maat te vroeg op zijn tempo.
  {
    const dF = eng.deck('F');                                   // track 6
    dF.load(lang, 'derde');
    dF.setGrid(new Beatgrid({ bpm: 125, firstBeat: 0 }));
    dM.set('fader', 0.5); dF.set('fader', 1);
    NOW = 807.66;                                               // maatgever H vlak voor zijn maatbegin (8,0)
    const maatH = NOW + (8.0 - dM.position);
    dF.seek(8.16);                                              // op een tel van 125 bpm
    eng.startOpDeMaat('F');
    ok('een wachtende track met een hogere fader: de maat blijft bij wat je hoort (H)', dF.wacht
      && Math.abs(dF.bron.wachtTot - maatH) < 1e-9 && eng.syncMaster()?.id === 'H' && eng.syncMaster('G')?.id === 'H'
      && read('track.8.leads') === 1 && read('track.6.leads') === 0);
    const rG = eng.sync('G');
    ok('... sync van een andere track gaat naar H (120 bpm), niet naar de wachtende (125)', rG.ok && rG.master === 'H'
      && Math.abs(dG.rate - 1) < 1e-9);
    let gemeld = 0;
    dF.on('change', () => { gemeld++; });
    NOW = 807.75;                                               // voorbij zijn start
    // Hysterese (dj-klank): hij is 3 dB harder, maar neemt de maat pas over
    // als dat MAAT_WACHT lang zo blijft. Bedoeld gedrag, geen regressie.
    ok('na zijn start: eerst nog H (hysterese: pas na MAAT_WACHT)', !dF.wacht && eng.syncMaster()?.id === 'H');
    NOW += MAAT_WACHT + 0.01;
    ok('na zijn start geeft hij de maat wel (hardste fader), na MAAT_WACHT', !dF.wacht && eng.syncMaster()?.id === 'F');
    // Op zijn start meldt hij zich zelf (timer op de audioklok, zoals bij een
    // stukgrens): echo en sampler herankeren dan op de nieuwe maatgever.
    await new Promise((r) => setTimeout(r, 150));
    ok(`... en op dat moment meldt hij 'change' (${gemeld}x), zodat echo en sampler volgen`, gemeld >= 1);
    dF.stop(); dG.setRate(1); dM.set('fader', 1); dF.set('fader', 1);
  }

  // Het maatbegin verschuift tijdens het wachten: de wachtende track loopt mee,
  // zoals de sampler-pads. Een vast startmoment viel anders naast de 1.
  {
    NOW = 810.0;                                                // H speelt op 120 bpm
    const bar = Math.ceil(dM.position / 2 - 1e-9) * 2;          // zijn volgende maatbegin (tracktijd)
    dG.stop(); dG.seek(8.0);                                    // op de tel
    eng.startOpDeMaat('G');
    const T0 = dG.bron.wachtTot;
    ok('plan: op het maatbegin van H', Math.abs(T0 - dM.ctxTimeOf(bar)) < 1e-9);
    NOW += 0.5;
    dM.setRate(1.03);                                           // pitchfader van de maatgever +3%
    ok(`tempo van de maatgever +3% tijdens het wachten: de start schuift mee (${((dG.bron.wachtTot - T0) * 1000).toFixed(1)} ms)`,
      dG.wacht && Math.abs(dG.bron.wachtTot - dM.ctxTimeOf(bar)) < 1e-9 && Math.abs(dG.bron.wachtTot - T0) > 0.02);
    ok('... vanaf hetzelfde startpunt', dG.position === 8 && Math.abs(dG.bron.source._wanneer - dG.bron.wachtTot) < 1e-9
      && dG.bron.source._vanaf === 8);
    dG.stop(); dM.setRate(1);

    // Eigen tempo verzet tijdens het wachten (sync) met een startpunt naast de tel.
    const bar2 = Math.ceil(dM.position / 2 - 1e-9) * 2;
    dG.seek(8.1);                                               // 0,1 s na zijn tel
    eng.startOpDeMaat('G');
    dG.setRate(1.05);
    ok('eigen tempo verzet met een startpunt naast de tel: zijn TEL valt nog op het maatbegin',
      dG.wacht && Math.abs(dG.ctxTimeOf(8.0) - dM.ctxTimeOf(bar2)) < 1e-9);
    // Een nudge van de wachtende track zelf is een bedoelde verschuiving: het
    // startmoment blijft (deck.seek), ook al volgt de engine de maat.
    const Tn = dG.bron.wachtTot;
    druk('track.7.nudge.fwd');
    ok('nudge tijdens het wachten: startmoment blijft, het startpunt schuift 50 ms', dG.wacht
      && Math.abs(dG.bron.wachtTot - Tn) < 1e-9 && Math.abs(dG.position - 8.15) < 1e-9);
    // Stopt de maatgever tijdens het wachten, dan blijft het plan staan.
    const T2 = dG.bron.wachtTot;
    dM.pause();
    ok('maatgever stopt tijdens het wachten: het startmoment blijft', dG.wacht && dG.bron.wachtTot === T2);
    dM.play(); dG.stop(); dG.setRate(1);

    // Maatgever in een loop van één tel: de klok telt door, dus "opnieuw de
    // volgende maat" schoof de start elke ronde een tel op. Hij moet op
    // dezelfde tel blijven, ook na een ronde en een 'change' (fader open).
    dM.seek(20.1); dM.setBeatLoop(1);                           // loop 20,0 – 20,5 (tel 40)
    dG.seek(8.0);
    eng.startOpDeMaat('G');
    const T3 = dG.bron.wachtTot;
    NOW += 0.6;                                                 // H is één keer rond
    dG.set('fader', 0.9);
    ok(`maatgever in een loop van één tel: na een ronde blijft de start staan (${((dG.bron.wachtTot - T3) * 1000).toFixed(0)} ms)`,
      dG.wacht && Math.abs(dG.bron.wachtTot - T3) < 1e-9);
    dM.clearLoop();
    ok('... ook als de loop eraf gaat (de tellen lopen door)', dG.wacht && Math.abs(dG.bron.wachtTot - T3) < 1e-9);
    dG.stop(); dG.set('fader', 1);
  }

  // Maatgever in een onzeker stuk: meteen, met een melding.
  dM.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0, stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.3 }] }));
  const nMaat = meldingen.length;
  druk('track.7.play.quant');
  ok('maatgever onzeker: meteen gestart, met een melding', dG.playing && !dG.wacht && meldingen.length === nMaat + 1
    && meldingen.at(-1).soort === 'info');
  dG.stop(); dM.stop();

  // De snapshot (scherm, renderloop) kent de nieuwe stand.
  ok('snapshot draagt in-punt, wachten en sprong', 'loopIn' in eng.snapshot().decks.G && eng.snapshot().decks.G.wacht === false
    && eng.snapshot().decks.G.sprongTellen === 4);

  // ctxTimeOf tijdens het wachten, met een loop: tot T staat hij stil op P, dus
  // een punt IN de loop vóór P komt pas na een ronde langs. Rekenen vanaf nu
  // liep een denkbeeldige positie vóór P terug, en gaf dan een tijd vóór de
  // start. fxKlok en de stukgrens vragen alleen punten ná P; dit is voor wie
  // er later wel om vraagt.
  {
    const { ctxTijdVan } = await import('../src/engine/stream-kern.js');
    dM.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));      // hierboven stond hij op onzeker
    dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
    NOW = 820.0;
    dM.stop(); dM.seek(0.3); dM.play();                         // maatbegin 2,0 = ctx 821,7
    dG.stop(); dG.clearLoop(); dG.seek(8.0);
    dG.setLoopRange(7.5, 8.5);                                  // loop van één tel, startpunt erin
    eng.startOpDeMaat('G');
    const Tl = dG.bron.wachtTot;
    NOW = 820.1;                                                // 1,6 s vóór de start
    ok(`ctxTimeOf tijdens het wachten, punt in de loop vóór het startpunt: na een ronde (T + 0,75; was ${(dG.ctxTimeOf(7.75) - Tl).toFixed(2)})`,
      dG.wacht && Math.abs(Tl - 821.7) < 1e-9 && Math.abs(dG.ctxTimeOf(7.75) - (Tl + 0.75)) < 1e-9);
    ok('... een punt erna: T + de afstand (8,25 -> T + 0,25), het startpunt zelf: T', Math.abs(dG.ctxTimeOf(8.25) - (Tl + 0.25)) < 1e-9
      && Math.abs(dG.ctxTimeOf(8.0) - Tl) < 1e-9);
    NOW = Tl + 0.6;                                             // na de start: 8,0 -> 8,5 -> 7,5 -> 7,6
    ok('... en na de start komt hij er ook echt op dat moment langs', Math.abs(dG.position - 7.6) < 1e-9);
    dG.stop(); dG.clearLoop(); dM.stop();
    // De StreamBron (de app) rekent met dezelfde formule; ook met een andere rate.
    const seg = { T: 10, P: 9, R: 1.25, loop: { start: 8, end: 10 }, speelt: true };
    ok('ctxTijdVan met een geplande start: vanaf T, niet vanaf nu (8,5 -> 11,2)', Math.abs(ctxTijdVan(seg, 8.5, 8.0) - 11.2) < 1e-9
      && Math.abs(ctxTijdVan(seg, 9.5, 8.0) - 10.4) < 1e-9);
  }

  // Toetsen en uitleg.
  const { KEYMAP, SHIFT_ALIAS } = await import('../src/control/keyboard.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const ids = new Set(list().map((a) => a.id));
  const vul = (id) => id.replace('{L}', '3').replace('{R}', '2');
  const metShift = Object.values(KEYMAP).map((id) => SHIFT_ALIAS(vul(id))).filter((id) => !ids.has(id));
  ok('elke toets MET shift wijst ook naar een bestaande action', metShift.length === 0);
  ok('toetsen: R/T beatjump, G/C loop in/out, 6 quantize; shift: Q = op de maat, R/T = lengte, G = reloop',
    KEYMAP.KeyR === 'track.{L}.beatjump.back' && KEYMAP.KeyT === 'track.{L}.beatjump.fwd'
    && KEYMAP.KeyG === 'track.{L}.loop.in' && KEYMAP.KeyC === 'track.{L}.loop.out' && KEYMAP.Digit6 === 'transport.quantize'
    && SHIFT_ALIAS('track.3.play') === 'track.3.play.quant' && SHIFT_ALIAS('track.3.beatjump.back') === 'track.3.beatjump.halve'
    && SHIFT_ALIAS('track.3.beatjump.fwd') === 'track.3.beatjump.double' && SHIFT_ALIAS('track.3.loop.in') === 'track.3.loop.reloop'
    && SHIFT_ALIAS('track.3.hotcue.2') === 'track.3.hotcue.2.delete');
  {
    // Echt drukken, via de handler: G heeft focus (links), H is de tweede (rechts).
    const { attachKeyboard } = await import('../src/control/keyboard.js');
    const handlers = {};
    const oudWindow = globalThis.window;
    globalThis.window = { addEventListener: (t, f) => { handlers[t] = f; } };
    attachKeyboard(eng, { venster: (v) => (v === 'L' ? 'G' : 'H') });
    globalThis.window = oudWindow;
    const toets = (code, shiftKey = false) => {
      for (const type of ['keydown', 'keyup']) handlers[type]({ code, shiftKey, target: { matches: () => false }, preventDefault() {} });
    };
    dG.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 })); dG.stop(); dG.seek(5);
    toets('KeyT', true);
    ok('toets shift+T: beatjump-lengte ×2 (8 tellen)', dG.sprongTellen === 8);
    toets('KeyT');
    ok('toets T: beatjump vooruit, 8 tellen (5 -> 9)', Math.abs(dG.position - 9) < 1e-9);
    toets('KeyR', true);
    toets('KeyG'); dG.seek(11); toets('KeyC');
    ok('toetsen shift+R, G en C: lengte terug naar 4, loop 9 – 11', dG.sprongTellen === 4 && dG.loop
      && Math.abs(dG.loop.start - 9) < 1e-9 && Math.abs(dG.loop.end - 11) < 1e-9);
    toets('KeyG', true);
    ok('toets shift+G: reloop/exit haalt de loop eraf', dG.loop === null);
    const nQ = meldingen.length;
    toets('Digit6');
    ok('toets 6: quantize aan', eng.quantize === true);
    ok('... met een melding: het toetsenbord heeft geen lampje', meldingen.length === nQ + 1
      && /quantize aan/.test(meldingen.at(-1).tekst) && meldingen.at(-1).soort === 'info');
    toets('Digit6');
    ok('... en weer uit, ook gemeld', eng.quantize === false && meldingen.length === nQ + 2 && /quantize uit/.test(meldingen.at(-1).tekst));
    druk('transport.quantize'); druk('transport.quantize');
    ok('... via de bus (scherm, APC) geen melding: daar zie je de stand', meldingen.length === nQ + 2 && eng.quantize === false);
    dG.stop(); dM.stop(); dM.seek(0); NOW = 900;
    dM.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));        // hierboven stond hij op onzeker
    toets('KeyP', true);
    ok('toets shift+P: de tweede track (H) start op de maat, zonder maatgever meteen', dM.playing && !dM.wacht);
    NOW = 900.1;
    dG.seek(8);
    toets('KeyQ', true);
    ok('toets shift+Q: de track met focus (G) wacht op het maatbegin van H (902,0)', dG.wacht && Math.abs(dG.bron.wachtTot - 902) < 1e-9);
    toets('KeyQ', true);
    ok('toets shift+Q nog een keer tijdens het wachten: geannuleerd', !dG.playing && !dG.wacht);
    dG.play();
    toets('KeyQ', true);
    ok('toets shift+Q op een spelende track: pauze, zoals vroeger', !dG.playing && !dG.wacht);
    dG.stop(); dM.stop(); dG.clearLoop();
  }
  const nieuw = ['track.7.beatjump.back', 'track.7.beatjump.fwd', 'track.7.beatjump.halve', 'track.7.beatjump.double',
    'track.7.loop.in', 'track.7.loop.out', 'track.7.loop.reloop', 'track.7.play.quant', 'transport.quantize'];
  const zonderUitleg = nieuw.filter((a) => !ids.has(a) || beschrijf(a).kort === a || beschrijf(a).lang.startsWith('?') || beschrijf(a).lang === a);
  ok(`elke nieuwe action bestaat en heeft een uitleg voor apc.html${zonderUitleg.length ? ': ' + zonderUitleg.join(', ') : ''}`, zonderUitleg.length === 0);

  eng.off?.('melding', opMelding);
  NOW = 0;
}

// ---- naad transport × hotcues per nummer (integratie ronde 3) ----------------
// Met quantize snapt een nieuwe hotcue naar de tel. De 'hotcue'-melding (die de
// app naar de library stuurt) moet de GESNAPTE tijd dragen, niet de positie van
// het indrukken: anders staat hij na herladen een fractie naast de tel.
{
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const dF = eng.deck('F');
  dF.load(eng.ctx.createBuffer(2, 48000 * 20, 48000), 'quantize-hotcue');
  dF.setGrid(new Beatgrid({ bpm: 120, firstBeat: 0 }));
  const meldingen = [];
  const uit = dF.on('hotcue', (m) => meldingen.push(m));
  eng.setQuantize(true);
  dF.seek(3.1);
  invoke('track.6.hotcue.1', true); invoke('track.6.hotcue.1', false);
  ok(`quantize: de hotcue staat op de tel (${dF.hotcues[0]}) en de melding draagt die tijd (${meldingen[0]?.tijd})`,
    dF.hotcues[0] === 3 && meldingen.length === 1 && meldingen[0].i === 0 && meldingen[0].tijd === 3);
  invoke('track.6.hotcue.1.delete', true); invoke('track.6.hotcue.1.delete', false);
  ok('wissen met quantize meldt nog steeds tijd null', meldingen.length === 2 && meldingen[1].tijd === null);
  eng.setQuantize(false);
  dF.seek(3.1);
  invoke('track.6.hotcue.1', true); invoke('track.6.hotcue.1', false);
  ok('zonder quantize: de positie van het indrukken', dF.hotcues[0] === 3.1 && meldingen[2]?.tijd === 3.1);
  uit();
}

// ---- stems (docs/STEMS.md §3) ---------------------------------------------------
// Een stems.wav: twee of vier stereoparen; uitgang k van de worklet gaat via
// stemIn[k] naar trim. Per stem een niveau en een kill, met de formule uit
// het contract, klikvrij (hellingen na startDrempel, nooit een curve), alles
// terug op open bij elke laad, en zonder stems precies het oude pad.

console.log('\nstems');
{
  const { STEM_NAMEN, controleerStems } = await import('../src/engine/deck.js');
  const { KILL_FADE } = await import('../src/engine/audio-graph.js');
  const { startDrempel } = await import('../src/engine/overgang.js');
  const { geheugenHaal } = await import('../src/engine/bron.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const { OVERSLAAN } = await import('../src/control/terugspelen.js');
  const { bijInvoke, metaOf } = await import('../src/control/actions.js');

  /** Een WAV met stereoparen naast elkaar (16 bit, interleaved), zoals stems.wav. */
  const maakWavParen = (paren, sr) => {
    const ch = paren.length * 2, n = paren[0][0].length;
    const b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b);
    const zet = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    zet(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); zet(8, 'WAVE');
    zet(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    zet(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const pcm = new Int16Array(b, 44);
    for (let i = 0; i < n; i++) for (let k = 0; k < paren.length; k++) {
      pcm[i * ch + 2 * k] = Math.round(paren[k][0][i] * 32767); pcm[i * ch + 2 * k + 1] = Math.round(paren[k][1][i] * 32767);
    }
    return b;
  };
  /** Elke aanroep op een AudioParam bijhouden: [naam, waarde, tijd]. */
  const bespioneer = (prm) => {
    const log = [];
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelAndHoldAtTime']) {
      const orig = prm[m];
      prm[m] = function (...a) { log.push([m, ...a]); return orig.apply(this, a); };
    }
    return log;
  };

  const oudWorklet = eng.ctx.audioWorklet;
  eng.ctx.audioWorklet = { addModule: async () => {} };
  const nodes = [];
  globalThis.AudioWorkletNode = nepWorkletNode(nodes);
  NOW = 1000;
  const fouten0 = OVERLAP_FOUTEN, breuk0 = CURVE_BREUK;
  const WACHT = startDrempel(eng.ctx);
  const dS = eng.deck('D');                                 // track 4
  const gIn = dS.chain.stemIn;
  const g = (k) => gIn[k].gain.value;
  const dicht = (a, b) => Math.abs(a - b) < 1e-9;
  const SR = 48000, N = SR * 4;
  const toon = (f, a) => new Float32Array(N).map((_, i) => a * Math.sin(2 * Math.PI * f * i / SR));
  const paren = [[toon(60, 0.2), toon(61, 0.2)], [toon(100, 0.15), toon(101, 0.15)], [toon(440, 0.1), toon(441, 0.1)], [toon(880, 0.25), toon(881, 0.25)]];
  const wav8 = maakWavParen(paren, SR), wav4 = maakWavParen(paren.slice(0, 2), SR);
  const pcm8 = new Int16Array(wav8, 44);
  const STEMS4 = { namen: ['drums', 'bass', 'other', 'vocals'], schaal: 0.8 };
  const STEMS2 = { namen: ['vocals', 'inst'], schaal: 0.9 };

  // 0. Zonder stems: precies het oude pad.
  ok('de kanaalstrip heeft vier stem-ingangen, allemaal op 1', gIn.length === 4 && gIn.every((x) => x.gain.value === 1));
  const spion = gIn.map((x) => bespioneer(x.gain));
  await dS.laadGeheugen(buf, 'zonder stems');
  const node = nodes.at(-1);
  ok('streamen: een node met vier uitgangen van twee kanalen, uitgang k naar stemIn[k]', node.numberOfOutputs === 4
    && node.outputChannelCount.join() === '2,2,2,2' && node.verbindingen.length === 4 && node.verbindingen.every((v, k) => v.doel === gIn[k] && v.uitgang === k));
  ok('zonder stems: alle versterkingen op 1, niet eens aangeraakt (bit voor bit het oude pad)',
    gIn.every((x) => x.gain.value === 1) && spion.every((l) => l.length === 0));
  ok('zonder stems: deck.stems null, elke stem-read null, snapshot null', dS.stems === null && eng.snapshot().decks.D.stems === null
    && STEM_NAMEN.every((st) => ['', '.kill', '.hold'].every((x) => read(`track.4.stem.${st}${x}`) === null)));
  invoke('track.4.stem.vocals', 0.2); invoke('track.4.stem.vocals.kill', true); invoke('track.4.stem.inst.hold', true);
  invoke('track.4.stem.inst.hold', false);
  ok('… en een stem-action doet dan niets', gIn.every((x) => x.gain.value === 1) && spion.every((l) => l.length === 0) && !dS.stemGekild('vocals'));

  // Na een los bestand (laadGeheugen was de eerste laad van dit deck) haalt een
  // library-laad zonder eigen `haal` van de SERVER, niet uit dat geheugen.
  // Eerst werd de `haal` van de eerste laad de standaard van de bron, en speelde
  // het library-nummer het losse bestand onder de goede titel (review 3 okt).
  const oudeFetch = globalThis.fetch;
  const gevraagd = [];
  const wavLib = maakWavParen([paren[0]].map(([l, r]) => [l.subarray(0, SR * 2), r.subarray(0, SR * 2)]), SR);
  globalThis.fetch = async (url, init) => { gevraagd.push(url); return geheugenHaal(wavLib)(url, init); };
  await dS.laadStream('/media/lib/audio.wav', 'library-nummer');
  globalThis.fetch = oudeFetch;
  ok(`na een los bestand: een library-laad haalt van de server (${gevraagd.length} verzoeken, ${dS.duration} s)`,
    gevraagd.length > 0 && gevraagd.every((u) => u === '/media/lib/audio.wav') && dicht(dS.duration, 2) && dS.title === 'library-nummer');

  // 1. Vier stems.
  NOW = 1001;
  const geladen = await dS.laadStream('/media/x/stems.wav', 'vier stems', { haal: geheugenHaal(wav8), stems: STEMS4 });
  ok('laden met vier stems: deck.stems, 8 kanalen, dezelfde node', geladen && dS.stems?.aantal === 4 && dS.stems.schaal === 0.8
    && dS.stems.namen.join() === 'drums,bass,other,vocals' && dS.bron.kanalen === 8 && nodes.length === 1
    && node.port.berichten.filter((m) => m.type === 'bron').at(-1).kanalen === 8);
  ok('… alle uitgangen op 1/schaal (1,25: de som even hard als audio.wav)', [0, 1, 2, 3].every((k) => dicht(g(k), 1.25)));
  ok('… met een klikvrije overgang (hellingen na de startdrempel), geen curve',
    spion.every((l) => l.some((c) => c[0] === 'linearRampToValueAtTime') && !l.some((c) => c[0] === 'setValueCurveAtTime')));
  ok('reads: elke stem van de stand op 1, inst (de groep) ook, drums/bas/overig bestaan; kill 0', ['drums', 'bass', 'other', 'vocals', 'inst']
    .every((st) => read(`track.4.stem.${st}`) === 1 && read(`track.4.stem.${st}.kill`) === 0 && read(`track.4.stem.${st}.hold`) === 0));

  spion.forEach((l) => { l.length = 0; });
  invoke('track.4.stem.inst', 0.5);
  ok('inst bij vier stems: drums, bas en overig samen ×0,5; de zang niet', [0, 1, 2].every((k) => dicht(g(k), 0.625)) && dicht(g(3), 1.25));
  ok('… een niveau is een doelwaarde (setTargetAtTime, geen helling), en de zang wordt niet aangeraakt',
    spion[0].some((c) => c[0] === 'setTargetAtTime' && dicht(c[1], 0.625)) && !spion[0].some((c) => c[0] === 'linearRampToValueAtTime') && spion[3].length === 0);
  invoke('track.4.stem.drums', 0.4);
  ok('drums ×0,4 bovenop inst ×0,5: 1,25 × 0,4 × 0,5', dicht(g(0), 0.25) && dicht(g(1), 0.625) && read('track.4.stem.drums') === 0.4);

  // Kill: de vorm van de overgang, in amplitude een zachte S, na de startdrempel.
  spion.forEach((l) => { l.length = 0; });
  invoke('track.4.stem.inst.kill', true); invoke('track.4.stem.inst.kill', false);
  ok('kill inst: drums, bas en overig weg, de zang blijft', [0, 1, 2].every((k) => g(k) === 0) && dicht(g(3), 1.25) && spion[3].length === 0);
  ok('… lampjes: inst weg (1), de niveaus blijven staan', read('track.4.stem.inst.kill') === 1 && read('track.4.stem.inst.hold') === 1
    && read('track.4.stem.inst') === 0.5 && read('track.4.stem.drums') === 0.4 && read('track.4.stem.drums.kill') === 0);
  {
    const l = spion[1];
    const zet = l.filter((c) => c[0] === 'setValueAtTime'), hel = l.filter((c) => c[0] === 'linearRampToValueAtTime');
    const van = zet[0]?.[1], punten = [van, ...hel.map((c) => c[1])];
    const weg = Math.abs(van - 0);
    let grootste = 0, eerste = Math.abs(punten[1] - punten[0]), laatste = Math.abs(punten[32] - punten[31]), daalt = true;
    for (let i = 1; i < punten.length; i++) { grootste = Math.max(grootste, Math.abs(punten[i] - punten[i - 1])); if (punten[i] > punten[i - 1] + 1e-12) daalt = false; }
    ok(`… de overgang: vasthouden op nu, ${hel.length} hellingen vanaf nu + ${(WACHT * 1000).toFixed(1)} ms, ${KILL_FADE * 1000} ms lang`,
      l[0][0] === 'cancelAndHoldAtTime' && zet.length === 2 && zet[0][2] === NOW && dicht(zet[1][2], NOW + WACHT)
      && hel.length === 32 && dicht(hel.at(-1)[2], NOW + WACHT + KILL_FADE) && hel.at(-1)[1] === 0);
    ok(`… in amplitude een zachte S: eerste en laatste stap ${(100 * eerste / weg).toFixed(2)}% / ${(100 * laatste / weg).toFixed(2)}%, grootste ${(100 * grootste / weg).toFixed(1)}% van de weg`,
      daalt && eerste < 0.005 * weg && laatste < 0.005 * weg && grootste < 0.06 * weg && dicht(van, 0.625));
  }
  spion.forEach((l) => { l.length = 0; });
  invoke('track.4.stem.bass', 0.3);
  ok('niveau draaien op een stem die weg is: de overgang loopt gewoon uit (niets aangeraakt), het niveau onthouden',
    spion[1].length === 0 && g(1) === 0 && read('track.4.stem.bass') === 0.3);
  NOW += WACHT + 0.001;                                       // midden in de kill-overgang
  let gegooid = null;
  try { invoke('track.4.stem.inst.kill', true); } catch (e) { gegooid = e; }
  ok('kill uit, 1 ms na het begin van de overgang: geen fout, geen afgebroken curve, precies terug op de niveaus',
    gegooid === null && OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0
    && dicht(g(0), 1.25 * 0.4 * 0.5) && dicht(g(1), 1.25 * 0.3 * 0.5) && dicht(g(2), 0.625) && read('track.4.stem.inst.kill') === 0);

  // Drukknop en schakelaar samen, zoals de EQ-kill.
  NOW += 1;
  invoke('track.4.stem.vocals.hold', true);
  ok('zang weg zolang je drukt (beide lampjes 1)', g(3) === 0 && read('track.4.stem.vocals.hold') === 1 && read('track.4.stem.vocals.kill') === 1);
  NOW += 0.2;
  invoke('track.4.stem.vocals.hold', false);
  ok('loslaten: terug', dicht(g(3), 1.25) && read('track.4.stem.vocals.kill') === 0);
  invoke('track.4.stem.vocals.kill', true);
  NOW += 0.2; invoke('track.4.stem.vocals.hold', true); NOW += 0.2; invoke('track.4.stem.vocals.hold', false);
  ok('schakelaar aan, dan drukken en loslaten: blijft weg', g(3) === 0 && dS.stemGekild('vocals'));

  // De snapshot.
  const sn = eng.snapshot().decks.D.stems;
  ok('snapshot: namen, niveau en weg per stem (bij vier ook inst)', sn && sn.namen.join() === 'drums,bass,other,vocals'
    && sn.niveau.inst === 0.5 && sn.niveau.drums === 0.4 && sn.niveau.bass === 0.3 && sn.weg.vocals === true && sn.weg.inst === false
    && Object.keys(sn.niveau).length === 5);

  // Knippen voor de sampler: wat je hoort vóór de EQ (de zang is weg).
  const gew = dS.knipGewichten();
  ok('knipGewichten: per paar de versterking van nu (zang 0)', gew.length === 4 && dicht(gew[0], 0.25) && dicht(gew[1], 0.1875) && dicht(gew[2], 0.625) && gew[3] === 0);
  dS.seek(3);
  const sm = eng.sampler;
  const oudeTellen = sm.tellen;
  sm.tellen = 4;
  await sm.neem(5, dS);
  const pad = sm.pads[5];
  let afw = 0, zangErin = 0;
  for (const i of [1000, 20000, 60123]) {             // (op 2,25 s staan alle vier de tonen op nul)
    let l = 0, metZang = 0;
    for (let k = 0; k < 4; k++) { const x = pcm8[(SR + i) * 8 + 2 * k] / 32768; l += gew[k] * x; metZang += (k === 3 ? 1.25 : gew[k]) * x; }
    afw = Math.max(afw, Math.abs(pad.buffer.getChannelData(0)[i] - l));
    zangErin = Math.max(zangErin, Math.abs(metZang - l));
  }
  ok(`sampler: een pad geknipt terwijl de zang weg is, klinkt zonder zang (afwijking ${afw.toExponential(1)}, de zang was ${zangErin.toFixed(2)})`,
    pad && afw < 1e-6 && zangErin > 0.05);
  sm.wis(5);
  sm.tellen = oudeTellen;

  // 2. Twee stems: inst is een eigen paar; drums, bas en overig bestaan niet.
  NOW += 1;
  ok('laden met twee stems', await dS.laadStream('/media/x/stems2.wav', 'twee stems', { haal: geheugenHaal(wav4), stems: STEMS2 }));
  ok('… bij elke laad alles terug op open: niveaus 1, geen kill (ook de zang die weg stond)',
    !dS.stemGekild('vocals') && read('track.4.stem.vocals') === 1 && read('track.4.stem.inst') === 1 && read('track.4.stem.vocals.kill') === 0);
  ok('… uitgang 0 en 1 op 1/0,9, de ongebruikte op 1', dicht(g(0), 1 / 0.9) && dicht(g(1), 1 / 0.9) && g(2) === 1 && g(3) === 1);
  ok('… drums, bas en overig: read null (bestaan niet in deze stand)', ['drums', 'bass', 'other'].every((st) => ['', '.kill', '.hold'].every((x) => read(`track.4.stem.${st}${x}`) === null)));
  invoke('track.4.stem.drums', 0.1); invoke('track.4.stem.bass.kill', true);
  ok('… en doen niets', dicht(g(0), 1 / 0.9) && dicht(g(1), 1 / 0.9));
  invoke('track.4.stem.inst', 0);
  ok('inst bij twee stems: het eigen paar (uitgang 1) dicht, de zang niet', g(1) === 0 && dicht(g(0), 1 / 0.9));
  invoke('track.4.stem.vocals.kill', true);
  ok('zang weg bij twee stems: uitgang 0', g(0) === 0);
  ok('snapshot bij twee: alleen vocals en inst', Object.keys(eng.snapshot().decks.D.stems.niveau).join() === 'vocals,inst');

  // 3. Weigeren: het aantal kanalen past niet, of de stems kloppen niet. De oude track blijft.
  NOW += 1;
  let reden = null;
  await dS.laadStream('/media/x/stems2.wav', 'fout', { haal: geheugenHaal(wav4), stems: STEMS4 }).catch((e) => { reden = e.message; });
  ok(`4 kanalen voor vier stems: geweigerd met een reden ("${reden}")`, /4 kanalen/.test(reden || '') && /verwacht 8/.test(reden));
  ok('… de oude track blijft, met zijn stems en zijn stand', dS.title === 'twee stems' && dS.stems?.aantal === 2 && g(0) === 0 && read('track.4.stem.inst') === 0);
  reden = null;
  await dS.laadStream('/media/x/stems.wav', 'fout', { haal: geheugenHaal(wav8) }).catch((e) => { reden = e.message; });
  ok(`een stems.wav zonder stems opgegeven: geweigerd ("${reden}")`, /verwacht stereo/.test(reden || ''));
  for (const [st, wat] of [[{ namen: ['vocals', 'drums'] }, 'verkeerde namen'], [{ namen: ['vocals', 'inst', 'bass'] }, 'drie stems'],
    [{ namen: ['vocals', 'vocals'] }, 'dubbel'], [{ namen: ['vocals', 'inst'], schaal: 0 }, 'schaal 0'], [{ namen: ['vocals', 'inst'], schaal: 1.5 }, 'schaal 1,5']]) {
    reden = null;
    const voor = node.port.berichten.length;
    await dS.laadStream('/media/x/stems2.wav', 'fout', { haal: geheugenHaal(wav4), stems: st }).catch((e) => { reden = e.message; });
    ok(`stems met ${wat}: geweigerd vóór er iets gebeurt ("${reden}")`, !!reden && controleerStems(st) === reden && node.port.berichten.length === voor && dS.title === 'twee stems');
  }
  ok('controleerStems: de twee standen in elke volgorde zijn goed', controleerStems(STEMS4) === null && controleerStems({ namen: ['inst', 'vocals'] }) === null);

  // 4. Weer een nummer zonder stems: alles terug op 1, het oude pad.
  NOW += 1;
  await dS.laadGeheugen(buf, 'weer zonder');
  ok('een nummer zonder stems na stems: versterkingen terug op 1, stems null, reads null',
    gIn.every((x) => x.gain.value === 1) && dS.stems === null && read('track.4.stem.vocals') === null);

  // 5. De actions: bestaan, soort, uitleg; terugspelen en het log.
  const ids = new Set(list().map((a) => a.id));
  const stemActies = STEM_NAMEN.flatMap((st) => [`track.4.stem.${st}`, `track.4.stem.${st}.kill`, `track.4.stem.${st}.hold`]);
  ok(`15 stem-actions per track (vocals, inst, drums, bass, other × niveau/kill/hold), op alle acht tracks`,
    stemActies.every((a) => ids.has(a)) && [1, 2, 3, 5, 6, 7, 8].every((t) => ids.has(`track.${t}.stem.other.hold`)));
  ok('niveau = value, kill en hold = trigger, met een Nederlands label', STEM_NAMEN.every((st) => metaOf(`track.4.stem.${st}`).type === 'value'
    && metaOf(`track.4.stem.${st}.kill`).type === 'trigger' && metaOf(`track.4.stem.${st}.hold`).type === 'trigger')
    && /zang/.test(metaOf('track.4.stem.vocals').label) && /bas/.test(metaOf('track.4.stem.bass.kill').label));
  const kaal = stemActies.filter((a) => beschrijf(a).kort === a || beschrijf(a).lang.startsWith('?') || beschrijf(a).lang === a);
  ok(`elke stem-action heeft een uitleg op de APC-kaart${kaal.length ? ': ' + kaal.join(', ') : ''}`, kaal.length === 0);
  ok('terugspelen slaat stem-actions niet over', stemActies.every((a) => !OVERSLAAN.test(a)));
  const gehoord = [];
  const stop = bijInvoke((id, v) => gehoord.push([id, v]));
  invoke('track.4.stem.vocals', 0.7); invoke('track.4.stem.drums.kill', true); invoke('track.4.stem.inst.hold', false);
  stop();
  ok('het handelingenlog hoort ze via de bus', gehoord.length === 3 && gehoord[0][0] === 'track.4.stem.vocals' && gehoord[0][1] === 0.7);

  ok('geen overlappende automatisering en geen afgebroken curve bij al dat schakelen', OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
  dS.load(buf, 'terug naar buffer');
  eng.ctx.audioWorklet = oudWorklet;
  NOW = 0;
}

// ---- glijden (Deck.glide, de auto-DJ: AUTO-DJ.md §2b) ------------------------
// Een deck met een TIJDLIJN op zijn AudioParams (test/nep-tijdlijn.mjs): zo is
// te zien wat de parameter op elk moment doet, niet alleen zijn laatste doel.
{
  const { Deck, GLIJ } = await import('../src/engine/deck.js');
  const { faderGain, filterDoelen } = await import('../src/engine/audio-graph.js');
  const { maakTijdlijn } = await import('./nep-tijdlijn.mjs');
  const TLE = maakTijdlijn(() => NOW);
  const tctx = new AudioContext();
  for (const m of ['createGain', 'createBiquadFilter']) {
    const orig = tctx[m].bind(tctx);
    tctx[m] = () => { const n = orig(); for (const k of ['gain', 'frequency', 'Q']) n[k] = TLE.param(n[k].value); return n; };
  }
  const dt = new Deck(tctx, 'T');
  const fp = dt.chain.fader.gain;
  const knopDb = (u) => 20 * Math.log10(faderGain(u));
  const db = (g) => 20 * Math.log10(g);
  dt.set('fader', 0.2);
  NOW += 1;
  const t = NOW;
  const lin0 = fp.n.lin, doel0 = fp.n.target;
  dt.glide('fader', 0.8);
  ok(`glide: de knop staat meteen op zijn doel in de opslag, maar ui.fader leest de stand van NU (${dt.ui.fader})`,
    dt._ui.fader === 0.8 && dt.ui.fader === 0.2);
  ok(`... als lineaire hellingen op de AudioParam, geen setTarget en geen curve (${fp.n.lin - lin0} hellingen)`,
    fp.n.lin - lin0 >= 4 && fp.n.target === doel0 && fp.n.curve === 0);
  // Knop en geluid lopen samen, elke 10 ms over de hele glijbeurt.
  let afwijking = 0, stijgt = true, vorige = -1;
  for (let x = 0; x <= GLIJ + 0.05; x += 0.01) {
    NOW = t + x;
    const u = dt.ui.fader;
    afwijking = Math.max(afwijking, Math.abs(knopDb(u) - db(fp.waarde(NOW))));
    if (u < vorige) stijgt = false;
    vorige = u;
  }
  ok(`read() volgt de audioklok: de knop loopt in ${GLIJ} s van 0,2 naar 0,8 en het geluid wijkt hooguit ${afwijking.toFixed(3)} dB af`,
    stijgt && afwijking < 0.2 && dt.ui.fader === 0.8);
  // Halverwege opnieuw richten: de oude helling loopt door tot na startDrempel,
  // de nieuwe begint precies daar. Geen sprong en geen plateau.
  dt.set('fader', 0.2);
  NOW += 1;
  dt.glide('fader', 0.8);
  NOW += GLIJ / 2;
  const t1 = NOW;
  const oud = Array.from({ length: 40 }, (_, k) => fp.waarde(t1 + k * 0.001));
  const knopOud = Array.from({ length: 40 }, (_, k) => dt._stand('fader', t1 + k * 0.001));
  dt.glide('fader', 0.3);
  const nieuw = Array.from({ length: 40 }, (_, k) => fp.waarde(t1 + k * 0.001));
  const knopNieuw = Array.from({ length: 40 }, (_, k) => dt._stand('fader', t1 + k * 0.001));
  const g = dt._glij.fader;
  const nVoor = oud.findIndex((_, k) => t1 + k * 0.001 >= g.t0);
  ok(`opnieuw richten midden in een glijbeurt: tot ${((g.t0 - t1) * 1000).toFixed(1)} ms loopt de oude door, geluid en knop precies`,
    nVoor > 2 && oud.slice(0, nVoor).every((v, k) => v === nieuw[k]) && knopOud.slice(0, nVoor).every((v, k) => v === knopNieuw[k]));
  let sprong = 0, plateau = 0;
  for (let k = 1; k < 40; k++) {
    sprong = Math.max(sprong, Math.abs(db(nieuw[k]) - db(nieuw[k - 1])));
    if (k > nVoor + 1 && Math.abs(nieuw[k] - nieuw[k - 1]) < 1e-12) plateau++;
  }
  ok(`... en daarna de nieuwe kant op zonder sprong (hooguit ${sprong.toFixed(3)} dB per ms) en zonder stilstand (${plateau})`,
    sprong < 0.2 && plateau === 0 && nieuw[39] < nieuw[nVoor] && knopNieuw[39] < knopNieuw[nVoor]);
  // Ingrijpen (een gewone set, Clay's fader) midden in een glijbeurt.
  NOW += 0.02;
  const t2 = NOW, voor = fp.waarde(t2), gepland = fp.waarde(t2 + GLIJ);
  dt.set('fader', 1);
  ok(`set midden in een glijbeurt: het geluid gaat verder waar het NU is (${db(voor).toFixed(3)} dB), geen sprong`,
    Math.abs(fp.waarde(t2) / voor - 1) < 1e-12 &&fp.waarde(t2 + 0.001) > voor && fp.waarde(t2 + 0.001) < faderGain(1));
  ok(`... de rest van de glijbeurt is weg: na ${GLIJ} s op de nieuwe stand, niet op ${db(gepland).toFixed(2)} dB; de knop meteen`,
    Math.abs(fp.waarde(t2 + GLIJ) / faderGain(1) - 1) < 1e-6 && dt.ui.fader === 1 && !dt._glij.fader);
  // Filter: vier parameters, in Hz langs de knop (exponentieel, dus in octaven gelijkmatig).
  NOW += 1;
  const t3 = NOW;
  dt.glide('filter', 0.15);
  let oct = 0;
  for (let x = 0.02; x <= GLIJ; x += 0.02) {
    const [, , lf] = filterDoelen(dt._stand('filter', t3 + x));
    oct = Math.max(oct, Math.abs(Math.log2(dt.chain.lpf.frequency.waarde(t3 + x) / lf)));
  }
  const eindF = filterDoelen(0.15);
  ok(`filter glijdt: lowpass langs de knop (hooguit ${oct.toFixed(3)} octaaf ernaast), en eindigt op ${Math.round(eindF[2])} Hz, Q ${eindF[3].toFixed(2)}`,
    oct < 0.05 && Math.abs(dt.chain.lpf.frequency.waarde(t3 + GLIJ + 0.01) - eindF[2]) < 1e-6 && Math.abs(dt.chain.lpf.Q.waarde(t3 + GLIJ) - eindF[3]) < 1e-9);
  dt.glide('sendB', 0.6);
  ok('send glijdt kwadratisch, zoals de knop (0,6 → gain 0,36)', Math.abs(dt.sendB.gain.waarde(NOW + GLIJ) - 0.36) < 1e-9 && dt.ui.sendB < 0.6);
  dt.glide('low', 0.3);
  ok('een knop die niet glijdt (de bas: een schakelaar in de overgang) wordt een gewone set', dt.ui.low === 0.3 && dt._glij && !dt._glij.low);
  const sn = { ...dt.ui };
  ok(`snapshot van ui (spreiden) geeft de tussenstand als getal (${sn.sendB})`, typeof sn.sendB === 'number' && sn.sendB < 0.6 && sn.sendB >= 0);
  dt.ui.sendB = 0.1;
  ok('schrijven in ui (zoals tests doen) stopt het glijden', dt.ui.sendB === 0.1 && dt._glij && !dt._glij.sendB);
  ok(`geen curve, geen breuk, geen NotSupportedError op het glijdende deck (${TLE.stats.CURVE_BREUK} / ${TLE.stats.OVERLAP_FOUTEN}), en er werd geglijd`,
    TLE.stats.CURVE_BREUK === 0 && TLE.stats.OVERLAP_FOUTEN === 0 && fp.n.curve === 0 && fp.n.lin > 0);
  // Via de bus, op de echte engine (de strenge mock van deze test).
  const dE = eng.deck('E');
  invoke('track.5.fader', 0.1);
  NOW += 1;
  invoke('track.5.fader.glide', 0.9);
  NOW += 0.1;
  invoke('track.5.filter.glide', 0.3); invoke('track.5.send.a.glide', 0.4); invoke('track.5.send.b.glide', 0.2);
  invoke('track.5.fader.glide', 0.7);
  const r = read('track.5.fader');
  NOW += GLIJ;
  ok(`de bus: track.5.fader.glide (en filter, send.a, send.b): read volgt (${r.toFixed(3)} → ${read('track.5.fader')}), zonder read op de glijactie zelf`,
    r > 0.1 && r < 0.9 && read('track.5.fader') === 0.7 && dE.ui.filter === 0.3 && dE.ui.sendA === 0.4 && dE.ui.sendB === 0.2
    && read('track.5.fader.glide') === null);
  invoke('track.5.fader', 1); invoke('track.5.filter', 0.5); invoke('track.5.send.a', 0); invoke('track.5.send.b', 0);
}

// ---- koptelefoon (docs/STUDIO.md §3, ROADMAP 27 S1) ---------------------------
// Eén uitgang met vier kanalen: 1/2 de zaal, 3/4 de koptelefoon. Zonder vier
// kanalen bestaat er niets van: het oude pad. De cue tapt vóór de fader, gaat
// klikvrij aan en uit, en de zaal merkt er niets van.
console.log('\nkoptelefoon');
{
  const { KANALEN, kanApart } = await import('../src/engine/koptelefoon.js');
  const { faderGain } = await import('../src/engine/audio-graph.js');
  const { DECK_IDS } = await import('../src/engine/engine.js');
  const { startDrempel } = await import('../src/engine/overgang.js');
  const { OVERSLAAN } = await import('../src/control/terugspelen.js');
  const { NIET_IN_WAARDEN } = await import('../src/control/handelingen.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const { readFileSync } = await import('node:fs');
  const dicht = (a, b) => Math.abs(a - b) < 1e-9;
  const NOW0 = NOW;
  const TRACKNRS = [1, 2, 3, 4, 5, 6, 7, 8];
  const fouten0 = OVERLAP_FOUTEN, breuk0 = CURVE_BREUK;

  // 0. Zonder vier kanalen (deze mock heeft geen maxChannelCount): het oude pad.
  const k0 = eng.koptelefoon;
  ok('zonder vier kanalen: geen koptelefoon, de zaal gaat gewoon naar de uitgang', !k0.beschikbaar && k0.zaalIn === eng.ctx.destination);
  ok('… elke cue en de koptelefoonknoppen lezen null (lampje uit)', TRACKNRS.every((t) => read(`track.${t}.pfl`) === null)
    && read('headphone.level') === null && read('headphone.mix') === null);
  invoke('track.2.pfl', true); invoke('track.2.pfl', false);
  ok('… en een cue doet dan niets', !k0.iets && read('track.2.pfl') === null && eng.snapshot().koptelefoon.beschikbaar === false);
  const vak = (max, splitter = true) => ({ destination: { maxChannelCount: max }, createChannelMerger() {}, ...(splitter ? { createChannelSplitter() {} } : {}) });
  ok('kanApart: pas vanaf vier kanalen, en alleen met splitter en merger', !kanApart(vak(2)) && kanApart(vak(4)) && kanApart(vak(8)) && !kanApart(vak(4, false)));

  // 1. Met vier kanalen: een mock die bijhoudt wat waarheen gaat.
  const Oud = globalThis.AudioContext;
  const lijnen = [];                                        // [van, naar, uitgang, ingang]
  const volg = (n) => { n.connect = (doel, uit = 0, inn = 0) => { lijnen.push([n, doel, uit, inn]); return doel; }; return n; };
  const Vier = class extends Oud {
    constructor(o) { super(o); this.destination.maxChannelCount = 4; volg(this.destination); }
    createGain() { return volg(super.createGain()); }
    createBiquadFilter() { return volg(super.createBiquadFilter()); }
    createDynamicsCompressor() { return volg(super.createDynamicsCompressor()); }
    createAnalyser() { return volg(super.createAnalyser()); }
    createDelay(max) { const n = volg(super.createDelay(max)); n.delayTime = n.delayTime ?? param(0); return n; }
    createChannelMerger(n) { return Object.assign(volg(super.createChannelMerger(n)), { numberOfInputs: n }); }
    createChannelSplitter(n) { return Object.assign(volg(node('splitter')), { numberOfOutputs: n }); }
  };
  const heeft = (van, doel, uit, inn) => lijnen.some((l) => l[0] === van && l[1] === doel
    && (uit === undefined || l[2] === uit) && (inn === undefined || l[3] === inn));
  globalThis.AudioContext = Vier;
  const e4 = new Engine();
  globalThis.AudioContext = Oud;
  const kt = e4.koptelefoon, dst = e4.ctx.destination;
  const kop = lijnen.find((l) => l[0] === kt.uit)?.[1];
  ok('met vier kanalen: de koptelefoon bestaat, de uitgang op 4 kanalen, explicit, discrete', kt.beschikbaar && kt.kanalen === 4
    && dst.channelCount === KANALEN && dst.channelCountMode === 'explicit' && dst.channelInterpretation === 'discrete');
  ok('… de zaal op kanaal 1/2, de koptelefoon op 3/4, samen naar de uitgang', heeft(kt.zaalIn, kt.merger, 0, 0) && heeft(kt.zaalIn, kt.merger, 1, 1)
    && heeft(kop, kt.merger, 0, 2) && heeft(kop, kt.merger, 1, 3) && heeft(kt.merger, dst) && kt.merger.numberOfInputs === 4);
  ok('… de master na de limiter naar de zaal én de zaalkant van de koptelefoon, niet meer rechtstreeks naar de uitgang',
    heeft(e4.master.limiter, e4.master.analyser) && heeft(e4.master.analyser, kt.zaalIn) && heeft(e4.master.analyser, kt.zaalKant) && !heeft(e4.master.analyser, dst));
  const pfls = DECK_IDS.map((id) => kt._pfl.get(id)?.gain);
  ok('… per track een cue vóór de fader: filter → cue (dicht) → som; de fader blijft gewoon', DECK_IDS.every((id, i) => {
    const ch = e4.deck(id).chain;
    return pfls[i] && heeft(ch.lpf, pfls[i]) && heeft(pfls[i], kt.cue) && heeft(ch.lpf, ch.fader) && pfls[i].gain.value === 0;
  }));
  ok('… zonder cue hoort de koptelefoon de zaal (zaalkant 1); volume als een fader op 0,8', kt.zaalKant.gain.value === 1
    && dicht(kt.uit.gain.value, faderGain(0.8)) && heeft(kt.cue, kt.cueVertraging) && heeft(kt.cueVertraging, kt.cueKant)
    && heeft(kt.cueKant, kt.uit) && heeft(kt.zaalKant, kt.uit));
  ok(`… de cue even laat als de zaal: vertraging = die van de master (${(e4.master.vertraging * 1000).toFixed(2)} ms, de vooruitblik)`,
    e4.master.vertraging > 0 && dicht(kt.cueVertraging.delayTime.value, e4.master.vertraging) && dicht(kt.stand().vertraging, e4.master.vertraging));

  // 2. Via de bus.
  bindEngine(e4);
  NOW = 3000;
  const WACHT = startDrempel(e4.ctx);
  ok('reads: elke cue 0, volume 0,8, mix 0', TRACKNRS.every((t) => read(`track.${t}.pfl`) === 0) && read('headphone.level') === 0.8 && read('headphone.mix') === 0);
  const spion = [];
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelAndHoldAtTime']) {
    const orig = pfls[1].gain[m];
    pfls[1].gain[m] = function (...a) { spion.push([m, ...a]); return orig.apply(this, a); };
  }
  const master0 = e4.master.gain.gain.value;
  invoke('track.2.pfl', true); invoke('track.2.pfl', false);
  ok('● op track 2: de cue aan (lampje 1), de rest niet', read('track.2.pfl') === 1 && read('track.1.pfl') === 0 && kt.iets);
  ok(`… klikvrij: vasthouden, dan hellingen vanaf nu + ${(WACHT * 1000).toFixed(1)} ms naar 1, geen curve`,
    spion[0]?.[0] === 'cancelAndHoldAtTime' && spion.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1 && c[2] > NOW + WACHT)
    && !spion.some((c) => c[0] === 'setValueCurveAtTime') && pfls[1].gain.value === 1);
  ok('… mix 0: alleen de cue in de koptelefoon, de zaal eruit', dicht(kt.cueKant.gain.value, 1) && dicht(kt.zaalKant.gain.value, 0));
  invoke('headphone.mix', 0.5);
  ok('mix in het midden: cue en zaal elk −3 dB (equal power)', dicht(kt.cueKant.gain.value, Math.SQRT1_2) && dicht(kt.zaalKant.gain.value, Math.SQRT1_2) && read('headphone.mix') === 0.5);
  invoke('headphone.mix', 1);
  ok('mix rechts: alleen de zaal', dicht(kt.cueKant.gain.value, 0) && dicht(kt.zaalKant.gain.value, 1));
  invoke('headphone.mix', 0);
  invoke('headphone.level', 0.5);
  ok('volume: de curve van een fader', dicht(kt.uit.gain.value, faderGain(0.5)) && read('headphone.level') === 0.5);
  NOW += 1;
  invoke('track.5.pfl', true);
  ok('twee cues tegelijk', read('track.2.pfl') === 1 && read('track.5.pfl') === 1 && pfls[4].gain.value === 1);
  NOW += WACHT + 0.001;                                     // midden in de overgang van track 5
  let gegooid = null;
  try { invoke('track.5.pfl', true); } catch (e) { gegooid = e; }
  ok('cue uit, 1 ms na het begin van de overgang: geen fout, geen afgebroken curve', gegooid === null && read('track.5.pfl') === 0
    && OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
  NOW += 1;
  invoke('track.2.pfl', true);
  ok('alles uit: de koptelefoon hoort de zaal weer, vol', !kt.iets && kt.zaalKant.gain.value === 1 && pfls[1].gain.value === 0 && pfls[4].gain.value === 0);
  ok('de zaal merkt niets: de master niet aangeraakt', e4.master.gain.gain.value === master0);
  const sn = e4.snapshot().koptelefoon;
  // Sinds de stemkanalen (5 okt) staat er per track ook `A:stems` in: de stem-cue.
  ok('snapshot: beschikbaar, 4 kanalen, volume, mix en de cue per track (en per track de stem-cue)', sn.beschikbaar && sn.kanalen === 4 && sn.niveau === 0.5 && sn.mix === 0
    && !sn.iets && Object.keys(sn.pfl).filter((k) => !k.includes(':')).join() === DECK_IDS.join()
    && Object.keys(sn.pfl).filter((k) => k.includes(':')).join() === DECK_IDS.map((id) => `${id}:stems`).join()
    && Object.values(sn.pfl).every((v) => v === false));
  bindEngine(eng);

  // 3. Omgewisseld (een samengesteld apparaat in de andere volgorde).
  lijnen.length = 0;
  globalThis.AudioContext = Vier;
  const e5 = new Engine({ koptelefoon: { omgewisseld: true } });
  globalThis.AudioContext = Oud;
  const k5 = e5.koptelefoon, kop5 = lijnen.find((l) => l[0] === k5.uit)?.[1];
  ok('omgewisseld: de zaal op 3/4, de koptelefoon op 1/2', k5.stand().omgewisseld && heeft(k5.zaalIn, k5.merger, 0, 2) && heeft(k5.zaalIn, k5.merger, 1, 3)
    && heeft(kop5, k5.merger, 0, 0) && heeft(kop5, k5.merger, 1, 1));

  // 4. Log, terugspelen, uitleg en de APC.
  ok('terugspelen slaat de koptelefoon over, en hij staat niet in de beginstand van het log',
    ['track.3.pfl', 'headphone.level', 'headphone.mix'].every((a) => OVERSLAAN.test(a))
    && ['headphone.level', 'headphone.mix'].every((a) => NIET_IN_WAARDEN.test(a))
    && !OVERSLAAN.test('track.3.play') && !OVERSLAAN.test('track.3.pfl.x') && !NIET_IN_WAARDEN.test('track.3.fader'));
  ok('elke koptelefoon-action heeft een uitleg op de APC-kaart', ['track.1.pfl', 'headphone.level', 'headphone.mix']
    .every((a) => beschrijf(a).kort !== a && !beschrijf(a).lang.startsWith('?')));
  const std = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  const pflRegels = std.rules.filter((r) => /\.pfl$/.test(r.action));
  ok('APC: ● zonder shift = cue, in elke kolom; ● met shift blijft het cuepunt', pflRegels.length === 8
    && pflRegels.every((r, i) => r.in === `note:${i}:48` && !r.shift && !r.laag && r.action === `track.${i + 1}.pfl` && r.mode === 'trigger')
    && TRACKNRS.every((t) => std.rules.some((r) => r.in === `note:${t - 1}:48` && r.shift && r.action === `track.${t}.cue`)));
  NOW = NOW0;
}

// ---- stemkanalen (docs/STEMS.md §5, 5 okt) -------------------------------------
// Per stem een filter, een echo- en galm-send en een cue. De droge weg
// stemIn[k] -> trim blijft wat hij was; het filter is een correctie ernaast
// (x + H(g·x) − g·x, met g = 0 precies x), en elk deel van een stemkanaal komt
// er pas bij als het voor het eerst iets moet doen, stil (zoals een nieuwe
// keten in de insert-slot). Stem-sends gaan door een spiegel van de fader
// (fader dicht = niets meer insturen, ook tijdens het glijden van de auto-DJ);
// de groepsknop inst werkt op drums, bas en overig samen (filter in serie,
// sends de grootste, cue of).
console.log('\nstemkanalen');
{
  const { Deck, STEM_NAMEN, STEM_FILTER_TERUG, GLIJ } = await import('../src/engine/deck.js');
  const { faderGain, filterDoelen, stemFilterDoelen, stemFilterOpen, STEM_MIDDEN } = await import('../src/engine/audio-graph.js');
  const { startDrempel } = await import('../src/engine/overgang.js');
  const { maakTijdlijn } = await import('./nep-tijdlijn.mjs');
  const { geheugenHaal } = await import('../src/engine/bron.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const { OVERSLAAN, NUMMER_NODIG } = await import('../src/control/terugspelen.js');
  const { NIET_IN_WAARDEN } = await import('../src/control/handelingen.js');
  const { metaOf, has } = await import('../src/control/actions.js');
  const dicht = (a, b, e = 1e-9) => Math.abs(a - b) < e;
  const NOW0 = NOW;
  const fouten0 = OVERLAP_FOUTEN, breuk0 = CURVE_BREUK;
  const STEMS4 = { namen: ['drums', 'bass', 'other', 'vocals'], schaal: 1 };
  const STEMS2 = { namen: ['vocals', 'inst'], schaal: 1 };

  // 0. Het filter: per kant het sterkste, midden met een klik van een MIDI-knop.
  ok('stemFilterDoelen: één knop = precies het trackfilter; de groep alleen = de groep', [0, 0.2, 0.5, 0.8, 1].every((v) =>
    stemFilterDoelen(v).join() === filterDoelen(v).join() && stemFilterDoelen(0.5, v).join() === filterDoelen(v).join()));
  ok('… beide dezelfde kant op: de sterkste (hoogste highpass, laagste lowpass)', stemFilterDoelen(0.9, 0.7).join() === filterDoelen(0.9).join()
    && stemFilterDoelen(0.3, 0.1).join() === filterDoelen(0.1).join());
  const band = stemFilterDoelen(0.2, 0.8);
  ok('… tegenover elkaar: een bandfilter (highpass van de een, lowpass van de ander)', band[0] === filterDoelen(0.8)[0] && band[1] === filterDoelen(0.8)[1]
    && band[2] === filterDoelen(0.2)[2] && band[3] === filterDoelen(0.2)[3]);
  ok(`midden = 0,5 ± ${STEM_MIDDEN} (63 en 64 van 127 zijn allebei het midden)`, stemFilterOpen(0.5) && stemFilterOpen(63 / 127) && stemFilterOpen(64 / 127)
    && !stemFilterOpen(62 / 127) && !stemFilterOpen(65 / 127) && stemFilterDoelen(64 / 127).join() === filterDoelen(0.5).join());

  // 1. Een deck met een TIJDLIJN op elke AudioParam: wat doet elke parameter op elk moment.
  const TLS = maakTijdlijn(() => NOW);
  const sctx = new AudioContext();
  let gemaakt = 0;
  for (const m of ['createGain', 'createBiquadFilter']) {
    const orig = sctx[m].bind(sctx);
    sctx[m] = () => { gemaakt++; const n = orig(); for (const k of ['gain', 'frequency', 'Q']) n[k] = TLS.param(n[k].value); return n; };
  }
  NOW = 6000;
  const ds = new Deck(sctx, 'S');
  const c = ds.chain;
  const kan = ds.stemKanalen;
  const WACHT = startDrempel(sctx);
  const n0 = gemaakt;
  const leeg = () => kan.every((x) => !x.filter && !x.send.A && !x.send.B && !x.cue);
  ds._zetStems(null);
  ds.setStemFilter('vocals', 0.1); ds.setStemSend('A', 'vocals', 1); ds.setStemPfl('vocals', true);
  ok('zonder stems: geen node van een stemkanaal (ook niet bij een laad of een stem-action); alleen de twee fader-spiegels',
    leeg() && gemaakt === n0 && ['A', 'B'].every((b) => ds.stemSends[b].fader.gain.value === 1)
    && ds.stemFilter('vocals') === null && ds.stemSend('A', 'vocals') === null && !ds.stemPflAan('vocals') && !ds.stemPflIets);
  ds._zetStems(STEMS4);
  ds._zetStems(STEMS4);
  ok('vier stems geladen (twee keer), alles open: nog steeds geen enkele node erbij; filter, sends en cue van elke stem open',
    leeg() && gemaakt === n0 && STEM_NAMEN.every((s) => ds.stemFilter(s) === 0.5 && ds.stemSend('A', s) === 0 && ds.stemSend('B', s) === 0));
  ds.setStemFilter('vocals', 63 / 127); ds.setStemSend('A', 'bass', 0);
  ok('een filter in het midden (63/127) of een send op 0: nog steeds niets', leeg() && gemaakt === n0);

  // Het filter van de drums (uitgang 0): erdoor, klikvrij, de rest niet.
  NOW += 1;
  const t1 = NOW;
  ds.setStemFilter('drums', 0.2);
  const [, , lf02, lq02] = filterDoelen(0.2);
  const k0 = kan[0].filter;
  ok('het filter van de drums komt er nu pas bij: vier nodes (filterIn, highpass, lowpass, tegen), stil begonnen',
    k0 && gemaakt === n0 + 4 && k0.filterIn.gain.waarde(t1) === 0 && k0.tegen.gain.waarde(t1) === 0 && [1, 2, 3].every((k) => !kan[k].filter));
  let somFout = 0, stap = 0;
  for (let x = 0; x <= 0.03; x += 0.0001) {
    somFout = Math.max(somFout, Math.abs(k0.filterIn.gain.waarde(t1 + x) + k0.tegen.gain.waarde(t1 + x)));
    stap = Math.max(stap, Math.abs(k0.filterIn.gain.waarde(t1 + x + 0.0001) - k0.filterIn.gain.waarde(t1 + x)));
  }
  ok(`drums filter 0,2: de lowpass van de drums gaat naar ${Math.round(lf02)} Hz (Q ${lq02.toFixed(2)}), als een knop (setTarget)`,
    dicht(k0.lpf.frequency.waarde(t1 + 1), lf02, 1e-6) && dicht(k0.lpf.Q.waarde(t1 + 1), lq02, 1e-9) && k0.lpf.frequency.n.target === 1);
  ok(`… en de drums gaan erdoor: filter → 1, tegen → −1 (x + H(x) − x), pas na de startdrempel (${(WACHT * 1000).toFixed(1)} ms), in 5 ms`,
    k0.filterIn.gain.waarde(t1 + WACHT - 1e-4) === 0 && k0.tegen.gain.waarde(t1 + WACHT - 1e-4) === 0
    && k0.filterIn.gain.waarde(t1 + WACHT + 0.0051) === 1 && k0.tegen.gain.waarde(t1 + WACHT + 0.0051) === -1);
  ok(`… klikvrij: de twee takken heffen elkaar steeds op (hooguit ${somFout.toExponential(1)} ernaast: een kruisfade droog ↔ gefilterd), grootste stap per 0,1 ms ${stap.toFixed(3)}, geen curve`,
    somFout < 1e-9 && stap < 0.05 && k0.filterIn.gain.n.curve === 0 && k0.filterIn.gain.n.lin > 10);
  ok('… bas, overig en zang niet aangeraakt', [1, 2, 3].every((k) => !kan[k].filter) && ds.stemFilter('drums') === 0.2 && ds.stemFilter('bass') === 0.5);
  // Terug naar het midden: eerst het filter terug, dan pas de takken dicht.
  NOW += 1;
  const t2 = NOW;
  ds.setStemFilter('drums', 64 / 127);
  ok(`terug in het midden: de lowpass loopt terug, de takken gaan pas na ${STEM_FILTER_TERUG * 1000} ms dicht`,
    k0.filterIn.gain.waarde(t2 + STEM_FILTER_TERUG - 1e-4) === 1 && k0.filterIn.gain.waarde(t2 + STEM_FILTER_TERUG + 0.0051) === 0
    && k0.tegen.gain.waarde(t2 + STEM_FILTER_TERUG + 0.0051) === 0 && k0.lpf.frequency.waarde(t2 + STEM_FILTER_TERUG) > 21000);
  // Binnen die 50 ms weer draaien: de terugweg wordt afgebroken, de stem blijft in het filter.
  NOW += 1;
  ds.setStemFilter('drums', 0.3);
  NOW += 1;
  const t3 = NOW;
  ds.setStemFilter('drums', 0.5);
  NOW += 0.02;
  ds.setStemFilter('drums', 0.7);
  ok('binnen die 50 ms weer weg uit het midden: blijft in het filter (geen heen-en-weer)',
    [0, 0.01, 0.03, 0.06, 0.2].every((x) => k0.filterIn.gain.waarde(t3 + x) === 1 && k0.tegen.gain.waarde(t3 + x) === -1)
    && dicht(k0.hpf.frequency.waarde(NOW + 1), filterDoelen(0.7)[0], 1e-6));
  ds.setStemFilter('drums', 0.5);
  NOW += 1;

  // De groepsknop inst bij vier: drums, bas en overig; de zang niet.
  ds.setStemFilter('drums', 0.2);
  ds.setStemFilter('inst', 0.8);
  NOW += 1;
  const hf = (k) => kan[k].filter.hpf.frequency.waarde(NOW), lf = (k) => kan[k].filter.lpf.frequency.waarde(NOW);
  ok('inst (de groep) highpass: bas en overig precies het filter van de groep, drums een band (eigen lowpass + groep highpass)',
    dicht(hf(1), filterDoelen(0.8)[0], 1e-6) && dicht(hf(2), filterDoelen(0.8)[0], 1e-6) && dicht(lf(1), 22050, 1e-6)
    && dicht(hf(0), filterDoelen(0.8)[0], 1e-6) && dicht(lf(0), filterDoelen(0.2)[2], 1e-6)
    && [0, 1, 2].every((k) => kan[k].filter.filterIn.gain.waarde(NOW) === 1));
  ok('… de zang krijgt geen filter', !kan[3].filter);
  ds.setStemFilter('drums', 0.5); ds.setStemFilter('inst', 0.5);
  NOW += 1;
  ok('alles weer in het midden: alle takken dicht (de filters blijven bestaan)', [0, 1, 2].every((k) => kan[k].filter.filterIn.gain.waarde(NOW) === 0
    && kan[k].filter.tegen.gain.waarde(NOW) === 0));

  // Sends: kwadratisch, de grootste van eigen knop en groep, × trim.
  ds.setStemSend('A', 'vocals', 0.6);
  ds.setStemSend('A', 'inst', 0.5);
  ds.setStemSend('A', 'drums', 0.7);
  ds.setStemSend('B', 'bass', 0.4);
  NOW += 1;
  const sA = (k) => kan[k].send.A?.gain.waarde(NOW) ?? 0, sB = (k) => kan[k].send.B?.gain.waarde(NOW) ?? 0;
  ok('sends: zang 0,6 → 0,36 naar de echo; de groep 0,5 → bas en overig 0,25; drums eigen 0,7 > groep → 0,49',
    dicht(sA(3), 0.36, 1e-6) && dicht(sA(1), 0.25, 1e-6) && dicht(sA(2), 0.25, 1e-6) && dicht(sA(0), 0.49, 1e-6));
  ok('… bus B los daarvan: alleen de bas (0,16); een send die nooit open ging bestaat niet', dicht(sB(1), 0.16, 1e-6)
    && [0, 2, 3].every((k) => !kan[k].send.B)
    && ds.stemSend('A', 'inst') === 0.5 && ds.stemSend('B', 'bass') === 0.4 && ds.stemSend('B', 'vocals') === 0);
  ds.set('trim', 0.7);
  NOW += 1;
  ok('trim 0,7 (×1,4): ook in de sends van elke stem (zang 0,36 × 1,4)', dicht(sA(3), 0.36 * 1.4, 1e-6) && dicht(sB(1), 0.16 * 1.4, 1e-6)
    && dicht(c.trim.gain.waarde(NOW), 1.4, 1e-6));
  ds.set('trim', 0.5);

  // De spiegel: de fader, ook tijdens het glijden van de auto-DJ.
  ds.set('fader', 0.3);
  NOW += 1;
  ok('fader 0,3: de spiegels van beide bussen precies de fader', ['A', 'B'].every((b) => ds.stemSends[b].fader.gain.waarde(NOW) === c.fader.gain.waarde(NOW))
    && dicht(c.fader.gain.waarde(NOW), faderGain(0.3), 1e-6));
  const tg = NOW;
  ds.glide('fader', 0.9);
  NOW += GLIJ / 2;
  ds.glide('fader', 0.05);                                  // opnieuw richten midden in een glijbeurt
  NOW += 0.1;
  ds.set('fader', 0.6);                                     // en ingrijpen
  let spiegelFout = 0;
  for (let x = 0; x <= GLIJ * 2; x += 0.001) {
    for (const b of ['A', 'B']) spiegelFout = Math.max(spiegelFout, Math.abs(ds.stemSends[b].fader.gain.waarde(tg + x) - c.fader.gain.waarde(tg + x)));
  }
  ok(`glijden, opnieuw richten en ingrijpen (Deck.glide, de auto-DJ): de spiegels volgen de fader sample voor sample (verschil ${spiegelFout})`,
    spiegelFout === 0 && c.fader.gain.n.lin > 0 && ds.stemSends.A.fader.gain.n.lin === c.fader.gain.n.lin);
  NOW += 1;
  ds.set('fader', 0);
  NOW += 1;
  ok('fader dicht: de stem-sends sturen niets meer in (spiegel −70 dB), hun knop blijft staan',
    dicht(ds.stemSends.A.fader.gain.waarde(NOW), faderGain(0), 1e-9) && ds.stemSend('A', 'vocals') === 0.6 && dicht(sA(3), 0.36, 1e-6));
  ds.set('fader', 1);

  // Een nieuw nummer: alles van de stemkanalen terug (ze horen bij het nummer).
  ds.setStemFilter('vocals', 0.1);
  NOW += 1;
  const n2 = gemaakt;
  ds._zetStems(STEMS2);
  NOW += 1;
  const dichtAlles = () => kan.every((x, k) => (!x.filter || (x.filter.filterIn.gain.waarde(NOW) === 0 && x.filter.tegen.gain.waarde(NOW) === 0))
    && dicht(sA(k), 0) && dicht(sB(k), 0));
  ok('een nieuw nummer (twee stems): filters, sends en cue terug (bij het NUMMER), geen nieuwe nodes', gemaakt === n2 && STEM_NAMEN.every((s) => !ds.stemBestaat(s)
    || (ds.stemFilter(s) === 0.5 && ds.stemSend('A', s) === 0 && ds.stemSend('B', s) === 0 && !ds.stemPflAan(s))) && dichtAlles());
  // Twee stems: inst is een eigen paar (uitgang 1), geen groep.
  ds.setStemFilter('inst', 0.9);
  ds.setStemSend('B', 'inst', 1);
  NOW += 1;
  ok('twee stems: inst is uitgang 1 (filter en galm), de zang (uitgang 0) niet; drums bestaat niet',
    kan[1].filter.filterIn.gain.waarde(NOW) === 1 && dicht(hf(1), filterDoelen(0.9)[0], 1e-6) && kan[0].filter.filterIn.gain.waarde(NOW) === 0
    && dicht(sB(1), 1, 1e-6) && sB(0) === 0 && ds.stemFilter('drums') === null);
  ds._zetStems(null);
  NOW += 1;
  ok('weer zonder stems: wat er van de stemkanalen is blijft (er gaat nooit iets los), maar dicht', !!kan[0].filter && dichtAlles() && ds.stemStand() === null);
  ok(`het tijdlijn-deck: geen curve, geen breuk, geen NotSupportedError (${TLS.stats.CURVE_BREUK} / ${TLS.stats.OVERLAP_FOUTEN})`,
    TLS.stats.CURVE_BREUK === 0 && TLS.stats.OVERLAP_FOUTEN === 0);

  // 2. De engine met vier kanalen (koptelefoon): bedrading, cue, de bus.
  const Oud = globalThis.AudioContext;
  const lijnen = [];
  const volg = (n) => { n.connect = (doel, uit = 0, inn = 0) => { lijnen.push([n, doel, uit, inn]); return doel; }; return n; };
  const Vier = class extends Oud {
    constructor(o) { super(o); this.destination.maxChannelCount = 4; volg(this.destination); }
    createGain() { return volg(super.createGain()); }
    createBiquadFilter() { return volg(super.createBiquadFilter()); }
    createDynamicsCompressor() { return volg(super.createDynamicsCompressor()); }
    createAnalyser() { return volg(super.createAnalyser()); }
    createChannelMerger(n) { return Object.assign(volg(super.createChannelMerger(n)), { numberOfInputs: n }); }
    createChannelSplitter(n) { return Object.assign(volg(node('splitter')), { numberOfOutputs: n }); }
  };
  const heeft = (van, doel) => lijnen.some((l) => l[0] === van && l[1] === doel);
  const uitVan = (van) => lijnen.filter((l) => l[0] === van).map((l) => l[1]);
  globalThis.AudioContext = Vier;
  const e6 = new Engine();
  globalThis.AudioContext = Oud;
  const kt = e6.koptelefoon;
  const dD = e6.deck('D'), cD = dD.chain;
  const ktGain = (sleutel) => kt._pfl.get(sleutel)?.gain;
  const leegD = () => dD.stemKanalen.every((x) => !x.filter && !x.send.A && !x.send.B && !x.cue);
  ok('zonder stems: stemIn → trim en verder niets (het oude pad); de fader-spiegels naar de bussen, de stem-cue naar de koptelefoon (D:stems)',
    leegD() && [0, 1, 2, 3].every((k) => uitVan(cD.stemIn[k]).length === 1 && heeft(cD.stemIn[k], cD.trim))
    && ['A', 'B'].every((b) => heeft(dD.stemSends[b].fader, e6.sends[b].in)) && heeft(dD.stemCue.som, ktGain('D:stems'))
    && heeft(ktGain('D:stems'), kt.cue) && heeft(cD.lpf, ktGain('D')) && e6.decks.A.stemCue && kt.heeft('H:stems'));
  bindEngine(e6);
  NOW = 7000;
  const W6 = startDrempel(e6.ctx);
  // Laden zoals de app: stems.wav via de StreamBron (de worklet nagebootst).
  const oudWorklet = e6.ctx.audioWorklet;
  e6.ctx.audioWorklet = { addModule: async () => {} };
  const oudNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = nepWorkletNode([]);
  const wavParen = (paren) => {
    const n = 4800, ch = paren * 2, b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b);
    const zet = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    zet(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); zet(8, 'WAVE'); zet(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, 48000, true); v.setUint32(28, 48000 * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); zet(36, 'data'); v.setUint32(40, n * ch * 2, true);
    return b;
  };
  const r = (a) => read(`track.4.stem.${a}`);
  await dD.laadGeheugen(buf, 'zonder stems');
  ok('een stereo-laad: nog steeds geen stemkanaal; filter, sends en cue van elke stem lezen null',
    leegD() && STEM_NAMEN.every((s) => ['filter', 'send.a', 'send.b', 'pfl'].every((x) => r(`${s}.${x}`) === null)));
  invoke('track.4.stem.vocals.pfl', true); invoke('track.4.stem.vocals.filter', 0.1);
  ok('… en ze doen niets', !dD.stemPflIets && !kt.iets && dD.stemFilters.vocals === 0.5);
  const n6 = lijnen.length;
  await dD.laadStream('/media/x/stems.wav', 'vier', { haal: geheugenHaal(wavParen(4)), stems: STEMS4 });
  const kD = dD.stemKanalen;
  ok('vier stems geladen: geen nieuwe verbinding van de stemkanalen (alles open); filter 0,5, sends 0, cue 0 voor elke stem (ook inst)',
    leegD() && !lijnen.slice(n6).some((l) => cD.stemIn.includes(l[0]) && l[1] !== cD.trim) && ['drums', 'bass', 'other', 'vocals', 'inst']
      .every((s) => r(`${s}.filter`) === 0.5 && r(`${s}.send.a`) === 0 && r(`${s}.send.b`) === 0 && r(`${s}.pfl`) === 0));
  invoke('track.4.stem.vocals.filter', 0.25); invoke('track.4.stem.drums.send.a', 0.4); invoke('track.4.stem.inst.send.b', 0.8);
  ok('de bus: filter en sends per stem (read volgt)', r('vocals.filter') === 0.25 && r('drums.send.a') === 0.4 && r('inst.send.b') === 0.8
    && kD[3].filter.filterIn.gain.value === 1 && kD[3].filter.tegen.gain.value === -1 && dicht(kD[2].send.B.gain.value, 0.64));
  const f3 = kD[3].filter;
  ok('het filter van de zang: de droge weg zoals hij was, plus stemIn → filterIn → highpass → lowpass → trim en stemIn → tegen → trim',
    heeft(cD.stemIn[3], cD.trim) && heeft(cD.stemIn[3], f3.filterIn) && heeft(f3.filterIn, f3.hpf) && heeft(f3.hpf, f3.lpf)
    && heeft(f3.lpf, cD.trim) && heeft(cD.stemIn[3], f3.tegen) && heeft(f3.tegen, cD.trim) && !kD[0].filter);
  ok('de sends: van de stem (zonder filter alleen stemIn) naar de fader-spiegel van de bus; alleen wat open ging (drums A, de groep B)',
    heeft(cD.stemIn[0], kD[0].send.A) && heeft(kD[0].send.A, dD.stemSends.A.fader) && [0, 1, 2].every((k) => heeft(cD.stemIn[k], kD[k].send.B)
      && heeft(kD[k].send.B, dD.stemSends.B.fader)) && !kD[1].send.A && !kD[3].send.A && !kD[3].send.B);
  invoke('track.4.stem.drums.filter', 0.9);
  ok('… komt er later een filter bij (drums), dan gaan zijn takken ook naar de sends die er al waren (na het filter)',
    ['A', 'B'].every((b) => heeft(kD[0].filter.lpf, kD[0].send[b]) && heeft(kD[0].filter.tegen, kD[0].send[b])));
  invoke('track.4.stem.drums.filter', 0.5);
  // De cue: zang, dan de groep, dan drums erbij, dan alles uit.
  const per = (k) => kD[k].cue?.gain.value ?? 0;
  invoke('track.4.stem.vocals.pfl', true); invoke('track.4.stem.vocals.pfl', false);
  ok('de cue van de zang komt er bij het eerste gebruik bij: na zijn filter (alle drie de takken) → de stem-cue',
    kD[3].cue && [cD.stemIn[3], f3.lpf, f3.tegen].every((t) => heeft(t, kD[3].cue)) && heeft(kD[3].cue, dD.stemCue.som) && !kD[0].cue);
  invoke('track.4.stem.vocals.pfl', true); invoke('track.4.stem.vocals.pfl', false);
  NOW += 1;
  const spion = [];
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelAndHoldAtTime']) {
    const g = kD[3].cue.gain, orig = g[m];
    g[m] = function (...a) { spion.push([m, ...a]); return orig.apply(this, a); };
  }
  invoke('track.4.stem.vocals.pfl', true); invoke('track.4.stem.vocals.pfl', false);
  ok('cue op de zang: alleen de zang (uitgang 3) in de koptelefoon, de koptelefoon hoort een cue (D:stems aan)',
    per(3) === 1 && [0, 1, 2].every((k) => per(k) === 0) && r('vocals.pfl') === 1 && r('inst.pfl') === 0 && kt.pflAan('D:stems') && kt.iets
    && ktGain('D:stems').gain.value === 1 && read('track.4.pfl') === 0);
  ok(`… klikvrij: vasthouden, dan hellingen vanaf nu + ${(W6 * 1000).toFixed(1)} ms, geen curve`, spion[0]?.[0] === 'cancelAndHoldAtTime'
    && spion.some((x) => x[0] === 'linearRampToValueAtTime' && x[1] === 1 && x[2] > NOW + W6) && !spion.some((x) => x[0] === 'setValueCurveAtTime'));
  NOW += 1;
  invoke('track.4.stem.inst.pfl', true);
  ok('cue op de groep (inst): drums, bas en overig erbij', [0, 1, 2, 3].every((k) => per(k) === 1) && r('inst.pfl') === 1 && r('drums.pfl') === 0);
  NOW += 1;
  invoke('track.4.stem.vocals.pfl', true); invoke('track.4.stem.drums.pfl', true);
  ok('zang uit, drums eigen cue erbij terwijl de groep aan staat: drums blijft één keer aan (of, niet dubbel)',
    per(3) === 0 && per(0) === 1 && r('drums.pfl') === 1 && kt.iets);
  NOW += 1;
  invoke('track.4.stem.inst.pfl', true);
  ok('groep uit: alleen de drums blijven', per(0) === 1 && per(1) === 0 && per(2) === 0 && per(3) === 0 && kt.pflAan('D:stems'));
  NOW += 1;
  invoke('track.4.trim', 0.25);
  ok('trim van de track (×0,5): ook in de cue van de stem die aan staat (en niet in de andere)', dicht(per(0), 0.5) && per(1) === 0
    && dicht(cD.trim.gain.value, 0.5));
  invoke('track.4.trim', 0.5);
  NOW += 1;
  invoke('track.4.stem.drums.pfl', true);
  ok('alles uit: de koptelefoon hoort de zaal weer (D:stems uit)', [0, 1, 2, 3].every((k) => per(k) === 0) && !kt.pflAan('D:stems') && !kt.iets
    && kt.zaalKant.gain.value === 1);
  invoke('track.4.stem.vocals.pfl', true);
  NOW += 1;
  await dD.laadStream('/media/x/stems2.wav', 'twee', { haal: geheugenHaal(wavParen(2)), stems: STEMS2 });
  ok('een nieuw nummer: de cue van de stems uit, de koptelefoon ook', !dD.stemPflIets && !kt.pflAan('D:stems') && per(0) === 0
    && r('vocals.pfl') === 0 && r('drums.pfl') === null && r('vocals.filter') === 0.5);
  ok('snapshot: per stem ook filter, sends (A, B) en cue', (() => {
    invoke('track.4.stem.inst.send.a', 0.3); invoke('track.4.stem.vocals.pfl', true);
    const sn = e6.snapshot().decks.D.stems;
    return sn.filter.vocals === 0.5 && sn.send.A.inst === 0.3 && sn.send.B.vocals === 0 && sn.cue.vocals === true && sn.cue.inst === false
      && !('drums' in sn.filter) && e6.snapshot().koptelefoon.pfl['D:stems'] === true;
  })());
  invoke('track.4.stem.vocals.pfl', true);
  e6.ctx.audioWorklet = oudWorklet;
  globalThis.AudioWorkletNode = oudNode;
  bindEngine(eng);

  // Zonder koptelefoonuitgang (de gewone mock): geen cue-nodes, read null, doet niets.
  const dDe = eng.deck('D');
  dDe._zetStems(STEMS2);
  invoke('track.4.stem.vocals.pfl', true);
  ok('zonder koptelefoonuitgang: geen stem-cue (geen node), de cue leest null en doet niets; filter en sends wel',
    dDe.stemCue === null && dDe.stemKanalen.every((x) => !x.cue) && read('track.4.stem.vocals.pfl') === null
    && !dDe.stemPflAan('vocals') && !eng.koptelefoon.heeft('D:stems')
    && read('track.4.stem.vocals.filter') === 0.5 && read('track.4.stem.inst.send.b') === 0);
  dDe._zetStems(null);

  // 3. De actions: soort, label, uitleg, log en terugspelen.
  const nieuw = STEM_NAMEN.flatMap((s) => ['filter', 'send.a', 'send.b', 'pfl'].map((x) => `track.4.stem.${s}.${x}`));
  ok(`20 nieuwe stem-actions per track (vijf stems × filter/send.a/send.b/pfl), op alle acht tracks`, nieuw.every((a) => has(a))
    && [1, 2, 3, 5, 6, 7, 8].every((t) => has(`track.${t}.stem.other.pfl`) && has(`track.${t}.stem.inst.send.b`)));
  ok('filter (bipolair) en sends = value, pfl = trigger, met een Nederlands label', STEM_NAMEN.every((s) =>
    metaOf(`track.4.stem.${s}.filter`).type === 'value' && metaOf(`track.4.stem.${s}.filter`).bipolar === true
    && metaOf(`track.4.stem.${s}.send.a`).type === 'value' && metaOf(`track.4.stem.${s}.pfl`).type === 'trigger')
    && /zang: filter/.test(metaOf('track.4.stem.vocals.filter').label) && /galm/.test(metaOf('track.4.stem.bass.send.b').label)
    && /koptelefoon/.test(metaOf('track.4.stem.inst.pfl').label));
  const kaal = nieuw.filter((a) => beschrijf(a).kort === a || beschrijf(a).lang.startsWith('?'));
  ok(`elke nieuwe stem-action heeft een uitleg op de APC-kaart${kaal.length ? ': ' + kaal.join(', ') : ''}`, kaal.length === 0);
  ok('terugspelen slaat alleen de stem-cue over (de zaal hoort hem niet); filter en sends horen bij het nummer',
    STEM_NAMEN.every((s) => OVERSLAAN.test(`track.4.stem.${s}.pfl`) && !OVERSLAAN.test(`track.4.stem.${s}.filter`)
      && !OVERSLAAN.test(`track.4.stem.${s}.send.a`) && NUMMER_NODIG.test(`track.4.stem.${s}.filter`))
    && !OVERSLAAN.test('track.4.stem.vocals.pfl.x') && !NIET_IN_WAARDEN.test('track.4.stem.vocals.filter'));

  ok('geen overlappende automatisering en geen afgebroken curve in de stemkanalen', OVERLAP_FOUTEN === fouten0 && CURVE_BREUK === breuk0);
  NOW = NOW0;
}

ok(`geen enkele overlappende automatisering in de hele test (${OVERLAP_FOUTEN})`, OVERLAP_FOUTEN === 0);
ok(`geen enkele afgebroken curve in de hele test (${CURVE_BREUK}): in Chrome een sprong`, CURVE_BREUK === 0);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
