/**
 * Het rijenregister (14 okt, werkruimte S0, docs/werkruimte/S0.md): de rijen
 * onder de mixer (auto, beeld, instrument, klankschaal, koptelefoon, master,
 * stems, patronen) melden zich hier aan met hun EIGEN open/dicht, zodat een
 * deel van een werkruimte ze kan openzetten zonder elk paneel te kennen. Een
 * rij openen gaat dus precies zoals de knop in de bovenbalk het doet (ook het
 * onthouden in localStorage).
 *
 * Geen DOM hier: het paneel geeft zet(open) en isOpen() mee. Een tweede
 * aanmelding met dezelfde naam vervangt de eerste (herladen van een paneel).
 */
const RIJEN = new Map();

/** Een rij aanmelden: naam (zoals de knop) en { zet(open), isOpen() }. */
export function registreerRij(naam, { zet, isOpen }) {
  if (typeof naam !== 'string' || !naam) throw new Error('rij: een naam is verplicht');
  if (typeof zet !== 'function' || typeof isOpen !== 'function') throw new Error(`rij ${naam}: zet(open) en isOpen() zijn verplicht`);
  RIJEN.set(naam, { naam, zet, isOpen });
}

/** De rij met deze naam ({ naam, zet(open), isOpen() }), of null. */
export const rij = (naam) => RIJEN.get(naam) ?? null;

/** De namen van alle aangemelde rijen, in de volgorde van aanmelden. */
export const rijNamen = () => [...RIJEN.keys()];
