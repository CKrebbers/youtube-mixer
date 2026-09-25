/**
 * De afspeelbron: het enige stuk dat weet HOE er geluid uit een track komt.
 *
 * Het deck kent transport, cues, loops en beatgrid — allemaal muzikale zaken.
 * Hoe die tracktijd geluid wordt, staat hier. Daardoor zijn er straks drie
 * inwisselbare bronnen mogelijk zonder dat het deck verandert:
 *
 *   BufferBron    wat we nu hebben: AudioBufferSourceNode, pitch schuift mee
 *   StretchBron   keylock via een time-stretcher in een AudioWorklet
 *   StreamBron    pagina-cache op schijf, voor acht tracks tegelijk
 *
 * Het contract:
 *   laad(buffer) · start(vanaf, { op, loop }) · stop() · pauzeer() · plaats(p)
 *   positie · speelt · duur · buffer (waarheidswaarde: is er iets geladen)
 *   setRate(r) · setLoop(start, end) · clearLoop() · ctxTimeOf(t)
 *   wachtTot          audiokloktijd waarop een GEPLANDE start begint, anders null
 *   vernietig()       opruimen als het deck een andere soort bron kiest
 *   onEinde = fn      alleen bij een ECHT trackeinde
 *
 * Regel 3 van CLAUDE.md geldt hier onverkort: positie komt van ctx.currentTime,
 * nooit van een eigen teller. Elke bron moet dat waarmaken.
 */

import {
  STIL, PAGINA, PAGINA_BYTES, BYTES_PER_FRAME, positieOp, ctxTijdVan, leesWavKop, controleerWav, plan, reeksen,
} from './stream-kern.js';

/** Zo lang vloeit een bron in en uit bij start, seek en stop. Te kort om te horen, lang genoeg tegen een tik. */
export const DECLICK = 0.004;

/*
 * GEPLAND STARTEN (starten op de maat): start(vanaf, { op }) met `op` later
 * dan nu. De bron "speelt" dan al (speelt = true, zodat pauze het annuleert
 * en ctxTimeOf klopt), maar klinkt pas vanaf `op`, sample-exact op de
 * audioklok. Tot dan staat de positie stil op `vanaf` (zoals een sampler-pad
 * vóór zijn start: t <= T ? P). Tempo, loop en bend tijdens het wachten
 * houden het startmoment vast; een sprong plant het deck opnieuw op hetzelfde
 * moment (deck.seek). `wachtTot` zegt of en tot wanneer er gewacht wordt.
 *
 * `loop` in start(): loop en positie in één keer, voor beatjump in een loop en
 * reloop. Eerst setLoop en dan start gaf de streamkern twee segmenten vlak na
 * elkaar, en de overgang ging dan via een tussenstand die nooit bedoeld was.
 */
const gepland = (op, nu) => Number.isFinite(op) && op > nu;

export class BufferBron {
  constructor(ctx, uitgang) {
    this.ctx = ctx;
    this.uitgang = uitgang;      // node waar deze bron op aansluit
    this.buffer = null;
    this.source = null;
    this.speelt = false;
    this.rate = 1;
    this.loop = null;            // {start, end} in tracktijd
    this.onEinde = null;
    this._offset = 0;            // tracktijd bij _startedAt
    this._startedAt = 0;         // ctx.currentTime
  }

  get naam() { return 'buffer'; }
  get duur() { return this.buffer ? this.buffer.duration : 0; }
  get keylock() { return false; }

  laad(buffer) {
    this.stop();
    this.buffer = buffer;
    this._offset = 0;
    this.loop = null;
  }

