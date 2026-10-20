/**
 * De acties van de koppeling met de Stroommachine op de bus. De namen zijn die van v1
 * (src/control/actions.js, bindBeeld): beeld.macro.<naam> en beeld.regie.<naam>. In v2 heet het
 * VIDEO-deel al video.* (src/beeld/acties.js), dus beeld.* is vrij (test/koppel-acties.test.mjs
 * controleert dat er niets botst). Nieuw in v2: beeld.aan (de koppeling aan/uit, zoals de knop in het
 * paneel; een controller kan hem zo ook).
 *
 *   beeld.macro.intensiteit … .balans   waarde 0..1 naar de poort macro.<naam>; lees: de stand, null zonder verbinding
 *   beeld.regie.ontdek … .vrij          trigger: alleen bij indrukken naar regie!<naam>; lees: 1 ingedrukt, 0, null zonder verbinding
 *   beeld.aan                           trigger, schakelaar: de koppeling aan/uit; lees: 1/0 (altijd te bedienen)
 *
 * Meta (bus.js):
 *   - regie en aan zijn geen geluid en geen stand van de set: log 'overslaan', niet in de beginstand
 *     (v1 OVERSLAAN sloeg de regie al over: vasthouden en paniek zijn schakelaars van de Stroommachine,
 *     terugspelen zou ze omzetten).
 *   - de macro's ook niet in de beginstand (VarveDJ kent de stand van de Stroommachine niet: ze meldt hem
 *     niet terug, en zonder verbinding is de lees null), maar WEL in het log, zoals in v1: een
 *     teruggespeelde set zet het beeld weer zoals toen. Dat is een keuze (het rapport van 20 okt).
 * Geen enkele is `gevaarlijk`: ze raken het geluid niet.
 *
 * Kent geen engine en geen DOM: alleen een bus (duck-typed: defineer) en de koppeling.
 */
import { MACROS, REGIE } from './beeld.js';

/** Macro's met hun neutrale stand in het midden: de ring toont vanuit het midden. */
export const BIPOLAIR = new Set(['macro.feedback', 'macro.tint', 'macro.dichtheid', 'macro.balans']);

/** Wat een regieknop van de Stroommachine doet, voor het label (src/09d-poorten.js daar; v1 BEELD_REGIE_LABEL). */
export const REGIE_LABEL = Object.freeze({
  ontdek: 'ontdek (een nieuwe scène)', volgende: 'volgende scène', vasthouden: 'vasthouden aan/uit (de regisseur wisselt niet zelf)',
  flits: 'flits (hooguit 2 per seconde)', paniek: 'paniek aan/uit', vrij: 'alles weer automatisch',
});

const NIET_IN_LOG = Object.freeze({ log: 'overslaan', beginstand: false });

/**
 * @param bus        de bus (kern/bus.js)
 * @param koppeling  BeeldKoppeling (koppel/beeld.js)
 * @returns de gedefinieerde id's
 */
export function definieerKoppeling(bus, koppeling) {
  const ids = [];
  const def = (d) => { bus.defineer(d); ids.push(d.id); };
  for (const poort of MACROS) {
    const naam = poort.slice('macro.'.length);
    def({
      id: `beeld.${poort}`, soort: 'waarde', label: `beeld: ${naam} (Stroommachine)`,
      meta: { beginstand: false, ...(BIPOLAIR.has(poort) ? { bipolair: true } : {}) },
      doe: (v) => { koppeling.zetWaarde(poort, v); },
      lees: () => koppeling.waarde(poort),
    });
  }
  for (const poort of REGIE) {
    const naam = poort.slice('regie!'.length);
    def({
      id: `beeld.regie.${naam}`, soort: 'trigger', label: `beeld: ${REGIE_LABEL[naam] ?? naam} (Stroommachine)`,
      meta: NIET_IN_LOG,
      doe: (on) => { koppeling.druk(poort, on); },
      lees: () => koppeling.knopStand(poort),
    });
  }
  def({
    id: 'beeld.aan', soort: 'trigger', label: 'beeld: de koppeling met de Stroommachine aan/uit',
    meta: { ...NIET_IN_LOG, schakelaar: true },
    doe: (on) => { if (on) koppeling.zet({ aan: !koppeling.instellingen.aan }); },
    lees: () => (koppeling.instellingen.aan ? 1 : 0),
  });
  return ids;
}
