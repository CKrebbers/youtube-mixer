// Wat kost een nieuwe kaartversie (VERSIE in src/engine/tellen.js) bij het opstarten? Een eigen
// proefserver (VARVE_TESTSERVER=1, alles in een tijdelijke map, poort --poort, standaard 8866) met
// synthetische nummers (nummers.mjs) waarvan het grid uit de tellen van kaartversie 1 is, en een
// tellen.json uit nep-beatthis ('bt'). Twee keer opstarten: zonder en met de bewaarde tweede mening
// (tweede-mening.json). Leest en schrijft niets buiten die tijdelijke map (docs/BEATGRID.md §12).
//   node tools/beatmeting/synth/opstart.mjs [--poort 8866] [namen ...]   (standaard jungle-172 live-drift house-124)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const wt = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const ip = args.indexOf('--poort');
const POORT = ip >= 0 ? args.splice(ip, 2)[1] : '8866';
const TMP = join(tmpdir(), 'varve-opstart');
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const { Library } = await import(`${wt}/server/library.js`);
const { NUMMERS, wavVan } = await import(`${wt}/tools/beatmeting/synth/nummers.mjs`);
const { nepTellen } = await import(`${wt}/tools/beatmeting/synth/nep-beatthis.mjs`);
const { gridUitTellen } = await import(`${wt}/src/engine/tellen.js`);
const { maakNepTellen } = await import(`${wt}/test/nep-tellen.mjs`);
const { run } = await import(`${wt}/server/ingest.js`);
const namen = args.length ? args : ['jungle-172', 'live-drift', 'house-124'];
const db = join(TMP, 'library.db'), media = join(TMP, 'media');
const v1 = {};
for (const naam of namen) {
  const n = NUMMERS[naam]();
  const d = join(media, naam); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'mono.wav'), wavVan(n.x));
  // De server wil 48 kHz stereo 16-bit (zoals de ingest).
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(d, 'mono.wav'), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', join(d, 'audio.wav')]);
  rmSync(join(d, 'mono.wav'));
  const t = nepTellen(n, 'bt');
  writeFileSync(join(d, 'tellen.json'), JSON.stringify({ versie: 1, beats: t.beats, downbeats: t.downbeats }));
  const g = gridUitTellen(t.beats, t.downbeats, { duur: n.duur });
  v1[naam] = { ...g, bron: 'auto', versie: 1, duur: n.duur };
}
const zet = () => {
  const lib = new Library(db);
  for (const naam of namen) {
    if (!lib.track(naam)) lib.bewaarTrack({ id: naam, url: `https://example.com/${naam}`, titel: naam, uploader: 't', duur: v1[naam].duur,
      audio: `media/${naam}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(naam, v1[naam]);
  }
  lib.sluit();
};
async function start(label) {
  zet();
  const t0 = Date.now();
  let uit = '';
  const s = spawn(process.execPath, ['server/index.js'], { cwd: wt, env: { ...process.env, PORT: POORT, VARVE_TESTSERVER: '1', VARVE_DB: db, VARVE_MEDIA: media,
    VARVE_OPNAMES: join(TMP, 'opnames'), VARVE_PATRONEN: join(TMP, 'patronen'), VARVE_PLANNEN: join(TMP, 'plannen'), VARVE_STANDEN: join(TMP, 'standen'),
    VARVE_PROEF: join(TMP, 'proef'), VARVE_HERANALYSE: '100', VARVE_TELLEN_CMD: maakNepTellen(TMP), VARVE_STEMS_CMD: '/bin/false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  s.stdout.on('data', (d) => { uit += d; }); s.stderr.on('data', (d) => { uit += d; });
  const klaar = await new Promise((z) => {
    const iv = setInterval(() => { const m = /\[tellen\] (\d+) grids? uit bestaande tellen klaar — ([\d.]+) s/.exec(uit); if (m) { clearInterval(iv); z(m); } if (Date.now() - t0 > 120000) { clearInterval(iv); z(null); } }, 50);
  });
  s.kill('SIGTERM'); await new Promise((z) => s.on('exit', z));
  console.log(`== ${label}: ${klaar ? `${klaar[1]} grids in ${klaar[2]} s (na de start van de achtergrond)` : 'niet klaar binnen 120 s'}`);
  for (const l of uit.split('\n').filter((l) => /^\[tellen\] /.test(l))) console.log('  ', l);
}
await start('eerste start (geen tweede mening bewaard)');
await start('tweede start (bewaard)');
process.exit(0);
