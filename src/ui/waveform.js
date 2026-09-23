/**
 * De golfvorm zelf: per pixel het minimum en maximum van de peaks eronder.
 * Los van de klasse, zodat de baan hem één keer in een cache kan tekenen.
 */
function tekenGolf(g, analysis, range, w, h, color) {
  const { peaks, samplesPerBucket, sampleRate, count } = analysis;
  const bucketsPerSec = sampleRate / samplesPerBucket;
  const span = range.t1 - range.t0;
  const bucketsPerPx = (span * bucketsPerSec) / w;
  const mid = h / 2;
  g.fillStyle = color;
  for (let x = 0; x < w; x++) {
    const b0 = Math.floor(((range.t0 + (x / w) * span) * bucketsPerSec));
    const b1 = Math.max(b0 + 1, Math.floor(b0 + bucketsPerPx));
    if (b1 < 0 || b0 >= count) continue;
    let mn = 1, mx = -1;
    for (let b = Math.max(0, b0); b < Math.min(count, b1); b++) {
      const lo = peaks[b * 2], hi = peaks[b * 2 + 1];
      if (lo < mn) mn = lo;
      if (hi > mx) mx = hi;
    }
    if (mx < mn) continue;
    const y0 = mid - mx * mid * 0.95;
    const y1 = mid - mn * mid * 0.95;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

/**
 * Hotcues: geel met hun nummer, net als de pads op de APC en op het scherm
 * (--m-hotcues in styles.css). Eén kleur voor alle vier: het NUMMER zegt welke
 * het is, de kleur zegt "dit is een hotcue". Vier kleuren botsten met de
 * mapjekleuren van het grid (cyaan = loops, violet = sampler).
 */
export const HOTCUE_KLEUR = '#ffd23c';

/**
 * Twee weergaven uit dezelfde peaks-array:
 *   - overview: hele track, statisch, met playhead en cues
 *   - zoom:     scrollend, playhead vast in het midden
 */
export class WaveformView {
  constructor(canvas, { mode = 'zoom', pxPerSecond = 170, color = '#4ad9c4' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode;
    this.pxPerSecond = pxPerSecond;
    this.color = color;
    this.cache = null;
    this.sleutel = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /**
   * De golfvorm van de hele track, één keer getekend in een eigen canvas. Het
   * overzicht verandert alleen van positie; acht keer (plus het focusoverzicht)
   * per frame alle peaks van een album van een half uur aflopen kost te veel.
   * Opnieuw bij een andere analyse, lengte of canvasmaat.
   */
  golfCache(analysis, duur, w, h) {
    const k = this.sleutel;
    if (k?.analysis !== analysis || k.duur !== duur || k.w !== w || k.h !== h) {
      const dpr = window.devicePixelRatio || 1;
      this.cache ??= document.createElement('canvas');
      this.cache.width = w * dpr;
      this.cache.height = h * dpr;
      const c = this.cache.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      tekenGolf(c, analysis, { t0: 0, t1: duur }, w, h, this.color);
      this.sleutel = { analysis, duur, w, h };
    }
    return this.cache;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Beatlijnen. De eerste tel van elke maat krijgt een vollere lijn: zonder dat
   * onderscheid zie je wel een raster maar niet wáár je bent.
   */
  tekenGrid(grid, range, span, w, h) {
    const g = this.ctx;
    const beatLengte = 60 / grid.bpm;
    const perBar = grid.beatsPerBar || 4;
    // Bij heel snel uitzoomen lijnen overslaan in plaats van dichtsmeren.
    const pxPerBeat = (beatLengte / span) * w;
    const stap = pxPerBeat < 6 ? perBar : 1;
    if (pxPerBeat < 1.5) return;

    let beat = Math.ceil((range.t0 - grid.firstBeat) / beatLengte);
    beat -= ((beat % stap) + stap) % stap;
    for (let i = 0; i < 2048; i++, beat += stap) {
      const t = grid.firstBeat + beat * beatLengte;
      if (t > range.t1) break;
      const x = Math.round(((t - range.t0) / span) * w) + 0.5;
      const maatbegin = ((beat % perBar) + perBar) % perBar === 0;
      g.fillStyle = maatbegin ? 'rgba(255,190,60,0.55)' : 'rgba(255,255,255,0.13)';
      g.fillRect(x, maatbegin ? 0 : h * 0.18, 1, maatbegin ? h : h * 0.64);
    }
  }

  draw(deckState, analysis) {
    const g = this.ctx, w = this.w, h = this.h, mid = h / 2;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0b0e11';
    g.fillRect(0, 0, w, h);

    if (!analysis || !deckState.loaded) {
      g.fillStyle = '#2a3138';
      g.fillRect(0, mid - 0.5, w, 1);
      return;
    }

    const pos = deckState.position;

    const range = this.mode === 'overview'
      ? { t0: 0, t1: deckState.duration }
      : { t0: pos - (w / 2) / this.pxPerSecond, t1: pos + (w / 2) / this.pxPerSecond };

    const span = range.t1 - range.t0;

    // loopregio
    if (deckState.loop) {
      const x0 = ((deckState.loop.start - range.t0) / span) * w;
      const x1 = ((deckState.loop.end - range.t0) / span) * w;
      g.fillStyle = 'rgba(255,190,60,0.13)';
      g.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    // beatgrid: alleen in de zoomweergave, want in het overzicht van een half
    // uur vallen 9000 lijnen samen tot een grijze soep.
    if (deckState.grid && this.mode === 'zoom') this.tekenGrid(deckState.grid, range, span, w, h);

    // golfvorm: het overzicht uit de cache, de zoom scrolt en tekent elke frame
    if (this.mode === 'overview') g.drawImage(this.golfCache(analysis, deckState.duration, w, h), 0, 0, w, h);
    else tekenGolf(g, analysis, range, w, h, this.color);

    // afgespeeld deel dimmen (alleen in overview)
    if (this.mode === 'overview') {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, 0, (pos / deckState.duration) * w, h);
    }

    // hotcues
    deckState.hotcues.forEach((t, i) => {
      if (t === null) return;
      const x = ((t - range.t0) / span) * w;
      if (x < -10 || x > w + 10) return;
      g.fillStyle = HOTCUE_KLEUR;
      g.fillRect(x - 1, 0, 2, h);
      g.fillRect(x - 1, 0, 13, 13);
      g.fillStyle = '#000';
      g.font = 'bold 11px ui-monospace, monospace';
      g.fillText(String(i + 1), x + 2, 10);
    });

    // cuepunt
    const cx = ((deckState.cuePoint - range.t0) / span) * w;
    if (cx >= 0 && cx <= w) {
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.55;
      g.fillRect(cx - 0.5, 0, 1, h);
      g.globalAlpha = 1;
    }

    // playhead
    const px = this.mode === 'overview' ? (pos / deckState.duration) * w : w / 2;
    g.fillStyle = '#ff3b30';
    g.fillRect(px - 1, 0, 2, h);
  }
}

/**
 * Een dunne baan per track: het overzicht van de hele track, maar de golfvorm
 * zelf staat in een cache. Acht keer per frame alle peaks van een album van
 * een half uur aflopen kost te veel; alleen de speelpositie verandert.
 * De cache wordt opnieuw getekend als de analyse, de lengte of de maat van
 * het canvas verandert.
 */
export class BaanView extends WaveformView {
  constructor(canvas, opts = {}) {
    super(canvas, { ...opts, mode: 'overview' });
  }

  draw(d, analysis) {
    const g = this.ctx, w = this.w, h = this.h;
    g.fillStyle = '#0b0e11';
    g.fillRect(0, 0, w, h);
    if (!analysis || !d.loaded || !d.duration) {
      g.fillStyle = '#2a3138';
      g.fillRect(0, h / 2 - 0.5, w, 1);
      return;
    }
    g.drawImage(this.golfCache(analysis, d.duration, w, h), 0, 0, w, h);
    const x = (t) => (t / d.duration) * w;
    if (d.loop) {
      g.fillStyle = 'rgba(255,190,60,0.25)';
      g.fillRect(x(d.loop.start), 0, Math.max(1, x(d.loop.end) - x(d.loop.start)), h);
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, 0, x(d.position), h);
    d.hotcues.forEach((t, i) => {
      if (t === null) return;
      g.fillStyle = HOTCUE_KLEUR;
      g.fillRect(x(t) - 0.5, 0, 1, h);
    });
    g.fillStyle = '#ff3b30';
    g.fillRect(x(d.position) - 1, 0, 2, h);
  }
}
