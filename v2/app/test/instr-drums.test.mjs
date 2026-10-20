// De Drums (src/audio/instrumenten/drums.js) op de nep-Web Audio. Overgenomen uit v1
// test/instrumenten-drums.test.mjs (de kern ervan): de kit, de pads op noot 36–51, plannen,
// choke, dezelfde pad opnieuw, stemroof, stil() zonder sprong, pads 9–16, de knoppen (ook een
// p-lock op KICK: de pad wordt opnieuw gerekend voor die aanslag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrOmgeving, schoneTijdlijn } from './instr-nep.mjs';

const { DRUMS, Drums, KIT, PARAMS, MAX_STEMMEN, KAP, STIL, UIT_OPHOGING, padVanNoot, snelheidGain, kickVerhouding } =
  await import('../src/audio/instrumenten/drums.js');
const { startDrempel } = await import('../src/audio/overgang.js');
const { faderGain } = await import('../src/audio/strip.js');

const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const bron = (omg) => omg.bronnen.filter((b) => b.soort === 'buffersource').at(-1);

async function maak() {
  const omg = instrOmgeving();
  const uit = omg.ctx.createGain();
  const d = DRUMS.maak(omg.ctx, { uit });
  await d.start();
  return { omg, ctx: omg.ctx, uit, d };
}

test('Drums: definitie, knoppen, stand, de kit gerekend bij start()', async () => {
  const omg = instrOmgeving();
  const uit = omg.ctx.createGain();
  const d = DRUMS.maak(omg.ctx, { uit });
  assert.ok(d instanceof Drums && DRUMS.soort === 'drums' && d.naam === 'Drums' && omg.heeft(d.uit, uit));
  assert.equal(d.params.map((q) => q.id).join(' '), 'toon decay filter drive kick snare hats niveau');
  d.noteOn(36, 1);
  assert.ok(omg.bronnen.length === 0 && d.fouten === 0, 'vóór start(): stil, geen fout');
  const a = d.start(), b = d.start();
  assert.ok(a instanceof Promise && a === b);
  await a;
  assert.ok(d.pads.slice(0, 8).every((q) => q.buffer && q.buffer.numberOfChannels === 1 && q.buffer.sampleRate === 48000));
  assert.ok(d.pads.slice(0, 8).every((q) => {
    const x = q.buffer.getChannelData(0);
    let m = 0;
    for (const v of x) { if (!Number.isFinite(v)) return false; m = Math.max(m, Math.abs(v)); }
    return dicht(m, 0.92, 1e-6) && x[x.length - 1] === 0;
  }), 'elk geluid: piek 0,92, eindig, laatste sample precies 0');
  const tweede = DRUMS.maak(omg.ctx, { uit });
  await tweede.start();
  assert.ok(tweede.pads.slice(0, 8).every((q, i) => q.buffer.getChannelData(0).every((v, j) => v === d.pads[i].buffer.getChannelData(0)[j])), 'zelfde zaad, zelfde kit');
  assert.equal(KIT.map((k) => k.naam).join(' '), 'KICK SNARE CLAP HAT TOM RIM BAS HAT OPEN');
  const s = d.stand();
  assert.ok(s.pads.length === 16 && s.pads.every((q, i) => q.pad === i + 1 && q.noot === 36 + i) && s.params.length === 8);
  assert.ok(dicht(d.uit.gain.value, faderGain(0.8) * UIT_OPHOGING, 1e-12));
  const e = (k, v) => PARAMS[k - 1].eenheid(v);
  assert.ok(e(1, 0.5) === '0' && e(1, 1) === '+12 halve tonen' && e(2, 1) === 'vol' && e(2, 0) === '30 ms' && e(3, 1) === 'open' && e(3, 0) === '50 Hz');
  assert.ok(e(5, 0.5) === '48 Hz' && e(7, 0.5) === 'open 550 ms' && e(8, 0.8) === '0,0 dB' && e(8, 0) === 'stil');
});

