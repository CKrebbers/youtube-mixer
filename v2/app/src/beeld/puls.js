// Herkomst: v1 youtube-mixer/src/video/puls.js @ 039b372 (pulsVorm, PULS_DOELEN, metPuls). Anders in v2:
// de tel komt van de MAATKLOK (engine.klok) zoals je hem hoort, niet meer van een maatgever-track, en
// metPuls schrijft in een vast object (oogst beeld-077: geen nieuw fx-object per beeld).
/**
 * Video-effecten op de tel. Puur rekenwerk: geen DOM, geen WebGL.
 *
 * De maat komt van de klok (ARCHITECTUUR uitgangspunt 1: alles wat op de maat loopt leest de klok),
 * op het moment dat je hem HOORT: klok.tel(nu − uitgangsvertraging). De puls komt bovenop de stand
 * van de knop: RGB op 30% springt op de tel omhoog en zakt terug naar 30%. Knop, lampje en ring
 * bewegen niet mee (de knopstand verandert niet).
 */

/** Wat er kan pulsen. "flits" is geen effectknop maar een lichtflits op de tel (in de effectstap). */
export const PULS_DOELEN = ['rgb', 'pixel', 'spiegel', 'korrel', 'flits'];

/**
 * De vorm van één tel: vol op de tel, dan snel uitdoven. Op een halve tel is er nog 8% over;
 * zo blijft het een klap en geen golf.
 * @param fase 0..1 binnen de tel
 */
export const pulsVorm = (fase) => Math.exp(-5 * Math.max(0, Math.min(1, fase)));

/**
 * De fase in de tel van de klok zoals je hem hoort, of null als de klok niet loopt.
 * `klok` duck-typed: { loopt, tel(t) }.
 */
export function klokFase(klok, nu, V = 0) {
  if (!klok?.loopt) return null;
  const c = klok.tel(nu - V);
  if (!Number.isFinite(c)) return null;
  return c - Math.floor(c);
}

/** De pulsvorm op de klok (0 als de klok niet loopt). Meet niet PRECIES op de tel (oogst beeld-018). */
export function klokPuls(klok, nu, V = 0) {
  const f = klokFase(klok, nu, V);
  return f === null ? 0 : pulsVorm(f);
}

/**
 * De effectstanden met de puls erbovenop, in `uit` (een object met dezelfde sleutels als fx).
 * `accent` (0..1): vol slaan, wat de diepte ook is (in v1 een nieuwe sectie; v2 heeft nog geen
 * sectiekaart, de parameter blijft voor later). Alleen met de puls aan (diepte 0 = uit).
 * @returns `uit`, met uit.flits = de lichtflits op de tel (0 als het doel geen flits is)
 */
export function metPuls(fx, doel, diepte, vorm, accent = 0, uit = {}) {
  for (const k in fx) uit[k] = fx[k];
  uit.flits = 0;
  const d = Math.max(0, Math.min(1, diepte));
  const extra = d > 0 ? Math.max(d * vorm, accent > 0 ? Math.min(1, accent) : 0) : 0;
  if (doel === 'flits') { uit.flits = extra; return uit; }
  if (doel in fx) uit[doel] = Math.min(1, fx[doel] + extra);
  return uit;
}
