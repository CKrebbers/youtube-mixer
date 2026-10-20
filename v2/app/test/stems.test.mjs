// @alleen: afvalmeting (0 GC's over 20.000 blokken met stems; telt de heap, dus niets ernaast)
// Stems: de kern speelt 4 en 8 kanalen (2 of 4 stereoparen), paar 0 naar L/R en de rest naar de
// andere uitgangen, met dezelfde lijn, lus, naad en gaten als stereo (bit voor bit gelijk aan een
// stereobron met dezelfde samples), afvalvrij; de track rekent de versterking per uitgang (v1
// STEMS.md), de acties lezen null zonder stem, knippen mengt wat je hoort, en de server geeft
// stems.wav van een v1-library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PAGINA, maakKern, laadBron, planSegmenten, renderBlok, zetPagina } from '../src/audio/speler-kern.js';

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const SR = 48000, Q = 128, TAU = 2 * Math.PI;
const q16 = (x) => Math.round(x * 32767);
const FREQ = [110, 220, 440, 880];

/** k kanalen interleaved: paar p is een sinus (L) en cosinus (R) op FREQ[p]. */
function bron(kc, sec = 3) {
  const frames = Math.round(sec * SR), paginas = [];
  for (let van = 0; van < frames; van += PAGINA) {
    const n = Math.min(PAGINA, frames - van), p = new Int16Array(n * kc);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < kc; c++) {
        const f = FREQ[c >> 1], t = (van + i) / SR;
        p[i * kc + c] = q16(0.2 * ((c & 1) ? Math.cos(TAU * f * t) : Math.sin(TAU * f * t)));
      }
    }
    paginas.push(p);
  }
  return { frames, paginas };
}
/** Paar p van een bron als eigen stereobron (dezelfde samples). */
function paar(b, kc, p) {
  return { frames: b.frames, paginas: b.paginas.map((pag) => {
    const n = pag.length / kc, uit = new Int16Array(2 * n);
    for (let i = 0; i < n; i++) { uit[2 * i] = pag[i * kc + 2 * p]; uit[2 * i + 1] = pag[i * kc + 2 * p + 1]; }
    return uit;
  }) };
}
const kopie = (b) => ({ frames: b.frames, paginas: b.paginas.map((p) => (p ? p.slice() : p)) });

/** Renderen; `extra` = 6 buffers voor paar 1..3 (of null). Geeft [L, R, ...extra] over alle blokken. */
function render(k, blokken, { extra = false, voor = null } = {}) {
  const n = extra ? 8 : 2;
  const blok = Array.from({ length: n }, () => new Float32Array(Q));
  const uit = Array.from({ length: n }, () => new Float32Array(blokken * Q));
  k.extra = extra ? blok.slice(2) : null;
  for (let b = 0; b < blokken; b++) {
    if (voor) voor(b, b * Q);
    k.klok[0] = b * Q;
    renderBlok(k, blok[0], blok[1], Q);
    for (let c = 0; c < n; c++) uit[c].set(blok[c], b * Q);
  }
  return uit;
}

/** Een plan met een start, een sprong, een tempowissel en een lus met naad. */
function plan(k) {
  planSegmenten(k, [
    { T: 0.01, P: 0.3, R: 1, speelt: true },
    { T: 0.2, P: 1.1, R: 1, speelt: true },               // sprong
    { T: 0.4, P: 1.3, R: 1.07, speelt: true },            // tempo (sluit aan)
    { T: 0.6, P: 1.514, R: 1, speelt: true, la: 1.5, lb: 1.6 },   // lus met naad
  ]);
}

test('8 kanalen met uitgangen: elk paar is bit voor bit een stereobron met dezelfde samples', () => {
  const b = bron(8);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, kopie(b).paginas, 1, 8);
  plan(k);
  const uit = render(k, 400, { extra: true });
  for (let p = 0; p < 4; p++) {
    const s = paar(b, 8, p), ks = maakKern(SR);
    laadBron(ks, SR, s.frames, s.paginas);
    plan(ks);
    const [L, R] = render(ks, 400);
    const uL = uit[2 * p], uR = uit[2 * p + 1];
    let anders = 0;
    for (let i = 0; i < L.length; i++) if (L[i] !== uL[i] || R[i] !== uR[i]) anders++;
    assert.equal(anders, 0, `paar ${p}: ${anders} samples anders`);
    assert.ok(L.some((x) => Math.abs(x) > 0.1), `paar ${p} klinkt`);
  }
});

