// Het meetscript van "beeld op één machine" (tools/headless/beeld-lokaal.mjs),
// zonder Chrome: de pure delen. Opties en duur, het adres van de Stroommachine,
// ps lezen en optellen, de oordelen (fps-meter, hartslag), wat --opruimen mag
// stoppen, en de worklet-code van de hartslag zelf met een nepklok.
// De meting zelf (GPU, twee Chromes) draait niet in alles.mjs: daarvoor
// `node tools/headless/beeld-lokaal.mjs --zelftest` en de volledige run.
// Draai met: node test/beeld-meting.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const m = await import('../tools/headless/beeld-lokaal.mjs');
const bron = (pad) => readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('opties en duur');
{
  const o = m.leesOpties([], {});
  ok('standaard: de volgorde uit het ontwerp (nul, licht-1080, nul, normaal-1080, nul, vormen, licht-720)',
    o.standen.join(',') === 'nul,licht-1080,nul,normaal-1080,nul,vormen,licht-720' && !o.onbekend.length);
  ok('standaard: relay 7712 (niet Clay\'s 7702), server 8801, debug 9391 en 9392, kijken op 9393',
    o.relay === 7712 && o.poort === 8801 && o.debugStroom === 9391 && o.debugVarve === 9392 && o.kijkDebug === 9393);
  ok('standaard: 20 s opwarmen, geen vaste meetduur, geen zelftest', o.warm === 20 && o.meet === null && !o.zelftest && !o.kijk && !o.opruimen);
  const o2 = m.leesOpties(['/tmp/uit', '--standen', 'nul,vormen,zwaar-4k', '--meet', '5', '--zelftest'],
    { VARVE_RELAY_POORT: '7720', VARVE_BL_DEBUG: '9500', VARVE_BL_FORCEER: '1', VARVE_STROOM_REPO: '/x/s' });
  ok('uitmap, standen, --meet en --zelftest gelezen; de waarde van --standen is geen uitmap',
    o2.uit === '/tmp/uit' && o2.standen.join(',') === 'nul,vormen,zwaar-4k' && o2.meet === 5 && o2.zelftest);
  ok('een onbekende stand wordt genoemd', o2.onbekend.join() === 'zwaar-4k');
  ok('de omgeving wint (relay, debug +1 voor VARVE, forceer, repo)',
    o2.relay === 7720 && o2.debugStroom === 9500 && o2.debugVarve === 9501 && o2.forceer && o2.repo === '/x/s');
  ok('--meet met onzin wordt NaN (niet stil 0)', Number.isNaN(m.leesOpties(['--meet', 'veel'], {}).meet));
  ok('optieFout: --warm abc en --meet -1 worden genoemd (de run stopt met exit 2, niet stil 0 s opwarmen)',
    /--warm, --meet moet een getal ≥ 0 zijn/.test(m.optieFout(m.leesOpties(['--warm', 'abc', '--meet', '-1'], {})) ?? ''));
  ok('optieFout: --duur onzin ook (--kijk), en de standaard is goed (null)',
    /--duur/.test(m.optieFout(m.leesOpties(['--kijk', '--duur', 'lang'], {})) ?? '') && m.optieFout(m.leesOpties([], {})) === null
    && m.optieFout(m.leesOpties(['--warm', '0', '--meet', '5'], {})) === null);
  const v = m.VOLGORDE;
  ok('duur: nul 120 s de eerste keer en 60 daarna, licht-1080 120, de rest 60',
    v.map((_, i) => m.duurVan(v, i)).join(',') === '120,120,60,60,60,60,60');
  ok('duur: --meet overschrijft alles', v.every((_, i) => m.duurVan(v, i, 7) === 7));
}

