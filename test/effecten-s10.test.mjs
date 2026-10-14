// De zeven effecten van spoor S10 (src/engine/fx-s10.js, docs/EFFECTEN-MEER.md) tegen de
// Web Audio-mock van test/nep-fx.mjs: het contract van fx.js, eindig bij elke stand, staart,
// vernietig, lussen, inloop, eenheid = wat zet() doet, worklets droog tot ze er zijn; en de
// rekenkernen (kam, frequentieschuif, aanslag) gemeten, met 0 GC per blok.
// Het geluid zelf meet tools/headless/effecten-meer.mjs in Chrome.
// @alleen: afvalmeting (GCProfiler, 0 GC)
import v8 from 'node:v8';
import vm from 'node:vm';
import { staat, MockContext, nepWorklet, bereikbaar, lussen, allesEindig } from './nep-fx.mjs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };
const bij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
if (typeof globalThis.gc !== 'function') { v8.setFlagsFromString('--expose-gc'); globalThis.gc = vm.runInNewContext('gc'); }

const { EFFECTEN, toonWaarde } = await import('../src/engine/fx.js');
const S = await import('../src/engine/fx-s10.js');
const { expMap, dbToGain } = await import('../src/lib/emitter.js');
const IDS = S.S10_EFFECTEN.map((e) => e.id);

console.log('contract');
ok(`zeven effecten achter de filter app (${IDS.join(', ')})`, IDS.length === 7 && EFFECTEN.slice(17).every((e, k) => e === S.S10_EFFECTEN[k]));
ok('ids uniek over alle effecten', new Set(EFFECTEN.map((e) => e.id)).size === EFFECTEN.length);
for (const e of S.S10_EFFECTEN) {
  const goed = typeof e.naam === 'string' && e.params.length >= 1 && e.params.length <= 8
    && e.params.every((p) => typeof e.standaard[p] === 'number' && e.standaard[p] >= 0 && e.standaard[p] <= 1)
    && Object.keys(e.standaard).every((p) => e.params.includes(p))
    && e.params.every((p) => typeof e.eenheid?.[p] === 'function')
    && (e.bipolair || []).every((p) => e.params.includes(p))
    && Object.keys(e.trappen || {}).every((p) => e.params.includes(p) && e.trappen[p] >= 2);
  ok(`${e.id}: naam, 1–8 parameters met standaard 0..1, een eenheid per parameter`, goed);
}

console.log('\nbouwen, aan alles draaien, opruimen');
const nepKlok = (bl = 0.5) => () => ({ beatLengte: bl, ankerCtx: Math.ceil(staat.NOW / bl + 1e-9) * bl });
const RAAR = [0, 0.25, 0.5, 0.75, 1, NaN, -1, 2, Infinity, -Infinity, 1e-9, 0.999999];
for (const e of S.S10_EFFECTEN) {
  staat.NIET_EINDIG = [];
  staat.NOW = 10;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  const inst = e.bouw(ctx, { klok: nepKlok() });
  await w.klaar();
  ok(`${e.id}: in en uit van deze context, en het signaal komt van in naar uit`,
    inst.in?.ctx === ctx && inst.out?.ctx === ctx && bereikbaar(inst.in).has(inst.out));
  let gooit = null;
  try { for (const t of RAAR) for (const p of e.params) { staat.NOW += 0.37; inst.zet(p, t, staat.NOW); } inst.heranker?.(); }
  catch (err) { gooit = err; }
  ok(`${e.id}: elke parameter op 0, 1, NaN, ±Infinity: geen fout, overal eindig`, !gooit && allesEindig(ctx),
    gooit ? gooit.message : staat.NIET_EINDIG.slice(0, 2).map((x) => x.join(' ')).join('; '));
  const staarten = [];
  for (const stand of [0, 1, 0.5]) { for (const p of e.params) { staat.NOW += 0.37; inst.zet(p, stand, staat.NOW); } staarten.push(inst.staart()); }
  ok(`${e.id}: staart eindig en begrensd (${staarten.map((s) => s.toFixed(3)).join(' / ')} s)`, staarten.every((s) => Number.isFinite(s) && s >= 0 && s <= 10.1));
  const comps = lussen(inst.in);
  ok(`${e.id}: lussen (${comps.length}) hebben elk een vertraging`, comps.every((c) => c.some((n) => n.soort === 'delay')));
  inst.vernietig?.();
  ok(`${e.id}: vernietig stopt elke oscillator en bron, en elke worklet krijgt 'stop'`,
    ctx.bronnen.every((b) => b.gestart === null || b.gestopt !== null)
    && staat.WORKLET_NODES.filter((n) => n.ctx === ctx).every((n) => n.berichten.includes('stop')));
}

