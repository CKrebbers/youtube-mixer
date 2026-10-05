import { Beatgrid } from '../engine/beatgrid.js';
import { strookPixels } from './grid-strook.js';

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
 * De zekerheidsstrook: een dunne balk per gridstuk onderaan (zie
 * grid-strook.js). Vol = zeker, gedimd = onzeker (sync en beat-loops weigeren
 * daar), rood gestreept = geen puls.
 */
export const STROOK_KLEUR = { zeker: 'rgba(80,220,255,0.85)', onzeker: 'rgba(80,220,255,0.28)', geenpuls: 'rgba(255,70,60,0.75)' };
function tekenStrook(g, pixels, y, h) {
  for (const p of pixels) {
    if (p.soort !== 'geenpuls') {
      g.fillStyle = STROOK_KLEUR[p.soort];
      g.fillRect(p.x0, y, p.x1 - p.x0, h);
      continue;
    }
    // Gestreept: 3 px aan, 3 px uit. Zo is het ook zonder kleurzien anders dan "gedimd".
    g.fillStyle = STROOK_KLEUR.geenpuls;
    for (let x = p.x0; x < p.x1; x += 6) g.fillRect(x, y, Math.min(3, p.x1 - x), h);
  }
}

/**
 * Onset-pieken (de klappen) als korte streepjes onderin de zoom: zo zie je of
 * de gridlijnen op de klappen vallen. Neutraal grijs en klein; in grid-modus
 * (`body.gridmodus`, gezet door de grid-modus op de APC) groter en helderder,
 * want dan ben je juist aan het uitlijnen.
 */
function tekenOnsets(g, onsets, range, span, w, h) {
  if (!onsets?.length) return;
  // Binair zoeken naar de eerste klap in beeld: een uur zijn er 18.000.
  let lo = 0, hi = onsets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < range.t0) lo = m + 1; else hi = m; }
  const grid = typeof document !== 'undefined' && document.body?.classList.contains('gridmodus');
  const lengte = grid ? Math.round(h * 0.22) : 5;
  g.fillStyle = grid ? 'rgba(230,235,240,0.8)' : 'rgba(200,205,210,0.35)';
  for (let i = lo; i < onsets.length && onsets[i] <= range.t1; i++) {
    const x = Math.round(((onsets[i] - range.t0) / span) * w);
    g.fillRect(x, h - lengte, 1, lengte);
  }
}

/** De strook onder een overzicht, in de cache per grid en maat. */
function strookVan(view, grid, duur, w) {
  const k = view._strookSleutel;
  if (k?.grid !== grid || k.duur !== duur || k.w !== w) {
    view._strookSleutel = { grid, duur, w };
    view._strookPx = grid ? strookPixels(grid.strook(duur), duur, w) : [];
  }
  return view._strookPx;
}

/**
 * Twee weergaven uit dezelfde peaks-array:
 *   - overview: hele track, statisch, met playhead en cues
 *   - zoom:     scrollend, playhead vast in het midden
 */
export class WaveformView {
  /** De tracktijd onder clientX, volgens wat er het laatst getekend is; null zonder tekening. */
  tijdBij(clientX) {
    const r = this.canvas.getBoundingClientRect();
    const g = this._range;
    if (!g || !(r.width > 0)) return null;
    return g.t0 + ((clientX - r.left) / r.width) * (g.t1 - g.t0);
  }

