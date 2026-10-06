// Sampler × secties (TASKS-SECTIES "Verweven", punt 6): een HELE sectie in een
// sampler-pad, op de maat, bewaard bij het nummer zoals een gewone pad.
//  1. knipSectie (puur): van de "1" van de sectie tot de "1" van de volgende,
//     in hele maten; de eerste sectie vanaf de eerste "1" (niet 0).
//  2. De klok kent de maat: fxKlok() zegt hoeveel tellen het nog is tot de
//     volgende "1"; startOpDeEen rekent daarmee.
//  3. De sampler: neemSectie, starten op de "1", meelopen met de maat (ook de
//     "1"), exact rond (drift), herstellen, en een eerlijke bovengrens.
//  4. De action sampler.N.section, waarom niet, de mapping en het lampje.
// Draai met: node test/sec-sampler.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
/** Een blok dat gooit is rood, niet een crash die de rest verbergt. */
async function blok(naam, fn) {
  try { await fn(); } catch (err) { ok(`${naam}: liep door zonder fout (${err?.message ?? err})`, false); }
}
const dicht = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) < tol;

// ---- een nep-AudioContext (zoals engine.test, met bronnen die onthouden wanneer) ----
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {}, getByteTimeDomainData(b) { b.fill(128); } });
const bronnen = [];
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0; this.outputLatency = 0; this.destination = node('dest'); }
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
  createBufferSource() {
    const s = node('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    s.start = (wanneer = 0, vanaf = 0) => { s.op = wanneer; s.offset = vanaf; };
    s.stop = (t) => { if (s.gestopt === undefined) s.gestopt = t ?? 'nu'; };
    bronnen.push(s);
    return s;
  }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};

const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { SectieKaart } = await import('../src/engine/secties.js');
const SM = await import('../src/engine/sampler.js');
const FX = await import('../src/engine/fx.js');
const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, invoke, read, has } = await import('../src/control/actions.js');

const kaart = (vans) => SectieKaart.van({ stukken: vans.map((van, i) => ({ van, label: 'deel', groep: String.fromCharCode(65 + i) })) });

// ---- 1. knipSectie: puur ----------------------------------------------------------------

