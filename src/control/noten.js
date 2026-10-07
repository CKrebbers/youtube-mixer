import { Emitter } from '../lib/emitter.js';
import { parseMessage } from './midi.js';
import { Mapping } from './mapping.js';
import { trackVanDeck } from './actions.js';

/**
 * Noten van een MIDI-toetsenbord naar het instrument op de SPEELTRACK
 * (docs/INSTRUMENTEN.md §6). Noten gaan NIET over de action-bus: een noot
 * is een nummer met een snelheid, geen 0..1, en "loslaten" hoort bij de noot
 * die je aansloeg, niet bij een knop. Knoppen van het toetsenbord wel: die
 * gaan via een kleine apparaatmapping (`mappings/xboard49.json`) naar
 * `track.{speel}.inst.knob.K`, met soft-takeover zoals een fader (absolute
 * potmeters: eerst oppakken, dan pas draaien).
 *
 * Welke ingangen: elke MIDI-ingang die niet de APC is. Deze module vraagt
 * ZELF GEEN MIDI-toegang aan: `hoorHub(midi)` luistert mee op de MidiHub
 * (midi.js), die alleen in het eerste VARVE-tabblad bestaat (Web Lock,
 * tabblad.js). Een poortobject van buiten (met ?hub= de nep-poort
 * "Xboard49 (hub)" van de AV-app-hub, ui/speelapparaten.js) sluit aan met
 * `koppel(poort)`: alles met de interface van een MIDIInput (`onmidimessage`
 * of `addEventListener`, berichten `{ data, timeStamp }`) werkt; gaat zijn
 * `state` van 'connected' af (statechange), dan laten zijn noten los. De
 * Maschine NIET koppelen: zijn knoppen zijn noten op kanaal 1 (maschine.js
 * geeft alleen de pads door, via `ontvang`).
 *
 * De speeltrack zegt de engine (`speeltrack()`: de focus-track als die een
 * instrument heeft, anders de laatste focus-track met een instrument). Een
 * noot-uit gaat naar het instrument waar zijn noot-aan heen ging, ook als de
 * focus intussen wisselde (zoals loslaten bij de mapping); het pedaal ook.
 *
 * Wat er binnenkomt:
 *   note on / off (velocity 0 = off)   noteOn(noot, snelheid 0..1) / noteOff
 *   pitchbend                           buig(−1..1)
 *   channel / polyfone aftertouch       druk(0..1) / druk(0..1, noot)
 *   CC 1 (modwiel)                      mod(0..1)
 *   CC 64 (sustain)                     houd(aan)
 *   CC 120 (all sound off)              stil()
 *   CC 123 (all notes off)              alleUit()
 *   andere CC's                         de apparaatmapping (knoppen)
 *   SysEx Master Volume (de schuif      de apparaatmapping, signature `master-volume`
 *     van de Xboard49)                  (absoluut, 14 bit; mappings/xboard49.json: het volume van de speeltrack)
 */
export const CC_MOD = 1;
export const CC_PEDAAL = 64;
export const CC_STIL = 120;
export const CC_ALLES_UIT = 123;
/** De signature van de schuif in een apparaatmapping (geen type:kanaal:nummer: het is SysEx). */
export const SIG_MASTER_VOLUME = 'master-volume';

const isApcNaam = (naam) => /apc40/i.test(naam || '');

/**
 * Universal Real Time SysEx, Device Control, Master Volume: F0 7F <dev> 04 01 ll mm F7
 * (zo stuurt de Xboard49 zijn schuif, PROTOCOL §17 van de hub). → 0..1, of null.
 */
export function leesMasterVolume(raw) {
  if (!raw || raw.length !== 8 || raw[0] !== 0xf0 || raw[1] !== 0x7f || raw[3] !== 0x04 || raw[4] !== 0x01 || raw[7] !== 0xf7) return null;
  return ((raw[6] << 7) | raw[5]) / 16383;
}

