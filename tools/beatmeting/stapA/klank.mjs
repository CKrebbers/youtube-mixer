// Synthetische klanken met bekende tel (T0 + k·p), voor ijken en testen.
export const SR = 11025;
export function spoor(klank, attackMs, { bpm = 124, T0 = 0.3, duur = 60, ruis = 0.02, seed = 3, sr = SR } = {}) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const x = new Float32Array(Math.round(sr * duur));
  for (let i = 0; i < x.length; i++) x[i] = ruis * rnd();
  const p = 60 / bpm, a = attackMs / 1000 * sr;
  for (let t = T0; t < duur - 1; t += p) {
    const s0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.4; i++) {
      const env = (a > 0 ? Math.min(1, i / a) : 1) * Math.exp(-i / (sr * 0.12));
      let v;
      if (klank === 'kick') v = Math.sin(2 * Math.PI * (55 * i / sr + 60 * (1 - Math.exp(-i / (sr * 0.03))) * 0.03));
      else if (klank === 'ruis') v = rnd();
      else if (klank === 'pad') v = Math.sin(2 * Math.PI * 220 * i / sr) + 0.5 * Math.sin(2 * Math.PI * 330 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
      else if (klank === 'hihat') { v = rnd() * Math.exp(-i / (sr * 0.02)) * 3; }
      else v = Math.sin(2 * Math.PI * 900 * i / sr);
      if (s0 + i < x.length) x[s0 + i] += 0.5 * env * v;
    }
  }
  return x;
}
