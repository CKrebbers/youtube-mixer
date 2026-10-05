/**
 * Keylock en toon verschuiven: het REKPAD van de streamende worklet
 * (docs/KEYLOCK.md, optie A; gebouwd 5 okt). Puur rekenwerk op één
 * Signalsmith-stretcher (`await fabriek()` uit vendor/signalsmith-stretch.js):
 * geen Web Audio, geen DOM, dus in Node te testen met de echte WASM.
 *
 * WAT JE HOORT (regel 3 over de draadgrens). De stretcher krijgt hele frames
 * tracktijd. Per blok op audiokloktijd t0 loopt de invoer tot
 *   doel = frame(positie(seg, t0 + uitLat + één blok)) + inLat
 * en dan is wat er op t0 uitkomt positie(seg, t0): dezelfde segmenten
 * {T, P, R, loop} en dezelfde formule als de hoofdthread (gemeten ±0,7 ms,
 * docs/KEYLOCK.md §2). Zonder dat ene blok klonk alles 2,6 ms te laat. Bij
 * ZOEKEN is het andersom: de nieuwe plek klinkt al op t0 + uitLat, dus daar
 * het doel (met t0 + uitLat + één blok kwam de eerste klik na een sprong
 * 128 frames te vroeg; de klikken erna klopten weer).
 *
 * DOORLOPEN OF ZOEKEN. Sluit het doel aan op wat de stretcher al had, dan
 * krijgt hij de frames ertussen (`_process(n, 128)`); ligt het een klein
 * stukje terug (tempo omlaag) dan even niets; verder weg = zoeken (`_seek`
 * met een venster vóór het doel). Ter plekke zoeken kost de eerste ~60 ms van
 * de nieuwe plek, dus een SPRONG wordt gepland (K3): een segment met T in de
 * toekomst, en tot T geldt het vorige (`vorig`, zoals positieIn). Hij zoekt in
 * het blok waarin t0 + uitLat T bereikt; ligt T op het zoekrooster (rekPlanT:
 * T − uitLat op een blokgrens), dan klinkt de nieuwe plek exact op T, op
 * volle sterkte (gemeten 0,0 ms). Anders tot een blok (2,7 ms) later.
 * Tempo, toon en loop gaan meteen in (T = nu): dat is geen sprong. Het nieuwe
 * segment begint waar het oude nu is; de invoer loopt door met een verschoven
 * telling (`zet`), zonder te zoeken.
 *
 * LOOPS. De invoer loopt UITGEROLD door de loop (leesInvoer): virtueel frame v
 * voorbij het einde = terug naar het begin, met dezelfde naad als renderBlok
 * (LOOP_NAAD, equal-power naar wat er vlak vóór het begin staat). De
 * stretcher ziet één doorlopend signaal en hoeft bij de naad niet te zoeken.
 *
 * TOON. Halve tonen voor de stretcher (rekToon): met keylock alleen de
 * verschuiving, zonder keylock ook de pitch (12·log2 R, K8), plus het verschil
 * tussen de samplefrequentie van het bestand en die van de AudioContext (een
 * stretcher houdt de toon per SAMPLE vast).
 *
 * STEMS. Eén stretcher met alle kanalen van het bestand (2, 4 of 8): de paren
 * lopen sample voor sample samen, zoals in renderBlok.
 *
 * GEEN AFVAL OP DE AUDIOTHREAD (zie stream-kern.js): blok() en leesInvoer()
 * maken per blok niets aan. De views in het WASM-geheugen worden één keer
 * gemaakt (opnieuw alleen als dat geheugen groeide); getallen die per blok
 * veranderen staan als double-veld op het object (NaN vanaf het begin); geen
 * hulpfunctie op het hete pad krijgt of geeft een losse double.
 */
import { PAGINA, LOOP_NAAD } from './stream-kern.js';

/** K2 (Clay, 5 okt: de luistertest klinkt goed): standaard, gespreid rekenen. */
export const REK = Object.freeze({ blokMs: 120, intervalMs: 30, gespreid: true });
/** Een render-quantum van de worklet. */
export const BLOK = 128;
/** Extra tijd bij een geplande sprong: het bericht moet de worklet nog halen. */
export const REK_MARGE = 0.008;
const TONALITEIT_HZ = 8000;
const MIN_BUFFER = 16384;

