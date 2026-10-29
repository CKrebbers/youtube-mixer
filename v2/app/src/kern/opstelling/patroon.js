/**
 * Patronen uit een zaad, in het formaat van kern/patronen/model.js (stap, noot, snelheid, duur, micro).
 * Ideeën uit de inventaris van 29 okt: euclidisch ritme met rotatie (elektronlearn, Strata),
 * loops van ongelijke lengte (Eno, Uurwerk), harmonie als functie van de plek en het zaad (Sediment
 * Scripter). Puur: dezelfde invoer = hetzelfde patroon.
 */
import { stroom } from './zaad.js';

/** Bjorklund-achtig: k slagen zo gelijk mogelijk over n stappen, gedraaid met rot. */
export function euclid(k, n, rot = 0) {
  const kk = Math.max(0, Math.min(n, Math.round(k)));
  // Stap i is een slag als (i·k) mod n < k: k slagen, zo gelijk mogelijk verdeeld, de eerste op 0.
  return Array.from({ length: n }, (_, i) => ((((i + rot) % n) * kk) % n < kk ? 1 : 0));
}

/** Drumnoten (audio/instrumenten/drums.js KIT): pad 1 = 36. */
export const DRUM = Object.freeze({ kick: 36, snare: 37, clap: 38, hat: 39, tom: 40, rim: 41, bas: 42, open: 43 });

/** Toonladders als halve tonen vanaf de grondtoon. */
export const LADDERS = Object.freeze({
  mineur: [0, 2, 3, 5, 7, 8, 10], majeur: [0, 2, 4, 5, 7, 9, 11],
  dorisch: [0, 2, 3, 5, 7, 9, 10], penta: [0, 3, 5, 7, 10], frygisch: [0, 1, 3, 5, 7, 8, 10],
});

/** Sleutel 0..23 (planner.leesToon: 12..23 = mineur) -> { grond (MIDI, octaaf 3), ladder }. */
export function toonVan(k, r) {
  const sleutel = Number.isInteger(k) && k >= 0 && k < 24 ? k : r.geheel(0, 23);
  const mineur = sleutel >= 12;
  const ladder = mineur ? r.kies(['mineur', 'dorisch', 'penta', 'frygisch']) : r.kies(['majeur', 'penta']);
  return { sleutel, grond: 48 + (sleutel % 12), ladder };
}

const noot = (toon, graad, octaaf = 0) => {
  const l = LADDERS[toon.ladder];
  const o = Math.floor(graad / l.length);
  return toon.grond + l[((graad % l.length) + l.length) % l.length] + 12 * (o + octaaf);
};

/**
 * Een patroon maken. `p` = het patroon uit het recept ({ soort, dichtheid: [lo, hi], lengte: [..] }).
 * @returns { patroon: { naam, lengte, deling, swing, noten }, uitleg }
 */
export function maakPatroon(p, zaad, { n = 1, toon = null } = {}) {
  const r = stroom(zaad, 'patroon', n, p.soort);
  const lengte = r.kies(p.lengte) ?? 16;
  const d = r.tussen(p.dichtheid[0], p.dichtheid[1]);
  const noten = [];
  const zet = (stap, nt, snelheid, duur = 1) => noten.push({ stap, noot: nt, snelheid: Math.round(snelheid * 100) / 100, duur, micro: 0 });
  let uitleg = '';
  if (p.soort === 'drums') {
    const kicks = euclid(Math.max(2, Math.round(lengte / 4 * (0.6 + d))), lengte, r.kans(0.3) ? r.geheel(1, 3) : 0);
    kicks.forEach((x, i) => { if (x) zet(i, DRUM.kick, i % 4 === 0 ? 1 : 0.8); });
    const backbeat = r.kies([DRUM.snare, DRUM.clap, DRUM.rim]);
    for (let i = 4; i < lengte; i += 8) zet(i, backbeat, 0.9);
    const hats = euclid(Math.round(lengte * (0.25 + d * 0.6)), lengte, r.geheel(0, 3));
    hats.forEach((x, i) => { if (x) zet(i, r.kans(0.12) ? DRUM.open : DRUM.hat, 0.45 + r.r() * 0.35); });
    if (d > 0.5) { const t = euclid(r.geheel(1, 3), lengte, r.geheel(0, lengte - 1)); t.forEach((x, i) => { if (x) zet(i, r.kies([DRUM.tom, DRUM.bas]), 0.6); }); }
    uitleg = `kick ${kicks.filter(Boolean).length}/${lengte}`;
  } else if (toon) {
    if (p.soort === 'bas') {
      const slagen = euclid(Math.max(2, Math.round(lengte * (0.15 + d * 0.45))), lengte, r.geheel(0, 2));
      let graad = 0;
      slagen.forEach((x, i) => { if (!x) return; if (r.kans(0.35)) graad = r.kies([0, 0, 2, 4, -3, 5]); zet(i, noot(toon, graad, -1), 0.85, r.kies([1, 1, 2])); });
      uitleg = `bas in ${toon.ladder}`;
    } else if (p.soort === 'lijn') {
      // Een wandeling over de ladder; een herhaling van de eerste helft houdt hem herkenbaar.
      const helft = Math.max(4, lengte / 2);
      let graad = r.geheel(0, 4);
      const eerste = [];
      for (let i = 0; i < helft; i++) {
        if (!r.kans(0.25 + d * 0.6)) { eerste.push(null); continue; }
        graad += r.kies([-2, -1, -1, 1, 1, 2, 3]);
        graad = Math.max(-3, Math.min(9, graad));
        eerste.push(graad);
      }
      for (let i = 0; i < lengte; i++) {
        const g = i < helft ? eerste[i] : (r.kans(0.7) ? eerste[i - helft] : (eerste[i - helft] === null ? null : eerste[i - helft] + r.kies([-1, 1, 2])));
        if (g !== null && g !== undefined) zet(i, noot(toon, g, 1), 0.55 + r.r() * 0.35);
      }
      uitleg = `lijn in ${toon.ladder}`;
    } else {
      // Akkoorden: één per maat (vier tellen = 16 stappen), graad uit een kleine reeks.
      const reeks = r.kies([[0, 5, 3, 4], [0, 3, 5, 4], [0, 4, 5, 3], [0, 0, 5, 3], [0, 2, 5, 4]]);
      for (let m = 0; m * 16 < lengte; m++) {
        const g = reeks[m % reeks.length];
        for (const s of [0, 2, 4]) zet(m * 16, noot(toon, g + s, 0), 0.6, Math.min(16, lengte - m * 16));
      }
      uitleg = `akkoorden in ${toon.ladder}`;
    }
  }
  return { patroon: { naam: `${p.soort} ${zaad % 1000}`, lengte, deling: 4, swing: 50 + Math.round(r.r() * 8), noten }, uitleg };
}
