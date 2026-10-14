import { isVerschil, normaliseer, verschilVanKopie, MAPPING_VERSIE } from '../control/mapping.js';
import { leesWeg } from '../lib/antwoord.js';

/**
 * Waar je eigen MIDI-mapping staat, en in welke vorm (ROADMAP 13, 25 sep 2026).
 *
 * Bewaard wordt alleen je VERSCHIL met de standaard (zie mapping.js), op de
 * server (`/api/mapping`, library-database) en in de browser (localStorage,
 * als reserve). Laden = standaard van het apparaat + verschil. Zo komt een
 * nieuwe standaardmapping vanzelf bij je binnen, en blijft wat jij koppelde
 * van jou.
 *
 * Geen DOM: fetch, opslag en meld komen van buiten. Daardoor is het hele
 * opstarten (ook het omzetten van een oude volledige kopie) in Node te testen
 * tegen een nagebouwde server die net zo streng is als de echte.
 */

export const EIGEN_MAPPING = 'varve.mapping';
/** De standaard van de app: waar "standaard herstellen" naartoe gaat. */
export const STANDAARD_APPARAAT = 'apc40mk2';

const leeg = (device) => ({ name: 'leeg', device, version: MAPPING_VERSIE, rules: [] });

/**
 * De standaard van een apparaat: `mappings/<apparaat>.json`. Bestaat die niet
 * (404), dan is de standaard leeg en is je verschil gewoon je hele mapping.
 * Elke andere fout gooit: een verschil tegen een standaard die er WEL is maar
 * niet binnenkwam, zou al jouw regels als "nieuw" en niets als weggehaald
 * zien, en dat bewaren we liever niet.
 */
export async function haalStandaard(device, haal) {
  const id = device || 'generic';
  // Alleen een nette naam wordt een pad; iets anders heeft per definitie geen bestand.
  if (!/^[a-z0-9-]+$/.test(id)) return leeg(id);
  const r = await haal(`mappings/${id}.json`);
  if (r.status === 404) return leeg(id);
  if (!r.ok) throw new Error(`standaard ${id}: ${r.status}`);
  const doc = await r.json();
  if (!Array.isArray(doc?.rules)) throw new Error(`standaard ${id}: geen regels`);
  // Een bestand dat zegt dat het voor iets anders is: niet op vertrouwen.
  if ((doc.device || 'generic') !== id) return leeg(id);
  return doc;
}

const lees = (opslag) => { try { return JSON.parse(opslag?.getItem(EIGEN_MAPPING) || 'null'); } catch (_) { return null; } };
/** Is dit iets om te laden? Een verschil (ook leeg) of een oude kopie met regels. */
const bruikbaar = (d) => isVerschil(d) || (Array.isArray(d?.rules) && d.rules.length > 0);

/**
 * Je eigen mapping in `mapping` laden: server eerst, dan de browser, anders
 * de standaard. Een oude VOLLEDIGE kopie (van vóór 25 sep) wordt hier een
 * verschil tegen de huidige standaard; wat erin stond verandert daarbij niet
 * (standaard + verschil = die kopie). Bewaart zelf niets: `omgezet` en
 * `standaardNieuw` zeggen de aanroeper dat opnieuw bewaren zin heeft.
 *
 * @returns {{ bron: 'server'|'browser'|null, serverBereikbaar, omgezet, standaardNieuw, eigen, weg, aantal, fouten }}
 */
