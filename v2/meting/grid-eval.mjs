#!/usr/bin/env node
/**
 * Meetpunt M12 (BUDGET.md): klopt het grid van VarveDJ op Clay's muziek, en weigert sync waar het
 * grid twijfelt? Clay's tikken (tikken.html) zijn de waarheid.
 *
 *   node v2/meting/grid-eval.mjs --tikken <map of bestand> [--server http://localhost:8780] [--json uit.json]
 *
 * Per nummer: de grid-tellen (Beatgrid.timeOf over het getikte stuk), alle maten van beat-eval.mjs
 * (zoals mir_eval: tellen vóór 5 s tellen niet mee), of de "1" klopt (deel van de getikte enen binnen
 * ±70 ms van een maatbegin van het grid), en per stuk van de tempokaart: wat het grid zegt (syncBij: mag
 * sync hier; zekerBij erbij) tegenover wat het is (goed = F ≥ 0,9 en, als er enen in het stuk getikt zijn,
 * ≥ 90% van die enen raak: een sync op een "1" die een tel naast staat hoor je meteen).
 *
 *   zeker en goed       sync mag en klopt
 *   zeker maar fout     sync mag maar klopt niet: het ergste (M12 eist 0)
 *   onzeker en fout     terecht geweigerd
 *   onzeker maar goed   onnodig geweigerd
 *
 * Grens M12: 0 × "zeker maar fout" en F ≥ 0,9 over alle zekere stukken samen. Exit 0 = gehaald,
 * 1 = niet gehaald, 2 = kon niet meten.
 *
 * Alleen het getikte deel telt: waar Clay langer dan 2,5 tel (en minstens 2 s) niet tikte, staat het grid
 * ook niet in de meting (anders tellen gridtellen in een overgeslagen stuk als vals). Het grid komt uit
 * /api/library van de v2-server, die de v1-library alleen leest.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Beatgrid } from '../app/src/kern/grid.js';
import { evalueer, fMaat, koppel, trimBeats, variaties, F_VENSTER, MIN_TEL_TIJD } from './beat-eval.mjs';

export const F_GOED = 0.9;          // M12
export const EEN_GOED = 0.9;
export const EEN_VENSTER = F_VENSTER;
export const MIN_TIKKEN_STUK = 8;   // minder getikte tellen in een stuk = niet te beoordelen
export const GAT_TELLEN = 2.5, GAT_MIN_S = 2;

const mediaan = (xs) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : NaN; };
const getal = (x) => typeof x === 'number' && Number.isFinite(x);

/** Een tikbestand (één object of een lijst) netjes maken. */
export function leesTikken(json) {
  const lijst = Array.isArray(json) ? json : [json];
  return lijst.filter((t) => t && t.id && Array.isArray(t.tellen)).map((t) => ({
    id: String(t.id), titel: t.titel ?? '',
    tellen: t.tellen.filter(getal).sort((a, b) => a - b),
    enen: (t.enen ?? []).filter(getal).sort((a, b) => a - b),
    kalibratie_ms: t.kalibratie_ms ?? null,
  }));
}

/** De stukken waar getikt is: [{ van, tot }] (eerste en laatste tik), gesplitst op gaten. */
export function getikteDelen(tellen) {
  if (tellen.length < 2) return [];
  const ioi = mediaan(tellen.slice(1).map((t, i) => t - tellen[i]));
  const gat = Math.max(GAT_TELLEN * ioi, GAT_MIN_S);
  const delen = [];
  let van = tellen[0], n = 1;
  for (let i = 1; i < tellen.length; i++) {
    if (tellen[i] - tellen[i - 1] > gat) { if (n >= 4) delen.push({ van, tot: tellen[i - 1], n }); van = tellen[i]; n = 0; }
    n++;
  }
  if (n >= 4) delen.push({ van, tot: tellen.at(-1), n });
  return delen.map((d) => ({ ...d, rand: ioi / 2 }));
}

/** Gridtellen in [van, tot]: { tijd, maatbegin }. */
export function gridTellen(grid, van, tot) {
  const uit = [];
  if (!(tot >= van)) return uit;
  for (let b = Math.ceil(grid.beatAt(van) - 1e-9); ; b++) {
    const t = grid.timeOf(b);
    if (t > tot) break;
    if (t >= van) uit.push({ tijd: t, maatbegin: grid.isMaatbegin(b) });
    if (uit.length > 200000) break;
  }
  return uit;
}

