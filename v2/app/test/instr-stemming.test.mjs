// De stemming van de Klankschaal (src/audio/instrumenten/stemming.js), puur. Overgenomen uit v1
// test/klankschaal.test.mjs deel 1 (stemming), plus het lezen van de toon als tekst (v2).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { stemming, leesToon, leesToonsoort, kortNaam, relatief, TOONLADDERS, LADDERS, STANDAARD_TOON } =
  await import('../src/audio/instrumenten/stemming.js');
const cent = (a, b) => 1200 * Math.log2(a / b);

test('stemming: D Kurd van de Waterschaal, kern D3', () => {
  const st = stemming({ k: 14 });
  const ws = [220, 233.08, 261.63, 293.66, 329.63, 349.23, 392, 440];
  assert.ok(st.ladder === 'kurd' && st.k === 14 && !st.relatief);
  assert.ok(st.kernNaam === 'D3' && Math.abs(st.kernHz - 146.83) < 0.01);
  assert.equal(st.velden.map((v) => v.naam).join(' '), 'A3 Bb3 C4 D4 E4 F4 G4 A4');
  assert.ok(st.velden.every((v, i) => Math.abs(cent(v.hz, ws[i])) < 0.1));
  assert.equal(stemming({ k: null }).k, STANDAARD_TOON);
});

test('stemming: cent van de plaat, relatief, transpositie, fijn', () => {
  const am = stemming({ k: 21, cent: 43 });
  assert.ok(am.kernNaam === 'A2' && Math.abs(cent(am.kernHz, 110) - 43) < 1e-6 && am.velden[3].naam === 'A3');
  const c = stemming({ k: 0 });
  assert.ok(c.ladder === 'majeur' && c.kernNaam === 'C3' && c.velden.map((v) => v.naam).join(' ') === 'G3 A3 B3 C4 D4 E4 F4 G4');
  const ck = stemming({ k: 0, ladder: 'kurd' });
  assert.ok(ck.relatief && ck.k === 21 && ck.kernNaam === 'A2');
  const am2 = stemming({ k: 21, ladder: 'majeur' });
  assert.ok(am2.relatief && am2.k === 0);
  assert.equal(stemming({ k: 14, transpositie: 2 }).k, 16);
  assert.equal(stemming({ k: 14, transpositie: -12 }).kernNaam, 'D3');
  assert.ok(Math.abs(stemming({ k: 14, cent: -20, fijn: 10 }).cent + 10) < 1e-9);
  assert.equal(stemming({ k: 14, fijn: 400 }).cent, 50);
});

test('stemming: 24 toonsoorten × 7 ladders in het register, oplopend, eindig; diatonisch = de tonen van de plaat', () => {
  for (let k = 0; k < 24; k++) for (const l of LADDERS) {
    const s = stemming({ k, ladder: l });
    assert.ok(s.kernHz > 100 && s.kernHz < 200, `${k} ${l}: kern ${s.kernHz}`);
    assert.ok(s.velden.every((v, i) => i === 0 || v.hz > s.velden[i - 1].hz));
    assert.ok(s.velden.every((v) => Number.isFinite(v.hz)));
  }
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
  for (let k = 0; k < 24; k++) for (const l of ['auto', 'kurd', 'celtic', 'penta', 'majeur', 'pentaMajeur']) {
    const s = stemming({ k, ladder: l });
    const ton = k % 12, ladder = k >= 12 ? MIN : MAJ;
    const tonen = [...s.velden.map((v) => v.midi), s.kernMidi];
    assert.ok(tonen.every((m) => ladder.includes((((m - ton) % 12) + 12) % 12)), `buiten de toonladder: ${k} ${l}`);
  }
  assert.ok(TOONLADDERS.hijaz, 'Hijaz staat erin (bewust niet diatonisch)');
});

test('de toon als tekst lezen (v2: toon() geeft tekst)', () => {
  assert.equal(leesToonsoort('Am'), 21);
  assert.equal(leesToonsoort('F#'), 6);
  assert.equal(leesToonsoort('Bbm'), 22);
  assert.equal(leesToonsoort('C♯m'), 13);
  assert.equal(leesToonsoort('E♭'), 3);
  assert.equal(leesToonsoort('A mineur'), 21);
  assert.equal(leesToonsoort('~'), null);
  assert.deepEqual(leesToon('Dm'), { k: 14, cent: 0 });
  assert.deepEqual(leesToon({ toonsoort: 'Am', cent: 43 }), { k: 21, cent: 43 });
  assert.deepEqual(leesToon({ k: 3, cent: -80 }), { k: 3, cent: -50 }, 'cent begrensd op ±50');
  assert.deepEqual(leesToon({ toonsoort: { k: 7, cent: 5 } }), { k: 7, cent: 5 }, 'de vorm van v1');
  assert.equal(leesToon(null), null);
  assert.equal(leesToon('rommel'), null);
  assert.equal(kortNaam(13), 'C♯m');
  assert.equal(relatief(0), 21);
});
