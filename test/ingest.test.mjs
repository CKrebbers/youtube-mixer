// De ingest-laag zonder netwerk: ffmpeg maakt zijn eigen testmateriaal.
// Wat hier NIET getest wordt is yt-dlp zelf — dat vraagt YouTube, en een test
// die van een externe dienst afhangt is geen test maar een weersverwachting.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ing = await import('../server/ingest.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const map = mkdtempSync(join(tmpdir(), 'varve-ingest-'));

// ---- run(): mag nooit gooien ----------------------------------------------

const weg = await ing.run('dit-commando-bestaat-niet-xyz', []);
ok('onbekend commando geeft een resultaat in plaats van een crash', weg.ok === false && weg.code === -1);
ok('en vertelt wat er mis was', weg.stderr.length > 0);

const stuk = await ing.run('ffmpeg', ['-i', join(map, 'bestaat-niet.wav'), join(map, 'x.wav')]);
ok('een mislukt commando geeft ok:false', stuk.ok === false);

const goed = await ing.run('ffmpeg', ['-version']);
ok('een geslaagd commando geeft ok:true', goed.ok === true && goed.stdout.includes('ffmpeg'));

// ---- versievergelijking ----------------------------------------------------

ok('ouder wordt herkend', ing.ouderDan('2025.12.08', '2026.8.19') === true);
ok('nieuwer niet', ing.ouderDan('2026.9.1', '2026.8.19') === false);
ok('gelijk is niet ouder', ing.ouderDan('2026.8.19', '2026.8.19') === false);
// yt-dlp zegt 2026.08.19, PyPI zegt 2026.8.19 — als tekst ongelijk, als versie gelijk.
ok('voorloopnullen maken geen verschil', ing.gelijkeVersie('2026.08.19', '2026.8.19') === true);
ok('en ouderDan trapt daar ook niet in', ing.ouderDan('2026.08.19', '2026.8.19') === false);

// ---- tooling ---------------------------------------------------------------

const t = await ing.controleerTooling();
ok('tooling gevonden', t.ok === true && t.ontbreekt.length === 0);
ok('yt-dlp-versie gelezen', /^\d{4}\./.test(t.ytdlp || ''));

// ---- loudness in twee passes ----------------------------------------------

const stil = join(map, 'stil.wav');
await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', 'sine=frequency=220:duration=5,volume=-30dB', '-ar', '44100', '-ac', '2', stil]);
ok('testbestand gemaakt', existsSync(stil));

const meting = await ing.meetLoudness(stil);
ok('pass 1 geeft meetwaarden', meting.ok && meting.gemeten.I < -25);
ok('inclusief drempel en offset',
  typeof meting.gemeten.drempel === 'number' && typeof meting.gemeten.offset === 'number');

const uit = join(map, 'stil-norm.wav');
const norm = await ing.normaliseer(stil, meting.gemeten, uit);
ok('pass 2 schrijft een bestand', norm.ok && existsSync(uit));

const na = await ing.meetLoudness(uit);
ok('het resultaat ligt op het doel', Math.abs(na.gemeten.I - ing.LOUDNESS.I) < 0.5);
ok('en de piek blijft onder het plafond', na.gemeten.TP <= ing.LOUDNESS.TP + 0.1);

const kapot = await ing.meetLoudness(join(map, 'bestaat-niet.wav'));
ok('meten van een onbestaand bestand meldt netjes', kapot.ok === false && !!kapot.fout);

// ---- duur ------------------------------------------------------------------

ok('duur wordt gelezen', Math.abs(await ing.duurVan(stil) - 5) < 0.2);
ok('duur van niets is 0', await ing.duurVan(join(map, 'bestaat-niet.wav')) === 0);

// ---- constante framerate ---------------------------------------------------
// -vsync is uit ffmpeg 9 verwijderd; cfrTranscode moet op beide werken.

const bron = join(map, 'bron.mp4');
await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', 'testsrc=size=320x180:rate=24:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bron]);
const cfr = join(map, 'cfr.mp4');
const conv = await ing.cfrTranscode(bron, cfr, { fps: 30 });
ok('transcoderen naar constante framerate lukt', conv.ok && existsSync(cfr));

const probe = await ing.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=r_frame_rate,avg_frame_rate', '-of', 'default=nw=1', cfr]);
ok('en levert echt 30 fps', probe.stdout.includes('30/1'));
ok('constant, dus r_frame_rate en avg_frame_rate zijn gelijk',
  (probe.stdout.match(/30\/1/g) || []).length === 2);

const convStuk = await ing.cfrTranscode(join(map, 'niets.mp4'), join(map, 'uit.mp4'));
ok('een kapotte bron meldt de fout in plaats van stil te falen',
  convStuk.ok === false && convStuk.fout.length > 0);

rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
