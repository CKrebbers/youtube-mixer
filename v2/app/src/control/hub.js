/**
 * De koppeling met de AV-app-hub (repo AV-app-hub, PROTOCOL.md §3 en §5: lease).
 * Alleen met `?hub=ws://…` (hub-vlag.js); zonder vlag laadt ui/controllers.js dit
 * bestand niet eens (dynamische import).
 *
 * De hub is de enige die de APC40 en de LPD8 opent. Voor VarveDJ is hij een vervanger
 * van de Web MIDI-toegang: `HubMidi` is een MidiHub (midi.js) met één nep-poort
 * "APC40 mkII (hub)", dus indeling, lampjes en leren werken ongewijzigd.
 *   invoer:  {t:'midi', dev:'apc40', bytes} -> poort.onmidimessage -> MidiHub -> 'bericht'
 *            alleen met focus ({t:'focus', aan:true}); een loslaten komt ALTIJD door, dan
 *            blijft er nooit een knop hangen als de focus midden in een druk wegging
 *   uitvoer: stuur(bytes) -> de wachtrij van MidiHub (16 per 4 ms) -> poort.send ->
 *            per beeld gebundeld -> {t:'led', bytes:[[…],…]}
 * De init-SysEx (0x42) gaat niet naar buiten: de modus zet de hub (PROTOCOL §5).
 * requestMIDIAccess wordt nergens gevraagd, en de Web Lock beslist niets over MIDI:
 * twee tabbladen met de vlag regelt de hub zelf (de nieuwste wint, de oude krijgt 4001).
 *
 * Daarnaast een paar parameters met een rol, zodat de LPD8-knoppen iets doen. Die gaan
 * over de bus (de engine schaalt en klemt), en wat VarveDJ zelf verandert (APC, muis,
 * auto-DJ) gaat terug als `zet`: de app is de bron van waarheid (`truth: 'app'`).
 *
 * Overgenomen uit v1 src/control/hub.js (3–16 okt), met wat daar bevochten is:
 * - hartslag op de TIJD, niet op tikken (verborgen tabblad: timers 1×/s, na 5 min 1×/min;
 *   elk bericht van de hub kijkt ook, want WebSocket-events worden niet geknepen);
 * - herverbinden 0,5 → 1 → 2 → 5 s, pas terug naar 0,5 s na 3 s stabiel open (een hub die
 *   aanneemt en meteen sluit: geen lus van 0,5 s); een socket die na 5 s niet open is, sluiten we zelf;
 * - 4001 = vervangen door een nieuwer tabblad: 30 s wachten, en het melden;
 * - paniek (LPD8 P1) = video.black.hold; valt de verbinding weg terwijl hij vastzit, dan
 *   laten wij zelf los;
 * - rollen ALLEEN op het beeld (K2 helderheid = video.master, K4 beweging = video.pulse):
 *   de pickup van een LPD8-knop volgt de eerste app met die rol, en K1 (intensiteit) aan
 *   mixer.master gaf in v1 een hoorbare dip midden in een set. Master en crossfader staan
 *   zonder rol (en zonder slew) in de cockpit.
 * NIET overgenomen (nog niet in v2): de speelapparaten (Xboard49, Maschine MK2: `speelt`,
 * PROTOCOL §17; v2 heeft geen Maschine-koppeling) en de sectie naar de globale laag
 * (`levert: ['sectie']`, §18; v2 heeft geen SectieLezer). Het manifest noemt ze dus niet:
 * een `speelt` dat niets doet zou de hub de Maschine laten leasen aan een app die niets speelt.
 *
 * Geen DOM, geen navigator, geen fetch (regels.test): de WebSocket-klasse, de klok en de
 * timers komen van buiten (de test geeft een nep-WebSocket en een nep-klok).
 */
import { MidiHub } from './midi.js';

