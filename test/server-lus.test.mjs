// @alleen: vaste poorten 8964/8965 (de lus kijkt met lsof of er iets luistert) en tijdgrenzen op de wandklok
// De herstartlus van de server (tools/varve-app/server-lus.sh), met een nep-`node` op PATH die
// op bestelling omvalt. Geen echte server: de lus start alleen wat `node` heet.
// Toetst: herstart na een crash, de grens van 5 per minuut, exit 0 en SIGTERM stoppen hem,
// stoppen via het pidbestand ruimt lus én server op, nooit twee lussen, nooit op een bezette poort,
// en de wachter (AR18): een server die hangt (SIGSTOP) wordt met kill -9 neergezet en opnieuw gestart,
// met wat hij startte; een server die antwoordt of nog opstart niet; en wat de lus elke nieuwe server
// over zijn herstarts meegeeft (AR9: VARVE_LUS_SINDS, _AANTAL, _HERSTARTS).
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
echo "$VARVE_LUS_SINDS|$VARVE_LUS_AANTAL|$VARVE_LUS_HERSTARTS" >> "$d/lus"
if [ -f "$d/crash" ] && [ $n -le $(cat "$d/crash") ]; then exit \${NEP_CODE:-1}; fi
if [ -f "$d/luister" ]; then exec "$ECHTE_NODE" "$NEP_LUISTER" server/index.js; fi
if [ -f "$d/netjes" ]; then exit 0; fi
trap 'echo term >> "$d/signalen"; exit 143' TERM
while :; do sleep 0.05; done
`);
chmodSync(join(bin, 'node'), 0o755);
// Met `luister`: een echte node die op PORT /api/leeft beantwoordt (na NEP_LUISTER_NA ms) en zelf een kind
// start (zoals de server ffmpeg of Demucs), zodat de wachter iets heeft om te peilen en op te ruimen.
const LUISTER = join(kl, 'luister.mjs');
writeFileSync(LUISTER, `import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const kind = spawn('sleep', ['1000'], { stdio: 'ignore' });
writeFileSync(join(process.env.NEP_MAP, 'kind'), String(kind.pid));
setTimeout(() => createServer((req, res) => { res.writeHead(req.url === '/api/leeft' ? 200 : 404); res.end('{}'); })
  .listen(Number(process.env.PORT), '127.0.0.1'), Number(process.env.NEP_LUISTER_NA || 0));
process.on('SIGTERM', () => { kind.kill('SIGKILL'); process.exit(143); });
`);
const antwoordt = (poort) => new Promise((r) => {
  const c = spawn('curl', ['-fs', '-m', '0.5', '-o', '/dev/null', `http://127.0.0.1:${poort}/api/leeft`], { stdio: 'ignore' });
  c.on('exit', (code) => r(code === 0));
});
async function totAsync(klaar, ms = 8000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (await klaar()) return true; await slaap(50); }
  return klaar();
}

