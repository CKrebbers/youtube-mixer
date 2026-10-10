/**
 * Patronen naar Logic (en terug): een set of één patroon als Standard MIDI
 * File, type 1, 384 ticks per tel (docs/PATRONEN.md §8). Puur: dezelfde
 * invoer, dezelfde bytes; geen DOM, geen fs, geen server.
 *
 * Staat bewust BUITEN src/engine/ (regel 1: de engine kent geen MIDI). Leest
 * het model en het venster van de patronen, schrijft met src/lib/smf.js.
 *
 * Elke regel hieronder (S1–S13, L1–L2) heeft een check in
 * test/patronen-midi.test.mjs.
 *
 * Het bestand:
 *   spoor 0   de tempotrack: naam van de set, tempo, 4/4 (en eventueel
 *             `varve:context {...}`: maatgever, padnamen)
 *   spoor 1.. één per gevuld patroon (track 1..8, plek 1..5), met als naam
 *             "T<track> P<plek> <naam> (<instrument>)", de noten van de eerste
 *             `omlopen` omlopen, en (standaard) het patroon zelf als tekst
 *             `varve:patroon {...}`, zodat het verliesvrij terugkomt.
 */
import { notenInVenster, omloopTicks, swingTicks, PPQN } from '../engine/patronen/venster.js';
import { normaliseerPatroon, normaliseerSet, PLEKKEN, TRACKS, TEMPO } from '../engine/patronen/model.js';
import { ascii, leesSmf, maatsoortMeta, meta, mtrk, smf, tempoMeta } from '../lib/smf.js';

/** Kanaal van een drums-track (1..16, zoals elke DAW het noemt; status 0x99/0x89). */
export const DRUM_KANAAL = 10;
/** Noot 44..51: de sample-pads van de drumcomputer (stukken uit een deck). Nooit vertalen (ook niet in een latere drumvertaling). */
export const SAMPLE_PADS = [44, 51];
/** Voorvoegsel van de tekst-meta (FF 01) met het patroon als JSON. */
export const META = 'varve:patroon ';
/** Voorvoegsel van de tekst-meta (FF 01) op de tempotrack met de context (maatgever, padnamen). */
export const CONTEXT = 'varve:context ';
/** Hooguit zoveel bytes in de context-meta (voorvoegsel meegeteld). */
export const MAX_CONTEXT = 1024;

/**
 * JSON met alleen ASCII: alles vanaf U+0080 als \uXXXX (ook de helften van
 * een surrogaatpaar). JSON.parse maakt er weer precies dezelfde tekst van.
 */
export const jsonAscii = (x) => JSON.stringify(x).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/**
 * S1 — het venster: precies de eerste `omlopen` omlopen zoals de speler ze
 * vanaf een verse start speelt (basis = start = tick 0). Een negatieve micro
 * op stap 0 van omloop 0 valt op tick 0; een noot die door swing of micro over
 * het einde schuift, blijft staan (hij hoort bij zijn eigen omloop).
 */
export function klinkendeNoten(p, omlopen = 1) {
  if (!Number.isInteger(omlopen) || omlopen < 1) throw new RangeError(`omlopen ${omlopen}: een geheel getal ≥ 1`);
  return notenInVenster(p, { basis: 0 }, 0, (omlopen + 1) * omloopTicks(p)).filter((n) => n.omloop < omlopen);
}

