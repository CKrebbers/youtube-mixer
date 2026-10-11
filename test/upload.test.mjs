// Eigen bestanden uploaden: de route op een EIGEN server (eigen poort,
// tijdelijke database, media- en opnamemap). Clay's library blijft buiten schot.
// Draai met: node test/upload.test.mjs
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, openSync, ftruncateSync, closeSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { createHash } from 'node:crypto';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const ing = await import('../server/ingest.js');

const map = mkdtempSync(join(tmpdir(), 'varve-upload-'));
const media = join(map, 'media');
const MAX = 768 * 1024 ** 2;   // de grens voor deze testserver

// Testmateriaal: een korte wav, en een groot SPARSE bestand (neemt geen schijf
// in, leest als nullen) om te zien dat de server streamt en niet bufferd.
const wav = join(map, 'klik.wav');
await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=20", '-ac', '2', wav]);
const wavBytes = readFileSync(wav);
const groot = join(map, 'groot.mp4');
const GROOT = 512 * 1024 ** 2;  // 512 MB nullen: onder de grens, geen media
{ const fd = openSync(groot, 'w'); ftruncateSync(fd, GROOT); closeSync(fd); }
const teGroot = join(map, 'tegroot.mp4');
{ const fd = openSync(teGroot, 'w'); ftruncateSync(fd, MAX + 64 * 1024 ** 2); closeSync(fd); }

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(map, 'test.db'), VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_HERANALYSE: 'uit', VARVE_UPLOAD_MAX: String(MAX) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const B = `http://localhost:${poort}`;

/** Een upload met http.request: body als Buffer of als stroom (dan chunked, zonder lengte). */
const stuur = (naam, body, { type = 'application/octet-stream', headers = {} } = {}) => new Promise((klaar) => {
  const kop = { Host: `localhost:${poort}`, 'Content-Type': type, ...headers };
  if (Buffer.isBuffer(body) && !('Content-Length' in headers)) kop['Content-Length'] = body.length;
  const rq = request({ host: '127.0.0.1', port: poort, method: 'POST', path: `/api/upload?naam=${encodeURIComponent(naam)}`, headers: kop }, (res) => {
    const delen = [];
    res.on('data', (d) => delen.push(d));
    res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(delen)); } catch {} klaar({ status: res.statusCode, j }); });
  });
  rq.on('error', (e) => klaar({ status: 0, fout: String(e) }));
  if (Buffer.isBuffer(body)) rq.end(body);
  else { body.on('error', () => {}); body.pipe(rq); }
});
const wachtOp = async (opdrachtId, maxMs = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const j = await (await fetch(`${B}/api/ingest`)).json();
    const o = j.opdrachten.find((x) => x.id === opdrachtId);
    // 'wacht': in de wachtrij achter een ander (sinds 25 sep één tegelijk).
    if (o && o.status !== 'bezig' && o.status !== 'wacht') return o;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
};
const werkmappen = () => (existsSync(media) ? readdirSync(media).filter((n) => n.startsWith('.bezig-')) : []);

