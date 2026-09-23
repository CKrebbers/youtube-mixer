import { library, laadOnset, ROOT, fmt, mmss } from '../lib.mjs';
const { verfijnUitBestand } = await import(ROOT + '/server/analyze.js');
const d = await import(ROOT + '/server/detect.js');
const tracks = await library();
for (const [id, P, bpmBij] of [['f3a7DiCsm8k', 760, 155.96], ['HGv_ySHXtYI', 145, 153], ['mOzW9KQKfzA', 890, 129.3], ['1W1-nPXEVKk', 300, 120]]) {
  const t = tracks.find((x) => x.id === id), o = laadOnset(t);
  const waar = d.verfijnTempoFase(o.env, o.envRate, bpmBij, d.onsetVertraging(11025), { rond: P, straal: 10, marge: 0.005 });
  const p = 60 / waar.bpm;
  const eerste = waar.firstBeat + Math.round((P - 7 * p - waar.firstBeat) / p) * p;
  const taps = Array.from({ length: 8 }, (_, k) => eerste + k * p * 1.004 - 0.015 + [0.01, -0.02, 0.015, 0, -0.01, 0.02, -0.005, 0.012][k]);
  const t0 = performance.now();
  const r = await verfijnUitBestand(ROOT + '/' + t.onset.bestand, t.onset.envRate, 60 / (p * 1.004), t.onset.tijdOffset,
    { rond: taps.at(-1), taps, audio: ROOT + '/' + t.audio });
  const ms = performance.now() - t0;
  const tel = (g) => g.firstBeat + Math.round((P - g.firstBeat) / (60 / g.bpm)) * (60 / g.bpm);
  const dF = r.firstBeat == null ? null : (tel(r) - tel(waar)) * 1000;
  console.log(`${t.titel.slice(0, 22).padEnd(22)} @${mmss(P)}: zeker ${r.zeker}${r.reden ? ' (' + r.reden + ')' : ''}, ${fmt(r.bpm, 2)} bpm (grof-waarheid ${fmt(waar.bpm, 2)}), t.o.v. grove waarheid ${fmt(dF, 1)} ms, fijn ${r.fijn == null ? '-' : fmt(r.fijn * 1000, 1) + ' ms'}, puls ${fmt(r.puls)}, ${ms.toFixed(0)} ms`);
}
