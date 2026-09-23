// Tap-simulatie zoals varve-beat/tap-sim.mjs (zelfde plekken, zelfde tikfouten, zelfde waarheid),
// maar vergelijkt de OUDE serverlogica (A) met verfijnTap (N). Leest alleen.
import { library, laadOnset, fmt, mmss } from '../lib.mjs';
const d = await import('../../../server/detect.js?' + Date.now());
const PLEKKEN = [
  ['f3a7DiCsm8k', 700, 155.96, 'album 156 A'], ['f3a7DiCsm8k', 760, 155.96, 'album 156 A'],
  ['f3a7DiCsm8k', 950, 155.96, 'album 156 B'], ['f3a7DiCsm8k', 1010, 155.96, 'album 156 B'],
  ['HGv_ySHXtYI', 75, 153, 'Bay Ledges zwalkt'], ['HGv_ySHXtYI', 145, 153, 'Bay Ledges'],
  ['mOzW9KQKfzA', 890, 129.3, 'Sakamoto 129'], ['mOzW9KQKfzA', 2190, 120.0, 'Sakamoto 120'],
  ['mOzW9KQKfzA', 2400, 100.9, 'Sakamoto 101'], ['mOzW9KQKfzA', 2535, 173.2, 'Sakamoto 173'],
  ['1W1-nPXEVKk', 300, 120, 'zoned out'], ['1W1-nPXEVKk', 1500, 120, 'zoned out'],
];
const PROEVEN = Number(process.env.PROEVEN || 40);
const opties = JSON.parse(process.env.OPT || '{}');
let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const med = (a) => { const q = [...a].sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; };
const telBij = (g, P) => { const p = 60 / g.bpm; return g.firstBeat + Math.round((P - g.firstBeat) / p) * p; };
const faseFout = (g, waar, P) => { const p = 60 / waar.bpm * 1000; const x = (telBij(g, P) - telBij(waar, P)) * 1000; return x - Math.round(x / p) * p; };
const tracks = await library();
const T = {}; for (const n of [4, 8]) for (const v of ['A', 'N']) T[n + v] = { ok: 0, off: 0, fout: 0, weiger: 0, tot: 0 };
const zo = { 4: { weiger: 0, tot: 0 }, 8: { weiger: 0, tot: 0 } };
const cache = {};
for (const [id, P, bpmBij, label] of PLEKKEN) {
  const o = cache[id] ||= laadOnset(tracks.find((x) => x.id === id));
  const waar = d.verfijnTempoFase(o.env, o.envRate, bpmBij, o.tijdOffset, { rond: P, straal: 10, marge: 0.005 });
  const p = 60 / waar.bpm;
  const rij = {};
  for (let proef = 0; proef < PROEVEN; proef++) {
    for (const n of [4, 8]) {
      const tempoFout = (rnd() * 2 - 1) * 0.01, bias = -0.015;
      const eerste = telBij(waar, P - (n - 1) * p);
      const tijden = [];
      for (let k = 0; k < n; k++) tijden.push(eerste + k * p * (1 + tempoFout) + bias + gauss() * 0.020);
      const gaten = tijden.slice(1).map((t, i) => t - tijden[i]).sort((a, b) => a - b);
      const mG = gaten.length % 2 ? gaten[(gaten.length - 1) / 2] : (gaten[gaten.length / 2 - 1] + gaten[gaten.length / 2]) / 2;
      const bpmTap = 60 / mG, laatste = tijden.at(-1);
      const A = d.verfijnTempoFase(o.env, o.envRate, bpmTap, o.tijdOffset, { rond: laatste, marge: 0.03 });
      const N = d.verfijnTap(o.env, o.envRate, o.tijdOffset, { bpm: bpmTap, positie: laatste, taps: tijden, ...opties });
      for (const [v, g] of [['A', { ...A, zeker: true }], ['N', N]]) {
        const k = n + v; (rij[k] ||= { ok: 0, off: 0, fout: 0, weiger: 0 });
        if (!g.zeker) { rij[k].weiger++; if (!id.startsWith('1W1')) T[k].weiger++; }
        if (g.firstBeat === null) { continue; }
        const fm = faseFout(g, waar, P), weg = Math.abs(g.bpm / waar.bpm - 1) * 16 * p * 1000;
        const c = Math.abs(fm) < 25 && weg < 40 ? 'ok' : Math.abs(Math.abs(fm) - p * 500) < p * 1000 * 0.12 ? 'off' : 'fout';
        rij[k][c]++;
        if (!id.startsWith('1W1')) T[k][c]++;
      }
      if (!id.startsWith('1W1')) { T[n + 'A'].tot++; T[n + 'N'].tot++; } else { zo[n].tot++; if (!N.zeker) zo[n].weiger++; }
    }
  }
  console.log(`${label.padEnd(18)} @${mmss(P)} ` + Object.entries(rij).map(([k, r]) => `${k}: ${r.ok}/${r.off}/${r.fout}/w${r.weiger}`).join('  '));
}
for (const [k, r] of Object.entries(T)) console.log(`${k}: goed ${(100 * r.ok / r.tot).toFixed(0)}%  offbeat ${(100 * r.off / r.tot).toFixed(1)}%  anders ${(100 * r.fout / r.tot).toFixed(0)}%  geweigerd ${(100 * r.weiger / r.tot).toFixed(1)}%`);
console.log(`zoned out geweigerd: 4 tikken ${zo[4].weiger}/${zo[4].tot}, 8 tikken ${zo[8].weiger}/${zo[8].tot}`);