test('Drums: elke noot valt op een pad, plannen op de audioklok, de keten', async () => {
  const { d, omg } = await maak();
  assert.ok(padVanNoot(36) === 1 && padVanNoot(51) === 16 && padVanNoot(52) === 1 && padVanNoot(35) === 16 && padVanNoot(0) === 13);
  for (let n = 0; n < 128; n++) { const p = padVanNoot(n); assert.ok(p >= 1 && p <= 16 && p === ((((n - 36) % 16) + 16) % 16) + 1); }
  omg.nu = 1;
  const voor = omg.bronnen.length;
  for (let n = 36; n <= 43; n++) d.noteOn(n, 0.8, 1 + (n - 36) * 0.5);
  assert.equal(omg.bronnen.length - voor, 8, 'noot 36..43: de kit');
  for (let n = 44; n <= 51; n++) d.noteOn(n, 0.8);
  assert.ok(omg.bronnen.length - voor === 8 && d.fouten === 0, '44..51 leeg: stil, geen fout');
  d.noteOn(NaN, 1); d.noteOn(36, 0); d.noteOn(36, -1);
  assert.ok(omg.bronnen.length - voor === 8 && d.fouten === 0);
  omg.nu = 10;
  d.noteOn(36, 0.8, 11.5);
  const st = d.stemmen.at(-1);
  assert.ok(st.src.gestart === 11.5 && st.g.gain.waarde(11.4999) === 0 && st.g.gain.waarde(11.5) > 0);
  assert.ok(st.filter.type === 'lowpass' && omg.heeft(st.src, st.filter) && omg.heeft(st.filter, st.g) && omg.heeft(st.g, st.pan) && omg.heeft(st.pan, d.uit));
  assert.ok(dicht(st.g.gain.waarde(12), Math.pow(0.8, 1.5) * Math.SQRT2), '0,8^1,5 × √2 (mono door de panner)');
  assert.ok(Math.abs(20 * Math.log10(snelheidGain(0.4) / snelheidGain(0.8)) + 9.03) < 0.01);
  d.noteOn(36, 0.8, 5);
  assert.equal(bron(omg).gestart, 10, 't in het verleden = nu');
});

test('Drums: choke tussen de hats, dezelfde pad opnieuw, zonder sprong', async () => {
  const { d, omg, ctx } = await maak();
  omg.nu = 1;
  d.noteOn(43, 0.8);                  // open hat
  const open = d.stemmen.at(-1);
  const nv = open.g.gain.waarde(1.1);
  d.noteOn(39, 0.8, 1.2);             // gesloten hat, gepland
  const go = open.g.gain;
  assert.ok(dicht(go.waarde(1.2), nv) && dicht(go.waarde(1.2 + KAP / 2), nv / 2) && go.waarde(1.2 + KAP) === 0);
  assert.ok(go.grootsteStap(1.19, 1.22) <= nv / (KAP * 48000) * 1.01, 'de helling, nergens een sprong');
  assert.deepEqual(go.sprongen(1.05), []);
  omg.nu = 2;
  d.noteOn(36, 0.8);
  const k1 = d.stemmen.at(-1);
  omg.nu = 2.1;
  const v = k1.g.gain.waarde(2.1);
  d.noteOn(36, 0.8);
  const kap = 2.1 + startDrempel(ctx);
  assert.ok(dicht(k1.g.gain.waarde(kap), v) && k1.g.gain.waarde(kap + KAP) === 0, 'dezelfde pad: de vorige kick in 6 ms naar 0');
  assert.equal(omg.stats.HOLD_ZONDER_PUNT, 0);
  assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
});

