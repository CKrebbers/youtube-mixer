/**
 * Is de poort al bezet? (AR20, 16 okt, docs/verslagen/2026-10-15/ar-proef.md)
 *
 * Een tweede server die naast een lopende start, deed bij het opstarten eerst zijn werk op schijf (de
 * `.bezig-*`-werkmappen van een ingest of split opruimen, de stems-rij terugzetten) en zag pas bij het
 * luisteren dat de poort bezet was (exit 3). Een ingest of split die op dat moment op de eerste server
 * liep, mislukte. Daarom kijkt server/index.js nu EERST of de poort vrij is, vóór er iets gebeurt.
 *
 * Probeert zelf te luisteren op host:poort en sluit meteen weer. true = bezet (EADDRINUSE). Een andere
 * fout (geen rechten, een rare host) is geen "bezet": dan beslist het echte listen() later, zoals altijd.
 * Er blijft een kleine kans dat twee servers tegelijk de proef halen; daarvoor blijft de exit 3 bij het
 * echte listen() staan.
 */
import { createServer } from 'node:net';

export function poortBezet(poort, host = '127.0.0.1') {
  return new Promise((klaar) => {
    const s = createServer();
    s.once('error', (err) => klaar(err?.code === 'EADDRINUSE'));
    s.listen(poort, host, () => s.close(() => klaar(false)));
  });
}
