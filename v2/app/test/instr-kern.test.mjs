// De rekenkern van de Klankschaal zonder browser (src/audio/instrumenten/schaal-kern.js op
// klankschaal-kern.js) en zijn worklet in een nagebouwde AudioWorkletGlobalScope: toonhoogte
// gemeten (Goertzel), berichten op hun sample, omstemmen houdt de amplitude, slapen tot exact
// stil, meeklinken, wrijven, de rij, 0 GC per blok, 'stop'. Overgenomen uit v1
// test/instrumenten-fm-schaal.test.mjs delen 3 en 4.
// @alleen: afvalmeting (GCProfiler, 0 GC) en een rekentijdgrens op de wandklok
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const { SchaalInstrumentKern, NOOTVELDEN, VELD_STEM, VELD0, LIJF, RIJ } = await import('../src/audio/instrumenten/schaal-kern.js');

const FS = 48000, BLOK = 128;
const cent = (a, b) => 1200 * Math.log2(a / b);
const bijna = (a, b, eps) => Math.abs(a - b) <= eps;

function speel(kern, sec, { t = 0, opvang = null } = {}) {
  const L = new Float32Array(BLOK), R = new Float32Array(BLOK);
  const blokken = Math.round((sec * FS) / BLOK);
  let piek = 0, som = 0, eindig = true;
  for (let b = 0; b < blokken; b++) {
    kern.t0 = t + (b * BLOK) / FS;
    kern.blok(L, R, BLOK);
    for (let i = 0; i < BLOK; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) eindig = false;
      piek = Math.max(piek, Math.abs(L[i]), Math.abs(R[i]));
      som += L[i] * L[i];
      if (opvang) opvang.push(L[i]);
    }
  }
  return { piek, rms: Math.sqrt(som / (blokken * BLOK)), eindig, eind: t + (blokken * BLOK) / FS };
}
function goertzel(x, f) {
  const w = (2 * Math.PI * f) / FS, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    const s0 = x[i] * hann + c * s1 - s2; s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}
/** De sterkste toon binnen ± 1 halve toon rond `rond`, per 0,2 cent. */
function toonhoogte(x, rond) {
  let beste = rond, max = -1;
  for (let c = -100; c <= 100; c += 0.2) { const f = rond * Math.pow(2, c / 1200); const p = goertzel(x, f); if (p > max) { max = p; beste = f; } }
  return beste;
}
const slagVan = (j, hz, extra = {}) => ({ t: 'slag', v: VELD_STEM[j], j, hz, pan: 0, a: [0.6, 0.6, 0.3, 0.15], ms: 3, pe: 0, lijf: 0.05, ...extra });

test('kern: 53 modi, stil en slapend; een slag op zijn sample; A4 op 440 Hz (Goertzel)', () => {
  const k = new SchaalInstrumentKern(FS);
  assert.ok(k.n === 53 && LIJF === 52 && VELD0 === 12 && speel(k, 0.05).piek === 0 && k.slaapt);
  const a = new SchaalInstrumentKern(FS);
  a.bericht({ t: 'opt', fric: 1, org: 0 }, 0);
  a.bericht(slagVan(0, 440, { tijd: 0.01 }), 0);
  const x = [];
  speel(a, 1.5, { opvang: x });
  assert.equal(x.findIndex((v) => v !== 0), 480, 'een slag op t = 0,01 s begint op sample 480 (niet op het blok)');
  const f = toonhoogte(Float64Array.from(x.slice(9600, 9600 + 48000)), 440);
  assert.ok(Math.abs(cent(f, 440)) <= 0.5, `A4 gemeten ${cent(f, 440).toFixed(2)} ct`);
  const b = new SchaalInstrumentKern(FS);
  b.bericht(slagVan(1, 660, { tijd: 0.02 }), 0);
  b.bericht(slagVan(0, 440, { tijd: 0.005 }), 0);
  const xb = [];
  speel(b, 0.05, { opvang: xb });
  assert.ok(xb.findIndex((v) => v !== 0) === 240 && b.veldHz[0] === 440 && b.veldHz[1] === 660, 'op volgorde van tijd, niet van aankomst');
});

