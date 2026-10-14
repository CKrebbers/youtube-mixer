/**
 * Het protocol tussen de mixer en een paneel op een ander apparaat (werkruimte S7,
 * docs/WERKRUIMTE.md C4, docs/werkruimte/S7.md). PUUR: geen DOM, geen netwerk, geen
 * imports. De mixer (src/ui/live-zender.js), de server (server/paneel.js) en de pagina
 * (src/paneel/verbinding.js) rekenen hier allemaal mee, dus er is één definitie.
 *
 * DE BERICHTEN (allemaal één object met `t`):
 *   stand       { t, reads: {id: v}, decks: {id: deck}, tijdlijn: {id: tl}, maatgever, klok, werkruimte }
 *               alles in één keer: bij verbinden, en als de mixer opnieuw begint
 *   verschil    { t, reads: {id: v} }       alleen wat veranderde (≤ 10/s per id)
 *   tijdlijn    { t, deck, tl }             bij elke nieuwe segId (of gridVersie) van een deck
 *   deck        { t, deck, info }           titel, nr, duur, grid, secties: als die veranderen
 *   klok        { t, ctxT, srvT, V, loopt } 1×/s: de audioklok tegen de klok van de server (loopt: false = stil)
 *   maatgever   { t, id }                   wie de maat geeft (syncMaster)
 *   werkruimte  { t, w }                    naam, deel, delen, panelen, schermen, vars, labels, kaart
 *   hb          { t, srvT }                 de server, 1×/s (de pagina ziet zo dat hij er nog is)
 *   weg         { t }                       de server: de mixer zegt al 3 s niets, de stand klopt niet meer
 *
 * REGEL 3 OVER HET NETWERK: posities gaan nooit per beeld over de lijn. De pagina rekent
 * de positie zelf uit het segment ({T, P, R}, `positieIn` in stream-kern.js) op zijn
 * eigen klok plus het klokverschil (`klokVerschil`, de mediaan van 8 rondjes), en trekt
 * de uitgangsvertraging V af zoals hoorbaar.js.
 */

export const SOORTEN = ['stand', 'verschil', 'tijdlijn', 'deck', 'klok', 'maatgever', 'werkruimte', 'hb', 'weg'];
/** Bundelen: de mixer stuurt hooguit één POST per BUNDEL_MS. */
export const BUNDEL_MS = 20;
/** Een read hooguit zo vaak per seconde (een fader die je sleept: 10 stappen per seconde is genoeg om te KIJKEN). */
export const PER_ID_PER_S = 10;
/** De klok hooguit 1×/s. */
export const KLOK_MS = 1000;
/** Zoveel rondjes voor het klokverschil. */
export const PING_RONDJES = 8;
/** Een volledige stand mag niet groter zijn (bytes, als JSON). */
export const MAX_STAND = 16 * 1024;
/** Wijkt de klok meer af dan dit (ms) van wat de vorige voorspelt (een haper van de audio), dan meteen een nieuwe. */
export const KLOK_SPRONG_MS = 1;
/** Een POST van de mixer mag niet groter zijn. */
export const MAX_POST = 64 * 1024;

/** Is dit een bericht van ons protocol? (De server weigert de rest.) */
export function isBericht(b) {
  return !!b && typeof b === 'object' && !Array.isArray(b) && SOORTEN.includes(b.t);
}

/** Twee read-waarden gelijk? Getallen op 1e-4 (een fader die niet beweegt, telt niet). */
export function gelijk(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
  return false;
}

/** Een read-waarde zoals hij over de lijn gaat: getallen afgerond op 4 decimalen (klein en stabiel). */
export function rond(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
  if (typeof v === 'boolean' || v === null) return v;
  return v === undefined ? null : v;
}

/**
 * Wat er van de reads verzonden moet worden: de verschillen met wat de ander al heeft,
 * hooguit PER_ID_PER_S per id. Een id dat te vroeg verandert blijft liggen tot zijn
 * beurt (de LAATSTE waarde gaat, nooit een tussenstand die niet meer klopt).
 *
 * `verzonden` = Map id -> { v, t } (wat de ander heeft en wanneer), wordt bijgewerkt.
 * `nu` in ms. Geeft { reads } of null als er niets te sturen is.
 */
