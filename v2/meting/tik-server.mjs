#!/usr/bin/env node
/**
 * De server van de tikpagina (meetpunt M12): /meting/tikken.html, en /api/* van de v2-server
 * (maakServer uit v2/app/server.mjs, ongewijzigd: de v1-library ALLEEN LEZEN).
 *
 *   node v2/meting/tik-server.mjs                http://localhost:8782/  (= /meting/tikken.html)
 *   VARVE_MEDIA=<map> node v2/meting/tik-server.mjs      de mediamap van v1 (met library.db)
 *   VARVE_TIK_POORT=8783 …                       een andere poort
 *
 * Alleen GET/HEAD, alleen van deze machine (Host en Origin, dezelfde regels als server.mjs). Hij serveert
 * niets anders uit v2/meting dan tikken.html, en van de app alleen /api.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
export const POORT = Number(process.env.VARVE_TIK_POORT || 8782);
// server.mjs leest zijn poort bij het laden en controleert de Host daartegen: dezelfde poort als hier.
process.env.VARVE_V2_POORT = String(POORT);
const { maakServer, kiesMedia } = await import('../app/server.mjs');

const PAGINAS = { '/meting/tikken.html': join(HIER, 'tikken.html') };

function kop(res, status, soort, extra = {}) {
  res.writeHead(status, {
    'content-type': soort, 'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
    'x-content-type-options': 'nosniff', ...extra,
  });
}

function vreemd(req) {
  const ok = [`localhost:${POORT}`, `127.0.0.1:${POORT}`, `[::1]:${POORT}`];
  if (!ok.includes(req.headers.host || '')) return true;
  const o = req.headers.origin;
  return !!(o && !ok.some((h) => o === `http://${h}`));
}

export function maakTikServer({ media = kiesMedia() } = {}) {
  const api = maakServer({ media, data: mkdtempSync(join(tmpdir(), 'varve-v2-tik-')) });
  const apiDoe = api.listeners('request')[0];
  return createServer((req, res) => {
    try {
      if (vreemd(req)) { kop(res, 403, 'text/plain'); return res.end('alleen van deze machine'); }
      if (req.method !== 'GET' && req.method !== 'HEAD') { kop(res, 405, 'text/plain'); return res.end(); }
      const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (pad.includes('..') || pad.includes('\\') || pad.includes('\0')) { kop(res, 400, 'text/plain'); return res.end(); }
      if (pad === '/' || pad === '/meting' || pad === '/meting/') { kop(res, 302, 'text/plain', { location: '/meting/tikken.html' }); return res.end(); }
      if (PAGINAS[pad]) {
        const inhoud = readFileSync(PAGINAS[pad]);
        kop(res, 200, 'text/html; charset=utf-8', { 'content-length': inhoud.length });
        return res.end(req.method === 'HEAD' ? undefined : inhoud);
      }
      if (pad.startsWith('/api/')) return apiDoe(req, res);
      kop(res, 404, 'text/plain'); res.end();
    } catch (e) {
      console.error('[tik]', e);
      if (!res.headersSent) kop(res, 500, 'text/plain');
      res.end('fout');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const media = kiesMedia();
  maakTikServer({ media }).listen(POORT, '127.0.0.1', () => {
    console.log(`Tikken (M12) op http://localhost:${POORT}/  (library: ${join(media, 'library.db')}, alleen lezen)`);
  });
}
