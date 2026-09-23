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
 *   laad(buffer) · start(vanaf) · stop() · pauzeer() · plaats(p)
 *   positie · speelt · duur · buffer (waarheidswaarde: is er iets geladen)
 *   setRate(r) · setLoop(start, end) · clearLoop() · ctxTimeOf(t)
 *   vernietig()       opruimen als het deck een andere soort bron kiest
 *   onEinde = fn      alleen bij een ECHT trackeinde
 *
 * Regel 3 van CLAUDE.md geldt hier onverkort: positie komt van ctx.currentTime,
 * nooit van een eigen teller. Elke bron moet dat waarmaken.
 */

import {
  STIL, PAGINA, PAGINA_BYTES, BYTES_PER_FRAME, positieOp, ctxTijdVan, leesWavKop, controleerWav, plan, reeksen,
} from './stream-kern.js';

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
    let p = this._offset + (this.ctx.currentTime - this._startedAt) * this.rate;
    if (this.loop) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % len);
    }
    return Math.min(p, this.buffer.duration);
  }

  /** Wanneer passeert deze bron die tracktijd, op de audioklok? */
  ctxTimeOf(trackTijd) {
    if (!this.speelt || !this.buffer) return null;
    return this._startedAt + (trackTijd - this._offset) / this.rate;
  }

  start(vanaf) {
    if (!this.buffer) return false;
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.connect(this.uitgang);
    // Vuurt alleen bij een ECHT trackeinde: bij stop() halen we de handler
    // eraf, want een afgedankte bron die 'einde' roept terwijl zijn opvolger
    // al speelt zet het hele deck op zijn kop.
    src.onended = () => {
      this.speelt = false;
      this._offset = this.duur;
      this.onEinde?.();
    };
    src.start(0, vanaf);
    this.source = src;
    this._offset = vanaf;
    this._startedAt = this.ctx.currentTime;
    this.speelt = true;
    return true;
  }

  stop() {
    if (this.source) {
      const src = this.source;
      src.onended = null;
      try { src.stop(); } catch (_) {}
      src.disconnect();
      this.source = null;
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

  vernietig() { this.stop(); this.buffer = null; }

  setRate(r) {
    if (this.speelt && this.source) {
      // Eerst de teller bijwerken met de OUDE rate, anders klopt de positie niet.
      this._offset = this.positie;
      this._startedAt = this.ctx.currentTime;
      this.source.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.02);
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
    this.loop = null;
    if (this.source) this.source.loop = false;
    // De bron speelt lineair verder vanaf de gewrapte positie; alleen de teller
    // moet daarop gezet worden. Opnieuw starten zou een hoorbare klik geven.
    this._offset = p;
    this._startedAt = this.ctx.currentTime;
  }
}

// ---- streamen -------------------------------------------------------------

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
    return Math.min(positieOp(this.seg, this.ctx.currentTime), this.duur);
  }

  ctxTimeOf(x) { return ctxTijdVan(this.seg, x); }

  /**
   * Een WAV-bestand openen. Leest alleen de kop, en haalt dan de eerste
   * pagina's en de vaste punten op voordat hij teruggeeft: zo speelt play
   * direct na het laden meteen.
   */
  async laad({ url }) {
    this.stop();
    this._generatie++;
    await laadStreamModule(this.ctx);
    if (!this.node) {
      this.node = new AudioWorkletNode(this.ctx, 'stream-lezer', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node.port.onmessage = ({ data: m }) => { if (m.type === 'einde') this._einde(); };
      this.node.connect(this.uitgang);
    }
    const res = await this.haal(url, { headers: { Range: 'bytes=0-65535' } });
    if (!res.ok) throw new Error(`audio niet gevonden (${res.status})`);
    const kop = leesWavKop(await res.arrayBuffer());
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
    const gen = this._generatie;
    for (let i = van; i <= tot; i++) this.onderweg.add(i);
    try {
      const a = kop.dataStart + van * PAGINA_BYTES;
      const b = Math.min(kop.dataStart + kop.dataLengte, kop.dataStart + (tot + 1) * PAGINA_BYTES) - 1;
      const res = await this.haal(url, { headers: { Range: `bytes=${a}-${b}` } });
      if (res.status !== 206) throw new Error(`geen deelantwoord (${res.status})`);
      const bytes = await res.arrayBuffer();
      if (gen !== this._generatie || !this.node) return;   // intussen een ander nummer
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
    } finally {
      for (let i = van; i <= tot; i++) this.onderweg.delete(i);
    }
  }

  _stuur() { this.node?.port.postMessage({ type: 'segment', seg: this.seg }); }

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

  start(vanaf) {
    if (!this.bestand) return false;
    this._segment(vanaf, true);
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
    if (this.seg.speelt) this._segment(p, true);
  }

  setLoop(start, end) {
    const p = this.positie;
    this.loop = { start, end };
    this._segment(p, this.seg.speelt);
  }

  clearLoop() {
    if (!this.loop) return;
    const p = this.positie;
    this.loop = null;
    this._segment(p, this.seg.speelt);
  }

  vernietig() {
    this.stop();
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
