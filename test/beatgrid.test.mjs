// Het beatgrid: puur rekenwerk, dus volledig in Node te testen.
const { Beatgrid, TapTempo, MIN_BPM, MAX_BPM } = await import('../src/engine/beatgrid.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- rekenen ---------------------------------------------------------------

const g = new Beatgrid({ bpm: 120, firstBeat: 0 });
ok('120 bpm is een halve seconde per beat', bij(g.beatLength, 0.5));
ok('een maat is twee seconden', bij(g.barLength, 2));
ok('beat 0 ligt op het anker', bij(g.timeOf(0), 0));
ok('beat 8 ligt op 4 seconden', bij(g.timeOf(8), 4));
ok('tijd terug naar beat', bij(g.beatAt(4), 8));
ok('heen en terug komt uit', bij(g.beatAt(g.timeOf(13)), 13));

const v = new Beatgrid({ bpm: 124, firstBeat: 0.35 });
ok('een verschoven anker telt mee', bij(v.timeOf(0), 0.35));
ok('en werkt ook terug', bij(v.beatAt(0.35), 0));
ok('vóór het anker wordt de beat negatief', v.beatAt(0) < 0);
ok('ook negatieve beats rekenen door', bij(v.timeOf(-4), 0.35 - 4 * v.beatLength));

// ---- dichtstbijzijnde en volgende -----------------------------------------

ok('dichtstbij rondt naar beneden af', bij(g.nearest(2.2), 2));
ok('dichtstbij rondt naar boven af', bij(g.nearest(2.3), 2.5));
ok('precies op een beat blijft staan', bij(g.nearest(3), 3));
ok('volgende beat na 2.2 is 2.5', bij(g.next(2.2), 2.5));
ok('volgende beat óp een beat is die beat zelf', bij(g.next(3), 3));

// ---- fase ------------------------------------------------------------------

ok('fase op een beat is 0', bij(g.phase(3), 0));
ok('fase halverwege is 0.5', bij(g.phase(3.25), 0.5));
ok('maatfase op de 1 is 0', bij(g.barPhase(4), 0));
ok('maatfase op de 3 is 0.5', bij(g.barPhase(5), 0.5));
ok('de 1 is een downbeat', g.isDownbeat(4));
ok('de 2 niet', !g.isDownbeat(4.5));

// ---- beats in een venster --------------------------------------------------

const reeks = g.beatsBetween(1, 3);
ok('vijf beats tussen 1 en 3 seconden', reeks.length === 5);
ok('de eerste ligt op 1.0', bij(reeks[0].tijd, 1));
ok('de laatste op 3.0', bij(reeks.at(-1).tijd, 3));
// beats 2 t/m 6 liggen in dit venster; alleen beat 4 is een maatbegin
ok('maatbegin wordt gemarkeerd', reeks.filter((b) => b.maatbegin).length === 1);
ok('en dat is beat 4 op 2.0 seconden',
  bij(reeks.find((b) => b.maatbegin).tijd, 2) && reeks.find((b) => b.maatbegin).beat === 4);
ok('een leeg venster geeft niets', g.beatsBetween(10, 10.1).length <= 1);
ok('het maximum wordt gerespecteerd', g.beatsBetween(0, 10000, 50).length === 50);

const neg = new Beatgrid({ bpm: 120, firstBeat: 1.25 });
ok('maatbegin klopt ook links van het anker',
  neg.beatsBetween(-2, 1.3).every((b) => b.maatbegin === (((b.beat % 4) + 4) % 4 === 0)));

// ---- tempo wijzigen --------------------------------------------------------

const a = new Beatgrid({ bpm: 120, firstBeat: 0 });
a.setBpm(140);
ok('bpm gewijzigd', a.bpm === 140);

const b2 = new Beatgrid({ bpm: 120, firstBeat: 0 });
const ankerBeat = b2.nearest(10);
b2.setBpm(125, { ankerTijd: 10 });
ok('met een anker blijft de beat op 10 seconden liggen', bij(b2.nearest(10), ankerBeat, 1e-6));
ok('en het tempo is wel veranderd', b2.bpm === 125);

const d = new Beatgrid({ bpm: 70 });
d.verdubbel();
ok('verdubbelen', d.bpm === 140);
d.halveer(); d.halveer();
ok('halveren', d.bpm === 35 || d.bpm === MIN_BPM);
ok('en blijft binnen de grenzen', d.bpm >= MIN_BPM);
ok('bovengrens wordt geklemd', new Beatgrid({ bpm: 9999 }).bpm === MAX_BPM);
ok('ondergrens ook', new Beatgrid({ bpm: 1 }).bpm === MIN_BPM);

// ---- grid verschuiven ------------------------------------------------------

const s = new Beatgrid({ bpm: 120, firstBeat: 0 });
s.schuif(0.1);
ok('schuiven verplaatst het anker', bij(s.firstBeat, 0.1));
ok('en dus alle beats', bij(s.timeOf(4), 2.1));

const u = new Beatgrid({ bpm: 120, firstBeat: 0 });
u.lijnUitOp(3.08);       // beat ligt op 3.0, wij willen hem op 3.08
ok('uitlijnen schuift naar de aangewezen tijd', bij(u.nearest(3.08), 3.08, 1e-9));
ok('het tempo blijft daarbij gelijk', u.bpm === 120);

// ---- opslaan en terughalen -------------------------------------------------

const heen = new Beatgrid({ bpm: 128.5, firstBeat: 1.234, beatsPerBar: 3 });
const terug = Beatgrid.van(JSON.parse(JSON.stringify(heen.toJSON())));
ok('opslaan en terughalen geeft hetzelfde grid',
  terug.bpm === heen.bpm && bij(terug.firstBeat, heen.firstBeat) && terug.beatsPerBar === 3);
ok('niets terughalen geeft null', Beatgrid.van(null) === null);
ok('een kopie staat los van het origineel',
  (() => { const k = heen.kopie(); k.schuif(1); return !bij(k.firstBeat, heen.firstBeat); })());

// ---- tap tempo -------------------------------------------------------------

const tt = new TapTempo();
ok('één tik zegt nog niets', tt.tap(0, 0) === null);
let r = tt.tap(500, 0.5);
ok('twee tikken geven al een tempo', r && Math.abs(r.bpm - 120) < 0.01);
r = tt.tap(1000, 1.0); r = tt.tap(1500, 1.5);
ok('vier tikken van 500 ms is 120 bpm', Math.abs(r.bpm - 120) < 0.01);
ok('het anker is de eerste tik van de reeks', bij(r.firstBeat, 0));
ok('het aantal tikken wordt meegeteld', r.taps === 4);

// Eén keer te laat tikken mag het tempo niet omgooien: daarom de mediaan.
const tt2 = new TapTempo();
tt2.tap(0, 0); tt2.tap(500, 0); tt2.tap(1000, 0); tt2.tap(1500, 0);
const voorMisser = tt2.tap(2000, 0).bpm;
const naMisser = tt2.tap(2650, 0).bpm;    // 150 ms te laat
ok('één misser verschuift het tempo nauwelijks', Math.abs(naMisser - voorMisser) < 3);
ok('en een gemiddelde zou dat wél doen', Math.abs(naMisser - 120) < 3);

const tt3 = new TapTempo({ maxGat: 1000 });
tt3.tap(0, 0); tt3.tap(400, 0);
ok('na een lange stilte begint hij opnieuw', tt3.tap(5000, 9) === null && tt3.count === 1);

const tt4 = new TapTempo();
for (let i = 0; i <= 30; i++) tt4.tap(i * 480, i * 0.48);
ok('de reeks blijft begrensd', tt4.count <= 16);
ok('en het tempo klopt nog steeds', Math.abs(tt4.tap(31 * 480, 0).bpm - 125) < 0.5);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
