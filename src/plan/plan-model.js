/**
 * De programmering (het setplan) als data: het formaat, de controle en de
 * bewerkingen. Puur: geen DOM, geen engine, geen fetch. Gedeeld door de
 * planpagina (plan.html), de automaat, de server en de tests. docs/PLAN.md.
 *
 * Versie 2 (30 sep 2026). Versie 1 (het eerste auto-plan) is een deel ervan en
 * wordt vanzelf omgezet:
 *
 *   { versie: 2, naam, door, uitleg,
 *     stappen: [{ id, track, van, in?, speelduur, uit?, overgang, lengte, waarom, notitie, door }] }
 *
 *   id         vast en uniek ("s1", …): zo vindt de automaat terug waar hij is,
 *              ook als het plan tijdens het spelen verandert
 *   van        beginpunt in TRACKtijd (s); null = de app kiest (fragment())
 *   speelduur  seconden; null = de app kiest (heel nummer, of 6 min bij een mix)
 *   overgang   de overgang NAAR deze stap: auto | blend | filter | ambient.
 *              De bewakers van de planner gaan voor: dit is een wens.
 *   lengte     lengte van die overgang: { maten } of { sec }; null = standaard
 *   door       wie de stap (het laatst) zette: 'clay' | 'claude' | null
 *   in, uit    OPTIONEEL (6 okt, docs/SECTIES.md): een sectie van de sectiekaart
 *              van het nummer, { sectie: K (vanaf 1, zoals track.N.section.K),
 *              label, groep, van? } (van: waar ze toen begon; het venster zet
 *              hem bij uit). `in` = de stap begint op die sectie (het
 *              inmixpunt); `uit` = de overgang naar de volgende BEGINT op die
 *              sectie. Label en groep zijn er om de sectie terug te vinden als
 *              de kaart opnieuw berekend is. `van` blijft de waarheid en de
 *              terugval: wie een sectie als `in` kiest, zet ook `van` op haar
 *              begin. Zonder in/uit staan de velden er niet (v2 blijft v2).
 *
 *   go         OPTIONEEL (14 okt, docs/PLAN-SET.md §4): 'wacht' = de automaat zet de stap klaar,
 *              maar begint de overgang pas na GO (plan.go), of op het laatste moment dat nog past
 *   lagen      OPTIONEEL (14 okt, PLAN-SET.md §4): extra stukken op een track van Clay, op een
 *              sectie of tijd in deze stap (normaliseerLaag)
 *
 * Per plan OPTIONEEL `tracks: { auto: [1..8] }` (14 okt): de tracks van de automaat; de rest is
 * van Clay. Zonder: de automaat kiest zelf, zoals altijd (maar nooit een track van Clay).
 *
 * Tijd in tracktijd en seconden, niet in maten: een maatnummer verschuift als
 * het grid bewerkt wordt, en de meeste grids in Clay's library zijn onzeker.
 */

export const PLAN_VERSIE = 2;
export const SOORTEN = ['auto', 'blend', 'filter', 'ambient'];
/** Grenzen voor een eigen overgangslengte. */
export const LENGTE = { maten: [4, 64], sec: [4, 120] };
export const MAX_STAPPEN = 200;
/** Hoogste sectienummer in een stap (zoveel stukken mag een kaart hebben, server/library.js). */
export const MAX_SECTIE = 64;
/** De optionele sectievelden van een stap. */
export const SECTIE_VELDEN = ['in', 'uit'];
/** De optionele velden van een stap voor live bijmixen (PLAN-SET.md §5). */
export const LIVE_VELDEN = ['go', 'lagen'];
/** Alles wat een schrijver die dit formaat kent in `kent` noemt (het venster en Claude). */
export const KENT = [...SECTIE_VELDEN, ...LIVE_VELDEN, 'tracks'];
/** Hooguit zoveel lagen per stap. */
export const MAX_LAGEN = 8;
/** Soorten laag: een nummer op een track van Clay, een sampler-pad, een patroon op een instrumenttrack. */
export const LAAG_SOORTEN = ['nummer', 'sampler', 'patroon'];
/** De stems die een laag kan laten horen (de rest weg), zoals track.N.stem.<s>. */
export const LAAG_STEMS = ['vocals', 'inst', 'drums', 'bass', 'other'];
const MAX_TEKST = 500;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
/** Een stap die normaliseerPlan houdt (de rest valt weg, met een fout). */
const bruikbaar = (s) => !!s && typeof s === 'object' && typeof s.track === 'string' && !!s.track;
const tekst = (s, max = MAX_TEKST) => (typeof s === 'string' ? s.slice(0, max) : '');
const klem = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Een lengte netjes maken, of null. */
export function normaliseerLengte(l) {
  if (!l || typeof l !== 'object') return null;
  if (eindig(l.maten)) return { maten: Math.round(klem(l.maten, ...LENGTE.maten)) };
  if (eindig(l.sec)) return { sec: Math.round(klem(l.sec, ...LENGTE.sec) * 10) / 10 };
  return null;
}

