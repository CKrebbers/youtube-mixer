import { normaliseerPlan } from '../plan/plan-model.js';
import { normaliseerSet as normaliseerPatronen } from '../engine/patronen/model.js';

/**
 * Een SET als geheel (spoor S9, docs/PLAN-SET.md §6): het plan, de patronen en de werkruimte, plus
 * optioneel een MOMENTOPNAME van de mixer. Puur: geen DOM, geen fetch; ook door de server gebruikt
 * (server/sets.js), zodat pagina en server nooit van mening verschillen over wat een set is.
 *
 *   { schema: 1, naam, uitleg, door, gemaakt,
 *     plan: <plan v2> | null,                     een KOPIE (plannen hebben hun eigen versies)
 *     patronen: { naam, set: <patronenset> } | null, een KOPIE, en de naam waar hij vandaan kwam
 *     werkruimte: '<naam>' | null,                OP NAAM (Clay's indeling dupliceer je niet per set)
 *     momentopname: <beginstand van het log> | null,
 *     samenvatting: { nummers, duur } }           de server zet hem bij het opslaan (voor de lijst)
 *
 * De momentopname is `leesStand()` van het handelingenlog (src/control/handelingen.js): welk nummer
 * op welke track (tracks.id, nooit audio), positie, cue, hotcues, loop, grid, kant, rack (herkomst),
 * kills, de waarden op de bus, de sampler-pads (alleen WAAR het stuk zit), patronen. Bij het
 * normaliseren gaat alles wat iets zou starten UIT: speelt en wacht op false, pads en patronen
 * stil. Terugladen start nooit iets.
 *
 * Een oud bestand (een nieuwere versie van dit formaat, of rommel) gooit nooit: wat niet klopt
 * valt weg met een fout.
 */

export const SET_SCHEMA = 1;
export const NAAM = /^[a-z0-9_-]{1,60}$/;
export const NAAM_UITLEG = 'een setnaam is kleine letters, cijfers, - en _ (hooguit 60)';
export const naamGeldig = (n) => typeof n === 'string' && NAAM.test(n);
/** Zo groot mag een momentopname hooguit zijn (bytes JSON): een stand van acht tracks is ~20–60 kB. */
export const MAX_MOMENT = 512 * 1024;
const WERKNAAM = /^[a-z0-9_-]{1,60}$/;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const tekst = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
const nr = (x) => (Number.isInteger(x) && x >= 1 && x <= 8 ? x : null);
const getal = (x, lo = -Infinity, hi = Infinity) => (eindig(x) ? Math.min(hi, Math.max(lo, x)) : null);
/** Een JSON-waarde die we niet zelf controleren (rack, grid, secties): klonen, of null als hij niet past. */
const json = (x, max = 128 * 1024) => {
  if (x == null) return null;
  try { const t = JSON.stringify(x); return t.length <= max ? JSON.parse(t) : null; } catch { return null; }
};

/** Eén track van een momentopname netjes maken, of null. Speelt en wacht altijd false. */
function normaliseerMomentTrack(t, fouten) {
  if (!t || typeof t !== 'object' || !nr(t.track)) { fouten.push('momentopname: een track zonder geldig nummer (weggelaten)'); return null; }
  const bron = ['library', 'demo', 'los', 'leeg'].includes(t.bron) ? t.bron : 'leeg';
  const uit = { track: t.track, bron };
  if (bron === 'library') {
    if (typeof t.nummer !== 'string' || !/^[\w-]{1,64}$/.test(t.nummer)) { fouten.push(`momentopname: track ${t.track} zonder geldig nummer (leeg)`); return { track: t.track, bron: 'leeg' }; }
    uit.nummer = t.nummer;
  }
  if (bron === 'demo') uit.demo = json(t.demo, 1024);
  if (bron === 'leeg') return uit;
  Object.assign(uit, {
    titel: tekst(t.titel, 200) || null,
    positie: getal(t.positie, 0) ?? 0, speelt: false, wacht: false,
    rate: getal(t.rate, 0.25, 4) ?? 1, bereik: eindig(t.bereik) ? t.bereik : null,
    keylock: t.keylock === true, toon: getal(t.toon, -24, 24) ?? 0,
    cue: getal(t.cue, 0) ?? 0,
    hotcues: Array.isArray(t.hotcues) ? t.hotcues.slice(0, 8).map((h) => (eindig(h) && h >= 0 ? h : null)) : [],
    loop: t.loop && eindig(t.loop.start) && eindig(t.loop.end) && t.loop.end > t.loop.start
      ? { start: t.loop.start, end: t.loop.end, tellen: eindig(t.loop.tellen) ? t.loop.tellen : null } : null,
    grid: json(t.grid), secties: 'secties' in t ? json(t.secties) : undefined,
    kant: ['A', 'B', 'thru'].includes(t.kant) ? t.kant : null,
    rack: json(t.rack),
    kill: t.kill && typeof t.kill === 'object' ? Object.fromEntries(['low', 'mid', 'high'].map((b) => [b, t.kill[b] === true])) : {},
    stemKill: t.stemKill && typeof t.stemKill === 'object'
      ? Object.fromEntries(Object.entries(t.stemKill).filter(([k]) => /^[a-z]{1,12}$/.test(k)).map(([k, v]) => [k, v === true])) : null,
    sprong: eindig(t.sprong) ? t.sprong : null,
  });
  if (uit.secties === undefined) delete uit.secties;
  return uit;
}

