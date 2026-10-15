import { MidiHub, PER_TIK, TIK_MS as RIJ_MS } from './midi.js';
import { SectieLezer } from '../analysis/maat.js';
import { maatgever } from '../video/puls.js';
import { uitgangsVertraging } from '../engine/hoorbaar.js';

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
 *                                     of, als de hub `kan: ['scherm-bin']` meldde (AR15), één binair frame:
 *                                     0x01, lengte id, id (ASCII), nr, 2048 bytes (schermFrame)
 * Geen focusfilter: wie speelt beslist de hub, en een loslaten komt altijd bij
 * wie het indrukken kreeg. Valt de verbinding weg, dan gaan de poorten op
 * 'disconnected' (met een statechange): wie ze gekoppeld heeft laat los.
 *
 * DE SECTIE (PROTOCOL §18, sinds 6 okt): VARVE levert de sectie van het nummer
 * aan de globale laag (`levert: ['sectie']`), zodat de beeld-apps weten of je in
 * een intro, opbouw, drop, break of outro zit. De bron is een SectieLezer
 * (analysis/maat.js) op de maatgever zoals je hem HOORT (`engineSecties`):
 * dezelfde lezer als de vormbron en het accent van de video-puls, dus beeld en
 * hub zien dezelfde grens.
 *   een grens die je hoort -> één {t:'globaal', waarden:{'sectie.nieuw': true, 'sectie.energie', 'sectie.label'}},
 *                             meteen, met de energie van de sectie zelf; hooguit één per seconde
 *   verder                 -> energie (stap ≥ 0,01) en label alleen als ze anders zijn
 *   alles samen            -> hooguit 10 per seconde (schuivend venster); een nieuwe sectie gaat
 *                             altijd voor, gewone berichten wachten
 *   (her)verbinden         -> na hallo/manifest/staat de sectie van nu, ZONDER nieuw
 *   pauze (geen maatgever) -> de energie blijft een halve seconde staan (een cut in de mix,
 *                             HOUD in maat.js), glijdt dan naar 0; het label blijft staan
 * Wat telt als nieuwe sectie beslist de lezer, voor beeld en hub gelijk: niet
 * het rondgaan van een loop korter dan een maat en geen stutter (hetzelfde
 * sectiebegin binnen een maat), wel een sectie-loop (≥ 1 maat), elke ronde.
 * Lezen: elke SECTIE_MS, met een wekker op de volgende grens of op het moment
 * dat een sprong hoorbaar wordt (op de voorgrond een paar ms na het horen),
 * meteen als de deck zegt dat de maatgever sprong, stilviel of begon, en bij
 * elk bericht van de hub: in een verborgen, stil tabblad lopen timers 1×/s
 * (na 5 min 1×/min), maar de adem van de hub komt ~10×/s binnen. Een grens
 * uit een gat van meer dan 1 s (GAT in maat.js) telt niet, net als in beeld.
 * De tijd (audioklok − vertraging) loopt nooit terug, ook niet als de
 * vertraging groeit (een ander uitgangsapparaat). Een hub van vóór §18
 * negeert `levert` en de globaal (grondregel 5); een `fout` erover verandert
 * hier niets.
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
/**
 * LED's bundelen per beeld (setTimeout, geen rAF: die staat stil op de achtergrond).
 * Met een VOORFLANK (14 okt 2026): is er al BEELD_MS geen bundel weg, dan gaat
 * hij na de lopende taak (setTimeout 0: alles van dezelfde tik of druk samen),
 * anders op BEELD_MS na de vorige. Vroeger wachtte elk lampje 16 ms, ook als er
 * een seconde niets gebeurd was: de helft van de vertraging druk -> lampje via
 * de hub (tools/bench/feedback.mjs).
 */
export const BEELD_MS = 16;
const TIK_MS = 200;    // eigen wijzigingen terugmelden, en kijken of er een hartslag moet

/**
 * De sectie (PROTOCOL §18). Elke SECTIE_MS lezen, en een wekker vlak na de
 * volgende grens of de sprong. Op berichten van de hub (en de tik) hooguit
 * elke SECTIE_MIN_MS. Gewone berichten minstens GLOBAAL_MS uit elkaar, en
 * samen met de nieuwe secties hooguit GLOBAAL_PER_S per seconde. De energie
 * alleen bij een stap van minstens ENERGIE_STAP, of als hij stilvalt (het eind
 * van een glijden, 0).
 */
