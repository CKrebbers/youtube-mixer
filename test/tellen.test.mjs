// Tellen → tempokaart, en meten of een grid klopt (src/engine/tellen.js).
// Synthetische tellen met een bekend antwoord, met de ruis die Beat This!
// echt heeft (frames van 20 ms, zwaartepunt erbij: ~5 ms mediaan).
const { gridUitTellen, meetGrid, afwijkingBij, vergelijk, RAAK, DRIFT, TWIJFELS } = await import('../src/engine/tellen.js');
const { Beatgrid, ZEKER_VANAF } = await import('../src/engine/beatgrid.js');

const fails = [];
const ok = (naam, cond, info = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (cond || !info ? '' : `  (${info})`)); };

// Vaste ruis: dezelfde getallen bij elke run.
let zaad = 12345;
const rnd = () => { zaad = (zaad * 1103515245 + 12345) & 0x7fffffff; return zaad / 0x7fffffff; };
const ruis = (ms = 5) => (rnd() + rnd() + rnd() - 1.5) * 2 * ms / 1000;   // ~driehoekig, ±ms·3
/** Tellen op een rooster met ruis; de detector rekent in frames van 20 ms met een zwaartepunt: kwantiseer op 5 ms. */
const tellen = (van, tot, bpm, anker, { ms = 5 } = {}) => {
  const L = 60 / bpm, uit = [];
  for (let k = Math.ceil((van - anker) / L); anker + k * L < tot; k++) uit.push(Math.round((anker + k * L + ruis(ms)) * 200) / 200);
  return uit;
};
const downs = (B, fase = 0, per = 4) => B.filter((_, i) => i % per === fase);
const ms = (x) => `${(x * 1000).toFixed(1)} ms`;

// ---- één tempo -------------------------------------------------------------

{
  const B = tellen(0.37, 240, 128, 0.37);
  const D = downs(B, 2);
  const k = gridUitTellen(B, D, { duur: 241 });
  const g = new Beatgrid(k);
  ok('vast tempo: één stuk', k.stukken.length === 1, JSON.stringify(k.stukken.map((s) => [s.van, s.bpm])));
  ok('vast tempo: bpm op 0,01', Math.abs(k.stukken[0].bpm - 128) < 0.01, k.stukken[0].bpm);
  const fout = Math.max(...[0.37, 60, 120, 239].map((t) => { const L = 60 / 128; const echt = 0.37 + Math.round((t - 0.37) / L) * L; return Math.abs(g.timeOf(Math.round(g.beatAt(echt))) - echt); }));
  ok('vast tempo: het grid ligt op 2 ms van de echte tellen, ook na 4 minuten', fout < 0.002, ms(fout));
  ok('vast tempo: zeker', k.stukken[0].zekerheid >= ZEKER_VANAF && !k.stukken[0].twijfel, JSON.stringify(k.stukken[0]));
  ok('vast tempo: methode en versie erbij', k.methode === 'tellen' && k.versie >= 1);
  ok('de "1" komt uit de downbeats', g.isMaatbegin(Math.round(g.beatAt(B[2]))) && g.isMaatbegin(Math.round(g.beatAt(B[6]))) && !g.isMaatbegin(Math.round(g.beatAt(B[3]))));
  ok('vier tellen per maat', k.beatsPerBar === 4);
  const m = meetGrid(g, B, D);
  ok('meten: bijna alles raak', m.totaal.raak > 0.95, m.totaal.raak);
  ok('meten: geen systematische afwijking', m.totaal.afwijking < 0.004, ms(m.totaal.afwijking));
  ok('meten: alle downbeats op een "1"', m.totaal.een === 1, m.totaal.een);
}

// ---- tempowissel en fasesprong (een mix) ------------------------------------

{
  const B = [...tellen(0.1, 120, 120, 0.1), ...tellen(120.2, 240, 126, 120.2)];
  const k = gridUitTellen(B, downs(B), { duur: 240 });
  const echt = k.stukken.filter((s) => s.twijfel !== 'geen puls');
  ok('tempowissel: twee stukken', echt.length === 2, JSON.stringify(k.stukken.map((s) => [s.van, s.bpm, s.twijfel])));
  ok('tempowissel: de tempo\'s kloppen', Math.abs(echt[0].bpm - 120) < 0.02 && Math.abs(echt[1]?.bpm - 126) < 0.02);
  ok('tempowissel: de grens ligt bij de wissel (binnen een tel)', Math.abs(echt[1]?.van - 120) < 0.6, echt[1]?.van);
  const m = meetGrid(new Beatgrid(k), B);
  ok('tempowissel: het grid volgt beide', m.totaal.raak > 0.93 && m.totaal.afwijking < 0.005, `${m.totaal.raak} ${ms(m.totaal.afwijking)}`);
  ok('tempowissel: beide stukken zeker', echt.every((s) => s.zekerheid >= ZEKER_VANAF), JSON.stringify(echt));
}

