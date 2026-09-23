// Fase-spoor: per venster (10 s, stap 5 s) de fase van de puls op een VAST tempo,
// als circulair gemiddelde van de (afgetopte) envelope. Een grid dat klopt geeft
// fase ~0 en stabiel; een tempofout geeft een rechte helling; geen puls geeft ruis.
// Consistentie = aandeel buurvensters waarvan de fase <8% van de periode verschilt.
// Nul: hetzelfde op een envelope met geschudde blokken van 1 s.
// Gebruik: node fasespoor.mjs <trackId> <bpm> <firstBeat> [vensterSec]
import { library, laadOnset, fmt, mmss } from './lib.mjs';
import { geschud } from './gridfit.mjs';

export function spoor(o, bpm, firstBeat, duur, { venster = 10, stap = 5 } = {}) {
  const { env, envRate, tijdOffset } = o;
  const p = 60 / bpm;
  const uit = [];
  for (let v = 0; v + venster <= duur; v += stap) {
    const fA = Math.max(0, Math.floor((v - tijdOffset) * envRate));
    const fB = Math.min(env.length, Math.floor((v + venster - tijdOffset) * envRate));
    // aftoppen op p95 van het venster: één klap mag het venster niet beslissen
    const deel = Array.from(env.subarray(fA, fB)).sort((a, b) => a - b);
    const cap = deel[Math.floor(0.95 * (deel.length - 1))] || 1e-9;
    let re = 0, im = 0, som = 0;
    for (let f = fA; f < fB; f++) {
      const e = Math.min(env[f], cap);
      const ph = 2 * Math.PI * ((f / envRate + tijdOffset - firstBeat) / p);
      re += e * Math.cos(ph); im += e * Math.sin(ph); som += e;
    }
    uit.push({ v, R: som ? Math.hypot(re, im) / som : 0, fase: Math.atan2(im, re) / (2 * Math.PI) });
  }
  return uit;
}

const wrap = (x) => x - Math.round(x);

export function samenvatting(s) {
  let ok = 0;
  for (let i = 1; i < s.length; i++) if (Math.abs(wrap(s[i].fase - s[i - 1].fase)) < 0.08) ok++;
  const opGrid = s.filter((r) => Math.abs(wrap(r.fase)) < 0.08).length;
  const R = s.map((r) => r.R).sort((a, b) => a - b);
  return { consistent: ok / Math.max(1, s.length - 1), opGrid: opGrid / Math.max(1, s.length), Rmed: R[R.length >> 1] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, bpmA, fbA, vA] = process.argv.slice(2);
  const t = (await library()).find((x) => x.id === id);
  const o = laadOnset(t);
  const bpm = Number(bpmA), fb = Number(fbA || 0), venster = Number(vA || 10);
  const s = spoor(o, bpm, fb, t.duur, { venster, stap: venster / 2 });
  const nul = spoor(geschud(o), bpm, fb, t.duur, { venster, stap: venster / 2 });
  const a = samenvatting(s), b = samenvatting(nul);
  console.log(`${t.titel.slice(0, 40)} @ ${bpm} bpm: consistent ${fmt(a.consistent)} (nul ${fmt(b.consistent)}), op grid ${fmt(a.opGrid)} (nul ${fmt(b.opGrid)}), R-mediaan ${fmt(a.Rmed, 3)} (nul ${fmt(b.Rmed, 3)})`);
  if (process.env.LIJST) console.log(s.map((r) => `${mmss(r.v)} ${fmt(r.fase * 60000 / bpm, 0)}ms R${fmt(r.R, 3)}`).join('\n'));
}
