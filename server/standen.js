import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { maakVerschil, isVerschil } from '../src/control/mapping.js';
import { normaliseerStand, naamGeldig, DELEN, LABEL, MAX_BYTES, STANDAARD_APPARAAT } from '../src/standen/stand-model.js';
import { nachtDatum } from './nacht.js';

/**
 * STANDEN op schijf (docs/STANDEN.md): één JSON-bestand per situatie, en
 * activeren als één gebeurtenis. In de Controlekamer heet het "Opstelling".
 *
 * Waar het staat (alles buiten git, `.gitignore`: /standen/):
 *   <map>/<naam>.json                     Clay's eigen standen (VARVE_STANDEN, anders <repo>/standen)
 *   <voorbeelden>/<naam>.json             de vertrekpunten in git (tools/standen/voorbeelden/);
 *                                         een eigen bestand met dezelfde naam gaat voor
 *   <map>/.versies/<naam>/<tijd>-<v>.json de vorige inhoud bij elke opslag; nooit weggegooid
 *   <map>/.vorige/<nr>-<tijd>.json        wat een activering verving (mapping + de rem van de nacht)
 *   <map>/.actief.json                    welke stand actief is, sinds wanneer, en het verslag
 *
 * Versie = hash van de inhoud (zoals de setplannen, server/plannen.js): wie
 * opslaat geeft de versie mee van het bestand waarop hij verder werkte (het
 * EFFECTIEVE bestand: eigen, anders het voorbeeld). Klopt die niet meer: 409
 * met wat er nu staat. Niemand overschrijft stilletjes een ander.
 *
 * Activeren zet wat de server zelf bezit (de mapping, de rem van de nacht),
 * controleert wat hij kan zien (krat, profiel, hub-set, sjabloon) en legt vast
 * wat de mixer later overneemt (het master-rack). Startpunt, geen slot: wat je
 * daarna met de hand doet blijft staan. Een stand start nooit geluid, een
 * opname of een download, en de mixer herlaadt nooit vanzelf.
 *
 * Alles van buiten komt binnen als functie (lib, nacht, kaart, sjablonen,
 * standaardMapping, profielen, hubSets, speeltDeck, klok), zodat
 * test/standen.test.mjs het zonder server en zonder Clay's bestanden draait.
 */

export const LEES_MS = 2000;
const versieVan = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const stempelVan = (d) => d.toISOString().replace(/[:.]/g, '-');

/** Fout met een HTTP-code; de route geeft hem één op één door als { fout, ...extra }. */
export class StandFout extends Error {
  constructor(code, fout, extra = {}) { super(fout); this.code = code; this.extra = extra; }
  antwoord() { return { fout: this.message, ...this.extra }; }
}

/** Een mapping in gewone taal, voor de tegel en het verschil. */
export function beschrijfMapping(doc) {
  if (doc === null || doc === undefined || doc === 'standaard') return 'standaard';
  if (isVerschil(doc)) {
    const n = (doc.rules?.length ?? 0) + (doc.removed?.length ?? 0) + Object.keys(doc.top ?? {}).length;
    return n ? `eigen (${n} regel${n === 1 ? '' : 's'})` : 'standaard';
  }
  return `eigen, volledig (${doc.rules?.length ?? 0} regels)`;
}

/** De nacht in gewone taal: "aan", "uit", "aan · vannacht niet". */
function beschrijfNacht({ aan, vandaagNiet }) {
  return `${aan ? 'aan' : 'uit'}${vandaagNiet ? ' · vannacht niet' : ''}`;
}

async function binnenTijd(belofte, ms, fout) {
  let t;
  const tijd = new Promise((_, nee) => { t = setTimeout(() => nee(fout), ms); t.unref?.(); });
  try { return await Promise.race([belofte, tijd]); } finally { clearTimeout(t); }
}

