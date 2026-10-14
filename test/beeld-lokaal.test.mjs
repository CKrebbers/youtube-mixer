// Het startscript van "beeld op één machine" (tools/beeld-lokaal.sh, docs/BEELD.md §8),
// zonder iets echts te raken: het script draait als KOPIE in een tijdelijke map MET een
// spatie in de naam (H15), met een nep-Stroommachine (lege index.html en een nep-relay
// van een paar regels), een nep-`open` die alleen zijn argumenten opschrijft, nep-bundels
// voor --installeer en eigen vrije poorten. Nooit 7702, nooit 8777, nooit ~/Applications,
// ~/.varve-relay.log of Clay's Chrome: alles gaat via de VARVE_BL_*-variabelen.
// Draai met: node test/beeld-lokaal.test.mjs
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (!cond && extra ? ` (${extra})` : '')); };
const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const zsh = spawnSync('/bin/zsh', ['-c', 'true']).status === 0;
if (process.platform !== 'darwin' || !zsh) {
  console.log('  -- tools/beeld-lokaal.sh: alleen op macOS met zsh (lsof, plutil, ditto), hier niet getoetst');
  process.exit(0);
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const leeft = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const luistert = async (poort) => fetch(`http://127.0.0.1:${poort}/status.json`, { signal: AbortSignal.timeout(800) }).then((r) => r.json()).catch(() => null);

/** Vrije poorten: allemaal tegelijk open (dan zijn ze verschillend), dan dicht. */
async function vrijePoorten(n) {
  const s = await Promise.all(Array.from({ length: n }, () => new Promise((r) => { const x = createServer(); x.listen(0, '127.0.0.1', () => r(x)); })));
  const p = s.map((x) => x.address().port);
  await Promise.all(s.map((x) => new Promise((r) => x.close(r))));
  return p;
}

const NEP_RELAY = `const http = require('http');
const poort = Number(process.argv[2]);
http.createServer((q, a) => {
  if (q.url === '/status.json') { a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ relay: 'varve-relay', poort })); return; }
  a.writeHead(200); a.end('nep-relay');
}).listen(poort, '127.0.0.1', () => console.log('nep-relay op ' + poort));
`;
const plist = (id) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>
`;
const maakBundel = (pad, id) => {
  mkdirSync(join(pad, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(pad, 'Contents/Info.plist'), plist(id));
  writeFileSync(join(pad, 'Contents/MacOS/nep'), '#!/bin/sh\n');
};

const tmp = mkdtempSync(join(tmpdir(), 'varve bl test '));      // met een spatie
const kinderen = [];
const servers = [];
let relayPid = null;
try {
  const script = join(tmp, 'tools', 'beeld-lokaal.sh');
  mkdirSync(join(tmp, 'tools'));
  copyFileSync(join(WORTEL, 'tools/beeld-lokaal.sh'), script);
  const nepS = join(tmp, 'stroom map');
  mkdirSync(join(nepS, 'tools'), { recursive: true });
  writeFileSync(join(nepS, 'index.html'), '<!doctype html><title>nep</title>');
  writeFileSync(join(nepS, 'tools/varve-relay.js'), NEP_RELAY);
  const nepOpen = join(tmp, 'nep open');
  writeFileSync(nepOpen, '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done > "$(dirname "$0")/open-args.txt"\n');
  chmodSync(nepOpen, 0o755);
  const [poort, server, kijk, bezetPoort] = await vrijePoorten(4);
  const bundel = join(tmp, 'Apps', 'Stroom Chrome.app');
  const profiel = join(tmp, 'profiel');
  const pidBestand = join(tmp, 'bl.pid');
  const log = join(tmp, 'relay.log');
  const openArgs = join(tmp, 'open-args.txt');
  const env = {
    ...process.env, VARVE_BL_SERVER: String(server), VARVE_BL_PID: pidBestand, VARVE_BL_LOG: log, VARVE_BL_BUNDEL: bundel,
    VARVE_BL_PROFIEL: profiel, VARVE_BL_KIJK_DEBUG: String(kijk), VARVE_BL_OPEN: nepOpen, VARVE_NODE: process.execPath, VARVE_STROOM_REPO: nepS,
  };
  // Asynchroon: de nep-server hieronder draait in DIT proces, en spawnSync zou zijn lus stilzetten.
  const draai = (args, extra = {}) => new Promise((klaar) => {
    const k = spawn('/bin/zsh', [script, ...args], { cwd: tmp, env: { ...env, ...extra } });
    let uit = '';
    k.stdout.on('data', (b) => { uit += b; });
    k.stderr.on('data', (b) => { uit += b; });
    const t = setTimeout(() => k.kill('SIGKILL'), 20000);
    k.on('close', (code) => { clearTimeout(t); klaar({ code, uit }); });
  });
  const URL_BASIS = `${pathToFileURL(join(nepS, 'index.html')).href}?hub=ws%3A%2F%2F127.0.0.1%3A${poort}%2Fapp&dj#`;
  const urlRegel = (uit) => (uit.match(/^ {2}url {5}(.*)$/m) || [])[1] ?? null;
  const VIJF = ['knopje deze Mac, beeld aan', 'F volledig scherm, H panelen weg', 'Klik daarna terug in VARVE', 'Videopaneel in VARVE dicht',
    'niet op G (eigen geluid), I of C', 'zwart = APC mapje beeld, Stop All'];

  console.log('het script en verkeerd gebruik');
  ok('zsh -n: het script is foutloos', spawnSync('/bin/zsh', ['-n', script]).status === 0);
  for (const [args, waarom] of [[['--stand', 'zwaar'], '--stand zwaar'], [['--poort', 'abc'], '--poort abc'], [['--poort', '70000'], '--poort 70000'],
    [['--onzin'], 'een onbekende optie'], [['--stand'], '--stand zonder waarde']]) {
    const r = await draai(['--droog', ...args]);
    ok(`verkeerd gebruik geeft exit 2: ${waarom}`, r.code === 2, `exit ${r.code}`);
  }

  console.log('\n--droog: niets draait, niets is er');
  const d = await draai(['--droog', '--poort', String(poort)]);
  ok('exit 0, en "klik eerst VARVE.app" (de server antwoordt niet; het script start hem nooit)', d.code === 0 && /zou stoppen: de VARVE-server antwoordt niet op \d+: klik eerst VARVE\.app/.test(d.uit), d.uit.slice(0, 300));
  ok('de URL precies: file-URL van <map met spaties>/index.html, hub op 127.0.0.1:<poort>, &dj, #licht&fps',
    urlRegel(d.uit) === `${URL_BASIS}licht&fps`, urlRegel(d.uit));
  ok('zonder eigen bundel: "zou stoppen: … draai eerst --installeer"', /zou stoppen: geen eigen Chrome-bundel in .*: draai eerst --installeer/.test(d.uit));
  ok('de vijf regels voor daarna (BEELD-rij, beamer, terugklikken, videopaneel, toetsen en zwart)', VIJF.every((t) => d.uit.includes(t)));
  ok('zegt wat het zou starten: de relay met log en pid-bestand, en open -na <bundel> met het eigen profiel en debugpoort',
    d.uit.includes(`tools/varve-relay.js ${poort}`) && d.uit.includes(`>> ${log}`) && d.uit.includes(`--user-data-dir=${profiel}`) && d.uit.includes(`--remote-debugging-port=${kijk}`));
  ok('--stand normaal: #normaal&fps', urlRegel((await draai(['--droog', '--poort', String(poort), '--stand', 'normaal'])).uit) === `${URL_BASIS}normaal&fps`);
  ok('--stand auto --geen-fps: #auto, zonder &fps', urlRegel((await draai(['--droog', '--poort', String(poort), '--stand', 'auto', '--geen-fps'])).uit) === `${URL_BASIS}auto`);
  ok('na --droog: niets op de poort, geen pid-bestand, geen log, open niet aangeroepen',
    !(await luistert(poort)) && !existsSync(pidBestand) && !existsSync(log) && !existsSync(openArgs));

  console.log('\n--installeer: een eigen bundel, nooit die van Clay\'s Chrome');
  const fout = join(tmp, 'bron', 'Echte Chrome.app');
  maakBundel(fout, 'com.google.Chrome');
  const w = await draai(['--installeer'], { VARVE_BL_CFT: fout });
  ok('bundle-id com.google.Chrome: WEIGER, exit 1, niets gekopieerd', w.code === 1 && /WEIGER/.test(w.uit) && !existsSync(bundel), w.uit);
  const goed = join(tmp, 'bron', 'Google Chrome for Testing.app');
  maakBundel(goed, 'com.google.chrome.for.testing');
  const g = await draai(['--installeer'], { VARVE_BL_CFT: goed });
  ok('Chrome for Testing (com.google.chrome.for.testing): gekopieerd met ditto, de bundle-id gemeld',
    g.code === 0 && existsSync(join(bundel, 'Contents/Info.plist')) && existsSync(join(bundel, 'Contents/MacOS/nep')) && /bundle-id com\.google\.chrome\.for\.testing/.test(g.uit), g.uit);
  writeFileSync(join(bundel, 'Contents/merk'), 'blijft');
  const g2 = await draai(['--installeer'], { VARVE_BL_CFT: fout });
  ok('nog eens (ook met een foute bron): "bestaat al", exit 0, niets overschreven',
    g2.code === 0 && /bestaat al/.test(g2.uit) && readFileSync(join(bundel, 'Contents/merk'), 'utf8') === 'blijft', g2.uit);

  console.log('\nstarten (met een nep-server, de nep-relay en een nep-open)');
  const srv = createServer((q, a) => { a.writeHead(q.url === '/api/proef' ? 200 : 404, { 'content-type': 'application/json' }); a.end('{}'); });
  await new Promise((r) => srv.listen(server, '127.0.0.1', r));
  servers.push(srv);
  const d2 = await draai(['--droog', '--poort', String(poort)]);
  ok('--droog met alles in orde: geen "zou stoppen", en nog steeds niets gestart',
    d2.code === 0 && !/zou stoppen/.test(d2.uit) && /ok {4}de VARVE-server antwoordt/.test(d2.uit) && !(await luistert(poort)) && !existsSync(openArgs), d2.uit.slice(0, 400));
  const s = await draai(['--poort', String(poort)]);
  relayPid = existsSync(pidBestand) ? Number(readFileSync(pidBestand, 'utf8').trim()) : null;
  const st = await luistert(poort);
  ok('start: exit 0, de relay luistert op de poort (status.json: varve-relay)', s.code === 0 && st?.relay === 'varve-relay' && st.poort === poort, s.uit.slice(-400));
  const relayCmd = relayPid ? spawnSync('ps', ['-p', String(relayPid), '-o', 'command='], { encoding: 'utf8' }).stdout.trim() : '';
  ok('het pid-bestand wijst naar die relay (node …/tools/varve-relay.js <poort>), de uitvoer gaat naar het log',
    relayCmd.includes('varve-relay.js') && relayCmd.endsWith(String(poort)) && existsSync(log), relayCmd);
  const a = existsSync(openArgs) ? readFileSync(openArgs, 'utf8').trim().split('\n') : [];
  ok('open -na <eigen bundel> --args met het eigen profiel, geen eerste-keer-vragen, debugpoort en --app=<URL>',
    JSON.stringify(a) === JSON.stringify(['-na', bundel, '--args', `--user-data-dir=${profiel}`, '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${kijk}`, `--app=${URL_BASIS}licht&fps`]), JSON.stringify(a));
  ok('en daarna de vijf regels', VIJF.every((t) => s.uit.includes(t)));
  rmSync(openArgs);
  const s2 = await draai(['--poort', String(poort)]);
  ok('nog eens starten: "relay draait al", geen tweede relay (het pid-bestand blijft)',
    s2.code === 0 && /relay draait al op \d+/.test(s2.uit) && Number(readFileSync(pidBestand, 'utf8').trim()) === relayPid, s2.uit.slice(0, 400));
  // Een "Stroommachine" met ons profiel (het browserproces) en een helper (--type=).
  const nepStroom = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profiel}`], { stdio: 'ignore' });
  const nepHelper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--type=renderer', `--user-data-dir=${profiel}`], { stdio: 'ignore' });
  kinderen.push(nepStroom, nepHelper);
  await wacht(300);
  rmSync(openArgs, { force: true });
  const s3 = await draai(['--poort', String(poort)]);
  ok('draait de Stroommachine al (ons profiel, geen helper): "draait al", open wordt niet nog eens aangeroepen',
    s3.code === 0 && s3.uit.includes(`de Stroommachine draait al (pid ${nepStroom.pid}`) && !existsSync(openArgs), s3.uit.slice(0, 500));

  console.log('\neen poort die bezet is door iets anders');
  const ander = createServer((q, r) => { r.writeHead(404); r.end(); });
  await new Promise((r) => ander.listen(bezetPoort, '127.0.0.1', r));
  servers.push(ander);
  const b = await draai(['--poort', String(bezetPoort)]);
  ok('geen varve-relay op de poort: STOP "bezet door …", exit 1, niets gestart', b.code === 1 && /poort \d+ bezet door/.test(b.uit), b.uit.slice(0, 300));

  console.log('\n--stop: alleen wat van dit script is');
  const zelfde = await draai(['--stop']);
  await wacht(800);
  ok('de relay uit het pid-bestand gestopt (de poort is vrij)', /relay gestopt \(pid \d+\)/.test(zelfde.uit) && !(await luistert(poort)), zelfde.uit);
  ok('de Stroommachine (ons profiel, het browserproces) gestopt; de helper niet aangeraakt',
    zelfde.uit.includes(`Stroommachine gestopt (pid ${nepStroom.pid}`) && !leeft(nepStroom.pid) && leeft(nepHelper.pid), zelfde.uit);
  writeFileSync(pidBestand, `${nepHelper.pid}\n`);
  const st2 = await draai(['--stop']);
  ok('een pid-bestand dat naar iets anders wijst (geen varve-relay.js): niets gestopt', /geen varve-relay\.js: niets gestopt/.test(st2.uit) && leeft(nepHelper.pid), st2.uit);
  ok('niets meer van ons op de poort, en geen pkill in het script', !(await luistert(poort)) && !/\bpkill\b|\bkillall\b/.test(readFileSync(script, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')));
} catch (e) {
  ok(`liep zonder uitzondering (${e.message})`, false);
} finally {
  for (const k of kinderen) { try { k.kill('SIGKILL'); } catch (_) {} }
  if (relayPid && leeft(relayPid)) {
    const cmd = spawnSync('ps', ['-p', String(relayPid), '-o', 'command='], { encoding: 'utf8' }).stdout;
    if (cmd.includes(tmp)) { try { process.kill(relayPid, 'SIGKILL'); } catch (_) {} }
  }
  for (const s of servers) s.close();
  await wacht(100);
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
