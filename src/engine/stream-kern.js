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

/**
 * Wanneer passeert dit segment tracktijd x (voor het eerst na `nu`), op de
 * audioklok? Binnen een loop die al is rondgegaan telt de gevouwen positie:
 * rekenen vanaf P gaf dan een tijd in het verleden, en gate en sampler
 * vielen naast de tel.
 */
export function ctxTijdVan(seg, x, nu = seg.T) {
  if (!seg.speelt) return null;
  const pos = positieOp(seg, nu);
  let t = nu + (x - pos) / seg.R;
  const loop = seg.loop;
  if (loop && x < pos && x >= loop.start && loop.end > loop.start) t += (loop.end - loop.start) / seg.R;
  return t;
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

/**
 * Een WAV in precies het formaat van de ingest (16-bit PCM stereo), uit
 * Float32-kanalen. Voor losse bestanden en de demotrack: die gaan zo door
 * dezelfde streamkern als de library. Mono wordt op beide kanalen gezet.
 * @returns ArrayBuffer met een kop van 44 bytes
 */
export function maakWav(kanalen, sampleRate) {
  const L = kanalen[0], R = kanalen[1] ?? kanalen[0];
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * BYTES_PER_FRAME);
  const v = new DataView(buf);
  const schrijf = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  schrijf(0, 'RIFF'); v.setUint32(4, 36 + n * BYTES_PER_FRAME, true); schrijf(8, 'WAVE');
  schrijf(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * BYTES_PER_FRAME, true); v.setUint16(32, BYTES_PER_FRAME, true); v.setUint16(34, 16, true);
  schrijf(36, 'data'); v.setUint32(40, n * BYTES_PER_FRAME, true);
  const pcm = new Int16Array(buf, 44);
  const naar16 = (x) => { const c = Math.max(-1, Math.min(1, x)); return Math.round(c < 0 ? c * 32768 : c * 32767); };
  for (let i = 0; i < n; i++) { pcm[i * 2] = naar16(L[i]); pcm[i * 2 + 1] = naar16(R[i]); }
  return buf;
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

/** Zo lang vloeien twee segmenten in elkaar over (play, seek, hotcue, stop). */
export const SEGMENT_FADE = 0.004;
/** Zo ver vooruit kijken naar een gat, en zo lang doet het uitvloeien erover. */
export const GAT_FADE = 0.003;

/** Is er data voor frame n en zijn buren (cubisch leest n-1..n+2)? */
function heeftFrame(paginas, n) {
  if (n < 0) return true;                 // vóór het begin is stilte, geen gat
  return paginas.has(Math.floor(n / PAGINA)) && paginas.has(Math.floor((n + 2) / PAGINA));
}

/**
 * Eén frame van één segment: [L, R], of null voorbij het trackeinde.
 * Met de loop-naad: in de laatste LOOP_NAAD van een loop overvloeien naar
 * wat er vlak vóór het begin staat.
 */
function leesSegment(seg, t, paginas, trackRate, duur, naad) {
  const p = positieOp(seg, t);
  const loop = seg.loop;
  if (!loop && p >= duur) return null;
  const f = p * trackRate;
  const rest = loop ? loop.end - p : Infinity;
  if (rest < naad && rest > 0) {
    // Equal-power: de twee stukken zijn niet gelijk, dus een lineaire fade
    // zou in het midden een dipje geven.
    const w = 1 - rest / naad;
    const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
    const g = (loop.start - rest) * trackRate;
    return [lees(paginas, f, 0) * a + lees(paginas, g, 0) * b, lees(paginas, f, 1) * a + lees(paginas, g, 1) * b];
  }
  return [lees(paginas, f, 0), lees(paginas, f, 1)];
}

/*
 * Hooguit een kwart van de loop, en nooit langer dan er vóór het loopbegin
 * staat: een loop die op 0 s begint heeft daar niets, en de naad vloeide dan
 * naar stilte (een dip vlak voor elke herhaling). Liever dan geen naad.
 */
const naadVan = (seg) => (seg?.loop
  ? Math.max(0, Math.min(LOOP_NAAD, (seg.loop.end - seg.loop.start) / 4, seg.loop.start))
  : 0);

/**
 * Een blok audio renderen. Dit is wat de worklet per 128 frames aanroept.
 *
 * Bij rate 1 en een geheel startpunt komt het exacte sample eruit: de
 * interpolatie valt dan weg (frac = 0). Anders cubisch (Catmull-Rom): lineair
 * dempt de hoge tonen hoorbaar bij een paar procent pitch, en ambient is hoog.
 *
 * Drie dingen tegen tikken:
 *   loop-naad   in de laatste LOOP_NAAD van een loop (zie leesSegment)
 *   wissel      `vorig` + `wisselT`: de eerste SEGMENT_FADE na play, seek,
 *               hotcue of stop vloeit het oude segment over in het nieuwe
 *   gat         een pagina die er (nog) niet is: GAT_FADE vooruit kijken en
 *               lineair uitvloeien, na het gat weer in. `staat.env` bewaart
 *               de stand tussen blokken.
 *
 * @returns 'einde' als het trackeinde binnen dit blok viel, anders null.
 */
export function renderBlok({ seg, paginas, uit, frames, t0, ctxRate, trackRate, duur,
  vorig = null, wisselT = -Infinity, staat = { env: 1 } }) {
  const [L, R] = uit;
  const inWissel = vorig && t0 < wisselT + SEGMENT_FADE;
  if (!seg.speelt && !inWissel) { L.fill(0, 0, frames); R.fill(0, 0, frames); return null; }
  const naad = naadVan(seg), naadOud = naadVan(vorig);
  const vooruit = GAT_FADE * trackRate * Math.max(0.5, Math.abs(seg.R || 1));
  const stap = 1 / (GAT_FADE * ctxRate);
  let einde = null;
  for (let i = 0; i < frames; i++) {
    const t = t0 + i / ctxRate;
    let l = 0, r = 0;
    if (seg.speelt) {
      const v = leesSegment(seg, t, paginas, trackRate, duur, naad);
      if (v === null) { einde = 'einde'; }
      else {
        // Gat vooruit? Dan uitvloeien; data er weer? Dan invloeien.
        const n = Math.floor(positieOp(seg, t) * trackRate);
        const doel = heeftFrame(paginas, n) && heeftFrame(paginas, Math.floor(n + vooruit)) ? 1 : 0;
        staat.env = doel > staat.env ? Math.min(1, staat.env + stap) : Math.max(doel, staat.env - stap);
        l = v[0] * staat.env; r = v[1] * staat.env;
      }
    }
    if (vorig && t < wisselT + SEGMENT_FADE) {
      const w = Math.max(0, Math.min(1, (t - wisselT) / SEGMENT_FADE));
      const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
      const o = vorig.speelt ? leesSegment(vorig, t, paginas, trackRate, duur, naadOud) : null;
      l = (o ? o[0] : 0) * a + l * b;
      r = (o ? o[1] : 0) * a + r * b;
    }
    L[i] = l; R[i] = r;
  }
  return einde;
}
