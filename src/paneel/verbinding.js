/**
 * De verbinding van een paneelpagina (werk.html) met de mixer (werkruimte S7, docs/WERKRUIMTE.md C4,
 * docs/werkruimte/S7.md). Twee transporten, één vorm (de BRON van vrij.js, plus wat de vakken
 * nodig hebben):
 *
 *   opener   werk.html is een venster van de mixer (mac-2, zoals de beamer en plan.html):
 *            `window.opener.varvePaneel`, dezelfde oorsprong, dezelfde thread, 0 ms. MAG BEDIENEN:
 *            invoke gaat over de bus van de mixer (dus in het log, en het ene tabblad met de
 *            APC blijft het ene tabblad).
 *   server   geen opener (de iPad): SSE op /api/paneel/live, de klok via /api/paneel/ping (mediaan
 *            van 8 rondjes, daarna 1×/10 s). ALLEEN KIJKEN (W1): er is geen invoke, en deze tak
 *            doet geen enkele POST (test/regels-werk.test.mjs controleert het).
 *
 * Geen AudioContext, geen requestMIDIAccess, geen Web Lock. Elke fetch leest zijn antwoord.
 *
 * Herverbinden zonder lus: bij een fout één nieuwe EventSource na OPNIEUW_MS (0,75 s; nooit
 * twee wachttijden tegelijk, dus hooguit ~1,3 pogingen per seconde zolang de server weg is);
 * komt er 2,5 s niets (de server stuurt elke seconde een hb), dan ook. Bij visibilitychange en online
 * meteen (hooguit één keer per 500 ms). Elke nieuwe verbinding begint met een LEGE stand en
 * wacht op de volledige stand van de server.
 */
import { pasToe, legeStand, klokVerschil, ctxOp, PING_RONDJES, invokeBericht } from './protocol.js';
import { positieIn, snelheidOp } from '../engine/stream-kern.js';
import { hoorbaar } from '../engine/hoorbaar.js';
import { leesWeg } from '../lib/antwoord.js';
import { Emitter } from '../lib/emitter.js';

export const STIL_MS = 2500;
export const OPNIEUW_MS = 750;
export const PING_MS = 10000;
const SNEL_MS = 500;

/** De koppeling met de mixer als opener (null zonder, of van een andere oorsprong). */
export function openerKoppeling(win = globalThis.window) {
  try {
    const o = win?.opener;
    if (!o || o.closed) return null;
    // Een andere oorsprong gooit hier (SecurityError): dan geen opener.
    if (o.location.origin !== win.location.origin) return null;
    return o.varvePaneel ?? null;
  } catch (_) { return null; }
}

/**
 * Via de opener: alles komt rechtstreeks van de mixer (zelfde thread). `koppeling()` wordt
 * elke keer opnieuw gevraagd: herlaadt de mixer, dan is de oude weg en de nieuwe er vanzelf.
 */
export class OpenerVerbinding extends Emitter {
  constructor({ koppeling = () => openerKoppeling() } = {}) {
    super();
    this.soort = 'opener';
    this._k = koppeling;
  }
  get k() { return this._k(); }
  get verbonden() { return !!this.k; }
  get kanBedienen() { return !!this.k; }
  read(id) { return this.k?.read(id) ?? null; }
  invoke(id, v) { return this.k?.invoke(id, v); }
  metaOf(id) { return this.k?.metaOf(id) ?? null; }
  label(id) { return this.k?.label(id) ?? null; }
  vars() { return this.k?.vars() ?? {}; }
  varsSleutel() { return this.k?.varsSleutel?.() ?? null; }
  badges(id) { return this.k?.badges(id) ?? []; }
  badgeSleutel() { return this.k?.badgeSleutel?.() ?? null; }
  geraakt(id) { return this.k?.geraakt(id) ?? 0; }
  naam(id) { return this.k?.naam?.(id) ?? null; }
  labelSleutel() { return this.k?.labelSleutel?.() ?? null; }
  /** Een nummer op track nr laden (alleen als venster van de mixer). */
  laad(nr, track) { return this.k?.laad?.(nr, track) ?? { ok: false }; }
  /** De klok van de mixer (geraakt staat daarop; dit venster heeft een ander nulpunt). */
  nu() { return this.k?.nu?.() ?? globalThis.performance.now(); }
  meld(t) { this.k?.meld?.(t); }
  /** { naam, deel, versie, delen, panelen, schermen } of null. */
  werk() { return this.k?.werk() ?? null; }
  werkSleutel() { return this.k?.werkSleutel?.() ?? ''; }
  kaart() { return this.k?.kaart() ?? null; }
  /** De invoer van de uitlijnweergave (reken.js), van nu. */
  invoer() { return this.k?.invoer() ?? null; }
  /** Per deck { nr, titel, bpm, positie (wat je hoort), speelt, wacht } en wie de maat geeft. */
  decks() { return this.k?.decks() ?? null; }
  start() {}
  stop() {}
}

