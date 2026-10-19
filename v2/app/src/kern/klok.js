/**
 * De maatklok: één per set (ontwerp klok-B01). Alles wat op de maat loopt
 * leest hem; niemand rekent zelf een tel uit (klok-B09).
 *
 * De klok is een gebroken lijn van segmenten { T, C, R }: "vanaf audiokloktijd
 * T staat de klok op tel C en loopt hij R tellen per seconde". Het eerste
 * segment geldt ook links van zijn T. De lijn is CONTINU en stijgend: een
 * tempowissel is een nieuw stuk lijn, nooit een sprong. Daardoor speelt een
 * patroon geen noot dubbel of te weinig, en springt een gekoppeld nummer niet.
 *
 * Wat er al gepland is staat vast: de klok verandert alleen vanaf een moment A
 * in de toekomst (`houd`, `richt`). Wat daarvóór lag rekent hij precies zo uit
 * als toen. Hij kent geen eigen tijd: elke vraag krijgt een tijdstip mee.
 *
 * De klok loopt door tot klokbediening hem verandert (klok-B02); hij stopt
 * nooit vanzelf (klok-O4, advies). Maten: de "1" ligt op tel 0, perMaat,
 * 2·perMaat, … (de klok begint daarom op een tel die past bij de maat van wat
 * hem startte, zie engine).
 *
 * Herkomst: de lijn, `houd` en `richt` komen uit v1 src/engine/patronen/klok.js
 * (getest met 1000 venstergrenzen: precies dezelfde noten); `loopt`, `start`,
 * de maat op tel 0 en de gebeurtenis 'verander' zijn nieuw.
 */
import { Emitter } from './emitter.js';

/** Zo dicht moet de klok op de doellijn liggen om niets te doen. */
export const TOLERANTIE = 1e-5;
/** Hoe lang het naar een doellijn glijdt: minstens zoveel tellen. */
export const OVERGANG = 1;
export const MIN_BPM = 40;
export const MAX_BPM = 300;

const klem = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));

export class Klok extends Emitter {
  constructor({ perMaat = 4 } = {}) {
    super();
    this.seg = [];            // [{ T, C, R }], oplopend in T
    this.perMaat = perMaat;
  }

  get loopt() { return this.seg.length > 0; }

  /** Opnieuw beginnen: op T staat de klok op tel C, met `bpm` tellen per minuut. */
  start(T, C, bpm) {
    this.seg = [{ T, C, R: klem(bpm) / 60 }];
    this.emit('verander', { van: T });
  }

  /** Stoppen (alleen met de hand: de klok stopt nooit vanzelf). */
  stop() {
    this.seg = [];
    this.emit('verander', { van: -Infinity });
  }

  _segOpTijd(t) {
    let s = this.seg[0];
    for (const x of this.seg) { if (x.T <= t) s = x; else break; }
    return s;
  }

  /** Klok-tel op audiokloktijd t (doorlopend, niet modulo de maat). */
  tel(t) { const s = this._segOpTijd(t); return s.C + (t - s.T) * s.R; }

  /** Tellen per seconde op t. */
  rate(t) { return this._segOpTijd(t).R; }

  /** Tellen per minuut op t. */
  bpm(t) { return this.rate(t) * 60; }

  /** Audiokloktijd van klok-tel c (de inverse van tel). */
  tijd(c) {
    let s = this.seg[0];
    for (const x of this.seg) { if (x.C <= c) s = x; else break; }
    return s.T + (c - s.C) / s.R;
  }

  /** Waar in de maat tel c valt: 0 = de "1", tot perMaat. */
  inMaat(c) { const p = this.perMaat; return ((c % p) + p) % p; }

  /** De eerste "1" op of na klok-tel c. */
  volgendeMaat(c) { const p = this.perMaat; return Math.ceil(c / p - 1e-9) * p; }

  /** Audiokloktijd van de eerste "1" na audiokloktijd t. */
  volgendeEen(t) { return this.tijd(this.volgendeMaat(this.tel(t) + 1e-9)); }

  /** De eerste hele tel op of na c. */
  volgendeTel(c) { return Math.ceil(c - 1e-9); }

  /** Vanaf A met `bpm` verder: een nieuw stuk lijn, geen sprong. */
  houd(A, bpm) {
    const R = klem(bpm) / 60;
    const c = this.tel(A);
    this.seg = this.seg.filter((s) => s.T < A);
    this.seg.push({ T: A, C: c, R });
    this.emit('verander', { van: A });
  }

  /** De rate van het laatste segment: waar de klok uiteindelijk op loopt. */
  get eindRate() { return this.seg.at(-1)?.R ?? 0; }

  /**
   * Naar een doellijn glijden: tel N (de dichtstbijzijnde hele klok-tel bij a)
   * valt op audiokloktijd a, en een tel duurt L seconden. Vanaf A gaat de klok
   * in minstens `overgang` tellen naar die lijn: een rechte lijn tot een tel
   * van de doellijn, dan de doellijn. Geen sprong. Gebruikt voor "klok naar dit
   * nummer" (klok-B06).
   */
  richt({ a, L }, A, { overgang = OVERGANG } = {}) {
    const N = Math.round(this.tel(a));
    const D = (t) => N + (t - a) / L;
    const fout = this.tel(A) - D(A);
    const z = this.seg.at(-1);
    const opLijn = Math.abs(z.R * L - 1) < 1e-9 && Math.abs(z.C + (a - z.T) * z.R - N) * L < TOLERANTIE;
    if (opLijn) return { veranderd: false, N, fout };
    const cA = this.tel(A);
    let k = Math.ceil((A + overgang * L - a) / L - 1e-9);
    let A2 = a + k * L;
    let R1 = (D(A2) - cA) / (A2 - A);
    for (let i = 0; i < 16 && !(R1 >= 0.25 / L); i++) { k++; A2 = a + k * L; R1 = (D(A2) - cA) / (A2 - A); }
    this.seg = this.seg.filter((s) => s.T < A);
    this.seg.push({ T: A, C: cA, R: R1 }, { T: A2, C: D(A2), R: 1 / L });
    this.emit('verander', { van: A });
    return { veranderd: true, N, fout };
  }

  /** Segmenten tussen van en tot (voor wie zelf plant, zoals de koppeling). */
  segmentenTussen(van, tot) {
    const uit = [];
    for (let i = 0; i < this.seg.length; i++) {
      const s = this.seg[i];
      const eind = this.seg[i + 1]?.T ?? Infinity;
      if (eind <= van || s.T >= tot) continue;
      uit.push(s);
    }
    if (!uit.length && this.seg.length) uit.push(this._segOpTijd(van));
    return uit;
  }

  /** Oude segmenten opruimen (alles wat vóór t voorbij is, op één na). */
  ruim(t) {
    while (this.seg.length > 1 && this.seg[1].T <= t) this.seg.shift();
  }
}
