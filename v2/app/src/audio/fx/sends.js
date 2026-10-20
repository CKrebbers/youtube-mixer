/**
 * De twee send-bussen (v1 SEND_RACKS in src/engine/engine.js @ e27018f): A = echo, B = galm.
 *
 * Een bus is een gewone insert-slot met een rack, maar helemaal NAT: het droge signaal komt al via
 * de track zelf (mix 1, dus de droge weg van de slot dicht). Elke track tapt NA zijn fader en vóór
 * de kant/crossfader (v1, Clay 23 sep: zo werkt echo-out ook met de crossfader), en de bus komt uit
 * op de ingang van de master, vóór de limiter: de master-fader en de limiter gelden ook voor de staart.
 *
 * LUI (zoals de stemkanalen van v1: "elk deel komt er pas bij als het voor het eerst iets doet"):
 * de slot staat er meteen (knoppen, namen, standen), maar de keten wordt pas gebouwd en op de
 * master aangesloten als een track voor het eerst iets instuurt (`wek`). Tot dan staat er op de
 * master niets extra's: bit voor bit het pad van plak 1, en geen CPU voor een FDN die niets hoort.
 */
import { InsertSlot } from './fx.js';

export const SEND_RACKS = Object.freeze({
  // Standaard op de maat, 1/4 tel (knop 3/7 van de acht delingen). Knop 4 schakelt naar vrij;
  // dan is knop 1 weer milliseconden.
  A: { schema: 1, name: 'Echo', chain: [{ slot: 'a', type: 'delay', params: { tijd: 3 / 7, feedback: 0.5, toon: 0.5, sync: 1 } }],
    macros: [
      { place: 1, label: 'tijd', default: 3 / 7, links: [{ target: 'a.tijd', from: 0, to: 1 }] },
      { place: 2, label: 'herhaling', default: 0.5, links: [{ target: 'a.feedback', from: 0, to: 1 }] },
      { place: 3, label: 'toon', default: 0.5, links: [{ target: 'a.toon', from: 0, to: 1 }] },
      { place: 4, label: 'op de maat', default: 1, links: [{ target: 'a.sync', from: 0, to: 1 }] },
    ] },
  B: { schema: 1, name: 'Galm', chain: [{ slot: 'a', type: 'reverb', params: { grootte: 0.7, toon: 0.5, meng: 1, freeze: 0 } }],
    macros: [
      { place: 1, label: 'grootte', default: 0.7, links: [{ target: 'a.grootte', from: 0, to: 1 }] },
      { place: 2, label: 'toon', default: 0.5, links: [{ target: 'a.toon', from: 0, to: 1 }] },
      { place: 3, label: 'vasthouden', default: 0, links: [{ target: 'a.freeze', from: 0, to: 1 }] },
    ] },
});

export const BUSSEN = Object.freeze(['A', 'B']);

/** Een send-knop 0..1 naar versterking: kwadratisch (v1): het eerste stuk subtiel, het laatste gooit. */
export const sendGain = (v) => {
  const t = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  return t * t;
};

/**
 * Eén bus: de slot (lui, helemaal nat, met zijn rack) en `aansluiten()` die hem wekt en op `uit`
 * zet. `slot.in` is waar de tracks op aansluiten.
 */
export function maakSendBus(ctx, bus, uit) {
  const rack = SEND_RACKS[bus];
  if (!rack) throw new TypeError(`send-bus '${bus}' bestaat niet (A of B)`);
  const slot = new InsertSlot(ctx, { lui: 'wek' });
  slot.setMix(1);
  slot.zetRack(rack);
  // Helemaal nat, en dat precies: er loopt nog niets door de bus, dus de droge weg meteen op 0
  // (een setTargetAtTime nadert 0 alleen).
  slot.dry.gain.cancelScheduledValues?.(ctx.currentTime);
  slot.dry.gain.value = 0;
  let aan = false;
  return {
    bus,
    slot,
    get aangesloten() { return aan; },
    /** De bus wakker en op de master; geeft de ingang voor een track. Eén keer is genoeg. */
    aansluiten() {
      if (!aan && !slot.weg) { aan = true; slot.out.connect(uit); slot.wek(); }
      return slot.in;
    },
    vernietig() {
      slot.vernietig();
      if (aan) { try { slot.out.disconnect(uit); } catch (_) {} }
    },
  };
}
