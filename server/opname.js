/**
 * Opnames van je set: een WAV-bestand dat groeit terwijl je speelt.
 *
 * De browser stuurt elke seconde een stuk (16-bit PCM, stereo, 48 kHz) met
 * de frame-positie erbij, en dat wordt meteen op DIE plek in het bestand
 * gezet. Crasht de browser na een uur, dan ben je hooguit de laatste seconde
 * kwijt — niet je hele set.
 *
 * Op de plek schrijven, niet achter het bestand plakken: dan is een stuk
 * idempotent. Een stuk dat twee keer komt (antwoord kwijt, opnieuw
 * geprobeerd) of half geschreven was, komt op precies dezelfde bytes terecht.
 * Een stuk dat helemaal wegvalt laat een gat, en een gat is stilte (nullen):
 * alles erna blijft op zijn tijd, dus gelijk met de video.
 *
 * De kop van een WAV-bestand zegt hoe lang de data is. Die lengte weten we pas
 * aan het eind, dus eerst een kop met 0 en bij het afsluiten de echte lengte
 * erin schrijven. Is er nooit afgesloten (crash), dan herstelt `sluit()` bij
 * de volgende keer opstarten de kop uit de bestandsgrootte.
 *
 * Langer dan ~6,2 uur past de lengte niet meer in de 32 bits van een WAV-kop.
 * Daarom begint elke kop met een JUNK-chunk van 28 bytes (80 bytes kop in
 * totaal): wordt de opname te lang, dan wordt RIFF "RF64" en JUNK "ds64" met
 * de lengtes in 64 bits (EBU Tech 3306), zonder de data te verschuiven.
 * ffmpeg, Audacity, Reaper en de meeste DAW's lezen RF64. Oude opnames met een
 * kop van 44 bytes kunnen dat niet; die worden geklemd (0xFFFFFFFC) en krijgen
 * een waarschuwing mee.
 *
 * Gooit nooit naar de aanroeper met een halve toestand: elke functie geeft een
 * resultaat terug, zoals ingest.js.
 */
