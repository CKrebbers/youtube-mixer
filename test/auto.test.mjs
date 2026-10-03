// De auto-DJ: de planner (puur) en de automaat op een echte engine met een
// nep-Web Audio, van stilte tot een hele blend, plus ingrijpen en overnemen.
// Draai met: node test/auto.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-Web Audio (zoals engine.test, zonder curves-controle) --------------------
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, exponentialRampToValueAtTime(x) { this.value = x; },
  setValueCurveAtTime(c) { this.value = c[c.length - 1]; }, cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), threshold: param(0), knee: param(0),
  ratio: param(1), attack: param(0), release: param(0), fftSize: 1024, smoothingTimeConstant: 0, delayTime: param(0),
  curve: null, oversample: 'none', connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); }, getFloatTimeDomainData(b) { b.fill(0); },
});
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); this.audioWorklet = { addModule: async () => {} }; }
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
const { leesToonsoort } = await import('../src/engine/toonsoort.js');
const k = (s) => leesToonsoort(s);

// ---- 1. planner ------------------------------------------------------------------
console.log('planner: wat past');
ok('Camelot: zelfde = 0, relatief (Am ↔ C) = 1, buren (Am ↔ Em) = 1', P.camelotAfstand(k('Am'), k('Am')) === 0
  && P.camelotAfstand(k('Am'), k('C')) === 1 && P.camelotAfstand(k('Am'), k('Em')) === 1);
ok('Camelot: Am ↔ D = 3, onbekend = null', P.camelotAfstand(k('Am'), k('D')) === 3 && P.camelotAfstand(null, k('D')) === null);
ok('tempo: 124 → 126 = 1,6%', Math.abs(P.tempoAfwijking(124, 126) - 2 / 124) < 1e-9 && P.tempoAfwijking(null, 120) === null);

console.log('\nplanner: welke overgang');
const zeker = (bpm, toon) => ({ grid: {}, gridZeker: true, bpm, k: k(toon), toonZeker: true });
{
  const b = P.kiesOvergang(zeker(124, 'Am'), zeker(125, 'Em'));
  ok('beide zeker, tempo en toon passen: blend', b.type === 'blend' && !b.veilig);
  ok('tempo 124 → 140: filter (uitfilteren, op de 1)', P.kiesOvergang(zeker(124, 'Am'), zeker(140, 'Am')).type === 'filter');
  ok('toonsoorten botsen (Am → D): filter', P.kiesOvergang(zeker(124, 'Am'), zeker(124, 'D')).type === 'filter');
  ok('grid van de uitgaande onzeker: beatloos', P.kiesOvergang({ ...zeker(124, 'Am'), gridZeker: false }, zeker(124, 'Am')).type === 'ambient');
  ok('grid van de nieuwe onzeker: filter', P.kiesOvergang(zeker(124, 'Am'), { ...zeker(124, 'Am'), gridZeker: false }).type === 'filter');
  // Sync schuift de toon mee: Am op 121 gesynct naar 128 = +5,8% ≈ een halve toon → B♭m, en dat past niet bij Am.
  const s = P.kiesOvergang(zeker(128, 'Am'), zeker(121, 'Am'));
  ok('Am op 121 → 128 gesynct klinkt als B♭m: geen blend', s.type === 'filter' && /botsen/.test(s.redenen.join(' ')));
  const pl = P.kiesOvergang({ ...zeker(124, 'Am'), gridZeker: false }, zeker(124, 'Am'), { voorkeur: 'blend' });
  ok('plan wil blend waar het niet mag: beatloos, met de reden', pl.type === 'ambient' && /plan wilde/.test(pl.redenen[0]));
  ok('plan wil beatloos waar blend mag: beatloos (veiliger mag altijd)', P.kiesOvergang(zeker(124, 'Am'), zeker(124, 'Am'), { voorkeur: 'ambient' }).type === 'ambient');
  const onb = P.kiesOvergang(zeker(124, 'Am'), { ...zeker(124, 'Am'), toonZeker: false });
  ok('toon van de nieuwe onbekend: blend mag, met een waarschuwing', onb.type === 'blend' && /niet zeker/.test(onb.redenen.join(' ')));
}

