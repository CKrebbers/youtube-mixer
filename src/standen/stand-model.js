/**
 * STANDEN (docs/STANDEN.md): één bestand per situatie dat vastlegt met welke
 * beginwaarden je een avond begint: welke mapping, welke krat, welk
 * master-rack, of de nacht geremd is, welke hub-set en welk avondpakket.
 * In de Controlekamer heet een stand "Opstelling".
 *
 * Dit bestand is het FORMAAT (schema 1), puur: geen imports, geen DOM, geen
 * schijf. De server (server/standen.js) en straks de Controlekamer en de
 * mixer gebruiken dezelfde regels, zodat niemand van mening verschilt over
 * wat een stand is. test/standen-model.test.mjs bewaakt dat er geen import
 * in komt.
 *
 * Drie regels die het data houden en geen code:
 * 1. Alleen WAARDEN die VARVE vandaag al aanneemt (een sjabloonnaam, een
 *    krat-id, de rem van de nacht). Geen voorwaarden, geen volgorde, geen
 *    commando's, geen paden of adressen.
 * 2. Een stand zet alleen BEGINWAARDEN. Hij verbergt, blokkeert of schakelt
 *    nooit een pijler, paneel of action uit (VERBODEN_DELEN), en hij start
 *    nooit geluid, een opname of een download: de nacht kan hij alleen
 *    REMMEN ({ aan: false } of { vannacht: false }).
 * 3. Startpunt, geen slot: wat je daarna met de hand verandert blijft staan
 *    tot je opnieuw activeert.
 *
 * Een deel dat ontbreekt blijft zoals het is. Een fout in een bekend deel is
 * een `fout` (opslaan weigert; activeren slaat dat deel over en meldt het).
 * Een onbekend deel is een `waarschuwing` en blijft in het bestand staan.
 */

export const SCHEMA = 1;
/**
 * Een standnaam is ook een bestandsnaam: alleen KLEINE letters, cijfers, - en _.
 * Strenger dan de setplannen (server/plannen.js): de schijf van de Mac ziet
 * `APC.json` en `apc.json` als hetzelfde bestand, dus hoofdletters zouden twee
 * namen voor één stand geven (review 10 okt).
 */
export const NAAM = /^[a-z0-9_-]{1,60}$/;
export const NAAM_UITLEG = 'een standnaam is kleine letters, cijfers, - en _ (hooguit 60; niet actief, keuzes of terug)';
/** Een hub-set is een bestandsnaam in AV-app-hub/sets (zonder .json). */
export const HUB_SET = /^[\w-]{1,60}$/;
/** Vaste routenamen onder /api/standen/: geen stand mag zo heten. */
export const GERESERVEERD = new Set(['actief', 'keuzes', 'terug']);
/** Het enige apparaat waarvoor een stand een mapping mag zetten (eigen constante, geen import uit src/ui/). */
export const STANDAARD_APPARAAT = 'apc40mk2';
/** Het label in de Controlekamer (open keuze 1: "Opstelling" of "Stand"). */
export const LABEL = 'Opstelling';
export const MAX_BYTES = 64 * 1024;
export const MAX_TITEL = 60;
export const MAX_UITLEG = 300;
export const LATENTIE = Object.freeze({ min: -200, max: 500 });

/**
 * Wat een stand NOOIT mag noemen: een stand zet beginwaarden en verbergt of
 * blokkeert niets (de crossover is de kern, VISIE §2).
 */
export const VERBODEN_DELEN = Object.freeze(['panelen', 'acties', 'pijlers', 'mapjes']);

/**
 * De witte lijst van delen. `laag`: wie het toepast. `toegepast`: doet
 * activeren er vandaag iets mee (false = gevalideerd en vastgelegd, de mixer
 * neemt het later over: master in stap M, beeld/koptelefoon/vormen in stap K).
 * Een nieuw deel kost één regel hier, één toepasser en één test.
 */
