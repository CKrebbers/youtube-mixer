import { clamp } from '../lib/emitter.js';

/**
 * De sampler: acht pads die een stukje van een track vasthouden en het als
 * loop terugspelen, op de tel en op het tempo van wat je hoort.
 *
 * Knippen gebeurt in TRACKTIJD, netjes op het beatgrid: "de laatste maat"
 * eindigt op de laatste tel vóór de positie. Afspelen start op de volgende
 * tel van de track die het hardst klinkt (dezelfde klok als sync en de
 * video-puls), en op diens tempo: een sample van 124 bpm in een set van
 * 120 bpm loopt 120/124 zo snel.
 *
 * Alles op de audioklok (regel 3): de start wordt ingepland op ctx-tijd,
 * niet met een timer.
 */

export const TELLEN = [1, 2, 4, 8];
export const AANTAL = 8;
const NAAD = 0.005;          // zo lang wordt het einde in het begin overgevloeid
const FADE_UIT = 0.02;

/**
 * Welk stuk tracktijd hoort bij "de laatste N tellen"?
 * Zonder grid: gewoon de laatste N halve seconden, en geen tempo.
 * @returns { van, tot, bpm|null }
 */
export function knipBereik(grid, positie, tellen) {
  if (!grid) return { van: Math.max(0, positie - tellen * 0.5), tot: positie, bpm: null, tellen };
  const laatsteTel = grid.timeOf(Math.floor(grid.beatAt(positie) + 1e-9));
  const tot = laatsteTel > 0 ? laatsteTel : positie;
  // Vlak na het begin passen er geen N tellen in. Dan minder HELE tellen
  // nemen, niet een afgekapt stuk dat als N tellen gaat loopen en uit de
  // maat loopt.
  const passen = Math.max(0, Math.floor(tot / grid.beatLength + 1e-9));
  const n = Math.min(tellen, passen);
  return { van: tot - n * grid.beatLength, tot, bpm: grid.bpm, tellen: n };
}

/**
 * Een loop zonder tik: het laatste stukje wordt equal-power overgevloeid
 * naar wat er vlak VÓÓR het begin stond, zodat het einde naadloos in het
 * begin overloopt. Hetzelfde idee als de loop-naad in de streamkern.
 *
 * @param kanalen  Float32Arrays met `voor` frames extra aan het begin
 * @param voor     hoeveel frames vóór het eigenlijke begin er zijn
 * @returns nieuwe Float32Arrays zonder die voorloop
 */
export function naadloos(kanalen, voor) {
  return kanalen.map((x) => {
    const uit = x.slice(voor);
    const n = uit.length;
    const f = Math.min(voor, Math.floor(n / 4));
    for (let i = 0; i < f; i++) {
      const w = (i + 1) / f;                     // 0 -> 1 naar het einde toe
      const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
      const j = n - f + i;
      uit[j] = uit[j] * a + x[voor - f + i] * b;
    }
    return uit;
  });
}

export class Sampler {
  /**
   * @param klok  () => { beatLengte, ankerCtx } van de track die de maat geeft, of null
   */
  constructor(ctx, uitgang, { klok = () => null } = {}) {
    this.ctx = ctx;
    this.klok = klok;
    this.uit = ctx.createGain();
    this.uit.connect(uitgang);
    this.volume = 0.8;
    this.uit.gain.value = this.volume;
    this.tellen = 4;
    this.pads = Array.from({ length: AANTAL }, () => null);
    this.bezig = new Set();
  }

  setVolume(v) {
    this.volume = clamp(v);
    this.uit.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  volgendeLengte() { this.tellen = TELLEN[(TELLEN.indexOf(this.tellen) + 1) % TELLEN.length]; }

  /** De laatste `tellen` van een deck in pad n. */
  async neem(n, deck, { bron = null } = {}) {
    if (!deck?.buffer) throw new Error('er staat niets op deze track');
    if (this.bezig.has(n)) return;
    this.bezig.add(n);
    try {
      const { van, tot, bpm, tellen } = knipBereik(deck.grid, deck.position, this.tellen);
      if (tot - van < 0.05) throw new Error('te kort: speel eerst een stukje');
      const voorSec = Math.min(NAAD, van);
      const ruw = await deck.bron.knip(van - voorSec, tot);
      const voor = Math.round(voorSec * ruw.sampleRate);
      const kanalen = naadloos([ruw.getChannelData(0), ruw.getChannelData(1)], voor);
      const buf = this.ctx.createBuffer(2, kanalen[0].length, ruw.sampleRate);
      buf.getChannelData(0).set(kanalen[0]);
      buf.getChannelData(1).set(kanalen[1]);
      this.stop(n);
      this.pads[n] = { buffer: buf, bpm, bron, tellen, speelt: false, src: null, g: null };
    } finally {
      this.bezig.delete(n);
    }
  }

  /** Starten op de volgende tel, of stoppen als hij al speelt. */
  wissel(n) {
    const pad = this.pads[n];
    if (!pad) return false;
    if (pad.speelt) { this.stop(n); return true; }
    const nu = this.ctx.currentTime;
    const k = this.klok();
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.loop = true;
    // Op het tempo dat je hoort; zonder tempo van één van beide: gewoon zoals hij is.
    if (k?.beatLengte && pad.bpm) src.playbackRate.value = (60 / k.beatLengte) / pad.bpm;
    const start = k?.ankerCtx && k.ankerCtx > nu ? k.ankerCtx : nu;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(1, start + 0.005);
    src.connect(g).connect(this.uit);
    src.start(start);
    Object.assign(pad, { speelt: true, src, g, start });
    return true;
  }

  stop(n) {
    const pad = this.pads[n];
    if (!pad?.speelt) return;
    const nu = this.ctx.currentTime;
    try {
      pad.g.gain.cancelScheduledValues?.(nu);
      pad.g.gain.setValueAtTime(pad.g.gain.value, nu);
      pad.g.gain.linearRampToValueAtTime(0, nu + FADE_UIT);
      pad.src.stop(nu + FADE_UIT + 0.01);
    } catch (_) {}
    Object.assign(pad, { speelt: false, src: null, g: null });
  }

  wis(n) { this.stop(n); this.pads[n] = null; }

  stand() {
    return this.pads.map((p, i) => ({
      pad: i + 1, gevuld: !!p, speelt: !!p?.speelt, bezig: this.bezig.has(i),
      bron: p?.bron ?? null, tellen: p?.tellen ?? null,
    }));
  }
}
