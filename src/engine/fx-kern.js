/**
 * De rekenkernen van de effect-worklets (fx-worklet.js), puur: geen Web Audio,
 * dus in Node te toetsen. Overgenomen uit Clay's filter app (`worklets.js`:
 * EnvelopeProcessor en PitchShiftProcessor), herschreven volgens de regels van
 * het audiopad (docs/AUDIOPAD.md):
 *   - geen afval per blok: buffers één keer in de constructor, daarna alleen
 *     lezen en schrijven;
 *   - wat per blok vastligt staat als VELD op de kern (doubles in velden
 *     schrijft V8 ter plekke over), niet als argument;
 *   - render() krijgt alleen arrays en hele getallen en geeft niets terug;
 *     de leesfunctie van de filter app (een double over een functiegrens)
 *     staat hier uitgeschreven in de lus.
 */

/**
 * Omhullende (envelope follower) voor de auto-wah: gemiddelde |x| over de
 * kanalen, met een eigen aanzet- en vervaltijd (één pool). Uitgang 0..~1.
 */
export class Omhullende {
  constructor(sr) {
    this.sr = sr;
    this.env = 0;
    this.aanzet = 0.01;          // seconden, per blok gezet
    this.verval = 0.15;
    this._a = 0; this._r = 0;
    this._aVoor = -1; this._rVoor = -1;
  }

  /**
   * @param L, R     invoer (R mag L zijn); `kanalen` 0 = geen invoer
   * @param uit      Float32Array, n waarden
   */
  render(L, R, kanalen, uit, n) {
    if (this.aanzet !== this._aVoor) { this._aVoor = this.aanzet; this._a = Math.exp(-1 / (this.sr * Math.max(1e-4, this.aanzet))); }
    if (this.verval !== this._rVoor) { this._rVoor = this.verval; this._r = Math.exp(-1 / (this.sr * Math.max(1e-4, this.verval))); }
    const a = this._a, r = this._r;
    let env = this.env;
    for (let i = 0; i < n; i++) {
      let s = 0;
      if (kanalen > 1) s = (Math.abs(L[i]) + Math.abs(R[i])) * 0.5;
      else if (kanalen === 1) s = Math.abs(L[i]);
      env = s > env ? a * env + (1 - a) * s : r * env + (1 - r) * s;
      uit[i] = env;
    }
    // Onder het hoorbare: nul, geen denormale getallen die de lus vertragen.
    this.env = env < 1e-20 ? 0 : env;
  }
}

/**
 * Toonhoogte verschuiven zonder tempo te veranderen: twee leeskoppen op een
 * vertragingslijn die met een andere snelheid lopen dan de schrijfkop, elk in
 * een sinusvenster, een halve korrel uit fase (filter app, "granulair").
 * Geen formantcorrectie. Op 0 halve tonen staan de koppen stil: dan is het
 * een vaste kam van twee vertragingen, dus ook daar niet bit voor bit droog.
 */
export const KORREL = 0.09;
export const LIJN = 1 << 15;     // 0,68 s op 48 kHz: ruim boven een korrel

export class Toonhoogte {
  constructor(sr, korrel = KORREL) {
    this.L = new Float32Array(LIJN);
    this.R = new Float32Array(LIJN);
    this.w = 0;
    this.fase = 0;
    this.korrel = Math.max(64, Math.floor(sr * korrel));
    this.halvetonen = 0;          // per blok gezet
  }

