/**
 * De MIDI-laag: poorten, parsen, sysex, echofilter en de uitgaande wachtrij.
 * Kent GEEN acties, GEEN indeling en GEEN apparaat: wat een bericht betekent
 * zegt het apparaat (apparaten/*.js), wat het DOET zegt de indeling.
 *
 * Web MIDI komt binnen als een object (`toegang`, de MIDIAccess van Chrome of
 * een nagebouwde in de tests). Hier wordt nooit `navigator` aangeraakt: wie de
 * toegang vraagt is src/ui/controllers.js, en alleen in het tabblad met de Web
 * Lock (v1 23 sep: vier tabbladen die tegelijk init en LED's stuurden legden
 * Chrome's MIDI-dienst om).
 *
 * Overgenomen uit v1 src/control/midi.js, met de regels die daar bevochten zijn:
 * - alleen poorten met state 'connected' tellen (Chrome laat een losgetrokken
 *   poort staan als 'disconnected'; terugkomen = opnieuw init);
 * - een speelapparaat (Xboard, Maschine) is nooit "de controller";
 * - echofilter ALLEEN op CC (v1 14 okt: op noten slikte hij echte knoppen in);
 * - alles naar buiten door een wachtrij: in elk venster van 4 ms hooguit 16
 *   berichten (Comet/Chromium 152 crashte vier keer op een burst, 22 sep).
 */
import { Emitter } from '../kern/emitter.js';

const SYSTEEM = {
  0xf0: 'sysex', 0xf1: 'mtc', 0xf2: 'songpos', 0xf3: 'songsel', 0xf6: 'tunereq',
  0xf7: 'sysex-eind', 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop',
  0xfe: 'sense', 0xff: 'reset',
};

/**
 * Bytes -> plat bericht. Note On met velocity 0 is een Note Off: dat wordt hier
 * al rechtgetrokken, zodat niemand verderop die val nog kan intrappen.
 *
 * { type: 'noot'|'cc'|'pb'|'at'|'poly'|'pc'|<systeem>, kanaal (0-15, -1 = systeem),
 *   nummer, waarde (ruw 0..127), norm (0..1), aan (alleen noot), sig, raw }
 */
export function parseBericht(data) {
  const raw = data instanceof Uint8Array ? data : Uint8Array.from(data ?? []);
  const st = raw[0] ?? 0;
  if (st >= 0xf0) return pak({ type: SYSTEEM[st] ?? 'systeem', kanaal: -1, nummer: -1, waarde: 0, norm: 0, raw });
  const soort = st & 0xf0;
  const kanaal = st & 0x0f;
  const d1 = raw[1] ?? 0;
  const d2 = raw[2] ?? 0;
  switch (soort) {
    case 0x80: return pak({ type: 'noot', kanaal, nummer: d1, waarde: 0, norm: 0, aan: false, raw });
    case 0x90: return pak({ type: 'noot', kanaal, nummer: d1, waarde: d2, norm: d2 / 127, aan: d2 > 0, raw });
    case 0xa0: return pak({ type: 'poly', kanaal, nummer: d1, waarde: d2, norm: d2 / 127, raw });
    case 0xb0: return pak({ type: 'cc', kanaal, nummer: d1, waarde: d2, norm: d2 / 127, raw });
    case 0xc0: return pak({ type: 'pc', kanaal, nummer: d1, waarde: d1, norm: d1 / 127, raw });
    case 0xd0: return pak({ type: 'at', kanaal, nummer: 0, waarde: d1, norm: d1 / 127, raw });
    case 0xe0: { const v = (d2 << 7) | d1; return pak({ type: 'pb', kanaal, nummer: 0, waarde: v, norm: v / 16383, raw }); }
    default: return pak({ type: 'onbekend', kanaal, nummer: d1, waarde: d2, norm: d2 / 127, raw });
  }
}

function pak(m) {
  m.sig = m.kanaal < 0 ? m.type : `${m.type}:${m.kanaal}:${m.nummer}`;
  return m;
}

/** Bytes als hex, voor de monitor en de proeven. */
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Is deze poort er echt? Een losgetrokken poort blijft in de lijst staan als 'disconnected'. */
const aanwezig = (p) => !!p && p.state === 'connected';

/** Een speelapparaat speelt noten en is nooit de controller (v1 isSpeelapparaat). */
export const isSpeelapparaat = (naam) => /xboard|maschine/i.test(naam || '');
/** Virtuele doorgeefpoorten zijn zelden wat je zoekt. */
const isDoorgeef = (naam) => /through|iac|virtual/i.test(naam || '');

/**
 * Hoe lang een CC die wij stuurden nog als echo kan terugkomen. Een ring zetten
 * mag geen knopdraai worden (lus tot de bus volloopt). 60 ms is ruim voor een
 * USB-retour en te kort om een echte beweging te missen.
 */
