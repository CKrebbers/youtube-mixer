import { Worker } from 'node:worker_threads';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Backups van de library (docs/LIBRARY.md, "Backup").
 *
 * `library.db` bevat handwerk dat nergens anders staat: grids op slot,
 * hotcues, racks, toonsoorten, de eigen mapping. Daarom een kopie bij het
 * opstarten en daarna elk uur, maar alleen als er iets veranderde.
 *
 * HOE: `VACUUM INTO` op een EIGEN verbinding in een worker_thread
 * (`backup-werker.js`). De database staat in WAL-modus: wat net bewaard is,
 * staat vaak nog alleen in `library.db-wal`. Het bestand kopiëren mist dat (of
 * pakt een half geschreven pagina); VACUUM INTO leest via SQLite zelf, in één
 * leestransactie, en schrijft een momentopname die klopt. In WAL blokkeert een
 * lezer geen schrijver: de server bewaart gewoon door terwijl de kopie loopt.
 * De kopie is één los bestand in gewone journal-modus (geen -wal ernaast).
 *
 * WAAROM een worker: gemeten (2 okt 2026, 4 kernen, rustig): VACUUM INTO
 * ~7 ms voor 500 nummers (1,5 MB) en ~40 ms voor 5000 (14,6 MB). Met controle
 * en hash erbij stond de hoofdthread 15 ms resp. 95–110 ms stil. In de worker
 * is de langste hapering van de hoofdthread 3–4 ms (zonder backup 2–4 ms: ruis);
 * de backup zelf duurt dan 60–220 ms wandtijd (opstarten van de worker). De
 * server levert ook de pagina's van spelende decks, dus de hoofdthread blijft
 * vrij, zoals bij analyse-werker.js.
 *
 * WANNEER: bij het opstarten altijd proberen; daarna elk uur alleen als
 * `wijzigingen()` (SQLite's total_changes() van de serververbinding) verschilt
 * van de vorige geslaagde backup. En dan nog alleen bewaren als de inhoud
 * echt anders is dan de nieuwste kopie: VACUUM INTO geeft voor dezelfde inhoud
 * byte voor byte hetzelfde bestand (gemeten), dus een SHA-256 volstaat. Zo
 * geeft een herstart zonder wijziging geen nieuwe kopie, en ook "hotcue
 * gezet en weer gewist" niet.
 *
 * HOEVEEL: de laatste 12 (een sessie met elk uur een wijziging past erin) plus
 * de nieuwste van elke dag van de laatste 30 dagen. Hooguit 42 kopieën; bij
 * 500 nummers ~1,5 MB per stuk, dus ~65 MB. Een fout die je pas na weken
 * merkt (een grid dat stilletjes verdween) is zo nog terug te halen.
 * Alleen bestanden met onze naam worden ooit weggegooid.
 *
 * Gooit nooit: een mislukte backup is een regel in het log en een `fout` in
 * `stand()`, de server draait door.
 */

/** Zoveel van de nieuwste kopieën blijven altijd staan. */
export const BEWAAR_LAATSTE = 12;
/** En de nieuwste van elke dag, zoveel dagen terug (vandaag telt mee). */
export const BEWAAR_DAGEN = 30;
/** Standaard elk uur kijken of er iets veranderde. */
export const ELKE_MS = 60 * 60 * 1000;
/** Duurt een backup langer, dan geldt hij als mislukt (een externe schijf die hangt). */
export const MAX_DUUR_MS = 120 * 1000;

const NAAM = /^library-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?\.db$/;
/** Een halve kopie van een backup die nooit afkwam (server gestopt midden in VACUUM INTO). */
export const BEZIG = /^\.bezig-backup-[\w-]+\.db$/;

const twee = (n) => String(n).padStart(2, '0');

/** De naam van een kopie op dit moment, in LOKALE tijd (zo leest Clay hem): library-2026-10-02_14-05-33.db. */
export function naamVoor(d) {
  return `library-${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`
    + `_${twee(d.getHours())}-${twee(d.getMinutes())}-${twee(d.getSeconds())}.db`;
}

/** Is dit een kopie van ons? Geeft { dag (YYYY-MM-DD), sleutel (om op te sorteren) } of null. */
export function leesNaam(naam) {
  const m = NAAM.exec(naam);
  if (!m) return null;
  return { dag: `${m[1]}-${m[2]}-${m[3]}`, sleutel: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}.${(m[7] ?? '1').padStart(6, '0')}` };
}

/** Onze kopieën uit een lijst bestandsnamen, nieuwste eerst. Andere bestanden vallen weg. */
export function kopieen(namen) {
  return namen.map((naam) => ({ naam, ...leesNaam(naam) })).filter((k) => k.dag)
    .sort((a, b) => (a.sleutel < b.sleutel ? 1 : a.sleutel > b.sleutel ? -1 : 0));
}

/** Het dagnummer van een lokale datum (DST-veilig: middag als ijkpunt). */
const dagnr = (j, m, d) => Math.round(new Date(j, m - 1, d, 12).getTime() / 864e5);

/**
 * Welke kopieën weg mogen. Puur: namen erin, namen eruit.
 * Blijft: de `laatste` nieuwste, plus de nieuwste van elke dag die hooguit
 * `dagen - 1` dagen voor `nu` ligt. Een naam die niet van ons is, komt er
 * nooit in. Een kopie met een datum in de toekomst (klok verzet) valt onder
 * "nieuwste" en blijft dus gewoon staan zolang hij bij de laatste hoort.
 */
export function wegTeGooien(namen, nu = new Date(), { laatste = BEWAAR_LAATSTE, dagen = BEWAAR_DAGEN } = {}) {
  const lijst = kopieen(namen);
  const vandaag = dagnr(nu.getFullYear(), nu.getMonth() + 1, nu.getDate());
  const blijft = new Set(lijst.slice(0, laatste).map((k) => k.naam));
  const gezien = new Set();
  for (const k of lijst) {
    if (gezien.has(k.dag)) continue;
    gezien.add(k.dag);
    const [j, m, d] = k.dag.split('-').map(Number);
    if (vandaag - dagnr(j, m, d) < dagen) blijft.add(k.naam);
  }
  return lijst.filter((k) => !blijft.has(k.naam)).map((k) => k.naam);
}

export class Backups {
  /**
   * @param {object} o
   * @param {string} o.db          pad van library.db
   * @param {string} o.map         waar de kopieën komen
   * @param {() => number} [o.wijzigingen]  teller van de serververbinding (Library.wijzigingen)
   * @param {number} [o.elke]      ms tussen twee keer kijken
   * @param {(s: string) => void} [o.log]
   * @param {() => Date} [o.klok]  voor de tests
   */
  constructor({ db, map, wijzigingen = () => NaN, elke = ELKE_MS, log = console.log, klok = () => new Date() }) {
    Object.assign(this, { db, map, wijzigingen, elke, log, klok });
    this._timer = null;
    this._bezig = null;          // de lopende backup (een promise)
    this._teller = undefined;    // wijzigingen() bij de laatste geslaagde backup
    this._stand = { laatste: null, aantal: 0, gekeken: null, fout: null, foutTijd: null };
  }

  /**
   * Wat de Controlekamer te zien krijgt. Geen paden: alleen naam, tijd en grootte.
   * `gewijzigdSinds` (het avondpakket, docs/AVONDPAKKET.md): staat er een wijziging
   * in library.db die nog in geen kopie zit? false vóór de eerste geslaagde backup
   * en zolang de teller gelijk is aan die van de laatste; null als de teller niet
   * te lezen is. De tegel Backup gebruikt hem niet.
   */
  stand() {
    let gewijzigdSinds = false;
    try {
      const t = this.wijzigingen();
      gewijzigdSinds = this._teller !== undefined && Number.isFinite(t) && t !== this._teller;
    } catch { gewijzigdSinds = null; }
    return { ...this._stand, bezig: !!this._bezig, gewijzigdSinds };
  }

  /** Bij het opstarten één keer meteen, daarna op de timer. */
  start() {
    this.nu('opstarten');
    if (this.elke > 0) {
      this._timer = setInterval(() => this.nu('periodiek', { alleenGewijzigd: true }), this.elke);
      this._timer.unref?.();
    }
    return this;
  }

  stop() { clearInterval(this._timer); this._timer = null; }

  /**
   * Eén backup. `alleenGewijzigd`: niets doen als de teller sinds de vorige
   * geslaagde gelijk bleef. Geeft { ok, nieuw?, naam?, fout? }; gooit nooit.
   * Loopt er al een, dan krijg je die.
   */
  nu(reden = 'gevraagd', { alleenGewijzigd = false } = {}) {
    if (this._bezig) return this._bezig;
    let teller;
    try { teller = this.wijzigingen(); } catch { teller = NaN; }
    if (alleenGewijzigd && this._teller !== undefined && teller === this._teller) {
      this._stand.gekeken = this.klok().getTime();
      return Promise.resolve({ ok: true, nieuw: false, reden: 'niets veranderd' });
    }
    this._bezig = this._maak(reden, teller)
      .catch((err) => {
        const fout = String(err?.message || err);
        this._stand.fout = fout;
        this._stand.foutTijd = this.klok().getTime();
        this.log(`[backup] MISLUKT (${reden}): ${fout}`);
        return { ok: false, fout };
      })
      .finally(() => { this._bezig = null; });
    return this._bezig;
  }

  async _maak(reden, teller) {
    const t0 = performance.now();
    const nu = this.klok();
    // Wat er al staat: de nieuwste (om mee te vergelijken) en een vrije naam.
    const namen = await readdir(this.map).catch((err) => (err.code === 'ENOENT' ? [] : Promise.reject(err)));
    // Restanten van een backup die nooit afkwam.
    for (const n of namen.filter((x) => BEZIG.test(x))) await rm(join(this.map, n), { force: true }).catch(() => {});
    const lijst = kopieen(namen);
    let naam = naamVoor(nu);
    for (let i = 2; namen.includes(naam); i++) naam = naamVoor(nu).replace(/\.db$/, `-${i}.db`);

    const r = await inWerker({
      db: this.db, map: this.map, naam,
      tijdelijk: `.bezig-backup-${process.pid}-${Date.now().toString(36)}.db`,
      vorige: lijst[0] ? lijst[0].naam : null,
    });
    if (!r.ok) throw new Error(r.fout);
    if (Number.isFinite(teller)) this._teller = teller;
    this._stand.fout = null;
    this._stand.foutTijd = null;
    this._stand.gekeken = nu.getTime();
    const ms = Math.round(performance.now() - t0);
    if (r.nieuw) {
      this._stand.laatste = { naam, tijd: nu.getTime(), bytes: r.bytes };
      this.log(`[backup] ${naam} (${(r.bytes / 1e6).toFixed(1)} MB, ${ms} ms, ${reden})`);
    } else if (lijst[0] && !this._stand.laatste) {
      // Ongewijzigd sinds de vorige run: die kopie is de laatste.
      const info = await stat(join(this.map, lijst[0].naam)).catch(() => null);
      this._stand.laatste = { naam: lijst[0].naam, tijd: info ? Math.round(info.mtimeMs) : null, bytes: info?.size ?? null };
    }
    // Opruimen, ook als er niets nieuws bij kwam (de grens kan veranderd zijn).
    const nuNamen = r.nieuw ? [...namen, naam] : namen;
    const weg = wegTeGooien(nuNamen, nu);
    for (const n of weg) await rm(join(this.map, n), { force: true }).catch((err) => this.log(`[backup] ${n} niet weg: ${err.message}`));
    this._stand.aantal = kopieen(nuNamen).length - weg.length;
    return { ok: true, nieuw: r.nieuw, naam: r.nieuw ? naam : lijst[0]?.naam ?? null, ms, weg };
  }
}

/** De worker draaien; een fout, een crash of te lang = { ok: false, fout }. */
function inWerker(opdracht) {
  return new Promise((klaar) => {
    let w;
    const bestand = new URL('./backup-werker.js', import.meta.url);
    try {
      // Zonder de vlag drukt elke worker opnieuw "SQLite is an experimental
      // feature" af: elk uur een regel ruis in het log. Kent deze Node de
      // vlag niet, dan zonder.
      try {
        w = new Worker(bestand, { workerData: opdracht, execArgv: [...process.execArgv, '--disable-warning=ExperimentalWarning'] });
      } catch (_) {
        w = new Worker(bestand, { workerData: opdracht });
      }
    } catch (err) { klaar({ ok: false, fout: String(err?.message || err) }); return; }
    let klaarGemeld = false;
    const eind = (r) => { if (!klaarGemeld) { klaarGemeld = true; clearTimeout(wekker); klaar(r); } };
    const wekker = setTimeout(() => { eind({ ok: false, fout: `duurde langer dan ${MAX_DUUR_MS / 1000} s` }); w.terminate(); }, MAX_DUUR_MS);
    w.on('message', eind);
    w.on('error', (err) => eind({ ok: false, fout: String(err?.message || err) }));
    w.on('exit', (code) => eind({ ok: false, fout: `backup-werker stopte (code ${code})` }));
  });
}
