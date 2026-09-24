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

// ---- de hele pipeline, zonder internet ------------------------------------
// yt-dlp haalt ook een los mediabestand van een gewone URL (de generic
// extractor). Een eigen HTTP-server op 127.0.0.1 met een klikspoor: zo loopt
// de echte ingest, inclusief het grid-voorstel, zonder YouTube.

{
  const { createServer } = await import('node:http');
  const SR = 44100, duur = 60, bpm = 124, T0 = 0.25;
  const x = new Int16Array(SR * duur * 2);
  for (let t = T0; t < duur; t += 60 / bpm) {
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 400 && s0 + i < SR * duur; i++) {
      const v = Math.round(20000 * Math.exp(-i / 60) * Math.sin((2 * Math.PI * 900 * i) / SR));
      x[(s0 + i) * 2] = v; x[(s0 + i) * 2 + 1] = v;
    }
  }
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + x.byteLength, 4); kop.write('WAVE', 8); kop.write('fmt ', 12);
  kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22); kop.writeUInt32LE(SR, 24);
  kop.writeUInt32LE(SR * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34); kop.write('data', 36);
  kop.writeUInt32LE(x.byteLength, 40);
  const wav = Buffer.concat([kop, Buffer.from(x.buffer)]);
  const srv = createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
    r.end(q.method === 'HEAD' ? undefined : wav);
  });
  await new Promise((k) => srv.listen(0, '127.0.0.1', k));
  const stappen = [];
  const r = await ing.ingest(`http://127.0.0.1:${srv.address().port}/klik124.wav`,
    { mediaDir: map, video: false, onStap: (s) => stappen.push(s.stap) });
  srv.close();
  ok(`ingest van een lokaal klikspoor lukt${r.ok ? '' : ` (${r.fout})`}`, r.ok === true);
  const g = r.track?.grid;
  ok('de ingest zoekt een beatgrid (stap "grid")', stappen.includes('grid'));
  ok('en levert een automatisch grid: bron auto, niet op slot', g?.bron === 'auto' && g.slot === false);
  ok(`met zekerheid per stuk (${g?.stukken.map((s) => `${s.bpm.toFixed(2)} z${s.zekerheid.toFixed(2)}`).join(' | ')})`,
    !!g && g.stukken.every((s) => typeof s.zekerheid === 'number'));
  const P = 60 / bpm;
  const naast = g ? Math.abs(g.stukken[0].anker - (T0 + Math.round((g.stukken[0].anker - T0) / P) * P)) : 1;
  ok(`124 bpm, zeker, tel op de klik (${(naast * 1000).toFixed(1)} ms)`,
    !!g && g.zeker === true && Math.abs(g.stukken[0].bpm - 124) < 0.1 && naast < 0.012);
  const tk = r.track?.toon;
  ok(`en zoekt de toonsoort (stap "toon"): een kaart, auto, versie, vanaf 0 (${tk?.stukken.map((s) => `${s.toonsoort} z${s.zekerheid}`).join(' | ')})`,
    stappen.includes('toon') && stappen.indexOf('toon') > stappen.indexOf('grid') && tk?.bron === 'auto' && tk.slot === false
    && tk.versie >= 1 && tk.stukken[0].van === 0 && tk.stukken.every((s) => typeof s.zekerheid === 'number'));
  // Een klikspoor van 900 Hz is geen muziek: hoe dan ook geen zekere toonsoort.
  ok('een klikspoor heeft geen duidelijke toonsoort (zekerheid < 0,15)', !!tk && tk.stukken.every((s) => s.zekerheid < 0.15));
  // Wat de server ermee doet: bewaren, maar nooit over een grid op slot.
  const { Library } = await import('../server/library.js');
  const lib = new Library(join(map, 'lib.db'));
  lib.bewaarTrack({ ...r.track, audio: 'media/klik124/audio.wav' });
  lib.bewaarGrid(r.track.id, { stukken: [{ van: 0, bpm: 62, anker: 0 }], slot: true });
  ok('een grid op slot blijft staan als het nummer opnieuw binnenkomt', !lib.bewaarAutoGrid(r.track.id, g).bewaard
    && lib.track(r.track.id).grid.stukken[0].bpm === 62);
  lib.bewaarToon(r.track.id, { stukken: [{ van: 0, toonsoort: 'E', stemming: 0 }], bron: 'hand', slot: true });
  ok('een toonsoort op slot ook', !lib.bewaarAutoToon(r.track.id, tk).bewaard && lib.track(r.track.id).toon.stukken[0].toonsoort === 'E');
  lib.sluit();
}

rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
