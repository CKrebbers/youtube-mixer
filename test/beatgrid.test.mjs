// Het beatgrid: puur rekenwerk, dus volledig in Node te testen.
const { Beatgrid, TapTempo, MIN_BPM, MAX_BPM, rechteLijn } = await import('../src/engine/beatgrid.js');

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
ok('het anker is de tel bij de laatste tik, op de lijn', bij(r.anker, 1.5, 1e-9));
ok('met lopende track: tempo in tracktijd', bij(r.bpmTrack, 120, 1e-6) && r.tijden.length === 4);
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


// ---- tap: rechte lijn door de tikken -----------------------------------------

{
  // Track op 1,05x: kloktijden 1/1,05 × tracktijden. Tracktijd-lijn geeft het
  // grid-tempo direct, de klok het hoorbare.
  const tr = new TapTempo();
  let x;
  const L = 0.5;                                        // 120 bpm in tracktijd
  for (let i = 0; i < 8; i++) x = tr.tap((i * L / 1.05) * 1000, 10 + i * L + (i % 2 ? 0.012 : -0.012));
  ok('tap op +5%: tracktijd-lijn geeft 120', Math.abs(x.bpmTrack - 120) < 0.3);
  ok('en de klok het hoorbare tempo 126', Math.abs(x.bpm - 126) < 0.01);
  ok('anker ligt op de lijn, niet op de laatste (rammelende) tik', Math.abs(x.anker - (10 + 7 * L)) < 0.01);

  // Eén overgeslagen tel: tussenpoos 2 tellen, de lijn telt door.
  const l = rechteLijn([0, 0.5, 1.5, 2.0, 2.5]);
  ok('een overgeslagen tel wordt geteld als twee', l.k.join(',') === '0,1,3,4,5' && bij(l.L, 0.5, 1e-9));
  // Een uitschieter valt weg in plaats van de lijn scheef te trekken.
  const u2 = rechteLijn([0, 0.5, 1.0, 1.5, 2.15, 2.5]);
  ok('een tik 150 ms te laat telt niet mee', u2.gebruikt === 5 && bij(u2.L, 0.5, 1e-9));
  // Zonder lopende track (stilstaand): geen bpmTrack, anker = de positie.
  const st = new TapTempo();
  st.tap(0, 7); st.tap(500, 7); const r3 = st.tap(1000, 7);
  ok('stilstaande track: geen tracktijd-tempo', r3.bpmTrack === null && r3.anker === 7 && r3.tijden.length === 0);
}

// ---- tempokaart: stukken --------------------------------------------------------

{
  // 120 bpm tot 10 s, daarna 150 bpm met een tel op 10,1.
  const k = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10, bpm: 150, anker: 10.1 }] });
  ok('twee stukken', k.aantalStukken === 2);
  ok('tempo per plek', k.bpmAt(5) === 120 && k.bpmAt(12) === 150 && bij(k.beatLengthAt(12), 0.4));
  ok('vóór het eerste stuk geldt het eerste', k.bpmAt(-3) === 120);
  // Laatste tel van stuk 1 vóór 10,1: 9,5 (10,0 ligt maar 0,1 s voor 10,1: korter
  // dan een halve tel, die vervalt). 9,5 = tel 19, 10,1 = tel 20.
  ok('tellen lopen door over de grens', bij(k.timeOf(19), 9.5) && bij(k.timeOf(20), 10.1) && bij(k.timeOf(21), 10.5));
  ok('te korte overgangstel vervalt', !k.beatsBetween(9, 11).some((b) => bij(b.tijd, 10)));
  let mono = true, cont = true, vorige = -Infinity;
  for (let t = 0; t < 20; t += 0.001) {
    const b = k.beatAt(t);
    if (b < vorige - 1e-12) mono = false;
    if (vorige > -Infinity && b - vorige > 0.01) cont = false;
    vorige = b;
  }
  ok('beatAt is monotoon', mono);
  ok('en continu (geen sprongen)', cont);
  let inv = true;
  for (let b = -10; b < 60; b += 0.37) if (!bij(k.beatAt(k.timeOf(b)), b, 1e-9)) inv = false;
  ok('timeOf en beatAt zijn elkaars inverse, ook over de grens', inv);
  ok('fase 0 op een tel van het tweede stuk', bij(k.phase(10.9), 0, 1e-9));
  ok('volgende tel na 10,2 is 10,5', bij(k.next(10.2), 10.5));
  ok('dichtstbij in stuk 2', bij(k.nearest(11.25), 11.3));
  ok('wissels: begin overgangstel en begin nieuw stuk', k.wissels().length === 2 && bij(k.volgendeWissel(5), 9.5) && bij(k.volgendeWissel(9.7), 10.1));
  ok('na de laatste wissel: null', k.volgendeWissel(11) === null);

  // Oud formaat en nieuw formaat
  const oud = Beatgrid.van({ bpm: 124, firstBeat: 0.3, beatsPerBar: 4 });
  ok('oud formaat = één stuk', oud.aantalStukken === 1 && oud.bpmAt(100) === 124 && bij(oud.firstBeat, 0.3));
  const j = JSON.parse(JSON.stringify({ ...k.toJSON(), slot: true }));
  ok('nieuw formaat bewaart stukken', Array.isArray(j.stukken) && j.stukken.length === 2 && j.stukken[1].anker === 10.1);
  const k2 = Beatgrid.van(j);
  ok('en leest ze terug, met slot', k2.aantalStukken === 2 && k2.slot === true && bij(k2.timeOf(21), 10.5));
  ok('onzin geeft null', Beatgrid.van({ iets: 1 }) === null);
  const z = Beatgrid.van({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.7 }], zeker: false });
  ok('zekerheid per stuk en zeker gaan mee', z.stukken[0].zekerheid === 0.7 && z.toJSON().zeker === false);
  const ongesorteerd = Beatgrid.van({ stukken: [{ van: 30, bpm: 100, anker: 30 }, { van: 0, bpm: 120, anker: 0 }] });
  ok('stukken worden gesorteerd', ongesorteerd.stukken[0].van === 0 && ongesorteerd.bpmAt(40) === 100);
}

