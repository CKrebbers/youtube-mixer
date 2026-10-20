/**
 * De sampler (plak 5): knippen in tellen van wat je hoort, een pad als lus op de maatklok
 * (de motor zegt steeds dezelfde plek als (tel − starttel) × tellengte, teruggevouwen), een
 * tempowissel van de klok verschuift niets, en de weigeringen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { knipBereik, knipPcm } from '../src/engine/sampler.js';
import { Beatgrid } from '../src/kern/grid.js';
import { nepCtx, nepAudio, nepNummer } from './nep-audio.mjs';

const dicht = (a, b, eps = 1e-6, wat = '') => assert.ok(Math.abs(a - b) < eps, `${wat} ${a} ≉ ${b}`);

/** Een nummer met echte pagina's (een oplopende waarde per frame), zodat knippen te controleren is. */
function nummerMetPcm({ id = 'met-pcm', bpm = 120, duur = 30 } = {}) {
  const sr = 48000, frames = duur * sr, paginas = [];
  for (let p = 0; p * 65536 < frames; p++) {
    const n = Math.min(65536, frames - p * 65536), a = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) { const f = p * 65536 + i; a[2 * i] = f % 30000; a[2 * i + 1] = -(f % 30000); }
    paginas.push(a);
  }
  return { ...nepNummer({ id, bpm, duur }), haal: async () => ({ sr, kanalen: 2, frames, paginas: paginas.map((x) => x.slice()) }) };
}

async function opzet() {
  const ctx = nepCtx();
  const uit = { zet: (v) => { uit.v = v; }, lees: () => uit.v ?? 0.8, pad: () => ({}) };
  const e = new Engine({ ctx, audio: { ...nepAudio(), sampler: () => uit }, timer: false });
  await e.klaar;
  const zet = (t) => { ctx.currentTime = t; e.tik(); };
  return { e, ctx, bus: e.bus, zet };
}

test('knipBereik: de laatste N hele tellen tot de laatste tel vóór de plek; vlak na het begin minder', () => {
  const g = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0.1 }] });
  assert.deepEqual(knipBereik(g, 5.37, 4), { van: g.timeOf(6), tot: g.timeOf(10), tellen: 4 });
  assert.deepEqual(knipBereik(g, 1.2, 4), { van: g.timeOf(0), tot: g.timeOf(2), tellen: 2 });
  assert.equal(knipBereik(g, 0.3, 4), null);
});

test('knipPcm: precies het stuk, ook over een paginagrens, en bij 0 beginnend', async () => {
  const n = nummerMetPcm();
  const bron = await n.haal();
  const pcm = await knipPcm(bron, 1.0, 2.5);
  assert.equal(pcm.frames, 72000);
  assert.equal(pcm.paginas[0][0], 48000 % 30000);
  const f = 48000 + 65536 + 3;
  assert.equal(pcm.paginas[1][2 * 3], f % 30000, 'over de paginagrens');
});

test('vullen, spelen op de volgende tel, als lus op de klok; een tempowissel verschuift niets', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nummerMetPcm({ bpm: 120 }));
  zet(1); bus.doe('track.1.play', true);
  zet(8);
  assert.equal(bus.lees('sampler.1'), 0, 'leeg');
  await e.sampler.vul(1);
  const p = e.sampler.pad(1);
  assert.equal(p.stuk.tellen, 4);
  dicht(p.stuk.duur, 2, 1e-9, 'vier tellen op 120 = 2 s');
  assert.equal(bus.lees('sampler.1'), 0.5, 'gevuld');
  bus.doe('sampler.1', true);
  assert.equal(bus.lees('sampler.1'), 1, 'speelt');
  const T0 = e.klok.tijd(p.startTel);
  assert.ok(T0 >= e.straks() - 1e-9, 'op een tel na nu');
  const plek = (t) => { const x = (e.klok.tel(t) - p.startTel) * 0.5; return x - 2 * Math.floor(x / 2); };
  for (const t of [T0 + 0.1, T0 + 1.9, T0 + 3.3, T0 + 7.77]) dicht(p.speler.positie(t), plek(t), 1e-9, `op ${t}`);
  // De klok naar 100 bpm: de pad volgt, op de tel.
  bus.doe('klok.tempo', (100 - 40) / 260);
  zet(20);
  for (const t of [20.05, 21.3, 24.9]) dicht(p.speler.positie(t), plek(t), 1e-9, `na de wissel op ${t}`);
  bus.doe('sampler.1', true);
  assert.equal(bus.lees('sampler.1'), 0.5, 'gestopt, nog gevuld');
  bus.doe('sampler.1.wis', true);
  assert.equal(bus.lees('sampler.1'), 0, 'leeg');
});

test('een spelende pad houdt de klok vast (klok.stop geweigerd)', async () => {
  const { e, bus, zet } = await opzet();
  await e.laad(1, nummerMetPcm());
  zet(1); bus.doe('track.1.play', true); zet(6);
  await e.sampler.vul(2);
  bus.doe('sampler.2', true);
  bus.doe('track.1.play', true);              // pauze
  assert.ok(bus.doe('klok.stop', true)?.geweigerd);
});

test('weigert zonder nummer, zonder zeker grid, en te vlak na het begin', async () => {
  const { e, bus, zet } = await opzet();
  assert.ok((await e.sampler.vul(1))?.geweigerd);
  await e.laad(1, { ...nummerMetPcm(), grid: { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.1 }] } });
  zet(1); bus.doe('track.1.play', true); zet(5);
  assert.match((await e.sampler.vul(1)).geweigerd, /grid/);
});

test('lengte en volume', async () => {
  const { e, bus } = await opzet();
  bus.doe('sampler.lengte.langer', true);
  assert.equal(e.sampler.tellen, 8);
  bus.doe('sampler.lengte.korter', true); bus.doe('sampler.lengte.korter', true); bus.doe('sampler.lengte.korter', true); bus.doe('sampler.lengte.korter', true);
  assert.equal(e.sampler.tellen, 1);
  bus.doe('sampler.volume', 0.3);
  assert.equal(bus.lees('sampler.volume'), 0.3);
});