export const DELEN = Object.freeze({
  mapping: Object.freeze({ laag: 'server', toegepast: true, sleutels: null }),
  nacht: Object.freeze({ laag: 'server', toegepast: true, sleutels: ['aan', 'vannacht'] }),
  kaart: Object.freeze({ laag: 'server', toegepast: true, sleutels: ['krat'] }),
  master: Object.freeze({ laag: 'mixer', toegepast: false, sleutels: ['sjabloon'] }),
  hub: Object.freeze({ laag: 'controle', toegepast: true, sleutels: ['set', 'mixerVia'] }),
  pakket: Object.freeze({ laag: 'server', toegepast: true, sleutels: ['profiel'] }),
  beeld: Object.freeze({ laag: 'mixer', toegepast: false, sleutels: ['aan', 'latentieMs'] }),
  koptelefoon: Object.freeze({ laag: 'mixer', toegepast: false, sleutels: ['omgewisseld'] }),
  vormen: Object.freeze({ laag: 'mixer', toegepast: false, sleutels: ['aan'] }),
  // De werkruimte (14 okt, werkruimte S3, docs/WERKRUIMTE.md B6): welke indeling de mixer bij
  // de volgende start kiest. Activeren legt hem vast (.actief.json, mixer.werkruimte); de mixer
  // neemt hem over als hij opstart. Een stand verbergt niets: een werkruimte haalt nooit iets weg.
  werkruimte: Object.freeze({ laag: 'mixer', toegepast: true, sleutels: ['naam'] }),
});

/** Een werkruimtenaam (= NAAM in src/werk/model.js; geen import: dit bestand is puur en importvrij). */
export const WERKRUIMTE_NAAM = /^[a-z0-9_-]{1,60}$/;

export const NACHT_REM = 'een stand kan de nacht alleen remmen: { aan: false } of { vannacht: false }';

export const naamGeldig = (n) => typeof n === 'string' && NAAM.test(n) && !GERESERVEERD.has(n);

const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
/** Bytes in UTF-8 (TextEncoder bestaat in Node én de browser; geen import nodig). */
const bytes = (s) => new TextEncoder().encode(s).length;
const korteTekst = (x, max = 200) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

/** Elke sleutel buiten de eigen sleutels van een deel is een fout (geeft de eerste, of null). */
function vreemdeSleutel(deel, waarde) {
  const mag = DELEN[deel].sleutels;
  if (!mag) return null;
  const k = Object.keys(waarde).find((s) => !mag.includes(s));
  return k === undefined ? null : `${deel} kent geen "${k}" (wel: ${mag.join(', ')})`;
}

/**
 * Eén deel controleren. Geeft { waarde } (genormaliseerd) of { fout }.
 * `valideerNacht(deel)` (van de server: pasToe van server/nacht.js) controleert
 * de vertaalde nacht-instelling nog eens met de echte regels van de nacht.
 */
