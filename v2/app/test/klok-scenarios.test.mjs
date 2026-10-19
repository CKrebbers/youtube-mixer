// De scenario's van ontwerp 1 (v2/ontwerp/maatklok.json) als tests.
// Elk scenario heeft zijn id in de naam; een scenario zonder test is niet af.
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

// Waar staat de tel van een track ten opzichte van de klok (alleen het deel binnen de tel)?
function faseTov(e, n, t) {
  const tr = e.track(n);
  const b = tr.grid.beatAt(tr.speler.positie(t));
  const d = b - e.klok.tel(t);
  return d - Math.round(d);
}

test('klok-S01: het eerste nummer start de klok op zijn tempo en zijn "1"', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124, anker: 0.3 }));
  zet(1);
  bus.doe('track.1.play', true);
  zet(5);
  assert.ok(e.klok.loopt);
  dicht(e.klok.bpm(5), 124, 1e-9, 'bpm');
  assert.equal(e.track(1).gekoppeld, true);
  // De "1" van de klok valt op een "1" van het nummer.
  const een = e.klok.tijd(e.klok.volgendeMaat(e.klok.tel(5)));
  assert.ok(e.track(1).grid.isMaatbegin(Math.round(e.track(1).grid.beatAt(e.track(1).plek(een)))));
  dicht(faseTov(e, 1, 6), 0, 1e-9, 'fase');
});

test('klok-S02: sync zet B op klok-tempo en de dichtstbijzijnde tel, sprong ≤ ½ tel', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 128, anker: 0.137 }));
  zet(1); bus.doe('track.1.play', true);
  zet(3); bus.doe('track.2.play', true);
  zet(4.2);
  const voor = e.track(2).plek(e.straks());
  bus.doe('track.2.sync', true);
  const na = e.track(2).plek(e.straks());
  const sprongTellen = (na - voor) * 128 / 60;
  assert.ok(Math.abs(sprongTellen) <= 0.5 + 1e-9, `sprong ${sprongTellen}`);
  zet(20);
  dicht(e.track(2).snelheid(20), 124 / 128, 1e-9, 'rate');
  dicht(faseTov(e, 2, 20), 0, 1e-9, 'fase');
  assert.equal(e.track(2).sync, true);
  assert.equal(bus.lees('track.2.sync'), 1);
});

test('klok-S03 + klok-B15: jog schuift het nummer t.o.v. de klok, en het blijft daar', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  const v0 = e.track(2).verschuiving;
  const klokVoor = e.klok.seg.map((s) => ({ ...s }));
  bus.doe('track.2.jog', 0.75);   // + een halve stap: 8 × 1/32 × 0,5 = 1/8 tel
  zet(10);
  dicht(e.track(2).verschuiving - v0, 0.125, 1e-9, 'verschuiving');
  dicht(faseTov(e, 2, 10), 0.125, 1e-9, 'blijft voor');
  assert.deepEqual(e.klok.seg, klokVoor, 'klok ongemoeid');
  dicht(faseTov(e, 1, 10), 0, 1e-9, 'A ongemoeid');
  assert.equal(e.track(2).sync, true, 'sync blijft aan');
});

test('klok-S04: nudge vasthouden = 4% sneller, loslaten = op klok-tempo met de voorsprong', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 120 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2);
  bus.doe('track.1.nudge.voor', true);
  dicht(e.track(1).snelheid(2.1), 1.04, 1e-9, 'tijdens');
  zet(2.5);
  bus.doe('track.1.nudge.voor', false);
  zet(8);
  dicht(e.track(1).snelheid(8), 1, 1e-9, 'erna');
  // Voorsprong ≈ 0,5 s × 4% = 0,02 s = 0,04 tel op 120 bpm.
  dicht(faseTov(e, 1, 8), 0.04, 1e-3, 'voorsprong');
  assert.equal(e.track(1).gekoppeld, true);
});

test('klok-S05: een nummer stoppen of dichtdraaien verandert de klok niet', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 126 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  const lijn = JSON.stringify(e.klok.seg);
  bus.doe('track.1.fader', 0);
  zet(3); bus.doe('track.1.play', true);   // pauze
  zet(9);
  assert.equal(JSON.stringify(e.klok.seg), lijn);
  dicht(faseTov(e, 2, 9), 0, 1e-9);
});

