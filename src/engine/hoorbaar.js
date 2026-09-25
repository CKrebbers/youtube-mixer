/**
 * Wat je HOORT, in tracktijd. Puur rekenwerk, één plek voor de formule die
 * de LED-fase, de grid-modus ("tel 1 hier"), de video (volgen en puls) en de
 * maatbronnen van de vormlagen delen.
 *
 * De positie van een deck komt van de audioklok (regel 3), maar wat de
 * audioklok NU afspeelt komt pas na de uitgangsvertraging van de geluidskaart
 * uit de speakers. Wat je hoort is dus de positie van `vertraging` seconden
 * geleden: positie min vertraging × rate, want de positie loopt in tracktijd.
 *
 * Bend telt niet mee: `deck.rate` is de rate zonder bend (alleen de bron
 * draait 4% anders zolang je drukt). Het verschil is 4% van de vertraging,
 * minder dan een milliseconde, en zo doet de hele app het.
 *
 * Bekend: vlak nadat een loop rondging valt positie min vertraging vóór het
 * loopbegin, terwijl je nog het einde van de loop hoort (hooguit de
 * vertraging lang). Voor de tel maakt dat niets uit (het loopbegin valt op
 * het moment dat je het hoort); ctxTijdVan in de streamkern weet hoe het
 * wel moet, als het ooit nodig is.
 */

/** Hoe ver wat je hoort achterloopt op de audioklok (seconden): outputLatency + baseLatency. */
export const uitgangsVertraging = (ctx) => (ctx?.outputLatency || 0) + (ctx?.baseLatency || 0);

/** Positie min vertraging × rate: wat je hoort van een deck dat SPEELT. */
export const naVertraging = (positie, vertraging, rate) => positie - vertraging * (rate > 0 ? rate : 1);

/**
 * De tracktijd die je nu hoort van een deck ({ playing, position, rate }).
 * Stilstaand is de positie zelf wat je hoort en ziet.
 */
export const hoorbaar = (deck, vertraging) =>
  (deck.playing ? naVertraging(deck.position, vertraging, deck.rate) : deck.position);
