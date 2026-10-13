import { kenmerken, fragment, tempoAfwijking, camelotAfstand, TEMPO_MAX } from '../auto/planner.js';
import { transponeer, kortNaam, camelot } from '../engine/toonsoort.js';

/**
 * "Past bij" in de library (13 okt, Clay): welke nummers mixen goed of bijna goed
 * met het nummer op de focus-track. Dezelfde regels als de bewakers van de auto-DJ
 * (`kiesOvergang` in planner.js): beide grids zeker, tempo ≤ TEMPO_MAX (6%) en de
 * toon na het gelijkzetten van het tempo (zonder keylock schuift die mee) hooguit
 * één stap op het Camelot-wiel. Puur: geen DOM, geen fetch.
 *
 *   goed   tempo ≤ 6%, toon ≤ 1 stap
 *   bijna  tempo ≤ 6% en toon 2 stappen (keylock en ±1 transponeren),
 *          of tempo 6–10% met toon ≤ 1 (ver pitchen, keylock aan),
 *          of half/dubbel tempo (≤ 6%) met toon ≤ 1
 *
 * De toon telt ook als hij gegokt is (bijna de hele library is "onzeker"); dat staat
 * er dan bij (`toonGegokt`). Het tempo telt alleen op een zeker grid.
 */

/** Tot hoever "bijna" nog meegaat: zoveel pitch is met keylock nog bruikbaar. */
export const TEMPO_BIJNA = 0.10;
/** Zo ver vóór het eind van zijn fragment meet je de uitgaande als je niet weet waar hij is. */
export const VOOR_EIND = 30;

/**
 * @param huidig  het nummer op de focus-track, zoals /api/library het geeft ({ id, grid, toon, duur })
 * @param tracks  de library
 * @param t       tracktijd van wat je nu hoort; null = vlak voor het eind van zijn fragment
 * @returns { lijst: [{ track, soort, tempo, stappen, half, toonGegokt, bpm, toon, waarom }], reden, uit }
 *          lijst gesorteerd: goed vóór bijna, dan het kleinste verschil; reden = waarom de lijst leeg is
 */
export function pastBij(huidig, tracks, { t = null } = {}) {
  if (!huidig?.grid) return { lijst: [], reden: 'dit nummer heeft geen grid', uit: null };
  const tUit = Number.isFinite(t) ? t : (() => { const f = fragment(huidig, { rnd: () => 0.5 }); return Math.max(f.van, f.tot - VOOR_EIND); })();
  let uit = kenmerken(huidig, tUit);
  // Onzeker op dat punt (een intro of outro zonder beat): dan het midden van het langste zekere stuk.
  if (!uit.gridZeker) {
    const elders = zekerMidden(uit.grid, huidig.duur);
    if (elders !== null) uit = { ...kenmerken(huidig, elders), elders: true };
  }
  if (!uit.gridZeker || !(uit.bpm > 0)) return { lijst: [], reden: 'het grid is nergens zeker: tik het tempo of zet het grid op slot', uit };
  const lijst = [];
  for (const track of tracks) {
    if (!track?.grid || track.id === huidig.id || track.audio === false) continue;
    const f = fragment(track, { rnd: () => 0.5 });
    const inn = kenmerken(track, f.van);
    if (!inn.gridZeker || !(inn.bpm > 0)) continue;
    const r = beoordeel(uit, inn);
    if (r) lijst.push({ track, ...r, bpm: inn.bpm, toon: Number.isInteger(inn.k) ? `${kortNaam(inn.k)} ${camelot(inn.k)}` : null });
  }
  lijst.sort((a, b) => a.score - b.score);
  return { lijst, reden: lijst.length ? null : 'niets in de library past (tempo binnen 10% en toon dichtbij)', uit };
}

