// Welke varianten van de chroma we vergelijken. Eén spectrum per track (de
// FFT is het dure deel); de varianten verschillen alleen daarna.
import * as T from './toon.mjs';

export const PROFIELNAMEN = ['krumhansl', 'temperley', 'temperley05', 'shaath', 'edma', 'bgate',
  // Combinaties (gemiddelde correlatie): ROADMAP stelde edma met Temperley als tweede mening voor.
  'temperley05+edma', 'krumhansl+temperley+temperley05+shaath+edma+bgate'];

/** Korte namen voor de tabellen. */
export const KORT = { krumhansl: 'KK', temperley: 'T99', temperley05: 'T05', shaath: 'Sha', edma: 'edma', bgate: 'bgate',
  'temperley05+edma': 'T05+edma', 'krumhansl+temperley+temperley05+shaath+edma+bgate': 'alle6' };
export const kortP = (p) => { const [a, b] = p.split('/'); return (KORT[a] || a) + (b ? `/${b}` : ''); };

/** Frequentiebereiken van het halvetoonspectrum (het FFT-bereik is 27,5–2000 Hz). */
export const BEREIKEN = {
  a1: { fmin: 55, fmax: 2000 },     // A1 en hoger
  a0: { fmin: 27.5, fmax: 2000 },   // A0 en hoger: sub-bas telt mee
};

export const VARIANTEN = [
  { naam: 'lin', bereik: 'a1', chroma: { hpss: false, vloer: false, compressie: 'lin' } },
  { naam: 'log', bereik: 'a1', chroma: { hpss: false, vloer: false, compressie: 'log' } },
  { naam: 'hpss+log', bereik: 'a1', chroma: { hpss: true, vloer: false, compressie: 'log' }, hoofd: true },
  { naam: 'hpss+vloer+log', bereik: 'a1', chroma: { hpss: true, vloer: true, compressie: 'log' } },
  { naam: 'hpss+log/A0', bereik: 'a0', chroma: { hpss: true, vloer: false, compressie: 'log' } },
  // Boventonen (3e en 5e harmonische) grof aftrekken: tegen de kwint-omhoog-fout op piano.
  { naam: 'hpss+boven+log', bereik: 'a1', chroma: { hpss: true, vloer: false, compressie: 'log', boventonen: 0.5 } },
  // Stemming per frame (cirkelgemiddelde over ±30 s) in plaats van één voor de hele track.
  { naam: 'hpss+log/stemming-lopend', bereik: 'a1', lopend: true, chroma: { hpss: true, vloer: false, compressie: 'log' } },
].map((v) => ({ ...v, bereikOpties: BEREIKEN[v.bereik], hs: v.lopend ? `${v.bereik}-lopend` : v.bereik }));

/** Spectrum, stemming en de halvetoonspectra voor elk bereik (en met lopende stemming). */
export function bereid(pcm, sr, specOpties = {}) {
  const sp = T.spectrum(pcm, sr, { fmin: 27.5, fmax: 2000, ...specOpties });
  const hs = {};
  for (const [naam, b] of Object.entries(BEREIKEN)) hs[naam] = T.halveTonen(sp, sp.stemming, b);
  const lopend = T.stemmingLopend(sp, 30);
  hs['a1-lopend'] = T.halveTonen(sp, lopend, BEREIKEN.a1);
  return { sp, hs, lopend, ok: T.nietStil(sp.energie), frames: sp.frames, frameRate: sp.frameRate };
}