try {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${B}/api/opnames`).catch(() => null);
    if (r?.ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('upload van een eigen bestand');
  const r1 = await stuur('../../Mijn_klik.wav', wavBytes);
  const verwacht = `lokaal-${createHash('sha256').update(wavBytes).digest('hex').slice(0, 12)}`;
  ok(`202 en een opdracht (${r1.status})`, r1.status === 202 && r1.j?.status === 'bezig');
  const o1 = await wachtOp(r1.j?.id);
  ok(`ingest klaar${o1?.fout ? ` (${o1.fout})` : ''}`, o1?.status === 'klaar');
  ok(`id = lokaal- + hash van de inhoud (${o1?.track?.id})`, o1?.track?.id === verwacht);
  ok('naam is alleen titel: geen pad, geen achtervoegsel', o1?.track?.titel === 'Mijn klik' && !o1.track.audio.includes('..'));
  const lijst = (await (await fetch(`${B}/api/library`)).json()).tracks;
  const t = lijst.find((x) => x.id === verwacht);
  ok('in de library, met bron "bestand"', t?.bron === 'bestand' && t.url.startsWith('bestand:'));
  ok('audio in media/<id>/ van de TESTmap', existsSync(join(media, verwacht, 'audio.wav')) && !t.video);
  ok('audio is op te halen (witte lijst)', (await fetch(`${B}/${t.audio}`, { headers: { Range: 'bytes=0-43' } })).status === 206);

  const r2 = await stuur('andere naam.wav', wavBytes);
  ok('zelfde bestand nog eens: hetzelfde nummer, niets opnieuw', r2.status === 200 && r2.j?.bestond === true && r2.j.track?.id === verwacht);
  ok('en niet dubbel in de library', (await (await fetch(`${B}/api/library`)).json()).tracks.filter((x) => x.id === verwacht).length === 1);

  console.log('\n?titel=, ?artiest= en ?video=0 (de lokale import, tools/lokaal)');
  const wav2 = join(map, 'klik2.wav');
  await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', "aevalsrc='0.8*sin(2*PI*600*t)*exp(-60*mod(t,0.5))':s=44100:d=20", '-ac', '2', wav2]);
  const wav2Bytes = readFileSync(wav2);
  const stuurMet = (naam, body, q) => new Promise((klaar) => {
    const rq = request({ host: '127.0.0.1', port: poort, method: 'POST', path: `/api/upload?naam=${encodeURIComponent(naam)}&${q}`,
      headers: { Host: `localhost:${poort}`, 'Content-Type': 'application/octet-stream', 'Content-Length': body.length } }, (res) => {
      const delen = [];
      res.on('data', (d) => delen.push(d));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(delen)); } catch {} klaar({ status: res.statusCode, j }); });
    });
    rq.on('error', (e) => klaar({ status: 0, fout: String(e) }));
    rq.end(body);
  });
  const r2b = await stuurMet('set-20260923-131222.wav', wav2Bytes, 'titel=Set%2023%20sep%202026%2013%3A12&artiest=Clay%20(Varve)&video=0&stems=0');
  ok(`202 met titel en artiest uit de query (${r2b.status})`, r2b.status === 202 && r2b.j?.titel === 'Set 23 sep 2026 13:12');
  const o2b = await wachtOp(r2b.j?.id);
  ok('de track krijgt die titel en artiest (gaan vóór de bestandsnaam)',
    o2b?.status === 'klaar' && o2b.track?.titel === 'Set 23 sep 2026 13:12' && o2b.track?.uploader === 'Clay (Varve)');
  ok('url blijft bestand:<hash>:<echte naam>', /^bestand:[0-9a-f]{12}:set-20260923-131222\.wav$/.test(o2b?.track?.url || ''));

  // Een mp4 met beeld én geluid, met ?video=0: alleen de audio komt binnen.
  const klip = join(map, 'klip.mp4');
  const mk = await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', klip]);
  if (mk.ok) {
    const r2c = await stuurMet('klip.mp4', readFileSync(klip), 'video=0&stems=0');
    ok(`mp4 met ?video=0: 202 en geen videostap in de rij (${r2c.status})`, r2c.status === 202 && !(r2c.j?.stappen || []).includes('video'));
    const o2c = await wachtOp(r2c.j?.id);
    ok('alleen audio binnen: geen video.mp4 in media/<id>/, track.video leeg',
      o2c?.status === 'klaar' && !o2c.track?.video && existsSync(join(media, o2c.track.id, 'audio.wav')) && !existsSync(join(media, o2c.track.id, 'video.mp4')));
  } else {
    console.log('  -- geen mp4-fixture te maken met deze ffmpeg (mpeg4/aac); ?video=0 op een video niet getoetst');
  }

  console.log('\nweigeren');
  const r3 = await stuur('x.wav', wavBytes, { type: 'text/plain' });
  ok(`text/plain: 415 (${r3.status})`, r3.status === 415);
  const r3b = await stuur('x.wav', wavBytes, { type: 'multipart/form-data; boundary=x' });
  ok(`formulier (multipart): 415 (${r3b.status})`, r3b.status === 415);
  ok('audio/wav als type mag', (await stuur('y.wav', wavBytes, { type: 'audio/wav' })).status < 300);
  const r4 = await stuur('x.txt', Buffer.from('hallo'));
  ok(`achtervoegsel buiten de lijst: 415 (${r4.status})`, r4.status === 415);
  const r5 = await stuur('nep.mp3', Buffer.from('hallo, dit is geen muziek\n'.repeat(100)));
  ok(`geen media: nette 415 met reden ("${r5.j?.fout}")`, r5.status === 415 && /ffmpeg|geen/.test(r5.j?.fout || ''));
  const r6 = await stuur('x.wav', wavBytes, { headers: { Origin: 'http://evil.example' } });
  ok(`van een andere site: 403 (${r6.status})`, r6.status === 403);
  const r7 = await stuur('leeg.wav', Buffer.alloc(0));
  ok(`leeg: 400 (${r7.status})`, r7.status === 400);
  const r8 = await stuur('x.mp4', Buffer.alloc(16), { headers: { 'Content-Length': String(MAX + 1) } }).catch(() => ({ status: 0 }));
  ok(`Content-Length boven de grens: 413 zonder te lezen (${r8.status})`, r8.status === 413);
  ok('JSON-regel geldt nog voor de rest: ingest met octet-stream 415',
    (await fetch(`${B}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: '{}' })).status === 415);

  console.log('\nstreamen, niet bufferen');
  const pid = server.pid;
  let piek = 0;
  const rss = () => { try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) * 1024; } catch { return 0; } };
  const rust = rss();
  const meet = setInterval(() => { piek = Math.max(piek, rss()); }, 50);
  const t0 = Date.now();
  const r9 = await stuur('groot.mp4', createReadStream(groot));
  clearInterval(meet);
  piek = Math.max(piek, rss());
  ok(`512 MB nullen zonder lengte (chunked): gelezen, dan 415 geen media (${r9.status}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`, r9.status === 415);
  ok(`het geheugen van de server groeide ${Math.round((piek - rust) / 1024 ** 2)} MB (< 150 MB bij 512 MB)`, piek - rust < 150 * 1024 ** 2);
  ok('werkmap opgeruimd', werkmappen().length === 0);
  const r10 = await stuur('tegroot.mp4', createReadStream(teGroot));
  ok(`${MAX / 1024 ** 2} MB + 64 MB zonder lengte: 413 onderweg (${r10.status})`, r10.status === 413 && /te groot/.test(r10.j?.fout || ''));
  await new Promise((r) => setTimeout(r, 300));
  ok('en ook dan is de werkmap weg', werkmappen().length === 0);
  ok('de server leeft nog', (await fetch(`${B}/api/opnames`)).ok);
} finally {
  server.kill();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
