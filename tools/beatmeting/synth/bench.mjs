// De benchmark van het automatische beatgrid (docs/BEATGRID.md §12). Per
// synthetisch nummer (nummers.mjs, de tellen en "1"-en exact bekend):
//   oud     de oude analyse zoals de server hem draait: ffmpeg -> onset-envelope
//           (maakOnset) -> analyseerGrid + fijne fase (maakGrid), in de worker;
//   tellen  Beat This! zoals het zijn tellen geeft (nep-beatthis.mjs, per variant)
//           -> gridUitTellen -> vergelijk met de oude als tweede mening, zoals
//           pasTellenToe in server/index.js.
// Leest en schrijft alleen in de tijdelijke map van het systeem (varve-beatbench).
//
//   node tools/beatmeting/synth/bench.mjs [namen ...] [--varianten bt,ruis,...] [--json uit.json]
//        [--code <map>]   de code uit een andere checkout (src/engine/tellen.js, beatgrid.js,
//                         server/analyze.js + detect.js): vóór/na op dezelfde nummers
//        [--echt <map>]   tellen.json per nummer (<map>/<naam>.json) van het ECHTE Beat This!
//                         als variant 'echt' (zie --wav: de audio om het op te draaien)
//        [--wav <map>]    alleen de wav's wegschrijven (voor het echte model) en stoppen
//        [--geen-oud]     de oude analyse overslaan (de tellen dan zonder tweede mening)
//   node tools/beatmeting/synth/bench.mjs --vergelijk voor.json na.json
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NUMMERS, NAMEN, wavVan, SR } from './nummers.mjs';
import { nepTellen, VARIANTEN } from './nep-beatthis.mjs';
import { scoor } from './scoor.mjs';

