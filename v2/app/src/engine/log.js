/**
 * Het handelingenlog (v1 ROADMAP 20, J18; oogst richting-025: altijd aan). Elke actie op de bus
 * als één regel `[t, id, v, { bron }]` met t in seconden audioklok sinds het begin van het log,
 * plus vooraf een BEGINSTAND (wat elke waarde-actie leest en welk nummer op welke track staat),
 * zodat een log zonder iets anders terug te spelen is. Laden komt als `{ laad: { n, id, titel } }`.
 *
 * Alleen ASCII (een teken = een byte: de server zet elk stuk op zijn byte, `?van=B`). Het log
 * maakt de tekst; WIE hem verstuurt (en opnieuw probeert) is de schermlaag (ui/schrijver.js).
 * Geen DOM, geen netwerk.
 */
import { Emitter } from '../kern/emitter.js';

export const LOG_VERSIE = 1;
/** Zo vaak (seconden audioklok) gaat er een stuk naar buiten. */
export const STUK_S = 1;

/** JSON met alles boven 0x7e als \uXXXX: een teken is een byte. */
export function ascii(x) {
  return JSON.stringify(x).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const rond = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x);

export class Handelingenlog extends Emitter {
  /** @param engine de engine (bus, ctx, tracks, on('laad')) */
  constructor(engine) {
    super();
    this.engine = engine;
    this.id = null;
    this.T0 = 0;
    this.bytes = 0;            // zoveel is er al als stuk uitgegeven
    this._buf = '';
    this._uit = [];
    this._luister = (a) => this._actie(a);
    this._laad = (l) => this._laden(l);
  }

  get loopt() { return this.id !== null; }

  /** Begin een log met deze id (`set-JJJJMMDD-UUMMSS`), vanaf nu op de audioklok. */
  start(id) {
    if (this.loopt) return;
    const e = this.engine;
    this.id = id;
    this.T0 = e.nu();
    this.bytes = 0;
    this._buf = ascii({ versie: LOG_VERSIE, id, t0: rond(this.T0), stand: this.beginstand() }) + '\n';
    e.bus.on('actie', this._luister);
    e.on('laad', this._laad);
  }

  /** Wat elke waarde-actie nu leest (behalve wat niet in de beginstand hoort), en de nummers. */
  beginstand() {
    const bus = this.engine.bus, waarden = {};
    for (const id of bus.ids()) {
      const z = bus.zoek(id);
      if (!z || z.def.soort !== 'waarde' || z.def.meta?.beginstand === false || z.def.meta?.log === 'overslaan') continue;
      const v = bus.lees(id);
      if (typeof v === 'number') waarden[id] = rond(v);
    }
    const tracks = this.engine.tracks.map((t) => (t.nummer ? { n: t.n, id: t.nummer.id, titel: t.nummer.titel } : null)).filter(Boolean);
    return { waarden, tracks, klok: this.engine.klok.loopt ? { bpm: rond(this.engine.klok.bpm(this.engine.nu())) } : null };
  }

  _t() { return rond(this.engine.nu() - this.T0); }

  _actie({ id, v, bron, meta }) {
    if (meta?.log === 'overslaan') return;
    if (id.endsWith('.laad')) return;                  // laden komt via 'laad' (met wat er geladen werd)
    this._regel([this._t(), id, typeof v === 'number' ? rond(v) : v, ...(bron && bron !== 'scherm' ? [{ bron }] : [])]);
  }

  _laden({ n, stand, nummer }) {
    if (stand !== 'klaar') return;
    this._regel({ t: this._t(), laad: { n, id: nummer?.id ?? null, titel: nummer?.titel ?? null } });
  }

  /** Een eigen regel van buiten (de opname begint: zo liggen WAV en log op één lijn). */
  merk(wat) { if (this.loopt) this._regel({ t: this._t(), ...wat }); }

  _regel(r) { this._buf += ascii(r) + '\n'; }

  /** Geef wat er sinds de vorige keer bij kwam als stuk { id, van, tekst } (of null). */
  stuk() {
    if (!this.loopt || this._buf === '') return null;
    const s = { id: this.id, van: this.bytes, tekst: this._buf };
    this.bytes += this._buf.length;
    this._buf = '';
    return s;
  }

  stop() {
    if (!this.loopt) return null;
    const laatste = this.stuk();
    this.engine.bus.off?.('actie', this._luister);
    this.engine.off?.('laad', this._laad);
    this.id = null;
    return laatste;
  }
}

/** Een id voor een set: `set-JJJJMMDD-UUMMSS` in lokale tijd. */
export function setId(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `set-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
