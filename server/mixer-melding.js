/**
 * De mixer meldt zich bij de server (docs/COMPANION.md, stap 2 van het spoor
 * companion): het tabblad met de Web Lock POST hooguit eens per 900 ms wat het
 * ook aan de Controlekamer meldt (`maakStatus` in src/ui/status-zender.js) naar
 * `POST /api/mixer`; iPad en iPhone lezen `GET /api/mixer`. De server bewaart
 * alleen de laatste melding, in het geheugen. Niets op schijf, niets uitvoeren.
 *
 * Puur: geen HTTP, geen klok van zichzelf. server/index.js hangt het aan de
 * routes; test/mixer-melding.test.mjs toetst het los.
 *
 * Schrijven mag alleen vanaf deze Mac (`vanDezeMac`): Host localhost,
 * 127.0.0.1 of [::1] op de eigen poort, Origin ontbreekt of is precies die
 * oorsprong, en geen kop die een proxy zet (`x-forwarded-for`,
 * `tailscale-user-login`). AANNAME, niet nagekeken op een echte tailnet:
 * `tailscale serve` zet die koppen. Lezen mag iedereen die al door de
 * gewone Host/Origin-regels van de server komt.
 */

/** De tracks. Gelijk aan DECK_IDS in src/engine/engine.js (de test legt ze naast elkaar): de server laadt de engine niet. */
export const TRACKS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
/** Een melding is hooguit zo groot (bytes). Acht tracks met alles erop: zie test/controle.test.mjs. */
export const MAX_BYTES = 16 * 1024;
/**
 * Twee tab-id's die binnen dit venster OM BEURTEN melden = twee mixers open
 * (localhost en 127.0.0.1, elk met een eigen Web Lock). Een id die stopte
 * voordat de andere begon is één mixer die herladen werd (app.js maakt per
 * laden een nieuwe TAB_ID), of een tweede tabblad dat de Web Lock overnam:
 * geen alarm (review ronde 2, fix 2).
 */
export const TWEE_MS = 5000;
/** Zo lang (ms) na een GET /api/mixer telt er een kijker (AR16): het antwoord op de POST zegt het de mixer. */
export const KIJK_MS = 10_000;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);

/** Is dit een melding van de mixer? Alles wat de companion leest moet erin kloppen; de rest mag ontbreken. */
export function isMelding(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (!eindig(b.t)) return false;
  if (typeof b.tab !== 'string' || b.tab.length < 4 || b.tab.length > 64) return false;
  if (!Array.isArray(b.tracks) || b.tracks.length > TRACKS.length) return false;
  for (const t of b.tracks) {
    if (!t || typeof t !== 'object' || Array.isArray(t) || !TRACKS.includes(t.id)) return false;
    for (const k of ['positie', 'duur', 'rate']) if (t[k] != null && !eindig(t[k])) return false;
  }
  return true;
}

const LOKAAL = /^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/;

/**
 * Komt dit verzoek van de mixer op deze Mac? `req` is een IncomingMessage (of
 * iets met `headers`); `poort` de eigen poort.
 */
export function vanDezeMac(req, poort) {
  const h = req?.headers ?? {};
  const host = String(h.host ?? '').toLowerCase();
  const m = LOKAAL.exec(host);
  if (!m || Number(m[2]) !== Number(poort)) return false;
  if (h['x-forwarded-for'] !== undefined || h['tailscale-user-login'] !== undefined) return false;
  if (h.origin === undefined) return true;
  return String(h.origin).toLowerCase() === `http://${host}`;
}

/**
 * De laatste melding, en wie er de laatste TWEE_MS meldde: per tab-id de laatste
 * keer (ms, voor het venster) en het volgnummer van zijn eerste en laatste
 * melding (voor "om beurten": de volgorde van binnenkomst, ook als twee
 * meldingen in dezelfde milliseconde vallen).
 */
export class MixerStand {
  constructor() {
    this.melding = null;
    this.ontvangen = null;      // ms volgens de klok van de server
    this.tabs = new Map();      // tab-id -> { laatst (ms), eersteNr, laatsteNr }
    this.nr = 0;                // telt elke melding
    this.gekeken = -Infinity;   // de laatste GET (ms), voor `kijker` (AR16)
  }

  /** Iemand las de stand (GET /api/mixer). */
  kijk(nu) { this.gekeken = nu; }
  /** Las iemand de laatste KIJK_MS? Dan stuurt de mixer elke 900 ms, anders elke 4 s (status-zender.js). */
  kijker(nu) { return nu - this.gekeken < KIJK_MS; }

  zet(melding, nu) {
    this.melding = melding;
    this.ontvangen = nu;
    const nr = ++this.nr;
    const t = this.tabs.get(melding.tab);
    if (t) { t.laatst = nu; t.laatsteNr = nr; } else this.tabs.set(melding.tab, { laatst: nu, eersteNr: nr, laatsteNr: nr });
    for (const [tab, x] of this.tabs) if (nu - x.laatst > TWEE_MS) this.tabs.delete(tab);
  }

  /**
   * { leeftijd_ms (null = nog nooit), twee, melding }. `twee`: twee id's die
   * allebei binnen TWEE_MS meldden en elkaar overlappen (elk meldde nog ná de
   * eerste melding van de ander). Herladen = de oude stopt, dan begint de
   * nieuwe: geen overlap, geen alarm.
   */
  lees(nu) {
    const recent = [...this.tabs.values()].filter((x) => nu - x.laatst <= TWEE_MS);
    const twee = recent.some((a) => recent.some((b) => a !== b && a.laatsteNr > b.eersteNr && b.laatsteNr > a.eersteNr));
    return {
      leeftijd_ms: this.ontvangen === null ? null : Math.max(0, nu - this.ontvangen),
      twee,
      melding: this.melding,
    };
  }
}
