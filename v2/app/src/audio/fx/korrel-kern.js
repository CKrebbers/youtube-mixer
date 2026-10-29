/**
 * De korrelwolk (granular) als rekenkern: wat binnenkomt gaat in een ringbuffer van RING_S
 * seconden, en daaruit spelen tot MAX_KORRELS korrels tegelijk, elk met een Hann-venster, een eigen
 * plek in het verleden (`terug` + `spray`), toonhoogte (`toon`: spreiding in halve tonen, octaven
 * vaker), kant (`breedte`) en soms achteruit (`omkeer`: de kans). `bevries` = er komt niets nieuws
 * meer in de ring: de wolk speelt wat er was, ook als de muziek doorgaat of stopt.
 *
 * Idee en invarianten uit MediSynth src/audio/grains.js (GrainCloud: geen allocatie in process(),
 * eigen LCG, Hann-venster, normalisatie 1/√n). Hier puur en stereo, in de vorm van de kernen in
 * fx-kern.js: render(inL, inR, metInvoer, uitL, uitR, n), velden per blok gezet door de worklet.
 *
 * GEEN AFVAL: alle buffers en korrels zijn er vanaf de constructor (BOUWREGELS "HET AUDIOPAD MAAKT
 * GEEN AFVAL"); toeval alleen uit een eigen LCG met een zaad (herhaalbaar in de tests).
 */

export const RING_S = 4;
export const MAX_KORRELS = 48;
/** Make-up: een Hann-venster en 1/√n laten ~7 dB liggen (gemeten op een sinus van 220 Hz: rms 0,15 uit 0,35 in). */
export const MAKEUP = 1.6;
const VENSTER = 1024;

/** Hann-venster als tabel (geen cos per sample). */
const HANN = new Float32Array(VENSTER + 1);
for (let i = 0; i <= VENSTER; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / VENSTER);

export class Korrel {
  constructor(sr, zaad = 0x2f6b) {
    this.sr = sr;
    const n = Math.ceil(sr * RING_S);
    this.N = n;
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
    this.w = 0;              // schrijfplek
    this.gevuld = 0;         // hoeveel samples er al in de ring staan (een lege ring speelt niets)
    // Parameters (per blok gezet):
    this.grootte = 0.08;     // s, lengte van een korrel
    this.dichtheid = 20;     // korrels per seconde
    this.terug = 0.25;       // s, hoe ver terug het midden van de wolk ligt
    this.spray = 0.2;        // s, toeval rond dat midden
    this.toon = 0;           // halve tonen spreiding (0 = allemaal op de oorspronkelijke toonhoogte)
    this.omkeer = 0;         // kans dat een korrel achteruit speelt
    this.breedte = 0.6;      // 0 = midden, 1 = helemaal links/rechts
    this.bevries = 0;        // ≥ 0,5 = de ring staat stil
    // De korrels: velden als losse arrays (geen objecten per korrel).
    this.aan = new Uint8Array(MAX_KORRELS);
    this.pos = new Float64Array(MAX_KORRELS);    // leesplek in de ring (samples, met breuk)
    this.stap = new Float64Array(MAX_KORRELS);   // samples per sample (toonhoogte; negatief = achteruit)
    this.fase = new Float64Array(MAX_KORRELS);   // 0..1 door het venster
    this.fStap = new Float64Array(MAX_KORRELS);  // venster per sample
    this.gL = new Float32Array(MAX_KORRELS);
    this.gR = new Float32Array(MAX_KORRELS);
    this.tot = 0;            // samples tot de volgende korrel
    this.s = zaad >>> 0 || 1;
    this.actief = 0;
  }

