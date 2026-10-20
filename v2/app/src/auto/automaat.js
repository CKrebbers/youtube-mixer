/**
 * De auto-DJ, het uitvoeren. Hij bedient VarveDJ zoals Clay: via de bus, met bron
 * 'auto', dus alles staat in het handelingenlog met de bron erbij (telling/nu.md punt 5:
 * wat de automaat stuurde was 7,9% van het log, en het log wist niet van wie).
 *
 * Herkomst: v1 src/auto/automaat.js (docs/AUTO-DJ.md), maar kleiner (oogst dj-workflow-055:
 * v1 groeide naar 1279 regels). Wat er in v2 anders is:
 *   - EÉN MAATKLOK. Blend en filter lopen over de maten van de klok (planner.planMoment in
 *     klok-tellen): de uitgaande is gekoppeld, dus zijn plek volgt de klok. De nieuwe start
 *     met track.N.play.quant op de volgende "1" van de klok, en die "1" IS het begin van de
 *     overgang. Alleen overvloeien (beatloos) rekent op de plek van de uitgaande.
 *   - Geen .glide-acties: de strip glijdt zelf (setTargetAtTime, 8–10 ms) naar elke waarde.
 *     De curve gaat dus per tik (40 ms) als gewone waarde, en alleen als hij veranderde.
 *   - Laden is een functie die de app meegeeft (`laad(n, id)`), de lijst ook (`nummers()`).
 *   - Clay wint (oogst dj-workflow-049): elke actie op de bus met een bron die niet 'auto' is
 *     op een track in de overgang (OVERNEEM, of meta.overneem) = de automaat laat los. Kijken
 *     (focus, pfl) telt niet. Een track die Clay de laatste CLAY_RECENT s aanraakte, of waar
 *     hij zelf iets op laadde, laadt en start de automaat nooit (v1 S9).
 *   - Nog niet (v1 wel): plan, secties, lagen, GO, buiten/terug.
 *
 * Fasen: uit → wacht (niets klaar) → laden → klaar (de volgende staat stil klaar, het moment
 * ligt vast) → bezig (de overgang loopt) → wacht … ; 'overgenomen': Clay deed het, wachten tot
 * er weer één track duidelijk klinkt.
 *
 * Regel 3: waar de overgang is komt van de audioklok (de klok-tel, of de plek van de
 * uitgaande); de timer zegt alleen WANNEER er gekeken wordt.
 */
import { Emitter } from '../kern/emitter.js';
import {
  OVERGANGEN, SPEELDUUR, MARGE_EINDE, VOORUIT, TEMPO_MAX, KORT,
  fragment, kenmerken, kiesVolgende, kiesOvergang, planMoment, standen, klaarStand, voortgang,
  leesToon, transponeer, halveTonenVan, toonNaam,
} from './planner.js';

/** Zo vaak (ms) kijkt de automaat. Alleen WANNEER: wat er gebeurt komt van de audioklok. */
export const TIK_MS = 40;
/** Een track die Clay zo kort geleden (s audioklok) aanraakte, laadt en start de automaat niet (v1 CLAY_RECENT). */
export const CLAY_RECENT = 120;
/** Een knop gaat pas opnieuw de bus op als hij zoveel verschoof (de strip glijdt zelf; minder is ruis in het log). */
export const MIN_STAP = 0.002;
/** Boven deze zaalversterking (fader × crossfader, knopwaarde) klinkt een track "duidelijk" (v1: fader > 0,05). */
export const DUIDELIJK = 0.05;
/** "langer": zoveel maten (beatloos: seconden) erbij. */
export const LANGER_MATEN = 8, LANGER_SEC = 30;
/** Zo lang mag een laad duren voor de automaat hem opgeeft (ms; alleen met een timer). */
export const LAAD_MAX = 30000;

/** Waarmee Clay een overgang overneemt (op een track in de overgang). De crossfader raakt elke overgang. */
const OVERNEEM = /^track\.(\d+)\.(fader|laag|mid|hoog|kill\.(laag|mid|hoog)|filter|play|play\.quant|sync|sync\.klok|seek|jog|nudge\.(voor|terug)|pitch|cue|hotcue\.\d+|loop(\.(halveer|verdubbel))?|beatjump\.(voor|terug)|send\.[ab]|kant|laad)$/;
/** Kijken en luisteren is geen gebruiken (v1 KIJKEN). */
const KIJKEN = /^track\.\d+\.(focus|pfl)$/;
const TRACK = /^track\.(\d+)\./;

