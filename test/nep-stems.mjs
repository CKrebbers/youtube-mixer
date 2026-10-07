// Een nep-splitter voor de tests (en headless): GEEN Python, GEEN Demucs, wel
// precies het gedrag van server/stems/splits.py waar de server en de app op
// leunen (docs/STEMS.md §2). Geen test zelf (heet niet *.test.mjs).
//
// Gebruik: zet VARVE_STEMS_CMD op het shellscript dat maakNepStems() hieronder
// schrijft. Dezelfde argumenten als splits.py:
//   --in <audio.wav> --uit <map> --aantal 2|4 [--apparaat …] [--model …]
//   --controle   staat alles klaar? (JSON op stdout)
//
// Stem k = audio.wav × gewicht[k], zodat de SOM precies het origineel is en je
// aan het NIVEAU hoort welke uitgang welke stem is:
//   twee: vocals 0,75 · inst 0,25
//   vier: drums 0,1 · bass 0,2 · other 0,3 · vocals 0,4
// De laatste stem is het origineel min de andere (in hele samples), dus de som
// is bit voor bit audio.wav; de laatste wijkt hooguit 1,5 LSB van zijn gewicht
// af. schaal 1, model "nep", apparaat "nep". Voortgangsregels zoals de echte.
//
// Sturen met omgevingsvariabelen:
//   NEP_STEMS_LOG        bestand waar elke aanroep een JSON-regel in schrijft (met pid en nice)
//   NEP_STEMS_MS         wachttijd per voortgangsstap (standaard 20 ms, 5 stappen)
//   NEP_STEMS_TRAAG_MS   idem voor een traag nummer (standaard 200 ms, 25 stappen)
//   NEP_STEMS_ONTBREEKT  --controle faalt met deze reden (zoals een venv zonder demucs)
// En met het pad van --in (de track-id staat erin: media/<id>/audio.wav):
//   …traag…   duurt 25 stappen × NEP_STEMS_TRAAG_MS (tijd om te annuleren)
//   …kapot…   faalt na de eerste stap met een reden op stderr, exit 1
//   …doof…    negeert SIGINT (zoals Python die in C-code vastzit): de server moet SIGKILL geven
//   …scheef…  schrijft één frame te weinig (de server moet dat weigeren)
// En met een bestand `nep-traag` naast audio.wav (bij de START gelezen): duurt
// 1000 × 50 ms, en zo'n split loopt dus zeker nog als de test iets anders doet.
// Een id kan een test niet kiezen na een ingest; zo'n bestand wel.
//
// SIGINT (en SIGTERM) zoals splits.py: halve bestanden weg, exit 130.
import { appendFileSync, writeFileSync, chmodSync, openSync, readSync, writeSync, closeSync, fstatSync, renameSync, rmSync, existsSync } from 'node:fs';
import { getPriority } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GEWICHTEN = { 2: { vocals: 0.75, inst: 0.25 }, 4: { drums: 0.1, bass: 0.2, other: 0.3, vocals: 0.4 } };
export const NAMEN = { 2: ['vocals', 'inst'], 4: ['drums', 'bass', 'other', 'vocals'] };

/** Schrijft het startscript in `map` en geeft het pad (voor VARVE_STEMS_CMD). */
export function maakNepStems(map) {
  const pad = join(map, 'nep-stems');
  writeFileSync(pad, `#!/bin/sh\nexec "${process.execPath}" "${fileURLToPath(import.meta.url)}" "$@"\n`);
  chmodSync(pad, 0o755);
  return pad;
}

const alsScript = process.argv[1] === fileURLToPath(import.meta.url);
if (alsScript) process.exitCode = await nep(process.argv.slice(2));

function arg(args, naam) {
  const i = args.indexOf(naam);
  return i >= 0 ? args[i + 1] : undefined;
}

/** De kop van een 16-bit WAV: zoekt fmt en data zelf. */
function leesKop(fd) {
  const { size } = fstatSync(fd);
  const buf = Buffer.alloc(Math.min(size, 65536));
  readSync(fd, buf, 0, buf.length, 0);
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('geen WAV-bestand');
  let fmt = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const naam = buf.toString('latin1', p, p + 4), n = buf.readUInt32LE(p + 4);
    if (naam === 'fmt ') fmt = { kanalen: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    else if (naam === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('alleen 16-bit PCM');
      const bytes = Math.min(n, size - p - 8);
      return { ...fmt, data: p + 8, frames: Math.floor(bytes / (2 * fmt.kanalen)) };
    }
    p += 8 + n + (n & 1);
  }
  throw new Error('WAV zonder data-chunk');
}

