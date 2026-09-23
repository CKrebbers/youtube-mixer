import { Emitter, clamp, piek } from '../lib/emitter.js';
import { createDeckChain, setEqBand, setBipolarFilter, faderGain } from './audio-graph.js';
import { Beatgrid } from './beatgrid.js';
import { BufferBron, StreamBron, geheugenHaal } from './bron.js';
import { maakWav } from './stream-kern.js';
import { InsertSlot } from './fx.js';

/**
 * Hoe ver de pitchfader reikt, naar elke kant. Kiesbaar per track; sync mag
 * altijd verder (0,5–2). Standaard ±16%: ±8% liet de fader na een grote sync
 * tegen de aanslag staan.
 */
export const PITCH_BEREIKEN = [0.08, 0.16, 0.5];
/** Hoeveel een nudge (bend) versnelt of vertraagt zolang je drukt. */
export const BEND = 0.04;

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
    // Tijdens het laden horen cue en hotcues nog bij de OUDE track (ze worden
    // pas gewist als de laad slaagt): dan niets vastpinnen in het nieuwe bestand.
    bron.vastpunten = () => (this._laadt ? [] : [this.cuePoint, ...this.hotcues, this.loop?.start ?? null]);
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
    // Cue en hotcues NIET hier wissen maar pas in _naLaden: mislukt de laad
    // (404, verkeerd formaat), dan staat de oude track er nog, met zijn punten.
    this._laadt = (this._laadt || 0) + 1;
    try {
      await this.bron.laad({ url, haal: opties?.haal });
    } catch (err) {
      if (err.vervangen) return false;      // er kwam een nieuwere laad overheen: die wint
      throw err;
    } finally {
      this._laadt--;
    }
    this._naLaden(title);
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

  _naLaden(title) {
    this.title = title || 'untitled';
    this.cuePoint = 0;
    this.hotcues = [null, null, null, null];
    this.grid = null;
    this.loopBeats = null;
    // Een nieuw nummer begint op 0%: de pitch van het vorige zegt niets over
    // dit nummer. Het bereik blijft staan, dat is een keuze van de DJ.
    this.setRate(1);
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
  seek(pos, { binnenLoop = false } = {}) {
    if (!this.buffer) return;
    let p = clamp(pos, 0, this.duration);
    const l = this.loop;
    if (l && (p < l.start || p >= l.end)) {
      const len = l.end - l.start;
      if (binnenLoop && len > 0) p = l.start + ((((p - l.start) % len) + len) % len);
      else this._verlaatLoop();
    }
    if (this.playing) this.bron.start(p);
    else this.bron.plaats(p);
    this.fx.heranker();
    this.emit('change', this);
  }

  nudge(seconds) { this.seek(this.position + seconds, { binnenLoop: true }); }

  /** Loop eraf zonder 'change' te melden: de aanroeper meldt zelf. */
  _verlaatLoop() {
    this.loopBeats = null;
    if (this.loop) this.bron.clearLoop();
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
    this.fx.heranker();
  }

  setRate(r) {
    const nr = clamp(r, 0.5, 2);
    this.rate = nr;
    this.bron.setRate(this.buigt ? nr * (1 + BEND * this.buigt) : nr);
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
    if (this.playing) {
      this.stop();
      // Zelfde regel als seek: een cuepunt buiten de loop verlaat de loop,
      // anders vouwt de volgende play hem er weer in.
      const l = this.loop;
      if (l && (this.cuePoint < l.start || this.cuePoint >= l.end)) this._verlaatLoop();
      this.bron.plaats(this.cuePoint);
    }
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
    const eind = Math.min(start + lengte, this.duration);
    // Geklemd op het trackeinde is het geen `beats` tellen meer: dan geen LED.
    return this._zetLoop(start, eind, eind - start > lengte - 1e-6 ? beats : null);
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
