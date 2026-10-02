// De TouchDesigner-kant (docs/BUS.md, fase 1). TD luistert met een Web Server
// DAT op :9981 (td/bouw_varve.py), net zoals de Waterschaal op :9980; de hub
// verbindt erheen en is voor de rest van de bus gewoon de app 'td'.
// Gebruikt de WebSocket die in Node 22 zit; geen pakket.
//
// Sleutel: TD luistert op alle netwerken en kent geen Origin. Daarom verbindt
// de hub op ws://127.0.0.1:9981/<sleutel>, en negeert TD wie de sleutel niet
// kent. De sleutel staat in ~/.varve-sleutel; wie het eerst start (hub of het
// bouwscript) maakt hem. Niets om over te typen.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { VOL, DOOD } from './ws.js';

export const TD_HALLO = { baan: 'hub', type: 'hallo', app: 'td', versie: 1, luistert: ['muziek', 'beeld', 'apc'], stuurt: ['acties'] };
export const SLEUTELBESTAND = join(homedir(), '.varve-sleutel');

export function leesSleutel(pad = SLEUTELBESTAND) {
  try {
    const s = readFileSync(pad, 'utf8').trim();
    if (/^[0-9a-f]{16,}$/.test(s)) return s;
  } catch (_) { /* nog niet gemaakt */ }
  const s = randomBytes(12).toString('hex');
  writeFileSync(pad, s + '\n', { mode: 0o600 });
  return s;
}

/**
 * @param {ReturnType<import('./hub.js').maakHub>} hub
 * @param {object} o
 * @param {string} o.url              bijvoorbeeld ws://127.0.0.1:9981/<sleutel>
 * @param {typeof WebSocket} [o.WebSocketImpl]
 * @param {number} [o.opnieuw]        ms tussen pogingen, zoals de Waterschaal (3 s)
 */
export function koppelTd(hub, { url, WebSocketImpl = globalThis.WebSocket, opnieuw = 3000, log = () => {} }) {
  let ws = null, kant = null, verbonden = false, gestopt = false, wachter = null;

  const later = () => { if (!gestopt) wachter = setTimeout(start, opnieuw); };

  function start() {
    if (gestopt) return;
    if (typeof WebSocketImpl !== 'function') return log('geen WebSocket in deze Node: TD-koppeling uit');
    try { ws = new WebSocketImpl(url); } catch (_) { return later(); }
    const deze = ws;
    deze.onopen = () => {
      verbonden = true;
      log(`TD verbonden (${url.replace(/\/[0-9a-f]{16,}$/, '/…')})`);
      kant = hub.verbind({
        stuur(t, vervangbaar) {
          if (deze.readyState !== 1) return;
          // TD hangt (opslaan, een dialoog): niet eindeloos opsparen
          if (deze.bufferedAmount > DOOD) { log('TD leest niet meer; verbinding opnieuw'); deze.close(); return; }
          if (vervangbaar && deze.bufferedAmount > VOL) return;
          deze.send(t);
        },
      }, { herkomst: 'lokaal' });
      kant.ontvang(JSON.stringify(TD_HALLO));
    };
    deze.onmessage = (e) => { if (kant && typeof e.data === 'string') kant.ontvang(e.data); };
    deze.onerror = () => { /* onclose volgt */ };
    deze.onclose = () => {
      if (verbonden) log('TD weg; opnieuw proberen');
      verbonden = false;
      kant?.sluit(); kant = null;
      later();
    };
  }

  start();
  return {
    get verbonden() { return verbonden; },
    stop() {
      gestopt = true;
      clearTimeout(wachter);
      kant?.sluit(); kant = null;
      try { ws?.close(); } catch (_) { /* al dicht */ }
    },
  };
}