console.log('\nde standen en het adres van de Stroommachine');
{
  ok('elke stand uit de volgorde bestaat', m.VOLGORDE.every((s) => s in m.STANDEN));
  const metStroom = Object.entries(m.STANDEN).filter(([, s]) => s.stroom);
  ok('elke stand met de Stroommachine heeft &fps in de hash (zonder blijft kwInfo().ms 16,7, H1)',
    metStroom.length >= 4 && metStroom.every(([, s]) => /(^|&)fps(&|$)/.test(s.stroom.hash)));
  ok('de meetstanden zetten de schaal vast (vast), alleen auto-1080 niet',
    metStroom.every(([n, s]) => (n === 'auto-1080') !== /(^|&)vast(&|$)/.test(s.stroom.hash)));
  ok('1080-standen op 1920×1080, licht-720 op 1280×720 (de vergelijking met ontwerp B)',
    m.STANDEN['licht-1080'].stroom.b === 1920 && m.STANDEN['licht-1080'].stroom.h === 1080
    && m.STANDEN['licht-720'].stroom.b === 1280 && m.STANDEN['licht-720'].stroom.h === 720);
  ok('vormen = het zaalbeeld zonder Stroommachine; nul = niets', m.STANDEN.vormen.vormen && !m.STANDEN.vormen.stroom && !m.STANDEN.nul.vormen && !m.STANDEN.nul.stroom);
  ok('het adres: file://…/index.html?hub=<ws://127.0.0.1:poort/app gecodeerd>&dj#<hash>',
    m.stroomUrl('/Users/x/stroommachine', 7712, 'licht&vast&fps') === 'file:///Users/x/stroommachine/index.html?hub=ws%3A%2F%2F127.0.0.1%3A7712%2Fapp&dj#licht&vast&fps');
  ok('een repo met een spatie in het pad wordt een geldige file-URL', m.stroomUrl('/Users/x/mijn map', 7712, 'licht&fps').startsWith('file:///Users/x/mijn%20map/index.html?hub='));
}

console.log('\nps lezen en optellen');
{
  ok('cputime van macOS: minuten lopen door boven 60', bij(m.cputijd('77:26.98'), 77 * 60 + 26.98) && bij(m.cputijd('0:00.01'), 0.01));
  ok('cputime met uren en dagen (Linux)', bij(m.cputijd('1:02:03.45'), 3723.45) && bij(m.cputijd('1-00:00:01'), 86401));
  ok('cputime: onzin is NaN', Number.isNaN(m.cputijd('--')) && Number.isNaN(m.cputijd('')));
  const voor = m.leesPs([
    '    1     0  77:26.98  23888 /sbin/launchd',
    '  100     1   0:10.00 200000 /pad/Google Chrome for Testing --remote-debugging-port=9391',
    '  101   100   0:05.00 100000 /pad/Google Chrome for Testing Helper --type=gpu-process',
    '  102   101   0:01.00  50000 /pad/Helper (Renderer) --type=renderer',
    '  200     1   1:00.00  80000 /usr/bin/zsh -c pgrep -f varve-beeld-lokaal-',
    'kapotte regel',
  ].join('\n'));
  ok('leesPs: pid, ppid, cpu (s), rss (kB), cmd; kapotte regels vallen weg',
    voor.length === 5 && voor[1].pid === 100 && voor[1].ppid === 1 && voor[1].cpu === 10 && voor[1].rss === 200000 && voor[4].cmd.startsWith('/usr/bin/zsh'));
  const b = m.boom(voor, 100);
  ok('boom: de browser en al zijn helpers (kleinkinderen ook), niets anders', b.has(100) && b.has(101) && b.has(102) && !b.has(1) && !b.has(200));
  const na = voor.map((r) => ({ ...r, cpu: r.cpu + ({ 100: 0.5, 101: 1.0, 102: 0.3, 200: 0.1 }[r.pid] ?? 0) }));
  na.push({ pid: 103, ppid: 100, cpu: 0.4, rss: 1024, cmd: 'nieuwe helper' });
  const g = m.cpuPerGroep(voor, na, { stroom: 100, ander: (rijen) => new Set(rijen.filter((r) => r.pid === 200).map((r) => r.pid)) }, 2);
  ok('cpuPerGroep: (0,5 + 1,0 + 0,3) s in 2 s = 0,9 kern; een nieuwe helper telt niet met zijn hele leven',
    bij(g.stroom.kern, 0.9) && g.stroom.n === 4);
  ok('cpuPerGroep: RSS in MB opgeteld, een groep als functie mag ook', bij(g.stroom.rssMB, (200000 + 100000 + 50000 + 1024) / 1024) && bij(g.ander.kern, 0.05));
  const top = m.topGebruikers(voor, na, 1, new Set([102]));
  ok('topGebruikers: grootste eerst, uitgesloten pids niet, alleen wie er beide keren was',
    top[0].pid === 101 && bij(top[0].kern, 1) && !top.some((t) => t.pid === 102 || t.pid === 103));
  const clay = m.leesPs([
    '  300     1   1:29.80  90000 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/154.0.8037.98/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=utility --utility-sub-type=audio.mojom.AudioService',
    '  301     1   0:01.00  90000 /pad/Google Chrome for Testing Helper --type=utility --utility-sub-type=audio.mojom.AudioService',
  ].join('\n'));
  ok('Clay\'s audioproces: alleen dat van /Applications/Google Chrome.app, niet van Chrome for Testing',
    m.claysAudio(clay)?.pid === 300 && m.claysAudio(clay.slice(1)) === null);
  ok('de versie van Clay\'s Chrome uit het helperpad', m.claysChromeVersie(clay) === '154.0.8037.98' && m.claysChromeVersie(voor) === null);
  ok('kortCmd: zonder de lange --vlaggen', m.kortCmd('/a/b/node /c/d.js --veel --meer') === '/a/b/node /c/d.js');
}