  /** inR mag inL zijn (mono). `metInvoer` 0 = geen invoer: stilte erin. */
  render(inL, inR, metInvoer, uitL, uitR, n) {
    const N = LIJN, K = this.korrel, BL = this.L, BR = this.R;
    const inc = (1 - Math.pow(2, this.halvetonen / 12)) / K;
    let w = this.w, fase = this.fase;
    for (let i = 0; i < n; i++) {
      BL[w] = metInvoer ? inL[i] : 0;
      BR[w] = metInvoer ? inR[i] : 0;
      fase += inc;
      if (fase >= 1) fase -= 1;
      else if (fase < 0) fase += 1;
      let f2 = fase + 0.5;
      if (f2 >= 1) f2 -= 1;
      const g1 = Math.sin(Math.PI * fase), g2 = Math.sin(Math.PI * f2);
      // Kop 1: w − (fase·K + 1), lineair tussen twee samples.
      let p = w - (fase * K + 1);
      if (p < 0) p += N;
      let i0 = p | 0, i1 = i0 + 1;
      if (i1 === N) i1 = 0;
      let fr = p - i0;
      let l = (BL[i0] + (BL[i1] - BL[i0]) * fr) * g1;
      let r = (BR[i0] + (BR[i1] - BR[i0]) * fr) * g1;
      // Kop 2: een halve korrel verder.
      p = w - (f2 * K + 1);
      if (p < 0) p += N;
      i0 = p | 0; i1 = i0 + 1;
      if (i1 === N) i1 = 0;
      fr = p - i0;
      l += (BL[i0] + (BL[i1] - BL[i0]) * fr) * g2;
      r += (BR[i0] + (BR[i1] - BR[i0]) * fr) * g2;
      uitL[i] = l;
      uitR[i] = r;
      w++;
      if (w === N) w = 0;
    }
    this.w = w;
    this.fase = fase;
  }
}

// ---- spoor S10 (docs/EFFECTEN-MEER.md) ------------------------------------------------
// Dezelfde regels: buffers in de constructor, per-blokwaarden als veld, render()
// krijgt arrays en hele getallen, geeft niets terug.

/** Lengte van de lijn van de kam: ruim boven sr / 30 Hz, ook op 96 kHz. */
export const KAM_LIJN = 4096;
/** De toon van de kam glijdt naar een nieuwe stand met deze tijdconstante (s). */
export const KAM_GLIJ = 0.02;

/**
 * Resonante kamfilter: s[n] = x[n]·√(1 − fb²) + fb · lp(s[n − d]), stereo.
 * Een vertraging in een lus in een worklet: Chrome klemt die in een
 * Web Audio-lus op 128 samples (dan kan de kam niet boven 375 Hz).
 * De invoer krijgt √(1 − fb²): dan is hij voor ruis bij elke feedback even luid
 * (een kam versterkt ruis met 1/(1 − fb²)). De demping is een eenpolig
 * laagdoorlaatfilter IN de lus (versterking ≤ 1 bij elke frequentie: geen bult,
 * dus met |fb| < 1 altijd stabiel). De vertraging glijdt naar een nieuwe toon
 * (KAM_GLIJ): bij een resonator is de meeschuivende toon het instrument zelf.
 */
export class Kam {
  constructor(sr) {
    this.sr = sr;
    this.L = new Float32Array(KAM_LIJN);
    this.R = new Float32Array(KAM_LIJN);
    this.w = 0;
    this.toon = 220;            // Hz, per blok gezet
    this.fb = 0.5;              // −0,97..0,97, per blok
    this.demping = 8000;        // Hz (afsnijding in de lus), per blok
    this.d = sr / 220;          // huidige vertraging in samples (glijdt)
    this.zL = 0; this.zR = 0;   // toestand van de demping
    this._g = 1 - Math.exp(-1 / (sr * KAM_GLIJ));
    // Feedback en demping glijden per SAMPLE (10 ms): de parameters komen per blok van 128
    // binnen, en een sprong in de lusversterking midden in een resonantie is een tik
    // (gemeten in Chrome: ×781 op de tweede afgeleide bij feedback +68% → −97%).
    this._gp = 1 - Math.exp(-1 / (sr * 0.01));
    this._fbS = 0.5; this._aS = -1;
    this._dVoor = -1; this._a = 1;
  }

