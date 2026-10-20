// Herkomst: v1 youtube-mixer/src/engine/instrumenten/schaal-kern.js @ 6a640ac, ongewijzigd
// behalve het pad van de import. Puur: geen Web Audio, in Node te testen.
/**
 * De klankschaal als track-instrument, als rekenwerk: zonder Web Audio, in
 * Node te testen (docs/INSTRUMENTEN.md §7).
 *
 * Het geluid is dat van `SchaalKern` (klankschaal-kern.js, de Waterschaal):
 * resonatoren van twee polen, aanslaan, wrijven (stick-slip), dempen, slapen.
 * Deze klasse verandert alleen WAT er klinkt en WANNEER:
 *
 *   - Geen vaste ring van acht velden in een toonladder, maar TIEN NOTENVELDEN
 *     die per noot gestemd worden: elke MIDI-noot krijgt een veld op precies
 *     zijn toonhoogte (ST4: chromatisch). Een veld is het handpan-veld van de
 *     Waterschaal (grondtoon, zwevende partner, twee boventonen); KARAKTER
 *     schuift het naar de schaal, en dan bepaalt KLANK waarheen (brons is
 *     precies het origineel; kristal, glas en gong hebben hun eigen boventonen).
 *   - De KERN (de schaal zelf, zes zwevende paren) en het LICHAAM blijven: de
 *     kern staat op de grondtoon van wat je hoort (de hoofdthread stemt hem),
 *     zingt als je wrijft (aftertouch, modwiel) en klinkt zacht mee met noten
 *     die op zijn boventonen vallen.
 *   - Elke gebeurtenis heeft een TIJD op de audioklok. De berichten wachten in
 *     een gesorteerde rij en gaan in op hun sample: `blok()` rendert tot het
 *     eerstvolgende moment, past toe, en rendert verder.
 *
 * Audiopad (docs/AUDIOPAD.md): per blok geen afval. De rij is een vaste
 * array plus een Float64Array met tijden; tussenblokken gaan via vaste
 * kladbuffers; `t0` (de audioklok van het blok) is een VELD, geen argument
 * (een double over een functiegrens wordt een HeapNumber). Wat een bericht
 * kost blijft bij dat bericht (de browser maakt het al aan).
 *
 * Berichten (alle met optioneel `tijd`, s op de audioklok; zonder = nu):
 *   { t: 'slag', v, j, hz, pan, a: [4], ms, pe, lijf }  veld j op hz stemmen en aanslaan
 *   { t: 'los', j, t60 }        veld j losgelaten: uitklinken in hooguit t60 s (0 = vrij)
 *   { t: 'kernlos', t60 }       idem voor kern en lichaam
 *   { t: 'kern', hz }           de grondtoon van de kern
 *   { t: 'param', karakter, uitklank, klank, fijn }   uitklank = factor, klank = index in KLANK_NAMEN, fijn = cent
 *   { t: 'buig', c }            pitchbend in cent, alleen op de notenvelden
 *   { t: 'stil' }               alles meteen op nul (paniek; de hoofdthread dooft eerst uit)
 *   { t: 'wrijf', p, r }, { t: 'demp', v, aan }, { t: 'opt', fric, org }  zoals SchaalKern
 * Een 'stil' gooit bij AANKOMST alles weg wat nog in de rij stond.
 */
import { SchaalKern, KLANKEN, LICHAAM, MAX_MODI } from './klankschaal-kern.js';

