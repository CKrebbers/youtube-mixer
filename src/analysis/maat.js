import { clamp } from '../lib/emitter.js';
import { klokTrack, klinkt, pulsVorm, maatgever as engineMaatgever } from '../video/puls.js';
import { hoorbaar } from '../engine/hoorbaar.js';

/**
 * De maat als bron voor de vormlagen (router.js), naast de banden uit de
 * master-analyse (luisteraar.js). Vier bronnen, allemaal 0..1 (regel 2):
 *
 *   maatklap  de KLAPPEN van de maatgever uit de offline onset-analyse
 *             (deck.onsets, tracktijd, de server heeft de ijking van 68,5 ms
 *             er al af). Loopt in KLAP_OP seconden op tot 1 PRECIES op de
 *             klap en dooft uit met KLAP_TAU. Omdat de klappen vooraf bekend
 *             zijn, kan de opkomst vóór de klap liggen: de piek valt op wat je
 *             hoort, niet een beeld later.
 *   tel       de tel van de maatgever, dezelfde vorm als video.pulse
 *             (pulsVorm uit puls.js): vol op de tel, na een halve tel 8%.
 *   sectie.energie
 *             de energie (0..1 binnen het nummer, server/secties.js) van de
 *             sectie van de maatgever die je HOORT (deck.sectieKaart,
 *             docs/SECTIES.md). Springt mee op een grens, een sectie-loop of
 *             een hotcue: wat je hoort, zie je.
 *   sectie.nieuw
 *             een nieuwe sectie begint: de vorm van een klap op elk
 *             sectiebegin behalve het eerste (het begin van het nummer is
 *             geen grens), met NIEUW_TAU: een accent, langer dan een klap.
 *             Ook de video-puls slaat erop (video-mixer.js, _accentNu).
 *
 * Maatgever = de maatgever van de ENGINE (Engine.maatgever, met hysterese:
 * 3 dB en 250 ms), via maatgever() uit puls.js: dezelfde track als de
 * video-puls, de MAAT-badge, sync, sampler en de bussen, zodat vorm en video
 * op dezelfde tel slaan en niet heen en weer springen als twee tracks
 * ongeveer even hard klinken. Maar alleen zolang je hem HOORT (speelt, wacht
 * niet op de maat, remt niet, klinkt()): een track die je niet hoort geeft
 * geen tel. Zonder engine (`maatgever` niet meegegeven): klokTrack op de
 * lijst, de hardste zonder geduld.
 *
 * Tijd (regel 3): alles volgt uit de POSITIE van het deck, en die komt van de
 * audioklok (bron.positie). Hoorbaar = positie min uitgangsvertraging × rate,
 * zoals de video-puls en de LED-fase. Uitdoven gaat in KLOKtijd: op 1,25×
 * dooft een klap in 0,1 s echte tijd, niet in 0,1 s tracktijd. Geen eigen
 * teller, geen timer: `lees(t)` wordt aangeroepen vlak voor een vormlaag zijn
 * beeld maakt. Op 30, 60 en 120 beelden per seconde staat een waarde op
 * hetzelfde moment even hoog (de test meet het).
 *
 * Geen sprong die het beeld laat schokken:
 *   - De uitvoer zakt nooit sneller dan de puls zelf uitdooft
 *     (max(nieuw, vorige × exp(-dt/τ))). Stopt de maatgever, springt hij
 *     (hotcue, sync, loop) of valt hij weg, dan sterft de staart gewoon uit.
 *     Zolang er niets gebeurt, is dat precies de vorm zelf. Omhoog mag een
 *     sprong van dezelfde track wel: een loop die rondgaat of een hotcue op
 *     de tel geeft een klap die je hoort, dus ook ziet.
 *   - Neemt een ANDERE track de maat over terwijl hij al speelde, dan tellen
 *     alleen klappen en tellen vanaf het vorige beeld (zoals elke klap: een
 *     beeld later, nog bijna vol). Anders sprong het beeld naar het midden van
 *     een klap die 80 ms eerder op de nieuwe track viel. Die grens vervalt
 *     zodra hij terugspringt tot ervóór (loop rond, hotcue). Begint de nieuwe
 *     maatgever net te spelen, dan telt alles: zijn eerste tel ligt dan nog
 *     vóór wat je hoort, en die wil je zien.
 *   - Komen de klappen van de maatgever later binnen (ze worden na het laden
 *     opgehaald), dan geldt hetzelfde als bij een wissel. Ook de sectiekaart
 *     (laden.js haalt hem na het laden op): een grens van net telt dan niet.
 *   - De sectie-energie is een stand, geen klap. Bij dezelfde maatgever en
 *     kaart volgt hij meteen; bij een andere maatgever, geen maatgever of een
 *     andere kaart glijdt hij (ENERGIE_TAU) naar de nieuwe waarde.
 *
 * Afval: `lees` draait elk beeld. De sectiebronnen maken niets aan (getallen
 * erin, getallen eruit, geen closures); het zoeken van de sectie begint bij de
 * vorige index (laatsteBegin). analyse.test controleert dat op de bron. (Klap
 * en tel maken wel per beeld een paar objecten: `nw`, de closures en hun
 * { v, tau }, de Set van wie speelde.)
 *
 * Zonder maatgever, zonder grid, zonder klappen of zonder secties: 0, geen fout.
 */

