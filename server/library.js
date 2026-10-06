import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { bronVan } from './links.js';
import { TOON_VERSIE, leesToonsoort, toonsoortNaam } from './toon.js';
import { SECTIE_VERSIE, gridSleutel } from './secties.js';
import { TWIJFELS } from '../src/engine/beatgrid.js';

/**
 * De library: wat er binnengehaald is, en wat erbij hoort.
 *
 * De belangrijkste keuze zit in de tabel `racks`. Een effect-rack hangt aan een
 * TRACK_ID, oftewel aan de link — niet aan een fader of een kanaal. Laad je
 * hetzelfde nummer morgen op een andere track, dan komen zijn racks mee. Er
 * kunnen er meerdere per nummer zijn, met één als actieve.
 *
 * Racks worden hier bewust als JSON-tekst bewaard. Wat er ín een rack staat is
 * een zaak van de FX-laag die er nog niet is; de library hoeft dat niet te
 * kennen om het te kunnen onthouden. Zo hoeft het schema niet mee te veranderen
 * met elk nieuw effect.
 */

export const SCHEMA = [
  // versie 1
  `
  CREATE TABLE tracks (
    id            TEXT PRIMARY KEY,      -- de YouTube-id; dit ís de link
    url           TEXT NOT NULL UNIQUE,
    titel         TEXT NOT NULL,
    uploader      TEXT,
    duur          REAL,                  -- seconden
    audio         TEXT NOT NULL,         -- pad, relatief aan de projectmap
    video         TEXT,
    thumbnail     TEXT,
    loudness_i    REAL, loudness_tp REAL, loudness_lra REAL,
    loudness_drempel REAL, loudness_offset REAL,
    doel_loudness REAL,
    ytdlp         TEXT,                  -- met welke versie binnengehaald
    toegevoegd    INTEGER NOT NULL,
    laatst_geladen INTEGER,
    keer_geladen  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE peaks (
    track_id      TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    bestand       TEXT NOT NULL,
    buckets       INTEGER NOT NULL,
    per_bucket    INTEGER NOT NULL,
    gemaakt       INTEGER NOT NULL
  );

  CREATE TABLE racks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    naam          TEXT NOT NULL,
    data          TEXT NOT NULL,         -- JSON; de FX-laag bepaalt de inhoud
    actief        INTEGER NOT NULL DEFAULT 0,
    gemaakt       INTEGER NOT NULL,
    gewijzigd     INTEGER NOT NULL
  );
  CREATE INDEX racks_track ON racks(track_id);

  CREATE TABLE instellingen (
    sleutel       TEXT PRIMARY KEY,
    waarde        TEXT NOT NULL
  );
  `,
  // versie 2 — het beatgrid hoort bij de link, net als de racks. Meet je een
  // track één keer uit, dan klopt hij voorgoed, op welke track je hem ook laadt.
  `
  ALTER TABLE tracks ADD COLUMN grid_bpm REAL;
  ALTER TABLE tracks ADD COLUMN grid_first_beat REAL;
  ALTER TABLE tracks ADD COLUMN grid_beats_per_bar INTEGER;
  `,
  // versie 3 — de onset-envelope bewaren, zodat de tap-hybride de audio niet
  // opnieuw hoeft te lezen.
  `
  ALTER TABLE tracks ADD COLUMN onset_bestand TEXT;
  ALTER TABLE tracks ADD COLUMN onset_frames INTEGER;
  ALTER TABLE tracks ADD COLUMN onset_rate REAL;
  ALTER TABLE tracks ADD COLUMN onset_offset REAL;
  `,
  // versie 4 — sampler-pads bij het nummer. Geen audio: alleen WAAR het stuk
  // zit, in tracktijd. Het knippen gebeurt opnieuw van schijf.
  `
  CREATE TABLE samples (
    track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    pad           INTEGER NOT NULL,      -- 1..8
    van           REAL NOT NULL,         -- seconden tracktijd
    tot           REAL NOT NULL,
    tellen        INTEGER,
    bpm           REAL,                  -- null = zonder grid geknipt
    gemaakt       INTEGER NOT NULL,
    PRIMARY KEY (track_id, pad)
  );
  `,
  // versie 5 — het grid als TEMPOKAART: een lijst stukken { van, bpm, anker }
  // als JSON, zoals de racks. Een bestaand grid wordt één stuk. De oude
  // kolommen blijven bestaan en krijgen het eerste stuk, zodat een oudere
  // versie nog iets zinnigs ziet.
  `
  ALTER TABLE tracks ADD COLUMN grid_json TEXT;
  UPDATE tracks SET grid_json = json_object(
      'stukken', json_array(json_object('van', 0, 'bpm', grid_bpm, 'anker', COALESCE(grid_first_beat, 0))),
      'beatsPerBar', COALESCE(grid_beats_per_bar, 4))
    WHERE grid_bpm IS NOT NULL;
  `,
  // versie 6 — de TOONSOORT als kaart, zoals het grid: { versie, stemming,
  // stukken: [{ van, toonsoort, stemming, zekerheid }], bron, slot } als JSON.
  // Zie docs/TOONSOORT.md §3.
  `
  ALTER TABLE tracks ADD COLUMN toon_json TEXT;
  `,
  // versie 7 — hotcues bij het nummer, zoals de sampler-pads: WAAR ze staan, in
  // tracktijd. Laad je het nummer opnieuw, dan staan ze er weer.
  // En de lijst voorbij 200 nummers: een sorteersleutel voor de titel die
  // vooraf is uitgerekend (sorteertitel() per rij per verzoek kostte bij 5000
  // nummers tientallen ms) en een index per sorteerkolom.
  // Toonsoort (6) en library (7) zijn tegelijk gebouwd, elk als eigen element
  // achteraan; bij het samenvoegen (25 sep) is dit de volgorde geworden. Draai
  // nooit een server van één van beide sporen alleen op de echte library.db:
  // dan krijgt die zijn element als v6 en past de volgorde niet meer.
  `
  CREATE TABLE hotcues (
    track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    nr            INTEGER NOT NULL,      -- 1..MAX_HOTCUES (het deck heeft er nu 4)
    tijd          REAL NOT NULL,         -- seconden tracktijd
    gemaakt       INTEGER NOT NULL,
    PRIMARY KEY (track_id, nr)
  );
  ALTER TABLE tracks ADD COLUMN titel_sleutel TEXT;
  UPDATE tracks SET titel_sleutel = sorteertitel(titel);
  CREATE INDEX tracks_titel ON tracks(titel_sleutel, toegevoegd);
  CREATE INDEX tracks_bpm ON tracks(grid_bpm, toegevoegd);
  CREATE INDEX tracks_duur ON tracks(duur, toegevoegd);
  CREATE INDEX tracks_toegevoegd ON tracks(toegevoegd);
  CREATE INDEX tracks_gespeeld ON tracks(laatst_geladen, toegevoegd);
  `,
  // versie 8 — stems (docs/STEMS.md): de inhoud van media/<id>/stems.json plus
  // `bestand`, als JSON. Gezet als een split slaagt, gewist als audio.wav
  // opnieuw binnengehaald wordt (dan passen de frames niet meer).
  `
  ALTER TABLE tracks ADD COLUMN stems_json TEXT;
  `,
  // versie 9 — SECTIES (docs/SECTIES.md): de sectiekaart als JSON, zoals de
  // toonsoort: { versie, opGrid, grid, stukken: [{ van, label, groep, energie,
  // zeker?, stems? }], bron, slot }. Niet in de lijst (/api/library): de app
  // haalt hem bij het laden op (GET /api/library/<id>/secties).
  `
  ALTER TABLE tracks ADD COLUMN secties_json TEXT;
  `,
];