console.log('\nplanner: wanneer');
{
  const g = new Beatgrid({ bpm: 120, firstBeat: 0 });           // maat = 2 s, 16 maten = 32 s
  const m = P.planMoment({ type: 'blend', grid: g, positie: 10, eind: 200 });
  ok(`blend op een 16-maatsgrens, zo laat mogelijk vóór het eind (start ${m.start}, ${m.lengte} s)`, m.start === 160 && m.lengte === 32);
  const m2 = P.planMoment({ type: 'blend', grid: g, positie: 150, eind: 175, vooruit: 8 });
  ok(`te laat voor een 16-maatsgrens: de eerstvolgende 4-maatsgrens (${m2.start})`, m2.start === 160);
  const m3 = P.planMoment({ type: 'filter', grid: g, positie: 10, eind: 100 });
  ok(`filter: 8 maten (${m3.lengte} s), eindigt vóór het eind`, m3.lengte === 16 && m3.start + m3.lengte <= 100 && m3.start % 32 === 0);
  const a = P.planMoment({ type: 'ambient', positie: 10, eind: 100, rate: 1 });
  ok('beatloos: 24 s vóór het eind', a.start === 76 && a.lengte === 24);
  ok('beatloos: nooit eerder dan "vooruit"', P.planMoment({ type: 'ambient', positie: 90, eind: 100 }).start === 90 + P.VOORUIT);
  const g2 = new Beatgrid({ bpm: 120, firstBeat: 0.5 });
  const m4 = P.planMoment({ type: 'blend', grid: g2, positie: 0, eind: 100 });
  ok('frasegrens telt vanaf het maat-anker (eerste tel op 0,5 s)', Math.abs(((m4.start - 0.5) % 32 + 32) % 32) < 1e-9);
}

console.log('\nplanner: de curves');
{
  let tweeBassen = false, stil = false;
  for (let i = 0; i <= 200; i++) {
    const s = P.standen('blend', i / 200);
    if (s.uit.low > 0.01 && s.in.low > 0.01 && s.uit.fader > 0.05 && s.in.fader > 0.05) tweeBassen = true;
    if (s.uit.fader < 0.05 && s.in.fader < 0.05) stil = true;
  }
  ok('blend: nooit twee bassen tegelijk', !tweeBassen);
  ok('blend: nooit stil (geen gat)', !stil);
  const b0 = P.standen('blend', 0), b1 = P.standen('blend', 1);
  ok('blend: begint met de uitgaande vol en de nieuwe dicht, eindigt andersom', b0.uit.fader === 1 && b0.in.fader === 0 && b1.uit.fader < 1e-9 && b1.in.fader === 1);
  ok('blend: de bas wisselt in het midden', P.standen('blend', 0.49).in.low === 0 && P.standen('blend', 0.5).uit.low === 0 && P.standen('blend', 0.5).in.low === 0.5);
  ok('filter: de nieuwe start pas op het eind', !P.standen('filter', 0.99).in.start && P.standen('filter', 1).in.start);
  ok('filter: highpass en echo lopen op', P.standen('filter', 1).uit.filter > 0.9 && P.standen('filter', 1).uit.sendA > 0.6);
  const a = [0, 0.3, 0.6, 1].map((p) => P.standen('ambient', p, { uitA: 0, uitB: 0.2, inA: 0, inB: 0 }));
  ok('beatloos: uitgaande sluit (lowpass), nieuwe opent', a[0].uit.filter === 0.5 && a[3].uit.filter < 0.2 && a[0].in.filter < 0.3 && a[3].in.filter === 0.5);
  ok('beatloos: galm erbij op de uitgaande, vanaf zijn eigen stand', a[0].uit.sendB === 0.2 && a[3].uit.sendB > 0.5);
  ok('klaarstand: blend en beatloos met de fader dicht, filter open (hij valt vol in)',
    P.klaarStand('blend').fader === 0 && P.klaarStand('ambient').fader === 0 && P.klaarStand('filter').fader === 1);
}