/** Opkomst van een klap, VÓÓR de klap (seconden kloktijd). */
export const KLAP_OP = 0.012;
/** Uitdoven na de klap (seconden kloktijd), zoals de live-klap (ONSET_TAU in features.js). */
export const KLAP_TAU = 0.1;
/** pulsVorm = exp(-TEL_STEIL × fase): hoe snel de tel uitdooft, als deel van een tel. */
export const TEL_STEIL = 5;
/**
 * Wat hieronder zakt is 0: een staart die eindeloos uitdooft zou elk beeld
 * een nieuwe parameter naar de Worker sturen. Een tel komt nooit zo laag
 * (pulsVorm zakt tot exp(-5) = 0,007); een klap na ~0,9 s.
 */
export const NUL = 1e-4;
/**
 * Uitdoven van een nieuwe sectie (seconden kloktijd). Een accent: twee keer
 * een klap, na 300 ms nog 22% (de flits-noodknop is dan weg), ver onder een
 * maat. Een aanname, niet op Clay's beamer bekeken (VRAGEN SVV).
 */
export const NIEUW_TAU = 0.2;
/** Glijden van de sectie-energie bij een wissel van maatgever of kaart (seconden kloktijd). */
export const ENERGIE_TAU = 0.25;
/** Zo dicht bij zijn doel stopt het glijden: daarna volgt de energie weer meteen. */
const GLIJ_KLAAR = 1e-3;

/** Index van de laatste klap op of vóór `pos`, of -1. Binair zoeken: een uur is ~18.000 klappen. */
export function laatsteKlap(onsets, pos) {
  let lo = 0, hi = onsets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] <= pos) lo = m + 1; else hi = m; }
  return lo - 1;
}

/**
 * De vorm van één klap, `d` seconden (kloktijd) na de klap: 0 tot KLAP_OP
 * ervoor, dan recht omhoog naar 1 op de klap, daarna exp(-d/τ).
 */
export function klapVorm(d, op = KLAP_OP, tau = KLAP_TAU) {
  if (!(d > -op)) return 0;                  // ook NaN
  if (d < 0) return 1 + d / op;
  return Math.exp(-d / tau);
}

/**
 * De klappen op tracktijd `pos` voor een deck op `rate`: de hoogste van de
 * laatste klap (uitdovend) en de volgende (opkomend). Afstanden in tracktijd
 * worden kloktijd door te delen door de rate. Een klap vóór `vanaf`
 * (tracktijd) telt niet: zie de wissel van maatgever hierboven.
 */
export function klapOmhullende(onsets, pos, rate = 1, vanaf = -Infinity) {
  if (!onsets?.length || !Number.isFinite(pos)) return 0;
  const r = rate > 0 ? rate : 1;
  const i = laatsteKlap(onsets, pos);
  let v = 0;
  if (i >= 0 && onsets[i] >= vanaf) v = klapVorm((pos - onsets[i]) / r);
  if (i + 1 < onsets.length && onsets[i + 1] >= vanaf) v = Math.max(v, klapVorm((pos - onsets[i + 1]) / r));
  return v;
}

