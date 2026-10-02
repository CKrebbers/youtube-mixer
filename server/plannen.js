import { readFile, writeFile, rename, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normaliseerPlan } from '../src/plan/plan-model.js';

/**
 * Setplannen op schijf: plannen/<naam>.json. Eén bestand per plan, zodat Claude
 * het ook gewoon kan lezen en schrijven; de server voegt versiecontrole toe.
 *
 * Versie = een hash van de inhoud (niet een teller in het bestand): ook een
 * wijziging die buiten de server om ging (Claude schrijft het bestand) geeft
 * een nieuwe versie. Wie opslaat geeft de versie mee waarop hij verder werkte;
 * klopt die niet meer, dan 409 met wat er nu staat. Niemand overschrijft
 * stilletjes een ander.
 *
 * Elke opslag bewaart de vorige inhoud in plannen/.versies/<naam>/ (buiten de
 * witte lijst: alleen via de API). Schrijven is atomisch (tijdelijk bestand +
 * rename): een crash halverwege laat nooit een half plan achter.
 *
 * De validatie is dezelfde als in de browser: src/plan/plan-model.js (puur).
 * Het is de enige plek waar de server iets uit src/ importeert; bewust, zodat
 * pagina, automaat en server nooit van mening verschillen over wat een plan is.
 */

export const NAAM = /^[\w-]{1,60}$/;
const MAX_BYTES = 512 * 1024;
const BEWAAR = 50;

const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

export class Plannen {
  constructor(map) { this.map = map; }

  pad(naam) { return join(this.map, `${naam}.json`); }

  /** [{ naam, gewijzigd }] */
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

  /** { plan, versie, fouten } of null als hij er niet is. Een kapot bestand: plan null, met de fout. */
  async lees(naam) {
    let buf;
    try { buf = await readFile(this.pad(naam)); } catch { return null; }
    const versie = versieVan(buf);
    let ruw;
    try { ruw = JSON.parse(buf.toString('utf8')); } catch (err) { return { plan: null, versie, fouten: [`geen geldige JSON: ${err.message}`] }; }
    const { plan, fouten } = normaliseerPlan(ruw);
    return { plan, versie, fouten };
  }

  /**
   * Opslaan. `versie` = waar de schrijver op verder werkte (null = het bestand
   * mag nog niet bestaan). Geeft { code, antwoord }.
   */
  async schrijf(naam, invoer, versie) {
    const nu = await this.lees(naam);
    if (nu && nu.versie !== versie) return { code: 409, antwoord: { fout: 'het plan is intussen gewijzigd', versie: nu.versie, plan: nu.plan } };
    if (!nu && versie) return { code: 409, antwoord: { fout: 'het plan bestaat niet (meer)', versie: null, plan: null } };
    const { plan, fouten } = normaliseerPlan(invoer);
    if (!plan.stappen.length && Array.isArray(invoer?.stappen) && invoer.stappen.length) {
      return { code: 400, antwoord: { fout: 'geen enkele bruikbare stap', fouten } };
    }
    const tekst = JSON.stringify(plan, null, 2) + '\n';
    if (Buffer.byteLength(tekst) > MAX_BYTES) return { code: 413, antwoord: { fout: 'plan te groot' } };
    await mkdir(this.map, { recursive: true });
    if (nu) await this._bewaarOud(naam);
    const tmp = join(this.map, `.${naam}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tmp, tekst);
    await rename(tmp, this.pad(naam));
    return { code: 200, antwoord: { plan, versie: versieVan(Buffer.from(tekst)), fouten } };
  }

  async _bewaarOud(naam) {
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    const stempel = new Date().toISOString().replace(/[:.]/g, '-');
    let oud;
    try { oud = await readFile(this.pad(naam)); } catch { return; }
    // Tijd plus de versie van wat er stond: twee opslagen in dezelfde ms overschrijven elkaar niet.
    await writeFile(join(map, `${stempel}-${versieVan(oud)}.json`), oud);
    // Niet eindeloos: de laatste BEWAAR.
    const bewaard = (await readdir(map)).filter((f) => f.endsWith('.json')).sort();
    for (const f of bewaard.slice(0, Math.max(0, bewaard.length - BEWAAR))) await rm(join(map, f), { force: true });
  }

  /** De bewaarde versies (nieuwste eerst), of een ervan. */
  async versies(naam) {
    try { return (await readdir(join(this.map, '.versies', naam))).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
  }
}
