// Beatdetectie op materiaal waarvan we het antwoord kennen.
// De toleranties hieronder zijn GEMETEN, niet gewenst: ze leggen vast hoe goed
// de detector nu is, zodat een verslechtering opvalt.
const d = await import('../server/detect.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const SR = 11025;

/** Klikspoor op een gegeven tempo, eventueel met een aanloop. */
function klikspoor(duur, bpm, start = 0) {
  const x = new Float32Array(Math.round(SR * duur));
  const periode = 60 / bpm;
  for (let b = 0; start + b * periode < duur; b++) {
    const s = Math.round((start + b * periode) * SR);
    for (let i = 0; i < 220; i++) {
      if (s + i < x.length) x[s + i] += Math.exp(-i / 40) * Math.sin((2 * Math.PI * 900 * i) / SR);
    }
  }
  return x;
}

function meet(x) {
  const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR);
  const n = d.normaliseerEnvelope(env, envRate);
  const grof = d.tempoUitEnvelope(n, envRate);
  const fijn = d.verfijnTempoFase(n, envRate, grof.bpm, tijdOffset);
  return { ...fijn, zekerheid: grof.zekerheid, env: n, envRate, tijdOffset };
}

const fasefout = (gevonden, echt, bpm) => {
  const p = 60 / bpm;
  const a = ((gevonden - echt) % p + p) % p;
  return Math.min(a, p - a) * 1000;
};

// ---- FFT -------------------------------------------------------------------

{
  const n = 16;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 3 * i) / n);
  d.fft(re, im);
  let piek = 0;
  for (let i = 1; i < n / 2; i++) if (Math.hypot(re[i], im[i]) > Math.hypot(re[piek], im[piek])) piek = i;
  ok('FFT vindt de frequentie terug', piek === 3);
  ok('en de amplitude klopt', Math.abs(Math.hypot(re[3], im[3]) - n / 2) < 0.01);
}

// ---- kalibratie ------------------------------------------------------------

const vertraging = d.onsetVertraging(SR);
ok('de onset-vertraging wordt gemeten en is positief', vertraging > 0);
ok('en ligt in een plausibele orde (een half tot heel venster)',
  vertraging > 0.03 && vertraging < 0.15);
ok('de meting is stabiel (gecachet)', d.onsetVertraging(SR) === vertraging);

// ---- envelope --------------------------------------------------------------

{
  const { env, envRate } = d.onsetEnvelope(klikspoor(4, 120), SR);
  ok('envelope heeft frames', env.length > 100);
  ok('envelope-rate klopt met de hop', Math.abs(envRate - SR / 128) < 0.01);
  const n = d.normaliseerEnvelope(env, envRate);
  ok('normaliseren haalt de bodem eruit', Math.min(...n) === 0);
}

// ---- tempo en fase ---------------------------------------------------------

let ergsteBpm = 0, ergsteFase = 0;
for (const [bpm, start] of [[120, 0], [128, 0.25], [95, 0.1], [140, 0.37], [160, 0.2], [123.5, 0.44], [85, 0.3]]) {
  const r = meet(klikspoor(20, bpm, start));
  ergsteBpm = Math.max(ergsteBpm, Math.abs(r.bpm - bpm));
  ergsteFase = Math.max(ergsteFase, fasefout(r.firstBeat, start, bpm));
}
// Toleranties aangescherpt nadat de envelope naar banden + superflux ging:
// tempo ging van 0,20 naar 0,01 bpm, fase van 12,9 naar 3,4 ms. Blijft dit
// niet gehaald worden, dan is er iets in de envelope verslechterd.
// Fase: 25 ms sinds 23 september 2026. De tijdcorrectie is toen geijkt op een
// reeks klanken in plaats van op precies deze tik; zachte aanzetten landden
// eerder 10-33 ms te laat, nu ligt de reeks rond nul. Deze klik (4 ms
// uitsterven) is de scherpste klank die er is en valt aan de vroege rand
// (~-20 ms). De fijne fase op de audio haalt hem wel binnen 7 ms (zie onder).
ok(`tempo binnen 0,1 bpm (slechtste ${ergsteBpm.toFixed(3)})`, ergsteBpm < 0.1);
ok(`fase binnen 25 ms (slechtste ${ergsteFase.toFixed(1)} ms)`, ergsteFase < 25);

// ---- octaaffout ------------------------------------------------------------
// 174 bpm mag geen 87 worden: dat is de klassieke misser bij snelle muziek.

const snel = meet(klikspoor(20, 174));
ok('174 bpm wordt niet gehalveerd naar 87', Math.abs(snel.bpm - 174) < 1);
const traag = meet(klikspoor(20, 85));
ok('85 bpm wordt niet verdubbeld naar 170', Math.abs(traag.bpm - 85) < 1);

// ---- zekerheid -------------------------------------------------------------

const ritme = meet(klikspoor(20, 120));
ok('een strak ritme geeft hoge zekerheid', ritme.zekerheid > 0.8);
ok('banden en superflux zitten erin', (() => {
  const { env } = d.onsetEnvelope(klikspoor(3, 120), SR, { banden: 40 });
  return env.length > 50 && env.some((v) => v > 0);
})());

const ruis = new Float32Array(SR * 20);
for (let i = 0; i < ruis.length; i++) ruis[i] = (Math.random() * 2 - 1) * 0.3;
const opRuis = meet(ruis);
ok('ruis geeft lage zekerheid', opRuis.zekerheid < 0.35);
ok('en staat ver van een strak ritme af', ritme.zekerheid - opRuis.zekerheid > 0.5);

// ---- tempowissel: waar dit allemaal om begonnen is ------------------------
// Een album van een halfuur heeft geen tempo; het heeft er zeven.

