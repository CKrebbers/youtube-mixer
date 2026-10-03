import { fmtTime } from '../lib/emitter.js';
import { esc } from './dom.js';
import { gridStatus, libraryBpm, STATUS_TEKST } from './grid-strook.js';
import { libraryToon } from './toon-weergave.js';
import { stemsCel } from './stems-weergave.js';

/*
 * De lijst van de library, voor 5000 nummers net zo goed als voor 50.
 *
 * Twee keuzes (ROADMAP 21):
 * - De SERVER pagineert en sorteert (GET /api/library?sorteer=&richting=&van=
 *   &aantal=, zie server/library.js). Alles in één keer ophalen kostte bij
 *   5000 nummers ~5 MB JSON per zoekletter en honderden ms op een server die
 *   ook de pagina's van spelende decks levert. Een pagina van 100 is ~100 kB
 *   en een paar ms.
 * - Het paneel tekent alleen de rijen die je ZIET (plus een marge): een vaste
 *   rijhoogte, een lege ruimte zo hoog als de hele lijst, en daarin een
 *   venster dat meeschuift. Zo blijft de scrollbalk eerlijk en staan er nooit
 *   meer dan ~30 rijen in de DOM.
 *
 * Alles hier is puur (geen DOM, geen fetch), zodat het in Node te testen is;
 * library-panel.js hangt het aan het scherm.
 */

/** Rijhoogte in px. Vast: posities worden uitgerekend, niet gemeten. */
export const RIJ_H = 28;
/** Rijen per verzoek. */
export const PAGINA = 100;
/** Zoveel rijen boven en onder het zichtbare stuk tekenen we er alvast bij. */
export const MARGE = 8;

/**
 * Waarop je kunt sorteren en welke kant een EERSTE klik op gaat. Gelijk aan
 * `SORTERING[..].eerst` in server/library.js (library-lijst.test vergelijkt ze).
 */
export const SORTERINGEN = { titel: 'op', bpm: 'op', duur: 'op', toegevoegd: 'af', gespeeld: 'af' };
export const STANDAARD_SORTERING = { sorteer: 'toegevoegd', richting: 'af' };
export const SORTEER_SLEUTEL = 'varve.library.sortering';

/** Klik op een kolomkop: een andere kolom = zijn eigen eerste richting, dezelfde nog eens = omgekeerd. */
export function volgendeSortering(huidig, sleutel) {
  if (!Object.hasOwn(SORTERINGEN, sleutel)) return huidig;
  if (huidig?.sorteer === sleutel) return { sorteer: sleutel, richting: huidig.richting === 'op' ? 'af' : 'op' };
  return { sorteer: sleutel, richting: SORTERINGEN[sleutel] };
}

const geldig = (s) => !!s && Object.hasOwn(SORTERINGEN, s.sorteer) && (s.richting === 'op' || s.richting === 'af');

/** De laatst gekozen sortering, uit localStorage. Leeg, kapot of geblokkeerd: de standaard. */
export function leesSortering(opslag) {
  try {
    const s = JSON.parse(opslag?.getItem(SORTEER_SLEUTEL) ?? 'null');
    if (geldig(s)) return { sorteer: s.sorteer, richting: s.richting };
  } catch {}
  return { ...STANDAARD_SORTERING };
}

/** localStorage, of undefined als de browser hem niet geeft (geblokkeerde sitedata gooit al bij het lezen). */
export function standaardOpslag() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function bewaarSortering(opslag, s) {
  try { opslag?.setItem(SORTEER_SLEUTEL, JSON.stringify({ sorteer: s.sorteer, richting: s.richting })); } catch {}
}

/** Welke rijen [van, tot) er getekend worden bij deze scrollstand. */
export function zichtbaar({ boven, hoogte, totaal, rijH = RIJ_H, marge = MARGE }) {
  if (!(totaal > 0)) return { van: 0, tot: 0 };
  const van = Math.min(totaal, Math.max(0, Math.floor(Math.max(0, boven) / rijH) - marge));
  const tot = Math.min(totaal, Math.ceil((Math.max(0, boven) + Math.max(0, hoogte)) / rijH) + marge);
  return { van, tot: Math.max(van, tot) };
}

/** Welke pagina's [van, tot) raakt. */
export function paginasVoor(van, tot, grootte = PAGINA) {
  if (!(tot > van)) return [];
  const uit = [];
  for (let p = Math.floor(van / grootte); p <= Math.floor((tot - 1) / grootte); p++) uit.push(p);
  return uit;
}