/** Zoveel hotcues per nummer neemt de library aan; het deck gebruikt er nu 4. */
export const MAX_HOTCUES = 8;

/**
 * Waarop de lijst kan sorteren, en welke kant een eerste klik op. Alleen
 * deze sleutels komen in de SQL: de kolom is nooit tekst van buiten.
 * Wat geen waarde heeft (geen grid, nooit geladen) staat altijd ACHTERAAN,
 * welke kant je ook op sorteert: "—" bovenaan zegt niets.
 * Bij gelijke waarden: laatst toegevoegd eerst (toegevoegd, dan rowid: wat
 * in dezelfde milliseconde binnenkwam); omgekeerd sorteren keert ook dat om,
 * zodat "nog eens klikken" precies de lijst achterstevoren is.
 * Een kolom erbij (toonsoort) = een regel hier, een index in SCHEMA en een
 * kolom in src/ui/library-lijst.js.
 */
export const SORTERING = {
  titel: { sql: 'titel_sleutel', eerst: 'op' },
  bpm: { sql: 'grid_bpm', eerst: 'op' },           // het tempo bij het begin, zoals de lijst het toont
  duur: { sql: 'duur', eerst: 'op' },
  toegevoegd: { sql: 'toegevoegd', eerst: 'af' },
  gespeeld: { sql: 'laatst_geladen', eerst: 'af' }, // gezet door POST /api/library/<id>/geladen
};

/**
 * Is dit een sortering? Alleen EIGEN sleutels: `SORTERING['constructor']`
 * bestaat ook (van Object), en gaf dan "no such column: undefined" en een 500.
 */
export const isSortering = (s) => typeof s === 'string' && Object.hasOwn(SORTERING, s);

/** De ORDER BY voor een sortering en richting. Alleen uit SORTERING, nooit van buiten. */
function volgorde(sorteer, richting, t = '') {
  const s = SORTERING[sorteer];
  const op = (richting ?? s.eerst) === 'op';
  const [heen, terug] = op ? ['ASC', 'DESC'] : ['DESC', 'ASC'];
  // toegevoegd is zelf de sleutel: dan alleen nog de rowid als gelijkspel.
  if (sorteer === 'toegevoegd') return `${t}toegevoegd ${heen}, ${t}rowid ${heen}`;
  return `${t}${s.sql} ${heen} NULLS LAST, ${t}toegevoegd ${terug}, ${t}rowid ${terug}`;
}

/** Een track met wat de lijst er meteen bij wil: aantal racks en de peaks. */
const RIJ = `SELECT t.*, t.rowid AS _rij,
    (SELECT COUNT(*) FROM racks r WHERE r.track_id = t.id) AS _racks,
    p.bestand AS _p_bestand, p.buckets AS _p_buckets, p.per_bucket AS _p_per
  FROM tracks t LEFT JOIN peaks p ON p.track_id = t.id`;

/** Zoveel rijen per verzoek, hooguit. Zo blijft één verzoek een paar ms, ook bij 5000 nummers. */
export const MAX_PER_PAGINA = 500;

/**
 * De sorteersleutel voor titels: zonder accenten, kleine letters, en getallen
 * op lengte gezet zodat "Track 2" vóór "Track 10" komt. SQLite's NOCASE kent
 * alleen ASCII; "Élan" kwam dan na de z.
 */
export function sorteertitel(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
    .replace(/\d+/g, (n) => n.replace(/^0+(?=\d)/, '').padStart(12, '0'));
}

/** Hooguit zoveel stukken per grid: een tempokaart, geen beat-voor-beat-lijst. */
export const MAX_STUKKEN = 4096;

/**
 * Een grid uit de buitenwereld netjes maken: het nieuwe formaat
 * { stukken: [{ van, bpm, anker, zekerheid?, maat? }], beatsPerBar?, zeker?, slot? }
 * of het oude { bpm, firstBeat, beatsPerBar } (= één stuk). Null als het
 * geen bruikbaar grid is. Dezelfde regels als `Beatgrid` in de engine, maar
 * de library kent de engine niet.
 */
