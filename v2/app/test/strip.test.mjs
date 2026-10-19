// De kanaalstrip (src/audio/strip.js) op de strenge Web Audio-mock: bedrading,
// de formules van v1, en de TIJDLIJN van elke parameter na zet en kill (geen
// sprong, de juiste eindwaarde, nooit setValueCurveAtTime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NepOmgeving, installeer } from './web-audio-mock.mjs';

installeer();
const S = await import('../src/audio/strip.js');
const { maakStrip, eqDb, trimGain, faderGain, filterDoelen, filterOpen, EQ_KILL_DB, KILL_FADE, FILTER_TERUG, FILTER_MIDDEN, TAU, BANDEN } = S;
const { maakMixer } = await import('../src/audio/mixer.js');
const { startDrempel } = await import('../src/audio/overgang.js');

const SR = 48000;
const db = (g) => 20 * Math.log10(g);
const amp = (d) => Math.pow(10, d / 20);
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

function opzet(opties) {
  const omg = new NepOmgeving(opties);
  const m = maakMixer(omg.ctx, { limiter: false });
  const st = maakStrip(omg.ctx, m);
  return { omg, ctx: omg.ctx, m, st, n: st.nodes };
}

/** Geen enkele gemene overgang in de hele omgeving. */
function schoon(omg) {
  assert.equal(omg.stats.CURVES, 0, 'nergens setValueCurveAtTime');
  assert.equal(omg.stats.CURVE_BREUK, 0, 'geen afgebroken curve');
  assert.equal(omg.stats.OVERLAP_FOUTEN, 0, 'geen NotSupportedError');
  assert.equal(omg.stats.RAMP_NA_DOEL, 0, 'geen helling direct na een doel');
  assert.equal(omg.stats.VERLEDEN, 0, 'niets in het verleden gepland');
}

/** Alle parameters van de strip: vanaf `vanaf` zonder één sprong. */
function zonderSprongen(n, vanaf) {
  const params = [n.trim.gain, n.laag.gain, n.mid.gain, n.hoog.gain, n.hpf.frequency, n.hpf.Q, n.lpf.frequency, n.lpf.Q,
    n.droog.gain, n.nat.gain, n.fader.gain, n.kant.gain];
  for (const p of params) assert.deepEqual(p.sprongen(vanaf), [], `sprong op ${p.node.soort}`);
}

test('bedrading: in -> trim -> laag -> mid -> hoog -> (droog | hpf -> lpf -> nat) -> naFilter -> fader -> kant -> mixer', () => {
  const { omg, m, st, n } = opzet();
  const keten = [[n.in, n.trim], [n.trim, n.laag], [n.laag, n.mid], [n.mid, n.hoog], [n.hoog, n.droog], [n.hoog, n.hpf],
    [n.hpf, n.lpf], [n.lpf, n.nat], [n.droog, n.naFilter], [n.nat, n.naFilter], [n.naFilter, n.fader], [n.fader, n.kant], [n.kant, m.in]];
  for (const [a, b] of keten) assert.ok(omg.heeft(a, b), `${a.soort} -> ${b.soort}`);
  assert.equal(st.in, n.in);
  assert.equal(omg.uitVan(n.kant).length, 1, 'de strip gaat alleen naar de mixer');
  assert.ok(n.in.channelCount === 2 && n.in.channelCountMode === 'explicit' && n.in.channelInterpretation === 'speakers', 'ingang altijd stereo');
  // De banden en filters zoals v1.
  assert.ok(n.laag.type === 'lowshelf' && n.laag.frequency.value === 200);
  assert.ok(n.mid.type === 'peaking' && n.mid.frequency.value === 1000 && n.mid.Q.value === 0.9);
  assert.ok(n.hoog.type === 'highshelf' && n.hoog.frequency.value === 4000);
  assert.ok(n.hpf.type === 'highpass' && n.lpf.type === 'lowpass');
  // De meter tapt vóór de fader: naFilter -> splitter -> twee analysers.
  const split = omg.uitVan(n.naFilter).map((l) => l.naar).find((x) => x.soort === 'splitter');
  assert.ok(split, 'meter-tap op naFilter');
  assert.deepEqual(omg.uitVan(split).map((l) => [l.naar.soort, l.uit]), [['analyser', 0], ['analyser', 1]]);
});

