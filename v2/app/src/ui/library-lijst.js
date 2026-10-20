/**
 * De library als lijst, puur (geen DOM): zoeken, sorteren en de keuze. Het scherm (library.js)
 * tekent alleen de zichtbare rijen; een controller bladert via de bus (library.volgende/.vorige)
 * en laadt de keuze (library.laad).
 *
 * Zoeken: elk woord moet ergens in titel of artiest staan, zonder accenten en hoofdletters
 * ("beyonce" vindt "Beyoncé"). Sorteren op titel, artiest, bpm, toon, duur of toegevoegd; wat
 * geen waarde heeft staat achteraan (v1 library: NULL achteraan).
 */
export const SLEUTELS = ['titel', 'artiest', 'bpm', 'toon', 'duur', 'toegevoegd'];

const kaal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** De bpm van het eerste stuk van het grid, of null; en of het grid daar zeker is (v1: ≥ 0,65 of slot). */
export function gridVan(x) {
  const g = x.grid ?? x.gridLijst;
  const s = g?.stukken?.[0];
  if (!s || !(s.bpm > 0)) return { bpm: null, zeker: false };
  return { bpm: s.bpm, zeker: !!g.slot || s.zekerheid === undefined || s.zekerheid >= 0.65 };
}

export class LibraryLijst {
  constructor() {
    this.alle = [];
    this.rijen = [];
    this.zoek = '';
    this.sleutel = 'toegevoegd';
    this.richting = -1;          // nieuwste eerst
    this.gekozen = null;         // id
  }

  zet(nummers) { this.alle = nummers.map((x) => ({ ...x, _zoek: kaal(`${x.titel} ${x.artiest ?? ''}`) })); this._bereken(); }

  zoeken(q) { this.zoek = q; this._bereken(); }

  /** Op een kolom sorteren; nog eens op dezelfde = omdraaien. */
  sorteer(sleutel) {
    if (!SLEUTELS.includes(sleutel)) return;
    if (this.sleutel === sleutel) this.richting = -this.richting;
    else { this.sleutel = sleutel; this.richting = sleutel === 'toegevoegd' ? -1 : 1; }
    this._bereken();
  }

  _waarde(x) {
    switch (this.sleutel) {
      case 'bpm': return gridVan(x).bpm;
      case 'titel': case 'artiest': case 'toon': return x[this.sleutel] ? kaal(x[this.sleutel]) : null;
      default: return x[this.sleutel] ?? null;
    }
  }

  _bereken() {
    const woorden = kaal(this.zoek).split(/\s+/).filter(Boolean);
    const rijen = this.alle.filter((x) => woorden.every((w) => x._zoek.includes(w)));
    const r = this.richting;
    rijen.sort((a, b) => {
      const va = this._waarde(a), vb = this._waarde(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;               // zonder waarde achteraan, welke richting ook
      if (vb === null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * r;
    });
    this.rijen = rijen;
    if (this.gekozen !== null && !rijen.some((x) => x.id === this.gekozen)) this.gekozen = null;
  }

  get index() { return this.gekozen === null ? -1 : this.rijen.findIndex((x) => x.id === this.gekozen); }

  /** Een stap in de lijst (zoals het wiel van een controller); begint bovenaan. */
  stap(d) {
    if (!this.rijen.length) return null;
    const i = this.index;
    const j = i < 0 ? 0 : Math.max(0, Math.min(this.rijen.length - 1, i + d));
    this.gekozen = this.rijen[j].id;
    return this.gekozen;
  }

  kies(id) { if (this.rijen.some((x) => x.id === id)) this.gekozen = id; }
}
