/*
 * De patronen op de server (docs/PATRONEN.md §5), zoals de setplannen
 * (plan-koppeling.js, docs/PLAN.md §3):
 *   - bij het opstarten de set ophalen met zijn versie (patronen/<naam>.json;
 *     de naam onthouden in localStorage, standaard "set");
 *   - na een bewerking bewaren (even wachten, één verzoek tegelijk), met de
 *     versie waarop we verder werkten; een 409 = iemand anders (een ander
 *     tabblad, of Claude die het bestand schreef) was eerder: NIET stil
 *     overschrijven, maar een botsing melden: hun versie laden of de mijne
 *     bewaren;
 *   - elke paar seconden kijken of het bestand van buiten veranderde, en dat
 *     (zonder eigen wijzigingen) live overnemen: wat speelt blijft spelen, met
 *     de nieuwe noten.
 * De engine weet hier niets van: hij meldt 'bewerkt', deze module bewaart.
 * Geen DOM (de meldingen komen van buiten): zo is hij in Node te testen tegen
 * de echte server.
 */
const NAAM_SLEUTEL = 'varve.patronen.set';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
export const KIJK_MS = 3000;
export const WACHT_MS = 600;

export function opzetPatronenOpslag({ engine, haal = (...a) => fetch(...a), elke = (fn, ms) => setInterval(fn, ms),
  later = (fn, ms) => setTimeout(fn, ms), stopLater = (h) => clearTimeout(h), melding = () => {}, naam: setNaam = null }) {
  const pt = engine.patronen;
  const naam = setNaam || lees(NAAM_SLEUTEL) || 'set';
  const url = `/api/patronen/${encodeURIComponent(naam)}`;
  let versie = null;        // de versie op de server waar wij op verder werken
  let geladen = false;      // pas bewaren als we weten wat er staat (anders 409 of overschrijven)
  let vuil = false;         // iets veranderd dat nog niet bewaard is
  let bezig = null;         // een PUT die loopt
  let botsing = null;       // { versie, set } van de server bij een 409
  let fout = null;
  let timer = null;

  async function laad() {
    try {
      const r = await haal(url);
      if (r.status === 404) { versie = null; geladen = true; return; }
      if (!r.ok) throw new Error(`${r.status}`);
      const d = await r.json();
      versie = d.versie;
      geladen = true;
      if (d.set) pt.laadSet(d.set);
      if (d.fouten?.length) melding(`patronen "${naam}": ${d.fouten.slice(0, 2).join('; ')}`, 'info');
    } catch (err) {
      fout = `patronen niet opgehaald (${err.message}) — bewaren staat uit tot herladen`;
      melding(fout, 'fout');
    }
  }

  function plan() {
    if (timer) stopLater(timer);
    timer = later(() => { timer = null; bewaar(); }, WACHT_MS);
  }

  pt.on('bewerkt', () => { vuil = true; plan(); });

  async function bewaar() {
    if (!geladen || botsing || !vuil) return;
    if (bezig) { plan(); return; }
    vuil = false;
    bezig = (async () => {
      const r = await haal(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: pt.set, versie }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) {
        botsing = { versie: d.versie ?? null, set: d.set ?? null };
        vuil = true;
        melding('patronen: iemand anders bewaarde ze intussen (een ander tabblad, of Claude) — kies in de PATROON-rij: hun versie of de jouwe', 'fout');
        return;
      }
      if (!r.ok) throw new Error(d.fout || `${r.status}`);
      versie = d.versie;
      fout = null;
    })().catch((err) => {
      vuil = true;
      fout = `patronen niet bewaard: ${err.message}`;
      melding(fout, 'fout');
    }).finally(() => { bezig = null; });
    return bezig;
  }

  /** Veranderd van buiten (Claude, een ander tabblad)? Zonder eigen wijzigingen: overnemen. */
  async function kijk() {
    if (!geladen || bezig || vuil || botsing) return;
    try {
      const r = await haal(url);
      if (!r.ok) return;
      const d = await r.json();
      if (d.versie && d.versie !== versie && d.set && !vuil && !bezig) {
        versie = d.versie;
        pt.laadSet(d.set);
        melding(`patronen bijgewerkt (de set "${naam}" veranderde op de server)`, 'info');
      }
    } catch (_) {}
  }
  elke(kijk, KIJK_MS);

  /** Botsing: de versie van de server laden (mijn wijzigingen sinds de vorige opslag gaan weg). */
  function hunVersie() {
    if (!botsing) return;
    versie = botsing.versie;
    if (botsing.set) pt.laadSet(botsing.set);
    botsing = null;
    vuil = false;
  }
  /** Botsing: mijn versie bewaren, over die van de server heen (de vorige blijft in .versies). */
  function mijnVersie() {
    if (!botsing) return;
    versie = botsing.versie;
    botsing = null;
    vuil = true;
    return bewaar();
  }

  return {
    laad, bewaar, kijk, hunVersie, mijnVersie,
    stand: () => ({ naam, versie, geladen, vuil: vuil || !!bezig || !!timer, botsing: !!botsing, fout }),
  };
}