test('beginstand: alles in het midden, fader open, thru; trim precies 1, filter droog precies 1 en nat precies 0', () => {
  const { omg, st, n } = opzet();
  for (const k of ['trim', 'laag', 'mid', 'hoog', 'filter']) assert.equal(st.lees(k), 0.5);
  assert.equal(st.lees('fader'), 1);
  assert.equal(st.kant(), 'thru');
  for (const b of BANDEN) assert.equal(st.lees(`kill.${b}`), 0);
  assert.ok(n.trim.gain.value === 1 && n.fader.gain.value === 1 && n.kant.gain.value === 1);
  for (const b of BANDEN) assert.ok(n[b].gain.value === 0, `${b} op 0 dB`);
  assert.ok(n.droog.gain.value === 1 && n.nat.gain.value === 0, 'het filter klinkt bit voor bit door');
  assert.ok(n.hpf.frequency.value === 20 && n.hpf.Q.value === 0.7 && n.lpf.frequency.value === 22050 && n.lpf.Q.value === 0.7);
  schoon(omg);
});

test('trim: 0..1 -> −12..+12 dB, 0,5 = precies 0 dB', () => {
  assert.ok(trimGain(0.5) === 1, '0,5 = gain 1, bit voor bit');
  assert.ok(dicht(db(trimGain(0)), -12) && dicht(db(trimGain(1)), 12) && dicht(db(trimGain(0.75)), 6) && dicht(db(trimGain(0.25)), -6));
  assert.ok(dicht(db(trimGain(-3)), -12) && dicht(db(trimGain(9)), 12), 'geklemd');
});

