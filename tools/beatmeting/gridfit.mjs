// Past één grid over de hele lengte? Per venster van 30 s:
//  P      = piek/mediaan van de kamscore over 64 fasen op het grid-tempo (pulssterkte op DAT tempo)
//  dFase  = waar de beste fase ligt t.o.v. de gridtel, in ms (0 = grid klopt)
//  lokaal = beste tempo in dit venster (verfijnTempoFase, ±15 s, start = grid-bpm, ±3%)
// Nulhypothese: dezelfde P op een envelope waarvan blokken van 1 s geschud zijn.
// Gebruik: node gridfit.mjs [trackId] [bpm firstBeat]   (zonder grid: bpm uit args)
import { library, laadOnset, d, fmt, mmss, lees } from './lib.mjs';

const VENSTER = 30;
const FASEN = 64;

export function kam(o, bpm, firstBeat, van, tot) {
  const { env, envRate, tijdOffset } = o;
  const p = 60 / bpm;
  const sc = new Float64Array(FASEN);
  for (let j = 0; j < FASEN; j++) {
    const ph = firstBeat + (j / FASEN) * p;
    const k0 = Math.ceil((van - ph) / p), k1 = Math.floor((tot - ph) / p);
    let s = 0, n = 0;
    for (let k = k0; k <= k1; k++) { s += lees(env, (ph + k * p - tijdOffset) * envRate); n++; }
    sc[j] = n ? s / n : 0;
  }
  const srt = [...sc].sort((a, b) => a - b);
  const med = srt[FASEN >> 1] || 1e-9;
  let best = 0;
  for (let j = 1; j < FASEN; j++) if (sc[j] > sc[best]) best = j;
  let dj = best > FASEN / 2 ? best - FASEN : best;
  return { P: sc[best] / med, opGrid: sc[0] / med, dFaseMs: (dj / FASEN) * p * 1000, halfJ: sc[FASEN / 2] / med };
}

export function geschud(o, blokSec = 1, seed = 1) {
  const { env, envRate } = o;
  const b = Math.round(blokSec * envRate), n = Math.floor(env.length / b);
  const idx = [...Array(n).keys()];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const uit = new Float32Array(n * b);
  for (let i = 0; i < n; i++) uit.set(env.subarray(idx[i] * b, idx[i] * b + b), i * b);
  return { ...o, env: uit };
}

export function nulDrempel(o, bpm) {
  const g = geschud(o);
  const Ps = [];
  const duur = g.env.length / g.envRate;
  for (let v = 0; v + VENSTER <= duur; v += VENSTER) Ps.push(kam(g, bpm, 0, v, v + VENSTER).P);
  Ps.sort((a, b) => a - b);
  return Ps[Math.floor(0.95 * (Ps.length - 1))];
}

export function gridRapport(t, o, grid, { stil = false } = {}) {
  const drempel = nulDrempel(o, grid.bpm);
  const rijen = [];
  for (let v = 0; v + VENSTER <= t.duur; v += VENSTER) {
    const k = kam(o, grid.bpm, grid.firstBeat, v, v + VENSTER);
    const lok = d.verfijnTempoFase(o.env, o.envRate, grid.bpm, o.tijdOffset, { rond: v + VENSTER / 2, straal: 15 });
    rijen.push({ v, ...k, lokaal: lok.bpm, puls: k.P > drempel });
  }
  const p = 60 / grid.bpm * 1000;
  const metPuls = rijen.filter((r) => r.puls);
  const klopt = metPuls.filter((r) => Math.abs(r.dFaseMs) < Math.max(20, 0.08 * p));
  const offbeat = metPuls.filter((r) => Math.abs(Math.abs(r.dFaseMs) - p / 2) < 0.08 * p);
  if (!stil) {
    console.log(`  grid ${fmt(grid.bpm, 3)} bpm; nuldrempel P=${fmt(drempel, 3)}; vensters ${rijen.length}, met puls ${metPuls.length}, fase klopt ${klopt.length}, precies op de offbeat ${offbeat.length}`);
    console.log('  ' + rijen.map((r) => `${mmss(r.v)} P${fmt(r.P, 2)}${r.puls ? '*' : ' '} d${fmt(r.dFaseMs, 0)} l${fmt(r.lokaal, 1)}`).join('\n  '));
  }
  return { drempel, rijen, metPuls: metPuls.length, klopt: klopt.length, offbeat: offbeat.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, bpmArg, fbArg] = process.argv.slice(2);
  for (const t of await library()) {
    if (id && t.id !== id) continue;
    const grid = bpmArg ? { bpm: Number(bpmArg), firstBeat: Number(fbArg || 0) } : t.grid;
    if (!grid) continue;
    console.log(`\n=== ${t.titel.slice(0, 50)} (${t.id})`);
    gridRapport(t, laadOnset(t), grid);
  }
}