export function readsVerschil(huidig, verzonden, nu, { perS = PER_ID_PER_S } = {}) {
  const tussen = 1000 / perS;
  let uit = null;
  for (const id in huidig) {
    const v = huidig[id];
    const oud = verzonden.get(id);
    if (oud && gelijk(oud.v, v)) continue;
    if (oud && nu - oud.t < tussen) continue;
    (uit ??= {})[id] = v;
    verzonden.set(id, { v, t: nu });
  }
  return uit ? { reads: uit } : null;
}

/** Een tijdlijn (Deck.tijdlijn()) klein en vast van vorm: alleen wat de pagina nodig heeft. */
export function tijdlijnKlein(tl) {
  if (!tl) return null;
  const seg = (s) => (s ? { T: s.T, P: s.P, R: s.R, loop: s.loop ? { start: s.loop.start, end: s.loop.end } : null,
    rem: s.rem ? { a: s.rem.a } : null, speelt: !!s.speelt } : null);
  return { segId: tl.segId ?? 0, gridVersie: tl.gridVersie ?? 0, ...seg(tl), vorig: seg(tl.vorig),
    wacht: !!tl.wacht, remt: !!tl.remt, rate: tl.rate ?? tl.R ?? 1 };
}

/** De sleutel van een tijdlijn: verandert hij, dan gaat er een `tijdlijn`-bericht. */
export const tijdlijnSleutel = (tl) => (tl ? `${tl.segId}:${tl.gridVersie}:${tl.wacht ? 1 : 0}:${tl.remt ? 1 : 0}` : '-');

/**
 * Een bericht op de stand leggen (de server houdt zo de volledige stand bij, de pagina ook).
 * Muteert `stand`. Geeft true als het bericht iets veranderde.
 */
export function pasToe(stand, b) {
  if (!isBericht(b)) return false;
  switch (b.t) {
    case 'stand':
      for (const k of ['reads', 'decks', 'tijdlijn']) stand[k] = { ...(b[k] ?? {}) };
      stand.maatgever = b.maatgever ?? null;
      stand.klok = b.klok ?? null;
      stand.werkruimte = b.werkruimte ?? null;
      return true;
    case 'verschil':
      stand.reads ??= {};
      Object.assign(stand.reads, b.reads ?? {});
      return true;
    case 'tijdlijn':
      stand.tijdlijn ??= {};
      if (b.tl) stand.tijdlijn[b.deck] = b.tl; else delete stand.tijdlijn[b.deck];
      return true;
    case 'deck':
      stand.decks ??= {};
      if (b.info) stand.decks[b.deck] = b.info; else delete stand.decks[b.deck];
      return true;
    case 'klok': stand.klok = { ctxT: b.ctxT, srvT: b.srvT, V: b.V, loopt: b.loopt !== false }; return true;
    case 'maatgever': stand.maatgever = b.id ?? null; return true;
    case 'werkruimte': stand.werkruimte = b.w ?? null; return true;
    default: return false;
  }
}

/** Een lege stand. */
export const legeStand = () => ({ reads: {}, decks: {}, tijdlijn: {}, maatgever: null, klok: null, werkruimte: null });

/** De stand als één `stand`-bericht. */
export const alsBericht = (stand) => ({ t: 'stand', reads: stand.reads ?? {}, decks: stand.decks ?? {}, tijdlijn: stand.tijdlijn ?? {},
  maatgever: stand.maatgever ?? null, klok: stand.klok ?? null, werkruimte: stand.werkruimte ?? null });

/**
 * Het klokverschil uit rondjes { a, s, b }: a en b de eigen klok vóór en na (ms), s die van
 * de server in het antwoord. Per rondje: verschil = s − (a + b)/2, met als onzekerheid de
 * halve rondreis. De mediaan van de verschillen van de snelste helft (een rondje dat lang
 * duurde zegt minder). Geeft { verschil, rondreis } of null.
 */