/**
 * Een sectiekeuze (in of uit) netjes maken: { sectie, label, groep, van? } met
 * sectie een geheel getal 1..MAX_SECTIE, label een kort woord en groep één
 * hoofdletter (anders null). `van` (optioneel, tracktijd ≥ 0) = waar die
 * sectie begon toen ze gekozen werd: zo vindt de planner na een herberekening
 * de goede terug als een label vaker voorkomt (vindSectie). Voor `uit`; bij
 * `in` is de `van` van de stap al die tijd. Geen sectie: null.
 */
export function normaliseerSectie(x) {
  if (!x || typeof x !== 'object' || !Number.isInteger(x.sectie) || x.sectie < 1 || x.sectie > MAX_SECTIE) return null;
  return {
    sectie: x.sectie,
    label: typeof x.label === 'string' && /^[a-z]{1,16}$/.test(x.label) ? x.label : null,
    groep: typeof x.groep === 'string' && /^[A-Z]$/.test(x.groep) ? x.groep : null,
    ...(eindig(x.van) && x.van >= 0 ? { van: x.van } : {}),
  };
}

/**
 * Tracks van de automaat: { auto: [1..8] } uniek en oplopend, minstens TWEE (met één track kan hij
 * nooit overgaan: hij laadt nooit op wat klinkt; review S9 a-K2), of null.
 */
export function normaliseerTracks(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.auto)) return null;
  const auto = [...new Set(t.auto.filter((n) => Number.isInteger(n) && n >= 1 && n <= 8))].sort((a, b) => a - b);
  return auto.length >= 2 ? { auto } : null;
}

/**
 * Een laag netjes maken, of { fout }. `op` = waar in de stap: { sectie, label, groep, sec? }
 * (een sectie van de kaart van het nummer van de stap; `sec` is dan de terugval) of { sec }
 * (seconden tracktijd vanaf het begin van de stap). `autoTracks` (Set van tracknummers): een
 * laag komt nooit op een track van de automaat.
 */
export function normaliseerLaag(l, { autoTracks = null } = {}) {
  if (!l || typeof l !== 'object') return { fout: 'geen laag' };
  if (!LAAG_SOORTEN.includes(l.soort)) return { fout: `onbekende soort "${l.soort}"` };
  const o = l.op && typeof l.op === 'object' ? l.op : null;
  const sec = o && eindig(o.sec) && o.sec >= 0 ? Math.round(o.sec * 1000) / 1000 : null;
  const sec2 = normaliseerSectie(o);
  if (!sec2 && sec === null) return { fout: 'geen "op" (een sectie of seconden)' };
  const op = sec2 ? { ...sec2, ...(sec !== null ? { sec } : {}) } : { sec };
  delete op.van;
  const nr = (x) => (Number.isInteger(x) && x >= 1 && x <= 8 ? x : null);
  let deck = nr(l.deck);
  const fouten = [];
  if (deck && autoTracks?.has(deck)) { fouten.push(`track ${deck} is van de automaat: de laag kiest zelf een track van jou`); deck = null; }
  const basis = { id: typeof l.id === 'string' && /^[\w-]{1,40}$/.test(l.id) ? l.id : null, soort: l.soort, op };
  let laag;
  if (l.soort === 'nummer') {
    if (typeof l.track !== 'string' || !l.track) return { fout: 'een laag "nummer" zonder nummer' };
    laag = { ...basis, track: l.track.slice(0, 200), van: eindig(l.van) && l.van >= 0 ? l.van : null,
      stem: LAAG_STEMS.includes(l.stem) ? l.stem : null, deck,
      duur: eindig(l.duur) && l.duur > 0 ? klem(l.duur, 4, 3600) : null, start: l.start === 'jij' ? 'jij' : 'auto' };
  } else if (l.soort === 'sampler') {
    const pad = nr(l.pad);
    if (!pad) return { fout: 'een laag "sampler" zonder pad (1–8)' };
    laag = { ...basis, pad };
  } else {
    const plek = Number.isInteger(l.plek) && l.plek >= 1 && l.plek <= 5 ? l.plek : null;
    if (!deck || !plek) return { fout: 'een laag "patroon" vraagt een track (deck 1–8, niet van de automaat) en een plek (1–5)' };
    laag = { ...basis, deck, plek };
  }
  const notitie = tekst(l.notitie, 200);
  if (notitie) laag.notitie = notitie;
  return { laag, fouten };
}