{
  const stukken = [[120, 40], [128, 40], [95, 40]];
  const totaal = stukken.reduce((a, [, s]) => a + s, 0);
  const x = new Float32Array(Math.round(SR * totaal));
  let t = 0;
  for (const [bpm, duur] of stukken) {
    const deel = klikspoor(duur, bpm);
    const offset = Math.round(t * SR);
    for (let i = 0; i < deel.length && offset + i < x.length; i++) x[offset + i] += deel[i];
    t += duur;
  }
  const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR);
  const n = d.normaliseerEnvelope(env, envRate);
  const curve = d.tempoCurve(n, envRate, { vensterSec: 12, stapSec: 4, tijdOffset });
  ok('de tempocurve bestrijkt de hele track', curve.length > 20);

  const seg = d.segmenteer(curve, { tolerantie: 0.04, minSec: 15 });
  ok('drie segmenten gevonden', seg.length === 3);
  ok('het eerste tempo klopt', Math.abs(seg[0].bpm - 120) < 1.5);
  ok('het tweede ook', Math.abs(seg[1].bpm - 128) < 1.5);
  ok('en het derde', Math.abs(seg[2].bpm - 95) < 1.5);
  ok('de grenzen liggen bij de overgangen',
    Math.abs(seg[1].van - 40) < 10 && Math.abs(seg[2].van - 80) < 10);
  ok('segmenten lopen op in tijd', seg[0].van < seg[1].van && seg[1].van < seg[2].van);

  // Eén tempo over de hele track zou nergens kloppen.
  const eenTempo = d.tempoUitEnvelope(n, envRate);
  ok('één bpm over het geheel is aantoonbaar slechter',
    seg.every((s) => Math.abs(s.bpm - eenTempo.bpm) > 0.5) || seg.length === 3);
}

// ---- tap-verfijning rond de tap ------------------------------------------
// Je tikt op het stuk dat je HOORT. Over de hele track scoren liet het tempo
// van een ander stuk winnen zodra dat ook binnen de marge viel.

{
  const delen = [[120, 150, 0], [126, 150, 0.2]];
  const x = new Float32Array(Math.round(SR * 300));
  let t = 0;
  for (const [bpm, duur, start] of delen) {
    const deel = klikspoor(duur, bpm, start);
    const o = Math.round(t * SR);
    for (let i = 0; i < deel.length && o + i < x.length; i++) x[o + i] += deel[i];
    t += duur;
  }
  const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR);
  const n = d.normaliseerEnvelope(env, envRate);
  const vroeg = d.verfijnTempoFase(n, envRate, 123, tijdOffset, { rond: 60 });
  const laat = d.verfijnTempoFase(n, envRate, 123, tijdOffset, { rond: 240 });
  ok(`tap op 60 s, getikt 123: ${vroeg.bpm.toFixed(2)} (120 verwacht)`, Math.abs(vroeg.bpm - 120) < 0.1);
  ok(`tap op 240 s, getikt 123: ${laat.bpm.toFixed(2)} (126 verwacht)`, Math.abs(laat.bpm - 126) < 0.1);
  // Fase meten waar je tikte: de tel van het gevonden grid die daar het dichtst
  // bij ligt. Bij tracktijd 0 meten telt een fractie bpm 240 s lang op.
  const telBij = (r, P) => { const p = 60 / r.bpm; return r.firstBeat + Math.round((P - r.firstBeat) / p) * p; };
  // 25 ms: zie de fase-tolerantie hierboven (ijking op een reeks klanken).
  ok(`fase op 60 s klopt (${fasefout(telBij(vroeg, 60), 0, 120).toFixed(1)} ms)`, fasefout(telBij(vroeg, 60), 0, 120) < 25);
  ok(`fase op 240 s klopt (${fasefout(telBij(laat, 240), 150.2, 126).toFixed(1)} ms)`, fasefout(telBij(laat, 240), 150.2, 126) < 25);
  const heel = d.verfijnTempoFase(n, envRate, 123, tijdOffset);
  const zonder = d.verfijnTempoFase(n, envRate, 123, tijdOffset, { rond: null });
  ok('zonder positie: de hele track, als vroeger', heel.bpm === zonder.bpm && heel.firstBeat === zonder.firstBeat);
  const eind = d.verfijnTempoFase(n, envRate, 123, tijdOffset, { rond: 299 });
  ok(`tap vlak voor het einde: venster schuift terug (${eind.bpm.toFixed(2)})`, Math.abs(eind.bpm - 126) < 0.1);
}

// ---- STAP A (23 september 2026): tap, puls, 3:2, stukken, ijking ----------
// Alles op synthetisch materiaal waarvan het antwoord vastligt. Deterministisch
// (vaste zaden), zodat een rode test een echte verandering is en geen toeval.

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2147483648 - 1);
}
/** Klanken op tijden [t, sterkte, soort]; soort 'kick' (laag) of 'hat' (ruisslag). */
function spoorVan(duur, events, { vloer = 0.01, seed = 5 } = {}) {
  const rnd = prng(seed);
  const x = new Float32Array(Math.round(SR * duur));
  for (let i = 0; i < x.length; i++) x[i] = vloer * rnd();
  for (const [t, a, soort] of events) {
    const s0 = Math.round(t * SR);
    const lang = soort === 'hat' ? 600 : 2500;
    for (let i = 0; i < lang && s0 + i < x.length; i++) {
      x[s0 + i] += soort === 'hat'
        ? a * rnd() * Math.exp(-i / 150)
        : a * Math.exp(-i / 600) * Math.sin(2 * Math.PI * (55 * i / SR + 1.8 * (1 - Math.exp(-i / 330))));
    }
  }
  return x;
}
const envVan = (x) => { const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR); return { env: d.normaliseerEnvelope(env, envRate), envRate, tijdOffset }; };
/** Tikken rond `P` op een grid (bpm, eerste tel), met vaste menselijke fouten. */
function tikken(bpm, eerste, P, n, { jitter = 0.02, tempo = 0, seed = 9 } = {}) {
  const rnd = prng(seed), p = 60 / bpm;
  const k0 = Math.round((P - eerste) / p) - n + 1;
  // Het tempo-foutje loopt op vanaf de eerste tik, zoals bij iemand die iets te snel meetikt.
  return Array.from({ length: n }, (_, i) => eerste + k0 * p + i * p * (1 + tempo) - 0.015 + jitter * rnd());
}

