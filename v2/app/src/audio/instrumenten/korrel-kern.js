/**
 * De korrelwolk als INSTRUMENT, als rekenwerk (puur, in Node te testen). Een bron (een stuk geluid:
 * gevangen uit een track, of de eigen klank tot er iets gevangen is) wordt per noot op toonhoogte
 * uit korrels opgebouwd: de toonhoogte zit in de afspeelsnelheid van elke korrel (noot − grondnoot
 * van de bron), niet in een filter, dus elk stuk geluid wordt een speelbaar instrument.
 *
 *   STEMMEN stemmen, elk met een leeskop die door de bron schuift (`scan`) en een omhullende
 *   (aanzet/loslaten); KORRELS korrels die de stemmen delen (Hann-venster, eigen kant en spreiding).
 *
 * Berichten (alle met optioneel `tijd`, s op de audioklok; ze gaan in op het eerste blok erna):
 *   { t: 'bron', L, R, n, grond }   een nieuwe bron (Float32Array's, n samples, de noot die hij is)
 *   { t: 'aan', stem, rate, v }      stem op `rate` (2^((noot − grond)/12)), sterkte v
 *   { t: 'uit', stem }               stem loslaten (de omhullende zakt in `loslaten` s)
 *   { t: 'param', grootte, dichtheid, scan, toon, positie, aanzet, loslaten, spray, breedte }
 *   { t: 'stil' }                    alles meteen op nul
 *
 * GEEN AFVAL per blok (BOUWREGELS "HET AUDIOPAD MAAKT GEEN AFVAL"): alles vast vanaf de constructor;
 * een bericht mag kosten wat het kost (de browser maakt het al aan). `t0` is een VELD (schaal-kern.js).
 * Toeval uit een eigen LCG.
 */

export const STEMMEN = 8;
export const KORRELS = 96;
export const RIJ = 256;
/** De eigen bron tot er iets gevangen is: 4 s, grondnoot C4. */
export const EIGEN_S = 4;
export const EIGEN_GROND = 60;
const VENSTER = 1024;
const HANN = new Float32Array(VENSTER + 1);
for (let i = 0; i <= VENSTER; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / VENSTER);
/** Make-up voor venster en 1/√n (zoals de korrelwolk als effect). */
const MAKEUP = 1.4;
const PARAM_NAMEN = Object.freeze(['grootte', 'dichtheid', 'scan', 'toon', 'positie', 'aanzet', 'loslaten', 'spray', 'breedte']);