test('zonder uitgangen: de paren opgeteld (de som van de stems is het nummer)', () => {
  for (const kc of [4, 8]) {
    const b = bron(kc);
    const k = maakKern(SR);
    laadBron(k, SR, b.frames, kopie(b).paginas, 1, kc);
    plan(k);
    const [L] = render(k, 300);
    const som = new Float32Array(L.length);
    for (let p = 0; p < kc / 2; p++) {
      const s = paar(b, kc, p), ks = maakKern(SR);
      laadBron(ks, SR, s.frames, s.paginas);
      plan(ks);
      const [Lp] = render(ks, 300);
      for (let i = 0; i < som.length; i++) som[i] += Lp[i];
    }
    let grootste = 0;
    for (let i = 0; i < L.length; i++) grootste = Math.max(grootste, Math.abs(L[i] - som[i]));
    assert.ok(grootste < 1e-6, `${kc} kanalen: grootste verschil ${grootste}`);
  }
});

test('een gat (pagina ontbreekt) is stilte, net als stereo; een pagina met het verkeerde aantal kanalen wordt geweigerd', () => {
  const b = bron(4);
  const gat = kopie(b); gat.paginas[1] = undefined;
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, gat.paginas, 7, 4);
  planSegmenten(k, [{ T: 0, P: (PAGINA + 1000) / SR, R: 1, speelt: true }]);
  const [L] = render(k, 20);
  assert.ok(L.every((x) => x === 0), 'stil in het gat');
  assert.equal(zetPagina(k, 7, 1, new Int16Array(PAGINA * 2)), true, 'een pagina van 4 kanalen × PAGINA/2 frames past');
  assert.equal(zetPagina(k, 7, 1, new Int16Array(6)), false, 'geen veelvoud van 4');
  assert.throws(() => laadBron(k, SR, 10, [], 1, 6), /kanalen/);
});

test('afvalvrij: 20.000 blokken met stems (8 kanalen, uitgangen, sprongen, lussen), 0 GC', () => {
  const b = bron(8, 4);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, b.paginas, 1, 8);
  const blok = Array.from({ length: 8 }, () => new Float32Array(Q));
  k.extra = blok.slice(2);
  let zaad = 99, frame = 0, plek = 0.3;
  const toeval = () => { zaad ^= zaad << 13; zaad ^= zaad >>> 17; zaad ^= zaad << 5; return (zaad >>> 0) / 4294967296; };
  const plannen = () => {
    const segs = [];
    let T = frame / SR - 0.002;
    for (let j = 0; j < 6; j++) {
      const s = toeval();
      if (s < 0.4) plek = 0.2 + toeval() * 3;
      const seg = { T, P: plek, R: 0.9 + toeval() * 0.2, speelt: s < 0.9 };
      if (s > 0.6 && s < 0.9) { seg.la = Math.max(0, plek - 0.02); seg.lb = seg.la + 0.05 + toeval() * 0.3; }
      segs.push(seg);
      const dt = 0.02 + toeval() * 0.1;
      plek += dt; T += dt;
    }
    planSegmenten(k, segs);
  };
  const draai = (n) => { for (let i = 0; i < n; i++) { k.klok[0] = frame; renderBlok(k, blok[0], blok[1], Q); frame += Q; } };
  for (let v = 0; v < 30; v++) { plannen(); draai(400); }
  let gcs = 0, blokken = 0;
  while (blokken < 20000) {
    plannen();
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    draai(400);
    gcs += prof.stop().statistics.length;
    blokken += 400;
  }
  assert.equal(gcs, 0, `${gcs} GC's tijdens ${blokken} blokken`);
});