let nr = 0;
/** Een eigen map per geval; de lus met zijn eigen pidbestand en poort (8960–8969 is van dit spoor). */
function geval({ crash = 0, netjes = false, code = 1, poort = 8964, luister = false, luisterNa = 0, wachter = {} } = {}) {
  const d = join(kl, `g${++nr}`);
  mkdirSync(d);
  if (crash) writeFileSync(join(d, 'crash'), String(crash));
  if (netjes) writeFileSync(join(d, 'netjes'), '');
  if (luister) writeFileSync(join(d, 'luister'), '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NEP_MAP: d, NEP_CODE: String(code), PORT: String(poort),
    VARVE_LUS_PID: join(d, 'lus.pid'), VARVE_LUS_WACHT: '0.1', VARVE_LUS_MAX: '5', VARVE_LUS_VENSTER: '60',
    ECHTE_NODE: process.execPath, NEP_LUISTER: LUISTER, NEP_LUISTER_NA: String(luisterNa), ...wachter };
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
    // AR9: elke start krijgt mee wat de lus weet. De eerste: de start van de lus, 0 herstarts, geen lijst.
    const lus = g.lees('lus').trim().split('\n').map((r) => r.split('|'));
    const sinds = Number(lus[0][0]);
    ok(`de eerste start: VARVE_LUS_SINDS = nu, 0 herstarts, lege lijst (${lus[0].join('|')})`,
      Math.abs(sinds - Date.now() / 1000) < 30 && lus[0][1] === '0' && lus[0][2] === '');
    ok('elke start dezelfde VARVE_LUS_SINDS, en het aantal telt op (0, 1, 2, 3)',
      lus.length === 4 && lus.every((x) => Number(x[0]) === sinds) && lus.map((x) => x[1]).join() === '0,1,2,3');
    const vierde = lus[3][2].split(' ');
    ok(`de vierde krijgt de drie herstarts mee als "<s>:<exitcode>:om" (${lus[3][2]})`,
      vierde.length === 3 && vierde.every((h) => /^\d+:1:om$/.test(h) && Number(h.split(':')[0]) >= sinds));
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
    const laatste = g.lees('lus').trim().split('\n').at(-1).split('|');
    ok(`de zesde start kreeg vijf herstarts mee (${laatste[1]}, ${laatste[2].split(' ').length} in de lijst)`, laatste[1] === '5' && laatste[2].split(' ').length === 5);
    ok('het pidbestand is weg', !existsSync(g.env.VARVE_LUS_PID));
  }

  {
    // AR9: de lijst blijft klein (de laatste 20), het aantal telt door.
    const g = geval({ crash: 24 });
    g.env.VARVE_LUS_MAX = '30';
    g.start();
    lussen.push(g);
    await tot(() => g.starts() === 25 && leeft(g.nepPid()), 15000);
    const laatste = g.lees('lus').trim().split('\n').at(-1).split('|');
    ok(`na 24 herstarts: aantal 24, maar alleen de laatste 20 in de lijst (${laatste[1]}, ${laatste[2].split(' ').length})`,
      laatste[1] === '24' && laatste[2].split(' ').length === 20);
    g.p.kill('SIGTERM');
    await Promise.race([g.einde, slaap(5000)]);
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

  console.log('\nde wachter: een server die hangt (AR18)');
  // Snel ingesteld: peilen elke 0,2 s, 0,3 s wachten, drie keer niets = hangt.
  const snel = { VARVE_LUS_PEIL: '0.2', VARVE_LUS_PEIL_MAX: '0.3', VARVE_LUS_MIS: '3', VARVE_LUS_OPSTART: '3' };
  {
    const g = geval({ luister: true, wachter: snel }).start();
    lussen.push(g);
    ok('de nep-server luistert en antwoordt op /api/leeft', await totAsync(() => antwoordt(8964)));
    const oud = g.nepPid(), kind = Number(g.lees('kind'));
    await slaap(1500);
    ok('een server die antwoordt laat de wachter staan (één start, geen melding)', g.starts() === 1 && leeft(oud) && !/antwoordt niet/.test(g.log));
    const t0 = Date.now();
    process.kill(oud, 'SIGSTOP');                 // zoals ar-hang: de poort blijft open, er komt geen antwoord
    const terug = await totAsync(async () => g.starts() === 2 && g.nepPid() !== oud && await antwoordt(8964), 8000);
    const ms = Date.now() - t0;
    ok(`vastgezet (SIGSTOP): neergezet en opnieuw gestart, weer een antwoord na ${ms} ms`, terug);
    ok('de vastgezette server is weg (kill -9 werkt ook op een gestopt proces)', !leeft(oud));
    ok('… en het kind dat hij startte ook (geen wees)', kind > 0 && await tot(() => !leeft(kind), 2000));
    ok('het log zegt het: antwoordt niet, het laatste antwoord, kill -9, en wat hij startte', /de server antwoordt niet \(laatste antwoord \d{2}:\d{2}:\d{2}, 3 keer niets op \/api\/leeft binnen 0\.3 s, pid \d+\): kill -9 \(en 1 die hij startte\), de lus start hem opnieuw/.test(g.log));
    ok('daarna gewoon de regel van een crash (exitcode 137) en een herstart', /de server viel om \(exitcode 137\)/.test(g.log) && /herstart 1/.test(g.log));
    ok(`AR9: de nieuwe server weet dat het een hang was ("…:137:hang", ${g.lees('lus').trim().split('\n')[1]})`,
      /^\d+\|1\|\d+:137:hang$/.test(g.lees('lus').trim().split('\n')[1] ?? ''));
    ok('… en het merkbestand van de wachter is weer weg', !existsSync(`${g.env.VARVE_LUS_PID}.hang`));
    ok('pas na de drie keer: niet binnen 0,5 s', ms > 500);
    ok('de lus draait door met zijn pidbestand (de wachter ruimde het niet op)', g.code === undefined && readFileSync(g.env.VARVE_LUS_PID, 'utf8').trim() === String(g.p.pid));
    await slaap(1200);
    ok('de nieuwe server antwoordt en blijft staan', g.starts() === 2 && leeft(g.nepPid()) && (g.log.match(/antwoordt niet/g) || []).length === 1);
    // Stoppen met een wachter erbij: lus, server en wachter weg.
    const srv = g.nepPid();
    const s = await g.cmdAsync('stop');
    await g.einde;
    ok(`stop met een wachter erbij: alles weg (exit ${g.code})`, s.status === 0 && g.code === 0 && await tot(() => !leeft(srv), 2000) && !existsSync(g.env.VARVE_LUS_PID));
    ok('… en de wachter zei niets meer', (g.log.match(/antwoordt niet/g) || []).length === 1);
  }
  {
    // Een server die nooit antwoordt (de nep-node zonder luister): eerst de opstarttijd, dan pas tellen.
    const g = geval({ wachter: snel }).start();
    lussen.push(g);
    await slaap(2000);
    ok('een server die nog opstart (nog nooit geantwoord, binnen VARVE_LUS_OPSTART) blijft staan', g.starts() === 1 && leeft(g.nepPid()) && !/antwoordt niet/.test(g.log));
    ok('na de opstarttijd zonder één antwoord: ook neergezet en opnieuw gestart', await tot(() => g.starts() === 2, 6000) && /antwoordt niet/.test(g.log));
  }
  {
    // Een server die pas na 1 s luistert (de library openen) en daarna antwoordt: nooit neergezet.
    const g = geval({ luister: true, luisterNa: 1000, wachter: { ...snel, VARVE_LUS_OPSTART: '2' } }).start();
    lussen.push(g);
    await slaap(4000);
    ok('een trage start die daarna antwoordt: één start, geen melding', g.starts() === 1 && leeft(g.nepPid()) && !/antwoordt niet/.test(g.log));
  }
  {
    // AR8 (16 okt): de LaunchAgent in docs/TAILSCALE.md start de LUS, niet node, en zonder KeepAlive.
    const doc = readFileSync(join(dirname(LUS), '..', '..', 'docs', 'TAILSCALE.md'), 'utf8');
    const plist = /<plist[\s\S]*?<\/plist>/.exec(doc)?.[0] ?? '';
    ok('AR8: de LaunchAgent in TAILSCALE.md start /bin/sh tools/varve-app/server-lus.sh (niet node direct)',
      /<string>\/bin\/sh<\/string><string>tools\/varve-app\/server-lus\.sh<\/string>/.test(plist) && !/server\/index\.js/.test(plist));
    ok('AR8: … zonder KeepAlive (anders start launchd een crash-lus eindeloos opnieuw), met UV_THREADPOOL_SIZE 16',
      !/KeepAlive/.test(plist) && /UV_THREADPOOL_SIZE<\/key><string>16</.test(plist) && /RunAtLoad/.test(plist));
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
