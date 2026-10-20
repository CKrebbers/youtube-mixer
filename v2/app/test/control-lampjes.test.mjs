// lampjes.js: init (0x42) en zwart, diffing (een tweede tik zonder verandering = 0
// bytes), de drie standen, knipperen op de tel, lagen, ringen, wek na een actie,
// en alles samen door de wachtrij (16 per 4 ms) bij opnieuw aansluiten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Indeling } from '../src/control/indeling.js';
import { Lampjes, TIK_MS } from '../src/control/lampjes.js';
import { MidiHub, PER_VENSTER, VENSTER_MS } from '../src/control/midi.js';
import apc, { INIT, KLEUR } from '../src/control/apparaten/apc40mk2.js';
import { maakBus, NepKlok, nepApc, maxInVenster } from './control-hulp.mjs';

const doc = (regels) => ({ schema: 1, naam: 'proef', apparaat: 'apc40mk2', regels });

function opzet(regels, { stand = {}, tel = () => null } = {}) {
  const klok = new NepKlok();
  const { bus, waarden } = maakBus({ stand });
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => 1 }, nu: klok.nu });
  ind.voegToe(doc(regels));
  const uit = [];
  const l = new Lampjes({ indeling: ind, stuur: (b) => uit.push(b), tel, nu: klok.nu, timers: klok.timers });
  return { ind, bus, waarden, klok, uit, l };
}
const bytesVoor = (uit, status, n) => uit.filter((b) => b[0] === status && b[1] === n).at(-1);

test('init: eerst de introductie (0x42), dan alles zwart, dan de stand', () => {
  const { uit, l } = opzet([{ control: 'pad5-1', actie: 'track.1.hotcue.1', gedrag: 'trigger', led: { kleur: 'geel' } }], { stand: { 'track.1.hotcue.1': 1 } });
  l.init();
  assert.deepEqual(uit[0], [...INIT]);
  const zwart = apc.alleUit().length;
  assert.ok(uit.slice(1, 1 + zwart).every((b) => b[2] === 0));
  assert.deepEqual(bytesVoor(uit, 0x90, 32), [0x90, 32, KLEUR.geel]);
});

test('diffing: een tweede tik zonder verandering stuurt 0 bytes; een verandering precies één', () => {
  const { uit, l, bus } = opzet([
    { control: 'fader{k}', actie: 'track.{k}.fader', gedrag: 'absoluut' },
    { control: 'tk{k}', actie: 'track.{k}.filter', gedrag: 'eindeloos', led: { ring: 'pan' } },
    { control: 'act{k}', actie: 'track.{k}.play', gedrag: 'trigger' },
    { control: 'pad5-{k}', actie: 'track.{k}.hotcue.1', gedrag: 'trigger', led: { kleur: 'geel' } },
  ]);
  l.init();
  uit.length = 0;
  assert.equal(l.tik(), 0);
  assert.equal(uit.length, 0);
  bus.doe('track.3.filter', 0.25);
  assert.equal(l.tik(), 1);
  assert.deepEqual(uit, [[0xb0, 50, Math.round(0.25 * 127)]]);
  assert.equal(l.tik(), 0);
});

test('drie standen uit lees: null = uit, 0 = donkergrijs, ertussen = donkere tint, 1 = volle kleur', () => {
  const { l, waarden, uit } = opzet([{ control: 'pad5-1', actie: 'track.1.hotcue.1', gedrag: 'trigger', led: { kleur: 'geel' } },
    { control: 'act1', actie: 'track.1.play', gedrag: 'trigger' }]);
  l.init();
  const pad = () => l.gewild().get('pad5-1')[2];
  const act = () => l.gewild().get('act1')[2];
  assert.equal(pad(), 0, 'null: uit (lege track)');
  waarden.set('track.1.hotcue.1', 0); assert.equal(pad(), KLEUR.donkergrijs);
  waarden.set('track.1.hotcue.1', 0.5); assert.equal(pad(), KLEUR.geeldonker);
  waarden.set('track.1.hotcue.1', 1); assert.equal(pad(), KLEUR.geel);
  waarden.set('track.1.play', 0); assert.equal(act(), 0);
  waarden.set('track.1.play', 0.5); assert.equal(act(), 127, 'speelt: aan');
  waarden.set('track.1.play', true); assert.equal(act(), 127);
  void uit;
});

