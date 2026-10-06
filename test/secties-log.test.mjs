// Secties in het handelingenlog (docs/HANDELINGENLOG.md, TASKS-SECTIES "Verweven" punt 4):
// een opgenomen sectiesprong landt bij terugspelen op DEZELFDE plek. Gemeten op een
// nep-klok met de echte engine (Web Audio-mock): de positie van de track op elk
// meetmoment, toen tegen nu.
//   - de sectiekaart staat in de beginstand en als gebeurtenis `secties` (zoals `grid`):
//     een kaart die intussen opnieuw berekend is, verandert de sprongen niet;
//   - `section.*` hoort bij het nummer (NUMMER_NODIG);
//   - een sectie-loop in de beginstand is een gewone loop van het deck (geen eigen veld);
//   - een druk vlak na de "1" (binnen de marge van 0,02 tel) die bij terugspelen een tik
//     te laat komt, landt toch op dezelfde maat: het terugspelen geeft `laat` mee, en de
//     druk draagt in het log de plek waarvan de sprong rekende (`van`), ook als het
//     terugspelen een paar ms naast ligt of de klok tikte tussen log en sprong;
//   - drie generaties (opnieuw renderen) blijven gelijk, ook met een stand midden in het log;
//   - een oud log (zonder secties) speelt terug zoals voorheen.
// Draai met: node test/secties-log.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- Web Audio-mock (zoals secties.test) ----
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {}, getByteTimeDomainData(b) { b.fill(128); } });
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
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    s.start = () => {}; s.stop = () => {}; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};

const A = await import('../src/control/actions.js');
const H = await import('../src/control/handelingen.js');
const T = await import('../src/control/terugspelen.js');
const { Engine, DECK_IDS } = await import('../src/engine/engine.js');

const eng = new Engine();
A.bindEngine(eng);
const d = eng.deck('A');
const BUF = eng.ctx.createBuffer(2, 48000 * 60, 48000);   // een minuut stilte: de mock rekent alleen posities
const DEMO = { seed: 0, bars: 4 };
const herk = { A: { bron: 'demo', demo: DEMO } };
const GRID = { stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true };   // tel 0,5 s, maat 2 s
// De kaart van toen: secties op 0, 16, 32, 48 en 56 s (op een "1").
const KAART = { versie: 1, opGrid: true, grid: 'abcd1234', bron: 'auto', slot: false, stukken: [
  { van: 0, label: 'intro', groep: 'A', energie: 0.2 }, { van: 16, label: 'drop', groep: 'B', energie: 1 },
  { van: 32, label: 'break', groep: 'C', energie: 0.3 }, { van: 48, label: 'drop', groep: 'B', energie: 1 },
  { van: 56, label: 'outro', groep: 'D', energie: 0.4 }] };
// Wat de server NA een herberekening (ander grid) zegt: alles twee maten later.
const ANDERS = { ...KAART, grid: 'ffff0000', stukken: KAART.stukken.map((s, i) => ({ ...s, van: i ? s.van + 4 : 0 })) };

/** Timers op bestelling: de test bepaalt wanneer een tik is. */
function nepTimers() {
  const lijst = new Set();
  return { elke: (fn) => { const h = { fn }; lijst.add(h); return h; }, stopElke: (h) => lijst.delete(h), tik: () => { for (const h of [...lijst]) h.fn(); } };
}

/** Een log in het geheugen (de echte klasse; de "server" zet elk stuk op zijn byte). */
function geheugenLog() {
  let tekst = '';
  const timers = nepTimers();
  const log = new H.Handelingenlog({ klok: () => NOW, elke: timers.elke, stopElke: timers.stopElke, wacht: async () => {},
    haal: async (url, init) => {
      if (url.endsWith('/start')) return { ok: true, json: async () => ({ ok: true, id: '20261006-120000', bestand: 'x' }) };
      const { van, tekst: t } = JSON.parse(init.body);
      tekst = tekst.slice(0, van).padEnd(van, '\0') + t + tekst.slice(van + t.length);
      return { ok: true, json: async () => ({ ok: true }) };
    } });
  return { log, timers, lees: () => H.leesLog(tekst) };
}

