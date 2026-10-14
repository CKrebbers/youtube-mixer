import { readFile, writeFile, rename, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normaliseerSet, naamGeldig } from '../src/sets/model.js';
import { beperkt, serverOnderweg, ANDERE_LEZERS, LEES_MS, MAX_DRADEN } from './standen.js';

/**
 * Sets op schijf (spoor S9, docs/PLAN-SET.md §6): sets/<naam>.json, één bestand per set, zodat
 * Claude hem ook gewoon kan lezen en schrijven. Zoals de setplannen (server/plannen.js):
 *   - versie = een hash van de inhoud: ook een wijziging buiten de server om telt;
 *   - opslaan met de versie waarop je verder werkte, anders 409 met wat er nu staat;
 *   - elke opslag bewaart de vorige in sets/.versies/<naam>/ (de laatste 50), atomisch.
 * Daarbij: kopiëren (dupliceren) en hernoemen (met versie). De map kan in iCloud staan, dus elke
 * fs-operatie gaat onder de grens van de hele server (`beperkt` uit standen.js, ANDERE_LEZERS):
 * hooguit 2 draden samen, en een bestand dat niet lokaal is geeft 503 in plaats van de audio te
 * laten wachten.
 */

const MAX_BYTES = 1024 * 1024;
const BEWAAR = 50;
const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

export class SetFout extends Error {
  constructor(code, bericht) { super(bericht); this.code = code; }
}

export class Sets {
  constructor({ map, leesMs = LEES_MS, lopend = ANDERE_LEZERS, maxDraden = MAX_DRADEN } = {}) {
    Object.assign(this, { map, leesMs, maxDraden });
    this._lopend = lopend;
    this._slot = new Map();     // naam -> Promise: één schrijver tegelijk per naam
  }

  pad(naam) { return join(this.map, `${naam}.json`); }

  _draad(sleutel, werk) {
    return beperkt({ lopend: this._lopend, sleutel: `set:${sleutel}`, werk, max: this.maxDraden, leesMs: this.leesMs,
      fout: () => new SetFout(503, `set niet lokaal beschikbaar (iCloud?): ${sleutel}; zet VARVE_SETS op een map buiten iCloud`),
      vol: () => new SetFout(503, `te veel bestanden tegelijk niet lokaal beschikbaar (iCloud?): de server leest er hooguit ${this.maxDraden} tegelijk`),
      onderweg: () => (this._lopend === ANDERE_LEZERS ? serverOnderweg() : [...this._lopend.values()]) });
  }

  /** Eén schrijver tegelijk per naam (een PUT en een hernoem die elkaar kruisen). */
  async _alleen(naam, werk) {
    const vorig = this._slot.get(naam) ?? Promise.resolve();
    const nu = vorig.then(werk, werk);
    this._slot.set(naam, nu.catch(() => {}));
    try { return await nu; } finally { if (this._slot.get(naam) === nu) this._slot.delete(naam); }
  }