export const APP = 'varve-dj';
export const HB_S = 1;
/** Wachttijden bij herverbinden (PROTOCOL §3), en na 4001 "vervangen" (§11). */
export const WACHT_MS = [500, 1000, 2000, 5000];
export const VERVANGEN = 4001;
export const VERVANGEN_MS = 30000;
/** Pas na zo lang open telt een verbinding als gelukt (wachttijd terug naar 0,5 s). */
export const STABIEL_MS = 3000;
/** Een socket die na zo lang nog niet open is (onbereikbare host), sluiten we zelf. */
export const OPEN_MS = 5000;
/**
 * Hartslag: na HB_MS stilte een hb (elk bericht telt als hartslag). 0,6 s + hooguit één
 * tik van 0,2 s = op de voorgrond nooit meer dan 0,8 s stil; de hub noemt een app na 3 s stil.
 */
export const HB_MS = HB_S * 600;
/** Eigen wijzigingen terugmelden en kijken of er een hartslag moet. */
export const TIK_MS = 200;
/**
 * LED's per beeld bundelen (setTimeout, geen rAF: die staat stil op de achtergrond), met een
 * VOORFLANK (v1 14 okt): is er al BEELD_MS geen bundel weg, dan na de lopende taak
 * (timer 0: alles van dezelfde tik of druk samen), anders BEELD_MS na de vorige.
 */
export const BEELD_MS = 16;
/** De naam van de nep-poort: past op de voorkeur van het APC-profiel (/apc40/i). */
export const POORT_NAAM = 'APC40 mkII (hub)';

/**
 * Wat de hub mag zetten: alleen wat de APC en de muis ook mogen, over de bus.
 * `action` gaat niet over de draad (het manifest laat hem weg).
 */
export const PARAMS = Object.freeze([
  { id: 'master', naam: 'Master', soort: 'waarde', standaard: 0.8, hint: 'fader', action: 'mixer.master' },
  { id: 'xfader', naam: 'Crossfader', soort: 'waarde', standaard: 0.5, hint: 'fader', action: 'mixer.xfader' },
  { id: 'beeld', naam: 'Beeld', soort: 'waarde', standaard: 1, hint: 'knop', rol: 'macro.helderheid', slew_s: 0.25, action: 'video.master' },
  { id: 'puls', naam: 'Puls op de tel', soort: 'waarde', standaard: 0, hint: 'knop', rol: 'macro.beweging', action: 'video.pulse' },
  // LPD8 P1 (1 s vasthouden): het eindbeeld zwart zolang je vasthoudt; loslaten = de schakelaar beslist weer. De audio blijft.
  { id: 'paniek', naam: 'Paniek (beeld zwart)', soort: 'trigger', action: 'video.black.hold' },
].map((p) => Object.freeze(p)));

export const MANIFEST = Object.freeze({
  v: 1, app: APP, naam: 'Varve DJ', kleur: '#4ad9c4', truth: 'app', hb_s: HB_S,
  lease: true, rings: 'host',
  params: PARAMS.map(({ action: _a, ...p }) => p),
});

const klem = (v) => Math.max(0, Math.min(1, v));
const isBytes = (b) => Array.isArray(b) && b.length > 0 && b.length <= 512 && b.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
/** Loslaten (note off, of note on met velocity 0): komt ook zonder focus door. */
const isLos = (b) => (b[0] & 0xf0) === 0x80 || ((b[0] & 0xf0) === 0x90 && b[2] === 0);
/** Wat de hub als lampje aanneemt (PROTOCOL §3): precies één note off/on of CC van 3 bytes. */
const isLampje = (b) => b.length === 3 && [0x80, 0x90, 0xb0].includes(b[0] & 0xf0) && b[1] <= 0x7f && b[2] <= 0x7f;

const standaardKlok = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const standaardTimers = () => ({
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
});
const nieuweInst = () => Math.random().toString(36).slice(2, 10) + Math.floor(standaardKlok()).toString(36);

/**
 * Gebeurtenissen (naast die van MidiHub: 'bericht', 'verbonden', 'weg', 'invoer', 'poorten', 'fout'):
 *   'hub'  status().hub, als verbonden, focus of vervangen verandert
 */
