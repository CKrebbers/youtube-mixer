import { readFile, writeFile, rename, mkdir, readdir, stat, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { maakVerschil, isVerschil } from '../src/control/mapping.js';
import { normaliseerStand, naamGeldig, NAAM_UITLEG, DELEN, LABEL, MAX_BYTES, STANDAARD_APPARAAT } from '../src/standen/stand-model.js';

/** Waar de werkruimtes staan (werkruimte S3): VARVE_WERKRUIMTES of <wortel>/werkruimtes, plus de voorbeelden. */
const WERK_WORTEL = fileURLToPath(new URL('../', import.meta.url));

import { komendeNacht } from './nacht.js';

/**
 * STANDEN op schijf (docs/STANDEN.md): één JSON-bestand per situatie, en
 * activeren als één gebeurtenis. In de Controlekamer heet het "Opstelling".
 *
 * Waar het staat (alles buiten git, `.gitignore`: /standen/):
 *   <map>/<naam>.json                     Clay's eigen standen (VARVE_STANDEN, anders <repo>/standen)
 *   <voorbeelden>/<naam>.json             de vertrekpunten in git (tools/standen/voorbeelden/);
 *                                         een eigen bestand met dezelfde naam gaat voor
 *   <map>/.versies/<naam>/<tijd>-<v>.json de vorige inhoud bij elke opslag; nooit weggegooid
 *   <map>/.vorige/<nr>-<tijd>.json        wat een activering verving (mapping + de rem van de nacht),
 *                                         met `raakt`: welke van die twee de activering echt zette
 *   <map>/.actief.json                    welke stand actief is, sinds wanneer, het verslag, en hoe
 *                                         mapping en nacht erbij stonden na de activering (`na`)
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
 *
 * Lezen en iCloud: de Controlekamer vraagt GET /api/standen elke 2 s. Een
 * bestand dat iCloud "dataless" maakte komt zonder netwerk niet terug, en de
 * draad van de libuv-threadpool die erop wacht (er zijn er 4, dezelfde die de
 * audio van de decks van schijf leest) komt pas vrij als het bestand er is.
 * Een tijdgrens geeft alleen het ANTWOORD op, niet de draad. Daarom:
 * (1) ongewijzigd volgens `stat` = uit het geheugen, geen nieuwe lees;
 * (2) nooit een tweede lees op hetzelfde pad zolang de eerste loopt (hooguit
 *     één vastzittende draad per bestand); loopt hij al langer dan de
 *     tijdgrens, dan meteen 503;
 * (3) over alle paden samen hooguit MAX_DRADEN (2) operaties tegelijk
 *     onderweg (review 2: vier dataless voorbeelden vulden anders in één poll
 *     alle vier de draden). Vol = wachten tot er een klaar is, binnen de
 *     tijdgrens; hangen ze allemaal al langer, dan meteen 503, zonder een
 *     nieuwe draad te starten. De andere twee draden blijven voor de audio.
 */

export const LEES_MS = 2000;
/** Hoeveel fs-operaties van de standen tegelijk onderweg mogen zijn (de threadpool heeft er 4). */
export const MAX_DRADEN = 2;
const VOL_TEKST = `te veel bestanden tegelijk niet lokaal beschikbaar (iCloud?): de server leest er hooguit ${MAX_DRADEN} tegelijk, `
  + 'zodat de audio blijft lezen; wacht op het netwerk of zet de VARVE-map buiten iCloud';
/** De delen die "vorige terugzetten" kan terugzetten: wat de server zelf bezit. */
export const TERUG_DELEN = Object.freeze(['mapping', 'nacht']);
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
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

/** "2026-10-17" → "de nacht van 17 op 18 okt" (of "… 31 okt op 1 nov"). */
export function nachtTekst(datum) {
  const [j, m, d] = String(datum).split('-').map(Number);
  const a = new Date(j, m - 1, d), b = new Date(j, m - 1, d + 1);
  if (Number.isNaN(a.getTime())) return 'de komende nacht';
  return a.getMonth() === b.getMonth() ? `de nacht van ${a.getDate()} op ${b.getDate()} ${MAANDEN[b.getMonth()]}`
    : `de nacht van ${a.getDate()} ${MAANDEN[a.getMonth()]} op ${b.getDate()} ${MAANDEN[b.getMonth()]}`;
}

/** Een nachtdeel van een stand in gewone taal: "ongemoeid", "vannacht niet", "uit", "uit en vannacht niet". */
function beschrijfRem(n) {
  const d = [n?.aan === false && 'uit', n?.vannacht === false && 'vannacht niet'].filter(Boolean);
  return d.length ? d.join(' en ') : 'ongemoeid';
}

/**
 * "leg vast" legt de rem van NU vast. Komt er daardoor een rem bij die de stand
 * nog niet had, dan één zin die zegt wat de opstelling voortaan doet (null als
 * er niets bijkomt). `oud` = het nachtdeel van de stand, null bij een nieuwe.
 */
export function opmerkingStrenger(oud, nieuw) {
  const uit = nieuw.aan === false && oud?.aan !== false;
  const vannacht = nieuw.vannacht === false && oud?.vannacht !== false;
  if (!uit && !vannacht) return null;
  const waarom = [uit && 'de nachtwachtrij staat nu uit, dus deze opstelling zet hem voortaan bij elke activering helemaal uit',
    vannacht && '"vandaag niet" staat nu aan, dus deze opstelling remt voortaan bij elke activering de komende nacht'].filter(Boolean).join('; ');
  return `nacht: ${oud ? `${beschrijfRem(oud)} → ` : ''}${beschrijfRem(nieuw)} (${waarom}; anders kies je het in de bewerker)`;
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
   * @param o.leesMs           hoe lang een lees mag duren voor 503 (iCloud)
   * @param o.leesBestand      async (pad) => Buffer (readFile; de tests tellen ermee)
   * @param o.maxDraden        hoeveel fs-operaties tegelijk onderweg mogen zijn, over alle paden samen
   */
  constructor({ map, voorbeelden, lib, nacht, kaart, sjablonen = async () => [], standaardMapping = async () => null,
    profielen = async () => null, hubSets = async () => null, speeltDeck = () => false, valideerNacht = null,
    klok = () => new Date(), log = console.log, leesMs = LEES_MS, leesBestand = readFile, maxDraden = MAX_DRADEN }) {
    Object.assign(this, { map, voorbeelden, lib, nacht, kaart, sjablonen, standaardMapping, profielen, hubSets,
      speeltDeck, valideerNacht, klok, log, leesMs, leesBestand, maxDraden });
    this._lopend = new Map();   // sleutel (pad) → { belofte, sinds }: één fs-operatie tegelijk per pad
    this._cache = new Map();    // pad → { sleutel (ino:size:mtime:ctime), buf, gewijzigd }
  }

  pad(naam) { return join(this.map, `${naam}.json`); }
  voorbeeldPad(naam) { return join(this.voorbeelden, `${naam}.json`); }
  get actiefPad() { return join(this.map, '.actief.json'); }

  // ---- lezen ------------------------------------------------------------------

  /**
   * Eén fs-operatie tegelijk per `sleutel`, binnen de tijd (zie bovenaan:
   * iCloud). Wie komt terwijl er al een loopt, wacht op diezelfde (geen
   * tweede draad); loopt die al langer dan `leesMs`, dan meteen 503.
   * Daarbovenop de grens voor de hele server: hooguit `maxDraden` operaties
   * tegelijk onderweg. Is die vol, dan wachten we tot er een klaar is, zolang
   * er nog een binnen de tijd loopt en wij zelf nog tijd hebben; hangen ze
   * allemaal al langer dan `leesMs`, dan meteen 503. Een nieuwe draad starten
   * we dan nooit.
   */
  async _beperkt(sleutel, werk, tekst = `stand niet lokaal beschikbaar (iCloud?): ${sleutel}; zet VARVE_STANDEN op een map buiten iCloud`) {
    const fout = () => new StandFout(503, tekst);
    const t0 = performance.now();
    let l = this._lopend.get(sleutel);
    while (!l && this._lopend.size >= this.maxDraden) {
      const nu = performance.now();
      const jong = [...this._lopend.values()].filter((x) => nu - x.sinds < this.leesMs);
      const rest = Math.min(this.leesMs - (nu - t0), ...jong.map((x) => this.leesMs - (nu - x.sinds)));
      if (!jong.length || rest <= 0) throw new StandFout(503, VOL_TEKST);
      let t;
      await Promise.race([...[...this._lopend.values()].map((x) => x.belofte.then(() => {}, () => {})),
        new Promise((z) => { t = setTimeout(z, rest); t.unref?.(); })]);
      clearTimeout(t);
      l = this._lopend.get(sleutel);   // intussen gestart door een ander: meeliften
    }
    if (l && performance.now() - l.sinds >= this.leesMs) throw fout();
    if (!l) {
      l = { belofte: Promise.resolve().then(werk), sinds: performance.now() };
      this._lopend.set(sleutel, l);
      const klaar = () => { if (this._lopend.get(sleutel) === l) this._lopend.delete(sleutel); };
      l.belofte.then(klaar, klaar);
    }
    return binnenTijd(l.belofte, Math.max(1, this.leesMs - (performance.now() - l.sinds)), fout());
  }

  /**
   * Eén bestand: { buf, gewijzigd } of null als het er niet is. Zegt `stat`
   * dat het niet veranderde (inode, grootte, mtime), dan uit het geheugen.
   * `stat` haalt een dataless bestand niet op en blijft dus niet hangen.
   */
  async _leesBestand(pad) {
    const weg = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
    return this._beperkt(pad, async () => {
      let s;
      try { s = await stat(pad); } catch (err) { if (weg(err)) { this._cache.delete(pad); return null; } throw err; }
      const sleutel = `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      const c = this._cache.get(pad);
      if (c?.sleutel === sleutel) return c;
      let buf;
      try { buf = await this.leesBestand(pad); } catch (err) { if (weg(err)) { this._cache.delete(pad); return null; } throw err; }
      const uit = { sleutel, buf, gewijzigd: s.mtimeMs };
      this._cache.set(pad, uit);
      return uit;
    });
  }

  /**
   * Een lezer van buiten (racks/sjablonen.json, de standaardmapping,
   * avondpakket/profielen.json, de hub-sets): die staan in de repo, dus ook in
   * iCloud. Zelfde regel: één tegelijk, binnen de tijd.
   */
  _extern(wat, f) { return this._beperkt(`extern:${wat}`, () => f(), `${wat} niet lokaal beschikbaar (iCloud?)`); }

  /**
   * racks/sjablonen.json: { lijst } of { lijst: [], fout } als hij niet te
   * lezen is (iCloud, kapotte JSON). "Niet te lezen" is iets anders dan "het
   * sjabloon staat er niet in" (review 2).
   */
  async _sjablonen() {
    try {
      const l = await this._extern('racks/sjablonen.json', this.sjablonen);
      return { lijst: Array.isArray(l) ? l : [] };
    } catch (err) {
      const reden = err instanceof StandFout ? 'niet lokaal beschikbaar (iCloud?)' : String(err?.message || err);
      return { lijst: [], fout: `racks/sjablonen.json niet te lezen (${reden})` };
    }
  }

  /** Een map lezen, ook beperkt; een map die er niet is = []. */
  async _leesMap(map) {
    try { return await this._beperkt(`${map}/`, () => readdir(map)); } catch (err) {
      if (err instanceof StandFout) throw err;
      return [];
    }
  }

  /**
   * { stand, versie, bron: 'eigen'|'voorbeeld', fouten, waarschuwingen, gewijzigd } of null.
   * Een kapot bestand: stand null, met de fout. Eigen gaat vóór voorbeeld.
   */
  async lees(naam) {
    if (!naamGeldig(naam)) return null;
    for (const [bron, pad] of [['eigen', this.pad(naam)], ['voorbeeld', this.voorbeeldPad(naam)]]) {
      const b = await this._leesBestand(pad);
      if (!b) continue;
      const versie = versieVan(b.buf);
      const gewijzigd = b.gewijzigd;
      let ruw;
      try { ruw = JSON.parse(b.buf.toString('utf8')); } catch (err) {
        return { stand: null, versie, bron, gewijzigd, fouten: [{ deel: null, fout: `geen geldige JSON: ${err.message}` }], waarschuwingen: [] };
      }
      const { stand, fouten, waarschuwingen } = normaliseerStand(ruw, { valideerNacht: this.valideerNacht });
      return { stand, versie, bron, gewijzigd, fouten, waarschuwingen };
    }
    return null;
  }

  /**
   * De standnamen in een map. Een naam is altijd kleine letters: een bestand
   * dat je met de hand `Feest.json` noemde heet hier `feest` (op de Mac, waar
   * de schijf hoofdletters niet onderscheidt, leest `feest` dan dat bestand).
   */
  async _namen(map) {
    const f = await this._leesMap(map);
    return [...new Set(f.map((x) => /^([\w-]{1,60})\.json$/.exec(x)?.[1]?.toLowerCase()).filter((n) => n && naamGeldig(n)))];
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

  /** GET /api/standen/actief: een object; { naam: null } als er niets actief is. StandFout 503 als het niet te lezen is. */
  async actief() {
    try {
      const b = await this._leesBestand(this.actiefPad);
      const j = b ? JSON.parse(b.buf.toString('utf8')) : null;
      return j && typeof j === 'object' && !Array.isArray(j) ? j : { naam: null };
    } catch (err) {
      // Niet te lezen (iCloud, de grens vol) is "onbekend", niet "niets actief": 503 door.
      if (err instanceof StandFout) throw err;
      return { naam: null };
    }
  }

  // ---- opslaan ------------------------------------------------------------------

  async _schrijfAtomisch(pad, tekst) {
    await mkdir(this.map, { recursive: true });
    const tmp = join(this.map, `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    await writeFile(tmp, tekst);
    await rename(tmp, pad);
    this._cache.delete(pad);   // eigen schrijven: de volgende lees haalt het nieuwe bestand
  }

  /**
   * PUT: opslaan als `versie` nog klopt met het effectieve bestand (eigen,
   * anders voorbeeld). null = er mag nog niets met die naam bestaan. Geeft
   * { code, antwoord }. De vorige EIGEN inhoud gaat naar .versies/ (een
   * voorbeeld zit al in git).
   */
  async schrijf(naam, invoer, versie) {
    if (!naamGeldig(naam)) return { code: 400, antwoord: { fout: NAAM_UITLEG } };
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

  /**
   * De vorige eigen inhoud naar .versies/<naam>/; nooit iets weggooien. Is de
   * vorige inhoud niet te lezen (iCloud, of de grens voor de hele server raakte
   * vol na de lees in schrijf()), dan gaat de 503 door en wordt er NIET
   * opgeslagen: anders verdween de vorige inhoud zonder kopie.
   */
  async _bewaarOud(naam) {
    const oud = (await this._leesBestand(this.pad(naam)).catch((err) => {
      if (err instanceof StandFout) throw err;
      return null;
    }))?.buf;
    if (!oud) return;
    const map = join(this.map, '.versies', naam);
    await mkdir(map, { recursive: true });
    // Tijd plus de versie van wat er stond: dezelfde naam = dezelfde inhoud, dus niets kwijt.
    try { await writeFile(join(map, `${stempelVan(this.klok())}-${versieVan(oud)}.json`), oud, { flag: 'wx' }); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async versies(naam) {
    return (await this._leesMap(join(this.map, '.versies', naam)).catch(() => [])).filter((f) => f.endsWith('.json')).sort().reverse();
  }

  /**
   * Bestaat deze werkruimte (eigen of voorbeeld)? Alleen voor een waarschuwing (werkruimte S3); de
   * mixer kijkt bij het kiezen zelf ook. Beperkt zoals elke lees hier (iCloud); niet te zien = ja.
   */
  async _werkruimteBestaat(naam) {
    const eigen = process.env.VARVE_WERKRUIMTES || join(WERK_WORTEL, 'werkruimtes');
    const paden = [join(eigen, `${naam}.json`), join(WERK_WORTEL, 'tools', 'werkruimtes', 'voorbeelden', `${naam}.json`)];
    try {
      return await this._extern(`werkruimte:${naam}`, async () => {
        for (const p of paden) { try { await access(p); return true; } catch {} }
        return false;
      });
    } catch { return true; }
  }

  /** Waarschuwingen bij opslaan: wat de server kan nakijken zonder iets te doen. */
  async _controleer(stand) {
    const w = [];
    const d = stand.delen;
    if (d.werkruimte && !(await this._werkruimteBestaat(d.werkruimte.naam))) w.push(`geen werkruimte "${d.werkruimte.naam}" (eigen of voorbeeld)`);
    if (d.master) {
      const s = await this._sjablonen();
      if (s.fout) w.push(`${s.fout}: sjabloon "${d.master.sjabloon}" niet nagekeken`);
      else if (!s.lijst.some((r) => r?.name === d.master.sjabloon)) w.push(`geen sjabloon "${d.master.sjabloon}" in racks/sjablonen.json`);
    }
    if (d.kaart && this.kaart) {
      try { this.kaart.laad(); } catch {}
      if (this.kaart.kratten?.length && !this.kaart.kratten.some((k) => k.id === d.kaart.krat)) w.push(`krat "${d.kaart.krat}" staat niet in de kaart`);
    }
    return w;
  }

  // ---- activeren ------------------------------------------------------------------

  /**
   * Hoe een deel er NU bij staat, kort (een hash van de mapping; aan + de
   * datum van "vandaag niet"). Na een activering in .actief.json (`na`), zodat
   * "vorige terugzetten" ziet of je de nacht daarna met de hand veranderde.
   */
  _toestand(deel) {
    if (deel === 'mapping') return versieVan(Buffer.from(JSON.stringify(this.lib.haal('mapping', null))));
    const i = this.nacht?.instellingen ?? {};
    return `${!!i.aan}:${i.vandaagNietDatum ?? ''}`;
  }

  /**
   * Wat een activering vervangt, eerst bewaren: .vorige/<nr>-<tijd>.json.
   * Altijd de mapping en de nacht van nu (voor de geschiedenis), en `raakt`:
   * welke daarvan deze activering (of dit terugzetten) echt zet. Alleen die
   * zet "vorige terugzetten" terug. Gooit nooit iets weg.
   */
  async _schrijfVorige({ door, voor, raakt }) {
    const map = join(this.map, '.vorige');
    await mkdir(map, { recursive: true });
    const i = this.nacht?.instellingen ?? {};
    const inhoud = JSON.stringify({
      tijd: this.klok().toISOString(), door, voor, raakt,
      mapping: this.lib.haal('mapping', null),
      nacht: { aan: !!i.aan, vandaagNietDatum: i.vandaagNietDatum ?? null },
    }, null, 1);
    // Een volgnummer vooraan: de nieuwste is altijd de laatste, ook als de klok terugspringt.
    let nr = (await this._leesMap(map)).filter((f) => f.endsWith('.json')).length + 1;
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
    if (!naamGeldig(naam)) throw new StandFout(400, NAAM_UITLEG);
    const g = await this.lees(naam);
    if (!g) throw new StandFout(404, `geen stand "${naam}"`);
    if (!g.stand) throw new StandFout(400, g.fouten[0]?.fout ?? 'de stand klopt niet', { fouten: g.fouten });
    const d = g.stand.delen;
    const verslag = { toegepast: [], gecontroleerd: [], genoemd: [], mixer: [], overgeslagen: [], fouten: [...g.fouten], waarschuwingen: [...g.waarschuwingen] };
    const sinds = this.klok().toISOString();

    // 1. Wat we vervangen eerst bewaren, bij elke activering ("vorige terugzetten" is dan altijd die van
    //    net), met de delen die deze stand echt zet: noemt hij geen mapping, dan zet "terug" hem ook niet terug.
    const raakt = TERUG_DELEN.filter((x) => x in d);
    const vorige = await this._schrijfVorige({ door: 'activeer', voor: naam, raakt });

    // 2. De mapping: dezelfde sleutel als POST /api/mapping; die route zelf blijft onaangeraakt.
    if ('mapping' in d) {
      try {
        let doc = d.mapping;
        if (doc === 'standaard') {
          const std = await this._extern('mappings/apc40mk2.json', this.standaardMapping);
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
    let krat = null;
    if ('kaart' in d) {
      let status = null;
      try { status = this.kaart?.laad?.()?.status ?? null; } catch {}
      const k = (this.kaart?.kratten ?? []).find((x) => x.id === d.kaart.krat);
      krat = k ?? null;
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
      const { lijst, fout } = await this._sjablonen();
      const i = lijst.findIndex((r) => r?.name === d.master.sjabloon);
      if (fout) verslag.fouten.push({ deel: 'master', fout: `${fout}: sjabloon "${d.master.sjabloon}" niet vastgelegd` });
      else if (i < 0) verslag.fouten.push({ deel: 'master', fout: `geen sjabloon "${d.master.sjabloon}" in racks/sjablonen.json` });
      else {
        master = { sjabloon: d.master.sjabloon, herkomst: `s:${i}`, rack: lijst[i] };
        verslag.mixer.push('master');
      }
    }

    // 6. Het avondpakket (spoor draagbaar): bestaat het profiel?
    if ('pakket' in d) {
      let p;
      try { p = await this._extern('avondpakket/profielen.json', this.profielen); } catch (err) { p = undefined; verslag.waarschuwingen.push(`avondpakket/profielen.json niet leesbaar: ${err?.message || err}`); }
      if (p === null) verslag.waarschuwingen.push('avondpakket nog niet samengevoegd: profiel niet nagekeken');
      else if (p && !Object.hasOwn(p, d.pakket.profiel)) verslag.waarschuwingen.push(`profiel "${d.pakket.profiel}" staat niet in avondpakket/profielen.json`);
      else if (p) verslag.gecontroleerd.push('pakket');
    }

    // 7. De hub: alleen noemen (een hub-set start processen; dat doet Clay zelf).
    if ('hub' in d) {
      verslag.genoemd.push('hub');
      if (d.hub.set) {
        const sets = await this._extern('AV-app-hub/sets', this.hubSets).catch(() => null);
        if (sets && !sets.includes(d.hub.set)) verslag.waarschuwingen.push(`hub-set "${d.hub.set}" niet gevonden in AV-app-hub/sets`);
      }
    }

    // 7b. De werkruimte: vastleggen, de mixer kiest hem bij zijn volgende start (S3).
    let werkruimte = null;
    if ('werkruimte' in d) {
      werkruimte = { naam: d.werkruimte.naam, sinds };
      verslag.mixer.push('werkruimte');
      if (!(await this._werkruimteBestaat(d.werkruimte.naam))) verslag.waarschuwingen.push(`geen werkruimte "${d.werkruimte.naam}" (eigen of voorbeeld): de mixer houdt dan wat hij had`);
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
      naam, titel: g.stand.titel || naam, versie: g.versie, bron: g.bron, sinds, vorige, raakt, verslag,
      na: Object.fromEntries(raakt.map((x) => [x, this._toestand(x)])),
      // De kaart met de naam die de kaart zelf geeft ("Proefkrat"), zodat de tegel hetzelfde zegt als het verschil.
      mixer: { master, ...(werkruimte ? { werkruimte } : {}) }, hub: d.hub ?? null, pakket: d.pakket ?? null, kaart: d.kaart ? { ...d.kaart, ...(krat?.naam ? { naam: krat.naam } : {}) } : null, delen,
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
      // "vannacht niet" met de echte nacht erbij: welke nacht dat is hangt van het uur af (nacht.js, komendeNacht).
      const nu = typeof this.nacht.klok === 'function' ? this.nacht.klok() : this.klok();
      const moment = d.nacht.vannacht === false ? `geldt voor ${nachtTekst(komendeNacht(nu, this.nacht.instellingen.venster))}` : 'nu';
      uit.nacht = { van: beschrijfNacht(s), naar: beschrijfNacht(n), moment };
    }
    if ('kaart' in d) {
      // De naam uit de kaart ("proefkrat"), zoals de tegel; de id als de kaart hem niet kent.
      try { this.kaart?.laad?.(); } catch {}
      const kratNaam = (id) => (id ? (this.kaart?.kratten ?? []).find((k) => k.id === id)?.naam ?? String(id).replace(/^slim:/, '') : '—');
      uit.kaart = { van: kratNaam(a.kaart?.krat), naar: kratNaam(d.kaart.krat), moment: 'kies hem in de kaart' };
    }
    if ('master' in d) uit.master = { van: a.mixer?.master?.sjabloon ?? '—', naar: d.master.sjabloon, moment: 'mixer volgt nog niet' };
    if ('hub' in d) {
      const tekst = (h) => (h ? `${h.set ?? 'geen set'}${h.mixerVia ? ', mixer via de hub' : ''}` : '—');
      uit.hub = { van: tekst(a.hub), naar: tekst(d.hub), moment: d.hub.set ? 'start hem zelf' : 'alleen de knop mixer openen' };
    }
    if ('pakket' in d) uit.pakket = { van: a.pakket?.profiel ?? '—', naar: d.pakket.profiel, moment: 'controle' };
    if ('werkruimte' in d) uit.werkruimte = { van: a.mixer?.werkruimte?.naam ?? '—', naar: d.werkruimte.naam, moment: 'bij de volgende start van de mixer' };
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
    if (!naamGeldig(naam)) return { code: 400, antwoord: { fout: NAAM_UITLEG } };
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
    // De nacht: de rem van nu, plus de rem die al in de stand stond. Een rem wordt hier alleen strenger:
    // "leg vast" om je mapping te bewaren mag de nachtrem niet stilletjes uit de stand halen (review 10 okt).
    // Weghalen doe je in de bewerker (nacht: ongemoeid).
    const oudNacht = oud.nacht && typeof oud.nacht === 'object' ? oud.nacht : {};
    const nacht = {};
    if (!this.nacht.instellingen.aan || oudNacht.aan === false) nacht.aan = false;
    if (this.nacht.vandaagNiet || oudNacht.vannacht === false) nacht.vannacht = false;
    if (Object.keys(nacht).length) delen.nacht = nacht;
    const opmerkingen = [];
    const behouden = [oudNacht.aan === false && this.nacht.instellingen.aan && 'uit', oudNacht.vannacht === false && !this.nacht.vandaagNiet && 'vannacht niet'].filter(Boolean);
    if (behouden.length) opmerkingen.push(`nachtrem uit de opstelling behouden (${behouden.join(', ')}); weghalen doe je in de bewerker`);
    // Andersom niet stil (review 2): wordt de rem strenger omdat de nacht NU zo staat (de nachtwachtrij staat
    // standaard uit), dan zegt het antwoord dat, want de opstelling doet dat voortaan bij elke activering.
    const strenger = opmerkingStrenger(g ? oudNacht : null, nacht);
    if (strenger) opmerkingen.push(strenger);
    for (const [deel, w] of Object.entries(oud)) {
      if (deel === 'mapping' || deel === 'nacht') continue;
      if (['hub', 'pakket', 'kaart', 'master'].includes(deel) && !houd.includes(deel)) continue;
      delen[deel] = w;   // wat de server niet kent (beeld, koptelefoon, vormen, onbekend) blijft staan
    }
    const stand = { schema: 1, titel: g?.stand?.titel || naam, uitleg: g?.stand?.uitleg ?? '', delen };
    const r = await this.schrijf(naam, stand, g ? g.versie : null);
    if (r.code !== 200) return r;
    return { code: 200, antwoord: { ...r.antwoord, stand, delen: Object.keys(delen), opmerkingen, waarschuwingen: [...waarschuwingen, ...r.antwoord.waarschuwingen] } };
  }

  /**
   * POST /api/standen/terug: de nieuwste .vorige/ terugzetten, maar alleen de
   * delen die die activering zette (`raakt`; een oud bestand zonder `raakt`:
   * mapping en nacht). Twee grenzen:
   * - de nacht blijft zoals hij is als je hem NA die activering met de hand
   *   veranderde (`na` in .actief.json): terugzetten zet de nacht nooit tegen
   *   je eigen latere keuze in weer aan;
   * - "geen eigen mapping" wordt een leeg verschil (= de standaard), niet
   *   null: met null laadt de mixer zijn reserve uit de browser, en daar staat
   *   na een start met de stand de mapping van de stand (mapping-opslag.js).
   * Schrijft eerst zelf een .vorige/ (nog eens "terug" = opnieuw), wist niets.
   * Gooit StandFout 404 als er geen vorige is.
   * Geeft { ok, uit, voor, delen, overgeslagen, fouten, raakte }.
   */
  async terug() {
    const map = join(this.map, '.vorige');
    const lijst = (await this._leesMap(map)).filter((f) => f.endsWith('.json')).sort();
    if (!lijst.length) throw new StandFout(404, 'geen vorige om terug te zetten');
    const bestand = lijst.at(-1);
    let v;
    try { v = JSON.parse((await this._beperkt(join(map, bestand), () => this.leesBestand(join(map, bestand)))).toString('utf8')); } catch (err) {
      if (err instanceof StandFout) throw err;
      throw new StandFout(500, `${bestand} niet te lezen: ${err.message}`);
    }
    const raakte = Array.isArray(v.raakt) ? TERUG_DELEN.filter((x) => v.raakt.includes(x))
      : TERUG_DELEN.filter((x) => (x === 'nacht' ? typeof v.nacht?.aan === 'boolean' : x in v));
    const a = await this.actief();
    const na = a.vorige === bestand && a.na && typeof a.na === 'object' ? a.na : null;
    const overgeslagen = [];
    const doen = raakte.filter((deel) => {
      if (deel === 'nacht' && na && typeof na.nacht === 'string' && na.nacht !== this._toestand('nacht')) {
        overgeslagen.push({ deel, reden: 'met de hand veranderd na de activering: blijft zoals hij is' });
        return false;
      }
      return true;
    });
    const vorige = await this._schrijfVorige({ door: 'terug', voor: null, raakt: doen });
    const delen = [];
    const fouten = [];
    if (doen.includes('mapping')) {
      try {
        let doc = v.mapping ?? null;
        if (doc === null) {
          const std = await this._extern('mappings/apc40mk2.json', this.standaardMapping);
          if (!std) throw new Error('de standaardmapping is niet te lezen');
          doc = maakVerschil(std, std);
        }
        this.lib.zet('mapping', doc);
        delen.push('mapping');
      } catch (err) { fouten.push({ deel: 'mapping', fout: String(err?.message || err) }); }
    }
    if (doen.includes('nacht')) {
      try {
        // vandaagNietDatum telt alleen als het de komende nacht is; zo blijft het bij de gewone route.
        const nu = typeof this.nacht.klok === 'function' ? this.nacht.klok() : this.klok();
        this.nacht.zet({ aan: !!v.nacht?.aan, vandaagNiet: !!v.nacht?.vandaagNietDatum && v.nacht.vandaagNietDatum === komendeNacht(nu, this.nacht.instellingen.venster) });
        delen.push('nacht');
      } catch (err) { fouten.push({ deel: 'nacht', fout: String(err?.message || err) }); }
    }
    const teruggezet = this.klok().toISOString();
    await this._schrijfAtomisch(this.actiefPad, JSON.stringify({
      naam: null, teruggezet, uit: v.tijd, voor: v.voor ?? null, vorige, raakt: doen,
      na: Object.fromEntries(doen.map((x) => [x, this._toestand(x)])),
    }, null, 1));
    this.log?.(`[standen] vorige teruggezet (van ${v.tijd}): ${delen.join(', ') || 'niets'}`
      + `${overgeslagen.length ? `; ${overgeslagen.map((o) => o.deel).join(', ')} met de hand veranderd, blijft` : ''}`);
    return { ok: true, uit: v.tijd, voor: v.voor ?? null, delen, overgeslagen, fouten, raakte };
  }

  // ---- keuzes voor de bewerker ------------------------------------------------------------

  /** GET /api/standen/keuzes: waaruit de bewerker in de Controlekamer kiest. */
  async keuzes() {
    const sj = await this._sjablonen();
    const sjablonen = sj.lijst.map((r) => r?.name).filter((n) => typeof n === 'string');
    try { this.kaart?.laad(); } catch {}
    const kratten = (this.kaart?.kratten ?? []).map((k) => ({ id: k.id, naam: k.naam, aantal: k.lijst?.length ?? 0 }));
    let profielen = null;
    try { const p = await this._extern('avondpakket/profielen.json', this.profielen); profielen = p ? Object.keys(p) : null; } catch {}
    const hubSets = await this._extern('AV-app-hub/sets', this.hubSets).catch(() => null);
    // Zolang het avondpakket (spoor draagbaar) er niet is: de profielnamen die de voorbeelden noemen,
    // zodat de bewerker iets te kiezen heeft. Nagekeken wordt dan niets (dat zegt de bewerker erbij).
    const bekendeProfielen = [];
    for (const naam of await this._namen(this.voorbeelden).catch(() => [])) {
      try {
        const b = await this._leesBestand(this.voorbeeldPad(naam));
        const p = b ? JSON.parse(b.buf.toString('utf8'))?.delen?.pakket?.profiel : null;
        if (typeof p === 'string' && !bekendeProfielen.includes(p)) bekendeProfielen.push(p);
      } catch {}
    }
    return { sjablonen, sjablonenFout: sj.fout ?? null, kratten, profielen, bekendeProfielen, hubSets, mappingNu: beschrijfMapping(this.lib.haal('mapping', null)), delen: Object.keys(DELEN) };
  }
}
