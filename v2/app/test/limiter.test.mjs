// De master-limiter (src/audio/limiter-kern.js en limiter-worklet.js, overgenomen
// uit v1): de kern zonder browser (plafond, true peak, onder het plafond bit voor
// bit door, aanval, release, gekoppeld, kapotte getallen, rekentijd, 0 GC) en de
// worklet in een nagebouwde AudioWorkletGlobalScope (dezelfde uitvoer, 0 GC, 'stop').
// Overgenomen uit v1 test/master.test.mjs @ 6a640ac, delen 1 en 2; ok(naam, voorwaarde)
// is hier een subtest met dezelfde naam.
// @alleen: afvalmeting (GCProfiler, 0 GC in de limiter; ook een rekentijdgrens op de wandklok)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';

/** De jonge ruimtes van V8: daar landt afval per blok. */
const JONG = ['new_space', 'new_large_object_space'];

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

/**
 * Elke check van v1 wordt een eigen subtest, met de naam (en de gemeten getallen)
 * van v1. Eerst verzameld, daarna gemeld: zo loopt er niets van de testrunner
 * door de afval- en tijdmetingen heen.
 */
const checker = () => {
  const lijst = [];
  const ok = (name, cond) => { lijst.push([name, !!cond]); };
  ok.meld = async (t) => { for (const [n, c] of lijst) await t.test(n, () => assert.ok(c, n)); };
  return ok;
};
const db = (x) => 20 * Math.log10(x);
/** Het kleinste getal in een (grote) array: Math.min(...x) loopt over de stack. */
const minVan = (x) => { let m = Infinity; for (const v of x) if (v < m) m = v; return m; };

const K = await import('../src/audio/limiter-kern.js');
const { LimiterKern, PLAFOND_DB, MARGE_DB, vertragingFrames, FIR_HALF } = K;
const SR = 48000, Q = 128;
const PLAFOND = Math.pow(10, PLAFOND_DB / 20);

/**
 * True peak zoals een goede meter hem meet: 16× oversampling met een lange
 * windowed sinc (48 tikken per kant). Alleen rond de luide stukken (een
 * tussenwaarde is hooguit een paar keer de buren, dus onder een kwart van
 * het plafond hoeft niet).
 */
function truePeak(x, os = 16, half = 48) {
  let max = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > max) max = Math.abs(x[i]);
  const tik = [];
  for (let p = 1; p < os; p++) {
    const mu = p / os, rij = new Float64Array(2 * half);
    let som = 0;
    for (let k = -half + 1; k <= half; k++) {
      const d = mu - k;
      const w = 0.42 + 0.5 * Math.cos(Math.PI * d / half) + 0.08 * Math.cos(2 * Math.PI * d / half);
      rij[k + half - 1] = Math.sin(Math.PI * d) / (Math.PI * d) * w;
      som += rij[k + half - 1];
    }
    for (let k = 0; k < rij.length; k++) rij[k] /= som;
    tik.push(rij);
  }
  for (let i = half; i < x.length - half; i++) {
    if (Math.abs(x[i]) < PLAFOND / 4 && Math.abs(x[i + 1]) < PLAFOND / 4) continue;
    for (const rij of tik) {
      let s = 0;
      for (let k = 0; k < rij.length; k++) s += x[i - half + 1 + k] * rij[k];
      if (Math.abs(s) > max) max = Math.abs(s);
    }
  }
  return max;
}

/** Een signaal (i -> [l, r]) door een verse kern, blok voor blok. */
function draai(sig, sec, opties) {
  const kern = new LimiterKern(SR, opties);
  const n = Math.round((sec * SR) / Q) * Q;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  for (let i = 0; i < n; i++) { const [l, r] = sig(i); inL[i] = l; inR[i] = r; }
  const uL = new Float32Array(n), uR = new Float32Array(n), G = new Float32Array(n);
  for (let b = 0; b < n; b += Q) {
    kern.render(inL.subarray(b, b + Q), inR.subarray(b, b + Q), uL.subarray(b, b + Q), uR.subarray(b, b + Q), G.subarray(b, b + Q), Q);
  }
  return { kern, inL, inR, uL, uR, G, n };
}

