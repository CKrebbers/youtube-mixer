// De grenzen van de schermen (werkruimte S7, docs/werkruimte/S7.md, WERKRUIMTE.md C3/C4) als test,
// zoals regels-companion.test.mjs voor de companion:
//   - werk.html en uitlijn.html: de HELE importboom (ook wat geïmporteerd wordt importeert) zonder
//     de engine (alleen het pure rekenwerk), zonder AudioContext, requestMIDIAccess of Web Lock;
//   - de iPad schrijft alleen via de schrijfweg (S8, W1 = ja): alleen schrijver.js POST, en alleen naar
//     invoke en koppel; elke schrijvende route op de server is vanDezeMac of vanBuiten (schakelaar, Origin, token);
//   - de mixer laadt src/paneel/ niet: niet statisch (de boom vanaf app.js en de aanhakers), en
//     de aanhaker schermen laadt het pas met een werkruimte (niet `standaard`).
// Draai met: node test/regels-werk.test.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const rel = (p) => relative(WORTEL, p);

/** Commentaar eruit (strings en regex-literals blijven), zoals in regels-companion.test.mjs. */
function zonderCommentaar(bron) {
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
const importsVan = (code) => [...code.matchAll(/^\s*(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2]);

/** De statische importboom vanaf `begin` (absolute paden). */
function boomVan(begin) {
  const boom = new Map();
  const stapel = [begin];
  const kapot = [];
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
  return { boom, kapot };
}

const VERBODEN = [
  ['AudioContext', /\bnew\s+(webkit)?(Offline)?AudioContext\b|\b(webkit)?AudioContext\s*\(/],
  ['requestMIDIAccess', /requestMIDIAccess\s*\(/],
  ['Web Lock', /\blocks\s*\.\s*request\s*\(/],
  ['dynamische import() (dan ziet de bewaker hem niet)', /\bimport\s*\(/],
];
/** Uit de engine alleen het pure rekenwerk (geen Engine, geen deck, geen Web Audio). */
// toonsoort.js (S11): de ToonKaart voor de zoekregel (toon:8A) via src/library/indeling.js; puur, geen imports.
const ENGINE_PUUR = ['src/engine/stream-kern.js', 'src/engine/beatgrid.js', 'src/engine/tellen.js', 'src/engine/hoorbaar.js', 'src/engine/toonsoort.js'];
/** Uit control alleen wat puur is (resolveTarget en de kleuren van het palet). */
const CONTROL_PUUR = ['src/control/mapping.js', 'src/control/houd.js', 'src/control/devices/apc40mk2.js'];

for (const [pagina, script] of [['werk.html', 'src/paneel/paneel.js'], ['uitlijn.html', 'src/uitlijn/venster.js']]) {
  console.log(`\n${pagina}`);
  const html = readFileSync(join(WORTEL, pagina), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attr: m[1], inhoud: m[2] }));
  ok(`precies één script, een module: ${script}`, scripts.length === 1 && /type="module"/.test(scripts[0].attr)
    && new RegExp(`src="/?${script.replace(/[./]/g, (c) => `\\${c}`)}"`).test(scripts[0].attr) && !scripts[0].inhoud.trim());
  ok('de pagina laadt niets van de mixer (geen app.js, geen control/)', !/src\/ui\/app\.js|src\/control\//.test(html));
  const { boom, kapot } = boomVan(join(WORTEL, script));
  const paden = [...boom.keys()].map(rel).sort();
  console.log(paden.map((p) => `        ${p}`).join('\n'));
  ok(`de boom is compleet (${paden.length} bestanden)`, kapot.length === 0);
  ok('alleen relatieve imports', [...boom.values()].every((b) => b.kaal.length === 0));
  const engine = paden.filter((p) => p.startsWith('src/engine/'));
  ok(`uit de engine alleen het pure rekenwerk (${engine.join(', ')})`, engine.every((p) => ENGINE_PUUR.includes(p)));
  ok('niet de engine zelf (engine.js, deck.js, bron.js, audio-graph.js)', !paden.some((p) => /src\/engine\/(engine|deck|bron|audio-graph|fx|master)\.js$/.test(p)));
  const control = paden.filter((p) => p.startsWith('src/control/'));
  ok(`uit control alleen het pure (${control.join(', ') || 'niets'})`, control.every((p) => CONTROL_PUUR.includes(p)));
  ok('niets uit server/, koppel/, video/, opname/, auto/, en niet de bus (actions.js)', paden.every((p) => !/^(server\/|src\/(koppel|video|opname|auto)\/)/.test(p) && p !== 'src/control/actions.js'));
  for (const [naam, re] of VERBODEN) {
    const raak = [...boom].filter(([, b]) => re.test(b.code)).map(([p]) => rel(p));
    ok(`${naam}: nergens${raak.length ? ` (wel in ${raak.join(', ')})` : ''}`, raak.length === 0);
  }
}

// ---- de iPad schrijft alleen via de schrijfweg (S8, W1 = ja) --------------------------------------
console.log('\nde iPad schrijft alleen via de schrijfweg (S8)');
{
  const map = join(WORTEL, 'src/paneel');
  const bestanden = readdirSync(map).filter((f) => f.endsWith('.js'));
  ok('src/paneel/: protocol, verbinding, paneel, vrij, kaart, schrijver, uitvoer', ['protocol.js', 'verbinding.js', 'paneel.js', 'vrij.js', 'kaart.js', 'schrijver.js', 'uitvoer.js'].every((f) => bestanden.includes(f)));
  const code = Object.fromEntries(bestanden.map((f) => [f, zonderCommentaar(readFileSync(join(map, f), 'utf8'))]));
  const schrijvend = bestanden.filter((f) => /['"`](POST|PUT|PATCH|DELETE)['"`]|method\s*:/.test(code[f]) || /sendBeacon|new\s+WebSocket|XMLHttpRequest/.test(code[f]));
  ok(`alleen schrijver.js doet een POST (geen PUT/PATCH/DELETE, geen sendBeacon/WebSocket/XHR)${schrijvend.length ? ` (POST in ${schrijvend.join(', ')})` : ''}`,
    schrijvend.join() === 'schrijver.js' && !/['"`](PUT|PATCH|DELETE)['"`]|sendBeacon|new\s+WebSocket|XMLHttpRequest/.test(code['schrijver.js']));
  const paden = bestanden.flatMap((f) => [...code[f].matchAll(/(['"`])(\/api\/[^'"`?$]*)/g)].map((m) => [f, m[2]]));
  // /api/set/live (S9): de live-stand van de set voor het vak plan/sets, alleen GET.
  // /api/indeling/stand (S11): de categorieën en tags voor het vak library, alleen GET.
  const LEZEN = ['/api/paneel/ping', '/api/paneel/live', '/api/library', '/api/paneel/wie', '/api/set/live', '/api/indeling/stand'];
  const SCHRIJVEN = ['/api/paneel/invoke', '/api/paneel/koppel'];
  ok(`lezen: ping, live, library, wie; schrijven alleen invoke en koppel, en alleen in schrijver.js (${[...new Set(paden.map((x) => x[1]))].sort().join(' ')})`,
    paden.every(([f, p]) => LEZEN.includes(p) || (SCHRIJVEN.includes(p) && f === 'schrijver.js')));
  ok('uitvoer.js (de beslissing van de mixer) importeert alleen het pure model', [...code['uitvoer.js'].matchAll(/from '([^']+)'/g)].map((m) => m[1]).join() === '../werk/model.js');
  const sv = code['verbinding.js'].slice(code['verbinding.js'].indexOf('class ServerVerbinding'), code['verbinding.js'].indexOf('export function maakVerbinding'));
  ok('de ServerVerbinding heeft geen eigen invoke: alleen via zetSchrijver, en kanBedienen begint false',
    /kanBedienen = false/.test(sv) && !/^\s*invoke\s*\(/m.test(sv) && /zetSchrijver\(fn\)/.test(sv) && /this\.invoke = \(id, v\) => this\._schrijver\(/.test(sv));
  ok('alleen paneel.js zet een schrijver, en alleen na wie() (gekoppeld, schrijfweg aan, het eigen scherm)',
    Object.entries(code).filter(([, c]) => /\.zetSchrijver\(/.test(c)).map(([f]) => f).join() === 'paneel.js'
    && /const goed = w\.aan && w\.gekoppeld && w\.scherm === scherm;\s*zetBedienen\(goed\)/.test(code['paneel.js']));
  const routes = zonderCommentaar(readFileSync(join(WORTEL, 'server/routes/paneel.js'), 'utf8'));
  const regels = routes.split('\n');
  const schrijfRoutes = regels.filter((r) => /methode:\s*'(POST|DELETE|PUT|PATCH)',\s*pad:/.test(r));
  // Elke route die iets verandert: vanDezeMac (de mixer, de Controlekamer) of vanBuiten (schakelaar aan + Origin + token).
  const blokken = routes.split(/\n\s*\{ methode: /).slice(1);
  const bewaakt = blokken.filter((b) => /^'(POST|DELETE)'/.test(b)).every((b) => /ctx\.vanDezeMac\(req\)|lokaal\(req, res, ctx\)|vanBuiten\(req, res, ctx\)/.test(b));
  ok(`de server: elke schrijvende route is vanDezeMac of vanBuiten (${schrijfRoutes.length} routes)`, schrijfRoutes.length >= 6 && bewaakt);
  ok('vanBuiten: uit = 404, Origin precies de eigen pagina; invoke vraagt een token (401)',
    /if \(!s\.aan\)[^\n]*404/.test(routes) && /origineGoed\(req\)/.test(routes) && /apparaatVan\(req\)[\s\S]{0,80}401/.test(routes));
}

// ---- de mixer laadt src/paneel/ niet -------------------------------------------------------------
console.log('\nde mixer laadt src/paneel/ niet (zonder werkruimte)');
{
  const html = readFileSync(join(WORTEL, 'index.html'), 'utf8');
  ok('index.html noemt src/paneel/ niet', !/src\/paneel\//.test(html));
  const begin = [join(WORTEL, 'src/ui/app.js'), ...readdirSync(join(WORTEL, 'src/ui/aanhakers')).map((f) => join(WORTEL, 'src/ui/aanhakers', f))];
  const alles = new Set();
  for (const b of begin) for (const p of boomVan(b).boom.keys()) alles.add(rel(p));
  const paneel = [...alles].filter((p) => p.startsWith('src/paneel/') || p === 'src/ui/live-zender.js');
  ok(`statisch: niets uit src/paneel/ en niet de zender (${alles.size} bestanden nagelopen)${paneel.length ? ` (wel ${paneel.join(', ')})` : ''}`, paneel.length === 0);
  const schermen = zonderCommentaar(readFileSync(join(WORTEL, 'src/ui/aanhakers/schermen.js'), 'utf8'));
  const dyn = [...schermen.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  ok('de aanhaker laadt src/paneel/ en de zender alleen dynamisch, in laadPaneel', dyn.filter((d) => /paneel\/|live-zender/.test(d)).length === 5
    && /function laadPaneel\(\)[\s\S]*?import\('\.\.\/\.\.\/paneel\/protocol\.js'\)/.test(schermen));
  const aanroepen = [...schermen.matchAll(/laadPaneel\(\)/g)].map((m) => m.index).filter((i) => !schermen.slice(i - 16, i).includes('function'));
  const bewaakt = aanroepen.every((i) => /standaard/.test(schermen.slice(Math.max(0, i - 260), i)));
  ok(`elke aanroep van laadPaneel() staat achter een controle op 'standaard' (${aanroepen.length})`, aanroepen.length >= 2 && bewaakt);
}

if (fails.length) { console.log(`\n${fails.length} FOUT`); process.exit(1); }
console.log('\nAlle checks groen.');
