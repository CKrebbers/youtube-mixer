/**
 * Patronen als data (docs/PATRONEN.md §2): het formaat, de controle en de
 * bewerkingen. Puur: geen engine, geen klok, geen DOM, geen fetch. Gedeeld
 * door de speler (speler.js), de actions, het scherm, de server (opslag met
 * versie) en de tests.
 *
 * Een patroon:
 *
 *   { id: 'p-…', naam: '', lengte: 16, deling: 4, swing: 50,
 *     noten: [{ stap: 0, noot: 36, snelheid: 0.8, duur: 1, micro: 0 }] }
 *
 *   id       vast en uniek in de set; een nieuw patroon krijgt er een die nooit
 *            eerder bestond (zoals de stap-id's van een plan)
 *   lengte   stappen, 1–64; daarna loopt hij rond
 *   deling   stappen per tel: 4 = zestienden, 2 = achtsten, 3 en 6 = triolen
 *   swing    50 = recht, 66,7 = triool-gevoel, hooguit 75 (de oneven stappen
 *            schuiven, zoals in Elektronlearn)
 *   noten    gesorteerd op stap, dan noot; één noot per (stap, noot). `duur` en
 *            `micro` in STAPPEN (micro −0,5..0,5: een stap vroeger of later).
 *            Noten voorbij de lengte blijven bewaard (een kortere lengte en
 *            weer terug kost niets), ze klinken alleen niet.
 *
 * De set (wat op de server staat, docs/PATRONEN.md §5): patronen horen bij de
 * SET, niet bij een nummer. Per track (1–8, de nummers van de bus) vijf
 * plekken, de vijf rijen van het APC-grid:
 *
 *   { versie: 1, naam: 'set', tempo: 120,
 *     tracks: { '1': [p|null, p|null, p|null, p|null, p|null], …, '8': […] },
 *     instrumenten: { '3': { soort: 'drums', params: [0.5, …] }, … } }
 *
 *   tempo         het eigen tempo als er geen maatgever is (bpm)
 *   instrumenten  welk instrument er op een track met patronen staat, met zijn
 *                 acht knoppen (0..1; null = een gebaar, of niet bewaard). Bij
 *                 het laden komt het terug op een lege track (VRAGEN S15,
 *                 Engine.herstelInstrumenten); staat er een nummer, dan alleen
 *                 een hint op het scherm. Een oude set met alleen de soort
 *                 ('drums') leest als { soort: 'drums', params: null }.
 *
 * normaliseer…() gooit nooit: wat niet klopt wordt weggelaten of begrensd en
 * staat in `fouten` (zoals normaliseerPlan).
 */

export const SET_VERSIE = 1;
export const PLEKKEN = 5;
export const TRACKS = 8;
export const MAX_LENGTE = 64;
export const STANDAARD_LENGTE = 16;
/** Stappen per tel die er mogen zijn: PPQN (384) is door elk ervan deelbaar. */
export const DELINGEN = [1, 2, 3, 4, 6, 8];
export const SWING = { min: 50, max: 75 };
export const TEMPO = { min: 40, max: 240, standaard: 120 };
export const MAX_NOTEN = 1024;
export const SNELHEID = 0.8;
/** De lengtes waar lengte ◀ ▶ langs loopt: tot 16 per stap, daarna per halve maat. */
export const LENGTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 28, 32, 40, 48, 56, 64];

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const klem = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const tekst = (s, max = 60) => (typeof s === 'string' ? s.slice(0, max) : '');

/** Een id die nog niet in `bezet` zit en nooit eerder bestond (tijd + toeval). */
export function nieuweId(bezet = new Set(), rnd = Math.random) {
  for (;;) {
    const id = `p-${Date.now().toString(36).slice(-5)}${Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, '0')}`;
    if (!bezet.has(id)) return id;
  }
}

