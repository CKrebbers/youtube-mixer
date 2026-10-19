/**
 * De engine: één klok, acht tracks, een mixer en de bus. Lijm, geen DOM.
 *
 * De audiolaag wordt erin gegeven (`audio`), zodat dezelfde engine in Node
 * tegen een nagebouwde laag getest kan worden en in Chrome op Web Audio draait:
 *   audio.mixer(ctx)            -> mixer (contract in ARCHITECTUUR.md)
 *   audio.strip(ctx, mixer)     -> strip
 *   audio.speler(ctx)           -> Promise<speler>
 *
 * Tijd: `nu()` is ctx.currentTime. Een handeling gaat in op `straks()` (net na
 * wat de audiothread al rekent: VOORUIT_BLOKKEN), zodat wat klinkt nooit verspringt.
 * Een timer zegt alleen WANNEER er vooruit gepland wordt (`tik`), nooit wat de
 * tijd is.
 */
import { Emitter } from '../kern/emitter.js';
import { Klok } from '../kern/klok.js';
import { Bus, TRACKS } from '../kern/bus.js';
import { Beatgrid, TapTempo } from '../kern/grid.js';
import { Track } from './track.js';
import { definieerActies } from './acties.js';

/** Elke zoveel ms plannen de gekoppelde tracks hun lijn opnieuw vooruit. */
export const TIK_MS = 250;
/** Onder deze versterking telt een track als niet hoorbaar (−60 dB). */
export const HOORBAAR = 0.001;

/**
 * Hoe ver vooruit een handeling op de klok en de afspeelmotor ingaat: twee audioblokken.
 * Genoeg om het bericht in de worklet te hebben vóór het moment (dan sample-exact), en
 * niet afhankelijk van het apparaat. Komt een bericht toch later, dan rekent de motor
 * op de lijn verder (een segment in het verleden geldt meteen), dus er springt niets.
 * NIET de startDrempel van v1 (baseLatency + 3 ms): die is voor hellingen op een
 * AudioParam, en de strip past die zelf toe. Gemeten (M3): met de startDrempel duurde
 * play 13 ms in headless Chrome (baseLatency 10 ms), met twee blokken mediaan 5,4 ms. Drie
 * of vier blokken gaven daar hetzelfde maximum (10,7 ms): de nep-geluidskaart rekent per 10 ms,
 * dus het maximum is daar van het apparaat. Op de Mac (128 frames per callback) opnieuw meten.
 */
export const VOORUIT_BLOKKEN = 2;
const voorUit = (ctx) => (VOORUIT_BLOKKEN * 128) / ctx.sampleRate;

export class Engine extends Emitter {
  /**
   * @param {{ ctx: BaseAudioContext, audio: object, tracks?: number, timer?: boolean }} opties
   */
  constructor({ ctx, audio, tracks = TRACKS, timer = true }) {
    super();
    this.ctx = ctx;
    this.audio = audio;
    this.klok = new Klok();
    this.bus = new Bus({ tracks });
    this.mixer = audio.mixer(ctx);
    this.tracks = [];
    for (let n = 1; n <= tracks; n++) {
      this.tracks.push(new Track({ n, engine: this, speler: null, strip: audio.strip(ctx, this.mixer) }));
    }
    this.tap = new TapTempo();
    this._laadNr = new Array(tracks + 1).fill(0);
    // Verandert de klok door iets anders dan de pitchfader van een track, dan staat die fader
    // niet meer op de stand van de klok: eerst weer erlangs (soft-takeover, modeltest K4c).
    this.klokBron = null;
    this.klok.on('verander', () => {
      for (const t of this.tracks) {
        if (t !== this.klokBron) t.grijpt = false;
        t.klokVerandert();
      }
      this.emit('klok');
    });
    for (const t of this.tracks) {
      t.strip.kant?.(t.kant);
      t.on('verander', () => this.emit('track', t.n));
    }
    this.bus.on('geweigerd', ({ id, reden }) => this.meld(`${id}: ${reden}`, 'fout', `geweigerd:${id}`));
    this._bewaakContext();
    definieerActies(this);
    this.klaar = Promise.all(this.tracks.map(async (t) => {
      t.speler = await audio.speler(ctx);
      t.speler.onfout = (bericht, kapot = true) => this.meld(kapot
        ? `track ${t.n}: de afspeelmotor gaf een fout (${bericht}); hij speelt stil tot je opnieuw laadt`
        : `track ${t.n}: de afspeelmotor: ${bericht}`, 'fout', `speler:${t.n}`);
      t.speler.node?.connect?.(t.strip.in);
      t.plan();
    }));
    this._timer = timer ? setInterval(() => this.tik(), TIK_MS) : null;
  }

  track(n) { return this.tracks[n - 1]; }

  // ---- tijd -----------------------------------------------------------------

