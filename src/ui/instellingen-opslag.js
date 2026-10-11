/**
 * De zeven browser-instellingen die het instrument zijn, ook op de server
 * (extra-3 B4, 11 okt 2026). Zelfde vorm als `mapping-opslag.js`: de server
 * (`/api/instellingen/<sleutel>`, tabel `instellingen` in library.db) eerst,
 * localStorage als reserve. Daarmee gaan master-rack, klankschaal, poorten,
 * beeld-adres, stems-standaard, cue-wissel en vormen-vlag mee in elke backup
 * van library.db, en overleven ze een nieuw Chrome-profiel of een nieuwe Mac.
 *
 * Hoe het werkt, zonder dat de plekken die deze sleutels lezen veranderen:
 *
 *   - Bij het opstarten (app.js, vóór de engine en de panelen) haalt `start()`
 *     alle zeven in één verzoek op en zet ze in localStorage. De bestaande
 *     `localStorage.getItem(...)`-plekken lezen daarna gewoon de serverwaarde.
 *   - Staat een sleutel nog NIET op de server (nooit bewaard) maar wel in deze
 *     browser, dan gaat hij één keer omhoog. Daarna is de server de bron.
 *   - Schrijven gaat via `schrijfInstelling`/`wisInstelling` (of, als de plek
 *     zelf de browser al schrijft, `spiegelInstelling`): localStorage meteen,
 *     de server kort daarna. Lukt dat niet, dan blijft de sleutel als
 *     "onverzonden" gemarkeerd in deze browser, en wint de browser bij de
 *     volgende start (anders zou een oudere serverwaarde je laatste keuze
 *     overschrijven).
 *   - Is de server er niet bij het opstarten: niets aan de hand, localStorage
 *     is de reserve en alles werkt zoals vóór B4.
 *
 * Geen DOM. `haal` (fetch), `opslag` (localStorage) en `meld` komen van buiten;
 * zo is de volgorde server/browser in Node te testen (test/instellingen-opslag.test.mjs).
 */

/** De witte lijst: alleen deze sleutels mogen naar de server (server/index.js importeert hem). */
export const INSTELLING_SLEUTELS = Object.freeze([
  'varve.master.rack',
  'varve.klankschaal',
  'varve.midi.ports',
  'varve.beeld.adres',
  'varve.beeld.latentie',
  'varve.beeld.aan',
  'varve.stems.standaard',
  'varve.koptelefoon.omgewisseld',
  'varve.vormen',
]);

/** Hoe groot één waarde mag zijn (tekens). Een master-rack is een paar kB. */
export const INSTELLING_MAX = 128 * 1024;

/** In deze browser: welke sleutels nog niet op de server staan (lijst als JSON). */
export const ONVERZONDEN = 'varve.instellingen.onverzonden';

export const isInstelling = (sleutel) => INSTELLING_SLEUTELS.includes(sleutel);

const pad = (sleutel) => `/api/instellingen/${encodeURIComponent(sleutel)}`;

/**
 * Een opslag voor de zeven sleutels. Voor tests los te maken; de app gebruikt
 * de ene van de browser (onderaan, `startInstellingen` en de schrijvers).
 *
 * @param haal     fetch-achtig, of null (dan alleen de browser)
 * @param opslag   localStorage-achtig, of null
 * @param meld     (tekst, soort) -> void
 * @param wacht    ms tussen de laatste wijziging en het verzenden (een schuif geeft er veel)
 * @param tijdslimiet  ms voor de opstartvraag; daarna start de mixer met de browserwaarden
 */
