// De lagen van ARCHITECTUUR.md als test: kern ← audio ← engine ← ui, nooit omgekeerd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bestanden = (map) => readdirSync(join(SRC, map)).filter((f) => f.endsWith('.js')).map((f) => join(map, f));
const imports = (pad) => [...readFileSync(join(SRC, pad), 'utf8').matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const MAG = {
  kern: ['kern'],
  audio: ['kern', 'audio'],
  engine: ['kern', 'audio', 'engine'],
  ui: ['kern', 'audio', 'engine', 'ui'],
};

for (const [laag, mag] of Object.entries(MAG)) {
  test(`laag ${laag} importeert alleen uit ${mag.join(', ')}`, () => {
    for (const f of bestanden(laag)) {
      for (const i of imports(f)) {
        if (!i.startsWith('.')) { assert.fail(`${f} importeert een pakket: ${i}`); }
        const doel = join(dirname(f), i).split(/[\\/]/)[0];
        assert.ok(mag.includes(doel), `${f} importeert uit ${doel}: ${i}`);
      }
    }
  });
}

test('kern en engine raken geen DOM en geen Web Audio aan', () => {
  for (const f of [...bestanden('kern'), ...bestanden('engine')]) {
    const tekst = readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const woord of ['document.', 'window.', 'AudioContext', 'createGain', 'requestAnimationFrame']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});

test('de kern maakt geen eigen tijd (regel 2: positie van de audioklok)', () => {
  for (const f of bestanden('kern')) {
    const tekst = readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const woord of ['Date.now', 'performance.now', 'setInterval', 'setTimeout', 'Math.random']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});