/**
 * De tel op tracktijd `pos`: pulsVorm van de fase binnen de tel, precies wat
 * de video-puls doet. Plus hoe lang deze tel duurt (tracktijd), voor het
 * uitdoven; met een tempokaart kan dat per tel verschillen (overgangen).
 * Een tel die vóór `vanaf` begon telt niet.
 */
export function telPuls(grid, pos, vanaf = -Infinity) {
  if (!grid || !Number.isFinite(pos)) return { v: 0, lengte: null };
  const b = grid.beatAt(pos);
  if (!Number.isFinite(b)) return { v: 0, lengte: null };
  const n = Math.floor(b);
  const begin = grid.timeOf(n);
  const lengte = grid.timeOf(n + 1) - begin;
  if (begin < vanaf) return { v: 0, lengte };
  return { v: pulsVorm(b - n), lengte };
}

/**
 * Index van de sectie waarin tracktijd `pos` valt (het laatste begin op of
 * vóór pos), of −1 ervóór. `gok` = de index van het vorige beeld: meestal is
 * het dezelfde of de volgende, dan hoeft er niets gezocht te worden; anders
 * binair. De gok wordt altijd nagekeken, dus een gok van een andere kaart of
 * van vóór een sprong kan geen kwaad. Getal erin, getal eruit: geen afval.
 * Zonder marge (anders dan SectieKaart.index): dit is wat je HOORT.
 */
export function laatsteBegin(stukken, pos, gok = -1) {
  const n = stukken?.length ?? 0;
  if (!n || !(pos >= stukken[0].van)) return -1;               // ook NaN
  if (gok >= 0 && gok < n && stukken[gok].van <= pos) {
    if (gok + 1 >= n || pos < stukken[gok + 1].van) return gok;
    if (gok + 2 >= n || pos < stukken[gok + 2].van) return gok + 1;
  }
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (stukken[m].van <= pos) lo = m; else hi = m - 1; }
  return lo;
}

/**
 * Een nieuwe sectie op tracktijd `pos` voor een deck op `rate`: de vorm van
 * een klap (klapVorm, met NIEUW_TAU) op het laatste sectiebegin (uitdovend)
 * en het volgende (opkomend). Alleen GRENZEN: het eerste stuk (op 0, het begin
 * van het nummer) telt niet. Een begin vóór `vanaf` (tracktijd) ook niet: zie
 * de wissel van maatgever bovenaan. `i` = laatsteBegin(stukken, pos), als je
 * hem al hebt.
 */
export function sectieOmhullende(stukken, pos, rate = 1, vanaf = -Infinity, i = laatsteBegin(stukken, pos)) {
  if (!stukken?.length || !Number.isFinite(pos)) return 0;
  const r = rate > 0 ? rate : 1;
  let v = 0;
  if (i >= 1 && stukken[i].van >= vanaf) v = klapVorm((pos - stukken[i].van) / r, KLAP_OP, NIEUW_TAU);
  const k = i + 1;
  if (k >= 1 && k < stukken.length && stukken[k].van >= vanaf) v = Math.max(v, klapVorm((pos - stukken[k].van) / r, KLAP_OP, NIEUW_TAU));
  return v;
}

/**
 * De tracks zoals de maatlezer ze wil zien, uit de engine (alleen uitlezen,
 * duck-typed: deze module importeert de engine niet). `zicht` = hoe hard hij
 * klinkt (klinkt() uit puls.js, zoals de video-puls en engine.syncMaster), dus
 * dezelfde maatgever als de MAAT-badge zolang je die track hoort.
 */
export const engineTracks = (engine, ids) => ids.map((id) => {
  const deck = engine.deck(id);
  return { id, deck, zicht: deck.buffer ? klinkt(deck.ui.fader, engine.xfadeGain(id)) : 0 };
});

/**
 * Een MaatLezer op de engine: tracks uit engineTracks, de maatgever van de
 * engine (hysterese), zoals de video-puls. Voor het vormpaneel en de proeven.
 */
export const engineMaatLezer = (engine, ids, vertraging = () => 0) => new MaatLezer({
  tracks: () => engineTracks(engine, ids),
  maatgever: () => engineMaatgever(engine, ids),
  vertraging,
});