/** Deel van `enen` met een maatbegin van het grid binnen ±EEN_VENSTER. null zonder enen. */
function eenRaak(enen, maatbegins) {
  if (!enen.length) return null;
  let raak = 0, j = 0;
  for (const e of enen) {
    while (j + 1 < maatbegins.length && maatbegins[j + 1] <= e) j++;
    const d = Math.min(Math.abs((maatbegins[j] ?? Infinity) - e), Math.abs((maatbegins[j + 1] ?? Infinity) - e));
    if (d <= EEN_VENSTER + 1e-12) raak++;
  }
  return raak / enen.length;
}

/** Wat er mis is als F laag is: het grid op een ander metrisch niveau (dubbel, half, tegentel)? */
function diagnose(ref, est, F) {
  if (F >= F_GOED || ref.length < 4) return '';
  const [, tegen, dubbel, half1, half2] = variaties(ref);
  const kandidaten = [['tegentel (halve tel naast)', tegen], ['dubbel tempo', dubbel], ['half tempo', half1], ['half tempo', half2]];
  let beste = '', bF = 0;
  for (const [naam, r] of kandidaten) { const f = fMaat(r, est); if (f > bF) { bF = f; beste = naam; } }
  return bF >= F_GOED ? beste : '';
}

/** Tellen goed maar de "1" niet: op welke tel van het grid valt de getikte "1" meestal? */
function eenDiagnose(grid, enen, s) {
  if (!grid || s.een === null || s.een >= EEN_GOED || s.F < F_GOED) return '';
  const telling = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const e of enen) telling[grid.telInMaat(grid.nearest(e) + 1e-6)]++;
  const tel = telling.indexOf(Math.max(...telling));
  return tel > 1 ? `de getikte "1" valt op tel ${tel} van het grid` : '';
}

const SOORT = (sync, goed) => (sync ? (goed ? 'zeker en goed' : 'zeker maar fout') : (goed ? 'onzeker maar goed' : 'onzeker en fout'));
export const SOORTEN = ['zeker en goed', 'zeker maar fout', 'onzeker en fout', 'onzeker maar goed'];

/**
 * Eén nummer meten. `nummer` = { id, titel, duur, grid } uit /api/library, `tik` uit leesTikken.
 */
export function meetNummer(nummer, tik) {
  const grid = nummer.grid ? Beatgrid.van(nummer.grid) : null;
  const duur = getal(nummer.duur) && nummer.duur > 0 ? nummer.duur : (tik.tellen.at(-1) ?? 0) + 1;
  const delen = getikteDelen(tik.tellen);
  const uit = {
    id: tik.id, titel: nummer.titel || tik.titel, duur, tikken: tik.tellen.length, enen: tik.enen.length,
    bpmTik: tik.tellen.length > 1 ? 60 / mediaan(tik.tellen.slice(1).map((t, i) => t - tik.tellen[i])) : null,
    grid: !!grid, bpmGrid: grid ? grid.bpmAt(delen[0]?.van ?? 0) : null, stukken: [],
  };
  // Gridtellen alleen waar getikt is (plus een halve tel aan de randen), binnen het nummer.
  const gt = [];
  if (grid) for (const d of delen) gt.push(...gridTellen(grid, Math.max(0, d.van - d.rand), Math.min(duur, d.tot + d.rand)));
  const est = gt.map((g) => g.tijd);
  const maatbegins = gt.filter((g) => g.maatbegin).map((g) => g.tijd);
  uit.maten = evalueer(tik.tellen, est);
  uit.een = eenRaak(tik.enen, maatbegins);
  uit.diagnose = diagnose(trimBeats(tik.tellen), trimBeats(est), uit.maten.F);

  // Per stuk van de tempokaart (zonder grid: het hele nummer als één onzeker stuk).
  const stukken = grid ? grid.stukken : [{ van: 0 }];
  for (let i = 0; i < stukken.length; i++) {
    const van = i === 0 ? 0 : Math.max(0, stukken[i].van);
    const tot = i + 1 < stukken.length ? Math.min(duur, stukken[i + 1].van) : duur;
    if (!(tot > van)) continue;
    const binnen = (t) => t >= van && t < tot;
    const ref = trimBeats(tik.tellen.filter(binnen), MIN_TEL_TIJD);
    const e = trimBeats(est.filter(binnen), MIN_TEL_TIJD);
    const enen = tik.enen.filter(binnen);
    const mid = (van + tot) / 2;
    const s = {
      nr: i + 1, van, tot, tikken: ref.length,
      zekerheid: grid ? (stukken[i].zekerheid ?? null) : null,
      twijfel: grid ? (stukken[i].twijfel ?? null) : 'geen grid',
      zeker: grid ? grid.zekerBij(mid) : false, sync: grid ? grid.syncBij(mid) : false,
    };
    if (ref.length < MIN_TIKKEN_STUK) { s.soort = 'te weinig tikken'; uit.stukken.push(s); continue; }
    s.F = fMaat(ref, e);
    s.paren = koppel(ref, e, F_VENSTER); s.nRef = ref.length; s.nEst = e.length;
    s.een = eenRaak(enen, maatbegins);
    s.goed = s.F >= F_GOED && (s.een === null || s.een >= EEN_GOED);
    s.soort = SOORT(s.sync, s.goed);
    s.diagnose = diagnose(ref, e, s.F) || eenDiagnose(grid, enen, s);
    uit.stukken.push(s);
  }
  return uit;
}

