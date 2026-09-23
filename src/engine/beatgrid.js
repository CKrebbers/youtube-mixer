/**
 * Het beatgrid: waar liggen de tellen in een track.
 *
 * Bewust simpel: één tempo plus één ankerpunt. Dat dekt alles wat op een klok
 * is gemaakt. Tracks die versnellen krijgen later meerdere ankers; die
 * uitbreiding past in dit model zonder het om te gooien.
 *
 * Alle tijden zijn TRACKTIJD in seconden, niet afspeeltijd. Draait een deck op
 * 1,05x, dan verschuift het grid niet — de track klinkt alleen sneller. Wie de
 * hoorbare bpm wil, vermenigvuldigt zelf met de rate.
 *
 * Deze module kent geen engine, geen deck en geen DOM: alleen rekenwerk.
 */

export const MIN_BPM = 40;
export const MAX_BPM = 300;

const klem = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));

export class Beatgrid {
  constructor({ bpm = 120, firstBeat = 0, beatsPerBar = 4 } = {}) {
    this.bpm = klem(bpm);
    this.firstBeat = firstBeat;     // tracktijd van beat 0
    this.beatsPerBar = beatsPerBar;
  }

  /** Seconden per beat. */
  get beatLength() { return 60 / this.bpm; }
  get barLength() { return this.beatLength * this.beatsPerBar; }

  /** Welke beat hoort bij deze tracktijd? Mag gebroken en negatief zijn. */
  beatAt(t) { return (t - this.firstBeat) / this.beatLength; }

  /** Tracktijd van een beatnummer. */
  timeOf(beat) { return this.firstBeat + beat * this.beatLength; }

  /** Dichtstbijzijnde beat, als tijd. */
  nearest(t) { return this.timeOf(Math.round(this.beatAt(t))); }

  /** Eerstvolgende beat op of na t. */
  next(t) {
    const b = this.beatAt(t);
    const n = Math.ceil(b - 1e-9);
    return this.timeOf(n);
  }

  /** Positie binnen de huidige beat, 0..1. */
  phase(t) {
    const b = this.beatAt(t);
    return b - Math.floor(b);
  }

  /** Positie binnen de maat, 0..1. Hiermee lijn je twee decks op de "1" uit. */
  barPhase(t) {
    const b = this.beatAt(t) / this.beatsPerBar;
    return b - Math.floor(b);
  }

  /** Staat deze tijd op de eerste tel van een maat? */
  isDownbeat(t, tolerantie = 0.02) {
    const p = this.barPhase(t);
    return p < tolerantie / this.barLength || p > 1 - tolerantie / this.barLength;
  }

  /**
   * Alle beattijden in een venster. Voor het tekenen van de golfvorm — daar wil
   * je geen lijst van duizenden beats waarvan je er dertig ziet.
   */
  beatsBetween(van, tot, max = 4096) {
    const uit = [];
    let b = Math.ceil(this.beatAt(van) - 1e-9);
    for (let i = 0; i < max; i++) {
      const t = this.timeOf(b);
      if (t > tot) break;
      uit.push({ tijd: t, beat: b, maatbegin: ((b % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0 });
      b++;
    }
    return uit;
  }

  // ---- bewerken ----------------------------------------------------------

  setBpm(bpm, { ankerTijd = null } = {}) {
    // Tempo wijzigen mag het ankerpunt niet laten wegglijden: als je een tijd
    // meegeeft, blijft de beat die daar ligt op zijn plek.
    if (ankerTijd !== null) {
      const beat = Math.round(this.beatAt(ankerTijd));
      this.bpm = klem(bpm);
      this.firstBeat = ankerTijd - beat * this.beatLength;
    } else {
      this.bpm = klem(bpm);
    }
    return this;
  }

  verdubbel() { return this.setBpm(this.bpm * 2); }
  halveer() { return this.setBpm(this.bpm / 2); }

  /** Het hele grid opschuiven, in seconden. */
  schuif(seconden) { this.firstBeat += seconden; return this; }

  /** Leg beat 0 precies hier. Gebruik je als je op de "1" tikt. */
  ankerHier(t) { this.firstBeat = t; return this; }

  /**
   * Schuif het grid zo dat de dichtstbijzijnde beat op t komt te liggen.
   * Handig als het tempo klopt maar het grid een fractie verschoven staat.
   */
  lijnUitOp(t) { this.firstBeat += t - this.nearest(t); return this; }

  toJSON() { return { bpm: this.bpm, firstBeat: this.firstBeat, beatsPerBar: this.beatsPerBar }; }
  static van(data) { return data ? new Beatgrid(data) : null; }
  kopie() { return new Beatgrid(this.toJSON()); }
}

/**
 * Tap tempo.
 *
 * Neemt de MEDIAAN van de intervallen, niet het gemiddelde: één keer te laat
 * tikken trekt een gemiddelde scheef, een mediaan niet. Te lang wachten begint
 * een nieuwe reeks, want dan was je aan het luisteren en niet aan het tellen.
 */
export class TapTempo {
  constructor({ maxGat = 2500, minTaps = 2 } = {}) {
    this.maxGat = maxGat;
    this.minTaps = minTaps;
    this.taps = [];
  }

  reset() { this.taps = []; }
  get count() { return this.taps.length; }

  /**
   * @param nu tijdstip van de tik in ms
   * @param tracktijd waar de track op dat moment stond, om het anker te zetten
   * @returns {{bpm:number, taps:number, firstBeat:number|null}|null}
   */
  tap(nu, tracktijd = null) {
    const vorige = this.taps.at(-1);
    if (vorige && nu - vorige.nu > this.maxGat) this.taps = [];
    this.taps.push({ nu, tracktijd });
    if (this.taps.length > 16) this.taps.shift();
    if (this.taps.length < this.minTaps) return null;

    const gaten = [];
    for (let i = 1; i < this.taps.length; i++) gaten.push(this.taps[i].nu - this.taps[i - 1].nu);
    gaten.sort((a, b) => a - b);
    const mediaan = gaten.length % 2
      ? gaten[(gaten.length - 1) / 2]
      : (gaten[gaten.length / 2 - 1] + gaten[gaten.length / 2]) / 2;
    if (!mediaan) return null;

    return {
      bpm: klem(60000 / mediaan),
      taps: this.taps.length,
      // De eerste tik van de reeks is het anker: die zat op een tel.
      firstBeat: this.taps[0].tracktijd,
    };
  }
}