export const ECHO_MS = 60;
/** De wachtrij: in elk venster van VENSTER_MS hooguit PER_VENSTER berichten. */
export const PER_VENSTER = 16;
export const VENSTER_MS = 4;

const standaardKlok = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const standaardTimers = () => ({
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (t) => clearTimeout(t),
});

/**
 * De uitgaande wachtrij als los ding (testbaar met een nepklok). Een SCHUIVEND
 * venster (v1 14 okt): het zeventiende bericht gaat pas VENSTER_MS na het eerste
 * van de laatste zestien, dus in elk venster van 4 ms hooguit 16, waar het ook
 * begint. Is er plaats, dan gaat een bericht METEEN (geen setTimeout per lampje).
 */
export class Wachtrij {
  constructor({ stuur, klok = standaardKlok, timers = standaardTimers() }) {
    this.stuurNu = stuur;
    this.klok = klok;
    this.timers = timers;
    this._rij = [];
    this._tikker = null;
    this._t = new Float64Array(PER_VENSTER).fill(-Infinity);   // ring met de tijden van de laatste 16
    this._i = 0;
  }

  get lengte() { return this._rij.length; }

  /** Over hoeveel ms er weer een bericht mag (<= 0: nu). */
  _wacht() { return this._t[this._i] + VENSTER_MS - this.klok(); }

  _uit(bytes) {
    this._t[this._i] = this.klok();
    this._i = (this._i + 1) % PER_VENSTER;
    this.stuurNu(bytes);
  }

  /** Achteraan in de rij, of meteen als niets wacht en er plaats is. `direct` alleen bij het sluiten van de pagina. */
  zet(bytes, { direct = false } = {}) {
    if (direct) { this.stuurNu(bytes); return; }
    if (!this._rij.length && this._wacht() <= 0) { this._uit(bytes); return; }
    this._rij.push(bytes);
    this._plan();
  }

  _plan() {
    if (this._tikker !== null) return;
    const tik = () => {
      this._tikker = null;
      while (this._rij.length && this._wacht() <= 0) this._uit(this._rij.shift());
      if (this._rij.length) this._tikker = this.timers.setTimeout(tik, Math.max(0, this._wacht()));
    };
    this._tikker = this.timers.setTimeout(tik, Math.max(0, this._wacht()));
  }

  /** Alles wat nog wacht weggooien (loskoppelen). */
  leeg() {
    const n = this._rij.length;
    this._rij.length = 0;
    if (this._tikker !== null) { this.timers.clearTimeout(this._tikker); this._tikker = null; }
    return n;
  }
}

/**
 * Eén controller: een ingang en een uitgang op naam. Gebeurtenissen:
 *   'bericht'   een geparsed bericht van de gekozen ingang (zonder echo's)
 *   'verbonden' de uitgang is er (weer): stuur de init (de APC staat na een
 *               replug weer in 0x40, bediening-043)
 *   'weg'       de ingang is weg: laat alles los wat vastzat (bediening-041)
 *   'poorten'   de lijst veranderde
 */
export class MidiHub extends Emitter {
  /**
   * @param toegang  MIDIAccess (of nagebouwd): inputs, outputs (Map-achtig), onstatechange, sysexEnabled
   * @param voorkeur naam-regex van de controller (de APC)
   * @param klok     ms, voor wachtrij en echofilter
   */
  constructor({ toegang, voorkeur = /apc40/i, klok = standaardKlok, timers = standaardTimers(), echoFilter = true } = {}) {
    super();
    this.toegang = toegang;
    this.voorkeur = voorkeur;
    this.klok = klok;
    this.echoFilter = echoFilter;
    this.sysex = !!toegang?.sysexEnabled;
    this.inId = null;
    this.uitId = null;
    this.ontvangen = 0;
    this.verstuurd = 0;
    this.echos = 0;
    this._verstuurd = new Map();   // 'sig=waarde' -> tijd, voor het echofilter (alleen CC)
    this._laatsteIn = new Map();   // sig -> laatste CC-waarde die de controller ons stuurde
    this._vorigIn = null;
    this._vorigUit = null;
    this.wachtrij = new Wachtrij({ stuur: (b) => this._verstuur(b), klok, timers });
  }

  /** Poorten binden en de eerste keuze maken. */
  start() {
    if (!this.toegang) return this;
    this.toegang.onstatechange = () => this._sync();
    this._sync();
    return this;
  }

  stop() {
    if (this.toegang) {
      this.toegang.onstatechange = null;
      for (const p of this._waarden(this.toegang.inputs)) if (p.onmidimessage) p.onmidimessage = null;
    }
    this.wachtrij.leeg();
  }

  _waarden(map) { return map ? [...map.values()] : []; }

