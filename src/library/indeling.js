import { ToonKaart, camelot, kortNaam, leesToonsoort } from '../engine/toonsoort.js';
import { gridStatus, libraryBpm } from '../ui/grid-strook.js';

/*
 * De indeling van de library (spoor S11, docs/LIBRARY-TAGS.md): categorieën, slimme categorieën en
 * tags, en het FILTER waarmee je ze vindt. Puur: geen DOM, geen fetch, geen database. De server
 * (server/library.js, server/routes/indeling.js) en de browser (library-panel.js, het planvenster,
 * de iPad) gebruiken dezelfde definities, zoals plan-model.js dat doet voor het plan.
 *
 * Het filter:
 *   { zoek, categorie, tags: { en, of, niet }, bpm: [lo, hi], toon: [k…], grid, stems, energie: [lo, hi] }
 * Elk veld optioneel; een leeg filter = de hele library. Tags bij SLEUTEL (tagSleutel).
 */

/** De kleuren van een tag of categorie (één vaste lijst; de css kent ze als .ik-<kleur>). */
export const KLEUREN = Object.freeze(['grijs', 'rood', 'oranje', 'geel', 'groen', 'cyaan', 'blauw', 'violet', 'roze']);
export const SOORTEN = Object.freeze(['gewoon', 'slim']);
export const GRID_FILTERS = Object.freeze(['zeker', 'onzeker', 'geen']);
export const STEMS_FILTERS = Object.freeze(['ja', 'nee', '2', '4']);
/** Wat `k_grid` als bruikbaar telt (= wat de lijst als zeker toont: zeker, op slot, met de hand). */
export const GRID_ZEKER = Object.freeze(['zeker', 'slot', 'hand']);
export const SNEL = 8;
export const MAX_NAAM = 40;
export const MAX_CATEGORIE_NAAM = 60;
export const MAX_TAGS_PER_FILTER = 20;
export const MAX_TAGS = 2000;
export const MAX_CATEGORIEEN = 500;
export const MAX_IDS = 5000;
/** Energie in woorden (de zoekregel). */
export const ENERGIE_WOORDEN = Object.freeze({ laag: [0, 0.33], midden: [0.33, 0.66], hoog: [0.66, 1] });

const VERBODEN = /[,|#@"\u0000-\u001f\u007f]/;

/** Een naam netjes: spaties samen, randen eraf. Null als hij niet mag (leeg, te lang, verboden tekens). */
export function geldigeNaam(naam, max = MAX_NAAM) {
  if (typeof naam !== 'string') return null;
  const n = naam.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!n || n.length > max || VERBODEN.test(n) || /^-/.test(n)) return null;
  return n;
}

/** De sleutel van een naam: kleine letters, zonder accenten. "Dub" en "dub" zijn dezelfde tag. */
export function sleutelVan(naam) {
  return String(naam ?? '').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}
export const tagSleutel = sleutelVan;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const isSleutel = (k) => Number.isInteger(k) && k >= 0 && k < 24;

/** Camelot ("8A") of een naam ("Am", "F#") -> 0..23, of null. */
const CAMELOT = new Map(Array.from({ length: 24 }, (_, k) => [camelot(k).toLowerCase(), k]));
export function leesToon(s) {
  if (isSleutel(s)) return s;
  const t = String(s ?? '').trim();
  return CAMELOT.get(t.toLowerCase()) ?? leesToonsoort(t);
}
export const toonTekst = (k) => (isSleutel(k) ? `${camelot(k)} ${kortNaam(k)}` : '—');

/** Een bereik [lo, hi] binnen [min, max], gesorteerd. Null als het geen bereik is. */
function bereik(b, min, max) {
  if (!Array.isArray(b) || b.length !== 2 || !eindig(b[0]) || !eindig(b[1])) return null;
  const lo = Math.max(min, Math.min(b[0], b[1])), hi = Math.min(max, Math.max(b[0], b[1]));
  return hi >= lo ? [lo, hi] : null;
}