export const SECTIE_MS = 50;
const SECTIE_MIN_MS = 20;
export const GLOBAAL_MS = 100;
export const ENERGIE_STAP = 0.01;
/**
 * Hooguit zoveel globaal in een schuivend venster van een seconde, een nieuwe
 * sectie meegeteld (§18: hooguit 10×/s). Een nieuwe sectie gaat altijd meteen;
 * gewone berichten wijken: ze laten in het venster één plek over.
 */
export const GLOBAAL_PER_S = 10;
/** Vangnet: hooguit één nieuwe sectie per zoveel ms (de lezer laat korte loops en stutters al weg). */
export const NIEUW_MIN_MS = 1000;
/** Een label neemt de hub van 1 tot 32 tekens (§18); een ander gaat niet mee (de energie wel). */
const isLabel = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 32;
const afgerond = (e) => Math.round(e * 1000) / 1000;

/**
 * De sectiebron van de engine (alleen uitlezen, zoals de video-mixer): de
 * maatgever zoals je hem hoort (maatgever() in puls.js: dezelfde track als de
 * video-puls en de vormbron, null als je hem niet hoort), de uitgangsvertraging
 * en de audioklok (regel 3).
 */
export const engineSecties = (engine, ids) => ({
  deck: () => { const id = maatgever(engine, ids); return id ? engine.deck(id) : null; },
  vertraging: () => uitgangsVertraging(engine.ctx),
  tijd: () => engine.ctx.currentTime,
  // Een seintje bij elke verandering van een deck (sprong, play, pauze, maar ook elke fader): fn(deck).
  bij: (fn) => { const los = ids.map((id) => engine.deck(id).on('change', fn)); return () => { for (const f of los) f(); }; },
});

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
  lease: true, rings: 'host', speelt: Object.keys(SPEELPOORTEN), levert: ['sectie'],
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
/** Wat de hub in zijn welkom (of hallo) moet noemen voordat we schermen binair sturen (AR15). */
export const SCHERM_BIN = 'scherm-bin';
/** Soort van een binair frame: een scherm (docs/verslagen/2026-10-15/arch-opruimen.md §a). */
export const FRAME_SCHERM = 0x01;
/**
 * Een leeg binair schermframe voor `dev`: byte 0 = 0x01, byte 1 = de lengte L van de id, dan de id in
 * ASCII, dan het schermnummer, dan 2048 bytes. Eén per scherm, hergebruikt (de inhoud wordt overschreven).
 */
export function schermFrame(dev, nr) {
  const id = String(dev);
  const f = new Uint8Array(3 + id.length + SCHERM_BYTES);
  f[0] = FRAME_SCHERM; f[1] = id.length;
  for (let i = 0; i < id.length; i++) f[2 + i] = id.charCodeAt(i) & 0x7f;
  f[2 + id.length] = nr;
  return f;
}