console.log('knipSectie: de hele sectie, van "1" tot "1", in hele maten');
await blok('knipSectie', () => {
  const { knipSectie } = SM;
  ok('knipSectie bestaat (src/engine/sampler.js)', typeof knipSectie === 'function');
  // 120 bpm, tel 0 op 0,5 s: een opmaat van één tel, de "1" op 0,5 · 2,5 · 4,5 … (maat 2 s).
  const g = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0.5 }], slot: true });
  const k = kaart([0, 16.5, 32.5, 48.5]);
  let r = knipSectie(g, k, 0, 60);
  ok(`de eerste sectie: vanaf de eerste "1" (0,5), niet vanaf 0 (${r?.van})`, dicht(r?.van, 0.5) && dicht(r.tot, 16.5) && r.tellen === 32 && r.bpm === 120);
  r = knipSectie(g, k, 1, 60);
  ok('een sectie in het midden: haar "1" tot de "1" van de volgende, 8 maten = 32 tellen', dicht(r?.van, 16.5) && dicht(r.tot, 32.5) && r.tellen === 32 && r.bpm === 120);
  r = knipSectie(g, k, 3, 60);
  ok(`de laatste: tot het einde, maar in hele maten (5 maten, niet 5,75: tot ${r?.tot})`, dicht(r?.van, 48.5) && dicht(r.tot, 58.5) && r.tellen === 20);
  ok('geen sectie, geen kaart of geen grid: null', knipSectie(g, k, 4, 60) === null && knipSectie(g, k, -1, 60) === null
    && knipSectie(g, null, 0, 60) === null && knipSectie(null, k, 0, 60) === null);
  // Het grid veranderde na het rekenen: de begins liggen niet meer op een "1".
  // Dan dezelfde "1" als de sprong (sectieEen): de eerstvolgende.
  r = knipSectie(g, kaart([0, 17, 33]), 1, 60);
  ok(`begins naast de "1": van en tot op de eerstvolgende "1" (18,5 → 34,5), zoals de sprong (sectieEen)`, dicht(r?.van, 18.5) && dicht(r.tot, 34.5) && r.tellen === 32);
  // Een tempokaart: 120 bpm tot 32 s, daarna 125 bpm (tel 0,48 s), de "1" loopt door.
  const t = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 32, bpm: 125, anker: 32 }], slot: true });
  const kt = kaart([0, 16, 32, 32 + 32 * 0.48]);
  r = knipSectie(t, kt, 2, 80);
  ok(`een sectie in het tweede stuk: het tempo van DAT stuk (125), 32 tellen (${r?.bpm})`, dicht(r?.van, 32) && dicht(r.tot, 32 + 32 * 0.48, 1e-6) && r.tellen === 32 && r.bpm === 125);
  r = knipSectie(t, kt, 1, 80);
  ok(`een sectie die eindigt waar het tempo wisselt: zijn eigen tempo (120, niet 125: ${r?.bpm})`, dicht(r?.van, 16) && dicht(r.tot, 32) && r.tellen === 32 && dicht(r.bpm, 120, 1e-9));
  r = knipSectie(t, kaart([0, 24, 40]), 1, 80);
  const gem = (60 * 36) / (41.6 - 24);
  ok(`over de tempowissel heen: gemiddeld over wat er geknipt is (${r?.bpm?.toFixed(3)} = ${gem.toFixed(3)}), 9 maten tot de "1" van 41,6`,
    dicht(r?.van, 24) && dicht(r.tot, 41.6, 1e-6) && r.tellen === 36 && dicht(r.bpm, gem, 1e-6));
  // Een stuk met een eigen "1" (maat-anker 31): de maat ervoor is 6 tellen lang.
  // Dan hele maten vanaf de "1" van de sectie: 5 maten (20 tellen), de rest valt weg.
  const m = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 30, bpm: 120, anker: 30, maat: 31 }], slot: true });
  r = knipSectie(m, kaart([0, 20, 31]), 1, 60);
  ok(`een eigen "1" in het volgende stuk: hele maten vanaf de "1" (20 tellen tot 30, niet 22 tot 31: ${r?.tellen} tot ${r?.tot})`,
    dicht(r?.van, 20) && dicht(r.tot, 30) && r.tellen === 20);
  ok('korter dan een maat (dezelfde "1" voor begin en eind): null', knipSectie(new Beatgrid({ bpm: 120, firstBeat: 0 }), kaart([0, 10.5, 11, 30]), 1, 60) === null);
  ok('de grens: hooguit 32 maten en 90 s (SECTIE_MAX_MATEN, SECTIE_MAX_SEC)', SM.SECTIE_MAX_MATEN === 32 && SM.SECTIE_MAX_SEC === 90);
  ok('een pad langer dan de lengteknop kan geven is een sectie: die start op de "1"', SM.opDeMaat?.(32) === true && SM.opDeMaat(8) === false && SM.opDeMaat(4) === false && SM.opDeMaat(null) === false);
});

// ---- 2. de klok kent de maat --------------------------------------------------------------

