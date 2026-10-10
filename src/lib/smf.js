/**
 * Standard MIDI File (SMF) als bytes: schrijven en lezen. Puur: geen imports,
 * geen DOM, geen Web MIDI, geen Buffer; alleen Uint8Array en getallen, zodat
 * het in de browser, in de server en in de tests hetzelfde doet.
 *
 * Dit bestand weet niets van patronen: dat vertaalt src/export/patronen-smf.js
 * (buiten de engine, regel 1 in CLAUDE.md). Hier staan alleen de bouwstenen:
 *
 *   vlq(n)            een getal als variable-length quantity (delta's, lengtes)
 *   meta(type, bytes) een meta-event: FF type lengte bytes
 *   ascii(s)          tekst die elk programma leest: diacrieten weg, '→' wordt '->'
 *   tempoMeta(bpm)    FF 51 03 tttttt (microseconden per tel)
 *   maatsoortMeta()   FF 58 04 nn dd 18 08
 *   mtrk(events, eind) één spoor (chunk 'MTrk') uit events met absolute ticks
 *   smf(sporen)       het hele bestand (chunk 'MThd' + de sporen)
 *   leesSmf(bytes)    terug naar events; leest ook running status (Logic, DAW's)
 *
 * We SCHRIJVEN zonder running status (elk kanaalbericht heeft zijn statusbyte):
 * langer, maar elk programma en elk oog leest het, en de tests vergelijken
 * bytes die met de hand na te rekenen zijn. LEZEN kan het wel.
 */

/** Ticks per tel die we schrijven; dezelfde als de patroonklok (venster.js). */
export const SMF_PPQN = 384;

const MAX_VLQ = 0x0fffffff;

/** Een geheel getal 0..0x0FFFFFFF als VLQ: 7 bits per byte, hoogste bit = "er komt meer". */
export function vlq(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_VLQ) throw new RangeError(`vlq: ${n} valt buiten 0..0x0FFFFFFF`);
  const b = [n & 0x7f];
  while ((n >>>= 7) > 0) b.unshift((n & 0x7f) | 0x80);
  return b;
}

/** Een meta-event zonder delta: [0xFF, type, ...vlq(lengte), ...bytes]. */
export function meta(type, bytes = []) {
  return [0xff, type & 0x7f, ...vlq(bytes.length), ...bytes];
}

/**
 * Tekst als ASCII-bytes: NFD, de losse accenttekens weg ('ë' → 'e'),
 * '→' → '->', elk ander teken buiten ASCII → '?'. Een spoornaam met een
 * umlaut staat zo in Logic, Ableton en mido hetzelfde, zonder te raden welke
 * tekenset het bestand bedoelde (het formaat zegt het niet).
 */
export function ascii(s) {
  const t = String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u2192/g, '->');
  const uit = [];
  for (const c of t) { const k = c.codePointAt(0); uit.push(k < 128 ? k : 63); }
  return uit;
}

/** Big-endian, `k` bytes. */
const be = (n, k) => Array.from({ length: k }, (_, i) => (n >>> (8 * (k - 1 - i))) & 255);

/** Tempo als meta-event: microseconden per kwartnoot in drie bytes. 120 bpm → 07 A1 20. */
export function tempoMeta(bpm) {
  const us = Math.round(60e6 / bpm);
  if (!Number.isFinite(us) || us < 1 || us > 0xffffff) throw new RangeError(`tempo ${bpm} bpm past niet in drie bytes`);
  return meta(0x51, be(us, 3));
}

/** Maatsoort als meta-event: teller, log2(noemer), 24 MIDI-klokken per klik, 8 tweeëndertigsten per tel. */
export function maatsoortMeta(teller = 4, noemer = 4) {
  const log2 = Math.log2(noemer);
  if (!Number.isInteger(teller) || teller < 1 || teller > 255 || !Number.isInteger(log2) || log2 < 0) {
    throw new RangeError(`maatsoort ${teller}/${noemer} kan niet`);
  }
  return meta(0x58, [teller, log2, 24, 8]);
}

const chunk = (id, body) => [...ascii(id), ...be(body.length, 4), ...body];

/**
 * Eén spoor. `events`: [{ t: geheel ≥ 0 (absolute tick), orde, b: bytes zonder delta }].
 * Gesorteerd op t, dan orde (stabiel: gelijk op beide = de volgorde waarin ze
 * erin gingen). Daarna FF 2F 00 (einde van het spoor) op max(eind, laatste t).
 * De invoer wordt niet veranderd.
 */
export function mtrk(events, eind = 0) {
  const ev = events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || (a.orde ?? 0) - (b.orde ?? 0) || a.i - b.i);
  const uit = [];
  let vorige = 0;
  for (const e of ev) {
    if (!Number.isInteger(e.t) || e.t < 0) throw new RangeError(`mtrk: tick ${e.t} is geen geheel getal ≥ 0`);
    uit.push(...vlq(e.t - vorige), ...e.b);
    vorige = e.t;
  }
  uit.push(...vlq(Math.max(0, Math.round(eind) - vorige)), ...meta(0x2f));
  return chunk('MTrk', uit);
}

