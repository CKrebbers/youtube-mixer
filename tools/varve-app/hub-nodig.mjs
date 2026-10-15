// Moet VARVE.app de AV-app-hub starten? (VRAGEN AR21, 16 okt.) Alleen als de actieve opstelling
// "mixer via de hub" zegt (hub.mixerVia), dezelfde regel als de knop "mixer openen" in de
// Controlekamer (mixerAdres in src/controle/stand-tegel.js): zo opent avond 1 (APC direct) nooit
// een hub die de APC pakt naast de mixer.
// Draaien: node tools/varve-app/hub-nodig.mjs [--poort 8777]
// Schrijft één regel en stopt altijd met exit 0 (VARVE.app leest de tekst, geen exitcode):
//   ja                  de opstelling zegt via de hub
//   nee <naam|geen>     de opstelling zegt het niet (of er is geen actief)
//   onbekend <reden>    de server antwoordt niet of geeft een fout: dan start VARVE.app geen hub
import { pathToFileURL } from 'node:url';
import { mixerAdres, MIXER_VIA_HUB } from '../../src/controle/stand-tegel.js';

/** Uit het antwoord van GET /api/standen/actief: 'ja' of 'nee <naam>'. Puur. */
export function hubNodig(actief) {
  if (mixerAdres(actief) === MIXER_VIA_HUB) return 'ja';
  return `nee ${actief?.naam || 'geen'}`;
}

/** Vraagt de server; geeft de regel die VARVE.app leest. `haal` = fetch (vervangbaar in de test). */
export async function vraag({ poort = 8777, haal = fetch, ms = 3000 } = {}) {
  try {
    const res = await haal(`http://localhost:${poort}/api/standen/actief`, { signal: AbortSignal.timeout(ms) });
    const tekst = await res.text();
    if (!res.ok) return `onbekend de server gaf ${res.status}`;
    let j;
    try { j = JSON.parse(tekst); } catch { return 'onbekend het antwoord is geen JSON'; }
    return hubNodig(j && typeof j === 'object' && !Array.isArray(j) ? j : null);
  } catch (err) {
    return `onbekend ${err?.name === 'TimeoutError' ? `geen antwoord binnen ${ms / 1000} s` : 'de server antwoordt niet'}`;
  }
}

// pathToFileURL: de projectmap heeft spaties ("1. Projects/Youtube mixer"), import.meta.url is gecodeerd.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--poort');
  const poort = i > 0 ? Number(process.argv[i + 1]) : 8777;
  console.log(await vraag({ poort }));
}
