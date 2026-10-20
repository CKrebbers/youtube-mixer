// Het contract van een instrument, voor alle vier (src/audio/instrumenten/index.js): de lijst,
// de leden, de knoppen, noten vóór start, een noot die vooruit gepland is, zetParam met een
// tijd en zijn melding, stil, vernietig, en nergens een curve of een helling zonder beginpunt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installeer } from './web-audio-mock.mjs';
import { instrOmgeving, schoneTijdlijn } from './instr-nep.mjs';
import { Klok } from '../src/kern/klok.js';

installeer();
const { INSTRUMENTEN, instrumentDef, CONTRACT } = await import('../src/audio/instrumenten/index.js');

test('de lijst: poly, fm, schaal, drums; instrumentDef vindt ze', () => {
  assert.deepEqual(INSTRUMENTEN.map((d) => d.soort), ['poly', 'fm', 'schaal', 'drums']);
  for (const d of INSTRUMENTEN) {
    assert.ok(/^[a-z0-9-]+$/.test(d.soort) && typeof d.naam === 'string' && typeof d.maak === 'function');
    assert.equal(instrumentDef(d.soort), d);
  }
  assert.equal(instrumentDef('xx'), null);
});

for (const def of INSTRUMENTEN) {
  test(`contract: ${def.soort}`, async () => {
    const omg = instrOmgeving();
    const ctx = omg.ctx;
    const uit = ctx.createGain();
    const klok = new Klok();
    klok.start(0, 0, 120);
    const inst = def.maak(ctx, { uit, klok, toon: () => 'Am' });
    for (const lid of CONTRACT) assert.equal(typeof inst[lid], 'function', `${def.soort}.${lid}`);
    assert.ok(inst.soort === def.soort && inst.naam === def.naam);
    assert.ok(Array.isArray(inst.params) && inst.params.length >= 1 && inst.params.length <= 8);
    for (const p of inst.params) {
      assert.ok(p.id && p.label && p.standaard >= 0 && p.standaard <= 1 && typeof p.eenheid(p.standaard) === 'string', `${def.soort}: ${p.id}`);
      assert.equal(typeof p.eenheid(0), 'string');
      assert.equal(typeof p.eenheid(1), 'string');
    }
    // Noten vóór start(): nooit gooien.
    inst.noteOn(60, 0.8); inst.noteOff(60); inst.alleUit(); inst.druk(0.5); inst.buig(0.5); inst.mod(0.5); inst.houd(true); inst.houd(false); inst.stil();
    const s = inst.start();
    assert.ok(s instanceof Promise && inst.start() === s, 'start() is idempotent');
    await s;
    // Knoppen: standaard, klemmen, buiten het bereik, met een tijd, en melden.
    const n = inst.params.length;
    assert.deepEqual(inst.stand().params, inst.params.map((p) => p.standaard));
    assert.ok(inst.leesParam(0) === null && inst.leesParam(n + 1) === null);
    const gemeld = [];
    inst.on('param', (e) => gemeld.push(e));
    omg.nu = 1;
    inst.zetParam(1, 7);
    assert.equal(inst.leesParam(1), 1, 'geklemd op 0..1');
    inst.zetParam(1, 0.25, 3);
    assert.ok(inst.leesParam(1) === 1 && inst.leesParam(1, 3) === 0.25 && inst.leesParam(1, 2.99) === 1, 'een knop met een tijd geldt vanaf die tijd');
    assert.ok(gemeld.length === 2 && gemeld[1].k === 1 && gemeld[1].v === 0.25 && gemeld[1].t === 3);
    inst.zetParam(n + 1, 0.5);
    inst.zetParam(1, NaN);
    assert.equal(gemeld.length, 2, 'een plek die er niet is of geen getal: niets');
    // Een noot nu, een vooruit, loslaten, alles.
    inst.noteOn(69, 0.8);
    inst.noteOn(72, 0.8, 1.5);
    inst.noteOff(69, 1.2);
    inst.noteOff(72, 2);
    const st = inst.stand();
    assert.ok(st.soort === def.soort && st.naam === def.naam && Number.isInteger(st.klinkt) && st.params.length === n);
    inst.alleUit(2.5);
    omg.nu = 3;
    inst.stil();
    assert.ok(schoneTijdlijn(omg), `${def.soort}: ${JSON.stringify(omg.stats)}`);
    inst.vernietig();
    inst.vernietig();
    let gooit = false;
    try { inst.noteOn(60, 1); inst.zetParam(1, 0.5); inst.stil(); inst.stand(); } catch (_) { gooit = true; }
    assert.ok(!gooit, 'na vernietig gooit niets');
  });
}

test('aansluiten op een track: een eigen GainNode op strip.in; weg() is eerst dicht (zachte S), dan los', async () => {
  const { sluitAan, instrumentSoorten, MARGE } = await import('../src/audio/instrumenten/aansluiting.js');
  const { startDrempel } = await import('../src/audio/overgang.js');
  const { KILL_FADE } = await import('../src/audio/strip.js');
  assert.deepEqual(instrumentSoorten().map((d) => d.soort), ['poly', 'fm', 'schaal', 'drums']);
  assert.ok(instrumentSoorten().every((d) => typeof d.naam === 'string' && Object.keys(d).length === 2));
  for (const soort of ['poly', 'fm', 'schaal', 'drums']) {
    const omg = instrOmgeving();
    const ctx = omg.ctx;
    const strip = { in: ctx.createGain() };
    const a = sluitAan(ctx, soort, strip, { klok: null, toon: () => 'Am' });
    assert.ok(a.soort === soort && a.inst.soort === soort && omg.heeft(a.aansluiting, strip.in), `${soort}: aansluiting op strip.in`);
    await a.inst.start();
    omg.nu = 1;
    a.inst.noteOn(60, 0.8);
    let klaar = false;
    const p = a.weg();
    assert.equal(a.weg(), p, 'nog eens weg() = dezelfde Promise');
    p.then(() => { klaar = true; });
    const g = a.aansluiting.gain, eind = 1 + startDrempel(ctx) + KILL_FADE;
    assert.ok(Math.abs(g.waarde(1 + startDrempel(ctx)) - 1) < 1e-9 && g.waarde(eind) === 0 && g.sprongen(0.5).length === 0, `${soort}: dicht met een helling, zonder sprong`);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(!klaar && omg.heeft(a.aansluiting, strip.in), 'pas los als de audioklok voorbij de fade is');
    omg.nu = eind + MARGE + 0.001;
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(klaar && !omg.heeft(a.aansluiting, strip.in), `${soort}: daarna los`);
    assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
  }
  assert.throws(() => sluitAan(instrOmgeving().ctx, 'xx', { in: null }), /onbekend instrument/);
});
