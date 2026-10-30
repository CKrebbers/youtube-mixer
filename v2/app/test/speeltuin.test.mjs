// De speeltuin: lege toestellen, een knop aanraken = meteen een voorstel dat speelt, F1–F8 kiezen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { Indeling } from '../src/control/indeling.js';
import apc from '../src/control/apparaten/apc40mk2.js';
import { maschineMk2 } from '../src/control/apparaten/maschine-mk2.js';
import { Speeltuin, NAAM, kolomVan, nummerVan, PER_RIJ } from '../src/control/speeltuin.js';
import { BYTES } from '../src/control/maschine-scherm.js';

function opzet() {
  const e = new Engine({ ctx: nepCtx(), audio: nepAudio(), timer: false });
  const acties = [];
  e.bus.on('actie', (a) => acties.push(a));
  const vars = { focus: () => 1 };
  const ind = {
    apc: new Indeling({ bus: e.bus, apparaat: apc, vars, bron: 'apc' }),
    maschine: new Indeling({ bus: e.bus, apparaat: maschineMk2, vars, bron: 'maschine' }),
  };
  const tuin = new Speeltuin({ bus: e.bus, indelingen: ind, nu: () => 0 });
  const log = [], bewaard = [];
  tuin.on('log', (l) => log.push(l));
  tuin.on('bewaar', (b) => bewaard.push(b));
  tuin.start();
  // zoals controllers.js: eerst de speeltuin, dan (als hij hem niet opeet) de indeling
  const voer = (app, g) => { if (!tuin.voer(app, g)) ind[app].verwerk(g); };
  return { e, ind, tuin, voer, acties, log, bewaard };
}

test('de toestellen beginnen leeg', () => {
  const { ind } = opzet();
  assert.equal(ind.apc.actief.naam, NAAM);
  assert.equal(ind.maschine.actief.naam, NAAM);
  assert.equal(ind.apc.actieveRegels().size, 0);
  assert.equal(ind.maschine.actieveRegels().size, 0);
});

test('een lege fader aanraken: hij krijgt voorstel 1 en speelt bij dezelfde beweging', () => {
  const { ind, voer, acties, bewaard } = opzet();
  voer('apc', { control: 'fader3', soort: 'waarde', waarde: 0.7, ruw: 89 });
  const r = ind.apc.regelVoor('fader3');
  assert.equal(r.actie, 'track.3.fader', 'een fader in kolom 3 stelt eerst het volume van track 3 voor');
  assert.equal(r.gedrag, 'absoluut');
  assert.equal(bewaard.at(-1).app, 'apc');
  assert.equal(bewaard.at(-1).doc.regels.length, 1);
  // de eerste beweging gaat al naar de bus (soft-takeover kan hem houden tot hij de stand kruist)
  voer('apc', { control: 'fader3', soort: 'waarde', waarde: 0.8, ruw: 102 });
  assert.ok(acties.some((a) => a.id === 'track.3.fader') || ind.apc.staat.has('fader3'));
});

test('F1–F4 kiezen in het rijtje, F5 is het volgende rijtje, F7 terug, F6 leeg', () => {
  const { tuin, ind, voer, log } = opzet();
  voer('maschine', { control: 'pad5', soort: 'druk', waarde: 0.9, ruw: 115 });
  voer('maschine', { control: 'pad5', soort: 'los', waarde: 0, ruw: 0 });
  let s = tuin.stand().hand;
  assert.equal(s.rijtje.length, PER_RIJ);
  assert.equal(s.rijtje[0].fam, 'gebaar', 'op een Maschine-pad eerst een gebaar');
  assert.equal(ind.maschine.regelVoor('pad5').gedrag, 'druk');
  // F3
  voer('maschine', { control: 'f3', soort: 'druk', waarde: 1 });
  voer('maschine', { control: 'f3', soort: 'los', waarde: 0 });
  s = tuin.stand().hand;
  assert.equal(s.keuze, 2);
  assert.equal(ind.maschine.regelVoor('pad5').actie, s.rijtje[2].actie);
  // F5: rij 2, eerste voorstel
  voer('maschine', { control: 'f5', soort: 'druk', waarde: 1 });
  s = tuin.stand().hand;
  assert.equal(s.rij, 1);
  assert.equal(s.keuze, PER_RIJ);
  // F7: terug naar rij 1
  voer('maschine', { control: 'f7', soort: 'druk', waarde: 1 });
  assert.equal(tuin.stand().hand.rij, 0);
  // F8 goed, F6 leeg
  voer('maschine', { control: 'f8', soort: 'druk', waarde: 1 });
  assert.equal(log.at(-1).wat, 'goed');
  voer('maschine', { control: 'f6', soort: 'druk', waarde: 1 });
  assert.equal(ind.maschine.regelVoor('pad5'), null);
  assert.equal(log.at(-1).wat, 'leeg');
});

