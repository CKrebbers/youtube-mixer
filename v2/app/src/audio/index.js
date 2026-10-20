/**
 * De audiolaag voor de engine in Chrome (de tests geven een nagebouwde laag).
 * Zie het contract in ARCHITECTUUR.md.
 *
 * Effecten (plak 2): elke strip heeft zijn insert-slot (`strip.fx`, lui: pas een keten als de mix
 * open gaat) en zijn sends (`strip.send('a' | 'b', v)`); de mixer de twee bussen (`mixer.sends.A/B`,
 * `mixer.sendIn`) en `mixer.zetKlok(klok)`. De acties staan in engine/acties-fx.js.
 */
import { maakMixer } from './mixer.js';
import { maakStrip } from './strip.js';
import { Speler } from './speler.js';
import { laadSjablonen } from './fx/sjablonen.js';

export function maakAudio() {
  return {
    mixer: (ctx) => maakMixer(ctx),
    strip: (ctx, mixer) => maakStrip(ctx, mixer),
    speler: (ctx) => Speler.maak(ctx),
    /** De kant-en-klare racks (racks/sjablonen.json) voor track.{n}.fx.volgend/.vorig; null als het bestand er niet is. */
    sjablonen: () => laadSjablonen(),
  };
}