/**
 * De uitvoerlatentie van de stretcher in frames, zolang de worklet hem nog niet
 * gemeten heeft (bericht 'rek'): een half blok, plus één stap als het rekenen
 * gespreid is (gemeten op 48 kHz: 4320).
 */
export const rekUitLatStandaard = (sr) =>
  Math.floor(Math.round(REK.blokMs / 1000 * sr) / 2) + (REK.gespreid ? Math.round(REK.intervalMs / 1000 * sr) : 0);

/**
 * Het moment voor een geplande sprong met keylock: het eerste T ≥ `vroegst`
 * op het zoekrooster, dus met T − uitLat op een blokgrens (de audioklok telt
 * in blokken van 128 frames vanaf 0). Dan zoekt de stretcher in precies het
 * blok dat op T uitkomt (zie WAT JE HOORT). `vroegst` = nu + uitLat + marge:
 * het bericht moet er zijn vóór dat blok begint.
 */
export function rekPlanT(vroegst, uitLat, sr) {
  const k = Math.ceil((vroegst * sr - uitLat) / BLOK - 1e-9);
  return (k * BLOK + uitLat) / sr;
}

/** Moet dit segment door de stretcher? Keylock of een toon; een rem nooit (die zakt in toon, zoals vinyl). */
export const wilRek = (seg) => !!(seg && seg.rek && (seg.rek.keylock || seg.rek.toon) && !seg.rem);

/** Halve tonen voor de stretcher (zie TOON boven). Niet op het hete pad: blok() rekent het zelf uit. */
export function rekToon(rek, R, trackRate, ctxRate) {
  return (rek.keylock ? 0 : 12 * Math.log2(R)) + rek.toon + 12 * Math.log2(trackRate / ctxRate);
}

/**
 * `n` hele frames invoer vanaf virtueel frame `van`, alle `stride` kanalen,
 * naar kanalen[c][0..n). De loop van `seg` uitgerold, met de naad; vóór het
 * begin, na het einde (`totaal` frames) en in een gat (pagina ontbreekt):
 * stilte. Eén functie zonder hulpfuncties: geen afval (zie boven).
 */
export function leesInvoer(seg, paginas, van, n, kanalen, stride, trackRate, totaal) {
  const loop = seg.loop;
  let a = 0, b = 0, len = 0, nd = 0;
  if (loop) {
    a = Math.round(loop.start * trackRate);
    b = Math.round(loop.end * trackRate);
    len = b - a;
    if (len > 0) nd = Math.max(0, Math.min(Math.round(LOOP_NAAD * trackRate), Math.floor(len / 4), a));
  }
  let k0 = -1, p0 = null;               // de pagina van het frame
  let k1 = -1, p1 = null;               // de pagina van het naadframe
  for (let i = 0; i < n; i++) {
    let v = van + i;
    if (len > 0 && v >= b) v = a + ((v - a) % len);
    let j = -1;
    if (v >= 0 && v < totaal) {
      const k = Math.floor(v / PAGINA);
      if (k !== k0) { k0 = k; p0 = paginas.get(k) ?? null; }
      if (p0 !== null) {
        j = (v - k * PAGINA) * stride;
        if (j + stride > p0.length) j = -1;
      }
    }
    if (j >= 0) for (let c = 0; c < stride; c++) kanalen[c][i] = p0[j + c] * (1 / 32768);
    else for (let c = 0; c < stride; c++) kanalen[c][i] = 0;
    if (len > 0 && v >= a) {
      const rest = b - v;
      if (rest <= nd && rest > 0) {
        const w = 1 - rest / nd;
        const ca = Math.cos(w * Math.PI / 2), sb = Math.sin(w * Math.PI / 2);
        const g = a - rest;                 // ≥ 0: de naad is nooit langer dan wat er vóór het begin staat
        const kg = Math.floor(g / PAGINA);
        if (kg !== k1) { k1 = kg; p1 = paginas.get(kg) ?? null; }
        let jg = -1;
        if (p1 !== null && g < totaal) {
          jg = (g - kg * PAGINA) * stride;
          if (jg + stride > p1.length) jg = -1;
        }
        for (let c = 0; c < stride; c++) {
          const x = jg >= 0 ? p1[jg + c] * (1 / 32768) : 0;
          kanalen[c][i] = kanalen[c][i] * ca + x * sb;
        }
      }
    }
  }
}

