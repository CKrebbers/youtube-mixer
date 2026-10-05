/**
 * De master-limiter als rekenwerk: een brickwall-limiter met vooruitblik,
 * zonder Web Audio (docs/MASTER.md).
 *
 * Wat hij belooft: geen sample, en geen piek TUSSEN twee samples (true peak,
 * 4× oversampling van de piekdetectie), komt boven het plafond (−1 dBFS).
 * Onder het plafond doet hij niets: de gain is dan precies 1, bit voor bit
 * de invoer, alleen later. Links en rechts krijgen dezelfde gain
 * (stereo-gekoppeld), anders schuift het stereobeeld bij elke piek.
 *
 * Per sample, in vier stappen:
 *   1. piek: de grootste van |x| en drie tussenwaarden (¼, ½, ¾) per kanaal,
 *      geïnterpoleerd met een windowed sinc van 24 tikken per fase. Daarvoor
 *      moet hij K = 12 samples vooruit kijken. Niet de 12 tikken van ITU-R
 *      BS.1770: die zakken boven 15 kHz weg (−0,9 dB op 18 kHz) en lazen op
 *      muziek met hihats 0,08 dB te laag; 24 tikken zijn vlak tot 18 kHz
 *      (−0,002 dB) en op 20 kHz −0,19 dB.
 *      Kan geen enkele piek in een blok het plafond halen (de som van de
 *      tikken × de grootste sample), dan slaat hij dit over: zacht kost niets.
 *   2. nodig: de gain die die piek op het plafond zet (1 als hij eronder blijft).
 *   3. vasthouden: het minimum van "nodig" over het venster van L + 1
 *      samples (de vooruitblik), daarna loslaten met een release van 80 ms.
 *   4. gladmaken: het gemiddelde van die envelop over hetzelfde venster. De
 *      gain zakt zo in L samples lineair naar het niveau van de piek en staat
 *      er precies als de piek naar buiten komt.
 * Het geluid gaat N = L + K samples vertraagd naar buiten (1,5 ms: 72 op
 * 48 kHz). Die vertraging staat in hoorbaar.js (wat je hoort, één plek).
 *
 * Waarom dit klopt: elke envelopwaarde in het venster rond de uitgaande
 * sample is ≤ de "nodig" van die sample (het minimum ging over een venster
 * dat hem bevat), dus hun gemiddelde ook.
 *
 * GEEN IMPORTS en GEEN AFVAL per blok (docs/AUDIOPAD.md): alles staat vooraf
 * in Float64Arrays, de hulpvelden zijn hele getallen of doubles die V8 ter
 * plekke overschrijft. De worklet (limiter-worklet.js) roept alleen
 * `render()` aan; de tests draaien dezelfde code in Node.
 *
 * Herbruikt: de windowed sinc (Blackman) van de FIR-decimator en het
 * herrekenen van een lopende som tegen drift uit Clay's Visual app
 * (src/audio/dsp.js: Decimator, RunningMeanRemover); de gekoppelde
 * piekdetectie en het idee van de limiter uit MediSynth-hub (src/audio/dsp.js).
 */

/** Het plafond (dBFS, true peak). */
export const PLAFOND_DB = -1;
/** De vooruitblik, en dus de vertraging van alles wat door de master gaat (s). */
export const VOORUIT = 0.0015;
/** Release: zo snel komt de gain terug na een piek (tijdconstante, s). */
export const RELEASE = 0.08;
/** Tikken per kant per fase van de interpolator: 2K = 24 tikken. */
export const FIR_HALF = 12;
/** Oversampling van de piekdetectie. */
export const OVERSAMPLING = 4;
/**
 * Zoveel onder het plafond mikt de detectie (dB). Vier punten per sample
 * missen de top van een golf die er net tussen valt: bij 5 kHz hooguit
 * 0,03 dB, bij een zuivere toon van 10 kHz 0,12 dB. Op muziek liggen de
 * hoogste toppen in de bas en het midden; de marge vangt de rest. Gemeten
 * (16× met 96 tikken): muziek met klappen en hihats −1,05 dBTP, tonen van
 * 1–15 kHz −1,06..−1,10; alleen een blokgolf ZONDER bandbegrenzing (Gibbs)
 * kwam op −0,98.
 */
export const MARGE_DB = 0.1;

/** Alles erboven (of NaN) is een kapot getal van verderop in de keten: dan 0. */
const GROOT = 1e6;
/** Zo dicht bij zijn doel springt de envelop erop (lineair; −9·10⁻⁹ dB). */
const SNAP = 1e-9;
/** Een klem pas tellen als hij er echt boven zat (niet om één ulp). */
const KLEM_MARGE = 1 + 1e-6;