/**
 * Via de server (SSE). `bronnen` = waar EventSource, fetch, de klok en de timers vandaan komen
 * (tests geven nep-versies).
 */
export class ServerVerbinding extends Emitter {
  constructor({ scherm = 'ipad', basis = '', ES = globalThis.EventSource, fetch: f = (...a) => globalThis.fetch(...a),
    nu = () => globalThis.performance.now(), setTimeout: st = (...a) => globalThis.setTimeout(...a),
    clearTimeout: ct = (...a) => globalThis.clearTimeout(...a), setInterval: si = (...a) => globalThis.setInterval(...a),
    clearInterval: ci = (...a) => globalThis.clearInterval(...a) } = {}) {
    super();
    this.soort = 'server';
    this.kanBedienen = false;   // de iPad kijkt, tot S8 een schrijver zet (zetSchrijver)
    this._schrijver = null;
    // Eén id per pagina: verbindt hij opnieuw, dan gooit de server zijn vorige (vaak dode) verbinding weg.
    this.pagina = Math.random().toString(36).slice(2, 14).padEnd(10, '0');
    this._seq = 0;
    this.scherm = scherm;
    this.basis = basis;
    this._ES = ES; this._fetch = f; this._nu = nu; this._st = st; this._ct = ct; this._si = si; this._ci = ci;
    this.stand = legeStand();
    this.compleet = false;       // kwam de volledige stand al binnen sinds deze verbinding?
    this.verbonden = false;      // de server is er EN de volledige stand van de mixer is binnen
    this.bereikbaar = false;     // de server is er (er kwam binnen STIL_MS iets, ook een hb)
    this.verschil = null;        // serverklok − eigen klok (ms)
    this.rondreis = null;
    this._laatst = 0;
    this._es = null;
    this._wacht = null;
    this._geraakt = new Map();
    this._versie = 0;
    // Tellers voor de proeven (werk-ipad.mjs): per soort, de grootte van de laatste stand, en de
    // tijdlijnen die binnenkwamen (deck:segId…, hooguit 500).
    this.stats = { verbindingen: 0, standen: 0, berichten: 0, pings: 0, soorten: {}, standBytes: 0, tijdlijnen: [] };
  }

  start() {
    if (this._gestart) return;
    this._gestart = true;
    this._open();
    this._waak = this._si(() => this._kijk(), 500);
    this._pingKlok = this._si(() => this.ping().catch(() => {}), PING_MS);
    this.ping().catch(() => {});
  }

  stop() {
    this._gestart = false;
    this._es?.close(); this._es = null;
    if (this._wacht) this._ct(this._wacht);
    this._ci(this._waak); this._ci(this._pingKlok);
    this._zetVerbonden(false);
  }

  /** Meteen opnieuw verbinden (visibilitychange, online), hooguit één keer per SNEL_MS. */
  opnieuw(reden = 'opnieuw') {
    const nu = this._nu();
    if (this._sindsOpnieuw && nu - this._sindsOpnieuw < SNEL_MS) return false;
    this._sindsOpnieuw = nu;
    this._open(reden);
    this.ping().catch(() => {});
    return true;
  }

