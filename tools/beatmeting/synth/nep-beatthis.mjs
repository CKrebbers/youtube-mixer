// Tellen ZOALS BEAT THIS! ZE GEEFT, gemaakt uit de echte tellen van een
// synthetisch nummer (nummers.mjs), met de fouten die het netwerk echt maakt.
// Puur, vast zaad. Gemeten aan het echte model (docs/BEATGRID.md §11, 6 okt):
// een tel ligt mediaan ~5 ms naast (frames van 20 ms plus het zwaartepunt), in
// 95% binnen 20-30 ms; op een band zonder klik volgt het de band; op ambient
// geeft het een handvol losse tellen (94 in 42 minuten); het octaaf kiest het
// zelf (77 waar Clay 153 tikt).
//
// Varianten (elke variant = een ander soort fout, bovenop de gewone ruis):
//   bt       de waarschijnlijke uitkomst: σ 6 ms, 3% gemist, 2% extra, 4% van de
//            downbeats een tel verschoven; het octaaf van het nummer (bt.oct);
//   ruis     σ 10 ms, 10% gemist, 6% extra, 15% van de downbeats fout;
//   half     het halve tempo (elke tweede tel), downbeats om de vier van ZIJN tellen;
//   dubbel   het dubbele tempo (een tel ertussen);
//   wissel   het octaaf wisselt halverwege (eerst het hele tempo, dan het halve, wat bt.oct ook is);
//   eenfout  alle downbeats een tel te laat (een consequent verkeerde "1").
export const VARIANTEN = ['bt', 'ruis', 'half', 'dubbel', 'wissel', 'eenfout'];

function rndMet(z) { let s = z >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
const gauss = (rnd) => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.SQRT2; };

/**
 * Elke tweede tel, zo dat de "1"-en blijven. Downbeats om de `per` van de
 * overgebleven tellen, op een echte "1" (een maat van het netwerk is dan
 * twee echte maten: elke tweede echte "1"; bij een oneven maat elke).
 */
function halveer(T, E, per) {
  const een = new Set(E);
  const start = Math.max(0, T.findIndex((t) => een.has(t)));
  const H = T.filter((_, i) => i >= start ? (i - start) % 2 === 0 : (start - i) % 2 === 0);
  const blijft = new Set(H);
  const echt = E.filter((t) => blijft.has(t));
  const D = per % 2 ? echt : echt.filter((_, i) => i % 2 === 0);
  return { T: H, E: D };
}

/**
 * @param {{ tellen: number[], eenen: number[], perMaat: number, bt: { oct: number }, duur: number, naam: string }} nummer
 * @param {string} variant
 * @returns {{ beats: number[], downbeats: number[] }}
 */
export function nepTellen(nummer, variant = 'bt', zaad = 1) {
  const rnd = rndMet(zaad * 7919 + nummer.naam.length * 104729 + VARIANTEN.indexOf(variant) * 31);
  let T = nummer.tellen.slice(), E = nummer.eenen.slice();
  const per = nummer.perMaat;
  const ruis = variant === 'ruis'
    ? { sd: 0.010, mis: 0.10, extra: 0.06, eenFout: 0.15 }
    : { sd: 0.006, mis: 0.03, extra: 0.02, eenFout: 0.04 };

  // Ambient (geen echte tellen): een handvol losse tellen, af en toe een rijtje van 4-6 bijna regelmatige.
  if (!T.length) {
    const B = [];
    for (let t = rnd() * 10; t < nummer.duur; t += 5 + rnd() * 25) {
      if (rnd() < 0.3) { const L = 0.5 + rnd() * 0.4; const n = 4 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) B.push(t + k * L + 0.03 * gauss(rnd)); }
      else B.push(t);
    }
    return { beats: B.filter((t) => t >= 0 && t < nummer.duur).sort((a, b) => a - b), downbeats: [] };
  }

  const oct = variant === 'half' ? 0.5 : variant === 'dubbel' ? 2 : variant === 'wissel' ? 1 : nummer.bt?.oct ?? 1;
  if (oct === 0.5) ({ T, E } = halveer(T, E, per));
  if (oct === 2) {
    const D = [];
    for (let i = 0; i < T.length; i++) { D.push(T[i]); if (i + 1 < T.length) D.push((T[i] + T[i + 1]) / 2); }
    T = D;   // de "1"-en blijven waar ze waren
  }
  if (variant === 'wissel') {
    const mid = nummer.duur / 2;
    const voor = T.filter((t) => t < mid), na = T.filter((t) => t >= mid);
    const h = halveer(na, E.filter((t) => t >= mid), per);
    T = [...voor, ...h.T];
    E = [...E.filter((t) => t < mid), ...h.E];
  }
  if (variant === 'eenfout') {
    const idx = new Map(T.map((t, i) => [t, i]));
    E = E.map((e) => T[(idx.get(e) ?? -1) + 1]).filter((t) => t !== undefined);
  }

  // Downbeats: een paar een tel verschoven of weg (vóór de ruis, op de echte tellen).
  const idx = new Map(T.map((t, i) => [t, i]));
  E = E.flatMap((e) => {
    const r = rnd();
    if (r < ruis.eenFout / 2) return [T[(idx.get(e) ?? 0) + (rnd() < 0.5 ? -1 : 1)]].filter((t) => t !== undefined);
    if (r < ruis.eenFout) return [];
    return [e];
  });
  // Ruis, gemist, extra; een downbeat valt op dezelfde (verschoven) tel.
  const naar = new Map();
  const B = [];
  const L = (i) => (i + 1 < T.length ? T[i + 1] - T[i] : T[i] - T[i - 1]);
  T.forEach((t, i) => {
    if (rnd() < ruis.mis) return;
    const b = t + ruis.sd * gauss(rnd);
    naar.set(t, b);
    B.push(b);
    if (rnd() < ruis.extra) B.push(t + L(i) * (rnd() < 0.6 ? 0.5 : 0.25 + rnd() * 0.5) + ruis.sd * gauss(rnd));
  });
  const D = E.map((e) => naar.get(e)).filter((x) => x !== undefined);
  // Beat This! geeft tijden in hele frames met een zwaartepunt: 5 decimalen (tellen.py).
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  return { beats: B.filter((t) => t >= 0).map(r5).sort((a, b) => a - b), downbeats: D.filter((t) => t >= 0).map(r5).sort((a, b) => a - b) };
}
