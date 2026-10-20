// leren.js: het gedrag volgt uit het apparaat (fader = absoluut, ringknop en encoder =
// eindeloos, knop = trigger of schakelaar), in de open laag, met shift de shift-laag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Indeling } from '../src/control/indeling.js';
import { Leren, raadGedrag } from '../src/control/leren.js';
import apc from '../src/control/apparaten/apc40mk2.js';
import { maakBus } from './control-hulp.mjs';

function opzet() {
  const { bus, log } = maakBus();
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => 1 } });
  ind.voegToe({ schema: 1, naam: 'proef', apparaat: 'apc40mk2', regels: [
    { control: 'fader1', actie: 'track.1.fader', gedrag: 'absoluut' },
    { control: 'clipdev', actie: 'laag:device.rack', gedrag: 'schakelaar' },
  ] });
  return { ind, leren: new Leren({ indeling: ind }), log };
}

test('het gedrag komt van het apparaat', () => {
  const c = (id) => apc.controls.get(id);
  assert.deepEqual(raadGedrag(c('fader2'), 'waarde'), { gedrag: 'absoluut' });
  assert.deepEqual(raadGedrag(c('dk3'), 'waarde'), { gedrag: 'eindeloos' });
  assert.deepEqual(raadGedrag(c('cue'), 'waarde'), { gedrag: 'eindeloos' });
  assert.deepEqual(raadGedrag(c('pad1-1'), 'trigger'), { gedrag: 'trigger' });
  assert.deepEqual(raadGedrag(c('pad1-1'), 'waarde'), { gedrag: 'schakelaar' });
  assert.ok(raadGedrag(c('dk1'), 'trigger').fout);
  assert.ok(raadGedrag(c('pad1-1'), 'commando').fout);
});

test('leren: kies een actie, beweeg een control; tijdens het leren gebeurt er niets op de bus', () => {
  const { ind, leren, log } = opzet();
  const uitslagen = [];
  leren.on('gekoppeld', (u) => uitslagen.push(u));
  leren.start('track.{focus}.send.a');
  leren.voer({ control: 'dk5', soort: 'waarde', waarde: 0.4, ruw: 51 });
  assert.equal(log.length, 0);
  assert.equal(leren.bezig, false);
  assert.deepEqual({ ...ind.regelVoor('dk5') }, { control: 'dk5', actie: 'track.{focus}.send.a', gedrag: 'eindeloos' });
  leren.start('track.1.mid');
  leren.voer({ control: 'fader1', soort: 'waarde', waarde: 0.5, ruw: 64 });
  assert.equal(uitslagen[1].was, 'track.1.fader', 'zegt wat er stond');
  assert.equal(ind.regelVoor('fader1').gedrag, 'absoluut');
  // Een JSON om te bewaren, met de geleerde regels erin.
  assert.ok(ind.naarJSON().regels.some((r) => r.control === 'dk5'));
});

test('leren in de open laag en met shift in de shift-laag; de shiftknop zelf wordt geen regel', () => {
  const { ind, leren } = opzet();
  ind.verwerk({ control: 'clipdev', soort: 'druk' });
  assert.deepEqual(ind.open, ['device.rack']);
  leren.start('track.{focus}.fx.knop.3');
  leren.voer({ control: 'shift', soort: 'druk' });
  leren.voer({ control: 'dk3', soort: 'waarde', waarde: 0.1, ruw: 13 });
  ind.verwerk({ control: 'shift', soort: 'los' });    // na het leren gaat alles weer naar de indeling
  assert.equal(ind.shift, false);
  const r = ind.actief.op.get('dk3#shift@device.rack');
  assert.equal(r.actie, 'track.{focus}.fx.knop.3');
  // Een laag op een knop leren kan ook.
  leren.start('laag:grid.klank');
  leren.voer({ control: 'scene3', soort: 'druk' });
  assert.equal(ind.actief.op.get('scene3@device.rack').gedrag, 'trigger');
});

test('wat niet kan: een commando op een knop, een knopactie op een draaiknop (met een reden)', () => {
  const { ind, leren } = opzet();
  const niet = [];
  leren.on('niet', (n) => niet.push(n.reden));
  leren.start('track.1.laad');
  leren.voer({ control: 'pad1-1', soort: 'druk' });
  leren.start('track.1.play');
  leren.voer({ control: 'dk1', soort: 'waarde', waarde: 0, ruw: 0 });
  assert.equal(niet.length, 2);
  assert.equal(ind.regelVoor('pad1-1'), null);
  assert.equal(leren.bezig, true, 'blijft wachten op een control die wel kan');
});
