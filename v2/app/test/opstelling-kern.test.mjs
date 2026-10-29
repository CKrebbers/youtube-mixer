// De kern van de opstellingen (src/kern/opstelling): recept, zaad, realiseren, variëren, genereren.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stroom, hash, volgendZaad } from '../src/kern/opstelling/zaad.js';
import { normaliseerRecept, kromme, linkWaarde, ROLLEN } from '../src/kern/opstelling/model.js';
import { realiseer, macroActies, sceneWaarden, PATROON_PLEK } from '../src/kern/opstelling/realiseer.js';
import { euclid, maakPatroon, toonVan } from '../src/kern/opstelling/patroon.js';
import { muteer, kruis, drift, genereer } from '../src/kern/opstelling/varieer.js';
import { normaliseerSet } from '../src/kern/patronen/model.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const MAP = join(HIER, '..', 'opstellingen');

const CAT = {
  nummers: [
    { id: 'a', titel: 'A', bpm: 124, k: 21, stems: 4 },
    { id: 'b', titel: 'B', bpm: 90, k: 9, stems: 0 },
    { id: 'c', titel: 'C', bpm: 126, k: 14, stems: 2 },
    { id: 'd', titel: 'D', bpm: null, k: null, stems: 0 },
  ],
  instrumenten: ['poly', 'fm', 'schaal', 'drums'],
  racks: ['Warm', 'Koud', 'Ruimte'],
  vormen: ['lz', 'gs', 'ph', 'fl'],
};

test('zaad: herhaalbaar per (zaad, tags), anders per tag; volgendZaad loopt door', () => {
  const a = stroom(7, 'x'), b = stroom(7, 'x'), c = stroom(7, 'y');
  const ra = [a.r(), a.r(), a.r()], rb = [b.r(), b.r(), b.r()], rc = [c.r(), c.r(), c.r()];
  assert.deepEqual(ra, rb);
  assert.notDeepEqual(ra, rc);
  assert.ok(ra.every((x) => x >= 0 && x < 1));
  assert.equal(hash('abc'), hash('abc'));
  assert.notEqual(volgendZaad(1), volgendZaad(2));
  const s = stroom(3, 'g');
  for (let i = 0; i < 200; i++) { const g = s.geheel(2, 5); assert.ok(g >= 2 && g <= 5 && Number.isInteger(g)); }
});

