/**
 * Beat tracking meten zoals mir_eval.beat (versie 0.8.2) het doet: F-maat, Cemgil, Goto, P-score en de
 * continuïteitsmaten CMLc/CMLt/AMLc/AMLt. Pure JS, geen afhankelijkheden; ook in de browser bruikbaar.
 *
 * Zo letterlijk mogelijk overgenomen, ook de eigenaardigheden (die bepalen de getallen):
 *   - evaluate() gooit eerst alle tellen vóór 5 s weg (trim_beats), in referentie én schatting.
 *   - De metrische varianten (Cemgil best, AML*): de referentie zelf, de tegentel (de middens),
 *     dubbel tempo (referentie + middens), half tempo oneven (elke tweede vanaf de eerste) en even.
 *     Een midden is (r[j+1] − r[j]) · 0,5 + r[j], zoals np.interp het uitrekent.
 *   - F-maat: maximale koppeling binnen ±70 ms (mir_eval: Hopcroft-Karp). Elke schatting kan alleen
 *     een aaneengesloten reeks referenties raken en die reeksen schuiven mee op, dus de hebzuchtige
 *     koppeling (kleinste vrije referentie) is hier ook maximaal. Dezelfde vergelijkingen: r ≥ e − w en r ≤ e + w.
 *   - Goto: de eerste en laatste referentietel tellen altijd als fout (beat_error begint op 1), en het
 *     langste spoor neemt zijn twee foute randen mee in gemiddelde en spreiding (ddof = 1).
 *   - P-score: tellen op 10 ms (ceil), impulstreinen, correlatie binnen ±round(0,2 × mediaan interval)
 *     (np.round: half naar even), gedeeld door het grootste aantal tellen.
 *   - Continuïteit: fase en periode < 17,5%, de "beat_successes" zijn zo lang als de langste van de
 *     twee reeksen (een te korte schatting telt de rest als fout).
 * Gevalideerd tegen mir_eval 0.8.2 zelf: beat-eval.test.mjs, met de uitkomsten in beat-eval-mireval.json.
 * Niet overgenomen: information_gain (niet gevraagd).
 *
 * Alle tijden in seconden, oplopend (niet-dalend).
 */

export const MIN_TEL_TIJD = 5.0;          // mir_eval.beat.trim_beats
export const F_VENSTER = 0.07;            // f_measure_threshold
export const CEMGIL_SIGMA = 0.04;
export const GOTO = { drempel: 0.35, mu: 0.2, sigma: 0.2 };
export const P_DREMPEL = 0.2;
export const CONT_FASE = 0.175, CONT_PERIODE = 0.175;
export const MAX_TIJD = 30000.0;

const arr = (x) => Float64Array.from(x ?? []);

/** Python-index: negatief telt van achteren (zoals reference_beats[-1]). */
const py = (a, i) => a[i < 0 ? a.length + i : i];

/** Python-slice a[van:tot] (alleen stap 1), met negatieve grenzen zoals Python. */
function pySlice(a, van, tot) {
  const n = a.length;
  const norm = (i) => (i < 0 ? Math.max(0, n + i) : Math.min(n, i));
  const v = norm(van), t = norm(tot);
  return t > v ? a.slice(v, t) : new Float64Array(0);
}

/** trim_beats: alleen tellen op of na min_beat_time. */
export function trimBeats(beats, minTijd = MIN_TEL_TIJD) {
  return arr(beats).filter((b) => b >= minTijd);
}

/** validate (zonder de waarschuwingen): gooit zoals mir_eval bij te grote of dalende tijden. */
export function valideer(ref, est) {
  for (const b of [ref, est]) {
    for (let i = 0; i < b.length; i++) {
      if (b[i] > MAX_TIJD) throw new Error(`tel op ${b[i]} s is groter dan ${MAX_TIJD} (seconden?)`);
      if (i > 0 && b[i] < b[i - 1]) throw new Error('tellen moeten oplopen');
    }
  }
}

/** _get_reference_beat_variations: [ref, tegentel, dubbel, half oneven, half even]. */
export function variaties(ref) {
  const n = ref.length;
  const dubbel = new Float64Array(Math.max(0, 2 * n - 1));
  for (let k = 0; k < dubbel.length; k++) {
    const j = k >> 1;
    // np.interp: precies op een knoop de waarde zelf, daartussen helling × (x − x_j) + y_j.
    dubbel[k] = k % 2 === 0 ? ref[j] : (ref[j + 1] - ref[j]) * 0.5 + ref[j];
  }
  const elke = (a, start) => { const u = []; for (let i = start; i < a.length; i += 2) u.push(a[i]); return Float64Array.from(u); };
  return [Float64Array.from(ref), elke(dubbel, 1), dubbel, elke(ref, 0), elke(ref, 1)];
}

