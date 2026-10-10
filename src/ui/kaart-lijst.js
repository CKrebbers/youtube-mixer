import { fmtTime } from '../lib/emitter.js';
import { esc } from './dom.js';
import { PAGINA, datumKort } from './library-lijst.js';

/*
 * De muziekkaart als lijst in het library-paneel (tab "kaart"): puur rekenwerk.
 *
 * De kaart is een ZOEKLAAG (0 bytes per nummer, scratchpad CONTRACT-KAART.md):
 * 18.763 rijen die de server pagineert en sorteert (GET /api/kaart/nummers),
 * getekend met dezelfde virtuele lijst als de library (library-lijst.js:
 * zichtbaar, PaginaCache, kopHtml, cellenHtml). Hier staan alleen de dingen
 * die van de KAART zijn: kolommen, badges, de stand van een nummer en de knop
 * die daarbij hoort, filters, de kratkiezer, de bevestiging bij veel nummers,
 * de keuze uit zoekkandidaten en de teksten van de nachtwachtrij.
 *
 * Geen DOM, geen fetch: kaart-panel.js hangt het aan het scherm, en
 * test/kaart-lijst.test.mjs toetst het in Node.
 */

/** Welke tab van het library-paneel open staat: onthouden in localStorage. */
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export const TAB_SLEUTEL = 'varve.library.tab';
export const TABS = ['library', 'kaart'];

export function leesTab(opslag) {
  try {
    const t = opslag?.getItem(TAB_SLEUTEL);
    if (TABS.includes(t)) return t;
  } catch {}
  return 'library';
}

export function bewaarTab(opslag, tab) {
  try { if (TABS.includes(tab)) opslag?.setItem(TAB_SLEUTEL, tab); } catch {}
}

/**
 * Waarop de kaart sorteert en welke kant een EERSTE klik op gaat. Gelijk aan
 * `sorteer` in contract deel 2 (server/kaart.js van de serveragent).
 */
export const SORTERINGEN = { beurten: 'af', laatst: 'af', titel: 'op', artiest: 'op', duur: 'op', like_datum: 'af', gekeken: 'af', krat: 'op' };
export const STANDAARD_SORTERING = { sorteer: 'beurten', richting: 'af' };
/** Met een krat gekozen en niets aangeklikt: de volgorde van de krat zelf, zoals de server zonder `sorteer` doet. */
export const KRAT_SORTERING = { sorteer: 'krat', richting: 'op' };
export const SORTEER_SLEUTEL = 'varve.kaart.sortering';

/**
 * Wat er echt naar de server gaat: `sorteer=krat` bestaat alleen MET een krat
 * (zonder geeft de server 400), dus zonder krat valt hij terug op beurten.
 */
export function effectieveSortering(sortering, krat) {
  if (sortering?.sorteer === 'krat' && !krat) return { ...STANDAARD_SORTERING };
  return { sorteer: sortering?.sorteer ?? STANDAARD_SORTERING.sorteer, richting: sortering?.richting ?? STANDAARD_SORTERING.richting };
}

/** Een krat kiezen met de standaardsortering (beurten af) = de volgorde van de krat; anders blijft de keuze staan. */
export function sorteringBijKrat(sortering, krat) {
  if (!krat) return sortering;
  if (sortering?.sorteer === STANDAARD_SORTERING.sorteer && sortering?.richting === STANDAARD_SORTERING.richting) return { ...KRAT_SORTERING };
  return sortering;
}

/** Klik op een kolomkop: een andere kolom = zijn eigen eerste richting, dezelfde nog eens = omgekeerd. */
export function volgendeSortering(huidig, sleutel) {
  if (!Object.hasOwn(SORTERINGEN, sleutel)) return huidig;
  if (huidig?.sorteer === sleutel) return { sorteer: sleutel, richting: huidig.richting === 'op' ? 'af' : 'op' };
  return { sorteer: sleutel, richting: SORTERINGEN[sleutel] };
}

const geldigeSortering = (s) => !!s && Object.hasOwn(SORTERINGEN, s.sorteer) && (s.richting === 'op' || s.richting === 'af');

