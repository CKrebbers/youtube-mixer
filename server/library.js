import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

const SCHEMA = [
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
];

export class Library {
  constructor(pad) {
    mkdirSync(dirname(pad), { recursive: true });
    this.db = new DatabaseSync(pad);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this._migreer();
  }

  /** Schema-versie in de database zelf, zodat een uitbreiding later geen gok is. */
  _migreer() {
    const huidig = this.db.prepare('PRAGMA user_version').get().user_version;
    for (let v = huidig; v < SCHEMA.length; v++) {
      this.db.exec(SCHEMA[v]);
      this.db.exec(`PRAGMA user_version = ${v + 1}`);
    }
    return SCHEMA.length;
  }

  get versie() { return this.db.prepare('PRAGMA user_version').get().user_version; }
  sluit() { this.db.close(); }

  // ---- tracks ------------------------------------------------------------

  /** Voegt toe of werkt bij. Opnieuw binnenhalen overschrijft, maar telt door. */
  bewaarTrack(t) {
    const nu = Date.now();
    this.db.prepare(`
      INSERT INTO tracks (id, url, titel, uploader, duur, audio, video, thumbnail,
        loudness_i, loudness_tp, loudness_lra, loudness_drempel, loudness_offset,
        doel_loudness, ytdlp, toegevoegd)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        url=excluded.url, titel=excluded.titel, uploader=excluded.uploader,
        duur=excluded.duur, audio=excluded.audio, video=excluded.video,
        thumbnail=excluded.thumbnail, loudness_i=excluded.loudness_i,
        loudness_tp=excluded.loudness_tp, loudness_lra=excluded.loudness_lra,
        loudness_drempel=excluded.loudness_drempel, loudness_offset=excluded.loudness_offset,
        doel_loudness=excluded.doel_loudness, ytdlp=excluded.ytdlp
    `).run(
      t.id, t.url, t.titel, t.uploader || '', t.duur || 0, t.audio, t.video || null,
      t.thumbnail || '', t.loudness?.I ?? null, t.loudness?.TP ?? null,
      t.loudness?.LRA ?? null, t.loudness?.drempel ?? null, t.loudness?.offset ?? null,
      t.doelLoudness ?? null, t.ytdlp || null, nu,
    );
    return this.track(t.id);
  }

  track(id) {
    const r = this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    return r ? this._verrijk(r) : null;
  }

  /** Alles, of wat op de zoekterm lijkt. Nieuwste eerst. */
  tracks({ zoek = '', limiet = 200 } = {}) {
    const rijen = zoek
      ? this.db.prepare(`SELECT * FROM tracks
          WHERE titel LIKE ? OR uploader LIKE ? OR url LIKE ?
          ORDER BY toegevoegd DESC LIMIT ?`)
        .all(`%${zoek}%`, `%${zoek}%`, `%${zoek}%`, limiet)
      : this.db.prepare('SELECT * FROM tracks ORDER BY toegevoegd DESC LIMIT ?').all(limiet);
    return rijen.map((r) => this._verrijk(r));
  }

  /** Aantal racks meegeven: dat wil je in het paneel zien zonder tweede vraag. */
  _verrijk(r) {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM racks WHERE track_id = ?').get(r.id).n;
    const p = this.peaks(r.id);
    const grid = r.grid_bpm != null
      ? { bpm: r.grid_bpm, firstBeat: r.grid_first_beat ?? 0, beatsPerBar: r.grid_beats_per_bar ?? 4 }
      : null;
    const onset = r.onset_bestand
      ? { bestand: r.onset_bestand, frames: r.onset_frames, envRate: r.onset_rate, tijdOffset: r.onset_offset }
      : null;
    return { ...r, racks: n, grid, onset,
      peaks: p ? { bestand: p.bestand, buckets: p.buckets, perBucket: p.per_bucket } : null };
  }

  geladen(id) {
    this.db.prepare('UPDATE tracks SET laatst_geladen = ?, keer_geladen = keer_geladen + 1 WHERE id = ?')
      .run(Date.now(), id);
  }

  verwijderTrack(id) {
    return this.db.prepare('DELETE FROM tracks WHERE id = ?').run(id).changes > 0;
  }

  // ---- beatgrid ----------------------------------------------------------

  /** null wist het grid. */
  bewaarGrid(trackId, grid) {
    this.db.prepare(`UPDATE tracks SET grid_bpm = ?, grid_first_beat = ?, grid_beats_per_bar = ?
      WHERE id = ?`).run(
      grid ? grid.bpm : null,
      grid ? grid.firstBeat : null,
      grid ? (grid.beatsPerBar ?? 4) : null,
      trackId,
    );
    return this.track(trackId)?.grid ?? null;
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
    if (id) {
      this.db.prepare('UPDATE racks SET naam = ?, data = ?, gewijzigd = ? WHERE id = ?')
        .run(naam, tekst, nu, id);
    } else {
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

  verwijderRack(id) {
    return this.db.prepare('DELETE FROM racks WHERE id = ?').run(id).changes > 0;
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
    return this.db.prepare('SELECT * FROM peaks WHERE track_id = ?').get(trackId) || null;
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

const veiligJson = (tekst, val = {}) => { try { return JSON.parse(tekst); } catch { return val; } };
