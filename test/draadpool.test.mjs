// Code die niet lokaal staat (iCloud) mag de decks niet stilleggen (docs/WINST.md punt 4).
// 1. De Dock-app start de server met UV_THREADPOOL_SIZE=16 (vóór node).
// 2. tools/bench/draadpool.mjs: vier hangende modules (FIFO's) houden de standaardpool
//    vast; met 16 draden komen de pagina's van een deck toch binnen.
// Draai met: node test/draadpool.test.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond || !extra ? '' : `\n      ${extra}`)); };
const wortel = fileURLToPath(new URL('..', import.meta.url));

const as = readFileSync(wortel + 'tools/varve-app/VARVE.applescript', 'utf8');
const start = /on startServer\(\)[\s\S]*?end startServer/.exec(as)?.[0] ?? '';
// Sinds 15 okt start VARVE.app de herstartlus (WINST.md punt 3), en die start node: de variabele
// moet vóór de lus staan, en de lus mag hem niet weer weghalen of overschrijven.
const lus = readFileSync(wortel + 'tools/varve-app/server-lus.sh', 'utf8');
ok('VARVE.app: startServer zet UV_THREADPOOL_SIZE=16 vóór nohup sh tools/varve-app/server-lus.sh',
  /export UV_THREADPOOL_SIZE=16 && nohup sh tools\/varve-app\/server-lus\.sh/.test(start));
ok('de lus start node server/index.js en laat UV_THREADPOOL_SIZE staan',
  /^\s*node server\/index\.js/m.test(lus) && !/UV_THREADPOOL_SIZE=|unset UV_THREADPOOL_SIZE|env -i/.test(lus));

if (process.platform === 'win32') {
  console.log('  --  geen mkfifo op Windows: de meting is overgeslagen');
} else {
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const r = spawnSync(process.execPath, [wortel + 'tools/bench/draadpool.mjs', '--poort', String(poort)], { encoding: 'utf8', timeout: 60000 });
  const uit = (r.stdout || '') + (r.stderr || '');
  const rij = (pool) => uit.split('\n').find((l) => l.startsWith(`| ${pool} |`)) ?? '';
  ok('de meting liep (exit 0: met 16 draden hangt niets)', r.status === 0, uit.slice(-400));
  ok(`standaardpool met vier hangende modules: de pagina's hangen (dat is het gevaar): ${rij('standaard (4)')}`, /HANGT \/ HANGT \/ HANGT/.test(rij('standaard (4)')));
  ok(`UV_THREADPOOL_SIZE=16: de pagina's komen binnen: ${rij(16)}`, /^\| 16 \| [\d /]+ \| \d+ \/ \d+ \/ \d+ \|$/.test(rij(16)));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