/** De vertraging in samples: N = L + K, minstens K + 1 (één sample vooruitblik). */
export function vertragingFrames(sampleRate, vooruit = VOORUIT) {
  return Math.max(FIR_HALF + 1, Math.round(vooruit * sampleRate));
}

/**
 * De tikken van de drie tussenfasen (¼, ½, ¾), elk 2K lang, achter elkaar.
 * Tik k hoort bij sample j − K + 1 + k (j = de sample links van het punt).
 * Windowed sinc op de Nyquist van de invoer, Blackman over ±K, per fase
 * genormaliseerd op 1 (een gelijkspanning blijft wat hij is).
 */
export function maakTikken(K = FIR_HALF, os = OVERSAMPLING) {
  const T = 2 * K;
  const tikken = new Float64Array((os - 1) * T);
  for (let p = 1; p < os; p++) {
    const mu = p / os;
    let som = 0;
    for (let k = 0; k < T; k++) {
      const d = mu - (k - K + 1);               // afstand van het punt tot deze sample
      const sinc = Math.sin(Math.PI * d) / (Math.PI * d);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / K) + 0.08 * Math.cos((2 * Math.PI * d) / K);
      tikken[(p - 1) * T + k] = sinc * w;
      som += sinc * w;
    }
    for (let k = 0; k < T; k++) tikken[(p - 1) * T + k] /= som;
  }
  return tikken;
}

export class LimiterKern {
  /**
   * @param {number} sampleRate
   * @param {{ plafondDb?: number, vooruit?: number, release?: number, margeDb?: number }} [opties]
   */
  constructor(sampleRate, { plafondDb = PLAFOND_DB, vooruit = VOORUIT, release = RELEASE, margeDb = MARGE_DB } = {}) {
    this.sr = sampleRate;
    this.plafond = Math.pow(10, plafondDb / 20);
    this.doel = Math.pow(10, (plafondDb - margeDb) / 20);   // waar de detectie op mikt
    this.K = FIR_HALF;
    this.T = 2 * FIR_HALF;
    this.N = vertragingFrames(sampleRate, vooruit);
    this.L = this.N - this.K;                  // vooruitblik van de gain
    this.W = this.L + 1;                       // venster van vasthouden en gladmaken
    this.invW = 1 / this.W;
    this.tikken = maakTikken(this.K, OVERSAMPLING);
    // Geen tussenwaarde kan groter zijn dan de grootste sample in het venster
    // × de som van de tikken. Blijft elke sample onder doel / somAbs, dan kan
    // niets het plafond halen en hoeft er niet geïnterpoleerd te worden.
    let somAbs = 1;
    for (let f = 0; f < OVERSAMPLING - 1; f++) {
      let a = 0;
      for (let k = 0; k < this.T; k++) a += Math.abs(this.tikken[f * this.T + k]);
      if (a > somAbs) somAbs = a;
    }
    this.stilDrempel = this.doel / somAbs;
    this.luid = 0;                             // zoveel samples moet er nog geïnterpoleerd worden
    this.rel = 1 - Math.exp(-1 / (release * sampleRate));

    // Geschiedenis van de invoer: genoeg voor de vertraging en de interpolator.
    // Elke sample staat er twee keer in (op p en p + H): dan ligt het venster
    // van de interpolator altijd aaneen en hoeft de binnenste lus niet te maskeren.
    let H = 16;
    while (H < this.N + this.T + 2) H *= 2;
    this.H = H;
    this.mask = H - 1;
    this.xl = new Float64Array(2 * H);
    this.xr = new Float64Array(2 * H);
    this.pos = 0;

    // Lopend minimum over W samples: een deque met oplopende waarden (de
    // voorste is het minimum). Tijden als hele getallen, gemaskeerd zodat ze
    // nooit groter worden dan een klein geheel getal van V8.
    this.cap = this.W + 1;
    this.dqV = new Float64Array(this.cap);
    this.dqT = new Int32Array(this.cap);
    this.dqKop = 0;
    this.dqN = 0;
    this.t = 0;

    this.e = 1;                                // de envelop (≤ wat nodig is)
    // Gladmaken: het gemiddelde van de envelop, als lopende som van 1 − e.
    // Onder het plafond is 1 − e precies 0, dus de som ook, en de gain precies 1.
    this.r = new Float64Array(this.W);
    this.rPos = 0;
    this.rSom = 0;

    this.minGain = 1;                          // laagste gain van het laatste blok
    this.geklemd = 0;                          // vangnet: samples die er toch boven zaten (hoort 0 te blijven)
  }