export function normaliseerGrid(g) {
  if (!g || typeof g !== 'object') return null;
  const getal = (x) => (typeof x === 'number' || typeof x === 'string') && x !== '' && Number.isFinite(Number(x));
  const bron = Array.isArray(g.stukken) ? g.stukken : [{ van: 0, bpm: g.bpm, anker: g.firstBeat ?? 0 }];
  if (bron.length > MAX_STUKKEN) return null;
  const stukken = [];
  for (const s of bron) {
    if (!s || !getal(s.bpm) || !getal(s.anker ?? 0) || !getal(s.van ?? 0)) return null;
    const bpm = Number(s.bpm);
    if (bpm < 40 || bpm > 300) return null;
    const stuk = { van: Number(s.van ?? 0), bpm, anker: Number(s.anker ?? 0) };
    if (getal(s.zekerheid)) stuk.zekerheid = Math.max(0, Math.min(1, Number(s.zekerheid)));
    // Maat-anker (25 sep 2026): tracktijd van een tel 1 in dit stuk. Optioneel:
    // zonder tellen de maten door zoals vroeger (de engine vult hem aan). Geen
    // schemawijziging, het staat in grid_json.
    if (getal(s.maat)) stuk.maat = Number(s.maat);
    // Van de tellen (6 okt): waarom het stuk onzeker is, en het octaaf van de oude analyse.
    if (TWIJFELS.includes(s.twijfel)) stuk.twijfel = s.twijfel;
    if (s.octaaf === 2 || s.octaaf === 0.5) stuk.octaaf = s.octaaf;
    if (s.ok === true) stuk.ok = true;          // met het oor gecontroleerd (Beatgrid.keurGoed)
    stukken.push(stuk);
  }
  if (!stukken.length) return null;
  stukken.sort((a, b) => a.van - b.van);
  const uit = { stukken, beatsPerBar: Number.isInteger(g.beatsPerBar) && g.beatsPerBar > 0 && g.beatsPerBar <= 16 ? g.beatsPerBar : 4 };
  if (g.slot === true) uit.slot = true;
  if (typeof g.zeker === 'boolean') uit.zeker = g.zeker;
  // 'auto' = voorstel van de analyse, 'hand' = daarna met de hand bewerkt.
  // Zonder: van vóór stap C (of gemigreerd) — die mag opnieuw geanalyseerd.
  if (g.bron === 'auto' || g.bron === 'hand') uit.bron = g.bron;
  // 'tellen' = gemaakt uit de tellen van Beat This! (server/tellen.js), met de versie van de methode.
  if (g.methode === 'tellen') uit.methode = 'tellen';
  if (Number.isInteger(g.versie) && g.versie > 0) uit.versie = g.versie;
  return uit;
}

/**
 * Mag een automatisch voorstel over dit grid heen? Nooit over een grid op
 * slot (met de hand bevestigd), tenzij `overSlot`; over een met de hand
 * bewerkt grid alleen als je er zelf om vraagt (`overHand`: de knop
 * "opnieuw analyseren"). Leeg, auto en oud (zonder bron) mogen altijd;
 * met `alleenOud` (de achtergrond) alleen leeg en oud.
 * Geeft null als het mag, anders de reden.
 */
export function autoGridWeigert(huidig, { overHand = false, overSlot = false, alleenOud = false } = {}) {
  if (!huidig) return null;
  // De achtergrond: alleen wat nog geanalyseerd MOET (intussen iets gezet? dan niet).
  if (alleenOud && !moetAnalyse(huidig)) return 'intussen al een grid';
  if (huidig.slot && !overSlot) return 'het grid staat op slot';
  if (huidig.bron === 'hand' && !overHand && !huidig.slot) return 'het grid is met de hand bewerkt';
  return null;
}

/** Moet dit grid bij het opstarten (opnieuw) geanalyseerd worden? Leeg of oud, niet op slot. */
export const moetAnalyse = (grid) => !grid || (!grid.slot && grid.bron !== 'auto' && grid.bron !== 'hand');

// ---- toonsoort: een kaart per link, net als het grid -------------------------

/** Hooguit zoveel stukken per kaart (een automatisch stuk is minstens 24 s: 27 uur). */
export const MAX_TOON_STUKKEN = 4096;

/**
 * Een toonsoortkaart uit de buitenwereld netjes maken (docs/TOONSOORT.md §3):
 *
 *   { versie, stemming, stukken: [{ van, toonsoort, stemming, zekerheid?, tweede? }], bron, slot }
 *
 * - `toonsoort`: de vaste spelling `C Db D Eb E F F# G Ab A Bb B`, `m` erachter
 *   voor mineur; een andere schrijfwijze van dezelfde toon ('C#', 'G#m') wordt
 *   de vaste. `null` = geen toonsoort (met de hand gezet, of stilte).
 * - `van` in tracktijd (s), ≥ 0; gesorteerd, geen twee op dezelfde plek.
 * - `stemming` in cent, -50..+50: per stuk (ontbreekt: die van het geheel) en
 *   bovenaan (ontbreekt: die van het eerste stuk, anders 0).
 * - `zekerheid` 0..1 blijft staan als hij er is (ook in een met de hand
 *   bewerkte kaart: stukken die je niet aanraakte houden de hunne, zoals bij
 *   het grid); een stuk zonder zekerheid is met de hand gezet en dus zeker.
 * - `tweede`: de tweede kandidaat van de analyse (server/toon.js), in dezelfde
 *   vaste spelling; alleen voor de tooltip. Hij hoort bij de ZEKERHEID: een
 *   stuk zonder zekerheid (met de hand gezet) of zonder toonsoort heeft er
 *   geen, en een tweede die gelijk is aan de toonsoort zegt niets; die vallen
 *   weg. Een onleesbare naam maakt de kaart ongeldig, zoals bij `toonsoort`.
 * - `bron`: 'auto' of 'hand'. Ontbreekt hij, dan 'hand': wat van buiten komt
 *   zonder te zeggen wat het is, mag de achtergrond niet overschrijven.
 * - `slot`: true = met de hand bevestigd, nooit automatisch overschreven.
 * - `versie`: de versie van de analyse (TOON_VERSIE), een geheel getal ≥ 1;
 *   anders weggelaten (telt dan als oud).
 * Null als het geen bruikbare kaart is: dan kan een route 400 zeggen.
 */
