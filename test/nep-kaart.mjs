// Een verzonnen varve-kaart.json voor de tests van de kaart en de nacht
// (server/kaart.js, server/nacht.js). Geen test zelf (heet niet *.test.mjs).
// Twaalf nummers die samen elke regel raken: vertrouwd, eigen like, overzet,
// twijfel, set, te lang, zonder video (Spotify), al binnen, nooit gespeeld.
import { writeFileSync } from 'node:fs';

/** Eén nummer met alle velden uit het contract; `over` overschrijft. */
export function nummer(over = {}) {
  const yt = over.youtube_id ?? null;
  const n = {
    sleutel: yt ? `yt:${yt}` : `sp:${over.spotify_id ?? 'x'}`, youtube_id: yt, alternatieven: [],
    spotify_uri: over.spotify_id ? `spotify:track:${over.spotify_id}` : null,
    artiest: 'Artiest', titel: 'Titel', versie: '', kanaal: yt ? 'Artiest - Topic' : null,
    youtube_titel: yt ? 'Artiest - Titel' : null, duur: 240, duur_bron: yt ? 'youtube' : 'spotify_schatting',
    klasse: 'muziek', vorm: 'nummer', beurten: 10, gekozen: 2, overgeslagen: 0, uren: 0.7,
    eerst: '2021-01-01', laatst: '2025-06-01', per_jaar: { 2021: 4, 2025: 6 }, like: null, like_datum: null,
    playlists: [], gekeken: 3, yt_laatst: '2025-05-01', zoek: '',
  };
  delete over.spotify_id;
  Object.assign(n, over);
  n.zoek = `${n.artiest} ${n.titel} ${n.playlists.join(' ')} ${n.kanaal ?? ''}`.toLowerCase();
  return n;
}

export const NUMMERS = [
  // vertrouwd (≥ 25 beurten, video, muziek, nummer), de meeste beurten
  nummer({ youtube_id: 'fourtet0baby', artiest: 'Four Tet', titel: 'Baby', duur: 262, beurten: 41, gekozen: 20, kanaal: 'Four Tet - Topic',
    youtube_titel: 'Four Tet - Baby', playlists: ['Nachtwerk'], eerst: '2019-03-02', laatst: '2025-11-30', per_jaar: { 2019: 12, 2020: 29 }, gekeken: 7 }),
  nummer({ youtube_id: 'binnen000001', artiest: 'Burial', titel: 'Archangel', beurten: 60, like: 'eigen', like_datum: '2023-05-01',
    per_jaar: { 2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 20 } }),   // al in de library (binnen) én evergreen
  nummer({ youtube_id: 'vertrouwd002', artiest: 'Boards of Canada', titel: 'Roygbiv', beurten: 30, like: 'overzet', like_datum: '2020-01-01' }),
  nummer({ youtube_id: 'twijfel00001', artiest: 'Iemand', titel: 'Vlog over muziek', beurten: 50, klasse: 'twijfel' }),
  nummer({ youtube_id: 'eenset000001', artiest: 'Dixon', titel: 'Boiler Room Berlin', beurten: 35, vorm: 'set', duur: 5400 }),
  nummer({ youtube_id: 'telang000001', artiest: 'Klaus Schulze', titel: 'Lange reis', beurten: 28, vorm: null, duur: 1200 }),
  // eigen likes zonder vertrouwd (< 25 beurten)
  nummer({ youtube_id: 'eigenlike001', artiest: 'Élan Vital', titel: 'Zomer', beurten: 12, like: 'eigen', like_datum: '2024-05-01' }),
  nummer({ youtube_id: 'eigenlike002', artiest: 'Zed', titel: 'Alfa', beurten: 20, like: 'eigen', like_datum: '2024-06-01', gekozen: 15 }),  // eigen-keuze (15/20)
  nummer({ youtube_id: 'overzet00001', artiest: 'Overzetter', titel: 'Alleen overgezet', beurten: 3, like: 'overzet', like_datum: '2018-01-01' }),
  nummer({ youtube_id: 'vergeten0001', artiest: 'Oud', titel: 'Vergeten hit', beurten: 40, eerst: '2019-01-01', laatst: '2022-12-01', per_jaar: { 2019: 20, 2020: 20 } }),
  // zonder video (Spotify): eigen like, nooit gespeeld
  nummer({ spotify_id: 'sp0000000001', artiest: 'Four Tet', titel: 'Two Thousand and Seventeen', duur: 300, beurten: 0, like: 'eigen', like_datum: '2024-07-01', gekeken: null, yt_laatst: null }),
  nummer({ spotify_id: 'sp0000000002', artiest: 'Nils Frahm', titel: 'Says', duur: 500, beurten: 18, duur_bron: 'spotify_schatting' }),
];