/**
 * Neemt deze actie (van Clay) een overgang over? Geeft { n } (n = tracknummer, of null als
 * hij elke overgang raakt, zoals de crossfader) of null. De definitie gaat voor: meta.overneem
 * true of false (oogst dj-workflow-080: de aard staat in de actie, niet in een lijst).
 */
export function neemtOver(id, meta = null) {
  if (meta?.overneem === false || meta?.kijken === true) return null;
  const m = OVERNEEM.exec(id);
  if (m) return { n: Number(m[1]) };
  if (id === 'mixer.xfader') return { n: null };
  if (meta?.overneem === true) { const t = TRACK.exec(id); return { n: t ? Number(t[1]) : null }; }
  return null;
}

/** Maakt deze actie een track "van Clay" (CLAY_RECENT)? Elke track-actie behalve kijken. */
export function gebruikt(id, meta = null) {
  const t = TRACK.exec(id);
  if (!t || KIJKEN.test(id) || meta?.kijken === true) return null;
  return Number(t[1]);
}

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const KNOPPEN = [['fader', 'fader'], ['laag', 'laag'], ['filter', 'filter'], ['sendA', 'send.a'], ['sendB', 'send.b']];
const echteTimer = { elke(fn, ms) { const h = setInterval(fn, ms); h.unref?.(); return () => clearInterval(h); } };

export class Automaat extends Emitter {
  /**
   * @param engine   de engine (alleen LEZEN: tracks, klok, mixer; sturen gaat via de bus)
   * @param bus      de bus (engine.bus)
   * @param nummers  () => [{ id, titel, artiest, duur, grid, toon, … }] (of een Promise, of een Map)
   * @param laad     (n, id) => Promise<boolean>: een library-nummer op track n laden (de app)
   * @param tijd     { elke(fn, ms) -> stop() } voor de tik; null = geen timer (tests roepen tik() aan)
   * @param rnd      toeval 0..1
   */
  constructor({ engine, bus = engine.bus, nummers, laad, tijd = echteTimer, rnd = Math.random, tik = TIK_MS, clayRecent = CLAY_RECENT }) {
    super();
    Object.assign(this, { engine, bus, laad, rnd, tikMs: tik, clayRecent, _tijd: tijd, _nummersFn: nummers });
    this.actief = false;
    this.fase = 'uit';
    this.hoofd = null;           // tracknummer van wat nu klinkt (en uitgemixt wordt)
    this.eind = null;            // plek (tracktijd) waar de hoofdtrack klaar moet zijn
    this.volgende = null;        // { n, nummer, van, tot, overgang, moment, basis, bron, waarom, bevestigd, gestart, langer, nu }
    this.gespeeld = new Set();
    this.overgeslagen = new Set();
    this.eigen = new Set();      // tracks die de automaat gebruikt (heen en weer, zoals twee decks)
    this.geschiedenis = [];      // wat er gebeurde (nieuwste achteraan)
    this.melding = null;
    this._clay = new Map();      // n -> audioklok van Clay's laatste aanraking
    this._clayGeladen = new Set();
    this._laadt = new Set();     // tracks waar de automaat NU zelf op laadt
    this._laden = false;
    this._stop = null;
    this._lijst = [];
    this._los = [
      bus.on('actie', (a) => this._bijBus(a)),
      engine.on('laad', (l) => this._bijLaad(l)),
    ];
  }

  // ---- lezen --------------------------------------------------------------------------

  _T(n) { return this.engine.track(n); }
  get _tracks() { return this.engine.tracks; }
  get klok() { return this.engine.klok; }

  /** Klinkt deze track (speelt, en nog niet voorbij het einde van zijn nummer)? */
  _klinkt(t) {
    if (!t?.geladen || !t.speelt) return false;
    return t.plek(this.engine.straks()) < t.nummer.duur - 0.05;
  }

  /** De library-gegevens van wat er op track n staat (de toon staat niet op de track). */
  _nummerVan(n) {
    const id = this._T(n)?.nummer?.id;
    return id ? this._lijst.find((x) => x.id === id) ?? this._T(n).nummer : null;
  }

  async _leesNummers() {
    const x = await this._nummersFn();
    this._lijst = Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : [...(x ?? [])];
    return this._lijst;
  }

  /** Is track n van Clay: hij laadde er zelf iets op, of raakte hem kort geleden aan (niet de hoofdtrack of de volgende). */
  _vanClay(n) {
    if (this._clayGeladen.has(n)) return true;
    if (n === this.hoofd || n === this.volgende?.n) return false;
    const t = this._clay.get(n);
    return t !== undefined && this.engine.nu() - t < this.clayRecent;
  }