export function normaliseerToon(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const getal = (x) => typeof x === 'number' && Number.isFinite(x);
  const centOk = (x) => getal(x) && x >= -50 && x <= 50;
  if (!Array.isArray(t.stukken) || !t.stukken.length || t.stukken.length > MAX_TOON_STUKKEN) return null;
  if (t.stemming != null && !centOk(t.stemming)) return null;
  const eerste = t.stukken[0]?.stemming;
  const heel = t.stemming != null ? t.stemming : centOk(eerste) ? eerste : 0;
  const stukken = [];
  for (const s of t.stukken) {
    if (!s || typeof s !== 'object' || !getal(s.van) || s.van < 0) return null;
    let toonsoort = null;
    if (s.toonsoort !== null) {
      const k = leesToonsoort(s.toonsoort);
      if (k == null) return null;
      toonsoort = toonsoortNaam(k);
    }
    if (s.stemming != null && !centOk(s.stemming)) return null;
    const stuk = { van: s.van, toonsoort, stemming: s.stemming != null ? s.stemming : heel };
    if (s.zekerheid != null) {
      if (!getal(s.zekerheid)) return null;
      stuk.zekerheid = Math.max(0, Math.min(1, s.zekerheid));
    }
    if (s.tweede != null) {
      const k2 = leesToonsoort(s.tweede);
      if (k2 == null) return null;
      // Alleen naast een toonsoort uit de analyse (met zekerheid), en niet dezelfde.
      if ('zekerheid' in stuk && toonsoort !== null && toonsoortNaam(k2) !== toonsoort) stuk.tweede = toonsoortNaam(k2);
    }
    stukken.push(stuk);
  }
  stukken.sort((a, b) => a.van - b.van);
  for (let i = 1; i < stukken.length; i++) if (stukken[i].van === stukken[i - 1].van) return null;
  const uit = {};
  if (Number.isInteger(t.versie) && t.versie >= 1) uit.versie = t.versie;
  uit.stemming = heel;
  uit.stukken = stukken;
  uit.bron = t.bron === 'auto' ? 'auto' : 'hand';
  uit.slot = t.slot === true;
  return uit;
}

/**
 * Mag een automatische kaart over deze heen? Dezelfde regels als het grid
 * (autoGridWeigert): nooit over een kaart op slot, tenzij `overSlot` (tweede
 * klik op ↻); over een met de hand gezette kaart alleen met `overHand` (↻);
 * met `alleenOud` (de achtergrond) alleen wat nog MOET (moetToonAnalyse).
 * Geeft null als het mag, anders de reden.
 */
export function autoToonWeigert(huidig, { overHand = false, overSlot = false, alleenOud = false, versie = TOON_VERSIE } = {}) {
  if (!huidig) return null;
  if (alleenOud && !moetToonAnalyse(huidig, versie)) return 'intussen al een toonsoort';
  if (huidig.slot && !overSlot) return 'de toonsoort staat op slot';
  if (huidig.bron === 'hand' && !overHand && !huidig.slot) return 'de toonsoort is met de hand gezet';
  return null;
}

/**
 * Moet deze kaart (opnieuw) geanalyseerd worden? Leeg, of AUTOMATISCH met
 * een oudere analyseversie (het algoritme werd beter). Met de hand gezet of
 * op slot: nooit. `versie` alleen voor de tests (een versie-bump nabootsen).
 */
export const moetToonAnalyse = (toon, versie = TOON_VERSIE) =>
  !toon || (!toon.slot && toon.bron === 'auto' && !((toon.versie ?? 0) >= versie));

// ---- secties: het nummer in stukken die je speelt, docs/SECTIES.md ---------

export const SECTIE_LABELS = ['intro', 'opbouw', 'drop', 'break', 'outro', 'deel'];
export const MAX_SECTIE_STUKKEN = 64;

/**
 * Een sectiekaart uit de buitenwereld netjes maken, of null:
 *   { versie, opGrid, grid, stukken: [{ van, label, groep, energie, zeker?, stems? }], bron, slot }
 * - stukken: oplopend op `van` (s, ≥ 0, elk een eigen plek), de eerste op 0;
 *   hooguit MAX_SECTIE_STUKKEN.
 * - label: een van SECTIE_LABELS; groep: één hoofdletter A–Z; energie 0..1.
 * - zeker 0..1 (optioneel); stems: { naam: 0..1 } (optioneel).
 * - bron: 'auto' of 'hand'; slot: boolean.
 */
export function normaliseerSecties(k) {
  if (!k || typeof k !== 'object' || !Array.isArray(k.stukken) || !k.stukken.length) return null;
  if (k.stukken.length > MAX_SECTIE_STUKKEN) return null;
  const getal = (x) => typeof x === 'number' && Number.isFinite(x);
  const stukken = [];
  for (const s of k.stukken) {
    if (!s || !getal(s.van) || s.van < 0) return null;
    if (stukken.length && s.van <= stukken.at(-1).van + 1e-6) return null;
    if (!SECTIE_LABELS.includes(s.label) || typeof s.groep !== 'string' || !/^[A-Z]$/.test(s.groep)) return null;
    const stuk = { van: s.van, label: s.label, groep: s.groep, energie: getal(s.energie) ? Math.min(1, Math.max(0, s.energie)) : 0.5 };
    if (getal(s.zeker)) stuk.zeker = Math.min(1, Math.max(0, s.zeker));
    if (s.stems && typeof s.stems === 'object') {
      const st = {};
      for (const [naam, v] of Object.entries(s.stems)) if (/^\w{1,16}$/.test(naam) && getal(v)) st[naam] = Math.min(1, Math.max(0, v));
      if (Object.keys(st).length) stuk.stems = st;
    }
    stukken.push(stuk);
  }
  stukken[0].van = 0;
  return {
    versie: Number.isInteger(k.versie) && k.versie > 0 ? k.versie : null,
    opGrid: k.opGrid !== false,
    grid: typeof k.grid === 'string' && /^[0-9a-f]{8}$/.test(k.grid) ? k.grid : null,
    stukken,
    bron: k.bron === 'hand' ? 'hand' : 'auto',
    slot: !!k.slot,
  };
}

/**
 * Moet deze kaart (opnieuw) berekend worden? Leeg; of AUTOMATISCH en dan:
 * een oudere analyseversie, op een ander grid gerekend dan het grid van nu
 * (`gridSleutel`), of zonder stems terwijl het nummer ze nu heeft. Met de
 * hand of op slot: nooit.
 */