export class Standen {
  /**
   * @param o.map              map met Clay's eigen standen
   * @param o.voorbeelden      map met de voorbeelden (in git)
   * @param o.lib              { haal(sleutel, standaard), zet(sleutel, waarde) } — de Library
   * @param o.nacht            de Nacht (zet, stand, stop, instellingen, vandaagNiet)
   * @param o.kaart            de Kaart (laad, kratten)
   * @param o.sjablonen        async () => [rack] uit racks/sjablonen.json
   * @param o.standaardMapping async () => mappings/apc40mk2.json (pas gelezen als het nodig is)
   * @param o.profielen        async () => { <profiel>: {...} } of null als avondpakket/profielen.json ontbreekt
   * @param o.hubSets          async () => [naam] of null als de hub er niet is
   * @param o.speeltDeck       () => boolean
   * @param o.valideerNacht    (deel) => void, gooit bij een fout (pasToe van server/nacht.js)
   * @param o.klok             () => Date
   */
  constructor({ map, voorbeelden, lib, nacht, kaart, sjablonen = async () => [], standaardMapping = async () => null,
    profielen = async () => null, hubSets = async () => null, speeltDeck = () => false, valideerNacht = null,
    klok = () => new Date(), log = console.log, leesMs = LEES_MS }) {
    Object.assign(this, { map, voorbeelden, lib, nacht, kaart, sjablonen, standaardMapping, profielen, hubSets,
      speeltDeck, valideerNacht, klok, log, leesMs });
  }

  pad(naam) { return join(this.map, `${naam}.json`); }
  voorbeeldPad(naam) { return join(this.voorbeelden, `${naam}.json`); }
  get actiefPad() { return join(this.map, '.actief.json'); }

  // ---- lezen ------------------------------------------------------------------