// Muziek-achtig: een kick van 55 Hz op 120 bpm (met een pitch-val van 165
// naar 55 Hz) die tot +6 dB gaat, een akkoord, en hihat-ruis op de achtsten
// (energie tot de Nyquist).
const muziek = (hard = 1.5) => {
  let zaad = 20261005;
  const rnd = () => ((zaad = (Math.imul(zaad, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5);
  return (i) => {
    const t = i / SR, tel = (t * 2) % 1, sinds = tel / 2;   // seconden sinds de tel
    const kick = Math.exp(-tel * 30) * Math.sin(2 * Math.PI * 55 * (sinds + (2 / 20) * (1 - Math.exp(-20 * sinds))));
    const akkoord = 0.25 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t));
    const hat = rnd() * 0.3 * Math.exp(-((t * 4) % 1) * 50);
    const x = hard * kick + akkoord + hat;
    return [x, 0.9 * x];
  };
};


test('de kern: plafond, true peak, onder het plafond bit voor bit door, aanval, release, gekoppeld, kapotte getallen, rekentijd, 0 GC', async (t) => {
  const ok = checker();
  const N = vertragingFrames(SR);
  ok(`vooruitblik 1,5 ms = ${N} samples op 48 kHz (vertraging), waarvan ${FIR_HALF} voor de interpolator`, N === 72 && new LimiterKern(SR).L === 72 - FIR_HALF);

  // a. Een tik onder het plafond: precies N samples later, precies even groot.
  const tik = draai((i) => (i === 1000 ? [0.1, -0.2] : [0, 0]), 0.1);
  const waar = tik.uL.findIndex((v) => v !== 0);
  ok(`een tik komt precies ${N} samples later naar buiten, onveranderd (L 0,1, R −0,2)`,
    waar === 1000 + N && tik.uL[waar] === Math.fround(0.1) && tik.uR[waar] === Math.fround(-0.2)
    && tik.uL.filter((v) => v !== 0).length === 1 && tik.G.every((g) => g === 1));

  // b. Stationair onder het plafond: GEEN gain reduction, bit voor bit de invoer.
  const zacht = draai((i) => {
    const t = i / SR;
    const x = 0.45 * Math.sin(2 * Math.PI * 61 * t) + 0.3 * Math.sin(2 * Math.PI * 997 * t) + 0.08 * Math.sin(2 * Math.PI * 9100 * t);
    return [x, -x];
  }, 10);
  let piekIn = 0, verschil = 0, nietEen = 0;
  for (let i = 0; i < zacht.n; i++) {
    piekIn = Math.max(piekIn, Math.abs(zacht.inL[i]));
    if (i >= N && (zacht.uL[i] !== zacht.inL[i - N] || zacht.uR[i] !== zacht.inR[i - N])) verschil++;
    if (zacht.G[i] !== 1) nietEen++;
  }
  ok(`stationair onder het plafond (piek ${db(piekIn).toFixed(1)} dBFS, 10 s): gain precies 1 in elke sample, 0 dB gain reduction — geen pompen`,
    nietEen === 0 && zacht.kern.minGain === 1 && piekIn > 0.7);
  ok('… en de uitvoer is bit voor bit de invoer, N samples later', verschil === 0);

  // c. Pieken tot +6 dB: geen sample en geen tussenwaarde boven −1 dBFS.
  const luid = draai(muziek(), 3);
  let piekLuid = 0;
  for (let i = 0; i < luid.n; i++) piekLuid = Math.max(piekLuid, Math.abs(luid.inL[i]));
  let sp = 0;
  for (let i = 0; i < luid.n; i++) sp = Math.max(sp, Math.abs(luid.uL[i]), Math.abs(luid.uR[i]));
  const tp = Math.max(truePeak(luid.uL), truePeak(luid.uR));
  const grMax = db(minVan(luid.G));
  ok(`muziek met pieken tot +${db(piekLuid).toFixed(1)} dB: sample-piek ${db(sp).toFixed(2)} dBFS, true peak (16×) ${db(tp).toFixed(3)} dBTP ≤ −1`,
    piekLuid >= 2 && sp <= PLAFOND && tp <= PLAFOND);
  ok(`… hij werkt echt (gain reduction tot ${grMax.toFixed(1)} dB) en het vangnet klemde niets (${luid.kern.geklemd})`, grMax < -6 && luid.kern.geklemd === 0);

  // Zuivere tonen tot 15 kHz op +6 dB (daar mist een 4×-raster het meest).
  let slechtste = -Infinity;
  for (const hz of [1000, 5000, 12000, 15000]) {
    const r = draai((i) => { const x = 2 * Math.sin(2 * Math.PI * hz * i / SR + 0.3); return [x, x]; }, 0.6);
    slechtste = Math.max(slechtste, db(truePeak(r.uL.subarray(SR * 0.2))));
  }
  ok(`tonen van 1, 5, 12 en 15 kHz op +6 dB: true peak hooguit ${slechtste.toFixed(3)} dBTP (≤ −1; de marge is ${MARGE_DB} dB)`, slechtste <= PLAFOND_DB);

  // d. Eén piek: de gain zakt glad (in L samples) en staat er op tijd.
  const piekBij = 24000;
  const een = draai((i) => {
    const x = 0.3 * Math.sin(2 * Math.PI * 200 * i / SR) + (i >= piekBij && i < piekBij + 480 ? 1.7 * Math.sin(2 * Math.PI * 1000 * (i - piekBij) / SR) : 0);
    return [x, x];
  }, 2);
  let stap = 0;
  for (let i = 1; i < een.n; i++) stap = Math.max(stap, Math.abs(een.G[i] - een.G[i - 1]));
  const gMin = minVan(een.G);
  const eersteDaling = een.G.findIndex((g) => g < 1);
  ok(`aanval: de gain begint ${piekBij + N - eersteDaling} samples vóór de piek naar buiten komt te zakken (de vooruitblik), grootste stap per sample ${stap.toFixed(4)} (geen tik)`,
    eersteDaling > piekBij && eersteDaling <= piekBij + N && stap < (1 - gMin) / (een.kern.L - 4));
  // e. Release: 80 ms, glad terug, geen pompen. De envelop komt lineair terug
  // (1 − gain valt met e^(−t/80 ms)), dus in dB eerst snel en dan zacht.
  const naPiek = piekBij + 480 + N;
  const gNa = (ms) => een.G[naPiek + Math.round(ms * SR / 1000)];
  let stijgt = true;
  for (let i = naPiek + een.kern.W; i < een.n; i++) if (een.G[i] < een.G[i - 1]) stijgt = false;
  const verwacht80 = 1 - (1 - gMin) * Math.exp(-1);
  ok(`release: na de piek (${db(gMin).toFixed(1)} dB) alleen nog omhoog, niets dat terugzakt`, stijgt);
  ok(`… na 80 ms ${db(gNa(80)).toFixed(2)} dB (verwacht ${db(verwacht80).toFixed(2)}: één tijdconstante), na 400 ms ${db(gNa(400)).toFixed(3)} dB, na 1 s 0`,
    Math.abs(gNa(80) - verwacht80) < 0.02 && db(gNa(400)) > -0.05 && gNa(1000) > 0.99999);

  // f. Stereo gekoppeld: rechts krijgt dezelfde gain als links, ook als rechts zacht is.
  const st = draai((i) => [1.8 * Math.sin(2 * Math.PI * 100 * i / SR), 0.1 * Math.sin(2 * Math.PI * 330 * i / SR)], 0.5);
  let afwijking = 0;
  for (let i = N; i < st.n; i++) if (Math.abs(st.inR[i - N]) > 0.01) afwijking = Math.max(afwijking, Math.abs(st.uR[i] / st.inR[i - N] - st.G[i]));
  ok(`stereo gekoppeld: rechts (−20 dB) krijgt de gain van links (+5 dB), afwijking ${afwijking.toExponential(1)}`, afwijking < 1e-6 && minVan(st.G) < 0.5);

  // g. Kapotte getallen van verderop: nul, en de rest gaat door.
  const kapot = draai((i) => (i === 500 ? [NaN, Infinity] : i === 501 ? [-Infinity, 1e300] : [0.2, 0.2]), 0.1);
  ok('NaN en ±Infinity in de invoer worden stilte: alles eindig, de rest onveranderd',
    [...kapot.uL, ...kapot.uR].every(Number.isFinite) && kapot.uL[500 + N] === 0 && kapot.uR[501 + N] === 0 && kapot.uL[600 + N] === Math.fround(0.2));

  // Een ander plafond en een andere sampleRate (de context kan op 44,1 kHz staan).
  const k44 = new LimiterKern(44100, { plafondDb: -3 });
  ok('44,1 kHz: vooruitblik 66 samples (1,5 ms), plafond −3 dB', k44.N === 66 && Math.abs(db(k44.plafond) + 3) < 1e-9);

  // h. Rekentijd: een blok van 128 frames, luid (de interpolator rekent dan elke sample).
  const blokken = 3000;
  const bron = muziek(1.6);
  const pakket = Array.from({ length: 64 }, (_, b) => { const a = new Float32Array(Q); for (let i = 0; i < Q; i++) a[i] = bron(b * Q + i)[0]; return a; });
  const kt = new LimiterKern(SR), oL = new Float32Array(Q), oR = new Float32Array(Q), oG = new Float32Array(Q);
  for (let b = 0; b < 2000; b++) kt.render(pakket[b & 63], pakket[b & 63], oL, oR, oG, Q);
  let besteMs = Infinity;
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    for (let b = 0; b < blokken; b++) kt.render(pakket[b & 63], pakket[b & 63], oL, oR, oG, Q);
    besteMs = Math.min(besteMs, (performance.now() - t0) / blokken);
  }
  ok(`rekentijd per blok, luid: ${(besteMs * 1000).toFixed(1)} µs (< 500 µs van de 2,67 ms; beste van 3)`, besteMs < 0.5);

  // i. Afval: zoals renderblok.test, na opwarmen, het schoonste venster.
  // Gemeten in de JONGE ruimte (new_space, plus new_large_object_space voor een grote array),
  // min een leeg venster (wat het meten zelf kost): daar landt afval per blok. heapUsed telde ook
  // gecompileerde code (V8 die de meetlus opnieuw compileert: rood zonder één byte afval) en het
  // opruimen van de oude ruimte na gc() (tot -194 kB: een min die echt afval kon verbergen).
  // 7 okt, zie instrumenten-fm-schaal.test. JONG staat bovenaan (ook voor de worklet hieronder).
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  const venster = (n = 12000) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    for (let b = 0; b < n; b++) kt.render(pakket[b & 63], pakket[(b + 7) & 63], oL, oR, oG, Q);
    const j1 = jong();
    return { bytes: j1 - j0 - (n ? leeg : 0), gcs: prof.stop().statistics.length };
  };
  const leeg = venster(0).bytes;
  let beste = null;
  for (let i = 0; i < 30; i++) {
    const w = venster();
    if (!beste || w.gcs < beste.gcs || (w.gcs === beste.gcs && w.bytes < beste.bytes)) beste = w;
    if (w.gcs === 0 && w.bytes < 1024) break;
  }
  ok(`geen afval: 12 000 blokken, ${beste.gcs} GC, ${beste.bytes} bytes in de jonge ruimte`, beste.gcs === 0 && beste.bytes < 1024);
  await ok.meld(t);
});

