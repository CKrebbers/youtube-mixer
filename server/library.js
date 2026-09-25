import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { bronVan } from './links.js';

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
  // Hotcues bij het nummer, zoals de sampler-pads: WAAR ze staan, in
  // tracktijd. Laad je het nummer opnieuw, dan staan ze er weer.
  // En de lijst voorbij 200 nummers: een sorteersleutel voor de titel die
  // vooraf is uitgerekend (sorteertitel() per rij per verzoek kostte bij 5000
  // nummers tientallen ms) en een index per sorteerkolom.
  // Eén eigen element achteraan: een ander spoor voegt tegelijk een versie
  // toe, en dan is samenvoegen alleen de volgorde van twee elementen.
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
 * { stukken: [{ van, bpm, anker, zekerheid? }], beatsPerBar?, zeker?, slot? }
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
  _verrijk({ titel_sleutel: _s, _rij, _racks, _p_bestand, _p_buckets, _p_per, ...r }) {
    const grid = this._grid(r);
    const onset = r.onset_bestand
      ? { bestand: r.onset_bestand, frames: r.onset_frames, envRate: r.onset_rate, tijdOffset: r.onset_offset }
      : null;
    // bron: 'youtube' | 'tiktok' | 'bestand' | 'web' — het label in de lijst.
    return { ...r, racks: _racks, grid, onset, bron: bronVan(r.url),
      peaks: _p_bestand != null ? { bestand: _p_bestand, buckets: _p_buckets, perBucket: _p_per } : null };
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
