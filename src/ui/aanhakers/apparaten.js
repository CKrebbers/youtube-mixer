// Aanhaker 'apparaten' (spoor S5, docs/werkruimte/S5.md, docs/WERKRUIMTE.md D4).
//
// Elk apparaat zelf instellen met koppelen, met een eigen verschil op de server:
//   APC        midi-opzet.js zoals altijd (/api/mapping, Clay's verschil blijft waar het is)
//   Maschine   speelapparaten.js (alleen met ?hub=): mappings/maschine-mk2.json + /api/mapping/maschine-mk2
//   Xboard     instrument-paneel.js: mappings/xboard49.json + /api/mapping/xboard49
//   toetsen    HIER: keyboard.js heeft de Mapping, deze aanhaker zet mappings/toetsen.json
//              + /api/mapping/toetsen erin
// en daarna alle vier in de apparaatkiezer van het koppelpaneel en de koppelmodus.
// Alleen dat spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
import { opzetMappingOpslag, opslagVan } from '../mapping-opslag.js';
import { toetsenbord } from '../../control/keyboard.js';

/**
 * De kiezer: naam en titel op de knop. De namen van de controls kent het leren
 * van elk apparaat zelf (learn.device): zo laadt deze aanhaker niets van de
 * Maschine zonder ?hub= (test/hub.test.mjs).
 */
export const KIEZER = [['maschine-mk2', 'Maschine'], ['xboard49', 'Xboard'], ['toetsen', 'toetsen']];

export default async function opzet(ctx) {
  // ---- het toetsenbord: standaard + jouw verschil -------------------------------
  const kb = toetsenbord();
  if (kb) {
    if (!kb.mapping.metaOf && ctx.metaOf) {
      kb.mapping.metaOf = ctx.metaOf;
      kb.mapping.on('geweigerd', (lijst) => ctx.meld?.(`toetsen: ${lijst.length === 1 ? lijst[0] : `${lijst.length} regels geweigerd (alleen op het scherm)`}`, 'fout'));
    }
    const opslag = (() => { try { return globalThis.localStorage ?? null; } catch (_) { return null; } })();
    const o = opzetMappingOpslag({ mapping: kb.mapping, apparaat: 'toetsen', learn: kb.learn, haal: (...a) => fetch(...a), opslag, meld: ctx.meld });
    // Niet afwachten: tot het bestand binnen is, werkt de standaard die keyboard.js al heeft.
    o.start().then((v) => (v?.fouten || []).forEach((f) => console.warn('[toetsen]', f)))
      .catch((err) => ctx.meld?.(`toetsen: niet geladen (${err.message})`, 'fout'));
    // Actions die latere aanhakers definiëren bestaan pas daarna (zoals app.js voor de andere mappings).
    setTimeout(() => Promise.resolve(globalThis.aanhakers).then(() => kb.mapping.weigerAlleenScherm?.()).catch(() => {}), 0);
  }

  // ---- de apparaatkiezer in het koppelpaneel en de koppelmodus ------------------
  const paneel = globalThis.mapPanel, modus = globalThis.leerModus;   // app.js zet ze op window (midi-opzet.js)
  if (!paneel?.voegApparaatToe || !modus?.voegApparaatToe) return;
  for (const [naam, titel] of KIEZER) {
    const o = opslagVan(naam);
    if (!o?.learn) continue;   // geen Maschine zonder ?hub=
    const device = o.learn.device;
    paneel.voegApparaatToe(naam, { titel, mapping: o.mapping, learn: o.learn, device, onReset: () => o.herstel() });
    modus.voegApparaatToe(naam, { titel, mapping: o.mapping, learn: o.learn, device });
  }
  // Eén keuze voor beide: kies je in het paneel de Maschine, dan koppelt ook de koppelmodus daar.
  paneel.onApparaat = (naam) => modus.kiesApparaat(naam);
  modus.onApparaat = (naam) => paneel.kiesApparaat(naam);
  // Het paneel dicht (knop "lijst", MIDI-knop of ×): midi-opzet.js stopt dan alleen het
  // leren van de APC. Ook dat van het gekozen apparaat stoppen, anders koppelt de volgende
  // toets of knop stil. Na hun eigen klik-afhandeling (deze luisteraar komt later).
  const midiPaneel = globalThis.document?.getElementById('midi-panel');
  const dicht = () => midiPaneel?.classList.contains('hidden') || paneel.root?.classList.contains('hidden');
  globalThis.document?.addEventListener('click', (e) => {
    if (!e.target?.closest?.('.mon-map-knop, .mon-close, #midi-btn')) return;
    if (dicht() && !modus.actief && paneel.learn.busy) paneel.learn.stop();
  });
}