test('knipperen op de tel: fel op de tel (een kwart, op de "1" een halve), gedimd ertussen; eenkleurig even uit', () => {
  let tel = null;
  const { l, waarden } = opzet([
    { control: 'pad1-1', actie: 'track.1.loop', gedrag: 'trigger', led: { kleur: 'cyaan', tel: 'aan' } },
    { control: 'stop1', actie: 'track.1.loop', gedrag: 'trigger', led: { tel: 'aan' } },
  ], { tel: () => tel });
  l.init();
  waarden.set('track.1.loop', 1);
  const pad = () => l.gewild().get('pad1-1')[2];
  const stop = () => l.gewild().get('stop1')[2];
  assert.equal(pad(), KLEUR.cyaan, 'zonder tel: gewoon aan');
  tel = 0.1; assert.equal(pad(), KLEUR.cyaan); assert.equal(stop(), 0);
  tel = 0.4; assert.equal(pad(), KLEUR.cyaandonker); assert.equal(stop(), 1);
  tel = { fase: 0.4, een: true }; assert.equal(pad(), KLEUR.cyaan, 'op de "1" langer');
  waarden.set('track.1.loop', 0);
  tel = 0.1; assert.equal(pad(), KLEUR.donkergrijs, 'uit knippert niet');
});

test('een andere laag: de pads krijgen de kleuren van die laag; wat geen regel meer heeft gaat uit', () => {
  const { l, ind, uit } = opzet([
    { control: 'pad5-{k}', actie: 'track.{k}.hotcue.1', gedrag: 'trigger', led: { kleur: 'geel' } },
    { control: 'pad4-{k}', actie: 'track.{k}.hotcue.2', gedrag: 'trigger', led: { kleur: 'geel' } },
    { control: 'pad5-{k}', laag: 'grid.klank', actie: 'track.{k}.kill.hoog', gedrag: 'trigger', led: { kleur: { aan: 'rood', uit: 'rooddonker' } } },
    { control: 'scene3', actie: 'laag:grid.klank', gedrag: 'schakelaar', led: { kleur: 'magenta' } },
  ], { stand: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [[`track.${k}.hotcue.2`, 1], [`track.${k}.kill.hoog`, 0]])) });
  l.init();
  assert.equal(bytesVoor(uit, 0x90, 0x54)[2], KLEUR.magentadonker, 'scene 3 gedimd: dicht');
  ind.verwerk({ control: 'scene3', soort: 'druk' });
  uit.length = 0;
  l.tik();
  assert.equal(bytesVoor(uit, 0x90, 32)[2], KLEUR.rooddonker, 'kill hoog, open');
  assert.equal(bytesVoor(uit, 0x90, 0x54)[2], KLEUR.magenta);
  assert.equal(bytesVoor(uit, 0x90, 24), undefined, 'pad4 (hotcue 2) blijft wat hij was');
  assert.equal(uit.length, 8 + 1);
});

test('ringen: de stand van de bus, type pan voor een bipolaire knop, uit zonder actie', () => {
  const { l, uit } = opzet([
    { control: 'tk1', actie: 'track.1.filter', gedrag: 'eindeloos', led: { ring: 'pan' } },
    { control: 'dk1', actie: 'track.1.send.a', gedrag: 'eindeloos' },
    { control: 'dk2', actie: 'bestaat.niet', gedrag: 'eindeloos' },
  ], { stand: { 'track.1.filter': 0.5, 'track.1.send.a': 1 } });
  l.init();
  assert.deepEqual(bytesVoor(uit, 0xb0, 56), [0xb0, 56, apc.ring.pan]);
  assert.deepEqual(bytesVoor(uit, 0xb0, 48), [0xb0, 48, 64]);
  assert.deepEqual(bytesVoor(uit, 0xb0, 24), [0xb0, 24, apc.ring.volume]);
  assert.deepEqual(bytesVoor(uit, 0xb0, 16), [0xb0, 16, 127]);
  assert.deepEqual(bytesVoor(uit, 0xb0, 25), [0xb0, 25, apc.ring.uit], 'onbekende actie: ring uit');
});

