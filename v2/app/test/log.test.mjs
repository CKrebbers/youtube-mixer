/**
 * Het handelingenlog: beginstand, een regel per actie op de audioklok (met de bron), laden, ASCII,
 * stukken op hun byte, en wat er niet in hoort.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { ascii, setId } from '../src/engine/log.js';
import { nepCtx, nepAudio, nepNummer } from './nep-audio.mjs';

async function opzet() {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), timer: false });
  await e.klaar;
  return { e, ctx, bus: e.bus };
}
const regels = (tekst) => tekst.trim().split('\n').map((r) => JSON.parse(r));

test('beginstand, dan elke actie met zijn tijd op de audioklok, de bron als die niet het scherm is', async () => {
  const { e, ctx, bus } = await opzet();
  await e.laad(1, nepNummer({ id: 'yt:a', bpm: 120 }));
  ctx.currentTime = 10;
  e.log.start('set-20261020-100000');
  ctx.currentTime = 10.5; bus.doe('track.1.fader', 0.25);
  ctx.currentTime = 11.25; bus.doe('track.1.play', true, { bron: 'apc' });
  bus.doe('klok.fase', 0.3);                     // log: 'overslaan'
  const s = e.log.stuk();
  assert.equal(s.van, 0);
  const r = regels(s.tekst);
  assert.equal(r[0].versie, 1);
  assert.equal(r[0].stand.waarden['track.1.fader'], 1, 'de beginstand: de fader stond open');
  assert.deepEqual(r[0].stand.tracks, [{ n: 1, id: 'yt:a', titel: 'yt:a' }]);
  assert.deepEqual(r[1], [0.5, 'track.1.fader', 0.25]);
  assert.deepEqual(r[2], [1.25, 'track.1.play', true, { bron: 'apc' }]);
  assert.equal(r.length, 3, 'klok.fase hoort er niet in');
});

test('laden: een regel met wat er geladen werd, niet het hele nummer', async () => {
  const { e, bus } = await opzet();
  e.log.start('set-20261020-100001');
  e.log.stuk();
  await e.laad(2, nepNummer({ id: 'yt:b', bpm: 128 }));
  const r = regels(e.log.stuk().tekst);
  assert.deepEqual(r.map((x) => x.laad).filter(Boolean), [{ n: 2, id: 'yt:b', titel: 'yt:b' }]);
  bus.doe('track.2.laad', { ...nepNummer({ id: 'yt:c' }), zeker: true });
  await new Promise((res) => setTimeout(res, 0));
  const r2 = regels(e.log.stuk().tekst);
  assert.ok(r2.every((x) => !Array.isArray(x) || !x[1].endsWith('.laad')), 'het commando zelf niet (met een functie erin)');
});

test('stukken: aaneensluitend op hun byte; alleen ASCII', async () => {
  const { e, bus } = await opzet();
  e.log.start('set-20261020-100002');
  const a = e.log.stuk();
  bus.doe('mixer.xfader', 0.7);
  const b = e.log.stuk();
  assert.equal(b.van, a.tekst.length);
  assert.equal(e.log.stuk(), null, 'niets nieuws');
  e.log.merk({ opname: 'x', titel: 'Café' });
  const c = e.log.stuk();
  assert.ok(/^[\x00-\x7f]*$/.test(c.tekst), 'ASCII');
  assert.equal(JSON.parse(c.tekst).titel, 'Café', 'en terug te lezen');
  assert.equal(ascii('é'), '"\\u00e9"');
});

test('stop: het laatste stuk, daarna niets meer', async () => {
  const { e, bus } = await opzet();
  e.log.start('set-20261020-100003');
  bus.doe('mixer.xfader', 0.2);
  const laatste = e.log.stop();
  assert.ok(laatste.tekst.includes('mixer.xfader'));
  bus.doe('mixer.xfader', 0.3);
  assert.equal(e.log.stuk(), null);
  assert.equal(e.log.loopt, false);
});

test('setId: set-JJJJMMDD-UUMMSS', () => {
  assert.equal(setId(new Date(2026, 9, 20, 9, 5, 3)), 'set-20261020-090503');
});

test('opname zonder opnemer: geweigerd met een reden; de actie leest null', async () => {
  const { e, bus } = await opzet();
  assert.equal(bus.lees('opname'), null);
  const r = await e.opname(true);
  assert.ok(r.geweigerd);
});
