// De grenzen van de companion (companion.html, docs/COMPANION.md §grenzen) als
// test. Eén VARVE-tabblad praat met de APC (Web Lock 'varve-mixer'); de
// companion op iPad en iPhone mag de mixer daarom nooit storen: geen
// AudioContext, geen MIDI, geen Web Lock, alleen fetch naar de server.
//
// De bewaker volgt de HELE importboom vanaf het script in companion.html (ook
// wat kaart-lijst.js zelf weer importeert) en past de regels op elk bestand toe,
// met het commentaar eruit. Hij drukt de boom af, zodat een PR hem kan tonen.
// Draai met: node test/regels-companion.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const rel = (p) => relative(WORTEL, p);

/**
 * Commentaar eruit, strings en regex-literals blijven staan (een '//' in
 * 'https://…' is geen commentaar). Genoeg voor onze eigen code: geen
 * geneste ${} met strings erin die op een commentaar lijken.
 */
export function zonderCommentaar(bron) {
  let uit = '', i = 0, vorig = '';
  const n = bron.length;
  while (i < n) {
    const c = bron[i], d = bron[i + 1];
    if (c === '/' && d === '/') { while (i < n && bron[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = bron.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; uit += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && bron[j] !== c) j += bron[j] === '\\' ? 2 : 1;
      uit += bron.slice(i, j + 1); i = j + 1; vorig = c; continue;
    }
    // Een regex-literal: een '/' waar een waarde mag beginnen.
    if (c === '/' && (vorig === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(vorig) || /\b(return|typeof|case)$/.test(uit.trimEnd()))) {
      let j = i + 1, klasse = false;
      while (j < n && (klasse || bron[j] !== '/') && bron[j] !== '\n') {
        if (bron[j] === '\\') j++;
        else if (bron[j] === '[') klasse = true;
        else if (bron[j] === ']') klasse = false;
        j++;
      }
      uit += bron.slice(i, j + 1); i = j + 1; vorig = 'x'; continue;
    }
    uit += c;
    if (!/\s/.test(c)) vorig = c;
    i++;
  }
  return uit;
}

/** De statische imports en re-exports van een bestand (relatieve paden). */
const importsVan = (code) => [...code.matchAll(/^\s*(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2]);

// ---- de pagina ------------------------------------------------------------------------
console.log('companion.html');
const html = readFileSync(join(WORTEL, 'companion.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attr: m[1], inhoud: m[2] }));
const modules = scripts.filter((s) => /type="module"/.test(s.attr));
ok('precies één module-script, en dat is /src/companion/companion.js',
  modules.length === 1 && /src="\/src\/companion\/companion\.js"/.test(modules[0].attr) && !modules[0].inhoud.trim());
const inline = scripts.filter((s) => !/\bsrc=/.test(s.attr));
ok('het enige inline script is de voorproef voor te oude apparaten (iOS 15.4), zonder import of fetch',
  inline.length === 1 && /iOS 15\.4/.test(inline[0].inhoud) && !/import|fetch|AudioContext|MIDI|locks/.test(inline[0].inhoud));
ok('de pagina laadt niets van de mixer (geen app.js, styles.css of control/)', !/src\/ui\/app\.js|styles\.css|src\/control\//.test(html));

// ---- de boom ------------------------------------------------------------------------------
console.log('\nde importboom vanaf src/companion/companion.js');
const begin = join(WORTEL, 'src/companion/companion.js');
const boom = new Map();      // pad -> { code, imports: [pad] }
const stapel = [begin];
let kapot = [];
while (stapel.length) {
  const pad = stapel.pop();
  if (boom.has(pad)) continue;
  if (!existsSync(pad)) { kapot.push(rel(pad)); continue; }
  const code = zonderCommentaar(readFileSync(pad, 'utf8'));
  const imps = importsVan(code);
  const opgelost = imps.filter((i) => i.startsWith('.')).map((i) => resolve(dirname(pad), i));
  boom.set(pad, { code, imports: opgelost, kaal: imps.filter((i) => !i.startsWith('.')) });
  stapel.push(...opgelost);
}
const paden = [...boom.keys()].map(rel).sort();
console.log(paden.map((p) => `        ${p}`).join('\n'));
ok(`de boom is compleet (${paden.length} bestanden, geen ontbrekend bestand)`, kapot.length === 0);
ok('alleen relatieve imports (geen pakketten of URL\'s)', [...boom.values()].every((b) => b.kaal.length === 0));
ok('geen dynamische import() in de boom (dan zou de bewaker hem niet zien)', [...boom.values()].every((b) => !/\bimport\s*\(/.test(b.code)));
ok('niets uit src/control/, src/koppel/, src/video/, src/opname/, src/auto/ of server/',
  paden.every((p) => !/^(src\/(control|koppel|video|opname|auto|analysis|vormen|plan)\/|server\/)/.test(p)));
ok('uit de engine alleen het pure rekenwerk (beatgrid.js, toonsoort.js)',
  paden.filter((p) => p.startsWith('src/engine/')).every((p) => ['src/engine/beatgrid.js', 'src/engine/toonsoort.js'].includes(p)));
const eigen = paden.filter((p) => p.startsWith('src/companion/'));
const directs = new Set(eigen.flatMap((p) => boom.get(join(WORTEL, p)).imports.map(rel)));
ok(`src/companion/ importeert direct alleen uit zichzelf, ui/kaart-lijst.js en ui/dom.js (${[...directs].sort().join(', ')})`,
  [...directs].every((p) => p.startsWith('src/companion/') || p === 'src/ui/kaart-lijst.js' || p === 'src/ui/dom.js'));

// ---- de regels op elk bestand ---------------------------------------------------------------
console.log('\ngeen geluid, geen MIDI, geen tabblad-slot (elk bestand in de boom, commentaar eruit)');
const VERBODEN = [
  ['AudioContext', /\bnew\s+(webkit)?(Offline)?AudioContext\b|\b(webkit)?AudioContext\s*\(/],
  ['requestMIDIAccess', /requestMIDIAccess\s*\(/],
  ['Web Lock', /\blocks\s*\.\s*request\s*\(/],
  ['BroadcastChannel (het kanaal van de mixer)', /\bnew\s+BroadcastChannel\b/],
  ['window.opener (een venster van de mixer)', /\bopener\b/],
];
for (const [naam, re] of VERBODEN) {
  const raak = [...boom].filter(([, b]) => re.test(b.code)).map(([p]) => rel(p));
  ok(`${naam}: nergens${raak.length ? ` (wel in ${raak.join(', ')})` : ''}`, raak.length === 0);
}

// ---- wat de companion naar de server stuurt -------------------------------------------------------
console.log('\nwat de companion naar de server stuurt');
const eigenCode = eigen.map((p) => boom.get(join(WORTEL, p)).code).join('\n');
const paadjes = [...eigenCode.matchAll(/(['"`])(\/[a-z][^'"`\s]*)\1/g)].map((m) => m[2]);
const vreemd = paadjes.filter((p) => !p.startsWith('/api/') && p !== '/mappings/companion.json');
ok(`alleen /api/… en /mappings/companion.json (${[...new Set(paadjes.map((p) => p.replace(/\$\{.*$/, '…')))].sort().join(' ')})`, vreemd.length === 0);
ok('nooit "meteen" of "bevestig" (de laptop haalt binnen, niet de telefoon)', !/\b(meteen|bevestig)\b/.test(eigenCode));
ok('nooit zoeken op YouTube (/zoek) en nooit iets weghalen (DELETE)', !/\/zoek\b/.test(eigenCode) && !/['"]DELETE['"]/.test(eigenCode));
ok('haal nu alleen via POST /api/nacht/nu (de server weigert zelf op een speeldag)', /['"]\/api\/nacht\/nu['"]/.test(eigenCode) && !/\/api\/ingest/.test(eigenCode));
// Review ronde 1, fix 1: "haal de wenslijst nu op" mag geen nummers buiten de wenslijst halen.
const naarNacht = [...eigenCode.matchAll(/['"]\/api\/nacht\/nu['"]\s*,\s*([^)]*\))/g)].map((m) => m[1]);
ok(`haal nu stuurt altijd alleenWensen: true (${naarNacht.length}× via L.haalNuBody, en die zet de vlag)`, naarNacht.length >= 1
  && naarNacht.every((a) => /^L\.haalNuBody\(/.test(a)) && /haalNuBody\s*=\s*\([^)]*\)\s*=>\s*\(\{[^}]*alleenWensen:\s*true/.test(eigenCode));
ok('geen POST /api/mixer in v1 (de companion stuurt de mixer niets)', !/\/api\/mixer['"`]\s*,\s*\{[^}]*method/.test(eigenCode) && !/post\(\s*['"]\/api\/mixer/.test(eigenCode));

// ---- de stripper zelf --------------------------------------------------------------------------------
console.log('\nde commentaarstripper');
ok('een // in een string blijft staan', zonderCommentaar("const u = 'https://x'; // weg").includes("'https://x'") && !zonderCommentaar("a; // weg").includes('weg'));
ok('blokcommentaar weg, een regex met // erin blijft', !zonderCommentaar('/* new AudioContext() */ x').includes('AudioContext')
  && zonderCommentaar('const r = /\\/\\//g; y').includes('y'));
ok('een verboden aanroep in commentaar telt niet, in code wel',
  !VERBODEN[1][1].test(zonderCommentaar('// navigator.requestMIDIAccess()')) && VERBODEN[1][1].test(zonderCommentaar('navigator.requestMIDIAccess({})')));

if (fails.length) { console.log(`\n${fails.length} FOUT(EN)`); process.exit(1); }
console.log('\nalles groen');