export function moetSectieAnalyse(k, { versie = SECTIE_VERSIE, grid = null, metStems = false } = {}) {
  if (!k) return true;
  if (k.slot || k.bron !== 'auto') return false;
  if (!((k.versie ?? 0) >= versie)) return true;
  if ((k.grid ?? null) !== (grid ?? null)) return true;
  return metStems && !k.stukken.some((s) => s.stems);
}

// ---- stems: zang en rest (of vier) per nummer, docs/STEMS.md ----------------

/**
 * Wat een library-rij over de stems zegt, of null:
 *   { aantal: 2|4, namen: [...], schaal, bestand: "media/<id>/stems.wav" }
 * Uit de bewaarde stems.json (plus `bestand`). Null als het geen bruikbare set
 * is: dan speelt de app audio.wav, nooit een half begrepen bestand.
 * `namen` alleen als het aantal klopt: de engine zet kanaalpaar k op namen[k].
 */
export function normaliseerStems(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const { aantal, namen, schaal, bestand } = s;
  if (aantal !== 2 && aantal !== 4) return null;
  if (!Array.isArray(namen) || namen.length !== aantal
    || !namen.every((n) => typeof n === 'string' && /^[a-z]{1,16}$/.test(n)) || new Set(namen).size !== aantal) return null;
  if (!(typeof schaal === 'number' && schaal > 0 && schaal <= 1)) return null;
  if (typeof bestand !== 'string' || !/^media\/[\w-]+\/stems\.wav$/.test(bestand)) return null;
  return { aantal, namen: [...namen], schaal, bestand };
}

export class Library {
  constructor(pad) {
    mkdirSync(dirname(pad), { recursive: true });
    this.db = new DatabaseSync(pad);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.function('sorteertitel', { deterministic: true }, sorteertitel);
    this._stmts = new Map();
    this._migreer();
  }

