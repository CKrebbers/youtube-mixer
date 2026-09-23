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
ok(`tempo binnen 0,1 bpm (slechtste ${ergsteBpm.toFixed(3)})`, ergsteBpm < 0.1);
ok(`fase binnen 15 ms (slechtste ${ergsteFase.toFixed(1)} ms)`, ergsteFase < 15);

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

// ---- randgevallen ----------------------------------------------------------

ok('een te kort fragment geeft geen tempo',
  d.tempoUitEnvelope(new Float32Array(10), 86).bpm === null);
ok('een lege curve geeft geen segmenten', d.segmenteer([]).length === 0);
ok('een curve zonder zekerheid geeft geen segmenten',
  d.segmenteer([{ tijd: 0, bpm: 120, zekerheid: 0 }]).length === 0);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
