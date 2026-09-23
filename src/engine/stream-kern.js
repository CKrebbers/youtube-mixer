/**
 * De rekenkern van het streamen. Geen Web Audio, geen fetch, geen DOM: puur
 * rekenwerk, zodat hij in Node te testen is en de hoofdthread en de worklet
 * EXACT dezelfde code draaien.
 *
 * Dat laatste is het hele punt. De hoofdthread moet weten waar het deck is
 * (golfvorm, beatgrid, effecten op de tel) en de worklet moet weten welke
 * sample hij nu speelt. Twee tellers lopen uit elkaar; twee keer dezelfde
 * formule op dezelfde audioklok niet. Regel 3, maar dan over een draadgrens.
 *
 * Het segment:
 *   { T, P, R, loop, speelt }
 *   "vanaf audiokloktijd T staat de positie op P en loopt hij met snelheid R"
 *
 * Elke wijziging (play, seek, pitch, loop) is een nieuw segment. Komt het
 * bericht een paar milliseconden te laat bij de worklet aan, dan rekent hij
 * de formule gewoon vanaf T door en zit hij meteen op de goede plek.
 */

export const PAGINA = 65536;           // frames per pagina, ~1,37 s op 48 kHz
export const KANALEN = 2;
export const BYTES_PER_FRAME = 4;      // 16 bit stereo
export const PAGINA_BYTES = PAGINA * BYTES_PER_FRAME;

export const STIL = Object.freeze({ T: 0, P: 0, R: 1, loop: null, speelt: false });

/** Positie in tracktijd (seconden) op audiokloktijd t. */
export function positieOp(seg, t) {
  if (!seg.speelt) return seg.P;
  let p = seg.P + (t - seg.T) * seg.R;
  const loop = seg.loop;
  if (loop) {
    const len = loop.end - loop.start;
    if (len > 0 && p >= loop.end) p = loop.start + ((p - loop.start) % len);
  }
  return p;
}

/** Wanneer passeert dit segment tracktijd x, op de audioklok? */
export function ctxTijdVan(seg, x) {
  if (!seg.speelt) return null;
  return seg.T + (x - seg.P) / seg.R;
}

// ---- WAV ------------------------------------------------------------------

/**
 * Leest de kop van een WAV-bestand en zoekt waar de samples beginnen.
 *
 * Niet uitgaan van 44 bytes: ffmpeg zet er een LIST-chunk met metadata voor,
 * en dan zou je de eerste milliseconden als ruis afspelen en alles daarna een
 * paar samples verschoven.
 */
