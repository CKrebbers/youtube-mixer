// Restpunt 2 op ECHTE muziek (fragmenten, alleen lezen): "tel 1 hier" met en zonder verfijning.
// Op echte muziek is de tel niet bekend. Derde mening: de aanzet op HOGE resolutie
// (energie van het eerste verschil in vensters van 3 ms, hop 1 ms; waar hij in ±40 ms
// rond de tel de helft van bodem..top haalt), mediaan over de tellen in ±12 s = waar
// de gemiddelde aanzet ligt, dus waar een grid hoort. Eerst geijkt op de ijkklanken
// van detect.js: scherpe aanzetten (5 ms) vallen 4-8 ms laat, trage (30 ms) 12-35 ms.
//   node tools/beatmeting/rest/tel1-echt.mjs id:van:duur:bpm ...
// A = snap (zoals nu), B = + /grid/verfijn zoals hij is, D = alleen als de voorflank gemeten is.
import { d, analyze, beatgrid, SR, ENV_RATE, envelopeFragment, audioFragment } from './lib.mjs';

const PIEK = await analyze.piekVertraging();
const H = 11 / SR, W = 16.5 / SR;                     // hop en half venster (s)
function hrEnergie(pcm) {
  const n = Math.floor((pcm.length - 33) / 11), e = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = 1; i < 33; i++) { const v = pcm[f * 11 + i] - pcm[f * 11 + i - 1]; s += v * v; } e[f] = s; }
  return e;
}
function aanzet(e, tel) {                              // tel in s vanaf het begin van pcm
  const f0 = Math.round((tel - 0.04 - W) / H), f1 = Math.round((tel + 0.04 - W) / H);
  if (f0 < 30 || f1 >= e.length) return null;
  let top = f0; for (let f = f0; f <= f1; f++) if (e[f] > e[top]) top = f;
  let bodem = Infinity; for (let f = f0 - 30; f < top; f++) bodem = Math.min(bodem, e[f]);
  if (!(e[top] > 4 * bodem)) return null;
  const helft = bodem + 0.5 * (e[top] - bodem);
  let f = top; while (f > f0 && e[f - 1] > helft) f--;
  return f * H + W;
}

// Ijking van de derde mening op klanken met bekende tellen.
const ijk = [];
for (const klank of ['tik', 'kick', 'ruis', 'hihat', 'akkoord']) for (const a of [5, 30]) {
  const x = d.ijkSpoor(SR, klank, a, 0.02, { duur: 20, bpm: 118, T0: 0.41, seed: 11 });
  const e = hrEnergie(x), afw = [];
  for (let k = 1; k < 36; k++) { const t = 0.41 + k * 60 / 118, v = aanzet(e, t); if (v !== null) afw.push((v - t) * 1000); }
  afw.sort((p, q) => p - q);
  ijk.push(`${klank}/${a}: ${afw[afw.length >> 1].toFixed(1)}`);
}
console.log(`derde mening op de ijkklanken (ms te laat, aanzet 5/30 ms): ${ijk.join('  ')}\n`);

for (const item of process.argv.slice(2)) {
  const [id, vanS, duurS, bpmS] = item.split(':');
  const van = Number(vanS), duur = Number(duurS), bpm0 = Number(bpmS);
  const { env, envRate, tijdOffset } = envelopeFragment(id, van - 45, duur + 90, { raster: false });
  const onsets = analyze.onsetPieken(env, envRate, PIEK + (tijdOffset - d.onsetVertraging(SR, 1024, 128)));
  const a0 = Math.max(0, van - 13), pcm = audioFragment(id, a0, duur + 26), hr = hrEnergie(pcm);
  const g = d.verfijnTempoFase(env, envRate, bpm0, tijdOffset, { marge: 0.02, rond: van + duur / 2, straal: duur / 2 });
  const p = 60 / g.bpm, uit = { A: [], B: [], D: [] };
  let bijB = 0, bijD = 0;
  for (let t = van + 3; t < van + duur - 3; t += 4 * p) {
    const tel = g.firstBeat + Math.round((t - g.firstBeat) / p) * p;
    for (const druk of [-0.02, 0, 0.02]) {
      const snap = beatgrid.snapNaarOnset(onsets, tel + druk);
      const afw = [];
      for (let k = -Math.floor(12 / p); k <= Math.floor(12 / p); k++) {
        const v = aanzet(hr, snap + k * p - a0);
        if (v !== null) afw.push(v + a0 - (snap + k * p));
      }
      if (afw.length < 8) continue;
      afw.sort((x, y) => x - y);
      const ref = snap + afw[afw.length >> 1];
      const r = d.verfijnTap(env, envRate, tijdOffset, { bpm: bpm0, positie: snap, anker: snap });
      let B = snap, D = snap;
      if (r.zeker && Number.isFinite(r.anker)) {
        if (Math.abs(r.anker - snap) < 0.03) B = r.anker;
        const v = Math.max(a0, r.anker - 12);
        const f = d.fijneFase(pcm.subarray(Math.round((v - a0) * SR), Math.round((v - a0 + 24) * SR)), SR, r.bpm, r.anker, { t0: v });
        if (f !== null && Math.abs(f - r.anker) < 0.03 && Math.abs(f - snap) < 0.03) { B = f; D = f; }
      }
      if (B !== snap) bijB++;
      if (D !== snap) bijD++;
      uit.A.push((snap - ref) * 1000); uit.B.push((B - ref) * 1000); uit.D.push((D - ref) * 1000);
    }
  }
  const st = (a) => { const s = a.map(Math.abs).sort((x, y) => x - y); return `gem ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1).padStart(6)}  |p50| ${s[s.length >> 1].toFixed(1).padStart(5)}  |p90| ${s[Math.floor(0.9 * s.length)].toFixed(1).padStart(5)}`; };
  console.log(`${id} ${van}+${duur} (${g.bpm.toFixed(2)} bpm), ${uit.A.length} keer drukken, t.o.v. de derde mening (ms):`);
  console.log(`   A snap          ${st(uit.A)}`);
  console.log(`   B route         ${st(uit.B)}   (${bijB} keer bijgesteld)`);
  console.log(`   D alleen flank  ${st(uit.D)}   (${bijD} keer bijgesteld)`);
}
