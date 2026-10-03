import { Emitter } from '../lib/emitter.js';
import { normaliseerPlan } from '../plan/plan-model.js';
import { DECK_IDS } from '../engine/engine.js';
import { kortNaam } from '../engine/toonsoort.js';
import {
  OVERGANGEN, SPEELDUUR, VOORUIT, fragment, kenmerken, kiesVolgende, kiesOvergang, planMoment, standen, klaarStand,
} from './planner.js';

/**
 * De auto-DJ, het uitvoeren (docs/AUTO-DJ.md). Hij bedient Varve zoals Clay
 * dat doet: via de action-bus, dus alles staat in het handelingenlog en
 * speelt terug. Laden gaat via de laadlaag (dat is geen action).
 *
 * De drie partijen:
 *   - de app (dit + planner.js): beslist snel en volgens vaste regels, zodat
 *     het altijd klinkt, ook zonder plan en zonder internet;
 *   - Clay: ok / overslaan / langer / nu, en wie een fader, EQ, filter of play
 *     van een track in de overgang aanraakt, NEEMT DE OVERGANG OVER: de
 *     automaat laat los en gaat verder als er weer één track speelt;
 *   - Claude: schrijft een setplan (plannen/auto-plan.json): volgorde,
 *     beginpunten, soort overgang, waarom. De bewakers van de planner gaan
 *     daar altijd voor.
 *
 * Fasen: uit → wacht (niets klaar) → laden → klaar (volgende staat stil
 * klaar, het moment ligt vast) → bezig (overgang loopt) → wacht …
 * 'overgenomen': Clay deed het; wachten tot er één track overblijft.
 *
 * Regel 3: waar de overgang is komt van de POSITIE van de uitgaande (de
 * audioklok); de timer beslist alleen wanneer er gekeken wordt.
 */

const ZELF = Symbol('auto');
/** Actions waarmee Clay een overgang overneemt (op een track in de overgang). */
const OVERNEEM = /^track\.(\d)\.(fader|low|mid|high|filter|play|play\.quant|sync|seek|tempo|pitch|send\.[ab]|kill\.\w+(\.hold)?|stem\.(vocals|inst|drums|bass|other)(\.(kill|hold))?|brake|cue|hotcue\.\d)$/;
const nrVan = (id) => DECK_IDS.indexOf(id) + 1;
const deckVanNr = (nr) => DECK_IDS[nr - 1];
const eindig = (x) => typeof x === 'number' && Number.isFinite(x);

export class Automaat extends Emitter {
  /**
   * @param engine      alleen LEZEN (posities, grids, toon, snapshot)
   * @param invoke      de bus
   * @param bijInvoke   meeluisteren op de bus (om over te nemen)
   * @param laad        (deckId, track) => Promise: een library-nummer laden
   * @param haalLibrary () => Promise<tracks[]>
   * @param haalPlan    () => Promise<plan|{ plan, versie }|null> (v1 of v2, zie plan-model.js)
   * @param welkNummer  (deckId) => library-id van wat er op een track staat (of null)
   */
  constructor({ engine, invoke, bijInvoke = () => () => {}, laad, haalLibrary, haalPlan = async () => null,
    welkNummer = () => null, rnd = Math.random, tik = 40 } = {}) {
    super();
    Object.assign(this, { engine, _invoke: invoke, laad, haalLibrary, haalPlan, welkNummer, rnd, tikMs: tik });
    this.aan = false;
    this.fase = 'uit';
    this.hoofd = null;            // deckId van wat nu klinkt
    this.eind = null;             // tracktijd waar de hoofdtrack klaar moet zijn
    this.volgende = null;         // { deckId, track, van, tot, overgang, moment, basis, bron, waarom, bevestigd, gestart }
    this.plan = null;
    this.planVersie = null;
    this.planIndex = 0;          // de eerstvolgende stap van het plan die nog klaargezet moet worden
    this.hoofdStap = null;       // id van de planstap die nu klinkt (null: iets van de kiezer of van Clay)
    this.hoofdVan = null;        // beginpunt (tracktijd) van wat nu klinkt: voor een nieuwe speelduur
    this.geschiedenis = [];      // wat er echt gebeurde, voor de planpagina (nieuwste achteraan)
    this.gespeeld = new Set();
    this.overgeslagen = new Set();
    this.tracks = [];
    this.nummers = {};            // deckId -> library-nummer dat de automaat daar laadde
    this.eigen = new Set();       // decks die de automaat gebruikt
    this.melding = null;
    this._zelf = false;
    this._bezigLaden = false;
    this._timer = null;
    this._los = bijInvoke((id) => this._bijBus(id));
  }

