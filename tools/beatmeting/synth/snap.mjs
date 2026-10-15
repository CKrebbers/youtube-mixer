// "Tel 1 hier", "tellen hier" en vast: snappen naar de klap (snapNaarOnset, zoals
// tot 15 okt) tegen snappen naar de tel van Beat This! (snapNaarTel, BEATGRID.md §14),
// op de synthetische nummers (nummers.mjs: de echte tel is bekend).
//
// De klappen zijn ECHT: de wav door de server-analyse (ffmpeg -> maakOnset ->
// maakOnsets, met de ijking PIEK_GEIJKT van 68,5 ms), dus de scheefheid per klank
// meet je hier zoals hij is. De tellen zijn NEP (nep-beatthis.mjs: σ 6 ms om de
// echte tel, géén vaste afwijking per instrument): dat de tellen hier beter zijn,
// zit er voor een deel in gebouwd. Daarom ook de rijen "tellen +N ms": vanaf welke
// vaste scheefheid van het netwerk zijn de tellen niet meer beter dan de klappen?
// Het echte antwoord komt van Clay's Mac (tools/beatmeting/rest/tel1-echt.mjs, kolom T).
//
//   node tools/beatmeting/synth/snap.mjs [namen ...] [--varianten bt,ruis,half]
// Leest en schrijft alleen in de tijdelijke map van het systeem (varve-beatbench).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NUMMERS, NAMEN, wavVan } from './nummers.mjs';
import { nepTellen } from './nep-beatthis.mjs';
import { snapNaarOnset, snapNaarTel } from '../../../src/engine/beatgrid.js';
import * as analyze from '../../../server/analyze.js';

const args = process.argv.slice(2);
const optie = (naam) => { const i = args.indexOf(naam); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const varianten = (optie('--varianten') ?? 'bt,ruis,half').split(',').filter(Boolean);
const namen = (args.length ? args : NAMEN).filter((n) => n !== 'ambient');
const TMP = path.join(tmpdir(), 'varve-beatbench');
mkdirSync(TMP, { recursive: true });

const binnen = (t, gebieden) => gebieden.some(([a, b]) => t >= a && t < b);
const DRUK = [-0.025, -0.012, 0, 0.012, 0.025];   // zo ver naast de tel drukt de mens (s)
const SCHEEF = [0, 0.005, 0.010, 0.015];             // een vaste afwijking van het netwerk erbij (s)

/** De klappen zoals de server ze het deck geeft (GET .../onsets), onthouden per audio. */
async function klappenVan(naam, wav) {
  const sleutel = createHash('sha1').update(wav).update(readFileSync(new URL('../../../server/analyze.js', import.meta.url))).digest('hex').slice(0, 16);
  const cache = path.join(TMP, `klappen-${naam}-${sleutel}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const wavPad = path.join(TMP, `${naam}.wav`), onsetPad = path.join(TMP, `${naam}.snap.onset.bin`);
  writeFileSync(wavPad, wav);
  const o = await analyze.maakOnset(wavPad, onsetPad);
  if (!o.ok) throw new Error(o.fout);
  const r = await analyze.maakOnsets(onsetPad, o.envRate, o.tijdOffset);
  if (!r.ok) throw new Error(r.fout);
  writeFileSync(cache, JSON.stringify(r.tijden));
  return r.tijden;
}

const stat = (a) => {
  if (!a.length) return '(geen)';
  const abs = a.map(Math.abs).sort((p, q) => p - q);
  const q = (f) => abs[Math.min(abs.length - 1, Math.floor(f * abs.length))];
  return `gem ${(a.reduce((p, x) => p + x, 0) / a.length).toFixed(1).padStart(5)}  |p50| ${q(0.5).toFixed(1).padStart(5)}  |p90| ${q(0.9).toFixed(1).padStart(5)}  > 10 ms ${(100 * abs.filter((v) => v > 10).length / abs.length).toFixed(0).padStart(3)}%`;
};

const totaal = { klap: [], klapGevonden: [] };
for (const v of varianten) for (const s of SCHEEF) totaal[`${v}+${s * 1000}`] = [];
const bron = {};   // per variant: hoe vaak de tel, de klap of niets
console.log('fout t.o.v. de echte tel (ms; + = te laat), per nummer: klap · tellen (bt, zonder scheefheid)\n');
for (const naam of namen) {
  const n = NUMMERS[naam]();
  const klappen = Float64Array.from(await klappenVan(naam, wavVan(n.x)));
  const tellen = Object.fromEntries(varianten.map((v) => { const t = nepTellen(n, v); return [v, { beats: Float64Array.from(t.beats) }]; }));
  const eigen = { klap: [], tel: [] };
  n.tellen.forEach((tel, i) => {
    // Elke derde tel: zo valt de keuze om en om op een even en een oneven tel (bij 'half' heeft één van de twee geen tel).
    if (i % 3 || !binnen(tel, n.meet)) return;
    for (const druk of DRUK) {
      const k = snapNaarOnset(klappen, tel + druk);
      const e = (k - tel) * 1000;
      eigen.klap.push(e); totaal.klap.push(e);
      if (k !== tel + druk) totaal.klapGevonden.push(e);
      for (const v of varianten) for (const s of SCHEEF) {
        const B = s ? { beats: tellen[v].beats.map((b) => b + s) } : tellen[v];
        const t = snapNaarTel(B, klappen, tel + druk);
        const f = (t - tel) * 1000;
        totaal[`${v}+${s * 1000}`].push(f);
        if (!s) {
          const soort = tellen[v].beats.includes(t) ? 'tel' : klappen.includes(t) ? 'klap' : 'niets';
          ((bron[v] ??= { tel: 0, klap: 0, niets: 0 })[soort])++;
          if (v === varianten[0]) eigen.tel.push(f);
        }
      }
    }
  });
  console.log(`${naam.padEnd(16)} klap  ${stat(eigen.klap)}\n${''.padEnd(16)} tel   ${stat(eigen.tel)}`);
}
console.log(`\nalle nummers samen (${totaal.klap.length} keer drukken, ±25 ms naast de tel):`);
console.log(`  klap (zoals tot 15 okt)        ${stat(totaal.klap)}`);
console.log(`  … alleen waar er een klap binnen 30 ms lag (${totaal.klapGevonden.length}×): ${stat(totaal.klapGevonden)}`);
for (const v of varianten) for (const s of SCHEEF) console.log(`  tellen ${v.padEnd(5)} ${s ? `+${s * 1000} ms scheef` : 'zonder scheefheid'}`.padEnd(33) + stat(totaal[`${v}+${s * 1000}`]));
for (const v of varianten) console.log(`  ${v}: gesnapt naar een tel ${bron[v].tel}, naar een klap ${bron[v].klap}, niet ${bron[v].niets}`);