// ---- bewerken vanaf hier ----------------------------------------------------

{
  const k = new Beatgrid({ bpm: 120, firstBeat: 0 });
  ok('splitsen op 20 s', k.splits(20) === true && k.aantalStukken === 2);
  ok('splitsen verandert niets hoorbaars', bij(k.timeOf(40), 20) && bij(k.timeOf(41), 20.5) && bij(k.phase(33.3), new Beatgrid({ bpm: 120 }).phase(33.3), 1e-9));
  ok('twee keer op dezelfde plek splitsen kan niet', k.splits(20) === false);

  k.verdubbel(25);
  ok('×2 raakt alleen het stuk waar je bent', k.bpmAt(25) === 240 && k.bpmAt(5) === 120);
  ok('en de tel bij 25 s blijft liggen', bij(k.nearest(25), 25, 1e-9));
  k.halveer(25);
  k.schuif(0.01, 25);
  ok('schuiven: alleen het tweede stuk', bij(k.nearest(25.02), 25.01, 1e-9) && bij(k.nearest(5.02), 5, 1e-9));
  k.ankerHier(30.2);
  ok('tel hier: alleen het tweede stuk', bij(k.nearest(30.25), 30.2, 1e-9) && bij(k.nearest(5.02), 5, 1e-9));
  k.setBpm(125, { bij: 30.2 });
  ok('tempo zetten vanaf hier', k.bpmAt(30) === 125 && k.bpmAt(10) === 120 && bij(k.nearest(30.2), 30.2, 1e-9));
  k.zetStuk(3, { bpm: 118, anker: 1.1 });
  ok('zetStuk raakt het eerste stuk', k.bpmAt(3) === 118 && bij(k.nearest(1.2), 1.1, 1e-9) && k.bpmAt(30) === 125);
  let mono = true, vorige = -Infinity;
  for (let t = 0; t < 40; t += 0.003) { const b = k.beatAt(t); if (b < vorige) mono = false; vorige = b; }
  ok('na al dat bewerken nog steeds monotoon', mono);

  ok('samenvoegen op het eerste stuk kan niet', k.voegSamen(5) === false);
  ok('samenvoegen van het tweede stuk', k.voegSamen(30) === true && k.aantalStukken === 1 && k.bpmAt(30) === 118);

  // Een heel kort stuk zonder eigen tel valt weg in de telling, maar breekt niets.
  const kort = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10, bpm: 120, anker: 10.25 }, { van: 10.3, bpm: 100, anker: 10.4 }] });
  let inv = true;
  for (let b = 0; b < 40; b += 0.5) if (!bij(kort.beatAt(kort.timeOf(b)), b, 1e-9)) inv = false;
  ok('stuk zonder eigen tel: telling blijft inverse', inv);
  const oplopend = kort.beatsBetween(8, 14).every((x, i, l) => i === 0 || x.tijd > l[i - 1].tijd);
  ok('en de tellen blijven oplopen', oplopend);
}

