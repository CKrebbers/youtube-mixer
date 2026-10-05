import { readFile, writeFile, rename, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normaliseerSet } from '../src/engine/patronen/model.js';

/**
 * Patronen op schijf (docs/PATRONEN.md): patronen/<naam>.json, één bestand per
 * SET (patronen horen bij de set, niet bij een nummer). Precies zoals de
 * setplannen (plannen.js): een gewoon JSON-bestand dat Claude ook kan lezen en
 * schrijven, met versiecontrole erbij.
 *
 * Versie = een hash van de inhoud: ook een wijziging buiten de server om
 * (Claude schrijft het bestand) is een nieuwe versie. Wie opslaat geeft de
 * versie mee waarop hij verder werkte; klopt die niet meer, dan 409 met wat er
 * nu staat. Niemand overschrijft stilletjes een ander. Elke opslag bewaart de
 * vorige in patronen/.versies/<naam>/ (de laatste 50; niet via HTTP te lezen).
 * Schrijven is atomisch (tijdelijk bestand + rename).
 *
 * De controle is dezelfde als in de browser: src/engine/patronen/model.js (puur).
 */

export const NAAM = /^[\w-]{1,60}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const BEWAAR = 50;

const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

export class Patronen {
  constructor(map) { this.map = map; }

  pad(naam) { return join(this.map, `${naam}.json`); }

  /** [{ naam, gewijzigd }], nieuwste eerst. */
  async lijst() {
    let namen = [];
    try { namen = await readdir(this.map); } catch { return []; }
    const uit = [];
    for (const f of namen) {
      const m = /^([\w-]{1,60})\.json$/.exec(f);
      if (!m) continue;
      try { uit.push({ naam: m[1], gewijzigd: (await stat(join(this.map, f))).mtimeMs }); } catch {}
    }
    return uit.sort((a, b) => b.gewijzigd - a.gewijzigd);
  }

  /** { set, versie, fouten } of null als hij er niet is. Een kapot bestand: set null, met de fout. */
  async lees(naam) {
    let buf;
    try { buf = await readFile(this.pad(naam)); } catch { return null; }
    const versie = versieVan(buf);
    let ruw;
    try { ruw = JSON.parse(buf.toString('utf8')); } catch (err) { return { set: null, versie, fouten: [`geen geldige JSON: ${err.message}`] }; }
    const { set, fouten } = normaliseerSet(ruw);
    return { set, versie, fouten };
  }

  /**
   * Opslaan. `versie` = waar de schrijver op verder werkte (null = het bestand
   * mag nog niet bestaan). Geeft { code, antwoord }.
   */
  async schrijf(naam, invoer, versie) {
    const nu = await this.lees(naam);
    if (nu && nu.versie !== versie) return { code: 409, antwoord: { fout: 'de patronen zijn intussen gewijzigd', versie: nu.versie, set: nu.set } };
    if (!nu && versie) return { code: 409, antwoord: { fout: 'deze set bestaat niet (meer)', versie: null, set: null } };
    if (!invoer || typeof invoer !== 'object') return { code: 400, antwoord: { fout: 'geen set' } };
    const { set, fouten } = normaliseerSet(invoer);
    const tekst = JSON.stringify(set, null, 2) + '\n';
    if (Buffer.byteLength(tekst) > MAX_BYTES) return { code: 413, antwoord: { fout: 'set te groot' } };
    await mkdir(this.map, { recursive: true });
    if (nu) await this._bewaarOud(naam);
    const tmp = join(this.map, `.${naam}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tmp, tekst);
    await rename(tmp, this.pad(naam));
    return { code: 200, antwoord: { set, versie: versieVan(Buffer.from(tekst)), fouten } };
  }

  async _bewaarOud(naam) {
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    const stempel = new Date().toISOString().replace(/[:.]/g, '-');
    let oud;
    try { oud = await readFile(this.pad(naam)); } catch { return; }
    await writeFile(join(map, `${stempel}-${versieVan(oud)}.json`), oud);
    const bewaard = (await readdir(map)).filter((f) => f.endsWith('.json')).sort();
    for (const f of bewaard.slice(0, Math.max(0, bewaard.length - BEWAAR))) await rm(join(map, f), { force: true });
  }

  /** De bewaarde versies van een set (nieuwste eerst). */
  async versies(naam) {
    try { return (await readdir(join(this.map, '.versies', naam))).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
  }
}
