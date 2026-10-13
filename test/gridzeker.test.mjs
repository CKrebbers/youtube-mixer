// Zekerheid van het grid (stap C): de regels in de engine (sync en beat-loops
// weigeren in een onzeker stuk) en de pure functies achter de strook, de
// bpm-"?" en de status in de library. Geen DOM, geen Web Audio.
// Draai met: node test/gridzeker.test.mjs
const { Beatgrid, soortZekerheid, ZEKER_VANAF, GEEN_PULS } = await import('../src/engine/beatgrid.js');
const { Deck } = await import('../src/engine/deck.js');
const { Engine, ONZEKER } = await import('../src/engine/engine.js');
const S = await import('../src/ui/grid-strook.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// Een album: zeker, onzeker, geen puls, zeker.
const album = {
  stukken: [
    { van: 0, bpm: 150, anker: 0.4, zekerheid: 0.9 },
    { van: 60, bpm: 140, anker: 60.2, zekerheid: 0.45 },
    { van: 120, bpm: 140, anker: 120.1, zekerheid: 0.02 },
    { van: 180, bpm: 156, anker: 180.3, zekerheid: 0.7 },
  ],
  bron: 'auto',
};

console.log('soorten');
ok('zeker vanaf de drempel', soortZekerheid(ZEKER_VANAF) === 'zeker' && soortZekerheid(ZEKER_VANAF - 0.01) === 'onzeker');
ok('geen puls onder de ondergrens', soortZekerheid(GEEN_PULS - 0.01) === 'geenpuls' && soortZekerheid(GEEN_PULS) === 'onzeker');
ok('zonder zekerheid (tap, oud grid) telt als zeker', soortZekerheid(undefined) === 'zeker');
ok('op slot is alles zeker', soortZekerheid(0, true) === 'zeker');

console.log('\nBeatgrid');
const g = new Beatgrid(album);
ok('zekerBij per stuk', g.zekerBij(30) && !g.zekerBij(90) && !g.zekerBij(150) && g.zekerBij(200));
ok('zekerheidBij geeft de soort', g.zekerheidBij(90) === 'onzeker' && g.zekerheidBij(150) === 'geenpuls');
const strook = g.strook(240);
ok('strook: aaneengesloten van 0 tot het einde', strook.length === 4 && strook[0].van === 0 && strook.at(-1).tot === 240
  && strook.every((s, i) => i === 0 || s.van === strook[i - 1].tot));
ok('strook: de soorten per stuk', strook.map((s) => s.soort).join() === 'zeker,onzeker,geenpuls,zeker');
ok('bron gaat mee in toJSON en terug', new Beatgrid(g.toJSON()).bron === 'auto' && g.toJSON().bron === 'auto');
ok('onzin-bron wordt null', new Beatgrid({ ...album, bron: 'x' }).bron === null);
const opSlot = new Beatgrid({ ...album, slot: true });
ok('op slot: overal zeker, ook zonder puls', opSlot.zekerBij(150) && opSlot.strook(240).every((s) => s.soort === 'zeker'));
g.zetStuk(90, { bpm: 141, anker: 60.3 });
ok('een tap op het stuk (zetStuk zonder zekerheid) maakt dat stuk zeker', g.zekerBij(90) && !g.zekerBij(150));

console.log('\nde regels in deck en engine');
// Het deck zonder audio: de echte methoden op een nepobject. buffer, position
// en duration zijn getters op Deck, dus als eigen eigenschap eroverheen.
const eigen = (o, velden) => {
  for (const [k, v] of Object.entries(velden)) {
    Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(velden, k).get
      ? { get: Object.getOwnPropertyDescriptor(velden, k).get, configurable: true }
      : { value: v, writable: true, configurable: true });
  }
  return o;
};
const nepDeck = (grid, positie) => eigen(Object.create(Deck.prototype), {
  buffer: {}, grid: new Beatgrid(grid), position: positie, duration: 240, loopBeats: null,
  _heranker() {}, emit() {}, _zetLoop: () => true,
});
const dOnzeker = nepDeck(album, 90), dZeker = nepDeck(album, 30);
ok('gridZekerHier volgt de positie', dOnzeker.gridZekerHier === false && dZeker.gridZekerHier === true);
ok('beat-loop in een onzeker stuk: weigert', dOnzeker.setBeatLoop(4) === false);
ok('beat-loop in een zeker stuk: mag', dZeker.setBeatLoop(4) === true);
ok('zonder grid: null (geen grid is iets anders dan onzeker)', eigen(nepDeck(album, 0), { grid: null }).gridZekerHier === null);
dZeker.gridGewijzigd();
ok('een bewerking met de hand maakt het grid bron "hand" (achtergrond laat het dan staan)', dZeker.grid.bron === 'hand');

