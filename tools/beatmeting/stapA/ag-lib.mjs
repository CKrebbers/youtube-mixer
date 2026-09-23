import { library, laadOnset, fmt, mmss } from '../lib.mjs';
const d = await import('../../../server/detect.js?' + Date.now());
const oud = await import('./detect-oud.js');
for (const t of await library()) {
  const o = laadOnset(t);
  let t0 = performance.now();
  const st = d.analyseerGrid(o.env, o.envRate, o.tijdOffset);
  const ms = performance.now() - t0;
  const segOud = oud.segmenteer(oud.tempoCurve(o.env, o.envRate, { tijdOffset: o.tijdOffset }), { tolerantie: 0.03, minSec: 20 });
  const zeker = st.filter((s) => s.zekerheid >= 0.5).reduce((a, s) => a + s.tot - s.van, 0);
  console.log(`\n${t.titel.slice(0, 30)} ${mmss(t.duur)}: ${st.length} stukken (oud segmenteer: ${segOud.length}), zeker ≥0,5: ${(100 * zeker / t.duur).toFixed(0)}% van de tijd, ${ms.toFixed(0)} ms`);
  console.log(st.slice(0, 30).map((s) => `  ${mmss(s.van)}-${mmss(s.tot)} ${fmt(s.bpm, 1)} z${fmt(s.zekerheid)}`).join('\n'));
}