test('klok-S06: tempoknop van de klok: gekoppelde nummers volgen zonder fase te verliezen', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 128 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  zet(3);
  bus.doe('klok.tempo', (126 - 40) / 260);
  zet(10);
  dicht(e.klok.bpm(10), 126, 1e-6);
  dicht(e.track(1).snelheid(10), 126 / 124, 1e-6);
  dicht(e.track(2).snelheid(10), 126 / 128, 1e-6);
  dicht(faseTov(e, 1, 10), 0, 1e-9);
  dicht(faseTov(e, 2, 10), 0, 1e-9);
  // De klok sprong niet: tel is continu rond de wissel.
  const A = e.klok.seg.at(-1).T;
  dicht(e.klok.tel(A - 1e-7), e.klok.tel(A + 1e-7), 1e-5);
});

test('klok-S07: Shift + Sync op een vrij nummer: de klok neemt het over, de anderen glijden mee', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(3, nepNummer({ id: 'c', bpm: 132, anker: 0.05 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.3.play', true);   // vrij op 132
  zet(4);
  const plekC = e.track(3).plek(4.5);
  bus.doe('track.3.sync.klok', true);
  zet(12);
  dicht(e.klok.bpm(12), 132, 1e-6, 'klok op C');
  dicht(e.track(3).snelheid(12), 1, 1e-9, 'C ongewijzigd');
  dicht(e.track(3).plek(4.5), plekC, 1e-9, 'C sprong niet');
  dicht(faseTov(e, 3, 12), 0, 1e-6, 'C op de klok');
  dicht(faseTov(e, 1, 12), 0, 1e-9, 'A gekoppeld mee');
  assert.equal(e.track(3).gekoppeld, true);
});

test('klok-S08: sync op een onzeker grid weigert met een reden, het nummer blijft vrij', async () => {
  const { e, bus, zet } = await opzet();
  const meldingen = [];
  e.on('melding', (m) => meldingen.push(m));
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(4, nepNummer({ id: 'd', bpm: 118, zekerheid: 0.3 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.4.play', true);
  const r = bus.doe('track.4.sync', true);
  assert.match(r.geweigerd, /onzeker/);
  assert.equal(e.track(4).gekoppeld, false);
  assert.equal(e.track(4).sync, false);
  assert.ok(meldingen.some((m) => /onzeker/.test(m.tekst)));
});

test('klok-S09: een tempowissel in het nummer: het blijft op klok-tempo en op de tel', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', stukken: [{ van: 0, bpm: 128, anker: 0 }, { van: 30, bpm: 132, anker: 30 }] }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  // Speel voorbij de grens (track-tijd 30 s bij rate ~0,97 ≈ 31 s later).
  for (let t = 3; t < 45; t += 0.25) zet(t);
  const t = 44;
  assert.ok(e.track(2).plek(t) > 31, 'voorbij de grens');
  dicht(e.track(2).snelheid(t), 124 / 132, 1e-6, 'rate na de wissel');
  dicht(faseTov(e, 2, t), 0, 1e-9, 'fase');
  dicht(e.klok.bpm(t), 124, 1e-9, 'klok onveranderd');
});

test('klok-S10: een nummer zonder grid speelt vrij; de klok loopt eronder door', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(5, { id: 'ambient', titel: 'ambient', duur: 600, grid: null, haal: async () => ({ sr: 48000, kanalen: 2, frames: 600 * 48000, paginas: [] }) });
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.5.play', true);
  zet(6);
  assert.equal(e.track(5).gekoppeld, false);
  dicht(e.track(5).snelheid(6), 1, 1e-9);
  assert.ok(e.klok.loopt);
  assert.match(bus.doe('track.5.sync', true).geweigerd, /grid/);
});

test('klok-S11: starten op de maat begint precies op de volgende "1", gekoppeld', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 128, anker: 0.25 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2.37);
  bus.doe('track.2.seek', 0.25 / 300);   // cue op de eerste tel
  bus.doe('track.2.play.quant', true);
  const ts = e.track(2).wacht;
  assert.ok(ts !== null, 'wacht');
  assert.equal(bus.lees('track.2.play'), 1, 'lampje: wacht');
  dicht(e.klok.inMaat(e.klok.tel(ts)), 0, 1e-9, 'op een "1" van de klok');
  dicht(e.track(2).plek(ts), 0.25, 1e-9, 'begint op zijn startpunt');
  assert.equal(e.track(2).speeltOp(ts - 0.01), false);
  zet(ts + 4);
  assert.equal(e.track(2).gekoppeld, true);
  dicht(faseTov(e, 2, ts + 4), 0, 1e-9);
});

test('klok-S12: een sprong in een gekoppeld nummer houdt de fase', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 124, anker: 0.1 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  bus.doe('track.2.jog', 0.6);                  // iets voor
  const fase0 = faseTov(e, 2, 3);
  zet(3); bus.doe('track.2.seek', 100 / 300);   // naar ~100 s
  zet(5);
  dicht(faseTov(e, 2, 5), fase0, 1e-9, 'zelfde fase');
  assert.ok(Math.abs(e.track(2).plek(5) - 100 - 2 * 1) < 1, 'landde rond 100 s');
});

