/**
 * De acties van de effectlaag op de bus (BOUWPLAN "Effecten", plak 2). Lijm, geen Web Audio:
 * alles gaat naar de insert-slot van de strip (`strip.fx`) en de send-bussen van de mixer
 * (`mixer.sends`, `strip.send`); daar zit de schaling.
 *
 *   track.{n}.fx.knop.1 … .8   waarde: knop K van het rack (een PLEK, niet een parameter: een ander
 *                              rack = een andere betekenis, dezelfde koppeling). lees = de knopstand,
 *                              null als het rack die plek niet heeft
 *   track.{n}.fx.mix           waarde: droog/nat van de insert (equal-power). Op 0 is de keten er niet
 *   track.{n}.fx.aan           trigger, schakelaar: het effect aan/uit (uit = droog, de mix blijft staan).
 *                              lees 1 = aan, 0 = uit, null zonder effect
 *   track.{n}.fx.volgend/.vorig  trigger: het volgende/vorige sjabloon (racks/sjablonen.json)
 *   track.{n}.send.a / .b      waarde: hoeveel naar de echo (A) / galm (B), kwadratisch, na de fader
 *   send.a.knop.1 … .8, send.b.knop.1 … .8   waarde: de knoppen van de twee bussen
 *
 * v1 had geen mix op een bus (een bus is helemaal nat), dus ook hier niet.
 *
 * De bus kent alleen {n}: de tweede index (K) is hier uitgeschreven.
 *
 * `definieerFx(engine, { sjablonen })` geeft een klein object terug:
 *   zetSjablonen(lijst)  de lijst voor volgend/vorig (laadSjablonen() in audio/fx/sjablonen.js)
 *   sjablonen()          de lijst van nu
 * en hangt de maatklok van de engine aan elke slot en aan de bussen (`setKlok` / `zetKlok`).
 */
import { EFFECTEN, effectVan } from '../audio/fx/fx.js';
import { rackVanEffect } from '../audio/fx/rack.js';

export const FX_KNOPPEN = 8;

/** Zonder sjablonen: één rack per effect (zoals v1 fx.next), in de volgorde van de kiezer. */
export const effectRacks = () => EFFECTEN.map((e) => ({ ...rackVanEffect(e), from: `e:${e.id}` }));

export function definieerFx(engine, { sjablonen = null } = {}) {
  const bus = engine.bus;
  const fxVan = (n) => engine.track(n)?.strip?.fx ?? null;
  const stripVan = (n) => engine.track(n)?.strip ?? null;
  let lijst = Array.isArray(sjablonen) && sjablonen.length ? sjablonen : effectRacks();
  const keuze = new Map();      // n -> index in de lijst van wat er nu in staat (null = iets anders)

  // De maatklok: wat in een strip en op een bus gaat, loopt op de klok van het plan (vertraging 0,
  // zie audio/fx/klok.js: de uitgangsvertraging geldt voor muziek en effect samen).
  const vertraging = () => 0;
  for (let n = 1; n <= bus.tracks; n++) fxVan(n)?.setKlok?.(engine.klok, { vertraging });
  engine.mixer?.zetKlok?.(engine.klok, { vertraging });

  // ---- insert per track --------------------------------------------------------------
  for (let k = 1; k <= FX_KNOPPEN; k++) {
    bus.defineer({
      id: `track.{n}.fx.knop.${k}`, soort: 'waarde', label: `effect knop ${k}`,
      doe: (v, n) => { fxVan(n)?.setPlek(k, v); },
      lees: (n) => fxVan(n)?.leesPlek(k) ?? null,
    });
  }
  bus.defineer({
    id: 'track.{n}.fx.mix', soort: 'waarde', label: 'effect droog/nat',
    doe: (v, n) => { fxVan(n)?.setMix(v); },
    lees: (n) => { const f = fxVan(n); return f ? f.mix : null; },
  });
  bus.defineer({
    id: 'track.{n}.fx.aan', soort: 'trigger', label: 'effect aan/uit',
    doe: (v, n) => {
      const f = fxVan(n);
      if (!v || !f) return undefined;
      if (!f.heeftEffect) return { geweigerd: 'er staat geen effect in' };
      f.setBypass(!f.bypass);
      return undefined;
    },
    lees: (n) => { const f = fxVan(n); return !f?.heeftEffect ? null : f.bypass ? 0 : 1; },
  });

  const stap = (n, richting) => {
    const f = fxVan(n);
    if (!f || !lijst.length) return undefined;
    const nu = keuze.has(n) && keuze.get(n) !== null && f.herkomst === `s:${keuze.get(n)}` ? keuze.get(n) : (richting > 0 ? -1 : 0);
    const i = ((nu + richting) % lijst.length + lijst.length) % lijst.length;
    // Herkomst 's:<nr>' (v1): een sjabloon, nooit een eigen rack (bewaren maakt er een nieuw van).
    f.zetRack(lijst[i], { herkomst: `s:${i}` });
    keuze.set(n, i);
    engine.emit?.('track', n);
    const naam = f.rackNaam;
    engine.meld?.(`track ${n}: effect ${naam}`, 'info', `fx:${n}`);
    return undefined;
  };
  bus.defineer({
    id: 'track.{n}.fx.volgend', soort: 'trigger', label: 'volgend effect-rack', meta: { beginstand: false },
    doe: (v, n) => (v ? stap(n, 1) : undefined),
  });
  bus.defineer({
    id: 'track.{n}.fx.vorig', soort: 'trigger', label: 'vorig effect-rack', meta: { beginstand: false },
    doe: (v, n) => (v ? stap(n, -1) : undefined),
  });

  // ---- sends ---------------------------------------------------------------------------
  for (const [b, naam] of [['a', 'echo'], ['b', 'galm']]) {
    bus.defineer({
      id: `track.{n}.send.${b}`, soort: 'waarde', label: `send ${b.toUpperCase()} (${naam})`,
      doe: (v, n) => { stripVan(n)?.send?.(b, v); },
      lees: (n) => stripVan(n)?.lees?.(`send.${b}`) ?? null,
    });
    const slot = () => engine.mixer?.sends?.[b.toUpperCase()] ?? null;
    for (let k = 1; k <= FX_KNOPPEN; k++) {
      bus.defineer({
        id: `send.${b}.knop.${k}`, soort: 'waarde', label: `${naam} knop ${k}`,
        doe: (v) => { slot()?.setPlek(k, v); },
        lees: () => slot()?.leesPlek(k) ?? null,
      });
    }
  }

  return {
    zetSjablonen(nieuw) {
      if (!Array.isArray(nieuw) || !nieuw.length) return false;
      lijst = nieuw;
      keuze.clear();
      return true;
    },
    sjablonen: () => lijst,
    /** De naam van het rack op track n (voor het scherm). */
    rackNaam: (n) => fxVan(n)?.rackNaam ?? null,
    effectVan,
  };
}
