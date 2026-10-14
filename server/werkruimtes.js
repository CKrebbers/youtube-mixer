import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normaliseerWerkruimte, naamGeldig, NAAM_UITLEG, MAX_BYTES } from '../src/werk/model.js';

/**
 * Werkruimtes op schijf (werkruimte S3, docs/WERKRUIMTE.md B2, docs/werkruimte/S3.md):
 * werkruimtes/<naam>.json (Clay's eigen, niet in git; VARVE_WERKRUIMTES voor tests) en de
 * voorbeelden in tools/werkruimtes/voorbeelden/ (git). Een eigen bestand gaat vóór een
 * voorbeeld met dezelfde naam. Zoals de plannen, patronen en standen:
 *
 * - Versie = een hash van de BYTES van het bestand: ook wat Claude direct schrijft is een
 *   nieuwe versie. Opslaan alleen met de versie waarop je verder werkte; klopt die niet (of
 *   stuur je er geen terwijl het bestand er is), dan 409 met wat er NU staat. Niemand
 *   overschrijft stil een ander.
 * - Wat opgeslagen wordt gaat eerst door normaliseerWerkruimte (src/werk/model.js, dezelfde
 *   regels als de mixer): een fout = 400 met de reden, en er wordt niets geschreven.
 * - Atomisch (tijdelijk bestand + rename), en de vorige eigen inhoud gaat naar
 *   .versies/<naam>/ (niet via HTTP te lezen, wel de lijst: GET …/versies).
 * - Bewaard wordt het bestand zoals het binnenkwam (ingesprongen), niet de genormaliseerde
 *   vorm: wat Claude of Clay erin zette (een `_uitleg`, de volgorde) blijft staan.
 *
 * iCloud (zoals server/standen.js): de mixer peilt elke 3 s, en een bestand dat iCloud
 * "dataless" maakte houdt een draad van de threadpool vast (dezelfde die de audio leest).
 * Daarom: ongewijzigd volgens `stat` = uit het geheugen; één lees per pad tegelijk; over alles
 * samen hooguit MAX_DRADEN (2) operaties onderweg; de mappings en stukken (git, veranderen
 * zelden) hooguit eens per CONTEXT_MS opnieuw. Een peilbeurt is zo één of twee keer `stat`.
 */

export const NAAM = /^[a-z0-9_-]{1,60}$/;
export { NAAM_UITLEG };

export const MAX_DRADEN = 2;
export const CONTEXT_MS = 5000;

const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const stempel = (d) => d.toISOString().replace(/[:.]/g, '-');

export class Werkruimtes {
  /**
   * @param map          de eigen werkruimtes (VARVE_WERKRUIMTES of <wortel>/werkruimtes)
   * @param voorbeelden  tools/werkruimtes/voorbeelden
   * @param stukken      mappings/stukken (welke stukken er zijn, voor de waarschuwingen)
   * @param mappings     mappings/ (de standaarden: vrije plekken)
   */
  constructor({ map, voorbeelden, stukken, mappings, klok = () => new Date() }) {
    Object.assign(this, { map, voorbeelden, stukkenMap: stukken, mappingsMap: mappings, klok });
    this._slot = new Map();   // naam -> Promise: één schrijver tegelijk per naam
    this._cache = new Map();  // pad -> { sleutel, buf, gewijzigd }
    this._lopend = new Map(); // pad -> Promise (één lees per pad)
    this._bezig = 0;
    this._wacht = [];
    this._ctx = null;         // { t, waarde }
  }

  /** Hooguit MAX_DRADEN fs-operaties tegelijk (de rest wacht netjes op zijn beurt). */
  async _draad(werk) {
    if (this._bezig >= MAX_DRADEN) await new Promise((z) => this._wacht.push(z));
    this._bezig++;
    try { return await werk(); } finally { this._bezig--; this._wacht.shift()?.(); }
  }

