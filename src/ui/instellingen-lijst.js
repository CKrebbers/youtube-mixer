/**
 * De witte lijst van de instrument-sleutels (extra-3 B4: zeven, beeld telt
 * drie; sinds 14 okt ook de twee bus-racks, dus elf namen), los van
 * `instellingen-opslag.js` omdat de server hem ook importeert
 * (server/index.js, `/api/instellingen`).
 *
 * Puur: geen DOM, geen localStorage, geen fetch, ook niet later. Wie hier iets
 * van de browser nodig heeft, zet het in instellingen-opslag.js.
 */

/** De witte lijst: alleen deze sleutels mogen naar de server. */
export const INSTELLING_SLEUTELS = Object.freeze([
  'varve.master.rack',
  'varve.klankschaal',
  'varve.midi.ports',
  'varve.beeld.adres',
  'varve.beeld.latentie',
  'varve.beeld.aan',
  'varve.stems.standaard',
  'varve.koptelefoon.omgewisseld',
  'varve.vormen',
  // sinds de werkruimte (S4, 14 okt): welk rack op de echo- en de galmbus zit (aanhakers/combi.js)
  'varve.send.a.rack',
  'varve.send.b.rack',
]);

/** Hoe groot één waarde mag zijn (tekens). Een master-rack is een paar kB. */
export const INSTELLING_MAX = 128 * 1024;

export const isInstelling = (sleutel) => INSTELLING_SLEUTELS.includes(sleutel);
