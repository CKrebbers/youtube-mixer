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

/*
 * PER APPARAAT (14 okt, werkruimte S5, docs/werkruimte/S5.md). Elk apparaat met
 * knoppen heeft zijn eigen standaard (`mappings/<apparaat>.json`) en zijn eigen
 * verschil: op de server onder `/api/mapping/<apparaat>`, in de browser onder
 * `varve.mapping:<apparaat>`. Zonder apparaat (of met 'apc40mk2') is het de APC,
 * PRECIES zoals vóór 14 okt: dezelfde route `/api/mapping`, dezelfde sleutel
 * `varve.mapping`, dus Clay's verschil verhuist niet.
 */
export const APPARATEN = Object.freeze(['apc40mk2', 'maschine-mk2', 'xboard49', 'toetsen']);

/** Waar het verschil van dit apparaat staat: { apparaat, url, sleutel, standaard }. */
export function plekVan(apparaat = null) {
  const a = apparaat || STANDAARD_APPARAAT;
  if (!APPARATEN.includes(a)) throw new Error(`mapping-opslag: onbekend apparaat "${a}"`);
  if (a === STANDAARD_APPARAAT) return { apparaat: a, url: '/api/mapping', sleutel: EIGEN_MAPPING, standaard: a };
  return { apparaat: a, url: `/api/mapping/${a}`, sleutel: `${EIGEN_MAPPING}:${a}`, standaard: a };
}

/*
 * Wie bewaart voor welk apparaat (alleen deze pagina): opzetMappingOpslag meldt
 * zich hier aan, zodat het koppelpaneel per apparaat "standaard herstellen" kan
 * vragen zonder te weten wie de opslag opzette (midi-opzet, speelapparaten,
 * instrument-paneel, de aanhaker van de toetsen).
 */
const PER_APPARAAT = new Map();
/** De opslag van een apparaat ({ mapping, start, herstel, … }), of null. */
export const opslagVan = (apparaat) => PER_APPARAAT.get(apparaat || STANDAARD_APPARAAT) ?? null;

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

const lees = (opslag, sleutel = EIGEN_MAPPING) => { try { return JSON.parse(opslag?.getItem(sleutel) || 'null'); } catch (_) { return null; } };
/** Is dit iets om te laden? Een verschil (ook leeg) of een oude kopie met regels. */
const bruikbaar = (d) => isVerschil(d) || (Array.isArray(d?.rules) && d.rules.length > 0);

/**
 * Je eigen mapping in `mapping` laden: server eerst, dan de browser, anders
 * de standaard. Een oude VOLLEDIGE kopie (van vóór 25 sep) wordt hier een
 * verschil tegen de huidige standaard; wat erin stond verandert daarbij niet
 * (standaard + verschil = die kopie). Bewaart zelf niets: `omgezet` en
 * `standaardNieuw` zeggen de aanroeper dat opnieuw bewaren zin heeft.
 *
 * `apparaat`: welk apparaat (zie plekVan). Zonder: de APC, zoals altijd. Met
 * een apparaat telt alleen wat voor DAT apparaat is: een document dat zegt dat
 * het voor een ander apparaat is, wordt niet geladen (dan de standaard, en
 * `fouten` zegt waarom). Zonder apparaat blijft het oude gedrag: de APC-sleutel
 * kon altijd een geïmporteerde mapping van een ander apparaat bevatten.
 *
 * @returns {{ bron: 'server'|'browser'|null, serverBereikbaar, omgezet, standaardNieuw, eigen, weg, aantal, fouten }}
 */