test('Drums: hooguit 12 stemmen (de oudste gaat), stil() met een helling, pads 9–16', async () => {
  const { d, omg, ctx } = await maak();
  const lang = ctx.createBuffer(2, 48000 * 4, 48000);
  for (let c = 0; c < 2; c++) lang.getChannelData(c).fill(0.5);
  for (let p = 9; p <= 16; p++) assert.ok(d.laadPad(p, lang, `stuk ${p}`));
  assert.ok(lang.getChannelData(0)[0] === 0.5 && d.pads[8].buffer !== lang && d.pads[8].buffer.getChannelData(0)[0] === 0, 'een kopie met fades');
  assert.ok(d.laadPad(3, lang) === false && d.laadPad(17, lang) === false && d.laadPad(11, null) === false);
  omg.nu = 1;
  for (let i = 0; i < 13; i++) d.noteOn(44 + (i % 8), 0.8, 1 + i * 0.01);
  // 8 pads × mono: elke pad kapt zijn vorige; 5 extra aanslagen op 44..48 kappen die af.
  omg.nu = 1.2;
  assert.ok(d.stand().klinkt <= MAX_STEMMEN);
  const veel = await maak();
  for (let p = 9; p <= 16; p++) veel.d.laadPad(p, lang);
  veel.omg.nu = 1;
  for (let i = 0; i < 8; i++) veel.d.noteOn(44 + i, 0.8);
  for (let i = 0; i < 5; i++) veel.d.noteOn(36 + [0, 1, 2, 4, 6][i], 0.8);   // kick snare clap tom bas
  veel.omg.nu = 1.001;
  assert.equal(veel.d._levend(veel.omg.nu).length, MAX_STEMMEN, 'nooit meer dan 12');
  assert.ok(veel.d.stemmen[0].weg, 'de oudste ging weg');
  // stil(): alles, ook wat gepland is, na de drempel in 12 ms naar 0.
  omg.nu = 2;
  d.noteOn(44, 0.8);
  const s1 = d.stemmen.at(-1);
  d.noteOn(37, 0.8, 2.6);
  const s3 = d.stemmen.at(-1);
  omg.nu = 2.3;
  d.stil();
  const ts = 2.3 + startDrempel(ctx);
  assert.ok(dicht(s1.g.gain.waarde(ts), s1.g.gain.waarde(2.3)) && s1.g.gain.waarde(ts + STIL) === 0);
  assert.ok(s3.g.gain.waarde(2.6) === 0 && s3.g.gain.waarde(2.7) === 0, 'de geplande snare klinkt nooit');
  assert.ok(d.wisPad(9) === true && d.wisPad(9) === false && !d.stand().pads[8].gevuld);
  assert.ok(schoneTijdlijn(omg) && schoneTijdlijn(veel.omg));
});

test('Drums: knoppen met een tijd — KICK per aanslag opnieuw gerekend, TOON en FILTER op hun tijd', async () => {
  const { d, omg } = await maak();
  const gemeld = [];
  d.on('param', (e) => gemeld.push(e));
  omg.nu = 1;
  const kick0 = d.pads[0].buffer;
  d.zetParam(5, 1, 2);                 // KICK +7 halve tonen, vanaf 2 s
  assert.ok(d.leesParam(5) === 0.5 && d.leesParam(5, 2) === 1 && gemeld[0].t === 2);
  d.noteOn(36, 0.8, 1.5);
  assert.equal(d.pads[0].buffer, kick0, 'een kick vóór 2 s: de oude kit');
  d.noteOn(36, 0.8, 2.5);
  assert.ok(d.pads[0].buffer !== kick0 && d.pads[0].met === 1, 'een kick na 2 s: opnieuw gerekend op de knop van dat moment');
  assert.ok(dicht(kickVerhouding(1), Math.pow(2, 7 / 12)));
  d.noteOn(36, 0.8, 1.8);
  assert.ok(d.pads[0].met === 0.5, 'en weer terug voor een kick vóór 2 s (een p-lock)');
  d.zetParam(1, 1, 3);                 // TOON +12 vanaf 3 s
  d.noteOn(36, 0.8, 3.5);
  assert.ok(dicht(d.stemmen.at(-1).src.playbackRate.value, 2), 'TOON: de rate van de aanslag na 3 s');
  d.zetParam(8, 0, 4);
  assert.ok(dicht(d.uit.gain.waarde(3.9), faderGain(0.8) * UIT_OPHOGING, 1e-9) && d.uit.gain.waarde(4.5) < 1e-6, 'NIVEAU op zijn tijd');
  assert.ok(schoneTijdlijn(omg));
  d.vernietig();
  d.noteOn(36, 1);
  assert.ok(d.dood && d.fouten === 0);
});
