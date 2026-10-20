// De acties van de effectlaag (src/engine/acties-fx.js) op de bus: elke id bestaat, waarden 0..1
// gaan naar de slot en de bussen, lees zegt de stand (null als er niets te doen is), volgend/vorig
// lopen door de sjablonen. Met echte strips en een echte mixer op de mock, en met de nep-audio van
// de engine-tests (strips zonder fx: niets mag omvallen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NepOmgeving, installeer } from './web-audio-mock.mjs';
import { nepAudio, nepCtx } from './nep-audio.mjs';

installeer();
const { Bus } = await import('../src/kern/bus.js');
const { Klok } = await import('../src/kern/klok.js');
const { Emitter } = await import('../src/kern/emitter.js');
const { maakStrip } = await import('../src/audio/strip.js');
const { maakMixer } = await import('../src/audio/mixer.js');
const { definieerFx, effectRacks, FX_KNOPPEN } = await import('../src/engine/acties-fx.js');
const { sjablonenUit, laadSjablonen } = await import('../src/audio/fx/sjablonen.js');
const { EFFECTEN } = await import('../src/audio/fx/fx.js');

const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const SJABLONEN = JSON.parse(readFileSync(new URL('../racks/sjablonen.json', import.meta.url), 'utf8'));

/** Een kleine engine: wat definieerFx mag aannemen (track(n).strip, mixer, klok, ctx, meld). */
function nepEngine({ audio = null, tracks = 8 } = {}) {
  const omg = new NepOmgeving();
  const ctx = audio ? nepCtx() : omg.ctx;
  const mixer = audio ? audio.mixer(ctx) : maakMixer(ctx, { limiter: false });
  const strips = Array.from({ length: tracks }, () => (audio ? audio.strip(ctx, mixer) : maakStrip(ctx, mixer)));
  const e = new Emitter();
  Object.assign(e, {
    omg, ctx, mixer, klok: new Klok(), bus: new Bus({ tracks }), meldingen: [],
    track: (n) => (n >= 1 && n <= tracks ? { n, strip: strips[n - 1] } : undefined),
    vertraging: () => 0.02,
    meld(tekst, soort, sleutel) { this.meldingen.push({ tekst, soort, sleutel }); },
  });
  return e;
}

test('alle ids van het bouwplan bestaan, met de juiste soort', () => {
  const e = nepEngine();
  definieerFx(e);
  const ids = new Set(e.bus.ids());
  for (let n = 1; n <= 8; n++) {
    for (let k = 1; k <= FX_KNOPPEN; k++) assert.ok(ids.has(`track.${n}.fx.knop.${k}`));
    for (const x of ['fx.mix', 'fx.aan', 'fx.volgend', 'fx.vorig', 'send.a', 'send.b']) assert.ok(ids.has(`track.${n}.${x}`), x);
  }
  for (const b of ['a', 'b']) for (let k = 1; k <= 8; k++) assert.ok(ids.has(`send.${b}.knop.${k}`));
  const soort = (id) => e.bus.zoek(id).def.soort;
  assert.equal(soort('track.3.fx.knop.2'), 'waarde');
  assert.equal(soort('track.3.fx.mix'), 'waarde');
  assert.equal(soort('track.3.fx.aan'), 'trigger');
  assert.equal(soort('track.3.fx.volgend'), 'trigger');
  assert.equal(soort('track.3.send.a'), 'waarde');
  assert.equal(soort('send.b.knop.1'), 'waarde');
  assert.ok(!e.bus.heeft('send.a.mix'), 'v1 had geen mix op een bus');
});

test('knoppen, mix en aan/uit op de insert van één track; lees = de stand, null waar niets is', () => {
  const e = nepEngine();
  definieerFx(e);
  const fx = e.track(2).strip.fx;
  assert.equal(e.bus.lees('track.2.fx.knop.1'), fx.leesPlek(1), 'het delay-rack van v1: knop 1 = tijd');
  assert.equal(e.bus.lees('track.2.fx.knop.5'), null, 'het delay-rack heeft vier knoppen');
  e.bus.doe('track.2.fx.knop.2', 0.8);
  assert.ok(dicht(fx.leesPlek(2), 0.8) && dicht(e.bus.lees('track.2.fx.knop.2'), 0.8));
  assert.equal(e.track(1).strip.fx.leesPlek(2), 0.45, 'een andere track blijft staan');
  e.bus.doe('track.2.fx.mix', 0.4);
  assert.ok(dicht(fx.mix, 0.4) && fx.keten, 'de mix open: de keten is er');
  assert.equal(e.bus.lees('track.2.fx.aan'), 1);
  e.bus.doe('track.2.fx.aan', true);
  assert.equal(fx.bypass, true);
  assert.equal(e.bus.lees('track.2.fx.aan'), 0);
  e.bus.doe('track.2.fx.aan', false);
  assert.equal(fx.bypass, true, 'loslaten doet niets');
  e.bus.doe('track.2.fx.aan', true);
  assert.equal(e.bus.lees('track.2.fx.aan'), 1, 'een schakelaar');
  // Geen effect: aan/uit leest null en weigert.
  fx.zetRack({ schema: 1, name: 'leeg', chain: [], macros: [] });
  assert.equal(e.bus.lees('track.2.fx.aan'), null);
  assert.equal(e.bus.lees('track.2.fx.knop.1'), null);
  const geweigerd = [];
  e.bus.on('geweigerd', (x) => geweigerd.push(x));
  e.bus.doe('track.2.fx.aan', true);
  assert.equal(geweigerd.length, 1);
});

