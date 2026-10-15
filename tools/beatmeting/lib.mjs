// Gedeelde hulp voor het beatgrid-onderzoek. Leest alleen; schrijft niets in media/.
import { readFileSync } from 'node:fs';
// De projectmap, twee niveaus boven dit bestand (tools/beatmeting/).
export const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '');
export const d = await import(ROOT + '/server/detect.js');

export async function library() {
  const r = await fetch('http://localhost:8777/api/library');
  return (await r.json()).tracks;
}

// Waar media/ staat (VARVE_MEDIA, media-VERHUISD.txt, of die van de hoofdrepo vanuit een worktree):
// dezelfde regel als rest/lib.mjs. De paden in de library zijn relatief: media/<id>/onset.bin.
// (15 okt: hier stond ROOT + pad, en dat las niets meer sinds media/ buiten iCloud staat, VI2.)
const { MEDIA } = await import('./rest/lib.mjs');

export function laadOnset(t) {
  const b = readFileSync(MEDIA + '/' + t.onset.bestand.replace(/^media\//, ''));
  const env = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { env, envRate: t.onset.envRate, tijdOffset: t.onset.tijdOffset };
}

export const lees = (env, f) => {
  if (f < 0 || f >= env.length - 1) return 0;
  const i = Math.floor(f), r = f - i;
  return env[i] * (1 - r) + env[i + 1] * r;
};

/**
 * Hoe goed past een grid (tracktijd) in een venster [van, tot) s?
 * - ratio: gem. envelope op de tel / gem. envelope in het venster (1 = toeval)
 * - R: fase-helderheid op de gridperiode (lengte van het gewogen fasegemiddelde, 0..1)
 * - faseMs: waar de lokale puls ligt t.o.v. de gridtellen (ms, + = puls later dan grid)
 * - halfRatio: envelope op de halve tel (offbeat) / venstergemiddelde
 */
export function pasVenster(o, grid, van, tot) {
  const { env, envRate, tijdOffset } = o;
  const p = 60 / grid.bpm;
  const fA = Math.max(0, Math.floor((van - tijdOffset) * envRate));
  const fB = Math.min(env.length, Math.floor((tot - tijdOffset) * envRate));
  if (fB - fA < envRate * 5) return null;
  let som = 0, re = 0, im = 0;
  for (let f = fA; f < fB; f++) {
    const t = f / envRate + tijdOffset;
    const ph = 2 * Math.PI * ((t - grid.firstBeat) / p);
    som += env[f]; re += env[f] * Math.cos(ph); im += env[f] * Math.sin(ph);
  }
  const gem = som / (fB - fA);
  let opTel = 0, opHalf = 0, n = 0;
  const k0 = Math.ceil((van - grid.firstBeat) / p), k1 = Math.floor((tot - grid.firstBeat) / p);
  for (let k = k0; k <= k1; k++) {
    const t = grid.firstBeat + k * p;
    opTel += lees(env, (t - tijdOffset) * envRate);
    opHalf += lees(env, (t + p / 2 - tijdOffset) * envRate);
    n++;
  }
  const R = som > 0 ? Math.hypot(re, im) / som : 0;
  const faseMs = (Math.atan2(im, re) / (2 * Math.PI)) * p * 1000;
  return { ratio: n ? opTel / n / (gem || 1e-9) : 0, halfRatio: n ? opHalf / n / (gem || 1e-9) : 0, R, faseMs, gem };
}

/** Pulshelderheid zonder grid: beste R over tempo's 60..190 in stappen van 0,25%. */
export function pulsHelderheid(o, van, tot) {
  const { env, envRate } = o;
  const fA = Math.max(0, Math.floor(van * envRate)), fB = Math.min(env.length, Math.floor(tot * envRate));
  let best = { R: 0, bpm: null };
  for (let bpm = 60; bpm <= 190; bpm *= 1.0025) {
    const w = 2 * Math.PI * bpm / 60 / envRate;
    let re = 0, im = 0, som = 0;
    for (let f = fA; f < fB; f++) { re += env[f] * Math.cos(w * f); im += env[f] * Math.sin(w * f); som += env[f]; }
    const R = som ? Math.hypot(re, im) / som : 0;
    if (R > best.R) best = { R, bpm };
  }
  return best;
}

export const fmt = (x, n = 2) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(n));
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