const ROOT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..', '..', '..');
const args = process.argv.slice(2);
const optie = (naam) => { const i = args.indexOf(naam); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const vlag = (naam) => { const i = args.indexOf(naam); if (i < 0) return false; args.splice(i, 1); return true; };

const pct = (x) => (x == null ? '   –' : `${Math.round(x * 100)}%`.padStart(4));
const getal = (x, n = 1) => (x == null ? '–' : x.toFixed(n));

// ---- vergelijken van twee uitkomsten ---------------------------------------------
if (args[0] === '--vergelijk') {
  const [a, b] = [args[1], args[2]].map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const sleutels = [...new Set([...Object.keys(a.uitkomst), ...Object.keys(b.uitkomst)])];
  console.log(`vóór: ${a.code}\nna:   ${b.code}\n`);
  console.log('geval'.padEnd(30), 'dekking'.padStart(13), 'tempo'.padStart(11), 'dj'.padStart(11), 'fase ms'.padStart(13), 'naast'.padStart(11), '"1"'.padStart(11), 'vals'.padStart(13));
  for (const k of sleutels) {
    const x = a.uitkomst[k], y = b.uitkomst[k];
    if (!x || !y) continue;
    const paar = (f, fmt = pct) => `${fmt(x[f])}→${fmt(y[f])}`.padStart(11);
    const vals = `${x.valsZeker ? 'VALS' : pct(x.vals)}→${y.valsZeker ? 'VALS' : pct(y.vals)}`.padStart(13);
    const mark = JSON.stringify([x.dekking, x.tempo, x.dj, x.naast, x.een, x.valsZeker]) === JSON.stringify([y.dekking, y.tempo, y.dj, y.naast, y.een, y.valsZeker]) ? ' ' : '*';
    console.log(`${mark} ${k.padEnd(28)}`, paar('dekking').padStart(13), paar('tempo'), paar('dj'), `${getal(x.faseMs)}→${getal(y.faseMs)}`.padStart(13), paar('naast'), paar('een'), vals);
  }
  for (const [naam, u] of [['vóór', a], ['na', b]]) console.log(`\n${naam}: ${samenvatting(u.uitkomst)}`);
  process.exit(0);
}

const code = path.resolve(optie('--code') ?? ROOT);
const jsonUit = optie('--json');
const echtMap = optie('--echt');
const wavMap = optie('--wav');
const geenOud = vlag('--geen-oud');
const varianten = (optie('--varianten') ?? VARIANTEN.join(',')).split(',').filter(Boolean);
if (echtMap) varianten.push('echt');
const namen = args.length ? args : NAMEN;
for (const n of namen) if (!NUMMERS[n]) { console.error(`onbekend nummer: ${n} (bekend: ${NAMEN.join(', ')})`); process.exit(2); }

const TMP = path.join(tmpdir(), 'varve-beatbench');
mkdirSync(TMP, { recursive: true });

if (wavMap) {
  mkdirSync(wavMap, { recursive: true });
  for (const naam of namen) writeFileSync(path.join(wavMap, `${naam}.wav`), wavVan(NUMMERS[naam]().x));
  console.log(`${namen.length} wav's in ${wavMap} (${SR} Hz mono)`);
  process.exit(0);
}

const tellenMod = await import(path.join(code, 'src/engine/tellen.js'));
const { Beatgrid } = await import(path.join(code, 'src/engine/beatgrid.js'));
const analyze = await import(path.join(code, 'server/analyze.js'));
const hashVan = (...xs) => { const h = createHash('sha1'); for (const x of xs) h.update(x); return h.digest('hex').slice(0, 16); };
// tellen.js hoort erbij: maakGrid haalt daar het DJ-tempo (dansOctaven) vandaan (review ronde 1).
const oudeCode = hashVan(...['server/detect.js', 'server/analyze.js', 'src/engine/tellen.js'].map((f) => readFileSync(path.join(code, f))));

/** De oude analyse op de wav, zoals de server: onset, dan het grid. Onthouden per (code, audio). */
async function oudeAnalyse(naam, wav) {
  const sleutel = hashVan(oudeCode, wav);
  const cache = path.join(TMP, `oud-${naam}-${sleutel}.json`);
  if (existsSync(cache)) return { ...JSON.parse(readFileSync(cache, 'utf8')), uitCache: true };
  const wavPad = path.join(TMP, `${naam}.wav`), onsetPad = path.join(TMP, `${naam}.onset.bin`);
  writeFileSync(wavPad, wav);
  const t0 = performance.now();
  const o = await analyze.maakOnset(wavPad, onsetPad);
  if (!o.ok) return { ok: false, fout: o.fout };
  const r = await analyze.maakGrid(onsetPad, o.envRate, o.tijdOffset, wavPad);
  const uit = { ...r, sec: (performance.now() - t0) / 1000 };
  writeFileSync(cache, JSON.stringify(uit));
  return uit;
}

/** Het grid uit (nep-)tellen, zoals pasTellenToe: gridUitTellen, dan vergelijk met de oude. */
function tellenGrid(t, duur, oud) {
  const t0 = performance.now();
  const kaart = tellenMod.gridUitTellen(t.beats, t.downbeats, { duur });
  if (oud) tellenMod.vergelijk(kaart, t.beats, new Beatgrid(oud));
  return { kaart, ms: performance.now() - t0 };
}

const uitkomst = {};
const regels = [];
const kop = `${'geval'.padEnd(26)} ${'stukken'.padStart(7)} ${'dekking'.padStart(7)} ${'tempo'.padStart(5)} ${'oct'.padStart(4)} ${'dj'.padStart(4)} ${'fase'.padStart(6)} ${'naast'.padStart(5)} ${'"1"'.padStart(4)} ${'vals'.padStart(5)} ${'z-oct'.padStart(5)} grens`;
const regel = (k, s) => `${k.padEnd(26)} ${String(s.stukken).padStart(7)} ${pct(s.dekking).padStart(7)} ${pct(s.tempo).padStart(5)} ${pct(s.octaaf)} ${pct(s.dj)} ${getal(s.faseMs).padStart(6)} ${pct(s.naast).padStart(5)} ${pct(s.een)} ${(s.valsZeker ? 'VALS' : pct(s.vals)).padStart(5)} ${pct(s.zekerOctaaf).padStart(5)} ${s.grens != null ? `${s.grens.toFixed(1)} s` : ''}`;

console.log(`code: ${code}\n`);
console.log(kop);
for (const naam of namen) {
  const n = NUMMERS[naam]();
  const wav = wavVan(n.x);
  let oud = null;
  if (!geenOud) {
    const r = await oudeAnalyse(naam, wav);
    if (r.ok) {
      oud = r.grid;
      const s = scoor(oud, n);
      uitkomst[`${naam}/oud`] = s;
      const bpm = [...new Set(oud.stukken.map((x) => x.bpm.toFixed(1)))].slice(0, 4).join(' ');
      console.log(regel(`${naam}/oud`, s), ` [${bpm}]${r.uitCache ? '' : ` ${r.sec.toFixed(1)} s`}`);
    } else console.log(`${naam}/oud: ${r.fout}`);
  }
  for (const v of varianten) {
    let t;
    if (v === 'echt') {
      const p = path.join(echtMap, `${naam}.json`);
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, 'utf8'));
      t = { beats: j.beats, downbeats: j.downbeats ?? [] };
    } else t = nepTellen(n, v);
    const { kaart } = tellenGrid(t, n.duur, oud);
    const s = scoor(kaart, n);
    uitkomst[`${naam}/${v}`] = s;
    const bpm = [...new Set(kaart.stukken.filter((x) => x.zekerheid >= 0.15).map((x) => x.bpm.toFixed(1)))].slice(0, 4).join(' ');
    const tw = [...new Set(kaart.stukken.map((x) => x.twijfel).filter(Boolean))].join(',');
    console.log(regel(`${naam}/${v}`, s), ` [${bpm}]${tw ? ` ${tw}` : ''}`);
  }
}

function samenvatting(u) {
  const groep = (f) => Object.entries(u).filter(([k]) => f(k)).map(([, s]) => s);
  const gem = (xs, k) => { const v = xs.map((s) => s[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const deel = (xs) => `${xs.filter((s) => s.valsZeker).length} vals zeker van ${xs.length}, dekking ${pct(gem(xs, 'dekking'))}, tempo ${pct(gem(xs, 'tempo'))}, dj ${pct(gem(xs, 'dj'))}, "1" ${pct(gem(xs, 'een'))}, naast ${pct(gem(xs, 'naast'))}`;
  return `oud: ${deel(groep((k) => k.endsWith('/oud')))}\n      tellen: ${deel(groep((k) => !k.endsWith('/oud')))}`;
}
console.log(`\n${samenvatting(uitkomst)}`);
console.log('\ndekking = deel van de duidelijke tellen waar het grid zeker is; tempo = het echte octaaf; oct = ½ of 2;'
  + '\ndj = het DJ-tempo; fase = mediaan ms naast; naast = > 0,1 tel naast; "1" = de echte "1" op een "1";'
  + '\nvals = deel van de zekere tijd waar het grid naast ligt (VALS = > 2% en ≥ 2 s); z-oct = zeker op een ander octaaf.');
if (jsonUit) writeFileSync(jsonUit, JSON.stringify({ code, wanneer: new Date().toISOString(), uitkomst }, null, 1));
regels.length = 0;
