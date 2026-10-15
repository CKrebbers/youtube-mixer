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
 *     Had deze browser een andere waarde, dan gaat die eerst naar
 *     `varve.instellingen.vorige` (per sleutel de laatste vijf, één melding):
 *     een vers profiel dat zijn standaard-rack op de server zette, kan zo nooit
 *     ongemerkt het echte rack van een andere browser wegvagen. Terugzetten:
 *     `instellingen.herstel('<sleutel>')` in de console (app.js), dan herladen.
 *   - Staat een sleutel nog NIET op de server (nooit bewaard) maar wel in deze
 *     browser, dan gaat hij één keer omhoog. Daarna is de server de bron.
 *   - Schrijven gaat via `schrijfInstelling`/`wisInstelling` (of, als de plek
 *     zelf de browser al schrijft, `spiegelInstelling`): localStorage meteen,
 *     de server kort daarna. Lukt dat niet, dan blijft de sleutel als
 *     "onverzonden" gemarkeerd in deze browser, en wint de browser bij de
 *     volgende start (anders zou een oudere serverwaarde je laatste keuze
 *     overschrijven). De serverwaarde die hij dan vervangt (misschien nieuwer,
 *     uit een andere browser) gaat ook naar `vorige`.
 *   - Is de server er niet bij het opstarten (of antwoordt hij niet binnen
 *     1,5 s): localStorage is de reserve en alles werkt zoals vóór B4, maar
 *     deze sessie gaat er niets naar de server (één melding). Zoals bij de
 *     mapping: anders zou een standaardwaarde uit een lege browser het echte
 *     master-rack op de server overschrijven. Bij de volgende start wint de
 *     server weer, en wat je in deze sessie instelde staat dan bij `vorige`.
 *
 * De witte lijst staat in `instellingen-lijst.js` (puur; de server importeert
 * hem). Geen DOM op moduleniveau ook hier: tests laden dit bestand in Node. `haal` (fetch), `opslag` (localStorage) en `meld` komen van buiten;
 * zo is de volgorde server/browser in Node te testen (test/instellingen-opslag.test.mjs).
 */

import { INSTELLING_SLEUTELS, INSTELLING_MAX, isInstelling } from './instellingen-lijst.js';

export { INSTELLING_SLEUTELS, INSTELLING_MAX, isInstelling };

/** In deze browser: welke sleutels nog niet op de server staan (lijst als JSON). */
export const ONVERZONDEN = 'varve.instellingen.onverzonden';

/**
 * In deze browser: waarden die bij het opstarten vervangen werden, zodat er
 * nooit iets zonder kopie verdwijnt. `{ <sleutel>: [{ waarde, tijd, bron }] }`,
 * nieuwste eerst, hooguit VORIGE_MAX per sleutel. `bron`: 'browser' (deze
 * browser had hem, de server won), 'server' (de server had hem, een onverzonden
 * browserwaarde won) of 'herstel' (weggezet door `herstel`).
 */
export const VORIGE = 'varve.instellingen.vorige';
export const VORIGE_MAX = 5;

