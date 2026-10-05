// De drie regels uit CLAUDE.md, als test. Regel 1 is met een grep te bewaken;
// breekt iemand hem, dan is dit het eerste wat rood wordt.
// Draai met: node test/regels.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const engineMap = fileURLToPath(new URL('../src/engine/', import.meta.url));

console.log('regel 1: de engine kent geen MIDI, geen DOM en geen YouTube');
// Ook de instrumenten (src/engine/instrumenten/, docs/INSTRUMENTEN.md): een
// map dieper, dus `../../ui` is net zo goed verboden.
const engineBestanden = [...readdirSync(engineMap).filter((x) => x.endsWith('.js')),
  ...readdirSync(engineMap + 'instrumenten/').filter((x) => x.endsWith('.js')).map((x) => `instrumenten/${x}`)];
for (const f of engineBestanden) {
  const bron = readFileSync(engineMap + f, 'utf8');
  const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const fout = imports.filter((i) => /\/(ui|control|server|video|opname)\//.test(i) || /^(\.\.\/)+(ui|control)/.test(i));
  ok(`${f}: importeert alleen uit engine en lib`, fout.length === 0);
  // Ook geen DOM: document/window horen hier niet.
  const dom = /\b(document|window)\./.test(bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  ok(`${f}: raakt geen DOM aan`, !dom);
}

// De worklets draaien op de audiothread: daar is geen DOM, geen fetch en geen
// engine. Ze mogen alleen hun eigen pure kern importeren (stems, 3 okt: de
// streamworklet kreeg vier uitgangen, maar rekent nog steeds alleen met
// stream-kern.js).
console.log('\nworklets importeren alleen hun kern');
for (const [f, kern] of [['stream-lezer.js', './stream-kern.js'], ['klankschaal-worklet.js', './klankschaal-kern.js'], ['fx-worklet.js', './fx-kern.js']]) {
  const bron = readFileSync(engineMap + f, 'utf8');
  const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  ok(`${f}: importeert alleen ${kern}`, imports.length === 1 && imports[0] === kern);
}

// De opmaak van het spiegel-scherm is één keer per ongeluk meegewist met een
// ander CSS-blok (23 sep). Zonder deze regels staat alles onder elkaar.
console.log('\nopmaak van het hoofdscherm');
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const sel of ['.kolommen', '.kol', 'button.spg', '.baan']) ok(`styles.css heeft regels voor ${sel}`, css.includes(sel + '{') || css.includes(sel + ' {') || css.includes(sel + ','));
  // Laptopmaat (1440×790): het focusdeck mag niet onder zijn inhoud krimpen,
  // anders schuiven de kolommen over de banen. De fader krimpt in plaats daarvan.
  ok('het focusdeck houdt zijn hoogte (.deck.focus-deck{min-height:auto})', /\.deck\.focus-deck\{[^}]*min-height:auto/.test(css));
  // minmax(0,1fr): de rij mag lager worden dan de inhoud, anders schuift de onderkant
  // (de faders) achter de rand van het scherm in plaats van dat de fader krimpt (2 okt).
  ok('de kolommen krijgen de rest (grid-template-rows:auto minmax(0,1fr))', /main\{[^}]*grid-template-rows:auto minmax\(0,1fr\)/.test(css));
  ok('een kolom mag lager worden dan zijn inhoud (.kol{min-height:0})', /\.kol\{min-height:0\}/.test(css));
  ok('de kolomfader krimpt mee (.kol-onder flex)', /\.kol-onder\{[^}]*flex:1 1/.test(css));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
