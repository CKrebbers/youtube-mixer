// Herkomst: v1 youtube-mixer/src/engine/patronen/venster.js @ 6a640ac, ongewijzigd behalve de
// verwijzing naar de klok (in v2 is de maatklok de lijn tussen klok-tellen en de audioklok).
/**
 * Het tijdsraster van de patronen, overgenomen uit Elektronlearn
 * (`src/core/transport.js`, `src/devices/elektron.js`): ticks, swing,
 * microtiming en omlopen, en "welke noten vallen tussen tick a en b". Puur:
 * dezelfde invoer, dezelfde uitvoer, en het draait in Node.
 *
 * Ticks zijn KLOK-ticks: PPQN per tel van de MAATKLOK (src/kern/klok.js: tick =
 * klok.tel(t) × PPQN, en terug klok.tijd(tick / PPQN)). Wanneer een tick klinkt op
 * de audioklok zegt de klok, niet dit bestand; hier staat alleen WELKE noten er in
 * een venster vallen. Zo blijft een patroon in de
 * pas als het tempo onder hem verschuift: de klok vertaalt, de ticks blijven.
 *
 * Een spelend patroon (een "spel") is:
 *   basis   klok-tick waar omloop 0 begint (stap 0)
 *   start   klok-tick vanaf waar het klinkt: niets ervóór (een noot met een
 *           negatieve micro op stap 0 klinkt op de start, niet ervoor)
 *   stop    klok-tick waar het ophoudt (exclusief); Infinity = loopt door
 *
 * Vensters zijn HALFOPEN [van, tot): twee vensters die op elkaar aansluiten
 * leveren elke noot precies één keer, hoe je de grens ook legt (de test legt
 * duizend willekeurige grenzen).
 */

/** Ticks per tel (kwartnoot). 384 = Elektronlearn: deelbaar door 1, 2, 3, 4, 6 en 8. */
export const PPQN = 384;

/** Ticks per stap van dit patroon. */
export const stapTicks = (p) => PPQN / p.deling;
/** Ticks per omloop. */
export const omloopTicks = (p) => p.lengte * stapTicks(p);

/**
 * Swing verschuift de oneven stappen (de off-beats): 50 = recht, 66,67 = een
 * derde stap (triool-gevoel), 75 = een halve stap. Zoals Elektronlearn.
 */
export function swingTicks(stap, swing, st) {
  return stap % 2 === 1 ? ((swing - 50) / 50) * st : 0;
}

/**
 * Alle noten van patroon `p` in het venster [van, tot) van spel `s`,
 * gesorteerd op tick en dan toonhoogte.
 *
 * Elke noot draagt:
 *   tick      waar hij klinkt (klok-ticks, met swing en micro)
 *   nominaal  waar zijn stap ligt (zonder swing en micro): zo is een noot van
 *             een bepaalde omloop te herkennen (opnemen slaat er zo één over)
 *   duur      in ticks
 *   stap, omloop, noot, snelheid
 *
 * Welke omloop: die van zijn STAP. Een noot op stap 0 met een negatieve micro
 * hoort bij zijn eigen omloop, niet bij de vorige; in de eerste omloop klinkt
 * hij op de start. Een noot waarvan de stap vóór de stop ligt maar die door
 * swing of micro op of na de stop zou vallen, valt weg: op de stop gaat alles
 * los (alleUit), en daarna nog een noot beginnen is een noot van een omloop die
 * er niet komt.
 */
export function notenInVenster(p, s, van, tot) {
  const uit = [];
  if (!p || !(tot > van)) return uit;
  const st = stapTicks(p), L = omloopTicks(p);
  const start = s.start ?? s.basis, stop = s.stop ?? Infinity;
  // Eén omloop marge aan beide kanten: swing en micro duwen over de grens.
  const eerste = Math.max(0, Math.floor((van - s.basis) / L) - 1);
  const laatste = Math.floor((tot - s.basis) / L) + 1;
  for (let i = eerste; i <= laatste; i++) {
    const begin = s.basis + i * L;
    for (const n of p.noten) {
      if (n.stap >= p.lengte) continue;
      const nominaal = begin + n.stap * st;
      if (nominaal < start || nominaal >= stop) continue;
      let tick = nominaal + swingTicks(n.stap, p.swing, st) + n.micro * st;
      if (tick < start) tick = start;
      if (tick >= stop || tick < van || tick >= tot) continue;
      uit.push({ tick, nominaal, duur: n.duur * st, stap: n.stap, omloop: i, noot: n.noot, snelheid: n.snelheid });
    }
  }
  return uit.sort((a, b) => a.tick - b.tick || a.noot - b.noot);
}

/**
 * Welke stap klinkt er op klok-tick `t` van spel `s` (0..lengte−1), of null
 * vóór de start. Voor de afspeelkop op het scherm en de Maschine.
 */
export function stapOp(p, s, t) {
  if (!p || !s || t < (s.start ?? s.basis)) return null;
  const st = stapTicks(p), L = omloopTicks(p);
  const pos = (((t - s.basis) % L) + L) % L;
  return Math.min(p.lengte - 1, Math.floor(pos / st + 1e-9));
}
