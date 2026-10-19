/**
 * Waar nummers vandaan komen: de v1-library via de server, en demonummers die
 * de app zelf maakt (zodat er zonder library iets te mixen en te toetsen valt).
 * Alles komt als Int16-pagina's in het formaat van de speler, plus een
 * overzicht (piekwaarden) voor het scherm.
 */

export const PAGINA = 65536;   // frames per pagina, gelijk aan de speler-kern

/** WAV (16-bit PCM, stereo of mono) -> pagina's. */
export function wavNaarPcm(buf) {
  const v = new DataView(buf);
  const tekst = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tekst(0) !== 'RIFF' || tekst(8) !== 'WAVE') throw new Error('geen WAV-bestand');
  let o = 12, fmt = null;
  while (o + 8 <= buf.byteLength) {
    const id = tekst(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { formaat: v.getUint16(o + 8, true), kanalen: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    else if (id === 'data') {
      if (!fmt) throw new Error('WAV: data vóór fmt');
      if (fmt.bits !== 16 || (fmt.formaat !== 1 && fmt.formaat !== 0xfffe)) throw new Error(`WAV: alleen 16-bit PCM (dit is ${fmt.bits}-bit)`);
      const kanalen = fmt.kanalen;
      const lengte = Math.min(len === 0xffffffff ? buf.byteLength - o - 8 : len, buf.byteLength - o - 8);
      const frames = Math.floor(lengte / (2 * kanalen));
      const bron = new Int16Array(buf, o + 8, frames * kanalen);
      return { sr: fmt.sr, kanalen: 2, frames, paginas: naarPaginas(bron, kanalen, frames) };
    }
    o += 8 + len + (len & 1);
  }
  throw new Error('WAV: geen data-chunk');
}

/** Interleaved Int16 met k kanalen -> stereo-pagina's van PAGINA frames (eigen buffers, dus over te dragen). */
function naarPaginas(bron, k, frames) {
  const paginas = [];
  for (let p = 0; p * PAGINA < frames; p++) {
    const n = Math.min(PAGINA, frames - p * PAGINA);
    const uit = new Int16Array(PAGINA * 2);
    for (let i = 0; i < n; i++) {
      const j = (p * PAGINA + i) * k;
      uit[i * 2] = bron[j];
      uit[i * 2 + 1] = k > 1 ? bron[j + 1] : bron[j];
    }
    paginas.push(uit);
  }
  return paginas;
}

/** Piekwaarden (0..1) in `n` vakjes, voor het overzicht. Vóór het overdragen van de pagina's. */
export function overzicht(pcm, n = 400) {
  const uit = new Float32Array(n);
  const perVak = pcm.frames / n;
  const stap = Math.max(1, Math.floor(perVak / 64));
  for (let b = 0; b < n; b++) {
    let m = 0;
    for (let f = Math.floor(b * perVak); f < Math.floor((b + 1) * perVak); f += stap) {
      const p = pcm.paginas[Math.floor(f / PAGINA)];
      if (!p) continue;
      const i = (f % PAGINA) * 2;
      const a = Math.abs(p[i]) + Math.abs(p[i + 1]);
      if (a > m) m = a;
    }
    uit[b] = Math.min(1, m / 65536);
  }
  return uit;
}

// ---- demonummers ---------------------------------------------------------------

/** Een eenvoudige deterministische ruis (geen Math.random: elke keer hetzelfde nummer). */
function ruis(zaad) { let s = zaad >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; }; }

/**
 * Een demonummer: kick op elke tel (de "1" harder en met een klap erbij op 2 en 4),
 * hihat op de achtsten, een baslijn per maat. Optioneel een tempowissel halverwege
 * of helemaal geen tel (een pad).
 */
