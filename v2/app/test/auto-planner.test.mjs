// De auto-DJ, het rekenwerk (src/auto/planner.js): de garanties van v1 test/auto.test.mjs §1,
// op de maatklok van v2. Puur: geen engine, geen tijd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/auto/planner.js';

const k = P.leesToon;
const zeker = (bpm, toon) => ({ grid: {}, gridZeker: true, bpm, k: k(toon), toonZeker: true });

test('auto-planner: Camelot, tempo en toon lezen', () => {
  assert.equal(P.camelotAfstand(k('Am'), k('Am')), 0);
  assert.equal(P.camelotAfstand(k('Am'), k('C')), 1, 'relatief');
  assert.equal(P.camelotAfstand(k('Am'), k('Em')), 1, 'buren');
  assert.equal(P.camelotAfstand(k('Am'), k('D')), 3);
  assert.equal(P.camelotAfstand(null, k('D')), null);
  assert.ok(Math.abs(P.tempoAfwijking(124, 126) - 2 / 124) < 1e-12);
  assert.equal(P.tempoAfwijking(null, 120), null);
  // De spelling van de server (v1 SPELLING + m) en wat er verder rondgaat.
  assert.equal(k('Bbm'), 12 + 10);
  assert.equal(k('F#'), 6);
  assert.equal(k('C♯m'), 13);
  assert.equal(k({ toonsoort: 'G' }), 7);
  assert.equal(k('~'), null);
  assert.equal(P.toonNaam(k('Bbm')), 'B♭m');
  assert.equal(P.transponeer(k('Am'), 1), k('Bbm'));
});

test('auto-planner: de bewakers kiezen de veiligste overgang die past', () => {
  const b = P.kiesOvergang(zeker(124, 'Am'), zeker(125, 'Em'));
  assert.equal(b.type, 'blend');
  assert.equal(b.veilig, false);
  assert.equal(P.kiesOvergang(zeker(124, 'Am'), zeker(140, 'Am')).type, 'filter', 'tempo 124 → 140');
  assert.equal(P.kiesOvergang(zeker(124, 'Am'), zeker(124, 'D')).type, 'filter', 'toon botst');
  assert.equal(P.kiesOvergang({ ...zeker(124, 'Am'), gridZeker: false }, zeker(124, 'Am')).type, 'ambient', 'uitgaande niet zeker op de klok');
  assert.equal(P.kiesOvergang(zeker(124, 'Am'), { ...zeker(124, 'Am'), gridZeker: false }).type, 'filter', 'nieuwe onzeker');
  // De toon NA de sync (geen keylock): Am op 121 gekoppeld aan een klok op 128 klinkt als B♭m.
  const s = P.kiesOvergang(zeker(128, 'Am'), zeker(121, 'Am'));
  assert.equal(s.type, 'filter');
  assert.match(s.redenen.join(' '), /botsen/);
  // Een voorkeur mag veiliger, nooit riskanter.
  const pl = P.kiesOvergang({ ...zeker(124, 'Am'), gridZeker: false }, zeker(124, 'Am'), { voorkeur: 'blend' });
  assert.equal(pl.type, 'ambient');
  assert.match(pl.redenen[0], /klinkt hier niet goed/);
  assert.equal(P.kiesOvergang(zeker(124, 'Am'), zeker(124, 'Am'), { voorkeur: 'ambient' }).type, 'ambient');
  const onb = P.kiesOvergang(zeker(124, 'Am'), { ...zeker(124, 'Am'), toonZeker: false });
  assert.equal(onb.type, 'blend', 'toon onbekend: blend mag');
  assert.match(onb.redenen.join(' '), /niet zeker/);
});

test('auto-planner: kenmerken van een library-nummer (grid, twijfel over de "1", toon)', () => {
  const nr = (twijfel) => ({ grid: { stukken: [{ van: 0, bpm: 124, anker: 0, maat: 0, zekerheid: 0.9, ...(twijfel ? { twijfel: 'maat' } : {}) }] }, toon: 'Am' });
  assert.equal(P.kenmerken(nr(false), 10).gridZeker, true);
  assert.equal(P.kenmerken(nr(true), 10).gridZeker, false, 'twijfel over de "1": sync weigert, dus geen blend');
  assert.equal(P.kenmerken(nr(false), 10).k, k('Am'));
  assert.equal(P.kenmerken({ grid: null, toon: null }).gridZeker, false);
  // Een demo heeft alleen de korte lijst (gridLijst) zolang hij niet geladen is.
  const demo = P.kenmerken({ gridLijst: { slot: true, stukken: [{ bpm: 128 }] } });
  assert.equal(demo.bpm, 128);
  assert.equal(demo.gridZeker, true);
});

