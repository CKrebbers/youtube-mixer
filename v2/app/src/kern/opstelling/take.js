/**
 * Een TAKE: een stuk dat je speelde, vastgelegd als automation. Puur: alleen data en rekenwerk; de
 * engine (acties-opstelling.js) neemt op en speelt af.
 *
 *   take = { schema: 1, id, naam, recept, zaad, maten, gemaakt,
 *            loop: null | { van: maat },     // je nam op terwijl hij liep: vanaf die maat van het verloop
 *            acties: [{ tel, id, v }] }      // tel = tellen vanaf de eerste maat van de take
 *
 * Met recept en zaad komt de opstelling precies terug (realiseer is herhaalbaar), en met `loop` ook
 * het verloop; de acties zijn wat JIJ deed (gebaren, macro's, varianten, drums, noten, de strip).
 */

export const SCHEMA = 1;
/** Waarde-acties (knoppen, gebaren) hooguit één per zoveel tellen, behalve de uitersten en het eindpunt. */
export const DUN_TEL = 1 / 16;
/** Wat een take vastlegt (op begin van de id); de rest (laden, herrollen, recepten kiezen) verandert de opstelling zelf. */
export const VAST_TE_LEGGEN = Object.freeze([
  'opstelling.macro.', 'opstelling.scene.', 'opstelling.glij.', 'opstelling.b.', 'opstelling.morph', 'opstelling.variant.',
  'opstelling.rij.', 'opstelling.stop.', 'gebaar.', 'speel.', 'korrel.veld.', 'korrel.vang', 'track.', 'mixer.', 'video.',
  'send.', 'sampler.',
]);
export const legtVast = (id) => typeof id === 'string' && !/\.laad$/.test(id) && VAST_TE_LEGGEN.some((p) => id.startsWith(p));

/**
 * Uitdunnen: een draaiknop stuurt tientallen waarden per seconde. Per id hooguit één per DUN_TEL tel,
 * maar het eindpunt van elke beweging en elke 0/1 (een gebaar dat begint of loslaat) blijven altijd.
 */
export function dun(acties) {
  const uit = [];
  const laatst = new Map();   // id -> index in uit
  for (let i = 0; i < acties.length; i++) {
    const a = acties[i];
    if (typeof a.v !== 'number') { uit.push(a); laatst.delete(a.id); continue; }
    const j = laatst.get(a.id);
    const vorige = j === undefined ? null : uit[j];
    const uiterste = a.v === 0 || a.v === 1;
    if (vorige && !uiterste && a.tel - vorige.tel < DUN_TEL && vorige.v !== 0 && vorige.v !== 1) uit[j] = { ...a, tel: vorige.tel, eind: a };
    else { laatst.set(a.id, uit.length); uit.push(a); }
  }
  // Wat samengevoegd is, eindigt op zijn laatste waarde en tijd (het eindpunt van de beweging).
  return uit.map((a) => (a.eind ? { tel: a.eind.tel, id: a.id, v: a.eind.v } : a)).sort((x, y) => x.tel - y.tel);
}

export function normaliseerTake(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[\w-]{1,80}$/.test(x.id)) return null;
  const acties = (Array.isArray(x.acties) ? x.acties : [])
    .filter((a) => a && Number.isFinite(a.tel) && a.tel >= 0 && legtVast(a.id) && (typeof a.v === 'boolean' || Number.isFinite(a.v)))
    .map((a) => ({ tel: a.tel, id: a.id, v: typeof a.v === 'number' ? Math.min(1, Math.max(0, a.v)) : a.v }))
    .sort((a, b) => a.tel - b.tel);
  const maten = Math.max(1, Math.min(512, Math.round(x.maten) || 1));
  return {
    schema: SCHEMA, id: x.id, naam: typeof x.naam === 'string' ? x.naam.slice(0, 40) : x.id,
    recept: typeof x.recept === 'string' ? x.recept : null, zaad: Number.isFinite(x.zaad) ? x.zaad : null, maten,
    gemaakt: Number.isFinite(x.gemaakt) ? x.gemaakt : 0,
    loop: x.loop && Number.isFinite(x.loop.van) ? { van: Math.max(0, Math.round(x.loop.van)) } : null,
    acties,
  };
}

/**
 * Wat er aan het eind van een take nog "aan" staat (een gebaar of trigger die je vasthield toen hij
 * ophield): die laat de engine los, zodat er nooit iets blijft hangen. [[id, waarde-om-los-te-laten]].
 */
export function nogVast(acties) {
  const stand = new Map();
  for (const a of acties) stand.set(a.id, a.v);
  const uit = [];
  for (const [id, v] of stand) {
    if (v === true) uit.push([id, false]);
    else if (typeof v === 'number' && v > 0 && /^(gebaar\.|speel\.|korrel\.veld\.)/.test(id)) uit.push([id, 0]);
  }
  return uit;
}
