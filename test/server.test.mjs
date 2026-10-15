// De server zelf: witte lijst, Range, JSON-regel, racks per nummer, opnames.
// Draait een EIGEN server op een eigen poort met een tijdelijke database en
// opnamemap: je echte library en opnames blijven buiten schot.
// Draai met: node test/server.test.mjs
// @alleen: tijdsgrens op de wandklok (Range p95 < 50 ms en < 500 ms tijdens een analyse) (test/alles.mjs draait hem na de pool, zonder iets ernaast)
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { stat } from 'node:fs/promises';

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const { Library } = await import('../server/library.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const map = mkdtempSync(join(tmpdir(), 'varve-server-'));
const db = join(map, 'test.db');
const media = join(map, 'media');

/*
 * Een lange klikspoor-track (mono 16-bit, 11025 Hz — de onset-analyse
 * hersamplet toch naar 11025): eerst 6 minuten op 120 bpm, dan 6 op 126.
 * Lang genoeg dat de analyse seconden kost; de tempowissel test de tap die
 * rond zijn eigen positie verfijnt.
 */
const SR = 11025;
function klikWav(delen) {
  const duur = delen.reduce((a, d) => a + d.duur, 0);
  const x = new Int16Array(Math.round(SR * duur));
  let t0 = 0;
  for (const { duur: dd, bpm } of delen) {
    for (let t = t0; t < t0 + dd; t += 60 / bpm) {
      const s = Math.round(t * SR);
      for (let i = 0; i < 220 && s + i < x.length; i++) {
        x[s + i] = Math.round(20000 * Math.exp(-i / 40) * Math.sin((2 * Math.PI * 900 * i) / SR));
      }
    }
    t0 += dd;
  }
  return wavVan(x);
}
/** Mono 16-bit WAV op SR. */
function wavVan(x) {
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + x.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(1, 22);
  kop.writeUInt32LE(SR, 24); kop.writeUInt32LE(SR * 2, 28); kop.writeUInt16LE(2, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(x.byteLength, 40);
  return Buffer.concat([kop, Buffer.from(x.buffer)]);
}
mkdirSync(join(media, 'nummerZ'), { recursive: true });
writeFileSync(join(media, 'nummerZ', 'audio.wav'), klikWav([{ duur: 360, bpm: 120 }, { duur: 360, bpm: 126 }]));
// Een "video" van 5 MB (alleen bytes: de server kijkt niet in het bestand), voor de videoknip.
const VIDEO_GROOT = 5 * 1024 * 1024;
writeFileSync(join(media, 'nummerZ', 'video.mp4'), Buffer.alloc(VIDEO_GROOT, 7));
/*
 * En een nummer ZONDER puls: ruis met klappen op willekeurige momenten (vast
 * zaad). Hierop moet de verfijning zeggen dat er niets te verfijnen valt.
 */
{
  const x = new Int16Array(SR * 90);
  let z = 77;
  const rnd = () => ((z = (Math.imul(z, 1103515245) + 12345) >>> 0) / 2147483648 - 1);
  for (let i = 0; i < x.length; i++) x[i] = Math.round(3000 * rnd());
  for (let k = 0; k < 150; k++) {
    const s0 = Math.floor((rnd() * 0.5 + 0.5) * (x.length - 1000));
    for (let i = 0; i < 600; i++) x[s0 + i] = Math.max(-32767, Math.min(32767, x[s0 + i] + Math.round(12000 * rnd() * Math.exp(-i / 150))));
  }
  mkdirSync(join(media, 'nummerR'), { recursive: true });
  writeFileSync(join(media, 'nummerR', 'audio.wav'), wavVan(x));
}
// Twee nummers in de testdatabase, om racks tussen nummers te kunnen proberen.
const lib = new Library(db);
for (const id of ['nummerX', 'nummerY', 'nummerZ', 'nummerR']) {
  lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 10,
    audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
}
// En genoeg om voorbij de oude grens van 200 te komen.
const EXTRA = 250;
lib.db.exec('BEGIN');
for (let i = 0; i < EXTRA; i++) {
  const id = `extra${String(i).padStart(3, '0')}`;
  lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: `Extra ${i}`, uploader: 't', duur: 30 + i,
    audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
}
lib.db.exec('COMMIT');
const TOTAAL = 4 + EXTRA;
lib.db.close?.();

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  // Zonder achtergrondanalyse: die meet test/gridauto.test.mjs apart; hier
  // zou hij door de tap-tests heen lopen.
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_OPNAMES: join(map, 'opnames'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media,
    VARVE_HERANALYSE: 'uit', VARVE_PLANNEN: join(map, 'plannen'), VARVE_PROEF: join(map, 'proef'),
    VARVE_HOSTS: 'varve.proef-net.ts.net, https://fout.ts.net' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const B = `http://localhost:${poort}`;
try {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${B}/api/opnames`).catch(() => null);
    if (r?.ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const status = async (pad, init) => (await fetch(B + pad, init)).status;
  // fetch normaliseert het pad en laat geen eigen Host toe. Dit stuurt LETTERLIJK.
  const rauw = (pad, { method = 'GET', headers = {}, body = null } = {}) => new Promise((klaar) => {
    const rq = request({ host: '127.0.0.1', port: poort, path: pad, method, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => {
      const delen = [];
      res.on('data', (d) => delen.push(d));
      res.on('end', () => klaar({ status: res.statusCode, body: Buffer.concat(delen).toString() }));
    });
    rq.on('error', (e) => klaar({ status: 0, body: String(e) }));
    if (body) rq.write(body);
    rq.end();
  });

  console.log('witte lijst');
  ok('de app komt door', (await status('/')) === 200 && (await status('/src/ui/app.js')) === 200);
  ok('.git, database en serverbroncode niet', (await status('/.git/config')) === 404
    && (await status('/media/library.db')) === 404 && (await status('/server/index.js')) === 404);
  ok('kapot pad: 400, geen crash', (await status('/%E0%A4%A')) === 400);
  ok('traversal: niet bereikbaar', (await status('/src/../server/index.js')) === 404);
  const uitstapjes = ['/src/..%2fmedia%2flibrary.db', '/src/..%2f.git%2fconfig', '/src/..%2F..%2F..%2Fetc%2Fpasswd',
    '/src/..%5cserver%5cindex.js', '/src/%2e%2e%2fserver/index.js', '/src/../server/index.js', '/mappings/..%2fserver%2findex.js'];
  const uitkomsten = [];
  for (const p of uitstapjes) uitkomsten.push((await rauw(p)).status);
  ok(`gecodeerde slash of .. letterlijk: nooit 200 (${uitkomsten.join(' ')})`, uitkomsten.every((c) => c !== 200 && c !== 0));
  ok('een gewoon bestand in /src komt letterlijk nog wel door', (await rauw('/src/ui/app.js')).status === 200);
  // Het setplan (plannen/*.json uit VARVE_PLANNEN): alleen JSON, alleen direct in de map.
  console.log('\nsetplannen');
  ok('plan.html komt door', (await status('/plan.html')) === 200);
  ok('maschine.html (de Maschine-kaart) komt door', (await status('/maschine.html')) === 200);
  ok('nog geen plannen: lijst leeg, plan 404', (await (await fetch(`${B}/api/plannen`)).json()).plannen.length === 0
    && (await status('/api/plannen/auto-plan')) === 404);
  const zet = (naam, body, headers = {}) => fetch(`${B}/api/plannen/${naam}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const p1 = await zet('auto-plan', { plan: { naam: 'auto-plan', stappen: [{ track: 'a', waarom: 'begin' }] }, versie: null });
  const j1 = await p1.json();
  ok('nieuw plan opslaan: 200, genormaliseerd (id s1), met versie', p1.status === 200 && j1.plan.stappen[0].id === 's1' && !!j1.versie);
  ok('... en statisch te lezen onder /plannen/', (await status('/plannen/auto-plan.json')) === 200);
  ok('in plannen/ alleen .json, geen submappen of uitstapjes', (await status('/plannen/x.js')) === 404
    && (await status('/plannen/a/b.json')) === 404 && (await rauw('/plannen/..%2fserver%2findex.js')).status !== 200
    && (await status('/plannen/.versies/auto-plan')) === 404);
  const oudPlan = await zet('auto-plan', { plan: { stappen: [{ track: 'b' }] }, versie: 'oud' });
  const oudJ = await oudPlan.json();
  ok('opslaan op een oude versie: 409 met wat er nu staat', oudPlan.status === 409 && oudJ.plan.stappen[0].track === 'a' && oudJ.versie === j1.versie);
  const p2 = await zet('auto-plan', { plan: { stappen: [{ track: 'b' }] }, versie: j1.versie });
  ok('opslaan op de goede versie: 200, nieuwe versie', p2.status === 200 && (await p2.json()).versie !== j1.versie);
  const g = await (await fetch(`${B}/api/plannen/auto-plan`)).json();
  ok('lezen: plan, versie, fouten', g.plan.stappen[0].track === 'b' && typeof g.versie === 'string' && Array.isArray(g.fouten));
  ok('rare naam: 400', (await zet('..%2fx', { plan: { stappen: [] } })).status === 400 && (await status('/api/plannen/a%20b')) === 400);
  ok('geen JSON: 415', (await fetch(`${B}/api/plannen/x`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415);
  ok('van een vreemde site: 403', (await rauw('/api/plannen/x', { method: 'PUT', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{"plan":{"stappen":[]}}' })).status === 403);
  ok('lijst: auto-plan', (await (await fetch(`${B}/api/plannen`)).json()).plannen.map((p) => p.naam).join() === 'auto-plan');
  // In en uit (secties in een stap, docs/PLAN.md §2): heen en terug over HTTP, en een oud venster wist ze niet.
  {
    const IN = { sectie: 2, label: 'drop', groep: 'B' }, UIT = { sectie: 4, label: 'break', groep: 'C' };
    const s1 = await zet('secties', { plan: { stappen: [{ id: 's1', track: 'a', van: 31, in: IN, uit: UIT }] }, versie: null, kent: ['in', 'uit'] });
    const sj = await s1.json();
    const sg = await (await fetch(`${B}/api/plannen/secties`)).json();
    ok('in en uit: opgeslagen en weer gelezen', s1.status === 200 && sg.plan.stappen[0].in?.sectie === 2 && sg.plan.stappen[0].uit?.label === 'break' && sg.versie === sj.versie);
    const s2 = await zet('secties', { plan: { stappen: [{ id: 's1', track: 'a', van: 31, waarom: 'oud venster' }] }, versie: sj.versie });
    const s2j = await s2.json();
    ok('een oud venster (zonder kent) slaat op: in/uit bewaard, met een opmerking', s2.status === 200 && s2j.plan.stappen[0].in?.sectie === 2
      && s2j.plan.stappen[0].waarom === 'oud venster' && s2j.fouten.some((f) => /bewaard/.test(f)));
    ok('... de 409-regel blijft: op de oude versie botst het', (await zet('secties', { plan: sj.plan, versie: sj.versie, kent: ['in', 'uit'] })).status === 409);
  }

  console.log('\nde Controlekamer (docs/CONTROLEKAMER.md)');
  ok('/controle en /controle.html geven de pagina', (await status('/controle')) === 200 && (await status('/controle.html')) === 200
    && (await (await fetch(`${B}/controle`)).text()).includes('Controlekamer'));
  ok('zijn script en opmaak komen door', (await status('/src/controle/controle.js')) === 200 && (await status('/src/controle/controle.css')) === 200);
  // De companion (docs/COMPANION.md): dezelfde witte-lijstregels als de Controlekamer.
  ok('/companion en /companion.html geven de companion', (await status('/companion')) === 200 && (await status('/companion.html')) === 200
    && (await (await fetch(`${B}/companion`)).text()).includes('/src/companion/companion.js'));
  ok('/companion.htm en /companion/ niet', (await status('/companion.htm')) === 404 && (await status('/companion/')) === 404);
  ok('zijn script, opmaak en indeling komen door', (await status('/src/companion/companion.js')) === 200
    && (await status('/src/companion/companion.css')) === 200 && (await status('/mappings/companion.json')) === 200);
  ok('proef/sessie.json zelf niet (alleen via de API)', (await status('/proef/sessie.json')) === 404);
  // AR18: de wachter van de herstartlus peilt /api/leeft (uit het geheugen, nooit schijf of database).
  {
    const l = await (await fetch(`${B}/api/leeft`)).json();
    ok('/api/leeft: ok, het id van deze run en het pid', l.ok === true && typeof l.server === 'string' && l.server.length > 8 && Number.isInteger(l.pid));
    const rij = await (await fetch(`${B}/api/ingest`)).json();
    ok('… hetzelfde id als de ingest-rij (de strook ziet er een herstart aan)', rij.server === l.server);
    const bron = readFileSync(join(WORTEL, 'server/index.js'), 'utf8');
    const regel = bron.split('\n').find((r) => r.includes("pad === '/api/leeft'")) ?? '';
    ok('… en de route leest niets: geen lib, await of fs op zijn regel', regel && !/lib\.|await|read|stat|fs\./.test(regel));
  }
  const zetPunt = (id, body, type = 'application/json') => fetch(`${B}/api/proef/${id}`, { method: 'PUT', headers: { 'content-type': type }, body: JSON.stringify(body) });
  ok('nog niets: leeg', Object.keys((await (await fetch(`${B}/api/proef`)).json()).items).length === 0);
  let rp = await zetPunt('dr-rem', { status: 'fout', notitie: 'klikt' });
  ok('een punt zetten: 200 met het punt', rp.status === 200 && (await rp.json()).item.status === 'fout');
  ok('... en terug te lezen', (await (await fetch(`${B}/api/proef`)).json()).items['dr-rem']?.notitie === 'klikt');
  ok('verkeerde status: 400', (await zetPunt('dr-rem', { status: 'raar' })).status === 400);
  ok('geen JSON: 415', (await zetPunt('dr-rem', { status: 'ok' }, 'text/plain')).status === 415);
  ok('GET op een punt: 405', (await status('/api/proef/dr-rem')) === 405);
  ok('nieuwe ronde zonder JSON: 415 (zoals elke POST)', (await status('/api/proef/nieuw', { method: 'POST' })) === 415);
  const rn = await (await fetch(`${B}/api/proef/nieuw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  ok('nieuwe ronde: gearchiveerd en leeg', rn.gearchiveerd?.startsWith('archief/')
    && Object.keys((await (await fetch(`${B}/api/proef`)).json()).items).length === 0);

  console.log('\nRange');
  const r1 = await fetch(`${B}/styles.css`, { headers: { Range: 'bytes=0-99999999' } });
  const heel = (await r1.arrayBuffer()).byteLength;
  ok('te grote range: geklemd, geen hangende verbinding', r1.status === 206 && heel > 1000);
  const r2 = await fetch(`${B}/styles.css`, { headers: { Range: 'bytes=-100' } });
  ok('"laatste 100 bytes" is ook echt de laatste 100', r2.status === 206 && (await r2.arrayBuffer()).byteLength === 100);
  ok('voorbij het einde: 416', (await status('/styles.css', { headers: { Range: 'bytes=99999999-' } })) === 416);

  // Video verdringt audio niet (docs/WINST.md punt 2): een OPEN Range op video.mp4
  // krijgt hooguit 2 MB; een gesloten range, audio.wav en een verzoek zonder Range niet.
  const MB2 = 2 * 1024 * 1024;
  const vr = async (pad, range) => {
    const r = await fetch(`${B}${pad}`, range ? { headers: { Range: range } } : {});
    return { status: r.status, cr: r.headers.get('content-range'), len: Number(r.headers.get('content-length')), n: (await r.arrayBuffer()).byteLength };
  };
  const v0 = await vr('/media/nummerZ/video.mp4', 'bytes=0-');
  ok('open Range op video.mp4: 206 met precies 2 MB', v0.status === 206 && v0.n === MB2 && v0.len === MB2 && v0.cr === `bytes 0-${MB2 - 1}/${VIDEO_GROOT}`);
  const v1 = await vr('/media/nummerZ/video.mp4', `bytes=${VIDEO_GROOT - 1000}-`);
  ok('open Range dicht bij het einde: tot het einde, niet verder', v1.status === 206 && v1.n === 1000 && v1.cr === `bytes ${VIDEO_GROOT - 1000}-${VIDEO_GROOT - 1}/${VIDEO_GROOT}`);
  const v2 = await vr('/media/nummerZ/video.mp4', `bytes=0-${4 * 1024 * 1024 - 1}`);
  ok('gesloten Range op video.mp4: niet geknipt', v2.status === 206 && v2.n === 4 * 1024 * 1024);
  const v3 = await vr('/media/nummerZ/video.mp4', 'bytes=-100');
  ok('"laatste 100 bytes" van een video: niet geknipt', v3.status === 206 && v3.n === 100);
  const v4 = await vr('/media/nummerZ/video.mp4');
  ok('video zonder Range: 200, het hele bestand', v4.status === 200 && v4.n === VIDEO_GROOT);
  const wavGroot = (await stat(join(media, 'nummerZ', 'audio.wav'))).size;
  const a0 = await vr('/media/nummerZ/audio.wav', 'bytes=0-');
  ok('open Range op audio.wav: onveranderd, tot het einde', a0.status === 206 && a0.n === wavGroot && a0.n > MB2);

  console.log('\nalleen JSON');
  ok('ingest met text/plain wordt geweigerd', (await status('/api/ingest', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"url":"https://x"}' })) === 415);
  // Een ongeldige URL in de body: komt het verzoek er toch door, dan 400 en geen echte ingest.
  ok('text/plain met "application/json" als parameter: ook geweigerd', (await status('/api/ingest', {
    method: 'POST', headers: { 'Content-Type': 'text/plain;x=application/json' }, body: '{"url":"geen"}' })) === 415);
  ok('application/json; charset=utf-8 mag wel', (await status('/api/ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"url":"geen"}' })) === 400);

  console.log('\nHost en Origin (DNS-rebinding, CSRF)');
  const hosts = [`localhost:${poort}`, `127.0.0.1:${poort}`, `[::1]:${poort}`];
  const hostCodes = [];
  for (const h of hosts) hostCodes.push((await rauw('/api/opnames', { headers: { Host: h } })).status);
  ok(`localhost, 127.0.0.1 en [::1] met de juiste poort: 200 (${hostCodes.join(' ')})`, hostCodes.every((c) => c === 200));
  const vreemd = [];
  for (const h of ['evil.example', `evil.example:${poort}`, 'localhost:1', `localhost.evil.example:${poort}`]) {
    vreemd.push((await rauw('/api/opnames', { headers: { Host: h } })).status);
  }
  ok(`een vreemde Host (DNS-rebinding): 403 (${vreemd.join(' ')})`, vreemd.every((c) => c === 403));
  const mapJson = JSON.stringify({ mapping: { version: 2, rules: [] } });
  ok('POST vanaf een andere oorsprong: 403', (await rauw('/api/mapping', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: mapJson })).status === 403);
  ok('DELETE vanaf een andere oorsprong: 403', (await rauw('/api/mapping', { method: 'DELETE',
    headers: { Origin: `http://localhost:${poort + 1}` } })).status === 403);
  ok('Origin "null" (sandbox, file://): 403', (await rauw('/api/mapping', { method: 'DELETE', headers: { Origin: 'null' } })).status === 403);
  ok('POST vanaf de eigen pagina: gewoon 200', (await rauw('/api/mapping', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${poort}` }, body: mapJson })).status === 200);
  ok('zonder Origin (curl, tests): toegestaan', (await rauw('/api/mapping', { method: 'DELETE' })).status === 200);

  // Tailscale (VARVE_HOSTS, docs/TAILSCALE.md): `tailscale serve` levert de
  // naam zonder poort af, de pagina komt van https://<naam>.
  const TS = 'varve.proef-net.ts.net';
  const tsHosts = [];
  for (const h of [TS, `${TS}:443`, 'VARVE.Proef-Net.ts.net']) tsHosts.push((await rauw('/api/opnames', { headers: { Host: h } })).status);
  ok(`de Tailscale-naam uit VARVE_HOSTS (zonder poort, :443, hoofdletters): 200 (${tsHosts.join(' ')})`, tsHosts.every((c) => c === 200));
  const tsVreemd = [];
  for (const h of [`${TS}:${poort}`, `${TS}:80`, `evil.${TS}`, `${TS}.evil.example`, 'proef-net.ts.net', 'fout.ts.net', 'https://fout.ts.net']) {
    tsVreemd.push((await rauw('/api/opnames', { headers: { Host: h } })).status);
  }
  ok(`andere poort, sub- of bovendomein, of een ongeldige regel uit VARVE_HOSTS: 403 (${tsVreemd.join(' ')})`, tsVreemd.every((c) => c === 403));
  ok('Tailscale: POST van https://<naam>: 200', (await rauw('/api/mapping', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: TS, Origin: `https://${TS}` }, body: mapJson })).status === 200);
  ok('Tailscale: ook als de proxy de Host op localhost zette', (await rauw('/api/mapping', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `https://${TS}` }, body: mapJson })).status === 200);
  const tsOrigin = [];
  for (const o of [`http://${TS}`, `https://evil.example`, `https://${TS}.evil.example`, `https://${TS}:8443`, `http://localhost:${poort}`]) {
    tsOrigin.push((await rauw('/api/mapping', { method: 'DELETE', headers: { Host: TS, Origin: o } })).status);
  }
  ok(`Tailscale: een andere oorsprong (http, vreemd, andere poort, of localhost op de Tailscale-naam): 403 (${tsOrigin.join(' ')})`, tsOrigin.every((c) => c === 403));
  await rauw('/api/mapping', { method: 'DELETE' });
  // De routes van de sporen die samen integratie-r2 werden (toonsoort,
  // library-pagina's, hotcues, handelingenlog, ingest-wachtrij): allemaal
  // achter dezelfde controles, want die staan vóór elke route.
  {
    const wijzigend = [
      ['POST', '/api/library/nummerX/toon', { toon: null }], ['POST', '/api/library/nummerX/toon/analyseer', {}],
      ['POST', '/api/library/nummerX/hotcues', { nr: 1, tijd: 2 }], ['DELETE', '/api/library/nummerX/hotcues/1'],
      ['POST', '/api/handelingen/start', {}], ['POST', '/api/handelingen/20260925-120000/stuk', { van: 0, tekst: '[0,"a",1]\n' }],
      ['POST', '/api/ingest', { url: 'https://www.youtube.com/watch?v=abcdefghijk' }], ['DELETE', '/api/ingest/abc'],
      // stems (docs/STEMS.md): de rij en annuleren
      ['POST', '/api/stems', { track: 'nummerX', aantal: 2 }], ['DELETE', '/api/stems/abc'],
    ];
    const vreemdeOrigin = [], vreemdeHost = [], tekst = [];
    for (const [method, pad, body] of wijzigend) {
      const b = body ? JSON.stringify(body) : null;
      vreemdeOrigin.push((await rauw(pad, { method, body: b, headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' } })).status);
      vreemdeHost.push((await rauw(pad, { method, body: b, headers: { 'Content-Type': 'application/json', Host: `evil.example:${poort}` } })).status);
      if (method === 'POST') tekst.push((await rauw(pad, { method, body: b, headers: { 'Content-Type': 'text/plain', Origin: `http://localhost:${poort}` } })).status);
    }
    ok(`nieuwe routes: een andere oorsprong krijgt 403 (${vreemdeOrigin.join(' ')})`, vreemdeOrigin.every((c) => c === 403));
    ok(`nieuwe routes: een vreemde Host krijgt 403 (${vreemdeHost.join(' ')})`, vreemdeHost.every((c) => c === 403));
    ok(`nieuwe POST-routes: text/plain van de eigen pagina krijgt 415 (${tekst.join(' ')})`, tekst.every((c) => c === 415));
    const lezen = [];
    for (const pad of ['/api/library?sorteer=titel&van=0&aantal=2', '/api/library/nummerX/hotcues', '/api/library/nummerX/toon', '/api/handelingen', '/api/ingest',
      '/api/stems', '/media/nummerX/stems.wav']) {
      lezen.push((await rauw(pad, { headers: { Host: `evil.example:${poort}` } })).status);
    }
    ok(`ook lezen (pagina's, hotcues, toon, logs, wachtrij, stems) met een vreemde Host: 403 (${lezen.join(' ')})`, lezen.every((c) => c === 403));
    const hot = await (await fetch(`${B}/api/library/nummerX/hotcues`)).json();
    const logs = await (await fetch(`${B}/api/handelingen`)).json();
    const rij = await (await fetch(`${B}/api/ingest`)).json();
    const stemsRij = await (await fetch(`${B}/api/stems`)).json();
    ok('en er is niets veranderd: geen hotcue, geen log, niets in de wachtrij of de stems-rij', hot.hotcues?.length === 0 && logs.logs?.length === 0
      && rij.opdrachten?.length === 0 && stemsRij.opdrachten?.length === 0);
  }

  console.log('\nracks horen bij hun eigen nummer');
  const post = (pad, body) => fetch(B + pad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const x = (await post('/api/library/nummerX/racks', { naam: 'van X', data: { a: 1 }, actief: true })).rack;
  const y = (await post('/api/library/nummerY/racks', { id: x.id, naam: 'van Y', data: { b: 2 }, actief: true })).rack;
  ok('een id van een ANDER nummer maakt een nieuw rack', y.id !== x.id && y.track_id === 'nummerY');
  const xNa = (await (await fetch(`${B}/api/library/nummerX/racks`)).json()).racks[0];
  ok('en het rack van X is ongemoeid', xNa.naam === 'van X' && xNa.data.a === 1);
  await fetch(`${B}/api/library/nummerY/racks/${x.id}`, { method: 'DELETE' });
  ok('verwijderen via een ander nummer lukt niet', (await (await fetch(`${B}/api/library/nummerX/racks`)).json()).racks.length === 1);

  console.log('\nsampler-pads per nummer');
  const sp = await post('/api/library/nummerX/samples', { pad: 2, van: 4, tot: 6, tellen: 4, bpm: 120 });
  ok('pad bewaren', sp.sample?.pad === 2 && sp.sample.van === 4);
  ok('ophalen', (await (await fetch(`${B}/api/library/nummerX/samples`)).json()).samples.length === 1);
  ok('pad 9 bestaat niet', (await status('/api/library/nummerX/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 9, van: 0, tot: 1 }) })) === 400);
  ok('tot vóór van wordt geweigerd', (await status('/api/library/nummerX/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 1, van: 2, tot: 1 }) })) === 400);
  ok('onbekend nummer: 404', (await status('/api/library/bestaatniet/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 1, van: 0, tot: 1 }) })) === 404);
  ok('niet als formulier', (await status('/api/library/nummerX/samples', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })) === 415);
  await fetch(`${B}/api/library/nummerX/samples/2`, { method: 'DELETE' });
  ok('vergeten', (await (await fetch(`${B}/api/library/nummerX/samples`)).json()).samples.length === 0);

  console.log('\nde lijst: meer dan 200, sorteren, pagina\'s');
  const lijst = async (q = '') => { const r = await fetch(`${B}/api/library${q}`); return { status: r.status, ...(await r.json()) }; };
  const volledig = await lijst();
  ok(`zonder pagina: alle ${TOTAAL} (vroeger hooguit 200), met totaal`, volledig.tracks.length === TOTAAL && volledig.totaal === TOTAAL);
  const p3 = await lijst('?sorteer=duur&richting=op&van=200&aantal=100');
  ok('een pagina voorbij 200: de rest, en het totaal', p3.status === 200 && p3.tracks.length === TOTAAL - 200 && p3.totaal === TOTAAL && p3.van === 200);
  const stukken = [];
  for (let van = 0; van < TOTAAL; van += 100) stukken.push(...(await lijst(`?sorteer=titel&van=${van}&aantal=100`)).tracks.map((t) => t.id));
  ok('pagina\'s op titel achter elkaar: elk nummer precies één keer', stukken.length === TOTAAL && new Set(stukken).size === TOTAAL);
  const duren = (await lijst('?sorteer=duur&richting=af&aantal=5')).tracks.map((t) => t.duur);
  ok(`duur af: langste eerst (${duren.join(' ')})`, duren[0] === 30 + EXTRA - 1 && duren.every((d, i) => i === 0 || duren[i - 1] >= d));
  ok('zoeken geeft het aantal treffers als totaal', (await lijst('?zoek=nummerX&aantal=10')).totaal === 1);
  await fetch(`${B}/api/library/extra123/geladen`, { method: 'POST' });
  ok('laatst gespeeld: net geladen staat bovenaan', (await lijst('?sorteer=gespeeld&aantal=1')).tracks[0].id === 'extra123');
  const fouten = [];
  for (const q of ['?sorteer=onzin', '?sorteer=titel;DROP', '?sorteer=constructor', '?sorteer=toString', '?sorteer=__proto__',
    '?richting=omhoog', '?aantal=0', '?aantal=501', '?aantal=1.5', '?van=-1', '?van=abc']) {
    fouten.push((await lijst(q)).status);
  }
  ok(`onzin in de vraag: 400 (${fouten.join(' ')})`, fouten.every((c) => c === 400));
  const ver = await lijst('?sorteer=titel&van=4294967297&aantal=5');
  ok('van ver voorbij het einde (2^32 + 1): een lege pagina, niet rij 1', ver.status === 200 && ver.tracks.length === 0 && ver.totaal === TOTAAL);
  ok('van groter dan een veilig geheel getal: 400', (await lijst('?van=1e20&aantal=5')).status === 400);
  ok('en de library staat er nog', (await lijst('?aantal=1')).totaal === TOTAAL);

  console.log('\nhotcues per nummer');
  const zetHc = (id, body) => fetch(`${B}/api/library/${id}/hotcues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const hcVan = async (id) => (await (await fetch(`${B}/api/library/${id}/hotcues`)).json()).hotcues;
  ok('een nummer zonder hotcues: lege lijst', (await hcVan('nummerX')).length === 0);
  const h1 = await (await zetHc('nummerX', { nr: 1, tijd: 3.5 })).json();
  await zetHc('nummerX', { nr: 4, tijd: 61.25 });
  ok('hotcue bewaren', h1.hotcue?.nr === 1 && h1.hotcue.tijd === 3.5);
  ok('ophalen, op volgorde', JSON.stringify(await hcVan('nummerX')) === JSON.stringify([{ nr: 1, tijd: 3.5 }, { nr: 4, tijd: 61.25 }]));
  await zetHc('nummerX', { nr: 1, tijd: 4 });
  ok('dezelfde plek opnieuw: overschreven', (await hcVan('nummerX'))[0].tijd === 4 && (await hcVan('nummerX')).length === 2);
  const hcFouten = [];
  for (const b of [{ nr: 0, tijd: 1 }, { nr: 9, tijd: 1 }, { nr: 1.5, tijd: 1 }, { nr: 1, tijd: -1 }, { nr: 1, tijd: '3' }, { nr: 1 }, { nr: 1, tijd: null }]) {
    hcFouten.push((await zetHc('nummerX', b)).status);
  }
  ok(`ongeldige plek of tijd: 400 (${hcFouten.join(' ')})`, hcFouten.every((c) => c === 400));
  ok('onbekend nummer: 404', (await zetHc('bestaatniet', { nr: 1, tijd: 1 })).status === 404);
  ok('niet als formulier', (await status('/api/library/nummerX/hotcues', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"nr":1,"tijd":1}' })) === 415);
  ok('niet vanaf een andere oorsprong', (await rauw('/api/library/nummerX/hotcues/1', { method: 'DELETE', headers: { Origin: 'http://evil.example' } })).status === 403);
  const wegHc = await (await fetch(`${B}/api/library/nummerX/hotcues/4`, { method: 'DELETE' })).json();
  ok('wissen', wegHc.weg === true && (await hcVan('nummerX')).length === 1);
  ok('wissen wat er niet is: weg false', (await (await fetch(`${B}/api/library/nummerX/hotcues/4`, { method: 'DELETE' })).json()).weg === false);
  ok('hotcues van het ene nummer horen niet bij het andere', (await hcVan('nummerY')).length === 0);
  await zetHc('extra007', { nr: 2, tijd: 9 });
  await fetch(`${B}/api/library/extra007`, { method: 'DELETE' });
  ok('nummer weghalen: zijn hotcues gaan mee', (await hcVan('extra007')).length === 0 && (await lijst('?aantal=1')).totaal === TOTAAL - 1);

  console.log('\neigen mapping');
  ok('nog niets bewaard: null', (await (await fetch(`${B}/api/mapping`)).json()).mapping === null);
  const mp = await post('/api/mapping', { mapping: { version: 2, rules: [{ in: 'cc:1:7', action: 'track.1.fader' }] } });
  ok('mapping bewaren', mp.ok && mp.regels === 1);
  ok('en terughalen', (await (await fetch(`${B}/api/mapping`)).json()).mapping.rules[0].action === 'track.1.fader');
  await fetch(`${B}/api/mapping`, { method: 'DELETE' });
  ok('standaard herstellen: weer geen eigen mapping', (await (await fetch(`${B}/api/mapping`)).json()).mapping === null);
  ok('zonder rules geweigerd', (await status('/api/mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping: {} }) })) === 400);
  // Sinds 25 sep bewaart de app een VERSCHIL met de standaard (mapping-opslag.js).
  // De server kijkt alleen naar "rules": ook een leeg verschil moet erdoor, en
  // alles erbij (kind, base, top, removed) moet er ongeschonden weer uitkomen.
  const verschil = { kind: 'diff', version: 3, device: 'apc40mk2', base: '35823dda-291', top: { shift: null },
    rules: [], removed: ['note:0:52#shift'] };
  const mv = await post('/api/mapping', { mapping: verschil });
  ok('een leeg verschil (alleen een markering) wordt bewaard', mv.ok && mv.regels === 0);
  ok('en komt ongeschonden terug', JSON.stringify((await (await fetch(`${B}/api/mapping`)).json()).mapping) === JSON.stringify(verschil));
  await fetch(`${B}/api/mapping`, { method: 'DELETE' });
  // Een JSON-body komt in pakketten binnen. leesJson plakte die als TEKST aan
  // elkaar (`data += d`): een UTF-8-teken dat over de grens viel werd twee
  // keer U+FFFD. Hier valt de grens midden in de é en midden in de “.
  {
    const naam = 'café — “zoned out”';
    const body = Buffer.from(JSON.stringify({ mapping: { version: 3, name: naam, rules: [] } }));
    const e = body.indexOf(Buffer.from('é')) + 1;
    const q = body.indexOf(Buffer.from('“')) + 2;
    const inStukken = (delen) => new Promise((klaar) => {
      const rq = request({ host: '127.0.0.1', port: poort, path: '/api/mapping', method: 'POST',
        headers: { Host: `localhost:${poort}`, 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => klaar(res.statusCode)); });
      rq.on('error', () => klaar(0));
      (async () => {
        for (const d of delen) { rq.write(d); await new Promise((z) => setTimeout(z, 30)); }
        rq.end();
      })();
    });
    const code = await inStukken([body.subarray(0, e), body.subarray(e, q), body.subarray(q)]);
    const terug = (await (await fetch(`${B}/api/mapping`)).json()).mapping;
    ok(`JSON in stukken met een teken over de grens: heel (${JSON.stringify(terug?.name)})`, code === 200 && terug?.name === naam);
    await fetch(`${B}/api/mapping`, { method: 'DELETE' });
  }

  console.log('\ngrid-route (tempokaart)');
  const postGrid = (id, body) => fetch(`${B}/api/library/${id}/grid`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const leeg = await (await fetch(`${B}/api/library/nummerX/grid`)).json();
  ok('GET grid van een nummer zonder grid: null', leeg.grid === null);
  const oud = await (await postGrid('nummerX', { grid: { bpm: 124, firstBeat: 0.3 } })).json();
  ok('POST oud formaat wordt één stuk', oud.grid?.stukken?.length === 1 && oud.grid.stukken[0].bpm === 124 && oud.grid.stukken[0].anker === 0.3);
  const kaart = { stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 60, bpm: 126, anker: 60.2 }], beatsPerBar: 4, slot: true };
  const nieuw = await (await postGrid('nummerX', { grid: kaart })).json();
  ok('POST nieuw formaat: stukken en slot', nieuw.grid?.stukken?.length === 2 && nieuw.grid.stukken[1].anker === 60.2 && nieuw.grid.slot === true);
  const terug = await (await fetch(`${B}/api/library/nummerX/grid`)).json();
  ok('GET geeft de tempokaart terug', JSON.stringify(terug.grid) === JSON.stringify(nieuw.grid));
  const inLijst = (await (await fetch(`${B}/api/library`)).json()).tracks.find((t) => t.id === 'nummerX');
  ok('en de library-lijst draagt hem mee', inLijst.grid.stukken.length === 2);
  const fout = await postGrid('nummerX', { grid: { stukken: [{ van: 0, bpm: 9000, anker: 0 }] } });
  ok('onzin-grid: 400, en het bewaarde grid blijft', fout.status === 400
    && (await (await fetch(`${B}/api/library/nummerX/grid`)).json()).grid.stukken.length === 2);
  ok('grid van een onbekend nummer: 404', (await postGrid('bestaatNiet', { grid: null })).status === 404
    && (await fetch(`${B}/api/library/bestaatNiet/grid`)).status === 404);
  const weg = await (await postGrid('nummerX', { grid: null })).json();
  ok('null wist het grid', weg.grid === null);

  console.log('\ntoonsoort-route (kaart, docs/TOONSOORT.md §3)');
  const postToon = (id, body, type = 'application/json') => fetch(`${B}/api/library/${id}/toon`, { method: 'POST',
    headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  ok('GET toon van een nummer zonder toonsoort: null', (await (await fetch(`${B}/api/library/nummerX/toon`)).json()).toon === null);
  const tk = { versie: 1, stemming: -32, stukken: [{ van: 0, toonsoort: 'C#', stemming: -32, zekerheid: 0.4 },
    { van: 95.5, toonsoort: null, stemming: -32 }, { van: 120, toonsoort: 'Bbm' }], bron: 'hand', slot: true };
  const tb = await (await postToon('nummerX', { toon: tk })).json();
  ok('POST met de hand: bewaard, vaste spelling (C# -> Db), null = geen toonsoort, slot blijft',
    tb.toon?.stukken.length === 3 && tb.toon.stukken[0].toonsoort === 'Db' && tb.toon.stukken[1].toonsoort === null
    && tb.toon.stukken[2].toonsoort === 'Bbm' && tb.toon.stukken[2].stemming === -32 && tb.toon.slot === true && tb.toon.bron === 'hand');
  ok('GET geeft dezelfde kaart terug', JSON.stringify((await (await fetch(`${B}/api/library/nummerX/toon`)).json()).toon) === JSON.stringify(tb.toon));
  const inLijstT = (await (await fetch(`${B}/api/library`)).json()).tracks;
  ok('/api/library draagt per nummer "toon" mee (kaart of null)', inLijstT.find((t) => t.id === 'nummerX').toon?.stukken.length === 3
    && inLijstT.find((t) => t.id === 'nummerY').toon === null);
  const bewaard = async () => (await (await fetch(`${B}/api/library/nummerX/toon`)).json()).toon?.stukken.length;
  const foutT = [];
  for (const [naam, body] of [['onbekende toonsoort', { toon: { stukken: [{ van: 0, toonsoort: 'H' }] } }],
    ['stemming buiten -50..50', { toon: { stukken: [{ van: 0, toonsoort: 'C', stemming: 70 }] } }],
    ['geen stukken', { toon: { stukken: [] } }], ['zonder "toon"', {}], ['geen JSON', '{kapot']]) {
    const r = await postToon('nummerX', body);
    if (r.status !== 400) foutT.push(`${naam}: ${r.status}`);
  }
  ok(`onzin: 400, en de bewaarde kaart blijft${foutT.length ? ` (${foutT.join(', ')})` : ''}`, !foutT.length && (await bewaard()) === 3);
  ok('als formulier (text/plain): 415', (await postToon('nummerX', { toon: null }, 'text/plain')).status === 415 && (await bewaard()) === 3);
  ok('onbekend nummer: 404', (await postToon('bestaatNiet', { toon: null })).status === 404
    && (await fetch(`${B}/api/library/bestaatNiet/toon`)).status === 404);
  const lang = { toon: { stemming: 0, bron: 'hand', stukken: Array.from({ length: 3000 }, (_, i) => ({ van: i * 24, toonsoort: 'A', stemming: 0 })) } };
  const rl = await postToon('nummerY', lang);
  // Boven de 64 kB van de andere routes: een opname van 20 uur met om de 24 s een stuk.
  ok(`een lange opname met de hand (3000 stukken, ${Math.round(JSON.stringify(lang).length / 1024)} kB): past`,
    JSON.stringify(lang).length > 64 * 1024 && rl.status === 200 && (await rl.json()).toon.stukken.length === 3000);
  const wegT = await (await postToon('nummerX', { toon: null })).json();
  ok('null wist de toonsoort', wegT.toon === null && (await bewaard()) === undefined);

  console.log('\nopnames');
  const s = await (await fetch(`${B}/api/opname/start`, { method: 'POST' })).json();
  const stuk = new Uint8Array(48000 * 4);
  const st = await fetch(`${B}/api/opname/${s.id}/stuk`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: stuk });
  const k = await (await fetch(`${B}/api/opname/${s.id}/klaar`, { method: 'POST' })).json();
  ok('start, stuk, klaar: een seconde', s.ok && st.ok && Math.abs(k.duur - 1) < 1e-9);
  // De opname afspelen gaat via /opnames/…: uit VARVE_OPNAMES, niet uit de
  // opnames/ in de projectmap (daar stond hij niet, of een andere).
  const alsBestand = await fetch(`${B}/opnames/set-${s.id}.wav`);
  ok(`/opnames/set-….wav komt uit VARVE_OPNAMES (${alsBestand.status})`, alsBestand.status === 200
    && (await alsBestand.arrayBuffer()).byteLength >= 48000 * 4);
  const eigen = { Origin: `http://localhost:${poort}` };
  const s2 = await (await fetch(`${B}/api/opname/start`, { method: 'POST', headers: eigen })).json();
  const st2 = await fetch(`${B}/api/opname/${s2.id}/stuk`, { method: 'POST', headers: { ...eigen, 'Content-Type': 'application/octet-stream' }, body: stuk });
  const k2 = await fetch(`${B}/api/opname/${s2.id}/klaar`, { method: 'POST', headers: eigen });
  ok('opname-POSTs (binair) vanaf de eigen pagina blijven werken', s2.ok && st2.status === 200 && k2.status === 200);
  ok('video met een verboden extensie wordt geweigerd', (await status(`/api/opname/${s.id}/video.exe`, { method: 'POST', body: 'x' })) === 400);

  console.log('\nanalyse blokkeert de server niet');
  // Geen onset.bin: de verfijning rekent de envelope nu uit (12 minuten audio).
  // Intussen blijven Range-verzoeken komen, zoals een spelend deck ze doet.
  const wachttijden = [];
  let klaarMet = false;
  const t0 = performance.now();
  const verfijn = fetch(`${B}/api/library/nummerZ/grid/verfijn`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bpm: 123, positie: 540 }) })
    .then((r) => r.json()).finally(() => { klaarMet = true; });
  while (!klaarMet) {
    const t = performance.now();
    const r = await fetch(`${B}/media/nummerZ/audio.wav`, { headers: { Range: 'bytes=0-65535' } });
    await r.arrayBuffer();
    wachttijden.push(performance.now() - t);
    await new Promise((z) => setTimeout(z, 10));
  }
  const vf = await verfijn;
  const duur = performance.now() - t0;
  const traagst = Math.max(...wachttijden);
  const p95 = [...wachttijden].sort((a, b) => a - b)[Math.floor(wachttijden.length * 0.95)];
  // p95 onder 50 ms, en geen enkele stilstand van een halve seconde. Vóór de
  // worker: één antwoord van 2,6 s. De max is ruim omdat een drukke machine
  // (andere tests tegelijk) zelf ook wel eens een tik hapert.
  ok(`analyse duurde ${(duur / 1000).toFixed(1)} s, Range-antwoorden p95 ${p95.toFixed(0)} ms, traagste ${traagst.toFixed(0)} ms (${wachttijden.length} verzoeken)`,
    wachttijden.length > 5 && p95 < 50 && traagst < 500);
  ok(`tap op 540 s (126 bpm-deel), getikt 123: ${vf.bpm?.toFixed(2)} bpm`, Math.abs(vf.bpm - 126) < 0.1);
  const vf2 = await fetch(`${B}/api/library/nummerZ/grid/verfijn`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bpm: 123, positie: 120 }) }).then((r) => r.json());
  ok(`tap op 120 s (120 bpm-deel), getikt 123: ${vf2.bpm?.toFixed(2)} bpm`, Math.abs(vf2.bpm - 120) < 0.1);
  // Fase gemeten bij de tap (120 s), op het 120-bpm-grid dat op 0 begint.
  const tel = vf2.firstBeat + Math.round((120 - vf2.firstBeat) / (60 / vf2.bpm)) * (60 / vf2.bpm);
  const fase = (tel % 0.5 + 0.5) % 0.5;
  ok(`en de tel valt op het grid (${(Math.min(fase, 0.5 - fase) * 1000).toFixed(1)} ms naast)`, Math.min(fase, 0.5 - fase) < 0.015);
  ok('onset.bin is in de testmap gezet, niet in media/ van Clay', (await import('node:fs')).existsSync(join(media, 'nummerZ', 'onset.bin')));

  console.log('\nverfijnen met de tikken (contract met de browser)');
  const vraagVerfijn = (id, body) => fetch(`${B}/api/library/${id}/grid/verfijn`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // Acht tikken op het 120-deel rond 200 s: iets te snel, iets vroeg, met spreiding.
  const tikTijden = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => 196.5 + k * 0.5 * 1.006 - 0.015 + [0.012, -0.018, 0.02, -0.005, 0.009, -0.014, 0.003, 0.016][k]);
  const mt = await (await vraagVerfijn('nummerZ', { bpm: 119, positie: 200, anker: tikTijden[3], taps: tikTijden })).json();
  ok(`zeker, 120 bpm (${mt.bpm?.toFixed(3)}), ${mt.tikken} tikken gebruikt`, mt.zeker === true && Math.abs(mt.bpm - 120) < 0.05 && mt.tikken === 8);
  const telMt = mt.firstBeat + Math.round((200 - mt.firstBeat) / (60 / mt.bpm)) * (60 / mt.bpm);
  const faseMt = Math.abs(telMt - Math.round(telMt * 2) / 2) * 1000;
  // De klik in dit spoor sterft in 4 ms uit: scherper dan de ijkreeks, gemeten ~6 ms.
  ok(`fase op de voorflank van de audio: ${faseMt.toFixed(1)} ms naast (fijn ${mt.fijn == null ? '-' : (mt.fijn * 1000).toFixed(1) + ' ms'})`,
    faseMt < 7 && mt.fijn != null);
  ok('anker ligt bij de tikken, firstBeat is een tel van hetzelfde grid',
    Math.abs(mt.anker - 198) < 1.5 && Math.abs(((mt.anker - mt.firstBeat) / (60 / mt.bpm)) - Math.round((mt.anker - mt.firstBeat) / (60 / mt.bpm))) < 1e-6);
  const rTap = await (await vraagVerfijn('nummerR', { bpm: 121, positie: 45, taps: [40, 40.5, 41, 41.5, 42, 42.5] })).json();
  ok(`zonder puls: zeker=false, "${rTap.reden}", de tap zelf terug (${rTap.bpm} bpm)`,
    rTap.zeker === false && rTap.reden === 'geen puls' && Math.abs(rTap.bpm - 120) < 1e-6 && Math.abs(rTap.firstBeat % 0.5) < 1e-6);
  ok('taps geen lijst: 400', (await vraagVerfijn('nummerZ', { bpm: 120, taps: 'x' })).status === 400);
  ok('een negatieve tik: 400', (await vraagVerfijn('nummerZ', { bpm: 120, taps: [1, -2, 3] })).status === 400);
  ok('anker geen tijd: 400', (await vraagVerfijn('nummerZ', { bpm: 120, anker: 'gisteren' })).status === 400);
  ok('marge onzin: 400', (await vraagVerfijn('nummerZ', { bpm: 120, marge: 5 })).status === 400);
} finally {
  server.kill();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