  /** De luidste track die duidelijk klinkt, of null. `vrij`: alleen tracks die niet van Clay zijn. */
  _luidste({ vrij = false } = {}) {
    let beste = null, max = DUIDELIJK;
    for (const t of this._tracks) {
      if (!this._klinkt(t) || (vrij && this._vanClay(t.n))) continue;
      const g = this.engine.zaalVersterking(t.n);
      if (g > max) { max = g; beste = t.n; }
    }
    return beste;
  }

  /** Een track om te laden: een die de automaat al gebruikte, dan een lege, dan een stille. Nooit de hoofdtrack. */
  _vrijeTrack() {
    const vrij = this._tracks.filter((t) => t.n !== this.hoofd && !t.speelt && t.wacht === null && !t.instrument && !this._vanClay(t.n));
    return (vrij.find((t) => this.eigen.has(t.n)) ?? vrij.find((t) => !t.geladen) ?? vrij.at(-1))?.n ?? null;
  }

  /**
   * Wat we van de uitgaande weten op plek `pos`, met bpm en toon zoals je hem HOORT.
   * gridZeker vraagt ook dat hij op de klok loopt: anders is een tel van de klok niet zijn tel.
   */
  _uitKenmerken(h, pos) {
    const t = this.engine.straks();
    const g = h.grid;
    const rate = h.speelt ? h.snelheid(t) : h.pitchRate;
    const kPlaat = leesToon(this._nummerVan(h.n)?.toon ?? null);
    const opKlok = h.gekoppeld && this.klok.loopt;
    return {
      grid: g, geenGrid: !g,
      gridZeker: !!g && opKlok && h.maatZeker(pos),
      bpm: opKlok ? this.klok.bpm(t) : g ? g.bpmAt(pos) * rate : null,
      k: transponeer(kPlaat, halveTonenVan(rate)),
      toonZeker: kPlaat !== null && this._nummerVan(h.n)?.toonZeker !== false,
    };
  }

  /** De nieuwe op zijn beginpunt (geladen: het grid van de track, de toon uit de library). */
  _inKenmerken(v) {
    const t = this._T(v.n);
    const k = kenmerken(v.nummer, v.van);
    const g = t.grid;
    return { ...k, grid: g, gridZeker: !!g && t.maatZeker(v.van), bpm: g ? g.bpmAt(v.van) : k.bpm };
  }

  // ---- aan en uit -------------------------------------------------------------------------

  async aan() {
    if (this.actief) return;
    this.actief = true;
    this.fase = 'wacht';
    this.melding = null;
    try { await this._leesNummers(); } catch (e) { this._meld(`de library is niet te lezen: ${e.message}`, 'fout'); this.uit(); return; }
    if (!this.actief) return;
    if (!this._lijst.length) { this._meld('de library is leeg', 'fout'); this.uit(); return; }
    // Wat nu het hardst klinkt geeft Clay over (hij zette de automaat aan): dat wordt de hoofdtrack.
    const n = this._luidste();
    if (n) this._neemAlsHoofd(n);
    if (this._tijd) this._stop = this._tijd.elke(() => this.tik(), this.tikMs);
    this.emit('verander');
    this.tik();
  }

  uit() {
    this.actief = false;
    this.fase = 'uit';
    this._stop?.();
    this._stop = null;
    this.emit('verander');
  }

  vernietig() { this.uit(); for (const l of this._los) l?.(); }

  /** Een track (die al klinkt) wordt de hoofdtrack: hij speelt zijn fragment van hier. */
  _neemAlsHoofd(n) {
    const t = this._T(n);
    const P = t.plek(this.engine.straks());
    const rate = t.snelheid(this.engine.straks()) || 1;
    this.hoofd = n;
    this.eind = Math.min(t.nummer.duur - MARGE_EINDE, P + SPEELDUUR * rate);
    this.eigen.add(n);
    this._clayGeladen.delete(n);
    this.gespeeld.add(t.nummer.id);
  }

  // ---- Clay grijpt in ------------------------------------------------------------------

  /** Bevestigen: niets verandert, maar het staat vast. */
  ok() { if (this.volgende) { this.volgende.bevestigd = true; this.emit('verander'); } }

  /** Deze niet: een andere. Tijdens de overgang kan dat niet meer. */
  overslaan() {
    const v = this.volgende;
    if (!v || this.fase === 'bezig') return;
    this.overgeslagen.add(v.nummer.id);
    this._gebeurd({ n: v.n, id: v.nummer.id, titel: v.nummer.titel, wat: 'overgeslagen' });
    this.volgende = null;
    this.fase = 'wacht';
    this.emit('verander');
  }

