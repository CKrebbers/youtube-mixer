// Herkomst: v1 youtube-mixer/src/video/fouten.js @ 039b372, ongewijzigd overgenomen (v2 BOUWPLAN plak 4). Wijzigingen hier, niet meer in v1.
/**
 * Wat er mis kan gaan met de video van een nummer, in gewone taal. Puur
 * rekenwerk: de mixer roept het aan, de app zet het in de meldingenstrook
 * (meld(), een fout blijft staan tot je hem wegklikt). Een zwarte beamer
 * zonder reden is tijdens een set het ergste wat er kan gebeuren.
 */

/** s: zichtbaar en na zoveel seconden nog geen beeld = melden. Lokale bestanden laden in een fractie daarvan. */
export const LAAD_GEDULD = 10;

/** MediaError (video.error) -> tekst. De codes staan vast in de HTML-standaard. */
export function videoFoutTekst(fout) {
  switch (fout?.code) {
    case 1: return 'laden afgebroken';
    case 2: return 'netwerkfout bij het laden';
    case 3: return 'het beeld is niet te decoderen (bestand kapot?)';
    case 4: return 'het bestand ontbreekt of het formaat wordt niet ondersteund';
    default: return fout?.message || 'onbekende fout';
  }
}

/**
 * Laadt deze video te lang? Alleen als hij te zien zou zijn (anders merk je
 * het niet en hoeft hij ook niet klaar te zijn), en maar één keer per bron.
 * @param sinds, nu  ms (performance.now)
 */
export function laadtTeLang({ zichtbaar, klaar, gemeld, sinds, nu, geduld = LAAD_GEDULD }) {
  return !!zichtbaar && !klaar && !gemeld && nu - sinds > geduld * 1000;
}
