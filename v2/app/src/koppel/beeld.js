// Herkomst: v1 youtube-mixer/src/koppel/beeld.js (spoor beeld, 6–13 okt). Wat er in v2 anders is staat
// hieronder bij "Wat er in v2 anders is"; de regels voor track, mix, macro's en herladen zijn die van v1.
import { Emitter } from '../kern/emitter.js';
import { maakBeeldZender } from './varve-beeld-zender.js';
import { NiveauVolger } from './niveau.js';

/**
 * De koppeling met de Stroommachine (Clay's beeldmachine op de pc): VarveDJ stuurt via de
 * Varve-relay (poort 7702) klok, kenmerken, track per crossfaderkant, mix en regie. Het protocol staat
 * in de Stroommachine-repo (koppel/PROTOCOL-dj.md); de zender (varve-beeld-zender.js) komt daar
 * vandaan, zoals hij is.
 *
 * Ontwerpregel: MacBook + APC is genoeg, de pc is er soms. Uit, zonder adres of zonder relay
 * verandert er in VarveDJ NIETS: geen WebSocket, geen timer, geen geluid, geen melding die terugkomt.
 * Herverbinden doet de zender zelf (1 → 10 s).
 *
 * Buiten de engine: dit LEEST de engine alleen (duck-typed) en schrijft er nooit in. De bus roept
 * zetWaarde()/druk()/zet() aan (koppel/acties.js): 0..1, een trigger alleen bij indrukken. De tel
 * komt van de maatklok op de audioklok; de tijd `t` in de berichten is performance.now(), want daarop
 * rekent de Stroommachine het klokverschil uit (ping/pong, de zender antwoordt zelf).
 *
 * Wat er in v2 anders is:
 *   - Er is ÉÉN maatklok (engine.klok) en geen maatgever-track. De tel die gaat is de tel zoals je
 *     hem HOORT: klok.tel(nu − vertraging + extra latentie). Klok stil (nog niet gestart, of de
 *     AudioContext staat stil) = speelt:false met de laatste tel; nog nooit een tel = niets.
 *   - Een track: engine.tracks[i] met { n, kant, speelt, geladen, nummer, grid, plek(t), snelheid(t),
 *     strip.lees('fader') }; de crossfader = engine.mixer.lees('xfader'). Het laden komt als
 *     engine-event 'laad' ({ n, stand: 'klaar', nummer }); daar staat ook de toonsoort in.
 *   - De master-analyse komt van buiten (`luisteraar`, een Luisteraar uit beeld/analyse op
 *     engine.mixer.analyser): koppel/ leest niets uit beeld/. Zonder luisteraar gaan alleen maat.*.
 *
 * Wat er gaat:
 *   klok       de doorlopende tel en het tempo van de maatklok zoals je hem hoort, met een
 *              instelbare extra latentie voor beamer of scherm: +80 ms = de tel 80 ms vóór, dus het
 *              beeld 80 ms vroeger.
 *   kenmerken  wat de zaal hoort (de master-analyse) en de tel. Null als er niets klinkt.
 *   track      per crossfaderkant het nummer dat die kant vertegenwoordigt (kiesKant), zodra dat
 *              een ander nummer wordt.
 *   mix        de crossfader en per kant { speelt, pos, rate } bij elke verandering (de zender
 *              begrenst zelf tot 20/s).
 *   poort      de macro's en de regie (de APC-pagina "Beeld", de bus).
 * Track en mix zijn TOESTAND, geen stroom: de relay gooit een bericht weg als de Stroommachine er
 * (nog) niet is, en een herladen Stroommachine weet niets meer. Daarom gaan ze pas als ze er
 * aantoonbaar is (een verse beeld-status of ping), en opnieuw als VarveDJ zelf opnieuw verbond of als
 * ze HERLADEN is: haar ping-teller begint per pagina bij 1 (09o-dj.js daar), dus een ping met een id
 * die niet hoger is dan de vorige = een nieuwe pagina. De zender antwoordt zelf op pings; we luisteren
 * mee op de socket (een eigen WebSocket-klasse rond die van de zender). Macro's die je zette gaan dan
 * ook opnieuw: VarveDJ is de bron van waarheid voor wat de APC deed. Hooguit eens per OPNIEUW_MS.
 * Klok, kenmerken en regie gaan altijd.
 *
 * Eén tabblad: alleen het tabblad met de APC (de Web Lock) zendt (`mag`, van buiten). Twee
 * tabbladen die allebei op elke ping antwoorden maken het klokverschil van de Stroommachine onzin.
 */

