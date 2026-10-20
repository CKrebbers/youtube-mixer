/**
 * De bus: elke handeling is een actie, van welke bron ook (scherm, toetsenbord,
 * controller, iPad, automaat, terugspelen). Wie iets aan de set verandert,
 * doet het hierdoor; zo staat alles in het log en ziet iedereen hetzelfde.
 *
 * Een actie heeft een soort:
 *   'waarde'  — 0..1 (regel: de bus weet niets van dB, Hz of bpm; de engine schaalt)
 *   'trigger' — true = indrukken, false = loslaten
 *   'commando' — een opdracht met gegevens (laden: { nummer }); gaat zoals het is
 * en zijn aard in de definitie (meta), niet in losse lijsten zoals in v1:
 *   log: 'overslaan'   niet in het handelingenlog
 *   beginstand: false  niet in de beginstand van het log
 *   nummer: true       hoort bij het nummer (terugspelen alleen met hetzelfde nummer)
 *   gevaarlijk: true   nooit van buiten de Mac (iPad, netwerk)
 *
 * Een actie met een trackparameter wordt één keer gedefinieerd: 'track.{n}.filter'
 * geldt voor track 1 tot en met 8 (v1 had 3251 losse acties, ontwerp track-B13).
 */
import { Emitter } from './emitter.js';

export const TRACKS = 8;
const SOORTEN = new Set(['waarde', 'trigger', 'commando']);

export class Bus extends Emitter {
  constructor({ tracks = TRACKS } = {}) {
    super();
    this.tracks = tracks;
    this._vast = new Map();     // id -> def
    this._sjablonen = [];       // [{ re, def }]
  }

  /**
   * @param def { id, soort, label?, meta?, doe(v, n, info), lees?(n) }
   */
  defineer(def) {
    if (!def?.id || !SOORTEN.has(def.soort) || typeof def.doe !== 'function') {
      throw new Error(`bus: ongeldige definitie ${def?.id}`);
    }
    const d = { meta: {}, ...def };
    if (d.id.includes('{n}')) {
      const re = new RegExp(`^${d.id.replace(/\./g, '\\.').replace('{n}', '([1-9][0-9]*)')}$`);
      if (this._sjablonen.some((s) => s.def.id === d.id)) throw new Error(`bus: ${d.id} bestaat al`);
      this._sjablonen.push({ re, def: d });
    } else {
      if (this._vast.has(d.id)) throw new Error(`bus: ${d.id} bestaat al`);
      this._vast.set(d.id, d);
    }
    return this;
  }

  /** De definitie en het tracknummer bij een concrete id, of null. */
  zoek(id) {
    const vast = this._vast.get(id);
    if (vast) return { def: vast, n: null };
    for (const { re, def } of this._sjablonen) {
      const m = re.exec(id);
      if (m) {
        const n = Number(m[1]);
        if (n >= 1 && n <= this.tracks) return { def, n };
      }
    }
    return null;
  }

  heeft(id) { return this.zoek(id) !== null; }

  /**
   * Een actie uitvoeren. Een waarde wordt geklemd op 0..1, een trigger een boolean.
   * @returns het antwoord van de actie (bv. { geweigerd: 'reden' }), of undefined
   */
  doe(id, v, { bron = 'scherm' } = {}) {
    const z = this.zoek(id);
    if (!z) throw new Error(`bus: onbekende actie ${id}`);
    const waarde = z.def.soort === 'waarde'
      ? Math.min(1, Math.max(0, Number.isFinite(+v) ? +v : 0))
      : z.def.soort === 'trigger' ? !!v : v;
    this.emit('actie', { id, v: waarde, bron, meta: z.def.meta });
    const antwoord = z.def.doe(waarde, z.n, { bron });
    if (antwoord?.geweigerd) this.emit('geweigerd', { id, reden: antwoord.geweigerd, bron });
    return antwoord;
  }

  /** De stand van een actie (0..1, boolean of null = niets te doen). */
  lees(id) {
    const z = this.zoek(id);
    if (!z?.def.lees) return null;
    return z.def.lees(z.n);
  }

  /** Alle concrete id's (sjablonen uitgeschreven voor elke track). */
  ids() {
    const uit = [...this._vast.keys()];
    for (const { def } of this._sjablonen) {
      for (let n = 1; n <= this.tracks; n++) uit.push(def.id.replace('{n}', n));
    }
    return uit;
  }

  /** Alle definities (één per sjabloon). */
  definities() { return [...this._vast.values(), ...this._sjablonen.map((s) => s.def)]; }
}
