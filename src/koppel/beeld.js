import { Emitter } from '../lib/emitter.js';
import { maakBeeldZender } from './varve-beeld-zender.js';
import { engineTel } from '../analysis/maat.js';
import { Luisteraar } from '../analysis/luisteraar.js';
import { NiveauVolger } from './niveau.js';
import { uitgangsVertraging, hoorbaar } from '../engine/hoorbaar.js';

/**
 * Het spoor "beeld" (docs/BEELD.md): VARVE stuurt de Stroommachine, de
 * beeldmachine op de Omarchy-pc, via de Varve-relay (poort 7702 op de pc).
 * Het protocol staat in de Stroommachine-repo (koppel/PROTOCOL-dj.md); de
 * zender (varve-beeld-zender.js) komt daar vandaan, zoals hij is.
 *
 * Ontwerpregel: MacBook + APC is genoeg, de pc is er soms. Uit, zonder adres
 * of zonder relay verandert er in VARVE niets: geen geluid, geen knop, geen
 * melding die terugkomt. Herverbinden doet de zender zelf (1 → 10 s).
 *
 * Buiten de engine (regel 1): dit LEEST de engine alleen (duck-typed, zoals
 * maat.js) en verandert er niets aan. De bus roept zetWaarde()/druk() aan
 * (bindBeeld in actions.js): 0..1, en een trigger alleen bij indrukken
 * (regel 2). De tel komt uit de POSITIE van de maatgever, dus van de audioklok
 * (regel 3); de tijd `t` in de berichten is performance.now(), want daarop
 * rekent de Stroommachine het klokverschil uit (ping/pong, de zender
 * antwoordt zelf).
 *
 * Wat er gaat:
 *   klok       de doorlopende tel en het tempo van de maatgever zoals je hem
 *              hoort (engineTel uit maat.js), met een instelbare extra
 *              latentie voor beamer of scherm: +80 ms = de tel 80 ms vóór,
 *              dus het beeld 80 ms vroeger. Geen maatgever die je hoort =
 *              speelt:false met de laatste tel en bpm (de Stroommachine valt
 *              dan terug op haar eigen klok); nog nooit een = niets.
 *   kenmerken  wat de zaal hoort (de master-analyser, zoals de vormlagen) en
 *              de tel van de maatgever. Null als er niets speelt.
 *   track      per crossfaderkant het nummer dat die kant vertegenwoordigt
 *              (kiesKant), zodra dat een ander nummer wordt.
 *   mix        de crossfader en per kant { speelt, pos, rate } bij elke
 *              verandering (de zender begrenst zelf tot 20/s).
 *   poort      de APC-pagina "Beeld" (mapje device.beeld).
 * Track en mix zijn TOESTAND, geen stroom: de relay gooit een bericht weg als
 * de Stroommachine er (nog) niet is, en een herladen Stroommachine weet niets
 * meer. Daarom gaan ze pas als ze er aantoonbaar is (een verse beeld-status of
 * ping), en opnieuw als VARVE zelf opnieuw verbond of als ze HERLADEN is. Dat
 * laatste is exact te zien: haar ping-teller begint per pagina bij 1
 * (09o-dj.js daar), dus een ping met een id die niet hoger is dan de vorige =
 * een nieuwe pagina. De zender antwoordt zelf op pings; we luisteren mee op de
 * socket (een eigen WebSocket-klasse rond die van de zender). Macro's die je
 * zette gaan dan ook opnieuw: VARVE is de bron van waarheid voor wat de APC
 * deed. Klok, kenmerken en regie gaan altijd.
 *
 * Eén tabblad: alleen het tabblad met de APC (de Web Lock, of met ?hub= het
 * tabblad bij de hub) stuurt (magZenden). Twee tabbladen die allebei op elke
 * ping antwoorden maken het klokverschil van de Stroommachine onzin.
 */