/** Het relay-adres: zo lang mag het zijn (na trimmen). */
export const ADRES_MAX = 200;
/** Extra latentie in ms, voor beamer of scherm. */
export const LATENTIE_MIN = -200;
export const LATENTIE_MAX = 500;
/** maat.klap: 1 in het eerste kwart van de tel, zoals de lampjes op de APC. */
export const KLAP_VENSTER = 0.25;
/** Zo vaak kijken of er een ander nummer op een kant staat of de mix veranderde (ms). */
export const TIK_MS = 100;
/** Zoveel seconden naast waar een spelende track zou moeten zijn = een sprong (seek, hotcue): mix opnieuw. */
export const SPRONG_S = 0.5;
/** Na zo lang zonder verbinding één melding (ms); daarna niets meer tot je het adres verandert. */
export const ONBEREIKBAAR_MS = 8000;
/** Een beeld-status of ping ouder dan dit (ms) = de Stroommachine is er niet (zoals haar DJ_FRIS van 3 s). */
export const BEELD_VERS_MS = 3000;
/** Herladen Stroommachine: track, mix en macro's opnieuw, maar hooguit zo vaak (ms); nooit verloren. */
export const OPNIEUW_MS = 10000;
/** Kenmerken: zo stil (0..1) telt als niets, en zo lang stil (ms) voor ze stoppen. */
export const STIL = 0.01;
export const STIL_MS = 1000;
/** Onder deze kanaalfader telt een track als "fader dicht" (−60 dB; zoals HOORBAAR in de engine). */
export const FADER_OPEN = 0.001;
/**
 * Poorten die de browser nooit opent (de "bad ports" van de Fetch-standaard): een WebSocket daarheen
 * mislukt altijd, en dan zou de zender eindeloos opnieuw proberen.
 */
export const SLECHTE_POORTEN = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514,
  515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045,
  4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

/** De acht macro's (waarde, 0..1) en zes regieknoppen (trigger) van de Stroommachine (src/09d-poorten.js daar). */
export const MACROS = Object.freeze(['macro.intensiteit', 'macro.snelheid', 'macro.helderheid', 'macro.feedback',
  'macro.tint', 'macro.dichtheid', 'macro.glitch', 'macro.balans']);
export const REGIE = Object.freeze(['regie!ontdek', 'regie!volgende', 'regie!vasthouden', 'regie!flits', 'regie!paniek', 'regie!vrij']);
/**
 * De neutrale stand van elke macro in de Stroommachine (09c-live.js en 09d-poorten.js daar). Ze meldt
 * haar standen niet terug: de ring van een knop begint hier.
 */
export const MACRO_STANDAARD = Object.freeze({
  'macro.intensiteit': 0.5, 'macro.snelheid': 0.375, 'macro.helderheid': 0.8, 'macro.feedback': 0.5,
  'macro.tint': 0.5, 'macro.dichtheid': 0.5, 'macro.glitch': 0, 'macro.balans': 0.5,
});

/**
 * De twee relay-adressen met één klik (de knopjes in het paneel): de relay op deze Mac (beeld op één
 * machine, v1 docs/BEELD.md §8) en die op de pc via Tailscale (§1). Elk gaat door controleerAdres.
 */
export const BEELD_ADRESSEN = Object.freeze([
  Object.freeze({ sleutel: 'lokaal', naam: 'deze Mac', adres: 'ws://127.0.0.1:7702/app' }),
  Object.freeze({ sleutel: 'pc', naam: 'pc', adres: 'ws://clayk:7702/app' }),
]);
/** Zo lang telt een tweede klik op hetzelfde adresknopje als "ja, wissel" (ms). */
export const WISSEL_BEVESTIG_MS = 3000;

/**
 * Het relay-adres controleren: alleen ws:// of wss://, getrimd, hooguit ADRES_MAX tekens, een host,
 * geen gebruikersnaam of wachtwoord, geen #, geen poort die de browser nooit opent. Leeg = "uit".
 * @returns { ok: true, adres } (genormaliseerd) | { ok: false, leeg?: true, reden }
 */