function tagLijst(x, fouten, veld) {
  if (x == null) return [];
  if (!Array.isArray(x)) { fouten.push(`tags.${veld} is een lijst`); return []; }
  const uit = [];
  for (const n of x) {
    const g = geldigeNaam(n);
    if (!g) { fouten.push(`tag "${String(n).slice(0, 40)}" mag niet`); continue; }
    const s = sleutelVan(g);
    if (!uit.includes(s)) uit.push(s);
  }
  return uit;
}

/**
 * Een filter uit de buitenwereld netjes maken: { filter, fouten }. Wat niet klopt valt weg en staat
 * in `fouten` (de route zegt 400 bij een fout, de zoekregel toont hem). Puur.
 */
export function normaliseerFilter(f) {
  const fouten = [];
  const uit = {};
  if (f == null) return { filter: uit, fouten };
  if (typeof f !== 'object' || Array.isArray(f)) return { filter: uit, fouten: ['een filter is een object'] };
  if (f.zoek != null) {
    if (typeof f.zoek !== 'string') fouten.push('zoek is tekst');
    else if (f.zoek.trim()) uit.zoek = f.zoek.trim().slice(0, 200);
  }
  if (f.categorie != null) {
    if (Number.isSafeInteger(f.categorie) && f.categorie > 0) uit.categorie = f.categorie;
    else fouten.push('categorie is een id');
  }
  if (f.tags != null) {
    if (typeof f.tags !== 'object' || Array.isArray(f.tags)) fouten.push('tags is { en, of, niet }');
    else {
      const t = { en: tagLijst(f.tags.en, fouten, 'en'), of: tagLijst(f.tags.of, fouten, 'of'), niet: tagLijst(f.tags.niet, fouten, 'niet') };
      if (t.en.length + t.of.length + t.niet.length > MAX_TAGS_PER_FILTER) fouten.push(`hooguit ${MAX_TAGS_PER_FILTER} tags in een filter`);
      else if (t.en.length || t.of.length || t.niet.length) uit.tags = t;
    }
  }
  if (f.bpm != null) { const b = bereik(f.bpm, 20, 400); if (b) uit.bpm = b; else fouten.push('bpm is [van, tot]'); }
  if (f.energie != null) { const b = bereik(f.energie, 0, 1); if (b) uit.energie = b; else fouten.push('energie is [van, tot] in 0..1'); }
  if (f.toon != null) {
    const lijst = Array.isArray(f.toon) ? f.toon : [f.toon];
    const k = [...new Set(lijst.map(leesToon))];
    if (k.some((x) => x === null)) fouten.push('toon: een toonsoort (8A, Am, F#)');
    else if (k.length) uit.toon = k.sort((a, b) => a - b);
  }
  if (f.grid != null) { if (GRID_FILTERS.includes(f.grid)) uit.grid = f.grid; else fouten.push(`grid is ${GRID_FILTERS.join(' / ')}`); }
  if (f.stems != null) { const s = String(f.stems); if (STEMS_FILTERS.includes(s)) uit.stems = s; else fouten.push(`stems is ${STEMS_FILTERS.join(' / ')}`); }
  return { filter: uit, fouten };
}

/** Is dit filter leeg (= de hele library)? */
export const filterLeeg = (f) => !f || Object.keys(f).length === 0;

/**
 * Twee filters als één, strikt EN (een slimme categorie plus wat je erbij typt, als nieuwe regel):
 * het resultaat vindt nooit meer dan elk van beide. Kan dat niet in één filter (twee "of"-groepen,
 * twee zoekteksten), of is de doorsnede leeg (bpm/energie zonder overlap, toon zonder gemeenschappelijke,
 * een ander grid of stems), dan null: de server rekent ze zelf als twee blokken (Indeling.sql). Puur.
 */
