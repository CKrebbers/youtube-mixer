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
/** Beatjump-lengtes in tellen, te halveren en te verdubbelen. Standaard 4. */
export const SPRONG_TELLEN = [1, 2, 4, 8, 16, 32];

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
    // Quantize: cue, hotcues en loop in/out op de tel, hotcue-sprongen
    // fasebehoudend. Eén schakelaar voor de hele engine (Engine.setQuantize
    // zet hem op elk deck); het deck leest alleen deze vlag.
    this.quantize = false;
    this.sprongTellen = 4;      // beatjump-lengte, zie SPRONG_TELLEN
    this.loopInPunt = null;     // loop in gezet, wacht op loop out (tracktijd)
    this.vorigeLoop = null;     // voor reloop: de laatste loop die eraf ging

    this.grid = null;           // Beatgrid, of null als de track nog niet uitgemeten is
    // Onset-pieken (tracktijd, s), gesorteerde Float64Array, of null. Alleen
    // data: de UI zet ze na het laden van een library-nummer, "tel 1 hier"
    // snapt ernaar en de zoom tekent ze. Het deck rekent er zelf niet mee.
    this.onsets = null;

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
    this.onsets = null;
    this.loopBeats = null;
    this.loopInPunt = null;
    this.vorigeLoop = null;
    // Een nieuw nummer begint op 0%: de pitch van het vorige zegt niets over
    // dit nummer. Het bereik blijft staan, dat is een keuze van de DJ.
    this.setRate(1);
    this.emit('load', this);
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
    // Wacht het deck op de maat, dan blijft die start staan: alleen het punt
    // waar hij begint verschuift (hotcue, beatjump, nudge tijdens het wachten).
    if (this.playing) this.bron.start(p, this._startOpties());
    else this.bron.plaats(p);
    this._heranker();
    this.emit('change', this);
  }

  nudge(seconds) { this.seek(this.position + seconds, { binnenLoop: true }); }

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
    if (!this.grid || !this.playing) return null;
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

  hotcue(i, { del = false } = {}) {
    if (!this.buffer) return;
    if (del) { this.hotcues[i] = null; this.emit('change', this); return; }
    // Quantize: zetten op de tel, springen fasebehoudend (_snap, _faseDoel).
    if (this.hotcues[i] === null) this.hotcues[i] = this._snap(this.position);
    else this._naarHotcue(this.hotcues[i]);
    this.emit('change', this);
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
    this.seek(doel, { binnenLoop: binnen });
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
   * @returns {{ ok: boolean, waarom?: 'leeg'|'geengrid'|'onzeker'|'rand' }}
   */
  beatjump(richting, tellen = this.sprongTellen) {
    if (!this.buffer) return { ok: false, waarom: 'leeg' };
    if (!this.grid) return { ok: false, waarom: 'geengrid' };
    const g = this.grid, p = this.position;
    const n = Math.sign(richting) * tellen;
    const doel = g.verschuif(p, n);
    if (!this._opGrid(p) || !this._opGrid(doel)) return { ok: false, waarom: 'onzeker' };
    const l = this.loop;
    if (!l) {
      // Voorbij begin of einde: tegen de rand, zoals een CDJ. Daar houdt de fase op.
      this.seek(doel);
      return { ok: true };
    }
    const start = g.verschuif(l.start, n), eind = g.verschuif(l.end, n);
    if (!this._opGrid(start) || !this._opGrid(eind)) return { ok: false, waarom: 'onzeker' };
    if (start < 0 || eind > this.duration + 1e-9) return { ok: false, waarom: 'rand' };
    // Begin en einde schuiven evenveel tellen: loopBeats blijft kloppen.
    this._spring(doel, { start, end: eind });
    return { ok: true };
  }

  /**
   * Loop en positie in één keer: één segment voor de streamkern, één nieuwe
   * bron voor de BufferBron. Klikvrij via de gewone overgang van een sprong.
   */
  _spring(p, loop) {
    const pos = clamp(p, 0, this.duration);
    if (this.playing) this.bron.start(pos, this._startOpties({ loop }));
    else { this.bron.setLoop(loop.start, loop.end); this.bron.plaats(pos); }
    this._heranker();
    this.emit('change', this);
  }

  // ---- beatgrid ----------------------------------------------------------

  setGrid(grid) {
    this.grid = grid instanceof Beatgrid ? grid : Beatgrid.van(grid);
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
    this._heranker();
    this.emit('change', this);
  }

  /**
   * Is het grid HIER te vertrouwen voor sync en beat-loops? Null zonder grid.
   * Zie Beatgrid.zekerBij: op slot altijd, anders alleen een zeker stuk.
   */
  get gridZekerHier() { return this.grid ? this.grid.zekerBij(this.position) : null; }

  /** Hoorbare bpm op de huidige plek: het grid staat in tracktijd, de rate rekt dat op. */
  get bpm() { return this.grid ? this.grid.bpmAt(this.position) * this.rate : null; }

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