export function controleerAdres(invoer) {
  const s = typeof invoer === 'string' ? invoer.trim() : '';
  if (!s) return { ok: false, leeg: true, reden: 'geen adres' };
  if (s.length > ADRES_MAX) return { ok: false, reden: `langer dan ${ADRES_MAX} tekens` };
  if (!/^wss?:\/\//i.test(s)) return { ok: false, reden: 'alleen ws:// of wss://' };
  if (/\s/.test(s)) return { ok: false, reden: 'er staat een spatie in' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, reden: 'geen geldig adres' }; }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return { ok: false, reden: 'alleen ws:// of wss://' };
  if (!u.hostname) return { ok: false, reden: 'er staat geen host in' };
  if (u.username || u.password) return { ok: false, reden: 'geen gebruikersnaam of wachtwoord in het adres' };
  if (u.hash) return { ok: false, reden: 'geen # in het adres' };
  if (u.port && SLECHTE_POORTEN.has(Number(u.port))) return { ok: false, reden: `poort ${u.port} opent de browser nooit (kies bv. 7702)` };
  const adres = u.href;
  if (adres.length > ADRES_MAX) return { ok: false, reden: `langer dan ${ADRES_MAX} tekens` };
  return { ok: true, adres };
}

/**
 * Vraagt een klik op een adresknopje eerst een tweede klik? Alleen als de koppeling aan staat en
 * verbonden is met een ÁNDER adres: dan verliest de Stroommachine die nu meekijkt de klok. Midden in
 * een set is één misklik te duur (v1 review 2 beeld-een-machine, punt 6).
 */
export function wisselVraagtBevestiging(status, adres) {
  return !!(status && status.aan && status.verbonden && status.adres !== adres);
}

/** Extra latentie in hele ms, binnen LATENTIE_MIN … LATENTIE_MAX. Onzin wordt 0. */
export function klemLatentie(v) {
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(LATENTIE_MAX, Math.max(LATENTIE_MIN, n)));
}

/**
 * Een id die per nummer hetzelfde blijft: de Stroommachine onthoudt er een scène bij.
 *   demonummer (demo: true of id 'demo-…')   varve:demo-<naam>   (eerst: 'demo-wissel' is 11 tekens)
 *   YouTube (de library-id ÍS het videoId)   yt:<videoId>
 *   een andere site / een eigen bestand       <site>:<id>          (tiktok-123 → tiktok:123, lokaal-<hash> → lokaal:<hash>)
 *   iets anders met een id                    varve:<id>
 *   zonder id (een los bestand)               bestand:<titel>
 * @param nummer { id, titel, demo } (zoals op track.nummer of in het 'laad'-event)
 */
export function stabieleId(nummer = {}) {
  const id = nummer?.id;
  if (id != null && id !== '') {
    const n = String(id);
    if (nummer.demo === true || n.startsWith('demo-') || n === 'demo') return `varve:${n.startsWith('demo') ? n : `demo-${n}`}`;
    if (/^[\w-]{11}$/.test(n)) return `yt:${n}`;
    const m = /^([a-z0-9]+)-(.+)$/.exec(n);
    return m ? `${m[1]}:${m[2]}` : `varve:${n}`;
  }
  return `bestand:${String(nummer?.titel ?? '').slice(0, 180)}`;
}

/**
 * Welke track een crossfaderkant vertegenwoordigt. VarveDJ heeft acht tracks, het protocol twee
 * decks: deck A = kant A van de crossfader, deck B = kant B; thru hoort bij geen kant. Van de tracks
 * op die kant met een nummer: wie SPEELT (met een open kanaalfader voor wie met de fader dicht
 * voorbeluistert), en daarvan wie het laatst begon; speelt er geen, dan wie het laatst geladen of
 * gestart werd. Zo wisselt klaarzetten de scène niet, en neemt een track die je start en opendraait
 * hem over.
 * @param tracks [{ id, kant, geladen, speelt, open, laatst }]
 * @returns id of null
 */
export function kiesKant(tracks, kant) {
  const rang = (t) => (t.speelt ? (t.open === false ? 1 : 2) : 0);
  let beste = null;
  for (const t of tracks) {
    if (t.kant !== kant || !t.geladen) continue;
    if (!beste || rang(t) > rang(beste) || (rang(t) === rang(beste) && t.laatst > beste.laatst)) beste = t;
  }
  return beste ? beste.id : null;
}