  // ---- aan en uit ------------------------------------------------------------

  async zetAan(aan = !this.aan) {
    if (!aan) { this._stop(); return; }
    if (this.aan) return;
    this.aan = true;
    this.fase = 'wacht';
    this.melding = null;
    try {
      const [tracks, p] = await Promise.all([this.haalLibrary(), this.haalPlan().catch(() => null)]);
      this.tracks = tracks;
      this._zetPlan(p);
    } catch (err) {
      this._meld(`library niet gelezen: ${err.message}`, 'fout');
      this._stop();
      return;
    }
    this.planIndex = 0;
    if (!this.tracks.length) { this._meld('de library is leeg', 'fout'); this._stop(); return; }
    this.hoofd = this._luidste();
    if (this.hoofd) {
      const d = this.engine.deck(this.hoofd);
      this.eind = Math.min(d.duration - 6, d.position + SPEELDUUR * d.rate);
      const id = this.welkNummer(this.hoofd);
      if (id) this.gespeeld.add(id);
    }
    this._timer = setInterval(() => this.tik(), this.tikMs);
    this._timer.unref?.();
    this.emit('change');
    this.tik();
  }

  _stop() {
    this.aan = false;
    this.fase = 'uit';
    clearInterval(this._timer);
    this._timer = null;
    this.emit('change');
  }

  vernietig() { this._stop(); this._los?.(); }

  // ---- Clay grijpt in -------------------------------------------------------

  /** Bevestigen: niets verandert, maar het staat vast (en in het log). */
  ok() { if (this.volgende) { this.volgende.bevestigd = true; this.emit('change'); } }

  /** Deze niet: de volgende kandidaat. Tijdens de overgang kan dat niet meer. */
  overslaan() {
    if (!this.volgende || this.fase === 'bezig') return;
    this.overgeslagen.add(this.volgende.track.id);
    this._gebeurd({ stap: this.volgende.stapId, track: this.volgende.track.id, titel: this.volgende.track.titel, wat: 'overgeslagen' });
    if (this.volgende.bron === 'plan') this.planIndex = this._index(this.volgende.stapId) + 1 || this.planIndex + 1;
    this.volgende = null;
    this.fase = 'wacht';
    this.emit('change');
  }

  /** Nog 8 maten (of 30 s bij beatloos) langer op de huidige. */
  langer() {
    const v = this.volgende;
    if (!v?.moment || this.fase !== 'klaar') return;
    const d = this.engine.deck(this.hoofd);
    const g = v.overgang.type === 'ambient' ? null : d.grid;
    const extra = g ? g.timeOf(v.moment.tel + 8 * g.beatsPerBar) - v.moment.start : 30 * d.rate;
    if (v.moment.start + extra + v.moment.lengte > d.duration - 2) { this._meld('langer kan niet: de track is bijna op'); return; }
    this.eind += extra;
    v.langer = (v.langer || 0) + 1;
    // Precies 8 maten later (niet opnieuw op een 16-maatsgrens: dat werd 16).
    if (g) {
      const tel = v.moment.tel + 8 * g.beatsPerBar;
      v.moment = { ...v.moment, tel, start: g.timeOf(tel), lengte: g.timeOf(tel + v.moment.maten * g.beatsPerBar) - g.timeOf(tel) };
    } else {
      v.moment = { ...v.moment, start: v.moment.start + extra };
    }
    this.emit('change');
  }

