import { DECK_IDS } from '../engine/engine.js';
import { leesWeg } from '../lib/antwoord.js';

/**
 * Hoe lang (ms) een hotcue-druk vóór het terugzetten nog "vers" is: komt de
 * bewaarde binnen deze tijd terug, dan springt het deck erheen. Normaal is
 * het gat tientallen ms (golfvorm en hotcues van de eigen server); wat later
 * komt, wordt alleen teruggezet.
 */
export const HOTCUE_VERS = 1000;

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
 * Tot de bewaarde hotcues terug zijn ('load' tot het antwoord van de server)
 * is een hotcue die je zet VOORLOPIG (VERBETERINGEN ronde 4). Het deck is na
 * het laden leeg, dus een hotcue indrukken ZET er een, ook als het nummer
 * er op die plek een heeft: een DJ die hotcue 1 indrukt wil naar hotcue 1,
 * en die werd zo stil overschreven. Komt het antwoord binnen:
 *   - bewaard op die plek: de bewaarde wint (jouw zetten valt weg, er gaat
 *     niets naar de server), en is het indrukken nog vers (HOTCUE_VERS) dan
 *     springt het deck erheen: wat het indrukken had gedaan als hij er al was.
 *     Later springen zou de muziek verrassen; dan alleen terugzetten.
 *   - niets bewaard: jouw hotcue blijft en gaat naar de server, zoals altijd.
 * Gezet en weer gewist vóór het antwoord: dat wiste alleen wat jij zette
 * (na het laden staat er verder niets), dus de bewaarde komt gewoon terug.
 * Mislukt het ophalen, dan blijven voorlopige hotcues alleen op het deck:
 * wat er bewaard is weten we dan niet, en overschrijven is precies de fout.
 *
 * Verzoeken gaan één voor één (een rij): zetten en meteen weer wissen mag bij
 * de server niet in omgekeerde volgorde aankomen, anders komt de hotcue terug.
 *
 * `haal` en `meld` komen van buiten, zodat engine.test dit met de echte
 * engine kan narekenen zonder browser.
 */
export function opzetHotcueOpslag({ engine, meld = () => {}, haal = (...a) => fetch(...a), klok = () => performance.now() }) {
  const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak()]));
  const nummer = perDeck(() => null);          // library-id, of null (leeg, los, demo, nog aan het laden)
  const laadNr = perDeck(() => 0);             // telt elke 'load': een laat antwoord hoort bij een vorige laad
  const terug = perDeck(() => false);          // de bewaarde hotcues zijn terug (of er is niets terug te zetten)
  const voorlopig = perDeck(() => new Map());  // plek -> { tijd, om }: gezet vóór het terugzetten
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
        await leesWeg(r);
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
      laadNr[id]++;
      terug[id] = false;
      voorlopig[id].clear();
    });
    d.on('hotcue', ({ i, tijd }) => {
      if (!terug[id]) {
        // Vóór het terugzetten: voorlopig. Wissen kan dan alleen iets zijn
        // wat je zelf net zette (na het laden is het deck leeg).
        if (tijd === null) voorlopig[id].delete(i);
        else voorlopig[id].set(i, { tijd, om: klok() });
        return;
      }
      if (nummer[id]) bewaar(nummer[id], i, d.hotcues[i]);
    });
  }

  /**
   * Na het laden van een library-nummer: vanaf nu hoort deze track bij dat
   * nummer. De bewaarde hotcues ophalen en terugzetten; wat je in de
   * tussentijd zette telt als voorlopig (zie boven): op een plek met een
   * bewaarde wint de bewaarde (en springt het deck erheen als je net
   * drukte), op een lege plek gaat de jouwe alsnog naar de server.
   */
  async function haalHotcues(deckId, trackId) {
    const d = engine.deck(deckId);
    const mijnLaad = laadNr[deckId];
    nummer[deckId] = trackId;
    try {
      const r = await haal(pad(trackId));
      if (!r.ok) throw new Error(`${r.status}`);
      const { hotcues } = await r.json();
      if (laadNr[deckId] !== mijnLaad || nummer[deckId] !== trackId) return;   // intussen iets anders geladen
      const bewaard = d.hotcues.map(() => null);
      for (const h of hotcues || []) {
        const i = h.nr - 1;
        if (i >= 0 && i < bewaard.length && typeof h.tijd === 'number') bewaard[i] = h.tijd;
      }
      // Voorlopig gezet: staat er een bewaarde, dan haalt het deck de jouwe
      // weg en zet de bewaarde terug; anders gaat de jouwe naar de server.
      const nu = klok();
      const vervang = [];
      for (const [i, { tijd, om }] of voorlopig[deckId]) {
        if (bewaard[i] === null) bewaar(trackId, i, tijd);
        else vervang.push({ i, tijd, om });
      }
      voorlopig[deckId].clear();
      for (const { i } of vervang) d.hotcue(i, { del: true });   // nog vóór `terug`: gaat niet naar de server
      terug[deckId] = true;
      const gezet = d.restoreHotcues(bewaard);
      // Een bewaarde tijd die het deck niet wil (buiten de track): dan de jouwe toch.
      for (const v of vervang) {
        if (gezet.includes(v.i)) continue;
        const tijden = d.hotcues.map(() => null);
        tijden[v.i] = v.tijd;
        if (d.restoreHotcues(tijden).length) bewaar(trackId, v.i, v.tijd);
      }
      // Springen naar wat je indrukte, als dat nog vers is; het laatst
      // ingedrukte wint, zoals op het deck zelf.
      const laatste = vervang.filter((v) => gezet.includes(v.i) && nu - v.om <= HOTCUE_VERS)
        .sort((a, b) => a.om - b.om).pop();
      if (laatste) d.hotcue(laatste.i);               // niet leeg meer: springen, meldt geen 'hotcue'
    } catch (err) {
      if (laadNr[deckId] === mijnLaad) {
        // Wat er bewaard is weten we niet: voorlopige hotcues blijven op het
        // deck, maar gaan niet naar de server. Wat je hierna zet wel.
        voorlopig[deckId].clear();
        terug[deckId] = true;
      }
      meld(`hotcues van dit nummer niet geladen (${err.message})`, 'fout');
    }
  }

  /** Voor tests: klaar als alle verzoeken tot nu toe de deur uit en terug zijn. */
  const rust = () => rij;

  return { haalHotcues, rust };
}
