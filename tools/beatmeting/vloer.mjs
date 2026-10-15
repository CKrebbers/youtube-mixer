#!/usr/bin/env node
/**
 * VRAGEN AR4 (16 okt): komt "vier op de vloer" bij Clay voor, en waar? De tweede mening over de "1"
 * (maatMening, BEATGRID.md §14) kijkt naar wat er in de lage band BIJKOMT op elke tel van de maat. Bij
 * house en techno heeft elke tel een kick: dan is elke tel even sterk en zegt de lage band niets over welke
 * tel de "1" is. Een "1" die daar een tel naast staat, krijgt dus geen "?". Dit script telt per stuk wat de
 * lage band zegt (met dezelfde maatSterkte en drempels als de server) en zet daar de downbeats van Beat This!
 * naast: een stuk met vier op de vloer waar de downbeats niet op de "1" vallen, is precies het geval dat
 * niemand ziet. Pas als dat voorkomt, is een andere bron de moeite (de bas-toon, of de crash op de "1").
 *
 *   node tools/beatmeting/vloer.mjs [--media <map>] [--db <pad>] [--json]
 *
 * ALLEEN LEZEN: library.db wordt eerst gekopieerd naar een tijdelijke map (op APFS een clone) en daar
 * geopend; uit media/<id>/ alleen laag.json, laag.bin en tellen.json. Schrijft nergens iets; het rapport
 * gaat naar stdout. Nummers zonder lage band (laag.bin komt met de eerste meting na kaart-VERSIE 3) of
 * zonder tellen tellen niet mee.
 * Exit: 0 gemeten, niets verdachts · 2 gemeten, verdachte stukken · 1 niets te lezen.
 */
import { copyFileSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Beatgrid } from '../../src/engine/beatgrid.js';
import { maatSterkte, meetGrid, MAAT_LAAG, MAAT_LAAG_VLOER } from '../../src/engine/tellen.js';
import { MEDIA } from './rest/lib.mjs';

/** Vanaf zo'n deel van de downbeats op een "1" noemen we de "1" goed (zoals ar-na: EEN_GOED). */
export const EEN_GOED = 0.9;

/**
 * Wat de lage band over één stuk zegt, uit maatSterkte (`m`, of null):
 * - 'te kort': te weinig maten om iets te zeggen;
 * - 'stil': geen kick of bas die op een tel bijkomt (piano, a capella): de lage band zwijgt;
 * - 'twijfel': een andere tel is duidelijk sterker dan de "1" (dat geeft de server twijfel 'maat');
 * - 'vloer': elke tel komt even sterk (de zwakste ≥ MAAT_LAAG × de sterkste): vier op de vloer, geen mening;
 * - 'mening': de "1" (of een tel die niet veel sterker is) steekt eruit: de lage band steunt de "1".
 */
export function vloerOordeel(m) {
  if (!m) return 'te kort';
  if (!(m.max > MAAT_LAAG_VLOER * m.tussen)) return 'stil';
  if (m.een < MAAT_LAAG * m.max) return 'twijfel';
  if (Math.min(...m.per) >= MAAT_LAAG * m.max) return 'vloer';
  return 'mening';
}

/**
 * Per stuk van één nummer: { van, bpm, oordeel, een (deel van de downbeats op een "1", of null), verdacht }.
 * `verdacht` = vier op de vloer EN de downbeats vallen niet op de "1" (< EEN_GOED): de "1" kan naast staan
 * zonder dat iemand een "?" ziet.
 */
export function meetNummer(gridJson, tellen, laag) {
  const g = new Beatgrid(gridJson);
  const per = gridJson.beatsPerBar || 4;
  const m = tellen?.beats?.length ? meetGrid(g, tellen.beats, tellen.downbeats ?? null) : null;
  return gridJson.stukken.map((st, i) => {
    const sterkte = Number.isFinite(st.maat) && st.bpm > 0 ? maatSterkte(st, gridJson.stukken[i + 1]?.van ?? Infinity, per, laag) : null;
    const oordeel = vloerOordeel(sterkte);
    const een = m?.stukken?.[i]?.een ?? null;
    return { van: st.van, bpm: st.bpm, oordeel, een, verdacht: oordeel === 'vloer' && een !== null && een < EEN_GOED };
  });
}

function leesLaag(map) {
  try {
    const meta = JSON.parse(readFileSync(join(map, 'laag.json'), 'utf8'));
    const b = readFileSync(join(map, 'laag.bin'));
    if (b.byteLength !== meta.frames * 4) return null;
    return { env: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), envRate: meta.envRate, tijdOffset: meta.tijdOffset ?? 0 };
  } catch { return null; }
}

async function main(argv) {
  const optie = (naam) => { const i = argv.indexOf(naam); return i >= 0 ? argv[i + 1] : null; };
  const media = optie('--media') || MEDIA;
  const dbPad = optie('--db') || process.env.VARVE_DB || join(media, 'library.db');
  if (!existsSync(dbPad)) { console.error(`geen library.db op ${dbPad} (zet --db of --media)`); return 1; }
  const tmp = mkdtempSync(join(tmpdir(), 'varve-vloer-'));
  try {
    for (const ext of ['', '-wal', '-shm']) if (existsSync(dbPad + ext)) copyFileSync(dbPad + ext, join(tmp, 'lib.db' + ext), constants.COPYFILE_FICLONE);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(tmp, 'lib.db'));
    const rijen = db.prepare('SELECT id, titel, grid_json FROM tracks WHERE grid_json IS NOT NULL').all();
    db.close();
    const uit = { nummers: 0, zonder: 0, stukken: {}, verdacht: [] };
    for (const r of rijen) {
      const map = join(media, r.id);
      const laag = leesLaag(map);
      let tellen = null;
      try { tellen = JSON.parse(readFileSync(join(map, 'tellen.json'), 'utf8')); } catch {}
      let grid = null;
      try { grid = JSON.parse(r.grid_json); } catch {}
      if (!laag || !tellen || !grid?.stukken?.length) { uit.zonder++; continue; }
      uit.nummers++;
      for (const s of meetNummer(grid, tellen, laag)) {
        uit.stukken[s.oordeel] = (uit.stukken[s.oordeel] ?? 0) + 1;
        if (s.verdacht) uit.verdacht.push({ id: r.id, titel: r.titel, van: s.van, bpm: s.bpm, een: s.een });
      }
    }
    if (argv.includes('--json')) console.log(JSON.stringify(uit, null, 2));
    else {
      console.log(`vier op de vloer (AR4) · ${uit.nummers} nummers gemeten, ${uit.zonder} zonder lage band of tellen`);
      for (const [k, n] of Object.entries(uit.stukken)) console.log(`  ${k.padEnd(8)} ${n} stuk(ken)`);
      if (uit.verdacht.length) {
        console.log(`\nVERDACHT (vier op de vloer, en de downbeats vallen niet op de "1"): ${uit.verdacht.length}`);
        for (const v of uit.verdacht) console.log(`  ${v.titel ?? v.id} · vanaf ${v.van.toFixed(1)} s · ${v.bpm.toFixed(1)} bpm · ${Math.round(v.een * 100)}% van de downbeats op een "1"`);
      } else console.log('\nniets verdachts: waar de lage band zwijgt, vallen de downbeats op de "1"');
    }
    return uit.nummers === 0 ? 1 : uit.verdacht.length ? 2 : 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));
