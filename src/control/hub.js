import { MidiHub, PER_TIK, TIK_MS as RIJ_MS } from './midi.js';

/**
 * De koppeling met de AV-app-hub (repo AV-app-hub, PROTOCOL.md §5: lease).
 * Alleen met `?hub=ws://…` (vlag.js); zonder vlag wordt dit bestand niet eens geladen.
 *
 * De hub is de enige die de APC40 en de LPD8 opent. Voor VARVE is hij een
 * vervanger van de Web MIDI-poort: `HubMidi` is een MidiHub met één nep-poort
 * "APC40 mkII (hub)", dus mapping, LED-laag, mapjes en leren werken zoals altijd.
 *   invoer:  {t:'midi', dev:'apc40', bytes}  -> poort.onmidimessage -> MidiHub
 *   uitvoer: poort.send(bytes)  -> per beeld gebundeld -> {t:'led', bytes:[…]}
 * requestMIDIAccess wordt NOOIT aangeroepen, de Web Lock beslist niets over MIDI
 * (twee tabbladen regelt de hub: de nieuwste wint, de oude krijgt 4001), en de
 * init-SysEx gaat niet naar buiten: de modus (0x42) zet de hub.
 *
 * Daarnaast een paar parameters met een rol, zodat de LPD8-macro's iets doen.
 * Die gaan via de action-bus (de engine klemt en glijdt zelf, regel 2), en wat
 * VARVE zelf verandert gaat terug als `zet` (de app is de bron van waarheid).
 *
 * SPEELAPPARATEN (PROTOCOL §17, sinds 5 okt): VARVE speelt de E-MU Xboard49 en
 * de Maschine MK2 (`speelt` in het manifest). Elk heeft een EIGEN nep-poort met
 * de interface van een MIDIInput (`speelPoort(dev)`), NIET in `access.inputs`:
 * de MidiHub (en dus de APC-mapping en het echofilter) ziet ze nooit.
 *   {t:'midi', dev:'xboard49'}     -> "Xboard49 (hub)"      -> noten.js (koppel)
 *   {t:'midi', dev:'maschine-mk2'} -> "Maschine MK2 (hub)"  -> maschine.js
 *   Maschine-uitgang send(bytes)   -> wachtrij -> per beeld {t:'led', dev:'maschine-mk2', bytes}
 *   scherm(nr, 2048 bytes)         -> wachtrij -> {t:'scherm', dev:'maschine-mk2', nr, data: base64}
 * Geen focusfilter: wie speelt beslist de hub, en een loslaten komt altijd bij
 * wie het indrukken kreeg. Valt de verbinding weg, dan gaan de poorten op
 * 'disconnected' (met een statechange): wie ze gekoppeld heeft laat los.
 */

export const APP = 'varve-dj';
export const HB_S = 1;
/** Wachttijden bij herverbinden (PROTOCOL.md §3), en na 4001 "vervangen" (§11). */
export const WACHT_MS = [500, 1000, 2000, 5000];
export const VERVANGEN = 4001;
export const VERVANGEN_MS = 30000;
/** Pas na zo lang open telt een verbinding als gelukt (wachttijd terug naar 0,5 s). */
export const STABIEL_MS = 3000;
/** Een socket die na zo lang nog niet open is (onbereikbare host), sluiten we zelf. */
export const OPEN_MS = 5000;
/**
 * Hartslag op de TIJD, niet op het aantal tikken: Chrome laat timers in een
 * verborgen, stil tabblad hooguit 1× per seconde lopen (na 5 min 1× per minuut).
 * Daarom kijkt ook elk binnenkomend bericht (de hub stuurt `globaal` ~10×/s,
 * WebSocket-events worden niet geknepen) of er een hb moet. Elk bericht telt.
 * 0,6 s stilte + hooguit één tik van 0,2 s = op de voorgrond nooit meer dan 0,8 s.
 */
export const HB_MS = HB_S * 600;
const BEELD_MS = 16;   // LED's bundelen per beeld (setTimeout, geen rAF: die staat stil op de achtergrond)
const TIK_MS = 200;    // eigen wijzigingen terugmelden, en kijken of er een hartslag moet

/**
 * Wat de hub mag zetten: alleen dingen die de APC/muis ook mogen, via de bus.
 * Rollen alleen op het BEELD: de pickup van een LPD8-knop volgt de eerste app
 * met die rol, en andere apps gebruiken macro.intensiteit als beeldintensiteit.
 * Het audio-eindvolume aan K1 hangen gaf een hoorbare dip midden in een set.
 * Master en crossfader staan er zonder rol (en zonder slew: de hub laat alleen
 * rol-zets glijden) voor de cockpit.
 */