export class HubMidi extends MidiHub {
  /**
   * @param url     ws://…/app van de hub (uit hubAdres)
   * @param bus     de bus van de engine (doe/lees); of los:
   * @param doe     (actie, waarde) -> de bus
   * @param lees    (actie) -> 0..1 of null
   * @param WS      de WebSocket-klasse (de test geeft een nep)
   * @param klok    () -> ms
   * @param timers  { setTimeout, clearTimeout, setInterval, clearInterval }
   * @param inst    willekeurig per start (zo ziet de hub een herstart)
   */
  constructor({ url, bus = null, doe = null, lees = null, WS = globalThis.WebSocket, klok = standaardKlok,
    timers = standaardTimers(), inst = nieuweInst(), voorkeur = /apc40/i, echoFilter = true } = {}) {
    let ik = null;
    const poort = (type) => ({ id: `hub-apc40-${type}`, name: POORT_NAAM, manufacturer: 'varve-hub', type, state: 'disconnected', connection: 'closed' });
    const poortIn = { ...poort('input'), onmidimessage: null };
    const poortUit = { ...poort('output'), send: (b) => ik._led(b) };
    const toegang = {
      inputs: new Map([[poortIn.id, poortIn]]), outputs: new Map([[poortUit.id, poortUit]]),
      sysexEnabled: true, onstatechange: null,
      // Zoals een MIDIAccess (noten.js luistert zo); hier komt alleen de statechange van de hub-poort.
      addEventListener() {}, removeEventListener() {},
    };
    super({ toegang, voorkeur, klok, timers, echoFilter });
    ik = this;
    this.url = url;
    this.WS = WS;
    this.timers = timers;
    this.inst = inst;
    this.poortIn = poortIn;
    this.poortUit = poortUit;
    this._doe = doe ?? ((id, v) => bus?.doe(id, v, { bron: 'hub' }));
    this._lees = lees ?? ((id) => bus?.lees(id) ?? null);
    this.ws = null;
    this.stap = 0;               // index in WACHT_MS
    this.focus = false;          // heeft VarveDJ de APC? (de hub zegt het met {t:'focus'})
    this.vervangen = false;      // een nieuwer tabblad heeft de hub (4001)
    this.gezet = new Map();      // param-id -> laatste waarde die de hub van ons kent
    this.ingedrukt = new Set();  // triggers die de hub indrukte en nog niet losliet
    this.leds = [];              // LED-berichten van dit beeld
    this.ledTimer = null;
    this.beeldUit = -Infinity;   // klok() van de laatste bundel
    this.laatsteUit = -Infinity; // klok() van het laatste bericht naar de hub
    this.tikker = null;
    this.herverbind = null;
    this.openTimer = null;
    this.stabielTimer = null;
    this.ingeslikt = 0;          // SysEx die niet naar de hub ging (de init)
    this.ledsUit = 0;            // lampjes naar de hub
    this.geweigerd = 0;          // wat geen lampje was (de hub neemt het niet aan)
    this.gestopt = false;
  }

  /** Geen poortkeuze en geen MIDI-toegang: de poort komt er als de hub antwoordt. */
  start() {
    if (this.tikker !== null || this.gestopt) return this;
    super.start();
    this.tikker = this.timers.setInterval(() => this._tik(), TIK_MS);
    this._verbind();
    return this;
  }

  stop() {
    this.gestopt = true;
    const t = this.timers;
    if (this.tikker !== null) t.clearInterval(this.tikker);
    for (const x of [this.herverbind, this.ledTimer, this.openTimer, this.stabielTimer]) if (x !== null) t.clearTimeout(x);
    this.tikker = this.herverbind = this.ledTimer = this.openTimer = this.stabielTimer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch (_) { /* al dicht */ }
    super.stop();
  }

  get verbonden() { return this.poortIn.state === 'connected'; }

  status() {
    return { ...super.status(), hub: { url: this.url, verbonden: this.verbonden, focus: this.focus, vervangen: this.vervangen,
      ingeslikt: this.ingeslikt, leds: this.ledsUit, geweigerd: this.geweigerd } };
  }

  // ---- de bus ----------------------------------------------------------------