test('volgend/vorig: door de sjablonen (racks/sjablonen.json), rond, met herkomst s:<nr>; de mix blijft', () => {
  const e = nepEngine();
  const fx = definieerFx(e);
  const { racks, fout } = sjablonenUit(SJABLONEN);
  assert.deepEqual(fout, [], 'elk sjabloon leest zonder fouten');
  assert.equal(racks.length, SJABLONEN.racks.length);
  assert.ok(fx.zetSjablonen(racks));
  const slot = e.track(1).strip.fx;
  e.bus.doe('track.1.fx.mix', 0.5);
  e.bus.doe('track.1.fx.volgend', true);
  assert.equal(slot.rackNaam, racks[0].name);
  assert.equal(slot.herkomst, 's:0');
  e.bus.doe('track.1.fx.volgend', true);
  assert.equal(slot.rackNaam, racks[1].name);
  e.bus.doe('track.1.fx.vorig', true);
  e.bus.doe('track.1.fx.vorig', true);
  assert.equal(slot.rackNaam, racks.at(-1).name, 'vorig vanaf het begin: het laatste');
  e.bus.doe('track.1.fx.volgend', true);
  assert.equal(slot.rackNaam, racks[0].name, 'en weer rond');
  assert.equal(slot.mix, 0.5, 'de mix is een knop van het spelen, niet van het rack');
  // Elk sjabloon bouwt in de strip zonder fout.
  for (let i = 0; i < racks.length; i++) e.bus.doe('track.1.fx.volgend', true);
  assert.equal(e.omg.stats.CURVES, 0);
  assert.equal(e.omg.stats.OVERLAP_FOUTEN, 0);
  assert.equal(e.omg.stats.CURVE_BREUK, 0);
  assert.ok(e.meldingen.some((m) => m.sleutel === 'fx:1'));
});

test('zonder sjablonen: één rack per effect (zoals v1 fx.next)', () => {
  const e = nepEngine();
  const fx = definieerFx(e);
  assert.equal(fx.sjablonen().length, EFFECTEN.length);
  assert.equal(effectRacks()[0].chain[0].type, EFFECTEN[0].id);
  e.bus.doe('track.4.fx.volgend', true);
  assert.equal(e.track(4).strip.fx.effectId, EFFECTEN[0].id);
  assert.equal(fx.zetSjablonen([]), false, 'een lege lijst laat de oude staan');
});

test('sends en de knoppen van de bussen', () => {
  const e = nepEngine();
  definieerFx(e);
  e.omg.nu = 1;
  e.bus.doe('track.3.send.a', 0.6);
  assert.ok(dicht(e.bus.lees('track.3.send.a'), 0.6));
  assert.ok(e.mixer.sendAan('A'));
  assert.equal(e.bus.lees('track.3.send.b'), 0);
  assert.ok(dicht(e.bus.lees('send.a.knop.1'), 3 / 7), 'echo knop 1 = tijd op 1/4 tel');
  assert.equal(e.bus.lees('send.a.knop.5'), null);
  e.bus.doe('send.b.knop.3', 1);
  assert.equal(e.mixer.sends.B.paramWaarde('a', 'freeze'), 1, 'galm vasthouden');
  assert.ok(!e.mixer.sendAan('B'), 'een knop draaien wekt de bus niet');
  e.bus.doe('send.a.knop.1', 0);
  assert.equal(e.mixer.sends.A.paramWaarde('a', 'tijd'), 0);
});

test('de maatklok hangt aan elke slot en aan de bussen: de echo op de maat volgt hem', () => {
  const e = nepEngine();
  definieerFx(e);
  e.klok.start(0, 0, 120);
  e.omg.nu = 0.2;
  e.bus.doe('track.1.send.a', 1);
  const kop = e.mixer.sends.A.keten.node.slots.get('a').inst._kop();
  assert.ok(dicht(kop.tijden[kop.actief], 0.5), `1/4 tel op 120 bpm (${kop.tijden})`);
  const k = e.track(5).strip.fx.klok();
  assert.ok(dicht(k.beatLengte, 0.5) && dicht(k.ankerCtx, 0.5), 'de slot van een track leest dezelfde klok');
});

test('met de nep-audio van de engine-tests (strips zonder fx): alles leest null, niets valt om', () => {
  const e = nepEngine({ audio: nepAudio() });
  definieerFx(e);
  for (const id of ['track.1.fx.knop.1', 'track.1.fx.mix', 'track.1.fx.aan', 'track.1.send.a', 'send.a.knop.1']) {
    assert.equal(e.bus.lees(id), null, id);
    const def = e.bus.zoek(id).def;
    e.bus.doe(id, def.soort === 'trigger' ? true : 0.5);
  }
  e.bus.doe('track.1.fx.volgend', true);
});

test('laadSjablonen: de lijst uit het bestand, of null als het niet lukt', async () => {
  const goed = await laadSjablonen('x', { haal: async () => ({ ok: true, json: async () => SJABLONEN }) });
  assert.equal(goed.length, SJABLONEN.racks.length);
  assert.equal(await laadSjablonen('x', { haal: async () => ({ ok: false, text: async () => '' }) }), null);
  assert.equal(await laadSjablonen('x', { haal: async () => { throw new Error('weg'); } }), null);
  assert.equal(await laadSjablonen('x', { haal: null }), null);
});
