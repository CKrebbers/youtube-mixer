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