export class Noten extends Emitter {
  /**
   * @param engine  speeltrack() en instrumentOp(id)
   * @param read    read() van de bus (soft-takeover van de knoppen)
   * @param invoke  invoke() van de bus
   * @param isApc   (poortnaam) => true voor de controller zelf: die speelt geen noten
   * @param nu      klok voor soft-takeover en "laatst gezien" (ms)
   */
  constructor({ engine, read = () => null, invoke = () => {}, isApc = isApcNaam, nu = () => (globalThis.performance?.now() ?? Date.now()) }) {
    super();
    this.engine = engine;
    this.isApc = isApc;
    this.nu = nu;
    // De knoppen van het toetsenbord: {speel} = het tracknummer van de speeltrack.
    this.mapping = new Mapping({ read, invoke, now: nu, vars: () => ({ speel: trackVanDeck(this.engine.speeltrack()) }) });
    this.vast = new Map();         // `${bron}|${kanaal}|${noot}` -> { id, inst, noot }
    this.pedalen = new Map();      // `${bron}|${kanaal}` -> { id, inst }
    this.poorten = new Map();      // bron -> { bron, naam, laatst, noten, laatsteNoot }
    this._gekoppeld = new Map();   // poort -> { fn, vorige }
  }

  /** De apparaatmapping voor de knoppen (mappings/xboard49.json). */
  laadMapping(doc) { return this.mapping.load(doc); }

  /** Het instrument op de speeltrack, met zijn deck-id, of null. */
  _speel() {
    const id = this.engine.speeltrack?.() ?? null;
    const inst = id ? this.engine.instrumentOp(id) : null;
    return inst ? { id, inst } : null;
  }

  /** Leeft dit instrument nog op die track (niet weggehaald of vervangen)? */
  _leeft(x) { return !!x && this.engine.instrumentOp(x.id) === x.inst; }

  /**
   * Eén bericht, plat zoals parseMessage het maakt, met `port`/`portName`.
   * Geeft true als het iets deed (een instrument raakte of een knop).
   */
  ontvang(msg) {
    if (!msg || this.isApc(msg.portName)) return false;
    // De schuif van de Xboard49 is SysEx: een eigen signature in de apparaatmapping.
    if (msg.type === 'sysex') return this._masterVolume(msg);
    // Systeemberichten (clock, active sensing: veel keyboards sturen dat elke 300 ms) doen niets.
    if (!(msg.channel >= 0)) return false;
    const bron = String(msg.port ?? msg.portName ?? '?');
    const kanaal = msg.channel;
    const p = this._zie(bron, msg);
    switch (msg.type) {
      case 'note':
        if (msg.on) { p.noten++; p.laatsteNoot = msg.number; return this._aan(bron, kanaal, msg.number, msg.value / 127); }
        return this._uit(bron, kanaal, msg.number);
      case 'pb': {
        const s = this._speel();
        // 14 bit, midden 8192: precies −1 en +1 op de aanslagen.
        s?.inst.buig((msg.value - 8192) / (msg.value >= 8192 ? 8191 : 8192));
        return !!s;
      }
      case 'at': { const s = this._speel(); s?.inst.druk(msg.norm); return !!s; }
      case 'poly': { const s = this._speel(); s?.inst.druk(msg.norm, msg.number); return !!s; }
      case 'cc': return this._cc(bron, kanaal, msg);
      default: return false;
    }
  }

  _zie(bron, msg) {
    let p = this.poorten.get(bron);
    if (!p) { p = { bron, naam: msg.portName || bron, laatst: 0, noten: 0, laatsteNoot: null }; this.poorten.set(bron, p); }
    p.laatst = this.nu();
    return p;
  }

  _aan(bron, kanaal, noot, snelheid) {
    const sleutel = `${bron}|${kanaal}|${noot}`;
    if (this.vast.has(sleutel)) this._uit(bron, kanaal, noot);     // twee keer aan zonder uit
    const s = this._speel();
    if (!s) { this.emit('geen', { bron, noot }); return false; }
    s.inst.noteOn(noot, snelheid);
    this.vast.set(sleutel, { id: s.id, inst: s.inst, noot });
    // Met de snelheid: live opnemen in een patroon (docs/PATRONEN.md §4) luistert hier mee.
    this.emit('noot', { id: s.id, noot, aan: true, snelheid });
    return true;
  }