export function maakDemo({ id, titel, bpm = 124, duur = 120, anker = 0.5, wissel = null, pad = false, toon = 55, sr = 48000 }) {
  const frames = Math.round(duur * sr);
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const r = ruis(id.length * 7919 + bpm);
  const stukken = [{ van: 0, bpm, anker, maat: anker }];
  if (wissel) {
    const b2 = wissel.bpm, t2 = wissel.van;
    const eerste = anker + Math.ceil((t2 - anker) / (60 / bpm)) * (60 / bpm);
    stukken.push({ van: t2, bpm: b2, anker: eerste, maat: eerste });
  }
  if (pad) {
    // Een akkoord dat langzaam ademt: geen tel om op te syncen.
    for (let i = 0; i < frames; i++) {
      const t = i / sr, adem = 0.5 + 0.5 * Math.sin(t * 0.21);
      const s = (Math.sin(2 * Math.PI * toon * 2 * t) + Math.sin(2 * Math.PI * toon * 3 * t) * 0.6 + Math.sin(2 * Math.PI * toon * 4.02 * t) * 0.4) * 0.12 * adem;
      L[i] = s; R[i] = s * 0.92 + Math.sin(2 * Math.PI * toon * 5.03 * t) * 0.02;
    }
    return demoUit({ id, titel, duur, sr, L, R, grid: null });
  }
  // Tellen aflopen.
  const tellen = [];
  for (const [i, s] of stukken.entries()) {
    const eind = stukken[i + 1]?.van ?? duur;
    const Ls = 60 / s.bpm;
    for (let t = s.anker, k = 0; t < eind; t += Ls, k++) if (t >= (i ? s.van : 0)) tellen.push({ t, k, L: Ls });
  }
  const zet = (start, lengte, fn) => {
    const a = Math.floor(start * sr), b = Math.min(frames, a + Math.floor(lengte * sr));
    for (let i = Math.max(0, a); i < b; i++) { const [l, rr] = fn((i - a) / sr); L[i] += l; R[i] += rr; }
  };
  const bas = [1, 1, 1.5, 1.33];
  for (const { t, k, L: Lt } of tellen) {
    const een = k % 4 === 0;
    zet(t, 0.35, (x) => { const f = 50 + 120 * Math.exp(-x * 30); const s = Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 9) * (een ? 0.9 : 0.7); return [s, s]; });
    if (k % 4 === 1 || k % 4 === 3) zet(t, 0.18, (x) => { const s = r() * Math.exp(-x * 28) * 0.28; return [s, s * 0.9]; });
    for (const h of [0, 0.5]) zet(t + h * Lt, 0.05, (x) => { const s = r() * Math.exp(-x * 120) * 0.1; return [s * 0.7, s]; });
    const f = toon * bas[Math.floor(k / 4) % 4];
    zet(t + Lt * 0.5, Lt * 0.45, (x) => { const s = Math.sin(2 * Math.PI * f * x) * Math.min(1, x * 200) * Math.exp(-x * 4) * 0.22; return [s, s]; });
  }
  return demoUit({ id, titel, duur, sr, L, R, grid: { stukken, beatsPerBar: 4, slot: true } });
}

function demoUit({ id, titel, duur, sr, L, R, grid }) {
  const frames = L.length;
  const bron = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    bron[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    bron[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  return { id, titel, artiest: 'demo', duur, grid, demo: true, maakPcm: () => ({ sr, kanalen: 2, frames, paginas: naarPaginas(bron, 2, frames) }) };
}

export const DEMOS = [
  { id: 'demo-124', titel: 'Klokwerk 124', bpm: 124, toon: 55 },
  { id: 'demo-128', titel: 'Rechte lijn 128', bpm: 128, anker: 0.31, toon: 49 },
  { id: 'demo-122', titel: 'Laag 122', bpm: 122, anker: 0.12, toon: 41.2 },
  { id: 'demo-wissel', titel: 'Wissel 126 → 132', bpm: 126, anker: 0.2, wissel: { van: 60, bpm: 132 }, toon: 61.7 },
  { id: 'demo-pad', titel: 'Adem (geen tel)', pad: true, duur: 180, toon: 55 },
];