console.log('\nverdelingen en oordelen');
{
  const v = m.verdeling([5, 1, 3, 2, 4, NaN]);
  ok('verdeling: n, min, p50, max, gemiddelde (NaN telt niet)', v.n === 5 && v.min === 1 && v.p50 === 3 && v.max === 5 && v.gem === 3);
  ok('verdeling van niets is null', m.verdeling([]) === null && m.verdeling(null) === null);
  const raf = m.rafSamenvatting([0, ...Array(85).fill(1000 / 60), ...Array(15).fill(1000 / 30)]);
  ok('rAF: p50 60 fps, p10 = de beeldtijd van p90 (hier 30 fps), de 0 van de eerste stap telt niet',
    raf.beelden === 100 && bij(raf.fpsP50, 60, 1e-9) && bij(raf.fpsP10, 30, 1e-9) && bij(raf.msP99, 1000 / 30));
  ok('fps-oordeel: zonder monsters niet ok', !m.fpsOordeel([]).ok);
  const uit = m.fpsOordeel([{ fps: false, ms: 16.7 }]);
  ok('fps-oordeel: de meter uit (geen &fps) = niet ok, met de reden H1', !uit.ok && /staat uit/.test(uit.tekst) && /H1/.test(uit.tekst));
  ok('fps-oordeel: aan en ms beweegt = ok', m.fpsOordeel([{ fps: true, ms: 16.7 }, { fps: true, ms: 16.9 }]).ok);
  ok('fps-oordeel: aan maar ms in elk monster 16,7 = niet ok', !m.fpsOordeel([{ fps: true, ms: 16.7 }, { fps: true, ms: 16.7 }]).ok);
  ok('fps-oordeel: één monster met de meter aan = ok (constant is pas te zien vanaf twee)', m.fpsOordeel([{ fps: true, ms: 20 }]).ok);
  const t = m.hartTekst({ max: 9, n15: 0, n: 4000 }, true);
  ok('hartslag als tekst: met de meter en de positieve controle erbij, nooit "geen gaten" (W6)',
    /max 9 ms/.test(t) && /0 gaten > 15 ms/.test(t) && /positieve controle geslaagd/.test(t) && !/geen gaten/.test(t));
  ok('hartslag als tekst: een mislukte controle staat er letterlijk', /MISLUKT/.test(m.hartTekst({ max: 6, n15: 0, n: 1 }, false)));
  const r = [{ stand: 'nul', w: 10 }, { stand: 'licht-1080', w: 15 }, { stand: 'nul', w: 12 }, { stand: 'vormen', w: 20 }];
  const tn = m.tegenNul(r, (x) => x.w);
  ok('tegen de omliggende nul-standen: licht-1080 − gem(10, 12) = 4; vormen − 12 = 8 (alleen een nul ervóór)',
    tn.length === 2 && tn[0].stand === 'licht-1080' && bij(tn[0].verschil, 4) && bij(tn[1].verschil, 8));
}

