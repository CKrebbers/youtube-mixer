/*
 * Stems als tekst en als stand (docs/STEMS.md §4): de cel in de library, de
 * STEMS-rij, het teken in de kolomkop en de tegel in de Controlekamer.
 *
 * Puur: geen DOM, geen fetch. De bus komt binnen als een lees-functie (`read`
 * uit actions.js), de wachtrij als de lijst opdrachten van GET /api/stems.
 * Zo is alles in Node te testen (library-lijst, spiegel, controle).
 */

/** De vijf stem-namen van de bus (`track.N.stem.<s>`), met hun naam op het scherm. */
export const STEM_NAAM = { vocals: 'zang', inst: 'rest', drums: 'drums', bass: 'bas', other: 'overig' };
export const STEMMEN = Object.keys(STEM_NAAM);

/**
 * Volgorde op het scherm. Twee: zang en rest. Vier: drums, bas, overig, zang
 * (de volgorde van Demucs), en `inst` als GROEPSknop erachter: bij vier werkt
 * hij op drums, bas en overig samen (contract §3).
 */
export const VOLGORDE = { 2: ['vocals', 'inst'], 4: ['drums', 'bass', 'other', 'vocals', 'inst'] };

/** Uitleg per stem, voor de tooltip. `aantal` = de stand van de track. */
export function stemUitleg(s, aantal) {
  if (s === 'inst') return aantal === 4 ? 'rest: drums, bas en overig samen (groepsknop)' : 'rest: alles behalve de zang';
  return STEM_NAAM[s] ?? s;
}

/**
 * Hoeveel stems de track op de bus heeft: 4, 2 of 0. Uit read(): een stem die
 * in deze stand niet bestaat leest null (contract §3: drums bestaat alleen bij
 * vier). Ontbreken de stem-actions helemaal (vóór de integratie met de
 * engine), dan leest alles null: 0, "niet van toepassing", niets crasht.
 */
export function aantalOpBus(lees, nr) {
  if (lees(`track.${nr}.stem.drums`) !== null) return 4;
  if (lees(`track.${nr}.stem.vocals`) !== null) return 2;
  return 0;
}

export const isOpen = (o) => o?.status === 'wacht' || o?.status === 'bezig';

/** Hoe "laat" een opdracht is, om de laatste te kiezen (klaar, dan begonnen). */
const moment = (o) => Number(o?.klaar ?? o?.begon ?? 0) || 0;

/**
 * De opdracht die voor een nummer telt: een OPEN opdracht (bezig, wacht) gaat
 * voor; anders de laatste die afliep (klaar, fout, geannuleerd).
 */
export function opdrachtVoor(opdrachten, trackId) {
  let beste = null;
  for (const o of opdrachten || []) {
    if (!o || o.track !== trackId) continue;
    if (!beste) { beste = o; continue; }
    const a = isOpen(o), b = isOpen(beste);
    if (a !== b) { if (a) beste = o; continue; }
    if (moment(o) >= moment(beste)) beste = o;
  }
  return beste;
}

/** Map track-id -> opdracht voor de hele lijst in één keer (de library tekent veel rijen). */
export function perNummer(opdrachten) {
  const uit = new Map();
  for (const o of opdrachten || []) {
    if (!o?.track || uit.has(o.track)) continue;
    uit.set(o.track, opdrachtVoor(opdrachten, o.track));
  }
  return uit;
}

/** 0..1 als hele procenten, zonder ooit 100% te zeggen zolang hij nog bezig is. */
const procent = (v) => `${Math.min(99, Math.max(0, Math.floor((Number(v) || 0) * 100)))}%`;

/**
 * De cel in de library. `{ tekst, soort, titel, knoppen }`, knoppen als
 * `{ doe: 'splits' | 'annuleer', aantal?, opdracht?, titel, uit? }`.
 *
 * - open (wacht, bezig): "wacht" of "42%", met × (annuleren);
 * - stems: "2" of "4"; bij twee een knop 4 (opnieuw splitsen in vier, vervangt de twee);
 * - fout: "fout", de reden in de tooltip, knoppen 2 · 4 (opnieuw proberen);
 * - niets: "—", knoppen 2 · 4.
 * Een opdracht die net klaar is terwijl de rij nog van vóór de split is, telt
 * al als stems (de lijst ververst iets later). `uit` = de splitter ontbreekt
 * (met reden): dan staan de knoppen uit, met die reden in de tooltip.
 */
export function stemsCel(track, opdracht = null, { uit = null } = {}) {
  const heeft = Number(track?.stems?.aantal) || (opdracht?.status === 'klaar' ? Number(opdracht.aantal) || 0 : 0);
  const splits = (aantal, titel) => ({ doe: 'splits', aantal, titel: uit ? `kan niet splitsen: ${uit}` : titel, uit: !!uit });
  if (isOpen(opdracht)) {
    const bezig = opdracht.status === 'bezig';
    return {
      tekst: bezig ? procent(opdracht.voortgang) : 'wacht',
      soort: bezig ? 'bezig' : 'wacht',
      titel: `${bezig ? 'wordt gesplitst' : 'wacht op splitsen'} in ${opdracht.aantal}${heeft ? ` (nu nog ${heeft})` : ''}`,
      knoppen: [{ doe: 'annuleer', opdracht: opdracht.id,
        titel: bezig ? 'splitsen stoppen (tweede klik: het werk tot nu toe gaat weg)' : 'uit de rij halen' }],
    };
  }
  if (heeft) {
    return {
      tekst: String(heeft), soort: 'stems',
      titel: heeft === 4 ? '4 stems: drums · bas · overig · zang' : '2 stems: zang · rest',
      knoppen: heeft === 2 ? [splits(4, 'opnieuw splitsen in vier (drums · bas · overig · zang); vervangt de twee')] : [],
    };
  }
  if (opdracht?.status === 'fout') {
    return {
      tekst: 'fout', soort: 'fout', titel: `splitsen mislukt: ${opdracht.fout || 'geen reden gegeven'}`,
      knoppen: [splits(2, 'opnieuw proberen: zang en rest'), splits(4, 'opnieuw proberen: in vier')],
    };
  }
  return {
    tekst: '—', soort: 'geen', titel: 'geen stems',
    knoppen: [splits(2, 'splitsen in zang en rest'), splits(4, 'splitsen in vier: drums · bas · overig · zang')],
  };
}

