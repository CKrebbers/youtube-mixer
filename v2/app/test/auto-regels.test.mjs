// De laag van de auto-DJ (src/auto/): leest alleen kern/ en zichzelf, raakt geen DOM en geen
// Web Audio, en maakt geen eigen tijd (de positie komt van de audioklok; een timer komt van
// buiten, `tijd`). De acties (engine/acties-auto.js) importeren de automaat niet: de app geeft hem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tekst = (f) => readFileSync(join(SRC, f), 'utf8');
const imports = (f) => [...tekst(f).matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const zonderCommentaar = (f) => tekst(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const auto = readdirSync(join(SRC, 'auto')).filter((f) => f.endsWith('.js')).map((f) => join('auto', f));

test('auto-regels: src/auto importeert alleen uit kern/ en auto/', () => {
  assert.ok(auto.length >= 2);
  for (const f of auto) {
    for (const i of imports(f)) {
      const doel = join(dirname(f), i).split(/[\\/]/)[0];
      assert.ok(['kern', 'auto'].includes(doel), `${f} importeert uit ${doel}: ${i}`);
    }
  }
});

test('auto-regels: geen DOM, geen Web Audio, geen eigen klok', () => {
  for (const f of auto) {
    const t = zonderCommentaar(f);
    for (const woord of ['document.', 'window.', 'AudioContext', 'createGain', 'requestAnimationFrame', 'Date.now', 'performance.now', 'localStorage', 'fetch(']) {
      assert.ok(!t.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
  // De planner is puur: ook geen timer en geen toeval van zichzelf (rnd komt mee).
  const p = zonderCommentaar('auto/planner.js');
  for (const woord of ['setInterval', 'setTimeout']) assert.ok(!p.includes(woord), `planner gebruikt ${woord}`);
});

test('auto-regels: de acties van de auto-DJ importeren niets (de automaat komt van buiten)', () => {
  assert.deepEqual(imports('engine/acties-auto.js'), []);
});