console.log('\nplanner: fragment en kiezer');
{
  const kort = { id: 'k', duur: 200 };
  ok('kort nummer: helemaal', JSON.stringify(P.fragment(kort)) === JSON.stringify({ van: 0, tot: 194 }));
  const lang = { id: 'l', duur: 3600, toon: { stukken: [{ van: 0, toonsoort: 'Am', zekerheid: 0.1 }, { van: 900, toonsoort: 'G', zekerheid: 0.9 }, { van: 3500, toonsoort: 'C', zekerheid: 0.9 }] } };
  const f = P.fragment(lang, { rnd: () => 0 });
  ok(`lange mix: begint waar een zeker stuk begint (${f.van}), 6 minuten`, f.van === 900 && f.tot === 900 + P.SPEELDUUR);
  ok('plan geeft de speelduur: ook een kort nummer korter', P.fragment(kort, { speelduur: 40 }).tot === 40 && P.fragment(kort).tot === 194);
  ok('plan geeft het beginpunt: dat telt', P.fragment(lang, { van: 1200, speelduur: 120 }).van === 1200 && P.fragment(lang, { van: 1200, speelduur: 120 }).tot === 1320);
  const tr = (id, bpm, toon, lufs = -14) => ({ id, audio: `media/${id}/audio.wav`, duur: 300, loudness_i: lufs,
    grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: 0.9 }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] } });
  const tracks = [tr('a', 124, 'Am'), tr('b', 125, 'Em'), tr('c', 90, 'F#'), tr('d', 124, 'Am', -30)];
  const huidig = { trackId: 'a', bpm: 124, k: k('Am'), toonZeker: true, loudness: -14 };
  const keus = P.kiesVolgende({ huidig, tracks, rnd: () => 0 });
  ok(`kiezer: tempo en toon dichtbij, even luid (${keus.track.id})`, keus.track.id === 'b');
  ok('kiezer: nooit wat nu speelt', P.kiesVolgende({ huidig, tracks: [tracks[0]] }) === null);
  const k2 = P.kiesVolgende({ huidig, tracks, gespeeld: new Set(['b']), rnd: () => 0 });
  ok(`kiezer: al gespeeld komt pas als al het andere op is (${k2.track.id})`, k2.track.id !== 'b');
}

// ---- 2. de automaat op een engine ---------------------------------------------------
console.log('\nautomaat');
const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, bindAuto, invoke, read, bijInvoke } = await import('../src/control/actions.js');
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const { Automaat } = await import('../src/auto/automaat.js');
const { ToonKaart } = await import('../src/engine/toonsoort.js');
const eng = new Engine();
bindEngine(eng);

// Een library van demotracks: 48 maten (~93 s), zeker grid, toonsoort.
const lib = [
  { id: 'een', titel: 'een', bpm: 124, toon: 'Am', seed: 1 },
  { id: 'twee', titel: 'twee', bpm: 125, toon: 'Em', seed: 2 },
  { id: 'drie', titel: 'drie', bpm: 124, toon: 'C', seed: 3 },
].map((t) => ({ id: t.id, titel: t.titel, audio: `media/${t.id}/audio.wav`, duur: 48 * 4 * 60 / t.bpm, loudness_i: -14,
  grid: { stukken: [{ van: 0, bpm: t.bpm, anker: 0, zekerheid: 0.9 }] },
  toon: { stukken: [{ van: 0, toonsoort: t.toon, zekerheid: 0.9 }] }, _bpm: t.bpm, _seed: t.seed }));