console.log('\nde klok: hoeveel tellen nog tot de "1"');
const eng = new Engine();
bindEngine(eng);
const meldingen = [];
eng.on('melding', (m) => meldingen.push(m));
await blok('fxKlok en startOpDeEen', () => {
  const kd = eng.deck('B');
  kd.load(eng.ctx.createBuffer(2, 48000 * 40, 48000), 'klok');
  kd.setGrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true });
  kd.seek(1.1); kd.play();
  let k = kd.fxKlok();
  ok(`op tel 3 van de maat: de volgende tel (1,5 s) is tel 4, nog 1 tel tot de "1" (${k?.tellenTotEen}), 4 per maat`, k?.tellenTotEen === 1 && k.perMaat === 4 && dicht(k.ankerCtx, kd.ctxTimeOf(1.5)));
  kd.seek(1.6);
  k = kd.fxKlok();
  ok('vlak na tel 4: de volgende tel IS de "1" (0)', k?.tellenTotEen === 0);
  kd.setGrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 30, bpm: 120, anker: 30, maat: 31 }], slot: true });
  kd.seek(29.6);
  k = kd.fxKlok();
  ok(`over een stukgrens met een eigen "1" (31): van de tel op 30 nog 2 tellen (${k?.tellenTotEen})`, k?.tellenTotEen === 2);
  // In een loop die geen heel aantal maten is, komt de "1" niet: dan geen maat
  // (de sampler valt terug op de tel), anders trok elke fader een sectie-pad een tel opzij.
  kd.setGrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true });
  kd.seek(1.1);
  kd.setBeatLoop(2);
  k = kd.fxKlok();
  ok(`in een loop van 2 tellen: geen maat (${k?.tellenTotEen}), wel de tel`, k?.tellenTotEen === null && k.beatLengte > 0);
  kd.clearLoop();
  kd.setBeatLoop(4);
  ok('in een loop van een hele maat wel (ook als hij niet op de "1" begint)', Number.isInteger(kd.fxKlok()?.tellenTotEen));
  kd.clearLoop();
  kd.stop();
  const ctx = eng.ctx;
  NOW = 100;
  ok('startOpDeEen: de tel van het anker plus de tellen tot de "1"',
    dicht(FX.startOpDeEen?.(ctx, { beatLengte: 0.5, ankerCtx: 100.3, tellenTotEen: 3, perMaat: 4 }), 101.8));
  ok('… ligt die "1" binnen de uitgangsbuffer: de maat erna',
    dicht(FX.startOpDeEen(ctx, { beatLengte: 0.5, ankerCtx: 100.002, tellenTotEen: 0, perMaat: 4 }), 102.002));
  ok('… een klok zonder maat: gewoon op de tel (startOpDeTel), zonder klok: nu',
    FX.startOpDeEen(ctx, { beatLengte: 0.5, ankerCtx: 100.3 }) === FX.startOpDeTel(ctx, { beatLengte: 0.5, ankerCtx: 100.3 })
    && FX.startOpDeEen(ctx, null) === 100);
  NOW = 0;
});

// ---- 3. de sampler -------------------------------------------------------------------------

