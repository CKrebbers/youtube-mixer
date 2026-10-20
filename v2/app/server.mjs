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
 *   /api/v2/nummer/<id>       GET/PUT: wat bij een nummer hoort (hotcues, cue), in de eigen data van v2
 *   /api/v2/opname/<set>?frame=N   POST een stuk audio op zijn frame; …/klaar?frames=N; GET /api/v2/opnames
 *   /api/v2/log/<set>?van=B   POST een stuk handelingenlog op zijn byte
 * Alleen van deze machine (Host en Origin), zoals v1. COOP/COEP staan aan voor
 * SharedArrayBuffer later. De eigen data staat in VARVE_V2_DATA (server/data.mjs).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Data, kiesData, MAX_STUK, MAX_NUMMER } from './server/data.mjs';

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
const WITTE_LIJST = [/^\/$/, /^\/index\.html$/, /^\/src\/[\w/.-]+\.(js|css|svg)$/, /^\/styles\.css$/, /^\/indelingen\/[\w-]+\.json$/, /^\/racks\/[\w-]+\.json$/];

function kop(res, status, soort, extra = {}) {
  res.writeHead(status, {
    'content-type': soort, 'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
    'x-content-type-options': 'nosniff', ...extra,
  });
}

function vreemd(req) {
  const host = req.headers.host || '';
  // De poort waarop hij echt luistert (een testserver op een andere poort, in hetzelfde proces).
  const poort = req.socket?.localPort || POORT;
  const ok = [`localhost:${poort}`, `127.0.0.1:${poort}`, `[::1]:${poort}`];
  if (!ok.includes(host)) return true;
  const o = req.headers.origin;
  if (o && !ok.some((h) => o === `http://${h}`)) return true;
  return false;
}

// Eén library per mediamap (een testserver in hetzelfde proces heeft zijn eigen).
const libs = new Map();
async function library(media) {
  if (libs.has(media)) return libs.get(media);
  const lib = await maakLibrary(media);
  libs.set(media, lib);
  return lib;
}
async function maakLibrary(media) {
  let lib;
  const pad = join(media, 'library.db');
  if (!existsSync(pad)) return (lib = { nummers: () => [], audio: () => null, bron: null });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(pad, { readOnly: true });
  const kolommen = new Set(db.prepare('PRAGMA table_info(tracks)').all().map((k) => k.name));
  const gridKolom = kolommen.has('grid_json') ? 'grid_json' : 'NULL';
  const toonKolom = kolommen.has('toon_json') ? 'toon_json' : 'NULL';
  const lijst = db.prepare(`SELECT id, titel, uploader, duur, audio, toegevoegd, ${gridKolom} AS grid, ${toonKolom} AS toon FROM tracks ORDER BY toegevoegd DESC`);
  const een = db.prepare('SELECT audio FROM tracks WHERE id = ?');
  const opSchijf = (rel) => {
    const p = normalize(join(media, String(rel).replace(/^media[\\/]/, '')));
    return p.startsWith(normalize(media) + sep) ? p : null;
  };
  lib = {
    bron: pad,
    nummers: () => lijst.all().map((r) => ({
      id: r.id, titel: r.titel, artiest: r.uploader || '', duur: r.duur, toegevoegd: r.toegevoegd ?? null,
      grid: r.grid ? JSON.parse(r.grid) : null,
      toon: hoofdToon(r.toon),
    })),
    audio: (id) => { const r = een.get(id); return r ? opSchijf(r.audio) : null; },
  };
  return lib;
}

/**
 * De toonsoort van de plaat uit v1's toon_json (een kaart per stuk): de toonsoort die het langst
 * klinkt, alleen als hij zeker genoeg is (v1: ≥ 0,15; daaronder "~": geen duidelijke toonsoort).
 */
export function hoofdToon(json) {
  if (!json) return null;
  let k; try { k = JSON.parse(json); } catch { return null; }
  const st = Array.isArray(k?.stukken) ? k.stukken : [];
  const duur = new Map();
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (!s?.toonsoort || (s.zekerheid ?? 1) < 0.15) continue;
    const lengte = (st[i + 1]?.van ?? s.van + 60) - s.van;
    duur.set(s.toonsoort, (duur.get(s.toonsoort) ?? 0) + Math.max(0, lengte));
  }
  let beste = null, max = 0;
  for (const [t, d] of duur) if (d > max) { max = d; beste = t; }
  return beste;
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

/** De body als Buffer, hooguit `max` bytes (anders null). */
function leesBody(req, max) {
  return new Promise((ok, mis) => {
    const stukken = [];
    let n = 0;
    req.on('data', (d) => { n += d.length; if (n > max) { req.destroy(); ok(null); } else stukken.push(d); });
    req.on('end', () => ok(Buffer.concat(stukken)));
    req.on('error', mis);
  });
}

