// De Poly (src/audio/instrumenten/poly.js) op de nep-Web Audio met tijdlijnen: het contract,
// de ADSR, loslaten, stemroof zonder tik (live en gepland), het pedaal, knoppen met een tijd
// (p-lock), buigen, druk, modwiel, vernietigen. Overgenomen uit v1 test/instrumenten.test.mjs
// deel 1; de toonhoogte en de luidheid meet tools/proef-instr.mjs in Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrOmgeving, schoneTijdlijn } from './instr-nep.mjs';

const { Poly, POLY, PARAMS, POLYFONIE, OPHOGING, BUIG_CENT, DRUK_OCT, VIBRATO_CENT, filterHz, vervalTijd, attackTijd, nootHz, golfVan } =
  await import('../src/audio/instrumenten/poly.js');
const { startDrempel } = await import('../src/audio/overgang.js');
const { KILL_FADE } = await import('../src/audio/strip.js');

const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const SR = 48000;

function maak() {
  const omg = instrOmgeving({ sampleRate: SR });
  const ctx = omg.ctx;
  const uit = ctx.createGain();
  const p = POLY.maak(ctx, { uit, klok: null, toon: () => null });
  return { omg, ctx, uit, p };
}

test('Poly: de definitie, het object en de knoppen (contract)', () => {
  const { p, uit, omg } = maak();
  assert.ok(/^[a-z0-9-]+$/.test(POLY.soort) && POLY.naam === 'Poly' && typeof POLY.maak === 'function');
  assert.ok(p instanceof Poly && p.soort === 'poly' && p.naam === 'Poly');
  for (const f of ['start', 'noteOn', 'noteOff', 'alleUit', 'stil', 'druk', 'buig', 'mod', 'houd', 'zetParam', 'leesParam', 'stand', 'vernietig', 'on']) {
    assert.equal(typeof p[f], 'function', f);
  }
  assert.ok(p.params === PARAMS && PARAMS.length === 8);
  assert.ok(PARAMS.every((x) => x.id && x.label && x.standaard >= 0 && x.standaard <= 1 && typeof x.eenheid(x.standaard) === 'string'));
  assert.equal(PARAMS[0].eenheid(0), 'zaag');
  assert.equal(PARAMS[0].eenheid(1), 'sinus');
  assert.equal(PARAMS[1].eenheid(0.2), '±8 ct');
  assert.equal(PARAMS[2].eenheid(0.62), '2,1 kHz');
  assert.equal(PARAMS[5].eenheid(0.22), '10 ms');
  assert.equal(PARAMS[6].eenheid(0.55), '337 ms');
  assert.equal(PARAMS[7].eenheid(0.7), '70%');
  assert.ok(p.start() instanceof Promise && p.start() instanceof Promise, 'start() is een Promise, en nog eens mag');
  assert.ok(dicht(p.bus.gain.value, OPHOGING) && omg.heeft(p.bus, uit), 'de bus op de ophoging, naar uit');
  assert.deepEqual(p.stand(), { soort: 'poly', naam: 'Poly', klinkt: 0, params: PARAMS.map((x) => x.standaard) });
});

