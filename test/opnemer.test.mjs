// De opnemer in de browser, zonder browser: een nep-AudioContext en een
// nep-haal die rechtstreeks de echte server/opname.js aanroept, in een
// tijdelijke map. Zo meet je wat er op schijf komt als het netwerk hapert.
// Draai met: node test/opnemer.test.mjs
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const O = await import('../server/opname.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-Web Audio ---------------------------------------------------------
const nodes = [];
globalThis.AudioWorkletNode = class {
  constructor() {
    // De worklet antwoordt op 'stop' met 'klaar', asynchroon, zoals de audiothread.
    this.port = { onmessage: null, postMessage: (m) => { if (m.type === 'stop') setTimeout(() => this.port.onmessage?.({ data: { type: 'klaar' } }), 0); } };
    nodes.push(this);
  }
  connect(x) { return x; }
  disconnect() {}
};
const recs = [];
globalThis.MediaRecorder = class {
  static isTypeSupported(t) { return t === 'video/webm'; }
  constructor() { this.state = 'inactive'; recs.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); }
};
globalThis.MediaStream = class { constructor() {} };

function maakEngine({ kanHervatten = true } = {}) {
  const ctx = {
    sampleRate: 48000, state: 'suspended', hervat: 0,
    audioWorklet: { addModule: async () => {} },
    createGain: () => ({ gain: { value: 1 }, connect: (x) => x, disconnect() {} }),
    createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [] } }),
    destination: {},
    // Chrome zonder gebruikersgebaar: de belofte blijft hangen.
    resume() { ctx.hervat++; if (!kanHervatten) return new Promise(() => {}); ctx.state = 'running'; return Promise.resolve(); },
  };
  return { ctx, master: { analyser: { connect() {}, disconnect() {} } }, async resume() { if (ctx.state !== 'running') await ctx.resume(); } };
}

// ---- nep-haal: de echte serverfuncties, met storingen op bestelling -------
const map = mkdtempSync(join(tmpdir(), 'varve-opnemer-'));
const storing = { antwoordKwijt: new Set(), valWeg: new Set(), video: false };
const antwoord = (r) => ({ ok: r.ok, status: r.ok ? 200 : 400, json: async () => r });
async function haal(url, init) {
  const u = new URL(url, 'http://localhost');
  const getal = (k) => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : undefined);
  const m = /^\/api\/opname\/([\w-]+)\/(stuk|klaar|video\.(\w+))$/.exec(u.pathname);
  if (u.pathname === '/api/opname/start') return antwoord(await O.start(map));
  if (m?.[2] === 'stuk') {
    // Storingen per stuknummer (herkend aan de inhoud), niet per frame: zo
    // raakt de storing ook een client die geen frame meestuurt.
    const body = Buffer.from(init.body);
    const nr = [0, 1, 2, 3, 4, 5].find((n) => stuk(n).equals(body));
    if (storing.valWeg.has(nr)) throw new Error('netwerk weg');
    const r = await O.voegToe(map, m[1], body, getal('frame'));
    // De server schreef het wel, maar het antwoord komt nooit aan.
    if (storing.antwoordKwijt.has(nr)) { storing.antwoordKwijt.delete(nr); throw new Error('antwoord kwijt'); }
    return antwoord(r);
  }
  if (m?.[2] === 'klaar') return antwoord(await O.sluit(map, m[1], { frames: getal('frames') }));
  if (m?.[3]) {
    if (storing.video) throw new Error('videostuk onderweg kwijt');
    return antwoord(await O.voegVideoToe(map, m[1], m[3], Buffer.from(init.body)));
  }
  throw new Error(`onbekend: ${url}`);
}

/** Een seconde stereo met een herkenbaar patroon per stuk. */
const stuk = (n) => {
  const b = Buffer.alloc(48000 * 4);
  for (let i = 0; i < 48000; i++) { b.writeInt16LE((n * 997 + i) % 30000, i * 4); b.writeInt16LE(-((n * 991 + i) % 30000), i * 4 + 2); }
  return b;
};
const geef = (node, n) => { const b = stuk(n); node.port.onmessage({ data: { type: 'stuk', data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length), frames: 48000 } }); };

