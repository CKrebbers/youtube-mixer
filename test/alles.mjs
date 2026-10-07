// Alle tests in één keer, met een overzicht. Geen dependencies.
// Draai met: node test/alles.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const map = fileURLToPath(new URL('.', import.meta.url));
const bestanden = readdirSync(map).filter((f) => f.endsWith('.test.mjs')).sort();
let rood = 0, totaal = 0;
const overgeslagen = [];   // regels '  --  …': een check die niet kon draaien (bv. geen av-app-hub), niet stil groen
for (const f of bestanden) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [map + f], { encoding: 'utf8', cwd: map + '..' });
  const uit = (r.stdout || '') + (r.stderr || '');
  let goed = (uit.match(/^ {2}ok /gm) || []).length;
  let fout = (uit.match(/^FAIL/gm) || []).length;
  // De zendertest van de Stroommachine (test/varve-beeld-zender.test.mjs, overgenomen
  // zoals hij is) telt anders: '✗ …' per fout en onderaan 'N checks · …'.
  const eigen = /^(\d+) checks · /m.exec(uit);
  if (!goed && !fout && eigen) { fout = (uit.match(/^✗ /gm) || []).length; goed = Number(eigen[1]) - fout; }
  for (const regel of uit.match(/^ {2}-- .*$/gm) || []) overgeslagen.push(`${f}: ${regel.replace(/^ {2}--\s*/, '')}`);
  totaal += goed + fout;
  const ok = r.status === 0;
  if (!ok) rood++;
  console.log(`${ok ? 'groen' : 'ROOD '}  ${f.padEnd(22)} ${String(goed).padStart(4)} ok${fout ? `  ${fout} FAIL` : ''}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (!ok) console.log(uit.split('\n').filter((l) => /^FAIL|^✗|Error|at /.test(l)).slice(0, 12).map((l) => '        ' + l).join('\n'));
}
if (overgeslagen.length) console.log(`\novergeslagen (niet getoetst):\n${overgeslagen.map((r) => `  ${r}`).join('\n')}`);
console.log(`\n${bestanden.length} bestanden, ${totaal} checks${overgeslagen.length ? `, ${overgeslagen.length} overgeslagen` : ''} — ${rood ? `${rood} ROOD` : 'alles groen'}`);
process.exit(rood ? 1 : 0);