test('kern: met drift en glijder op toon (C2…C7), elke MIDI-noot klinkt, buigen en fijn', (t) => {
  let ergste = 0;
  for (const midi of [36, 60, 69, 84, 96]) {
    const kk = new SchaalInstrumentKern(FS);
    kk.bericht({ t: 'opt', fric: 1, org: 1 }, 0);
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    kk.bericht(slagVan(2, hz, { pe: 3 }), 0);
    const xx = [];
    speel(kk, 1.5, { opvang: xx });
    ergste = Math.max(ergste, Math.abs(cent(toonhoogte(Float64Array.from(xx.slice(14400, 14400 + 48000)), hz), hz)));
  }
  t.diagnostic(`ergste afwijking met drift en glijder: ${ergste.toFixed(2)} ct`);
  assert.ok(ergste <= 2, `binnen 2 cent (ergste ${ergste.toFixed(2)} ct)`);
  const stom = [];
  let raar = false;
  const ka = new SchaalInstrumentKern(FS);
  for (let midi = 0; midi < 128; midi++) {
    ka.bericht({ t: 'stil' }, 0);
    ka.bericht(slagVan(midi % NOOTVELDEN, 440 * Math.pow(2, (midi - 69) / 12), { lijf: 0 }), 0);
    const r = speel(ka, 0.1);
    if (!(r.piek > 1e-3)) stom.push(midi);
    if (!r.eindig || r.piek > 1) raar = true;
  }
  assert.deepEqual(stom, [], 'elke MIDI-noot 0..127 klinkt');
  assert.ok(!raar, 'eindig en binnen ±1');
  const kb = new SchaalInstrumentKern(FS);
  kb.bericht({ t: 'opt', fric: 1, org: 0 }, 0);
  kb.bericht(slagVan(0, 440), 0);
  speel(kb, 0.2);
  const kernW = kb.w0[0];
  kb.bericht({ t: 'buig', c: 200 }, 0.2);
  const xbg = [];
  speel(kb, 1, { t: 0.2, opvang: xbg });
  const fb = toonhoogte(Float64Array.from(xbg.slice(2400)), 493.88);
  assert.ok(Math.abs(cent(fb, 440) - 200) <= 1 && kb.w0[0] === kernW, `buig +200 ct: het veld naar B4 (${cent(fb, 440).toFixed(1)} ct), de kern niet`);
  kb.bericht({ t: 'buig', c: 0 }, 1.2);
  kb.bericht({ t: 'param', fijn: 20 }, 1.2);
  speel(kb, 0.01, { t: 1.2 });
  assert.ok(bijna(cent(kb.w0[VELD0] / ((2 * Math.PI) / FS), 440), 20, 1e-6) && bijna(kb.w0[0] / kernW, Math.pow(2, 20 / 1200), 1e-9), 'fijn: velden én kern');
});

test('kern: een klinkend veld omstemmen houdt de amplitude (zonder: × 7,8 harder)', () => {
  const amp = (k, i) => { const w = k.w0[i], s = k.y1[i], c = (s * Math.cos(w) - k.y2[i]) / Math.sin(w); return Math.hypot(s, c); };
  for (const [van, naar] of [[2093, 55], [55, 2093], [440, 466.16], [8.18, 12543]]) {
    const ko = new SchaalInstrumentKern(FS);
    ko.bericht({ t: 'opt', fric: 1, org: 0 }, 0);
    ko.bericht(slagVan(0, van, { a: [0.5, 0, 0, 0], lijf: 0 }), 0);
    const r0 = speel(ko, 0.3);
    const a0 = amp(ko, VELD0), y0 = ko.y1[VELD0];
    ko.bericht(slagVan(0, naar, { a: [0, 0, 0, 0], lijf: 0 }), r0.eind);
    speel(ko, BLOK / FS, { t: r0.eind });
    const a1 = amp(ko, VELD0);
    assert.ok(a1 / a0 > 0.95 && a1 / a0 <= 1.0001 && Math.abs(y0) > 0, `${van} → ${naar} Hz: × ${(a1 / a0).toFixed(3)}`);
  }
});

test('kern: loslaten tot exact stil, vrij uitklinken, stil(), meeklinken, wrijven, de rij', () => {
  const kl = new SchaalInstrumentKern(FS);
  kl.bericht(slagVan(0, 440), 0);
  speel(kl, 0.5);
  kl.bericht({ t: 'los', j: 0, t60: 0.3 }, 0.5);
  kl.bericht({ t: 'kernlos', t60: 0.3 }, 0.5);
  const na = speel(kl, 3, { t: 0.5 });
  assert.ok(kl.slaapt && speel(kl, 0.2, { t: na.eind }).piek === 0, 'binnen 3 s slaapt hij en is het exact stil');
  const kv = new SchaalInstrumentKern(FS);
  kv.bericht(slagVan(0, 440), 0);
  speel(kv, 3);
  assert.ok(!kv.slaapt && speel(kv, 0.2, { t: 3 }).piek > 1e-4, 'zonder loslaten klinkt hij na 3 s nog (handpan)');
  kv.bericht(slagVan(1, 330, { tijd: 3.5 }), 3.2);
  kv.bericht({ t: 'stil', tijd: 3.3 }, 3.2);
  const xs = [];
  speel(kv, 0.5, { t: 3.2, opvang: xs });
  assert.ok(xs.slice(Math.round(0.1 * FS) + 1).every((v) => v === 0) && kv.slaapt && kv.rijN === 0, 'stil: exact nul vanaf zijn sample, de rij leeg');
  const km = new SchaalInstrumentKern(FS);
  km.bericht(slagVan(0, km.kernHz), 0);
  speel(km, 0.01);
  assert.ok(Math.abs(km.y1[0]) + Math.abs(km.y2[0]) > 1e-4, 'een noot op de grondtoon van de kern laat de kern meeklinken');
  const kn = new SchaalInstrumentKern(FS);
  kn.bericht(slagVan(0, km.kernHz * Math.pow(2, 6 / 12)), 0);
  speel(kn, 0.01);
  assert.ok(Math.abs(kn.y1[0]) + Math.abs(kn.y2[0]) < 1e-12, 'een tritonus erboven niet');
  const kw = new SchaalInstrumentKern(FS);
  kw.bericht({ t: 'wrijf', p: 0.48, r: 1.1 }, 0);
  speel(kw, 3);
  const zingt = speel(kw, 1, { t: 3 });
  assert.ok(zingt.rms > 0.01 && zingt.eindig, `wrijven: na 3 s zingt de kern (rms ${zingt.rms.toFixed(3)})`);
  const kr = new SchaalInstrumentKern(FS);
  for (let i = 0; i < RIJ + 100; i++) kr.bericht(slagVan(i % NOOTVELDEN, 200 + i, { tijd: 5 + i * 0.001 }), 0);
  assert.equal(kr.rijN, RIJ, 'rij vol: het vroegste gaat meteen in, niets gooit');
});

