/**
 * De meekijkvensters (kaart.html, leren.html) praten met NIEMAND: geen hub, geen MIDI, geen eigen engine.
 * Ze lezen het hoofdvenster dat ze opende (window.opener, same-origin, zelfde thread), zoals het losse
 * beeldvenster (src/beeld/venster.js). Zo blijft er één tabblad dat de APC en de Maschine heeft
 * (CLAUDE.md, "ÉÉN VARVE-tabblad").
 *
 * verbind(start, hint): elke seconde kijken of het hoofdvenster er (nog, of opnieuw) is. Is er een nieuw
 * hoofdvenster (herladen), dan stopt de oude koppeling en begint `start(app)` opnieuw. `start` geeft een
 * functie die opruimt: luisteraars op de bus van het hoofdvenster MOETEN weg als dit venster sluit, anders
 * blijven ze daar hangen.
 *   app = { engine, bus, ctl, opstelling }
 */
export function verbind(start, hint) {
  let van = null, stop = null;
  function kijk() {
    let o = null;
    try { o = window.opener && !window.opener.closed ? window.opener : null; } catch { o = null; }
    const ctl = o?.varveCtl ?? null;
    const klaar = ctl && o.varve && o.varveOpstelling?.schermen ? ctl : null;
    if (klaar === van) return;
    stop?.();
    stop = null;
    van = klaar;
    if (klaar) stop = start({ engine: o.varve, bus: o.varve.bus, ctl: o.varveCtl, opstelling: o.varveOpstelling });
    if (hint) hint.hidden = !!klaar;
  }
  setInterval(kijk, 1000);
  kijk();
  addEventListener('pagehide', () => { stop?.(); stop = null; van = null; });
}

/** Tekst veilig in HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
