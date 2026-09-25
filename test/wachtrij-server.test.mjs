// De wachtrij op een EIGEN server (eigen poort, tijdelijke database, media- en
// opnamemap) met een nep-yt-dlp: geen byte van internet. Meerdere links in
// één keer, volgorde, annuleren (wachtend en lopend), playlists, dubbel,
// opnieuw, en een upload die achter een link aansluit.
// Draai met: node test/wachtrij-server.test.mjs
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const { Library } = await import('../server/library.js');
const ing = await import('../server/ingest.js');
const { maakNepYtdlp } = await import('./nep-ytdlp.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-wachtrij-server-'));
const media = join(map, 'media');
const db = join(map, 'test.db');
const log = join(map, 'nep.log');
mkdirSync(media, { recursive: true });

const bron = join(map, 'bron.wav');
await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=12", '-ac', '2', bron]);
const eigen = join(map, 'eigen.wav');
await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', 'sine=frequency=330:duration=4', '-ac', '2', eigen]);

// Twee nummers staan al in de library: één met audio, één waarvan de audio weg is.
{
  const lib = new Library(db);
  mkdirSync(join(media, 'dQw4w9WgXcQ'), { recursive: true });
  copyFileSync(bron, join(media, 'dQw4w9WgXcQ', 'audio.wav'));
  for (const id of ['dQw4w9WgXcQ', 'weg12345678']) {
    lib.bewaarTrack({ id, url: `https://www.youtube.com/watch?v=${id}`, titel: `al ${id}`, uploader: 't', duur: 12,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  }
  lib.sluit();
}

const poort = 20000 + Math.floor(Math.random() * 20000);
const nepYtdlp = maakNepYtdlp(map);
// Een functie: aan het eind wordt de server herstart (zelfde poort, database en media).
const startServer = () => spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_HERANALYSE: 'uit', VARVE_YTDLP: nepYtdlp, NEP_LOG: log, NEP_BRON: bron },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let server = startServer();
const B = `http://localhost:${poort}`;
const opruimen = [];   // pids van nep-yt-dlp's die bij een herstart van de server wees werden

const regels = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const post = async (body, headers = {}) => {
  const r = await fetch(`${B}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
};
const weg = async (id, headers = {}) => { const r = await fetch(`${B}/api/ingest/${id}`, { method: 'DELETE', headers }); return { status: r.status, j: await r.json().catch(() => null) }; };
const lijst = async () => (await (await fetch(`${B}/api/ingest`)).json()).opdrachten;
const opdracht = async (id) => (await lijst()).find((o) => o.id === id);
/** Wachten tot `cond(opdracht)` klopt; geeft de opdracht (of null na maxMs). */
const wachtOp = async (id, cond, maxMs = 90000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const o = await opdracht(id);
    if (o && cond(o)) return o;
    await wacht(80);
  }
  return null;
};
const afgelopen = (o) => o.status !== 'wacht' && o.status !== 'bezig';
const werkmappen = (begin = '.bezig-') => readdirSync(media).filter((n) => n.startsWith(begin));

try {
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${B}/api/ingest`).then((r) => r.ok).catch(() => false)) break;
    await wacht(100);
  }
  const run1 = (await (await fetch(`${B}/api/ingest`)).json()).server;
  ok(`GET /api/ingest zegt welke run van de server dit is (${run1})`, typeof run1 === 'string' && run1.length >= 8
    && (await (await fetch(`${B}/api/ingest`)).json()).server === run1);

  console.log('weigeren en al binnen, vóór de wachtrij');
  const pl = await post({ url: 'https://www.youtube.com/playlist?list=PL1' });
  ok(`playlist-link: 400 met reden (${pl.status}, "${pl.j.fout}")`, pl.status === 400 && pl.j.playlist === true && /playlist/.test(pl.j.fout));
  const al = await post({ url: 'https://youtu.be/dQw4w9WgXcQ?si=abc' });
  ok(`al in de library (youtu.be-vorm van een watch-link): 200, bestond, met het nummer (${al.status})`,
    al.status === 200 && al.j.bestond === true && al.j.status === 'klaar' && al.j.track?.id === 'dQw4w9WgXcQ');
  ok('en yt-dlp is niet eens aangeroepen', regels().length === 0);

  console.log('\nmeerdere links in één keer, één voor één');
  const A = 'http://127.0.0.1:9/nummer-a-traag', Bl = 'http://127.0.0.1:9/nummer-b', D = 'http://127.0.0.1:9/nummer-d';
  const lijstPost = await post({ urls: [A, Bl, 'https://www.youtube.com/watch?v=abcdefghijk&list=PL9', D, 'https://www.youtube.com/playlist?list=PL2', 'geen link'] });
  const [ra, rb, rc, rd, rpl, rgeen] = lijstPost.j.resultaten ?? [];
  ok(`202 met een uitkomst per link (${lijstPost.status}, ${lijstPost.j.resultaten?.length})`, lijstPost.status === 202 && lijstPost.j.resultaten?.length === 6);
  ok('de eerste is bezig, de rest wacht op volgorde', ra?.status === 'bezig' && rb?.status === 'wacht' && rb.plek === 1
    && rc?.status === 'wacht' && rc.plek === 2 && rd?.status === 'wacht' && rd.plek === 3);
  ok('v= én list=: in de rij als alleen dat nummer', rc?.url === 'https://www.youtube.com/watch?v=abcdefghijk' && rc.lijstEraf === true);
  ok('een playlist en een niet-link in de lijst: 400 met reden, de rest gaat door', rpl?.code === 400 && rpl.playlist === true && rgeen?.code === 400);
  ok('stappen voor de strook: metadata … video', ra?.stappen?.join() === 'metadata,audio,meten,normaliseren,peaks,onset,grid,video');
  const dub = await post({ url: Bl });
  ok('dezelfde link nog eens terwijl hij wacht: dezelfde opdracht, dubbel', dub.status === 200 && dub.j.dubbel === true && dub.j.id === rb?.id);

  const inDownload = await wachtOp(ra.id, (o) => o.stap === 'audio' && o.pct > 0);
  ok(`voortgang zichtbaar: stap audio, ${inDownload?.pct?.toFixed(0)}%, titel "${inDownload?.titel}"`,
    !!inDownload && inDownload.pct < 100 && inDownload.titel === 'Nep nummer-a-traag');

  console.log('\nannuleren');
  const wc = await weg(rc.id);
  ok(`een wachtende annuleren: meteen geannuleerd (${wc.j?.opdracht?.status})`, wc.status === 200 && wc.j.ok && wc.j.opdracht.status === 'geannuleerd');
  ok('de rest schuift op', (await opdracht(rd.id))?.plek === 2);
  const pidA = regels().find((x) => x.wat === 'download' && x.url === A)?.pid;
  ok('annuleren van een andere site: 403', (await weg(ra.id, { Origin: 'http://evil.example' })).status === 403);
  const wa = await weg(ra.id, { Origin: `http://localhost:${poort}` });
  ok(`de lopende annuleren (vanaf de eigen pagina): hij stopt (${wa.j?.opdracht?.stap})`, wa.status === 200 && wa.j.ok && ['stoppen', 'geannuleerd'].includes(wa.j.opdracht.stap));
  const oa = await wachtOp(ra.id, afgelopen, 10000);
  ok(`daarna: geannuleerd (${oa?.status})`, oa?.status === 'geannuleerd');
  let leeft = true;
  try { process.kill(pidA, 0); } catch { leeft = false; }
  ok('de nep-yt-dlp is gestopt (SIGINT) en weg', !!pidA && !leeft && regels().some((x) => x.wat === 'gestopt' && x.pid === pidA));
  ok('zijn werkmap is opgeruimd', werkmappen('.bezig-generic-nummer-a-traag').length === 0);

  const ob = await wachtOp(rb.id, afgelopen);
  const od = await wachtOp(rd.id, afgelopen);
  ok(`de volgende twee lopen gewoon (${ob?.status}, ${od?.status})`, ob?.status === 'klaar' && od?.status === 'klaar' && ob.track?.id === 'generic-nummer-b');
  ok('zonder video (de nep levert geen beeld), dat staat in de tekst', /zonder video/.test(ob?.tekst || ''));
  const downloads = regels().filter((x) => x.wat === 'download').map((x) => x.url);
  ok(`yt-dlp downloadde in volgorde, de geannuleerde wachtende nooit (${downloads.map((u) => u.split('/').pop()).join(', ')})`,
    downloads.join() === [A, Bl, D].join());
  const tracks = (await (await fetch(`${B}/api/library`)).json()).tracks.map((t) => t.id);
  ok(`in de library: b en d, niet a en niet het geannuleerde (${tracks.join(', ')})`,
    tracks.includes('generic-nummer-b') && tracks.includes('generic-nummer-d') && !tracks.includes('generic-nummer-a-traag') && !tracks.includes('abcdefghijk'));

  console.log('\ndubbel en opnieuw');
  let n = regels().length;
  const nogEens = await post({ url: Bl });
  ok('dezelfde link na afloop: al in de library, niets opnieuw', nogEens.status === 200 && nogEens.j.bestond === true && regels().length === n);
  const variant = await post({ url: `${Bl}?andere=link` });
  const ov = await wachtOp(variant.j.id, afgelopen);
  const nieuw = regels().slice(n).map((x) => x.wat);
  ok(`andere link, zelfde id (pas na de metadata te zien): bestond, geen download (${nieuw.join(',')})`,
    variant.status === 202 && ov?.status === 'klaar' && ov.bestond === true && !nieuw.includes('download'));
  n = regels().length;
  const opnieuw = await post({ url: Bl, opnieuw: true });
  const oo = await wachtOp(opnieuw.j.id, afgelopen);
  ok('met opnieuw: true wordt hij toch binnengehaald', opnieuw.status === 202 && oo?.status === 'klaar' && !oo.bestond
    && regels().slice(n).some((x) => x.wat === 'download'));
  ok('en de opdracht zegt opnieuw: true (na een herstart zet de strook hem zo terug); een gewone niet',
    opnieuw.j.opnieuw === true && oo.opnieuw === true && !ob.opnieuw);
  const kwijt = await post({ url: 'https://www.youtube.com/watch?v=weg12345678' });
  ok('in de library maar de audio is weg: gewoon opnieuw in de rij', kwijt.status === 202 && !kwijt.j.bestond);
  await wachtOp(kwijt.j.id, afgelopen);

  console.log('\nplaylist uit de metadata, wegklikken');
  const lp = await post({ url: 'http://127.0.0.1:9/een-lijst' });
  const olp = await wachtOp(lp.j.id, afgelopen);
  ok(`een playlist die alleen yt-dlp herkent: mislukt met reden ("${olp?.fout}")`, olp?.status === 'mislukt' && olp.playlist === true && /3 nummers/.test(olp.fout));
  // Een livestream: na de metadata mislukt met de reden, zonder download, en
  // de link erachter hoeft niet op een eindeloze opname te wachten.
  const lv = await post({ url: 'http://127.0.0.1:9/nu-live' });
  const naLive = await post({ url: 'http://127.0.0.1:9/nummer-f' });
  const tLv = Date.now();
  const olv = await wachtOp(lv.j.id, afgelopen, 10000);
  ok(`een lopende livestream: mislukt na ${Date.now() - tLv} ms met reden ("${olv?.fout}")`,
    olv?.status === 'mislukt' && olv.live === true && /livestream die nu loopt/.test(olv.fout));
  ok('  yt-dlp heeft hem niet gedownload', !regels().some((x) => x.wat === 'download' && x.url.includes('nu-live')));
  const onf = await wachtOp(naLive.j.id, afgelopen);
  ok(`  de link erachter loopt gewoon (${onf?.status})`, onf?.status === 'klaar');
  const wlp = await weg(lp.j.id);
  ok('een afgelopen opdracht wegklikken: uit de lijst', wlp.status === 200 && wlp.j.weg === true && !(await opdracht(lp.j.id)));
  ok('een onbekende opdracht: 404', (await weg('bestaatniet')).status === 404);
  ok('lege lijst of te veel links: 400', (await post({ urls: [] })).status === 400
    && (await post({ urls: Array.from({ length: 101 }, (_, i) => `http://127.0.0.1:9/x${i}`) })).status === 400);

  console.log('\neen upload sluit achter een link aan');
  const E = await post({ url: 'http://127.0.0.1:9/nummer-e-traag' });
  await wachtOp(E.j.id, (o) => o.stap === 'audio');
  const wav = readFileSync(eigen);
  const up = await new Promise((klaar) => {
    const rq = request({ host: '127.0.0.1', port: poort, method: 'POST', path: '/api/upload?naam=eigen.wav',
      headers: { Host: `localhost:${poort}`, 'Content-Type': 'application/octet-stream', 'Content-Length': wav.length } }, (res) => {
      const d = [];
      res.on('data', (x) => d.push(x));
      res.on('end', () => klaar({ status: res.statusCode, j: JSON.parse(Buffer.concat(d)) }));
    });
    rq.end(wav);
  });
  ok(`upload terwijl een link loopt: 202 en wacht (${up.j.status}, plek ${up.j.plek})`, up.status === 202 && up.j.status === 'wacht' && up.j.plek === 1 && up.j.soort === 'bestand');
  ok('stappen van een bestand: zonder metadata en download', up.j.stappen?.join() === 'meten,normaliseren,peaks,onset,grid');
  ok('zijn werkmap met het bestand staat klaar', werkmappen('.bezig-upload-').length === 1);
  const wu = await weg(up.j.id);
  await wacht(200);
  ok('de wachtende upload annuleren: geannuleerd en de werkmap is weg', wu.j?.opdracht?.status === 'geannuleerd' && werkmappen('.bezig-upload-').length === 0);
  await weg(E.j.id);
  const oe = await wachtOp(E.j.id, afgelopen, 10000);
  ok('en de link erna ook', oe?.status === 'geannuleerd');
  await wacht(300);
  ok('geen enkele werkmap meer, de server leeft', werkmappen().length === 0 && (await fetch(`${B}/api/ingest`)).ok);

  // Na een herstart is de rij leeg (hij staat in het geheugen) en krijgt de
  // server een andere run: daaraan ziet de strook dat er opdrachten weg zijn.
  console.log('\nserver herstart');
  const H1 = 'http://127.0.0.1:9/herstart-traag', H2 = 'http://127.0.0.1:9/herstart-b';
  const hp = await post({ urls: [H1, H2] });
  const [rh1, rh2] = hp.j.resultaten ?? [];
  await wachtOp(rh1.id, (o) => o.stap === 'audio' && o.pct > 0);
  const pidH = regels().find((x) => x.wat === 'download' && x.url === H1)?.pid;
  if (pidH) opruimen.push(pidH);
  const weg1 = new Promise((z) => server.once('exit', z));
  server.kill();
  await weg1;
  server = startServer();
  let na = null;
  for (let i = 0; i < 200 && !na; i++) {
    na = await fetch(`${B}/api/ingest`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!na) await wacht(100);
  }
  ok(`na de herstart: een andere run (${na?.server})`, typeof na?.server === 'string' && na.server !== run1);
  ok('en de rij is leeg: wat liep en wachtte is weg', !!na && !na.opdrachten.some((o) => o.id === rh1?.id || o.id === rh2?.id));
  ok('de werkmap van de onderbroken download is bij het opstarten opgeruimd', werkmappen().length === 0);
  // Wat de strook met "opnieuw" doet: dezelfde links nog eens in één lijst.
  const terug = await post({ urls: [H2] });
  const oh2 = await wachtOp(terug.j.resultaten?.[0]?.id, afgelopen);
  ok(`opnieuw in de rij bij de nieuwe server: 202 en klaar (${oh2?.status})`, terug.status === 202 && terug.j.resultaten?.[0]?.code === 202 && oh2?.status === 'klaar');
} finally {
  server.kill();
  for (const pid of opruimen) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