  /** Zo snel het mooi kan: de eerstvolgende 4-maatsgrens (beatloos: meteen). */
  nu() {
    const v = this.volgende;
    if (!v || this.fase !== 'klaar') return;
    const d = this.engine.deck(this.hoofd);
    const g = v.overgang.type === 'ambient' ? null : d.grid;
    const vooruit = g ? 1.5 : 0.5;
    this.eind = d.position + vooruit * d.rate + (v.moment?.lengte ?? 0);
    v.moment = planMoment({ type: v.overgang.type, grid: g, positie: d.position, eind: this.eind, rate: d.rate, vooruit });
    if (g) {
      // Eerstvolgende 4-maatsgrens, niet de laatste vóór `eind`.
      const bpb = g.beatsPerBar;
      const b = g.volgendeVeelvoud(g.beatAt(d.position + vooruit * d.rate), 4 * bpb);
      const tellen = v.moment.maten * bpb;
      v.moment = { ...v.moment, tel: b, start: g.timeOf(b), lengte: g.timeOf(b + tellen) - g.timeOf(b) };
    }
    this.emit('change');
  }

  /** Iemand anders (Clay, MIDI, muis, toetsenbord) raakte de bus aan. */
  _bijBus(id) {
    if (this._zelf || !this.aan) return;
    const m = OVERNEEM.exec(id);
    const deck = m ? deckVanNr(Number(m[1])) : null;
    const raakt = deck && (deck === this.hoofd || deck === this.volgende?.deckId);
    if (id === 'mixer.xfader' || raakt) {
      if (this.fase === 'bezig' || (this.fase === 'klaar' && deck === this.volgende?.deckId)) {
        this.fase = 'overgenomen';
        this._meld('je nam de overgang over — ik ga verder als er weer één track speelt');
        this.emit('change');
      }
    }
  }

  // ---- de lus ----------------------------------------------------------------

  tik() {
    if (!this.aan) return;
    try { this._tik(); } catch (err) { console.error('[auto]', err); this._meld(`auto-dj: ${err.message}`, 'fout'); }
  }

  _tik() {
    if (this.fase === 'overgenomen') { this._naOvername(); return; }
    const d = this.hoofd ? this.engine.deck(this.hoofd) : null;

    // Niets speelt (begin, of de track is op): meteen iets laten klinken.
    if (!d || !d.buffer || (!d.playing && !d.wacht && this.fase !== 'bezig')) {
      if (this.fase === 'klaar') { this._startMeteen(); return; }
      if (this.fase === 'wacht' && !this._bezigLaden) this._bereidVoor({ meteen: true });
      return;
    }
    if (this.fase === 'wacht' && !this._bezigLaden) { this._bereidVoor(); return; }
    if (this.fase === 'klaar') { this._klaar(d); return; }
    if (this.fase === 'bezig') this._bezig(d);
  }

  /** De volgende kiezen en klaarzetten (stil, fader dicht, op zijn beginpunt). */
  async _bereidVoor({ meteen = false } = {}) {
    this._bezigLaden = true;
    this.fase = 'laden';
    this.emit('change');
    try {
      const keuze = this._kies();
      if (!keuze) { this._meld('niets meer om te spelen', 'fout'); this._stop(); return; }
      const deckId = this._vrijDeck();
      if (!deckId) { this._meld('geen vrije track om te laden', 'fout'); this.fase = 'wacht'; return; }
      await this.laad(deckId, keuze.track);
      if (!this.aan) return;
      const nd = this.engine.deck(deckId);
      if (!nd.buffer) throw new Error(`${keuze.track.titel} laadde niet`);
      this.nummers[deckId] = keuze.track;
      this.eigen.add(deckId);
      // Beginnen op een maatbegin van de nieuwe als zijn grid daar zeker is.
      let van = keuze.van;
      if (nd.grid && nd.grid.zekerBij(van)) van = nd.grid.timeOf(nd.grid.volgendeVeelvoud(nd.grid.beatAt(van), nd.grid.beatsPerBar));
      this._doe(`track.${nrVan(deckId)}.seek`, nd.duration ? van / nd.duration : 0);
      this.volgende = { deckId, track: keuze.track, van, tot: keuze.tot, bron: keuze.bron, waarom: keuze.waarom,
        stapId: keuze.stapId ?? null, voorkeur: keuze.overgang, lengte: keuze.lengte ?? null,
        bevestigd: false, gestart: false, overgang: null, moment: null };
      if (meteen || !this.hoofd || !this.engine.deck(this.hoofd).playing) { this.fase = 'klaar'; this._startMeteen(); return; }
      this._planOvergang(keuze.overgang);
      this.fase = 'klaar';
    } catch (err) {
      this._meld(`laden mislukt: ${err.message}`, 'fout');
      this.fase = 'wacht';
    } finally {
      this._bezigLaden = false;
      this.emit('change');
    }
  }

