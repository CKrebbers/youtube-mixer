// Aanhaker 'indeling' (spoor S11, docs/LIBRARY-TAGS.md §3): categorieën en tags op de bus. Alleen dit
// spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// De actions (uitleg in src/ui/beschrijf/indeling.js); geen knop zit erop: Clay verdeelt ze (een
// voorbeeld: mappings/stukken/indeling-voorbeeld.json):
//   library.category.next/prev/clear   de categorie als filter van de library (BROWSE op de Maschine)
//   library.quicktag.1–8               snel-tag K aan/uit op het gekozen nummer (of de selectie)
//   library.quickfilter.1–8            filter op snel-tag K aan/uit
//   track.N.tag.1–8                    snel-tag K aan/uit op het nummer op track N (mag van de iPad, als `mag` het noemt)
// Alle met log 'overslaan' en geen beginstand: een tag is data van het nummer, geen klank, en
// terugspelen mag de library niet omschrijven. Wissen, hernoemen en categorieën maken staan NIET op
// de bus (alleen in het paneel op de Mac), zoals sjablonen bewaren (S10).
import { TRACKS } from '../../control/actions.js';
import { SNEL, sleutelVan } from '../../library/indeling.js';
import { heeftTag } from '../library-indeling.js';

const OVERSLAAN = { log: 'overslaan', beginstand: false };

/**
 * De tags van de nummers op de tracks, voor de reads van track.N.tag.K (de LED-laag leest elke 33 ms:
 * alleen uit het geheugen). Onbekend nummer: één keer ophalen (GET /api/library/<id>), daarna onthouden.
 * `vers(id, tags)` na een eigen wijziging. Puur genoeg om te testen (`haal` komt van buiten).
 */
export function maakTagGeheugen({ haal, vind = () => null } = {}) {
  const tags = new Map(), bezig = new Set();
  return {
    lees(id) {
      if (!id) return null;
      const t = vind(id);
      if (t?.tags) { tags.set(id, t.tags); return t.tags; }
      if (tags.has(id)) return tags.get(id);
      if (!bezig.has(id) && haal) {
        bezig.add(id);
        Promise.resolve(haal(id)).then((x) => { if (Array.isArray(x)) tags.set(id, x); }, () => {}).finally(() => bezig.delete(id));
      }
      return null;
    },
    vers(id, t) { tags.set(id, t); },
    vergeet(id) { tags.delete(id); },
    /** Alles vergeten (een tag hernoemd, samengevoegd of gewist: de namen kunnen anders zijn). */
    wis() { tags.clear(); },
  };
}

export default async function opzet(ctx) {
  const { define, laden, staat, meld = () => {} } = ctx;
  const lib = laden?.library;
  // Een kale ctx (test/aanhaakpunten.test.mjs) of een paneel zonder indeling: niets om aan te haken.
  if (typeof define !== 'function' || !lib?.indeling || typeof fetch !== 'function') return;
  const ind = lib.indeling;
  const snelNaam = (k) => ind.stand.snel[k - 1] ?? null;

  define('library.category.next', 'trigger', (on) => { if (on) lib.stapCategorie(1); },
    { label: 'Library: de volgende categorie als filter (alles → categorieën → slimme)', read: () => (lib.filter.categorie != null ? 1 : 0), ...OVERSLAAN });
  define('library.category.prev', 'trigger', (on) => { if (on) lib.stapCategorie(-1); },
    { label: 'Library: de vorige categorie als filter', read: () => (lib.filter.categorie != null ? 1 : 0), ...OVERSLAAN });
  define('library.category.clear', 'trigger', (on) => { if (on) lib.wisFilter(); },
    { label: 'Library: het filter leeg (de hele library)', read: () => (Object.keys(lib.filter).length ? 1 : 0), ...OVERSLAAN });

  for (let k = 1; k <= SNEL; k++) {
    define(`library.quicktag.${k}`, 'trigger', (on) => { if (on) ind.snel(k); }, {
      label: `Library: snel-tag ${k} aan/uit op het gekozen nummer (of wat gekozen is)`, ...OVERSLAAN,
      read: () => {
        const n = snelNaam(k);
        if (!n) return null;
        const t = lib.doelIds().map((id) => lib._track(id)).filter(Boolean);
        return t.length && t.every((x) => heeftTag(x, n)) ? 1 : 0;
      },
    });
    define(`library.quickfilter.${k}`, 'trigger', (on) => { if (on) lib.snelFilter(k); }, {
      label: `Library: filter op snel-tag ${k} aan/uit`, ...OVERSLAAN,
      read: () => { const n = snelNaam(k); return n ? (lib.filter.tags?.en?.includes(sleutelVan(n)) ? 1 : 0) : null; },
    });
  }

  // ---- track.N.tag.K: het nummer op een track (ook van de iPad, schrijfweg S8) -------------------
  const geheugen = maakTagGeheugen({
    vind: (id) => lib._track(id),
    haal: async (id) => {
      const r = await fetch(`/api/library/${encodeURIComponent(id)}`);
      const j = await r.json().catch(() => null);
      return r.ok ? j?.track?.tags ?? [] : null;
    },
  });
  const nummerOp = (deckId) => staat?.deckTrack?.[deckId] ?? null;
  for (const [nr, deckId] of TRACKS) {
    for (let k = 1; k <= SNEL; k++) {
      define(`track.${nr}.tag.${k}`, 'trigger', (on) => {
        if (!on) return;
        const id = nummerOp(deckId), naam = snelNaam(k);
        if (!id) { meld(`track ${nr}: geen nummer uit de library om te taggen`, 'info'); return; }
        if (!naam) { meld(`snel-tag ${k} is leeg: zet hem in de library (⋯ bij een tag)`, 'info'); return; }
        const tags = geheugen.lees(id) ?? lib._track(id)?.tags ?? [];
        const aan = !tags.some((x) => sleutelVan(x) === sleutelVan(naam));
        ind.zetTags([id], [naam], aan).then((r) => {
          if (!r) return;
          const rest = tags.filter((x) => sleutelVan(x) !== sleutelVan(naam));
          geheugen.vers(id, aan ? [...rest, ...r.tags] : rest);
        });
      }, {
        label: `Snel-tag ${k} aan/uit op het nummer op track ${nr}`, ...OVERSLAAN,
        read: () => {
          const id = nummerOp(deckId), naam = snelNaam(k);
          if (!id || !naam) return null;
          const tags = geheugen.lees(id);
          return tags ? (tags.some((x) => sleutelVan(x) === sleutelVan(naam)) ? 1 : 0) : null;
        },
      });
    }
  }
  ind.naVerversen = () => geheugen.wis();
  window.varveIndeling = { geheugen, lib, stand: () => ind.stand };
}