const leeg = (tau = null) => ({ id: null, data: null, vanaf: -Infinity, tau, glijd: false });

/**
 * Leest klappen, tel en secties van de maatgever uit, met toestand voor de
 * wissels. Eén `lees(t)` per beeld; dezelfde t twee keer (twee lagen in één
 * beeld) geeft hetzelfde terug zonder iets te veranderen.
 */
export class MaatLezer {
  /**
   * @param tracks     () -> [{ id, zicht, deck }], deck: { playing, grid, onsets, sectieKaart, position, rate }
   * @param vertraging () -> seconden tussen de positie en wat je hoort (outputLatency + baseLatency)
   * @param maatgever  () -> id of null: wie de maat geeft (engineMaatgever(engine, ids)).
   *                   Zonder: de hardste uit `tracks` (klokTrack), zonder hysterese.
   */
  constructor({ tracks, vertraging = () => 0, maatgever = null } = {}) {
    this.tracks = tracks;
    this.vertraging = vertraging;
    this.kiesMaatgever = maatgever;
    this.reset();
  }

  reset() {
    this.t = null;
    this.maatgever = null;             // id, of null
    this.speelden = new Set();         // wie speelde bij de vorige lees
    this.bronnen = { maatklap: leeg(), tel: leeg(), 'sectie.energie': leeg(), 'sectie.nieuw': leeg(NIEUW_TAU) };
    this.waarden = { maatklap: 0, tel: 0, 'sectie.energie': 0, 'sectie.nieuw': 0 };
    this.sectie = -1;                  // de sectie-index van het vorige beeld: de gok voor laatsteBegin
  }

  /** Wie geeft de maat, en de lijst waaruit gekozen werd. */
  kies() {
    const lijst = this.tracks?.() ?? [];
    const id = this.kiesMaatgever ? this.kiesMaatgever() : klokTrack(lijst.map((tr) => ({
      id: tr.id, speelt: !!tr.deck?.playing && !tr.deck?.wacht && !tr.deck?.remt, heeftGrid: !!tr.deck?.grid, zicht: tr.zicht ?? 0,
    })));
    const tr = id === null ? null : lijst.find((x) => x.id === id) ?? null;
    return { tr, lijst };
  }

  /** De waarden op tijd t (seconden, audioklok, wat je hoort). */
  lees(t) {
    if (this.t !== null && t === this.t) return this.waarden;
    if (this.t !== null && (t < this.t || t - this.t > 1)) this.reset();   // nieuwe klok of lang stil
    const dt = this.t === null ? 0 : t - this.t;
    this.t = t;

    const { tr, lijst } = this.kies();
    const d = tr?.deck ?? null;
    const id = tr?.id ?? null;
    this.maatgever = id;
    const rate = d && d.rate > 0 ? d.rate : 1;
    const pos = d ? hoorbaar(d, this.vertraging()) : NaN;         // de maatgever speelt altijd
    // Een wissel naar een track die al speelde = overnemen: alleen wat sinds
    // het vorige beeld komt telt (een klap in dat laatste beeld verschijnt
    // zoals elke klap: één beeld later, nog bijna vol). Naar een track die
    // net begint = starten: alles telt.
    const vanaf = id !== null && this.speelden.has(id) ? pos - dt * rate : -Infinity;

    const w = this.waarden;
    const nw = { maatklap: 0, tel: 0, 'sectie.energie': 0, 'sectie.nieuw': 0 };
    nw.maatklap = this._bron('maatklap', id, d?.onsets ?? null, vanaf, pos, dt,
      (v0) => ({ v: klapOmhullende(d.onsets, pos, rate, v0), tau: KLAP_TAU }), w.maatklap);
    nw.tel = this._bron('tel', id, d?.grid ?? null, vanaf, pos, dt, (v0) => {
      const { v, lengte } = telPuls(d.grid, pos, v0);
      return { v, tau: lengte > 0 ? lengte / (TEL_STEIL * rate) : null };
    }, w.tel);
    // De secties (docs/SECTIES.md): zonder closures en zonder objecten, dit
    // draait elk beeld. Eén keer zoeken voor beide bronnen.
    const kaart = d?.sectieKaart ?? null;
    const st = kaart?.stukken?.length ? kaart.stukken : null;
    const i = st && Number.isFinite(pos) ? (this.sectie = laatsteBegin(st, pos, this.sectie)) : -1;
    nw['sectie.nieuw'] = this._nieuw(id, kaart, st, i, vanaf, pos, dt, rate, w['sectie.nieuw']);
    nw['sectie.energie'] = this._energie(id, kaart, st, i, dt, w['sectie.energie']);

    // Een track die op zijn start op de maat wacht, speelt voor het oor nog
    // niet: begint hij, dan is dat starten (alles telt), geen overnemen.
    this.speelden = new Set(lijst.filter((x) => x.deck?.playing && !x.deck?.wacht).map((x) => x.id));
    this.waarden = nw;
    return nw;
  }