/** Dezelfde regels als SLIM in kaart.js, maar met de hand geschreven: de test vergelijkt ze. */
export function kratten(nummers = NUMMERS) {
  const s = (f) => nummers.filter(f).map((n) => n.sleutel);
  return [
    { id: 'pl:PLnachtwerk', naam: 'Nachtwerk', soort: 'playlist', bijgewerkt: '2025-11-28', sleutels: ['yt:vertrouwd002', 'yt:fourtet0baby', 'yt:eigenlike001'] },
    { id: 'slim:vertrouwd', naam: 'vertrouwd', soort: 'slim', regel: 'beurten >= 25 en video en klasse muziek en vorm nummer', bijgewerkt: '2026-10-10',
      sleutels: s((n) => n.beurten >= 25 && n.youtube_id && n.klasse === 'muziek' && (n.vorm === 'nummer' || n.vorm == null)) },
    { id: 'slim:vergeten', naam: 'vergeten', soort: 'slim', regel: 'beurten >= 25 vóór 2023 en geen beurt sinds 2024-01-01', bijgewerkt: '2026-10-10',
      sleutels: s((n) => n.beurten >= 25 && n.eerst < '2023' && n.laatst < '2024-01-01') },
    { id: 'slim:evergreens', naam: 'evergreens', soort: 'slim', regel: 'beurten in >= 5 jaren en totaal >= 50', bijgewerkt: '2026-10-10',
      sleutels: s((n) => Object.keys(n.per_jaar).length >= 5 && n.beurten >= 50) },
    { id: 'slim:geliket-nooit-gespeeld', naam: 'geliket, nooit gespeeld', soort: 'slim', regel: 'like = eigen en beurten = 0', bijgewerkt: '2026-10-10',
      sleutels: s((n) => n.like === 'eigen' && !(n.beurten > 0)) },
    { id: 'slim:eigen-keuze', naam: 'eigen keuze', soort: 'slim', regel: 'gekozen >= 10 en gekozen / beurten >= 0,5', bijgewerkt: '2026-10-10',
      sleutels: s((n) => n.gekozen >= 10 && n.beurten > 0 && n.gekozen / n.beurten >= 0.5) },
    { id: 'slim:eigen-likes', naam: 'eigen likes', soort: 'slim', regel: 'like = eigen, op like_datum aflopend', bijgewerkt: '2026-10-10',
      sleutels: nummers.filter((n) => n.like === 'eigen').sort((a, b) => (a.like_datum < b.like_datum ? 1 : -1)).map((n) => n.sleutel) },
    { id: 'slim:proefkrat', naam: 'proefkrat', soort: 'slim', regel: 'de 15 kernnummers van de proefkrat', bijgewerkt: '2026-10-10', sleutels: [] },
  ];
}

/** Schrijft een kaart naar `pad` en geeft het object. */
export function schrijfKaart(pad, { nummers = NUMMERS, gebouwd = '2026-10-10T12:00:00+02:00' } = {}) {
  const j = { versie: 1, gebouwd, bron: 'muziekkaart 0.1.0 (nep)', nummers, kratten: kratten(nummers) };
  writeFileSync(pad, JSON.stringify(j));
  return j;
}
