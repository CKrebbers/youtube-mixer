/**
 * Lus, beatjump en hotcues op een track (plak 2), gekoppeld en vrij. De motor (de nep-speler met
 * de formule van de kern, ook het terugvouwen) en de track zeggen steeds hetzelfde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio, nepNummer } from './nep-audio.mjs';

const dicht = (a, b, eps = 1e-6, wat = '') => assert.ok(Math.abs(a - b) < eps, `${wat} ${a} ≉ ${b}`);

async function opzet() {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), timer: false });
  await e.klaar;
  const zet = (t) => { ctx.currentTime = t; e.tik(); };
  return { e, ctx, zet, bus: e.bus };
}
const fase = (e, n, t) => { const tr = e.track(n); const d = tr.grid.beatAt(tr.speler.positie(t)) - e.klok.tel(t); return d - Math.round(d); };
const motorIsTrack = (e, n, t0, t1) => {
  for (let t = t0; t < t1; t += 0.037) dicht(e.track(n).speler.positie(t), e.track(n).plek(t), 1e-9, `motor = track op ${t.toFixed(3)}`);
};

test('lus op een gekoppelde track: 4 tellen vanaf de tel onder de plek, blijft op de klok, motor = track', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124, anker: 0.3 }));
  zet(1); bus.doe('track.1.play', true);
  zet(10);
  bus.doe('track.1.loop', true);
  const l = e.track(1).lus;
  assert.ok(l, 'lus staat');
  assert.equal(l.n, 4);
  dicht(l.B - l.A, 4 * 60 / 124, 1e-9, 'vier tellen');
  zet(30);
  const P = e.track(1).plek(30);
  assert.ok(P >= l.A && P < l.B, 'binnen de lus');
  dicht(fase(e, 1, 30), 0, 1e-9, 'op de klok');
  motorIsTrack(e, 1, 10.1, 30);
  assert.equal(bus.lees('track.1.loop'), 1);
});

test('lus uit: geen sprong, en hij loopt verder vanaf waar hij in de lus was (op de klok)', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  zet(5); bus.doe('track.1.loop', true);
  zet(20);
  const A = e.straks(), voor = e.track(1).plek(A);
  bus.doe('track.1.loop', true);
  assert.equal(e.track(1).lus, null);
  dicht(e.track(1).plek(A), voor, 1e-9, 'geen sprong');
  zet(25);
  dicht(fase(e, 1, 25), 0, 1e-9);
  assert.ok(e.track(1).plek(25) > voor, 'loopt door');
  motorIsTrack(e, 1, A + 0.001, 25);
});

test('halveren en verdubbelen: de lus verandert mee, het begin blijft; 1/2 tel kan ook', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 120 }));
  zet(1); bus.doe('track.1.play', true);
  zet(4); bus.doe('track.1.loop', true);
  const A0 = e.track(1).lus.A;
  bus.doe('track.1.loop.halveer', true);
  bus.doe('track.1.loop.halveer', true);
  bus.doe('track.1.loop.halveer', true);   // 4 -> 2 -> 1 -> 1/2
  assert.equal(e.track(1).lus.n, 0.5);
  dicht(e.track(1).lus.A, A0, 1e-9, 'begin blijft');
  zet(8);
  const P = e.track(1).plek(8);
  assert.ok(P >= A0 && P < A0 + 0.25 + 1e-9, `binnen een halve tel (${P - A0})`);
  motorIsTrack(e, 1, 4.1, 8);
  bus.doe('track.1.loop.verdubbel', true);
  assert.equal(e.track(1).lus.n, 1);
});

test('een sprong buiten de lus haalt hem eraf; erbinnen blijft hij', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  zet(5); bus.doe('track.1.loop', true);
  const l = e.track(1).lus;
  bus.doe('track.1.seek', (l.A + 0.1) / 300);
  assert.ok(e.track(1).lus, 'erbinnen: blijft');
  bus.doe('track.1.seek', 0.5);
  assert.equal(e.track(1).lus, null, 'erbuiten: eraf');
  zet(8); dicht(fase(e, 1, 8), 0, 1e-9);
});

test('lus op een vrije track (sync uit): in seconden van het grid, motor = track', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  bus.doe('track.1.sync', true);           // uit: vrij
  assert.equal(e.track(1).gekoppeld, false);
  zet(6); bus.doe('track.1.loop', true);
  zet(20);
  const l = e.track(1).lus, P = e.track(1).plek(20);
  assert.ok(P >= l.A && P < l.B);
  motorIsTrack(e, 1, 6.1, 20);
});

test('lus weigert zonder zeker grid en over een tempowissel', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124, zekerheid: 0.1 }));
  zet(1); bus.doe('track.1.play', true);
  const a = bus.doe('track.1.loop', true);
  assert.ok(a?.geweigerd, 'onzeker grid');
  await e.laad(2, nepNummer({ id: 'w', bpm: 120, stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10.5, bpm: 130, anker: 10.5 }] }));
  bus.doe('track.2.seek', 9.6 / 300);
  bus.doe('track.2.play', true);
  zet(1.5);
  const b = bus.doe('track.2.loop', true);
  assert.ok(b?.geweigerd && /tempowissel/.test(b.geweigerd), JSON.stringify(b));
});

test('beatjump: 4 tellen, fasebehoudend; in een lus schuift de lus mee; niet voorbij het einde', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 120 }));
  zet(1); bus.doe('track.1.play', true);
  zet(5);
  const A = e.straks(), voor = e.track(1).plek(A);
  bus.doe('track.1.beatjump.voor', true);
  dicht(e.track(1).plek(A) - voor, 2, 1e-9, '4 tellen op 120 = 2 s');
  zet(7); dicht(fase(e, 1, 7), 0, 1e-9);
  bus.doe('track.1.loop', true);
  const l0 = e.track(1).lus.A;
  bus.doe('track.1.beatjump.terug', true);
  dicht(e.track(1).lus.A, l0 - 2, 1e-9, 'de lus schoof mee');
  zet(12);
  const P = e.track(1).plek(12), l = e.track(1).lus;
  assert.ok(P >= l.A && P < l.B);
  motorIsTrack(e, 1, 7.1, 12);
  bus.doe('track.1.loop', true);
  bus.doe('track.1.seek', 299 / 300);
  assert.equal(bus.doe('track.1.beatjump.voor', true)?.geweigerd, 'einde');
});

test('hotcues: zetten op de tel, erheen springen (gekoppeld fasebehoudend), wissen, en de engine meldt het voor de opslag', async () => {
  const { e, bus, zet } = await opzet();
  const gemeld = [];
  e.on('hotcue', (h) => gemeld.push(h));
  await e.laad(1, nepNummer({ bpm: 120, anker: 0.25 }));
  zet(1); bus.doe('track.1.play', true);
  zet(3.37);
  assert.equal(bus.lees('track.1.hotcue.2'), 0, 'leeg');
  bus.doe('track.1.hotcue.2', true);
  const h = e.track(1).hotcues[1];
  dicht((h - 0.25) / 0.5, Math.round((h - 0.25) / 0.5), 1e-9, 'op een tel');
  assert.equal(bus.lees('track.1.hotcue.2'), 0.5, 'gezet');
  assert.equal(gemeld.length, 1); assert.equal(gemeld[0].k, 1); assert.equal(gemeld[0].id, e.track(1).nummer.id);
  zet(20);
  bus.doe('track.1.hotcue.2', true);
  const A = e.straks();
  assert.ok(Math.abs(e.track(1).plek(A) - h) <= 0.25 + 1e-9, 'erheen (hooguit een halve tel ernaast: de fase blijft)');
  zet(22); dicht(fase(e, 1, 22), 0, 1e-9);
  bus.doe('track.1.hotcue.2.wis', true);
  assert.equal(e.track(1).hotcues[1], null);
  assert.equal(gemeld.at(-1).P, null);
});

test('een nummer brengt zijn hotcues en cue mee; laden haalt de lus eraf', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 120 }));
  zet(1); bus.doe('track.1.play', true);
  zet(3); bus.doe('track.1.loop', true);
  await e.laad(1, { ...nepNummer({ id: 'met', bpm: 120 }), hotcues: [10, null, 42], cue: 7 });
  assert.equal(e.track(1).lus, null);
  assert.deepEqual(e.track(1).hotcues.slice(0, 3), [10, null, 42]);
  assert.equal(e.track(1).cue, 7);
  dicht(e.track(1).plek(e.straks()), 7, 1e-12, 'staat op de cue');
});

test('focus: één track tegelijk, meldt een wissel', async () => {
  const { e, bus } = await opzet();
  const f = [];
  e.on('focus', (n) => f.push(n));
  assert.equal(bus.lees('track.1.focus'), 1);
  bus.doe('track.3.focus', true);
  assert.equal(e.focus, 3);
  assert.equal(bus.lees('track.1.focus'), 0);
  assert.equal(bus.lees('track.3.focus'), 1);
  assert.deepEqual(f, [3]);
});

test('klok.fase en klok.maat lezen de klok zoals je hem hoort (null als hij stilstaat)', async () => {
  const { e, bus, zet } = await opzet();
  assert.equal(bus.lees('klok.fase'), null);
  await e.laad(1, nepNummer({ bpm: 120 }));
  zet(1); bus.doe('track.1.play', true);
  zet(5);
  const c = e.hoorbareTel();
  dicht(bus.lees('klok.fase'), c - Math.floor(c), 1e-12);
  const m = bus.lees('klok.maat');
  assert.ok(m >= 0 && m < 1);
});
