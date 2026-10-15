/**
 * Getallen als tekst, op één plek: de eenheden van de effecten (fx.js, fx-meer.js,
 * fx-s10.js, de instrumenten) en de schermlaag gebruiken dezelfde notatie. Een
 * komma in plaats van een punt, kHz boven 1000, een echt minteken (−, U+2212).
 *
 * Geen imports, geen DOM: de engine mag hieruit lezen (regel 1), de schermlaag ook.
 * Wijzig je hier iets, dan verandert elke eenheid op het scherm mee; de tests op de
 * labels (effecten, effecten-s10, rack, instrumenten …) vangen dat.
 */

/** `x` met `n` decimalen en een komma: komma(1.25, 1) = '1,3' (toFixed rondt af). */
export const komma = (x, n = 1) => x.toFixed(n).replace('.', ',');

/** Een frequentie: '440 Hz', '1,5 kHz', '12 kHz' (boven 10 kHz zonder decimaal). */
export const hz = (f) => (f >= 1000 ? `${komma(f / 1000, f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);

/** 0..1 als hele procent: '45%'. Geen controle op het type (dom.js `pct` doet dat wel). */
export const pct = (v) => `${Math.round(v * 100)}%`;

/** Seconden als ms: onder 0,1 s met één decimaal ('4,5 ms'), daarboven heel ('250 ms'). */
export const ms = (s) => (s < 0.1 ? `${komma(s * 1000, 1)} ms` : `${Math.round(s * 1000)} ms`);

/** Het teken van een getal: '+', '−' (echt minteken) of '' bij 0. */
export const teken = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');

/** Decibel met één decimaal en een teken op de afgeronde waarde: '+3,0 dB', '−0,5 dB', '0,0 dB'. */
export const db = (d) => `${teken(Math.round(d * 10))}${komma(Math.abs(d), 1)} dB`;