console.log('\nde sampler: een sectie in een pad');
const sm = eng.sampler;
const d = eng.deck('A');
{
  const buf = eng.ctx.createBuffer(2, 48000 * 60, 48000);
  const L = buf.getChannelData(0);
  for (let i = 0; i < L.length; i++) L[i] = (i % 4801) / 4801;    // herkenbaar: elk sample zegt waar het vandaan komt
  d.load(buf, 'sectie-bron');
  d.setGrid({ stukken: [{ van: 0, bpm: 120, anker: 0.5 }], slot: true });
  d.setSectieKaart({ stukken: [{ van: 0, label: 'intro', groep: 'A' }, { van: 16.5, label: 'drop', groep: 'B' },
    { van: 32.5, label: 'break', groep: 'C' }, { van: 48.5, label: 'outro', groep: 'D' }] });
}
await blok('neemSectie', async () => {
  let gemeld = null;
  sm.onGevuld = (n, info) => { gemeld = { n, ...info }; };
  d.seek(20);
  await sm.neemSectie(2, d, 1, { bron: 1 });
  const pad = sm.pads[2];
  ok('pad 3 gevuld met sectie 2: van haar "1" tot de "1" van de volgende, 32 tellen, 120 bpm',
    pad && dicht(pad.van, 16.5) && dicht(pad.tot, 32.5) && pad.tellen === 32 && pad.bpm === 120 && pad.bron === 1);
  ok(`precies de sectie: 8 maten van 2 s = 16 s (${pad?.buffer.duration})`, dicht(pad?.buffer.duration, 16, 1 / 48000));
  ok('het begint op het eerste sample van de sectie', pad && pad.buffer.getChannelData(0)[0] === d.buffer.getChannelData(0)[Math.round(16.5 * 48000)]);
  ok('bewaren bij het nummer: onGevuld met van, tot, tellen en bpm (de POST van sampler-opslag)',
    gemeld?.n === 2 && gemeld.deckId === 'A' && dicht(gemeld.van, 16.5) && dicht(gemeld.tot, 32.5) && gemeld.tellen === 32 && gemeld.bpm === 120 && gemeld.bron === 1);
  sm.onGevuld = null;

  // Afspelen: op de volgende "1" van de maatgever.
  const oudeKlok = sm.klok;
  NOW = 10;
  sm.klok = () => ({ beatLengte: 0.5, ankerCtx: 10.3, tellenTotEen: 3, perMaat: 4 });
  sm.wissel(2);
  ok(`starten: op de "1" (10,3 + 3 tellen = 11,8), niet op de volgende tel (${sm.pads[2].start})`, dicht(sm.pads[2].start, 11.8));
  ok('… exact op het tempo: één rondgang = 32 tellen van de maat', dicht(sm.pads[2].src.playbackRate.value, pad.buffer.duration / (32 * 0.5), 1e-12));
  sm.wissel(2);
  ok('nog eens: stop', !sm.pads[2].speelt);
  // Een gewone pad (de lengteknop) start zoals altijd op de volgende tel.
  sm.tellen = 4;
  d.seek(21.3);
  await sm.neem(3, d, { bron: 1 });
  sm.wissel(3);
  ok(`een gewone pad van 4 tellen: op de volgende TEL, zoals altijd (${sm.pads[3].start})`, dicht(sm.pads[3].start, 10.3));
  sm.wis(3);
  // Herstellen (bewaard bij het nummer): knipt opnieuw en weet uit de tellen dat het een sectie is.
  sm.wis(2);
  sm.herinneringen[2] = { deckId: 'A', van: 16.5, tot: 32.5, bpm: 120, tellen: 32, bron: 1 };
  await sm.herstel(2, d);
  sm.wissel(2);
  ok('een bewaarde sectie-pad (32 tellen) teruggehaald: weer op de "1"', dicht(sm.pads[2].start, 11.8) && sm.pads[2].tellen === 32);
  sm.wis(2);
  sm.herinneringen[2] = { deckId: 'A', van: 16.5, tot: 20.5, bpm: 120, tellen: 8, bron: 1 };
  await sm.herstel(2, d);
  sm.wissel(2);
  ok('een bewaarde gewone pad (8 tellen): op de tel, zoals altijd', dicht(sm.pads[2].start, 10.3));
  sm.wis(2);
  sm.herinneringen[2] = null;
  sm.klok = oudeKlok;
  NOW = 0;
});

