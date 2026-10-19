// Het rekenwerk van de loopback getoetst op een nagebootste kabel met een bekende vertraging,
// ruis, en een paar ontbrekende klikken: de analyse moet de vertraging terugvinden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aanzetten, analyseer } from './loopback-reken.js';

function nepOpname({ vertragingMs, jitterMs = 0, ruis = 0.002, mis = [], sr = 48000, sec = 20, bpm = 124, start = 0.5, opnameStart = 0.4 }) {
  const n = Math.round(sec * sr), x = new Float32Array(n);
  let s = 12345;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 - 0.5; };
  const tellen = [];
  for (let k = 0; start + k * 60 / bpm < start + sec - 1.5; k++) tellen.push(start + k * 60 / bpm);
  tellen.forEach((t, k) => {
    if (mis.includes(k)) return;
    const a = t + (vertragingMs + r() * 2 * jitterMs) / 1000 - opnameStart;
    // Een klik door een kabel: een korte gedempte golf, niet een rechthoek.
    for (let i = 0; i < 400; i++) {
      const j = Math.floor(a * sr) + i, frac = a * sr - Math.floor(a * sr);
      // Aanloop van ~0,3 ms (een kabel en een AD-omzetter maken een klik nooit meteen vol).
      if (j >= 0 && j < n) x[j] += 0.4 * Math.min(1, (i - frac + 1) / 15) * Math.exp(-(i - frac) / 60) * Math.sin(((i - frac) / 400) * Math.PI * 6 + 0.5);
    }
  });
  for (let i = 0; i < n; i++) x[i] += r() * ruis;
  return { opname: x, opnameStart, sr, tellen };
}

test('vindt een vaste vertraging van 12,3 ms terug, binnen 0,1 ms', () => {
  const o = nepOpname({ vertragingMs: 12.3 });
  const res = analyseer({ ...o, outputLatency: 0.006, baseLatency: 0.003 });
  assert.ok(Math.abs(res.rondgangMs.mediaan - 12.3) < 0.1, JSON.stringify(res.rondgangMs));
  assert.ok(res.rondgangMs.spreiding < 0.1);
  assert.equal(res.geslaagd, true);
});

test('ziet spreiding (jitter van ±3 ms) en keurt af', () => {
  const o = nepOpname({ vertragingMs: 12, jitterMs: 3 });
  const res = analyseer({ ...o, outputLatency: 0.006, baseLatency: 0.003 });
  assert.equal(res.geslaagd, false);
  assert.match(res.reden, /stabiel/);
});

test('een paar gemiste klikken is geen ramp, de meeste wel', () => {
  assert.equal(analyseer({ ...nepOpname({ vertragingMs: 9, mis: [3, 7] }), outputLatency: 0.006 }).gevonden > 0, true);
  const slecht = analyseer({ ...nepOpname({ vertragingMs: 9, mis: Array.from({ length: 30 }, (_, i) => i) }) });
  assert.equal(slecht.geslaagd, false);
  assert.match(slecht.reden, /teruggevonden/);
});

test('een app die veel minder aftrekt dan de echte uitgang: afgekeurd', () => {
  const res = analyseer({ ...nepOpname({ vertragingMs: 40 }), outputLatency: 0.005, baseLatency: 0.003 });
  assert.equal(res.geslaagd, false);
});

test('aanzetten: één per klik, niet per golftop', () => {
  const o = nepOpname({ vertragingMs: 5 });
  assert.equal(aanzetten(o.opname, o.sr).length, o.tellen.length);
});
