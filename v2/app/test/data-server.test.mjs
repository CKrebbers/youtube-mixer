/**
 * De eigen data van v2 op een eigen server met een tijdelijke map: nummers (hotcues, cue),
 * opnames op hun frame (herhalen = hetzelfde, een gat = stilte), het log op zijn byte, de kop
 * na een crash, en de regels (alleen deze machine, mediatype, grootte, id's).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { maakServer } = await import('../server.mjs');
const { Data, KOP } = await import('../server/data.mjs');

async function metServer(fn) {
  const map = mkdtempSync(join(tmpdir(), 'v2-data-'));
  const srv = maakServer({ media: '/geen-media', data: map });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));   // elke keer een eigen poort: geen oude verbindingen
  const url = (p) => `http://localhost:${srv.address().port}${p}`;
  try { await fn({ map, url }); } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); rmSync(map, { recursive: true, force: true }); }
}

test('een server die alleen leest maakt niets aan', async () => {
  await metServer(async ({ map, url }) => {
    const r = await fetch(url('/api/v2/opnames'));
    assert.deepEqual(await r.json(), { opnames: [] });
    assert.equal(existsSync(join(map, 'opnames')), false);
  });
});

test('nummer: hotcues en cue bewaren en terug; ongeldig = 400; alleen JSON', async () => {
  await metServer(async ({ url }) => {
    assert.deepEqual(await (await fetch(url('/api/v2/nummer/yt:abc'))).json(), {});
    const put = (b, type = 'application/json') => fetch(url('/api/v2/nummer/yt:abc'), { method: 'PUT', headers: { 'content-type': type }, body: JSON.stringify(b) });
    assert.equal((await put({ hotcues: [1.5, null, 30], cue: 2 })).status, 200);
    assert.deepEqual(await (await fetch(url('/api/v2/nummer/yt:abc'))).json(), { hotcues: [1.5, null, 30], cue: 2 });
    assert.equal((await put({ cue: 3 })).status, 200);
    assert.deepEqual(await (await fetch(url('/api/v2/nummer/yt:abc'))).json(), { hotcues: [1.5, null, 30], cue: 3 }, 'samengevoegd');
    assert.equal((await put({ hotcues: [-1] })).status, 400);
    assert.equal((await put({ hotcues: new Array(9).fill(null) })).status, 400);
    assert.equal((await put({ cue: 1 }, 'text/plain')).status, 415);
    assert.equal((await fetch(url('/api/v2/nummer/a%2F..%2Fb'))).status, 400);
  });
});

test('opname: stukken op hun frame, een herhaling verandert niets, een gat is stilte, klaar zet de kop', async () => {
  await metServer(async ({ map, url }) => {
    const id = 'set-20261020-120000';
    const stuk = (frame, waarde, n = 1000) => {
      const b = Buffer.alloc(n * 4);
      for (let i = 0; i < n * 2; i++) b.writeInt16LE(waarde, i * 2);
      return fetch(url(`/api/v2/opname/${id}?frame=${frame}`), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: b });
    };
    assert.equal((await stuk(0, 100)).status, 200);
    assert.equal((await stuk(2000, 300)).status, 200);     // frame 1000–1999 kwam nooit aan
    assert.equal((await stuk(2000, 300)).status, 200);     // herhaling
    assert.equal((await fetch(url(`/api/v2/opname/${id}/klaar?frames=3500`), { method: 'POST' })).status, 200);
    const w = readFileSync(join(map, 'opnames', `${id}.wav`));
    assert.equal(w.length, KOP + 3500 * 4, 'precies 3500 frames');
    assert.equal(w.readUInt32LE(40), 3500 * 4, 'de kop');
    assert.equal(w.readInt16LE(KOP), 100);
    assert.equal(w.readInt16LE(KOP + 1500 * 4), 0, 'het gat is stilte');
    assert.equal(w.readInt16LE(KOP + 2500 * 4), 300);
    assert.equal(w.readInt16LE(KOP + 3200 * 4), 0, 'de staart is stilte');
    const lijst = await (await fetch(url('/api/v2/opnames'))).json();
    assert.equal(lijst.opnames[0].id, id);
    assert.equal((await fetch(url(`/api/v2/opname/${id}?frame=0`), { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: 'x' })).status, 415);
    assert.equal((await fetch(url('/api/v2/opname/set-1?frame=0'), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(4) })).status, 404);
  });
});

test('log: stukken op hun byte, alleen ASCII', async () => {
  await metServer(async ({ map, url }) => {
    const id = 'set-20261020-120001';
    const stuk = (van, tekst) => fetch(url(`/api/v2/log/${id}?van=${van}`), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: tekst });
    const a = '{"stand":1}\n', b = '[0.1,"track.1.fader",0.5]\n';
    assert.equal((await stuk(0, a)).status, 200);
    assert.equal((await stuk(a.length, b)).status, 200);
    assert.equal((await stuk(a.length, b)).status, 200);
    assert.equal(readFileSync(join(map, 'opnames', `${id}.acties.jsonl`), 'utf8'), a + b);
    assert.equal((await stuk(0, 'é')).status, 400);
  });
});

test('alleen van deze machine: een andere Origin of Host = 403', async () => {
  await metServer(async ({ url }) => {
    const r = await fetch(url('/api/v2/nummer/x'), { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(r.status, 403);
  });
});

test('na een crash: een kop zonder lengte krijgt die uit de bestandsgrootte', () => {
  const map = mkdtempSync(join(tmpdir(), 'v2-herstel-'));
  try {
    const d = new Data(map);
    d.opnameStuk('set-20261020-130000', 0, Buffer.alloc(4000));
    const p = join(map, 'opnames', 'set-20261020-130000.wav');
    assert.equal(readFileSync(p).readUInt32LE(40), 0, 'nog geen klaar');
    new Data(map);
    assert.equal(readFileSync(p).readUInt32LE(40), 4000);
    writeFileSync(join(map, 'opnames', 'set-20261020-130001.wav'), Buffer.alloc(10));   // te kort: niets
    new Data(map);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test('instellingen: bewaren en terug, alleen geldige namen', async () => {
  await metServer(async ({ url }) => {
    assert.equal(await (await fetch(url('/api/v2/instelling/indeling-apc40mk2'))).json(), null);
    const put = (naam, b) => fetch(url(`/api/v2/instelling/${naam}`), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    assert.equal((await put('indeling-apc40mk2', { schema: 1, regels: [] })).status, 200);
    assert.deepEqual(await (await fetch(url('/api/v2/instelling/indeling-apc40mk2'))).json(), { schema: 1, regels: [] });
    assert.equal((await put('a.b', {})).status, 404);
  });
});
