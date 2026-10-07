// @ts-check
/**
 * SectieKaart: het nummer in secties die je speelt (docs/SECTIES.md). Puur,
 * zoals ToonKaart: geen DOM, geen klok. De kaart komt van de server
 * (server/secties.js) en staat in tracktijd.
 *
 *   { versie, opGrid, grid, stukken: [{ van, label, groep, energie, zeker?, stems? }], bron, slot }
 *
 * Sectie i loopt van stukken[i].van tot stukken[i + 1].van (de laatste tot het
 * einde van het nummer). Nummers voor mensen en de APC tellen vanaf 1; hier
 * vanaf 0.
 */

/** Hoe een label op het scherm heet (kort genoeg voor een pad of een strook). */
export const LABEL_TEKST = { intro: 'intro', opbouw: 'opbouw', drop: 'drop', break: 'break', outro: 'outro', deel: '' };

/**
 * Een kleur per groep (A, B, C …) voor het scherm: dezelfde letter, dezelfde
 * kleur, zodat je ziet wat terugkomt. Gedempt, de golfvorm blijft leesbaar.
 */
export const GROEP_KLEUREN = ['#4fd1c5', '#f6ad55', '#b794f4', '#68d391', '#fc8181', '#63b3ed', '#f6e05e', '#ed64a6'];
export const groepKleur = (groep) => GROEP_KLEUREN[(String(groep).charCodeAt(0) - 65 + GROEP_KLEUREN.length * 4) % GROEP_KLEUREN.length];

/**
 * Seconden: hoe ver een sectiebegin na t mag liggen en toch al "hier" is (index).
 * Ruim boven de afronding van de server (0,05 ms), en 1 ms te vroeg is onhoorbaar
 * (het lampje van de sectie die je hoort, sectieHier).
 */
export const BEGIN_MARGE = 1e-3;

export class SectieKaart {
  /** @param {any} data  de kaart als JSON (zie boven) */
  constructor(data) {
    const d = data || {};
    const st = Array.isArray(d.stukken) ? d.stukken.filter((s) => s && Number.isFinite(s.van) && s.van >= 0) : [];
    st.sort((a, b) => a.van - b.van);
    this.stukken = st.map((s) => ({ ...s }));
    if (this.stukken.length) this.stukken[0].van = 0;
    this.opGrid = d.opGrid !== false;
    this.grid = typeof d.grid === 'string' ? d.grid : null;
    this.versie = Number.isInteger(d.versie) ? d.versie : null;
    this.bron = d.bron === 'hand' ? 'hand' : 'auto';
    this.slot = !!d.slot;
  }

  /** Een kaart, of null zonder stukken. */
  static van(data) {
    if (data instanceof SectieKaart) return data;
    const k = new SectieKaart(data);
    return k.stukken.length ? k : null;
  }

  get aantal() { return this.stukken.length; }

  /** Begin van sectie i (tracktijd), of null als die er niet is. */
  begin(i) { return this.stukken[i]?.van ?? null; }

  /** Einde van sectie i: het begin van de volgende, of `duur`. */
  eind(i, duur) { return i + 1 < this.stukken.length ? this.stukken[i + 1].van : duur; }

  /**
   * De sectie op tracktijd t (index), of −1 zonder stukken. Een begin tot
   * BEGIN_MARGE na t telt al mee: de server bewaart elk begin afgerond op 0,1 ms,
   * en ligt dat net NA de "1" van het grid, dan hoort die "1" toch bij de nieuwe
   * sectie (anders deed "volgende" in de laatste maat ervóór niets, en sprong
   * "vorige" een sectie te ver terug).
   */
  index(t) {
    const s = this.stukken;
    if (!s.length) return -1;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (s[m].van <= t + BEGIN_MARGE) lo = m; else hi = m - 1;
    }
    return lo;
  }

  /** "drop B", of "B" voor een gewoon deel. */
  naam(i) {
    const s = this.stukken[i];
    if (!s) return '';
    const l = LABEL_TEKST[s.label] ?? s.label ?? '';
    return l ? `${l} ${s.groep}` : String(s.groep ?? '');
  }

  toJSON() {
    const k = { versie: this.versie, opGrid: this.opGrid, grid: this.grid, stukken: this.stukken.map((s) => ({ ...s })), bron: this.bron, slot: this.slot };
    return k;
  }
}

/**
 * Waar een sprong naar een sectie landt (Clay, docs/SECTIES.md §3): de sectie
 * begint op de EERSTVOLGENDE maat, zonder te wachten en zonder dat de groove
 * struikelt. Je springt naar het stuk vlak vóór de sectie, precies zo ver
 * vóór haar "1" als jij nu van de volgende "1" af zit: wat je de rest van
 * deze maat hoort is de aanloop uit het nummer zelf (het einde van de maat
 * ervóór, vaak een fill), en op de maatstreep valt de sectie in.
 *
 * Geeft de tracktijd om naartoe te springen, of `begin` zelf als dat niet
 * kan of hoeft (stilstaand, geen of onzeker grid, of precies op de "1").
 *
 * @param grid    Beatgrid (of null)
 * @param p       waar de speelkop nu is (tracktijd)
 * @param begin   begin van de sectie (tracktijd, op een maatbegin)
 * @param zeker   (t) => mag het grid op t gebruikt worden (deck._opGrid)
 */
export function sectieDoel(grid, p, begin, zeker = () => true) {
  if (!grid || !zeker(p) || !zeker(begin)) return begin;
  const bpb = grid.beatsPerBar;
  // De "1" van de sectie: haar begin, of (de eerste sectie begint op 0, vóór
  // een opmaat) de eerste "1" daarna. Alles rekent vanaf die "1".
  const een = sectieEen(grid, begin);
  const tellenInMaat = grid.barPhase(p) * bpb;               // tellen sinds de "1"
  if (tellenInMaat < 0.02 || tellenInMaat > bpb - 0.02) {
    // Op de "1" (of er vlak voor): de sectie meteen, met de fase in de tel.
    const d = grid.metFaseVan(een, p);
    return d < 0 ? een : d;
  }
  const doel = grid.verschuif(een, -(bpb - tellenInMaat));
  // Vóór het begin van het nummer is er geen aanloop: dan in de maat zelf, op dezelfde plek.
  if (doel < 0 || !zeker(doel)) return grid.verschuif(een, tellenInMaat);
  return doel;
}

/**
 * Hoe ver (in tellen) een sectiebegin NA zijn "1" mag liggen. Het begin ligt op een
 * maatbegin, maar de server bewaart het afgerond (0,1 ms); met 1e-6 tel werd een
 * begin net na de "1" (in Chrome gemeten: 2,7e-5 tel) de VOLGENDE "1", een maat te
 * laat. 0,01 tel is ~5 ms op 120 bpm, ruim boven die afronding en ver onder een tel.
 */
const EEN_MARGE = 0.01;

/** De "1" waarop sectie-begin `begin` invalt (zie sectieDoel), of `begin` zonder grid. */
export function sectieEen(grid, begin) {
  return grid ? grid.timeOf(grid.volgendeVeelvoud(grid.beatAt(begin) - EEN_MARGE)) : begin;
}