export async function laadEigen(mapping, { haal, opslag = null, apparaat = null }) {
  const plek = plekVan(apparaat);
  // Met een apparaat is de standaard vooraf bekend (alleen een verschil voor DAT
  // apparaat telt): tegelijk met je verschil ophalen, zoals de Maschine en de
  // Xboard hun bestand vroeger meteen haalden. Zonder apparaat (de APC) precies
  // de oude volgorde.
  const vooraf = apparaat ? haalStandaard(plek.standaard, haal) : null;
  vooraf?.catch(() => {});   // wie hem nodig heeft, wacht er hieronder op (en krijgt de fout)
  const standaard = () => vooraf ?? haalStandaard(plek.standaard, haal);
  let vanServer = null, serverBereikbaar = true;
  try {
    const r = await haal(plek.url);
    if (!r.ok) throw new Error(`${r.status}`);
    vanServer = (await r.json())?.mapping ?? null;
  } catch (_) { serverBereikbaar = false; }
  const lokaal = lees(opslag, plek.sleutel);
  const vreemd = [];
  const vanHier = (d) => {
    if (!apparaat || !bruikbaar(d) || (d.device || 'generic') === plek.apparaat) return true;
    vreemd.push(`eigen mapping voor "${d.device || 'generic'}" onder ${plek.apparaat} genegeerd`);
    return false;
  };
  const eigen = bruikbaar(vanServer) && vanHier(vanServer) ? vanServer : bruikbaar(lokaal) && vanHier(lokaal) ? lokaal : null;
  const bron = !eigen ? null : eigen === vanServer ? 'server' : 'browser';

  if (!eigen) {
    const uit = mapping.laadStandaard(await standaard());
    uit.fouten.unshift(...vreemd);
    return { bron, serverBereikbaar, omgezet: false, standaardNieuw: false, eigen: 0, weg: 0, aantal: uit.aantal, fouten: uit.fouten };
  }

  if (isVerschil(eigen)) {
    mapping.laadStandaard(await (apparaat ? standaard() : haalStandaard(eigen.device, haal)));
    const uit = mapping.load(eigen);
    return { bron, serverBereikbaar, omgezet: false, standaardNieuw: uit.standaardNieuw, eigen: uit.eigen, weg: uit.weg, aantal: uit.aantal, fouten: uit.fouten };
  }

  // Een oude volledige kopie: verschil uitrekenen en DAT laden, zodat wat je
  // nu ziet precies is wat je na herladen krijgt. Afgezet tegen de standaard
  // waar de kopie op rust (de huidige of een voorganger uit `eerder`): anders
  // zou alles wat de standaard sinds die kopie kreeg als "weggehaald" gelden.
  const kopie = normaliseer(eigen).doc;
  const basis = await (apparaat ? standaard() : haalStandaard(kopie.device, haal));
  const { verschil } = verschilVanKopie(basis, kopie);
  mapping.laadStandaard(basis);
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
 * @param apparaat  welk apparaat (plekVan); zonder: de APC, precies zoals altijd.
 * @param learn     de MidiLearn van dit apparaat (alleen bewaard, voor het koppelpaneel: opslagVan(apparaat).learn).
 */
export function opzetMappingOpslag({ mapping, haal, opslag = null, meld = () => {}, wacht = 500, apparaat = null, learn = null }) {
  const plek = plekVan(apparaat);
  // Wat de meldingen zeggen: bij de APC zoals altijd, bij een ander apparaat met zijn naam erbij.
  const van = plek.apparaat === STANDAARD_APPARAAT ? '' : ` (${plek.apparaat})`;
  let geladen = false;       // niet de lege begintoestand bewaren
  let laatst = null;         // tekst van het laatst bewaarde verschil
  let timer = null;
  let standaardHalen = null; // loopt er al een haalStandaard voor een ander apparaat?

  let bezig = Promise.resolve();   // de laatste POST, voor wie wil wachten (tests, herstel)
  function naarServer(doc, direct) {
    clearTimeout(timer);
    const stuur = () => {
      bezig = naarDeServer(doc, { haal, apparaat })
        .catch((err) => { meld(`mapping${van} niet op de server bewaard (${err.message}) — staat wel in deze browser`, 'fout'); return false; });
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
        .catch((err) => meld(`mapping${van} niet bewaard: geen standaard voor ${device} (${err.message})`, 'fout'))
        .finally(() => { standaardHalen = null; if (mapping.verschil()) bewaar(); });
      return;
    }
    const tekst = JSON.stringify(v);
    if (tekst === laatst) return;
    laatst = tekst;
    try { opslag?.setItem(plek.sleutel, tekst); } catch (_) {}
    return naarServer(v, direct);
  }
  mapping.on('change', bewaar);

  /** Opstarten. Een omgezette kopie of een bijgewerkte standaard wordt meteen opnieuw bewaard. */
  async function start() {
    let verslag;
    try {
      verslag = await laadEigen(mapping, { haal, opslag, apparaat });
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
        mapping.laadStandaard(await haalStandaard(plek.standaard, haal));
        meld(`jouw eigen mapping${van} kon niet geladen worden (${err.message}) — de standaard staat erop, en koppelingen worden niet bewaard tot je herlaadt`, 'fout');
      } catch (e2) {
        meld(`standaardmapping${van} niet geladen (${e2.message}) — koppelingen worden niet bewaard tot je herlaadt`, 'fout');
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
      try { if (opslag && opslag.getItem(plek.sleutel) !== laatst) opslag.setItem(plek.sleutel, laatst); } catch (_) {}
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
      mapping.laadStandaard(await haalStandaard(plek.standaard, haal));
    } catch (err) {
      meld(`standaardmapping${van} niet geladen (${err.message})`, 'fout');
      geladen = true;
      return false;
    }
    geladen = true;
    laatst = null;
    return (await bewaarNu(true)) !== false;
  }

  const uit = { apparaat: plek.apparaat, mapping, learn, start, bewaar, herstel, klaar: () => bezig, get geladen() { return geladen; } };
  PER_APPARAAT.set(plek.apparaat, uit);
  return uit;
}

/** Eén POST van een verschil naar de plek van dit apparaat. true, of gooit. */
async function naarDeServer(doc, { haal, apparaat = null }) {
  const r = await haal(plekVan(apparaat).url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping: doc }) });
  leesWeg(r);
  if (!r.ok) throw new Error(`${r.status}`);
  return true;
}

/**
 * Eén keer bewaren, zonder opzet eromheen: het verschil van `mapping` naar de
 * browser en de server van dit apparaat. Voor een hulpmiddel dat alleen wil
 * vastleggen; de app zelf bewaart via opzetMappingOpslag (bij elke 'change').
 * Geeft het verschil terug, of null als er geen standaard is om tegen af te zetten.
 */
export async function bewaarEigen(mapping, { haal, opslag = null, apparaat = null }) {
  const v = mapping.verschil();
  if (!v) return null;
  const tekst = JSON.stringify(v);
  try { opslag?.setItem(plekVan(apparaat).sleutel, tekst); } catch (_) {}
  await naarDeServer(v, { haal, apparaat });
  return v;
}
