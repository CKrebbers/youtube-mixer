/**
 * De video van een nummer voor de server (BOUWPLAN plak 4): GET/HEAD /api/library/<id>/video serveert
 * media/<id>/video.mp4, het bestand NAAST audio.wav dat de ingest van v1 maakt. Alleen lezen.
 *
 * Range zoals een <video> het vraagt, met één afwijking (v1 VIDEO_KNIP, oogst beeld-020): een OPEN
 * verzoek (`bytes=N-`) krijgt hooguit VIDEO_KNIP (2 MB) terug. Over HTTP/1.1 opent Chrome zes
 * verbindingen per host, en een <video> die een minuut vooruit buffert houdt er een vast: met acht
 * video's wachtten de audiopagina's van de tracks tot 10–17 s (stilte, gemeten in v1 op 14 okt). Met de
 * knip vraagt de video zelf het volgende stuk en komt de verbinding steeds vrij. Een gesloten bereik
 * (`bytes=N-M`, de audio vraagt altijd zo) en een staart (`bytes=-M`) blijven zoals ze zijn.
 *
 * Niet in server.mjs zelf (die is van een andere bouwer): server.mjs roept dit aan, ná zijn eigen
 * controle op Host en Origin, vóór zijn route voor audio en peaks:
 *
 *   if (await videoRoute(req, res, { pad, audioPad: async (id) => (await library(media)).audio(id), kop })) return;
 *
 * Geeft true als het verzoek voor deze route was (en beantwoord is), anders false.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const VIDEO_KNIP = 2 * 1024 * 1024;
export const VIDEO_ROUTE = /^\/api\/library\/([\w.:-]+)\/video$/;

/** Dezelfde koppen als de rest van de server (no-store, COOP/COEP), als de aanroeper geen `kop` meegeeft. */
function eigenKop(res, status, soort, extra = {}) {
  res.writeHead(status, {
    'content-type': soort, 'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
    'x-content-type-options': 'nosniff', ...extra,
  });
}

/**
 * Het bereik dat we sturen voor een Range-kop, of null (geen of onleesbare kop: het hele bestand),
 * of { fout: 416 }. Puur, voor de test.
 */
export function bereik(range, size, knip = VIDEO_KNIP) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m || (!m[1] && !m[2])) return null;
  let van, tot;
  if (!m[1]) {                       // staart: de laatste M bytes
    van = Math.max(0, size - Number(m[2]));
    tot = size - 1;
  } else {
    van = Number(m[1]);
    tot = m[2] ? Math.min(size - 1, Number(m[2])) : Math.min(size - 1, van + knip - 1);
  }
  if (van >= size || tot < van) return { fout: 416 };
  return { van, tot };
}

/**
 * @param pad       het gedecodeerde pad van het verzoek
 * @param audioPad  (id) -> pad van audio.wav op schijf, of null (mag een Promise zijn)
 * @param kop       (res, status, soort, extra) -> void, de kopfunctie van de server
 */
export async function videoRoute(req, res, { pad, audioPad, kop = eigenKop, knip = VIDEO_KNIP }) {
  const m = VIDEO_ROUTE.exec(pad ?? '');
  if (!m) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { kop(res, 405, 'text/plain'); res.end(); return true; }
  const audio = await audioPad(m[1]);
  const bestand = audio ? join(dirname(audio), 'video.mp4') : null;
  let info = null;
  if (bestand) { try { info = await stat(bestand); } catch { info = null; } }
  if (!info || !info.isFile()) { kop(res, 404, 'text/plain'); res.end('geen video'); return true; }

  const size = info.size;
  const b = bereik(req.headers.range, size, knip);
  const stuur = (opties) => {
    if (req.method === 'HEAD') { res.end(); return; }
    const s = createReadStream(bestand, opties);
    s.on('error', () => res.destroy());           // een leesfout halverwege mag de server niet meenemen
    s.pipe(res);
  };
  if (b?.fout) { kop(res, 416, 'text/plain', { 'content-range': `bytes */${size}` }); res.end(); return true; }
  if (b) {
    kop(res, 206, 'video/mp4', { 'content-range': `bytes ${b.van}-${b.tot}/${size}`, 'content-length': b.tot - b.van + 1, 'accept-ranges': 'bytes' });
    stuur({ start: b.van, end: b.tot });
    return true;
  }
  kop(res, 200, 'video/mp4', { 'content-length': size, 'accept-ranges': 'bytes' });
  stuur();
  return true;
}