test('Poly: A4 is twee oscillatoren op 440 Hz, met de ADSR op de vca en het filter', () => {
  const { p, omg } = maak();
  omg.nu = 10;
  p.noteOn(69, 0.8);
  const s = p.stemmen[0];
  assert.ok(s.oscs.length === 2 && s.oscs.every((o) => o.frequency.value === 440) && dicht(nootHz(60), 261.6255653005986));
  assert.ok(s.oscs[0].detune.value === -8 && s.oscs[1].detune.value === 8 && s.oscs.every((o) => o.type === 'sawtooth'));
  assert.ok(s.oscs.every((o) => o.gestart === 10), 'beginnen nu, op de audioklok');
  assert.ok(s.oscs.every((o) => omg.heeft(o, s.filter)) && s.filter.type === 'lowpass' && omg.heeft(s.filter, s.vca) && omg.heeft(s.vca, p.bus));
  assert.ok(s.oscs.every((o) => omg.heeft(p.buigBron, o.detune) && omg.heeft(p.vibrato, o.detune)) && omg.heeft(p.drukBron, s.filter.detune));
  const A = attackTijd(PARAMS[5].standaard), D = vervalTijd(PARAMS[6].standaard), S = PARAMS[7].standaard;
  const piek = 0.5 * 0.8 * 0.8;
  const g = s.vca.gain;
  assert.ok(g.waarde(10) === 0 && dicht(g.waarde(10 + A / 2), piek / 2, 1e-9) && dicht(g.waarde(10 + A), piek, 1e-9), 'attack: lineair naar de piek');
  assert.ok(dicht(g.waarde(10 + A + D / 3), piek * S + piek * (1 - S) * Math.exp(-1), 1e-9), 'decay: naar sustain met τ = decay/3');
  const diep = 0.35 * 6000 * (0.5 + 0.5 * 0.8);
  assert.ok(dicht(s.filter.detune.waarde(10 + A), diep, 1e-6) && dicht(s.filter.frequency.value, filterHz(0.62)), 'dezelfde vorm op het filter, dieper bij harder');
  assert.equal(p.stand().klinkt, 1);
  assert.ok(dicht(p._envOp(s, 10 + A / 2), g.waarde(10 + A / 2), 1e-12) && dicht(p._envOp(s, 12), g.waarde(12), 1e-9), '_envOp rekent wat de param doet');

  omg.nu = 11;
  const v11 = g.waarde(11);
  p.noteOff(69);
  const R = vervalTijd(PARAMS[6].standaard);
  assert.ok(s.los && dicht(g.waarde(11 + R / 3), v11 * Math.exp(-1), 1e-9), 'noteOff: vanaf waar hij is, τ = release/3');
  assert.ok(s.oscs.every((o) => dicht(o.gestopt, 11 + 3 * R + 0.02)), 'stop na 3× release');
  assert.ok(dicht(p._envOp(s, 11.2), g.waarde(11.2), 1e-9), '_envOp ook na het loslaten');
  assert.equal(p.stand().klinkt, 1, 'klinkt nog uit tot zijn stop');
  omg.nu = 11 + 3 * R + 0.03;
  omg.vuurEinden();
  assert.equal(p.stand().klinkt, 0);
  assert.ok(!omg.lijnen.some((l) => l.van === s.vca || l.van === s.filter || s.oscs.includes(l.van) || s.oscs.some((o) => l.naar === o.detune)), 'na de stop losgemaakt');
  assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
});

test('Poly: snelheid 0 = los, dezelfde noot nog eens laat de oude los, stil()', () => {
  const { p, omg } = maak();
  omg.nu = 20;
  p.noteOn(60, 0);
  assert.equal(p.stand().klinkt, 0);
  p.noteOn(60, 1);
  p.noteOn(60, 1);
  assert.equal(p.stemmen.filter((x) => x.noot === 60 && !x.los).length, 1);
  assert.equal(p.stemmen.filter((x) => x.noot === 60 && x.los).length, 1);
  p.stil();
  assert.equal(p.stand().klinkt, 0);
  assert.ok(schoneTijdlijn(omg));
});

test('Poly: stemroof neemt de oudste (eerst wat los is), met een zachte S zonder tik', () => {
  const { p, omg, ctx } = maak();
  omg.nu = 30;
  for (let i = 0; i < POLYFONIE; i++) { omg.nu = 30 + i * 0.01; p.noteOn(40 + i, 0.7); }
  assert.ok(POLYFONIE >= 8 && p.stand().klinkt === POLYFONIE);
  const eerste = p.stemmen.find((x) => x.noot === 40);
  omg.nu = 31;
  const van = eerste.vca.gain.waarde(31);
  p.noteOn(80, 0.7);
  const W = startDrempel(ctx);
  assert.ok(eerste.gestolen && p.stand().klinkt === POLYFONIE && p.stemmen.some((x) => x.noot === 80 && !x.gestolen));
  const g = eerste.vca.gain;
  assert.deepEqual(g.sprongen(30.999), [], 'geen sprong in de tijdlijn');
  assert.ok(dicht(g.waarde(31 + W), van, 1e-6) && g.waarde(31 + W + KILL_FADE) === 0, 'vasthouden tot de drempel, dan in KILL_FADE naar 0');
  const sStap = (van * Math.PI) / (2 * KILL_FADE * SR);
  const stap = g.grootsteStap(31, 31 + W + KILL_FADE + 0.001);
  assert.ok(stap <= 1.25 * sStap, `grootste stap ${stap.toExponential(2)} ≤ 1,25 × de S (${sStap.toExponential(2)})`);
  assert.ok(eerste.oscs.every((o) => dicht(o.gestopt, 31 + W + KILL_FADE + 0.005)), 'daarna gestopt');
  omg.nu = 32;
  p.noteOff(50);
  const los = p.stemmen.find((x) => x.noot === 50 && !x.gestolen);
  p.noteOn(81, 0.7);
  assert.ok(los.gestolen && !p.stemmen.find((x) => x.noot === 41).gestolen, 'eerst een stem die al los is');
  assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
});