await blok('meelopen met de maat', async () => {
  const oudeKlok = sm.klok;
  d.seek(20);
  await sm.neemSectie(4, d, 1, { bron: 1 });
  const pad = sm.pads[4];
  NOW = 500;
  let klokNu = { beatLengte: 0.5, ankerCtx: 500.2, tellenTotEen: 2, perMaat: 4 };
  sm.klok = () => klokNu;
  sm.wissel(4);
  const eerste = bronnen.at(-1);
  ok('wacht op de "1" (501,2)', dicht(eerste.op, 501.2) && eerste.offset === 0);
  let voor = bronnen.length;
  sm.heranker();
  ok('herankeren zonder verandering: geen nieuwe bron', bronnen.length === voor);
  // Tijdens het wachten gaat het tempo naar 126: de "1" komt eerder, en op het nieuwe tempo.
  NOW = 500.5;
  const tel126 = 60 / 126;
  klokNu = { beatLengte: tel126, ankerCtx: 500.7, tellenTotEen: 1, perMaat: 4 };
  sm.heranker();
  const nieuw = bronnen.at(-1);
  ok(`tempo veranderd terwijl hij wacht: opnieuw gepland op de nieuwe "1" (${nieuw.op?.toFixed(4)}), vanaf het begin`,
    nieuw !== eerste && dicht(nieuw.op, 500.7 + tel126) && nieuw.offset === 0);
  ok('… op het nieuwe tempo', dicht(nieuw.playbackRate.value, pad.buffer.duration / (32 * tel126), 1e-12));
  ok('… en de oude (die nog niet klonk) is weg', eerste.gestopt !== undefined);
  // Vlak voor de start (binnen de uitgangsbuffer): niet meer verplaatsen.
  NOW = nieuw.op - 0.002;
  klokNu = { beatLengte: tel126, ankerCtx: nieuw.op, tellenTotEen: 0, perMaat: 4 };
  voor = bronnen.length;
  sm.heranker();
  ok('de start zit al in de uitgangsbuffer: hij blijft staan (anders begon hij nooit)', bronnen.length === voor);
  // Hij speelt. Op tel 9 van het sample (tel 2 van een maat) is ook de maatgever op tel 2: niets te doen.
  const T = nieuw.op;
  const A = T + 9 * tel126;
  NOW = A - 0.2;
  klokNu = { beatLengte: tel126, ankerCtx: A, tellenTotEen: 3, perMaat: 4 };
  voor = bronnen.length;
  sm.heranker();
  ok('spelend, de maat klopt: niets', bronnen.length === voor);
  // De maatgever springt een tel (beatjump): op A is hij nu op tel 3 van zijn maat.
  klokNu = { beatLengte: tel126, ankerCtx: A, tellenTotEen: 2, perMaat: 4 };
  sm.heranker();
  const tel = pad.buffer.duration / 32;
  const na = bronnen.at(-1);
  ok(`de maatgever sprong een tel: de pad schuift mee naar tel 3 van zijn maat (tel ${(na.offset / tel).toFixed(3)} van het sample, was 9)`,
    bronnen.length === voor + 1 && dicht(na.op, A) && dicht(na.offset / tel, 10, 1e-6));
  // Een gewone pad houdt alleen de TEL vast (zoals altijd): dezelfde sprong doet daar niets.
  sm.stop(4);
  sm.tellen = 4;
  d.seek(21.3);
  await sm.neem(5, d, { bron: 1 });
  klokNu = { beatLengte: tel126, ankerCtx: NOW + 0.3, tellenTotEen: 1, perMaat: 4 };
  sm.wissel(5);
  NOW += 0.3 + 5 * tel126 - 0.1;
  klokNu = { beatLengte: tel126, ankerCtx: NOW + 0.1, tellenTotEen: 2, perMaat: 4 };
  voor = bronnen.length;
  sm.heranker();
  ok('een gewone pad: alleen de tel telt, een andere "1" verandert niets', bronnen.length === voor);
  sm.wis(5); sm.wis(4);
  sm.klok = oudeKlok;
  NOW = 0;
});

await blok('drift', async () => {
  // Zoals engine.test (≤ 1 ms per 10 minuten): de rate komt uit de bufferlengte.
  const oudeKlok = sm.klok;
  d.seek(20);
  await sm.neemSectie(6, d, 1, { bron: 1 });
  const p = sm.pads[6];
  let k = { beatLengte: 0.5, ankerCtx: NOW + 0.3, tellenTotEen: 0, perMaat: 4 };
  sm.klok = () => k;
  sm.wissel(6);
  const lus = () => p.buffer.length / p.buffer.sampleRate / Math.fround(p.src.playbackRate.value);
  const drift = (L) => Math.abs(lus() - 32 * L) * (600 / (32 * L));
  ok(`sectie van 32 tellen op 120 bpm: ${(drift(0.5) * 1000).toFixed(4)} ms per 10 minuten uit de maat (≤ 1 ms)`, drift(0.5) <= 0.001);
  NOW += 3;
  k = { beatLengte: 60 / 126, ankerCtx: NOW + 0.4, tellenTotEen: 1, perMaat: 4 };
  sm.heranker();
  ok(`… na een tempowissel naar 126: ${(drift(60 / 126) * 1000).toFixed(4)} ms per 10 minuten (≤ 1 ms)`, drift(60 / 126) <= 0.001);
  sm.wis(6);
  sm.klok = oudeKlok;
  NOW = 0;
});

