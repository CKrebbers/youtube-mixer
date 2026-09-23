const d = await import('../../../server/detect.js?' + Date.now());
let t = performance.now();
console.log('onsetVertraging', (d.onsetVertraging(11025) * 1000).toFixed(1), 'ms', (performance.now() - t).toFixed(0), 'ms rekenen');
t = performance.now();
console.log('flankVertraging', (d.flankVertraging(11025) * 1000).toFixed(1), 'ms', (performance.now() - t).toFixed(0), 'ms rekenen');
// Eind-tot-eind: verfijnTempoFase (grof) en daarna fijneFase, op sporen BUITEN de ijkreeks (ander tempo, langer, andere zaden)
const SR = 11025, BPM = 118, T0 = 0.41;
const rij = { grof: [], fijn: [] };
for (const vloer of [0.005, 0.02, 0.08]) for (const klank of ['tik', 'kick', 'ruis', 'hihat', 'akkoord']) {
  const uit = [];
  for (const att of [0, 5, 15, 30]) {
    const x = d.ijkSpoor(SR, klank, att, vloer, { duur: 40, bpm: BPM, T0, seed: 11 });
    const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR);
    const n = d.normaliseerEnvelope(env, envRate);
    const r = d.verfijnTempoFase(n, envRate, BPM, tijdOffset, { marge: 0.01 });
    const p = 60 / r.bpm;
    const tel = r.firstBeat + Math.round((20 - r.firstBeat) / p) * p;
    const echt = T0 + Math.round((20 - T0) / (60 / BPM)) * (60 / BPM);
    const f = d.fijneFase(x.subarray(Math.round(8 * SR), Math.round(32 * SR)), SR, r.bpm, tel, { t0: 8 });
    rij.grof.push((tel - echt) * 1000); if (f !== null) rij.fijn.push((f - echt) * 1000);
    uit.push(`${att}: ${((tel - echt) * 1000).toFixed(1)} -> ${f === null ? '-' : ((f - echt) * 1000).toFixed(1)}`);
  }
  console.log(`vloer ${vloer} ${klank.padEnd(8)} ${uit.join(' | ')}`);
}
for (const k in rij) console.log(k, 'min', Math.min(...rij[k]).toFixed(1), 'max', Math.max(...rij[k]).toFixed(1), 'n', rij[k].length);