  /** Nog 8 maten (beatloos: 30 s) langer op de huidige. */
  langer() {
    const v = this.volgende;
    if (!v?.moment || this.fase !== 'klaar') return;
    const h = this._T(this.hoofd);
    const m = v.moment;
    const extra = m.opKlok ? LANGER_MATEN * this.klok.perMaat : LANGER_SEC * (h.snelheid(this.engine.straks()) || 1);
    const nieuw = { ...m, start: m.start + extra };
    if (!this._past(h, nieuw)) { this._meld('langer kan niet: het nummer is bijna op'); return; }
    v.moment = nieuw;
    v.langer = (v.langer || 0) + 1;
    this.emit('verander');
  }

  /** Zo snel het mooi kan: de eerstvolgende 4-maatsgrens van de klok (beatloos: meteen). */
  nu() {
    const v = this.volgende;
    if (!v?.moment || this.fase !== 'klaar') return;
    v.moment = this._zoSnel(v.moment);
    v.nu = true;
    this.emit('verander');
  }

  _zoSnel(m) {
    const t = this.engine.straks();
    if (m.opKlok) {
      const kort = KORT * this.klok.perMaat;
      const vroegst = this.klok.tel(t + 1.5);
      return { ...m, start: Math.ceil(vroegst / kort - 1e-9) * kort };
    }
    const h = this._T(this.hoofd);
    return { ...m, start: h.plek(t) + 0.5 * (h.snelheid(t) || 1) };
  }

  /** Iemand anders dan de automaat raakte de bus aan. */
  _bijBus({ id, bron, meta }) {
    if (bron === 'auto') return;
    const tn = gebruikt(id, meta);
    // Een laad die de automaat zelf doet (via de library, met de bron van het scherm) telt niet.
    if (tn !== null && id.endsWith('.laad') && this._laadt.has(tn)) return;
    // Wat Clay aanraakt telt ook als de automaat uit staat: de laatste 120 s, wanneer hij ook aangaat.
    if (tn !== null) this._clay.set(tn, this.engine.nu());
    if (!this.actief) return;
    const o = neemtOver(id, meta);
    if (!o) return;
    const v = this.volgende;
    const raakt = o.n === null || o.n === this.hoofd || o.n === v?.n;
    if (!raakt) return;
    if (this.fase === 'bezig' || (this.fase === 'klaar' && v && o.n === v.n)) {
      this.fase = 'overgenomen';
      this._gebeurd({ n: o.n, wat: 'overgenomen', door: id });
      this._meld('je nam de overgang over: ik ga verder als er weer één track duidelijk klinkt');
      this.emit('verander');
    }
  }

  /** Een laad die de automaat niet zelf deed: die track is van Clay. */
  _bijLaad({ n, stand }) {
    if (stand !== 'klaar' || this._laadt.has(n)) return;
    this._clayGeladen.add(n);
    this.eigen.delete(n);
    if (!this.actief) return;
    if (n === this.volgende?.n || n === this.hoofd) {
      if (this.fase === 'bezig') this.fase = 'overgenomen';
      else {
        if (n === this.hoofd) this.hoofd = null;
        this.volgende = null;
        if (this.fase === 'klaar') this.fase = 'wacht';
      }
      this._meld(`op track ${n} laadde jij iets anders: die is van jou`);
      this.emit('verander');
    }
  }

  // ---- de lus ------------------------------------------------------------------------------

  tik() {
    if (!this.actief) return;
    try { this._tik(); } catch (e) { this._meld(`auto-dj: ${e.message}`, 'fout'); }
  }

  _tik() {
    if (this.fase === 'overgenomen') { this._naOvername(); return; }
    if (this._laden) return;
    const h = this.hoofd ? this._T(this.hoofd) : null;
    if (this.fase !== 'bezig' && !(h && (this._klinkt(h) || h.wacht !== null))) {
      // De hoofdtrack klinkt niet (begin, op, of Clay zette hem stil). Klinkt er iets van Clay, dan
      // is het niet stil en wacht de automaat; anders meteen iets laten klinken (nooit stilte).
      if (this._luidste()) return;
      if (this.fase === 'klaar') { this._startMeteen(); return; }
      if (this.fase === 'wacht') this._bereidVoor({ meteen: true });
      return;
    }
    if (this.fase === 'wacht') { this._bereidVoor(); return; }
    if (this.fase === 'klaar') { this._klaar(h); return; }
    if (this.fase === 'bezig') this._bezig(h);
  }