/** Het hele bestand: MThd (type, aantal sporen, ppqn) en de sporen (chunkbytes van mtrk). */
export function smf(sporen, { type = 1, ppqn = SMF_PPQN } = {}) {
  if (![0, 1].includes(type)) throw new RangeError(`smf: type ${type} schrijven we niet`);
  if (type === 0 && sporen.length !== 1) throw new RangeError('smf: type 0 heeft precies één spoor');
  if (!Number.isInteger(ppqn) || ppqn < 1 || ppqn > 0x7fff) throw new RangeError(`smf: ppqn ${ppqn} kan niet`);
  if (sporen.length > 0xffff) throw new RangeError('smf: te veel sporen');
  const kop = chunk('MThd', [...be(type, 2), ...be(sporen.length, 2), ...be(ppqn, 2)]);
  const lengte = kop.length + sporen.reduce((s, x) => s + x.length, 0);
  const uit = new Uint8Array(lengte);
  uit.set(kop, 0);
  let i = kop.length;
  for (const x of sporen) { uit.set(x, i); i += x.length; }
  return uit;
}

/** Aantal databytes na een kanaalstatus: program change en channel pressure één, de rest twee. */
const databytes = (status) => ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2);

/**
 * Een SMF terug naar events. Gooit een Error met de byte-offset als de kop of
 * een spoor niet klopt; een programma dat half leest is erger dan een dat
 * zegt waar het misgaat.
 *
 * @returns {{ type, ppqn, sporen: Array<Array<
 *   { t, meta, data: Uint8Array }            // meta-event (ook FF 2F, het einde)
 *   | { t, st, kanaal, noot, v }              // note-on (st 0x90) / note-off (st 0x80), kanaal 1..16
 *   | { t, overig: number[] }                 // elk ander kanaalbericht, met statusbyte
 * >> }}
 * SysEx (F0/F7) wordt overgeslagen. Onbekende chunks tussen de sporen ook (de
 * standaard zegt: negeren). Running status wordt gelezen; een meta- of
 * SysEx-event heft hem op.
 */
export function leesSmf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fout = (bij, wat) => { throw new Error(`SMF: ${wat} (byte ${bij})`); };
  const id = (i) => String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
  const u32 = (i) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
  const u16 = (i) => (u8[i] << 8) | u8[i + 1];

  if (u8.length < 14 || id(0) !== 'MThd') fout(0, "geen 'MThd'");
  const kopLengte = u32(4);
  if (kopLengte < 6 || 8 + kopLengte > u8.length) fout(4, `kop-lengte ${kopLengte} klopt niet`);
  const type = u16(8), aantal = u16(10), deling = u16(12);
  if (deling & 0x8000) fout(12, 'SMPTE-tijd in plaats van ticks per tel lezen we niet');
  if (deling === 0) fout(12, 'ppqn 0');

  const sporen = [];
  let i = 8 + kopLengte;
  while (sporen.length < aantal) {
    if (i + 8 > u8.length) fout(i, `spoor ${sporen.length + 1} van ${aantal} ontbreekt`);
    const naam = id(i), lengte = u32(i + 4), begin = i + 8, eind = begin + lengte;
    if (eind > u8.length) fout(i + 4, `chunk '${naam}' zegt ${lengte} bytes, er zijn er ${u8.length - begin}`);
    if (naam !== 'MTrk') {
      if (!/^[\x20-\x7e]{4}$/.test(naam)) fout(i, "geen 'MTrk'");
      i = eind;                                    // een onbekende chunk: overslaan
      continue;
    }
    sporen.push(leesSpoor(u8, begin, eind, fout));
    i = eind;
  }
  return { type, ppqn: deling, sporen };
}

function leesSpoor(u8, begin, eind, fout) {
  const ev = [];
  let i = begin, t = 0, lopend = null;
  const byte = () => { if (i >= eind) fout(i, 'spoor houdt midden in een event op'); return u8[i++]; };
  const leesVlq = () => {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const b = byte();
      n = n * 128 + (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    fout(i, 'VLQ langer dan vier bytes');
  };
  const data = () => { const b = byte(); if (b & 0x80) fout(i - 1, `databyte ${b} ≥ 0x80`); return b; };
  while (i < eind) {
    t += leesVlq();
    let status = u8[i];
    if (status === undefined || i >= eind) fout(i, 'spoor houdt op na een delta');
    if (status & 0x80) i++;
    else if (lopend === null) fout(i, 'databyte zonder status (geen running status)');
    else status = lopend;
    if (status === 0xff) {
      lopend = null;
      const type = byte(), n = leesVlq();
      if (i + n > eind) fout(i, `meta ${type} van ${n} bytes past niet in het spoor`);
      ev.push({ t, meta: type, data: u8.slice(i, i + n) });
      i += n;
    } else if (status === 0xf0 || status === 0xf7) {
      lopend = null;
      const n = leesVlq();
      if (i + n > eind) fout(i, `SysEx van ${n} bytes past niet in het spoor`);
      i += n;
    } else if (status >= 0x80 && status <= 0xef) {
      lopend = status;
      const st = status & 0xf0;
      const d = Array.from({ length: databytes(status) }, data);
      if (st === 0x80 || st === 0x90) ev.push({ t, st, kanaal: (status & 0x0f) + 1, noot: d[0], v: d[1] });
      else ev.push({ t, overig: [status, ...d] });
    } else {
      fout(i - 1, `status 0x${status.toString(16)} hoort niet in een bestand`);
    }
  }
  return ev;
}
