/**
 * Patronen naar Logic (en terug): een set of één patroon als Standard MIDI File, type 1,
 * 384 ticks per tel. Puur: dezelfde invoer, dezelfde bytes; geen DOM, geen fs, geen server.
 *
 * Herkomst: v1 youtube-mixer/src/export/patronen-smf.js @ 6a640ac (docs/PATRONEN.md §8). De regels
 * S1–S13 en L1–L3 zijn ongewijzigd en de bytes ook (de gouden bestanden van v1 komen er precies
 * zo uit, test/patronen-midi.test.mjs). Wat anders is in v2:
 *   - de set is een lijst met (track, plek) per patroon (src/kern/patronen/model.js); plekken
 *     gaan tot PLEK_MAX, niet tot 5;
 *   - het kanaal (drums op 10) komt uit `instrumenten` (de soort per track, van de engine) of
 *     uit de hint in de set;
 *   - L4 (oogst produceren-052): kloppen de noten in een spoor niet met wat zijn `varve:patroon`
 *     zou schrijven (in Logic bewerkt, de meta oud), dan winnen de NOTEN, gelezen met het raster
 *     van de meta. In v1 kwam dan stilletjes de oude versie terug.
 *
 * Het bestand:
 *   spoor 0   de tempotrack: naam van de set, tempo, 4/4 (en eventueel `varve:context {...}`)
 *   spoor 1.. één per gevuld patroon met een plek (track 1..8, dan plek), met als naam
 *             "T<track> P<plek> <naam> (<instrument>)", de noten van de eerste `omlopen`
 *             omlopen, en (standaard) het patroon zelf als tekst `varve:patroon {...}`.
 */
import { notenInVenster, omloopTicks, swingTicks, PPQN } from './patronen/venster.js';
import { normaliseerPatroon, normaliseerSet, kernVan, TRACKS, PLEK_MAX, TEMPO } from './patronen/model.js';
import { ascii, leesSmf, maatsoortMeta, meta, mtrk, smf, tempoMeta } from './smf.js';

/** Kanaal van een drums-track (1..16, zoals elke DAW het noemt; status 0x99/0x89). */
export const DRUM_KANAAL = 10;
/** Noot 44..51: de sample-pads van de drumcomputer. Nooit vertalen. */
export const SAMPLE_PADS = [44, 51];
/** Voorvoegsel van de tekst-meta (FF 01) met het patroon als JSON. */
export const META = 'varve:patroon ';
/** Voorvoegsel van de tekst-meta (FF 01) op de tempotrack met de context. */
export const CONTEXT = 'varve:context ';
/** Hooguit zoveel bytes in de context-meta (voorvoegsel meegeteld). */
export const MAX_CONTEXT = 1024;
/** L4: zoveel omlopen probeert de controle hooguit (een bestand met meer leest gewoon de noten). */
const MAX_OMLOPEN_CONTROLE = 64;

/** JSON met alleen ASCII: alles vanaf U+0080 als \uXXXX. JSON.parse maakt er weer dezelfde tekst van. */
export const jsonAscii = (x) => JSON.stringify(x).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/**
 * S1 — het venster: precies de eerste `omlopen` omlopen zoals de speler ze vanaf een verse start
 * speelt (basis = start = tick 0).
 */
export function klinkendeNoten(p, omlopen = 1) {
  if (!Number.isInteger(omlopen) || omlopen < 1) throw new RangeError(`omlopen ${omlopen}: een geheel getal ≥ 1`);
  return notenInVenster(p, { basis: 0 }, 0, (omlopen + 1) * omloopTicks(p)).filter((n) => n.omloop < omlopen);
}

/** De noten van één patroon als [{ noot, aan, uit, v }] in ticks, na S2–S5; gesorteerd op noot, dan aan. */
function notenAlsTicks(p, omlopen) {
  const per = new Map();
  for (const n of klinkendeNoten(p, omlopen)) {
    const aan = Math.round(n.tick);                                   // S2
    const uit = Math.max(aan + 1, Math.round(n.tick + n.duur));
    const v = Math.min(127, Math.max(1, Math.round(n.snelheid * 127)));   // S5
    per.set(n.noot * 1e9 + aan, { noot: n.noot, aan, uit, v });       // S3
  }
  const lijst = [...per.values()].sort((a, b) => a.noot - b.noot || a.aan - b.aan);
  // S4: zelfoverlap. Begint dezelfde noot opnieuw voordat hij uit is, dan gaat hij uit op de nieuwe aan.
  for (let i = 0; i + 1 < lijst.length; i++) {
    const a = lijst[i], b = lijst[i + 1];
    if (a.noot === b.noot && b.aan < a.uit) a.uit = b.aan;
  }
  return lijst;
}

