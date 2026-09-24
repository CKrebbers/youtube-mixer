/**
 * De toonsoort van een track: een KAART in tracktijd, van de PLAAT, zoals het
 * beatgrid (docs/TOONSOORT.md §3 en §6).
 *
 * Een lijst stukken { van, toonsoort, stemming, zekerheid? }, gesorteerd op
 * `van`. Een stuk geldt vanaf `van` tot het volgende; het eerste ook vóór zijn
 * `van`. `stemming` (cent, −50..+50) hoort bij het stuk: een album of mix heeft
 * per nummer een eigen A. `toonsoort` null = "geen toonsoort", met de hand gezet.
 *
 * Wat je HOORT is afgeleid, zoals `deck.bpm` van `grid.bpm` (Clay, T3):
 *
 *   halve tonen erbij = transpositie + (keylock ? 0 : 12 · log2(rate)) + stemming/100
 *   hoorbare toonsoort = plaat + round(halve tonen erbij)
 *   afwijking (cent)   = 100 · (halve tonen erbij − round(halve tonen erbij))
 *
 * `bend` (nudge) telt niet mee: die zit alleen in de bron, niet in `rate`, en
 * de weergave mag niet flikkeren zolang je duwt.
 *
 * Deze module kent geen engine, geen deck, geen library en geen DOM: alleen
 * rekenwerk en namen. Tekst voor het scherm staat in src/ui/toon-weergave.js.
 */

const EPS = 1e-9;
const eindig = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Zekerheid per stuk (0..1, van de automatische analyse). Vanaf ZEKER_VANAF
 * gewoon tonen, daaronder gedimd met "?", onder GEEN_TOON een "~": geen
 * duidelijke toonsoort (bij ambient een eerlijk antwoord, geen fout).
 * Voorlopige drempels op ~15 stukken (TOONSOORT.md §2): herijken na ~20 sloten.
 */
export const ZEKER_VANAF = 0.40;
export const GEEN_TOON = 0.15;

// ---- sleutels, namen en Camelot -----------------------------------------------
// Een sleutel k: 0..11 = majeur op toonklasse k (C = 0), 12..23 = mineur op k − 12.

/** De vaste spelling in de kaart (§3); mineur krijgt een `m` erachter. */
export const SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Korte naam op het scherm (T2): `G`, `B♭m`. Mineur spelt C♯ en G♯ zoals muzikanten. */
const KORT_MAJ = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const KORT_MIN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
/** Volle Nederlandse naam (focusdeel en tooltip): `As majeur`, `Bes mineur`. */
const NL_MAJ = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'Bes', 'B'];
const NL_MIN = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Bes', 'B'];

const isSleutel = (k) => Number.isInteger(k) && k >= 0 && k < 24;
export const isMineur = (k) => k >= 12;
export const tonica = (k) => k % 12;
const mod12 = (x) => ((x % 12) + 12) % 12;

/** Camelot-getal 1..12: C majeur = 8B, elke kwint omhoog +1; mineur = dat van zijn relatieve majeur. */
export function camelotGetal(k) {
  if (!isSleutel(k)) return null;
  const t = isMineur(k) ? (tonica(k) + 3) % 12 : k;
  return mod12(7 * t + 7) + 1;
}

/** `8B`, `3A`, of null. */
export const camelot = (k) => (isSleutel(k) ? `${camelotGetal(k)}${isMineur(k) ? 'A' : 'B'}` : null);
/** `G`, `B♭m`, of null. */
export const kortNaam = (k) => (isSleutel(k) ? (isMineur(k) ? `${KORT_MIN[k - 12]}m` : KORT_MAJ[k]) : null);
/** `As majeur`, `Bes mineur`, of null. */
export const volleNaam = (k) => (isSleutel(k) ? (isMineur(k) ? `${NL_MIN[k - 12]} mineur` : `${NL_MAJ[k]} majeur`) : null);
/** `Db`, `Bbm`: zoals het in de kaart staat. */
export const spelling = (k) => (isSleutel(k) ? SPELLING[tonica(k)] + (isMineur(k) ? 'm' : '') : null);

/**
 * "F", "F#m", "Dbm", "E♭", "Bb minor" → sleutel 0..23, of null. Leest ruimer
 * dan de vaste spelling: een kaart van elders (of met de hand getypt) mag
 * C♯m zeggen waar wij Dbm schrijven.
 */