/** De URL voor één pagina. */
export function lijstUrl({ zoek = '', sorteer, richting }, pagina, grootte = PAGINA) {
  const q = new URLSearchParams({ sorteer, richting, van: String(pagina * grootte), aantal: String(grootte) });
  if (zoek) q.set('zoek', zoek);
  return `/api/library?${q}`;
}

/**
 * Pagina's van één vraag (zoekterm + sortering), op rijnummer.
 *
 * `ververs` haalt de pagina's van het zichtbare stuk opnieuw en ruilt ze pas
 * als ALLES binnen is: geen flits van lege rijen bij elke nieuwe ingest. Een
 * nieuwere vraag wint altijd (generatie): een laat antwoord op "a" komt niet
 * meer over de lijst van "ab" heen.
 */
export class PaginaCache {
  /** @param haalPagina (vraag, pagina) => Promise<{ tracks, totaal }> */
  constructor(haalPagina, grootte = PAGINA) {
    this.haalPagina = haalPagina;
    this.grootte = grootte;
    this.vraag = null;
    this.paginas = new Map();
    this.onderweg = new Set();
    this.totaal = 0;
    this.gen = 0;
    this.extra = new Map();     // id -> track die (nog) niet in een pagina staat, bv. net binnengehaald
  }

  rij(i) { return this.paginas.get(Math.floor(i / this.grootte))?.[i % this.grootte]; }

  vind(id) {
    for (const p of this.paginas.values()) {
      const t = p.find((x) => x.id === id);
      if (t) return t;
    }
    return this.extra.get(id) ?? null;
  }

  /** Alles wat er nu is, op volgorde (voor de console en oude code). */
  get geladen() {
    return [...this.paginas.keys()].sort((a, b) => a - b).flatMap((k) => this.paginas.get(k));
  }

  /** Een (nieuwe of dezelfde) vraag, voor rijen [van, tot). False als er intussen een nieuwere kwam. */
  async ververs(vraag, van, tot) {
    const gen = ++this.gen;
    const nodig = paginasVoor(van, tot, this.grootte);
    if (!nodig.length) nodig.push(0);
    const antwoorden = await Promise.all(nodig.map((p) => this.haalPagina(vraag, p)));
    if (gen !== this.gen) return false;
    this.vraag = vraag;
    this.paginas = new Map(nodig.map((p, k) => [p, antwoorden[k].tracks || []]));
    this.onderweg.clear();
    this.totaal = antwoorden.at(-1).totaal ?? 0;
    return true;
  }

  /** Ontbrekende pagina's voor [van, tot) ophalen. True als er iets bij kwam. */
  async zorgVoor(van, tot) {
    if (!this.vraag) return false;
    const gen = this.gen, vraag = this.vraag;
    const nodig = paginasVoor(van, Math.min(tot, this.totaal), this.grootte)
      .filter((p) => !this.paginas.has(p) && !this.onderweg.has(p));
    if (!nodig.length) return false;
    for (const p of nodig) this.onderweg.add(p);
    let nieuw = false;
    // Nog dezelfde vraag? De generatie alleen is niet genoeg: scroll je terwijl
    // een nieuwe vraag (ververs) al vertrokken is, dan heeft deze de generatie
    // van de nieuwe maar nog de OUDE vraag. Kwam de nieuwe eerst terug, dan
    // viel deze pagina van de oude sortering er anders alsnog in, met zijn totaal.
    const actueel = () => gen === this.gen && vraag === this.vraag;
    await Promise.all(nodig.map(async (p) => {
      try {
        const a = await this.haalPagina(vraag, p);
        if (!actueel()) return;
        this.paginas.set(p, a.tracks || []);
        this.totaal = a.totaal ?? this.totaal;
        nieuw = true;
      } catch {
        // volgende scroll probeert het opnieuw
      } finally {
        if (actueel()) this.onderweg.delete(p);
      }
    }));
    return nieuw;
  }
}