export const PARAMS = [
  { id: 'master', naam: 'Master', soort: 'waarde', standaard: 0.8, hint: 'fader', action: 'mixer.master' },
  { id: 'xfader', naam: 'Crossfader', soort: 'waarde', standaard: 0.5, hint: 'fader', action: 'mixer.xfader' },
  { id: 'beeld', naam: 'Beeld', soort: 'waarde', standaard: 1, hint: 'knop', rol: 'macro.helderheid', slew_s: 0.25, action: 'video.master' },
  { id: 'puls', naam: 'Puls op de tel', soort: 'waarde', standaard: 0, hint: 'knop', rol: 'macro.beweging', action: 'video.pulse' },
  // LPD8 P1 (1 s vasthouden): het eindbeeld zwart zolang je vasthoudt, loslaten = de schakelaar beslist weer. De audio blijft.
  { id: 'paniek', naam: 'Paniek (beeld zwart)', soort: 'trigger', action: 'video.black.hold' },
];

/**
 * De speelapparaten (PROTOCOL §17) en hun nep-poort. De Xboard ontvangt niets
 * (alleen een ingang); de Maschine heeft lampjes en twee schermen.
 */
export const SPEELPOORTEN = {
  xboard49: { naam: 'Xboard49 (hub)', uit: false },
  'maschine-mk2': { naam: 'Maschine MK2 (hub)', uit: true },
};
/** Eén scherm van de Maschine: 256 × 64 pixels, 1 bit, rij voor rij, hoogste bit links (docs/MASCHINE.md). */
export const SCHERM_BYTES = 2048;

export const MANIFEST = {
  v: 1, app: APP, naam: 'Varve DJ', kleur: '#4ad9c4', truth: 'app', hb_s: HB_S,
  lease: true, rings: 'host', speelt: Object.keys(SPEELPOORTEN),
  params: PARAMS.map(({ action: _a, ...p }) => p),
};

const klem = (v) => Math.max(0, Math.min(1, v));
const isBytes = (b) => Array.isArray(b) && b.length > 0 && b.length <= 512 && b.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
/** Loslaten (note-off) komt ook zonder focus door: dan blijft er nooit een knop hangen. */
const isLos = (b) => (b[0] & 0xf0) === 0x80 || ((b[0] & 0xf0) === 0x90 && b[2] === 0);
/** Wat de hub als lampje aanneemt (PROTOCOL §3): precies één note off/on of CC van 3 bytes. */
const isLampje = (b) => b.length === 3 && [0x80, 0x90, 0xb0].includes(b[0] & 0xf0) && b[1] <= 0x7f && b[2] <= 0x7f;
/** Bytes -> base64 (zonder Buffer: dit draait in de browser). */
const base64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };

export class HubMidi extends MidiHub {
  /**
   * @param url     ws://…/app van de hub
   * @param invoke  (actionId, waarde) — de action-bus
   * @param read    (actionId) -> 0..1 of null
   * @param WS      de WebSocket-klasse (de test geeft een nep)
   * @param klok    () -> ms (de test geeft een nep-klok)
   */
  constructor({ url, invoke, read, WS = globalThis.WebSocket, klok = () => performance.now(),
    inst = Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }) {
    super();
    Object.assign(this, { url, invoke, read, WS, klok, inst });
    this.ws = null;
    this.stap = 0;               // index in WACHT_MS
    this.focus = false;          // heeft VARVE de APC? (de hub zegt het met {t:'focus'})
    this.vervangen = false;      // een nieuwer VARVE-tabblad heeft de hub (4001)
    this.gezet = new Map();      // param-id -> laatste waarde die de hub van ons kent
    this.ingedrukt = new Set();  // triggers die de hub indrukte en nog niet losliet
    this.leds = [];              // LED-berichten van dit beeld
    this.ledTimer = null;
    this.tikker = null;
    this.laatsteUit = -Infinity; // klok() van het laatste bericht naar de hub
    this.herverbind = null;
    this.openTimer = null;
    this.stabielTimer = null;
    this.ingeslikt = 0;          // SysEx die niet naar de hub ging (de init)
    this.gestopt = false;
    const poort = (type) => ({ id: `hub-apc40-${type}`, name: 'APC40 mkII (hub)', manufacturer: 'varve-hub', type, state: 'disconnected', connection: 'closed' });
    this.poortIn = { ...poort('input'), onmidimessage: null };
    this.poortUit = { ...poort('output'), send: (b) => this._led(b) };
    // De speelapparaten: per apparaat een eigen ingang (en voor de Maschine een
    // uitgang en de schermen). Niet in access.inputs: de MidiHub ziet ze nooit.
    this.speel = {};
    for (const [dev, s] of Object.entries(SPEELPOORTEN)) {
      const p = (type) => ({ id: `hub-${dev}-${type}`, name: s.naam, manufacturer: 'varve-hub', type, state: 'disconnected', connection: 'closed', onstatechange: null });
      this.speel[dev] = {
        dev,
        in: { ...p('input'), onmidimessage: null },
        uit: s.uit ? { ...p('output'), send: (b) => this._speelUit(dev, b) } : null,
        scherm: s.uit ? (nr, data) => this._scherm(dev, nr, data) : null,
        rx: 0, leds: 0, schermen: 0, geweigerd: 0,
      };
    }
    this.uitRij = [];            // naar de speelapparaten: { dev, bytes } of { dev, nr, data }
    this.uitTikker = null;
  }

