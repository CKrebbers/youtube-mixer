import { Emitter, clamp, piek } from '../lib/emitter.js';
import { createDeckChain, setEqBand, killEqBand, killVersterking, setBipolarFilter, filterDoelen, faderGain,
  maakStemFilter, stemFilterOpen, stemFilterDoelen } from './audio-graph.js';
import { Beatgrid } from './beatgrid.js';
import { meetGrid } from './tellen.js';
import { ToonKaart } from './toonsoort.js';
import { SectieKaart, sectieDoel, sectieEen } from './secties.js';
import { BufferBron, StreamBron, geheugenHaal } from './bron.js';
import { maakWav, KANALEN } from './stream-kern.js';
import { InsertSlot, zetDoel } from './fx.js';
import { hoorbaar, uitgangsVertraging } from './hoorbaar.js';
import { startDrempel, houdVast, zetVervolg } from './overgang.js';

/**
 * Hoe ver de pitchfader reikt, naar elke kant. Kiesbaar per track; sync mag
 * altijd verder (0,5–2). Standaard ±16%: ±8% liet de fader na een grote sync
 * tegen de aanslag staan.
 */
export const PITCH_BEREIKEN = [0.08, 0.16, 0.5];
/**
 * Remtijd (vinylstop) in SECONDEN, niet in tellen: een rem is een gebaar van
 * de draaitafel (de motor gaat uit), geen maatlengte; hij moet ook werken
 * zonder grid of met een onzeker grid (ambient, lange sets); en de knop
 * betekent dan altijd hetzelfde, op welk tempo je ook zit. De knop is
 * exponentieel: 0 = 0,1 s (een ruk), midden ≈ 0,7 s, 1 = 5 s (stekker eruit).
 */
export const REM_MIN = 0.1;
export const REM_MAX = 5;
export const REM_STANDAARD = 1;
/** De drie EQ-banden die een kill hebben. */
export const EQ_BANDEN = ['low', 'mid', 'high'];
/** Hoeveel een nudge (bend) versnelt of vertraagt zolang je drukt. */
export const BEND = 0.04;
/** Toonverschuiving: halve tonen, ±12 (K5, docs/KEYLOCK.md). */
export const TOON_MAX = 12;
/** Zoveel bewerkingen van het grid kunnen terug (deck.gridTerug). */
export const GRID_TERUG = 30;
/** Beatjump-lengtes in tellen, te halveren en te verdubbelen. Standaard 4. */
export const SPRONG_TELLEN = [1, 2, 4, 8, 16, 32];
/**
 * Hoe ver (tracktijd, s) een teruggespeelde druk naast zijn plek uit het log mag
 * liggen om die plek te gebruiken (drukPlek): een tik plus een paar stappen van
 * de audioklok. Verder ernaast greep iemand in, en geldt de plek van nu.
 */
export const DRUK_NAAST = 0.05;
/**
 * Glijden (Deck.glide, de auto-DJ): in zoveel seconden naar een nieuwe stand,
 * als helling op de audioklok. Wie glijdt, richt hem steeds opnieuw (elke
 * ~0,4 s een punt dat GLIJ verderop op zijn curve ligt): zo volgt de knop
 * een gladde lijn, met een paar regels per seconde in het handelingenlog in
 * plaats van een trapje per tik. Een overgang duurt 15–30 s: over een halve
 * seconde wijkt de rechte lijn minder dan 0,05 dB van de curve af, en een
 * timer die een paar tikken hapert geeft geen stilstand.
 */
export const GLIJ = 0.5;
/** De knoppen die kunnen glijden: wat de automaat als curve stuurt. */
export const GLIJDERS = ['fader', 'filter', 'sendA', 'sendB'];
/** Zoveel lineaire stukken per glijbeurt op de AudioParam (dB, Hz en kwadraat zijn niet lineair). */
const GLIJ_STUKKEN = 8;

/**
 * Waar een glijdende knop staat op audiokloktijd `t` (regel 3: geen teller).
 * Vóór `t0` loopt de vorige helling nog (zetVervolg laat hem doorlopen),
 * daarna lineair van `van` naar `naar` tot `t1`.
 */
function glijStand(g, t) {
  if (t >= g.t1) return g.naar;
  if (t < g.t0) return g.vorige ? glijStand(g.vorige, t) : g.van;
  return g.van + (g.naar - g.van) * (t - g.t0) / (g.t1 - g.t0);
}

/**
 * De stems die een track kan hebben (docs/STEMS.md). `inst` is alles behalve
 * de zang: bij twee stems een eigen paar, bij vier de groep drums + bas +
 * overig (één knop voor alle drie, zodat "zonder zang" en "alleen zang" in
 * beide standen dezelfde knoppen zijn).
 */
export const STEM_NAMEN = ['vocals', 'inst', 'drums', 'bass', 'other'];
/** Welke namen bij welk aantal horen (de volgorde in het bestand mag anders). */
export const STEM_STANDEN = { 2: ['vocals', 'inst'], 4: ['drums', 'bass', 'other', 'vocals'] };
/** De send-bussen van een stem, zoals die van de track: A = echo, B = galm (engine.sends). */
export const STEM_BUSSEN = ['A', 'B'];
/**
 * Een stemfilter dat terug in het midden komt: zo lang (s) mag het filter
 * teruglopen (5 × de τ van 10 ms van de knop: 99%) voordat de stem er weer
 * langs gaat. Wie eerder weer draait, haalt die overgang weg (houdVast).
 */
export const STEM_FILTER_TERUG = 0.05;

/**
 * Klopt `{ namen, schaal }` van een stems-bestand? Null als het klopt,
 * anders de reden. Twee of vier namen, precies die van één stand, elk één
 * keer; schaal (ontbreekt = 1) groter dan 0 en hooguit 1.
 */
export function controleerStems(stems) {
  if (!stems || !Array.isArray(stems.namen)) return 'stems zonder namen';
  const { namen } = stems;
  const stand = STEM_STANDEN[namen.length];
  if (!stand) return `${namen.length} stems wordt niet ondersteund (alleen 2 of 4)`;
  if (new Set(namen).size !== namen.length || !stand.every((n) => namen.includes(n))) {
    return `stems ${namen.join(', ')}: verwacht ${stand.join(', ')}`;
  }
  const schaal = stems.schaal ?? 1;
  if (!(typeof schaal === 'number' && schaal > 0 && schaal <= 1)) return `stems: schaal ${schaal} moet tussen 0 en 1 liggen`;
  return null;
}

/**
 * Eén deck: transport, cues, loops, beatgrid, kanaalstrip.
 *
 * HOE er geluid uit een track komt weet dit deck niet — dat staat in `bron.js`.
 * Daardoor is de bron inwisselbaar: een AudioBufferSourceNode nu, een
 * time-stretcher voor keylock, of een streamende leeslus voor acht tracks.
 * Alles hieronder is muzikaal, niet technisch.
 *
 * Positie wordt NIET bijgehouden met een teller, maar afgeleid van de
 * AudioContext-klok. Dat is de enige klok die niet wegloopt als de UI hapert.
 */
