import { Emitter, clamp, piek } from '../lib/emitter.js';
import { createDeckChain, setEqBand, setBipolarFilter, faderGain } from './audio-graph.js';
import { Beatgrid } from './beatgrid.js';
import { BufferBron, StreamBron } from './bron.js';
import { InsertSlot } from './fx.js';

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
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    this.loop = null;           // {start, end}

    this.grid = null;           // Beatgrid, of null als de track nog niet uitgemeten is

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

    // UI-state, genormaliseerd 0..1 — precies wat MIDI later ook levert.
    this.ui = { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 1, sendA: 0, sendB: 0 };
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
    bron.onEinde = () => this.emit('change', this);
    bron.onFout = (tekst) => this.emit('fout', tekst);
    // Vaste punten: hier springt de DJ heen, dus daar mag een streamende bron
    // geen gat hebben. Een BufferBron negeert het, die heeft alles al.
    bron.vastpunten = () => [this.cuePoint, ...this.hotcues, this.loop?.start ?? null];
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
   */
  async laadStream(url, title, opties) {
    if (!(this.bron instanceof StreamBron)) this._zetBron(new StreamBron(this.ctx, this.chain.input, opties));
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    try {
      await this.bron.laad({ url });
    } catch (err) {
      if (err.vervangen) return false;      // er kwam een nieuwere laad overheen: die wint
      throw err;
    }
    this._naLaden(title);
    return true;
  }

  _naLaden(title) {
    this.title = title || 'untitled';
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    this.grid = null;
    this.loopBeats = null;
    this.emit('load', this);
  }

  // ---- transport ---------------------------------------------------------

  stop() { this.bron.stop(); }

  play() {
    if (!this.buffer || this.playing) return;
    let at = this.position;
    if (at >= this.duration - 0.01) at = 0;
    this.bron.start(at);
    this.fx.heranker();
    this.emit('change', this);
  }

  pause() {
    if (!this.playing) return;
    this.bron.pauzeer();
    this.emit('change', this);
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  seek(pos) {
    if (!this.buffer) return;
    const p = clamp(pos, 0, this.duration);
    if (this.playing) this.bron.start(p);
    else this.bron.plaats(p);
    this.fx.heranker();
    this.emit('change', this);
  }

  nudge(seconds) { this.seek(this.position + seconds); }

  setRate(r) {
    const nr = clamp(r, 0.5, 2);
    this.bron.setRate(nr);
    this.rate = nr;
    this.fx.heranker();
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
    if (!this.grid || !this.playing) return null;
    const volgende = this.grid.timeOf(Math.ceil(this.grid.beatAt(this.position) - 1e-9));
    return {
      beatLengte: this.grid.beatLength / this.rate,
      ankerCtx: this.ctxTimeOf(volgende),
    };
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
    if (this.playing) { this.stop(); this.bron.plaats(this.cuePoint); }
    else if (Math.abs(this.position - this.cuePoint) < 0.005) { this.play(); }
    else { this.cuePoint = this.position; }
    this.emit('change', this);
  }

  // ---- hotcues & loops ---------------------------------------------------

  hotcue(i, { del = false } = {}) {
    if (!this.buffer) return;
    if (del) { this.hotcues[i] = null; this.emit('change', this); return; }
    if (this.hotcues[i] === null) this.hotcues[i] = this.position;
    else this.seek(this.hotcues[i]);
    this.emit('change', this);
  }

  // ---- beatgrid ----------------------------------------------------------

  setGrid(grid) {
    this.grid = grid instanceof Beatgrid ? grid : Beatgrid.van(grid);
    this.fx.heranker();
    this.emit('change', this);
    return this.grid;
  }

  /** Hoorbare bpm: het grid staat in tracktijd, de rate rekt dat op. */
  get bpm() { return this.grid ? this.grid.bpm * this.rate : null; }

  /**
   * Loop van een aantal tellen, ingeklikt op het grid.
   *
   * Het inklikken is het hele punt: een loop die een fractie naast de tel
   * begint hoor je meteen. Valt het einde achter de speelkop, dan pakken we de
   * eerstvolgende beat — anders loopt de bron buiten zijn eigen loop.
   */
  setBeatLoop(beats) {
    if (!this.buffer || !this.grid) return false;
    const lengte = beats * this.grid.beatLength;
    const p = this.position;
    let start = this.grid.nearest(p);
    if (start + lengte <= p) start = this.grid.next(p);
    this.setLoopRange(start, Math.min(start + lengte, this.duration));
    this.loopBeats = beats;
    return true;
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
    this.loopBeats = null;
    if (!this.loop) return;
    this.bron.clearLoop();
    this.emit('change', this);
  }

  halveLoop() {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) / 2;
    if (len < 0.02) return;
    this.setLoopRange(this.loop.start, this.loop.start + len);
  }

  doubleLoop() {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) * 2;
    this.setLoopRange(this.loop.start, Math.min(this.loop.start + len, this.duration));
  }

  /**
   * Een loop korter dan 20 ms is geen loop maar een fout: aan het trackeinde
   * geeft "loop 4s" start == einde, en een AudioBufferSourceNode speelt dan
   * volgens de spec de HELE buffer eindeloos. Weigeren.
   */
  _loopMag(start, end) { return Number.isFinite(start) && Number.isFinite(end) && end - start >= 0.02; }

  setLoopRange(start, end) {
    if (!this._loopMag(start, end)) return false;
    this.bron.setLoop(start, end);
    this.emit('change', this);
  }

  // ---- mixer-parameters (alles genormaliseerd 0..1) ----------------------

  set(param, norm) {
    if (!(param in this.ui)) return;
    this.ui[param] = clamp(norm);
    this.applyUi(param);
    this.emit('change', this);
  }

  applyUi(only) {
    const now = this.ctx.currentTime;
    const c = this.chain, u = this.ui;
    if (!only || only === 'trim')   c.trim.gain.setTargetAtTime(u.trim * 2, now, 0.01);
    if (!only || only === 'low')    setEqBand(c.eqLow.gain, u.low, now);
    if (!only || only === 'mid')    setEqBand(c.eqMid.gain, u.mid, now);
    if (!only || only === 'high')   setEqBand(c.eqHigh.gain, u.high, now);
    if (!only || only === 'filter') setBipolarFilter(c.hpf, c.lpf, u.filter, now);
    if (!only || only === 'fader')  c.fader.gain.setTargetAtTime(faderGain(u.fader), now, 0.008);
    // Kwadratisch: het eerste stuk van de knop is subtiel, het laatste gooit.
    if (!only || only === 'sendA')  this.sendA.gain.setTargetAtTime(u.sendA * u.sendA, now, 0.01);
    if (!only || only === 'sendB')  this.sendB.gain.setTargetAtTime(u.sendB * u.sendB, now, 0.01);
  }

  level() { return piek(this.chain.analyser); }
}