test("worklet: registreert 'varve-schaal-instrument', berichten op hun sample, 0 GC per blok, 'stop'", async (t) => {
  let Klasse = null, naam = null;
  globalThis.sampleRate = FS;
  globalThis.currentFrame = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
  globalThis.registerProcessor = (n, k) => { naam = n; Klasse = k; };
  await import('../src/audio/instrumenten/schaal-worklet.js');
  assert.ok(naam === 'varve-schaal-instrument' && typeof Klasse === 'function');
  const proc = new Klasse();
  const uit = [[new Float32Array(BLOK), new Float32Array(BLOK)]], IN = [];
  let frame = 0;
  const draai = (n) => { for (let b = 0; b < n; b++) { globalThis.currentFrame = frame; proc.process(IN, uit); frame += BLOK; } };
  const stuur = (d) => proc.port.onmessage({ data: d });
  stuur({ t: 'opt', fric: 1, org: 1 });
  stuur({ t: 'param', karakter: 0.1, uitklank: 1, klank: 0, fijn: 0 });
  stuur({ t: 'kern', hz: 146.83 });
  stuur(slagVan(0, 440, { tijd: 0.0105 }));
  draai(4);
  assert.ok(uit[0][0][119] === 0 && uit[0][0][120] !== 0, 'bericht met tijd: blok 3, sample 504 − 384 = 120');

  stuur({ t: 'wrijf', p: 0.5, r: 1.1 });
  for (let j = 0; j < NOOTVELDEN; j++) stuur(slagVan(j, 200 + 37 * j));
  draai(3000);
  const SLAGEN = Array.from({ length: NOOTVELDEN }, (_, j) => slagVan(j, 300 + 29 * j, { tijd: 0 }));
  // Gemeten in de JONGE ruimte, min een leeg venster (wat het meten zelf kost): daar landt afval per blok.
  const JONG = ['new_space', 'new_large_object_space'];
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  let leeg = 0;
  const venster = (metNoten, n = 3000) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    let noten = 0;
    for (let b = 0; b < n; b++) {
      globalThis.currentFrame = frame;
      if (metNoten && b % 25 === 0) { const s = SLAGEN[noten++ % NOOTVELDEN]; s.tijd = (frame + 48) / FS; stuur(s); }
      proc.process(IN, uit); frame += BLOK;
    }
    const j1 = jong();
    return { bytes: j1 - j0 - (n ? leeg : 0), gcs: prof.stop().statistics.length, noten };
  };
  leeg = venster(false, 0).bytes;
  const beste = (metNoten) => {
    let b = null;
    for (let i = 0; i < 6; i++) { const w = venster(metNoten); if (!b || w.gcs < b.gcs || (w.gcs === b.gcs && w.bytes < b.bytes)) b = w; if (w.gcs === 0 && w.bytes < 4096) break; }
    return b;
  };
  const zonder = beste(false);
  assert.ok(zonder.gcs === 0 && zonder.bytes < 16 * 1024, `3000 blokken (tien velden en wrijven): ${zonder.gcs} GC, ${zonder.bytes} bytes`);
  const met = beste(true);
  const perNoot = Math.max(0, met.bytes - zonder.bytes) / met.noten;
  assert.ok(met.gcs === 0 && perNoot < 4096, `met ${met.noten} noten: ${met.gcs} GC, ~${Math.round(perNoot)} bytes per noot (per bericht)`);
  let besteMs = Infinity;
  for (let r = 0; r < 3; r++) { const t0 = performance.now(); draai(2000); besteMs = Math.min(besteMs, (performance.now() - t0) / 2000); }
  t.diagnostic(`zonder noten ${zonder.gcs} GC, ${zonder.bytes} B; met ${met.noten} noten ${met.gcs} GC, ~${Math.round(perNoot)} B per noot; ${besteMs.toFixed(3)} ms per blok`);
  assert.ok(besteMs < 1, `rekentijd per blok ${besteMs.toFixed(3)} ms (< 1 ms van 2,67)`);
  assert.equal(proc.process(IN, uit), true);
  stuur({ t: 'stop' });
  assert.ok(proc.process(IN, uit) === false && proc.port.onmessage === null, "na { t: 'stop' }: false, geen berichten meer");
});