test('trim: tijdlijn vanaf de vastgehouden waarde, eindwaarde +12 dB, geen sprong', () => {
  const { omg, st, n } = opzet();
  omg.nu = 1;
  const p = n.trim.gain;
  assert.equal(st.zet('trim', 1), true);
  assert.deepEqual(p.oproepen.slice(-2), [['cancelAndHoldAtTime', 1], ['setTargetAtTime', amp(12), 1, TAU.trim]]);
  assert.ok(p.waarde(1) === 1, 'op het moment van zetten nog waar hij was');
  assert.ok(dicht(db(p.waarde(1.2)), 12, 1e-6), `na 0,2 s +12 dB (${db(p.waarde(1.2))})`);
  // Halverwege terugdraaien: vanaf waar hij dan is, niet vanaf het eindpunt.
  omg.nu = 1.005;
  const nu = p.waarde(1.005);
  st.zet('trim', 0);
  assert.ok(dicht(p.waarde(1.005), nu, 1e-12), 'omkeren midden in de overgang: geen sprong');
  assert.ok(dicht(db(p.waarde(1.5)), -12, 1e-6));
  assert.ok(p.grootsteStap(0.99, 1.1) <= (amp(12) - amp(-12)) / (TAU.trim * SR) * 1.01, 'per sample niet meer dan een setTarget van 10 ms');
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('EQ: de curve van v1 (kill onder 3%, −30 dB .. 0 dB in het midden .. +8 dB)', () => {
  assert.ok(eqDb(0) === EQ_KILL_DB && eqDb(0.0299) === EQ_KILL_DB, 'onderste 3% = kill (−70 dB)');
  assert.ok(dicht(eqDb(0.03), -28.2) && dicht(eqDb(0.25), -15) && eqDb(0.5) === 0 && dicht(eqDb(0.75), 4) && eqDb(1) === 8);
  assert.ok(eqDb(NaN) === EQ_KILL_DB && eqDb(Infinity) === 8, 'zoals clamp in kern/emitter.js');
});

test('EQ: zet = doel vanaf vastgehouden waarde, eindwaarde in dB; voor elke band', () => {
  const { omg, st, n } = opzet();
  omg.nu = 2;
  for (const [b, v] of [['laag', 1], ['mid', 0.25], ['hoog', 0.04]]) {
    st.zet(b, v);
    const p = n[b].gain;
    assert.ok(p.waarde(2) === 0, `${b}: op het moment van zetten nog 0 dB`);
    assert.ok(dicht(p.waarde(2.2), eqDb(v), 1e-6), `${b}: eindwaarde ${eqDb(v)} dB`);
    assert.equal(st.lees(b), v);
  }
  zonderSprongen(n, 1);
  schoon(omg);
});

test('kill: −70 dB in 5 ms langs een zachte S in amplitude, na startDrempel; uit = precies de knopstand', () => {
  const { omg, ctx, st, n } = opzet();
  omg.nu = 3;
  st.zet('laag', 0.75);                       // +4 dB
  omg.nu = 4;
  const p = n.laag.gain, d = startDrempel(ctx), t0 = 4 + d;
  assert.equal(st.kill('laag', true), true);
  assert.equal(st.lees('kill.laag'), 1);
  assert.ok(dicht(p.waarde(4), 4, 1e-9) && dicht(p.waarde(t0), 4, 1e-9), 'tot de startdrempel blijft hij staan');
  assert.ok(p.waarde(t0 + KILL_FADE) === EQ_KILL_DB, 'na 5 ms precies −70 dB');
  assert.ok(p.waarde(t0 + 1) === EQ_KILL_DB, 'en daar blijft hij');
  // De vorm in amplitude: monotoon, en nergens steiler dan de S (π/2 × hoogte / duur).
  const a = p.bemonster(t0, t0 + KILL_FADE, SR, amp);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] <= a[i - 1] + 1e-12, 'alleen omlaag');
  const steilst = Math.PI / 2 * (amp(4) - amp(EQ_KILL_DB)) / (KILL_FADE * SR);
  // ×1,1: tussen de punten is de helling lineair in dB, in amplitude dus iets bol (gemeten +4% in het midden).
  assert.ok(p.grootsteStap(t0, t0 + KILL_FADE, amp) <= steilst * 1.1, 'geen tik: nergens steiler dan de S');
  assert.ok(dicht(amp(p.waarde(t0 + KILL_FADE / 2)), (amp(4) + amp(EQ_KILL_DB)) / 2, 1e-9), 'halverwege precies de helft van de amplitude');
  assert.equal(p.n.lin, 32, '32 lineaire hellingen');
  // Uit: terug naar precies de knopstand.
  omg.nu = 5;
  st.kill('laag', false);
  assert.ok(p.waarde(5) === EQ_KILL_DB);
  assert.ok(p.waarde(5 + d + KILL_FADE) === eqDb(0.75), 'kill uit = precies terug naar de knopstand');
  zonderSprongen(n, 2);
  schoon(omg);
});

