import { resolveLink } from '../engine/rack.js';

/**
 * Superknoppen (14 okt, werkruimte S4, docs/werkruimte/S4.md; ontwerp A8, B3).
 *
 * Eén knop die veel beweegt: echo, galm, filter en beeld tegelijk, elk met zijn
 * eigen bereik en curve. Een link heeft PRECIES de velden van een link van een
 * rack-macro (`in`, `from`, `to`, `curve`, `steps`, src/engine/rack.js), plus
 * `target` = een value-action op de bus (geen parameter in een keten) en,
 * optioneel, `glide: true` (via de bestaande `<target>.glide`-action als die er
 * is). De rekenregel is resolveLink: één regel voor een rack-knop en een
 * superknop, nooit een tweede formule.
 *
 * Puur: geen DOM, geen bus, geen engine. acties-combi.js voert uit wat dit
 * uitrekent (de kinderen gaan als gewone invokes over de bus, dus in het log).
 */

export const MAX_SUPER = 16;
export const MAX_LINKS = 32;
const LINK_VELDEN = ['target', 'in', 'from', 'to', 'curve', 'steps', 'glide'];

/**
 * Een superknop zoals hij in een werkruimte staat, gecontroleerd. Wat niet
 * klopt gaat naar `fouten` en wordt overgeslagen, niet geraden.
 * `{ naam?, links: [{ target, in?, from?, to?, curve?, steps?, glide? }] }`
 */
export function normaliseerSuper(def) {
  const fouten = [];
  const links = [];
  if (!def || typeof def !== 'object' || !Array.isArray(def.links)) {
    return { superknop: { naam: null, links }, fouten: ['superknop: "links" ontbreekt of is geen lijst'] };
  }
  def.links.forEach((l, i) => {
    if (links.length >= MAX_LINKS) { if (i === MAX_LINKS) fouten.push(`superknop: hooguit ${MAX_LINKS} links, de rest overgeslagen`); return; }
    if (!l || typeof l.target !== 'string' || !/^[\w.{}-]+$/.test(l.target)) { fouten.push(`link ${i}: "target" (een action) ontbreekt`); return; }
    if (/^super\./.test(l.target)) { fouten.push(`link ${i}: een superknop stuurt geen superknop (${l.target})`); return; }
    const link = { target: l.target };
    if (Array.isArray(l.in) && l.in.length === 2 && l.in.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) link.in = [l.in[0], l.in[1]];
    else if (l.in !== undefined) fouten.push(`link ${i}: "in" is [van, tot] binnen 0..1, genegeerd`);
    for (const k of ['from', 'to']) {
      if (typeof l[k] === 'number' && l[k] >= 0 && l[k] <= 1) link[k] = l[k];
      else if (l[k] !== undefined) fouten.push(`link ${i}: "${k}" is een getal 0..1, genegeerd`);
    }
    if (typeof l.curve === 'string') link.curve = l.curve;
    if (typeof l.steps === 'number' && l.steps > 1) link.steps = Math.round(l.steps);
    if (l.glide === true) link.glide = true;
    const vreemd = Object.keys(l).filter((k) => !LINK_VELDEN.includes(k));
    if (vreemd.length) fouten.push(`link ${i}: onbekend veld ${vreemd.join(', ')} (genegeerd)`);
    links.push(link);
  });
  const naam = typeof def.naam === 'string' ? def.naam.slice(0, 40) : null;
  return { superknop: { naam, links }, fouten };
}

/** Wat elke link wordt bij deze stand van de superknop: dezelfde rekenregel als een rack-knop. */
export function linkWaarden(stand, links) {
  return links.map((l) => resolveLink(stand, l));
}

/**
 * Morph (ontwerp A8): "leg vast A" / "leg vast B". De stand van NU van elke link
 * wordt `from` (A) of `to` (B); dan schuift de superknop tussen twee
 * momentopnamen. `lees(target)` = de read van de bus (0..1 of null: dan blijft
 * die link zoals hij was). Geeft nieuwe links (de oude blijven onaangeroerd).
 */
export function legVast(links, kant, lees) {
  const veld = kant === 'B' ? 'to' : 'from';
  return links.map((l) => {
    const v = lees(l.target);
    return typeof v === 'number' && Number.isFinite(v) ? { ...l, [veld]: Math.min(1, Math.max(0, v)) } : { ...l };
  });
}

/** Een link als data (de velden van een rack-link, in vaste volgorde). */
export function linkNaarJSON(l) {
  const o = { target: l.target };
  for (const k of LINK_VELDEN.slice(1)) if (l[k] !== undefined) o[k] = Array.isArray(l[k]) ? [...l[k]] : l[k];
  return o;
}