function controleerDeel(deel, w, { valideerNacht }) {
  switch (deel) {
    case 'mapping': {
      if (w === 'standaard') return { waarde: 'standaard' };
      if (!isObject(w)) return { fout: 'mapping is "standaard" of een mapping-document zoals GET /api/mapping het geeft' };
      if (!Array.isArray(w.rules)) return { fout: 'een mapping heeft rules nodig (een lijst)' };
      if (w.kind === 'diff' && (typeof w.device !== 'string' || !w.device)) return { fout: 'een mapping-verschil zonder device' };
      if (w.device !== STANDAARD_APPARAAT) return { fout: `een stand zet alleen een mapping voor ${STANDAARD_APPARAAT} (niet "${w.device ?? 'zonder apparaat'}")` };
      // Gemeten zoals het in het bestand komt (ingesprongen, UTF-8), zodat opslaan niet alsnog 413 geeft.
      if (bytes(JSON.stringify({ delen: { mapping: w } }, null, 2)) > MAX_BYTES) return { fout: 'mapping te groot (meer dan 64 KiB in het bestand): gebruik "standaard" of je eigen verschil' };
      return { waarde: w };
    }
    case 'nacht': {
      if (!isObject(w)) return { fout: NACHT_REM };
      const sleutels = Object.keys(w);
      if (!sleutels.length || sleutels.some((k) => !['aan', 'vannacht'].includes(k)) || sleutels.some((k) => w[k] !== false)) return { fout: NACHT_REM };
      if (valideerNacht) {
        try { valideerNacht({ ...('aan' in w ? { aan: false } : {}), ...('vannacht' in w ? { vandaagNiet: true } : {}) }); }
        catch (err) { return { fout: `nacht: ${err?.message || err}` }; }
      }
      return { waarde: { ...('aan' in w ? { aan: false } : {}), ...('vannacht' in w ? { vannacht: false } : {}) } };
    }
    case 'kaart':
      if (!isObject(w)) return { fout: 'kaart is { krat: "<id uit de kaart>" }' };
      if (!korteTekst(w.krat)) return { fout: 'kaart.krat is de id van een krat (tekst), bv. "slim:proefkrat"' };
      return { waarde: { krat: w.krat } };
    case 'master':
      if (!isObject(w)) return { fout: 'master is { sjabloon: "<naam uit racks/sjablonen.json>" }' };
      if (!korteTekst(w.sjabloon, 60)) return { fout: 'master.sjabloon is de naam van een sjabloon (tekst)' };
      if (/^s:\d+$/.test(w.sjabloon)) return { fout: `master.sjabloon is een naam, geen plaats ("${w.sjabloon}"): de volgorde van racks/sjablonen.json kan veranderen` };
      return { waarde: { sjabloon: w.sjabloon } };
    case 'hub':
      if (!isObject(w)) return { fout: 'hub is { set?: "<hub-set>", mixerVia?: true|false }' };
      if ('set' in w && !(typeof w.set === 'string' && HUB_SET.test(w.set))) return { fout: 'hub.set is de naam van een hub-set: letters, cijfers, - en _ (bv. "studio")' };
      if ('mixerVia' in w && typeof w.mixerVia !== 'boolean') return { fout: 'hub.mixerVia is true of false' };
      return { waarde: { ...('set' in w ? { set: w.set } : {}), ...('mixerVia' in w ? { mixerVia: w.mixerVia } : {}) } };
    case 'pakket':
      if (!isObject(w)) return { fout: 'pakket is { profiel: "<profiel van het avondpakket>" }' };
      if (!korteTekst(w.profiel, 60)) return { fout: 'pakket.profiel is de naam van een profiel (tekst)' };
      return { waarde: { profiel: w.profiel } };
    case 'beeld':
      if (!isObject(w)) return { fout: 'beeld is { aan?: true|false, latentieMs?: -200..500 }' };
      if ('adres' in w || 'relay' in w) return { fout: 'een adres hoort niet in een stand (per machine; het staat in het beeldpaneel)' };
      if ('aan' in w && typeof w.aan !== 'boolean') return { fout: 'beeld.aan is true of false' };
      if ('latentieMs' in w && !(Number.isFinite(w.latentieMs) && w.latentieMs >= LATENTIE.min && w.latentieMs <= LATENTIE.max)) {
        return { fout: `beeld.latentieMs is ${LATENTIE.min}..${LATENTIE.max}` };
      }
      return { waarde: { ...('aan' in w ? { aan: w.aan } : {}), ...('latentieMs' in w ? { latentieMs: w.latentieMs } : {}) } };
    case 'koptelefoon':
      if (!isObject(w) || typeof w.omgewisseld !== 'boolean') return { fout: 'koptelefoon is { omgewisseld: true|false }' };
      return { waarde: { omgewisseld: w.omgewisseld } };
    case 'vormen':
      if (!isObject(w) || typeof w.aan !== 'boolean') return { fout: 'vormen is { aan: true|false }' };
      return { waarde: { aan: w.aan } };
    case 'werkruimte':
      if (!isObject(w) || typeof w.naam !== 'string') return { fout: 'werkruimte is { naam: "<werkruimte>" } (bv. "apc-alleen")' };
      if (!WERKRUIMTE_NAAM.test(w.naam) || ['actief', 'terug'].includes(w.naam)) return { fout: `werkruimte.naam is kleine letters, cijfers, - en _ (niet "${w.naam}")` };
      return { waarde: { naam: w.naam } };
    default:
      return { fout: `onbekend deel ${deel}` };
  }
}

