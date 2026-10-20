// De lagen van ARCHITECTUUR.md als test: kern ← audio ← engine ← ui, nooit omgekeerd.
// control/ (plak 3) leest alleen kern/ en zichzelf: geen audio, engine, ui of DOM;
// beeld/ (plak 4) leest alleen kern/ en zichzelf (de engine duck-typed), geen audio/;
// Web MIDI, navigator.locks en het venster komen van buiten (src/ui/controllers.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
/** Alle .js-bestanden in een laag, ook in submappen (control/apparaten/). */
const bestanden = (map) => readdirSync(join(SRC, map)).flatMap((f) => {
  const pad = join(map, f);
  if (statSync(join(SRC, pad)).isDirectory()) return bestanden(pad);
  return f.endsWith('.js') ? [pad] : [];
});
const imports = (pad) => [...readFileSync(join(SRC, pad), 'utf8').matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const zonderCommentaar = (f) => readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const MAG = {
  kern: ['kern'],
  audio: ['kern', 'audio'],
  engine: ['kern', 'audio', 'engine'],
  control: ['kern', 'control'],
  // beeld/ (plak 4) is een schermlaag naast ui: mag kern/ lezen en DOM/WebGL gebruiken, maar niet
  // audio/ (geen Web Audio-nodes maken of aanraken) en niet de binnenkant van de engine: die LEEST het
  // duck-typed via wat de opzet meegeeft. Engine, audio, kern en control importeren nooit uit beeld/.
  beeld: ['kern', 'beeld'],
  // auto/ (plak 6): de auto-DJ is een extra BRON van acties op de bus (zoals een controller): hij
  // leest de engine duck-typed en raakt geen audio, DOM of eigen klok (test/auto-regels.test.mjs).
  auto: ['kern', 'auto'],
  ui: ['kern', 'audio', 'engine', 'control', 'beeld', 'auto', 'ui'],
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
    const tekst = zonderCommentaar(f);
    for (const woord of ['document.', 'window.', 'AudioContext', 'createGain', 'requestAnimationFrame']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});

test('control raakt geen DOM, geen Web Audio en vraagt zelf geen MIDI of lock (alles komt van buiten)', () => {
  const lijst = bestanden('control');
  assert.ok(lijst.some((f) => f.includes('apparaten')), 'de submap apparaten/ wordt meegeteld');
  for (const f of lijst) {
    const tekst = zonderCommentaar(f);
    for (const woord of ['document.', 'window.', 'navigator', 'requestMIDIAccess', 'AudioContext', 'requestAnimationFrame', 'localStorage', 'fetch(']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});

test('de kern maakt geen eigen tijd (regel 2: positie van de audioklok)', () => {
  for (const f of bestanden('kern')) {
    const tekst = zonderCommentaar(f);
    for (const woord of ['Date.now', 'performance.now', 'setInterval', 'setTimeout', 'Math.random']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});

test('de effectlaag (audio/fx/) raakt geen DOM, maakt geen eigen tijd en geen toeval (zaad: modulatie.js)', () => {
  const lijst = bestanden('audio').filter((f) => f.includes('fx'));
  assert.ok(lijst.some((f) => f.endsWith('fx.js')), 'de submap audio/fx/ wordt meegeteld');
  for (const f of lijst) {
    const tekst = zonderCommentaar(f);
    for (const woord of ['document.', 'window.', 'requestAnimationFrame', 'localStorage', 'Math.random', 'performance.now', 'Date.now']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
  // De worklet van de effecten kent alleen zijn rekenkern (hij draait op de audiothread).
  assert.deepEqual(imports('audio/fx/fx-worklet.js'), ['./fx-kern.js']);
  assert.deepEqual(imports('audio/fx/fx-kern.js'), []);
});

test('niemand onder ui importeert uit beeld/, en beeld maakt geen Web Audio-nodes', () => {
  for (const laag of ['kern', 'audio', 'engine', 'control']) {
    for (const f of bestanden(laag)) {
      for (const i of imports(f)) assert.ok(!join(dirname(f), i).startsWith('beeld'), `${f} importeert uit beeld/: ${i}`);
    }
  }
  const lijst = bestanden('beeld');
  assert.ok(lijst.some((f) => f.includes('vormen')) && lijst.some((f) => f.includes('analyse')), 'de submappen van beeld/ worden meegeteld');
  // Uitzondering: de isomorfe vormen (sn, tv, ep, dw) kunnen geluid maken achter g.geluid (v1, oogst
  // beeld-055: open vraag). In v2 krijgt een laag NOOIT g.geluid (laag.js noemt het niet), dus ze zijn stil.
  assert.ok(!/geluid/.test(zonderCommentaar('beeld/vormen/laag.js')), 'laag.js geeft een vorm geen g.geluid');
  for (const f of lijst.filter((x) => !x.endsWith('systemen-isomorf.js'))) {
    const tekst = zonderCommentaar(f);
    for (const woord of ['new AudioContext', 'createGain', 'createAnalyser', 'createBufferSource', 'audioWorklet']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});

test('de vormsystemen kennen geen DOM, geen eigen klok en geen Math.random (beeld-044)', () => {
  const lijst = bestanden('beeld/vormen').filter((f) => /\/(hulp|systemen[\w-]*)\.js$/.test(f));
  assert.ok(lijst.length >= 5, `hulp.js en de systemen gevonden (${lijst.length})`);
  for (const f of lijst) {
    const tekst = zonderCommentaar(f);
    for (const re of [/\bdocument\b/, /\bwindow\b/, /performance\.now/, /Math\.random/, /Path2D/, /^\s*import[^'"]*['"](?!\.\/)/m]) {
      assert.ok(!re.test(tekst), `${f} breekt de regel ${re}`);
    }
  }
});