test("de worklet: registreert 'varve-limiter', geeft wat de kern geeft, mono, zonder verbinding, 0 GC, 'stop'", async (t) => {
  const ok = checker();
  let Klasse = null, naam = null;
  globalThis.sampleRate = SR;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
  globalThis.registerProcessor = (n, k) => { naam = n; Klasse = k; };
  await import('../src/audio/limiter-worklet.js');
  ok('registreert "varve-limiter"', naam === 'varve-limiter' && typeof Klasse === 'function');
  const p = new Klasse({ processorOptions: { plafondDb: -1, vooruit: 0.0015, release: 0.08, margeDb: MARGE_DB } });
  const kern = new LimiterKern(SR);
  const bron = muziek();
  const L = new Float32Array(Q), R = new Float32Array(Q);
  const uit = [[new Float32Array(Q), new Float32Array(Q)], [new Float32Array(Q)]];
  const kL = new Float32Array(Q), kR = new Float32Array(Q), kG = new Float32Array(Q);
  let gelijk = true, door = true;
  for (let b = 0; b < 400; b++) {
    for (let i = 0; i < Q; i++) { const [l, r] = bron(b * Q + i); L[i] = l; R[i] = r; }
    door = p.process([[L, R]], uit) === true && door;
    kern.render(L, R, kL, kR, kG, Q);
    for (let i = 0; i < Q; i++) if (uit[0][0][i] !== kL[i] || uit[0][1][i] !== kR[i] || uit[1][0][i] !== kG[i]) gelijk = false;
  }
  ok('uitgang 0 = het geluid, uitgang 1 = de gain: sample voor sample wat de kern geeft; process() blijft true', gelijk && door);

  const mono = new Klasse({ processorOptions: {} });
  const mUit = [[new Float32Array(Q), new Float32Array(Q)], [new Float32Array(Q)]];
  for (let b = 0; b < 4; b++) mono.process([[new Float32Array(Q).fill(0.25)]], mUit);
  ok('mono invoer: links en rechts hetzelfde', mUit[0][0][Q - 1] === Math.fround(0.25) && mUit[0][1][Q - 1] === Math.fround(0.25));
  const los = new Klasse({ processorOptions: {} });
  let gooide = false;
  try { for (let b = 0; b < 4; b++) los.process([[]], mUit); } catch (_) { gooide = true; }
  ok('zonder verbinding (lege invoer): stilte, en hij gooit niet', !gooide && mUit[0][0].every((v) => v === 0) && mUit[1][0].every((v) => v === 1));

  // Afval in process() zelf (de kern plus wat de worklet eromheen doet).
  const pakket = Array.from({ length: 32 }, (_, b) => { const a = new Float32Array(Q); for (let i = 0; i < Q; i++) a[i] = bron(b * Q + i)[0]; return a; });
  const invoer = pakket.map((a, b) => [[a, pakket[(b + 3) & 31]]]);
  for (let b = 0; b < 3000; b++) p.process(invoer[b & 31], uit);
  // Zoals hierboven: de jonge ruimte, min een leeg venster.
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  const venster = (n = 12000) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    for (let b = 0; b < n; b++) p.process(invoer[b & 31], uit);
    const j1 = jong();
    return { bytes: j1 - j0 - (n ? leeg : 0), gcs: prof.stop().statistics.length };
  };
  const leeg = venster(0).bytes;
  let beste = null;
  for (let i = 0; i < 30; i++) {
    const w = venster();
    if (!beste || w.gcs < beste.gcs || (w.gcs === beste.gcs && w.bytes < beste.bytes)) beste = w;
    if (w.gcs === 0 && w.bytes < 1024) break;
  }
  ok(`de worklet: 12 000 blokken, ${beste.gcs} GC, ${beste.bytes} bytes in de jonge ruimte`, beste.gcs === 0 && beste.bytes < 1024);
  // 'stop' (zoals fx-worklet.js): daarna false, zodat de browser hem mag opruimen.
  p.port.onmessage({ data: 'stop' });
  ok("na 'stop' geeft process() false en luistert hij niet meer", p.process(invoer[0], uit) === false && p.port.onmessage === null);
  delete globalThis.AudioWorkletProcessor;
  delete globalThis.registerProcessor;
  await ok.meld(t);
});
