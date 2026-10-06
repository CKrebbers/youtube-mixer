// De auto-DJ met secties als frasegrenzen (docs/AUTO-DJ.md §3b): de planner
// (puur) en de automaat op een echte engine met een nep-Web Audio.
// Zonder secties precies het oude gedrag: dat bewaakt test/auto.test.mjs.
// Draai met: node test/auto-secties.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-Web Audio (zoals auto.test, op 12 kHz: de nummers zijn hier 3 minuten) ----
let NOW = 0;
const { maakTijdlijn } = await import('./nep-tijdlijn.mjs');
const { param } = maakTijdlijn(() => NOW);
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), threshold: param(0), knee: param(0),
  ratio: param(1), attack: param(0), release: param(0), fftSize: 1024, smoothingTimeConstant: 0, delayTime: param(0),
  curve: null, oversample: 'none', connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); }, getFloatTimeDomainData(b) { b.fill(0); },
});
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 12000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); this.audioWorklet = { addModule: async () => {} }; }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); } createBiquadFilter() { return node('biquad'); } createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); } createDelay() { return node('delay'); } createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); } createChannelSplitter() { return node('splitter'); } createConvolver() { return node('conv'); }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.start = () => {}; s.stop = () => { queueMicrotask(() => s.onended?.()); }; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};