const { Opnemer } = await import('../src/opname/opnemer.js');
try {
  // ---- 1. een antwoord dat verloren gaat: niet dubbel in de WAV --------------
  {
    const engine = maakEngine();
    const op = new Opnemer({ engine, haal, wacht: () => Promise.resolve() });
    const fouten = [];
    op.onFout = (f) => fouten.push(f);
    const s = await op.start();
    ok('start lukt', s.ok);
    ok('start zet een stilstaande AudioContext aan (APC: record.start zonder klik)', engine.ctx.state === 'running' && engine.ctx.hervat === 1);
    const node = nodes.at(-1);
    storing.antwoordKwijt.add(1);          // stuk 2: geschreven, antwoord kwijt, opnieuw geprobeerd
    for (let n = 0; n < 3; n++) geef(node, n);
    const r = await op.stop();
    const buf = readFileSync(join(map, s.bestand));
    const kop = O.kopVan(buf);
    ok('stop lukt', r.ok);
    ok('antwoord kwijt: WAV precies 3 s, stuk 2 niet dubbel', buf.length === kop + 3 * 48000 * 4 && Math.abs(r.duur - 3) < 1e-9);
    ok('stuk 3 staat op 2 s', buf.subarray(kop + 96000 * 4).equals(stuk(2)));
    ok('een gelukte herhaling is geen fout', fouten.length === 0);
  }

  // ---- 1b. een stuk middenin valt helemaal weg: gat = stilte, rest op tijd --
  {
    const op = new Opnemer({ engine: maakEngine(), haal, wacht: () => Promise.resolve() });
    const fouten = [];
    op.onFout = (f) => fouten.push(f);
    const s = await op.start();
    const node = nodes.at(-1);
    storing.valWeg.add(2);                 // stuk 3: drie keer mis, helemaal weg
    for (let n = 0; n < 5; n++) geef(node, n);
    const r = await op.stop();
    storing.valWeg.clear();
    const buf = readFileSync(join(map, s.bestand));
    const kop = O.kopVan(buf);
    ok('stuk weg: WAV toch 5 s (niet korter dan de video)', r.ok && buf.length === kop + 5 * 48000 * 4);
    ok('het weggevallen stuk is stilte, op zijn plek', buf.subarray(kop + 96000 * 4, kop + 144000 * 4).every((x) => x === 0));
    ok('stuk 4 en 5 staan op hun tijd (gelijk met de video)', buf.subarray(kop + 144000 * 4, kop + 192000 * 4).equals(stuk(3))
      && buf.subarray(kop + 192000 * 4).equals(stuk(4)));
    ok('het weggevallen stuk wordt gemeld via onFout', fouten.length === 1 && /stuk kwijt/.test(fouten[0]));
  }

  // ---- 2. het LAATSTE stuk valt weg: de WAV wordt niet korter ---------------
  {
    const op = new Opnemer({ engine: maakEngine(), haal, wacht: () => Promise.resolve() });
    op.onFout = () => {};
    const s = await op.start();
    const node = nodes.at(-1);
    storing.valWeg.add(2);
    for (let n = 0; n < 3; n++) geef(node, n);
    const r = await op.stop();
    storing.valWeg.clear();
    ok('laatste stuk weg: WAV toch 3 s (staart stilte)', r.ok && statSync(join(map, s.bestand)).size === O.kopVan(readFileSync(join(map, s.bestand))) + 3 * 48000 * 4);
  }

  // ---- 3. een verloren videostuk komt bij de gebruiker, niet alleen in de console
  {
    const op = new Opnemer({ engine: maakEngine(), haal, wacht: () => Promise.resolve() });
    const fouten = [];
    op.onFout = (f) => fouten.push(f);
    const s = await op.start({ video: { captureStream: () => ({ getVideoTracks: () => [] }) } });
    ok('start met video lukt (webm)', s.ok && s.video === 'webm');
    storing.video = true;
    recs.at(-1).ondataavailable({ data: { size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } });
    const r = await op.stop();
    storing.video = false;
    ok('verloren videostuk gaat naar onFout', fouten.some((f) => /videostuk kwijt/.test(f)));
    ok('en staat als waarschuwing in het resultaat van stop', r.ok && /videostuk kwijt/.test(r.waarschuwing || ''));
  }

  // ---- 4. een AudioContext die niet aan wil: duidelijk weigeren, niet hangen
  {
    const op = new Opnemer({ engine: maakEngine({ kanHervatten: false }), haal, hervatTijd: 50 });
    const t0 = performance.now();
    const r = await op.start();
    ok('AudioContext wil niet aan: start weigert met een reden', !r.ok && /klik/.test(r.fout || ''));
    ok('en hangt niet', performance.now() - t0 < 1000);
    ok('er is geen opname begonnen', !op.bezig);
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