/** Aantal paren in de maximale koppeling binnen ±venster (util.match_events). */
export function koppel(ref, est, venster) {
  const r = Float64Array.from(ref).sort();
  const e = Float64Array.from(est).sort();
  let i = 0, n = 0;
  for (let j = 0; j < e.length; j++) {
    const lo = e[j] - venster, hi = e[j] + venster;
    while (i < r.length && !(r[i] >= lo)) i++;
    if (i < r.length && r[i] <= hi) { n++; i++; }
  }
  return n;
}

export function fMaat(ref, est, venster = F_VENSTER) {
  ref = arr(ref); est = arr(est); valideer(ref, est);
  if (est.length === 0 || ref.length === 0) return 0.0;
  const m = koppel(ref, est, venster);
  const precisie = m / est.length, recall = m / ref.length;
  if (precisie === 0 && recall === 0) return 0.0;
  return (1 + 1) * precisie * recall / (1 * precisie + recall);
}

/** Cemgil: [op het juiste niveau, beste van de vijf varianten]. */
export function cemgil(ref, est, sigma = CEMGIL_SIGMA) {
  ref = arr(ref); est = arr(est); valideer(ref, est);
  if (est.length === 0 || ref.length === 0) return [0.0, 0.0];
  const noemer = 2.0 * sigma ** 2;
  const uit = variaties(ref).map((r) => {
    let acc = 0;
    for (const b of r) {
      let d = Infinity;
      for (const e of est) { const x = Math.abs(b - e); if (x < d) d = x; }
      acc += Math.exp(-(d ** 2) / noemer);
    }
    return acc / (0.5 * (est.length + r.length));
  });
  return [uit[0], Math.max(...uit)];
}

const gem = (a) => { let s = 0; for (const x of a) s += x; return s / a.length; };
const std1 = (a) => { const m = gem(a); let s = 0; for (const x of a) s += (x - m) ** 2; return Math.sqrt(s / (a.length - 1)); };

export function goto(ref, est, { drempel = GOTO.drempel, mu = GOTO.mu, sigma = GOTO.sigma } = {}) {
  ref = arr(ref); est = arr(est); valideer(ref, est);
  if (est.length === 0 || ref.length === 0) return 0.0;
  const N = ref.length;
  const fout = new Float64Array(N).fill(1);
  for (let n = 1; n < N - 1; n++) {
    const vorig = 0.5 * (ref[n] - ref[n - 1]);
    const lo = ref[n] - vorig;
    const volg = 0.5 * (ref[n + 1] - ref[n]);
    const hi = ref[n] + volg;
    let aantal = 0, welke = -1;
    for (let j = 0; j < est.length; j++) if (est[j] >= lo && est[j] < hi) { aantal++; welke = j; }
    if (aantal !== 1) { fout[n] = 1; continue; }
    const offset = est[welke] - ref[n];
    fout[n] = offset < 0 ? offset / vorig : offset / volg;
  }
  const mis = [];
  for (let i = 0; i < N; i++) if (Math.abs(fout[i]) > drempel) mis.push(i);
  let crit = 0, spoor = null;
  if (mis.length < 3) {
    spoor = pySlice(fout, mis[0] + 1, mis.at(-1) - 1);
    crit = 1;
  } else {
    let lang = -Infinity, start = 0;
    for (let i = 0; i + 1 < mis.length; i++) { const d = mis[i + 1] - mis[i]; if (d > lang) { lang = d; start = i; } }
    if (lang - 1 > 0.25 * (N - 2)) {
      crit = 1;
      spoor = fout.slice(mis[start], mis[start + 1] + 1);
    }
  }
  if (crit) {
    const absGem = gem(spoor.map(Math.abs));
    if (absGem < mu && std1(spoor) < sigma) crit = 3;
  }
  return 1.0 * (crit === 3);
}