  /** Uit het plan (overgeslagen en onbekende nummers overslaan), anders de kiezer. */
  _kies() {
    const stappen = this.plan?.stappen || [];
    while (this.planIndex < stappen.length) {
      const s = stappen[this.planIndex];
      const track = this.tracks.find((t) => t.id === s.track);
      if (track && !this.overgeslagen.has(track.id) && track.id !== this.welkNummer(this.hoofd)) {
        const f = fragment(track, { van: s.van ?? null, speelduur: s.speelduur ?? null, rnd: this.rnd });
        return { track, ...f, bron: 'plan', stapId: s.id, overgang: s.overgang || 'auto', lengte: s.lengte ?? null, waarom: s.waarom || '' };
      }
      this.planIndex++;
    }
    const huidig = this._huidigKenmerk();
    const gespeeld = new Set([...this.gespeeld, ...this.overgeslagen]);
    const k = kiesVolgende({ huidig, tracks: this.tracks, gespeeld, rnd: this.rnd });
    if (!k) return null;
    const f = fragment(k.track, { rnd: this.rnd });
    return { track: k.track, ...f, bron: 'kiezer', overgang: 'auto', waarom: k.redenen.join(', ') };
  }

  _huidigKenmerk() {
    if (!this.hoofd) return null;
    const d = this.engine.deck(this.hoofd);
    const id = this.welkNummer(this.hoofd);
    const t = this.tracks.find((x) => x.id === id);
    const pos = eindig(this.eind) ? this.eind : d.position;
    const h = d.toonKaart?.hoorbaarBij(pos, { rate: d.rate, transpositie: d.transpositie, keylock: d.keylock });
    return { trackId: id, bpm: d.grid ? d.grid.bpmAt(pos) * d.rate : null, k: h?.k ?? null,
      toonZeker: h?.soort === 'zeker', loudness: t?.loudness_i ?? null };
  }

  /** De soort overgang en het moment, met de bewakers. */
  _planOvergang(voorkeur = 'auto') {
    const v = this.volgende;
    const d = this.engine.deck(this.hoofd);
    const nd = this.engine.deck(v.deckId);
    const pos = Math.max(d.position, Math.min(this.eind, d.duration - 6));
    const h = d.toonKaart?.hoorbaarBij(pos, { rate: d.rate, transpositie: d.transpositie, keylock: d.keylock });
    const uit = { grid: d.grid, gridZeker: !!d.grid && d.grid.zekerBij(pos), bpm: d.grid ? d.grid.bpmAt(pos) * d.rate : null,
      k: h?.k ?? null, toonZeker: h?.soort === 'zeker' };
    const kIn = kenmerken(v.track, v.van);
    const inn = { ...kIn, grid: nd.grid, gridZeker: !!nd.grid && nd.grid.zekerBij(v.van), bpm: nd.grid ? nd.grid.bpmAt(v.van) : kIn.bpm };
    v.overgang = kiesOvergang(uit, inn, { voorkeur });
    const g = v.overgang.type === 'ambient' ? null : d.grid;
    this.eind = Math.min(this.eind ?? d.duration, d.duration - 6);
    v.moment = planMoment({ type: v.overgang.type, grid: g, positie: d.position, eind: this.eind, rate: d.rate, vooruit: Math.min(VOORUIT, 8), lengte: v.lengte });
    // Klaarzetten: fader, bas, filter zoals de overgang begint; dezelfde
    // crossfaderkant als de uitgaande (anders valt hij weg achter de crossfader).
    const n = nrVan(v.deckId);
    const s = klaarStand(v.overgang.type);
    this._doe(`track.${n}.fader`, s.fader);
    this._doe(`track.${n}.low`, s.low);
    this._doe(`track.${n}.filter`, s.filter);
    const kant = this.engine.kant[this.hoofd];
    this._doe(`track.${n}.xfade.${String(kant).toLowerCase()}`, true);
    v.basis = {
      uitA: d.ui.sendA ?? 0, uitB: d.ui.sendB ?? 0,
      inA: nd.ui.sendA ?? 0, inB: nd.ui.sendB ?? 0,
    };
  }

