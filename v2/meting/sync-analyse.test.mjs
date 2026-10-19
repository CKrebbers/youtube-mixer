// De sync-analyse getoetst op nagebootste mixen met een bekende fout: een vaste fase, jitter en drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetSync } from './sync-analyse.js';

const SR = 48000;
function mix({ faseMs = 0, jitterMs = 0, driftMsPerMin = 0, sec = 60 }) {
  const n = SR * sec, x = new Float32Array(n);
  let s = 99; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 - 0.5; };
  const klik = (t, f) => { const a = Math.round(t * SR); for (let i = 0; i < 0.03 * SR && a + i < n; i++) x[a + i] += 0.4 * Math.sin(2 * Math.PI * f * i / SR) * Math.exp(-i / (0.006 * SR)); };
  for (let k = 0; 0.3 + k * 60 / 126 < sec - 0.2; k++) {
    const t = 0.3 + k * 60 / 126;
    klik(t, 150);
    klik(t + (faseMs + r() * 2 * jitterMs + driftMsPerMin * t / 60) / 1000, 3000);
  }
  return x;
}

test('perfect gesynct: spreiding ~0, geen drift', () => {
  const m = meetSync(mix({}), SR);
  assert.ok(m.spreidingMs < 0.2, JSON.stringify(m));
  assert.ok(Math.abs(m.driftMsPerMin) < 0.2);
});
test('een vaste fase van 7 ms is fase, geen spreiding', () => {
  const m = meetSync(mix({ faseMs: 7 }), SR);
  // De twee bandfilters vertragen niet even veel (de lage band trager): een vaste meetafwijking
  // van ~1 ms in de fase. Gelijk voor djay en v2, dus vergelijk de fase alleen tussen apps.
  assert.ok(Math.abs(m.faseMs - 7) < 1.5, JSON.stringify(m));
  assert.ok(m.spreidingMs < 0.2);
});
test('jitter van ±4 ms wordt gezien', () => {
  const m = meetSync(mix({ jitterMs: 4 }), SR);
  assert.ok(m.spreidingMs > 1.5 && m.maxMs > 3, JSON.stringify(m));
});
test('drift van 3 ms per minuut wordt gezien', () => {
  const m = meetSync(mix({ driftMsPerMin: 3 }), SR);
  assert.ok(Math.abs(m.driftMsPerMin - 3) < 0.3, JSON.stringify(m));
});
