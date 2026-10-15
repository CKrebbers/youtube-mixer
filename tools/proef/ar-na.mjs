#!/usr/bin/env node
/**
 * Na de proefavond van de architectuurronde (docs/verslagen/2026-10-15/ar-proef.md): rekent uit
 * Clay's eigen bestanden van die avond uit wat de ar-punten van de speellijst beweren. Niet wat
 * hij voelde, maar wat er in de bestanden staat:
 *
 *   opname   reeksen nullen in de WAV (een stuk dat de server nooit kreeg wordt stilte op zijn
 *            plek, opnemer.js): hoeveel, waar, en of ze in een storing vallen;
 *   log      het handelingenlog van dezelfde opname: gaten van NUL-bytes (een stuk dat kwijt is),
 *            regels die niet te lezen zijn, de eind-regel, en hoeveel regels er tijdens de storing
 *            binnenkwamen (liep het log door?);
 *   server   de regels van de herstartlus in ~/.varve-server.log ([lus] …, [server] poort … bezet):
 *            wanneer viel hij om, wanneer was hij terug, hoe vaak herstart;
 *   grid     per nummer (--nummer <id>) het bewaarde grid tegen de tellen van Beat This!
 *            (meetGrid, src/engine/tellen.js): afwijking in ms, raak, de "1" op de downbeats, twijfel.
 *
 * ALLEEN LEZEN, OP KOPIEËN. Standaard droog (--droog): zegt welke bestanden hij zou kopiëren en
 * wat hij zou meten, en doet niets. Met --meet: kopieert die bestanden naar een eigen tijdelijke
 * map (op APFS een clone, dus vrijwel gratis), meet daar, en ruimt die map op. Schrijft nergens
 * anders iets; het rapport gaat naar stdout. Nooit tijdens een set (het leest de WAV helemaal).
 *
 *   node tools/proef/ar-na.mjs                       droog: wat zou hij doen
 *   node tools/proef/ar-na.mjs --meet [opties]       meten
 *     --opnames <map>      standaard VARVE_OPNAMES of <repo>/opnames
 *     --set <id>           de opname (set-<id>.wav); standaard de nieuwste
 *     --serverlog <pad>    standaard ~/.varve-server.log
 *     --media <map>        standaard zoals de server (VARVE_MEDIA, media/, media-VERHUISD.txt)
 *     --db <pad>           standaard VARVE_DB of <media>/library.db
 *     --nummer <id>        een nummer voor de gridmeting (mag vaker)
 *     --titel <tekst>      idem, op (een deel van) de titel; opgezocht in de kopie van library.db (mag vaker)
 *     --venster UU:MM:SS-UU:MM:SS   de storing met de hand (een hang korter dan de wachter, of zonder de lus)
 *     --json               JSON in plaats van tekst
 * Exit: 0 gemeten en niets mis · 2 gemeten en iets gevonden (gat in een storing, log met gat,
 * grid naast de tellen) · 1 verkeerd aangeroepen of niets te lezen.
 */
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync, constants } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Beatgrid } from '../../src/engine/beatgrid.js';
import { meetGrid } from '../../src/engine/tellen.js';
import { kiesMedia } from '../../server/media-plek.js';

/** Een reeks nullen telt vanaf zoveel frames (10 ms op 48 kHz: de eis van tools/headless/server-weg.mjs). */
export const NUL_MIN = 480;
/** Zoveel seconden rond een storing tellen nog mee (de klok van de lus en die van de WAV lopen niet gelijk). */
export const MARGE_S = 5;
/** Een grid ligt "op de tel" als de mediane afwijking hooguit dit is (s): de snap mikt op ~5 ms (BEATGRID.md §14). */
export const OP_TEL = 0.005;
/** De "1" klopt als zoveel van de downbeats van Beat This! op een "1" van het grid valt. */
export const EEN_GOED = 0.9;

// ---- de WAV -------------------------------------------------------------------------------

/**
 * De kop van een opname-WAV: waar de data begint, kanalen, sampleRate, bits. De opname heeft een
 * kop van 80 bytes met JUNK (RF64 boven 4 GB) of de gewone 44; loop daarom de chunks af.
 * @returns {{ data: number, kanalen: number, sr: number, bits: number } | null}
 */
