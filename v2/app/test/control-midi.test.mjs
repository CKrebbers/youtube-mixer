// midi.js: parsen, de wachtrij (16 per 4 ms, met een nepklok), het echofilter
// (alleen CC), poorten op naam en opnieuw aansluiten. Nooit een echte poort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBericht, Wachtrij, MidiHub, PER_VENSTER, VENSTER_MS, ECHO_MS } from '../src/control/midi.js';
import { NepKlok, nepIn, nepUit, nepToegang, nepApc, maxInVenster } from './control-hulp.mjs';

test('parsen: note on met velocity 0 is een note off, cc, pitchbend 14 bit, sysex', () => {
  const a = parseBericht([0x92, 50, 127]);
  assert.deepEqual([a.type, a.kanaal, a.nummer, a.aan, a.sig], ['noot', 2, 50, true, 'noot:2:50']);
  const b = parseBericht([0x92, 50, 0]);
  assert.equal(b.aan, false);
  assert.equal(parseBericht([0x82, 50, 64]).aan, false);
  const c = parseBericht([0xb0, 48, 127]);
  assert.deepEqual([c.type, c.waarde, c.norm, c.sig], ['cc', 127, 1, 'cc:0:48']);
  assert.equal(parseBericht([0xe0, 0x7f, 0x7f]).waarde, 16383);
  assert.equal(parseBericht([0xf0, 0x47, 0x7f, 0xf7]).type, 'sysex');
  assert.equal(parseBericht([0xf8]).sig, 'clock');
});

test('wachtrij: nooit meer dan 16 in een venster van 4 ms, alles komt aan, in volgorde', () => {
  const klok = new NepKlok();
  const uit = [];
  const w = new Wachtrij({ stuur: (b) => uit.push({ t: klok.nu(), b }), klok: klok.nu, timers: klok.timers });
  for (let i = 0; i < 141; i++) w.zet([0x90, i % 128, i % 2]);
  assert.equal(uit.length, PER_VENSTER, 'de eerste 16 gaan meteen');
  klok.loop(100);
  assert.equal(uit.length, 141);
  assert.ok(maxInVenster(uit, VENSTER_MS) <= PER_VENSTER, `max ${maxInVenster(uit, VENSTER_MS)} in 4 ms`);
  assert.deepEqual(uit.map((x) => x.b[1]), Array.from({ length: 141 }, (_, i) => i % 128));
  assert.ok(uit.at(-1).t <= 40, `een volledige verversing duurt ${uit.at(-1).t} ms`);
});

test('wachtrij: schuivend venster, niet per blok van 4 ms', () => {
  const klok = new NepKlok();
  const uit = [];
  const w = new Wachtrij({ stuur: (b) => uit.push({ t: klok.nu(), b }), klok: klok.nu, timers: klok.timers });
  for (let i = 0; i < 10; i++) w.zet([0x90, i, 1]);
  klok.loop(2);
  for (let i = 10; i < 20; i++) w.zet([0x90, i, 1]);
  assert.equal(uit.length, 16, 'op t=2 nog maar 6 plaatsen');
  klok.loop(1.9);
  assert.equal(uit.length, 16, 'vóór t=4 niets meer');
  klok.loop(0.2);
  assert.equal(uit.length, 20);
  assert.ok(maxInVenster(uit, VENSTER_MS) <= PER_VENSTER);
  // Met plaats: meteen, zonder timer.
  klok.loop(10);
  w.zet([0x90, 99, 1]);
  assert.equal(uit.length, 21);
  assert.equal(uit.at(-1).t, klok.nu());
});

test('poorten: de APC op naam; geen speelapparaat, geen doorgeefpoort, geen losgetrokken poort', () => {
  const klok = new NepKlok();
  const t = nepToegang({
    ins: [nepIn('x', 'Xboard49'), nepIn('m', 'Maschine MK2 Virtual Input'), nepIn('iac', 'IAC APC40 bus'), nepIn('los', 'APC40 mkII', 'disconnected'), nepIn('apc', 'APC40 mkII')],
    uits: [nepUit('apc', 'APC40 mkII', klok)],
  });
  const hub = new MidiHub({ toegang: t, klok: klok.nu, timers: klok.timers }).start();
  assert.equal(hub.invoer().id, 'apc');
  assert.equal(hub.uitvoer().id, 'apc');
  const zonder = new MidiHub({ toegang: nepToegang({ ins: [nepIn('x', 'Xboard49')], uits: [] }) }).start();
  assert.equal(zonder.invoer(), null, 'zonder APC kiest hij niets (ook geen keyboard)');
});