{
  // Zelfde tempo, maar de tweede helft een halve tel verschoven (twee nummers in een mix).
  const L = 60 / 124;
  const B = [...tellen(0, 90, 124, 0), ...tellen(90, 180, 124, 0.5 * L)];
  const k = gridUitTellen(B, [], { duur: 180 });
  const m = meetGrid(new Beatgrid(k), B);
  ok('fasesprong: een nieuw stuk', k.stukken.length === 2, k.stukken.length);
  ok('fasesprong: het grid volgt', m.totaal.raak > 0.93, m.totaal.raak);
}

// ---- langzaam weglopend tempo (live gespeeld, oude plaat) ------------------

{
  // 124 → 126 bpm in 5 minuten, gelijkmatig: de tel van tijdstip t.
  const B = [];
  let t = 0.2;
  while (t < 300) { B.push(Math.round((t + ruis()) * 200) / 200); t += 60 / (124 + 2 * t / 300); }
  const k = gridUitTellen(B, [], { duur: 300 });
  const m = meetGrid(new Beatgrid(k), B);
  ok('drift: het grid volgt binnen DRIFT', m.totaal.afwijking <= DRIFT, ms(m.totaal.afwijking));
  ok('drift: bijna alles raak', m.totaal.raak > 0.93, m.totaal.raak);
  ok('drift: in een paar stukken, niet in honderd', k.stukken.length >= 2 && k.stukken.length <= 20, k.stukken.length);
  ok('drift: overal zeker', k.stukken.every((s) => s.zekerheid >= ZEKER_VANAF), JSON.stringify(k.stukken.filter((s) => s.zekerheid < ZEKER_VANAF)));
}

// ---- gemiste en extra tellen -----------------------------------------------

{
  const L = 60 / 100;
  const B0 = tellen(0.5, 200, 100, 0.5);
  const B = B0.filter((_, i) => i % 10 !== 7);                       // 10% gemist
  for (let i = 3; i < B0.length; i += 20) B.push(B0[i] + L / 2);       // 5% extra, op de offbeat
  B.sort((a, b) => a - b);
  const k = gridUitTellen(B, [], { duur: 200 });
  ok('gemiste en extra tellen: één stuk', k.stukken.length === 1, JSON.stringify(k.stukken.map((s) => [s.van, s.bpm, s.twijfel])));
  ok('gemiste en extra tellen: bpm klopt', Math.abs(k.stukken[0].bpm - 100) < 0.02, k.stukken[0].bpm);
  ok('gemiste en extra tellen: toch zeker', k.stukken[0].zekerheid >= ZEKER_VANAF, k.stukken[0].zekerheid);
}

// ---- rubato en geen puls ---------------------------------------------------

{
  // Piano zonder klik: elke tel ±12% van de vorige, het tempo zwerft.
  const B = [];
  let t = 1, L = 0.75;
  while (t < 180) { B.push(t); L = Math.min(1.1, Math.max(0.5, L * (1 + (rnd() - 0.5) * 0.24))); t += L; }
  const k = gridUitTellen(B, [], { duur: 180 });
  const g = new Beatgrid(k);
  const onzeker = k.stukken.filter((s) => s.zekerheid < ZEKER_VANAF);
  ok('rubato: het grootste deel is onzeker', onzeker.length >= k.stukken.length / 2, JSON.stringify(k.stukken.map((s) => [Math.round(s.van), s.zekerheid, s.twijfel])));
  ok('rubato: met een reden erbij', onzeker.every((s) => TWIJFELS.includes(s.twijfel)));
  ok('rubato: sync weigert midden in het stuk', !g.zekerBij(90));
}

{
  const B = [...tellen(0, 60, 120, 0), ...tellen(120, 180, 120, 120.1)];
  const k = gridUitTellen(B, [], { duur: 180 });
  const g = new Beatgrid(k);
  ok('stilte in het midden: daar geen puls', g.zekerheidBij(90) === 'geenpuls', JSON.stringify(k.stukken.map((s) => [s.van, s.zekerheid, s.twijfel])));
  ok('stilte in het midden: ervoor en erna zeker', g.zekerBij(30) && g.zekerBij(150));
  ok('stilte in het midden: erna op de eigen fase', Math.abs(g.timeOf(Math.round(g.beatAt(150.1))) - 150.1) < 0.004);
}