await blok('waarom niet en de grens', async () => {
  const w = (n, deck, i) => sm.waaromGeenSectie(n, deck, i) ?? '';
  ok('kan: geen bezwaar', sm.waaromGeenSectie(0, d, 1) === null);
  sm.herinneringen[0] = { deckId: 'A', van: 1, tot: 3, bpm: 120, tellen: 4, bron: 1 };
  ok(`een bewaarde pad: niet overschrijven (${w(0, d, 1)})`, /bewaar/.test(w(0, d, 1)));
  sm.herinneringen[0] = null;
  d.seek(20);
  await sm.neemSectie(0, d, 1, { bron: 1 });
  ok(`een gevulde pad: eerst leegmaken (${w(0, d, 1)})`, /gevuld/.test(w(0, d, 1)));
  sm.wis(0);
  const leeg = eng.deck('H');
  ok(`een lege track (${w(0, leeg, 0)})`, /niets|leeg/.test(w(0, leeg, 0)));
  const c = eng.deck('C');
  c.load(eng.ctx.createBuffer(2, 8000 * 130, 8000), 'lang');
  ok(`zonder secties (${w(0, c, 0)})`, /geen secties/.test(w(0, c, 0)));
  c.setSectieKaart({ stukken: [{ van: 0, label: 'deel', groep: 'A' }, { van: 60, label: 'deel', groep: 'B' }, { van: 72, label: 'deel', groep: 'C' }] });
  ok(`zonder beatgrid (${w(0, c, 0)})`, /beatgrid/.test(w(0, c, 0)));
  c.setGrid({ stukken: [{ van: 0, bpm: 160, anker: 0, zekerheid: 0.3 }] });
  ok(`een onzeker grid (${w(0, c, 1)})`, /onzeker/.test(w(0, c, 1)));
  c.setGrid({ stukken: [{ van: 0, bpm: 160, anker: 0 }], slot: true });     // maat = 1,5 s
  ok(`te lang in maten: 40 maten (60 s) mag niet (${w(0, c, 0)})`, /40 maten/.test(w(0, c, 0)) && /32 maten/.test(w(0, c, 0)));
  ok('… 8 maten wel', sm.waaromGeenSectie(0, c, 1) === null);
  let fout = null;
  await sm.neemSectie(0, c, 0, { bron: 3 }).catch((e) => { fout = e.message; });
  ok(`neemSectie weigert met dezelfde reden en laat de pad leeg (${fout})`, /40 maten/.test(fout ?? '') && sm.pads[0] === null);
  c.setGrid({ stukken: [{ van: 0, bpm: 60, anker: 0 }], slot: true });      // maat = 4 s
  c.setSectieKaart({ stukken: [{ van: 0, label: 'deel', groep: 'A' }, { van: 96, label: 'deel', groep: 'B' }] });
  ok(`te lang in seconden: 24 maten op 60 bpm = 96 s (${w(0, c, 0)})`, /96 s/.test(w(0, c, 0)) && /90 s/.test(w(0, c, 0)));
  c.setGrid({ stukken: [{ van: 0, bpm: 86, anker: 0 }], slot: true });
  c.setSectieKaart({ stukken: [{ van: 0, label: 'deel', groep: 'A' }, { van: 32 * 4 * 60 / 86, label: 'deel', groep: 'B' }] });
  ok('32 maten op 86 bpm (89 s): past', sm.waaromGeenSectie(0, c, 0) === null);
  c.setSectieKaart({ ...c.sectieKaart.toJSON(), opGrid: false });
  ok(`een kaart die zonder grid berekend is (${w(0, c, 0)})`, /zonder grid/.test(w(0, c, 0)));
});

// ---- 4. de action, de mapping en het lampje ----------------------------------------------------

