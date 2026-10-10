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
/** Twee verschillende tab-id's binnen dit venster = twee mixers open (localhost en 127.0.0.1?). */
export const TWEE_MS = 5000;

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

/** De laatste melding, en wie er de laatste TWEE_MS meldde. */
export class MixerStand {
  constructor() {
    this.melding = null;
    this.ontvangen = null;      // ms volgens de klok van de server
    this.tabs = new Map();      // tab-id -> laatst gezien (ms)
  }

  zet(melding, nu) {
    this.melding = melding;
    this.ontvangen = nu;
    this.tabs.set(melding.tab, nu);
    for (const [tab, t] of this.tabs) if (nu - t > TWEE_MS) this.tabs.delete(tab);
  }

  /** { leeftijd_ms (null = nog nooit), twee, melding } */
  lees(nu) {
    let recent = 0;
    for (const t of this.tabs.values()) if (nu - t <= TWEE_MS) recent++;
    return {
      leeftijd_ms: this.ontvangen === null ? null : Math.max(0, nu - this.ontvangen),
      twee: recent >= 2,
      melding: this.melding,
    };
  }
}
