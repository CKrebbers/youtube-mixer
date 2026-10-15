// @alleen: vaste poorten 8964/8965 (de lus kijkt met lsof of er iets luistert) en tijdgrenzen op de wandklok
// De herstartlus van de server (tools/varve-app/server-lus.sh), met een nep-`node` op PATH die
// op bestelling omvalt. Geen echte server: de lus start alleen wat `node` heet.
// Toetst: herstart na een crash, de grens van 5 per minuut, exit 0 en SIGTERM stoppen hem,
// stoppen via het pidbestand ruimt lus én server op, nooit twee lussen, nooit op een bezette poort.
// Draai met: node test/server-lus.test.mjs
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const LUS = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'varve-app', 'server-lus.sh');
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
// Een zombie (gestopt, nog niet opgeruimd) telt als weg: in een container ruimt pid 1 wezen niet altijd op.
const leeft = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  return !/^Z/.test(spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim());
};
async function tot(klaar, ms = 8000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (klaar()) return true; await slaap(25); }
  return klaar();
}

const kl = mkdtempSync(join(tmpdir(), 'varve-lus-'));
const bin = join(kl, 'bin');
mkdirSync(bin);
// De nep-node: telt zijn starts, valt de eerste `crash` keer om met NEP_CODE, stopt netjes als
// `netjes` bestaat, en draait anders tot SIGTERM (dan exit 143, zoals node na een signaal).
writeFileSync(join(bin, 'node'), `#!/bin/sh
d="$NEP_MAP"
echo "$@" >> "$d/args"
n=$(( $(cat "$d/teller" 2>/dev/null || echo 0) + 1 ))
echo $n > "$d/teller"
echo $$ > "$d/pid"
if [ -f "$d/crash" ] && [ $n -le $(cat "$d/crash") ]; then exit \${NEP_CODE:-1}; fi
if [ -f "$d/netjes" ]; then exit 0; fi
trap 'echo term >> "$d/signalen"; exit 143' TERM
while :; do sleep 0.05; done
`);
chmodSync(join(bin, 'node'), 0o755);

