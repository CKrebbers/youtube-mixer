// Hoe goed is een grid, gemeten aan de ECHTE tellen van een synthetisch nummer
// (nummers.mjs). Puur. De ergste fout is VALS ZEKER: het grid zegt zeker (sync
// en beat-loops mogen) en ligt er naast. Die wordt op de tijd gemeten, over het
// hele nummer, ook waar geen duidelijke puls is (een break, een intro, ambient).
import { Beatgrid } from '../../../src/engine/beatgrid.js';
import { octaafVan } from './nummers.mjs';

const binnen = (t, gebieden) => gebieden.some(([a, b]) => t >= a && t < b);
const mediaan = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Index van de echte tel het dichtst bij t (T gesorteerd). */
function dichtst(T, t) {
  let lo = 0, hi = T.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; }
  return lo > 0 && Math.abs(T[lo - 1] - t) < Math.abs(T[lo] - t) ? lo - 1 : lo;
}
/** De lengte van tel i (s). */
const lengte = (T, i) => (i + 1 < T.length ? T[i + 1] - T[i] : T[i] - T[i - 1]);

/**
 * Ligt de dichtstbijzijnde gridlijn op een tel (of, bij een grid op het dubbele
 * tempo, op een halve tel)? Geeft de afstand in s, of null als het octaaf niet klopt.
 * r = echt tempo / grid-tempo (2 = het grid telt de helft, ½ = het dubbele).
 */
function faseFout(grid, T, i, r) {
  const t = T[i];
  if (r >= 1) {
    // Het grid is even fijn of grover: de lijn het dichtst bij de tel, met (bij r = 2) halve gridtellen erbij.
    const s = Math.round(r);
    const k = Math.round(grid.beatAt(t) * s) / s;
    return t - grid.timeOf(k);
  }
  // Fijner grid: de lijn bij de tel, elke tel moet een lijn hebben.
  return t - grid.timeOf(Math.round(grid.beatAt(t)));
}

/**
 * @param {object} gridJson  het grid (zoals bewaard: stukken, beatsPerBar, ...)
 * @param {object} n         een nummer uit nummers.mjs
 * @returns {object} de maten (aandelen 0..1, tijden in ms of s)
 */
export function scoor(gridJson, n) {
  const g = new Beatgrid(gridJson);
  const T = n.tellen;
  const uit = { stukken: g.aantalStukken };

  // ---- op de tellen waar de puls duidelijk is --------------------------------
  let nMeet = 0, zeker = 0, goed = 0, oct = 0, dj = 0, naast = 0;
  const fouten = [];
  T.forEach((t, i) => {
    if (!binnen(t, n.meet)) return;
    nMeet++;
    const L = lengte(T, i);
    const r = (60 / L) / g.bpmAt(t);
    const o = octaafVan(r, 0.02);
    if (g.zekerBij(t)) zeker++;
    if (o === 1) goed++; else if (o === 2 || o === 0.5) oct++;
    // Het DJ-tempo is n.dj × de tellen: grid = dj · echt, dus r · dj = 1.
    if (octaafVan(r * n.dj, 0.02) === 1) dj++;
    if (o === 1 || o === 2 || o === 0.5) {
      const e = faseFout(g, T, i, r);
      fouten.push(Math.abs(e));
      if (Math.abs(e) > 0.1 * L) naast++;
    } else naast++;
  });
  uit.tellen = nMeet;
  uit.dekking = nMeet ? zeker / nMeet : null;           // deel van de duidelijke tellen waar het grid zeker is
  uit.tempo = nMeet ? goed / nMeet : null;              // tempo goed (het echte octaaf)
  uit.octaaf = nMeet ? oct / nMeet : null;              // een octaaf ernaast (½ of 2)
  uit.dj = nMeet ? dj / nMeet : null;                   // op het DJ-tempo (n.dj × de tellen)
  uit.faseMs = fouten.length ? mediaan(fouten) * 1000 : null;
  uit.naast = nMeet ? naast / nMeet : null;             // tel > 0,1 tel naast een gridlijn (of het tempo klopt niet)

  // ---- de "1" ---------------------------------------------------------------
  let nEen = 0, eenOk = 0;
  for (const d of n.eenen) {
    if (!binnen(d, n.meet)) continue;
    const i = dichtst(T, d);
    const r = (60 / lengte(T, i)) / g.bpmAt(d);
    const o = octaafVan(r, 0.02);
    if (o !== 1 && o !== 0.5) continue;               // bij een grover grid valt de helft van de "1"-en tussen zijn maten
    nEen++;
    const k = Math.round(g.beatAt(d));
    if (Math.abs(d - g.timeOf(k)) < 0.1 * lengte(T, i) && g.isMaatbegin(k)) eenOk++;
  }
  uit.een = nEen ? eenOk / nEen : null;

  // ---- vals zeker, op de tijd over het hele nummer ---------------------------
  const STAP = 0.25;
  let zt = 0, vals = 0, zekerOct = 0;
  for (let t = 0; t < n.duur; t += STAP) {
    if (!g.zekerBij(t)) continue;
    zt++;
    if (!binnen(t, n.puls) || !T.length) { vals++; continue; }
    // De gridlijn het dichtst bij t, tegen de echte tellen daar.
    const lijn = g.nearest(t);
    const i = dichtst(T, lijn);
    const L = lengte(T, i);
    const r = (60 / L) / g.bpmAt(t);
    const o = octaafVan(r, 0.03);
    if (o === null || o === 4 || o === 0.25) { vals++; continue; }
    if (o !== 1) zekerOct++;
    // Een fijner grid (o = ½) mag op een halve tel vallen; anders op een tel.
    const fijn = o === 0.5 ? 2 : 1;
    const j = Math.round((lijn - T[i]) / L * fijn) / fijn;
    const e = lijn - (T[i] + j * L);
    if (Math.abs(e) > 0.1 * L) vals++;
  }
  uit.zekerSec = zt * STAP;
  uit.vals = zt ? vals / zt : 0;                         // deel van de zekere tijd waar het grid naast ligt
  uit.valsSec = vals * STAP;
  uit.zekerOctaaf = zt ? zekerOct / zt : 0;              // deel van de zekere tijd op een ander octaaf
  // VALS ZEKER als meer dan 2% van de zekere tijd (en minstens 2 s) fout is.
  uit.valsZeker = uit.vals > 0.02 && uit.valsSec >= 2;

  // ---- grenzen ---------------------------------------------------------------
  if (n.wissels.length) {
    const vans = g.stukken.map((s) => s.van);
    uit.grens = Math.max(...n.wissels.map((w) => Math.min(...vans.map((v) => Math.abs(v - w)))));
  }
  return uit;
}
