// Aanhaker 'effecten' (spoor S10, docs/EFFECTEN-MEER.md): de actions van de XY-pad van een rack
// (`track.N.fx.xy.x/.y`, `master.fx.xy.x/.y`) op de bus. De rest van het spoor (modulators,
// sjablonen, de rack-editor) zit in de engine, racks/sjablonen.json en src/ui/rack-editor.js.
// Niets in het MIDI-bericht: een xy-draai is een gewone setPlek.
import { bindEffecten } from '../../control/acties-effecten.js';

export default async function opzet(ctx) {
  // Een kale ctx (test/aanhaakpunten.test.mjs): niets om aan te haken.
  if (!ctx?.engine || typeof ctx.define !== 'function') return;
  bindEffecten({ engine: ctx.engine, define: ctx.define });
}
