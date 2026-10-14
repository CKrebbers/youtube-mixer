// media/ buiten iCloud (VI2): server/media-plek.js, tools/media-verhuis.mjs en de
// ontkoppeling van VARVE_TESTSERVER. Alles op een nepmap in een tijdelijke map;
// "draait de server" is een nep-poortcheck. Raakt nooit Clay's media/.
// Draai met: node test/media-verhuis.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, openSync, ftruncateSync, closeSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestserver, iCloudReden, verhuisdNaar, verhuisdTekst, kiesMedia, echtPad, VERHUISD_BESTAND } from '../server/media-plek.js';
import { maakPlan, voerUit, telMap, controleerDb, planTekst, envRegels, STANDAARD_DOEL, SSD_MELDING } from '../tools/media-verhuis.mjs';
import { stemsCommando, STANDAARD_PY } from '../server/stems.js';
import { tellenCommando } from '../server/tellen.js';
import { Library } from '../server/library.js';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const WORTEL = fileURLToPath(new URL('..', import.meta.url));

const map = mkdtempSync(join(tmpdir(), 'varve-verhuis-'));
const schrijf = (p, inhoud = 'x') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, inhoud); };
const nietOpen = async () => false;

try {
  // ======================================================================
  console.log('VARVE_TESTSERVER los van VARVE_MEDIA');
  ok('alleen VARVE_TESTSERVER=1 is een testserver', isTestserver({ VARVE_TESTSERVER: '1' })
    && !isTestserver({ VARVE_MEDIA: '/m' }) && !isTestserver({}) && !isTestserver({ VARVE_TESTSERVER: '0' }));
  ok('stems: alleen VARVE_MEDIA laat de venv aan', stemsCommando({ VARVE_MEDIA: '/Users/x/Varve-media' }).cmd === STANDAARD_PY);
  ok('tellen: alleen VARVE_MEDIA laat de venv aan', !tellenCommando({ VARVE_MEDIA: '/Users/x/Varve-media' }).uit);
  ok('stems en tellen: VARVE_TESTSERVER=1 zet ze uit', !!stemsCommando({ VARVE_TESTSERVER: '1' }).uit && !!tellenCommando({ VARVE_TESTSERVER: '1' }).uit);
  {
    // Elke testserver in test/ en tools/headless/ die VARVE_MEDIA zet, zet ook de vlag;
    // anders start een test die iets binnenhaalt de echte Demucs.
    const zonder = [];
    for (const dir of ['test', 'tools/headless']) {
      for (const f of readdirSync(join(WORTEL, dir)).filter((n) => /\.mjs$/.test(n) && n !== 'media-verhuis.test.mjs')) {
        for (const [i, regel] of readFileSync(join(WORTEL, dir, f), 'utf8').split('\n').entries()) {
          if (/VARVE_MEDIA:/.test(regel) && !/VARVE_TESTSERVER/.test(regel) && !/Commando\(|Splitter\(/.test(regel)) zonder.push(`${dir}/${f}:${i + 1}`);
        }
      }
    }
    ok(`elke testserver met VARVE_MEDIA zet VARVE_TESTSERVER (${zonder.slice(0, 3).join(', ') || 'geen uitzonderingen'})`, zonder.length === 0);
  }

  // ======================================================================
  console.log('\nbinnen iCloud?');
  const thuis = join(map, 'thuis');
  mkdirSync(join(thuis, 'Desktop', 'proj'), { recursive: true });
  mkdirSync(join(thuis, 'Documents'), { recursive: true });
  mkdirSync(join(thuis, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true });
  ok('Bureaublad zonder iCloud-koppeling: niet in iCloud', iCloudReden(join(thuis, 'Desktop', 'proj'), { thuis }) === null);
  symlinkSync(join(thuis, 'Desktop'), join(thuis, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop'));
  const r1 = iCloudReden(join(thuis, 'Desktop', 'proj', 'media'), { thuis });
  ok(`Bureaublad in iCloud: media/ daaronder ook, ook als hij nog niet bestaat ("${r1}")`, /Desktop/.test(r1 ?? ''));
  ok('Documenten zonder koppeling: niet', iCloudReden(join(thuis, 'Documents', 'x'), { thuis }) === null);
  ok('iCloud Drive zelf: wel', /iCloud Drive/.test(iCloudReden(join(thuis, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'y'), { thuis }) ?? ''));
  ok('~/Varve-media: niet', iCloudReden(join(thuis, 'Varve-media'), { thuis }) === null);
  ok('~/Desktop-kopie (zelfde begin, andere map): niet', iCloudReden(join(thuis, 'Desktopje'), { thuis }) === null);
  ok('echtPad lost /tmp-achtige koppelingen ook op voor een pad dat niet bestaat',
    echtPad(join(thuis, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop', 'nieuw')) === join(echtPad(join(thuis, 'Desktop')), 'nieuw'));

  // ======================================================================
  console.log('\nmedia-VERHUISD.txt en de keuze van de server');
  const repo = join(map, 'repo');
  mkdirSync(repo, { recursive: true });
  ok('VARVE_MEDIA gaat voor', kiesMedia({ env: { VARVE_MEDIA: '/a/b' }, wortel: repo }).map === '/a/b');
  ok('zonder briefje en zonder media/: de standaard', kiesMedia({ env: {}, wortel: repo }).bron === 'standaard');
  writeFileSync(join(repo, VERHUISD_BESTAND), verhuisdTekst({ bron: join(repo, 'media'), doel: '/Users/clay/Varve media', wanneer: new Date(0) }));
  ok('het briefje wordt gelezen (ook met een spatie in het pad)', verhuisdNaar(repo) === '/Users/clay/Varve media');
  const k = kiesMedia({ env: {}, wortel: repo });
  ok('media/ weg + briefje: de server volgt het briefje', k.map === '/Users/clay/Varve media' && k.bron === VERHUISD_BESTAND);
  ok('een testserver volgt het briefje nooit', kiesMedia({ env: { VARVE_TESTSERVER: '1' }, wortel: repo }).bron === 'standaard');
  mkdirSync(join(repo, 'media'));
  ok('staat media/ er (weer), dan die: het briefje is alleen een vangnet', kiesMedia({ env: {}, wortel: repo }).bron === 'standaard');
  ok('een briefje zonder VARVE_MEDIA-regel telt niet', verhuisdNaar(repo, { lees: () => 'zomaar tekst\n/Users/x' }) === null);
  ok('export VARVE_MEDIA="…" mag ook', verhuisdNaar(repo, { lees: () => 'export VARVE_MEDIA="/Users/x/Varve-media"\n' }) === '/Users/x/Varve-media');

  // ======================================================================
  console.log('\nde droogloop op een nepmap');
  const proj = join(thuis, 'Desktop', 'proj');
  const bron = join(proj, 'media');
  schrijf(join(bron, 'aaa', 'audio.wav'), Buffer.alloc(4096, 1));
  schrijf(join(bron, 'aaa', 'peaks.bin'), Buffer.alloc(100, 2));
  schrijf(join(bron, 'bbb', 'audio.wav'), Buffer.alloc(2048, 3));
  {
    const lib = new Library(join(bron, 'library.db'));
    lib.db.prepare(`INSERT INTO tracks (id, url, titel, audio, video, toegevoegd) VALUES
      ('aaa', 'https://x/aaa', 'Een', 'media/aaa/audio.wav', NULL, 1), ('bbb', 'https://x/bbb', 'Twee', 'media/bbb/audio.wav', 'media/bbb/video.mp4', 2)`).run();
    lib.db.prepare(`INSERT INTO peaks (track_id, bestand, buckets, per_bucket, gemaakt) VALUES ('aaa', 'media/aaa/peaks.bin', 10, 10, 1)`).run();
    lib.db.close();
  }
  const doel = join(thuis, 'Varve-media');
  let gevraagd = [];
  const plan = await maakPlan({ bron, doel, thuis, env: {}, isOpen: async (p) => { gevraagd.push(p); return false; }, dataless: () => [] });
  ok(`kan: niets in de weg (${plan.blokkades.join('; ') || 'geen blokkades'})`, plan.kan === true);
  ok('de bron ligt in iCloud, het doel niet', /Desktop/.test(plan.iCloudBron ?? '') && plan.iCloudDoel === null);
  ok('zelfde schijf', plan.zelfdeSchijf === true);
  ok(`telt de bestanden (${plan.telling.bestanden}) en de bytes (${plan.telling.bytes})`, plan.telling.bestanden >= 4 && plan.telling.bytes >= 4096 + 100 + 2048);
  ok('niets uitgeplaatst', plan.telling.uitgeplaatst.length === 0);
  ok('de poortcheck gebruikt standaard 8777', gevraagd.length === 1 && gevraagd[0] === 8777);
  ok(`library.db: alle paden relatief (${JSON.stringify(plan.db)})`, plan.db.tracks === 2 && plan.db.paden === 4 && plan.db.buiten === 0);
  ok('zonder VARVE_BACKUPS: de melding over de externe SSD', plan.backups.melding === SSD_MELDING && /externe SSD/.test(SSD_MELDING));
  ok('met VARVE_BACKUPS: die plek', (await maakPlan({ bron, doel, thuis, env: { VARVE_BACKUPS: '/Volumes/X/b' }, isOpen: nietOpen, dataless: () => [] })).backups.pad === '/Volumes/X/b');
  const tekst = planTekst(plan);
  ok('het plan als tekst: bron, doel, grootte, server, de env-regels', tekst.includes(bron) && tekst.includes(doel) && /GB/.test(tekst)
    && /draait niet/.test(tekst) && tekst.includes('~/.zprofile') && tekst.includes('~/.varve/media-pad') && /externe SSD/.test(tekst));
  ok('de droogloop verandert niets', existsSync(bron) && !existsSync(doel) && !existsSync(join(proj, VERHUISD_BESTAND)));
  ok('standaarddoel is ~/Varve-media', /\/Varve-media$/.test(STANDAARD_DOEL));
  ok('env-regels: VARVE_MEDIA in .zprofile en het pad in ~/.varve/media-pad', envRegels('/Users/x/Varve-media').some((r) => /export VARVE_MEDIA=/.test(r))
    && envRegels('/Users/x/Varve-media').some((r) => /media-pad/.test(r)));

  // ======================================================================
  console.log('\nwat in de weg staat');
  {
    const p = await maakPlan({ bron, doel, thuis, env: {}, isOpen: async (poort) => poort === 8777, dataless: () => [] });
    ok('de server draait: niet', !p.kan && p.blokkades.some((b) => /server draait/.test(b)) && /draait \(poort 8777\)/.test(planTekst(p)));
    let fout = '';
    try { await voerUit(p, { isOpen: nietOpen }); } catch (err) { fout = err.message; }
    ok('voerUit weigert een plan met blokkades', /niet verhuisd/.test(fout) && existsSync(bron));
  }
  {
    const p = await maakPlan({ bron, doel, thuis, env: {}, isOpen: nietOpen, dataless: () => ['aaa/audio.wav'] });
    ok('uitgeplaatst (find -flags +dataless): eerst binnenhalen', !p.kan && p.blokkades.some((b) => /binnenhalen/.test(b)));
  }
  {
    schrijf(join(bron, 'ccc', '.stems.wav.icloud'), 'plaatshouder');
    const fd = openSync(join(bron, 'ccc', 'leeg-op-schijf.wav'), 'w'); ftruncateSync(fd, 10 * 1024 * 1024); closeSync(fd);
    const t = telMap(bron);
    ok(`een .icloud-plaatshouder en een bestand zonder blokken tellen als uitgeplaatst (${t.uitgeplaatst.join(', ')})`,
      t.uitgeplaatst.includes(join('ccc', '.stems.wav.icloud')) && t.uitgeplaatst.includes(join('ccc', 'leeg-op-schijf.wav')));
    const p = await maakPlan({ bron, doel, thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('dan niet verhuizen', !p.kan && /Kan nu niet/.test(planTekst(p)));
    rmSync(join(bron, 'ccc'), { recursive: true });   // eigen nepbestanden van deze test
  }
  {
    mkdirSync(join(thuis, 'bestaat'));
    const p = await maakPlan({ bron, doel: join(thuis, 'bestaat'), thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('het doel bestaat al: niet (niets overschrijven of samenvoegen)', !p.kan && p.blokkades.some((b) => /bestaat al/.test(b)));
    const p2 = await maakPlan({ bron, doel: join(thuis, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Varve'), thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('het doel in iCloud: niet', !p2.kan && p2.blokkades.some((b) => /zelf in iCloud/.test(b)));
    const p3 = await maakPlan({ bron, doel: join(bron, 'binnen'), thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('het doel in de bron: niet', !p3.kan && p3.blokkades.some((b) => /in elkaar/.test(b)));
    const p4 = await maakPlan({ bron: join(proj, 'bestaat-niet'), doel, thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('een bron die niet bestaat: niet', !p4.kan && p4.blokkades.some((b) => /bestaat niet/.test(b)));
    schrijf(join(proj, 'server', 'index.js'), '// oude server');
    const p6 = await maakPlan({ bron, doel, thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('de server in de projectmap is van vóór VI2: niet', !p6.kan && p6.blokkades.some((b) => /vóór VI2/.test(b)));
    schrijf(join(proj, 'server', 'media-plek.js'), '// nieuw');
    ok('met server/media-plek.js: wel', (await maakPlan({ bron, doel, thuis, env: {}, isOpen: nietOpen, dataless: () => [] })).kan);
    symlinkSync(bron, join(proj, 'koppeling'));
    const p5 = await maakPlan({ bron: join(proj, 'koppeling'), doel, thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    ok('een bron die een koppeling is: niet (dan zou alleen de koppeling verhuizen)', !p5.kan && p5.blokkades.some((b) => /koppeling/.test(b)));
  }
  {
    const db2 = join(map, 'abs', 'library.db');
    mkdirSync(join(map, 'abs'));
    const lib = new Library(db2);
    lib.db.prepare(`INSERT INTO tracks (id, url, titel, audio, toegevoegd) VALUES ('x', 'https://x/x', 'X', '/Users/clay/Desktop/media/x/audio.wav', 1)`).run();
    lib.db.close();
    const c = await controleerDb(db2);
    ok(`een absoluut pad in de db wordt gevonden (${c.voorbeelden[0]})`, c.buiten === 1 && /x: \/Users/.test(c.voorbeelden[0]));
    ok('geen db: null', (await controleerDb(join(map, 'nergens.db'))) === null);
  }

  // ======================================================================
  console.log('\n--doe');
  {
    const p = await maakPlan({ bron, doel, thuis, env: {}, isOpen: nietOpen, dataless: () => [] });
    let fout = '';
    try { await voerUit(p, { isOpen: async () => true }); } catch (err) { fout = err.message; }
    ok('draait de server intussen toch: niet verhuisd', /intussen/.test(fout) && existsSync(bron) && !existsSync(doel));
    try { await voerUit(p, { isOpen: nietOpen, rename: () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; } }); fout = ''; } catch (err) { fout = err.message; }
    ok('andere schijf (EXDEV): een duidelijke fout, niets gewist', /andere schijf/.test(fout) && existsSync(bron) && !existsSync(join(proj, VERHUISD_BESTAND)));
    const { briefje } = await voerUit(p, { isOpen: nietOpen, nu: new Date('2026-10-12T10:00:00Z') });
    ok('verhuisd: de map staat op het doel, alles erin', !existsSync(bron) && existsSync(join(doel, 'aaa', 'audio.wav'))
      && readFileSync(join(doel, 'aaa', 'audio.wav')).length === 4096 && existsSync(join(doel, 'library.db')));
    ok('media-VERHUISD.txt staat waar media/ stond, met het nieuwe pad', briefje === join(proj, VERHUISD_BESTAND) && verhuisdNaar(proj) === doel);
    ok('en de server zou het volgen', kiesMedia({ env: {}, wortel: proj }).map === doel);
    const lib = new Library(join(doel, 'library.db'));
    ok('de library leest daarna gewoon (zelfde paden, relatief)', lib.db.prepare('SELECT audio FROM tracks WHERE id = ?').get('aaa').audio === 'media/aaa/audio.wav');
    lib.db.close();
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
