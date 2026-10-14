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

// ---- maat-anker per stuk (25 september 2026) -----------------------------------
// Elk stuk weet welke tel zijn "1" is. Een grid van vóór deze versie heeft dat
// veld niet: dan tellen de maten door zoals vroeger (tel 0 van het hele grid =
// anker van het eerste stuk = tel 1), en dat moet er precies zo uit blijven zien.
{
  const oudeMaat = (g, b) => ((b % 4) + 4) % 4 === 0;        // de oude regel: doorlopend telnummer
  // 120 tot 10 s, dan 150 met een tel op 10,1 (tel 20). Oud: tel 20 = tel 1, 21 = 2 ...
  const oudJson = { stukken: [{ van: 0, bpm: 120, anker: 0.3 }, { van: 10, bpm: 150, anker: 10.1 }, { van: 30, bpm: 100, anker: 30.37 }], beatsPerBar: 4 };
  const g = Beatgrid.van(JSON.parse(JSON.stringify(oudJson)));
  const tellen = g.beatsBetween(-3, 45);
  ok(`oud grid zonder maat: maatbegin precies als vroeger (${tellen.filter((b) => b.maatbegin).length} maten)`,
    tellen.every((b) => b.maatbegin === oudeMaat(g, b.beat)));
  let fase = true;
  for (let t = -2; t < 45; t += 0.013) {
    const b = g.beatAt(t), x = b / 4 - Math.floor(b / 4);
    if (Math.abs(g.barPhase(t) - x) > 1e-9 && Math.abs(Math.abs(g.barPhase(t) - x) - 1) > 1e-9) fase = false;
  }
  ok('en barPhase ook (op elke plek gelijk aan de oude berekening)', fase);
  const j = g.toJSON();
  ok('na inlezen heeft elk stuk een maat: de eerste "1" in het stuk',
    j.stukken.every((s) => Number.isFinite(s.maat) && s.maat >= s.van - 1e-9 && g.isDownbeat(s.maat)));
  const terug = Beatgrid.van(JSON.parse(JSON.stringify(j)));
  ok('opslaan en terughalen: dezelfde maten', terug.beatsBetween(-3, 45).every((b, i) => b.maatbegin === tellen[i].maatbegin));
  ok('een maat van null (oud of kapot) telt als geen maat',
    Beatgrid.van({ stukken: [{ van: 0, bpm: 120, anker: 0.3, maat: null }] }).stukken[0].maat === 0.3);

  // Een eigen "1" per stuk: het tweede stuk begint een nieuwe maat op 10,1,
  // waar het doortellen tel 1 zou geven... maak het tel 3: 10,1 + 2 tellen = 10,9.
  const eigen = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10, bpm: 150, anker: 10.1, maat: 10.9 }] });
  ok('eigen maat: 10,9 is een tel 1, 10,1 niet', eigen.isDownbeat(10.9) && !eigen.isDownbeat(10.1) && bij(eigen.barPhase(10.9), 0, 1e-9));
  ok('telInMaat telt vanaf de eigen "1"', eigen.telInMaat(10.1) === 3 && eigen.telInMaat(10.5) === 4 && eigen.telInMaat(10.9) === 1 && eigen.telInMaat(11.0) === 1);
  ok('het eerste stuk telt gewoon door (8,0 is tel 1, 9,5 tel 4)', eigen.isDownbeat(8) && eigen.telInMaat(9.5) === 4);
  const rond = eigen.beatsBetween(9, 12.2).map((b) => `${b.tijd.toFixed(1)}${b.maatbegin ? '!' : ''}`).join(' ');
  ok(`maatbegin volgt het stuk (${rond})`, rond === '9.0 9.5 10.1 10.5 10.9! 11.3 11.7 12.1');
  ok('de overgangstel (9,5) hoort nog bij de maat van het eerste stuk', eigen.telInMaat(9.5) === 4 && eigen.telInMaat(9.7) === 4);
  const ver = eigen.beatsBetween(0, 20, 100, 4).map((b) => b.tijd.toFixed(1)).join(' ');
  ok(`ver uitgezoomd (alleen maatbegin): uitgelijnd per stuk (${ver})`,
    eigen.beatsBetween(0, 20, 100, 4).every((b) => b.maatbegin) && ver.startsWith('0.0 2.0 4.0 6.0 8.0 10.9 12.5'));

  // Bewerken: de "1" gaat mee met het grid, of blijft op zijn tel.
  const b = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 20, bpm: 120, anker: 20, maat: 21 }] });
  b.ankerHier(25.3);
  ok('tel 1 hier: de tel komt hier en het is een "1"', b.isDownbeat(25.3) && bij(b.nearest(25.3), 25.3) && b.telInMaat(25.8) === 2);
  ok('en het eerste stuk merkt er niets van', b.isDownbeat(2) && b.isDownbeat(18));
  b.schuif(0.01, 25);
  const opEen = (g, t) => { const f = g.barPhase(t); return Math.min(f, 1 - f) < 1e-9; };
  ok('schuiven: de "1" schuift mee', opEen(b, 25.31) && b.telInMaat(25.305) === 4);
  b.schuifTel(0.5, 25);
  ok('halve tel: de "1" gaat mee met zijn tel (25,56)', b.isDownbeat(25.56) && b.telInMaat(26.06) === 2);
  b.setBpm(124, { bij: 27.06 });
  ok('tempo vanaf hier: de tel bij 27,06 blijft tel 4 (drie tellen na de "1" op 25,56)', b.telInMaat(27.06) === 4 && b.isDownbeat(27.06 + 60 / 124));
  b.verdubbel(27.06);
  ok('×2: de "1" op 27,544 blijft een "1"', b.isDownbeat(27.06 + 60 / 124) && b.bpmAt(28) === 248);
  b.halveer(27.06);
  const voorBpm = b.stukken[1].maat;
  b.zetStuk(27.06, { bpm: 124.5, anker: 27.07 });
  ok('tap/verfijning (zetStuk): de tel bij de tap houdt zijn plek in de maat', b.telInMaat(27.07) === 4 && b.isDownbeat(27.07 + 60 / 124.5) && Number.isFinite(voorBpm));

  // ½ op tel 2 of 4 houdt de "1" als tel (VRAGEN J26): de tellen op 1 en 3 blijven.
  const h = Beatgrid.van({ stukken: [{ van: 0, bpm: 120, anker: 0, maat: 0 }] });
  h.halveer(0.5);
  ok('½ op tel 2: de "1" blijft een "1" en een tel (J26)', h.bpmAt(1) === 60 && h.isDownbeat(0) && bij(h.nearest(0.02), 0, 1e-9));
  ok('... de tellen liggen op 1 en 3 (1,0 s), niet op 2 en 4 (0,5 s)', bij(h.nearest(1.02), 1, 1e-9) && !bij(h.nearest(0.5), 0.5, 1e-6));
  h.verdubbel(0.5);
  ok('... ×2 daarna geeft het oude grid terug, "1" en al', h.bpmAt(1) === 120 && h.isDownbeat(0) && h.isDownbeat(2) && bij(h.nearest(0.52), 0.5, 1e-9));
  h.halveer(1.5);
  ok('... ½ op tel 4 ook (een maat is nu 4 s: "1" op 0 en 4)', h.isDownbeat(0) && h.isDownbeat(4) && bij(h.nearest(1.02), 1, 1e-9) && !bij(h.nearest(1.5), 1.5, 1e-6));

  // Een eerder stuk bewerken verschuift de maten van het volgende niet meer
  // (vroeger telden die door, en een andere bpm vooraan gaf ze een andere "1").
  const c = Beatgrid.van({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10, bpm: 150, anker: 10.1 }] });
  const voor = c.beatsBetween(10, 20).filter((x) => x.maatbegin).map((x) => x.tijd.toFixed(3)).join(' ');
  c.setBpm(121, { bij: 5 });
  const na = c.beatsBetween(10, 20).filter((x) => x.maatbegin).map((x) => x.tijd.toFixed(3)).join(' ');
  ok(`een ander stuk bewerken laat deze maten staan (${voor})`, voor === na);

  // Splitsen verandert niets aan de maten, en daarna houdt het nieuwe stuk zijn "1".
  const s2 = new Beatgrid({ bpm: 120, firstBeat: 0 });
  s2.splits(21.1);
  ok('splitsen: dezelfde maten', s2.beatsBetween(0, 40).every((x) => x.maatbegin === oudeMaat(s2, x.beat)));
  ok('en het nieuwe stuk heeft zijn eerste "1" als maat (22,0)', bij(s2.stukken[1].maat, 22));
  s2.setBpm(118, { bij: 5 });
  ok('het eerste stuk bijstellen verschuift de "1" van het tweede niet', s2.isDownbeat(22) && s2.isDownbeat(24));

  // Splitsen in de laatste maat vóór een stuk op een ander tempo (controleur,
  // 25 sep): de volgende "1" ligt dan in DAT stuk (20,9 op 150). Die werd de
  // maat van het nieuwe stuk, afgerond op zijn eigen rooster (21,0), en 19,0
  // werd een "1" terwijl het tel 3 was.
  const s3 = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, maat: 0 }, { van: 20, bpm: 150, anker: 20.1, maat: 20.9 }] });
  const een = (g) => g.beatsBetween(15, 25).filter((x) => x.maatbegin).map((x) => x.tijd.toFixed(2)).join(' ');
  const voorS3 = een(s3);
  s3.splits(18.7);
  ok(`splitsen vlak voor een ander stuk: dezelfde maten (${voorS3} / ${een(s3)})`, een(s3) === voorS3 && s3.telInMaat(19.0) === 3);
  const nieuwStuk = s3.stukken[1];
  ok('en de maat van het nieuwe stuk ligt op zijn eigen rooster', Math.abs(((nieuwStuk.maat - nieuwStuk.anker) * nieuwStuk.bpm / 60) % 1) < 1e-9);
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

  // Maatbegin met het maat-anker per stuk (integratie ronde 3): starten op de
  // maat valt op de "1" van het stuk van de maatgever, niet op een maat die
  // vanaf tel 0 van het eerste stuk doortelt.
  const eigen = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10, bpm: 150, anker: 10.1, maat: 10.9 }] });
  const b1 = eigen.beatAt(10.1);                   // tel 20: doorgeteld een "1", hier tel 3
  ok(`volgendeVeelvoud volgt de eigen "1" van het stuk (tel ${b1} -> ${eigen.volgendeVeelvoud(b1)}, op ${eigen.timeOf(eigen.volgendeVeelvoud(b1)).toFixed(2)} s)`,
    eigen.volgendeVeelvoud(b1) === b1 + 2 && eigen.isMaatbegin(eigen.volgendeVeelvoud(b1)) && bij(eigen.timeOf(eigen.volgendeVeelvoud(b1)), 10.9));
  ok('... en in het eerste stuk gewoon doorgeteld (tel 13 -> 16 = 8,0 s)', eigen.volgendeVeelvoud(13) === 16 && bij(eigen.timeOf(16), 8));
  ok('... per 1 blijft de volgende tel', eigen.volgendeVeelvoud(b1 + 0.3, 1) === b1 + 1);
}

