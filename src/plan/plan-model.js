/**
 * De programmering (het setplan) als data: het formaat, de controle en de
 * bewerkingen. Puur: geen DOM, geen engine, geen fetch. Gedeeld door de
 * planpagina (plan.html), de automaat, de server en de tests. docs/PLAN.md.
 *
 * Versie 2 (30 sep 2026). Versie 1 (het eerste auto-plan) is een deel ervan en
 * wordt vanzelf omgezet:
 *
 *   { versie: 2, naam, door, uitleg,
 *     stappen: [{ id, track, van, speelduur, overgang, lengte, waarom, notitie, door }] }
 *
 *   id         vast en uniek ("s1", …): zo vindt de automaat terug waar hij is,
 *              ook als het plan tijdens het spelen verandert
 *   van        beginpunt in TRACKtijd (s); null = de app kiest (fragment())
 *   speelduur  seconden; null = de app kiest (heel nummer, of 6 min bij een mix)
 *   overgang   de overgang NAAR deze stap: auto | blend | filter | ambient.
 *              De bewakers van de planner gaan voor: dit is een wens.
 *   lengte     lengte van die overgang: { maten } of { sec }; null = standaard
 *   door       wie de stap (het laatst) zette: 'clay' | 'claude' | null
 *
 * Tijd in tracktijd en seconden, niet in maten: een maatnummer verschuift als
 * het grid bewerkt wordt, en de meeste grids in Clay's library zijn onzeker.
 */

export const PLAN_VERSIE = 2;
export const SOORTEN = ['auto', 'blend', 'filter', 'ambient'];
/** Grenzen voor een eigen overgangslengte. */
export const LENGTE = { maten: [4, 64], sec: [4, 120] };
export const MAX_STAPPEN = 200;
const MAX_TEKST = 500;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const tekst = (s, max = MAX_TEKST) => (typeof s === 'string' ? s.slice(0, max) : '');
const klem = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Een lengte netjes maken, of null. */
export function normaliseerLengte(l) {
  if (!l || typeof l !== 'object') return null;
  if (eindig(l.maten)) return { maten: Math.round(klem(l.maten, ...LENGTE.maten)) };
  if (eindig(l.sec)) return { sec: Math.round(klem(l.sec, ...LENGTE.sec) * 10) / 10 };
  return null;
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
  const bezet = new Set();
  const stappen = [];
  ruw.slice(0, MAX_STAPPEN).forEach((s, i) => {
    if (!s || typeof s !== 'object' || typeof s.track !== 'string' || !s.track) {
      fouten.push(`stap ${i + 1}: geen nummer`);
      return;
    }
    let id = typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && !bezet.has(s.id) ? s.id : null;
    if (!id) id = nieuweId(bezet);
    bezet.add(id);
    const overgang = SOORTEN.includes(s.overgang) ? s.overgang : 'auto';
    if (s.overgang !== undefined && s.overgang !== overgang) fouten.push(`stap ${i + 1}: onbekende overgang "${s.overgang}", auto`);
    const stap = {
      id, track: s.track.slice(0, 200),
      van: eindig(s.van) && s.van >= 0 ? s.van : null,
      speelduur: eindig(s.speelduur) && s.speelduur > 0 ? klem(s.speelduur, 5, 4 * 3600) : null,
      overgang,
      lengte: normaliseerLengte(s.lengte),
      waarom: tekst(s.waarom),
      notitie: tekst(s.notitie),
      door: s.door === 'clay' || s.door === 'claude' ? s.door : null,
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

/** Alleen de velden die een bewerking mag zetten. */
function pak(v) {
  const uit = {};
  for (const k of ['track', 'van', 'speelduur', 'overgang', 'lengte', 'waarom', 'notitie']) if (k in v) uit[k] = v[k];
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
  const velden = ['track', 'van', 'speelduur', 'overgang', 'lengte', 'waarom', 'notitie'];
  const anders = [];
  for (const [id, s] of n) {
    const t = o.get(id);
    if (!t) continue;
    const v = velden.filter((k) => JSON.stringify(s[k]) !== JSON.stringify(t[k]));
    if (v.length) anders.push({ id, velden: v });
  }
  const gedeeld = (l, m) => l.stappen.map((s) => s.id).filter((id) => m.has(id));
  return {
    erbij: [...n.keys()].filter((id) => !o.has(id)),
    weg: [...o.keys()].filter((id) => !n.has(id)),
    anders,
    volgorde: gedeeld(oud, n).join() !== gedeeld(nieuw, o).join(),
  };
}
