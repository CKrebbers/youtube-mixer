// De berichtenplannen van tools/headless/latentie.mjs, los en puur (test/latentie-plan.test.mjs).
//
// Een plan is een lijst [ms, status, data1, data2] die de Worker in de pagina op tijd verstuurt
// (status 0 = alleen een ping: meet de wacht, raakt niets). APC40 mkII in 0x42 (devices/apc40mk2.js):
// kanaalfader = cc 7 op het kanaal van de strip, track knob = cc 48–55 (kanaal 0), device knob =
// cc 16–23, crossfader cc 15, shift = noot 98, scene 1–5 = noot 82–86, pads noot 0–39.
//
// JITTER (review ronde 1, 14 okt): een vast rooster (i * 1000 / perS) houdt de fase ten opzichte van
// rAF een hele ronde gelijk, dus de p50 per ronde sprong mee met waar het rooster toevallig viel
// (identieke code gaf fader-p50 0,45 en 5,3 ms). Nu krijgt elke reeks een eigen beginfase (0..1 beeld)
// en elk bericht een eigen verschuiving, uit een PRNG met vast zaad. Hetzelfde zaad = hetzelfde plan,
// dus vóór en na met hetzelfde zaad krijgen exact dezelfde berichten op dezelfde tijden.
// Een stroom (fader, knop, ping; interval ≤ 10 ms) schuift 0..1 interval: zo valt hij binnen ÉÉN ronde
// op elke plek van een beeld (met ½ interval bij 120/s maar op de helft). Knoppen (indrukken en
// loslaten, interval ≥ 62 ms) schuiven 0..½ interval, zodat het loslaten vóór de volgende druk blijft.
// De volgorde per control (en dus welke waarden er aankomen) is dezelfde als zonder jitter.

/** mulberry32: klein, snel, en hetzelfde op elke machine. */
export function prng(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per scenario een eigen reeks uit het zaad: hetzelfde plan, welke scenario's er ook vóór draaiden. */
export const zaadVoor = (zaad, naam) => ((zaad * 0x9e3779b1 + [...naam].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) >>> 0);

export const BEELD_MS = 1000 / 60;

export const UITLEG = {
  rust: 'spelend, niets aanraken (pings van 100/s meten de event-loop)',
  fader: 'één kanaalfader, 120 berichten/s',
  sweep: 'acht kanaalfaders tegelijk, elk 120/s (960/s)',
  ringen: 'acht track knobs (endless, filter), elk 120/s',
  device: 'acht device knobs (strip van de focus), elk 120/s',
  xfader: 'crossfader, 120/s',
  pads: 'hotcue-pads indrukken en loslaten, 16/s',
  shift: 'shift indrukken en loslaten, 8/s, met een fader erdoor (120/s)',
  mapje: 'grid-modus wisselen (scene 1–4 met shift, 4/s) en pads in het mapje',
};

/** Het plan van één scenario. `jitter: false` = het oude vaste rooster (bit voor bit). */
export function maakPlan(naam, { duur = 3000, zaad = 1, jitter = true } = {}) {
  if (!UITLEG[naam]) throw new Error(`onbekend scenario ${naam}`);
  const toeval = prng(zaadVoor(zaad >>> 0, naam));
  const fase = () => (jitter ? toeval() * BEELD_MS : 0);
  const schud = (interval, deel = 1) => (jitter ? toeval() * interval * deel : 0);
  const aantal = (perS) => Math.round(duur * perS / 1000);

  const reeks = (perS, maak) => {
    const uit = [], n = aantal(perS), f0 = fase();
    for (let i = 0; i < n; i++) { const t = f0 + i * 1000 / perS + schud(1000 / perS); for (const b of maak(i)) uit.push([t, ...b]); }
    return uit;
  };
  // Een sweep op en neer (0 -> 127 -> 0 ...), per control verschoven in de tijd en in de fase.
  const sweep = (ks, sig, perS) => {
    const uit = [], n = aantal(perS);
    ks.forEach((k, j) => {
      const f0 = fase();
      for (let i = 0; i < n; i++) {
        const f = (i + j * 7) % 254, v = f < 127 ? f + 1 : 254 - f;
        uit.push([f0 + i * 1000 / perS + j * 1000 / perS / ks.length + schud(1000 / perS), ...sig(k), v]);
      }
    });
    return uit.sort((a, b) => a[0] - b[0]);
  };
  const pads = (noten, perS) => {
    const uit = [], n = aantal(perS), f0 = fase();
    for (let i = 0; i < n; i++) {
      const t = f0 + i * 1000 / perS + schud(1000 / perS, 0.5), nr = noten[i % noten.length];
      uit.push([t, 0x90, nr, 127], [t + 1000 / perS / 2, 0x80, nr, 0]);
    }
    return uit;
  };
  const knop = (nr, perS) => {
    const uit = [], n = aantal(perS), f0 = fase();
    for (let i = 0; i < n; i++) { const t = f0 + i * 1000 / perS + schud(1000 / perS, 0.5); uit.push([t, 0x90, nr, 127], [t + 1000 / perS / 2, 0x80, nr, 0]); }
    return uit;
  };
  const mix = (...plannen) => plannen.flat().sort((a, b) => a[0] - b[0]);
  // Shift + scene 1..4 (secties, patronen, stems, auto) om de beurt, daarna terug naar hotcues (scene 1
  // zonder shift), met tussendoor een pad in het open mapje.
  const mapjes = () => {
    const uit = [], n = aantal(4), f0 = fase();
    for (let i = 0; i < n; i++) {
      const t = f0 + i * 250 + schud(20), scene = 82 + (i % 4);
      uit.push([t, 0x90, 98, 127], [t + 5, 0x90, scene, 127], [t + 30, 0x80, scene, 0], [t + 35, 0x80, 98, 0]);
      uit.push([t + 100, 0x90, 82, 127], [t + 130, 0x80, 82, 0]);   // terug: hotcues
      uit.push([t + 180, 0x90, 32, 127], [t + 210, 0x80, 32, 0]);   // een pad
    }
    return uit;
  };
  const acht = [0, 1, 2, 3, 4, 5, 6, 7];
  switch (naam) {
    case 'rust': return reeks(100, () => [[0, 0, 0]]);
    case 'fader': return sweep([0], (k) => [0xb0 | k, 7], 120);
    case 'sweep': return sweep(acht, (k) => [0xb0 | k, 7], 120);
    case 'ringen': return sweep(acht, (k) => [0xb0, 48 + k], 120);
    case 'device': return sweep(acht, (k) => [0xb0, 16 + k], 120);
    case 'xfader': return sweep([0], () => [0xb0, 15], 120);
    case 'pads': return pads([32, 33, 34, 35], 16);
    case 'shift': return mix(knop(98, 8), sweep([0], (k) => [0xb0 | k, 7], 120));
    case 'mapje': return mapjes();
  }
}