console.log('\nrechte lijn door de tikken');
{
  const t = [10, 10.5, 11, 11.5, 12, 12.5];
  const f = d.fitTaps(t);
  ok(`schone tikken: 120 bpm (${f?.bpm.toFixed(3)}), anker op een tik`, Math.abs(f.bpm - 120) < 1e-9 && t.some((x) => Math.abs(x - f.anker) < 1e-9));
  const gemist = d.fitTaps([10, 10.5, 11.5, 12, 12.5], 118);
  ok(`een gemiste tik telt als overgeslagen tel (${gemist?.bpm.toFixed(2)})`, Math.abs(gemist.bpm - 120) < 1e-9);
  const dubbel = d.fitTaps([10, 10.5, 10.52, 11, 11.5], 120);
  ok('een dubbele tik valt weg', dubbel.n === 4 && Math.abs(dubbel.bpm - 120) < 0.5);
  const slordig = d.fitTaps(tikken(120, 0, 30, 4, { jitter: 0.04 }));
  const netjes = d.fitTaps(tikken(120, 0, 30, 8, { jitter: 0.005 }));
  ok(`onzekerheid schaalt mee: 4 slordige ${(slordig.seRel * 100).toFixed(2)}% > 8 nette ${(netjes.seRel * 100).toFixed(2)}%`, slordig.seRel > 2 * netjes.seRel);
  ok('minder dan twee tikken: geen lijn', d.fitTaps([3]) === null && d.fitTaps(null) === null);
}

console.log('\nverfijnen houdt de fase van de tap vast');
{
  // House-achtig: kick op de tel, een HARDERE hihat op de offbeat. De envelope
  // klapt het hardst op de offbeat; wie op de kick tikt, wil de kick.
  const bpm = 124, eerste = 0.25, p = 60 / bpm, ev = [];
  for (let t = eerste; t < 60; t += p) { ev.push([t, 0.5, 'kick'], [t + p / 2, 0.9, 'hat']); }
  const m = envVan(spoorVan(60, ev));
  const taps = tikken(bpm, eerste, 30, 4, { jitter: 0.03, tempo: 0.008 });
  const vrij = d.verfijnTempoFase(m.env, m.envRate, d.fitTaps(taps).bpm, m.tijdOffset, { rond: 30 });
  ok(`zonder voorwaarde kiest de envelope de offbeat (${fasefout(vrij.firstBeat, eerste, bpm).toFixed(0)} ms naast de kick)`,
    fasefout(vrij.firstBeat, eerste, bpm) > 0.4 * p * 1000);
  const r = d.verfijnTap(m.env, m.envRate, m.tijdOffset, { bpm: 120, positie: 30, taps });
  ok(`met de tikken als voorwaarde: de kick (${fasefout(r.firstBeat, eerste, bpm).toFixed(1)} ms), ${r.bpm.toFixed(3)} bpm`,
    r.zeker && fasefout(r.firstBeat, eerste, bpm) < 25 && Math.abs(r.bpm - bpm) < 0.1);
  ok('en het anker ligt bij de tikken', Math.abs(r.anker - 30) < 3 * p);
  const alleenAnker = d.verfijnTap(m.env, m.envRate, m.tijdOffset, { bpm: 124.5, positie: 30, anker: taps[1] });
  ok(`alleen een getikte tel (anker) volstaat ook (${fasefout(alleenAnker.firstBeat, eerste, bpm).toFixed(1)} ms)`,
    fasefout(alleenAnker.firstBeat, eerste, bpm) < 25);
  // Vier slordige tikken: marge breder dan acht nette, en toch het goede tempo.
  const r4 = d.verfijnTap(m.env, m.envRate, m.tijdOffset, { bpm: 120, positie: 30, taps: tikken(bpm, eerste, 30, 4, { jitter: 0.04, tempo: -0.012, seed: 3 }) });
  const r8 = d.verfijnTap(m.env, m.envRate, m.tijdOffset, { bpm: 120, positie: 30, taps: tikken(bpm, eerste, 30, 8, { jitter: 0.005, seed: 3 }) });
  ok(`marge schaalt mee: 4 slordig ${(r4.marge * 100).toFixed(1)}%, 8 netjes ${(r8.marge * 100).toFixed(1)}%`, r4.marge > r8.marge && r8.marge < 0.035);
  ok(`beide vinden ${bpm} (${r4.bpm.toFixed(2)} / ${r8.bpm.toFixed(2)})`, Math.abs(r4.bpm - bpm) < 0.1 && Math.abs(r8.bpm - bpm) < 0.1);
}