export const NOOTVELDEN = 10;
/** De stem (v) van elk notenveld: 1..8 en 10, 11 (9 is het lichaam, 0 de kern). */
export const VELD_STEM = Int32Array.of(1, 2, 3, 4, 5, 6, 7, 8, 10, 11);
export const KLANK_NAMEN = ['brons', 'kristal', 'glas', 'gong'];
/** Indeling van de modi: kern 0..11, veld j op 12 + 4j .. 15 + 4j, lichaam 52. */
export const VELD0 = 12;
export const LIJF = VELD0 + 4 * NOOTVELDEN;
export const N_MODI = LIJF + 1;
/** Zoveel berichten kunnen er wachten; is de rij vol, dan gaat het vroegste meteen in. */
export const RIJ = 512;
/** Hoe sterk de wrijfstok elke boventoon voedt (klankschaal-kern.js, hardheid 0,2: 0,8 × zacht + 0,2 × hard). */
const WRIJF = [0.86, 0.44, 0.176, 0.078, 0.036, 0.022];
const TWEE_PI = 2 * Math.PI;

export class SchaalInstrumentKern extends SchaalKern {
  constructor(fs) {
    super(fs);
    if (N_MODI > MAX_MODI) throw new Error('te veel modi');
    // Klanken als vaste tabellen (klank × 6), zodat stemmen niets aanmaakt.
    const K = KLANK_NAMEN.length;
    this.kR = new Float64Array(K * 6); this.kS = new Float64Array(K * 6);
    this.kT = new Float64Array(K * 6); this.kG = new Float64Array(K * 6);
    this.kGlij = new Float64Array(K);
    KLANK_NAMEN.forEach((naam, k) => {
      const kl = KLANKEN[naam];
      for (let i = 0; i < 6; i++) {
        this.kR[k * 6 + i] = kl.r[i]; this.kS[k * 6 + i] = kl.split[i];
        this.kT[k * 6 + i] = kl.t[i]; this.kG[k * 6 + i] = kl.g[i];
      }
      this.kGlij[k] = kl.glijden;
    });
    this.mf = new Float64Array(MAX_MODI);       // frequentie zoals gebouwd (zonder fijn en buiging)
    this.mt = new Float64Array(MAX_MODI);       // t60 van nature
    this.veldHz = new Float64Array(NOOTVELDEN); // 0 = nog nooit gestemd
    this.veldPan = new Float64Array(NOOTVELDEN);
    this.veldLos = new Float64Array(NOOTVELDEN); // t60 na loslaten; 0 = vrij
    this.kernHz = 146.83;                        // D3, zoals de klankschaal zonder toonsoort
    this.kernLos = 0;
    this.karakter = 0.1;
    this.uitklank = 1;
    this.klank = 0;
    this.stemF = 1;                              // fijn, op alles
    this.buigF = 1;                              // pitchbend, op de notenvelden
    this.rdVast = Math.exp(-6.91 / (0.12 * fs)); // dempen: t60 0,12 s
    // De rij: berichten op volgorde van tijd (gelijke tijd: volgorde van aankomst).
    this.rij = new Array(RIJ).fill(null);
    this.rijT = new Float64Array(RIJ);
    this.rijN = 0;
    this.kladL = new Float32Array(128);
    this.kladR = new Float32Array(128);
    /** De audioklok van het blok dat nu gerenderd wordt. Een veld, geen argument (zie boven). */
    this.t0 = NaN;
    this.n = N_MODI;
    this._bouwAlles();
  }

  // ---- berichten -------------------------------------------------------------

  /** Een bericht in de rij, op zijn tijd (zonder tijd: `nu`). */
  bericht(d, nu = Number.isFinite(this.t0) ? this.t0 : 0) {
    if (d.t === 'stil') { for (let i = 0; i < this.rijN; i++) this.rij[i] = null; this.rijN = 0; }
    const t = typeof d.tijd === 'number' && d.tijd === d.tijd ? d.tijd : nu;
    if (this.rijN === RIJ) this._pasVroegsteToe();
    let i = this.rijN;
    while (i > 0 && this.rijT[i - 1] > t) { this.rij[i] = this.rij[i - 1]; this.rijT[i] = this.rijT[i - 1]; i--; }
    this.rij[i] = d; this.rijT[i] = t;
    this.rijN++;
  }