{
  const B = tellen(30, 120, 140, 30.05);
  const k = gridUitTellen(B, downs(B), { duur: 150 });
  const g = new Beatgrid(k);
  ok('intro zonder puls: het eerste stuk is geen puls', k.stukken[0].van === 0 && k.stukken[0].twijfel === 'geen puls', JSON.stringify(k.stukken.map((s) => [s.van, s.twijfel])));
  ok('intro zonder puls: het rooster loopt door (tellen liggen goed waar de puls begint)', Math.abs(g.timeOf(Math.round(g.beatAt(30.05))) - 30.05) < 0.004);
  ok('outro zonder puls: ook geen puls', g.zekerheidBij(140) === 'geenpuls');
  ok('intro zonder puls: zeker waar het speelt', g.zekerBij(60));
}

ok('geen tellen: één stuk zonder puls', (() => { const k = gridUitTellen([], []); return k.stukken.length === 1 && k.stukken[0].twijfel === 'geen puls' && k.stukken[0].zekerheid === 0; })());
ok('drie tellen: ook', gridUitTellen([1, 1.5, 2]).stukken[0].twijfel === 'geen puls');
ok('rommel in de invoer wordt overgeslagen', gridUitTellen([NaN, ...tellen(0, 30, 120, 0), Infinity]).stukken[0].bpm > 119.9);

// ---- maatsoort en de "1" ---------------------------------------------------

{
  const B = tellen(0, 120, 150, 0);
  const k = gridUitTellen(B, downs(B, 1, 3));
  const g = new Beatgrid(k);
  ok('wals: drie tellen per maat', k.beatsPerBar === 3);
  ok('wals: de "1" op de downbeats', g.isMaatbegin(Math.round(g.beatAt(B[1]))) && g.isMaatbegin(Math.round(g.beatAt(B[4]))));
}

{
  const B = tellen(0, 120, 120, 0);
  // Downbeats die elkaar tegenspreken: om en om op fase 0 en 2.
  const D = B.filter((_, i) => i % 8 === 0 || i % 8 === 6);
  const k = gridUitTellen(B, D);
  ok('downbeats oneens: twijfel over de "1"', k.stukken[0].twijfel === 'maat', JSON.stringify(k.stukken[0]));
  ok('twijfel over de "1" blokkeert sync niet (de tellen kloppen wel)', k.stukken[0].zekerheid >= ZEKER_VANAF);
}

// ---- meten: een grid dat naast de tellen ligt ------------------------------

{
  const B = tellen(0, 120, 128, 0);
  const L = 60 / 128;
  const naast = meetGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 128, anker: 0.02 }] }), B);
  ok('20 ms naast: de afwijking meet 20 ms', Math.abs(naast.totaal.afwijking - 0.02) < 0.003, ms(naast.totaal.afwijking));
  ok('20 ms naast: de mediaan zegt welke kant (de tel komt vóór de lijn)', naast.totaal.mediaan < -0.015);
  const off = meetGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 128, anker: L / 2 }] }), B);
  ok('een halve tel naast: offbeat', off.totaal.offbeat > 0.9 && off.totaal.raak < 0.05);
  const traag = meetGrid(new Beatgrid({ stukken: [{ van: 0, bpm: 127.9, anker: 0 }] }), B);
  ok('0,1 bpm te traag: na twee minuten zichtbaar als afwijking', traag.totaal.afwijking > DRIFT, ms(traag.totaal.afwijking));
  ok('RAAK is ruimer dan de ruis van de detector', RAAK >= 0.02);
}

// ---- de live bewaking ------------------------------------------------------

{
  const B = Float64Array.from(tellen(0, 120, 128, 0));
  const goed = new Beatgrid({ stukken: [{ van: 0, bpm: 128, anker: 0 }] });
  const a = afwijkingBij(goed, B, 60);
  ok('bewaking: een goed grid wijkt niet af', a && Math.abs(a.mediaan) < 0.004 && a.raak > 0.8, JSON.stringify(a));
  const verschoven = new Beatgrid({ stukken: [{ van: 0, bpm: 128, anker: 0.03 }] });
  const b = afwijkingBij(verschoven, B, 60);
  ok('bewaking: 30 ms verschoven wordt gezien', b && Math.abs(b.mediaan + 0.03) < 0.005, JSON.stringify(b));
  ok('bewaking: vóór de eerste tel niets', afwijkingBij(goed, B, -1) === null);
  ok('bewaking: na een lange stilte niets', afwijkingBij(goed, B, 200) === null);
  ok('bewaking: zonder tellen niets', afwijkingBij(goed, null, 10) === null);
}

