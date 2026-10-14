import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, GEANNULEERD } from './ingest.js';
import { isTestserver } from './media-plek.js';
import { STANDAARD_PY, NICE, redenUit } from './stems.js';

/**
 * TELLEN (docs/BEATGRID.md §11, 6 okt): waar de tellen en de downbeats
 * vallen, gevonden door Beat This! (server/tellen/tellen.py), bewaard als
 * media/<id>/tellen.json. Het grid wordt daar daarna uit gemaakt
 * (src/engine/tellen.js); dat gebeurt in index.js, waar de library is.
 *
 * Drie delen, zoals de stems (server/stems.js):
 * - de ZOEKER (`Tellenzoeker`): welk commando, staat het klaar, één nummer
 *   draaien (met `nice`, via run(): SIGINT, na 3 s SIGKILL);
 * - de RIJ (`TellenRij`): één nummer tegelijk, zonder scherm: het gaat snel
 *   (~1,5 s per minuut muziek op de GPU) en het opstarten vindt vanzelf terug
 *   wat er nog moet (geen tellen.json), dus niets te bewaren bij een herstart;
 * - het GPU-SLOT (`GpuSlot`): de tellen en de stems gebruiken allebei de GPU.
 *   Tegelijk maakt ze allebei trager (6 okt: 2,8 minuut muziek duurde 53 s
 *   naast een split, tegen 4 s alleen), dus om de beurt; de tellen met
 *   voorrang: een nummer dat net binnenkwam krijgt zijn tellen na de split
 *   die loopt, niet na de hele stems-rij.
 */

export const TELLEN_PY = fileURLToPath(new URL('./tellen/tellen.py', import.meta.url));
export const TELLEN_BESTAND = 'tellen.json';
/** De versie van tellen.json (VERSIE in tellen.py); een oudere wordt opnieuw gemaakt. */
export const TELLEN_VERSIE = 1;
export const TELLEN_HULP = '~/.varve/stems-venv/bin/pip install beat-this==1.1.0, en het model: '
  + 'curl -L -o ~/.varve/modellen/beat_this-final0.ckpt --create-dirs '
  + 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt';

/**
 * Welk commando de tellen zoekt, gelezen bij elke aanroep (zoals de stems):
 * - VARVE_TELLEN_CMD: een eigen commando (de tests: test/nep-tellen.mjs);
 *   krijgt dezelfde argumenten als tellen.py.
 * - VARVE_TELLEN_PY, anders VARVE_STEMS_PY: die Python (de venv van de stems).
 * - anders ~/.varve/stems-venv/bin/python.
 * Een testserver (VARVE_TESTSERVER=1) zonder een van deze zoekt geen tellen.
 * VARVE_MEDIA alleen is GEEN testserver: dat is Clay's mediamap buiten iCloud
 * (VI2, docs/LIBRARY.md "Waar media/ staat"); daar blijven de tellen aan.
 */
export function tellenCommando(env = process.env) {
  if (env.VARVE_TELLEN_CMD) return { cmd: env.VARVE_TELLEN_CMD, args: [], commando: env.VARVE_TELLEN_CMD };
  const py = env.VARVE_TELLEN_PY || env.VARVE_STEMS_PY;
  if (py) return { cmd: py, args: [TELLEN_PY], python: py };
  if (isTestserver(env)) {
    return { uit: 'uit op een testserver (VARVE_TESTSERVER=1): zet VARVE_TELLEN_CMD (nep) of VARVE_TELLEN_PY (echte Beat This!)' };
  }
  return { cmd: STANDAARD_PY, args: [TELLEN_PY], python: STANDAARD_PY };
}

/** Hooguit 10 minuten plus de duur van het nummer (op de CPU ~10 s per minuut muziek). */
export const tellenTijdslimiet = (duur) => (10 * 60 + (duur || 0)) * 1000;

export class Tellenzoeker {
  constructor({ env = process.env } = {}) {
    this.env = env;
    this._check = null;
    this._uitkomst = null;
    this._wanneer = 0;
  }

  get commando() { return tellenCommando(this.env); }
  get bekend() { return this._uitkomst; }

