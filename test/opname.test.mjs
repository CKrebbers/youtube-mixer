// Opnames: een WAV dat groeit, en na een crash nog klopt. Zonder browser.
// Draai met: node test/opname.test.mjs
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, appendFileSync, truncateSync, openSync, writeSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const O = await import('../server/opname.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

/** De lengte die de data-chunk zelf opgeeft, waar die ook staat. */
const begin = (pad) => { const fd = openSync(pad, 'r'); const b = Buffer.alloc(80); readSync(fd, b, 0, 80, 0); closeSync(fd); return b; };
const dataLengte = (pad) => { const b = begin(pad); const i = b.indexOf('data', 12, 'ascii'); return b.readUInt32LE(i + 4); };
const probe = (pad) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name',
  '-show_entries', 'format=duration', '-of', 'compact', pad], { encoding: 'utf8' }).stdout;

const map = mkdtempSync(join(tmpdir(), 'varve-opname-'));
try {
  const nu = new Date(2026, 8, 23, 21, 30, 12);
  const s = await O.start(map, { nu });
  ok('start maakt set-<datum>-<tijd>.wav', s.ok && s.bestand === 'set-20260923-213012.wav');
  const s2 = await O.start(map, { nu });
  ok('twee in dezelfde seconde: niet over elkaar heen', s2.ok && s2.id !== s.id);

  // twee seconden sinus van 440 Hz, in stukken van een seconde
  const stuk = (sec) => {
    const b = Buffer.alloc(48000 * 4);
    for (let i = 0; i < 48000; i++) {
      const v = Math.round(Math.sin(2 * Math.PI * 440 * (sec + i / 48000)) * 12000);
      b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2);
    }
    return b;
  };
  ok('stuk 1', (await O.voegToe(map, s.id, stuk(0))).ok);
  ok('stuk 2', (await O.voegToe(map, s.id, stuk(1))).ok);
  ok('half frame wordt geweigerd', !(await O.voegToe(map, s.id, Buffer.alloc(3))).ok);
  ok('onzin-id wordt geweigerd (geen ../)', !(await O.voegToe(map, '../../etc', stuk(0))).ok);
  const r = await O.sluit(map, s.id);
  ok('sluiten geeft de duur', r.ok && Math.abs(r.duur - 2) < 1e-9);

  const pad = join(map, s.bestand);
  const p1 = probe(pad);
  ok('ffprobe leest een geldige WAV: pcm_s16le, 48 kHz, stereo', /pcm_s16le/.test(p1) && /48000/.test(p1) && /channels=2/.test(p1));
  ok('en 2 seconden lang', /duration=2\.0/.test(p1));

  // crash: stuk erbij zonder sluiten -> kop klopt niet; lijst() herstelt hem
  await O.voegToe(map, s.id, stuk(2));
  const kopVoor = dataLengte(pad);
  ok('na een "crash" zegt de kop nog 2 s', kopVoor === 2 * 48000 * 4);
  const l = await O.lijst(map);
  ok('lijst() herstelt de kop uit de bestandsgrootte', dataLengte(pad) === statSync(pad).size - O.kopVan(readFileSync(pad)));
  ok('lijst geeft beide opnames, nieuwste eerst', l.length === 2 && l[0].id === s2.id);
  ok('video bij een opname: mp4 mag', (await O.voegVideoToe(map, s.id, 'mp4', Buffer.from('abc'))).ok);
  await O.voegVideoToe(map, s.id, 'mp4', Buffer.from('def'));
  ok('stukken komen achter elkaar', readFileSync(join(map, `set-${s.id}.mp4`), 'utf8') === 'abcdef');
  ok('andere extensies niet (de browser bepaalt niet wat hier ontstaat)', !(await O.voegVideoToe(map, s.id, 'exe', Buffer.from('x'))).ok);
  ok('geen losse video zonder opname', !(await O.voegVideoToe(map, '20990101-000000', 'mp4', Buffer.from('x'))).ok);
  const metVideo = await O.sluit(map, s.id);
  ok('sluiten meldt de video erbij', metVideo.video === `set-${s.id}.mp4` && metVideo.videoBytes === 6);
  writeFileSync(join(map, 'ander.txt'), 'x');
  ok('andere bestanden in de map worden genegeerd', (await O.lijst(map)).length === 2);

  // ---- stukken op hun PLEK: zelfde stuk twee keer = zelfde bytes ----------
  const pos = await O.start(map, { nu: new Date(2026, 8, 23, 22, 0, 0) });
  const pp = join(map, pos.bestand);
  const kop = O.kopVan(readFileSync(pp));
  ok('stuk op frame 0', (await O.voegToe(map, pos.id, stuk(0), 0)).ok);
  ok('hetzelfde stuk nog eens (antwoord kwijt, opnieuw geprobeerd)', (await O.voegToe(map, pos.id, stuk(0), 0)).ok);
  ok('herhaald stuk komt er NIET twee keer in', statSync(pp).size === kop + 48000 * 4);
  // stuk 1 valt weg, stuk 2 komt op zijn eigen plek: het gat is stilte
  ok('stuk 2 na een gat', (await O.voegToe(map, pos.id, stuk(2), 96000)).ok);
  const na = readFileSync(pp);
  ok('stuk 2 staat op 2 s, niet op 1 s', na.length === kop + 3 * 48000 * 4 && na.subarray(kop + 96000 * 4).equals(stuk(2)));
  ok('het gat is stilte (nullen)', na.subarray(kop + 48000 * 4, kop + 96000 * 4).every((x) => x === 0));
  // een half geschreven stuk: de herhaling overschrijft het, er komt niets bij
  const fd = openSync(pp, 'r+'); writeSync(fd, stuk(3).subarray(0, 1001), 0, 1001, kop + 3 * 48000 * 4); closeSync(fd);
  ok('herhaling na een halve schrijfactie', (await O.voegToe(map, pos.id, stuk(3), 3 * 48000)).ok);
  ok('na de halve schrijfactie precies vier seconden', statSync(pp).size === kop + 4 * 48000 * 4
    && readFileSync(pp).subarray(kop + 3 * 48000 * 4).equals(stuk(3)));
  ok('frame moet een heel getal >= 0 zijn', !(await O.voegToe(map, pos.id, stuk(0), -1)).ok && !(await O.voegToe(map, pos.id, stuk(0), 1.5)).ok);
  ok('zonder frame: achter het laatste hele frame (oude clients)', (await O.voegToe(map, pos.id, Buffer.alloc(8))).ok
    && statSync(pp).size === kop + 4 * 48000 * 4 + 8);
  // een wegvallend LAATSTE stuk: klaar kent het aantal frames en vult aan met stilte
  const kl = await O.sluit(map, pos.id, { frames: 6 * 48000 });
  ok('sluiten met frames vult een weggevallen staart aan', kl.ok && Math.abs(kl.duur - 6) < 1e-9 && statSync(pp).size === kop + 6 * 48000 * 4);

  // ---- kop op hele frames -------------------------------------------------
  appendFileSync(pp, Buffer.from([1, 2]));
  const sl = await O.sluit(map, pos.id);
  ok('kop telt alleen hele frames (geen half frame achteraan)', sl.ok && dataLengte(pp) % 4 === 0 && dataLengte(pp) === 6 * 48000 * 4);
  ok('ffprobe: 6 seconden', /duration=6\.0/.test(probe(pp)));

  // ---- langer dan 6,2 uur: meer dan 4 GB data -----------------------------
  const lang = await O.start(map, { nu: new Date(2026, 8, 23, 23, 0, 0) });
  const lp = join(map, lang.bestand);
  const lkop = O.kopVan(begin(lp));
  const uren7 = 7 * 3600 * 48000 * 4;       // ~4,8 GB, sparse: kost geen schijf
  truncateSync(lp, lkop + uren7);
  const ls = await O.sluit(map, lang.id);
  ok('7 uur: sluiten lukt (geen ERR_OUT_OF_RANGE)', ls.ok && Math.abs(ls.duur - 7 * 3600) < 1e-6);
  ok('7 uur: staat in lijst()', (await O.lijst(map)).some((x) => x.id === lang.id));
  const lpr = probe(lp);
  ok('7 uur: ffprobe leest de volle lengte (RF64)', /pcm_s16le/.test(lpr) && /duration=25200\.0/.test(lpr));

  // een opname van vóór de RF64-kop (44 bytes) die toch te lang werd: klemmen, melden
  const oud = await O.start(map, { nu: new Date(2026, 8, 23, 23, 30, 0) });
  const op = join(map, oud.bestand);
  writeFileSync(op, O.wavKop44(0));
  truncateSync(op, 44 + uren7);
  const os = await O.sluit(map, oud.id);
  ok('oude kop > 4 GB: sluiten lukt, lengte geklemd, met waarschuwing', os.ok && dataLengte(op) === 0xFFFFFFFC && !!os.waarschuwing);
  const kort = await O.start(map, { nu: new Date(2026, 8, 23, 23, 45, 0) });
  writeFileSync(join(map, kort.bestand), O.wavKop44(0));
  ok('oude kop (44 bytes) blijft gewoon werken', (await O.voegToe(map, kort.id, stuk(0), 0)).ok
    && statSync(join(map, kort.bestand)).size === 44 + 48000 * 4 && (await O.sluit(map, kort.id)).duur === 1);
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
