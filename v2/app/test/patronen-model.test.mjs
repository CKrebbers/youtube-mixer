// Het patroonmodel (src/kern/patronen/model.js): normaliseren (gooit nooit), de set als lijst met
// (track, plek), een v1-set lezen, id's uit de teller (nooit hergebruikt), en de bewerkingen.
// Overgenomen uit v1 test/patronen.test.mjs deel 1 (het model); de set-vorm is die van v2.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../src/kern/patronen/model.js');

test('patroon: klemmen, sorteren, één noot per (stap, noot), rommel weg', () => {
  const fouten = [];
  const p = M.normaliseerPatroon({ id: 'p-a', lengte: 99, deling: 5, swing: 90, noten: [
    { stap: 4, noot: 38 }, { stap: 0, noot: 36, snelheid: 2, duur: -1, micro: 3 }, { stap: 0, noot: 36, snelheid: 0.5 },
    { stap: 70, noot: 36 }, { stap: 1, noot: 200 }, 'rommel'] }, { fouten });
  assert.ok(p.lengte === 64 && p.deling === 4 && p.swing === 75);
  assert.ok(p.noten.length === 2 && p.noten[0].stap === 0 && p.noten[0].snelheid === 0.5 && p.noten[1].stap === 4);
  assert.ok(fouten.length >= 4, 'wat niet klopt staat in fouten');
  const q = M.normaliseerPatroon({ noten: [{ stap: 0, noot: 36, snelheid: 2, duur: -1, micro: 3 }] });
  assert.ok(q.noten[0].snelheid === 1 && q.noten[0].duur === 1 && q.noten[0].micro === 0.5);
  assert.equal(q.id, 'p-1', 'zonder id: p-1 (uit een teller, geen tijd of toeval)');
  assert.deepEqual(Object.keys(q), ['id', 'naam', 'lengte', 'deling', 'swing', 'noten'], 'een los patroon heeft precies de vorm van v1');
  assert.equal(M.normaliseerPatroon('rommel'), null);
  assert.equal(M.normaliseerPatroon(null), null);
  assert.deepEqual(M.kernVan({ ...q, track: 2, plek: 3 }), q);
});

test('set: leeg, als lijst met (track, plek), gesorteerd, bezette plek naar de bak, nog eens normaliseren verandert niets', () => {
  const leeg = M.normaliseerSet({});
  assert.ok(leeg.set.versie === 2 && leeg.set.patronen.length === 0 && leeg.set.tempo === 120 && leeg.set.teller === 1 && leeg.fouten.length === 0);
  const { set, fouten } = M.normaliseerSet({ tempo: 400, patronen: [
    { id: 'p-5', track: 3, plek: 2, noten: [{ stap: 0, noot: 60 }] },
    { id: 'p-2', track: 1, plek: 7 },
    { id: 'x', track: 3, plek: 2 },
    { track: 9, plek: 1 },
    { id: 'bak' },
    'rommel',
  ] });
  assert.equal(set.tempo, 240);
  assert.deepEqual(set.patronen.map((p) => `${p.id}@${p.track}/${p.plek}`), ['p-2@1/7', 'p-5@3/2', 'x@null/null', 'p-6@null/null', 'bak@null/null']);
  assert.ok(fouten.some((f) => /al bezet/.test(f)) && fouten.some((f) => /track 9/.test(f)) && fouten.some((f) => /geen patroon/.test(f)));
  assert.equal(set.teller, 7, 'de teller staat na het hoogste id');
  assert.deepEqual(M.normaliseerSet(set).set, set);
  assert.ok(M.patroonOp(set, 3, 2).id === 'p-5' && M.patroonOp(set, 3, 3) === null && M.patronenVan(set, 1).length === 1);
  assert.ok(M.normaliseerSet('rommel').fouten.length === 1 && M.normaliseerSet(null).set.patronen.length === 0);
  const plekken = M.normaliseerSet({ patronen: [{ track: 1, plek: M.PLEK_MAX }, { track: 1, plek: M.PLEK_MAX + 1 }] });
  assert.ok(plekken.set.patronen[0].plek === M.PLEK_MAX && plekken.set.patronen[1].plek === null, `plek tot ${M.PLEK_MAX}, niet tot 5`);
});

test('set: een dubbele id krijgt een nieuwe die nergens in de set staat', () => {
  const { set, fouten } = M.normaliseerSet({ patronen: [{ id: 'x', track: 1, plek: 1 }, { id: 'x', track: 1, plek: 2 }, { id: 'p-1', track: 1, plek: 3 }] });
  const ids = set.patronen.map((p) => p.id);
  assert.ok(ids[0] === 'x' && ids[2] === 'p-1' && ids[1] !== 'x' && ids[1] !== 'p-1' && new Set(ids).size === 3, ids.join());
  assert.ok(fouten.some((f) => /dubbel/.test(f)));
});