/**
 * Een momentopname (de beginstand van het log) netjes maken, of null. Niets start vanzelf: speelt
 * en wacht false, pads stil, geen spelende patronen.
 */
export function normaliseerMoment(m, fouten = []) {
  if (m == null) return null;
  if (typeof m !== 'object' || Array.isArray(m)) { fouten.push('momentopname is geen object (weggelaten)'); return null; }
  let grootte = 0;
  try { grootte = JSON.stringify(m).length; } catch { fouten.push('momentopname is geen JSON (weggelaten)'); return null; }
  if (grootte > MAX_MOMENT) { fouten.push(`momentopname te groot (${Math.round(grootte / 1024)} kB, hooguit ${MAX_MOMENT / 1024}): weggelaten`); return null; }
  const gezien = new Set();
  const tracks = [];
  for (const t of Array.isArray(m.tracks) ? m.tracks : []) {
    const n = normaliseerMomentTrack(t, fouten);
    if (!n || gezien.has(n.track)) continue;
    gezien.add(n.track);
    tracks.push(n);
  }
  const waarden = {};
  for (const [k, v] of Object.entries(m.waarden && typeof m.waarden === 'object' ? m.waarden : {})) {
    if (/^[\w.-]{1,80}$/.test(k) && eindig(v)) waarden[k] = Math.min(1, Math.max(0, v));
  }
  const rond = {};
  for (const [k, v] of Object.entries(m.rond && typeof m.rond === 'object' ? m.rond : {})) {
    if (/^[\w.-]{1,80}$/.test(k) && eindig(v)) rond[k] = v;
  }
  const pad = (p) => (p && typeof p === 'object' && nr(p.track) && eindig(p.van) && eindig(p.tot) && p.tot > p.van
    ? { track: p.track, van: p.van, tot: p.tot, bpm: eindig(p.bpm) ? p.bpm : null, tellen: eindig(p.tellen) ? p.tellen : null } : null);
  return {
    focus: nr(m.focus),
    tracks, waarden, rond,
    pads: (Array.isArray(m.pads) ? m.pads.slice(0, 8) : []).map((p) => { const x = pad(p); return x ? { ...x, speelt: false } : null; }),
    herinneringen: (Array.isArray(m.herinneringen) ? m.herinneringen.slice(0, 8) : []).map(pad),
    patronen: { speelt: [] },
  };
}

/**
 * Een set (van de server, van Claude, van een oud bestand) netjes maken. Gooit nooit.
 * @returns { set, fouten: [tekst] }
 */
export function normaliseerSet(invoer) {
  const fouten = [];
  const d = invoer && typeof invoer === 'object' && !Array.isArray(invoer) ? invoer : {};
  if (d !== invoer) fouten.push('geen set (geen object)');
  if (d.schema != null && d.schema !== SET_SCHEMA) fouten.push(`schema ${d.schema} ken ik niet: gelezen als schema ${SET_SCHEMA}`);
  let plan = null;
  if (d.plan != null) {
    const p = normaliseerPlan(d.plan);
    plan = p.plan;
    fouten.push(...p.fouten.map((f) => `plan: ${f}`));
  }
  let patronen = null;
  if (d.patronen != null) {
    if (typeof d.patronen !== 'object' || !d.patronen.set) fouten.push('patronen: geen { naam, set } (weggelaten)');
    else {
      const p = normaliseerPatronen(d.patronen.set);
      patronen = { naam: typeof d.patronen.naam === 'string' && /^[\w-]{1,60}$/.test(d.patronen.naam) ? d.patronen.naam : 'set', set: p.set };
      fouten.push(...p.fouten.map((f) => `patronen: ${f}`));
    }
  }
  let werkruimte = null;
  if (d.werkruimte != null) {
    if (typeof d.werkruimte === 'string' && WERKNAAM.test(d.werkruimte)) werkruimte = d.werkruimte;
    else fouten.push('werkruimte: geen geldige naam (weggelaten)');
  }
  const momentopname = normaliseerMoment(d.momentopname, fouten);
  const sam = d.samenvatting && typeof d.samenvatting === 'object' ? d.samenvatting : null;
  return {
    set: {
      schema: SET_SCHEMA,
      naam: tekst(d.naam, 60) || 'set',
      uitleg: tekst(d.uitleg, 2000),
      door: tekst(d.door, 120),
      gemaakt: typeof d.gemaakt === 'string' && !Number.isNaN(Date.parse(d.gemaakt)) ? d.gemaakt : null,
      plan, patronen, werkruimte, momentopname,
      samenvatting: {
        nummers: plan ? plan.stappen.length : 0,
        duur: sam && eindig(sam.duur) && sam.duur >= 0 ? Math.round(sam.duur) : null,
      },
    },
    fouten,
  };
}

/** De nummers (tracks.id) die een set nodig heeft: het plan, de lagen en de momentopname. Voor "ontbreekt". */
export function nummersVan(set) {
  const ids = new Set();
  for (const s of set?.plan?.stappen || []) {
    ids.add(s.track);
    for (const l of s.lagen || []) if (l.soort === 'nummer') ids.add(l.track);
  }
  for (const t of set?.momentopname?.tracks || []) if (t.bron === 'library' && t.nummer) ids.add(t.nummer);
  return [...ids];
}

/** Welke tracks van de momentopname over een SPELENDE track heen zouden gaan (voor de tweede druk). */
export function overSpelend(moment, speelt) {
  return (moment?.tracks || []).filter((t) => speelt(t.track)).map((t) => t.track);
}
