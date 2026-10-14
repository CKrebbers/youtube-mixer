import { DECK_IDS } from '../engine/engine.js';
import { trackVanDeck } from '../control/actions.js';
import { meld } from './meldingen.js';
import { leesWeg } from '../lib/antwoord.js';

/*
 * Sampler-pads bij het nummer. Laad je een nummer, dan komen zijn bewaarde
 * pads als herinnering op de sampler: één klik op die (lege) pad knipt het
 * stuk opnieuw van schijf. Een pad die je vult van een library-nummer wordt
 * bewaard; shift op een lege, bewaarde pad vergeet hem.
 *
 * `deckTrack` (in `staat`) zegt welk library-nummer er op een track staat;
 * een los bestand of de demo heeft er geen, en dan wordt er niets bewaard.
 */
export function opzetSamplerOpslag({ engine, staat }) {
  const { deckTrack } = staat;
  // Tijdens terugspelen (logboek.js) niets naar de library: de pads van
  // toen horen niet over die van nu heen. In het geheugen gewoon wel.
  const nietBewaren = (deckId) => !!staat.terugspeelDecks?.has(deckId);
  const sampler = engine.sampler;
  // Een track die iets anders laadt, neemt zijn herinneringen mee weg.
  for (const id of DECK_IDS) {
    engine.deck(id).on('load', () => {
      sampler.herinneringen.forEach((h, i) => { if (h?.deckId === id) sampler.herinneringen[i] = null; });
    });
  }
  async function haalSamples(deckId, trackId) {
    try {
      const r = await fetch(`/api/library/${trackId}/samples`);
      if (!r.ok) throw new Error(`${r.status}`);
      const { samples } = await r.json();
      if (deckTrack[deckId] !== trackId) return;      // intussen iets anders geladen
      for (const x of samples) {
        sampler.herinneringen[x.pad - 1] = { deckId, van: x.van, tot: x.tot, bpm: x.bpm, tellen: x.tellen, bron: trackVanDeck(deckId) };
      }
      if (samples.length) meld(`${samples.length} bewaarde sampler-pad${samples.length === 1 ? '' : 's'} van track ${trackVanDeck(deckId)} — klik een lege pad om hem terug te halen`);
    } catch (err) { meld(`sampler-pads van dit nummer niet geladen (${err.message})`, 'fout'); }
  }
  sampler.onGevuld = (n, info) => {
    const trackId = deckTrack[info.deckId];
    if (!trackId) return;                               // los bestand of demo: niets te bewaren
    sampler.herinneringen[n] = { ...info, bron: trackVanDeck(info.deckId) };
    if (nietBewaren(info.deckId)) return;
    fetch(`/api/library/${trackId}/samples`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pad: n + 1, van: info.van, tot: info.tot, tellen: info.tellen, bpm: info.bpm }),
    }).then((r) => { leesWeg(r); if (!r.ok) throw new Error(`${r.status}`); })
      .catch((err) => meld(`pad ${n + 1} niet bewaard (${err.message})`, 'fout'));
  };
  sampler.onVergeet = (n, h) => {
    const trackId = deckTrack[h.deckId];
    if (!trackId || nietBewaren(h.deckId)) return;
    fetch(`/api/library/${trackId}/samples/${n + 1}`, { method: 'DELETE' })
      .then((r) => { leesWeg(r); if (!r.ok) throw new Error(`${r.status}`); meld(`pad ${n + 1} vergeten`); })
      .catch((err) => meld(`pad ${n + 1} niet vergeten (${err.message})`, 'fout'));
  };

  return { haalSamples };
}
