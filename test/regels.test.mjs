// De drie regels uit CLAUDE.md, als test. Regel 1 is met een grep te bewaken;
// breekt iemand hem, dan is dit het eerste wat rood wordt.
// Draai met: node test/regels.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const engineMap = fileURLToPath(new URL('../src/engine/', import.meta.url));

console.log('regel 1: de engine kent geen MIDI, geen DOM en geen YouTube');
// Ook de instrumenten (src/engine/instrumenten/, docs/INSTRUMENTEN.md) en de
// patronen (src/engine/patronen/, docs/PATRONEN.md): een map dieper, dus
// `../../ui` is net zo goed verboden.
const engineBestanden = [...readdirSync(engineMap).filter((x) => x.endsWith('.js')),
  ...readdirSync(engineMap + 'instrumenten/').filter((x) => x.endsWith('.js')).map((x) => `instrumenten/${x}`),
  ...readdirSync(engineMap + 'patronen/').filter((x) => x.endsWith('.js')).map((x) => `patronen/${x}`)];
for (const f of engineBestanden) {
  const bron = readFileSync(engineMap + f, 'utf8');
  const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const fout = imports.filter((i) => /\/(ui|control|server|video|opname)\//.test(i) || /^(\.\.\/)+(ui|control)/.test(i));
  ok(`${f}: importeert alleen uit engine en lib`, fout.length === 0);
  // Ook geen DOM: document/window horen hier niet.
  const dom = /\b(document|window)\./.test(bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  ok(`${f}: raakt geen DOM aan`, !dom);
}
// Patronen naar Logic (docs/PATRONEN.md §8): MIDI-BESTANDEN maken gebeurt buiten de engine,
// in src/export/ met de bytes-laag src/lib/smf.js. Geen bestand in de engine schrijft
// MIDI-bytes: geen 'MThd', geen 'MTrk', geen noot-aan op kanaal 10 (0x99).
ok('geen bestand onder src/engine/ bevat MThd, MTrk of 0x99 (MIDI-bestanden staan in src/export/)',
  engineBestanden.every((f) => !/MThd|MTrk|0x99/.test(readFileSync(engineMap + f, 'utf8'))));
{
  const exportMap = fileURLToPath(new URL('../src/export/', import.meta.url));
  for (const f of readdirSync(exportMap).filter((x) => x.endsWith('.js'))) {
    const bron = readFileSync(exportMap + f, 'utf8');
    const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    ok(`export/${f}: importeert alleen uit engine en lib, raakt geen DOM aan`,
      imports.every((i) => /^\.\.\/(engine|lib)\//.test(i)) && !/\b(document|window)\./.test(bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  }
  const smf = readFileSync(fileURLToPath(new URL('../src/lib/smf.js', import.meta.url)), 'utf8');
  ok('lib/smf.js: geen imports, geen Buffer, geen DOM (draait in browser, server en test)',
    !/^\s*import\s/m.test(smf) && !/\bBuffer\b|\b(document|window)\./.test(smf.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
}

// De koppeling met de Stroommachine (spoor beeld, docs/BEELD.md) staat buiten
// de engine en buiten het scherm: ze leest de engine alleen en kent geen DOM, zodat
// ze zonder browser te testen is (test/beeld.test.mjs).
console.log('\nsrc/koppel: geen scherm, geen MIDI, geen DOM');
{
  const map = fileURLToPath(new URL('../src/koppel/', import.meta.url));
  for (const f of readdirSync(map).filter((x) => x.endsWith('.js'))) {
    const bron = readFileSync(map + f, 'utf8');
    const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    ok(`koppel/${f}: importeert niets uit ui, control, server of video`, !imports.some((i) => /(^|\/)(ui|control|server|video|opname)\//.test(i)));
    ok(`koppel/${f}: raakt geen DOM aan`, !/\b(document|window)\./.test(bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  }
}

// De worklets draaien op de audiothread: daar is geen DOM, geen fetch en geen
// engine. Ze mogen alleen hun eigen pure kern importeren (stems, 3 okt: de
// streamworklet kreeg vier uitgangen, maar rekent nog steeds alleen met
// stream-kern.js).
console.log('\nworklets importeren alleen hun kern');
// Keylock (5 okt, docs/KEYLOCK.md): de streamworklet rekent ook met het rekpad
// (rek-kern.js, zelf alleen op stream-kern.js) en de gevendorde Signalsmith-
// fabriek (WASM, geen imports): allebei gemaakt voor de audiothread.
for (const [f, kernen] of [['stream-lezer.js', ['./stream-kern.js', './rek-kern.js', './vendor/signalsmith-stretch.js']],
  ['rek-kern.js', ['./stream-kern.js']], ['klankschaal-worklet.js', ['./klankschaal-kern.js']], ['fx-worklet.js', ['./fx-kern.js']]]) {
  const bron = readFileSync(engineMap + f, 'utf8');
  const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  ok(`${f}: importeert alleen ${kernen.join(', ')}`, imports.join() === kernen.join());
}
{
  const bron = readFileSync(engineMap + 'vendor/signalsmith-stretch.js', 'utf8');
  ok('vendor/signalsmith-stretch.js: geen imports, de MIT-licentie bovenin, gemaakt met tools/keylock/vendor.mjs',
    !/^\s*import\s/m.test(bron) && /MIT License[\s\S]*Copyright \(c\) 2022 Geraint Luff/.test(bron.slice(0, 3000)) && /tools\/keylock\/vendor\.mjs/.test(bron.slice(0, 600)));
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
  // Met alleen een trackpad zweeft de schuifbalk van macOS over de rijen (±15 px van de rand):
  // de rechterrand van VOL in de klankschaal lag eronder (7 okt, tools/headless/rijen.mjs).
  ok('het rij-gebied houdt rechts 8 px vrij voor een zwevende schuifbalk', /\.rijen\{[^}]*padding-right:8px/.test(css));
  ok('een kolom mag lager worden dan zijn inhoud (.kol{min-height:0})', /\.kol\{min-height:0\}/.test(css));
  ok('de kolomfader krimpt mee (.kol-onder flex)', /\.kol-onder\{[^}]*flex:1 1/.test(css));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
