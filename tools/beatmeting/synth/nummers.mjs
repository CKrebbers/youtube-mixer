// De BENCHMARK van het automatische beatgrid (docs/BEATGRID.md §12): synthetische
// nummers waarvan de tellen en de "1"-en EXACT bekend zijn. Puur rekenwerk, vast
// zaad: elke keer bit voor bit hetzelfde materiaal. Geen test zelf; bench.mjs
// rekent er beide analyses op (de oude in detect.js en Beat This! via
// gridUitTellen), test/beatbench.test.mjs toetst een deel ervan.
//
// Per nummer:
//   tellen    de echte tellen (tracktijd, s), op het niveau dat een DJ telt;
//   eenen     de echte "1"-en;
//   perMaat   tellen per maat;
//   meet      [[van, tot]]: waar de puls duidelijk is (een kick of iets dat even
//             hard telt): daar tellen dekking, tempo, fase en "1" mee;
//   puls      [[van, tot]]: waar ER een puls is (ook een break of intro zonder
//             kick: daar mag het grid onzeker zijn, maar als het zeker zegt moet
//             het kloppen). Buiten `puls` is zeker altijd vals;
//   dj        de verhouding tussen het DJ-tempo en de echte tellen (1, of 2 voor
//             een tempo onder het dansbereik: zie DANS_MIN in src/engine/tellen.js);
//   bt        hoe Beat This! dit waarschijnlijk hoort: { oct } (1 of 0,5);
//   wissels   tracktijden waar een nieuw nummer begint (ander tempo of fase).

export const SR = 22050;

function rndMet(z) { let s = z >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
const gauss = (rnd) => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.SQRT2; };   // ~N(0,1)
const f = (m) => 440 * 2 ** ((m - 69) / 12);

// ---- klanken ------------------------------------------------------------------

/** Schrijft één klank in x vanaf t (s). */
function speel(x, rnd, t, soort, a = 1, extra = {}) {
  const s0 = Math.round(t * SR);
  if (s0 >= x.length) return;
  const zet = (lenS, fn) => {
    const n = Math.round(lenS * SR);
    for (let i = Math.max(0, -s0); i < n && s0 + i < x.length; i++) x[s0 + i] += fn(i / SR, i);
  };
  let vorig = 0;
  switch (soort) {
    case 'kick': zet(0.3, (u) => a * 0.9 * Math.exp(-u * 16) * Math.sin(2 * Math.PI * (45 * u + 90 * (1 - Math.exp(-u * 30)) / 30))); break;
    case 'snare': zet(0.18, (u) => a * 0.45 * Math.exp(-u * 22) * ((rnd() * 2 - 1) + 0.6 * Math.sin(2 * Math.PI * 190 * u))); break;
    case 'rim': zet(0.05, (u) => a * 0.4 * Math.exp(-u * 70) * Math.sin(2 * Math.PI * 820 * u)); break;
    case 'hat': zet(0.05, (u) => { const n = rnd() * 2 - 1; const h = n - vorig; vorig = n; return a * 0.18 * Math.exp(-u * 110) * h; }); break;
    case 'ride': zet(0.25, (u) => { const n = rnd() * 2 - 1; const h = n - vorig; vorig = n; return a * 0.08 * Math.exp(-u * 14) * h; }); break;
    case 'crash': zet(1.2, (u) => { const n = rnd() * 2 - 1; const h = n - vorig; vorig = n; return a * 0.25 * Math.exp(-u * 3) * h; }); break;
    case 'skank': {
      const akk = [64, 67, 71].map(f);
      zet(0.12, (u) => a * 0.12 * Math.min(1, u * 400) * Math.exp(-u * 28) * akk.reduce((s, fr) => s + Math.sign(Math.sin(2 * Math.PI * fr * u)), 0));
      break;
    }
    case 'bas': {
      const fr = f(extra.noot ?? 33), lang = extra.lang ?? 0.3;
      zet(lang, (u) => a * 0.35 * Math.min(1, u * 150, (lang - u) * 60) * Math.sin(2 * Math.PI * fr * u));
      break;
    }
    case 'pad': {
      const akk = (extra.akkoord ?? [57, 60, 64]).map(f), lang = extra.lang ?? 8;
      zet(lang, (u) => a * 0.05 * Math.min(1, u / 1.5, (lang - u) / 1.5) * akk.reduce((s, fr) => s + Math.sin(2 * Math.PI * fr * u + 0.3 * Math.sin(1.3 * u)), 0));
      break;
    }
    case 'bel': {
      // Zachte aanzet (40 ms), lange staart: geen klap, wel een toon.
      const fr = f(extra.noot ?? 72);
      zet(3, (u) => a * 0.12 * Math.min(1, u / 0.04) * Math.exp(-u * 1.4) * (Math.sin(2 * Math.PI * fr * u) + 0.3 * Math.sin(2 * Math.PI * 2.76 * fr * u)));
      break;
    }
    default: throw new Error(`onbekende klank ${soort}`);
  }
}