// ---- 5 okt: bevestigen, de "1" verschuiven, vastzetten (docs/BEATGRID.md §10) ---------------
console.log('\nbevestigen, maat, vastzetten');
{
  const g = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 1, zekerheid: 0.5 }, { van: 60, bpm: 124, anker: 60.2, zekerheid: 0.3 }] });
  ok('vooraf: beide stukken onzeker', g.zekerheidBij(30) === 'onzeker' && g.zekerheidBij(90) === 'onzeker');
  g.bevestig(30);
  ok('bevestig: het stuk rond t telt als zeker (met de hand), het andere niet', g.zekerheidBij(30) === 'zeker' && g.zekerheidBij(90) === 'onzeker'
    && !('zekerheid' in g.stukken[0]) && g.stukken[1].zekerheid === 0.3);

  const m = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }] });
  const tellenVoor = m.beatsBetween(0, 4).map((x) => x.tijd).join();
  ok('zonder maat: tel 0 is de "1"', m.telInMaat(0) === 1 && m.telInMaat(0.5) === 2);
  m.maatSchuif(0, 1);
  ok('maatSchuif +1: de "1" ligt een tel later, de tellen liggen er nog', m.telInMaat(0.5) === 1 && m.telInMaat(0) === 4
    && m.beatsBetween(0, 4).map((x) => x.tijd).join() === tellenVoor);
  m.maatSchuif(0, -1);
  ok('… en −1 weer terug', m.telInMaat(0) === 1);

  // Een plaat op 124,3 bpm met een grid op 124,0 (het analyse-tempo een fractie naast).
  const echt = 124.3, L = 60 / echt;
  const p = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 1, zekerheid: 0.5 }] });
  const t64 = 1 + 64 * L;
  const naastVoor = t64 - p.timeOf(Math.round(p.beatAt(t64)));
  const r = p.pin(t64);
  ok(`pin op tel 64 (het grid lag ${Math.round(naastVoor * 1000)} ms naast): ${r.bpm} bpm, was ${r.was}, over ${r.tellen} tellen`,
    r.ok && Math.abs(r.bpm - echt) < 1e-9 && r.tellen === 64 && r.was === 124);
  const naast = (t) => Math.abs(t - p.timeOf(Math.round(p.beatAt(t))));
  ok('daarna ligt elke tel op zijn plek, ook ver voorbij de pin (tel 400)', [0, 17, 64, 200, 400].every((k) => naast(1 + k * L) < 1e-9));
  ok('vanaf de pin een nieuw stuk met de pin als anker; beide zeker', p.aantalStukken === 2 && Math.abs(p.stukken[1].anker - t64) < 1e-9
    && p.zekerheidBij(10) === 'zeker' && p.zekerheidBij(t64 + 10) === 'zeker');
  ok('de "1" telt gewoon door (tel 64 is een "1", 65 een 2)', p.telInMaat(t64) === 1 && p.telInMaat(t64 + L) === 2);

  const w = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0 }] });
  const ver = w.pin(50.45 * 60 / 124);                     // 0,45 tel naast tel 50
  ok(`pin waar het grid meer dan 0,4 tel naast ligt: geweigerd, met waarom ("${(ver.reden || '').slice(0, 40)}…")`, !ver.ok && /naast/.test(ver.reden) && w.bpm === 124);
  const snel = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0 }] });
  const r2 = snel.pin(4.7 * 60 / 124);                     // 0,3 tel naast tel 5: 6% sneller
  ok('pin die het tempo meer dan 4% zou veranderen: geweigerd (klopt het anker?)', !r2.ok && /tempo/.test(r2.reden) && snel.bpm === 124);
  const dicht = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0 }] });
  const r3 = dicht.pin(2 * 60 / 124 + 0.01);
  ok('pin vlak bij het anker (2 tellen): alleen de fase, geen tempo', r3.ok && r3.alleenFase && dicht.bpm === 124
    && Math.abs(dicht.timeOf(Math.round(dicht.beatAt(2 * 60 / 124 + 0.01))) - (2 * 60 / 124 + 0.01)) < 1e-9);

  // Een live opgenomen mix die drijft: 124 → 126 bpm in 5 minuten. Tel 1 aan het
  // begin en dan om de 32 tellen een pin: hoe ver liggen de tellen ernaast?
  const b0 = 124, b1 = 126, T = 300;
  // tempo(t) = b0 + (b1 − b0)·t/T; tellen(t) = ∫ tempo/60 dt
  const telVan = (t) => (b0 * t + (b1 - b0) * t * t / (2 * T)) / 60;
  const tijdVanTel = (k) => { let lo = 0, hi = T + 30; for (let i = 0; i < 60; i++) { const mi = (lo + hi) / 2; if (telVan(mi) < k) lo = mi; else hi = mi; } return (lo + hi) / 2; };
  const live = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0, zekerheid: 0.4 }] });
  let geweigerd = 0;
  for (let k = 32; telVan(T) > k; k += 32) if (!live.pin(tijdVanTel(k)).ok) geweigerd++;
  let slechtste = 0;
  for (let k = 0; tijdVanTel(k) < T - 5; k++) {
    const t = tijdVanTel(k);
    slechtste = Math.max(slechtste, Math.abs(t - live.timeOf(Math.round(live.beatAt(t)))));
  }
  ok(`drijvende mix (124 → 126 bpm in 5 min), om de 32 tellen een pin: elke tel binnen ${(slechtste * 1000).toFixed(2)} ms (${live.aantalStukken} stukken, ${geweigerd} geweigerd)`,
    geweigerd === 0 && slechtste < 0.005);
}

