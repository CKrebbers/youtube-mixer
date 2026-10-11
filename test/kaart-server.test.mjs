// De kaart en de nacht op een EIGEN server (eigen poort, tijdelijke database,
// media-, kaart- en nachtbestanden) met een nep-yt-dlp: geen byte van internet.
// De routes uit het contract, de foutcodes, "er speelt een deck" via een echt
// Range-verzoek, een nummer door de echte ingest-rij zonder video en zonder
// cookie-optie, een nachtrun van één nummer, en wat een herstart overleeft.
// Draai met: node test/kaart-server.test.mjs
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const { Library } = await import('../server/library.js');
const ing = await import('../server/ingest.js');
const { maakNepYtdlp } = await import('./nep-ytdlp.mjs');
const { schrijfKaart, NUMMERS } = await import('./nep-kaart.mjs');
const { datumVan, nachtDatum } = await import('../server/nacht.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-kaart-server-'));
const media = join(map, 'media');
const db = join(media, 'library.db');
const log = join(map, 'nep.log');
const kaartPad = join(map, 'varve-kaart.json');
mkdirSync(media, { recursive: true });
schrijfKaart(kaartPad);

const bron = join(map, 'bron.wav');
await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=12", '-ac', '2', bron]);

// Eén nummer van de kaart staat al in de library, met zijn audio (om te streamen).
{
  const lib = new Library(db);
  mkdirSync(join(media, 'binnen000001'), { recursive: true });
  copyFileSync(bron, join(media, 'binnen000001', 'audio.wav'));
  lib.bewaarTrack({ id: 'binnen000001', url: 'https://www.youtube.com/watch?v=binnen000001', titel: 'Archangel', uploader: 'Burial', duur: 12,
    audio: 'media/binnen000001/audio.wav', video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  lib.sluit();
}

const poort = 20000 + Math.floor(Math.random() * 20000);
const nepYtdlp = maakNepYtdlp(map);
const startServer = () => spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'), VARVE_PLANNEN: join(map, 'plannen'),
    VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'), VARVE_HERANALYSE: 'uit',
    VARVE_YTDLP: nepYtdlp, NEP_LOG: log, NEP_BRON: bron, NEP_DUUR: '300', VARVE_KAART: kaartPad },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let server = startServer();
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;

const regels = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, j: await r.json().catch(() => null) }; };
const post = async (p, body, headers = {}) => {
  const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const del = async (p) => { const r = await fetch(`${B}${p}`, { method: 'DELETE' }); return { status: r.status, j: await r.json().catch(() => null) }; };
const wachtTot = async (f, maxMs = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const v = await f(); if (v) return v; await wacht(100); } return null; };
const wachtOpServer = async () => { for (let i = 0; i < 200; i++) { if (await fetch(`${B}/api/kaart`).then((r) => r.ok).catch(() => false)) return true; await wacht(100); } return false; };