export function leesWavKop(buf) {
  const id = buf.toString('latin1', 0, 4);
  if ((id !== 'RIFF' && id !== 'RF64') || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let o = 12, fmt = null;
  while (o + 8 <= buf.length) {
    const naam = buf.toString('latin1', o, o + 4);
    const lengte = buf.readUInt32LE(o + 4);
    if (naam === 'fmt ') fmt = { kanalen: buf.readUInt16LE(o + 10), sr: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (naam === 'data') return fmt ? { data: o + 8, ...fmt } : null;
    o += 8 + lengte + (lengte & 1);
  }
  return null;
}

/**
 * Reeksen frames waarin ALLE kanalen precies 0 zijn, van minstens `min` frames, uit een 16-bit
 * PCM-bestand (in stukken gelezen: een opname van een uur is ~700 MB).
 * @returns {Promise<{ frames: number, reeksen: Array<{ van: number, duur: number }> }>} in seconden
 */
export async function nulReeksen(pad, { min = NUL_MIN } = {}) {
  const kopBuf = Buffer.alloc(4096);
  const fd = await import('node:fs/promises').then((m) => m.open(pad, 'r'));
  try { await fd.read(kopBuf, 0, kopBuf.length, 0); } finally { await fd.close(); }
  const kop = leesWavKop(kopBuf);
  if (!kop || kop.bits !== 16) throw new Error(`${basename(pad)}: geen 16-bit PCM-WAV`);
  const fb = 2 * kop.kanalen;
  const reeksen = [];
  let frame = 0, lopend = 0, rest = Buffer.alloc(0);
  const sluit = () => { if (lopend >= min) reeksen.push({ van: (frame - lopend) / kop.sr, duur: lopend / kop.sr }); lopend = 0; };
  for await (const stuk of createReadStream(pad, { start: kop.data, highWaterMark: 1 << 20 })) {
    const b = rest.length ? Buffer.concat([rest, stuk]) : stuk;
    const heel = b.length - (b.length % fb);
    for (let o = 0; o < heel; o += fb) {
      let nul = true;
      for (let k = 0; k < fb; k += 2) if (b[o + k] !== 0 || b[o + k + 1] !== 0) { nul = false; break; }
      if (nul) lopend++; else sluit();
      frame++;
    }
    rest = b.subarray(heel);
  }
  sluit();
  return { frames: frame, sr: kop.sr, reeksen };
}

/** Het begin van een opname uit zijn id (set-JJJJMMDD-UUMMSS, lokale tijd, server/opname.js nieuwId). */
export function beginVanId(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

// ---- het handelingenlog -------------------------------------------------------------------

/**
 * Een handelingenlog als tekst (latin1: het is ASCII, een gat is NUL-bytes).
 * @returns {{ regels, onleesbaar, gaten: Array<{ byte, bytes }>, eind: boolean, begon: Date|null, t: number[] }}
 *   t = de tijden (s, audioklok vanaf de kop) van elke regel, op volgorde van het bestand
 */
export function leesLog(tekst) {
  const gaten = [];
  for (let i = 0; i < tekst.length; i++) {
    if (tekst.charCodeAt(i) !== 0) continue;
    let j = i;
    while (j < tekst.length && tekst.charCodeAt(j) === 0) j++;
    gaten.push({ byte: i, bytes: j - i });
    i = j - 1;
  }
  let regels = 0, onleesbaar = 0, eind = false, begon = null;
  const t = [];
  for (const regel of tekst.replace(/\0+/g, '\n').split('\n')) {
    if (!regel.trim()) continue;
    let j;
    try { j = JSON.parse(regel); } catch { onleesbaar++; continue; }
    regels++;
    const tijd = Array.isArray(j) ? j[0] : j?.t;
    if (Number.isFinite(tijd)) t.push(tijd);
    if (j?.e === 'kop' && typeof j.begon === 'string') begon = new Date(j.begon);
    if (j?.e === 'eind') eind = true;
  }
  return { regels, onleesbaar, gaten, eind, begon, t };
}

// ---- het log van de server (de herstartlus) -----------------------------------------------

/**
 * De regels van de lus en de server uit ~/.varve-server.log. De lus schrijft "[lus] DD-MM UU:MM:SS …"
 * (lokale tijd, zonder jaar: `jaar` van buiten). Alleen wat over omvallen, stoppen en starten gaat.
 * Een hang (AR18) schrijft de wachter als "de server antwoordt niet (laatste antwoord UU:MM:SS, …): kill -9": `t` is
 * dan dat laatste antwoord (de hang begon daarna, hooguit één peiling van 5 s later), niet het moment van de kill.
 * @returns {Array<{ t: Date, soort: 'gestart'|'herstart'|'omgevallen'|'hang'|'gestopt'|'bezet'|'crashlus', tekst: string }>}
 */
export function leesServerlog(tekst, jaar) {
  const uit = [];
  let laatste = null;
  for (const regel of tekst.split('\n')) {
    const m = /^\[lus\] (\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (.*)$/.exec(regel.trim());
    if (m) {
      const t = new Date(jaar, +m[2] - 1, +m[1], +m[3], +m[4], +m[5]);
      laatste = t;
      const r = m[6];
      const hang = /^de server antwoordt niet \(laatste antwoord (\d{2}):(\d{2}):(\d{2})/.exec(r);
      if (hang) {
        let laatst = new Date(jaar, +m[2] - 1, +m[1], +hang[1], +hang[2], +hang[3]);
        if (laatst > t) laatst = new Date(laatst.getTime() - 86400000);  // over middernacht
        uit.push({ t: laatst, soort: 'hang', tekst: r });
        continue;
      }
      const soort = /^server gestart .*herstart \d+/.test(r) ? 'herstart'
        : /^server gestart/.test(r) ? 'gestart'
          : /keer herstart in .* de lus stopt/.test(r) ? 'crashlus'
            : /^de server viel om/.test(r) ? 'omgevallen'
              : /poort is bezet|luistert al iets/.test(r) ? 'bezet'
                : /^(gestopt|de server is gestopt|de server stopte netjes)/.test(r) ? 'gestopt' : null;
      if (soort) uit.push({ t, soort, tekst: r });
      continue;
    }
    // De server zelf heeft geen tijd in zijn regel: de tijd van de laatste lus-regel ervoor.
    if (/^\[server\] poort \d+ is bezet/.test(regel.trim()) && laatste) uit.push({ t: laatste, soort: 'bezet', tekst: regel.trim() });
  }
  return uit;
}

/** De vensters waarin de server weg was: van omvallen, hangen of stoppen tot de volgende start. Na een hang komt
 *  ook "viel om (exitcode 137)" (de kill -9): dat hoort bij dezelfde storing, die begon na het laatste antwoord. */
export function storingen(gebeurtenissen) {
  const uit = [];
  let weg = null;
  for (const g of gebeurtenissen) {
    if (g.soort === 'omgevallen' || g.soort === 'hang' || g.soort === 'gestopt' || g.soort === 'crashlus') { if (!weg) weg = g; }
    else if ((g.soort === 'gestart' || g.soort === 'herstart') && weg) {
      const hoe = weg.soort === 'omgevallen' ? 'omgevallen (de lus startte hem)'
        : weg.soort === 'hang' ? 'hing (de wachter van de lus zette hem neer)' : 'gestopt';
      uit.push({ van: weg.t, tot: g.t, duur: (g.t - weg.t) / 1000, hoe });
      weg = null;
    }
  }
  // Een laatste stop zonder start erna is het einde van de avond; omvallen zonder start niet.
  if (weg && weg.soort !== 'gestopt') uit.push({ van: weg.t, tot: null, duur: null, hoe: 'niet teruggekomen' });
  return uit;
}

/** "UU:MM:SS-UU:MM:SS" op de dag van `dag` (Date) als venster, of null. */
export function leesVenster(tekst, dag) {
  const m = /^(\d{2}):(\d{2}):(\d{2})-(\d{2}):(\d{2}):(\d{2})$/.exec(tekst || '');
  if (!m || !dag) return null;
  const op = (h, mi, s) => new Date(dag.getFullYear(), dag.getMonth(), dag.getDate(), +h, +mi, +s);
  const van = op(m[1], m[2], m[3]), tot = op(m[4], m[5], m[6]);
  return tot > van ? { van, tot, duur: (tot - van) / 1000, hoe: 'met de hand (--venster)' } : null;
}

// ---- het grid tegen de tellen -------------------------------------------------------------

/**
 * Het grid van een nummer tegen zijn tellen: `grid` = de JSON uit library.db (tracks.grid_json),
 * `tellen` = media/<id>/tellen.json ({ beats, downbeats }). Per stuk en totaal, in ms.
 */
export function gridTegenTellen(grid, tellen) {
  if (!grid) return { fout: 'geen grid' };
  if (!tellen?.beats?.length) return { fout: 'geen tellen (Beat This! heeft dit nummer niet geteld)' };
  const g = new Beatgrid(grid);
  const m = meetGrid(g, tellen.beats, tellen.downbeats ?? null);
  const ms = (x) => (x === null || x === undefined ? null : Math.round(x * 10000) / 10);
  const stukken = m.stukken.map((s, i) => ({
    van: s.van, bpm: g.stukken[i].bpm, n: s.n, raak: s.raak, mediaanMs: ms(s.mediaan), afwijkingMs: ms(s.afwijking), een: s.een,
    zeker: g.stukken[i].zekerheid ?? null, twijfel: g.stukken[i].twijfel ?? null, ...(s.fijn ? { fijn: true } : {}),
  }));
  const tot = m.totaal;
  const opTel = tot.mediaan !== null && Math.abs(tot.mediaan) <= OP_TEL;
  const eenGoed = tot.een === null ? null : tot.een >= EEN_GOED;
  return { bron: grid.bron ?? null, slot: !!grid.slot, n: tot.n, raak: tot.raak, mediaanMs: ms(tot.mediaan), afwijkingMs: ms(tot.afwijking), een: tot.een, opTel, eenGoed, stukken };
}

// ---- samen --------------------------------------------------------------------------------

/** Valt een reeks (s vanaf het begin van de WAV) in een storing (Date-venster), met MARGE_S? */
export function inStoring(reeks, begin, vensters, marge = MARGE_S) {
  if (!begin) return false;
  const a = begin.getTime() + reeks.van * 1000, b = a + reeks.duur * 1000;
  return vensters.some((v) => a <= (v.tot ?? new Date(8.64e15)).getTime() + marge * 1000 && b >= v.van.getTime() - marge * 1000);
}

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const klok = (d) => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}` : '?');

/** Het rapport als tekst. Puur: krijgt wat main() gemeten heeft. */
export function alsTekst(r) {
  const regels = [];
  const zeg = (s = '') => regels.push(s);
  zeg(`ar-na · ${r.set ? `opname set-${r.set}` : 'geen opname'}${r.begin ? ` (begon ${klok(r.begin)})` : ''}`);
  zeg();
  zeg('SERVER (herstartlus)');
  if (!r.server) zeg('  geen serverlog gelezen');
  else {
    for (const g of r.server.gebeurtenissen) zeg(`  ${klok(g.t)}  ${g.soort.padEnd(10)} ${g.tekst}`);
    if (!r.server.gebeurtenissen.length) zeg('  geen regels van de lus op deze dag (draaide de server via de lus? VARVE.app opnieuw gebouwd?)');
  }
  zeg(`  storingen: ${r.vensters.length ? r.vensters.map((v) => `${klok(v.van)}–${v.tot ? klok(v.tot) : '…'} (${v.duur === null ? '?' : `${v.duur.toFixed(0)} s`}, ${v.hoe})`).join(' · ') : 'geen'}`);
  zeg();
  zeg('OPNAME');
  if (!r.opname) zeg('  geen WAV gelezen');
  else {
    const o = r.opname;
    zeg(`  ${(o.frames / o.sr).toFixed(1)} s · reeksen nullen ≥ ${(NUL_MIN / 48).toFixed(0)} ms: ${o.reeksen.length}, waarvan in een storing: ${o.inStoring.length}`);
    for (const x of o.reeksen.slice(0, 20)) zeg(`    ${x.van.toFixed(2)} s (${r.begin ? klok(new Date(r.begin.getTime() + x.van * 1000)) : '?'}) · ${(x.duur * 1000).toFixed(0)} ms${o.inStoring.includes(x) ? '  ← IN DE STORING' : ''}`);
    if (o.reeksen.length > 20) zeg(`    … en nog ${o.reeksen.length - 20}`);
    zeg('  (nullen buiten een storing: er speelde niets, of een nummer begint of eindigt stil; IN een storing is het een verloren stuk)');
  }
  zeg();
  zeg('HANDELINGENLOG');
  if (!r.log) zeg('  geen log gelezen');
  else {
    const l = r.log;
    zeg(`  ${l.regels} regels · eind-regel: ${l.eind ? 'ja' : 'NEE'} · gaten (NUL): ${l.gaten.length}${l.gaten.length ? ` (${l.gaten.reduce((s, g) => s + g.bytes, 0)} bytes)` : ''} · onleesbaar: ${l.onleesbaar}`);
    if (l.tijdensStoring !== null) zeg(`  regels tijdens de storing(en): ${l.tijdensStoring} (0 kan kloppen: dan raakte je niets aan)`);
  }
  for (const n of r.nummers) {
    zeg();
    zeg(`GRID · ${n.id}${n.titel ? ` · ${n.titel}` : ''}`);
    if (n.fout) { zeg(`  ${n.fout}`); continue; }
    zeg(`  bron ${n.bron ?? '?'}${n.slot ? ' · op slot' : ''} · ${n.n} tellen · raak ${pct(n.raak)} · mediaan ${n.mediaanMs ?? '—'} ms · grootste afwijking ${n.afwijkingMs ?? '—'} ms · "1" op de downbeats ${pct(n.een)}`);
    zeg(`  oordeel: ${n.opTel ? `op de tel (≤ ${OP_TEL * 1000} ms)` : `NAAST de tel (> ${OP_TEL * 1000} ms)`} · "1" ${n.eenGoed === null ? 'niet te zeggen (geen downbeats)' : n.eenGoed ? 'klopt' : 'NAAST de downbeats'}`);
    for (const s of n.stukken) zeg(`    vanaf ${s.van.toFixed(1)} s · ${s.bpm.toFixed(2)} bpm · raak ${pct(s.raak)} · ${s.mediaanMs ?? '—'} ms · "1" ${pct(s.een)}${s.twijfel ? ` · twijfel ${s.twijfel}` : ''}${s.fijn ? ' · Beat This! telt het dubbele' : ''}`);
  }
  zeg();
  zeg(r.gevonden.length ? `GEVONDEN: ${r.gevonden.join(' · ')}` : 'NIETS MIS GEVONDEN');
  return regels.join('\n');
}

/** Wat het rapport "mis" noemt (exit 2). Puur. */
export function gevonden(r) {
  const uit = [];
  if (r.opname?.inStoring.length) uit.push(`${r.opname.inStoring.length} reeks(en) nullen in een storing`);
  if (r.log && (r.log.gaten.length || r.log.onleesbaar)) uit.push('het log heeft een gat of onleesbare regels');
  if (r.log && !r.log.eind) uit.push('het log heeft geen eind-regel (niet netjes gestopt?)');
  for (const n of r.nummers) {
    if (n.fout) continue;
    if (!n.opTel) uit.push(`${n.id}: het grid ligt naast de tel`);
    if (n.eenGoed === false) uit.push(`${n.id}: de "1" ligt naast de downbeats`);
  }
  if (r.vensters.some((v) => v.tot === null)) uit.push('de server kwam na een storing niet terug');
  return uit;
}

// ---- de opdrachtregel ---------------------------------------------------------------------

const GEBRUIK = 'gebruik: ar-na.mjs [--droog | --meet] [--opnames <map>] [--set <id>] [--serverlog <pad>] [--media <map>] [--db <pad>] [--nummer <id>]… [--titel <tekst>]… [--venster UU:MM:SS-UU:MM:SS] [--json]';

export function leesArgs(argv) {
  const a = { meet: false, opnames: null, set: null, serverlog: null, media: null, db: null, nummers: [], titels: [], venster: null, json: false, hulp: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const waarde = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${k} zonder waarde`); return v; };
    if (k === '--droog') a.meet = false;
    else if (k === '--meet') a.meet = true;
    else if (k === '--opnames') a.opnames = waarde();
    else if (k === '--set') a.set = waarde().replace(/^set-/, '').replace(/\.wav$/, '');
    else if (k === '--serverlog') a.serverlog = waarde();
    else if (k === '--media') a.media = waarde();
    else if (k === '--db') a.db = waarde();
    else if (k === '--nummer') a.nummers.push(waarde());
    else if (k === '--titel') a.titels.push(waarde());
    else if (k === '--venster') a.venster = waarde();
    else if (k === '--json') a.json = true;
    else if (k === '-h' || k === '--help') a.hulp = true;
    else throw new Error(`onbekend: ${k}`);
  }
  if (a.set !== null && !/^[\w-]{1,64}$/.test(a.set)) throw new Error('--set: een opname-id zoals 20261016-201500');
  for (const n of a.nummers) if (!/^[\w-]{1,64}$/.test(n)) throw new Error(`--nummer ${n}: geen geldig id`);
  for (const t of a.titels) if (!t.trim() || t.length > 200) throw new Error('--titel: een stuk van de titel');
  if (a.venster !== null && !/^\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2}$/.test(a.venster)) throw new Error('--venster is UU:MM:SS-UU:MM:SS');
  return a;
}