  /**
   * Staat alles klaar? `<commando> --controle`: Python, torch, beat-this en het
   * modelbestand. Eén keer, daarna de onthouden uitkomst; `hercontrole` kijkt
   * na 30 s opnieuw als het er niet was (een venv die je intussen maakte).
   * @returns {Promise<{ ok: boolean, reden?: string, python?: string, apparaat?: string, model?: string }>}
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
      return { ok: false, ...wie, reden: c.python ? `geen Python op ${c.python} — ${TELLEN_HULP}` : `${c.commando} bestaat niet` };
    }
    if (!r.ok) return { ok: false, ...wie, reden: `de tellenzoeker is niet bruikbaar: ${redenUit(r.stderr, r.code)}` };
    let j = null;
    try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
    if (!j?.ok) return { ok: false, ...wie, reden: 'de tellenzoeker gaf op --controle geen antwoord dat ik begrijp' };
    return { ok: true, ...wie, apparaat: j.apparaat ?? null, ...(j.beat_this ? { beatThis: j.beat_this, model: j.model } : {}) };
  }

  /**
   * Eén nummer: `<commando> --in <audio> --uit <tellen.json>`, met `nice`.
   * Leest `voortgang x` en `klaar`. Gooit nooit.
   * @returns {Promise<{ ok: boolean, fout?: string, afgebroken?: boolean }>}
   */
  async zoek({ audio, uit, signal, onVoortgang, duur = 0 }) {
    const c = this.commando;
    if (c.uit) return { ok: false, fout: c.uit };
    let klaar = false;
    const r = await run('nice', ['-n', String(NICE), c.cmd, ...c.args, '--in', audio, '--uit', uit], {
      signal,
      timeout: tellenTijdslimiet(duur),
      onUit: (lijn) => {
        const m = /^voortgang\s+([\d.]+)$/.exec(lijn);
        if (m) onVoortgang?.(Number(m[1]));
        else if (lijn === 'klaar') klaar = true;
      },
    });
    if (r.afgebroken) {
      await rm(uit + '.tmp', { force: true }).catch(() => {});
      return { ok: false, fout: GEANNULEERD, afgebroken: true };
    }
    if (r.afgekapt) return { ok: false, fout: `de tellenzoeker duurde langer dan ${Math.round(tellenTijdslimiet(duur) / 60000)} minuten en is gestopt` };
    if (!r.ok) return { ok: false, fout: redenUit(r.stderr, r.code) };
    if (!klaar) return { ok: false, fout: 'de tellenzoeker stopte zonder "klaar" te melden' };
    return { ok: true };
  }
}

/** Een gesorteerde lijst eindige getallen ≥ 0, of null. */
function tijden(x, max = 200000) {
  if (!Array.isArray(x) || x.length > max) return null;
  const uit = [];
  for (const t of x) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null;
    uit.push(t);
  }
  return uit.sort((a, b) => a - b);
}

/**
 * tellen.json van een nummer, nagekeken: { versie, beats, downbeats, model?, sec? }
 * of null (er is er geen, of hij is onleesbaar). Onthouden per bestand (mtime):
 * een uur mix is ~9.000 tellen, de route vraagt hem bij elk laden.
 */
const geheugen = new Map();
export async function leesTellen(media, id) {
  if (!/^[\w-]{1,64}$/.test(String(id))) return null;
  const pad = join(media, id, TELLEN_BESTAND);
  let s;
  try { s = await stat(pad); } catch { geheugen.delete(id); return null; }
  const c = geheugen.get(id);
  if (c && c.mtimeMs === s.mtimeMs && c.size === s.size) return c.tellen;
  let j;
  try { j = JSON.parse(await readFile(pad, 'utf8')); } catch { return null; }
  const beats = tijden(j?.beats), downbeats = tijden(j?.downbeats ?? []);
  if (!beats || !downbeats) return null;
  const tellen = {
    versie: Number.isInteger(j.versie) ? j.versie : 0, beats, downbeats,
    ...(typeof j.model === 'string' ? { model: j.model } : {}), ...(Number.isFinite(j.sec) ? { sec: j.sec } : {}),
  };
  geheugen.set(id, { mtimeMs: s.mtimeMs, size: s.size, tellen });
  return tellen;
}

/**
 * DE TWEEDE MENING BEWAARD (review ronde 1, 14 okt): het grid van de oude
 * analyse (maakGrid) waarmee de tellen vergeleken worden, als
 * media/<id>/tweede-mening.json { versie, grid }. Een nieuwe kaartversie
 * (VERSIE in src/engine/tellen.js) rekent dan alleen gridUitTellen en
 * vergelijk opnieuw (milliseconden), niet de oude analyse (0,7-4 s per
 * nummer van 3 minuten, met ffmpeg op media/). `versie` =
 * OUDE_ANALYSE_VERSIE (server/analyze.js): een andere = niet bruikbaar.
 */
export const TWEEDE_BESTAND = 'tweede-mening.json';

export async function leesTweede(media, id, versie) {
  if (!/^[\w-]{1,64}$/.test(String(id))) return null;
  try {
    const j = JSON.parse(await readFile(join(media, id, TWEEDE_BESTAND), 'utf8'));
    return j?.versie === versie && Array.isArray(j.grid?.stukken) && j.grid.stukken.length ? j.grid : null;
  } catch { return null; }
}

/**
 * Bewaren (eerst .tmp, dan hernoemen: een halve schrijf is nooit een tweede mening). Gooit nooit.
 * `uit`: 'maakGrid' (nu uitgerekend) of 'grid' (het grid van de oude analyse dat in de library stond,
 * bij de ingest gemaakt: niet per se van deze versie, wel waar vergelijk mee werkte).
 */
