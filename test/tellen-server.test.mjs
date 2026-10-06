// Tellen op de server (docs/BEATGRID.md §11) zonder Python: de zoeker, de
// rij en het GPU-slot los, en dan een EIGEN server (eigen poort, tijdelijke
// database en media) met een nep-tellenzoeker (test/nep-tellen.mjs) en een
// nep-splitter: de achtergrond maakt grids uit de tellen, een met de hand
// gezet grid of een grid op slot blijft staan, ↻ gebruikt de tellen, een
// nieuw nummer krijgt zijn tellen na de ingest, en tellen en stems gebruiken
// de GPU om de beurt.
// Draai met: node test/tellen-server.test.mjs
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const { Library } = await import('../server/library.js');
const ing = await import('../server/ingest.js');
const tl = await import('../server/tellen.js');
const { maakNepTellen } = await import('./nep-tellen.mjs');
const { maakNepStems } = await import('./nep-stems.mjs');

const fails = [];
const ok = (naam, cond, info = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (!cond && info ? `  (${info})` : '')); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-tellen-'));
const nepTellen = maakNepTellen(map);
const nepStems = maakNepStems(map);
const tLog = join(map, 'nep-tellen.log'), sLog = join(map, 'nep-stems.log');
const regels = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
let server = null;

try {
  // ======================================================================
  console.log('het commando');
  {
    const c1 = tl.tellenCommando({ VARVE_TELLEN_CMD: '/x/nep', VARVE_STEMS_PY: '/y/python', VARVE_MEDIA: '/m' });
    const c2 = tl.tellenCommando({ VARVE_STEMS_PY: '/y/python', VARVE_MEDIA: '/m' });
    const c3 = tl.tellenCommando({ VARVE_TELLEN_PY: '/z/python', VARVE_STEMS_PY: '/y/python' });
    const c4 = tl.tellenCommando({ VARVE_MEDIA: '/m' });
    ok('VARVE_TELLEN_CMD vervangt het hele commando', c1.cmd === '/x/nep' && c1.args.length === 0);
    ok('zonder eigen Python: die van de stems, met server/tellen/tellen.py', c2.cmd === '/y/python' && c2.args[0].endsWith('server/tellen/tellen.py'));
    ok('VARVE_TELLEN_PY gaat voor', c3.cmd === '/z/python');
    ok('een testserver zonder een van deze: uit, met de reden', !!c4.uit && /VARVE_TELLEN_CMD/.test(c4.uit));
    const z = new tl.Tellenzoeker({ env: { VARVE_TELLEN_CMD: nepTellen } });
    const c = await z.controleer();
    ok('de controle met de nep-zoeker: klaar', c.ok === true && c.commando === nepTellen);
    const zonder = await new tl.Tellenzoeker({ env: { VARVE_TELLEN_PY: join(map, 'bestaat-niet', 'python') } }).controleer();
    ok('geen Python: niet klaar, met hoe je hem installeert', !zonder.ok && /beat-this/.test(zonder.reden));
    // De zoeker start zijn commando met de omgeving van de server (zoals de splitter): zet het daar.
    process.env.NEP_TELLEN_ONTBREEKT = 'geen beat_this';
    const kapot = await new tl.Tellenzoeker({ env: { VARVE_TELLEN_CMD: nepTellen } }).controleer();
    delete process.env.NEP_TELLEN_ONTBREEKT;
    ok('een kapotte venv: de reden van de zoeker', !kapot.ok && /geen beat_this/.test(kapot.reden));
  }

  // ======================================================================
  console.log('\nééns zoeken, en het bestand lezen');
  const bronWav = join(map, 'bron.wav');
  await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=48000:d=12", '-ac', '2', '-c:a', 'pcm_s16le', bronWav]);
  {
    const media = join(map, 'los');
    mkdirSync(join(media, 'een'), { recursive: true });
    const z = new tl.Tellenzoeker({ env: { VARVE_TELLEN_CMD: nepTellen } });
    const stappen = [];
    const r = await z.zoek({ audio: bronWav, uit: join(media, 'een', tl.TELLEN_BESTAND), onVoortgang: (x) => stappen.push(x) });
    ok('zoeken: ok, met voortgang', r.ok && stappen.length >= 5 && stappen.at(-1) === 1);
    const t = await tl.leesTellen(media, 'een');
    ok('tellen.json gelezen: gesorteerd, 120 bpm, de downbeats erbij', t && t.beats.length === 24 && Math.abs(t.beats[1] - t.beats[0] - 0.5) < 1e-6
      && t.downbeats.length === 6 && t.versie === 1);
    ok('nog eens lezen: uit het geheugen (hetzelfde object)', (await tl.leesTellen(media, 'een')) === t);
    writeFileSync(join(media, 'een', tl.TELLEN_BESTAND), JSON.stringify({ versie: 1, beats: [1, -2], downbeats: [] }));
    ok('een negatieve tijd: onleesbaar (null)', (await tl.leesTellen(media, 'een')) === null);
    writeFileSync(join(media, 'een', tl.TELLEN_BESTAND), '{ kapot');
    ok('geen JSON: null', (await tl.leesTellen(media, 'een')) === null);
    ok('een rare id: null, zonder te lezen', (await tl.leesTellen(media, '../een')) === null);
    await tl.wisTellen(media, 'een');
    ok('wisTellen: weg', !existsSync(join(media, 'een', tl.TELLEN_BESTAND)));
    const kapot = await z.zoek({ audio: join(map, 'kapot.wav'), uit: join(media, 'een', tl.TELLEN_BESTAND) });
    ok('een nummer dat faalt: de reden van de zoeker', !kapot.ok && /kapot/.test(kapot.fout));
    const ctrl = new AbortController();
    copyFileSync(bronWav, join(map, 'traag.wav'));
    const lopend = z.zoek({ audio: join(map, 'traag.wav'), uit: join(media, 'een', tl.TELLEN_BESTAND), signal: ctrl.signal });
    await wacht(300);
    ctrl.abort();
    const af = await lopend;
    ok('annuleren: afgebroken, geen half bestand', af.afgebroken === true && !existsSync(join(media, 'een', tl.TELLEN_BESTAND))
      && !existsSync(join(media, 'een', tl.TELLEN_BESTAND + '.tmp')));
  }

  // ======================================================================
  console.log('\nhet GPU-slot en de rij');
  {
    const slot = new tl.GpuSlot();
    const volgorde = [];
    const a = await slot.pak();
    const b = slot.pak().then((laat) => { volgorde.push('b'); return laat; });
    const ctrl = new AbortController();
    const c = slot.pak(ctrl.signal).then((laat) => { volgorde.push(laat ? 'c' : 'c-weg'); return laat; });
    const d = slot.pak().then((laat) => { volgorde.push('d'); return laat; });
    await wacht(10);
    ok('bezet: de anderen wachten', volgorde.length === 0);
    ctrl.abort();
    await wacht(10);
    ok('wie afbreekt terwijl hij wacht, valt uit de rij (null)', volgorde.join() === 'c-weg' && (await c) === null);
    a();
    const lb = await b;
    ok('vrij: de eerstvolgende', volgorde.join() === 'c-weg,b');
    lb(); lb();
    const ld = await d;
    ok('twee keer vrijgeven telt één keer; dan de volgende', volgorde.join() === 'c-weg,b,d' && slot.bezet);
    ld();
    ok('alles vrij', !slot.bezet && slot.wachtend.length === 0);

    const gedaan = [];
    let los = null;
    const rij = new tl.TellenRij({ werk: (id, signal) => new Promise((k) => {
      gedaan.push(id);
      los = k;
      signal.addEventListener('abort', () => k());
    }) });
    rij.voegToe('x'); rij.voegToe('y'); rij.voegToe('y'); rij.voegToe('z'); rij.voegToe('z', { vooraan: true }); rij.voegToe('x');
    ok('de rij: één keer per nummer, vooraan = als volgende, de lopende niet nog eens', rij.huidig?.id === 'x' && rij.rij.join() === 'z,y');
    rij.annuleer('y');
    ok('annuleren uit de rij', rij.rij.join() === 'z');
    await wacht(5);
    los(); await wacht(5);
    ok('klaar: de volgende', gedaan.join() === 'x,z' && rij.bevat('z'));
    rij.annuleer('z'); await wacht(5);
    ok('annuleren van de lopende: gestopt, rij leeg', !rij.open);
  }

  // ======================================================================
  console.log('\nde server');
  const db = join(map, 'library.db');
  const media = join(map, 'media');
  const ids = ['autoA', 'handB', 'slotC', 'nummer-traag'];
  {
    const lib = new Library(db);
    for (const id of ids) {
      mkdirSync(join(media, id), { recursive: true });
      copyFileSync(bronWav, join(media, id, 'audio.wav'));
      lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: `titel ${id}`, uploader: 't', duur: 12,
        audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    }
    // autoA: een automatisch grid van de oude analyse, een octaaf te hoog en een halve tel naast.
    lib.bewaarGrid('autoA', { stukken: [{ van: 0, bpm: 240, anker: 0.5, zekerheid: 0.9 }], bron: 'auto' });
    lib.bewaarGrid('handB', { stukken: [{ van: 0, bpm: 121, anker: 0.3 }], bron: 'hand' });
    lib.bewaarGrid('slotC', { stukken: [{ van: 0, bpm: 119, anker: 0.2 }], bron: 'hand', slot: true });
    lib.bewaarGrid('nummer-traag', { stukken: [{ van: 0, bpm: 100, anker: 0 }], bron: 'auto', zekerheid: 0.9 });
    lib.sluit();
  }
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const B = `http://localhost:${poort}`;
  let uit = '';
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
      VARVE_PLANNEN: join(map, 'plannen'), VARVE_PROEF: join(map, 'proef'), VARVE_HERANALYSE: '100',
      VARVE_TELLEN_CMD: nepTellen, NEP_TELLEN_LOG: tLog, VARVE_STEMS_CMD: nepStems, NEP_STEMS_LOG: sLog, NEP_STEMS_TRAAG_MS: '120' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { uit += d; });
  server.stderr.on('data', (d) => { uit += d; });
  const json = async (pad, init) => { const r = await fetch(B + pad, init); return { status: r.status, j: await r.json().catch(() => null) }; };
  const post = (pad, body) => json(pad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const grid = async (id) => (await json(`/api/library/${id}/grid`)).j?.grid;
  const wachtTot = async (cond, maxMs = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await cond()) return true; await wacht(80); } return false; };

  ok('de server start', await wachtTot(() => fetch(`${B}/api/stems`).then((r) => r.ok).catch(() => false)));
  const tooling = (await json('/api/tooling')).j;
  ok('/api/tooling meldt de tellenzoeker', tooling?.tellen?.ok === true && tooling.tellen.commando === nepTellen);

  ok('de achtergrond: tellen voor elk nummer', await wachtTot(() => ids.every((id) => existsSync(join(media, id, tl.TELLEN_BESTAND)))), uit.slice(-800));
  ok('het automatische grid komt nu uit de tellen', await wachtTot(async () => (await grid('autoA'))?.methode === 'tellen'), JSON.stringify(await grid('autoA')));
  const gA = await grid('autoA');
  ok('… op het tempo van de tellen (120), met de "1" op een downbeat, zeker', Math.abs(gA.stukken[0].bpm - 120) < 0.01
    && Math.abs(gA.stukken[0].maat - 0.25) < 0.002 && gA.stukken[0].zekerheid >= 0.65 && gA.bron === 'auto' && gA.versie >= 1, JSON.stringify(gA));
  ok('… het octaaf van de oude analyse genoteerd? nee: die lag een halve tel naast, dat is oneens', gA.stukken[0].twijfel === undefined || gA.stukken[0].twijfel === 'oneens');
  const gB = await grid('handB'), gC = await grid('slotC');
  ok('een met de hand gezet grid blijft staan', gB.bron === 'hand' && gB.stukken[0].bpm === 121 && !gB.methode);
  ok('een grid op slot ook', gC.slot === true && gC.stukken[0].bpm === 119);
  ok('… en wordt gemeten (in het logboek)', /\[tellen\] titel handB: niet bewaard .*van de tellen raak/.test(uit), uit.slice(-600));

  const t = (await json('/api/library/autoA/tellen')).j;
  ok('GET …/tellen: de tellen en downbeats', t?.beats?.length === 24 && t.downbeats.length === 6 && t.versie === 1);
  ok('GET …/tellen van een onbekend nummer: 404', (await json('/api/library/bestaatniet/tellen')).status === 404);

  console.log('↻ opnieuw analyseren');
  const rB = (await post('/api/library/handB/grid/analyseer', {})).j;
  ok('↻ op een met de hand gezet grid: uit de tellen, bewaard', rB?.bewaard === true && rB.methode === 'tellen' && rB.grid.methode === 'tellen'
    && Math.abs(rB.grid.stukken[0].bpm - 120) < 0.01, JSON.stringify(rB));
  const rC = (await post('/api/library/slotC/grid/analyseer', {})).j;
  ok('↻ op slot zonder forceer: niet bewaard, met de reden', rC?.bewaard === false && /slot/.test(rC.reden) && (await grid('slotC')).stukken[0].bpm === 119);
  const rC2 = (await post('/api/library/slotC/grid/analyseer', { forceer: true })).j;
  ok('↻ op slot met forceer: wel', rC2?.bewaard === true && rC2.grid.methode === 'tellen');

  console.log('de GPU om de beurt');
  // Een trage split loopt; de tellen van een nieuw nummer moeten erop wachten.
  rmSync(join(media, 'nummer-traag', tl.TELLEN_BESTAND), { force: true });
  const s = await post('/api/stems', { track: 'nummer-traag', aantal: 2 });
  ok('een trage split start', s.status === 202 || s.status === 200, JSON.stringify(s));
  await wachtTot(() => regels(sLog).some((r) => r.wat === 'start' && /nummer-traag/.test(r.in)), 5000);
  // (De oude analyse weigert 12 s: "te kort"; dan zegt ↻ dat, en dat de tellen in de rij staan.)
  const rT = (await post('/api/library/nummer-traag/grid/analyseer', {})).j;
  ok('↻ zonder tellen: de oude analyse, en de tellen in de rij', rT?.tellen === 'in de rij' && !rT.methode, JSON.stringify(rT));
  ok('de tellen komen er', await wachtTot(() => existsSync(join(media, 'nummer-traag', tl.TELLEN_BESTAND)), 20000));
  const split = regels(sLog).find((r) => r.wat === 'klaar' && /nummer-traag/.test(r.in));
  const tel = regels(tLog).filter((r) => /nummer-traag/.test(r.in)).at(-1);
  ok('… pas nadat de split klaar was', split && tel && tel.start >= split.t, JSON.stringify({ split, tel }));

  console.log('een nieuw nummer');
  const wav = readFileSync(bronWav);
  const up = await new Promise((klaar) => {
    const rq = request({ host: '127.0.0.1', port: poort, path: '/api/upload?naam=eigen.wav&stems=0', method: 'POST',
      headers: { Host: `localhost:${poort}`, 'Content-Type': 'application/octet-stream', 'Content-Length': wav.length } }, (res) => {
      const d = []; res.on('data', (x) => d.push(x)); res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(d)); } catch {} klaar({ status: res.statusCode, j }); });
    });
    rq.end(wav);
  });
  ok('upload in de rij', up.status === 202, JSON.stringify(up));
  const nieuw = up.j?.sleutel;
  ok('na de ingest: tellen, en het grid uit de tellen', await wachtTot(async () => (await grid(nieuw))?.methode === 'tellen', 30000),
    JSON.stringify(await grid(nieuw)));
} finally {
  if (server) { server.kill('SIGTERM'); await new Promise((z) => { server.on('exit', z); setTimeout(z, 3000); }); }
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