// ---- de track en de acties ----------------------------------------------------------

const { Track, STEM_STANDEN } = await import('../src/engine/track.js');

function nepTrack() {
  const gezet = [];
  const speler = { zetStem: (k, g, o) => gezet.push([k, g, !!o?.kill]), plan() {}, bijvullen() {}, leeg() {}, positie: () => 0 };
  const engine = { nu: () => 0, straks: () => 0.01, klok: { loopt: false, on() {} }, emit() {}, hoorbaar: () => false, vertraging: () => 0 };
  const t = new Track({ n: 1, engine, speler, strip: { lees: () => 1, zet() {} } });
  return { t, gezet };
}

test('track: gewichten per uitgang (v1 STEMS.md), kill en niveau, alles open bij elke laad', () => {
  const { t, gezet } = nepTrack();
  t.laad({ id: 'a', duur: 10, grid: null, stems: { namen: STEM_STANDEN[4], schaal: 0.5 } });
  assert.deepEqual(t.stemGewichten(), [2, 2, 2, 2], '1 / schaal');
  t.zetStemKill('drums', true);
  assert.deepEqual(t.stemGewichten(), [0, 2, 2, 2]);
  assert.deepEqual(gezet.at(-1), [3, 2, true], 'een kill gaat langs de zachte S');
  t.zetStemNiveau('inst', 0.5);
  assert.deepEqual(t.stemGewichten(), [0, 1, 1, 2], 'inst bij vier = drums + bas + overig, zang niet');
  t.zetStemKill('inst', true);
  assert.deepEqual(t.stemGewichten(), [0, 0, 0, 2]);
  assert.equal(t.heeftStem('inst'), true);
  t.laad({ id: 'b', duur: 10, grid: null, stems: { namen: STEM_STANDEN[2], schaal: 1 } });
  assert.deepEqual(t.stemGewichten(), [1, 1], 'bij een laad alles open');
  assert.equal(t.heeftStem('drums'), false);
  assert.ok(t.zetStemKill('drums', true)?.geweigerd);
  t.laad({ id: 'c', duur: 10, grid: null });
  assert.deepEqual(t.stemGewichten(), [1], 'zonder stems: uitgang 0 op 1');
});

test('acties: track.{n}.stem.* lezen null zonder stem; kill wisselt; hold zolang je drukt', async () => {
  const { Engine } = await import('../src/engine/engine.js');
  const { nepAudio, nepCtx } = await import('./nep-audio.mjs');
  const e = new Engine({ ctx: nepCtx(), audio: nepAudio(), timer: false });
  await e.klaar;
  const b = bron(8, 1);
  await e.laad(1, { id: 's', titel: 's', duur: 1, grid: null, stems: { namen: STEM_STANDEN[4], schaal: 1 }, haal: async () => ({ sr: SR, kanalen: 8, frames: b.frames, paginas: b.paginas }) });
  assert.equal(e.bus.lees('track.1.stem.drums'), 1);
  assert.equal(e.bus.lees('track.1.stem.drums.kill'), 0);
  e.bus.doe('track.1.stem.drums.kill', true);
  assert.equal(e.bus.lees('track.1.stem.drums.kill'), 1);
  e.bus.doe('track.1.stem.drums.kill', true);
  assert.equal(e.bus.lees('track.1.stem.drums.kill'), 0);
  e.bus.doe('track.1.stem.vocals.kill.hold', true);
  assert.equal(e.track(1).stemKill.vocals, true);
  e.bus.doe('track.1.stem.vocals.kill.hold', false);
  assert.equal(e.track(1).stemKill.vocals, false);
  e.bus.doe('track.1.stem.bass', 0.25);
  assert.equal(e.bus.lees('track.1.stem.bass'), 0.25);
  assert.equal(e.bus.lees('track.2.stem.drums'), null, 'lege track');
  // Een stereonummer: geen stems, ook al zegt de library iets.
  const s2 = bron(2, 1);
  await e.laad(1, { id: 't', titel: 't', duur: 1, grid: null, stems: { namen: STEM_STANDEN[4], schaal: 1 }, haal: async () => ({ sr: SR, kanalen: 2, frames: s2.frames, paginas: s2.paginas }) });
  assert.equal(e.bus.lees('track.1.stem.drums'), null);
  e.stop?.();
});

