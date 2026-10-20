// De mixer (src/audio/mixer.js) op de strenge Web Audio-mock: crossfader (A/B/thru,
// constant power), master, de limiter (compressor tot de worklet er is, dan klikvrij
// over), de meters (zonder afval) en vernietig ('stop' eerst).
// @alleen: afvalmeting (GCProfiler: de meters lezen zonder afval)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { NepOmgeving, installeer, NepAudioWorkletNode } from './web-audio-mock.mjs';

installeer();
const { maakMixer, xfaderGains, COMPRESSOR_VERTRAGING, LIMITER_FADE, MASTER_BEGIN } = await import('../src/audio/mixer.js');
const { maakStrip, faderGain, TAU } = await import('../src/audio/strip.js');
const { startDrempel } = await import('../src/audio/overgang.js');
const { MARGE_DB } = await import('../src/audio/limiter-kern.js');

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const SR = 48000;
const db = (g) => 20 * Math.log10(g);
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function schoon(omg) {
  assert.equal(omg.stats.CURVES, 0, 'nergens setValueCurveAtTime');
  assert.equal(omg.stats.CURVE_BREUK, 0, 'geen afgebroken curve');
  assert.equal(omg.stats.OVERLAP_FOUTEN, 0, 'geen NotSupportedError');
  assert.equal(omg.stats.RAMP_NA_DOEL, 0, 'geen helling direct na een doel');
  assert.equal(omg.stats.VERLEDEN, 0, 'niets in het verleden gepland');
}

function opzet({ limiter = false, ...opties } = {}) {
  const omg = new NepOmgeving(opties);
  const m = maakMixer(omg.ctx, { limiter });
  return { omg, ctx: omg.ctx, m };
}

// ---- crossfader en master ------------------------------------------------------------

test('bedrading zonder worklet: in -> compressor -> limiter-uitgang -> analyser -> ctx.destination', () => {
  const { omg, ctx, m } = opzet();
  assert.ok(omg.heeft(m.in, m.compressor) && omg.heeft(m.compressor, m._compUit) && omg.heeft(m._compUit, m.limiter));
  assert.ok(omg.heeft(m.limiter, m.analyser) && omg.heeft(m.analyser, ctx.destination));
  assert.ok(m.in.channelCount === 2 && m.in.channelCountMode === 'explicit', 'de master is stereo');
  const c = m.compressor;
  assert.ok(c.threshold.value === -1.5 && c.knee.value === 0 && c.ratio.value === 20 && c.attack.value === 0.002 && c.release.value === 0.1, 'de compressor van v1');
  assert.equal(m.soort, 'compressor');
  assert.equal(m.vertraging, COMPRESSOR_VERTRAGING);
});

test('beginstand: crossfader in het midden, master 0,8 (−9 dB, v1)', () => {
  const { m } = opzet();
  assert.equal(m.lees('xfader'), 0.5);
  assert.equal(m.lees('master'), MASTER_BEGIN);
  assert.ok(dicht(db(m.in.gain.value), -9));
});

test('master: 0..1 -> de fadercurve van v1, setTarget (20 ms) vanaf de vastgehouden waarde; 0 = stil', () => {
  const { omg, m } = opzet();
  omg.nu = 1;
  const p = m.in.gain;
  m.zet('master', 1);
  assert.deepEqual(p.oproepen.slice(-2), [['cancelAndHoldAtTime', 1], ['setTargetAtTime', 1, 1, TAU.master]]);
  assert.ok(dicht(p.waarde(1), faderGain(0.8), 1e-12) && dicht(p.waarde(1.5), 1, 1e-9));
  omg.nu = 2;
  m.zet('master', 0);
  assert.ok(p.waarde(3) < 1e-20, 'dicht = stil');
  assert.equal(m.lees('master'), 0);
  assert.deepEqual(p.sprongen(0.5), []);
  schoon(omg);
});

