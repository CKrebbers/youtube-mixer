import { Emitter } from '../lib/emitter.js';
import { isOpen, perNummer } from './stems-weergave.js';

/**
 * De stems-rij van de server (GET/POST/DELETE /api/stems, docs/STEMS.md §2),
 * één keer voor de hele mixer: de library-kolom, de STEMS-rij en het teken in
 * de kolomkop lezen allemaal hieruit.
 *
 * Peilen alleen zolang het ergens om gaat: er staat iets open (wacht, bezig),
 * of een kijker zegt dat hij kijkt (library-paneel open, STEMS-rij open). Na
 * een splits/annuleer en op verzoek (`peil()`, bv. na een ingest) meteen.
 *
 * Gebeurtenissen: 'change' na elke peiling; 'klaar' en 'fout' (de opdracht)
 * als een opdracht dat werd terwijl deze pagina meekeek — niet bij de eerste
 * peiling, want wat al af was hoeft niemand nog te horen; 'herstart' (aantal)
 * als de server herstartte terwijl er opdrachten open stonden die hij niet
 * terugzette (hij bewaart zijn rij, maar een nummer kan weg zijn; een
 * teruggezette opdracht heeft een nieuwe id, dus we kijken naar het nummer).
 */
export class StemsWachtrij extends Emitter {
  constructor({ haal = (url, init) => fetch(url, init), interval = 1500 } = {}) {
    super();
    this.haal = haal;
    this.opdrachten = [];
    this.beschikbaar = null;   // null = nog onbekend; true/false zoals de server zegt
    this.reden = null;         // waarom niet beschikbaar
    this.ontbreekt = false;    // de server kent /api/stems niet (404): een server van vóór de stems
    this.server = null;        // run-id van de server bij de vorige peiling
    this.kijkers = new Set();  // () => boolean: kijkt er iemand?
    this._perNummer = new Map();
    this._gezien = null;       // opdracht-id -> status bij de vorige peiling; null = nog nooit gepeild
    this._loopt = null;        // de peiling die onderweg is (twee tegelijk vragen heeft geen zin)
    if (interval) setInterval(() => this._tik(), interval);
  }

  /** Staat er iets open (wacht of bezig)? */
  get open() { return this.opdrachten.some(isOpen); }

  /** Een kijker erbij: zolang die true geeft wordt er gepeild. Geeft een functie die weer ophoudt. */
  kijk(fn) { this.kijkers.add(fn); return () => this.kijkers.delete(fn); }

  /** De opdracht die voor dit nummer telt (open eerst, anders de laatste), of null. */
  voor(trackId) { return this._perNummer.get(trackId) ?? null; }

  /** Map track-id -> opdracht. */
  perNummer() { return this._perNummer; }

  _kijkt() {
    for (const k of this.kijkers) { try { if (k()) return true; } catch (_) {} }
    return false;
  }

  _tik() { if (this.open || this._kijkt()) this.peil(); }

  /** Nu peilen. Loopt er al een peiling, dan die. */
  peil() {
    this._loopt ??= this._peil().finally(() => { this._loopt = null; });
    return this._loopt;
  }

  /**
   * Een peiling die NA nu vertrekt: na een POST of DELETE. Een peiling die al
   * onderweg was vroeg het vóór die wijziging, en dan zag de rij zijn eigen
   * nieuwe opdracht pas een tik later.
   */
  async peilNa() {
    if (this._loopt) await this._loopt.catch(() => {});
    return this.peil();
  }

  async _peil() {
    let j;
    try {
      const r = await this.haal('/api/stems', { cache: 'no-store' });
      if (r.status === 404) {
        // Een server zonder stems: niets te doen, en dat zeggen we één keer
        // (de kolom en de rij tonen dan "—" en geen knoppen die toch falen).
        if (!this.ontbreekt) { this.ontbreekt = true; this.beschikbaar = false; this.reden = 'deze server kent /api/stems niet'; this.emit('change', this); }
        return;
      }
      j = await r.json();
      if (!r.ok) throw new Error(j?.fout || `${r.status}`);
    } catch (_) {
      return;   // server even weg: de volgende tik probeert het opnieuw
    }
    const lijst = Array.isArray(j?.opdrachten) ? j.opdrachten.filter((o) => o && o.id) : [];
    const vorige = this._gezien;
    // Herstart: een andere run, en er stond iets open dat de nieuwe niet kent.
    if (vorige && this.server && j.server && j.server !== this.server) {
      const nu = new Set(lijst.filter(isOpen).map((o) => o.track));
      const weg = this.opdrachten.filter((o) => isOpen(o) && !nu.has(o.track)).length;
      if (weg) this.emit('herstart', weg);
    }
    this.server = j.server ?? this.server;
    this.ontbreekt = false;
    this.beschikbaar = j.beschikbaar !== false;
    this.reden = j.beschikbaar === false ? (j.reden || null) : null;
    this.opdrachten = lijst;
    this._perNummer = perNummer(lijst);
    this._gezien = new Map(lijst.map((o) => [o.id, o.status]));
    if (vorige) {
      for (const o of lijst) {
        if (vorige.get(o.id) === o.status) continue;
        if (o.status === 'klaar') this.emit('klaar', o);
        else if (o.status === 'fout') this.emit('fout', o);
      }
    }
    this.emit('change', this);
  }

  /**
   * Een nummer splitsen (POST /api/stems). Geeft
   * `{ ok, opdracht?, al?, stems?, fout? }`: `al` = het had al stems met dat
   * aantal (de server doet niets). Gooit niet: een fout is tekst voor meld().
   * `vooraan`: het nummer waar je mee bezig bent, vóór de rest van de rij
   * (anders gaat de server op duur: kortste eerst; docs/STEMS.md §6).
   */
  async splits(trackId, aantal, { opnieuw = false, vooraan = false } = {}) {
    let uit;
    try {
      const r = await this.haal('/api/stems', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track: trackId, aantal, ...(opnieuw ? { opnieuw: true } : {}), ...(vooraan ? { vooraan: true } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && !j.fout) uit = { ok: false, fout: 'deze server kent /api/stems niet' };
      else if (!r.ok) uit = { ok: false, fout: j.fout || j.reden || `${r.status}` };
      else uit = { ok: true, opdracht: j.opdracht ?? null, al: !!j.al, stems: j.stems ?? null };
    } catch (err) {
      uit = { ok: false, fout: `server niet bereikbaar: ${err.message}` };
    }
    await this.peilNa();
    return uit;
  }

  /** Annuleren (wacht, bezig) of, als hij af is, uit de lijst halen (DELETE /api/stems/<id>). */
  async annuleer(opdrachtId) {
    let uit;
    try {
      const r = await this.haal(`/api/stems/${encodeURIComponent(opdrachtId)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      uit = r.ok && j.ok !== false ? { ok: true } : { ok: false, fout: j.fout || `${r.status}` };
    } catch (err) {
      uit = { ok: false, fout: `server niet bereikbaar: ${err.message}` };
    }
    await this.peilNa();
    return uit;
  }
}