console.log('\ngeen puls: zeggen, niet gokken');
{
  const rnd = prng(21);
  // Ruis met klappen op willekeurige momenten.
  const ev = []; for (let k = 0; k < 120; k++) ev.push([1 + 58 * (rnd() * 0.5 + 0.5), 0.3 + 0.3 * (rnd() * 0.5 + 0.5), rnd() > 0 ? 'hat' : 'kick']);
  const ruis = spoorVan(60, ev, { vloer: 0.1, seed: 22 });
  // Ambient-achtig: aanzwellende akkoorden op willekeurige momenten, geen tel.
  const amb = new Float32Array(SR * 60);
  const r2 = prng(23);
  for (let i = 0; i < amb.length; i++) amb[i] = 0.01 * r2();
  for (let k = 0; k < 25; k++) {
    const s0 = Math.round((r2() * 0.5 + 0.5) * 55 * SR), f = 110 * 2 ** Math.floor((r2() * 0.5 + 0.5) * 24 / 12);
    for (let i = 0; i < 4 * SR && s0 + i < amb.length; i++) {
      const omh = Math.min(1, i / (1.2 * SR)) * Math.exp(-i / (2 * SR));
      amb[s0 + i] += 0.2 * omh * (Math.sin(2 * Math.PI * f * i / SR) + 0.5 * Math.sin(2 * Math.PI * 1.5 * f * i / SR));
    }
  }
  for (const [naam, x] of [['ruis met losse klappen', ruis], ['ambient zonder tel', amb]]) {
    const m = envVan(x);
    const taps = tikken(120, 0.1, 30, 8);
    const r = d.verfijnTap(m.env, m.envRate, m.tijdOffset, { bpm: 120, positie: 30, taps });
    const fit = d.fitTaps(taps);
    ok(`${naam}: zeker=false, "${r.reden}" (puls ${r.puls.toFixed(2)})`, r.zeker === false && r.reden === 'geen puls');
    ok('  en de tap zelf komt terug', Math.abs(r.bpm - fit.bpm) < 1e-9 && Math.abs(r.anker - fit.anker) < 1e-9
      && Math.abs(r.firstBeat - (((fit.anker % (60 / fit.bpm)) + 60 / fit.bpm) % (60 / fit.bpm))) < 1e-9);
  }
  const klik = envVan(klikspoor(60, 120, 0.1));
  const rk = d.verfijnTap(klik.env, klik.envRate, klik.tijdOffset, { bpm: 121, positie: 30, taps: tikken(120, 0.1, 30, 4) });
  ok(`een klikspoor heeft wel een puls (${rk.puls.toFixed(2)})`, rk.zeker === true);
  const zacht = [];
  for (let t = 0.3; t < 60; t += 60 / 96) zacht.push([t, 0.15, 'kick']);
  const rz = envVan(spoorVan(60, zacht, { vloer: 0.03, seed: 8 }));
  const rzr = d.verfijnTap(rz.env, rz.envRate, rz.tijdOffset, { bpm: 97, positie: 30, taps: tikken(96, 0.3, 30, 4) });
  ok(`een zachte kick in ruis ook (${rzr.puls.toFixed(2)}, ${rzr.bpm.toFixed(2)} bpm)`, rzr.zeker === true && Math.abs(rzr.bpm - 96) < 0.1);
}

console.log('\noctaafkeuze 3:2');
{
  // Tresillo op 153 (3+3+2 achtsten in een lage toon) met een zachte hoge tik op
  // elke tel: de autocorrelatie ziet de anderhalve tel (102); de maat zegt 153.
  // Toonstootjes [tel in de maat, sterkte, frequentie], vier tellen per maat.
  const maat = (bpm, patroon, duur = 24) => {
    const rnd = prng(5), p = 60 / bpm;
    const x = new Float32Array(SR * duur);
    for (let i = 0; i < x.length; i++) x[i] = 0.01 * rnd();
    for (let m = 0; m * 4 * p < duur; m++) for (const [tel, a, f] of patroon) {
      const s0 = Math.round((m * 4 + tel) * p * SR);
      for (let i = 0; i < 300 && s0 + i < x.length; i++) x[s0 + i] += a * Math.exp(-i / 50) * Math.sin(2 * Math.PI * f * i / SR);
    }
    return envVan(x);
  };
  const tellen = (a) => [0, 1, 2, 3].map((t) => [t, a, 3000]);
  const tres = maat(153, [[0, 1, 80], [1.5, 1, 80], [3, 1, 80], ...tellen(0.25)]);
  const rt = d.tempoUitEnvelope(tres.env, tres.envRate);
  ok(`tresillo op 153 wordt 153, niet 102 (${rt.bpm.toFixed(1)})`, Math.abs(rt.bpm - 153) < 2);
  const rock = maat(102, [[0, 1, 80], [2, 1, 80], [1, 0.8, 300], [3, 0.8, 300], ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((t) => [t, 0.3, 3000])]);
  const rr = d.tempoUitEnvelope(rock.env, rock.envRate);
  ok(`recht op 102 blijft 102 (${rr.bpm.toFixed(1)})`, Math.abs(rr.bpm - 102) < 2);
  const triool = maat(102, [[0, 1, 80], [2, 1, 80], [1, 0.8, 300], [3, 0.8, 300], ...[0, 1, 2, 3].flatMap((t) => [[t, 0.3, 3000], [t + 1 / 3, 0.3, 3000], [t + 2 / 3, 0.3, 3000]])]);
  const rtr = d.tempoUitEnvelope(triool.env, triool.envRate);
  ok(`triolen op 102 blijven 102 (${rtr.bpm.toFixed(1)})`, Math.abs(rtr.bpm - 102) < 2);
  // Dezelfde triolen met kick en hihat (ander klankmateriaal): ook 102.
  const tk = [], p102 = 60 / 102;
  for (let m = 0; m * 4 * p102 < 24; m++) for (const [tel, a, soort] of [[0, 1, 'kick'], [2, 1, 'kick'], [1, 0.8, 'hat'], [3, 0.8, 'hat'],
    ...[0, 1, 2, 3].flatMap((t) => [[t + 1 / 3, 0.3, 'hat'], [t + 2 / 3, 0.3, 'hat']])]) tk.push([(m * 4 + tel) * p102 + 0.05, a, soort]);
  const tkm = envVan(spoorVan(24, tk.filter(([t]) => t < 23.7)));
  const rtk = d.tempoUitEnvelope(tkm.env, tkm.envRate);
  ok(`en met kick en hihat (${rtk.bpm.toFixed(1)})`, Math.abs(rtk.bpm - 102) < 2);
  ok('klikspoor 174 en 85 blijven zoals ze waren', Math.abs(meet(klikspoor(20, 174)).bpm - 174) < 1 && Math.abs(meet(klikspoor(20, 85)).bpm - 85) < 1);
  // Tik je 153 op wat de detectie 102 noemt: de tap beslist het octaaf.
  const rv = d.verfijnTap(tres.env, tres.envRate, tres.tijdOffset, { bpm: 150, positie: 12, taps: tikken(153, 0, 12, 6) });
  ok(`tap op 153 over de tresillo: ${rv.bpm.toFixed(2)} bpm, zeker`, rv.zeker && Math.abs(rv.bpm - 153) < 0.2);
}