test('Poly: gepland roven begint op de stand die de envelope DAN heeft (expliciet beginpunt)', () => {
  const { p, omg } = maak();
  omg.nu = 34;
  for (let i = 0; i < POLYFONIE; i++) p.noteOn(40 + i, 0.7);
  const oudste = p.stemmen.find((x) => x.noot === 40);
  p.noteOn(90, 0.7, 36);
  const g = oudste.vca.gain;
  const S = PARAMS[7].standaard, A = attackTijd(PARAMS[5].standaard), D = vervalTijd(PARAMS[6].standaard);
  const dan = 0.5 * 0.49 * (S + (1 - S) * Math.exp(-(36 - 34 - A) / (D / 3)));
  assert.ok(oudste.gestolen && dicht(g.waarde(36), dan, 1e-9) && dicht(g.waarde(36 - 1e-6), dan, 1e-6), 'continu op t');
  assert.deepEqual(g.sprongen(35), [], 'geen sprong');
  assert.equal(g.waarde(36 + KILL_FADE), 0);
  assert.equal(omg.stats.HOLD_ZONDER_PUNT, 0, 'geen helling na een hold zonder beginpunt (Chrome)');
  const nieuw = p.stemmen.find((x) => x.noot === 90);
  assert.ok(nieuw.oscs.every((o) => o.gestart === 36) && nieuw.vca.gain.waarde(35.99) === 0, 'de nieuwe noot op zijn tijd');
});

test('Poly: het pedaal houdt vast, alleUit laat alles los', () => {
  const { p, omg } = maak();
  omg.nu = 40;
  p.noteOn(64, 0.5);
  p.houd(true);
  p.noteOff(64);
  const h = p.stemmen.find((x) => x.noot === 64);
  assert.ok(!h.los && h.vastgehouden && p.stand().klinkt === 1);
  omg.nu = 41;
  p.houd(false);
  assert.ok(h.los && !h.vastgehouden);
  p.noteOn(65, 0.5);
  p.alleUit();
  assert.equal(p.stemmen.filter((x) => !x.gestolen && !x.los).length, 0);
});