test('echofilter: alleen CC binnen 60 ms; een noot wordt nooit gefilterd', () => {
  const klok = new NepKlok();
  const { i, toegang } = nepApc(klok);
  const hub = new MidiHub({ toegang, klok: klok.nu, timers: klok.timers }).start();
  const binnen = [];
  hub.on('bericht', (m) => binnen.push(m.sig + '=' + m.waarde));
  hub.stuur([0xb0, 48, 64]);          // ring van track knob 1
  hub.stuur([0x90, 50, 127]);         // lampje van activator 1 aan
  hub.stuur([0x90, 51, 0]);           // lampje track select 1 uit
  i.stuur([0xb0, 48, 64]);            // komt terug: echo
  i.stuur([0x90, 50, 127]);           // een echte druk (zelfde bytes als het lampje)
  i.stuur([0x90, 51, 0]);             // een echt loslaten
  assert.deepEqual(binnen, ['noot:0:50=127', 'noot:0:51=0']);
  assert.equal(hub.echos, 1);
  hub.stuur([0xb0, 49, 10]);
  klok.loop(ECHO_MS + 1);
  i.stuur([0xb0, 49, 10]);
  assert.equal(binnen.at(-1), 'cc:0:49=10', 'na 60 ms is het geen echo meer');
});

test('echofilter: een ring op de waarde die de knop net zelf stuurde wordt niet onthouden (behalve 0 en 127)', () => {
  const klok = new NepKlok();
  const { i, toegang } = nepApc(klok);
  const hub = new MidiHub({ toegang, klok: klok.nu, timers: klok.timers }).start();
  const binnen = [];
  hub.on('bericht', (m) => binnen.push(m.waarde));
  i.stuur([0xb0, 48, 70]);
  hub.stuur([0xb0, 48, 70]);          // de ring volgt de knop
  i.stuur([0xb0, 48, 70]);            // terugdraaien naar 70 is een echte draai
  assert.deepEqual(binnen, [70, 70]);
  i.stuur([0xb0, 48, 127]);
  hub.stuur([0xb0, 48, 127]);
  i.stuur([0xb0, 48, 127]);           // op de aanslag blijft het filter waken
  assert.deepEqual(binnen, [70, 70, 127]);
});

test('opnieuw aansluiten: weg = alles los, terug = opnieuw verbonden (init), wachtrij leeg bij weg', () => {
  const klok = new NepKlok();
  const { i, o, toegang } = nepApc(klok);
  const hub = new MidiHub({ toegang, klok: klok.nu, timers: klok.timers });
  const ev = [];
  for (const e of ['verbonden', 'weg', 'invoer']) hub.on(e, () => ev.push(e));
  hub.start();
  assert.deepEqual(ev, ['invoer', 'verbonden']);
  for (let k = 0; k < 40; k++) hub.stuur([0x90, k, 1]);
  assert.ok(hub.wachtrij.lengte > 0);
  toegang.zetState('disconnected', i.id, o.id);
  assert.deepEqual(ev, ['invoer', 'verbonden', 'weg']);
  assert.equal(hub.wachtrij.lengte, 0, 'niets meer naar een apparaat dat weg is');
  assert.equal(hub.stuur([0x90, 1, 1]), false);
  toegang.zetState('connected', i.id, o.id);
  assert.deepEqual(ev, ['invoer', 'verbonden', 'weg', 'invoer', 'verbonden']);
  // Een bericht op de ingang die niet gekozen is, telt niet.
  const ander = nepIn('ander', 'Launchpad');
  toegang.inputs.set('ander', ander);
  toegang.onstatechange({});
  let n = 0;
  hub.on('bericht', () => n++);
  ander.stuur([0x90, 1, 127]);
  i.stuur([0x90, 1, 127]);
  assert.equal(n, 1);
});
