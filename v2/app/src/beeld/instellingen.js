// Herkomst: v1 youtube-mixer/src/video/instellingen.js @ 039b372 (VIDEO_FX en MODI ongewijzigd) en
// VIDEO_FX_ACTIE uit v1 src/control/actions.js (de Engelse namen op de bus, zoals de telling ze kent).
/**
 * Wat er aan het videobeeld te draaien valt. Puur data: de bus (acties.js), het
 * scherm en de mixer lezen allemaal deze lijst, zodat een effect op één plek
 * bestaat (oogst beeld-012).
 *
 * Elk effect is één knop 0..1 op het eindbeeld. 0 = uit (behalve kleur: daar is
 * het midden "normaal", links zwart-wit, rechts oververzadigd).
 */
export const VIDEO_FX = [
  { id: 'pixel',   naam: 'Pixel',   standaard: 0 },
  { id: 'spiegel', naam: 'Spiegel', standaard: 0 },
  { id: 'rgb',     naam: 'RGB',     standaard: 0 },
  { id: 'kleur',   naam: 'Kleur',   standaard: 0.5, bipolair: true },
  { id: 'sporen',  naam: 'Sporen',  standaard: 0 },
  { id: 'korrel',  naam: 'Korrel',  standaard: 0 },
];

/**
 * De naam op de bus: Engels, zoals in v1 (video.fx.mirror, .color, .trails, .grain). De telling
 * (v2/telling/nu.md punt 4) en de handelingenlogs van v1 kennen ze zo.
 */
export const VIDEO_FX_ACTIE = { pixel: 'pixel', spiegel: 'mirror', rgb: 'rgb', kleur: 'color', sporen: 'trails', korrel: 'grain' };

/**
 * Hoe de tracks over elkaar vallen.
 *   mix       gewogen gemiddelde, gedeeld door minstens 1 — één track op halve fader wordt wél donkerder
 *   licht     screen: lichte delen stapelen, donker blijft donker
 *   optellen  alles bij elkaar, fel en hard
 *   verschil  waar beelden gelijk zijn wordt het zwart
 */
export const MODI = ['mix', 'licht', 'optellen', 'verschil'];