/** Eén patroon als spoor (chunkbytes). */
function patroonSpoor(p, { naam, kanaal, omlopen, metMeta }) {
  const ch = kanaal - 1;
  // S7: op dezelfde tick eerst de spoornaam, dan de tekst-meta, dan noot-uit, dan noot-aan.
  const ev = [{ t: 0, orde: -2, b: meta(0x03, ascii(naam)) }];
  // S11: het patroon als tekst (de vorm van v1, zonder zijn plek), alleen ASCII.
  if (metMeta) ev.push({ t: 0, orde: -1, b: meta(0x01, ascii(META + jsonAscii(kernVan(normaliseerPatroon(p))))) });
  // S8: het spoor eindigt op het einde van de laatste omloop, of later als een noot nog klinkt.
  let eind = omlopen * omloopTicks(p);
  for (const n of notenAlsTicks(p, omlopen)) {
    ev.push({ t: n.aan, orde: 1, b: [0x90 | ch, n.noot, n.v] });
    ev.push({ t: n.uit, orde: 0, b: [0x80 | ch, n.noot, 0] });   // S5: noot-uit met velocity 0
    eind = Math.max(eind, n.uit);
  }
  return mtrk(ev, eind);                                          // S13: geen running status
}

/** S10: "T<track> P<plek>[ <naam>][ (<soort>)]". */
const spoorNaam = (nr, plek, p, soort) => `T${nr} P${plek}${p.naam ? ` ${p.naam}` : ''}${soort ? ` (${soort})` : ''}`;

const soortUit = (x) => (typeof x === 'string' ? x : typeof x?.soort === 'string' ? x.soort : null);

/**
 * Een set (of een deel ervan) als SMF type 1.
 *
 * @param set          een set (v2 of v1); eerst genormaliseerd zoals de speler hem leest
 * @param track        1..8: alleen patronen van die track (null = alle)
 * @param plek         1..PLEK_MAX: alleen die plek (null = alle)
 * @param omlopen      hoeveel keer het patroon (geheel getal ≥ 1)
 * @param bpm          tempo in het bestand (40..240); null = set.tempo
 * @param meta         false = zonder `varve:patroon`-tekst (alleen noten)
 * @param context      een object als `varve:context` op de tempotrack; null = geen
 * @param instrumenten { '1': 'drums' | { soort } }: wat er NU op de tracks staat (gaat voor de
 *                     hint in de set); bepaalt het kanaal (S6) en de spoornaam (S10)
 * @returns Uint8Array, of null als er niets gevuld is
 */
export function setNaarSmf(set, { track = null, plek = null, omlopen = 1, bpm = null, meta: metMeta = true, context = null, instrumenten = null } = {}) {
  if (!Number.isInteger(omlopen) || omlopen < 1) throw new RangeError(`omlopen ${omlopen}: een geheel getal ≥ 1`);
  if (bpm != null && !(Number.isFinite(bpm) && bpm >= TEMPO.min && bpm <= TEMPO.max)) {
    throw new RangeError(`bpm ${bpm} valt buiten ${TEMPO.min}..${TEMPO.max}`);
  }
  const s = normaliseerSet(set).set;

  // S12: track 1..8, dan plek; lege plekken en de bak overslaan.
  const sporen = [];
  for (let nr = 1; nr <= TRACKS; nr++) {
    if (track != null && nr !== track) continue;
    const soort = soortUit(instrumenten?.[String(nr)]) ?? s.instrumenten[String(nr)]?.soort ?? null;
    // S6: drums op kanaal 10, al het andere op kanaal 1. Geen GM-vertaling.
    const kanaal = soort === 'drums' ? DRUM_KANAAL : 1;
    for (const p of s.patronen) {
      if (p.track !== nr || !(p.plek >= 1 && p.plek <= PLEK_MAX)) continue;
      if (plek != null && p.plek !== plek) continue;
      if (!p.noten.length) continue;
      sporen.push(patroonSpoor(p, { naam: spoorNaam(nr, p.plek, p, soort), kanaal, omlopen, metMeta }));
    }
  }
  if (!sporen.length) return null;

  // S9: de tempotrack. Zonder context bytegewijs gelijk aan de gouden bytes.
  const tempoEv = [
    { t: 0, orde: -3, b: meta(0x03, ascii(s.naam)) },
    { t: 0, orde: -2, b: tempoMeta(bpm ?? s.tempo) },
    { t: 0, orde: -1, b: maatsoortMeta(4, 4) },
  ];
  if (context != null) {
    const tekst = CONTEXT + jsonAscii(context);
    if (tekst.length > MAX_CONTEXT) throw new RangeError(`context van ${tekst.length} bytes, hooguit ${MAX_CONTEXT}`);
    tempoEv.push({ t: 0, orde: 0, b: meta(0x01, ascii(tekst)) });
  }
  return smf([mtrk(tempoEv, 0), ...sporen], { type: 1, ppqn: PPQN });
}

