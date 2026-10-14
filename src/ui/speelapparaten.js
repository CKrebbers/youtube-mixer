import { read, invoke } from '../control/actions.js';
import { Maschine } from '../control/maschine.js';
import { meld } from './meldingen.js';
import { beschrijf } from './apc-beschrijf.js';
import { opzetMappingOpslag } from './mapping-opslag.js';
import { MidiLearn, vangLeren, maschineMagLeren } from '../control/midi-learn.js';

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
 * De indeling van de Maschine is standaard + jouw verschil (14 okt, werkruimte S5):
 * mappings/maschine-mk2.json met wat je koppelde erop, bewaard op de server onder
 * /api/mapping/maschine-mk2 (mapping-opslag.js). Koppelen: kies "Maschine" in het
 * koppelpaneel, klik een action aan, en raak dan op de Maschine de control aan
 * met CONTROL vastgehouden (zonder CONTROL speelt de Maschine gewoon door).
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
    // Koppelen op de Maschine (werkruimte S5). Het profiel (namen en nummers) komt
    // dynamisch: maschine.js heeft het al geladen, en zo blijft de statische keten
    // zoals test/hub.test.mjs hem eist. Tot het er is (één microtaak) leert hij niets.
    let profiel = null;
    const namen = { id: 'maschine-mk2', name: 'Maschine MK2 (via de hub)', label: (sig) => profiel?.default.label(sig) ?? null };
    const learn = new MidiLearn({ mapping: maschine.mapping, device: namen });
    import('../control/devices/maschine-mk2.js').then((p) => { profiel = p; }).catch(() => {});
    vangLeren(maschine, 'ontvang', learn, { magLeren: (msg) => (profiel ? maschineMagLeren(maschine, learn, msg, profiel) : false) });
    opzetMappingOpslag({ mapping: maschine.mapping, apparaat: 'maschine-mk2', learn, haal: (...a) => fetch(...a), opslag: browserOpslag(), meld })
      .start()
      .catch((err) => meld(`Maschine: de indeling (mappings/maschine-mk2.json) niet geladen (${err.message})`, 'fout'));
    maschine.koppel(ms);
    setInterval(() => { try { maschine.tik(); } catch (err) { console.warn('[maschine]', err); } }, TIK_MS);
    globalThis.addEventListener?.('pagehide', () => maschine.stop());   // geen wektik meer bij het sluiten
  }
  return { maschine };
}

const browserOpslag = () => { try { return globalThis.localStorage ?? null; } catch (_) { return null; } };