/** Een nieuwe id die nog niet in `bezet` zit (voor een plan zonder id's: s1, s2, …). */
export function nieuweId(bezet) {
  let n = bezet.size + 1;
  while (bezet.has(`s${n}`)) n++;
  return `s${n}`;
}

/**
 * Een id voor een stap die er NU bij komt: nooit een die eerder bestond. Anders
 * kreeg na "s3 weg, nummer erbij" het nieuwe nummer weer s3, en dacht de
 * automaat dat de stap die hij net speelde nog in het plan stond.
 */
export function verseId(bezet, rnd = Math.random) {
  for (;;) {
    const id = `s${Date.now().toString(36).slice(-4)}${Math.floor(rnd() * 36 ** 3).toString(36).padStart(3, '0')}`;
    if (!bezet.has(id)) return id;
  }
}

/**
 * Een plan (v1 of v2, van Claude, Clay of een oud bestand) netjes maken.
 * Gooit nooit: wat niet klopt wordt weggelaten of begrensd, en staat in
 * `fouten`. Met `trackIds` worden stappen met een onbekend nummer gemeld
 * (niet weggegooid: het nummer kan later terugkomen).
 *
 * @returns { plan, fouten: [tekst] }
 */
export function normaliseerPlan(invoer, { trackIds = null } = {}) {
  const fouten = [];
  const d = invoer && typeof invoer === 'object' ? invoer : {};
  if (!invoer || typeof invoer !== 'object') fouten.push('geen plan (geen object)');
  const ruw = Array.isArray(d.stappen) ? d.stappen : [];
  if (!Array.isArray(d.stappen)) fouten.push('geen stappen');
  if (ruw.length > MAX_STAPPEN) fouten.push(`meer dan ${MAX_STAPPEN} stappen: de rest is weggelaten`);
  const tracks = normaliseerTracks(d.tracks);
  if (d.tracks != null && !tracks) fouten.push('"tracks" is geen { auto: [1..8] } met minstens twee tracks (weggelaten)');
  const autoTracks = tracks ? new Set(tracks.auto) : null;
  const bezet = new Set();
  const stappen = [];
  ruw.slice(0, MAX_STAPPEN).forEach((s, i) => {
    if (!bruikbaar(s)) {
      fouten.push(`stap ${i + 1}: geen nummer`);
      return;
    }
    let id = typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && !bezet.has(s.id) ? s.id : null;
    if (!id) id = nieuweId(bezet);
    bezet.add(id);
    const overgang = SOORTEN.includes(s.overgang) ? s.overgang : 'auto';
    if (s.overgang !== undefined && s.overgang !== overgang) fouten.push(`stap ${i + 1}: onbekende overgang "${s.overgang}", auto`);
    // In en uit: optioneel. Rommel weg (met een fout); uit moet ná in liggen.
    const inn = normaliseerSectie(s.in);
    let uit = normaliseerSectie(s.uit);
    if (s.in != null && !inn) fouten.push(`stap ${i + 1}: "in" is geen sectie (weggelaten)`);
    if (s.uit != null && !uit) fouten.push(`stap ${i + 1}: "uit" is geen sectie (weggelaten)`);
    if (inn && uit && uit.sectie <= inn.sectie) {
      fouten.push(`stap ${i + 1}: uit (sectie ${uit.sectie}) ligt niet na in (sectie ${inn.sectie}): uit weggelaten`);
      uit = null;
    }
    // Live bijmixen (PLAN-SET.md §4): GO en lagen, optioneel.
    let lagen = [];
    if (s.lagen != null && !Array.isArray(s.lagen)) fouten.push(`stap ${i + 1}: "lagen" is geen lijst (weggelaten)`);
    if (Array.isArray(s.lagen)) {
      if (s.lagen.length > MAX_LAGEN) fouten.push(`stap ${i + 1}: meer dan ${MAX_LAGEN} lagen: de rest is weggelaten`);
      const lid = new Set();
      s.lagen.slice(0, MAX_LAGEN).forEach((l, j) => {
        const r = normaliseerLaag(l, { autoTracks });
        if (r.fout) { fouten.push(`stap ${i + 1}, laag ${j + 1}: ${r.fout} (weggelaten)`); return; }
        for (const f of r.fouten) fouten.push(`stap ${i + 1}, laag ${j + 1}: ${f}`);
        let lidId = r.laag.id && !lid.has(r.laag.id) ? r.laag.id : null;
        if (!lidId) { let n = lid.size + 1; while (lid.has(`l${n}`)) n++; lidId = `l${n}`; }
        lid.add(lidId);
        lagen.push({ ...r.laag, id: lidId });
      });
    }
    if (s.go != null && s.go !== 'wacht' && s.go !== 'auto') fouten.push(`stap ${i + 1}: onbekende go "${s.go}" (automatisch)`);
    const stap = {
      id, track: s.track.slice(0, 200),
      van: eindig(s.van) && s.van >= 0 ? s.van : null,
      ...(inn ? { in: inn } : {}),
      speelduur: eindig(s.speelduur) && s.speelduur > 0 ? klem(s.speelduur, 5, 4 * 3600) : null,
      ...(uit ? { uit } : {}),
      overgang,
      lengte: normaliseerLengte(s.lengte),
      waarom: tekst(s.waarom),
      notitie: tekst(s.notitie),
      door: s.door === 'clay' || s.door === 'claude' ? s.door : null,
      ...(s.go === 'wacht' ? { go: 'wacht' } : {}),
      ...(lagen.length ? { lagen } : {}),
    };
    if (trackIds && !trackIds.has(stap.track)) fouten.push(`stap ${i + 1}: nummer ${stap.track} staat niet in de library`);
    stappen.push(stap);
  });
  return {
    plan: {
      versie: PLAN_VERSIE,
      naam: tekst(d.naam, 120) || 'plan',
      door: tekst(d.door, 120),
      uitleg: tekst(d.uitleg, 2000),
      ...(tracks ? { tracks } : {}),
      stappen,
    },
    fouten,
  };
}

