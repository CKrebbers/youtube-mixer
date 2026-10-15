// De tegel Versie (16 okt): welke commit draait de server, staat er nieuwere op schijf, is GitHub verder.
// server/versie.js op echte git-mappen in een tijdelijke map (een kale "GitHub" en twee klonen), de tegel
// (src/controle/versie-tegel.js) puur, en GET /api/versie op een eigen server.
// Draai met: node test/versie.test.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Versie, leesKop, leesRemote, GITHUB_MS } from '../server/versie.js';
import { versieTegel, datum, HERSTART } from '../src/controle/versie-tegel.js';

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra ? `\n      ${extra}` : ''}`); };
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('lezen (puur)');
{
  const h = 'a'.repeat(40);
  ok('leesKop: commit, kort, datum, onderwerp', JSON.stringify(leesKop(`${h}\x1faaaaaaa\x1f2026-10-16T14:02:00+02:00\x1fEen · onderwerp`))
    === JSON.stringify({ commit: h, kort: 'aaaaaaa', datum: '2026-10-16T14:02:00+02:00', onderwerp: 'Een · onderwerp' }));
  ok('leesKop: rommel = null', leesKop('fatal: not a git repository') === null && leesKop('') === null);
  ok('leesRemote: alleen refs/heads/main', leesRemote(`${'b'.repeat(40)}\trefs/heads/mainx\n${h}\trefs/heads/main\n`) === h
    && leesRemote('') === null && leesRemote(`${h}\trefs/heads/dev`) === null);
  ok('datum: "16 okt 14:02" (lokale klok)', datum(new Date(2026, 9, 16, 14, 2).toISOString()) === '16 okt 14:02' && datum('x') === '?');
}

console.log('\nde tegel (puur)');
{
  const kop = (c, extra = {}) => ({ commit: c.repeat(40), kort: c.repeat(7), datum: new Date(2026, 9, 16, 14, 2).toISOString(), onderwerp: 'Merge pull request #52', tak: 'main', gewijzigd: 0, ...extra });
  const v = (o = {}) => ({ draait: kop('a'), opSchijf: kop('a'), hoortTak: 'main', github: { bereikt: true, commit: 'a'.repeat(40), kort: 'aaaaaaa', verhouding: 'gelijk' }, ...o });
  const g = versieTegel(v());
  ok('alles gelijk: groen, de commit en de tak, wanneer en wat', g.licht === 'ok' && g.waarde === 'aaaaaaa · main' && g.sub === '16 okt 14:02 · Merge pull request #52'
    && g.regel === 'gelijk met GitHub' && g.id === 'versie', JSON.stringify(g));
  const nietHerstart = versieTegel(v({ opSchijf: kop('b') }));
  ok('op schijf iets anders dan wat draait: rood, "herstart de server", en hoe', nietHerstart.licht === 'fout' && /^op schijf staat bbbbbbb .*herstart de server$/.test(nietHerstart.sub)
    && nietHerstart.regel.includes(HERSTART), JSON.stringify(nietHerstart));
  const ghVerder = versieTegel(v({ github: { bereikt: true, commit: 'c'.repeat(40), kort: 'ccccccc', verhouding: 'github verder' } }));
  ok('GitHub verder: oranje, "git pull, dan de server herstarten"', ghVerder.licht === 'half' && ghVerder.sub === 'GitHub heeft ccccccc: git pull, dan de server herstarten' && ghVerder.regel.includes(HERSTART));
  const beide = versieTegel(v({ opSchijf: kop('b'), github: { bereikt: true, commit: 'c'.repeat(40), kort: 'ccccccc', verhouding: 'github verder' } }));
  ok('beide: rood, eerst herstarten, git pull eronder', beide.licht === 'fout' && /herstart de server$/.test(beide.sub) && /^GitHub heeft ccccccc/.test(beide.regel));
  const hier = versieTegel(v({ github: { bereikt: true, commit: 'c'.repeat(40), kort: 'ccccccc', verhouding: 'hier verder' } }));
  ok('hier verder dan GitHub: groen, met de regel "nog niet gepusht"', hier.licht === 'ok' && /nog niet gepusht/.test(hier.regel));
  const tak = versieTegel(v({ opSchijf: kop('a', { tak: 'studio/x' }) }));
  ok('een andere tak: oranje, "git checkout main"', tak.licht === 'half' && tak.sub === 'tak studio/x, niet main: git checkout main' && tak.waarde === 'aaaaaaa · studio/x');
  const weg = versieTegel(v({ github: { bereikt: false, reden: 'Could not resolve host: github.com' } }));
  ok('GitHub niet bereikt: oranje (niet te weten), met de reden; geen taak', weg.licht === 'half' && weg.regel === 'GitHub niet bereikt (Could not resolve host: github.com)' && /^16 okt/.test(weg.sub));
  const kijk = versieTegel(v({ github: null }));
  ok('GitHub nog niet gevraagd: "kijken…"', kijk.licht === 'half' && kijk.regel === 'GitHub: kijken…');
  const oud = versieTegel(v(), { geladen: 'z'.repeat(40) });
  ok('deze pagina laadde op een andere commit: oranje, herlaad', oud.licht === 'half' && /^deze pagina is van een oudere versie: herlaad/.test(oud.sub));
  ok('… dezelfde commit: niets', versieTegel(v(), { geladen: 'a'.repeat(40) }).licht === 'ok');
  ok('gewijzigde bestanden: een regel, geen taak', /3 bestanden gewijzigd, niet gecommit/.test(versieTegel(v({ opSchijf: kop('a', { gewijzigd: 3 }) })).regel)
    && versieTegel(v({ opSchijf: kop('a', { gewijzigd: 3 }) })).licht === 'ok');
  ok('niets gehoord: grijs; oudere server: "herstart hem"; geen git: de reden',
    versieTegel(null).licht === 'uit' && /herstart hem/.test(versieTegel({ ontbreekt: true }).sub)
    && versieTegel({ draait: null, startFout: 'git niet gevonden' }).sub === 'git: git niet gevonden');
  ok('de tegel is gewone data', JSON.stringify(structuredClone(beide)) === JSON.stringify(beide));
}

console.log('\nserver/versie.js op echte git-mappen');
const tmp = mkdtempSync(join(tmpdir(), 'varve-versie-'));
try {
  const git = (map, ...args) => execFileSync('git', args, { cwd: map, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  const hub = join(tmp, 'github.git'), mac = join(tmp, 'mac'), ander = join(tmp, 'ander');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', hub);
  git(tmp, 'clone', '-q', hub, mac);
  git(mac, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(mac, 'a.txt'), '1');
  git(mac, 'add', 'a.txt'); git(mac, 'commit', '-q', '-m', 'eerste');
  git(mac, '-c', 'push.negotiate=false', 'push', '-q', 'origin', 'main');
  const c1 = git(mac, 'rev-parse', 'HEAD');
  let nu = 1_000_000;
  const v = await new Versie({ map: mac, klok: () => nu }).start();
  let s = await v.stand();
  ok('net gestart: draait = op schijf = GitHub, gelijk, tak main', v.draait?.commit === c1 && s.opSchijf.commit === c1 && s.github?.commit === c1
    && s.github.verhouding === 'gelijk' && s.opSchijf.tak === 'main' && s.opSchijf.gewijzigd === 0, JSON.stringify(s));
  ok('… en de tegel is groen', versieTegel(s, { geladen: c1 }).licht === 'ok');

  // Clay doet git pull op de Mac (hier: een commit erbij), de server draait nog de oude.
  writeFileSync(join(mac, 'a.txt'), '2');
  git(mac, 'commit', '-q', '-am', 'tweede');
  const c2 = git(mac, 'rev-parse', 'HEAD');
  s = await v.stand();
  ok('binnen 15 s: op schijf nog uit het geheugen', s.opSchijf.commit === c1);
  nu += 16_000;
  s = await v.stand();
  ok('na 15 s: op schijf c2, draait c1 → de tegel zegt herstarten', s.opSchijf.commit === c2 && s.draait.commit === c1
    && versieTegel(s).licht === 'fout');
  ok('… GitHub niet opnieuw gevraagd (10 min), maar de verhouding wel: hier verder', s.github.t === 1_000_000 && s.github.verhouding === 'hier verder');

  // Iemand anders zet iets nieuws op GitHub.
  git(tmp, 'clone', '-q', hub, ander);
  writeFileSync(join(ander, 'b.txt'), 'x');
  git(ander, 'add', 'b.txt'); git(ander, 'commit', '-q', '-m', 'van elders'); git(ander, 'push', '-q', 'origin', 'main');
  const c3 = git(ander, 'rev-parse', 'HEAD');
  s = await v.stand();
  ok('binnen 10 min: GitHub nog uit het geheugen', s.github.commit === c1);
  s = await v.stand({ vers: true });
  ok('vers (een klik): GitHub heeft c3, die hier onbekend is → github verder', s.github.commit === c3 && s.github.verhouding === 'github verder'
    && /^GitHub heeft /.test(versieTegel({ ...s, draait: s.opSchijf }).sub));
  nu += GITHUB_MS + 1;
  ok('na 10 min vanzelf opnieuw', (await v.stand()).github.t === nu);
  ok('github: false = niet vragen, de laatste blijft', (await v.stand({ github: false })).github.commit === c3);

  // Gewijzigde bestanden en een andere tak.
  writeFileSync(join(mac, 'a.txt'), '3');
  git(mac, 'checkout', '-q', '-b', 'studio/proef');
  s = await v.stand({ vers: true });
  ok('een gewijzigd bestand en tak studio/proef', s.opSchijf.gewijzigd === 1 && s.opSchijf.tak === 'studio/proef');

  // Twee vragen tegelijk: één keer git.
  const [x, y] = await Promise.all([v.stand({ vers: true }), v.stand({ vers: true })]);
  ok('twee tegelijk: hetzelfde antwoord (één keer gevraagd)', x.github.t === y.github.t && x.opSchijf === y.opSchijf);

  // Zonder netwerk: een remote die niet bestaat.
  git(mac, 'remote', 'set-url', 'origin', join(tmp, 'bestaat-niet.git'));
  s = await v.stand({ vers: true });
  ok('remote weg: bereikt false met een reden, geen verhouding', s.github.bereikt === false && typeof s.github.reden === 'string' && s.github.reden.length > 0 && s.github.verhouding === null);

  // Geen git op de machine.
  const zonder = await new Versie({ map: mac, git: join(tmp, 'geen-git') }).start();
  ok('geen git: startFout "git niet gevonden", stand gooit niet', zonder.draait === null && zonder.startFout === 'git niet gevonden'
    && (await zonder.stand()).opSchijf.fout === 'git niet gevonden');
  const geenRepo = await new Versie({ map: tmp }).start();
  ok('geen git-map: een reden, geen commit', geenRepo.draait === null && typeof geenRepo.startFout === 'string');
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log('\nGET /api/versie op een eigen server (deze werkmap, zonder GitHub)');
{
  let head = null;
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: WORTEL, encoding: 'utf8' }).trim(); } catch {}
  if (!head) console.log('  --  geen git-werkmap: overgeslagen');
  else {
    const vrij = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const t2 = mkdtempSync(join(tmpdir(), 'varve-versie-srv-'));
    const env = { ...process.env, PORT: String(vrij), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(t2, 'media'), VARVE_DB: join(t2, 'lib.db'),
      VARVE_OPNAMES: join(t2, 'opnames'), VARVE_PATRONEN: join(t2, 'patronen'), VARVE_PLANNEN: join(t2, 'plannen'),
      VARVE_BACKUPS: join(t2, 'backups'), VARVE_PROEF: join(t2, 'proef'), VARVE_STANDEN: join(t2, 'standen'),
      VARVE_SETS: join(t2, 'sets'), VARVE_SJABLONEN: join(t2, 'eigen.json'), VARVE_WERKRUIMTES: join(t2, 'werkruimtes'),
      VARVE_KAART: join(t2, 'geen-kaart.json'), VARVE_KAART_DB: join(t2, 'kaart.db'), VARVE_NACHT: join(t2, 'nacht.json'), VARVE_HERANALYSE: 'uit' };
    const srv = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { env, stdio: 'ignore' });
    try {
      let j = null;
      for (let i = 0; i < 100 && !j?.draait; i++) {
        j = await fetch(`http://127.0.0.1:${vrij}/api/versie?github=0`).then((r) => (r.ok ? r.json() : null), () => null);
        if (!j?.draait) await slaap(100);
      }
      ok('draait = HEAD van deze werkmap, op schijf ook, github niet gevraagd (null)', j?.draait?.commit === head && j.opSchijf?.commit === head && j.github === null, JSON.stringify(j)?.slice(0, 300));
      const p = await fetch(`http://127.0.0.1:${vrij}/api/versie`, { method: 'DELETE' });
      ok('alleen GET (405)', p.status === 405);
    } finally {
      srv.kill('SIGTERM');
      await new Promise((r) => srv.once('exit', r));
      rmSync(t2, { recursive: true, force: true });
    }
  }
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
