import { Emitter, clamp } from '../lib/emitter.js';

/**
 * Modulatie: een kenmerk van de mix (features.js) duwt een knop van een
 * vormlaag. Puur: de router kent geen DOM, geen Web Audio en geen VormLaag,
 * alleen een doel met `zetModulatie(i, offset)`.
 *
 * Een route = { bron, doel, sterkte }:
 *   bron     'laag' | 'midden' | 'hoog' | 'onset' | 'rms'
 *   doel     knopplek 1..6 van de laag (een PLEK, zoals video.layer.knob.N:
 *            een andere vorm vraagt geen nieuwe route)
 *   sterkte  0..1
 *
 * Een route schrijft een OFFSET bovenop de knopstand, nooit de knop zelf.
 * Via actions.set/zetKnop zou de knop op het scherm en de LED-ring meebewegen,
 * soft-takeover zou op een bewegend doel wachten en de basisstand zou weg
 * zijn. Zelfde patroon als metPuls (puls.js) en plekEffectief (fx.js).
 */

export const BRONNEN = ['laag', 'midden', 'hoog', 'onset', 'rms'];
export const BRON_NAAM = { laag: 'laag', midden: 'midden', hoog: 'hoog', onset: 'klap', rms: 'luid' };
export const DOEL_PLEKKEN = 6;

export const standaardRoute = () => ({ bron: 'laag', doel: 1, sterkte: 0 });

/**
 * De offsets per knopplek (index 0..aantal-1) voor een lijst routes.
 * Zonder kenmerken (geen audio) of met sterkte 0: alles 0.
 */
export function offsets(routes, kenmerken, aantal = DOEL_PLEKKEN) {
  const uit = new Array(aantal).fill(0);
  if (!kenmerken) return uit;
  for (const r of routes) {
    const i = r.doel - 1;
    if (!(i >= 0 && i < aantal) || !(r.sterkte > 0)) continue;
    uit[i] += clamp(kenmerken[r.bron] ?? 0) * clamp(r.sterkte);
  }
  return uit;
}

/**
 * Eén route per laag (de standaard: bas → knop 1, sterkte 0, dus niets tot je
 * hem opendraait). Routes als lijst, zodat er later meer per laag kunnen.
 * 'change' bij een andere bron of doel (voor het scherm); de sterkte volgt
 * het scherm via read().
 */
export class Router extends Emitter {
  constructor(aantalLagen) {
    super();
    this.routes = Array.from({ length: aantalLagen }, () => [standaardRoute()]);
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

  /**
   * De offsets op de lagen zetten. `lagen[i]` hoort bij `routes[i]`.
   * Met kenmerken = null gaan alle offsets naar 0 (alles dicht of geen audio).
   */
  pasToe(kenmerken, lagen) {
    lagen.forEach((laag, i) => {
      const o = offsets(this.routes[i] ?? [], kenmerken);
      for (let k = 0; k < o.length; k++) laag.zetModulatie(k, o[k]);
    });
  }
}
