/*
 * De instrumenten die op een track kunnen staan (docs/INSTRUMENTEN.md).
 *
 * Een expliciete lijst: elke module exporteert één definitie
 * `{ soort, naam, maak(ctx, { uit, klok, toon }) }` en komt hier in de lijst.
 * Geen registratie via bijwerkingen van imports: dan hangt wat er bestaat af
 * van welke module toevallig al geladen is.
 */

/** @type {{ soort: string, naam: string, maak: Function }[]} */
export const INSTRUMENTEN = [];

/** De definitie van een soort, of null. */
export const instrumentDef = (soort) => INSTRUMENTEN.find((d) => d.soort === soort) ?? null;
