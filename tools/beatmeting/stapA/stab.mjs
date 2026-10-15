import { library, laadOnset, fmt, mmss } from '../lib.mjs';
import { geschud } from '../gridfit.mjs';   // (stond als ../varve-beat/gridfit.mjs: de oude naam van tools/beatmeting/)
const d = await import('../../../server/detect.js?' + Date.now());
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
for (const t of await library()) {
  const o = laadOnset(t); const g = geschud(o, 1, 4242);
  const curve = d.tempoCurve(o.env, o.envRate, { tijdOffset: o.tijdOffset });
  const e = [], n = [];
  for (const c of curve) {
    e.push(d.faseStabiliteit(o.env, o.envRate, o.tijdOffset, c.bpm, c.tijd - 12, c.tijd + 12));
    n.push(d.faseStabiliteit(g.env, o.envRate, o.tijdOffset, c.bpm, c.tijd - 12, c.tijd + 12));
  }
  console.log(`${t.titel.slice(0, 25).padEnd(25)} echt p25/50/75/90 ${[.25, .5, .75, .9].map((p) => fmt(q(e, p))).join('/')}  nul ${[.25, .5, .75, .9].map((p) => fmt(q(n, p))).join('/')}  echt≥.67 ${(100 * e.filter((x) => x >= .67).length / e.length).toFixed(0)}% nul≥.67 ${(100 * n.filter((x) => x >= .67).length / n.length).toFixed(0)}%`);
}
