/**
 * De app plus de meetpagina's (loopback, ABX, tikken) op één adres, voor op de Mac.
 *
 *   node v2/meting/server.mjs        http://localhost:8790/meting/loopback.html
 *
 * Alles onder /meting/ komt uit deze map (alleen .html, .js, .wav, .json); de rest gaat naar de
 * app-server (dezelfde regels: alleen deze machine, library alleen lezen).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const POORT = Number(process.env.VARVE_METING_POORT || 8790);
process.env.VARVE_V2_POORT = String(POORT);   // vóór het laden: de app-server leest zijn poort bij het importeren
const { maakServer } = await import('../app/server.mjs');
// Meten schrijft niet in je echte data (~/.varve/v2): logs en opnames van een meting gaan naar een tijdelijke map.
const app = maakServer({ data: (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'varve-v2-meting-')) });
const SOORT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.json': 'application/json' };

createServer((req, res) => {
  const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const m = /^\/meting\/([\w./-]+)$/.exec(pad);
  if (m && !pad.includes('..') && SOORT[extname(pad)]) {
    const bestand = normalize(join(HIER, m[1]));
    if (bestand.startsWith(HIER + sep) && existsSync(bestand)) {
      res.writeHead(200, {
        'content-type': SOORT[extname(bestand)], 'content-length': statSync(bestand).size, 'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
      });
      return createReadStream(bestand).pipe(res);
    }
  }
  app.emit('request', req, res);
}).listen(POORT, '127.0.0.1', () => console.log(`meten: http://localhost:${POORT}/meting/loopback.html (en abx.html, tikken.html)`));