const P = await import('../src/auto/planner.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { SectieKaart } = await import('../src/engine/secties.js');

// Een nummer van 98 maten op 120 bpm (maat = 2 s, 16 maten = 32 s): intro,
// couplet, opbouw, drop, break, drop, outro. De tweede drop loopt van 112 tot 144.
const ST = [
  { van: 0, label: 'intro', groep: 'A', energie: 0.3 },
  { van: 16, label: 'deel', groep: 'B', energie: 0.6 },
  { van: 48, label: 'opbouw', groep: 'C', energie: 0.6, zeker: 0.8 },
  { van: 64, label: 'drop', groep: 'D', energie: 1, zeker: 0.9 },
  { van: 96, label: 'break', groep: 'E', energie: 0.4, zeker: 0.9 },
  { van: 112, label: 'drop', groep: 'D', energie: 1, zeker: 0.9 },
  { van: 144, label: 'outro', groep: 'F', energie: 0.4, zeker: 0.7 },
];
const g = new Beatgrid({ bpm: 120, firstBeat: 0 });
const zelfde = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sectieIn = (st, t) => st.reduce((k, s, i) => (s.van <= t + 1e-6 ? i : k), 0);
const middenInDrop = (st, t) => { const i = sectieIn(st, t); return st[i].label === 'drop' && t > st[i].van + 1e-6; };

// ---- 1. planner: uitmixen (planMoment) -------------------------------------------
console.log('planner: uitmixen op een sectiegrens');
{
  const oud = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190 });
  ok(`zonder secties: het oude moment (${oud.start}), en dat valt midden in de tweede drop`, oud.start === 128 && middenInDrop(ST, oud.start));
  ok('secties: null geeft precies het oude moment (blend, filter, beatloos)',
    zelfde(P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: null }), oud)
    && zelfde(P.planMoment({ type: 'filter', grid: g, positie: 10, eind: 174, secties: null }), P.planMoment({ type: 'filter', grid: g, positie: 10, eind: 174 }))
    && zelfde(P.planMoment({ type: 'ambient', positie: 10, eind: 190, secties: null }), P.planMoment({ type: 'ambient', positie: 10, eind: 190 })));

  const m = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST });
  ok(`blend: op de outro (${m.start}, sectie ${m.sectie?.sectie} ${m.sectie?.label}), even lang als zonder secties`,
    m.start === 144 && m.sectie?.sectie === 7 && m.sectie.label === 'outro' && m.lengte === oud.lengte && m.maten === oud.maten && m.tel === 288);
  const f = P.planMoment({ type: 'filter', grid: g, positie: 10, eind: 174, secties: ST });
  ok(`filter (8 maten): op de outro (${f.start}), klaar vóór het eind`, f.start === 144 && f.start + f.lengte <= 174);
  const b = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 174, secties: ST });
  ok(`blend past niet meer in de outro: op de break (${b.start}), niet midden in de drop (zonder: ${P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 174 }).start})`,
    b.start === 96 && b.sectie?.label === 'break' && b.start + b.lengte <= 174);

  // De sectie uit het plan (uitSectie): de overgang begint op het begin ervan.
  const u = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST, uitSectie: { sectie: 5, label: 'break', groep: 'E' } });
  ok(`uitSectie 5 (break E): de overgang begint op 96 (${u.start})`, u.start === 96 && u.sectie?.sectie === 5);
  const u2 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST, uitSectie: { sectie: 2, label: 'break', groep: 'E' } });
  ok(`uitSectie 2 heet geen "break E": het eerste stuk dat zo heet (${u2.start})`, u2.start === 96 && u2.sectie?.sectie === 5);
  const u3 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST, uitSectie: { sectie: 12, label: 'drop', groep: 'Q' } });
  ok(`uitSectie onvindbaar: zelf kiezen (${u3.start})`, u3.start === 144);
  const u4 = P.planMoment({ type: 'blend', grid: g, positie: 90, eind: 190, secties: ST, uitSectie: { sectie: 5, label: 'break', groep: 'E' } });
  ok(`uitSectie al voorbij (vroegst 110): zelf kiezen (${u4.start})`, u4.start === 144);
  const u5 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST, uitSectie: { sectie: 5 } });
  ok('uitSectie met alleen een nummer: dat stuk', u5.start === 96);

  // Geen outro of break in de buurt: niet midden in een drop als het anders kan.
  const ver = [ST[0], { van: 16, label: 'break', groep: 'B', energie: 0.4 }, { van: 32, label: 'drop', groep: 'C', energie: 1 }];
  const v1 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ver });
  ok(`een break 2,5 minuut vóór het eind trekt de overgang niet zo ver naar voren: het oude moment (${v1.start})`, v1.start === 128 && !v1.sectie);
  const deel = [ST[0], ST[1], { van: 96, label: 'deel', groep: 'B', energie: 0.6 }, { van: 120, label: 'drop', groep: 'D', energie: 1 }];
  const d1 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: deel });
  ok(`geen outro of break, oud moment midden in de drop: het begin van het deel ervoor (${d1.start})`, d1.start === 96 && d1.sectie?.label === 'deel');
  const alleenDrop = [ST[0], ST[1], { van: 120, label: 'drop', groep: 'D', energie: 1 }];
  const d2 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: alleenDrop });
  ok(`alleen een drop in de buurt: op zijn begin, niet midden erin (${d2.start})`, d2.start === 120 && d2.sectie?.label === 'drop');
  const rustig = [ST[0], ST[1], { van: 64, label: 'drop', groep: 'D', energie: 1 }, { van: 112, label: 'deel', groep: 'B', energie: 0.6 }];
  const d3 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: rustig });
  ok(`het oude moment ligt niet in een drop en er is geen outro of break: het oude moment (${d3.start})`, d3.start === 128 && !d3.sectie);

  // Alleen op een zeker grid.
  const vaag = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.1 }] });
  ok('grid onzeker: de secties tellen niet (het oude moment)',
    zelfde(P.planMoment({ type: 'blend', grid: vaag, positie: 10, eind: 190, secties: ST }), P.planMoment({ type: 'blend', grid: vaag, positie: 10, eind: 190 })));

  // Beatloos: op tijd, en alleen als het grid op dat begin zeker is (`zeker`).
  const a0 = P.planMoment({ type: 'ambient', positie: 10, eind: 190 });
  const a1 = P.planMoment({ type: 'ambient', positie: 10, eind: 190, secties: ST, zeker: () => true });
  ok(`beatloos met een zeker grid op de outro: op de outro (${a1.start}), 24 s (zonder: ${a0.start})`, a1.start === 144 && a1.lengte === a0.lengte && a0.start === 166);
  ok('beatloos zonder te weten of het grid zeker is: het oude moment',
    zelfde(P.planMoment({ type: 'ambient', positie: 10, eind: 190, secties: ST }), a0)
    && zelfde(P.planMoment({ type: 'ambient', positie: 10, eind: 190, secties: ST, zeker: () => false }), a0));

  // De bewakers: `mag` zegt of de soort overgang op dat begin nog mag.
  const mg = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST, mag: (t) => t < 140 });
  ok(`mag de soort niet op de outro: de break (${mg.start})`, mg.start === 96);
  const mg2 = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 190, secties: ST, uitSectie: { sectie: 5 }, mag: (t) => t > 140 });
  ok(`ook een uitSectie uit het plan wijkt voor de bewakers (${mg2.start})`, mg2.start === 144);
}

