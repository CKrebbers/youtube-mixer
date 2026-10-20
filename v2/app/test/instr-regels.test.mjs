// De laagregels van de instrumenten en het patroonrekenwerk als test (naast test/regels.test.mjs,
// die van een ander spoor is):
//   - src/kern/patronen/**, src/kern/smf.js, src/kern/patronen-smf.js: puur. Alleen imports uit
//     kern/, geen Web Audio, geen DOM, geen eigen tijd of toeval (een id komt uit de teller van de set).
//   - src/audio/instrumenten/**: geen DOM, geen import uit engine/, ui/ of control/ (alleen kern/
//     en audio/), nergens setValueCurveAtTime, een setTimeout alleen om op te ruimen (hooguit één).
//   - de kernen (schaal-kern, klankschaal-kern, stemming) en de worklet: geen Math.random (op de
//     audiothread: het eigen zaad), geen Web Audio; de worklet importeert alleen zijn kern.
//   - de engine schrijft geen MIDI-bestand (v1-regel: MThd/MTrk horen in kern/smf.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bestanden = (map) => readdirSync(join(SRC, map)).flatMap((f) => {
  const pad = join(map, f);
  if (statSync(join(SRC, pad)).isDirectory()) return bestanden(pad);
  return f.endsWith('.js') ? [pad] : [];
});
const bron = (f) => readFileSync(join(SRC, f), 'utf8');
const imports = (f) => [...bron(f).matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const code = (f) => bron(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const laagVan = (f, i) => join(dirname(f), i).split(/[\\/]/)[0];

const PUUR = [...bestanden('kern/patronen'), 'kern/smf.js', 'kern/patronen-smf.js'];
const INSTR = bestanden('audio/instrumenten');

test('het patroonrekenwerk is puur: alleen kern/, geen Web Audio, geen DOM, geen eigen tijd of toeval', () => {
  assert.ok(PUUR.length >= 4 && PUUR.includes('kern/patronen/model.js') && PUUR.includes('kern/patronen/venster.js'));
  for (const f of PUUR) {
    for (const i of imports(f)) {
      assert.ok(i.startsWith('.'), `${f} importeert een pakket: ${i}`);
      assert.equal(laagVan(f, i), 'kern', `${f} importeert ${i}`);
    }
    const t = code(f);
    for (const w of ['AudioContext', 'AudioWorklet', 'AudioParam', 'createGain', 'currentTime', 'document.', 'window.',
      'requestAnimationFrame', 'Date.now', 'performance.now', 'setTimeout', 'setInterval', 'Math.random', 'fetch(']) {
      assert.ok(!t.includes(w), `${f} gebruikt ${w}`);
    }
  }
});

test('de instrumenten: geen DOM, alleen kern/ en audio/, geen setValueCurveAtTime, setTimeout alleen om op te ruimen', () => {
  for (const f of ['index.js', 'poly.js', 'fm.js', 'drums.js', 'schaal.js', 'schaal-kern.js', 'klankschaal-kern.js', 'schaal-worklet.js', 'stemming.js', 'hulp.js']) {
    assert.ok(INSTR.includes(join('audio/instrumenten', f)), `${f} bestaat`);
  }
  for (const f of INSTR) {
    for (const i of imports(f)) {
      assert.ok(i.startsWith('.'), `${f} importeert een pakket: ${i}`);
      assert.ok(['kern', 'audio'].includes(laagVan(f, i)), `${f} importeert ${i}`);
      assert.ok(!/\/(engine|ui|control|beeld)\//.test(join(dirname(f), i)), `${f} importeert ${i}`);
    }
    const t = code(f);
    for (const w of ['document.', 'window.', 'requestAnimationFrame', 'localStorage', 'setValueCurveAtTime', 'setInterval', 'Date.now']) {
      assert.ok(!t.includes(w), `${f} gebruikt ${w}`);
    }
    assert.ok((t.match(/setTimeout/g) || []).length <= 1, `${f}: hooguit één setTimeout (opruimen)`);
  }
});

test('de kernen en de worklet: geen Math.random, geen Web Audio; de worklet kent alleen zijn kern', () => {
  for (const f of ['schaal-kern.js', 'klankschaal-kern.js', 'stemming.js', 'schaal-worklet.js']) {
    const t = code(join('audio/instrumenten', f));
    assert.ok(!/Math\.random/.test(t), `${f}: Math.random`);
    for (const w of ['AudioContext', 'createGain', 'document.', 'window.']) assert.ok(!t.includes(w), `${f}: ${w}`);
  }
  assert.deepEqual(imports('audio/instrumenten/schaal-worklet.js'), ['./schaal-kern.js']);
  assert.deepEqual(imports('audio/instrumenten/schaal-kern.js'), ['./klankschaal-kern.js']);
  assert.deepEqual(imports('audio/instrumenten/klankschaal-kern.js'), []);
  assert.deepEqual(imports('audio/instrumenten/stemming.js'), []);
  // Het hoofdthread-toeval van de Klankschaal komt uit een zaad (een set opnieuw renderen klinkt hetzelfde).
  assert.ok(!/Math\.random/.test(code('audio/instrumenten/schaal.js')));
});

test('de engine schrijft geen MIDI-bestand (dat doet kern/smf.js)', () => {
  if (!existsSync(join(SRC, 'engine'))) return;
  for (const f of bestanden('engine')) {
    const t = code(f);
    assert.ok(!/MThd|MTrk/.test(t), `${f} schrijft MIDI-bytes`);
  }
});