/**
 * De zeven kenmerken uit de master-analyse (laag, midden, hoog, onset, rms) en de tel ({ beat } of
 * null). Wat er niet is, staat er niet in. Met `niveau` (NiveauVolger.stap) gaan laag, midden, hoog en
 * luid op de schaal van wat er nu klinkt in plaats van de vaste ijking.
 */
export function kenmerkenVan(mix, tel, niveau = null) {
  const w = {};
  if (mix) {
    w['mix.laag'] = niveau ? niveau.laag : mix.laag;
    w['mix.midden'] = niveau ? niveau.midden : mix.midden;
    w['mix.hoog'] = niveau ? niveau.hoog : mix.hoog;
    w['mix.klap'] = mix.onset;
    w['mix.luid'] = niveau ? niveau.luid : mix.rms;
  }
  if (tel && Number.isFinite(tel.beat)) {
    const fase = tel.beat - Math.floor(tel.beat);
    w['maat.tel'] = fase;
    w['maat.klap'] = fase < KLAP_VENSTER ? 1 : 0;
  }
  return w;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const standaardTimers = () => ({
  setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis),
  setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
});

export class BeeldKoppeling extends Emitter {
  /**
   * @param engine      alleen gelezen: klok, nu(), vertraging(), tracks, mixer.lees('xfader'), ctx.state, on('laad')
   * @param luisteraar  { lees(t) } op de master-analyser (een Luisteraar uit beeld/analyse), of null
   * @param maakZender  maakBeeldZender (de test geeft een nep)
   * @param timers, nu, WebSocketImpl  voor de zender en de eigen tik (de test geeft nep); nu = ms
   * @param mag         mag dit tabblad zenden: boolean of () => boolean (later: magZenden())
   */
  constructor({ engine, luisteraar = null, maakZender = maakBeeldZender, timers = standaardTimers(),
    nu = () => globalThis.performance.now(), WebSocketImpl = globalThis.WebSocket, mag = true } = {}) {
    super();
    Object.assign(this, { engine, luisteraar, maakZender, timers, nu, WebSocketImpl });
    this._mag = mag;
    this.vanzelf = false;                 // kwam de laatste start uit de bewaarde instellingen (niet van Clay zelf)?
    this.niveau = new NiveauVolger();
    this.instellingen = { aan: false, adres: '', latentie: 0 };
    this.zender = null;
    this.fout = null;                     // waarom hij niet loopt (ongeldig adres), of null
    this.tikker = null;
    this.onbereikbaarTimer = null;
    this.ooitVerbonden = false;
    this.wasVerbonden = false;
    this.laatsteKlok = null;              // { bpm, beat }: de laatste tel die we hoorden
    this.nummers = {};                    // n -> { id (stabiel), bron (id van het nummer), titel, bpm, key }
    this.laatst = {};                     // n -> ms van laden of starten
    this.speelde = {};                    // n -> speelde hij bij de vorige tik
    this.verstuurd = { A: null, B: null };
    this.vorigeMix = null;
    this.macros = { ...MACRO_STANDAARD };
    this.ingedrukt = new Set();
    this.zonderStatus = null;
    this.beeldObj = null;
    this.beeldAt = -Infinity;
    this.pingAt = -Infinity;
    this.pingId = null;
    this.moetOpnieuw = false;
    this.opnieuwAt = -Infinity;
    this.gezet = new Set();
    this.teSturen = new Set();
    this.klonkAt = -Infinity;
    // Het laden (alleen luisteren; ook als de zender uit staat, zodat een track die al klaarstond
    // meteen meegaat zodra de relay er is). Geen timer, geen verbinding.
    this._zonderLaad = typeof engine?.on === 'function'
      ? engine.on('laad', (e) => { if (e?.stand === 'klaar') this.naLaad(e.n, e.nummer); })
      : null;
  }

  /** Mag dit tabblad zenden? */
  get mag() { return !!(typeof this._mag === 'function' ? this._mag() : this._mag); }

  /** De grenzen en de keuzeknopjes, voor het scherm (dat koppel/ niet zelf importeert). */
  get grenzen() { return { adresMax: ADRES_MAX, latentieMin: LATENTIE_MIN, latentieMax: LATENTIE_MAX, wisselBevestigMs: WISSEL_BEVESTIG_MS }; }
  get adressen() { return BEELD_ADRESSEN; }
  klemLatentie(v) { return klemLatentie(v); }
  vraagtBevestiging(adres) { return wisselVraagtBevestiging(this.status(), adres); }

