/**
 * De instrumenten die op een track kunnen staan (v1 docs/INSTRUMENTEN.md §2–4; het v2-contract
 * staat hieronder, en in het rapport van deze bouw).
 *
 * Een expliciete lijst: elke module exporteert één definitie `{ soort, naam, maak(ctx, opties) }`
 * en komt hier in de lijst. Geen registratie via bijwerkingen van imports.
 *
 * maak(ctx, { uit, klok, toon }):
 *   uit   de AudioNode waar het instrument op aansluit (de engine geeft een eigen GainNode die op
 *         `strip.in` van de track zit: trim, EQ, insert, filter, fader, sends en cue werken vanzelf)
 *   klok  de MAATKLOK van de engine (src/kern/klok.js, het object zelf) of null; voor wat op de
 *         tel moet. Geen van de vier gebruikt hem nu; hij hoort wel in het contract.
 *   toon  () => de toonsoort van wat je hoort als tekst ('Am', 'F#', 'Bbm') of null; ook
 *         { toonsoort, cent } mag (de cent van de plaat). Alleen de Klankschaal gebruikt hem.
 *
 * Het object (alle tijden op de audioklok, leeg of voorbij = nu):
 *   soort, naam, params ([{ id, label, standaard 0..1, eenheid(v), gebaar? }], hooguit 8)
 *   start()                       Promise, idempotent; een noteOn vóór klaar is stil en gooit nooit
 *   noteOn(noot 0..127, snelheid 0..1, t?)   snelheid 0 = noteOff
 *   noteOff(noot, t?), alleUit(t?), stil() (paniek, korte fade)
 *   druk(w, noot?), buig(−1..1 = ±2 halve tonen), mod(w), houd(aan)
 *   zetParam(k 1..8, v 0..1, t?)  vanaf t; een noot rekent met de knop van ZIJN moment (p-lock)
 *   leesParam(k, t?)              de knop op nu (of t); null voor een plek die er niet is
 *   stand()                       { soort, naam, klinkt, params: [0..1 × n], … }
 *   on('param', ({ k, v, t }) => …)  het instrument meldt zijn knoppen zelf (geen peilen)
 *   vernietig()                   alles los en weg (eerst stil; een worklet krijgt 'stop')
 */
import { POLY } from './poly.js';
import { FM } from './fm.js';
import { SCHAAL } from './schaal.js';
import { DRUMS } from './drums.js';

/** @type {{ soort: string, naam: string, maak: Function }[]} */
export const INSTRUMENTEN = Object.freeze([POLY, FM, SCHAAL, DRUMS]);

/** De definitie van een soort, of null. */
export const instrumentDef = (soort) => INSTRUMENTEN.find((d) => d.soort === soort) ?? null;

/** De leden die elk instrument heeft (voor de tests en voor wie een instrument aansluit). */
export const CONTRACT = Object.freeze(['start', 'noteOn', 'noteOff', 'alleUit', 'stil', 'druk', 'buig', 'mod', 'houd',
  'zetParam', 'leesParam', 'stand', 'vernietig', 'on']);