  _uit(bron, kanaal, noot) {
    const sleutel = `${bron}|${kanaal}|${noot}`;
    const x = this.vast.get(sleutel);
    if (!x) return false;
    this.vast.delete(sleutel);
    if (this._leeft(x)) x.inst.noteOff(noot);
    this.emit('noot', { id: x.id, noot, aan: false });
    return true;
  }

  _cc(bron, kanaal, msg) {
    const n = msg.number;
    if (n === CC_PEDAAL) return this._pedaal(bron, kanaal, msg.value >= 64);
    if (n === CC_MOD) { const s = this._speel(); s?.inst.mod(msg.norm); return !!s; }
    if (n === CC_STIL || n === CC_ALLES_UIT) {
      // Op de speeltrack én op elk instrument waar deze poort nog noten heeft.
      const doelen = new Set();
      const s = this._speel();
      if (s) doelen.add(s.inst);
      for (const [k, x] of this.vast) if (k.startsWith(`${bron}|`) && this._leeft(x)) doelen.add(x.inst);
      for (const inst of doelen) { if (n === CC_STIL) inst.stil(); else inst.alleUit(); }
      for (const k of [...this.vast.keys()]) if (k.startsWith(`${bron}|`)) this.vast.delete(k);
      return doelen.size > 0;
    }
    // De knoppen: alleen als er een speeltrack is ({speel} moet iets worden).
    if (!this._speel()) return false;
    return !!this.mapping.handle(msg)?.taken;
  }

  /** SysEx Master Volume -> de apparaatmapping (`master-volume`, absoluut: soft-takeover zoals een fader). */
  _masterVolume(msg) {
    const v = leesMasterVolume(msg.raw);
    if (v === null || !this._speel()) return false;
    this._zie(String(msg.port ?? msg.portName ?? '?'), msg);
    const m = { type: SIG_MASTER_VOLUME, sig: SIG_MASTER_VOLUME, channel: -1, number: -1, value: Math.round(v * 127), norm: v, raw: msg.raw };
    return !!this.mapping.handle(m)?.taken;
  }

  _pedaal(bron, kanaal, aan) {
    const k = `${bron}|${kanaal}`;
    if (aan) {
      const s = this._speel();
      if (!s) return false;
      s.inst.houd(true);
      this.pedalen.set(k, s);
      return true;
    }
    const was = this.pedalen.get(k);
    this.pedalen.delete(k);
    // Los gaat naar waar het pedaal ingetrapt werd; was dat er niet (meer), de speeltrack.
    const doel = this._leeft(was) ? was.inst : this._speel()?.inst;
    doel?.houd(false);
    return !!doel;
  }

  /**
   * Alles van één bron loslaten (de poort verdween): elke noot uit, het
   * pedaal los. Zonder bron: alles (het tabblad verliest de focus niet: een
   * toetsenbord speelt ook als VARVE achter een ander venster zit).
   */
  los(bron = null) {
    for (const [k, x] of [...this.vast]) {
      if (bron !== null && !k.startsWith(`${bron}|`)) continue;
      this.vast.delete(k);
      if (this._leeft(x)) x.inst.noteOff(x.noot);
      this.emit('noot', { id: x.id, noot: x.noot, aan: false });
    }
    for (const [k, x] of [...this.pedalen]) {
      if (bron !== null && !k.startsWith(`${bron}|`)) continue;
      this.pedalen.delete(k);
      if (this._leeft(x)) x.inst.houd(false);
    }
    this.mapping.losgekoppeld();
  }

