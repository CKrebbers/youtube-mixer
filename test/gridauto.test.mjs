// Het automatische grid op de server (stap C): achtergrondanalyse bij het
// opstarten, de knop "opnieuw analyseren", de onset-pieken en de status in de
// library. Eigen server op een eigen poort met een tijdelijke database en
// mediamap: je echte library blijft buiten schot.
// Draai met: node test/gridauto.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const { Library } = await import('../server/library.js');
const analyze = await import('../server/analyze.js');
const beatgrid = await import('../src/engine/beatgrid.js');
const { gridStatus } = await import('../src/ui/grid-strook.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const map = mkdtempSync(join(tmpdir(), 'varve-gridauto-'));
const db = join(map, 'test.db');
const media = join(map, 'media');

const SR = 11025;
function wavVan(x) {
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + x.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(1, 22);
  kop.writeUInt32LE(SR, 24); kop.writeUInt32LE(SR * 2, 28); kop.writeUInt16LE(2, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(x.byteLength, 40);
  return Buffer.concat([kop, Buffer.from(x.buffer)]);
}
function klikWav(duur, bpm, T0 = 0.2) {
  const x = new Int16Array(Math.round(SR * duur));
  for (let t = T0; t < duur; t += 60 / bpm) {
    const s = Math.round(t * SR);
    for (let i = 0; i < 220 && s + i < x.length; i++) x[s + i] = Math.round(20000 * Math.exp(-i / 40) * Math.sin((2 * Math.PI * 900 * i) / SR));
  }
  return wavVan(x);
}
function ruisWav(duur) {
  const x = new Int16Array(SR * duur);
  let z = 77;
  const rnd = () => ((z = (Math.imul(z, 1103515245) + 12345) >>> 0) / 2147483648 - 1);
  for (let i = 0; i < x.length; i++) x[i] = Math.round(3000 * rnd());
  return wavVan(x);
}
const zet = (id, wav) => { mkdirSync(join(media, id), { recursive: true }); writeFileSync(join(media, id, 'audio.wav'), wav); };
zet('nK', klikWav(480, 128));      // lang: de analyse kost seconden, genoeg om Range tijdens te meten
zet('nO', klikWav(60, 110));
zet('nS', klikWav(60, 100));
zet('nH', klikWav(60, 100));
zet('nR', ruisWav(60));

const lib = new Library(db);
const duren = { nK: 480, nO: 60, nS: 60, nH: 60, nR: 60 };
for (const id of Object.keys(duren)) {
  lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: duren[id],
    audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
}
lib.bewaarGrid('nO', { bpm: 61.9, firstBeat: 3.3 });                                     // oud: geen bron, geen slot
const SLOT = { stukken: [{ van: 0, bpm: 50, anker: 0.2 }], slot: true };
lib.bewaarGrid('nS', SLOT);
const HAND = { stukken: [{ van: 0, bpm: 100, anker: 0.21, zekerheid: 0.3 }], bron: 'hand' };
lib.bewaarGrid('nH', HAND);
lib.sluit();

console.log('drempels');
ok('server en engine gebruiken dezelfde drempels', analyze.ZEKER_VANAF === beatgrid.ZEKER_VANAF && analyze.GEEN_PULS === beatgrid.GEEN_PULS);

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_OPNAMES: join(map, 'opnames'), VARVE_MEDIA: media,
    VARVE_HERANALYSE: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const B = `http://localhost:${poort}`;
const lijst = async () => Object.fromEntries((await (await fetch(`${B}/api/library`)).json()).tracks.map((t) => [t.id, t]));
try {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${B}/api/opnames`).catch(() => null);
    if (r?.ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('\nachtergrondanalyse bij het opstarten');
  // Intussen Range-verzoeken, zoals een spelend deck ze doet.
  const wacht = [];
  const t0 = performance.now();
  let tracks;
  for (;;) {
    const t = performance.now();
    const r = await fetch(`${B}/media/nK/audio.wav`, { headers: { Range: 'bytes=0-65535' } });
    await r.arrayBuffer();
    wacht.push(performance.now() - t);
    if (log.includes('achtergrondanalyse klaar') || performance.now() - t0 > 120000) break;
    await new Promise((z) => setTimeout(z, 10));
  }
  const duur = performance.now() - t0;
  tracks = await lijst();
  const p95 = [...wacht].sort((a, b) => a - b)[Math.floor(wacht.length * 0.95)];
  ok(`analyse op de achtergrond duurde ${(duur / 1000).toFixed(1)} s; Range p95 ${p95.toFixed(0)} ms, traagste ${Math.max(...wacht).toFixed(0)} ms (${wacht.length} verzoeken)`,
    log.includes('achtergrondanalyse klaar') && wacht.length > 20 && p95 < 50 && Math.max(...wacht) < 500);
  ok('de serverlog zegt wat er gebeurt', /\[grid\] 3 nummers zonder automatisch grid/.test(log) && /\[grid\] nK: \d+ stuk/.test(log));
  const k = tracks.nK.grid;
  ok(`leeg nummer: automatisch grid (${k?.stukken.map((s) => `${s.bpm.toFixed(2)} z${s.zekerheid?.toFixed(2)}`).join(' | ')})`,
    k?.bron === 'auto' && !k.slot && k.stukken.every((s) => Math.abs(s.bpm - 128) < 0.1 && s.zekerheid >= analyze.ZEKER_VANAF));
  ok('onset.bin is in de testmap gezet', (await import('node:fs')).existsSync(join(media, 'nK', 'onset.bin')));
  ok(`oud grid (61,9, zonder bron) vervangen door 110 (${tracks.nO.grid?.stukken[0].bpm.toFixed(2)})`,
    tracks.nO.grid?.bron === 'auto' && Math.abs(tracks.nO.grid.stukken[0].bpm - 110) < 0.1);
  ok('grid op SLOT niet aangeraakt', JSON.stringify(tracks.nS.grid.stukken) === JSON.stringify(SLOT.stukken) && tracks.nS.grid.slot === true);
  ok('met de hand bewerkt grid niet aangeraakt', tracks.nH.grid.bron === 'hand' && tracks.nH.grid.stukken[0].bpm === 100);
  ok(`ruis: één stuk zonder puls (z${tracks.nR.grid?.stukken[0].zekerheid?.toFixed(2)})`,
    tracks.nR.grid?.bron === 'auto' && tracks.nR.grid.stukken.every((s) => s.zekerheid < analyze.GEEN_PULS));

  console.log('\nstatus in de library');
  const st = (id) => gridStatus(tracks[id].grid, tracks[id].duur).status;
  ok(`klik: auto zeker (${st('nK')}), ruis: geen puls (${st('nR')}), slot: slot (${st('nS')}), hand: onzeker (${st('nH')})`,
    st('nK') === 'zeker' && st('nR') === 'geenpuls' && st('nS') === 'slot' && st('nH') === 'onzeker');

  console.log('\nopnieuw analyseren (de knop)');
  const her = (id, body = {}) => fetch(`${B}/api/library/${id}/grid/analyseer`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const rS = await (await her('nS')).json();
  ok(`over SLOT: voorstel terug, niet bewaard ("${rS.reden}")`, rS.bewaard === false && /slot/.test(rS.reden)
    && Math.abs(rS.voorstel.stukken[0].bpm - 100) < 0.1 && (await lijst()).nS.grid.slot === true);
  const rS2 = await (await her('nS', { forceer: true })).json();
  ok('met forceer (tweede klik): wel bewaard, niet meer op slot', rS2.bewaard === true && rS2.grid.bron === 'auto' && !rS2.grid.slot
    && Math.abs(rS2.grid.stukken[0].bpm - 100) < 0.1);
  const rH = await (await her('nH')).json();
  ok('over een met de hand bewerkt grid: bewaard (daar vroeg je om)', rH.bewaard === true && rH.grid.bron === 'auto');
  ok('onbekend nummer: 404', (await her('bestaatniet')).status === 404);
  ok('als formulier: 415', (await fetch(`${B}/api/library/nS/grid/analyseer`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415);

  console.log('\nonset-pieken');
  const on = await (await fetch(`${B}/api/library/nK/onsets`)).json();
  const P = 60 / 128;
  const af = on.tijden.map((t) => t - (0.2 + Math.round((t - 0.2) / P) * P)).sort((a, b) => a - b);
  ok(`${on.tijden.length} klappen (verwacht ~1024), mediaan ${(af[af.length >> 1] * 1000).toFixed(1)} ms van de klik`,
    on.tijden.length > 990 && on.tijden.length < 1060 && Math.abs(af[af.length >> 1]) < 0.02);
  ok('gesorteerd', on.tijden.every((t, i) => i === 0 || t > on.tijden[i - 1]));
  ok('onbekend nummer: 404', (await fetch(`${B}/api/library/bestaatniet/onsets`)).status === 404);
} finally {
  server.kill();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