export class Deck extends Emitter {
  constructor(ctx, id) {
    super();
    this.ctx = ctx;
    this.id = id;               // 'A' t/m 'H'
    this.chain = createDeckChain(ctx);

    /*
     * Insert-slot tussen EQ en het kanaalfilter:
     *   trim -> EQ -> [FX] -> filter -> fader
     * Dit is de plek waar straks het effect-rack van de link komt te hangen.
     * Omhangen kan hier veilig: er loopt nog geen signaal.
     */
    this.fx = new InsertSlot(ctx);
    this.chain.eqHigh.disconnect();
    this.chain.eqHigh.connect(this.fx.in);
    this.fx.out.connect(this.chain.hpf);
    this.fx.zetEffect('delay');          // mix staat op 0, dus nog niet hoorbaar
    this.fx.setKlok(() => this.fxKlok());

    this.bron = null;
    this._zetBron(new BufferBron(ctx, this.chain.input));
    this.title = '— leeg —';

    this.rate = 1;              // playbackRate (pitch schuift mee — keylock = fase 3)
    this.pitchBereik = 0.16;    // zie PITCH_BEREIKEN
    this.buigt = 0;             // -1/0/+1: nudge (bend) ingedrukt
    this.remTijd = REM_STANDAARD;   // seconden tot stilstand, zie rem()
    // EQ-kill per band: de schakelaar, en de drukvariant zolang je drukt.
    // De knopstand (ui.low/mid/high) blijft staan: kill uit = precies terug.
    this.kill = { low: false, mid: false, high: false };
    this.killVast = { low: false, mid: false, high: false };
    this._killHoorbaar = { low: false, mid: false, high: false };   // wat er nu op de EQ staat
    // Stems (docs/STEMS.md): null, of { namen, aantal, schaal } van wat er
    // geladen is. Niveau 0..1 per stem en een kill (schakelaar + drukknop),
    // zoals de EQ-kill. Ze horen bij het NUMMER: elke laad zet ze terug op
    // open (_naLaden). `_stemNu` = wat er nu op stemIn[k] staat (het doel).
    this.stems = null;
    this.stemNiveaus = Object.fromEntries(STEM_NAMEN.map((n) => [n, 1]));
    this.stemKill = Object.fromEntries(STEM_NAMEN.map((n) => [n, false]));
    this.stemKillVast = Object.fromEntries(STEM_NAMEN.map((n) => [n, false]));
    this._stemNu = this.chain.stemIn.map(() => 1);
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    this.loop = null;           // {start, end}
    // Quantize: cue, hotcues en loop in/out op de tel, hotcue-sprongen
    // fasebehoudend. Eén schakelaar voor de hele engine (Engine.setQuantize
    // zet hem op elk deck); het deck leest alleen deze vlag.
    this.quantize = false;
    this.sprongTellen = 4;      // beatjump-lengte, zie SPRONG_TELLEN
    this.loopInPunt = null;     // loop in gezet, wacht op loop out (tracktijd)
    this.vorigeLoop = null;     // voor reloop: de laatste loop die eraf ging

    this.grid = null;           // Beatgrid, of null als de track nog niet uitgemeten is
    this.gridVersie = 0;        // telt bij elke wijziging van het grid (setGrid, gridGewijzigd): voor caches
    // De tellen van Beat This! (docs/BEATGRID.md §11): { beats, downbeats }
    // als gesorteerde Float64Arrays, of null. Alleen data, zoals de onsets: de
    // UI zet ze na het laden; de zoom tekent ze, het scherm meet er het grid mee.
    this.tellen = null;
    // Onset-pieken (tracktijd, s), gesorteerde Float64Array, of null. Alleen
    // data: de UI zet ze na het laden van een library-nummer, "tel 1 hier"
    // snapt ernaar en de zoom tekent ze. Het deck rekent er zelf niet mee.
    this.onsets = null;

    // Toonsoortkaart (src/engine/toonsoort.js) of null. Van de PLAAT, in
    // tracktijd, en net als het grid van de app: het deck kent geen library.
    this.toonKaart = null;
    this.sectieKaart = null;
    this._sectieSprong = null;
    // Keylock en transponeren (docs/KEYLOCK.md, gebouwd 5 okt): een keuze van
    // de DJ op het deck; de StreamBron speelt ze (door een stretcher). Keylock
    // blijft staan bij een nieuw nummer (K4, een voorkeur zoals het
    // pitchbereik), de toon gaat terug naar 0 (K5, zoals de pitch).
    this._keylock = false;
    this._toon = 0;             // halve tonen, −12..+12
    // Een eigen toon per stem (6 okt), bovenop die van de track: halve tonen
    // per stemnaam (inst bij vier stems = drums, bas en overig samen).
    this._stemToon = {};
    this._gridTerug = [];       // grids van vóór een bewerking met de hand (gridTerug)

    /*
     * Sends: na de fader, vóór de crossfader. Fader dicht = er gaat niets
     * meer naar de bus, maar wat daar al in de echo of galm zit sterft
     * vanzelf uit. Dat is de echo-out: het effect zit NA de fader, niet ervoor.
     */
    this.sendA = ctx.createGain();
    this.sendB = ctx.createGain();
    this.sendA.gain.value = 0;
    this.sendB.gain.value = 0;
    this.chain.fader.connect(this.sendA);
    this.chain.fader.connect(this.sendB);

    /*
     * Stem-sends (docs/STEMS.md §5): per stem een eigen echo en galm, getapt
     * na het stemfilter. Een track-send zit NA de fader; een stem heeft geen
     * eigen fader, dus de stem-sends gaan door een SPIEGEL van de fader: een
     * versterking per bus die in dezelfde codepaden dezelfde automatisering
     * krijgt als de fader zelf (applyUi, set, glide via _glijParams). Fader
     * dicht = ook de stems sturen niets meer in, echo-out zoals bij de track;
     * de auto-DJ die de fader laat glijden, laat de spiegel sample voor sample
     * mee glijden. Trim zit in de versterking per stem (die glijdt niet). EQ,
     * effect en trackfilter horen bij de som: daar gaat een stem-send niet door.
     *
     *   stem k (na zijn filter) -> send (knop² × trim) -> spiegel van de fader -> bus
     *
     * De spiegels bestaan altijd (twee stille versterkingen per deck: zo volgen
     * ze de fader vanaf het begin, ook midden in een glijbeurt).
     */
    this.stemSends = {};
    for (const bus of STEM_BUSSEN) this.stemSends[bus] = { fader: ctx.createGain() };
    // De ingang van de stem-cue in de koptelefoon (maakStemCue): alleen als er een koptelefoon is.
    this.stemCue = null;
    // Per uitgang k wat er van zijn stemkanaal bestaat: { filter, send: { A, B }, cue, nu }.
    // Elk deel komt er pas bij als het voor het eerst iets moet doen, en
    // begint stil; daarna blijft het (er gaat nooit iets los). `nu` = wat er op
    // de nodes staat (de doelen), zodat alleen wat verandert wordt aangeraakt.
    this.stemKanalen = this.chain.stemIn.map(() => ({ filter: null, send: { A: null, B: null }, cue: null,
      nu: { filter: false, doelen: filterDoelen(0.5), send: { A: 0, B: 0 }, cue: 0 } }));
    // Per stem (bij het NUMMER, zoals niveau en kill): filter 0..1 (0,5 = open),
    // sends 0..1 per bus, cue aan/uit.
    this.stemFilters = Object.fromEntries(STEM_NAMEN.map((n) => [n, 0.5]));
    this.stemSendStand = Object.fromEntries(STEM_BUSSEN.map((b) => [b, Object.fromEntries(STEM_NAMEN.map((n) => [n, 0]))]));
    this.stemPfl = Object.fromEntries(STEM_NAMEN.map((n) => [n, false]));

    // UI-state, genormaliseerd 0..1 — precies wat MIDI later ook levert.
    // `ui.x` LEEST de stand van nu: tijdens het glijden (glide) de tussenstand
    // op de audioklok, zodat scherm, LED's, soft-takeover, maatgever en video
    // meelopen. Schrijven zet de stand zonder geluid (zoals vroeger) en stopt
    // het glijden; via set() gaat het ook naar de audio.
    this._ui = { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 1, sendA: 0, sendB: 0 };
    this._glij = {};            // knop -> { van, naar, t0, t1, vorige } zolang hij glijdt
    this.ui = {};
    for (const p of Object.keys(this._ui)) {
      Object.defineProperty(this.ui, p, { enumerable: true,
        get: () => this._stand(p), set: (v) => { this._ui[p] = v; this._glij[p] = null; } });
    }
    this.applyUi();
  }

  // Doorgeefluiken naar de bron. Bestaande code en tests blijven werken.
  get buffer() { return this.bron.buffer; }
  get playing() { return this.bron.speelt; }
  get duration() { return this.bron.duur; }
  get position() { return this.bron.positie; }
  get loop() { return this.bron.loop; }
  set loop(v) { if (v) this.bron.setLoop(v.start, v.end); else this.bron.clearLoop(); }

  // ---- laden -------------------------------------------------------------

  /** Van soort bron wisselen. Alleen bij het laden, dus er klinkt niets. */
  _zetBron(bron) {
    if (this.bron === bron) return;
    this.bron?.vernietig();
    this.bron = bron;
    bron.zetRek?.({ keylock: this._keylock, toon: this._toon, stems: this._stemToonPerPaar() });
    bron.onEinde = () => this.emit('change', this);
    bron.onFout = (tekst) => this.emit('fout', tekst);
    // De rem is uitgelopen: de bron staat nu stil op die plek (een pauze).
    bron.onRemKlaar = () => { this._heranker(); this.emit('change', this); };
    // Vaste punten: hier springt de DJ heen, dus daar mag een streamende bron
    // geen gat hebben. Een BufferBron negeert het, die heeft alles al.
    // Tijdens het laden horen cue en hotcues nog bij de OUDE track (ze worden
    // pas gewist als de laad slaagt): dan niets vastpinnen in het nieuwe bestand.
    // Het loop-in-punt en de loop voor reloop horen erbij: daar springt de
    // loop straks naartoe, ook als dat verder dan 5 s terug ligt.
    bron.vastpunten = () => (this._laadt ? [] : [this.cuePoint, ...this.hotcues, this.loop?.start ?? null,
      this.loopInPunt, this.vorigeLoop?.start ?? null]);
  }

  /** Een heel bestand, uitgepakt in het geheugen: losgesleepte bestanden en de demotrack. */
  load(buffer, title) {
    if (!(this.bron instanceof BufferBron)) this._zetBron(new BufferBron(this.ctx, this.chain.input));
    this.bron.laad(buffer);
    this._naLaden(title);
  }

  /**
   * Streamen vanaf de server: wat uit de library komt. Een paar MB in het
   * geheugen in plaats van 23 MB per minuut.
   *
   * `opties.stems = { namen, schaal }`: het bestand is een stems.wav (twee of
   * vier stems als stereoparen, docs/STEMS.md). Het aantal kanalen moet dan
   * namen × 2 zijn, anders weigert de bron met een reden en blijft de oude
   * track staan (de app valt terug op audio.wav). Zonder stems: stereo.
   */
  async laadStream(url, title, opties) {
    const stems = opties?.stems ?? null;
    if (stems) {
      const fout = controleerStems(stems);
      if (fout) throw new Error(fout);
    }
    // De bron NIET met de opties van deze laad maken: een `haal` daarin werd
    // zijn standaard, en na een los bestand of de demo (laadGeheugen, de eerste
    // laad op een vers deck) las elke library-laad dan uit dat geheugen in
    // plaats van van de server: het verkeerde nummer onder de goede titel.
    // `haal` gaat per laad mee, hieronder.
    if (!(this.bron instanceof StreamBron)) this._zetBron(new StreamBron(this.ctx, this.chain.stemIn));
    // Cue en hotcues NIET hier wissen maar pas in _naLaden: mislukt de laad
    // (404, verkeerd formaat), dan staat de oude track er nog, met zijn punten.
    this._laadt = (this._laadt || 0) + 1;
    const bron = this.bron;
    try {
      await bron.laad({ url, haal: opties?.haal, kanalen: stems ? stems.namen.length * 2 : KANALEN });
    } catch (err) {
      if (err.vervangen) return false;      // er kwam een nieuwere laad overheen: die wint
      throw err;
    } finally {
      this._laadt--;
    }
    // Intussen leeggemaakt (er kwam een instrument op, leeg()): dit nummer hoort hier niet meer.
    if (this.bron !== bron) return false;
    this._naLaden(title, stems);
    return true;
  }