/** Het relay-adres: zo lang mag het zijn (na trimmen). */
export const ADRES_MAX = 200;
/** Extra latentie in ms, voor beamer of scherm. */
export const LATENTIE_MIN = -200;
export const LATENTIE_MAX = 500;
/** maat.klap: 1 in het eerste kwart van de tel, zoals de lampjes op de APC (TEL_VENSTER in feedback.js). */
export const KLAP_VENSTER = 0.25;
/** Zo vaak kijken of er een ander nummer op een kant staat of de mix veranderde (ms). */
export const TIK_MS = 100;
/** Zoveel seconden naast waar een spelende track zou moeten zijn = een sprong (seek, hotcue): mix opnieuw. */
export const SPRONG_S = 0.5;
/** Na zo lang zonder verbinding één melding (ms); daarna niets meer tot je het adres verandert. */
export const ONBEREIKBAAR_MS = 8000;
/**
 * De Stroommachine stuurt elke seconde een beeld-status. Ouder dan dit (ms)
 * = niet meer tonen: dan is de relay er nog, maar de Stroommachine niet (zoals
 * haar eigen DJ_FRIS van 3 s).
 */
export const BEELD_VERS_MS = 3000;
/**
 * Is de Stroommachine herladen (haar ping-teller begon opnieuw), dan gaan track,
 * mix en macro's opnieuw, maar hooguit zo vaak (ms); een tweede keer binnen die
 * tijd wacht tot hij om is, hij gaat niet verloren. Een track die opnieuw komt
 * laat haar dezelfde scène opnieuw laden: twee Stroommachines tegelijk (twee
 * tellers door elkaar) zou anders elke ping een nieuwe scène geven.
 */
export const OPNIEUW_MS = 10000;
/** Kenmerken: zo stil (0..1) telt als niets, en zo lang stil (ms) voor ze stoppen. */
export const STIL = 0.01;
export const STIL_MS = 1000;
/**
 * Poorten die de browser nooit opent (de "bad ports" van de Fetch-standaard):
 * een WebSocket daarheen mislukt altijd, en dan zou de zender eindeloos
 * opnieuw proberen met de melding "antwoordt niet".
 */
export const SLECHTE_POORTEN = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514,
  515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045,
  4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

/** De acht macro's (value, 0..1) en zes regieknoppen (trigger) van de Stroommachine (src/09d-poorten.js daar). */
export const MACROS = ['macro.intensiteit', 'macro.snelheid', 'macro.helderheid', 'macro.feedback',
  'macro.tint', 'macro.dichtheid', 'macro.glitch', 'macro.balans'];
export const REGIE = ['regie!ontdek', 'regie!volgende', 'regie!vasthouden', 'regie!flits', 'regie!paniek', 'regie!vrij'];
/**
 * De neutrale stand van elke macro in de Stroommachine (09c-live.js en
 * 09d-poorten.js daar: helderheid 0,8, glitch 0, snelheid = tempo 1). De
 * Stroommachine meldt haar standen niet terug: de ring van een device knob
 * begint hier, en je eerste draai zet de macro op deze stand plus de draai.
 */
export const MACRO_STANDAARD = {
  'macro.intensiteit': 0.5, 'macro.snelheid': 0.375, 'macro.helderheid': 0.8, 'macro.feedback': 0.5,
  'macro.tint': 0.5, 'macro.dichtheid': 0.5, 'macro.glitch': 0, 'macro.balans': 0.5,
};

/**
 * Het relay-adres controleren. Alleen ws:// of wss://, getrimd, hooguit
 * ADRES_MAX tekens, een host, geen gebruikersnaam of wachtwoord erin. Leeg is
 * geen fout maar "uit".
 * @returns { ok: true, adres } (genormaliseerd: kleine letters in schema en host)
 *        | { ok: false, leeg?: true, reden }
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
 * De twee relay-adressen die je met één klik kiest (de knopjes in de BEELD-rij):
 * de relay op deze Mac (beeld op één machine: `zsh tools/beeld-lokaal.sh`,
 * docs/BEELD.md §8) en die op de Omarchy-pc via Tailscale (§1). De sleutels
 * liggen vast: het spoor *standen* kan ernaar verwijzen (`lokaal`, `pc`).
 * Elk adres gaat door controleerAdres zoals een getypt adres.
 */
export const BEELD_ADRESSEN = Object.freeze([
  Object.freeze({ sleutel: 'lokaal', naam: 'deze Mac', adres: 'ws://127.0.0.1:7702/app' }),
  Object.freeze({ sleutel: 'pc', naam: 'pc', adres: 'ws://clayk:7702/app' }),
]);

/** Zo lang telt een tweede klik op hetzelfde adresknopje als "ja, wissel" (ms). */
export const WISSEL_BEVESTIG_MS = 3000;

