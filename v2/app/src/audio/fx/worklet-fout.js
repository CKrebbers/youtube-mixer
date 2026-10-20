// Herkomst: v1 youtube-mixer/src/engine/worklet-fout.js @ e27018f, overgenomen voor v2; alleen de paden van de imports zijn anders.
/**
 * Een fout IN een worklet (processorerror) mag geen stil geluid zonder melding
 * zijn (spoor A, 15 okt). Vanaf zo'n fout geeft de node voor altijd stilte.
 *
 * De engine kent geen DOM (regel 1) en de objecten met een worklet (effecten,
 * klankschaal, instrumenten, de limiter) kennen de engine niet. Daarom gaat de
 * melding over de AudioContext zelf: die is een EventTarget en iedereen heeft
 * hem. De engine luistert (engine.js) en zet hem om in
 * `emit('melding', { tekst, soort: 'fout', sleutel })`; de schermlaag toont hem.
 *
 * fx-meer.js schrijft het event met de hand (één regel bij het maken van de
 * node, zonder import): daar dezelfde naam als WORKLET_FOUT.
 */
export const WORKLET_FOUT = 'varve-workletfout';

/**
 * Meld een worklet-fout op de context. `wat` = wat er stil viel (in gewone
 * taal), `hint` = wat je eraan doet of wat er vanzelf gebeurt. Gooit nooit.
 */
export function meldWorkletFout(ctx, wat, { reden = '', hint = '' } = {}) {
  try {
    if (typeof ctx?.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    ctx.dispatchEvent(new CustomEvent(WORKLET_FOUT, { detail: { wat, reden, hint } }));
  } catch (_) {}
}

/** De reden uit een processorerror-event (Chrome geeft een ErrorEvent, soms zonder tekst). */
export const foutReden = (e) => String(e?.message || e?.error?.message || '');

/** De tekst van de melding, uit het detail van het event. Puur. */
export function workletFoutTekst({ wat, reden, hint } = {}) {
  return `${wat || 'een worklet'} liep vast (fout in de worklet${reden ? `: ${reden}` : ''})${hint ? `; ${hint}` : ''}`;
}