const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Een datum zo kort mogelijk: "14:05" vandaag, "gisteren", "24 sep", "3 jan 25". */
export function datumKort(ms, nu = Date.now()) {
  if (!(ms > 0)) return '—';
  const d = new Date(ms), n = new Date(nu);
  const dag = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dagen = Math.round((dag(n) - dag(d)) / 86400000);
  if (dagen === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (dagen === 1) return 'gisteren';
  const kort = `${d.getDate()} ${MAANDEN[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? kort : `${kort} ${String(d.getFullYear()).slice(2)}`;
}

/** Het label per bron (server/links.js: bronVan). */
const BRON_LABEL = { youtube: 'YT', tiktok: 'TikTok', bestand: 'bestand', web: 'web' };

/**
 * gridStatus rekent de hele strook uit; per scrollbeeld voor elke rij is dat
 * zonde. Onthouden per grid-OBJECT: "opnieuw analyseren" geeft een nieuw grid,
 * dus dan wordt het vanzelf opnieuw uitgerekend.
 */
const gridCache = new WeakMap();
function gridInfo(t) {
  if (!t.grid) return { gs: { status: 'geen', aandeel: null }, bpm: '—' };
  let x = gridCache.get(t.grid);
  if (!x) { x = { gs: gridStatus(t.grid, t.duur), bpm: libraryBpm(t.grid) }; gridCache.set(t.grid, x); }
  return x;
}

/** Hetzelfde voor de toonsoort (de PLAAT, geen pitch): per kaart-object onthouden. */
const toonCache = new WeakMap();
function toonInfo(t) {
  if (!t.toon) return libraryToon(null, t.duur);
  let x = toonCache.get(t.toon);
  if (!x) { x = libraryToon(t.toon, t.duur); toonCache.set(t.toon, x); }
  return x;
}

/**
 * De stems-cel (docs/STEMS.md §4): de stand ("—", "2", "4", "wacht", "42%",
 * "fout") en de knoppen om te splitsen (2 · 4) of te annuleren (×). Los van
 * KOLOMMEN, want het paneel werkt alleen deze cel bij als de stems-rij van de
 * server verandert (voortgang): de hele rij hertekenen kan een klik op een
 * laadknop kosten. `staat.stems` = Map track-id -> opdracht, `staat.stemsUit`
 * = waarom er niet gesplitst kan worden (de splitter ontbreekt), of null.
 */
export function stemsCelHtml(t, staat = {}) {
  const c = stemsCel(t, staat?.stems?.get?.(t.id) ?? null, { uit: staat?.stemsUit ?? null });
  const id = esc(t.id);
  const knoppen = c.knoppen.map((k) => (k.doe === 'annuleer'
    ? `<button class="btn sm lib-st lib-st-x" data-stems="annuleer" data-opdracht="${esc(k.opdracht)}" data-id="${id}" title="${esc(k.titel)}">×</button>`
    : `<button class="btn sm lib-st" data-stems="splits" data-aantal="${k.aantal}" data-id="${id}" title="${esc(k.titel)}"${k.uit ? ' disabled' : ''}>${k.aantal}</button>`)).join('');
  // De INHOUD van de cel (cellenHtml zet er de <span> van de kolom omheen):
  // het paneel vervangt die inhoud, en vindt hem terug aan data-st-id.
  return `<b class="lib-stems ${c.soort}" data-st-id="${id}" title="${esc(c.titel)}">${esc(c.tekst)}</b>${knoppen}`;
}

/**
 * De kolommen, links naar rechts (de knoppen komen er in het paneel achter).
 * `sorteer` = sleutel voor de server (SORTERINGEN); zonder = niet sorteerbaar.
 * Een kolom erbij = een regel hier, en als hij sorteerbaar is een sleutel in
 * SORTERINGEN en in SORTERING van server/library.js.
 * `cel(t, nu, staat)`: `staat` komt van het paneel (`kiezer` = id van de rij
 * waarvan de toonsoortkiezer open staat; `stems` en `stemsUit`, zie stemsCelHtml).
 */
export const KOLOMMEN = [
  {
    id: 'titel', kop: 'titel', breedte: 'minmax(160px, 1fr)', sorteer: 'titel', klasse: 'lib-titel',
    hint: (t) => t.url,
    cel: (t) => `<i class="lib-bron ${esc(t.bron || 'web')}">${esc(BRON_LABEL[t.bron] || 'web')}</i>${esc(t.titel)}`,
  },
  { id: 'uploader', kop: 'artiest', breedte: '130px', klasse: 'lib-uploader', cel: (t) => esc(t.uploader || '') },
  { id: 'duur', kop: 'duur', breedte: '52px', sorteer: 'duur', klasse: 'lib-duur', cel: (t) => esc(fmtTime(t.duur || 0).replace(/\.\d+$/, '')) },
  {
    id: 'bpm', kop: 'bpm', breedte: '66px', sorteer: 'bpm', klasse: 'lib-bpm',
    hint: () => 'tempo van het grid bij het begin', cel: (t) => esc(gridInfo(t).bpm),
  },
  {
    // Toonsoort van de PLAAT: hoofdtoonsoort + hoeveel andere. Een knop: klik =
    // de kiezer onder de rij (library-panel.js). Niet sorteerbaar (niet gevraagd).
    id: 'toon', kop: 'toon', breedte: '86px', klasse: 'lib-toon-cel',
    cel: (t, nu, staat) => {
      const x = toonInfo(t);
      return `<button class="lib-toon ${x.soort}${x.slot ? ' slot' : ''}${staat?.kiezer === t.id ? ' open' : ''}"`
        + ` data-toon="${esc(t.id)}" title="${esc(x.titel)}">${esc(x.tekst)}</button>`;
    },
  },
  {
    id: 'grid', kop: 'grid', breedte: '92px', klasse: (t) => `lib-grid ${gridInfo(t).gs.status}`,
    hint: (t) => {
      const { gs } = gridInfo(t);
      const n = t.grid?.stukken?.length ?? 0;
      return gs.status === 'geen' ? 'nog geen grid — wordt op de achtergrond geanalyseerd, of tik het tempo'
        : `${n} stuk${n === 1 ? '' : 'ken'}${gs.aandeel !== null && gs.status !== 'slot' && gs.status !== 'hand' ? `, ${Math.round(gs.aandeel * 100)}% van de tijd zeker` : ''}`;
    },
    cel: (t) => esc(STATUS_TEKST[gridInfo(t).gs.status]),
  },
  // Stems: zang + rest (2) of vier, met splitsen/annuleren in de cel. Niet
  // sorteerbaar (niet gevraagd, en de server kent er geen sleutel voor).
  { id: 'stems', kop: 'stems', breedte: '84px', klasse: 'lib-stems-cel', cel: (t, nu, staat) => stemsCelHtml(t, staat) },
  {
    id: 'lufs', kop: 'LUFS', breedte: '104px', klasse: 'lib-lufs',
    cel: (t) => esc(t.loudness_i != null ? `${t.loudness_i.toFixed(1)} → ${t.doel_loudness} LUFS` : '—'),
  },
  { id: 'racks', kop: 'racks', breedte: '52px', klasse: 'lib-racks', cel: (t) => (t.racks ? `${t.racks} rack${t.racks === 1 ? '' : 's'}` : '—') },
  {
    id: 'toegevoegd', kop: 'toegevoegd', breedte: '100px', sorteer: 'toegevoegd', klasse: 'lib-datum',
    hint: (t) => (t.toegevoegd ? `toegevoegd ${new Date(t.toegevoegd).toLocaleString('nl-NL')}` : ''),
    cel: (t, nu) => esc(datumKort(t.toegevoegd, nu)),
  },
  {
    id: 'gespeeld', kop: 'gespeeld', breedte: '76px', sorteer: 'gespeeld', klasse: 'lib-datum',
    hint: (t) => (t.laatst_geladen ? `laatst op een track geladen ${new Date(t.laatst_geladen).toLocaleString('nl-NL')}`
      + ` (${t.keer_geladen}×)` : 'nog nooit op een track geladen'),
    cel: (t, nu) => esc(datumKort(t.laatst_geladen, nu)),
  },
];

/** grid-template-columns voor kop en rijen: de kolommen plus de knoppen. */
export const kolomSjabloon = (kolommen = KOLOMMEN) => [...kolommen.map((k) => k.breedte), 'max-content'].join(' ');

/** De kolomkop. De sorteerbare koppen zijn knoppen; de pijl zegt welke kant op. */
export function kopHtml(sortering, knoppen = '', kolommen = KOLOMMEN) {
  return kolommen.map((k) => {
    if (!k.sorteer) return `<span class="lib-kopcel">${esc(k.kop)}</span>`;
    const aan = sortering?.sorteer === k.sorteer;
    const pijl = aan ? (sortering.richting === 'op' ? '▲' : '▼') : '';
    const aria = aan ? (sortering.richting === 'op' ? 'ascending' : 'descending') : 'none';
    return `<button class="lib-kopcel lib-sorteer${aan ? ' aan' : ''}" data-sorteer="${esc(k.sorteer)}" aria-sort="${aria}"`
      + ` title="sorteer op ${esc(k.kop)}${aan ? ' — nog eens: andersom' : ''}">${esc(k.kop)}<i>${pijl}</i></button>`;
  }).join('') + `<span class="lib-knoppen lib-kop-knoppen" aria-hidden="true">${knoppen}</span>`;
}

/** De cellen van één rij (zonder de knoppen). `staat`: zie KOLOMMEN. */
export function cellenHtml(t, nu = Date.now(), staat = {}, kolommen = KOLOMMEN) {
  return kolommen.map((k) => {
    const klasse = typeof k.klasse === 'function' ? k.klasse(t) : k.klasse;
    const hint = k.hint?.(t);
    return `<span class="${esc(klasse)}"${hint ? ` title="${esc(hint)}"` : ''}>${k.cel(t, nu, staat)}</span>`;
  }).join('');
}
