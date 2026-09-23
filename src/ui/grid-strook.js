import { Beatgrid, soortZekerheid } from '../engine/beatgrid.js';

/**
 * Hoe zeker is het grid, op het scherm. Puur rekenwerk (geen DOM), zodat
 * spiegel.test het kan narekenen; tekenen doet waveform.js.
 *
 * Drie soorten (zie soortZekerheid in beatgrid.js): 'zeker' (vol), 'onzeker'
 * (gedimd: er is een puls, maar sync en beat-loops weigeren hier) en
 * 'geenpuls' (rood gestreept: niets om op te lijnen).
 */

/**
 * De strook in pixels: per stuk { x0, x1, soort }, x in 0..w. Stukken die
 * op minder dan een pixel vallen gaan op in hun buur — een album van een uur
 * met veertig stukken op een baan van 300 px blijft zo leesbaar, en elke
 * pixel krijgt de soort die er het meest ligt.
 */
export function strookPixels(strook, duur, w) {
  if (!strook?.length || !(duur > 0) || !(w > 0)) return [];
  const uit = [];
  for (const s of strook) {
    const x0 = Math.round((s.van / duur) * w), x1 = Math.round((s.tot / duur) * w);
    if (x1 <= x0) continue;
    const vorige = uit.at(-1);
    if (vorige && vorige.soort === s.soort && vorige.x1 === x0) vorige.x1 = x1;
    else uit.push({ x0, x1, soort: s.soort });
  }
  return uit;
}

/** De bpm-tekst voor een kolom of de kop: "?" erachter als het grid hier onzeker is. */
export function bpmTekst(bpm, zeker) {
  if (!bpm) return '—';
  return bpm.toFixed(1) + (zeker === false ? '?' : '');
}

/**
 * Status van een grid voor de library-lijst:
 *   'slot'      met de hand bevestigd (✓)
 *   'zeker'     automatisch, en minstens de helft van de track is zeker
 *   'onzeker'   automatisch, er is een puls maar minder dan de helft is zeker
 *   'geenpuls'  nergens een puls
 *   'hand'      met de hand gezet, zonder zekerheid (van vóór de analyse)
 *   'geen'      geen grid
 * `aandeel` = deel van de tijd dat zeker is (0..1), null zonder grid.
 */
export function gridStatus(json, duur = null) {
  const g = Beatgrid.van(json);
  if (!g) return { status: 'geen', aandeel: null };
  if (g.slot) return { status: 'slot', aandeel: 1 };
  const stukken = g.stukken;
  if (stukken.every((s) => s.zekerheid === undefined)) return { status: 'hand', aandeel: 1 };
  // Zonder duur (onbekend): het laatste stuk telt een minuut.
  const eind = duur > 0 ? duur : stukken.at(-1).van + 60;
  const strook = g.strook(eind);
  const totaal = strook.reduce((a, s) => a + (s.tot - s.van), 0) || 1;
  const tijd = (soort) => strook.filter((s) => s.soort === soort).reduce((a, s) => a + (s.tot - s.van), 0);
  const aandeel = tijd('zeker') / totaal;
  if (strook.every((s) => s.soort === 'geenpuls')) return { status: 'geenpuls', aandeel: 0 };
  return { status: aandeel >= 0.5 ? 'zeker' : 'onzeker', aandeel };
}

/** De bpm-kolom van de library: het stuk op 0, of "wisselend" als de stukken verschillen (> 0,5%). */
export function libraryBpm(json) {
  const g = Beatgrid.van(json);
  if (!g) return '—';
  const bpms = g.stukken.map((s) => s.bpm);
  const wisselt = bpms.some((b) => Math.abs(b / bpms[0] - 1) > 0.005);
  return wisselt ? 'wisselend' : bpms[0].toFixed(1);
}

export const STATUS_TEKST = {
  slot: '✓ slot', zeker: 'auto zeker', onzeker: 'auto onzeker', geenpuls: 'geen puls', hand: 'met de hand', geen: 'geen grid',
};

export { soortZekerheid };