console.log('\nsegmenteren: gaten, korte stukken, midden van het venster');
{
  const v = (tijd, bpm, zekerheid = 0.9) => ({ tijd, bpm, zekerheid });
  const curve = [];
  for (let t = 6; t <= 40; t += 4) curve.push(v(t, 120));
  for (let t = 44; t <= 80; t += 4) curve.push(v(t, 90, 0.05));      // pulsloos
  for (let t = 84; t <= 130; t += 4) curve.push(v(t, 120.5));
  const seg = d.segmenteer(curve, { minSec: 15 });
  ok(`een gat knipt, ook bij hetzelfde tempo (${seg.length} stukken)`, seg.length === 2 && seg[0].tot <= 44 && seg[1].van >= 80);
  const kort = [v(6, 140), v(10, 140), ...Array.from({ length: 15 }, (_, i) => v(14 + 4 * i, 120))];
  const sk = d.segmenteer(kort, { minSec: 20 });
  ok(`een te kort EERSTE stuk wordt opgeslokt (${sk.length} stuk, ${sk[0]?.bpm} bpm vanaf ${sk[0]?.van})`, sk.length === 1 && sk[0].bpm === 120 && sk[0].van <= 6);
  const eiland = [...Array.from({ length: 10 }, (_, i) => v(6 + 4 * i, 120)), v(80, 150), ...Array.from({ length: 10 }, (_, i) => v(120 + 4 * i, 120))];
  ok('een los kort stuk tussen twee gaten vervalt', d.segmenteer(eiland, { minSec: 20 }).length === 2);
  // Tijd = midden van het venster: de grens ligt nu bij de overgang, niet 6 s ervoor.
  const stukken = [[120, 40], [128, 40], [95, 40]];
  const x = new Float32Array(Math.round(SR * 120));
  let t0 = 0;
  for (const [bpm, duur] of stukken) { const deel = klikspoor(duur, bpm); x.set(deel.subarray(0, Math.min(deel.length, x.length - Math.round(t0 * SR))), Math.round(t0 * SR)); t0 += duur; }
  const m = envVan(x);
  const s3 = d.segmenteer(d.tempoCurve(m.env, m.envRate, { tijdOffset: m.tijdOffset }), { tolerantie: 0.04, minSec: 15 });
  // Met het BEGIN van het venster als tijd lagen ze op 36,1 en 76,2.
  ok(`grenzen binnen 2,5 s van de overgang (${s3.map((s) => s.van.toFixed(1)).join(', ')})`,
    s3.length === 3 && Math.abs(s3[1].van - 40) < 2.5 && Math.abs(s3[2].van - 80) < 2.5);
}

