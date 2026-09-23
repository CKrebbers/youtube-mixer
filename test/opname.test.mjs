// Opnames: een WAV dat groeit, en na een crash nog klopt. Zonder browser.
// Draai met: node test/opname.test.mjs
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const O = await import('../server/opname.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

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
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name',
    '-show_entries', 'format=duration', '-of', 'compact', pad], { encoding: 'utf8' }).stdout;
  ok('ffprobe leest een geldige WAV: pcm_s16le, 48 kHz, stereo', /pcm_s16le/.test(probe) && /48000/.test(probe) && /channels=2/.test(probe));
  ok('en 2 seconden lang', /duration=2\.0/.test(probe));

  // crash: stuk erbij zonder sluiten -> kop klopt niet; lijst() herstelt hem
  await O.voegToe(map, s.id, stuk(2));
  const kopVoor = readFileSync(pad).readUInt32LE(40);
  ok('na een "crash" zegt de kop nog 2 s', kopVoor === 2 * 48000 * 4);
  const l = await O.lijst(map);
  ok('lijst() herstelt de kop uit de bestandsgrootte', readFileSync(pad).readUInt32LE(40) === statSync(pad).size - 44);
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
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