/** Alles samen: de tabel van M12 en het oordeel. */
export function samenvatting(nummers) {
  const tabel = Object.fromEntries(SOORTEN.map((k) => [k, { stukken: 0, tikken: 0, s: 0 }]));
  let paren = 0, nRef = 0, nEst = 0, zekerStukken = 0;
  for (const n of nummers) for (const s of n.stukken) {
    if (!tabel[s.soort]) continue;
    tabel[s.soort].stukken++; tabel[s.soort].tikken += s.nRef; tabel[s.soort].s += s.tot - s.van;
    if (s.sync) { zekerStukken++; paren += s.paren; nRef += s.nRef; nEst += s.nEst; }
  }
  // F over alle zekere stukken samen: alle paren, alle tikken, alle gridtellen.
  const p = nEst ? paren / nEst : 0, r = nRef ? paren / nRef : 0;
  const Fzeker = p + r ? 2 * p * r / (p + r) : null;
  const fout = tabel['zeker maar fout'].stukken;
  const gehaald = zekerStukken > 0 && fout === 0 && Fzeker >= F_GOED;
  return { tabel, Fzeker, zekerStukken, gehaald };
}

// ---- de CLI ---------------------------------------------------------------------------------------

function args(argv) {
  const a = { server: 'http://localhost:8780' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tikken') a.tikken = argv[++i];
    else if (k === '--server') a.server = argv[++i];
    else if (k === '--json') a.json = argv[++i];
    else if (k === '-h' || k === '--help') a.hulp = true;
    else throw new Error(`onbekend: ${k}`);
  }
  return a;
}

function leesMap(pad) {
  const bestanden = statSync(pad).isDirectory()
    ? readdirSync(pad).filter((f) => f.toLowerCase().endsWith('.json')).sort().map((f) => join(pad, f))
    : [pad];
  const perId = new Map();
  for (const b of bestanden) {
    let json;
    try { json = JSON.parse(readFileSync(b, 'utf8')); } catch (e) { console.error(`overgeslagen: ${b} (${e.message})`); continue; }
    // Hetzelfde nummer twee keer (een download en een export van alles): de laatst gemaakte wint.
    for (const t of leesTikken(json)) {
      const g = Date.parse((Array.isArray(json) ? json.find((x) => x?.id === t.id) : json)?.gemaakt ?? '') || 0;
      const oud = perId.get(t.id);
      if (!oud || g >= oud.g) perId.set(t.id, { ...t, g, bestand: b });
    }
  }
  return [...perId.values()];
}

