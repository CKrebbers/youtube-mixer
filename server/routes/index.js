import werkruimtes from './werkruimtes.js';
import mappingApparaat from './mapping-apparaat.js';
import paneel from './paneel.js';

/**
 * De routes van de sporen van de werkruimte (14 okt, werkruimte S0,
 * docs/werkruimte/S0.md): elk spoor zijn eigen bestand hiernaast, zodat
 * server/index.js niet voor elk spoor open hoeft. Vaste volgorde: wie eerst
 * staat, wint bij twee routes op hetzelfde pad.
 *
 * Een bestand geeft `{ routes, mag }`:
 *   routes  [{ methode: 'GET' | 'POST' | …, pad: RegExp, handler(req, res, ctx) }]
 *           index.js vraagt ze vóór de 404, NA de controles van elk verzoek
 *           (Host/Origin, alleen JSON voor POST op /api/). `pad` wordt getoetst op
 *           url.pathname; de handler geeft zelf antwoord (ctx.json).
 *   mag     [RegExp] erbij op de witte lijst van statische bestanden (MAG)
 *
 * Een bestand dat niet aan de vorm voldoet, laat de server niet starten: dat
 * merk je meteen, niet midden in een set.
 */
export const SPOREN = [['werkruimtes', werkruimtes], ['mapping-apparaat', mappingApparaat], ['paneel', paneel]];

/** Alle routes en witte-lijstregels, gecontroleerd. */
export function spoorRoutes(sporen = SPOREN) {
  const routes = [], mag = [];
  for (const [naam, mod] of sporen) {
    if (!mod || !Array.isArray(mod.routes) || !Array.isArray(mod.mag)) throw new Error(`routes/${naam}.js: geef { routes: [], mag: [] }`);
    mod.routes.forEach((r, i) => {
      if (!r || typeof r.methode !== 'string' || !(r.pad instanceof RegExp) || typeof r.handler !== 'function') {
        throw new Error(`routes/${naam}.js: route ${i} heeft { methode, pad: RegExp, handler } nodig`);
      }
      routes.push({ ...r, methode: r.methode.toUpperCase(), spoor: naam });
    });
    mod.mag.forEach((m, i) => {
      if (!(m instanceof RegExp)) throw new Error(`routes/${naam}.js: mag ${i} is geen RegExp`);
      mag.push(m);
    });
  }
  return { routes, mag };
}

/** De eerste route voor dit verzoek, of null. */
export const zoekRoute = (routes, methode, pad) => routes.find((r) => r.methode === methode && r.pad.test(pad)) ?? null;
