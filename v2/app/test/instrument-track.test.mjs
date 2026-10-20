/**
 * Een track draagt een nummer óf een instrument (plak 5, v1 ST7): de engine-kant met een
 * nep-instrument. Rondlopen met de bus, een nummer laden haalt het instrument weg (en andersom),
 * noten naar de speeltrack, knoppen, en geen instrument als de audiolaag er geen kent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio, nepNummer } from './nep-audio.mjs';

function nepInstrumenten(log) {
  const defs = [{ soort: 'poly', naam: 'Poly' }, { soort: 'drums', naam: 'Drums' }];
  return {
    instrumenten: defs,
    instrument: (ctx, soort) => {
      const params = [0.5, 0.5];
      const inst = {
        soort, gestart: false, weg: false,
        start: async () => { inst.gestart = true; },
        noteOn: (noot, v, t) => log.push(['aan', soort, noot, v, t]),
        noteOff: (noot, t) => log.push(['uit', soort, noot, t]),
        stil: () => log.push(['stil', soort]),
        zetParam: (k, v) => { params[k - 1] = v; },
        leesParam: (k) => params[k - 1] ?? null,
        vernietig: () => { inst.weg = true; },
      };
      return { inst, weg: async () => inst.vernietig() };
    },
  };
}

async function opzet() {
  const log = [];
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: { ...nepAudio(), ...nepInstrumenten(log) }, timer: false });
  await e.klaar;
  return { e, ctx, bus: e.bus, log };
}
const rust = () => new Promise((r) => setTimeout(r, 0));

test('rondlopen: geen -> poly -> drums -> geen; het oude wordt vernietigd', async () => {
  const { e, bus } = await opzet();
  assert.equal(bus.lees('track.3.inst'), 0);
  bus.doe('track.3.inst', true); await rust();
  assert.equal(e.track(3).instrument.soort, 'poly');
  assert.equal(e.track(3).instrument.inst.gestart, true);
  const poly = e.track(3).instrument.inst;
  bus.doe('track.3.inst', true); await rust();
  assert.equal(e.track(3).instrument.soort, 'drums');
  assert.equal(poly.weg, true);
  bus.doe('track.3.inst', true); await rust();
  assert.equal(e.track(3).instrument, null);
  assert.equal(bus.lees('track.3.inst'), 0);
});

test('een nummer laden haalt het instrument weg; een instrument haalt het nummer weg', async () => {
  const { e, bus } = await opzet();
  await e.zetInstrument(2, 'poly');
  const inst = e.track(2).instrument.inst;
  await e.laad(2, nepNummer({ bpm: 120 }));
  assert.equal(e.track(2).instrument, null);
  assert.equal(inst.weg, true);
  assert.ok(e.track(2).geladen);
  await e.zetInstrument(2, 'drums');
  assert.equal(e.track(2).geladen, false, 'het nummer is eraf');
  assert.equal(e.track(2).instrument.soort, 'drums');
});

test('over een spelend, hoorbaar nummer pas bij de tweede druk', async () => {
  const { e, bus, ctx } = await opzet();
  await e.laad(1, nepNummer({ bpm: 120 }));
  ctx.currentTime = 1; e.tik(); bus.doe('track.1.play', true);
  ctx.currentTime = 2;
  const a = bus.doe('track.1.inst', true);
  assert.ok(a?.geweigerd);
  assert.equal(e.track(1).instrument, null);
  bus.doe('track.1.inst', true); await rust();
  assert.equal(e.track(1).instrument.soort, 'poly');
});

test('noten gaan naar de speeltrack: de focus als die een instrument heeft, anders de laatste', async () => {
  const { e, log } = await opzet();
  await e.zetInstrument(4, 'poly');
  await e.zetInstrument(6, 'drums');
  e.noot(60, 0.8);
  assert.deepEqual(log.at(-1).slice(0, 4), ['aan', 'drums', 60, 0.8], 'de laatste');
  e.zetFocus(4);
  e.noot(62, 0.5, { t: 3.2 });
  assert.deepEqual(log.at(-1), ['aan', 'poly', 62, 0.5, 3.2], 'de focus');
  e.noot(62, 0);
  assert.deepEqual(log.at(-1).slice(0, 3), ['uit', 'poly', 62]);
  assert.equal(e.noot(60, 1, { n: 1 }), false, 'geen instrument op track 1');
});

test('knoppen en paniek over de bus', async () => {
  const { e, bus, log } = await opzet();
  assert.equal(bus.lees('track.5.inst.knop.1'), null);
  await e.zetInstrument(5, 'poly');
  bus.doe('track.5.inst.knop.2', 0.9);
  assert.equal(bus.lees('track.5.inst.knop.2'), 0.9);
  bus.doe('track.5.inst.stil', true);
  assert.deepEqual(log.at(-1), ['stil', 'poly']);
});

test('zonder instrumenten in de audiolaag: geweigerd met een reden', async () => {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), timer: false });
  await e.klaar;
  assert.ok(e.bus.doe('track.1.inst', true)?.geweigerd);
  assert.ok((await e.zetInstrument(1, 'poly'))?.geweigerd);
});
