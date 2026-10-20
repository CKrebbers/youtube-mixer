// Herkomst: v1 youtube-mixer/src/analysis/router.js @ 039b372. Anders in v2: de maatbronnen komen van
// de MAATKLOK (maat.js: 'tel' en 'een'), niet van een maatgever-track; 'maatklap' en de sectiebronnen
// van v1 zijn er nog niet (v2 heeft nog geen onset-analyse per nummer en geen sectiekaart).
import { Emitter, clamp } from '../../kern/emitter.js';

/**
 * Modulatie: een kenmerk van de mix (kenmerken.js) of van de klok (maat.js) duwt een knop van een
 * vormlaag. Puur: de router kent geen DOM, geen Web Audio en geen VormLaag, alleen een doel met
 * `zetModulatie(i, offset)`.
 *
 * Een route = { bron, doel, sterkte }:
 *   bron     wat de zaal hoort (de master, luisteraar.js): 'laag' | 'midden' | 'hoog' | 'onset' (klap) | 'rms' (luid)
 *            of de klok (maat.js): 'tel' (elke tel) | 'een' (alleen de "1" van de maat)
 *   doel     knopplek 1..6 van de laag (een PLEK, zoals video.layer.knob.N)
 *   sterkte  0..1
 *
 * Een route schrijft een OFFSET bovenop de knopstand, nooit de knop zelf (oogst beeld-058): de knop
 * op het scherm, de ring en soft-takeover bewegen niet mee, de basisstand blijft.
 */

export const MIX_BRONNEN = ['laag', 'midden', 'hoog', 'onset', 'rms'];
export const MAAT_BRONNEN = ['tel', 'een'];
/** In deze volgorde lopen ze rond (video.layer.react.source). */
export const BRONNEN = [...MIX_BRONNEN, ...MAAT_BRONNEN];
export const BRON_NAAM = { laag: 'laag', midden: 'midden', hoog: 'hoog', onset: 'klap', rms: 'luid', tel: 'tel', een: 'de 1' };
export const DOEL_PLEKKEN = 6;

export const standaardRoute = () => ({ bron: 'laag', doel: 1, sterkte: 0 });

/** De offsets per knopplek voor een lijst routes, in `uit`. Zonder kenmerken of met sterkte 0: alles 0. */
export function offsets(routes, kenmerken, aantal = DOEL_PLEKKEN, uit = new Array(aantal)) {
  uit.fill(0);
  if (!kenmerken) return uit;
  for (const r of routes) {
    const i = r.doel - 1;
    if (!(i >= 0 && i < aantal) || !(r.sterkte > 0)) continue;
    uit[i] += clamp(kenmerken[r.bron] ?? 0) * clamp(r.sterkte);
  }
  return uit;
}

/**
 * De kenmerken op tijd t, alleen uit de lezers die een open route nodig heeft: alleen 'tel' open =
 * de analyser wordt niet gelezen. `nodig` komt van router.nodig(); leeg = null.
 * @param lezers { mix, maat } met elk `lees(t)` -> { bron: 0..1 } of null
 */
export function leesKenmerken(t, nodig, { mix = null, maat = null } = {}) {
  let wilMix = false, wilMaat = false;
  for (const b of nodig) {
    if (MAAT_BRONNEN.includes(b)) wilMaat = true;
    else wilMix = true;
  }
  const a = wilMix ? mix?.lees(t) ?? null : null;
  const b = wilMaat ? maat?.lees(t) ?? null : null;
  return a && b ? { ...a, ...b } : a || b;
}

/** Eén route per laag (standaard: bas → knop 1, sterkte 0). 'change' bij een andere bron of doel. */
export class Router extends Emitter {
  constructor(aantalLagen) {
    super();
    this.routes = Array.from({ length: aantalLagen }, () => [standaardRoute()]);
    this._uit = new Array(DOEL_PLEKKEN).fill(0);
  }

  route(laag) { return this.routes[laag][0]; }
  zetSterkte(laag, v) { this.route(laag).sterkte = clamp(v); }
  zetBron(laag, bron) {
    if (!BRONNEN.includes(bron)) return;
    this.route(laag).bron = bron;
    this.emit('change');
  }
  zetDoel(laag, doel) {
    const d = Math.round(doel);
    if (!(d >= 1 && d <= DOEL_PLEKKEN)) return;
    this.route(laag).doel = d;
    this.emit('change');
  }
  volgendeBron(laag) { this.zetBron(laag, BRONNEN[(BRONNEN.indexOf(this.route(laag).bron) + 1) % BRONNEN.length]); }
  volgendDoel(laag) { this.zetDoel(laag, (this.route(laag).doel % DOEL_PLEKKEN) + 1); }

  /** Staat er ergens een route open? Zo niet, dan hoeft er niets geanalyseerd te worden. */
  actief() { return this.routes.some((rs) => rs.some((r) => r.sterkte > 0)); }

  /** Welke bronnen een open route heeft (een Set; leeg = niets uitlezen). */
  nodig() {
    const uit = new Set();
    for (const rs of this.routes) for (const r of rs) if (r.sterkte > 0) uit.add(r.bron);
    return uit;
  }

  /** De offsets op de lagen zetten (`lagen[i]` hoort bij `routes[i]`); kenmerken null = alles naar 0. */
  pasToe(kenmerken, lagen) {
    for (let i = 0; i < lagen.length; i++) {
      const o = offsets(this.routes[i] ?? [], kenmerken, DOEL_PLEKKEN, this._uit);
      for (let k = 0; k < o.length; k++) lagen[i].zetModulatie(k, o[k]);
    }
  }
}
