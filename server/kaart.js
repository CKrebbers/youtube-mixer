import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { run } from './ingest.js';

/**
 * De muziekkaart als ZOEKLAAG in Varve (docs/KAART.md, contract 10 okt 2026).
 *
 * De muziekkaart (~/Projects/muziekkaart) schrijft `varve-kaart.json`: alle
 * 18.763 nummers die Clay ooit draaide (YouTube én Spotify), plus kratten
 * (eigen playlists en slimme selecties). Varve LEEST dat bestand alleen en
 * haalt niets vanzelf binnen: 0 bytes per nummer tot Clay (of de
 * nachtwachtrij, server/nacht.js) erom vraagt.
 *
 * Drie dingen zitten hier:
 * 1. de kaart zelf: laden, herladen als het bestand verandert (een mtime-
 *    controle per verzoek), een index in het geheugen waarin zoeken, filteren,
 *    sorteren en pagineren in milliseconden gaan;
 * 2. de koppeling aan de library: een nummer is "binnen" als zijn youtube_id
 *    een `tracks.id` is (contract §2; alternatieven tellen NIET mee);
 * 3. de wenslijst en het logboek van de nachtwachtrij, in een EIGEN database
 *    `media/kaart.db` (node:sqlite, eigen schema met versie). `library.db` en
 *    zijn SCHEMA blijven ongewijzigd: de kaart is een laag ernaast.
 *
 * Een YouTube-versie zoeken voor een Spotify-nummer gaat met
 * `yt-dlp "ytsearch5:<artiest> <titel>" --flat-playlist -J`, zonder enige
 * cookie-optie (test/kaart.test.mjs bewaakt dat over alle server/*.js). De
 * aanroep is injecteerbaar (`zoeker`), zodat de tests nooit het netwerk raken.
 */

/** Standaardpad van het bestand dat de muziekkaart schrijft. */
export const STANDAARD_PAD = `${homedir()}/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json`;

/** Sorteringen uit het contract. `beurten` is de standaard, aflopend. Niets anders. */
export const SORTERINGEN = {
  beurten: { veld: 'beurten', eerst: 'af' },
  laatst: { veld: 'laatst', eerst: 'af' },
  titel: { veld: 'titel_sleutel', eerst: 'op' },
  artiest: { veld: 'artiest_sleutel', eerst: 'op' },
  duur: { veld: 'duur', eerst: 'op' },
  like_datum: { veld: 'like_datum', eerst: 'af' },
  gekeken: { veld: 'gekeken', eerst: 'af' },
  // Extra (niet in het contract): de volgorde van de krat zelf, voor playlists.
  krat: { veld: null, eerst: 'op' },
};
export const isSortering = (s) => typeof s === 'string' && Object.hasOwn(SORTERINGEN, s);

/** Filters uit het contract. De slimme heten net als hun krat (`slim:<naam>`). */
export const FILTERS = ['binnen', 'niet-binnen', 'geen-video', 'vertrouwd', 'vergeten', 'evergreens',
  'geliket-nooit-gespeeld', 'eigen-keuze', 'eigen-likes'];
export const MAX_PER_PAGINA = 500;
/** Meer wensen in één keer dan dit vraagt om `bevestig: true` (409 "meer dan 20"). */
export const MAX_WENSEN_ZONDER_BEVESTIGING = 20;
/** Vanaf deze score is een gevonden YouTube-versie "zeker" en mag hij vanzelf gekozen worden. */
export const ZEKER = 0.9;
export const WENS_STATUSSEN = ['wacht', 'zoekt', 'kies', 'bezig', 'klaar', 'mislukt', 'geannuleerd'];

/**
 * De slimme kratten als regels, voor als het bestand ze mist (het contract
 * zegt dat ze er altijd zijn, ook leeg; maar een filter mag niet omvallen op
 * een oudere kaart). De tekst van `regel` komt uit het bestand.
 */
export const SLIM = {
  vertrouwd: (n) => (n.beurten ?? 0) >= 25 && !!n.youtube_id && n.klasse === 'muziek' && (n.vorm === 'nummer' || n.vorm == null),
  vergeten: (n) => (n.beurten ?? 0) >= 25 && n.eerst != null && n.eerst < '2023' && (n.laatst == null || n.laatst < '2024-01-01'),
  evergreens: (n) => Object.keys(n.per_jaar ?? {}).length >= 5 && (n.beurten ?? 0) >= 50,
  'geliket-nooit-gespeeld': (n) => n.like === 'eigen' && !(n.beurten > 0),
  'eigen-keuze': (n) => (n.gekozen ?? 0) >= 10 && (n.beurten ?? 0) > 0 && n.gekozen / n.beurten >= 0.5,
  'eigen-likes': (n) => n.like === 'eigen',
};