  nu() { return this.ctx.currentTime; }
  straks() { return this.ctx.currentTime + voorUit(this.ctx); }
  /** Wat je hoort loopt zoveel achter op wat de engine plant. */
  vertraging() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) + (this.mixer.vertraging || 0); }
  /** De klok zoals je hem hoort (klok-B10). Null als hij niet loopt. */
  hoorbareTel() { return this.klok.loopt ? this.klok.tel(this.nu() - this.vertraging()) : null; }

  /** Vooruit plannen: de lijn van gekoppelde tracks over de horizon heen. */
  tik() {
    const nu = this.nu();
    this.klok.ruim(nu - 1);
    for (const t of this.tracks) if (t.gekoppeldOp(nu) || t.wacht !== null) t.plan();
    // Streamen (M7): de pagina's volgen het plan, ook van een track die vrij speelt; het cuepunt
    // staat er altijd (cue moet direct klinken).
    for (const t of this.tracks) t.speler?.bijvullen?.(t.geladen ? [t.cue] : []);
  }

  // ---- de klok ----------------------------------------------------------------

  /** De klok begint bij dit nummer (klok-B05): tel 0 is zijn "1", tempo = wat je hoort. */
  startKlokVan(track, A, P, rate) {
    const g = track.grid;
    const q = g.barPhase(P) * g.beatsPerBar;
    this.klok.perMaat = g.beatsPerBar;
    this.klokBron = track;
    this.klok.start(A, q, g.bpmAt(P) * rate);
    this.klokBron = null;
  }

  /** Klok-tempo vanaf A (tempoknop, tap, pitchfader van een gekoppeld nummer). */
  zetKlokTempo(bpm, A = this.straks(), bron = null) {
    this.klokBron = bron;
    try {
      if (!this.klok.loopt) { this.klok.start(A, 0, bpm); return; }
      if (Math.abs(this.klok.bpm(A) - bpm) < 1e-6) return;
      this.klok.houd(A, bpm);
    } finally { this.klokBron = null; }
  }

  /** Mag de klok stoppen? Niet zolang een track hem nodig heeft (speelt gekoppeld, wacht op de maat; K3). */
  klokNodig() { const nu = this.nu(); return this.tracks.some((t) => t.heeftKlokNodig(nu) || t.speelt); }

  // ---- mixer ------------------------------------------------------------------

  /** Versterking van een track in de zaal: fader × crossfader (0 als hij niet speelt). */
  zaalVersterking(n) {
    const t = this.track(n);
    if (!t.speelt) return 0;
    const x = this.mixer.lees('xfader');
    // Constant-power crossfader (zoals de mixer): A = cos, B = sin, thru = 1.
    const kant = t.kant === 'A' ? Math.cos(x * Math.PI / 2) : t.kant === 'B' ? Math.sin(x * Math.PI / 2) : 1;
    return t.strip.lees('fader') * kant;
  }

  /** Klinkt deze track in de zaal? (klok-B14: een nummer dat je niet hoort verzet de klok niet) */
  hoorbaar(n) { return this.zaalVersterking(n) > HOORBAAR; }

  // ---- laden ------------------------------------------------------------------

  /**
   * Laad een nummer op track n (track-B05). `nummer` = { id, titel, artiest, duur, grid, haal() }
   * met haal() -> Promise<pcm> in het formaat van de speler. 'laad' meldt begin en klaar;
   * klaar komt pas als alles er is. Een latere laad op dezelfde track wint.
   */
  async laad(n, nummer) {
    const t = this.track(n);
    const nr = ++this._laadNr[n];
    this.emit('laad', { n, stand: 'laadt', nummer });
    try {
      await this.klaar;
      const pcm = await nummer.haal();
      if (nr !== this._laadNr[n]) return false;
      t.speler.laad(pcm);
      const grid = nummer.grid ? (nummer.grid instanceof Beatgrid ? nummer.grid : new Beatgrid(nummer.grid)) : null;
      t.laad({ id: nummer.id, titel: nummer.titel, artiest: nummer.artiest ?? '', duur: nummer.duur ?? pcm.frames / pcm.sr, grid });
      this.emit('laad', { n, stand: 'klaar', nummer });
      return true;
    } catch (e) {
      if (nr === this._laadNr[n]) {
        this.emit('laad', { n, stand: 'mislukt', nummer, fout: e });
        this.meld(`laden op track ${n} mislukt: ${e.message}`, 'fout', `laad:${n}`);
      }
      return false;
    }
  }

  // ---- meldingen ----------------------------------------------------------------

  meld(tekst, soort = 'info', sleutel = null) { this.emit('melding', { tekst, soort, sleutel }); }

  /**
   * De audiocontext (ctx) bewaken (M8, v1 gezondheid.js): staat hij stil terwijl hij liep (slaap, de
   * geluidskaart eruit, Chrome), dan een melding die blijft tot hij weer loopt; de eerste
   * handeling daarna probeert hem weer aan te zetten, hooguit eens per seconde. Vóór de eerste
   * start meldt hij niets: Chrome start een context pas na een klik, dat is geen storing.
   */
  _bewaakContext() {
    const ctx = this.ctx;
    if (typeof ctx.addEventListener !== 'function') return;
    let stand = ctx.state === 'running' ? 'loopt' : 'nooit', laatstePoging = -Infinity;   // nooit | loopt | stil
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') {
        if (stand === 'stil') this.meld('het geluid loopt weer', 'info', 'audio');
        stand = 'loopt';
      } else if (stand === 'loopt' && ctx.state !== 'closed') {
        stand = 'stil';
        this.meld(`het geluid staat stil (${ctx.state}): de klok en de tracks staan ook stil; druk op een knop om hem weer aan te zetten`, 'fout', 'audio');
      }
    });
    this.bus.on('actie', () => {
      if (stand !== 'stil' || ctx.state === 'running' || ctx.state === 'closed') return;
      const nu = Date.now();
      if (nu - laatstePoging < 1000) return;
      laatstePoging = nu;
      ctx.resume?.().catch((e) => this.meld(`het geluid gaat niet weer aan: ${e?.message ?? e}`, 'fout', 'audio'));
    });
  }

  vernietig() {
    if (this._timer) clearInterval(this._timer);
    for (const t of this.tracks) t.vernietig();
  }
}
