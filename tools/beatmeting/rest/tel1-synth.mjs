// Restpunt 2: "tel 1 hier" — alleen snappen (zoals nu) tegen snappen + /grid/verfijn.
// Synthetisch (ijkSpoor uit detect.js, andere zaden en tempo's dan de ijking),
// dus de echte tel is bekend. 900 keer drukken, ±25 ms naast de tel.
//   node tools/beatmeting/rest/tel1-synth.mjs [tempofout grid, bv. 0.01]
// Varianten:
//   A  snap naar een klap binnen 30 ms (zoals nu)
//   B  + wat de route /grid/verfijn doet met { bpm, positie, anker } (verfijnTap + voorflank), < 30 ms van de snap
//   C  + alleen de voorflank (fijneFase) op het tempo van het grid, < 30 ms
//   D  als B, maar alleen overnemen als de voorflank gemeten is
import { d, analyze, beatgrid, SR } from './lib.mjs';

const PIEK = await analyze.piekVertraging();
const bpmFout = Number(process.argv[2] ?? 0);
const fouten = { A: [], B: [], C: [], D: [] };
for (const seed of [11, 12]) for (const vloer of [0.005, 0.02, 0.08]) for (const klank of ['tik', 'kick', 'ruis', 'hihat', 'akkoord']) for (const aanzet of [5, 20, 30]) {
  const BPM = 118 + (seed - 11) * 9, T0 = 0.41, P = 60 / BPM;
  const x = d.ijkSpoor(SR, klank, aanzet, vloer, { duur: 30, bpm: BPM, T0, seed });
  const { env, envRate } = d.onsetEnvelope(x, SR);
  const n = d.normaliseerEnvelope(env, envRate);
  const tijdOffset = d.onsetVertraging(SR, 1024, 128);
  const onsets = analyze.onsetPieken(n, envRate, PIEK);
  const gridBpm = BPM * (1 + bpmFout);
  const audio = (van) => x.subarray(Math.round(van * SR), Math.round((van + 24) * SR));
  for (const k of [25, 30]) for (const druk of [-0.025, -0.012, 0, 0.012, 0.025]) {
    const echt = T0 + k * P;
    const snap = beatgrid.snapNaarOnset(onsets, echt + druk);
    const r = d.verfijnTap(n, envRate, tijdOffset, { bpm: gridBpm, positie: snap, anker: snap });
    let b = snap, fijn = false;
    if (r.zeker && Number.isFinite(r.anker)) {
      b = r.anker;
      const van = Math.max(0, r.anker - 12);
      const f = d.fijneFase(audio(van), SR, r.bpm, r.anker, { t0: van });
      if (f !== null && Math.abs(f - r.anker) < 0.03) { b = f; fijn = true; }
    }
    const B = Math.abs(b - snap) < 0.03 ? b : snap;
    const D = fijn && Math.abs(b - snap) < 0.03 ? b : snap;
    const van = Math.max(0, snap - 12);
    const f = d.fijneFase(audio(van), SR, gridBpm, snap, { t0: van });
    const C = f !== null && Math.abs(f - snap) < 0.03 ? f : snap;
    for (const [v, t] of [['A', snap], ['B', B], ['C', C], ['D', D]]) fouten[v].push((t - echt) * 1000);
  }
}
const stat = (a) => {
  const abs = a.map(Math.abs).sort((p, q) => p - q);
  const q = (f) => abs[Math.min(abs.length - 1, Math.floor(f * abs.length))];
  return `gem ${(a.reduce((p, q2) => p + q2, 0) / a.length).toFixed(1).padStart(5)}  |p50| ${q(0.5).toFixed(1).padStart(5)}  |p90| ${q(0.9).toFixed(1).padStart(5)}  max ${abs.at(-1).toFixed(1).padStart(5)}  >10 ms ${(100 * abs.filter((v) => v > 10).length / abs.length).toFixed(0).padStart(3)}%`;
};
console.log(`grid-tempo ${bpmFout ? `${(bpmFout * 100).toFixed(2)}% naast` : 'exact'}; ${fouten.A.length} keer drukken; fout t.o.v. de echte tel (ms)`);
for (const v of ['A', 'B', 'C', 'D']) console.log(`  ${v}: ${stat(fouten[v])}`);
