// De apparaatdefinitie van de APC40 mkII tegen Akai's protocoldocument v1.2
// (de getallen hieronder zijn uit dat document overgeschreven, net als in v1
// src/control/devices/apc40mk2.js en AV-app-hub src/devices/apc40mk2.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import apc, { CONTROLS, INIT, KLEUR, RING, gridNoot, ontleed, ledBericht, ringType, alleUit, relatief } from '../src/control/apparaten/apc40mk2.js';
import { parseBericht } from '../src/control/midi.js';

const c = (id) => apc.controls.get(id);

test('de introductie zet mode 0x42 (Alternate Ableton Live)', () => {
  assert.deepEqual([...INIT], [0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, 0x42, 0x00, 0x00, 0x00, 0xf7]);
});

test('het grid loopt van ONDER naar boven: pad1-1 is noot 0, pad5-8 noot 39', () => {
  assert.equal(c('pad1-1').n, 0);
  assert.equal(c('pad1-8').n, 7);
  assert.equal(c('pad2-1').n, 8);
  assert.equal(c('pad5-1').n, 32);
  assert.equal(c('pad5-8').n, 39);
  assert.equal(gridNoot(3, 4), 19);
  const pads = CONTROLS.filter((x) => x.soort === 'pad');
  assert.equal(pads.length, 40);
  assert.equal(new Set(pads.map((x) => x.n)).size, 40);
});

test('de nummers uit het protocoldocument (p13-17, p23-26)', () => {
  const noten = {
    scene1: 82, scene5: 86, devL: 58, devR: 59, bankL: 60, bankR: 61, devOn: 62, lock: 63, clipdev: 64, detail: 65,
    mastersel: 80, stopall: 81, pan: 87, sends: 88, user: 89, metro: 90, play: 91, record: 93,
    up: 94, down: 95, right: 96, left: 97, shift: 98, tap: 99, nudgeM: 100, nudgeP: 101, session: 102, bank: 103,
  };
  for (const [id, n] of Object.entries(noten)) assert.deepEqual([c(id).t, c(id).n, c(id).ch], ['noot', n, 0], id);
  for (let k = 1; k <= 8; k++) {
    for (const [id, n] of [['rec', 48], ['solo', 49], ['act', 50], ['sel', 51], ['stop', 52], ['ab', 66]]) {
      assert.deepEqual([c(`${id}${k}`).t, c(`${id}${k}`).n, c(`${id}${k}`).ch], ['noot', n, k - 1], `${id}${k}`);
    }
    assert.deepEqual([c(`fader${k}`).t, c(`fader${k}`).n, c(`fader${k}`).ch], ['cc', 7, k - 1]);
    assert.deepEqual([c(`dk${k}`).n, c(`dk${k}`).ch, c(`dk${k}`).soort], [15 + k, 0, 'draai']);
    assert.deepEqual([c(`tk${k}`).n, c(`tk${k}`).ch, c(`tk${k}`).soort], [47 + k, 0, 'draai']);
  }
  const ccs = { tempo: [13, 'rel'], cue: [47, 'rel'], master: [14, 'fader'], xf: [15, 'fader'], voet: [64, 'voet'] };
  for (const [id, [n, soort]] of Object.entries(ccs)) assert.deepEqual([c(id).t, c(id).n, c(id).soort], ['cc', n, soort], id);
  // Geen twee controls op hetzelfde bericht.
  assert.equal(new Set(CONTROLS.map((x) => `${x.t}:${x.ch}:${x.n}`)).size, CONTROLS.length);
  assert.equal(new Set(CONTROLS.map((x) => x.id)).size, CONTROLS.length);
});

test('ontleden: knoppen per kolom op het kanaal, ringknoppen absoluut, encoders tweecomplement', () => {
  const g = (b) => ontleed(parseBericht(b));
  assert.deepEqual(g([0x92, 50, 127]), { control: 'act3', soort: 'druk', waarde: 1, ruw: 127 });
  assert.equal(g([0x82, 50, 0]).soort, 'los');
  assert.equal(g([0x90, 50, 0]).soort, 'los', 'note on met velocity 0');
  assert.equal(g([0x90, 32, 127]).control, 'pad5-1');
  assert.equal(g([0x90, 0x52, 127]).control, 'scene1');
  assert.deepEqual(g([0xb0, 48, 64]), { control: 'tk1', soort: 'waarde', waarde: 64 / 127, ruw: 64 });
  assert.equal(g([0xb5, 7, 127]).control, 'fader6');
  assert.equal(g([0xb0, 13, 1]).delta, 1);
  assert.equal(g([0xb0, 13, 127]).delta, -1);
  assert.equal(relatief(64), -64);
  assert.equal(g([0xb0, 64, 127]).soort, 'druk');
  assert.equal(g([0xb0, 99, 1]), null, 'onbekende CC');
  assert.equal(g([0xf0, 0x47, 0x00, 0x29, 0x61, 0xf7]), null, 'het antwoord op de intro');
});

test('lampjes: rgb (velocity = kleur, kanaal = gedrag), eenkleurig 0/127, clip stop 1, tweekleurig, ringen', () => {
  assert.deepEqual(ledBericht(c('pad5-1'), { kleur: KLEUR.geel }), [0x90, 32, 13]);
  assert.deepEqual(ledBericht(c('scene1'), { kleur: 0 }), [0x90, 82, 0]);
  assert.deepEqual(ledBericht(c('act3'), { aan: true }), [0x92, 50, 127]);
  assert.deepEqual(ledBericht(c('act3'), { aan: false }), [0x92, 50, 0]);
  assert.deepEqual(ledBericht(c('stop2'), { aan: true }), [0x91, 52, 1]);
  assert.deepEqual(ledBericht(c('ab4'), { kleur: apc.tweekleur.oranje }), [0x93, 66, 127]);
  assert.deepEqual(ledBericht(c('tk1'), { waarde: 1 }), [0xb0, 48, 127]);
  assert.deepEqual(ringType(c('tk1'), RING.pan), [0xb0, 56, 3]);
  assert.deepEqual(ringType(c('dk8'), RING.volume), [0xb0, 31, 2]);
  assert.equal(ledBericht(c('shift'), { aan: true }), null, 'shift heeft geen lampje');
});

test('het palet: de donkere tint is n+1, nooit de pastel (n-1)', () => {
  for (const [naam, n] of Object.entries(KLEUR)) {
    if (!naam.endsWith('donker') || naam === 'donkergrijs') continue;
    assert.equal(n, KLEUR[naam.slice(0, -6)] + 1, naam);
  }
  assert.equal(apc.donker('geel'), 'geeldonker');
  assert.equal(apc.donker('wit'), 'grijs');
});

test('alles uit: elk lampje en elke ring precies één keer', () => {
  const uit = alleUit();
  const sleutels = uit.map((b) => b.join(','));
  assert.equal(new Set(sleutels).size, uit.length);
  const lampjes = CONTROLS.filter((x) => x.led !== 'geen' && x.led !== 'ring').length;
  const ringen = CONTROLS.filter((x) => x.led === 'ring').length;
  assert.equal(ringen, 16);
  assert.equal(uit.length, lampjes + 2 * ringen);
  assert.ok(uit.every((b) => b[2] === 0));
});
