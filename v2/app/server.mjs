/**
 * De server van VarveDJ v2: de app zelf, en de library van v1 ALLEEN LEZEN.
 *
 *   node server.mjs                 http://localhost:8780
 *   VARVE_MEDIA=<map> node server.mjs   de mediamap van v1 (met library.db)
 *   VARVE_V2_POORT=8781 …           een andere poort
 *
 * Wat hij doet:
 *   /                    index.html en de modules (no-store: Chrome houdt ES-modules anders vast)
 *   /api/library         de nummers van v1 met grid (alleen lezen, de database gaat nooit open om te schrijven)
 *   /api/library/<id>/audio   audio.wav van dat nummer, met Range (de app streamt hem per pagina)
 *   /api/library/<id>/peaks   peaks.bin naast audio.wav (v1: per vakje min en max als float32), voor het overzicht
 * Alleen van deze machine (Host en Origin), zoals v1. COOP/COEP staan aan voor
 * SharedArrayBuffer later.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HIER = dirname(fileURLToPath(import.meta.url));
const POORT = Number(process.env.VARVE_V2_POORT || 8780);

export function kiesMedia(env = process.env) {
  if (env.VARVE_MEDIA) return env.VARVE_MEDIA;
  const pad = join(homedir(), '.varve', 'media-pad');
  if (existsSync(pad)) { const p = readFileSync(pad, 'utf8').trim(); if (p) return p; }
  return join(HIER, '..', '..', 'media');
}

const SOORTEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
};
// Alleen wat de app nodig heeft; nooit test/, tools/ of iets erbuiten.
const WITTE_LIJST = [/^\/$/, /^\/index\.html$/, /^\/src\/[\w/.-]+\.(js|css|svg)$/, /^\/styles\.css$/];

function kop(res, status, soort, extra = {}) {
  res.writeHead(status, {
    'content-type': soort, 'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
    'x-content-type-options': 'nosniff', ...extra,
  });
}

function vreemd(req) {
  const host = req.headers.host || '';
  const ok = [`localhost:${POORT}`, `127.0.0.1:${POORT}`, `[::1]:${POORT}`];
  if (!ok.includes(host)) return true;
  const o = req.headers.origin;
  if (o && !ok.some((h) => o === `http://${h}`)) return true;
  return false;
}

let lib = null;
async function library(media) {
  if (lib) return lib;
  const pad = join(media, 'library.db');
  if (!existsSync(pad)) return (lib = { nummers: () => [], audio: () => null, bron: null });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(pad, { readOnly: true });
  const kolommen = new Set(db.prepare('PRAGMA table_info(tracks)').all().map((k) => k.name));
  const gridKolom = kolommen.has('grid_json') ? 'grid_json' : 'NULL';
  const lijst = db.prepare(`SELECT id, titel, uploader, duur, audio, ${gridKolom} AS grid FROM tracks ORDER BY toegevoegd DESC`);
  const een = db.prepare('SELECT audio FROM tracks WHERE id = ?');
  const opSchijf = (rel) => {
    const p = normalize(join(media, String(rel).replace(/^media[\\/]/, '')));
    return p.startsWith(normalize(media) + sep) ? p : null;
  };
  lib = {
    bron: pad,
    nummers: () => lijst.all().map((r) => ({
      id: r.id, titel: r.titel, artiest: r.uploader || '', duur: r.duur,
      grid: r.grid ? JSON.parse(r.grid) : null,
    })),
    audio: (id) => { const r = een.get(id); return r ? opSchijf(r.audio) : null; },
  };
  return lib;
}

function stuurBestand(req, res, pad, soort) {
  const { size } = statSync(pad);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    const van = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const tot = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (van > tot || van >= size) { kop(res, 416, 'text/plain', { 'content-range': `bytes */${size}` }); return res.end(); }
    kop(res, 206, soort, { 'content-range': `bytes ${van}-${tot}/${size}`, 'content-length': tot - van + 1, 'accept-ranges': 'bytes' });
    return createReadStream(pad, { start: van, end: tot }).pipe(res);
  }
  kop(res, 200, soort, { 'content-length': size, 'accept-ranges': 'bytes' });
  createReadStream(pad).pipe(res);
}

export function maakServer({ media = kiesMedia() } = {}) {
  return createServer(async (req, res) => {
    try {
      if (vreemd(req)) { kop(res, 403, 'text/plain'); return res.end('alleen van deze machine'); }
      if (req.method !== 'GET' && req.method !== 'HEAD') { kop(res, 405, 'text/plain'); return res.end(); }
      const url = new URL(req.url, 'http://x');
      const pad = decodeURIComponent(url.pathname);
      if (pad.includes('..') || pad.includes('\\') || pad.includes('\0')) { kop(res, 400, 'text/plain'); return res.end(); }

      if (pad === '/api/library') {
        const l = await library(media);
        kop(res, 200, SOORTEN['.json']);
        return res.end(JSON.stringify({ bron: l.bron, nummers: l.nummers() }));
      }
      const a = /^\/api\/library\/([\w.:-]+)\/(audio|peaks)$/.exec(pad);
      if (a) {
        const audio = (await library(media)).audio(a[1]);
        const bestand = audio && (a[2] === 'audio' ? audio : join(dirname(audio), 'peaks.bin'));
        if (!bestand || !existsSync(bestand)) { kop(res, 404, 'text/plain'); return res.end(`geen ${a[2]}`); }
        return stuurBestand(req, res, bestand, a[2] === 'audio' ? 'audio/wav' : 'application/octet-stream');
      }
      if (!WITTE_LIJST.some((r) => r.test(pad))) { kop(res, 404, 'text/plain'); return res.end(); }
      const bestand = join(HIER, pad === '/' ? 'index.html' : pad);
      if (!existsSync(bestand)) { kop(res, 404, 'text/plain'); return res.end(); }
      return stuurBestand(req, res, bestand, SOORTEN[extname(bestand)] || 'application/octet-stream');
    } catch (e) {
      console.error('[v2]', e);
      if (!res.headersSent) kop(res, 500, 'text/plain');
      res.end('fout');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const media = kiesMedia();
  maakServer({ media }).listen(POORT, '127.0.0.1', () => {
    console.log(`VarveDJ v2 op http://localhost:${POORT}  (library: ${join(media, 'library.db')})`);
  });
}
