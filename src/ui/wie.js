/**
 * Welke track een action bedoelt, in gewone taal: de staart van de uitleg ("— focus-track",
 * "— track 3"). Eén plek voor apc-beschrijf.js en de sporen in src/ui/beschrijf/.
 *
 * Puur, geen imports, geen DOM, geen bus: apc.html en maschine.html laden de uitleg statisch.
 * Een plaatshouder die niet in de tabel staat wordt `track <t>` (ook een gewoon nummer).
 * De tabellen zijn bevroren en zonder prototype, zodat een t als 'constructor' gewoon
 * "track constructor" blijft.
 */
const tabel = (o) => Object.freeze(Object.assign(Object.create(null), o));

/** De kern: alleen focus en speeltrack (zo noemt apc-beschrijf.js de standaardmapping). */
export const WIE_KERN = tabel({ '{focus}': 'focus-track', '{speel}': 'speeltrack' });

/** Ook de tweede track en de maatgever (de sporen combi en effecten). */
export const WIE = tabel({
  ...WIE_KERN,
  '{tweede}': 'tweede track', '{R}': 'tweede track',
  '{maatgever}': 'de track die de maat geeft',
});

/** Een eigen tabel op basis van WIE, met andere woorden voor een paar plaatshouders. */
export const wieMet = (anders) => tabel({ ...WIE, ...anders });

/** De naam van track `t` volgens `namen` (standaard WIE). */
export const wie = (t, namen = WIE) => namen[t] ?? `track ${t}`;