const standNu = () => H.leesStand({ engine: eng, tracks: A.TRACKS, herkomst: (id) => herk[id] ?? null, acties: A.list(), lees: A.read });

/**
 * Wat logboek.js doet: de bus in het log (met `laat`: een teruggespeelde druk staat
 * op het moment waarop hij bedoeld was), en de sectiekaart VERGELIJKEN (identiteit).
 */
function koppel(log) {
  const gezien = {};
  for (const id of DECK_IDS) gezien[id] = eng.deck(id).sectieKaart;
  const kijk = () => {
    if (!log.bezig) return;
    for (const [nr, id] of A.TRACKS) {
      const k = eng.deck(id).sectieKaart;
      if (k !== gezien[id]) { gezien[id] = k; log.gebeurtenis('secties', { track: nr, secties: k ? k.toJSON() : null }); }
    }
  };
  const los = A.bijInvoke((id, v, o) => { log.neem(id, v, o?.laat); if (typeof v === 'boolean') queueMicrotask(kijk); });
  // De plek waarvan een sectiesprong rekende, bij de druk (de deck meldt hem tijdens de action).
  const af = A.TRACKS.map(([nr, id]) => eng.deck(id).on('sectiedruk', ({ van }) => log.vulAan?.(`track.${nr}.section.`, { van })));
  const weg = () => { los(); for (const f of af) f(); };
  // naLaad: wat er na een laad staat telt als gezien (de laad-gebeurtenis zegt het al).
  const naLaad = (id) => { gezien[id] = eng.deck(id).sectieKaart; };
  return { kijk, weg, naLaad };
}

/** De begintoestand van een set: track 1 met grid en kaart, spelend vanaf `vanaf`. */
function zetKlaar({ vanaf, kaart = KAART, loop = null }) {
  for (const x of DECK_IDS.map((id) => eng.deck(id))) x.pause();
  d.load(BUF, 'demo 1');
  d.setGrid(GRID);
  d.setSectieKaart(kaart);
  d.seek(vanaf);
  if (loop) { A.invoke(loop, true); A.invoke(loop, false); }
  d.play();
}

/**
 * Opnemen: de handelingen op hun precieze tijd (geen tik), en de positie van track 1
 * op elk meetmoment (ms na het begin van het log). Geeft het gelezen log en de posities.
 */
async function neemOp({ acties, meet, voor = null, tikIn = 0 }) {
  NOW = 100;
  voor?.();
  const g = geheugenLog();
  const k = koppel(g.log);
  // tikIn: de audioklok gaat een stap verder tussen de bus (het log) en de sprong zelf.
  const stap = tikIn ? A.bijInvoke((id, v) => { if (/\.section\./.test(id) && v === true) NOW += tikIn; }) : () => {};
  await g.log.start({ stand: standNu() });
  const punten = [...acties.map(([t, a, v]) => ({ t: t * 1000, a, v })), ...meet.map((ms) => ({ t: ms, meet: true }))]
    .sort((x, y) => x.t - y.t || (x.meet ? 1 : 0) - (y.meet ? 1 : 0));
  const pos = new Map();
  for (const p of punten) {
    NOW = 100 + p.t / 1000;
    if (p.meet) pos.set(p.t, d.position);
    else A.invoke(p.a, p.v);
    await Promise.resolve();
    k.kijk();
  }
  g.timers.tik();
  await g.log.stop();
  k.weg(); stap();
  return { l: g.lees(), pos };
}

