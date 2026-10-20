// De bytes-laag van een Standard MIDI File (src/kern/smf.js; v1 src/lib/smf.js): VLQ, meta-events,
// tempo, maatsoort, ASCII, sporen, de kop, en lezen (ook running status, SysEx,
// onbekende chunks, en kapotte bestanden met de byte waar het misgaat).
// Puur, geen bestanden, geen mido. Het patroon -> bestand staat in
// test/patronen-midi.test.mjs.
// Overgenomen uit v1 test/smf.test.mjs: dezelfde checks, elk blok een test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ok = (name, cond, extra = '') => assert.ok(cond, name + (extra && !cond ? ` — ${extra}` : ''));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const gooit = (f, soort = Error, tekst = null) => { try { f(); return false; } catch (e) { return e instanceof soort && (!tekst || tekst.test(e.message)); } };

const { vlq, meta, ascii, tempoMeta, maatsoortMeta, mtrk, smf, leesSmf, SMF_PPQN } = await import('../src/kern/smf.js');

test('vlq, tempo, maatsoort, meta, ascii', () => {
  for (const [n, h] of [[0, '00'], [127, '7f'], [128, '81 00'], [16383, 'ff 7f'], [16384, '81 80 00'], [0x0fffffff, 'ff ff ff 7f']]) {
    ok(`vlq(${n}) = ${h}`, hex(vlq(n)) === h, hex(vlq(n)));
  }
  ok('vlq(0x10000000) gooit RangeError', gooit(() => vlq(0x10000000), RangeError));
  ok('vlq(-1) en vlq(1.5) gooien RangeError', gooit(() => vlq(-1), RangeError) && gooit(() => vlq(1.5), RangeError));

  for (const [bpm, h] of [[40, '16 e3 60'], [120, '07 a1 20'], [124, '07 62 1f'], [240, '03 d0 90']]) {
    ok(`tempoMeta(${bpm}) = ff 51 03 ${h}`, hex(tempoMeta(bpm)) === `ff 51 03 ${h}`, hex(tempoMeta(bpm)));
  }
  ok('tempo dat niet in drie bytes past gooit (3 bpm)', gooit(() => tempoMeta(3), RangeError));
  ok('maatsoortMeta() = ff 58 04 04 02 18 08', hex(maatsoortMeta()) === 'ff 58 04 04 02 18 08');
  ok('maatsoortMeta(6, 8) = ff 58 04 06 03 18 08; 4/3 gooit', hex(maatsoortMeta(6, 8)) === 'ff 58 04 06 03 18 08' && gooit(() => maatsoortMeta(4, 3), RangeError));
  ok('meta(0x2f) = ff 2f 00', hex(meta(0x2f)) === 'ff 2f 00');
  ok('meta met 200 bytes: lengte als vlq (81 48)', hex(meta(0x01, new Array(200).fill(65)).slice(0, 4)) === 'ff 01 81 48');
  ok("ascii('→ Köln') = bytes van '-> Koln'", hex(ascii('→ Köln')) === hex([...'-> Koln'].map((c) => c.charCodeAt(0))));
  ok("ascii('één') = 'een'; een emoji = één '?'", String.fromCharCode(...ascii('één')) === 'een' && String.fromCharCode(...ascii('a😀b')) === 'a?b');
  ok('ascii(null) = leeg', ascii(null).length === 0);
});

test('sporen en kop', async () => {
  const spoor = mtrk([{ t: 96, orde: 1, b: [0x90, 60, 100] }, { t: 0, orde: -1, b: meta(0x03, ascii('x')) }, { t: 96, orde: 0, b: [0x80, 59, 0] }], 384);
  ok('mtrk: sorteert op t en orde, delta-tijden, einde op 384',
    hex(spoor) === '4d 54 72 6b 00 00 00 12 00 ff 03 01 78 60 80 3b 00 00 90 3c 64 82 20 ff 2f 00', hex(spoor));
  const ev = [{ t: 5, orde: 0, b: [0x90, 1, 1] }];
  mtrk(ev, 0);
  ok('mtrk verandert de invoer niet', ev.length === 1 && Object.keys(ev[0]).join() === 't,orde,b');
  ok('mtrk: einde vóór de laatste t = einde op de laatste t', hex(mtrk([{ t: 10, orde: 0, b: [0x90, 1, 1] }], 3).slice(-4)) === '00 ff 2f 00');
  ok('mtrk: gelijk op t en orde = de volgorde van de invoer',
    hex(mtrk([{ t: 0, orde: 1, b: [0x90, 50, 1] }, { t: 0, orde: 1, b: [0x90, 40, 1] }], 0).slice(8, 16)) === '00 90 32 01 00 90 28 01');
  ok('mtrk: tick 1,5 gooit', gooit(() => mtrk([{ t: 1.5, orde: 0, b: [0x90, 1, 1] }], 0), RangeError));
  const s = smf([spoor]);
  ok('smf: MThd 6, type 1, 1 spoor, 384 PPQN', hex(s.slice(0, 14)) === '4d 54 68 64 00 00 00 06 00 01 00 01 01 80' && SMF_PPQN === 384);
  ok('smf: type 0 met twee sporen gooit; ppqn 0 gooit', gooit(() => smf([spoor, spoor], { type: 0 }), RangeError) && gooit(() => smf([spoor], { ppqn: 0 }), RangeError));
});