  _open() {
    if (this._wacht) { this._ct(this._wacht); this._wacht = null; }
    this._es?.close();
    this.stand = legeStand();
    this.compleet = false;
    this._zetVerbonden(false);
    this.stats.verbindingen++;
    // Na een onderbreking kan de server een nieuw proces zijn (een andere klok): opnieuw pingen
    // zodra hij antwoordt.
    if (this.stats.verbindingen > 1) this._herping = true;
    this._laatst = this._nu();
    const es = new this._ES(`${this.basis}/api/paneel/live?s=${encodeURIComponent(this.scherm)}&k=${this.pagina}`);
    this._es = es;
    es.onmessage = (e) => { if (this._es === es) this._bericht(e.data); };
    es.onerror = () => {
      if (this._es !== es) return;
      this.bereikbaar = false;
      this._zetVerbonden(false);
      // Zelf opnieuw, één keer per OPNIEUW_MS (niet de terugval van de browser: die wacht soms
      // langer, en CLOSED probeert hij helemaal niet meer). Nooit twee wachttijden tegelijk.
      es.close();
      if (!this._wacht) this._wacht = this._st(() => { this._wacht = null; if (this._gestart) this._open(); }, OPNIEUW_MS);
    };
  }

  _laatstBinnen() { return this._nu() - this._laatst <= STIL_MS && !!this._es && this._es.readyState === 1; }

  /** Elke 500 ms: kwam er STIL_MS niets, dan is de verbinding weg (rode balk) en één nieuwe. */
  _kijk() {
    if (!this._gestart) return;
    if (this._nu() - this._laatst > STIL_MS) {
      this.bereikbaar = false;
      this._zetVerbonden(false);
      if (!this._wacht) this._open();
    }
  }

  _zetVerbonden(aan) {
    if (!aan && !this._laatstBinnen()) this.bereikbaar = false;
    if (aan === this.verbonden) return;
    this.verbonden = aan;
    this.emit('verbinding', aan);
  }

  _bericht(data) {
    let b;
    try { b = JSON.parse(data); } catch (_) { return; }
    this._laatst = this._nu();
    this.bereikbaar = true;
    this.stats.berichten++;
    if (this._herping) { this._herping = false; this.ping().catch(() => {}); }
    if (b?.t) this.stats.soorten[b.t] = (this.stats.soorten[b.t] ?? 0) + 1;
    if (b?.t === 'hb') { if (this.compleet) this._zetVerbonden(true); return; }
    if (b?.t === 'weg') { this.stand = legeStand(); this.compleet = false; this._zetVerbonden(false); return; }
    if (b?.t === 'stand') this.stats.standBytes = data.length;
    if (b?.t === 'tijdlijn' && this.stats.tijdlijnen.length < 500) this.stats.tijdlijnen.push(`${b.deck}:${b.tl?.segId}:${b.tl?.gridVersie}:${b.tl?.wacht ? 1 : 0}:${b.tl?.remt ? 1 : 0}`);
    if (b?.t === 'stand') { this.compleet = true; this.stats.standen++; }
    if (!this.compleet) return;   // eerst de volledige stand, anders klopt er niets
    if (b.t === 'verschil' && Array.isArray(b.geraakt)) { const t = this._nu(); for (const id of b.geraakt) this._geraakt.set(id, t); }
    pasToe(this.stand, b);
    if (b.t === 'werkruimte' || b.t === 'stand') { this._versie++; this.emit('werkruimte', this.werk()); }
    this._zetVerbonden(true);
  }

  /** Het klokverschil met de server: PING_RONDJES rondjes, de mediaan van de snelste helft. */
  async ping(n = PING_RONDJES) {
    const rondjes = [];
    for (let i = 0; i < n; i++) {
      const a = this._nu();
      let r;
      try { r = await this._fetch(`${this.basis}/api/paneel/ping`, { cache: 'no-store' }); } catch (_) { return null; }
      if (!r.ok) { await leesWeg(r); return null; }
      const d = await r.json().catch(() => null);
      const b = this._nu();
      if (Number.isFinite(d?.t)) rondjes.push({ a, s: d.t, b });
    }
    const k = klokVerschil(rondjes);
    if (k) { this.verschil = k.verschil; this.rondreis = k.rondreis; this.stats.pings++; }
    return k;
  }

  /** De klok van de server nu (ms), of null zonder klokverschil. */
  srvNu() { return this.verschil === null ? null : this._nu() + this.verschil; }
  /** De audioklok van de mixer op serverklok `srv` (standaard nu). */
  ctxOp(srv = this.srvNu()) { return srv === null ? null : ctxOp(this.stand.klok, srv); }

