import { Emitter } from '../lib/emitter.js';

/**
 * De Web MIDI-laag. Kent GEEN actions, GEEN engine en GEEN device-profielen.
 *
 * Hij doet drie dingen: poorten beheren (inclusief loskoppelen en terugkomen),
 * binnenkomende bytes parsen tot een plat bericht, en bytes naar buiten sturen.
 * Wat een bericht *betekent* is de taak van mapping.js; wat er fysiek op het
 * apparaat zit, is de taak van een device-profiel.
 */

const SYSTEM = {
  0xf0: 'sysex', 0xf1: 'mtc', 0xf2: 'songpos', 0xf3: 'songsel',
  0xf6: 'tunereq', 0xf7: 'sysex-end', 0xf8: 'clock', 0xfa: 'start',
  0xfb: 'continue', 0xfc: 'stop', 0xfe: 'sense', 0xff: 'reset',
};

/** Berichten die tientallen keren per seconde komen en een monitor dichtslibben. */
export const NOISY = new Set(['clock', 'sense', 'mtc', 'tunereq']);

export const hex = (bytes) =>
  [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/**
 * Bytes -> plat bericht. Note On met velocity 0 is een Note Off; dat wordt hier
 * al rechtgetrokken zodat niemand verderop die val nog kan intrappen.
 *
 * Velden: type, channel (0-based), number, value (ruw), norm (0..1),
 * on (alleen bij note), sig (`type:channel:number`).
 */
export function parseMessage(data) {
  const raw = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const st = raw[0] ?? 0;

  if (st >= 0xf0) {
    const type = SYSTEM[st] ?? 'system';
    return pack({ type, channel: -1, number: -1, value: 0, norm: 0, raw });
  }

  const kind = st & 0xf0;
  const channel = st & 0x0f;
  const d1 = raw[1] ?? 0;
  const d2 = raw[2] ?? 0;

  switch (kind) {
    case 0x80:
      return pack({ type: 'note', channel, number: d1, value: 0, norm: 0, on: false, raw });
    case 0x90:
      return pack({ type: 'note', channel, number: d1, value: d2, norm: d2 / 127, on: d2 > 0, raw });
    case 0xa0:
      return pack({ type: 'poly', channel, number: d1, value: d2, norm: d2 / 127, raw });
    case 0xb0:
      return pack({ type: 'cc', channel, number: d1, value: d2, norm: d2 / 127, raw });
    case 0xc0:
      return pack({ type: 'pc', channel, number: d1, value: d1, norm: d1 / 127, raw });
    case 0xd0:
      return pack({ type: 'at', channel, number: 0, value: d1, norm: d1 / 127, raw });
    case 0xe0: {
      const v = (d2 << 7) | d1;        // 14-bit, LSB eerst
      return pack({ type: 'pb', channel, number: 0, value: v, norm: v / 16383, raw });
    }
    default:
      return pack({ type: 'onbekend', channel, number: d1, value: d2, norm: d2 / 127, raw });
  }
}

function pack(m) {
  m.sig = m.channel < 0 ? m.type : `${m.type}:${m.channel}:${m.number}`;
  return m;
}

/** Leesbare regel voor de monitor. Kanalen tellen hier vanaf 1, zoals op hardware. */
export function describe(m) {
  switch (m.type) {
    case 'note':  return `${m.on ? 'note on ' : 'note off'}  ch${m.channel + 1}  #${m.number}  vel ${m.value}`;
    case 'cc':    return `cc        ch${m.channel + 1}  #${m.number}  = ${m.value}`;
    case 'pb':    return `pitchbend ch${m.channel + 1}        = ${m.value}`;
    case 'at':    return `aftertouch ch${m.channel + 1}       = ${m.value}`;
    case 'poly':  return `poly at   ch${m.channel + 1}  #${m.number}  = ${m.value}`;
    case 'pc':    return `program   ch${m.channel + 1}  #${m.number}`;
    case 'sysex': return `sysex     ${m.raw.length} bytes`;
    default:      return m.type;
  }
}

/**
 * Is deze poort er echt? Chrome haalt een losgekoppelde poort NIET uit
 * inputs/outputs: hij blijft staan met state 'disconnected' en komt later
 * terug met hetzelfde id. Wie alleen naar `has(id)` kijkt, ziet dan nooit dat
 * hij weg was — en stuurt bij terugkomst geen init, dus blijven de LED's dood.
 */
const aanwezig = (p) => !!p && p.state === 'connected';

const portInfo = (p) => ({
  id: p.id, name: p.name || '(naamloos)',
  manufacturer: p.manufacturer || '', state: p.state, connection: p.connection,
});

/** Virtuele doorgeefpoorten zijn zelden wat je zoekt bij automatisch kiezen. */
const isThrough = (name) => /through|iac|virtual/i.test(name || '');

/**
 * Een SPEELAPPARAAT (E-MU Xboard49, Maschine MK2; docs/MASCHINE.md) is NOOIT
 * "de controller": het speelt noten via noten.js (en de Maschine via
 * maschine.js), niet de APC-mapping. Zonder deze regel pakte de MidiHub het
 * keyboard als de APC ontbrak, en dan werden zijn noten 36–39 grid-pads van de
 * APC-mapping. Ook een bewaarde keuze (localStorage) voor zo'n poort telt niet.
 */
export const isSpeelapparaat = (name) => /xboard|maschine/i.test(name || '');

const STORE_KEY = 'varve.midi.ports';

/**
 * Hoe lang een bericht dat wij zelf verstuurden nog als echo kan terugkomen.
 *
 * Sommige controllers melden een waarde die je naar ze toestuurt gewoon terug.
 * Zonder rem is dat een lus: wij zetten een LED-ring, het apparaat meldt de
 * nieuwe stand, wij verwerken dat als een knopdraai, wij zetten de ring... tot
 * de bus vol staat. 60 ms is ruim voor een USB-retour en te kort om een echte
 * knopbeweging te missen.
 *
 * ALLEEN CC (14 okt 2026). Een lus kan alleen via een ring (CC); een lampje
 * (noot) wordt nooit als druk teruggemeld. Op noten ving het filter echte
 * knoppen: een lampje UIT is [0x90, n, 0] en dat is precies het loslaten van
 * die knop (note:0:n=0), en een eenkleurig lampje AAN ([0x90|kanaal, n, 127]
 * op een knipperende track select of clip stop) is precies het indrukken. Een
 * druk of loslaten binnen 60 ms na zo'n lampje verdween: gemeten 1–4 op 20 s
 * drukken (tools/bench/feedback.mjs), en een ingeslikt loslaten laat een
 * knop hangen (bend, kill vasthouden).
 */
const ECHO_MS = 60;

/**
 * Uitgaande berichten gaan door een wachtrij.
 *
 * Een burst van honderd berichten in één synchrone lus is voor geen enkele
 * MIDI-implementatie prettig, en sommige browsers leggen hun MIDI-service er
 * mee om. Zestien berichten per 4 ms is nog altijd 4000 per seconde — ruim
 * boven wat DIN-MIDI zelf aankan — en een volledige LED-overname van 110
 * berichten is daarmee in 30 ms klaar. Dat ziet niemand.
 */
export const PER_TIK = 16;
export const TIK_MS = 4;

/**
 * Hoe de wachtrij die maat houdt (14 okt 2026): een SCHUIVEND venster. Het
 * zeventiende bericht gaat pas TIK_MS na het eerste van de laatste zestien,
 * dus in elk venster van 4 ms hooguit 16, waar het ook begint. Is er plaats,
 * dan gaat een bericht METEEN (vroeger altijd via een setTimeout(0): ~1 ms en
 * in Chrome soms 4 ms erbij, voor elk lampje).
 */

export class MidiHub extends Emitter {
  /** @param bewaar (sleutel, tekst) -> void: waar de poortkeuze heen gaat (de ui: ook de server); zonder: localStorage. */
  constructor({ preferred = /apc40/i, bewaar = null } = {}) {
    super();
    this.bewaar = bewaar;
    this.access = null;
    this.sysex = false;          // is sysex daadwerkelijk toegestaan?
    this.enabled = false;
    this.error = null;
    this.preferred = preferred;  // naamhint voor automatisch kiezen
    this.inputId = null;         // blijft bewaard als de poort even weg is
    this.outputId = null;
    this.inputName = null;       // poort-ID's veranderen, namen niet
    this.outputName = null;
    this.rx = 0;
    this.tx = 0;
    this.rxSelected = 0;         // verkeer op de gekozen poort
    this.rxOther = 0;            // verkeer op de rest — zwijgt de gekozene, dan is dit het antwoord
    this.echoes = 0;             // teruggekaatste berichten die we genegeerd hebben
    this._verstuurd = new Map(); // 'sig=waarde' -> tijdstip, voor echodetectie
    this._laatsteIn = new Map(); // sig -> laatste CC-waarde die de controller ons stuurde (zie _onthoudVerstuurd)
    // Echo's wegfilteren. Per apparaat uit te zetten (device.echoFilter): het
    // filter kan een echte beweging slikken die toevallig gelijk is aan wat
    // wij net stuurden. De app zet dit bij het kiezen van het apparaat.
    this.echoFilter = true;
    this._wachtrij = [];         // uitgaande bytes, in volgorde
    this._tikker = null;
    this.klok = () => performance.now();   // ms, voor de wachtrij (HubMidi en de tests geven hun eigen klok)
    this._uitT = new Float64Array(PER_TIK).fill(-Infinity);   // de tijd van de laatste PER_TIK verzendingen (ring)
    this._uitI = 0;              // de oudste in de ring
    this.asking = false;         // wachtend op de toestemmingsdialoog van Chrome
    this._pending = null;
    this._lastIn = null;
    this._lastOut = null;
    this._warnedSysex = false;
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }

  /**
   * Vraagt toegang aan. Eerst mét sysex, want zonder sysex blijven de LED's van
   * de APC40 mkII dood. Wordt dat geweigerd, dan draaien we door zonder — spelen
   * werkt dan wel, LED-feedback niet. Dat is zichtbaar in de monitor.
   */
  async init(opts = {}) {
    if (this.enabled) return true;
    // Zolang de toestemmingsdialoog openstaat blijft de promise hangen. Nog een
    // verzoek sturen helpt dan niets, dus hergebruik het lopende verzoek.
    if (this._pending) return this._pending;
    this._pending = this._request(opts).finally(() => {
      this._pending = null;
      this.asking = false;
      this.emit('state');
    });
    return this._pending;
  }

  async _request({ sysex = true } = {}) {
    if (!this.supported) {
      this.error = 'Web MIDI ontbreekt in deze browser — gebruik Chrome.';
      this.emit('state'); return false;
    }
    this.asking = true;
    this.error = null;
    this.emit('state');
    try {
      this.access = await navigator.requestMIDIAccess({ sysex });
      this.sysex = sysex;
    } catch (err) {
      if (sysex) {
        try {
          this.access = await navigator.requestMIDIAccess({ sysex: false });
          this.sysex = false;
        } catch (err2) {
          this.error = String(err2?.message || err2);
          this.emit('state'); return false;
        }
      } else {
        this.error = String(err?.message || err);
        this.emit('state'); return false;
      }
    }

    this.enabled = true;
    this.error = null;
    this.access.onstatechange = () => this._sync();
    this._restore();
    this._sync();
    return true;
  }

  // ---- poorten -----------------------------------------------------------

  ports() {
    return {
      inputs: [...(this.access?.inputs.values() ?? [])].map(portInfo),
      outputs: [...(this.access?.outputs.values() ?? [])].map(portInfo),
    };
  }

  /** De gekozen poorten, alleen als ze aangesloten zijn (zie `aanwezig`). */
  input() { const p = this.access?.inputs.get(this.inputId); return aanwezig(p) ? p : null; }
  output() { const p = this.access?.outputs.get(this.outputId); return aanwezig(p) ? p : null; }

  selectInput(id) {
    this.inputId = id || null;
    this.inputName = this.access?.inputs.get(id)?.name || null;
    this._save(); this._sync();
  }

  selectOutput(id) {
    this.outputId = id || null;
    this.outputName = this.access?.outputs.get(id)?.name || null;
    this._save(); this._sync();
  }

  /** Draait alles opnieuw af: handlers binden, verdwenen poorten melden. */
  _sync() {
    if (!this.access) return;

    for (const port of this.access.inputs.values()) {
      port.onmidimessage = (e) => this._onMessage(port, e);
    }
    this._autoPick();

    // Losgekoppeld telt als weg, ook al staat de poort nog in de lijst: dan
    // geeft terugkomen (zelfde id) wél een nieuw 'output'-event, dus init.
    const inNow = this.input() ? this.inputId : null;
    const outNow = this.output() ? this.outputId : null;

    this.emit('ports', this.ports());
    // Een andere (of terugkomende) controller: wat de vorige ons stuurde zegt niets meer.
    if (inNow !== this._lastIn) { this._lastIn = inNow; this._laatsteIn.clear(); this.emit('input', this.input()); }
    if (outNow !== this._lastOut) { this._lastOut = outNow; this.emit('output', this.output()); }
    this.emit('state');
  }

  /**
   * Kiest een poort als de huidige keuze niet (meer) bestaat.
   *
   * Poort-ID's zijn niet te vertrouwen: los- en weer vastkoppelen kan een
   * nieuw ID opleveren, en een ID uit een vorige sessie kan nergens meer op
   * slaan. De naam blijft wel gelijk. Dus: eerst hetzelfde apparaat op naam
   * terugzoeken, en alleen als er nog nooit een keuze gemaakt is zelf iets
   * uitkiezen. Een bewust gekozen apparaat dat even weg is, blijven we afwachten
   * in plaats van zomaar op een andere poort over te springen.
   */
  _autoPick() {
    // Een speelapparaat is nooit de controller (isSpeelapparaat): ook een keuze
    // uit localStorage, het paneel of een oude versie voor zo'n poort vervalt.
    const speelt = (map, id, naam) => isSpeelapparaat(map.get(id)?.name ?? naam);
    if (this.inputId || this.inputName) {
      if (speelt(this.access.inputs, this.inputId, this.inputName)) { this.inputId = null; this.inputName = null; this._save(); }
    }
    if (this.outputId || this.outputName) {
      if (speelt(this.access.outputs, this.outputId, this.outputName)) { this.outputId = null; this.outputName = null; this._save(); }
    }
    const kies = (map, id, naam) => {
      if (id && aanwezig(map.get(id))) return null;        // keuze staat goed
      const list = [...map.values()].filter((p) => aanwezig(p) && !isSpeelapparaat(p.name));
      if (naam) return list.find((p) => p.name === naam) || null;
      return list.find((p) => this.preferred.test(p.name || ''))
          || list.find((p) => !isThrough(p.name))
          || list[0] || null;
    };
    const i = kies(this.access.inputs, this.inputId, this.inputName);
    if (i) { this.inputId = i.id; this.inputName = i.name; this._save(); }
    const o = kies(this.access.outputs, this.outputId, this.outputName);
    if (o) { this.outputId = o.id; this.outputName = o.name; this._save(); }
  }

  _save() {
    try {
      const tekst = JSON.stringify({
        in: this.inputId, out: this.outputId,
        inName: this.inputName, outName: this.outputName,
      });
      if (this.bewaar) this.bewaar(STORE_KEY, tekst); else localStorage.setItem(STORE_KEY, tekst);
    }
    catch (_) {}
  }

  _restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      this.inputId = s.in || null;
      this.outputId = s.out || null;
      this.inputName = s.inName || null;
      this.outputName = s.outName || null;
    } catch (_) {}
  }

  // ---- ontvangen ---------------------------------------------------------

  _onMessage(port, e) {
    const msg = parseMessage(e.data);
    msg.port = port.id;
    msg.portName = port.name;
    msg.time = e.timeStamp;
    // Tijd tussen de hardware-timestamp en dit moment: het JS-deel van de
    // latency. De ronde MIDI->audio-latency is meer dan dit, maar dit is het
    // stuk waar wij iets aan kunnen doen.
    msg.lag = performance.now() - e.timeStamp;
    msg.selected = port.id === this.inputId;
    msg.echo = this._isEcho(msg);
    if (msg.type === 'cc' && msg.selected) this._laatsteIn.set(msg.sig, msg.value);
    this.rx++;
    if (msg.echo) this.echoes++;
    if (msg.selected) this.rxSelected++; else this.rxOther++;
    this.emit('message', msg);
  }

  /**
   * Abonneer je hierop als je alleen de gekozen controller wilt horen.
   * Echo's van onze eigen uitvoer komen hier niet doorheen.
   */
  onInput(fn) {
    return this.on('message', (m) => { if (m.selected && !m.echo) fn(m); });
  }

  /*
   * Alleen een CC kan een echo zijn (een LED-ring die als knopdraai terugkomt).
   * Een NOOT nooit: een LED zetten is een note-on met de kleur als velocity, en
   * een knop die je indrukt stuurt note-on 127 / note-off. Een lampje op 127
   * (Lock, Sends, de knipperende Track Select) of uit (0) gevolgd door jouw
   * druk of loslaten binnen 60 ms werd hier als echo weggegooid: een druk die
   * niets deed. Gemeten op knoppen die knipperen (Sends met een loop, de Track
   * Select van de maatgever): ~1 op de 8 drukken (controller-invoer, 14 okt;
   * tools/bench/echo.mjs, test/midi.test.mjs). Dat een kill of bend daardoor
   * bleef hangen is NIET aangetoond (hun lampje staat nooit op 0 of 127).
   * Dit geldt voor elk apparaat: ook bij een ander apparaat met echoFilter aan
   * worden noten niet meer als echo gefilterd.
   */
  _isEcho(msg) {
    if (!this.echoFilter || msg.type !== 'cc' || !this._verstuurd.size) return false;
    const sleutel = `${msg.sig}=${msg.value}`;
    const t = this._verstuurd.get(sleutel);
    if (t === undefined) return false;
    if (performance.now() - t > ECHO_MS) { this._verstuurd.delete(sleutel); return false; }
    this._verstuurd.delete(sleutel);   // één echo per verstuurd bericht
    return true;
  }

  /**
   * Een verstuurde CC onthouden voor het echofilter, en oude sporen opruimen
   * (anders groeit die map bij elke LED-update).
   *
   * NIET onthouden (review 14 okt): een waarde die de controller ons op die
   * control net zelf stuurde. Een ring van een endless-knop is precies de
   * waarde die de knop stuurde (softwarestand = vorige + delta); onthouden
   * maakte bij het terugdraaien van een snelle draai elke vorige stap een
   * "echo" en slikte hem in (dode zone van ~60 ms bij elke richtingswissel).
   * Een echo van zo'n waarde is onschuldig: het apparaat staat er al, dus in
   * endless is de delta 0 en in absolute verandert er niets. De lus blijft
   * gevangen, want die begint bij een ring op een waarde die de knop NIET
   * stuurde (focus- of mapjewissel). Behalve op de aanslag (0 en 127): daar is
   * nog eens hetzelfde bericht in endless doordraaien (mapping._endless), dus
   * die blijven we bewaken.
   */
  _onthoudVerstuurd(msg) {
    if (msg.value !== 0 && msg.value !== 127 && this._laatsteIn.get(msg.sig) === msg.value) return;
    const nu = performance.now();
    this._verstuurd.set(`${msg.sig}=${msg.value}`, nu);
    if (this._verstuurd.size > 256) {
      for (const [k, t] of this._verstuurd) if (nu - t > ECHO_MS) this._verstuurd.delete(k);
    }
  }

  // ---- sturen ------------------------------------------------------------

  /**
   * Zet een bericht in de wachtrij. Met `direct` gaat het er meteen uit — dat
   * is alleen voor het laatste moment bij het sluiten van de pagina, want dan
   * is er geen volgende tik meer.
   */
  send(bytes, { direct = false } = {}) {
    if (!this.output()) return false;
    if (direct) return this._verstuur(bytes);
    // Niets wacht en het venster heeft plaats: meteen. Anders achteraan (de volgorde blijft).
    if (!this._wachtrij.length && this._wacht() <= 0) { this._uitRij(bytes); return true; }
    this._wachtrij.push(bytes);
    this._start();
    return true;
  }

  /** Over hoeveel ms er weer een bericht mag (<= 0: nu), volgens het schuivende venster. */
  _wacht() { return this._uitT[this._uitI] + TIK_MS - this.klok(); }

  /** Eén bericht uit de wachtrij de deur uit, en zijn tijd in de ring. */
  _uitRij(bytes) {
    this._uitT[this._uitI] = this.klok();
    this._uitI = (this._uitI + 1) % PER_TIK;
    this._verstuur(bytes);
  }

  _start() {
    if (this._tikker !== null) return;
    const tik = () => {
      while (this._wachtrij.length && this._wacht() <= 0) this._uitRij(this._wachtrij.shift());
      this._tikker = this._wachtrij.length ? setTimeout(tik, Math.max(0, this._wacht())) : null;
    };
    this._tikker = setTimeout(tik, Math.max(0, this._wacht()));
  }

  _verstuur(bytes) {
    const out = this.output();
    if (!out) return false;
    try { out.send(bytes); } catch (err) { this.emit('error', err); return false; }
    this.tx++;
    const msg = parseMessage(bytes);
    // Pas hier onthouden: de echo komt terug na het VERSTUREN, niet na het
    // in de wachtrij zetten. Alleen CC: zie ECHO_MS.
    if (msg.type === 'cc') this._onthoudVerstuurd(msg);
    msg.out = true;
    msg.port = out.id;
    msg.portName = out.name;
    msg.time = performance.now();
    this.emit('tx', msg);
    return true;
  }

  /** Alles wat nog klaarstaat weggooien — bij loskoppelen of een paletproef. */
  leegWachtrij() { const n = this._wachtrij.length; this._wachtrij.length = 0; return n; }

  sendSysex(bytes, opties) {
    if (!this.sysex) {
      if (!this._warnedSysex) {
        this._warnedSysex = true;
        this.emit('error', new Error('sysex niet toegestaan — LED-feedback blijft beperkt'));
      }
      return false;
    }
    return this.send(bytes, opties);
  }

  status() {
    return {
      supported: this.supported, enabled: this.enabled, sysex: this.sysex,
      error: this.error, asking: this.asking,
      input: this.input() ? portInfo(this.input()) : null,
      output: this.output() ? portInfo(this.output()) : null,
      inputId: this.inputId, outputId: this.outputId,
      rx: this.rx, tx: this.tx,
      rxSelected: this.rxSelected, rxOther: this.rxOther, echoes: this.echoes,
      wachtrij: this._wachtrij.length,
      // Alles komt binnen op een poort die niet gekozen is: dan lijkt de
      // controller te werken terwijl er niets doorkomt.
      verkeerdePoort: this.rxSelected === 0 && this.rxOther > 0,
    };
  }
}