/** De noten van één patroon als [{ noot, aan, uit, v }] in ticks, na S2–S5; gesorteerd op noot, dan aan. */
function notenAlsTicks(p, omlopen) {
  const per = new Map();
  for (const n of klinkendeNoten(p, omlopen)) {
    // S2: aan afgerond, uit minstens één tick later.
    const aan = Math.round(n.tick);
    const uit = Math.max(aan + 1, Math.round(n.tick + n.duur));
    // S5: velocity 1..127 (een noot-aan met velocity 0 is een noot-uit).
    const v = Math.min(127, Math.max(1, Math.round(n.snelheid * 127)));
    // S3: dezelfde (noot, aan) twee keer: de laatste in tickvolgorde wint.
    per.set(n.noot * 1e9 + aan, { noot: n.noot, aan, uit, v });
  }
  const lijst = [...per.values()].sort((a, b) => a.noot - b.noot || a.aan - b.aan);
  // S4: zelfoverlap. Begint dezelfde noot opnieuw voordat hij uit is, dan gaat
  // hij uit op de nieuwe aan. (De speler laat het instrument dat oplossen; een
  // MIDI-bestand kan twee keer dezelfde noot tegelijk niet uitdrukken.)
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
  // S11: het patroon als tekst, alleen ASCII; ook noten voorbij de lengte gaan zo mee.
  if (metMeta) ev.push({ t: 0, orde: -1, b: meta(0x01, ascii(META + jsonAscii(normaliseerPatroon(p)))) });
  // S8: het spoor eindigt op het einde van de laatste omloop, of later als een noot nog klinkt.
  let eind = omlopen * omloopTicks(p);
  for (const n of notenAlsTicks(p, omlopen)) {
    ev.push({ t: n.aan, orde: 1, b: [0x90 | ch, n.noot, n.v] });
    ev.push({ t: n.uit, orde: 0, b: [0x80 | ch, n.noot, 0] });   // S5: noot-uit met velocity 0
    eind = Math.max(eind, n.uit);
  }
  // S13: mtrk schrijft elk kanaalbericht met zijn statusbyte (geen running status).
  return mtrk(ev, eind);
}

/** S10: "T<track> P<plek>[ <naam>][ (<soort>)]". */
const spoorNaam = (nr, plek, p, soort) => `T${nr} P${plek}${p.naam ? ` ${p.naam}` : ''}${soort ? ` (${soort})` : ''}`;

/**
 * Een set (of een deel ervan) als SMF type 1.
 *
 * @param set      een set zoals op de server (patronen/<naam>.json); wordt eerst
 *                 genormaliseerd zoals de speler hem leest
 * @param track    1..8: alleen patronen van die track (null = alle)
 * @param plek     1..5: alleen die plek (null = alle)
 * @param omlopen  hoeveel keer het patroon (geheel getal ≥ 1)
 * @param bpm      tempo in het bestand (40..240); null = set.tempo
 * @param meta     false = zonder `varve:patroon`-tekst (alleen noten)
 * @param context  een object (maatgever, padnamen, …) als `varve:context` op de
 *                 tempotrack; null = geen
 * @returns Uint8Array, of null als er niets gevuld is
 */