const nepEngine = (slave, master) => Object.assign(Object.create(Engine.prototype), {
  decks: { A: slave, B: master }, syncMaster: () => master, emit() {},
});
const masterZeker = eigen(nepDeck(album, 200), { id: 'B', playing: true, rate: 1, get bpm() { return 156; } });
const r1 = nepEngine(eigen(nepDeck(album, 90), { id: 'A' }), masterZeker).sync('A');
ok(`sync in een onzeker stuk: weigert met een melding ("${r1.reden}")`, r1.ok === false && r1.reden === ONZEKER);
const masterOnzeker = eigen(nepDeck(album, 150), { id: 'B', playing: true, rate: 1, get bpm() { return 140; } });
const r2 = nepEngine(eigen(nepDeck(album, 30), { id: 'A' }), masterOnzeker).sync('A');
ok(`sync naar een master in een onzeker stuk: weigert ("${r2.reden}")`, r2.ok === false && /track 2/.test(r2.reden) && /onzeker/.test(r2.reden));
const slaveSlot = eigen(nepDeck({ ...album, slot: true }, 90), { id: 'A', setRate() {}, playing: false });
const r3 = nepEngine(slaveSlot, masterZeker).sync('A');
ok('op slot mag sync wel, ook in een stuk dat de analyse onzeker vond', r3.ok === true);

console.log('\nde strook in pixels');
const px = S.strookPixels(strook, 240, 240);
ok('één pixel per seconde: vier stukken', px.length === 4 && px[0].x0 === 0 && px.at(-1).x1 === 240 && px[1].soort === 'onzeker');
const veel = new Beatgrid({ stukken: Array.from({ length: 200 }, (_, i) => ({ van: i * 10, bpm: 120, anker: i * 10, zekerheid: 0.9 })) });
ok('200 zekere stukken op 100 px: één balk (gelijke buren smelten samen)', S.strookPixels(veel.strook(2000), 2000, 100).length === 1);
ok('geen strook zonder duur of breedte', S.strookPixels(strook, 0, 100).length === 0 && S.strookPixels(strook, 240, 0).length === 0);

console.log('\nbpm-tekst en library');
ok('bpm met "?" in een onzeker stuk', S.bpmTekst(140.04, false) === '140.0?' && S.bpmTekst(150, true) === '150.0' && S.bpmTekst(null, false) === '—');
const B = (stukken, extra = {}) => ({ stukken: stukken.map(([van, bpm, zekerheid]) => ({ van, bpm, anker: van, zekerheid })), ...extra });
ok('library-bpm: één tempo, en zonder grid "—"', S.libraryBpm({ bpm: 124 }) === '124.0' && S.libraryBpm(null) === '—');
ok('bijna gelijke stukken (< 0,5%): één tempo zonder ~', S.libraryBpm({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 60, bpm: 120.3, anker: 60 }] }) === '120.2');
ok(`album: twee zekere tempo's van elk de helft ("${S.libraryBpm(album, 240)}")`, S.libraryBpm(album, 240) === '150 / 156');
ok('onzekere stukken tellen niet mee', S.libraryBpm(B([[0, 80, 0.1], [30, 124, 0.9], [200, 95, 0.2]]), 240) === '124.0');
const drift = S.libraryBpm(B([[0, 84.7, 0.97], [22, 84.3, 1], [30, 85.6, 1], [40, 87, 1]]), 60);
ok(`live gespeeld (drift binnen 3%): ~ en het gewogen gemiddelde ("${drift}")`, drift === '~85.6');
ok('half/dubbel tempo is hetzelfde nummer: geen "/"', S.libraryBpm(B([[0, 174, 0.9], [100, 87, 0.8], [200, 174, 0.9]]), 300) === '174.0');
ok('een kort ander tempo (< 25%) komt niet in de kolom', S.libraryBpm(B([[0, 128, 0.9], [200, 100, 0.9]]), 240) === '128.0');
ok('geen enkel zeker stuk: het langste tempo met "?"', S.libraryBpm(B([[0, 64.6, 0.15], [30, 62, 0.12], [40, 64.5, 0.1]]), 200) === '64.5?');
ok('op slot telt alles als zeker', S.libraryBpm(B([[0, 90, 0.1], [60, 90, 0.1]], { slot: true }), 120) === '90.0');
ok('zonder duur telt het laatste stuk een minuut', S.libraryBpm(B([[0, 128, 0.9], [60, 100, 0.9]])) === '128 / 100' || S.libraryBpm(B([[0, 128, 0.9], [60, 100, 0.9]])) === '100 / 128');
const st = (gr, duur = 240) => S.gridStatus(gr, duur).status;
ok('status: slot / zeker / onzeker / geen puls / met de hand / geen',
  st({ ...album, slot: true }) === 'slot'
  && st({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }] }) === 'zeker'
  && st(album) === 'zeker'   // precies de helft zeker: "minstens de helft"
  && st({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }, { van: 60, bpm: 120, anker: 60, zekerheid: 0.4 }] }) === 'onzeker'
  && st({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.01 }] }) === 'geenpuls'
  && st({ bpm: 120 }) === 'hand'
  && st(null) === 'geen');
ok(`aandeel zeker telt tijd, niet stukken (${S.gridStatus(album, 240).aandeel.toFixed(2)})`, Math.abs(S.gridStatus(album, 240).aandeel - 0.5) < 1e-9);
ok('elke status heeft een tekst', ['slot', 'zeker', 'onzeker', 'geenpuls', 'hand', 'geen'].every((k) => S.STATUS_TEKST[k]));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