  /**
   * De nep-poorten van een speelapparaat: `{ in, uit, scherm(nr, bytes) }`, of
   * null voor een apparaat dat VARVE niet speelt. `in` heeft de interface van
   * een MIDIInput (onmidimessage, onstatechange, state).
   */
  speelPoort(dev) { return this.speel[dev] ?? null; }

  get supported() { return true; }
  // Clay's eigen poortkeuze (localStorage) blijft van de echte APC.
  _save() {}
  _restore() {}

  async _request() {
    this.access = { inputs: new Map([[this.poortIn.id, this.poortIn]]), outputs: new Map([[this.poortUit.id, this.poortUit]]),
      sysexEnabled: true, onstatechange: null };
    this.sysex = true;
    this.enabled = true;
    this.access.onstatechange = () => this._sync();
    this._sync();
    this.tikker = setInterval(() => this._tik(), TIK_MS);
    this._verbind();
    return true;
  }

  stop() {
    this.gestopt = true;
    clearInterval(this.tikker); clearTimeout(this.herverbind); clearTimeout(this.ledTimer);
    clearTimeout(this.openTimer); clearTimeout(this.stabielTimer); clearTimeout(this.uitTikker);
    this.ws?.close();
  }

  status() {
    const speelt = {};
    for (const s of Object.values(this.speel)) {
      speelt[s.dev] = { naam: s.in.name, verbonden: s.in.state === 'connected', rx: s.rx,
        ...(s.uit ? { leds: s.leds, schermen: s.schermen, geweigerd: s.geweigerd } : {}) };
    }
    return { ...super.status(), hub: { url: this.url, verbonden: this.poortIn.state === 'connected', focus: this.focus,
      vervangen: this.vervangen, ingeslikt: this.ingeslikt, speelt } };
  }

  // ---- verbinding ----------------------------------------------------------

  get open() { return this.ws?.readyState === 1; }
  _stuur(b) {
    if (!this.open) return;
    this.ws.send(JSON.stringify(b));
    this.laatsteUit = this.klok();
  }

