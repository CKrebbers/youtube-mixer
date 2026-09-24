import { DECK_IDS } from '../engine/engine.js';

/*
 * Hotcues bij het nummer, zoals de sampler-pads (schema: tabel `hotcues`).
 * Zet of wis je een hotcue op een library-nummer, dan gaat dat naar de
 * server; laad je het nummer later opnieuw (op welke track ook), dan staan
 * ze er weer. Een los bestand of de demo heeft geen nummer: niets bewaard.
 *
 * De engine kent geen library (regel 1): het deck meldt 'hotcue' en heeft
 * `restoreHotcues()`, en deze module doet de rest.
 *
 * Welk nummer er op een track staat houdt deze module ZELF bij, niet via
 * `staat.deckTrack`: dat wordt pas gezet als het laden helemaal klaar is
 * (na de golfvorm), terwijl de nieuwe track al hotcues kan krijgen zodra het
 * deck 'load' meldt. Met deckTrack ging een hotcue in dat gat naar het VORIGE
 * nummer. Hier: 'load' = nog onbekend; wat je dan zet wacht tot `haalHotcues`
 * zegt welk nummer het is.
 *
 * Verzoeken gaan één voor één (een rij): zetten en meteen weer wissen mag bij
 * de server niet in omgekeerde volgorde aankomen, anders komt de hotcue terug.
 *
 * `haal` en `meld` komen van buiten, zodat engine.test dit met de echte
 * engine kan narekenen zonder browser.
 */
export function opzetHotcueOpslag({ engine, meld = () => {}, haal = (...a) => fetch(...a) }) {
  const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak()]));
  const nummer = perDeck(() => null);          // library-id, of null (leeg, los, demo, nog aan het laden)
  const aangeraakt = perDeck(() => new Set()); // plekken die je sinds het laden zelf zette of wiste
  const wacht = perDeck(() => new Set());      // ... terwijl het nummer nog onbekend was
  let rij = Promise.resolve();

  const pad = (trackId) => `/api/library/${encodeURIComponent(trackId)}/hotcues`;

  function bewaar(trackId, i, tijd) {
    const nr = i + 1;
    rij = rij.then(async () => {
      try {
        const r = tijd === null
          ? await haal(`${pad(trackId)}/${nr}`, { method: 'DELETE' })
          : await haal(pad(trackId), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nr, tijd }),
          });
        if (!r.ok) throw new Error(`${r.status}`);
      } catch (err) {
        meld(`hotcue ${nr} niet ${tijd === null ? 'gewist' : 'bewaard'} bij het nummer (${err.message})`, 'fout');
      }
    });
    return rij;
  }

  for (const id of DECK_IDS) {
    const d = engine.deck(id);
    d.on('load', () => {
      nummer[id] = null;
      aangeraakt[id].clear();
      wacht[id].clear();
    });
    d.on('hotcue', ({ i }) => {
      aangeraakt[id].add(i);
      if (nummer[id]) bewaar(nummer[id], i, d.hotcues[i]);
      else wacht[id].add(i);
    });
  }

  /**
   * Na het laden van een library-nummer: vanaf nu hoort deze track bij dat
   * nummer. Wat je in de tussentijd zette gaat alsnog naar de server; dan de
   * bewaarde hotcues ophalen en terugzetten, behalve op plekken die je zelf
   * al aanraakte (jouw handeling wint).
   */
  async function haalHotcues(deckId, trackId) {
    const d = engine.deck(deckId);
    nummer[deckId] = trackId;
    for (const i of wacht[deckId]) bewaar(trackId, i, d.hotcues[i]);
    wacht[deckId].clear();
    try {
      const r = await haal(pad(trackId));
      if (!r.ok) throw new Error(`${r.status}`);
      const { hotcues } = await r.json();
      if (nummer[deckId] !== trackId) return;      // intussen iets anders geladen
      const tijden = d.hotcues.map(() => null);
      for (const h of hotcues || []) {
        const i = h.nr - 1;
        if (i >= 0 && i < tijden.length && !aangeraakt[deckId].has(i)) tijden[i] = h.tijd;
      }
      d.restoreHotcues(tijden);
    } catch (err) {
      meld(`hotcues van dit nummer niet geladen (${err.message})`, 'fout');
    }
  }

  /** Voor tests: klaar als alle verzoeken tot nu toe de deur uit en terug zijn. */
  const rust = () => rij;

  return { haalHotcues, rust };
}