test('klok-S13: sync uit: speelt vrij verder op het tempo van dat moment, zonder sprong', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 128 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  zet(4);
  const A = e.straks();
  const voor = e.track(2).plek(A);
  bus.doe('track.2.sync', true);
  dicht(e.track(2).plek(A), voor, 1e-9, 'geen sprong');
  assert.equal(e.track(2).gekoppeld, false);
  dicht(e.track(2).snelheid(10), 124 / 128, 1e-9, 'zelfde tempo');
});

test('klok-S14: rem/pauze verandert de klok niet; play koppelt weer op de tel', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  const lijn = JSON.stringify(e.klok.seg);
  zet(3); bus.doe('track.2.play', true);   // pauze
  zet(3.77); bus.doe('track.2.play', true);
  zet(6);
  assert.equal(JSON.stringify(e.klok.seg), lijn);
  dicht(faseTov(e, 2, 6), 0, 1e-9, 'terug op de tel');
});

test('klok-S15: een tempo zonder nummer start de klok (zoals een patroon)', async () => {
  const { e, bus } = await opzet();
  assert.equal(e.klok.loopt, false);
  bus.doe('klok.tempo', (120 - 40) / 260);
  assert.ok(e.klok.loopt);
  dicht(e.klok.bpm(1), 120, 1e-9);
});

test('klok-S16: twijfel over de "1": koppelen mag, starten op de maat niet', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(6, nepNummer({ id: 'f', bpm: 124, zekerheid: 0.9, twijfel: 'maat' }));
  await e.laad(7, nepNummer({ id: 'g', bpm: 124, zekerheid: 0.9, twijfel: 'maat' }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.6.play', true);
  assert.equal(bus.doe('track.6.sync', true), undefined);
  assert.equal(e.track(6).gekoppeld, true);
  const r = bus.doe('track.7.play.quant', true);
  assert.match(r.geweigerd, /"1"/);
});

test('klok-S17: niets speelt meer: de klok loopt door', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.1.play', true);
  zet(62);
  assert.ok(e.klok.loopt);
  dicht(e.klok.bpm(62), 124, 1e-9);
});

test('klok-S18: de fase van een gekoppeld nummer is te lezen (voor de fasemeter)', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); for (let i = 0; i < 2; i++) bus.doe('track.1.jog', 1);   // 2 × 8/32 = ½ tel? nee: ±¼ per tik
  dicht(e.track(1).verschuiving % 1, 0.5, 1e-9);
});

test('klok-S19 + klok-B13: pitchfader van een gekoppeld, hoorbaar nummer = tempo van de klok', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 128 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  zet(3);
  // Track 1 is de klok begonnen op pitch 0,5; fader +5% (bereik ±16%).
  bus.doe('track.1.pitch', 0.5 + 0.05 / 0.32);
  zet(9);
  dicht(e.klok.bpm(9), 124 * 1.05, 1e-6, 'klok');
  dicht(faseTov(e, 2, 9), 0, 1e-9, 'B volgt');
  dicht(e.track(2).snelheid(9), 124 * 1.05 / 128, 1e-6);
});

test('klok-S21 + klok-B14: een nummer dat je niet hoort verzet de klok niet', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nepNummer({ bpm: 124 }));
  await e.laad(2, nepNummer({ id: 'b', bpm: 128 }));
  zet(1); bus.doe('track.1.play', true);
  zet(2); bus.doe('track.2.play', true); bus.doe('track.2.sync', true);
  bus.doe('track.2.fader', 0);
  const lijn = JSON.stringify(e.klok.seg);
  bus.doe('track.2.pitch', 0.9);
  assert.equal(JSON.stringify(e.klok.seg), lijn, 'klok ongemoeid');
  // Open: pas iets als de fader langs de stand van de klok komt (soft-takeover).
  bus.doe('track.2.fader', 1);
  const nodig = 0.5 + (124 / 128 - 1) / 0.32;
  bus.doe('track.2.pitch', 0.85);
  assert.equal(JSON.stringify(e.klok.seg), lijn, 'nog niet gegrepen');
  bus.doe('track.2.pitch', nodig - 0.02);   // erlangs
  zet(6);
  dicht(e.klok.bpm(6), 128 * (1 + (nodig - 0.02 - 0.5) * 0.32), 1e-6, 'nu wel');
});