export function leesSortering(opslag) {
  try {
    const s = JSON.parse(opslag?.getItem(SORTEER_SLEUTEL) ?? 'null');
    if (geldigeSortering(s)) return { sorteer: s.sorteer, richting: s.richting };
  } catch {}
  return { ...STANDAARD_SORTERING };
}

export function bewaarSortering(opslag, s) {
  try { opslag?.setItem(SORTEER_SLEUTEL, JSON.stringify({ sorteer: s.sorteer, richting: s.richting })); } catch {}
}

// ---- filters ---------------------------------------------------------------

/** De filterknoppen boven de lijst (contract deel 3). `niet-binnen` en `binnen` sluiten elkaar uit. */
export const FILTERS = [
  { id: 'niet-binnen', label: 'niet binnen', titel: 'alleen nummers die nog niet in de library staan' },
  { id: 'binnen', label: 'binnen', titel: 'alleen nummers die al in de library staan' },
  { id: 'geen-video', label: 'geen video', titel: 'alleen Spotify-nummers zonder YouTube-video (eerst zoeken)' },
];
const UITSLUITEND = [['niet-binnen', 'binnen']];

/** Een filter aan- of uitzetten in de lijst van actieve filters (volgorde van FILTERS). */
export function wisselFilter(actief, id) {
  if (!FILTERS.some((f) => f.id === id)) return [...actief];
  const set = new Set(actief);
  if (set.has(id)) set.delete(id);
  else {
    set.add(id);
    for (const groep of UITSLUITEND) if (groep.includes(id)) for (const ander of groep) if (ander !== id) set.delete(ander);
  }
  return FILTERS.map((f) => f.id).filter((f) => set.has(f));
}

export function filterKnoppenHtml(actief = []) {
  return FILTERS.map((f) => `<button class="btn sm kaart-filter${actief.includes(f.id) ? ' on' : ''}" data-filter="${f.id}"`
    + ` title="${esc(f.titel)}" aria-pressed="${actief.includes(f.id)}">${esc(f.label)}</button>`).join('');
}

// ---- de vraag aan de server --------------------------------------------------

/** De URL voor één pagina van GET /api/kaart/nummers (contract deel 2). */
export function kaartUrl({ zoek = '', krat = '', filters = [], sorteer, richting }, pagina, grootte = PAGINA) {
  const q = new URLSearchParams({ sorteer, richting, van: String(pagina * grootte), aantal: String(grootte) });
  if (zoek) q.set('zoek', zoek);
  if (krat) q.set('krat', krat);
  if (filters?.length) q.set('filter', filters.join(','));
  return `/api/kaart/nummers?${q}`;
}

/**
 * Een rij van de kaart zoals de PaginaCache hem wil: met `id` (= sleutel), want
 * `vind`, `index` en de bladerfuncties van library-lijst.js zoeken op `id`.
 * Zo blijft library-lijst.js ongewijzigd. `binnen` (het track-id in de library)
 * en `wens` blijven gewoon staan.
 */
export const alsRij = (n) => ({ ...n, id: n.sleutel });

/** Het antwoord van /api/kaart/nummers in de vorm van /api/library ({ tracks, totaal, van }). */
export const alsPagina = (j) => ({ tracks: (j?.nummers || []).map(alsRij), totaal: j?.totaal ?? 0, van: j?.van ?? 0 });

// ---- stand van een nummer -----------------------------------------------------

/** Wat de wens-statussen in de lijst zeggen (contract deel 2: /api/kaart/wensen). */
export const WENS_TEKST = { wacht: 'wacht', zoekt: 'zoekt…', kies: 'kies video', bezig: 'bezig…', klaar: 'klaar', mislukt: 'mislukt', geannuleerd: 'geannuleerd' };

/**
 * De stand van een nummer op de kaart, in deze volgorde:
 * - `binnen`: staat als track in de library (laadknoppen);
 * - een wens die loopt (`wacht`, `zoekt`, `kies`, `bezig`) of `mislukt`: tekst;
 * - `kandidaat`: er is een YouTube-video, dus "haal binnen" kan;
 * - `geen-video`: alleen Spotify, dus eerst "zoek".
 * Een wens die `klaar` is zonder dat de rij al `binnen` zegt: dan is de lijst
 * verouderd, we tonen hem als `klaar` (tekst) tot de volgende verversing.
 * `geannuleerd` telt niet als wens.
 */