export function leesToonsoort(s) {
  if (isSleutel(s)) return s;
  const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(m|min|minor|mineur)?\s*(maj|major|majeur)?\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const basis = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const vt = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const t = mod12(basis + vt);
  return m[3] ? 12 + t : t;
}

/** Een aantal halve tonen verschuiven (afgerond); de letter (majeur/mineur) blijft. */
export const transponeer = (k, halveTonen) => (isSleutel(k)
  ? (isMineur(k) ? 12 : 0) + mod12(tonica(k) + Math.round(halveTonen))
  : null);

/** Eén stap op de wijzer: een kwint omhoog (+1) of omlaag (−1). De meest gemaakte fout. */
export const kwint = (k, stap = 1) => transponeer(k, 7 * stap);

/** Relatief (zelfde Camelot-getal, andere letter): C majeur ↔ A mineur. */
export const relatief = (k) => (!isSleutel(k) ? null
  : isMineur(k) ? (tonica(k) + 3) % 12 : 12 + (k + 9) % 12);

/**
 * De 24 sleutels in wijzervolgorde: 1A 1B 2A 2B … 12A 12B. Voor de kiezer
 * in de library en voor `track.N.key` (een encoder loopt de wijzer rond).
 */
export const WIJZER = (() => {
  const uit = [];
  for (let g = 1; g <= 12; g++) {
    for (const mineur of [true, false]) {
      for (let k = mineur ? 12 : 0; k < (mineur ? 24 : 12); k++) {
        if (camelotGetal(k) === g) { uit.push(k); break; }
      }
    }
  }
  return uit;
})();

// ---- zekerheid ---------------------------------------------------------------

/**
 * Wat een zekerheid betekent: 'zeker', 'onzeker' of 'geen'. Een stuk zonder
 * zekerheid is met de hand gezet en telt als zeker; een kaart op slot is
 * overal zeker. Een stuk zonder toonsoort is altijd 'geen'.
 */
export function soortZekerheid(zekerheid, slot = false, toonsoort = 0) {
  if (toonsoort === null) return 'geen';
  if (slot || !eindig(zekerheid)) return 'zeker';
  if (zekerheid >= ZEKER_VANAF) return 'zeker';
  return zekerheid < GEEN_TOON ? 'geen' : 'onzeker';
}

// ---- wat je hoort -----------------------------------------------------------

/** Cent binnen −50..+50 houden; een stemming van +52 is "de volgende, op −48". */
const klemCent = (c) => Math.max(-50, Math.min(50, c));

/**
 * De toonsoort die je HOORT van een stuk van de plaat.
 *
 * @param stuk  { toonsoort (string of sleutel), stemming? (cent) } of { k, stemming }
 * @param rate  afspeelsnelheid (deck.rate, zonder bend)
 * @param transpositie  halve tonen, mag een breuk zijn (keylock-spoor)
 * @param keylock  true = de toon blijft staan, alleen transpositie telt
 * @returns { k, toonsoort, camelot, kort, naam, cent, verschuiving, halveTonen }
 *   `verschuiving` = hele halve tonen t.o.v. de naam op de plaat, `cent` = wat
 *   er daarna overblijft (−50..+50). Zonder toonsoort: k en de namen null.
 */
export function hoorbaar(stuk, { rate = 1, transpositie = 0, keylock = false } = {}) {
  const k = stuk ? (isSleutel(stuk.k) ? stuk.k : leesToonsoort(stuk.toonsoort)) : null;
  const r = eindig(rate) && rate > 0 ? rate : 1;
  const erbij = (eindig(transpositie) ? transpositie : 0)
    + (keylock ? 0 : 12 * Math.log2(r))
    + (eindig(stuk?.stemming) ? stuk.stemming : 0) / 100;
  // Precies op een halve toon (+50 ct) wordt het de volgende op −50: de
  // afwijking blijft altijd binnen −50..+50. `+ 0` maakt van −0 een 0.
  const n = Math.round(erbij) + 0;
  const cent = 100 * (erbij - n);
  const kh = k === null ? null : transponeer(k, n);
  return {
    k: kh, toonsoort: spelling(kh), camelot: camelot(kh), kort: kortNaam(kh), naam: volleNaam(kh),
    cent, verschuiving: n, halveTonen: erbij,
  };
}