export function setNaarSmf(set, { track = null, plek = null, omlopen = 1, bpm = null, meta: metMeta = true, context = null } = {}) {
  if (!Number.isInteger(omlopen) || omlopen < 1) throw new RangeError(`omlopen ${omlopen}: een geheel getal ≥ 1`);
  if (bpm != null && !(Number.isFinite(bpm) && bpm >= TEMPO.min && bpm <= TEMPO.max)) {
    throw new RangeError(`bpm ${bpm} valt buiten ${TEMPO.min}..${TEMPO.max}`);
  }
  const s = normaliseerSet(set).set;

  // S12: track 1..8, plek 1..5; lege plekken overslaan.
  const sporen = [];
  for (let nr = 1; nr <= TRACKS; nr++) {
    if (track != null && nr !== track) continue;
    const soort = s.instrumenten[String(nr)]?.soort ?? null;
    // S6: drums op kanaal 10, al het andere op kanaal 1. Geen GM-vertaling: noot 36 blijft 36,
    // en 44..51 (SAMPLE_PADS) blijven altijd zichzelf.
    const kanaal = soort === 'drums' ? DRUM_KANAAL : 1;
    for (let k = 1; k <= PLEKKEN; k++) {
      if (plek != null && k !== plek) continue;
      const p = s.tracks[String(nr)][k - 1];
      if (!p || !p.noten.length) continue;
      sporen.push(patroonSpoor(p, { naam: spoorNaam(nr, k, p, soort), kanaal, omlopen, metMeta }));
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

/**
 * Een SMF terug naar patronen, één per spoor met noten of met `varve:patroon`.
 *
 * L1 — met meta: het patroon uit de tekst, door normaliseerPatroon. Verliesvrij
 *      (de rondreis in de test). bron: 'meta'.
 * L2 — zonder meta (een bestand uit Logic, of `negeerMeta`): noot-aan en noot-uit
 *      per (kanaal, noot) koppelen (noot-aan met velocity 0 = uit), duur in stappen,
 *      snelheid = v/127. bron: 'noten', met de melding 'benaderd' in `fouten`.
 * L3 — de stap: van de stappen rond de noot (k − 1, k, k + 1) die waarvan de micro
 *      NA de swing van het raster het kleinst is (binnen −0,5..0,5); bij gelijk de
 *      eerste. Zo valt een swing-75-noot niet op de volgende stap. Met het juiste
 *      raster (lengte, deling, swing) en |micro| klein genoeg is het bestand na opnieuw
 *      schrijven bytegewijs hetzelfde (test: 1000 patronen).
 *
 * @param lengte, deling, swing  het raster voor L2 (een bestand zonder meta zegt het niet)
 * @param omlopen  L2: noten op of na stap omlopen × lengte vallen weg (en staan in `fouten`)
 * @param negeerMeta  true = altijd L2 (bv. als het bestand in Logic bewerkt is en de
 *                    tekst-meta oud is)
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
    if (metaEv) {
      let ruw = null;
      try { ruw = JSON.parse(tekstUit(metaEv.data).slice(META.length)); } catch { fouten.push('varve:patroon is geen leesbare JSON; de noten gelezen'); }
      const patroon = ruw && typeof ruw === 'object' ? normaliseerPatroon(ruw, { fouten }) : null;
      if (patroon) { uit.push({ naam, patroon, bron: 'meta', fouten }); continue; }
      if (ruw) fouten.push('varve:patroon is geen patroon; de noten gelezen');
    }
    const noten = ev.filter((e) => e.st === 0x80 || e.st === 0x90);
    if (!noten.length) continue;
    const patroon = uitNoten(noten, ev, { ppqn, lengte, deling, swing, omlopen, fouten });
    uit.push({ naam, patroon, bron: 'noten', fouten });
  }
  return uit;
}

/** L2: noten zonder meta naar een patroon; wat benaderd of weggelaten is komt in `fouten`. */
function uitNoten(noten, ev, { ppqn, lengte, deling, swing, omlopen, fouten }) {
  fouten.push(`benaderd: stap met de kleinste micro na swing ${swing}`);
  const st = ppqn / deling;
  const open = new Map();
  const paren = [];
  for (const e of noten) {
    const sleutel = e.kanaal * 128 + e.noot;
    const a = open.get(sleutel);
    if (e.st === 0x90 && e.v > 0) {
      // Een tweede noot-aan zonder uit ertussen: de eerste houdt hier op.
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
    // L3: de stap met de kleinste |micro| na swing, binnen de omlopen van het bestand: een
    // noot op de laatste stap die door swing of micro op de omloopgrens valt, hoort bij die
    // laatste stap, niet bij een omloop die er niet is.
    const k0 = Math.round(n.aan / st), maxK = omlopen * lengte - 1;
    if (k0 - 1 > maxK) { weg++; continue; }
    let best = null;
    for (let k = Math.max(0, k0 - 1); k <= Math.min(k0 + 1, maxK); k++) {
      const micro = (n.aan - k * st - swingTicks(k % lengte, swing, st)) / st;
      if (micro < -0.5 - 1e-9 || micro > 0.5 + 1e-9) continue;
      if (!best || Math.abs(micro) < Math.abs(best.micro) - 1e-12) best = { k, micro };
    }
    if (!best && k0 > maxK) { weg++; continue; }   // past nergens en ligt voorbij de laatste stap
    if (!best) {
      const k = Math.min(k0, maxK);
      best = { k, micro: Math.min(0.5, Math.max(-0.5, (n.aan - k * st - swingTicks(k % lengte, swing, st)) / st)) };
    }
    res.push({ stap: best.k % lengte, noot: n.noot, snelheid: n.v / 127, duur: (n.uit - n.aan) / st, micro: best.micro });
  }
  if (weg) fouten.push(`${weg} noot/noten na omloop ${omlopen} weggelaten`);
  return normaliseerPatroon({ naam: '', lengte, deling, swing, noten: res }, { fouten });
}