const tekstUit = (data) => String.fromCharCode(...data);

/** De noten van een spoor als vingerafdruk: aan/uit, tick, noot, velocity (kanaal telt niet: S6 kiest het). */
const afdruk = (ev, schaal = 1) => ev.filter((e) => e.st === 0x80 || e.st === 0x90)
  .map((e) => (e.st === 0x90 && e.v > 0 ? `a${Math.round(e.t * schaal)}:${e.noot}:${e.v}` : `u${Math.round(e.t * schaal)}:${e.noot}`))
  .sort().join(',');

/** L4: zou dit patroon precies deze noten schrijven, voor een aantal omlopen? */
function klopt(patroon, ev, ppqn) {
  const inBestand = afdruk(ev, PPQN / ppqn);
  const eind = ev.reduce((m, e) => Math.max(m, e.t), 0) * (PPQN / ppqn);
  const L = omloopTicks(patroon);
  const tot = Math.min(MAX_OMLOPEN_CONTROLE, Math.max(1, Math.ceil(eind / L)));
  for (let k = 1; k <= tot; k++) {
    const verwacht = notenAlsTicks(patroon, k).flatMap((n) => [`a${n.aan}:${n.noot}:${n.v}`, `u${n.uit}:${n.noot}`]).sort().join(',');
    if (verwacht === inBestand) return { k };
  }
  return null;
}

/**
 * Een SMF terug naar patronen, één per spoor met noten of met `varve:patroon`.
 *
 * L1 — met meta: het patroon uit de tekst, door normaliseerPatroon. Verliesvrij. bron: 'meta'.
 * L2 — zonder meta (een bestand uit Logic, of `negeerMeta`): noot-aan en noot-uit per (kanaal,
 *      noot) koppelen, duur in stappen, snelheid = v/127. bron: 'noten', met 'benaderd' in `fouten`.
 * L3 — de stap: van k − 1, k, k + 1 die waarvan de micro NA de swing het kleinst is.
 * L4 — met meta, maar de noten in het spoor zijn niet wat dat patroon zou schrijven (bewerkt): de
 *      noten winnen, gelezen met het raster (lengte, deling, swing), id en naam van de meta.
 *      bron: 'noten', met 'bewerkt' in `fouten`.
 *
 * @returns [{ naam (spoornaam), patroon, bron: 'meta' | 'noten', fouten: string[] }]
 */
