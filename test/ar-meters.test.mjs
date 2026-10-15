// VRAGEN AR2 en AR4 (16 okt): de twee meters voor op de Mac. tools/beatmeting/ar2.mjs (de metingen van AR2 in
// één opdracht; droog standaard) en tools/beatmeting/vloer.mjs (komt "vier op de vloer" voor, en valt de "1" daar
// naast de downbeats?). Hier: het plan van ar2 zonder iets te draaien, het oordeel van vloer op synthetische
// lage banden waarvan het antwoord bekend is, en de CLI van vloer op een eigen library in een tijdelijke map.
// Draai met: node test/ar-meters.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan, FRAGMENTEN, MODEL_CURL } from '../tools/beatmeting/ar2.mjs';
import { vloerOordeel, meetNummer } from '../tools/beatmeting/vloer.mjs';
import { maatSterkte } from '../src/engine/tellen.js';

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'varve-ar-meters-'));

console.log('ar2: het plan (droog)');
{
  const p = plan({ env: {}, home: '/h', bestaat: () => false, tmp: '/t', node: 'node' });
  ok('zonder venv en checkpoint: twee dingen ontbreken, met de curl-opdracht voor het model',
    p.ontbreekt.length === 2 && p.ontbreekt.some((o) => o.includes(MODEL_CURL)) && p.python === '/h/.varve/stems-venv/bin/python');
  ok('drie stappen: de bench met --beatthis en --json, groep op dezelfde json, tel1-echt met de zes fragmenten',
    p.stappen.length === 3 && p.stappen[0].args.includes('--beatthis') && p.stappen[1].args.at(-1) === p.uitJson
    && p.stappen[2].args.slice(1).join() === FRAGMENTEN.join());
  const q = plan({ env: { VARVE_TELLEN_PY: '/py', VARVE_TELLEN_MODEL: '/m.ckpt' }, bestaat: () => true, tmp: '/t', node: 'node' });
  ok('VARVE_TELLEN_PY en VARVE_TELLEN_MODEL gaan voor; alles aanwezig = niets ontbreekt', q.python === '/py' && q.model === '/m.ckpt' && q.ontbreekt.length === 0);
  const r = spawnSync(process.execPath, [join(WORTEL, 'tools/beatmeting/ar2.mjs')], { encoding: 'utf8', env: { ...process.env, HOME: tmp, VARVE_TELLEN_PY: '', VARVE_STEMS_PY: '' } });
  ok(`droog op een machine zonder model: exit 2, zegt wat ontbreekt en draait niets (${r.status})`,
    r.status === 2 && /ONTBREEKT: geen checkpoint/.test(r.stdout) && /zou draaien: \(a\)/.test(r.stdout) && !/== \(a\)/.test(r.stdout));
}

// Een lage band van 4 ms per waarde: op tel k van de maat (fase k) een kick van sterkte `kick[k]` (40 ms).
const RATE = 250, BPM = 120, L = 60 / BPM, MATEN = 24;
function laagMet(kick) {
  const env = new Float32Array(Math.round((MATEN * 4 * L + 1) * RATE));
  for (let t = 0; t < MATEN * 4; t++) {
    const v = Math.round(t * L * RATE);
    for (let j = 0; j < 10; j++) env[v + j] = kick[t % 4];
  }
  return { env, envRate: RATE, tijdOffset: 0 };
}
const ST = { van: 0, bpm: BPM, anker: 0, maat: 0 };
const GRID = { stukken: [ST], beatsPerBar: 4 };
const sterkte = (kick) => maatSterkte(ST, Infinity, 4, laagMet(kick));

console.log('\nvloer: wat de lage band zegt (synthetisch, het antwoord is bekend)');
{
  ok('vier op de vloer (elke tel even sterk): "vloer"', vloerOordeel(sterkte([1, 1, 1, 1])) === 'vloer');
  ok('een sterke "1" en een zwakkere 3, niets op 2 en 4: "mening"', vloerOordeel(sterkte([1, 0, 0.6, 0])) === 'mening');
  ok('tel 2 duidelijk sterker dan de "1": "twijfel" (zoals de server)', vloerOordeel(sterkte([0.3, 1, 0.3, 0.3])) === 'twijfel');
  ok('geen kick of bas: "stil"', vloerOordeel(sterkte([0, 0, 0, 0])) === 'stil');
  ok('te weinig maten: "te kort"', vloerOordeel(null) === 'te kort');
  const beats = Array.from({ length: MATEN * 4 }, (_, k) => k * L);
  const goed = beats.filter((_, k) => k % 4 === 0), naast = beats.filter((_, k) => k % 4 === 1);
  const a = meetNummer(GRID, { beats, downbeats: goed }, laagMet([1, 1, 1, 1]))[0];
  ok(`vier op de vloer, downbeats op de "1": niet verdacht (een ${a.een})`, a.oordeel === 'vloer' && a.een >= 0.9 && !a.verdacht);
  const b = meetNummer(GRID, { beats, downbeats: naast }, laagMet([1, 1, 1, 1]))[0];
  ok(`vier op de vloer, downbeats een tel verder: VERDACHT (een ${b.een})`, b.oordeel === 'vloer' && b.een < 0.9 && b.verdacht);
  const c = meetNummer(GRID, { beats, downbeats: naast }, laagMet([1, 0, 0.6, 0]))[0];
  ok('met een mening van de lage band is het niet "verdacht" (dat ziet de server zelf)', !c.verdacht);
}

console.log('\nvloer: de CLI op een eigen library (alleen lezen)');
{
  const { Library } = await import('../server/library.js');
  const media = join(tmp, 'media');
  const lib = new Library(join(tmp, 'lib.db'));
  const beats = Array.from({ length: MATEN * 4 }, (_, k) => k * L);
  for (const [id, down] of [['goed', 0], ['naast', 1]]) {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: `titel ${id}`, uploader: 't', duur: MATEN * 4 * L,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, GRID);
    mkdirSync(join(media, id), { recursive: true });
    const l = laagMet([1, 1, 1, 1]);
    writeFileSync(join(media, id, 'laag.bin'), Buffer.from(l.env.buffer));
    writeFileSync(join(media, id, 'laag.json'), JSON.stringify({ versie: 1, envRate: RATE, tijdOffset: 0, frames: l.env.length }));
    writeFileSync(join(media, id, 'tellen.json'), JSON.stringify({ versie: 1, beats, downbeats: beats.filter((_, k) => k % 4 === down) }));
  }
  lib.sluit();
  const voor = readFileSync(join(tmp, 'lib.db'));
  const r = spawnSync(process.execPath, [join(WORTEL, 'tools/beatmeting/vloer.mjs'), '--media', media, '--db', join(tmp, 'lib.db')], { encoding: 'utf8' });
  ok(`twee nummers, één verdacht: exit 2 en de titel staat erbij (${r.status})`, r.status === 2 && /2 nummers gemeten/.test(r.stdout) && /VERDACHT[^\n]*: 1/.test(r.stdout) && /titel naast/.test(r.stdout) && !/titel goed ·/.test(r.stdout), r.stdout + r.stderr);
  ok('library.db is niet aangeraakt (byte voor byte gelijk)', Buffer.compare(voor, readFileSync(join(tmp, 'lib.db'))) === 0);
  const leeg = spawnSync(process.execPath, [join(WORTEL, 'tools/beatmeting/vloer.mjs'), '--db', join(tmp, 'bestaat-niet.db')], { encoding: 'utf8' });
  ok('geen library: exit 1 met een reden', leeg.status === 1 && /geen library\.db/.test(leeg.stderr));
}

rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