test('euclid: k slagen over n, de eerste op 0, gedraaid met rot', () => {
  assert.deepEqual(euclid(4, 16), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(euclid(3, 8).filter(Boolean).length, 3);
  assert.equal(euclid(5, 16).filter(Boolean).length, 5);
  assert.equal(euclid(0, 8).filter(Boolean).length, 0);
  assert.equal(euclid(20, 8).filter(Boolean).length, 8);
  assert.notDeepEqual(euclid(3, 8, 1), euclid(3, 8, 0));
});

test('patronen: geldig volgens kern/patronen, in de toon, herhaalbaar', () => {
  const toon = toonVan(21, stroom(1, 't'));   // A mineur
  for (const soort of ['drums', 'bas', 'lijn', 'akkoord']) {
    const a = maakPatroon({ soort, dichtheid: [0.3, 0.7], lengte: [16, 32] }, 42, { n: 3, toon });
    const b = maakPatroon({ soort, dichtheid: [0.3, 0.7], lengte: [16, 32] }, 42, { n: 3, toon });
    assert.deepEqual(a, b, `${soort}: zelfde zaad, zelfde patroon`);
    assert.ok(a.patroon.noten.length > 0, `${soort}: niet leeg`);
    const { fouten } = normaliseerSet({ versie: 2, patronen: [{ ...a.patroon, id: 'p-1', track: 3, plek: 5 }] });
    assert.deepEqual(fouten, [], `${soort}: past in het patronenmodel`);
    if (soort !== 'drums') assert.ok(a.patroon.noten.every((x) => ((x.noot - 9) % 12 + 12) % 12 !== 1), `${soort}: geen bes in a mineur-achtig`);
  }
});

test('recept: normaliseren gooit nooit, meldt wat niet klopt, macro\'s op volgorde van het alfabet', () => {
  const { recept, fouten } = normaliseerRecept({
    id: 'x', sporen: [{ n: 1, soort: 'nummer' }, { n: 1, soort: 'instrument' }, { n: 9, soort: 'nummer' }, { n: 2, soort: 'gitaar' }],
    macros: [{ rol: 'ruimte', links: [{ actie: 'track.{n}.send.b', spoor: 1 }] }, { rol: 'schaal', links: [] }, { rol: 'onzin' }],
  });
  assert.equal(recept.sporen.length, 1);
  assert.deepEqual(recept.macros.map((m) => m.rol), ['schaal', 'ruimte']);
  assert.ok(fouten.length >= 4);
  assert.doesNotThrow(() => normaliseerRecept(null));
  assert.doesNotThrow(() => normaliseerRecept('kapot'));
});

test('kromme en link: van..tot met de kromme, geklemd', () => {
  assert.equal(kromme('lin', 0.5), 0.5);
  assert.equal(kromme('exp', 0.5), 0.25);
  assert.ok(Math.abs(linkWaarde({ van: 0.5, tot: 0.1, kromme: 'lin' }, 1) - 0.1) < 1e-12);
  assert.equal(linkWaarde({ van: 0, tot: 1, kromme: 'lin' }, 2), 1);
});

test('realiseren: zelfde zaad = zelfde opstelling, ander zaad = iets anders; {n} ingevuld; patronen op plek 5', () => {
  const recept = genereer(CAT, 11);
  const a = realiseer(recept, 5, CAT), b = realiseer(recept, 5, CAT);
  assert.deepEqual(a, b);
  const anders = [6, 7, 8, 9].map((z) => JSON.stringify(realiseer(recept, z, CAT)));
  assert.ok(anders.some((x) => x !== JSON.stringify(a)));
  for (const m of a.macros) for (const l of m.links) assert.ok(!l.actie.includes('{'), l.actie);
  for (const p of a.patronen) assert.equal(p.plek, PATROON_PLEK);
  const ids = a.sporen.filter((s) => s.nummer).map((s) => s.nummer.id);
  assert.equal(new Set(ids).size, ids.length, 'geen nummer twee keer');
});

test('nummers kiezen: stems "nodig" pakt een nummer met stems', () => {
  const { recept } = normaliseerRecept({ id: 's', sporen: [{ n: 1, soort: 'nummer', kies: { stems: 'nodig' } }] });
  for (let z = 1; z < 30; z++) assert.ok(['a', 'c'].includes(realiseer(recept, z, CAT).sporen[0].nummer.id));
});

test('genereren: elk zaad geeft een geldig recept met acht rollen op volgorde; bekende acties', () => {
  for (let z = 1; z <= 60; z++) {
    const r = genereer(CAT, z);
    const { fouten } = normaliseerRecept(r);
    assert.deepEqual(fouten, [], `zaad ${z}`);
    assert.ok(r.sporen.length >= 2 && r.sporen.length <= 8);
    assert.deepEqual(r.macros.map((m) => m.rol), ROLLEN.filter((x) => r.macros.some((m) => m.rol === x)));
    assert.equal(r.scenes.length, 5);
    assert.ok(r.sporen.filter((s) => s.soort === 'instrument' && s.kies.uit.includes('drums')).length <= 1, `zaad ${z}: hooguit één drumstel`);
  }
  const zonder = genereer({ ...CAT, nummers: [] }, 3);
  assert.ok(zonder.sporen.every((s) => s.soort === 'instrument'), 'zonder library alleen instrumenten');
});

test('variëren: muteren blijft binnen 0..1 en raakt variatie niet; kruisen mengt; drift begrensd en herhaalbaar', () => {
  const o = realiseer(genereer(CAT, 21), 3, CAT);
  const { opstelling: m } = muteer(o, 99, 0.8, CAT);
  assert.equal(m.macros.length, o.macros.length);
  assert.ok(m.macros.every((x) => x.waarde >= 0 && x.waarde <= 1));
  const vi = o.macros.findIndex((x) => x.rol === 'variatie');
  if (vi >= 0) assert.equal(m.macros[vi].waarde, o.macros[vi].waarde);
  const k = kruis(o, m, 5).opstelling;
  assert.ok(k.macros.every((x, i) => x.waarde === o.macros[i].waarde || x.waarde === m.macros[i].waarde));
  const basis = o.macros.map((x) => x.waarde);
  const d1 = drift(o, 37.5, 1, basis), d2 = drift(o, 37.5, 1, basis);
  assert.deepEqual(d1, d2);
  assert.ok(d1.every((v, i) => Math.abs(v - basis[i]) <= 0.35 + 1e-9));
  assert.deepEqual(drift(o, 37.5, 0, basis), basis, 'variatie 0 = stil');
  // glad: twee tellen vlak bij elkaar liggen dicht bij elkaar
  const e1 = drift(o, 40, 1, basis), e2 = drift(o, 40.1, 1, basis);
  assert.ok(e1.every((v, i) => Math.abs(v - e2[i]) < 0.02));
});

test('macro\'s en scenes: acties met waarden; een scene trekt binnen zijn bereik', () => {
  const o = realiseer(genereer(CAT, 4), 2, CAT);
  for (const m of o.macros) for (const [actie, v] of macroActies(m, 0.7)) { assert.equal(typeof actie, 'string'); assert.ok(v >= 0 && v <= 1); }
  const s = sceneWaarden(o, 3);
  assert.ok(s && Object.values(s).every((v) => v >= 0.0 && v <= 1));
  assert.equal(sceneWaarden(o, 9), null);
});

test('de recepten in opstellingen/: allemaal geldig', () => {
  const namen = readdirSync(MAP).filter((f) => f.endsWith('.json'));
  assert.ok(namen.length >= 3, 'er staan recepten klaar');
  for (const f of namen) {
    const { recept, fouten } = normaliseerRecept(JSON.parse(readFileSync(join(MAP, f), 'utf8')));
    assert.deepEqual(fouten, [], f);
    assert.equal(`${recept.id}.json`, f, `${f}: id = bestandsnaam`);
    assert.ok(realiseer(recept, 1, CAT));
  }
});