  /** De volgende kiezen, laden en klaarzetten (stil, op zijn beginpunt). */
  async _bereidVoor({ meteen = false } = {}) {
    this._laden = true;
    this.fase = 'laden';
    this.emit('verander');
    let n = null;
    try {
      await this._leesNummers();
      if (!this.actief) return;
      const gespeeld = new Set([...this.gespeeld, ...this.overgeslagen]);
      const k = kiesVolgende({ huidig: this._huidig(), nummers: this._lijst, gespeeld, rnd: this.rnd });
      if (!k) { this._meld('niets meer om te spelen', 'fout'); this.uit(); return; }
      n = this._vrijeTrack();
      if (n === null) { this._meld('geen vrije track om op te laden', 'fout'); this.fase = 'wacht'; return; }
      this._laadt.add(n);
      const gelukt = await this._laadMet(n, k.nummer.id);
      if (!this.actief) return;
      const t = this._T(n);
      if (!gelukt || t.nummer?.id !== k.nummer.id) {
        this.overgeslagen.add(k.nummer.id);
        throw new Error(`${k.nummer.titel ?? k.nummer.id} laadde niet`);
      }
      this.eigen.add(n);
      this._clayGeladen.delete(n);
      const f = fragment({ ...k.nummer, duur: t.nummer.duur, grid: t.grid?.toJSON?.() ?? k.nummer.grid }, { rnd: this.rnd });
      const van = this._opMaat(t, f.van);
      if (Math.abs(t.plek(this.engine.straks()) - van) > 1e-3) this._doe(`track.${n}.seek`, t.nummer.duur ? van / t.nummer.duur : 0);
      this.volgende = { n, nummer: k.nummer, van, tot: f.tot, bron: 'kiezer', waarom: k.redenen.join(', '),
        bevestigd: false, gestart: false, overgang: null, moment: null, basis: null, langer: 0, nu: false };
      const h = this.hoofd ? this._T(this.hoofd) : null;
      if (meteen || !h || !this._klinkt(h)) { this.fase = 'klaar'; this._startMeteen(); return; }
      this._planOvergang();
      this.fase = 'klaar';
    } catch (e) {
      this._meld(`laden mislukt: ${e.message}`, 'fout');
      if (this.fase === 'laden') this.fase = 'wacht';
    } finally {
      if (n !== null) this._laadt.delete(n);
      this._laden = false;
      this.emit('verander');
    }
  }

  /** Laden, met een grens als er een timer is (een laad die nooit antwoordt zet de automaat niet vast). */
  _laadMet(n, id) {
    const p = Promise.resolve().then(() => this.laad(n, id)).then((r) => r !== false && r !== null, () => false);
    if (!this._tijd) return p;
    return new Promise((klaar) => {
      const stop = this._tijd.elke(() => { stop(); klaar(false); }, LAAD_MAX);
      p.then((r) => { stop(); klaar(r); });
    });
  }

  /** Beginnen op een maatbegin van de nieuwe als zijn grid daar zeker is (dan valt zijn "1" op die van de klok). */
  _opMaat(t, van) {
    const g = t.grid;
    if (!g || !g.zekerBij(van)) return van;
    return Math.max(0, g.timeOf(g.volgendeVeelvoud(g.beatAt(van), g.beatsPerBar)));
  }

  /** Wat er nu klinkt, als de kiezer het wil weten (wat je HOORT: de klok, de toon na de snelheid). */
  _huidig() {
    if (!this.hoofd) return null;
    const h = this._T(this.hoofd);
    if (!h.geladen) return null;
    const pos = Math.min(this.eind ?? h.nummer.duur, h.nummer.duur - MARGE_EINDE);
    const u = this._uitKenmerken(h, pos);
    return { id: h.nummer.id, bpm: u.bpm, k: u.k, toonZeker: u.toonZeker, loudness: this._nummerVan(this.hoofd)?.loudness_i ?? null };
  }