  get _w() { return this.stand.werkruimte ?? null; }
  read(id) { const v = this.stand.reads?.[id]; return v === undefined ? null : v; }
  metaOf(id) { return this._w?.labels?.[id] ?? null; }
  label(id) { return this._w?.labels?.[id]?.kort ?? null; }
  vars() { return this._w?.vars ?? {}; }
  varsSleutel() { return `${this._versie}`; }
  badges(id) { return this._w?.badges?.[id] ?? []; }
  badgeSleutel() { return `${this._versie}`; }
  geraakt(id) { return this._geraakt.get(id) ?? 0; }
  nu() { return this._nu(); }
  naam(id) { return this._w?.labels?.[id]?.naam ?? null; }
  labelSleutel() { return `${this._versie}`; }

  /**
   * Voor S8 (bedienen vanaf de iPad, na W1): `fn(bericht)` krijgt een invoke in de vorm van
   * protocol.invokeBericht en vervoert hem (de route, de koppelcode, de rem zijn van S8). Zonder
   * schrijver bestaat `invoke` niet en kijkt het paneel alleen (vrij.js: geen invoke = kijken).
   */
  zetSchrijver(fn) {
    this._schrijver = typeof fn === 'function' ? fn : null;
    this.kanBedienen = !!this._schrijver;
    if (this._schrijver) this.invoke = (id, v) => this._schrijver(invokeBericht({ id, v, druk: typeof v === 'boolean' ? (v ? 'aan' : 'los') : null, seq: ++this._seq, scherm: this.scherm, k: this.pagina }));
    else delete this.invoke;
  }
  meld() {}
  werk() { return this._w; }
  /** Alleen de opbouw (werkruimte, deel, versie): focus, mapjes en shift bouwen de vakken niet opnieuw. */
  werkSleutel() { const w = this._w; return w ? `${w.naam}:${w.deel}:${w.versie}:${this.stats.standen}` : ''; }
  kaart() { return this._w?.kaart ?? null; }

  /** Wat je NU van deck `id` hoort (tracktijd), op serverklok `srv`: hoorbaar.js op het segment. */
  hoorbaarOp(id, srv = this.srvNu()) {
    const tl = this.stand.tijdlijn?.[id];
    const klok = this.stand.klok;
    const c = this.ctxOp(srv);
    if (!tl || c === null || !klok) return null;
    const positie = positieIn(tl, tl.vorig, c);
    const actief = c < tl.T && tl.vorig ? tl.vorig : tl;
    return hoorbaar({ playing: !!actief.speelt, wacht: !!tl.wacht, position: positie, remt: !!tl.remt,
      snelheid: snelheidOp(actief, c), rate: tl.rate }, klok.V ?? 0);
  }

  /** De invoer van de uitlijnweergave (reken.js) uit de segmenten en de eigen klok. */
  invoer() {
    const nu = this.ctxOp();
    if (nu === null || !this.stand.klok) return null;
    const decks = [];
    for (const [id, info] of Object.entries(this.stand.decks ?? {})) {
      const tl = this.stand.tijdlijn?.[id];
      if (!tl || !info?.grid) continue;
      decks.push({ id, nr: info.nr, titel: info.titel, grid: info.grid, tijdlijn: tl, duur: info.duur,
        tellen: null, klappen: null, peaks: null, inhoud: 0 });
    }
    decks.sort((a, b) => a.nr - b.nr);
    return { decks, maatgever: this.stand.maatgever, V: this.stand.klok.V ?? 0, nu };
  }

  decks() {
    const lijst = [];
    for (const [id, info] of Object.entries(this.stand.decks ?? {})) {
      const tl = this.stand.tijdlijn?.[id];
      lijst.push({ id, nr: info.nr, titel: info.titel, bpm: info.bpm, duur: info.duur, secties: info.secties ?? null,
        positie: tl ? this.hoorbaarOp(id) : null, speelt: !!tl?.speelt, wacht: !!tl?.wacht });
    }
    lijst.sort((a, b) => a.nr - b.nr);
    return { decks: lijst, maatgever: this.stand.maatgever };
  }
}

/** De verbinding voor deze pagina: de opener als die er is, anders de server. */
export function maakVerbinding({ scherm = 'ipad', win = globalThis.window, ...rest } = {}) {
  if (openerKoppeling(win)) return new OpenerVerbinding();
  return new ServerVerbinding({ scherm, ...rest });
}
