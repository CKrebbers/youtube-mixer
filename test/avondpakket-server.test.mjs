// GET /api/avondpakket op een EIGEN server (willekeurige hoge poort) met een
// kladlibrary, kladmedia en de volledige omgeving (H12): VARVE_DB, _MEDIA, _PROEF,
// _PLANNEN, _OPNAMES, _PATRONEN, _BACKUPS, _KAART(_DB), _NACHT, de nep-yt-dlp,
// en VARVE_AVONDPAKKET_NEP (fixtures in plaats van commando's: geen
// system_profiler, geen echte hardware). Clay's server, media en library blijven
// buiten schot. Toetst: het rapport, library compleet (een rij met stems zonder
// stems.wav), een onbekend profiel (200), vreemde Host (403), één meting voor
// twee verzoeken, de bevriezing na een Range-verzoek op audio.wav (er speelt een
// deck), geen pad of backupnaam in het antwoord, en dat de route niets schrijft.
// Draai met: node test/avondpakket-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from './nep-ytdlp.mjs';

const { Library } = await import('../server/library.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const FX = join(WORTEL, 'test/fixtures/avondpakket');
const map = mkdtempSync(join(tmpdir(), 'varve-avondpakket-server-'));
const media = join(map, 'media');
const db = join(media, 'library.db');

// De kladmedia: nrA en nrB met audio; nrA heeft in de rij stems, maar geen stems.wav.
for (const id of ['nrA', 'nrB']) {
  mkdirSync(join(media, id), { recursive: true });
  writeFileSync(join(media, id, 'audio.wav'), Buffer.alloc(4096, 1));
}
{
  const lib = new Library(db);
  for (const id of ['nrA', 'nrB']) {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 10,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  }
  lib.bewaarStems('nrA', { aantal: 2, namen: ['zang', 'rest'], schaal: 1, bestand: 'media/nrA/stems.wav' });
  lib.sluit();
}
// nep.json: de fixtures, maar de find-uitvoer is wat er echt in de kladmedia staat.
const nepMap = join(map, 'nep');
mkdirSync(nepMap);
{
  const basis = JSON.parse(readFileSync(join(FX, 'nep.json'), 'utf8'));
  for (const [k, v] of Object.entries(basis)) if (typeof v === 'string' && /\.(txt|json)$/.test(v)) basis[k] = join(FX, v);
  const regels = ['nrA', 'nrB'].map((id) => `4096 ${join(media, id, 'audio.wav')}`).join('\n') + '\n';
  writeFileSync(join(nepMap, 'nep.json'), JSON.stringify({ ...basis, 'find-stat': { tekst: regels }, 'find-dataless': { tekst: '' },
    paden: { media, wortel: WORTEL, db, extra: [] } }));
}

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'), VARVE_PLANNEN: join(map, 'plannen'),
    VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'), VARVE_KAART: join(WORTEL, 'test/fixtures/varve-kaart.klein.json'),
    VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_NACHT: join(map, 'nacht.json'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(map),
    VARVE_AVONDPAKKET_NEP: nepMap },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const B = `http://localhost:${poort}`;
const rauw = (pad, headers = {}, method = 'GET') => new Promise((klaar) => {
  const rq = request({ host: '127.0.0.1', port: poort, path: pad, method, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => {
    const d = []; res.on('data', (x) => d.push(x)); res.on('end', () => klaar({ status: res.statusCode, body: Buffer.concat(d).toString() }));
  });
  rq.on('error', () => klaar({ status: 0, body: '' }));
  rq.end();
});
/** Alles in de kladmap: pad → grootte + mtime (om te zien dat de route niets schrijft). */
function momentopname(m = map, uit = new Map()) {
  for (const n of readdirSync(m)) {
    const p = join(m, n);
    const s = statSync(p);
    if (s.isDirectory()) momentopname(p, uit); else uit.set(p, `${s.size}:${s.mtimeMs}`);
  }
  return uit;
}

try {
  let klaar = false;
  for (let i = 0; i < 150 && !klaar; i++) {
    const b = await fetch(`${B}/api/backups`).then((r) => r.json(), () => null);
    klaar = !!b && !b.bezig && (b.laatste || b.fout);
    if (!klaar) await wacht(100);
  }
  ok('server draait en de eerste backup is klaar', klaar);
  await wacht(300);
  const voor = momentopname();

  console.log('het rapport');
  const r1 = await fetch(`${B}/api/avondpakket?profiel=apc`).then(async (r) => ({ status: r.status, j: await r.json() }));
  const p = (id, j = r1.j) => j.punten.find((x) => x.id === id);
  ok(`200, profiel apc, fase auto → vertrek, punten (${r1.status}, ${r1.j?.fase}, ${r1.j?.punten?.length})`, r1.status === 200 && r1.j.profiel === 'apc'
    && r1.j.fase === 'vertrek' && r1.j.punten.length > 10 && Number.isFinite(r1.j.duurMs));
  ok(`compleet: rood met nrA/stems.wav (${p('compleet')?.sub})`, p('compleet').licht === 'fout' && /nrA\/stems\.wav \(ontbreekt\)/.test(p('compleet').sub));
  ok(`media lokaal: 2 gezien, de library verwacht 3 → oranje "2 van 3" (H11) (${p('media').licht} ${p('media').waarde})`, p('media').licht === 'half' && p('media').waarde === '2 van 3');
  ok('backup uit de server zelf: groen, "gaat mee in de tas"', p('backup').licht === 'ok' && /gaat mee in de tas/.test(p('backup').sub));
  ok('achtergrond uit de rijen: rustig', p('achtergrond').licht === 'ok');
  ok('paklijst en profielen in het antwoord', r1.j.paklijst.length > 5 && r1.j.profielen.length === 5);
  const s1 = JSON.stringify(r1.j);
  ok('geen kladpad, geen /Users/, geen backupnaam in het antwoord', !s1.includes(map) && !s1.includes('/Users/') && !/library-20\d\d/.test(s1));
  const r2 = await fetch(`${B}/api/avondpakket?profiel=maschine&fase=aankomst`).then((r) => r.json());
  ok('tweede verzoek binnen 10 s (ander profiel en fase): dezelfde meting (zelfde t)', r2.t === r1.j.t && r2.profiel === 'maschine' && r2.fase === 'aankomst' && r2.faseGekozen);

  console.log('\nfouten en grenzen');
  const onb = await fetch(`${B}/api/avondpakket?profiel=bestaatniet`);
  const onbj = await onb.json();
  ok('onbekend profiel → 200, standaardprofiel, profielOnbekend, oranje punt', onb.status === 200 && onbj.profiel === 'apc' && onbj.profielOnbekend === 'bestaatniet'
    && p('profiel', onbj).licht === 'half');
  ok('vreemde Host → 403', (await rauw('/api/avondpakket', { Host: `varve.evil.example:${poort}` })).status === 403);
  ok('POST → 404 (alleen GET)', (await fetch(`${B}/api/avondpakket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 404);
  ok('/api/backups heeft gewijzigdSinds', typeof (await fetch(`${B}/api/backups`).then((r) => r.json())).gewijzigdSinds === 'boolean');
  ok('profielen.json is niet via HTTP te lezen', (await rauw('/avondpakket/profielen.json')).status === 404);

  console.log('\nbevroren als er een deck speelt');
  const range = await rauw('/media/nrA/audio.wav', { Range: 'bytes=0-99' });
  ok('Range op /media/nrA/audio.wav → 206 (de server ziet een spelend deck)', range.status === 206);
  const b1 = await fetch(`${B}/api/avondpakket?profiel=apc`).then((r) => r.json());
  ok('daarna: bevroren, dezelfde meting (geen nieuwe)', b1.bevroren === 'er speelt een deck' && b1.t === r1.j.t);
  ok('compleet: grijs met de oude stand', p('compleet', b1).licht === 'uit' && /niet vernieuwd/.test(p('compleet', b1).sub));
  await wacht(2100);
  const b2 = await fetch(`${B}/api/avondpakket?profiel=apc&vers=1`).then((r) => r.json());
  ok('vers=1 terwijl er een deck speelt: wel bevroren, een nieuwe (goedkope) meting', b2.bevroren === 'er speelt een deck' && b2.t > r1.j.t);
  ok('… en de dure punten houden de vorige stand (media "2 van 3")', p('media', b2).waarde === '2 van 3');

  await wacht(300);
  const na = momentopname();
  const anders = [...new Set([...voor.keys(), ...na.keys()])].filter((k) => voor.get(k) !== na.get(k)).map((k) => k.slice(map.length));
  ok(`de route schreef niets in de kladmappen (${anders.join(', ') || 'niets veranderd'})`, anders.length === 0);
  ok('geen fout in het serverlog', !/Error|fout bij/i.test(log.replace(/ExperimentalWarning[^\n]*\n?/g, '')));
} finally {
  server.kill();
  await wacht(200);
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
