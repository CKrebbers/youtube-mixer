import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../src/kern/bus.js';

test('een sjabloon geldt voor elke track en geeft het nummer mee', () => {
  const bus = new Bus();
  const gezet = [];
  bus.defineer({ id: 'track.{n}.filter', soort: 'waarde', doe: (v, n) => gezet.push([n, v]), lees: (n) => n / 10 });
  bus.doe('track.3.filter', 0.7);
  bus.doe('track.8.filter', 2);
  assert.deepEqual(gezet, [[3, 0.7], [8, 1]]);
  assert.equal(bus.lees('track.5.filter'), 0.5);
  assert.equal(bus.heeft('track.9.filter'), false);
  assert.equal(bus.ids().filter((i) => i.endsWith('.filter')).length, 8);
});

test('triggers worden boolean, onbekend gooit, dubbel definiëren gooit', () => {
  const bus = new Bus();
  let laatst;
  bus.defineer({ id: 'klok.tap', soort: 'trigger', doe: (v) => { laatst = v; } });
  bus.doe('klok.tap', 1);
  assert.equal(laatst, true);
  assert.throws(() => bus.doe('klok.bestaatniet', 1));
  assert.throws(() => bus.defineer({ id: 'klok.tap', soort: 'trigger', doe() {} }));
});

test('elke actie gaat eerst langs de luisteraars, met bron en meta', () => {
  const bus = new Bus();
  const log = [];
  bus.on('actie', (a) => log.push(a));
  bus.defineer({ id: 'track.{n}.sync', soort: 'trigger', meta: { nummer: false }, doe: () => ({ geweigerd: 'grid onzeker' }) });
  const geweigerd = [];
  bus.on('geweigerd', (g) => geweigerd.push(g));
  bus.doe('track.2.sync', true, { bron: 'apc' });
  assert.equal(log[0].bron, 'apc');
  assert.deepEqual(geweigerd[0], { id: 'track.2.sync', reden: 'grid onzeker', bron: 'apc' });
});