export class HubMidi extends MidiHub {
  /**
   * @param url     ws://…/app van de hub
   * @param invoke  (actionId, waarde) — de action-bus
   * @param read    (actionId) -> 0..1 of null
   * @param WS      de WebSocket-klasse (de test geeft een nep)
   * @param klok    () -> ms (de test geeft een nep-klok)
   * @param secties null, of { deck, vertraging, tijd, bij? } (engineSecties): de sectie
   *                naar de hub (PROTOCOL §18). deck() = de maatgever die je hoort of
   *                null, vertraging() en tijd() in seconden (de audioklok), bij(fn) =
   *                fn(deck) bij een verandering van een deck (dan lezen we meteen als
   *                de maatgever sprong, stilviel of begon).
   */
  constructor({ url, invoke, read, WS = globalThis.WebSocket, klok = () => performance.now(), secties = null,
    inst = Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }) {
    super();
    Object.assign(this, { url, invoke, read, WS, klok, inst, secties });
    // De sectie (§18): één lezer, die ook zonder verbinding doorleest (geen gat bij terugkomen).
    this.lezer = secties ? new SectieLezer() : null;
    this.sectieTimer = null;
    this.sectieOp = Infinity;        // klok() waarop de sectie-timer afgaat
    this.sectieGelezen = -Infinity;  // klok() van de laatste lezing
    this.grenzenGemeld = 0;          // lezer.grenzen bij de vorige lezing
    this.sectieDeck = null;          // het deck van de vorige lezing
    this.stilTot = -Infinity;        // (audiotijd) tot hier hoor je een track die net begon nog niet
    this.hubEnergie = null;          // wat de hub op DEZE verbinding van ons kent (null = nog niets)
    this.hubLabel = null;
    this.laatsteLabel = null;        // het laatste label dat we stuurden, ook op een vorige verbinding
    this.sectieOoit = false;         // ooit een sectie gestuurd? (een hub die ons nog kent, heeft hem bewaard)
    this.globaalUit = -Infinity;     // klok() van de laatste globaal
    this.uitTijden = new Float64Array(GLOBAAL_PER_S - 1).fill(-Infinity);   // ring: klok() van de laatste 9 globaal
    this.uitI = 0;                   // de oudste in de ring (de volgende die overschreven wordt)
    this.nieuwUit = -Infinity;       // klok() van de laatste nieuwe sectie
    this.nieuwGestuurd = 0;
    this.sectieT = 0;                // de t van de laatste lezing: loopt nooit terug (de vertraging kan groeien)
    this.sectieWekker = false;       // is de lopende timer een wekker (grens, sprong)? dan altijd lezen
    this.sectieLos = null;           // het seintje van de deck weer loslaten
    this._sectieWek = () => {
      const wek = this.sectieWekker;
      this.sectieTimer = null; this.sectieOp = Infinity; this.sectieWekker = false;
      this._sectie(wek ? 'wek' : 'tik');
    };
    this._deckSein = (d) => { if (this.lezer.veranderd(d, this.secties.tijd())) this._sectie('sprong'); };
    this.ws = null;
    this.stap = 0;               // index in WACHT_MS
    this.focus = false;          // heeft VARVE de APC? (de hub zegt het met {t:'focus'})
    this.vervangen = false;      // een nieuwer VARVE-tabblad heeft de hub (4001)
    this.gezet = new Map();      // param-id -> laatste waarde die de hub van ons kent
    this.ingedrukt = new Set();  // triggers die de hub indrukte en nog niet losliet
    this.leds = [];              // LED-berichten van dit beeld
    this.ledTimer = null;
    this.beeldUit = -Infinity;   // klok() van de laatste bundel
    this.speelT = new Float64Array(PER_TIK).fill(-Infinity);   // schuivend venster van de speel-wachtrij (zoals MidiHub)
    this.speelI = 0;
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
    this.uitRij = [];            // naar de speelapparaten: { dev, bytes } of { dev, nr, frame }
    this.kan = new Set();        // wat de hub op deze verbinding zei te kunnen (welkom/hallo `kan`, AR15)
    this.frames = new Map();     // `${dev}:${nr}` -> het hergebruikte schermframe (schermFrame)
    this.schermenBin = 0;
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
    if (this.lezer) {
      this._sectie('open');   // de eerste lezing, en dan elke SECTIE_MS (of eerder: de wekker)
      this.sectieLos = this.secties.bij?.(this._deckSein) ?? null;
    }
    this._verbind();
    return true;
  }

  stop() {
    this.gestopt = true;
    clearInterval(this.tikker); clearTimeout(this.herverbind); clearTimeout(this.ledTimer);
    clearTimeout(this.openTimer); clearTimeout(this.stabielTimer); clearTimeout(this.uitTikker);
    clearTimeout(this.sectieTimer);
    this.sectieLos?.(); this.sectieLos = null;
    this.ws?.close();
  }

  status() {
    const speelt = {};
    for (const s of Object.values(this.speel)) {
      speelt[s.dev] = { naam: s.in.name, verbonden: s.in.state === 'connected', rx: s.rx,
        ...(s.uit ? { leds: s.leds, schermen: s.schermen, geweigerd: s.geweigerd } : {}) };
      if (s.uit) speelt[s.dev].binair = this.kan.has(SCHERM_BIN);
    }
    const l = this.lezer;
    return { ...super.status(), hub: { url: this.url, verbonden: this.poortIn.state === 'connected', focus: this.focus,
      vervangen: this.vervangen, ingeslikt: this.ingeslikt, speelt,
      sectie: l ? { label: l.label, energie: afgerond(l.energie), nieuw: this.nieuwGestuurd } : null } };
  }

  // ---- verbinding ----------------------------------------------------------