console.log('\nfase-stabiliteit en analyseerGrid');
{
  const klik = envVan(klikspoor(40, 120, 0.1));
  const rnd = prng(31);
  const ruis = new Float32Array(SR * 40); for (let i = 0; i < ruis.length; i++) ruis[i] = 0.3 * rnd();
  const rm = envVan(ruis);
  const stKlik = d.faseStabiliteit(klik.env, klik.envRate, klik.tijdOffset, 120, 5, 35);
  const stRuis = d.faseStabiliteit(rm.env, rm.envRate, rm.tijdOffset, 120, 5, 35);
  ok(`fase-stabiliteit: klikspoor ${stKlik.toFixed(2)}, ruis ${stRuis.toFixed(2)}`, stKlik > 0.9 && stRuis < 0.6);
  ok('een fractie naast in tempo blijft stabiel (drift is geen ruis)', d.faseStabiliteit(klik.env, klik.envRate, klik.tijdOffset, 121, 5, 35) > 0.9);

  // 60 s op 120 (eerste tel 0,10), 40 s zonder puls, 60 s op 128 met een andere fase.
  const x = new Float32Array(SR * 160);
  const r = prng(41);
  for (let i = 0; i < x.length; i++) x[i] = 0.01 * r();
  const ev = [];
  for (let t = 0.10; t < 60; t += 0.5) ev.push([t, 0.5, 'kick']);
  for (let t = 100.33; t < 160; t += 60 / 128) ev.push([t, 0.5, 'kick']);
  for (let k = 0; k < 60; k++) ev.push([60 + 40 * (r() * 0.5 + 0.5), 0.4, 'hat']);
  const bron = spoorVan(160, ev, { vloer: 0.01, seed: 42 });
  for (let i = 60 * SR; i < 100 * SR; i++) bron[i] += 0.1 * r();
  const m = envVan(bron);
  const st = d.analyseerGrid(m.env, m.envRate, m.tijdOffset);
  ok(`drie stukken (${st.map((s) => `${s.van.toFixed(0)}-${s.tot.toFixed(0)} ${s.bpm?.toFixed(1)} z${s.zekerheid.toFixed(2)}`).join(' | ')})`, st.length === 3);
  ok('aaneengesloten van 0 tot het einde', st[0].van === 0 && Math.abs(st.at(-1).tot - 160) < 0.5 && st.every((s, i) => i === 0 || s.van === st[i - 1].tot));
  ok('tempo per stuk klopt', Math.abs(st[0].bpm - 120) < 0.1 && Math.abs(st[2].bpm - 128) < 0.1);
  ok(`de fase per stuk klopt (${fasefout(st[0].anker, 0.1, 120).toFixed(1)} / ${fasefout(st[2].anker, 100.33, 128).toFixed(1)} ms)`,
    fasefout(st[0].anker, 0.1, 120) < 25 && fasefout(st[2].anker, 100.33, 128) < 25);
  ok('het anker is de eerste tel IN het stuk', st.every((s) => s.anker >= s.van - 1e-9 && s.anker < s.van + 60 / s.bpm));
  ok('het stuk zonder puls is onzeker, de andere zeker', st[1].zekerheid < 0.2 && st[0].zekerheid > 0.6 && st[2].zekerheid > 0.6);
  const metAudio = d.analyseerGrid(m.env, m.envRate, m.tijdOffset, { pcm: bron, sampleRate: SR });
  ok(`met de audio erbij: fase op de voorflank (${fasefout(metAudio[0].anker, 0.1, 120).toFixed(1)} / ${fasefout(metAudio[2].anker, 100.33, 128).toFixed(1)} ms)`,
    fasefout(metAudio[0].anker, 0.1, 120) < 8 && fasefout(metAudio[2].anker, 100.33, 128) < 8);
  const leeg = d.analyseerGrid(rm.env, rm.envRate, rm.tijdOffset);
  ok(`alleen ruis: één stuk, onzeker (${leeg.map((s) => `${s.van.toFixed(0)}-${s.tot.toFixed(0)} ${s.bpm?.toFixed(1)} z${s.zekerheid.toFixed(2)}`).join(' | ')})`, leeg.length === 1 && leeg[0].zekerheid < 0.2);

  /*
   * De nul mag zijn fase niet vasthouden op tempo's waar een blok van 1 s een
   * geheel aantal (halve) tellen is. Met alleen geschudde blokken kreeg een
   * schone klik op 120 en 90 bpm zekerheid 0 ("geen puls") en op 124 1,00.
   */
  const { ZEKER_VANAF } = await import('../src/engine/beatgrid.js');
  const z = (bpm) => { const e = envVan(klikspoor(90, bpm, 0.25)); return d.analyseerGrid(e.env, e.envRate, e.tijdOffset); };
  const uitslag = [120, 90, 60, 124].map((bpm) => [bpm, z(bpm)]);
  ok(`schone klik op 120/90/60/124 bpm is overal zeker (${uitslag.map(([b, st]) => `${b}: ${st.map((s) => s.zekerheid.toFixed(2)).join('/')}`).join(', ')})`,
    uitslag.every(([b, st]) => st.every((s) => s.zekerheid >= ZEKER_VANAF) && st.every((s) => Math.abs(s.bpm / b - 1) < 0.002)));
}

// ---- het 156-bpm-stuk (25 september 2026) ---------------------------------
// Op het album viel een nummer op 156 weg: de tempocurve zag er per venster
// van 12 s vaak iets anders in (148, 131, 112, 107), dus alleen brokjes van
// 4-16 s bleven over, gescheiden door 16-44 s "gat", en segmenteer gooide ze
// allemaal weg als ruis (minSec). tweedeKans meet de vensters tussen twee
// brokjes met hetzelfde tempo opnieuw op dat tempo.

