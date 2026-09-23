import { clamp } from '../lib/emitter.js';
import { startOpDeTel } from './fx.js';

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
    /*
     * Wat een lege pad terug kan halen: { deckId, van, tot, bpm, tellen, bron }.
     * Pure data; wie ze vult (de app, uit de library) weet de sampler niet.
     * Een pad die gevuld wordt meldt dat via onGevuld, een herinnering die
     * vergeten wordt via onVergeet.
     */
    this.herinneringen = Array.from({ length: AANTAL }, () => null);
    this.onGevuld = null;
    this.onVergeet = null;
  }

  setVolume(v) {
    this.volume = clamp(v);
    this.uit.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  volgendeLengte() { this.tellen = TELLEN[(TELLEN.indexOf(this.tellen) + 1) % TELLEN.length]; }

  /** De laatste `tellen` van een deck in pad n. */
  async neem(n, deck, { bron = null } = {}) {
    if (!deck?.buffer) throw new Error('er staat niets op deze track');
    const bereik = knipBereik(deck.grid, deck.position, this.tellen);
    if (!(await this._vul(n, deck, { ...bereik, bron }))) return;
    this.onGevuld?.(n, { deckId: deck.id, van: bereik.van, tot: bereik.tot, bpm: bereik.bpm, tellen: bereik.tellen, bron });
  }

  /** Een bewaarde pad opnieuw knippen, van het deck waar zijn nummer op staat. */
  async herstel(n, deck) {
    const h = this.herinneringen[n];
    if (!h) return false;
    if (!deck?.buffer) throw new Error('het nummer van deze pad staat niet meer op een track');
    return this._vul(n, deck, h);
  }

  /** Een herinnering vergeten (shift op een lege, bewaarde pad). */
  vergeet(n) {
    const h = this.herinneringen[n];
    if (!h) return false;
    this.herinneringen[n] = null;
    this.onVergeet?.(n, h);
    return true;
  }

  async _vul(n, deck, { van, tot, bpm, tellen, bron = null }) {
    if (this.bezig.has(n)) return false;
    this.bezig.add(n);
    try {
      if (tot - van < 0.05) throw new Error('te kort: speel eerst een stukje');
      const voorSec = Math.min(NAAD, van);
      const ruw = await deck.bron.knip(van - voorSec, tot);
      const voor = Math.round(voorSec * ruw.sampleRate);
      const kanalen = naadloos([ruw.getChannelData(0), ruw.getChannelData(1)], voor);
      const buf = this.ctx.createBuffer(2, kanalen[0].length, ruw.sampleRate);
      buf.getChannelData(0).set(kanalen[0]);
      buf.getChannelData(1).set(kanalen[1]);
      this.stop(n);
      this.pads[n] = { buffer: buf, bpm, bron, tellen, van, tot, deckId: deck.id, speelt: false, src: null, g: null };
      return true;
    } finally {
      this.bezig.delete(n);
    }
  }

  /** Starten op de volgende tel, of stoppen als hij al speelt. */
  wissel(n) {
    const pad = this.pads[n];
    if (!pad) return false;
    if (pad.speelt) { this.stop(n); return true; }
    const k = this.klok();
    // Op het tempo dat je hoort; zonder tempo van één van beide: gewoon zoals hij is.
    const rate = this._rate(pad, k);
    // Op de volgende tel; ligt die al binnen de uitgangsbuffer, de tel erna.
    const start = startOpDeTel(this.ctx, k);
    this._startBron(pad, start, 0, rate);
    pad.speelt = true;
    pad.start = start;
    return true;
  }

  /**
   * De afspeelsnelheid die de pad precies `tellen` tellen van de maat lang
   * maakt. Uit de BUFFERLENGTE, niet uit de bpm: de buffer is op hele
   * samples geknipt en dus een fractie te lang of te kort, en dat liep op tot
   * ~5 ms per 10 minuten. Zo is één rondgang exact tellen × tellengte.
   */
  _rate(pad, k) {
    if (!k?.beatLengte || !pad.bpm) return 1;
    if (pad.tellen > 0) return pad.buffer.duration / (pad.tellen * k.beatLengte);
    return (60 / k.beatLengte) / pad.bpm;
  }

  /** Een tel in het sample, in seconden: de buffer gedeeld door zijn tellen. */
  _tel(pad) { return pad.tellen > 0 ? pad.buffer.duration / pad.tellen : 60 / pad.bpm; }

  /**
   * Een bron voor deze pad, vanaf `offset` (seconden in het sample) op `wanneer`.
   * Het segment { T, P, R } is waar de positie van de pad uit volgt (regel 3):
   * geen teller, alleen de audioklok.
   */
  _startBron(pad, wanneer, offset, rate) {
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, wanneer);
    g.gain.linearRampToValueAtTime(1, wanneer + 0.005);
    src.connect(g).connect(this.uit);
    src.start(wanneer, offset);
    Object.assign(pad, { src, g, seg: { T: wanneer, P: offset, R: rate } });
  }

  /** Waar in het sample is deze pad op audiokloktijd t? */
  _positie(pad, t) {
    const { T, P, R } = pad.seg;
    const duur = pad.buffer.duration;
    const p = t <= T ? P : P + (t - T) * R;
    return ((p % duur) + duur) % duur;
  }

  /**
   * Tempo of tel van de maat veranderd (pitch, sync, seek, andere maat-track):
   * spelende pads lopen mee. De oude bron speelt door tot de volgende tel van
   * de maat; daar begint een nieuwe op het nieuwe tempo, op de dichtstbijzijnde
   * tel van het sample, en de oude vloeit er in 5 ms in over. Klopt alles al,
   * dan gebeurt er niets — dit wordt bij elke deckwijziging aangeroepen.
   */
  heranker() {
    const k = this.klok();
    if (!k?.beatLengte) return;
    const A = startOpDeTel(this.ctx, k);
    for (const pad of this.pads) {
      if (!pad?.speelt || !pad.bpm || !pad.seg) continue;
      const rate = this._rate(pad, k);
      const tel = this._tel(pad);                            // een tel in het sample
      const daar = this._positie(pad, A);
      const doel = (Math.round(daar / tel) * tel) % pad.buffer.duration;
      const faseGoed = Math.abs(daar - doel) < 0.001 || Math.abs(daar - doel) > pad.buffer.duration - 0.001;
      if (Math.abs(rate - pad.seg.R) < 1e-6 && faseGoed) continue;
      this._ruimOud(pad);
      const oud = { src: pad.src, g: pad.g };
      try {
        oud.g.gain.cancelScheduledValues?.(A);
        oud.g.gain.setValueAtTime(1, A);
        oud.g.gain.linearRampToValueAtTime(0, A + 0.005);
        oud.src.stop(A + 0.006);
      } catch (_) {}
      pad.oud = oud;
      this._startBron(pad, A, doel, rate);
    }
  }

  /** Een eerdere overgang die nog loopt: meteen weg, anders stapelen ze. */
  _ruimOud(pad) {
    if (!pad.oud) return;
    try { pad.oud.src.stop(); } catch (_) {}
    pad.oud = null;
  }

  stop(n) {
    const pad = this.pads[n];
    if (!pad?.speelt) return;
    const nu = this.ctx.currentTime;
    // Ook een oude bron die nog tot de volgende tel doorspeelt (heranker).
    for (const b of [pad, pad.oud].filter(Boolean)) {
      try {
        b.g.gain.cancelScheduledValues?.(nu);
        b.g.gain.setValueAtTime(b.g.gain.value, nu);
        b.g.gain.linearRampToValueAtTime(0, nu + FADE_UIT);
        b.src.stop(nu + FADE_UIT + 0.01);
      } catch (_) {}
    }
    Object.assign(pad, { speelt: false, src: null, g: null, oud: null, seg: null });
  }

  wis(n) { this.stop(n); this.pads[n] = null; }

  stand() {
    return this.pads.map((p, i) => ({
      pad: i + 1, gevuld: !!p, speelt: !!p?.speelt, bezig: this.bezig.has(i),
      bron: p?.bron ?? null, tellen: p?.tellen ?? null,
      // Leeg, maar terug te halen: van welke track en hoeveel tellen.
      bewaard: !p && !!this.herinneringen[i],
      bewaardBron: this.herinneringen[i]?.bron ?? null, bewaardTellen: this.herinneringen[i]?.tellen ?? null,
    }));
  }
}