  /**
   * Positie in tracktijd, afgeleid van de audioklok.
   * Binnen een loop wordt hij teruggevouwen, want de bron zelf loopt door.
   */
  get positie() {
    if (!this.buffer) return 0;
    if (!this.speelt) return this._offset;
    // Vóór een geplande start staat hij stil op zijn beginpunt.
    let p = this._offset + Math.max(0, this.ctx.currentTime - this._startedAt) * this.rate;
    if (this.loop) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % len);
    }
    return Math.min(p, this.buffer.duration);
  }

  /**
   * Wanneer passeert deze bron die tracktijd (voor het eerst vanaf nu), op de
   * audioklok? Zelfde regel als ctxTijdVan in de streamkern: binnen een loop
   * die al rondging telt de gevouwen positie, en vóór een geplande start
   * rekent hij vanaf die start.
   */
  ctxTimeOf(trackTijd) {
    if (!this.speelt || !this.buffer) return null;
    return ctxTijdVan({ T: this._startedAt, P: this._offset, R: this.rate, loop: this.loop, speelt: true },
      trackTijd, this.ctx.currentTime);
  }

  /** Wacht deze bron op een geplande start? Dan de audiokloktijd daarvan, anders null. */
  get wachtTot() { return this.speelt && this.ctx.currentTime < this._startedAt ? this._startedAt : null; }

  start(vanaf, { op = null, loop } = {}) {
    if (!this.buffer) return false;
    this.stop();
    if (loop !== undefined) this.loop = loop;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    // Eigen volumeregelaar per start: de oude bron vloeit in 4 ms uit, deze in
    // 4 ms in. Hard stoppen en midden in een golfvorm beginnen gaf bij elke
    // seek, hotcue en pauze een tik, harder naarmate er meer geluid was.
    const nu = this.ctx.currentTime;
    // Gepland: Web Audio start een bron zelf sample-exact op een latere tijd.
    const wanneer = gepland(op, nu) ? op : nu;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, nu);
    if (wanneer > nu) g.gain.setValueAtTime(0, wanneer);
    g.gain.linearRampToValueAtTime(1, wanneer + DECLICK);
    src.connect(g).connect(this.uitgang);
    this.bronGain = g;
    // Vuurt alleen bij een ECHT trackeinde: bij stop() halen we de handler
    // eraf, want een afgedankte bron die 'einde' roept terwijl zijn opvolger
    // al speelt zet het hele deck op zijn kop.
    src.onended = () => {
      this.speelt = false;
      this._offset = this.duur;
      this.onEinde?.();
    };
    src.start(wanneer > nu ? wanneer : 0, vanaf);
    this.source = src;
    this._offset = vanaf;
    this._startedAt = wanneer;
    this.speelt = true;
    return true;
  }

  stop() {
    if (this.source) {
      const src = this.source, g = this.bronGain;
      src.onended = null;
      const nu = this.ctx.currentTime;
      try {
        // Uitvloeien in plaats van afkappen. cancelAndHold houdt de waarde vast
        // waar een lopende fade-in nu is, anders springt hij eerst naar 1.
        if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(nu);
        else { g.gain.cancelScheduledValues?.(nu); g.gain.setValueAtTime(g.gain.value, nu); }
        g.gain.linearRampToValueAtTime(0, nu + DECLICK);
        src.stop(nu + DECLICK + 0.001);
      } catch (_) { try { src.stop(); } catch (__) {} }
      src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (_) {} };
      this.source = null;
      this.bronGain = null;
    }
    this.speelt = false;
  }

  /** Stoppen én de positie onthouden waar je was. */
  pauzeer() {
    if (!this.speelt) return;
    const p = this.positie;
    this.stop();
    this._offset = p;
  }

  /** Positie zetten terwijl hij stilstaat. */
  plaats(p) { this._offset = p; }

  /** Een stuk tracktijd als losse AudioBuffer, voor de sampler. */
  async knip(van, tot) {
    if (!this.buffer) throw new Error('niets geladen');
    const sr = this.buffer.sampleRate;
    const a = Math.max(0, Math.round(van * sr)), b = Math.min(this.buffer.length, Math.round(tot * sr));
    const uit = this.ctx.createBuffer(2, Math.max(1, b - a), sr);
    for (let k = 0; k < 2; k++) {
      const bron = this.buffer.getChannelData(Math.min(k, this.buffer.numberOfChannels - 1));
      uit.getChannelData(k).set(bron.subarray(a, b));
    }
    return uit;
  }

  vernietig() { this.stop(); this.buffer = null; }

  setRate(r) {
    if (this.speelt && this.source) {
      if (this.wachtTot !== null) {
        // Nog niet begonnen: het startmoment en -punt blijven, alleen de
        // snelheid vanaf daar verandert. Meteen, er klinkt nog niets.
        this.source.playbackRate.setValueAtTime(r, this.ctx.currentTime);
      } else {
        // Eerst de teller bijwerken met de OUDE rate, anders klopt de positie niet.
        this._offset = this.positie;
        this._startedAt = this.ctx.currentTime;
        this.source.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.02);
      }
    }
    this.rate = r;
  }

  setLoop(start, end) {
    this.loop = { start, end };
    if (this.source) {
      this.source.loop = true;
      this.source.loopStart = start;
      this.source.loopEnd = end;
    }
  }

  clearLoop() {
    if (!this.loop) return;
    const p = this.positie;
    const wacht = this.wachtTot !== null;
    this.loop = null;
    if (this.source) this.source.loop = false;
    // Wacht hij nog op een geplande start, dan blijft die staan.
    if (wacht) return;
    // De bron speelt lineair verder vanaf de gewrapte positie; alleen de teller
    // moet daarop gezet worden. Opnieuw starten zou een hoorbare klik geven.
    this._offset = p;
    this._startedAt = this.ctx.currentTime;
  }
}