  /** Eén bestand lezen binnen de tijd (iCloud kan een bestand "dataless" hebben: dan niet blijven hangen). */
  async _leesBestand(pad) {
    const fout = new StandFout(503, `stand niet lokaal beschikbaar (iCloud?): ${pad}; zet VARVE_STANDEN op een map buiten iCloud`);
    try { return await binnenTijd(readFile(pad), this.leesMs, fout); } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null;
      throw err;
    }
  }

  /**
   * { stand, versie, bron: 'eigen'|'voorbeeld', fouten, waarschuwingen, gewijzigd } of null.
   * Een kapot bestand: stand null, met de fout. Eigen gaat vóór voorbeeld.
   */
  async lees(naam) {
    if (!naamGeldig(naam)) return null;
    for (const [bron, pad] of [['eigen', this.pad(naam)], ['voorbeeld', this.voorbeeldPad(naam)]]) {
      const buf = await this._leesBestand(pad);
      if (!buf) continue;
      const versie = versieVan(buf);
      const gewijzigd = await stat(pad).then((s) => s.mtimeMs, () => null);
      let ruw;
      try { ruw = JSON.parse(buf.toString('utf8')); } catch (err) {
        return { stand: null, versie, bron, gewijzigd, fouten: [{ deel: null, fout: `geen geldige JSON: ${err.message}` }], waarschuwingen: [] };
      }
      const { stand, fouten, waarschuwingen } = normaliseerStand(ruw, { valideerNacht: this.valideerNacht });
      return { stand, versie, bron, gewijzigd, fouten, waarschuwingen };
    }
    return null;
  }

  async _namen(map) {
    let f = [];
    try { f = await readdir(map); } catch { return []; }
    return f.map((x) => /^([\w-]{1,60})\.json$/.exec(x)?.[1]).filter((n) => n && naamGeldig(n));
  }

  /** [{ naam, titel, bron, versie, gewijzigd, fouten }], op titel. */
  async lijst() {
    const namen = [...new Set([...(await this._namen(this.map)), ...(await this._namen(this.voorbeelden))])];
    const uit = [];
    for (const naam of namen) {
      const g = await this.lees(naam).catch((err) => ({ stand: null, bron: '?', versie: null, gewijzigd: null, fouten: [{ deel: null, fout: err.message }] }));
      if (!g) continue;
      uit.push({ naam, titel: g.stand?.titel || naam, bron: g.bron, versie: g.versie, gewijzigd: g.gewijzigd, fouten: g.fouten.length });
    }
    return uit.sort((a, b) => a.titel.localeCompare(b.titel, 'nl') || a.naam.localeCompare(b.naam));
  }

  /** GET /api/standen: de lijst, wat er actief is (of null), en het label. */
  async overzicht() {
    const a = await this.actief();
    return { standen: await this.lijst(), actief: a.naam || a.teruggezet ? a : null, label: LABEL };
  }

  /** GET /api/standen/actief: altijd een object; { naam: null } als er niets actief is. */
  async actief() {
    try {
      const j = JSON.parse(await readFile(this.actiefPad, 'utf8'));
      return j && typeof j === 'object' ? j : { naam: null };
    } catch { return { naam: null }; }
  }

  // ---- opslaan ------------------------------------------------------------------

  async _schrijfAtomisch(pad, tekst) {
    await mkdir(this.map, { recursive: true });
    const tmp = join(this.map, `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    await writeFile(tmp, tekst);
    await rename(tmp, pad);
  }

  /**
   * PUT: opslaan als `versie` nog klopt met het effectieve bestand (eigen,
   * anders voorbeeld). null = er mag nog niets met die naam bestaan. Geeft
   * { code, antwoord }. De vorige EIGEN inhoud gaat naar .versies/ (een
   * voorbeeld zit al in git).
   */
  async schrijf(naam, invoer, versie) {
    if (!naamGeldig(naam)) return { code: 400, antwoord: { fout: 'een standnaam is letters, cijfers, - en _ (niet actief, keuzes of terug)' } };
    const nu = await this.lees(naam);
    if (nu && nu.versie !== versie) return { code: 409, antwoord: { fout: 'de stand is intussen veranderd', versie: nu.versie, stand: nu.stand, bron: nu.bron } };
    if (!nu && versie) return { code: 409, antwoord: { fout: 'de stand bestaat niet (meer)', versie: null, stand: null } };
    const { stand, fouten, waarschuwingen } = normaliseerStand(invoer, { valideerNacht: this.valideerNacht });
    if (!stand || fouten.length) return { code: 400, antwoord: { fout: fouten[0]?.fout ?? 'de stand klopt niet', fouten, waarschuwingen } };
    const tekst = JSON.stringify(stand, null, 2) + '\n';
    if (Buffer.byteLength(tekst) > MAX_BYTES) return { code: 413, antwoord: { fout: 'stand te groot (meer dan 64 KiB)' } };
    if (nu?.bron === 'eigen') await this._bewaarOud(naam);
    await this._schrijfAtomisch(this.pad(naam), tekst);
    return { code: 200, antwoord: { versie: versieVan(Buffer.from(tekst)), bron: 'eigen', waarschuwingen: [...waarschuwingen, ...await this._controleer(stand)] } };
  }

  /** De vorige eigen inhoud naar .versies/<naam>/; nooit iets weggooien. */
  async _bewaarOud(naam) {
    let oud;
    try { oud = await readFile(this.pad(naam)); } catch { return; }
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    // Tijd plus de versie van wat er stond: dezelfde naam = dezelfde inhoud, dus niets kwijt.
    try { await writeFile(join(map, `${stempelVan(this.klok())}-${versieVan(oud)}.json`), oud, { flag: 'wx' }); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async versies(naam) {
    try { return (await readdir(join(this.map, '.versies', naam))).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
  }

  /** Waarschuwingen bij opslaan: wat de server kan nakijken zonder iets te doen. */
  async _controleer(stand) {
    const w = [];
    const d = stand.delen;
    if (d.master) {
      const lijst = await this.sjablonen().catch(() => []);
      if (!lijst.some((r) => r?.name === d.master.sjabloon)) w.push(`geen sjabloon "${d.master.sjabloon}" in racks/sjablonen.json`);
    }
    if (d.kaart && this.kaart) {
      try { this.kaart.laad(); } catch {}
      if (this.kaart.kratten?.length && !this.kaart.kratten.some((k) => k.id === d.kaart.krat)) w.push(`krat "${d.kaart.krat}" staat niet in de kaart`);
    }
    return w;
  }

  // ---- activeren ------------------------------------------------------------------

  /** Wat een activering vervangt, eerst bewaren: .vorige/<nr>-<tijd>.json. Gooit nooit iets weg. */
  async _schrijfVorige({ door, voor }) {
    const map = join(this.map, '.vorige');
    await mkdir(map, { recursive: true });
    const i = this.nacht?.instellingen ?? {};
    const inhoud = JSON.stringify({
      tijd: this.klok().toISOString(), door, voor,
      mapping: this.lib.haal('mapping', null),
      nacht: { aan: !!i.aan, vandaagNietDatum: i.vandaagNietDatum ?? null },
    }, null, 1);
    // Een volgnummer vooraan: de nieuwste is altijd de laatste, ook als de klok terugspringt.
    let nr = (await readdir(map)).filter((f) => f.endsWith('.json')).length + 1;
    for (;;) {
      const naam = `${String(nr).padStart(6, '0')}-${stempelVan(this.klok())}.json`;
      try { await writeFile(join(map, naam), inhoud, { flag: 'wx' }); return naam; } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        nr++;
      }
    }
  }

  /**
   * Activeren (POST /api/standen/<naam>/activeer). Gooit StandFout 404/400;
   * verder gaat elk deel los: een fout in het ene deel stopt het andere niet.
   * Geeft { naam, sinds, verslag }.
   */
  async activeer(naam) {
    if (!naamGeldig(naam)) throw new StandFout(400, 'een standnaam is letters, cijfers, - en _');
    const g = await this.lees(naam);
    if (!g) throw new StandFout(404, `geen stand "${naam}"`);
    if (!g.stand) throw new StandFout(400, g.fouten[0]?.fout ?? 'de stand klopt niet', { fouten: g.fouten });
    const d = g.stand.delen;
    const verslag = { toegepast: [], gecontroleerd: [], genoemd: [], mixer: [], overgeslagen: [], fouten: [...g.fouten], waarschuwingen: [...g.waarschuwingen] };
    const sinds = this.klok().toISOString();

    // 1. Wat we vervangen eerst bewaren (bij elke activering: "vorige terugzetten" is dan altijd die van net).
    const vorige = await this._schrijfVorige({ door: 'activeer', voor: naam });

    // 2. De mapping: dezelfde sleutel als POST /api/mapping; die route zelf blijft onaangeraakt.
    if ('mapping' in d) {
      try {
        let doc = d.mapping;
        if (doc === 'standaard') {
          const std = await this.standaardMapping();
          if (!std) throw new Error('de standaardmapping is niet te lezen');
          doc = maakVerschil(std, std);
        } else if (!Array.isArray(doc?.rules) || doc.device !== STANDAARD_APPARAAT) {
          throw new Error('een mapping heeft rules nodig en is voor de apc40mk2');
        }
        this.lib.zet('mapping', doc);
        verslag.toegepast.push('mapping');
      } catch (err) { verslag.fouten.push({ deel: 'mapping', fout: String(err?.message || err) }); }
    }

    // 3. De nacht: alleen remmen. Loopt er een run, dan stopt die na het huidige nummer.
    if ('nacht' in d) {
      try {
        const zet = {};
        if (d.nacht.aan === false) zet.aan = false;
        if (d.nacht.vannacht === false) zet.vandaagNiet = true;
        this.nacht.zet(zet);
        verslag.toegepast.push('nacht');
        if (this.nacht.stand().bezig) {
          this.nacht.stop();
          verslag.waarschuwingen.push('er liep een nachtrun: hij stopt na het huidige nummer');
        }
      } catch (err) { verslag.fouten.push({ deel: 'nacht', fout: String(err?.message || err) }); }
    }

    // 4. De krat: nakijken, niet openen (de kaart opent er pas in stap D op).
    if ('kaart' in d) {
      let status = null;
      try { status = this.kaart?.laad?.()?.status ?? null; } catch {}
      const k = (this.kaart?.kratten ?? []).find((x) => x.id === d.kaart.krat);
      if (status && status !== 'geladen') verslag.waarschuwingen.push(`de kaart is niet geladen (${status}): krat "${d.kaart.krat}" niet nagekeken`);
      else if (!k) verslag.waarschuwingen.push(`krat "${d.kaart.krat}" niet in de kaart`);
      else {
        verslag.gecontroleerd.push('kaart');
        if (!(k.lijst?.length ?? k.sleutels?.size ?? 0)) verslag.waarschuwingen.push(`krat "${k.naam}" is leeg`);
      }
    }

    // 5. Het master-rack: op naam opzoeken en vastleggen; de mixer neemt het pas later over (stap M).
    let master = null;
    if ('master' in d) {
      const lijst = await this.sjablonen().catch(() => []);
      const i = lijst.findIndex((r) => r?.name === d.master.sjabloon);
      if (i < 0) verslag.fouten.push({ deel: 'master', fout: `geen sjabloon "${d.master.sjabloon}" in racks/sjablonen.json` });
      else {
        master = { sjabloon: d.master.sjabloon, herkomst: `s:${i}`, rack: lijst[i] };
        verslag.mixer.push('master');
      }
    }

    // 6. Het avondpakket (spoor draagbaar): bestaat het profiel?
    if ('pakket' in d) {
      let p;
      try { p = await this.profielen(); } catch (err) { p = undefined; verslag.waarschuwingen.push(`avondpakket/profielen.json niet leesbaar: ${err?.message || err}`); }
      if (p === null) verslag.waarschuwingen.push('avondpakket nog niet samengevoegd: profiel niet nagekeken');
      else if (p && !Object.hasOwn(p, d.pakket.profiel)) verslag.waarschuwingen.push(`profiel "${d.pakket.profiel}" staat niet in avondpakket/profielen.json`);
      else if (p) verslag.gecontroleerd.push('pakket');
    }

    // 7. De hub: alleen noemen (een hub-set start processen; dat doet Clay zelf).
    if ('hub' in d) {
      verslag.genoemd.push('hub');
      if (d.hub.set) {
        const sets = await this.hubSets().catch(() => null);
        if (sets && !sets.includes(d.hub.set)) verslag.waarschuwingen.push(`hub-set "${d.hub.set}" niet gevonden in AV-app-hub/sets`);
      }
    }

    // 8. Wat de mixer zelf moet doen en nog niet kan.
    for (const deel of ['beeld', 'koptelefoon', 'vormen']) {
      if (deel in d) verslag.overgeslagen.push({ deel, reden: 'nog niet gebouwd (stap K): stel het in de mixer zelf in' });
    }

    // 9. Midden in een set: niets herladen.
    if (this.speeltDeck()) verslag.waarschuwingen.push('er speelt een deck: herlaad de mixer niet midden in een set');

    // 10. Vastleggen, atomisch.
    const delen = { ...d };
    if ('mapping' in delen) delen.mapping = beschrijfMapping(d.mapping);
    const actief = {
      naam, titel: g.stand.titel || naam, versie: g.versie, bron: g.bron, sinds, vorige, verslag,
      mixer: { master }, hub: d.hub ?? null, pakket: d.pakket ?? null, kaart: d.kaart ?? null, delen,
    };
    await this._schrijfAtomisch(this.actiefPad, JSON.stringify(actief, null, 1));
    this.log?.(`[standen] ${naam} actief: ${[...verslag.toegepast, ...verslag.gecontroleerd].join(', ') || 'niets op de server'}`
      + `${verslag.fouten.length ? `; ${verslag.fouten.length} fout(en)` : ''}`);
    return { naam, sinds, verslag };
  }

  // ---- vooraf zien: wat verandert er? ------------------------------------------------

  /** GET /api/standen/<naam>/verschil: per deel { van, naar, moment }. */
  async verschil(naam) {
    const g = await this.lees(naam);
    if (!g) throw new StandFout(404, `geen stand "${naam}"`);
    if (!g.stand) throw new StandFout(400, g.fouten[0]?.fout ?? 'de stand klopt niet', { fouten: g.fouten });
    const d = g.stand.delen;
    const a = await this.actief();
    const uit = {};
    if ('mapping' in d) uit.mapping = { van: beschrijfMapping(this.lib.haal('mapping', null)), naar: beschrijfMapping(d.mapping), moment: 'nu' };
    if ('nacht' in d) {
      const s = { aan: !!this.nacht.instellingen.aan, vandaagNiet: !!this.nacht.vandaagNiet };
      const n = { aan: d.nacht.aan === false ? false : s.aan, vandaagNiet: d.nacht.vannacht === false ? true : s.vandaagNiet };
      uit.nacht = { van: beschrijfNacht(s), naar: beschrijfNacht(n), moment: 'nu' };
    }
    if ('kaart' in d) uit.kaart = { van: a.kaart?.krat ?? '—', naar: d.kaart.krat, moment: 'kies hem in de kaart' };
    if ('master' in d) uit.master = { van: a.mixer?.master?.sjabloon ?? '—', naar: d.master.sjabloon, moment: 'mixer volgt nog niet' };
    if ('hub' in d) {
      const tekst = (h) => (h ? `${h.set ?? 'geen set'}${h.mixerVia ? ', mixer via de hub' : ''}` : '—');
      uit.hub = { van: tekst(a.hub), naar: tekst(d.hub), moment: d.hub.set ? 'start hem zelf' : 'alleen de knop mixer openen' };
    }
    if ('pakket' in d) uit.pakket = { van: a.pakket?.profiel ?? '—', naar: d.pakket.profiel, moment: 'controle' };
    for (const deel of ['beeld', 'koptelefoon', 'vormen']) if (deel in d) uit[deel] = { van: '?', naar: JSON.stringify(d[deel]), moment: 'nog niet (stap K)' };
    return { naam, delen: uit };
  }

  // ---- vastleggen en terugzetten -------------------------------------------------------

  /**
   * POST /api/standen/<naam>/vastleggen { versie, behoud? }: de huidige
   * toestand die de server kent (mapping, de rem van de nacht) in de stand
   * schrijven. `behoud` = welke van hub, pakket, kaart, master uit het
   * bestaande bestand blijven (standaard alle vier). Wat de mixer kent (krat,
   * master) levert hij pas in stap M; tot dan kiest Clay die in de bewerker.
   */
  async vastleggen(naam, versie, behoud = ['hub', 'pakket', 'kaart', 'master']) {
    if (!naamGeldig(naam)) return { code: 400, antwoord: { fout: 'een standnaam is letters, cijfers, - en _' } };
    const g = await this.lees(naam);
    if (g && g.versie !== versie) return { code: 409, antwoord: { fout: 'de stand is intussen veranderd', versie: g.versie, stand: g.stand, bron: g.bron } };
    if (!g && versie) return { code: 409, antwoord: { fout: 'de stand bestaat niet (meer)', versie: null, stand: null } };
    const oud = g?.stand?.delen ?? {};
    const houd = Array.isArray(behoud) ? behoud.filter((b) => ['hub', 'pakket', 'kaart', 'master'].includes(b)) : ['hub', 'pakket', 'kaart', 'master'];
    const delen = {};
    const waarschuwingen = [];
    const mapping = this.lib.haal('mapping', null) ?? 'standaard';
    const proef = normaliseerStand({ schema: 1, delen: { mapping } });
    if (proef.fouten.length) waarschuwingen.push(`mapping niet vastgelegd: ${proef.fouten[0].fout}`);
    else delen.mapping = mapping;
    const nacht = {};
    if (!this.nacht.instellingen.aan) nacht.aan = false;
    if (this.nacht.vandaagNiet) nacht.vannacht = false;
    if (Object.keys(nacht).length) delen.nacht = nacht;
    for (const [deel, w] of Object.entries(oud)) {
      if (deel === 'mapping' || deel === 'nacht') continue;
      if (['hub', 'pakket', 'kaart', 'master'].includes(deel) && !houd.includes(deel)) continue;
      delen[deel] = w;   // wat de server niet kent (beeld, koptelefoon, vormen, onbekend) blijft staan
    }
    const stand = { schema: 1, titel: g?.stand?.titel || naam, uitleg: g?.stand?.uitleg ?? '', delen };
    const r = await this.schrijf(naam, stand, g ? g.versie : null);
    if (r.code !== 200) return r;
    return { code: 200, antwoord: { ...r.antwoord, stand, delen: Object.keys(delen), waarschuwingen: [...waarschuwingen, ...r.antwoord.waarschuwingen] } };
  }

  /**
   * POST /api/standen/terug: de nieuwste .vorige/ terugzetten (mapping en de
   * rem van de nacht). Schrijft eerst zelf een .vorige/ (dus nog eens
   * "terug" = opnieuw), wist niets. Gooit StandFout 404 als er geen vorige is.
   */
  async terug() {
    const map = join(this.map, '.vorige');
    let lijst = [];
    try { lijst = (await readdir(map)).filter((f) => f.endsWith('.json')).sort(); } catch {}
    if (!lijst.length) throw new StandFout(404, 'geen vorige om terug te zetten');
    const bestand = lijst.at(-1);
    let v;
    try { v = JSON.parse(await readFile(join(map, bestand), 'utf8')); } catch (err) { throw new StandFout(500, `${bestand} niet te lezen: ${err.message}`); }
    await this._schrijfVorige({ door: 'terug', voor: null });
    const delen = [];
    const fouten = [];
    if ('mapping' in v) {
      try { this.lib.zet('mapping', v.mapping ?? null); delen.push('mapping'); } catch (err) { fouten.push({ deel: 'mapping', fout: err.message }); }
    }
    if (v.nacht && typeof v.nacht.aan === 'boolean') {
      try {
        // vandaagNietDatum telt alleen als het de komende nacht is; zo blijft het bij de gewone route.
        const nu = typeof this.nacht.klok === 'function' ? this.nacht.klok() : this.klok();
        this.nacht.zet({ aan: v.nacht.aan, vandaagNiet: v.nacht.vandaagNietDatum === nachtDatum(nu) });
        delen.push('nacht');
      } catch (err) { fouten.push({ deel: 'nacht', fout: err.message }); }
    }
    const teruggezet = this.klok().toISOString();
    await this._schrijfAtomisch(this.actiefPad, JSON.stringify({ naam: null, teruggezet, uit: v.tijd, voor: v.voor ?? null }, null, 1));
    this.log?.(`[standen] vorige teruggezet (van ${v.tijd}): ${delen.join(', ') || 'niets'}`);
    return { ok: true, uit: v.tijd, voor: v.voor ?? null, delen, fouten };
  }

  // ---- keuzes voor de bewerker ------------------------------------------------------------

  /** GET /api/standen/keuzes: waaruit de bewerker in de Controlekamer kiest. */
  async keuzes() {
    const sjablonen = (await this.sjablonen().catch(() => [])).map((r) => r?.name).filter((n) => typeof n === 'string');
    try { this.kaart?.laad(); } catch {}
    const kratten = (this.kaart?.kratten ?? []).map((k) => ({ id: k.id, naam: k.naam, aantal: k.lijst?.length ?? 0 }));
    let profielen = null;
    try { const p = await this.profielen(); profielen = p ? Object.keys(p) : null; } catch {}
    const hubSets = await this.hubSets().catch(() => null);
    return { sjablonen, kratten, profielen, hubSets, mappingNu: beschrijfMapping(this.lib.haal('mapping', null)), delen: Object.keys(DELEN) };
  }
}