const opDeck = {};
const laad = async (deckId, track) => {
  const d = eng.deck(deckId);
  d.load(renderDemoTrack(eng.ctx, { bpm: track._bpm, bars: 48, seed: track._seed }), track.titel);
  d.setGrid(track.grid);
  d.setToonKaart(ToonKaart.van(track.toon));
  opDeck[deckId] = track.id;
};
const plan = { naam: 'proef', stappen: [{ track: 'een', waarom: 'begin rustig' }, { track: 'twee', overgang: 'blend', waarom: 'omhoog' }, { track: 'drie' }] };
const vanMij = [];
bijInvoke((id) => vanMij.push(id));
const auto = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => lib, haalPlan: async () => plan,
  welkNummer: (id) => opDeck[id] ?? null, rnd: () => 0, tik: 1e7 });
bindAuto(auto);
const wacht = () => new Promise((r) => setTimeout(r, 0));
const loop = async (sec, stap = 0.05, stop = () => false) => {
  for (let t = 0; t < sec; t += stap) { NOW += stap; auto.tik(); await wacht(); if (stop()) return true; }
  return false;
};

await auto.zetAan();
await wacht(); await wacht();
auto.tik(); await wacht(); await wacht();
const A = eng.deck('A');
ok('aan vanuit stilte: de eerste van het plan speelt op track 1, vol open', A.playing && opDeck.A === 'een' && A.ui.fader === 1 && auto.hoofd === 'A');
ok('read auto.aan = 1', read('auto.aan') === 1);
await loop(0.5, 0.05, () => auto.fase === 'klaar');
const v = auto.volgende;
ok('de volgende uit het plan staat klaar op track 2, stil, fader dicht, bas dicht', v?.track.id === 'twee' && v.deckId === 'B'
  && !eng.deck('B').playing && eng.deck('B').ui.fader === 0 && eng.deck('B').ui.low === 0);
ok(`blend (zekere grids, 124 → 125, Am → Em): ${v?.overgang?.naam}`, v?.overgang?.type === 'blend');
const g = A.grid;
ok(`op een frasegrens: tel ${v?.moment?.tel} is een veelvoud van 16 maten`, v?.moment && v.moment.tel % 64 === 0);
ok('... en klaar vóór het eind van het fragment', v.moment.start + v.moment.lengte <= auto.eind + 1e-6);
const st = auto.stand();
ok(`stand voor het scherm: → 2 · twee (Em) · lange blend · over ${st.volgende?.maten} maten · plan 2/3`,
  st.volgende?.nr === 2 && st.volgende.toon === 'Em' && st.volgende.maten > 0 && st.plan?.stap === 2 && st.plan.totaal === 3);

// langer en nu
const start0 = v.moment.start;
invoke('auto.langer', true);
ok('langer: 8 maten later (16 s op 124)', Math.abs(auto.volgende.moment.start - (start0 + 8 * 4 * 60 / 124)) < 1e-6
  || auto.melding?.tekst?.includes('langer kan niet'));
invoke('auto.nu', true);
const nuStart = auto.volgende.moment.start;
ok(`nu: de eerstvolgende 4-maatsgrens na ~1,5 s (${nuStart.toFixed(2)} bij positie ${A.position.toFixed(2)})`,
  nuStart > A.position && nuStart - A.position < 1.5 + 4 * 4 * 60 / 124 + 1e-6 && Math.abs(g.beatAt(nuStart) % 16) < 1e-6);
invoke('auto.ok', true);
ok('ok: bevestigd (read 1)', read('auto.ok') === 1);

