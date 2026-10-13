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
export function bpmTekst(bpm, zeker, decimalen = 1) {
  if (!bpm) return '—';
  return bpm.toFixed(decimalen) + (zeker === false ? '?' : '');
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

/** Binnen 3% is het hetzelfde tempo (drift van een live gespeeld nummer); daarboven een ander. */
export const BPM_ZELFDE = 0.03;
/** Pas boven 1% afwijking van het hoofdtempo krijgt een stuk een ~: kleiner zie je in de kolom niet. */
export const BPM_DRIFT = 0.01;
/** Een tweede tempo komt pas in de kolom als het minstens een kwart van de zekere tijd klinkt. */
export const BPM_TWEEDE_AANDEEL = 0.25;
/** Verhoudingen die als "hetzelfde tempo, anders geteld" gelden (half/dubbel, triool). */
const FAMILIE = [1.5, 2, 3, 4];

/**
 * De bpm-kolom van de library (13 okt, Clay: "bijna alles staat op wisselend"). Vroeger stond er
 * "wisselend" zodra één stuk 0,5% afweek, ook een onzeker stuk; dat gold voor 61 van de 69 nummers,
 * terwijl er maar 3 echt twee tempo's hebben. Nu, op de ZEKERE stukken, gewogen naar hun lengte:
 *   "84.7"       één tempo
 *   "~84.7"      één tempo dat drift (stukken binnen 3%, één > 1% van het gemiddelde): live gespeeld
 *   "128 / 117"  een tweede tempo (geen half/dubbel) dat ≥ 25% van de zekere tijd klinkt
 *   "64.6?"      geen enkel zeker stuk: het tempo dat het langst klinkt, onder voorbehoud
 * Half of dubbel tempo telt als hetzelfde (jungle 87/174). Alleen tekst: het grid blijft zoals het is.
 */
export function libraryBpm(json, duur = null) {
  const g = Beatgrid.van(json);
  if (!g) return '—';
  const stukken = g.stukken;
  const eind = duur > 0 ? duur : stukken.at(-1).van + 60;
  const alle = stukken.map((s, i) => ({
    bpm: s.bpm,
    lengte: Math.max(0, (i + 1 < stukken.length ? stukken[i + 1].van : eind) - s.van),
    zeker: soortZekerheid(s.zekerheid, g.slot) === 'zeker',
  })).filter((x) => x.lengte > 0);
  if (!alle.length) return stukken[0].bpm.toFixed(1);
  const zeker = alle.filter((x) => x.zeker);
  const tempos = groepeerTempos(zeker.length ? zeker : alle);
  const [hoofd, ...rest] = tempos;
  const totaal = tempos.reduce((a, t) => a + t.lengte, 0);
  const tweede = rest.find((t) => t.lengte / totaal >= BPM_TWEEDE_AANDEEL && !familie(t.bpm, hoofd.bpm));
  if (tweede) return `${hoofd.bpm.toFixed(0)} / ${tweede.bpm.toFixed(0)}`;
  const drift = hoofd.stukken.some((b) => Math.abs(b / hoofd.bpm - 1) > BPM_DRIFT);
  return (drift ? '~' : '') + hoofd.bpm.toFixed(1) + (zeker.length ? '' : '?');
}

/** Stukken in groepen van hetzelfde tempo (binnen BPM_ZELFDE van de langste), langste groep eerst. */
function groepeerTempos(stukken) {
  const groepen = [];
  for (const s of [...stukken].sort((a, b) => b.lengte - a.lengte)) {
    const g = groepen.find((x) => Math.abs(s.bpm / x.eerste - 1) <= BPM_ZELFDE);
    if (g) { g.som += s.bpm * s.lengte; g.lengte += s.lengte; g.stukken.push(s.bpm); }
    else groepen.push({ eerste: s.bpm, som: s.bpm * s.lengte, lengte: s.lengte, stukken: [s.bpm] });
  }
  return groepen.map((g) => ({ bpm: g.som / g.lengte, lengte: g.lengte, stukken: g.stukken }))
    .sort((a, b) => b.lengte - a.lengte);
}

function familie(a, b) {
  const r = Math.max(a, b) / Math.min(a, b);
  return FAMILIE.some((k) => Math.abs(r / k - 1) <= BPM_ZELFDE);
}

export const STATUS_TEKST = {
  slot: '✓ slot', zeker: 'auto zeker', onzeker: 'auto onzeker', geenpuls: 'geen puls', hand: 'met de hand', geen: 'geen grid',
};

export { soortZekerheid };