import { open, mkdir, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SR = 48000, KANALEN = 2, BITS = 16;
const FRAME = KANALEN * BITS / 8;          // 4 bytes: één sample links, één rechts
const KOP = 80;                            // RIFF + JUNK/ds64 + fmt + data-kop
const KOP_OUD = 44;                        // opnames van vóór RF64
const MAX32 = 0xFFFFFFFF;
/** Verder vooruit dan dit is geen gat meer maar onzin: een dag. */
const MAX_SPRONG = SR * 3600 * 24;

function fmtChunk(b, o) {
  b.write('fmt ', o); b.writeUInt32LE(16, o + 4); b.writeUInt16LE(1, o + 8); b.writeUInt16LE(KANALEN, o + 10);
  b.writeUInt32LE(SR, o + 12); b.writeUInt32LE(SR * FRAME, o + 16);
  b.writeUInt16LE(FRAME, o + 20); b.writeUInt16LE(BITS, o + 22);
}

/**
 * De 80 bytes kop voor `dataBytes` aan samples. Past het in 32 bits, dan een
 * gewone WAV met een JUNK-chunk; anders RF64 met een ds64-chunk op die plek.
 */
export function wavKop(dataBytes) {
  const b = Buffer.alloc(KOP);
  const riff = KOP - 8 + dataBytes;
  const groot = riff > MAX32;
  b.write(groot ? 'RF64' : 'RIFF', 0); b.writeUInt32LE(groot ? MAX32 : riff, 4); b.write('WAVE', 8);
  b.write(groot ? 'ds64' : 'JUNK', 12); b.writeUInt32LE(28, 16);
  if (groot) {
    b.writeBigUInt64LE(BigInt(riff), 20);
    b.writeBigUInt64LE(BigInt(dataBytes), 28);
    b.writeBigUInt64LE(BigInt(dataBytes / FRAME), 36);
    // 44..47: tabellengte 0
  }
  fmtChunk(b, 48);
  b.write('data', 72); b.writeUInt32LE(groot ? MAX32 : dataBytes, 76);
  return b;
}

/** De oude kop van 44 bytes, voor opnames van vóór RF64. Lengtes geklemd op 32 bits. */
export function wavKop44(dataBytes) {
  const b = Buffer.alloc(KOP_OUD);
  const data = Math.min(dataBytes, MAX32 - 3);           // 0xFFFFFFFC: nog steeds hele frames
  b.write('RIFF', 0); b.writeUInt32LE(Math.min(36 + dataBytes, MAX32), 4); b.write('WAVE', 8);
  fmtChunk(b, 12);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

/** Hoe lang de kop van dit bestand is (44 of 80), of 0 als het geen kop van ons is. */
export function kopVan(begin) {
  if (begin.length < 16) return 0;
  const soort = begin.toString('ascii', 12, 16);
  if (soort === 'fmt ') return KOP_OUD;
  if (soort === 'JUNK' || soort === 'ds64') return KOP;
  return 0;
}

async function leesKop(f) {
  const b = Buffer.alloc(16);
  const { bytesRead } = await f.read(b, 0, 16, 0);
  return kopVan(b.subarray(0, bytesRead));
}

/** Schrijf alles, ook als het OS maar een deel per keer neemt. */
async function schrijfAlles(f, buf, pos) {
  let klaar = 0;
  while (klaar < buf.length) {
    const { bytesWritten } = await f.write(buf, klaar, buf.length - klaar, pos + klaar);
    if (!bytesWritten) throw new Error(`maar ${klaar} van ${buf.length} bytes geschreven`);
    klaar += bytesWritten;
  }
}

/** Een opname-id: datum-tijd, eventueel met volgnummer. Ook het id van een handelingenlog. */
export const ID = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?$/;
const naamVan = (id) => `set-${id}.wav`;
/** Het handelingenlog naast een opname (server/handelingen.js). */
export const LOG_EXT = '.acties.jsonl';

/** Een id op de tijd van nu: set-20260923-213012.wav sorteert vanzelf goed. */
export function nieuwId(nu = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${nu.getFullYear()}${p(nu.getMonth() + 1)}${p(nu.getDate())}-${p(nu.getHours())}${p(nu.getMinutes())}${p(nu.getSeconds())}`;
}

const bestaat = (pad) => stat(pad).then(() => true, () => false);

export async function start(map, { nu } = {}) {
  await mkdir(map, { recursive: true });
  let id = nieuwId(nu), n = 1;
  // Twee opnames in dezelfde seconde: niet over elkaar heen. Ook niet op het
  // id van een los handelingenlog uit dezelfde seconde: het log van DEZE
  // opname krijgt straks dat id, en schreef dan in het andere log.
  const bezet = async (x) => (await bestaat(join(map, naamVan(x)))) || bestaat(join(map, `set-${x}${LOG_EXT}`));
  while (await bezet(id)) id = `${nieuwId(nu)}-${++n}`;
  const f = await open(join(map, naamVan(id)), 'wx');
  await f.write(wavKop(0), 0, KOP, 0);
  await f.close();
  return { ok: true, id, bestand: naamVan(id) };
}

/**
 * Een stuk audio op frame `frame` (vanaf het begin van de opname). Zonder
 * frame: achter het laatste hele frame (clients van vóór de frame-positie).
 */
export async function voegToe(map, id, stuk, frame) {
  if (!ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
  if (stuk.length % FRAME) return { ok: false, fout: 'stuk is geen heel aantal frames' };
  if (frame !== undefined && !(Number.isSafeInteger(frame) && frame >= 0)) return { ok: false, fout: 'frame moet een heel getal >= 0 zijn' };
  let f;
  try {
    f = await open(join(map, naamVan(id)), 'r+');
    const kop = await leesKop(f);
    if (!kop) return { ok: false, fout: 'geen opname-kop in het bestand' };
    const data = Math.max(0, (await f.stat()).size - kop);
    const nu = Math.floor(data / FRAME);                  // hele frames die er al staan
    if (frame === undefined) frame = nu;
    if (frame > nu + MAX_SPRONG) return { ok: false, fout: `frame ${frame} ligt meer dan een dag voorbij het eind` };
    // Op de plek: een herhaling overschrijft dezelfde bytes, een gat ervoor
    // wordt door het bestandssysteem met nullen gevuld (stilte).
    await schrijfAlles(f, stuk, kop + frame * FRAME);
    return { ok: true };
  } catch (err) {
    if (err.code === 'ENOSPC') return { ok: false, fout: 'de schijf is vol', vol: true };
    return { ok: false, fout: err.code === 'ENOENT' ? 'opname bestaat niet' : err.message };
  } finally {
    await f?.close();
  }
}

/**
 * Het videobestand bij een opname: set-<id>.mp4 of .webm, naast de WAV.
 * MediaRecorder levert losse stukken die achter elkaar een geldig bestand
 * vormen; hier alleen achter elkaar plakken. Alleen deze twee extensies:
 * de browser mag niet bepalen wat voor bestand hier ontstaat.
 *
 * Met `van` (bytes vanaf het begin, `?van=N`, sinds 15 okt): op DIE plek, zoals
 * een audiostuk op zijn frame. Dan is herhalen na een verloren antwoord veilig
 * (de browser herhaalt zolang de server even weg is, src/opname/opnemer.js).
 * Zonder: erachter, zoals vroeger.
 */
export const VIDEO_EXT = ['mp4', 'webm'];
/** Zo ver mag een videostuk voorbij het eind liggen (er viel er een weg): ruim 10 min op 8 Mbit/s. */
const VIDEO_MAX_SPRONG = 1024 * 1024 * 1024;

export async function voegVideoToe(map, id, ext, stuk, van) {
  if (!ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
  if (!VIDEO_EXT.includes(ext)) return { ok: false, fout: `videoformaat "${ext}" niet toegestaan` };
  if (van !== undefined && !(Number.isSafeInteger(van) && van >= 0)) return { ok: false, fout: 'van moet een heel getal >= 0 zijn' };
  // Alleen bij een opname die echt bestaat: geen losse videobestanden maken.
  if (!(await stat(join(map, naamVan(id))).then(() => true, () => false))) return { ok: false, fout: 'opname bestaat niet' };
  let f;
  const pad = join(map, `set-${id}.${ext}`);
  try {
    if (van === undefined) {
      f = await open(pad, 'a');
      await f.write(stuk);
      return { ok: true };
    }
    // 'a' schrijft altijd achteraan (O_APPEND), dus op een plek: 'r+', en de eerste keer 'w'.
    f = await open(pad, 'r+').catch((err) => (err.code === 'ENOENT' ? open(pad, 'wx').catch(() => open(pad, 'r+')) : Promise.reject(err)));
    const { size } = await f.stat();
    if (van > size + VIDEO_MAX_SPRONG) return { ok: false, fout: `van ${van} ligt te ver voorbij het eind` };
    await schrijfAlles(f, stuk, van);
    return { ok: true };
  } catch (err) {
    if (err.code === 'ENOSPC') return { ok: false, fout: 'de schijf is vol', vol: true };
    return { ok: false, fout: err.message };
  } finally {
    await f?.close();
  }
}

/** Welke video hoort bij deze opname, als die er is. */
async function videoVan(map, id) {
  for (const ext of VIDEO_EXT) {
    const naam = `set-${id}.${ext}`;
    const info = await stat(join(map, naam)).catch(() => null);
    if (info) return { video: naam, videoBytes: info.size };
  }
  return {};
}

/**
 * De kop gelijk trekken met wat er echt in het bestand staat: alleen hele
 * frames. Met `frames` (bij "klaar", van de browser geteld): is het bestand
 * korter, dan was het laatste stuk kwijt en wordt de staart stilte, zodat de
 * WAV even lang is als de opname — en als de video.
 */
export async function sluit(map, id, { frames } = {}) {
  if (!ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
  if (frames !== undefined && !(Number.isSafeInteger(frames) && frames >= 0)) return { ok: false, fout: 'frames moet een heel getal >= 0 zijn' };
  let f;
  try {
    f = await open(join(map, naamVan(id)), 'r+');
    const kop = await leesKop(f);
    if (!kop) return { ok: false, fout: 'geen opname-kop in het bestand' };
    let { size } = await f.stat();
    if (frames !== undefined && size < kop + frames * FRAME) { await f.truncate(kop + frames * FRAME); size = kop + frames * FRAME; }
    let data = Math.max(0, size - kop);
    data -= data % FRAME;                                   // een half frame achteraan telt niet mee
    let waarschuwing;
    if (kop === KOP) {
      await f.write(wavKop(data), 0, KOP, 0);
      if (KOP - 8 + data > MAX32) waarschuwing = 'langer dan 6,2 uur: bewaard als RF64 (ffmpeg, Audacity en DAW\'s lezen dat; sommige spelers niet)';
    } else {
      await f.write(wavKop44(data), 0, KOP_OUD, 0);
      if (36 + data > MAX32) waarschuwing = 'langer dan 6,2 uur in een oude WAV-kop: de lengte is geklemd op 4 GB; lees verder met ffmpeg -ignore_length 1';
    }
    return {
      ok: true, id, bestand: naamVan(id), bytes: size, duur: data / (SR * FRAME),
      ...(waarschuwing ? { waarschuwing } : {}), ...(await videoVan(map, id)),
    };
  } catch (err) {
    return { ok: false, fout: err.code === 'ENOENT' ? 'opname bestaat niet' : err.message };
  } finally {
    await f?.close();
  }
}

/** Alle opnames, nieuwste eerst. Bij het opstarten: koppen van gecrashte opnames herstellen. */
export async function lijst(map) {
  const namen = await readdir(map).catch(() => []);
  const uit = [];
  // Op tijd en volgnummer, niet als tekst: "-2.wav" komt als tekst vóór ".wav".
  const sleutel = (id) => { const [d, t, n = '1'] = id.split('-'); return [`${d}${t}`, Number(n)]; };
  const ids = namen.filter((n) => /^set-.*\.wav$/.test(n)).map((n) => n.slice(4, -4)).filter((id) => ID.test(id))
    .sort((a, b) => { const [ta, na] = sleutel(a), [tb, nb] = sleutel(b); return ta === tb ? nb - na : (ta < tb ? 1 : -1); });
  for (const id of ids) {
    const r = await sluit(map, id);
    if (r.ok) uit.push(r);
  }
  return uit;
}
