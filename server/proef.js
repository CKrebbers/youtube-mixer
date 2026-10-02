import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * De speellijst van de Controlekamer (docs/CONTROLEKAMER.md): wat Clay bij een
 * proefsessie afvinkt en noteert, op schijf in proef/sessie.json. Eén bestand,
 * zodat Claude het na de sessie gewoon kan lezen.
 *
 * Alleen de STAND staat hier (per punt: status, notitie, tijd). Wat de punten
 * zijn staat in src/controle/speellijst.js; een punt dat daar verdwijnt, blijft
 * hier gewoon staan.
 *
 * Per punt opslaan, niet de hele lijst: twee tabbladen die elk een ander punt
 * afvinken overschrijven elkaar niet. Schrijven gaat na elkaar (één rij) en
 * atomisch (tijdelijk bestand + rename).
 */

export const ID = /^[\w-]{1,40}$/;
export const STATUSSEN = ['open', 'ok', 'fout', 'overslaan'];
const MAX_NOTITIE = 2000;

const leeg = () => ({ begonnen: null, items: {} });

export class Proef {
  constructor(map) {
    this.map = map;
    this._rij = Promise.resolve();
  }

  get pad() { return join(this.map, 'sessie.json'); }

  /** { begonnen, items: { <id>: { status, notitie, tijd } } }; een kapot of ontbrekend bestand = leeg. */
  async lees() {
    try {
      const d = JSON.parse(await readFile(this.pad, 'utf8'));
      return { begonnen: d.begonnen ?? null, items: d.items && typeof d.items === 'object' ? d.items : {} };
    } catch { return leeg(); }
  }

  /**
   * Eén punt zetten. Geeft { code, antwoord }. Status 'open' zonder notitie
   * haalt het punt weg (terug naar niets gedaan).
   */
  zet(id, invoer) {
    const klus = this._rij.then(() => this._zet(id, invoer));
    this._rij = klus.catch(() => {});
    return klus;
  }

  async _zet(id, invoer) {
    if (!ID.test(id)) return { code: 400, antwoord: { fout: 'een punt-id is letters, cijfers, - en _' } };
    const status = invoer?.status ?? 'open';
    if (!STATUSSEN.includes(status)) return { code: 400, antwoord: { fout: `status is ${STATUSSEN.join(', ')}` } };
    const notitie = invoer?.notitie ?? '';
    if (typeof notitie !== 'string') return { code: 400, antwoord: { fout: 'notitie is tekst' } };
    if (notitie.length > MAX_NOTITIE) return { code: 413, antwoord: { fout: `notitie langer dan ${MAX_NOTITIE} tekens` } };
    const d = await this.lees();
    const nu = new Date().toISOString();
    d.begonnen ??= nu;
    const item = { status, notitie: notitie.trim(), tijd: nu };
    if (status === 'open' && !item.notitie) delete d.items[id];
    else d.items[id] = item;
    await this._schrijf(d);
    return { code: 200, antwoord: { id, item: d.items[id] ?? null } };
  }

  /** Een nieuwe ronde: de huidige sessie naar proef/archief/, dan leeg. */
  nieuw() {
    const klus = this._rij.then(async () => {
      const d = await this.lees();
      if (!d.begonnen && !Object.keys(d.items).length) return { gearchiveerd: null };
      const archief = join(this.map, 'archief');
      await mkdir(archief, { recursive: true });
      const naam = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await writeFile(join(archief, naam), JSON.stringify(d, null, 2) + '\n');
      await this._schrijf(leeg());
      return { gearchiveerd: `archief/${naam}` };
    });
    this._rij = klus.catch(() => {});
    return klus;
  }

  async _schrijf(d) {
    await mkdir(this.map, { recursive: true });
    const tmp = join(this.map, `.sessie.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tmp, JSON.stringify(d, null, 2) + '\n');
    await rename(tmp, this.pad);
  }
}
