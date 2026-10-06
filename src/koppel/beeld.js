import { Emitter } from '../lib/emitter.js';
import { maakBeeldZender } from './varve-beeld-zender.js';
import { engineTel } from '../analysis/maat.js';
import { Luisteraar } from '../analysis/luisteraar.js';
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
 * meer. Daarom gaan ze pas als ze er aantoonbaar is (een verse beeld-status,
 * die stuurt ze elke seconde), en opnieuw als ze na een stilte terugkomt of
 * VARVE zelf opnieuw verbond. Klok, kenmerken en poorten gaan altijd.
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
 * Komt de beeld-status na een stilte (> BEELD_VERS_MS) terug, dan is de
 * Stroommachine (weer) open en gaan track en mix opnieuw, maar hooguit zo vaak
 * (ms): een track die opnieuw komt laat haar dezelfde scène opnieuw laden, en
 * kost dat meer dan 3 s (shaders compileren op een trage machine), dan zou dat
 * anders een lus worden.
 */
export const OPNIEUW_MS = 10000;

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
  const adres = u.href;
  if (adres.length > ADRES_MAX) return { ok: false, reden: `langer dan ${ADRES_MAX} tekens` };
  return { ok: true, adres };
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
 * laatst geladen of gestart werd. Zo wisselt een track die je klaarzet
 * (laden terwijl een andere op dezelfde kant speelt) de scène niet, en neemt
 * een track die je start hem over.
 * @param tracks [{ id, kant, geladen, speelt, laatst }]  laatst = ms van laden of starten
 * @returns id of null
 */
export function kiesKant(tracks, kant) {
  let beste = null;
  for (const t of tracks) {
    if (t.kant !== kant || !t.geladen) continue;
    if (!beste || (t.speelt && !beste.speelt) || (t.speelt === beste.speelt && t.laatst > beste.laatst)) beste = t;
  }
  return beste ? beste.id : null;
}

/**
 * De zeven kenmerken uit de master-analyse (features.js: laag, midden, hoog,
 * onset, rms) en de tel van de maatgever ({ beat } of null). Wat er niet is,
 * staat er niet in (de zender stuurt alleen echte getallen).
 */