export class KorrelInstrumentKern {
  constructor(sr, zaad = 0x51ed) {
    this.sr = sr;
    this.t0 = 0;
    this.s = zaad >>> 0 || 1;
    // De eigen bron: een zacht akkoord (C, G, E) met boventonen en wat lucht. Eén keer, in de constructor.
    const n = Math.floor(sr * EIGEN_S);
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
    const deel = [[261.63, 0.5], [392.0, 0.28], [329.63, 0.22], [523.25, 0.16], [784.0, 0.08], [130.81, 0.25]];
    let ruisL = 0, ruisR = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let x = 0;
      for (const [f, a] of deel) x += a * Math.sin(2 * Math.PI * f * t + a * Math.sin(2 * Math.PI * 0.3 * t));
      ruisL = ruisL * 0.97 + (this._r() * 2 - 1) * 0.03;
      ruisR = ruisR * 0.97 + (this._r() * 2 - 1) * 0.03;
      const adem = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.25 * t);
      this.L[i] = (x * 0.45 + ruisL * 0.6) * adem;
      this.R[i] = (x * 0.45 + ruisR * 0.6) * adem;
    }
    this.n = n;
    this.grond = EIGEN_GROND;
    // Parameters (geschaald door korrel.js):
    this.grootte = 0.12; this.dichtheid = 25; this.scan = 0.1; this.toon = 0; this.positie = 0.2;
    this.aanzet = 0.02; this.loslaten = 0.6; this.spray = 0.08; this.breedte = 0.6;
    // Stemmen.
    this.sAan = new Uint8Array(STEMMEN);
    this.sRate = new Float64Array(STEMMEN);
    this.sV = new Float64Array(STEMMEN);
    this.sEnv = new Float64Array(STEMMEN);     // 0..1
    this.sLos = new Uint8Array(STEMMEN);       // 1 = losgelaten (zakt)
    this.sKop = new Float64Array(STEMMEN);     // leeskop in de bron (samples)
    this.sTot = new Float64Array(STEMMEN);     // samples tot de volgende korrel van deze stem
    // Korrels.
    this.kAan = new Uint8Array(KORRELS);
    this.kPos = new Float64Array(KORRELS);
    this.kStap = new Float64Array(KORRELS);
    this.kFase = new Float64Array(KORRELS);
    this.kFStap = new Float64Array(KORRELS);
    this.kGL = new Float32Array(KORRELS);
    this.kGR = new Float32Array(KORRELS);
    this.kStem = new Int32Array(KORRELS);
    // De rij: vaste arrays (schaal-kern.js).
    this.rij = new Array(RIJ).fill(null);
    this.rijT = new Float64Array(RIJ);
    this.rijN = 0;
    this.actief = 0;
  }

  _r() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }

  /** Een bericht in de rij, op zijn tijd (zonder: nu). Een 'stil' gooit alles weg wat nog wachtte. */
  bericht(d, nu = this.t0) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'stil') { this.rijN = 0; this._stil(); return; }
    if (d.t === 'bron') { this._bron(d); return; }
    const t = Number.isFinite(d.tijd) ? d.tijd : nu;
    if (this.rijN === RIJ) { this._pas(this.rij[0]); this._schuif(0); }
    let i = this.rijN;
    while (i > 0 && this.rijT[i - 1] > t) { this.rij[i] = this.rij[i - 1]; this.rijT[i] = this.rijT[i - 1]; i--; }
    this.rij[i] = d; this.rijT[i] = t; this.rijN++;
  }

  _schuif(i) { for (let j = i; j < this.rijN - 1; j++) { this.rij[j] = this.rij[j + 1]; this.rijT[j] = this.rijT[j + 1]; } this.rijN--; this.rij[this.rijN] = null; }

  _bron(d) {
    if (!(d.L instanceof Float32Array) || !(d.R instanceof Float32Array) || !(d.n > this.sr * 0.05)) return;
    // De oude korrels lezen uit de oude bron: eerst alles stil, dan de nieuwe (een bron wisselen is een keuze, geen gebaar).
    for (let k = 0; k < KORRELS; k++) this.kAan[k] = 0;
    this.L = d.L; this.R = d.R; this.n = Math.min(d.n, d.L.length, d.R.length);
    this.grond = Number.isFinite(d.grond) ? d.grond : EIGEN_GROND;
    for (let s = 0; s < STEMMEN; s++) this.sKop[s] = this.positie * this.n;
  }

  _stil() {
    for (let s = 0; s < STEMMEN; s++) { this.sAan[s] = 0; this.sEnv[s] = 0; this.sLos[s] = 0; }
    for (let k = 0; k < KORRELS; k++) this.kAan[k] = 0;
  }

  _pas(d) {
    if (d.t === 'aan') {
      const s = d.stem | 0;
      if (s < 0 || s >= STEMMEN) return;
      const nieuw = !this.sAan[s] || this.sLos[s];
      this.sAan[s] = 1; this.sLos[s] = 0;
      this.sRate[s] = d.rate > 0 ? d.rate : 1;
      this.sV[s] = d.v > 0 ? d.v : 0.8;
      if (nieuw) { this.sKop[s] = this.positie * this.n; this.sTot[s] = 0; }
    } else if (d.t === 'uit') {
      const s = d.stem | 0;
      if (s >= 0 && s < STEMMEN && this.sAan[s]) this.sLos[s] = 1;
    } else if (d.t === 'param') {
      for (let i = 0; i < PARAM_NAMEN.length; i++) { const k = PARAM_NAMEN[i]; if (Number.isFinite(d[k])) this[k] = d[k]; }
    }
  }

  _korrel(s) {
    let k = -1;
    for (let i = 0; i < KORRELS; i++) if (!this.kAan[i]) { k = i; break; }
    if (k < 0) return;
    const sr = this.sr, n = this.n;
    let ht = 0;
    if (this.toon > 0.01) {
      const r = this._r();
      ht = r < 0.45 ? 0 : r < 0.7 ? (this._r() < 0.5 ? -12 : 12) : r < 0.85 ? 7 : (this._r() * 2 - 1) * this.toon;
      if (Math.abs(ht) > this.toon) ht = ht > 0 ? this.toon : -this.toon;
    }
    const stap = this.sRate[s] * Math.pow(2, ht / 12);
    const lengte = Math.max(0.008, this.grootte) * sr;
    let p = this.sKop[s] + (this._r() * 2 - 1) * this.spray * sr;
    // Binnen de bron blijven: de korrel leest `lengte · stap` samples vanaf p.
    const nodig = lengte * stap + 2;
    if (nodig >= n) p = 0;
    else { p = ((p % n) + n) % n; if (p + nodig > n) p = n - nodig; }
    const kant = (this._r() * 2 - 1) * this.breedte;
    const hoek = (kant + 1) * Math.PI / 4;
    this.kAan[k] = 1; this.kPos[k] = p; this.kStap[k] = stap; this.kFase[k] = 0; this.kFStap[k] = 1 / lengte;
    this.kGL[k] = Math.cos(hoek); this.kGR[k] = Math.sin(hoek); this.kStem[k] = s;
  }

  /** Eén blok vanaf `this.t0`: eerst wat er tot nu in de rij staat, dan renderen. */
  blok(uitL, uitR, nS) {
    const tEind = this.t0 + nS / this.sr;
    while (this.rijN > 0 && this.rijT[0] < tEind) { const d = this.rij[0]; this._schuif(0); this._pas(d); }
    const sr = this.sr, n = this.n, L = this.L, R = this.R;
    const aanS = 1 / Math.max(0.001, this.aanzet * sr), losS = 1 / Math.max(0.005, this.loslaten * sr);
    const interval = sr / Math.max(1, this.dichtheid);
    const overlap = Math.max(1, this.dichtheid * Math.max(0.008, this.grootte));
    const norm = MAKEUP / Math.sqrt(overlap);
    const scan = this.scan;
    for (let i = 0; i < nS; i++) {
      // Stemmen: omhullende, leeskop, nieuwe korrels.
      for (let s = 0; s < STEMMEN; s++) {
        if (!this.sAan[s]) continue;
        if (this.sLos[s]) { this.sEnv[s] -= losS; if (this.sEnv[s] <= 0) { this.sEnv[s] = 0; this.sAan[s] = 0; this.sLos[s] = 0; continue; } }
        else if (this.sEnv[s] < 1) { this.sEnv[s] += aanS; if (this.sEnv[s] > 1) this.sEnv[s] = 1; }
        let kop = this.sKop[s] + scan;
        if (kop >= n) kop -= n; else if (kop < 0) kop += n;
        this.sKop[s] = kop;
        if (--this.sTot[s] <= 0) { this._korrel(s); this.sTot[s] = interval * (0.5 + this._r()); }
      }
      let sL = 0, sR = 0;
      for (let k = 0; k < KORRELS; k++) {
        if (!this.kAan[k]) continue;
        const f = this.kFase[k];
        const vi = f * VENSTER, v0 = vi | 0;
        const g = (HANN[v0] + (HANN[v0 + 1] - HANN[v0]) * (vi - v0)) * this.sEnv[this.kStem[k]] * this.sV[this.kStem[k]];
        const p = this.kPos[k], i0 = p | 0, i1 = i0 + 1 < n ? i0 + 1 : i0, fr = p - i0;
        sL += (L[i0] + (L[i1] - L[i0]) * fr) * g * this.kGL[k];
        sR += (R[i0] + (R[i1] - R[i0]) * fr) * g * this.kGR[k];
        this.kPos[k] = p + this.kStap[k];
        const nf = f + this.kFStap[k];
        if (nf >= 1 || this.kPos[k] >= n - 1) this.kAan[k] = 0; else this.kFase[k] = nf;
      }
      uitL[i] = sL * norm;
      uitR[i] = sR * norm;
    }
    let a = 0;
    for (let k = 0; k < KORRELS; k++) a += this.kAan[k];
    this.actief = a;
  }
}