export function klokVerschil(rondjes) {
  const r = (rondjes ?? []).filter((x) => [x?.a, x?.s, x?.b].every(Number.isFinite) && x.b >= x.a)
    .map((x) => ({ d: x.s - (x.a + x.b) / 2, rr: x.b - x.a }))
    .sort((p, q) => p.rr - q.rr);
  if (!r.length) return null;
  const snel = r.slice(0, Math.max(1, Math.ceil(r.length / 2))).map((x) => x.d).sort((p, q) => p - q);
  const m = snel.length >> 1;
  const verschil = snel.length % 2 ? snel[m] : (snel[m - 1] + snel[m]) / 2;
  return { verschil, rondreis: r[0].rr };
}

/**
 * De audioklok van de mixer op serverklok `srvNu` (ms), uit het laatste klokbericht.
 * De audioklok loopt (op een paar ppm na) even snel als de wandklok; het klokbericht komt
 * elke seconde opnieuw, dus de afwijking blijft onder een ms.
 */
export const ctxOp = (klok, srvNu) => (klok && Number.isFinite(klok.ctxT)
  ? (klok.loopt === false ? klok.ctxT : klok.ctxT + (srvNu - klok.srvT) / 1000) : null);

/**
 * Hoe de mixer zijn klokbericht maakt uit metingen { ctx, perf } (op hetzelfde moment gelezen:
 * currentTime in s, performance.now() in ms).
 *
 * currentTime springt per blok van de audiothread vooruit (in Chrome headless 512 frames, 10,7 ms)
 * en staat daartussen stil; wat de mixer zelf leest (hoorbaar.js) schommelt dus over één blok. Het
 * beste wat een ander apparaat kan doen is het MIDDEN van die schommeling volgen: de MEDIAAN van
 * (ctx − perf) over de laatste `recent` metingen (op willekeurige momenten genomen ligt die in het
 * midden van een blok; de mediaan laat een meting tijdens een haper van de audiothread links liggen).
 * De audioklok loopt op een paar ppm na even snel als performance.now(): over ~0,6 s verwaarloosbaar.
 * Geeft { ctxT, perf, spreiding } (ctxT hoort bij `perf`, de laatste meting) of null.
 */
export function besteMeting(metingen, { recent = 32 } = {}) {
  const lijst = (metingen ?? []).filter((m) => Number.isFinite(m?.ctx) && Number.isFinite(m?.perf)).slice(-recent);
  if (!lijst.length) return null;
  const d = lijst.map((m) => m.ctx - m.perf / 1000).sort((x, y) => x - y);
  const h = d.length >> 1;
  const mediaan = d.length % 2 ? d[h] : (d[h - 1] + d[h]) / 2;
  const laatste = lijst[lijst.length - 1];
  return { ctxT: laatste.perf / 1000 + mediaan, perf: laatste.perf, spreiding: (d[d.length - 1] - d[0]) * 1000 };
}

/**
 * De items van een paneel plat gemaakt: een `rij` met `herhaal` wordt zijn item per naam,
 * met `{k}` ingevuld. Geeft [{ soort, action?, label?, tekst?, rij?: k }]. Puur.
 */
export function plat(paneel) {
  const uit = [];
  for (const it of paneel?.items ?? []) {
    if (it?.soort === 'rij') {
      for (const k of it.herhaal ?? []) {
        const sub = it.item ?? {};
        uit.push({ ...sub, action: typeof sub.action === 'string' ? sub.action.replaceAll('{k}', k) : sub.action,
          label: sub.label ?? null, rij: k });
      }
    } else if (it) uit.push({ ...it });
  }
  return uit;
}

/**
 * Een xy-item stuurt twee actions: `{as}` in de action wordt 1 (links–rechts) en 2 (onder–boven),
 * bv. "track.{focus}.fx.knob.{as}". Zonder `{as}` alleen links–rechts. Puur.
 */
export function xyActions(action) {
  if (typeof action !== 'string') return [null, null];
  return action.includes('{as}') ? [action.replaceAll('{as}', '1'), action.replaceAll('{as}', '2')] : [action, null];
}