// ---- 2. planner: inmixen (fragment) ----------------------------------------------
console.log('\nplanner: inmixen op de intro of een sectiegrens');
{
  const kort = { id: 'k', duur: 196, grid: { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }] } };
  const f0 = P.fragment(kort, { secties: ST });
  ok(`kort nummer met secties: vanaf de intro (${f0.van}–${f0.tot}, ${f0.sectie?.label})`, f0.van === 0 && f0.tot === 190 && f0.sectie?.label === 'intro');
  ok('zonder secties: precies het oude fragment', zelfde(P.fragment(kort, { secties: null }), P.fragment(kort)) && zelfde(P.fragment(kort, { inSectie: { sectie: 5 } }), P.fragment(kort)));
  const f1 = P.fragment(kort, { secties: ST, inSectie: { sectie: 5, label: 'break', groep: 'E' } });
  ok(`inSectie 5 (break E): vanaf 96 (${f1.van}–${f1.tot})`, f1.van === 96 && f1.tot === 190 && f1.sectie?.sectie === 5);
  ok('inSectie 3 heet geen "break E": het eerste stuk dat zo heet', P.fragment(kort, { secties: ST, inSectie: { sectie: 3, label: 'break', groep: 'E' } }).van === 96);
  ok('inSectie gaat voor `van` uit het plan', P.fragment(kort, { secties: ST, van: 50, inSectie: { sectie: 5 } }).van === 96);
  ok('inSectie onvindbaar: `van` uit het plan', P.fragment(kort, { secties: ST, van: 50, inSectie: { sectie: 30, label: 'drop', groep: 'Z' } }).van === 50);
  ok('inSectie met een speelduur: tot = begin + speelduur', P.fragment(kort, { secties: ST, speelduur: 40, inSectie: { sectie: 5 } }).tot === 136);
  const vaagKort = { ...kort, grid: { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.1 }] } };
  ok('grid onzeker: inSectie telt niet (het oude fragment)', zelfde(P.fragment(vaagKort, { secties: ST, inSectie: { sectie: 5 } }), P.fragment(vaagKort)));

  const lang = { id: 'l', duur: 3600, grid: { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }] },
    toon: { stukken: [{ van: 0, toonsoort: 'Am', zekerheid: 0.1 }, { van: 900, toonsoort: 'G', zekerheid: 0.9 }] } };
  const mix = [{ van: 0, label: 'intro', groep: 'A', energie: 0.3 }, { van: 600, label: 'drop', groep: 'B', energie: 1, zeker: 0.9 },
    { van: 1500, label: 'break', groep: 'C', energie: 0.4, zeker: 0.5 }, { van: 2000, label: 'drop', groep: 'B', energie: 1, zeker: 0.9 },
    { van: 2600, label: 'break', groep: 'C', energie: 0.4, zeker: 0.9 }, { van: 3300, label: 'outro', groep: 'D', energie: 0.3, zeker: 0.9 }];
  const fl = P.fragment(lang, { rnd: () => 0, secties: mix });
  ok(`lange mix: in op een break met ruimte voor 6 minuten, niet in een drop (${fl.van}, zonder secties ${P.fragment(lang, { rnd: () => 0 }).van})`,
    fl.van === 2600 && fl.tot === 2600 + P.SPEELDUUR && fl.sectie?.label === 'break');
  ok('lange mix: `van` uit het plan gaat voor de keuze uit de secties', P.fragment(lang, { rnd: () => 0, secties: mix, van: 1200 }).van === 1200);
}