// ---- streamen -------------------------------------------------------------

/**
 * Een `haal` die Range-verzoeken beantwoordt uit een WAV in het geheugen, zoals
 * de server dat met audio.wav doet. Zo speelt een los bestand door precies
 * dezelfde StreamBron als de library: één afspeelmotor.
 */
export function geheugenHaal(wav) {
  const bytes = new Uint8Array(wav);
  return async (_url, init = {}) => {
    const m = /bytes=(\d+)-(\d*)/.exec(init.headers?.Range || '');
    if (!m) return new Response(bytes.slice(), { status: 200 });
    const a = Number(m[1]);
    const b = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
    if (a >= bytes.length || b < a) return new Response(null, { status: 416 });
    return new Response(bytes.slice(a, b + 1), { status: 206 });
  };
}

/** De worklet-module één keer per AudioContext laden. */
const modules = new WeakMap();
export function laadStreamModule(ctx) {
  if (!modules.has(ctx)) {
    modules.set(ctx, ctx.audioWorklet.addModule(new URL('./stream-lezer.js', import.meta.url)));
  }
  return modules.get(ctx);
}

/**
 * Speelt een WAV-bestand af zonder het in het geheugen te laden.
 *
 * Alleen pagina's rond de afspeelpositie, de loop en de vaste punten
 * (cue, hotcues) staan in het geheugen: een paar MB per deck, of de track
 * nu vier minuten duurt of drie uur. De worklet (`stream-lezer.js`) speelt ze
 * af; deze klasse beslist welke er moeten zijn en haalt ze op.
 *
 * Een sprong naar een plek die er nog niet is, geeft een paar tientallen
 * milliseconden stilte. Daarom zijn hotcues en het cuepunt vastgepind.
 */
export class StreamBron {
  constructor(ctx, uitgang, { haal = (url, init) => fetch(url, init), interval = 100 } = {}) {
    this.ctx = ctx;
    this.uitgang = uitgang;
    this.haal = haal;
    this.standaardHaal = haal;      // per laad te vervangen (geheugenHaal voor losse bestanden)
    this.interval = interval;
    this.node = null;
    this.seg = STIL;
    this.rate = 1;
    this.loop = null;
    this.onEinde = null;
    this.vastpunten = () => [];     // het deck vult dit in: cue, hotcues
    this.bestand = null;            // { url, kop, duur }
    this.geladen = new Map();       // pagina -> bytes, wat de worklet heeft
    this.onderweg = new Set();
    this.fouten = 0;
    this._timer = null;
    this._generatie = 0;            // oude antwoorden na een nieuwe laad() negeren
  }

  get naam() { return 'stream'; }
  get keylock() { return false; }
  get duur() { return this.bestand ? this.bestand.duur : 0; }
  get speelt() { return this.seg.speelt; }
  /** Het deck vraagt alleen "is er iets geladen"; een echte AudioBuffer is er niet. */
  get buffer() { return this.bestand ? { duration: this.duur, stream: true } : null; }
  get geheugen() { let n = 0; for (const b of this.geladen.values()) n += b; return n; }

  get positie() {
    if (!this.bestand) return 0;
    // Vóór een geplande start (T in de toekomst) staat hij stil op P.
    return Math.min(positieOp(this.seg, Math.max(this.ctx.currentTime, this.seg.T)), this.duur);
  }

  /** Wacht deze bron op een geplande start? Dan de audiokloktijd daarvan, anders null. */
  get wachtTot() { return this.seg.speelt && this.ctx.currentTime < this.seg.T ? this.seg.T : null; }

  /*
   * ctxTijdVan klopt ook vóór een geplande start: dan rekent hij vanaf T
   * (daar staat hij op P), dus T + (x − P) / R, en een punt in de loop vóór P
   * komt pas na een ronde langs.
   */
  ctxTimeOf(x) { return ctxTijdVan(this.seg, x, this.ctx.currentTime); }