// De overgang laten lopen, en onderweg de bassen bekijken.
vanMij.length = 0;
let tweeBassen = false, gestart = false;
const klaar = await loop(60, 0.05, () => {
  const a = eng.deck('A'), b = eng.deck('B');
  if (auto.fase === 'bezig' && b.playing && !b.wacht) {
    gestart = true;
    if (a.ui.low > 0.01 && b.ui.low > 0.01 && a.ui.fader > 0.05 && b.ui.fader > 0.05) tweeBassen = true;
  }
  return auto.hoofd === 'B' && auto.fase !== 'bezig';
});
ok('de overgang loopt en eindigt: track 2 is de hoofdtrack', klaar && auto.hoofd === 'B');
ok('track 2 startte (sync + op de maat)', gestart && Math.abs(eng.deck('B').bpm - 124) < 0.01);
ok('onderweg nooit twee bassen', !tweeBassen);
ok('track 1 staat stil, fader dicht, EQ terug op 0 dB', !A.playing && A.ui.fader === 0 && A.ui.low === 0.5 && A.ui.filter === 0.5);
ok('track 2 vol open, bas terug', eng.deck('B').ui.fader === 1 && eng.deck('B').ui.low === 0.5);
ok('alles ging over de bus (en dus het handelingenlog)', vanMij.includes('track.2.play.quant') && vanMij.includes('track.2.sync') && vanMij.some((x) => x === 'track.1.fader'));
ok(`niet elke tik een regel: ${vanMij.length} bus-acties voor een hele blend`, vanMij.length < 400);

// De volgende (drie, C op Em = 2 stappen: geen blend) komt klaar op track 1.
await loop(1, 0.05, () => auto.fase === 'klaar');
ok(`drie komt op track 1 (die de automaat al gebruikte): ${auto.volgende?.deckId}`, auto.volgende?.deckId === 'A' && auto.volgende.track.id === 'drie');
ok(`Em → C botst: ${auto.volgende?.overgang?.naam}`, auto.volgende?.overgang?.type === 'filter');

// Overslaan: het plan is dan op, de kiezer neemt het over (niet wat speelt, niet wat overgeslagen is).
invoke('auto.skip', true);
await loop(1, 0.05, () => auto.fase === 'klaar');
ok(`overslaan: een andere kandidaat van de kiezer (${auto.volgende?.track.id})`, auto.fase === 'klaar' && auto.volgende.track.id === 'een' && auto.volgende.bron === 'kiezer');

// Overnemen: Clay raakt midden in de overgang een fader aan.
invoke('auto.nu', true);
await loop(10, 0.05, () => auto.fase === 'bezig');
ok('de overgang is bezig', auto.fase === 'bezig');
invoke('track.1.fader', 0.3);
ok('Clay raakt de fader van de nieuwe aan: de overgang is van hem', auto.fase === 'overgenomen');
const voor = eng.deck('A').ui.fader;
await loop(1);
ok('de automaat laat de fader met rust', eng.deck('A').ui.fader === voor);
invoke('track.2.play', true);                                 // Clay zet de oude stil
await loop(0.2);
ok('als er één track overblijft gaat hij verder, met die track als hoofd', auto.hoofd === 'A' && ['wacht', 'laden', 'klaar'].includes(auto.fase));

// Dode lucht: alles stil, de automaat laat meteen weer iets klinken.
invoke('track.1.play', true);
await loop(2, 0.05, () => DECK_ANY());
function DECK_ANY() { return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].some((id) => eng.deck(id).playing); }
ok('niets klinkt meer: binnen 2 s speelt er weer iets', DECK_ANY());

invoke('auto.aan', true);
ok('uit: de automaat doet niets meer', !auto.aan && auto.fase === 'uit');
auto.vernietig();

