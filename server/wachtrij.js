import { randomUUID } from 'node:crypto';

/**
 * De wachtrij van de ingest: wat binnengehaald moet worden, één voor één.
 *
 * Waarom één tegelijk: dezelfde server levert de decks hun audio. Twee
 * downloads plus twee keer loudness en analyse naast elkaar maken de machine
 * trager dan nodig, en dan zit er meer tussen een geplakte lijst en het eerste
 * nummer dat klaar is. Links en eigen bestanden staan in DEZELFDE rij.
 *
 * Een opdracht is een gewoon object (dat gaat zo naar de browser):
 *   { id, sleutel, url, soort, titel, status, stap, tekst, pct, stappen,
 *     plek, begonnen, gestart, klaar, fout, track, bestond, playlist, live, opnieuw }
 * status: 'wacht' → 'bezig' → 'klaar' | 'mislukt' | 'geannuleerd'.
 *
 * De wachtrij weet niets van yt-dlp, ffmpeg of de library: het werk is een
 * functie `werk(onStap, signal)` die geeft wat ingest() geeft. Annuleren =
 * het signal. Het werk is pas afgelopen als het zelf klaar is (proces weg,
 * werkmap opgeruimd); pas dan begint de volgende.
 */

/** Open: nog niet afgelopen. */
export const isOpen = (o) => o.status === 'wacht' || o.status === 'bezig';

/** Welke velden een stap-melding mag zetten; de rest (status, id…) is van de wachtrij. */
const STAP_VELDEN = ['stap', 'tekst', 'pct', 'titel'];

export class Wachtrij {
  /**
   * @param opties.bewaar  hoeveel afgelopen opdrachten hij onthoudt (de oudste gaan eerst)
   */
  constructor({ bewaar = 200 } = {}) {
    this.bewaar = bewaar;
    this.opdrachten = new Map();   // id -> opdracht (publiek)
    this.intern = new Map();       // id -> { werk, bijAnnuleren, ac }
    this.rij = [];                 // ids die wachten, in volgorde
    this.huidig = null;            // id die nu loopt
    this._wachters = [];           // resolve-functies voor stil()
  }

  /** Een open opdracht met deze sleutel, of null. Zo komt hetzelfde nummer er niet twee keer in. */
  zoek(sleutel) {
    for (const o of this.opdrachten.values()) if (o.sleutel === sleutel && isOpen(o)) return o;
    return null;
  }

  /** Loopt er iets of wacht er iets? (De achtergrond-analyse wacht daarop.) */
  get open() { return this.huidig !== null || this.rij.length > 0; }

  /**
   * Achteraan in de rij. Staat dezelfde sleutel er al (wacht of bezig), dan
   * die, met dubbel: true. Loopt er niets, dan begint hij meteen (status
   * 'bezig' is dan al gezet als dit terugkomt).
   *
   * @param bijAnnuleren  opruimen als hij geannuleerd wordt vóór hij begon
   *                      (een upload heeft zijn werkmap dan al)
   * @param vooraan       vóór alles wat gewoon wacht, achter eerdere vooraan-
   *                      opdrachten (Clay 26 sep, VRAGEN J12: een bestand dat
   *                      je op een TRACK sleept wil je nu spelen). Wat al loopt
   *                      blijft lopen.
   * @returns {{ opdracht, dubbel: boolean }}
   */
  voegToe({ sleutel, url, soort = 'link', titel = null, stappen = [], werk, bijAnnuleren = null, vooraan = false }) {
    const al = this.zoek(sleutel);
    if (al) return { opdracht: al, dubbel: true };
    const o = this._nieuw({ sleutel, url, soort, titel, stappen,
      status: 'wacht', stap: 'wachten', tekst: 'in de wachtrij' });
    this.intern.set(o.id, { werk, bijAnnuleren, ac: null, vooraan });
    if (vooraan) {
      const i = this.rij.findIndex((id) => !this.intern.get(id)?.vooraan);
      this.rij.splice(i < 0 ? this.rij.length : i, 0, o.id);
    } else this.rij.push(o.id);
    this._nummer();
    this._volgende();
    return { opdracht: o, dubbel: false };
  }

  /**
   * Een opdracht die al af is zonder werk: "staat al in de library". Hij komt
   * in de lijst zodat de browser hem kan tonen (en laden), niet in de rij.
   */
  voegKlaarToe({ sleutel, url, soort = 'link', track, tekst }) {
    const nu = Date.now();
    const o = this._nieuw({ sleutel, url, soort, titel: track?.titel ?? null, stappen: [],
      status: 'klaar', stap: 'klaar', tekst: tekst ?? `al in de library — ${track?.titel ?? sleutel}`,
      gestart: nu, klaar: nu, track, bestond: true });
    this._ruimOp();
    return o;
  }

  _nieuw(velden) {
    const o = {
      id: randomUUID().slice(0, 8), sleutel: null, url: null, soort: 'link', titel: null,
      status: 'wacht', stap: 'wachten', tekst: '', pct: null, stappen: [], plek: null,
      begonnen: Date.now(), gestart: null, klaar: null, fout: null, track: null, bestond: false,
      ...velden,
    };
    this.opdrachten.set(o.id, o);
    return o;
  }

