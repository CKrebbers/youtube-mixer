// De videoroute van de server (src/beeld/server-video.mjs): /api/library/<id>/video uit media/<id>/video.mp4
// naast audio.wav, met Range, en een OPEN bereik geklemd op 2 MB (oogst beeld-020, v1 VIDEO_KNIP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { videoRoute, bereik, VIDEO_KNIP } from '../src/beeld/server-video.mjs';

const MAAT = 5 * 1024 * 1024 + 123;
let map, server, poort;

before(async () => {
  map = mkdtempSync(join(tmpdir(), 'varve-beeld-route-'));
  for (const id of ['met', 'zonder']) mkdirSync(join(map, id));
  writeFileSync(join(map, 'met', 'audio.wav'), Buffer.alloc(10));
  writeFileSync(join(map, 'zonder', 'audio.wav'), Buffer.alloc(10));
  const inhoud = Buffer.alloc(MAAT);
  for (let i = 0; i < MAAT; i++) inhoud[i] = i % 251;
  writeFileSync(join(map, 'met', 'video.mp4'), inhoud);
  const audioPad = async (id) => (['met', 'zonder'].includes(id) ? join(map, id, 'audio.wav') : null);
  server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (await videoRoute(req, res, { pad, audioPad })) return;
    res.writeHead(418); res.end('niet voor mij');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  poort = server.address().port;
});
after(() => { server.close(); rmSync(map, { recursive: true, force: true }); });

const haal = (pad, kop = {}, method = 'GET') => fetch(`http://127.0.0.1:${poort}${pad}`, { headers: kop, method });

test('bereik(): open = hooguit 2 MB, gesloten en staart zoals gevraagd, voorbij het eind = 416', () => {
  assert.deepEqual(bereik('bytes=0-', MAAT), { van: 0, tot: VIDEO_KNIP - 1 });
  assert.deepEqual(bereik(`bytes=${MAAT - 10}-`, MAAT), { van: MAAT - 10, tot: MAAT - 1 }, 'aan het eind: tot het eind');
  assert.deepEqual(bereik('bytes=100-199', MAAT), { van: 100, tot: 199 });
  assert.deepEqual(bereik('bytes=0-99999999', MAAT), { van: 0, tot: MAAT - 1 }, 'gesloten: geklemd op het bestand, niet op 2 MB');
  assert.deepEqual(bereik('bytes=-500', MAAT), { van: MAAT - 500, tot: MAAT - 1 });
  assert.deepEqual(bereik(`bytes=${MAAT}-`, MAAT), { fout: 416 });
  assert.equal(bereik(undefined, MAAT), null);
  assert.equal(bereik('onzin', MAAT), null);
});

test('open Range krijgt 2 MB (206), met de juiste bytes en Content-Range', async () => {
  const r = await haal('/api/library/met/video', { range: 'bytes=1000-' });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 1000-${1000 + VIDEO_KNIP - 1}/${MAAT}`);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('cross-origin-embedder-policy'), 'require-corp');
  const b = Buffer.from(await r.arrayBuffer());
  assert.equal(b.length, VIDEO_KNIP);
  assert.equal(b[0], 1000 % 251);
  assert.equal(b[b.length - 1], (1000 + VIDEO_KNIP - 1) % 251);
});

test('gesloten Range zoals gevraagd, staart, 416 voorbij het eind', async () => {
  const r = await haal('/api/library/met/video', { range: 'bytes=10-19' });
  assert.equal(r.status, 206);
  assert.deepEqual([...Buffer.from(await r.arrayBuffer())], Array.from({ length: 10 }, (_, i) => (10 + i) % 251));
  const s = await haal('/api/library/met/video', { range: 'bytes=-3' });
  assert.equal(s.headers.get('content-range'), `bytes ${MAAT - 3}-${MAAT - 1}/${MAAT}`);
  await s.arrayBuffer();
  const f = await haal('/api/library/met/video', { range: `bytes=${MAAT + 5}-` });
  assert.equal(f.status, 416);
  assert.equal(f.headers.get('content-range'), `bytes */${MAAT}`);
  await f.arrayBuffer();
});

test('zonder Range het hele bestand; HEAD zonder body (de app vraagt zo of er een video is)', async () => {
  const r = await haal('/api/library/met/video');
  assert.equal(r.status, 200);
  assert.equal(Number(r.headers.get('content-length')), MAAT);
  assert.equal((await r.arrayBuffer()).byteLength, MAAT);
  const h = await haal('/api/library/met/video', {}, 'HEAD');
  assert.equal(h.status, 200);
  assert.equal(Number(h.headers.get('content-length')), MAAT);
});

test('404 zonder video.mp4 of zonder nummer; 405 op POST; andere paden zijn niet van deze route', async () => {
  const a = await haal('/api/library/zonder/video');
  assert.equal(a.status, 404); await a.arrayBuffer();
  const b = await haal('/api/library/onbekend/video');
  assert.equal(b.status, 404); await b.arrayBuffer();
  const c = await haal('/api/library/met/video', {}, 'POST');
  assert.equal(c.status, 405); await c.arrayBuffer();
  for (const p of ['/api/library/met/audio', '/api/library/met/video.mp4', '/api/library/../met/video', '/media/met/video.mp4']) {
    const d = await haal(p);
    assert.equal(d.status, 418, `${p} gaat langs deze route`); await d.arrayBuffer();
  }
});