/** Alle actions die een paneel nodig heeft (nog met {focus} enz.). */
export function actionsVan(paneel) {
  const uit = [];
  for (const it of plat(paneel)) {
    if (it.soort === 'tekst' || typeof it.action !== 'string') continue;
    if (it.soort === 'xy') uit.push(...xyActions(it.action).filter(Boolean));
    else uit.push(it.action);
  }
  return uit;
}

/**
 * Welke vakken een scherm in een deel toont: `schermen.<s>.vakken` van het deel (een lijst
 * namen), voor de mixer zelf (`hoofd`) zijn `werkvak`. Puur.
 */
export function vakkenVan(deelDef, scherm) {
  const s = deelDef?.schermen?.[scherm];
  if (!s) return [];
  if (scherm === 'hoofd') return s.werkvak ? [s.werkvak] : [];
  return Array.isArray(s.vakken) ? s.vakken : [];
}

/** De bouwstenen (vrij.js BOUWSTENEN): hier alleen hun namen, zodat dit bestand puur en zonder imports blijft. */
export const BOUWSTEEN_NAMEN = ['fx', 'strip', 'mixer', 'stems', 'master', 'sampler'];

/**
 * Een vaknaam ontleed: { soort: 'uitlijn'|'paneel'|'kaart'|'stand'|'secties'|'library'|'bouwsteen'|null, id }.
 * Een bouwsteen mag een vaste track hebben: 'strip:3'. Puur.
 */
export function vakSoort(naam) {
  if (typeof naam !== 'string') return { soort: null, id: null };
  const b = /^([a-z]+)(?::[1-8])?$/.exec(naam);
  if (b && BOUWSTEEN_NAMEN.includes(b[1])) return { soort: 'bouwsteen', id: naam };
  if (naam === 'uitlijn' || naam.startsWith('uitlijn-') || naam.startsWith('uitlijn:')) return { soort: 'uitlijn', id: naam };
  const m = /^paneel:([a-z0-9-]+)$/.exec(naam);
  if (m) return { soort: 'paneel', id: m[1] };
  if (['kaart', 'stand', 'secties', 'library'].includes(naam)) return { soort: naam, id: naam };
  return { soort: null, id: naam };
}

/**
 * BEDIENEN VAN BUITEN DE MAC (voor S8, na W1): de vorm van één invoke van een paneel, en wat de
 * mixer terugzegt. In dit spoor bestaat er GEEN route die dit vervoert (de iPad kijkt); S8 zet
 * `ServerVerbinding.zetSchrijver(fn)` en een route, en de mixer voert het uit (docs/werkruimte/S7.md §6).
 *   invoke   { t: 'invoke', id, v, druk: 'aan'|'los'|null, seq, scherm }   v: 0..1 of een boolean (regel 2)
 *   antwoord { t: 'antwoord', seq, ok, reden? }
 * `druk`: 'aan' bij indrukken, 'los' bij loslaten (de mixer laat ALLES los wat 'aan' bleef als het
 * scherm wegvalt); null voor een waarde. `seq` loopt per scherm op (tegen dubbel).
 */
export function invokeBericht({ id, v, druk = null, seq, scherm }) {
  return { t: 'invoke', id, v: typeof v === 'number' ? rond(v) : !!v, druk: druk === 'aan' || druk === 'los' ? druk : null, seq, scherm };
}
export function isInvoke(b) {
  return !!b && b.t === 'invoke' && typeof b.id === 'string' && /^[\w.-]{1,120}$/.test(b.id)
    && (typeof b.v === 'boolean' || (typeof b.v === 'number' && b.v >= 0 && b.v <= 1))
    && [null, 'aan', 'los'].includes(b.druk ?? null) && Number.isSafeInteger(b.seq) && typeof b.scherm === 'string';
}

/** De bytes van een bericht zoals het over de lijn gaat (UTF-8). */
export function grootte(b) {
  const s = JSON.stringify(b);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3;
  }
  return n;
}
