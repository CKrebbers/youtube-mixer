import { MidiHub } from './midi.js';

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
 */

export const APP = 'varve-dj';
export const HB_S = 1;
/** Wachttijden bij herverbinden (PROTOCOL.md §3), en na 4001 "vervangen" (§11). */
export const WACHT_MS = [500, 1000, 2000, 5000];
export const VERVANGEN = 4001;
export const VERVANGEN_MS = 30000;
const BEELD_MS = 16;   // LED's bundelen per beeld (setTimeout, geen rAF: die staat stil op de achtergrond)
const TIK_MS = 200;    // eigen wijzigingen terugmelden; elke 4e tik een hartslag (0,8 × hb_s)

/** Wat de hub mag zetten: alleen dingen die de APC/muis ook mogen, via de bus. */
export const PARAMS = [
  { id: 'master', naam: 'Master', soort: 'waarde', standaard: 0.8, hint: 'fader', rol: 'macro.intensiteit', slew_s: 0.25, action: 'mixer.master' },
  { id: 'xfader', naam: 'Crossfader', soort: 'waarde', standaard: 0.5, hint: 'fader', slew_s: 2, action: 'mixer.xfader' },
  { id: 'beeld', naam: 'Beeld', soort: 'waarde', standaard: 1, hint: 'knop', rol: 'macro.helderheid', slew_s: 0.25, action: 'video.master' },
  { id: 'puls', naam: 'Puls op de tel', soort: 'waarde', standaard: 0, hint: 'knop', rol: 'macro.beweging', action: 'video.pulse' },
];

export const MANIFEST = {
  v: 1, app: APP, naam: 'Varve DJ', kleur: '#4ad9c4', truth: 'app', hb_s: HB_S,
  lease: true, rings: 'host',
  params: PARAMS.map(({ action: _a, ...p }) => p),
};

const klem = (v) => Math.max(0, Math.min(1, v));
const isBytes = (b) => Array.isArray(b) && b.length > 0 && b.length <= 512 && b.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
/** Loslaten (note-off) komt ook zonder focus door: dan blijft er nooit een knop hangen. */
const isLos = (b) => (b[0] & 0xf0) === 0x80 || ((b[0] & 0xf0) === 0x90 && b[2] === 0);

export class HubMidi extends MidiHub {
  /**
   * @param url     ws://…/app van de hub
   * @param invoke  (actionId, waarde) — de action-bus
   * @param read    (actionId) -> 0..1 of null
   * @param WS      de WebSocket-klasse (de test geeft een nep)
   */
  constructor({ url, invoke, read, WS = globalThis.WebSocket, inst = Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }) {
    super();
    Object.assign(this, { url, invoke, read, WS, inst });
    this.ws = null;
    this.stap = 0;               // index in WACHT_MS
    this.focus = false;          // heeft VARVE de APC? (de hub zegt het met {t:'focus'})
    this.gezet = new Map();      // param-id -> laatste waarde die de hub van ons kent
    this.leds = [];              // LED-berichten van dit beeld
    this.ledTimer = null;
    this.tikker = null;
    this.tikken = 0;
    this.herverbind = null;
    this.ingeslikt = 0;          // SysEx die niet naar de hub ging (de init)
    this.gestopt = false;
    const poort = (type) => ({ id: `hub-apc40-${type}`, name: 'APC40 mkII (hub)', manufacturer: 'varve-hub', type, state: 'disconnected', connection: 'closed' });
    this.poortIn = { ...poort('input'), onmidimessage: null };
    this.poortUit = { ...poort('output'), send: (b) => this._led(b) };
  }

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
    this.ws?.close();
  }

  status() {
    return { ...super.status(), hub: { url: this.url, verbonden: this.poortIn.state === 'connected', focus: this.focus, ingeslikt: this.ingeslikt } };
  }

  // ---- verbinding ----------------------------------------------------------

  get open() { return this.ws?.readyState === 1; }
  _stuur(b) { if (this.open) this.ws.send(JSON.stringify(b)); }

  _verbind() {
    if (this.gestopt) return;
    let ws;
    try { ws = new this.WS(this.url); } catch (err) { this.error = `hub: ${err?.message || err}`; this._opnieuw(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.stap = 0;
      this.focus = false;
      this._stuur({ t: 'hallo', app: APP, inst: this.inst, v: 1 });
      this._stuur({ t: 'manifest', manifest: MANIFEST });
      this._stuur({ t: 'staat', waarden: this._waarden() });
      this._poorten('connected');   // -> MidiHub 'output' -> feedback.init(): alle LED's opnieuw
    };
    ws.onmessage = (e) => this._bericht(e.data);
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this._poorten('disconnected');   // -> mapping.losgekoppeld(): shift en ingedrukte knoppen los
      this._opnieuw(e?.code);
    };
  }

  _opnieuw(code) {
    if (this.gestopt) return;
    const ms = code === VERVANGEN ? VERVANGEN_MS : WACHT_MS[Math.min(this.stap++, WACHT_MS.length - 1)];
    this.herverbind = setTimeout(() => this._verbind(), ms);
  }

  _poorten(state) {
    for (const p of [this.poortIn, this.poortUit]) { p.state = state; p.connection = state === 'connected' ? 'open' : 'closed'; }
    this.access?.onstatechange?.();
  }

  // ---- van de hub ----------------------------------------------------------

  _bericht(tekst) {
    let b;
    try { b = JSON.parse(tekst); } catch (_) { return; }
    if (!b || typeof b !== 'object') return;
    if (b.t === 'midi') {
      if (b.dev !== 'apc40' || !isBytes(b.bytes) || this.poortIn.state !== 'connected') return;
      if (this.focus || isLos(b.bytes)) this.poortIn.onmidimessage?.({ data: Uint8Array.from(b.bytes), timeStamp: performance.now() });
    } else if (b.t === 'focus') {
      this.focus = b.aan === true;     // focus weg: niets uitzetten, alleen geen invoer meer
    } else if (b.t === 'zet' || b.t === 'trig') {
      const p = PARAMS.find((x) => x.id === b.id);
      if (!p) return;
      if (b.t === 'trig' && p.soort === 'trigger') this.invoke(p.action, b.aan === true);
      if (b.t === 'zet' && p.soort !== 'trigger' && Number.isFinite(b.v)) {
        this.invoke(p.action, klem(b.v));
        this.gezet.set(p.id, this.read(p.action) ?? klem(b.v));   // niet terugkaatsen
      }
    } else if (b.t === 'fout') console.warn('[hub]', b.reden);
    // welkom, globaal, scene en alles wat nog komt: negeren
  }

  // ---- naar de hub ---------------------------------------------------------

  _waarden() {
    const w = {};
    for (const p of PARAMS) if (p.soort !== 'trigger') { w[p.id] = klem(this.read(p.action) ?? p.standaard); this.gezet.set(p.id, w[p.id]); }
    return w;
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
    if (++this.tikken % Math.round((HB_S * 800) / TIK_MS) === 0) this._stuur({ t: 'hb' });
  }

  _led(bytes) {
    const b = [...bytes];
    if (b[0] === 0xf0) { this.ingeslikt++; return; }   // init-SysEx: de hub zet de modus
    this.leds.push(b);
    this.ledTimer ??= setTimeout(() => {
      this.ledTimer = null;
      if (this.leds.length) this._stuur({ t: 'led', bytes: this.leds });
      this.leds = [];
    }, BEELD_MS);
  }
}