  /** Eén bestand: { buf, gewijzigd } of null. Ongewijzigd volgens stat = uit het geheugen. */
  _leesBestand(pad) {
    const l = this._lopend.get(pad);
    if (l) return l;
    const weg = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
    const p = this._draad(async () => {
      let st;
      try { st = await stat(pad); } catch (err) { if (weg(err)) { this._cache.delete(pad); return null; } throw err; }
      const sleutel = `${st.ino}:${st.size}:${st.mtimeMs}`;
      const c = this._cache.get(pad);
      if (c?.sleutel === sleutel) return c;
      let buf;
      try { buf = await readFile(pad); } catch (err) { if (weg(err)) { this._cache.delete(pad); return null; } throw err; }
      const uit = { sleutel, buf, gewijzigd: st.mtimeMs };
      this._cache.set(pad, uit);
      return uit;
    }).finally(() => this._lopend.delete(pad));
    this._lopend.set(pad, p);
    return p;
  }

  pad(naam) { return join(this.map, `${naam}.json`); }
  voorbeeldPad(naam) { return join(this.voorbeelden, `${naam}.json`); }

  async _namen(map) {
    let f = [];
    try { f = await this._draad(() => readdir(map)); } catch { return []; }
    return f.map((x) => /^([a-z0-9_-]{1,60})\.json$/.exec(x)?.[1]).filter((n) => n && naamGeldig(n));
  }

  /** Wat het model van buiten moet weten: de standaardmappings en de stukken die er zijn. */
  async _context() {
    if (this._ctx && Date.now() - this._ctx.t < CONTEXT_MS) return this._ctx.waarde;
    const json = async (p) => { try { const b = await this._leesBestand(p); return b ? JSON.parse(b.buf.toString('utf8')) : null; } catch { return null; } };
    const standaarden = {};
    for (const app of ['apc40mk2', 'maschine-mk2']) { const d = await json(join(this.mappingsMap, `${app}.json`)); if (d) standaarden[app] = d; }
    const stukken = {};
    for (const n of await this._namen(this.stukkenMap)) { const d = await json(join(this.stukkenMap, `${n}.json`)); if (d) stukken[n] = d; }
    const waarde = { standaarden, stukken };
    this._ctx = { t: Date.now(), waarde };
    return waarde;
  }

  /**
   * { naam, ruw, werkruimte, versie, bron: 'eigen'|'voorbeeld', fouten, waarschuwingen, gewijzigd } of null.
   * Een kapot eigen bestand: ruw en werkruimte null, met de fout (het voorbeeld eronder telt dan niet).
   */
  async lees(naam, ctx = null) {
    if (!naamGeldig(naam)) return null;
    for (const [bron, p] of [['eigen', this.pad(naam)], ['voorbeeld', this.voorbeeldPad(naam)]]) {
      const b = await this._leesBestand(p);
      if (!b) continue;
      const buf = b.buf;
      const versie = versieVan(buf);
      const basis = { naam, versie, bron, gewijzigd: b.gewijzigd };
      let ruw;
      try { ruw = JSON.parse(buf.toString('utf8')); } catch (err) {
        return { ...basis, ruw: null, werkruimte: null, fouten: [`geen geldige JSON: ${err.message}`], waarschuwingen: [] };
      }
      const c = ctx ?? await this._context();
      const { werkruimte, fouten, waarschuwingen } = normaliseerWerkruimte(ruw, c);
      if (werkruimte && werkruimte.naam !== naam) fouten.push(`de naam in het bestand ("${werkruimte.naam}") is niet de bestandsnaam ("${naam}")`);
      return { ...basis, ruw, werkruimte, fouten, waarschuwingen };
    }
    return null;
  }