test('crossfader-curve (v1, smooth): 0 = alleen A, 1 = alleen B, a² + b² = 1 overal, midden −3 dB elk', () => {
  assert.deepEqual(xfaderGains(0), { a: 1, b: Math.cos(Math.PI / 2) });
  assert.ok(xfaderGains(0).b < 1e-15 && xfaderGains(1).a < 1e-15 && xfaderGains(1).b === 1);
  const { a, b } = xfaderGains(0.5);
  assert.ok(dicht(a, Math.SQRT1_2, 1e-15) && dicht(b, Math.SQRT1_2, 1e-15) && dicht(db(a), -3.0103, 1e-4));
  for (let i = 0; i <= 1000; i++) {
    const g = xfaderGains(i / 1000);
    assert.ok(dicht(g.a * g.a + g.b * g.b, 1, 1e-12), `constant power bij ${i / 1000}`);
    if (i) assert.ok(g.a <= xfaderGains((i - 1) / 1000).a, 'A gaat alleen dicht');
  }
  assert.deepEqual(xfaderGains(-1), xfaderGains(0));
  assert.deepEqual(xfaderGains(NaN), xfaderGains(0));
});

test('strips op A, B en thru: A en B volgen de crossfader (8 ms), thru niet; de kant wisselen glijdt', () => {
  const { omg, ctx, m } = opzet();
  const [A, B, T] = [maakStrip(ctx, m), maakStrip(ctx, m), maakStrip(ctx, m)];
  A.kant('A'); B.kant('B');
  omg.nu = 1;
  const nT = T.nodes.kant.gain.oproepen.length;
  m.zet('xfader', 0);
  const g = (st, t) => st.nodes.kant.gain.waarde(t);
  assert.ok(dicht(g(A, 1), Math.SQRT1_2) && dicht(g(B, 1), Math.SQRT1_2), 'op het moment van zetten nog het midden');
  assert.ok(dicht(g(A, 1.5), 1, 1e-9) && g(B, 1.5) < 1e-9, 'crossfader links: A open, B dicht');
  assert.deepEqual(A.nodes.kant.gain.oproepen.at(-1), ['setTargetAtTime', 1, 1, TAU.kant]);
  assert.equal(T.nodes.kant.gain.oproepen.length, nT, 'thru: geen enkele gebeurtenis');
  assert.ok(g(T, 1.5) === 1);
  omg.nu = 2;
  m.zet('xfader', 0.5);
  // Som van vermogen van A en B in het midden: 1, op elk moment van de overgang ongeveer.
  for (let t = 2; t < 2.1; t += 0.001) {
    const s = g(A, t) ** 2 + g(B, t) ** 2;
    assert.ok(s > 0.5 - 1e-9 && s <= 1 + 1e-9, `vermogen ${s.toFixed(3)} op ${t.toFixed(3)}`);
  }
  assert.ok(dicht(g(A, 2.5) ** 2 + g(B, 2.5) ** 2, 1, 1e-9), 'in het midden weer precies constant');
  // Kant wisselen: B -> thru glijdt van √½ naar 1.
  omg.nu = 3;
  B.kant('thru');
  assert.ok(dicht(g(B, 3), Math.SQRT1_2, 1e-9) && dicht(g(B, 3.5), 1, 1e-9));
  omg.nu = 4;
  B.kant('A');
  assert.ok(dicht(g(B, 4.5), Math.SQRT1_2, 1e-9));
  for (const st of [A, B, T]) assert.deepEqual(st.nodes.kant.gain.sprongen(0.5), []);
  assert.ok(m.kantGain('thru') === 1 && m.kantGain('onzin') === 0);
  schoon(omg);
});

test('zet en lees: grenzen', () => {
  const { omg, m } = opzet();
  assert.throws(() => m.zet('volume', 0.5), TypeError);
  assert.equal(m.zet('xfader', NaN), false);
  assert.equal(m.lees('xfader'), 0.5);
  assert.equal(m.zet('xfader', 7), true);
  assert.equal(m.lees('xfader'), 1);
  const n0 = m.in.gain.oproepen.length;
  m.zet('master', MASTER_BEGIN);
  assert.equal(m.in.gain.oproepen.length, n0, 'dezelfde stand: niets op de tijdlijn');
  schoon(omg);
});

// ---- de limiter ----------------------------------------------------------------------