test('kill: de knop draaien terwijl gekild onthoudt de knop; kill uit gaat naar de NIEUWE stand', () => {
  const { omg, ctx, st, n } = opzet();
  const p = n.hoog.gain, d = startDrempel(ctx);
  omg.nu = 1;
  st.kill('hoog', true);
  const voor = p.oproepen.length;
  omg.nu = 1.002;                             // midden in de kill-S
  st.zet('hoog', 1);
  assert.equal(p.oproepen.length, voor, 'de lopende kill wordt niet onderbroken');
  assert.equal(st.lees('hoog'), 1);
  assert.ok(p.waarde(1 + d + KILL_FADE) === EQ_KILL_DB, 'blijft weg');
  omg.nu = 2;
  st.kill('hoog', false);
  assert.ok(p.waarde(2 + d + KILL_FADE) === 8, 'terug naar +8 dB, de knop van nu');
  // Twee keer hetzelfde: niets nieuws op de tijdlijn.
  const n0 = p.oproepen.length;
  st.kill('hoog', false);
  assert.equal(p.oproepen.length, n0);
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('kill aan en 2 ms later weer uit, en een knopdraai in de overgang: geen sprong, geen breuk', () => {
  const { omg, ctx, st, n } = opzet();
  const p = n.mid.gain, d = startDrempel(ctx);
  omg.nu = 1;
  st.kill('mid', true);
  omg.nu = 1 + d + 0.002;                     // de S loopt
  const hier = p.waarde(omg.nu);
  assert.ok(hier < 0 && hier > EQ_KILL_DB, 'midden in de overgang');
  st.kill('mid', false);
  assert.ok(dicht(p.waarde(omg.nu), hier, 1e-9), 'terug vanaf waar hij was');
  assert.ok(p.waarde(omg.nu + d + KILL_FADE) === 0, 'en precies op 0 dB');
  omg.nu += d + 0.002;                        // weer midden in een S
  const hier2 = p.waarde(omg.nu);
  st.zet('mid', 0.25);
  assert.ok(dicht(p.waarde(omg.nu), hier2, 1e-9), 'knopdraai midden in de S: vanaf daar');
  assert.ok(dicht(p.waarde(omg.nu + 0.3), -15, 1e-6));
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('filter: de curve van v1, met een dode zone van ±0,004 rond het midden', () => {
  assert.deepEqual(filterDoelen(0.5), [20, 0.7, 22050, 0.7]);
  assert.ok(filterOpen(0.5 + FILTER_MIDDEN) && filterOpen(0.5 - FILTER_MIDDEN) && filterOpen(63 / 127) && filterOpen(64 / 127));
  assert.ok(!filterOpen(0.505) && !filterOpen(0.495));
  const [hf0, hq0, lf0, lq0] = filterDoelen(0);
  assert.ok(hf0 === 20 && hq0 === 0.7 && dicht(lf0, 250) && dicht(lq0, 6.7), 'helemaal links: lowpass 250 Hz, Q 6,7 dB (zoals v1)');
  const [hf1, hq1, lf1, lq1] = filterDoelen(1);
  assert.ok(dicht(hf1, 9000) && dicht(hq1, 6.7) && lf1 === 22050 && lq1 === 0.7, 'helemaal rechts: highpass 9 kHz');
  assert.ok(dicht(filterDoelen(0.25)[2], Math.sqrt(250 * 22050)), 'exponentieel: een kwart = het meetkundig midden');
  assert.ok(dicht(filterDoelen(0.75)[0], Math.sqrt(20 * 9000)));
});

test('filter in de dode zone: geen enkele gebeurtenis, droog blijft precies 1 en nat precies 0', () => {
  const { omg, st, n } = opzet();
  omg.nu = 1;
  const params = [n.droog.gain, n.nat.gain, n.hpf.frequency, n.lpf.frequency, n.hpf.Q, n.lpf.Q];
  const voor = params.map((p) => p.oproepen.length);
  for (const v of [0.504, 63 / 127, 64 / 127, 0.4961, 0.496]) assert.equal(st.zet('filter', v), true);
  assert.deepEqual(params.map((p) => p.oproepen.length), voor, 'niets nieuws op de tijdlijn');
  assert.ok(n.droog.gain.waarde(10) === 1 && n.nat.gain.waarde(10) === 0);
  schoon(omg);
});

test('filter uit het midden: droog 1 -> 0 en nat 0 -> 1 langs dezelfde S in 5 ms, samen altijd 1; filters naar hun doel', () => {
  const { omg, ctx, st, n } = opzet();
  const d = startDrempel(ctx);
  omg.nu = 1;
  st.zet('filter', 0.2);
  const t0 = 1 + d;
  const dr = n.droog.gain.bemonster(1, t0 + KILL_FADE + 0.001), na = n.nat.gain.bemonster(1, t0 + KILL_FADE + 0.001);
  for (let i = 0; i < dr.length; i++) assert.ok(dicht(dr[i] + na[i], 1, 1e-12), 'droog + nat = 1');
  assert.ok(n.droog.gain.waarde(1) === 1 && n.nat.gain.waarde(t0) === 0, 'begint pas na de startdrempel');
  assert.ok(n.droog.gain.waarde(t0 + KILL_FADE) === 0 && n.nat.gain.waarde(t0 + KILL_FADE) === 1, 'na 5 ms helemaal nat');
  const [hf, hq, lf, lq] = filterDoelen(0.2);
  assert.ok(dicht(n.lpf.frequency.waarde(2), lf, 1e-6) && dicht(n.lpf.Q.waarde(2), lq, 1e-9));
  assert.ok(dicht(n.hpf.frequency.waarde(2), hf, 1e-9) && dicht(n.hpf.Q.waarde(2), hq, 1e-9));
  assert.ok(n.lpf.frequency.waarde(1) === 22050, 'de frequentie begint bij open');
  // Naar de andere kant (zonder het midden te raken): alleen de filters, de mix blijft nat.
  omg.nu = 2;
  const n0 = n.nat.gain.oproepen.length;
  st.zet('filter', 0.9);
  assert.equal(n.nat.gain.oproepen.length, n0, 'van lowpass naar highpass: nat blijft');
  assert.ok(dicht(n.hpf.frequency.waarde(3), filterDoelen(0.9)[0], 1e-6) && dicht(n.lpf.frequency.waarde(3), 22050, 1e-6));
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('filter terug naar het midden: de filters glijden eerst open, pas na FILTER_TERUG weer droog (geen plof van de bas)', () => {
  const { omg, ctx, st, n } = opzet();
  const d = startDrempel(ctx);
  omg.nu = 1;
  st.zet('filter', 1);                        // highpass 9 kHz
  omg.nu = 2;
  st.zet('filter', 0.5);
  assert.ok(dicht(n.hpf.frequency.waarde(2 + 0.5), 20, 1e-6) && dicht(n.hpf.Q.waarde(2.5), 0.7, 1e-9), 'de filters gaan naar open');
  const t0 = 2 + d + FILTER_TERUG;
  assert.ok(n.nat.gain.waarde(t0) === 1 && n.droog.gain.waarde(t0) === 0, 'tot FILTER_TERUG blijft het nat');
  assert.ok(n.hpf.frequency.waarde(t0) < 20 + 8980 * Math.exp(-4.9), `de highpass is dan bijna open (${n.hpf.frequency.waarde(t0).toFixed(0)} Hz)`);
  assert.ok(n.nat.gain.waarde(t0 + KILL_FADE) === 0 && n.droog.gain.waarde(t0 + KILL_FADE) === 1, 'daarna precies droog: bit voor bit door');
  // Binnen die wachttijd weer weg uit het midden: de terugweg vervalt, geen sprong.
  omg.nu = 3;
  st.zet('filter', 0.9);
  omg.nu = 3.5;
  st.zet('filter', 0.5);
  omg.nu = 3.52;                              // nog in de wacht
  st.zet('filter', 0.1);
  assert.ok(n.nat.gain.waarde(5) === 1 && n.droog.gain.waarde(5) === 0, 'weer nat');
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('fader: de curve van v1, maar 0 is echt stil', () => {
  assert.ok(faderGain(0) === 0 && faderGain(0.001) === 0 && faderGain(-1) === 0, '0 = stil');
  assert.ok(faderGain(1) === 1 && dicht(db(faderGain(0.5)), -22.5) && dicht(db(faderGain(0.8)), -9));
  const { omg, st, n } = opzet();
  omg.nu = 1;
  st.zet('fader', 0);
  assert.ok(n.fader.gain.waarde(1) === 1 && n.fader.gain.waarde(1.5) < 1e-20, 'glijdt naar 0 (τ 8 ms)');
  assert.deepEqual(n.fader.gain.oproepen.at(-1), ['setTargetAtTime', 0, 1, TAU.fader]);
  assert.ok(n.fader.gain.grootsteStap(0.99, 1.1) <= 1 / (TAU.fader * SR) * 1.01);
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('zet, kill, kant, lees: grenzen', () => {
  const { omg, st, n } = opzet();
  assert.throws(() => st.zet('onzin', 0.3), TypeError);
  assert.throws(() => st.kill('bas', true), TypeError);
  assert.equal(st.zet('fader', NaN), false, 'NaN wordt genegeerd (een kapotte mapping killt niets)');
  assert.equal(st.zet('laag', '0.3'), false);
  assert.equal(st.lees('fader'), 1);
  assert.equal(st.zet('trim', Infinity), true);
  assert.equal(st.lees('trim'), 1, '±Infinity geklemd');
  assert.equal(st.zet('trim', -2), true);
  assert.equal(st.lees('trim'), 0);
  assert.equal(st.lees('onzin'), undefined);
  assert.equal(st.kant('C'), false);
  assert.equal(st.kant(), 'thru');
  assert.equal(st.kant('A'), true);
  assert.equal(st.kant(), 'A');
  // Dezelfde waarde nog eens: niets nieuws op de tijdlijn.
  const n0 = n.trim.gain.oproepen.length;
  st.zet('trim', 0);
  assert.equal(n.trim.gain.oproepen.length, n0);
  schoon(omg);
});

test('meter vóór de fader: piek en rms per kanaal (de luidste), ook met de fader dicht', () => {
  const { omg, m, st, n } = opzet();
  const split = omg.uitVan(n.naFilter).map((l) => l.naar).find((x) => x.soort === 'splitter');
  const [aL, aR] = omg.uitVan(split).map((l) => l.naar);
  const sinus = (A, per = 64) => Float32Array.from({ length: 2048 }, (_, i) => A * Math.sin(2 * Math.PI * i / per));
  aL.signaal = sinus(0.5);
  aR.signaal = sinus(-0.25);
  st.zet('fader', 0);
  const r = m.meter(st);
  assert.ok(dicht(r.piek, 0.5, 1e-6), `piek = links (${r.piek})`);
  assert.ok(dicht(r.rms, 0.5 / Math.SQRT2, 1e-6), `rms = links (${r.rms})`);
  // Tegenfase: een mono-mix zou 0 lezen, per kanaal niet.
  aR.signaal = sinus(-0.5);
  assert.ok(dicht(m.meter(st).piek, 0.5, 1e-6));
  assert.equal(m.meter(st), r, 'altijd hetzelfde object (geen afval)');
  aL.signaal = 0; aR.signaal = 0;
  assert.ok(m.meter(st).piek === 0 && m.meter(st).rms === 0, 'stilte');
});

test('vernietig: de uitgang klikvrij dicht, pas daarna alles los; uit de mixer; niets meer te zetten', async () => {
  const { omg, ctx, m, st, n } = opzet();
  st.kant('A');
  omg.nu = 1;
  const d = startDrempel(ctx);
  const klaar = st.vernietig();
  assert.equal(st.vernietig(), klaar, 'twee keer = dezelfde');
  assert.ok(n.kant.gain.waarde(1) > 0.5 && n.kant.gain.waarde(1 + d + KILL_FADE) === 0, 'de uitgang in 5 ms dicht');
  assert.ok(omg.heeft(n.kant, m.in), 'tijdens de fade nog verbonden');
  const n0 = n.kant.gain.oproepen.length;
  m.zet('xfader', 1);
  assert.equal(n.kant.gain.oproepen.length, n0, 'de crossfader raakt hem niet meer');
  assert.equal(st.zet('fader', 0.3), false);
  assert.equal(st.kill('laag', true), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(omg.heeft(n.kant, m.in), 'de audioklok staat stil: nog niet los');
  omg.nu = 1 + d + KILL_FADE + 0.006;
  await new Promise((r) => setTimeout(r, 70));   // de timer kijkt hooguit elke 50 ms
  await klaar;
  for (const node of Object.values(n)) assert.equal(omg.uitVan(node).length, 0, `${node.soort} los`);
  assert.equal(omg.lijnen.filter((l) => l.van.soort === 'splitter' && omg.naar(l.van).some((x) => x.van === n.naFilter)).length, 0, 'meter los');
  zonderSprongen(n, 0.5);
  schoon(omg);
});

test('vernietig op een stilstaande context: meteen los (er klinkt niets dat kan tikken)', async () => {
  const { omg, st, n } = opzet({ staat: 'suspended' });
  await st.vernietig();
  for (const node of Object.values(n)) assert.equal(omg.uitVan(node).length, 0);
  assert.equal(n.kant.gain.oproepen.length, 1, 'geen fade nodig');
});

test('willekeurige bediening (2000 handelingen op 2 s): nergens een sprong, nooit een curve, alles eindigt waar de knop staat', () => {
  const { omg, ctx, st, n } = opzet();
  let zaad = 20261019;
  const rnd = () => ((zaad = (Math.imul(zaad, 1103515245) + 12345) >>> 0) / 4294967296);
  const knoppen = ['trim', 'laag', 'mid', 'hoog', 'filter', 'fader'];
  omg.nu = 1;
  for (let i = 0; i < 2000; i++) {
    omg.nu += rnd() * 0.002;                  // gemiddeld elke ms iets, ook midden in elke overgang
    const r = rnd();
    if (r < 0.6) st.zet(knoppen[Math.floor(rnd() * 6)], rnd() < 0.15 ? 0.5 : rnd());
    else if (r < 0.9) st.kill(BANDEN[Math.floor(rnd() * 3)], rnd() < 0.5);
    else st.kant(['A', 'B', 'thru'][Math.floor(rnd() * 3)]);
  }
  zonderSprongen(n, 0.5);
  schoon(omg);
  // Na het laatste: elke parameter komt waar de stand zegt.
  const t = omg.nu + 1;
  assert.ok(dicht(n.trim.gain.waarde(t), trimGain(st.lees('trim')), 1e-6));
  assert.ok(dicht(n.fader.gain.waarde(t), faderGain(st.lees('fader')), 1e-6));
  for (const b of BANDEN) {
    const verwacht = st.lees(`kill.${b}`) ? EQ_KILL_DB : eqDb(st.lees(b));
    assert.ok(dicht(n[b].gain.waarde(t), verwacht, 1e-5), `${b}: ${n[b].gain.waarde(t)} ≠ ${verwacht}`);
  }
  const open = filterOpen(st.lees('filter'));
  assert.ok(n.droog.gain.waarde(t) === (open ? 1 : 0) && n.nat.gain.waarde(t) === (open ? 0 : 1), 'droog/nat volgt de dode zone');
  const [hf, , lf] = filterDoelen(st.lees('filter'));
  assert.ok(dicht(n.hpf.frequency.waarde(t), hf, 1e-3) && dicht(n.lpf.frequency.waarde(t), lf, 1e-3));
  assert.ok(startDrempel(ctx) > 0);
});

test('de mock zelf is streng: hij vangt een sprong, een overlappende curve, een breuk en een losse disconnect', () => {
  const omg = new NepOmgeving();
  const g = omg.ctx.createGain();
  omg.nu = 1;
  g.gain.setTargetAtTime(0.5, 1, 0.01);
  assert.ok(dicht(g.gain.waarde(1.01), 0.5 + 0.5 * Math.exp(-1), 1e-12), 'setTargetAtTime rekent als Chrome');
  g.gain.setValueAtTime(0.9, 1.5);
  assert.equal(g.gain.sprongen(0).length, 1, 'een setValueAtTime naast de waarde = een sprong');
  g.gain.setValueCurveAtTime([0, 1], 2, 0.1);
  assert.throws(() => g.gain.setValueCurveAtTime([1, 0], 2.05, 0.1), { name: 'NotSupportedError' });
  assert.throws(() => g.gain.setTargetAtTime(0, 2.05, 0.01), { name: 'NotSupportedError' });
  g.gain.cancelAndHoldAtTime(2.05);
  assert.equal(omg.stats.CURVE_BREUK, 1, 'vasthouden midden in een curve telt als breuk');
  assert.throws(() => g.gain.setTargetAtTime(NaN, 3, 0.01), TypeError);
  assert.throws(() => g.gain.setTargetAtTime(0, 3, -1), RangeError);
  assert.throws(() => g.disconnect(omg.ctx.destination), { name: 'InvalidAccessError' });
  assert.throws(() => omg.ctx.createChannelSplitter(2).connect(g, 2), { name: 'IndexSizeError' });
  assert.throws(() => { omg.ctx.createBiquadFilter().type = 'lowshelve'; }, TypeError);
  g.gain.linearRampToValueAtTime(0.3, 4);
  g.gain.setTargetAtTime(0.1, 4, 0.01);
  g.gain.linearRampToValueAtTime(0.2, 5);
  assert.equal(omg.stats.RAMP_NA_DOEL, 1, 'een helling direct na een doel wordt geteld');
});
