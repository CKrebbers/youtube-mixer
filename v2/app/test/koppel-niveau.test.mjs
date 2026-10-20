// Het niveau van de beeldzender (src/koppel/niveau.js): bas, midden, hoog en luid op de schaal van wat er
// nu klinkt. Herkomst: v1 test/niveau.test.mjs. Puur: nep-mix met dB per beeld, geen browser. Plus: de kopie
// van gladOpNeer rekent precies als beeld/analyse/kenmerken.js, en de v2-Kenmerken leveren de ruwe dB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../src/koppel/niveau.js';
import * as F from '../src/beeld/analyse/kenmerken.js';

const FPS = 30, BPM = 146, TEL = 60 / BPM;
/** Een luide plaat: op de kick `piek` dB, ertussen `dal` dB; de vaste schaal staat al vol (1). */
const mixOp = (t, { piek = -20, dal = -30, vast = 1 } = {}) => {
  const fase = (t / TEL) % 1;
  const db = fase < 0.15 ? piek : dal;
  return { laag: vast, midden: vast, hoog: vast, rms: vast, db: { laag: db, midden: db - 5, hoog: db - 10, rms: db + 10 } };
};
const draai = (v, t0, sec, opties) => {
  const r = [];
  for (let i = 0; i < sec * FPS; i++) { const t = t0 + i / FPS; r.push({ t, fase: (t / TEL) % 1, uit: v.stap(t, mixOp(t, opties)) }); }
  return r;
};
const op = (r, k, f) => r.filter((x) => f(x.fase)).map((x) => x.uit[k]);
const max = (xs) => Math.max(...xs), min = (xs) => Math.min(...xs);

test('de vaste schaal stond vol, het niveau pompt op de kick', () => {
  const v = new N.NiveauVolger();
  const begin = v.stap(0, mixOp(0));
  assert.ok(begin.laag === 1 && begin.luid === 1, 'eerste beeld: de vaste schaal');
  const r = draai(v, 1 / FPS, 6).slice(3 * FPS);
  for (const k of ['laag', 'midden', 'hoog', 'luid']) {
    const kick = max(op(r, k, (f) => f >= 0.05 && f < 0.15));
    const tussen = min(op(r, k, (f) => f > 0.6 && f < 0.95));
    assert.ok(kick > 0.8 && tussen < 0.3, `${k}: kick ${kick.toFixed(2)}, ertussen ${tussen.toFixed(2)}`);
  }
  assert.ok(r.every((x) => Object.values(x.uit).every((w) => w >= 0 && w <= 1)));
});

test('10 dB luider = hetzelfde beeld; een vlak signaal blaast niet op', () => {
  const a = draai(new N.NiveauVolger(), 0, 6).slice(4 * FPS);
  const b = draai(new N.NiveauVolger(), 0, 6, { piek: -10, dal: -20 }).slice(4 * FPS);
  assert.ok(a.every((x, i) => Math.abs(x.uit.laag - b[i].uit.laag) < 0.01));
  const vlak = draai(new N.NiveauVolger(), 0, 4, { piek: -25, dal: -25 }).slice(2 * FPS);
  assert.ok(max(vlak.map((x) => x.uit.laag)) < 0.05);
  const klein = draai(new N.NiveauVolger(), 0, 4, { piek: -24, dal: -26 }).slice(2 * FPS);
  assert.ok(max(klein.map((x) => x.uit.laag)) <= 2 / N.MIN_BEREIK_DB + 0.01);
});

test('stilte zakt naar 0 en gaat niet in het venster; tijd van buiten', () => {
  const v = new N.NiveauVolger();
  draai(v, 0, 6);
  const n = v.monsters.laag.length;
  let s;
  for (let i = 0; i < FPS; i++) s = v.stap(6 + i / FPS, { laag: 0, midden: 0, hoog: 0, rms: 0, db: { laag: -90, midden: -90, hoog: -90, rms: -Infinity } });
  assert.ok(s.laag < 0.01 && s.luid < 0.01);
  assert.ok(v.monsters.laag.length <= n);
  const na = v.stap(30, mixOp(30, { vast: 0.7 }));
  assert.ok(v.monsters.laag.length === 1 && na.laag > 0, 'na een lange pauze opnieuw leren');
  const w = new N.NiveauVolger();
  draai(w, 0, 2);
  assert.equal(JSON.stringify(w.stap(5, mixOp(5))), JSON.stringify(w.stap(5, mixOp(5.2))), 'dezelfde t: dezelfde uitkomst');
  w.stap(1, mixOp(1));
  assert.equal(w.monsters.laag.length, 1, 'terug in de tijd: opnieuw');
  assert.equal(w.stap(6, { laag: 0.5, rms: 0.5 }), null, 'zonder db: null (de vaste schaal)');
  assert.equal(w.stap(6, null), null);
});

test('de kopie van gladOpNeer en de τ\'s rekenen precies als beeld/analyse/kenmerken.js', () => {
  assert.equal(N.OPKOMST_TAU, F.OPKOMST_TAU);
  assert.equal(N.UITSTERF_TAU, F.UITSTERF_TAU);
  for (const [a, b, dt] of [[0, 1, 0.033], [1, 0, 0.033], [0.4, 0.4, 0.1], [null, 0.7, 0.1], [0.2, 0.9, 0], [0.9, 0.1, 0.5]]) {
    assert.equal(N.gladOpNeer(a, b, dt), F.gladOpNeer(a, b, dt), `${a} → ${b} in ${dt}`);
  }
});

test('de v2-Kenmerken leveren de ruwe dB die het niveau leest', () => {
  const SR = 48000, BINS = 1024;
  const sp = new Float32Array(BINS).fill(-130);
  sp[Math.round(100 / (SR / (BINS * 2)))] = -10;
  const td = new Float32Array(2048).fill(0.5);
  const w = new F.Kenmerken().stap(0, sp, SR, td);
  for (const k of Object.values(N.NIVEAU_KENMERKEN)) assert.ok(Number.isFinite(w.db[k]), `db.${k}`);
  assert.ok(N.NiveauVolger && new N.NiveauVolger().stap(0, w));
});