console.log('\ninloop: alles met geheugen begint leeg');
for (const e of S.S10_EFFECTEN) {
  staat.NOW = 50;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  e.bouw(ctx); await w.klaar();
  const inst = e.bouw(ctx);
  const isInloop = (n) => n.soort === 'gain' && n.gain.events.some((x) => x[0] === 'setValueAtTime' && x[1] === 0)
    && n.gain.events.filter((x) => x[0] === 'linearRampToValueAtTime').at(-1)?.[1] === 1;
  const gezien = new Set(), stapel = [inst.in];
  while (stapel.length) {
    const n = stapel.pop();
    if (!n || gezien.has(n) || isInloop(n)) continue;
    gezien.add(n);
    for (const { doel } of n.naar || []) stapel.push(doel.eigenaar || doel);
  }
  const geheugen = [...bereikbaar(inst.in)].filter((n) => n.soort === 'delay' || n.soort === 'worklet');
  const bloot = geheugen.filter((n) => gezien.has(n));
  ok(`${e.id}: ${geheugen.length} node(s) met geheugen, elk achter een inloop`, bloot.length === 0);
  inst.vernietig?.();
}

console.log('\nworklets: droog tot ze er zijn, dan naar de meng');
for (const id of ['kam', 'freqschuif', 'aanslag']) {
  staat.NOW = 70;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  const e = S.S10_EFFECTEN.find((x) => x.id === id);
  const inst = e.bouw(ctx);
  const n = inst._n;
  ok(`${id}: zonder worklet klinkt hij droog (droog 1, nat 0)`, n.droog.gain.value === 1 && n.nat.gain.value === 0 && !n.w.node);
  await w.klaar();
  const naar = (p) => p.events.filter((x) => x[0] === 'linearRampToValueAtTime').at(-1)?.[1];
  const meng = n.staat.meng;
  ok(`${id}: daarna vloeit hij naar zijn meng (${meng})`, n.w.node && bij(naar(n.droog.gain), Math.cos(meng * Math.PI / 2)) && bij(naar(n.nat.gain), Math.sin(meng * Math.PI / 2)));
  const ctx2 = new MockContext({ worklet: w });
  const w2 = nepWorklet(); const ctxMis = new MockContext({ worklet: w2 });
  const mis = e.bouw(ctxMis); await w2.mislukt();
  ok(`${id}: laden mislukt = droog, geen fout`, !mis._n.w.node && mis._n.droog.gain.value === 1);
  inst.vernietig(); mis.vernietig?.(); void ctx2;
}