let nr = 0;
/** Een eigen map per geval; de lus met zijn eigen pidbestand en poort (8960–8969 is van dit spoor). */
function geval({ crash = 0, netjes = false, code = 1, poort = 8964 } = {}) {
  const d = join(kl, `g${++nr}`);
  mkdirSync(d);
  if (crash) writeFileSync(join(d, 'crash'), String(crash));
  if (netjes) writeFileSync(join(d, 'netjes'), '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NEP_MAP: d, NEP_CODE: String(code), PORT: String(poort),
    VARVE_LUS_PID: join(d, 'lus.pid'), VARVE_LUS_WACHT: '0.1', VARVE_LUS_MAX: '5', VARVE_LUS_VENSTER: '60' };
  const lees = (f) => (existsSync(join(d, f)) ? readFileSync(join(d, f), 'utf8') : '');
  const g = {
    d, env,
    starts: () => Number(lees('teller') || 0),
    nepPid: () => Number(lees('pid') || 0),
    lees,
    log: '',
    start() {
      g.p = spawn('sh', [LUS], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      g.p.stdout.on('data', (b) => { g.log += b; });
      g.p.stderr.on('data', (b) => { g.log += b; });
      g.einde = new Promise((r) => g.p.on('exit', (c) => { g.code = c; r(c); }));
      return g;
    },
    cmd: (...a) => spawnSync('sh', [LUS, ...a], { env, encoding: 'utf8' }),
    // Zonder de event loop te blokkeren: anders ruimt deze test de gestopte lus niet op (een zombie).
    cmdAsync: (...a) => new Promise((r) => {
      const c = spawn('sh', [LUS, ...a], { env });
      let uit = '';
      c.stdout.on('data', (b) => { uit += b; });
      c.on('exit', (status) => r({ status, stdout: uit }));
    }),
  };
  return g;
}

const lussen = [];
try {
  console.log('herstarten na een crash');
  {
    const g = geval({ crash: 3 }).start();
    lussen.push(g);
    const draait = await tot(() => g.starts() === 4) && leeft(g.nepPid());
    ok(`drie keer om, dan blijft hij draaien (${g.starts()} starts)`, draait);
    await slaap(200);
    ok('niet vaker gestart dan nodig', g.starts() === 4 && g.code === undefined);
    ok('hij start node server/index.js', g.lees('args').trim().split('\n').every((r) => r === 'server/index.js'));
    ok('het pidbestand heeft het pid van de lus', readFileSync(g.env.VARVE_LUS_PID, 'utf8').trim() === String(g.p.pid));
    ok('status zegt: draait', g.cmd('status').status === 0);
    // Een tweede lus start niets (geen tweede server).
    const twee = spawnSync('sh', [LUS], { env: g.env, encoding: 'utf8', timeout: 5000 });
    ok(`een tweede lus start niets (${twee.stdout.trim()})`, twee.status === 0 && /draait al/.test(twee.stdout) && g.starts() === 4);
    // Een SIGKILL van de server (zoals de proef, of de OOM-killer): gewoon opnieuw.
    const oud = g.nepPid();
    process.kill(oud, 'SIGKILL');
    ok('na een SIGKILL meteen opnieuw gestart', await tot(() => g.starts() === 5 && g.nepPid() !== oud && leeft(g.nepPid())));
    // Stoppen via het pidbestand: de lus en de server allebei weg.
    const srv = g.nepPid();
    const s = await g.cmdAsync('stop');
    await g.einde;
    ok(`stop: "${s.stdout.trim()}"`, s.status === 0 && /gestopt/.test(s.stdout));
    ok(`stop: de lus is weg (exit ${g.code}) en de server ook (kreeg SIGTERM: ${g.lees('signalen').trim()})`, g.code === 0 && (await tot(() => !leeft(srv), 2000)) && /term/.test(g.lees('signalen')));
    ok('stop: het pidbestand is weg', !existsSync(g.env.VARVE_LUS_PID));
    ok('status zegt daarna: draait niet', g.cmd('status').status === 1);
    ok('stop zonder lus: geen fout', g.cmd('stop').status === 0);
  }

  console.log('\nde grens: hooguit 5 herstarts per minuut');
  {
    const g = geval({ crash: 100, code: 134 }).start();
    lussen.push(g);
    await Promise.race([g.einde, slaap(10000)]);
    ok(`altijd om: de lus stopt na 5 herstarts (${g.starts()} starts, exit ${g.code})`, g.code === 1 && g.starts() === 6);
    ok('en schrijft waarom in het log', /al 5 keer herstart in 60 s/.test(g.log) && /exitcode 134/.test(g.log));
    ok('het pidbestand is weg', !existsSync(g.env.VARVE_LUS_PID));
  }

  console.log('\nbewust gestopt: niet opnieuw');
  {
    const g = geval({ netjes: true }).start();
    lussen.push(g);
    await Promise.race([g.einde, slaap(5000)]);
    ok('exitcode 0 van de server: de lus stopt ook (exit 0, één start)', g.code === 0 && g.starts() === 1 && !existsSync(g.env.VARVE_LUS_PID));
  }
  {
    const g = geval().start();
    lussen.push(g);
    await tot(() => g.starts() === 1 && leeft(g.nepPid()));
    process.kill(g.nepPid(), 'SIGTERM');          // zoals `pkill -f server/index.js`
    await Promise.race([g.einde, slaap(5000)]);
    ok('SIGTERM op de server (pkill): niet opnieuw, de lus stopt', g.code === 0 && g.starts() === 1 && /signaal 15/.test(g.log));
  }
  {
    const g = geval({ crash: 1, code: 3 }).start();
    lussen.push(g);
    await Promise.race([g.einde, slaap(5000)]);
    ok('exitcode 3 (poort bezet, server/index.js): niet opnieuw', g.code === 3 && g.starts() === 1);
  }

  console.log('\nnooit twee servers op één poort');
  {
    const bezet = createServer().listen(8965, '127.0.0.1');
    await new Promise((r) => bezet.once('listening', r));
    const g = geval({ poort: 8965 }).start();
    lussen.push(g);
    await Promise.race([g.einde, slaap(5000)]);
    bezet.close();
    ok(`poort bezet: geen server gestart, de lus stopt (exit ${g.code})`, g.code === 3 && g.starts() === 0 && /luistert al iets/.test(g.log));
  }
  {
    // Een pidbestand van een dood proces (na een crash van de Mac) houdt niets tegen.
    const g = geval({ netjes: true });
    writeFileSync(g.env.VARVE_LUS_PID, '999999\n');
    g.start();
    lussen.push(g);
    await Promise.race([g.einde, slaap(5000)]);
    ok('een oud pidbestand van een dood proces: de lus start gewoon', g.code === 0 && g.starts() === 1);
  }
  {
    const r = spawnSync('sh', ['-n', LUS]);
    ok('het script is geldige POSIX sh (sh -n)', r.status === 0);
    const tekst = readFileSync(LUS, 'utf8');
    ok('geen zsh- of bash-eigen dingen ([[, ${0:A}, function)', !/\[\[|\$\{0:|^function /m.test(tekst));
  }
} finally {
  for (const g of lussen) { try { if (g.code === undefined) g.p.kill('SIGTERM'); } catch {} }
  await slaap(300);
  for (const g of lussen) { const p = g.nepPid(); if (p && leeft(p)) try { process.kill(p, 'SIGKILL'); } catch {} }
  rmSync(kl, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
