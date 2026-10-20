// FM (src/audio/instrumenten/fm.js) op de nep-Web Audio met tijdlijnen. Overgenomen uit v1
// test/instrumenten-fm-schaal.test.mjs deel 1, plus: stemroof en paniek midden in het verval
// zetten een expliciet beginpunt (HOLD_ZONDER_PUNT = 0), en knoppen met een tijd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrOmgeving, schoneTijdlijn } from './instr-nep.mjs';

const { FM, Fm, PARAMS, STEMMEN, ROOF, RATIOS, OPHOGING, releaseVan, filterVan } = await import('../src/audio/instrumenten/fm.js');
const { startDrempel } = await import('../src/audio/overgang.js');

const bijna = (a, b, eps) => Math.abs(a - b) <= eps;

function maak() {
  const omg = instrOmgeving();
  const uit = omg.ctx.createGain();
  return { omg, ctx: omg.ctx, uit, fm: FM.maak(omg.ctx, { uit, klok: null }) };
}

test('FM: definitie, knoppen in echte eenheden, hangt aan uit', () => {
  const { fm, omg, uit } = maak();
  assert.ok(fm instanceof Fm && FM.soort === 'fm' && fm.naam === 'FM' && fm.params === PARAMS && PARAMS.length === 8);
  assert.ok(STEMMEN === 12 && RATIOS[Math.round(fm.leesParam(2) * (RATIOS.length - 1))] === 2, '12 stemmen, ratio 2 (Glass)');
  assert.ok(omg.heeft(fm.uitGain, uit));
  assert.equal(PARAMS[0].eenheid(0.42), '1,4');
  assert.equal(PARAMS[1].eenheid(3 / 9), '1 : 2');
  assert.equal(PARAMS[2].eenheid(0.25), '8 ms');
  assert.equal(PARAMS[3].eenheid(0.58), '1,6 s');
  assert.equal(PARAMS[3].eenheid(1), '∞');
  assert.equal(PARAMS[7].eenheid(0), 'uit');
  assert.ok(fm.start() instanceof Promise);
});

test('FM: een noot is een modulator en twee draaggolven als PeriodicWave, op de audioklok', () => {
  const { fm, omg } = maak();
  omg.nu = 1;
  const voor = omg.bronnen.length;
  fm.noteOn(69, 0.8);
  const s = fm.stemmen[0];
  assert.equal(omg.bronnen.length - voor, 3);
  assert.ok([s.mod, ...s.draag].every((o) => o.gestart === 1));
  assert.ok(s.draag.every((o) => o.frequency.value === 440) && s.mod.frequency.value === 880, 'A4 440 Hz, modulator 880 (ratio 2)');
  assert.ok(s.draag.every((o) => o.type === 'custom') && bijna(s.draag[1].detune.value - s.draag[0].detune.value, 1200 * Math.log2(441 / 440) * (6 * 0.41 * 0.41) / 1, 0.05));
  const piek = OPHOGING * 0.5 * Math.pow(0.8, 1.5);
  assert.ok(s.env.gain.waarde(1) === 0 && bijna(s.env.gain.waarde(1 + 0.00795), piek, piek * 0.01), 'piek na 8 ms');
  assert.ok(bijna(s.env.gain.waarde(2.008) / piek, Math.exp(-1 / 4.86), 0.01), 'verval met τ = 3 × 1,6 s');
  assert.ok(s.vorm.gain.waarde(1) === 1 && s.vorm.gain.waarde(10) < 0.06, 'de index zakt naar 5%');
  assert.ok(bijna(s.diepte.gain.value, 8 * 0.42 * 0.42 * 880 * 0.88, 1e-6));
  assert.ok(bijna(s.filter.frequency.value, 200 * Math.pow(90, 0.57) * 1.15, 1e-6));
  assert.ok(bijna(fm._envOp(s, 1.5), s.env.gain.waarde(1.5), 1e-9), '_envOp rekent wat de param doet');
  fm.noteOn(70, 0.5, 1.25);
  const t = fm.stemmen.at(-1);
  assert.ok([t.mod, ...t.draag].every((o) => o.gestart === 1.25) && t.env.gain.waarde(1.249) === 0 && t.env.gain.waarde(1.27) > 0);
  fm.noteOn(71, 0.5, 0.5);
  assert.equal(fm.stemmen.at(-1).draag[0].gestart, 1, 't in het verleden = nu');
  const n = fm.stemmen.length;
  fm.noteOn(72, 0);
  fm.noteOn(NaN, 1);
  fm.noteOn(200, 1);
  assert.equal(fm.stemmen.length, n, 'snelheid 0 en rare noten doen niets');
});