test('auto-planner: het moment ligt op een frasegrens van de KLOK, zo laat mogelijk', () => {
  // Klok-tellen, 4 per maat: een frase (16 maten) is 64 tellen.
  const m = P.planMoment({ type: 'blend', vroegst: 10, eind: 400 });
  assert.deepEqual([m.start, m.lengte, m.maten, m.opKlok], [320, 64, 16, true], 'de laatste 64-veelvoud waarna hij vóór 400 klaar is');
  assert.ok(m.start + m.lengte <= 400);
  const m2 = P.planMoment({ type: 'blend', vroegst: 300, eind: 350 });
  assert.equal(m2.start, 304, 'te laat voor een frase: de eerstvolgende 4-maatsgrens');
  assert.equal(m2.start % 16, 0);
  const m3 = P.planMoment({ type: 'filter', vroegst: 10, eind: 200 });
  assert.equal(m3.lengte, 32, 'filter: 8 maten');
  assert.ok(m3.start + m3.lengte <= 200 && m3.start % 64 === 0, `filter op een frase: ${m3.start}`);
  // Elke grens is een "1" van de klok (de "1" ligt op tel 0, perMaat, …), ook in 3/4.
  for (const eind of [100, 173.5, 401, 999]) {
    for (const vroegst of [0, 37, 90]) {
      const x = P.planMoment({ type: 'blend', vroegst, eind, perMaat: 3 });
      assert.equal(x.start % 3, 0, `3/4: ${x.start}`);
      assert.ok(x.start >= vroegst - 1e-9, 'nooit vóór vroegst');
    }
  }
  const lang = P.planMoment({ type: 'blend', vroegst: 0, eind: 400, lengte: { maten: 8 } });
  assert.equal(lang.lengte, 32, 'een eigen lengte in maten');
});

test('auto-planner: beatloos op tijd, in de tracktijd van de uitgaande', () => {
  const a = P.planMoment({ type: 'ambient', vroegst: 18, eind: 100, rate: 1 });
  assert.deepEqual([a.start, a.lengte, a.opKlok], [76, 24, false]);
  assert.equal(P.planMoment({ type: 'ambient', vroegst: 90, eind: 100 }).start, 90, 'nooit eerder dan vroegst');
  const snel = P.planMoment({ type: 'ambient', vroegst: 0, eind: 100, rate: 1.05 });
  assert.ok(Math.abs(snel.lengte - 24 * 1.05) < 1e-9, '24 s klok = 24 × rate tracktijd');
  assert.equal(P.voortgang(a, { plek: 88 }), 0.5);
  assert.equal(P.voortgang({ start: 320, lengte: 64, opKlok: true }, { tel: 336 }), 0.25);
});

test('auto-planner: de curves — nooit twee bassen, nooit een gat, in alle drie de soorten', () => {
  for (const type of ['blend', 'filter', 'ambient']) {
    let twee = 0, stil = 0;
    for (let i = 0; i <= 1000; i++) {
      const p = i / 1000;
      const s = P.standen(type, p, { uitA: 0.1, uitB: 0.2, inA: 0, inB: 0 });
      // Bij filter-uit speelt de nieuwe pas vanaf het eind (in.start).
      const inSpeelt = s.in.start;
      if (P.basOpen(s.uit) && inSpeelt && P.basOpen(s.in)) twee++;
      if (s.uit.fader < 0.05 && !(inSpeelt && s.in.fader >= 0.05)) stil++;
    }
    assert.equal(twee, 0, `${type}: twee bassen`);
    assert.equal(stil, 0, `${type}: een gat`);
  }
  const b0 = P.standen('blend', 0), b1 = P.standen('blend', 1);
  assert.ok(b0.uit.fader === 1 && b0.in.fader === 0 && b1.uit.fader < 1e-9 && b1.in.fader === 1);
  assert.equal(P.standen('blend', 0.49).in.laag, 0, 'de bas van de nieuwe dicht tot het midden');
  assert.equal(P.standen('blend', 0.5).uit.laag, 0, 'in het midden gewisseld');
  assert.equal(P.standen('blend', 0.5).in.laag, 0.5);
  assert.equal(P.standen('ambient', 0.5).uit.laag, 0, 'ook beatloos gewisseld (v2)');
  assert.ok(!P.standen('filter', 0.99).in.start && P.standen('filter', 1).in.start, 'filter: de nieuwe pas op het eind');
  assert.ok(P.standen('filter', 1).uit.filter > 0.9 && P.standen('filter', 1).uit.sendA > 0.6, 'highpass en echo lopen op');
  const a = [0, 0.3, 0.6, 1].map((p) => P.standen('ambient', p, { uitA: 0, uitB: 0.2, inA: 0, inB: 0 }));
  assert.ok(a[0].uit.filter === 0.5 && a[3].uit.filter < 0.2 && a[0].in.filter < 0.3 && a[3].in.filter === 0.5, 'lowpass dicht, nieuwe opent');
  assert.ok(a[0].uit.sendB === 0.2 && a[3].uit.sendB > 0.5, 'galm erbij vanaf zijn eigen stand');
  assert.ok(P.klaarStand('blend').fader === 0 && P.klaarStand('ambient').fader === 0 && P.klaarStand('filter').fader === 1);
  assert.equal(P.klaarStand('blend').laag, 0, 'de nieuwe staat klaar zonder bas');
});