test('een v1-set leest gewoon (8 tracks × 5 plekken, instrumenten)', () => {
  const v1 = { naam: 'proef', tempo: 124, instrumenten: { 1: 'poly', 2: { soort: 'fm', params: [0.5, 2, -1, 'x', null, 0.25, 0, 1, 0.9] }, 3: { soort: 'Rare Soort!' } },
    tracks: { 1: [{ id: 'p-kick', lengte: 8 }, null, { id: 'p-b' }], 3: [null, { id: 'p-c' }] } };
  const { set, fouten } = M.normaliseerSet(v1);
  assert.deepEqual(set.patronen.map((p) => `${p.id}@${p.track}/${p.plek}`), ['p-kick@1/1', 'p-b@1/3', 'p-c@3/2']);
  assert.ok(set.naam === 'proef' && set.tempo === 124 && set.patronen[0].lengte === 8);
  assert.ok(set.instrumenten['1'].soort === 'poly' && set.instrumenten['1'].params === null);
  assert.deepEqual(set.instrumenten['2'].params, [0.5, 1, 0, null, null, 0.25, 0, 1]);
  assert.ok(!set.instrumenten['3'] && fouten.some((f) => /track 3: geen instrument/.test(f)));
  const lijst = M.normaliseerSet({ tracks: [[{ lengte: 8 }], null, [null, null, null, null, null, { lengte: 4 }]] });
  assert.deepEqual(lijst.set.patronen.map((p) => `${p.track}/${p.plek}`), ['1/1', '3/6'], 'v1 als lijst; plek 6 kan nu');
  assert.deepEqual(M.normaliseerSet(set).set, set);
});

test('set bewerken: metPatroon, metNieuwPatroon (id uit de teller, nooit hergebruikt), verplaats, zonderPatroon', () => {
  let set = M.leegSet();
  let r = M.metNieuwPatroon(set, { track: 2, plek: 1, lengte: 8 });
  set = r.set;
  assert.ok(r.patroon.id === 'p-1' && set.teller === 2 && M.patroonOp(set, 2, 1).lengte === 8);
  r = M.metNieuwPatroon(set, { track: 2, plek: 2 });
  set = r.set;
  assert.equal(r.patroon.id, 'p-2');
  const zonder = M.zonderPatroon(set, 'p-2');
  assert.ok(zonder.patronen.length === 1 && zonder.teller === 3);
  assert.equal(M.metNieuwPatroon(zonder, {}).patroon.id, 'p-3', 'een weggehaald id komt nooit terug');
  const voor = JSON.stringify(set);
  const op = M.metPatroon(set, { ...M.patroonOp(set, 2, 1), noten: [{ stap: 0, noot: 36 }] });
  assert.ok(JSON.stringify(set) === voor && M.patroonOp(op, 2, 1).noten.length === 1, 'vervangen op id; de oude set blijft');
  const verdrongen = M.metPatroon(set, { id: 'p-9', track: 2, plek: 1 });
  assert.ok(M.patroonOp(verdrongen, 2, 1).id === 'p-9' && M.patroonMet(verdrongen, 'p-1').track === null && verdrongen.teller === 10, 'wat er stond gaat naar de bak');
  const geruild = M.verplaats(set, 'p-1', 2, 2);
  assert.ok(M.patroonOp(geruild, 2, 2).id === 'p-1' && M.patroonOp(geruild, 2, 1).id === 'p-2', 'verplaatsen ruilt');
  assert.equal(M.patroonMet(M.verplaats(set, 'p-1', null, null), 'p-1').track, null, 'naar de bak');
  assert.deepEqual(M.normaliseerSet(geruild).set, geruild);
});

test('patroon bewerken: zetNoot (absoluut), wisselNoot, zonderNoot, metDuur, lengtes', () => {
  let r = M.nieuwPatroon();
  r = M.wisselNoot(r, 4, 36);
  r = M.wisselNoot(r, 4, 42);
  assert.equal(M.notenOp(r, 4).map((n) => n.noot).join(), '36,42');
  r = M.wisselNoot(r, 4, 36);
  assert.equal(M.notenOp(r, 4).map((n) => n.noot).join(), '42');
  const a = M.zetNoot(r, 2, 50, true, { snelheid: 0.5 });
  assert.deepEqual(M.zetNoot(a, 2, 50, true, { snelheid: 0.5 }), a, 'absoluut: nog eens dezelfde regel = hetzelfde patroon');
  assert.deepEqual(M.zetNoot(M.zetNoot(a, 2, 50, false), 2, 50, false), M.zetNoot(a, 2, 50, false));
  assert.equal(M.zonderNoot(r, 4).noten.length, 0);
  assert.ok(r !== M.metNoot(r, { stap: 1, noot: 50 }) && r.noten.length === 1, 'het oude patroon blijft');
  assert.equal(M.metDuur(a, 2, 50, 3).noten.find((n) => n.noot === 50).duur, 3);
  assert.ok(M.volgendeLengte(16, 1) === 20 && M.volgendeLengte(20, -1) === 16 && M.volgendeLengte(64, 1) === 64 && M.volgendeLengte(1, -1) === 1);
  assert.ok(M.metDeling(r, 5) === r && M.metDeling(r, 3).deling === 3 && M.metSwing(r, 99).swing === 75 && M.metLengte(r, 0).lengte === 1);
});
