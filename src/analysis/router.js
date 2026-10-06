import { Emitter, clamp } from '../lib/emitter.js';

/**
 * Modulatie: een kenmerk van de mix (features.js) of van de maat (maat.js)
 * duwt een knop van een vormlaag. Puur: de router kent geen DOM, geen Web
 * Audio en geen VormLaag, alleen een doel met `zetModulatie(i, offset)`.
 *
 * Een route = { bron, doel, sterkte }:
 *   bron     wat de zaal hoort (de master, luisteraar.js):
 *              'laag' | 'midden' | 'hoog' | 'onset' (klap) | 'rms' (luid)
 *            of de maatgever (maat.js):
 *              'maatklap' (zijn klappen uit de onset-analyse) | 'tel' (zijn tel)
 *              | 'sectie.energie' (de energie van de sectie die je hoort)
 *              | 'sectie.nieuw' (een nieuwe sectie begint, docs/SECTIES.md)
 *   doel     knopplek 1..6 van de laag (een PLEK, zoals video.layer.knob.N:
 *            een andere vorm vraagt geen nieuwe route)
 *   sterkte  0..1
 *
 * Een route schrijft een OFFSET bovenop de knopstand, nooit de knop zelf.
 * Via actions.set/zetKnop zou de knop op het scherm en de LED-ring meebewegen,
 * soft-takeover zou op een bewegend doel wachten en de basisstand zou weg
 * zijn. Zelfde patroon als metPuls (puls.js) en plekEffectief (fx.js).
 */

/** Uit de master-analyser (luisteraar.js). */
export const MIX_BRONNEN = ['laag', 'midden', 'hoog', 'onset', 'rms'];
/**
 * Van de maatgever (maat.js): geen analyser nodig, alleen positie, grid,
 * klappen en sectiekaart. De secties achteraan (6 okt): de volgorde van de
 * eerste zeven blijft, dus react.source loopt tot "tel" zoals vroeger.
 * Bekend: het handelingenlog bewaart de drukken op video.layer.react.source
 * (geen stand in de beginstand, de bron is sessietoestand). Een log van vóór
 * 6 okt dat voorbij "tel" rondliep, komt nu op een sectiebron uit in plaats
 * van op "laag". Niet hersteld: een read en een plek in RONDLOPERS zouden de
 * beginstand veranderen.
 */
export const MAAT_BRONNEN = ['maatklap', 'tel', 'sectie.energie', 'sectie.nieuw'];
/** In deze volgorde lopen ze rond (video.layer.react.source). */
export const BRONNEN = [...MIX_BRONNEN, ...MAAT_BRONNEN];
export const BRON_NAAM = { laag: 'laag', midden: 'midden', hoog: 'hoog', onset: 'klap', rms: 'luid',
  maatklap: 'klap (maat)', tel: 'tel', 'sectie.energie': 'sectie', 'sectie.nieuw': 'nieuwe sectie' };
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
 * De kenmerken op tijd t, maar alleen uit de lezers die een open route nodig
 * heeft: alleen 'tel' open = de analyser wordt niet gelezen, alleen 'laag'
 * open = de maat niet. `nodig` komt van router.nodig(); leeg = null.
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

  /** Welke bronnen een open route heeft (een Set; leeg = niets uitlezen). */
  nodig() {
    const uit = new Set();
    for (const rs of this.routes) for (const r of rs) if (r.sterkte > 0) uit.add(r.bron);
    return uit;
  }

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