// ---- 3. beatloos: Clay's hoofdroute (onzekere grids, ambient) ---------------------
console.log('\nautomaat: beatloos');
{
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) { const d = eng.deck(id); if (d.playing) d.togglePlay(); }
  const vaag = ['mist', 'dauw'].map((id, i) => ({ id, titel: id, audio: `media/${id}/audio.wav`, duur: 48 * 4 * 60 / 110, loudness_i: -18,
    grid: { stukken: [{ van: 0, bpm: 110, anker: 0, zekerheid: 0.1 }] }, toon: { stukken: [{ van: 0, toonsoort: i ? 'G' : 'Dm', zekerheid: 0.05 }] },
    _bpm: 110, _seed: 5 + i }));
  const au = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => vaag, haalPlan: async () => null,
    welkNummer: (id) => opDeck[id] ?? null, rnd: () => 0, tik: 1e7 });
  const loop2 = async (sec, stop = () => false) => { for (let t = 0; t < sec; t += 0.05) { NOW += 0.05; au.tik(); await wacht(); if (stop()) return true; } return false; };
  await au.zetAan();
  await loop2(1, () => au.fase === 'klaar');
  const hoofd = au.hoofd, vol = au.volgende;
  ok(`zonder plan kiest hij zelf, en het wordt beatloos: ${vol?.overgang?.naam} (${vol?.overgang?.redenen?.join(', ')})`,
    vol?.overgang?.type === 'ambient' && vol.bron === 'kiezer');
  ok('24 s vóór het einde van het fragment', Math.abs(vol.moment.start + vol.moment.lengte - au.eind) < 1e-6 && Math.abs(vol.moment.lengte - 24) < 1e-6);
  let gat = false, laagst = 1;
  const klaar2 = await loop2(120, () => {
    const u = eng.deck(hoofd), n = eng.deck(vol.deckId);
    if (au.fase === 'bezig') {
      const hoor = (u.playing ? u.ui.fader : 0) + (n.playing ? n.ui.fader : 0);
      laagst = Math.min(laagst, hoor);
      if (hoor < 0.5) gat = true;
    }
    return au.hoofd === vol.deckId && au.fase !== 'bezig';
  });
  ok('de nieuwe begint meteen onder de oude (geen start op de maat), en neemt het over', klaar2);
  ok(`nooit een gat: samen minstens 0,5 (laagst ${laagst.toFixed(2)})`, !gat);
  ok('de oude sloot met een lowpass en galm, en staat nu weer neutraal', eng.deck(hoofd).ui.filter === 0.5 && !eng.deck(hoofd).playing);
  au.vernietig();
}

// ---- 4. het plan verandert terwijl hij speelt (planpagina of Claude) ---------------
console.log('\nautomaat: vervangPlan');
{
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) { const d = eng.deck(id); if (d.playing) d.togglePlay(); }
  const plan1 = { versie: 2, naam: 'live', stappen: [
    { id: 's1', track: 'een', speelduur: 80 }, { id: 's2', track: 'twee', overgang: 'blend' }, { id: 's3', track: 'drie' }] };
  const au = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => lib, haalPlan: async () => ({ plan: plan1, versie: 'v1' }),
    welkNummer: (id) => opDeck[id] ?? null, rnd: () => 0, tik: 1e7 });
  const loop3 = async (sec, stop = () => false) => { for (let t = 0; t < sec; t += 0.05) { NOW += 0.05; au.tik(); await wacht(); if (stop()) return true; } return false; };
  await au.zetAan();
  await loop3(1, () => au.fase === 'klaar');
  ok('plan v2 met versie: hoofd = s1, klaar = s2', au.hoofdStap === 's1' && au.volgende?.stapId === 's2' && au.planVersie === 'v1' && au.stand().plan.volgendeStap === 's2');
  const kopie = (f) => { const p = JSON.parse(JSON.stringify(plan1)); f(p); return { plan: p, versie: 'v2' }; };

  au.vervangPlan(kopie((p) => { p.stappen[1].overgang = 'ambient'; p.stappen[1].waarom = 'rustiger'; }));
  ok('alleen de overgang anders: dezelfde volgende, opnieuw gepland (beatloos)', au.fase === 'klaar' && au.volgende.stapId === 's2' && au.volgende.overgang.type === 'ambient' && au.volgende.waarom === 'rustiger');

  au.vervangPlan(kopie((p) => { p.stappen[1].track = 'drie'; }));
  ok('ander nummer op de klaarstaande stap: opnieuw kiezen', au.fase === 'wacht' && au.volgende === null);
  await loop3(1, () => au.fase === 'klaar');
  ok('... en dan staat het nieuwe nummer klaar (drie, stap s2)', au.volgende?.track.id === 'drie' && au.volgende.stapId === 's2');

  const d = eng.deck(au.hoofd);
  au.vervangPlan(kopie((p) => { p.stappen[0].speelduur = 40; }));
  ok(`kortere speelduur van wat nu klinkt: het einde schuift mee (${au.eind.toFixed(1)} s)`, Math.abs(au.eind - Math.max(d.position + 4, 40)) < 1e-6);

  au.vervangPlan(kopie((p) => { p.stappen = [p.stappen[0], { id: 's9', track: 'twee' }, p.stappen[2]]; }));
  ok('stap weg en een nieuwe op zijn plek: de nieuwe (s9) wordt gekozen', au.fase === 'wacht');
  await loop3(1, () => au.fase === 'klaar');
  ok('... s9 = twee staat klaar', au.volgende?.stapId === 's9' && au.volgende.track.id === 'twee');

  // Laten spelen tot de overgang klaar is: de geschiedenis weet wat er gebeurde.
  await loop3(90, () => au.hoofdStap === 's9' && au.fase !== 'bezig');
  const g = au.geschiedenis.filter((x) => x.wat === 'gespeeld');
  ok(`geschiedenis: s1 gespeeld (start), s9 gespeeld met de gekozen overgang (${g.map((x) => `${x.stap}:${x.gekozen}`).join(' ')})`,
    g.length === 2 && g[0].stap === 's1' && g[0].gekozen === 'start' && g[1].stap === 's9' && !!g[1].gekozen);
  ok('het plan gaat verder na s9 (index 2 = s3)', au.planIndex === 2);
  au.vernietig();
}

