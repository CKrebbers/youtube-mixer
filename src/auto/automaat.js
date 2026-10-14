import { Emitter } from '../lib/emitter.js';
import { normaliseerPlan } from '../plan/plan-model.js';
import { DECK_IDS } from '../engine/engine.js';
import { GLIJ } from '../engine/deck.js';
import { kortNaam } from '../engine/toonsoort.js';
import { SectieKaart } from '../engine/secties.js';
import { metaOf as busMeta } from '../control/actions.js';
import {
  OVERGANGEN, SPEELDUUR, VOORUIT, fragment, kenmerken, kiesVolgende, kiesOvergang, planMoment, standen, klaarStand,
  sectiesVan, sectieGrens, sectieNaam, momentArgs, vindSectie,
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
const OVERNEEM = /^track\.(\d)\.(fader|low|mid|high|filter|play|play\.quant|sync|seek|tempo|pitch|send\.[ab]|kill\.\w+(\.hold)?|stem\.(vocals|inst|drums|bass|other)(\.(kill|hold|filter|send\.[ab]))?|brake|cue|hotcue\.\d|section\.(\d+(\.loop)?|next|prev)|load\.selected)$/;
/**
 * Neemt Clay hiermee over (OVERNEEM, of `meta.overneem === true` in de define()
 * van de action, 14 okt werkruimte S0)? Geeft { nr } (tracknummer uit de id,
 * of null als de action bij geen track hoort: dan telt hij als de crossfader,
 * hij raakt elke overgang) of null. Zo hoeft een nieuw spoor de regex niet aan te raken.
 */
export function neemtOver(id, metaOf = busMeta) {
  const m = OVERNEEM.exec(id);
  if (m) return { nr: Number(m[1]) };
  if (metaOf?.(id)?.overneem !== true) return null;
  const t = /^track\.(\d)\./.exec(id);
  return { nr: t ? Number(t[1]) : null };
}
/** Een sectiesprong (docs/SECTIES.md): op de track die nu klinkt verspringt de positie, dus opnieuw plannen. */
const SECTIE = /^track\.\d\.section\./;

/**
 * Springt deze sectie-action echt op deck `d`? Een pad zonder sectie (op de
 * Maschine bij 7 secties 9 van de 16 pads), een track zonder kaart, of
 * volgende/vorige aan het eind: de bus meldt alleen waarom niet, er springt
 * niets. Dan is het geen overname en geen nieuwe planning. (De luisteraar op
 * de bus hoort de druk vóór de action, en vóór die melding.)
 */
function sectieSpringt(d, id) {
  const k = d?.buffer ? d.sectieKaart : null;
  const m = k ? /\.section\.(\d+|next|prev)/.exec(id) : null;
  if (!m) return false;
  if (m[1] === 'next' || m[1] === 'prev') {
    const i = d.sectieOpDeMaat + (m[1] === 'next' ? 1 : -1);
    return i >= 0 && i < k.aantal;
  }
  return Number(m[1]) <= k.aantal;
}
/** Zo lang (ms) wacht het klaarzetten op de sectiekaart van de nieuwe (laden.js haalt hem pas NA het laden). */
const WACHT_SECTIES = 3000;
/** "nu" en "langer" mogen naar de volgende sectiegrens als die binnen zoveel maten komt (beatloos: seconden). */
const NU_SECTIE_MATEN = 8, LANGER_SECTIE_MATEN = 16, LANGER_SECTIE_SEC = 60;
/** Zo ver (s klok) vooruit plant _planOvergang; ook de marge waarbinnen een late kaart het moment niet meer verschuift. */
const VOORUIT_KLAAR = Math.min(VOORUIT, 8);
/** Een late kaart verschuift het moment niet meer binnen zoveel maten vóór de start (of VOORUIT_KLAAR, wat langer is). */
const HERPLAN_MATEN = 2;
/** Zo ver (s tracktijd) moet de positie na een sectiedruk afwijken van gewoon doorspelen om als sprong te tellen. */
const SPRONG_MIN = 0.1;
/** Zo ruim (s klok) vóór het moment zonder kaart stopt het wachten op de kaart (de timer kijkt elke ~40 ms). */
const WACHT_MARGE = 0.25;
/**
 * De curve van een overgang gaat als GLIJDENDE knoppen (track.N.<knop>.glide,
 * Deck.glide): elke beurt een doel dat GLIJ seconden verderop op de curve ligt,
 * en de engine legt er een helling naartoe op de audioklok. Een nieuw doel
 * zodra de lopende helling nog zo lang (s) te gaan heeft: ruim twee tikken,
 * zodat een timer die een tik hapert geen stilstand geeft. Met GLIJ = 0,5 s
 * is dat een regel per ~0,4 s per knop die beweegt.
 */
const HERRICHT = 0.1;
/** Wat glijdt: [sleutel in standen(), action]. De bas (low) is een SCHAKELAAR (de wissel), die gaat direct. */
const GLIJ_ACTIES = [['fader', 'fader'], ['filter', 'filter'], ['sendA', 'send.a'], ['sendB', 'send.b']];
/** Net vóór het einde: op p = 1 springt de filter-uit (fader dicht, de nieuwe valt in); dat doet _rondAf direct. */
const BIJNA = 1 - 1e-9;
/**
 * Een track waar Clay zo kort geleden (s audioklok) iets aan deed, laadt de automaat nooit
 * (docs/PLAN-SET.md §4): ook zonder `tracks` in het plan is een track die Clay gebruikt van hem.
 */
export const CLAY_RECENT = 120;
/** Zo ver (s klok) vóór zijn moment zet de automaat een laag "nummer" klaar (laden, fader dicht, sync). */
export const LAAG_VOORUIT = 30;
/** Zoveel maten gaat de fader van een laag open en dicht (zonder grid: LAAG_FADE_SEC). */
const LAAG_FADE_MATEN = 4, LAAG_FADE_SEC = 8;
/** De fader van een laag als hij helemaal open is: een laag ligt bovenop de mix. */
export const LAAG_NIVEAU = 0.8;
/** Een GO-stap gaat zonder GO toch op dit moment (s tracktijd vóór het einde, bovenop de lengte van de overgang). */
const GO_MARGE = 8;
/** Actions op een track die hem niet "in gebruik" maken: kijken en luisteren. */
const KIJKEN = /^track\.\d\.(focus|select|pfl|show|stem\.\w+\.pfl)$/;
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
   * @param haalSecties (trackId) => Promise<sectiekaart|null>: de kaart van een nummer (docs/SECTIES.md §4)
   * @param wachtSecties zo lang (ms) wacht het klaarzetten op die kaart; daarna zonder (het oude gedrag)
   */
  constructor({ engine, invoke, bijInvoke = () => () => {}, laad, haalLibrary, haalPlan = async () => null,
    welkNummer = () => null, haalSecties = async () => null, wachtSecties = WACHT_SECTIES, rnd = Math.random, tik = 40, metaOf = busMeta } = {}) {
    super();
    Object.assign(this, { engine, _invoke: invoke, laad, haalLibrary, haalPlan, welkNummer, haalSecties, wachtSecties, rnd, tikMs: tik, metaOf });
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
    this._glijdt = new Map();     // 'A.fader' -> { doel, tot }: de lopende glijbeurt van de automaat
    this._kaarten = {};           // deckId -> { trackId, kaart }: sectiekaarten die de automaat zelf ophaalde
    this._kaartVraag = {};        // deckId -> volgnummer van de laatste vraag om een kaart
    this._sprong = null;          // { pos, t }: Clay drukte een sectie op de hoofdtrack; sprong hij echt, dan opnieuw plannen
    this._wachtKijk = null;       // () => void: bij elke tik kijken of het wachten op een kaart moet stoppen
    this.buitenPlan = false;      // plan.buiten: Clay speelt buiten het plan, de automaat kijkt alleen
    this._buitenNaOvergang = false;
    this._clay = {};              // deckId -> ctx-tijd waarop Clay de track het laatst aanraakte (niet de automaat)
    this.lagen = [];              // de lagen van de stap die nu klinkt: [{ ...laag, stapId, status, deckId, t, … }]
    this._laagDecks = new Set();  // tracks waar een laag op ligt of lag (van Clay: de automaat laadt er geen stap op)
    this._clayGeladen = new Set(); // tracks waar Clay zelf iets op laadde (gezien aan een ander nummer, _kijkLaden)
    this._buffers = {};           // deckId -> het nummer (buffer) dat er bij de vorige tik op stond
    this._laadt = new Set();      // decks waar de automaat NU zelf op laadt
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
    // Wat er nu op de decks staat telt niet als "Clay laadde het" (pas wat daarna verandert).
    for (const id of DECK_IDS) this._buffers[id] = this.engine.deck(id)?.buffer ?? null;
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

  /**
   * Nog 8 maten (of 30 s bij beatloos) langer op de huidige. Met secties:
   * naar de volgende sectiegrens als die binnen 16 maten (60 s) komt.
   */
  langer() {
    const v = this.volgende;
    if (!v?.moment || this.fase !== 'klaar') return;
    const d = this.engine.deck(this.hoofd);
    const g = v.overgang.type === 'ambient' ? null : d.grid;
    const grens = sectieGrens({ secties: sectiesVan(this._kaartVan(this.hoofd)), grid: g, zeker: (t) => !!d.grid && d.grid.zekerBij(t),
      na: v.moment.start, tot: g ? g.timeOf(v.moment.tel + LANGER_SECTIE_MATEN * g.beatsPerBar) : v.moment.start + LANGER_SECTIE_SEC * d.rate });
    const opGrens = grens && (!v.mag || v.mag(grens.start)) && (g
      ? { ...v.moment, tel: grens.tel, start: grens.start, lengte: g.timeOf(grens.tel + v.moment.maten * g.beatsPerBar) - grens.start, sectie: grens.sectie }
      : { ...v.moment, start: grens.start, sectie: grens.sectie });
    if (opGrens && opGrens.start + opGrens.lengte <= d.duration - 2) {
      this.eind += opGrens.start - v.moment.start;
      v.langer = (v.langer || 0) + 1;
      v.moment = opGrens;
      this.emit('change');
      return;
    }
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
    delete v.moment.sectie;
    this.emit('change');
  }

  /**
   * Zo snel het mooi kan: de eerstvolgende 4-maatsgrens (beatloos: meteen).
   * Met secties: de volgende sectiegrens als die binnen 8 maten komt.
   */
  nu() {
    const v = this.volgende;
    if (!v || this.fase !== 'klaar') return;
    const d = this.engine.deck(this.hoofd);
    const g = v.overgang.type === 'ambient' ? null : d.grid;
    const vooruit = g ? 1.5 : 0.5;
    this.eind = d.position + vooruit * d.rate + (v.moment?.lengte ?? 0);
    v.moment = planMoment({ type: v.overgang.type, grid: g, positie: d.position, eind: this.eind, rate: d.rate, vooruit });
    if (g) {
      // Eerstvolgende 4-maatsgrens, niet de laatste vóór `eind`; of de volgende sectiegrens als die dichtbij is.
      const bpb = g.beatsPerBar;
      const vroegst = d.position + vooruit * d.rate;
      const kandidaat = sectieGrens({ secties: sectiesVan(this._kaartVan(this.hoofd)), grid: g, na: vroegst - 2e-3,
        tot: g.timeOf(g.beatAt(vroegst) + NU_SECTIE_MATEN * bpb) });
      // Alleen als de soort daar ook mag (de bewakers); anders de 4-maatsgrens zoals altijd.
      const grens = kandidaat && (!v.mag || v.mag(kandidaat.start)) ? kandidaat : null;
      const b = grens ? grens.tel : g.volgendeVeelvoud(g.beatAt(vroegst), 4 * bpb);
      const tellen = v.moment.maten * bpb;
      v.moment = { ...v.moment, tel: b, start: g.timeOf(b), lengte: g.timeOf(b + tellen) - g.timeOf(b) };
      if (grens) v.moment.sectie = grens.sectie; else delete v.moment.sectie;
    }
    v.nu = true;
    this.emit('change');
  }

  /**
   * GO (plan.go, docs/PLAN-SET.md §4): de klaarstaande overgang NU, zoals `nu()`. Bij een stap met
   * `go: 'wacht'` is dit de enige manier, op het laatste moment na (nooit stilte).
   */
  go() {
    const v = this.volgende;
    if (this.fase === 'laden' || (this.fase === 'wacht' && !v)) { this._goStraks = true; this._meld('GO: zodra de volgende klaarstaat'); return; }
    if (!v || this.fase !== 'klaar') { this._meld(this.fase === 'bezig' ? 'de overgang loopt al' : 'er staat nog niets klaar'); return; }
    v.goGegeven = true;
    v.bevestigd = true;
    this.nu();
  }

  /**
   * Buiten het plan (plan.buiten): de automaat laat alles los en kijkt alleen. Een lopende overgang
   * maakt hij af; wat klaarstond blijft geladen (hij start het niet). Nog eens = terug().
   */
  buiten(aan = !this.buitenPlan) {
    if (!aan) { this.terug(); return; }
    if (!this.aan || this.buitenPlan) return;
    this.buitenPlan = true;
    if (this.fase === 'bezig') { this._buitenNaOvergang = true; this._meld('buiten het plan: ik maak deze overgang af en laat dan los'); }
    else { this._gaBuiten(); this._meld('buiten het plan: ik laat alles los en kijk mee'); }
    this.emit('change');
  }

  _gaBuiten() {
    this._buitenNaOvergang = false;
    this._glijdt.clear();
    this.volgende = null;
    this.fase = 'buiten';
  }

  /**
   * Terug naar het plan (plan.terug): wat nu het hardst klinkt wordt de hoofdtrack (Clay geeft hem
   * expliciet terug, dus vanaf nu mag de automaat hem uitmixen), en het plan gaat verder na de
   * laatste stap die echt speelde. Klinkt er niets: meteen de volgende stap.
   */
  terug() {
    if (!this.aan) return;
    // Ook na een overname (Clay mixt, de automaat wacht): Clay geeft de set expliciet terug.
    const was = this.buitenPlan || this.fase === 'buiten' || this.fase === 'overgenomen';
    this.buitenPlan = false;
    this._buitenNaOvergang = false;
    if (!was) return;
    // De overgang loopt nog (buiten werd pas na de overgang): gewoon doorlaten (review S9 a-B2).
    if (this.fase === 'bezig') { this._meld('terug naar het plan: de overgang loopt door'); this.emit('change'); return; }
    const id = this._luidste({ alle: true });
    this.volgende = null;
    if (id) {
      const d = this.engine.deck(id);
      this.hoofd = id;
      this.eigen.add(id);
      this._laagDecks.delete(id);
      this._clayGeladen.delete(id);
      this.eind = Math.min(d.duration - 6, d.position + SPEELDUUR * d.rate);
      this.hoofdVan = d.position;
      const nr = this.welkNummer(id);
      if (nr) this.gespeeld.add(nr);
      const i = nr ? (this.plan?.stappen || []).findIndex((s, k) => k >= this.planIndex - 1 && s.track === nr) : -1;
      this.hoofdStap = i >= 0 ? this.plan.stappen[i].id : null;
      if (i >= 0) this.planIndex = i + 1;
      this._gebeurd({ stap: this.hoofdStap, track: nr, titel: d.title, deck: nrVan(id), bron: 'clay', wat: 'terug' });
      this._meld(`terug naar het plan, vanaf track ${nrVan(id)}`);
    } else {
      this.hoofd = null;
      this._meld('terug naar het plan: niets klinkt, ik start de volgende');
    }
    this.fase = 'wacht';
    this.emit('change');
    this.tik();
  }

  /** De eerstvolgende laag nu starten (plan.laag.nu). */
  laagNu() {
    const l = this.lagen.find((x) => x.status === 'wacht' || x.status === 'klaar');
    if (!l) { this._meld('er komt geen laag meer in deze stap'); return; }
    l.nu = true;
    this.tik();
    this.emit('change');
  }

  /** De eerstvolgende laag niet (plan.laag.skip). Wat al geladen is blijft staan (stil). */
  laagSkip() {
    const l = this.lagen.find((x) => x.status === 'wacht' || x.status === 'klaar' || x.status === 'laden');
    if (!l) { this._meld('er komt geen laag meer in deze stap'); return; }
    l.status = 'overgeslagen';
    this._gebeurd({ stap: l.stapId, laag: l.id, wat: 'laag overgeslagen' });
    this.emit('change');
  }

  /** Iemand anders (Clay, MIDI, muis, toetsenbord) raakte de bus aan. */
  _bijBus(id) {
    if (this._zelf || !this.aan) return;
    // Welke track gebruikt Clay (docs/PLAN-SET.md §4): elke action op een track telt, niet alleen OVERNEEM.
    const t = /^track\.(\d)\./.exec(id);
    // Kijken en luisteren is geen gebruiken: focus (Track Select), PFL, een venster tonen (review S9 b5).
    if (t && deckVanNr(Number(t[1])) && !KIJKEN.test(id)) {
      const dk = deckVanNr(Number(t[1]));
      this._clay[dk] = this.engine.ctx?.currentTime ?? 0;
      // Een laag op die track is nu van Clay: de automaat raakt hem niet meer aan.
      for (const l of this.lagen) {
        if (l.deckId === dk && (l.status === 'klaar' || l.status === 'speelt' || l.status === 'laden')) {
          l.status = 'jij';
          this._gebeurd({ stap: l.stapId, laag: l.id, wat: 'laag overgenomen' });
          this.emit('change');
        }
      }
    }
    const o = neemtOver(id, this.metaOf);
    let deck = o?.nr ? deckVanNr(o.nr) : null;
    if (deck && SECTIE.test(id) && !sectieSpringt(this.engine.deck(deck), id)) deck = null;
    // Een action met meta.overneem die bij geen track hoort, raakt de overgang zoals de crossfader.
    const raakt = (deck && (deck === this.hoofd || deck === this.volgende?.deckId)) || (o && o.nr === null);
    // Een sectiedruk op wat nu klinkt terwijl de volgende klaarstaat: springt
    // de positie echt (_klaar kijkt bij de volgende tik; de bus hoort de druk
    // vóór de sprong), dan de overgang opnieuw plannen. Onthoud waar hij was.
    if (raakt && this.fase === 'klaar' && deck === this.hoofd && SECTIE.test(id)) {
      this._sprong ??= { pos: this.engine.deck(deck).position, t: this.engine.ctx.currentTime };
    }
    if (id === 'mixer.xfader' || raakt) {
      if (this.fase === 'bezig' || (this.fase === 'klaar' && deck === this.volgende?.deckId)) {
        this.fase = 'overgenomen';
        // Wat nog glijdt loopt hooguit GLIJ s uit; wat Clay aanraakt houdt
        // de engine meteen vast (Deck.set) en gaat van daar verder.
        this._glijdt.clear();
        this._meld('je nam de overgang over — ik ga verder als er weer één track speelt');
        this.emit('change');
      }
    }
  }

  // ---- de lus ----------------------------------------------------------------

  tik() {
    if (!this.aan) return;
    this._wachtKijk?.();
    try { this._tik(); } catch (err) { console.error('[auto]', err); this._meld(`auto-dj: ${err.message}`, 'fout'); }
  }

  _tik() {
    this._kijkLaden();
    if (this.fase === 'buiten') return;
    if (this.fase === 'overgenomen') { this._naOvername(); return; }
    const d = this.hoofd ? this.engine.deck(this.hoofd) : null;
    if (d?.buffer && d.playing && this.lagen.length) this._lagenTik(d);

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
      // De sectiekaart tegelijk met het laden ophalen: laden.js haalt hem
      // ook, maar pas NA het laden en zonder te wachten (de race).
      const kaartP = this._haalKaart(deckId, keuze.track.id);
      await this._laadZelf(deckId, keuze.track);
      if (!this.aan) return;
      // Intussen buiten het plan gegaan (review S9 a-B1): geladen laten staan, verder niets.
      if (this.buitenPlan) { this.nummers[deckId] = keuze.track; this.eigen.add(deckId); this.fase = 'buiten'; return; }
      const nd = this.engine.deck(deckId);
      if (!nd.buffer) throw new Error(`${keuze.track.titel} laadde niet`);
      this.nummers[deckId] = keuze.track;
      this.eigen.add(deckId);
      // Het fragment zonder kaart: wat het zonder secties zou zijn (één keer
      // gerekend, dus hetzelfde toeval als vroeger).
      const f0 = fragment(keuze.track, { ...keuze.stuk, rnd: this.rnd });
      const opMaat = (f) => {
        // Beginnen op een maatbegin van de nieuwe als zijn grid daar zeker is
        // (een sectiebegin ligt op een maat, afgerond: die maat zelf).
        if (!nd.grid || !nd.grid.zekerBij(f.van)) return f.van;
        return nd.grid.timeOf(nd.grid.volgendeVeelvoud(nd.grid.beatAt(f.van) - (f.sectie ? 0.02 : 0), nd.grid.beatsPerBar));
      };
      // Op de kaart wachten, met een grens (wachtSecties), maar nooit zo lang
      // dat de overgang zonder kaart verschuift: de automaat rekent het moment
      // uit dat hij NU zou plannen (met en zonder de secties van de uitgaande)
      // en stopt met wachten voor "vroegst" (positie + VOORUIT_KLAAR × rate)
      // daar aankomt. Niets klinkt (meteen), of wat klinkt valt stil: niet
      // (langer) wachten, nooit een gat. Regel 3: dat leest de POSITIE.
      let kaart = null;
      if (!meteen && this.hoofd && this.engine.deck(this.hoofd).playing) {
        const d = this.engine.deck(this.hoofd);
        const v0 = { deckId, track: keuze.track, van: opMaat(f0), lengte: keuze.lengte ?? null };
        const { args } = this._overgangVoor(v0, keuze.overgang);
        const uiterst = Math.min(planMoment({ ...args, secties: null, uitSectie: null }).start, planMoment(args).start);
        kaart = await binnen(kaartP, this.wachtSecties, (kijk) => { this._wachtKijk = kijk; },
          () => !this.aan || !this.engine.deck(this.hoofd)?.playing || d.position + (VOORUIT_KLAAR + WACHT_MARGE) * d.rate >= uiterst);
        this._wachtKijk = null;
      } else {
        kaart = await binnen(kaartP, 0);
      }
      if (!this.aan) return;
      if (this.buitenPlan) { this.fase = 'buiten'; return; }
      const f = kaart ? fragment(keuze.track, { ...keuze.stuk, rnd: this.rnd, secties: sectiesVan(kaart), inSectie: keuze.in }) : f0;
      const van = opMaat(f);
      this._doe(`track.${nrVan(deckId)}.seek`, nd.duration ? van / nd.duration : 0);
      this.volgende = { deckId, track: keuze.track, van, tot: f.tot, bron: keuze.bron, waarom: keuze.waarom,
        stapId: keuze.stapId ?? null, voorkeur: keuze.overgang, lengte: keuze.lengte ?? null, inSectie: f.sectie ?? null,
        bevestigd: false, gestart: false, overgang: null, moment: null, goWacht: !!keuze.go, goGegeven: false };
      if (meteen || !this.hoofd || !this.engine.deck(this.hoofd).playing) { this.fase = 'klaar'; this._startMeteen(); return; }
      this._sprong = null;
      this._planOvergang(keuze.overgang);
      this.fase = 'klaar';
      // GO kwam terwijl hij nog laadde (review S9 a-K6): nu alsnog.
      if (this._goStraks) { this._goStraks = false; this.volgende.goGegeven = true; this.volgende.bevestigd = true; this.nu(); }
    } catch (err) {
      this._meld(`laden mislukt: ${err.message}`, 'fout');
      this.fase = this.buitenPlan ? 'buiten' : 'wacht';
    } finally {
      this._bezigLaden = false;
      this.emit('change');
    }
  }

  /**
   * Uit het plan (overgeslagen en onbekende nummers overslaan), anders de
   * kiezer. Het fragment (waar hij begint) volgt pas als de sectiekaart er is
   * (_bereidVoor): `stuk` en `in` zijn wat het plan daarvoor zegt.
   */
  _kies() {
    const stappen = this.plan?.stappen || [];
    while (this.planIndex < stappen.length) {
      const s = stappen[this.planIndex];
      const track = this.tracks.find((t) => t.id === s.track);
      if (track && !this.overgeslagen.has(track.id) && track.id !== this.welkNummer(this.hoofd)) {
        return { track, stuk: { van: s.van ?? null, speelduur: s.speelduur ?? null }, in: sectieRef(s.in),
          bron: 'plan', stapId: s.id, overgang: s.overgang || 'auto', lengte: s.lengte ?? null, waarom: s.waarom || '', go: s.go === 'wacht' };
      }
      this.planIndex++;
    }
    const huidig = this._huidigKenmerk();
    const gespeeld = new Set([...this.gespeeld, ...this.overgeslagen]);
    const k = kiesVolgende({ huidig, tracks: this.tracks, gespeeld, rnd: this.rnd });
    if (!k) return null;
    return { track: k.track, stuk: {}, in: null, bron: 'kiezer', overgang: 'auto', waarom: k.redenen.join(', ') };
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

  /**
   * De soort overgang en wat planMoment nodig heeft, voor klaarstaande v,
   * zonder iets te doen. De argumenten komen van momentArgs (planner.js), net
   * als in het planvenster: zelfde invoer, zelfde moment.
   */
  _overgangVoor(v, voorkeur = 'auto') {
    const d = this.engine.deck(this.hoofd);
    const nd = this.engine.deck(v.deckId);
    const pos = Math.max(d.position, Math.min(this.eind, d.duration - 6));
    const kIn = kenmerken(v.track, v.van);
    const inn = { ...kIn, grid: nd.grid, gridZeker: !!nd.grid && nd.grid.zekerBij(v.van), bpm: nd.grid ? nd.grid.bpmAt(v.van) : kIn.bpm };
    const overgang = kiesOvergang(this._uitKenmerken(d, pos), inn, { voorkeur });
    const eind = Math.min(this.eind ?? d.duration, d.duration - 6);
    const kaart = this._kaartVan(this.hoofd);
    const args = momentArgs({ type: overgang.type, grid: d.grid, uit: (t) => this._uitKenmerken(d, t), inn, positie: d.position, eind,
      rate: d.rate, vooruit: VOORUIT_KLAAR, lengte: v.lengte, kaart, uitSectie: sectieRef(this._stap(this.hoofdStap)?.uit) });
    return { overgang, args, eind, kaart };
  }

  /**
   * De soort overgang en het moment, met de bewakers. Met de sectiekaart van
   * de uitgaande begint het moment bij voorkeur op een sectiegrens (`uit` van
   * de planstap die nu klinkt, anders de outro, een break, …: planMoment), maar
   * alleen waar de gekozen soort ook mag: secties veranderen de soort nooit.
   * `alleenAlsHetPast`: past de nieuwe overgang niet meer vóór het einde van
   * de track, dan blijft alles zoals het was (geeft false).
   */
  _planOvergang(voorkeur = 'auto', { alleenAlsHetPast = false } = {}) {
    const v = this.volgende;
    const d = this.engine.deck(this.hoofd);
    const nd = this.engine.deck(v.deckId);
    const { overgang, args, eind, kaart } = this._overgangVoor(v, voorkeur);
    const moment = planMoment(args);
    if (alleenAlsHetPast && v.moment && moment.start + moment.lengte > d.duration - 1) return false;
    v.overgang = overgang;
    this.eind = eind;
    v.uitKaart = kaart;
    v.mag = args.mag;
    v.moment = moment;
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
    return true;
  }

  /** Wat we van de uitgaande weten op tracktijd t, met `bpm` = wat je HOORT (rate, transpositie, keylock). */
  _uitKenmerken(d, t) {
    const h = d.toonKaart?.hoorbaarBij(t, { rate: d.rate, transpositie: d.transpositie, keylock: d.keylock });
    return { grid: d.grid, gridZeker: !!d.grid && d.grid.zekerBij(t), bpm: d.grid ? d.grid.bpmAt(t) * d.rate : null,
      k: h?.k ?? null, toonZeker: h?.soort === 'zeker' };
  }

  /**
   * De sectiekaart van wat er op een track staat: die van het deck (laden.js
   * zet hem), anders die de automaat zelf ophaalde voor DAT nummer. Of null.
   */
  _kaartVan(deckId) {
    if (!deckId) return null;
    const d = this.engine.deck(deckId);
    if (d.sectieKaart) return d.sectieKaart;
    const e = this._kaarten[deckId];
    return e && e.trackId === this.welkNummer(deckId) ? e.kaart : null;
  }

  /**
   * De kaart van een nummer ophalen (haalSecties). Wat binnenkomt wordt
   * bewaard, ook als het klaarzetten er niet meer op wachtte: dan telt hij
   * alsnog voor het moment van de overgang (_klaar). Nooit een fout.
   */
  _haalKaart(deckId, trackId) {
    const vraag = (this._kaartVraag[deckId] = (this._kaartVraag[deckId] || 0) + 1);
    let p;
    try { p = Promise.resolve(this.haalSecties(trackId)); } catch (_) { p = Promise.resolve(null); }
    return p.then((ruw) => {
      const kaart = ruw ? SectieKaart.van(ruw) : null;
      // Alleen de laatste vraag voor deze track telt (een trage oude kaart overschrijft geen nieuwe).
      if (this._kaartVraag[deckId] === vraag) this._kaarten[deckId] = kaart ? { trackId, kaart } : null;
      return kaart;
    }, () => null);
  }

  /** De planstap met dit id, of null. */
  _stap(stapId) { const i = this._index(stapId); return i >= 0 ? this.plan.stappen[i] : null; }

  _klaar(d) {
    const v = this.volgende;
    // Clay sprong naar een sectie, of de sectiekaart van wat nu klinkt kwam
    // later binnen (laden.js wacht er niet op): opnieuw plannen zolang het kan.
    const maat = d.grid ? d.grid.beatLengthAt(d.position) * d.grid.beatsPerBar : 2;
    const kaart = this._kaartVan(this.hoofd);
    if (this._sprong) {
      // Sprong hij echt? Dan staat de positie ergens anders dan gewoon doorspelen zou geven.
      const s = this._sprong;
      this._sprong = null;
      const verwacht = s.pos + (this.engine.ctx.currentTime - s.t) * d.rate;
      if (!v.gestart && Math.abs(d.position - verwacht) > SPRONG_MIN) this._planOvergang(v.voorkeur ?? 'auto', { alleenAlsHetPast: true });
    } else if (kaart !== v.uitKaart) {
      // Een andere kaart (of dezelfde opnieuw, van laden.js: dan niets doen).
      // Niet meer als Clay bevestigde, langer of nu drukte, of de start dichtbij is.
      const anders = kaartSleutel(kaart) !== kaartSleutel(v.uitKaart);
      v.uitKaart = kaart;
      const marge = Math.max(HERPLAN_MATEN * maat, VOORUIT_KLAAR * d.rate);
      if (anders && !v.gestart && !v.bevestigd && !v.langer && !v.nu && d.position < v.moment.start - marge) {
        this._planOvergang(v.voorkeur ?? 'auto', { alleenAlsHetPast: true });
      }
    }
    // GO (PLAN-SET.md §4): een stap die op GO wacht begint niet op zijn moment, maar pas na
    // plan.go; komt die niet, dan op het laatste moment dat de overgang nog past (nooit stilte).
    if (v.goWacht && !v.goGegeven) {
      if (d.position < this._goUiterst(d, v)) return;
      v.goGegeven = 'vanzelf';
      this._meld('geen GO gekregen: ik ga toch, anders valt het stil');
      this.nu();
    }
    const m = v.moment;
    // Een tel vóór het begin: blend = sync en start op de maat, beatloos = meteen.
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
    const uitN = nrVan(this.hoofd), inN = nrVan(v.deckId);
    // Filter: de nieuwe start op de laatste maat, zodat hij op de "1" invalt.
    if (v.overgang.type === 'filter' && !v.gestart && d.grid) {
      const maat = d.grid.beatLengthAt(d.position) * d.grid.beatsPerBar;
      if (d.position >= m.start + m.lengte - maat * 0.9 || !d.playing) {
        this._doe(`track.${inN}.play.quant`, true);
        v.gestart = true;
      }
    }
    if (p >= 1) { this._rondAf(); return; }
    // Schakelaars (de bas) op de stand van NU; de curve glijdend naar waar
    // hij over GLIJ seconden is. Regel 3: dat komt van de POSITIE van de
    // uitgaande (GLIJ s klok = GLIJ × rate tracktijd), niet van de timer.
    const st = standen(v.overgang.type, p, v.basis);
    const vooruit = p < 0 ? p : Math.min(BIJNA, p + GLIJ * d.rate / m.lengte);
    const doel = standen(v.overgang.type, vooruit, v.basis);
    this._zet(uitN, { low: st.uit.low }, this.hoofd);
    this._zet(inN, { low: st.in.low }, v.deckId);
    this._glij(uitN, doel.uit, this.hoofd);
    this._glij(inN, doel.in, v.deckId);
  }

  /**
   * De curve als glijbeurten: een nieuw doel als de lopende helling bijna
   * aankomt (HERRICHT), en alleen als het doel verandert. Zo is er geen
   * trapje per tik op de AudioParam, en een paar regels per seconde in het
   * log in plaats van een per tik.
   */
  _glij(n, stand, deckId) {
    const d = this.engine.deck(deckId);
    const nu = this.engine.ctx.currentTime;
    for (const [k, actie] of GLIJ_ACTIES) {
      const doel = stand[k];
      if (!eindig(doel)) continue;
      const sleutel = `${deckId}.${k}`;
      const vorig = this._glijdt.get(sleutel);
      if (vorig && nu < vorig.tot - HERRICHT) continue;     // nog onderweg
      if (Math.abs(doel - (vorig ? vorig.doel : d.ui[k])) < 1e-4) continue;
      this._doe(`track.${n}.${actie}.glide`, doel);
      this._glijdt.set(sleutel, { doel, tot: nu + GLIJ });
    }
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
    this._glijdt.clear();
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
    this._zetLagen();
    if (this._buitenNaOvergang) this._gaBuiten();
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
    // Alleen de tracks van de automaat (PLAN-SET.md §4): een acapella die Clay op zijn eigen track
    // speelt, of een laag, laat hem anders eeuwig wachten.
    const mijn = this._mijn();
    const spelend = DECK_IDS.filter((id) => (mijn ? mijn.has(id) : !this._laagDecks.has(id) && !this._vanClay(id)))
      .map((id) => this.engine.deck(id)).filter((d) => d.playing && d.ui.fader > 0.05);
    // Nooit stilte: speelt er helemaal niets meer (ook niet op de tracks van Clay), dan meteen verder.
    if (!spelend.length && !DECK_IDS.some((id) => this.engine.deck(id).playing)) {
      this.hoofd = null;
      this.volgende = null;
      this.fase = 'wacht';
      this._meld('alles is stil: ik ga verder met de set');
      this.emit('change');
      this._bereidVoor({ meteen: true });
      return;
    }
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
    this._zetLagen();
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
   * klaar en is die stap veranderd (ander nummer of beginpunt, een andere
   * insectie, of weg), dan wordt hij opnieuw gekozen; alleen de overgang
   * anders: opnieuw gepland. Zijn uitsectie bepaalt alleen de overgang
   * DAARNA (gepland als hij klinkt): die herlaadt niets.
   * Een nieuwe speelduur van wat nu klinkt verschuift het einde.
   */
  vervangPlan(p) {
    const oudeVolgende = this.volgende;
    // De klaarstaande stap zoals hij in het OUDE plan stond: daarmee werd hij gekozen
    // (in staat niet in `volgende`). Beide plannen zijn genormaliseerd: in heeft een
    // vaste vorm, dus JSON vergelijkt hem (ontbrekend = null).
    const oudeStap = oudeVolgende?.stapId ? (this.plan?.stappen || []).find((x) => x.id === oudeVolgende.stapId) ?? null : null;
    const zelfdeSectie = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    this._zetPlan(p);
    if (!this.plan) { this.planIndex = 0; this.emit('change'); return; }
    const i = this._index(this.hoofdStap);
    if (i >= 0) this.planIndex = i + 1;
    else this.planIndex = Math.min(this.planIndex, this.plan.stappen.length);
    // Nieuwe speelduur van wat nu klinkt.
    const nu = i >= 0 ? this.plan.stappen[i] : null;
    // De lagen van wat nu klinkt: wat nog niet begon volgt het nieuwe plan; wat loopt blijft.
    this._zetLagen({ behoud: true });
    if (nu && this.hoofd && this.fase !== 'bezig' && Number.isFinite(this.hoofdVan)) {
      const d = this.engine.deck(this.hoofd);
      const tot = nu.speelduur ? this.hoofdVan + nu.speelduur : null;
      if (tot !== null) this.eind = Math.max(d.position + 4 * d.rate, Math.min(d.duration - 6, tot));
    }
    if (this.aan && oudeVolgende && this.fase === 'klaar' && oudeVolgende.bron === 'plan') {
      const s = this.plan.stappen[this.planIndex];
      const zelfde = s && s.id === oudeVolgende.stapId && s.track === oudeVolgende.track.id
        && (s.van === null || Math.abs(s.van - oudeVolgende.van) < 1)
        && zelfdeSectie(s.in, oudeStap?.in);
      if (!zelfde) {
        this.volgende = null;
        this.fase = 'wacht';
      } else {
        oudeVolgende.voorkeur = s.overgang;
        oudeVolgende.lengte = s.lengte ?? null;
        oudeVolgende.waarom = s.waarom || oudeVolgende.waarom;
        // GO (PLAN-SET.md §4): een stap die nu op GO moet wachten (of niet meer), en een GO die al gegeven is blijft.
        oudeVolgende.goWacht = s.go === 'wacht';
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

  /**
   * De luidste track die speelt (fader × crossfader), of null. Alleen de tracks van de automaat
   * (plan.tracks) en geen laag, tenzij `alle` (terug naar het plan: Clay geeft zelf een track).
   */
  _luidste({ alle = false } = {}) {
    let beste = null, max = 0.02;
    const mijn = alle ? null : this._mijn();
    for (const id of DECK_IDS) {
      const d = this.engine.deck(id);
      if (!d.playing) continue;
      if (mijn ? !mijn.has(id) : !alle && this._laagDecks.has(id)) continue;
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
    // Nooit een track met een instrument (docs/INSTRUMENTEN.md §6): laden zou het eraf halen.
    // De tracks van de automaat als het plan ze noemt; anders nooit een track van Clay (een laag, of
    // een track waar hij net iets aan deed) (docs/PLAN-SET.md §4).
    const mijn = this._mijn?.() ?? null;
    const vanClay = (id) => !!this._laagDecks?.has(id) || !!this._vanClay?.(id);
    const vrij = DECK_IDS.filter((id) => id !== this.hoofd && !this.engine.deck(id).playing && !this.engine.deck(id).wacht
      && !this.engine.instrumentOp?.(id) && (mijn ? mijn.has(id) : !vanClay(id)));
    return vrij.find((id) => this.eigen.has(id))
      || vrij.find((id) => !this.engine.deck(id).buffer)
      || vrij[vrij.length - 1] || null;
  }

  /** De tracks van de automaat uit het plan (Set van deckId's), of null (het plan zegt het niet). */
  _mijn() {
    const a = this.plan?.tracks?.auto;
    return Array.isArray(a) && a.length ? new Set(a.map(deckVanNr).filter(Boolean)) : null;
  }

  /** Is dit een track van Clay: niet van de automaat, en hij deed er kort geleden iets aan. */
  _vanClay(id) {
    if (this._clayGeladen?.has(id)) return true;
    // Ook een track die de automaat eerder gebruikte (review S9 a-I1): raakte Clay hem aan buiten een
    // overgang om, dan is hij van Clay. De hoofdtrack en de klaarstaande tellen niet (OVERNEEM regelt die).
    if (id === this.hoofd || id === this.volgende?.deckId) return false;
    const t = this._clay?.[id];
    return t != null && (this.engine.ctx?.currentTime ?? 0) - t < CLAY_RECENT;
  }

  /**
   * Laden gaat niet over de bus (laden.laadLibrary): een nummer dat Clay op een track zet, zie je
   * alleen aan een ANDER nummer op dat deck. Elke tik vergelijken (acht decks, goedkoop): wat de
   * automaat niet zelf laadde, is van Clay, tot hij het met "terug" teruggeeft (review S9 b1).
   */
  _kijkLaden() {
    for (const id of DECK_IDS) {
      const b = this.engine.deck(id)?.buffer ?? null;
      if (b === this._buffers[id] || this._laadt.has(id)) continue;
      this._buffers[id] = b;
      if (b) { this._clayGeladen.add(id); this.eigen.delete(id); }
    }
  }

  /** Laden door de automaat zelf: dat deck telt niet als "Clay laadde iets". */
  async _laadZelf(deckId, track) {
    this._laadt.add(deckId);
    try { return await this.laad(deckId, track); } finally {
      this._laadt.delete(deckId);
      this._buffers[deckId] = this.engine.deck(deckId)?.buffer ?? null;
      this._clayGeladen.delete(deckId);
    }
  }

  /** Tot welke positie (tracktijd van de uitgaande) een GO-stap op GO wacht. */
  _goUiterst(d, v) {
    const lengte = v.moment?.lengte ?? 30;
    const maat = d.grid ? d.grid.beatLengthAt(d.position) * d.grid.beatsPerBar : 2;
    return d.duration - 1 - lengte - 2 * maat - GO_MARGE * d.rate;
  }

  // ---- lagen (docs/PLAN-SET.md §4) -----------------------------------------------

  /**
   * De lagen van de stap die nu klinkt opnieuw zetten. `behoud` (een nieuw plan): een laag die al
   * begon (laden, klaar, speelt, van Clay, overgeslagen) blijft zoals hij is.
   */
  _zetLagen({ behoud = false } = {}) {
    const stap = this._stap(this.hoofdStap);
    const oud = new Map(this.lagen.map((l) => [`${l.stapId}:${l.id}`, l]));
    const nieuw = (stap?.lagen || []).map((l) => {
      const o = behoud ? oud.get(`${stap.id}:${l.id}`) : null;
      if (o && o.status !== 'wacht') return o;
      return { ...l, stapId: stap.id, status: 'wacht', deckId: null, t: null };
    });
    // Een laag die nog speelt (van een vorige stap) gaat mee tot hij dicht is (review S9 a-I2).
    const mee = this.lagen.filter((l) => l.status === 'speelt' && !nieuw.includes(l));
    this.lagen = [...mee, ...nieuw];
  }

  /** Waar (tracktijd van de hoofdtrack) een laag begint, of null. Regel 3: dat is een POSITIE. */
  _laagMoment(l) {
    const d = this.engine.deck(this.hoofd);
    if (Number.isInteger(l.op?.sectie)) {
      const st = sectiesVan(this._kaartVan(this.hoofd));
      if (st) {
        const i = vindSectie(st, sectieRef(l.op), {});
        if (i >= 0) return st[i].van;
      }
    }
    return eindig(l.op?.sec) && d ? (this.hoofdVan ?? 0) + l.op.sec : null;
  }

  /** Een track van Clay voor een laag "nummer": de gevraagde, of de eerste vrije. Of { fout }. */
  _laagDeck(l) {
    const mijn = this._mijn();
    const bezet = (id) => id === this.hoofd || id === this.volgende?.deckId || this.eigen.has(id) || mijn?.has(id);
    const inGebruik = (id) => { const d = this.engine.deck(id); return d.playing || d.wacht || !!this.engine.instrumentOp?.(id) || this._clayGeladen.has(id); };
    if (l.deck) {
      const id = deckVanNr(l.deck);
      if (!id) return { fout: `track ${l.deck} bestaat niet` };
      if (bezet(id)) return { fout: `track ${l.deck} is van de automaat` };
      if (inGebruik(id) || this._vanClay(id)) return { fout: `track ${l.deck} is in gebruik` };
      return { id };
    }
    const id = DECK_IDS.find((x) => !bezet(x) && !inGebruik(x) && !this._vanClay(x) && !this.engine.deck(x).buffer)
      ?? DECK_IDS.find((x) => !bezet(x) && !inGebruik(x) && !this._vanClay(x));
    return id ? { id } : { fout: 'geen vrije track van jou' };
  }

  /** Elke tik: lagen klaarzetten, starten, dichtdraaien. Alleen kijken naar de POSITIE van de hoofdtrack. */
  _lagenTik(d) {
    const nu = this.engine.ctx.currentTime;
    for (const l of this.lagen) {
      if (l.status === 'wacht' || l.status === 'klaar') {
        if (l.t == null) {
          l.t = this._laagMoment(l);
          if (l.t == null) { l.status = 'weg'; this._meld(`laag ${l.id}: de sectie staat niet (meer) op de kaart en er is geen tijd: overgeslagen`); continue; }
        }
        if (l.status === 'wacht' && l.soort === 'nummer' && (l.nu || d.position >= l.t - LAAG_VOORUIT * d.rate)) { this._laagKlaar(l); continue; }
        if (l.status === 'klaar' || (l.soort !== 'nummer' && l.status === 'wacht')) {
          if (l.nu || d.position >= l.t) this._laagStart(l, d);
        }
      } else if (l.status === 'speelt' && l.deckId) {
        this._laagFade(l, d, nu);
      }
    }
  }

  async _laagKlaar(l) {
    const keuze = this._laagDeck(l);
    if (keuze.fout) { l.status = 'weg'; this._meld(`laag ${l.id}: ${keuze.fout}: overgeslagen`); this.emit('change'); return; }
    const track = this.tracks.find((t) => t.id === l.track);
    if (!track) { l.status = 'weg'; this._meld(`laag ${l.id}: nummer ${l.track} staat niet in de library: overgeslagen`); this.emit('change'); return; }
    l.status = 'laden';
    l.deckId = keuze.id;
    this._laagDecks.add(keuze.id);
    this.emit('change');
    const n = nrVan(keuze.id);
    try {
      this._doe(`track.${n}.fader`, 0);
      await this._laadZelf(keuze.id, track);
      this._laagDecks.add(keuze.id);
      if (!this.aan || l.status !== 'laden') return;
      const nd = this.engine.deck(keuze.id);
      if (!nd.buffer) throw new Error('laadde niet');
      this._doe(`track.${n}.fader`, 0);
      if (eindig(l.van)) this._doe(`track.${n}.seek`, nd.duration ? Math.min(1, l.van / nd.duration) : 0);
      // Alleen die stem: de andere weg (stem-kills zijn schakelaars; een laad zet ze open).
      if (l.stem) {
        if (!nd.stems) this._meld(`laag ${l.id}: ${track.titel} heeft geen stems: ik speel hem heel`);
        else {
          const namen = nd.stems.namen;
          const houd = l.stem === 'inst' ? namen.filter((x) => x !== 'vocals')
            : namen.includes(l.stem) ? [l.stem] : l.stem !== 'vocals' && namen.includes('inst') ? ['inst'] : namen;
          for (const st of namen) {
            const weg = !houd.includes(st);
            if (!!nd.stemKill?.[st] !== weg) this._doe(`track.${n}.stem.${st}.kill`, true);
          }
        }
      }
      l.status = 'klaar';
      if (l.start === 'jij') this._meld(`laag ${l.id}: ${track.titel} staat klaar op track ${n}: start hem zelf`);
    } catch (err) {
      l.status = 'weg';
      this._meld(`laag ${l.id}: laden mislukt (${err.message})`, 'fout');
    } finally {
      this.emit('change');
    }
  }

  _laagStart(l, d) {
    l.nu = false;
    if (l.soort === 'nummer') {
      if (l.start === 'jij') { l.status = 'jij'; this.emit('change'); return; }
      const nd = this.engine.deck(l.deckId);
      const n = nrVan(l.deckId);
      // Op de maat als beide grids daar zeker zijn (zoals een blend); anders meteen.
      const opMaat = !!nd.grid?.zekerBij(nd.position) && !!d.grid?.zekerBij(d.position);
      // Zonder zeker grid (van de laag of de hoofdtrack) start hij NIET vanzelf: een acapella naast
      // het tempo over de mix is erger dan geen laag (PLAN-SET.md §8). Hij staat klaar voor Clay.
      if (!opMaat) {
        l.status = 'jij';
        this._meld(`laag ${l.id}: het grid is daar niet zeker, dus ik start hem niet: hij staat klaar op track ${n}, start hem zelf`);
        this.emit('change');
        return;
      }
      this._doe(`track.${n}.sync`, true);
      this._doe(`track.${n}.play.quant`, true);
      // Vanaf hier rekent de laag op de POSITIE VAN ZIJN EIGEN TRACK (regel 3): zo loopt hij door
      // als de hoofdtrack wisselt (een nieuwe stap), en gaat hij toch op tijd dicht.
      l.status = 'speelt';
      l.start0 = nd.position;
      const maat = nd.grid ? nd.grid.beatLengthAt(nd.position) * nd.grid.beatsPerBar : null;
      l.fade = maat ? LAAG_FADE_MATEN * maat : LAAG_FADE_SEC;
      l.eindPos = eindig(l.duur) ? nd.position + l.duur * (d.rate || 1) : null;
      // Een korte laag: open en dicht passen er allebei in.
      if (l.eindPos != null) l.fade = Math.min(l.fade, (l.eindPos - nd.position) / 2);
      l.glij = null;
    } else if (l.soort === 'sampler') {
      const pad = this.engine.sampler?.pads?.[l.pad - 1];
      if (!pad) { l.status = 'weg'; this._meld(`laag ${l.id}: sampler-pad ${l.pad} is leeg: overgeslagen`); this.emit('change'); return; }
      if (!pad.speelt) { this._doe(`sampler.${l.pad}`, true); this._doe(`sampler.${l.pad}`, false); }
      l.status = 'klaar-gezet';
    } else {
      const id = deckVanNr(l.deck);
      if (!id || !this.engine.instrumentOp?.(id)) { l.status = 'weg'; this._meld(`laag ${l.id}: track ${l.deck} heeft geen instrument: overgeslagen`); this.emit('change'); return; }
      const speelt = this.engine.patronen?.spelend?.().some((x) => x.id === id && x.plek === l.plek);
      if (!speelt) { this._doe(`track.${l.deck}.pattern.${l.plek}`, true); this._doe(`track.${l.deck}.pattern.${l.plek}`, false); }
      l.status = 'klaar-gezet';
    }
    this._gebeurd({ stap: l.stapId, laag: l.id, wat: 'laag gestart' });
    this.emit('change');
  }

  /** De fader van een spelende laag: open in `fade`, en na `duur` weer dicht, gemeten op de positie van de hoofdtrack. */
  _laagFade(l, d, nu) {
    const n = nrVan(l.deckId);
    const nd = this.engine.deck(l.deckId);
    if (!nd.playing && !nd.wacht) { if (l.dicht) { l.status = 'klaar-gezet'; this.emit('change'); } return; }
    if (nd.wacht) return;          // op de maat: hij klinkt nog niet
    if (l.glij && nu < l.glij - HERRICHT) return;
    let doel;
    const ver = GLIJ * (nd.rate || 1);
    const pos = nd.position;
    if (l.eindPos != null && pos + ver >= l.eindPos - l.fade) {
      doel = LAAG_NIVEAU * Math.max(0, Math.min(1, (l.eindPos - pos - ver) / l.fade));
      if (doel <= 0 && pos >= l.eindPos) {
        this._doe(`track.${n}.fader`, 0);
        if (nd.playing) this._doe(`track.${n}.play`, true);
        l.dicht = true;
        l.status = 'klaar-gezet';
        this.emit('change');
        return;
      }
    } else {
      doel = LAAG_NIVEAU * Math.max(0, Math.min(1, (pos + ver - l.start0) / l.fade));
    }
    if (Math.abs(doel - (nd.ui.fader ?? 0)) < 1e-4) return;
    this._doe(`track.${n}.fader.glide`, doel);
    l.glij = nu + GLIJ;
  }

  /** De eerstvolgende laag (voor de live-stand), of null. */
  _laagStand() {
    const d = this.hoofd ? this.engine.deck(this.hoofd) : null;
    const l = this.lagen.find((x) => x.status === 'wacht' || x.status === 'klaar' || x.status === 'laden' || x.status === 'speelt');
    if (!l) return null;
    const titel = l.soort === 'nummer' ? (this.tracks.find((t) => t.id === l.track)?.titel ?? l.track) + (l.stem ? ` (${l.stem})` : '')
      : l.soort === 'sampler' ? `sampler ${l.pad}` : `patroon ${l.plek} op track ${l.deck}`;
    const over = d && l.t != null && l.status !== 'speelt' ? Math.max(0, (l.t - d.position) / (d.rate || 1)) : null;
    return { id: l.id, soort: l.soort, titel, status: l.status, nr: l.deckId ? nrVan(l.deckId) : l.deck ?? null, over,
      wanneer: l.status === 'speelt' ? `speelt op track ${nrVan(l.deckId)}` : over != null ? `over ${Math.floor(over / 60)}:${String(Math.floor(over % 60)).padStart(2, '0')}` : '' };
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
        soort: v.overgang?.naam ?? null, type: v.overgang?.type ?? null,
        redenen: [...(v.overgang?.redenen ?? []), ...(v.moment?.sectie ? [`uit op ${sectieNaam(v.moment.sectie)} (sectie ${v.moment.sectie.sectie})`] : []),
          ...(v.inSectie ? [`in op ${sectieNaam(v.inSectie)} (sectie ${v.inSectie.sectie})`] : [])],
        toon: kortNaam(kenmerken(v.track, v.van).k), over, maten, voortgang,
        go: v.goWacht ? { wacht: !v.goGegeven, uiterlijk: d && this.fase === 'klaar' ? Math.max(0, (this._goUiterst(d, v) - d.position) / uitRate) : null } : null,
      } : null,
      buiten: this.buitenPlan || this.fase === 'buiten',
      laag: this._laagStand(),
      plan: this.plan ? { naam: this.plan.naam || 'plan', stap: Math.min(this.planIndex + 1, this.plan.stappen?.length ?? 0), totaal: this.plan.stappen?.length ?? 0,
        versie: this.planVersie, index: this.planIndex, hoofdStap: this.hoofdStap, volgendeStap: v?.stapId ?? null } : null,
      melding: this.melding,
    };
  }
}

/**
 * Een sectieverwijzing uit een planstap (`in` / `uit`, het spoor plan):
 * { sectie: K (vanaf 1), label?, groep?, van? }, defensief gelezen. Anders null.
 * `van` = waar die sectie begon bij het plannen: vindSectie kiest daarmee de
 * goede als een label na een herberekening vaker voorkomt.
 */
function sectieRef(x) {
  if (!x || typeof x !== 'object') return null;
  const sectie = Number.isInteger(x.sectie) && x.sectie >= 1 ? x.sectie : null;
  const label = typeof x.label === 'string' ? x.label : null, groep = typeof x.groep === 'string' ? x.groep : null;
  const van = eindig(x.van) && x.van >= 0 ? { van: x.van } : {};
  return sectie || label || groep ? { sectie, label, groep, ...van } : null;
}

/** Wat een sectiekaart voor het moment betekent (op het grid? waar, wat): om "dezelfde kaart opnieuw" te herkennen. */
function kaartSleutel(k) {
  const st = sectiesVan(k);
  return st ? st.map((s) => `${s.van}:${s.label}:${s.groep}`).join('|') : '';
}

/**
 * De uitkomst van een belofte, of null als die er na `ms` nog niet is (of
 * faalt), of zodra `stop()` ja zegt. Wanneer er gekeken wordt bepaalt de
 * aanroeper: `kijker(kijk)` krijgt een functie die hij bij elke tik aanroept
 * (de timer beslist wanneer er gekeken wordt, de positie wat er gebeurt).
 */
function binnen(p, ms, kijker = null, stop = null) {
  let klok = null;
  const tijd = new Promise((r) => {
    klok = setTimeout(() => r(null), Math.max(0, ms));
    if (kijker && stop) { const kijk = () => { if (stop()) r(null); }; kijker(kijk); kijk(); }
  });
  return Promise.race([Promise.resolve(p).catch(() => null), tijd]).finally(() => clearTimeout(klok));
}

export { OVERGANGEN };