// ---- 3. planner: hulp ------------------------------------------------------------
console.log('\nplanner: hulp');
{
  ok('sectiesVan: een kaart op het grid geeft de stukken, een kaart zonder grid null',
    P.sectiesVan({ opGrid: true, stukken: ST }).length === 7 && P.sectiesVan({ opGrid: false, stukken: ST }) === null
    && P.sectiesVan(null) === null && P.sectiesVan(SectieKaart.van({ opGrid: true, stukken: ST })).length === 7);
  ok('vindSectie: nummer + naam, anders de naam, anders −1',
    P.vindSectie(ST, { sectie: 5, label: 'break', groep: 'E' }) === 4 && P.vindSectie(ST, { sectie: 1, label: 'drop', groep: 'D' }) === 3
    && P.vindSectie(ST, { sectie: 50 }) === -1 && P.vindSectie(ST, null) === -1 && P.vindSectie(ST, 'drop') === -1);
  const gr = P.sectieGrens({ secties: ST, grid: g, na: 96, tot: 128 });
  ok(`sectieGrens: de eerste grens na 96 tot 128 is 112 (${gr?.start})`, gr?.start === 112 && gr.tel === 224 && gr.sectie.sectie === 6);
  ok('sectieGrens: na de outro geen grens meer', P.sectieGrens({ secties: ST, grid: g, na: 144, tot: 190 }) === null);
}

// ---- 4. de automaat op een engine ------------------------------------------------
console.log('\nautomaat');
const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, bindAuto, invoke, bijInvoke } = await import('../src/control/actions.js');
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const { Automaat } = await import('../src/auto/automaat.js');
const { ToonKaart } = await import('../src/engine/toonsoort.js');
const eng = new Engine();
bindEngine(eng);
const ALLE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Dezelfde vorm, de tweede drop iets eerder (108): zo zijn "nu" en "langer" naar
// de volgende grens anders dan de oude 4 en 8 maten.
const KA = { versie: 1, opGrid: true, grid: 'proef', bron: 'auto', slot: false,
  stukken: ST.map((s) => (s.van === 112 ? { ...s, van: 108 } : s)) };
const nummer = (id, seed, grid = null) => ({ id, titel: id, audio: `media/${id}/audio.wav`, duur: 196, loudness_i: -14,
  grid: grid ?? { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }] },
  toon: { stukken: [{ van: 0, toonsoort: 'Am', zekerheid: 0.9 }] }, _seed: seed });
const LIB = [nummer('x', 1), nummer('y', 2)];
const buffers = new Map();
const opDeck = {};
let kaartOpDeck = null;          // wat laden.js na het laden op het deck zet (hier meteen, of niets)
const laad = async (deckId, track) => {
  const d = eng.deck(deckId);
  if (!buffers.has(track._seed)) buffers.set(track._seed, renderDemoTrack(eng.ctx, { bpm: 120, bars: 98, seed: track._seed }));
  d.load(buffers.get(track._seed), track.titel);
  d.setGrid(track.grid);
  d.setToonKaart(ToonKaart.van(track.toon));
  if (kaartOpDeck) d.setSectieKaart(kaartOpDeck);
  opDeck[deckId] = track.id;
};
const wacht = () => new Promise((r) => setTimeout(r, 0));