  render(inL, inR, metInvoer, uitL, uitR, n) {
    const N = KAM_LIJN, BL = this.L, BR = this.R;
    const max = N - 3;
    let doel = this.sr / (this.toon > 1 ? this.toon : 1);
    if (doel < 2) doel = 2; else if (doel > max) doel = max;
    if (this.demping !== this._dVoor) { this._dVoor = this.demping; this._a = 1 - Math.exp(-2 * Math.PI * Math.min(this.demping, this.sr * 0.45) / this.sr); }
    const aDoel = this._a, g = this._g, gp = this._gp;
    const fbDoel = this.fb > 0.97 ? 0.97 : this.fb < -0.97 ? -0.97 : this.fb;
    if (this._aS < 0) this._aS = aDoel;
    let w = this.w, d = this.d, zL = this.zL, zR = this.zR, fb = this._fbS, a = this._aS;
    for (let i = 0; i < n; i++) {
      d += (doel - d) * g;
      fb += (fbDoel - fb) * gp;
      a += (aDoel - a) * gp;
      const inG = Math.sqrt(1 - fb * fb);
      let p = w - d;
      if (p < 0) p += N;
      const i0 = p | 0;
      let i1 = i0 + 1;
      if (i1 === N) i1 = 0;
      const fr = p - i0;
      const lL = BL[i0] + (BL[i1] - BL[i0]) * fr;
      const lR = BR[i0] + (BR[i1] - BR[i0]) * fr;
      zL += a * (lL - zL);
      zR += a * (lR - zR);
      const xL = metInvoer ? inL[i] : 0, xR = metInvoer ? inR[i] : 0;
      const sL = xL * inG + fb * zL, sR = xR * inG + fb * zR;
      BL[w] = sL; BR[w] = sR;
      uitL[i] = sL; uitR[i] = sR;
      w++;
      if (w === N) w = 0;
    }
    // Onder het hoorbare: nul (geen denormale getallen in de lus).
    this.zL = zL < 1e-20 && zL > -1e-20 ? 0 : zL;
    this.zR = zR < 1e-20 && zR > -1e-20 ? 0 : zR;
    this.w = w; this.d = d; this._fbS = fb; this._aS = a;
  }
}

/**
 * De twee ketens allpass-filters van Olli Niemitalo ("Hilbert transform",
 * 2 × 4 tweede-orde allpass in z⁻²): hun uitgangen staan van ~20 Hz tot ~20 kHz
 * 90° uit fase (gemeten: ±0,6° van 50 Hz tot 18 kHz op 48 kHz). Zijn tabel geeft a;
 * de trap rekent met a² (y = a²·(x + y[n−2]) − x[n−2]); met a zelf was de fout tot 13°.
 */
const NIEMITALO_A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];
const NIEMITALO_B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278];
export const HILBERT_A = Float64Array.from(NIEMITALO_A, (a) => a * a);
export const HILBERT_B = Float64Array.from(NIEMITALO_B, (a) => a * a);

/**
 * Frequentieschuif (single-sideband): elke frequentie schuift `hz` op (of neer),
 * dus harmonischen worden onharmonisch. I en Q uit het Hilbert-paar, dan
 * I·cos + Q·sin met een draaiende fasor (dit teken schuift omhoog: gemeten) (geen sin/cos per sample; elke blok
 * teruggezet op lengte 1). Stereo, elk kanaal zijn eigen filters.
 */
export class Freqschuif {
  constructor(sr) {
    this.sr = sr;
    this.hz = 0;                       // per blok gezet, −2000..2000
    // Per kanaal, per keten, per trap: x1 x2 y1 y2 → 2 kanalen × 2 ketens × 4 trappen × 4.
    this.s = new Float64Array(64);
    this.vorigA = new Float64Array(2); // keten A een sample later (Niemitalo)
    this.c = 1; this.si = 0;           // fasor
  }