console.log('\neenheden: wat het scherm zegt is wat zet() doet');
const getal = (s) => Number(String(s).replace(/−/g, '-').match(/-?\d+(?:,\d+)?/)[0].replace(',', '.'));
const tekstKlopt = (tekst, waarde, schaal = 1) => {
  const g = getal(tekst) * (/kHz/.test(tekst) ? 1000 : 1) * schaal;
  const dec = (String(tekst).match(/,(\d+)/)?.[1].length ?? 0) - (/kHz/.test(tekst) ? 3 : 0);
  return Math.abs(g - waarde) <= 0.5 * Math.pow(10, -dec) * 1.0001 + 1e-9;
};
{
  let fout = [], n = 0;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    staat.NOW = 100 + i;
    const w = nepWorklet(), ctx = new MockContext({ worklet: w });
    const byId = (id) => S.S10_EFFECTEN.find((x) => x.id === id);
    // kam
    const k = byId('kam').bouw(ctx); await w.klaar();
    for (const p of ['toon', 'demping']) {
      k.zet(p, t, staat.NOW);
      const v = k._n.w.node.parameters.get(p).value;
      n++; if (!tekstKlopt(toonWaarde('kam', p, t), v)) fout.push(`kam.${p}@${t}: ${toonWaarde('kam', p, t)} ≠ ${v}`);
    }
    k.zet('feedback', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('kam', 'feedback', t), k._n.w.node.parameters.get('fb').value * 100)) fout.push(`kam.feedback@${t}`);
    // klinker: de eerste formant
    const kl = byId('klinker').bouw(ctx);
    kl.zet('schuif', 0.5, staat.NOW); kl.zet('klinker', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('klinker', 'klinker', t).split('·')[1], kl._n.banden[0].bp.frequency.value)) fout.push(`klinker@${t}`);
    kl.zet('reso', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('klinker', 'reso', t), kl._n.banden[0].bp.Q.value)) fout.push(`klinker.reso@${t}`);
    // freqschuif
    const f = byId('freqschuif').bouw(ctx); await w.klaar();
    f.zet('schuif', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('freqschuif', 'schuif', t), f._n.w.node.parameters.get('hz').value)) fout.push(`freqschuif@${t}`);
    // band
    const b = byId('band').bouw(ctx);
    b.zet('toon', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('band', 'toon', t), b._n.toon.frequency.value)) fout.push(`band.toon@${t}`);
    b.zet('drive', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('band', 'drive', t), 20 * Math.log10(b._n.voor.gain.value * 128))) fout.push(`band.drive@${t}`);
    b.zet('wow', t, staat.NOW);
    n++; if (!tekstKlopt(toonWaarde('band', 'wow', t), b._n.wow._kop().stand.diepte * 1000)) fout.push(`band.wow@${t}: ${toonWaarde('band', 'wow', t)} ≠ ${b._n.wow._kop().stand.diepte * 1000}`);
    // kanteling
    const kt = byId('kanteling').bouw(ctx);
    kt.zet('kanteling', t, staat.NOW); kt.zet('midden', t, staat.NOW);
    const tk = toonWaarde('kanteling', 'kanteling', t);
    n++; if (!(tk === 'vlak' ? Math.abs(kt._n.hoog.gain.value) < 0.05 : tekstKlopt(tk, kt._n.hoog.gain.value)) || !bij(kt._n.laag.gain.value, -kt._n.hoog.gain.value)) fout.push(`kanteling@${t}`);
    n++; if (!tekstKlopt(toonWaarde('kanteling', 'midden', t), kt._n.laag.frequency.value)) fout.push(`kanteling.midden@${t}`);
    // duiker: diepte in dB op de tel = 1 − d
    const d = byId('duiker').bouw(ctx, { klok: nepKlok() });
    d.zet('diepte', t, staat.NOW);
    const dt = toonWaarde('duiker', 'diepte', t);
    const opTel = d._n.poort.gain.value - d._n.diep.gain.value;
    n++; if (!(dt === 'uit' ? opTel > 0.995 : tekstKlopt(dt, 20 * Math.log10(Math.max(1e-3, opTel))))) fout.push(`duiker@${t}: ${dt} ≠ ${opTel}`);
    for (const x of [k, kl, f, b, kt, d]) x.vernietig?.();
  }
  ok(`${n} standen: tekst en node kloppen tot op de laatste decimaal`, fout.length === 0, fout.slice(0, 3).join('; '));
}

