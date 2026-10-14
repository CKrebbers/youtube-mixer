// De uitkomst van bench.mjs --json per soort fout, en de gewone gevallen (de zes eerste soorten,
// met en zonder vast-72/reggae-75, waar het DJ-tempo een keuze is). Alleen lezen.
//   node tools/beatmeting/synth/groep.mjs voor.json na.json ...
import { readFileSync } from 'node:fs';
const fs = process.argv.slice(2);
for (const f of fs) {
  const u = JSON.parse(readFileSync(f, 'utf8')).uitkomst;
  const per = {};
  for (const [k, s] of Object.entries(u)) { const v = k.split('/')[1]; (per[v] ??= []).push([k.split('/')[0], s]); }
  const gem = (xs, k) => { const v = xs.map(([, s]) => s[k]).filter((x) => x != null); return v.length ? Math.round(100 * v.reduce((a, b) => a + b, 0) / v.length) : '-'; };
  console.log('==', f);
  for (const [v, xs] of Object.entries(per)) console.log(v.padEnd(12), 'n', xs.length, 'vals', xs.filter(([, s]) => s.valsZeker).length, 'dek', gem(xs, 'dekking'), 'tempo', gem(xs, 'tempo'), 'dj', gem(xs, 'dj'), 'een', gem(xs, 'een'), 'naast', gem(xs, 'naast'));
  const oud6 = Object.entries(u).filter(([k]) => !k.endsWith('/oud') && !k.includes('dubbel-'));
  const zonder = oud6.filter(([k]) => !k.startsWith('vast-72/') && !k.startsWith('reggae-75/'));
  const g2 = (xs, k) => { const v = xs.map(([, s]) => s[k]).filter((x) => x != null); return Math.round(100 * v.reduce((a, b) => a + b, 0) / v.length); };
  console.log('de gewone (zes varianten): n', oud6.length, 'vals', oud6.filter(([, s]) => s.valsZeker).length, 'dek', g2(oud6, 'dekking'), 'tempo', g2(oud6, 'tempo'), 'dj', g2(oud6, 'dj'), 'naast', g2(oud6, 'naast'), '"1"', g2(oud6, 'een'));
  console.log('  zonder vast-72/reggae-75: n', zonder.length, 'dek', g2(zonder, 'dekking'), 'tempo', g2(zonder, 'tempo'), 'dj', g2(zonder, 'dj'));
}
