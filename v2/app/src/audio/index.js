/**
 * De audiolaag voor de engine in Chrome (de tests geven een nagebouwde laag).
 * Zie het contract in ARCHITECTUUR.md.
 */
import { maakMixer } from './mixer.js';
import { maakStrip } from './strip.js';
import { Speler } from './speler.js';

export function maakAudio() {
  return {
    mixer: (ctx) => maakMixer(ctx),
    strip: (ctx, mixer) => maakStrip(ctx, mixer),
    speler: (ctx) => Speler.maak(ctx),
  };
}