/** Het midden van het langste zekere stuk van een grid, of null. */
function zekerMidden(grid, duur) {
  const st = grid?.stukken ?? [];
  const eind = duur > 0 ? duur : (st.at(-1)?.van ?? 0) + 60;
  let beste = null, lengte = 0;
  st.forEach((s, i) => {
    const tot = i + 1 < st.length ? st[i + 1].van : eind;
    const midden = (s.van + tot) / 2;
    if (tot - s.van > lengte && grid.zekerBij(midden)) { lengte = tot - s.van; beste = midden; }
  });
  return beste;
}

/** Eén paar: uitgaande → inkomende (kenmerken uit planner.js). null = past niet. */
export function beoordeel(uit, inn) {
  const ta = tempoAfwijking(uit.bpm, inn.bpm);
  if (ta === null) return null;
  // Half of dubbel tempo: de inkomende op ×2 of ×½ telt, als dat dichterbij ligt.
  const factor = [1, 2, 0.5].reduce((best, k) => (Math.abs(inn.bpm * k / uit.bpm - 1) < Math.abs(inn.bpm * best / uit.bpm - 1) ? k : best), 1);
  const half = factor !== 1 && ta > TEMPO_BIJNA;
  const tempo = half ? Math.abs(inn.bpm * factor / uit.bpm - 1) : ta;
  if (tempo > (half ? TEMPO_MAX : TEMPO_BIJNA)) return null;
  // Toon NA de sync, zoals kiesOvergang: zonder keylock schuift de toon mee met het tempo.
  const verschuiving = tempo <= TEMPO_MAX ? 12 * Math.log2(uit.bpm / (inn.bpm * (half ? factor : 1))) : 0;
  const kIn = Number.isInteger(inn.k) ? transponeer(inn.k, verschuiving) : null;
  const stappen = Number.isInteger(uit.k) && kIn !== null ? camelotAfstand(uit.k, kIn) : null;
  if (stappen === null) return null;
  const toonGegokt = !(uit.toonZeker && inn.toonZeker);
  let soort = null;
  const waarom = [];
  if (!half && tempo <= TEMPO_MAX && stappen <= 1) soort = 'goed';
  else if (!half && tempo <= TEMPO_MAX && stappen === 2) { soort = 'bijna'; waarom.push('toon 2 stappen: keylock en ±1 transponeren'); }
  else if (!half && tempo <= TEMPO_BIJNA && stappen <= 1) { soort = 'bijna'; waarom.push(`${pct(tempo)} tempo: ver pitchen, keylock aan`); }
  else if (half && stappen <= 1) { soort = 'bijna'; waarom.push('half/dubbel tempo'); }
  if (!soort) return null;
  if (soort === 'goed') waarom.push(stappen === 0 ? 'zelfde toon' : 'toon naast elkaar');
  if (toonGegokt) waarom.push('toon gegokt');
  const score = (soort === 'goed' ? 0 : 10) + tempo * 20 + stappen + (toonGegokt ? 0.5 : 0);
  return { soort, tempo, stappen, half, toonGegokt, waarom: waarom.join(' · '), score };
}

const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

/** De kop boven de lijst: van welk nummer, en hoeveel er passen. */
export function pastBijKop(huidig, uitkomst, label = '') {
  if (!huidig) return 'geen nummer op de focus-track: laad er eerst een';
  const u = uitkomst.uit;
  const wat = [u?.bpm ? `${u.bpm.toFixed(1)} bpm` : null, Number.isInteger(u?.k) ? `${kortNaam(u.k)} ${camelot(u.k)}${u.toonZeker ? '' : '?'}` : null].filter(Boolean).join(' · ');
  const goed = uitkomst.lijst.filter((x) => x.soort === 'goed').length;
  const bijna = uitkomst.lijst.length - goed;
  return `past bij "${huidig.titel}"${label ? ` (track ${label})` : ''}${wat ? `, ${wat}` : ''}${u?.elders ? ' (gemeten op het zekere deel)' : ''}: `
    + (uitkomst.reden ?? `${goed} goed, ${bijna} bijna`);
}

/** Het tempoverschil als tekst voor in de rij. */
export const tempoTekst = (r) => (r.tempo < 0.0005 ? 'gelijk' : pct(r.tempo)) + (r.half ? ' (½/2×)' : '');