  _klaar(d) {
    const v = this.volgende;
    const m = v.moment;
    // Een tel vóór het begin: blend = sync en start op de maat, beatloos = meteen.
    const maat = d.grid ? d.grid.beatLengthAt(d.position) * d.grid.beatsPerBar : 2;
    // De track is korter geworden (tempo) of het moment is voorbij: opnieuw plannen.
    if (m.start + m.lengte > d.duration - 1) this._planOvergang(v.overgang.type);
    if (v.overgang.type === 'blend' && d.position >= m.start - maat * 0.9) {
      this._doe(`track.${nrVan(v.deckId)}.sync`, true);
      this._doe(`track.${nrVan(v.deckId)}.play.quant`, true);
      v.gestart = true;
      this.fase = 'bezig';
    } else if (v.overgang.type === 'ambient' && d.position >= m.start) {
      this._doe(`track.${nrVan(v.deckId)}.play`, true);
      v.gestart = true;
      this.fase = 'bezig';
    } else if (v.overgang.type === 'filter' && d.position >= m.start) {
      this.fase = 'bezig';
    }
    if (this.fase === 'bezig') this.emit('change');
  }

  _bezig(d) {
    const v = this.volgende;
    const m = v.moment;
    const p = d.playing ? (d.position - m.start) / m.lengte : 1;
    const st = standen(v.overgang.type, p, v.basis);
    const uitN = nrVan(this.hoofd), inN = nrVan(v.deckId);
    // Filter: de nieuwe start op de laatste maat, zodat hij op de "1" invalt.
    if (v.overgang.type === 'filter' && !v.gestart && d.grid) {
      const maat = d.grid.beatLengthAt(d.position) * d.grid.beatsPerBar;
      if (d.position >= m.start + m.lengte - maat * 0.9 || !d.playing) {
        this._doe(`track.${inN}.play.quant`, true);
        v.gestart = true;
      }
    }
    this._zet(uitN, st.uit, this.hoofd);
    this._zet(inN, st.in, v.deckId);
    if (p >= 1) this._rondAf();
  }

  /** Alleen zetten wat echt verandert: een stap per tik vult het log anders met ruis. */
  _zet(n, stand, deckId) {
    const d = this.engine.deck(deckId);
    for (const [k, actie] of [['fader', 'fader'], ['low', 'low'], ['filter', 'filter'], ['sendA', 'send.a'], ['sendB', 'send.b']]) {
      const doel = stand[k];
      if (!eindig(doel)) continue;
      const nu = d.ui[k];
      if (!eindig(nu) || Math.abs(nu - doel) >= 0.01 || (doel === 0 && nu !== 0) || (doel === 1 && nu !== 1)) this._doe(`track.${n}.${actie}`, doel);
    }
  }

  _rondAf() {
    const v = this.volgende;
    const uit = this.hoofd, uitN = nrVan(uit);
    const d = this.engine.deck(uit);
    if (d.playing) this._doe(`track.${uitN}.play`, true);
    this._zet(uitN, { fader: 0, low: 0.5, filter: 0.5, sendA: v.basis.uitA, sendB: v.basis.uitB }, uit);
    this._zet(nrVan(v.deckId), { fader: 1, low: 0.5, filter: 0.5, sendA: v.basis.inA, sendB: v.basis.inB }, v.deckId);
    this._wordtHoofd(v);
  }

  /** De nieuwe klinkt nu alleen: hij wordt de hoofdtrack, en de volgende mag gekozen worden. */
  _wordtHoofd(v) {
    this.hoofd = v.deckId;
    this.eind = v.tot;
    this.hoofdVan = v.van;
    this.hoofdStap = v.stapId ?? null;
    this.gespeeld.add(v.track.id);
    if (v.bron === 'plan') { const i = this._index(v.stapId); this.planIndex = i >= 0 ? i + 1 : this.planIndex + 1; }
    this._gebeurd({ stap: v.stapId ?? null, track: v.track.id, titel: v.track.titel, deck: nrVan(v.deckId), bron: v.bron, wat: 'gespeeld',
      van: v.van, gevraagd: v.voorkeur ?? null, gekozen: v.overgang?.type ?? 'start', redenen: v.overgang?.redenen ?? [], langer: v.langer || 0 });
    this.emit('overgang', { naar: nrVan(v.deckId), titel: v.track.titel, soort: v.overgang?.naam ?? 'start' });
    this.volgende = null;
    this.fase = 'wacht';
    this.emit('change');
  }