  _invoke(id, v) { try { this._doe(id, v); } catch (fout) { this.emit('fout', fout); } }
  _read(id) { try { const v = this._lees(id); return typeof v === 'boolean' ? (v ? 1 : 0) : (Number.isFinite(v) ? v : null); } catch (_) { return null; } }

  // ---- verbinding ------------------------------------------------------------

  get open() { return this.ws?.readyState === 1; }

  _stuurHub(b) {
    if (!this.open) return;
    this.ws.send(JSON.stringify(b));
    this.laatsteUit = this.klok();
  }

  _verbind() {
    if (this.gestopt) return;
    this.herverbind = null;
    let ws;
    try { ws = new this.WS(this.url); } catch (fout) { this.emit('fout', new Error(`hub: ${fout?.message ?? fout}`)); this._opnieuw(); return; }
    this.ws = ws;
    // Blijft hij hangen in CONNECTING (onbereikbare host): zelf opgeven, dan neemt _opnieuw het over.
    this.openTimer = this.timers.setTimeout(() => {
      this.openTimer = null;
      if (this.ws !== ws || ws.readyState !== 0) return;
      this._weg(ws, 1006);
      try { ws.close(); } catch (_) { /* al dicht */ }
    }, OPEN_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this._wis('openTimer');
      this.focus = false;
      this._stuurHub({ t: 'hallo', app: APP, inst: this.inst, v: 1 });
      this._stuurHub({ t: 'manifest', manifest: MANIFEST });
      this._stuurHub({ t: 'staat', waarden: this._staatWaarden() });
      this._poorten('connected');   // -> MidiHub 'verbonden' -> lampjes.init(): alles opnieuw naar de hub
      // De wachttijd pas terug naar 0,5 s als de hub ons ook HOUDT.
      this.stabielTimer = this.timers.setTimeout(() => {
        this.stabielTimer = null;
        if (this.ws !== ws || !this.open) return;
        this.stap = 0;
        this._zetVervangen(false);
      }, STABIEL_MS);
    };
    // Elk bericht kijkt ook of er een hb moet: WebSocket-events worden in een verborgen tabblad niet geknepen.
    ws.onmessage = (e) => { if (this.ws !== ws) return; this._bericht(e?.data); this._hartslag(); };
    ws.onerror = () => {};
    ws.onclose = (e) => this._weg(ws, e?.code);
  }

  _wis(naam) { if (this[naam] !== null) { this.timers.clearTimeout(this[naam]); this[naam] = null; } }

  /** De verbinding is weg (gesloten door de hub, het netwerk, of door ons na OPEN_MS). */
  _weg(ws, code) {
    if (this.ws !== ws) return;
    this.ws = null;
    this._wis('openTimer');
    this._wis('stabielTimer');
    // Een trigger die de hub indrukte kan hij nu niet meer loslaten: dat doen we zelf.
    for (const id of this.ingedrukt) { const p = PARAMS.find((x) => x.id === id); if (p) this._invoke(p.action, false); }
    this.ingedrukt.clear();
    this.leds = [];
    this._wis('ledTimer');
    this.focus = false;
    if (code === VERVANGEN) this._zetVervangen(true);
    this._poorten('disconnected');   // -> MidiHub 'weg' -> indeling.losgekoppeld(): shift en alles wat vastzat los
    this._opnieuw(code);
  }

  _opnieuw(code) {
    if (this.gestopt) return;
    const ms = code === VERVANGEN ? VERVANGEN_MS : WACHT_MS[Math.min(this.stap++, WACHT_MS.length - 1)];
    this.herverbind = this.timers.setTimeout(() => this._verbind(), ms);
  }

  _poorten(state) {
    const was = this.poortIn.state;
    for (const p of [this.poortIn, this.poortUit]) { p.state = state; p.connection = state === 'connected' ? 'open' : 'closed'; }
    this.toegang.onstatechange?.({ port: this.poortIn });
    if (was !== state) this.emit('hub', this.status().hub);
  }

  _zetVervangen(aan) {
    if (this.vervangen === aan) return;
    this.vervangen = aan;
    this.emit('hub', this.status().hub);
  }