  /** De soort overgang en het moment (de bewakers), en de nieuwe klaarzetten. */
  _planOvergang() {
    const v = this.volgende;
    const h = this._T(this.hoofd);
    const t = this.engine.straks();
    const eind = Math.min(this.eind ?? h.nummer.duur, h.nummer.duur - MARGE_EINDE);
    const pos = Math.max(h.plek(t), eind);
    const overgang = kiesOvergang(this._uitKenmerken(h, pos), this._inKenmerken(v));
    v.overgang = overgang;
    v.moment = this._moment(h, overgang.type, eind);
    v.uitV = h.verschuiving;
    // Klaarzetten: fader, bas en filter zoals de overgang begint; dezelfde crossfaderkant als de
    // uitgaande (anders valt hij weg achter de crossfader).
    this._zet(v.n, klaarStand(overgang.type));
    for (let i = 0; i < 2 && this._T(v.n).kant !== h.kant; i++) this._doe(`track.${v.n}.kant`, true);
    v.basis = {
      uitA: this.bus.lees(`track.${h.n}.send.a`) ?? 0, uitB: this.bus.lees(`track.${h.n}.send.b`) ?? 0,
      inA: this.bus.lees(`track.${v.n}.send.a`) ?? 0, inB: this.bus.lees(`track.${v.n}.send.b`) ?? 0,
    };
  }

  /**
   * Het moment: blend en filter op de klok (de uitgaande is gekoppeld: zijn plek is
   * grid.timeOf(klok-tel + v)), beatloos op de plek van de uitgaande.
   */
  _moment(h, type, eind) {
    const t = this.engine.straks();
    if (type !== 'ambient') {
      const v = h.verschuiving;
      return planMoment({ type, vroegst: this.klok.tel(t + VOORUIT), eind: h.grid.beatAt(eind) - v, perMaat: this.klok.perMaat });
    }
    const rate = h.snelheid(t) || h.pitchRate || 1;
    return planMoment({ type, vroegst: h.plek(t) + VOORUIT * rate, eind, rate });
  }

  /** Past de overgang nog vóór het einde van het nummer van de uitgaande? */
  _past(h, m) {
    const duur = h.nummer.duur;
    if (!m.opKlok) return m.start + m.lengte <= duur - 1;
    const v = h.verschuiving;
    if (v === null) return true;
    return h.grid.timeOf(m.start + m.lengte + v) <= duur - 1;
  }

  _klaar(h) {
    const v = this.volgende;
    const m = v.moment;
    const t = this.engine.straks();
    if (m.opKlok && h.verschuiving === null) {
      // De uitgaande loopt niet meer op de klok (Clay zette sync uit): opnieuw, dan beatloos.
      this._planOvergang();
      return;
    }
    if (m.opKlok) {
      const c = this.klok.tel(t);
      const per = this.klok.perMaat;
      // Clay verschoof de uitgaande op de klok (seek, jog, beatjump): zijn einde ligt op een andere tel.
      if (h.verschuiving !== v.uitV) { this._planOvergang(); return; }
      // Het moment gemist (een timer die haperde): de eerstvolgende 4-maatsgrens.
      if (v.overgang.type === 'blend' && c >= m.start - 0.05) { v.moment = this._zoSnel(m); return; }
      if (v.overgang.type === 'blend' && c >= m.start - 0.9 * per) {
        // In de laatste maat vóór het begin: op de maat starten, dan valt hij op de "1" die het begin IS.
        const r = this._doe(`track.${v.n}.play.quant`, true);
        if (r?.geweigerd) { this._meld(`track ${v.n}: ${r.geweigerd}`, 'fout'); v.overgang = { ...v.overgang, type: 'filter', naam: OVERGANGEN.filter.naam }; this._zet(v.n, klaarStand('filter')); return; }
        v.gestart = true;
        this._begin(v);
      } else if (v.overgang.type === 'filter' && c >= m.start) {
        this._begin(v);
      }
      return;
    }
    if (h.plek(t) >= m.start) { this._startIn(v); this._begin(v); }
  }

  _begin(v) {
    this.fase = 'bezig';
    this._gebeurd({ n: v.n, id: v.nummer.id, titel: v.nummer.titel, wat: 'overgang', soort: v.overgang.type });
    this.emit('verander');
  }

  /**
   * De nieuwe laten spelen buiten de maat om (beatloos, of meteen). Op de klok als dat kan:
   * zijn grid zeker en zijn tempo binnen TEMPO_MAX van de klok (dan op de "1", met sync);
   * anders vrij op zijn eigen tempo (een gekoppeld nummer op 25% ander tempo klinkt verstemd).
   */
  _startIn(v, { meteen = false } = {}) {
    const t = this._T(v.n);
    if (t.speelt || t.wacht !== null) return;
    const P = t.plek(this.engine.straks());
    const zeker = !!t.grid && t.maatZeker(P);
    const bpm = zeker ? t.grid.bpmAt(P) : null;
    const opKlok = zeker && this.klok.loopt && Math.abs(this.klok.bpm(this.engine.straks()) / bpm - 1) <= TEMPO_MAX;
    if (opKlok) {
      if (!t.sync) this._doe(`track.${v.n}.sync`, true);
      this._doe(`track.${v.n}.${meteen ? 'play' : 'play.quant'}`, true);
    } else {
      if (t.sync && this.klok.loopt) this._doe(`track.${v.n}.sync`, true);   // uit: vrij op zijn eigen tempo
      this._doe(`track.${v.n}.play`, true);
    }
    v.gestart = true;
  }