  /** Niets klinkt: de klaarstaande meteen, vol open. */
  _startMeteen() {
    const v = this.volgende;
    if (!v) { this.fase = 'wacht'; return; }
    const n = nrVan(v.deckId);
    this._zet(n, { fader: 1, low: 0.5, filter: 0.5 }, v.deckId);
    const nd = this.engine.deck(v.deckId);
    if (!nd.playing) this._doe(`track.${n}.play`, true);
    this._wordtHoofd(v);
  }

  /** Na Clay's overname: wachten tot er één track duidelijk klinkt, dan die als hoofd. */
  _naOvername() {
    const spelend = DECK_IDS.map((id) => this.engine.deck(id)).filter((d) => d.playing && d.ui.fader > 0.05);
    if (spelend.length !== 1) return;
    const d = spelend[0];
    this.hoofd = d.id;
    this.eind = Math.min(d.duration - 6, d.position + SPEELDUUR * d.rate);
    this.hoofdVan = d.position;
    const id = this.welkNummer(d.id);
    if (id) this.gespeeld.add(id);
    // Is wat nu klinkt een stap van het plan? Dan gaat het plan daarna verder.
    const i = id ? (this.plan?.stappen || []).findIndex((s, k) => k >= this.planIndex - 1 && s.track === id) : -1;
    this.hoofdStap = i >= 0 ? this.plan.stappen[i].id : null;
    if (i >= 0) this.planIndex = i + 1;
    this._gebeurd({ stap: this.hoofdStap, track: id, titel: d.title, deck: nrVan(d.id), bron: 'clay', wat: 'overgenomen' });
    this.volgende = null;
    this.fase = 'wacht';
    this._meld(`verder vanaf track ${nrVan(d.id)}`);
    this.emit('change');
  }

  // ---- het plan ---------------------------------------------------------------

  /** Een plan (v1/v2, of { plan, versie }) netjes zetten, zonder iets te herplannen. */
  _zetPlan(p) {
    const ruw = p && p.plan && Array.isArray(p.plan.stappen) ? p.plan : p;
    this.plan = ruw ? normaliseerPlan(ruw).plan : null;
    this.planVersie = p?.versie ?? null;
  }

  _index(stapId) { return stapId ? (this.plan?.stappen || []).findIndex((s) => s.id === stapId) : -1; }

  /**
   * Een nieuw plan terwijl hij speelt (de planpagina of Claude sloeg op). Wat
   * klinkt blijft klinken; wat een overgang is die al loopt, loopt door. Het
   * plan gaat verder na de stap die nu klinkt (op id). Staat de volgende al
   * klaar en is die stap veranderd (ander nummer of beginpunt, of weg), dan
   * wordt hij opnieuw gekozen; alleen de overgang anders: opnieuw gepland.
   * Een nieuwe speelduur van wat nu klinkt verschuift het einde.
   */
  vervangPlan(p) {
    const oudeVolgende = this.volgende;
    this._zetPlan(p);
    if (!this.plan) { this.planIndex = 0; this.emit('change'); return; }
    const i = this._index(this.hoofdStap);
    if (i >= 0) this.planIndex = i + 1;
    else this.planIndex = Math.min(this.planIndex, this.plan.stappen.length);
    // Nieuwe speelduur van wat nu klinkt.
    const nu = i >= 0 ? this.plan.stappen[i] : null;
    if (nu && this.hoofd && this.fase !== 'bezig' && Number.isFinite(this.hoofdVan)) {
      const d = this.engine.deck(this.hoofd);
      const tot = nu.speelduur ? this.hoofdVan + nu.speelduur : null;
      if (tot !== null) this.eind = Math.max(d.position + 4 * d.rate, Math.min(d.duration - 6, tot));
    }
    if (this.aan && oudeVolgende && this.fase === 'klaar' && oudeVolgende.bron === 'plan') {
      const s = this.plan.stappen[this.planIndex];
      const zelfde = s && s.id === oudeVolgende.stapId && s.track === oudeVolgende.track.id
        && (s.van === null || Math.abs(s.van - oudeVolgende.van) < 1);
      if (!zelfde) {
        this.volgende = null;
        this.fase = 'wacht';
      } else {
        oudeVolgende.voorkeur = s.overgang;
        oudeVolgende.lengte = s.lengte ?? null;
        oudeVolgende.waarom = s.waarom || oudeVolgende.waarom;
        if (s.speelduur) oudeVolgende.tot = oudeVolgende.van + s.speelduur;
        this._planOvergang(s.overgang);
      }
    } else if (this.aan && this.fase === 'klaar' && oudeVolgende) {
      this._planOvergang(oudeVolgende.voorkeur ?? 'auto');
    }
    this.emit('change');
  }