// ---- 5. stems: wat Clay aanraakt tijdens een overgang is van hem --------------------
// Een stem dichtdraaien of wegdrukken op een track in de overgang is ingrijpen,
// net als een EQ-kill (docs/STEMS.md §3, OVERNEEM). Een stem op een track die
// niet meedoet, of een action die geen stem is, niet.
console.log('\nautomaat: stems overnemen');
{
  // Via de bus; een id die geen action is komt de bus niet op, die gaat rechtstreeks naar de automaat.
  const proef = (id, waarde, viaBus = true) => {
    const au = new Automaat({ engine: eng, invoke, bijInvoke, laad, haalLibrary: async () => lib, tik: 1e7 });
    Object.assign(au, { aan: true, fase: 'bezig', hoofd: 'A', volgende: { deckId: 'B' } });
    if (viaBus) invoke(id, waarde); else au._bijBus(id);
    const fase = au.fase;
    au.vernietig();
    return fase;
  };
  const neemt = [['track.2.stem.vocals', 0.4], ['track.2.stem.inst.kill', true], ['track.1.stem.vocals.hold', true],
    ['track.1.stem.drums', 0.2], ['track.2.stem.bass.kill', true], ['track.1.stem.other.hold', true]];
  const mis = neemt.filter(([id, v]) => proef(id, v) !== 'overgenomen').map(([id]) => id);
  for (const id of ['track.1.stem.vocals.hold', 'track.1.stem.other.hold']) invoke(id, false);
  ok(`niveau, kill en drukknop van een stem op een track in de overgang: overgenomen${mis.length ? ` (niet: ${mis.join(', ')})` : ''}`, mis.length === 0);
  ok('een stem op een track die niet meedoet: niet overgenomen', proef('track.5.stem.vocals.kill', true) === 'bezig');
  ok('geen stem (stem.foo, stems.vocals): niet overgenomen', proef('track.2.stem.foo', 1, false) === 'bezig'
    && proef('track.2.stems.vocals', 1, false) === 'bezig' && proef('track.2.stem.vocals.kill.x', 1, false) === 'bezig');
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
