/**
 * Hoe een gekoppeld nummer aan de klok vastzit (ontwerp klok-B04, klok-B11).
 *
 *   tel van het nummer  = klok.tel(t) + v          (v = de verschuiving, in tellen)
 *   plek in het nummer  = grid.timeOf(tel van het nummer)
 *
 * Beide stappen zijn stuksgewijs recht: de klok per segment, het grid per deel
 * van zijn tempokaart. Hun samenstelling is dus ook stuksgewijs recht, en elk
 * stuk is precies één segment { T, P, R } voor de afspeelmotor: vanaf T staat
 * de plek op P en loopt hij R seconden nummer per seconde audioklok. De motor
 * hoeft niets van tellen te weten, en regel 3 blijft heel.
 *
 * Een jog of nudge verandert alleen v (klok-B03, klok-B15). Puur rekenwerk.
 */

const EPS = 1e-9;

/**
 * Segmenten van een gekoppeld nummer tussen audiokloktijd `van` en `tot`.
 * Het laatste segment loopt door voorbij `tot` (de motor speelt het verder).
 * @returns {{ T: number, P: number, R: number }[]}
 */
export function segmenten(klok, grid, v, van, tot) {
  // Breekpunten in tijd: begin van elk kloksegment en elke grens van het grid.
  const tijden = new Set([van]);
  for (const s of klok.segmentenTussen(van, tot)) if (s.T > van && s.T < tot) tijden.add(s.T);
  const cVan = klok.tel(van) + v, cTot = klok.tel(tot) + v;
  for (const { b } of grid.telGrenzen()) {
    if (b > cVan + EPS && b < cTot - EPS) tijden.add(klok.tijd(b - v));
  }
  const lijst = [...tijden].sort((a, b) => a - b);
  const uit = [];
  for (const T of lijst) uit.push({ T, P: grid.timeOf(klok.tel(T) + v), R: rateOp(klok, grid, v, T) });
  return uit;
}

/**
 * Seconden nummer per seconde audioklok op t, exact: tellen per seconde van de klok maal
 * seconden per tel van het grid, allebei rechts-continu (op een grens geldt het nieuwe stuk).
 * Geen numerieke afgeleide: die week ~1e-9 tel af en nam bij het laatste stuk de rate van
 * een halve seconde later (modeltest K6, K7).
 */
export function rateOp(klok, grid, v, t) {
  return klok.rate(t) * grid.lengteBijTel(klok.tel(t) + v + 1e-9);
}

/**
 * Koppelen zonder hoorbare sprong (klok-B07): het nummer gaat naar de
 * dichtstbijzijnde tel van de klok. De sprong is hooguit een halve tel.
 * @param t audiokloktijd van het koppelen, P plek in het nummer op t
 */
export function verschuivingBijKoppelen(klok, grid, t, P) {
  return Math.round(grid.beatAt(P) - klok.tel(t));
}

/**
 * De "1" van het nummer op een "1" van de klok, zo dicht mogelijk bij waar het
 * nu is (kan tot een halve maat springen: alleen op verzoek, klok-O2).
 */
export function verschuivingOpMaat(klok, grid, t, P) {
  const per = klok.perMaat;
  const b = grid.beatAt(P);
  const m = b - grid.barPhase(P) * per;          // een tel 1 van het nummer
  return m + per * Math.round((b - klok.tel(t) - m) / per);
}

/** Na een bend of jog: de plek van nu is de waarheid, v volgt daaruit (fractie mag). */
export function verschuivingUitPlek(klok, grid, t, P) {
  return grid.beatAt(P) - klok.tel(t);
}

/** Hoeveel tellen het nummer voor (+) of achter (−) de klok ligt, binnen een halve tel. */
export function fase(v) {
  return v - Math.round(v);
}

/** Plek in het nummer van een gekoppeld nummer op audiokloktijd t. */
export function plekOp(klok, grid, v, t) {
  return grid.timeOf(klok.tel(t) + v);
}
