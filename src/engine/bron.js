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
 *   laad(buffer) · start(vanaf) · stop() · positie · speelt · duur
 *   setRate(r) · setLoop(start, end) · clearLoop() · ctxTimeOf(t)
 *   onEinde = fn      alleen bij een ECHT trackeinde
 *
 * Regel 3 van CLAUDE.md geldt hier onverkort: positie komt van ctx.currentTime,
 * nooit van een eigen teller. Elke bron moet dat waarmaken.
 */

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