/**
 * Een ruwe stand (geparst JSON) controleren en netjes maken.
 * Geeft { stand, fouten: [{ deel, fout }], waarschuwingen: [tekst] }.
 * - stand null: de hele stand is geweigerd (geen object, verkeerd schema).
 * - een fout in een bekend deel: dat deel staat NIET in stand.delen, wel in fouten.
 * - een onbekend deel: blijft in stand.delen staan (zoals het binnenkwam), met een waarschuwing.
 * Deel `null` in een fout = de stand zelf (titel, uitleg, delen).
 */
export function normaliseerStand(ruw, { valideerNacht = null } = {}) {
  const fouten = [];
  const waarschuwingen = [];
  if (!isObject(ruw)) return { stand: null, fouten: [{ deel: null, fout: 'een stand is een JSON-object' }], waarschuwingen };
  if (ruw.schema !== SCHEMA) {
    return { stand: null, fouten: [{ deel: null, fout: `deze VARVE kent schema ${SCHEMA} (dit bestand: ${JSON.stringify(ruw.schema ?? null)})` }], waarschuwingen };
  }
  const stand = { schema: SCHEMA, titel: '', uitleg: '', delen: {} };
  if ('titel' in ruw) {
    if (typeof ruw.titel !== 'string') fouten.push({ deel: null, fout: 'titel is tekst' });
    else if (ruw.titel.length > MAX_TITEL) fouten.push({ deel: null, fout: `titel is hooguit ${MAX_TITEL} tekens (nu ${ruw.titel.length})` });
    else stand.titel = ruw.titel.trim();
  }
  if ('uitleg' in ruw) {
    if (typeof ruw.uitleg !== 'string') fouten.push({ deel: null, fout: 'uitleg is tekst' });
    else if (ruw.uitleg.length > MAX_UITLEG) fouten.push({ deel: null, fout: `uitleg is hooguit ${MAX_UITLEG} tekens (nu ${ruw.uitleg.length})` });
    else stand.uitleg = ruw.uitleg.trim();
  }
  for (const k of Object.keys(ruw)) {
    if (!['schema', 'titel', 'uitleg', 'delen'].includes(k)) waarschuwingen.push(`onbekend veld "${k}" naast de delen: niet bewaard`);
  }
  if ('delen' in ruw && !isObject(ruw.delen)) {
    fouten.push({ deel: null, fout: 'delen is een object ({ "nacht": …, "kaart": … })' });
    return { stand, fouten, waarschuwingen };
  }
  for (const [deel, w] of Object.entries(ruw.delen ?? {})) {
    if (VERBODEN_DELEN.includes(deel)) {
      fouten.push({ deel, fout: `een stand zet alleen beginwaarden; hij verbergt of blokkeert nooit ${deel}` });
      continue;
    }
    if (!Object.hasOwn(DELEN, deel)) {
      stand.delen[deel] = w;
      waarschuwingen.push(`onbekend deel "${deel}": niet toegepast`);
      continue;
    }
    let r = controleerDeel(deel, w, { valideerNacht });
    if (!r.fout && isObject(w)) { const vreemd = vreemdeSleutel(deel, w); if (vreemd) r = { fout: vreemd }; }
    if (r.fout) fouten.push({ deel, fout: r.fout });
    else stand.delen[deel] = r.waarde;
  }
  return { stand, fouten, waarschuwingen };
}

/** De delen die een stand noemt en die activeren vandaag niet toepast (de mixer volgt later). */
export function nogNietToegepast(stand) {
  return Object.keys(stand?.delen ?? {}).filter((d) => Object.hasOwn(DELEN, d) && !DELEN[d].toegepast);
}