/** Leesbare naam in een melding. */
const kort = (k) => k.replace(/^varve\./, '');

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
  // Alleen naar de server als hij bij het opstarten gelezen is (de regel van de
  // mapping): anders weten we niet of de browser nieuwer is. Het master-paneel
  // schrijft bij de eerste frame zijn rack weg; met een lege browser en een
  // server die even niet antwoordde, zou dat standaard-rack anders het echte
  // rack op de server overschrijven.
  let gelezen = false;
  let nietGelezenGemeld = false;

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
  const vorige = () => {
    try {
      const v = JSON.parse(opslag?.getItem(VORIGE) || '{}');
      if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
      const uit = {};
      for (const k of INSTELLING_SLEUTELS) {
        const l = Array.isArray(v[k]) ? v[k].filter((x) => x && typeof x.waarde === 'string') : [];
        if (l.length) uit[k] = l;
      }
      return uit;
    } catch (_) { return {}; }
  };
  /** Een waarde die vervangen wordt eerst wegzetten. Gelukt = true. */
  const bewaarVorige = (k, waarde, bron) => {
    if (typeof waarde !== 'string') return false;   // null (niets of gewist): niets te verliezen
    const v = vorige();
    const l = (v[k] || []).filter((x) => x.waarde !== waarde);
    v[k] = [{ waarde, tijd: new Date().toISOString(), bron }, ...l].slice(0, VORIGE_MAX);
    try { opslag?.setItem(VORIGE, JSON.stringify(v)); return !!opslag; } catch (_) {}
    // Vol (quota): dan van elke sleutel alleen de nieuwste.
    try {
      for (const s of Object.keys(v)) v[s] = v[s].slice(0, 1);
      opslag?.setItem(VORIGE, JSON.stringify(v)); return !!opslag;
    } catch (_) { return false; }
  };
  const NIET_GELEZEN = 'instellingen niet van de server gelezen bij het opstarten — wat je deze sessie verandert, blijft alleen in deze browser. '
    + 'Bij de volgende start neemt de server het weer over; je versie staat dan bewaard als vorige (instellingen.vorige() in de console)';

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
      if (!gemeld) gemeld = false !== meld(`instelling ${k} niet op de server bewaard (${err.message}) — staat wel in deze browser`, 'fout');
      return false;
    }
  }

  /** Alleen de server: de plek heeft de browser zelf al geschreven. */
  function spiegel(k, waarde) {
    if (!isInstelling(k) || !haal) return;
    if (!gelezen) {
      if (!nietGelezenGemeld) nietGelezenGemeld = false !== meld(NIET_GELEZEN, 'fout');
      return;
    }
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
   * @returns {{ serverBereikbaar, vanServer: string[], omhoog: string[], bewaard: string[], nietBewaard: string[], fout? }}
   *   `bewaard`: sleutels waarvan een vervangen waarde nu in `vorige` staat.
   *   `nietBewaard`: de kopie lukte niet (localStorage vol); daar bleef de browserwaarde staan.
   */
  async function start() {
    const verslag = { serverBereikbaar: false, vanServer: [], omhoog: [], bewaard: [], nietBewaard: [] };
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
      if (!nietGelezenGemeld) nietGelezenGemeld = false !== meld(`${NIET_GELEZEN} [${verslag.fout}]`, 'fout');
      return verslag;
    }
    verslag.serverBereikbaar = true;
    gelezen = true;
    const wacht = new Set(onverzonden());
    const omhoog = [];
    for (const k of INSTELLING_SLEUTELS) {
      const bewaard = Object.prototype.hasOwnProperty.call(lijst, k);
      const server = bewaard && typeof lijst[k] === 'string' ? lijst[k] : null;
      const lokaal = lees(k);
      if (bewaard) opServer.set(k, server);
      if (wacht.has(k) && !timers.has(k)) {
        // De vorige keer niet aangekomen: de browser is nieuwer dan de server.
        // Maar de serverwaarde kan intussen uit een andere browser komen: die eerst wegzetten.
        if (!bewaard || server !== lokaal) {
          if (bewaard && server !== null && bewaarVorige(k, server, 'server')) verslag.bewaard.push(k);
          omhoog.push(k);
        } else markeer(k, false);
      } else if (bewaard) {
        if (lokaal !== server) {
          // Nooit een afwijkende browserwaarde zonder kopie weggooien.
          if (lokaal === null) zetLokaal(k, server);
          else if (bewaarVorige(k, lokaal, 'browser')) { verslag.bewaard.push(k); zetLokaal(k, server); }
          else verslag.nietBewaard.push(k);   // kopie lukte niet (localStorage vol): de browserwaarde blijft staan
        }
        verslag.vanServer.push(k);
      } else if (lokaal !== null) {
        omhoog.push(k);   // lege server, gevulde browser: één keer omhoog
      }
    }
    for (const k of omhoog) {
      markeer(k, true);
      if (await stuur(k, lees(k))) verslag.omhoog.push(k);
    }
    if (verslag.bewaard.length) {
      meld(`instellingen bijgewerkt bij het opstarten: ${verslag.bewaard.map(kort).join(', ')} — de vervangen versie staat bewaard `
        + `(instellingen.vorige() in de console; terugzetten: instellingen.herstel('<sleutel>') en herladen)`);
    }
    if (verslag.nietBewaard.length) {
      meld(`instellingen: ${verslag.nietBewaard.map(kort).join(', ')} NIET van de server genomen — de opslag van deze browser is vol, `
        + 'dus er kon geen kopie van je versie bij; die blijft staan (de server houdt de zijne)', 'fout');
    }
    return verslag;
  }

  /**
   * Een bewaarde vorige waarde terugzetten: in de browser, en op de server als
   * die bij het opstarten gelezen is. Wat er nu staat gaat eerst zelf naar
   * `vorige` (dus terug te draaien). De panelen lezen hun sleutel bij het
   * opstarten: daarna herladen.
   *
   * @returns {Promise<{ ok, opServer?, fout? }>}
   */
  async function herstel(k, i = 0) {
    if (!isInstelling(k)) return { ok: false, fout: 'onbekende instelling' };
    const terug = vorige()[k]?.[i];
    if (!terug) return { ok: false, fout: `geen vorige waarde ${i} voor ${k}` };
    const nu = lees(k);
    if (nu !== null && nu !== terug.waarde && !bewaarVorige(k, nu, 'herstel')) {
      return { ok: false, fout: 'geen kopie te maken van wat er nu staat (opslag vol): niets veranderd' };
    }
    zetLokaal(k, terug.waarde);
    if (!gelezen || !haal) return { ok: true, opServer: false };
    clearTimeout(timers.get(k)); timers.delete(k);
    markeer(k, true);
    return { ok: true, opServer: await stuur(k, terug.waarde) };
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

  return { start, schrijf, wis, spiegel, klaar, onverzonden, vorige, herstel };
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
// Meldingen van vóór `window.meld` (app.js zet die pas na startInstellingen):
// wachten tot `toonInstellingMeldingen()`, niet stilletjes weg.
const uitgesteld = [];
const browserMeld = (...a) => {
  if (typeof globalThis.meld === 'function') { globalThis.meld(...a); return true; }
  if (uitgesteld.length >= 10) return false;
  uitgesteld.push(a);
  return true;
};
function deBrowser() {
  if (!browser) {
    let opslag = null;
    try { opslag = globalThis.localStorage ?? null; } catch (_) {}
    browser = maakInstellingenOpslag({
      haal: inBrowser() && typeof globalThis.fetch === 'function' ? (...a) => globalThis.fetch(...a) : null,
      opslag,
      meld: browserMeld,
    });
  }
  return browser;
}

/** app.js: vóór de engine en de panelen. Gooit nooit; zonder server blijft de browser de bron. */
export const startInstellingen = () => deBrowser().start();
/** app.js, direct na `window.meld = meld`: wat startInstellingen te melden had. */
export const toonInstellingMeldingen = () => { for (const a of uitgesteld.splice(0)) browserMeld(...a); };
/** Console (`instellingen.vorige()`): de bij het opstarten vervangen waarden van deze browser. */
export const vorigeInstellingen = () => deBrowser().vorige();
/** Console (`instellingen.herstel('varve.master.rack')`): een vorige waarde terug, daarna herladen. */
export const herstelInstelling = (k, i = 0) => deBrowser().herstel(k, i);
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
