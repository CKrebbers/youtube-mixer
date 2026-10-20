// De koptelefoon (src/audio/koptelefoon.js) op de strenge Web Audio-mock: zonder vier kanalen
// verandert er niets, met vier de zaal op 1/2 en de koptelefoon op 3/4, de cue VÓÓR de fader
// (ook de natte weg van de insert-slot), klikvrij aan en uit, mix en volume, en de acties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NepOmgeving, installeer } from './web-audio-mock.mjs';

installeer();
const { maakStrip, faderGain, KILL_FADE } = await import('../src/audio/strip.js');
const { maakMixer, COMPRESSOR_VERTRAGING } = await import('../src/audio/mixer.js');
const { kanten, kanApart } = await import('../src/audio/koptelefoon.js');
const { startDrempel } = await import('../src/audio/overgang.js');
const { Bus } = await import('../src/kern/bus.js');
const { definieerActies } = await import('../src/engine/acties.js');

const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

function opzet({ kanalen = 4, omgewisseld = false } = {}) {
  const omg = new NepOmgeving();
  omg.ctx.destination.maxChannelCount = kanalen;
  const m = maakMixer(omg.ctx, { limiter: false, omgewisseld });
  const st = maakStrip(omg.ctx, m);
  return { omg, ctx: omg.ctx, m, st, kop: m.koptelefoon };
}

const schoon = (omg) => {
  assert.equal(omg.stats.CURVES, 0);
  assert.equal(omg.stats.RAMP_NA_DOEL, 0);
  assert.equal(omg.stats.VERLEDEN, 0);
};

test('twee kanalen: geen koptelefoon, de master gaat zoals altijd naar de uitgang', () => {
  const { omg, ctx, m, st, kop } = opzet({ kanalen: 2 });
  assert.equal(kanApart(ctx), false);
  assert.equal(kop.beschikbaar, false);
  assert.ok(omg.heeft(m.analyser, ctx.destination), 'analyser -> uitgang');
  assert.equal(omg.lijnen.filter((l) => l.van.soort === 'merger').length, 0, 'geen merger');
  const voor = omg.lijnen.length;
  assert.equal(st.pfl(true), false);
  assert.equal(st.lees('pfl'), null);
  assert.equal(omg.lijnen.length, voor, 'pfl zonder koptelefoon zet niets bij');
});

test('vier kanalen: de zaal op 1/2, de koptelefoon op 3/4, de uitgang discreet', () => {
  const { omg, ctx, m, kop } = opzet();
  const d = ctx.destination;
  assert.equal(kop.beschikbaar, true);
  assert.equal(d.channelCount, 4);
  assert.equal(d.channelInterpretation, 'discrete');
  assert.ok(omg.heeft(m.analyser, kop.zaalIn), 'master -> zaal');
  assert.ok(omg.heeft(m.analyser, kop.zaalKant), 'master ook in de koptelefoon');
  assert.ok(omg.heeft(kop.merger, d));
  const naarMerger = omg.naar(kop.merger).map((l) => [l.van === kop.zaalIn ? 'zaal' : 'kop', l.uit, l.inn]);
  assert.deepEqual(naarMerger.filter((x) => x[0] === 'zaal').map((x) => x[2]).sort(), [0, 1]);
  assert.deepEqual(naarMerger.filter((x) => x[0] === 'kop').map((x) => x[2]).sort(), [2, 3]);
  // Zonder cue hoort de koptelefoon de zaal, op het beginvolume.
  assert.equal(kop.zaalKant.gain.value, 1);
  assert.ok(dicht(kop.uit.gain.value, faderGain(0.8)));
  // De cue loopt even laat als de zaal (de vooruitblik van de compressor).
  assert.ok(dicht(kop.cueVertraging.delayTime.waarde(0.05), COMPRESSOR_VERTRAGING));
});

test('omgewisseld: de zaal op 3/4, de koptelefoon op 1/2', () => {
  const { omg, kop } = opzet({ omgewisseld: true });
  const zaal = omg.naar(kop.merger).filter((l) => l.van === kop.zaalIn).map((l) => l.inn).sort();
  assert.deepEqual(zaal, [2, 3]);
});

