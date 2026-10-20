/**
 * Patronen als data: het formaat, de controle en de bewerkingen. Puur: geen Web Audio, geen
 * klok, geen DOM, geen fetch, geen eigen tijd of toeval (regel van kern/). Gedeeld door de
 * speler, de acties, het scherm, de server en de export (src/kern/patronen-smf.js).
 *
 * Herkomst: v1 youtube-mixer/src/engine/patronen/model.js @ 6a640ac (docs/PATRONEN.md §2). Het
 * PATROON is ongewijzigd; de SET is anders (v2-oogst produceren-043): een LIJST van patronen met
 * hun plek als eigenschap (track, plek) in plaats van 8 tracks × 5 plekken. Het APC-grid (5 rijen)
 * is daar één weergave van, de Maschine (16 pads, pagina's) een andere. Een v1-set leest gewoon.
 *
 * Een patroon:
 *
 *   { id: 'p-1', naam: '', lengte: 16, deling: 4, swing: 50,
 *     noten: [{ stap: 0, noot: 36, snelheid: 0.8, duur: 1, micro: 0 }],
 *     track: 1, plek: 1 }                        // track/plek alleen in een set (null = nergens)
 *
 *   id       vast en uniek in de set; een nieuw patroon krijgt er een die nooit eerder bestond
 *            (de `teller` van de set telt alleen op)
 *   lengte   stappen, 1–64; daarna loopt hij rond
 *   deling   stappen per tel: 4 = zestienden, 2 = achtsten, 3 en 6 = triolen
 *   swing    50 = recht, 66,7 = triool-gevoel, hooguit 75 (de oneven stappen schuiven)
 *   noten    gesorteerd op stap, dan noot; één noot per (stap, noot). `duur` en `micro` in
 *            STAPPEN (micro −0,5..0,5). Noten voorbij de lengte blijven bewaard (een kortere
 *            lengte en weer terug kost niets), ze klinken alleen niet.
 *
 * De set:
 *
 *   { versie: 2, naam: 'set', tempo: 120, teller: 7,
 *     patronen: [patroon, …],                    // op track (null achteraan), dan plek
 *     instrumenten: { '3': { soort: 'drums', params: [0.5, …] } } }
 *
 *   tempo         het eigen tempo als er niets anders is (bpm); in v2 heeft de maatklok het
 *                 tempo, dit is wat hij krijgt als een set hem start
 *   teller        het volgende id-getal (alleen omhoog: een weggehaald id komt nooit terug)
 *   (track, plek) uniek; een tweede op dezelfde plek verliest zijn plek (komt in de bak)
 *   instrumenten  een HINT: welk instrument er op een track met patronen stond, met zijn knoppen
 *                 (null = een gebaar). In v2 hoort de instrumentstand bij de track; de set
 *                 onthoudt hem alleen om hem bij het laden terug te kunnen zetten.
 *
 * normaliseer…() gooit nooit: wat niet klopt wordt weggelaten of begrensd en staat in `fouten`.
 */

export const SET_VERSIE = 2;
export const TRACKS = 8;
/** Zoveel plekken per track kan de data hebben; het APC-grid toont er 5. */
export const PLEK_MAX = 64;
export const MAX_LENGTE = 64;
export const STANDAARD_LENGTE = 16;
/** Stappen per tel die er mogen zijn: PPQN (384) is door elk ervan deelbaar. */
export const DELINGEN = [1, 2, 3, 4, 6, 8];
export const SWING = { min: 50, max: 75 };
export const TEMPO = { min: 40, max: 240, standaard: 120 };
export const MAX_NOTEN = 1024;
export const MAX_PATRONEN = 1024;
export const SNELHEID = 0.8;
/** De lengtes waar lengte ◀ ▶ langs loopt: tot 16 per stap, daarna per halve maat. */
export const LENGTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 28, 32, 40, 48, 56, 64];

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const klem = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const tekst = (s, max = 60) => (typeof s === 'string' ? s.slice(0, max) : '');
const ID = /^[\w-]{1,40}$/;
const telVan = (id) => { const m = /^p-(\d{1,9})$/.exec(id); return m ? Number(m[1]) : 0; };