// ---- stap D: halve tel en snappen naar een klap -------------------------------
{
  const { Beatgrid: BG, snapNaarOnset } = await import('../src/engine/beatgrid.js');
  const g = new BG({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 4, bpm: 100, anker: 4 }] });
  g.schuifTel(0.5, 5);
  ok('halve tel: het stuk rond de positie schuift een halve tel van ZIJN tempo (0,3 s)',
    Math.abs(g.stukken[1].anker - 4.3) < 1e-9 && g.stukken[0].anker === 0);
  g.schuifTel(0.5, 1);
  ok('halve tel in het eerste stuk: 0,25 s op 120 bpm, het tweede blijft staan',
    Math.abs(g.stukken[0].anker - 0.25) < 1e-9 && Math.abs(g.stukken[1].anker - 4.3) < 1e-9);
  const on = new Float64Array([0.5, 1.02, 1.9, 2.5]);
  ok('snap: de klap binnen 30 ms wordt de tel', snapNaarOnset(on, 1.0) === 1.02);
  ok('snap: de dichtstbijzijnde van twee buren', snapNaarOnset(on, 1.905) === 1.9);
  ok('snap: net buiten 30 ms = de positie zelf', snapNaarOnset(on, 1.055) === 1.055);
  ok('snap: vóór de eerste en na de laatste klap', snapNaarOnset(on, 0.48) === 0.5 && snapNaarOnset(on, 2.52) === 2.5 && snapNaarOnset(on, 3) === 3);
  ok('snap: zonder onsets (null of leeg) niet snappen', snapNaarOnset(null, 1.0) === 1.0 && snapNaarOnset(new Float64Array(0), 1.0) === 1.0);
}

// ---- transport: beatjump, fasebehoudend springen, maatbegin ------------------
// Rekenwerk achter beatjump, quantize en starten op de maat (deck.js,
// engine.js). Alles in tellen, zodat een stukgrens niets scheef trekt.
console.log('\ntransport-rekenwerk');
{
  const vast = new Beatgrid({ bpm: 120, firstBeat: 0 });
  ok('verschuif: 4 tellen op 120 bpm = 2 s', bij(vast.verschuif(1.1, 4), 3.1));
  ok('verschuif: terug mag ook, en onder 0', bij(vast.verschuif(1.1, -4), -0.9));
  // 120 bpm, vanaf 2,0 s 150 bpm met een tel op 2,1. Tellen: … 1,0 · 1,5 · 2,1 · 2,5 · 2,9 · 3,3 …
  const kaart = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 2.0, bpm: 150, anker: 2.1 }] });
  const doel = kaart.verschuif(1.25, 4);            // tel 2,5 -> 6,5: halverwege 2,9 en 3,3
  ok(`verschuif over een stukgrens telt tellen: 1,25 + 4 tellen = ${doel.toFixed(3)} (3,1)`, bij(doel, 3.1));
  ok('... en de fase in de tel blijft gelijk (0,5)', bij(kaart.phase(doel), 0.5) && bij(kaart.phase(1.25), 0.5));
  ok('verschuif terug over de grens is het omgekeerde', bij(kaart.verschuif(doel, -4), 1.25));

  ok('metFaseVan: doel op de tel, t op 0,3 van zijn tel -> 0,15 s erna', bij(vast.metFaseVan(1.0, 2.15), 1.15));
  ok('metFaseVan: t op 0,8 -> 0,2 tel VÓÓR het doel (hooguit een halve tel)', bij(vast.metFaseVan(1.0, 2.4), 0.9));
  ok('metFaseVan: doel niet op de tel -> fase van t, dichtbij het doel', bij(vast.metFaseVan(1.2, 3.05), 1.05));
  ok('metFaseVan: al in fase -> het doel zelf', bij(vast.metFaseVan(1.0, 7.0), 1.0));
  const naGrens = kaart.metFaseVan(2.5, 1.25);     // doel in het stuk van 150 bpm, t halverwege een tel
  ok(`metFaseVan over een stukgrens: fase gelijk (${kaart.phase(naGrens).toFixed(3)})`, bij(kaart.phase(naGrens), 0.5)
    && Math.abs(naGrens - 2.5) <= 0.2 + 1e-9);

  ok('volgendeVeelvoud: vanaf tel 5 is het volgende maatbegin 8', vast.volgendeVeelvoud(5) === 8);
  ok('volgendeVeelvoud: op een maatbegin blijft het staan', vast.volgendeVeelvoud(8) === 8);
  ok('volgendeVeelvoud: net erna (8,01) is het 12', vast.volgendeVeelvoud(8.01) === 12);
  ok('volgendeVeelvoud: negatief werkt ook (−3 -> 0)', vast.volgendeVeelvoud(-3) === 0);
  ok('volgendeVeelvoud per 1 = de volgende tel', vast.volgendeVeelvoud(5.2, 1) === 6);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
