// De auto-DJ: de planner (puur) en de automaat op een echte engine met een
// nep-Web Audio, van stilte tot een hele blend, plus ingrijpen en overnemen.
// Draai met: node test/auto.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-Web Audio met een tijdlijn per AudioParam (test/nep-tijdlijn.mjs) ------------
// Zo streng als engine.test (overlappende curves gooien, CURVE_BREUK telt), en
// hij rekent uit wat een parameter op elk moment doet: trapje of helling.
let NOW = 0;
const { maakTijdlijn } = await import('./nep-tijdlijn.mjs');
const { param, stats: TL } = maakTijdlijn(() => NOW);
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

// Spoor S9 (docs/PLAN-SET.md §4): de automaat met een set waar Clay live bij mixt. Tracks van de
// automaat en tracks voor Clay, nooit een track van Clay, GO, buiten en terug naar het plan, lagen.
// Op een echte engine met de nep-Web Audio van auto.test. Draai met: node test/auto-set.test.mjs
const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, bindAuto, invoke, read, bijInvoke, define, metaOf } = await import('../src/control/actions.js');
const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
const { Automaat } = await import('../src/auto/automaat.js');
const { ToonKaart } = await import('../src/engine/toonsoort.js');
const { bindPlanActies } = await import('../src/control/acties-set.js');
const { slaOver } = await import('../src/control/terugspelen.js');
const eng = new Engine();
bindEngine(eng);