  /**
   * Eén bron een stap verder. `data` = de klappen of het grid van de
   * maatgever: verandert de maatgever of zijn data, dan is het een wissel,
   * en vanaf dan telt alleen wat op of na `vanaf` (tracktijd) valt. Die grens
   * geldt tot de hoorbare positie `pos` er weer vóór komt (een loop die
   * rondgaat, een hotcue terug): wat daar ligt hoor je opnieuw, dus dat telt.
   */
  _bron(naam, id, data, vanaf, pos, dt, reken, vorige) {
    const b = this.bronnen[naam];
    this._wissel(b, id, data, vanaf, pos);
    let nieuw = 0;
    if (id !== null && data) {
      const r = reken(b.vanaf);
      nieuw = r.v;
      if (r.tau > 0) b.tau = r.tau;
    }
    return this._staart(b, nieuw, dt, vorige);
  }

  /** Is het een wissel (andere maatgever of andere data)? Zet de grens `b.vanaf` (zie _bron). */
  _wissel(b, id, data, vanaf, pos) {
    if (id !== b.id || data !== b.data) {
      b.vanaf = Number.isFinite(vanaf) ? vanaf : -Infinity;
      b.id = id;
      b.data = data;
    } else if (pos < b.vanaf) b.vanaf = -Infinity;
  }

  /** De staart: nooit sneller omlaag dan de puls zelf uitdooft. */
  _staart(b, nieuw, dt, vorige) {
    const tau = b.tau ?? KLAP_TAU;
    const staart = dt > 0 ? vorige * Math.exp(-dt / tau) : vorige;
    const v = Math.max(nieuw, staart);
    return v < NUL ? 0 : clamp(v);
  }

  /**
   * Een nieuwe sectie: als een klap (dezelfde wissel en staart als maatklap),
   * met de sectiekaart als data. `st` = de stukken (of null), `i` hun index op
   * `pos` (laatsteBegin).
   */
  _nieuw(id, kaart, st, i, vanaf, pos, dt, rate, vorige) {
    const b = this.bronnen['sectie.nieuw'];
    this._wissel(b, id, kaart, vanaf, pos);
    const nieuw = id !== null && st ? sectieOmhullende(st, pos, rate, b.vanaf, i) : 0;
    return this._staart(b, nieuw, dt, vorige);
  }

  /**
   * De energie van de sectie die je hoort: een stand, geen klap. Zelfde
   * maatgever en kaart: meteen (een grens, een sectie-loop, een hotcue: wat je
   * hoort, zie je). Een andere maatgever, geen maatgever of een andere kaart
   * (die van de server komt na het laden): glijden met ENERGIE_TAU tot hij er
   * bijna is, daarna weer meteen. Vóór de eerste sectie (positie net onder 0
   * door de uitgangsvertraging): de eerste.
   */
  _energie(id, kaart, st, i, dt, vorige) {
    const b = this.bronnen['sectie.energie'];
    if (id !== b.id || kaart !== b.data) { b.id = id; b.data = kaart; b.glijd = true; }
    const doel = id !== null && st ? clamp(st[i < 0 ? 0 : i].energie) : 0;
    let v = doel;
    if (b.glijd) {
      v = doel + (vorige - doel) * (dt > 0 ? Math.exp(-dt / ENERGIE_TAU) : 1);
      if (Math.abs(v - doel) < GLIJ_KLAAR) { v = doel; b.glijd = false; }
    }
    return v < NUL ? 0 : clamp(v);
  }
}
