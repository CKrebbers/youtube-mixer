// Een synthetisch nummer met een bekend antwoord voor de secties
// (test/secties.test.mjs): drums, bas, pad, lead en "zang" als losse stems,
// elke sectie een eigen bezetting en akkoorden, op een vast tempo en anker.
// Geen test zelf. Vast zaad: elke keer hetzelfde materiaal.

export const BPM = 124, ANKER = 0.3;

/** Het plan: [label, groep, maten, wat speelt, akkoorden (grondtoon midi per maat, rondlopend), niveau]. */
export const PLAN = [
  ['intro', 'A', 8, { hats: 1, pad: 0.5 }, [57], 0.35],
  ['deel', 'B', 16, { kick: 1, hats: 1, bas: 1, pad: 1, zang: 1 }, [57, 53, 48, 55], 0.7],
  ['opbouw', 'C', 8, { snare: 1, pad: 1, bas: 1, stijgt: 1 }, [53, 55], 0.6],
  ['drop', 'D', 16, { kick: 1, hats: 1, snare: 1, bas: 1, lead: 1, pad: 1 }, [53, 55, 57, 57], 1],
  ['break', 'E', 8, { pad: 1, zang: 1 }, [48, 53], 0.45],
  ['drop', 'D', 16, { kick: 1, hats: 1, snare: 1, bas: 1, lead: 1, pad: 1 }, [53, 55, 57, 57], 1],
  ['outro', 'F', 8, { kick: 1, hats: 1 }, [57], 0.5],
];

function rndMet(z) { let s = z >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
const f = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * @returns {{ sr, duur, mix: Float32Array, stems: {drums, bass, other, vocals}: Float32Array (mono),
 *             grid, grenzen: number[] (tijden van de sectiebegins, eerste = 0), plan }}
 */
export function synthNummer({ sr = 11025, plan = PLAN, bpm = BPM, anker = ANKER, zaad = 7 } = {}) {
  const rnd = rndMet(zaad);
  const tel = 60 / bpm, maat = 4 * tel;
  const totMaten = plan.reduce((s, p) => s + p[2], 0);
  const duur = anker + totMaten * maat + 1;
  const n = Math.round(duur * sr);
  const st = { drums: new Float32Array(n), bass: new Float32Array(n), other: new Float32Array(n), vocals: new Float32Array(n) };
  const voeg = (x, t0, len, fn) => {
    const a = Math.round(t0 * sr), m = Math.round(len * sr);
    for (let i = 0; i < m && a + i < n; i++) x[a + i] += fn(i / sr);
  };
  const grenzen = [0];
  let t = anker;
  for (const [, , maten, wat, akk, niveau] of plan) {
    for (let mi = 0; mi < maten; mi++) {
      const t0 = t + mi * maat;
      const grond = akk[mi % akk.length];
      const g = niveau * (wat.stijgt ? 0.4 + 0.6 * (mi / maten) : 1);
      for (let b = 0; b < 4; b++) {
        const tb = t0 + b * tel;
        if (wat.kick) voeg(st.drums, tb, 0.25, (x) => g * 0.9 * Math.exp(-x * 18) * Math.sin(2 * Math.PI * (45 * x + 75 * (1 - Math.exp(-x * 30)) / 30)));
        if (wat.hats) voeg(st.drums, tb + tel / 2, 0.04, () => g * 0.25 * (rnd() * 2 - 1));
        if (wat.snare && (b % 2 === 1 || wat.stijgt)) {
          const rol = wat.stijgt && mi >= maten / 2 ? 4 : 1;
          for (let r = 0; r < rol; r++) voeg(st.drums, tb + r * tel / rol, 0.1, (x) => g * 0.4 * Math.exp(-x * 30) * ((rnd() * 2 - 1) + 0.5 * Math.sin(2 * Math.PI * 190 * x)));
        }
        if (wat.bas) for (const h of [0, 0.5]) voeg(st.bass, tb + h * tel, tel / 2 * 0.9, (x) => g * 0.45 * Math.min(1, x * 200) * Math.exp(-x * 3) * (Math.sin(2 * Math.PI * f(grond - 12) * x) + 0.4 * Math.sin(4 * Math.PI * f(grond - 12) * x)));
        if (wat.lead) {
          const toon = grond + 12 + [0, 7, 3, 10][(b + mi) % 4];
          voeg(st.other, tb, tel * 0.8, (x) => g * 0.18 * Math.min(1, x * 100) * Math.exp(-x * 2) * Math.sign(Math.sin(2 * Math.PI * f(toon) * x)));
        }
      }
      if (wat.pad) {
        const akkoord = [0, 3, 7].map((iv) => f(grond + iv));
        voeg(st.other, t0, maat, (x) => g * 0.12 * Math.min(1, x * 8, (maat - x) * 8) * akkoord.reduce((s, fr) => s + Math.sin(2 * Math.PI * fr * x) + 0.3 * Math.sin(4 * Math.PI * fr * x), 0));
      }
      if (wat.zang) {
        const melodie = [grond + 12, grond + 15, grond + 19, grond + 17];
        for (let b = 0; b < 4; b++) {
          const fr = f(melodie[b]);
          voeg(st.vocals, t0 + b * tel, tel * 0.95, (x) => g * 0.2 * Math.min(1, x * 30, (tel - x) * 30) * Math.sin(2 * Math.PI * fr * x + 0.3 * Math.sin(2 * Math.PI * 5.5 * x)));
        }
      }
    }
    t += maten * maat;
    grenzen.push(t);
  }
  grenzen.pop();
  const mix = new Float32Array(n);
  for (const x of Object.values(st)) for (let i = 0; i < n; i++) mix[i] += x[i];
  const grid = { stukken: [{ van: 0, bpm, anker, zekerheid: 0.9, maat: anker }], beatsPerBar: 4, bron: 'auto' };
  return { sr, duur, mix, stems: st, grid, grenzen, plan };
}

/** Stems als interleaved stereo op `sr` (stem k = kanaalpaar k), zoals stems.wav na ffmpeg. */
export function stemsInterleaved(stems, namen, srVan, srNaar) {
  const r = srVan / srNaar, n = Math.floor(stems[namen[0]].length / r), K = namen.length * 2;
  const uit = new Float32Array(n * K);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < namen.length; k++) {
      // gemiddelde over het venster: grof, maar genoeg voor een niveau
      let s = 0; const a = Math.floor(i * r), b = Math.floor((i + 1) * r);
      for (let j = a; j < b; j++) s += stems[namen[k]][j] ** 2;
      const v = Math.sqrt(s / Math.max(1, b - a));
      uit[i * K + 2 * k] = v; uit[i * K + 2 * k + 1] = -v;
    }
  }
  return uit;
}