test('knippen (sampler) met stems: gemengd met de gewichten van wat je hoort', async () => {
  const { knipPcm } = await import('../src/engine/sampler.js');
  const b = bron(4, 1);
  const zonderZang = await knipPcm({ sr: SR, kanalen: 4, frames: b.frames, paginas: b.paginas }, 0.1, 0.2, [0, 1]);
  const alleen = paar(b, 4, 1);
  const f0 = Math.round(0.1 * SR);
  for (let i = 0; i < 100; i++) assert.equal(zonderZang.paginas[0][2 * i], alleen.paginas[0][2 * (f0 + i)]);
  const som = await knipPcm({ sr: SR, kanalen: 4, frames: b.frames, paginas: b.paginas }, 0.1, 0.2);
  assert.equal(som.paginas[0][0], b.paginas[0][f0 * 4] + b.paginas[0][f0 * 4 + 2], 'zonder gewichten: de som');
});

// ---- de server ------------------------------------------------------------------------

test('server: stemsVan, de lijst zegt stems en video, /stems geeft stems.wav met Range', async () => {
  const { maakServer, stemsVan } = await import('../server.mjs');
  assert.equal(stemsVan(null), null);
  assert.equal(stemsVan('{"aantal":3}'), null);
  assert.equal(stemsVan(JSON.stringify({ aantal: 2, namen: ['vocals', 'inst'], schaal: 1, bestand: 'media/x/../stems.wav' })), null, 'geen pad naar buiten');
  const media = mkdtempSync(join(tmpdir(), 'v2-stems-media-'));
  const data = mkdtempSync(join(tmpdir(), 'v2-stems-data-'));
  mkdirSync(join(media, 'n1'));
  writeFileSync(join(media, 'n1', 'audio.wav'), Buffer.alloc(100));
  writeFileSync(join(media, 'n1', 'stems.wav'), Buffer.from(Array.from({ length: 200 }, (_, i) => i)));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(media, 'library.db'));
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, uploader TEXT, duur REAL, audio TEXT, video TEXT, stems_json TEXT, toegevoegd INTEGER)');
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('yt:a', 'A', '', 10, 'media/n1/audio.wav', null,
    JSON.stringify({ versie: 1, aantal: 4, namen: ['drums', 'bass', 'other', 'vocals'], schaal: 0.9, bestand: 'media/n1/stems.wav' }), 1);
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('yt:b', 'B', '', 10, 'media/n1/audio.wav', 'media/n1/video.mp4', null, 2);
  db.close();
  const srv = maakServer({ media, data });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = (p) => `http://localhost:${srv.address().port}${p}`;
  try {
    const lijst = await (await fetch(url('/api/library'))).json();
    const a = lijst.nummers?.find?.((x) => x.id === 'yt:a') ?? lijst.find?.((x) => x.id === 'yt:a');
    const bb = lijst.nummers?.find?.((x) => x.id === 'yt:b') ?? lijst.find?.((x) => x.id === 'yt:b');
    assert.deepEqual(a.stems, { aantal: 4, namen: ['drums', 'bass', 'other', 'vocals'], schaal: 0.9, bestand: 'media/n1/stems.wav' });
    assert.equal(a.video, false);
    assert.equal(bb.video, true);
    assert.equal(bb.stems, null);
    const r = await fetch(url('/api/library/yt:a/stems'), { headers: { range: 'bytes=10-19' } });
    assert.equal(r.status, 206);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], Array.from({ length: 10 }, (_, i) => 10 + i));
    const geen = await fetch(url('/api/library/yt:b/stems'));
    assert.equal(geen.status, 404);
    await geen.arrayBuffer();
  } finally {
    srv.closeAllConnections(); await new Promise((r) => srv.close(r));
    rmSync(media, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true });
  }
});
