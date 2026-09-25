import { clamp } from '../lib/emitter.js';
import { klokTrack, pulsVorm } from '../video/puls.js';
import { zichtbaarheid } from '../video/volg.js';

/**
 * De maat als bron voor de vormlagen (router.js), naast de banden uit de
 * master-analyse (luisteraar.js). Twee bronnen, allebei 0..1 (regel 2):
 *
 *   maatklap  de KLAPPEN van de maatgever uit de offline onset-analyse
 *             (deck.onsets, tracktijd, de server heeft de ijking van 68,5 ms
 *             er al af). Loopt in KLAP_OP seconden op tot 1 PRECIES op de
 *             klap en dooft uit met KLAP_TAU. Omdat de klappen vooraf bekend
 *             zijn, kan de opkomst vóór de klap liggen: de piek valt op wat je
 *             hoort, niet een beeld later.
 *   tel       de tel van de maatgever, dezelfde vorm als video.pulse
 *             (pulsVorm uit puls.js): vol op de tel, na een halve tel 8%.
 *
 * Maatgever = de track die het hardst klinkt, speelt en een grid heeft:
 * klokTrack uit puls.js, dezelfde keuze als de video-puls, zodat vorm en
 * video op dezelfde tel slaan.
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
 *     een klap die 80 ms eerder op de nieuwe track viel. Begint de nieuwe
 *     maatgever net te spelen, dan telt alles: zijn eerste tel ligt dan nog
 *     vóór wat je hoort, en die wil je zien.
 *   - Komen de klappen van de maatgever later binnen (ze worden na het laden
 *     opgehaald), dan geldt hetzelfde als bij een wissel.
 *
 * Zonder maatgever, zonder grid of zonder klappen: 0, geen fout.
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
 * De tracks zoals de maatlezer ze wil zien, uit de engine (alleen uitlezen,
 * duck-typed: deze module importeert de engine niet). Zicht = fader ×
 * crossfader, precies zoals de video-mixer het voor de video-puls rekent.
 */
export const engineTracks = (engine, ids) => ids.map((id) => {
  const deck = engine.deck(id);
  return { id, deck, zicht: deck.buffer ? zichtbaarheid(deck.ui.fader, engine.xfadeGain(id)) : 0 };
});

const leeg = () => ({ id: null, data: null, vanaf: -Infinity, tau: null });

/**
 * Leest klappen en tel van de maatgever uit, met toestand voor de wissels.
 * Eén `lees(t)` per beeld; dezelfde t twee keer (twee lagen in één beeld)
 * geeft hetzelfde terug zonder iets te veranderen.
 */
export class MaatLezer {
  /**
   * @param tracks     () -> [{ id, zicht, deck }], deck: { playing, grid, onsets, position, rate }
   * @param vertraging () -> seconden tussen de positie en wat je hoort (outputLatency + baseLatency)
   */
  constructor({ tracks, vertraging = () => 0 } = {}) {
    this.tracks = tracks;
    this.vertraging = vertraging;
    this.reset();
  }

  reset() {
    this.t = null;
    this.maatgever = null;             // id, of null
    this.speelden = new Set();         // wie speelde bij de vorige lees
    this.bronnen = { maatklap: leeg(), tel: leeg() };
    this.waarden = { maatklap: 0, tel: 0 };
  }

  /** Wie geeft de maat, en de lijst waaruit gekozen werd. */
  kies() {
    const lijst = this.tracks?.() ?? [];
    const id = klokTrack(lijst.map((tr) => ({
      id: tr.id, speelt: !!tr.deck?.playing, heeftGrid: !!tr.deck?.grid, zicht: tr.zicht ?? 0,
    })));
    return { tr: id === null ? null : lijst.find((x) => x.id === id), lijst };
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
    const pos = d ? d.position - this.vertraging() * rate : NaN;
    // Een wissel naar een track die al speelde = overnemen: alleen wat sinds
    // het vorige beeld komt telt (een klap in dat laatste beeld verschijnt
    // zoals elke klap: één beeld later, nog bijna vol). Naar een track die
    // net begint = starten: alles telt.
    const vanaf = id !== null && this.speelden.has(id) ? pos - dt * rate : -Infinity;

    const w = this.waarden;
    const nw = {};
    nw.maatklap = this._bron('maatklap', id, d?.onsets ?? null, vanaf, dt,
      (v0) => ({ v: klapOmhullende(d.onsets, pos, rate, v0), tau: KLAP_TAU }), w.maatklap);
    nw.tel = this._bron('tel', id, d?.grid ?? null, vanaf, dt, (v0) => {
      const { v, lengte } = telPuls(d.grid, pos, v0);
      return { v, tau: lengte > 0 ? lengte / (TEL_STEIL * rate) : null };
    }, w.tel);

    this.speelden = new Set(lijst.filter((x) => x.deck?.playing).map((x) => x.id));
    this.waarden = nw;
    return nw;
  }

  /**
   * Eén bron een stap verder. `data` = de klappen of het grid van de
   * maatgever: verandert de maatgever of zijn data, dan is het een wissel,
   * en vanaf dan telt alleen wat op of na `vanaf` (tracktijd) valt.
   */
  _bron(naam, id, data, vanaf, dt, reken, vorige) {
    const b = this.bronnen[naam];
    if (id !== b.id || data !== b.data) {
      b.vanaf = Number.isFinite(vanaf) ? vanaf : -Infinity;
      b.id = id;
      b.data = data;
    }
    let nieuw = 0;
    if (id !== null && data) {
      const r = reken(b.vanaf);
      nieuw = r.v;
      if (r.tau > 0) b.tau = r.tau;
    }
    // De staart: nooit sneller omlaag dan de puls zelf uitdooft.
    const tau = b.tau ?? KLAP_TAU;
    const staart = dt > 0 ? vorige * Math.exp(-dt / tau) : vorige;
    const v = Math.max(nieuw, staart);
    return v < NUL ? 0 : clamp(v);
  }
}