export async function laadEigen(mapping, { haal, opslag = null }) {
  let vanServer = null, serverBereikbaar = true;
  try {
    const r = await haal('/api/mapping');
    if (!r.ok) throw new Error(`${r.status}`);
    vanServer = (await r.json())?.mapping ?? null;
  } catch (_) { serverBereikbaar = false; }
  const lokaal = lees(opslag);
  const eigen = bruikbaar(vanServer) ? vanServer : bruikbaar(lokaal) ? lokaal : null;
  const bron = !eigen ? null : eigen === vanServer ? 'server' : 'browser';

  if (!eigen) {
    const uit = mapping.laadStandaard(await haalStandaard(STANDAARD_APPARAAT, haal));
    return { bron, serverBereikbaar, omgezet: false, standaardNieuw: false, eigen: 0, weg: 0, aantal: uit.aantal, fouten: uit.fouten };
  }

  if (isVerschil(eigen)) {
    mapping.laadStandaard(await haalStandaard(eigen.device, haal));
    const uit = mapping.load(eigen);
    return { bron, serverBereikbaar, omgezet: false, standaardNieuw: uit.standaardNieuw, eigen: uit.eigen, weg: uit.weg, aantal: uit.aantal, fouten: uit.fouten };
  }

  // Een oude volledige kopie: verschil uitrekenen en DAT laden, zodat wat je
  // nu ziet precies is wat je na herladen krijgt. Afgezet tegen de standaard
  // waar de kopie op rust (de huidige of een voorganger uit `eerder`): anders
  // zou alles wat de standaard sinds die kopie kreeg als "weggehaald" gelden.
  const kopie = normaliseer(eigen).doc;
  const standaard = await haalStandaard(kopie.device, haal);
  const { verschil } = verschilVanKopie(standaard, kopie);
  mapping.laadStandaard(standaard);
  const uit = mapping.load(verschil);
  return { bron, serverBereikbaar, omgezet: true, standaardNieuw: uit.standaardNieuw, eigen: uit.eigen, weg: uit.weg, aantal: uit.aantal, fouten: uit.fouten };
}

/**
 * Bewaren en herstellen rond één Mapping.
 *
 * Bij elke 'change' het verschil uitrekenen; alleen als dat anders is dan wat
 * er het laatst bewaard is, gaat het naar de browser (meteen) en de server
 * (na `wacht` ms, koppelen geeft vaak een reeks wijzigingen). Een fragment dat
 * erbij komt (vormlagen) geeft ook 'change', maar verandert je verschil niet,
 * dus dan gebeurt er niets.
 *
 * @param meld  (tekst, soort) -> void: fouten naar de strook onderaan.
 */
