// Is er in dit stuk überhaupt een puls? Per venster van 20 s: beste fase-helderheid R
// over alle tempo's 60..190 (afgetopte envelope), tegen dezelfde maat op een geschudde
// envelope (blokken van 1 s). Plus de detector-zekerheid van tempoUitEnvelope op dat
// venster, zodat we zien of de zekerheid de echte puls volgt.
// Gebruik: node puls.mjs [trackId]
import { library, laadOnset, d, fmt, mmss } from './lib.mjs';
import { geschud } from './gridfit.mjs';

const V = 20;
function besteR(o, van) {
  const { env, envRate } = o;
  const fA = Math.floor(van * envRate), fB = Math.min(env.length, Math.floor((van + V) * envRate));
  const deel = Array.from(env.subarray(fA, fB)).sort((a, b) => a - b);
  const cap = deel[Math.floor(0.95 * (deel.length - 1))] || 1e-9;
  const e = new Float32Array(fB - fA);
  let som = 0;
  for (let f = fA; f < fB; f++) { e[f - fA] = Math.min(env[f], cap); som += e[f - fA]; }
  let best = { R: 0, bpm: 0 };
  for (let bpm = 60; bpm <= 190; bpm *= 1.004) {
    const w = 2 * Math.PI * bpm / 60 / envRate;
    const cw = Math.cos(w), sw = Math.sin(w);
    let c = 1, s = 0, re = 0, im = 0;
    for (let i = 0; i < e.length; i++) { re += e[i] * c; im += e[i] * s; const nc = c * cw - s * sw; s = c * sw + s * cw; c = nc; }
    const R = som ? Math.hypot(re, im) / som : 0;
    if (R > best.R) best = { R, bpm };
  }
  return best;
}

const alleen = process.argv[2];
const alleRijen = [];
for (const t of await library()) {
  if (alleen && t.id !== alleen) continue;
  const o = laadOnset(t);
  const g = geschud(o, 1, 7);
  const nul = [];
  for (let v = 0; v + V <= t.duur; v += V) nul.push(besteR(g, v).R);
  nul.sort((a, b) => a - b);
  const drempel = nul[Math.floor(0.95 * (nul.length - 1))];
  const rijen = [];
  for (let v = 0; v + V <= t.duur; v += V) {
    const b = besteR(o, v);
    const fA = Math.floor(v * o.envRate);
    const z = d.tempoUitEnvelope(o.env.subarray(fA, fA + Math.round(V * o.envRate)), o.envRate);
    rijen.push({ v, ...b, puls: b.R > drempel, zek: z.zekerheid, dbpm: z.bpm });
  }
  const n = rijen.filter((r) => r.puls).length;
  console.log(`\n=== ${t.titel.slice(0, 45)}: drempel R=${fmt(drempel, 3)}; vensters met puls ${n}/${rijen.length} (${(100 * n / rijen.length).toFixed(0)}%)`);
  console.log(rijen.map((r) => `${mmss(r.v)} R${fmt(r.R, 3)}${r.puls ? '*' : ' '}@${fmt(r.bpm, 1)} det ${fmt(r.dbpm, 1)} z${fmt(r.zek)}`).join('\n'));
  for (const r of rijen) alleRijen.push({ id: t.id, ...r });
}

// Voorspelt de zekerheid of er een puls is?
const bins = [[0, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 0.8], [0.8, 1.01]];
console.log('\nzekerheid -> aandeel vensters met echte puls (R boven nul-p95), en detector-bpm in ±4% (of x2/÷2/x1.5/÷1.5) van puls-bpm');
for (const [a, b] of bins) {
  const s = alleRijen.filter((r) => r.zek >= a && r.zek < b);
  const p = s.filter((r) => r.puls);
  const eens = (r) => [1, 2, 0.5, 1.5, 2 / 3].some((k) => Math.abs(r.dbpm * k / r.bpm - 1) < 0.04);
  const direct = p.filter((r) => Math.abs(r.dbpm / r.bpm - 1) < 0.04).length;
  const oct = p.filter(eens).length;
  console.log(`  z ${a}-${b}: ${s.length} vensters, puls ${p.length} (${s.length ? (100 * p.length / s.length).toFixed(0) : '-'}%), van die: zelfde bpm ${direct}, zelfde of verhouding ${oct}`);
}
