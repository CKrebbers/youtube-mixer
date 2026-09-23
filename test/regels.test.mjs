// De drie regels uit CLAUDE.md, als test. Regel 1 is met een grep te bewaken;
// breekt iemand hem, dan is dit het eerste wat rood wordt.
// Draai met: node test/regels.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const engineMap = fileURLToPath(new URL('../src/engine/', import.meta.url));

console.log('regel 1: de engine kent geen MIDI, geen DOM en geen YouTube');
for (const f of readdirSync(engineMap).filter((x) => x.endsWith('.js'))) {
  const bron = readFileSync(engineMap + f, 'utf8');
  const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const fout = imports.filter((i) => /\/(ui|control|server|video|opname)\//.test(i) || i.startsWith('../ui') || i.startsWith('../control'));
  ok(`${f}: importeert alleen uit engine en lib`, fout.length === 0);
  // Ook geen DOM: document/window horen hier niet.
  const dom = /\b(document|window)\./.test(bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  ok(`${f}: raakt geen DOM aan`, !dom);
}

// De opmaak van het spiegel-scherm is één keer per ongeluk meegewist met een
// ander CSS-blok (23 sep). Zonder deze regels staat alles onder elkaar.
console.log('\nopmaak van het hoofdscherm');
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const sel of ['.kolommen', '.kol', 'button.spg', '.baan']) ok(`styles.css heeft regels voor ${sel}`, css.includes(sel + '{') || css.includes(sel + ' {') || css.includes(sel + ','));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