  _verbind() {
    if (this.gestopt) return;
    let ws;
    try { ws = new this.WS(this.url); } catch (err) { this.error = `hub: ${err?.message || err}`; this._opnieuw(); return; }
    this.ws = ws;
    // Blijft hij hangen in CONNECTING (onbereikbare host): zelf opgeven, dan neemt _opnieuw het over.
    this.openTimer = setTimeout(() => {
      if (this.ws !== ws || ws.readyState !== 0) return;
      this._weg(ws, 1006);
      try { ws.close(); } catch (_) { /* al dicht */ }
    }, OPEN_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.openTimer);
      this.focus = false;
      this._stuur({ t: 'hallo', app: APP, inst: this.inst, v: 1 });
      this._stuur({ t: 'manifest', manifest: MANIFEST });
      this._stuur({ t: 'staat', waarden: this._waarden() });
      this._poorten('connected');   // -> MidiHub 'output' -> feedback.init(): alle LED's opnieuw
      // De wachttijd pas terug naar 0,5 s als de hub ons ook HOUDT: een hub die
      // aanneemt en meteen weer sluit, laat ons anders elke 0,5 s opnieuw proberen.
      this.stabielTimer = setTimeout(() => {
        if (this.ws !== ws || !this.open) return;
        this.stap = 0;
        this._zetVervangen(false);
      }, STABIEL_MS);
    };
    ws.onmessage = (e) => { if (this.ws !== ws) return; this._bericht(e.data); this._hartslag(); };
    ws.onerror = () => {};
    ws.onclose = (e) => this._weg(ws, e?.code);
  }

  /** De verbinding is weg (gesloten door de hub, het netwerk, of door ons na OPEN_MS). */
  _weg(ws, code) {
    if (this.ws !== ws) return;
    this.ws = null;
    clearTimeout(this.openTimer); clearTimeout(this.stabielTimer);
    // Een trigger die de hub indrukte kan hij nu niet meer loslaten: dat doen we zelf.
    for (const id of this.ingedrukt) { const p = PARAMS.find((x) => x.id === id); if (p) this.invoke(p.action, false); }
    this.ingedrukt.clear();
    if (code === VERVANGEN) this._zetVervangen(true);
    // Wat nog voor de speelapparaten klaarstond gaat nergens meer heen (bij
    // terugkomen tekent maschine.js alles opnieuw).
    this.uitRij.length = 0;
    this._poorten('disconnected');   // -> mapping.losgekoppeld(): shift en ingedrukte knoppen los; speelpoorten: noten los
    this._opnieuw(code);
  }

  _opnieuw(code) {
    if (this.gestopt) return;
    const ms = code === VERVANGEN ? VERVANGEN_MS : WACHT_MS[Math.min(this.stap++, WACHT_MS.length - 1)];
    this.herverbind = setTimeout(() => this._verbind(), ms);
  }

  _poorten(state) {
    const zet = (p) => { p.state = state; p.connection = state === 'connected' ? 'open' : 'closed'; };
    for (const p of [this.poortIn, this.poortUit]) zet(p);
    // De speelpoorten melden het zelf (statechange, zoals een MIDIPort): wie ze
    // gekoppeld heeft (noten.js, maschine.js) laat los of tekent opnieuw.
    for (const s of Object.values(this.speel)) {
      for (const p of [s.in, s.uit]) {
        if (!p || p.state === state) continue;
        zet(p);
        try { p.onstatechange?.({ port: p }); } catch (err) { console.warn('[hub] statechange', err); }
      }
    }
    this.access?.onstatechange?.();
  }

  /** 'hub' -> { vervangen, … }: de schermlaag meldt het (app.js). */
  _zetVervangen(aan) {
    if (this.vervangen === aan) return;
    this.vervangen = aan;
    this.emit('hub', this.status().hub);
  }

  // ---- van de hub ----------------------------------------------------------

  _bericht(tekst) {
    let b;
    try { b = JSON.parse(tekst); } catch (_) { return; }
    if (!b || typeof b !== 'object') return;
    if (b.t === 'midi') {
      if (b.dev !== 'apc40') { this._speelIn(b); return; }
      if (!isBytes(b.bytes) || this.poortIn.state !== 'connected') return;
      if (this.focus || isLos(b.bytes)) this.poortIn.onmidimessage?.({ data: Uint8Array.from(b.bytes), timeStamp: performance.now() });
    } else if (b.t === 'focus') {
      this.focus = b.aan === true;     // focus weg: niets uitzetten, alleen geen invoer meer
    } else if (b.t === 'zet' || b.t === 'trig') {
      const p = PARAMS.find((x) => x.id === b.id);
      if (!p) return;
      if (b.t === 'trig' && p.soort === 'trigger') {
        const aan = b.aan === true;
        if (aan) this.ingedrukt.add(p.id); else this.ingedrukt.delete(p.id);
        this.invoke(p.action, aan);
      }
      if (b.t === 'zet' && p.soort !== 'trigger' && Number.isFinite(b.v)) {
        this.invoke(p.action, klem(b.v));
        this.gezet.set(p.id, this.read(p.action) ?? klem(b.v));   // niet terugkaatsen
      }
    } else if (b.t === 'fout') {
      console.warn('[hub]', b.reden);
      if (/^vervangen/.test(String(b.reden))) this._zetVervangen(true);
    }
    // welkom, globaal, scene en alles wat nog komt: negeren
  }

  // ---- naar de hub ---------------------------------------------------------

  _waarden() {
    const w = {};
    for (const p of PARAMS) if (p.soort !== 'trigger') { w[p.id] = klem(this.read(p.action) ?? p.standaard); this.gezet.set(p.id, w[p.id]); }
    return w;
  }

  /** Een hb als er al HB_MS niets naar de hub ging (elk bericht telt als hartslag). */
  _hartslag() {
    if (this.open && this.klok() - this.laatsteUit >= HB_MS) this._stuur({ t: 'hb' });
  }

  /** Wat VARVE zelf veranderde (APC, muis, auto-DJ) als `zet`, en de hartslag. */
  _tik() {
    if (!this.open) return;
    for (const p of PARAMS) {
      const v = p.soort === 'trigger' ? null : this.read(p.action);
      if (v === null || Math.abs(v - (this.gezet.get(p.id) ?? -1)) < 1e-4) continue;
      this.gezet.set(p.id, v);
      this._stuur({ t: 'zet', id: p.id, v: klem(v) });
    }
    this._hartslag();
  }

  _led(bytes) {
    const b = [...bytes];
    if (b[0] === 0xf0) { this.ingeslikt++; return; }   // init-SysEx: de hub zet de modus
    this.leds.push(b);
    this._beeld();
  }

  /** Eén bericht per beeld per apparaat; de APC zoals altijd zonder `dev`. */
  _beeld() {
    this.ledTimer ??= setTimeout(() => {
      this.ledTimer = null;
      if (this.leds.length) this._stuur({ t: 'led', bytes: this.leds });
      this.leds = [];
      for (const s of Object.values(this.speel)) {
        if (s.bundel?.length) this._stuur({ t: 'led', dev: s.dev, bytes: s.bundel });
        s.bundel = [];
      }
    }, BEELD_MS);
  }

  // ---- de speelapparaten (PROTOCOL §17) ----------------------------------------

  /** Invoer van een speelapparaat: altijd door (de hub beslist wie speelt), naar zijn eigen poort. */
  _speelIn(b) {
    const s = this.speel[b.dev];
    if (!s || !isBytes(b.bytes) || s.in.state !== 'connected') return;
    s.rx++;
    s.in.onmidimessage?.({ data: Uint8Array.from(b.bytes), timeStamp: performance.now() });
  }

  /** Een lampje voor een speelapparaat (de uitgang van zijn nep-poort): door de wachtrij. */
  _speelUit(dev, bytes) {
    const s = this.speel[dev];
    const b = [...bytes];
    if (!s?.uit || s.uit.state !== 'connected') return false;
    if (!isLampje(b)) { s.geweigerd++; return false; }
    this._rij({ dev, bytes: b });
    return true;
  }

  /**
   * Een scherm van de Maschine: precies 2048 bytes (256 × 64, 1 bit). Staat er
   * voor dat scherm nog een ouder beeld in de rij, dan vervangt dit het (het
   * oude zou toch meteen overschreven worden).
   */
  _scherm(dev, nr, data) {
    const s = this.speel[dev];
    if (!s?.uit || s.uit.state !== 'connected' || (nr !== 0 && nr !== 1) || data?.length !== SCHERM_BYTES) { if (s) s.geweigerd++; return false; }
    const item = { dev, nr, data: base64(data) };
    const i = this.uitRij.findIndex((x) => x.dev === dev && x.nr === nr);
    if (i >= 0) this.uitRij[i] = item; else this._rij(item);
    return true;
  }

  /**
   * De wachtrij naar de speelapparaten, zoals die van de MidiHub voor de APC:
   * hooguit PER_TIK berichten per RIJ_MS (CLAUDE.md: alles wat naar buiten gaat).
   * Lampjes gaan daarna per beeld gebundeld; een scherm gaat meteen.
   */
  _rij(item) {
    this.uitRij.push(item);
    if (this.uitTikker !== null) return;
    const tik = () => {
      for (let i = 0; i < PER_TIK && this.uitRij.length; i++) {
        const x = this.uitRij.shift();
        const s = this.speel[x.dev];
        if (x.bytes) { (s.bundel ??= []).push(x.bytes); s.leds++; this._beeld(); }
        else { this._stuur({ t: 'scherm', dev: x.dev, nr: x.nr, data: x.data }); s.schermen++; }
      }
      this.uitTikker = this.uitRij.length ? setTimeout(tik, RIJ_MS) : null;
    };
    this.uitTikker = setTimeout(tik, 0);
  }
}
