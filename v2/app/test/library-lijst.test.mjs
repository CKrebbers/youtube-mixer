import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryLijst, gridVan } from '../src/ui/library-lijst.js';

const nummers = [
  { id: 'a', titel: 'Crazy in Love', artiest: 'Beyoncé', duur: 236, toegevoegd: 3, toon: 'Dm', grid: { stukken: [{ bpm: 99, zekerheid: 0.9 }] } },
  { id: 'b', titel: 'Ambient', artiest: 'Eno', duur: 600, toegevoegd: 1, grid: null },
  { id: 'c', titel: 'Around', artiest: 'Daft Punk', duur: 429, toegevoegd: 2, toon: 'Am', grid: { stukken: [{ bpm: 121, zekerheid: 0.3 }] } },
];

test('zoeken zonder accenten en hoofdletters, elk woord moet passen', () => {
  const l = new LibraryLijst(); l.zet(nummers);
  l.zoeken('beyonce'); assert.deepEqual(l.rijen.map((x) => x.id), ['a']);
  l.zoeken('daft around'); assert.deepEqual(l.rijen.map((x) => x.id), ['c']);
  l.zoeken('daft eno'); assert.deepEqual(l.rijen, []);
  l.zoeken(''); assert.equal(l.rijen.length, 3);
});

test('sorteren: nieuwste eerst; per kolom, nog eens = omdraaien; zonder waarde achteraan', () => {
  const l = new LibraryLijst(); l.zet(nummers);
  assert.deepEqual(l.rijen.map((x) => x.id), ['a', 'c', 'b']);
  l.sorteer('bpm'); assert.deepEqual(l.rijen.map((x) => x.id), ['a', 'c', 'b']);
  l.sorteer('bpm'); assert.deepEqual(l.rijen.map((x) => x.id), ['c', 'a', 'b'], 'omgedraaid, b blijft achteraan');
  l.sorteer('titel'); assert.deepEqual(l.rijen.map((x) => x.id), ['b', 'c', 'a']);
  l.sorteer('toon'); assert.deepEqual(l.rijen.map((x) => x.id), ['c', 'a', 'b']);
});

test('de keuze: stap begint bovenaan, klemt aan de randen, verdwijnt als het filter hem verbergt', () => {
  const l = new LibraryLijst(); l.zet(nummers);
  assert.equal(l.stap(1), 'a');
  assert.equal(l.stap(1), 'c');
  assert.equal(l.stap(5), 'b');
  assert.equal(l.stap(-9), 'a');
  l.zoeken('eno'); assert.equal(l.gekozen, null);
});

test('gridVan: bpm en zeker (slot telt als zeker)', () => {
  assert.deepEqual(gridVan(nummers[0]), { bpm: 99, zeker: true });
  assert.deepEqual(gridVan(nummers[2]), { bpm: 121, zeker: false });
  assert.deepEqual(gridVan({ grid: { slot: true, stukken: [{ bpm: 90, zekerheid: 0.1 }] } }), { bpm: 90, zeker: true });
  assert.deepEqual(gridVan(nummers[1]), { bpm: null, zeker: false });
});
