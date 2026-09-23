const d = await import('../../../server/detect.js?' + Date.now());
const SR = 11025;
// 60 s kick op 120 (eerste tel 0,10), 40 s ruis zonder puls, 60 s op 128 (eerste tel 100,33)
const delen = [{ duur: 60, bpm: 120, eerste: 0.10 }, { duur: 40, bpm: null }, { duur: 60, bpm: 128, eerste: 100.33 }];
const totaal = delen.reduce((a, b) => a + b.duur, 0);
const x = new Float32Array(SR * totaal);
let s = 17; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2147483648 - 1);
for (let i = 0; i < x.length; i++) x[i] = 0.01 * rnd();
let t0 = 0;
for (const dl of delen) {
  if (dl.bpm) for (let t = dl.eerste; t < t0 + dl.duur; t += 60 / dl.bpm) {
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 2000; i++) x[s0 + i] += 0.5 * Math.exp(-i / (SR * 0.05)) * Math.sin(2 * Math.PI * (55 * i / SR + 1.8 * (1 - Math.exp(-i / (SR * 0.03)))));
  } else {
    // ruis met willekeurige klappen, geen puls
    for (let k = 0; k < 60; k++) { const s0 = Math.round((t0 + rnd() * 0.5 * dl.duur + 0.5 * dl.duur) * SR); for (let i = 0; i < 1500; i++) x[s0 + i] += 0.4 * Math.exp(-i / 300) * rnd(); }
    for (let i = Math.round(t0 * SR); i < (t0 + dl.duur) * SR; i++) x[i] += 0.1 * rnd();
  }
  t0 += dl.duur;
}
const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR);
const n = d.normaliseerEnvelope(env, envRate);
let t = performance.now();
const st = d.analyseerGrid(n, envRate, tijdOffset);
console.log('zonder pcm', (performance.now() - t).toFixed(0), 'ms');
for (const k of st) console.log(k.van.toFixed(1), k.tot.toFixed(1), k.bpm?.toFixed(2), k.anker?.toFixed(3), k.zekerheid.toFixed(2));
t = performance.now();
const st2 = d.analyseerGrid(n, envRate, tijdOffset, { pcm: x, sampleRate: SR });
console.log('met pcm', (performance.now() - t).toFixed(0), 'ms');
for (const k of st2) console.log(k.van.toFixed(1), k.tot.toFixed(1), k.bpm?.toFixed(2), k.anker?.toFixed(4), k.zekerheid.toFixed(2));