// 14 okt (BEATGRID.md §12): vastzetten waar het grid ver uit de pas ligt. Een
// plaat op 124,317 met een grid op 124,19: na 620 tellen ligt het grid 0,63 tel
// achter, dus 0,37 tel VÓÓR de volgende tel. Zonder klappen kiest pin die (619
// tellen) en zet het tempo de verkeerde kant op; met de klappen kiest hij 620.
{
  const waar = 124.317, T0 = 0.35, L = 60 / waar;
  const t620 = T0 + 620 * L;
  const kicks = Float64Array.from({ length: 700 }, (_, i) => T0 + i * L);
  // Kicks op de tel en hi-hats op elke zestiende: ook dan wint het juiste aantal.
  const druk = Float64Array.from({ length: 2800 }, (_, i) => T0 + i * L / 4);
  const zonder = new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] });
  const rz = zonder.pin(t620);
  ok(`pin op 0,63 tel drift ZONDER klappen: kiest de buurtel (619, ${rz.bpm?.toFixed(3)} bpm), zoals vroeger`, rz.ok && rz.tellen === 619 && !rz.geteld);
  const met = new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] });
  const rm = met.pin(t620, { klappen: kicks });
  ok(`… MET klappen: 620 tellen, ${rm.bpm?.toFixed(4)} bpm (geteld op de klappen: ${rm.geteld})`, rm.ok && rm.tellen === 620 && Math.abs(rm.bpm - waar) < 1e-6 && rm.geteld >= 0.99);
  const hats = new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] });
  const rh = hats.pin(t620, { klappen: druk });
  ok('… ook met hi-hats op elke zestiende tussen de kicks', rh.ok && rh.tellen === 620 && Math.abs(rh.bpm - waar) < 1e-6);
  // Dicht genoeg bij (0,1 tel): de klappen veranderen niets aan wat vroeger al goed ging.
  const dichtbij = new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] });
  const rd = dichtbij.pin(T0 + 100 * L, { klappen: kicks });
  ok('… dichtbij (0,1 tel naast): hetzelfde als zonder klappen', rd.ok && rd.tellen === 100 && rd.geteld === null && Math.abs(rd.bpm - waar) < 1e-6);
  // Klappen die nergens op vallen (ambient): geen keuze, dan het oude gedrag.
  const vaag = new Beatgrid({ stukken: [{ van: 0, bpm: 124.19, anker: T0, maat: T0 }] });
  const rv = vaag.pin(t620, { klappen: Float64Array.from({ length: 50 }, (_, i) => 1.234 + i * 7.1) });
  ok('… met klappen die niets zeggen: het oude gedrag (619)', rv.ok && rv.tellen === 619 && !rv.geteld);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