test('F-knoppen gaan nooit naar de bus en zijn niet te vullen', () => {
  const { voer, acties, ind } = opzet();
  voer('maschine', { control: 'f1', soort: 'druk', waarde: 1 });
  assert.equal(acties.length, 0);
  assert.equal(ind.maschine.regelVoor('f1'), null);
});

test('een volle knop aanraken speelt gewoon; daarna verandert een F-knop hem', () => {
  const { tuin, ind, voer } = opzet();
  voer('apc', { control: 'act2', soort: 'druk', waarde: 1 });
  voer('apc', { control: 'act2', soort: 'los', waarde: 0 });
  const eerst = ind.apc.regelVoor('act2').actie;
  assert.equal(eerst, 'track.2.play');
  voer('apc', { control: 'fader1', soort: 'waarde', waarde: 0.2 });   // andere knop
  voer('apc', { control: 'act2', soort: 'druk', waarde: 1 });          // terug: blijft play
  assert.equal(ind.apc.regelVoor('act2').actie, eerst);
  assert.equal(tuin.stand().hand.keuze, 0);
  voer('maschine', { control: 'f2', soort: 'druk', waarde: 1 });
  assert.notEqual(ind.apc.regelVoor('act2').actie, eerst);
});

test('voorstellen passen bij de knop: geen trigger op een fader, encoders krijgen ook ± paren', () => {
  const { tuin } = opzet();
  for (const k of tuin.kandidaten('apc', 'fader1')) assert.equal(k.gedrag, 'absoluut');
  const enc = tuin.kandidaten('maschine', 'enc1');
  assert.ok(enc.some((k) => k.gedrag === 'trigger' && k.terug), 'tempo ± of sprong als paar');
  assert.ok(enc.every((k) => k.gedrag === 'eindeloos' || k.terug));
  const drums = tuin.kandidaten('maschine', 'pad7').filter((k) => k.actie.startsWith('speel.drum.'));
  assert.deepEqual(drums.map((k) => [k.actie, k.gedrag]), [['speel.drum.7', 'aanslag']]);
});

test('wat al op een andere knop staat komt achteraan', () => {
  const { tuin, voer } = opzet();
  voer('maschine', { control: 'pad1', soort: 'druk', waarde: 1 });
  const eerste = tuin.stand().hand.rijtje[0].actie;
  voer('maschine', { control: 'pad1', soort: 'los', waarde: 0 });
  const lijst = tuin.kandidaten('maschine', 'pad2');
  assert.equal(lijst.at(-1).actie === eerste || lijst.findIndex((k) => k.actie === eerste) > lijst.length / 2, true);
});

test('shift vast: de shift-laag van een knop vullen', () => {
  const { ind, voer } = opzet();
  voer('apc', { control: 'shift', soort: 'druk', waarde: 1 });
  voer('apc', { control: 'act1', soort: 'druk', waarde: 1 });
  voer('apc', { control: 'act1', soort: 'los', waarde: 0 });
  voer('apc', { control: 'shift', soort: 'los', waarde: 0 });
  assert.equal(ind.apc.regelVoor('act1', { shift: false }), null);
  assert.ok(ind.apc.regelVoor('act1', { shift: true }));
});

test('hulp: kolom en nummer van een knop', () => {
  assert.equal(kolomVan('fader4'), 4);
  assert.equal(kolomVan('pad3-6'), 6);
  assert.equal(kolomVan('dk2'), null);
  assert.equal(nummerVan('pad2-3'), 11);
  assert.equal(nummerVan('pad12'), 12);
  assert.ok(nummerVan('browse') >= 1 && nummerVan('browse') <= 8);
});

test('de schermen tekenen, met en zonder knop in de hand', () => {
  const { tuin, voer } = opzet();
  assert.equal(tuin.scherm(0).length, BYTES);
  assert.equal(tuin.scherm(1).length, BYTES);
  voer('apc', { control: 'tk1', soort: 'waarde', waarde: 0.5 });
  assert.equal(tuin.scherm(0).length, BYTES);
  assert.ok(tuin.scherm(1).some((b) => b !== 0));
});