/** np.round: half naar even. */
function rondEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function pScore(ref, est, drempel = P_DREMPEL) {
  ref = arr(ref); est = arr(est); valideer(ref, est);
  if (est.length <= 1 || ref.length <= 1) return 0.0;
  const sr = Math.trunc(1.0 / 0.010);  // int(1/0.01) = 100
  let offset = Infinity;
  for (const x of est) offset = Math.min(offset, x);
  for (const x of ref) offset = Math.min(offset, x);
  const e = est.map((x) => x - offset), r = ref.map((x) => x - offset);
  const plekken = (a) => [...new Set(Array.from(a, (x) => Math.ceil(x * sr)))].sort((p, q) => p - q);
  const R = plekken(r), E = plekken(e);
  const tussen = [];
  for (let i = 1; i < R.length; i++) tussen.push(R[i] - R[i - 1]);
  tussen.sort((p, q) => p - q);
  const h = tussen.length >> 1;
  const mediaan = tussen.length % 2 ? tussen[h] : (tussen[h - 1] + tussen[h]) / 2;
  const w = Math.trunc(rondEven(drempel * mediaan));
  // De som van de kruiscorrelatie over de vertragingen −w … w = het aantal paren met |r − e| ≤ w.
  let paren = 0, lo = 0, hi = 0;
  for (const x of E) {
    while (lo < R.length && R[lo] < x - w) lo++;
    while (hi < R.length && R[hi] <= x + w) hi++;
    paren += hi - lo;
  }
  return paren / Math.max(est.length, ref.length);
}

/** Continuïteit: { CMLc, CMLt, AMLc, AMLt }. */
export function continuiteit(ref, est, faseDrempel = CONT_FASE, periodeDrempel = CONT_PERIODE) {
  ref = arr(ref); est = arr(est); valideer(ref, est);
  if (est.length <= 1 || ref.length <= 1) return { CMLc: 0.0, CMLt: 0.0, AMLc: 0.0, AMLt: 0.0 };
  const cont = [], tot = [];
  for (const r of variaties(ref)) {
    const nA = Math.max(r.length, est.length);
    const gebruikt = new Uint8Array(nA);
    const goed = new Float64Array(nA);
    for (let m = 0; m < est.length; m++) {
      let ok = 0;
      let dichtst = 0, minD = Infinity;
      for (let k = 0; k < r.length; k++) { const d = Math.abs(est[m] - r[k]); if (d < minD) { minD = d; dichtst = k; } }
      if (gebruikt[dichtst] === 0) {
        let fase, periode;
        if (m === 0 || dichtst === 0) {
          const refInt = dichtst + 1 < r.length ? r[dichtst + 1] - r[dichtst] : r[dichtst] - py(r, dichtst - 1);
          if (refInt === 0) fase = minD === 0 ? 1 : Infinity;
          else fase = Math.abs(minD / refInt);
          const estInt = m + 1 < est.length ? est[m + 1] - est[m] : est[m] - py(est, m - 1);
          if (refInt === 0) periode = estInt === 0 ? 0 : Infinity;
          else periode = Math.abs(1 - estInt / refInt);
        } else {
          const refInt = r[dichtst] - r[dichtst - 1];
          fase = Math.abs(minD / refInt);
          const estInt = est[m] - est[m - 1];
          periode = Math.abs(1 - estInt / refInt);
        }
        if (fase < faseDrempel && periode < periodeDrempel) { gebruikt[dichtst] = 1; ok = 1; }
      }
      goed[m] = ok;
    }
    // Nullen ervoor en erachter, zodat begin en eind van een spoor gevonden worden.
    let vorigeFout = 0, langst = 0, som = 0;
    for (let i = 0; i < nA; i++) {
      som += goed[i];
      if (goed[i] === 0) { langst = Math.max(langst, i + 1 - vorigeFout - 1); vorigeFout = i + 1; }
    }
    langst = Math.max(langst, nA + 1 - vorigeFout - 1);
    cont.push(langst / (1.0 * nA));
    tot.push(som / (1.0 * nA));
  }
  return { CMLc: cont[0], CMLt: tot[0], AMLc: Math.max(...cont), AMLt: Math.max(...tot) };
}

/**
 * Alles in één keer, zoals mir_eval.beat.evaluate (zonder information gain): eerst trimmen.
 * `minTijd` = min_beat_time (standaard 5 s); 0 = niets weggooien.
 */
export function evalueer(ref, est, { minTijd = MIN_TEL_TIJD } = {}) {
  const r = trimBeats(ref, minTijd), e = trimBeats(est, minTijd);
  const [cem, cemBest] = cemgil(r, e);
  return {
    F: fMaat(r, e), cemgil: cem, cemgilBest: cemBest, goto: goto(r, e), pScore: pScore(r, e),
    ...continuiteit(r, e),
  };
}

/** De namen van evalueer() naast die van mir_eval.beat.evaluate. */
export const MIR_NAMEN = {
  F: 'F-measure', cemgil: 'Cemgil', cemgilBest: 'Cemgil Best Metric Level', goto: 'Goto', pScore: 'P-score',
  CMLc: 'Correct Metric Level Continuous', CMLt: 'Correct Metric Level Total',
  AMLc: 'Any Metric Level Continuous', AMLt: 'Any Metric Level Total',
};
