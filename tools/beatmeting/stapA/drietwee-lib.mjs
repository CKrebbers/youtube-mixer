import { library, laadOnset, fmt, mmss } from '../lib.mjs';
const nieuw = await import('../../../server/detect.js?' + Date.now());
const oud = await import('./detect-oud.js');
for (const t of await library()) {
  const o = laadOnset(t);
  const V = Math.round(12 * o.envRate), S = Math.round(4 * o.envRate);
  let n = 0, flip = 0; const hist = { oud: {}, nieuw: {} }; const flips = {};
  for (let s = 0; s + V <= o.env.length; s += S) {
    const e = o.env.subarray(s, s + V);
    const a = oud.tempoUitEnvelope(e, o.envRate), b = nieuw.tempoUitEnvelope(e, o.envRate);
    n++;
    if (a.zekerheid >= 0.3) { const k = Math.round(a.bpm / 5) * 5; hist.oud[k] = (hist.oud[k] || 0) + 1; }
    if (b.zekerheid >= 0.3) { const k = Math.round(b.bpm / 5) * 5; hist.nieuw[k] = (hist.nieuw[k] || 0) + 1; }
    if (Math.abs(a.bpm - b.bpm) > 1) { flip++; const k = `${Math.round(a.bpm)}->${Math.round(b.bpm)}`; flips[k] = (flips[k] || 0) + 1; }
  }
  const top = (h) => Object.entries(h).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`\n${t.titel.slice(0, 30)}: ${n} vensters, gewisseld ${flip}`);
  console.log('  oud   (z>=.3):', top(hist.oud));
  console.log('  nieuw (z>=.3):', top(hist.nieuw));
  console.log('  wissels:', Object.entries(flips).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k}×${v}`).join(' '));
  const h1 = oud.tempoUitEnvelope(o.env, o.envRate), h2 = nieuw.tempoUitEnvelope(o.env, o.envRate);
  console.log(`  heel: oud ${fmt(h1.bpm)} nieuw ${fmt(h2.bpm)}`);
}
