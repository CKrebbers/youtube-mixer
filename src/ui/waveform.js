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
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
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

    const { peaks, samplesPerBucket, sampleRate, count } = analysis;
    const bucketsPerSec = sampleRate / samplesPerBucket;
    const pos = deckState.position;

    const range = this.mode === 'overview'
      ? { t0: 0, t1: deckState.duration }
      : { t0: pos - (w / 2) / this.pxPerSecond, t1: pos + (w / 2) / this.pxPerSecond };

    const span = range.t1 - range.t0;
    const bucketsPerPx = (span * bucketsPerSec) / w;

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

    // golfvorm
    g.fillStyle = this.color;
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
      g.fillStyle = ['#ff5f56', '#ffbd2e', '#27c93f', '#5ac8fa'][i];
      g.fillRect(x - 1, 0, 2, h);
      g.fillRect(x - 1, 0, 11, 11);
      g.fillStyle = '#000';
      g.font = '9px ui-monospace, monospace';
      g.fillText(String(i + 1), x + 2, 8);
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
