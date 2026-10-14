import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normaliseerWerkruimte, naamGeldig, NAAM_UITLEG, MAX_BYTES } from '../src/werk/model.js';
import { beperkt, serverOnderweg, ANDERE_LEZERS, LEES_MS, MAX_DRADEN } from './standen.js';

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
 * iCloud (zoals server/standen.js): de mixer peilt elke 2,5 s, en een bestand dat iCloud
 * "dataless" maakte houdt een draad van de threadpool vast (dezelfde die de audio leest).
 * Daarom: ongewijzigd volgens `stat` = uit het geheugen; één lees per pad tegelijk; en de grens
 * van de HELE server (review ronde 2): `beperkt` uit server/standen.js, met de lopende
 * operaties van de standen erbij geteld, dus samen met de standen hooguit MAX_DRADEN (2)
 * onderweg. Loopt een lees langer dan LEES_MS, of hangt alles al, dan 503 (WerkFout), en er
 * start geen nieuwe draad. De mappings en stukken (git, veranderen zelden) hooguit eens per
 * CONTEXT_MS opnieuw. Een peilbeurt is zo één of twee keer `stat`.
 */

export const NAAM = /^[a-z0-9_-]{1,60}$/;
export { NAAM_UITLEG, MAX_DRADEN };

export const CONTEXT_MS = 5000;

/** Een fout met een HTTP-code (503: niet lokaal beschikbaar, iCloud?). */
export class WerkFout extends Error {
  constructor(code, fout) { super(fout); this.code = code; }
}

const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const stempel = (d) => d.toISOString().replace(/[:.]/g, '-');

export class Werkruimtes {
  /**
   * @param map          de eigen werkruimtes (VARVE_WERKRUIMTES of <wortel>/werkruimtes)
   * @param voorbeelden  tools/werkruimtes/voorbeelden
   * @param stukken      mappings/stukken (welke stukken er zijn, voor de waarschuwingen)
   * @param mappings     mappings/ (de standaarden: vrije plekken)
   */
  /**
   * @param leesMs  hoe lang een lees mag duren voor 503 (tests: korter)
   * @param lopend  de lopende operaties (standaard ANDERE_LEZERS: telt mee in de grens van de standen)
   * @param leesBestand  readFile (tests: een die hangt)
   */
  constructor({ map, voorbeelden, stukken, mappings, klok = () => new Date(), leesMs = LEES_MS, lopend = ANDERE_LEZERS,
    leesBestand = readFile, maxDraden = MAX_DRADEN }) {
    Object.assign(this, { map, voorbeelden, stukkenMap: stukken, mappingsMap: mappings, klok, leesMs, leesBestand, maxDraden });
    this._slot = new Map();   // naam -> Promise: één schrijver tegelijk per naam
    this._cache = new Map();  // pad -> { sleutel, buf, gewijzigd }
    this._lopend = lopend;    // sleutel -> { belofte, sinds } (één lees per pad; gedeeld met de grens van de server)
    this._ctx = null;         // { t, waarde }
  }

  /** Eén fs-operatie onder de grens van de hele server (server/standen.js `beperkt`). */
  _draad(sleutel, werk) {
    const tekst = `werkruimte niet lokaal beschikbaar (iCloud?): ${sleutel}; zet VARVE_WERKRUIMTES op een map buiten iCloud`;
    return beperkt({ lopend: this._lopend, sleutel: `werk:${sleutel}`, werk, max: this.maxDraden, leesMs: this.leesMs,
      fout: () => new WerkFout(503, tekst),
      vol: () => new WerkFout(503, `te veel bestanden tegelijk niet lokaal beschikbaar (iCloud?): de server leest er hooguit ${this.maxDraden} tegelijk, zodat de audio blijft lezen`),
      onderweg: () => (this._lopend === ANDERE_LEZERS ? serverOnderweg() : [...this._lopend.values()]) });
  }