test('wek: een actie op de bus zet het lampje meteen (microtaak), niet pas op de tik van 33 ms; ringen wachten', async () => {
  const { l, bus, uit, klok } = opzet([
    { control: 'solo1', actie: 'track.1.pfl', gedrag: 'schakelaar' },
    { control: 'tk1', actie: 'track.1.filter', gedrag: 'eindeloos' },
  ]);
  l.init();
  l.start();
  uit.length = 0;
  klok.loop(10);                       // na de init-tik: wek mag weer
  bus.doe('track.1.pfl', true);
  bus.doe('track.1.filter', 0.1);
  assert.equal(uit.length, 0, 'nog in dezelfde taak');
  await Promise.resolve();
  assert.deepEqual(uit, [[0x90, 49, 127]], 'alleen het lampje');
  klok.loop(TIK_MS);
  assert.deepEqual(uit.at(-1), [0xb0, 48, Math.round(0.1 * 127)], 'de ring op de tik');
  l.stop();
});

test('samen met midi.js: init na opnieuw aansluiten, en nooit meer dan 16 berichten in 4 ms', () => {
  const klok = new NepKlok();
  const { o, i, toegang } = nepApc(klok);
  const { bus } = maakBus();
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => 1 }, nu: klok.nu });
  ind.voegToe(doc([
    { control: 'pad{k}-1', actie: 'track.1.hotcue.{k}', gedrag: 'trigger', led: { kleur: 'geel' } },
    { control: 'act{k}', actie: 'track.{k}.play', gedrag: 'trigger' },
    { control: 'tk{k}', actie: 'track.{k}.filter', gedrag: 'eindeloos' },
  ]));
  const hub = new MidiHub({ toegang, klok: klok.nu, timers: klok.timers });
  const l = new Lampjes({ indeling: ind, stuur: (b, opt) => hub.stuur(b, opt), stuurSysex: (b) => hub.stuurSysex(b), nu: klok.nu, timers: klok.timers });
  hub.on('verbonden', () => l.init());
  hub.on('weg', () => { ind.losgekoppeld(); l.klaar = false; });
  hub.start();
  l.start();
  klok.loop(200);
  const inits = () => o.ontvangen.filter((x) => x.bytes[0] === 0xf0).length;
  assert.equal(inits(), 1);
  assert.ok(maxInVenster(o.ontvangen, VENSTER_MS) <= PER_VENSTER, `max ${maxInVenster(o.ontvangen, VENSTER_MS)}`);
  toegang.zetState('disconnected', i.id, o.id);
  klok.loop(200);
  const voor = o.ontvangen.length;
  toegang.zetState('connected', i.id, o.id);
  klok.loop(200);
  assert.equal(inits(), 2, 'na een replug opnieuw 0x42');
  assert.ok(o.ontvangen.length - voor > 100, 'en alles opnieuw');
  assert.ok(maxInVenster(o.ontvangen, VENSTER_MS) <= PER_VENSTER);
  l.stop();
});

test('een actie die pas later op de bus komt (plak 2) krijgt alsnog zijn lampje', () => {
  const klok = new NepKlok();
  const { bus } = maakBus({ alleen: ['track.{n}.play'] });
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => 1 }, nu: klok.nu });
  ind.voegToe(doc([{ control: 'pad5-1', actie: 'track.1.hotcue.1', gedrag: 'trigger', led: { kleur: 'geel' } }]));
  const uit = [];
  const l = new Lampjes({ indeling: ind, stuur: (b) => uit.push(b), nu: klok.nu, timers: klok.timers });
  l.init();
  assert.equal(l.gewild().get('pad5-1')[2], 0);
  bus.defineer({ id: 'track.{n}.hotcue.1', soort: 'trigger', doe() {}, lees: () => 1 });
  for (let i = 0; i < 31; i++) l.tik();
  assert.equal(l.gewild().get('pad5-1')[2], KLEUR.geel);
});