  _bezig(h) {
    const v = this.volgende;
    const m = v.moment;
    const t = this.engine.straks();
    const tel = this.klok.loopt ? this.klok.tel(t) : null;
    const p = this._klinkt(h) ? voortgang(m, { tel, plek: h.plek(t) }) : 1;
    // Filter-uit: de nieuwe start in de laatste maat op de maat, zodat hij op de "1" aan het eind invalt.
    if (v.overgang.type === 'filter' && !v.gestart && (p >= 1 || (tel !== null && tel >= m.start + m.lengte - 0.9 * this.klok.perMaat))) {
      const r = this._doe(`track.${v.n}.play.quant`, true);
      if (r?.geweigerd) this._startIn(v); else v.gestart = true;
    }
    if (p >= 1) { this._rondAf(); return; }
    const st = standen(v.overgang.type, p, v.basis);
    // De bas eerst, voor beide in dezelfde tik: uit dicht, dan in open (nooit twee bassen).
    this._zet(h.n, { laag: st.uit.laag });
    this._zet(v.n, { laag: st.in.laag });
    this._zet(h.n, st.uit);
    this._zet(v.n, st.in);
  }

  _rondAf() {
    const v = this.volgende;
    const h = this._T(this.hoofd);
    this._zet(h.n, { fader: 0, laag: 0.5, filter: 0.5, sendA: v.basis.uitA, sendB: v.basis.uitB });
    if (h.speelt) this._doe(`track.${h.n}.play`, true);          // play op een spelende track = pauze
    if (!v.gestart) this._startIn(v, { meteen: true });
    this._zet(v.n, { fader: 1, laag: 0.5, filter: 0.5, sendA: v.basis.inA, sendB: v.basis.inB });
    this._wordtHoofd(v);
  }

  /** Niets klinkt: de klaarstaande meteen, vol open. */
  _startMeteen() {
    const v = this.volgende;
    if (!v) { this.fase = 'wacht'; return; }
    this._zet(v.n, { fader: 1, laag: 0.5, filter: 0.5 });
    this._startIn(v, { meteen: true });
    this._wordtHoofd(v, { soort: 'start' });
  }

  /** De nieuwe klinkt nu alleen: hij wordt de hoofdtrack, en de volgende mag gekozen worden. */
  _wordtHoofd(v, { soort = v.overgang?.type ?? 'start' } = {}) {
    this.hoofd = v.n;
    this.eind = v.tot;
    this.gespeeld.add(v.nummer.id);
    this._gebeurd({ n: v.n, id: v.nummer.id, titel: v.nummer.titel, wat: 'gespeeld', soort, redenen: v.overgang?.redenen ?? [], langer: v.langer });
    this.emit('overgang', { n: v.n, titel: v.nummer.titel, soort: OVERGANGEN[soort]?.naam ?? soort });
    this.volgende = null;
    this.fase = 'wacht';
    this._klokVolgt(v.n);
    this.emit('verander');
  }

  /**
   * Speelt de nieuwe hoofdtrack vrij (zijn tempo lag te ver van de klok) en hoort niemand een
   * ander gekoppeld nummer, dan volgt de klok hem (track.N.sync.klok: de klok glijdt naar hem,
   * het nummer verspringt niet). Zonder dit bleef het na één beatloze overgang beatloos.
   */
  _klokVolgt(n) {
    const t = this._T(n);
    if (!t.grid || !this.klok.loopt) return;
    const s = this.engine.straks();
    const P = t.plek(s);
    if (t.gekoppeldOp(s) || t.wacht !== null || !t.speeltOp(s) || !t.maatZeker(P)) return;
    if (this._tracks.some((x) => x.n !== n && x.gekoppeld && this.engine.hoorbaar(x.n))) return;
    this._doe(`track.${n}.sync.klok`, true);
  }