export function standVan(n) {
  if (n.binnen) return 'binnen';
  const s = n.wens?.status;
  if (s && s !== 'geannuleerd' && Object.hasOwn(WENS_TEKST, s)) return s;
  return n.youtube_id ? 'kandidaat' : 'geen-video';
}

/** Uitleg bij een uitgeschakelde knop terwijl een deck speelt (contract deel 3). */
export const SPEELT_UITLEG = 'er speelt een deck — binnenhalen en zoeken wachten tot het stil is (de download zou het geluid laten haperen)';

/**
 * De cel "stand": knoppen per stand (contract deel 3).
 * `staat`: { decks, label(deck), standen (per deck 'leeg'|'geladen'|'speelt'),
 * speelt (een deck speelt), bezig (Set sleutels waar een verzoek voor loopt),
 * gekozen (Map sleutel -> { youtube_id, titel } na "zoek" met een zekere treffer) }.
 */
export function standCelHtml(n, staat = {}) {
  const stand = standVan(n);
  const s = esc(n.sleutel);
  const bezig = staat.bezig?.has?.(n.sleutel);
  if (stand === 'binnen') {
    const decks = staat.decks || [];
    return `<span class="kaart-stand binnen" title="staat in de library">binnen</span>`
      + decks.map((d, k) => `<button class="btn sm lib-trk ${staat.standen?.[k] || ''}" data-deck="${esc(d)}" data-track="${esc(n.binnen)}" data-id="${s}"`
        + ` title="laad op track ${esc(staat.label?.(d) ?? d)} (${staat.standen?.[k] || ''})"${bezig ? ' disabled' : ''}>${bezig ? '…' : esc(staat.label?.(d) ?? d)}</button>`).join('');
  }
  // Na "zoek" met een zekere treffer (of een eigen keuze): "gekozen: …" met de
  // knop "anders", ook als de wens intussen `wacht` zegt (zo weet je WAT er komt).
  const gekozen = staat.gekozen?.get?.(n.sleutel);
  if (gekozen) {
    return `<span class="kaart-stand gekozen" title="${esc(`gekozen: ${gekozen.titel || gekozen.youtube_id}${n.wens?.status ? ` (${WENS_TEKST[n.wens.status] || n.wens.status})` : ''}`)}">gekozen: ${esc(gekozen.titel || gekozen.youtube_id)}</span>`
      + `<button class="btn sm kaart-anders" data-anders="${s}" title="een andere video kiezen">anders</button>`;
  }
  if (stand === 'kandidaat' || stand === 'geen-video') {
    const uit = staat.speelt || bezig;
    const titel = staat.speelt ? SPEELT_UITLEG : stand === 'kandidaat'
      ? 'alleen de audio binnenhalen (nu, via de wachtrij van de library)' : 'een YouTube-versie zoeken (yt-dlp, zonder cookies)';
    const data = stand === 'kandidaat' ? 'haal' : 'zoek';
    return `<button class="btn sm kaart-knop kaart-knop-${data}" data-${data}="${s}" title="${esc(titel)}"${uit ? ' disabled' : ''}>${bezig ? '…' : stand === 'kandidaat' ? 'haal binnen' : 'zoek'}</button>`;
  }
  // Een wens: tekst, met de fout in de tooltip. "kies": een knop die de kandidaten toont.
  const w = n.wens || {};
  if (stand === 'kies') {
    return `<button class="btn sm kaart-knop kaart-knop-kies" data-zoek="${s}" title="er zijn kandidaten gevonden, kies er een"${staat.speelt ? ' disabled' : ''}>kies video</button>`;
  }
  const hint = stand === 'mislukt' ? (w.fout || 'mislukt') : stand === 'wacht' ? 'op de wenslijst: de nachtwachtrij haalt hem binnen' : WENS_TEKST[stand];
  const weg = stand === 'wacht' || stand === 'mislukt' ? `<button class="btn sm kaart-weg" data-weg="${s}" title="van de wenslijst halen">×</button>` : '';
  return `<span class="kaart-stand ${esc(stand)}" title="${esc(hint)}">${esc(WENS_TEKST[stand] || stand)}</span>${weg}`;
}

