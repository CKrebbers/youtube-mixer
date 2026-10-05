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
const MAX = 4;
const weg = (el) => { el.classList.add('weg'); setTimeout(() => el.remove(), 400); };

/**
 * Info verdwijnt na `duur` ms. Een FOUT blijft staan tot je erop klikt: die
 * moet je gezien hebben, ook als je net naar de APC keek. Te veel tegelijk:
 * eerst de oudste info weg, pas daarna de oudste fout.
 */
export function meld(tekst, soort = 'info', duur = 5000) {
  // Dezelfde fout die al staat (een stream die blijft haperen): niet stapelen.
  const al = [...meldingen.children].find((m) => !m.classList.contains('weg') && m.classList.contains(soort) && m.firstChild?.textContent === tekst);
  if (al) {
    // Dezelfde melding staat er al (dezelfde knop nog eens, een stream die blijft
    // haperen): niet stapelen, maar hem opnieuw laten oplichten en (info) langer laten staan.
    al.classList.remove('flits');
    void al.offsetWidth;
    al.classList.add('flits');
    if (soort !== 'fout') { clearTimeout(al._weg); al._weg = setTimeout(() => weg(al), duur); }
    return al;
  }
  const el = document.createElement('div');
  el.className = `melding ${soort}`;
  el.append(document.createTextNode(tekst));
  meldingen.append(el);
  while (meldingen.children.length > MAX) {
    const oudste = [...meldingen.children].find((m) => !m.classList.contains('fout')) ?? meldingen.firstElementChild;
    oudste.remove();
  }
  if (soort === 'fout') {
    // Alleen het kruisje vangt de klik: een melding die over een knop ligt,
    // mag die knop nooit onklikbaar maken (5 okt: de PATROON-rij zat eronder).
    const x = document.createElement('button');
    x.className = 'melding-x';
    x.title = 'weghalen';
    x.textContent = '✕';
    x.addEventListener('click', () => weg(el), { once: true });
    el.append(x);
    console.warn('[melding]', tekst);
  } else {
    el._weg = setTimeout(() => weg(el), duur);
  }
  return el;
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
  engine.on('melding', ({ tekst, soort, duur }) => meld(tekst, soort, duur));
  for (const id of DECK_IDS) engine.deck(id).on('fout', (tekst) => meld(`track ${trackVanDeck(id)}: ${tekst}`, 'fout'));
  bijFout((id, err) => meld(`${id} faalde: ${err.message}`, 'fout'));
}
