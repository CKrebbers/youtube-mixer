import { randomUUID, randomBytes } from 'node:crypto';
import { open, mkdir, rm, rename, stat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, GEANNULEERD } from './ingest.js';
import { isTestserver } from './media-plek.js';

/**
 * Stems: zang en rest (of vier) per nummer, vooraf gerekend, live bediend
 * (docs/STEMS.md §2). Drie delen:
 *
 * - de SPLITTER (`Splitter`): welk commando, staat het klaar, en één split
 *   draaien. Het rekenwerk zelf is `server/stems/splits.py` (Demucs); hier
 *   alleen het proces eromheen, op dezelfde manier als de ingest yt-dlp en
 *   ffmpeg start en stopt (`run()` uit ingest.js: SIGINT, na 3 s SIGKILL voor
 *   de hele procesfamilie, het resultaat pas als het proces echt weg is).
 * - de RIJ (`StemsRij`): één opdracht tegelijk, zoals de ingest-wachtrij.
 *   Splitsen kost ~een halve minuut per nummer op de GPU; twee tegelijk maakt
 *   niets sneller en de Mac wel trager.
 * - één OPDRACHT van begin tot eind (`maakStems`): werkmap, splitsen,
 *   nalopen, atomisch verhuizen naar media/<id>/, de library bijwerken.
 *
 * De server levert ook de pagina's van spelende decks; daarom draait de
 * splitter met `nice` (lage prioriteit) en beperkt splits.py zijn threads.
 */

/** Hoeveel stems mogen er zijn, en wat bij het binnenhalen 0 (geen) mag zijn. */
export const isAantal = (x) => x === 2 || x === 4;
export const isStemsKeuze = (x) => x === 0 || isAantal(x);
/** Standaard bij het binnenhalen (Clay, VRAGEN H2): zang en rest. */
export const STEMS_STANDAARD = 2;

/** De splitter in deze repo. */
export const SPLITS_PY = fileURLToPath(new URL('./stems/splits.py', import.meta.url));
/** Waar de venv met Demucs staat als niemand iets anders zegt (docs/STEMS.md). */
export const STANDAARD_PY = join(homedir(), '.varve', 'stems-venv', 'bin', 'python');
const VENV_HULP = 'python3 -m venv --system-site-packages ~/.varve/stems-venv && ~/.varve/stems-venv/bin/pip install demucs';

/** Lage prioriteit voor het rekenwerk: de server (en Chrome) gaan voor. */
export const NICE = 10;

/**
 * Welk commando splitst, gelezen bij elke aanroep (zoals VARVE_YTDLP):
 * - VARVE_STEMS_CMD: een eigen commando (de tests: test/nep-stems.mjs); krijgt
 *   dezelfde argumenten als splits.py.
 * - VARVE_STEMS_PY: een andere Python met Demucs.
 * - anders ~/.varve/stems-venv/bin/python met server/stems/splits.py.
 * Een TESTSERVER (VARVE_TESTSERVER=1) zonder een van beide splitst niet: een
 * test die iets binnenhaalt zou anders, omdat 2 stems de standaard is, de
 * echte Demucs op zijn testgeluid zetten — seconden GPU, en een werkmap in
 * media/ waar die test niet op rekent. De reden staat erbij. VARVE_MEDIA
 * alleen is GEEN testserver (tot 11 okt wel): dat is Clay's mediamap buiten
 * iCloud (VI2), en daar moeten de stems gewoon gemaakt worden.
 */
export function stemsCommando(env = process.env) {
  if (env.VARVE_STEMS_CMD) return { cmd: env.VARVE_STEMS_CMD, args: [], commando: env.VARVE_STEMS_CMD };
  if (env.VARVE_STEMS_PY) return { cmd: env.VARVE_STEMS_PY, args: [SPLITS_PY], python: env.VARVE_STEMS_PY };
  if (isTestserver(env)) {
    return { uit: 'uit op een testserver (VARVE_TESTSERVER=1): zet VARVE_STEMS_CMD (nep-splitter) of VARVE_STEMS_PY (echte Demucs)' };
  }
  return { cmd: STANDAARD_PY, args: [SPLITS_PY], python: STANDAARD_PY };
}