// ---- bewerkingen: (plan, bewerking) → nieuw plan (het oude blijft: ongedaan maken) ----

const kopie = (plan) => ({ ...plan, stappen: plan.stappen.map((s) => ({ ...s })) });
const plek = (plan, id) => plan.stappen.findIndex((s) => s.id === id);

/**
 * Eén bewerking. Onbekende id of soort: het plan blijft zoals het was.
 *   { soort: 'zet', id, velden: { van, speelduur, overgang, lengte, waarom, notitie, track } }
 *   { soort: 'verplaats', id, naar }      naar = nieuwe index (0..n-1)
 *   { soort: 'weg', id }
 *   { soort: 'erbij', stap, na }          na = id (null = vooraan; ontbreekt = achteraan)
 * `door` (standaard 'clay') wordt op de gewijzigde stap gezet.
 */
export function bewerk(plan, b, { door = 'clay' } = {}) {
  const p = kopie(plan);
  const i = b?.id !== undefined ? plek(p, b.id) : -1;
  switch (b?.soort) {
    case 'zet': {
      if (i < 0) return plan;
      const s = { ...p.stappen[i], ...pak(b.velden || {}), door };
      const { plan: n } = normaliseerPlan({ ...p, stappen: [s] });
      if (!n.stappen.length) return plan;
      p.stappen[i] = { ...n.stappen[0], id: s.id };
      return p;
    }
    case 'verplaats': {
      if (i < 0 || !Number.isInteger(b.naar)) return plan;
      const [s] = p.stappen.splice(i, 1);
      p.stappen.splice(klem(b.naar, 0, p.stappen.length), 0, s);
      return p;
    }
    case 'tracks': {
      // { soort: 'tracks', tracks: { auto: [..] } | null }: de tracks van de automaat (null = weg).
      const { plan: n } = normaliseerPlan({ ...p, tracks: b.tracks ?? undefined });
      return n;
    }
    case 'weg':
      if (i < 0) return plan;
      p.stappen.splice(i, 1);
      return p;
    case 'erbij': {
      const bezet = new Set(p.stappen.map((s) => s.id));
      const { plan: n } = normaliseerPlan({ stappen: [{ ...b.stap, id: undefined }] });
      if (!n.stappen.length) return plan;
      const s = { ...n.stappen[0], id: verseId(bezet), door };
      const na = b.na === undefined ? p.stappen.length - 1 : b.na === null ? -1 : plek(p, b.na);
      p.stappen.splice(na + 1, 0, s);
      return p;
    }
    default:
      return plan;
  }
}