console.log('\nwat --opruimen mag stoppen');
{
  const rijen = m.leesPs([
    '  10     1   0:00.10  1000 /bin/zsh -c pgrep -fl varve-beeld-lokaal- /var/T/varve-beeld-lokaal-abc',
    '  11    10   0:00.10  1000 /usr/local/bin/node /w/tools/headless/beeld-lokaal.mjs --opruimen',
    '  20     1   0:01.00  1000 /pad/Google Chrome for Testing --user-data-dir=/var/T/varve-beeld-lokaal-abc/profiel-9391',
    '  21    20   0:01.00  1000 /pad/Helper --type=renderer --user-data-dir=/var/T/varve-beeld-lokaal-abc/profiel-9391',
    '  30     1   0:01.00  1000 /Users/c/.nvm/bin/node /Users/c/Projects/stroommachine/tools/varve-relay.js 7712',
    '  31     1   0:01.00  1000 /Users/c/.nvm/bin/node /Users/c/Projects/stroommachine/tools/varve-relay.js 7702',
    '  32     1   0:01.00  1000 grep varve-relay.js 7712',
    '  40     1   0:01.00  1000 /pad/Google Chrome --user-data-dir=/Users/c/.varve-stroom-chrome',
  ].join('\n'));
  const weg = m.teOpruimen(rijen, 7712, 11).map((r) => r.pid);
  ok('de Chromes van de meting (browser en helper) en de relay op 7712', weg.includes(20) && weg.includes(21) && weg.includes(30));
  ok('NIET: Clay\'s relay op 7702, een grep, de Stroommachine van het startscript', !weg.includes(31) && !weg.includes(32) && !weg.includes(40));
  ok('NIET: een shell met de tekst in zijn opdracht, en ook niet het script zelf of wie het startte',
    !weg.includes(10) && !weg.includes(11) && weg.length === 3);
  // De proefserver: zijn tmp-paden staan alleen in zijn env (ps toont die niet), dus een merkteken in de argv.
  const srv = m.leesPs([
    '  50     1   0:01.00  1000 /opt/homebrew/bin/node /Users/c/Projects/varve-stems/w/server/index.js --meting=/var/folders/x/T/varve-beeld-lokaal-x',
    '  51     1   0:01.00  1000 /opt/homebrew/bin/node server/index.js',
    '  52     1   0:01.00  1000 /opt/homebrew/bin/node /Users/c/Desktop/1. Projects/Youtube mixer/server/index.js',
    '  60     1   0:01.00  1000 /opt/homebrew/bin/node /w/server/index.js --meting=/var/folders/x/T/varve-zaalbeeld-y',
    '  61     1   0:01.00  1000 /pad/Google Chrome for Testing --user-data-dir=/var/folders/x/T/varve-zaalbeeld-y/profiel',
  ].join('\n'));
  const wegS = m.teOpruimen(srv, 7712, 1).map((r) => r.pid);
  ok('de proefserver met --meting=…/varve-beeld-lokaal-… wordt gevonden, Clay\'s server (node server/index.js, 8777) niet',
    wegS.join() === '50');
  const wegZ = m.teOpruimen([...srv, ...rijen], null, 11, 'varve-zaalbeeld-').map((r) => r.pid);
  ok('zaalbeeld --opruimen (voorvoegsel varve-zaalbeeld-, geen relay): zijn server en Chrome, niets van beeld-lokaal of een relay',
    wegZ.join() === '60,61');
  const z = bron('tools/headless/zaalbeeld.mjs'), b = bron('tools/headless/beeld-lokaal.mjs');
  ok('beide scripts geven de proefserver het merkteken --meting=<tmp> mee', /server\/index\.js'\), `--meting=\$\{tmp\}`\]/.test(z) && /server\/index\.js'\), `--meting=\$\{tmp\}`\]/.test(b));
  ok('zaalbeeld.mjs kent --opruimen', /process\.argv\.includes\('--opruimen'\)/.test(z) && /await ruimOp\(null, VOORVOEGSEL\)/.test(z));
}