  // ---- van de hub ------------------------------------------------------------

  _bericht(tekst) {
    let b;
    try { b = JSON.parse(typeof tekst === 'string' ? tekst : String(tekst)); } catch (_) { return; }
    if (!b || typeof b !== 'object') return;
    if (b.t === 'midi') {
      // Alleen de APC: de speelapparaten (§17) speelt v2 nog niet; die stuurt de hub ons ook niet (geen `speelt`).
      if (b.dev !== 'apc40' || !isBytes(b.bytes) || !this.verbonden) return;
      if (this.focus || isLos(b.bytes)) this.poortIn.onmidimessage?.({ data: Uint8Array.from(b.bytes), timeStamp: this.klok() });
    } else if (b.t === 'focus') {
      const aan = b.aan === true;     // focus weg: niets uitzetten, alleen geen nieuwe invoer meer
      if (aan !== this.focus) { this.focus = aan; this.emit('hub', this.status().hub); }
    } else if (b.t === 'zet' || b.t === 'trig') {
      const p = PARAMS.find((x) => x.id === b.id);
      if (!p) return;
      if (b.t === 'trig' && p.soort === 'trigger') {
        const aan = b.aan === true;
        if (aan) this.ingedrukt.add(p.id); else this.ingedrukt.delete(p.id);
        this._invoke(p.action, aan);
      }
      if (b.t === 'zet' && p.soort !== 'trigger' && Number.isFinite(b.v)) {
        this._invoke(p.action, klem(b.v));
        this.gezet.set(p.id, this._read(p.action) ?? klem(b.v));   // niet terugkaatsen
      }
    } else if (b.t === 'fout') {
      if (/^vervangen/.test(String(b.reden))) this._zetVervangen(true);
      else this.emit('fout', new Error(`hub: ${b.reden}`));
    }
    // welkom, globaal, scene en alles wat nog komt: negeren (PROTOCOL §1, grondregel 5)
  }

  // ---- naar de hub -----------------------------------------------------------

  _staatWaarden() {
    const w = {};
    for (const p of PARAMS) if (p.soort !== 'trigger') { w[p.id] = klem(this._read(p.action) ?? p.standaard); this.gezet.set(p.id, w[p.id]); }
    return w;
  }

  /** Een hb als er al HB_MS niets naar de hub ging (elk bericht telt als hartslag). */
  _hartslag() {
    if (this.open && this.klok() - this.laatsteUit >= HB_MS) this._stuurHub({ t: 'hb' });
  }

  /** Wat VarveDJ zelf veranderde (APC, muis, auto-DJ) als `zet`, en de hartslag. */
  _tik() {
    if (!this.open) return;
    for (const p of PARAMS) {
      if (p.soort === 'trigger') continue;
      const v = this._read(p.action);
      if (v === null || Math.abs(v - (this.gezet.get(p.id) ?? -1)) < 1e-4) continue;
      this.gezet.set(p.id, v);
      this._stuurHub({ t: 'zet', id: p.id, v: klem(v) });
    }
    this._hartslag();
  }

  /** De uitgang van de nep-poort: na de wachtrij van MidiHub. De init-SysEx slikken we in. */
  _led(bytes) {
    const b = [...bytes];
    if (b[0] === 0xf0) { this.ingeslikt++; return; }
    if (!isLampje(b)) { this.geweigerd++; return; }
    if (!this.open) return;
    this.leds.push(b);
    this._beeld();
  }

  /** Eén bericht per beeld. Voorflank: zie BEELD_MS. */
  _beeld() {
    if (this.ledTimer !== null) return;
    const wacht = BEELD_MS - (this.klok() - this.beeldUit);
    this.ledTimer = this.timers.setTimeout(() => this._bundel(), Math.max(0, wacht));
  }

  _bundel() {
    this.ledTimer = null;
    if (!this.leds.length) return;
    const bytes = this.leds;
    this.leds = [];
    this._stuurHub({ t: 'led', bytes });
    this.ledsUit += bytes.length;
    this.beeldUit = this.klok();
  }
}
