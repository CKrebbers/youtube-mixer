/**
 * Een instrument op een track aansluiten en er klikvrij weer afhalen (v1 docs/INSTRUMENTEN.md §6.1,
 * oogst produceren-008/009). Dit is wat de engine van de audiolaag vraagt:
 *
 *   audio.instrumenten                      [{ soort, naam }]
 *   audio.instrument(ctx, soort, strip, { klok, toon })  → { inst, soort, aansluiting, weg() }
 *
 * Het instrument hangt aan een EIGEN GainNode (de aansluiting) op `strip.in`: trim, EQ, insert,
 * filter, fader, crossfader, sends en de cue van de koptelefoon werken vanzelf, zoals bij een
 * nummer. Het instrument zelf is droog (geen galm, geen limiter: dat zijn de sends en de master).
 *
 * weg(): eerst alleUit(), dan de aansluiting dicht met de zachte S van de kill (KILL_FADE, na
 * startDrempel), en pas als de audioklok daar voorbij is vernietig() (een worklet krijgt dan
 * 'stop') en losmaken. Geeft een Promise die klaar is als alles los is.
 */
import { startDrempel } from '../overgang.js';
import { killVersterking, KILL_FADE, naAudioklok } from '../strip.js';
import { INSTRUMENTEN, instrumentDef } from './index.js';

/** Wat de engine laat kiezen: soort en naam, in de volgorde van de lijst. */
export const instrumentSoorten = () => INSTRUMENTEN.map(({ soort, naam }) => ({ soort, naam }));

/** Zo lang na de fade blijft alles nog staan voordat het losgaat (marge voor de audiothread). */
export const MARGE = 0.02;

/**
 * @param strip  de strip van de track (`strip.in` is de ingang) of rechtstreeks een AudioNode
 * @param klok   de maatklok (src/kern/klok.js) of null
 * @param toon   () => toonsoort-tekst van wat je hoort, of null
 */
export function sluitAan(ctx, soort, strip, { klok = null, toon = null } = {}) {
  const def = instrumentDef(soort);
  if (!def) throw new Error(`onbekend instrument ${soort}`);
  const doel = strip?.in ?? strip;
  const aansluiting = ctx.createGain();
  aansluiting.gain.value = 1;
  aansluiting.connect(doel);
  const inst = def.maak(ctx, { uit: aansluiting, klok, toon: typeof toon === 'function' ? toon : () => null });
  let weg = null;
  return {
    inst, soort, aansluiting,
    weg() {
      if (weg) return weg;
      const nu = ctx.currentTime, wacht = startDrempel(ctx);
      try { inst.alleUit(); } catch (_) { /* weghalen gaat altijd door */ }
      killVersterking(aansluiting.gain, 0, nu, wacht);
      weg = naAudioklok(ctx, nu + wacht + KILL_FADE + MARGE, () => {
        try { inst.vernietig(); } catch (_) { /* idem */ }
        try { aansluiting.disconnect(); } catch (_) { /* al los */ }
      });
      return weg;
    },
  };
}