/** Van stilte: een nieuwe automaat met dit plan, tot de volgende klaarstaat. `voor` mag het plan aanvullen (in/uit). */
async function scenario({ plan, haalSecties, wachtSecties, lib = LIB, opDeckKaart = null, voor = () => {} }) {
  for (const id of ALLE) { const d = eng.deck(id); if (d.playing) d.togglePlay(); if (d.buffer) d.setSectieKaart(null); }
  kaartOpDeck = opDeckKaart;
  const au = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => lib, haalPlan: async () => plan,
    welkNummer: (id) => opDeck[id] ?? null, rnd: () => 0, tik: 1e7, haalSecties, wachtSecties });
  bindAuto(au);
  const loop = async (sec, stop = () => false) => { for (let t = 0; t < sec; t += 0.05) { NOW += 0.05; au.tik(); await wacht(); if (stop()) return true; } return false; };
  await au.zetAan();
  voor(au);
  const klaar = await loop(20, () => au.fase === 'klaar');
  return { au, loop, klaar };
}

// 4a. De kaart van de uitgaande (die de automaat zelf ophaalde): uit op de outro, in op de intro.
{
  const { au, klaar } = await scenario({ plan: { stappen: [{ track: 'x', van: 100 }, { track: 'y' }] }, haalSecties: async () => KA });
  const v = au.volgende;
  ok(`klaar: blend van x naar y (${v?.overgang?.naam})`, klaar && v?.track.id === 'y' && v.overgang.type === 'blend');
  ok(`uit op de outro van x (${v?.moment?.start}, sectie ${v?.moment?.sectie?.sectie}), niet midden in de drop (zonder secties 128)`,
    v?.moment?.start === 144 && v.moment.sectie?.label === 'outro' && !middenInDrop(KA.stukken, v.moment.start));
  ok(`in op de intro van y (${v?.van}, ${v?.inSectie?.label})`, v?.van === 0 && v.inSectie?.label === 'intro');
  ok('de tooltip zegt waar hij uit en in gaat', au.stand().volgende.redenen.some((r) => /outro F/.test(r)) && au.stand().volgende.redenen.some((r) => /intro A/.test(r)));
  // laden.js zet daarna zijn eigen kopie van dezelfde kaart op het deck: niet opnieuw plannen (geen extra regels in het log).
  const regels = [];
  const los = bijInvoke((id) => regels.push(id));
  eng.deck(au.hoofd).setSectieKaart(JSON.parse(JSON.stringify(KA)));
  for (let i = 0; i < 4; i++) { NOW += 0.05; au.tik(); await wacht(); }
  los();
  ok(`dezelfde kaart nog eens (van laden.js): niet opnieuw gepland (${regels.length} regels op de bus)`, regels.length === 0 && au.volgende.moment.start === 144);
  // Nu: naar de volgende sectiegrens als die binnen 8 maten komt (anders de eerstvolgende 4 maten).
  const pos = eng.deck(au.hoofd).position;
  invoke('auto.nu', true);
  ok(`nu bij ${pos.toFixed(1)} s: op de grens van de drop (${au.volgende.moment.start}), niet de 4-maatsgrens op 104`,
    pos < 102 && au.volgende.moment.start === 108 && au.volgende.moment.tel === 216 && au.fase === 'klaar');
  au.vernietig();
}

// 4b. Geen kaart bij het plannen: het oude moment. Komt hij later, dan opnieuw.
{
  const { au, loop } = await scenario({ plan: { stappen: [{ track: 'x', van: 100 }, { track: 'y' }] }, haalSecties: async () => null });
  ok(`zonder kaart: het oude moment (${au.volgende?.moment?.start}), het oude beginpunt (${au.volgende?.van})`,
    au.volgende?.moment?.start === 128 && !au.volgende.moment.sectie && au.volgende.van === 0);
  eng.deck(au.hoofd).setSectieKaart(KA);              // laden.js: de kaart komt binnen
  await loop(0.2);
  ok(`de kaart komt later binnen: opnieuw gepland, op de outro (${au.volgende?.moment?.start})`, au.fase === 'klaar' && au.volgende?.moment?.start === 144);
  // Langer: op de outro is er geen volgende grens meer: 8 maten, zoals altijd.
  invoke('auto.langer', true);
  ok(`langer zonder grens erna: 8 maten (${au.volgende.moment.start})`, au.volgende.moment.start === 160);
  au.vernietig();
}

