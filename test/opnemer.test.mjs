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
const storing = { antwoordKwijt: new Set(), valWeg: new Set(), video: false, wegTot: -1, vol: new Set(), status: 0, videoKwijt: 0 };
// Pogingen per stuknummer (ook mislukte), en per videoplek.
const pogingen = new Map();
const videoPogingen = new Map();

// Een nep-klok: wachten schuift hem op (de opnemer wacht tussen pogingen) en geeft
// de event loop even vrij, zodat timers (de worklet die 'klaar' zegt) ook lopen.
let nepNu = 0;
const nepWacht = (ms) => { nepNu += ms; return new Promise((r) => setImmediate(r)); };
const klok = { wacht: nepWacht, nu: () => nepNu };
/** De server is weg tot de nep-klok voorbij `ms` vanaf nu is. */
const serverWeg = (ms) => { storing.wegTot = nepNu + ms; };
// Telt per soort (stuk, video, klaar…) hoe vaak een antwoord GELEZEN is:
// Chrome houdt een ongelezen antwoord vast (docs/WINST.md punt 1).
const gelezen = { stuk: 0, video: 0, gelukt: { stuk: 0, video: 0 } };
const antwoord = (r, soort) => {
  if (r.ok && soort) gelezen.gelukt[soort]++;
  return { ok: r.ok, status: r.ok ? 200 : 400, json: async () => { if (soort) gelezen[soort]++; return r; } };
};
async function haal(url, init) {
  const u = new URL(url, 'http://localhost');
  const getal = (k) => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : undefined);
  const m = /^\/api\/opname\/([\w-]+)\/(stuk|klaar|video\.(\w+))$/.exec(u.pathname);
  if (u.pathname === '/api/opname/start') return antwoord(await O.start(map));
  // Elke poging tellen, ook die het niet halen (herkend aan de inhoud).
  const nr = m?.[2] === 'stuk' ? STUKNRS.find((n) => stuk(n).equals(Buffer.from(init.body))) : undefined;
  if (nr !== undefined) pogingen.set(nr, (pogingen.get(nr) || 0) + 1);
  // De server is helemaal weg (gekilld, herstart): geen verbinding, voor elk verzoek.
  if (nepNu < storing.wegTot) throw new TypeError('Failed to fetch');
  // De server hangt: elk verzoek loopt op de time-out (AbortSignal.timeout gooit een TimeoutError).
  if (storing.hangt) throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
  // Een proxy ervoor (tailscale serve) antwoordt 502 zolang de server weg is.
  if (storing.status) { const st = storing.status; return { ok: false, status: st, json: async () => ({}) }; }
  if (m?.[2] === 'stuk') {
    // Storingen per stuknummer (herkend aan de inhoud), niet per frame: zo
    // raakt de storing ook een client die geen frame meestuurt.
    const body = Buffer.from(init.body);
    if (storing.valWeg.has(nr)) throw new Error('netwerk weg');
    if (storing.vol.has(nr)) return antwoord({ ok: false, fout: 'de schijf is vol', vol: true }, 'stuk');
    const r = await O.voegToe(map, m[1], body, getal('frame'));
    // De server schreef het wel, maar het antwoord komt nooit aan.
    if (storing.antwoordKwijt.has(nr)) { storing.antwoordKwijt.delete(nr); throw new Error('antwoord kwijt'); }
    return antwoord(r, 'stuk');
  }
  if (m?.[2] === 'klaar') return antwoord(await O.sluit(map, m[1], { frames: getal('frames') }));
  if (m?.[3]) {
    if (storing.video) throw new Error('videostuk onderweg kwijt');
    const van = getal('van');
    videoPogingen.set(van, (videoPogingen.get(van) || 0) + 1);
    const r = await O.voegVideoToe(map, m[1], m[3], Buffer.from(init.body), van);
    // Geschreven, maar het antwoord komt niet aan.
    if (storing.videoKwijt > 0) { storing.videoKwijt--; throw new Error('antwoord kwijt'); }
    return antwoord(r, 'video');
  }
  throw new Error(`onbekend: ${url}`);
}

/** De stuknummers die de nep-server herkent (aan de inhoud). */
const STUKNRS = Array.from({ length: 64 }, (_, i) => i);
/** Een seconde stereo met een herkenbaar patroon per stuk. */
const stukken = new Map();
const stuk = (n) => {
  if (stukken.has(n)) return stukken.get(n);
  const b = Buffer.alloc(48000 * 4);
  stukken.set(n, b);
  for (let i = 0; i < 48000; i++) { b.writeInt16LE((n * 997 + i) % 30000, i * 4); b.writeInt16LE(-((n * 991 + i) % 30000), i * 4 + 2); }
  return b;
};
/** Laat de rij lopen tot `klaar()` (of tot het genoeg is: dan faalt de check die erop volgt). */
const rustTot = async (klaar, max = 20000) => { for (let i = 0; i < max && !klaar(); i++) await new Promise((r) => setImmediate(r)); };
const geef = (node, n) => { const b = stuk(n); node.port.onmessage({ data: { type: 'stuk', data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length), frames: 48000 } }); };