  get open() { return this.ws?.readyState === 1; }
  _stuur(b) {
    if (!this.open) return;
    this.ws.send(JSON.stringify(b));
    this.laatsteUit = this.klok();
  }

  /** Een binair bericht (AR15). WebSocket.send kopieert de bytes, dus het frame mag daarna hergebruikt worden. */
  _stuurBin(bytes) {
    if (!this.open) return;
    this.ws.send(bytes);
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
      this.kan = new Set();          // een andere (oudere) hub: pas binair als deze het zegt
      this._stuur({ t: 'hallo', app: APP, inst: this.inst, v: 1 });
      this._stuur({ t: 'manifest', manifest: MANIFEST });
      this._stuur({ t: 'staat', waarden: this._waarden() });
      // §18: wat de hub van ons kent weten we niet (hij kan herstart zijn): de sectie van nu, zonder nieuw.
      this.hubEnergie = null; this.hubLabel = null; this.globaalUit = -Infinity;
      this._sectie('open');
      this._poorten('connected');   // -> MidiHub 'output' -> feedback.init(): alle LED's opnieuw
      // De wachttijd pas terug naar 0,5 s als de hub ons ook HOUDT: een hub die
      // aanneemt en meteen weer sluit, laat ons anders elke 0,5 s opnieuw proberen.
      this.stabielTimer = setTimeout(() => {
        if (this.ws !== ws || !this.open) return;
        this.stap = 0;
        this._zetVervangen(false);
      }, STABIEL_MS);
    };
    // Elk bericht kijkt ook of er een hb moet, en leest de sectie: WebSocket-events worden in een verborgen tabblad niet geknepen.
    ws.onmessage = (e) => { if (this.ws !== ws) return; this._bericht(e.data); this._hartslag(); this._sectie('bericht'); };
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
    } else if ((b.t === 'welkom' || b.t === 'hallo') && Array.isArray(b.kan)) {
      this.kan = new Set(b.kan.filter((x) => typeof x === 'string'));
    } else if (b.t === 'fout') {
      console.warn('[hub]', b.reden);
      if (/^vervangen/.test(String(b.reden))) this._zetVervangen(true);
    }
    // globaal, scene en alles wat nog komt: negeren
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

  // ---- de sectie (PROTOCOL §18) ----------------------------------------------

  /**
   * De sectie lezen en zo nodig naar de hub. `bron`: 'tik' (de timer) of
   * 'bericht' (iets van de hub): overslaan als we minder dan SECTIE_MIN_MS
   * geleden lazen (een stortvloed aan berichten of faders kost zo hooguit ~50
   * lezingen per seconde). Altijd: 'wek' (de wekker op een grens of een sprong),
   * 'sprong' (de deck zegt dat de maatgever sprong, stilviel of begon) en 'open'
   * (net verbonden: een grens van nu gaat dan zonder nieuw mee, zoals alles na
   * herverbinden). Geen afval behalve het bericht zelf (de lezer maakt niets).
   */
  _sectie(bron) {
    const l = this.lezer;
    if (!l || this.gestopt) return;
    const nu = this.klok();
    if ((bron === 'tik' || bron === 'bericht') && nu - this.sectieGelezen < SECTIE_MIN_MS) {
      if (bron === 'tik') this._planSectie(nu);
      return;
    }
    this.sectieGelezen = nu;
    const V = this.secties.vertraging();
    // t loopt nooit terug: wordt de vertraging groter (een ander uitgangsapparaat, de limiter), dan blijft
    // t staan tot hij weer verder is. De lezer zou een stap terug anders als een nieuwe klok kunnen zien.
    const t = Math.max(this.sectieT, this.secties.tijd() - V);
    this.sectieT = t;
    l.stap(t, this.secties.deck(), V);
    // Een track die net maatgever werd (play, een andere track, fader open) hoor je pas na de vertraging;
    // tot dan ligt positie min vertraging vóór zijn startpunt (een cue op de drop: nog even "opbouw"), een
    // plek die je nooit hoort. Daarover zeggen we de hub niets; een grens die de lezer telt, gaat wel.
    if (l.deck !== this.sectieDeck) { if (l.deck !== null) this.stilTot = t + V; this.sectieDeck = l.deck; }
    // Elke grens één keer: ook een grens zonder verbinding is daarna "gemeld" (te laat is erger dan niet).
    // `>`: begint de lezer ooit opnieuw (teller 0), dan is dat geen nieuwe sectie.
    const nieuw = l.grenzen > this.grenzenGemeld && bron !== 'open';
    this.grenzenGemeld = l.grenzen;
    if (this.open) this._sectieNaarHub(nu, nieuw, t < this.stilTot);
    this._planSectie(nu);
  }

  /**
   * Wat de hub van de sectie moet weten. Een nieuwe sectie gaat ALTIJD meteen
   * (hooguit één per NIEUW_MIN_MS), met de energie van de sectie zelf (niet die
   * van het glijden): de ontvanger heeft klap, energie en label tegelijk. De
   * rest bij verandering, minstens GLOBAAL_MS na de vorige globaal en zolang
   * er in de laatste seconde nog een plek over blijft voor een nieuwe sectie.
   */
  _sectieNaarHub(nu, nieuw, nogStil) {
    const l = this.lezer;
    const doel = afgerond(l.energieDoel);
    const label = l.sectie >= 0 && isLabel(l.label) ? l.label : null;
    if (nieuw && nu - this.nieuwUit >= NIEUW_MIN_MS) {
      this._globaal(nu, label ? { 'sectie.nieuw': true, 'sectie.energie': doel, 'sectie.label': label } : { 'sectie.nieuw': true, 'sectie.energie': doel }, doel, label);
      this.nieuwUit = nu;
      this.nieuwGestuurd++;
      return;
    }
    if (nogStil) return;
    const eerste = this.hubEnergie === null;
    // Nog nooit een sectie en er speelt er geen: de hub weet niets, en dat klopt (§18: dan ontbreken ze).
    if (eerste && l.sectie < 0 && !this.sectieOoit) return;
    // Na (her)verbinden: ook in een pauze de energie (0) en het laatste label, want een
    // hub die ons nog kende, toonde anders wat hij het laatst van ons had.
    const metLabel = eerste ? label ?? this.laatsteLabel : label !== null && label !== this.hubLabel ? label : null;
    // Heeft de hub het doel al (een nieuwe sectie draagt het doel), dan niet van onderen opglijden.
    const e = !eerste && doel === this.hubEnergie ? doel : afgerond(l.energie);
    const verschil = eerste ? 1 : Math.abs(e - this.hubEnergie);
    const anders = verschil > 0 && (verschil >= ENERGIE_STAP - 1e-9 || e === 0 || !l.glijd);
    if (!metLabel && !anders) return;
    if (!eerste && nu - this.globaalUit < GLOBAAL_MS) return;            // straks, bij een volgende lezing
    if (nu - this.uitTijden[this.uitI] < 1000) return;                     // het venster is vol (op de plek voor een nieuwe na)
    this._globaal(nu, metLabel ? { 'sectie.energie': e, 'sectie.label': metLabel } : { 'sectie.energie': e }, e, metLabel);
  }

  _globaal(nu, waarden, e, label) {
    this._stuur({ t: 'globaal', waarden });
    this.globaalUit = nu;
    this.uitTijden[this.uitI] = nu;
    this.uitI = (this.uitI + 1) % this.uitTijden.length;
    this.hubEnergie = e;
    if (label) { this.hubLabel = label; this.laatsteLabel = label; }
    this.sectieOoit = true;
  }

  /**
   * De volgende lezing: SECTIE_MS na de vorige, of vlak nadat je de volgende
   * grens (of een sprong) hoort als dat eerder is: dan een wekker, die altijd leest.
   */
  _planSectie(nu) {
    const tot = this._totGrens() * 1000;                                  // vanaf de laatste lezing
    const wek = tot < SECTIE_MS;
    const op = Math.max(nu + 1, this.sectieGelezen + (wek ? Math.max(2, Math.ceil(tot) + 1) : SECTIE_MS));
    if (this.sectieTimer !== null && this.sectieOp <= op && (this.sectieWekker || !wek)) return;
    clearTimeout(this.sectieTimer);
    this.sectieOp = op;
    this.sectieWekker = wek;
    this.sectieTimer = setTimeout(this._sectieWek, op - nu);
  }

  /**
   * Seconden (kloktijd, vanaf de laatste lezing) tot je de volgende grens van de
   * maatgever hoort, of een sprong die nog moet klinken; anders Infinity. Gaat er
   * een loop vóór die grens rond, dan komt de wekker voor niets: één lezing extra.
   */
  _totGrens() {
    const l = this.lezer, d = l.deck, st = l.kaart?.stukken, k = l.sectie + 1;
    if (l.sprongWacht) { const s = l.sprongOp - this.sectieT; return s > 0 ? s : 0; }
    if (!d || !d.playing || d.wacht || !st || k < 1 || k >= st.length || !(l.hoor === l.hoor)) return Infinity;
    const r = d.remt ? d.snelheid : d.rate;
    return r > 0 ? (st[k].van - l.hoor) / r : Infinity;
  }

  _led(bytes) {
    const b = [...bytes];
    if (b[0] === 0xf0) { this.ingeslikt++; return; }   // init-SysEx: de hub zet de modus
    this.leds.push(b);
    this._beeld();
  }

  /** Eén bericht per beeld per apparaat; de APC zoals altijd zonder `dev`. Voorflank: zie BEELD_MS. */
  _beeld() {
    if (this.ledTimer !== null) return;
    const wacht = BEELD_MS - (this.klok() - this.beeldUit);
    // Voorflank: een timer van 0 (na de lopende taak). Een microtaak is gemeten en gaf in Chrome niets
    // meetbaars extra (druk -> lampje p50 6–8 ms tegen 5–9 ms, onder de ruis), dus de eenvoudigste.
    this.ledTimer = setTimeout(() => this._bundel(), Math.max(0, wacht));
  }

  _bundel() {
    this.ledTimer = null;
    let iets = false;
    if (this.leds.length) { this._stuur({ t: 'led', bytes: this.leds }); iets = true; }
    this.leds = [];
    for (const s of Object.values(this.speel)) {
      if (s.bundel?.length) { this._stuur({ t: 'led', dev: s.dev, bytes: s.bundel }); iets = true; }
      s.bundel = [];
    }
    if (iets) this.beeldUit = this.klok();
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
    // De bytes meteen in het frame van dit scherm (een nieuwer beeld overschrijft een ouder dat nog in de rij staat);
    // base64 of binair beslist pas het versturen, dan telt wat de hub NU kan.
    const sleutel = `${dev}:${nr}`;
    let frame = this.frames.get(sleutel);
    if (!frame) { frame = schermFrame(dev, nr); this.frames.set(sleutel, frame); }
    frame.set(data, frame.length - SCHERM_BYTES);
    const item = { dev, nr, frame };
    const i = this.uitRij.findIndex((x) => x.dev === dev && x.nr === nr);
    if (i >= 0) this.uitRij[i] = item; else this._rij(item);
    return true;
  }

  /**
   * De wachtrij naar de speelapparaten, zoals die van de MidiHub voor de APC:
   * hooguit PER_TIK berichten in elk schuivend venster van RIJ_MS (CLAUDE.md:
   * alles wat naar buiten gaat). Een lampje gaat meteen als er plaats is en niets wacht.
   * Lampjes gaan daarna per beeld gebundeld; een scherm gaat meteen.
   */
  _rij(item) {
    // Een lampje meteen als er plaats is; een scherm altijd via de rij (een nieuwer beeld vervangt het daar).
    if (item.bytes && !this.uitRij.length && this._speelWacht() <= 0) { this._speelUitRij(item); return; }
    this.uitRij.push(item);
    if (this.uitTikker !== null) return;
    const tik = () => {
      while (this.uitRij.length && this._speelWacht() <= 0) this._speelUitRij(this.uitRij.shift());
      this.uitTikker = this.uitRij.length ? setTimeout(tik, Math.max(0, this._speelWacht())) : null;
    };
    this.uitTikker = setTimeout(tik, Math.max(0, this._speelWacht()));
  }

  _speelWacht() { return this.speelT[this.speelI] + RIJ_MS - this.klok(); }

  _speelUitRij(x) {
    this.speelT[this.speelI] = this.klok();
    this.speelI = (this.speelI + 1) % PER_TIK;
    const s = this.speel[x.dev];
    if (x.bytes) { (s.bundel ??= []).push(x.bytes); s.leds++; this._beeld(); }
    else if (this.kan.has(SCHERM_BIN)) { this._stuurBin(x.frame); s.schermen++; this.schermenBin++; }
    else { this._stuur({ t: 'scherm', dev: x.dev, nr: x.nr, data: base64(x.frame.subarray(x.frame.length - SCHERM_BYTES)) }); s.schermen++; }
  }
}
