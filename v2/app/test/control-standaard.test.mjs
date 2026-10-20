// De standaardindelingen (indelingen/apc40mk2.json en toetsen.json): elke regel
// wijst naar een bekende actie (BEKEND in control-hulp.mjs) met een passend gedrag,
// geen control twee keer in dezelfde laag en shift, elk control bestaat op het
// apparaat, elke laag is te openen, en de kern (de kanaalstrip) zit nooit in een laag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseerIndeling, isLaagActie, leesLaagActie, sleutelVan, Indeling } from '../src/control/indeling.js';
import apc from '../src/control/apparaten/apc40mk2.js';
import toetsen from '../src/control/apparaten/toetsen.js';
import { BEKEND, sjabloonVan, maakBus } from './control-hulp.mjs';

const MAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'indelingen');
const lees = (naam) => JSON.parse(readFileSync(join(MAP, `${naam}.json`), 'utf8'));
const STANDAARD = [['apc40mk2', apc], ['toetsen', toetsen]];

/** Het sjabloon van een actie zoals de indeling hem schrijft: {focus} en een tracknummer -> {n}. */
const alsSjabloon = (actie) => sjabloonVan(actie.replace('{focus}', '1'));

for (const [naam, apparaat] of STANDAARD) {
  test(`${naam}: geen fout, geen dubbele control in dezelfde laag en shift`, () => {
    const doc = lees(naam);
    // Elke regel letterlijk, vóór de laatste-wint van normaliseren: dubbel is een fout in de standaard.
    const { indeling, fouten, dubbel } = normaliseerIndeling(doc, { apparaat });
    assert.deepEqual(fouten, []);
    assert.deepEqual(dubbel, []);
    assert.ok(indeling.op.size > 0);
    // Met een bus die alle bekende acties kent, kijkt normaliseren ook de soort na.
    const { bus } = maakBus();
    const metSoort = normaliseerIndeling(doc, { apparaat, soortVan: (id) => bus.zoek(id)?.def.soort ?? null });
    assert.deepEqual(metSoort.fouten, []);
  });

  test(`${naam}: elke regel wijst naar een bekende actie, met een gedrag dat bij zijn soort past`, () => {
    const { indeling } = normaliseerIndeling(lees(naam), { apparaat });
    for (const r of indeling.op.values()) {
      for (const actie of [r.actie, r.terug, r.led?.lees].filter(Boolean)) {
        if (isLaagActie(actie)) { assert.ok(leesLaagActie(actie), `${r.control}: ${actie}`); continue; }
        const soort = BEKEND[alsSjabloon(actie)];
        assert.ok(soort, `${sleutelVan(r)} -> ${actie}: geen bekende actie`);
        const soorten = soort.split('|');
        assert.ok(!soorten.includes('commando'), `${actie} is een commando`);
        if (r.gedrag === 'absoluut' || r.gedrag === 'eindeloos') assert.deepEqual(soorten, ['waarde'], `${sleutelVan(r)}: ${r.gedrag} op ${actie}`);
        if (r.gedrag === 'trigger') assert.ok(soorten.includes('trigger'), `${sleutelVan(r)}: trigger op ${actie} (${soort})`);
        if (soorten.length > 1) assert.equal(r.gedrag, 'schakelaar', `${actie} is nog niet beslist (${soort}): alleen schakelaar werkt met allebei`);
      }
      const c = apparaat.controls.get(r.control);
      assert.ok(c, `${r.control} bestaat`);
      assert.ok(apparaat.gedragVoor[c.soort].includes(r.gedrag), `${r.control} (${c.soort}) kan ${r.gedrag}`);
    }
  });

  test(`${naam}: elke laag die regels heeft is te openen, en heeft geen regels die niemand ziet`, () => {
    const { indeling } = normaliseerIndeling(lees(naam), { apparaat });
    const open = new Set([...indeling.op.values()].filter((r) => isLaagActie(r.actie)).map((r) => leesLaagActie(r.actie).naam).filter(Boolean));
    for (const r of indeling.op.values()) if (r.laag) assert.ok(open.has(r.laag), `laag ${r.laag} (${r.control}) heeft geen knop`);
  });
}

test('apc40mk2: de kanaalstrip zit nooit in een laag of achter shift (63% van de handen, telling/nu.md)', () => {
  const { indeling } = normaliseerIndeling(lees('apc40mk2'), { apparaat: apc });
  const basis = (control) => indeling.op.get(control);
  for (let k = 1; k <= 8; k++) {
    assert.equal(basis(`fader${k}`).actie, `track.${k}.fader`);
    assert.equal(basis(`tk${k}`).actie, `track.${k}.filter`);
    assert.equal(basis(`act${k}`).actie, `track.${k}.play`);
    assert.equal(basis(`sel${k}`).actie, `track.${k}.focus`);
    for (const x of indeling.op.values()) {
      if (x.control === `fader${k}` || x.control === `tk${k}`) assert.ok(!x.laag && !x.shift, `${sleutelVan(x)}`);
    }
  }
  // De strip van de focus-track op de device knobs, in DJM-volgorde: trim · hoog · mid · laag, dan echo · galm · fx.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((k) => basis(`dk${k}`).actie.split('.').slice(2).join('.')),
    ['trim', 'hoog', 'mid', 'laag', 'send.a', 'send.b', 'fx.mix']);
  assert.equal(basis('master').actie, 'mixer.master');
  assert.equal(basis('xf').actie, 'mixer.xfader');
  // Weinig lagen (telling punt 11): twee groepen.
  assert.deepEqual([...new Set(indeling.lagen.map((l) => l.split('.')[0]))].sort(), ['device', 'grid']);
  // Wat gevaarlijk is, alleen met shift.
  assert.equal(basis('stopall'), undefined);
  assert.equal(indeling.op.get('stopall#shift').actie, 'klok.stop');
});

test('apc40mk2: de standaard draait op een bus met alle bekende acties zonder een onbekende actie', () => {
  const { bus } = maakBus();
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => 1 } });
  ind.voegToe(lees('apc40mk2'));
  const onbekend = [];
  ind.on('onbekend', (o) => onbekend.push(o.doel));
  for (const c of apc.controls.keys()) {
    const druk = apc.controls.get(c).soort;
    if (druk === 'fader' || druk === 'draai') { ind.verwerk({ control: c, soort: 'waarde', waarde: 0.5, ruw: 64 }); ind.verwerk({ control: c, soort: 'waarde', waarde: 0.51, ruw: 65 }); }
    else if (druk === 'rel') ind.verwerk({ control: c, soort: 'delta', delta: 1 });
    else { ind.verwerk({ control: c, soort: 'druk' }); ind.verwerk({ control: c, soort: 'los' }); }
  }
  assert.deepEqual(onbekend, []);
  assert.equal(ind.vast.size, 0, 'niets blijft hangen');
});
