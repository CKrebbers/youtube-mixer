/**
 * De patronenspeler op de maatklok (plak 5): een noot klinkt op klok.tijd(tick / PPQN), elke noot
 * precies één keer hoe de tik ook valt, starten en wisselen op de "1", stoppen met alles los,
 * een tempowissel van de klok verschuift de volgende noten mee.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { PPQN } from '../src/kern/patronen/venster.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';

const dicht = (a, b, eps = 1e-9, wat = '') => assert.ok(Math.abs(a - b) < eps, `${wat} ${a} ≉ ${b}`);
const patroon = (noten, extra = {}) => ({ id: 'p', naam: '', lengte: 16, deling: 4, swing: 50, noten: noten.map(([stap, noot]) => ({ stap, noot, snelheid: 0.8, duur: 1, micro: 0 })), ...extra });

async function opzet() {
  const ctx = nepCtx();
  const log = [];
  const audio = {
    ...nepAudio(),
    instrumenten: [{ soort: 'drums', naam: 'Drums' }],
    instrument: () => {
      const inst = { start: async () => {}, noteOn: (n, v, t) => log.push(['aan', n, t]), noteOff: (n, t) => log.push(['uit', n, t]), alleUit: (t) => log.push(['alles', t]), vernietig() {} };
      return { inst, weg: async () => {} };
    },
  };
  const timers = { zet: () => 1, weg: () => {} };
  const e = new Engine({ ctx, audio, timer: false, patronenTimers: timers });
  await e.klaar;
  await e.zetInstrument(1, 'drums');
  const zet = (t) => { ctx.currentTime = t; e.tik(); e.patronen.tik(); };
  return { e, ctx, log, zet, bus: e.bus };
}

test('een patroon start op de volgende "1" en elke noot klinkt op klok.tijd(tick / PPQN), precies één keer', async () => {
  const { e, log, zet } = await opzet();
  e.zetKlokTempo(120, 0.5);
  e.patronen.zetPatroon(1, 1, patroon([[0, 36], [4, 38], [8, 36], [12, 38]]));
  zet(0.6);
  e.patronen.wissel(1, 1);
  // Onregelmatige tikken: elk venster sluit aan op het vorige.
  let t = 0.6;
  while (t < 6) { t += 0.013 + ((t * 7919) % 0.09); zet(t); }
  const aan = log.filter((x) => x[0] === 'aan');
  const eersteEen = e.klok.tijd(Math.ceil(e.klok.tel(0.6 + 1e-3) / 4 - 1e-9) * 4);
  dicht(aan[0][2], eersteEen, 1e-9, 'de eerste noot op de "1"');
  for (let i = 1; i < aan.length; i++) dicht(aan[i][2] - aan[i - 1][2], 0.5, 1e-9, `noot ${i} een tel later`);
  assert.equal(new Set(aan.map((x) => x[2].toFixed(9))).size, aan.length, 'niets dubbel');
});

test('stoppen op de "1": daar alles los, daarna niets meer', async () => {
  const { e, log, zet } = await opzet();
  e.zetKlokTempo(120, 0.5);
  e.patronen.zetPatroon(1, 1, patroon([[0, 36], [2, 42], [4, 38], [6, 42]]));
  zet(0.6); e.patronen.wissel(1, 1);
  for (let t = 0.6; t < 3.1; t += 0.025) zet(t);
  e.patronen.wissel(1, 1);                   // dezelfde plek nog eens = stoppen op de "1"
  for (let t = 3.1; t < 8; t += 0.025) zet(t);
  const alles = log.find((x) => x[0] === 'alles');
  assert.ok(alles, 'alleUit');
  dicht(e.klok.inMaat(e.klok.tel(alles[1])), 0, 1e-6, 'op een "1"');
  assert.ok(log.filter((x) => x[0] === 'aan').every((x) => x[2] < alles[1]), 'niets na de stop');
  assert.equal(e.patronen.speelt, false);
});

test('wisselen naar een andere plek: op de "1", het oude tot daar en het nieuwe vanaf daar', async () => {
  const { e, log, zet } = await opzet();
  e.zetKlokTempo(120, 0.5);
  e.patronen.zetPatroon(1, 1, patroon([[0, 36], [4, 36], [8, 36], [12, 36]]));
  e.patronen.zetPatroon(1, 2, patroon([[0, 50], [4, 50], [8, 50], [12, 50]]));
  zet(0.6); e.patronen.wissel(1, 1);
  for (let t = 0.6; t < 2.9; t += 0.025) zet(t);
  e.patronen.wissel(1, 2);
  for (let t = 2.9; t < 7; t += 0.025) zet(t);
  const aan = log.filter((x) => x[0] === 'aan');
  const grens = aan.find((x) => x[1] === 50)[2];
  dicht(e.klok.inMaat(e.klok.tel(grens)), 0, 1e-6, 'de wissel valt op een "1"');
  assert.ok(aan.filter((x) => x[1] === 36).every((x) => x[2] < grens), 'het oude stopt daar');
  for (let i = 1; i < aan.length; i++) dicht(aan[i][2] - aan[i - 1][2], 0.5, 1e-9, 'geen gat, niets dubbel');
});

test('een tempowissel van de klok: de volgende noten volgen hem', async () => {
  const { e, log, zet } = await opzet();
  e.zetKlokTempo(120, 0.5);
  e.patronen.zetPatroon(1, 1, patroon([[0, 36], [4, 36], [8, 36], [12, 36]]));
  zet(0.6); e.patronen.wissel(1, 1);
  for (let t = 0.6; t < 4; t += 0.025) zet(t);
  e.zetKlokTempo(100, 4.01);
  for (let t = 4; t < 10; t += 0.025) zet(t);
  const laatste = log.filter((x) => x[0] === 'aan').slice(-3);
  dicht(laatste[2][2] - laatste[1][2], 0.6, 1e-9, '100 bpm = 0,6 s per tel');
});

test('weigert zonder instrument; een lege plek = kiezen om te bewerken (niets speelt); zonder klok start hij de klok op het eigen tempo', async () => {
  const { e, zet } = await opzet();
  assert.ok(e.patronen.wissel(2, 1)?.geweigerd);
  assert.equal(e.patronen.wissel(1, 3), undefined);
  assert.equal(e.patronen.gekozen[1], 3, 'plek 3 gekozen');
  assert.ok(e.patronen.patroon(1, 3), 'er staat een leeg patroon om te bewerken');
  assert.equal(e.patronen.speelt, false, 'een leeg patroon speelt niet');
  e.patronen.zetPatroon(1, 1, patroon([[0, 36]]));
  e.patronen.tempo = 96;
  zet(1);
  e.patronen.wissel(1, 1);
  assert.ok(e.klok.loopt);
  dicht(e.klok.bpm(2), 96, 1e-9);
});

test('bewerken: stappen wisselen met de laatst gespeelde noot, pagina, lengte, wissen; de set meldt zich', async () => {
  const { e } = await opzet();
  const sets = [];
  e.on('patronen-set', (s) => sets.push(s));
  e.patronen.wissel(1, 2);
  e.patronen.noot[1] = 38;
  e.patronen.wisselStap(1, 0);
  e.patronen.wisselStap(1, 4);
  assert.deepEqual(e.patronen.bewerkt(1).noten.map((n) => [n.stap, n.noot]), [[0, 38], [4, 38]]);
  assert.equal(e.patronen.stapStand(1, 0), 1);
  e.patronen.noot[1] = 36;
  assert.equal(e.patronen.stapStand(1, 0), 0.5, 'een andere noot op die stap');
  e.patronen.wisselStap(1, 0);
  assert.equal(e.patronen.stapStand(1, 0), 1);
  e.patronen.wisselStap(1, 0);
  assert.equal(e.patronen.stapStand(1, 0), 0.5, 'de kick weer weg, de snare blijft');
  e.patronen.lengteStap(1, 1);
  assert.equal(e.patronen.bewerkt(1).lengte, 20);
  e.patronen.paginaStap(1, 1);
  assert.equal(e.patronen.pagina[1], 1);
  assert.equal(e.patronen.stapStand(1, 3), 0, 'stap 20 bestaat');
  assert.equal(e.patronen.stapStand(1, 4), null, 'stap 21 niet');
  assert.ok(e.patronen.wisselStap(1, 4)?.geweigerd);
  e.patronen.wis(1);
  assert.equal(e.patronen.bewerkt(1).noten.length, 0);
  assert.ok(sets.length >= 6, 'elke bewerking meldt de set');
  assert.equal(sets.at(-1).patronen.length, 1);
});
