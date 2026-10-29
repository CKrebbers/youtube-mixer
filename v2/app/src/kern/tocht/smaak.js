/**
 * Smaak: wat je mooi vindt, afgeleid uit wat je DOET, niet uit wat je zegt. Een opstelling heeft
 * kenmerken (rack:Getij, inst:fm, patroon:bas, ladder:dorisch, vorm:gs, recept:klokwerk, …). Bewaren,
 * lang laten spelen en terughalen tellen op; snel wegrollen telt een beetje af. Kiezen (rack,
 * instrument, vorm, spoorsoort) gebeurt daarna GEWOGEN: wat je vaker koos komt vaker terug, maar
 * er blijft altijd ruimte voor iets nieuws (VERKEN), anders ontdek je niets meer.
 *
 *   smaak = { schema: 1, kenmerken: { 'rack:Getij': 4.5, … }, keren: n }
 * Puur: alles geeft een nieuw object terug.
 */

export const SCHEMA = 1;
/** Hoeveel gewicht een gebeurtenis geeft. */
export const BELONING = Object.freeze({ bewaar: 3, terug: 1, gespeeld: 0.25, weggerold: -0.4, gekozen: 0.5 });
/** Hooguit dit gewicht per kenmerk; onder nul telt als nul (afkeer wordt nooit een verbod). */
export const MAX = 20;
/** Deel van de keuzes dat zuiver verkent (zonder smaak). */
export const VERKEN = 0.25;

export const leegSmaak = () => ({ schema: SCHEMA, kenmerken: {}, keren: 0 });

export function normaliseerSmaak(x) {
  const uit = leegSmaak();
  if (!x || typeof x !== 'object') return uit;
  for (const [k, v] of Object.entries(x.kenmerken ?? {})) if (typeof k === 'string' && k.length <= 80 && Number.isFinite(v)) uit.kenmerken[k] = Math.max(-MAX, Math.min(MAX, v));
  uit.keren = Number.isFinite(x.keren) ? x.keren : 0;
  return uit;
}

/** De kenmerken van een opstelling (realiseer.js). */
export function kenmerkenVan(o) {
  if (!o) return [];
  const k = new Set([`recept:${o.recept}`]);
  if (o.toon?.ladder) k.add(`ladder:${o.toon.ladder}`);
  for (const s of o.sporen ?? []) {
    if (s.rack) k.add(`rack:${s.rack.naam}`);
    if (s.instrument) k.add(`inst:${s.instrument}`);
    if (s.nummer) k.add(`nummer:${s.nummer.id}`);
    k.add(`spoor:${s.soort === 'nummer' ? 'nummer' : s.instrument}`);
  }
  for (const p of o.patronen ?? []) k.add(`patroon:${p.uitleg.startsWith('kick') ? 'drums' : p.uitleg.split(' ')[0]}`);
  for (const v of o.beeld?.lagen ?? []) k.add(`vorm:${v}`);
  return [...k];
}

/** Gewicht toevoegen aan alle kenmerken (een nieuwe smaak). */
export function beloon(smaak, kenmerken, gewicht) {
  const uit = { ...smaak, kenmerken: { ...smaak.kenmerken }, keren: (smaak.keren ?? 0) + 1 };
  for (const k of kenmerken) uit.kenmerken[k] = Math.max(-MAX, Math.min(MAX, (uit.kenmerken[k] ?? 0) + gewicht));
  return uit;
}

/** Het gewicht waarmee iets gekozen wordt: 1 + wat je ervan vindt (nooit onder 0,2). */
export const gewichtVan = (smaak, kenmerk) => Math.max(0.2, 1 + Math.max(-0.8, (smaak?.kenmerken?.[kenmerk] ?? 0) * 0.5));

/**
 * Kies uit `lijst` met de smaak: met kans VERKEN een gewone trekking, anders gewogen.
 * `kenmerkVan(x)` -> de sleutel ('rack:' + x). `r` = een stroom uit kern/opstelling/zaad.js.
 */
export function kiesMetSmaak(r, lijst, smaak, kenmerkVan) {
  if (!lijst?.length) return null;
  if (!smaak || !Object.keys(smaak.kenmerken ?? {}).length || r.kans(VERKEN)) return r.kies(lijst);
  const w = lijst.map((x) => gewichtVan(smaak, kenmerkVan(x)));
  let t = r.r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lijst.length; i++) { t -= w[i]; if (t <= 0) return lijst[i]; }
  return lijst[lijst.length - 1];
}

/** De top van wat je mooi vindt: [[kenmerk, gewicht], …], per soort of alles. */
export function top(smaak, n = 8, soort = null) {
  return Object.entries(smaak?.kenmerken ?? {})
    .filter(([k, v]) => v > 0 && (!soort || k.startsWith(`${soort}:`)))
    .sort((a, b) => b[1] - a[1]).slice(0, n);
}
