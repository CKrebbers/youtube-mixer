// Tap-scenario: 4 of 8 taps met realistische fouten, dan verfijnTempoFase zoals de server
// het doet (marge 3%, ±45 s rond de positie van de laatste tap). Vergeleken met de lokale
// waarheid (verfijning ±10 s met 0,5% marge op een plek waar het fase-spoor stabiel is).
// Variant B: dezelfde zoektocht, maar de fase beperkt tot ±25% periode rond de tap-fase.
// Gebruik: node tap-sim.mjs
import { library, laadOnset, d, fmt, mmss, lees, ROOT } from './lib.mjs';
const { TapTempo } = await import(ROOT + '/src/engine/beatgrid.js');

// [id, positie s, bpm bij benadering, label]
const PLEKKEN = [
  ['f3a7DiCsm8k', 700, 155.96, 'album, stuk 156 (A)'],
  ['f3a7DiCsm8k', 760, 155.96, 'album, stuk 156 (A)'],
  ['f3a7DiCsm8k', 950, 155.96, 'album, stuk 156 (B, andere fase)'],
  ['f3a7DiCsm8k', 1010, 155.96, 'album, stuk 156 (B)'],
  ['HGv_ySHXtYI', 75, 153, 'Bay Ledges, tempo zwalkt'],
  ['HGv_ySHXtYI', 145, 153, 'Bay Ledges'],
  ['mOzW9KQKfzA', 890, 129.3, 'Sakamoto-lijst 129'],
  ['mOzW9KQKfzA', 2190, 120.0, 'Sakamoto-lijst 120'],
  ['mOzW9KQKfzA', 2400, 100.9, 'Sakamoto-lijst 101'],
  ['mOzW9KQKfzA', 2535, 173.2, 'Sakamoto-lijst 173'],
  ['1W1-nPXEVKk', 300, 120, 'zoned out (geen puls)'],
  ['1W1-nPXEVKk', 1500, 120, 'zoned out (geen puls)'],
];
const PROEVEN = 40;

let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/** verfijnTempoFase met optionele fasebeperking (kopie van de serverlogica, alleen voor variant B). */
function verfijnMetFase(env, envRate, bpmStart, tijdOffset, rond, tapTel, { marge = 0.03, straal = 45, faseMarge = 0.25 } = {}) {
  const midden = (rond - tijdOffset) * envRate;
  let van = Math.max(0, Math.floor(midden - straal * envRate));
  const tot = Math.min(env.length, Math.ceil(midden + straal * envRate));
  const scoreVan = (periode, offset) => {
    const aantal = Math.floor((tot - van - 2 - periode) / periode);
    const basis = van + (((offset - van) % periode) + periode) % periode;
    let sc = 0;
    for (let k = 0; k < aantal; k++) sc += lees(env, basis + k * periode);
    return sc / aantal;
  };
  const tapF = (tapTel - tijdOffset) * envRate;
  let beste = { score: -Infinity };
  for (let i = 0; i < 61; i++) {
    const bpm = bpmStart * (1 + marge * (2 * i / 60 - 1));
    const periode = (60 * envRate) / bpm;
    const n = Math.max(16, Math.round(periode * 8));
    for (let k = -n; k <= n; k++) {
      const offset = tapF + (k / n) * faseMarge * periode;
      const sc = scoreVan(periode, offset);
      if (sc > beste.score) beste = { bpm, fase: offset, score: sc };
    }
  }
  const periode = (60 * envRate) / beste.bpm;
  const fase = ((beste.fase % periode) + periode) % periode;
  return { bpm: beste.bpm, firstBeat: fase / envRate + tijdOffset };
}

const telBij = (g, P) => { const p = 60 / g.bpm; return g.firstBeat + Math.round((P - g.firstBeat) / p) * p; };
const faseFout = (g, waar, P) => { // ms, gevouwen op ±halve periode van de waarheid
  const p = 60 / waar.bpm * 1000;
  const x = (telBij(g, P) - telBij(waar, P)) * 1000;
  return x - Math.round(x / p) * p;
};

