/**
 * Laten lopen: van een opstelling een heel nummer maken. Puur: opstelling + zaad = een VERLOOP,
 * een rij delen (intro, opbouw, vol, breuk, vol, uitloop) met per maat welke sporen klinken en op
 * welke rij van de partituur (1 rustig … 5 vol; 0 = uit). Elk zaad een andere vorm: lengtes, wie er
 * begint, in welke volgorde de sporen erbij komen, of er een tweede opbouw is.
 *
 *   verloop = { delen: [{ naam, maten, scene (1..8 of null), stand(maat) -> { n: rij } }], maten }
 *   standOp(verloop, maat) -> { deel, i (deel), m (maat in het deel), sporen: { n: rij } } of null (voorbij het eind)
 *
 * De engine (acties-opstelling.js) zet het om in wisselingen op de maat; wat jij zelf aanraakt gaat
 * voor tot het volgende deel.
 */
import { stroom } from './zaad.js';

/** Welke scene van het recept bij een deel hoort: op naam, anders op plek (rust 1 … uitloop 5). */
const SCENE_NAMEN = {
  intro: ['rust', 'kaal', 'stof', 'a capella', 'stil'],
  opbouw: ['opbouw', 'groef', 'zee', 'ritme'],
  vol: ['vol', 'alles', 'storm'],
  breuk: ['breuk', 'zweef', 'onder water', 'geest', 'nummer'],
  uitloop: ['uitloop', 'stil', 'rust', 'kaal'],
};
const SCENE_PLEK = { intro: 1, opbouw: 2, vol: 3, breuk: 4, uitloop: 5 };
const soortVan = (naam) => naam.replace(/\d+$/, '');

export function sceneVoor(scenes, naam) {
  const soort = soortVan(naam);
  const i = (scenes ?? []).findIndex((s) => SCENE_NAMEN[soort]?.includes(s.naam ?? s));
  if (i >= 0) return i + 1;
  const p = SCENE_PLEK[soort];
  return p && p <= (scenes?.length ?? 0) ? p : null;
}

export function maakVerloop(o, zaad = o?.zaad ?? 1) {
  const r = stroom(zaad, o?.recept ?? 'verloop', 'verloop');
  const sporen = (o?.sporen ?? []).map((s) => s.n);
  if (!sporen.length) return { delen: [], maten: 0 };
  // Wie begint: liefst een nummer, een korrelwolk of iets met akkoorden; drums komen later.
  const rustig = (n) => {
    const s = o.sporen.find((x) => x.n === n);
    const p = o.patronen?.find((x) => x.n === n)?.uitleg ?? '';
    return s.soort === 'nummer' ? 3 : s.instrument === 'korrel' || s.instrument === 'schaal' || /akkoord/.test(p) ? 2 : s.instrument === 'drums' ? 0 : 1;
  };
  const volgorde = r.schud(sporen).sort((a, b) => rustig(b) - rustig(a));
  const begin = volgorde.slice(0, Math.min(sporen.length, r.kans(0.5) ? 1 : 2));
  const erbij = volgorde.slice(begin.length);
  const L = (a, b) => r.kies([a, b]);
  const vol = (m) => Object.fromEntries(sporen.map((n) => [n, m % 8 < 4 ? 4 : 5]));
  const delen = [];
  delen.push({ naam: 'intro', maten: L(8, 16), stand: () => Object.fromEntries(sporen.map((n) => [n, begin.includes(n) ? 1 : 0])) });
  const opbouw = (naam, maten) => ({
    naam, maten,
    stand: (m) => {
      // Om de paar maten een spoor erbij (gelijk verdeeld over het deel), en wie er al is groeit mee.
      const per = Math.max(1, Math.floor(maten / Math.max(1, erbij.length + 1)));
      const al = erbij.slice(0, Math.min(erbij.length, Math.floor(m / per) + 1));
      const rij = m < maten / 2 ? 2 : 3;
      return Object.fromEntries(sporen.map((n) => [n, begin.includes(n) ? rij : al.includes(n) ? Math.max(1, rij - 1) : 0]));
    },
  });
  delen.push(opbouw('opbouw', L(8, 16)));
  delen.push({ naam: 'vol', maten: 16, stand: vol });
  const kaal = r.kies(volgorde.filter((n) => rustig(n) > 0).length ? volgorde.filter((n) => rustig(n) > 0) : volgorde);
  // De breuk: één spoor blijft, en de laatste maat is leeg (de spanning vóór de terugkeer).
  delen.push({ naam: 'breuk', maten: 8, stand: (m, maten = 8) => Object.fromEntries(sporen.map((n) => [n, m === maten - 1 ? 0 : n === kaal ? 2 : 0])) });
  if (r.kans(0.35)) delen.push(opbouw('opbouw2', 8));
  delen.push({ naam: 'vol2', maten: 16, stand: () => Object.fromEntries(sporen.map((n) => [n, 5])) });
  // De uitloop: één voor één eruit, in de omgekeerde volgorde van binnenkomen.
  const eruit = [...volgorde].reverse();
  delen.push({
    naam: 'uitloop', maten: L(8, 16),
    stand: (m, maten) => {
      const per = Math.max(1, Math.floor(maten / sporen.length));
      const weg = eruit.slice(0, Math.min(sporen.length, Math.floor(m / per)));
      return Object.fromEntries(sporen.map((n) => [n, weg.includes(n) ? 0 : 1]));
    },
  });
  for (const d of delen) d.scene = sceneVoor(o.scenes, d.naam);
  return { delen, maten: delen.reduce((a, d) => a + d.maten, 0) };
}

/** Waar het verloop op maat `maat` (0 = de eerste) is, en wat er dan klinkt. */
export function standOp(v, maat) {
  if (!(maat >= 0)) return null;
  let m = maat;
  for (let i = 0; i < v.delen.length; i++) {
    const d = v.delen[i];
    if (m < d.maten) return { deel: d, i, m, sporen: d.stand(m, d.maten) };
    m -= d.maten;
  }
  return null;
}