const pct = (x) => (x === null || x === undefined ? '  –  ' : `${(x * 100).toFixed(0).padStart(3)}%`);
const f2 = (x) => (x === null || x === undefined ? '  –  ' : x.toFixed(3));
const tijd = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function verslag(nummers, som, nietGevonden = []) {
  const r = [];
  r.push('VarveDJ v2 — M12: het grid tegen Clay\'s tikken (±70 ms, tellen vóór 5 s tellen niet mee)', '');
  for (const n of nummers) {
    const m = n.maten;
    r.push(`${n.titel || n.id}  [${n.id}]`);
    r.push(`  ${n.tikken} tikken, ${n.enen} enen · tik ${n.bpmTik?.toFixed(1) ?? '–'} bpm · grid ${n.grid ? n.bpmGrid.toFixed(1) + ' bpm' : 'GEEN'}`);
    r.push(`  F ${f2(m.F)}  Cemgil ${f2(m.cemgil)} (best ${f2(m.cemgilBest)})  P ${f2(m.pScore)}  Goto ${m.goto}  CMLc ${f2(m.CMLc)}  CMLt ${f2(m.CMLt)}  AMLc ${f2(m.AMLc)}  AMLt ${f2(m.AMLt)}`);
    r.push(`  de "1": ${n.een === null ? 'geen enen getikt' : pct(n.een) + ' van de getikte enen raak'}${n.diagnose ? ` · lijkt: ${n.diagnose}` : ''}`);
    for (const s of n.stukken) {
      const w = s.twijfel ? ` ${s.twijfel}` : '';
      const z = `zekerheid ${s.zekerheid === null ? '–' : s.zekerheid.toFixed(2)}${w}; ${s.sync ? 'sync mag' : 'sync weigert'}${s.zeker && !s.sync ? ' (zekerBij wel)' : ''}`;
      r.push(`   stuk ${s.nr} ${tijd(s.van)}–${tijd(s.tot)}  ${s.soort.padEnd(18)} F ${f2(s.F)}  "1" ${pct(s.een)}  (${z})${s.diagnose ? ` · ${s.diagnose}` : ''}`);
    }
    r.push('');
  }
  if (nietGevonden.length) r.push(`Niet in de library (niet gemeten): ${nietGevonden.join(', ')}`, '');
  r.push('Stukken             aantal  tikken   duur');
  for (const k of SOORTEN) { const t = som.tabel[k]; r.push(`  ${k.padEnd(18)} ${String(t.stukken).padStart(5)}  ${String(t.tikken).padStart(6)}  ${tijd(t.s).padStart(6)}`); }
  r.push('');
  r.push(`F op de zekere stukken samen: ${f2(som.Fzeker)} (grens ≥ ${F_GOED}) · zeker maar fout: ${som.tabel['zeker maar fout'].stukken} (grens 0)`);
  r.push(som.zekerStukken === 0 ? 'M12: NIET TE BEOORDELEN — geen enkel zeker stuk met genoeg tikken.' : `M12: ${som.gehaald ? 'GEHAALD' : 'NIET GEHAALD'}`);
  return r.join('\n');
}

export async function hoofd(argv = process.argv.slice(2)) {
  const a = args(argv);
  if (a.hulp || !a.tikken) {
    console.log('node v2/meting/grid-eval.mjs --tikken <map of bestand> [--server http://localhost:8780] [--json uit.json]');
    return a.hulp ? 0 : 2;
  }
  const tikken = leesMap(a.tikken);
  if (!tikken.length) { console.error(`geen tikbestanden in ${a.tikken}`); return 2; }
  let lib;
  try {
    const res = await fetch(new URL('/api/library', a.server));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lib = await res.json();
  } catch (e) { console.error(`de server antwoordt niet (${a.server}): ${e.message}. Draait \`node v2/app/server.mjs\`?`); return 2; }
  const perId = new Map((lib.nummers ?? []).map((n) => [String(n.id), n]));
  const nummers = [], niet = [];
  for (const t of tikken) {
    const n = perId.get(t.id);
    if (!n) { niet.push(t.id); continue; }
    nummers.push(meetNummer(n, t));
  }
  const som = samenvatting(nummers);
  console.log(verslag(nummers, som, niet));
  if (a.json) writeFileSync(a.json, JSON.stringify({ gemaakt: new Date().toISOString(), server: a.server, nummers, samenvatting: som, nietGevonden: niet }, null, 1) + '\n');
  if (som.zekerStukken === 0) return 2;
  return som.gehaald ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  hoofd().then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 2; });
}
