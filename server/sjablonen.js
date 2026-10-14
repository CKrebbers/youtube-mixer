import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { leesRack, schrijfRack } from '../src/engine/rack.js';
import { beperkt, serverOnderweg, ANDERE_LEZERS, LEES_MS, MAX_DRADEN } from './standen.js';

/**
 * Eigen sjablonen (spoor S10, docs/EFFECTEN-MEER.md keuze 8): racks die Clay in de
 * rack-editor "als sjabloon" bewaart. Eén bestand, `racks/eigen.json` (niet in git;
 * VARVE_SJABLONEN om te verleggen), zodat Claude het ook kan lezen en schrijven:
 *
 *   { "versie": 1, "racks": [ { name, uitleg?, chain, macros, mods?, xy? }, … ] }
 *
 * Zoals de plannen en de sets: `versie` = een hash van de inhoud, opslaan met de versie
 * waarop je verder werkte, anders 409 met wat er nu staat. Atomisch (tmp + rename). Elke
 * fs-operatie onder de grens van de hele server (`beperkt`, ANDERE_LEZERS): het bestand
 * kan in iCloud staan.
 */
export const MAX_SJABLONEN = 200;
export const MAX_BYTES = 512 * 1024;
const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const naamGeldig = (n) => typeof n === 'string' && n.trim().length >= 1 && n.length <= 60 && !/[\u0000-\u001f]/.test(n);

export class SjabloonFout extends Error {
  constructor(code, bericht, extra = {}) { super(bericht); this.code = code; this.extra = extra; }
}

export class Sjablonen {
  /** @param o.pad  het bestand; o.ingebouwd: () => namen van de kant-en-klare (racks/sjablonen.json) */
  constructor({ pad, ingebouwd = async () => [], leesMs = LEES_MS, lopend = ANDERE_LEZERS, maxDraden = MAX_DRADEN } = {}) {
    Object.assign(this, { pad, ingebouwd, leesMs, maxDraden });
    this._lopend = lopend;
    this._slot = Promise.resolve();
  }

  _draad(sleutel, werk) {
    return beperkt({ lopend: this._lopend, sleutel: `sjablonen:${sleutel}`, werk, max: this.maxDraden, leesMs: this.leesMs,
      fout: () => new SjabloonFout(503, 'eigen sjablonen niet lokaal beschikbaar (iCloud?); zet VARVE_SJABLONEN op een map buiten iCloud'),
      vol: () => new SjabloonFout(503, `te veel bestanden tegelijk niet lokaal beschikbaar (iCloud?): de server leest er hooguit ${this.maxDraden} tegelijk`),
      onderweg: () => (this._lopend === ANDERE_LEZERS ? serverOnderweg() : [...this._lopend.values()]) });
  }

  /** { racks, versie } — zonder bestand: leeg, versie null. */
  async lees() {
    const buf = await this._draad('lees', async () => {
      try { return await readFile(this.pad); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    });
    if (!buf) return { racks: [], versie: null };
    let doc;
    try { doc = JSON.parse(buf.toString('utf8')); } catch { throw new SjabloonFout(500, `${this.pad} is geen geldige JSON (met de hand bewerkt?)`); }
    return { racks: Array.isArray(doc?.racks) ? doc.racks : [], versie: versieVan(buf) };
  }

  /** Eén schrijver tegelijk. */
  async _alleen(werk) {
    const nu = this._slot.then(werk, werk);
    this._slot = nu.catch(() => {});
    return nu;
  }

  async _schrijf(racks) {
    const tekst = `${JSON.stringify({ versie: 1, racks }, null, 2)}\n`;
    if (Buffer.byteLength(tekst) > MAX_BYTES) throw new SjabloonFout(413, `te groot: meer dan ${MAX_BYTES / 1024} kB aan eigen sjablonen`);
    await this._draad('schrijf', async () => {
      await mkdir(dirname(this.pad), { recursive: true });
      const tmp = `${this.pad}.tmp-${process.pid}`;
      await writeFile(tmp, tekst);
      await rename(tmp, this.pad);
    });
    return { racks, versie: versieVan(Buffer.from(tekst)) };
  }

  /**
   * Een sjabloon bewaren (nieuw, of over een eigen sjabloon met dezelfde naam heen).
   * Een naam van een kant-en-klaar sjabloon mag niet: die zou in de kiezer dubbel staan.
   */
  async bewaar(rack, versie) {
    return this._alleen(async () => {
      const { rack: r, fouten } = leesRack(rack, { bekendType: () => true });
      const naam = String(r.name || '').trim();
      if (!naamGeldig(naam)) throw new SjabloonFout(400, 'een sjabloon heeft een naam nodig (1–60 tekens)');
      const ernstig = fouten.filter((f) => !/ken ik niet/.test(f));
      if (ernstig.length) throw new SjabloonFout(400, `rack klopt niet: ${ernstig.join('; ')}`);
      if ((await this.ingebouwd()).includes(naam)) throw new SjabloonFout(409, `"${naam}" is al een kant-en-klaar sjabloon: kies een andere naam`);
      const nu = await this.lees();
      if ((nu.versie ?? null) !== (versie ?? null)) throw new SjabloonFout(409, 'de eigen sjablonen zijn intussen veranderd', { racks: nu.racks, versie: nu.versie });
      const schoon = { ...schrijfRack(r), name: naam };
      delete schoon.from;
      const lijst = nu.racks.filter((x) => x?.name !== naam);
      if (lijst.length >= MAX_SJABLONEN) throw new SjabloonFout(413, `hooguit ${MAX_SJABLONEN} eigen sjablonen`);
      const i = nu.racks.findIndex((x) => x?.name === naam);
      if (i >= 0) lijst.splice(i, 0, schoon); else lijst.push(schoon);
      return this._schrijf(lijst);
    });
  }

  async wis(naam, versie) {
    return this._alleen(async () => {
      const nu = await this.lees();
      if ((nu.versie ?? null) !== (versie ?? null)) throw new SjabloonFout(409, 'de eigen sjablonen zijn intussen veranderd', { racks: nu.racks, versie: nu.versie });
      if (!nu.racks.some((x) => x?.name === naam)) throw new SjabloonFout(404, `geen eigen sjabloon "${naam}"`);
      return this._schrijf(nu.racks.filter((x) => x?.name !== naam));
    });
  }
}
