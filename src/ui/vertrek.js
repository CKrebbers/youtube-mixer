/**
 * Eerst vragen voordat de mixer weggaat (Cmd+R, Cmd+W, het tabblad sluiten),
 * zolang er iets verloren gaat (docs/WINST.md punt 6, ONTBREEKT A5).
 *
 * Na herladen zijn alle decks leeg: wat speelde stopt, wat op de maat wachtte
 * of nog laadde is weg, de auto-DJ staat uit, een opname mist haar laatste
 * seconde en de video. Het toetsenbord laat Cmd met rust, dus Cmd+R gaat
 * gewoon naar Chrome; dit is de enige rem. Eén plek voor de hele mixer (de
 * opname vroeg het eerst zelf, in opname-knop.js).
 *
 * Chrome toont zijn eigen vraag ("Site verlaten?"); de tekst kies je niet.
 * Hij doet dat alleen als er ooit op de pagina geklikt of getypt is (sticky
 * user activation). MIDI telt daar niet voor: wie alleen met de APC werkte,
 * krijgt de vraag mogelijk niet. Een vangnet, geen slot.
 */

/**
 * Waarom de mixer nu niet stil weg mag, of null. Puur.
 * @param {object} s
 * @param {Array<{playing?: boolean, wacht?: boolean, laadt?: boolean}>} [s.decks]
 * @param {boolean} [s.auto]     de auto-DJ staat aan
 * @param {boolean} [s.opname]   er loopt een opname
 * @returns {string|null}
 */
export function waaromBlijven({ decks = [], auto = false, opname = false } = {}) {
  if (opname) return 'er loopt een opname';
  if (auto) return 'de auto-DJ staat aan';
  for (const d of decks) {
    if (!d) continue;
    if (d.playing) return 'er speelt een track';
    if (d.wacht) return 'een track wacht op de maat';
    if (d.laadt) return 'er wordt een track geladen';
  }
  return null;
}

/**
 * Hangt de vraag aan `beforeunload`. `lees()` geeft de stand voor
 * waaromBlijven; wat hij ook doet (gooien), de pagina mag altijd weg.
 * @param {() => object} lees
 * @param {{ addEventListener: Function }} [doel]  window (tests: een nep)
 * @returns {(e: Event) => void} de handler
 */
export function bewaakVertrek(lees, doel = globalThis.window) {
  const handler = (e) => {
    let reden = null;
    try { reden = waaromBlijven(lees()); } catch (_) { return; }
    if (!reden) return;
    e.preventDefault();
    e.returnValue = '';                 // oudere Chrome-versies vragen het alleen zo
  };
  doel?.addEventListener?.('beforeunload', handler);
  return handler;
}