// ---- de kaart ----------------------------------------------------------------

/** Velden van een stuk die deze module kent; de rest gaat ongeschonden mee. */
const BEKEND = new Set(['van', 'toonsoort', 'stemming', 'zekerheid', 'tweede']);

/** Een stuk netjes maken; null als het onbruikbaar is. */
function stukVan(s) {
  if (!s || typeof s !== 'object') return null;
  const van = Number(s.van ?? 0);
  if (!eindig(van)) return null;
  // null = met de hand "geen toonsoort"; een onleesbare naam is geen stuk.
  let k = null;
  if (s.toonsoort !== null && s.toonsoort !== undefined) {
    k = leesToonsoort(s.toonsoort);
    if (k === null) return null;
  }
  const uit = { van, k, stemming: eindig(Number(s.stemming)) ? klemCent(Number(s.stemming)) : 0 };
  if (eindig(s.zekerheid)) uit.zekerheid = Math.max(0, Math.min(1, s.zekerheid));
  // De tweede kandidaat van de analyse (optioneel): voor de tooltip.
  const tweede = s.tweede === null || s.tweede === undefined ? null : leesToonsoort(s.tweede);
  if (tweede !== null) uit.tweede = tweede;
  const extra = {};
  for (const [sleutel, v] of Object.entries(s)) if (!BEKEND.has(sleutel)) extra[sleutel] = v;
  if (Object.keys(extra).length) uit.extra = extra;
  return uit;
}

export class ToonKaart {
  /**
   * @param data { versie?, stemming?, stukken: [{ van, toonsoort, stemming, zekerheid?, tweede? }],
   *               bron?: 'auto'|'hand', slot? } — het formaat van TOONSOORT.md §3.
   */
  constructor(data = {}) {
    const d = data || {};
    let stukken = Array.isArray(d.stukken) ? d.stukken.map(stukVan).filter(Boolean) : [];
    if (!stukken.length) stukken = [{ van: 0, k: null, stemming: 0 }];
    this._stukken = stukken;
    this._sorteer();
    // `versie` = versie van de analyse; de server heranalyseert oudere auto-kaarten.
    this.versie = Number.isInteger(d.versie) ? d.versie : null;
    // Stemming van het geheel (cent), zoals de analyse hem vond. Alleen data.
    this.stemming = eindig(Number(d.stemming)) && d.stemming !== null ? klemCent(Number(d.stemming)) : null;
    this.bron = d.bron === 'auto' || d.bron === 'hand' ? d.bron : null;
    // `slot`: met de hand bevestigd. De analyse blijft er dan altijd af, en
    // de hele kaart telt als zeker (zoals het grid).
    this.slot = !!d.slot;
    // Wat we niet kennen gaat ongeschonden terug naar de server.
    this._extra = {};
    for (const [sleutel, v] of Object.entries(d)) {
      if (!['versie', 'stemming', 'stukken', 'bron', 'slot'].includes(sleutel)) this._extra[sleutel] = v;
    }
  }

  _sorteer() {
    this._stukken.sort((a, b) => a.van - b.van);
    // Twee stukken op dezelfde plek: de laatste wint.
    this._stukken = this._stukken.filter((s, i, l) => i === l.length - 1 || l[i + 1].van - s.van > EPS);
  }

  /** Kopieën in het formaat van de kaart (toonsoort als tekst). */
  get stukken() { return this._stukken.map(stukNaarJson); }
  get aantalStukken() { return this._stukken.length; }