/** De regel van stderr die de reden is: de laatste die geen meetwaarde (info:) is. */
export function redenUit(stderr, code) {
  const regels = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^info:/.test(l));
  const r = regels.pop();
  return r ? r.replace(/^fout:\s*/i, '').slice(0, 300) : `de splitter gaf code ${code}`;
}

/**
 * Hoe lang een split hooguit mag duren. Op de CPU haalt Demucs 0,85×
 * realtime; een vaste grens van 30 minuten (die van run()) zou een album van
 * een uur halverwege afbreken. Ruim: 10 min plus vier keer de duur.
 */
export const tijdslimiet = (duur) => Math.max(30 * 60 * 1000, (10 * 60 + 4 * (duur || 0)) * 1000);

export class Splitter {
  constructor({ env = process.env } = {}) {
    this.env = env;
    this._check = null;     // Promise van de laatste controle
    this._uitkomst = null;  // en zijn uitkomst, zodra die er is
    this._wanneer = 0;
  }

  get commando() { return stemsCommando(this.env); }

  /** De uitkomst van de controle als die er al is (synchroon), anders null. */
  get bekend() { return this._uitkomst; }

  /**
   * Staat de splitter klaar? `<commando> --controle` (Python, torch en
   * Demucs importeerbaar; het model zelf niet, dat kan downloaden). Eén keer,
   * daarna de onthouden uitkomst. `hercontrole`: was het NIET klaar en is dat
   * langer dan 30 s geleden, dan nog eens kijken — zo werkt een venv die je
   * aanmaakt terwijl de server draait zonder herstart.
   * @returns {Promise<{ ok: boolean, reden?: string, python?: string, commando?: string, apparaat?: string }>}
   */
  controleer({ hercontrole = false } = {}) {
    const oud = this._uitkomst && !this._uitkomst.ok && Date.now() - this._wanneer > 30000;
    if (this._check && !(hercontrole && oud)) return this._check;
    this._check = this._controleer().then((u) => {
      this._uitkomst = u;
      this._wanneer = Date.now();
      return u;
    });
    return this._check;
  }

  async _controleer() {
    const c = this.commando;
    if (c.uit) return { ok: false, reden: c.uit };
    const wie = c.python ? { python: c.python } : { commando: c.commando };
    const r = await run(c.cmd, [...c.args, '--controle'], { timeout: 90000 });
    if (r.code === -1 && /ENOENT/.test(r.stderr)) {
      return { ok: false, ...wie, reden: c.python ? `geen Python op ${c.python} — maak de venv: ${VENV_HULP}` : `${c.commando} bestaat niet` };
    }
    if (!r.ok) return { ok: false, ...wie, reden: `de splitter is niet bruikbaar: ${redenUit(r.stderr, r.code)}` };
    let j = null;
    try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
    if (!j?.ok) return { ok: false, ...wie, reden: 'de splitter gaf op --controle geen antwoord dat ik begrijp' };
    return { ok: true, ...wie, apparaat: j.apparaat ?? null, ...(j.demucs ? { demucs: j.demucs, torch: j.torch } : {}) };
  }

  /**
   * Eén split: `<commando> --in <audio> --uit <map> --aantal n`, met `nice`.
   * Leest `voortgang x` en `klaar` van stdout. Gooit nooit.
   * @returns {Promise<{ ok: boolean, fout?: string, afgebroken?: boolean }>}
   */
  async splits({ audio, map, aantal, signal, onVoortgang, duur = 0 }) {
    const c = this.commando;
    if (c.uit) return { ok: false, fout: c.uit };
    let klaar = false;
    const r = await run('nice', ['-n', String(NICE), c.cmd, ...c.args, '--in', audio, '--uit', map, '--aantal', String(aantal)], {
      signal,
      timeout: tijdslimiet(duur),
      onUit: (lijn) => {
        const m = /^voortgang\s+([\d.]+)$/.exec(lijn);
        if (m) onVoortgang?.(Number(m[1]));
        else if (lijn === 'klaar') klaar = true;
      },
    });
    if (r.afgebroken) return { ok: false, fout: GEANNULEERD, afgebroken: true };
    if (r.afgekapt) return { ok: false, fout: `de splitter duurde langer dan ${Math.round(tijdslimiet(duur) / 60000)} minuten en is gestopt` };
    if (!r.ok) return { ok: false, fout: redenUit(r.stderr, r.code) };
    if (!klaar) return { ok: false, fout: 'de splitter stopte zonder "klaar" te melden' };
    return { ok: true };
  }
}