export function combineer(a, b) {
  const uit = structuredClone(a ?? {});
  for (const [k, v] of Object.entries(b ?? {})) {
    if (uit[k] === undefined) { uit[k] = structuredClone(v); continue; }
    if (k === 'tags') {
      const t = uit.tags;
      if (t.of.length && v.of.length) return null;
      uit.tags = { en: [...new Set([...t.en, ...v.en])], of: t.of.length ? t.of : v.of, niet: [...new Set([...t.niet, ...v.niet])] };
    } else if (k === 'bpm' || k === 'energie') {
      const lo = Math.max(uit[k][0], v[0]), hi = Math.min(uit[k][1], v[1]);
      if (lo > hi) return null;
      uit[k] = [lo, hi];
    } else if (k === 'toon') {
      uit.toon = uit.toon.filter((x) => v.includes(x));
      if (!uit.toon.length) return null;
    } else if (JSON.stringify(uit[k]) !== JSON.stringify(v)) return null;   // zoek, grid, stems, categorie: hetzelfde of niets
  }
  return uit;
}

// ---- URL ----------------------------------------------------------------------------------------

const getal = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
const bereikTekst = (b) => (b[0] === b[1] ? getal(b[0]) : `${getal(b[0])}-${getal(b[1])}`);

/** Het filter als query-parameters (zonder zoek: die heeft zijn eigen veld `zoek`). Puur. */
export function filterNaarQuery(f, q = new URLSearchParams()) {
  if (!f) return q;
  if (f.zoek) q.set('zoek', f.zoek);
  if (f.categorie) q.set('cat', String(f.categorie));
  if (f.tags?.en?.length) q.set('tag', f.tags.en.join(','));
  if (f.tags?.of?.length) q.set('of', f.tags.of.join(','));
  if (f.tags?.niet?.length) q.set('niet', f.tags.niet.join(','));
  if (f.bpm) q.set('bpm', bereikTekst(f.bpm));
  if (f.energie) q.set('energie', bereikTekst(f.energie));
  if (f.toon?.length) q.set('toon', f.toon.map((k) => camelot(k)).join(','));
  if (f.grid) q.set('grid', f.grid);
  if (f.stems) q.set('stems', f.stems);
  return q;
}

function leesBereik(s) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const a = Number(m[1].replace(',', '.')), b = m[2] != null ? Number(m[2].replace(',', '.')) : null;
  return [a, b ?? a];
}

/** Query-parameters -> { filter, fouten } (de route van de lijst). Puur. */
export function queryNaarFilter(q) {
  const ruw = {};
  const fouten = [];
  const lijst = (k) => q.get(k).split(',').map((x) => x.trim()).filter(Boolean);
  if (q.get('zoek')) ruw.zoek = q.get('zoek');
  if (q.has('cat')) { const n = Number(q.get('cat')); if (Number.isSafeInteger(n) && n > 0) ruw.categorie = n; else fouten.push('cat is een id'); }
  if (q.has('tag') || q.has('of') || q.has('niet')) {
    ruw.tags = { en: q.has('tag') ? lijst('tag') : [], of: q.has('of') ? lijst('of') : [], niet: q.has('niet') ? lijst('niet') : [] };
  }
  for (const k of ['bpm', 'energie']) {
    if (!q.has(k)) continue;
    const b = leesBereik(q.get(k));
    if (!b) { fouten.push(`${k} is van-tot`); continue; }
    ruw[k] = k === 'bpm' && b[0] === b[1] ? [b[0] - 1, b[0] + 1] : b;
  }
  if (q.has('toon')) ruw.toon = lijst('toon');
  if (q.has('grid')) ruw.grid = q.get('grid');
  if (q.has('stems')) ruw.stems = q.get('stems');
  const n = normaliseerFilter(ruw);
  return { filter: n.filter, fouten: [...fouten, ...n.fouten] };
}

// ---- de zoekregel --------------------------------------------------------------------------------