// ---- badges (bronnen) --------------------------------------------------------

/** De badges in de kolom "bronnen" (contract deel 3): teken, uitleg, klasse. */
export function badges(n) {
  const uit = [];
  if (n.like === 'eigen') uit.push({ teken: '♥', klasse: 'eigen', titel: `eigen like${n.like_datum ? ` (${n.like_datum})` : ''}` });
  if (n.like === 'overzet') uit.push({ teken: '⇄', klasse: 'overzet', titel: `overgezette like (niet zelf gezet)${n.like_datum ? ` (${n.like_datum})` : ''}` });
  if (n.playlists?.length) uit.push({ teken: '≡', klasse: 'playlist', titel: `in playlist ${n.playlists.join(', ')}` });
  if (n.gekeken > 0) uit.push({ teken: '▶', klasse: 'gekeken', titel: `${n.gekeken}× gekeken op YouTube${n.yt_laatst ? `, laatst ${n.yt_laatst}` : ''}` });
  if (!n.youtube_id) uit.push({ teken: '♫', klasse: 'spotify', titel: 'alleen op Spotify: geen YouTube-video bekend' });
  return uit;
}

export const badgesHtml = (n) => badges(n).map((b) => `<i class="kaart-badge ${b.klasse}" title="${esc(b.titel)}">${b.teken}</i>`).join('');

// ---- cellen ------------------------------------------------------------------

/** Duur als m:ss; een Spotify-schatting met een ~ ervoor; onbekend: —. */
export function duurTekst(n) {
  if (!(n.duur > 0)) return '—';
  const t = fmtTime(n.duur).replace(/\.\d+$/, '');
  return n.duur_bron === 'spotify_schatting' ? `~${t}` : t;
}

/** Een ISO-datum ("2025-11-30") kort, zoals de library (datumKort): "24 sep", "3 jan 25". */
export function datumIso(iso, nu = Date.now()) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? datumKort(ms, nu) : '—';
}

/** De hint bij "laatst": wanneer, en de beurten per jaar. */
export function laatstHint(n) {
  const jaren = Object.entries(n.per_jaar || {}).sort(([a], [b]) => a.localeCompare(b));
  const per = jaren.length ? ` · per jaar: ${jaren.map(([j, k]) => `${j}: ${k}`).join(', ')}` : '';
  if (!n.laatst) return `nooit op Spotify gespeeld${per}`;
  return `laatst ${n.laatst}${n.eerst ? `, eerst ${n.eerst}` : ''}${n.uren ? `, ${String(n.uren).replace('.', ',')} uur` : ''}${per}`;
}

/**
 * De kolommen van de kaart, links naar rechts. Zelfde vorm als KOLOMMEN in
 * library-lijst.js (id, kop, breedte, sorteer, klasse, hint, cel), zodat
 * kopHtml/cellenHtml/kolomSjabloon ze zo kunnen tekenen. De stand-cel staat
 * los (standCelHtml): het paneel werkt die bij bij elke peiling van de
 * wensen, zonder de hele rij te hertekenen.
 */