  render(inL, inR, metInvoer, uitL, uitR, n) {
    const S = this.s, A = HILBERT_A, B = HILBERT_B, VA = this.vorigA;
    const w = 2 * Math.PI * this.hz / this.sr;
    const dc = Math.cos(w), ds = Math.sin(w);
    let c = this.c, si = this.si;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 2; k++) {
        const x = metInvoer ? (k === 0 ? inL[i] : inR[i]) : 0;
        // keten A
        let u = x, o = k * 32;
        for (let j = 0; j < 4; j++, o += 4) {
          const y = A[j] * (u + S[o + 3]) - S[o + 1];
          S[o + 1] = S[o]; S[o] = u; S[o + 3] = S[o + 2]; S[o + 2] = y;
          u = y;
        }
        const ia = VA[k];
        VA[k] = u;
        // keten B
        let v = x;
        o = k * 32 + 16;
        for (let j = 0; j < 4; j++, o += 4) {
          const y = B[j] * (v + S[o + 3]) - S[o + 1];
          S[o + 1] = S[o]; S[o] = v; S[o + 3] = S[o + 2]; S[o + 2] = y;
          v = y;
        }
        const y = ia * c + v * si;
        if (k === 0) uitL[i] = y; else uitR[i] = y;
      }
      const nc = c * dc - si * ds;
      si = c * ds + si * dc;
      c = nc;
    }
    const r = 1 / Math.sqrt(c * c + si * si);
    this.c = c * r; this.si = si * r;
    for (let j = 0; j < 64; j++) { const x = S[j]; if (x < 1e-20 && x > -1e-20) S[j] = 0; }
  }
}

/**
 * Transient-shaper: een snelle en een trage omhullende op max(|L|, |R|). Waar
 * de snelle boven de trage komt is een aanslag, waar hij eronder zakt de staart.
 * gain (dB) = 6 · aanval · log2(snel/traag) in de aanslag, 6 · sustain · log2(traag/snel)
 * in de staart, geklemd op ±12 dB, en glad (1 ms). Gekoppeld stereo, geen
 * vooruitblik: geen vertraging.
 */
export const AANSLAG_DB = 12;
export class Aanslag {
  constructor(sr) {
    this.sr = sr;
    this.aanval = 0;           // −1..1, per blok
    this.sustain = 0;          // −1..1, per blok
    this.snel = 0; this.traag = 0; this.g = 0;
    const k = (s) => Math.exp(-1 / (sr * s));
    this._sa = k(0.0005); this._sr = k(0.02);
    this._ta = k(0.02); this._tr = k(0.2);
    this._gg = k(0.001);
    this._top = AANSLAG_DB;
  }

  render(inL, inR, metInvoer, uitL, uitR, n) {
    const sa = this._sa, sr = this._sr, ta = this._ta, tr = this._tr, gg = this._gg;
    const av = this.aanval, su = this.sustain;
    // De grens als lokale double: rechtstreeks de module-binding in de lus liet
    // V8 `doel` als getal-object bewaren (gemeten: 23 GC's per 12 000 blokken).
    const top = this._top;
    let snel = this.snel, traag = this.traag, g = this.g;
    for (let i = 0; i < n; i++) {
      const l = metInvoer ? inL[i] : 0, r = metInvoer ? inR[i] : 0;
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      const x = al > ar ? al : ar;
      snel = x > snel ? sa * snel + (1 - sa) * x : sr * snel + (1 - sr) * x;
      traag = x > traag ? ta * traag + (1 - ta) * x : tr * traag + (1 - tr) * x;
      const v = Math.log2((snel + 1e-6) / (traag + 1e-6));
      let doel = v > 0 ? 6 * av * v : -6 * su * v;
      if (doel > top) doel = top; else if (doel < -top) doel = -top;
      g = gg * g + (1 - gg) * doel;
      const lin = Math.exp(g * 0.11512925464970229);
      uitL[i] = l * lin; uitR[i] = r * lin;
    }
    this.snel = snel < 1e-20 ? 0 : snel;
    this.traag = traag < 1e-20 ? 0 : traag;
    this.g = g;
  }
}