// Een antwoord vóór de body gelezen is: de verbinding dicht, anders leest de volgende vraag op
// dezelfde (keep-alive) verbinding de rest van deze body als zijn begin.
const json = (res, status, data) => {
  const req = res.req;
  kop(res, status, 'application/json; charset=utf-8', req && !req.complete ? { connection: 'close' } : {});
  res.end(JSON.stringify(data));
};
const antwoord = (res, r) => (r.fout ? json(res, r.fout, { fout: r.reden }) : json(res, 200, r.data));

export function maakServer({ media = kiesMedia(), data = kiesData() } = {}) {
  const eigen = new Data(data);
  return createServer(async (req, res) => {
    try {
      if (vreemd(req)) { kop(res, 403, 'text/plain', req.complete ? {} : { connection: 'close' }); return res.end('alleen van deze machine'); }
      const url0 = new URL(req.url, 'http://x');
      const pad0 = decodeURIComponent(url0.pathname);
      if (pad0.startsWith('/api/v2/')) return await v2Api(req, res, url0, pad0, eigen);
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
        // Geen peaks bij een nummer is gewoon (v1 maakt ze bij de ingest): 204, geen fout in de console.
        if (a[2] === 'peaks' && audio && !existsSync(bestand)) { kop(res, 204, 'application/octet-stream'); return res.end(); }
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

/** De schrijfroutes van v2 (alleen van deze machine; vreemd() is al gecontroleerd). */
async function v2Api(req, res, url, pad, eigen) {
  let m;
  if (pad.includes('..') || pad.includes('\\') || pad.includes('\0')) { kop(res, 400, 'text/plain'); return res.end(); }
  if ((m = /^\/api\/v2\/nummer\/([\w.:-]{1,128})$/.exec(pad))) {
    if (req.method === 'GET') return antwoord(res, eigen.leesNummer(m[1]));
    if (req.method !== 'PUT') { kop(res, 405, 'text/plain'); return res.end(); }
    if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') return json(res, 415, { fout: 'alleen application/json' });
    const b = await leesBody(req, MAX_NUMMER);
    if (!b) return json(res, 413, { fout: 'te groot' });
    let v; try { v = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { fout: 'geen JSON' }); }
    return antwoord(res, eigen.schrijfNummer(m[1], v));
  }
  if ((m = /^\/api\/v2\/instelling\/([\w-]{1,64})$/.exec(pad))) {
    if (req.method === 'GET') return antwoord(res, eigen.leesInstelling(m[1]));
    if (req.method !== 'PUT') { kop(res, 405, 'text/plain'); return res.end(); }
    if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') return json(res, 415, { fout: 'alleen application/json' });
    const b = await leesBody(req, 1024 * 1024);
    if (!b) return json(res, 413, { fout: 'te groot' });
    let v; try { v = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { fout: 'geen JSON' }); }
    return antwoord(res, eigen.schrijfInstelling(m[1], v));
  }
  if (pad === '/api/v2/opnames' && req.method === 'GET') return json(res, 200, { opnames: eigen.lijst() });
  if (!/^\/api\/v2\/(opname|log)\/[^/]+(\/klaar)?$/.test(pad)) { kop(res, 404, 'text/plain'); return res.end(); }
  if (req.method !== 'POST') { kop(res, 405, 'text/plain'); return res.end(); }
  const soort = (req.headers['content-type'] || '').split(';')[0].trim();
  if ((m = /^\/api\/v2\/opname\/(set-\d{8}-\d{6})\/klaar$/.exec(pad))) {
    await leesBody(req, 1024);
    return antwoord(res, eigen.opnameKlaar(m[1], Number(url.searchParams.get('frames'))));
  }
  if ((m = /^\/api\/v2\/opname\/(set-\d{8}-\d{6})$/.exec(pad))) {
    if (soort !== 'application/octet-stream') return json(res, 415, { fout: 'alleen application/octet-stream' });
    const b = await leesBody(req, MAX_STUK);
    if (!b) return json(res, 413, { fout: 'te groot' });
    return antwoord(res, eigen.opnameStuk(m[1], Number(url.searchParams.get('frame')), b));
  }
  if ((m = /^\/api\/v2\/log\/(set-\d{8}-\d{6})$/.exec(pad))) {
    if (soort !== 'text/plain') return json(res, 415, { fout: 'alleen text/plain' });
    const b = await leesBody(req, MAX_STUK);
    if (!b) return json(res, 413, { fout: 'te groot' });
    return antwoord(res, eigen.logStuk(m[1], Number(url.searchParams.get('van')), b));
  }
  kop(res, 404, 'text/plain'); res.end();
}
