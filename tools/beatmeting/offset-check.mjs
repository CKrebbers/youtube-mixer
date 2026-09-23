// Klopt onsetVertraging (tijdOffset) op echte muziek? Onafhankelijke, fijne onsetfunctie
// (48 kHz, venster 256, hop 32, tijd = midden van het venster, breedband-flux) gevouwen op
// een grid; waar ligt de piek t.o.v. de gridtel?
// Gebruik: node offset-check.mjs <id> <van s> <duur s> <bpm> <firstBeat>
import { spawnSync } from 'node:child_process';
import { library, ROOT, d, fmt } from './lib.mjs';
const [id, vanA, duurA, bpmA, fbA] = process.argv.slice(2);
const t = (await library()).find((x) => x.id === id);
const SR = 48000, van = Number(vanA), duur = Number(duurA), bpm = Number(bpmA), fb = Number(fbA);
const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(van), '-t', String(duur), '-i', ROOT + '/' + t.audio,
  '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1e9 });
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
const W = 256, H = 32;
const re = new Float32Array(W), im = new Float32Array(W);
const hannW = Float32Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (W - 1)));
let vorig = new Float32Array(W / 2);
const flux = [];
for (let s = 0; s + W <= x.length; s += H) {
  for (let i = 0; i < W; i++) { re[i] = x[s + i] * hannW[i]; im[i] = 0; }
  d.fft(re, im);
  let f = 0;
  const nu = new Float32Array(W / 2);
  for (let b = 1; b < W / 2; b++) { nu[b] = Math.log1p(100 * Math.hypot(re[b], im[b])); const dd = nu[b] - vorig[b]; if (dd > 0) f += dd; }
  vorig = nu;
  flux.push({ t: van + (s + W / 2) / SR, f });
}
const p = 60 / bpm, BINS = 100;
const prof = new Float64Array(BINS);
for (const { t: tt, f } of flux) {
  let ph = ((tt - fb) / p) % 1; if (ph < 0) ph += 1;
  prof[Math.floor(ph * BINS)] += f;
}
let best = 0; for (let i = 1; i < BINS; i++) if (prof[i] > prof[best]) best = i;
const piekMs = ((best + 0.5) / BINS > 0.5 ? (best + 0.5) / BINS - 1 : (best + 0.5) / BINS) * p * 1000;
const gem = prof.reduce((a, b) => a + b, 0) / BINS;
console.log(`${t.titel.slice(0, 30)} ${van}-${van + duur}s @${bpm}: piek fijne onset t.o.v. grid ${fmt(piekMs, 1)} ms (piek/gem ${fmt(prof[best] / gem)}), tijdOffset in gebruik ${fmt(t.onset.tijdOffset * 1000, 1)} ms`);
// profiel rond 0 in ms
const rij = [];
for (let k = -10; k <= 10; k++) { const i = (best + k + BINS) % BINS; rij.push(fmt(prof[i] / gem, 1)); }
console.log('  profiel rond de piek (1 bin = ' + fmt(p * 1000 / BINS, 1) + ' ms): ' + rij.join(' '));