/**
 * Eén stretcher voor één deck, op de ruwe exports van de module (zoals Kern
 * in tools/keylock/kern.mjs). `zet()` per bericht, `blok()` per render-quantum.
 * Na blok() staat de uitvoer in `uit[c][0..frames)`; geldig vanaf
 * audiokloktijd `geldig` (een stretcher die net begon, heeft eerst zijn
 * latentie te vullen).
 */
export class Rekker {
  /** @param M een module van fabriek() · @param sr de samplefrequentie van de AudioContext */
  constructor(M, sr) {
    this.M = M;
    this.sr = sr;
    this.kanalen = 0;
    this.inLat = 0;
    this.uitLat = 0;
    this.interval = 0;
    this.lengte = 0;
    this.ptr = 0;
    /** @type {Float32Array[]} */ this.in = [];
    /** @type {Float32Array[]} */ this.uit = [];
    this._buf = null;
    this.seg = null;             // wat er (vanaf seg.T) speelt
    this.vorig = null;           // wat er tot seg.T nog speelt (geplande sprong)
    this.lees = null;            // het segment waarvan de invoer nu komt (zijn telling)
    this.eind = NaN;             // eerste virtuele frame dat de stretcher nog niet had; NaN = zoeken
    this.toon = NaN;             // zoals ingesteld
    this.geldig = Infinity;      // vanaf hier (audioklok) is de uitvoer de muziek
    this.loopt = false;          // in het vorige blok gerekend (anders: eerst leeg)
    this.zoeken = 0;             // hoe vaak er gezocht is (tests, metingen)
  }

  /** Voor 2, 4 of 8 kanalen (stereo of stems). Alles opnieuw; bij hetzelfde aantal niets. */
  configureer(kanalen) {
    if (kanalen === this.kanalen) return;
    const M = this.M, sr = this.sr;
    M._configure(kanalen, Math.round(REK.blokMs / 1000 * sr), Math.round(REK.intervalMs / 1000 * sr), REK.gespreid);
    M._reset();
    this.inLat = M._inputLatency();
    this.uitLat = M._outputLatency();
    this.interval = M._intervalSamples();
    this.lengte = Math.max(MIN_BUFFER, this.inLat + this.uitLat + 4 * BLOK);
    this.ptr = M._setBuffers(kanalen, this.lengte);
    this.kanalen = kanalen;
    this._views();
    this.stil();
  }

  /** Zo lang (s) na het blok waarin hij zoekt, klinkt de nieuwe plek: de uitvoerlatentie. */
  get vooruit() { return this.uitLat / this.sr; }

  _views() {
    const buf = this.M.HEAP8.buffer;
    this._buf = buf;
    this.in = []; this.uit = [];
    for (let c = 0; c < this.kanalen; c++) {
      this.in.push(new Float32Array(buf, this.ptr + this.lengte * 4 * c, this.lengte));
      this.uit.push(new Float32Array(buf, this.ptr + this.lengte * 4 * (c + this.kanalen), this.lengte));
    }
  }

  /** Groeide het WASM-geheugen, dan zijn de oude views leeg: opnieuw maken (zelden). */
  _check() { if (this.M.HEAP8.buffer !== this._buf) this._views(); }

  /** Niets meer te doen (pauze, terug naar renderBlok): de volgende keer begint hij leeg. */
  stil() {
    this.loopt = false;
    this.eind = NaN;
    this.lees = null;
    this.vorig = null;
    this.geldig = Infinity;
  }

