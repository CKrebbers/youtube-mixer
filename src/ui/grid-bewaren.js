/**
 * Het beatgrid bewaren bij het NUMMER (POST /api/library/<id>/grid), zodra je
 * het bewerkt hebt (14 okt, docs/BEATGRID.md §12). Geen DOM: laden.js zet hem
 * op, test/grid-bediening.test.mjs meet hem met een nep-fetch.
 *
 * Vroeger keek een timer elke 1,5 s of er iets veranderd was: een bewerking
 * stond gemiddeld 0,75 s en hooguit 1,5 s alleen op het deck (herladen of een
 * crash in dat gat: weg). Nu luistert hij naar de decks: verandert het grid
 * (`deck.gridVersie`), dan bewaart hij na `rust` ms zonder nieuwe bewerking,
 * en tijdens een lange reeks (een encoder die blijft draaien) toch elke
 * `uiterlijk` ms. De oude timer blijft als vangnet (een mislukte POST komt zo
 * vanzelf opnieuw).
 *
 * Na elke geslaagde POST: `naBewaard(trackId, json, id)`. laden.js werkt daarmee
 * de rij in de library bij (anders kreeg wie het nummer daarna opnieuw laadde
 * het grid van VÓÓR de bewerking), ook als de track intussen iets anders laadde:
 * de rij hoort bij het nummer, niet bij het deck.
 *
 * Pas als de REEKS klaar is (`rust` ms geen bewerking meer en alles bewaard):
 * `naReeks(trackId, json, id)`. Daarmee krijgen de andere tracks met hetzelfde
 * nummer het nieuwe grid, één keer, en niet elke seconde een tussenstand van
 * een encoder die nog draait (sync, sampler en echo herankeren op elke wissel).
 *
 * Elk antwoord wordt gelezen (`leesWeg`, ook bij een fout: Chrome houdt een
 * ongelezen antwoord vast, docs/WINST.md punt 1), en een POST die na
 * `tijdslimiet` ms nog niets zei wordt afgebroken: één hangend verzoek mag het
 * bewaren niet stilleggen (er loopt één ronde tegelijk).
 */
import { leesWeg } from '../lib/antwoord.js';

export const RUST_MS = 250;
export const UITERLIJK_MS = 1000;
export const TIJDSLIMIET_MS = 5000;

export function maakGridBewaarder({ engine, decks, deckTrack, terugspeelDecks = new Set(), haal = (...a) => fetch(...a),
  naBewaard = () => {}, naReeks = () => {}, rust = RUST_MS, uiterlijk = UITERLIJK_MS, tijdslimiet = TIJDSLIMIET_MS,
  klok = () => performance.now(), wekker = { zet: (f, ms) => setTimeout(f, ms), wis: (t) => clearTimeout(t) } }) {
  const bewaard = Object.fromEntries(decks.map((id) => [id, null]));   // wat er per track het laatst bewaard (of geladen) is
  const versie = Object.fromEntries(decks.map((id) => [id, -1]));      // gridVersie die we al zagen
  let timer = null, eersteWijziging = null, laatsteWijziging = -Infinity, bezig = null;
  const inReeks = new Map();   // deck -> nummer waarvan het grid in deze reeks veranderde
  const tekstVan = (id) => { const g = engine.deck(id).grid; return g ? JSON.stringify(g.toJSON()) : 'null'; };

  async function ronde() {
    // Eén ronde tegelijk; komt er intussen een verzoek, dan nog één ronde erachteraan.
    if (bezig) { bezig.nogEens = true; return bezig.klaar; }
    const ronde = { nogEens: false, klaar: null };
    bezig = ronde;
    ronde.klaar = (async () => {
      do {
        ronde.nogEens = false;
        for (const id of decks) {
          const trackId = deckTrack[id];
          if (!trackId || terugspeelDecks.has(id)) continue;   // terugspelen: het grid van toen niet bewaren
          const tekst = tekstVan(id);
          if (tekst === bewaard[id]) continue;
          bewaard[id] = tekst;
          try {
            const res = await haal(`/api/library/${trackId}/grid`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"grid":${tekst}}`,
              signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(tijdslimiet) : undefined,
            });
            await leesWeg(res);   // ook het foutpad: een ongelezen antwoord houdt Chrome vast
            // fetch gooit niet bij een 404. Zonder deze controle denkt hij dat het
            // gelukt is en probeert hij het nooit meer.
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            naBewaard(trackId, JSON.parse(tekst), id);
          } catch (err) {
            if (deckTrack[id] === trackId && bewaard[id] === tekst) bewaard[id] = null;   // de volgende ronde opnieuw
            console.warn('[grid] niet bewaard:', err.message);
          }
        }
      } while (ronde.nogEens);
      bezig = null;
    })();
    return ronde.klaar;
  }

  /** Een ronde, en is de reeks daarna klaar (rust en alles bewaard), dan `naReeks`. */
  async function bewaar() {
    await ronde();
    if (timer !== null || bezig || !inReeks.size) return;
    const over = rust - (klok() - laatsteWijziging);
    if (over > 0) { timer = wekker.zet(() => { timer = null; bewaar(); }, over); return; }   // nog geen rust
    for (const [id, trackId] of inReeks) {
      if (deckTrack[id] !== trackId) { inReeks.delete(id); continue; }   // intussen iets anders geladen
      if (bewaard[id] !== tekstVan(id)) continue;                         // nog niet bewaard: het vangnet probeert opnieuw
      inReeks.delete(id);
      naReeks(trackId, JSON.parse(bewaard[id]), id);
    }
  }

  /** Een deck veranderde: is het een nieuwe gridversie, dan straks bewaren. */
  function gezien(id) {
    const d = engine.deck(id);
    if (!d || d.gridVersie === versie[id]) return;
    versie[id] = d.gridVersie;
    if (!deckTrack[id] || terugspeelDecks.has(id)) return;
    if (tekstVan(id) === bewaard[id]) return;         // terug op wat er al staat (↶, of van een andere track overgenomen)
    const nu = klok();
    eersteWijziging ??= nu;
    laatsteWijziging = nu;
    inReeks.set(id, deckTrack[id]);
    if (timer !== null) wekker.wis(timer);
    const wacht = Math.max(0, Math.min(rust, uiterlijk - (nu - eersteWijziging)));
    timer = wekker.zet(() => { timer = null; eersteWijziging = null; bewaar(); }, wacht);
  }
  for (const id of decks) engine.deck(id)?.on?.('change', () => gezien(id));

  return {
    bewaard, bewaar,
    /** Wat de engine na het laden van een grid maakte telt als bewaard (geen POST bij elk laden). */
    alsBewaard(id) { bewaard[id] = tekstVan(id); versie[id] = engine.deck(id).gridVersie; inReeks.delete(id); },
    vergeet(id) { bewaard[id] = null; },
  };
}