  // ---- instellingen en levensloop ------------------------------------------

  /**
   * Instellingen zetten: { aan, adres, latentie } (wat ontbreekt blijft). Een ongeldig adres wordt
   * geweigerd: de zender start dan niet (en een lopende stopt), en het antwoord zegt waarom.
   * @returns { ok: true } | { ok: false, reden }
   */
  zet(nieuw = {}, { vanzelf = false } = {}) {
    const i = { ...this.instellingen };
    if ('aan' in nieuw) i.aan = !!nieuw.aan;
    if ('latentie' in nieuw) i.latentie = klemLatentie(nieuw.latentie);
    let antwoord = { ok: true };
    if ('adres' in nieuw) {
      const c = controleerAdres(nieuw.adres);
      if (c.ok) i.adres = c.adres;
      else if (c.leeg) i.adres = '';
      else antwoord = { ok: false, reden: c.reden };
    }
    if (!antwoord.ok) {
      // Het oude adres blijft niet stilletjes lopen: wat je typte geldt niet, dus niets.
      this.instellingen = { ...i, adres: '' };
      this.fout = antwoord.reden;
      this._stop();
      this._meldStatus();
      return antwoord;
    }
    const herstart = i.adres !== this.instellingen.adres;
    this.instellingen = i;
    this.fout = null;
    const moet = i.aan && !!i.adres && this.mag;
    if (!moet) this._stop();
    else if (!this.zender || herstart) { this._stop(); this.vanzelf = vanzelf; this._start(); }
    this._meldStatus();
    return antwoord;
  }

  /**
   * Mag dit tabblad zenden (de Web Lock: ctl.status().tabblad === 'eerste')? Nee = de zender stopt;
   * ja = hij start weer als aan en adres dat zeggen. De instellingen blijven.
   */
  magZenden(mag) {
    const was = this.mag;
    this._mag = !!mag;
    if (was === this.mag) return;
    if (!this.mag) { this._stop(); this._meldStatus(); } else this.zet({}, { vanzelf: true });
  }

  get loopt() { return !!this.zender; }
  get verbonden() { return !!this.zender?.status.verbonden; }

  /**
   * { aan, adres, latentie, loopt, verbonden, fout, elders, beeld: { regime, scene, fps, volgt, bpm } | null,
   *   verstuurd, ontvangen }. `beeld` is null zonder verse beeld-status (lees hem af en toe opnieuw).
   */
  status() {
    const z = this.zender?.status;
    return {
      aan: this.instellingen.aan, adres: this.instellingen.adres, latentie: this.instellingen.latentie,
      loopt: !!this.zender, verbonden: !!z?.verbonden, fout: this.fout, elders: !this.mag,
      beeld: z?.verbonden && z.beeld && this.nu() - this.beeldAt < BEELD_VERS_MS ? { ...z.beeld } : null,
      verstuurd: z?.verstuurd ?? 0, ontvangen: z?.ontvangen ?? 0,
    };
  }

  /** De WebSocket-klasse voor de zender: dezelfde, maar we luisteren mee op wat er binnenkomt (pings). */
  _meeluisterWS() {
    const Basis = this.WebSocketImpl, k = this;
    if (typeof Basis !== 'function') return Basis;
    return class extends Basis {
      constructor(...a) {
        super(...a);
        if (typeof this.addEventListener === 'function') this.addEventListener('message', (e) => k.hoorBericht(e.data));
      }
    };
  }

  _start() {
    let z;
    try {
      z = this.maakZender({
        url: this.instellingen.adres, klok: () => this.klok(), kenmerken: () => this.kenmerken(),
        WebSocketImpl: this._meeluisterWS(), timers: this.timers, nu: this.nu,
      });
    } catch (err) {
      this.fout = err.message;
      return;
    }
    this.zender = z;
    this.ooitVerbonden = false;
    this.wasVerbonden = false;
    this.beeldObj = null; this.beeldAt = -Infinity; this.pingAt = -Infinity; this.pingId = null;
    this.moetOpnieuw = false;
    this._vergeetVerstuurd();
    this.zonderStatus = z.on('status', () => this._opStatus());
    z.start();
    this.tikker = this.timers.setInterval(() => this.tik(), TIK_MS);
    this.onbereikbaarTimer = this.timers.setTimeout(() => {
      this.onbereikbaarTimer = null;
      if (this.zender === z && !this.ooitVerbonden) {
        if (this.vanzelf) {
          this._melding(`beeld: geen relay op ${this.instellingen.adres} (staat de pc uit?). VarveDJ blijft het rustig proberen; `
            + 'zonder pc kun je de koppeling uitzetten in het tabblad Beeld.', 'info');
        } else {
          this._melding(`beeld: de relay op ${this.instellingen.adres} antwoordt niet — draait hij op de pc, en klopt het adres? `
            + 'VarveDJ probeert het elke 10 s opnieuw, zonder verdere meldingen.', 'fout');
        }
      }
    }, ONBEREIKBAAR_MS);
  }

