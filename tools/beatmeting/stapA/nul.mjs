import { library, laadOnset, fmt, mmss } from '../lib.mjs';
const d = await import('../../../server/detect.js?' + Date.now());
const tracks = await library();
const plek = [['f3a7DiCsm8k', [700, 760, 950, 1010, 250, 1200, 1800], 155.96], ['HGv_ySHXtYI', [75, 145, 30, 190], 153], ['mOzW9KQKfzA', [890, 2190, 2400, 2535, 300, 1000], 120],
  ['1W1-nPXEVKk', [100, 300, 600, 900, 1200, 1500, 1800, 2100, 2400], 120]];
for (const [id, Ps, bpm0] of plek) {
  const o = laadOnset(tracks.find((x) => x.id === id));
  for (const P of Ps) {
    const bpm = id.startsWith('mOz') && P === 890 ? 129.3 : id.startsWith('mOz') && P === 2400 ? 100.9 : id.startsWith('mOz') && P === 2535 ? 173.2 : bpm0;
    const w = d.verfijnTempoFase(o.env, o.envRate, bpm, o.tijdOffset, { rond: P, straal: 10, marge: 0.005 });
    const rij = [];
    for (const [naam, opt] of [['vrij', { rond: P, marge: 0.03 }], ['anker', { rond: P, marge: 0.03, anker: w.firstBeat + Math.round((P - w.firstBeat) / (60 / w.bpm)) * 60 / w.bpm }], ['straal20', { rond: P, marge: 0.03, straal: 20 }]]) {
      const r = d.verfijnTempoFase(o.env, o.envRate, w.bpm * 1.01, o.tijdOffset, opt);
      const t = d.pulsToets(o.env, o.envRate, o.tijdOffset, w.bpm * 1.01, r.grofScore, opt, { schud: 16 });
      rij.push(`${naam} v${fmt(t.verhouding)} z${fmt(t.z, 1)}`);
    }
    console.log(`${id.slice(0, 6)} @${mmss(P)} ${fmt(w.bpm, 1)}  ${rij.join(' | ')}`);
  }
}