try {
  ok('server draait', await wachtOpServer());

  console.log('GET /api/kaart en /api/kaart/nummers');
  const k = await get('/api/kaart');
  ok(`geladen: ${k.j?.aantal} nummers, gebouwd ${k.j?.gebouwd}, pad uit VARVE_KAART`, k.status === 200 && k.j.status === 'geladen' && k.j.aantal === NUMMERS.length && k.j.pad === kaartPad && k.j.fout === null);
  ok('kratten met id, naam, soort, aantal, binnen', k.j.kratten.length >= 8 && k.j.kratten.every((x) => 'id' in x && 'naam' in x && 'soort' in x && 'aantal' in x && 'binnen' in x)
    && k.j.kratten.find((x) => x.id === 'slim:vertrouwd').binnen === 1);
  const z = await get('/api/kaart/nummers?zoek=four&aantal=5');
  ok(`zoek=four&aantal=5: totaal ${z.j?.totaal}, van 0`, z.status === 200 && z.j.totaal === 2 && z.j.nummers.length === 2 && z.j.van === 0 && z.j.nummers.every((n) => 'binnen' in n && 'wens' in n));
  const p = await get('/api/kaart/nummers?van=10&aantal=5&sorteer=titel&richting=af');
  ok('pagineren en sorteren via de query', p.status === 200 && p.j.nummers.length === 2 && p.j.van === 10 && p.j.totaal === NUMMERS.length);
  ok('krat en filter via de query', (await get('/api/kaart/nummers?krat=pl:PLnachtwerk')).j.totaal === 3 && (await get('/api/kaart/nummers?filter=binnen')).j.totaal === 1
    && (await get('/api/kaart/nummers?filter=geen-video,eigen-likes')).j.totaal === 1);
  ok('400 met { fout } bij sorteer, filter, aantal, richting; 404 bij een krat', (await get('/api/kaart/nummers?sorteer=bpm')).status === 400 && typeof (await get('/api/kaart/nummers?sorteer=bpm')).j.fout === 'string'
    && (await get('/api/kaart/nummers?filter=lekker')).status === 400 && (await get('/api/kaart/nummers?aantal=0')).status === 400
    && (await get('/api/kaart/nummers?aantal=501')).status === 400 && (await get('/api/kaart/nummers?richting=x')).status === 400 && (await get('/api/kaart/nummers?krat=pl:nee')).status === 404);
  const n1 = await get('/api/kaart/nummer/yt:binnen000001');
  ok('één nummer: binnen = de track-id', n1.status === 200 && n1.j.nummer.binnen === 'binnen000001' && n1.j.nummer.wens === null && n1.j.nummer.titel === 'Archangel');
  ok('onbekende sleutel: 404 { fout }', (await get('/api/kaart/nummer/yt:nee')).status === 404 && (await get('/api/kaart/nummer/yt:nee')).j.fout);
  ok('onbekend pad onder /api/kaart: 404 onbekend eindpunt', (await get('/api/kaart/iets')).status === 404 && (await get('/api/kaart/iets')).j.fout === 'onbekend eindpunt');
  ok('kaart.db en nacht.json niet via HTTP', (await fetch(`${B}/media/kaart.db`)).status === 404 && (await fetch(`${B}/media/nacht.json`)).status === 404 && (await fetch(`${B}/media/library.db`)).status === 404);

  console.log('\nwensen');
  const veel = Array.from({ length: 21 }, (_, i) => `yt:x${i}`);
  const w409 = await post('/api/kaart/wens', { sleutels: veel });
  ok('21 zonder bevestig: 409 { fout: "meer dan 20", aantal: 21 }', w409.status === 409 && w409.j.fout === 'meer dan 20' && w409.j.aantal === 21);
  ok('met bevestig: 200 (alles geweigerd: niet op de kaart)', (await post('/api/kaart/wens', { sleutels: veel, bevestig: true })).j?.geweigerd?.length === 21);
  ok('geen JSON: 415; geen sleutels: 400', (await fetch(`${B}/api/kaart/wens`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status === 415
    && (await post('/api/kaart/wens', { sleutels: [] })).status === 400);
  ok('een andere oorsprong: 403', (await post('/api/kaart/wens', { sleutels: ['yt:fourtet0baby'] }, { Origin: 'http://evil.example' })).status === 403);
  const w1 = await post('/api/kaart/wens', { sleutels: ['yt:eigenlike001', 'yt:binnen000001', 'yt:eigenlike001'] });
  ok('toegevoegd en geweigerd (al binnen, dubbel)', w1.status === 200 && w1.j.ok && w1.j.toegevoegd.join() === 'yt:eigenlike001' && w1.j.geweigerd.length === 2
    && w1.j.geweigerd.some((g) => g.reden === 'al binnen') && w1.j.geweigerd.some((g) => /dubbel/.test(g.reden)));
  const wl = await get('/api/kaart/wensen');
  ok('GET /api/kaart/wensen: sleutel, status, gevraagd, youtube_id, fout, track', wl.status === 200 && wl.j.wensen.length === 1 && ['sleutel', 'status', 'gevraagd', 'youtube_id', 'fout', 'track'].every((v) => v in wl.j.wensen[0])
    && wl.j.wensen[0].status === 'wacht' && wl.j.wensen[0].youtube_id === 'eigenlike001');
  ok('het nummer draagt zijn wens', (await get('/api/kaart/nummer/yt:eigenlike001')).j.nummer.wens.status === 'wacht');
  ok('DELETE /api/kaart/wens/<sleutel>', (await del('/api/kaart/wens/yt:eigenlike001')).j?.ok === true && (await del('/api/kaart/wens/yt:eigenlike001')).j?.ok === false && (await get('/api/kaart/wensen')).j.wensen.length === 0);

  console.log('\nwat de UI stuurt (docs/KAART.md §3b): gecodeerde sleutels, kies zonder wens, track als object, de krat op de wenslijst');
  ok('GET /api/kaart/nummer/yt%3Abinnen000001 (encodeURIComponent uit de UI) = hetzelfde nummer', (await get('/api/kaart/nummer/yt%3Abinnen000001')).j?.nummer?.sleutel === 'yt:binnen000001');
  const kz = await post('/api/kaart/nummer/sp%3Asp0000000002/kies', { youtube_id: 'topic0000002' });
  ok('kies zonder bestaande wens maakt er een op wacht (ook gecodeerd)', kz.status === 200 && kz.j.wens.status === 'wacht' && kz.j.wens.youtube_id === 'topic0000002'
    && (await get('/api/kaart/nummer/sp:sp0000000002')).j.nummer.wens.status === 'wacht');
  ok('wensen[].track is null (niet binnen) of een object met id, nooit een string', (await get('/api/kaart/wensen')).j.wensen.every((w) => w.track === null || (typeof w.track === 'object' && typeof w.track.id === 'string')));
  ok('DELETE met een gecodeerde sleutel', (await del('/api/kaart/wens/sp%3Asp0000000002')).j?.ok === true && (await get('/api/kaart/wensen')).j.wensen.length === 0);
  ok('een onleesbaar pad onder /api/kaart: 400', (await get('/api/kaart/nummer/yt%E0%A4%A')).status === 400);
  // De krat-knop van de UI: alle niet-binnen sleutels van de krat (ook sp: zonder video), dan POST wens; alles komt op wacht.
  const kratSleutels = (await get('/api/kaart/nummers?krat=slim:eigen-likes&filter=niet-binnen&aantal=500')).j.nummers.map((n) => n.sleutel);
  ok(`krat eigen-likes, niet-binnen: ${kratSleutels.length} sleutels, met een sp:-sleutel erbij`, kratSleutels.length >= 2 && kratSleutels.some((s) => s.startsWith('sp:')) && !kratSleutels.includes('yt:binnen000001'));
  const kw = await post('/api/kaart/wens', { sleutels: kratSleutels, bevestig: true });
  ok('POST wens met die sleutels: alles toegevoegd, ook de sp:-sleutels, allemaal op wacht', kw.status === 200 && kw.j.toegevoegd.length === kratSleutels.length && !kw.j.geweigerd.length
    && (await get('/api/kaart/wensen')).j.wensen.every((w) => w.status === 'wacht' && kratSleutels.includes(w.sleutel)));
  for (const s of kratSleutels) await del(`/api/kaart/wens/${encodeURIComponent(s)}`);
  ok('weer leeg (DELETE per sleutel, gecodeerd zoals de UI)', (await get('/api/kaart/wensen')).j.wensen.length === 0);

  console.log('\neen YouTube-versie zoeken (nep-yt-dlp, ytsearch5, geen cookies)');
  const zk = await post('/api/kaart/nummer/sp:sp0000000001/zoek', {});
  ok(`kandidaten met score, beste eerst (${zk.j?.kandidaten?.[0]?.youtube_id} ${zk.j?.kandidaten?.[0]?.score})`, zk.status === 200 && zk.j.kandidaten.length === 5 && zk.j.kandidaten[0].score >= 0.9
    && zk.j.kandidaten.every((c) => ['youtube_id', 'titel', 'kanaal', 'duur', 'score', 'reden'].every((v) => v in c)) && zk.j.kandidaten[0].score >= zk.j.kandidaten[4].score);
  const zoekRegel = regels().find((r) => r.wat === 'zoek');
  ok(`yt-dlp kreeg "ytsearch5:<artiest> <titel>" --flat-playlist -J ("${zoekRegel?.vraag}")`, zoekRegel?.vraag === 'Four Tet Two Thousand and Seventeen' && zoekRegel.args.includes('--flat-playlist') && zoekRegel.args.includes('-J'));
  ok('een onbekende sleutel: 404', (await post('/api/kaart/nummer/sp:nee/zoek', {})).status === 404);
  const kies = await post('/api/kaart/nummer/sp:sp0000000001/kies', { youtube_id: zk.j.kandidaten[0].youtube_id });
  ok('kies: de wens heeft die id en wacht', kies.status === 200 && kies.j.ok && kies.j.wens.status === 'wacht' && kies.j.wens.youtube_id === zk.j.kandidaten[0].youtube_id);
  ok('kies met onzin: 400', (await post('/api/kaart/nummer/sp:sp0000000001/kies', { youtube_id: 'a b' })).status === 400);
  await del('/api/kaart/wens/sp:sp0000000001');

  console.log('\nmeteen binnenhalen: door de ingest-rij, alleen audio');
  const regelsVoor = regels().length;
  const m = await post('/api/kaart/wens', { sleutels: ['yt:fourtet0baby'], meteen: true });
  ok('200 met gestart', m.status === 200 && m.j.toegevoegd.join() === 'yt:fourtet0baby' && m.j.gestart?.join() === 'yt:fourtet0baby');
  const opdr = await wachtTot(async () => (await get('/api/ingest')).j.opdrachten.find((o) => o.sleutel === 'fourtet0baby' || /fourtet0baby/.test(o.url)));
  ok(`in de bestaande ingest-rij, stappen zonder video (${opdr?.stappen?.join(',')})`, !!opdr && !opdr.stappen.includes('video') && opdr.stappen.includes('audio') && opdr.stappen.includes('grid'));
  const klaar = await wachtTot(async () => { const w = (await get('/api/kaart/wensen')).j.wensen.find((x) => x.sleutel === 'yt:fourtet0baby'); return w && w.status !== 'wacht' && w.status !== 'bezig' ? w : null; }, 120000);
  ok(`de wens is klaar met zijn track (${klaar?.status}${klaar?.fout ? `: ${klaar.fout}` : ''})`, klaar?.status === 'klaar' && klaar.track?.id === 'fourtet0baby');
  ok('en het nummer is nu binnen (library) en video is niet gehaald', (await get('/api/kaart/nummer/yt:fourtet0baby')).j.nummer.binnen === 'fourtet0baby' && klaar.track.video === null
    && !regels().slice(regelsVoor).some((r) => r.wat === 'video'));
  ok('geen cookie-optie in enige yt-dlp-aanroep van deze server', !regels().some((r) => (r.args ?? []).some((a) => /cookies/.test(a))));
  ok('al binnen nog eens: geweigerd', (await post('/api/kaart/wens', { sleutels: ['yt:fourtet0baby'] })).j.geweigerd[0].reden === 'al binnen');
  ok('kratten tellen hem nu mee als binnen', (await get('/api/kaart')).j.kratten.find((x) => x.id === 'slim:vertrouwd').binnen === 2);

  console.log('\n/api/nacht');
  const nz = await get('/api/nacht');
  ok('standaard: uit, 01:00–07:00, 80, pauze 20–90, speeldag 2026-10-10, laatsteRun null, volgende null, bezig null', nz.status === 200 && nz.j.aan === false && nz.j.venster.van === '01:00'
    && nz.j.venster.tot === '07:00' && nz.j.perNacht === 80 && nz.j.pauze.min === 20 && nz.j.pauze.max === 90 && nz.j.speeldagen.join() === '2026-10-10' && nz.j.laatsteRun === null
    && nz.j.volgende === null && nz.j.bezig === null && nz.j.standaardVolgorde === true && nz.j.vandaagNiet === false);
  const nu = new Date();
  const speeldagen = [...new Set([datumVan(nu), nachtDatum(nu)])];
  const nz2 = await post('/api/nacht', { perNacht: 5, pauze: { min: 0, max: 0 }, speeldagen });
  ok('POST gedeeltelijk: nieuwe stand, de rest blijft', nz2.status === 200 && nz2.j.perNacht === 5 && nz2.j.pauze.max === 0 && nz2.j.aan === false && nz2.j.speeldagen.join() === speeldagen.sort().join());
  ok('nacht.json naast de library', existsSync(join(media, 'nacht.json')) && JSON.parse(readFileSync(join(media, 'nacht.json'), 'utf8')).instellingen.perNacht === 5);
  ok('onzin: 400 { fout }', (await post('/api/nacht', { perNacht: 'veel' })).status === 400 && (await post('/api/nacht', { venster: { van: '25:00', tot: '07:00' } })).status === 400 && (await post('/api/nacht', { wat: 1 })).status === 400);
  const nn = await post('/api/nacht/nu', { aantal: 1 });
  ok(`nu op een speeldag: 409 ("${nn.j?.fout}")`, nn.status === 409 && /speeldag/.test(nn.j.fout));
  await post('/api/nacht', { speeldagen: [] });
  const nn2 = await post('/api/nacht/nu', { aantal: 1 });
  ok('nu zonder speeldag: 202 met bezig', nn2.status === 202 && nn2.j.bezig && nn2.j.bezig.soort === 'nu' && nn2.j.bezig.aantal === 1);
  ok('nog eens terwijl hij loopt: 409', (await post('/api/nacht/nu', { aantal: 1 })).status === 409);
  const run = await wachtTot(async () => { const s = (await get('/api/nacht')).j; return s.bezig === null && s.laatsteRun ? s.laatsteRun : null; }, 120000);
  ok(`de run is klaar: ${run?.gehaald} gehaald, "${run?.reden}"`, run?.gehaald === 1 && run.mislukt === 0 && /klaar: 1/.test(run.reden) && run.klaar >= run.begonnen);
  const nachtWens = (await get('/api/kaart/wensen')).j.wensen.find((w) => w.bron === 'nacht');
  ok(`de standaardvolgorde pakte ${nachtWens?.sleutel} (vertrouwd, meeste beurten, niet binnen) en die is klaar`, nachtWens?.sleutel === 'yt:vergeten0001' && nachtWens.status === 'klaar' && nachtWens.track?.id === 'vergeten0001');
  ok('GET /api/nacht/runs', (await get('/api/nacht/runs')).j.runs.length === 1);
  ok('stop zonder run: ok false', (await post('/api/nacht/stop', {})).j.ok === false);

  console.log('\n"er speelt een deck": een Range-verzoek op audio.wav');
  const rng = await fetch(`${B}/media/binnen000001/audio.wav`, { headers: { Range: 'bytes=0-1023' } });
  ok('206 op een pagina van het nummer', rng.status === 206);
  ok('zoeken: 409 er speelt een deck', (await post('/api/kaart/nummer/sp:sp0000000002/zoek', {})).status === 409 && (await post('/api/kaart/nummer/sp:sp0000000002/zoek', {})).j.fout === 'er speelt een deck');
  ok('meteen: 409; zonder meteen mag de wens gewoon op de lijst', (await post('/api/kaart/wens', { sleutels: ['yt:eigenlike002'], meteen: true })).status === 409
    && (await post('/api/kaart/wens', { sleutels: ['yt:eigenlike002'] })).status === 200);
  ok('nacht nu: 409 er speelt een deck', (await post('/api/nacht/nu', { aantal: 1 })).j.fout === 'er speelt een deck');
  ok('een gewone GET van het bestand (zonder Range) telt niet als spelen — maar hij speelt nu al, dus blijft 409', (await post('/api/nacht/nu', { aantal: 1 })).status === 409);

  console.log('\nherstart: wensen en instellingen blijven');
  server.kill('SIGTERM');
  await new Promise((z) => server.on('exit', z));
  server = startServer();
  ok('server weer op', await wachtOpServer());
  ok('de wensen staan er nog (kaart.db)', (await get('/api/kaart/wensen')).j.wensen.length === 3);
  ok('de instellingen van de nacht ook (nacht.json)', (await get('/api/nacht')).j.perNacht === 5 && (await get('/api/nacht')).j.laatsteRun?.gehaald === 1);
  ok('en de kaart is weer geladen', (await get('/api/kaart')).j.status === 'geladen');
  ok('zonder kaartbestand: status ontbreekt, nummers 404', await (async () => {
    server.kill('SIGTERM'); await new Promise((z) => server.on('exit', z));
    rmSync(kaartPad);
    server = startServer();
    if (!await wachtOpServer()) return false;
    const s = await get('/api/kaart'); const n = await get('/api/kaart/nummers');
    return s.j.status === 'ontbreekt' && s.j.aantal === 0 && n.status === 404 && /ontbreekt/.test(n.j.fout);
  })());
} finally {
  server.kill('SIGTERM');
  await Promise.race([new Promise((z) => server.on('exit', z)), wacht(5000)]);
  if (fails.length) console.log('\n--- server ---\n' + serverUit.split('\n').slice(-40).join('\n'));
  rmSync(map, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