/**
 * De kop van een WAV-bestand: zoekt fmt en data zelf (een LIST-chunk
 * ertussen mag), zoals splits.py en leesWavKop in de engine. Null als het
 * geen leesbare WAV is. `frames` uit de data-chunk, geklemd op wat er echt staat.
 */
export async function leesWavKop(pad) {
  let fh;
  try {
    fh = await open(pad, 'r');
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, 64 * 1024));
    await fh.read(buf, 0, buf.length, 0);
    if (buf.length < 12 || !['RIFF', 'RF64'].includes(buf.toString('latin1', 0, 4)) || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
    let fmt = null;
    for (let p = 12; p + 8 <= buf.length;) {
      const naam = buf.toString('latin1', p, p + 4), n = buf.readUInt32LE(p + 4);
      if (naam === 'fmt ' && p + 24 <= buf.length) {
        let formaat = buf.readUInt16LE(p + 8);
        if (formaat === 0xfffe && p + 34 <= buf.length) formaat = buf.readUInt16LE(p + 32);
        fmt = { formaat, kanalen: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
      } else if (naam === 'data') {
        if (!fmt || !fmt.kanalen || !fmt.bits) return null;
        const data = p + 8;
        const bytes = n === 0 || n === 0xffffffff ? size - data : Math.min(n, size - data);
        return { ...fmt, data, bytes, frames: Math.floor(bytes / (fmt.kanalen * (fmt.bits / 8))) };
      }
      p += 8 + n + (n & 1);
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** Oude stems van een nummer van schijf (de library wist de rij zelf). */
export async function wisStemsBestanden(media, id) {
  if (!/^[\w-]{1,64}$/.test(String(id))) return;
  await Promise.all(['stems.wav', 'stems.json'].map((f) => rm(join(media, id, f), { force: true }).catch(() => {})));
}

const zelfde = (a, b) => !!a && !!b && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

/**
 * Eén opdracht van begin tot eind. Gooit nooit; de werkmap is weg als dit terugkomt.
 *
 * - Werkmap media/.bezig-stems-<id>-<hex>: de splitter schrijft daar, en pas
 *   als alles klopt gaan stems.wav en stems.json naar media/<id>/ (een
 *   bestaande set wordt dan vervangen, bv. 2 → 4). Een onderbroken split laat
 *   zo nooit een half bestand naast audio.wav staan; wat bij een crash
 *   achterblijft ruimt de server bij het opstarten op (alle .bezig-*).
 * - Nalopen: aantal, kanalen, 16-bit, 48 kHz en precies evenveel frames als
 *   audio.wav — anders speelt de engine iets dat niet in de pas loopt.
 * - Is audio.wav intussen VERVANGEN (opnieuw binnengehaald: een nieuw bestand,
 *   dus een ander inode) of het nummer weggehaald, dan horen deze stems
 *   nergens meer bij: weggooien met die reden.
 *
 * @returns {Promise<{ ok: boolean, stems?: object, fout?: string, afgebroken?: boolean }>}
 */
export async function maakStems({ lib, media, splitter, trackId, aantal, audio, onVoortgang, signal }) {
  if (!/^[\w-]{1,64}$/.test(String(trackId))) return { ok: false, fout: 'onbruikbare id' };
  if (!lib.track(trackId)) return { ok: false, fout: 'het nummer staat niet (meer) in de library' };
  const voor = await stat(audio).catch(() => null);
  const kopA = voor && await leesWavKop(audio);
  if (!kopA) return { ok: false, fout: voor ? 'audio.wav is geen leesbare WAV' : 'audio.wav staat niet op schijf' };
  if (signal?.aborted) return { ok: false, fout: GEANNULEERD, afgebroken: true };

  const map = join(media, `.bezig-stems-${trackId}-${randomBytes(4).toString('hex')}`);
  try {
    await mkdir(map, { recursive: true });
    const r = await splitter.splits({ audio, map, aantal, signal, onVoortgang, duur: kopA.frames / (kopA.sr || 48000) });
    if (!r.ok) return signal?.aborted ? { ok: false, fout: GEANNULEERD, afgebroken: true } : r;

    let info = null;
    try { info = JSON.parse(await readFile(join(map, 'stems.json'), 'utf8')); } catch {}
    const kopS = await leesWavKop(join(map, 'stems.wav'));
    const fout = !info ? 'de splitter schreef geen leesbare stems.json'
      : !kopS ? 'de splitter schreef geen leesbare stems.wav'
        : info.aantal !== aantal ? `stems.json zegt ${info.aantal} stems, gevraagd ${aantal}`
          : kopS.formaat !== 1 || kopS.bits !== 16 || kopS.sr !== 48000 ? `stems.wav is geen 16-bit PCM op 48 kHz (${kopS.bits} bit, ${kopS.sr} Hz)`
            : kopS.kanalen !== 2 * aantal ? `stems.wav heeft ${kopS.kanalen} kanalen, verwacht ${2 * aantal}`
              : kopS.frames !== kopA.frames || info.frames !== kopA.frames
                ? `stems.wav heeft ${kopS.frames} frames, audio.wav ${kopA.frames} — niet in de pas` : null;
    if (fout) return { ok: false, fout };

    const na = await stat(audio).catch(() => null);
    if (!zelfde(voor, na)) return { ok: false, fout: 'audio.wav is intussen vervangen (opnieuw binnengehaald): deze stems horen bij de oude' };
    if (!lib.track(trackId)) return { ok: false, fout: 'het nummer is intussen uit de library gehaald' };
    // Laatste kans om te annuleren; hierna wordt er alleen nog verhuisd.
    if (signal?.aborted) return { ok: false, fout: GEANNULEERD, afgebroken: true };

    const doel = join(media, trackId);
    await mkdir(doel, { recursive: true });
    await rename(join(map, 'stems.wav'), join(doel, 'stems.wav'));
    await rename(join(map, 'stems.json'), join(doel, 'stems.json'));
    const stems = lib.bewaarStems(trackId, { ...info, bestand: `media/${trackId}/stems.wav` });
    return { ok: true, stems };
  } catch (err) {
    // Wat hier ook misgaat (schijf vol, database): de rij loopt door.
    return { ok: false, fout: `onverwachte fout: ${err?.message || err}` };
  } finally {
    await rm(map, { recursive: true, force: true }).catch(() => {});
  }
}

/** Open: nog niet afgelopen. */
export const isOpen = (o) => o.status === 'wacht' || o.status === 'bezig';

/**
 * De stems-rij: één opdracht tegelijk, in volgorde, annuleren met een
 * AbortSignal. Dezelfde opbouw als de ingest-wachtrij (server/wachtrij.js),
 * met de vorm uit docs/STEMS.md:
 *   { id, track, titel, aantal, status, voortgang, fout, toegevoegd, begon, klaar, plek, stoppen?, opnieuw?, stems? }
 * status: 'wacht' → 'bezig' → 'klaar' | 'fout' | 'geannuleerd'; voortgang 0..1.
 *
 * Het werk is een functie `werk(onVoortgang, signal)` die geeft wat
 * maakStems() geeft. Annuleren = het signal; de opdracht blijft 'bezig'
 * (stoppen: true) tot het werk echt klaar is (proces weg, werkmap weg).
 *
 * `bijWijziging(openLijst())` na elke verandering van wat er open staat: de
 * server bewaart dat, zodat de rij een herstart overleeft (docs/STEMS.md §2).
 */
export class StemsRij {
  constructor({ bewaar = 200, bijWijziging = null } = {}) {
    this.bewaar = bewaar;
    this.bijWijziging = bijWijziging;
    this.opdrachten = new Map();   // id -> opdracht (publiek)
    this.intern = new Map();       // id -> { werk, ac }
    this.rij = [];                 // ids die wachten, in volgorde
    this.huidig = null;
    this._wachters = [];
    this._volgnr = new Map();      // id -> volgnummer: "nieuwste eerst" ook binnen één milliseconde
    this._teller = 0;
  }

  /** Loopt er iets of wacht er iets? */
  get open() { return this.huidig !== null || this.rij.length > 0; }

  /**
   * De open opdracht voor dit nummer, of null. Een opdracht die al gestopt
   * WORDT telt niet: na opnieuw binnenhalen moet er een nieuwe achter kunnen.
   */
  zoek(track) {
    for (const o of this.opdrachten.values()) if (o.track === track && isOpen(o) && !o.stoppen) return o;
    return null;
  }

  /**
   * De rij in. Staat dit nummer er al (wacht of bezig), dan die, met dubbel:
   * true (en met `vooraan` schuift een wachtende naar voren). Loopt er niets,
   * dan begint hij meteen.
   *
   * VOLGORDE (5 okt, docs/STEMS.md §6): eerst wat VOORAAN gevraagd is (het nummer
   * waar je mee bezig bent: splitsen vanuit de STEMS-rij), in de volgorde van
   * vragen; daarna de KORTSTE eerst (`duur` in seconden; onbekend achteraan).
   * Demucs haalt op de M1 ~3× realtime: een mix van een uur hield vijf korte
   * nummers drie kwartier vast. Wat al loopt, loopt door (een split kan niet
   * verder waar hij stopte).
   * @returns {{ opdracht, dubbel: boolean }}
   */
  voegToe({ track, titel = null, aantal, werk, opnieuw = false, duur = null, vooraan = false }) {
    const al = this.zoek(track);
    if (al) {
      if (vooraan) this.naarVoren(al.id);
      return { opdracht: al, dubbel: true };
    }
    const o = this._nieuw({ track, titel, aantal, duur: Number.isFinite(duur) && duur > 0 ? duur : null,
      ...(opnieuw ? { opnieuw: true } : {}) });
    this.intern.set(o.id, { werk, ac: null });
    this.rij.push(o.id);
    if (vooraan) this.naarVoren(o.id);
    else this._sorteer();
    this._volgende();
    this._meld();
    return { opdracht: o, dubbel: false };
  }

  /** Een wachtende opdracht vooraan zetten (na eerdere vooraan-opdrachten). @returns of het lukte */
  naarVoren(id) {
    const o = this.opdrachten.get(id);
    if (!o || o.status !== 'wacht' || !this.rij.includes(id)) return false;
    o.vooraan = ++this._teller;
    this._sorteer();
    this._meld();
    return true;
  }

  /**
   * Wat er open staat, in de volgorde waarin het loopt (wat nu loopt eerst;
   * wat gestopt wordt niet): genoeg om het na een herstart terug te zetten.
   * @returns {{ track, aantal, opnieuw?, vooraan? }[]}
   */
  openLijst() {
    return [...(this.huidig ? [this.huidig] : []), ...this.rij]
      .map((id) => this.opdrachten.get(id))
      .filter((o) => o && isOpen(o) && !o.stoppen)
      .map((o) => ({ track: o.track, aantal: o.aantal, ...(o.opnieuw ? { opnieuw: true } : {}), ...(o.vooraan ? { vooraan: true } : {}) }));
  }

  _meld() {
    try { this.bijWijziging?.(this.openLijst()); } catch (err) { console.error('[stems] bijWijziging:', err?.message || err); }
  }

  /** De wachtrij op volgorde: vooraan (op volgorde van vragen), dan kortste eerst, dan zoals ze kwamen. */
  _sorteer() {
    const sleutel = (id) => {
      const o = this.opdrachten.get(id);
      return [o?.vooraan ? 0 : 1, o?.vooraan || 0, o?.duur ?? Infinity, this._volgnr.get(id) ?? 0];
    };
    this.rij.sort((a, b) => {
      const x = sleutel(a), y = sleutel(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return 0;
    });
    this._nummer();
  }

  /**
   * Een opdracht die meteen 'fout' is: gevraagd (bij het binnenhalen), maar
   * de splitter is er niet. Zo zie je WAAROM er geen stems komen, in plaats
   * van dat er stil niets gebeurt.
   */
  voegFoutToe({ track, titel = null, aantal, fout }) {
    const nu = Date.now();
    const o = this._nieuw({ track, titel, aantal, status: 'fout', fout, klaar: nu });
    this._ruimOp();
    return o;
  }

  _nieuw(velden) {
    const o = {
      id: randomUUID().slice(0, 8), track: null, titel: null, aantal: null,
      status: 'wacht', voortgang: 0, fout: null, toegevoegd: Date.now(), begon: null, klaar: null, plek: null,
      ...velden,
    };
    this.opdrachten.set(o.id, o);
    this._volgnr.set(o.id, ++this._teller);
    return o;
  }

  /**
   * Annuleren. Wacht: meteen 'geannuleerd'. Bezig: het signal gaat af en de
   * opdracht blijft 'bezig' met stoppen: true tot het werk gestopt is.
   * @returns {{ ok: boolean, opdracht?, reden? }}
   */
  annuleer(id) {
    const o = this.opdrachten.get(id);
    if (!o) return { ok: false, reden: 'onbekende opdracht' };
    if (o.status === 'wacht') {
      this.rij = this.rij.filter((x) => x !== id);
      this.intern.delete(id);
      Object.assign(o, { status: 'geannuleerd', plek: null, klaar: Date.now() });
      this._nummer();
      this._stilMisschien();
      this._meld();
      return { ok: true, opdracht: o };
    }
    if (o.status === 'bezig') {
      const i = this.intern.get(id);
      if (i?.ac && !i.ac.signal.aborted) { o.stoppen = true; i.ac.abort(); }
      this._meld();
      return { ok: true, opdracht: o };
    }
    return { ok: false, opdracht: o, reden: 'al afgelopen' };
  }

  /** Alle open opdrachten van één nummer annuleren (het nummer gaat weg). */
  annuleerTrack(track) {
    for (const o of [...this.opdrachten.values()]) if (o.track === track && isOpen(o)) this.annuleer(o.id);
  }

  /** Een afgelopen opdracht uit de lijst halen (wegklikken). Een open opdracht niet. */
  vergeet(id) {
    const o = this.opdrachten.get(id);
    if (!o || isOpen(o)) return false;
    this._weg(id);
    return true;
  }

  _weg(id) {
    this.opdrachten.delete(id);
    this._volgnr.delete(id);
  }

  /** Alles, nieuwste eerst (zoals GET /api/ingest). */
  lijst() {
    return [...this.opdrachten.values()].sort((a, b) => this._volgnr.get(b.id) - this._volgnr.get(a.id));
  }

  /** Belooft dat de rij leeg is en niets meer loopt. */
  stil() {
    if (!this.open) return Promise.resolve();
    return new Promise((k) => this._wachters.push(k));
  }

  /** Alles stoppen (de server gaat uit): wat wacht vervalt, wat loopt wordt geannuleerd. */
  stop() {
    for (const id of [...this.rij]) this.annuleer(id);
    if (this.huidig) this.annuleer(this.huidig);
    return this.stil();
  }

  _stilMisschien() {
    if (this.open) return;
    const w = this._wachters;
    this._wachters = [];
    for (const k of w) k();
  }

  _nummer() {
    this.rij.forEach((id, i) => { const o = this.opdrachten.get(id); if (o) o.plek = i + 1; });
  }

  _volgende() {
    if (this.huidig !== null) return;
    const id = this.rij.shift();
    this._nummer();
    if (id === undefined) { this._stilMisschien(); this._meld(); return; }
    const o = this.opdrachten.get(id);
    const i = this.intern.get(id);
    if (!o || !i || o.status !== 'wacht') { this._volgende(); return; }

    this.huidig = id;
    i.ac = new AbortController();
    const signaal = i.ac.signal;
    Object.assign(o, { status: 'bezig', plek: null, begon: Date.now(), voortgang: 0 });
    this._meld();
    // Voortgang loopt alleen op (een late regel na annuleren telt niet).
    const onVoortgang = (x) => {
      if (o.status !== 'bezig' || signaal.aborted || !Number.isFinite(x)) return;
      o.voortgang = Math.max(o.voortgang, Math.min(1, Math.max(0, x)));
    };
    Promise.resolve()
      .then(() => i.werk(onVoortgang, signaal))
      .then((r) => this._afronden(o, r ?? { ok: false, fout: 'geen uitkomst' }, signaal))
      // Een kapotte split is normaal bedrijf: de rij loopt door.
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
    delete o.stoppen;
    if (r.ok) Object.assign(o, { status: 'klaar', voortgang: 1, fout: null, ...(r.stems ? { stems: r.stems } : {}) });
    else if (signaal.aborted) Object.assign(o, { status: 'geannuleerd', fout: null });
    else Object.assign(o, { status: 'fout', fout: r.fout || 'onbekende fout' });
  }

  /** Niet eindeloos onthouden: de oudste afgelopen opdrachten gaan eruit. */
  _ruimOp() {
    const af = [...this.opdrachten.values()].filter((o) => !isOpen(o)).sort((a, b) => this._volgnr.get(a.id) - this._volgnr.get(b.id));
    for (const o of af.slice(0, Math.max(0, af.length - this.bewaar))) this._weg(o.id);
  }
}