/** Eén noot netjes, of null als hij niet te redden is (geen stap of geen toonhoogte). */
export function normaliseerNoot(n) {
  if (!n || typeof n !== 'object' || !eindig(n.stap) || !eindig(n.noot)) return null;
  const stap = Math.round(n.stap), noot = Math.round(n.noot);
  if (stap < 0 || stap >= MAX_LENGTE || noot < 0 || noot > 127) return null;
  return {
    stap, noot,
    snelheid: eindig(n.snelheid) && n.snelheid > 0 ? klem(n.snelheid, 0.01, 1) : SNELHEID,
    duur: eindig(n.duur) && n.duur > 0 ? klem(n.duur, 0.05, MAX_LENGTE) : 1,
    micro: eindig(n.micro) ? klem(n.micro, -0.5, 0.5) : 0,
  };
}

const opStap = (a, b) => a.stap - b.stap || a.noot - b.noot;

/** Noten sorteren en per (stap, noot) één houden: de laatste wint. */
function schoonNoten(lijst) {
  const per = new Map();
  for (const n of lijst) per.set(n.stap * 128 + n.noot, n);
  return [...per.values()].sort(opStap);
}

/**
 * Een patroon netjes maken (van de server, van Claude, van een oud bestand).
 * Null als het geen object is. `bezet`: id's die al in de set staan (een
 * dubbele krijgt een nieuwe).
 */
export function normaliseerPatroon(p, { fouten = [], waar = 'patroon', bezet = null } = {}) {
  if (!p || typeof p !== 'object') return null;
  let id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) ? p.id : null;
  if (!id || bezet?.has(id)) {
    if (p.id !== undefined) fouten.push(`${waar}: id ${JSON.stringify(p.id)} ${id ? 'dubbel' : 'ongeldig'}, een nieuwe gegeven`);
    id = nieuweId(bezet ?? new Set());
  }
  bezet?.add(id);
  const lengte = eindig(p.lengte) ? klem(Math.round(p.lengte), 1, MAX_LENGTE) : STANDAARD_LENGTE;
  if (p.lengte !== undefined && lengte !== p.lengte) fouten.push(`${waar}: lengte ${p.lengte} → ${lengte}`);
  const deling = DELINGEN.includes(p.deling) ? p.deling : 4;
  if (p.deling !== undefined && deling !== p.deling) fouten.push(`${waar}: deling ${p.deling} kan niet, 4`);
  const swing = eindig(p.swing) ? klem(p.swing, SWING.min, SWING.max) : SWING.min;
  const ruw = Array.isArray(p.noten) ? p.noten : [];
  const noten = [];
  for (const n of ruw) {
    const x = normaliseerNoot(n);
    if (x) noten.push(x);
    else fouten.push(`${waar}: noot ${JSON.stringify(n)} weggelaten`);
  }
  let schoon = schoonNoten(noten);
  if (schoon.length > MAX_NOTEN) { fouten.push(`${waar}: meer dan ${MAX_NOTEN} noten, de rest weggelaten`); schoon = schoon.slice(0, MAX_NOTEN); }
  return { id, naam: tekst(p.naam), lengte, deling, swing, noten: schoon };
}

/** Een nieuw, leeg patroon. */
export function nieuwPatroon({ lengte = STANDAARD_LENGTE, deling = 4, swing = SWING.min, naam = '' } = {}, bezet = new Set(), rnd) {
  return { id: nieuweId(bezet, rnd), naam, lengte, deling, swing, noten: [] };
}

const trackSleutels = () => Array.from({ length: TRACKS }, (_, i) => String(i + 1));

/**
 * Een set netjes maken. Tracks als object ('1'..'8') of als lijst; per track
 * precies vijf plekken (patroon of null).
 * @returns {{ set, fouten: string[] }}
 */
/** Het instrument van een track in de set: { soort, params: [0..1|null, …≤8] | null }, of null. */
export function normaliseerInstrument(x) {
  const soort = typeof x === 'string' ? x : x?.soort;
  if (typeof soort !== 'string' || !/^[a-z0-9-]{1,30}$/.test(soort)) return null;
  const ruw = typeof x === 'object' && Array.isArray(x.params) ? x.params.slice(0, 8) : null;
  return { soort, params: ruw && ruw.map((v) => (eindig(v) ? klem(v, 0, 1) : null)) };
}