export function maakInstellingenOpslag({ haal = null, opslag = null, meld = () => {}, wacht = 400, tijdslimiet = 1500 } = {}) {
  const opServer = new Map();   // sleutel -> laatst bekende serverwaarde (tekst of null)
  const timers = new Map();
  const lopend = new Set();
  let gemeld = false;

  const lees = (k) => { try { return opslag?.getItem(k) ?? null; } catch (_) { return null; } };
  const zetLokaal = (k, v) => {
    try { if (v === null) opslag?.removeItem(k); else opslag?.setItem(k, v); } catch (_) {}
  };
  const onverzonden = () => {
    try { const l = JSON.parse(opslag?.getItem(ONVERZONDEN) || '[]'); return Array.isArray(l) ? l.filter(isInstelling) : []; } catch (_) { return []; }
  };
  const markeer = (k, aan) => {
    const l = new Set(onverzonden());
    if (aan) l.add(k); else l.delete(k);
    try { if (l.size) opslag?.setItem(ONVERZONDEN, JSON.stringify([...l])); else opslag?.removeItem(ONVERZONDEN); } catch (_) {}
  };

  async function stuur(k, waarde) {
    if (!haal) return false;
    try {
      const r = await haal(pad(k), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waarde }) });
      if (!r.ok) throw new Error(`${r.status}`);
      opServer.set(k, waarde);
      // Alleen afvinken als er intussen niets nieuws staat: anders gaat dat zo ook nog.
      if (!timers.has(k) && lees(k) === waarde) markeer(k, false);
      return true;
    } catch (err) {
      // Eén keer per sessie melden: een schuif die blijft bewegen geeft anders een rij meldingen.
      if (!gemeld) { gemeld = true; meld(`instelling ${k} niet op de server bewaard (${err.message}) — staat wel in deze browser`, 'fout'); }
      return false;
    }
  }

  /** Alleen de server: de plek heeft de browser zelf al geschreven. */
  function spiegel(k, waarde) {
    if (!isInstelling(k) || !haal) return;
    const w = waarde == null ? null : String(waarde);
    if (!timers.has(k) && opServer.has(k) && opServer.get(k) === w) return;   // niets nieuws
    markeer(k, true);
    clearTimeout(timers.get(k));
    const t = setTimeout(() => {
      timers.delete(k);
      const p = stuur(k, lees(k)).finally(() => lopend.delete(p));
      lopend.add(p);
    }, wacht);
    timers.set(k, t);
  }

  function schrijf(k, waarde) { zetLokaal(k, String(waarde)); spiegel(k, String(waarde)); }
  function wis(k) { zetLokaal(k, null); spiegel(k, null); }

  /**
   * Opstarten: de server lezen en de browser gelijk zetten, of (lege server,
   * gevulde browser) één keer omhoog schrijven. Gooit nooit.
   *
   * @returns {{ serverBereikbaar, vanServer: string[], omhoog: string[], fout? }}
   */
  async function start() {
    const verslag = { serverBereikbaar: false, vanServer: [], omhoog: [] };
    if (!haal) return verslag;
    let lijst;
    try {
      const stop = new AbortController();
      const t = setTimeout(() => stop.abort(), tijdslimiet);
      try {
        const r = await haal('/api/instellingen', { signal: stop.signal });
        if (!r.ok) throw new Error(`${r.status}`);
        lijst = (await r.json())?.instellingen;
      } finally { clearTimeout(t); }
      if (!lijst || typeof lijst !== 'object') throw new Error('geen instellingen in het antwoord');
    } catch (err) {
      verslag.fout = err?.name === 'AbortError' ? 'geen antwoord' : err?.message;
      return verslag;
    }
    verslag.serverBereikbaar = true;
    const wacht = new Set(onverzonden());
    const omhoog = [];
    for (const k of INSTELLING_SLEUTELS) {
      const bewaard = Object.prototype.hasOwnProperty.call(lijst, k);
      const server = bewaard && typeof lijst[k] === 'string' ? lijst[k] : null;
      const lokaal = lees(k);
      if (bewaard) opServer.set(k, server);
      if (wacht.has(k) && !timers.has(k)) {
        // De vorige keer niet aangekomen: de browser is nieuwer dan de server.
        if (!bewaard || server !== lokaal) omhoog.push(k); else markeer(k, false);
      } else if (bewaard) {
        if (lokaal !== server) zetLokaal(k, server);
        verslag.vanServer.push(k);
      } else if (lokaal !== null) {
        omhoog.push(k);   // lege server, gevulde browser: één keer omhoog
      }
    }
    for (const k of omhoog) {
      markeer(k, true);
      if (await stuur(k, lees(k))) verslag.omhoog.push(k);
    }
    return verslag;
  }

  /** Wacht tot alles wat klaarstaat verstuurd is (tests; en vóór een backup). */
  async function klaar() {
    for (const [k, t] of timers) {
      clearTimeout(t); timers.delete(k);
      const p = stuur(k, lees(k)).finally(() => lopend.delete(p));
      lopend.add(p);
    }
    await Promise.all([...lopend]);
  }

  return { start, schrijf, wis, spiegel, klaar, onverzonden };
}

// ---- de ene opslag van de browser ------------------------------------------

/**
 * Alleen in een pagina van de server (http/https) praat hij met de server; in
 * Node (tests die panelen of midi.js laden) en vanaf file:// blijft alles in
 * de opslag die de plek zelf gebruikt.
 */
const inBrowser = () => {
  try { return /^https?:$/.test(globalThis.location?.protocol || ''); } catch (_) { return false; }
};
let browser = null;
function deBrowser() {
  if (!browser) {
    let opslag = null;
    try { opslag = globalThis.localStorage ?? null; } catch (_) {}
    browser = maakInstellingenOpslag({
      haal: inBrowser() && typeof globalThis.fetch === 'function' ? (...a) => globalThis.fetch(...a) : null,
      opslag,
      meld: (...a) => globalThis.meld?.(...a),
    });
  }
  return browser;
}

/** app.js: vóór de engine en de panelen. Gooit nooit; zonder server blijft de browser de bron. */
export const startInstellingen = () => deBrowser().start();
/** localStorage.setItem, en voor de zeven sleutels ook de server. */
export const schrijfInstelling = (k, v) => {
  if (isInstelling(k)) return deBrowser().schrijf(k, v);
  try { globalThis.localStorage?.setItem(k, v); } catch (_) {}
};
/** localStorage.removeItem, en voor de zeven sleutels ook de server (waarde null). */
export const wisInstelling = (k) => {
  if (isInstelling(k)) return deBrowser().wis(k);
  try { globalThis.localStorage?.removeItem(k); } catch (_) {}
};
/** Alleen naar de server, voor een plek die zijn eigen opslag al schreef (ingest-strook). */
export const spiegelInstelling = (k, v) => { if (isInstelling(k) && inBrowser()) deBrowser().spiegel(k, v); };