  /** LCG (Numerical Recipes): 0..1, geen allocatie. */
  _r() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }

  _nieuw() {
    if (this.gevuld < this.sr * 0.02) return;
    let k = -1;
    for (let i = 0; i < MAX_KORRELS; i++) if (!this.aan[i]) { k = i; break; }
    if (k < 0) return;
    const sr = this.sr;
    const lengte = Math.max(0.005, this.grootte) * sr;
    // Toonhoogte: zonder spreiding de oorspronkelijke; met spreiding vaak een octaaf of kwint, soms ertussen.
    let ht = 0;
    if (this.toon > 0.01) {
      const r = this._r();
      ht = r < 0.35 ? 0 : r < 0.6 ? (this._r() < 0.5 ? -12 : 12) : r < 0.75 ? 7 : (this._r() * 2 - 1) * this.toon;
      if (Math.abs(ht) > this.toon) ht = ht > 0 ? this.toon : -this.toon;
    }
    let stap = Math.pow(2, ht / 12);
    if (this._r() < this.omkeer) stap = -stap;
    // De plek: zover terug dat de korrel nooit de schrijfkop inhaalt (vooruit) of voorbij de oudste sample gaat.
    const maxTerug = Math.min(this.gevuld, this.N) - 2;
    const nodig = lengte * Math.abs(stap) + 2;
    let terug = this.terug * sr + (this._r() * 2 - 1) * this.spray * sr;
    if (stap > 0) terug = Math.max(terug, nodig);              // vooruit: nooit de schrijfkop inhalen
    else terug = Math.min(terug, maxTerug - nodig);           // achteruit: nooit voorbij de oudste sample
    terug = Math.max(2, Math.min(terug, maxTerug));
    if (stap > 0 && terug < nodig) return;                     // de ring is nog te kort voor deze korrel
    let p = this.w - terug;
    if (p < 0) p += this.N;
    const kant = (this._r() * 2 - 1) * this.breedte;   // −1..1, equal power
    const hoek = (kant + 1) * Math.PI / 4;
    this.aan[k] = 1;
    this.pos[k] = p;
    this.stap[k] = stap;
    this.fase[k] = 0;
    this.fStap[k] = 1 / lengte;
    this.gL[k] = Math.cos(hoek);
    this.gR[k] = Math.sin(hoek);
  }

  render(inL, inR, metInvoer, uitL, uitR, n) {
    const N = this.N, BL = this.L, BR = this.R, sr = this.sr;
    const schrijf = metInvoer && this.bevries < 0.5;
    // Normalisatie: zoveel korrels liggen er gemiddeld over elkaar (dichtheid × grootte), 1/√n (MediSynth).
    const overlap = Math.max(1, this.dichtheid * Math.max(0.005, this.grootte));
    const norm = MAKEUP / Math.sqrt(overlap);
    const interval = sr / Math.max(0.5, this.dichtheid);
    let w = this.w;
    for (let i = 0; i < n; i++) {
      if (schrijf) {
        BL[w] = inL[i]; BR[w] = inR[i];
        w++; if (w === N) w = 0;
        if (this.gevuld < N) this.gevuld++;
      }
      if (--this.tot <= 0) {
        this.w = w;
        this._nieuw();
        this.tot = interval * (0.5 + this._r());   // ongelijk: geen hoorbaar raster
      }
      let sL = 0, sR = 0;
      for (let k = 0; k < MAX_KORRELS; k++) {
        if (!this.aan[k]) continue;
        const f = this.fase[k];
        const vi = f * VENSTER, v0 = vi | 0;
        const g = HANN[v0] + (HANN[v0 + 1] - HANN[v0]) * (vi - v0);
        let p = this.pos[k];
        const i0 = p | 0;
        let i1 = i0 + 1; if (i1 >= N) i1 = 0;
        const fr = p - i0;
        const xL = BL[i0] + (BL[i1] - BL[i0]) * fr;
        const xR = BR[i0] + (BR[i1] - BR[i0]) * fr;
        sL += xL * g * this.gL[k];
        sR += xR * g * this.gR[k];
        p += this.stap[k];
        if (p >= N) p -= N; else if (p < 0) p += N;
        this.pos[k] = p;
        const nf = f + this.fStap[k];
        if (nf >= 1) this.aan[k] = 0; else this.fase[k] = nf;
      }
      uitL[i] = sL * norm;
      uitR[i] = sR * norm;
    }
    this.w = w;
    let a = 0;
    for (let k = 0; k < MAX_KORRELS; k++) a += this.aan[k];
    this.actief = a;
  }
}