  _pasVroegsteToe() {
    const d = this.rij[0];
    for (let i = 1; i < this.rijN; i++) { this.rij[i - 1] = this.rij[i]; this.rijT[i - 1] = this.rijT[i]; }
    this.rijN--;
    this.rij[this.rijN] = null;
    this._pas(d);
  }

  _pas(d) {
    const t = d.t;
    if (t === 'slag') {
      const j = d.j;
      if (j >= 0 && j < NOOTVELDEN && d.hz > 0) {
        this.veldHz[j] = d.hz; this.veldPan[j] = d.pan || 0; this.veldLos[j] = 0;
        this._bouwVeld(j);
        super.bericht(d);
        if (d.lijf > 0) { this.inj[LIJF] += d.lijf * this.sw[LIJF]; this.slaapt = false; }
        this._meeklinken(d);
      } else super.bericht(d);
    } else if (t === 'los') {
      const j = d.j;
      if (j >= 0 && j < NOOTVELDEN) { this.veldLos[j] = d.t60 > 0 ? d.t60 : 0; this._bouwVeld(j); }
    } else if (t === 'kernlos') {
      this.kernLos = d.t60 > 0 ? d.t60 : 0;
      this._bouwKern();
    } else if (t === 'kern') {
      if (d.hz > 0) { this.kernHz = d.hz; this._bouwKern(); }
    } else if (t === 'param') {
      if (d.karakter >= 0) this.karakter = Math.min(1, d.karakter);
      if (d.uitklank > 0) this.uitklank = d.uitklank;
      if (d.klank >= 0 && d.klank < KLANK_NAMEN.length) this.klank = d.klank | 0;
      if (typeof d.fijn === 'number' && d.fijn === d.fijn) this.stemF = Math.pow(2, d.fijn / 1200);
      this._bouwAlles();
    } else if (t === 'buig') {
      this.buigF = typeof d.c === 'number' && d.c === d.c ? Math.pow(2, d.c / 1200) : 1;
      for (let j = 0; j < NOOTVELDEN; j++) if (this.veldHz[j] > 0) this._bouwVeld(j);
    } else if (t === 'stil') {
      this._stil();
    } else {
      super.bericht(d);                          // wrijf, demp, opt
    }
  }

  // ---- renderen op de tijd van de berichten ------------------------------------

  /**
   * Eén blok van `len` frames dat begint op `this.t0` (zet die eerst). Berichten
   * die in dit blok vallen gaan in op hun sample; wat te laat is meteen.
   */
  blok(L, R, len) {
    let pos = 0;
    while (this.rijN > 0) {
      let k = Math.round((this.rijT[0] - this.t0) * this.fs);
      if (k >= len) break;
      if (k < pos) k = pos;
      if (k > pos) { this._render(L, R, pos, k); pos = k; }
      this._pasVroegsteToe();
    }
    if (pos < len) this._render(L, R, pos, len);
  }

  _render(L, R, van, tot) {
    if (van === 0) { this.render(L, R, tot); return; }
    const n = tot - van;
    if (this.kladL.length < n) { this.kladL = new Float32Array(n); this.kladR = new Float32Array(n); }
    this.render(this.kladL, this.kladR, n);
    for (let s = 0; s < n; s++) { L[van + s] = this.kladL[s]; R[van + s] = this.kladR[s]; }
  }

  // ---- de modi bouwen (alleen hele getallen over functiegrenzen) -----------------

  _bouwAlles() {
    this._bouwKern();
    for (let j = 0; j < NOOTVELDEN; j++) this._bouwVeld(j);
  }

