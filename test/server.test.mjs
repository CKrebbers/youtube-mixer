// De server zelf: witte lijst, Range, JSON-regel, racks per nummer, opnames.
// Draait een EIGEN server op een eigen poort met een tijdelijke database en
// opnamemap: je echte library en opnames blijven buiten schot.
// Draai met: node test/server.test.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const { Library } = await import('../server/library.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const map = mkdtempSync(join(tmpdir(), 'varve-server-'));
const db = join(map, 'test.db');
// Twee nummers in de testdatabase, om racks tussen nummers te kunnen proberen.
const lib = new Library(db);
for (const id of ['nummerX', 'nummerY']) {
  lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 10,
    audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
}
lib.db.close?.();

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_OPNAMES: join(map, 'opnames') },
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

  console.log('witte lijst');
  ok('de app komt door', (await status('/')) === 200 && (await status('/src/ui/app.js')) === 200);
  ok('.git, database en serverbroncode niet', (await status('/.git/config')) === 404
    && (await status('/media/library.db')) === 404 && (await status('/server/index.js')) === 404);
  ok('kapot pad: 400, geen crash', (await status('/%E0%A4%A')) === 400);
  ok('traversal: niet bereikbaar', (await status('/src/../server/index.js')) === 404);

  console.log('\nRange');
  const r1 = await fetch(`${B}/styles.css`, { headers: { Range: 'bytes=0-99999999' } });
  const heel = (await r1.arrayBuffer()).byteLength;
  ok('te grote range: geklemd, geen hangende verbinding', r1.status === 206 && heel > 1000);
  const r2 = await fetch(`${B}/styles.css`, { headers: { Range: 'bytes=-100' } });
  ok('"laatste 100 bytes" is ook echt de laatste 100', r2.status === 206 && (await r2.arrayBuffer()).byteLength === 100);
  ok('voorbij het einde: 416', (await status('/styles.css', { headers: { Range: 'bytes=99999999-' } })) === 416);

  console.log('\nalleen JSON');
  ok('ingest met text/plain wordt geweigerd', (await status('/api/ingest', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"url":"https://x"}' })) === 415);

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

  console.log('\nopnames');
  const s = await (await fetch(`${B}/api/opname/start`, { method: 'POST' })).json();
  const stuk = new Uint8Array(48000 * 4);
  const st = await fetch(`${B}/api/opname/${s.id}/stuk`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: stuk });
  const k = await (await fetch(`${B}/api/opname/${s.id}/klaar`, { method: 'POST' })).json();
  ok('start, stuk, klaar: een seconde', s.ok && st.ok && Math.abs(k.duur - 1) < 1e-9);
  ok('video met een verboden extensie wordt geweigerd', (await status(`/api/opname/${s.id}/video.exe`, { method: 'POST', body: 'x' })) === 400);
} finally {
  server.kill();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
