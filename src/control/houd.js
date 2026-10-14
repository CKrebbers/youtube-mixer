import { Emitter } from '../lib/emitter.js';

/**
 * Houd-mapjes (14 okt, werkruimte S4, docs/werkruimte/S4.md; ontwerp B5).
 *
 * Een houd-mapje staat open ZOLANG je een knop vasthoudt: "SOLO vast + een
 * APC-knop = iets anders". Anders dan een gewoon mapje (lagen.js, één per
 * groep) kunnen er meer tegelijk open staan, en ze zijn GEDEELD over alle
 * apparaten: de houd-knop op de Maschine opent `houd.solo`, en een APC-knop
 * met een regel in `houd.solo` doet zolang iets anders. Elke Mapping zet de
 * open houd-mapjes vóór zijn eigen mapjes (mapping.js, `lagen`).
 *
 * Dit register is puur: geen MIDI, geen DOM, geen bus. Het weet per mapje
 * welk apparaat het opende. Loslaten sluit het alleen als het nog van dat
 * apparaat is (een ander apparaat kan het intussen zelf vastpakken), en
 * `losgekoppeld(apparaat)` sluit alles van dat apparaat (een uitgetrokken
 * controller stuurt nooit meer een loslaten).
 *
 * `versie` gaat ALLEEN omhoog als er echt iets verandert: de kies-cache van
 * de Mapping rekent erop (per MIDI-bericht en per LED-tik één vergelijking).
 */
export class HoudRegister extends Emitter {
  constructor() {
    super();
    this.open = new Map();    // naam -> apparaat dat hem opende (volgorde = volgorde van openen)
    this.versie = 0;
    this._lijst = Object.freeze([]);
  }

  /** Is er niets open? (de snelle weg: dan verandert er niets aan de mapjes) */
  get leeg() { return this.open.size === 0; }

  /**
   * De open houd-mapjes als 'houd.<naam>', de LAATST geopende eerst (twee
   * houd-knoppen met een regel op dezelfde knop: de laatste die je pakte wint).
   * Dezelfde bevroren lijst tot er iets verandert.
   */
  lijst() { return this._lijst; }

  /** Een houd-knop: indrukken = open (van dit apparaat), loslaten = dicht als het nog de zijne is. */
  druk(apparaat, naam, on) {
    if (typeof naam !== 'string' || !naam) return false;
    if (on) {
      if (this.open.get(naam) === apparaat) return false;
      this.open.delete(naam);           // opnieuw achteraan: de laatst geopende
      this.open.set(naam, apparaat);
    } else {
      if (this.open.get(naam) !== apparaat) return false;
      this.open.delete(naam);
    }
    this._gewijzigd(naam, !!on);
    return true;
  }

  /** Dit apparaat is weg: alles wat het open hield gaat dicht. Geeft hoeveel. */
  losgekoppeld(apparaat) {
    const weg = [...this.open].filter(([, a]) => a === apparaat).map(([n]) => n);
    if (!weg.length) return 0;
    for (const n of weg) this.open.delete(n);
    this._gewijzigd(null, false);
    return weg.length;
  }

  /** Eén mapje dicht, van wie ook (het mapje wordt weggehaald, lagen.haalMapjeWeg). */
  sluit(naam) {
    if (!this.open.delete(naam)) return false;
    this._gewijzigd(naam, false);
    return true;
  }

  /** Alles dicht (THUIS, of een test). */
  leegmaken() {
    if (!this.open.size) return;
    this.open.clear();
    this._gewijzigd(null, false);
  }

  isOpen(naam) { return this.open.has(naam); }

  _gewijzigd(naam, open) {
    this.versie++;
    this._lijst = Object.freeze([...this.open.keys()].reverse().map((n) => `houd.${n}`));
    this.emit('change', { naam, open, versie: this.versie });
  }
}

/**
 * HET register van de app: gedeeld door elke Mapping (APC, Maschine, Xboard,
 * toetsenbord) en door lagen.js (de knoppen `layer.houd.<naam>` op de bus).
 * Een test maakt zijn eigen HoudRegister.
 */
export const houd = new HoudRegister();