  /**
   * Annuleren.
   * - wacht: meteen 'geannuleerd', uit de rij, bijAnnuleren() ruimt op.
   * - bezig: het signal gaat af; de opdracht blijft 'bezig' (stap 'stoppen')
   *   tot het werk echt gestopt is en zijn werkmap weg is, dan 'geannuleerd'.
   * - afgelopen: niets te annuleren.
   * @returns {{ ok: boolean, opdracht?, reden? }}
   */
  annuleer(id) {
    const o = this.opdrachten.get(id);
    if (!o) return { ok: false, reden: 'onbekende opdracht' };
    if (o.status === 'wacht') {
      this.rij = this.rij.filter((x) => x !== id);
      const { bijAnnuleren } = this.intern.get(id) ?? {};
      this.intern.delete(id);
      Object.assign(o, { status: 'geannuleerd', stap: 'geannuleerd', tekst: 'geannuleerd', pct: null, plek: null, klaar: Date.now() });
      this._nummer();
      if (bijAnnuleren) Promise.resolve().then(bijAnnuleren).catch(() => {});
      this._stilMisschien();
      return { ok: true, opdracht: o };
    }
    if (o.status === 'bezig') {
      const i = this.intern.get(id);
      if (i?.ac && !i.ac.signal.aborted) {
        Object.assign(o, { stap: 'stoppen', tekst: 'wordt gestopt…', pct: null });
        i.ac.abort();
      }
      return { ok: true, opdracht: o };
    }
    return { ok: false, opdracht: o, reden: 'al afgelopen' };
  }

  /** Een afgelopen opdracht uit de lijst halen (wegklikken). Een open opdracht niet. */
  vergeet(id) {
    const o = this.opdrachten.get(id);
    if (!o || isOpen(o)) return false;
    this.opdrachten.delete(id);
    return true;
  }

  /** Alles, nieuwste eerst (zoals GET /api/ingest het altijd gaf). */
  lijst() {
    return [...this.opdrachten.values()].sort((a, b) => b.begonnen - a.begonnen);
  }

  /** Belooft dat de rij leeg is en niets meer loopt. Voor tests. */
  stil() {
    if (!this.open) return Promise.resolve();
    return new Promise((k) => this._wachters.push(k));
  }

  _stilMisschien() {
    if (this.open) return;
    const w = this._wachters;
    this._wachters = [];
    for (const k of w) k();
  }

  /** Plek in de rij (1 = de volgende) voor wie wacht. */
  _nummer() {
    this.rij.forEach((id, i) => { const o = this.opdrachten.get(id); if (o) o.plek = i + 1; });
  }

  _volgende() {
    if (this.huidig !== null) return;
    const id = this.rij.shift();
    this._nummer();
    if (id === undefined) { this._stilMisschien(); return; }
    const o = this.opdrachten.get(id);
    const i = this.intern.get(id);
    if (!o || !i || o.status !== 'wacht') { this._volgende(); return; }

    this.huidig = id;
    i.ac = new AbortController();
    const signaal = i.ac.signal;
    Object.assign(o, { status: 'bezig', plek: null, gestart: Date.now(), stap: o.stappen[0] ?? 'bezig', tekst: 'begint', pct: null });

    // Een melding van het werk. Zonder pct = geen percentage (anders bleef
    // de 100% van de download staan tijdens het meten). Na annuleren telt
    // alleen nog de einduitkomst.
    const onStap = (s) => {
      if (o.status !== 'bezig' || signaal.aborted || !s) return;
      o.pct = null;
      for (const k of STAP_VELDEN) if (k in s) o[k] = s[k];
      if (typeof o.pct === 'number') o.pct = Math.max(0, Math.min(100, o.pct));
    };

    Promise.resolve()
      .then(() => i.werk(onStap, signaal))
      .then((r) => this._afronden(o, r ?? { ok: false, fout: 'geen uitkomst' }, signaal))
      // Hier mag niets doorheen glippen: een kapotte ingest is normaal bedrijf.
      .catch((err) => this._afronden(o, { ok: false, fout: String(err?.message || err) }, signaal))
      .finally(() => {
        this.intern.delete(id);
        this.huidig = null;
        this._ruimOp();
        this._volgende();
      });
  }

  _afronden(o, r, signaal) {
    o.klaar = Date.now();
    o.pct = null;
    if (r.ok) {
      const t = r.track;
      Object.assign(o, {
        status: 'klaar', stap: 'klaar', track: t ?? null, bestond: !!r.bestond, titel: t?.titel ?? o.titel,
        tekst: r.bestond ? `al in de library — ${t?.titel ?? ''}`
          : t?.videoFout ? `klaar (zonder video: ${t.videoFout}) — ${t.titel}` : `klaar — ${t?.titel ?? ''}`,
      });
    } else if (signaal.aborted) {
      Object.assign(o, { status: 'geannuleerd', stap: 'geannuleerd', tekst: 'geannuleerd', fout: null });
    } else {
      Object.assign(o, { status: 'mislukt', stap: 'mislukt', fout: r.fout || 'onbekende fout', tekst: `mislukt — ${r.fout || 'onbekende fout'}`,
        ...(r.playlist ? { playlist: true } : {}), ...(r.live ? { live: true } : {}) });
    }
  }

  /** Niet eindeloos onthouden: de oudste afgelopen opdrachten gaan eruit. */
  _ruimOp() {
    const af = [...this.opdrachten.values()].filter((o) => !isOpen(o)).sort((a, b) => a.begonnen - b.begonnen);
    for (const o of af.slice(0, Math.max(0, af.length - this.bewaar))) this.opdrachten.delete(o.id);
  }
}
