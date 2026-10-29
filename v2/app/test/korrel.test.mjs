// De korrelwolk (granular): de rekenkern (src/audio/fx/korrel-kern.js) en het effect (fx-korrel.js).
// @alleen: afvalmeting (GCProfiler, 0 GC)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Korrel, MAX_KORRELS } from '../src/audio/fx/korrel-kern.js';
import { korrel, grootteKorrel, terugKorrel, dichtheidKorrel } from '../src/audio/fx/fx-korrel.js';
import { effectVan } from '../src/audio/fx/fx.js';
import { MockContext, nepWorklet, staat } from './fx-nep.mjs';
import { terugKnop, veldSeconden } from '../src/engine/acties-gebaren.js';

if (typeof globalThis.gc !== 'function') { v8.setFlagsFromString('--expose-gc'); globalThis.gc = vm.runInNewContext('gc'); }
const SR = 48000, B = 128;
const blokken = () => ({ inL: new Float32Array(B), inR: new Float32Array(B), uL: new Float32Array(B), uR: new Float32Array(B) });

function voed(k, b, seconden, bron = (t) => Math.sin((2 * Math.PI * 220 * t) / SR) * 0.5, meet = null) {
  let t = 0;
  for (let n = 0; n < (SR * seconden) / B; n++) {
    for (let i = 0; i < B; i++) { const x = bron(t++); b.inL[i] = x; b.inR[i] = x; }
    k.render(b.inL, b.inR, 1, b.uL, b.uR, B);
    meet?.(b);
  }
}
const piekVan = (lijst) => lijst.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
const rms = (lijst) => Math.sqrt(lijst.reduce((a, x) => a + x * x, 0) / Math.max(1, lijst.length));

test('kern: stil in = stil uit; een toon geeft een wolk van ongeveer dezelfde sterkte, eindig, nooit te luid', () => {
  const k = new Korrel(SR, 1), b = blokken();
  const stil = [];
  voed(k, b, 1, () => 0, (x) => stil.push(...x.uL));
  assert.equal(piekVan(stil), 0);
  const uit = [];
  voed(k, b, 3, undefined, (x) => uit.push(...x.uL, ...x.uR));
  assert.ok(uit.every(Number.isFinite));
  const r = rms(uit.slice(uit.length / 2));
  assert.ok(r > 0.15 && r < 0.6, `rms ${r} (in: 0,35)`);
  assert.ok(piekVan(uit) < 1.2);
  assert.ok(k.actief > 0 && k.actief <= MAX_KORRELS);
});

test('kern: hetzelfde zaad = hetzelfde geluid, een ander zaad = anders', () => {
  const opname = (zaad) => { const k = new Korrel(SR, zaad), b = blokken(), u = []; voed(k, b, 1, undefined, (x) => u.push(...x.uL)); return u; };
  assert.deepEqual(opname(5), opname(5));
  assert.notDeepEqual(opname(5), opname(6));
});

test('kern: bevriezen houdt de wolk vast als de invoer stopt; los = hij sterft uit', () => {
  const k = new Korrel(SR, 3), b = blokken();
  voed(k, b, 2);
  k.bevries = 1;
  const vast = [];
  voed(k, b, 2, () => 0, (x) => vast.push(...x.uL));
  assert.ok(rms(vast) > 0.1, `bevroren: rms ${rms(vast)}`);
  k.bevries = 0;
  voed(k, b, 5, () => 0);
  const daarna = [];
  voed(k, b, 0.5, () => 0, (x) => daarna.push(...x.uL));
  assert.equal(rms(daarna), 0);
});

test('kern: achteruit (omkeer 1) speelt ook; korrels blijven binnen de ring', () => {
  const k = new Korrel(SR, 9), b = blokken();
  k.omkeer = 1; k.grootte = 0.3; k.terug = 1; k.spray = 0.5; k.toon = 12;
  const u = [];
  voed(k, b, 3, undefined, (x) => u.push(...x.uL));
  assert.ok(rms(u.slice(u.length / 2)) > 0.05);
  assert.ok(u.every(Number.isFinite));
});

test('kern: geen afval per blok (0 GC over 4000 blokken), en snel genoeg', () => {
  const k = new Korrel(SR, 2), b = blokken();
  k.dichtheid = 120; k.grootte = 0.4;   // de zwaarste stand: veel korrels tegelijk
  for (let i = 0; i < B; i++) { b.inL[i] = Math.sin(i * 0.1) * 0.5; b.inR[i] = b.inL[i]; }
  const draai = (n) => { for (let i = 0; i < n; i++) k.render(b.inL, b.inR, 1, b.uL, b.uR, B); };
  draai(4000);
  let beste = null;
  for (let p = 0; p < 6; p++) {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const h0 = process.memoryUsage().heapUsed;
    draai(4000);
    const r = { bytes: process.memoryUsage().heapUsed - h0, gcs: prof.stop().statistics.length };
    if (!beste || r.gcs < beste.gcs || (r.gcs === beste.gcs && r.bytes < beste.bytes)) beste = r;
    if (r.gcs === 0) break;
  }
  assert.equal(beste.gcs, 0, `${beste.gcs} GC, ${beste.bytes} bytes`);
  const t0 = performance.now();
  draai(3000);
  const ms = (performance.now() - t0) / 3000;
  assert.ok(ms < 0.5, `${(ms * 1000).toFixed(0)} µs per blok van 128 (van 2,67 ms)`);
});

test('effect: in EFFECTEN, droog tot de worklet er is, eenheden kloppen met de schaling', async () => {
  assert.equal(effectVan('korrel'), korrel);
  staat.NOW = 10;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  const inst = korrel.bouw(ctx);
  assert.equal(inst._n.droog.gain.value, 1);
  assert.equal(inst._n.nat.gain.value, 0);
  await w.klaar();
  assert.ok(inst._n.w.node, 'de worklet is er');
  assert.match(korrel.eenheid.grootte(0), /10(,0)? ms/);
  assert.match(korrel.eenheid.grootte(1), /500 ms/);
  assert.ok(Math.abs(grootteKorrel(1) - 0.5) < 1e-9 && Math.abs(terugKorrel(0) - 0.03) < 1e-9 && Math.abs(dichtheidKorrel(1) - 120) < 1e-9);
  assert.equal(korrel.eenheid.bevries(0.7), 'vast');
  assert.ok(inst.staart() > 0 && inst.staart() <= 4.05);
  inst.vernietig();
});

test('korrelveld: plek k = zoveel seconden terug, en de knop rekent precies terug', () => {
  assert.ok(Math.abs(veldSeconden(1) - 0.1) < 1e-9 && Math.abs(veldSeconden(16) - 2.9) < 1e-9);
  for (let k = 1; k <= 16; k++) assert.ok(Math.abs(terugKorrel(terugKnop(veldSeconden(k))) - veldSeconden(k)) < 1e-9);
});