// ---- een tweede mening -----------------------------------------------------

{
  // 96 bpm: half (48) en dubbel (192) vallen allebei binnen MIN_BPM..MAX_BPM.
  const L = 60 / 96;
  const B = tellen(0.3, 180, 96, 0.3);
  const kaart = () => gridUitTellen(B, downs(B), { duur: 180 });
  const ander = (bpm, anker, zekerheid = 0.9) => new Beatgrid({ stukken: [{ van: 0, bpm, anker, zekerheid }] });
  const zelfde = vergelijk(kaart(), B, ander(96, 0.3));
  ok('eens: geen twijfel, geen octaaf', !zelfde.stukken[0].twijfel && !zelfde.stukken[0].octaaf && zelfde.stukken[0].zekerheid >= ZEKER_VANAF, JSON.stringify(zelfde.stukken[0]));
  const dubbel = vergelijk(kaart(), B, ander(192, 0.3));
  ok('dubbel tempo telt als eens, met het octaaf erbij', !dubbel.stukken[0].twijfel && dubbel.stukken[0].octaaf === 2, JSON.stringify(dubbel.stukken[0]));
  const half = vergelijk(kaart(), B, ander(48, 0.3));
  ok('half tempo ook', !half.stukken[0].twijfel && half.stukken[0].octaaf === 0.5, JSON.stringify(half.stukken[0]));
  const halfVerkeerd = vergelijk(kaart(), B, ander(48, 0.3 + L));
  ok('half tempo op de verkeerde tel valt nog op een tel: eens (het octaaf)', !halfVerkeerd.stukken[0].twijfel);
  const fase = vergelijk(kaart(), B, ander(96, 0.3 + L / 2));
  ok('een halve tel naast: oneens, en onzeker', fase.stukken[0].twijfel === 'oneens' && fase.stukken[0].zekerheid < ZEKER_VANAF, JSON.stringify(fase.stukken[0]));
  const drieTwee = vergelijk(kaart(), B, ander(144, 0.3));
  ok('3/2 is geen octaaf: oneens', drieTwee.stukken[0].twijfel === 'oneens');
  const anderTwijfelt = vergelijk(kaart(), B, ander(144, 0.3, 0.3));
  ok('twijfelt de ander zelf, dan telt zijn stem niet', !anderTwijfelt.stukken[0].twijfel);
  // De ander volgt een tempo dat beweegt minder fijn: zijn lijnen schuiven langzaam langs de tellen. Geen tegenspraak.
  const grof = vergelijk(kaart(), B, ander(96 * 1.012, 0.3));
  ok('een grovere ander (1% ernaast) is geen tegenspraak', !grof.stukken[0].twijfel, JSON.stringify(grof.stukken[0]));
  const kwart = vergelijk(kaart(), B, ander(192, 0.3 + L / 4));
  ok('dubbel tempo maar een kwart tel verschoven: oneens', kwart.stukken[0].twijfel === 'oneens', JSON.stringify(kwart.stukken[0]));
  ok('zonder tweede mening blijft alles staan', JSON.stringify(vergelijk(kaart(), B, null)) === JSON.stringify(kaart()));
}

// ---- snel genoeg voor een uur ----------------------------------------------

{
  const B = tellen(0, 3600, 128, 0);
  const t0 = performance.now();
  const k = gridUitTellen(B, downs(B), { duur: 3600 });
  const m = meetGrid(new Beatgrid(k), B);
  const dt = performance.now() - t0;
  ok('een uur (7680 tellen) in onder een seconde', dt < 1000, `${dt.toFixed(0)} ms`);
  // De afwijking is het slechtste blok van 16 tellen: bij 480 blokken ruis ~5 ms, ver onder DRIFT.
  ok('een uur: één stuk, bpm op 0,001', k.stukken.length === 1 && Math.abs(k.stukken[0].bpm - 128) < 0.001, `${k.stukken.length} ${k.stukken[0].bpm}`);
  ok('een uur: geen blok dat wegloopt', m.totaal.afwijking < DRIFT * 0.7, ms(m.totaal.afwijking));
  const g = new Beatgrid(k), L = 60 / 128;
  ok('een uur: de laatste tel ligt op 1 ms', Math.abs(g.timeOf(Math.round(g.beatAt(3599))) - Math.round(3599 / L) * L) < 0.001);
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