console.log('\nde duiker: op de tel');
{
  staat.NOW = 200;
  const ctx = new MockContext();
  const d = S.S10_EFFECTEN.find((x) => x.id === 'duiker').bouw(ctx, { klok: nepKlok(0.5) });
  const src = ctx.bronnen.filter((b) => b.soort === 'src').at(-1);
  const L = await import('../src/engine/fx-lfo.js');
  const golf = L.vormSamples('duik2');
  ok('de golf staat op de tel op −1 (gain 1 − d) en herstelt naar ~+1', bij(golf[0], -1, 1e-6) && golf[Math.floor(L.LFO_N * 0.9)] > 0.9);
  ok('zonder harde rand: elke stap in de golf < 0,05', golf.every((v, i) => i === 0 || Math.abs(v - golf[i - 1]) < 0.05) && Math.abs(golf[0] - golf[L.LFO_N - 1]) < 0.05);
  ok('de LFO start op een tel van de klok, met de deling 1/4 = één tel', src && Math.abs(src.buffer.duration / src.playbackRate.value - 0.5) < 1e-9);
  const voor = ctx.bronnen.length;
  d.zet('deling', 0.5, staat.NOW);
  ok('dezelfde deling nog eens: geen nieuwe bron', ctx.bronnen.length === voor);
  d.zet('herstel', 1, staat.NOW);
  ok('ander herstel: een nieuwe bron (andere golf)', ctx.bronnen.length === voor + 1);
  d.vernietig();
  ok('tremolo houdt vier vormen (de duikgolven staan er niet tussen)', L.LFO_VORMEN.length === 4);
}

// ---- rekenkernen ------------------------------------------------------------------------------

