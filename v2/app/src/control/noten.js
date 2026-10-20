/**
 * Noten van een MIDI-keyboard (elke ingang behalve de controller) naar een ONTVANGER: de engine
 * speelt ze op het instrument van de speeltrack. Noten gaan NIET over de bus (v1: anders loopt
 * het log vol met elke noot). Een noot-uit en het pedaal gaan naar waar de noot-aan heen ging
 * (v1 noten.js): wisselt de speeltrack tijdens het spelen, dan blijft geen noot hangen.
 *
 * Geen DOM, geen navigator: de MIDI-toegang komt van buiten (ui/controllers.js). Elke ingang
 * krijgt een eigen luisteraar met addEventListener (nooit onmidimessage overschrijven: dat is
 * van de controller).
 *
 * Ontvanger: { aan(noot, snelheid) -> sleutel (bv. tracknummer) of null, uit(noot, sleutel),
 *              houd(aan, sleutel?), buig(w), mod(w) }
 */
import { parseBericht } from './midi.js';

export class Noten {
  /**
   * @param toegang   de MIDIAccess
   * @param ontvanger zie boven
   * @param isController (poort) -> boolean: die slaan we over (de APC)
   */
  constructor({ toegang, ontvanger, isController = () => false }) {
    Object.assign(this, { toegang, ontvanger, isController });
    this.gekoppeld = new Map();   // poort-id -> { poort, luister }
    this.klinkt = new Map();      // `${poort}:${kanaal}:${noot}` -> sleutel van de noot-aan
    this.pedaal = new Map();      // poort -> sleutel waar het pedaal heen ging
    this._wissel = () => this.sync();
  }

  start() {
    this.toegang?.addEventListener?.('statechange', this._wissel);
    this.sync();
  }

  stop() {
    this.toegang?.removeEventListener?.('statechange', this._wissel);
    for (const id of [...this.gekoppeld.keys()]) this._los(id);
  }

  /** Alle ingangen die er zijn (state connected) en geen controller zijn: koppelen; de rest los. */
  sync() {
    const nu = new Set();
    for (const p of this.toegang?.inputs?.values?.() ?? []) {
      if (p.state !== 'connected' || this.isController(p)) continue;
      nu.add(p.id);
      if (this.gekoppeld.has(p.id)) continue;
      const luister = (e) => this.ontvang(p.id, e.data);
      p.addEventListener('midimessage', luister);
      this.gekoppeld.set(p.id, { poort: p, luister });
    }
    for (const id of [...this.gekoppeld.keys()]) if (!nu.has(id)) this._los(id);
  }

  _los(id) {
    const g = this.gekoppeld.get(id);
    if (!g) return;
    g.poort.removeEventListener?.('midimessage', g.luister);
    this.gekoppeld.delete(id);
    // Wat van die poort nog klonk: los (een losgetrokken keyboard laat niets hangen).
    for (const [k, sleutel] of [...this.klinkt]) {
      if (!k.startsWith(`${id}:`)) continue;
      this.ontvanger.uit(Number(k.split(':')[2]), sleutel);
      this.klinkt.delete(k);
    }
    if (this.pedaal.has(id)) { this.ontvanger.houd(false, this.pedaal.get(id)); this.pedaal.delete(id); }
  }

  /** Eén bericht van poort `id`. */
  ontvang(id, data) {
    const m = parseBericht(data);
    const k = `${id}:${m.kanaal}:${m.nummer}`;
    if (m.type === 'noot' && m.aan) {
      if (this.klinkt.has(k)) this.ontvanger.uit(m.nummer, this.klinkt.get(k));   // dubbel aan: eerst los
      const sleutel = this.ontvanger.aan(m.nummer, m.norm);
      if (sleutel !== null && sleutel !== undefined) this.klinkt.set(k, sleutel);
    } else if (m.type === 'noot') {
      if (!this.klinkt.has(k)) return;
      this.ontvanger.uit(m.nummer, this.klinkt.get(k));
      this.klinkt.delete(k);
    } else if (m.type === 'cc' && m.nummer === 64) {
      const aan = m.waarde >= 64;
      if (aan) this.pedaal.set(id, this.ontvanger.houd(true));
      else if (this.pedaal.has(id)) { this.ontvanger.houd(false, this.pedaal.get(id)); this.pedaal.delete(id); }
    } else if (m.type === 'cc' && m.nummer === 1) this.ontvanger.mod(m.norm);
    else if (m.type === 'pb') this.ontvanger.buig((m.waarde - 8192) / 8192);
  }
}