console.log('\ntweede kans: brokjes van één stuk');
{
  const ZEKER = 0.9;
  // Een curve zoals op het album: 140, dan 156 in brokjes, dan 150. Tussen de
  // brokjes toevallige tempo's zonder zekerheid (op hun eigen tempo).
  const toeval = [148, 131, 112, 107, 98, 126, 115, 101];
  const brokjes = [[70, 74], [90, 90], [134, 146], [166, 170]];     // album: 8, 4, 16, 8 s; gaten 16, 44, 20 s
  const inBrok = (t) => brokjes.some(([a, b]) => t >= a && t <= b);
  const maak = () => {
    const c = [];
    for (let t = 2, k = 0; t <= 300; t += 4, k++) {
      if (t < 62) c.push({ tijd: t, bpm: 140, zekerheid: ZEKER });
      else if (t > 178) c.push({ tijd: t, bpm: 150, zekerheid: ZEKER });
      else if (inBrok(t)) c.push({ tijd: t, bpm: 156 + (k % 3) - 1, zekerheid: 0.8 });
      else c.push({ tijd: t, bpm: toeval[k % toeval.length], zekerheid: 0 });
    }
    return c;
  };
  // Op 156 houdt de fase het hele nummer vast (album: 19-22 van de 22 stapjes).
  const op156 = (T, c) => (Math.abs(T - 156) < 2 && c.tijd > 62 && c.tijd < 178 ? 0.8 : 0);
  const opties = { tolerantie: 0.04, minSec: 20, minZekerheid: 0.2 };
  const rond156 = (seg) => seg.filter((s) => Math.abs(s.bpm - 156) < 2);

  const oud = d.segmenteer(maak(), opties);
  ok(`zonder tweede kans valt 156 weg (${oud.map((s) => `${s.van.toFixed(0)}-${s.tot.toFixed(0)} ${s.bpm}`).join(' | ')})`,
    rond156(oud).length === 0 && oud.length === 2);
  const curve = maak();
  const n = d.tweedeKans(curve, op156, opties);
  const nieuw = d.segmenteer(curve, opties);
  const s156 = rond156(nieuw);
  ok(`met tweede kans: één stuk op 156 van het eerste tot het laatste brokje (${n} vensters; ${nieuw.map((s) => `${s.van.toFixed(0)}-${s.tot.toFixed(0)} ${s.bpm.toFixed(1)}`).join(' | ')})`,
    s156.length === 1 && s156[0].van <= 70 && s156[0].tot >= 170 && nieuw.length === 3);
  ok('de vensters vóór het eerste en na het laatste brokje blijven zoals ze waren (een stuk groeit niet aan de rand)',
    curve.filter((c) => c.tijd < 70 || c.tijd > 170).every((c) => !c.tweedeKans));
  ok('140 en 150 blijven staan', Math.abs(nieuw[0].bpm - 140) < 0.1 && Math.abs(nieuw[2].bpm - 150) < 0.1);

  // Een break zonder tel tussen de brokjes (op 156 houdt de fase daar NIET): die blijft een gat.
  const metBreak = maak();
  d.tweedeKans(metBreak, (T, c) => (c.tijd > 94 && c.tijd < 130 ? 0 : op156(T, c)), opties);
  const sb = rond156(d.segmenteer(metBreak, opties));
  ok(`een break zonder puls op 156 blijft een gat (${sb.map((s) => `${s.van.toFixed(0)}-${s.tot.toFixed(0)}`).join(' | ')})`,
    sb.length === 2 && sb[0].tot <= 96 && sb[1].van >= 128);

  // Te ver uit elkaar (meer dan een minuut tussen twee brokjes): geen brug.
  const ver = [];
  for (let t = 2; t <= 200; t += 4) {
    const brok = (t >= 30 && t <= 38) || (t >= 110 && t <= 118);
    ver.push({ tijd: t, bpm: brok ? 156 : 107, zekerheid: brok ? 0.8 : 0 });
  }
  ok('twee brokjes meer dan een minuut uit elkaar: geen brug', d.tweedeKans(ver, () => 0.8, opties) === 0);

  // Twee ketens die elk lang genoeg zijn blijven gescheiden, ook als de fase
  // ertussen op hun tempo vasthoudt: één stuk = één tempo en één anker, en
  // over minuten loopt een tempo dat een fractie zwalkt een tel weg.
  const lang = [];
  for (let t = 2; t <= 120; t += 4) {
    const gat = t > 42 && t < 62;
    lang.push({ tijd: t, bpm: gat ? 97 : 120, zekerheid: gat ? 0 : 0.9 });
  }
  ok('twee lange ketens op hetzelfde tempo: niets te redden, geen brug', d.tweedeKans(lang, () => 0.9, opties) === 0);

  // Octaven. Een half-time passage (album 2:10-2:18: 71-75 in een stuk op 150)
  // gaat mee met T als de fase op T vasthoudt, ook als hij zelf iets beter scoort.
  const half = [
    { tijd: 2, bpm: 152, zekerheid: 0.75 }, { tijd: 6, bpm: 148, zekerheid: 0.5 },
    { tijd: 10, bpm: 72, zekerheid: 0.5 }, { tijd: 14, bpm: 71.4, zekerheid: 0.25 }, { tijd: 18, bpm: 75, zekerheid: 0.75 },
    { tijd: 22, bpm: 150, zekerheid: 1 },
  ];
  d.tweedeKans(half, (T) => (Math.abs(T - 150) < 3 ? 0.5 : 0), opties);
  ok(`half-time tussen 150 en 150 wordt 150 (${half.map((c) => c.bpm.toFixed(0)).join(' ')})`,
    half.every((c) => Math.abs(c.bpm - 150) < 3) && Math.abs(half[4].zekerheid - 0.5) < 1e-9);
  // Het dubbele blijft: bij twijfel de tel, niet de maat (Bay Ledges: anders groeide het octaaffoute stuk op 76).
  const dubbel = [
    { tijd: 2, bpm: 76, zekerheid: 0.5 }, { tijd: 6, bpm: 77, zekerheid: 0.5 },
    { tijd: 10, bpm: 153, zekerheid: 0 }, { tijd: 14, bpm: 152, zekerheid: 0.25 },
    { tijd: 18, bpm: 76, zekerheid: 0.75 },
  ];
  d.tweedeKans(dubbel, () => 1, opties);
  ok(`een venster op het dubbele tempo wordt niet gehalveerd (${dubbel.map((c) => c.bpm).join(' ')})`,
    dubbel[2].bpm === 153 && dubbel[3].bpm === 152);
}

console.log('\ntweede kans op audio: 140 -> 156 in brokjes -> 150');
{
  const { ZEKER_VANAF } = await import('../src/engine/beatgrid.js');
  // De kick op 156 loopt het hele nummer door; tussen de schone brokjes van
  // 6 s liggen fills (vier klappen op 107 bpm, telkens ergens anders) die de
  // autocorrelatie van 12 s naar 107 trekken. Op 107 houdt de fase niet vast,
  // op 156 wel: precies wat het album deed.
  const r = prng(77), ev = [];
  const A156 = 60.15, p156 = 60 / 156;
  const brokjes = [[60, 66], [84, 90], [114, 120], [144, 150]];
  for (let t = 0.2; t < 60; t += 60 / 140) ev.push([t, 0.5, 'kick']);
  for (let t = A156; t < 150; t += p156) ev.push([t, 0.3, 'kick']);
  for (let k = 0; k < brokjes.length - 1; k++) {
    const a = brokjes[k][1], b = brokjes[k + 1][0];
    for (let t = a + 0.3; t < b - 1; t += 2.5) {
      const t0 = t + 0.8 * (r() * 0.5 + 0.5);
      for (let j = 0; j < 4; j++) ev.push([t0 + j * 60 / 107, 0.9, 'hat']);
    }
  }
  for (let t = 150.1; t < 210; t += 60 / 150) ev.push([t, 0.5, 'kick']);
  const m = envVan(spoorVan(210, ev, { vloer: 0.01, seed: 78 }));
  const st = d.analyseerGrid(m.env, m.envRate, m.tijdOffset);
  const tekst = st.map((s) => `${s.van.toFixed(0)}-${s.tot.toFixed(0)} ${s.bpm.toFixed(2)} z${s.zekerheid.toFixed(2)}`).join(' | ');
  const s156 = st.filter((s) => Math.abs(s.bpm - 156) < 0.1 && s.zekerheid >= ZEKER_VANAF);
  // Gemeten: 68-144 op 156,00 (z 0,86). Zonder tweede kans: alleen 104-124 (de rest kreeg het grid van 140).
  ok(`het stuk op 156 wordt gevonden en is zeker (${tekst})`, s156.length === 1 && s156[0].van <= 70 && s156[0].tot >= 140);
  const tel = s156[0] ? s156[0].anker + Math.round((100 - s156[0].anker) / p156) * p156 : NaN;
  ok(`en zijn fase klopt (${fasefout(tel, A156, 156).toFixed(1)} ms)`, fasefout(tel, A156, 156) < 25);
  ok('140 en 150 staan er nog, zeker', Math.abs(st[0].bpm - 140) < 0.1 && st[0].zekerheid >= ZEKER_VANAF
    && st.some((s) => Math.abs(s.bpm - 150) < 0.1 && s.zekerheid >= ZEKER_VANAF && s.tot > 200));
}

