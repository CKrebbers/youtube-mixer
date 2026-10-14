import precisie from './precisie.js';
import combi from './combi.js';
import werk from './werk.js';
import maschine from './maschine.js';
import schermen from './schermen.js';
import inrichten from './inrichten.js';

/**
 * De uitleg van de sporen van de werkruimte (14 okt, werkruimte S0,
 * docs/werkruimte/S0.md). Elk spoor beschrijft zijn eigen actions in zijn eigen
 * bestand hiernaast; beschrijf() in apc-beschrijf.js vraagt dit eerst en valt
 * anders terug op zijn eigen logica. Statisch geïmporteerd: apc.html en
 * maschine.html laden geen bus en geen aanhakers, maar moeten de uitleg wel
 * kennen. Geen DOM, geen bus: een bestand hier is puur (action -> tekst).
 */
const SPOREN = [precisie, combi, werk, maschine, schermen, inrichten];

/**
 * { kort, lang } van het eerste spoor dat deze action kent, of null. Een spoor
 * dat struikelt telt als "ken ik niet" (één waarschuwing per spoor): een kapotte
 * uitleg mag de kaarten en het scherm niet omleggen.
 */
export function beschrijfSpoor(action) {
  for (let i = 0; i < SPOREN.length; i++) {
    let b = null;
    try { b = SPOREN[i](action); } catch (err) {
      if (!gemeld.has(i)) { gemeld.add(i); console.warn('[beschrijf] een spoor struikelde:', err?.message || err); }
    }
    if (b) return b;
  }
  return null;
}
const gemeld = new Set();