test('auto-planner: fragment en kiezer (past bij, niet al gespeeld, geen tempo = straf)', () => {
  const kort = { id: 'k', duur: 200 };
  assert.deepEqual(P.fragment(kort), { van: 0, tot: 194 });
  assert.equal(P.fragment(kort, { speelduur: 40 }).tot, 40);
  const lang = { id: 'l', duur: 3600, grid: { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.2 }, { van: 900, bpm: 124, anker: 900, zekerheid: 0.9 }, { van: 3500, bpm: 128, anker: 3500 }] } };
  const f = P.fragment(lang, { rnd: () => 0 });
  assert.equal(f.van, 900, 'lange mix: waar een zeker stuk begint');
  assert.equal(f.tot, 900 + P.SPEELDUUR);
  assert.deepEqual(P.fragment(lang, { van: 1200, speelduur: 120 }), { van: 1200, tot: 1320 });

  const tr = (id, bpm, toon, lufs = -14) => ({ id, duur: 300, loudness_i: lufs, toon, grid: bpm ? { stukken: [{ van: 0, bpm, anker: 0, zekerheid: 0.9 }] } : null });
  const nummers = [tr('a', 124, 'Am'), tr('b', 125, 'Em'), tr('c', 90, 'F#'), tr('d', 124, 'Am', -30), tr('pad', null, null)];
  const huidig = { id: 'a', bpm: 124, k: k('Am'), toonZeker: true, loudness: -14 };
  const keus = P.kiesVolgende({ huidig, nummers, rnd: () => 0 });
  assert.equal(keus.nummer.id, 'b', 'tempo en toon dichtbij, even luid');
  assert.ok(keus.redenen.includes('past bij'));
  assert.equal(P.kiesVolgende({ huidig, nummers: [nummers[0]] }), null, 'nooit wat nu speelt');
  assert.notEqual(P.kiesVolgende({ huidig, nummers, gespeeld: new Set(['b']), rnd: () => 0 }).nummer.id, 'b', 'al gespeeld komt pas als al het andere op is');
  // Zonder tempo wint een nummer zonder grid niet meer van een nummer op 1,6% (in v1 wel).
  const metPad = [tr('a', 124, null), tr('x', 126, null), tr('pad', null, null)];
  assert.equal(P.kiesVolgende({ huidig: { id: 'a', bpm: 124 }, nummers: metPad, rnd: () => 0 }).nummer.id, 'x');
  // Past bij: zoals de bewakers, de toon na de sync.
  assert.equal(P.beoordeel(zeker(124, 'Am'), zeker(125, 'Em')).soort, 'goed');
  assert.equal(P.beoordeel(zeker(128, 'Am'), zeker(121, 'Am')), null, 'B♭m na de sync: 5 stappen op het wiel');
  assert.equal(P.beoordeel(zeker(124, 'Am'), zeker(124, 'Bm')).soort, 'bijna', 'Bm naast Am: 2 stappen');
  assert.equal(P.beoordeel(zeker(124, 'Am'), zeker(62, 'Am')).half, true);
  assert.equal(P.beoordeel(zeker(124, 'Am'), zeker(150, 'Am')), null);
});