const tracks = await library();
const totaal = { A: { ok: 0, off: 0, fout: 0 }, B: { ok: 0, off: 0, fout: 0 }, C: { ok: 0, off: 0, fout: 0 }, D: { ok: 0, off: 0, fout: 0 } };
for (const [id, P, bpmBij, label] of PLEKKEN) {
  const t = tracks.find((x) => x.id === id);
  const o = laadOnset(t);
  const waar = d.verfijnTempoFase(o.env, o.envRate, bpmBij, o.tijdOffset, { rond: P, straal: 10, marge: 0.005 });
  const p = 60 / waar.bpm;
  const rij = { 4: { A: [], B: [], C: [], D: [], bpmTap: [], bpmReg: [] }, 8: { A: [], B: [], C: [], D: [], bpmTap: [], bpmReg: [] } };
  for (let proef = 0; proef < PROEVEN; proef++) {
    for (const n of [4, 8]) {
      const tempoFout = (rnd() * 2 - 1) * 0.01;
      const bias = -0.015;                 // mensen tikken iets vóór de tel
      const tap = new TapTempo();
      const eerste = telBij(waar, P - (n - 1) * p);
      let r = null, laatste = 0; const tijden = [];
      for (let k = 0; k < n; k++) {
        const tt = eerste + k * p * (1 + tempoFout) + bias + gauss() * 0.020;
        tijden.push(tt); laatste = tt;
        r = tap.tap(tt * 1000, tt);
      }
      rij[n].bpmTap.push(r.bpm / waar.bpm - 1);
      // Server: marge 3%, rond = positie op het moment van verfijnen (laatste tap)
      const A = d.verfijnTempoFase(o.env, o.envRate, r.bpm, o.tijdOffset, { rond: laatste, marge: 0.03 });
      // Variant B: tap-fase = gemiddelde van de taps teruggerekend naar de laatste tap
      const pt = 60 / r.bpm;
      const gemFase = tijden.reduce((a, tt, k) => a + (tt + (n - 1 - k) * pt), 0) / n;
      const B = verfijnMetFase(o.env, o.envRate, r.bpm, o.tijdOffset, laatste, gemFase);
      // Variant C/D: tempo en fase uit een rechte lijn door de taps (kleinste kwadraten)
      const mx = (n - 1) / 2, my = tijden.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0;
      tijden.forEach((tt, k) => { sxy += (k - mx) * (tt - my); sxx += (k - mx) ** 2; });
      const pReg = sxy / sxx, bpmReg = 60 / pReg, faseReg = my + mx * pReg;
      rij[n].bpmReg.push(bpmReg / waar.bpm - 1);
      const C = d.verfijnTempoFase(o.env, o.envRate, bpmReg, o.tijdOffset, { rond: laatste, marge: 0.03 });
      const D = verfijnMetFase(o.env, o.envRate, bpmReg, o.tijdOffset, laatste, faseReg);
      for (const [naam, g] of [['A', A], ['B', B], ['C', C], ['D', D]]) {
        const fm = faseFout(g, waar, P);
        const dbpm = g.bpm / waar.bpm - 1;
        // over ±16 tellen rond P: hoe ver loopt dit grid weg?
        const weg = Math.abs(dbpm) * 16 * p * 1000;
        rij[n][naam].push({ fm, dbpm, weg });
      }
    }
  }
  console.log(`\n${label} @${mmss(P)}: waarheid ${fmt(waar.bpm, 2)} bpm (tap-bpm-fout p50 |${fmt(100 * med(rij[4].bpmTap.map(Math.abs)), 2)}|% bij 4, |${fmt(100 * med(rij[8].bpmTap.map(Math.abs)), 2)}|% bij 8; regressie |${fmt(100 * med(rij[4].bpmReg.map(Math.abs)), 2)}|% / |${fmt(100 * med(rij[8].bpmReg.map(Math.abs)), 2)}|%)`);
  for (const n of [4, 8]) for (const naam of ['A', 'B', 'C', 'D']) {
    const L = rij[n][naam];
    const ok = L.filter((x) => Math.abs(x.fm) < 25 && x.weg < 40).length;
    const off = L.filter((x) => Math.abs(Math.abs(x.fm) - p * 500) < p * 1000 * 0.12).length;
    const fout = L.length - ok - off;
    if (!id.startsWith('1W1')) { totaal[naam].ok += ok; totaal[naam].off += off; totaal[naam].fout += fout; }
    console.log(`  ${n} taps ${{A:'server ',B:'tapfase',C:'regr   ',D:'regr+fs'}[naam]}: goed ${ok}/${L.length}, offbeat ${off}, anders ${fout}; |fase| p50 ${fmt(med(L.map((x) => Math.abs(x.fm))), 0)} ms, |bpm-fout| p50 ${fmt(100 * med(L.map((x) => Math.abs(x.dbpm))), 2)}%, spreiding bpm ${fmt(100 * sd(L.map((x) => x.dbpm)), 2)}%`);
  }
}
console.log('\nTotaal (zonder zoned out):', JSON.stringify(totaal));

function med(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function sd(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); }