/** Welke bestanden er gelezen worden (de echte paden). Puur op het bestandssysteem: leest niets. */
export function plan(a, { env = process.env, wortel = fileURLToPath(new URL('../..', import.meta.url)), thuis = homedir() } = {}) {
  const opnames = a.opnames ?? env.VARVE_OPNAMES ?? join(wortel, 'opnames');
  const media = a.media ?? kiesMedia({ env, wortel }).map;
  const db = a.db ?? env.VARVE_DB ?? join(media, 'library.db');
  const serverlog = a.serverlog ?? join(thuis, '.varve-server.log');
  let set = a.set;
  if (!set && existsSync(opnames)) {
    const wavs = readdirSync(opnames).filter((n) => /^set-[\w-]+\.wav$/.test(n)).sort();
    if (wavs.length) set = wavs.at(-1).slice(4, -4);
  }
  const bestanden = [];
  const erbij = (wat, pad) => { if (existsSync(pad)) bestanden.push({ wat, pad, bytes: statSync(pad).size }); else bestanden.push({ wat, pad, ontbreekt: true }); };
  if (set) { erbij('opname', join(opnames, `set-${set}.wav`)); erbij('log', join(opnames, `set-${set}.acties.jsonl`)); }
  erbij('serverlog', serverlog);
  if (a.nummers.length || a.titels.length) {
    erbij('db', db);
    for (const z of ['-wal', '-shm']) if (existsSync(db + z)) erbij(`db${z}`, db + z);
    for (const n of a.nummers) erbij(`tellen:${n}`, join(media, n, 'tellen.json'));
  }
  return { set, opnames, media, db, serverlog, bestanden, titels: a.titels };
}

