// Herkomst: v1 youtube-mixer/src/video/volg.js @ 039b372 (synchroniseer, inDePas en zichtbaarheid
// ongewijzigd); `doelVan` is nieuw in v2: het doel komt van de track van de engine, niet van een deck.
/**
 * Hoe een video de audio volgt. Puur rekenwerk, geen DOM: te testen in Node.
 *
 * De audio is de baas (positie komt van de audioklok). De video is slaaf en
 * wordt elk beeld bijgestuurd:
 *
 *   klein verschil   een fractie sneller of trager laten lopen. Springen
 *                    zou haperen, en een paar honderdste seconde zie je niet.
 *   groot verschil   springen (seek). Dat is een lus, hotcue of zoekactie.
 *                    Een seek duurt even (de decoder moet vanaf het vorige
 *                    sleutelbeeld doorrekenen), dus we springen naar waar de
 *                    audio IS als de seek klaar is, niet naar waar hij nu is.
 *
 * `doel` is wat je HOORT: de plek van de track op (nu − uitgangsvertraging).
 * Anders loopt het beeld een fractie vóór op het geluid.
 */

export const SPRING_VANAF = 0.15;     // s verschil waarboven springen beter is dan bijsturen
export const MAX_BIJSTUUR = 0.1;      // hooguit 10% sneller of trager
const STIL_MARGE = 1 / 60;            // stilstaand: pas springen bij meer dan een half beeld

/**
 * @param videoTijd  video.currentTime
 * @param doel       tracktijd die je nu hoort
 * @param rate       afspeelsnelheid van de track (seconden nummer per seconde audioklok)
 * @param speelt     speelt de track (zoals je hem hoort)
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

export const INLOOP_DREMPEL = 0.05;   // s: anderhalf beeld bij 30 fps

/**
 * Lopen deze video's in de pas? Voor de inloop van het losse venster
 * (beamer.js): pas als alle ZICHTBARE video's een beeld hebben, niet meer
 * springen en hooguit `drempel` naast wat je hoort zitten, neemt het het
 * mengen over. Strenger dan SPRING_VANAF: daarbinnen stuurt volg nog tot
 * 10% bij, en dat zou je bij de overname zien als een beeld dat terugspringt.
 * Een video met een fout (bestand weg, kapot) telt niet mee: die komt nooit
 * in de pas en de fout staat al in de strook.
 *
 * @param lagen [{ klaar, zoekt, verschil, fout }] — alleen de zichtbare
 * @param n     hoeveel er van `lagen` meetellen (de mixer hergebruikt één lijst)
 * @returns bool (ook true zonder zichtbare video's: dan valt er niets in te lopen)
 */
export function inDePas(lagen, drempel = INLOOP_DREMPEL, n = lagen.length) {
  for (let i = 0; i < n; i++) {
    const l = lagen[i];
    if (!(l.fout || (l.klaar && !l.zoekt && Math.abs(l.verschil) <= drempel))) return false;
  }
  return true;
}

/**
 * Hoe zichtbaar een track is: wat je hoort, zie je. Fader maal crossfader,
 * dezelfde twee die bepalen hoe hard hij klinkt. In v2 rekent de engine dat
 * (`engine.zaalVersterking(n)`); deze functie blijft voor wie twee losse
 * standen heeft.
 */
export const zichtbaarheid = (fader, xfadeGain) => Math.max(0, Math.min(1, fader)) * Math.max(0, Math.min(1, xfadeGain));

/**
 * Wat de video van track `t` nu moet tonen, gelezen uit de engine (duck-typed):
 *   doel    de plek die je HOORT: t.plek(nu − V). Ook stilstaand min V (v1 naVertraging):
 *           een stilstaande track geeft gewoon zijn plek, dus het beeld blijft staan zonder seek.
 *   rate    de snelheid van NU (t.snelheid(nu)): ook nudge en een gekoppelde track die de
 *           klok volgt. Niet de pitchfader: dan loopt het beeld voorbij en springt het terug.
 *   speelt  klinkt hij op het moment dat je hoort (t.speeltOp(nu − V)). Een track die op
 *           zijn start op de maat WACHT speelt niet: het beeld blijft staan (v1).
 * Schrijft in `uit` (geen nieuw object per beeld).
 */
export function doelVan(t, nu, V, uit = { doel: 0, rate: 0, speelt: false }) {
  const tH = nu - V;
  uit.doel = Math.max(0, t.plek(tH));
  uit.speelt = typeof t.speeltOp === 'function' ? !!t.speeltOp(tH) : !!t.speelt;
  uit.rate = uit.speelt ? t.snelheid(nu) : 0;
  // Een snelheid van 0 (rem, stil vak) is geen afspelen: dan staat het beeld stil.
  if (!(uit.rate > 0)) { uit.speelt = false; uit.rate = 1; }
  return uit;
}
