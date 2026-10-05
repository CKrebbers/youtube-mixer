/**
 * De patroonklok: van audioklok naar klok-tellen en terug. Puur rekenwerk,
 * geen engine en geen eigen tijd: elke vraag krijgt een tijdstip mee (regel 3).
 *
 * De klok is een gebroken lijn: segmenten { T, C, R } = "vanaf audiokloktijd T
 * staat de klok op tel C en loopt hij R tellen per seconde". Het eerste
 * segment geldt ook links van zijn T. De lijn is CONTINU en stijgend: daardoor
 * levert een venster in tellen (venster.js) elke noot precies één keer, hoe de
 * klok ook verschuift.
 *
 * Wat ER AL GEPLAND IS, staat vast: de speler plant ~120 ms vooruit, en een
 * noot die op de audioklok staat haal je niet terug. Daarom verandert de klok
 * alleen vanaf een moment A dat na het geplande ligt (`knip`). Wat er
 * daarvóór lag, rekent hij precies zo uit als toen.
 *
 * VOLGEN (`richt`): de maatgever geeft zijn volgende tel `a` en de lengte van
 * een tel `L` (fxKlok, op wat je hoort). Het doel is een lijn met de tellen van
 * de klok op die van de maatgever: tel N op a, N+1 op a+L, … met N de
 * dichtstbijzijnde hele tel (verder dan een halve tel schuiven is muzikaal
 * onzin, net als bij sync). Ligt de klok er niet op (pitch verschoven, sprong,
 * andere maatgever), dan gaat hij er in één tel naartoe: een rechte lijn van
 * waar hij op A is naar de doellijn op een tel van de maatgever, daarna de
 * doellijn. Geen sprong, dus geen dubbele of gemiste noot; bij een kleine fout
 * (een pitchwissel binnen de vooruitblik) is dat een tempoverschil van een
 * paar promille, bij een sprong van een halve tel een tel lang anderhalf of
 * half zo snel.
 *
 * MATEN: welke klok-tellen een maatbegin zijn (`maatRef`, `perMaat`). Met een
 * maatgever die van de maatgever (zijn maat-anker per stuk), anders blijft het
 * wat het was.
 */

/** Zo dicht moet de klok op de doellijn liggen om niets te doen: 10 µs, en een rate op 1e-9. */
export const TOLERANTIE = 1e-5;
/** Hoe lang het naar de doellijn toe glijdt: minstens zoveel tellen. */
export const OVERGANG = 1;

export class Klok {
  constructor() {
    this.seg = [];          // [{ T, C, R }], oplopend in T
    this.maatRef = 0;       // een klok-tel waarop een maat begint
    this.perMaat = 4;
  }

  get leeg() { return this.seg.length === 0; }

  /** Opnieuw beginnen: één lijn, tel C op tijd T, R tellen per seconde. */
  zet(T, C, R) { this.seg = [{ T, C, R }]; }

  _segOpTijd(t) {
    let s = this.seg[0];
    for (const x of this.seg) { if (x.T <= t) s = x; else break; }
    return s;
  }

  /** Klok-tel op audiokloktijd t. */
  tel(t) { const s = this._segOpTijd(t); return s.C + (t - s.T) * s.R; }

  /** Tellen per seconde op t. */
  rate(t) { return this._segOpTijd(t).R; }

  /** Audiokloktijd van klok-tel c (de inverse van tel). */
  tijd(c) {
    let s = this.seg[0];
    for (const x of this.seg) { if (x.C <= c) s = x; else break; }
    return s.T + (c - s.C) / s.R;
  }

  /** Alles vanaf A weg; wat ervoor lag blijft precies zoals het was. Geeft de tel op A. */
  knip(A) {
    const c = this.tel(A);
    this.seg = this.seg.filter((s) => s.T < A);
    if (!this.seg.length) this.seg.push({ T: A, C: c, R: 1 });  // (alleen als er niets vóór A lag)
    return c;
  }

  /** Vanaf A met R tellen per seconde verder (eigen tempo, of het laatste tempo vasthouden). */
  houd(A, R) {
    const c = this.tel(A);
    this.seg = this.seg.filter((s) => s.T < A);
    this.seg.push({ T: A, C: c, R });
  }

  /** De rate van het laatste segment: waar de klok uiteindelijk op loopt. */
  get eindRate() { return this.seg.at(-1)?.R ?? 0; }

  /**
   * De klok op de tellen van de maatgever richten: `a` = audiokloktijd van een
   * tel van de maatgever, `L` = seconden per tel. Verandert alleen iets vanaf A.
   *
   * @returns {{ veranderd: boolean, N: number, fout: number }}
   *   N = de klok-tel die op a valt (de doellijn), fout = hoeveel tellen de klok
   *   op A naast de doellijn lag (positief = voor)
   */
  richt({ a, L }, A, { overgang = OVERGANG } = {}) {
    const N = Math.round(this.tel(a));
    const D = (t) => N + (t - a) / L;
    const fout = this.tel(A) - D(A);
    // Ligt de klok er al op, of glijdt hij er al naartoe (het laatste segment
    // IS de doellijn)? Dan niets: anders schoof het einde van de overgang bij
    // elke kijkbeurt een tel op en kwam hij er nooit.
    const z = this.seg.at(-1);
    const opLijn = Math.abs(z.R * L - 1) < 1e-9 && Math.abs(z.C + (a - z.T) * z.R - N) * L < TOLERANTIE;
    if (opLijn) return { veranderd: false, N, fout };
    const cA = this.tel(A);
    // Op een tel van de maatgever, minstens `overgang` tellen na A; en niet
    // trager dan een kwart van het doeltempo (na een grote sprong achteruit).
    let k = Math.ceil((A + overgang * L - a) / L - 1e-9);
    let A2 = a + k * L;
    let R1 = (D(A2) - cA) / (A2 - A);
    for (let i = 0; i < 16 && !(R1 >= 0.25 / L); i++) { k++; A2 = a + k * L; R1 = (D(A2) - cA) / (A2 - A); }
    this.seg = this.seg.filter((s) => s.T < A);
    this.seg.push({ T: A, C: cA, R: R1 }, { T: A2, C: D(A2), R: 1 / L });
    return { veranderd: true, N, fout };
  }

  /** Maten: klok-tel N staat op tel `q` van zijn maat (0 = de "1"), `per` tellen per maat. */
  zetMaat(N, q = 0, per = 4) {
    this.perMaat = Number.isInteger(per) && per > 0 ? per : 4;
    this.maatRef = N - q;
  }

  /** Het eerste maatbegin op of na klok-tel c. */
  volgendeMaat(c) {
    const p = this.perMaat;
    return this.maatRef + Math.ceil((c - this.maatRef) / p - 1e-9) * p;
  }

  /** De eerste hele tel op of na c. */
  volgendeTel(c) { return Math.ceil(c - 1e-9); }

  /** Oude segmenten opruimen (alles wat vóór t al voorbij is, op één na). */
  ruim(t) {
    while (this.seg.length > 1 && this.seg[1].T <= t) this.seg.shift();
  }
}
