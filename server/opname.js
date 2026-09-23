/**
 * Opnames van je set: een WAV-bestand dat groeit terwijl je speelt.
 *
 * De browser stuurt elke seconde een stuk (16-bit PCM, stereo, 48 kHz) en dat
 * wordt meteen achter het bestand geplakt. Crasht de browser na een uur, dan
 * ben je hooguit de laatste seconde kwijt — niet je hele set.
 *
 * De kop van een WAV-bestand zegt hoe lang de data is. Die lengte weten we pas
 * aan het eind, dus eerst een kop met 0 en bij het afsluiten de echte lengte
 * erin schrijven. Is er nooit afgesloten (crash), dan herstelt `sluit()` bij
 * de volgende keer opstarten de kop uit de bestandsgrootte.
 *
 * Gooit nooit naar de aanroeper met een halve toestand: elke functie geeft een
 * resultaat terug, zoals ingest.js.
 */
import { open, mkdir, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SR = 48000, KANALEN = 2, BITS = 16;
const KOP = 44;

/** De 44 bytes van een PCM-WAV-kop voor `dataBytes` aan samples. */
export function wavKop(dataBytes) {
  const b = Buffer.alloc(KOP);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(KANALEN, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * KANALEN * BITS / 8, 28);
  b.writeUInt16LE(KANALEN * BITS / 8, 32); b.writeUInt16LE(BITS, 34);
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

const ID = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?$/;
const naamVan = (id) => `set-${id}.wav`;

/** Een id op de tijd van nu: set-20260923-213012.wav sorteert vanzelf goed. */
function nieuwId(nu = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${nu.getFullYear()}${p(nu.getMonth() + 1)}${p(nu.getDate())}-${p(nu.getHours())}${p(nu.getMinutes())}${p(nu.getSeconds())}`;
}

export async function start(map, { nu } = {}) {
  await mkdir(map, { recursive: true });
  let id = nieuwId(nu), n = 1;
  // Twee opnames in dezelfde seconde: niet over elkaar heen.
  while (await stat(join(map, naamVan(id))).then(() => true, () => false)) id = `${nieuwId(nu)}-${++n}`;
  const f = await open(join(map, naamVan(id)), 'wx');
  await f.write(wavKop(0), 0, KOP, 0);
  await f.close();
  return { ok: true, id, bestand: naamVan(id) };
}

export async function voegToe(map, id, stuk) {
  if (!ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
  if (stuk.length % (KANALEN * BITS / 8)) return { ok: false, fout: 'stuk is geen heel aantal frames' };
  let f;
  try {
    f = await open(join(map, naamVan(id)), 'a');
    const { bytesWritten } = await f.write(stuk);
    // Een half geschreven stuk verschuift alles erna een half frame: dan
    // liever een duidelijke fout.
    if (bytesWritten !== stuk.length) return { ok: false, fout: `maar ${bytesWritten} van ${stuk.length} bytes geschreven` };
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
 */
export const VIDEO_EXT = ['mp4', 'webm'];

export async function voegVideoToe(map, id, ext, stuk) {
  if (!ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
  if (!VIDEO_EXT.includes(ext)) return { ok: false, fout: `videoformaat "${ext}" niet toegestaan` };
  // Alleen bij een opname die echt bestaat: geen losse videobestanden maken.
  if (!(await stat(join(map, naamVan(id))).then(() => true, () => false))) return { ok: false, fout: 'opname bestaat niet' };
  let f;
  try {
    f = await open(join(map, `set-${id}.${ext}`), 'a');
    await f.write(stuk);
    return { ok: true };
  } catch (err) {
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

/** De kop gelijk trekken met wat er echt in het bestand staat. */
export async function sluit(map, id) {
  if (!ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
  let f;
  try {
    f = await open(join(map, naamVan(id)), 'r+');
    const { size } = await f.stat();
    const data = Math.max(0, size - KOP);
    await f.write(wavKop(data), 0, KOP, 0);
    return { ok: true, id, bestand: naamVan(id), bytes: size, duur: data / (SR * KANALEN * BITS / 8), ...(await videoVan(map, id)) };
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