console.log('\nde action sampler.N.section');
await blok('action', async () => {
  ok('sampler.1.section … sampler.8.section bestaan', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => has(`sampler.${n}.section`)));
  eng.setFocus('A');
  d.seek(20);
  for (let i = 0; i < 8; i++) { sm.wis(i); sm.herinneringen[i] = null; }
  ok('lampje: leeg en de focus-track heeft een sectie = 0,5', read('sampler.6.section') === 0.5);
  let gemeld = null;
  sm.onGevuld = (n, info) => { gemeld = { n, ...info }; };
  invoke('sampler.6.section', true);
  invoke('sampler.6.section', false);
  await new Promise((r) => setTimeout(r, 0));
  ok('de sectie die je HOORT (sectie 2) in pad 6, bron = track 1', sm.pads[5] && dicht(sm.pads[5].van, 16.5) && dicht(sm.pads[5].tot, 32.5) && sm.pads[5].tellen === 32 && sm.pads[5].bron === 1);
  ok('… en bewaard (onGevuld)', gemeld?.n === 5 && gemeld.tellen === 32);
  sm.onGevuld = null;
  ok('lampje: gevuld = null (uit)', read('sampler.6.section') === null);
  meldingen.length = 0;
  invoke('sampler.6.section', true);
  ok(`nog eens op de gevulde pad: een melding waarom, niets overschreven (${meldingen.at(-1)?.tekst})`,
    meldingen.length === 1 && /pad 6/.test(meldingen[0].tekst) && /gevuld/.test(meldingen[0].tekst) && sm.pads[5].tellen === 32);
  // Pad 6 zelf speelt de sectie op de "1".
  const oudeKlok = sm.klok;
  NOW = 50;
  sm.klok = () => ({ beatLengte: 0.5, ankerCtx: 50.3, tellenTotEen: 2, perMaat: 4 });
  invoke('sampler.6', true);
  ok('sampler.6 (de pad zelf): start op de "1"', sm.pads[5].speelt && dicht(sm.pads[5].start, 51.3));
  invoke('sampler.6', true);
  sm.klok = oudeKlok;
  NOW = 0;
  // Waarom niet: een focus-track zonder secties.
  eng.setFocus('D');
  eng.deck('D').load(eng.ctx.createBuffer(2, 48000, 48000), 'kaal');
  meldingen.length = 0;
  invoke('sampler.7.section', true);
  invoke('sampler.7.section', false);
  ok(`focus-track zonder secties: lampje uit, een melding met de reden (${meldingen.at(-1)?.tekst})`,
    read('sampler.7.section') === null && meldingen.length === 1 && /track 4/.test(meldingen[0].tekst) && /geen secties/.test(meldingen[0].tekst) && sm.pads[6] === null);
  eng.setFocus('A');
  sm.wis(5);
});

await blok('mapping en lampje', async () => {
  const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  const apc = (await import('../src/control/devices/apc40mk2.js')).default;
  const rij3 = doc.rules.filter((r) => r.laag === 'grid.sampler' && /^sampler\.\d\.section$/.test(r.action));
  ok('modus sampler, rij 3: de sectie die je hoort in pad 1–8 (onder "leegmaken")',
    rij3.length === 8 && rij3.every((r) => r.in === `note:0:${apc.gridNote(Number(r.action.split('.')[1]), 3)}` && !r.shift && r.mode === 'trigger'));
  ok('shift op een PAD van de sampler blijft wat het was (geen shift-regel op de 40 pads)',
    !doc.rules.some((r) => r.laag === 'grid.sampler' && r.shift && /^note:0:\d+$/.test(r.in) && Number(r.in.split(':')[2]) < 40));
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const b = beschrijf('sampler.3.section');
  ok(`een uitleg op de APC-kaart (${b.kort}: ${b.lang.slice(0, 60)}…)`, b.kort !== 'sampler.3.section' && !b.lang.startsWith('?') && /sampler-pad 3/.test(b.lang));
  const { Mapping } = await import('../src/control/mapping.js');
  const { Feedback } = await import('../src/control/feedback.js');
  const { Lagen } = await import('../src/control/lagen.js');
  const standen = { 'sampler.1.section': 0.5, 'sampler.2.section': null, 'sampler.3.section': 1 };
  const lees = (a) => (a in standen ? standen[a] : null);
  const lg = new Lagen();
  lg.zet('grid', 'sampler');
  const m = new Mapping({ read: lees, invoke: () => {}, vars: () => ({ focus: 1 }), lagen: () => lg.actief() });
  m.load(doc);
  const fb = new Feedback({ device: apc, mapping: m, read: lees, meta: () => null, send: () => true });
  fb.klaar = true;
  const led = (sig) => fb.desired().get(sig)?.[2] ?? null;
  const P = apc.palette;
  ok('lampje: donker hemelsblauw = kan (een sectie), uit = niet, fel = ingedrukt',
    led(`note:0:${apc.gridNote(1, 3)}`) === P.hemelsblauwdonker && !led(`note:0:${apc.gridNote(2, 3)}`) && led(`note:0:${apc.gridNote(3, 3)}`) === P.hemelsblauw);
});

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