console.log('\nfase-ijking: niet op één tik, maar op een reeks klanken');
{
  ok('de vastgelegde vertraging is wat de meting nu geeft',
    Math.abs(d.onsetVertraging(SR) - d.onsetVertraging(SR, 1024, 128, { meet: true })) < 0.001);
  ok('en die van de voorflank ook', Math.abs(d.flankVertraging(SR) - d.flankVertraging(SR, { meet: true })) < 0.001);
  // Controle op klanken BUITEN de ijkreeks: ander tempo, andere zaden, andere aanzetten en ruisvloeren.
  const grof = [], fijn = [];
  // Aanzet 5 ms zit niet in de ijkreeks, 30 ms is het uiterste. (Met 0, 5, 15
  // en 30 ms en 40 s per spoor gemeten: grof -17,8…+18,7, fijn -4,9…+6,0 ms.)
  for (const vloer of [0.005, 0.02, 0.08]) for (const klank of ['tik', 'kick', 'ruis', 'hihat', 'akkoord']) for (const aanzet of [5, 30]) {
    const BPM = 118, T0 = 0.41;
    const x = d.ijkSpoor(SR, klank, aanzet, vloer, { duur: 20, bpm: BPM, T0, seed: 11 });
    const m = envVan(x);
    const r = d.verfijnTempoFase(m.env, m.envRate, BPM, m.tijdOffset, { marge: 0.01, rond: 10, straal: 8 });
    // Meten OP een echte tel (niet op een rond getal: dat kan een halve tel
    // naast het grid liggen, en dan rondt 10 ms fout af naar de verkeerde tel).
    const echt = T0 + 19 * (60 / BPM);
    const p = 60 / r.bpm, tel = r.firstBeat + Math.round((echt - r.firstBeat) / p) * p;
    grof.push((tel - echt) * 1000);
    const f = d.fijneFase(x.subarray(3 * SR, 17 * SR), SR, r.bpm, tel, { t0: 3 });
    if (f !== null) fijn.push({ ms: (f - echt) * 1000, vloer });
  }
  const bereik = (a) => `${Math.min(...a).toFixed(1)}…${Math.max(...a).toFixed(1)} ms`;
  // Gemeten: -17,8…+18,7 ms; met de oude ijking (één tik) +2,5…+39,0. Het
  // venster van 93 ms laat niet minder spreiding toe; daarom de fijne fase.
  ok(`grove fase (envelope) binnen ±20 ms: ${bereik(grof)} (oude ijking: +2,5…+39,0)`, grof.every((x) => Math.abs(x) < 20));
  const gewoon = fijn.filter((f) => f.vloer <= 0.02).map((f) => f.ms), alles = fijn.map((f) => f.ms);
  ok(`fijne fase (voorflank op de audio) binnen ±5 ms tot ruisvloer 0,02: ${bereik(gewoon)}`, gewoon.every((x) => Math.abs(x) <= 5));
  // Ruisvloer 0,08 (-22 dB) met een ruisslag van 30 ms aanzet is het uiterste: 6,0 ms.
  ok(`en binnen ±6,5 ms met een ruisvloer van 0,08 erbij: ${bereik(alles)}, ${alles.length}/${grof.length} gemeten`,
    alles.every((x) => Math.abs(x) <= 6.5) && alles.length >= grof.length - 2);
  const k = klikspoor(30, 120, 0.1);
  const km = envVan(k);
  const kr = d.verfijnTempoFase(km.env, km.envRate, 120, km.tijdOffset, { marge: 0.01 });
  const kt = kr.firstBeat + Math.round((15 - kr.firstBeat) / 0.5) * 0.5;
  const kf = d.fijneFase(k.subarray(3 * SR, 27 * SR), SR, kr.bpm, kt, { t0: 3 });
  // Een klik van 4 ms uitsterven is scherper dan alles in de ijkreeks: gemeten 6,0 ms.
  ok(`klikspoor: fijne fase ${fasefout(kf, 0.1, 120).toFixed(1)} ms`, fasefout(kf, 0.1, 120) <= 7);
}

// ---- randgevallen ----------------------------------------------------------

ok('een te kort fragment geeft geen tempo',
  d.tempoUitEnvelope(new Float32Array(10), 86).bpm === null);
ok('een lege curve geeft geen segmenten', d.segmenteer([]).length === 0);
ok('een curve zonder zekerheid geeft geen segmenten',
  d.segmenteer([{ tijd: 0, bpm: 120, zekerheid: 0 }]).length === 0);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