  /** Kern (zes paren, Waterschaal bouwModi) en lichaam op `kernHz`. */
  _bouwKern() {
    const K = this.klank * 6, u = this.uitklank, hz = this.kernHz, los = this.kernLos;
    for (let k = 0; k < 6; k++) {
      const n = k + 2, f = hz * this.kR[K + k], t60 = this.kT[K + k] * u, g = this.kG[K + k];
      const a = 2 * k, b = a + 1;
      this.mf[a] = f; this.mt[a] = t60; this.g[a] = g; this.v[a] = 0;
      this.kn[a] = n; this.kb[a] = 0; this.rw[a] = WRIJF[k];
      this.gl[a] = Math.cos(n * 0.35); this.gr[a] = Math.cos(n * 1.2);
      this.mf[b] = f + this.kS[K + k]; this.mt[b] = t60 * 0.82; this.g[b] = g; this.v[b] = 0;
      this.kn[b] = n; this.kb[b] = 1; this.rw[b] = WRIJF[k];
      this.gl[b] = Math.sin(n * 0.35); this.gr[b] = Math.sin(n * 1.2);
    }
    const i = LIJF;
    this.mf[i] = hz * 0.5; this.mt[i] = 1.3; this.g[i] = 0.9; this.v[i] = LICHAAM;
    this.kn[i] = 0; this.kb[i] = 0; this.rw[i] = 0; this.gl[i] = 0.75; this.gr[i] = 0.75;
    for (let m = 0; m < 12; m++) this._coef(m, los);
    this._coef(LIJF, los);
  }

  /**
   * Notenveld j: het veld van de Waterschaal (bouwModi) op `veldHz[j]`.
   * Karakter 0 = handpan (boventonen 2 en 3), 1 = de boventonen van de klank
   * (brons: 2,77 en 5,17, precies het origineel).
   */
  _bouwVeld(j) {
    const K = this.klank * 6, M = this.karakter;
    const f = this.veldHz[j] > 0 ? this.veldHz[j] : 440;
    const g0 = this.veldHz[j] > 0 ? 1 : 0;
    const r1 = 2 + (this.kR[K + 1] - 2) * M, r2 = 3 + (this.kR[K + 2] - 3) * M;
    const zweef = M * this.kS[K] * 1.125;                       // brons: 0,9 Hz × karakter
    const ts = (1 + 3.5 * M) * Math.sqrt(this.uitklank) * (this.kT[K] / 40);
    const pan = this.veldPan[j], pl = Math.sqrt(0.5 * (1 - pan)), pr = Math.sqrt(0.5 * (1 + pan));
    const v = VELD_STEM[j], i0 = VELD0 + 4 * j;
    this.mf[i0] = f; this.mt[i0] = 3.2 * ts; this.g[i0] = g0;
    this.mf[i0 + 1] = f + zweef; this.mt[i0 + 1] = 3.2 * ts; this.g[i0 + 1] = g0 * M;
    this.mf[i0 + 2] = f * r1; this.mt[i0 + 2] = 1.9 * ts; this.g[i0 + 2] = g0 * 0.42;
    this.mf[i0 + 3] = f * r2; this.mt[i0 + 3] = 1.1 * ts; this.g[i0 + 3] = g0 * 0.28;
    for (let q = 0; q < 4; q++) {
      const i = i0 + q;
      this.v[i] = v; this.kn[i] = 0; this.kb[i] = 0; this.rw[i] = 0; this.gl[i] = pl; this.gr[i] = pr;
      this._coef(i, this.veldLos[j]);
    }
  }

