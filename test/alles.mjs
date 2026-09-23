// Alle tests in één keer, met een overzicht. Geen dependencies.
// Draai met: node test/alles.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const map = fileURLToPath(new URL('.', import.meta.url));
const bestanden = readdirSync(map).filter((f) => f.endsWith('.test.mjs')).sort();
let rood = 0, totaal = 0;
for (const f of bestanden) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [map + f], { encoding: 'utf8', cwd: map + '..' });
  const uit = (r.stdout || '') + (r.stderr || '');
  const goed = (uit.match(/^ {2}ok /gm) || []).length;
  const fout = (uit.match(/^FAIL/gm) || []).length;
  totaal += goed + fout;
  const ok = r.status === 0;
  if (!ok) rood++;
  console.log(`${ok ? 'groen' : 'ROOD '}  ${f.padEnd(22)} ${String(goed).padStart(4)} ok${fout ? `  ${fout} FAIL` : ''}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (!ok) console.log(uit.split('\n').filter((l) => /^FAIL|Error|at /.test(l)).slice(0, 12).map((l) => '        ' + l).join('\n'));
}
console.log(`\n${bestanden.length} bestanden, ${totaal} checks — ${rood ? `${rood} ROOD` : 'alles groen'}`);
process.exit(rood ? 1 : 0);
