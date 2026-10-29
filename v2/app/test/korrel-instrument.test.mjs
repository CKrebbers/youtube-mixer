// De korrelwolk als instrument (src/audio/instrumenten/korrel-kern.js, korrel.js): toonhoogte, bron,
// loslaten, geen afval; en vangen + de grondnoot (engine/acties-gebaren.js).
// @alleen: afvalmeting (GCProfiler, 0 GC)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { KorrelInstrumentKern, STEMMEN } from '../src/audio/instrumenten/korrel-kern.js';
import { pcmNaarBron, scanVan, grootteVan } from '../src/audio/instrumenten/korrel.js';
import { grondVan } from '../src/engine/acties-gebaren.js';

if (typeof globalThis.gc !== 'function') { v8.setFlagsFromString('--expose-gc'); globalThis.gc = vm.runInNewContext('gc'); }
const SR = 48000, B = 128;

/** Een sinusbron van f Hz, grondnoot `grond`. */
function sinusBron(k, f, grond = 60, s = 2) {
  const n = SR * s, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = R[i] = Math.sin((2 * Math.PI * f * i) / SR) * 0.6;
  k.bericht({ t: 'bron', L, R, n, grond });
}
function render(k, s) {
  const L = new Float32Array(B), R = new Float32Array(B), uit = [];
  for (let b = 0; b < (SR * s) / B; b++) { k.t0 = (b * B) / SR; k.blok(L, R, B); uit.push(...L); }
  return uit;
}
/** De toonhoogte uit de nuldoorgangen (zuiver genoeg met korrels zonder spreiding). */
function toonhoogte(x) {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (x.length / SR);
}

test('toonhoogte: de grondnoot speelt de bron op zijn eigen toon, een octaaf hoger op het dubbele', () => {
  for (const [noot, verwacht] of [[60, 440], [72, 880], [55, 440 * Math.pow(2, -5 / 12)]]) {
    const k = new KorrelInstrumentKern(SR, 3);
    sinusBron(k, 440, 60);
    k.bericht({ t: 'param', grootte: 0.2, dichtheid: 30, scan: 0, toon: 0, spray: 0, breedte: 0, aanzet: 0.005, loslaten: 0.3, positie: 0.3 });
    k.bericht({ t: 'aan', stem: 0, rate: Math.pow(2, (noot - 60) / 12), v: 1, tijd: 0 });
    const x = render(k, 1).slice(SR * 0.3);
    const f = toonhoogte(x);
    assert.ok(Math.abs(f / verwacht - 1) < 0.03, `noot ${noot}: ${f.toFixed(0)} Hz, verwacht ${verwacht.toFixed(0)}`);
  }
});

test('stemmen: stil tot een noot, loslaten sterft uit, stil wist alles; eindig en niet te luid', () => {
  const k = new KorrelInstrumentKern(SR, 4);
  const voor = render(k, 0.2);
  assert.equal(voor.reduce((a, v) => Math.max(a, Math.abs(v)), 0), 0, 'zonder noot: stil');
  for (let s = 0; s < STEMMEN; s++) k.bericht({ t: 'aan', stem: s, rate: Math.pow(2, s / 12), v: 1, tijd: 0.2 });
  const vol = render(k, 1);
  assert.ok(vol.every(Number.isFinite));
  const piek = vol.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  assert.ok(piek > 0.05 && piek < 1.5, `piek ${piek}`);
  for (let s = 0; s < STEMMEN; s++) k.bericht({ t: 'uit', stem: s, tijd: 1.2 });
  render(k, 6);
  assert.ok(render(k, 0.3).every((v) => v === 0), 'na loslaten: uitgestorven');
  k.bericht({ t: 'aan', stem: 0, rate: 1, v: 1 });
  render(k, 0.2);
  k.bericht({ t: 'stil' });
  assert.ok(render(k, 0.05).every((v) => v === 0));
});

test('bron: een geknipt stuk (Int16-pagina\'s) wordt Float32, en een nieuwe bron vervangt de oude', () => {
  const pag = new Int16Array([16384, -16384, 32767, 0]);
  const b = pcmNaarBron({ sr: SR, kanalen: 2, frames: 2, paginas: [pag] });
  assert.equal(b.n, 2);
  assert.ok(Math.abs(b.L[0] - 0.5) < 1e-6 && Math.abs(b.R[0] + 0.5) < 1e-6);
  const k = new KorrelInstrumentKern(SR, 1);
  const eigen = k.n;
  sinusBron(k, 220, 57, 1);
  assert.notEqual(k.n, eigen);
  assert.equal(k.grond, 57);
  assert.equal(scanVan(0.5), 0);
  assert.ok(scanVan(1) === 1 && scanVan(0) === -1);
  assert.ok(Math.abs(grootteVan(1) - 0.4) < 1e-9);
});

test('grondnoot uit de toonsoort van het nummer, dicht bij C4', () => {
  assert.equal(grondVan('C'), 60);
  assert.equal(grondVan('Am'), 57);
  assert.equal(grondVan('F#m'), 66);
  assert.equal(grondVan('Bb'), 58);
  assert.equal(grondVan(null), 60);
});

test('geen afval per blok, ook met acht stemmen en veel korrels', () => {
  const k = new KorrelInstrumentKern(SR, 2);
  k.bericht({ t: 'param', grootte: 0.3, dichtheid: 120, scan: 0.5, toon: 12, spray: 0.3 });
  for (let s = 0; s < STEMMEN; s++) k.bericht({ t: 'aan', stem: s, rate: 1 + s * 0.1, v: 1 });
  const L = new Float32Array(B), R = new Float32Array(B);
  let t = 0;
  const draai = (n) => { for (let i = 0; i < n; i++) { k.t0 = t; t += B / SR; k.blok(L, R, B); } };
  draai(3000);
  let beste = null;
  for (let p = 0; p < 6; p++) {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    draai(3000);
    const g = prof.stop().statistics.length;
    if (beste === null || g < beste) beste = g;
    if (g === 0) break;
  }
  assert.equal(beste, 0, `${beste} GC`);
  const t0 = performance.now();
  draai(2000);
  const ms = (performance.now() - t0) / 2000;
  assert.ok(ms < 0.6, `${(ms * 1000).toFixed(0)} µs per blok`);
});
