import { read, invoke } from '../control/actions.js';
import { Maschine } from '../control/maschine.js';
import { meld } from './meldingen.js';
import { beschrijf } from './apc-beschrijf.js';

/*
 * De speelapparaten van de AV-app-hub (PROTOCOL §17, docs/MASCHINE.md): alleen
 * met ?hub= (app.js laadt dit bestand dan pas, net als control/hub.js).
 *
 *   Xboard49 (hub)      -> noten.koppel(): noten, buiging, druk, modwiel, pedaal
 *                          en de knoppen/schuif (mappings/xboard49.json) op de speeltrack
 *   Maschine MK2 (hub)  -> maschine.js: pads, groepen, draaiknoppen (pagina's Instrument,
 *                          Strip, Rack), masterwiel, uitleg (CONTROL, met de teksten van
 *                          apc-beschrijf.js), lampjes en schermen (mappings/maschine-mk2.json)
 *
 * Geen requestMIDIAccess: de poorten zijn nep-poorten van HubMidi. De lampjes
 * en schermen lopen op een eigen setInterval (zoals de LED-laag van de APC),
 * niet op de renderloop: die staat stil als het venster naar achteren gaat.
 */
export const TIK_MS = 33;

export function opzetSpeelapparaten({ engine, midi, noten, library = null }) {
  const xb = midi.speelPoort?.('xboard49');
  if (xb) noten.koppel(xb.in);

  const ms = midi.speelPoort?.('maschine-mk2');
  let maschine = null;
  if (ms) {
    maschine = new Maschine({ engine, noten, read, invoke, beschrijf, library });
    fetch('mappings/maschine-mk2.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((doc) => maschine.laadMapping(doc))
      .catch((err) => meld(`Maschine: de indeling (mappings/maschine-mk2.json) niet geladen (${err.message})`, 'fout'));
    maschine.koppel(ms);
    setInterval(() => { try { maschine.tik(); } catch (err) { console.warn('[maschine]', err); } }, TIK_MS);
  }
  return { maschine };
}
