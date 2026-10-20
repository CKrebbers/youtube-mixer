/**
 * Stems in echte Chrome (headless), met de echte server, library, afspeelmotor en mixer:
 *
 * Een v1-library met één nummer met VIER stems (stems.wav, 8 kanalen): drums, bas, overig en zang
 * zijn elk een eigen toon (220, 330, 550, 880 Hz), zodat aan de master te meten is welke stem klinkt
 * (Goertzel op de analyser van de master, na de limiter). audio.wav is de som.
 *
 *   1. laden via de library-lijst: de track speelt stems.wav (8 kanalen), de sectie STEMS staat er;
 *   2. alle vier klinken, op hetzelfde niveau (± 1 dB);
 *   3. drums weg (KILL): 220 Hz zakt ≥ 40 dB, de andere blijven (± 0,5 dB);
 *   4. bas op 0,5: 330 Hz −6 dB (± 0,5 dB);
 *   5. REST weg: alleen de zang (880 Hz) blijft;
 *   6. een nieuwe laad: alles weer open;
 *   7. geen fouten in de pagina.
 *
 *   node tools/proef-stems.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { opzet } from '../../meting/gemeen.mjs';

const SR = 48000, SEC = 20, F = SEC * SR;
const TONEN = { drums: 220, bass: 330, other: 550, vocals: 880 };
const NAMEN = ['drums', 'bass', 'other', 'vocals'];

function wav(kanalen, fn) {
  const b = Buffer.alloc(44 + F * 2 * kanalen);
  b.write('RIFF', 0); b.writeUInt32LE(36 + F * 2 * kanalen, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(kanalen, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2 * kanalen, 28); b.writeUInt16LE(2 * kanalen, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(F * 2 * kanalen, 40);
  for (let i = 0; i < F; i++) for (let c = 0; c < kanalen; c++) b.writeInt16LE(fn(i, c), 44 + 2 * (i * kanalen + c));
  return b;
}
const toon = (f, i) => Math.round(4000 * Math.sin(2 * Math.PI * f * i / SR));

const media = mkdtempSync(join(tmpdir(), 'varve-proef-stems-'));
mkdirSync(join(media, 'n1'));
writeFileSync(join(media, 'n1', 'stems.wav'), wav(8, (i, c) => toon(TONEN[NAMEN[c >> 1]], i)));
writeFileSync(join(media, 'n1', 'audio.wav'), wav(2, (i) => NAMEN.reduce((s, n) => s + toon(TONEN[n], i), 0)));
{
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(media, 'library.db'));
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, uploader TEXT, duur REAL, audio TEXT, video TEXT, grid_json TEXT, stems_json TEXT, toegevoegd INTEGER)');
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('yt:stems', 'Vier stems', 'proef', SEC, 'media/n1/audio.wav', null,
    JSON.stringify({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true }),
    JSON.stringify({ versie: 1, aantal: 4, namen: NAMEN, schaal: 1, bestand: 'media/n1/stems.wav' }), 1);
  db.close();
}

const o = await opzet({ poort: 8851, media });
const uit = {};
let ok = true;
const eis = (v, wat) => { if (!v) { ok = false; console.log('NIET:', wat); } };
try {
  const p = o.page;
  await p.evaluate((TONEN) => {
    // Goertzel-niveau (dB) per toon op de master, gemiddeld over een paar buffers.
    window.__meet = async () => {
      const an = window.varve.mixer.analyser, N = an.fftSize, b = new Float32Array(N), som = {};
      for (const n of Object.keys(TONEN)) som[n] = 0;
      for (let r = 0; r < 6; r++) {
        an.getFloatTimeDomainData(b);
        for (const [n, f] of Object.entries(TONEN)) {
          const w = 2 * Math.cos(2 * Math.PI * f / 48000);
          let s1 = 0, s2 = 0;
          for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); const s0 = b[i] * h + w * s1 - s2; s2 = s1; s1 = s0; }
          som[n] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - w * s1 * s2));
        }
        await new Promise((res) => setTimeout(res, 60));
      }
      const uitDb = {};
      for (const n of Object.keys(som)) uitDb[n] = +(20 * Math.log10(som[n] / 6 + 1e-12)).toFixed(2);
      return uitDb;
    };
  }, TONEN);
  // 1. Laden via de lijst (track 1) en spelen.
  await p.waitForSelector('.bieb-rij');
  uit.laad = await p.evaluate(async () => {
    const e = window.varve;
    const rij = [...document.querySelectorAll('.bieb-rij')].find((x) => x.textContent.includes('Vier stems'));
    rij.querySelector('.laad button:nth-child(1)').click();
    for (let i = 0; i < 100 && !e.track(1).geladen; i++) await new Promise((r) => setTimeout(r, 50));
    e.bus.doe('track.1.play', true);
    e.bus.doe('track.1.focus', true);
    document.querySelector('button[data-tab="track"]').click();
    await new Promise((r) => setTimeout(r, 1500));
    return { stems: e.track(1).stems, kanalen: e.track(1).speler.kanalen, sectie: !!document.querySelector('.tp-stems'), knoppen: document.querySelectorAll('.tp-stems .knop').length };
  });
  eis(uit.laad.kanalen === 8 && uit.laad.stems?.namen?.length === 4 && uit.laad.sectie && uit.laad.knoppen === 5, `laden: ${JSON.stringify(uit.laad)}`);
  // 2. Alle vier.
  const alle = await p.evaluate(() => window.__meet());
  uit.alle = alle;
  const vals = Object.values(alle);
  eis(Math.max(...vals) - Math.min(...vals) < 1 && Math.min(...vals) > -40, `alle vier klinken gelijk: ${JSON.stringify(alle)}`);
  // 3. Drums weg (de KILL-knop in de sectie).
  await p.click('.tp-stems .knop[data-waarde="track.1.stem.drums"] .kill');   // een echte muisklik (pointerdown)
  await p.waitForTimeout(400);
  const zonderDrums = await p.evaluate(() => window.__meet());
  uit.zonderDrums = zonderDrums;
  eis(alle.drums - zonderDrums.drums >= 40 && ['bass', 'other', 'vocals'].every((n) => Math.abs(zonderDrums[n] - alle[n]) < 0.5), `drums weg: ${JSON.stringify(zonderDrums)}`);
  // 4. Bas op 0,5.
  await p.evaluate(() => window.varve.bus.doe('track.1.stem.bass', 0.5));
  await p.waitForTimeout(400);
  const bas = await p.evaluate(() => window.__meet());
  uit.basHalf = +(bas.bass - alle.bass).toFixed(2);
  eis(Math.abs(uit.basHalf - 20 * Math.log10(0.5)) < 0.5, `bas op 0,5: ${uit.basHalf} dB`);
  // 5. REST weg: alleen de zang.
  await p.evaluate(() => window.varve.bus.doe('track.1.stem.inst.kill', true));
  await p.waitForTimeout(400);
  const zang = await p.evaluate(() => window.__meet());
  uit.alleenZang = zang;
  eis(['drums', 'bass', 'other'].every((n) => alle[n] - zang[n] >= 40) && Math.abs(zang.vocals - alle.vocals) < 0.5, `alleen zang: ${JSON.stringify(zang)}`);
  // 6. Opnieuw laden (op track 1): alles open.
  uit.opnieuw = await p.evaluate(async () => {
    const e = window.varve;
    e.bus.doe('track.1.play', true);                        // pauze, anders vraagt laden een tweede druk
    const rij = [...document.querySelectorAll('.bieb-rij')].find((x) => x.textContent.includes('Vier stems'));
    rij.querySelector('.laad button:nth-child(1)').click();
    await new Promise((r) => setTimeout(r, 1000));
    return { kill: { ...e.track(1).stemKill }, bas: e.bus.lees('track.1.stem.bass'), gewichten: e.track(1).stemGewichten() };
  });
  eis(Object.values(uit.opnieuw.kill).every((x) => !x) && uit.opnieuw.bas === 1 && uit.opnieuw.gewichten.every((g) => g === 1), `opnieuw laden: ${JSON.stringify(uit.opnieuw)}`);
  uit.fouten = o.fouten;
  eis(o.fouten.length === 0, `fouten in de pagina: ${o.fouten.join('; ')}`);
} finally {
  await o.sluit();
  rmSync(media, { recursive: true, force: true });
  rmSync(o.data, { recursive: true, force: true });
}
console.log(JSON.stringify(uit, null, 2));
console.log(ok ? 'GESLAAGD: stems laden, klinken, kill en niveau per stem aan de master, open na een nieuwe laad' : 'NIET GESLAAGD');
process.exitCode = ok ? 0 : 1;
