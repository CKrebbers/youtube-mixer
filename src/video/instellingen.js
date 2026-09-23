/**
 * Wat er aan het videobeeld te draaien valt. Puur data: de action-bus en de
 * mixer lezen allebei deze lijst, zodat er één plek is waar een effect bestaat.
 *
 * Elk effect is één knop 0..1 op het eindbeeld. 0 = uit (behalve kleur: daar
 * is het midden "normaal", links zwart-wit, rechts oververzadigd).
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
 * Hoe de tracks over elkaar vallen.
 *   mix       gewogen gemiddelde — rustig, twee tracks op vol worden niet te fel
 *   licht     screen: lichte delen stapelen, donker blijft donker
 *   optellen  alles bij elkaar, fel en hard
 *   verschil  waar beelden gelijk zijn wordt het zwart: psychedelisch
 */
export const MODI = ['mix', 'licht', 'optellen', 'verschil'];
