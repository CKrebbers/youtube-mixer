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
export function meld(tekst, soort = 'info', duur = 5000, { sleutel } = {}) {
  // Met een SLEUTEL is het één melding die meegroeit of verandert ("opname: server weg,
  // 14 s in de wacht" -> "opname: weer goed"): dezelfde sleutel vervangt tekst en soort
  // van wat er staat, in plaats van een nieuwe erbij (een rode per seconde duwde de rest weg).
  if (sleutel) {
    const oud = [...meldingen.children].find((m) => !m.classList.contains('weg') && m.dataset.sleutel === sleutel);
    if (oud) return vervang(oud, tekst, soort, duur);
  }
  // Dezelfde fout die al staat (een stream die blijft haperen): niet stapelen.
  const al = [...meldingen.children].find((m) => !m.classList.contains('weg') && m.classList.contains(soort) && m.firstChild?.textContent === tekst);
  if (al) {
    // Dezelfde melding staat er al (dezelfde knop nog eens, een stream die blijft
    // haperen): niet stapelen, maar hem opnieuw laten oplichten en (info) langer laten staan.
    // Opnieuw laten oplichten zonder `offsetWidth`: dat dwong Chrome de opmaak van de
    // hele pagina METEEN uit te rekenen, midden in het MIDI-bericht dat de melding gaf
    // (tot ~12 ms; een pad die steeds "geen secties" zegt; controller-invoer, 14 okt).
    // Klasse eraf en bij het volgende beeld er weer op start hem NIET opnieuw (review 14 okt:
    // tussen de taak en die rAF rekent Chrome geen stijl, dus hij ziet de klasse nooit weg;
    // 1 van 6 herhalingen flitste). Daarom om de beurt twee klassen met elk een EIGEN
    // (gelijke) keyframes-naam: een andere animation-name is voor Chrome een nieuwe animatie,
    // bij de eerstvolgende stijlberekening, zonder dat wij die afdwingen
    // (tools/headless/meldingen.mjs telt de animationstart-events).
    const nu = al.classList.contains('flits') ? 'flits2' : 'flits';
    al.classList.remove('flits', 'flits2');
    al.classList.add(nu);
    if (soort !== 'fout') { clearTimeout(al._weg); al._weg = setTimeout(() => weg(al), duur); }
    return al;
  }
  const el = document.createElement('div');
  el.className = `melding ${soort}`;
  if (sleutel) el.dataset.sleutel = sleutel;
  el.append(document.createTextNode(tekst));
  meldingen.append(el);
  while (meldingen.children.length > MAX) {
    const oudste = [...meldingen.children].find((m) => !m.classList.contains('fout')) ?? meldingen.firstElementChild;
    oudste.remove();
  }
  blijfOfGa(el, tekst, soort, duur);
  return el;
}

/** Een fout blijft staan met een kruisje; info verdwijnt na `duur` ms. */
function blijfOfGa(el, tekst, soort, duur) {
  clearTimeout(el._weg);
  const kruis = el.querySelector?.('.melding-x');
  if (soort === 'fout') {
    if (kruis) return;
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
    kruis?.remove();
    el._weg = setTimeout(() => weg(el), duur);
  }
}

/** De melding met deze sleutel krijgt een nieuwe tekst en soort (zelfde plek, geen flits). */
function vervang(el, tekst, soort, duur) {
  el.firstChild.textContent = tekst;
  el.className = `melding ${soort}`;
  blijfOfGa(el, tekst, soort, duur);
  return el;
}

/** Haal de melding met deze sleutel weg (als hij er staat). */
export function wisMelding(sleutel) {
  const el = [...meldingen.children].find((m) => !m.classList.contains('weg') && m.dataset.sleutel === sleutel);
  if (el) { clearTimeout(el._weg); weg(el); }
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
  engine.on('melding', ({ tekst, soort, duur, sleutel }) => meld(tekst, soort, duur, { sleutel }));
  for (const id of DECK_IDS) engine.deck(id).on('fout', (tekst) => meld(`track ${trackVanDeck(id)}: ${tekst}`, 'fout'));
  // Een stream die hapert (de server is even weg): ÉÉN melding per track met een sleutel, die "weer goed"
  // wordt zodra de pagina's weer binnenkomen, en stil weggaat bij een ander nummer (AR17). Vroeger bleef er
  // per track een rode staan tot je hem wegklikte.
  for (const id of DECK_IDS) {
    const sleutel = `stream:${id}`;
    engine.deck(id).on('hapert', (s) => {
      if (s?.hapert) meld(`track ${trackVanDeck(id)}: ${s.tekst}`, 'fout', undefined, { sleutel });
      else if (s?.weerGoed) meld(`track ${trackVanDeck(id)}: stream weer goed`, 'info', 4000, { sleutel });
      else wisMelding(sleutel);
    });
  }
  bijFout((id, err) => meld(`${id} faalde: ${err.message}`, 'fout'));
}