  invoer() { const p = this.toegang?.inputs?.get(this.inId); return aanwezig(p) ? p : null; }
  uitvoer() { const p = this.toegang?.outputs?.get(this.uitId); return aanwezig(p) ? p : null; }

  /**
   * Kies een poort op NAAM (id's veranderen na een replug, namen niet). Alleen
   * een poort die op de voorkeur past: valt de APC weg, dan wachten we op hem in
   * plaats van op een andere poort over te springen. Nooit een speelapparaat of
   * een doorgeefpoort.
   */
  _kies(map) {
    return this._waarden(map).find((p) => aanwezig(p) && !isSpeelapparaat(p.name) && !isDoorgeef(p.name)
      && this.voorkeur.test(p.name || '')) || null;
  }

  _sync() {
    const t = this.toegang;
    if (!t) return;
    for (const p of this._waarden(t.inputs)) p.onmidimessage = (e) => this._ontvang(p, e);
    if (!this.invoer()) this.inId = this._kies(t.inputs)?.id ?? null;
    if (!this.uitvoer()) this.uitId = this._kies(t.outputs)?.id ?? null;
    const inNu = this.invoer() ? this.inId : null;
    const uitNu = this.uitvoer() ? this.uitId : null;
    this.emit('poorten', this.poorten());
    if (inNu !== this._vorigIn) {
      const was = this._vorigIn;
      this._vorigIn = inNu;
      this._laatsteIn.clear();
      if (was !== null) this.emit('weg', { id: was });
      if (inNu !== null) this.emit('invoer', this.invoer());
    }
    if (uitNu !== this._vorigUit) {
      this._vorigUit = uitNu;
      if (uitNu === null) this.wachtrij.leeg();
      else this.emit('verbonden', this.uitvoer());
    }
  }

  poorten() {
    const info = (p) => ({ id: p.id, naam: p.name || '(naamloos)', state: p.state });
    return {
      in: this._waarden(this.toegang?.inputs).map(info),
      uit: this._waarden(this.toegang?.outputs).map(info),
    };
  }

  _ontvang(poort, e) {
    if (poort.id !== this.inId) return;
    const m = parseBericht(e.data);
    m.tijd = e.timeStamp;
    this.ontvangen++;
    if (this._isEcho(m)) { this.echos++; return; }
    if (m.type === 'cc') this._laatsteIn.set(m.sig, m.waarde);
    this.emit('bericht', m);
  }

  /** Alleen een CC kan een echo zijn (een ring die als draai terugkomt). Een noot nooit. */
  _isEcho(m) {
    if (!this.echoFilter || m.type !== 'cc' || !this._verstuurd.size) return false;
    const sleutel = `${m.sig}=${m.waarde}`;
    const t = this._verstuurd.get(sleutel);
    if (t === undefined) return false;
    this._verstuurd.delete(sleutel);          // één echo per verstuurd bericht
    return this.klok() - t <= ECHO_MS;
  }

  /**
   * Een verstuurde CC onthouden voor het echofilter. NIET als de controller ons
   * die waarde op die control net zelf stuurde (een ring van een eindeloze knop
   * is precies wat de knop stuurde; v1 review 14 okt): behalve op de aanslag
   * (0 en 127), waar nog eens hetzelfde bericht doordraaien betekent.
   */
  _onthoud(m) {
    if (m.waarde !== 0 && m.waarde !== 127 && this._laatsteIn.get(m.sig) === m.waarde) return;
    const nu = this.klok();
    this._verstuurd.set(`${m.sig}=${m.waarde}`, nu);
    if (this._verstuurd.size > 256) for (const [k, t] of this._verstuurd) if (nu - t > ECHO_MS) this._verstuurd.delete(k);
  }

  /** Naar de controller, door de wachtrij. `direct` alleen bij het sluiten van de pagina. */
  stuur(bytes, opties) {
    if (!this.uitvoer()) return false;
    this.wachtrij.zet(bytes, opties);
    return true;
  }

  stuurSysex(bytes, opties) {
    if (!this.sysex) { this.emit('fout', new Error('sysex niet toegestaan: de lampjes blijven grotendeels dood')); return false; }
    return this.stuur(bytes, opties);
  }

  _verstuur(bytes) {
    const uit = this.uitvoer();
    if (!uit) return;
    try { uit.send(bytes); } catch (fout) { this.emit('fout', fout); return; }
    this.verstuurd++;
    if ((bytes[0] & 0xf0) === 0xb0 && bytes[0] < 0xf0) this._onthoud(parseBericht(bytes));
  }

  status() {
    const p = (x) => (x ? { id: x.id, naam: x.name } : null);
    return {
      in: p(this.invoer()), uit: p(this.uitvoer()), sysex: this.sysex,
      ontvangen: this.ontvangen, verstuurd: this.verstuurd, echos: this.echos, wachtrij: this.wachtrij.lengte,
    };
  }
}
