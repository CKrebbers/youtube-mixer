// Minimale Web Audio-mock om de engine-logica te testen zonder browser.
let NOW = 0;
const LIVE = new Set();   // bronnen die nu geluid maken
const param = (v=0) => ({ value:v,
  setTargetAtTime(x){ this.value=x; },
  setValueAtTime(x){ this.value=x; },
  linearRampToValueAtTime(x){ this.value=x; },
  // De echte API kent deze twee ook; zonder hen kan de kruisfade niet getest.
  setValueCurveAtTime(c){ this.value = c[c.length-1]; },
  cancelScheduledValues(){},
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
  createOscillator(){ const n = node('osc'); n.type='sine'; n.start=()=>{}; n.stop=()=>{}; return n; }
  createBufferSource(){ const s = node('src'); s.playbackRate=param(1); s.loop=false; s.loopStart=0; s.loopEnd=0;
    // De echte API vuurt onended ASYNCHROON na stop(), en houdt een bron in
    // leven tot dat gebeurt. De oude mock deed geen van beide en hield daarmee
    // een bug uit fase 1 uit het zicht: een afgedankte bron die 'einde track'
    // meldde terwijl zijn opvolger al speelde.
    s.start=()=>{ LIVE.add(s); };
    s.stop=()=>{ if(!LIVE.has(s)) return; LIVE.delete(s); queueMicrotask(()=>s.onended?.()); };
    return s; }
  createBuffer(ch,len,sr){ const d=[...Array(ch)].map(()=>new Float32Array(len));
    return { numberOfChannels:ch, length:len, sampleRate:sr, duration:len/sr, getChannelData:(i)=>d[i] }; }
  resume(){ return Promise.resolve(); }
};

const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, invoke, list } = await import('../src/control/actions.js');
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
ok('pitch +8%', Math.abs(eng.deck('A').rate - 1.08) < 1e-9);

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
ok('en vult het zodra er een grid is', eng.snapshot().decks.A.grid.bpm === 124);
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
ok('plek 4 bestaat niet bij dit effect', fx.plekNaam(4) === null);
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
invoke('track.1.fx.next', true);
ok('volgend effect via de bus', fx.effectId !== beginEffect);
for (let i = 1; i < EFFECTEN.length; i++) invoke('track.1.fx.next', true);
ok('en na een rondje sta je weer waar je begon', fx.effectId === beginEffect);
invoke('track.1.fx.mix', 0.3);
ok('mix via de bus', Math.abs(fx.mix - 0.3) < 1e-9);
invoke('track.1.fx.knop.1', 0.7);
ok('plek via de bus', Math.abs(fx.leesPlek(1) - 0.7) < 1e-9);
invoke('track.1.fx.bypass', true);
ok('bypass via de bus', fx.bypass === true);
invoke('track.1.fx.bypass', true);
ok('en is een schakelaar', fx.bypass === false);
fx.setMix(0);

fx.zetEffect('delay');
const snapFx = eng.snapshot().decks.A.fx;
ok('snapshot draagt de fx-staat', snapFx.effect === 'delay' && snapFx.plekken.length === 3);
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
  ok('speelt er iets: de luidste die speelt', e8.syncMaster('A').id === 'D');
  e8.deck('D').set('fader', 0.3);
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
  invoke('track.3.xfade.kant', true);
  const naEen = eng.kant.C;
  invoke('track.3.xfade.kant', true);
  invoke('track.3.xfade.kant', true);
  ok('kant-knop loopt rond: thru -> A -> B -> thru', naEen === 'A' && eng.kant.C === 'thru');
  ok('read geeft drie standen', leesAction('track.1.xfade.kant') === 0
    && leesAction('track.2.xfade.kant') === 1 && leesAction('track.3.xfade.kant') === 0.5);
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
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