  /**
   * Een WAV-bestand openen. Leest alleen de kop, en haalt dan de eerste
   * pagina's en de vaste punten op voordat hij teruggeeft: zo speelt play
   * direct na het laden meteen.
   */
  async laad({ url, haal = null }) {
    this.stop();
    this.haal = haal || this.standaardHaal;
    this.fouten = 0;
    // Elke laad krijgt een nummer; na elke await kijken of hij nog de
    // laatste is. Twee keer snel laden mengde anders pagina's van twee
    // nummers, en een vernietigde bron bouwde zijn worklet weer op.
    const gen = ++this._generatie;
    const nogActueel = () => {
      if (gen !== this._generatie || this._vernietigd) throw Object.assign(new Error('vervangen door een nieuwere laad'), { vervangen: true });
    };
    await laadStreamModule(this.ctx);
    nogActueel();
    if (!this.node) {
      this.node = new AudioWorkletNode(this.ctx, 'stream-lezer', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node.port.onmessage = ({ data: m }) => { if (m.type === 'einde' && (m.id === undefined || m.id === this._segId)) this._einde(); };
      this.node.connect(this.uitgang);
    }
    const res = await this.haal(url, { headers: { Range: 'bytes=0-65535' } });
    nogActueel();
    if (!res.ok) throw new Error(`audio niet gevonden (${res.status})`);
    const kop = leesWavKop(await res.arrayBuffer());
    nogActueel();
    const fout = controleerWav(kop);
    if (fout) throw new Error(fout);

    this.bestand = { url, kop, duur: kop.dataLengte / BYTES_PER_FRAME / kop.sampleRate };
    this.geladen.clear();
    this.onderweg.clear();
    this.loop = null;
    this.seg = STIL;
    this.node.port.postMessage({ type: 'bron', duur: this.duur, sr: kop.sampleRate });
    this._stuur();
    await this.bijvullen();
    nogActueel();
    this._timer ??= setInterval(() => this.bijvullen().catch(() => {}), this.interval);
  }

  /** Vergelijkt wat er moet zijn met wat er is, haalt op en ruimt op. */
  async bijvullen() {
    if (!this.bestand || !this.node) return;
    const { kop } = this.bestand;
    const nodig = plan({
      positie: this.positie, rate: this.seg.speelt ? this.seg.R : this.rate,
      duur: this.duur, sr: kop.sampleRate, vastpunten: this.vastpunten(), loop: this.loop,
    });
    const set = new Set(nodig);
    for (const i of [...this.geladen.keys()]) {
      if (!set.has(i)) { this.geladen.delete(i); this.node.port.postMessage({ type: 'weg', i }); }
    }
    const ontbreekt = nodig.filter((i) => !this.geladen.has(i) && !this.onderweg.has(i));
    if (!ontbreekt.length) return;
    // Belangrijkste eerst: de eerste reeks bevat wat nu klinkt. Hooguit drie
    // verzoeken tegelijk, anders verdringen ze elkaar bij een sprong.
    const lijst = reeksen(ontbreekt.slice(0, 24)).sort((a, b) =>
      ontbreekt.indexOf(a.van) - ontbreekt.indexOf(b.van)).slice(0, 3);
    await Promise.all(lijst.map((r) => this._haalReeks(r)));
  }

  async _haalReeks({ van, tot }) {
    const { url, kop } = this.bestand;
    // Het BESTAND vastpakken, niet een getal: bij een snelle tweede laad
    // was het getal al opgehoogd voordat deze reeks begon.
    const bestand = this.bestand;
    for (let i = van; i <= tot; i++) this.onderweg.add(i);
    try {
      const a = kop.dataStart + van * PAGINA_BYTES;
      const b = Math.min(kop.dataStart + kop.dataLengte, kop.dataStart + (tot + 1) * PAGINA_BYTES) - 1;
      const res = await this.haal(url, { headers: { Range: `bytes=${a}-${b}` } });
      if (res.status !== 206) throw new Error(`geen deelantwoord (${res.status})`);
      const bytes = await res.arrayBuffer();
      if (this.bestand !== bestand || !this.node) return;   // intussen een ander nummer
      for (let i = van; i <= tot; i++) {
        const o = (i - van) * PAGINA_BYTES;
        if (o >= bytes.byteLength) break;
        // Kopie per pagina, zodat hij los overgedragen en later los
        // weggegooid kan worden. Int16 is little-endian, net als de WAV.
        const stuk = bytes.slice(o, Math.min(bytes.byteLength, o + PAGINA_BYTES));
        const data = new Int16Array(stuk);
        this.geladen.set(i, stuk.byteLength);
        this.node.port.postMessage({ type: 'pagina', i, data }, [data.buffer]);
      }
    } catch (err) {
      this.fouten++;
      if (this.fouten <= 3) console.warn('[stream] pagina ophalen mislukt:', err.message);
      // Eén keer per reeks fouten laten weten; een hapering zonder uitleg is erger.
      if (this.fouten === 1 || this.fouten % 20 === 0) this.onFout?.(`stream hapert: ${err.message}`);
    } finally {
      for (let i = van; i <= tot; i++) this.onderweg.delete(i);
    }
  }

  /**
   * Een stuk tracktijd als losse AudioBuffer, voor de sampler. Opnieuw van
   * schijf gelezen: de pagina's zitten in de worklet, en wat er achter de
   * positie ligt is misschien al opgeruimd.
   */
  async knip(van, tot) {
    if (!this.bestand) throw new Error('niets geladen');
    const { url, kop } = this.bestand;
    const sr = kop.sampleRate;
    const a0 = Math.max(0, Math.round(van * sr)), b0 = Math.min(kop.dataLengte / BYTES_PER_FRAME, Math.round(tot * sr));
    if (b0 <= a0) throw new Error('leeg stuk');
    const res = await this.haal(url, { headers: { Range: `bytes=${kop.dataStart + a0 * BYTES_PER_FRAME}-${kop.dataStart + b0 * BYTES_PER_FRAME - 1}` } });
    if (res.status !== 206) throw new Error(`knippen mislukt (${res.status})`);
    const pcm = new Int16Array(await res.arrayBuffer());
    const n = pcm.length / 2;
    const uit = this.ctx.createBuffer(2, n, sr);
    const L = uit.getChannelData(0), R = uit.getChannelData(1);
    for (let i = 0; i < n; i++) { L[i] = pcm[i * 2] / 32768; R[i] = pcm[i * 2 + 1] / 32768; }
    return uit;
  }

  /**
   * `gepland`: T ligt in de toekomst en de worklet moet tot dan stil blijven
   * (of het oude segment laten doorklinken) en pas op T overvloeien. Zonder
   * die vlag begint de overgang zodra het bericht er is.
   */
  _stuur(gepland = false) {
    this._segId = (this._segId || 0) + 1;
    this.node?.port.postMessage({ type: 'segment', seg: this.seg, id: this._segId, ...(gepland ? { gepland: true } : {}) });
  }

  /** Het wachtende segment aanpassen zonder het startmoment te verliezen. */
  _pasWachtendAan(wijziging) {
    this.seg = { ...this.seg, ...wijziging };
    this._stuur(true);
  }

  _segment(p, speelt) {
    this.seg = { T: this.ctx.currentTime, P: p, R: this.rate, loop: this.loop, speelt };
    this._stuur();
  }

  _einde() {
    if (!this.seg.speelt) return;
    this.seg = { ...STIL, P: this.duur };
    this._stuur();
    this.onEinde?.();
  }

  start(vanaf, { op = null, loop } = {}) {
    if (!this.bestand) return false;
    if (loop !== undefined) this.loop = loop;
    if (gepland(op, this.ctx.currentTime)) {
      this.seg = { T: op, P: vanaf, R: this.rate, loop: this.loop, speelt: true };
      this._stuur(true);
    } else {
      this._segment(vanaf, true);
    }
    this.bijvullen().catch(() => {});             // meteen, niet pas bij de volgende tik
    return true;
  }

  /** Zoals BufferBron: stoppen zonder de positie bij te werken. */
  stop() {
    if (!this.seg.speelt) return;
    this.seg = { ...this.seg, speelt: false };
    this._stuur();
  }

  pauzeer() {
    if (!this.seg.speelt) return;
    this._segment(this.positie, false);
  }

  plaats(p) { this._segment(p, false); }

  setRate(r) {
    const p = this.positie;
    this.rate = r;
    if (this.wachtTot !== null) this._pasWachtendAan({ R: r });
    else if (this.seg.speelt) this._segment(p, true);
  }

  setLoop(start, end) {
    const p = this.positie;
    this.loop = { start, end };
    if (this.wachtTot !== null) this._pasWachtendAan({ loop: this.loop });
    else this._segment(p, this.seg.speelt);
  }

  clearLoop() {
    if (!this.loop) return;
    const p = this.positie;
    this.loop = null;
    if (this.wachtTot !== null) this._pasWachtendAan({ loop: null });
    else this._segment(p, this.seg.speelt);
  }

  vernietig() {
    this.stop();
    this._vernietigd = true;
    this._generatie++;
    clearInterval(this._timer);
    this._timer = null;
    this.bestand = null;
    this.geladen.clear();
    if (this.node) {
      this.node.port.postMessage({ type: 'bron', duur: 0, sr: 48000 });
      this.node.disconnect();
      this.node.port.onmessage = null;
      this.node = null;
    }
  }
}