/**
 * Wat de STEMS-rij laat zien voor de track met focus.
 * @param o.aantal       stems op de bus (aantalOpBus)
 * @param o.geladen      staat er iets op de track
 * @param o.nummer       library-id, of null (los bestand, demo)
 * @param o.opdracht     opdrachtVoor(...) van dat nummer, of null
 * @param o.mislukt      reden als stems.wav bij het laden niet lukte (dan speelt audio.wav)
 * @param o.beschikbaar  false = de splitter ontbreekt (`reden`)
 * Geeft `{ soort, tekst, splits?, uit?, annuleer?, bezig?, voortgang? }`.
 */
export function rijStand({ aantal = 0, geladen = false, nummer = null, opdracht = null, mislukt = null,
  beschikbaar = null, reden = null } = {}) {
  if (aantal) return { soort: 'stems', tekst: aantal === 4 ? '4 stems' : '2 stems' };
  if (!geladen) return { soort: 'leeg', tekst: 'geen nummer op deze track' };
  if (!nummer) return { soort: 'los', tekst: 'geen stems — alleen nummers uit de library worden gesplitst' };
  if (mislukt) return { soort: 'mislukt', tekst: `stems niet geladen (${mislukt}) — je hoort audio.wav; laad het nummer opnieuw` };
  if (isOpen(opdracht)) {
    const bezig = opdracht.status === 'bezig';
    return {
      soort: 'open', bezig, annuleer: opdracht.id, voortgang: bezig ? Math.min(1, Math.max(0, Number(opdracht.voortgang) || 0)) : null,
      tekst: bezig ? `splitsen in ${opdracht.aantal}: ${procent(opdracht.voortgang)}` : `wacht op splitsen in ${opdracht.aantal}`,
    };
  }
  if (opdracht?.status === 'klaar') {
    return { soort: 'herladen', tekst: `${opdracht.aantal} stems staan klaar — laad het nummer opnieuw om ze te horen` };
  }
  const uit = beschikbaar === false ? `de splitter ontbreekt${reden ? `: ${reden}` : ''}` : null;
  if (opdracht?.status === 'fout') {
    return { soort: 'fout', tekst: `splitsen mislukt: ${opdracht.fout || 'geen reden gegeven'}`, splits: true, uit };
  }
  return { soort: 'geen', tekst: 'geen stems', splits: true, uit };
}

/**
 * Het kleine teken in de kolomkop: `{ tekst, soort, titel }` of null.
 * S2/S4 = de track speelt met stems; gestippeld = ze staan klaar maar zijn
 * er na het laden bij gekomen (herladen geeft ze); S! = stems.wav laden
 * mislukte, je hoort audio.wav.
 */
export function kolomTeken({ aantal = 0, nummer = null, opdracht = null, mislukt = null } = {}) {
  if (aantal) {
    return { tekst: `S${aantal}`, soort: 'stems',
      titel: aantal === 4 ? '4 stems: drums · bas · overig · zang (STEMS-rij)' : '2 stems: zang · rest (STEMS-rij)' };
  }
  if (!nummer) return null;
  if (mislukt) return { tekst: 'S!', soort: 'mislukt', titel: `stems niet geladen (${mislukt}) — je hoort audio.wav` };
  if (opdracht?.status === 'klaar') {
    return { tekst: `S${opdracht.aantal}`, soort: 'herladen',
      titel: `${opdracht.aantal} stems staan klaar — laad het nummer opnieuw om ze te horen` };
  }
  return null;
}

/**
 * De tegel in de Controlekamer: `{ naam, licht, waarde, sub }` zoals de
 * andere tegels. `antwoord` = GET /api/stems, of `{ ontbreekt: true }` als
 * de server die route niet kent (404), of null (nog niets / server weg).
 */
export function stemsTegel(antwoord) {
  const naam = 'Stems';
  if (!antwoord) return { naam, licht: 'uit', waarde: '…', sub: '' };
  if (antwoord.ontbreekt) return { naam, licht: 'uit', waarde: 'onbekend', sub: 'deze server kent /api/stems niet' };
  const lijst = Array.isArray(antwoord.opdrachten) ? antwoord.opdrachten : [];
  const bezig = lijst.filter((o) => o?.status === 'bezig');
  const wacht = lijst.filter((o) => o?.status === 'wacht');
  if (antwoord.beschikbaar === false) {
    return { naam, licht: 'fout', waarde: 'splitter ontbreekt', sub: antwoord.reden || 'geen reden gegeven' };
  }
  if (bezig.length || wacht.length) {
    const b = bezig[0];
    return { naam, licht: 'half', waarde: `${bezig.length} bezig, ${wacht.length} wacht`,
      sub: b ? `${b.titel || b.track} · in ${b.aantal} · ${procent(b.voortgang)}` : 'wacht op de splitter' };
  }
  const fout = lijst.filter((o) => o?.status === 'fout').sort((a, c) => moment(c) - moment(a))[0];
  return { naam, licht: fout ? 'half' : 'ok', waarde: 'leeg',
    sub: fout ? `mislukt: ${fout.titel || fout.track} (${fout.fout || 'geen reden'})` : 'splitter klaar' };
}
