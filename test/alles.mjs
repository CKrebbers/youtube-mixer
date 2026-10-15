// Alle tests in één keer, met een overzicht. Geen dependencies.
// Draai met: node test/alles.mjs [--serieel] [--banen N]
//
// Standaard in een POOL (docs/WINST.md punt 8): zoveel processen tegelijk als
// er kernen zijn (os.availableParallelism(), of --banen N), langste eerst. De
// duur van elk bestand komt uit test/.duur.json (niet in git), die na elke
// volledige ronde wordt bijgewerkt; een nieuw bestand telt eerst als lang.
//
// Een test die ALLEEN moet lopen, zet bovenaan (in de eerste 40 regels):
//     // @alleen: <waarom>
// Die draaien na de pool, één voor één, met niets ernaast. Dat zijn tests met
// een tijdsgrens op de wandklok (een belaste machine maakt ze rood zonder dat
// er iets mis is), afvalmetingen (0 GC per blok), en wat een vaste poort pakt.
// Een nieuwe test met zo'n grens: markeer hem.
//
// --serieel: het oude gedrag, alles na elkaar op alfabet.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { versieWaarschuwing } from './node-versie.mjs';

const map = fileURLToPath(new URL('.', import.meta.url));
const DUUR = map + '.duur.json';
const args = process.argv.slice(2);
const serieel = args.includes('--serieel');
const bi = args.indexOf('--banen');
const banen = serieel ? 1 : Math.max(1, Number(bi >= 0 ? args[bi + 1] : 0) || (availableParallelism?.() ?? cpus().length));

const bestanden = readdirSync(map).filter((f) => f.endsWith('.test.mjs')).sort();

// Een andere Node dan .node-version: zeggen, niet overslaan (test/node-versie.mjs, spoor C).
const versie = versieWaarschuwing();
if (versie) console.log(versie.kop);

/** De reden achter `// @alleen:` bovenaan, of null. */
function alleenReden(tekst) {
  const kop = String(tekst).split('\n').slice(0, 40).join('\n');
  const m = /^\/\/ @alleen\b:?\s*(.*)$/m.exec(kop);
  return m ? (m[1].trim() || 'alleen') : null;
}

let duren = {};
try { duren = JSON.parse(readFileSync(DUUR, 'utf8')) || {}; } catch (_) { duren = {}; }
const LANG = 60;   // onbekend: vooraan, dan staat hij niet als laatste alleen te lopen
const duurVan = (f) => (Number.isFinite(duren[f]) ? duren[f] : LANG);

const alleen = new Map();
for (const f of bestanden) { const r = alleenReden(readFileSync(map + f, 'utf8')); if (r) alleen.set(f, r); }
const pool = serieel ? [] : bestanden.filter((f) => !alleen.has(f)).sort((a, b) => duurVan(b) - duurVan(a) || a.localeCompare(b));
const daarna = serieel ? bestanden : bestanden.filter((f) => alleen.has(f));

let rood = 0, totaal = 0;
const overgeslagen = [];   // regels '  --  …': een check die niet kon draaien (bv. geen av-app-hub), niet stil groen
const nieuweDuur = {};
const uitslag = {};

function draai(f) {
  return new Promise((klaar) => {
    const t0 = performance.now();
    const p = spawn(process.execPath, [map + f], { cwd: map + '..', stdio: ['ignore', 'pipe', 'pipe'] });
    let uit = '';
    p.stdout.on('data', (d) => { uit += d; });
    p.stderr.on('data', (d) => { uit += d; });
    p.on('close', (code) => klaar({ f, code, uit, s: (performance.now() - t0) / 1000 }));
  });
}

function meld({ f, code, uit, s }) {
  let goed = (uit.match(/^ {2}ok /gm) || []).length;
  let fout = (uit.match(/^FAIL/gm) || []).length;
  // De zendertest van de Stroommachine (test/varve-beeld-zender.test.mjs, overgenomen
  // zoals hij is) telt anders: '✗ …' per fout en onderaan 'N checks · …'.
  const eigen = /^(\d+) checks · /m.exec(uit);
  if (!goed && !fout && eigen) { fout = (uit.match(/^✗ /gm) || []).length; goed = Number(eigen[1]) - fout; }
  for (const regel of uit.match(/^ {2}-- .*$/gm) || []) overgeslagen.push(`${f}: ${regel.replace(/^ {2}--\s*/, '')}`);
  totaal += goed + fout;
  const ok = code === 0;
  if (!ok) rood++;
  nieuweDuur[f] = Math.round(s * 10) / 10;
  uitslag[f] = ok;
  console.log(`${ok ? 'groen' : 'ROOD '}  ${f.padEnd(22)} ${String(goed).padStart(4)} ok${fout ? `  ${fout} FAIL` : ''}  ${s.toFixed(1)} s${alleen.has(f) && !serieel ? '  (alleen)' : ''}`);
  // Eerst de FAIL-regels, dan wat op een fout lijkt (een stacktrace-regel begint met spaties en "at "): "at " midden
  // in een regel ("wat", "dat") liet de echte FAIL buiten de twaalf vallen (macOS-run 15 okt, stems).
  if (!ok) {
    const regels = uit.split('\n');
    const toon = [...regels.filter((l) => /^FAIL|^✗/.test(l)), ...regels.filter((l) => !/^FAIL|^✗/.test(l) && /Error|^\s+at /.test(l))];
    console.log(toon.slice(0, 12).map((l) => '        ' + l).join('\n'));
  }
}

const T0 = performance.now();
if (pool.length) {
  console.log(`pool: ${pool.length} bestanden, ${banen} tegelijk, langste eerst; daarna ${daarna.length} alleen (${[...alleen.keys()].map((f) => f.replace('.test.mjs', '')).join(', ')})\n`);
  let i = 0;
  const baan = async () => { while (i < pool.length) meld(await draai(pool[i++])); };
  await Promise.all(Array.from({ length: Math.min(banen, pool.length) }, baan));
  if (daarna.length) console.log('\nalleen, één voor één:');
}
const tPool = performance.now();
for (const f of daarna) meld(await draai(f));
const tEind = performance.now();

// De duur bijwerken (alleen wat net gemeten is; de rest blijft staan).
try { writeFileSync(DUUR, JSON.stringify({ ...duren, ...nieuweDuur }, Object.keys({ ...duren, ...nieuweDuur }).sort(), 1) + '\n'); } catch (_) {}

if (overgeslagen.length) console.log(`\novergeslagen (niet getoetst):\n${overgeslagen.map((r) => `  ${r}`).join('\n')}`);
const roodLijst = bestanden.filter((f) => uitslag[f] === false);
if (roodLijst.length) console.log(`\nrood: ${roodLijst.join(', ')}`);
const tijd = serieel ? `serieel ${((tEind - T0) / 1000).toFixed(0)} s`
  : `${banen} tegelijk, ${((tEind - T0) / 1000).toFixed(0)} s (pool ${((tPool - T0) / 1000).toFixed(0)} s + alleen ${((tEind - tPool) / 1000).toFixed(0)} s)`;
if (versie) console.log(`\n${versie.staart}`);
console.log(`\n${bestanden.length} bestanden, ${totaal} checks${overgeslagen.length ? `, ${overgeslagen.length} overgeslagen` : ''} — ${rood ? `${rood} ROOD` : 'alles groen'} · ${tijd}`);
process.exit(rood ? 1 : 0);