export const KOLOMMEN = [
  { id: 'artiest', kop: 'artiest', breedte: '150px', sorteer: 'artiest', klasse: 'kaart-artiest', cel: (n) => esc(n.artiest || '') },
  {
    id: 'titel', kop: 'titel', breedte: 'minmax(160px, 1fr)', sorteer: 'titel', klasse: 'lib-titel',
    hint: (n) => [n.youtube_titel, n.kanaal ? `kanaal ${n.kanaal}` : null, n.klasse === 'twijfel' ? 'klasse: twijfel' : null, n.vorm && n.vorm !== 'nummer' ? `vorm: ${n.vorm}` : null].filter(Boolean).join(' · ') || n.titel,
    cel: (n) => `${esc(n.titel)}${n.versie ? `<small class="kaart-versie"> ${esc(n.versie)}</small>` : ''}`
      + (n.klasse === 'twijfel' ? '<small class="kaart-twijfel" title="klasse twijfel: misschien geen muziek">?</small>' : ''),
  },
  { id: 'duur', kop: 'duur', breedte: '56px', sorteer: 'duur', klasse: 'lib-duur', hint: (n) => (n.duur_bron === 'spotify_schatting' ? 'geschatte lengte (Spotify)' : ''), cel: (n) => esc(duurTekst(n)) },
  { id: 'beurten', kop: 'beurten', breedte: '66px', sorteer: 'beurten', klasse: 'kaart-getal', hint: (n) => `${n.beurten ?? 0} Spotify-beurten${n.gekozen != null ? `, ${n.gekozen} zelf gestart` : ''}${n.overgeslagen != null ? `, ${n.overgeslagen} overgeslagen` : ''}`, cel: (n) => esc(String(n.beurten ?? 0)) },
  { id: 'laatst', kop: 'laatst', breedte: '72px', sorteer: 'laatst', klasse: 'lib-datum', hint: laatstHint, cel: (n, nu) => esc(datumIso(n.laatst, nu)) },
  { id: 'bronnen', kop: 'bronnen', breedte: '78px', klasse: 'kaart-bronnen', cel: badgesHtml },
  // Vast breed (acht laadknoppen passen erin): elke rij is zijn eigen grid, dus
  // met max-content lag de kolom per rij ergens anders en de kop er niet boven.
  { id: 'stand', kop: 'stand', breedte: '276px', klasse: 'kaart-stand-cel', cel: (n, nu, staat) => `<span data-stand="${esc(n.sleutel)}">${standCelHtml(n, staat)}</span>` },
];

/**
 * De kolom "krat": alleen met een krat gekozen, vooraan. De kop sorteert op de
 * volgorde van de krat zelf (`sorteer=krat`: een playlist in volgorde van
 * toevoegen, eigen likes op like_datum). De cel toont het rangnummer in de
 * krat zolang daarop gesorteerd is (`staat.volgnr`, gezet door het paneel per
 * rij), anders niets: de server geeft geen positie mee.
 */
export const KRAT_KOLOM = {
  id: 'krat', kop: 'krat', breedte: '44px', sorteer: 'krat', klasse: 'kaart-getal kaart-volgnr',
  hint: () => 'plek in de krat (sorteer op de kolomkop: de volgorde van de krat zelf)',
  cel: (n, nu, staat) => (staat?.volgnr != null ? esc(String(staat.volgnr)) : ''),
};

/** De kolommen van nu: met een krat de kratkolom vooraan. */
export const kolommenVoor = (metKrat) => (metKrat ? [KRAT_KOLOM, ...KOLOMMEN] : KOLOMMEN);

// ---- kratten -----------------------------------------------------------------

/** De vaste slimme kratten en hun volgorde in de kiezer (contract deel 1). */
export const SLIMME_KRATTEN = ['slim:vertrouwd', 'slim:eigen-likes', 'slim:evergreens', 'slim:vergeten', 'slim:geliket-nooit-gespeeld', 'slim:eigen-keuze', 'slim:proefkrat'];

/** De kratkiezer: eerst "hele kaart", dan de slimme kratten, dan de playlists (op naam), met aantal en hoeveel binnen. */
export function kratOptiesHtml(kratten = [], gekozen = '', totaal = null) {
  const slim = kratten.filter((k) => k.soort === 'slim').sort((a, b) => {
    const ia = SLIMME_KRATTEN.indexOf(a.id), ib = SLIMME_KRATTEN.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a.naam).localeCompare(String(b.naam), 'nl');
  });
  const lijsten = kratten.filter((k) => k.soort !== 'slim').sort((a, b) => String(a.naam).localeCompare(String(b.naam), 'nl'));
  const optie = (k) => `<option value="${esc(k.id)}"${k.id === gekozen ? ' selected' : ''}>${esc(k.naam)} (${k.aantal ?? 0}${k.binnen ? ` · ${k.binnen} binnen` : ''})</option>`;
  const groep = (naam, xs) => (xs.length ? `<optgroup label="${naam}">${xs.map(optie).join('')}</optgroup>` : '');
  return `<option value=""${gekozen ? '' : ' selected'}>hele kaart${totaal != null ? ` (${totaal})` : ''}</option>` + groep('slimme kratten', slim) + groep('playlists', lijsten);
}