test('Poly: knoppen, ook met een tijd (p-lock), en ze melden zichzelf', () => {
  const { p, omg } = maak();
  omg.nu = 50;
  const gemeld = [];
  p.on('param', (e) => gemeld.push(e));
  p.noteOn(67, 0.5);
  const k = p.stemmen.at(-1);
  p.zetParam(3, 0.2);
  assert.ok(p.leesParam(3) === 0.2 && dicht(k.filter.frequency.waarde(51), filterHz(0.2), 1e-3), 'filter op wat klinkt');
  p.zetParam(4, 1);
  assert.ok(dicht(k.filter.Q.waarde(51), 18, 1e-6));
  p.zetParam(2, 0.5);
  assert.ok(dicht(k.oscs[0].detune.waarde(51), -20, 1e-6) && dicht(k.oscs[1].detune.waarde(51), 20, 1e-6));
  p.zetParam(1, 0.99);
  assert.ok(k.oscs[0].type === 'sawtooth' && golfVan(0.99) === 'sine');
  p.noteOn(69, 0.5);
  assert.ok(p.stemmen.at(-1).oscs.every((o) => o.type === 'sine'), 'golf vanaf de volgende noot');
  assert.ok(p.leesParam(0) === null && p.leesParam(9) === null);
  p.zetParam(5, 2);
  assert.equal(p.leesParam(5), 1, 'geklemd');
  assert.ok(gemeld.length === 5 && gemeld[0].k === 3 && gemeld[0].v === 0.2 && gemeld[0].t === 50, 'elke draai meldt { k, v, t }');

  // p-lock: de golf op 52 s wordt blok, een noot die daarna begint krijgt hem, een noot nu niet.
  p.zetParam(1, 0.3, 52);
  assert.ok(p.leesParam(1) === 0.99 && p.leesParam(1, 52) === 0.3 && gemeld.at(-1).t === 52);
  p.noteOn(70, 0.5);
  p.noteOn(71, 0.5, 52.5);
  assert.ok(p.stemmen.find((x) => x.noot === 70).oscs[0].type === 'sine' && p.stemmen.find((x) => x.noot === 71).oscs[0].type === 'square');
  p.zetParam(3, 0.9, 53);
  const t71 = p.stemmen.find((x) => x.noot === 71);
  assert.ok(dicht(t71.filter.frequency.waarde(52.9), filterHz(0.2), 1e-3) && dicht(t71.filter.frequency.waarde(53.5), filterHz(0.9), 1), 'filter op 53 s, niet eerder');
  p.zetParam(1, 0.6);
  assert.equal(p.leesParam(1, 52), 0.6, 'een draai nu wint van wat er gepland stond');
  omg.nu = 54;
  p.zetParam(1, 0.1);
  assert.ok(p._lijn[0].p.length <= 2, 'oude punten opgeruimd');
  assert.ok(schoneTijdlijn(omg));
});

test('Poly: buigen, druk en modwiel; noten vooruit en in het verleden', () => {
  const { p, omg } = maak();
  omg.nu = 60;
  p.noteOn(69, 0.5);
  p.buig(1);
  assert.ok(dicht(p.buigBron.offset.waarde(61), BUIG_CENT, 1e-6) && BUIG_CENT === 200);
  p.buig(-3);
  assert.ok(dicht(p.buigBron.offset.waarde(62), -BUIG_CENT, 1e-6), 'geklemd op −1');
  p.druk(0.5);
  assert.ok(dicht(p.drukBron.offset.waarde(63), 0.5 * DRUK_OCT * 1200, 1e-6));
  const d69 = p.stemmen.at(-1);
  p.druk(1, 69);
  assert.ok(dicht(d69.filter.frequency.waarde(64), filterHz(0.62) * 4, 1e-3) && d69.druk === 1, 'polyfone druk: alleen die stem');
  p.mod(1);
  assert.ok(dicht(p.vibrato.gain.waarde(65), VIBRATO_CENT, 1e-6));
  omg.nu = 70;
  p.stil();
  p.noteOn(72, 0.6, 71);
  const t = p.stemmen.at(-1);
  assert.ok(t.oscs.every((o) => o.gestart === 71) && t.vca.gain.waarde(70.99) === 0);
  p.noteOff(72, 72);
  assert.ok(t.los && t.env.los.t1 === 72);
  p.noteOn(73, 0.6, 69);
  assert.equal(p.stemmen.at(-1).oscs[0].gestart, 70, 't in het verleden = nu');
  assert.ok(schoneTijdlijn(omg));
});

test('Poly: vernietig is eerst stil, dan los; daarna doet niets meer iets', async () => {
  const { p, omg, uit } = maak();
  omg.nu = 80;
  p.noteOn(60, 0.5);
  p.vernietig();
  assert.ok(p.stand().klinkt === 0 && omg.heeft(p.bus, uit), 'eerst de fade, de bus nog aan');
  await new Promise((r) => setTimeout(r, 130));
  assert.ok(!omg.heeft(p.bus, uit) && p.buigBron.gestopt !== null && p.lfo.gestopt !== null);
  const n = omg.bronnen.length;
  p.noteOn(60, 1);
  assert.ok(omg.bronnen.length === n && p.stand().klinkt === 0);
  assert.ok(schoneTijdlijn(omg));
});