/** Fout met een HTTP-code, zodat de route hem één op één kan doorgeven: `{ fout, ...extra }`. */
export class KaartFout extends Error {
  constructor(code, fout, extra = {}) { super(fout); this.code = code; this.extra = extra; }
  antwoord() { return { fout: this.message, ...this.extra }; }
}

/** Kleine letters, zonder accenten: zo zoekt de kaart ook (`zoek`-veld). */
export function plat(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Eén nummer uit het bestand netjes maken: elk veld bestaat, plus twee sorteersleutels. */
export function normaliseerNummer(r) {
  const n = {
    sleutel: String(r.sleutel ?? ''), youtube_id: r.youtube_id ?? null,
    alternatieven: Array.isArray(r.alternatieven) ? r.alternatieven.filter((x) => typeof x === 'string') : [],
    spotify_uri: r.spotify_uri ?? null, artiest: String(r.artiest ?? ''), titel: String(r.titel ?? ''),
    versie: String(r.versie ?? ''), kanaal: r.kanaal ?? null, youtube_titel: r.youtube_titel ?? null,
    duur: typeof r.duur === 'number' && Number.isFinite(r.duur) ? r.duur : null, duur_bron: r.duur_bron ?? null,
    klasse: r.klasse === 'twijfel' ? 'twijfel' : 'muziek', vorm: r.vorm ?? null,
    beurten: typeof r.beurten === 'number' ? r.beurten : null, gekozen: typeof r.gekozen === 'number' ? r.gekozen : null,
    overgeslagen: typeof r.overgeslagen === 'number' ? r.overgeslagen : null, uren: typeof r.uren === 'number' ? r.uren : null,
    eerst: r.eerst ?? null, laatst: r.laatst ?? null,
    per_jaar: r.per_jaar && typeof r.per_jaar === 'object' ? r.per_jaar : {},
    like: r.like === 'eigen' || r.like === 'overzet' ? r.like : null, like_datum: r.like_datum ?? null,
    playlists: Array.isArray(r.playlists) ? r.playlists : [],
    gekeken: typeof r.gekeken === 'number' ? r.gekeken : null, yt_laatst: r.yt_laatst ?? null,
    zoek: typeof r.zoek === 'string' ? r.zoek : '',
  };
  if (!n.zoek) n.zoek = plat(`${n.artiest} ${n.titel} ${n.playlists.join(' ')} ${n.kanaal ?? ''}`);
  // Sorteersleutels (niet naar buiten): titel en artiest zonder accenten, kleine letters.
  Object.defineProperty(n, 'titel_sleutel', { value: plat(n.titel), enumerable: false });
  Object.defineProperty(n, 'artiest_sleutel', { value: plat(n.artiest), enumerable: false });
  return n;
}

/**
 * De score van een zoekresultaat (contract §2): Topic-kanaal of kanaal ==
 * artiest (0,35), lengte binnen 2 s van `duur` (0,4; binnen 5 s de helft),
 * de titel van het resultaat bevat de titel (0,25). Alles raak = 1,0; twee
 * van de drie komt nooit boven ZEKER (0,9). Zonder bekende `duur` is "zeker"
 * dus onbereikbaar: dan kiest Clay zelf. `reden` zegt wat er raak was.
 */
export function scoreKandidaat(n, k) {
  const redenen = [];
  let score = 0;
  const kanaal = plat(k.kanaal);
  const artiest = plat(n.artiest);
  if (kanaal && (/ - topic$/.test(kanaal) || kanaal === artiest || kanaal === `${artiest}vevo` || kanaal === `${artiest} official`)) {
    score += 0.35; redenen.push(/ - topic$/.test(kanaal) ? 'Topic-kanaal' : 'kanaal is de artiest');
  }
  if (typeof n.duur === 'number' && typeof k.duur === 'number') {
    const d = Math.abs(n.duur - k.duur);
    if (d <= 2) { score += 0.4; redenen.push('zelfde lengte'); }
    else if (d <= 5) { score += 0.2; redenen.push(`lengte scheelt ${d.toFixed(0)} s`); }
  }
  const titel = plat(n.titel);
  if (titel && plat(k.titel).includes(titel)) { score += 0.25; redenen.push('titel klopt'); }
  return { score: Math.round(score * 100) / 100, reden: redenen.join(', ') || 'niets herkend' };
}

/** De yt-dlp-uitvoer van `ytsearch5:` (--flat-playlist -J) naar kale kandidaten. */
export function leesZoekresultaat(json) {
  const entries = Array.isArray(json?.entries) ? json.entries : [];
  return entries.filter((e) => e && typeof e.id === 'string' && /^[\w-]{6,20}$/.test(e.id)).map((e) => ({
    youtube_id: e.id, titel: String(e.title ?? ''), kanaal: e.channel ?? e.uploader ?? null,
    duur: typeof e.duration === 'number' ? e.duration : null,
  }));
}

/**
 * De echte zoeker: yt-dlp met `ytsearch5:`. Geen cookie-optie, geen
 * playlist-afloop (--flat-playlist), hooguit 60 s. Geeft altijd een
 * uitkomst terug ({ ok, kandidaten | fout, code }), gooit nooit.
 */
export async function zoekMetYtdlp(vraag, { signal } = {}) {
  const r = await run(process.env.VARVE_YTDLP || 'yt-dlp', [
    `ytsearch5:${vraag}`, '--flat-playlist', '-J', '--no-warnings',
  ], { timeout: 60000, signal });
  if (!r.ok) {
    const regel = String(r.stderr).split(/\r?\n/).find((l) => /^ERROR/i.test(l));
    return { ok: false, fout: regel ? regel.replace(/^ERROR:\s*/i, '').slice(0, 300) : `yt-dlp gaf code ${r.code}` };
  }
  try { return { ok: true, kandidaten: leesZoekresultaat(JSON.parse(r.stdout)) }; } catch { return { ok: false, fout: 'kon het zoekresultaat van yt-dlp niet lezen' }; }
}

/** Eigen schema in kaart.db; achteraan toevoegen, nooit wijzigen (zoals SCHEMA van de library). */
export const KAART_SCHEMA = [
  `
  CREATE TABLE wensen (
    sleutel     TEXT PRIMARY KEY,        -- "yt:…" of "sp:…" uit de kaart
    status      TEXT NOT NULL,           -- wacht | zoekt | kies | bezig | klaar | mislukt | geannuleerd
    gevraagd    INTEGER NOT NULL,        -- ms
    youtube_id  TEXT,                    -- welke video er gehaald wordt (gekozen of uit de kaart)
    fout        TEXT,
    track_id    TEXT,                    -- de track in de library als hij binnen is
    bron        TEXT NOT NULL DEFAULT 'wens',  -- wens (Clay) | nacht (standaardvolgorde)
    kandidaten  TEXT,                    -- JSON van het laatste zoekresultaat
    bijgewerkt  INTEGER NOT NULL
  );
  CREATE INDEX wensen_status ON wensen (status, gevraagd);

  CREATE TABLE nacht_runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    soort     TEXT NOT NULL,             -- nacht | nu
    begonnen  INTEGER NOT NULL,
    klaar     INTEGER,
    gehaald   INTEGER NOT NULL DEFAULT 0,
    mislukt   INTEGER NOT NULL DEFAULT 0,
    reden     TEXT                       -- waarom hij stopte
  );
  `,
];

const vergelijkWaarde = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class Kaart {
  /**
   * @param o.pad       varve-kaart.json; een functie mag ook (de instelling kan veranderen)
   * @param o.db        pad van kaart.db (':memory:' in tests)
   * @param o.library   { alleIds(), track(id) } — de Library, of een nep in de tests
   * @param o.zoeker    async (vraag) => { ok, kandidaten | fout }; standaard yt-dlp
   * @param o.klok      () => ms
   */
  constructor({ pad = STANDAARD_PAD, db, library, zoeker = zoekMetYtdlp, klok = () => Date.now(), log = console.log }) {
    this._pad = pad;
    this.library = library;
    this.zoeker = zoeker;
    this.klok = klok;
    this.log = log;
    this._mtime = null;      // mtimeMs van het geladen bestand
    this._stand = { status: 'ontbreekt', gebouwd: null, fout: null, bron: null };
    this.rijen = [];         // genormaliseerd, in de volgorde van het bestand
    this.perSleutel = new Map();
    this.kratten = [];       // { id, naam, soort, regel, bijgewerkt, sleutels: Set, lijst: [] }
    this._gesorteerd = new Map();   // "sorteer|richting" -> array, weg bij herladen
    if (db && db !== ':memory:') mkdirSync(dirname(db), { recursive: true });
    this.db = new DatabaseSync(db ?? ':memory:');
    this.db.exec('PRAGMA journal_mode = WAL');
    this._migreer();
  }

  get pad() { return typeof this._pad === 'function' ? this._pad() : this._pad; }

  _migreer() {
    const huidig = this.db.prepare('PRAGMA user_version').get().user_version;
    for (let v = huidig; v < KAART_SCHEMA.length; v++) {
      this.db.exec('BEGIN');
      try { this.db.exec(KAART_SCHEMA[v]); this.db.exec(`PRAGMA user_version = ${v + 1}`); this.db.exec('COMMIT'); }
      catch (err) { this.db.exec('ROLLBACK'); throw err; }
    }
  }

  get versie() { return this.db.prepare('PRAGMA user_version').get().user_version; }
  sluit() { this.db.close(); }

  // ---- laden ---------------------------------------------------------------

  /**
   * Laden als het bestand nieuw of veranderd is (mtime). Een stat per verzoek
   * is goedkoop; het lezen van ~10 MB JSON (~100 ms) gebeurt alleen bij een
   * verandering. Een kapot bestand = status 'fout', de vorige kaart blijft staan.
   */
  laad() {
    const pad = this.pad;
    let info;
    try { info = statSync(pad); } catch (err) {
      if (this._stand.status !== 'ontbreekt' || this._stand.pad !== pad) this.log?.(`[kaart] ${pad}: ${err.code === 'ENOENT' ? 'ontbreekt' : err.message}`);
      this._zet([], [], { status: 'ontbreekt', gebouwd: null, fout: err.code === 'ENOENT' ? null : err.message, bron: null, pad });
      this._mtime = null;
      return this._stand;
    }
    if (this._mtime === info.mtimeMs && this._stand.pad === pad && this._stand.status === 'geladen') return this._stand;
    const t0 = performance.now();
    try {
      const j = JSON.parse(readFileSync(pad, 'utf8'));
      if (!Array.isArray(j?.nummers)) throw new Error('geen "nummers" in het bestand');
      const nummers = j.nummers.map(normaliseerNummer).filter((n) => n.sleutel);
      const kratten = (Array.isArray(j.kratten) ? j.kratten : []).filter((k) => k && typeof k.id === 'string').map((k) => ({
        id: k.id, naam: String(k.naam ?? k.id), soort: k.soort === 'slim' ? 'slim' : 'playlist', regel: k.regel ?? null,
        bijgewerkt: k.bijgewerkt ?? null, lijst: Array.isArray(k.sleutels) ? k.sleutels.filter((s) => typeof s === 'string') : [],
      }));
      this._zet(nummers, kratten, { status: 'geladen', gebouwd: j.gebouwd ?? null, fout: null, bron: j.bron ?? null, pad });
      this._mtime = info.mtimeMs;
      this.log?.(`[kaart] ${nummers.length} nummers, ${kratten.length} kratten geladen (${Math.round(performance.now() - t0)} ms, gebouwd ${j.gebouwd ?? '?'})`);
    } catch (err) {
      this._stand = { ...this._stand, status: 'fout', fout: String(err?.message || err), pad };
      this._mtime = info.mtimeMs;   // niet elk verzoek opnieuw proberen; pas bij een nieuw bestand
      this.log?.(`[kaart] ${pad} niet te lezen: ${this._stand.fout}`);
    }
    return this._stand;
  }

  _zet(nummers, kratten, stand) {
    this.rijen = nummers;
    this.perSleutel = new Map(nummers.map((n) => [n.sleutel, n]));
    for (const k of kratten) k.sleutels = new Set(k.lijst);
    // De slimme kratten die het bestand mist: uit de regels, zodat filters en de nacht altijd werken.
    for (const naam of Object.keys(SLIM)) {
      if (kratten.some((k) => k.id === `slim:${naam}`)) continue;
      const lijst = nummers.filter(SLIM[naam]).map((n) => n.sleutel);
      kratten.push({ id: `slim:${naam}`, naam, soort: 'slim', regel: null, bijgewerkt: null, lijst, sleutels: new Set(lijst), afgeleid: true });
    }
    this.kratten = kratten;
    this._gesorteerd.clear();
    this._stand = stand;
  }

  /** Alle track-ids van de library als Set; één query per verzoek (ms). */
  _binnenSet() {
    try { return new Set(this.library?.alleIds?.() ?? []); } catch { return new Set(); }
  }

  /** De track-id als dit nummer binnen is, anders null. Alleen `youtube_id` (contract), geen alternatieven. */
  binnen(n, set = this._binnenSet()) { return n.youtube_id && set.has(n.youtube_id) ? n.youtube_id : null; }

  /** GET /api/kaart */
  stand() {
    this.laad();
    const set = this._binnenSet();
    return {
      status: this._stand.status, pad: this.pad, gebouwd: this._stand.gebouwd, bron: this._stand.bron,
      aantal: this.rijen.length, fout: this._stand.fout,
      kratten: this.kratten.map((k) => ({
        id: k.id, naam: k.naam, soort: k.soort, regel: k.regel, bijgewerkt: k.bijgewerkt, aantal: k.lijst.length,
        binnen: k.lijst.reduce((t, s) => t + (this.binnen(this.perSleutel.get(s) ?? {}, set) ? 1 : 0), 0),
      })),
    };
  }

  krat(id) { return this.kratten.find((k) => k.id === id) ?? null; }

  // ---- zoeken, filteren, sorteren, pagineren -------------------------------

  _gesorteerdeLijst(sorteer, richting) {
    const s = SORTERINGEN[sorteer];
    const r = richting ?? s.eerst;
    const sleutel = `${sorteer}|${r}`;
    let lijst = this._gesorteerd.get(sleutel);
    if (lijst) return lijst;
    const veld = s.veld;
    const teken = r === 'af' ? -1 : 1;
    // Wat geen waarde heeft staat ALTIJD achteraan (zoals de library); gelijk = volgorde van het bestand.
    lijst = this.rijen.map((n, i) => [n, i]).sort(([a, ia], [b, ib]) => {
      const va = a[veld], vb = b[veld];
      const la = va == null || va === '', lb = vb == null || vb === '';
      if (la !== lb) return la ? 1 : -1;
      if (!la) { const c = vergelijkWaarde(va, vb); if (c) return c * teken; }
      return ia - ib;
    }).map(([n]) => n);
    this._gesorteerd.set(sleutel, lijst);
    return lijst;
  }

  /**
   * Een pagina. Gooit KaartFout(400) bij een onbekende sortering, filter of
   * krat; de route geeft die door. Zonder geladen kaart: leeg met totaal 0.
   */
  nummers({ zoek = '', krat = null, filter = '', sorteer = null, richting = null, van = 0, aantal = 100 } = {}) {
    this.laad();
    if (sorteer !== null && !isSortering(sorteer)) throw new KaartFout(400, `sorteer op ${Object.keys(SORTERINGEN).join(', ')}`);
    if (richting !== null && richting !== 'op' && richting !== 'af') throw new KaartFout(400, 'richting is op of af');
    if (!(Number.isSafeInteger(van) && van >= 0)) throw new KaartFout(400, 'van is een rijnummer vanaf 0');
    if (!(Number.isInteger(aantal) && aantal >= 1 && aantal <= MAX_PER_PAGINA)) throw new KaartFout(400, `aantal is 1..${MAX_PER_PAGINA}`);
    const filters = String(filter ?? '').split(',').map((f) => f.trim()).filter(Boolean);
    for (const f of filters) if (!FILTERS.includes(f)) throw new KaartFout(400, `filter is een van ${FILTERS.join(', ')}`);
    let k = null;
    if (krat) { k = this.krat(krat); if (!k) throw new KaartFout(404, 'onbekende krat', { krat }); }
    const sort = sorteer ?? (k ? 'krat' : 'beurten');
    if (sort === 'krat' && !k) throw new KaartFout(400, 'sorteer=krat alleen met een krat');

    const set = this._binnenSet();
    const wensen = this._wensenPerSleutel();
    const z = plat(zoek);
    const slimSets = filters.filter((f) => Object.hasOwn(SLIM, f)).map((f) => this.krat(`slim:${f}`)?.sleutels ?? new Set());
    const past = (n) => {
      if (k && !k.sleutels.has(n.sleutel)) return false;
      if (z && !(n.zoek.includes(z) || n.artiest_sleutel.includes(z) || n.titel_sleutel.includes(z))) return false;
      for (const f of filters) {
        if (f === 'binnen' && !this.binnen(n, set)) return false;
        if (f === 'niet-binnen' && this.binnen(n, set)) return false;
        if (f === 'geen-video' && n.youtube_id) return false;
      }
      for (const s of slimSets) if (!s.has(n.sleutel)) return false;
      return true;
    };
    let bron;
    if (sort === 'krat') {
      bron = (richting === 'af' ? [...k.lijst].reverse() : k.lijst).map((s) => this.perSleutel.get(s)).filter(Boolean);
    } else bron = this._gesorteerdeLijst(sort, richting);
    const treffers = bron.filter(past);
    return {
      nummers: treffers.slice(van, van + aantal).map((n) => this._verrijk(n, set, wensen)),
      totaal: treffers.length, van, status: this._stand.status,
    };
  }

  /** Eén nummer met `binnen` en `wens`, of null. */
  nummer(sleutel) {
    this.laad();
    const n = this.perSleutel.get(sleutel);
    return n ? this._verrijk(n, this._binnenSet(), this._wensenPerSleutel()) : null;
  }

  _verrijk(n, set, wensen) {
    const w = wensen.get(n.sleutel);
    return { ...n, binnen: this.binnen(n, set), wens: w ? { status: w.status, fout: w.fout, youtube_id: w.youtube_id } : null };
  }

  // ---- wensen ----------------------------------------------------------------

  _wensenPerSleutel() {
    return new Map(this.db.prepare('SELECT sleutel, status, fout, youtube_id FROM wensen').all().map((w) => [w.sleutel, w]));
  }

  wens(sleutel) { return this.db.prepare('SELECT * FROM wensen WHERE sleutel = ?').get(sleutel) ?? null; }

  /**
   * GET /api/kaart/wensen: alles, oudste eerst, met de track als hij binnen is.
   * `licht` (?licht=1, de companion die elke 5 s peilt): zonder `track` en
   * `nummer`, en de kandidaten alleen bij een wens op `kies`. Een klare wens met
   * zijn track woog op de nep-kaart ~1,4 kB; de lijst groeit met elke nacht.
   */
  wensen({ licht = false } = {}) {
    if (licht) {
      return this.db.prepare('SELECT * FROM wensen ORDER BY gevraagd, rowid').all().map((w) => ({
        sleutel: w.sleutel, status: w.status, gevraagd: w.gevraagd, youtube_id: w.youtube_id, fout: w.fout, bron: w.bron,
        kandidaten: w.status === 'kies' && w.kandidaten ? JSON.parse(w.kandidaten) : null,
      }));
    }
    const set = this._binnenSet();
    return this.db.prepare('SELECT * FROM wensen ORDER BY gevraagd, rowid').all().map((w) => ({
      sleutel: w.sleutel, status: w.status, gevraagd: w.gevraagd, youtube_id: w.youtube_id, fout: w.fout, bron: w.bron,
      bijgewerkt: w.bijgewerkt, kandidaten: w.kandidaten ? JSON.parse(w.kandidaten) : null,
      track: (w.track_id && set.has(w.track_id) && this.library.track?.(w.track_id)) || null,
      nummer: this.perSleutel.get(w.sleutel) ? { artiest: this.perSleutel.get(w.sleutel).artiest, titel: this.perSleutel.get(w.sleutel).titel } : null,
    }));
  }

  /**
   * POST /api/kaart/wens. Dubbele (in de vraag of al op de lijst) en al-binnen
   * sleutels worden geweigerd met reden. Meer dan 20 zonder `bevestig` = 409.
   * Een `sp:`-sleutel zonder youtube_id komt gewoon op `wacht`: de nacht zoekt
   * dan eerst een versie (of Clay doet dat met …/zoek). `bron` 'nacht' is voor
   * wat de standaardvolgorde zelf oppakt (zodat het niet elke nacht opnieuw probeert).
   */
  voegWensen(sleutels, { bevestig = false, bron = 'wens' } = {}) {
    this.laad();
    if (!Array.isArray(sleutels) || !sleutels.length) throw new KaartFout(400, 'geef { sleutels: [..] }');
    if (sleutels.length > MAX_WENSEN_ZONDER_BEVESTIGING && !bevestig) {
      throw new KaartFout(409, `meer dan ${MAX_WENSEN_ZONDER_BEVESTIGING}`, { aantal: sleutels.length });
    }
    const set = this._binnenSet();
    const nu = this.klok();
    const toegevoegd = [], geweigerd = [];
    const gezien = new Set();
    const st = this.db.prepare(`INSERT INTO wensen (sleutel, status, gevraagd, youtube_id, fout, track_id, bron, kandidaten, bijgewerkt)
      VALUES (?, 'wacht', ?, ?, NULL, NULL, ?, NULL, ?)`);
    for (const s of sleutels) {
      if (typeof s !== 'string') { geweigerd.push({ sleutel: String(s), reden: 'geen sleutel' }); continue; }
      if (gezien.has(s)) { geweigerd.push({ sleutel: s, reden: 'dubbel in de vraag' }); continue; }
      gezien.add(s);
      const n = this.perSleutel.get(s);
      if (!n) { geweigerd.push({ sleutel: s, reden: 'niet op de kaart' }); continue; }
      if (this.binnen(n, set)) { geweigerd.push({ sleutel: s, reden: 'al binnen' }); continue; }
      const al = this.wens(s);
      if (al && al.status !== 'geannuleerd' && al.status !== 'mislukt') { geweigerd.push({ sleutel: s, reden: `staat al op de lijst (${al.status})` }); continue; }
      if (al) this.db.prepare('DELETE FROM wensen WHERE sleutel = ?').run(s);   // opnieuw proberen mag
      st.run(s, nu, n.youtube_id, bron, nu);
      toegevoegd.push(s);
    }
    return { ok: true, toegevoegd, geweigerd };
  }

  /** DELETE /api/kaart/wens/<sleutel>: weg van de lijst (ook als hij 'bezig' is: de ingest loopt dan af). */
  verwijderWens(sleutel) {
    return this.db.prepare('DELETE FROM wensen WHERE sleutel = ?').run(sleutel).changes > 0;
  }

  /** Status (en wat erbij hoort) van een wens zetten. Onbekende status gooit. */
  zetWens(sleutel, { status, fout = null, youtube_id, track_id, kandidaten } = {}) {
    if (status && !WENS_STATUSSEN.includes(status)) throw new Error(`onbekende wens-status: ${status}`);
    const w = this.wens(sleutel);
    if (!w) return null;
    this.db.prepare(`UPDATE wensen SET status = ?, fout = ?, youtube_id = ?, track_id = ?, kandidaten = ?, bijgewerkt = ? WHERE sleutel = ?`)
      .run(status ?? w.status, fout, youtube_id === undefined ? w.youtube_id : youtube_id,
        track_id === undefined ? w.track_id : track_id,
        kandidaten === undefined ? w.kandidaten : (kandidaten == null ? null : JSON.stringify(kandidaten)), this.klok(), sleutel);
    return this.wens(sleutel);
  }

  /** De oudste wens die wacht (rule 2 van de nacht: wensen eerst). */
  volgendeWens() {
    return this.db.prepare("SELECT * FROM wensen WHERE status = 'wacht' ORDER BY gevraagd, rowid LIMIT 1").get() ?? null;
  }

  /**
   * De standaardvolgorde van de nacht (contract §2 regel 2): eerst
   * `slim:vertrouwd`, dan `slim:eigen-likes` op beurten aflopend. Nooit wat
   * al binnen is of al een wens heeft (ook niet mislukt: dat probeert de
   * nacht niet elke nacht opnieuw), nooit `twijfel`, nooit vorm set/stream/
   * lang/album, nooit langer dan 15 min, en alleen met een youtube_id
   * (vanzelf zoeken doet de nacht alleen voor een WENS). "Nooit overzet-only"
   * volgt vanzelf: de likes-tak neemt alleen `like = eigen`, en een vertrouwd
   * nummer met een overzet-like is vertrouwd om zijn beurten.
   * Geeft sleutels, zonder dubbele.
   */
  standaardVolgorde({ grens = Infinity } = {}) {
    this.laad();
    const set = this._binnenSet();
    const wensen = this._wensenPerSleutel();
    const mag = (n) => n && n.youtube_id && !this.binnen(n, set) && !wensen.has(n.sleutel) && n.klasse === 'muziek'
      && !['set', 'stream', 'lang', 'album'].includes(n.vorm) && !(n.duur > 15 * 60);
    const uit = [];
    const gezien = new Set();
    const neem = (lijst) => {
      for (const s of lijst) {
        if (uit.length >= grens) return;
        const n = this.perSleutel.get(s);
        if (!gezien.has(s) && mag(n)) { gezien.add(s); uit.push(s); }
      }
    };
    const opBeurten = (sleutels) => [...sleutels].map((s) => this.perSleutel.get(s)).filter(Boolean)
      .sort((a, b) => (b.beurten ?? -1) - (a.beurten ?? -1)).map((n) => n.sleutel);
    neem(opBeurten(this.krat('slim:vertrouwd')?.lijst ?? []));
    neem(opBeurten((this.krat('slim:eigen-likes')?.lijst ?? []).filter((s) => this.perSleutel.get(s)?.like === 'eigen')));
    return uit;
  }

  // ---- een YouTube-versie zoeken --------------------------------------------

  /**
   * POST …/zoek: kandidaten met score, beste eerst. Bewaart ze bij de wens
   * (als die er is). Gooit KaartFout(404) voor een onbekende sleutel en
   * KaartFout(502) als yt-dlp niets gaf (met de fout van yt-dlp erin, zodat
   * een 403/429 herkenbaar blijft voor de nacht).
   */
  async zoek(sleutel, { signal } = {}) {
    this.laad();
    const n = this.perSleutel.get(sleutel);
    if (!n) throw new KaartFout(404, 'niet op de kaart');
    const vraag = `${n.artiest} ${n.titel}`.trim() || n.youtube_titel || sleutel;
    if (this.wens(sleutel)?.status === 'wacht') this.zetWens(sleutel, { status: 'zoekt' });
    const r = await this.zoeker(vraag, { signal });
    if (!r.ok) {
      if (this.wens(sleutel)?.status === 'zoekt') this.zetWens(sleutel, { status: 'wacht', fout: r.fout });
      throw new KaartFout(502, `zoeken mislukt: ${r.fout}`);
    }
    const kandidaten = r.kandidaten.map((k) => ({ ...k, ...scoreKandidaat(n, k) })).sort((a, b) => b.score - a.score);
    if (this.wens(sleutel)?.status === 'zoekt') this.zetWens(sleutel, { status: 'kies', kandidaten });
    return { kandidaten, vraag };
  }

  /** POST …/kies { youtube_id }: de wens krijgt deze video en gaat (terug) op `wacht`. Geen wens = er komt er een. */
  kies(sleutel, youtube_id) {
    this.laad();
    if (typeof youtube_id !== 'string' || !/^[\w-]{6,20}$/.test(youtube_id)) throw new KaartFout(400, 'youtube_id is een video-id');
    const n = this.perSleutel.get(sleutel);
    if (!n) throw new KaartFout(404, 'niet op de kaart');
    if (!this.wens(sleutel)) {
      const nu = this.klok();
      this.db.prepare(`INSERT INTO wensen (sleutel, status, gevraagd, youtube_id, bron, bijgewerkt) VALUES (?, 'wacht', ?, ?, 'wens', ?)`).run(sleutel, nu, youtube_id, nu);
    }
    return this.zetWens(sleutel, { status: 'wacht', fout: null, youtube_id, track_id: null });
  }

  // ---- nacht_runs --------------------------------------------------------------

  beginRun(soort, begonnen) {
    return Number(this.db.prepare('INSERT INTO nacht_runs (soort, begonnen) VALUES (?, ?)').run(soort, begonnen).lastInsertRowid);
  }

  eindRun(id, { klaar, gehaald, mislukt, reden }) {
    this.db.prepare('UPDATE nacht_runs SET klaar = ?, gehaald = ?, mislukt = ?, reden = ? WHERE id = ?').run(klaar, gehaald, mislukt, reden, id);
  }

  laatsteRun() {
    const r = this.db.prepare('SELECT * FROM nacht_runs ORDER BY id DESC LIMIT 1').get();
    return r ? { begonnen: r.begonnen, klaar: r.klaar, gehaald: r.gehaald, mislukt: r.mislukt, reden: r.reden, soort: r.soort } : null;
  }

  runs(aantal = 30) { return this.db.prepare('SELECT * FROM nacht_runs ORDER BY id DESC LIMIT ?').all(aantal); }
}