export const kratVan = (kratten, id) => kratten.find((k) => k.id === id) ?? null;

// ---- bevestigen bij veel nummers ------------------------------------------------

export const BEVESTIG_VANAF = 20;    // meer dan dit: eerst bevestigen (contract deel 2: anders 409)
export const MB_PER_NUMMER = 50;     // de schatting uit het contract: alleen audio, genormaliseerd

export const moetBevestigen = (aantal) => aantal > BEVESTIG_VANAF;

/** "1.234 MB" of "1,2 GB", Nederlands. */
export function mbTekst(mb) {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1).replace('.', ',')} GB`;
  return `${mb} MB`;
}

export function bevestigingsTekst(aantal, naam = 'deze krat') {
  return `${aantal} nummers uit ${naam} op de wenslijst zetten? Schatting: ${aantal} × ${MB_PER_NUMMER} MB = ${mbTekst(aantal * MB_PER_NUMMER)} aan audio.`;
}

/** De melding na POST /api/kaart/wens. */
export function wensUitkomst(antwoord, { meteen = false } = {}) {
  const toe = antwoord?.toegevoegd?.length ?? 0;
  const gew = antwoord?.geweigerd ?? [];
  const redenen = new Map();
  for (const g of gew) redenen.set(g.reden || 'geweigerd', (redenen.get(g.reden || 'geweigerd') || 0) + 1);
  const delen = [];
  if (toe) delen.push(`${toe} ${meteen ? 'naar de wachtrij' : 'op de wenslijst'}`);
  for (const [r, k] of redenen) delen.push(`${k} geweigerd: ${r}`);
  return { tekst: delen.join(' · ') || 'niets gedaan', goed: toe > 0 || !gew.length };
}

// ---- zoekkandidaten ------------------------------------------------------------

export const ZEKER_VANAF = 0.9;

/** De zekere kandidaat (score ≥ 0,9, de hoogste), of null: dan kiest Clay zelf. */
export function zekereKandidaat(kandidaten = []) {
  const beste = [...kandidaten].filter((k) => k && typeof k.score === 'number').sort((a, b) => b.score - a.score)[0];
  return beste && beste.score >= ZEKER_VANAF ? beste : null;
}

/** Het kieslijstje onder een rij: titel, kanaal, duur, score; klik = kies. */
export function kieslijstHtml(sleutel, kandidaten = [], boven = 0, { gekozen = null } = {}) {
  const s = esc(sleutel);
  const rijen = kandidaten.length ? kandidaten.map((k) => `<button class="btn sm kaart-kandidaat${k.youtube_id === gekozen ? ' on' : ''}" data-kies="${esc(k.youtube_id)}" data-id="${s}"`
    + ` title="${esc(k.reden || '')}"><b>${esc(k.titel || k.youtube_id)}</b><span>${esc(k.kanaal || '')}</span><span class="lib-duur">${esc(k.duur > 0 ? fmtTime(k.duur).replace(/\.\d+$/, '') : '—')}</span>`
    + `<span class="kaart-score${k.score >= ZEKER_VANAF ? ' zeker' : ''}">${esc(typeof k.score === 'number' ? k.score.toFixed(2).replace('.', ',') : '')}</span></button>`).join('')
    : '<span class="kaart-leeg">geen kandidaten gevonden</span>';
  return `<div class="lib-toonkiezer kaart-kieslijst" style="top:${boven}px" data-kieslijst="${s}">
    <span class="lib-tk-kop">YouTube-versie kiezen (score ≥ 0,9 is zeker)</span>
    <span class="kaart-kandidaten">${rijen}</span>
    <span class="lib-tk-rest"><button class="btn sm" data-kies-sluit="${s}" title="dicht">×</button></span>
  </div>`;
}

// ---- nachtwachtrij ----------------------------------------------------------------

/** Hoeveel wensen er wachten, klaar zijn of mislukten (voor het blok Nachtwachtrij). */
export function wensTelling(wensen = []) {
  const t = { wacht: 0, zoekt: 0, kies: 0, bezig: 0, klaar: 0, mislukt: 0, geannuleerd: 0, totaal: 0 };
  for (const w of wensen) { if (Object.hasOwn(t, w.status)) t[w.status]++; t.totaal++; }
  return t;
}

export function wensTellingTekst(t) {
  const delen = [`${t.wacht + t.zoekt + t.kies} wacht`, `${t.klaar} klaar`, `${t.mislukt} mislukt`];
  if (t.bezig) delen.unshift(`${t.bezig} bezig`);
  return delen.join(' · ');
}

/** Een tijdstempel (ISO of ms) kort, voor "laatste run" en "volgende". */
function tijdKort(x, nu) {
  if (!x) return null;
  const ms = typeof x === 'number' ? x : Date.parse(x);
  if (!Number.isFinite(ms)) return String(x);
  const d = new Date(ms);
  const uur = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dag = datumKort(ms, nu);
  return /^\d\d:\d\d$/.test(dag) ? `vandaag ${uur}` : `${dag} ${uur}`;
}

/** De regel over de laatste run: "vannacht 02:10–04:32: 80 gehaald, 1 mislukt (reden)". */
export function laatsteRunTekst(run, nu = Date.now()) {
  if (!run || (!run.begonnen && !run.klaar)) return 'nog geen run geweest';
  const van = tijdKort(run.begonnen, nu), tot = run.klaar ? tijdKort(run.klaar, nu)?.replace(/^.*\s/, '') : null;
  const delen = [`${run.gehaald ?? 0} gehaald`];
  if (run.mislukt) delen.push(`${run.mislukt} mislukt`);
  if (run.reden) delen.push(`gestopt: ${run.reden}`);
  return `${van}${tot ? `–${tot}` : ' (loopt)'}: ${delen.join(', ')}`;
}

/** De stand van de nachtwachtrij in één zin (het label naast aan/uit). */
export function nachtStandTekst(n, nu = Date.now()) {
  if (!n) return 'nachtwachtrij: onbekend';
  if (n.bezig) return 'nachtwachtrij: bezig';
  if (!n.aan) return 'nachtwachtrij uit';
  if (n.vandaagNiet) return 'nachtwachtrij aan, vannacht niet';
  const volgende = tijdKort(n.volgende, nu);
  return `nachtwachtrij aan${volgende ? `, volgende ${volgende}` : ''}`;
}

/** De speeldagen van de server kort: "10 okt (vandaag)", "geen". `nu` = de klok van de server (ISO) of van hier. */
export function speeldagenTekst(speeldagen = [], nu = Date.now()) {
  const lijst = Array.isArray(speeldagen) ? speeldagen.filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort() : [];
  if (!lijst.length) return 'geen';
  const ms = typeof nu === 'number' ? nu : (Date.parse(nu) || Date.now());
  const d = new Date(ms);
  const vandaag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Een ISO-datum ("2026-10-10") als "10 okt" (met jaar als het een ander jaar is); geen datumKort: die zegt voor vandaag de tijd.
  const kort = (x) => {
    const [j, m, dg] = x.split('-').map(Number);
    return `${dg} ${MAANDEN[m - 1]}${j === d.getFullYear() ? '' : ` ${String(j).slice(2)}`}`;
  };
  return lijst.map((x) => `${kort(x)}${x === vandaag ? ' (vandaag)' : ''}`).join(', ');
}

/** Een instelling uit het blok, als gedeeltelijke POST /api/nacht. Null = niets te sturen. */
export function nachtWijziging(veld, waarde, huidig = {}) {
  if (veld === 'aan') return { aan: !!waarde };
  if (veld === 'vandaagNiet') return { vandaagNiet: !!waarde };
  if (veld === 'perNacht') {
    const n = Math.round(Number(waarde));
    return Number.isFinite(n) && n >= 1 && n <= 500 ? { perNacht: n } : null;
  }
  if (veld === 'van' || veld === 'tot') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(waarde))) return null;
    return { venster: { ...(huidig.venster || { van: '01:00', tot: '07:00' }), [veld]: waarde } };
  }
  return null;
}