export function leesWavKop(buf) {
  const v = new DataView(buf);
  const tekst = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 12 || tekst(0) !== 'RIFF' || tekst(8) !== 'WAVE') throw new Error('geen WAV-bestand');
  let o = 12, fmt = null;
  while (o + 8 <= buf.byteLength) {
    const id = tekst(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = {
        formaat: v.getUint16(o + 8, true),
        kanalen: v.getUint16(o + 10, true),
        sampleRate: v.getUint32(o + 12, true),
        bits: v.getUint16(o + 22, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV: data vóór fmt');
      return { ...fmt, dataStart: o + 8, dataLengte: len };
    }
    o += 8 + len + (len & 1);          // chunks zijn op even bytes uitgelijnd
  }
  throw new Error('WAV: geen data-chunk in de eerste kilobytes');
}

/** Alleen wat de worklet kan lezen. Liever nu een duidelijke fout dan straks ruis. */
export function controleerWav(kop) {
  if (kop.formaat !== 1 && kop.formaat !== 0xfffe) return `WAV-formaat ${kop.formaat} wordt niet ondersteund (alleen PCM)`;
  if (kop.bits !== 16) return `${kop.bits}-bit WAV wordt niet ondersteund (alleen 16-bit)`;
  if (kop.kanalen !== 2) return `${kop.kanalen} kanalen wordt niet ondersteund (alleen stereo)`;
  return null;
}

// ---- welke pagina's --------------------------------------------------------

export const paginaVan = (sec, sr) => Math.floor((sec * sr) / PAGINA);

/**
 * Welke pagina's moeten er zijn, belangrijkste eerst?
 *
 * Vooruit ruim, achteruit een beetje (nudge, korte scratch), plus vastgepinde
 * pagina's rond hotcues, cuepunt en loop: daar spring je naartoe zonder
 * waarschuwing, en dan mag er geen gat vallen.
 */
export function plan({ positie, rate = 1, duur, sr, vastpunten = [], loop = null,
  vooruit = 20, achteruit = 5, rondPunt = 3 }) {
  const laatste = Math.max(0, Math.ceil((duur * sr) / PAGINA) - 1);
  const lijst = [];
  const gezien = new Set();
  const voeg = (a, b) => {
    const p0 = Math.max(0, paginaVan(a, sr)), p1 = Math.min(laatste, paginaVan(b, sr));
    for (let p = p0; p <= p1; p++) if (!gezien.has(p)) { gezien.add(p); lijst.push(p); }
  };
  const r = Math.max(0.5, Math.abs(rate));
  voeg(positie, positie + 2 * r);                          // wat nu klinkt
  if (loop) voeg(loop.start - 0.05, loop.end);              // een loop moet heel zijn, plus zijn naad
  voeg(positie, positie + vooruit * r);
  for (const t of vastpunten) if (t !== null && t !== undefined && t >= 0) voeg(t, t + rondPunt);
  voeg(positie - achteruit, positie);
  return lijst;
}

/** Aaneengesloten pagina's samenvoegen tot één verzoek, hooguit `max` lang. */
export function reeksen(paginas, max = 8) {
  const s = [...paginas].sort((a, b) => a - b);
  const uit = [];
  for (const p of s) {
    const laatste = uit[uit.length - 1];
    if (laatste && p === laatste.tot + 1 && laatste.tot - laatste.van + 1 < max) laatste.tot = p;
    else uit.push({ van: p, tot: p });
  }
  return uit;
}

// ---- samples lezen ---------------------------------------------------------

/**
 * Eén sample uit de pagina's, of 0 als die pagina er (nog) niet is. Stilte is
 * het eerlijke antwoord op een gat; de vorige pagina herhalen klinkt als een
 * haperende cd.
 */
function sample(paginas, n, k) {
  if (n < 0) return 0;
  const p = paginas.get(Math.floor(n / PAGINA));
  if (!p) return 0;
  const i = (n % PAGINA) * KANALEN + k;
  return i < p.length ? p[i] * (1 / 32768) : 0;
}

/** Eén kanaal op een fractionele framepositie: exact op een heel frame, anders cubisch. */
function lees(paginas, f, k) {
  const n = Math.floor(f);
  const x = f - n;
  // Afrondruis van de klokrekening: 12,9999999 is gewoon sample 13.
  if (x < 1e-7) return sample(paginas, n, k);
  if (x > 1 - 1e-7) return sample(paginas, n + 1, k);
  const y0 = sample(paginas, n - 1, k), y1 = sample(paginas, n, k);
  const y2 = sample(paginas, n + 1, k), y3 = sample(paginas, n + 2, k);
  return y1 + 0.5 * x * (y2 - y0 + x * (2 * y0 - 5 * y1 + 4 * y2 - y3 + x * (3 * (y1 - y2) + y3 - y0)));
}

/**
 * Hoe lang de naad van een loop wordt overgevloeid, in seconden.
 *
 * Springt een loop van zijn einde terug naar zijn begin, dan liggen die twee
 * samples bijna nooit op dezelfde hoogte: een sprong in de golfvorm, en die
 * hoor je als een tik. In de laatste 5 ms vóór het einde mengen we daarom
 * over naar wat er vlak vóór het BEGIN staat; op het moment van terugspringen
 * sluit het dan naadloos aan. Te kort om als fade te horen.
 */
export const LOOP_NAAD = 0.005;

/**
 * Een blok audio renderen. Dit is wat de worklet per 128 frames aanroept.
 *
 * Bij rate 1 en een geheel startpunt komt het exacte sample eruit: de
 * interpolatie valt dan weg (frac = 0). Anders cubisch (Catmull-Rom): lineair
 * dempt de hoge tonen hoorbaar bij een paar procent pitch, en ambient is hoog.
 * Alleen in de laatste LOOP_NAAD van een loop wordt er gemengd.
 *
 * @returns 'einde' als het trackeinde binnen dit blok viel, anders null.
 */
export function renderBlok({ seg, paginas, uit, frames, t0, ctxRate, trackRate, duur }) {
  const [L, R] = uit;
  if (!seg.speelt) { L.fill(0, 0, frames); R.fill(0, 0, frames); return null; }
  const loop = seg.loop;
  // Een heel korte loop krijgt een kortere naad, anders is hij alleen nog naad.
  const naad = loop ? Math.min(LOOP_NAAD, (loop.end - loop.start) / 4) : 0;
  let einde = null;
  for (let i = 0; i < frames; i++) {
    const p = positieOp(seg, t0 + i / ctxRate);
    if (!loop && p >= duur) {
      L.fill(0, i, frames); R.fill(0, i, frames);
      einde = 'einde';
      break;
    }
    const f = p * trackRate;
    const rest = loop ? loop.end - p : Infinity;
    if (rest < naad && rest > 0) {
      // Equal-power: de twee stukken zijn niet gelijk, dus een lineaire fade
      // zou in het midden een dipje geven.
      const w = 1 - rest / naad;
      const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
      const g = (loop.start - rest) * trackRate;
      L[i] = lees(paginas, f, 0) * a + lees(paginas, g, 0) * b;
      R[i] = lees(paginas, f, 1) * a + lees(paginas, g, 1) * b;
    } else {
      L[i] = lees(paginas, f, 0);
      R[i] = lees(paginas, f, 1);
    }
  }
  return einde;
}