/** Kopieer (clone waar het kan) naar `map`; geeft een functie wat -> pad van de kopie (of null). */
function kopieer(bestanden, map) {
  const paden = new Map();
  let i = 0;
  for (const b of bestanden) {
    if (b.ontbreekt) continue;
    // De db met zijn -wal en -shm onder dezelfde naam: anders ziet SQLite de WAL niet.
    const naam = b.wat.startsWith('db') ? `library.db${b.wat.slice(2)}` : `${i++}-${basename(b.pad)}`;
    const doel = join(map, naam);
    copyFileSync(b.pad, doel, constants.COPYFILE_FICLONE);
    paden.set(b.wat, doel);
  }
  return (wat) => paden.get(wat) ?? null;
}

/** De nummers waarvan de titel `tekst` bevat (hoofdletters tellen niet), hooguit 6. */
async function zoekTitel(db, tekst) {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    return d.prepare("SELECT id, titel FROM tracks WHERE instr(lower(titel), lower(?)) > 0 ORDER BY titel LIMIT 6").all(tekst);
  } finally { d.close(); }
}

async function grid(db, id) {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    const r = d.prepare('SELECT titel, grid_json FROM tracks WHERE id = ?').get(id);
    if (!r) return { titel: null, grid: undefined };
    return { titel: r.titel, grid: r.grid_json ? JSON.parse(r.grid_json) : null };
  } finally { d.close(); }
}