  constructor(canvas, { mode = 'zoom', pxPerSecond = 170, color = '#4ad9c4' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode;
    this.pxPerSecond = pxPerSecond;
    this.color = color;
    this.cache = null;
    this.sleutel = null;
    this._getekend = null;     // de tekensleutel van wat er nu op het canvas staat (zie zelfde())
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
    this._getekend = null;     // een nieuwe maat wist het canvas: opnieuw tekenen
  }

  /**
   * Staat precies dit al op het canvas? Dan niet opnieuw tekenen.
   *
   * Elke teken-actie op een canvas is een volledige upload naar de GPU. De
   * renderloop roept draw() elke frame aan, ook als er niets verandert: in rust
   * kostte dat ~29 Mpx/s (gemeten 5 okt, zoom + overzicht + acht banen) en hield
   * het de GPU van de M1 bezig, tot Demucs (stems) op de helft van zijn snelheid
   * liep. De sleutel bevat alles wat een draw() tekent, de positie in HELE
   * apparaatpixels; speelt er iets, dan verandert hij elke frame en tekent hij gewoon.
   */
  zelfde(analysis, onsets, ...delen) {
    const k = this._getekend;
    if (k && k.analysis === analysis && k.onsets === onsets && k.delen.length === delen.length
      && k.delen.every((x, i) => x === delen[i])) return true;
    this._getekend = { analysis, onsets, delen };
    return false;
  }

  /** De grid-sleutel (dezelfde tekst als _grid() gebruikt), of '' zonder grid. */
  _gridTekst(json) { return json ? JSON.stringify(json) : ''; }

  /**
   * De snapshot geeft het grid als JSON; rekenen doet de Beatgrid-klasse.
   * Eén keer per wijziging opbouwen, niet elke frame.
   */
  _grid(json) {
    const sleutel = JSON.stringify(json);
    if (sleutel !== this._gridSleutel) { this._gridSleutel = sleutel; this._gridObj = Beatgrid.van(json); }
    return this._gridObj;
  }

  /**
   * Beatlijnen. De eerste tel van elke maat krijgt een vollere lijn: zonder dat
   * onderscheid zie je wel een raster maar niet wáár je bent. Met een
   * tempokaart rekent elke lijn met het stuk waar hij in valt.
   */
  tekenGrid(grid, range, span, w, h) {
    const g = this.ctx;
    // Bij heel snel uitzoomen lijnen overslaan in plaats van dichtsmeren.
    const pxPerBeat = (grid.beatLengthAt((range.t0 + range.t1) / 2) / span) * w;
    if (pxPerBeat < 1.5) return;
    const stap = pxPerBeat < 6 ? grid.beatsPerBar : 1;
    for (const b of grid.beatsBetween(range.t0, range.t1, 2048, stap)) {
      const x = Math.round(((b.tijd - range.t0) / span) * w) + 0.5;
      g.fillStyle = b.maatbegin ? 'rgba(255,190,60,0.55)' : 'rgba(255,255,255,0.13)';
      g.fillRect(x, b.maatbegin ? 0 : h * 0.18, 1, b.maatbegin ? h : h * 0.64);
    }
  }

  /**
   * Waar een nieuw gridstuk begint: een cyaan lijn met een driehoekje boven,
   * en het tempo erbij in de zoom. Zo zie je waar "vanaf hier" begint.
   */
  tekenStukken(grid, range, span, w, h) {
    if (grid.aantalStukken < 2) return;
    const g = this.ctx;
    const zoom = this.mode === 'zoom';
    grid.stukken.forEach((s, i) => {
      if (i === 0 || s.van < range.t0 || s.van > range.t1) return;
      const x = Math.round(((s.van - range.t0) / span) * w) + 0.5;
      g.fillStyle = 'rgba(80,220,255,0.8)';
      g.fillRect(x, 0, 1, zoom ? h : h * 0.3);
      g.beginPath();
      g.moveTo(x - 4, 0); g.lineTo(x + 5, 0); g.lineTo(x + 0.5, 6);
      g.fill();
      if (zoom) {
        g.font = '10px system-ui, sans-serif';
        g.fillText(s.bpm.toFixed(2), x + 4, 16);
      }
    });
  }

  /** `onsets`: de klappen van het deck (deck.onsets), alleen voor de zoom. */
  draw(deckState, analysis, onsets = null) {
    const g = this.ctx, w = this.w, h = this.h, mid = h / 2;
    const dpr = window.devicePixelRatio || 1;
    const d = deckState;
    const kop = this.mode === 'overview'
      ? (d.duration ? Math.round((d.position / d.duration) * w * dpr) : 0)
      : Math.round(d.position * this.pxPerSecond * dpr);
    if (this.zelfde(d.loaded ? analysis : null, this.mode === 'zoom' ? onsets : null, this.mode, this.pxPerSecond, dpr, w, h, d.loaded, d.duration, kop,
      d.loop ? `${d.loop.start}|${d.loop.end}` : '', d.cuePoint, d.hotcues.join(','), this._gridTekst(d.grid))) return;
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
    this._range = range;                // voor tijdBij (een klik in de golfvorm)

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
    const grid = deckState.grid ? this._grid(deckState.grid) : null;
    if (grid && this.mode === 'zoom') this.tekenGrid(grid, range, span, w, h);

    // golfvorm: het overzicht uit de cache, de zoom scrolt en tekent elke frame
    if (this.mode === 'overview') g.drawImage(this.golfCache(analysis, deckState.duration, w, h), 0, 0, w, h);
    else tekenGolf(g, analysis, range, w, h, this.color);

    // afgespeeld deel dimmen (alleen in overview)
    if (this.mode === 'overview') {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, 0, (pos / deckState.duration) * w, h);
    }

    // Stukgrenzen in beide weergaven, bovenop de golf: in het overzicht zie
    // je zo waar het tempo wisselt.
    if (grid) this.tekenStukken(grid, range, span, w, h);

    // Klappen in de zoom; de zekerheidsstrook onder het overzicht.
    if (this.mode === 'zoom') tekenOnsets(g, onsets, range, span, w, h);
    else if (grid) tekenStrook(g, strookVan(this, grid, deckState.duration, w), h - 3, 3);

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
    const dpr = window.devicePixelRatio || 1;
    const kop = d.duration ? Math.round((d.position / d.duration) * w * dpr) : 0;
    if (this.zelfde(d.loaded ? analysis : null, null, 'baan', dpr, w, h, d.loaded, d.duration, kop,
      d.loop ? `${d.loop.start}|${d.loop.end}` : '', d.hotcues.join(','), this._gridTekst(d.grid))) return;
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
    // Zekerheid van het grid, per stuk: onderste twee pixels.
    const grid = d.grid ? this._grid(d.grid) : null;
    if (grid) tekenStrook(g, strookVan(this, grid, d.duration, w), h - 2, 2);
    g.fillStyle = '#ff3b30';
    g.fillRect(x(d.position) - 1, 0, 2, h);
  }
}
