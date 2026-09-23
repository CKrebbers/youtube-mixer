// Tijdskosten: onset-analyse in de worker (zoals de ingest), per minuut audio.
// Schrijft alleen naar deze map; vergelijkt met media/<id>/onset.bin.
import { readFileSync } from 'node:fs';
import { library, ROOT } from './lib.mjs';
const { maakOnset, verfijnUitBestand } = await import(ROOT + '/server/analyze.js');
const ids = process.argv.slice(2);
for (const t of await library()) {
  if (ids.length && !ids.includes(t.id)) continue;
  const doel = `./onset-${t.id}.bin`;
  const t0 = performance.now();
  const r = await maakOnset(ROOT + '/' + t.audio, doel);
  const s = (performance.now() - t0) / 1000;
  const a = readFileSync(doel), b = readFileSync(ROOT + '/' + t.onset.bestand);
  console.log(`${t.id} ${(t.duur / 60).toFixed(1)} min: onset ${s.toFixed(1)} s = ${(s / (t.duur / 60)).toFixed(2)} s/min; gelijk aan onset.bin: ${a.equals(b)}`);
  const t1 = performance.now();
  const v = await verfijnUitBestand(ROOT + '/' + t.onset.bestand, t.onset.envRate, 120, t.onset.tijdOffset, { rond: t.duur / 2 });
  const v2t = performance.now();
  const v2 = await verfijnUitBestand(ROOT + '/' + t.onset.bestand, t.onset.envRate, 60, t.onset.tijdOffset, { rond: t.duur / 2 });
  console.log(`   verfijn in worker: ${(v2t - t1).toFixed(0)} ms bij 120 bpm, ${(performance.now() - v2t).toFixed(0)} ms bij 60 bpm`);
}