  _gebeurd(g) {
    this.geschiedenis.push({ ...g, t: this.engine.ctx.currentTime });
    if (this.geschiedenis.length > 500) this.geschiedenis.shift();
  }

  // ---- hulp ------------------------------------------------------------------

  _doe(id, waarde) {
    this._zelf = true;
    try { this._invoke(id, waarde); } finally { this._zelf = false; }
  }

  /** De luidste track die speelt (fader × crossfader), of null. */
  _luidste() {
    let beste = null, max = 0.02;
    for (const id of DECK_IDS) {
      const d = this.engine.deck(id);
      if (!d.playing) continue;
      const g = d.ui.fader * this.engine.xfadeGain(id);
      if (g > max) { max = g; beste = id; }
    }
    return beste;
  }

  /**
   * Een track om te laden: een die de automaat al gebruikte (heen en weer
   * tussen twee, zoals een DJ met twee decks), dan een lege, dan een stille.
   * Nooit de hoofdtrack, nooit iets wat speelt.
   */
  _vrijDeck() {
    const vrij = DECK_IDS.filter((id) => id !== this.hoofd && !this.engine.deck(id).playing && !this.engine.deck(id).wacht);
    return vrij.find((id) => this.eigen.has(id))
      || vrij.find((id) => !this.engine.deck(id).buffer)
      || vrij[vrij.length - 1] || null;
  }

  _meld(tekst, soort = 'info') {
    this.melding = { tekst, soort };
    this.emit('melding', { tekst, soort });
  }

  /** Voor het scherm. */
  stand() {
    const d = this.hoofd ? this.engine.deck(this.hoofd) : null;
    const v = this.volgende;
    const uitRate = d?.rate || 1;
    let over = null, maten = null;
    if (d && v?.moment && this.fase === 'klaar') {
      over = Math.max(0, (v.moment.start - d.position) / uitRate);
      if (d.grid && v.overgang.type !== 'ambient') maten = Math.max(0, Math.ceil((d.grid.beatAt(v.moment.start) - d.grid.beatAt(d.position)) / d.grid.beatsPerBar));
    }
    const voortgang = d && v?.moment && this.fase === 'bezig' ? Math.min(1, Math.max(0, (d.position - v.moment.start) / v.moment.lengte)) : null;
    return {
      aan: this.aan, fase: this.fase,
      nu: d?.buffer ? { nr: nrVan(this.hoofd), titel: d.title || this.nummers[this.hoofd]?.titel || '', rest: eindig(this.eind) ? Math.max(0, (this.eind - d.position) / uitRate) : null } : null,
      volgende: v ? {
        nr: nrVan(v.deckId), titel: v.track.titel, bron: v.bron, waarom: v.waarom, bevestigd: v.bevestigd,
        soort: v.overgang?.naam ?? null, type: v.overgang?.type ?? null, redenen: v.overgang?.redenen ?? [],
        toon: kortNaam(kenmerken(v.track, v.van).k), over, maten, voortgang,
      } : null,
      plan: this.plan ? { naam: this.plan.naam || 'plan', stap: Math.min(this.planIndex + 1, this.plan.stappen?.length ?? 0), totaal: this.plan.stappen?.length ?? 0,
        versie: this.planVersie, index: this.planIndex, hoofdStap: this.hoofdStap, volgendeStap: v?.stapId ?? null } : null,
      melding: this.melding,
    };
  }
}

export { OVERGANGEN };
