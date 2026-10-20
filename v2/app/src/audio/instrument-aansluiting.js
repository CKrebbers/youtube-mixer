/**
 * Een instrument op een track (v1 INSTRUMENTEN.md §6): het sluit via een eigen GainNode aan op de
 * ingang van de strip, zodat trim, EQ, effect, filter, fader, sends en cue vanzelf werken.
 * Weghalen gaat klikvrij: de aansluiting dicht (lineair, na de startdrempel), dan pas
 * vernietig() en los (v1: een worklet die alleen los gaat draait voor altijd).
 */
import { startDrempel, houdVast } from './overgang.js';

export const DICHT = 0.01;   // s

/**
 * @param def   { soort, naam, maak(ctx, { uit, klok, toon }) } (src/audio/instrumenten/)
 * @param strip de strip van de track (strip.in)
 */
export function maakInstrument(ctx, def, strip, { klok = null, toon = () => null } = {}) {
  const aansluiting = new GainNode(ctx, { gain: 1 });
  aansluiting.connect(strip.in);
  const inst = def.maak(ctx, { uit: aansluiting, klok, toon });
  return {
    inst,
    /** Klikvrij weg; de Promise is klaar als alles los is. */
    async weg() {
      const t0 = ctx.currentTime + startDrempel(ctx);
      houdVast(aansluiting.gain, ctx.currentTime);
      aansluiting.gain.setValueAtTime(1, t0);
      aansluiting.gain.linearRampToValueAtTime(0, t0 + DICHT);
      await new Promise((r) => setTimeout(r, (startDrempel(ctx) + DICHT) * 1000 + 30));
      try { inst.vernietig(); } catch { /* al weg */ }
      try { aansluiting.disconnect(); } catch { /* al los */ }
    },
  };
}
