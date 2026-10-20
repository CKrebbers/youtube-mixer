// De regels van src/koppel/ als test (de laag staat nog niet in MAG van test/regels.test.mjs):
// koppel/ leest alleen kern/ en zichzelf (de engine duck-typed, de analyse van buiten), raakt geen DOM,
// geen Web Audio en geen opslag; de zender is ONGEWIJZIGD die van de Stroommachine (herkomstregel), en het
// paneel in ui/ importeert niets uit koppel/ (alles via de koppeling die het krijgt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const imports = (pad) => [...readFileSync(join(SRC, pad), 'utf8').matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const zonderCommentaar = (pad) => readFileSync(join(SRC, pad), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const koppel = readdirSync(join(SRC, 'koppel')).filter((f) => f.endsWith('.js')).map((f) => join('koppel', f));

test('koppel/ importeert alleen uit kern/ en koppel/', () => {
  assert.ok(koppel.length >= 4, koppel.join(', '));
  for (const f of koppel) {
    for (const i of imports(f)) {
      assert.ok(i.startsWith('.'), `${f} importeert een pakket: ${i}`);
      const doel = join(dirname(f), i).split(/[\\/]/)[0];
      assert.ok(['kern', 'koppel'].includes(doel), `${f} importeert uit ${doel}: ${i}`);
    }
  }
});

test('koppel/ raakt geen DOM, geen Web Audio, geen opslag en maakt geen eigen audiotijd', () => {
  for (const f of koppel) {
    const tekst = zonderCommentaar(f);
    for (const woord of ['document.', 'window.', 'localStorage', 'navigator', 'AudioContext', 'createGain', 'createAnalyser',
      'requestAnimationFrame', 'fetch(', 'currentTime']) {
      assert.ok(!tekst.includes(woord), `${f} gebruikt ${woord}`);
    }
  }
});

test('niemand onder ui/ importeert al uit koppel/ (het paneel krijgt de koppeling mee), en geen laag onder ui', () => {
  for (const laag of ['kern', 'audio', 'engine', 'control', 'beeld', 'auto', 'ui']) {
    for (const f of readdirSync(join(SRC, laag), { recursive: true }).filter((x) => String(x).endsWith('.js'))) {
      const pad = join(laag, String(f));
      if (pad === join('ui', 'app.js')) continue;   // het instappunt mag het (na de integratie)
      for (const i of imports(pad)) assert.ok(!join(dirname(pad), i).startsWith('koppel'), `${pad} importeert uit koppel/: ${i}`);
    }
  }
});

test('de zender is die van de Stroommachine, ongewijzigd, met zijn herkomstregel', () => {
  const tekst = readFileSync(join(SRC, 'koppel', 'varve-beeld-zender.js'), 'utf8');
  const [eerste, ...rest] = tekst.split('\n');
  assert.match(eerste, /^\/\/ Herkomst: stroommachine@[0-9a-f]{7,} koppel\/varve-beeld-zender\.js \(ongewijzigd overgenomen/);
  const repo = process.env.VARVE_STROOM_REPO || [join(homedir(), 'Projects', 'stroommachine'), join(SRC, '..', '..', '..', '..', 'stroommachine')].find((p) => existsSync(p));
  const bron = repo && join(repo, 'koppel', 'varve-beeld-zender.js');
  if (!bron || !existsSync(bron)) { console.log('# geen Stroommachine-repo: alleen de herkomstregel nagelopen (zet VARVE_STROOM_REPO)'); return; }
  assert.equal(rest.join('\n'), readFileSync(bron, 'utf8'), `gelijk aan ${bron} (wijzig hem daar en neem hem opnieuw over)`);
});

test('elke macro- en regie-poort bestaat in de Stroommachine (src/09d-poorten.js en LIVE_MACROS in 09c-live.js daar)', async () => {
  const { MACROS, REGIE } = await import('../src/koppel/beeld.js');
  const repo = process.env.VARVE_STROOM_REPO || [join(homedir(), 'Projects', 'stroommachine'), join(SRC, '..', '..', '..', '..', 'stroommachine')].find((p) => existsSync(p));
  if (!repo || !existsSync(join(repo, 'src', '09d-poorten.js'))) { console.log('# geen Stroommachine-repo: poort-ids niet nagelopen'); return; }
  const poorten = readFileSync(join(repo, 'src', '09d-poorten.js'), 'utf8');
  const live = /const LIVE_MACROS = \[([\s\S]*?)\];/.exec(readFileSync(join(repo, 'src', '09c-live.js'), 'utf8'))?.[1] ?? '';
  const mist = [...MACROS, ...REGIE].filter((p) => !poorten.includes(`'${p}'`)
    && !(p.startsWith('macro.') && poorten.includes("knop('macro.' + m[0]") && live.includes(`['${p.slice(6)}',`)));
  assert.deepEqual(mist, []);
});
