// Gedeelde hulpjes op één plek (15 okt, spoor E van de architectuur-audit):
// getallen als tekst (src/lib/notatie.js), welke track een uitleg bedoelt (src/ui/wie.js)
// en WORKLET_FADE (fx-meer.js, ook voor fx-s10.js). De tekst is teken voor teken die van
// de kopieën van vroeger; de rest van de labels toetsen effecten, effecten-s10, rack en
// apc-beschrijf (de uitleg van de hele standaardmapping).
// Draai met: node test/notatie.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond || !extra ? '' : `  (${extra})`)); };
const WORTEL = fileURLToPath(new URL('..', import.meta.url));

const N = await import('../src/lib/notatie.js');
const dom = await import('../src/ui/dom.js');
const W = await import('../src/ui/wie.js');

console.log('notatie');
// De kopieën zoals ze in fx.js, fx-meer.js, fx-s10.js, de instrumenten en rack-editor stonden.
const oud = {
  komma: (x, n) => x.toFixed(n).replace('.', ','),
  hzFx: (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',')} kHz` : `${Math.round(f)} Hz`),
  pct: (v) => `${Math.round(v * 100)}%`,
  pctDom: (v) => `${Math.round((typeof v === 'number' ? v : 0) * 100)}%`,
};
oud.hz = (f) => (f >= 1000 ? `${oud.komma(f / 1000, f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
oud.ms = (s) => (s < 0.1 ? `${oud.komma(s * 1000, 1)} ms` : `${Math.round(s * 1000)} ms`);
oud.teken = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
oud.db = (d) => `${oud.teken(Math.round(d * 10))}${oud.komma(Math.abs(d), 1)} dB`;

const getallen = [];
for (let i = -200; i <= 200; i++) getallen.push(i / 7, i * 137.3, i / 1000, i * 0.05);
getallen.push(0, -0, 999.5, 999.4, 1000, 9999.9, 9950, 10000, 0.0995, 0.1, 0.09999, 22050, 1e-9, -1e-9, 0.005, -0.05, -0.04);
const mis = (f, g) => getallen.filter((x) => f(x) !== g(x)).slice(0, 3).map((x) => `${x}: ${f(x)} ≠ ${g(x)}`).join('; ');
ok('komma met 0, 1 en 2 decimalen = de oude kopie', [0, 1, 2].every((n) => !mis((x) => N.komma(x, n), (x) => oud.komma(x, n))));
ok('komma zonder n = 1 decimaal (zoals de instrumenten)', !mis((x) => N.komma(x), (x) => oud.komma(x, 1)));
ok('hz = de kopie van fx-meer/fx-s10/de instrumenten', !mis(N.hz, oud.hz), mis(N.hz, oud.hz));
ok('hz = de kopie van fx.js (toFixed in de regel)', !mis(N.hz, oud.hzFx), mis(N.hz, oud.hzFx));
ok('pct, ms, teken, db = de oude kopieën', !mis(N.pct, oud.pct) && !mis(N.ms, oud.ms) && !mis(N.teken, oud.teken) && !mis(N.db, oud.db));
ok('voorbeelden: 1,5 kHz · 12 kHz · 440 Hz · 4,5 ms · 250 ms · −0,5 dB · 0,0 dB',
  N.hz(1500) === '1,5 kHz' && N.hz(12000) === '12 kHz' && N.hz(440) === '440 Hz' && N.ms(0.0045) === '4,5 ms'
  && N.ms(0.25) === '250 ms' && N.db(-0.5) === '−0,5 dB' && N.db(0.04) === '0,0 dB' && N.db(3) === '+3,0 dB');
const allerlei = [...getallen.map((x) => x / 300), undefined, null, 'x', NaN, true, {}];
ok('dom.pct = de oude: geen getal telt als 0', allerlei.every((v) => dom.pct(v) === oud.pctDom(v)));

console.log('wie');
const plaats = ['{focus}', '{speel}', '{tweede}', '{R}', '{L}', '{maatgever}', '{plek}', '1', '8', 'constructor', 'toString', '__proto__'];
const oudVol = (t) => (t === '{focus}' ? 'focus-track' : t === '{speel}' ? 'speeltrack' : t === '{tweede}' || t === '{R}' ? 'tweede track'
  : t === '{maatgever}' ? 'de track die de maat geeft' : `track ${t}`);
const oudPrecisie = (t) => (t === '{focus}' ? 'focus-track' : t === '{speel}' ? 'speeltrack' : t === '{maatgever}' ? 'maatgever'
  : t === '{tweede}' || t === '{R}' ? 'vorige focus' : `track ${t}`);
const oudApc = (t) => (t === '{focus}' ? 'focus-track' : t === '{speel}' ? 'speeltrack' : `track ${t}`);
const precisie = W.wieMet({ '{maatgever}': 'maatgever', '{tweede}': 'vorige focus', '{R}': 'vorige focus' });
ok('WIE = die van combi en effecten', plaats.every((t) => W.wie(t) === oudVol(t)));
ok('wieMet = die van precisie', plaats.every((t) => W.wie(t, precisie) === oudPrecisie(t)));
ok('WIE_KERN = die van apc-beschrijf', plaats.every((t) => W.wie(t, W.WIE_KERN) === oudApc(t)));
ok('de tabellen zijn bevroren (een spoor kan de woorden van een ander niet veranderen)',
  Object.isFrozen(W.WIE) && Object.isFrozen(W.WIE_KERN) && Object.isFrozen(precisie));

console.log('één plek');
const lees = (p) => readFileSync(join(WORTEL, p), 'utf8');
const alleJs = (d) => readdirSync(join(WORTEL, d)).flatMap((n) => {
  const p = join(d, n);
  return statSync(join(WORTEL, p)).isDirectory() ? (n === 'vendor' ? [] : alleJs(p)) : n.endsWith('.js') ? [p] : [];
});
// Waar de kopieën stonden: daar mag geen eigen komma/hz/pct/ms/teken/db meer komen.
const WAS = ['src/engine/fx.js', 'src/engine/fx-meer.js', 'src/engine/fx-s10.js', 'src/engine/instrumenten/drums.js',
  'src/engine/instrumenten/fm.js', 'src/ui/rack-editor.js', 'src/ui/toon-weergave.js'];
const eigen = WAS.flatMap((p) => [...lees(p).matchAll(/^const (komma|hz|pct|ms|teken|db) = /gm)].map((m) => `${p}: ${m[1]}`));
ok('geen eigen komma/hz/pct/ms/teken/db meer in de bestanden waar ze gekopieerd stonden', eigen.length === 0, eigen.join(', '));
ok('schaal.js: geen eigen komma meer (zijn pct klemt en blijft)', !/^const komma = /m.test(lees('src/engine/instrumenten/schaal.js')));
const fade = alleJs('src/engine').filter((p) => /^\s*(export )?const WORKLET_FADE\b/m.test(lees(p)));
ok('WORKLET_FADE op één plek (fx-meer.js), fx-s10.js importeert hem', fade.length === 1 && fade[0] === 'src/engine/fx-meer.js'
  && /WORKLET_FADE,?\s*\n?\}?\s*from '\.\/fx-meer\.js'/.test(lees('src/engine/fx-s10.js')), fade.join(', '));
ok('fx-worklet.js (de audiothread) exporteert geen WORKLET_FADE', !/WORKLET_FADE/.test(lees('src/engine/fx-worklet.js')));
const wieKopie = alleJs('src/ui').filter((p) => p !== 'src/ui/wie.js' && /const wie = \(t\) => \(t === /.test(lees(p)));
ok('geen eigen wie(t) meer in src/ui (alles via src/ui/wie.js)', wieKopie.length === 0, wieKopie.join(', '));
ok('src/lib/notatie.js en src/ui/wie.js importeren niets (de engine en apc.html laden ze)',
  !/^\s*import\b/m.test(lees('src/lib/notatie.js')) && !/^\s*import\b/m.test(lees('src/ui/wie.js')));

if (fails.length) { console.log(`\n${fails.length} FOUT:\n  ` + fails.join('\n  ')); process.exit(1); }
console.log('\nAlle checks groen.');