test('lezen', async () => {
  const sporen = [
    mtrk([{ t: 0, orde: 0, b: meta(0x03, ascii('naam')) }, { t: 0, orde: 1, b: tempoMeta(124) }, { t: 7, orde: 2, b: meta(0x06, ascii('drop')) }], 0),
    mtrk([{ t: 0, orde: 0, b: [0x99, 36, 102] }, { t: 96, orde: 0, b: [0x89, 36, 0] }, { t: 96, orde: 1, b: [0xb0, 7, 100] },
      { t: 96, orde: 2, b: [0xc3, 5] }, { t: 0x0fffffff, orde: 0, b: [0x90, 60, 1] }], 0),
  ];
  const r = leesSmf(smf(sporen));
  ok('kop terug: type 1, ppqn 384, 2 sporen', r.type === 1 && r.ppqn === 384 && r.sporen.length === 2);
  const [a, b] = r.sporen;
  ok('meta terug: naam, tempo, FF 06 marker op t 7, einde', a.length === 4 && a[0].meta === 3 && String.fromCharCode(...a[0].data) === 'naam'
    && hex(a[1].data) === '07 62 1f' && a[2].meta === 6 && a[2].t === 7 && String.fromCharCode(...a[2].data) === 'drop' && a[3].meta === 0x2f);
  ok('noot-aan op kanaal 10 terug als { st: 0x90, kanaal: 10, noot: 36, v: 102 }', b[0].st === 0x90 && b[0].kanaal === 10 && b[0].noot === 36 && b[0].v === 102 && b[0].t === 0);
  ok('noot-uit terug op t 96', b[1].st === 0x80 && b[1].kanaal === 10 && b[1].t === 96);
  ok('CC en program change als overig (met statusbyte)', hex(b[2].overig) === 'b0 07 64' && hex(b[3].overig) === 'c3 05');
  ok('delta 0x0FFFFFFF terug', b[4].t === 0x0fffffff && b[4].noot === 60);
  ok('meta-data is een kopie (geen view op de invoer)', a[0].data.buffer.byteLength === 4);
});
test('lezen (2)', async () => {
  // Running status: 00 90 3C 40 | 60 3C 00 (tweede event zonder statusbyte, velocity 0 = uit)
  const body = [0x00, 0x90, 0x3c, 0x40, 0x60, 0x3c, 0x00, 0x00, 0xff, 0x2f, 0x00];
  const bytes = Uint8Array.from([...'MThd'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 6, 0, 0, 0, 1, 0, 96], [...'MTrk'].map((c) => c.charCodeAt(0)), [0, 0, 0, body.length], body));
  const r = leesSmf(bytes);
  const ev = r.sporen[0];
  ok('running status: twee noot-events', ev.length === 3 && ev[0].st === 0x90 && ev[1].st === 0x90 && ev[1].v === 0 && ev[1].t === 96 && ev[1].noot === 60);
  ok('type 0 en ppqn 96 gelezen', r.type === 0 && r.ppqn === 96);
});
test('lezen (3)', async () => {
  // SysEx (F0) en een onbekende chunk tussen kop en spoor worden overgeslagen.
  const body = [0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7, 0x00, 0x90, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00];
  const vreemd = [...'XYZW'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 2, 1, 2]);
  const bytes = Uint8Array.from([...'MThd'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 6, 0, 1, 0, 1, 1, 0x80], vreemd, [...'MTrk'].map((c) => c.charCodeAt(0)), [0, 0, 0, body.length], body));
  const r = leesSmf(bytes);
  ok('SysEx overgeslagen, onbekende chunk overgeslagen, noot gelezen', r.sporen.length === 1 && r.sporen[0].length === 2 && r.sporen[0][0].noot === 60);
});
test('lezen (4)', async () => {
  const goed = smf([mtrk([{ t: 0, orde: 0, b: [0x90, 60, 1] }], 0)]);
  const kapot = goed.slice(); kapot[3] = 0x58;   // 'MThX'
  ok("'MThX' gooit met byte 0", gooit(() => leesSmf(kapot), Error, /MThd.*byte 0/));
  const lang = goed.slice(); lang[14 + 7] = 0x7f;   // MTrk-lengte te groot
  ok('te lange MTrk-lengte gooit met de byte van de lengte (18)', gooit(() => leesSmf(lang), Error, /byte 18/));
  const kort = goed.slice(0, goed.length - 2);
  ok('afgekapt bestand gooit', gooit(() => leesSmf(kort), Error, /SMF/));
  const smpte = goed.slice(); smpte[12] = 0xe7;
  ok('SMPTE-tijd gooit met byte 12', gooit(() => leesSmf(smpte), Error, /byte 12/));
  const zonder = Uint8Array.from([...goed.slice(0, 22), 0x00, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00]);
  zonder[21] = 7;
  ok('databyte zonder status (geen running status) gooit', gooit(() => leesSmf(zonder), Error, /zonder status/));
  ok('ArrayBuffer als invoer mag', leesSmf(goed.buffer).sporen.length === 1);
});