  /** Na Clay's overname: wachten tot er één track duidelijk klinkt, dan die als hoofd. */
  _naOvername() {
    const mag = (t) => t.n === this.hoofd || t.n === this.volgende?.n || this.eigen.has(t.n) || !this._vanClay(t.n);
    const klinkend = this._tracks.filter((t) => this._klinkt(t) && this.engine.zaalVersterking(t.n) > DUIDELIJK);
    // Nooit stilte: klinkt er helemaal niets meer, dan meteen verder.
    if (!klinkend.length) {
      this.hoofd = null;
      this.volgende = null;
      this.fase = 'wacht';
      this._meld('alles is stil: ik ga verder');
      this.emit('verander');
      this._bereidVoor({ meteen: true });
      return;
    }
    // Alleen de tracks van de automaat tellen: een acapella die Clay op zijn eigen track speelt liet
    // v1 anders eeuwig wachten (S9). Klinkt alleen iets van Clay, dan is het niet stil: wachten.
    const mijn = klinkend.filter(mag);
    if (mijn.length !== 1) return;
    this._neemAlsHoofd(mijn[0].n);
    this.volgende = null;
    this.fase = 'wacht';
    this._gebeurd({ n: mijn[0].n, id: mijn[0].nummer.id, wat: 'verder na overname' });
    this._meld(`verder vanaf track ${mijn[0].n}`);
    this.emit('verander');
  }

  // ---- sturen ------------------------------------------------------------------------------

  _doe(id, v) {
    if (!this.bus.heeft(id)) return { geweigerd: `${id} bestaat niet` };
    return this.bus.doe(id, v, { bron: 'auto' });
  }

  /**
   * Alleen zetten wat echt verandert (de strip glijdt zelf naar elke waarde): een stap per
   * tik zou het log vullen met ruis. Een send die de strip niet heeft (lees() = null) blijft weg.
   */
  _zet(n, stand) {
    for (const [k, actie] of KNOPPEN) {
      const doel = stand[k];
      if (!eindig(doel)) continue;
      const id = `track.${n}.${actie}`;
      if (!this.bus.heeft(id)) continue;
      const nu = this.bus.lees(id);
      if (nu === null && k.startsWith('send')) continue;
      const exact = doel === 0 || doel === 0.5 || doel === 1;
      if (!eindig(nu) || Math.abs(nu - doel) >= MIN_STAP || (exact && nu !== doel)) this._doe(id, doel);
    }
  }

  _gebeurd(g) {
    this.geschiedenis.push({ ...g, t: this.engine.nu() });
    if (this.geschiedenis.length > 200) this.geschiedenis.shift();
  }

  _meld(tekst, soort = 'info') {
    this.melding = { tekst, soort };
    this.engine.meld?.(`auto-dj: ${tekst}`, soort, 'auto');
    this.emit('melding', this.melding);
  }

  // ---- voor het scherm ------------------------------------------------------------------------

  /** Wat klinkt, wat komt en waarom. */
  stand() {
    const nu = this.engine.straks();
    const h = this.hoofd ? this._T(this.hoofd) : null;
    const v = this.volgende;
    const rate = h?.geladen ? (h.snelheid(nu) || 1) : 1;
    let over = null, maten = null, gang = null;
    if (h?.geladen && v?.moment) {
      const m = v.moment;
      if (m.opKlok && this.klok.loopt) {
        const c = this.klok.tel(nu);
        over = Math.max(0, this.klok.tijd(m.start) - nu);
        maten = Math.max(0, Math.ceil((m.start - c) / this.klok.perMaat - 1e-9));
        gang = (c - m.start) / m.lengte;
      } else if (!m.opKlok) {
        over = Math.max(0, (m.start - h.plek(nu)) / rate);
        gang = (h.plek(nu) - m.start) / m.lengte;
      }
    }
    return {
      aan: this.actief, fase: this.fase,
      nu: h?.geladen ? { n: h.n, titel: h.nummer.titel, rest: eindig(this.eind) ? Math.max(0, (this.eind - h.plek(nu)) / rate) : null } : null,
      volgende: v ? {
        n: v.n, titel: v.nummer.titel, bron: v.bron, waarom: v.waarom, bevestigd: v.bevestigd,
        soort: v.overgang?.naam ?? null, type: v.overgang?.type ?? null, redenen: v.overgang?.redenen ?? [],
        toon: toonNaam(leesToon(v.nummer.toon ?? null)), over, maten,
        voortgang: this.fase === 'bezig' && gang !== null ? Math.min(1, Math.max(0, gang)) : null,
        langer: v.langer, nu: v.nu,
      } : null,
      melding: this.melding,
    };
  }
}