/**
 * Vraagt een klik op een adresknopje ("deze Mac" · "pc") eerst een tweede klik?
 * Alleen als beeld aan staat en verbonden is met een ÁNDER adres: dan verliest de
 * Stroommachine die nu meekijkt de klok en de kenmerken van VARVE (ze loopt door op
 * haar eigen klok: niet zwart, geen audio). Midden in een set is één misklik dan te
 * duur; typen plus Enter blijft wel meteen (dat is al een bewuste handeling). Uit,
 * zoekend of hetzelfde adres: meteen. Zoals elke destructieve knop: een tweede klik
 * binnen WISSEL_BEVESTIG_MS (review 2 beeld-een-machine, punt 6).
 * @param status  BeeldKoppeling.status() (aan, verbonden, adres)
 * @param adres   het adres van het knopje
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
 * Een id die per nummer hetzelfde blijft: de Stroommachine onthoudt er een
 * scène bij. Een YouTube-nummer `yt:<videoId>` (de library-id ÍS het
 * videoId), een andere site `<site>:<id>` (de library zet de extractor
 * ervoor: tiktok-123 → tiktok:123, lokaal-<hash> → lokaal:<hash>), de demo
 * `varve:demo-<zaad>` (de demo is uit zijn zaad terug te maken: op track 1
 * altijd dezelfde) en een los bestand `bestand:<naam>`.
 */
export function stabieleId({ bron, nummer, titel, demo } = {}) {
  if (nummer != null && nummer !== '') {
    const n = String(nummer);
    if (/^[\w-]{11}$/.test(n)) return `yt:${n}`;
    const m = /^([a-z0-9]+)-(.+)$/.exec(n);
    return m ? `${m[1]}:${m[2]}` : `varve:${n}`;
  }
  if (bron === 'demo') return `varve:demo-${Number.isInteger(demo?.seed) ? demo.seed : 0}`;
  return `bestand:${String(titel ?? '').slice(0, 180)}`;
}