test('FM: loslaten, pedaal, opruimen op de audioklok', () => {
  const { fm, omg } = maak();
  omg.nu = 1.9;
  fm.noteOn(60, 0.8);
  const s = fm.stemmen[0];
  omg.nu = 2;
  const rel = releaseVan(PARAMS[4].standaard);
  fm.noteOff(60);
  assert.ok(s.los === 2 && bijna(s.env.gain.waarde(2 + rel / 5) / s.env.gain.waarde(2), Math.exp(-1), 0.01));
  assert.ok(s.draag.every((o) => bijna(o.gestopt, 2 + 2 * rel + 0.02, 1e-9)));
  assert.ok(bijna(fm._envOp(s, 2.3), s.env.gain.waarde(2.3), 1e-9));
  omg.nu = 2 + 2 * rel + 0.1;
  fm.stand();
  assert.ok(fm.stemmen.length === 0 && fm.stand().klinkt === 0, 'opgeruimd volgens de audioklok');
  omg.nu = 30;
  fm.houd(true);
  fm.noteOn(64, 0.5);
  fm.noteOff(64);
  const ped = fm.stemmen.at(-1);
  assert.ok(ped.los === null && ped.gehouden);
  omg.nu = 30.5;
  fm.houd(false);
  assert.ok(ped.los === 30.5 && !ped.gehouden);
  assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
});

test('FM: stemroof na de drempel in 8 ms, met een beginpunt (ook gepland), zonder sprong', () => {
  const { fm, omg, ctx } = maak();
  omg.nu = 40;
  for (let i = 0; i < 12; i++) fm.noteOn(48 + i, 0.8);
  assert.equal(fm.stand().klinkt, 12);
  omg.nu = 40.5;
  const oudste = fm.stemmen[0];
  fm.noteOn(70, 0.8);
  const tF = 40.5 + startDrempel(ctx);
  assert.ok(oudste.weg && fm.stemmen.slice(1, 12).every((x) => !x.weg));
  assert.ok(bijna(oudste.env.gain.waarde(tF), oudste.env.gain.waarde(40.5), 1e-3) && oudste.env.gain.waarde(tF + ROOF) === 0);
  assert.deepEqual(oudste.env.gain.sprongen(40.4), [], 'geen sprong');
  assert.ok(oudste.draag.every((o) => o.gestopt >= tF + ROOF));
  fm.noteOff(53);
  fm.noteOn(71, 0.8);
  assert.ok(fm.stemmen[5].weg && !fm.stemmen[1].weg, 'eerst een stem die al los is');
  // Gepland: de oude dooft in de laatste 8 ms vóór t, vanaf zijn stand dan.
  omg.nu = 41;
  const vrij = fm.stemmen.filter((x) => !x.weg);
  fm.noteOn(90, 0.8, 42.3);
  const g = vrij[0].env.gain;
  assert.ok(vrij[0].weg && g.waarde(42.29) > 0 && g.waarde(42.3) === 0);
  assert.ok(bijna(g.waarde(42.3 - ROOF), fm._envOp(vrij[0], 42.3 - ROOF), 1e-9));
  assert.deepEqual(g.sprongen(41), []);
  assert.ok(fm.stemmen.filter((x) => !x.weg && x.einde > omg.nu).length <= 12);
  assert.equal(omg.stats.HOLD_ZONDER_PUNT, 0, 'elke helling na een hold heeft een beginpunt');
  assert.ok(schoneTijdlijn(omg));
});

