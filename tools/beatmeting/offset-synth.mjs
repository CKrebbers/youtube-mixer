// onsetVertraging is gemeten met een 900 Hz-tik. Klopt de fase ook voor andere klanken?
// Synthetische tel op 124 bpm (bekend anker 0,300 s) met verschillende aanzettijden en
// klankkleuren, door dezelfde pijplijn als de ingest (11025 Hz, envelope, normaliseren,
// verfijnTempoFase). Fasefout = gevonden tel min echte tel (ms, + = grid te laat).
import { d, fmt } from './lib.mjs';
const SR = 11025, BPM = 124, T0 = 0.3, DUUR = 60;
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
function spoor(klank, attackMs, ruisNiveau = 0.02) {
  const x = new Float32Array(SR * DUUR);
  for (let i = 0; i < x.length; i++) x[i] = ruisNiveau * rnd();
  const p = 60 / BPM, a = attackMs / 1000 * SR;
  for (let t = T0; t < DUUR - 1; t += p) {
    const s0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.4; i++) {
      const env = (a > 0 ? Math.min(1, i / a) : 1) * Math.exp(-i / (SR * 0.12));
      let v;
      if (klank === 'kick') v = Math.sin(2 * Math.PI * (55 * i / SR + 60 * (1 - Math.exp(-i / (SR * 0.03))) * 0.03));
      else if (klank === 'ruis') v = rnd();
      else if (klank === 'pad') v = Math.sin(2 * Math.PI * 220 * i / SR) + 0.5 * Math.sin(2 * Math.PI * 330 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 440 * i / SR);
      else v = Math.sin(2 * Math.PI * 900 * i / SR);
      if (s0 + i < x.length) x[s0 + i] += 0.5 * env * v;
    }
  }
  return x;
}
for (const klank of ['tik900', 'kick', 'ruis', 'pad']) {
  const rij = [];
  for (const att of [0, 5, 15, 30, 60]) {
    const { env, envRate, tijdOffset } = d.onsetEnvelope(spoor(klank, att), SR);
    const n = d.normaliseerEnvelope(env, envRate);
    const r = d.verfijnTempoFase(n, envRate, BPM, tijdOffset, { marge: 0.01 });
    const p = 60 / r.bpm;
    const tel = r.firstBeat + Math.round((30 - r.firstBeat) / p) * p;
    const echt = T0 + Math.round((30 - T0) / (60 / BPM)) * (60 / BPM);
    rij.push(`aanzet ${att} ms: ${fmt((tel - echt) * 1000, 1)} ms`);
  }
  console.log(`${klank.padEnd(7)} ${rij.join(' | ')}`);
}