  /** [{ naam, titel, bron, versie, delen, fouten, gewijzigd }], op naam. */
  async lijst() {
    const namen = [...new Set([...(await this._namen(this.map)), ...(await this._namen(this.voorbeelden))])].sort();
    const ctx = await this._context();
    const uit = [];
    for (const n of namen) {
      const w = await this.lees(n, ctx);
      if (!w) continue;
      uit.push({ naam: n, titel: w.werkruimte?.titel ?? n, bron: w.bron, versie: w.versie, delen: Object.keys(w.werkruimte?.delen ?? {}).length,
        fouten: w.fouten.length, gewijzigd: w.gewijzigd });
    }
    return uit;
  }

  /**
   * Opslaan. `versie` = waar de schrijver op verder werkte (null = er mag nog niets met die naam
   * zijn; een voorbeeld telt als "er is iets": wie het voorbeeld aanpast, stuurt diens versie mee
   * en krijgt een eigen bestand). Geeft { code, antwoord }.
   */
  schrijf(naam, ruw, versie) {
    const vorige = this._slot.get(naam) ?? Promise.resolve();
    const dit = vorige.catch(() => {}).then(() => this._schrijf(naam, ruw, versie));
    this._slot.set(naam, dit);
    dit.finally(() => { if (this._slot.get(naam) === dit) this._slot.delete(naam); }).catch(() => {});
    return dit;
  }

  async _schrijf(naam, ruw, versie) {
    if (!naamGeldig(naam)) return { code: 400, antwoord: { fout: NAAM_UITLEG } };
    if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return { code: 400, antwoord: { fout: 'stuur { werkruimte, versie }' } };
    const ctx = await this._context();
    const nu = await this.lees(naam, ctx);
    if (nu && nu.versie !== versie) {
      return { code: 409, antwoord: { fout: `werkruimte ${naam} is intussen gewijzigd (of je stuurde geen versie): niets overschreven`,
        versie: nu.versie, bron: nu.bron, ruw: nu.ruw, werkruimte: nu.werkruimte } };
    }
    if (!nu && versie) return { code: 409, antwoord: { fout: `werkruimte ${naam} bestaat niet (meer)`, versie: null, ruw: null, werkruimte: null } };
    if (ruw.naam === undefined) ruw = { ...ruw, naam };
    if (ruw.naam !== naam) return { code: 400, antwoord: { fout: `de naam in de werkruimte ("${ruw.naam}") is niet die in het adres ("${naam}")` } };
    const { werkruimte, fouten, waarschuwingen } = normaliseerWerkruimte(ruw, ctx);
    if (!werkruimte || fouten.length) return { code: 400, antwoord: { fout: fouten[0] ?? 'de werkruimte klopt niet', fouten, waarschuwingen } };
    const tekst = JSON.stringify(ruw, null, 2) + '\n';
    if (Buffer.byteLength(tekst) > MAX_BYTES) return { code: 413, antwoord: { fout: `te groot (meer dan ${MAX_BYTES / 1024} KiB)` } };
    await mkdir(this.map, { recursive: true });
    if (nu?.bron === 'eigen') await this._bewaarOud(naam);
    const tmp = join(this.map, `.${naam}.${process.pid}.${Date.now()}.tmp`);
    await this._draad(async () => { await writeFile(tmp, tekst); await rename(tmp, this.pad(naam)); });
    this._cache.delete(this.pad(naam));
    return { code: 200, antwoord: { naam, versie: versieVan(Buffer.from(tekst)), bron: 'eigen', werkruimte, waarschuwingen } };
  }

  /** De vorige eigen inhoud naar .versies/<naam>/<tijd>-<versie>.json; nooit iets weggooien. */
  async _bewaarOud(naam) {
    const oud = (await this._leesBestand(this.pad(naam)))?.buf;
    if (!oud) return;
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    try { await this._draad(() => writeFile(join(map, `${stempel(this.klok())}-${versieVan(oud)}.json`), oud, { flag: 'wx' })); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  /** De bewaarde versies (nieuwste eerst), voor "terug naar de vorige inrichting" (S8). */
  async versies(naam) {
    try { return (await this._draad(() => readdir(join(this.map, '.versies', naam)))).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
  }
}
