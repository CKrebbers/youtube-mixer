/**
 * Klassen die eerst `:has()` waren in styles.css (controller-invoer, 14 okt).
 *
 * `body:has(#rijen > section:not(.hidden)) .kol .spg-pad` en de rest leken
 * gratis, maar elke keer dat er ERGENS op de pagina een tekstknoop wisselde
 * (een tijd, een bpm, `textContent = …`: elk beeld) of een klasse in een rij,
 * moest Chrome de :has() van body opnieuw beoordelen, en dan rekende hij de
 * stijl van ALLE elementen die achter zo'n regel staan opnieuw uit: ~256 per
 * beeld (gemeten met een trace: "Affected by :has()", "Invalidation set
 * matched class spg-pad/knob-dial/..."). Dat was het grootste deel van de
 * stijltijd op de hoofdthread, waar ook elk MIDI-bericht op zijn beurt wacht.
 *
 * Nu houdt één MutationObserver dezelfde voorwaarden bij als klassen:
 *   .rijen.open          = .rijen:has(> section:not(.hidden))
 *   body.rij-open        = body:has(#rijen > section:not(.hidden))
 *   body.rij-hoog        = body:has(#auto/#klankschaal/#stems:not(.hidden))
 *   .stems-rij.zonder-stemmen = .stems-rij:has(.st-stemmen.hidden)
 *   .stems-rij.vier-stems     = .stems-rij:has(.st-stem[data-stem="drums"]:not(.hidden))
 * Een observer-callback is een microtaak na de wijziging: het volgende beeld
 * ziet de klasse al.
 */
export const HOOG = ['auto', 'klankschaal', 'stems'];

/** Wat er nu moet staan, uit de stand van de rijen (secties: [{ id, open }]). Puur. */
export function rijKlassen({ secties, stemmenVerborgen, vierStems }) {
  const open = (id) => secties.some((s) => s.id === id && s.open);
  const eenOpen = secties.some((s) => s.open);
  return {
    rijenOpen: eenOpen,
    rijOpen: eenOpen,
    rijHoog: HOOG.some(open),
    zonderStemmen: !!stemmenVerborgen,
    vierStems: !!vierStems,
  };
}

export function opzetRijKlassen(doc = document) {
  const rijen = doc.getElementById('rijen');
  if (!rijen) return null;
  const body = doc.body;
  const stems = doc.getElementById('stems');
  const zet = (el, naam, aan) => { if (el && el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const kijk = () => {
    const secties = [...rijen.children].filter((c) => c.tagName === 'SECTION').map((c) => ({ id: c.id, open: !c.classList.contains('hidden') }));
    const k = rijKlassen({
      secties,
      stemmenVerborgen: !!stems?.querySelector('.st-stemmen.hidden'),
      vierStems: !!stems?.querySelector('.st-stem[data-stem="drums"]:not(.hidden)'),
    });
    zet(rijen, 'open', k.rijenOpen);
    zet(body, 'rij-open', k.rijOpen);
    zet(body, 'rij-hoog', k.rijHoog);
    zet(stems, 'zonder-stemmen', k.zonderStemmen);
    zet(stems, 'vier-stems', k.vierStems);
  };
  // Alleen wat de voorwaarden kan veranderen: klassen in de rijen, en rijen of strips die erbij komen.
  new MutationObserver(kijk).observe(rijen, { attributes: true, attributeFilter: ['class', 'data-stem'], childList: true, subtree: true });
  kijk();
  return { kijk };
}