  _stop() {
    if (this.tikker) { this.timers.clearInterval(this.tikker); this.tikker = null; }
    if (this.onbereikbaarTimer) { this.timers.clearTimeout(this.onbereikbaarTimer); this.onbereikbaarTimer = null; }
    if (this.zonderStatus) { this.zonderStatus(); this.zonderStatus = null; }
    if (this.zender) { try { this.zender.stop(); } catch (_) { /* weg is weg */ } this.zender = null; }
    this.wasVerbonden = false;
    this._vergeetVerstuurd();
  }

  /** Stoppen (de pagina gaat dicht); de instellingen blijven. */
  stop() { this._stop(); this._meldStatus(); }

  /** Helemaal weg: stoppen en niet meer naar het laden luisteren. */
  vernietig() { this._stop(); this._zonderLaad?.(); this._zonderLaad = null; }

  _vergeetVerstuurd() {
    this.verstuurd = { A: null, B: null };
    this.vorigeMix = null;
    this.teSturen = new Set(this.gezet);
  }

  /**
   * Een bericht van de relay (we luisteren mee, de zender handelt het af). Alleen pings tellen: haar
   * ping-teller begint per pagina bij 1, dus een id die niet hoger is dan de vorige = herladen.
   */
  hoorBericht(data) {
    if (typeof data !== 'string' || data.length > 16384 || !data.includes('"ping"')) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || m.type !== 'ping' || !Number.isFinite(Number(m.id))) return;
    const id = Number(m.id);
    if (this.pingId !== null && id <= this.pingId) this.moetOpnieuw = true;
    this.pingId = id;
    this.pingAt = this.nu();
  }

  /**
   * De zender meldt (her)verbinden, verbreken en beeld-status. Track en mix gaan NIET hier: de zender
   * meldt 'verbonden' vóór hij zijn manifest stuurt, en de relay wil dat als eerste bericht.
   */
  _opStatus() {
    const v = this.verbonden;
    const b = this.zender?.status.beeld ?? null;
    if (b && b !== this.beeldObj) { this.beeldObj = b; this.beeldAt = this.nu(); }
    if (v && !this.ooitVerbonden) {
      this.ooitVerbonden = true;
      this._melding(`beeld: verbonden met de relay (${this.instellingen.adres})`);
    }
    if (!v && this.wasVerbonden) { this._vergeetVerstuurd(); this.pingId = null; }
    this.wasVerbonden = v;
    this._meldStatus();
  }

  _meldStatus() { try { this.emit('status', this.status()); } catch (_) { /* een luisteraar die breekt mag de koppeling niet breken */ } }
  _melding(tekst, soort = 'info') { try { this.emit('melding', { tekst, soort }); } catch (_) { /* idem */ } }

  // ---- wat de zender vraagt --------------------------------------------------

  /** Audiokloktijd van wat je NU hoort, plus de extra latentie (s). */
  _hoorTijd() {
    const e = this.engine;
    return e.nu() - (e.vertraging?.() ?? 0) + this.instellingen.latentie / 1000;
  }

  /** Loopt de maatklok, en loopt de audioklok (een stilstaande context = stilstaand transport)? */
  _klokLoopt() {
    const k = this.engine.klok, st = this.engine.ctx?.state;
    return !!k?.loopt && (st == null || st === 'running');
  }

  /** De tel zoals je hem hoort ({ bpm, beat }), of null als de klok stilstaat. */
  _tel() {
    if (!this._klokLoopt()) return null;
    const t = this._hoorTijd(), k = this.engine.klok;
    const beat = k.tel(t), bpm = k.bpm(t);
    return Number.isFinite(beat) && bpm > 0 ? { beat, bpm } : null;
  }

  /** { bpm, beat, speelt } voor de zender, of null (nog nooit een tel gehoord). */
  klok() {
    const t = this._tel();
    if (t) {
      this.laatsteKlok = { bpm: t.bpm, beat: t.beat };
      return { bpm: t.bpm, beat: t.beat, speelt: true };
    }
    return this.laatsteKlok ? { ...this.laatsteKlok, speelt: false } : null;
  }

  /** Speelt er iets (een nummer, de sampler of een patroon)? */
  speeltIets() {
    const e = this.engine;
    return (e.tracks ?? []).some((t) => t.geladen && t.speelt) || !!e.sampler?.speelt || !!e.patronen?.speelt;
  }

  /**
   * De zeven kenmerken (0..1), of null als er niets KLINKT: niets speelt en de master al STIL_MS stil.
   * Zolang de master nog iets geeft (een staart van echo of galm, een instrument) gaan ze door, en na een
   * pauze zakken ze eerst naar ~0 voor ze stoppen. Zonder verbinding: null, en de analyser wordt niet gelezen.
   */
  kenmerken() {
    if (this.zender && !this.verbonden) return null;
    const t = this.engine.nu();
    const mix = this.luisteraar?.lees(t) ?? null;
    const klinkt = this.speeltIets() || !!(mix && Math.max(mix.laag, mix.midden, mix.hoog, mix.rms) > STIL);
    if (klinkt) this.klonkAt = this.nu();
    else if (this.nu() - this.klonkAt > STIL_MS) return null;
    return kenmerkenVan(mix, this._tel(), this.niveau.stap(t, mix));
  }

  // ---- tracks en mix ---------------------------------------------------------

  _track(n) { return this.engine.track?.(n) ?? this.engine.tracks?.[n - 1] ?? null; }

  /** Wat de Stroommachine van een nummer krijgt: { id, bron, titel, bpm, key }. */
  _info(t, nummer) {
    const g = t?.grid;
    let bpm = null;
    try { bpm = g ? g.bpmAt(t.cue ?? 0) : null; } catch (_) { bpm = null; }
    return {
      id: stabieleId(nummer), bron: nummer?.id ?? null, titel: String(nummer?.titel ?? ''),
      bpm: Number.isFinite(bpm) ? r2(bpm) : null, key: typeof nummer?.toon === 'string' ? nummer.toon.slice(0, 8) : '',
    };
  }

  /**
   * Een geslaagde laad (engine-event 'laad', stand 'klaar'): welk nummer er nu op deze track staat.
   * Het event draagt de toonsoort (track.nummer niet).
   */
  naLaad(n, nummer) {
    const t = this._track(n);
    if (!t || !nummer) return;
    this.nummers[n] = this._info(t, nummer);
    this.laatst[n] = this.nu();
  }

  /** De tracks zoals kiesKant ze wil zien; houdt bij wie er net begon of een ander nummer kreeg. */
  _tracks() {
    const nu = this.nu();
    return (this.engine.tracks ?? []).map((t) => {
      const n = t.n;
      const nummer = t.nummer ?? null;
      // Het nummer op de track is de waarheid; het 'laad'-event geeft alleen de toonsoort erbij.
      if (nummer && this.nummers[n]?.bron !== (nummer.id ?? null)) { this.nummers[n] = this._info(t, nummer); this.laatst[n] = nu; }
      if (!nummer) delete this.nummers[n];
      const speelt = !!nummer && !!t.speelt;
      if (speelt && !this.speelde[n]) this.laatst[n] = nu;
      this.speelde[n] = speelt;
      // Kanaalfader open (zonder de crossfader: die kiest de kant).
      const fader = typeof t.strip?.lees === 'function' ? t.strip.lees('fader') : 1;
      return { id: n, kant: t.kant ?? 'thru', geladen: !!nummer, speelt, open: !(fader <= FADER_OPEN), laatst: this.laatst[n] ?? 0 };
    });
  }

  /** { speelt, pos, rate } van een track (zoals je hem hoort), of null. */
  _deckStand(n) {
    if (n === null) return null;
    const t = this._track(n);
    if (!t) return null;
    const speelt = !!t.speelt;
    const tijd = speelt ? this.engine.nu() - (this.engine.vertraging?.() ?? 0) : this.engine.nu();
    // rate: hoe snel hij loopt (gekoppeld: de klok), stilstaand de stand van de pitchfader (zoals v1).
    const rate = speelt ? t.snelheid(tijd) : (Number.isFinite(t.pitchRate) ? t.pitchRate : 1);
    return { speelt, pos: r2(t.plek(tijd)), rate: r3(rate) };
  }

  /** Is de Stroommachine er (een verse beeld-status of ping)? Dan pas hebben track en mix zin. */
  get aanwezig() { return this.verbonden && this.nu() - Math.max(this.beeldAt, this.pingAt) < BEELD_VERS_MS; }

  /**
   * Eén tik (elke TIK_MS zolang de zender loopt): staat er op een kant een ander nummer, of veranderde
   * crossfader of transport, dan gaat dat naar de Stroommachine. Zonder Stroommachine: alleen bijhouden.
   */
  tik() {
    const tracks = this._tracks();
    if (!this.zender || !this.aanwezig) return;
    const nu = this.nu();
    if (this.moetOpnieuw && nu - this.opnieuwAt >= OPNIEUW_MS) {
      this.moetOpnieuw = false;
      this.opnieuwAt = nu;
      this._vergeetVerstuurd();
    }
    for (const p of this.teSturen) this.zender.poort(p, this.macros[p]);
    this.teSturen.clear();
    const kanten = { A: kiesKant(tracks, 'A'), B: kiesKant(tracks, 'B') };
    for (const kant of ['A', 'B']) {
      const info = kanten[kant] === null ? null : this.nummers[kanten[kant]];
      if (!info || this.verstuurd[kant] === info.id) continue;
      if (this.zender.track(kant, info)) this.verstuurd[kant] = info.id;
    }
    const a = this._deckStand(kanten.A), b = this._deckStand(kanten.B);
    const xf = this.engine.mixer?.lees?.('xfader');
    const xfader = r3(Number.isFinite(xf) ? xf : 0.5);
    const sleutel = JSON.stringify([xfader, kanten.A, a?.speelt, a?.rate, kanten.B, b?.speelt, b?.rate]);
    const v = this.vorigeMix;
    // Een sprong (seek, hotcue, lus terug) is ook een transportverandering.
    const gesprongen = (stand, vorig) => !!(stand && vorig !== null && vorig !== undefined && stand.speelt
      && Math.abs(stand.pos - (vorig + (nu - v.t) / 1000 * stand.rate)) > SPRONG_S);
    if (!v || v.sleutel !== sleutel || gesprongen(a, v.posA) || gesprongen(b, v.posB)) {
      this.zender.mix({ xfader, a, b });
    }
    this.vorigeMix = { sleutel, posA: a?.pos ?? null, posB: b?.pos ?? null, t: nu };
  }

  // ---- de macro's en de regie ---------------------------------------------------

  /**
   * Een macro (0..1) naar de Stroommachine; de stand blijft hier voor de ring. Alleen met verbinding
   * (anders kreeg de ring een stand die nooit aankwam). Is ze er even niet, dan gaat hij zodra ze er is.
   */
  zetWaarde(poort, waarde) {
    if (!MACROS.includes(poort) || !this.verbonden) return false;
    const v = Number.isFinite(waarde) ? Math.min(1, Math.max(0, waarde)) : 0;
    this.macros[poort] = v;
    this.gezet.add(poort);
    if (!this.aanwezig) { this.teSturen.add(poort); return false; }
    this.teSturen.delete(poort);
    return this.zender.poort(poort, v);
  }

  /** De stand van een macro: null zonder verbinding (er is dan niets te doen). */
  waarde(poort) { return this.verbonden && poort in this.macros ? this.macros[poort] : null; }

  /** Een regieknop: alleen bij indrukken gaat er iets naar de Stroommachine. */
  druk(poort, on) {
    if (!REGIE.includes(poort)) return false;
    if (!on) { this.ingedrukt.delete(poort); return false; }
    this.ingedrukt.add(poort);
    return this.verbonden ? this.zender.poort(poort) : false;
  }

  /** Het lampje van een regieknop: 1 ingedrukt, 0 bruikbaar, null zonder verbinding. */
  knopStand(poort) { return this.verbonden ? (this.ingedrukt.has(poort) ? 1 : 0) : null; }
}