const { Opnemer, meldingVan } = await import('../src/opname/opnemer.js');
try {
  // ---- 1. een antwoord dat verloren gaat: niet dubbel in de WAV --------------
  {
    const engine = maakEngine();
    const op = new Opnemer({ engine, haal, ...klok });
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
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
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
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
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
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
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

  // ---- 3b. elk gelukt antwoord wordt gelezen (geheugenlek, WINST.md punt 1) --
  {
    gelezen.stuk = gelezen.video = gelezen.gelukt.stuk = gelezen.gelukt.video = 0;
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    op.onFout = () => {};
    await op.start({ video: { captureStream: () => ({ getVideoTracks: () => [] }) } });
    const node = nodes.at(-1);
    for (let n = 0; n < 4; n++) geef(node, n);
    for (let n = 0; n < 3; n++) recs.at(-1).ondataavailable({ data: { size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } });
    const r = await op.stop();
    ok('lek: 4 gelukte stukken, 4 keer json() gelezen', r.ok && gelezen.gelukt.stuk === 4 && gelezen.stuk === 4);
    ok('lek: 3 gelukte videostukken, 3 keer json() gelezen', gelezen.gelukt.video === 3 && gelezen.video === 3);
  }

  // ---- 3c. leesWeg gooit nooit (antwoord zonder json, kapotte JSON, null) ---
  {
    const { leesWeg } = await import('../src/lib/antwoord.js');
    let goed = true;
    for (const r of [null, undefined, {}, { json: () => { throw new Error('sync'); } }, { json: async () => { throw new SyntaxError('geen json'); } }, { json: async () => 1 }]) {
      try { const p = leesWeg(r); if (!(p instanceof Promise)) goed = false; await p; } catch (_) { goed = false; }
    }
    ok('leesWeg gooit nooit en geeft altijd een belofte', goed);
  }

  // ---- 5. de server is 30 s weg: alles wacht en komt daarna op zijn plek -----
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    const fouten = [], standen = [];
    op.onFout = (f) => fouten.push(f);
    op.onStand = (st) => standen.push(st);
    const s = await op.start();
    const node = nodes.at(-1);
    pogingen.clear();
    geef(node, 0);
    await rustTot(() => op.wachtSeconden === 0);
    serverWeg(30000);
    const t0 = nepNu;
    for (let n = 1; n < 40; n++) geef(node, n);       // 39 s audio terwijl de server weg is
    await rustTot(() => op.storing !== null);
    ok('server weg: de storing begint, de rij wacht', op.storing !== null && op.wachtSeconden === 39);
    await rustTot(() => op.wachtSeconden === 0);
    ok(`na terugkomst is de rij leeg (${((nepNu - t0) / 1000).toFixed(1)} s op de nep-klok)`, op.wachtSeconden === 0 && nepNu - t0 >= 30000);
    ok(`de pauze tussen pogingen liep op tot 2 s (${pogingen.get(1)} pogingen in ~32 s)`, pogingen.get(1) >= 15 && pogingen.get(1) <= 20);
    ok('wat erachter wachtte is één keer verstuurd (strikt op volgorde)', [...Array(38)].every((_, i) => pogingen.get(i + 2) === 1));
    const st = standen.filter((x) => x.storing);
    ok(`één storing die meegroeit: ${st.length} standen, wacht ${st[0]?.wacht} → ${st.at(-1)?.wacht} s`, st.length >= 10 && st.every((x) => x.wacht === 39 && x.verloren === 0));
    ok('en daarna "weer goed, niets verloren"', JSON.stringify(standen.at(-1)) === JSON.stringify({ storing: false, goed: true, verloren: 0 }));
    geef(node, 40);
    const r = await op.stop();
    const buf = readFileSync(join(map, s.bestand));
    const kop = O.kopVan(buf);
    ok('server 30 s weg: WAV precies 41 s, geen gat, geen dubbel', r.ok && buf.length === kop + 41 * 48000 * 4
      && [...Array(41)].every((_, n) => buf.subarray(kop + n * 192000, kop + (n + 1) * 192000).equals(stuk(n))));
    ok('niets kwijt: geen fout, geen waarschuwing', fouten.length === 0 && !r.waarschuwing && op.verloren === 0);
  }

  // ---- 5b. een proxy ervoor (502) telt ook als "server weg" --------------------
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    const standen = [];
    op.onStand = (st) => standen.push(st);
    op.onFout = () => {};
    const s = await op.start();
    const node = nodes.at(-1);
    pogingen.clear();
    storing.status = 502;
    geef(node, 0);
    await rustTot(() => standen.length >= 6);
    ok('502 van een proxy: blijft proberen (geen 3-pogingenregel)', op.storing !== null && standen.length >= 6 && op.verloren === 0);
    storing.status = 0;
    await rustTot(() => op.wachtSeconden === 0);
    const r = await op.stop();
    const buf = readFileSync(join(map, s.bestand));
    ok('na de 502 staat het stuk er gewoon', r.ok && buf.subarray(O.kopVan(buf)).equals(stuk(0)));
  }

  // ---- 6. de rij is vol: het oudste stuk valt weg, op zijn plek -----------------
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok, rijSeconden: 5 });
    const fouten = [], standen = [];
    op.onFout = (f) => fouten.push(f);
    op.onStand = (st) => standen.push(st);
    const s = await op.start();
    const node = nodes.at(-1);
    serverWeg(20000);
    for (let n = 0; n < 10; n++) geef(node, n);       // 10 s in de rij, er passen er 5
    await rustTot(() => op.wachtSeconden === 0);
    ok(`rij vol: de oudste 5 s weg, gemeld (${fouten.length} keer)`, op.verloren === 5 && fouten.length === 5 && /stuk kwijt/.test(fouten[0]));
    ok('de stand zegt: 5 s verloren in deze storing', standen.some((x) => x.storing && x.verloren === 5)
      && JSON.stringify(standen.at(-1)) === JSON.stringify({ storing: false, goed: true, verloren: 5 }));
    const r = await op.stop();
    const buf = readFileSync(join(map, s.bestand));
    const kop = O.kopVan(buf);
    ok('rij vol: WAV toch 10 s, de eerste 5 s stilte, de rest op zijn tijd', r.ok && buf.length === kop + 10 * 192000
      && buf.subarray(kop, kop + 5 * 192000).every((x) => x === 0)
      && [5, 6, 7, 8, 9].every((n) => buf.subarray(kop + n * 192000, kop + (n + 1) * 192000).equals(stuk(n))));
    ok('en stop waarschuwt met het totaal', /in totaal 5 s stilte/.test(r.waarschuwing || ''));
  }

  // ---- 7. de schijf is vol: niet opnieuw proberen ------------------------------
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    const fouten = [], standen = [];
    op.onFout = (f) => fouten.push(f);
    op.onStand = (st) => standen.push(st);
    const s = await op.start();
    const node = nodes.at(-1);
    pogingen.clear();
    storing.vol.add(1);
    for (let n = 0; n < 3; n++) geef(node, n);
    const r = await op.stop();
    storing.vol.clear();
    const buf = readFileSync(join(map, s.bestand));
    const kop = O.kopVan(buf);
    ok('schijf vol: één poging, niet opnieuw', pogingen.get(1) === 1);
    ok('schijf vol: gemeld als fout, geen "server weg"-storing', fouten.length === 1 && /vol/.test(fouten[0]) && standen.length === 0);
    ok('schijf vol: gat op zijn plek, de rest erna', r.ok && buf.subarray(kop + 192000, kop + 2 * 192000).every((x) => x === 0)
      && buf.subarray(kop + 2 * 192000).equals(stuk(2)));
  }

  // ---- 8. stoppen terwijl de server nog weg is: een grens, dan de oude regel -----
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    const fouten = [], standen = [];
    op.onFout = (f) => fouten.push(f);
    op.onStand = (st) => standen.push(st);
    const s = await op.start();
    const node = nodes.at(-1);
    serverWeg(10 * 60_000);
    for (let n = 0; n < 3; n++) geef(node, n);
    await rustTot(() => op.storing !== null);
    const echt0 = performance.now();
    const r = await op.stop();
    const nep = nepNu - (op._doorTot - 10_000);      // vanaf het moment dat de opname stilstond
    ok(`stop met de server weg: geeft op na de grens (${(nep / 1000).toFixed(1)} s nep, ${(performance.now() - echt0).toFixed(0)} ms echt)`,
      !r.ok && /afsluiten mislukt/.test(r.fout) && nep >= 10_000 && nep < 20_000);
    ok('de drie stukken zijn kwijt en gemeld', op.verloren === 3 && fouten.length === 3);
    ok('de stand eindigt op "niet goed, 3 s verloren"', JSON.stringify(standen.at(-1)) === JSON.stringify({ storing: false, goed: false, verloren: 3 }));
    storing.wegTot = -1;
    const lijst = await O.lijst(map);
    ok('het bestand bestaat (de kop herstelt de server bij de volgende start)', lijst.some((x) => x.bestand === s.bestand));
  }

  // ---- 8b. de server HANGT: na de grens niet nog per stuk een time-out ----------
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    op.onFout = () => {};
    await op.start();
    const node = nodes.at(-1);
    pogingen.clear();
    storing.hangt = true;
    for (let n = 0; n < 5; n++) geef(node, n);
    const r = await op.stop();
    storing.hangt = false;
    ok('server hangt: na de grens alleen het eerste stuk geprobeerd, de rest meteen opgegeven',
      !r.ok && pogingen.get(0) >= 3 && [1, 2, 3, 4].every((n) => !pogingen.has(n)) && op.verloren === 5);
  }

  // ---- 9. een videostuk wordt herhaald op zijn plek (?van=), niet dubbel --------
  {
    const op = new Opnemer({ engine: maakEngine(), haal, ...klok });
    op.onFout = () => {};
    const s = await op.start({ video: { captureStream: () => ({ getVideoTracks: () => [] }) } });
    videoPogingen.clear();
    storing.videoKwijt = 1;                 // het eerste antwoord komt niet aan
    const rec = recs.at(-1);
    for (const b of [[1, 2, 3], [4, 5], [6]]) rec.ondataavailable({ data: { size: b.length, arrayBuffer: async () => new Uint8Array(b).buffer } });
    serverWeg(5000);                        // en daarna is de server even weg
    const r = await op.stop();
    const video = readFileSync(join(map, s.bestand.replace(/\.wav$/, '.webm')));
    ok(`video: herhaald op dezelfde plek, niet dubbel (${[...video].join(',')})`, r.ok && video.equals(Buffer.from([1, 2, 3, 4, 5, 6])) && videoPogingen.get(0) >= 2);
    ok('video: elk stuk droeg zijn plek', [0, 3, 5].every((v) => videoPogingen.has(v)));
    const id = s.bestand.replace(/^set-|\.wav$/g, '');
    ok('server: een ongeldige ?van= wordt geweigerd', !(await O.voegVideoToe(map, id, 'webm', Buffer.from([1]), -1)).ok
      && !(await O.voegVideoToe(map, id, 'webm', Buffer.from([1]), 1.5)).ok);
    ok('server: zonder ?van= nog gewoon erachter (oude clients)', (await O.voegVideoToe(map, id, 'webm', Buffer.from([7]))).ok
      && readFileSync(join(map, `set-${id}.webm`)).equals(Buffer.from([1, 2, 3, 4, 5, 6, 7])));
  }

  // ---- 10. de tekst van de ene melding (opname-knop.js, sleutel 'opname') ------
  {
    const m1 = meldingVan({ storing: true, wacht: 14.2, verloren: 0, fout: 'Failed to fetch' });
    const m2 = meldingVan({ storing: true, wacht: 300, verloren: 3, fout: 'x' });
    const m3 = meldingVan({ storing: false, goed: true, verloren: 0 });
    const m4 = meldingVan({ storing: false, goed: true, verloren: 2 });
    const m5 = meldingVan({ storing: false, goed: false, verloren: 3 });
    ok(`melding: "${m1.tekst}"`, m1.soort === 'fout' && m1.tekst === 'opname: server antwoordt niet, 14 s in de wacht');
    ok(`melding: "${m2.tekst}"`, m2.tekst === 'opname: server antwoordt niet, 300 s in de wacht, 3 s verloren');
    ok(`melding: "${m3.tekst}" (info, gaat vanzelf weg)`, m3.soort === 'info' && m3.tekst === 'opname: weer goed, niets verloren');
    ok(`melding: "${m4.tekst}"`, m4.soort === 'fout' && m4.tekst === 'opname: weer goed, 2 s verloren (stilte op die plek)');
    ok(`melding: "${m5.tekst}"`, m5.soort === 'fout' && /server antwoordde niet, 3 s verloren/.test(m5.tekst));
    const bron = readFileSync(new URL('../src/ui/opname-knop.js', import.meta.url), 'utf8');
    ok('opname-knop: elke melding van de opname draagt de sleutel', [...bron.matchAll(/meld\(/g)].length >= 6
      && [...bron.matchAll(/meld\([^;]*SLEUTEL\)/g)].length === [...bron.matchAll(/meld\(/g)].length);
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