export function smfNaarPatronen(bytes, { lengte = 16, deling = 4, swing = 50, omlopen = 1, negeerMeta = false } = {}) {
  const { ppqn, sporen } = leesSmf(bytes);
  const uit = [];
  for (const ev of sporen) {
    const naamEv = ev.find((e) => e.meta === 0x03);
    const naam = naamEv ? tekstUit(naamEv.data) : '';
    const fouten = [];
    const metaEv = negeerMeta ? null : ev.find((e) => e.meta === 0x01 && tekstUit(e.data).startsWith(META));
    const noten = ev.filter((e) => e.st === 0x80 || e.st === 0x90);
    let raster = { lengte, deling, swing, omlopen, id: null, naam: '' };
    if (metaEv) {
      let ruw = null;
      try { ruw = JSON.parse(tekstUit(metaEv.data).slice(META.length)); } catch { fouten.push('varve:patroon is geen leesbare JSON; de noten gelezen'); }
      const patroon = ruw && typeof ruw === 'object' ? normaliseerPatroon(ruw, { fouten }) : null;
      if (patroon) {
        const k = noten.length ? klopt(patroon, ev, ppqn) : (patroon.noten.some((n) => n.stap < patroon.lengte) ? null : { k: 1 });
        if (k) { uit.push({ naam, patroon, bron: 'meta', fouten }); continue; }
        fouten.push('bewerkt: de noten wijken af van varve:patroon; de noten gelezen met het raster van de meta');
        const L = omloopTicks(patroon) * (ppqn / PPQN);
        const eind = ev.reduce((m, e) => Math.max(m, e.t), 0);
        raster = { lengte: patroon.lengte, deling: patroon.deling, swing: patroon.swing,
          omlopen: Math.max(1, Math.round(eind / L) || 1), id: patroon.id, naam: patroon.naam };
      } else if (ruw) fouten.push('varve:patroon is geen patroon; de noten gelezen');
    }
    // Een spoor zonder noten en zonder meta (de tempotrack) is geen patroon; een patroon
    // waarvan in Logic alle noten weg zijn wel (leeg, met het raster van de meta).
    if (!noten.length && !raster.id) continue;
    const patroon = uitNoten(noten, ev, { ppqn, ...raster, fouten });
    uit.push({ naam, patroon, bron: 'noten', fouten });
  }
  return uit;
}

/** L2/L3: noten zonder (bruikbare) meta naar een patroon; wat benaderd of weggelaten is komt in `fouten`. */
function uitNoten(noten, ev, { ppqn, lengte, deling, swing, omlopen, id, naam, fouten }) {
  fouten.push(`benaderd: stap met de kleinste micro na swing ${swing}`);
  const st = ppqn / deling;
  const open = new Map();
  const paren = [];
  for (const e of noten) {
    const sleutel = e.kanaal * 128 + e.noot;
    const a = open.get(sleutel);
    if (e.st === 0x90 && e.v > 0) {
      if (a) paren.push({ aan: a.t, uit: e.t, noot: e.noot, v: a.v });
      open.set(sleutel, e);
    } else if (a) {
      paren.push({ aan: a.t, uit: e.t, noot: e.noot, v: a.v });
      open.delete(sleutel);
    }
  }
  if (open.size) {
    const einde = ev.reduce((m, e) => Math.max(m, e.t), 0);
    for (const a of open.values()) paren.push({ aan: a.t, uit: Math.max(einde, a.t + 1), noot: a.noot, v: a.v });
    fouten.push(`${open.size} noot/noten zonder einde: tot het einde van het spoor`);
  }
  const res = [];
  let weg = 0;
  for (const n of paren.sort((a, b) => a.aan - b.aan || a.noot - b.noot)) {
    const k0 = Math.round(n.aan / st), maxK = omlopen * lengte - 1;
    if (k0 - 1 > maxK) { weg++; continue; }
    let best = null;
    for (let k = Math.max(0, k0 - 1); k <= Math.min(k0 + 1, maxK); k++) {
      const micro = (n.aan - k * st - swingTicks(k % lengte, swing, st)) / st;
      if (micro < -0.5 - 1e-9 || micro > 0.5 + 1e-9) continue;
      if (!best || Math.abs(micro) < Math.abs(best.micro) - 1e-12) best = { k, micro };
    }
    if (!best && k0 > maxK) { weg++; continue; }
    if (!best) {
      const k = Math.min(k0, maxK);
      best = { k, micro: Math.min(0.5, Math.max(-0.5, (n.aan - k * st - swingTicks(k % lengte, swing, st)) / st)) };
    }
    res.push({ stap: best.k % lengte, noot: n.noot, snelheid: n.v / 127, duur: (n.uit - n.aan) / st, micro: best.micro });
  }
  if (weg) fouten.push(`${weg} noot/noten na omloop ${omlopen} weggelaten`);
  return normaliseerPatroon({ ...(id ? { id } : {}), naam: naam ?? '', lengte, deling, swing, noten: res }, { fouten });
}
