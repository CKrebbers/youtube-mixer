// De hub van de koppelbus (docs/BUS.md). Een apart proces naast de VARVE-server,
// zodat die server en de engine ongemoeid blijven. Alleen Node-ingebouwd.
//
//   node hub/index.js
//
// VARVE_HUB_POORT     standaard 8778 (alleen 127.0.0.1)
// VARVE_TD            standaard ws://127.0.0.1:9981; 'uit' zet de TD-koppeling uit
// VARVE_HOSTS         dezelfde Tailscale-namen als de server (docs/TAILSCALE.md)
// VARVE_HUB_ORIGINS   andere pagina's die mogen aansluiten, bv. http://localhost:5173 (AV-kern)
// VARVE_SERVER_POORT  waar de VARVE-pagina's vandaan komen, standaard 8777
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { maakHub } from './hub.js';
import { koppelWebSocket } from './ws.js';
import { koppelTd, leesSleutel } from './td.js';

export const POORT = 8778;
const LOKAAL = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Wie mag binnen, en als wat. Host tegen DNS-rebinding, Origin tegen vreemde
 * pagina's (zoals `vreemdVerzoek` in de server). Geeft 'varve' (een VARVE-pagina),
 * 'extra' (een toegelaten andere pagina), 'lokaal' (geen browser: TD, OBS, Node)
 * of false.
 */
export function magBinnen(req, { poort, serverPoort = 8777, hosts = [], extra = [] }) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!LOKAAL.some((h) => host === `${h}:${poort}`)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return 'lokaal';
  let u;
  try { u = new URL(origin); } catch (_) { return false; }
  if (u.protocol === 'http:' && LOKAAL.includes(u.hostname) && u.port === String(serverPoort)) return 'varve';
  if (u.protocol === 'https:' && !u.port && hosts.includes(u.hostname)) return 'varve';
  if (extra.includes(u.origin)) return 'extra';
  return false;
}

export const leesHosts = (s) => String(s || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
export const leesOrigins = (s) => leesHosts(s).map((o) => { try { return new URL(o).origin; } catch (_) { return null; } }).filter(Boolean);

/** Start de hub. Geeft { poort, hub, server, td, stop() } zodra hij luistert. */
export function startHub({
  poort = POORT, td = 'ws://127.0.0.1:9981', tdSleutel = null, tdOpnieuw = 3000,
  serverPoort = 8777, hosts = [], extra = [], log = () => {},
} = {}) {
  const hub = maakHub({ log });
  const toegang = (req) => magBinnen(req, { poort: server.address()?.port, serverPoort, hosts, extra });
  let tdKant = null;
  const server = createServer((req, res) => {
    if (!toegang(req)) { res.writeHead(403).end(); return; }
    if (req.method === 'GET' && req.url === '/status') {
      // de Controlekamer (localhost:8777) mag dit lezen; toegang keurde de Origin al goed
      const cors = req.headers.origin ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {};
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify({ ...hub.status(), td: tdKant ? tdKant.verbonden : null }));
      return;
    }
    res.writeHead(404).end();
  });
  const sockets = new Set();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  koppelWebSocket(server, {
    magBinnen: toegang,
    bijVerbinding(v, _req, herkomst) {
      const kant = hub.verbind({ stuur: (t, vervangbaar) => v.stuur(t, vervangbaar) }, { herkomst });
      v.on('bericht', (t) => kant.ontvang(t)).on('dicht', () => kant.sluit());
    },
  });
  return new Promise((klaar, mis) => {
    server.once('error', mis);
    server.listen(poort, '127.0.0.1', () => {
      const echt = server.address().port;
      if (td && td !== 'uit') {
        const sleutel = tdSleutel ?? leesSleutel();
        tdKant = koppelTd(hub, { url: `${td.replace(/\/+$/, '')}/${sleutel}`, log, opnieuw: tdOpnieuw });
      }
      klaar({
        poort: echt, hub, server,
        get td() { return tdKant; },
        stop: () => new Promise((r) => {
          tdKant?.stop();
          server.close(() => r());
          for (const s of sockets) s.destroy();             // ook de WebSocket-verbindingen
        }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const poort = Number(process.env.VARVE_HUB_POORT) || POORT;
  const td = process.env.VARVE_TD ?? 'ws://127.0.0.1:9981';
  const hosts = leesHosts(process.env.VARVE_HOSTS);
  const extra = leesOrigins(process.env.VARVE_HUB_ORIGINS);
  const serverPoort = Number(process.env.VARVE_SERVER_POORT) || 8777;
  const log = (s) => console.log(`[hub ${new Date().toTimeString().slice(0, 8)}] ${s}`);
  startHub({ poort, td, hosts, extra, serverPoort, log }).then(({ poort: p }) => {
    log(`luistert op ws://127.0.0.1:${p} · status: http://127.0.0.1:${p}/status`);
    log(td === 'uit' ? 'TD-koppeling uit' : `zoekt TD op ${td} (Web Server DAT uit td/bouw_varve.py)`);
    log(`pagina's van VARVE: http://localhost:${serverPoort}${hosts.map((h) => ', https://' + h).join('')}`);
    if (extra.length) log(`en ook: ${extra.join(', ')}`);
  }, (e) => {
    console.error(e.code === 'EADDRINUSE' ? `poort ${poort} is bezet: draait de hub al?` : e);
    process.exit(1);
  });
}