// ---- tellen maken --------------------------------------------------------------

/** Tellen op een vast tempo van `van` tot `tot`, de eerste op `anker` (of het eerste veelvoud erna). */
function vast(bpm, van, tot, anker = van) {
  const L = 60 / bpm, uit = [];
  for (let k = Math.ceil((van - anker) / L - 1e-9); anker + k * L < tot - 1e-9; k++) uit.push(anker + k * L);
  return uit;
}

/** Tellen met een tempo dat beweegt: bpmVan(t). */
function bewegend(bpmVan, van, tot) {
  const uit = [];
  for (let t = van; t < tot; t += 60 / bpmVan(t)) uit.push(t);
  return uit;
}

/** De tijd van onderdeel `frac` (0..1) van tel i: tussen tel i en i+1 in. */
const tussen = (T, i, frac) => {
  const L = i + 1 < T.length ? T[i + 1] - T[i] : T[i] - T[i - 1];
  return T[i] + frac * L;
};

// ---- de nummers ----------------------------------------------------------------

/**
 * Een nummer uit stukken. Elk stuk: { tellen (tijden), patroon(i, tel, maatTel, emit), perMaat, eenOp (index
 * van de eerste "1" in tellen, standaard 0) }. `emit(t, soort, a, extra)` met t in tracktijd.
 */