  /**
   * Een nieuw (spelend) segment. Gepland met T in de toekomst: tot T speelt
   * wat er speelde (vorig; komt er nog een geplande overheen, dan blijft het
   * vorig van de eerste: dat is wat je hoort). Anders meteen: begint het waar
   * het oude nu is (tempo, toon, loop), dan loopt de invoer door met een
   * verschoven telling; anders zoekt het volgende blok.
   */
  zet(seg, gepland, nu, trackRate) {
    if (gepland && seg.T > nu) {
      if (!(this.seg && this.seg.T > nu)) this.vorig = this.seg;
      this.seg = seg;
      return;
    }
    const oud = this.lees;
    this.seg = seg;
    this.vorig = null;
    if (!oud || !(this.eind === this.eind) || !oud.speelt || !seg.speelt) return;
    // Waar het oude segment nu is (gevouwen in zijn loop) tegen waar het nieuwe begint.
    let p = oud.P + (seg.T - oud.T) * oud.R;
    const ongevouwen = p;
    const l = oud.loop;
    if (l && l.end > l.start && p >= l.end) p = l.start + ((p - l.start) % (l.end - l.start));
    if (Math.abs(p - seg.P) > 0.001) return;                 // een sprong: zoeken
    this.eind += Math.round(seg.P * trackRate) - Math.round(ongevouwen * trackRate);
    this.lees = seg;
  }

  /**
   * Eén blok. `b` = { paginas, frames, t0, trackRate, totaal, stride }, één
   * object per deck dat elk blok wordt bijgewerkt (geen afval). De uitvoer
   * staat daarna in uit[c][0..frames). False: er was niets te doen (het
   * segment speelt niet), de uitvoer is dan niet bijgewerkt.
   */
  blok(b) {
    const M = this.M, sr = this.sr, frames = b.frames, tr = b.trackRate;
    // Doorlopen: de invoer loopt tot de positie op t0 + uitLat + één blok.
    // Zoeken: de nieuwe plek klinkt al één blok eerder (gemeten: met tZoek =
    // tDoel kwam de eerste klik na een sprong 128 frames te vroeg, de klikken
    // erna weer exact), dus doel op t0 + uitLat, en pas zoeken als DAT moment
    // het nieuwe segment is.
    const tZoek = b.t0 + this.uitLat / sr;
    const tDoel = tZoek + frames / sr;
    const seg = this.seg;
    if (seg === null) return false;
    const s = this.vorig !== null && tZoek < seg.T ? this.vorig : seg;
    if (!s.speelt) { this.stil(); return false; }
    if (s !== this.lees) { this.lees = s; this.eind = NaN; }
    const doel = Math.round((s.P + (tDoel - s.T) * s.R) * tr) + this.inLat;
    const rate = s.R * tr / sr;
    const n = doel - this.eind;                              // NaN als hij moet zoeken
    const zoek = !(n >= -this.interval && n <= frames * rate + this.interval);
    if (zoek && !this.loopt) {
      // Een stretcher die stillag: eerst leeg (anders klinkt er een rest van
      // vóór de pauze), en zijn uitvoer telt pas na zijn latentie.
      M._reset();
      this.toon = NaN;
      this.geldig = tZoek;
    }
    const rek = s.rek;
    const toon = (rek.keylock ? 0 : 12 * Math.log2(s.R)) + rek.toon + 12 * Math.log2(tr / sr);
    if (toon !== this.toon) { M._setTransposeSemitones(toon, TONALITEIT_HZ / sr); this.toon = toon; }
    if (zoek) {
      const len = this.inLat + this.uitLat;
      const doelZoek = Math.round((s.P + (tZoek - s.T) * s.R) * tr) + this.inLat;
      leesInvoer(s, b.paginas, doelZoek - len, len, this.in, b.stride, tr, b.totaal);
      M._seek(len, rate);
      this._check();
      M._process(0, frames);
      this.zoeken++;
      this.eind = doelZoek;
    } else if (n > 0) {
      leesInvoer(s, b.paginas, this.eind, n, this.in, b.stride, tr, b.totaal);
      M._process(n, frames);
      this.eind = doel;
    } else {
      M._process(0, frames);                                // wachten: de invoer ligt al voor
    }
    this._check();
    this.loopt = true;
    return true;
  }
}
