/**
 * Opstellingen in de engine (engine/acties-opstelling.js): klaarzetten zonder geluid, macro's die
 * hun links op de bus zetten (bron opstelling), scenes, herrollen, muteren, terug, genereren,
 * bewaren, en de drift op de maatklok.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const recept = (naam) => JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', `${naam}.json`), 'utf8'));

function nepInstrumenten() {
  const defs = ['poly', 'fm', 'schaal', 'drums'].map((soort) => ({ soort, naam: soort }));
  return {
    instrumenten: defs,
    instrument: (ctx, soort) => {
      const params = [0.5, 0.5, 0.5, 0.5];
      const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { params[k - 1] = v; }, leesParam: (k) => params[k - 1] ?? null, vernietig() {} };
      return { inst, weg: async () => {} };
    },
  };
}

async function opzet() {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: { ...nepAudio(), ...nepInstrumenten() }, timer: false });
  await e.klaar;
  const geladen = [];
  const bewaard = [];
  const acties = [];
  e.bus.on('actie', (a) => { if (a.bron === 'opstelling') acties.push([a.id, a.v]); });
  e.opstelling.zetBronnen({
    catalogus: () => ({ nummers: [{ id: 'x', titel: 'X', bpm: 124, k: 21, stems: 4 }, { id: 'y', titel: 'Y', bpm: 120, k: 9, stems: 0 }], instrumenten: ['poly', 'fm', 'schaal', 'drums'], racks: [], vormen: ['fl', 'gs'] }),
    laadNummer: (n, id) => { geladen.push([n, id]); },
    bewaar: (r) => { bewaard.push(r); },
  });
  const fouten = e.opstelling.zetRecepten([recept('klokwerk'), recept('nachtstroom'), recept('stemmenzee')]);
  return { e, bus: e.bus, geladen, bewaard, acties, fouten };
}
const rust = () => new Promise((r) => setTimeout(r, 0));
const even = async () => { for (let i = 0; i < 5; i++) await rust(); };

test('klaarzetten: instrumenten op hun track, patronen op plek 5, macro\'s via de bus; er speelt niets', async () => {
  const { e, bus, acties, fouten } = await opzet();
  assert.deepEqual(fouten, {});
  bus.doe('opstelling.laad', true); await even();
  const st = e.opstelling.stand();
  assert.equal(st.recept, 'klokwerk');
  for (const n of [1, 2, 3, 4]) assert.ok(e.track(n).instrument, `track ${n} heeft een instrument`);
  assert.equal(e.track(1).instrument.soort, 'drums');
  assert.ok(e.patronen.patroon(1, 5)?.noten.length > 0, 'drumpatroon op plek 5');
  assert.equal(e.patronen.patroon(1, 1), null, 'plek 1–4 blijven van jou');
  assert.ok(acties.some(([id]) => id === 'track.3.filter'), 'de macro schaal zette zijn link');
  assert.ok(!acties.some(([id]) => id === 'track.3.send.b'), 'wat er niet is (geen send-bus in de nep) wordt stil overgeslagen');
  assert.ok(!e.tracks.some((t) => t.speelt), 'klaarzetten speelt niets');
  assert.ok(!e.patronen.speelt, 'en de patronen staan stil');
});

test('macro: opstelling.macro.1 (schaal) beweegt al zijn links; lees geeft wat je zette', async () => {
  const { e, bus } = await opzet();
  await e.opstelling.zet('klokwerk', 5); await even();
  bus.doe('opstelling.macro.1', 1);
  assert.equal(bus.lees('opstelling.macro.1'), 1);
  assert.ok(Math.abs(bus.lees('track.3.filter') - 0.85) < 0.02, `filter 3: ${bus.lees('track.3.filter')}`);
  assert.ok(Math.abs(bus.lees('track.4.filter') - 0.8) < 0.02);
  bus.doe('opstelling.macro.1', 0);
  assert.ok(Math.abs(bus.lees('track.3.filter') - 0.15) < 0.02);
});

test('scene: de macro\'s van die scene, binnen hun bereik; een scene die er niet is wordt geweigerd', async () => {
  const { e, bus } = await opzet();
  await e.opstelling.zet('klokwerk', 5); await even();
  bus.doe('opstelling.scene.3', true);   // vol: dichtheid 0,85..1
  const d = bus.lees('opstelling.macro.2');
  assert.ok(d >= 0.85 && d <= 1, `dichtheid ${d}`);
  const geweigerd = [];
  bus.on('geweigerd', (g) => geweigerd.push(g));
  bus.doe('opstelling.scene.8', true);
  assert.equal(geweigerd.length, 1);
});

test('herrollen geeft een ander zaad; terug brengt de vorige; muteren en kruisen houden het recept', async () => {
  const { e, bus } = await opzet();
  await e.opstelling.zet('klokwerk', 5); await even();
  const eerst = e.opstelling.stand();
  bus.doe('opstelling.herrol', true); await even();
  const daarna = e.opstelling.stand();
  assert.notEqual(daarna.zaad, eerst.zaad);
  assert.equal(daarna.recept, 'klokwerk');
  bus.doe('opstelling.terug', true); await even();
  assert.equal(e.opstelling.stand().zaad, eerst.zaad);
  bus.doe('opstelling.muteer', true); await even();
  assert.equal(e.opstelling.stand().recept, 'klokwerk');
  bus.doe('opstelling.kruis', true); await even();
  assert.equal(e.opstelling.stand().recept, 'klokwerk');
});

test('een recept met nummers laadt ze via de schermlaag, stems-recept pakt het nummer met stems', async () => {
  const { e, geladen } = await opzet();
  await e.opstelling.zet('stemmenzee', 3); await even();
  assert.deepEqual(geladen[0], [1, 'x']);
});

test('genereren: een nieuw recept erbij, meteen klaargezet; bewaren maakt er een recept van', async () => {
  const { e, bus, bewaard } = await opzet();
  bus.doe('opstelling.genereer', true); await even();
  const st = e.opstelling.stand();
  assert.equal(e.opstelling.recepten().length, 4);
  assert.match(st.recept, /^gen-/);
  bus.doe('opstelling.macro.1', 0.8);
  bus.doe('opstelling.bewaar', true); await even();
  assert.equal(bewaard.length, 1);
  assert.equal(e.opstelling.recepten().length, 5);
  const m = bewaard[0].macros.find((x) => x.rol === 'schaal');
  if (m) assert.ok(m.start[0] <= 0.8 && m.start[1] >= 0.8, 'de macro begint voortaan waar hij stond');
});

test('volgende/vorige kiezen alleen; laad zet klaar', async () => {
  const { e, bus } = await opzet();
  bus.doe('opstelling.volgende', true);
  assert.equal(e.opstelling.stand().kandidaat, 'Nachtstroom');
  assert.equal(e.opstelling.stand().recept, null, 'kiezen laadt nog niets');
  bus.doe('opstelling.laad', true); await even();
  assert.equal(e.opstelling.stand().recept, 'nachtstroom');
});

test('drift: alleen als de klok loopt, begrensd, en variatie 0 houdt hem stil', async () => {
  const { e, bus } = await opzet();
  await e.opstelling.zet('klokwerk', 5); await even();
  const voor = bus.lees('track.3.filter');
  e.opstelling.tik(1);   // klok loopt niet: niets
  assert.equal(bus.lees('track.3.filter'), voor);
  e.zetKlokTempo(120, 0);
  bus.doe('opstelling.macro.7', 0);    // variatie 0
  for (let t = 0; t < 30; t += 0.25) e.opstelling.tik(t);
  assert.ok(Math.abs(bus.lees('track.3.filter') - voor) < 1e-6, 'variatie 0 = stil');
  bus.doe('opstelling.macro.7', 1);
  let bewoog = false;
  for (let t = 0; t < 60; t += 0.25) { e.opstelling.tik(t); if (Math.abs(bus.lees('track.3.filter') - voor) > 0.01) bewoog = true; }
  assert.ok(bewoog, 'variatie 1 = de opstelling beweegt uit zichzelf');
  const gezet = bus.lees('opstelling.macro.1');
  for (let t = 60; t < 90; t += 0.25) e.opstelling.tik(t);
  assert.equal(bus.lees('opstelling.macro.1'), gezet, 'de drift verandert niet wat jij zette');
});