test('de cue tapt vóór de fader en gaat klikvrij aan en uit; mix verdeelt cue en zaal', () => {
  const { omg, ctx, st, kop } = opzet();
  ctx.resume();
  omg.nu = 1;
  assert.equal(st.lees('pfl'), 0);
  assert.equal(st.pfl(true), true);
  assert.equal(st.lees('pfl'), 1);
  const g = st._pflIn.g;
  assert.ok(omg.heeft(st.naFilter, g), 'naFilter (vóór de fader) -> pfl');
  assert.ok(omg.heeft(g, kop.cue));
  assert.ok(!omg.heeft(st.nodes.fader, g), 'niet na de fader');
  const klaar = 1 + startDrempel(ctx) + KILL_FADE + 1e-6;
  assert.ok(dicht(g.gain.waarde(klaar), 1));
  assert.deepEqual(g.gain.sprongen(1), []);
  // Met een cue aan: mix 0 = alleen de cue.
  assert.ok(dicht(kop.cueKant.gain.waarde(2), 1, 1e-6));
  assert.ok(kop.zaalKant.gain.waarde(2) < 1e-6);
  kop.zetMix(0.5);
  const k = kanten(0.5, true);
  assert.ok(dicht(kop.cueKant.gain.waarde(3), k.cue, 1e-6) && dicht(kop.zaalKant.gain.waarde(3), k.zaal, 1e-6));
  // De fader dicht: de cue verandert niet (hij zit ervoor).
  st.zet('fader', 0);
  assert.ok(dicht(g.gain.waarde(3), 1));
  omg.nu = 3;
  st.pfl(false);
  assert.ok(dicht(g.gain.waarde(3 + startDrempel(ctx) + KILL_FADE + 1e-6), 0));
  assert.equal(kop.iets, false);
  schoon(omg);
});

test('de natte weg van de insert-slot gaat ook naar de cue, voor en na de eerste pfl', () => {
  const a = opzet();
  a.st.fx.setMix(1);                     // eerst een keten, dan pfl
  const nat1 = a.st._natten.at(-1);
  assert.ok(nat1, 'een keten');
  a.st.pfl(true);
  assert.ok(a.omg.heeft(nat1, a.st._pflIn.g));
  const b = opzet();
  b.st.pfl(true);                        // eerst pfl, dan een keten
  b.st.fx.setMix(1);
  assert.ok(b.omg.heeft(b.st._natten.at(-1), b.st._pflIn.g));
});

test('acties: track.{n}.pfl wisselt, volume en mix, niet in het log; zonder koptelefoon null', () => {
  for (const kanalen of [4, 2]) {
    const omg = new NepOmgeving();
    omg.ctx.destination.maxChannelCount = kanalen;
    const mixer = maakMixer(omg.ctx, { limiter: false });
    const strips = [maakStrip(omg.ctx, mixer), maakStrip(omg.ctx, mixer)];
    const bus = new Bus({ tracks: 2 });
    const uit = [];
    const engine = { bus, mixer, ctx: omg.ctx, track: (n) => ({ n, strip: strips[n - 1] }), emit: (...a) => uit.push(a), on() {}, nu: () => 0 };
    definieerActies(engine);
    const def = bus.def?.('track.1.pfl') ?? null;
    if (kanalen === 4) {
      bus.doe('track.1.pfl', true); bus.doe('track.1.pfl', false);
      assert.equal(bus.lees('track.1.pfl'), 1);
      assert.equal(bus.lees('track.2.pfl'), 0);
      bus.doe('track.1.pfl', true);
      assert.equal(bus.lees('track.1.pfl'), 0);
      bus.doe('koptelefoon.volume', 0.5); bus.doe('koptelefoon.mix', 0.25);
      assert.equal(bus.lees('koptelefoon.volume'), 0.5);
      assert.equal(bus.lees('koptelefoon.mix'), 0.25);
    } else {
      const r = bus.doe('track.1.pfl', true);
      assert.ok(r?.geweigerd, 'geweigerd met een reden');
      assert.equal(bus.lees('track.1.pfl'), null);
      assert.equal(bus.lees('koptelefoon.volume'), null);
      assert.equal(bus.lees('koptelefoon.mix'), null);
    }
    void def;
  }
});

test('de meta van de koptelefoonacties: niet in het log en niet in de beginstand', async () => {
  const omg = new NepOmgeving();
  omg.ctx.destination.maxChannelCount = 4;
  const mixer = maakMixer(omg.ctx, { limiter: false });
  const bus = new Bus({ tracks: 1 });
  const metas = [];
  bus.on('actie', ({ id, meta }) => metas.push([id, meta]));
  definieerActies({ bus, mixer, ctx: omg.ctx, track: () => ({ strip: maakStrip(omg.ctx, mixer) }), emit() {}, on() {}, nu: () => 0 });
  bus.doe('koptelefoon.mix', 0.5);
  bus.doe('track.1.pfl', true);
  for (const [id, meta] of metas) assert.equal(meta.log, 'overslaan', id);
});