/** Woorden, met "…" bij elkaar gehouden (ook na # of @: #"deep house"). */
export function woorden(tekst) {
  const s = String(tekst ?? '');
  const uit = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    // Een voorvoegsel (-#, #, @, -, sleutel:) en dan "…" tussen aanhalingstekens, of tot de spatie.
    const m = /^(?:[-!]?[#@]|[a-z]+:)?"/i.exec(s.slice(i));
    if (m) {
      const voor = m[0].slice(0, -1);
      const eind = s.indexOf('"', i + m[0].length);
      const tekst = s.slice(i + m[0].length, eind < 0 ? s.length : eind);
      i = eind < 0 ? s.length : eind + 1;
      if (voor || tekst.trim()) uit.push({ voor, tekst, quote: true, heel: `${voor}"${tekst}"` });
      continue;
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    const w = s.slice(i, j);
    uit.push({ voor: '', tekst: w, quote: false, heel: w });
    i = j;
  }
  return uit;
}

/**
 * De zoekregel lezen (docs/LIBRARY-TAGS.md §2): `#dub -#vocal #a|b @warm bpm:70-90 toon:8A
 * grid:zeker stems energie:hoog vrije tekst`. `categorieen`: [{ id, naam, sleutel? }] om @naam op te
 * zoeken. Geeft { filter, onbekend: [tekst…], fouten: [tekst…] }. Een tag die (nog) niet bestaat is
 * geen fout: het filter vindt dan niets, en de chip zegt het. Puur.
 */
export function leesZoekregel(tekst, { categorieen = [] } = {}) {
  const ruw = { tags: { en: [], of: [], niet: [] } };
  const zoek = [];
  const onbekend = [];
  for (const w of woorden(tekst)) {
    const t = w.voor + w.tekst;
    const heelWoord = w.quote ? w.tekst : null;      // tussen aanhalingstekens: zoals het staat
    let m;
    if ((m = /^(-|!)?#(.+)$/su.exec(t))) {
      const namen = heelWoord != null ? [heelWoord] : m[2].split(/[|,]/).filter(Boolean);
      if (m[1]) ruw.tags.niet.push(...namen);
      else if (namen.length > 1) ruw.tags.of.push(...namen);
      else ruw.tags.en.push(...namen);
    } else if ((m = /^@(.+)$/su.exec(t))) {
      const s = sleutelVan(heelWoord ?? m[1]);
      const c = categorieen.find((x) => sleutelVan(x.naam) === s) ?? categorieen.find((x) => sleutelVan(x.naam).startsWith(s));
      if (c) ruw.categorie = c.id; else onbekend.push(w.heel);
    } else if ((m = /^bpm:(.+)$/i.exec(t))) {
      const b = leesBereik(m[1]);
      if (b) ruw.bpm = b[0] === b[1] ? [b[0] - 1, b[0] + 1] : b; else onbekend.push(w.heel);
    } else if ((m = /^energie:(.+)$/i.exec(t))) {
      const b = ENERGIE_WOORDEN[m[1].toLowerCase()] ?? leesBereik(m[1]);
      if (b) ruw.energie = [...b]; else onbekend.push(w.heel);
    } else if ((m = /^toon:(.+)$/i.exec(t))) {
      const k = m[1].split(',').map(leesToon);
      if (k.every((x) => x !== null)) ruw.toon = [...(ruw.toon ?? []), ...k]; else onbekend.push(w.heel);
    } else if ((m = /^grid:(.+)$/i.exec(t))) {
      if (GRID_FILTERS.includes(m[1].toLowerCase())) ruw.grid = m[1].toLowerCase(); else onbekend.push(w.heel);
    } else if (/^stems$/i.test(t)) ruw.stems = 'ja';
    else if (/^-stems$/i.test(t)) ruw.stems = 'nee';
    else if ((m = /^stems:([24])$/i.exec(t))) ruw.stems = m[1];
    else zoek.push(w.quote ? w.tekst : w.heel);
  }
  if (zoek.length) ruw.zoek = zoek.join(' ');
  const { filter, fouten } = normaliseerFilter(ruw);
  return { filter, onbekend, fouten };
}

const tagWoord = (s) => (/[\s"]/.test(s) ? `"${s}"` : s);

/** Het filter terug als zoekregel (de omkering van leesZoekregel, op de volgorde na). Puur. */
export function zoekregelVan(f, { categorieen = [] } = {}) {
  if (!f) return '';
  const delen = [];
  if (f.categorie) {
    const c = categorieen.find((x) => x.id === f.categorie);
    delen.push(c ? `@${tagWoord(sleutelVan(c.naam))}` : `@${f.categorie}`);
  }
  for (const s of f.tags?.en ?? []) delen.push(`#${tagWoord(s)}`);
  if (f.tags?.of?.length) delen.push(f.tags.of.some((s) => /[\s"]/.test(s)) ? f.tags.of.map((s) => `#${tagWoord(s)}`).join(' ') : `#${f.tags.of.join('|')}`);
  for (const s of f.tags?.niet ?? []) delen.push(`-#${tagWoord(s)}`);
  if (f.bpm) delen.push(`bpm:${bereikTekst(f.bpm)}`);
  if (f.toon?.length) delen.push(`toon:${f.toon.map((k) => camelot(k)).join(',')}`);
  if (f.grid) delen.push(`grid:${f.grid}`);
  if (f.stems) delen.push(f.stems === 'ja' ? 'stems' : f.stems === 'nee' ? '-stems' : `stems:${f.stems}`);
  if (f.energie) {
    const w = Object.entries(ENERGIE_WOORDEN).find(([, b]) => b[0] === f.energie[0] && b[1] === f.energie[1]);
    delen.push(`energie:${w ? w[0] : bereikTekst(f.energie)}`);
  }
  if (f.zoek) delen.push(f.zoek);
  return delen.join(' ');
}

/**
 * De chips van een filter: [{ soort, tekst, zonder }] met `zonder` = het filter zonder deze chip.
 * `tags`: Map sleutel -> { naam, kleur } (de chip toont de naam zoals hij geschreven is). Puur.
 */
export function chipsVan(f, { tags = new Map(), categorieen = [] } = {}) {
  if (!f) return [];
  const uit = [];
  const zonder = (wijzig) => { const g = structuredClone(f); wijzig(g); if (g.tags && !g.tags.en.length && !g.tags.of.length && !g.tags.niet.length) delete g.tags; return g; };
  const naam = (s) => tags.get(s)?.naam ?? s;
  if (f.categorie) {
    const c = categorieen.find((x) => x.id === f.categorie);
    uit.push({ soort: 'categorie', tekst: c ? `${c.soort === 'slim' ? '✦ ' : '@'}${c.naam}` : '@?', kleur: c?.kleur ?? null, zonder: zonder((g) => { delete g.categorie; }) });
  }
  for (const s of f.tags?.en ?? []) uit.push({ soort: 'tag', tekst: `#${naam(s)}`, kleur: tags.get(s)?.kleur ?? null, onbekend: !tags.has(s), zonder: zonder((g) => { g.tags.en = g.tags.en.filter((x) => x !== s); }) });
  if (f.tags?.of?.length) uit.push({ soort: 'tag', tekst: f.tags.of.map((s) => `#${naam(s)}`).join(' of '), kleur: null, zonder: zonder((g) => { g.tags.of = []; }) });
  for (const s of f.tags?.niet ?? []) uit.push({ soort: 'niet', tekst: `niet #${naam(s)}`, kleur: tags.get(s)?.kleur ?? null, zonder: zonder((g) => { g.tags.niet = g.tags.niet.filter((x) => x !== s); }) });
  if (f.bpm) uit.push({ soort: 'bpm', tekst: `${bereikTekst(f.bpm)} bpm`, zonder: zonder((g) => { delete g.bpm; }) });
  if (f.toon?.length) uit.push({ soort: 'toon', tekst: f.toon.map(toonTekst).join(' · '), zonder: zonder((g) => { delete g.toon; }) });
  if (f.grid) uit.push({ soort: 'grid', tekst: `grid ${f.grid}`, zonder: zonder((g) => { delete g.grid; }) });
  if (f.stems) uit.push({ soort: 'stems', tekst: f.stems === 'nee' ? 'zonder stems' : f.stems === 'ja' ? 'met stems' : `${f.stems} stems`, zonder: zonder((g) => { delete g.stems; }) });
  if (f.energie) uit.push({ soort: 'energie', tekst: `energie ${bereikTekst(f.energie)}`, zonder: zonder((g) => { delete g.energie; }) });
  if (f.zoek) uit.push({ soort: 'zoek', tekst: `"${f.zoek}"`, zonder: zonder((g) => { delete g.zoek; }) });
  return uit;
}

/** Een korte tekst voor een klein scherm (de Maschine, de iPad): "@warm #dub 70-90". Puur. */
export function filterKort(f, opties = {}) {
  return chipsVan(f, opties).map((c) => c.tekst).join(' ');
}

// ---- afgeleide kenmerken (schema v10: k_grid, k_toon, k_energie, k_bpm) -------------------------

/**
 * De versie van de formules hieronder (en van gridStatus, ToonKaart.hoofd, libraryBpm die ze gebruiken).
 * De server rekent bij ELK openen alles na (Library._kenmerkenNaOpen, alleen wat anders is wordt
 * geschreven) en zet deze versie in `instellingen.kenmerk_versie`: zo zie je in de database met welke
 * formules hij het laatst rekende. Verander je een drempel of formule die de lijst toont: verhoog hem.
 */
export const KENMERK_VERSIE = 1;

/** k_bpm: het hoofdtempo zoals de bpm-kolom het toont (libraryBpm: "84.7", "~84.7", "128 / 117", "64.6?"), of null. */
export function bpmKenmerk(grid, duur) {
  if (!grid) return null;
  try { const m = /\d+(?:\.\d+)?/.exec(libraryBpm(grid, duur)); return m ? Number(m[0]) : null; } catch { return null; }
}

/** k_grid: de status van gridStatus (geen/slot/hand/zeker/onzeker/geenpuls), of null zonder grid. */
export function gridKenmerk(grid, duur) {
  if (!grid) return null;
  try { const s = gridStatus(grid, duur).status; return s === 'geen' ? null : s; } catch { return null; }
}

/** k_toon: de hoofdtoonsoort van de plaat zoals de lijst hem toont (zeker of onzeker), anders null. */
export function toonKenmerk(toon, duur) {
  const kaart = toon ? ToonKaart.van(toon) : null;
  const h = kaart?.hoofd(duur) ?? null;
  return h && h.soort !== 'geen' && isSleutel(h.k) ? h.k : null;
}

/** k_energie: de energie van de secties, gewogen naar hun lengte (0..1), of null. */
export function energieKenmerk(secties, duur) {
  const st = Array.isArray(secties?.stukken) ? secties.stukken.filter((s) => eindig(s.van) && eindig(s.energie)) : [];
  if (!st.length) return null;
  const eind = duur > 0 ? Math.max(duur, st.at(-1).van) : st.at(-1).van + 30;
  let som = 0, tijd = 0;
  st.forEach((s, i) => {
    const d = Math.max(0, (i + 1 < st.length ? st[i + 1].van : eind) - s.van);
    som += d * s.energie; tijd += d;
  });
  return tijd > 0 ? Math.round((som / tijd) * 1000) / 1000 : Math.round(st[0].energie * 1000) / 1000;
}

// ---- de plek in een categorie --------------------------------------------------------------------

/**
 * Plekken voor `n` nummers tussen `voor` en `na` (de plekken ernaast, of null aan de rand). Als het
 * gat te klein wordt (na veel tussenvoegen) geeft hij null: dan nummert de server opnieuw. Puur.
 */
export function plekkenTussen(voor, na, n) {
  if (voor == null && na == null) return Array.from({ length: n }, (_, i) => i + 1);
  if (na == null) return Array.from({ length: n }, (_, i) => voor + i + 1);
  if (voor == null) voor = na - n - 1;
  const stap = (na - voor) / (n + 1);
  if (!(stap > 1e-6)) return null;
  return Array.from({ length: n }, (_, i) => voor + stap * (i + 1));
}

// ---- export / import -----------------------------------------------------------------------------

/**
 * Een indeling uit de buitenwereld (import, ook van Claude): { indeling, fouten }. Alleen wat klopt
 * komt erdoor; fouten zijn per onderdeel (een kapotte tag laat de rest staan). Puur.
 */
export function normaliseerIndeling(d) {
  const fouten = [];
  const uit = { soort: 'varve-indeling', schema: 1, tags: [], categorieen: [], snel: null };
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { indeling: uit, fouten: ['een indeling is een object'] };
  if (d.soort != null && d.soort !== 'varve-indeling') fouten.push('soort is varve-indeling');
  const tagGezien = new Set();
  for (const t of Array.isArray(d.tags) ? d.tags.slice(0, MAX_TAGS) : []) {
    const naam = geldigeNaam(typeof t === 'string' ? t : t?.naam);
    if (!naam) { fouten.push(`tag ${JSON.stringify(t).slice(0, 60)} overgeslagen`); continue; }
    if (tagGezien.has(sleutelVan(naam))) continue;
    tagGezien.add(sleutelVan(naam));
    const x = { naam, kleur: KLEUREN.includes(t?.kleur) ? t.kleur : null };
    // De nummers met deze tag (export, of Claude die nummers tagt): alleen geldige ids, hooguit MAX_IDS.
    if (Array.isArray(t?.nummers)) x.nummers = [...new Set(t.nummers.filter((id) => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)))].slice(0, MAX_IDS);
    uit.tags.push(x);
  }
  const catGezien = new Set();
  for (const c of Array.isArray(d.categorieen) ? d.categorieen.slice(0, MAX_CATEGORIEEN) : []) {
    const naam = geldigeNaam(c?.naam, MAX_CATEGORIE_NAAM);
    if (!naam) { fouten.push(`categorie ${JSON.stringify(c?.naam ?? null).slice(0, 60)} overgeslagen`); continue; }
    if (catGezien.has(sleutelVan(naam))) { fouten.push(`categorie "${naam}" staat er twee keer in`); continue; }
    const soort = c.soort === 'slim' ? 'slim' : 'gewoon';
    const x = { naam, soort, kleur: KLEUREN.includes(c.kleur) ? c.kleur : null };
    if (soort === 'slim') {
      const r = normaliseerRegel(c.regel);
      if (r.fouten.length) { fouten.push(`slimme categorie "${naam}": ${r.fouten.join('; ')}`); continue; }
      x.regel = r.regel;
    } else {
      x.nummers = [...new Set((Array.isArray(c.nummers) ? c.nummers : []).filter((id) => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)))].slice(0, MAX_IDS);
    }
    catGezien.add(sleutelVan(naam));
    uit.categorieen.push(x);
  }
  if (d.snel != null) {
    const s = normaliseerSnel(d.snel);
    if (s) uit.snel = s; else fouten.push(`snel: een lijst van ${SNEL} tagnamen of null`);
  }
  return { indeling: uit, fouten };
}

/**
 * De regel van een slimme categorie: een filter, waarin `categorie` een NAAM is (export) of een id
 * (in de database). Hier alleen de vorm; of de categorie bestaat en gewoon is, weet de server.
 */
export function normaliseerRegel(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { regel: null, fouten: ['een regel is een filter-object'] };
  const { categorie, ...rest } = r;
  const n = normaliseerFilter(rest);
  const regel = n.filter;
  if (categorie != null) {
    if (typeof categorie === 'string' && geldigeNaam(categorie, MAX_CATEGORIE_NAAM)) regel.categorie = geldigeNaam(categorie, MAX_CATEGORIE_NAAM);
    else if (Number.isSafeInteger(categorie) && categorie > 0) regel.categorie = categorie;
    else n.fouten.push('categorie in een regel is een naam of id');
  }
  return { regel, fouten: n.fouten };
}

/** De acht snel-tags: namen of null. Null als de vorm niet klopt. */
export function normaliseerSnel(s) {
  if (!Array.isArray(s) || s.length > SNEL) return null;
  const uit = Array.from({ length: SNEL }, (_, i) => (s[i] == null || s[i] === '' ? null : geldigeNaam(s[i])));
  return uit.every((x, i) => x !== null || s[i] == null || s[i] === '') ? uit : null;
}