  /** Eén bestand: { buf, gewijzigd } of null. Ongewijzigd volgens stat = uit het geheugen. */
  _leesBestand(pad) {
    const weg = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
    return this._draad(pad, async () => {
      let st;
      try { st = await stat(pad); } catch (err) { if (weg(err)) { this._cache.delete(pad); return null; } throw err; }
      const sleutel = `${st.ino}:${st.size}:${st.mtimeMs}`;
      const c = this._cache.get(pad);
      if (c?.sleutel === sleutel) return c;
      let buf;
      try { buf = await this.leesBestand(pad); } catch (err) { if (weg(err)) { this._cache.delete(pad); return null; } throw err; }
      const uit = { sleutel, buf, gewijzigd: st.mtimeMs };
      this._cache.set(pad, uit);
      return uit;
    });
  }

  pad(naam) { return join(this.map, `${naam}.json`); }
  voorbeeldPad(naam) { return join(this.voorbeelden, `${naam}.json`); }

  async _namen(map) {
    let f = [];
    try { f = await this._draad(`${map}/`, () => readdir(map)); } catch (err) { if (err instanceof WerkFout) throw err; return []; }
    return f.map((x) => /^([a-z0-9_-]{1,60})\.json$/.exec(x)?.[1]).filter((n) => n && naamGeldig(n));
  }

  /** Wat het model van buiten moet weten: de standaardmappings en de stukken die er zijn. */
  async _context() {
    if (this._ctx && Date.now() - this._ctx.t < CONTEXT_MS) return this._ctx.waarde;
    // Niet te lezen (iCloud, kapot) = er niet: hooguit een waarschuwing meer ("onbekend stuk"), en
    // dan niet onthouden, zodat het de volgende keer opnieuw geprobeerd wordt.
    let heel = true;
    const json = async (p) => { try { const b = await this._leesBestand(p); return b ? JSON.parse(b.buf.toString('utf8')) : null; } catch { heel = false; return null; } };
    const standaarden = {};
    for (const app of ['apc40mk2', 'maschine-mk2']) { const d = await json(join(this.mappingsMap, `${app}.json`)); if (d) standaarden[app] = d; }
    const stukken = {};
    let namen = [];
    try { namen = await this._namen(this.stukkenMap); } catch { heel = false; }
    for (const n of namen) { const d = await json(join(this.stukkenMap, `${n}.json`)); if (d) stukken[n] = d; }
    const waarde = { standaarden, stukken };
    if (heel) this._ctx = { t: Date.now(), waarde };
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
      let w;
      try { w = await this.lees(n, ctx); } catch (err) {
        if (!(err instanceof WerkFout)) throw err;
        uit.push({ naam: n, titel: n, bron: null, versie: null, delen: 0, fouten: 1, fout: err.message, gewijzigd: null });
        continue;
      }
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
    await writeFile(tmp, tekst);
    await rename(tmp, this.pad(naam));
    this._cache.delete(this.pad(naam));
    return { code: 200, antwoord: { naam, versie: versieVan(Buffer.from(tekst)), bron: 'eigen', werkruimte, waarschuwingen } };
  }

  /** De vorige eigen inhoud naar .versies/<naam>/<tijd>-<versie>.json; nooit iets weggooien. */
  async _bewaarOud(naam) {
    const oud = (await this._leesBestand(this.pad(naam)))?.buf;
    if (!oud) return;
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    try { await writeFile(join(map, `${stempel(this.klok())}-${versieVan(oud)}.json`), oud, { flag: 'wx' }); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  /** De bewaarde versies (nieuwste eerst), voor "terug naar de vorige inrichting" (S8). */
  async versies(naam) {
    const map = join(this.map, '.versies', naam);
    try { return (await this._draad(`${map}/`, () => readdir(map))).filter((f) => f.endsWith('.json')).sort().reverse(); } catch (err) {
      if (err instanceof WerkFout) throw err;
      return [];
    }
  }
}