// 4c. De race: de kaart van de nieuwe komt pas na het laden. Wachten (met een grens).
{
  const laat = (ms) => () => new Promise((r) => setTimeout(() => r(KA), ms));
  const metIn = (au) => { au.plan.stappen[1].in = { sectie: 5, label: 'break', groep: 'E' }; };
  const { au } = await scenario({ plan: { stappen: [{ track: 'x', van: 100 }, { track: 'y' }] }, haalSecties: laat(30), wachtSecties: 2000, voor: metIn });
  ok(`de kaart komt 30 ms na het laden: hij wacht, en y begint op de break uit de planstap (${au.volgende?.van})`,
    au.volgende?.van === 96 && au.volgende.inSectie?.sectie === 5);
  ok(`... en de kaart van x (ook laat, bij het starten niet afgewacht) telt toch: uit op de outro (${au.volgende?.moment?.start})`, au.volgende?.moment?.start === 144);
  au.vernietig();

  const nooit = await scenario({ plan: { stappen: [{ track: 'x', van: 100 }, { track: 'y' }] }, haalSecties: () => new Promise(() => {}), wachtSecties: 40, voor: metIn });
  ok(`de kaart komt nooit: na de grens het oude gedrag (y vanaf ${nooit.au.volgende?.van}, uit op ${nooit.au.volgende?.moment?.start})`,
    nooit.klaar && nooit.au.volgende?.van === 0 && nooit.au.volgende.moment.start === 128);
  nooit.au.vernietig();
  const stuk = await scenario({ plan: { stappen: [{ track: 'x', van: 100 }, { track: 'y' }] }, haalSecties: async () => { throw new Error('server weg'); }, voor: metIn });
  ok('ophalen mislukt: het oude gedrag, geen fout', stuk.klaar && stuk.au.volgende?.van === 0 && stuk.au.volgende.moment.start === 128 && stuk.au.melding?.soort !== 'fout');
  stuk.au.vernietig();

  // Nooit een gat voor een kaart: valt wat nu klinkt stil terwijl hij wacht, dan meteen door.
  for (const id of ALLE) { const d = eng.deck(id); if (d.playing) d.togglePlay(); }
  kaartOpDeck = null;
  const au2 = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => LIB,
    haalPlan: async () => ({ stappen: [{ track: 'x', van: 100 }, { track: 'y' }] }), welkNummer: (id) => opDeck[id] ?? null,
    rnd: () => 0, tik: 1e7, haalSecties: (id) => (id === 'y' ? new Promise(() => {}) : Promise.resolve(KA)), wachtSecties: 5000 });
  await au2.zetAan();
  const deckY = () => Object.keys(au2.nummers).find((id) => au2.nummers[id]?.id === 'y');      // geladen, wacht op de kaart
  for (let i = 0; i < 100 && !(au2.fase === 'laden' && deckY()); i++) { NOW += 0.05; au2.tik(); await wacht(); }
  const wachtte = au2.fase === 'laden' && !!deckY();
  eng.deck(au2.hoofd).togglePlay();                 // de track is op (of Clay zet hem stil)
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !(deckY() && eng.deck(deckY()).playing)) { NOW += 0.05; au2.tik(); await new Promise((r) => setTimeout(r, 10)); }
  const ms = Date.now() - t0;
  ok(`wat klinkt valt stil terwijl hij op de kaart wacht: y speelt na ${ms} ms, niet pas na de 5 s grens`,
    wachtte && deckY() && eng.deck(deckY()).playing && ms < 1000);
  au2.vernietig();
}