const lib = [
  { id: 'een', bpm: 124, toon: 'Am', seed: 1 }, { id: 'twee', bpm: 125, toon: 'Em', seed: 2 },
  { id: 'drie', bpm: 124, toon: 'C', seed: 3 }, { id: 'vier', bpm: 124, toon: 'Am', seed: 4 },
  { id: 'acap', bpm: 124, toon: 'Am', seed: 5 },
].map((t) => ({ id: t.id, titel: t.id, audio: `media/${t.id}/audio.wav`, duur: 48 * 4 * 60 / t.bpm, loudness_i: -14,
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
const wacht = () => new Promise((r) => setTimeout(r, 0));
const vanAuto = [];       // wat de automaat zelf over de bus stuurde
let auto = null;
const zonder = bijInvoke(() => {});
zonder();
const bus = (id, v) => invoke(id, v);
const maak = (plan) => {
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) { const d = eng.deck(id); if (d.playing) d.pause(); }
  auto?.vernietig();
  const a = new Automaat({ engine: eng, invoke: (id, v) => { vanAuto.push(id); return invoke(id, v); }, bijInvoke, laad,
    haalLibrary: async () => lib, haalPlan: async () => plan, welkNummer: (id) => opDeck[id] ?? null, rnd: () => 0, tik: 1e7 });
  bindAuto(a);
  bindPlanActies({ auto: a, define });
  auto = a;
  return a;
};
const loop = async (sec, stap = 0.05, stop = () => false) => {
  for (let t = 0; t < sec; t += stap) { NOW += stap; auto.tik(); await wacht(); if (stop()) return true; }
  return false;
};
const start = async (a) => { await a.zetAan(); await wacht(); await wacht(); a.tik(); await wacht(); await wacht(); };

console.log('tracks van de automaat');
{
  const a = maak({ tracks: { auto: [1, 2] }, stappen: [{ id: 's1', track: 'een' }, { id: 's2', track: 'twee' }, { id: 's3', track: 'drie' }] });
  await start(a);
  ok('de eerste stap op track 1', a.hoofd === 'A' && eng.deck('A').playing);
  // Clay laadt intussen iets op track 3 en speelt het (zijn track).
  await laad('C', lib[3]);
  bus('track.3.play', true);
  await loop(5, 0.05, () => a.fase === 'klaar');
  ok(`de volgende op track 2, niet op een lege track van Clay (${a.volgende?.deckId})`, a.volgende?.deckId === 'B');
  const decks = new Set(['A', 'B']);
  await loop(200, 0.05, () => a.hoofd === 'B' && a.fase === 'klaar');
  ok(`na de overgang de derde weer op track 1 (${a.volgende?.deckId})`, a.volgende?.deckId === 'A');
  ok('de automaat raakte track 3 nooit aan', !vanAuto.some((id) => id.startsWith('track.3.')));
  ok('track 3 speelt nog (van Clay)', eng.deck('C').playing);
  ok(`alleen tracks 1 en 2 gebruikt (${[...a.eigen].join()})`, [...a.eigen].every((d) => decks.has(d)));
  // Overname met Clay's track die ook speelt: na het overnemen wacht hij alleen op ZIJN tracks.
  await loop(200, 0.05, () => a.fase === 'bezig');
  const inn = a.volgende.deckId, uit = a.hoofd;
  bus(`track.${uit === 'A' ? 1 : 2}.fader`, 0.5);
  ok('Clay grijpt in tijdens de overgang: overgenomen', a.fase === 'overgenomen');
  if (eng.deck(uit).playing) bus(`track.${uit === 'A' ? 1 : 2}.play`, true);
  await loop(0.5);
  ok('zijn eigen track 3 speelt nog, maar die neemt de automaat niet: hij wacht op zijn eigen tracks', a.fase === 'overgenomen' && a.hoofd !== 'C');
  if (!eng.deck(inn).playing) bus(`track.${inn === 'A' ? 1 : 2}.play`, true);
  bus(`track.${inn === 'A' ? 1 : 2}.fader`, 1);
  await loop(0.2);
  ok(`Clay start de nieuwe zelf: de automaat gaat verder met track ${inn === 'A' ? 1 : 2} (${a.hoofd}, ${a.fase})`, a.fase !== 'overgenomen' && a.hoofd === inn);
  // Alles stil op de tracks van de automaat en op die van Clay: nooit stilte, meteen de volgende.
  bus('track.3.play', true);
  bus(`track.${inn === 'A' ? 1 : 2}.fader`, 0.4);
  a.fase = 'overgenomen';
  bus(`track.${inn === 'A' ? 1 : 2}.play`, true);
  await loop(0.5, 0.05, () => a.fase !== 'overgenomen');
  await loop(1);
  ok(`overgenomen en alles stil: hij start meteen weer iets (${a.hoofd} speelt: ${eng.deck(a.hoofd ?? 'A').playing})`, !!a.hoofd && eng.deck(a.hoofd).playing);
  a.vernietig();
}

console.log('\nzonder tracks in het plan: nooit een track van Clay');
{
  const a = maak({ stappen: [{ id: 's1', track: 'een' }, { id: 's2', track: 'twee' }] });
  for (const id of ['B', 'C']) { const d = eng.deck(id); if (d.buffer) { d.pause(); } }
  eng.deck('B').leeg?.();
  await start(a);
  const hoofd = a.hoofd;
  // Clay draait aan de fader van de eerstvolgende lege track.
  const vrije = ['A', 'B', 'C', 'D'].find((id) => id !== hoofd);
  bus(`track.${['A', 'B', 'C', 'D'].indexOf(vrije) + 1}.filter`, 0.3);
  await loop(5, 0.05, () => a.fase === 'klaar');
  ok(`de volgende niet op track ${vrije} waar Clay net aan draaide (${a.volgende?.deckId})`, a.volgende && a.volgende.deckId !== vrije && a.volgende.deckId !== hoofd);
  a.vernietig();
}

console.log('\nGO');
{
  const a = maak({ tracks: { auto: [1, 2] }, stappen: [{ id: 's1', track: 'een' }, { id: 's2', track: 'twee', go: 'wacht' }, { id: 's3', track: 'drie' }] });
  const meldingen = [];
  a.on('melding', ({ tekst }) => meldingen.push(tekst));
  await start(a);
  const H = () => eng.deck(a.hoofd);
  await loop(5, 0.05, () => a.fase === 'klaar');
  const v = a.volgende;
  ok('een GO-stap staat klaar en wacht', v?.stapId === 's2' && v.goWacht && !v.goGegeven && read('plan.go') === 1);
  const st = a.stand();
  ok(`de stand zegt: wacht op GO, uiterlijk over ${st.volgende?.go?.uiterlijk?.toFixed(1)} s`, st.volgende?.go?.wacht === true && st.volgende.go.uiterlijk > 0);
  const m0 = v.moment.start;
  const nieuw = eng.deck(v.deckId);
  await loop(200, 0.05, () => H().position > m0 + 4);
  ok('zijn moment is voorbij, en hij is niet begonnen', a.fase === 'klaar' && !nieuw.playing);
  bus('plan.go', true);
  ok('GO: het moment is nu (de eerstvolgende 4 maten)', a.volgende.goGegeven === true && a.volgende.moment.start > H().position
    && a.volgende.moment.start - H().position < 1.5 + 8);
  await loop(60, 0.05, () => a.hoofdStap === 's2');
  ok('... en de overgang loopt tot de GO-stap de hoofdtrack is', a.hoofdStap === 's2');
  await loop(5, 0.05, () => a.fase === 'klaar');
  a.vervangPlan({ plan: { tracks: { auto: [1, 2] }, stappen: [{ id: 's1', track: 'een' }, { id: 's2', track: 'twee', go: 'wacht' }, { id: 's3', track: 'drie', go: 'wacht' }] } });
  ok('een nieuw plan maakt de klaarstaande ook een GO-stap', a.volgende?.stapId === 's3' && a.volgende.goWacht === true);
  let stil = 0;
  await loop(200, 0.05, () => { if (!eng.deck('A').playing && !eng.deck('B').playing) stil++; return a.hoofdStap === 's3'; });
  ok(`zonder GO ging hij toch, vóór het einde (stil ${stil} tikken)`, a.hoofdStap === 's3' && stil === 0);
  ok('... met een melding', meldingen.some((t) => /geen GO/.test(t)));
  a.vernietig();
}

console.log('\nbuiten het plan en terug');
{
  const a = maak({ tracks: { auto: [1, 2] }, stappen: [{ id: 's1', track: 'een' }, { id: 's2', track: 'twee' }, { id: 's3', track: 'drie' }] });
  await start(a);
  await loop(5, 0.05, () => a.fase === 'klaar');
  bus('plan.buiten', true);
  ok('buiten: niets klaar, fase buiten, read 1', a.fase === 'buiten' && !a.volgende && read('plan.buiten') === 1);
  const voor = vanAuto.length;
  await laad('C', lib[3]);
  bus('track.3.play', true);
  bus(`track.${a.hoofd === 'A' ? 1 : 2}.play`, true);           // Clay stopt de set zelf
  await loop(20);
  if (vanAuto.length !== voor) console.log('   buiten stuurde:', vanAuto.slice(voor).join(' '));
  ok('buiten raakt de automaat niets aan, ook niet als het stil wordt op zijn tracks', vanAuto.length === voor && !eng.deck('A').playing && !eng.deck('B').playing);
  bus('plan.terug', true);
  ok(`terug: wat klinkt (track 3) wordt de hoofdtrack, het plan gaat verder na s1 (${a.hoofd}, index ${a.planIndex})`, a.hoofd === 'C' && a.planIndex === 1 && a.fase !== 'buiten');
  await loop(10, 0.05, () => a.fase === 'klaar');
  if (a.fase !== 'klaar') console.log('   fase', a.fase, a.melding?.tekst);
  ok(`de volgende is s2 op een track van de automaat (${a.volgende?.stapId} op ${a.volgende?.deckId})`, a.volgende?.stapId === 's2' && ['A', 'B'].includes(a.volgende.deckId));
  a.vernietig();
}

console.log('\nlagen');
{
  for (const id of ['C', 'D', 'E', 'F']) { const d = eng.deck(id); if (d.playing) d.pause(); }
  const a = maak({ tracks: { auto: [1, 2] }, stappen: [
    { id: 's1', track: 'een', lagen: [
      { id: 'l1', soort: 'nummer', track: 'acap', op: { sec: 32 }, deck: 5, duur: 12 },
      { id: 'l2', soort: 'nummer', track: 'vier', op: { sec: 50 }, deck: 3 },
      { id: 'l3', soort: 'sampler', pad: 2, op: { sec: 34 } },
    ] },
    { id: 's2', track: 'twee' }] });
  await start(a);
  ok('de lagen van de eerste stap staan klaar om te komen', a.lagen.length === 3 && a.lagen.every((l) => l.status === 'wacht'));
  const H = eng.deck(a.hoofd);
  await loop(15, 0.05, () => a.lagen[0].status === 'klaar');
  ok(`30 s vooraf: de laag staat geladen op track 5, fader dicht, stil (${a.lagen[0].status})`, a.lagen[0].status === 'klaar' && opDeck.E === 'acap'
    && eng.deck('E').ui.fader === 0 && !eng.deck('E').playing);
  ok(`de live-stand noemt hem (${JSON.stringify(a.stand().laag)})`, a.stand().laag?.id === 'l1' && /over/.test(a.stand().laag.wanneer));
  await loop(40, 0.05, () => eng.deck('E').playing);
  const pos = H.position;
  ok(`op zijn moment start hij (positie ${pos.toFixed(2)} ≈ 32, op de maat)`, eng.deck('E').playing && pos >= 32 - 0.1 && pos < 34.5);
  let max = 0;
  await loop(6, 0.05, () => { max = Math.max(max, eng.deck('E').ui.fader); return false; });
  ok(`de fader gaat open tot ${max.toFixed(2)} (≈ 0,8)`, Math.abs(max - 0.8) < 0.03);
  ok('sampler-pad 2 is leeg: die laag is overgeslagen', a.lagen[2].status === 'weg');
  await loop(10, 0.05, () => !eng.deck('E').playing);
  ok(`na zijn duur gaat hij dicht en stopt hij (${eng.deck('E').position.toFixed(1)} s)`, !eng.deck('E').playing && eng.deck('E').ui.fader === 0);
  // Laag 2: Clay raakt de track aan zodra hij klaarstaat = de laag is van hem.
  await loop(10, 0.05, () => a.lagen[1].status === 'klaar');
  ok('laag 2 klaar op track 3', a.lagen[1].status === 'klaar' && opDeck.C === 'vier');
  bus('track.3.filter', 0.4);
  ok('Clay draait aan track 3: de laag is van hem', a.lagen[1].status === 'jij');
  const n0 = vanAuto.filter((id) => id.startsWith('track.3.')).length;
  await loop(30);
  ok('daarna stuurt de automaat niets meer naar track 3', vanAuto.filter((id) => id.startsWith('track.3.')).length === n0 && !eng.deck('C').playing);
  a.vernietig();
}

console.log('\nlagen: overslaan, en een track die in gebruik is');
{
  for (const id of ['C', 'D', 'E', 'F']) { const d = eng.deck(id); if (d.playing) d.pause(); }
  const a = maak({ tracks: { auto: [1, 2] }, stappen: [{ id: 's1', track: 'een', lagen: [
    { id: 'l1', soort: 'nummer', track: 'acap', op: { sec: 35 }, deck: 6 },
    { id: 'l2', soort: 'nummer', track: 'vier', op: { sec: 50 }, deck: 4 } ] }, { id: 's2', track: 'twee' }] });
  await start(a);
  bus('plan.laag.skip', true);
  ok('overslaan: de eerste laag', a.lagen[0].status === 'overgeslagen');
  await laad('D', lib[2]);
  bus('track.4.play', true);           // Clay speelt iets op track 4
  await loop(30, 0.05, () => a.lagen[1].status !== 'wacht');
  ok(`laag 2 op track 4 die Clay gebruikt: overgeslagen (${a.lagen[1].status}, ${a.melding?.tekst})`, a.lagen[1].status === 'weg' && /in gebruik/.test(a.melding?.tekst ?? ''));
  ok('track 6 bleef leeg en onaangeraakt', !vanAuto.some((id) => id.startsWith('track.6.')));
  a.vernietig();
}

console.log('\nhet log');
ok('plan.* staat met log: overslaan in zijn define (terugspelen herhaalt de gevolgen, niet de knop)',
  ['plan.go', 'plan.buiten', 'plan.terug', 'plan.laag.nu', 'plan.laag.skip'].every((id) => slaOver(id, metaOf) && metaOf(id)?.beginstand === false));

console.log(fails.length ? `\n${fails.length} FOUT:\n  ${fails.join('\n  ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