  async _buf(naam) {
    return this._draad(naam, async () => {
      try { return await readFile(this.pad(naam)); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    });
  }

  /** [{ naam, titel, gewijzigd, nummers, duur, werkruimte, moment }] (nieuwste eerst). */
  async lijst() {
    const namen = await this._draad('.', async () => { try { return await readdir(this.map); } catch { return []; } });
    const uit = [];
    for (const f of namen) {
      const m = /^([a-z0-9_-]{1,60})\.json$/.exec(f);
      if (!m) continue;
      try {
        const [buf, st] = await Promise.all([this._buf(m[1]), this._draad(`${m[1]}:stat`, () => stat(this.pad(m[1])))]);
        if (!buf) continue;
        let s = null;
        try { s = normaliseerSet(JSON.parse(buf.toString('utf8'))).set; } catch { /* kapot: toch in de lijst, met de fout bij het lezen */ }
        uit.push({ naam: m[1], titel: s?.naam ?? m[1], uitleg: s?.uitleg ?? '', gewijzigd: st.mtimeMs, gemaakt: s?.gemaakt ?? null,
          nummers: s?.samenvatting?.nummers ?? 0, duur: s?.samenvatting?.duur ?? null, werkruimte: s?.werkruimte ?? null,
          patronen: !!s?.patronen, moment: !!s?.momentopname, kapot: !s });
      } catch (err) { if (err instanceof SetFout) throw err; }
    }
    return uit.sort((a, b) => b.gewijzigd - a.gewijzigd);
  }

  /** { set, versie, fouten } of null. Een kapot bestand: set null, met de fout. */
  async lees(naam) {
    const buf = await this._buf(naam);
    if (!buf) return null;
    const versie = versieVan(buf);
    try { const { set, fouten } = normaliseerSet(JSON.parse(buf.toString('utf8'))); return { set, versie, fouten }; }
    catch (err) { return { set: null, versie, fouten: [`geen geldige JSON: ${err.message}`] }; }
  }

  /**
   * Opslaan. `versie` = waar de schrijver op verder werkte (null = het bestand mag nog niet bestaan).
   * `samenvatting` = { duur } (de route rekent hem uit met de library). Geeft { code, antwoord }.
   */
  async schrijf(naam, invoer, versie, { samenvatting = null } = {}) {
    if (!naamGeldig(naam)) return { code: 400, antwoord: { fout: 'ongeldige naam' } };
    return this._alleen(naam, async () => {
      const nu = await this.lees(naam);
      if (nu && nu.versie !== versie) return { code: 409, antwoord: { fout: 'de set is intussen gewijzigd', versie: nu.versie, set: nu.set } };
      if (!nu && versie) return { code: 409, antwoord: { fout: 'de set bestaat niet (meer)', versie: null, set: null } };
      const { set, fouten } = normaliseerSet({ ...invoer, samenvatting: { ...(invoer?.samenvatting || {}), ...(samenvatting || {}) } });
      if (!set.gemaakt) set.gemaakt = nu?.set?.gemaakt ?? new Date().toISOString();
      const tekst = JSON.stringify(set, null, 2) + '\n';
      if (Buffer.byteLength(tekst) > MAX_BYTES) return { code: 413, antwoord: { fout: 'set te groot' } };
      await this._draad(`${naam}:schrijf`, async () => {
        await mkdir(this.map, { recursive: true });
        if (nu) await this._bewaarOud(naam);
        const tmp = join(this.map, `.${naam}.${process.pid}.${Date.now()}.tmp`);
        await writeFile(tmp, tekst);
        await rename(tmp, this.pad(naam));
      });
      return { code: 200, antwoord: { set, versie: versieVan(Buffer.from(tekst)), fouten } };
    });
  }

  /** Dupliceren: `naar` mag nog niet bestaan (409). */
  async kopie(naam, naar) {
    if (!naamGeldig(naar)) return { code: 400, antwoord: { fout: 'ongeldige nieuwe naam' } };
    const nu = await this.lees(naam);
    if (!nu?.set) return { code: 404, antwoord: { fout: `geen set "${naam}"` } };
    return this.schrijf(naar, { ...nu.set, gemaakt: new Date().toISOString() }, null);
  }

  /** Hernoemen: met de versie van `naam` (409 als die intussen veranderde), `naar` mag nog niet bestaan. */
  async hernoem(naam, naar, versie) {
    if (!naamGeldig(naar)) return { code: 400, antwoord: { fout: 'ongeldige nieuwe naam' } };
    if (naar === naam) return { code: 400, antwoord: { fout: 'dezelfde naam' } };
    return this._alleen(naam, async () => {
      const nu = await this.lees(naam);
      if (!nu?.set) return { code: 404, antwoord: { fout: `geen set "${naam}"` } };
      if (nu.versie !== versie) return { code: 409, antwoord: { fout: 'de set is intussen gewijzigd', versie: nu.versie, set: nu.set } };
      const r = await this.schrijf(naar, nu.set, null);
      if (r.code !== 200) return r;
      await this._draad(`${naam}:weg`, async () => { await this._bewaarOud(naam); await rm(this.pad(naam), { force: true }); });
      return { code: 200, antwoord: { ...r.antwoord, naam: naar, oud: naam } };
    });
  }

  async _bewaarOud(naam) {
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    let oud;
    try { oud = await readFile(this.pad(naam)); } catch { return; }
    const stempel = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(map, `${stempel}-${versieVan(oud)}.json`), oud);
    const bewaard = (await readdir(map)).filter((f) => f.endsWith('.json')).sort();
    for (const f of bewaard.slice(0, Math.max(0, bewaard.length - BEWAAR))) await rm(join(map, f), { force: true });
  }

  /** De bewaarde versies (nieuwste eerst). */
  async versies(naam) {
    return this._draad(`${naam}:versies`, async () => {
      try { return (await readdir(join(this.map, '.versies', naam))).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
    });
  }
}