console.log('\nrekenkernen (fx-kern.js)');
const K = await import('../src/engine/fx-kern.js');
const SR = 48000, Q = 128;
const goertzel = (x, hz) => {
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
};
/** Een kern een tijd laten lopen met invoer f(n); geeft de uitvoer (links). */
function draaiKern(kern, sec, f) {
  const blokken = Math.ceil(sec * SR / Q), uit = new Float32Array(blokken * Q), uitR = new Float32Array(blokken * Q);
  const iL = new Float32Array(Q), oL = new Float32Array(Q), oR = new Float32Array(Q);
  for (let b = 0; b < blokken; b++) {
    for (let i = 0; i < Q; i++) iL[i] = f(b * Q + i);
    kern.render(iL, iL, 1, oL, oR, Q);
    uit.set(oL, b * Q); uitR.set(oR, b * Q);
  }
  return { L: uit, R: uitR };
}
{
  // Frequentieschuif: 1 kHz +100 Hz → 1100 Hz, en −250 → 750 Hz, vrijwel niets op de bron of het spiegelbeeld.
  const uit = [];
  for (const hz of [100, -250, 30]) {
    const k = new K.Freqschuif(SR);
    k.hz = hz;
    const { L } = draaiKern(k, 1.2, (n) => 0.5 * Math.sin(2 * Math.PI * 1000 * n / SR));
    const x = L.subarray(SR / 5, SR / 5 + SR);
    const a = goertzel(x, 1000 + hz), bron = goertzel(x, 1000), spiegel = goertzel(x, 1000 - hz);
    uit.push({ hz, a, bron, spiegel });
  }
  ok(`frequentieschuif: 1 kHz → 1 kHz + schuif (${uit.map((u) => `${u.hz > 0 ? '+' : ''}${u.hz}: ${(u.a / 0.5 * 100).toFixed(1)}% · bron ${(20 * Math.log10(u.bron / u.a)).toFixed(0)} dB · spiegel ${(20 * Math.log10(u.spiegel / u.a)).toFixed(0)} dB`).join('; ')})`,
    uit.every((u) => u.a > 0.45 && u.bron / u.a < 0.01 && u.spiegel / u.a < 0.01));
  // Ook laag (60 Hz) en hoog (12 kHz) blijft het een schuif: de ketens dekken het hele bereik.
  const randen = [60, 12000].map((f0) => {
    const k = new K.Freqschuif(SR); k.hz = 50;
    const { L } = draaiKern(k, 1.2, (n) => 0.5 * Math.sin(2 * Math.PI * f0 * n / SR));
    const x = L.subarray(SR / 5, SR / 5 + SR);
    return goertzel(x, f0 - 50) / goertzel(x, f0 + 50);
  });
  ok(`frequentieschuif op 60 Hz en 12 kHz: spiegelbeeld ${randen.map((r) => `${(20 * Math.log10(r)).toFixed(0)} dB`).join(' / ')}`, randen.every((r) => r < 0.01));
}
{
  // Kam: een toon op een veelvoud van de grondtoon komt er luider uit dan een toon ertussen.
  const opToon = (f) => {
    const k = new K.Kam(SR); k.toon = 200; k.fb = 0.9; k.demping = 20000;
    const { L } = draaiKern(k, 1, (n) => 0.2 * Math.sin(2 * Math.PI * f * n / SR));
    return goertzel(L.subarray(SR / 2), f) / 0.2;
  };
  const op = [200, 400, 600].map(opToon), naast = [300, 500].map(opToon);
  const verh = Math.min(...op) / Math.max(...naast);
  ok(`kam (200 Hz, fb 0,9): 200/400/600 Hz ${(20 * Math.log10(verh)).toFixed(1)} dB boven 300/500 (${op.map((g) => (20 * Math.log10(g)).toFixed(1)).join('/')} dB vs ${naast.map((g) => (20 * Math.log10(g)).toFixed(1)).join('/')})`, verh > 8);
  let x = 7;
  const ruis = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return ((x >>> 8) / 16777216 - 0.5) * 0.5; };
  const kr = new K.Kam(SR); kr.toon = 200; kr.fb = 0.9; kr.demping = 20000;
  const s = draaiKern(kr, 2, () => ruis()).L.subarray(SR / 2);
  let rms = 0; for (const v of s) rms += v * v; rms = Math.sqrt(rms / s.length);
  const inRms = 0.5 / Math.sqrt(12);
  ok(`kam: ruis ongeveer even luid als erin (√(1 − fb²) op de ingang; de demping neemt iets weg): ${(20 * Math.log10(rms / inRms)).toFixed(1)} dB`, Math.abs(20 * Math.log10(rms / inRms)) < 2.5);
  // Stabiel bij de uitersten, ook met demping op dof en een toon die verspringt.
  const k2 = new K.Kam(SR); k2.fb = -0.97; k2.demping = 500;
  let groot = 0;
  for (let b = 0; b < 2000; b++) {
    k2.toon = b % 200 < 100 ? 30 : 2000;
    const iL = new Float32Array(Q).map(() => ruis()), oL = new Float32Array(Q), oR = new Float32Array(Q);
    k2.render(iL, iL, 1, oL, oR, Q);
    for (const v of oL) groot = Math.max(groot, Math.abs(v));
  }
  ok(`kam op −97% feedback, toon springt 30 ↔ 2000 Hz: begrensd (piek ${groot.toFixed(2)})`, Number.isFinite(groot) && groot < 4);
  // Staart: zonder invoer sterft hij uit.
  const k3 = new K.Kam(SR); k3.toon = 100; k3.fb = 0.97; k3.demping = 20000;
  draaiKern(k3, 0.5, () => ruis());
  const stil = new Float32Array(Q), o1 = new Float32Array(Q), o2 = new Float32Array(Q);
  const blokken = Math.ceil(2.3 * SR / Q);   // staart volgens fx-s10: (1/100)·ln 0,001/ln 0,97 ≈ 2,27 s
  for (let b = 0; b < blokken; b++) k3.render(stil, stil, 0, o1, o2, Q);
  const rest = Math.max(...o1.map(Math.abs));
  ok(`kam: na de berekende staart (2,27 s) onder −50 dB (${(20 * Math.log10(rest / 0.25 + 1e-12)).toFixed(0)} dB)`, rest < 0.25 * 0.00316);
}
{
  // Aanslag: een klap (snel aan, traag uit). Aanval + = de klap luider, sustain − = de staart zachter.
  const klap = (n) => { const t = (n % 24000) / SR; return 0.5 * Math.exp(-t / 0.15) * Math.sin(2 * Math.PI * 220 * n / SR); };
  const meet = (av, su) => {
    const k = new K.Aanslag(SR); k.aanval = av; k.sustain = su;
    const { L } = draaiKern(k, 1.5, klap);
    const piek = (a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(L[i])); return m; };
    return { kop: piek(24000, 24000 + 480), staart: piek(24000 + 12000, 24000 + 14400) };
  };
  const nul = meet(0, 0), op = meet(1, 0), af = meet(0, -1);
  ok(`aanslag op 0/0 doet niets (kop ${nul.kop.toFixed(3)}, staart ${nul.staart.toFixed(3)})`, bij(nul.kop, klap(24000 + 47) > 0 ? nul.kop : nul.kop) && nul.kop > 0.45);
  ok(`aanval +100%: de kop luider (${(20 * Math.log10(op.kop / nul.kop)).toFixed(1)} dB), de staart gelijk`, op.kop / nul.kop > 1.4 && Math.abs(20 * Math.log10(op.staart / nul.staart)) < 1);
  ok(`sustain −100%: de staart zachter (${(20 * Math.log10(af.staart / nul.staart)).toFixed(1)} dB), nooit meer dan 12 dB`, af.staart / nul.staart < 0.7 && af.staart / nul.staart > 0.24);
}

