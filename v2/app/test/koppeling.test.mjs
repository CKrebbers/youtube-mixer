import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Klok } from '../src/kern/klok.js';
import { Beatgrid } from '../src/kern/grid.js';
import { segmenten, verschuivingBijKoppelen, verschuivingOpMaat, verschuivingUitPlek, plekOp } from '../src/kern/koppeling.js';

const dicht = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// Plek op t volgens een lijst segmenten, met dezelfde formule als de motor.
function plekUit(segs, t) {
  let s = segs[0];
  for (const x of segs) if (x.T <= t) s = x;
  return s.P + (t - s.T) * s.R;
}

test('segmenten volgen grid.timeOf(klok.tel + v) op elk moment', () => {
  const klok = new Klok();
  klok.start(10, 0, 124);
  klok.houd(12.3, 130);
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 128, anker: 0.25 }, { van: 30, bpm: 132, anker: 30.1 }] });
  const v = 41.5;
  const segs = segmenten(klok, grid, v, 10, 40);
  for (let t = 10; t < 40; t += 0.137) dicht(plekUit(segs, t), plekOp(klok, grid, v, t), 1e-6);
  assert.ok(segs.length >= 3, 'breekpunten op klokwissel en gridgrens');
});

test('rate = klok-tempo / grid-tempo', () => {
  const klok = new Klok(); klok.start(0, 0, 124);
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 128, anker: 0 }] });
  const [s] = segmenten(klok, grid, 0, 0, 5);
  dicht(s.R, 124 / 128, 1e-9);
});

test('koppelen springt hooguit een halve tel en landt op een tel', () => {
  const klok = new Klok(); klok.start(0, 0, 120);
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0.1 }] });
  for (const P of [3.0, 3.24, 3.26, 7.77]) {
    const t = 5.123;
    const v = verschuivingBijKoppelen(klok, grid, t, P);
    assert.ok(Number.isInteger(v));
    const sprong = grid.beatAt(plekOp(klok, grid, v, t)) - grid.beatAt(P);
    assert.ok(Math.abs(sprong) <= 0.5 + 1e-9, `sprong ${sprong}`);
    dicht((klok.tel(t) + v) % 1, klok.tel(t) % 1);
  }
});

test('op de maat: de "1" van het nummer valt op een "1" van de klok', () => {
  const klok = new Klok(); klok.start(0, 0, 120);
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0.3, maat: 0.8 }] });
  const t = 2.2, P = 11.1;
  const v = verschuivingOpMaat(klok, grid, t, P);
  // Een tel 1 van de klok (veelvoud van 4) moet een tel 1 van het nummer zijn.
  const c = klok.volgendeMaat(klok.tel(t));
  assert.ok(grid.isMaatbegin(Math.round(c + v)));
});

test('verschuiving uit de plek is exact de plek van nu', () => {
  const klok = new Klok(); klok.start(0, 0, 126);
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 126, anker: 0 }] });
  const v = verschuivingUitPlek(klok, grid, 4, 9.87);
  dicht(plekOp(klok, grid, v, 4), 9.87, 1e-9);
});