test('limiter-worklet laadt op een stilstaande context: compressor eruit, worklet erin, zonder fade', async () => {
  const { omg, ctx, m } = opzet({ limiter: true, staat: 'suspended' });
  assert.equal(await m.klaar, true);
  const wl = omg.worklets.at(-1);
  assert.ok(omg.modules.at(-1).endsWith('/src/audio/limiter-worklet.js'));
  assert.ok(wl.naam === 'varve-limiter' && wl.opties.numberOfOutputs === 2 && wl.opties.outputChannelCount.join() === '2,1');
  const po = wl.opties.processorOptions;
  assert.ok(po.plafondDb === -1 && po.vooruit === 0.0015 && po.release === 0.08 && po.margeDb === MARGE_DB, 'plafond −1 dBTP, 1,5 ms, 80 ms');
  assert.ok(m.soort === 'worklet' && m.limiterNode === wl);
  assert.ok(omg.heeft(m.in, wl) && omg.heeft(wl, m._wl, 0) && omg.heeft(m._wl, m.limiter) && m._wl.gain.value === 1);
  assert.ok(!omg.heeft(m.in, m.compressor) && omg.uitVan(m.compressor).length === 0 && m._compUit === null, 'compressorpad los');
  assert.ok(omg.heeft(wl, m._gr, 1) && omg.uitVan(m._gr).length === 0, 'uitgang 1 (de gain) naar een tap');
  assert.ok(dicht(m.vertraging, 72 / SR, 1e-15), 'vertraging = de vooruitblik, 72 samples');
  assert.ok(omg.heeft(m.analyser, ctx.destination));
  schoon(omg);
});

test('limiter-worklet laadt terwijl de audio LOOPT: equal-power kruisfade van 40 ms na de startdrempel, het oude pad pas daarna los', async () => {
  const omg = new NepOmgeving({ staat: 'running' });
  let laat;
  omg.laad = () => new Promise((r) => { laat = r; });
  omg.nu = 10;
  const m = maakMixer(omg.ctx);
  assert.ok(m.soort === 'compressor' && omg.heeft(m.in, m.compressor), 'zolang hij laadt: de compressor');
  await wacht(5);
  omg.nu = 10.5;
  laat();
  assert.equal(await m.klaar, true);
  const comp = m._compUit.gain, nieuw = m._wl.gain, t0 = 10.5 + startDrempel(omg.ctx);
  assert.ok(comp.waarde(10.5) === 1 && nieuw.waarde(10.5) === 0 && comp.waarde(t0) === 1 && nieuw.waarde(t0) === 0);
  assert.ok(comp.waarde(t0 + LIMITER_FADE) === 0 && nieuw.waarde(t0 + LIMITER_FADE) === 1);
  for (let f = 0; f <= 1; f += 1 / 32) {
    const a = comp.waarde(t0 + f * LIMITER_FADE), b = nieuw.waarde(t0 + f * LIMITER_FADE);
    assert.ok(dicht(a * a + b * b, 1, 1e-9), `equal power op ${f}`);
  }
  assert.ok(comp.n.lin === 32 && nieuw.n.lin === 32, 'hellingen, geen curve');
  assert.ok(omg.heeft(m.in, m.compressor) && omg.heeft(m.in, m.limiterNode), 'tijdens de fade beide paden');
  await wacht(70);
  assert.ok(omg.heeft(m.in, m.compressor), 'de audioklok staat stil: het oude pad blijft');
  omg.nu = t0 + LIMITER_FADE + 0.02;
  await wacht(70);
  assert.ok(!omg.heeft(m.in, m.compressor) && omg.uitVan(m.compressor).length === 0 && m._compUit === null, 'daarna los');
  assert.deepEqual(comp.sprongen(10.4), []);
  assert.deepEqual(nieuw.sprongen(10.5), [], 'na het maken (de beginwaarde 0 staat er voor hij verbonden is)');
  schoon(omg);
});

test('laden mislukt: de compressor blijft, met de reden; zonder AudioWorkletNode: de compressor, zonder fout', async () => {
  const omg = new NepOmgeving();
  omg.laad = async () => { throw new Error('nep: geen netwerk'); };
  const m = maakMixer(omg.ctx);
  assert.equal(await m.klaar, false);
  assert.ok(m.soort === 'compressor' && /geen netwerk/.test(m.fout) && omg.heeft(m.in, m.compressor));
  assert.match(m.limiterStand().fout, /geen netwerk/);
  delete globalThis.AudioWorkletNode;
  const m2 = maakMixer(new NepOmgeving().ctx);
  assert.equal(await m2.klaar, false);
  assert.equal(m2.fout, null);
  installeer();
  assert.equal(globalThis.AudioWorkletNode, NepAudioWorkletNode);
});