/**
 * Terugspelen op een nep-klok die in tikken van 10 ms loopt (zoals de echte timer):
 * een regel gaat de bus op bij de eerste tik op of na zijn moment, dus tot 10 ms te laat.
 * Meet de positie op dezelfde LOG-tijden (na T0; een stand midden in het log schuift
 * T0 op, de klok van het log staat dan stil). `scheef`: de klok loopt zoveel door
 * tussen het starten van de tracks en T0 (in Chrome: een stap van de audioklok,
 * 2,67 ms): dan loopt het terugspelen zoveel vóór op het origineel.
 */
async function speelTerug({ l, meet, start = 200, log = null, scheef = 0 }) {
  NOW = start;
  const timers = nepTimers();
  const doe = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
    huidig: (id) => herk[id] ?? null,
    laad: async (deckId, e) => { eng.deck(deckId).load(BUF, 'demo 1'); eng.deck(deckId).setGrid(e.grid ?? null); return true; } });
  if (scheef) { const stand = doe.stand; doe.stand = async (...x) => { const r = await stand(...x); NOW += scheef; return r; }; }
  const sp = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, doe, elke: timers.elke, stopElke: timers.stopElke });
  if (log) sp.onStand = () => { if (log.bezig) log.gebeurtenis('stand', standNu()); };
  let klaar = null;
  sp.onKlaar = (x) => { klaar = x; };
  await sp.start({ stand: l.stand, regels: l.regels, duur: l.duur });
  const T0 = sp.T0;
  const pos = new Map();
  let k = 0;
  for (const ms of [...meet].sort((a, b) => a - b)) {
    // Tikken tot het meetmoment (een tik op hetzelfde moment eerst, zoals bij het opnemen).
    for (;;) {
      const tik = T0 + (k + 1) / 100, monster = sp.T0 + ms / 1000;
      if (tik > monster + 1e-12) { NOW = monster; break; }
      NOW = tik; k++;
      timers.tik();
      await new Promise((z) => setImmediate(z));   // alles wat de tik in gang zette (een stand midden in het log)
    }
    pos.set(ms, d.position);
  }
  sp.stop();
  return { pos, klaar, T0, sp };
}

const verschil = (a, b) => Math.max(...[...a.keys()].map((ms) => Math.abs(a.get(ms) - b.get(ms))));
const toon = (a, b, ms) => `${ms} ms: toen ${a.get(ms)?.toFixed(3)} / nu ${b.get(ms)?.toFixed(3)}`;
const ergste = (a, b) => [...a.keys()].reduce((m, ms) => (Math.abs(a.get(ms) - b.get(ms)) > Math.abs(a.get(m) - b.get(m)) ? ms : m));
const meetElke = (tot, stap = 50) => Array.from({ length: Math.floor(tot / stap) + 1 }, (_, i) => i * stap);