  /**
   * Meeluisteren op de MidiHub (midi.js): elk bericht dat niet van de APC is.
   * Verdwijnt een poort (state niet meer 'connected'), dan zijn noten los.
   */
  hoorHub(midi) {
    const uitMsg = midi.on('message', (m) => { if (!m.echo) this.ontvang(m); });
    const uitPoorten = midi.on('ports', ({ inputs } = {}) => {
      const er = new Set((inputs || []).filter((p) => p.state === 'connected').map((p) => p.id));
      for (const bron of this._bronnen()) if (!er.has(bron) && !this._isGekoppeld(bron)) this.los(bron);
    });
    return () => { uitMsg(); uitPoorten(); };
  }

  _bronnen() {
    const b = new Set();
    for (const k of [...this.vast.keys(), ...this.pedalen.keys()]) b.add(k.split('|')[0]);
    return b;
  }

  _isGekoppeld(bron) { for (const p of this._gekoppeld.keys()) if (String(p.id ?? p.name) === bron) return true; return false; }

  /**
   * Een poortobject van buiten aansluiten (MIDIInput-interface). Met
   * addEventListener als die er is (dan blijft een bestaande onmidimessage
   * staan), anders via onmidimessage, achter een handler die er al stond.
   * Geeft een functie terug die weer loskoppelt.
   */
  koppel(poort) {
    if (!poort || this._gekoppeld.has(poort)) return () => this.ontkoppel(poort);
    const bron = poort.id ?? poort.name ?? 'poort';
    const fn = (e) => {
      if (!e?.data) return;
      const m = parseMessage(e.data);
      m.port = bron;
      m.portName = poort.name || String(bron);
      m.time = e.timeStamp;
      this.ontvang(m);
    };
    // Valt de poort weg (state niet meer 'connected': de hub-verbinding weg, of
    // een MIDIPort die losgaat), dan laten zijn noten en zijn pedaal los.
    const st = () => { if (poort.state !== undefined && poort.state !== 'connected') this.los(String(bron)); };
    let vorige = null, vorigeSt = null;
    if (typeof poort.addEventListener === 'function') {
      poort.addEventListener('midimessage', fn);
      poort.addEventListener('statechange', st);
    } else {
      vorige = poort.onmidimessage || null;
      vorigeSt = poort.onstatechange || null;
      poort.onmidimessage = function (e) { try { vorige?.call(this, e); } finally { fn(e); } };
      poort.onstatechange = function (e) { try { vorigeSt?.call(this, e); } finally { st(); } };
    }
    this._gekoppeld.set(poort, { fn, st, vorige, vorigeSt, bron: String(bron) });
    return () => this.ontkoppel(poort);
  }

  ontkoppel(poort) {
    const g = this._gekoppeld.get(poort);
    if (!g) return;
    this._gekoppeld.delete(poort);
    if (typeof poort.removeEventListener === 'function' && typeof poort.addEventListener === 'function') {
      poort.removeEventListener('midimessage', g.fn);
      poort.removeEventListener('statechange', g.st);
    } else {
      poort.onmidimessage = g.vorige;
      poort.onstatechange = g.vorigeSt;
    }
    this.los(g.bron);
  }

  // ---- het schermtoetsenbord (en wie verder noten wil spelen) ----------------

  /** Een noot aanslaan vanaf het scherm (bron 'scherm'), naar de speeltrack. */
  speel(noot, snelheid = 0.8) { return this._aan('scherm', 0, noot, snelheid); }
  /** En loslaten. */
  laat(noot) { return this._uit('scherm', 0, noot); }

  /** Welke noten er nu ingedrukt zijn op track `id` (alle bronnen), voor het scherm. */
  ingedrukt(id) {
    const uit = new Set();
    for (const x of this.vast.values()) if (x.id === id && this._leeft(x)) uit.add(x.noot);
    return uit;
  }

  /** De poort die het laatst iets stuurde (binnen `ms`), of null. */
  actief(ms = 2000) {
    let beste = null;
    for (const p of this.poorten.values()) if (p.bron !== 'scherm' && this.nu() - p.laatst <= ms && (!beste || p.laatst > beste.laatst)) beste = p;
    return beste;
  }
}