test('de worklet gooit een fout: terug naar de compressor (ingevloeid vanaf 0), één melding op de context', async () => {
  const { omg, ctx, m } = opzet({ limiter: true, staat: 'suspended' });
  await m.klaar;
  omg.staat = 'running';
  const meldingen = [];
  ctx.addEventListener('varve-workletfout', (e) => meldingen.push(e.detail));
  const wl = m.limiterNode;
  omg.nu = 20;
  wl.onprocessorerror({ message: 'nep: kapot' });
  const g = m._compUit.gain, t0 = 20 + startDrempel(ctx);
  assert.ok(m.limiterNode === null && omg.uitVan(wl).length === 0 && !omg.heeft(m.in, wl) && wl.port.dicht, 'worklet los');
  assert.ok(omg.heeft(m.in, m.compressor) && omg.heeft(m.compressor, m._compUit) && omg.heeft(m._compUit, m.limiter));
  assert.ok(g.waarde(20) === 0 && g.waarde(t0) === 0 && g.waarde(t0 + LIMITER_FADE) === 1, `vloeit in in ${LIMITER_FADE * 1000} ms`);
  assert.ok(m.soort === 'compressor' && m.vertraging === COMPRESSOR_VERTRAGING && /vast/.test(m.fout) && /kapot/.test(m.fout));
  assert.equal(meldingen.length, 1);
  assert.ok(meldingen[0].wat === 'de master-limiter' && /kapot/.test(meldingen[0].reden));
  wl.onprocessorerror?.({});
  assert.equal(meldingen.length, 1, 'een tweede event van de oude node doet niets');
  // Op een stilstaande context: meteen op 1.
  const b = opzet({ limiter: true, staat: 'suspended' });
  await b.m.klaar;
  b.m.limiterNode.onprocessorerror({});
  assert.ok(b.m.soort === 'compressor' && b.m._compUit.gain.value === 1 && b.omg.heeft(b.m.in, b.m.compressor));
  schoon(omg);
});

test('een fout midden in de kruisfade: de compressor blijft en gaat vanaf waar hij is terug naar vol', async () => {
  const omg = new NepOmgeving({ staat: 'running' });
  omg.nu = 1;
  const m = maakMixer(omg.ctx);
  await m.klaar;
  const comp = m._compUit.gain, t0 = 1 + startDrempel(omg.ctx);
  omg.nu = t0 + LIMITER_FADE / 2;
  const hier = comp.waarde(omg.nu);
  m.limiterNode.onprocessorerror({ message: 'x' });
  assert.ok(dicht(comp.waarde(omg.nu), hier, 1e-12) && comp.waarde(omg.nu + 1) === 1, 'geen sprong, terug naar 1');
  omg.nu += 1;
  await wacht(70);
  assert.ok(omg.heeft(m.in, m.compressor), 'de geplande opruiming laat de compressor staan');
  assert.deepEqual(comp.sprongen(0.5), []);
  schoon(omg);
});

test('gain reduction: uit de worklet (laagste gain van 21 ms), of van de compressor; met een vloer', async () => {
  const { m } = opzet({ limiter: true, staat: 'suspended' });
  const c = opzet();
  c.m.compressor.reduction = -3.5;
  assert.equal(c.m.gr(), -3.5);
  await m.klaar;
  m._gr.signaal = 0.5;
  assert.ok(dicht(m.gr(), db(0.5), 1e-6));
  m._gr.signaal = 1;
  assert.equal(m.gr(), 0);
  m._gr.signaal = 0;
  assert.equal(m.gr(), 0, 'nog niets gerenderd (nullen) = 0 dB');
  m._gr.signaal = 1e-6;
  assert.equal(m.gr(), -40, 'vloer');
  const st = m.limiterStand();
  assert.ok(st.soort === 'worklet' && st.gr === -40 && st.plafond === -1 && st.vertraging === m.vertraging && st.fout === null);
});

// ---- meters ---------------------------------------------------------------------------