console.log('\nCtrl-C ruimt op (review 10 okt, punt 3)');
{
  const z = bron('tools/headless/zaalbeeld.mjs'), b = bron('tools/headless/beeld-lokaal.mjs');
  const zelftest = b.slice(b.indexOf('async function zelftest('), b.indexOf('// ---- de volledige run'));
  ok('de zelftest zet de signaalhandlers (eerst niet: na Ctrl-C bleef zijn Chrome op 9391 draaien)', /zetSignalen\(/.test(zelftest));
  ok('zaalbeeld.mjs start zijn kinderen via start() van beeld-lokaal.mjs en zet de signaalhandlers (met de tijdelijke map weg)',
    !/\bspawn\(/.test(z) && /zetSignalen\(\(\) => rmSync\(tmp/.test(z) && /\bstart\(process\.execPath/.test(z));
  ok('de handlers stoppen de hele procesgroep en wachten (SIGKILL na 1,5 s), dan pas de map weg en exit',
    /process\.kill\(-p\.pid, 'SIGTERM'\)/.test(b) && /await wachtTotWeg\(1500\)/.test(b) && /naStop/.test(b));
}

console.log('\nna Ctrl-C geen misleidende FAIL-regel (review 2, punt 4)');
{
  // Een kind-node die beeld-lokaal.mjs laadt, een proces start (sleep, eigen
  // procesgroep), zichzelf SIGINT stuurt en daarna nog een check doet, zoals de
  // hoofdlus die nog even doorloopt terwijl dood() opruimt.
  const KIND = `const m = await import(process.env.VARVE_TEST_MOD);
    m.zetSignalen(() => console.log('naStop: tijdelijke map weg'));
    const k = m.start('sleep', ['30']);
    console.log('kind ' + k.pid);
    m.ok('voor het signaal', false, 'hoort te verschijnen');
    process.kill(process.pid, 'SIGINT');
    await new Promise((r) => setTimeout(r, 40));
    m.ok('na het signaal', false, 'hoort niet te verschijnen');
    console.log('vlag ' + m.isAfgebroken());
    await new Promise((r) => setTimeout(r, 5000));
    console.log('hier komt hij niet');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', KIND], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, VARVE_TEST_MOD: new URL('../tools/headless/beeld-lokaal.mjs', import.meta.url).href } });
  const uit = r.stdout ?? '', fout = r.stderr ?? '';
  const pid = Number((uit.match(/kind (\d+)/) || [])[1]);
  let leeft = false;
  try { process.kill(pid, 0); leeft = true; } catch (_) {}
  ok('vóór het signaal meldt ok() gewoon (FAIL voor het signaal)', /FAIL {2}voor het signaal/.test(uit));
  ok('na het signaal zwijgt ok(): geen FAIL-regel meer', !/na het signaal/.test(uit) && (uit.match(/FAIL/g) || []).length === 1);
  ok('isAfgebroken() is waar zodra de handler loopt', /vlag true/.test(uit));
  ok('de handler meldt het signaal en het einde, ruimt op (naStop) en sluit af met 130', r.status === 130 && /SIGINT: alles van deze meting stoppen/.test(fout)
    && /afgebroken: opgeruimd, exit 130/.test(fout) && /naStop: tijdelijke map weg/.test(uit) && !/hier komt hij niet/.test(uit));
  ok('het kind (sleep, eigen procesgroep) is gestopt', pid > 0 && !leeft);
  if (leeft) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
  const z = bron('tools/headless/zaalbeeld.mjs'), b = bron('tools/headless/beeld-lokaal.mjs');
  ok('zaalbeeld.mjs en het hoofdprogramma laten de exitcode aan de handler (geen process.exit na een signaal)',
    /if \(isAfgebroken\(\)\) return;/.test(z) && /if \(!isAfgebroken\(\)\) process\.exit\(code\)/.test(z) && /if \(!afgebroken\) process\.exit\(code\)/.test(b));
}

console.log('\nde CPU-poort: systeem is achtergrond, een ander proces stopt de run (review 10 okt, punt 5)');
{
  const top = [
    { pid: 1, kern: 0.6, cmd: '/System/Library/PrivateFrameworks/MediaAnalysis.framework/Versions/A/mediaanalysisd' },
    { pid: 2, kern: 0.3, cmd: '/opt/homebrew/bin/node /Users/c/Projects/varve-stems/x/test/x.test.mjs' },
    { pid: 3, kern: 0.24, cmd: '/System/Library/Frameworks/FileProvider.framework/Support/fileproviderd' },
    { pid: 4, kern: 0.27, cmd: '/Users/c/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' },
    { pid: 5, kern: 0.15, cmd: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { pid: 6, kern: 0.25, cmd: '/usr/libexec/airportd' },
  ];
  const p = m.cpuPoort(top);
  ok('mediaanalysisd 60 % en fileproviderd 24 % en /usr/libexec/… 25 % stoppen niet: achtergrond', p.achtergrond.map((t) => t.pid).join() === '1,3,6');
  ok('node …/test/x.test.mjs 30 % en een headless shell 27 % stoppen wel; Clay\'s Chrome op 15 % niet', p.ander.map((t) => t.pid).join() === '2,4');
  ok('de top-5 draagt systeem ja/nee', p.top5.length === 5 && p.top5[0].systeem === true && p.top5[1].systeem === false);
  ok('isSysteem: /System/, /usr/libexec/, /usr/sbin/, /sbin/, /Library/Apple/; niet /Applications/ of /opt/',
    ['/System/x', '/usr/libexec/x', '/usr/sbin/x', '/sbin/launchd', '/Library/Apple/System/x'].every(m.isSysteem)
    && !['/Applications/Google Chrome.app/x', '/opt/homebrew/bin/node', 'node server/index.js', '/Users/c/System/x'].some(m.isSysteem));
  ok('kortNaam: mediaanalysisd, node test/x.test.mjs, Google Chrome (spatie in het pad)',
    m.kortNaam(top[0].cmd) === 'mediaanalysisd' && m.kortNaam(top[1].cmd) === 'node test/x.test.mjs' && m.kortNaam(top[4].cmd) === 'Google Chrome');
}

console.log('\nde omgeving van de proefserver (review 10 okt, punt 7)');
{
  const clay = { HOME: '/Users/c', VARVE_BACKUPS: '/Users/c/echte-backups', VARVE_NACHT: '/Users/c/nacht.json', VARVE_HOSTS: 'mac.tail1234.ts.net',
    VARVE_DB: '/Users/c/media/library.db', VARVE_TESTSERVER: '0', VARVE_MEDIA: '/Users/c/media', VARVE_KAART: '/Users/c/kaart.json' };
  const e = m.proefEnv('/var/T/varve-beeld-lokaal-q', 8801, '/var/T/varve-beeld-lokaal-q/nep/yt-dlp', clay);
  ok('elk pad van de server in de tijdelijke map, ook als Clay\'s omgeving ze zet (backups, nacht, db, media, kaart)',
    m.PROEF_PADEN.every((k) => String(e[k]).startsWith('/var/T/varve-beeld-lokaal-q/')));
  // VI2: VARVE_MEDIA alleen is geen testserver meer; zonder de vlag startte een proefserver de echte Demucs.
  ok('VARVE_TESTSERVER=1, ook als Clay\'s omgeving iets anders zegt (stems en tellen uit, VI2)', e.VARVE_TESTSERVER === '1');
  ok('geen extra hosts, geen heranalyse, de nep-yt-dlp, de poort; de rest van de omgeving blijft', e.VARVE_HOSTS === '' && e.VARVE_HERANALYSE === 'uit'
    && e.VARVE_YTDLP.endsWith('/nep/yt-dlp') && e.PORT === '8801' && e.HOME === '/Users/c');
  // Elke VARVE_-variabele die de server leest, is een pad in PROEF_PADEN of staat hieronder als geen pad.
  // VARVE_AVONDPAKKET_NEP (spoor draagbaar) is de fixturemap van de tests: alleen lezen, zet niets op Clay's schijf.
  const GEEN_PAD = new Set(['VARVE_BACKUP_ELKE', 'VARVE_UPLOAD_MAX', 'VARVE_HERANALYSE', 'VARVE_HOSTS', 'VARVE_YTDLP', 'VARVE_AVONDPAKKET_NEP']);
  const gelezen = new Set();
  for (const f of readdirSync(new URL('../server/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    for (const [, k] of bron(`server/${f}`).matchAll(/process\.env\.(VARVE_[A-Z_]+)/g)) gelezen.add(k);
  }
  const los = [...gelezen].filter((k) => !m.PROEF_PADEN.includes(k) && !GEEN_PAD.has(k));
  ok(`elke VARVE_-variabele van server/ is gedekt (${gelezen.size} gelezen; nieuw en niet gedekt: ${los.join(', ') || 'geen'})`, gelezen.size >= 10 && !los.length);
  const z = bron('tools/headless/zaalbeeld.mjs'), b = bron('tools/headless/beeld-lokaal.mjs');
  ok('beide scripts starten de proefserver met proefEnv(tmp, …)', /env: proefEnv\(tmp, POORT,/.test(z) && /env: proefEnv\(tmp, o\.poort,/.test(b));
}

console.log('\nde hartslag-worklet zelf, met een nepklok');
{
  let geregistreerd = null;
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, verstuurd: [], postMessage(x) { this.verstuurd.push(x); } }; } }
  new Function('AudioWorkletProcessor', 'registerProcessor', m.HART_CODE)(AudioWorkletProcessor, (naam, k) => { geregistreerd = [naam, k]; });
  ok('registreert varve-hart', geregistreerd?.[0] === 'varve-hart');
  const echtNu = Date.now;
  let klok = 1000;
  Date.now = () => klok;
  try {
    const h = new geregistreerd[1]();
    for (const t of [1000, 1003, 1006, 1030, 1033, 1050, 1053]) { klok = t; ok.stil = h.process(); }
    h.port.onmessage();
    const r = h.port.verstuurd[0];
    ok('grootste gat 24 ms, twee gaten > 15 ms (24 en 17), zeven blokken', r.max === 24 && r.n15 === 2 && r.n === 7);
    ok('process() geeft true (de node blijft leven)', ok.stil === true);
    h.port.onmessage();
    ok('lezen zet de tellers op nul', h.port.verstuurd[1].max === 0 && h.port.verstuurd[1].n15 === 0 && h.port.verstuurd[1].n === 0);
    klok = 1100; h.process();
    h.port.onmessage();
    ok('na het lezen telt het gat sinds het vorige blok gewoon mee (47 ms)', h.port.verstuurd[2].max === 47 && h.port.verstuurd[2].n15 === 1);
  } finally { Date.now = echtNu; }
  let stal = null;
  new Function('AudioWorkletProcessor', 'registerProcessor', m.STAL_CODE)(AudioWorkletProcessor, (naam, k) => { stal = [naam, k]; });
  const s = new stal[1]();
  // Date.now() telt hele ms: "5 ms" is in wandtijd minstens 4 ms (begint de lus vlak voor een ms-grens).
  s.port.onmessage({ data: 5 });
  const t0 = performance.now(); s.process(); const duur = performance.now() - t0;
  ok('varve-stal blokkeert op bevel en meldt hoe lang (5 ms), daarna niet meer', stal[0] === 'varve-stal' && duur >= 3.9 && s.port.verstuurd[0] >= 5 && s.stal === 0);
  let syntax = true;
  try { new Function(`return ${m.METERS('window.engine.ctx')}`); new Function(`return ${m.POSITIEVE_CONTROLE(40)}`); new Function(`return ${m.RAF_METER}`); } catch (_) { syntax = false; }
  ok('de paginacode (meters, positieve controle, rAF-meter) is geldig JavaScript', syntax);
  ok(`de positieve controle blokkeert ${m.CONTROLE_MS} ms en de gatengrens is ${m.GAT_MS} ms (ontwerp: 40 en 15)`,
    m.CONTROLE_MS === 40 && m.GAT_MS === 15 && /postMessage\(40\)/.test(m.POSITIEVE_CONTROLE(40)));
  ok('de meters hangen de hartslag met gain 0 aan de uitgang (er klinkt niets extra)', /gain: 0/.test(m.METERS('c')) && /gain: 0/.test(m.POSITIEVE_CONTROLE()));
}

console.log('\nde Mac-meters alleen op de Mac (spoor C2: pmset, sysctl, plutil, swiftc)');
{
  const gevraagd = [];
  const spion = (cmd, args) => { gevraagd.push(`${cmd} ${args.join(' ')}`); return null; };
  const lx = m.machineNu(null, { platform: 'linux', run: spion });
  ok(`linux: machineNu roept niets aan, zegt "${m.NIET_HIER}", kernen en belasting uit node:os`, gevraagd.length === 0 && lx.nietGemeten.includes(m.NIET_HIER)
    && Number.isInteger(lx.kernen) && lx.kernen > 0 && /^\d+\.\d\d \d+\.\d\d \d+\.\d\d$/.test(lx.loadavg) && lx.accu === null && lx.watt === null && lx.warmte === null);
  ok('linux: geluidUit = null (niet gemeten, niet "er speelt niets"), zonder pmset', m.geluidUit({ platform: 'linux', run: spion }) === null && gevraagd.length === 0);
  ok('linux: geen warmtemeter (geen swiftc gestart)', m.maakWarmte('/bestaat/niet', { platform: 'linux' }) === null && !m.isMac('linux') && m.isMac('darwin'));
  const mac = (cmd, args) => ({
    'pmset -g batt': "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t65%; charging; 1:02 remaining present: true",
    'pmset -g ac': ' Wattage = 8W\n Current = 1500mA', 'pmset -g': ' lowpowermode         0', 'sysctl -n hw.model': 'MacBookAir10,1',
    'sysctl -n hw.ncpu': '8', 'sysctl -n vm.loadavg': '{ 1.10 1.20 1.30 }',
    'pmset -g assertions': '   pid 312(coreaudiod): [0x0001] 00:01:02 PreventUserIdleSystemSleep named: "com.apple.audio.AppleUSBAudioEngine:audio-out"\n   pid 9(x): iets anders',
  })[`${cmd} ${args.join(' ')}`] ?? null;
  const d = m.machineNu(null, { platform: 'darwin', run: mac });
  ok('darwin: machineNu leest pmset en sysctl zoals voorheen (AC Power, 65 %, laadt, 8 W, LPM uit, model, 8 kernen)', d.stroom === 'AC Power' && d.accu === 65 && d.laadt === true
    && d.watt === 8 && d.lowPowerMode === false && d.model === 'MacBookAir10,1' && d.kernen === 8 && d.loadavg === '{ 1.10 1.20 1.30 }' && d.nietGemeten === undefined);
  ok('darwin: geluidUit geeft de audio-out-regels', m.geluidUit({ platform: 'darwin', run: mac }).length === 1);
  if (process.platform !== 'darwin') {
    let fout = '';
    try { m.zoekChrome(null); } catch (e) { fout = e.message; }
    ok(`niet op de Mac: zoekChrome zonder VARVE_CHROME zegt waarom (${fout})`, fout.includes(m.NIET_HIER) && /VARVE_CHROME/.test(fout));
    ok('niet op de Mac: met VARVE_CHROME gewoon dat pad', m.zoekChrome('/opt/chrome') === '/opt/chrome');
  } else ok('zoekChrome op de Mac: niet hier getoetst (de Playwright-cache), zie --zelftest', true);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