  /**
   * Een AudioBuffer (los bestand, demotrack) via de streamkern: eerst naar
   * het formaat van de ingest, dan door dezelfde StreamBron als de library.
   * Loop-naad, declick en knippen werken daardoor overal hetzelfde.
   * Geeft false als er intussen een nieuwere laad overheen kwam.
   */
  async laadGeheugen(buffer, title) {
    const kanalen = [buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)];
    const wav = maakWav(kanalen, buffer.sampleRate);
    this._geheugenNr = (this._geheugenNr || 0) + 1;
    return this.laadStream(`geheugen:${this.id}:${this._geheugenNr}`, title, { haal: geheugenHaal(wav) });
  }

  /** Wordt er nu iets geladen (laadStream loopt nog)? */
  get laadt() { return !!this._laadt; }

  /**
   * Het nummer eraf: de track is daarna leeg, zoals bij het opstarten. Voor
   * een instrument op deze track (ST7: een track draagt een nummer óf een
   * instrument, docs/INSTRUMENTEN.md §6). Ook een laad die nog loopt telt
   * niet meer (laadStream ziet een andere bron en geeft false).
   *
   * Klikvrij: de oude bron stopt met zijn eigen uitvloeien (DECLICK, of de
   * overgang van de streamkern) en wordt pas daarna opgeruimd; losmaken
   * terwijl er nog signaal loopt tikt. De strip (EQ, effect, fader, sends)
   * blijft zoals hij is: die is van de track, niet van het nummer.
   * Meldt 'load' (iets anders op deze track: hotcue-opslag en sampler laten
   * het oude nummer los) en 'change'.
   */
  leeg() {
    const oud = this.bron;
    try { oud.stop(); } catch (_) {}
    oud.onEinde = null;
    oud.onFout = null;
    oud.onRemKlaar = null;
    this.bron = null;                       // _zetBron ruimt de oude dan niet meteen op
    this._zetBron(new BufferBron(this.ctx, this.chain.input));
    const t = setTimeout(() => { try { oud.vernietig(); } catch (_) {} }, 100);
    t?.unref?.();
    clearTimeout(this._wisselTimer);
    this._wisselTimer = null;
    this.title = '— leeg —';
    this._zetStems(null);
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    this.grid = null;
    this.gridVersie++;
    this.onsets = null;
    this.tellen = null;
    this.toonKaart = null;
    this.sectieKaart = null;
    this._sectieSprong = null;
    this.loopBeats = null;
    this.loopInPunt = null;
    this.vorigeLoop = null;
    this.buigt = 0;
    this._gridTerug = [];
    this.setRate(1);
    this.setTranspositie(0);
    this.fx.heranker();
    this.emit('load', this);
  }

  _naLaden(title, stems = null) {
    this.title = title || 'untitled';
    this._zetStems(stems);
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    this.grid = null;
    this.gridVersie++;
    this.onsets = null;
    this.tellen = null;
    this.toonKaart = null;
    this.sectieKaart = null;
    this._sectieSprong = null;
    this.loopBeats = null;
    this.loopInPunt = null;
    this.vorigeLoop = null;
    // Een nieuw nummer begint op 0%: de pitch van het vorige zegt niets over
    // dit nummer. Het bereik blijft staan, dat is een keuze van de DJ. Zo ook
    // de toon (K5); keylock blijft staan (K4).
    this._gridTerug = [];
    this.setRate(1);
    this.setTranspositie(0);
    this.emit('load', this);
  }

  // ---- keylock en toon (docs/KEYLOCK.md) -----------------------------------

  /** Keylock: het tempo verandert, de toon blijft staan. */
  get keylock() { return this._keylock; }
  /** Toonverschuiving in halve tonen (−12..+12), met of zonder keylock (K8). */
  get transpositie() { return this._toon; }

  setKeylock(aan) {
    const v = !!aan;
    if (v === this._keylock) return;
    this._keylock = v;
    this.bron.zetRek?.({ keylock: v, toon: this._toon, stems: this._stemToonPerPaar() });
    this.emit('change', this);
  }

  setTranspositie(n) {
    const v = Math.max(-TOON_MAX, Math.min(TOON_MAX, Math.round(Number(n) || 0)));
    if (v === this._toon) return;
    this._toon = v;
    this.bron.zetRek?.({ keylock: this._keylock, toon: v, stems: this._stemToonPerPaar() });
    this.emit('change', this);
  }

  /**
   * Een eigen toon voor één stem (halve tonen, −TOON_MAX..+TOON_MAX), bovenop
   * de toon van de track; het tempo blijft (6 okt). `inst` bij vier stems
   * telt op bij drums, bas en overig. Een stem die er niet is: niets. Een
   * nieuw nummer begint weer op 0, zoals de toon van de track (K5).
   */
  setStemToon(s, n) {
    if (!this.stemBestaat(s)) return;
    const v = Math.max(-TOON_MAX, Math.min(TOON_MAX, Math.round(Number(n) || 0)));
    if (v === (this._stemToon[s] ?? 0)) return;
    if (v) this._stemToon[s] = v; else delete this._stemToon[s];
    this.bron.zetRek?.({ keylock: this._keylock, toon: this._toon, stems: this._stemToonPerPaar() });
    this.emit('change', this);
  }

  /** De eigen toon van een stem (halve tonen), of null als die stem er niet is. */
  stemToon(s) { return this.stemBestaat(s) ? (this._stemToon[s] ?? 0) : null; }

  /** De toonsoort die je van deze stem HOORT (zoals `toonsoort`, met zijn eigen toon erbij), of null. */
  stemToonsoort(s) {
    if (!this.toonKaart || !this.stemBestaat(s)) return null;
    const vier = this.stems.aantal === 4;
    const extra = (this._stemToon[s] ?? 0) + (vier && s !== 'vocals' && s !== 'inst' ? (this._stemToon.inst ?? 0) : 0);
    return this.toonKaart.hoorbaarBij(hoorbaar(this, uitgangsVertraging(this.ctx)),
      { rate: this.rate, transpositie: this._toon + extra, keylock: this._keylock });
  }

  /** Halve tonen per stereopaar van het bestand (de stems op volgorde), of null zonder stems of zonder eigen toon. */
  _stemToonPerPaar() {
    if (!this.stems) return null;
    const vier = this.stems.aantal === 4, inst = this._stemToon.inst ?? 0;
    const uit = this.stems.namen.map((n) => (this._stemToon[n] ?? 0) + (vier && n !== 'vocals' ? inst : 0));
    return uit.some((x) => x !== 0) ? uit : null;
  }

  // ---- transport ---------------------------------------------------------

  stop() { this.bron.stop(); }

  /**
   * Spelen vanaf de positie. Met `op` (audiokloktijd, later dan nu) begint
   * het geluid pas dan, sample-exact: starten op de maat (Engine.startOpDeMaat).
   * Tot dan geldt het deck als spelend, maar staat de positie stil; pauze
   * annuleert het.
   */
  play({ op = null } = {}) {
    if (!this.buffer || this.playing) return;
    let at = this.position;
    if (at >= this.duration - 0.01) at = 0;
    this.bron.start(at, op === null ? undefined : { op });
    this._heranker();
    this.emit('change', this);
  }

  /** Wacht dit deck op een geplande start (starten op de maat)? */
  get wacht() { return this.bron.wachtTot != null; }

  /**
   * Een wachtende start naar een ander moment verzetten, vanaf hetzelfde
   * startpunt (Engine._volgWachtenden: de maat verschoof). Speelt hij al, dan niets.
   */
  herplan(op) {
    if (!this.wacht) return;
    this.bron.start(this.position, { op });
    this._heranker();
    this.emit('change', this);
  }

  /** Opties voor bron.start: tijdens het wachten hetzelfde startmoment houden. */
  _startOpties(extra) {
    const op = this.bron.wachtTot;
    return op == null ? extra : { ...extra, op };
  }

  pause() {
    if (!this.playing) return;
    this.bron.pauzeer();
    this.emit('change', this);
  }

  /**
   * Play/pauze. Tijdens een rem: los, en gewoon door (zoals start/stop op een
   * draaitafel die nog uitloopt: de motor pakt hem weer op).
   */
  togglePlay() {
    if (this.remt) this.laatRemLos();
    else if (this.playing) this.pause();
    else this.play();
  }

  /**
   * Naar tracktijd `pos` springen.
   *
   * Ligt die plek BUITEN de loop, dan verlaat je de loop, zoals op elke
   * DJ-speler: een hotcue verderop moet daar landen, niet teruggevouwen in de
   * loop (de BufferBron wrapte naar loopStart, de streamkern vouwde terug).
   * Erbinnen blijft de loop staan.
   *
   * `binnenLoop` is voor fasecorrectie (sync, nudge): een verschuiving van een
   * fractie van een tel die over de loopgrens valt, wordt teruggevouwen in de
   * loop in plaats van hem te verlaten.
   */
  seek(pos, { binnenLoop = false, doorlopend = false } = {}) {
    if (!this.buffer) return;
    let p = clamp(pos, 0, this.duration);
    const l = this.loop;
    if (l && (p < l.start || p >= l.end)) {
      const len = l.end - l.start;
      if (binnenLoop && len > 0) p = l.start + ((((p - l.start) % len) + len) % len);
      else this._verlaatLoop();
    }
    // Wacht het deck op de maat, dan blijft die start staan: alleen het punt
    // waar hij begint verschuift (hotcue, beatjump, nudge tijdens het wachten).
    if (this.playing) this.bron.start(p, this._startOpties(doorlopend ? { doorlopend } : undefined));
    else this.bron.plaats(p);
    this._heranker();
    this.emit('change', this);
  }

  /** Een duwtje in de fase: met keylock fasebehoudend gepland (KEYLOCK EN TOON in bron.js). */
  nudge(seconds) { this.seek(this.position + seconds, { binnenLoop: true, doorlopend: true }); }

  /** Loop eraf zonder 'change' te melden: de aanroeper meldt zelf. */
  _verlaatLoop() {
    this._onthoudLoop();
    this.loopBeats = null;
    if (this.loop) this.bron.clearLoop();
  }

  /** De loop die eraf gaat bewaren voor reloop (zoals op een CDJ). */
  _onthoudLoop() {
    const l = this.loop;
    if (l) this.vorigeLoop = { start: l.start, end: l.end, beats: this.loopBeats ?? null };
  }

  /** Pitchfader 0..1 (midden = 0%), geschaald op het bereik van deze track. */
  setPitch(v) { this.setRate(1 + (clamp(v) * 2 - 1) * this.pitchBereik); }

  /** Waar de pitchfader hoort te staan. Geklemd: na een grote sync staat hij tegen de aanslag. */
  get pitch() { return clamp(0.5 + (this.rate - 1) / (2 * this.pitchBereik)); }

  /**
   * Volgend bereik. Het tempo blijft gelijk; alleen de faderstand verschuift,
   * en soft-takeover vangt dat op.
   */
  volgendBereik() {
    const i = PITCH_BEREIKEN.indexOf(this.pitchBereik);
    this.pitchBereik = PITCH_BEREIKEN[(i + 1) % PITCH_BEREIKEN.length];
    this.emit('change', this);
  }

  /**
   * Tijdelijk trager of sneller zolang je drukt (nudge op een DJ-controller):
   * richting -1 of +1, en 0 = loslaten. Alleen de BRON draait anders; `rate`
   * (en dus pitchfader, bpm en sync) blijft staan, zodat loslaten precies
   * terug is waar je was. 4% is genoeg om een tel in te halen zonder dat het
   * als een pitchsprong klinkt.
   */
  bend(richting) {
    this.bron.setRate(richting ? this.rate * (1 + BEND * Math.sign(richting)) : this.rate);
    this.buigt = richting ? Math.sign(richting) : 0;
    this._heranker();
  }

  // ---- rem (vinylstop) -----------------------------------------------------

  /** Remt dit deck nu (de snelheid loopt naar 0)? */
  get remt() { return !!this.bron.remt; }

  /**
   * Hoe snel de positie NU loopt, in tracktijd per seconde: de rate met bend,
   * en tijdens een rem wat daarvan over is. Voor de video, die een rem moet
   * volgen zonder te springen.
   */
  get snelheid() { return this.bron.snelheid ?? this.rate; }

  /**
   * Remmen tot stilstand in `remTijd` seconden, daarna gepauzeerd op de plek
   * waar hij stilviel; play speelt dan gewoon verder. Nog eens drukken tijdens
   * het remmen = LOS: meteen weer op tempo, zoals de start/stop-knop van een
   * draaitafel die nog uitloopt, en je kunt er een "tape stop" mee maken die
   * op de drop weer invalt. Wie meteen stil wil: pauze. Op een stilstaand deck
   * doet hij niets: een rem mag nooit onverwacht iets starten.
   *
   * Effecten op de tel van dit deck houden hun laatste tempo (fxKlok geeft
   * tijdens de rem niets, dus er wordt niet opnieuw aangehaakt), en een
   * remmende track geeft geen maat meer (Engine.maatgever).
   */
  rem() {
    if (this.remt) { this.laatRemLos(); return true; }
    // Een track die op zijn start op de maat wacht klinkt nog niet: een rem
    // zou hem NU laten beginnen, remmend. Niets doen (een rem start nooit iets).
    if (!this.buffer || !this.playing || this.wacht) return false;
    if (!this.bron.rem?.(this.remTijd)) return false;
    this.emit('change', this);
    return true;
  }

  /** De rem eraf: vanaf waar hij nu is gewoon verder op zijn tempo. */
  laatRemLos() {
    if (!this.remt) return;
    this.bron.start(this.position);
    this._heranker();
    this.emit('change', this);
  }

  /** Remtijd als knop 0..1 (exponentieel, REM_MIN–REM_MAX seconden). */
  setRemTijd(norm) {
    this.remTijd = REM_MIN * Math.pow(REM_MAX / REM_MIN, clamp(norm));
    this.emit('change', this);
  }

  get remKnop() { return Math.log(this.remTijd / REM_MIN) / Math.log(REM_MAX / REM_MIN); }

  setRate(r) {
    const nr = clamp(r, 0.5, 2);
    this.rate = nr;
    this.bron.setRate(this.buigt ? nr * (1 + BEND * this.buigt) : nr);
    this._heranker();
    this.emit('change', this);
  }

  /**
   * Wat een tempo-gesynchroniseerd effect nodig heeft: de HOORBARE tellengte
   * en het moment waarop de eerstvolgende tel valt, op de audioklok.
   *
   * Null als er geen grid is of het deck stilstaat — dan loopt een gate gewoon
   * niet, en dat is eerlijker dan hem op een verzonnen tempo laten draaien.
   */
  fxKlok() {
    // Remmen: geen maat. Wat al op de tel loopt houdt zijn tempo.
    if (!this.grid || !this.playing || this.remt) return null;
    // De tel die komt, en hoe lang DIE duurt (tot de tel erna): met een
    // tempokaart is dat het tempo van het stuk waar je naartoe gaat.
    const n = Math.ceil(this.grid.beatAt(this.position) - 1e-9);
    const volgende = this.grid.timeOf(n);
    return {
      beatLengte: (this.grid.timeOf(n + 1) - volgende) / this.rate,
      ankerCtx: this.ctxTimeOf(volgende),
    };
  }

  /**
   * Effecten op de tel opnieuw laten aanhaken, en — als het grid uit stukken
   * bestaat — dat nog een keer doen zodra de speelkop een tempowissel passeert.
   * Die timer bepaalt alleen WANNEER er herankerd wordt; waar de tel ligt komt
   * van de audioklok (regel 3). Zonder dit liep een gate na een stukgrens door
   * op het tempo van het vorige stuk.
   */
  _heranker() {
    this.fx.heranker();
    clearTimeout(this._wisselTimer);
    this._wisselTimer = null;
    if (!this.grid || !this.playing) return;
    // Wacht hij op zijn start op de maat, dan eerst op DIE start: pas vanaf
    // dan klinkt hij en telt hij mee als maatgever (Engine.syncMaster), en
    // dan moeten echo en sampler opnieuw aanhaken.
    let op = this.bron.wachtTot;
    if (op == null) {
      if (this.grid.aantalStukken < 2) return;
      const wissel = this.grid.volgendeWissel(this.position);
      op = wissel === null ? null : this.ctxTimeOf(wissel);
    }
    if (op === null || !Number.isFinite(op)) return;
    const ms = Math.max(0, (op - this.ctx.currentTime) * 1000) + 5;
    this._wisselTimer = setTimeout(() => {
      this._wisselTimer = null;
      if (!this.playing) return;
      this._heranker();
      this.emit('change', this);            // bussen en sampler volgen de maat
    }, ms);
    this._wisselTimer?.unref?.();
  }

  /**
   * Wanneer passeert dit deck deze TRACKTIJD, gemeten op de audioklok?
   * Null als hij stilstaat. Dit is de brug die je nodig hebt om iets
   * sample-accuraat op de tel te starten — een gate, een stutter, een LFO.
   */
  ctxTimeOf(trackTijd) { return this.bron.ctxTimeOf(trackTijd); }

  /** CDJ-logica: spelend -> terug naar cue en pauzeren. Gepauzeerd -> cue hier zetten. */
  cue() {
    if (!this.buffer) return;
    if (this.playing) {
      this.stop();
      // Zelfde regel als seek: een cuepunt buiten de loop verlaat de loop,
      // anders vouwt de volgende play hem er weer in.
      const l = this.loop;
      if (l && (this.cuePoint < l.start || this.cuePoint >= l.end)) this._verlaatLoop();
      this.bron.plaats(this.cuePoint);
    }
    else if (Math.abs(this.position - this.cuePoint) < 0.005) { this.play(); }
    else {
      // Met quantize op de dichtstbijzijnde tel, en de speelkop gaat mee:
      // anders zette de volgende druk steeds opnieuw een cue in plaats van te spelen.
      this.cuePoint = this._snap(this.position);
      if (this.cuePoint !== this.position) this.bron.plaats(this.cuePoint);
    }
    this.emit('change', this);
  }

  // ---- hotcues & loops ---------------------------------------------------

  /*
   * Zetten en wissen melden zich ook als 'hotcue' ({ i, tijd }, tijd null =
   * gewist): de app bewaart ze bij het nummer. Het deck kent geen library;
   * springen naar een hotcue meldt niets, laden (alles wissen) ook niet.
   */
  hotcue(i, { del = false } = {}) {
    if (!this.buffer) return;
    if (del) {
      const had = this.hotcues[i] !== null;
      this.hotcues[i] = null;
      this.emit('change', this);
      if (had) this.emit('hotcue', { i, tijd: null });
      return;
    }
    // Quantize: zetten op de tel, springen fasebehoudend (_snap, _faseDoel).
    // De melding leest de hotcue NA het zetten: de GESNAPTE tijd gaat naar
    // de server, niet de positie van het indrukken.
    const nieuw = this.hotcues[i] === null;
    if (nieuw) this.hotcues[i] = this._snap(this.position);
    else this._naarHotcue(this.hotcues[i]);
    this.emit('change', this);
    if (nieuw) this.emit('hotcue', { i, tijd: this.hotcues[i] });
  }

  /**
   * Bewaarde hotcues terugzetten (de app, na het laden van een nummer).
   * Alleen op LEGE plekken: wat je intussen zelf zette wint. Tijden buiten de
   * track of geen getal worden overgeslagen. Meldt geen 'hotcue': dit is
   * terugzetten, niet zetten. Geeft de plekken terug die gevuld werden.
   */
  restoreHotcues(tijden) {
    if (!this.buffer || !Array.isArray(tijden)) return [];
    const gezet = [];
    for (let i = 0; i < this.hotcues.length; i++) {
      const t = tijden[i];
      if (this.hotcues[i] !== null || typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > this.duration) continue;
      this.hotcues[i] = t;
      gezet.push(i);
    }
    if (gezet.length) {
      // Meteen vastpinnen (een streamende bron haalt ze anders pas bij zijn
      // volgende ronde): hotcues moeten direct klinken.
      this.bron.bijvullen?.().catch(() => {});
      this.emit('change', this);
    }
    return gezet;
  }

  /**
   * Naar een hotcue springen (met quantize fasebehoudend). Of een loop blijft,
   * hangt af van waar de HOTCUE ligt, niet van waar de sprong landt: die kan
   * tot een halve tel ernaast vallen. Een hotcue op het loopbegin, ingedrukt
   * op 0,6 van een tel, landde anders vóór de loop en haalde hem eraf; een
   * hotcue op het loopeinde (net erbuiten) landde erin en bleef erin hangen.
   * In de loop vouwt de sprong terug, zoals bij reloop.
   */
  _naarHotcue(h) {
    const doel = this._faseDoel(h);
    const l = this.loop;
    const binnen = !!l && h >= l.start && h < l.end;
    if (l && !binnen) this._verlaatLoop();
    // Gequantiseerd (doel ≠ h): fasebehoudend, ook met keylock. Anders de
    // aanslag van de hotcue zelf, exact (op T, K3).
    this.seek(doel, { binnenLoop: binnen, doorlopend: doel !== h });
  }

  // ---- quantize ----------------------------------------------------------

  /**
   * Mag het grid op tracktijd t gebruikt worden om op te snappen? Alleen in
   * een zeker stuk (of op slot): een cue op een verkeerde tel is erger dan
   * een cue een fractie naast de tel. Zelfde regel als sync en beat-loops.
   */
  _opGrid(t) { return !!this.grid && this.grid.zekerBij(t); }

  /** Quantize aan en het grid daar zeker: de dichtstbijzijnde tel. Anders t zelf. */
  _snap(t) {
    return this.quantize && this._opGrid(t) ? clamp(this.grid.nearest(t), 0, this.duration) : t;
  }

  /**
   * Waar een sprong naar `doel` landt. Met quantize, tijdens het spelen, op
   * een zeker grid: fasebehoudend (Beatgrid.metFaseVan), meteen en zonder te
   * struikelen: een hotcue op de tel, ingedrukt op 0,3 van een tel, landt op
   * 0,3 na de hotcue. Zo doen Traktor en Mixxx het ook. Wachten tot de
   * volgende tel klinkt hetzelfde, maar reageert tot een tel trager.
   */
  _faseDoel(doel) {
    if (!this.quantize || !this.playing || !this._opGrid(this.position) || !this._opGrid(doel)) return doel;
    return clamp(this.grid.metFaseVan(doel, this.position), 0, this.duration);
  }

  // ---- beatjump ----------------------------------------------------------

  /** Beatjump-lengte halveren of verdubbelen, binnen SPRONG_TELLEN. */
  halveerSprong() { this._zetSprong(-1); }
  verdubbelSprong() { this._zetSprong(1); }
  _zetSprong(stap) {
    const i = SPRONG_TELLEN.indexOf(this.sprongTellen);
    const j = clamp((i < 0 ? SPRONG_TELLEN.indexOf(4) : i) + stap, 0, SPRONG_TELLEN.length - 1);
    this.sprongTellen = SPRONG_TELLEN[j];
    this.emit('change', this);
  }

  /**
   * Beatjump: `richting` (−1 of +1) × de ingestelde lengte, of × `tellen`
   * als die meekomt, op het grid.
   *
   * In TELLEN (Beatgrid.verschuif): de fase binnen de tel blijft precies
   * gelijk, ook over een stukgrens van de tempokaart. Binnen een loop schuift
   * de LOOP mee, zoals in Traktor, rekordbox en Serato: de speelkop houdt zijn
   * plek in de loop en je hoort dezelfde loop verderop in het nummer. Alleen
   * de speelkop verplaatsen zou de loop verlaten, en dan was beatjump in een
   * loop niets anders dan de loop uitzetten.
   *
   * Zonder grid, of met een onzeker stuk (bij de speelkop, het doel of de
   * verschoven loop) zonder slot: weigeren, net als beat-loops. Een sprong
   * die een fractie van een tel naast valt, hoor je meteen.
   *
   * Voorbij het EINDE (zonder loop) ook weigeren ('einde'), net als een loop
   * die buiten het nummer zou vallen ('rand'). Klemmen op het einde liet de
   * track eindigen en stoppen: midden in een set is dat stilte op de vloer.
   * Klemmen op de laatste hele tel die nog past helpt niet: dan eindigt hij
   * een tel later alsnog, en de sprong is ongemerkt korter dan de lengte die
   * je koos (weg frase). Weigeren laat de muziek gewoon doorspelen, met een
   * melding; wat er nog over is, kun je zelf met een kortere sprong nemen.
   * Voorbij het BEGIN ook weigeren ('begin', Clay 26 sep, VRAGEN J4): klemmen
   * op 0 liet de fase verspringen, en dat breekt de beatmatch van een track
   * die je net inmixt.
   *
   * @returns {{ ok: boolean, waarom?: 'leeg'|'geengrid'|'onzeker'|'rand'|'einde'|'begin' }}
   */
  beatjump(richting, tellen = this.sprongTellen) {
    if (!this.buffer) return { ok: false, waarom: 'leeg' };
    if (!this.grid) return { ok: false, waarom: 'geengrid' };
    const g = this.grid, p = this.position;
    const n = Math.sign(richting) * tellen;
    const doel = g.verschuif(p, n);
    const l = this.loop;
    // Vóór de grid-controle: een doel vóór 0 ligt buiten elk stuk en zou
    // anders als 'onzeker' gemeld worden.
    if (!l && n < 0 && doel < -1e-9) return { ok: false, waarom: 'begin' };
    if (!this._opGrid(p) || !this._opGrid(doel)) return { ok: false, waarom: 'onzeker' };
    if (!l) {
      // Precies OP het einde landen is ook eindigen: dan stopt hij meteen.
      if (n > 0 && doel >= this.duration) return { ok: false, waarom: 'einde' };
      this.seek(doel, { doorlopend: true });
      return { ok: true };
    }
    const start = g.verschuif(l.start, n), eind = g.verschuif(l.end, n);
    if (!this._opGrid(start) || !this._opGrid(eind)) return { ok: false, waarom: 'onzeker' };
    if (start < 0 || eind > this.duration + 1e-9) return { ok: false, waarom: 'rand' };
    // Begin en einde schuiven evenveel tellen: loopBeats blijft kloppen.
    this._spring(doel, { start, end: eind }, true);
    return { ok: true };
  }

  /**
   * Loop en positie in één keer: één segment voor de streamkern, één nieuwe
   * bron voor de BufferBron. Klikvrij via de gewone overgang van een sprong.
   */
  _spring(p, loop, doorlopend = false) {
    const pos = clamp(p, 0, this.duration);
    if (this.playing) this.bron.start(pos, this._startOpties(doorlopend ? { loop, doorlopend } : { loop }));
    else { this.bron.setLoop(loop.start, loop.end); this.bron.plaats(pos); }
    this._heranker();
    this.emit('change', this);
  }

  // ---- beatgrid ----------------------------------------------------------

  setGrid(grid) {
    this.grid = grid instanceof Beatgrid ? grid : Beatgrid.van(grid);
    this.gridVersie++;
    this._heranker();
    this.emit('change', this);
    return this.grid;
  }

  /**
   * Na een bewerking van het grid zelf (tel hier, schuiven, ×2, stuk erbij):
   * effecten op de tel moeten opnieuw aanhaken, anders lopen ze door op het
   * oude grid.
   */
  gridGewijzigd() {
    // Met de hand bewerkt: geen automatisch voorstel meer, dus de server
    // analyseert hem bij het opstarten niet opnieuw (zie Beatgrid.bron).
    if (this.grid) this.grid.bron = 'hand';
    this.gridVersie++;
    this._heranker();
    this.emit('change', this);
  }

  /**
   * Hoe het grid op de tellen valt (meetGrid, src/engine/tellen.js), per stuk.
   * Null zonder grid of zonder tellen. Onthouden tot het grid of de tellen
   * veranderen: een uur is ~9.000 tellen, de renderloop vraagt elke frame.
   */
  get gridMeting() {
    if (!this.grid || !this.tellen) return null;
    const k = this._meting;
    if (k && k.versie === this.gridVersie && k.grid === this.grid && k.tellen === this.tellen) return k.meting;
    const meting = meetGrid(this.grid, this.tellen.beats, this.tellen.downbeats);
    this._meting = { versie: this.gridVersie, grid: this.grid, tellen: this.tellen, meting };
    return meting;
  }

  /**
   * TERUG (5 okt): vóór een bewerking met de hand het grid zoals het was
   * (of `stand`, een toJSON van vlak ervoor), zodat een verkeerde tik, pin of
   * ×2 terug kan. Hooguit GRID_TERUG stappen; leeg bij een nieuw nummer.
   */
  gridVoorBewerking(stand = this.grid ? this.grid.toJSON() : null) {
    this._gridTerug.push(stand);
    if (this._gridTerug.length > GRID_TERUG) this._gridTerug.shift();
  }

  /** Kan het grid een stap terug? */
  get kanGridTerug() { return this._gridTerug.length > 0; }

  /** Het grid van vóór de laatste bewerking terug. False als er niets is. */
  gridTerug() {
    if (!this._gridTerug.length) return false;
    const vorig = this._gridTerug.pop();
    this.grid = vorig ? new Beatgrid(vorig) : null;
    this.gridGewijzigd();
    return true;
  }

  /**
   * Is het grid HIER te vertrouwen voor sync en beat-loops? Null zonder grid.
   * Zie Beatgrid.zekerBij: op slot altijd, anders alleen een zeker stuk.
   */
  get gridZekerHier() { return this.grid ? this.grid.zekerBij(this.position) : null; }

  /** Hoorbare bpm op de huidige plek: het grid staat in tracktijd, de rate rekt dat op. */
  get bpm() { return this.grid ? this.grid.bpmAt(this.position) * this.rate : null; }

  // ---- toonsoort ---------------------------------------------------------

  setToonKaart(kaart) {
    this.toonKaart = kaart instanceof ToonKaart ? kaart : ToonKaart.van(kaart);
    this.emit('change', this);
    return this.toonKaart;
  }

  /**
   * Na een bewerking met de hand (kwint, relatief, nieuw stuk): de kaart is
   * geen voorstel van de analyse meer, dus de achtergrond laat hem staan.
   */
  toonGewijzigd() {
    if (this.toonKaart) this.toonKaart.bron = 'hand';
    this.emit('change', this);
  }

  /**
   * De toonsoort die je HOORT op de huidige plek (Clay, T3), of null zonder
   * kaart: de plaat verschoven met de pitch (rate, zonder bend: die zou laten
   * flikkeren zolang je duwt) en straks transpositie en keylock. Zie
   * hoorbaar() in toonsoort.js. De plek is wat je hoort (engine/hoorbaar.js:
   * positie min uitgangsvertraging), dezelfde plek waar track.N.key.* een
   * stuk corrigeert; de positie komt van de audioklok (regel 3).
   */
  get toonsoort() {
    if (!this.toonKaart) return null;
    return this.toonKaart.hoorbaarBij(hoorbaar(this, uitgangsVertraging(this.ctx)),
      { rate: this.rate, transpositie: this._toon, keylock: this._keylock });
  }

  // ---- secties (docs/SECTIES.md) ---------------------------------------

  /** De sectiekaart van de server (JSON of SectieKaart), of null. */
  setSectieKaart(kaart) {
    this.sectieKaart = kaart ? SectieKaart.van(kaart) : null;
    this._sectieSprong = null;
    this.emit('change', this);
    return this.sectieKaart;
  }

  /** De sectie die je HOORT (index vanaf 0), of −1 zonder kaart. Zelfde plek als de toonsoort. */
  get sectieHier() {
    if (!this.sectieKaart || !this.buffer) return -1;
    return this.sectieKaart.index(hoorbaar(this, uitgangsVertraging(this.ctx)));
  }

  /**
   * De sectie op de eerstvolgende "1" (index), of −1 zonder kaart: daar staat
   * de speelkop straks echt, ook tijdens de aanloop van een sprong (dan hoor je
   * nog de maat ervóór). Volgende/vorige rekenen hiervanaf. Zonder zeker grid:
   * de sectie op de positie.
   */
  get sectieOpDeMaat() { return this.buffer ? this._sectieOpDeMaatVan(this.position) : -1; }

  /** sectieOpDeMaat, gerekend vanaf tracktijd p (waar de speelkop stond bij een druk, drukPlek). */
  _sectieOpDeMaatVan(p) {
    if (!this.sectieKaart || !this.buffer) return -1;
    const g = this.grid;
    // Tijdens de aanloop van een sprong: de sectie waar hij heen gaat. Het grid
    // ziet daar de maat van het stuk ervóór, en die kan een andere "1" hebben.
    // (De aanloop zelf ligt bij terugspelen een paar ms naast: daarom het begin
    // ervan tegen de positie van nu.)
    const s = this._sectieSprong;
    if (s && this.position >= s.van - 1e-3 && p < s.tot) return s.i;
    if (!g || !this.sectieKaart.opGrid || !this._opGrid(p)) return this.sectieKaart.index(p);
    const tellen = g.barPhase(p) * g.beatsPerBar;
    return this.sectieKaart.index(tellen < 0.02 ? p : g.verschuif(p, g.beatsPerBar - tellen));
  }

  /** Begin en einde van sectie i, of null. */
  sectieBereik(i) {
    const k = this.sectieKaart, b = k?.begin(i);
    return b == null ? null : { start: b, end: k.eind(i, this.duration) };
  }

  /** Is de loop nu precies sectie i? */
  loopIsSectie(i) {
    const r = this.sectieBereik(i), l = this.loop;
    return !!(r && l && Math.abs(l.start - r.start) < 1e-3 && Math.abs(l.end - r.end) < 1e-3);
  }

  /**
   * Naar sectie i (vanaf 0). Tijdens het spelen valt hij in op de
   * eerstvolgende maat (sectieDoel: de aanloop uit het nummer zelf, geen
   * wachten, geen struikelende fase); stilstaand op het begin. Met `loop`:
   * de sectie wordt de loop (staat die loop er al, dan gaat hij eraf), en
   * speel je er al in, dan blijft de speelkop waar hij is.
   * Zonder zeker grid (of een kaart zonder grid) springt hij gewoon naar het
   * begin, zoals een hotcue zonder quantize.
   *
   * Terugspelen (`laat`, `van`, docs/HANDELINGENLOG.md): de druk komt tot een
   * tik te laat. Dan beslissen vanaf waar de speelkop stond toen je drukte
   * (drukPlek), en het doel even ver doorschuiven als hij sindsdien speelde.
   * Zonder dat viel een druk binnen de marge net na de "1" (0,02 tel) bij
   * terugspelen soms buiten die marge: dezelfde sectie een maat later.
   * @returns {{ ok: boolean, waarom?: 'leeg'|'geensecties'|'geen' }}
   */
  naarSectie(i, { loop = false, laat = 0, van = null } = {}) {
    return this._naarSectie(i, loop, () => this.drukPlek({ laat, van }));
  }

  /**
   * Naar de volgende (stap 1) of vorige (−1) sectie, gerekend vanaf de sectie
   * op de maat (sectieOpDeMaat): tijdens een aanloop gaat "volgende" verder
   * dan de sectie waar je al heen sprong. Eén plek voor beide beslissingen
   * (welke sectie, en welke "1"): `druk` zoals bij naarSectie.
   */
  naarSectieStap(stap, druk = {}) {
    if (!this.buffer) return { ok: false, waarom: 'leeg' };
    if (!this.sectieKaart) return { ok: false, waarom: 'geensecties' };
    const p = this.drukPlek(druk);
    const i = this._sectieOpDeMaatVan(p) + stap;
    if (i < 0 || i >= this.sectieKaart.aantal) return { ok: false, waarom: 'geen' };
    return this._naarSectie(i, false, () => p);
  }

  /**
   * De sprong zelf, vanaf tracktijd plek() (pas gelezen na de controles).
   * Meldt 'sectiedruk' { i, van } als hij speelt: de plek waarvan hij rekende.
   * Het handelingenlog zet die bij de druk (logboek.js), zodat terugspelen
   * precies dezelfde beslissing neemt; ook als de audioklok tussen twee
   * lezingen in dezelfde taak een stap (2,67 ms) verder ging.
   */
  _naarSectie(i, loop, plek) {
    if (!this.buffer) return { ok: false, waarom: 'leeg' };
    if (!this.sectieKaart) return { ok: false, waarom: 'geensecties' };
    const r = this.sectieBereik(i);
    if (!r || !this._loopMag(r.start, r.end)) return { ok: false, waarom: 'geen' };
    const p = plek();                                // waar de speelkop stond bij de druk
    if (this.playing) this.emit('sectiedruk', { i, van: p });
    const terug = this.position - p;
    const zeker = (t) => this.sectieKaart.opGrid && this._opGrid(t);
    const doelToen = this.playing ? sectieDoel(this.grid, p, r.start, zeker) : r.start;
    const doel = doelToen + terug;                   // waar hij nu zou zijn, na die sprong
    const doorlopend = doelToen !== r.start;
    const een = this.playing && zeker(r.start) ? sectieEen(this.grid, r.start) : r.start;
    const sprong = doel < een ? { i, van: doel, tot: een } : null;
    if (loop) {
      if (this.loopIsSectie(i)) { this.clearLoop(); return { ok: true }; }
      const tellen = this.grid && zeker(r.start) ? Math.round(this.grid.beatAt(r.end) - this.grid.beatAt(r.start)) : null;
      if (p >= r.start && p < r.end) { this._zetLoop(r.start, r.end, tellen); return { ok: true }; }
      this._onthoudLoop();
      this.loopBeats = tellen;
      this._sectieSprong = sprong;
      this._spring(doel, { start: r.start, end: r.end }, doorlopend);
      return { ok: true };
    }
    if (this.loop) this._verlaatLoop();
    this._sectieSprong = sprong;
    this.seek(doel, { doorlopend });
    return { ok: true };
  }

  /**
   * Waar de speelkop stond toen je drukte: daarvan rekent een sectiesprong.
   * Live is dat nu. Terugspelen komt tot een tik (10 ms) te laat en ligt een
   * paar ms naast het origineel (de beginstand: een stap van de audioklok):
   * - `van`: de plek uit het log, waar de sprong TOEN van rekende. Dezelfde
   *   beslissing (welke "1"), ook als het terugspelen een paar ms naast ligt;
   *   alleen als hij past bij waar de track nu is (DRUK_NAAST).
   * - anders `laat` (s audioklok te laat): zoveel tracktijd terug.
   * Stilstaand, wachtend op de maat of remmend: nu.
   */
  drukPlek({ laat = 0, van = null } = {}) {
    const p = this.position;
    if (!this.playing || this.wacht || this.remt) return p;
    const s = laat > 0 ? laat * this.rate : 0;
    if (Number.isFinite(van) && Math.abs(p - s - van) <= DRUK_NAAST) return van;
    return p - s >= 0 ? p - s : p;
  }

  /**
   * Loop van een aantal tellen, ingeklikt op het grid.
   *
   * Het inklikken is het hele punt: een loop die een fractie naast de tel
   * begint hoor je meteen. Valt het einde achter de speelkop, dan pakken we de
   * eerstvolgende beat — anders loopt de bron buiten zijn eigen loop.
   */
  setBeatLoop(beats) {
    if (!this.buffer || !this.grid) return false;
    // In een onzeker stuk niet: een loop die naast de tel valt hoor je meteen.
    // De action meldt waarom (gridZekerHier), hier alleen de regel zelf.
    if (!this.gridZekerHier) return false;
    // In TELLEN rekenen, niet in seconden: over een stukgrens heen is een
    // tel niet overal even lang, dus het einde komt van timeOf.
    const g = this.grid;
    const p = this.position;
    let b = Math.round(g.beatAt(p));
    if (g.timeOf(b + beats) <= p) b = Math.ceil(g.beatAt(p) - 1e-9);
    const start = g.timeOf(b);
    const vol = g.timeOf(b + beats);
    const eind = Math.min(vol, this.duration);
    // Geklemd op het trackeinde is het geen `beats` tellen meer: dan geen LED.
    return this._zetLoop(start, eind, eind > vol - 1e-6 ? beats : null);
  }

  /** Zonder beatgrid loopen we in seconden. */
  setLoop(seconds) {
    if (!this.buffer) return;
    const start = this.position;
    if (!this._loopMag(start, Math.min(start + seconds, this.duration))) return;
    this.bron.setLoop(start, Math.min(start + seconds, this.duration));
    this.loopBeats = null;
    this.emit('change', this);
  }

  clearLoop() {
    this._onthoudLoop();
    this.loopBeats = null;
    if (!this.loop) return;
    this.bron.clearLoop();
    this.emit('change', this);
  }

  // ---- loop in / loop out / reloop (handmatig, zoals een CDJ) -------------

  /**
   * Loop in: het begin van een handmatige loop, op de positie (met quantize
   * op de dichtstbijzijnde tel). Er gebeurt nog niets hoorbaars: de loop gaat
   * pas aan bij loop out. Nog eens drukken zet een nieuw begin.
   */
  loopIn() {
    if (!this.buffer) return false;
    this.loopInPunt = this._snap(this.position);
    this.emit('change', this);
    return true;
  }

  /**
   * Loop out: het einde op de positie, en de loop gaat meteen aan. Met
   * quantize (en een zeker grid) een heel aantal tellen, minstens één; dan
   * weet de loop ook hoeveel tellen hij is (lampje van "loop 4", halveren).
   * Staat de speelkop vóór het begin, dan niets: het in-punt blijft wachten.
   * Hij vervangt wat er liep; halveren, verdubbelen, loop uit en reloop
   * werken er gewoon op, net als op de loops in seconden en tellen.
   */
  loopOut() {
    if (!this.buffer || this.loopInPunt === null) return false;
    const start = this.loopInPunt, p = this.position;
    let eind = p, beats = null;
    if (this.quantize && this._opGrid(start) && this._opGrid(p)) {
      const g = this.grid;
      const b0 = g.beatAt(start);
      const n = Math.round(g.beatAt(p) - b0);
      if (n < 0) return false;                          // meer dan een halve tel vóór het begin
      beats = Math.max(1, n);
      eind = g.timeOf(b0 + beats);
    }
    const vol = eind;
    eind = Math.min(eind, this.duration);
    if (!this._loopMag(start, eind)) return false;
    this.loopInPunt = null;
    // Geklemd op het trackeinde is het geen heel aantal tellen meer.
    return this._zetLoop(start, eind, beats !== null && eind > vol - 1e-6 ? beats : null);
  }

  /**
   * Reloop/exit, zoals op een CDJ. Loopt er een loop: eraf (hij wordt
   * onthouden). Anders: de laatste loop weer aan, en terug naar zijn begin
   * (met quantize fasebehoudend, teruggevouwen in de loop).
   */
  reloop() {
    if (!this.buffer) return false;
    if (this.loop) { this.clearLoop(); return true; }
    const v = this.vorigeLoop;
    if (!v) return false;
    const loop = { start: v.start, end: Math.min(v.end, this.duration) };
    if (!this._loopMag(loop.start, loop.end)) return false;
    let doel = this._faseDoel(loop.start);
    const len = loop.end - loop.start;
    if (doel < loop.start || doel >= loop.end) doel = loop.start + ((((doel - loop.start) % len) + len) % len);
    this.loopBeats = loop.end > v.end - 1e-6 ? v.beats : null;
    this._spring(doel, loop);
    return true;
  }

  /*
   * Halveren en verdubbelen houden `loopBeats` bij: de LED van "loop 4"
   * brandde anders nog na halveren naar 2 tellen. Een loop die tegen het
   * trackeinde geklemd wordt is geen heel aantal tellen meer: null.
   */
  halveLoop() {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) / 2;
    if (len < 0.02) return;
    this._zetLoop(this.loop.start, this.loop.start + len, this.loopBeats ? this.loopBeats / 2 : null);
  }

  doubleLoop() {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) * 2;
    const eind = Math.min(this.loop.start + len, this.duration);
    const heel = eind - this.loop.start > len - 1e-6;
    this._zetLoop(this.loop.start, eind, heel && this.loopBeats ? this.loopBeats * 2 : null);
  }

  /**
   * Een loop korter dan 20 ms is geen loop maar een fout: aan het trackeinde
   * geeft "loop 4s" start == einde, en een AudioBufferSourceNode speelt dan
   * volgens de spec de HELE buffer eindeloos. Weigeren.
   */
  _loopMag(start, end) { return Number.isFinite(start) && Number.isFinite(end) && end - start >= 0.02; }

  /** Een vrije loop (geen aantal tellen). */
  setLoopRange(start, end) { return this._zetLoop(start, end, null); }

  _zetLoop(start, end, beats) {
    if (!this._loopMag(start, end)) return false;
    this.bron.setLoop(start, end);
    this.loopBeats = beats;
    this.emit('change', this);
    return true;
  }

  // ---- mixer-parameters (alles genormaliseerd 0..1) ----------------------

  set(param, norm) {
    if (!(param in this._ui)) return;
    // Glijdt hij nog, dan eerst vasthouden waar het geluid NU is: anders
    // lopen de geplande hellingen na de nieuwe stand gewoon door. Vandaar
    // gaat setTargetAtTime verder, zonder sprong (Clay grijpt in).
    if (this._glij[param]) {
      this._glij[param] = null;
      const nu = this.ctx.currentTime;
      for (const ap of this._glijParams(param)) houdVast(ap, nu);
    }
    this._ui[param] = clamp(norm);
    this.applyUi(param);
    this.emit('change', this);
  }

  /** De stand van een knop op audiokloktijd `t` (standaard nu), ook midden in het glijden. */
  _stand(p, t = this.ctx.currentTime) {
    const g = this._glij[p];
    return g ? glijStand(g, t) : this._ui[p];
  }

  /**
   * Glijden naar `norm` (0..1, regel 2) in GLIJ seconden, als lineaire
   * hellingen op de audioklok. Voor de auto-DJ: een overgang is een curve,
   * en die stuurt hij zo als een reeks gladde stukken in plaats van een
   * trapje van 0,01 per tik. Een nieuwe glijbeurt (of set()) midden in een
   * oude gaat verder vanaf waar het geluid dan is: de oude loopt door tot
   * na startDrempel en de nieuwe begint daar (zetVervolg), nooit een curve
   * (overgang.js). Alleen de GLIJDERS; een andere knop wordt een gewone set.
   */
  glide(param, norm) {
    if (!GLIJDERS.includes(param)) { this.set(param, norm); return; }
    const nu = this.ctx.currentTime;
    const t0 = nu + startDrempel(this.ctx), t1 = Math.max(t0 + 0.001, nu + GLIJ);
    const oud = this._glij[param];
    // Vóór `nu` vraagt niemand meer iets: de keten erachter mag weg.
    if (oud?.vorige && oud.t0 <= nu) oud.vorige = null;
    const van = this._stand(param, t0), naar = clamp(norm);
    this._glij[param] = { van, naar, t0, t1, vorige: oud || null };
    this._ui[param] = naar;
    const params = this._glijParams(param);
    const reeksen = params.map(() => []);
    for (let i = 1; i <= GLIJ_STUKKEN; i++) {
      const doel = this._glijDoelen(param, van + (naar - van) * i / GLIJ_STUKKEN);
      for (let k = 0; k < params.length; k++) reeksen[k].push(doel[k]);
    }
    const begin = this._glijDoelen(param, van);
    for (let k = 0; k < params.length; k++) zetVervolg(params[k], reeksen[k], t0, t1, begin[k]);
    this.emit('change', this);
  }

  /**
   * De AudioParams achter een glijdende knop. De fader met zijn spiegels voor
   * de stem-sends: die glijden zo sample voor sample mee.
   */
  _glijParams(p) {
    const c = this.chain;
    if (p === 'fader') return [c.fader.gain, ...this._faderSpiegels()];
    if (p === 'filter') return [c.hpf.frequency, c.hpf.Q, c.lpf.frequency, c.lpf.Q];
    if (p === 'sendA') return [this.sendA.gain];
    if (p === 'sendB') return [this.sendB.gain];
    return [];
  }

  /** Wat een knopstand op die AudioParams zet: dezelfde formules als applyUi. */
  _glijDoelen(p, u) {
    if (p === 'fader') { const g = faderGain(u); return [g, ...this._faderSpiegels().map(() => g)]; }
    if (p === 'filter') return filterDoelen(u);
    return [u * u];             // sends: kwadratisch, zie applyUi
  }

  /** De versterkingen die de fader volgen: de spiegels van de stem-sends. */
  _faderSpiegels() { return STEM_BUSSEN.map((b) => this.stemSends[b].fader.gain); }

  applyUi(only) {
    const now = this.ctx.currentTime;
    const c = this.chain, u = this.ui;
    if (!only || only === 'trim') {
      c.trim.gain.setTargetAtTime(u.trim * 2, now, 0.01);
      // Trim zit ook in de sends en de cue van elke stem (de stemkanalen).
      if (this.stemSends) { this._pasStemSendsToe(); this._pasStemCueToe(); }
    }
    if (!only || only === 'low')    setEqBand(c.eqLow.gain, u.low, now, this.gekild('low'));
    if (!only || only === 'mid')    setEqBand(c.eqMid.gain, u.mid, now, this.gekild('mid'));
    if (!only || only === 'high')   setEqBand(c.eqHigh.gain, u.high, now, this.gekild('high'));
    if (!only || only === 'filter') setBipolarFilter(c.hpf, c.lpf, u.filter, now);
    if (!only || only === 'fader') {
      c.fader.gain.setTargetAtTime(faderGain(u.fader), now, 0.008);
      for (const g of this._faderSpiegels()) g.setTargetAtTime(faderGain(u.fader), now, 0.008);
    }
    // Kwadratisch: het eerste stuk van de knop is subtiel, het laatste gooit.
    if (!only || only === 'sendA')  this.sendA.gain.setTargetAtTime(u.sendA * u.sendA, now, 0.01);
    if (!only || only === 'sendB')  this.sendB.gain.setTargetAtTime(u.sendB * u.sendB, now, 0.01);
  }

  // ---- EQ-kill -------------------------------------------------------------

  /** Is deze band nu weg (schakelaar of drukknop)? */
  gekild(band) { return !!(this.kill?.[band] || this.killVast?.[band]); }

  /** De kill-schakelaar van een band: aan of uit. */
  setKill(band, aan) {
    if (!EQ_BANDEN.includes(band)) return;
    this.kill[band] = !!aan;
    this._pasKillToe(band);
  }

  toggleKill(band) { if (EQ_BANDEN.includes(band)) this.setKill(band, !this.kill[band]); }

  /** De drukvariant: weg zolang `aan`, loslaten = terug (tenzij de schakelaar aan staat). */
  houdKill(band, aan) {
    if (!EQ_BANDEN.includes(band)) return;
    this.killVast[band] = !!aan;
    this._pasKillToe(band);
  }

  /**
   * Alleen als het hoorbaar verandert een korte overgang op de EQ (klikvrij,
   * killEqBand), die begint na startDrempel (zie overgang.js). Schakelaar aan
   * terwijl je al drukt: er verandert niets.
   */
  _pasKillToe(band) {
    const weg = this.gekild(band);
    if (weg !== this._killHoorbaar[band]) {
      this._killHoorbaar[band] = weg;
      const param = { low: this.chain.eqLow, mid: this.chain.eqMid, high: this.chain.eqHigh }[band].gain;
      killEqBand(param, this.ui[band], weg, this.ctx.currentTime, startDrempel(this.ctx));
    }
    this.emit('change', this);
  }

  // ---- stems (docs/STEMS.md) -------------------------------------------------

  /**
   * Na elke laad: de stems van het nieuwe nummer (of null), alle niveaus op
   * 1 en alle kills uit. Stems horen bij het NUMMER, niet bij het kanaal (de
   * EQ-knoppen wel): een nummer dat stil zonder zang begint omdat het vorige
   * zonder zang speelde, is erger dan opnieuw drukken. Klikvrij, voor het
   * geval de vorige nog uitvloeit.
   */
  _zetStems(stems) {
    this.stems = stems ? Object.freeze({
      namen: Object.freeze([...stems.namen]), aantal: stems.namen.length, schaal: stems.schaal ?? 1,
    }) : null;
    // De toon per stem hoort bij het nummer: een nieuw nummer begint op 0.
    if (Object.keys(this._stemToon).length) {
      this._stemToon = {};
      this.bron.zetRek?.({ keylock: this._keylock, toon: this._toon, stems: null });
    }
    for (const n of STEM_NAMEN) {
      this.stemNiveaus[n] = 1; this.stemKill[n] = false; this.stemKillVast[n] = false;
      this.stemFilters[n] = 0.5; this.stemPfl[n] = false;
      for (const b of STEM_BUSSEN) this.stemSendStand[b][n] = 0;
    }
    this._pasStemsToe('kill');
    // De stemkanalen terug naar open (bij het nummer). Wat er nooit gebruikt
    // werd, bestaat niet en blijft zo.
    this._pasStemKanalenToe();
  }

  /** Heeft deze track deze stem, in deze stand? (`inst` ook bij vier: de groep.) */
  stemBestaat(s) {
    if (!this.stems) return false;
    return this.stems.namen.includes(s) || (s === 'inst' && this.stems.aantal === 4);
  }

  /** Niveau 0..1 van een stem, of null als die er niet is. */
  stemNiveau(s) { return this.stemBestaat(s) ? this.stemNiveaus[s] : null; }

  /** Is deze stem nu weg (schakelaar of drukknop)? */
  stemGekild(s) { return !!(this.stemKill[s] || this.stemKillVast[s]); }

  /** Niveau 0..1 (1 = vol, 0 = uit). Een stem die er niet is: niets. */
  setStemNiveau(s, norm) {
    if (!this.stemBestaat(s)) return;
    this.stemNiveaus[s] = clamp(norm);
    this._pasStemsToe('niveau');
    this.emit('change', this);
  }

  /** De kill-schakelaar van een stem. Het niveau blijft staan: uit = precies terug. */
  setStemKill(s, aan) {
    if (!this.stemBestaat(s)) return;
    this.stemKill[s] = !!aan;
    this._pasStemsToe('kill');
    this.emit('change', this);
  }

  toggleStemKill(s) { if (this.stemBestaat(s)) this.setStemKill(s, !this.stemKill[s]); }

  /** De drukvariant: weg zolang `aan`, loslaten = terug (tenzij de schakelaar aan staat). */
  houdStemKill(s, aan) {
    if (!this.stemBestaat(s)) return;
    this.stemKillVast[s] = !!aan;
    this._pasStemsToe('kill');
    this.emit('change', this);
  }

  /**
   * Wat er op uitgang k hoort te staan (docs/STEMS.md §3), voor stem n = namen[k]:
   *   (1 / schaal) × niveau(n) × kill(n) × (vier stems en n ≠ vocals ? niveau(inst) × kill(inst) : 1)
   * kill = 0 als hij weg is, anders 1. `inst` werkt zo in beide standen, en
   * drums/bas/overig doen niets bij twee (die bestaan dan niet). 1/schaal
   * maakt goed wat de splitter eraf deed om niet te clippen: de som klinkt
   * even hard als audio.wav. Zonder stems, en op een uitgang zonder stem: 1.
   */
  stemVersterking(k) {
    const st = this.stems;
    if (!st || k >= st.aantal) return 1;
    const deel = (n) => (this.stemGekild(n) ? 0 : this.stemNiveaus[n]);
    const n = st.namen[k];
    return (1 / st.schaal) * deel(n) * (st.aantal === 4 && n !== 'vocals' ? deel('inst') : 1);
  }

  /**
   * Gewichten per paar voor bron.knip (de sampler): wat je NU hoort vóór de
   * EQ, zodat een pad zonder zang ook zonder zang klinkt. Null zonder stems.
   */
  knipGewichten() {
    if (!this.stems) return null;
    return Array.from({ length: this.stems.aantal }, (_, k) => this.stemVersterking(k));
  }

  /**
   * De versterking van elke uitgang die anders moet, naar zijn doel. Een
   * KILL (aan, uit, laden) als klikvrije S in ~5 ms na startDrempel, zoals de
   * EQ-kill (killVersterking: hellingen, nooit een curve); een NIVEAU als
   * doelwaarde (vasthouden + setTargetAtTime, zoals een EQ-knop). Wat niet
   * verandert, wordt niet aangeraakt: een niveauknop op een stem die weg is
   * laat zijn kill-overgang gewoon uitlopen.
   */
  _pasStemsToe(soort) {
    const nu = this.ctx.currentTime;
    this.chain.stemIn.forEach((g, k) => {
      const doel = this.stemVersterking(k);
      if (doel === this._stemNu[k]) return;
      this._stemNu[k] = doel;
      if (soort === 'kill') killVersterking(g.gain, doel, nu, startDrempel(this.ctx));
      else {
        try { houdVast(g.gain, nu); } catch (_) {}
        try { g.gain.setTargetAtTime(doel, nu, 0.01); } catch (_) { try { g.gain.value = doel; } catch (__) {} }
      }
    });
  }

  // ---- stemkanalen: filter, sends en cue per stem (docs/STEMS.md §5) ----------
  //
  // Per stem een bipolair filter (zoals het trackfilter), een echo- en een
  // galm-send (na het filter, × trim, door de spiegel van de fader) en een cue
  // (voorbeluisteren, vóór de fader). Ze horen bij het NUMMER, zoals niveau en
  // kill: elke laad zet ze terug (_zetStems). De groepsknop `inst` bij vier
  // stems werkt op drums, bas en overig samen:
  //   filter  in SERIE met het eigen filter: per kant het sterkste (stemFilterDoelen)
  //   sends   de GROOTSTE van eigen en groep (twee keer insturen = niet dubbel)
  //   cue     eigen OF groep aan (één keer in de koptelefoon, niet twee keer)
  // Niveau en kill vermenigvuldigen (stemVersterking): die horen bij de klank
  // van de stem; sends en cue zijn aftakkingen van hetzelfde signaal.

  /** Uitgang k: welke stem (n) en hoort hij bij de groep `inst` (vier stems, niet de zang)? Null zonder stem. */
  _stemOp(k) {
    const st = this.stems;
    if (!st || k >= st.aantal) return null;
    const n = st.namen[k];
    return { n, lid: st.aantal === 4 && n !== 'vocals' };
  }

  /** Filter 0..1 van een stem (0,5 = open), of null als die er niet is. */
  stemFilter(s) { return this.stemBestaat(s) ? this.stemFilters[s] : null; }

  /** Bipolair filter van een stem: midden = open, links lowpass, rechts highpass. Een stem die er niet is: niets. */
  setStemFilter(s, norm) {
    if (!this.stemBestaat(s)) return;
    this.stemFilters[s] = clamp(norm);
    this._pasStemFiltersToe();
    this.emit('change', this);
  }

  /** Send A (echo) of B (galm) van een stem, 0..1, of null als die er niet is. */
  stemSend(bus, s) { return this.stemBestaat(s) && STEM_BUSSEN.includes(bus) ? this.stemSendStand[bus][s] : null; }

  /** Send van een stem naar bus A of B, 0..1 (kwadratisch, zoals de track-send). */
  setStemSend(bus, s, norm) {
    if (!this.stemBestaat(s) || !STEM_BUSSEN.includes(bus)) return;
    this.stemSendStand[bus][s] = clamp(norm);
    this._pasStemSendsToe();
    this.emit('change', this);
  }

  /** Staat deze stem in de koptelefoon? */
  stemPflAan(s) { return this.stemBestaat(s) && !!this.stemPfl[s]; }

  /** Staat er van deze track een stem in de koptelefoon? (De engine zet daarmee de koptelefoon.) */
  get stemPflIets() { return STEM_NAMEN.some((n) => this.stemPflAan(n)); }

  /** Cue van een stem aan of uit. Zonder koptelefoon (geen maakStemCue) alleen de stand. */
  setStemPfl(s, aan) {
    if (!this.stemBestaat(s)) return;
    this.stemPfl[s] = !!aan;
    this._pasStemCueToe();
    this.emit('change', this);
  }

  toggleStemPfl(s) { if (this.stemBestaat(s)) this.setStemPfl(s, !this.stemPfl[s]); }

  /**
   * De ingang van de stem-cue in de koptelefoon: één versterking (1), waar de
   * cue per stem in uitkomt. De engine roept dit één keer aan, bij het maken,
   * en alleen als er een koptelefoonuitgang is: anders geen node erbij. Geeft
   * de tap voor `koptelefoon.voegToe`.
   */
  maakStemCue() {
    if (!this.stemCue) this.stemCue = { som: this.ctx.createGain() };
    return this.stemCue.som;
  }

  /** De stem van uitgang k NA zijn filter: stemIn, en (als het filter bestaat) lowpass en tegen. */
  _takken(k) {
    const f = this.stemKanalen[k].filter;
    return f ? [this.chain.stemIn[k], f.lpf, f.tegen] : [this.chain.stemIn[k]];
  }

  /**
   * Een aftakking van stem k na zijn filter (een send of de cue): een stille
   * versterking (0) naar `doel`. Komt er later een filter bij, dan verbindt
   * _filterVan zijn takken ook hiermee.
   */
  _tapNaar(k, doel) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    for (const t of this._takken(k)) t.connect(g);
    g.connect(doel);
    return g;
  }

  /** Het filter van stem k, gemaakt bij het eerste gebruik (stil, zie maakStemFilter). */
  _filterVan(k) {
    const kan = this.stemKanalen[k];
    if (!kan.filter) {
      kan.filter = maakStemFilter(this.ctx, this.chain.stemIn[k], this.chain.trim);
      for (const tap of [kan.send.A, kan.send.B, kan.cue]) {
        if (tap) { kan.filter.lpf.connect(tap); kan.filter.tegen.connect(tap); }
      }
    }
    return kan.filter;
  }

  /** Alles van de stemkanalen naar de stand (na een laad). */
  _pasStemKanalenToe() {
    this._pasStemFiltersToe();
    this._pasStemSendsToe();
    this._pasStemCueToe();
  }

  /**
   * Het filter van elk stemkanaal. Staan eigen knop en groepsknop in het
   * midden (stemFilterOpen), dan staan beide takken op 0: alleen de droge weg,
   * bit voor bit zoals zonder stemfilter (en zolang het filter nooit uit het
   * midden ging, bestaat het niet eens). Anders de takken op 1 en −1: de
   * gefilterde stem. Wisselen is een klikvrije overgang van 5 ms
   * (killVersterking: hellingen na startDrempel, nooit een curve); terug naar
   * het midden pas na STEM_FILTER_TERUG, als het filter zelf (τ 10 ms, zoals
   * de knop) weer open staat.
   */
  _pasStemFiltersToe() {
    const nu = this.ctx.currentTime, wacht = startDrempel(this.ctx);
    this.stemKanalen.forEach((kan, k) => {
      const x = this._stemOp(k), stand = kan.nu;
      const eigen = x ? this.stemFilters[x.n] : 0.5, groep = x?.lid ? this.stemFilters.inst : 0.5;
      const aan = !(stemFilterOpen(eigen) && stemFilterOpen(groep));
      if (!aan && !kan.filter) return;
      const f = this._filterVan(k);
      const doelen = aan ? stemFilterDoelen(eigen, groep) : filterDoelen(0.5);
      if (doelen.some((v, i) => v !== stand.doelen[i])) {
        stand.doelen = doelen;
        const [hf, hq, lf, lq] = doelen;
        for (const [p, v] of [[f.hpf.frequency, hf], [f.hpf.Q, hq], [f.lpf.frequency, lf], [f.lpf.Q, lq]]) {
          try { p.setTargetAtTime(v, nu, 0.01); } catch (_) { try { p.value = v; } catch (__) {} }
        }
      }
      if (aan === stand.filter) return;
      stand.filter = aan;
      const w = aan ? wacht : Math.max(wacht, STEM_FILTER_TERUG);
      killVersterking(f.filterIn.gain, aan ? 1 : 0, nu, w);
      killVersterking(f.tegen.gain, aan ? -1 : 0, nu, w);
    });
  }

  /** De sends van elk stemkanaal: de grootste van eigen knop en groepsknop, kwadratisch, × trim. */
  _pasStemSendsToe() {
    const trim = this._ui.trim * 2;
    this.stemKanalen.forEach((kan, k) => {
      const x = this._stemOp(k);
      for (const b of STEM_BUSSEN) {
        const s = this.stemSendStand[b];
        const v = x ? Math.max(s[x.n], x.lid ? s.inst : 0) : 0;
        const doel = v * v * trim;
        if (doel === kan.nu.send[b]) continue;
        kan.nu.send[b] = doel;
        kan.send[b] ??= this._tapNaar(k, this.stemSends[b].fader);
        zetDoel(kan.send[b].gain, doel, this.ctx);
      }
    });
  }

  /**
   * De cue van elk stemkanaal: aan (op trim, zoals de cue van de track die na
   * trim tapt) als de stem of, bij vier, de groep aan staat. Aan en uit klikvrij
   * zoals de cue van de track (killVersterking); een andere trim terwijl hij aan
   * staat als een knop (zetDoel). Zonder koptelefoon (geen maakStemCue): niets.
   */
  _pasStemCueToe() {
    if (!this.stemCue) return;
    const nu = this.ctx.currentTime, wacht = startDrempel(this.ctx), trim = this._ui.trim * 2;
    this.stemKanalen.forEach((kan, k) => {
      const x = this._stemOp(k);
      const doel = x && (this.stemPfl[x.n] || (x.lid && this.stemPfl.inst)) ? trim : 0;
      const was = kan.nu.cue;
      if (doel === was) return;
      kan.nu.cue = doel;
      kan.cue ??= this._tapNaar(k, this.stemCue.som);
      if (doel === 0 || was === 0) killVersterking(kan.cue.gain, doel, nu, wacht);
      else zetDoel(kan.cue.gain, doel, this.ctx);
    });
  }

  /**
   * Voor de snapshot: per stem die er is het niveau, of hij weg is, het
   * filter, de sends (A echo, B galm) en de cue. Null zonder stems.
   */
  stemStand() {
    if (!this.stems) return null;
    const niveau = {}, weg = {}, filter = {}, send = { A: {}, B: {} }, cue = {}, toon = {};
    for (const n of STEM_NAMEN) {
      if (!this.stemBestaat(n)) continue;
      toon[n] = this._stemToon[n] ?? 0;
      niveau[n] = this.stemNiveaus[n];
      weg[n] = this.stemGekild(n);
      filter[n] = this.stemFilters[n];
      for (const b of STEM_BUSSEN) send[b][n] = this.stemSendStand[b][n];
      cue[n] = !!this.stemPfl[n];
    }
    return { namen: [...this.stems.namen], niveau, weg, filter, send, cue, toon };
  }

  level() { return piek(this.chain.analyser); }
}