test('meterMaster: piek en rms na de limiter, per kanaal, altijd hetzelfde object', () => {
  const { omg, m } = opzet();
  const split = omg.uitVan(m.analyser).map((l) => l.naar).find((x) => x.soort === 'splitter');
  assert.ok(split, 'de meter tapt het eind van de master');
  const [aL, aR] = omg.uitVan(split).map((l) => l.naar);
  aL.signaal = Float32Array.from({ length: 2048 }, (_, i) => (i % 2 ? 0.2 : -0.2));
  aR.signaal = Float32Array.from({ length: 2048 }, (_, i) => (i === 7 ? 0.89 : 0));
  const r = m.meterMaster();
  assert.ok(dicht(r.piek, 0.89, 1e-6), 'piek = het luidste kanaal (rechts)');
  assert.ok(dicht(r.rms, 0.2, 1e-6), 'rms = het luidste kanaal (links)');
  assert.equal(m.meterMaster(), r);
});

test('meters lezen zonder afval: 20 000 keer strip en master, 0 GC', () => {
  const { omg, ctx, m } = opzet();
  const st = maakStrip(ctx, m);
  for (const a of omg.lijnen.filter((l) => l.naar.soort === 'analyser').map((l) => l.naar)) {
    a.signaal = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i / 7));
  }
  for (let i = 0; i < 3000; i++) { m.meter(st); m.meterMaster(); }
  const JONG = ['new_space', 'new_large_object_space'];
  const jong = () => v8.getHeapSpaceStatistics().reduce((n, s) => n + (JONG.includes(s.space_name) ? s.space_used_size : 0), 0);
  const venster = (n) => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const j0 = jong();
    // Niets optellen in de meetlus: een double in een lokale variabele van de test is zelf afval.
    for (let i = 0; i < n; i++) { m.meter(st); m.meterMaster(); }
    const j1 = jong();
    return { bytes: j1 - j0, gcs: prof.stop().statistics.length };
  };
  const leeg = venster(0).bytes;
  let beste = null;
  for (let i = 0; i < 20; i++) {
    const w = venster(10000);
    w.bytes -= leeg;
    if (!beste || w.gcs < beste.gcs || (w.gcs === beste.gcs && w.bytes < beste.bytes)) beste = w;
    if (w.gcs === 0 && w.bytes < 1024) break;
  }
  assert.ok(beste.gcs === 0 && beste.bytes < 1024, `${beste.gcs} GC, ${beste.bytes} bytes`);
});

// ---- vernietig ------------------------------------------------------------------------

test("vernietig: de master klikvrij dicht, dan de worklet eerst 'stop', daarna los en dicht", async () => {
  const { omg, ctx, m } = opzet({ limiter: true, staat: 'suspended' });
  await m.klaar;
  omg.staat = 'running';
  const wl = m.limiterNode;
  omg.nu = 5;
  const klaar = m.vernietig();
  const d = startDrempel(ctx);
  assert.ok(m.in.gain.waarde(5 + d + 0.005) === 0, 'de master in 5 ms dicht');
  assert.deepEqual(wl.port.berichten, [], 'nog niets: de fade loopt');
  omg.nu = 6;
  await wacht(70);
  await klaar;
  assert.deepEqual(wl.port.berichten, ['stop'], "'stop' kwam aan (vóór de poort dicht ging)");
  assert.ok(wl.port.dicht && omg.uitVan(wl).length === 0 && wl.onprocessorerror === null);
  for (const n of [m.in, m.limiter, m.analyser]) assert.equal(omg.uitVan(n).length, 0);
  assert.equal(m.zet('master', 0.3), false);
  assert.equal(m.vernietig(), klaar);
  assert.deepEqual(m.in.gain.sprongen(4), []);
  schoon(omg);
});

test('vernietig terwijl de worklet nog laadt: er komt geen worklet meer', async () => {
  const omg = new NepOmgeving({ staat: 'suspended' });
  let laat;
  omg.laad = () => new Promise((r) => { laat = r; });
  const m = maakMixer(omg.ctx);
  await m.vernietig();
  await wacht(1);
  laat();
  assert.equal(await m.klaar, false);
  assert.equal(omg.worklets.length, 0);
});