  /** Schema-versie in de database zelf, zodat een uitbreiding later geen gok is. */
  _migreer() {
    const huidig = this.db.prepare('PRAGMA user_version').get().user_version;
    // Per versie in één transactie: ging het mis tussen de ALTERs en het
    // ophogen van user_version, dan startte de server nooit meer (dubbele kolom).
    for (let v = huidig; v < SCHEMA.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(SCHEMA[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
    return SCHEMA.length;
  }

  get versie() { return this.db.prepare('PRAGMA user_version').get().user_version; }
  sluit() { this.db.close(); }

  /**
   * Hoeveel rijen deze verbinding veranderde sinds het openen (SQLite's
   * total_changes()). Goedkoop; de backup kijkt hiermee of er iets te doen is.
   */
  wijzigingen() { return this._q('SELECT total_changes() AS n').get().n; }

  /** Een voorbereide query, hergebruikt: per rij opnieuw voorbereiden kostte meer dan de query zelf. */
  _q(sql) {
    let st = this._stmts.get(sql);
    if (!st) { st = this.db.prepare(sql); this._stmts.set(sql, st); }
    return st;
  }

  // ---- tracks ------------------------------------------------------------

  /** Voegt toe of werkt bij. Opnieuw binnenhalen overschrijft, maar telt door. */
  bewaarTrack(t) {
    const nu = Date.now();
    this.db.prepare(`
      INSERT INTO tracks (id, url, titel, uploader, duur, audio, video, thumbnail,
        loudness_i, loudness_tp, loudness_lra, loudness_drempel, loudness_offset,
        doel_loudness, ytdlp, toegevoegd, titel_sleutel)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        url=excluded.url, titel=excluded.titel, titel_sleutel=excluded.titel_sleutel, uploader=excluded.uploader,
        duur=excluded.duur, audio=excluded.audio, video=excluded.video,
        thumbnail=excluded.thumbnail, loudness_i=excluded.loudness_i,
        loudness_tp=excluded.loudness_tp, loudness_lra=excluded.loudness_lra,
        loudness_drempel=excluded.loudness_drempel, loudness_offset=excluded.loudness_offset,
        doel_loudness=excluded.doel_loudness, ytdlp=excluded.ytdlp
    `).run(
      t.id, t.url, t.titel, t.uploader || '', t.duur || 0, t.audio, t.video || null,
      t.thumbnail || '', t.loudness?.I ?? null, t.loudness?.TP ?? null,
      t.loudness?.LRA ?? null, t.loudness?.drempel ?? null, t.loudness?.offset ?? null,
      t.doelLoudness ?? null, t.ytdlp || null, nu, sorteertitel(t.titel),
    );
    return this.track(t.id);
  }

  track(id) {
    const r = this._q(`${RIJ} WHERE t.id = ?`).get(id);
    return r ? this._verrijk(r) : null;
  }

  /**
   * Een stuk van de lijst: wat op de zoekterm lijkt, gesorteerd, vanaf rij
   * `van`. Zonder `aantal` alles (de meet-tools willen de hele library);
   * het paneel vraagt altijd een pagina. Vroeger stond hier LIMIT 200 zonder
   * dat iemand het merkte: nummer 201 bestond gewoon niet.
   * Onbekende sortering gooit (de route zegt dan 400).
   */
  tracks({ zoek = '', sorteer = 'toegevoegd', richting = null, van = 0, aantal = null } = {}) {
    if (!isSortering(sorteer)) throw new Error(`onbekende sortering: ${sorteer}`);
    const { waar, args } = zoekFilter(zoek);
    // Alles (de meet-tools): één query, er valt niets over te slaan.
    if (aantal == null) {
      return this.db.prepare(`${RIJ} WHERE t.rowid IN (SELECT rowid FROM tracks ${waar}) ORDER BY ${volgorde(sorteer, richting, 't.')}`)
        .all(...args).map((r) => this._verrijk(r));
    }
    // In twee stappen: eerst alleen de rowids in de goede volgorde (smal, uit
    // de index), dan de hele rijen van die ene pagina. Alles in één keer
    // sleepte elke brede rij door de sorteerder, ook de 4900 die je overslaat.
    // Het gelijkspel (toegevoegd, rowid) maakt de volgorde vast: anders kan
    // dezelfde rij op twee pagina's staan, of op geen.
    // Hele getallen vanaf 0, maar NIET met `| 0`: dat rekent in 32 bits, en
    // van = 2^32 + 1 werd dan rij 1 in plaats van een lege pagina.
    const heel = (x) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(Number(x)) || 0));
    const ids = this._q(`SELECT rowid AS r FROM tracks ${waar} ORDER BY ${volgorde(sorteer, richting)} LIMIT ? OFFSET ?`)
      .all(...args, heel(aantal), heel(van))
      .map((x) => x.r);
    if (!ids.length) return [];
    const perId = new Map(this.db.prepare(`${RIJ} WHERE t.rowid IN (${ids.map(() => '?').join(',')})`)
      .all(...ids).map((r) => [r._rij, r]));
    return ids.map((r) => this._verrijk(perId.get(r)));
  }

  /**
   * Alle ids. `volgorde: 'laatst_geladen'`: wat je het laatst laadde eerst
   * (daarna nooit geladen, nieuwste eerst) — voor achtergrondwerk dat het
   * liefst begint bij wat je speelt.
   */
  alleIds({ volgorde = 'toegevoegd' } = {}) {
    const orde = volgorde === 'laatst_geladen'
      ? 'laatst_geladen IS NULL, laatst_geladen DESC, toegevoegd DESC' : 'toegevoegd';
    return this.db.prepare(`SELECT id FROM tracks ORDER BY ${orde}`).all().map((r) => r.id);
  }

  /** Hoeveel nummers er zijn, of hoeveel op de zoekterm lijken. */
  aantalTracks({ zoek = '' } = {}) {
    const { waar, args } = zoekFilter(zoek);
    return this._q(`SELECT COUNT(*) AS n FROM tracks ${waar}`).get(...args).n;
  }

  /**
   * Een rij uit RIJ netjes maken. Aantal racks en de peaks zitten al in de
   * rij (één query per pagina in plaats van twee per nummer): het aantal
   * racks wil je in het paneel zien zonder tweede vraag.
   */
  _verrijk({ titel_sleutel: _s, _rij, _racks, _p_bestand, _p_buckets, _p_per, stems_json, secties_json: _sec, ...r }) {
    const grid = this._grid(r);
    const onset = r.onset_bestand
      ? { bestand: r.onset_bestand, frames: r.onset_frames, envRate: r.onset_rate, tijdOffset: r.onset_offset }
      : null;
    // bron: 'youtube' | 'tiktok' | 'bestand' | 'web' — het label in de lijst.
    // stems: alleen wat de app nodig heeft; de hele stems.json staat in stems_json.
    return { ...r, racks: _racks, grid, toon: this._toon(r), onset, bron: bronVan(r.url),
      stems: stems_json != null ? normaliseerStems(veiligJson(stems_json, null)) : null,
      peaks: _p_bestand != null ? { bestand: _p_bestand, buckets: _p_buckets, perBucket: _p_per } : null };
  }

  _toon(r) {
    return r.toon_json != null ? normaliseerToon(veiligJson(r.toon_json, null)) : null;
  }

  _grid(r) {
    return r.grid_json != null
      ? normaliseerGrid(veiligJson(r.grid_json, null))
      : normaliseerGrid(r.grid_bpm != null
        ? { bpm: r.grid_bpm, firstBeat: r.grid_first_beat ?? 0, beatsPerBar: r.grid_beats_per_bar ?? 4 } : null);
  }

  geladen(id) {
    this.db.prepare('UPDATE tracks SET laatst_geladen = ?, keer_geladen = keer_geladen + 1 WHERE id = ?')
      .run(Date.now(), id);
  }

  verwijderTrack(id) {
    return this.db.prepare('DELETE FROM tracks WHERE id = ?').run(id).changes > 0;
  }

  /** Het nummer met precies deze link (url is UNIQUE), of null. Voor "staat al in de library". */
  trackMetUrl(url) {
    // Dezelfde rij als track() (RIJ: racks en peaks erbij): met `SELECT *`
    // kwam een nummer dat al binnen was zonder peaks terug, en laadde het
    // uit de ingest-strook zonder golfvorm.
    const r = this._q(`${RIJ} WHERE t.url = ?`).get(String(url ?? ''));
    return r ? this._verrijk(r) : null;
  }

  // ---- beatgrid ----------------------------------------------------------

  /**
   * null wist het grid. Neemt het nieuwe én het oude formaat; bewaart altijd
   * het nieuwe. Een onbruikbaar grid gooit, zodat de route 400 kan zeggen in
   * plaats van stilletjes het bewaarde grid te wissen.
   */
  bewaarGrid(trackId, grid) {
    const g = grid == null ? null : normaliseerGrid(grid);
    if (grid != null && !g) throw new Error('ongeldig grid');
    const eerste = g?.stukken[0];
    this.db.prepare(`UPDATE tracks SET grid_json = ?, grid_bpm = ?, grid_first_beat = ?, grid_beats_per_bar = ?
      WHERE id = ?`).run(
      g ? JSON.stringify(g) : null,
      eerste ? eerste.bpm : null,
      eerste ? eerste.anker : null,
      g ? g.beatsPerBar : null,
      trackId,
    );
    return this.track(trackId)?.grid ?? null;
  }

  /**
   * Een automatisch voorstel bewaren, maar alleen als het mag (autoGridWeigert).
   * Lezen en schrijven in één transactie: een tap die net binnenkwam wordt
   * niet alsnog overschreven. Geeft { bewaard, grid, reden? }.
   */
  bewaarAutoGrid(trackId, grid, opties = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const huidig = this.track(trackId);
      if (!huidig) { this.db.exec('ROLLBACK'); return { bewaard: false, grid: null, reden: 'onbekend nummer' }; }
      const reden = autoGridWeigert(huidig.grid, opties);
      if (reden) { this.db.exec('ROLLBACK'); return { bewaard: false, grid: huidig.grid, reden }; }
      const g = this.bewaarGrid(trackId, { ...grid, bron: 'auto', slot: false });
      this.db.exec('COMMIT');
      return { bewaard: true, grid: g };
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }

  /**
   * Nummers waarvan het grid (opnieuw) geanalyseerd moet worden: leeg, of
   * oud (geen slot, geen bron). Oudste eerst. Zonder onset-envelope ook:
   * die wordt dan eerst gemaakt.
   */
  teAnalyseren() {
    return this.db.prepare('SELECT id, grid_json, grid_bpm, grid_first_beat, grid_beats_per_bar FROM tracks ORDER BY toegevoegd')
      .all().filter((r) => moetAnalyse(this._grid(r))).map((r) => r.id);
  }

  // ---- toonsoort ---------------------------------------------------------

  /**
   * null wist de kaart. Een onbruikbare kaart gooit, zodat de route 400 kan
   * zeggen in plaats van stilletjes de bewaarde kaart te wissen.
   */
  bewaarToon(trackId, toon) {
    const t = toon == null ? null : normaliseerToon(toon);
    if (toon != null && !t) throw new Error('ongeldige toonsoort');
    this.db.prepare('UPDATE tracks SET toon_json = ? WHERE id = ?').run(t ? JSON.stringify(t) : null, trackId);
    return this.track(trackId)?.toon ?? null;
  }

  /**
   * Een automatische kaart bewaren, maar alleen als het mag (autoToonWeigert).
   * Lezen en schrijven in één transactie: een correctie met de hand die net
   * binnenkwam wordt niet alsnog overschreven. Geeft { bewaard, toon, reden? }.
   */
  bewaarAutoToon(trackId, toon, opties = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const huidig = this.track(trackId);
      if (!huidig) { this.db.exec('ROLLBACK'); return { bewaard: false, toon: null, reden: 'onbekend nummer' }; }
      const reden = autoToonWeigert(huidig.toon, opties);
      if (reden) { this.db.exec('ROLLBACK'); return { bewaard: false, toon: huidig.toon, reden }; }
      const t = this.bewaarToon(trackId, { ...toon, bron: 'auto', slot: false });
      this.db.exec('COMMIT');
      return { bewaard: true, toon: t };
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }

  /**
   * Nummers waarvan de toonsoort (opnieuw) geanalyseerd moet worden: zonder
   * kaart, of met een automatische kaart van een oudere analyseversie.
   * Oudste eerst. `versie` alleen voor de tests.
   */
  teToonAnalyseren({ versie = TOON_VERSIE } = {}) {
    return this.db.prepare('SELECT id, toon_json FROM tracks ORDER BY toegevoegd').all()
      .filter((r) => moetToonAnalyse(this._toon(r), versie)).map((r) => r.id);
  }

  // ---- secties ------------------------------------------------------------

  /** De sectiekaart van een nummer, of null (niet in track(): de lijst blijft klein). */
  secties(trackId) {
    const r = this._q('SELECT secties_json FROM tracks WHERE id = ?').get(trackId);
    return r?.secties_json != null ? normaliseerSecties(veiligJson(r.secties_json, null)) : null;
  }

  /** Een kaart bewaren (of null: wissen). Gooit bij een ongeldige kaart. Geeft wat er nu staat. */
  bewaarSecties(trackId, k) {
    const n = k == null ? null : normaliseerSecties(k);
    if (k != null && !n) throw new Error('ongeldige secties');
    this._q('UPDATE tracks SET secties_json = ? WHERE id = ?').run(n ? JSON.stringify(n) : null, trackId);
    return this.secties(trackId);
  }

  /**
   * Een AUTOMATISCHE kaart bewaren, alleen als dat (nog) mag: niet over een
   * kaart met de hand of op slot. Geeft { bewaard, secties, reden? }.
   */
  bewaarAutoSecties(trackId, k) {
    if (!this.track(trackId)) return { bewaard: false, secties: null, reden: 'onbekend nummer' };
    const huidig = this.secties(trackId);
    if (huidig?.slot) return { bewaard: false, secties: huidig, reden: 'de secties staan op slot' };
    if (huidig && huidig.bron === 'hand') return { bewaard: false, secties: huidig, reden: 'de secties zijn met de hand gezet' };
    return { bewaard: true, secties: this.bewaarSecties(trackId, { ...k, bron: 'auto', slot: false }) };
  }

  /** Moeten de secties van dit nummer (opnieuw) berekend worden, met het grid en de stems van nu? */
  moetSecties(trackId, { versie = SECTIE_VERSIE } = {}) {
    const t = this.track(trackId);
    if (!t) return false;
    return moetSectieAnalyse(this.secties(trackId), { versie, grid: t.grid ? gridSleutel(t.grid) : null, metStems: !!t.stems });
  }

  /** Nummers waarvan de secties (opnieuw) berekend moeten worden, oudste eerst. */
  teSectieAnalyseren({ versie = SECTIE_VERSIE } = {}) {
    return this.alleIds().filter((id) => this.moetSecties(id, { versie }));
  }

  // ---- stems -------------------------------------------------------------

  /**
   * De stems van een nummer: de inhoud van stems.json plus `bestand`, of null
   * (wissen). Een set die normaliseerStems niet aanneemt gooit, zodat er nooit
   * stilletjes iets onbruikbaars in de library komt. Geeft wat de rij nu zegt.
   */
  bewaarStems(trackId, stems) {
    if (stems != null && !normaliseerStems(stems)) throw new Error('ongeldige stems');
    this._q('UPDATE tracks SET stems_json = ? WHERE id = ?').run(stems == null ? null : JSON.stringify(stems), trackId);
    return this.track(trackId)?.stems ?? null;
  }

  /** De hele bewaarde stems.json (met model, frames, rekentijd…), of null. */
  stemsInfo(trackId) {
    const r = this._q('SELECT stems_json FROM tracks WHERE id = ?').get(trackId);
    return r?.stems_json != null ? veiligJson(r.stems_json, null) : null;
  }

  bewaarOnset(trackId, onset) {
    this.db.prepare(`UPDATE tracks SET onset_bestand = ?, onset_frames = ?,
      onset_rate = ?, onset_offset = ? WHERE id = ?`).run(
      onset?.bestand ?? null, onset?.frames ?? null,
      onset?.envRate ?? null, onset?.tijdOffset ?? null, trackId);
    return this.track(trackId)?.onset ?? null;
  }

  // ---- effect-racks ------------------------------------------------------

  racks(trackId) {
    return this.db.prepare('SELECT * FROM racks WHERE track_id = ? ORDER BY gemaakt').all(trackId)
      .map((r) => ({ ...r, data: veiligJson(r.data), actief: !!r.actief }));
  }

  /** Nieuw rack of een bestaand bijwerken. Data mag alles zijn wat JSON aankan. */
  bewaarRack({ id = null, trackId, naam, data, actief = false }) {
    const nu = Date.now();
    const tekst = JSON.stringify(data ?? {});
    // Alleen een rack van DIT nummer mag bijgewerkt worden. Zonder de
    // track-voorwaarde overschreef een verdwaalde id het rack van een ander
    // nummer; dan liever een nieuw rack.
    const bijgewerkt = id
      ? this.db.prepare('UPDATE racks SET naam = ?, data = ?, gewijzigd = ? WHERE id = ? AND track_id = ?')
        .run(naam, tekst, nu, id, trackId).changes
      : 0;
    if (!bijgewerkt) {
      id = this.db.prepare(`INSERT INTO racks (track_id, naam, data, actief, gemaakt, gewijzigd)
        VALUES (?,?,?,0,?,?)`).run(trackId, naam, tekst, nu, nu).lastInsertRowid;
    }
    if (actief) this.zetActiefRack(trackId, Number(id));
    return this.rack(Number(id));
  }

  rack(id) {
    const r = this.db.prepare('SELECT * FROM racks WHERE id = ?').get(id);
    return r ? { ...r, data: veiligJson(r.data), actief: !!r.actief } : null;
  }

  /** Eén actief rack per nummer; de rest gaat automatisch uit. */
  zetActiefRack(trackId, rackId) {
    this.db.prepare('UPDATE racks SET actief = 0 WHERE track_id = ?').run(trackId);
    this.db.prepare('UPDATE racks SET actief = 1 WHERE id = ? AND track_id = ?').run(rackId, trackId);
    return this.rack(rackId);
  }

  actiefRack(trackId) {
    const r = this.db.prepare('SELECT * FROM racks WHERE track_id = ? AND actief = 1').get(trackId);
    return r ? { ...r, data: veiligJson(r.data), actief: true } : null;
  }

  verwijderRack(id, trackId = null) {
    if (trackId !== null) return this.db.prepare('DELETE FROM racks WHERE id = ? AND track_id = ?').run(id, trackId).changes > 0;
    return this.db.prepare('DELETE FROM racks WHERE id = ?').run(id).changes > 0;
  }

  // ---- sampler-pads ------------------------------------------------------
  // Eén stuk per pad per nummer; opnieuw vullen overschrijft.

  samples(trackId) {
    return this.db.prepare('SELECT pad, van, tot, tellen, bpm FROM samples WHERE track_id = ? ORDER BY pad').all(trackId);
  }

  bewaarSample(trackId, { pad, van, tot, tellen = null, bpm = null }) {
    this.db.prepare(`INSERT INTO samples (track_id, pad, van, tot, tellen, bpm, gemaakt) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (track_id, pad) DO UPDATE SET van = excluded.van, tot = excluded.tot,
        tellen = excluded.tellen, bpm = excluded.bpm, gemaakt = excluded.gemaakt`)
      .run(trackId, pad, van, tot, tellen, bpm, Date.now());
    return this.samples(trackId).find((x) => x.pad === pad) ?? null;
  }

  verwijderSample(trackId, pad) {
    return this.db.prepare('DELETE FROM samples WHERE track_id = ? AND pad = ?').run(trackId, pad).changes > 0;
  }

  // ---- hotcues ------------------------------------------------------------
  // Eén tijd per plek per nummer; opnieuw zetten overschrijft. De engine kent
  // de library niet: de app bewaart bij zetten/wissen en zet ze terug bij laden.

  hotcues(trackId) {
    return this.db.prepare('SELECT nr, tijd FROM hotcues WHERE track_id = ? ORDER BY nr').all(trackId);
  }

  bewaarHotcue(trackId, { nr, tijd }) {
    this.db.prepare(`INSERT INTO hotcues (track_id, nr, tijd, gemaakt) VALUES (?,?,?,?)
      ON CONFLICT (track_id, nr) DO UPDATE SET tijd = excluded.tijd, gemaakt = excluded.gemaakt`)
      .run(trackId, nr, tijd, Date.now());
    return this.hotcues(trackId).find((h) => h.nr === nr) ?? null;
  }

  verwijderHotcue(trackId, nr) {
    return this.db.prepare('DELETE FROM hotcues WHERE track_id = ? AND nr = ?').run(trackId, nr).changes > 0;
  }

  // ---- peaks -------------------------------------------------------------
  // Peaks opnieuw berekenen bij elke load is verspilling; ze veranderen nooit.

  bewaarPeaks(trackId, { bestand, buckets, perBucket }) {
    this.db.prepare(`INSERT INTO peaks (track_id, bestand, buckets, per_bucket, gemaakt)
      VALUES (?,?,?,?,?)
      ON CONFLICT(track_id) DO UPDATE SET bestand=excluded.bestand,
        buckets=excluded.buckets, per_bucket=excluded.per_bucket, gemaakt=excluded.gemaakt`)
      .run(trackId, bestand, buckets, perBucket, Date.now());
  }

  peaks(trackId) {
    return this._q('SELECT * FROM peaks WHERE track_id = ?').get(trackId) || null;
  }

  // ---- losse instellingen ------------------------------------------------

  zet(sleutel, waarde) {
    this.db.prepare(`INSERT INTO instellingen (sleutel, waarde) VALUES (?,?)
      ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde`)
      .run(sleutel, JSON.stringify(waarde));
  }

  haal(sleutel, standaard = null) {
    const r = this.db.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').get(sleutel);
    return r ? veiligJson(r.waarde, standaard) : standaard;
  }
}

/** WHERE-deel voor de zoekterm. % en _ zijn gewone tekens: "100%" zoekt 100%. */
function zoekFilter(zoek) {
  if (!zoek) return { waar: '', args: [] };
  const z = `%${String(zoek).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  return { waar: "WHERE titel LIKE ? ESCAPE '\\' OR uploader LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'", args: [z, z, z] };
}

const veiligJson = (tekst, val = {}) => { try { return JSON.parse(tekst); } catch { return val; } };
