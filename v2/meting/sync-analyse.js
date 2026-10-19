/**
 * Sync meten in één opname van een mix (M13: djay tegen v2). Puur, in browser en Node.
 *
 * De kliksporen (kliksporen.mjs) hebben elk een eigen band: A = een lage klik (150 Hz),
 * B = een hoge (3 kHz). Uit één opname van de mix halen we per band de aanzetten, en voor
 * elke klik van B de afstand tot de dichtstbijzijnde klik van A. Zijn ze gesynct, dan is dat
 * ~0 ms (of een vaste fase als de ankers verschillen: die trekken we af via de mediaan).
 * Wat telt: de SPREIDING en de DRIFT (helling over de tijd) van dat verschil. De fase zelf heeft
 * een vaste meetafwijking van ~1 ms (de bandfilters vertragen niet even veel): vergelijk hem
 * alleen tussen twee apps op dezelfde sporen.
 */

/** Biquad bandfilter (RBJ), in place op een kopie. */
function band(x, sr, f, Q) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Aanzetten van een omhullende: eerste sample boven 30% van de piek na ≥ 100 ms rust. */
function aanzetten(y, sr) {
  // Omhullende: |y| gladgestreken met 1 ms.
  const n = Math.max(1, Math.round(sr / 1000));
  const env = new Float32Array(y.length);
  let som = 0;
  for (let i = 0; i < y.length; i++) { som += Math.abs(y[i]); if (i >= n) som -= Math.abs(y[i - n]); env[i] = som / n; }
  let piek = 0; for (const v of env) piek = Math.max(piek, v);
  const d = piek * 0.3, rust = Math.round(0.1 * sr);
  const uit = [];
  // Gewapend na `rust` samples onder de halve drempel: zo telt de aanloop van een klik niet als onrust.
  let stil = rust, gewapend = true;
  for (let i = 1; i < env.length; i++) {
    if (env[i] < d / 2) { if (++stil >= rust) gewapend = true; } else stil = 0;
    if (gewapend && env[i] > d && env[i - 1] <= d) {
      uit.push((i - 1 + (d - env[i - 1]) / (env[i] - env[i - 1])) / sr - 0.5 / 1000);   // −½ ms: de omhullende loopt een halve breedte achter
      gewapend = false;
    }
  }
  return uit;
}

const mediaan = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * @param x opname (mono Float32), sr, en de seconden aan het begin die je overslaat (inloop van de sync)
 * @returns { klikkenA, klikkenB, paren, faseMs, spreidingMs, p95Ms, maxMs, driftMsPerMin }
 */
export function meetSync(x, sr, { overslaan = 10, fA = 150, fB = 3000 } = {}) {
  const A = aanzetten(band(x, sr, fA, 2), sr).filter((t) => t >= overslaan);
  const B = aanzetten(band(x, sr, fB, 2), sr).filter((t) => t >= overslaan);
  const paren = [];
  let j = 0;
  for (const tb of B) {
    while (j + 1 < A.length && Math.abs(A[j + 1] - tb) <= Math.abs(A[j] - tb)) j++;
    if (A.length && Math.abs(A[j] - tb) < 0.25) paren.push({ t: tb, d: (tb - A[j]) * 1000 });
  }
  if (paren.length < 10) return { klikkenA: A.length, klikkenB: B.length, paren: paren.length, fout: 'te weinig klikken gevonden' };
  const fase = mediaan(paren.map((p) => p.d));
  const rest = paren.map((p) => p.d - fase);
  const abs = rest.map(Math.abs).sort((a, b) => a - b);
  // Drift: kleinste-kwadratenhelling van het verschil tegen de tijd, in ms per minuut.
  const mt = paren.reduce((a, p) => a + p.t, 0) / paren.length, md = paren.reduce((a, p) => a + p.d, 0) / paren.length;
  const drift = paren.reduce((a, p) => a + (p.t - mt) * (p.d - md), 0) / paren.reduce((a, p) => a + (p.t - mt) ** 2, 0) * 60;
  return {
    klikkenA: A.length, klikkenB: B.length, paren: paren.length,
    faseMs: +fase.toFixed(2),
    spreidingMs: +(mediaan(abs) * 1.4826).toFixed(3),
    p95Ms: +abs[Math.floor(abs.length * 0.95)].toFixed(3),
    maxMs: +abs.at(-1).toFixed(3),
    driftMsPerMin: +drift.toFixed(3),
  };
}

/** Een WAV (16-bit, mono of stereo) als Float32 mono, voor Node en de browser. */
export function wavMono(buf) {
  const v = new DataView(buf);
  let o = 12, k = 2, sr = 48000;
  while (o + 8 <= buf.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') { k = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); }
    if (id === 'data') {
      const n = Math.floor(Math.min(len, buf.byteLength - o - 8) / (2 * k));
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < k; c++) s += v.getInt16(o + 8 + (i * k + c) * 2, true); x[i] = s / k / 32768; }
      return { x, sr };
    }
    o += 8 + len + (len & 1);
  }
  throw new Error('geen data in de WAV');
}

/** Float32 mono -> WAV-bytes (16-bit). */
export function maakWav(x, sr) {
  const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
  const s = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true);
  return buf;
}