  /**
   * Eén blok. `gainUit` (mag null zijn) krijgt per sample de gain die erop
   * zat: daaruit leest de hoofdthread de gain reduction.
   */
  render(inL, inR, uitL, uitR, gainUit, n) {
    const { xl, xr, mask, H, K, T, N, W, tikken, dqV, dqT, cap, r } = this;
    const c = this.plafond, doel = this.doel, stil = this.stilDrempel, rel = this.rel, invW = this.invW;
    let pos = this.pos, t = this.t, e = this.e, rPos = this.rPos, rSom = this.rSom, luid = this.luid;
    let dqKop = this.dqKop, dqN = this.dqN, minGain = 1;
    for (let i = 0; i < n; i++) {
      let a = inL[i], b = inR[i];
      if (!(a <= GROOT && a >= -GROOT)) a = 0;
      if (!(b <= GROOT && b >= -GROOT)) b = 0;
      pos = (pos + 1) & mask;
      xl[pos] = a; xl[pos + H] = a;
      xr[pos] = b; xr[pos + H] = b;
      // Een sample boven de stildrempel telt mee in de volgende T interpolaties.
      if (a > stil || a < -stil || b > stil || b < -stil) luid = T;

      // 1. De piek van het stuk tussen sample j = pos − K en de volgende,
      // 2. en wat er nodig is om die op het doel te zetten.
      let nodig = 1;
      if (luid > 0) {
        luid--;
        const j = (pos - K) & mask;
        let piek = Math.abs(xl[j]);
        const pr = Math.abs(xr[j]);
        if (pr > piek) piek = pr;
        const begin = (pos - T + 1) & mask;    // + T − 1 < 2H: aaneen dankzij de kopie
        for (let f = 0; f < 3; f++) {
          let sl = 0, sr = 0;
          const o = f * T;
          for (let k = 0; k < T; k++) {
            const h = tikken[o + k];
            sl += h * xl[begin + k];
            sr += h * xr[begin + k];
          }
          if (sl < 0) sl = -sl;
          if (sr < 0) sr = -sr;
          if (sl > piek) piek = sl;
          if (sr > piek) piek = sr;
        }
        if (piek > doel) nodig = doel / piek;
      }

      // 3. Het minimum over het venster (deque), dan de envelop.
      t = (t + 1) & 0x3fffffff;
      while (dqN > 0) {
        let achter = dqKop + dqN - 1;
        if (achter >= cap) achter -= cap;
        if (dqV[achter] < nodig) break;
        dqN--;
      }
      let plek = dqKop + dqN;
      if (plek >= cap) plek -= cap;
      dqV[plek] = nodig;
      dqT[plek] = t;
      dqN++;
      if (((t - dqT[dqKop]) & 0x3fffffff) >= W) {
        dqKop = dqKop + 1 === cap ? 0 : dqKop + 1;
        dqN--;
      }
      const vast = dqV[dqKop];
      if (vast < e) e = vast;
      else {
        e += (vast - e) * rel;
        if (vast - e < SNAP) e = vast;
      }

      // 4. Gladmaken over hetzelfde venster.
      const rn = 1 - e;
      rSom += rn - r[rPos];
      r[rPos] = rn;
      rPos = rPos + 1 === W ? 0 : rPos + 1;
      const g = rSom > 0 ? 1 - rSom * invW : 1;

      // Naar buiten: N samples later, met de gain.
      const d = (pos - N) & mask;
      let yl = xl[d] * g, yr = xr[d] * g;
      if (yl > c || yl < -c || yr > c || yr < -c) {
        if (Math.abs(yl) > c * KLEM_MARGE || Math.abs(yr) > c * KLEM_MARGE) this.geklemd++;
        if (yl > c) yl = c; else if (yl < -c) yl = -c;
        if (yr > c) yr = c; else if (yr < -c) yr = -c;
      }
      uitL[i] = yl;
      uitR[i] = yr;
      if (gainUit !== null) gainUit[i] = g;
      if (g < minGain) minGain = g;
    }
    // De lopende som drijft (optellen en aftrekken in floating point): één
    // keer per blok exact opnieuw. Na stilte staat hij zo weer op precies 0.
    let s = 0;
    for (let k = 0; k < W; k++) s += r[k];
    this.rSom = s;
    this.pos = pos; this.t = t; this.e = e; this.rPos = rPos; this.luid = luid;
    this.dqKop = dqKop; this.dqN = dqN;
    this.minGain = minGain;
  }
}