let zonderAudio = false;
function bouw({ naam, duur, zaad = 7, stukken, meet, puls, dj = 1, bt = { oct: 1 }, wissels = [], vloer = 0.004, ambient = null, beschrijving }) {
  const rnd = rndMet(zaad);
  const x = new Float32Array(zonderAudio ? 0 : Math.round(duur * SR));
  for (let i = 0; i < x.length; i++) x[i] = vloer * (rnd() * 2 - 1);
  const tellen = [], eenen = [];
  let perMaat = 4;
  const jit = rndMet(zaad * 31 + 5);
  for (const st of stukken) {
    const T = st.tellen;
    perMaat = st.perMaat ?? 4;
    const eenOp = st.eenOp ?? 0;
    T.forEach((t, i) => {
      tellen.push(t);
      const maatTel = (((i - eenOp) % perMaat) + perMaat) % perMaat;
      if (maatTel === 0) eenen.push(t);
      st.patroon(i, T, maatTel, (tt, soort, a = 1, extra = {}) => {
        const j = st.jitter ? st.jitter * gauss(jit) : 0;
        if (!zonderAudio && tt + j >= 0 && tt + j < duur) speel(x, rnd, tt + j, soort, a, extra);
      });
    });
  }
  if (ambient && !zonderAudio) ambient(x, rnd);
  // Normaliseren op een vaste piek: zoals een master.
  let piek = 0;
  for (const v of x) piek = Math.max(piek, Math.abs(v));
  if (piek > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.8 / piek;
  return {
    naam, beschrijving, duur, x, tellen: tellen.sort((a, b) => a - b), eenen: eenen.sort((a, b) => a - b), perMaat,
    meet: meet ?? [[0, duur]], puls: puls ?? meet ?? [[0, duur]], dj, bt, wissels,
  };
}

// Patronen. `e` = emit; i = index van de tel, T = de tellen, m = tel in de maat.
const vierKwart = (sterk = 1) => (i, T, m, e) => {
  e(T[i], 'kick', sterk);
  e(tussen(T, i, 0.5), 'hat', 0.8);
  if (m === 1 || m === 3) e(T[i], 'snare', 0.7);
  e(tussen(T, i, 0.5), 'bas', 0.8, { noot: 33, lang: 0.6 * (60 / 124) });
};
const rock = (i, T, m, e) => {
  if (m === 0 || m === 2) e(T[i], 'kick', 1);
  if (m === 2) e(tussen(T, i, 0.5), 'kick', 0.6);
  if (m === 1 || m === 3) e(T[i], 'snare', 0.9);
  e(T[i], 'hat', 0.7); e(tussen(T, i, 0.5), 'hat', 0.5);
};

export const NUMMERS = {
  // Vast tempo over het bereik. Onder het dansbereik (72) telt een DJ het dubbele.
  'vast-72': () => bouw({ naam: 'vast-72', beschrijving: 'downtempo 72: kick 1 en 3, snare 2 en 4, hats op de achtsten', duur: 150, zaad: 11, dj: 2,
    stukken: [{ tellen: vast(72, 0.4, 150), patroon: rock }] }),
  'vast-96': () => bouw({ naam: 'vast-96', beschrijving: 'hiphop-tempo 96, rock-patroon', duur: 150, zaad: 12,
    stukken: [{ tellen: vast(96, 0.25, 150), patroon: rock }] }),
  'house-124': () => bouw({ naam: 'house-124', beschrijving: 'house 124, vier op de vloer, bas op de offbeat', duur: 180, zaad: 13,
    stukken: [{ tellen: vast(124, 0.3, 180), patroon: vierKwart() }] }),
  'vast-140': () => bouw({ naam: 'vast-140', beschrijving: 'techno 140, vier op de vloer', duur: 150, zaad: 14,
    stukken: [{ tellen: vast(140, 0.11, 150), patroon: vierKwart() }] }),
  'vast-160': () => bouw({ naam: 'vast-160', beschrijving: 'footwork-tempo 160, rock-patroon', duur: 150, zaad: 15,
    stukken: [{ tellen: vast(160, 0.2, 150), patroon: rock }] }),
  'vast-178': () => bouw({ naam: 'vast-178', beschrijving: '178, vier op de vloer', duur: 150, zaad: 16,
    stukken: [{ tellen: vast(178, 0.05, 150), patroon: vierKwart() }] }),

  // Swing/shuffle: hats op 0 en 2/3 van de tel.
  'swing-118': () => bouw({ naam: 'swing-118', beschrijving: 'shuffle 118: kick 1 en 3, snare 2 en 4, hats op de geswingde achtsten', duur: 160, zaad: 21,
    stukken: [{ tellen: vast(118, 0.35, 160), patroon: (i, T, m, e) => {
      if (m === 0 || m === 2) e(T[i], 'kick', 1);
      if (m === 1 || m === 3) e(T[i], 'snare', 0.8);
      e(T[i], 'ride', 1); e(tussen(T, i, 2 / 3), 'ride', 0.7);
    } }] }),

  // Een break van 32 tellen zonder kick: hats op de offbeat en een pad. De puls loopt door.
  'break-124': () => {
    const T = vast(124, 0.3, 190);
    const L = 60 / 124, b0 = 0.3 + 64 * L, b1 = b0 + 32 * L;
    return bouw({ naam: 'break-124', beschrijving: 'house 124 met een break van 8 maten (alleen hats op de offbeat en een pad)', duur: 190, zaad: 22,
      meet: [[0, b0], [b1, 190]], puls: [[0, 190]],
      stukken: [{ tellen: T, patroon: (i, TT, m, e) => {
        const t = TT[i];
        if (t >= b0 - 1e-6 && t < b1 - 1e-6) {
          e(tussen(TT, i, 0.5), 'hat', 0.6);
          if (m === 0 && ((i - 64) % 8) === 0) e(t, 'pad', 1, { lang: 8 * L });
        } else vierKwart()(i, TT, m, e);
      } }] });
  },

  // Een intro van 32 tellen zonder kick (alleen een pad en zachte hats), dan vier op de vloer.
  'intro-128': () => {
    const T = vast(128, 0.2, 170);
    const L = 60 / 128, k0 = 0.2 + 32 * L;
    return bouw({ naam: 'intro-128', beschrijving: 'intro van 8 maten met alleen een pad en zachte offbeat-hats, dan 128 vier op de vloer', duur: 170, zaad: 23,
      meet: [[k0, 170]], puls: [[0, 170]],
      stukken: [{ tellen: T, patroon: (i, TT, m, e) => {
        if (TT[i] < k0 - 1e-6) {
          e(tussen(TT, i, 0.5), 'hat', 0.3);
          if (i % 16 === 0) e(TT[i], 'pad', 1, { lang: 16 * L });
        } else vierKwart()(i, TT, m, e);
      } }] });
  },

  // Een tempowissel midden in (een nieuw nummer in een mix): 124 -> 131, een andere fase.
  'wissel-124-131': () => {
    const w = 0.3 + 192 * (60 / 124);   // na 48 maten
    return bouw({ naam: 'wissel-124-131', beschrijving: 'mix: 124 tot ~93 s, dan 131 in een andere fase', duur: 200, zaad: 24, wissels: [w],
      stukken: [{ tellen: vast(124, 0.3, w), patroon: vierKwart() }, { tellen: vast(131, w + 0.137, 200), patroon: vierKwart() }] });
  },

  // Een band zonder klik: het tempo wandelt ±2% (periode ~50 s) en elke slag ligt ~6 ms naast.
  'live-drift': () => bouw({ naam: 'live-drift', beschrijving: 'live band zonder klik: 120 ±2% (golf van 50 s), slagen σ 6 ms', duur: 200, zaad: 25,
    stukken: [{ tellen: bewegend((t) => 120 * (1 + 0.02 * Math.sin(2 * Math.PI * t / 50) + 0.008 * Math.sin(2 * Math.PI * t / 13)), 0.4, 200), patroon: rock, jitter: 0.006 }] }),

  // Een geleidelijke versnelling: 122 -> 126 in 3 minuten (een live set die oploopt).
  'oplopend': () => bouw({ naam: 'oplopend', beschrijving: 'versnelling 122 -> 126 bpm over 3 minuten (3%)', duur: 180, zaad: 26,
    stukken: [{ tellen: bewegend((t) => 122 + 4 * t / 180, 0.2, 180), patroon: vierKwart() }] }),

  // Drie tellen per maat.
  'wals-150': () => bouw({ naam: 'wals-150', beschrijving: 'wals 150 (3/4): kick op de 1, hats op 2 en 3', duur: 150, zaad: 27,
    stukken: [{ tellen: vast(150, 0.25, 150), perMaat: 3, patroon: (i, T, m, e) => {
      if (m === 0) { e(T[i], 'kick', 1); e(T[i], 'bas', 1, { noot: 33, lang: 0.5 }); } else { e(T[i], 'hat', 1); e(T[i], 'skank', 0.6); }
    } }] }),

  // Reggae one drop op 75: kick + rim op tel 3, skank op elke offbeat. De DJ telt hier het dubbele (150).
  'reggae-75': () => bouw({ naam: 'reggae-75', beschrijving: 'reggae one drop 75: kick en rim op tel 3, skank op elke offbeat', duur: 180, zaad: 28, dj: 2,
    stukken: [{ tellen: vast(75, 0.5, 180), patroon: (i, T, m, e) => {
      if (m === 2) { e(T[i], 'kick', 1); e(T[i], 'rim', 1); }
      e(tussen(T, i, 0.5), 'skank', 1);
      e(T[i], 'hat', 0.35); e(tussen(T, i, 0.5), 'hat', 0.25);
      if (m === 0) e(T[i], 'bas', 0.9, { noot: 31, lang: 0.7 });
    } }] }),

  // Jungle 172: een break op de achtsten (kick op 1 en 3+, snare op 2 en 4, ghost notes), sub-bas.
  'jungle-172': () => bouw({ naam: 'jungle-172', beschrijving: 'jungle 172: breakbeat (kick 1, 2+, snare 2 en 4, ghosts), sub-bas', duur: 180, zaad: 29, bt: { oct: 0.5 },
    stukken: [{ tellen: vast(172, 0.15, 180), patroon: (i, T, m, e) => {
      // Per maat in achtsten: K . | S . | . K | S .  plus ghost-snares.
      if (m === 0) e(T[i], 'kick', 1);
      if (m === 1 || m === 3) e(T[i], 'snare', 1);
      if (m === 2) e(tussen(T, i, 0.5), 'kick', 0.9);
      if (m === 3) e(tussen(T, i, 0.5), 'snare', 0.35);
      if (m === 1) e(tussen(T, i, 0.5), 'snare', 0.3);
      e(T[i], 'ride', 0.6); e(tussen(T, i, 0.5), 'ride', 0.5);
      if (m === 0 && i % 8 === 0) e(T[i], 'bas', 1, { noot: 28, lang: 1.3 });
    } }] }),

  // Half-time (dubstep 140): kick op 1, snare op 3 (op de 140 geteld), hats op de achtsten. Klinkt als 70.
  'halftime-140': () => bouw({ naam: 'halftime-140', beschrijving: 'half-time 140: kick op 1, snare op 3, hats op de achtsten (voelt als 70)', duur: 160, zaad: 30, bt: { oct: 0.5 },
    stukken: [{ tellen: vast(140, 0.2, 160), patroon: (i, T, m, e) => {
      if (m === 0) e(T[i], 'kick', 1);
      if (m === 2) e(T[i], 'snare', 1);
      e(T[i], 'hat', 0.5); e(tussen(T, i, 0.5), 'hat', 0.35);
      if (m === 0) e(T[i], 'bas', 1, { noot: 29, lang: 0.8 });
    } }] }),

  // Ambient zonder puls: pads en bellen op willekeurige momenten.
  'ambient': () => bouw({ naam: 'ambient', beschrijving: 'ambient: pads en bellen met zachte aanzet op willekeurige momenten, geen puls', duur: 180, zaad: 31,
    meet: [], puls: [], stukken: [],
    ambient: (x, rnd) => {
      for (let t = 0; t < 180; t += 6 + rnd() * 6) speel(x, rnd, t, 'pad', 1, { lang: 14, akkoord: [[50, 57, 64], [48, 55, 62], [53, 60, 64]][Math.floor(rnd() * 3)] });
      for (let t = rnd() * 2; t < 180; t += 0.4 + rnd() * 2.8) speel(x, rnd, t, 'bel', 0.5 + rnd() * 0.5, { noot: 67 + Math.floor(rnd() * 14) });
    } }),

  // Een opmaat: drie tellen snare-fill vóór de eerste "1" (met crash). De "1" ligt NIET op de eerste tel.
  'opmaat-126': () => {
    const T = vast(126, 0.6, 170);
    return bouw({ naam: 'opmaat-126', beschrijving: 'opmaat van drie tellen (snare-fill), de eerste "1" met crash op tel 4', duur: 170, zaad: 32,
      meet: [[T[3], 170]], puls: [[0, 170]],
      stukken: [{ tellen: T, eenOp: 3, patroon: (i, TT, m, e) => {
        if (i < 3) { e(TT[i], 'snare', 0.8); e(tussen(TT, i, 0.5), 'snare', 0.6); return; }
        if (i === 3) e(TT[i], 'crash', 1);
        // Clay's repertoire: een accent op de "1" (de bas wisselt per maat).
        vierKwart()(i, TT, m, e);
        if (m === 0) e(TT[i], 'bas', 1, { noot: 36, lang: 0.4 });
      } }] });
  },

  // Een band zonder klik op 154 met de snare op 2 en 4 (zoals Ciel van Bay Ledges): Beat This! hoort 77.
  'indie-154': () => bouw({ naam: 'indie-154', beschrijving: 'band zonder klik op 154 (±1%), snare op 2 en 4, slagen σ 5 ms (zoals Ciel)', duur: 200, zaad: 33, bt: { oct: 0.5 },
    stukken: [{ tellen: bewegend((t) => 154 * (1 + 0.01 * Math.sin(2 * Math.PI * t / 37)), 0.3, 200), jitter: 0.005, patroon: (i, T, m, e) => {
      if (m === 0) e(T[i], 'kick', 1);
      if (m === 2) e(T[i], 'kick', 0.7);
      if (m === 1 || m === 3) e(T[i], 'snare', 1);
      e(T[i], 'hat', 0.5);
    } }] }),
};

export const NAMEN = Object.keys(NUMMERS);

/** Een nummer; met `audio: false` alleen de tellen en de "1"-en (snel, voor de tests van de tellen). */
export function nummer(naam, { audio = true } = {}) {
  zonderAudio = !audio;
  try { return NUMMERS[naam](); } finally { zonderAudio = false; }
}

/** De verhouding tot het dichtstbijzijnde octaaf (½, 1, 2) of null als het geen octaaf is (binnen `marge`, relatief). */
export function octaafVan(r, marge = 0.02) {
  for (const o of [1, 2, 0.5, 4, 0.25]) if (Math.abs(r / o - 1) <= marge) return o;
  return null;
}

/** Wav (16-bit mono) van een nummer, voor ffmpeg en de analyse. */
export function wavVan(x, sr = SR) {
  const n = x.length, buf = Buffer.alloc(44 + 2 * n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + 2 * n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  return buf;
}
