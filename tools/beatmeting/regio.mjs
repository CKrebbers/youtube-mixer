// Verfijn rond een plek en toon het fase-spoor (5 s vensters) in een gebied.
// Gebruik: node regio.mjs <id> <rond s> <startBpm> [van s] [tot s] [marge]
import { library, laadOnset, d, fmt, mmss } from './lib.mjs';
import { spoor, samenvatting } from './fasespoor.mjs';
const [id, rondA, bpmA, vanA, totA, margeA] = process.argv.slice(2);
const t = (await library()).find((x) => x.id === id);
const o = laadOnset(t);
const r = d.verfijnTempoFase(o.env, o.envRate, Number(bpmA), o.tijdOffset, { rond: Number(rondA), marge: Number(margeA || 0.03) });
console.log(`verfijnd: ${fmt(r.bpm, 3)} bpm, firstBeat ${fmt(r.firstBeat, 3)}, score ${fmt(r.score)}`);
const s = spoor(o, r.bpm, r.firstBeat, t.duur, { venster: 6, stap: 3 }).filter((x) => x.v >= Number(vanA || 0) && x.v <= Number(totA || 1e9));
console.log(JSON.stringify(samenvatting(s)));
console.log(s.map((x) => `${mmss(x.v)} ${fmt(x.fase * 60000 / r.bpm, 0)}ms R${fmt(x.R, 2)}`).join(' | '));