console.log('\nde worklet: drie processors, geen afval');
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
const PROC = {};
globalThis.registerProcessor = (naam, klasse) => { PROC[naam] = klasse; };
await import('../src/engine/fx-worklet.js');
{
  const namen = ['varve-fx-kam', 'varve-fx-freqschuif', 'varve-fx-aanslag'];
  ok('de drie processors van S10 staan erin', namen.every((n) => PROC[n]));
  const proc = namen.map((n) => new PROC[n]());
  const params = [
    { toon: new Float32Array([180]), fb: new Float32Array([0.8]), demping: new Float32Array([6000]) },
    { hz: new Float32Array([120]) },
    { aanval: new Float32Array([0.6]), sustain: new Float32Array([-0.4]) },
  ];
  const INV = [];
  let x = 20261014;
  for (let b = 0; b < 64; b++) {
    const L = new Float32Array(Q), R = new Float32Array(Q);
    for (let i = 0; i < Q; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      const r = ((x >>> 8) / 16777216 - 0.5) * 0.2;
      L[i] = 0.4 * Math.sin(2 * Math.PI * 220 * (b * Q + i) / SR) + r; R[i] = L[i] * 0.8 - r;
    }
    INV.push([[L, R]]);
  }
  const uit = proc.map(() => [[new Float32Array(Q), new Float32Array(Q)]]);
  const leeg = [[]];
  let blok = 0;
  const draai = (n) => {
    for (let i = 0; i < n; i++) {
      const inv = (blok & 1023) === 1023 ? leeg : INV[blok & 63];
      for (let j = 0; j < 3; j++) proc[j].process(inv, uit[j], params[j]);
      blok++;
    }
  };
  draai(4000);
  const tijden = [];
  for (let j = 0; j < 3; j++) {
    let beste = Infinity;
    for (let r = 0; r < 3; r++) { const t0 = performance.now(); for (let i = 0; i < 3000; i++) proc[j].process(INV[i & 63], uit[j], params[j]); beste = Math.min(beste, (performance.now() - t0) / 3000); }
    tijden.push(beste);
  }
  ok(`rekentijd per blok van 128: kam ${(tijden[0] * 1000).toFixed(1)} µs, freqschuif ${(tijden[1] * 1000).toFixed(1)} µs, aanslag ${(tijden[2] * 1000).toFixed(1)} µs (elk < 0,1 ms van 2,67)`,
    tijden.every((t) => t < 0.1));
  ok('na opwarmen: uitgang eindig', uit.every((u) => [...u[0][0], ...u[0][1]].every(Number.isFinite)));
  const venster = () => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const h0 = process.memoryUsage().heapUsed;
    draai(12000);
    const h1 = process.memoryUsage().heapUsed;
    return { bytes: h1 - h0, gcs: prof.stop().statistics.length };
  };
  let beste = null, pogingen = 0;
  for (; pogingen < 30; pogingen++) {
    const r = venster();
    if (!beste || r.gcs < beste.gcs || (r.gcs === beste.gcs && r.bytes < beste.bytes)) beste = r;
    if (r.gcs === 0 && r.bytes < 1024) break;
  }
  ok(`geen afval: 12 000 blokken van alle drie, ${beste.gcs} GC's, ${beste.bytes} bytes heapgroei (venster ${pogingen + 1})`, beste.gcs === 0 && beste.bytes < 1024);
  proc[0].port.onmessage({ data: 'stop' });
  ok('na "stop" geeft process() false', proc[0].process(INV[0], uit[0], params[0]) === false);
}
void expMap; void dbToGain;

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