export function opzetMappingOpslag({ mapping, haal, opslag = null, meld = () => {}, wacht = 500 }) {
  let geladen = false;       // niet de lege begintoestand bewaren
  let laatst = null;         // tekst van het laatst bewaarde verschil
  let timer = null;
  let standaardHalen = null; // loopt er al een haalStandaard voor een ander apparaat?

  let bezig = Promise.resolve();   // de laatste POST, voor wie wil wachten (tests, herstel)
  function naarServer(doc, direct) {
    clearTimeout(timer);
    const stuur = () => {
      bezig = haal('/api/mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping: doc }) })
        .then((r) => { leesWeg(r); if (!r.ok) throw new Error(`${r.status}`); return true; })
        .catch((err) => { meld(`mapping niet op de server bewaard (${err.message}) — staat wel in deze browser`, 'fout'); return false; });
      return bezig;
    };
    if (direct || wacht <= 0) return stuur();
    timer = setTimeout(stuur, wacht);
    return null;
  }

  // Aan 'change' hangt bewaar() zonder argumenten; alleen start/herstel sturen direct.
  function bewaar() { return bewaarNu(false); }
  function bewaarNu(direct) {
    if (!geladen) return;
    const v = mapping.verschil();
    if (!v) {
      // Een mapping voor een ander apparaat ingeladen (import): eerst díe
      // standaard erbij, dan pas bewaren. Eén keer proberen, niet rondjes.
      if (standaardHalen) return;
      const device = mapping.device;
      standaardHalen = haalStandaard(device, haal)
        .then((doc) => { if (mapping.device === device) mapping.zetStandaard(doc); })
        .catch((err) => meld(`mapping niet bewaard: geen standaard voor ${device} (${err.message})`, 'fout'))
        .finally(() => { standaardHalen = null; if (mapping.verschil()) bewaar(); });
      return;
    }
    const tekst = JSON.stringify(v);
    if (tekst === laatst) return;
    laatst = tekst;
    try { opslag?.setItem(EIGEN_MAPPING, tekst); } catch (_) {}
    return naarServer(v, direct);
  }
  mapping.on('change', bewaar);

  /** Opstarten. Een omgezette kopie of een bijgewerkte standaard wordt meteen opnieuw bewaard. */
  async function start() {
    let verslag;
    try {
      verslag = await laadEigen(mapping, { haal, opslag });
    } catch (err) {
      // Wat er bewaard staat is niet te lezen, of de standaard kwam niet binnen.
      // Dan de standaard erop en zeggen wat er aan de hand is, maar deze sessie
      // NIETS bewaren (tot "standaard herstellen", een bewuste keuze). Jouw
      // verschil op de server is dan niet geladen, dus alles wat hier bewaard
      // wordt zou het vervangen: één koppeling na een haperende server
      // (controleur 25 sep: standaard één keer 500) kostte je al je eigen
      // regels. Kwam ook de standaard niet binnen, dan geldt hetzelfde: anders
      // overschreef de eerste 'change' (een fragment) je verschil met een lege
      // mapping.
      try {
        mapping.laadStandaard(await haalStandaard(STANDAARD_APPARAAT, haal));
        meld(`jouw eigen mapping kon niet geladen worden (${err.message}) — de standaard staat erop, en koppelingen worden niet bewaard tot je herlaadt`, 'fout');
      } catch (e2) {
        meld(`standaardmapping niet geladen (${e2.message}) — koppelingen worden niet bewaard tot je herlaadt`, 'fout');
        return { bron: null, fout: e2.message };
      }
      return { bron: null, fout: err.message };
    }
    const v = mapping.verschil();
    laatst = v ? JSON.stringify(v) : null;
    geladen = true;
    // Van de server geladen: de reserve in deze browser wordt hetzelfde. Anders
    // blijft daar een oude kopie liggen (een tweede browser, of van vóór de
    // samenvoeging van 23 sep) die het overneemt zodra de server even niet
    // antwoordt. Alleen de browser; de server heeft het al.
    if (verslag.bron === 'server' && laatst) {
      try { if (opslag && opslag.getItem(EIGEN_MAPPING) !== laatst) opslag.setItem(EIGEN_MAPPING, laatst); } catch (_) {}
    }
    // Omgezet, een nieuwe standaard (de vingerafdruk in het verschil klopt niet
    // meer), of alleen in de browser gevonden: dan nu bewaren, zodat server en
    // browser weer het verschil van nu hebben. Maar ALLEEN als de server gelezen
    // is. Anders weten we niet of wat daar staat nieuwer is dan de reserve in
    // deze browser (een oude kopie van vóór de grid-modus zou de grid-modus als
    // "weggehaald" over Clay's verschil heen zetten, zonder dat hij iets deed).
    if (verslag.serverBereikbaar && (verslag.omgezet || verslag.standaardNieuw || verslag.bron === 'browser')) {
      laatst = null;
      verslag.bewaard = await bewaarNu(true);
    }
    return verslag;
  }

  /**
   * "Standaard herstellen" = een LEEG verschil, op de server en in de browser.
   * Niet wissen: een leeg verschil zegt "ik wil de standaard", en daarmee komt
   * een oude kopie uit een andere browser niet meer terug.
   */
  async function herstel() {
    geladen = false;
    clearTimeout(timer);
    try {
      mapping.laadStandaard(await haalStandaard(STANDAARD_APPARAAT, haal));
    } catch (err) {
      meld(`standaardmapping niet geladen (${err.message})`, 'fout');
      geladen = true;
      return false;
    }
    geladen = true;
    laatst = null;
    return (await bewaarNu(true)) !== false;
  }

  return { start, bewaar, herstel, klaar: () => bezig, get geladen() { return geladen; } };
}