function wavKop(frames, kanalen, sr) {
  const k = Buffer.alloc(44);
  const data = frames * kanalen * 2;
  k.write('RIFF', 0); k.writeUInt32LE(36 + data, 4); k.write('WAVE', 8);
  k.write('fmt ', 12); k.writeUInt32LE(16, 16); k.writeUInt16LE(1, 20); k.writeUInt16LE(kanalen, 22);
  k.writeUInt32LE(sr, 24); k.writeUInt32LE(sr * kanalen * 2, 28); k.writeUInt16LE(kanalen * 2, 32); k.writeUInt16LE(16, 34);
  k.write('data', 36); k.writeUInt32LE(data, 40);
  return k;
}

async function nep(args) {
  const log = (wat, extra = {}) => {
    if (process.env.NEP_STEMS_LOG) {
      let nice = null;
      try { nice = getPriority(); } catch {}
      appendFileSync(process.env.NEP_STEMS_LOG, JSON.stringify({ wat, pid: process.pid, nice, t: Date.now(), ...extra }) + '\n');
    }
  };

  if (args.includes('--controle')) {
    log('controle');
    if (process.env.NEP_STEMS_ONTBREEKT) { console.error(`fout: ${process.env.NEP_STEMS_ONTBREEKT}`); return 1; }
    console.log(JSON.stringify({ ok: true, apparaat: 'nep', python: null, demucs: 'nep', torch: 'nep' }));
    return 0;
  }

  const invoer = arg(args, '--in'), uit = arg(args, '--uit'), aantal = Number(arg(args, '--aantal'));
  if (!invoer || !uit || (aantal !== 2 && aantal !== 4)) { console.error('fout: --in, --uit en --aantal 2|4 zijn nodig'); return 2; }
  const tmp = join(uit, '.stems-tmp.wav');
  const tmpJson = join(uit, '.stems-tmp.json');
  const opruimen = () => { for (const p of [tmp, tmpJson]) { try { rmSync(p, { force: true }); } catch {} } };
  const stop = () => {
    if (invoer.includes('doof')) { log('doof', { in: invoer }); return; }
    opruimen();
    log('gestopt', { in: invoer });
    console.error('gestopt');
    process.exit(130);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  log('start', { in: invoer, uit, aantal, args });

  const t0 = Date.now();
  const lang = existsSync(join(dirname(invoer), 'nep-traag'));
  const traag = invoer.includes('traag');
  const stappen = lang ? 1000 : traag ? 25 : 5;
  const ms = lang ? 50 : traag ? Number(process.env.NEP_STEMS_TRAAG_MS) || 200 : Number(process.env.NEP_STEMS_MS) || 20;
  for (let k = 1; k <= stappen; k++) {
    await new Promise((z) => setTimeout(z, ms));
    console.log(`voortgang ${((0.97 * k) / stappen).toFixed(4)}`);
    if (invoer.includes('kapot')) { console.error('info: dit is geen fout, maar een meetwaarde'); console.error('fout: nep: deze split gaat expres mis'); return 1; }
  }

  let fd, uitFd;
  try {
    fd = openSync(invoer, 'r');
    const kop = leesKop(fd);
    if (kop.kanalen !== 2) throw new Error(`verwacht stereo, kreeg ${kop.kanalen} kanalen`);
    const frames = invoer.includes('scheef') ? kop.frames - 1 : kop.frames;
    const gewichten = NAMEN[aantal].map((n) => GEWICHTEN[aantal][n]);
    const kanalen = 2 * aantal;
    uitFd = openSync(tmp, 'w');
    writeSync(uitFd, wavKop(frames, kanalen, kop.sr));
    const BLOK = 65536;
    const inBuf = Buffer.alloc(BLOK * 4);
    const uitBuf = Buffer.alloc(BLOK * kanalen * 2);
    for (let f = 0; f < frames; f += BLOK) {
      const n = Math.min(BLOK, frames - f);
      readSync(fd, inBuf, 0, n * 4, kop.data + f * 4);
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 2; c++) {
          const s = inBuf.readInt16LE((i * 2 + c) * 2);
          let rest = s;
          for (let k = 0; k < aantal; k++) {
            const v = k === aantal - 1 ? rest : Math.round(s * gewichten[k]);
            rest -= v;
            uitBuf.writeInt16LE(v, (i * kanalen + 2 * k + c) * 2);
          }
        }
      }
      writeSync(uitFd, uitBuf, 0, n * kanalen * 2);
    }
    closeSync(uitFd);
    uitFd = undefined;
    writeFileSync(tmpJson, JSON.stringify({
      versie: 1, model: 'nep', aantal, namen: NAMEN[aantal], schaal: 1, frames, sr: kop.sr, apparaat: 'nep',
      rekentijd_s: Math.round((Date.now() - t0) / 100) / 10, gemaakt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    }, null, 1));
    renameSync(tmp, join(uit, 'stems.wav'));
    renameSync(tmpJson, join(uit, 'stems.json'));
  } catch (err) {
    opruimen();
    console.error(`fout: nep: ${err.message}`);
    return 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (uitFd !== undefined) closeSync(uitFd);
  }
  console.log('voortgang 1.0000');
  console.log('klaar');
  log('klaar', { in: invoer, aantal });
  return 0;
}