/** De velden van een stap die bewerkt mogen worden (en die `verschil` vergelijkt). */
const BEWERKBAAR = ['track', 'van', 'in', 'speelduur', 'uit', 'overgang', 'lengte', 'waarom', 'notitie', 'go', 'lagen'];

/** Alleen de velden die een bewerking mag zetten (in/uit: null = weg). */
function pak(v) {
  const uit = {};
  for (const k of BEWERKBAAR) if (k in v) uit[k] = v[k];
  return uit;
}

/**
 * Wat er verschilt tussen twee plannen, per stap-id: voor "Claude wijzigde het
 * plan" en om te zien of een lopende stap geraakt wordt.
 * @returns { erbij: [id], weg: [id], anders: [{ id, velden: [naam] }], volgorde: bool }
 */
export function verschil(oud, nieuw) {
  const o = new Map(oud.stappen.map((s) => [s.id, s]));
  const n = new Map(nieuw.stappen.map((s) => [s.id, s]));
  const anders = [];
  for (const [id, s] of n) {
    const t = o.get(id);
    if (!t) continue;
    const v = BEWERKBAAR.filter((k) => JSON.stringify(s[k] ?? null) !== JSON.stringify(t[k] ?? null));
    if (v.length) anders.push({ id, velden: v });
  }
  const gedeeld = (l, m) => l.stappen.map((s) => s.id).filter((id) => m.has(id));
  return {
    erbij: [...n.keys()].filter((id) => !o.has(id)),
    weg: [...o.keys()].filter((id) => !n.has(id)),
    anders,
    volgorde: gedeeld(oud, n).join() !== gedeeld(nieuw, o).join(),
    tracks: JSON.stringify(oud.tracks ?? null) !== JSON.stringify(nieuw.tracks ?? null),
  };
}

/**
 * In/uit terugzetten die een schrijver weggooide omdat hij ze niet kent: een
 * planvenster van vóór de secties dat nog open stond tijdens een update. Zijn
 * normaliseerPlan gooit in/uit weg bij de stap die hij BEWERKT; de andere
 * stappen houden ze (hij kopieert ze ongezien). De server roept dit aan bij
 * elke opslag. Wie de velden kent zegt dat (`kent: ['in', 'uit']`; het
 * planvenster en Claude doen dat altijd) en dan gebeurt hier niets.
 *
 * Zonder `kent` alleen terug op een stap die:
 *   - in de payload een EIGEN id had (geen nieuw plan zonder ids, geen id die
 *     normaliseerPlan gaf: dat is een nieuwe stap);
 *   - in de payload GEEN in- of uit-sleutel heeft (ook niet null of rommel):
 *     wie er een schrijft, kent ze, en wat hij schreef is zijn keuze;
 *   - er nu staat met hetzelfde nummer en hetzelfde begin (`van`): een ander
 *     begin is een ander inmixpunt, en een uit kan dan vóór het begin liggen.
 * Gemeld wordt alleen wat het normaliseren overleeft.
 *
 * @param nu     het plan zoals het nu bewaard is (genormaliseerd)
 * @param ruw    wat de schrijver stuurde (de payload, niet genormaliseerd)
 * @param nieuw  normaliseerPlan(ruw).plan
 * @returns { plan, hersteld: [tekst] }
 */