// 4d. Een planstap met `uit`, langer naar de volgende grens, en een sectiesprong van Clay.
{
  const { au, loop } = await scenario({ plan: { stappen: [{ id: 's1', track: 'x', van: 70 }, { id: 's2', track: 'y' }] },
    haalSecties: async () => KA, opDeckKaart: KA, voor: (a) => { a.plan.stappen[0].uit = { sectie: 5, label: 'break', groep: 'E' }; } });
  ok(`uit uit de planstap van wat nu klinkt: de overgang begint op de break (${au.volgende?.moment?.start})`, au.volgende?.moment?.start === 96);
  invoke('auto.langer', true);
  ok(`langer: naar de volgende sectiegrens (${au.volgende.moment.start}), niet 8 maten (112)`, au.volgende.moment.start === 108 && au.volgende.langer === 1);
  const n = ALLE.indexOf(au.hoofd) + 1;
  invoke(`track.${n}.section.7`, true);               // Clay springt naar de outro
  invoke(`track.${n}.section.7`, false);
  const na = eng.deck(au.hoofd).position;
  await loop(0.1);
  ok(`sectiesprong op wat nu klinkt (naar ${na.toFixed(1)} s): opnieuw gepland vanaf daar (${au.volgende?.moment?.start}), niet meteen begonnen`,
    na > 140 && au.fase === 'klaar' && au.volgende?.moment?.start === 152 && !au.volgende.gestart);
  au.vernietig();
}

// 4e. De bewakers gaan voor: de sectie mag de soort overgang niet onveiliger maken.
{
  // Tot 140 s een ander tempo (135): daar mag geen blend. De break ligt daar, de outro niet.
  const x2 = nummer('x2', 3, { stukken: [{ van: 0, bpm: 135, anker: 0, zekerheid: 0.9, maat: 0 }, { van: 140, bpm: 120, anker: 140, zekerheid: 0.9, maat: 140 }] });
  const KB = { ...KA, stukken: [ST[0], { ...ST[4], van: 96 }, { ...ST[6], van: 144 }] };
  const { au } = await scenario({ lib: [x2, LIB[1]], plan: { stappen: [{ id: 's1', track: 'x2', van: 60 }, { id: 's2', track: 'y' }] },
    haalSecties: async (id) => (id === 'x2' ? KB : KA), voor: (a) => { a.plan.stappen[0].uit = { sectie: 2, label: 'break', groep: 'E' }; } });
  ok(`op het eind mag een blend (${au.volgende?.overgang?.naam}); de break uit het plan ligt in het tempo dat niet past, dus niet daar maar op de outro (${au.volgende?.moment?.start})`,
    au.volgende?.overgang?.type === 'blend' && au.volgende.moment.start === 144);
  au.vernietig();
}

// 4f. OVERNEEM: een sectie drukken op een track in de overgang = hij is van Clay.
{
  const proef = (id, fase = 'bezig', viaBus = true) => {
    const au = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => LIB, tik: 1e7 });
    Object.assign(au, { aan: true, fase, hoofd: 'A', volgende: { deckId: 'B' } });
    if (viaBus) { invoke(id, true); invoke(id, false); } else au._bijBus(id, true);
    const uit = au.fase;
    au.vernietig();
    return uit;
  };
  const neemt = ['track.2.section.3', 'track.1.section.12', 'track.2.section.4.loop', 'track.1.section.next', 'track.2.section.prev'];
  const mis = neemt.filter((id) => proef(id) !== 'overgenomen');
  ok(`tijdens de overgang: sectie, sectie-loop, volgende en vorige overgenomen${mis.length ? ` (niet: ${mis.join(', ')})` : ''}`, mis.length === 0);
  ok('een sectie op een track die niet meedoet: niet overgenomen', proef('track.5.section.1') === 'bezig');
  ok('geen sectie-action (section.x, sections.1): niet overgenomen', proef('track.2.section.x', 'bezig', false) === 'bezig' && proef('track.2.sections.1', 'bezig', false) === 'bezig');
  ok('klaar: een sectie op de klaarstaande track is overnemen (zoals seek en hotcue)', proef('track.2.section.2', 'klaar') === 'overgenomen');
  ok('klaar: een sectie op wat nu klinkt is geen overnemen (opnieuw plannen)', proef('track.1.section.2', 'klaar') === 'klaar');
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