export async function bewaarTweede(media, id, grid, versie, { uit = 'maakGrid' } = {}) {
  if (!/^[\w-]{1,64}$/.test(String(id)) || !grid) return false;
  const pad = join(media, id, TWEEDE_BESTAND);
  try {
    await writeFile(pad + '.tmp', JSON.stringify({ versie, uit, grid }));
    await rename(pad + '.tmp', pad);
    return true;
  } catch { return false; }
}

/** tellen.json weg (nieuwe audio: de oude tellen kloppen niet meer), en de bewaarde tweede mening ook. */
export async function wisTellen(media, id) {
  if (!/^[\w-]{1,64}$/.test(String(id))) return;
  geheugen.delete(id);
  await Promise.all([TELLEN_BESTAND, TELLEN_BESTAND + '.tmp', TWEEDE_BESTAND, TWEEDE_BESTAND + '.tmp']
    .map((f) => rm(join(media, id, f), { force: true }).catch(() => {})));
}

/**
 * Om de beurt de GPU. `pak(signal)` wacht tot het slot vrij is (wie eerst
 * vroeg, eerst) en geeft een functie die het weer vrijgeeft; met een
 * afgebroken signaal komt hij met null terug (niet meer in de rij).
 * `voorrang`: vóór wie zonder voorrang wacht (de tellen: een paar seconden
 * per nummer, en je wilt je grid; een split van een mix duurt een half uur).
 * Wat al loopt maakt altijd af.
 */
export class GpuSlot {
  constructor() { this.bezet = false; this.wachtend = []; this.dicht = false; }

  /**
   * Even niemand erop (het opstarten: de herstelde stems-rij zou de GPU
   * pakken vóór de tellen in hun rij staan). Wie wacht, blijft wachten;
   * `open()` laat de eerste in de rij (met voorrang eerst) los.
   */
  sluit() { this.dicht = true; }
  open() { this.dicht = false; this._volgende(); }

  pak(signal = null, { voorrang = false } = {}) {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((klaar) => {
      const w = { klaar, signal, weg: null, voorrang };
      if (signal) {
        w.weg = () => {
          const i = this.wachtend.indexOf(w);
          if (i >= 0) { this.wachtend.splice(i, 1); klaar(null); }
        };
        signal.addEventListener('abort', w.weg, { once: true });
      }
      const plek = voorrang ? this.wachtend.findIndex((x) => !x.voorrang) : -1;
      if (plek >= 0) this.wachtend.splice(plek, 0, w); else this.wachtend.push(w);
      this._volgende();
    });
  }
  _volgende() {
    if (this.bezet || this.dicht || !this.wachtend.length) return;
    const w = this.wachtend.shift();
    w.signal?.removeEventListener('abort', w.weg);
    this.bezet = true;
    let vrij = false;
    w.klaar(() => {
      if (vrij) return;
      vrij = true;
      this.bezet = false;
      this._volgende();
    });
  }
}

/**
 * Eén nummer tegelijk. `werk(id, signal)` doet het echte werk (index.js:
 * zoeken en het grid maken); fouten worden gelogd, nooit gegooid.
 */
export class TellenRij {
  /** `bijLeeg()`: de rij is leeg (de laatste is klaar, of alles is geannuleerd). */
  constructor({ werk, bijLeeg = null }) {
    this.werk = werk;
    this.bijLeeg = bijLeeg;
    this.rij = [];
    this.huidig = null;    // { id, ctrl }
  }

  get open() { return this.huidig !== null || this.rij.length > 0; }
  bevat(id) { return this.huidig?.id === id || this.rij.includes(id); }

  /** In de rij (één keer); `vooraan` = als volgende. */
  voegToe(id, { vooraan = false } = {}) {
    if (this.huidig?.id === id) return;
    const i = this.rij.indexOf(id);
    if (i >= 0) { if (!vooraan) return; this.rij.splice(i, 1); }
    if (vooraan) this.rij.unshift(id); else this.rij.push(id);
    this._loop();
  }

  /** Uit de rij, en loopt hij: stoppen. */
  annuleer(id) {
    this.rij = this.rij.filter((x) => x !== id);
    if (this.huidig?.id === id) this.huidig.ctrl.abort();
  }

  /** Alles stoppen (de server gaat uit). Komt terug als het lopende werk weg is. */
  async stop() {
    this.rij = [];
    if (this.huidig) {
      this.huidig.ctrl.abort();
      await this._bezig;
    }
    this.bijLeeg?.();
  }

  _loop() {
    if (this.huidig) return;
    if (!this.rij.length) { this.bijLeeg?.(); return; }
    const id = this.rij.shift();
    const ctrl = new AbortController();
    this.huidig = { id, ctrl };
    this._bezig = Promise.resolve()
      .then(() => this.werk(id, ctrl.signal))
      .catch((err) => console.error(`[tellen] ${id}:`, err?.message || err))
      .finally(() => {
        this.huidig = null;
        this._loop();
      });
  }
}