/**
 * Welke track een crossfaderkant vertegenwoordigt. VARVE heeft acht tracks,
 * het protocol twee decks: deck A = kant A van de crossfader, deck B = kant B;
 * thru-tracks horen bij geen kant. Van de tracks op die kant met een nummer:
 * wie SPEELT, en daarvan wie het laatst begon; speelt er geen, dan wie het
 * laatst geladen of gestart werd. Van de spelende gaat wie met een open
 * kanaalfader speelt voor: een track die je met de fader dicht voorbeluistert
 * hoort de zaal niet. Zo wisselt een track die je klaarzet (laden of
 * voorbeluisteren terwijl een andere op dezelfde kant klinkt) de scène niet,
 * en neemt een track die je start en opendraait hem over.
 * @param tracks [{ id, kant, geladen, speelt, open, laatst }]  open = kanaalfader open,
 *               laatst = ms van laden of starten
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
 * De zeven kenmerken uit de master-analyse (features.js: laag, midden, hoog,
 * onset, rms) en de tel van de maatgever ({ beat } of null). Wat er niet is,
 * staat er niet in (de zender stuurt alleen echte getallen). Met `niveau`
 * (NiveauVolger.stap: laag, midden, hoog, luid op de schaal van wat er nu
 * klinkt, niveau.js) gaan die vier in plaats van de vaste ijking.
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
   * @param engine      alleen gelezen: deck(id), kant, xfader, ctx, maatgever/syncMaster (puls.js)
   * @param ids         de deck-id's (DECK_IDS)
   * @param luisteraar  { lees(t) } op de master-analyser; standaard een eigen Luisteraar
   * @param maakZender  maakBeeldZender (de test geeft een nep)
   * @param timers, nu, WebSocketImpl  voor de zender en de eigen tik (de test geeft nep)
   */
  constructor({ engine, ids, luisteraar = null, maakZender = maakBeeldZender, timers = standaardTimers(),
    nu = () => globalThis.performance.now(), WebSocketImpl = globalThis.WebSocket, mag = true } = {}) {
    super();
    Object.assign(this, { engine, ids, maakZender, timers, nu, WebSocketImpl });
    this.mag = !!mag;                     // mag dit tabblad zenden (magZenden)?
    this.vanzelf = false;                 // kwam de laatste start uit de bewaarde instellingen (niet van Clay zelf)?
    this.luisteraar = luisteraar ?? new Luisteraar({
      analyser: () => engine.master?.analyser ?? null, sampleRate: () => engine.ctx.sampleRate });
    this.niveau = new NiveauVolger();     // laag/midden/hoog/luid op de schaal van wat er nu klinkt (niveau.js)
    this.instellingen = { aan: false, adres: '', latentie: 0 };
    this.zender = null;
    this.fout = null;                     // waarom hij niet loopt (ongeldig adres), of null
    this.tikker = null;
    this.onbereikbaarTimer = null;
    this.ooitVerbonden = false;           // sinds de laatste start: voor de ene melding
    this.wasVerbonden = false;
    this.laatsteKlok = null;              // { bpm, beat }: de laatste tel die we hoorden
    this.nummers = {};                    // deckId -> { id, titel, bpm, key } (van naLaad)
    this.laatst = {};                     // deckId -> ms van laden of starten
    this.speelde = {};                    // deckId -> speelde hij bij de vorige tik
    this.verstuurd = { A: null, B: null };  // welk nummer de Stroommachine per kant kent (null = niets of onbekend)
    this.vorigeMix = null;                // { sleutel, posA, posB, t }
    this.macros = { ...MACRO_STANDAARD };
    this.ingedrukt = new Set();           // regieknoppen die nu ingedrukt zijn (voor het lampje)
    this.zonderStatus = null;             // afmelden bij de zender
    this.beeldObj = null;                 // de laatste beeld-status van de zender (een nieuw object per bericht)
    this.beeldAt = -Infinity;             // nu() toen die binnenkwam
    this.pingAt = -Infinity;              // nu() van de laatste ping van de Stroommachine
    this.pingId = null;                   // haar laatste ping-id sinds onze verbinding (null = nog geen)
    this.moetOpnieuw = false;             // ze is herladen: track, mix en macro's opnieuw (zodra OPNIEUW_MS om is)
    this.opnieuwAt = -Infinity;           // nu() toen dat voor het laatst gebeurde
    this.gezet = new Set();               // macro's die via VARVE gezet zijn (met verbinding)
    this.teSturen = new Set();            // macro's die nog naar de Stroommachine moeten
    this.klonkAt = -Infinity;             // nu() toen er voor het laatst iets klonk (kenmerken)
  }

  // ---- instellingen en levensloop ------------------------------------------

  /**
   * Instellingen zetten: { aan, adres, latentie } (wat ontbreekt blijft).
   * Een ongeldig adres wordt geweigerd: de zender start dan niet (en een
   * lopende stopt), en het antwoord zegt waarom.
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
   * Mag dit tabblad zenden? Alleen het tabblad met de APC (app.js:
   * statusVanMij). Nee = de zender stopt; ja = hij start weer als aan en
   * adres dat zeggen. De instellingen blijven staan.
   */
  magZenden(mag) {
    if (this.mag === !!mag) return;
    this.mag = !!mag;
    if (!this.mag) { this._stop(); this._meldStatus(); } else this.zet({}, { vanzelf: true });
  }

  /** Loopt de zender (aan, met een geldig adres)? */
  get loopt() { return !!this.zender; }

  /** Is er nu een verbinding met de relay? */
  get verbonden() { return !!this.zender?.status.verbonden; }

  /**
   * Voor het scherm en de Controlekamer: { aan, adres, latentie, loopt,
   * verbonden, fout, elders (een ander tabblad stuurt), beeld: { regime,
   * scene, fps, volgt, bpm } | null, verstuurd, ontvangen }. `beeld` is null zonder verse beeld-status (lees
   * hem dus af en toe opnieuw, niet alleen bij 'status').
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

  /**
   * De WebSocket-klasse voor de zender: dezelfde, maar we luisteren mee op
   * wat er binnenkomt (de pings van de Stroommachine, zie hoorBericht). De
   * zender zelf blijft ongewijzigd.
   */
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
    // Een nieuwe start weet niets van de vorige verbinding.
    this.beeldObj = null; this.beeldAt = -Infinity; this.pingAt = -Infinity; this.pingId = null;
    this.moetOpnieuw = false;
    this._vergeetVerstuurd();
    this.zonderStatus = z.on('status', () => this._opStatus());
    z.start();
    this.tikker = this.timers.setInterval(() => this.tik(), TIK_MS);
    this.onbereikbaarTimer = this.timers.setTimeout(() => {
      this.onbereikbaarTimer = null;
      if (this.zender === z && !this.ooitVerbonden) {
        // Uit de bewaarde instellingen (de pc staat uit, je speelt alleen): een
        // melding die vanzelf weggaat. Zelf aangezet of een adres getypt: rood.
        if (this.vanzelf) {
          this._melding(`beeld: geen relay op ${this.instellingen.adres} (staat de pc uit?). VARVE blijft het rustig proberen; `
            + 'zonder pc kun je beeld uitzetten in de BEELD-rij.', 'info');
        } else {
          this._melding(`beeld: de relay op ${this.instellingen.adres} antwoordt niet — draait hij op de pc, en klopt het adres? `
            + 'VARVE probeert het elke 10 s opnieuw, zonder verdere meldingen.', 'fout');
        }
      }
    }, ONBEREIKBAAR_MS);
  }

  _stop() {
    if (this.tikker) { this.timers.clearInterval(this.tikker); this.tikker = null; }
    if (this.onbereikbaarTimer) { this.timers.clearTimeout(this.onbereikbaarTimer); this.onbereikbaarTimer = null; }
    if (this.zonderStatus) { this.zonderStatus(); this.zonderStatus = null; }
    if (this.zender) { try { this.zender.stop(); } catch (_) {} this.zender = null; }
    this.wasVerbonden = false;
    this._vergeetVerstuurd();
  }

  /** Helemaal stoppen (de pagina gaat dicht); de instellingen blijven. */
  stop() { this._stop(); this._meldStatus(); }

  /** De Stroommachine weet (misschien) niets meer: track, mix en de gezette macro's opnieuw. */
  _vergeetVerstuurd() {
    this.verstuurd = { A: null, B: null };
    this.vorigeMix = null;
    this.teSturen = new Set(this.gezet);
  }

  /**
   * Een bericht van de relay (we luisteren mee, de zender handelt het af).
   * Alleen pings tellen hier: haar ping-teller begint per pagina bij 1, dus
   * een id die niet hoger is dan de vorige = de Stroommachine is herladen.
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
   * De zender meldt (her)verbinden, verbreken en beeld-status. Track en mix
   * gaan NIET hier: de zender meldt 'verbonden' vóór hij zijn manifest
   * stuurt, en de relay wil dat als eerste bericht. De volgende tik stuurt ze.
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

  _meldStatus() { try { this.emit('status', this.status()); } catch (_) {} }
  _melding(tekst, soort = 'info') { try { this.emit('melding', { tekst, soort }); } catch (_) {} }

  // ---- wat de zender vraagt --------------------------------------------------

  /** Hoeveel wat je hoort achterloopt op de audioklok, min de extra latentie (s). */
  vertraging() { return uitgangsVertraging(this.engine.ctx) - this.instellingen.latentie / 1000; }

  /** { bpm, beat, speelt } voor de zender, of null (nog nooit een tel gehoord). */
  klok() {
    const t = engineTel(this.engine, this.ids, this.vertraging());
    if (t) {
      this.laatsteKlok = { bpm: t.bpm, beat: t.beat };
      return { bpm: t.bpm, beat: t.beat, speelt: true };
    }
    return this.laatsteKlok ? { ...this.laatsteKlok, speelt: false } : null;
  }

  /** Speelt er iets (een track die loopt en niet op de maat wacht)? */
  speeltIets() {
    return this.ids.some((id) => { const d = this.engine.deck(id); return !!d.buffer && d.playing && !d.wacht; });
  }

  /**
   * De zeven kenmerken (0..1), of null als er niets KLINKT: geen track die
   * speelt en de master al STIL_MS stil. Zolang de master nog iets geeft (een
   * staart van echo of galm, de sampler, de klankschaal, een instrument) gaan
   * ze door, en na een pauze zakken ze eerst naar ~0 voor ze stoppen; anders
   * bleef de Stroommachine op de laatste luide waarde staan, want de klok
   * (speelt:false) houdt haar "vers". Zonder verbinding: null, en de analyser
   * wordt niet gelezen.
   */
  kenmerken() {
    if (this.zender && !this.verbonden) return null;
    const t = this.engine.ctx.currentTime;
    const mix = this.luisteraar.lees(t);
    const klinkt = this.speeltIets() || !!(mix && Math.max(mix.laag, mix.midden, mix.hoog, mix.rms) > STIL);
    if (klinkt) this.klonkAt = this.nu();
    else if (this.nu() - this.klonkAt > STIL_MS) return null;
    const tel = engineTel(this.engine, this.ids, this.vertraging());
    return kenmerkenVan(mix, tel, this.niveau.stap(t, mix));
  }

  // ---- tracks en mix ---------------------------------------------------------

  /**
   * Een geslaagde laad (laden.js, zoals het handelingenlog): welk nummer er
   * nu op deze track staat. Ook als de zender uit staat, zodat een track die
   * al klaarstond meteen mee kan zodra de relay er is.
   */
  naLaad({ deckId, bron, nummer, titel, demo } = {}) {
    const d = this.engine.deck(deckId);
    if (!d) return;
    const bpm = d.grid ? d.grid.bpmAt(d.position) : null;
    this.nummers[deckId] = {
      id: stabieleId({ bron, nummer, titel, demo }), titel: String(titel ?? d.title ?? ''),
      bpm: Number.isFinite(bpm) ? r2(bpm) : null, key: d.toonsoort?.camelot ?? '',
    };
    this.laatst[deckId] = this.nu();
  }

  /** De tracks zoals kiesKant ze wil zien; houdt bij wie er net begon. */
  _tracks() {
    const nu = this.nu();
    return this.ids.map((id) => {
      const d = this.engine.deck(id);
      const speelt = !!d.buffer && d.playing && !d.wacht;
      if (speelt && !this.speelde[id]) this.laatst[id] = nu;
      this.speelde[id] = speelt;
      // Kanaalfader open: zoals faderGain (−70 dB onder 0,001), zonder de crossfader (die kiest de kant).
      return { id, kant: this.engine.kant?.[id] ?? 'thru', geladen: !!d.buffer && !!this.nummers[id], speelt,
        open: (d.ui?.fader ?? 1) > 0.001, laatst: this.laatst[id] ?? 0 };
    });
  }

  /** { speelt, pos, rate } van een track, of null. */
  _deckStand(id) {
    if (id === null) return null;
    const d = this.engine.deck(id);
    const speelt = !!d.playing && !d.wacht;
    return { speelt, pos: r2(hoorbaar(d, uitgangsVertraging(this.engine.ctx))), rate: r3(d.remt ? d.snelheid : d.rate) };
  }

  /** Is de Stroommachine er (een verse beeld-status of ping)? Dan pas hebben track en mix zin. */
  get aanwezig() { return this.verbonden && this.nu() - Math.max(this.beeldAt, this.pingAt) < BEELD_VERS_MS; }

  /**
   * Eén tik (elke TIK_MS zolang de zender loopt): staat er op een kant een
   * ander nummer, of veranderde crossfader of transport, dan gaat dat naar de
   * Stroommachine. Zonder verbinding of zonder Stroommachine wordt alleen
   * bijgehouden.
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
      const n = kanten[kant] === null ? null : this.nummers[kanten[kant]];
      if (!n || this.verstuurd[kant] === n.id) continue;
      if (this.zender.track(kant, n)) this.verstuurd[kant] = n.id;
    }
    const a = this._deckStand(kanten.A), b = this._deckStand(kanten.B);
    const xfader = r3(this.engine.xfader ?? 0.5);
    const sleutel = JSON.stringify([xfader, kanten.A, a?.speelt, a?.rate, kanten.B, b?.speelt, b?.rate]);
    const v = this.vorigeMix;
    // Een sprong (seek, hotcue, loop terug) is ook een transportverandering:
    // een spelende track staat dan ver van waar hij na `dt` zou zijn.
    const gesprongen = (stand, vorig) => !!(stand && vorig && stand.speelt
      && Math.abs(stand.pos - (vorig + (nu - v.t) / 1000 * stand.rate)) > SPRONG_S);
    if (!v || v.sleutel !== sleutel || gesprongen(a, v.posA) || gesprongen(b, v.posB)) {
      this.zender.mix({ xfader, a, b });
    }
    this.vorigeMix = { sleutel, posA: a?.pos ?? null, posB: b?.pos ?? null, t: nu };
  }

  // ---- de APC-pagina "Beeld" -------------------------------------------------

  /**
   * Een macro (0..1) naar de Stroommachine; de stand blijft hier voor de ring.
   * Alleen met verbinding (anders kreeg de ring een stand die nooit aankwam).
   * Is de Stroommachine er even niet, dan gaat hij zodra ze er is.
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

  /** De stand van een macro voor read(): null zonder verbinding (er is dan niets te doen). */
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
