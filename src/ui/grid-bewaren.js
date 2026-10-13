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
 * Na een geslaagde POST: `naBewaard(trackId, json)`. laden.js werkt daarmee de
 * rij in de library bij (anders kreeg wie het nummer daarna opnieuw laadde
 * het grid van VÓÓR de bewerking) en de andere tracks met hetzelfde nummer.
 */
export const RUST_MS = 250;
export const UITERLIJK_MS = 1000;

export function maakGridBewaarder({ engine, decks, deckTrack, terugspeelDecks = new Set(), haal = (...a) => fetch(...a),
  naBewaard = () => {}, rust = RUST_MS, uiterlijk = UITERLIJK_MS, klok = () => performance.now() }) {
  const bewaard = Object.fromEntries(decks.map((id) => [id, null]));   // wat er per track het laatst bewaard (of geladen) is
  const versie = Object.fromEntries(decks.map((id) => [id, -1]));      // gridVersie die we al zagen
  let timer = null, eersteWijziging = null, bezig = null;
  const tekstVan = (id) => { const g = engine.deck(id).grid; return g ? JSON.stringify(g.toJSON()) : 'null'; };

  async function bewaar() {
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
            });
            // fetch gooit niet bij een 404. Zonder deze controle denkt hij dat het
            // gelukt is en probeert hij het nooit meer.
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            if (deckTrack[id] === trackId) naBewaard(trackId, JSON.parse(tekst), id);
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

  /** Een deck veranderde: is het een nieuwe gridversie, dan straks bewaren. */
  function gezien(id) {
    const d = engine.deck(id);
    if (!d || d.gridVersie === versie[id]) return;
    versie[id] = d.gridVersie;
    if (!deckTrack[id] || terugspeelDecks.has(id)) return;
    const nu = klok();
    eersteWijziging ??= nu;
    clearTimeout(timer);
    const wacht = Math.max(0, Math.min(rust, uiterlijk - (nu - eersteWijziging)));
    timer = setTimeout(() => { timer = null; eersteWijziging = null; bewaar(); }, wacht);
  }
  for (const id of decks) engine.deck(id)?.on?.('change', () => gezien(id));

  return {
    bewaard, bewaar,
    /** Wat de engine na het laden van een grid maakte telt als bewaard (geen POST bij elk laden). */
    alsBewaard(id) { bewaard[id] = tekstVan(id); versie[id] = engine.deck(id).gridVersie; },
    vergeet(id) { bewaard[id] = null; },
  };
}