/** Het kleinste id `p-<n>` met n ≥ `vanaf` dat niet in `bezet` zit. */
export function nieuweId(bezet = new Set(), vanaf = 1) {
  let n = Math.max(1, Math.floor(eindig(vanaf) ? vanaf : 1));
  while (bezet.has(`p-${n}`)) n++;
  return `p-${n}`;
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

const trackVan = (x) => (eindig(x) && Number.isInteger(x) && x >= 1 && x <= TRACKS ? x : null);
const plekVan = (x) => (eindig(x) && Number.isInteger(x) && x >= 1 && x <= PLEK_MAX ? x : null);

/**
 * Een patroon netjes maken. Null als het geen object is. `bezet`: id's die al in de set staan
 * (een dubbele krijgt een nieuwe); `vanaf`: waar een nieuw id-getal begint (de teller van de set).
 * Heeft het patroon `track` of `plek`, dan staan die er (gecontroleerd, anders null) ook in;
 * anders is het precies de vorm van v1 (de export schrijft die vorm in zijn meta).
 */
export function normaliseerPatroon(p, { fouten = [], waar = 'patroon', bezet = null, vanaf = 1 } = {}) {
  if (!p || typeof p !== 'object') return null;
  let id = typeof p.id === 'string' && ID.test(p.id) ? p.id : null;
  if (!id || bezet?.has(id)) {
    if (p.id !== undefined) fouten.push(`${waar}: id ${JSON.stringify(p.id)} ${id ? 'dubbel' : 'ongeldig'}, een nieuwe gegeven`);
    id = nieuweId(bezet ?? new Set(), vanaf);
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
  const uit = { id, naam: tekst(p.naam), lengte, deling, swing, noten: schoon };
  if ('track' in p || 'plek' in p) {
    uit.track = trackVan(p.track);
    uit.plek = plekVan(p.plek);
    if (p.track != null && uit.track === null) fouten.push(`${waar}: track ${JSON.stringify(p.track)} kan niet (1..${TRACKS})`);
    if (p.plek != null && uit.plek === null) fouten.push(`${waar}: plek ${JSON.stringify(p.plek)} kan niet (1..${PLEK_MAX})`);
    if (uit.track === null || uit.plek === null) { uit.track = null; uit.plek = null; }
  }
  return uit;
}

/** Alleen het patroon, zonder zijn plek in een set: de vorm van v1 (de meta van de export). */
export const kernVan = (p) => ({ id: p.id, naam: p.naam, lengte: p.lengte, deling: p.deling, swing: p.swing, noten: p.noten });

/** Een nieuw, leeg patroon (buiten een set: zie metNieuwPatroon voor een id uit de teller). */
export function nieuwPatroon({ lengte = STANDAARD_LENGTE, deling = 4, swing = SWING.min, naam = '' } = {}, bezet = new Set(), vanaf = 1) {
  return { id: nieuweId(bezet, vanaf), naam, lengte, deling, swing, noten: [] };
}

/** Het instrument van een track in de set: { soort, params: [0..1|null, …≤8] | null }, of null. */
export function normaliseerInstrument(x) {
  const soort = typeof x === 'string' ? x : x?.soort;
  if (typeof soort !== 'string' || !/^[a-z0-9-]{1,30}$/.test(soort)) return null;
  const ruw = typeof x === 'object' && Array.isArray(x.params) ? x.params.slice(0, 8) : null;
  return { soort, params: ruw && ruw.map((v) => (eindig(v) ? klem(v, 0, 1) : null)) };
}

const opPlek = (a, b) => (a.track ?? Infinity) - (b.track ?? Infinity) || (a.plek ?? Infinity) - (b.plek ?? Infinity) || a._i - b._i;

/**
 * Een set netjes maken: v2 (`patronen: [...]`) of v1 (`tracks: { '1': [p|null × 5] }` of als
 * lijst). Wat verkeerd is staat in `fouten`; nog eens normaliseren verandert niets.
 * @returns {{ set, fouten: string[] }}
 */
export function normaliseerSet(invoer) {
  const fouten = [];
  const d = invoer && typeof invoer === 'object' ? invoer : {};
  if (invoer !== undefined && (!invoer || typeof invoer !== 'object')) fouten.push('geen set (geen object)');

  // De ruwe lijst: v2 zoals hij is, v1 met zijn plek erbij.
  const ruw = [];
  if (Array.isArray(d.patronen)) {
    d.patronen.forEach((p, i) => ruw.push({ p, waar: `patroon ${i + 1}` }));
  } else if (d.tracks && typeof d.tracks === 'object') {
    for (let nr = 1; nr <= TRACKS; nr++) {
      const lijst = Array.isArray(d.tracks) ? d.tracks[nr - 1] : d.tracks[String(nr)];
      if (!Array.isArray(lijst)) continue;
      lijst.forEach((p, i) => {
        if (p && typeof p === 'object') ruw.push({ p: { ...p, track: nr, plek: i + 1 }, waar: `track ${nr} plek ${i + 1}` });
      });
    }
  }
  if (ruw.length > MAX_PATRONEN) { fouten.push(`meer dan ${MAX_PATRONEN} patronen, de rest weggelaten`); ruw.length = MAX_PATRONEN; }

  // Eerst alle geldige id's: een nieuw id mag geen id worden dat verderop al staat.
  const komen = new Set(ruw.map(({ p }) => p?.id).filter((id) => typeof id === 'string' && ID.test(id)));
  let teller = Math.max(1, eindig(d.teller) ? Math.floor(d.teller) : 1);
  for (const id of komen) teller = Math.max(teller, telVan(id) + 1);
  const bezet = new Set();
  const plekken = new Set();
  const patronen = [];
  ruw.forEach(({ p, waar }, i) => {
    if (!p || typeof p !== 'object') { fouten.push(`${waar}: geen patroon`); return; }
    const isDubbel = typeof p.id === 'string' && bezet.has(p.id);
    const voorNieuw = new Set([...bezet, ...(isDubbel ? komen : [...komen].filter((x) => x !== p.id))]);
    const x = normaliseerPatroon({ track: null, plek: null, ...p }, { fouten, waar, bezet: voorNieuw, vanaf: teller });
    if (!x) return;
    bezet.add(x.id);
    teller = Math.max(teller, telVan(x.id) + 1);
    if (x.track !== null) {
      const sleutel = `${x.track}|${x.plek}`;
      if (plekken.has(sleutel)) { fouten.push(`${waar}: track ${x.track} plek ${x.plek} is al bezet, naar de bak`); x.track = null; x.plek = null; }
      else plekken.add(sleutel);
    }
    x._i = i;
    patronen.push(x);
  });
  patronen.sort(opPlek);
  for (const p of patronen) delete p._i;

  const instrumenten = {};
  for (let nr = 1; nr <= TRACKS; nr++) {
    const x = d.instrumenten?.[String(nr)];
    if (x == null) continue;
    const w = normaliseerInstrument(x);
    if (w) instrumenten[String(nr)] = w;
    else fouten.push(`track ${nr}: geen instrument (verwacht { soort, params })`);
  }
  const tempo = eindig(d.tempo) ? klem(d.tempo, TEMPO.min, TEMPO.max) : TEMPO.standaard;
  return {
    set: { versie: SET_VERSIE, naam: tekst(d.naam, 60) || 'set', tempo, teller, patronen, instrumenten },
    fouten,
  };
}

export const leegSet = () => normaliseerSet({}).set;

/** Alle patroon-id's van een set. */
export const idsVan = (set) => new Set((set?.patronen ?? []).map((p) => p.id));

// ---- de set lezen en bewerken: (set, …) → nieuwe set (de oude blijft) --------------------

/** Het patroon op (track, plek), of null. */
export const patroonOp = (set, track, plek) => set?.patronen.find((p) => p.track === track && p.plek === plek) ?? null;

/** De patronen van een track, op plek. */
export const patronenVan = (set, track) => (set?.patronen ?? []).filter((p) => p.track === track);

/** Het patroon met dit id, of null. */
export const patroonMet = (set, id) => set?.patronen.find((p) => p.id === id) ?? null;

const sorteer = (lijst) => lijst.map((p, _i) => ({ ...p, _i })).sort(opPlek).map(({ _i, ...p }) => p);

/**
 * Een patroon in de set zetten: met een id dat er al is VERVANGT hij dat (en neemt hij zijn
 * eigen track/plek mee); een nieuw id komt erbij. Stond er al een ander op die plek, dan gaat
 * dat naar de bak (track/plek null): nooit twee op één plek, nooit iets weg.
 */
export function metPatroon(set, patroon) {
  const p = normaliseerPatroon({ track: null, plek: null, ...patroon });
  if (!p) return set;
  const rest = set.patronen.filter((x) => x.id !== p.id).map((x) => (
    p.track !== null && x.track === p.track && x.plek === p.plek ? { ...x, track: null, plek: null } : x));
  return { ...set, teller: Math.max(set.teller, telVan(p.id) + 1), patronen: sorteer([...rest, p]) };
}

/** Een nieuw, leeg patroon op (track, plek) met een id uit de teller. @returns {{ set, patroon }} */
export function metNieuwPatroon(set, { track = null, plek = null, ...opties } = {}) {
  const id = nieuweId(idsVan(set), set.teller);
  const patroon = { ...nieuwPatroon(opties), id, track: trackVan(track), plek: trackVan(track) === null ? null : plekVan(plek) };
  if (patroon.plek === null) patroon.track = null;
  return { set: metPatroon({ ...set, teller: telVan(id) + 1 }, patroon), patroon: { ...patroon } };
}

/** Een patroon uit de set (zijn id komt nooit terug: de teller blijft staan). */
export function zonderPatroon(set, id) {
  const patronen = set.patronen.filter((p) => p.id !== id);
  return patronen.length === set.patronen.length ? set : { ...set, patronen };
}

/** Een patroon naar een andere plek (null = de bak); wat daar stond ruilt van plek. */
export function verplaats(set, id, track, plek) {
  const p = patroonMet(set, id);
  if (!p) return set;
  const t = trackVan(track), k = t === null ? null : plekVan(plek);
  const naar = t === null || k === null ? { track: null, plek: null } : { track: t, plek: k };
  const daar = naar.track === null ? null : patroonOp(set, naar.track, naar.plek);
  const patronen = set.patronen.map((x) => {
    if (x.id === id) return { ...x, ...naar };
    if (daar && x.id === daar.id) return { ...x, track: p.track, plek: p.plek };
    return x;
  });
  return { ...set, patronen: sorteer(patronen) };
}

// ---- het patroon bewerken: (patroon, …) → nieuw patroon (het oude blijft) --------------------

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

/**
 * ABSOLUUT: deze noot op deze stap aan (met `extra`: snelheid, duur, micro) of uit. Zo kan het
 * log het bouwen van een patroon terugspelen (oogst produceren-048): nog eens dezelfde regel
 * geeft hetzelfde patroon. De knop die "wisselt" rekent zelf uit welke kant (wisselNoot).
 */
export function zetNoot(p, stap, noot, aan, extra = {}) {
  return aan ? metNoot(p, { stap, noot, snelheid: SNELHEID, duur: 1, micro: 0, ...extra }) : zonderNoot(p, stap, noot);
}

/** Stap voor stap: staat deze noot op deze stap, dan eraf, anders erop. */
export function wisselNoot(p, stap, noot, extra = {}) {
  return zetNoot(p, stap, noot, !p.noten.some((x) => x.stap === stap && x.noot === noot), extra);
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