test('FM: druk, buigen, modwiel, knoppen (ook met een tijd), warmte, stil, vernietig', async () => {
  const { fm, omg, uit } = maak();
  omg.nu = 43;
  fm.noteOn(69, 0.8);
  const doel = fm.stemmen.at(-1);
  const d0 = doel.diepte.gain.value;
  fm.druk(1);
  assert.ok(bijna(doel.diepte.gain.waarde(43.5) / d0, 2.5, 1e-3));
  fm.druk(0);
  fm.druk(0, 69);
  assert.ok(bijna(doel.diepte.gain.waarde(44), d0, d0 * 1e-3));
  fm.buig(1);
  assert.ok(bijna(fm.buigBron.offset.waarde(44.1), 200, 0.01) && doel.draag.every((o) => omg.heeft(fm.buigBron, o.detune)));
  fm.buig(-5);
  assert.ok(bijna(fm.buigBron.offset.waarde(44.2), -200, 0.01));
  fm.mod(1);
  assert.ok(bijna(fm.vibrato.gain.waarde(44.5), 30, 0.01));
  const f0 = doel.filter.frequency.value;
  fm.zetParam(7, 1);
  assert.ok(doel.filter.frequency.waarde(44.7) > f0 * 3);
  fm.zetParam(2, 0);
  assert.ok(bijna(doel.mod.frequency.waarde(44.9), doel.hz * 0.5, 0.5));
  fm.zetParam(8, 1);
  assert.ok(bijna(fm.droog.gain.waarde(45.3), 0, 1e-3) && bijna(fm.na.gain.waarde(45.3) * fm.voor.gain.waarde(45.3) * 4, 1, 1e-3));
  assert.ok(fm.shaper.oversample === '4x' && bijna(fm.shaper.curve[2048], Math.tanh(4), 1e-6));
  // Met een tijd: het filter op 46 s, niet eerder; leesParam op nu ziet het nog niet.
  const gemeld = [];
  fm.on('param', (e) => gemeld.push(e));
  fm.zetParam(7, 0.2, 46);
  assert.ok(fm.leesParam(7) === 1 && fm.leesParam(7, 46) === 0.2 && gemeld[0].t === 46);
  assert.ok(doel.filter.frequency.waarde(45.9) > filterVan(0.5) && doel.filter.frequency.waarde(46.5) < filterVan(0.5));
  // Stil.
  omg.nu = 47;
  fm.houd(true);
  fm.noteOn(60, 1); fm.noteOn(64, 1, 47.05);
  const levend = fm.stemmen.filter((x) => !x.weg);
  fm.stil();
  const tS = 47 + startDrempel(omg.ctx);
  assert.ok(levend.every((x) => x.weg && x.env.gain.waarde(tS + ROOF) === 0));
  assert.ok(levend.at(-1).env.gain.waarde(47.05) === 0, 'een noot die nog moest komen klinkt niet');
  assert.ok(!fm.pedaal && fm.buigBron.offset.waarde(47.4) < 0.01 && fm.vibrato.gain.waarde(47.4) < 0.01);
  omg.nu = 48;
  assert.equal(fm.stand().klinkt, 0);
  assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
  fm.vernietig();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!omg.heeft(fm.uitGain, uit) && fm.lfo.gestopt !== null && fm.buigBron.gestopt !== null);
  let gooit = false;
  try { fm.noteOn(60, 1); fm.zetParam(1, 0.5); fm.stil(); fm.vernietig(); } catch (_) { gooit = true; }
  assert.ok(!gooit && fm.stemmen.length === 0);
});