export function herstelSecties(nu, ruw, nieuw, { kent = [] } = {}) {
  return herstelVelden(nu, ruw, nieuw, { kent });
}

/**
 * Groepen velden die een oude schrijver kan weggooien, met de voorwaarde om ze terug te zetten
 * (herstelSecties hierboven: in/uit; 14 okt ook go en lagen, PLAN-SET.md §5). Wie één veld van
 * een groep in de payload zet, kent de groep. In/uit horen bij het begin (`van`); go en lagen
 * alleen bij het nummer.
 */
const GROEPEN = [
  { velden: SECTIE_VELDEN, zelfde: (o, s) => o.track === s.track && o.van === s.van },
  { velden: ['go'], zelfde: (o, s) => o.track === s.track },
  { velden: ['lagen'], zelfde: (o, s) => o.track === s.track },
];

/**
 * Zoals herstelSecties, voor alle optionele velden die een schrijver niet in `kent` noemt: in/uit,
 * go, lagen (per stap) en `tracks` (per plan: terug als de payload geen `tracks`-sleutel had).
 */
export function herstelVelden(nu, ruw, nieuw, { kent = [] } = {}) {
  const geen = { plan: nieuw, hersteld: [] };
  if (!nu || !nieuw || !ruw || typeof ruw !== 'object') return geen;
  const hersteld = [];
  let plan = nieuw;
  // Per plan: de tracks van de automaat.
  if (!kent.includes('tracks') && !('tracks' in ruw) && nu.tracks && !nieuw.tracks) {
    plan = normaliseerPlan({ ...plan, tracks: nu.tracks }).plan;
    if (plan.tracks) hersteld.push('tracks van de automaat bewaard (opgeslagen door een venster dat ze niet kent: herlaad dat venster)');
  }
  const groepen = GROEPEN.map((g) => ({ ...g, velden: g.velden.filter((k) => !kent.includes(k)) })).filter((g) => g.velden.length);
  if (!groepen.length || !nu.stappen?.length || !plan.stappen?.length || !Array.isArray(ruw.stappen)) return { plan, hersteld };
  // Payload en plan naast elkaar: normaliseerPlan houdt de bruikbare stappen, in volgorde.
  const bron = ruw.stappen.slice(0, MAX_STAPPEN).filter(bruikbaar);
  if (bron.length !== plan.stappen.length) return { plan, hersteld };
  const oud = new Map(nu.stappen.map((s) => [s.id, s]));
  const gezet = new Map();                 // id → velden die terugkwamen
  const stappen = plan.stappen.map((s, i) => {
    const r = bron[i];
    const o = oud.get(s.id);
    if (r.id !== s.id || !o) return s;
    const terug = [];
    for (const g of groepen) {
      if (GROEPEN.find((x) => x.velden.includes(g.velden[0])).velden.some((k) => k in r) || !g.zelfde(o, s)) continue;
      for (const k of g.velden) if (o[k] && !s[k]) terug.push(k);
    }
    if (!terug.length) return s;
    gezet.set(s.id, terug);
    return { ...s, ...Object.fromEntries(terug.map((k) => [k, o[k]])) };
  });
  if (!gezet.size) return { plan, hersteld };
  plan = normaliseerPlan({ ...plan, stappen }).plan;
  for (const s of plan.stappen) {
    const terug = (gezet.get(s.id) || []).filter((k) => JSON.stringify(s[k] ?? null) === JSON.stringify(oud.get(s.id)[k]));
    if (terug.length) hersteld.push(`stap ${s.id}: ${terug.join(' en ')} bewaard (opgeslagen door een venster dat ze niet kent: herlaad dat venster)`);
  }
  return { plan, hersteld };
}
