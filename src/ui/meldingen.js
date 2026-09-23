import { DECK_IDS } from '../engine/engine.js';
import { bijFout, trackVanDeck } from '../control/actions.js';

/**
 * Meldingen: de strook onderaan het scherm, en kort op een knop zelf.
 *
 * Bijna elke module van de schermlaag heeft dit nodig, daarom staat het los
 * en hangt het nergens van af. Fouten horen hier en niet alleen in de
 * console: die leest niemand tijdens een set.
 */

/**
 * Een melding onderaan het scherm, een paar seconden. Voor wat misgaat en
 * niet bij één knop hoort: een mislukte sync, een stream die hapert, een
 * bestand dat niet te lezen is. Tot nu toe stond dat alleen in de console,
 * en die leest niemand tijdens een set.
 */
const meldingen = document.getElementById('meldingen');
export function meld(tekst, soort = 'info', duur = 5000) {
  const el = document.createElement('div');
  el.className = `melding ${soort}`;
  el.textContent = tekst;
  meldingen.append(el);
  while (meldingen.children.length > 4) meldingen.firstElementChild.remove();
  setTimeout(() => { el.classList.add('weg'); setTimeout(() => el.remove(), 400); }, duur);
  if (soort === 'fout') console.warn('[melding]', tekst);
}

/** Kort op de knop zelf laten zien wat er gebeurde; de console leest niemand. */
export function meldOpKnop(knop, tekst, goed) {
  clearTimeout(knop._melding);
  knop.dataset.tekst ??= knop.textContent;
  knop.textContent = tekst;
  knop.classList.toggle('gelukt', goed);
  knop.classList.toggle('mislukt', !goed);
  knop._melding = setTimeout(() => {
    knop.textContent = knop.dataset.tekst;
    knop.classList.remove('gelukt', 'mislukt');
  }, goed ? 1500 : 4000);
}

/**
 * Meldingen uit de engine en de bus: sync die niet kan, een pad die niet
 * vult, een stream die hapert, een action die faalt.
 */
export function koppelMeldingen(engine) {
  engine.on('melding', ({ tekst, soort }) => meld(tekst, soort));
  for (const id of DECK_IDS) engine.deck(id).on('fout', (tekst) => meld(`track ${trackVanDeck(id)}: ${tekst}`, 'fout'));
  bijFout((id, err) => meld(`${id} faalde: ${err.message}`, 'fout'));
}