export function kenmerkenVan(mix, tel) {
  const w = {};
  if (mix) {
    w['mix.laag'] = mix.laag;
    w['mix.midden'] = mix.midden;
    w['mix.hoog'] = mix.hoog;
    w['mix.klap'] = mix.onset;
    w['mix.luid'] = mix.rms;
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
    nu = () => globalThis.performance.now(), WebSocketImpl = globalThis.WebSocket } = {}) {
    super();
    Object.assign(this, { engine, ids, maakZender, timers, nu, WebSocketImpl });
    this.luisteraar = luisteraar ?? new Luisteraar({
      analyser: () => engine.master?.analyser ?? null, sampleRate: () => engine.ctx.sampleRate });
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
    this.opnieuwAt = -Infinity;           // nu() toen track en mix voor het laatst opnieuw moesten
  }

  // ---- instellingen en levensloop ------------------------------------------

  /**
   * Instellingen zetten: { aan, adres, latentie } (wat ontbreekt blijft).
   * Een ongeldig adres wordt geweigerd: de zender start dan niet (en een
   * lopende stopt), en het antwoord zegt waarom.
   * @returns { ok: true } | { ok: false, reden }
   */
  zet(nieuw = {}) {
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
    const moet = i.aan && !!i.adres;
    if (!moet) this._stop();
    else if (!this.zender || herstart) { this._stop(); this._start(); }
    this._meldStatus();
    return antwoord;
  }

  /** Loopt de zender (aan, met een geldig adres)? */
  get loopt() { return !!this.zender; }

  /** Is er nu een verbinding met de relay? */
  get verbonden() { return !!this.zender?.status.verbonden; }

  /**
   * Voor het scherm en de Controlekamer: { aan, adres, latentie, loopt,
   * verbonden, fout, beeld: { regime, scene, fps, volgt, bpm } | null,
   * verstuurd, ontvangen }. `beeld` is null zonder verse beeld-status (lees
   * hem dus af en toe opnieuw, niet alleen bij 'status').
   */
  status() {
    const z = this.zender?.status;
    return {
      aan: this.instellingen.aan, adres: this.instellingen.adres, latentie: this.instellingen.latentie,
      loopt: !!this.zender, verbonden: !!z?.verbonden, fout: this.fout,
      beeld: z?.verbonden && z.beeld && this.nu() - this.beeldAt < BEELD_VERS_MS ? { ...z.beeld } : null,
      verstuurd: z?.verstuurd ?? 0, ontvangen: z?.ontvangen ?? 0,
    };
  }

  _start() {
    let z;
    try {
      z = this.maakZender({
        url: this.instellingen.adres, klok: () => this.klok(), kenmerken: () => this.kenmerken(),
        WebSocketImpl: this.WebSocketImpl, timers: this.timers, nu: this.nu,
      });
    } catch (err) {
      this.fout = err.message;
      return;
    }
    this.zender = z;
    this.ooitVerbonden = false;
    this.wasVerbonden = false;
    this._vergeetVerstuurd();
    this.zonderStatus = z.on('status', () => this._opStatus());
    z.start();
    this.tikker = this.timers.setInterval(() => this.tik(), TIK_MS);
    this.onbereikbaarTimer = this.timers.setTimeout(() => {
      this.onbereikbaarTimer = null;
      if (this.zender === z && !this.ooitVerbonden) {
        this._melding(`beeld: de relay op ${this.instellingen.adres} antwoordt niet — draait hij op de pc, en klopt het adres? `
          + 'VARVE probeert het elke 10 s opnieuw, zonder verdere meldingen.', 'fout');
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

  _vergeetVerstuurd() { this.verstuurd = { A: null, B: null }; this.vorigeMix = null; }

  /**
   * De zender meldt (her)verbinden, verbreken en beeld-status. Track en mix
   * gaan NIET hier: de zender meldt 'verbonden' vóór hij zijn manifest
   * stuurt, en de relay wil dat als eerste bericht. De volgende tik stuurt ze.
   */
  _opStatus() {
    const v = this.verbonden;
    const b = this.zender?.status.beeld ?? null;
    if (b && b !== this.beeldObj) {
      // De eerste beeld-status, of de eerste na een stilte: de Stroommachine is
      // (weer) open, misschien herladen. Dan weet ze onze tracks niet meer.
      const terug = this.nu() - this.beeldAt > BEELD_VERS_MS;
      this.beeldObj = b;
      this.beeldAt = this.nu();
      if (terug && this.nu() - this.opnieuwAt >= OPNIEUW_MS) { this.opnieuwAt = this.nu(); this._vergeetVerstuurd(); }
    }
    if (v && !this.ooitVerbonden) {
      this.ooitVerbonden = true;
      this._melding(`beeld: verbonden met de relay (${this.instellingen.adres})`);
    }
    if (!v && this.wasVerbonden) this._vergeetVerstuurd();
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
   * De zeven kenmerken (0..1), of null als er niets speelt. Zonder verbinding
   * ook null: de zender vraagt ze dan nog steeds 30× per seconde, maar
   * versturen kan niet, en de analyser uitlezen kost iets.
   */
  kenmerken() {
    if (this.zender && !this.verbonden) return null;
    if (!this.speeltIets()) return null;
    const mix = this.luisteraar.lees(this.engine.ctx.currentTime);
    const tel = engineTel(this.engine, this.ids, this.vertraging());
    return kenmerkenVan(mix, tel);
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
      return { id, kant: this.engine.kant?.[id] ?? 'thru', geladen: !!d.buffer && !!this.nummers[id], speelt,
        laatst: this.laatst[id] ?? 0 };
    });
  }

  /** { speelt, pos, rate } van een track, of null. */
  _deckStand(id) {
    if (id === null) return null;
    const d = this.engine.deck(id);
    const speelt = !!d.playing && !d.wacht;
    return { speelt, pos: r2(hoorbaar(d, uitgangsVertraging(this.engine.ctx))), rate: r3(d.remt ? d.snelheid : d.rate) };
  }

  /** Is de Stroommachine er (een verse beeld-status)? Dan pas hebben track en mix zin. */
  get aanwezig() { return this.verbonden && this.nu() - this.beeldAt < BEELD_VERS_MS; }

  /**
   * Eén tik (elke TIK_MS zolang de zender loopt): staat er op een kant een
   * ander nummer, of veranderde crossfader of transport, dan gaat dat naar de
   * Stroommachine. Zonder verbinding of zonder Stroommachine wordt alleen
   * bijgehouden.
   */
  tik() {
    const tracks = this._tracks();
    if (!this.zender || !this.aanwezig) return;
    const kanten = { A: kiesKant(tracks, 'A'), B: kiesKant(tracks, 'B') };
    for (const kant of ['A', 'B']) {
      const n = kanten[kant] === null ? null : this.nummers[kanten[kant]];
      if (!n || this.verstuurd[kant] === n.id) continue;
      if (this.zender.track(kant, n)) this.verstuurd[kant] = n.id;
    }
    const a = this._deckStand(kanten.A), b = this._deckStand(kanten.B);
    const xfader = r3(this.engine.xfader ?? 0.5);
    const sleutel = JSON.stringify([xfader, kanten.A, a?.speelt, a?.rate, kanten.B, b?.speelt, b?.rate]);
    const nu = this.nu(), v = this.vorigeMix;
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

  /** Een macro (0..1) naar de Stroommachine; de stand blijft hier voor de ring. */
  zetWaarde(poort, waarde) {
    if (!MACROS.includes(poort)) return false;
    const v = Number.isFinite(waarde) ? Math.min(1, Math.max(0, waarde)) : 0;
    this.macros[poort] = v;
    return this.zender ? this.zender.poort(poort, v) : false;
  }

  /** De stand van een macro voor read(): null zonder verbinding (er is dan niets te doen). */
  waarde(poort) { return this.verbonden && poort in this.macros ? this.macros[poort] : null; }

  /** Een regieknop: alleen bij indrukken gaat er iets naar de Stroommachine. */
  druk(poort, on) {
    if (!REGIE.includes(poort)) return false;
    if (!on) { this.ingedrukt.delete(poort); return false; }
    this.ingedrukt.add(poort);
    return this.zender ? this.zender.poort(poort) : false;
  }

  /** Het lampje van een regieknop: 1 ingedrukt, 0 bruikbaar, null zonder verbinding. */
  knopStand(poort) { return this.verbonden ? (this.ingedrukt.has(poort) ? 1 : 0) : null; }
}