  /**
   * De coëfficiënten van modus i (SchaalKern 'modi'), met fijn en (op de
   * notenvelden) buiging. `los` > 0 kort de uitklank in tot hooguit `los` s.
   *
   * Wat klinkt houdt zijn AMPLITUDE en zijn fase. SchaalKern laat bij een
   * nieuwe stemming (y1, y2) staan; voor een paar cent (de klankschaal die van
   * toonsoort wisselt) maakt dat niet uit, maar een veld dat van 2 kHz naar
   * 55 Hz gaat (een gestolen veld, een nieuwe noot) zou dan tot f_oud / f_nieuw
   * keer harder klinken: die toestand betekent bij een lage toon een veel
   * grotere uitwijking (gemeten: × 7,8). Daarom: y1 blijft (de golfvorm
   * springt niet: geen tik), y2 wordt opnieuw uitgerekend voor de nieuwe
   * frequentie bij dezelfde amplitude en fase.
   */
  _coef(i, los) {
    const vi = this.v[i];
    const veld = vi !== 0 && vi !== LICHAAM;
    const t60 = los > 0 && los < this.mt[i] ? los : this.mt[i];
    const f = Math.min(this.mf[i] * this.stemF * (veld ? this.buigF : 1), this.fs * 0.45);
    const w = (TWEE_PI * f) / this.fs;
    const wOud = this.w0[i];
    if (wOud > 0 && w !== wOud && (this.y1[i] !== 0 || this.y2[i] !== 0)) {
      // y[n] = A sin(φ), y[n−1] = A sin(φ − w)  ⇒  A cos(φ) = (y1 cos w − y2) / sin w
      const so = Math.sin(wOud);
      if (so > 1e-12) {
        const s = this.y1[i], c = (s * Math.cos(wOud) - this.y2[i]) / so;
        this.y2[i] = s * Math.cos(w) - c * Math.sin(w);
      }
    }
    const r = Math.exp(-6.91 / (t60 * this.fs)), rd = this.rdVast;
    this.a1[i] = 2 * r * Math.cos(w); this.a2[i] = r * r;
    this.d1[i] = 2 * rd * Math.cos(w); this.d2[i] = rd * rd;
    this.w0[i] = w; this.rr[i] = r; this.rd[i] = rd;
    if (!this.drt[i]) { this.dph[i] = (this.rnd() + 1) * Math.PI; this.drt[i] = 0.03 + (this.rnd() + 1) * 0.045; }
    this.sw[i] = Math.sin(w); this.nrm[i] = Math.sin(w) * Math.sqrt(2 * (1 - r * r));
  }

  /**
   * Velden en kern met (bijna) dezelfde toon als een boventoon van de
   * aanslag klinken zacht mee, zoals bij de klankschaal (`_meeresoneer`):
   * binnen 2%, sterkte 0,16 × de boventoon, aflopend naar de rand.
   */
  _meeklinken(d) {
    const j = d.j, v = VELD_STEM[j], i0 = VELD0 + 4 * j, a = d.a;
    for (let i = 0; i < N_MODI; i++) {
      const vi = this.v[i];
      if (vi === v || vi === LICHAAM || this.g[i] === 0) continue;
      const wi = this.w0[i];
      let s = 0;
      for (let q = 0; q < 4; q++) {
        if (q === 1) continue;                        // de zwevende partner niet (zoals het origineel)
        const dd = Math.abs(wi / this.w0[i0 + q] - 1);
        if (dd < 0.02) s += (a[q] || 0) * 0.16 * (1 - dd / 0.02);
      }
      if (s > 0.004) { this.inj[i] += s * this.sw[i]; this.slaapt = false; }
    }
  }

  /**
   * Paniek: alle resonatoren, de stok en wat onderweg is op nul, en slapen.
   * Loslaten en buiging terug (de hoofdthread vergeet ze ook); de stemming blijft.
   */
  _stil() {
    for (let i = 0; i < MAX_MODI; i++) { this.y1[i] = 0; this.y2[i] = 0; this.inj[i] = 0; this.injN[i] = 0; }
    this.pe.fill(0); this.dp.fill(0);
    this.pr = 0; this.prT = 0; this.rot = 0; this.rotT = 0; this.cv = 0;
    this.env0 = 0; this.ly0 = 0; this.hp = 0; this.hx = 0; this.air = 0;
    this.veldLos.fill(0); this.kernLos = 0; this.buigF = 1;
    this._bouwAlles();
    this.slaapt = true;
  }
}