export function normaliseerSet(invoer) {
  const fouten = [];
  const d = invoer && typeof invoer === 'object' ? invoer : {};
  if (invoer !== undefined && (!invoer || typeof invoer !== 'object')) fouten.push('geen set (geen object)');
  const bezet = new Set();
  const tracks = {};
  const ruw = d.tracks;
  for (const nr of trackSleutels()) {
    const lijst = Array.isArray(ruw) ? ruw[Number(nr) - 1] : ruw?.[nr];
    const plekken = Array.isArray(lijst) ? lijst : [];
    if (plekken.length > PLEKKEN) fouten.push(`track ${nr}: meer dan ${PLEKKEN} plekken, de rest weggelaten`);
    tracks[nr] = Array.from({ length: PLEKKEN }, (_, i) =>
      normaliseerPatroon(plekken[i], { fouten, waar: `track ${nr} plek ${i + 1}`, bezet }));
  }
  const instrumenten = {};
  for (const nr of trackSleutels()) {
    const x = d.instrumenten?.[nr];
    if (x == null) continue;
    const w = normaliseerInstrument(x);
    if (w) instrumenten[nr] = w;
    else fouten.push(`track ${nr}: geen instrument (verwacht { soort, params })`);
  }
  const tempo = eindig(d.tempo) ? klem(d.tempo, TEMPO.min, TEMPO.max) : TEMPO.standaard;
  return {
    set: { versie: SET_VERSIE, naam: tekst(d.naam, 60) || 'set', tempo, tracks, instrumenten },
    fouten,
  };
}

export const leegSet = () => normaliseerSet({}).set;

/** Alle patroon-id's van een set (om een nieuwe te geven). */
export function idsVan(set) {
  const uit = new Set();
  for (const lijst of Object.values(set?.tracks || {})) for (const p of lijst || []) if (p) uit.add(p.id);
  return uit;
}

// ---- bewerkingen: (patroon, …) → nieuw patroon (het oude blijft) ---------------

export const gevuld = (p) => !!p && p.noten.length > 0;

/** De noten op stap `stap` (alle toonhoogtes). */
export const notenOp = (p, stap) => (p ? p.noten.filter((n) => n.stap === stap) : []);

/** Een noot erop, of (zelfde stap en toonhoogte) vervangen. */
export function metNoot(p, noot) {
  const n = normaliseerNoot(noot);
  if (!n) return p;
  const rest = p.noten.filter((x) => !(x.stap === n.stap && x.noot === n.noot));
  return { ...p, noten: [...rest, n].sort(opStap) };
}

/** Een noot eraf; zonder `noot` alles op die stap. */
export function zonderNoot(p, stap, noot = null) {
  const noten = p.noten.filter((x) => !(x.stap === stap && (noot === null || x.noot === noot)));
  return noten.length === p.noten.length ? p : { ...p, noten };
}

/** Stap voor stap: staat deze noot op deze stap, dan eraf, anders erop. */
export function wisselNoot(p, stap, noot, extra = {}) {
  const er = p.noten.some((x) => x.stap === stap && x.noot === noot);
  return er ? zonderNoot(p, stap, noot) : metNoot(p, { stap, noot, snelheid: SNELHEID, duur: 1, micro: 0, ...extra });
}

/** De duur van een noot die er staat aanpassen (opnemen: bij het loslaten). */
export function metDuur(p, stap, noot, duur) {
  let ander = false;
  const noten = p.noten.map((x) => {
    if (x.stap !== stap || x.noot !== noot) return x;
    ander = true;
    return { ...x, duur: klem(duur, 0.05, MAX_LENGTE) };
  });
  return ander ? { ...p, noten } : p;
}

export const metLengte = (p, n) => ({ ...p, lengte: klem(Math.round(n), 1, MAX_LENGTE) });
export const metSwing = (p, s) => ({ ...p, swing: klem(s, SWING.min, SWING.max) });
export const metDeling = (p, d) => (DELINGEN.includes(d) ? { ...p, deling: d } : p);
export const leeg = (p) => ({ ...p, noten: [] });

/** De volgende of vorige lengte uit LENGTES. */
export function volgendeLengte(n, richting) {
  if (richting > 0) return LENGTES.find((x) => x > n) ?? MAX_LENGTE;
  return [...LENGTES].reverse().find((x) => x < n) ?? 1;
}