  /** Index van het stuk waar tracktijd t in valt (vóór het eerste stuk: 0). */
  stukIndex(t) {
    const s = this._stukken;
    const x = eindig(t) ? t : -Infinity;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].van <= x + EPS) lo = m; else hi = m - 1; }
    return lo;
  }

  /**
   * Het stuk rond tracktijd t: { index, van, tot, k, toonsoort, stemming,
   * zekerheid, tweede, soort }. `tot` is de `van` van het volgende stuk, of
   * Infinity. `soort` = 'zeker' | 'onzeker' | 'geen' (slot telt mee).
   */
  stukAt(t) {
    const i = this.stukIndex(t);
    const s = this._stukken[i];
    return {
      index: i, van: s.van, tot: this._stukken[i + 1]?.van ?? Infinity,
      k: s.k, toonsoort: spelling(s.k), stemming: s.stemming,
      zekerheid: s.zekerheid ?? null, tweede: s.tweede ?? null,
      soort: soortZekerheid(s.zekerheid, this.slot, s.k),
    };
  }

  /** 'zeker', 'onzeker' of 'geen' op tracktijd t. */
  soortBij(t) { return this.stukAt(t).soort; }

  /**
   * Wat je HOORT op tracktijd t, met de plaat erbij voor de tooltip:
   * hoorbaar() + { soort, zekerheid, plaat: { k, stemming }, tweede (hoorbaar
   * verschoven, of null), index, aantal, slot, bron }.
   */
  hoorbaarBij(t, opties = {}) {
    const s = this.stukAt(t);
    const h = hoorbaar(s, opties);
    return {
      ...h,
      soort: s.soort, zekerheid: s.zekerheid,
      plaat: { k: s.k, stemming: s.stemming },
      tweede: s.tweede === null ? null : transponeer(s.tweede, h.verschuiving),
      index: s.index, aantal: this._stukken.length, slot: this.slot, bron: this.bron,
    };
  }

  /**
   * De hoofdtoonsoort van de plaat, voor de library: de toonsoort die de meeste
   * tijd klinkt. Stukken zonder duidelijke toonsoort ('geen') tellen alleen als
   * er niets anders is. `anderen` = hoeveel ANDERE toonsoorten er in de kaart
   * staan (voor "3A B♭m +4"). Het laatste stuk loopt tot `duur`; onbekend = een minuut.
   * @returns { k, soort, aandeel, anderen, stemming } of null als er nergens een toonsoort is.
   */
  hoofd(duur = null) {
    const s = this._stukken;
    const eind = duur > 0 ? Math.max(duur, s.at(-1).van) : s.at(-1).van + 60;
    const tijd = (i) => Math.max(0, (i + 1 < s.length ? s[i + 1].van : eind) - Math.max(0, i === 0 ? 0 : s[i].van));
    const telOp = (metGeen) => {
      const per = new Map();
      s.forEach((x, i) => {
        if (x.k === null) return;
        const soort = soortZekerheid(x.zekerheid, this.slot, x.k);
        if (!metGeen && soort === 'geen') return;
        const p = per.get(x.k) || { d: 0, z: 0, zd: 0, st: 0 };
        const d = tijd(i);
        p.d += d; p.st += d * x.stemming;
        if (eindig(x.zekerheid)) { p.z += d * x.zekerheid; p.zd += d; }
        per.set(x.k, p);
      });
      return per;
    };
    let per = telOp(false);
    if (!per.size) per = telOp(true);
    if (!per.size) return null;
    let beste = null;
    for (const [k, p] of per) if (!beste || p.d > beste.p.d + EPS) beste = { k, p };
    const totaal = s.reduce((a, _, i) => a + tijd(i), 0) || 1;
    const sleutels = new Set(s.filter((x) => x.k !== null).map((x) => x.k));
    // Zekerheid van de hoofdtoonsoort: tijdgewogen over zijn stukken (hand = zeker).
    const z = beste.p.zd > 0 && beste.p.zd >= beste.p.d - EPS ? beste.p.z / beste.p.zd : null;
    return {
      k: beste.k,
      soort: soortZekerheid(z, this.slot, beste.k),
      zekerheid: z,
      aandeel: beste.p.d / totaal,
      anderen: sleutels.size - 1,
      stemming: beste.p.d > 0 ? beste.p.st / beste.p.d : 0,
    };
  }

  // ---- bewerken: alleen het stuk rond t (TOONSOORT.md §7) -----------------------
  // Met de hand gezet = zeker: de zekerheid en de tweede kandidaat van de
  // analyse vallen weg, want die gingen over wat er eerst stond. De kaart
  // wordt bron 'hand' (dat doet het deck, zoals gridGewijzigd).

  _pas(t, fn) {
    const s = this._stukken[this.stukIndex(t)];
    const voor = s.k;
    fn(s);
    if (s.k !== voor) { delete s.zekerheid; delete s.tweede; delete s.extra; }
    return this;
  }

  /** Toonsoort van het stuk rond t zetten (tekst, sleutel of null = geen toonsoort). */
  zetStuk(t, { toonsoort, stemming } = {}) {
    return this._pas(t, (s) => {
      const k = toonsoort === null || toonsoort === undefined ? null : leesToonsoort(toonsoort);
      if (toonsoort === null || k !== null) {
        s.k = k;
        // Opnieuw bevestigd, ook als het dezelfde toonsoort is: met de hand = zeker.
        delete s.zekerheid; delete s.tweede; delete s.extra;
      }
      if (eindig(stemming)) s.stemming = klemCent(stemming);
    });
  }

  /** Eén stap op de wijzer (kwint) voor het stuk rond t. Zonder toonsoort: niets. */
  kwint(t, stap = 1) { return this._pas(t, (s) => { if (s.k !== null) s.k = kwint(s.k, stap); }); }

  /** Majeur ↔ mineur met hetzelfde Camelot-getal (relatief). */
  wisselModus(t) { return this._pas(t, (s) => { if (s.k !== null) s.k = relatief(s.k); }); }

  /** Een halve toon: de fout rond ±50 cent. */
  halveToon(t, stap = 1) { return this._pas(t, (s) => { if (s.k !== null) s.k = transponeer(s.k, stap); }); }

  /** "Geen toonsoort" voor het stuk rond t. */
  geen(t) { return this._pas(t, (s) => { s.k = null; }); }

  /**
   * Nieuw stuk vanaf t, met dezelfde toonsoort, stemming en zekerheid als het
   * stuk waar je in zat: er verandert niets, pas je daarna iets aan, dan
   * alleen vanaf hier. False als er op t al een stuk begint.
   */
  splits(t) {
    if (!eindig(t) || this._stukken.some((s) => Math.abs(s.van - t) < EPS)) return false;
    const s = this._stukken[this.stukIndex(t)];
    const nieuw = { van: t, k: s.k, stemming: s.stemming };
    if (eindig(s.zekerheid)) nieuw.zekerheid = s.zekerheid;
    if (s.tweede !== undefined) nieuw.tweede = s.tweede;
    this._stukken.push(nieuw);
    this._sorteer();
    return true;
  }

  /**
   * De hele kaart vervangen door één stuk (de kiezer in de library): voor een
   * nummer van één stuk is dat het nummer, voor een album een bewuste keuze.
   * De stemming blijft die van de hoofdtoonsoort (de A verandert niet omdat je
   * de naam corrigeert).
   */
  vervangDoorEen(toonsoort) {
    const k = toonsoort === null ? null : leesToonsoort(toonsoort);
    if (toonsoort !== null && k === null) return this;
    const h = this.hoofd();
    const stemming = this.stemming ?? h?.stemming ?? this._stukken[0].stemming ?? 0;
    this._stukken = [{ van: 0, k, stemming: klemCent(Math.round(stemming * 10) / 10) }];
    return this;
  }

  // ---- opslaan ---------------------------------------------------------------

  toJSON() {
    const uit = { ...this._extra };
    if (this.versie !== null) uit.versie = this.versie;
    if (this.stemming !== null) uit.stemming = this.stemming;
    uit.stukken = this.stukken;
    if (this.bron) uit.bron = this.bron;
    uit.slot = this.slot;
    return uit;
  }

  /** Een kaart uit JSON, of null als er niets bruikbaars in staat. */
  static van(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.stukken)) return null;
    if (!data.stukken.some((s) => stukVan(s))) return null;
    return new ToonKaart(data);
  }

  /** Een nieuwe kaart van één stuk, met de hand gezet. */
  static metHand(toonsoort, stemming = 0) {
    return new ToonKaart({ stukken: [{ van: 0, toonsoort, stemming }], bron: 'hand' });
  }

  kopie() { return new ToonKaart(this.toJSON()); }
}

function stukNaarJson(s) {
  const uit = { ...(s.extra || {}), van: s.van, toonsoort: spelling(s.k), stemming: s.stemming };
  if (eindig(s.zekerheid)) uit.zekerheid = s.zekerheid;
  if (s.tweede !== undefined && s.tweede !== null) uit.tweede = spelling(s.tweede);
  return uit;
}