try {
  console.log('NUMMER_NODIG: section.* hoort bij het nummer');
  {
    ok('section.N, section.N.loop, next en prev: niet op een track zonder zijn nummer van toen',
      ['track.1.section.5', 'track.3.section.40.loop', 'track.2.section.next', 'track.8.section.prev'].every((a) => T.NUMMER_NODIG.test(a)));
    ok('... en ze gaan wel terug de bus op (niet in OVERSLAAN)', !T.OVERSLAAN.test('track.1.section.5') && !T.OVERSLAAN.test('track.1.section.next'));
    // Een track zonder zijn nummer: de sectie-actions en de secties-gebeurtenis overslaan.
    const tz = nepTimers();
    const gedaan = [];
    const sp = new T.Terugspeler({ klok: () => NOW, invoke: (a, v) => gedaan.push(`${a}:${v}`), elke: tz.elke, stopElke: tz.stopElke,
      doe: { stand: async () => ({ zonder: [2] }), laad: async () => true, rack() {}, focus() {}, pads() {}, grid() {}, hotcues() {},
        secties: (t, k) => gedaan.push(`secties ${t} ${k?.stukken?.length ?? null}`) } });
    let klaar = null;
    sp.onKlaar = (x) => { klaar = x; };
    NOW = 50;
    await sp.start({ stand: { tracks: [] }, duur: 0.1, regels: [
      { t: 0.01, e: 'secties', track: 1, secties: KAART }, { t: 0.02, e: 'secties', track: 2, secties: KAART },
      [0.03, 'track.2.section.3', true], [0.03, 'track.2.section.3', false], [0.04, 'track.2.fader', 0.5], [0.05, 'track.1.section.2', true],
      [0.06, 'track.1.section.2', false]] });
    for (let i = 1; i <= 11; i++) { NOW = 50 + i / 100; tz.tik(); }
    ok(`secties-gebeurtenis toegepast; op een track zonder zijn nummer niet, en zijn secties ook niet (${gedaan.join(' | ')})`,
      gedaan.join('|') === 'secties 1 5|track.2.fader:0.5|track.1.section.2:true|track.1.section.2:false' && klaar?.overgeslagen === 3);
  }

  console.log('\nde kaart in de beginstand');
  {
    zetKlaar({ vanaf: 3 });
    const st = standNu();
    ok('leesStand: per track de sectiekaart (toJSON), een lege track null',
      JSON.stringify(st.tracks[0].secties) === JSON.stringify(d.sectieKaart.toJSON()) && st.tracks[1].secties === null && 'secties' in st.tracks[1]);
    // De server rekende intussen opnieuw (ander grid): op het deck staat een andere kaart.
    d.pause();
    d.setSectieKaart(ANDERS);
    const doe = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
      huidig: (id) => herk[id] ?? null, laad: async () => true });
    await doe.stand(st);
    ok(`een beginstand zet de kaart van TOEN terug (sectie 2 op ${d.sectieKaart?.begin(1)} s, niet ${ANDERS.stukken[1].van})`,
      JSON.stringify(d.sectieKaart?.toJSON()) === JSON.stringify(st.tracks[0].secties));
    const kaart0 = d.sectieKaart;
    await doe.stand(st);
    ok('dezelfde kaart nog eens: niet opnieuw gezet (geen nieuw object, geen sprong die wegvalt)', d.sectieKaart === kaart0);
    // Een oud log (van vóór de secties in het log): geen `secties` in de stand. Dan blijft
    // staan wat er is (in de app: wat de server bij het laden geeft), zoals voorheen.
    d.setSectieKaart(ANDERS);
    const oud = { ...st, tracks: st.tracks.map(({ secties, ...t }) => t) };
    await doe.stand(oud);
    ok('een oud log zonder secties: de kaart blijft wat hij is (de server)', d.sectieKaart?.begin(1) === ANDERS.stukken[1].van);
    ok('kentSecties: een nieuw log wel, een oud log niet', typeof T.kentSecties === 'function' && T.kentSecties({ stand: st, regels: [] }) === true
      && T.kentSecties({ stand: oud, regels: [] }) === false && T.kentSecties({ stand: null, regels: [{ t: 1, e: 'secties', track: 1, secties: null }] }) === true
      && T.kentSecties({ stand: null, regels: [] }) === false);
    for (const x of DECK_IDS.map((id) => eng.deck(id))) x.pause();
  }

  console.log('\nsectiesprongen: toen tegen nu (punt 1)');
  {
    // Track 1 speelt vanaf 3,3 s. Vijf sprongen buiten de marge rond de "1": de aanloop
    // en de fase volgen uit waar de speelkop staat, dus een tik te laat geeft dezelfde plek.
    const acties = [
      [0.737, 'track.1.section.2', true], [0.8, 'track.1.section.2', false],
      [3.1234, 'track.1.section.4', true], [3.2, 'track.1.section.4', false],
      [5.0567, 'track.1.section.3.loop', true], [5.1, 'track.1.section.3.loop', false],
      [8.2468, 'track.1.section.next', true], [8.3, 'track.1.section.next', false],
      [10.3101, 'track.1.section.prev', true], [10.4, 'track.1.section.prev', false],
    ];
    const meet = meetElke(12000);
    const { l, pos: toen } = await neemOp({ acties, meet, voor: () => zetKlaar({ vanaf: 3.3 }) });
    ok('het log: de kaart in de beginstand', l.stand?.tracks[0].secties?.stukken?.length === 5);
    // Intussen opnieuw berekend: een andere kaart op het deck, en de track ergens anders.
    d.setSectieKaart(ANDERS); d.pause(); d.seek(40);
    const { pos: nu, klaar } = await speelTerug({ l, meet });
    const v = verschil(toen, nu);
    ok(`dezelfde posities op elk meetmoment, ook na de kaart van de server (grootste verschil ${v.toExponential(1)} s; ${toon(toen, nu, ergste(toen, nu))})`,
      v < 1e-6);
    ok(`en de sprongen gebeurden: na 0,737 s aanloop naar sectie 2, op 2,7 s in sectie 2, loop om sectie 3 (${toen.get(2750).toFixed(3)} / ${toen.get(7000).toFixed(3)})`,
      Math.abs(toen.get(700) - (3.3 + 0.7)) < 1e-6 && toen.get(2750) > 16 && toen.get(2750) < 16.1 && toen.get(7000) >= 32 && toen.get(7000) < 48);
    ok(`terugspelen zonder te-late regels (${klaar?.gedaan} gedaan, ${klaar?.laat ?? 0} te laat)`, !klaar || klaar.laat === 0);
  }

  console.log('\neen sectie-loop in de beginstand (punt 3)');
  {
    // De set begint MET de loop om sectie 3 (shift + pad); na 1,0 s gaat hij eraf (nog eens).
    const acties = [[1.0034, 'track.1.section.3.loop', true], [1.05, 'track.1.section.3.loop', false]];
    const meet = meetElke(4000);
    const { l, pos: toen } = await neemOp({ acties, meet, voor: () => zetKlaar({ vanaf: 46.5, loop: 'track.1.section.3.loop' }) });
    const s1 = l.stand.tracks[0];
    ok(`beginstand: de loop van het deck (${JSON.stringify(s1.loop)}) en de kaart; geen eigen veld voor de sectie-loop`,
      s1.loop?.start === 32 && s1.loop.end === 48 && s1.loop.tellen === 32 && s1.secties?.stukken?.length === 5 && !('sectieLoop' in s1));
    // Alles anders: de loop eraf, een andere kaart, ergens anders.
    d.clearLoop(); d.setSectieKaart(ANDERS); d.pause(); d.seek(5);
    const timers = nepTimers();
    const doe = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
      huidig: (id) => herk[id] ?? null, laad: async () => true });
    const sp = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, doe, elke: timers.elke, stopElke: timers.stopElke });
    NOW = 300;
    await sp.start({ stand: l.stand, regels: l.regels, duur: l.duur });
    ok(`na de beginstand: de loop om sectie 3, en het lampje van shift + pad 3 brandt (${A.read('track.1.section.3.loop')})`,
      d.loop?.start === 32 && d.loop.end === 48 && d.loopBeats === 32 && A.read('track.1.section.3.loop') === 1 && d.playing);
    sp.stop();
    const { pos: nu } = await speelTerug({ l, meet, start: 300 });
    const v = verschil(toen, nu);
    ok(`en de druk erna haalt hem eraf, zoals toen: dezelfde posities (${v.toExponential(1)} s; loop toen ${toen.get(3000).toFixed(3)}, nu ${nu.get(3000).toFixed(3)})`,
      v < 1e-6 && !d.loop && toen.get(3000) > 48);
  }

  console.log('\nde secties-gebeurtenis na een laad');
  {
    // Een nummer komt halverwege de set op track 1; zijn kaart komt later (de server rekent).
    zetKlaar({ vanaf: 0 });
    d.pause();
    const g = geheugenLog();
    const k = koppel(g.log);
    NOW = 100;
    await g.log.start({ stand: standNu() });
    NOW = 100.5; d.load(BUF, 'demo 1'); d.setGrid(GRID); g.log.gebeurtenis('laad', { track: 1, bron: 'demo', demo: DEMO, titel: 'demo 1', duur: 0, grid: d.grid.toJSON() });
    k.naLaad('A'); k.kijk();
    NOW = 101.2; d.setSectieKaart(KAART); k.kijk();
    NOW = 101.5; A.invoke('track.1.section.4', true); A.invoke('track.1.section.4', false);
    NOW = 102; await g.log.stop(); k.weg();
    const l = g.lees();
    const sec = l.regels.filter((r) => r?.e === 'secties');
    ok(`de kaart die na het laden binnenkomt staat in het log, op zijn moment (${sec.map((r) => `${r.t} s: ${r.secties?.stukken?.length ?? null}`).join(', ')})`,
      sec.length === 1 && sec[0].t === 1.2 && sec[0].secties.stukken.length === 5);
    d.setSectieKaart(ANDERS); d.seek(0);
    const { pos } = await speelTerug({ l, meet: [2000] });
    ok(`teruggespeeld: na de laad de kaart van toen, en pad 4 springt naar 48 s (nu ${pos.get(2000).toFixed(3)} s)`,
      Math.abs(pos.get(2000) - 48) < 1e-6 && JSON.stringify(d.sectieKaart?.toJSON()) === JSON.stringify(sec[0].secties));
  }

  console.log('\nde marge rond de "1": een tik te laat (punt 4)');
  let bandLog = null, bandToen = null;
  const bandMeet = meetElke(20000);
  {
    // Vanaf 0,503 s: de "1" op 2 s valt op 1,497 s in het log. Pad 2 op 1,505 s = 8 ms na
    // die "1" (0,016 tel, binnen de marge van 0,02): de drop meteen, met de fase in de tel.
    // Terugspelen tikt op 1,51 s (5 ms te laat): 13 ms na de "1", buiten de marge.
    // Daarna "volgende" op 15,503 s = 6 ms na de "1" op 30 s (vlak voor sectie 3 op 32).
    const acties = [[1.505, 'track.1.section.2', true], [1.56, 'track.1.section.2', false],
      [15.503, 'track.1.section.next', true], [15.56, 'track.1.section.next', false]];
    const { l, pos: toen } = await neemOp({ acties, meet: bandMeet, voor: () => zetKlaar({ vanaf: 0.503 }) });
    bandLog = l; bandToen = toen;
    ok(`toen: pad 2 vlak na de "1" = de drop meteen (${toen.get(1550).toFixed(3)} s); "volgende" vlak na de "1" op 30 s = sectie 3 meteen (${toen.get(15550).toFixed(3)} s)`,
      Math.abs(toen.get(1550) - 16.053) < 1e-6 && Math.abs(toen.get(15550) - 32.053) < 1e-6);
    d.pause(); d.seek(9);
    const { pos: nu } = await speelTerug({ l, meet: bandMeet });
    const v = verschil(toen, nu);
    ok(`teruggespeeld een tik later (5 en 7 ms): dezelfde maat, dezelfde sectie (grootste verschil ${v.toExponential(1)} s; ${toon(toen, nu, ergste(toen, nu))})`,
      v < 1e-6);
    // In Chrome ligt het terugspelen ook een stap van de audioklok (2,67 ms) naast het
    // origineel (de beginstand). Alleen `laat` is dan niet genoeg: 8 + 3 ms na de "1"
    // is buiten de marge. Daarom draagt de druk in het log de plek waarvan hij rekende.
    const druk = l.regels.filter((r) => Array.isArray(r) && r[2] === true);
    ok(`een sectiedruk draagt in het log de plek waarvan de sprong rekende (${druk.map((r) => JSON.stringify(r[3] ?? null)).join(', ')})`,
      druk.length === 2 && Math.abs(druk[0][3]?.van - 2.008) < 1e-9 && Math.abs(druk[1][3]?.van - 30.006) < 1e-9);
    d.pause(); d.seek(9);
    const { pos: scheef } = await speelTerug({ l, meet: bandMeet, scheef: 0.003 });
    const naast = [...toen.keys()].map((ms) => scheef.get(ms) - toen.get(ms));
    const v2 = Math.max(...naast.map((x) => Math.abs(x - 0.003)));
    ok(`3 ms naast het origineel: de hele tijd precies 3 ms naast, geen maat (grootste afwijking van 3 ms: ${v2.toExponential(1)} s)`, v2 < 1e-6);
    // Een oud log (zonder die plek): dan rekent hij met `laat`, zoals hierboven.
    const oud = { ...l, regels: l.regels.map((r) => (Array.isArray(r) ? r.slice(0, 3) : r)) };
    d.pause(); d.seek(9);
    const { pos: oudNu } = await speelTerug({ l: oud, meet: bandMeet });
    ok(`een log zonder die plek: \`laat\` alleen (verschil ${verschil(toen, oudNu).toExponential(1)} s)`, verschil(toen, oudNu) < 1e-6);
  }
  {
    // In Chrome gaat de audioklok soms een stap (2,67 ms) verder tussen twee lezingen in
    // dezelfde taak: het log las de klok vóór die stap, de sprong erna. Hier 3 ms: pad 2
    // op 8 ms na de "1" rekent dan vanaf 11 ms, buiten de marge, en wordt een aanloop.
    // De plek in het log is die van de SPRONG (de deck meldt hem): terugspelen doet hetzelfde.
    const meet = meetElke(4000);
    const acties = [[1.505, 'track.1.section.2', true], [1.56, 'track.1.section.2', false]];
    const { l, pos: toen } = await neemOp({ acties, meet, voor: () => zetKlaar({ vanaf: 0.503 }), tikIn: 0.003 });
    const druk = l.regels.find((r) => Array.isArray(r) && r[2] === true);
    ok(`toen: de klok tikte tussen log en sprong, dus een aanloop (${toen.get(1550).toFixed(3)} s); in het log de plek van de sprong (${JSON.stringify(druk?.[3])})`,
      Math.abs(toen.get(1550) - 14.053) < 1e-6 && Math.abs(druk?.[3]?.van - 2.011) < 1e-9 && druk[0] === 1.505);
    d.pause(); d.seek(9);
    const { pos: nu } = await speelTerug({ l, meet });
    ok(`teruggespeeld: ook een aanloop, dezelfde posities (${verschil(toen, nu).toExponential(1)} s)`, verschil(toen, nu) < 1e-6);
  }

  console.log('\nopnieuw renderen: drie generaties met die drukken');
  {
    // Generatie 2: het log van punt 4 terugspelen terwijl er een log loopt (een opname),
    // 3 ms naast. Een teruggespeelde druk staat in dat log op het moment waarop hij
    // BEDOELD was, met de plek van toen; anders schoof hij per generatie een tik op.
    d.pause(); d.seek(9);
    const g2 = geheugenLog();
    const k2 = koppel(g2.log);
    NOW = 400;
    await g2.log.start({ stand: standNu() });
    const { T0: T2 } = await speelTerug({ l: bandLog, meet: bandMeet, start: 400.5, log: g2.log, scheef: 0.003 });
    await g2.log.stop(); k2.weg();
    const l2 = g2.lees();
    const druk = l2.regels.filter((r) => Array.isArray(r) && r[2] === true);
    const stand2 = l2.regels.filter((r) => r?.e === 'stand')[1];
    ok(`generatie 2: de drukken op hun bedoelde moment en met de plek van toen (${druk.map((r) => `${(r[0] - stand2.t).toFixed(4)} s ${JSON.stringify(r[3])}`).join(', ')})`,
      druk.length === 2 && Math.abs(druk[0][0] - stand2.t - 1.505) < 1e-6 && Math.abs(druk[1][0] - stand2.t - 15.503) < 1e-6
      && Math.abs(druk[0][3]?.van - 2.008) < 1e-9 && Math.abs(druk[1][3]?.van - 30.006) < 1e-9 && Math.abs(T2 - 400.503) < 1e-9 && Math.abs(stand2.t - 0.503) < 1e-9);
    // Generatie 3: dat log terugspelen, 2,5 ms naast. De stand midden in het log (op
    // 0,503 s) komt op de tik van 0,51 s: 7 ms te laat. De klok van het log staat dan
    // stil vanaf het moment van de stand, niet vanaf de tik; daarna speelt generatie 1
    // opnieuw, precies 3 + 2,5 ms naast (de stand van generatie 2 lag al 3 ms naast).
    d.pause(); d.seek(20);
    const na = Math.round(stand2.t * 1000);
    const meet3 = bandMeet.filter((ms) => ms > 0);              // op het moment van de stand zelf: nog niet gezet
    const { pos: p3 } = await speelTerug({ l: l2, meet: meet3.map((ms) => ms + na), start: 500, scheef: 0.0025 });
    const naast3 = meet3.map((ms) => p3.get(ms + na) - bandToen.get(ms));
    const v = Math.max(...naast3.map((x) => Math.abs(x - 0.0055)));
    ok(`generatie 3 = generatie 1, de hele tijd precies 5,5 ms naast (grootste afwijking ${v.toExponential(1)} s; eerste ${(naast3[0] * 1000).toFixed(3)} ms)`, v < 1e-6);
  }

  console.log('\nde bus: `laat` van terugspelen');
  {
    const gehoord = [];
    A.define('test.sectielog', 'trigger', (on, o) => gehoord.push(['fn', on, o?.laat ?? null]));
    const weg = A.bijInvoke((id, v, o) => { if (id === 'test.sectielog') gehoord.push(['bus', v, o?.laat ?? null]); });
    A.invoke('test.sectielog', true);
    A.invoke('test.sectielog', true, { laat: 0.004 });
    weg();
    ok(`invoke geeft opties door aan de luisteraar en de action (${JSON.stringify(gehoord)})`,
      JSON.stringify(gehoord) === '[["bus",true,null],["fn",true,null],["bus",true,0.004],["fn",true,0.004]]');
    // Alleen de tik-vertraging: een regel die op een laad wachtte (seconden) krijgt niets mee.
    const tz = nepTimers();
    const mee = [];
    const sp = new T.Terugspeler({ klok: () => NOW, invoke: (a, v, o) => mee.push([a, o?.laat ?? null]), elke: tz.elke, stopElke: tz.stopElke,
      doe: { laad: () => new Promise((z) => setTimeout(() => z(true), 0)), rack() {}, focus() {}, pads() {}, grid() {}, hotcues() {} } });
    NOW = 600;
    await sp.start({ regels: [[0.0034, 'track.1.fader', 0.5], { t: 0.02, e: 'laad', track: 2, bron: 'demo', demo: DEMO, duur: 0 },
      [0.021, 'track.2.section.1', true]] });
    NOW = 600.01; tz.tik();
    NOW = 600.02; tz.tik();
    NOW = 600.5; tz.tik();
    await new Promise((z) => setTimeout(z, 5));
    sp.stop();
    const laat1 = mee.find((x) => x[0] === 'track.1.fader')?.[1];
    const laat2 = mee.find((x) => x[0] === 'track.2.section.1');
    ok(`een tik te laat: laat mee (${laat1?.toFixed(4)}); na een laad van 0,5 s niet (${JSON.stringify(laat2)})`,
      Math.abs(laat1 - 0.0066) < 1e-9 && laat2 && laat2[1] === null);
  }
} catch (err) {
  ok(`liep door (${err.stack})`, false);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
