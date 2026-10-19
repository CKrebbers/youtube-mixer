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
 * wat de audiothread al rekent: startDrempel), zodat wat klinkt nooit verspringt.
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

const startDrempelVan = (ctx) => Math.max(ctx.baseLatency ?? 0, 128 / ctx.sampleRate) + 0.003;

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
    this.klok.on('verander', () => {
      for (const t of this.tracks) t.klokVerandert();
      this.emit('klok');
    });
    for (const t of this.tracks) t.on('verander', () => this.emit('track', t.n));
    this.bus.on('geweigerd', ({ id, reden }) => this.meld(`${id}: ${reden}`, 'fout', `geweigerd:${id}`));
    definieerActies(this);
    this.klaar = Promise.all(this.tracks.map(async (t) => {
      t.speler = await audio.speler(ctx);
      t.speler.node?.connect?.(t.strip.in);
      t.plan();
    }));
    this._timer = timer ? setInterval(() => this.tik(), TIK_MS) : null;
  }

  track(n) { return this.tracks[n - 1]; }

  // ---- tijd -----------------------------------------------------------------

  nu() { return this.ctx.currentTime; }
  straks() { return this.ctx.currentTime + startDrempelVan(this.ctx); }
  /** Wat je hoort loopt zoveel achter op wat de engine plant. */
  vertraging() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) + (this.ctx.graafVertraging || 0); }
  /** De klok zoals je hem hoort (klok-B10). Null als hij niet loopt. */
  hoorbareTel() { return this.klok.loopt ? this.klok.tel(this.nu() - this.vertraging()) : null; }

  /** Vooruit plannen: de lijn van gekoppelde tracks over de horizon heen. */
  tik() {
    const nu = this.nu();
    this.klok.ruim(nu - 1);
    for (const t of this.tracks) if (t.gekoppeldOp(nu) || t.wacht !== null) t.plan();
  }

  // ---- de klok ----------------------------------------------------------------

  /** De klok begint bij dit nummer (klok-B05): tel 0 is zijn "1", tempo = wat je hoort. */
  startKlokVan(track, A, P, rate) {
    const g = track.grid;
    const q = g.barPhase(P) * g.beatsPerBar;
    this.klok.perMaat = g.beatsPerBar;
    this.klok.start(A, q, g.bpmAt(P) * rate);
  }

  /** Klok-tempo vanaf A (tempoknop, tap, pitchfader van een gekoppeld nummer). */
  zetKlokTempo(bpm, A = this.straks()) {
    if (!this.klok.loopt) { this.klok.start(A, 0, bpm); return; }
    if (Math.abs(this.klok.bpm(A) - bpm) < 1e-6) return;
    this.klok.houd(A, bpm);
  }

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

  vernietig() {
    if (this._timer) clearInterval(this._timer);
    for (const t of this.tracks) t.vernietig();
  }
}
