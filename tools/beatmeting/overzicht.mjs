// Per track: tempo over het geheel, tempocurve + segmenten, verfijning op een paar plekken.
// Gebruik: node overzicht.mjs [trackId]
import { library, laadOnset, d, fmt, mmss, pasVenster } from './lib.mjs';

const alleen = process.argv[2];
for (const t of await library()) {
  if (alleen && t.id !== alleen) continue;
  const o = laadOnset(t);
  console.log(`\n=== ${t.titel.slice(0, 50)} (${t.id}) ${mmss(t.duur)}  grid=${t.grid ? fmt(t.grid.bpm, 3) + ' @' + fmt(t.grid.firstBeat, 3) : 'geen'}`);

  let t0 = performance.now();
  const heel = d.tempoUitEnvelope(o.env, o.envRate);
  console.log(`heel: ${fmt(heel.bpm, 2)} bpm, zekerheid ${fmt(heel.zekerheid)}  (${(performance.now() - t0).toFixed(0)} ms)`);

  t0 = performance.now();
  const curve = d.tempoCurve(o.env, o.envRate, { vensterSec: 12, stapSec: 4, tijdOffset: o.tijdOffset });
  const seg = d.segmenteer(curve, { tolerantie: 0.03, minSec: 20 });
  console.log(`curve: ${curve.length} vensters (${(performance.now() - t0).toFixed(0)} ms)`);
  const zk = curve.map((c) => c.zekerheid).sort((a, b) => a - b);
  const q = (p) => zk[Math.floor(p * (zk.length - 1))];
  console.log(`  zekerheid p10/p50/p90: ${fmt(q(0.1))}/${fmt(q(0.5))}/${fmt(q(0.9))}; >=0.30: ${(100 * zk.filter((z) => z >= 0.3).length / zk.length).toFixed(0)}%`);
  // bpm-histogram in klassen van 5
  const hist = {};
  for (const c of curve) if (c.zekerheid >= 0.3) { const k = Math.round(c.bpm / 5) * 5; hist[k] = (hist[k] || 0) + 1; }
  console.log('  bpm-histogram (zeker>=0.3):', Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log(`  segmenten: ${seg.length}`);
  for (const s of seg.slice(0, 25)) console.log(`   ${mmss(s.van)}-${mmss(s.tot)}  ${fmt(s.bpm, 1)} bpm  z=${fmt(s.zekerheid)}`);
  if (seg.length > 25) console.log(`   ... nog ${seg.length - 25}`);

  // lange vensters (60 s) voor een rustiger beeld
  const lang = d.tempoCurve(o.env, o.envRate, { vensterSec: 60, stapSec: 30, tijdOffset: o.tijdOffset });
  console.log('  60s-vensters: ' + lang.map((c) => `${mmss(c.tijd)} ${fmt(c.bpm, 1)}/${fmt(c.zekerheid, 2)}`).join(' | '));

  // verfijning rond een paar plekken, start = heel.bpm
  if (heel.bpm) {
    const plekken = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => f * t.duur);
    for (const P of plekken) {
      t0 = performance.now();
      const r = d.verfijnTempoFase(o.env, o.envRate, heel.bpm, o.tijdOffset, { rond: P });
      const ms = performance.now() - t0;
      const pas = pasVenster(o, r, P - 45, P + 45);
      console.log(`  verfijn @${mmss(P)}: ${fmt(r.bpm, 2)} bpm, score ${fmt(r.score)}, ratio ${fmt(pas?.ratio)} R ${fmt(pas?.R, 3)}  (${ms.toFixed(0)} ms)`);
    }
  }
}
