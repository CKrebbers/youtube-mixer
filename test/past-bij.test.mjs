// "Past bij" in de library (src/ui/past-bij.js): welke nummers goed of bijna goed mixen met
// het nummer op de focus-track, met de regels van de auto-DJ. Puur rekenwerk, geen DOM.
// Draai met: node test/past-bij.test.mjs

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const { pastBij, beoordeel, pastBijKop, tempoTekst, TEMPO_BIJNA } = await import('../src/ui/past-bij.js');
const { TEMPO_MAX } = await import('../src/auto/planner.js');
const { leesToonsoort } = await import('../src/engine/toonsoort.js');

// Een nummer van 4 minuten met één zeker stuk; toon zeker (0,9) of gegokt (0,2).
const nummer = (id, bpm, toon, { zeker = 0.9, toonZeker = 0.9, duur = 240 } = {}) => ({
  id, titel: id, duur, audio: true,
  grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: zeker }] },
  toon: { stukken: [{ van: 0, toonsoort: toon, stemming: 0, zekerheid: toonZeker }], bron: 'auto' },
});
const k = (s) => leesToonsoort(s);
const kenm = (bpm, toon, zeker = true) => ({ bpm, k: k(toon), toonZeker: zeker, gridZeker: true });

console.log('één paar (beoordeel)');
{
  ok('zelfde tempo, zelfde toon: goed', beoordeel(kenm(128, 'Am'), kenm(128, 'Am'))?.soort === 'goed');
  ok('toon naast elkaar (Am → C, relatief): goed', beoordeel(kenm(128, 'Am'), kenm(128, 'C'))?.soort === 'goed');
  ok('toon naast elkaar (Am → Em, kwint): goed', beoordeel(kenm(128, 'Am'), kenm(128, 'Em'))?.soort === 'goed');
  const twee = beoordeel(kenm(128, 'Am'), kenm(128, 'Bm'));
  ok(`toon 2 stappen: bijna ("${twee?.waarom}")`, twee?.soort === 'bijna' && /2 stappen/.test(twee.waarom));
  ok('toon ver weg (Am → D♯m): past niet', beoordeel(kenm(128, 'Am'), kenm(128, 'D#m')) === null);
  // Na de sync schuift de toon mee: 128 → 120,8 (+6%) is een halve toon omhoog.
  const sync = beoordeel(kenm(128, 'Am'), kenm(120.8, 'G#m'));
  ok('de toon telt NA het gelijkzetten van het tempo (G♯m op 120,8 klinkt als Am op 128)', sync?.soort === 'goed' && sync.stappen === 0);
  const ver = beoordeel(kenm(128, 'Am'), kenm(118, 'Am'));
  ok(`tempo 8% (tussen ${TEMPO_MAX} en ${TEMPO_BIJNA}): bijna, ver pitchen ("${ver?.waarom}")`, ver?.soort === 'bijna' && /pitchen/.test(ver.waarom));
  ok('tempo 15%: past niet', beoordeel(kenm(128, 'Am'), kenm(110, 'Am')) === null);
  const half = beoordeel(kenm(174, 'Am'), kenm(87.5, 'Am'));
  ok(`half tempo (174 ↔ 87,5): bijna, half/dubbel ("${half?.waarom}", ${tempoTekst(half ?? { tempo: 0 })})`, half?.soort === 'bijna' && half.half && /½/.test(tempoTekst(half)));
  ok('zonder toon aan een van beide kanten: past niet (niets om op te bouwen)', beoordeel(kenm(128, 'Am'), { ...kenm(128, 'Am'), k: null }) === null);
  const gok = beoordeel(kenm(128, 'Am', false), kenm(128, 'Am'));
  ok('een gegokte toon telt mee, maar staat erbij', gok?.soort === 'goed' && gok.toonGegokt && /gegokt/.test(gok.waarom));
}

console.log('de lijst (pastBij)');
{
  const huidig = nummer('nu', 128, 'Am');
  const lib = [
    huidig,
    nummer('gelijk', 128, 'Am'),
    nummer('buur', 126, 'C'),
    nummer('gok', 128, 'Am', { toonZeker: 0.2 }),
    nummer('ver', 118, 'Am'),
    nummer('half', 64, 'Am'),
    nummer('botst', 128, 'D#m'),
    nummer('onzeker', 128, 'Am', { zeker: 0.3 }),
    { ...nummer('weg', 128, 'Am'), audio: false },
  ];
  const u = pastBij(huidig, lib);
  const ids = u.lijst.map((x) => x.track.id);
  ok(`het nummer zelf, een onzeker grid, geen audio en een botsende toon vallen weg (${ids.join(', ')})`,
    !ids.includes('nu') && !ids.includes('onzeker') && !ids.includes('weg') && !ids.includes('botst'));
  ok('goed vóór bijna, het kleinste verschil eerst', ids[0] === 'gelijk' && ids.indexOf('buur') < ids.indexOf('ver') && ids.indexOf('gok') < ids.indexOf('half'));
  ok('een gegokte toon zakt onder dezelfde zekere', ids.indexOf('gelijk') < ids.indexOf('gok'));
  const kop = pastBijKop(huidig, u, '2');
  ok(`de kop telt goed en bijna ("${kop}")`, /track 2/.test(kop) && /3 goed, 2 bijna/.test(kop) && /128\.0 bpm/.test(kop));
  // Speelt hij: dan telt waar je bent (t), niet het eind.
  const twee = { ...nummer('wissel', 128, 'Am', { duur: 600 }), grid: { stukken: [
    { van: 0, bpm: 128, anker: 0, zekerheid: 0.9 }, { van: 300, bpm: 90, anker: 300, zekerheid: 0.9 }] } };
  const lib2 = [twee, nummer('snel', 128, 'Am'), nummer('traag', 90, 'Am')];
  ok('t midden in het eerste stuk: wat bij 128 past', pastBij(twee, lib2, { t: 100 }).lijst[0]?.track.id === 'snel');
  ok('zonder t: vlak voor het eind (wat er NA dit nummer komt)', pastBij(twee, lib2).lijst[0]?.track.id === 'traag');
  // Onzeker op het meetpunt (outro zonder beat): dan het langste zekere stuk.
  const outro = { ...nummer('outro', 128, 'Am', { duur: 300 }), grid: { stukken: [
    { van: 0, bpm: 128, anker: 0, zekerheid: 0.9 }, { van: 240, bpm: 128, anker: 240, zekerheid: 0.1 }] } };
  const uo = pastBij(outro, [outro, nummer('gelijk', 128, 'Am')]);
  ok('een onzekere outro: gemeten op het zekere deel, en dat staat in de kop', uo.lijst.length === 1 && uo.uit.elders && /zekere deel/.test(pastBijKop(outro, uo)));
  const nergens = nummer('ambient', 70, 'Am', { zeker: 0.1 });
  const un = pastBij(nergens, [nergens, nummer('gelijk', 70, 'Am')]);
  ok(`nergens zeker: lege lijst met een reden ("${un.reden}")`, un.lijst.length === 0 && /nergens zeker/.test(un.reden));
  ok('zonder grid: lege lijst met een reden', pastBij({ id: 'x', titel: 'x' }, lib).reden === 'dit nummer heeft geen grid');
  ok('geen nummer op de focus-track: dat zegt de kop', /laad er eerst een/.test(pastBijKop(null, { lijst: [] })));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