export async function main(argv = process.argv.slice(2), { schrijf = (s) => process.stdout.write(s), fout = (s) => process.stderr.write(s), env = process.env, thuis } = {}) {
  let a;
  try { a = leesArgs(argv); } catch (e) { fout(`ar-na: ${e.message}\n${GEBRUIK}\n`); return 1; }
  if (a.hulp) { schrijf(GEBRUIK + '\n'); return 0; }
  const p = plan(a, { env, ...(thuis ? { thuis } : {}) });
  if (!a.meet) {
    schrijf(`ar-na (droog): met --meet worden deze bestanden gekopieerd naar een eigen tijdelijke map en daar gemeten:\n`);
    for (const b of p.bestanden) schrijf(`  ${b.wat.padEnd(16)} ${b.pad}${b.ontbreekt ? '  (ontbreekt: wordt overgeslagen)' : `  (${(b.bytes / 1e6).toFixed(1)} MB)`}\n`);
    if (!p.set) schrijf('  geen opname gevonden (--opnames, --set)\n');
    for (const t of p.titels) schrijf(`  titel            "${t}" (het id wordt in de kopie van library.db opgezocht, dan zijn tellen.json)\n`);
    if (!a.nummers.length && !p.titels.length) schrijf('  geen --nummer of --titel: geen gridmeting\n');
    schrijf('Er is niets gelezen of geschreven.\n');
    return 0;
  }
  if (!p.bestanden.some((b) => !b.ontbreekt)) { fout('ar-na: niets te lezen (geen opname, geen serverlog, geen nummer)\n'); return 1; }
  const tmp = mkdtempSync(join(tmpdir(), 'varve-ar-na-'));
  try {
    const kopie = kopieer(p.bestanden, tmp);
    const extra = new Map();
    const begin = p.set ? beginVanId(p.set) : null;
    const r = { set: p.set, begin, server: null, vensters: [], opname: null, log: null, nummers: [] };
    if (kopie('serverlog')) {
      const jaar = (begin ?? new Date()).getFullYear();
      const alle = leesServerlog(readFileSync(kopie('serverlog'), 'utf8'), jaar);
      // Alleen de dag van de opname (en de nacht erna); zonder opname: alles.
      const dag = begin ? alle.filter((g) => g.t >= new Date(begin.getFullYear(), begin.getMonth(), begin.getDate()) && g.t < new Date(begin.getFullYear(), begin.getMonth(), begin.getDate() + 1, 6)) : alle;
      r.server = { gebeurtenissen: dag };
      r.vensters = storingen(dag);
    }
    const hand = leesVenster(a.venster, begin ?? new Date());
    if (hand) r.vensters.push(hand);
    if (kopie('opname')) {
      const o = await nulReeksen(kopie('opname'));
      r.opname = { ...o, inStoring: o.reeksen.filter((x) => inStoring(x, begin, r.vensters)) };
    }
    if (kopie('log')) {
      const l = leesLog(readFileSync(kopie('log'), 'latin1'));
      const b0 = l.begon ?? begin;
      l.tijdensStoring = b0 && r.vensters.length
        ? l.t.filter((t) => r.vensters.some((v) => b0.getTime() + t * 1000 >= v.van.getTime() && b0.getTime() + t * 1000 <= (v.tot ?? new Date(8.64e15)).getTime())).length
        : null;
      delete l.t;
      r.log = l;
    }
    // Titels eerst omzetten in ids (in de kopie), en dan hun tellen.json ook kopiëren.
    const ids = [...a.nummers];
    for (const t of p.titels) {
      if (!kopie('db')) { r.nummers.push({ id: `"${t}"`, fout: `geen library.db (${p.db})` }); continue; }
      const gevonden = await zoekTitel(kopie('db'), t);
      if (gevonden.length !== 1) {
        r.nummers.push({ id: `"${t}"`, fout: gevonden.length ? `meer dan één nummer: ${gevonden.map((x) => `${x.id} (${x.titel})`).join(', ')}; kies met --nummer` : 'geen nummer met die titel' });
        continue;
      }
      ids.push(gevonden[0].id);
      const bron = join(p.media, gevonden[0].id, 'tellen.json');
      if (existsSync(bron)) { const doel = join(tmp, `tellen-${gevonden[0].id}.json`); copyFileSync(bron, doel, constants.COPYFILE_FICLONE); extra.set(`tellen:${gevonden[0].id}`, doel); }
    }
    for (const id of ids) {
      if (!kopie('db')) { r.nummers.push({ id, fout: `geen library.db (${p.db})` }); continue; }
      const { titel, grid: gj } = await grid(kopie('db'), id);
      if (gj === undefined) { r.nummers.push({ id, fout: 'niet in de library' }); continue; }
      const tp = kopie(`tellen:${id}`) ?? extra.get(`tellen:${id}`) ?? null;
      const tellen = tp ? JSON.parse(readFileSync(tp, 'utf8')) : null;
      r.nummers.push({ id, titel, ...gridTegenTellen(gj, tellen) });
    }
    r.gevonden = gevonden(r);
    schrijf(a.json ? JSON.stringify(r, null, 1) + '\n' : alsTekst(r) + '\n');
    return r.gevonden.length ? 2 : 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main());
