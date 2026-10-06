// Een nep-tellenzoeker voor de tests (en headless): GEEN Python, GEEN Beat
// This!, wel precies het gedrag van server/tellen/tellen.py waar de server op
// leunt (docs/BEATGRID.md §11). Geen test zelf (heet niet *.test.mjs).
//
// Gebruik: zet VARVE_TELLEN_CMD op het shellscript dat maakNepTellen() schrijft.
// Dezelfde argumenten als tellen.py:
//   --in <audio.wav> --uit <tellen.json> [--apparaat …] [--model …]
//   --controle   staat alles klaar? (JSON op stdout)
//
// De tellen: een vast tempo NEP_TELLEN_BPM (standaard 120) vanaf 0,25 s tot
// het eind van audio.wav, de downbeats om de vier. Voortgang in 5 stappen.
//
// Sturen met omgevingsvariabelen:
//   NEP_TELLEN_LOG        bestand waar elke aanroep een JSON-regel in schrijft ({ in, start, eind, pid })
//   NEP_TELLEN_MS         wachttijd per voortgangsstap (standaard 20 ms)
//   NEP_TELLEN_ONTBREEKT  --controle faalt met deze reden
// En met het pad van --in: …kapot… faalt met een reden; …traag… duurt 25 × 100 ms.
//
// SIGINT (en SIGTERM) zoals tellen.py: geen half bestand, exit 130.
import { appendFileSync, writeFileSync, chmodSync, openSync, readSync, closeSync, fstatSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Schrijft het startscript in `map` en geeft het pad (voor VARVE_TELLEN_CMD). */
export function maakNepTellen(map) {
  const pad = join(map, 'nep-tellen');
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

/** De duur van een WAV (s): fmt en data zelf zoeken. */
function duurVan(pad) {
  const fd = openSync(pad, 'r');
  try {
    const { size } = fstatSync(fd);
    const buf = Buffer.alloc(Math.min(size, 65536));
    readSync(fd, buf, 0, buf.length, 0);
    let fmt = null;
    for (let p = 12; p + 8 <= buf.length;) {
      const naam = buf.toString('latin1', p, p + 4), n = buf.readUInt32LE(p + 4);
      if (naam === 'fmt ') fmt = { kanalen: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
      else if (naam === 'data' && fmt) return Math.min(n, size - p - 8) / (fmt.kanalen * fmt.bits / 8) / fmt.sr;
      p += 8 + n + (n & 1);
    }
    throw new Error('geen data-chunk');
  } finally { closeSync(fd); }
}

async function nep(args) {
  if (args.includes('--controle')) {
    if (process.env.NEP_TELLEN_ONTBREEKT) { console.error(`fout: ${process.env.NEP_TELLEN_ONTBREEKT}`); return 1; }
    console.log(JSON.stringify({ ok: true, python: 'nep', torch: 'nep', beat_this: 'nep', apparaat: 'nep', model: 'nep' }));
    return 0;
  }
  const invoer = arg(args, '--in'), uit = arg(args, '--uit');
  if (!invoer || !uit) { console.error('fout: --in en --uit zijn nodig'); return 2; }
  const start = Date.now();
  let gestopt = false;
  const stop = () => { gestopt = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const traag = /traag/.test(invoer);
  const stappen = traag ? 25 : 5, ms = traag ? 100 : Number(process.env.NEP_TELLEN_MS || 20);
  for (let i = 1; i <= stappen; i++) {
    await new Promise((z) => setTimeout(z, ms));
    if (gestopt) { rmSync(uit + '.tmp', { force: true }); console.error('gestopt'); return 130; }
    console.log(`voortgang ${(i / stappen * 0.97).toFixed(4)}`);
    if (/kapot/.test(invoer)) { console.error('fout: nep-tellen: kapot nummer'); return 1; }
  }
  const duur = duurVan(invoer);
  const L = 60 / Number(process.env.NEP_TELLEN_BPM || 120);
  const beats = [];
  for (let t = 0.25; t < duur; t += L) beats.push(Math.round(t * 1e5) / 1e5);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  writeFileSync(uit + '.tmp', JSON.stringify({ versie: 1, beats, downbeats, fps: 50, verfijnd: 'nep', model: 'nep', apparaat: 'nep', sec: 0, duur }));
  renameSync(uit + '.tmp', uit);
  if (process.env.NEP_TELLEN_LOG) appendFileSync(process.env.NEP_TELLEN_LOG, JSON.stringify({ in: invoer, start, eind: Date.now(), pid: process.pid }) + '\n');
  console.log('voortgang 1.0000');
  console.log('klaar');
  return 0;
}
