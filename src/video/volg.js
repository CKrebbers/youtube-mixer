/**
 * Hoe een video de audio volgt. Puur rekenwerk, geen DOM: te testen in Node.
 *
 * De audio is de baas (regel 3: de positie komt van de audioklok). De video
 * is slaaf en wordt elke frame bijgestuurd:
 *
 *   klein verschil   een fractie sneller of trager laten lopen. Springen
 *                    zou haperen, en een paar honderdste seconde zie je niet.
 *   groot verschil   springen (seek). Dat is een loop, hotcue of zoekactie.
 *                    Een seek duurt even (de decoder moet vanaf het vorige
 *                    sleutelbeeld doorrekenen), dus we springen naar waar de
 *                    audio IS als de seek klaar is, niet naar waar hij nu is.
 *
 * `doel` is wat je HOORT: de deckpositie min de uitgangsvertraging van de
 * geluidskaart. Anders loopt het beeld een fractie vóór op het geluid.
 */

export const SPRING_VANAF = 0.15;     // s verschil waarboven springen beter is dan bijsturen
export const MAX_BIJSTUUR = 0.1;      // hooguit 10% sneller of trager
const STIL_MARGE = 1 / 60;            // stilstaand: pas springen bij meer dan een half beeld

/**
 * @param videoTijd  video.currentTime
 * @param doel       tracktijd die je nu hoort
 * @param rate       afspeelsnelheid van het deck
 * @param speelt     speelt het deck
 * @param zoekt      is de video nog met een vorige seek bezig
 * @param seekDuur   hoe lang een seek bij deze video gemiddeld duurt (s)
 * @returns { spring: tijd|null, rate: afspeelsnelheid voor de video, speel: bool }
 */
export function synchroniseer({ videoTijd, doel, rate = 1, speelt, zoekt = false, seekDuur = 0.1 }) {
  // Een seek die nog loopt niet onderbreken: dan begint de decoder opnieuw
  // en komt er nooit een beeld.
  if (zoekt) return { spring: null, rate, speel: speelt };
  const verschil = doel - videoTijd;
  if (!speelt) {
    return { spring: Math.abs(verschil) > STIL_MARGE ? Math.max(0, doel) : null, rate, speel: false };
  }
  if (Math.abs(verschil) > SPRING_VANAF) {
    return { spring: Math.max(0, doel + seekDuur * rate), rate, speel: true };
  }
  // Proportioneel bijsturen: 50 ms achter = 10% sneller, tot hij bij is.
  const bij = Math.max(-MAX_BIJSTUUR, Math.min(MAX_BIJSTUUR, verschil * 2));
  return { spring: null, rate: rate * (1 + bij), speel: true };
}

/**
 * Hoe zichtbaar een track is: wat je hoort, zie je. Fader maal crossfader,
 * dezelfde twee die bepalen hoe hard hij klinkt.
 */
export const zichtbaarheid = (fader, xfadeGain) => Math.max(0, Math.min(1, fader)) * Math.max(0, Math.min(1, xfadeGain));
